import { drawnRadius } from "../utils/sizeLaw";
import { MOON_IDS, type BodyId } from "./bodyIds";
import { bodyById, type AtmosphereLook } from "./solarSystem";

/**
 * The nine major moons, each system one uniform inset (spec §5.3).
 * a, period, diameter: NASA NSSDC satellite fact sheets and JPL planetary
 * satellite mean elements (https://ssd.jpl.nasa.gov/sats/elem/). Inclinations
 * are JPL's mean values to the local Laplace plane (about the parent's equator
 * for these moons): Io 0.0, Europa 0.5, Ganymede 0.2, Callisto 0.3, Phobos 1.1,
 * Deimos 1.8, Titan 0.3. The Moon is 5.145 deg to the ecliptic (JPL lists 5.16);
 * Triton is retrograde, 156.885 deg to Neptune's equator.
 * Geometric albedos: NASA NSSDC satellite fact sheets (Moon, Martian, Jovian,
 * Saturnian, Neptunian). Maps: NASA/USGS public-domain global mosaics (Titan's
 * seeded haze), each `<id>.webp` scaled to 0.177 × geometric albedo
 * (scripts/textures/process_body_maps.mjs); `texelMedianLinear` is the shipped
 * map's measured linear median (tests/bodyMaps.test.ts). Phobos and Deimos are
 * shape models (Task 14): theirs is the scene-scale albedo itself.
 */
export { MOON_IDS };
export type MoonId = (typeof MOON_IDS)[number];

/** Spins and insets run on one close-up clock: 1 s = 1.2 h. */
export const CLOSE_UP_HOURS_PER_SECOND = 1.2;

export interface SolarMoon {
  id: MoonId;
  name: string;
  parent: BodyId;
  diameterKm: number;
  size: number;
  aKm: number;
  periodHours: number;
  plane: "equator" | "ecliptic";
  inclinationDeg: number;
  retrograde: boolean;
  map: string;
  geometricAlbedo: number;
  texelMedianLinear: number;
  shape?: "phobos" | "deimos";
  /** As a body's `look` (data/solarSystem.ts): Titan's haze rim. */
  look?: { atmosphere?: AtmosphereLook };
}

const moon = (m: Omit<SolarMoon, "size" | "retrograde" | "map"> & { retrograde?: boolean }): SolarMoon => ({
  ...m, size: drawnRadius(m.diameterKm), retrograde: m.retrograde ?? false, map: m.id,
});

export const SOLAR_MOONS: readonly SolarMoon[] = [
  moon({ id: "moon", name: "MOON", parent: "earth", diameterKm: 3474.8, aKm: 384_400, periodHours: 655.72, plane: "ecliptic", inclinationDeg: 5.145, geometricAlbedo: 0.12, texelMedianLinear: 0.0211 }),
  moon({ id: "phobos", name: "PHOBOS", parent: "mars", diameterKm: 22.5, aKm: 9_376, periodHours: 7.6539, plane: "equator", inclinationDeg: 1.1, shape: "phobos", geometricAlbedo: 0.07, texelMedianLinear: 0.177 * 0.07 }),
  moon({ id: "deimos", name: "DEIMOS", parent: "mars", diameterKm: 12.4, aKm: 23_463, periodHours: 30.312, plane: "equator", inclinationDeg: 1.8, shape: "deimos", geometricAlbedo: 0.08, texelMedianLinear: 0.177 * 0.08 }),
  moon({ id: "io", name: "IO", parent: "jupiter", diameterKm: 3643.2, aKm: 421_700, periodHours: 42.459, plane: "equator", inclinationDeg: 0, geometricAlbedo: 0.62, texelMedianLinear: 0.11 }),
  moon({ id: "europa", name: "EUROPA", parent: "jupiter", diameterKm: 3121.6, aKm: 671_034, periodHours: 85.228, plane: "equator", inclinationDeg: 0.5, geometricAlbedo: 0.68, texelMedianLinear: 0.1194 }),
  moon({ id: "ganymede", name: "GANYMEDE", parent: "jupiter", diameterKm: 5268.2, aKm: 1_070_412, periodHours: 171.709, plane: "equator", inclinationDeg: 0.2, geometricAlbedo: 0.44, texelMedianLinear: 0.0782 }),
  moon({ id: "callisto", name: "CALLISTO", parent: "jupiter", diameterKm: 4820.6, aKm: 1_882_709, periodHours: 400.536, plane: "equator", inclinationDeg: 0.3, geometricAlbedo: 0.19, texelMedianLinear: 0.0333 }),
  // Titan's orange photochemical haze reaches ~500 km over its 2,575 km
  // radius (Cassini); the rim is drawn at 1.12 R, thicker than Earth's.
  moon({ id: "titan", name: "TITAN", parent: "saturn", diameterKm: 5149.5, aKm: 1_221_870, periodHours: 382.69, plane: "equator", inclinationDeg: 0.3, geometricAlbedo: 0.22, texelMedianLinear: 0.0381,
    look: { atmosphere: { color: "#e39a3a", thickness: 1.12, intensity: 0.9 } } }),
  moon({ id: "triton", name: "TRITON", parent: "neptune", diameterKm: 2706.8, aKm: 354_759, periodHours: 141.045, plane: "equator", inclinationDeg: 156.885, retrograde: true, geometricAlbedo: 0.72, texelMedianLinear: 0.1274 }),
];

