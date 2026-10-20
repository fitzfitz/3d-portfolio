import { AU, YEAR_S } from "../constants";

/**
 * Scene units to real ones. Two anchors pin the system: 1 AU is AU scene
 * units and a Julian year is YEAR_S game seconds (the orrery clock).
 * docs/UNIVERSE-RULES.md "Units" tabulates these numbers; change both together.
 */
export const AU_KM = 149_597_870.7;
export const KM_PER_UNIT = AU_KM / AU;
export const SECONDS_PER_GAME_SECOND = (365.25 * 86400) / YEAR_S;

const JUPITER_RADIUS_KM = 71_492;

export const speedKmS = (uPerS: number): number => (uPerS * KM_PER_UNIT) / SECONDS_PER_GAME_SECOND;
export const distanceAU = (units: number): number => units / AU;
export const earthYears = (gameSeconds: number): number => gameSeconds / YEAR_S;

/** An orbit in real units: its semi-major axis (AU) and its period (days, NASA's sidereal year). */
export function formatOrbit(aAU: number, yearDays: number): string {
  return `ORBIT ${aAU.toFixed(2)} AU · YEAR ${(yearDays / 365.25).toFixed(2)} EARTH-YR`;
}

/**
 * Jupiter's drawn radius (u): sizeLaw.ts SIZE_LAW_JUPITER_R, restated because
 * sizeLaw imports this module (tests/realUnits.test.ts holds the two equal).
 */
const JUPITER_DRAWN_R = 22;

/** Jupiter's radius drawn vs. true; to the nearest 10. Task 11 replaces it with each body's own enlargement. */
export const SIZE_ENLARGEMENT = Math.round((JUPITER_DRAWN_R * KM_PER_UNIT) / JUPITER_RADIUS_KM / 10) * 10;

export const ORRERY_NOTE =
  `THREE ORRERY CONVENTIONS: PLANETS DRAWN ~${SIZE_ENLARGEMENT}× JUPITER'S SIZE · 1 S ≈ ${Math.round(SECONDS_PER_GAME_SECOND / 3600)} H, MOON SYSTEMS ON THEIR OWN SLOWER CLOCK · DARK SURFACES DRAWN BRIGHTER THAN TRUE`;
