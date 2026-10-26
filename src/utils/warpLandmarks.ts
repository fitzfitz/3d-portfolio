import { DESTINATIONS } from "../data/destinations";
import { GATE_POS } from "../data/dormantGate";
import { PROBES } from "../data/probes";

/**
 * Fixed landmarks the warp leaves room for (Spaceship's cruise spheres): every
 * destination, the gate, and the spots of the probes in play only. An empty
 * probe slot must not throttle the warp, so with the bundled three projects
 * this is exactly the set it always was (spec 2026-10-23-dynamic-content,
 * build ruling R8; tests/warpLandmarks.test.ts).
 */
export const WARP_LANDMARKS: readonly (readonly [number, number, number])[] = [
  ...DESTINATIONS.map((d) => d.pos), GATE_POS, ...PROBES.flatMap((p) => [p.home, ...p.remote]),
];
