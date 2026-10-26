import { VALIDATION_RADIUS } from "../constants";
import { hasPlumeColour } from "../data/plumeColors";
import { BODY_IDS, LEGACY_CHART_TOTAL } from "../data/bodyIds";

/**
 * Live sky wire protocol (docs/archive/specs/2026-10-14-live-sky-design.md §3).
 * Shared by the client and beacon-api's Sky room, so both validate the same way,
 * as src/utils/beacons.ts is for beacons.
 */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
/** `ch`: bodies charted, 0-CHART_TOTAL (spec 2026-10-17 new worlds, "Live sky"; 9 bodies since PR #40). */
export interface ShipState { p: Vec3; q: Quat; plume: string; ch: number }
/**
 * `ago`: how old the pose was (ms) when the room sent it, so clients can time
 * it without a shared clock. `ch` is on the wire only when above 0, so rows
 * from pilots who charted nothing stay byte-identical.
 */
export interface SnapShip extends Omit<ShipState, "ch"> { id: string; cc: string | null; ago: number; ch?: number }

export type ServerMessage =
  | { t: "hello"; id: string; peers: number }
  | { t: "peers"; n: number }
  | { t: "sync" }
  | { t: "snap"; ships: SnapShip[] }
  | { t: "full" }
  /** Another pilot just charted every world (relayed once; see beacon-api/src/sky.ts). */
  | { t: "charted"; cc: string | null };

/** Bodies a pilot can chart: the most `ch` can be. */
export const CHART_TOTAL = BODY_IDS.length;
/**
 * The legacy-5 rule: a client older than PR #40 charted five fictional worlds
 * and sends ch 5 + the AURUM plume (and the title claim) as a cartographer.
 * The room keeps that plume and accepts that claim, so cached old clients keep
 * their gold. It is for plume coercion and the claim ONLY: what other pilots
 * see (ghost scans) is the title at CHART_TOTAL alone; a ch-5 ghost reads 5/9.
 * A new client that is a cartographer by the legacy flag sends CHART_TOTAL.
 * TODO: remove once no client older than PR #40 can be cached (asset-pack SW max age).
 */
export const isCartographerCount = (n: number): boolean => n === CHART_TOTAL || n === LEGACY_CHART_TOTAL;
/** The plume that needs a cartographer count, in the same message. */
const CARTOGRAPHER_PLUME = "cartographer";

/** Open sockets per room; the next one is turned away with `full`. */
export const SKY_CAP = 40;
export const MAX_MESSAGE_BYTES = 256;
/** Room-wide gap between snapshots. */
export const SNAP_INTERVAL_MS = 250;
/** A pilot not heard from for this long is left out of snapshots: their connection has likely died without a close. */
export const STALE_MS = 60_000;
/** More messages than this in one second closes the socket. A good client sends 5. */
export const FLOOD_PER_SECOND = 10;
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
  return Array.isArray(p) && p.length === 3 && p.every(finite) && Math.hypot(p[0], p[1], p[2]) <= VALIDATION_RADIUS;
}

/** A client message, as the room sees it: a pose, the title claim, or null for anything else. Parsed once. */
export type ClientMessage = { t: "me"; state: ShipState } | { t: "charted" };

export function parseClient(raw: unknown): ClientMessage | null {
  // A UTF-8 string is never shorter in bytes than in characters, so the cheap
  // length check turns away an oversized frame before it is encoded.
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return null;
  if (new TextEncoder().encode(raw).length > MAX_MESSAGE_BYTES) return null;
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  if (o.t === "charted") return { t: "charted" };
  if (o.t !== "me") return null;
  const state = poseFrom(o);
  return state ? { t: "me", state } : null;
}

/** A client's `me` message, as the room sees it. Null for anything invalid. */
export function parseMe(raw: unknown): ShipState | null {
  const m = parseClient(raw);
  return m?.t === "me" ? m.state : null;
}

/** A client's `{t:"charted"}`: it has just charted every world (the room decides whether to relay it). */
export function isChartedClaim(raw: unknown): boolean {
  return parseClient(raw)?.t === "charted";
}

function poseFrom({ p, q, plume, ch }: Record<string, unknown>): ShipState | null {
  if (!inWorld(p) || typeof plume !== "string" || !hasPlumeColour(plume)) return null;
  const nq = normQuat(q);
  if (!nq) return null;
  // A bad count never hides a pilot: it reads as 0. AURUM needs a cartographer
  // count (CHART_TOTAL, or the legacy 5) in the same message, or it shows as stock.
  const n = chartCount(ch);
  return { p: [p[0], p[1], p[2]], q: nq, plume: plume === CARTOGRAPHER_PLUME && !isCartographerCount(n) ? "stock" : plume, ch: n };
}

/** A charted count: a whole number 0-CHART_TOTAL, anything else 0. */
export function chartCount(v: unknown): number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= CHART_TOTAL ? (v as number) : 0;
}


/** Rounded for the wire: positions to 0.01, quaternion components to 0.001. Pass `out` to reuse an object. */
export function roundState(s: ShipState, out: ShipState = { p: [0, 0, 0], q: [0, 0, 0, 1], plume: "stock", ch: 0 }): ShipState {
  for (let i = 0; i < 3; i++) out.p[i] = Math.round(s.p[i] * 100) / 100;
  for (let i = 0; i < 4; i++) out.q[i] = Math.round(s.q[i] * 1000) / 1000;
  out.plume = s.plume;
  out.ch = s.ch ?? 0;
  return out;
}

/** CF-IPCountry as a public code: unknown (XX), Tor (T1) and anything malformed become null. */
export function publicCountry(cc: string | null | undefined): string | null {
  return cc && /^[A-Z]{2}$/.test(cc) && cc !== "XX" && cc !== "T1" ? cc : null;
}
