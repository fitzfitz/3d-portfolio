import { describe, expect, it } from "vitest";
import {
  newRaceRoom, nextAlarm, onRaceMessage, onRacePilotLeft, onRaceTick, onRaceUpload,
  type Race, type RaceCtx, type RaceRoom,
} from "../beacon-api/src/raceRoom";
import type { Outgoing } from "../beacon-api/src/sky";
import {
  AGAIN_WINDOW_MS, ALONE_MS, FINAL_CALL_MS, GRID_MS, INVITE_TTL_MS, LOBBY_COUNTDOWN_MS, POSE_FRESH_MS, RACE_LIMIT_MS,
  RACE_MAX_PILOTS, RACE_SPEED, STAMP_POS_MARGIN, UPLOAD_WINDOW_MS, WAIT_SHOUT_MS, isInviteCode, verifyStamp,
  type RaceClientMessage, type RaceServerMessage, type Stamp,
} from "../src/utils/raceProtocol";
import { RACE_CENTRES, RING_RADIUS } from "../src/data/ringCourse";

const SECRET = "s".repeat(32);
const N = RACE_CENTRES.length;
const T0 = 1_000_000;
type Vec = [number, number, number];

const gate = (i: number): Vec => [...RACE_CENTRES[i % N]] as Vec;
const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** The quickest believable time from ring i-1 to ring i, rounded up (ms). */
const legMs = (i: number) => Math.ceil((Math.max(0, dist(gate(i - 1), gate(i)) - 2 * RING_RADIUS) / RACE_SPEED) * 1000);

/** A fake world: the clock, the connected pilots and their last poses. */
function world() {
  const poses = new Map<string, { p: Vec; at: number }>();
  const online = new Set<string>();
  const ctx: RaceCtx = {
    now: T0, secret: SECRET,
    poseOf: (id) => poses.get(id) ?? null,
    pilotIds: () => [...online],
  };
  return {
    ctx, poses, online,
    /** The pilot's pose arrives now, at gate i's centre (or offset from it). */
    at(pilot: string, i: number, offset: Vec = [0, 0, 0]) {
      const g = gate(i);
      poses.set(pilot, { p: [g[0] + offset[0], g[1] + offset[1], g[2] + offset[2]], at: ctx.now });
    },
  };
}
type World = ReturnType<typeof world>;

const to = (out: Outgoing[], id: string) => out.filter((o) => o.to === id).map((o) => o.msg as RaceServerMessage);
const types = (out: Outgoing[], id: string) => to(out, id).map((m) => m.t);
function one<T extends RaceServerMessage["t"]>(out: Outgoing[], id: string, t: T): Extract<RaceServerMessage, { t: T }> {
  const ms = to(out, id).filter((m) => m.t === t);
  if (ms.length !== 1) throw new Error(`${id}: expected one ${t}, got ${JSON.stringify(to(out, id))}`);
  return ms[0] as Extract<RaceServerMessage, { t: T }>;
}

async function send(room: RaceRoom, w: World, pilot: string, m: RaceClientMessage, cc: string | null = "ID") {
  w.online.add(pilot);
  return (await onRaceMessage(room, pilot, cc, m, w.ctx)).out;
}
async function tick(room: RaceRoom, w: World, at: number) {
  w.ctx.now = at;
  return (await onRaceTick(room, w.ctx)).out;
}
function leave(room: RaceRoom, w: World, pilot: string) {
  w.online.delete(pilot);
  return onRacePilotLeft(room, pilot, w.ctx).out;
}
/** Fly to ring i: the pose arrives at the gate centre now, then the claim. */
async function ring(room: RaceRoom, w: World, pilot: string, i: number) {
  w.at(pilot, i);
  return send(room, w, pilot, { t: "rring", i });
}
const raceOf = (room: RaceRoom, pilot: string) => room.races.find((r) => r.racers.some((x) => x.pilot === pilot));

/** Public lobby → grid → GO with these pilots. Returns their tokens and GO stamps. */
async function running(pilots: string[]) {
  const room = newRaceRoom();
  const w = world();
  const tokens: Record<string, string> = {};
  for (const p of pilots) {
    const out = await send(room, w, p, { t: "rjoin" });
    tokens[p] = one(out, p, "rlobby").token;
  }
  if (pilots.length === 1) await send(room, w, pilots[0], { t: "rsolo" });
  else await tick(room, w, raceOf(room, pilots[0])!.startsAt!);
  const race = raceOf(room, pilots[0])!;
  const go = await tick(room, w, race.goAt!);
  const starts: Record<string, Stamp> = {};
  for (const p of pilots) starts[p] = one(go, p, "rgo").stamp;
  return { room, w, race, tokens, starts, goAt: race.goAt! };
}

/** Every pilot flies the whole lap; each leg takes the quickest time plus that pilot's extra. Events run in time order. */
async function flyLaps(room: RaceRoom, w: World, goAt: number, extraMs: Record<string, number>) {
  const events: { at: number; pilot: string; i: number }[] = [];
  for (const [pilot, extra] of Object.entries(extraMs)) {
    let t = goAt;
    for (let i = 1; i <= N; i++) { t += legMs(i) + extra; events.push({ at: t, pilot, i }); }
  }
  events.sort((a, b) => a.at - b.at);
  const stamps: Record<string, Stamp[]> = {};
  const log: { at: number; pilot: string; out: Outgoing[] }[] = [];
  for (const e of events) {
    w.ctx.now = e.at;
    const out = await ring(room, w, e.pilot, e.i);
    log.push({ at: e.at, pilot: e.pilot, out });
    const s = to(out, e.pilot).find((m) => m.t === "rstamp");
    if (s?.t === "rstamp") (stamps[e.pilot] ??= []).push(s.stamp);
  }
  return { stamps, log };
}

// ---------------------------------------------------------------------------

describe("rule 1: no secret, no racing", () => {
  it("answers every race message with rerr off", async () => {
    const room = newRaceRoom();
    const w = world();
    w.ctx.secret = null;
    for (const m of [{ t: "rjoin" }, { t: "rinvite" }, { t: "rring", i: 1 }, { t: "rleave" }] as RaceClientMessage[]) {
      expect(await send(room, w, "a", m)).toEqual([{ to: "a", msg: { t: "rerr", reason: "off" } }]);
    }
    expect(room.races).toEqual([]);
  });
  it("refuses uploads with 400 off", async () => {
    const { room, w, race, tokens, starts } = await running(["a", "b"]);
    w.ctx.secret = null;
    expect(await onRaceUpload(room, { race: race.id, token: tokens.a, stamps: [starts.a] }, w.ctx)).toEqual({ status: 400, reason: "off" });
  });
  it("a tick without the secret closes every race (fails closed)", async () => {
    const { room, w } = await running(["a", "b"]);
    w.ctx.secret = null;
    const out = await tick(room, w, w.ctx.now + 1);
    expect(to(out, "a")).toEqual([{ t: "rerr", reason: "off" }]);
    expect(room.races).toEqual([]);
    expect(nextAlarm(room)).toBeNull();
  });
});

