/**
 * The Nest's radio and pause rules, pure so they are unit-tested
 * (tests/nestRadio.test.ts); NestDirector applies them each frame.
 */
import { NEST_LEASH_R, NEST_RUMOUR_R } from "./constants";

/**
 * The rumour line is due: not told yet this page, the ship outside the
 * fighting area but within `NEST_RUMOUR_R` of the centre, not racing, and the
 * radio free.
 */
export function rumourDue(told: boolean, dist: number, racing: boolean, radioBusy: boolean): boolean {
  return !told && dist > NEST_LEASH_R && dist <= NEST_RUMOUR_R && !racing && !radioBusy;
}

/** What pauses the fight (C6). A dossier already freezes the whole frame loop. */
export interface NestPauseState {
  photoMode: boolean; logbookOpen: boolean; changelogOpen: boolean; bottlePanelOpen: boolean;
}

/** The fight pauses (nothing moves, fires, damages or times out) in photo mode and under these panels. */
export function nestPaused(s: NestPauseState): boolean {
  return s.photoMode || s.logbookOpen || s.changelogOpen || s.bottlePanelOpen;
}
