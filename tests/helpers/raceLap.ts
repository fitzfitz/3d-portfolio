import { RACE_CENTRES } from "../../src/data/ringCourse";
import { GHOST_HZ, type Ghost, type GhostSample } from "../../src/utils/race";
import type { ResultEntry, Stamp } from "../../src/utils/raceProtocol";

/**
 * Race laps for tests: a ghost that flies straight from ring centre to ring
 * centre on the stamps' clock, so it matches checkPath, and a whole lap
 * (stamps 0..N, unsigned) at a steady speed.
 */

const N = RACE_CENTRES.length;
const centre = (i: number) => RACE_CENTRES[i % N];

/** A GHOST_HZ path through ring i's centre at stamp i's time, straight legs between. */
export function ghostThrough(stamps: readonly Stamp[]): Ghost {
  const t0 = stamps[0].at;
  const time = (stamps[stamps.length - 1].at - t0) / 1000;
  const samples: GhostSample[] = [];
  const at = (t: number): GhostSample => {
    let k = 0;
    while (k < stamps.length - 2 && (stamps[k + 1].at - t0) / 1000 < t) k++;
    const ta = (stamps[k].at - t0) / 1000, tb = (stamps[k + 1].at - t0) / 1000;
    const f = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 1;
    const a = centre(stamps[k].i), b = centre(stamps[k + 1].i);
    return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f, yaw: 0, pitch: 0 };
  };
  const ticks = Math.ceil(time * GHOST_HZ - 1e-9);
  for (let k = 0; k < ticks; k++) samples.push(at(k / GHOST_HZ));
  samples.push(at(time));
  return { time, samples };
}

export const TOKEN = "ab".repeat(16);
export const RACE_ID = "race-1";

/** A finished lap at `speed` u/s from `t0`: the stamps (zero signatures), its entry and a matching ghost. */
export function lapAt(speed: number, t0 = 1_000_000) {
  const stamps: Stamp[] = [{ r: RACE_ID, k: TOKEN, i: 0, at: t0, sig: "0".repeat(32) }];
  let d = 0;
  for (let i = 1; i <= N; i++) {
    const a = centre(i - 1), b = centre(i);
    d += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    stamps.push({ r: RACE_ID, k: TOKEN, i, at: t0 + Math.round((d / speed) * 1000), sig: "0".repeat(32) });
  }
  const last = stamps[N];
  const entry: ResultEntry = { token: TOKEN, cc: "ID", timeMs: last.at - t0, rings: N, lastAt: last.at };
  return { stamps, entry, ghost: ghostThrough(stamps) };
}
