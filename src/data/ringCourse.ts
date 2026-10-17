import { buildGates } from "../utils/race";

/**
 * The time-trial course: a closed loop of rings, flown in order, starting and
 * finishing through ring 0 in the inner belt, near the sun.
 *
 * Out through the asteroid belt (r 40-70), a climbing turn up to y≈70, then a
 * dive home. Every ring sits inside the innermost planet orbit, so no planet
 * ever drifts through the course, and clear of colliders and shards —
 * tests/race.test.ts checks all of that, so edit positions freely.
 *
 * The loop is ~486 units: ~12.5s at pure warp, ~45s at cruise. Since the
 * 2026-10-17 fuel change one tank lasts 62.5 s, so a full warp lap is possible.
 */
export const RING_GATES: [number, number, number][] = [
  [-12, 3, 34],   // 0 start / finish, inner belt near the sun
  [-45, 0, 40],   // into the belt
  [-62, -8, -5],
  [-26, -2, -52], // past the boulder at (-40, -5, -60)
  [20, 15, -70],
  [55, 40, -40],  // climbing turn
  [40, 70, 10],   // the top
  [0, 55, 50],
  [35, 20, 55],   // diving
  [25, 5, 30],    // home stretch
];

/** Ring opening radius. Generous: the chase camera hides the ship's exact line. */
export const RING_RADIUS = 6;

/**
 * Target time. Not a recorded human run; set between pure warp (~12.5s) and
 * pure cruise (~45s). It was tuned when one tank could not warp a whole lap;
 * with the 62.5 s tank it is easy to beat and due a retune.
 */
export const PAR_SECONDS = 35;

/** The rings with their facing, ready for crossing tests and rendering. */
export const RACE_GATES = buildGates(RING_GATES);
