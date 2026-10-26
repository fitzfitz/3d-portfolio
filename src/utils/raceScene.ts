import { RACE_GATES, RING_RADIUS, SEED_SPEED, START_GATE } from "../data/ringCourse";
import { crossesGate, decodeGhost, encodeGhost, gridSlot, seedLap, type Ghost, type Vec3 } from "./race";
import type { RaceRun, RaceView } from "./raceSession";

/**
 * The race scene's rules, pure: which rings show and which is lit, the grid
 * hold, ring claims, the best lap to replay and the path to upload.
 * RaceCourse.tsx feeds it the view, the clock and the ship's moves.
 */

/** The finish is ring N, through gate 0 again. */
const N = RACE_GATES.length;

/** The start gate's scannable (the scan report is keyed by it in scanReport.ts). */
export const RACE_START_SCAN_ID = "race_start";
export const RACE_START_LABEL = "RACE START GATE";

/** The course beyond the start gate shows to racers only: running, and at the over. */
export function ringsVisible(v: RaceView): boolean {
  return v.phase === "running" || v.phase === "over";
}

/** The ring to fly through next (next % N: the finish is gate 0), or null off a running, unfinished lap. */
export function targetGate(v: RaceView): number | null {
  return v.phase === "running" && !v.finished ? v.next % N : null;
}

/** On the grid or racing: warp is held to the base speed, jumps and beam dossiers are off. */
export function racingView(v: RaceView): v is Extract<RaceView, { phase: "grid" | "running" }> {
  return v.phase === "grid" || v.phase === "running";
}

/** Held still on the grid until GO (local), even before the rgo itself arrives. */
export function raceHoldAt(v: RaceView, localNow: number): boolean {
  return (v.phase === "grid" || v.phase === "running") && localNow < v.goAt;
}

/** Where the grid puts the ship: this race's slot behind the start gate. `key` changes once per race and slot. */
export function gridPose(v: RaceView): { key: string; p: Vec3; heading: number; pitch: number } | null {
  if (v.phase !== "grid") return null;
  return { key: `${v.race}:${v.slot}`, ...gridSlot(START_GATE, v.slot) };
}

/**
 * The ring this move a→b claims: `next`, when the move crosses the target
 * ring and that ring has not been claimed already (`claimed`, the last
 * claim's key). The view moves on with the server's stamp, not here.
 */
export function ringToClaim(v: RaceView, a: Vec3, b: Vec3, claimed: string | null): { i: number; key: string } | null {
  const target = targetGate(v);
  if (target === null || v.phase !== "running") return null;
  const key = `${v.race}:${v.next}`;
  if (key === claimed || !crossesGate(a, b, RACE_GATES[target], RING_RADIUS)) return null;
  return { i: v.next, key };
}

/** The lap time (server ms) from the run's GO and finish stamps, or null without both. */
export function lapMsFromRun(run: RaceRun | null): number | null {
  const go = run?.stamps.find((s) => s.i === 0);
  const fin = run?.stamps.find((s) => s.i === N);
  return go && fin ? fin.at - go.at : null;
}

/**
 * The encoded path to upload with the run: only for a finished lap that beats
 * the best known here (the fetched best, or the seed lap's), timed by the
 * stamps so it matches the server's lap time. Null otherwise: the server
 * would not keep it.
 */
export function ghostForUpload(finished: boolean, lapMs: number | null, bestMs: number, rec: Ghost | null): string | null {
  if (!finished || lapMs === null || !(lapMs < bestMs) || !rec || rec.samples.length < 2) return null;
  return encodeGhost({ time: lapMs / 1000, samples: rec.samples });
}

let seed: { timeMs: number; ghost: Ghost } | null = null;
/** The lap to beat with no best stored: the seed lap the server uses too. */
function seedBest(): { timeMs: number; ghost: Ghost } {
  if (!seed) {
    const ghost = seedLap(RACE_GATES, SEED_SPEED);
    seed = { timeMs: ghost.time * 1000, ghost };
  }
  return seed;
}

/**
 * The course's best lap from `${base}/race/best`: its time and its path. The
 * seed lap when there is no best yet, the reply is bad, or the API is
 * unreachable or not configured.
 */
export async function fetchBestLap(base: string, f: typeof fetch = fetch): Promise<{ timeMs: number; ghost: Ghost }> {
  if (!base) return seedBest();
  try {
    const res = await f(`${base}/race/best`);
    if (!res.ok) return seedBest();
    const body = (await res.json()) as { timeMs?: unknown; ghost?: unknown };
    const timeMs = body.timeMs;
    if (typeof timeMs !== "number" || !Number.isFinite(timeMs) || timeMs <= 0 || typeof body.ghost !== "string") return seedBest();
    const ghost = decodeGhost(body.ghost);
    return ghost && ghost.samples.length >= 2 ? { timeMs, ghost } : seedBest();
  } catch {
    return seedBest();
  }
}
