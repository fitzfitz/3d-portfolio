import {
  planets, PORTAL_POS, PORTAL_ZONE_R, LOCK_ENGAGE_FACTOR, LOCK_RETAIN_FACTOR, ZONE_FACTOR,
} from "../../src/constants";
import { orbitPosition, type OrbitalElements } from "../../src/utils/orbits";
import { keplerPosition } from "../../src/utils/kepler";
import { COMETS } from "../../src/data/comets";
import { JELLY_PATH } from "../../src/data/jellyfishPath";
import { JELLY_RADIUS } from "../../src/utils/jellyMood";
import { SHARDS } from "../../src/data/shards";
import { ASTEROID_COLLIDERS, SUN_COLLIDER } from "../../src/data/asteroids";
import { RING_GATES, RING_RADIUS } from "../../src/data/ringCourse";
import { STATION_POS, STATION_RADII, BUOYS, BUOY_CARD_R } from "../../src/data/careerTrail";
import { SHIPYARD_POS, SHIPYARD_RADII } from "../../src/data/shipyard";
import { GATE_POS, GATE_KEEP_OUT } from "../../src/data/dormantGate";
import { SPAWN } from "../../src/data/spawn";
import { HAZE_START } from "../../src/utils/edgeHaze";
import type { WorldTypeId } from "../../src/data/worldTypes";
import { RING_REACH_FACTOR } from "../../src/utils/ringOptics";
import { beltClearance, MOON_REACH_FACTOR, MARGIN } from "./clearance";

/**
 * The placement rules every world obeys (spec "Where they orbit"), shared by
 * tests/worldClearance.test.ts, which sweeps the orbits, and the search tool
 * tests/worldOrbitSearch.test.ts, which measures the same rules with an exact
 * circle distance. Each rule yields a margin; a world is placed when every
 * margin is positive.
 */

/** The ringed giant's reach (ringOptics.ts): its A ring ends at 2.27 equatorial radii. */
export { RING_REACH_FACTOR };
/** World-vs-planet and world-vs-world gap, after both bodies. */
export const BODY_GAP = 7;
/** A world's body stays this far inside the haze; its gravity well may reach into it. */
export const HAZE_PAD = 20;

/** A candidate world: what the rules need to know about it. */
export interface WorldShape { id: string; type: WorldTypeId; size: number; orbit: OrbitalElements }
/** Another orbiting body it must keep its gap from, with its reach. */
export interface Orbiter { name: string; reach: number; orbit: OrbitalElements }
export interface Margin { what: string; margin: number }
/** Closest approach of an orbit (swept whole) to a fixed point. */
export type ToOrbit = (orbit: OrbitalElements, p: readonly number[]) => number;

export const worldReach = (w: { type: WorldTypeId; size: number }): number =>
  w.type === "ringed-giant" ? w.size * RING_REACH_FACTOR : w.size;

/** Planets as orbiters: their reach covers their moons (MOON_REACH_FACTOR). */
export const PLANET_ORBITERS: readonly Orbiter[] = planets.map((p) => ({
  name: p.name, reach: p.size * MOON_REACH_FACTOR, orbit: p.orbit,
}));

const ORBIT_SAMPLES = 360;
const COMET_SAMPLES = 720;
const JELLY_SAMPLES = 400;

const sampleOrbit = (o: OrbitalElements, n: number): number[][] => {
  const period = (Math.PI * 2) / o.angularSpeed;
  return Array.from({ length: n }, (_, k) => { const q = orbitPosition(o, (k / n) * period); return [q.x, q.y, q.z]; });
};
/** Each orbiter's swept points, sampled once per orbit. */
const swept = new WeakMap<OrbitalElements, number[][]>();
const sweptPoints = (o: OrbitalElements): number[][] => {
  let pts = swept.get(o);
  if (!pts) { pts = sampleOrbit(o, ORBIT_SAMPLES); swept.set(o, pts); }
  return pts;
};
const COMET_POINTS = COMETS.map((c) => Array.from({ length: COMET_SAMPLES }, (_, k) => {
  const q = keplerPosition((k / COMET_SAMPLES) * c.periodSeconds, c);
  return [q.x, q.y, q.z];
}));
const JELLY_POINTS = Array.from({ length: JELLY_SAMPLES }, (_, i) => {
  const v = JELLY_PATH.getPointAt(i / JELLY_SAMPLES);
  return [v.x, v.y, v.z];
});
const SPAWN_V = [SPAWN.x, SPAWN.y, SPAWN.z];
/** Landmarks with their keep-outs, as careerTrail / shipyardGate test them. */
const LANDMARKS: { name: string; pos: readonly number[]; keepOut: number }[] = [
  { name: "station", pos: STATION_POS, keepOut: STATION_RADII.zoneR },
  ...BUOYS.map((b) => ({ name: b.id, pos: b.pos, keepOut: BUOY_CARD_R })),
  { name: "shipyard", pos: SHIPYARD_POS, keepOut: SHIPYARD_RADII.zoneR },
  { name: "dormant gate", pos: GATE_POS, keepOut: GATE_KEEP_OUT },
];

