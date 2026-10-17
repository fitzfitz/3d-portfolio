import { gmOf, PROGRADE, planets } from "../constants";
import { keplerOmega } from "../utils/kepler";
import { MOON_TINTS } from "./moonTints";

/**
 * Every moon in the scene, drawn by OrbitingMoon in SpacePlanets.tsx
 * (docs/UNIVERSE-RULES.md L11). A moon's speed is not stored: it follows
 * Kepler's third law around its planet (gmOf, its own mass), turning with the planet's
 * spin unless `captured` — a moon caught from outside orbits backwards, as
 * Neptune's Triton does. Moons are tidally locked: they never spin on their own.
 */
export interface MoonSpec {
  /** Also the MOON_TINTS key. */
  id: keyof typeof MOON_TINTS;
  /** Index into `planets`. */
  planet: number;
  /** Orbit radius, × planet size. */
  distance: number;
  /** Moon radius, × planet size. */
  size: number;
  /** Tilt of the orbit off the planet's equator (rad, about X). */
  inclination: number;
  phase: number;
  variant: "Rock" | "Ice" | "Volcanic";
  captured: boolean;
}

export const MOONS: readonly MoonSpec[] = [
  { id: "ruangrapiRock", planet: 0, distance: 1.7, size: 0.104, inclination: 0.45, phase: 0, variant: "Rock", captured: false },
  { id: "portfolioIce", planet: 1, distance: 1.9, size: 0.0875, inclination: -0.3, phase: 2, variant: "Ice", captured: true },
  { id: "portfolioRock", planet: 1, distance: 1.38, size: 0.115, inclination: 0.1, phase: 4.2, variant: "Rock", captured: false },
  { id: "fuxxVolcanic", planet: 2, distance: 1.6, size: 0.094, inclination: 0.6, phase: 0, variant: "Volcanic", captured: false },
  { id: "fuxxIce", planet: 2, distance: 2.1, size: 0.0625, inclination: -0.2, phase: 3.5, variant: "Ice", captured: true },
];

/** The moon's orbit-group `rotation.y` rate (rad/s), signed by direction. */
export function moonOrbitSpeed(m: MoonSpec): number {
  const omega = keplerOmega(m.distance * planets[m.planet].size, gmOf(planets[m.planet]));
  return (m.captured ? -PROGRADE : PROGRADE) * omega;
}

/**
 * The moon's centre relative to its planet's, at orbit angle `angle` (the
 * orbit group's `rotation.y`): (distance, 0, 0) turned about Y, then tilted
 * about X by the inclination, as OrbitingMoon's two groups do. Written into
 * `out` so frame loops allocate nothing.
 */
export function moonOffset<T extends { x: number; y: number; z: number }>(m: MoonSpec, angle: number, out: T): T {
  const d = m.distance * planets[m.planet].size;
  const c = Math.cos(angle), s = Math.sin(angle);
  out.x = d * c;
  out.y = d * s * Math.sin(m.inclination);
  out.z = -d * s * Math.cos(m.inclination);
  return out;
}
