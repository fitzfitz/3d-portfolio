import type { LiveSkyConnection } from "./liveSkyConnection";
import type { RaceClientMessage } from "./raceProtocol";

/**
 * The live-sky connection the race talks through. Ghosts.tsx owns the
 * connection and sets `conn` while it is mounted (null otherwise); the scene
 * and the HUD send through sendRace and read `conn.racing`.
 */
export const raceLink: { conn: LiveSkyConnection | null } = { conn: null };

/** Sends a race message to the room; false when the live sky is not connected. */
export function sendRace(m: RaceClientMessage): boolean {
  return raceLink.conn?.sendRace(m) ?? false;
}
