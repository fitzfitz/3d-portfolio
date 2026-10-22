import { CERES, JPL_PLANETS } from "../utils/ephemeris";
import type { JplPlanetElements, OsculatingElements } from "../utils/ephemeris";
import { RING_OUT, uranusRingRadii } from "../utils/ringOptics";
import { drawnRadius } from "../utils/sizeLaw";
import { BODY_IDS } from "./bodyIds";
import type { BodyId } from "./bodyIds";

/**
 * The nine real bodies. Sources:
 * - Diameter, rotation period, obliquity, moon count, mean temperature, orbital
 *   period, solar day: NASA NSSDC planetary fact sheets
 *   (https://nssdc.gsfc.nasa.gov/planetary/factsheet/) and, for Ceres, the Dawn
 *   mission / NSSDC dwarf-planet data (mean diameter 939.4 km).
 * - Poles: IAU WGCCRE 2015, Archinal et al. 2018, Celest. Mech. Dyn. Astron.
 *   130:22; J2000 RA/Dec at epoch (rates ignored).
 * - Bond and geometric albedos: NSSDC fact sheets. Flattening: NSSDC (1 - polar/equatorial).
 * - Mars pole only: IAU 2009 (Archinal et al. 2011, Celest. Mech. Dyn. Astron. 109:101),
 *   because the 2015 constants need that model's periodic terms.
 * - Orbits: JPL Table 2a (src/data/jplElements.ts), Ceres from SBDB (src/data/smallBodies.ts).
 * - Maps (real-solar-system spec §5.5): NASA/USGS public-domain global mosaics
 *   (scripts/textures/fetch_nasa_maps.mjs pins each source; process_body_maps.mjs
 *   makes the shipped map), seeded where no true-colour global map exists
 *   (Venus: gen_body_maps.mjs; Saturn, Uranus, Neptune: gen_worlds.mjs).
 *   Each is scaled in linear light to 0.177 × its geometric albedo;
 *   `texelMedianLinear` is the shipped map's measured linear-luminance median
 *   (Earth's is the mean under its cloud layer: geometric albedo is a disc
 *   average, and on a two-tone planet the median texel is open sea;
 *   tests/bodyMaps.test.ts). `color` (the HUD swatch, orbit lines and far
 *   dots) is the map's mean colour at one brightness.
 */
/**
 * An atmosphere rim (Atmosphere.tsx, L27): scattered sunlight in a shell
 * `thickness` × the radius, `intensity` at 1 AU (scaled by the live sunlight),
 * `dusk` the terminator band's tint (the sunset orange when omitted). Lives on
 * a body's or a moon's `look` (Ruling R5: one home); data/solarMoons.ts
 * atmosphereOf reads either.
 */
export interface AtmosphereLook { color: string; thickness: number; intensity: number; dusk?: string }

export interface SolarBody {
  id: BodyId;
  name: string;
  /** "3RD PLANET" / "DWARF PLANET". */
  ordinal: string;
  diameterKm: number;
  /** Drawn radius (u): drawnRadius(diameterKm). */
  size: number;
  flattening: number;
  /** NASA obliquity to the orbit (deg). */
  obliquityDeg: number;
  /** IAU pole, J2000 equatorial. */
  pole: { raDeg: number; decDeg: number };
  /** Sidereal rotation (h); negative = retrograde. */
  rotationHours: number;
  orbit: { kind: "jpl"; el: JplPlanetElements } | { kind: "osculating"; el: OsculatingElements };
  geometricAlbedo: number;
  bondAlbedo: number;
  /** The equirect map in public/models (`<map>.webp`). */
  map: string;
  /** Also ships a desktop-only `<map>_4k.webp` (utils/hiResMaps.ts). */
  mapHiRes?: true;
  texelMedianLinear: number;
  color: string;
  look: {
    /** A cloud shell: `map` is its opacity (stored sRGB-encoded, decoded on upload), `linear` its colour on the scene's albedo scale. */
    clouds?: { map: string; linear: number };
    /** The night-side emissive map. */
    nightLights?: string;
    rings?: "saturn" | "uranus";
    atmosphere?: AtmosphereLook;
    limb?: number;
  };
  facts: { moons: number; dayHours: number; yearDays: number; meanTempC: number };
  hint: string;
}

/**
 * The ice giants' terminator tint. Methane absorbs red, so their terminator
 * band does not redden the way a nitrogen sky's does: it stays a cool, deeper
 * cyan-blue (atmosphereMaterial.ts's uDusk).
 */
