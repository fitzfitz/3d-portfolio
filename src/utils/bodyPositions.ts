import type { BodyId } from "../data/bodyIds";
import { SOLAR_BODIES, type SolarBody } from "../data/solarSystem";
import { bodySlot, setOccluder } from "../components/canvas/sunShadow";
import { eclipticToWorld, orbitShape, osculatingEcliptic, planetEcliptic, visVivaKmS, type Ecl } from "./ephemeris";
import { orreryJd } from "./orreryClock";
import type { Vec3 } from "./reactions";
import { setScannable } from "./scannables";

/**
 * Where the nine bodies are (docs/superpowers/specs/2026-10-20-real-solar-system-design.md
 * §4): the ephemeris at the orrery date for `gameSeconds` of the ambient clock,
 * mapped into the world by eclipticToWorld. Allocation-free when `out` is given.
 */

const ecl: Ecl = { x: 0, y: 0, z: 0 };

function eclipticAt(b: SolarBody, jd: number, out: Ecl): Ecl {
  return b.orbit.kind === "jpl" ? planetEcliptic(b.orbit.el, jd, out) : osculatingEcliptic(b.orbit.el, jd, out);
}

/** Body `b`'s world position at `gameSeconds` (via orreryJd), written into `out`. */
export function bodyPositionAt(b: SolarBody, gameSeconds: number, out: Vec3): Vec3 {
  eclipticAt(b, orreryJd(gameSeconds), ecl);
  return eclipticToWorld(ecl, out);
}

/**
 * Live distance from the Sun (AU) and orbital speed (km/s, vis-viva) at
 * `gameSeconds`: what lighting (§4.8: sunlight on rims and rings varies along
 * an eccentric orbit) and scans read. Allocates its small result: not for a
 * per-frame loop over many bodies (use `bodies` and the distance there).
 */
export function heliocentric(b: SolarBody, gameSeconds: number): { rAU: number; speedKmS: number } {
  const jd = orreryJd(gameSeconds);
  eclipticAt(b, jd, ecl);
  const rAU = Math.hypot(ecl.x, ecl.y, ecl.z);
  return { rAU, speedKmS: visVivaKmS(rAU, orbitShape(b.orbit.el, jd).a) };
}

/** Fixed per body, computed once: the frame loop allocates nothing. */
const SLOTS = SOLAR_BODIES.map((b) => bodySlot(b.id));

let lastGameSeconds = 0;
/** The game time `bodies` was last written for: the HUD and the chart date themselves from it, so date and positions agree. */
export const bodiesGameSeconds = (): number => lastGameSeconds;

/**
 * The frame drive, the one writer of `bodies`: each body's position into
 * `out[b.id]` (in place; no other key is touched), its scannable (measured
 * from its surface, labelled with its real name) and, if it holds one, its
 * occluder slot at its equatorial radius. Mercury, Venus and Ceres have no GPU
 * slot (sunShadow.ts); the CPU lists read them from `bodies`. The moons' slots
 * are moonOrbits.ts updateMoons'.
 */
export function updateBodies(gameSeconds: number, out: Record<BodyId, Vec3>): void {
  lastGameSeconds = gameSeconds;
  const jd = orreryJd(gameSeconds);
  for (let i = 0; i < SOLAR_BODIES.length; i++) {
    const b = SOLAR_BODIES[i];
    const p = out[b.id];
    eclipticToWorld(eclipticAt(b, jd, ecl), p);
    setScannable(b.id, p.x, p.y, p.z, b.name, b.size);
    if (SLOTS[i] >= 0) setOccluder(SLOTS[i], p.x, p.y, p.z, b.size);
  }
}
