import { SOLAR_BODIES, BODY_REACH } from "../../src/data/solarSystem";
import { moonSystemReach, SOLAR_MOONS } from "../../src/data/solarMoons";
import { makeBelt, makeTrojans, BELT_COUNT, TROJAN_COUNT, COMET_ELEMENTS } from "../../src/data/smallBodyField";
import { orbitShape, eclipticToWorld } from "../../src/utils/ephemeris";
import { ORRERY_TEST_JD } from "../../src/utils/orreryClock";
import { PLANET_WELL_RADIUS_FACTOR } from "../../src/utils/gravityWell";
import { PORTAL_POS, PORTAL_ZONE_R } from "../../src/constants";
import { STATION_POS, STATION_RADII, BUOY_CARD_R, TRAIL_START, TRAIL_BEND, TRAIL_END, possibleBuoyPositions } from "../../src/data/careerTrail";
import { SHIPYARD_POS, SHIPYARD_RADII } from "../../src/data/shipyard";
import { GATE_POS, GATE_KEEP_OUT } from "../../src/data/dormantGate";
import { RING_GATES, RING_RADIUS } from "../../src/data/ringCourse";
import { PROBE_SLOTS, PROBE_RADIUS } from "../../src/data/probes";
import { SPAWN } from "../../src/data/spawn";
import { SHARDS, SHARD_PICKUP_RADIUS } from "../../src/data/shards";
import { ASTEROID_COLLIDERS } from "../../src/data/asteroids";
import { JELLY_PATH } from "../../src/data/jellyfishPath";
import { JELLY_RADIUS } from "../../src/utils/jellyMood";
import { DEEP_SPACE_POINT } from "../e2e/deepSpacePoint.mjs";

/**
 * Clearance of fixed landmarks against the real Solar System (design §6.4):
 * every body's swept ellipse, its gravity well and moon system, plus the
 * swept orbits of the belt, Trojans and comets. A landmark's margin is its
 * distance minus every keep-out; it clears when the margin is positive.
 */
export type Vec3 = readonly [number, number, number];
export interface OrbitShape { a: number; e: number; i: number; node: number; argPeri: number }

export const MARGIN = 4;
/** A belt, Trojan or comet rock's keep-out radius (largest drawn rock scale 1.5 × ~1.3 u, rounded up). */
export const ROCK_RADIUS = 2;
/** The deep-space point stays this far from every swept orbit, so it is fair "deep space". */
export const DEEP_SPACE_MIN = 60;
/** Spawn pad keep-out (the existing spawn rule's 8.5). */
export const SPAWN_RADIUS = 8.5;
export const BODY_SAMPLES = 2000;
export const ROCK_SAMPLES = 512;

