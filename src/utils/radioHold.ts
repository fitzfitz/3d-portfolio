/**
 * A broadcast with real content (scan report, shard fact, the next-stop hint)
 * keeps the radio line for this long; ambient flavour lines are skipped, not
 * queued, until it ends. A newer broadcast still replaces the line at once.
 */
export const BROADCAST_HOLD_MS = 8000;

/** May a flavour line (zone, ambient, comet, impact) type now? */
export function flavourAllowed(now: number, heldUntil: number): boolean {
  return now >= heldUntil;
}

/**
 * The hold a just-typed broadcast sets. A silent one (hails, callouts) starts
 * no hold; since it replaced the line it also ends any earlier hold (0).
 */
export function holdUntil(now: number, b: { silent: boolean }): number {
  return b.silent ? 0 : now + BROADCAST_HOLD_MS;
}
