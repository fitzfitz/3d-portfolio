import { GM_SUN } from "../constants";
import { keplerPeriod, type CometOrbit } from "../utils/kepler";

/**
 * The two orbiting comets (Comets.tsx). Their periods are not tuned: Kepler's
 * third law with the same GM_SUN as the planets sets them (docs/UNIVERSE-RULES.md
 * R1), so they come by about every 9.4 and 11 minutes and move slowly far out.
 * Both are prograde: |inclination| < 90°.
 */
const comet = (a: number, e: number, phase: number, inclination: number, node: number): CometOrbit =>
  ({ a, e, periodSeconds: keplerPeriod(a, GM_SUN), phase, inclination, node });

export const COMETS: readonly CometOrbit[] = [
  comet(140, 0.62, 0, 0.9, 0.6), // ~52° diver, ~564 s
  comet(155, 0.65, 2.1, -1.15, 2.4), // ~66° steep, ~657 s
];
