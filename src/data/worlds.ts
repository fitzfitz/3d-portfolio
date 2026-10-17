import { AU, PROGRADE, sunOmega } from "../constants";
import type { OrbitalElements } from "../utils/orbits";
import type { WorldTypeId } from "./worldTypes";

/**
 * The new worlds (docs/superpowers/specs/2026-10-17-new-worlds-design.md,
 * roster A). Ids are final: they are saved in visitors' browsers.
 */
export const WORLD_IDS = ["w-rock", "w-ringed", "w-tilted", "w-blue", "w-dwarf"] as const;
export type WorldId = (typeof WORLD_IDS)[number];
export const WORLD_COUNT = 5;

export interface WorldData {
  id: WorldId;
  /** Display name: descriptive, not a solar-system name (P2). */
  name: string;
  /** The real body this type is modelled on ("<namesake>-TYPE"). */
  namesake: string;
  type: WorldTypeId;
  /** Equatorial radius (u). */
  size: number;
  /** (equatorial − polar) / equatorial; 0 draws a sphere. */
  flattening: number;
  bondAlbedo: number;
  /** Obliquity: the spin axis's angle from the orbit normal. Above 90° the spin runs backwards (L9). */
  axialTiltDeg: number;
  /** rad/s, a rotation.y rate about the world's own (tilted) axis, signed by PROGRADE. */
  spin: number;
  /** Circular (e = 0); angularSpeed is Kepler's (sunOmega). */
  orbit: OrbitalElements;
  /** Texture base name. */
  map: string;
  /** One honest locating hint for the uncharted logbook card. */
  hint: string;
  /**
   * The real namesake's own numbers, labelled as the real body's, never as this
   * world's: its mean distance from the Sun and its equilibrium (black-body)
   * temperature, the same definition the worlds' own temperatures use
   * (utils/worldPhysics.ts). Source: NASA NSSDC Planetary Fact Sheets
   * (nssdc.gsfc.nasa.gov/planetary/factsheet/), semimajor axis ÷ 149.598e6 km
   * and "Black-body temperature"; Ceres has no fact sheet, so its value is
   * equilibriumTempK at 2.77 AU with Bond albedo 0.034.
   */
  namesakeRef: { distanceAU: number; tempC: number };
}

const DEG = Math.PI / 180;
const circular = (radius: number, incDeg: number, nodeDeg: number, phase: number): OrbitalElements => ({
  radius, angularSpeed: sunOmega(radius), inclination: incDeg * DEG, node: nodeDeg * DEG, phase,
});

/**
 * Spins are compressed (P3) from the real sidereal days, Saturn's 10.66 h set
 * to 0.3 rad/s: Uranus 17.24 h, Neptune 16.11 h, Ceres 9.07 h. The Mercury-type
 * spins at an ordinary rate: at 1.9 AU tides cannot slow it (spec, Rotation).
 *
 * Orbits come from tests/worldOrbitSearch.test.ts (run with WORLD_SEARCH=1)
 * under the rules in tests/helpers/worldRules.ts, which
 * tests/worldClearance.test.ts holds permanently. Each comment gives the
 * world's worst margin (u) and what sets it. Phases are spread, not chosen.
 */
export const WORLDS: readonly WorldData[] = [
  {
    id: "w-rock", name: "AIRLESS ROCK", namesake: "Mercury", type: "airless-rock",
    size: 5.7, flattening: 0, bondAlbedo: 0.068, axialTiltDeg: 0.03, spin: PROGRADE * 0.15,
    orbit: circular(219, -28.5, 140, 1.0), // 1.90 AU; worst 2.8: gap to the ringed giant (3.7 to Fuxx)
    map: "w-rock", hint: "just beyond the Mars-type's orbit, small and cratered",
    namesakeRef: { distanceAU: 0.387, tempC: 166 }, // 439.6 K
  },
  {
    id: "w-ringed", name: "RINGED GIANT", namesake: "Saturn", type: "ringed-giant",
    size: 15, flattening: 0.1, bondAlbedo: 0.342, axialTiltDeg: 26.7, spin: PROGRADE * 0.3,
    orbit: circular(269, 40, 295, 3.5), // 2.34 AU; worst 2.8: gap to the rock (2.86 to comet 1's path)
    map: "w-ringed", hint: "beyond the Mars-type's orbit, ringed",
    namesakeRef: { distanceAU: 9.573, tempC: -192 }, // 81.0 K
  },
  {
    id: "w-tilted", name: "TILTED ICE GIANT", namesake: "Uranus", type: "ice-giant",
    size: 13.5, flattening: 0, bondAlbedo: 0.3, axialTiltDeg: 97.8, spin: PROGRADE * 0.19,
    orbit: circular(353, -40, 60, 0.4), // 3.07 AU; worst 10.45: gap to the dwarf
    map: "w-tilted", hint: "far beyond the Mars-type's orbit, the inner ice giant, pale cyan",
    namesakeRef: { distanceAU: 19.165, tempC: -215 }, // 58.1 K
  },
  {
    id: "w-blue", name: "BLUE ICE GIANT", namesake: "Neptune", type: "ice-giant",
    size: 13, flattening: 0, bondAlbedo: 0.29, axialTiltDeg: 28.3, spin: PROGRADE * 0.2,
    orbit: circular(397, -40, 0, 2.6), // 3.45 AU; worst 10.0: the edge haze
    map: "w-blue", hint: "the outermost world, near the edge haze, deep blue",
    namesakeRef: { distanceAU: 30.181, tempC: -227 }, // 46.6 K
  },
  {
    id: "w-dwarf", name: "SALT-SPOTTED DWARF", namesake: "Ceres", type: "salt-dwarf",
    size: 3.5, flattening: 0, bondAlbedo: 0.034, axialTiltDeg: 4, spin: PROGRADE * 0.35,
    orbit: circular(2.77 * AU, 39.5, 240, 5.2), // 2.77 AU, real Ceres's distance; worst 4.55: gap to the ringed giant
    map: "w-dwarf", hint: "at 2.77 AU, real Ceres's distance, tiny and dark",
    namesakeRef: { distanceAU: 2.77, tempC: -107 }, // ~166 K, computed
  },
];

const IDS: ReadonlySet<string> = new Set(WORLD_IDS);
export const isWorld = (id: string): id is WorldId => IDS.has(id);
