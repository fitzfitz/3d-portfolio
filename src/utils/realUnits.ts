import { AU, YEAR_S } from "../constants";

/**
 * Scene units to real ones. Two anchors pin the system: 1 AU is AU scene
 * units and a Julian year is YEAR_S game seconds (the orrery clock).
 * docs/UNIVERSE-RULES.md "Units" tabulates these numbers; change both together.
 */
export const AU_KM = 149_597_870.7;
export const KM_PER_UNIT = AU_KM / AU;
export const SECONDS_PER_GAME_SECOND = (365.25 * 86400) / YEAR_S;

export const speedKmS = (uPerS: number): number => (uPerS * KM_PER_UNIT) / SECONDS_PER_GAME_SECOND;
export const LIGHT_KM_S = 299_792.458;
/** The HUD's light-speed readout for a ship speed in u/s: " · 0.061% C" (L39). */
export const lightFractionLabel = (uPerS: number): string =>
  ` · ${((speedKmS(uPerS) / LIGHT_KM_S) * 100).toFixed(3)}% C`;
export const distanceAU = (units: number): number => units / AU;
export const earthYears = (gameSeconds: number): number => gameSeconds / YEAR_S;

/** The logbook's conventions note (real-solar-system spec §6.4): every departure from the real thing, stated. */
export const ORRERY_NOTE =
  "ORRERY CONVENTIONS: POSITIONS ARE REAL FOR THE ORRERY DATE · 1 S ≈ 21 H, A YEAR EVERY 7 MIN · BODIES DRAWN ENLARGED, BIGGER ONES LESS (RADIUS ∝ DIAMETER^0.4); THE SUN IS NOT TO THAT SCALE · MOONS AND SPINS RUN ON A CLOSE-UP CLOCK (1 S ≈ 1.2 H) AND ARE ILLUSTRATIVE; MAJOR MOONS ONLY · DARK SURFACES DRAWN BRIGHTER THAN TRUE";
