import type { SliceCreator } from "../spaceStore";

/** The Nest fight as React sees it; the per-frame part is combatState.ts. */
export interface CombatSlice {
  /** The ship is inside the fighting area. */
  inNest: boolean;
  /** Current wave (0 when no fight) and the live monsters in it. */
  wave: number;
  contacts: number;
  /** Date.now() ms of the last hull breach, or null. */
  hullBreachAt: number | null;
  /** Date.now() ms of the last clear, or null. */
  nestClearedAt: number | null;
  setInNest: (v: boolean) => void;
  setWave: (wave: number, contacts: number) => void;
  markHullBreach: (at: number) => void;
  /** Sets nestClearedAt, then earns the Nest breaker badge. */
  markNestCleared: (at: number) => void;
}

/** Cross-slice: markNestCleared calls the logbook slice's recordBadge. */
export const createCombatSlice: SliceCreator<CombatSlice> = (set, get) => ({
  inNest: false,
  wave: 0,
  contacts: 0,
  hullBreachAt: null,
  nestClearedAt: null,
  setInNest: (v) => { if (get().inNest !== v) set({ inNest: v }); },
  setWave: (wave, contacts) => {
    if (get().wave === wave && get().contacts === contacts) return;
    set({ wave, contacts });
  },
  markHullBreach: (at) => set({ hullBreachAt: at }),
  markNestCleared: (at) => {
    set({ nestClearedAt: at });
    get().recordBadge("nest");
  },
});
