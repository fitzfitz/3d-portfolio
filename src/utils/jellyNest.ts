import { NEST_CENTRE } from "../data/nest";
import { NEST_LEASH_R } from "./combat/constants";
import { JELLY_RADIUS, type JellyKeepOut } from "./jellyMood";
import { selectModalOpen, selectRaceFlying, type SpaceState } from "../store/spaceStore";

/**
 * The jellyfish and the Nest (spec 2026-10-27-combat; Rulings C9, C19), for
 * SpaceJellyfish.tsx: the guide keeps out of the whole fighting area, where
 * the monsters fly (110 u, not the 70 u zone), and does not offer itself
 * while the ship is in the Nest.
 */

/** The Nest's keep-out: the fighting area plus the jellyfish's own reach, as a solid (r = body). Fixed. */
export function nestKeepOut(): JellyKeepOut {
  const r = NEST_LEASH_R + JELLY_RADIUS;
  return { x: NEST_CENTRE[0], y: NEST_CENTRE[1], z: NEST_CENTRE[2], r, body: r };
}

export type GuideOfferState = Pick<SpaceState, "isOrbitLocked" | "openDossier" | "raceView" | "photoMode" | "showClassicCV" | "inNest">;

/**
 * The guide's offer blockers (spec 2026-10-23-jellyfish-guide "Offering
 * itself"): docked or orbit-locked, a dossier open, racing, photo mode, the
 * classic résumé, the radio held (`radioBusy`), or the ship in the Nest's
 * fighting area.
 */
export function guideOfferBlocked(s: GuideOfferState, radioBusy: boolean): boolean {
  return selectModalOpen(s) || selectRaceFlying(s) || s.photoMode || s.showClassicCV || radioBusy || s.inNest;
}
