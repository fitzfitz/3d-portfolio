import {
  AGAIN_WINDOW_MS, ALONE_MS, FINAL_CALL_MS, GRID_MS, INVITE_TTL_MS, LOBBY_COUNTDOWN_MS, POSE_FRESH_MS, RACE_ID_RE,
  RACE_LIMIT_MS, RACE_MAX_PILOTS, RACE_MIN_PILOTS, STAMP_POS_MARGIN, UPLOAD_WINDOW_MS, WAIT_SHOUT_MS,
  checkLap, legBelievable, newInviteCode, newRaceToken, parseStamp, rankResults, signStamp,
  type RaceClientMessage, type RaceKind, type RaceServerMessage, type ResultEntry, type Stamp,
} from "../../src/utils/raceProtocol";
import { RACE_CENTRES, RING_RADIUS } from "../../src/data/ringCourse";
import type { Outgoing } from "./sky";

/**
 * The ring race room, free of Cloudflare bindings so it can be unit tested
 * (tests/raceRoom.test.ts). index.ts's Sky Durable Object persists it and
 * calls onRaceTick from its alarm (nextAlarm says when).
 * Spec: docs/archive/specs/2026-10-26-ring-race-design.md.
 *
 * Plain JSON only: the Durable Object stores the room and may hibernate at
 * any point, so there are no Maps, no class instances and no timers here.
 * A racer is known by a random token (the live-sky pilot id changes on every
 * reconnect); `pilot` is the socket currently bound to it, or null.
 */

export interface Racer {
  token: string;
  /** The live-sky pilot bound to this racer, or null (left; may rejoin by token). */
  pilot: string | null;
  cc: string | null;
  slot: number;
  /** The next ring this racer may be stamped for. */
  next: number;
  /** When the last stamp was signed (server ms): the speed rule's start. */
  lastAt: number;
  finished: boolean;
  again: boolean;
  entry: ResultEntry | null;
}
export interface Race {
  id: string; kind: RaceKind; code: string | null; host: string | null; phase: "lobby" | "grid" | "running" | "upload" | "done";
  racers: Racer[]; createdAt: number; aloneSince: number | null; startsAt: number | null; goAt: number | null;
  finalEndsAt: number | null; uploadBy: number | null; againBy: number | null;
}
export interface RaceRoom { races: Race[]; lastWaitAt: number }
export interface RaceCtx {
  now: number;
  secret: string | null;
  poseOf(pilot: string): { p: [number, number, number]; at: number } | null;
  pilotIds(): string[];
}
export interface RaceOut { out: Outgoing[] }
export interface UploadResult { status: 200 | 400 | 404 | 409; reason?: string; entry?: ResultEntry; race?: Race }

const N = RACE_CENTRES.length;
const HEX32 = /^[0-9a-f]{32}$/;

// -WAIT_SHOUT_MS, not -Infinity: JSON has no Infinity, and the room must survive a round trip.
export const newRaceRoom = (): RaceRoom => ({ races: [], lastWaitAt: -WAIT_SHOUT_MS });

// ---- small helpers ---------------------------------------------------------

function send(out: Outgoing[], to: string | null, msg: RaceServerMessage) {
  if (to !== null) out.push({ to, msg });
}
const err = (pilot: string, reason: "full" | "expired" | "busy" | "off" | "ring"): RaceOut =>
  ({ out: [{ to: pilot, msg: { t: "rerr", reason } }] });

/** The race and racer this pilot is bound to, in any race not yet done. */
function bound(room: RaceRoom, pilot: string): { race: Race; racer: Racer } | null {
  for (const race of room.races) {
    if (race.phase === "done") continue;
    const racer = race.racers.find((r) => r.pilot === pilot);
    if (racer) return { race, racer };
  }
  return null;
}

/** A pilot taking a place in a new race lets go of any finished one (its results are already out). */
function unbindDone(room: RaceRoom, pilot: string) {
  for (const race of room.races) {
    if (race.phase !== "done") continue;
    for (const r of race.racers) if (r.pilot === pilot) r.pilot = null;
  }
}

const removeRace = (room: RaceRoom, race: Race) => {
  const n = room.races.indexOf(race);
  if (n >= 0) room.races.splice(n, 1);
};