describe("rule 2: rjoin, the public lobby", () => {
  it("creates a public lobby and sends rlobby with the racer's own token", async () => {
    const room = newRaceRoom();
    const w = world();
    const out = await send(room, w, "a", { t: "rjoin" });
    const m = one(out, "a", "rlobby");
    expect(m).toMatchObject({ kind: "public", code: null, host: false, pilots: [{ cc: "ID", you: true }], startsAt: null, now: T0 });
    expect(m.token).toMatch(/^[0-9a-f]{32}$/);
    expect(m.race).toMatch(/^[A-Za-z0-9-]{1,64}$/);
    expect(room.races).toHaveLength(1);
    expect(room.races[0].aloneSince).toBe(T0);
  });
  it("the second racer joins the same lobby, starts the countdown and both get rlobby", async () => {
    const room = newRaceRoom();
    const w = world();
    const a = one(await send(room, w, "a", { t: "rjoin" }), "a", "rlobby");
    w.ctx.now = T0 + 500;
    const out = await send(room, w, "b", { t: "rjoin" }, "FR");
    const la = one(out, "a", "rlobby"), lb = one(out, "b", "rlobby");
    expect(la.race).toBe(lb.race);
    expect(la.token).toBe(a.token);
    expect(lb.token).not.toBe(a.token);
    expect(la.pilots).toEqual([{ cc: "ID", you: true }, { cc: "FR", you: false }]);
    expect(lb.pilots).toEqual([{ cc: "ID", you: false }, { cc: "FR", you: true }]);
    expect(la.startsAt).toBe(T0 + 500 + LOBBY_COUNTDOWN_MS);
    expect(lb.now).toBe(T0 + 500);
    expect(room.races).toHaveLength(1);
  });
  it("a third racer leaves the countdown where it is", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "a", { t: "rjoin" });
    await send(room, w, "b", { t: "rjoin" });
    w.ctx.now = T0 + 4000;
    await send(room, w, "c", { t: "rjoin" });
    expect(room.races[0].startsAt).toBe(T0 + LOBBY_COUNTDOWN_MS);
  });
  it("ignores a pilot already in a race", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "a", { t: "rjoin" });
    expect(await send(room, w, "a", { t: "rjoin" })).toEqual([]);
    expect(room.races[0].racers).toHaveLength(1);
  });
  it("turns the 9th racer away with rerr full", async () => {
    const room = newRaceRoom();
    const w = world();
    for (let n = 0; n < RACE_MAX_PILOTS; n++) await send(room, w, `p${n}`, { t: "rjoin" });
    expect(await send(room, w, "late", { t: "rjoin" })).toEqual([{ to: "late", msg: { t: "rerr", reason: "full" } }]);
    expect(room.races[0].racers).toHaveLength(RACE_MAX_PILOTS);
  });
  it("dropping back to one racer clears the countdown and starts the alone clock", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "a", { t: "rjoin" });
    await send(room, w, "b", { t: "rjoin" });
    w.ctx.now = T0 + 7000;
    const out = leave(room, w, "b");
    expect(room.races[0].startsAt).toBeNull();
    expect(room.races[0].aloneSince).toBe(T0 + 7000);
    expect(one(out, "a", "rlobby")).toMatchObject({ startsAt: null, pilots: [{ cc: "ID", you: true }] });
  });
  it("the first racer shouts rwait to every pilot outside the race, at most once a minute", async () => {
    const room = newRaceRoom();
    const w = world();
    w.online.add("x");
    w.online.add("y");
    const out = await send(room, w, "a", { t: "rjoin" }, "JP");
    expect(to(out, "x")).toEqual([{ t: "rwait", cc: "JP" }]);
    expect(to(out, "y")).toEqual([{ t: "rwait", cc: "JP" }]);
    expect(types(out, "a")).toEqual(["rlobby"]);
    expect(room.lastWaitAt).toBe(T0);
    // a leaves; a new lone racer inside the minute: no shout.
    leave(room, w, "a");
    w.ctx.now = T0 + WAIT_SHOUT_MS - 1;
    expect(to(await send(room, w, "b", { t: "rjoin" }), "x")).toEqual([]);
    leave(room, w, "b");
    w.ctx.now = T0 + WAIT_SHOUT_MS;
    expect(to(await send(room, w, "c", { t: "rjoin" }), "x")).toEqual([{ t: "rwait", cc: "ID" }]);
  });
  it("a second racer does not shout", async () => {
    const room = newRaceRoom();
    const w = world();
    w.online.add("x");
    await send(room, w, "a", { t: "rjoin" });
    w.ctx.now = T0 + WAIT_SHOUT_MS * 2;
    expect(to(await send(room, w, "b", { t: "rjoin" }), "x")).toEqual([]);
  });
});

describe("rule 3: rjoin with a code", () => {
  it("joins the private lobby with that code, without a countdown", async () => {
    const room = newRaceRoom();
    const w = world();
    const code = one(await send(room, w, "host", { t: "rinvite" }), "host", "rlobby").code!;
    const out = await send(room, w, "friend", { t: "rjoin", code }, "FR");
    const m = one(out, "friend", "rlobby");
    expect(m).toMatchObject({ kind: "private", code, host: false, startsAt: null, pilots: [{ cc: "ID", you: false }, { cc: "FR", you: true }] });
    expect(one(out, "host", "rlobby")).toMatchObject({ host: true, pilots: [{ cc: "ID", you: true }, { cc: "FR", you: false }] });
    expect(nextAlarm(room)).toBe(T0 + INVITE_TTL_MS);
  });
  it("answers an unknown code with rerr expired", async () => {
    const room = newRaceRoom();
    const w = world();
    expect(await send(room, w, "a", { t: "rjoin", code: "ABCDEF" })).toEqual([{ to: "a", msg: { t: "rerr", reason: "expired" } }]);
    expect(room.races).toEqual([]);
  });
  it("a started private race's code is expired", async () => {
    const room = newRaceRoom();
    const w = world();
    const code = one(await send(room, w, "h", { t: "rinvite" }), "h", "rlobby").code!;
    await send(room, w, "f", { t: "rjoin", code });
    await send(room, w, "h", { t: "rstart" });
    expect(to(await send(room, w, "late", { t: "rjoin", code }), "late")).toEqual([{ t: "rerr", reason: "expired" }]);
  });
  it("a full private lobby answers rerr full", async () => {
    const room = newRaceRoom();
    const w = world();
    const code = one(await send(room, w, "h", { t: "rinvite" }), "h", "rlobby").code!;
    for (let n = 1; n < RACE_MAX_PILOTS; n++) await send(room, w, `f${n}`, { t: "rjoin", code });
    expect(to(await send(room, w, "late", { t: "rjoin", code }), "late")).toEqual([{ t: "rerr", reason: "full" }]);
  });
});

