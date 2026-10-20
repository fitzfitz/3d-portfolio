import type { BodyId } from "../data/bodyIds";
import type { SolarBody } from "../data/solarSystem";
import { heliocentric } from "./bodyPositions";
import { orbitShape } from "./ephemeris";
import { formatOrreryDate, orreryJd } from "./orreryClock";
import { RINGED_GIANT_DENSITY } from "./ringOptics";
import { enlargement } from "./sizeLaw";

/**
 * Each body's facts (real-solar-system spec §5.1): real, from NASA's NSSDC
 * fact sheets and mission results (Ceres: Dawn), one short sentence each. The
 * first is the one its charting line gives. Sources: NASA NSSDC planetary
 * fact sheets (nssdc.gsfc.nasa.gov/planetary/factsheet) and NASA Solar System
 * Exploration pages (science.nasa.gov/solar-system); Ceres: NASA Dawn mission.
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

const n = (v: number): string => Math.round(v).toLocaleString("en-US");

/**
 * A body's scan at `gameSeconds` (real-solar-system spec §5.2): its name, real
 * size and how much it is drawn enlarged, where it is now and how fast, its
 * orbit, its day, tilt and moons, two real facts, and the orrery date. Every
 * number is the real one for the orrery date; spins and moons are illustrative.
 */
export function bodyReport(b: SolarBody, gameSeconds: number): string {
  const jd = orreryJd(gameSeconds);
  const now = heliocentric(b, gameSeconds);
  const o = orbitShape(b.orbit.el, jd);
  const lines = [
    `${b.name} · ${b.ordinal}`,
    `DIAMETER ${n(b.diameterKm)} KM · DRAWN ${n(enlargement(b.diameterKm))}× TRUE SIZE`,
    `NOW ${now.rAU.toFixed(2)} AU FROM THE SUN · ${now.speedKmS.toFixed(1)} KM/S`,
    `ORBIT ${o.a.toFixed(2)} AU (${(o.a * (1 - o.e)).toFixed(2)}–${(o.a * (1 + o.e)).toFixed(2)}) · e ${o.e.toFixed(3)} · i ${Math.abs((o.i * 180) / Math.PI).toFixed(2)}° · YEAR ${(b.facts.yearDays / 365.25).toFixed(2)} EARTH-YR`,
    `DAY ${b.facts.dayHours.toFixed(1)} H · TILT ${b.obliquityDeg.toFixed(1)}° · MOONS ${b.facts.moons}`,
    BODY_FACTS[b.id].join(" · "),
    `ORRERY DATE ${formatOrreryDate(jd)} · SPINS AND MOONS ILLUSTRATIVE`,
  ];
  return `SCAN[${b.name}] // ${lines.join(" // ")}`;
}