function newRace(kind: RaceKind, code: string | null, now: number): Race {
  return {
    id: newRaceToken(), kind, code, host: null, phase: "lobby", racers: [], createdAt: now, aloneSince: null,
    startsAt: null, goAt: null, finalEndsAt: null, uploadBy: null, againBy: null,
  };
}
const newRacer = (pilot: string, cc: string | null, token = newRaceToken()): Racer =>
  ({ token, pilot, cc, slot: 0, next: 0, lastAt: 0, finished: false, again: false, entry: null });

function uniqueCode(room: RaceRoom): string {
  for (;;) {
    const code = newInviteCode();
    if (!room.races.some((r) => r.code === code)) return code;
  }
}

const startStamp = (secret: string, race: Race, racer: Racer): Promise<Stamp> =>
  signStamp(secret, { r: race.id, k: racer.token, i: 0, at: race.goAt! });

// ---- phase messages --------------------------------------------------------

function lobbyMsg(race: Race, racer: Racer, now: number): RaceServerMessage {
  return {
    t: "rlobby", race: race.id, kind: race.kind, code: race.code, host: race.host === racer.token, token: racer.token,
    pilots: race.racers.map((r) => ({ cc: r.cc, you: r === racer })), startsAt: race.startsAt, now,
  };
}
function lobbyAll(race: Race, now: number, out: Outgoing[]) {
  for (const r of race.racers) send(out, r.pilot, lobbyMsg(race, r, now));
}
const gridMsg = (race: Race, racer: Racer, now: number): RaceServerMessage =>
  ({ t: "rgrid", race: race.id, kind: race.kind, slot: racer.slot, goAt: race.goAt!, now });
const overMsg = (race: Race, now: number): RaceServerMessage =>
  ({ t: "rover", race: race.id, uploadBy: race.uploadBy!, now });

/** What a racer who (re)binds mid-race needs to pick the race up again. */
async function resend(race: Race, racer: Racer, secret: string, now: number, out: Outgoing[]) {
  switch (race.phase) {
    case "lobby": send(out, racer.pilot, lobbyMsg(race, racer, now)); break;
    case "grid": send(out, racer.pilot, gridMsg(race, racer, now)); break;
    case "running":
      send(out, racer.pilot, { t: "rgo", stamp: await startStamp(secret, race, racer), now });
      if (race.finalEndsAt !== null) send(out, racer.pilot, { t: "rfinal", endsAt: race.finalEndsAt, now });
      break;
    case "upload": send(out, racer.pilot, overMsg(race, now)); break;
    case "done": break;
  }
}

// ---- transitions -----------------------------------------------------------

function addToLobby(room: RaceRoom, race: Race, racer: Racer, ctx: RaceCtx, out: Outgoing[]) {
  race.racers.push(racer);
  if (race.kind === "public") {
    if (race.racers.length === 1) {
      race.aloneSince = ctx.now;
      // The ambient "someone is waiting at the gate" line, at most once a minute.
      if (ctx.now - room.lastWaitAt >= WAIT_SHOUT_MS) {
        room.lastWaitAt = ctx.now;
        for (const id of ctx.pilotIds()) {
          if (!race.racers.some((r) => r.pilot === id)) send(out, id, { t: "rwait", cc: racer.cc });
        }
      }
    } else if (race.startsAt === null) {
      race.startsAt = ctx.now + LOBBY_COUNTDOWN_MS;
      race.aloneSince = null;
    }
  }
  lobbyAll(race, ctx.now, out);
}

function removeFromLobby(room: RaceRoom, race: Race, racer: Racer, now: number, out: Outgoing[]) {
  race.racers.splice(race.racers.indexOf(racer), 1);
  if (race.racers.length === 0) { removeRace(room, race); return; }
  // A private lobby whose host leaves would be stuck: the next racer hosts.
  if (race.host === racer.token) race.host = race.racers[0].token;
  if (race.kind === "public" && race.racers.length === 1) {
    race.startsAt = null;
    race.aloneSince = now;
  }
  lobbyAll(race, now, out);
}

function toGrid(race: Race, now: number, out: Outgoing[]) {
  race.phase = "grid";
  race.goAt = now + GRID_MS;
  race.aloneSince = null;
  race.racers.forEach((r, n) => {
    r.slot = n;
    send(out, r.pilot, gridMsg(race, r, now));
  });
}

/** GO: stamps and `lastAt` are `goAt`; the message's `now` is the tick's (a late alarm must not skew client clocks). */
async function go(race: Race, secret: string, now: number, out: Outgoing[]) {
  race.phase = "running";
  const goAt = race.goAt!;
  for (const r of race.racers) {
    r.next = 1;
    r.lastAt = goAt;
    if (r.pilot !== null) send(out, r.pilot, { t: "rgo", stamp: await startStamp(secret, race, r), now });
  }
}

