import { ENCKE, CHURYUMOV, JPL_PLANETS, JD_J2000, type OsculatingElements } from "../utils/ephemeris";
import { ORRERY_TEST_JD } from "../utils/orreryClock";
import { mulberry32 } from "../utils/mulberry32";

/**
 * Statistical models of the main belt and the Jupiter Trojans (design §4.7).
 * Each rock is a fixed two-body orbit (osculating elements, AU and degrees)
 * at the field epoch ORRERY_TEST_JD.
 */
export interface FieldRock { el: OsculatingElements; scale: number; variant: number }

/** Resonance gaps in the real belt (3:1, 5:2, 7:3, 2:1 and the 4:1 at 2.06). */
export const KIRKWOOD_GAPS_AU = [2.06, 2.50, 2.82, 2.95, 3.27] as const;
export const GAP_HALF_WIDTH_AU = 0.025;
export const BELT_COUNT = 400;
export const BELT_COUNT_LOW = 200;
export const TROJAN_COUNT = 160;

/** The real comets (Encke, 67P), SBDB elements. */
export const COMET_ELEMENTS: readonly OsculatingElements[] = [ENCKE, CHURYUMOV];

/** Mean motion of a body at `a` AU, degrees per day (Gaussian k in degrees). */
const meanMotion = (a: number): number => 0.9856076686 / a ** 1.5;
const VARIANTS = 4;

const rayleigh = (rand: () => number, sigma: number): number => sigma * Math.sqrt(-2 * Math.log(1 - rand()));

export function makeBelt(count: number, seed: number): FieldRock[] {
  const rand = mulberry32(seed);
  const out: FieldRock[] = [];
  while (out.length < count) {
    const a = 2.1 + rand() * 1.2;
    if (KIRKWOOD_GAPS_AU.some((g) => Math.abs(a - g) <= GAP_HALF_WIDTH_AU)) continue;
    const e = Math.min(0.3, rayleigh(rand, 0.1));
    const i = rayleigh(rand, 8);
    const node = rand() * 360, argPeri = rand() * 360, M0 = rand() * 360;
    const scale = 0.6 + rand() * 0.9;
    const variant = Math.floor(rand() * VARIANTS);
    out.push({ el: { epochJd: ORRERY_TEST_JD, a, e, i, node, argPeri, M0, nDegPerDay: meanMotion(a) }, scale, variant });
  }
  return out;
}

export function makeTrojans(count: number, seed: number): FieldRock[] {
  const rand = mulberry32(seed);
  const jup = JPL_PLANETS.jupiter;
  const T = (ORRERY_TEST_JD - JD_J2000) / 36525;
  const lJup = jup.L[0] + jup.L[1] * T;
  const a = jup.a[0];
  const n = jup.L[1] / 36525; // Jupiter's own mean motion, so the lobes keep their place
  const out: FieldRock[] = [];
  for (let k = 0; k < count; k++) {
    const lobe = k % 2 === 0 ? 60 : -60;
    const lon = lJup + lobe + (rand() * 2 - 1) * 25;
    const e = rand() * 0.15;
    const i = rand() * 30;
    const node = rand() * 360, argPeri = rand() * 360;
    const M0 = (((lon - node - argPeri) % 360) + 360) % 360;
    const scale = 0.6 + rand() * 0.9;
    const variant = Math.floor(rand() * VARIANTS);
    out.push({ el: { epochJd: ORRERY_TEST_JD, a, e, i, node, argPeri, M0, nDegPerDay: n }, scale, variant });
  }
  return out;
}
