import { AU, PROGRADE, planets, sunOmega } from "../constants";
import type { OrbitalElements } from "../utils/orbits";
import type { WorldTypeId } from "./worldTypes";
import { RING_REACH_FACTOR } from "../utils/ringOptics";

/**
 * The new worlds (docs/superpowers/specs/2026-10-17-new-worlds-design.md,
 * roster A). Ids are final: they are saved in visitors' browsers.
 */
export const WORLD_IDS = ["w-rock", "w-ringed", "w-tilted", "w-blue", "w-dwarf"] as const;
export type WorldId = (typeof WORLD_IDS)[number];
export const WORLD_COUNT = WORLD_IDS.length;

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
 * The inner three's worst margins are gaps that depend on radius alone: with
 * the rock past Fuxx and the dwarf held at 2.77 AU, the ringed giant between
 * them leaves about 3.6 for each, whatever the planes.
 */
export const WORLDS: readonly WorldData[] = [
  {
    id: "w-rock", name: "AIRLESS ROCK", namesake: "Mercury", type: "airless-rock",
    size: 5.7, flattening: 0, bondAlbedo: 0.068, axialTiltDeg: 0.03, spin: PROGRADE * 0.15,
    orbit: circular(219, -50.5, 194, 1.0), // 1.90 AU; worst 3.74: gap to Fuxx (3.82 to the ringed giant)
    map: "w-rock", hint: "just beyond the Mars-type's orbit, small and cratered",
    namesakeRef: { distanceAU: 0.387, tempC: 166 }, // 439.6 K
  },
  {
    id: "w-ringed", name: "RINGED GIANT", namesake: "Saturn", type: "ringed-giant",
    size: 15, flattening: 0.1, bondAlbedo: 0.342, axialTiltDeg: 26.7, spin: PROGRADE * 0.3,
    orbit: circular(270, -53, 118, 3.5), // 2.35 AU; worst 3.56: gap to the dwarf (3.83 to the rock)
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
    orbit: circular(2.77 * AU, 58.5, 66, 5.2), // 2.77 AU, real Ceres's distance; worst 3.55: gap to the ringed giant
    map: "w-dwarf", hint: "at 2.77 AU, real Ceres's distance, tiny and dark",
    namesakeRef: { distanceAU: 2.77, tempC: -107 }, // ~166 K, computed
  },
];

/**
 * A world's marks, its radar blip and (once charted) its orbit line: one cool
 * slate for all five, apart from the planets' colours, the dormant gate's grey
 * and the crystals' gold.
 */
export const WORLD_MARK_COLOR = "#9fb8d0";

const IDS: ReadonlySet<string> = new Set(WORLD_IDS);
export const isWorld = (id: string): id is WorldId => IDS.has(id);

/**
 * Every body with a flight well (gravityWell.ts planetWell), a slingshot and
 * a crystal and comet keep-out: the planets, then the worlds, keyed as in
 * `bodies` (a planet's name, a world's id). `reach` is the body's outer
 * extent: its radius, or the ringed giant's rings (RING_REACH_FACTOR).
 */
export const PLANETS_AND_WORLDS: readonly { key: string; size: number; reach: number; orbit: OrbitalElements }[] = [
  ...planets.map((p) => ({ key: p.name, size: p.size, reach: p.size, orbit: p.orbit })),
  ...WORLDS.map((w) => ({
    key: w.id, size: w.size, reach: w.type === "ringed-giant" ? w.size * RING_REACH_FACTOR : w.size, orbit: w.orbit,
  })),
];
