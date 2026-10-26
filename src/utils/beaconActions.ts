import { flight, useSpaceStore } from "../store/spaceStore";
import { SYSTEM_RADIUS } from "../constants";
import { mergeBottles } from "./beacons";
import { fetchBottles, postBottle, dropFailureMessage, type DropResult } from "./beaconApi";
import { resetFlightInput } from "../hooks/useKeyboardInput";

/**
 * Opens the bottle panel. Releases held flight keys first: the panel owns
 * the keyboard while open, so a W held when it opened would never see its keyup.
 * Works with Show bottles off too: hiding bottles never stops writing one.
 */
export function openBottlePanel(): void {
  resetFlightInput(flight.input);
  useSpaceStore.getState().setBottlePanelOpen(true);
}

/**
 * Loads the sky's bottles and merges in the visitor's own. Fetches nothing
 * while Show bottles is off (spec "The visitor setting"). Silent on failure:
 * an empty sky is a valid sky.
 */
export async function loadBottles(): Promise<void> {
  if (!useSpaceStore.getState().showBottles) return;
  const list = await fetchBottles();
  const s = useSpaceStore.getState();
  s.setBeacons(mergeBottles(list, s.ownBottles));
}

/**
 * Drops a bottle with `text` where the ship is, and reports the outcome on
 * the radio. Returns the result so the panel can show a failure beside the
 * text it keeps.
 */
export async function dropBottle(text: string): Promise<DropResult> {
  useSpaceStore.getState().sendBroadcast("BOTTLE // SENDING...");
  // Bottles past the edge are accepted by the Worker but never drawn: clamp onto
  // the system sphere (direction preserved) so a drop is always visible.
  const m = Math.hypot(flight.x, flight.y, flight.z);
  const k = m > SYSTEM_RADIUS ? SYSTEM_RADIUS / m : 1;
  const r = await postBottle({ x: flight.x * k, y: flight.y * k, z: flight.z * k, text });
  const now = useSpaceStore.getState();
  if (r.ok) {
    now.addOwnBottle(r.bottle);
    // Shown at once, not on the next fetch: the list is cached for 30s.
    const after = useSpaceStore.getState();
    after.setBeacons(mergeBottles(after.beacons, after.ownBottles));
    after.sendBroadcast("BOTTLE DROPPED // EVERY PILOT WHO PASSES CAN READ IT");
  } else {
    now.sendBroadcast(`BOTTLE // ${dropFailureMessage(r).toUpperCase()}`);
  }
  return r;
}
