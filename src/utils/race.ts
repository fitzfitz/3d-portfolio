/**
 * Time-trial logic, pure: gate crossing, the race state machine, and ghost
 * recording/playback. The scene component (RingCourse.tsx) feeds it positions.
 */

export interface Vec3 { x: number; y: number; z: number }
/** A ring: centre and unit normal (the direction of travel through it). */
export interface Gate { c: Vec3; n: Vec3 }

/**
 * Longest per-frame move that still counts as flying. Warp covers ~2 units a
 * frame at 60fps (39 u/s, dt clamped to 0.05 → ≤2 units even at 20fps); a
 * jump, a debug teleport or a boundary wrap moves far more and must not
 * trigger a gate on the way.
 */
export const MAX_STEP = 10;

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

/**
 * Whether the move a→b passed through the ring's disc, in either direction.
 * A segment test, not a proximity check: at warp the ship can be on the far
 * side of a ring one frame after being on the near side.
 */
export function crossesGate(a: Vec3, b: Vec3, g: Gate, radius: number): boolean {
  const ab = sub(b, a);
  if (len(ab) >= MAX_STEP) return false;
  const da = dot(sub(a, g.c), g.n);
  const db = dot(sub(b, g.c), g.n);
  // Half-open: a point exactly on the plane counts as the positive side, so a
  // step that lands on it and the step that leaves it can't both cross.
  if ((da < 0) === (db < 0)) return false;
  const t = da / (da - db);
  const p = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
  return len(sub(p, g.c)) <= radius;
}

/** Orients each ring to bisect its incoming and outgoing legs of the loop. */
export function buildGates(points: readonly (readonly [number, number, number])[]): Gate[] {
  const P = points.map(([x, y, z]) => ({ x, y, z }));
  return P.map((c, i) => {
    const prev = P[(i - 1 + P.length) % P.length];
    const next = P[(i + 1) % P.length];
    const out = norm(sub(next, c));
    const bisector = add(norm(sub(c, prev)), out);
    // A hairpin cancels the bisector out; face the outgoing leg instead.
    return { c, n: len(bisector) < 1e-6 ? out : norm(bisector) };
  });
}
function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }

export type RaceState =
  | { phase: "idle" }
  /** `next` is the ring to fly through; 0 means the finish (ring 0 again). */
  | { phase: "running"; next: number; startClock: number }
  /** `newBest` is set by the caller, which knows the previous best. */
  | { phase: "finished"; time: number; newBest?: boolean };

/**
 * One frame of race clock: the ship's own clamped dt, so a tab switch or a
 * slow frame stops the clock as it stops the ship. Paused in photo mode,
 * where the ship is frozen in place.
 */
export function advanceRaceClock(now: number, delta: number, paused: boolean): number {
  return paused ? now : now + Math.min(delta, 0.05);
}

export type RaceEvent = "start" | "gate" | "finish";

/**
 * Advances the race for one frame's move a→b at race-clock time `clock`.
 * Only the next ring counts: flying through any other is ignored, including
 * doubling back through the start ring before the lap is done.
 */
export function raceStep(
  s: RaceState, a: Vec3, b: Vec3, clock: number, gates: readonly Gate[], radius: number,
): { state: RaceState; event: RaceEvent | null } {
  if (s.phase !== "running") {
    if (crossesGate(a, b, gates[0], radius)) {
      return { state: { phase: "running", next: 1, startClock: clock }, event: "start" };
    }
    return { state: s, event: null };
  }
  if (!crossesGate(a, b, gates[s.next], radius)) return { state: s, event: null };
  if (s.next === 0) return { state: { phase: "finished", time: clock - s.startClock }, event: "finish" };
  return { state: { ...s, next: (s.next + 1) % gates.length }, event: "gate" };
}

/** Ghost samples per second of race clock. */
export const GHOST_HZ = 10;

export interface GhostSample { x: number; y: number; z: number; yaw: number; pitch: number }
export interface Ghost { time: number; samples: GhostSample[] }

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The ghost's pose `t` seconds into its run; null once the run is over. */
export function sampleGhost(samples: readonly GhostSample[], t: number): GhostSample | null {
  const f = t * GHOST_HZ;
  const i = Math.floor(f);
  if (t < 0 || i >= samples.length - 1) return null;
  const a = samples[i], b = samples[i + 1], k = f - i;
  // A boundary wrap mid-run: snap rather than sweep across the whole world.
  if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > MAX_STEP * 4) return a;
  const lerp = (p: number, q: number) => p + (q - p) * k;
  return {
    x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z),
    yaw: wrapAngle(a.yaw + wrapAngle(b.yaw - a.yaw) * k),
    pitch: lerp(a.pitch, b.pitch),
  };
}

const FIELDS = 5;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Compact storage form: one flat array, two decimals (~20KB for a minute). */
export function encodeGhost(g: Ghost): string {
  const s: number[] = [];
  for (const p of g.samples) s.push(round2(p.x), round2(p.y), round2(p.z), round2(p.yaw), round2(p.pitch));
  return JSON.stringify({ v: 1, time: g.time, s });
}

export function decodeGhost(raw: string | null): Ghost | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { v?: unknown; time?: unknown; s?: unknown };
    if (d.v !== 1 || typeof d.time !== "number" || !Array.isArray(d.s) || d.s.length % FIELDS) return null;
    if (!d.s.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    const s = d.s as number[];
    const samples: GhostSample[] = [];
    for (let i = 0; i < s.length; i += FIELDS) {
      samples.push({ x: s[i], y: s[i + 1], z: s[i + 2], yaw: s[i + 3], pitch: s[i + 4] });
    }
    return { time: d.time, samples };
  } catch {
    return null;
  }
}

/** m:ss.t — tenths, truncated, so a displayed time never rounds up past a record. */
export function formatRaceTime(sec: number): string {
  const tenths = Math.floor(sec * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

export function isNewBest(time: number, best: number | null): boolean {
  return best === null || time < best;
}

/** A stored best time, or null if it is missing or not a plausible time. */
export function parseRaceBest(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}
