import { flight, useSpaceStore } from "../store/spaceStore";
import { BEACON_LIMIT } from "./beacons";
import { BEACON_PHRASES } from "../data/beaconPhrases";
import { fetchBeacons, postBeacon } from "./beaconApi";
import { resetFlightInput } from "../hooks/useKeyboardInput";

/**
 * Opens the phrase picker. Releases held flight keys first: the picker owns
 * the keyboard while open, so a W held when it opened would never see its keyup.
 */
export function openBeaconPicker(): void {
  resetFlightInput(flight.input);
  useSpaceStore.getState().setBeaconPickerOpen(true);
}

/** Loads the sky's beacons once. Silent on failure: no beacons is a valid sky. */
export async function loadBeacons(): Promise<void> {
  const list = await fetchBeacons();
  useSpaceStore.getState().setBeacons(list);
}

/** Drops a beacon at the ship's position and reports the outcome on the radio. */
export async function dropBeacon(phrase: number): Promise<void> {
  const s = useSpaceStore.getState();
  s.sendBroadcast("BEACON // TRANSMITTING...");
  const r = await postBeacon({ x: flight.x, y: flight.y, z: flight.z, phrase });
  const now = useSpaceStore.getState();
  if (r.ok) {
    now.addOwnBeacon(r.beacon.id);
    // Shown at once, not on the next fetch: the list is cached for 30s.
    now.setBeacons([r.beacon, ...now.beacons.filter((b) => b.id !== r.beacon.id)].slice(0, BEACON_LIMIT));
    now.sendBroadcast(`BEACON DROPPED // "${BEACON_PHRASES[phrase]}" · VISIBLE TO EVERY PILOT WHO PASSES`);
  } else if (r.reason === "rate") {
    now.sendBroadcast("BEACON RELAY // ONE BEACON PER PILOT EVERY 10 MINUTES");
  } else if (r.reason === "invalid") {
    // The only drop a configured client can make that fails validation.
    now.sendBroadcast("BEACON REFUSED // TOO CLOSE TO THE SPAWN PAD. FLY OUT A LITTLE");
  } else {
    now.sendBroadcast("BEACON RELAY OFFLINE // TRY AGAIN LATER");
  }
}
