import { buildGates } from "../utils/race";

/**
 * The ring race course ("loop-2"): a closed loop of rings, flown in order,
 * starting and finishing through ring 0, just sunward of spawn.
 *
 * Spread out across the inner and middle system (every ring within r 245):
 * a climb out over Venus's and Earth's orbits, a high arc above Mars and the
 * belt's inner edge, a long dive through the plane, a low arc under Earth and
 * Mars, then a climb back over the inner orbits and a dive home. The orbit
 * tubes fill the plane out here, so every ring sits 40-195 u above or below it,
 * clear of every real swept orbit (planet wells and moon systems, belt,
 * Trojans, comets; tests/solarClearance.test.ts). Rings also clear colliders,
 * shards and the portal, and sit at least 80 u apart (tests/race.test.ts).
 *
 * The loop is ~1,770 u: ~45 s a lap at warp (39 u/s, which racers are held
 * to), so a lap takes most of the 62.5 s tank and fuel matters; ~2:45 at
 * cruise. Turns peak at ~115 degrees, as the old loop's did.
 */
export const RING_GATES: [number, number, number][] = [
  [-12, 40, 34],      // 0 start / finish, sunward of spawn, above Mercury's orbit
  [40, 100, 110],     // climbing out over Venus's and Earth's orbits
  [160, 160, 165],    // high over Mars's orbit and the belt's inner edge
  [240, 170, -10],    // the far high point, above the belt
  [130, 195, -140],   // the top, out past the career station; then the long dive
  [10, -105, -165],   // under Earth's orbit, below the contact portal
  [-130, -105, -150], // under Mars's orbit
  [-215, -125, -15],  // the far low point, under the belt's inner edge
  [-185, -125, 120],  // swinging round under the belt before the climb
  [-130, 90, 0],      // over the inner orbits, diving home past the shipyard
];

/** Ring opening radius. Generous: the chase camera hides the ship's exact line. */
export const RING_RADIUS = 6;

/** The rings with their facing, ready for crossing tests and rendering. */
export const RACE_GATES = buildGates(RING_GATES);

/** The start / finish ring: the grid lines up behind it. */
export const START_GATE = RACE_GATES[0];

/** Ring centres in race order, as the server's lap and path checks take them. */
export const RACE_CENTRES = RING_GATES;

/** The seed lap's steady speed (u/s), between cruise and warp: a lap to beat when no one has set a best. */
export const SEED_SPEED = 30;