const minTo = (dist: ToOrbit, o: OrbitalElements, pts: readonly (readonly number[])[]): number => {
  let m = Infinity;
  for (const p of pts) m = Math.min(m, dist(o, p));
  return m;
};

/**
 * Every rule's margin for world `w`, against the planets and `others` (the
 * other worlds). Each rule is the one the existing placement tests use, with
 * the world's reach where the body itself is bigger than the rule's radius
 * (the ringed giant's rings):
 * - planets and worlds: gap ≥ BODY_GAP after both reaches;
 * - comets: reach + MARGIN from either path, sampled over its period;
 * - jelly path: reach + JELLY_RADIUS + 2 (planetClearance);
 * - the sun's collider, the belt and the halo (careerTrail);
 * - shards: lock-retain radius; scenery asteroids: reach + r + 2; ring gates:
 *   lock-engage radius + RING_RADIUS + 2; the portal's zone (planetClearance);
 * - station, buoys, shipyard, dormant gate: moon reach + keep-out + MARGIN
 *   (careerTrail, shipyardGate); spawn: moon reach + 8.5 + MARGIN + 40 (spawn);
 * - the body (not its well) stays HAZE_PAD inside the haze.
 */
export function worldMargins(w: WorldShape, others: readonly Orbiter[], dist: ToOrbit): Margin[] {
  const reach = worldReach(w);
  const out: Margin[] = [];
  const atLeast = (f: number) => Math.max(w.size * f, reach);
  for (const o of [...PLANET_ORBITERS, ...others]) {
    out.push({ what: `gap to ${o.name}`, margin: minTo(dist, w.orbit, sweptPoints(o.orbit)) - (reach + o.reach + BODY_GAP) });
  }
  COMET_POINTS.forEach((pts, i) => out.push({ what: `comet ${i}`, margin: minTo(dist, w.orbit, pts) - (reach + MARGIN) }));
  out.push({ what: "jelly path", margin: minTo(dist, w.orbit, JELLY_POINTS) - (reach + JELLY_RADIUS + 2) });
  out.push({ what: "sun", margin: w.orbit.radius - reach - (SUN_COLLIDER.r + MARGIN) });
  let belt = Infinity, halo = Infinity;
  for (const q of sampleOrbit(w.orbit, ORBIT_SAMPLES)) {
    belt = Math.min(belt, beltClearance(q, 0.436, 40, 70, 2.5));
    halo = Math.min(halo, beltClearance(q, 1.31, 80, 95, 4.5));
  }
  out.push({ what: "belt", margin: belt - reach }, { what: "halo", margin: halo - reach });
  SHARDS.forEach((s, i) => out.push({ what: `shard ${i}`, margin: dist(w.orbit, s.pos) - atLeast(LOCK_RETAIN_FACTOR) }));
  for (const a of ASTEROID_COLLIDERS) out.push({ what: a.id, margin: dist(w.orbit, [a.x, a.y, a.z]) - (reach + a.r + 2) });
  RING_GATES.forEach((g, i) => out.push({ what: `ring gate ${i}`, margin: dist(w.orbit, g) - (atLeast(LOCK_ENGAGE_FACTOR) + RING_RADIUS + 2) }));
  out.push({ what: "portal", margin: dist(w.orbit, PORTAL_POS) - (atLeast(ZONE_FACTOR) + PORTAL_ZONE_R) });
  for (const l of LANDMARKS) out.push({ what: l.name, margin: dist(w.orbit, l.pos) - (atLeast(MOON_REACH_FACTOR) + l.keepOut + MARGIN) });
  out.push({ what: "spawn", margin: dist(w.orbit, SPAWN_V) - (atLeast(MOON_REACH_FACTOR) + 8.5 + MARGIN + 40) });
  out.push({ what: "haze", margin: HAZE_START - HAZE_PAD - (w.orbit.radius + reach) });
  return out;
}
