import { PROBES, type ProbeDef, type Vec3T } from "../data/probes";
import { BEAM_RANGE, inCone } from "./tractorBeam";
import { worldToRadar } from "./radarTransform";

/**
 * Pure probe logic (docs: project probes design). A probe's "spot" is where
 * it currently floats: 0 is its home, k >= 1 is remote[k - 1]. Spots persist
 * in the visitor's browser, so a stored value is validated on load.
 */

/** Every probe id present; anything that is not a valid spot index becomes 0 (home). */
export function loadProbeSpots(raw: unknown): Record<string, number> {
  const src = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Record<string, number> = {};
  for (const def of PROBES) {
    const v = src[def.id];
    out[def.id] = typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= def.remote.length ? v : 0;
  }
  return out;
}

/** The spot after relocating: 0 -> 1, k -> k + 1, the last wraps to 1 (a probe never returns home). */
export function nextSpot(def: ProbeDef, spot: number): number {
  return spot >= def.remote.length ? 1 : spot + 1;
}

export function spotPos(def: ProbeDef, spot: number): Vec3T {
  return spot <= 0 ? def.home : def.remote[spot - 1];
}

/** Seconds a closed probe's burn lasts before it vanishes. */
export const RELOCATE_S = 2.5;
/** Distance flown along the burn direction over the whole burn. */
const RELOCATE_DIST = 60;

/** Distance flown after t seconds: ease-in (quadratic), 0 at 0, RELOCATE_DIST at RELOCATE_S. */
export function relocationTravel(t: number): number {
  const k = Math.min(Math.max(t / RELOCATE_S, 0), 1);
  return RELOCATE_DIST * k * k;
}

/** Beacon pulse frequency (Hz): well under the 3 Hz flash limit. */
const BEACON_HZ = 1.2;
/** Soft power so the beacon rests dim and peaks briefly. */
const BEACON_POWER = 1.8;

/** 0..1, smooth, period 1/BEACON_HZ s. `phase` (rad) de-syncs the probes. */
export function beaconLevel(t: number, phase: number): number {
  const base = 0.5 - 0.5 * Math.cos(2 * Math.PI * BEACON_HZ * t + phase);
  return Math.pow(base, BEACON_POWER);
}

/** True once a relocation burn has run its course: at once under reduced motion (it snaps). */
export function relocationDone(elapsed: number, reducedMotion: boolean): boolean {
  return reducedMotion || elapsed >= RELOCATE_S;
}

/** A released probe drifts back to its spot at this speed (u/s). */
export const PROBE_DRIFT_SPEED = 2;

type PosMap = Readonly<Record<string, { x: number; y: number; z: number }>>;
type FlagMap = Readonly<Record<string, boolean>>;

/**
 * The probe the beam takes this frame: the nearest one inside the cone
 * (origin o, unit direction d) and BEAM_RANGE, skipping relocating probes.
 * Allocation-free.
 */
export function grabbableProbe(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  pos: PosMap, relocating: FlagMap,
): string | null {
  let best: string | null = null, bestD = Infinity;
  for (let i = 0; i < PROBES.length; i++) {
    const id = PROBES[i].id;
    const p = pos[id];
    if (!p || relocating[id]) continue;
    const d = inCone(ox, oy, oz, dx, dy, dz, p.x, p.y, p.z, BEAM_RANGE);
    if (d >= 0 && d < bestD) { bestD = d; best = id; }
  }
  return best;
}

/** The nearest probe within `range` of (x, y, z) in any direction, skipping relocating probes. */
export function nearestProbe(x: number, y: number, z: number, pos: PosMap, relocating: FlagMap, range: number): string | null {
  let best: string | null = null, bestD = range;
  for (let i = 0; i < PROBES.length; i++) {
    const id = PROBES[i].id;
    const p = pos[id];
    if (!p || relocating[id]) continue;
    const d = Math.hypot(p.x - x, p.y - y, p.z - z);
    if (d <= bestD) { bestD = d; best = id; }
  }
  return best;
}

/**
 * True once the last relocation asked for (store `relocation.id`, or null
 * for none) has played out: that probe is not burning and sits exactly at
 * its current spot (ProjectProbes snaps it there, then sends the PROBE
 * RELOCATING line). False from the close until then, since the close
 * advances the spot before the probe has moved. Allocation-free.
 */
export function relocationSettled(id: string | null, spots: Readonly<Record<string, number>>, pos: PosMap, relocating: FlagMap): boolean {
  if (id === null) return true;
  if (relocating[id]) return false;
  const p = pos[id];
  for (let i = 0; i < PROBES.length; i++) {
    if (PROBES[i].id !== id) continue;
    if (!p) return true;
    const s = spotPos(PROBES[i], spots[id] ?? 0);
    return p.x === s[0] && p.y === s[1] && p.z === s[2];
  }
  return true;
}

/**
 * The radio line once a relocated probe settles. The bearing is measured
 * clockwise from the ship's nose in the top-down plane, the frame the
 * heading-up radar draws in (radarTransform.ts), so "090" is the blip to the
 * right of centre. (dx, dz) is the probe minus the ship.
 */
export function relocationLine(title: string, dx: number, dz: number, dist: number, heading: number): string {
  const { x, up } = worldToRadar(dx, dz, heading);
  const deg = Math.round(((Math.atan2(x, up) * 180) / Math.PI + 360) % 360) % 360;
  return `PROBE RELOCATING // ${title} SIGNAL REACQUIRED BEARING ${String(deg).padStart(3, "0")} AT ${Math.round(dist)} U`;
}