/**
 * The atmosphere rim of a body or a moon, from its `look` (Ruling R5: the data
 * has one home, on the body or the moon); undefined when it has none.
 */
export function atmosphereOf(id: BodyId | MoonId): AtmosphereLook | undefined {
  const m = SOLAR_MOONS.find((x) => x.id === id);
  return m ? m.look?.atmosphere : bodyById(id as BodyId).look.atmosphere;
}

/** Parents' equatorial radii (km). */
const PARENT_R_KM: Readonly<Partial<Record<BodyId, number>>> = {
  earth: 6378.1, mars: 3396.2, jupiter: 71_492, saturn: 60_268, neptune: 24_764,
};
const RING_A_OUTER = 2.27;

const systemOf = (parent: BodyId): SolarMoon[] =>
  SOLAR_MOONS.filter((m) => m.parent === parent).sort((a, b) => a.aKm - b.aKm);

/** Drawn u per real parent radius, before the inset scale. */
const baseDistance = (m: SolarMoon): number => (m.aKm / PARENT_R_KM[m.parent]!) * bodyById(m.parent).size;

function computeInsetScale(parent: BodyId): number {
  const inner = systemOf(parent)[0];
  const size = bodyById(parent).size;
  let required = 1.5 * (size + inner.size);
  if (parent === "saturn") required = Math.max(required, RING_A_OUTER * size + inner.size + 2);
  return Math.min(1, required / baseDistance(inner));
}

/**
 * Memoised per parent (and per moon below): the data is constant, and the
 * frame loops (moonOrbits.ts, the cruise list) read these every frame.
 */
const scaleCache = new Map<BodyId, number>();
const distanceCache = new Map<SolarMoon, number>();
const gmCache = new Map<BodyId, number>();

/** One distance scale per system: the innermost moon clears the planet (and Saturn's A ring). */
export function insetScale(parent: BodyId): number {
  let s = scaleCache.get(parent);
  if (s === undefined) scaleCache.set(parent, (s = computeInsetScale(parent)));
  return s;
}

/** u from the parent's centre. */
export function insetDistance(m: SolarMoon): number {
  let d = distanceCache.get(m);
  if (d === undefined) distanceCache.set(m, (d = baseDistance(m) * insetScale(m.parent)));
  return d;
}

/** Orbital period on the close-up clock (s). */
export const insetPeriod = (m: SolarMoon): number => m.periodHours / CLOSE_UP_HOURS_PER_SECOND;

/** The system's GM (u^3/s^2) so Kepler III holds inside the inset (from its innermost moon). */
export function insetGM(parent: BodyId): number {
  let gm = gmCache.get(parent);
  if (gm === undefined) gmCache.set(parent, (gm = gmOfMoon(systemOf(parent)[0])));
  return gm;
}
export const gmOfMoon = (m: SolarMoon): number => insetDistance(m) ** 3 * (2 * Math.PI / insetPeriod(m)) ** 2;

/**
 * How far Phobos's and Deimos's shapes reach from their centres, in units of
 * half the NSSDC mean diameter (the GLBs' unit, so the mesh scale is `size`):
 * the largest radius of P. C. Thomas's shape models (PDS SBN
 * EAR-A-5-DDR-SHAPE-MODELS-V2.1), 13.98 / 11.25 km and 8.71 / 6.2 km, rounded
 * up. tests/assetContracts.test.ts holds the shipped GLBs inside these.
 */
export const MOON_SHAPE_REACH: Readonly<Record<NonNullable<SolarMoon["shape"]>, number>> = { phobos: 1.25, deimos: 1.41 };

/** The farthest surface point from a moon's centre (u): its size, or its shape's tips. The collider's radius. */
export const moonReach = (m: SolarMoon): number => m.size * (m.shape ? MOON_SHAPE_REACH[m.shape] : 1);

/** Outermost moon's inset distance plus its reach. */
export function moonSystemReach(parent: BodyId): number {
  const sys = systemOf(parent);
  const last = sys[sys.length - 1];
  return insetDistance(last) + moonReach(last);
}