/** Rule 11 (with ruling R4: "everyone finished" needs a finisher, so a race nobody is flying runs to its deadline). */
function maybeEnd(race: Race, now: number, out: Outgoing[]) {
  if (race.phase !== "running") return;
  const bound = race.racers.filter((r) => r.pilot !== null);
  const allIn = race.racers.some((r) => r.finished) && bound.every((r) => r.finished);
  if ((race.finalEndsAt !== null && now >= race.finalEndsAt) || now >= race.goAt! + RACE_LIMIT_MS || allIn) {
    race.phase = "upload";
    race.uploadBy = now + UPLOAD_WINDOW_MS;
    for (const r of race.racers) send(out, r.pilot, overMsg(race, now));
  }
}

function results(race: Race, now: number, out: Outgoing[]) {
  const ranked = rankResults(race.racers.flatMap((r) => (r.entry ? [r.entry] : [])));
  race.phase = "done";
  race.againBy = now + AGAIN_WINDOW_MS;
  for (const r of race.racers) {
    const rows = ranked.map((e, n) => ({ place: n + 1, cc: e.cc, timeMs: e.timeMs, rings: e.rings, you: e.token === r.token }));
    send(out, r.pilot, { t: "rresults", race: race.id, rows, againBy: race.againBy, now });
  }
}

/** Rule 14: who said again (and is still here) goes straight to a new grid; the old race goes. */
function raceAgain(room: RaceRoom, race: Race, now: number, out: Outgoing[]) {
  removeRace(room, race);
  const keep = race.racers.filter((r) => r.again && r.pilot !== null);
  if (keep.length === 0) return;
  // Tokens carry over: rgrid has none, so the clients keep the one they hold.
  const next = newRace(keep.length >= 2 ? "private" : "solo", null, now);
  next.racers = keep.map((r) => newRacer(r.pilot!, r.cc, r.token));
  room.races.push(next);
  toGrid(next, now, out);
}

/** A pilot leaving its race: out of a lobby; otherwise unbound (rejoin and upload by token). */
function leaveRaces(room: RaceRoom, pilot: string, now: number, out: Outgoing[]) {
  for (const race of [...room.races]) {
    const racer = race.racers.find((r) => r.pilot === pilot);
    if (!racer) continue;
    if (race.phase === "lobby") removeFromLobby(room, race, racer, now, out);
    else {
      racer.pilot = null;
      maybeEnd(race, now, out);
    }
  }
}

// ---- messages --------------------------------------------------------------

async function join(room: RaceRoom, pilot: string, cc: string | null, m: { code?: string; token?: string }, ctx: RaceCtx): Promise<RaceOut> {
  const out: Outgoing[] = [];
  if (m.token !== undefined) {
    let found: { race: Race; racer: Racer } | null = null;
    for (const race of room.races) {
      if (race.phase === "done") continue;
      const racer = race.racers.find((r) => r.token === m.token);
      if (racer) { found = { race, racer }; break; }
    }
    if (!found) return err(pilot, "expired");
    const { race, racer } = found;
    if (racer.pilot !== pilot) {
      if (racer.pilot !== null && ctx.pilotIds().includes(racer.pilot)) return err(pilot, "busy");
      if (bound(room, pilot)) return { out };
      unbindDone(room, pilot);
      racer.pilot = pilot;
    }
    await resend(race, racer, ctx.secret!, ctx.now, out);
    return { out };
  }
  if (bound(room, pilot)) return { out };
  let race: Race | undefined;
  if (m.code !== undefined) {
    race = room.races.find((r) => r.phase === "lobby" && r.kind === "private" && r.code === m.code);
    if (!race) return err(pilot, "expired");
  } else {
    race = room.races.find((r) => r.phase === "lobby" && r.kind === "public");
  }
  if (race && race.racers.length >= RACE_MAX_PILOTS) return err(pilot, "full");
  if (!race) {
    race = newRace("public", null, ctx.now);
    room.races.push(race);
  }
  unbindDone(room, pilot);
  addToLobby(room, race, newRacer(pilot, cc), ctx, out);
  return { out };
}

