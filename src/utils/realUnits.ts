import { AU, YEAR_S, planets } from "../constants";
import type { OrbitalElements } from "./orbits";

/**
 * Scene units to real ones. Two anchors pin the system: Ruangrapi orbits at
 * 1 AU (AU scene units) with a one-year period (YEAR_S game seconds).
 * docs/UNIVERSE-RULES.md "Units" tabulates these numbers; change both together.
 */
export const AU_KM = 149_597_870.7;
export const KM_PER_UNIT = AU_KM / AU;
export const SECONDS_PER_GAME_SECOND = (365.25 * 86400) / YEAR_S;

const JUPITER_RADIUS_KM = 71_492;

export const speedKmS = (uPerS: number): number => (uPerS * KM_PER_UNIT) / SECONDS_PER_GAME_SECOND;
export const distanceAU = (units: number): number => units / AU;
export const earthYears = (gameSeconds: number): number => gameSeconds / YEAR_S;

export function formatOrbit(orbit: OrbitalElements): string {
  const period = (Math.PI * 2) / Math.abs(orbit.angularSpeed);
  return `ORBIT ${distanceAU(orbit.radius).toFixed(2)} AU · YEAR ${earthYears(period).toFixed(2)} EARTH-YR`;
}

/** Planet radius drawn vs. true, taking Jupiter's radius as the true size; to the nearest 10. */
export const SIZE_ENLARGEMENT = Math.round((planets.find((p) => p.type === "gas-giant")!.size * KM_PER_UNIT) / JUPITER_RADIUS_KM / 10) * 10;

export const ORRERY_NOTE =
  `THREE ORRERY CONVENTIONS: PLANETS DRAWN ~${SIZE_ENLARGEMENT}× JUPITER'S SIZE · 1 S ≈ ${Math.round(SECONDS_PER_GAME_SECOND / 3600)} H, MOON SYSTEMS ON THEIR OWN SLOWER CLOCK · DARK SURFACES DRAWN BRIGHTER THAN TRUE`;
