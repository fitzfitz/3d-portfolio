import { RING_GATES } from "../data/ringCourse";
import {
  RACE_LIMIT_MS, UPLOAD_WINDOW_MS, RACE_ID_RE, isInviteCode, parseStamp,
  type LobbyPilot, type RaceClientMessage, type RaceKind, type RaceServerMessage, type ResultRow, type Stamp,
} from "./raceProtocol";

/**
 * The client's side of a ring race, pure: what the HUD and the scene show
 * (the view, reduced from the server's race messages), the run kept for the
 * upload, the upload itself and the invite code in the URL.
 *
 * Server time is the race clock. Every server time in a view is converted to
 * local ms with the message's `now`: localNow + (serverTime - m.now), so a
 * client clock minutes off the server's still counts down right.
 */

/** The finish is ring N (gate 0 again). */
const N = RING_GATES.length;

/** All times are local ms (Date.now()'s clock). */
export type RaceView =
  | { phase: "idle" }
  | { phase: "lobby"; race: string; kind: RaceKind; code: string | null; host: boolean; pilots: LobbyPilot[]; startsAt: number | null }
  | { phase: "grid"; race: string; kind: RaceKind; slot: number; goAt: number }
  | { phase: "running"; race: string; kind: RaceKind; next: number; goAt: number; finalEndsAt: number | null; finished: boolean }
  | { phase: "over"; race: string; uploadBy: number; finished: boolean }
  | { phase: "results"; race: string; rows: ResultRow[]; againBy: number };

export const RACE_IDLE: RaceView = { phase: "idle" };

/**
 * The next view. Resends after a rejoin (the same lobby, grid, start stamp or
 * final call) leave the view as it is. `rover` wins over anything sent with it
 * (a solo finish sends rstamp, rfinal and rover together), and nothing but a
 * new race's messages moves the view out of `over`: a late claim's `rerr ring`
 * is ignored, as is `rerr busy` (another tab holds the token; this one keeps its view).
 */
export function raceReduce(v: RaceView, m: RaceServerMessage, localNow: number): RaceView {
  const local = (serverTime: number, now: number) => localNow + (serverTime - now);
  switch (m.t) {
    case "rlobby":
      return {
        phase: "lobby", race: m.race, kind: m.kind, code: m.code, host: m.host, pilots: m.pilots,
        startsAt: m.startsAt === null ? null : local(m.startsAt, m.now),
      };
    case "rgrid":
      return { phase: "grid", race: m.race, kind: m.kind, slot: m.slot, goAt: local(m.goAt, m.now) };
    case "rgo": {
      const goAt = local(m.stamp.at, m.now);
      if (v.phase === "running" && v.race === m.stamp.r) return v.goAt === goAt ? v : { ...v, goAt };
      // A rejoin after a reload has no grid to read the kind from: public is the plain case.
      const kind = (v.phase === "grid" || v.phase === "lobby") && v.race === m.stamp.r ? v.kind : "public";
      return { phase: "running", race: m.stamp.r, kind, next: 1, goAt, finalEndsAt: null, finished: false };
    }
    case "rstamp": {
      if (v.phase !== "running" || v.race !== m.stamp.r || m.stamp.i !== v.next) return v;
      return { ...v, next: v.next + 1, finished: v.finished || m.stamp.i === N };
    }
    case "rfinal": {
      if (v.phase !== "running") return v;
      const finalEndsAt = local(m.endsAt, m.now);
      return v.finalEndsAt === finalEndsAt ? v : { ...v, finalEndsAt };
    }
    case "rover": {
      const finished = (v.phase === "running" || v.phase === "over") && v.race === m.race && v.finished;
      return { phase: "over", race: m.race, uploadBy: local(m.uploadBy, m.now), finished };
    }
    case "rresults":
      return { phase: "results", race: m.race, rows: m.rows, againBy: local(m.againBy, m.now) };
    case "rerr":
      return m.reason === "ring" || m.reason === "busy" ? v : RACE_IDLE;
    case "rwait":
      return v;
  }
}

// ---- the run: token and stamps, kept for the upload ------------------------

