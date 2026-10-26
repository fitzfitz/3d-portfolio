/**
 * Ring race logic, pure: gate crossing, the start grid, and ghost recording,
 * playback and the seed lap. The scene component (RaceCourse.tsx) feeds it
 * positions; lap rules shared with the server live in raceProtocol.ts.
 */

export interface Vec3 { x: number; y: number; z: number }
/** A ring: centre and unit normal (the direction of travel through it). */
export interface Gate { c: Vec3; n: Vec3 }

/**
 * Longest per-frame move that still counts as flying. Warp covers ~2 units a
 * frame at 60fps (39 u/s, dt clamped to 0.05 → ≤2 units even at 20fps); a
 * jump or a debug teleport moves far more and must not
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
  // A teleport mid-run: snap rather than sweep across the whole world.
  if (Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) > MAX_STEP * 4) return a;
  const lerp = (p: number, q: number) => p + (q - p) * k;
  return {
    x: lerp(a.x, b.x), y: lerp(a.y, b.y), z: lerp(a.z, b.z),
    yaw: wrapAngle(a.yaw + wrapAngle(b.yaw - a.yaw) * k),
    pitch: lerp(a.pitch, b.pitch),
  };
}

/** Heading and pitch whose nose (see pitchFlight.ts noseDirection) points along unit vector d. */
function poseAlong(d: Vec3): { heading: number; pitch: number } {
  return { heading: Math.atan2(d.x, d.z), pitch: Math.asin(Math.max(-1, Math.min(1, d.y))) };
}

/** Start grid: rows this far behind the start gate, two pilots a row. */
const GRID_ROWS = [14, 22, 30, 38] as const;
/** Each column's distance from the gate's axis. */
const GRID_HALF_GAP = 4;

/**
 * Start slot `slot` (0..7) behind `gate`: two columns 4 u either side of its
 * axis, rows 14, 22, 30 and 38 u back along -n, every slot facing n. Even
 * slots take the left column, odd the right (left and right as seen flying
 * through, with world up as up).
 */
export function gridSlot(gate: Gate, slot: number): { p: Vec3; heading: number; pitch: number } {
  const { c, n } = gate;
  const back = GRID_ROWS[Math.floor(slot / 2) % GRID_ROWS.length];
  // Right = n × up, flat; a gate facing straight up or down falls back to +x.
  const flat = Math.hypot(n.x, n.z);
  const right: Vec3 = flat < 1e-6 ? { x: 1, y: 0, z: 0 } : { x: -n.z / flat, y: 0, z: n.x / flat };
  const side = slot % 2 === 0 ? -GRID_HALF_GAP : GRID_HALF_GAP;
  return {
    p: {
      x: c.x - n.x * back + right.x * side,
      y: c.y - n.y * back + right.y * side,
      z: c.z - n.z * back + right.z * side,
    },
    ...poseAlong(n),
  };
}

/**
 * A steady lap for when no one has set a best yet: straight legs from ring 0
 * through every ring and back to ring 0 at `speed` (u/s), sampled at GHOST_HZ
 * and facing each leg. The last sample sits on ring 0's centre, so the run
 * ends through the finish.
 */
export function seedLap(gates: readonly Gate[], speed: number): Ghost {
  const pts = [...gates.map((g) => g.c), gates[0].c];
  const legs = pts.slice(1).map((b, i) => len(sub(b, pts[i])));
  const total = legs.reduce((a, b) => a + b, 0);
  const time = total / speed;
  const at = (d: number): GhostSample => {
    let i = 0;
    while (i < legs.length - 1 && d > legs[i]) d -= legs[i++];
    const a = pts[i], dir = norm(sub(pts[i + 1], a));
    const k = Math.min(d, legs[i]);
    const { heading, pitch } = poseAlong(dir);
    return { x: a.x + dir.x * k, y: a.y + dir.y * k, z: a.z + dir.z * k, yaw: heading, pitch };
  };
  const ticks = Math.ceil(time * GHOST_HZ - 1e-9);
  const samples: GhostSample[] = [];
  for (let k = 0; k < ticks; k++) samples.push(at((k / GHOST_HZ) * speed));
  samples.push(at(total));
  return { time, samples };
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