describe("rule 4: rjoin with a token", () => {
  it("rebinds a lobby racer whose pilot is gone and resends rlobby", async () => {
    const room = newRaceRoom();
    const w = world();
    const code = one(await send(room, w, "h", { t: "rinvite" }), "h", "rlobby").code!;
    const tok = one(await send(room, w, "f", { t: "rjoin", code }), "f", "rlobby").token;
    // f's socket drops without a leave reaching the room (e.g. the adapter woke later).
    w.online.delete("f");
    const out = await send(room, w, "f2", { t: "rjoin", token: tok });
    expect(one(out, "f2", "rlobby")).toMatchObject({ token: tok, pilots: [{ cc: "ID", you: false }, { cc: "ID", you: true }] });
    expect(room.races[0].racers[1].pilot).toBe("f2");
  });
  it("rebinds in grid and resends rgrid", async () => {
    const room = newRaceRoom();
    const w = world();
    const tok = one(await send(room, w, "a", { t: "rjoin" }), "a", "rlobby").token;
    await send(room, w, "b", { t: "rjoin" });
    await tick(room, w, T0 + LOBBY_COUNTDOWN_MS);
    leave(room, w, "a");
    w.ctx.now += 1000;
    const out = await send(room, w, "a2", { t: "rjoin", token: tok });
    expect(to(out, "a2")).toEqual([{ t: "rgrid", race: room.races[0].id, kind: "public", slot: 0, goAt: T0 + LOBBY_COUNTDOWN_MS + GRID_MS, now: w.ctx.now }]);
  });
  it("rebinds in running and resends the same rgo stamp, plus rfinal once it is set", async () => {
    // Three racers, so c (still flying) keeps the race running after a finishes and b drops.
    const { room, w, race, tokens, starts, goAt } = await running(["a", "b", "c"]);
    await flyLaps(room, w, goAt, { a: 100 });
    expect(race.finalEndsAt).not.toBeNull();
    leave(room, w, "b");
    const out = await send(room, w, "b2", { t: "rjoin", token: tokens.b });
    expect(to(out, "b2")).toEqual([
      { t: "rgo", stamp: starts.b, now: w.ctx.now },
      { t: "rfinal", endsAt: race.finalEndsAt, now: w.ctx.now },
    ]);
    expect(race.racers[1].pilot).toBe("b2");
  });
  it("rebinds in upload and resends rover", async () => {
    const r = await running(["a"]);
    await flyLaps(r.room, r.w, r.goAt, { a: 0 });
    expect(r.race.phase).toBe("upload");
    leave(r.room, r.w, "a");
    const out = await send(r.room, r.w, "a2", { t: "rjoin", token: r.tokens.a });
    expect(to(out, "a2")).toEqual([{ t: "rover", race: r.race.id, uploadBy: r.race.uploadBy, now: r.w.ctx.now }]);
  });
  it("refuses a token still bound to a connected pilot with rerr busy", async () => {
    const { room, w, tokens } = await running(["a", "b"]);
    expect(await send(room, w, "tab2", { t: "rjoin", token: tokens.a })).toEqual([{ to: "tab2", msg: { t: "rerr", reason: "busy" } }]);
    expect(raceOf(room, "a")!.racers[0].pilot).toBe("a");
  });
  it("the same pilot rejoining its own token just gets the phase message again", async () => {
    const { room, w, tokens, starts } = await running(["a", "b"]);
    expect(to(await send(room, w, "a", { t: "rjoin", token: tokens.a }), "a")).toEqual([{ t: "rgo", stamp: starts.a, now: w.ctx.now }]);
  });
  it("an unknown or finished race's token gets rerr expired", async () => {
    const room = newRaceRoom();
    const w = world();
    expect(await send(room, w, "a", { t: "rjoin", token: "c".repeat(32) })).toEqual([{ to: "a", msg: { t: "rerr", reason: "expired" } }]);
  });
});

describe("rule 5: rinvite", () => {
  it("from no race: a new private lobby with a code, the pilot as host", async () => {
    const room = newRaceRoom();
    const w = world();
    w.online.add("x");
    const out = await send(room, w, "a", { t: "rinvite" });
    const m = one(out, "a", "rlobby");
    expect(isInviteCode(m.code)).toBe(true);
    expect(m).toMatchObject({ kind: "private", host: true, startsAt: null, pilots: [{ cc: "ID", you: true }] });
    expect(room.races[0]).toMatchObject({ kind: "private", code: m.code, host: m.token, aloneSince: null });
    expect(to(out, "x")).toEqual([]); // private lobbies never shout
  });
  it("from a public lobby: moves the racer, and the lobby left behind is told", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "a", { t: "rjoin" });
    await send(room, w, "b", { t: "rjoin" });
    w.ctx.now = T0 + 2000;
    const out = await send(room, w, "b", { t: "rinvite" });
    expect(one(out, "b", "rlobby")).toMatchObject({ kind: "private", host: true });
    expect(one(out, "a", "rlobby")).toMatchObject({ kind: "public", startsAt: null, pilots: [{ cc: "ID", you: true }] });
    expect(room.races).toHaveLength(2);
    expect(room.races.find((r) => r.kind === "public")!.aloneSince).toBe(T0 + 2000);
  });
  it("is ignored from a private lobby or a running race", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "a", { t: "rinvite" });
    expect(await send(room, w, "a", { t: "rinvite" })).toEqual([]);
    const r = await running(["a", "b"]);
    expect(await send(r.room, r.w, "a", { t: "rinvite" })).toEqual([]);
    expect(r.room.races).toHaveLength(1);
  });
});

