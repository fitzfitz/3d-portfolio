/**
 * Warp fuel. Pure transforms so the tuning is testable without a scene.
 *
 * Numbers derive from the flight model rather than taste: SHIP_WARP_SPEED is
 * 39 u/s in a 500-unit-wide world (COSMIC_BOUNDS 250), so a 100 tank draining
 * 8/s gives 12.5s of warp ≈ 488 units — one full crossing per tank.
 * That makes warp a decision rather than something you hold down by default.
 */
export const FUEL_MAX = 100;

/** Units per second while warp is active. 100/8 = 12.5s of warp. */
export const FUEL_DRAIN_PER_SEC = 8;

/** Restored per crystal. Four fill an empty tank; one buys ~122 units of warp. */
export const FUEL_PER_CRYSTAL = 25;

/** Drains for `dt` seconds, clamped at empty. */
export function drainFuel(fuel: number, dt: number): number {
  return Math.max(0, fuel - FUEL_DRAIN_PER_SEC * dt);
}

/** Adds one crystal, clamped at full. */
export function refuel(fuel: number): number {
  return Math.min(FUEL_MAX, fuel + FUEL_PER_CRYSTAL);
}