/**
 * Stored as fitz-race-run, so a reload mid-race keeps the stamps earned before
 * it. `kind` (from the lobby and the grid) lets a rejoin after a reload pick
 * the race up as the kind it was: a solo race keeps its best-lap replay. Runs
 * stored before it was kept have none (still v 1).
 */
export interface RaceRun { v: 1; race: string; token: string; kind?: RaceKind; stamps: Stamp[]; expiresAt: number }

const KINDS: readonly string[] = ["public", "private", "solo"] satisfies RaceKind[];

/** How long a run is kept from the race's start: the race, the upload window and a minute. */
export const RUN_TTL_MS = RACE_LIMIT_MS + UPLOAD_WINDOW_MS + 60_000;

const HEX32 = /^[0-9a-f]{32}$/;

/** The stored run, or null if it is missing, malformed or expired. Storage is untrusted input. */
export function loadRun(raw: string | null, localNow: number): RaceRun | null {
  if (raw === null) return null;
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (r.v !== 1 || typeof r.race !== "string" || !RACE_ID_RE.test(r.race) || typeof r.token !== "string" || !HEX32.test(r.token)
    || typeof r.expiresAt !== "number" || !Number.isFinite(r.expiresAt) || r.expiresAt <= localNow || !Array.isArray(r.stamps)) return null;
  const stamps: Stamp[] = [];
  for (const x of r.stamps) {
    const s = parseStamp(x);
    if (!s) return null;
    stamps.push(s);
  }
  const run: RaceRun = { v: 1, race: r.race, token: r.token, stamps, expiresAt: r.expiresAt };
  // Optional: a missing or unknown kind leaves it out (the rejoin falls back to public).
  if (typeof r.kind === "string" && KINDS.includes(r.kind)) run.kind = r.kind as RaceKind;
  return run;
}

/** The run with `s` added, replacing a stamp with the same ring index; stamps stay in ring order. */
export function withStamp(run: RaceRun, s: Stamp): RaceRun {
  const stamps = [...run.stamps.filter((x) => x.i !== s.i), s].sort((a, b) => a.i - b.i);
  return { ...run, stamps };
}

/**
 * The view brought in line with the stored run of the same race: after a
 * reload the rejoin's rgo knows only the start (and, on an idle view, not the
 * kind), while the run holds every ring stamped before it and the race's
 * kind. Never moves `next` back.
 */
export function syncWithRun(v: RaceView, run: RaceRun | null): RaceView {
  if (!run || (v.phase !== "running" && v.phase !== "over") || v.race !== run.race || run.stamps.length === 0) return v;
  const top = run.stamps[run.stamps.length - 1].i;
  const finished = v.finished || top >= N;
  if (v.phase === "over") return finished === v.finished ? v : { ...v, finished };
  const next = Math.max(v.next, top + 1);
  const kind = run.kind ?? v.kind;
  return next === v.next && finished === v.finished && kind === v.kind ? v : { ...v, next, finished, kind };
}

/**
 * Posts the run to `${base}/race/result`: 200 ok; 409 late (phase, late or
 * duplicate); 400 and 404 rejected; anything else, or no network, failed.
 */
export async function uploadRun(
  base: string, run: RaceRun, ghost: string | null, f: typeof fetch = fetch,
): Promise<"ok" | "late" | "rejected" | "failed"> {
  if (!base) return "failed";
  const body = ghost === null
    ? { race: run.race, token: run.token, stamps: run.stamps }
    : { race: run.race, token: run.token, stamps: run.stamps, ghost };
  try {
    const res = await f(`${base}/race/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 200) return "ok";
    if (res.status === 409) return "late";
    if (res.status === 400 || res.status === 404) return "rejected";
    return "failed";
  } catch {
    return "failed";
  }
}

/** A valid invite code from `?race=`, or null. */
export function raceCodeFromUrl(search: string): string | null {
  const code = new URLSearchParams(search).get("race");
  return isInviteCode(code) ? code : null;
}

/** The join a `?race=` link asks for: that invite's race for a valid code, else the public race. */
export function raceJoinMessage(search: string): RaceClientMessage {
  const code = raceCodeFromUrl(search);
  return code ? { t: "rjoin", code } : { t: "rjoin" };
}
