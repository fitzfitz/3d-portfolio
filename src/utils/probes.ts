import { PROBES, PROBE_IDS, type ProbeDef, type Vec3T } from "../data/probes";
import { BEAM_RANGE, inCone } from "./tractorBeam";
import { worldToRadar } from "./radarTransform";
import { nextWaypoint } from "./navigation";

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

/**
 * How many of the probes in play (`probeIds`) have had their dossier read.
 * `visited` may hold a project that has no probe this visit (D1 dropped it, or
 * it is past the slot cap), which must not count toward "ALL N DOSSIERS READ".
 */
export function probeDossiersRead(visited: readonly string[], probeIds: readonly string[]): number {
  let n = 0;
  for (const id of probeIds) if (visited.includes(id)) n++;
  return n;
}

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

/** The spawn card's first line for n probes (it said "Three probes carry three projects."). */
export function probeIntro(n: number): string {
  const w = NUMBER_WORDS[n] ?? String(n);
  return n === 1
    ? "One probe carries one project. Grab it with the tractor beam to open it."
    : `${w} probes carry ${w.toLowerCase()} projects. Grab one with the tractor beam to open it.`;
}

/** Seconds a closed probe's burn lasts before it vanishes. */
export const RELOCATE_S = 2.5;
/**
 * Distance flown along the burn direction over the whole burn. Far enough
 * that the probe has dwindled to a spark (or left the frame) before it
 * dwindles out for good (relocationScale) and snaps to its new spot.
 */
export const RELOCATE_DIST = 90;

/** Distance flown after t seconds: ease-in (quadratic), 0 at 0, RELOCATE_DIST at RELOCATE_S. */
export function relocationTravel(t: number): number {
  const k = Math.min(Math.max(t / RELOCATE_S, 0), 1);
  return RELOCATE_DIST * k * k;
}

const smooth01 = (k: number): number => {
  const c = Math.min(Math.max(k, 0), 1);
  return c * c * (3 - 2 * c);
};

/** Seconds at the end of the burn over which the probe shrinks away before the snap. */
export const POP_FADE_S = 0.35;
/** Seconds a relocated probe takes to grow back in at its new spot. */
export const ARRIVE_S = 0.6;

/**
 * The burning probe's scale at burn time t: 1, then eased down to 0 over the
 * last POP_FADE_S, so the snap to the new spot (spec §4.2 call 6: "pops to
 * the final spot outside view") never shows a probe vanishing at full size.
 */
export function relocationScale(t: number): number {
  return 1 - smooth01((t - (RELOCATE_S - POP_FADE_S)) / POP_FADE_S);
}

/** A relocated probe's scale `t` seconds after the snap: eased 0 to 1 over ARRIVE_S; 1 under reduced motion. */
export function arrivalScale(t: number, reducedMotion: boolean): number {
  return reducedMotion ? 1 : smooth01(t / ARRIVE_S);
}

/** Burn seconds at which the main engine lights (the dish is still swinging onto the burn line). */
const PLUME_IGNITE_S = 0.12;
/** Burn seconds the plume takes to reach full length. */
const PLUME_RISE_S = 0.35;

/**
 * The relocation plume's level (0..1) at burn time t: lights just after the
 * close, rises over PLUME_RISE_S, holds, and shrinks with the probe at the end.
 */
export function burnPlume(t: number): number {
  return smooth01((t - PLUME_IGNITE_S) / PLUME_RISE_S) * relocationScale(t);
}

/** Camera distance (u) inside which the nozzle flare is off: the bell and the plume's root show. */
export const FLARE_CLEAR_DIST = 20;
/** Camera distance (u) past which the nozzle flare is at full strength (the probe is a few pixels). */
export const FLARE_FULL_DIST = 45;

/**
 * The nozzle flare's share (0..1) at camera distance `dist`. The flare is a
 * soft sprite that keeps a burn reading as a hot point at range; up close it
 * sat over the main engine bell and hid it, while the plume alone already
 * reads there. So it fades in with range, smoothly, between FLARE_CLEAR_DIST
 * and FLARE_FULL_DIST.
 */