export const ICE_GIANT_DUSK = "#4a86b8";

const body = (b: Omit<SolarBody, "size">): SolarBody => ({ ...b, size: drawnRadius(b.diameterKm) });

export const SOLAR_BODIES: readonly SolarBody[] = [
  body({
    id: "mercury", name: "MERCURY", ordinal: "1ST PLANET", diameterKm: 4879.4, flattening: 0,
    obliquityDeg: 0.034, pole: { raDeg: 281.0103, decDeg: 61.4155 }, rotationHours: 1407.6,
    orbit: { kind: "jpl", el: JPL_PLANETS.mercury }, geometricAlbedo: 0.142, bondAlbedo: 0.068,
    map: "mercury", mapHiRes: true, texelMedianLinear: 0.0254, color: "#9c9993", look: {},
    facts: { moons: 0, dayHours: 4222.6, yearDays: 87.969, meanTempC: 167 },
    hint: "the innermost planet, small, cratered and airless",
  }),
  body({
    id: "venus", name: "VENUS", ordinal: "2ND PLANET", diameterKm: 12103.6, flattening: 0,
    obliquityDeg: 177.36, pole: { raDeg: 272.76, decDeg: 67.16 }, rotationHours: -5832.5,
    orbit: { kind: "jpl", el: JPL_PLANETS.venus }, geometricAlbedo: 0.689, bondAlbedo: 0.76,
    map: "venus", texelMedianLinear: 0.1224, color: "#9e998d",
    // A pale cream haze, weak, with a cream terminator band (no sunset
    // orange over sulphuric-acid haze): the old saturated #f0dca0 at 0.8 ringed
    // the dim disc in bright yellow, and next to it the disc read olive.
    look: { atmosphere: { color: "#efe7d2", thickness: 1.06, intensity: 0.45, dusk: "#e0cba8" } },
    facts: { moons: 0, dayHours: 2802, yearDays: 224.701, meanTempC: 464 },
    hint: "inside Earth's orbit, wrapped in a cream cloud deck, spinning backwards",
  }),
  body({
    id: "earth", name: "EARTH", ordinal: "3RD PLANET", diameterKm: 12756.2, flattening: 0.00335,
    obliquityDeg: 23.44, pole: { raDeg: 0, decDeg: 90 }, rotationHours: 23.9345,
    orbit: { kind: "jpl", el: JPL_PLANETS.earth }, geometricAlbedo: 0.434, bondAlbedo: 0.306,
    map: "earth", mapHiRes: true, texelMedianLinear: 0.0766, color: "#8c99b8",
    look: { clouds: { map: "earth_clouds", linear: 0.2117 }, nightLights: "earth_night", atmosphere: { color: "#6aa8ff", thickness: 1.05, intensity: 1, dusk: "#ff9a5a" } },
    facts: { moons: 1, dayHours: 24, yearDays: 365.256, meanTempC: 15 },
    hint: "the third planet, the blue one, with one Moon",
  }),
  body({
    id: "mars", name: "MARS", ordinal: "4TH PLANET", diameterKm: 6792.4, flattening: 0.00589,
    obliquityDeg: 25.19, pole: { raDeg: 317.68143, decDeg: 52.8865 }, rotationHours: 24.6229,
    orbit: { kind: "jpl", el: JPL_PLANETS.mars }, geometricAlbedo: 0.17, bondAlbedo: 0.25,
    map: "mars", mapHiRes: true, texelMedianLinear: 0.0301, color: "#b3928f",
    look: { atmosphere: { color: "#d9a07a", thickness: 1.03, intensity: 0.5, dusk: "#6a8fd0" } },
    facts: { moons: 2, dayHours: 24.6597, yearDays: 686.98, meanTempC: -65 },
    hint: "past Earth, the rust-red planet with two small moons",
  }),
  body({
    id: "ceres", name: "CERES", ordinal: "DWARF PLANET", diameterKm: 939.4, flattening: 0,
    obliquityDeg: 4, pole: { raDeg: 291.418, decDeg: 66.764 }, rotationHours: 9.074,
    orbit: { kind: "osculating", el: CERES }, geometricAlbedo: 0.09, bondAlbedo: 0.034,
    map: "ceres", texelMedianLinear: 0.016, color: "#999999", look: {},
    facts: { moons: 0, dayHours: 9.074, yearDays: 1681.6, meanTempC: -106 },
    hint: "a dwarf planet in the asteroid belt, small and dark",
  }),
  body({
    id: "jupiter", name: "JUPITER", ordinal: "5TH PLANET", diameterKm: 142984, flattening: 0.06487,
    obliquityDeg: 3.13, pole: { raDeg: 268.056595, decDeg: 64.495303 }, rotationHours: 9.925,
    orbit: { kind: "jpl", el: JPL_PLANETS.jupiter }, geometricAlbedo: 0.538, bondAlbedo: 0.343,
    map: "jupiter", texelMedianLinear: 0.0957, color: "#9b9993",
    look: { atmosphere: { color: "#e0c8a8", thickness: 1.04, intensity: 0.6 }, limb: 0.8 },
    facts: { moons: 95, dayHours: 9.925, yearDays: 4332.589, meanTempC: -110 },
    hint: "the largest planet, banded, with four great moons",
  }),
  body({
    id: "saturn", name: "SATURN", ordinal: "6TH PLANET", diameterKm: 120536, flattening: 0.09796,
    obliquityDeg: 26.73, pole: { raDeg: 40.589, decDeg: 83.537 }, rotationHours: 10.656,
    orbit: { kind: "jpl", el: JPL_PLANETS.saturn }, geometricAlbedo: 0.499, bondAlbedo: 0.342,
    map: "w-ringed", texelMedianLinear: 0.0866, color: "#a6987b",
    look: { rings: "saturn", atmosphere: { color: "#e6d6a8", thickness: 1.04, intensity: 0.5 } },
    facts: { moons: 146, dayHours: 10.656, yearDays: 10759.22, meanTempC: -140 },
    hint: "the ringed planet, with Titan",
  }),
  body({
    id: "uranus", name: "URANUS", ordinal: "7TH PLANET", diameterKm: 51118, flattening: 0.02293,
    obliquityDeg: 97.77, pole: { raDeg: 257.311, decDeg: -15.175 }, rotationHours: -17.24,
    orbit: { kind: "jpl", el: JPL_PLANETS.uranus }, geometricAlbedo: 0.488, bondAlbedo: 0.3,
    map: "w-tilted", texelMedianLinear: 0.0857, color: "#829eb0",
    look: { rings: "uranus", atmosphere: { color: "#a8e0e6", thickness: 1.04, intensity: 0.5, dusk: ICE_GIANT_DUSK }, limb: 0.7 },
    facts: { moons: 28, dayHours: 17.24, yearDays: 30685.4, meanTempC: -195 },
    hint: "the pale cyan ice giant, rolling on its side",
  }),
  body({
    id: "neptune", name: "NEPTUNE", ordinal: "8TH PLANET", diameterKm: 49528, flattening: 0.01708,
    obliquityDeg: 28.32, pole: { raDeg: 299.36, decDeg: 43.46 }, rotationHours: 16.11,
    orbit: { kind: "jpl", el: JPL_PLANETS.neptune }, geometricAlbedo: 0.442, bondAlbedo: 0.29,
    map: "w-blue", texelMedianLinear: 0.0785, color: "#4c83ff",
    look: { atmosphere: { color: "#5f88e0", thickness: 1.04, intensity: 0.6, dusk: ICE_GIANT_DUSK }, limb: 0.7 },
    facts: { moons: 16, dayHours: 16.11, yearDays: 60189, meanTempC: -200 },
    hint: "the outermost planet, deep blue, with captured Triton",
  }),
];

export const BODY_COUNT = SOLAR_BODIES.length;

const BY_ID = new Map<BodyId, SolarBody>(SOLAR_BODIES.map((b) => [b.id, b]));
export function bodyById(id: BodyId): SolarBody {
  const b = BY_ID.get(id);
  if (!b) throw new Error(`unknown body ${id}`);
  return b;
}

/** Size and farthest extent (the rings' outer edge for Saturn and Uranus) of each body. */
export const BODY_REACH: readonly { key: BodyId; size: number; reach: number }[] = SOLAR_BODIES.map((b) => ({
  key: b.id,
  size: b.size,
  reach: b.look.rings === "saturn" ? b.size * RING_OUT : b.look.rings === "uranus" ? uranusRingRadii(b.size)[1] : b.size,
}));

// Roster order is BODY_IDS order.
if (SOLAR_BODIES.some((b, i) => b.id !== BODY_IDS[i])) throw new Error("SOLAR_BODIES out of BODY_IDS order");
