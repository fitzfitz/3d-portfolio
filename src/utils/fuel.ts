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