describe("rule 6: rstart", () => {
  async function invited(friends: number) {
    const room = newRaceRoom();
    const w = world();
    const code = one(await send(room, w, "h", { t: "rinvite" }), "h", "rlobby").code!;
    for (let n = 0; n < friends; n++) await send(room, w, `f${n}`, { t: "rjoin", code });
    return { room, w };
  }
  it("the host of a private lobby with 2+ racers starts the grid", async () => {
    const { room, w } = await invited(1);
    const out = await send(room, w, "h", { t: "rstart" });
    expect(one(out, "h", "rgrid")).toMatchObject({ kind: "private", slot: 0, goAt: T0 + GRID_MS });
    expect(one(out, "f0", "rgrid")).toMatchObject({ slot: 1 });
  });
  it("is ignored from a non-host, or with one racer", async () => {
    const two = await invited(1);
    expect(await send(two.room, two.w, "f0", { t: "rstart" })).toEqual([]);
    const alone = await invited(0);
    expect(await send(alone.room, alone.w, "h", { t: "rstart" })).toEqual([]);
    expect(alone.room.races[0].phase).toBe("lobby");
  });
  it("is ignored in a public lobby", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "a", { t: "rjoin" });
    await send(room, w, "b", { t: "rjoin" });
    expect(await send(room, w, "a", { t: "rstart" })).toEqual([]);
  });
});

describe("rule 7: rsolo", () => {
  it("a lone racer goes to a solo grid at once", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "a", { t: "rjoin" });
    const out = await send(room, w, "a", { t: "rsolo" });
    expect(one(out, "a", "rgrid")).toMatchObject({ kind: "solo", slot: 0, goAt: T0 + GRID_MS, now: T0 });
    expect(room.races[0].kind).toBe("solo");
  });
  it("is ignored with two racers", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "a", { t: "rjoin" });
    await send(room, w, "b", { t: "rjoin" });
    expect(await send(room, w, "a", { t: "rsolo" })).toEqual([]);
    expect(room.races[0].phase).toBe("lobby");
  });
});

describe("rule 8: lobby ticks", () => {
  it("a public lobby goes to grid when the countdown ends", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "a", { t: "rjoin" });
    await send(room, w, "b", { t: "rjoin" });
    expect(await tick(room, w, T0 + LOBBY_COUNTDOWN_MS - 1)).toEqual([]);
    const out = await tick(room, w, T0 + LOBBY_COUNTDOWN_MS);
    expect(types(out, "a")).toEqual(["rgrid"]);
    expect(room.races[0]).toMatchObject({ phase: "grid", kind: "public" });
  });
  it("a lone public racer races the best lap after ALONE_MS", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "a", { t: "rjoin" });
    expect(await tick(room, w, T0 + ALONE_MS - 1)).toEqual([]);
    const out = await tick(room, w, T0 + ALONE_MS);
    expect(one(out, "a", "rgrid")).toMatchObject({ kind: "solo", goAt: T0 + ALONE_MS + GRID_MS });
  });
  it("a private lobby is never solo'd by the alone clock", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "h", { t: "rinvite" });
    expect(await tick(room, w, T0 + ALONE_MS * 2)).toEqual([]);
    expect(room.races[0].phase).toBe("lobby");
  });
  it("an unstarted private lobby expires after INVITE_TTL_MS and its racers get rerr expired", async () => {
    const room = newRaceRoom();
    const w = world();
    const code = one(await send(room, w, "h", { t: "rinvite" }), "h", "rlobby").code!;
    await send(room, w, "f", { t: "rjoin", code });
    expect(await tick(room, w, T0 + INVITE_TTL_MS - 1)).toEqual([]);
    const out = await tick(room, w, T0 + INVITE_TTL_MS);
    expect(to(out, "h")).toEqual([{ t: "rerr", reason: "expired" }]);
    expect(to(out, "f")).toEqual([{ t: "rerr", reason: "expired" }]);
    expect(room.races).toEqual([]);
  });
});

describe("rule 9: grid and GO", () => {
  it("slots in join order, then rgo with a verifiable GO stamp at goAt", async () => {
    const room = newRaceRoom();
    const w = world();
    const toks = [];
    for (const p of ["a", "b", "c"]) toks.push(one(await send(room, w, p, { t: "rjoin" }), p, "rlobby").token);
    const grid = await tick(room, w, T0 + LOBBY_COUNTDOWN_MS);
    const goAt = T0 + LOBBY_COUNTDOWN_MS + GRID_MS;
    expect(["a", "b", "c"].map((p) => one(grid, p, "rgrid").slot)).toEqual([0, 1, 2]);
    expect(one(grid, "c", "rgrid")).toEqual({ t: "rgrid", race: room.races[0].id, kind: "public", slot: 2, goAt, now: T0 + LOBBY_COUNTDOWN_MS });
    expect(await tick(room, w, goAt - 1)).toEqual([]);
    const go = await tick(room, w, goAt);
    for (const [n, p] of ["a", "b", "c"].entries()) {
      const m = one(go, p, "rgo");
      expect(m.now).toBe(goAt);
      expect(m.stamp).toMatchObject({ r: room.races[0].id, k: toks[n], i: 0, at: goAt });
      expect(await verifyStamp(SECRET, m.stamp)).toBe(true);
    }
    expect(room.races[0].phase).toBe("running");
    expect(room.races[0].racers.map((r) => [r.next, r.lastAt])).toEqual([[1, goAt], [1, goAt], [1, goAt]]);
  });
});

