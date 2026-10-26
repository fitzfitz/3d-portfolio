export interface CrystalSlot { x: number; y: number; z: number; active: boolean }

/**
 * Live fuel-crystal slots, seeded and mutated by FuelCrystals' frame loop and
 * read by RadarMap's rAF loop. Module-level and mutable outside React — the same
 * pattern as `flight` and `bodies`, and for the same reason: a pickup or a
 * respawn must not cost a React render.
 *
 * Deliberately NOT routed through the debug bridge: that is dead-code-eliminated
 * in production, so the radar would draw no crystal blips for real visitors, and
 * at ~146-unit mean spacing the mechanic needs that cue to be findable at all.
 */
export const crystalSlots: CrystalSlot[] = [];