/** Points of an orbit in world units, uniform in eccentric anomaly. */
export function sweptOrbit(shape: OrbitShape, samples: number): Vec3[] {
  const { a, e, i, node, argPeri } = shape;
  const cw = Math.cos(argPeri), sw = Math.sin(argPeri);
  const cO = Math.cos(node), sO = Math.sin(node);
  const cI = Math.cos(i), sI = Math.sin(i);
  const b = a * Math.sqrt(1 - e * e);
  const out: Vec3[] = [];
  const w = { x: 0, y: 0, z: 0 };
  for (let k = 0; k < samples; k++) {
    const E = (k / samples) * Math.PI * 2;
    const xp = a * (Math.cos(E) - e), yp = b * Math.sin(E);
    const ecl = {
      x: (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
      y: (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
      z: sw * sI * xp + cw * sI * yp,
    };
    eclipticToWorld(ecl, w);
    out.push([w.x, w.y, w.z]);
  }
  return out;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const minDist = (pts: readonly Vec3[], p: Vec3) => {
  let m = Infinity;
  for (const q of pts) m = Math.min(m, dist(q, p));
  return m;
};

const hasMoons = (id: string) => SOLAR_MOONS.some((m) => m.parent === id);
/** A body's keep-out radius: its well (size × 3.5) plus its moon system's reach. */
export const bodyKeepOut = (id: string): number => {
  const b = BODY_REACH.find((r) => r.key === id)!;
  return Math.max(b.size * PLANET_WELL_RADIUS_FACTOR, b.reach) + (hasMoons(id) ? moonSystemReach(id as never) : 0);
};

interface BodyOrbit { name: string; keepOut: number; pts: Vec3[] }
interface RockOrbit { name: string; pts: Vec3[] }

export const BODY_ORBITS: BodyOrbit[] = SOLAR_BODIES.map((b) => ({
  name: b.id, keepOut: bodyKeepOut(b.id), pts: sweptOrbit(orbitShape(b.orbit.el, ORRERY_TEST_JD), BODY_SAMPLES),
}));
export const ROCK_ORBITS: RockOrbit[] = [
  ...makeBelt(BELT_COUNT, 42).map((r, k) => ({ name: `belt ${k}`, el: r.el })),
  ...makeTrojans(TROJAN_COUNT, 1337).map((r, k) => ({ name: `trojan ${k}`, el: r.el })),
  ...COMET_ELEMENTS.map((el, k) => ({ name: `comet ${k}`, el })),
].map((r) => ({ name: r.name, pts: sweptOrbit(orbitShape(r.el, ORRERY_TEST_JD), ROCK_SAMPLES) }));

/** Margin of every rule for a landmark of the given radius; the smallest is the landmark's margin. */
export function landmarkMargins(p: Vec3, radius: number): { what: string; margin: number }[] {
  const out: { what: string; margin: number }[] = [];
  for (const o of BODY_ORBITS) out.push({ what: o.name, margin: minDist(o.pts, p) - (o.keepOut + radius + MARGIN) });
  for (const o of ROCK_ORBITS) out.push({ what: o.name, margin: minDist(o.pts, p) - (ROCK_RADIUS + radius + MARGIN) });
  return out;
}
export const landmarkMargin = (p: Vec3, radius: number): number =>
  Math.min(...landmarkMargins(p, radius).map((m) => m.margin));

/** Name of the worst rule, for failure messages. */
export const worstRule = (p: Vec3, radius: number): string => {
  const ms = landmarkMargins(p, radius);
  return ms.reduce((a, b) => (b.margin < a.margin ? b : a)).what;
};

/** Distance from the deep-space point to the nearest swept orbit of any kind. */
export const deepSpaceGap = (p: Vec3): number =>
  Math.min(...[...BODY_ORBITS, ...ROCK_ORBITS].map((o) => minDist(o.pts, p)));

export interface Landmark { name: string; pos: Vec3; radius: number }
export const LANDMARKS: Landmark[] = [
  { name: "career station", pos: STATION_POS, radius: STATION_RADII.zoneR },
  { name: "trail start", pos: TRAIL_START, radius: BUOY_CARD_R },
  { name: "trail bend", pos: TRAIL_BEND, radius: BUOY_CARD_R },
  { name: "trail end", pos: TRAIL_END, radius: BUOY_CARD_R },
  // Every spot a buoy can take for 1 to MAX_BUOYS jobs, not just this list's (the list comes from D1).
  ...possibleBuoyPositions().map((p, i) => ({ name: `buoy spot ${i}`, pos: p, radius: BUOY_CARD_R })),
  { name: "shipyard", pos: SHIPYARD_POS, radius: SHIPYARD_RADII.zoneR },
  { name: "dormant gate", pos: GATE_POS, radius: GATE_KEEP_OUT },
  // The portal's proximity zone is PORTAL_ZONE_R (2.2 u, the zone itself, not a scaled planet zone); a body's own zone (1.8 x size) lies inside its 3.5 x size well.
  { name: "portal", pos: PORTAL_POS, radius: PORTAL_ZONE_R },
  // Every probe slot, used or not: which projects sit on them comes from D1.
  ...PROBE_SLOTS.flatMap((p, k) => [
    { name: `probe slot ${k + 1} home`, pos: p.home, radius: PROBE_RADIUS },
    ...p.remote.map((r, i) => ({ name: `probe slot ${k + 1} remote ${i + 1}`, pos: r, radius: PROBE_RADIUS })),
  ]),
  ...RING_GATES.map((g, i) => ({ name: `ring gate ${i}`, pos: g as Vec3, radius: RING_RADIUS })),
  ...SHARDS.map((s, i) => ({ name: `shard ${i}`, pos: s.pos as Vec3, radius: SHARD_PICKUP_RADIUS })),
  ...ASTEROID_COLLIDERS.map((a) => ({ name: `scenery ${a.id}`, pos: [a.x, a.y, a.z] as Vec3, radius: a.r })),
  { name: "spawn", pos: [SPAWN.x, SPAWN.y, SPAWN.z], radius: SPAWN_RADIUS },
  { name: "deep-space point", pos: DEEP_SPACE_POINT as unknown as Vec3, radius: 0 },
];

/** The jellyfish's swim path, 400 points as the old test sampled it, each held at JELLY_RADIUS. */
export const JELLY_POINTS: Vec3[] = Array.from({ length: 400 }, (_, i) => {
  const v = JELLY_PATH.getPointAt(i / 400);
  return [v.x, v.y, v.z] as Vec3;
});
export const JELLY_KEEP_RADIUS = JELLY_RADIUS;

/** Every landmark with its margin, for the ledger. */
export const clearanceReport = (): { name: string; margin: number }[] =>
  LANDMARKS.map((l) => ({ name: l.name, margin: landmarkMargin(l.pos, l.radius) }));
