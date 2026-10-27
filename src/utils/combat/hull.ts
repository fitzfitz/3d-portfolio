/** The ship's hull in the Nest: damage, delayed regen, and the breach restore. Mutates in place. */
import { HULL_AFTER_BREACH, HULL_MAX, HULL_REGEN_DELAY_S, HULL_REGEN_PER_S } from "./constants";

export interface Hull { hp: number; lastHitAt: number }

export function createHull(): Hull {
  return { hp: HULL_MAX, lastHitAt: -Infinity };
}

/**
 * Takes `amount` off the hull at time `now`. True only on the hit that takes it
 * to 0, so several hits in one frame report one breach.
 */
export function damageHull(h: Hull, amount: number, now: number): boolean {
  const before = h.hp;
  h.hp = Math.max(0, before - amount);
  h.lastHitAt = now;
  return before > 0 && h.hp === 0;
}

/** Regenerates `dt` seconds' worth once `HULL_REGEN_DELAY_S` has passed since the last hit. */
export function regenHull(h: Hull, dt: number, now: number): void {
  if (now - h.lastHitAt < HULL_REGEN_DELAY_S) return;
  h.hp = Math.min(HULL_MAX, h.hp + HULL_REGEN_PER_S * dt);
}

/** After a breach tow: back to `HULL_AFTER_BREACH`, and regen waits again. */
export function restoreAfterBreach(h: Hull, now: number): void {
  h.hp = HULL_AFTER_BREACH;
  h.lastHitAt = now;
}
