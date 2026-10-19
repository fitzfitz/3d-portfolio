import type { WorldData, WorldId } from "../data/worlds";
import { equilibriumTempK, fluxEarth, kToC } from "./worldPhysics";
import { formatOrbit } from "./realUnits";
import { RINGED_GIANT_DENSITY } from "./ringOptics";

/**
 * Each world's fixed type facts (spec "The five worlds"), each true at the
 * world's own orbit (spec "Honesty rule"). They state no number of their own
 * beyond the ringed giant's density. The first is the one its charting line
 * gives. The blue giant's bright clouds are ammonia ice: at its ~137 K
 * methane stays a gas (methane ice needs ~80 K).
 */
export const WORLD_FACTS: Readonly<Record<WorldId, readonly string[]>> = {
  "w-rock": [
    "NO ATMOSPHERE TO HOLD HEAT, SO DAY AND NIGHT DIFFER ENORMOUSLY",
    "A LARGE IRON CORE, A MERCURY-LIKE COMPOSITION",
  ],
  "w-ringed": [
    `LESS DENSE THAN WATER (${RINGED_GIANT_DENSITY} G/CM³)`,
    "WATER-ICE RINGS SLOWLY SUBLIMATING THIS CLOSE TO THE STAR",
    "THE A RING'S EDGE SITS AT THE ROCHE LIMIT",
    "MOONS NOT CHARTED",
  ],
  "w-tilted": [
    "IT ROLLS AROUND ITS STAR ON ITS SIDE",
    "METHANE GAS ABSORBS RED LIGHT, HENCE THE CYAN",
  ],
  "w-blue": [
    "METHANE GAS GIVES THE BLUE",
    "ITS BRIGHT CLOUDS ARE AMMONIA ICE: TOO WARM HERE FOR METHANE ICE",
  ],
  "w-dwarf": [
    "MASSIVE ENOUGH TO BE ROUND, BUT NOT A PLANET",
    "BRIGHT SPOTS OF SODIUM-CARBONATE SALTS",
    "WATER ICE BELOW THE SURFACE",
  ],
};

/** Whole degrees Celsius with a true minus sign. */
const celsius = (c: number): string => `${Math.round(c)}`.replace("-", "−") + " °C";

/**
 * A world's scan report: its namesake type (size compressed), its own equilibrium temperature
 * and sunlight (worldPhysics, from its orbit and Bond albedo), the namesake's
 * own value labelled as the real planet's, its type facts and its orbit in
 * real units. Move the world and the report stays true.
 */
export function worldReport(w: WorldData): string {
  const r = w.orbit.radius;
  // Sizes keep the real order but not the real ratios (P3): no number here.
  const type = `${w.namesake.toUpperCase()}-TYPE (SIZE COMPRESSED)`;
  const own = `EQUILIBRIUM ${celsius(kToC(equilibriumTempK(r, w.bondAlbedo)))} · SUNLIGHT ${fluxEarth(r).toFixed(2)}× EARTH'S`;
  const ref = w.namesakeRef;
  const namesake = `${w.namesake.toUpperCase()} ITSELF (${ref.distanceAU.toFixed(2)} AU): ${celsius(ref.tempC)} EQUILIBRIUM`;
  return `SCAN[WORLD_${w.name}] // ${type} · ${own} // ${namesake} // ${WORLD_FACTS[w.id].join(" · ")} // ${formatOrbit(w.orbit)}`;
}
