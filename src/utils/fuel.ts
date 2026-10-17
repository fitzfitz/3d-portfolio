/**
 * Warp fuel. Pure transforms so the tuning is testable without a scene.
 *
 * Tuning (2026-10-17, owner's call): the tank lasts five times the original
 * 12.5 s of warp, so 62.5 s (about 2,400 units at 39 u/s), and the drive's
 * reactor refills an empty tank in 20 s, but only while the pilot is not
 * holding warp. Crystals still top it up at once.
 */
export const FUEL_MAX = 100;

/** Units per second while warp is active. 100/1.6 = 62.5 s of warp. */
export const FUEL_DRAIN_PER_SEC = 1.6;
/** Units per second refilled while warp is not held. 100/5 = 20 s from empty. */
export const FUEL_REGEN_PER_SEC = 5;

/** Restored per crystal. Four fill an empty tank; one buys ~122 units of warp. */
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

/** Adds one crystal, clamped at full. */
export function refuel(fuel: number): number {
  return Math.min(FUEL_MAX, fuel + FUEL_PER_CRYSTAL);
}

/**
 * Below this the tank reads as "low": the HUD gauge goes amber
 * (HUDOverlay.tsx) and a pickup announces itself (FuelCrystals.tsx). It lives
 * here, exported, so those two can never disagree about where "low" is — a
 * duplicated literal at each site is how the bar would end up going amber at a
 * level where the pickup had gone silent.
 *
 * Deliberately NOT derived from FUEL_PER_CRYSTAL, which shares its value
 * today. They answer different questions and must be retunable apart.
 */
export const FUEL_LOW = 25;

/** What a pickup should announce, given the tank level before it landed. */
export type RefuelOutcome = "vented" | "restored" | "topped-up" | "quiet";

/**
 * Which confirmation a pickup deserves.
 *
 * Only a pickup that lifts the tank out of low speaks. A pickup on a healthy
 * tank stays quiet on purpose: RadioChatter's `typeLine` interrupts whatever
 * is on screen (cancelling the in-progress typewriter, playing a tick, and
 * resetting the ambient timer), so a line per pickup would stomp the ticker
 * while crossing a field of 40 respawning crystals.
 *
 * That "lifts out of low" framing holds only because `FUEL_PER_CRYSTAL >=
 * FUEL_LOW` (both happen to be 25 today — see `FUEL_LOW`'s comment on why
 * that is a coincidence, not a relationship the code enforces). Retune
 * `FUEL_PER_CRYSTAL` below `FUEL_LOW` and a pickup can leave the tank still
 * below `FUEL_LOW` — gauge still amber — yet still announce "topped-up": not
 * a bug (the message never claims the tank is healthy now), but this
 * comment's framing would then overstate what happened. Worth knowing before
 * either constant moves.
 *
 * `restored` and `topped-up` are separate because only one of them turns warp
 * back on. Announcing "WARP ONLINE" on a 10% -> 35% pickup would state
 * something untrue, and this HUD is careful about that distinction — the DRY
 * line goes out of its way to add "THRUSTERS STILL NOMINAL".
 */
export function refuelOutcome(before: number): RefuelOutcome {
  if (before >= FUEL_MAX) return "vented";
  if (before <= 0) return "restored";
  if (before < FUEL_LOW) return "topped-up";
  return "quiet";
}
