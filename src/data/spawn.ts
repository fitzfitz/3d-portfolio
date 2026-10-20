/**
 * The one spawn point (F3 revision): 0.92 AU from the sun, so the ship starts
 * in about Earth's sunlight (1 AU). No imports: beacons.ts, which the Cloudflare
 * Worker bundles, reads this.
 */
export const SPAWN = { x: -50, y: 62, z: 69 } as const;
/** Half-width of the spawn pad's box in x and z (the near-spawn check). */
export const SPAWN_PAD_R = 0.6;
