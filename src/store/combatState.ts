import { createNest } from "../utils/combat/nest";

/**
 * The Nest fight's per-frame state, mutable outside React (like `flight`).
 * The director (the combat frame loop) writes it; the Spaceship, HUD layers
 * and radar read it. Times are performance.now() / 1000. What React needs to
 * re-render on (wave, contacts, breach, cleared) lives in slices/combat.ts.
 */
export const combat = {
  /** The machine, its pools and the hull (combat.nest.hull.hp). */
  nest: createNest(),
  /** Fire mode: within the fighting area, not racing. */
  inArea: false,
  /** Hull-hit feedbacks so far; Spaceship reacts to a change. */
  hits: 0,
  /** A breach asks Spaceship to tow the ship. */
  towRequest: false,
  /** A click's aim point inside the area. */
  click: { pending: false, x: 0, y: 0, z: 0 },
  /** The Nest's programs and maps are on the GPU. */
  warm: false,
  enteredAt: -Infinity,
  flashAt: -Infinity,
  clearedAt: -Infinity,
  breachAt: -Infinity,
};
