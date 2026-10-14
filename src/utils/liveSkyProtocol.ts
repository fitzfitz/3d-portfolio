import { COSMIC_BOUNDS } from "../constants";
import { hasPlumeColour } from "../data/plumeColors";

/**
 * Live sky wire protocol (docs/superpowers/specs/2026-10-14-live-sky-design.md §3).
 * Shared by the client and beacon-api's Sky room, so both validate the same way,
 * as src/utils/beacons.ts is for beacons.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export interface ShipState { p: Vec3; q: Quat; plume: string }
export interface SnapShip extends ShipState { id: string; cc: string | null }

export type ServerMessage =
  | { t: "hello"; id: string; peers: number }
  | { t: "peers"; n: number }
  | { t: "sync" }
  | { t: "snap"; ships: SnapShip[] }
  | { t: "full" };

/** Open sockets per room; the next one is turned away with `full`. */
export const SKY_CAP = 40;
export const MAX_MESSAGE_BYTES = 256;
/** Room-wide gap between snapshots. */
export const SNAP_INTERVAL_MS = 250;
/** More messages than this in one second closes the socket. A good client sends 5. */
export const FLOOD_PER_SECOND = 10;
/** A ship mid-wrap can sit a hair past ±COSMIC_BOUNDS. */
const EDGE_SLACK = 1;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** q scaled to unit length, or null unless it is close to unit already (|q|² in 0.9–1.1). */
export function normQuat(q: unknown): Quat | null {
  if (!Array.isArray(q) || q.length !== 4 || !q.every(finite)) return null;
  const [x, y, z, w] = q as Quat;
  const len2 = x * x + y * y + z * z + w * w;
  if (len2 < 0.9 || len2 > 1.1) return null;
  const l = Math.sqrt(len2);
  return [x / l, y / l, z / l, w / l];
}

function inWorld(p: unknown): p is Vec3 {
  return Array.isArray(p) && p.length === 3 && p.every((v) => finite(v) && Math.abs(v) <= COSMIC_BOUNDS + EDGE_SLACK);
}

/** A client's `me` message, as the room sees it. Null for anything invalid. */
export function parseMe(raw: unknown): ShipState | null {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES) return null;
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const { t, p, q, plume } = m as Record<string, unknown>;
  if (t !== "me" || !inWorld(p) || typeof plume !== "string" || !hasPlumeColour(plume)) return null;
  const nq = normQuat(q);
  return nq ? { p: [p[0], p[1], p[2]], q: nq, plume } : null;
}

/** Rounded for the wire: positions to 0.01, quaternion components to 0.001. */
export function roundState(s: ShipState): ShipState {
  return {
    p: s.p.map((v) => Math.round(v * 100) / 100) as Vec3,
    q: s.q.map((v) => Math.round(v * 1000) / 1000) as Quat,
    plume: s.plume,
  };
}

/** CF-IPCountry as a public code: unknown (XX), Tor (T1) and anything malformed become null. */
export function publicCountry(cc: string | null | undefined): string | null {
  return cc && /^[A-Z]{2}$/.test(cc) && cc !== "XX" && cc !== "T1" ? cc : null;
}