/** Seconds between a probe's station-keeping RCS puffs. */
export const RCS_PERIOD_S = 6;
/** How long one puff glows. */
const RCS_PUFF_S = 0.3;

/**
 * 0..1 glow of the RCS nozzles: a short sine puff once every RCS_PERIOD_S,
 * dark otherwise (UNIVERSE-RULES L16: probes hold station on thrusters).
 * `phase` (s) de-syncs the probes.
 */
export function rcsPuff(t: number, phase: number): number {
  const k = (((t + phase) % RCS_PERIOD_S) + RCS_PERIOD_S) % RCS_PERIOD_S;
  return k < RCS_PUFF_S ? Math.sin((Math.PI * k) / RCS_PUFF_S) : 0;
}

/** How far the burn swings off the ship-to-probe axis (spec §4.2; R13: >= 45°, so it streaks across the view). */
const BURN_OFF_AXIS = (50 * Math.PI) / 180;
/**
 * How far the swing leans from "up" toward the side. Mostly sideways: the
 * chase camera sits just behind and above the ship, so a climbing probe left
 * the top of the frame within ~0.6 s, while the wide frame keeps a sideways
 * streak in view for most of RELOCATE_S.
 */
const BURN_LEAN = (85 * Math.PI) / 180;

/**
 * The relocation burn's unit direction, written into `out`. Straight away
 * from the ship is the camera's own view line (the chase camera sits behind
 * the ship), where the probe only shrinks; so the burn swings BURN_OFF_AXIS
 * off that axis, mostly to one side and a little up, the side alternating
 * with the probe index `i` (deterministic). (ax, ay, az) is the probe minus the
 * ship; any length, zero tolerated. Allocation-free.
 */
export function burnDirection(ax: number, ay: number, az: number, i: number, out: { x: number; y: number; z: number }): void {
  let l = Math.hypot(ax, ay, az);
  if (l < 1e-9) { ax = 0; ay = 0; az = 1; l = 1; }
  ax /= l; ay /= l; az /= l;
  // side = a x worldUp; a vertical axis falls back to +x.
  let sx = -az, sy = 0, sz = ax;
  let sl = Math.hypot(sx, sy, sz);
  if (sl < 1e-3) { sx = 1; sy = 0; sz = 0; sl = 1; }
  sx /= sl; sy /= sl; sz /= sl;
  // up' = side x a (perpendicular to the axis, as near world-up as it gets).
  const ux = sy * az - sz * ay, uy = sz * ax - sx * az, uz = sx * ay - sy * ax;
  const sign = i % 2 === 0 ? 1 : -1;
  const cl = Math.cos(BURN_LEAN), sn = Math.sin(BURN_LEAN) * sign;
  const px = ux * cl + sx * sn, py = uy * cl + sy * sn, pz = uz * cl + sz * sn;
  const c = Math.cos(BURN_OFF_AXIS), s = Math.sin(BURN_OFF_AXIS);
  out.x = ax * c + px * s; out.y = ay * c + py * s; out.z = az * c + pz * s;
  const ol = Math.hypot(out.x, out.y, out.z);
  out.x /= ol; out.y /= ol; out.z /= ol;
}

/** What the HUD pickup tip says: the beam would take a probe, it is near but out of the cone, or out of reach. */
export type ProbeTip = "grab" | "turn" | "closer" | null;

/**
 * The tip for `near` (the nearest probe in PROBE_IN_RANGE, or null), from
 * the beam's origin and unit direction: "grab" only when grabbableProbe
 * would select a probe this frame, "turn" inside BEAM_RANGE but outside the
 * cone, "closer" beyond it.
 */
export function probeTip(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  pos: PosMap, relocating: FlagMap, near: string | null,
): ProbeTip {
  if (near === null) return null;
  if (grabbableProbe(ox, oy, oz, dx, dy, dz, pos, relocating) !== null) return "grab";
  const p = pos[near];
  if (!p) return null;
  return Math.hypot(p.x - ox, p.y - oy, p.z - oz) <= BEAM_RANGE ? "turn" : "closer";
}

export function probeTipText(tip: ProbeTip, pad: boolean, coarse: boolean): string | null {
  switch (tip) {
    case "grab": return `PROBE IN RANGE // HOLD ${pad ? "LB" : coarse ? "BEAM" : "F"} TO GRAB`;
    case "turn": return "PROBE NEARBY // TURN TOWARD IT";
    case "closer": return "PROBE NEARBY // FLY CLOSER";
    default: return null;
  }
}

/** The trim paint's pull toward its own luminance (turntable_probe.py DESAT). */
export const TRIM_DESAT = 0.6;

/**
 * The painted trim's multiply colour (linear in, linear out): the project
 * colour pulled TRIM_DESAT of the way to its own Rec. 709 luminance, the
 * same as scripts/blender/turntable_probe.py toned(), so the game matches
 * the model preview.
 */
export function trimTone(r: number, g: number, b: number, out: { r: number; g: number; b: number }): void {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  out.r = r + TRIM_DESAT * (y - r);
  out.g = g + TRIM_DESAT * (y - g);
  out.b = b + TRIM_DESAT * (y - b);
}
