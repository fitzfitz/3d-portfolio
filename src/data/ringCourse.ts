import { buildGates } from "../utils/race";

/**
 * The time-trial course: a closed loop of rings, flown in order, starting and
 * finishing through ring 0 in the inner system, near the sun.
 *
 * Out across the inner system (every ring inside r < 115, around the orbits of
 * Mercury, Venus and Earth), a climbing turn up to y≈70, then a dive home. The loop weaves through the inner system, so each ring is placed
 * clear of every real swept orbit (planet wells and moon systems, belt,
 * Trojans, comets): rings above or below the plane where the orbit tubes fill
 * it (tests/solarClearance.test.ts). They also clear colliders and shards
 * (tests/race.test.ts).
 *
 * The loop is ~540 units: ~13.9s at pure warp, ~50s at cruise. Since the
 * 2026-10-17 fuel change one tank lasts 62.5 s, so a full warp lap is possible.
 */
export const RING_GATES: [number, number, number][] = [
  [-12, 23, 34],   // 0 start / finish, inner system near the sun
  [-45, -33, 40],   // out across the inner system
  [-62, -38, -5],
  [-26, -34, -52], // past the boulder at (-40, -5, -60)
  [20, 50, -70],
  [55, 45, -40],  // climbing turn
  [40, 70, 10],   // the top
  [0, 55, 50],
  [35, 39, 55],   // diving
  [25, 23, 30],    // home stretch
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