function invite(room: RaceRoom, pilot: string, cc: string | null, now: number): RaceOut {
  const out: Outgoing[] = [];
  const b = bound(room, pilot);
  if (b && !(b.race.phase === "lobby" && b.race.kind === "public")) return { out };
  let racer: Racer;
  if (b) {
    removeFromLobby(room, b.race, b.racer, now, out);
    racer = { ...b.racer, slot: 0 };
  } else {
    unbindDone(room, pilot);
    racer = newRacer(pilot, cc);
  }
  const race = newRace("private", uniqueCode(room), now);
  race.host = racer.token;
  race.racers.push(racer);
  room.races.push(race);
  send(out, pilot, lobbyMsg(race, racer, now));
  return { out };
}

async function ringClaim(room: RaceRoom, pilot: string, i: number, ctx: RaceCtx): Promise<RaceOut> {
  const now = ctx.now;
  const b = bound(room, pilot);
  const out: Outgoing[] = [];
  // A late alarm must not let a ring (or a finish) in past the final call or the limit: end the race first.
  if (b) maybeEnd(b.race, now, out);
  const refuse = (): RaceOut => ({ out: [...out, { to: pilot, msg: { t: "rerr", reason: "ring" } }] });
  if (!b || b.race.phase !== "running") return refuse();
  const { race, racer } = b;
  if (i !== racer.next || i > N) return err(pilot, "ring");
  const pose = ctx.poseOf(pilot);
  if (!pose || now - pose.at > POSE_FRESH_MS) return err(pilot, "ring");
  const [gx, gy, gz] = RACE_CENTRES[i % N];
  if (Math.hypot(pose.p[0] - gx, pose.p[1] - gy, pose.p[2] - gz) > RING_RADIUS + STAMP_POS_MARGIN) return err(pilot, "ring");
  if (!legBelievable(RACE_CENTRES, i - 1, i, now - racer.lastAt)) return err(pilot, "ring");

  const stamp = await signStamp(ctx.secret!, { r: race.id, k: racer.token, i, at: now });
  // Check, await, set: another claim (or a leave or tick) may have run during the await.
  if (race.phase !== "running" || racer.next !== i || racer.pilot !== pilot) return err(pilot, "ring");
  racer.next = i + 1;
  racer.lastAt = now;
  send(out, pilot, { t: "rstamp", stamp });
  if (i === N) {
    racer.finished = true;
    if (race.finalEndsAt === null) {
      race.finalEndsAt = now + FINAL_CALL_MS;
      for (const r of race.racers) send(out, r.pilot, { t: "rfinal", endsAt: race.finalEndsAt, now });
    }
    maybeEnd(race, now, out);
  }
  return { out };
}

export async function onRaceMessage(room: RaceRoom, pilot: string, cc: string | null, m: RaceClientMessage, ctx: RaceCtx): Promise<RaceOut> {
  if (ctx.secret === null) return err(pilot, "off");
  const out: Outgoing[] = [];
  switch (m.t) {
    case "rjoin":
      return join(room, pilot, cc, m, ctx);
    case "rinvite":
      return invite(room, pilot, cc, ctx.now);
    case "rstart": {
      const b = bound(room, pilot);
      if (b && b.race.phase === "lobby" && b.race.kind === "private" && b.race.host === b.racer.token
        && b.race.racers.length >= RACE_MIN_PILOTS) toGrid(b.race, ctx.now, out);
      return { out };
    }
    case "rsolo": {
      const b = bound(room, pilot);
      if (b && b.race.phase === "lobby" && b.race.racers.length === 1) {
        b.race.kind = "solo";
        toGrid(b.race, ctx.now, out);
      }
      return { out };
    }
    case "rleave":
      leaveRaces(room, pilot, ctx.now, out);
      return { out };
    case "rring":
      return ringClaim(room, pilot, m.i, ctx);
    case "ragain": {
      for (const race of room.races) {
        if (race.phase !== "done") continue;
        const racer = race.racers.find((r) => r.pilot === pilot);
        if (racer) racer.again = true;
      }
      return { out };
    }
  }
}

export function onRacePilotLeft(room: RaceRoom, pilot: string, ctx: RaceCtx): RaceOut {
  const out: Outgoing[] = [];
  leaveRaces(room, pilot, ctx.now, out);
  return { out };
}

