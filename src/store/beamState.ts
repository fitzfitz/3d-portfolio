import { createSelection } from "../utils/tractorBeam";

/**
 * Per-frame tractor-beam state, mutable outside React like `flight` (spec §6).
 * Spaceship writes the beam's origin, direction, activity and the ship's total
 * velocity; TractorBeam selects probe and shard targets into `sel`;
 * ProjectProbes and AsteroidBelt apply pulls; HUD and sound read the ore
 * fields. A one-frame lag between writer and readers is acceptable.
 */
export const beamState = {
  active: false,
  ox: 0, oy: 0, oz: 0,
  dx: 0, dy: 0, dz: 1,
  /** Ship's total velocity (pilot + gravity) this frame, for relative pulls. */
  vel: { x: 0, y: 0, z: 0 },
  /** This frame's probe and shard targets (pebbles are tethered in mining.ts). */
  sel: createSelection(),
  /** Nearest selected shard: Spaceship reels toward it. */
  reel: { active: false, x: 0, y: 0, z: 0 },
  /** Pebbles absorbed toward the next crystal's worth (0..ORE_PER_CRYSTAL-1). */
  ore: 0,
  /** performance.now() of the last absorbed pebble, for the HUD readout. */
  oreAt: -Infinity,
  /** Pebbles absorbed since the beam last switched on (beam hum pitch). */
  oreStreak: 0,
};
