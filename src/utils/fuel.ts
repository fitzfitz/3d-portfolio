/**
 * Warp fuel. Pure transforms so the tuning is testable without a scene.
 *
 * Tuning (2026-10-17, owner's call): the tank lasts five times the original
 * 12.5 s of warp, so 62.5 s (about 2,400 units at 39 u/s), and the drive's
 * reactor refills an empty tank in 20 s, but only while the pilot is not
 * holding warp. Mining belt pebbles (mining.ts) tops it up too.
 */
export const FUEL_MAX = 100;

/** Units per second while warp is active. 100/1.6 = 62.5 s of warp. */
export const FUEL_DRAIN_PER_SEC = 1.6;
/** Units per second refilled while warp is not held. 100/5 = 20 s from empty. */
export const FUEL_REGEN_PER_SEC = 5;

/**
 * One "crystal's worth": the unit mining counts in (ORE_PER_CRYSTAL pebbles,
 * mining.ts). The fly-through fuel crystals are gone (2026-10-26); the unit stays,
 * since ore pays out per pebble against it.
 */
export const FUEL_PER_CRYSTAL = 25;

/** Drains for `dt` seconds, clamped at empty. */
export function drainFuel(fuel: number, dt: number): number {
  return Math.max(0, fuel - FUEL_DRAIN_PER_SEC * dt);
}

/**
 * Dev-only test hook (e2e fuel probe): `holdRegen` pauses the auto-refill so a
 * probe can hold the tank at an exact level without holding Shift. Always
 * false in production; registered on the debug bridge by Spaceship in dev.
 */
export const fuelDebug = { holdRegen: false };

/** Refills for `dt` seconds, clamped at full. */
export function regenFuel(fuel: number, dt: number): number {
  return Math.min(FUEL_MAX, fuel + FUEL_REGEN_PER_SEC * dt);
}

/**
 * One frame of fuel. Warp running drains; otherwise the tank refills, but
 * only while the pilot is not holding warp. If holding warp on an empty tank
 * refilled it, warp would switch back on the next frame and flicker.
 */
export function stepFuel(fuel: number, dt: number, boostHeld: boolean, warpActive: boolean): number {
  if (warpActive) return drainFuel(fuel, dt);
  return boostHeld ? fuel : regenFuel(fuel, dt);
}

/**
 * Below this the tank reads as "low": the HUD gauge goes amber
 * (HUDOverlay.tsx). Exported so the gauge never carries a bare literal.
 */
export const FUEL_LOW = 25;