export async function onRaceTick(room: RaceRoom, ctx: RaceCtx): Promise<RaceOut> {
  const now = ctx.now;
  const out: Outgoing[] = [];
  if (ctx.secret === null) {
    // The secret went away mid-race: nothing can be signed or checked, so racing closes.
    for (const race of room.races) for (const r of race.racers) send(out, r.pilot, { t: "rerr", reason: "off" });
    room.races = [];
    return { out };
  }
  for (const race of [...room.races]) {
    switch (race.phase) {
      case "lobby":
        if (race.kind === "private") {
          if (race.createdAt + INVITE_TTL_MS <= now) {
            removeRace(room, race);
            for (const r of race.racers) send(out, r.pilot, { t: "rerr", reason: "expired" });
          }
        } else if (race.racers.length >= 2 && race.startsAt !== null && race.startsAt <= now) {
          toGrid(race, now, out);
        } else if (race.racers.length === 1 && race.aloneSince !== null && race.aloneSince + ALONE_MS <= now) {
          race.kind = "solo";
          toGrid(race, now, out);
        }
        break;
      case "grid":
        if (race.goAt! <= now) await go(race, ctx.secret, now, out);
        break;
      case "running":
        maybeEnd(race, now, out);
        break;
      case "upload":
        if (race.uploadBy! <= now) results(race, now, out);
        break;
      case "done":
        if (race.againBy! <= now) raceAgain(room, race, now, out);
        break;
    }
  }
  return { out };
}

/** The upload body's shape: { race, token, stamps, ghost? }, or null. */
function parseUpload(body: unknown): { race: string; token: string; stamps: Stamp[]; ghost?: string } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  if (typeof o.race !== "string" || !RACE_ID_RE.test(o.race)) return null;
  if (typeof o.token !== "string" || !HEX32.test(o.token)) return null;
  if (!Array.isArray(o.stamps)) return null;
  if (o.ghost !== undefined && typeof o.ghost !== "string") return null;
  const stamps: Stamp[] = [];
  for (const v of o.stamps) {
    const s = parseStamp(v);
    if (!s) return null;
    stamps.push(s);
  }
  return o.ghost === undefined ? { race: o.race, token: o.token, stamps } : { race: o.race, token: o.token, stamps, ghost: o.ghost };
}

export async function onRaceUpload(room: RaceRoom, body: unknown, ctx: RaceCtx): Promise<UploadResult> {
  if (ctx.secret === null) return { status: 400, reason: "off" };
  const b = parseUpload(body);
  if (!b) return { status: 400, reason: "malformed" };
  const race = room.races.find((r) => r.id === b.race);
  if (!race) return { status: 404, reason: "race" };
  const racer = race.racers.find((r) => r.token === b.token);
  if (!racer) return { status: 404, reason: "token" };
  if (race.phase !== "upload") return { status: 409, reason: "phase" };
  if (ctx.now > race.uploadBy!) return { status: 409, reason: "late" };
  if (racer.entry) return { status: 409, reason: "duplicate" };
  const lap = await checkLap(ctx.secret, race.id, racer.token, b.stamps, RACE_CENTRES);
  if (!lap.ok) return { status: 400, reason: lap.reason };
  // Check, await, set: a second upload for this token, or the results tick, may have run during the await.
  if (race.phase !== "upload") return { status: 409, reason: "phase" };
  if (ctx.now > race.uploadBy!) return { status: 409, reason: "late" };
  if (racer.entry) return { status: 409, reason: "duplicate" };
  const entry: ResultEntry = { token: racer.token, cc: racer.cc, timeMs: lap.timeMs, rings: lap.rings, lastAt: lap.lastAt };
  racer.entry = entry;
  return { status: 200, entry, race };
}

/** The earliest deadline onRaceTick acts on, or null: the adapter's next alarm. */
export function nextAlarm(room: RaceRoom): number | null {
  let at: number | null = null;
  const take = (t: number | null) => { if (t !== null && (at === null || t < at)) at = t; };
  for (const race of room.races) {
    switch (race.phase) {
      case "lobby":
        if (race.kind === "private") take(race.createdAt + INVITE_TTL_MS);
        else if (race.racers.length >= 2) take(race.startsAt);
        else if (race.racers.length === 1 && race.aloneSince !== null) take(race.aloneSince + ALONE_MS);
        break;
      case "grid": take(race.goAt); break;
      case "running":
        take(race.goAt! + RACE_LIMIT_MS);
        take(race.finalEndsAt);
        break;
      case "upload": take(race.uploadBy); break;
      case "done": take(race.againBy); break;
    }
  }
  return at;
}