describe("rule 10: rring", () => {
  it("signs the next ring at a believable time and place", async () => {
    const { room, w, tokens, goAt, race } = await running(["a", "b"]);
    w.ctx.now = goAt + legMs(1);
    const out = await ring(room, w, "a", 1);
    const m = one(out, "a", "rstamp");
    expect(m.stamp).toMatchObject({ r: race.id, k: tokens.a, i: 1, at: goAt + legMs(1) });
    expect(await verifyStamp(SECRET, m.stamp)).toBe(true);
    expect(to(out, "b")).toEqual([]);
    expect(race.racers[0]).toMatchObject({ next: 2, lastAt: goAt + legMs(1) });
  });
  it("refuses a ring out of order", async () => {
    const { room, w, goAt } = await running(["a", "b"]);
    w.ctx.now = goAt + 60_000;
    expect(await ring(room, w, "a", 2)).toEqual([{ to: "a", msg: { t: "rerr", reason: "ring" } }]);
    expect(await ring(room, w, "a", 0)).toEqual([{ to: "a", msg: { t: "rerr", reason: "ring" } }]);
  });
  it("refuses a ring faster than warp allows, then signs it once believable", async () => {
    const { room, w, goAt } = await running(["a", "b"]);
    w.ctx.now = goAt + 1000;
    expect(types(await ring(room, w, "a", 1), "a")).toEqual(["rerr"]);
    w.ctx.now = goAt + legMs(1);
    expect(types(await ring(room, w, "a", 1), "a")).toEqual(["rstamp"]);
  });
  it("refuses with no pose, a stale pose, or a pose too far from the ring", async () => {
    const { room, w, goAt } = await running(["a", "b"]);
    w.ctx.now = goAt + 60_000;
    expect(types(await send(room, w, "a", { t: "rring", i: 1 }), "a")).toEqual(["rerr"]);
    w.at("a", 1);
    w.ctx.now += POSE_FRESH_MS + 1;
    expect(types(await send(room, w, "a", { t: "rring", i: 1 }), "a")).toEqual(["rerr"]);
    w.at("a", 1, [RING_RADIUS + STAMP_POS_MARGIN + 1, 0, 0]);
    expect(types(await send(room, w, "a", { t: "rring", i: 1 }), "a")).toEqual(["rerr"]);
    w.at("a", 1, [RING_RADIUS + STAMP_POS_MARGIN - 1, 0, 0]);
    expect(types(await send(room, w, "a", { t: "rring", i: 1 }), "a")).toEqual(["rstamp"]);
  });
  it("refuses outside a running race", async () => {
    const room = newRaceRoom();
    const w = world();
    expect(types(await ring(room, w, "a", 1), "a")).toEqual(["rerr"]);
    await send(room, w, "a", { t: "rjoin" });
    expect(types(await ring(room, w, "a", 1), "a")).toEqual(["rerr"]);
  });
  it("the first finish sets the final call and sends rfinal to every racer", async () => {
    const { room, w, goAt, race } = await running(["a", "b", "c"]);
    const { log } = await flyLaps(room, w, goAt, { a: 100 });
    const last = log[log.length - 1];
    expect(types(last.out, "a")).toEqual(["rstamp", "rfinal"]);
    for (const p of ["b", "c"]) expect(to(last.out, p)).toEqual([{ t: "rfinal", endsAt: last.at + FINAL_CALL_MS, now: last.at }]);
    expect(race).toMatchObject({ phase: "running", finalEndsAt: last.at + FINAL_CALL_MS });
    expect(race.racers[0].finished).toBe(true);
    expect(types(await ring(room, w, "a", N + 1), "a")).toEqual(["rerr"]);
  });
  it("a fake finish from the start gate right after GO is refused, with no rfinal", async () => {
    const { room, w, goAt, race } = await running(["a", "b"]);
    w.ctx.now = goAt + 50;
    const out = await ring(room, w, "a", N);
    expect(out).toEqual([{ to: "a", msg: { t: "rerr", reason: "ring" } }]);
    expect(race.finalEndsAt).toBeNull();
  });
});

describe("rule 11: the end of a race", () => {
  it("ends at the final call", async () => {
    const { room, w, goAt, race } = await running(["a", "b", "c"]);
    await flyLaps(room, w, goAt, { a: 0 });
    expect(await tick(room, w, race.finalEndsAt! - 1)).toEqual([]);
    const out = await tick(room, w, race.finalEndsAt!);
    for (const p of ["a", "b", "c"]) expect(to(out, p)).toEqual([{ t: "rover", race: race.id, uploadBy: w.ctx.now + UPLOAD_WINDOW_MS, now: w.ctx.now }]);
    expect(race).toMatchObject({ phase: "upload", uploadBy: w.ctx.now + UPLOAD_WINDOW_MS });
  });
  it("ends at the race limit", async () => {
    const { room, w, goAt, race } = await running(["a", "b"]);
    expect(nextAlarm(room)).toBe(goAt + RACE_LIMIT_MS);
    expect(await tick(room, w, goAt + RACE_LIMIT_MS - 1)).toEqual([]);
    expect(types(await tick(room, w, goAt + RACE_LIMIT_MS), "a")).toEqual(["rover"]);
    expect(race.phase).toBe("upload");
  });
  it("ends at once when every racer with a pilot has finished", async () => {
    const { room, w, goAt, race } = await running(["a", "b"]);
    const { log } = await flyLaps(room, w, goAt, { a: 100, b: 600 });
    const last = log[log.length - 1];
    expect(last.pilot).toBe("b");
    expect(types(last.out, "b")).toEqual(["rstamp", "rover"]);
    expect(types(last.out, "a")).toEqual(["rover"]);
    expect(race.phase).toBe("upload");
  });
  it("ends when the last unfinished racer leaves after someone finished", async () => {
    const { room, w, goAt, race } = await running(["a", "b"]);
    await flyLaps(room, w, goAt, { a: 0 });
    const out = leave(room, w, "b");
    expect(types(out, "a")).toEqual(["rover"]);
    expect(race.phase).toBe("upload");
  });
  it("R4: a race whose pilots all left does not end until the limit", async () => {
    const { room, w, goAt, race } = await running(["a", "b"]);
    leave(room, w, "a");
    leave(room, w, "b");
    expect(race.phase).toBe("running");
    expect(await tick(room, w, goAt + 60_000)).toEqual([]);
    expect(race.phase).toBe("running");
    await tick(room, w, goAt + RACE_LIMIT_MS);
    expect(race.phase).toBe("upload");
  });
});

