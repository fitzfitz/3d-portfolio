/**
 * Counts the ship's teleports (a jump, the breach tow, the race grid, an orbit
 * break's push-out, a debug teleport), mutable outside React like `flight`.
 * Spaceship bumps it wherever it places the ship; the Nest director reads it,
 * so a teleport frame gives the fight a zero ship velocity instead of one from
 * the position change, which would sweep the ship's hit sphere along the whole
 * jump and register false enemy-bolt hits.
 */
export const shipTeleport = { seq: 0 };

export function markShipTeleport(): void {
  shipTeleport.seq++;
}