export function burnFlare(dist: number): number {
  return smooth01((dist - FLARE_CLEAR_DIST) / (FLARE_FULL_DIST - FLARE_CLEAR_DIST));
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

type PosMap = Readonly<Record<string, { x: number; y: number; z: number }>>;
type FlagMap = Readonly<Record<string, boolean>>;
type Vec3Out = { x: number; y: number; z: number };

/**
 * Where a jump to probe `id` should aim, written into `out`; false for an
 * unknown id. A probe mid-burn is about to snap to its next spot (the close
 * already advanced `spots`), so the jump targets that final spot rather than
 * the live mid-burn position, which would leave the ship in empty space.
 * Allocation-free.
 */
export function probeJumpTarget(id: string, pos: PosMap, relocating: FlagMap, spots: Readonly<Record<string, number>>, out: Vec3Out): boolean {
  for (let i = 0; i < PROBES.length; i++) {
    const def = PROBES[i];
    if (def.id !== id) continue;
    const p = pos[id];
    if (relocating[id] || !p) {
      const s = spotPos(def, spots[id] ?? 0);
      out.x = s[0]; out.y = s[1]; out.z = s[2];
    } else {
      out.x = p.x; out.y = p.y; out.z = p.z;
    }
    return true;
  }
  return false;
}

/**
 * What the parked ship's pre-flight auto-aim faces, written into `out`: the
 * probe the waypoint picks (the nearest unread one, nextWaypoint over
 * PROBE_IDS), or probe 1's home once every dossier is read.
 */
export function spawnAimPoint(ship: Vec3Out, pos: PosMap, visited: readonly string[], out: Vec3Out): void {
  const id = nextWaypoint(ship, PROBE_IDS, pos as Record<string, Vec3Out>, visited, "");
  const p = id ? pos[id] : undefined;
  if (p) { out.x = p.x; out.y = p.y; out.z = p.z; return; }
  const h = PROBES[0].home;
  out.x = h[0]; out.y = h[1]; out.z = h[2];
}

/** A released probe drifts back to its spot at this speed (u/s). */
export const PROBE_DRIFT_SPEED = 2;

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

/**
 * What the HUD pickup tip says: the beam would take a probe, the probe is in
 * the cone but tethered pebbles hold every beam slot, it is near but out of
 * the cone, or out of reach.
 */
export type ProbeTip = "grab" | "full" | "turn" | "closer" | null;

/**
 * The tip for `near` (the nearest probe in PROBE_IN_RANGE, or null), from
 * the beam's origin and unit direction. `slots` is the beam budget left
 * after tethered pebbles (BEAM_MAX_TARGETS - tetherCount(), TractorBeam's
 * `budget`). "grab" only when TractorBeam would select a probe this frame
 * (grabbableProbe, and a free slot), "full" when it is in the cone with no
 * slot free, "turn" inside BEAM_RANGE but outside the cone, "closer" beyond it.
 */
export function probeTip(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  pos: PosMap, relocating: FlagMap, near: string | null, slots: number,
): ProbeTip {
  if (near === null) return null;
  if (grabbableProbe(ox, oy, oz, dx, dy, dz, pos, relocating) !== null) return slots > 0 ? "grab" : "full";
  const p = pos[near];
  if (!p) return null;
  return Math.hypot(p.x - ox, p.y - oy, p.z - oz) <= BEAM_RANGE ? "turn" : "closer";
}

export function probeTipText(tip: ProbeTip, pad: boolean, coarse: boolean): string | null {
  switch (tip) {
    case "grab": return `PROBE IN RANGE // HOLD ${pad ? "LB" : coarse ? "BEAM" : "F"} TO GRAB`;
    case "full": return "PROBE IN RANGE // BEAM FULL OF ROCK, KEEP HOLDING";
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