describe("rule 12: uploads", () => {
  async function over() {
    const r = await running(["a", "b", "c"]);
    const { stamps } = await flyLaps(r.room, r.w, r.goAt, { a: 0 });
    await tick(r.room, r.w, r.race.finalEndsAt!);
    return { ...r, stamps: { a: [r.starts.a, ...stamps.a] } };
  }
  it("accepts a finished lap: 200 with the entry and the race", async () => {
    const { room, w, race, tokens, stamps } = await over();
    const res = await onRaceUpload(room, { race: race.id, token: tokens.a, stamps: stamps.a }, w.ctx);
    const time = stamps.a[N].at - stamps.a[0].at;
    expect(res.status).toBe(200);
    expect(res.entry).toEqual({ token: tokens.a, cc: "ID", timeMs: time, rings: N, lastAt: stamps.a[N].at });
    expect(res.race?.id).toBe(race.id);
    expect(race.racers[0].entry).toEqual(res.entry);
  });
  it("a racer whose pilot is gone still uploads a DNF by token", async () => {
    const { room, w, race, tokens, starts } = await over();
    leave(room, w, "b");
    const res = await onRaceUpload(room, { race: race.id, token: tokens.b, stamps: [starts.b] }, w.ctx);
    expect(res).toMatchObject({ status: 200, entry: { token: tokens.b, timeMs: null, rings: 0 } });
  });
  it("rejects a malformed body with 400", async () => {
    const { room, w, race, tokens, stamps } = await over();
    const base = { race: race.id, token: tokens.a, stamps: stamps.a };
    for (const body of [
      null, "x", [base], { ...base, race: "a|b" }, { ...base, race: 5 }, { ...base, token: "A".repeat(32) },
      { ...base, stamps: "nope" }, { ...base, stamps: { 0: stamps.a[0] } }, { ...base, stamps: [...stamps.a.slice(0, 2), { ...stamps.a[2], sig: "x" }] },
      { ...base, stamps: [{ ...stamps.a[0], at: "1" }] }, { ...base, ghost: 5 },
    ]) {
      expect((await onRaceUpload(room, body, w.ctx)).status, JSON.stringify(body)?.slice(0, 80)).toBe(400);
    }
    expect(race.racers[0].entry).toBeNull();
  });
  it("404 for an unknown race or a token not in it", async () => {
    const { room, w, race, tokens, stamps } = await over();
    expect((await onRaceUpload(room, { race: "nope", token: tokens.a, stamps: stamps.a }, w.ctx)).status).toBe(404);
    expect((await onRaceUpload(room, { race: race.id, token: "d".repeat(32), stamps: stamps.a }, w.ctx)).status).toBe(404);
  });
  it("409 before the upload phase, after uploadBy, and for a second upload", async () => {
    const r = await running(["a", "b"]);
    const early = await onRaceUpload(r.room, { race: r.race.id, token: r.tokens.a, stamps: [r.starts.a] }, r.w.ctx);
    expect(early.status).toBe(409);
    const { room, w, race, tokens, stamps, starts } = await over();
    expect((await onRaceUpload(room, { race: race.id, token: tokens.a, stamps: stamps.a }, w.ctx)).status).toBe(200);
    expect((await onRaceUpload(room, { race: race.id, token: tokens.a, stamps: stamps.a }, w.ctx)).status).toBe(409);
    w.ctx.now = race.uploadBy! + 1;
    expect((await onRaceUpload(room, { race: race.id, token: tokens.b, stamps: [starts.b] }, w.ctx)).status).toBe(409);
  });
  it("400 with checkLap's reason for a bad lap", async () => {
    const { room, w, race, tokens, stamps } = await over();
    const forged = stamps.a.map((s, n) => (n === 3 ? { ...s, sig: "0".repeat(32) } : s));
    expect(await onRaceUpload(room, { race: race.id, token: tokens.a, stamps: forged }, w.ctx)).toEqual({ status: 400, reason: "sig" });
    expect(await onRaceUpload(room, { race: race.id, token: tokens.b, stamps: stamps.a }, w.ctx)).toEqual({ status: 400, reason: "race" });
    expect(await onRaceUpload(room, { race: race.id, token: tokens.a, stamps: [] }, w.ctx)).toEqual({ status: 400, reason: "start" });
    expect(race.racers[0].entry).toBeNull();
  });
});

describe("rule 13: results", () => {
  it("ranks the entries at uploadBy, marks you, and leaves out racers with no entry", async () => {
    const r = await running(["a", "b", "c"]);
    const { stamps } = await flyLaps(r.room, r.w, r.goAt, { a: 0 });
    await tick(r.room, r.w, r.race.finalEndsAt!);
    await onRaceUpload(r.room, { race: r.race.id, token: r.tokens.b, stamps: [r.starts.b] }, r.w.ctx);
    await onRaceUpload(r.room, { race: r.race.id, token: r.tokens.a, stamps: [r.starts.a, ...stamps.a] }, r.w.ctx);
    const uploadBy = r.race.uploadBy!;
    expect(await tick(r.room, r.w, uploadBy - 1)).toEqual([]);
    const out = await tick(r.room, r.w, uploadBy);
    const time = stamps.a[N - 1].at - r.starts.a.at;
    const rows = (youA: boolean, youB: boolean) => [
      { place: 1, cc: "ID", timeMs: time, rings: N, you: youA },
      { place: 2, cc: "ID", timeMs: null, rings: 0, you: youB },
    ];
    expect(to(out, "a")).toEqual([{ t: "rresults", race: r.race.id, rows: rows(true, false), againBy: uploadBy + AGAIN_WINDOW_MS, now: uploadBy }]);
    expect(one(out, "b", "rresults").rows).toEqual(rows(false, true));
    expect(one(out, "c", "rresults").rows).toEqual(rows(false, false));
    expect(r.race).toMatchObject({ phase: "done", againBy: uploadBy + AGAIN_WINDOW_MS });
  });
});

describe("rule 14: race again", () => {
  async function done(pilots: string[]) {
    const r = await running(pilots);
    await tick(r.room, r.w, r.goAt + RACE_LIMIT_MS);
    await tick(r.room, r.w, r.race.uploadBy!);
    expect(r.race.phase).toBe("done");
    return r;
  }
  it("two or more who said again go straight to a new private grid, keeping their tokens", async () => {
    const { room, w, race, tokens } = await done(["a", "b", "c"]);
    await send(room, w, "a", { t: "ragain" });
    await send(room, w, "c", { t: "ragain" });
    expect(await tick(room, w, race.againBy! - 1)).toEqual([]);
    const out = await tick(room, w, race.againBy!);
    const ga = one(out, "a", "rgrid"), gc = one(out, "c", "rgrid");
    expect(ga).toMatchObject({ kind: "private", slot: 0, goAt: race.againBy! + GRID_MS });
    expect(gc.slot).toBe(1);
    expect(ga.race).not.toBe(race.id);
    expect(to(out, "b")).toEqual([]);
    expect(room.races).toHaveLength(1);
    expect(room.races[0]).toMatchObject({ kind: "private", code: null, host: null, phase: "grid" });
    expect(room.races[0].racers.map((r) => r.token)).toEqual([tokens.a, tokens.c]);
  });
  it("exactly one goes to a solo grid", async () => {
    const { room, w, race } = await done(["a", "b"]);
    await send(room, w, "b", { t: "ragain" });
    const out = await tick(room, w, race.againBy!);
    expect(one(out, "b", "rgrid")).toMatchObject({ kind: "solo", slot: 0 });
    expect(room.races.map((r) => r.kind)).toEqual(["solo"]);
  });
  it("again from a pilot who has since left does not count; nobody → the race is removed", async () => {
    const { room, w, race } = await done(["a", "b"]);
    await send(room, w, "a", { t: "ragain" });
    leave(room, w, "a");
    expect(await tick(room, w, race.againBy!)).toEqual([]);
    expect(room.races).toEqual([]);
    expect(nextAlarm(room)).toBeNull();
  });
  it("a pilot who joins a new lobby during the again window is no longer pulled back", async () => {
    const { room, w, race } = await done(["a", "b", "c"]);
    for (const p of ["a", "b", "c"]) await send(room, w, p, { t: "ragain" });
    await send(room, w, "c", { t: "rjoin" });
    expect(race.racers[2].pilot).toBeNull();
    const out = await tick(room, w, race.againBy!);
    expect(to(out, "c")).toEqual([]);
    const again = room.races.find((r) => r.phase === "grid")!;
    expect(again.racers.map((r) => r.pilot)).toEqual(["a", "b"]);
    expect(room.races.find((r) => r.phase === "lobby")!.racers.map((r) => r.pilot)).toEqual(["c"]);
  });
  it("ragain outside done is ignored", async () => {
    const { room, w, race } = await running(["a", "b"]);
    expect(await send(room, w, "a", { t: "ragain" })).toEqual([]);
    expect(race.racers[0].again).toBe(false);
  });
});

