import { AU } from "../constants";
import type { BodyId } from "../data/bodyIds";
import type { SolarBody } from "../data/solarSystem";
import { heliocentric } from "./bodyPositions";
import { orbitShape } from "./ephemeris";
import { orreryJd } from "./orreryClock";
import { equilibriumTempK, fluxEarth, kToC } from "./worldPhysics";
import { formatOrbit } from "./realUnits";
import { RINGED_GIANT_DENSITY } from "./ringOptics";

/**
 * Each body's facts (real-solar-system spec §5.1): real, from NASA's NSSDC
 * fact sheets and mission results (Ceres: Dawn), one short sentence each. The
 * first is the one its charting line gives. Task 11 merges these reports into
 * bodyReports.ts with the final scan layout.
 */
export const BODY_FACTS: Readonly<Record<BodyId, readonly string[]>> = {
  mercury: [
    "THE SMALLEST PLANET, AND THE FASTEST AROUND THE SUN",
    "NO ATMOSPHERE TO HOLD HEAT, SO DAY AND NIGHT DIFFER ENORMOUSLY",
  ],
  venus: [
    "THE HOTTEST PLANET: A RUNAWAY GREENHOUSE UNDER SULFURIC-ACID CLOUDS",
    "IT SPINS BACKWARDS, SO SLOWLY THAT ITS DAY OUTLASTS ITS YEAR",
  ],
  earth: [
    "THE ONLY WORLD KNOWN TO HOLD LIFE AND SURFACE OCEANS",
    "ITS ONE LARGE MOON STEADIES ITS TILT",
  ],
  mars: [
    "IRON-OXIDE DUST GIVES IT ITS RED",
    "OLYMPUS MONS, THE TALLEST VOLCANO IN THE SOLAR SYSTEM, IS HERE",
  ],
  ceres: [
    "THE LARGEST BODY IN THE ASTEROID BELT: ROUND, BUT NOT A PLANET",
    "BRIGHT SPOTS OF SODIUM-CARBONATE SALTS",
  ],
  jupiter: [
    "MORE MASSIVE THAN ALL THE OTHER PLANETS TOGETHER, TWICE OVER",
    "THE GREAT RED SPOT IS A STORM WIDER THAN EARTH",
  ],
  saturn: [
    `LESS DENSE THAN WATER (${RINGED_GIANT_DENSITY} G/CM³)`,
    "ITS BRIGHT RINGS ARE MOSTLY WATER ICE",
  ],
  uranus: [
    "IT ROLLS AROUND THE SUN ON ITS SIDE",
    "METHANE GAS ABSORBS RED LIGHT, HENCE THE CYAN",
  ],
  neptune: [
    "METHANE GAS GIVES THE BLUE",
    "THE FASTEST WINDS MEASURED ON ANY PLANET",
  ],
};

/** Whole degrees Celsius with a true minus sign. */
const celsius = (c: number): string => `${Math.round(c)}`.replace("-", "−") + " °C";

/**
 * A body's scan report at `gameSeconds`: its name and kind, its equilibrium
 * temperature and sunlight at its live distance from the Sun (worldPhysics,
 * from that distance and its Bond albedo; §4.8: Mercury's sunlight varies
 * 2.3× around its orbit), its facts and its orbit in real units.
 */
export function worldReport(b: SolarBody, gameSeconds: number): string {
  const r = heliocentric(b, gameSeconds).rAU * AU;
  // Sizes keep the real order but not the real ratios (P3): no number here.
  const kind = `${b.ordinal} (SIZE ENLARGED)`;
  const own = `EQUILIBRIUM ${celsius(kToC(equilibriumTempK(r, b.bondAlbedo)))} · SUNLIGHT ${fluxEarth(r).toFixed(2)}× EARTH'S · NOW ${(r / AU).toFixed(2)} AU FROM THE SUN`;
  const orbit = formatOrbit(orbitShape(b.orbit.el, orreryJd(gameSeconds)).a, b.facts.yearDays);
  return `SCAN[${b.name}] // ${kind} · ${own} // ${BODY_FACTS[b.id].join(" · ")} // ${orbit}`;
}
