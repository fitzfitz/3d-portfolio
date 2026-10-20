import { KM_PER_UNIT } from "./realUnits";

/** One law for every body but the Sun: radius = 22 u × (D / D_Jupiter)^0.4 (spec §5.2). */
export const SIZE_LAW_EXPONENT = 0.4;
export const SIZE_LAW_JUPITER_R = 22;
export const JUPITER_DIAMETER_KM = 142_984;

export const drawnRadius = (diameterKm: number): number =>
  SIZE_LAW_JUPITER_R * (diameterKm / JUPITER_DIAMETER_KM) ** SIZE_LAW_EXPONENT;

/** Drawn radius over true radius ("DRAWN 1,710× TRUE SIZE"). */
export const enlargement = (diameterKm: number): number =>
  (drawnRadius(diameterKm) * KM_PER_UNIT) / (diameterKm / 2);