describe("rule 15: a pilot leaves the sky", () => {
  it("in a lobby: removed; an empty race is removed", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "a", { t: "rjoin" });
    await send(room, w, "b", { t: "rjoin" });
    leave(room, w, "a");
    expect(room.races[0].racers.map((r) => r.pilot)).toEqual(["b"]);
    expect(leave(room, w, "b")).toEqual([]);
    expect(room.races).toEqual([]);
  });
  it("the host leaving a private lobby hands the host to the next racer", async () => {
    const room = newRaceRoom();
    const w = world();
    const code = one(await send(room, w, "h", { t: "rinvite" }), "h", "rlobby").code!;
    const ft = one(await send(room, w, "f", { t: "rjoin", code }), "f", "rlobby").token;
    const out = leave(room, w, "h");
    expect(one(out, "f", "rlobby")).toMatchObject({ host: true });
    expect(room.races[0].host).toBe(ft);
  });
  it("in grid or running: the racer stays, unbound", async () => {
    const { room, w, race, tokens } = await running(["a", "b"]);
    expect(leave(room, w, "a")).toEqual([]);
    expect(race.racers[0]).toMatchObject({ token: tokens.a, pilot: null });
    expect(race.racers).toHaveLength(2);
  });
  it("a pilot in no race: nothing", () => {
    const room = newRaceRoom();
    expect(onRacePilotLeft(room, "x", world().ctx)).toEqual({ out: [] });
  });
});

describe("rule 16: rleave", () => {
  it("in a lobby: the same as leaving", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "a", { t: "rjoin" });
    await send(room, w, "b", { t: "rjoin" });
    const out = await send(room, w, "b", { t: "rleave" });
    expect(types(out, "a")).toEqual(["rlobby"]);
    expect(to(out, "b")).toEqual([]);
    expect(room.races[0].racers).toHaveLength(1);
  });
  it("running: the racer is unbound (a DNF) and can rejoin by token", async () => {
    const { room, w, race, tokens, goAt } = await running(["a", "b"]);
    await send(room, w, "a", { t: "rleave" });
    expect(race.racers[0].pilot).toBeNull();
    w.ctx.now = goAt + legMs(1);
    expect(types(await ring(room, w, "a", 1), "a")).toEqual(["rerr"]);
    expect(types(await send(room, w, "a", { t: "rjoin", token: tokens.a }), "a")).toEqual(["rgo"]);
    expect(types(await ring(room, w, "a", 1), "a")).toEqual(["rstamp"]);
  });
});

// ---------------------------------------------------------------------------

describe("the whole two-racer race", () => {
  it("join → grid → GO → rings → final call → over → uploads → results", async () => {
    const room = newRaceRoom();
    const w = world();
    // 1. two pilots join: the countdown is set.
    const ta = one(await send(room, w, "a", { t: "rjoin" }, "ID"), "a", "rlobby").token;
    w.ctx.now = T0 + 2000;
    const lb = one(await send(room, w, "b", { t: "rjoin" }, "FR"), "b", "rlobby");
    expect(lb.startsAt).toBe(T0 + 2000 + LOBBY_COUNTDOWN_MS);
    // 2. tick to grid, then to GO: both get verifiable rgo stamps.
    expect(nextAlarm(room)).toBe(lb.startsAt);
    await tick(room, w, lb.startsAt!);
    const goAt = room.races[0].goAt!;
    expect(nextAlarm(room)).toBe(goAt);
    const go = await tick(room, w, goAt);
    const sa = one(go, "a", "rgo").stamp, sb = one(go, "b", "rgo").stamp;
    expect(await verifyStamp(SECRET, sa)).toBe(true);
    expect(await verifyStamp(SECRET, sb)).toBe(true);
    // 3. both fly every ring at believable times; a is faster.
    const { stamps, log } = await flyLaps(room, w, goAt, { a: 100, b: 600 });
    expect(stamps.a.map((s) => s.i)).toEqual(Array.from({ length: N }, (_, n) => n + 1));
    expect(stamps.b.map((s) => s.i)).toEqual(Array.from({ length: N }, (_, n) => n + 1));
    // 4. the first finish sends rfinal to both.
    const aFinish = log.find((e) => e.pilot === "a" && to(e.out, "a").some((m) => m.t === "rfinal"))!;
    expect(types(aFinish.out, "b")).toEqual(["rfinal"]);
    // 5. the second finish ends the race at once.
    const bFinish = log[log.length - 1];
    expect(types(bFinish.out, "a")).toEqual(["rover"]);
    expect(types(bFinish.out, "b")).toEqual(["rstamp", "rover"]);
    const race = room.races[0];
    // 6. both upload their stamps.
    const ua = await onRaceUpload(room, { race: race.id, token: ta, stamps: [sa, ...stamps.a] }, w.ctx);
    const ub = await onRaceUpload(room, { race: race.id, token: lb.token, stamps: [sb, ...stamps.b] }, w.ctx);
    expect([ua.status, ub.status]).toEqual([200, 200]);
    // 7. past uploadBy: results, faster racer first.
    expect(nextAlarm(room)).toBe(race.uploadBy);
    const res = await tick(room, w, race.uploadBy!);
    const rows = one(res, "a", "rresults").rows;
    expect(rows.map((r) => [r.place, r.cc, r.you])).toEqual([[1, "ID", true], [2, "FR", false]]);
    expect(rows[0].timeMs!).toBeLessThan(rows[1].timeMs!);
    expect(rows[1].timeMs! - rows[0].timeMs!).toBe(N * 500);
    expect(one(res, "b", "rresults").rows.map((r) => r.you)).toEqual([false, true]);
  });
});

describe("solo", () => {
  it("alone for ALONE_MS → a solo grid; the finish ends the race at once", async () => {
    const room = newRaceRoom();
    const w = world();
    await send(room, w, "a", { t: "rjoin" });
    expect(nextAlarm(room)).toBe(T0 + ALONE_MS);
    const grid = await tick(room, w, T0 + ALONE_MS);
    expect(one(grid, "a", "rgrid").kind).toBe("solo");
    const goAt = room.races[0].goAt!;
    await tick(room, w, goAt);
    const { log } = await flyLaps(room, w, goAt, { a: 0 });
    expect(types(log[log.length - 1].out, "a")).toEqual(["rstamp", "rfinal", "rover"]);
    expect(room.races[0].phase).toBe("upload");
  });
});

describe("hibernation round trip", () => {
  it("a JSON copy mid-race carries on exactly as the original", async () => {
    const { room, w, goAt, race, tokens, starts } = await running(["a", "b", "c"]);
    // Part way round: a at ring 3, b at ring 1, c gone.
    let t = goAt;
    for (let i = 1; i <= 3; i++) { t += legMs(i) + 50; w.ctx.now = t; await ring(room, w, "a", i); }
    w.ctx.now = goAt + legMs(1) + 900;
    await ring(room, w, "b", 1);
    leave(room, w, "c");
    const copy: RaceRoom = JSON.parse(JSON.stringify(room));
    expect(copy).toEqual(room);

    /** The rest of the race, with uploads and results, against one room. */
    async function rest(r: RaceRoom) {
      const ww = world();
      ww.ctx.now = w.ctx.now;
      ww.online.add("a");
      ww.online.add("b");
      const outs: unknown[] = [];
      let tt = t;
      const rings: Stamp[] = [];
      for (let i = 4; i <= N; i++) {
        tt += legMs(i) + 50;
        ww.ctx.now = tt;
        const out = await ring(r, ww, "a", i);
        outs.push(out);
        const s = to(out, "a").find((m) => m.t === "rstamp");
        if (s?.t === "rstamp") rings.push(s.stamp);
      }
      const rr = r.races[0] as Race;
      outs.push(await tick(r, ww, rr.finalEndsAt!));
      outs.push(await onRaceUpload(r, { race: rr.id, token: tokens.b, stamps: [starts.b] }, ww.ctx));
      outs.push(await tick(r, ww, rr.uploadBy!));
      outs.push(nextAlarm(r));
      return { outs, rings };
    }
    const a = await rest(room);
    const b = await rest(copy);
    expect(b.outs).toEqual(a.outs);
    expect(b.rings).toEqual(a.rings);
    expect(JSON.parse(JSON.stringify(copy))).toEqual(JSON.parse(JSON.stringify(room)));
    expect(race.phase).toBe("done");
  });
});

describe("busy token from a second tab", () => {
  it("refuses the second bind and the first tab keeps getting stamps", async () => {
    const { room, w, tokens, goAt } = await running(["a", "b"]);
    expect(await send(room, w, "tab2", { t: "rjoin", token: tokens.a })).toEqual([{ to: "tab2", msg: { t: "rerr", reason: "busy" } }]);
    w.ctx.now = goAt + legMs(1);
    expect(types(await ring(room, w, "a", 1), "a")).toEqual(["rstamp"]);
    w.ctx.now += legMs(2);
    expect(types(await ring(room, w, "tab2", 2), "tab2")).toEqual(["rerr"]);
    expect(types(await ring(room, w, "a", 2), "a")).toEqual(["rstamp"]);
  });
});

describe("reconnect mid-race", () => {
  it("a new pilot id with the token gets the same GO stamp and signs the next ring", async () => {
    const { room, w, tokens, starts, goAt } = await running(["a", "b"]);
    w.ctx.now = goAt + legMs(1);
    await ring(room, w, "a", 1);
    leave(room, w, "a");
    w.ctx.now += 1000;
    const out = await send(room, w, "a-new", { t: "rjoin", token: tokens.a });
    expect(to(out, "a-new")).toEqual([{ t: "rgo", stamp: starts.a, now: w.ctx.now }]);
    w.ctx.now = goAt + legMs(1) + legMs(2) + 1000;
    const s = one(await ring(room, w, "a-new", 2), "a-new", "rstamp");
    expect(s.stamp).toMatchObject({ k: tokens.a, i: 2 });
  });
});

describe("nextAlarm", () => {
  const base = (over: Partial<Race>): Race => ({
    id: "r", kind: "public", code: null, host: null, phase: "lobby", racers: [], createdAt: 0, aloneSince: null,
    startsAt: null, goAt: null, finalEndsAt: null, uploadBy: null, againBy: null, ...over,
  });
  const racer = (n: number) => ({ token: String(n).repeat(32), pilot: `p${n}`, cc: null, slot: n, next: 0, lastAt: 0, finished: false, again: false, entry: null });
  it("is null with no races", () => {
    expect(nextAlarm(newRaceRoom())).toBeNull();
  });
  it("covers each phase's deadline", () => {
    const cases: [Race, number][] = [
      [base({ racers: [racer(1), racer(2)], startsAt: 500 }), 500],
      [base({ racers: [racer(1)], aloneSince: 100 }), 100 + ALONE_MS],
      [base({ kind: "private", code: "ABCDEF", racers: [racer(1)], createdAt: 7 }), 7 + INVITE_TTL_MS],
      [base({ phase: "grid", goAt: 900 }), 900],
      [base({ phase: "running", goAt: 1000 }), 1000 + RACE_LIMIT_MS],
      [base({ phase: "running", goAt: 1000, finalEndsAt: 2000 }), 2000],
      [base({ phase: "running", goAt: 1000, finalEndsAt: 1000 + RACE_LIMIT_MS + 5 }), 1000 + RACE_LIMIT_MS],
      [base({ phase: "upload", uploadBy: 3000 }), 3000],
      [base({ phase: "done", againBy: 4000 }), 4000],
    ];
    for (const [race, at] of cases) expect(nextAlarm({ races: [race], lastWaitAt: 0 }), race.phase).toBe(at);
  });
  it("is the earliest across races", () => {
    const room: RaceRoom = { races: [base({ phase: "upload", uploadBy: 3000 }), base({ phase: "grid", goAt: 900 }), base({ phase: "done", againBy: 4000 })], lastWaitAt: 0 };
    expect(nextAlarm(room)).toBe(900);
  });
  it("after every tick, no deadline is left in the past (no alarm loop)", async () => {
    const { room, w, goAt } = await running(["a", "b"]);
    for (const at of [goAt + 1, goAt + RACE_LIMIT_MS, goAt + RACE_LIMIT_MS + UPLOAD_WINDOW_MS, goAt + RACE_LIMIT_MS + UPLOAD_WINDOW_MS + AGAIN_WINDOW_MS]) {
      await tick(room, w, at);
      const next = nextAlarm(room);
      if (next !== null) expect(next).toBeGreaterThan(at);
    }
    expect(room.races).toEqual([]);
  });
});
