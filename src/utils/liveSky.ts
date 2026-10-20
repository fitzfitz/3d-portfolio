import * as THREE from "three";
import { VALIDATION_RADIUS } from "../constants";
import { hasPlumeColour, PLUME_COLORS } from "../data/plumeColors";
import {
  normQuat, publicCountry, chartCount, isCartographerCount, CHART_TOTAL, SKY_CAP, SNAP_INTERVAL_MS, STALE_MS,
  type Quat, type ServerMessage, type ShipState, type SnapShip, type Vec3,
} from "./liveSkyProtocol";

/**
 * Live sky, client side (spec docs/superpowers/specs/2026-10-14-live-sky-design.md §4):
 * parsing the room's messages, smoothing ghosts between snapshots, and deciding
 * when this ship's pose is worth sending. Pure apart from liveSkyUrl().
 */

/** Two snapshot intervals: room for one late snapshot before a ghost stalls. */
export const RENDER_DELAY_MS = 2 * SNAP_INTERVAL_MS;
export const FADE_IN_MS = 500;
export const MAX_GHOSTS = 8;
export const GHOST_LABEL = "LIVE PILOT";
export const LIVE_SKY_NOTICE = "LIVE SKY // OTHER PILOTS CAN SEE YOUR SHIP, PLUME, COUNTRY AND WORLDS CHARTED. TOGGLE IN THE LOGBOOK (L)";
const SEND_INTERVAL_MS = 200;
const MOVE_EPS = 0.05;
const TURN_EPS = Math.PI / 180;
/** A still pilot in company re-sends this often, so the room can tell them from a dead connection (STALE_MS). */
export const KEEPALIVE_MS = 20_000;
/** A gap this long between a ghost's samples means it sat still, not that it drifted slowly. */
const STILL_GAP_MS = 1000;

/**
 * Where the live sky room lives, baked in at build time. Empty means the
 * feature does not exist. Dev builds accept a localStorage override for the
 * e2e probe, stripped from production like beaconApiUrl().
 */
export function liveSkyUrl(): string {
  if (import.meta.env.DEV) {
    try {
      const o = localStorage.getItem("fitz-live-sky-dev");
      if (o) return o;
    } catch { /* storage blocked */ }
  }
  return (import.meta.env.VITE_LIVE_SKY ?? "").replace(/\/+$/, "");
}

const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= SKY_CAP;
/** Pulls a position onto the VALIDATION_RADIUS sphere, keeping its direction. */
function clampToSphere(p: number[]): [number, number, number] {
  const r = Math.hypot(p[0], p[1], p[2]);
  const k = r > VALIDATION_RADIUS ? VALIDATION_RADIUS / r : 1;
  return [p[0] * k, p[1] * k, p[2] * k];
}

function parseShip(row: unknown): SnapShip | null {
  if (!row || typeof row !== "object") return null;
  const { id, p, q, plume, cc, ago, ch } = row as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0 || id.length > 16) return null;
  if (!Array.isArray(p) || p.length !== 3 || !p.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const nq = normQuat(q);
  if (!nq) return null;
  return {
    id,
    p: clampToSphere(p),
    q: nq,
    // The room checks AURUM against the count; a client checks again, since the room is untrusted too.
    plume: typeof plume === "string" && hasPlumeColour(plume) && (plume !== "cartographer" || isCartographerCount(chartCount(ch))) ? plume : "stock",
    ch: chartCount(ch),
    cc: typeof cc === "string" ? publicCountry(cc) : null,
    ago: typeof ago === "number" && Number.isFinite(ago) && ago > 0 ? Math.min(ago, STALE_MS) : 0,
  };
}

/** A room message. Snapshots are untrusted: rows are clamped, cleaned or dropped, never trusted. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string") return null;
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case "hello": return typeof o.id === "string" && isCount(o.peers) ? { t: "hello", id: o.id, peers: o.peers } : null;
    case "peers": return isCount(o.n) ? { t: "peers", n: o.n } : null;
    case "sync": return { t: "sync" };
    case "full": return { t: "full" };
    case "charted": return { t: "charted", cc: typeof o.cc === "string" ? publicCountry(o.cc) : null };
    case "snap":
      if (!Array.isArray(o.ships)) return null;
      return { t: "snap", ships: o.ships.slice(0, SKY_CAP).map(parseShip).filter((s): s is SnapShip => s !== null) };
    default: return null;
  }
}

/** A ghost's pose this frame. GhostBuffer reuses one per ghost, so read it, don't keep it. */
export interface GhostPose {
  id: string; p: Vec3; q: Quat; plume: string; cc: string | null; alpha: number;
  /** Worlds this pilot has charted, 0-CHART_TOTAL. */
  ch: number;
  /** ghostScanId(id), built once. */
  scanId: string;
  /** Scratch for nearestGhosts. */
  dist: number;
}
interface Sample { at: number; p: Vec3; q: Quat }
interface Track { samples: Sample[]; firstSeen: number; pose: GhostPose }

/** Writes the blend of `a` and `b` at `k` into `out` (no allocation: it runs per ghost per frame). */
function blendInto(a: Sample, b: Sample, k: number, out: GhostPose): void {
  for (let i = 0; i < 3; i++) out.p[i] = a.p[i] + (b.p[i] - a.p[i]) * k;
  // Normalised lerp on the short arc; at 250 ms steps it is indistinguishable from slerp.
  const sign = a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3] < 0 ? -1 : 1;
  for (let i = 0; i < 4; i++) out.q[i] = a.q[i] * (1 - k) + b.q[i] * sign * k;
  const l = Math.hypot(out.q[0], out.q[1], out.q[2], out.q[3]);
  for (let i = 0; i < 4; i++) out.q[i] /= l;
}

function holdInto(s: Sample, out: GhostPose): void {
  for (let i = 0; i < 3; i++) out.p[i] = s.p[i];
  for (let i = 0; i < 4; i++) out.q[i] = s.q[i];
}

/** Recent snapshots per ghost, sampled RENDER_DELAY_MS in the past so motion is smooth. */
export class GhostBuffer {
  private tracks = new Map<string, Track>();
  private out: GhostPose[] = [];

  get size(): number { return this.tracks.size; }

  /**
   * One snapshot, arriving at `arrival`. Each pose is timed by when it was
   * sent (arrival minus its `ago`), not when the snapshot came: the pilot's
   * 200 ms sends and the room's 250 ms snapshots would otherwise alias into a
   * lurch. A ghost missing from the snapshot has left.
   */
  push(ships: readonly SnapShip[], arrival: number): void {
    const seen = new Set<string>();
    for (const s of ships) {
      seen.add(s.id);
      const at = arrival - s.ago;
      const t = this.tracks.get(s.id);
      if (!t) {
        const pose: GhostPose = { id: s.id, p: [...s.p], q: [...s.q], plume: s.plume, cc: s.cc, ch: s.ch ?? 0, alpha: 0, scanId: ghostScanId(s.id), dist: 0 };
        this.tracks.set(s.id, { samples: [{ at, p: s.p, q: s.q }], firstSeen: arrival, pose });
        continue;
      }
      t.pose.plume = s.plume;
      t.pose.cc = s.cc;
      t.pose.ch = s.ch ?? 0;
      const last = t.samples[t.samples.length - 1];
      if (at <= last.at) continue; // the same pose again (a still pilot), or one older than we hold
      // After a long stillness, hold the old pose until just before the new
      // one, so a ghost that starts moving glides off rather than jumping.
      if (at - last.at > STILL_GAP_MS) t.samples.push({ at: at - SNAP_INTERVAL_MS, p: last.p, q: last.q });
      t.samples.push({ at, p: s.p, q: s.q });
      while (t.samples.length > 4) t.samples.shift();
    }
    for (const id of [...this.tracks.keys()]) if (!seen.has(id)) this.tracks.delete(id);
  }

  clear(): void { this.tracks.clear(); }

  /**
   * Every ghost's pose at `now - RENDER_DELAY_MS`. The array and the pose
   * objects are reused on every call (it runs per frame): read them, don't
   * keep them.
   */
  sample(now: number, fadeMs = FADE_IN_MS): GhostPose[] {
    const t = now - RENDER_DELAY_MS;
    const out = this.out;
    out.length = 0;
    for (const tr of this.tracks.values()) {
      const s = tr.samples;
      let i = s.length - 1;
      while (i > 0 && s[i].at > t) i--;
      const a = s[i], b = s[i + 1];
      if (!b || t <= a.at) holdInto(a, tr.pose);
      else blendInto(a, b, Math.min(1, (t - a.at) / Math.max(1, b.at - a.at)), tr.pose);
      tr.pose.alpha = fadeMs <= 0 ? 1 : Math.min(1, (now - tr.firstSeen) / fadeMs);
      out.push(tr.pose);
    }
    return out;
  }
}

const byDist = (a: GhostPose, b: GhostPose) => a.dist - b.dist;

/** The n ghosts nearest the ship, measured in plain 3D: sorts and trims `ghosts` in place. */
export function nearestGhosts(ship: { x: number; y: number; z: number }, ghosts: GhostPose[], n: number): GhostPose[] {
  for (const g of ghosts) g.dist = Math.hypot(ship.x - g.p[0], ship.z - g.p[2], ship.y - g.p[1]);
  ghosts.sort(byDist);
  if (ghosts.length > n) ghosts.length = n;
  return ghosts;
}

export interface RadarBlip { x: number; y: number; z: number; hex: string }
/**
 * Every live ghost for the HUD radar (RadarMap reads it in its own loop):
 * written by Ghosts each frame, entries reused. `count` is how many are live.
 */
export const liveRadar = { blips: [] as RadarBlip[], count: 0 };

export function writeRadarBlips(poses: readonly GhostPose[]): void {
  for (let i = 0; i < poses.length; i++) {
    const g = poses[i];
    const b = liveRadar.blips[i] ?? (liveRadar.blips[i] = { x: 0, y: 0, z: 0, hex: "" });
    b.x = g.p[0]; b.y = g.p[1]; b.z = g.p[2];
    b.hex = (PLUME_COLORS[g.plume] ?? PLUME_COLORS.stock).hex;
  }
  liveRadar.count = poses.length;
}

export interface SendState { lastAt: number; lastP: Vec3 | null; lastQ: Quat | null; lastPlume: string | null; lastCh: number; syncPending: boolean }
export const newSendState = (): SendState => ({ lastAt: -Infinity, lastP: null, lastQ: null, lastPlume: null, lastCh: 0, syncPending: false });

/** Spec §3.2: only with company, at most every 200 ms, and only when something changed or the room asked. */
export function shouldSend(s: SendState, peers: number, now: number, me: ShipState): boolean {
  if (peers <= 0 || now - s.lastAt < SEND_INTERVAL_MS) return false;
  if (s.syncPending || !s.lastP || !s.lastQ || s.lastPlume !== me.plume || s.lastCh !== me.ch || now - s.lastAt >= KEEPALIVE_MS) return true;
  const moved = Math.hypot(
    (me.p[0] - s.lastP[0]),
    (me.p[1] - s.lastP[1]),
    (me.p[2] - s.lastP[2]),
  ) > MOVE_EPS;
  const dot = Math.abs(s.lastQ[0] * me.q[0] + s.lastQ[1] * me.q[1] + s.lastQ[2] * me.q[2] + s.lastQ[3] * me.q[3]);
  const turned = 2 * Math.acos(Math.min(1, dot)) > TURN_EPS;
  return moved || turned;
}

export function markSent(s: SendState, now: number, me: ShipState): void {
  s.lastAt = now;
  s.lastP = [...me.p];
  s.lastQ = [...me.q];
  s.lastPlume = me.plume;
  s.lastCh = me.ch;
  s.syncPending = false;
}

const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
/** The ship's orientation as Spaceship.tsx sets it: rotation (-pitch, heading, 0, "YXZ"), written into `out`. */
export function shipQuat(heading: number, pitch: number, out: Quat = [0, 0, 0, 1]): Quat {
  quat.setFromEuler(euler.set(-pitch, heading, 0, "YXZ"));
  out[0] = quat.x; out[1] = quat.y; out[2] = quat.z; out[3] = quat.w;
  return out;
}

/**
 * The radio line is on screen: the HUD (and RadioChatter in it) is unmounted
 * in photo mode and on the classic résumé. The live-sky notice only counts as
 * shown when it is (spec §5): consent is never recorded unseen.
 */
export const hudShowsRadio = (s: { photoMode: boolean; showClassicCV: boolean }) => !s.photoMode && !s.showClassicCV;

/** Ghost scannables → their pilot's public country and charted count, read by generateScanReport. */
export const ghostRegistry = new Map<string, { cc: string | null; ch: number }>();
export const ghostScanId = (id: string) => `ghost_${id}`;
/**
 * A ghost's scan text: the title at all nine bodies charted (a legacy ch 5 is
 * 5/9, untitled, though its AURUM plume is still drawn), the count below that,
 * today's text at none. "LIVE" stands in for an unknown country.
 */
export function ghostReport(cc: string | null, ch: number): string {
  if (ch === CHART_TOTAL) return `CARTOGRAPHER · ${cc ?? "LIVE"}`;
  if (ch > 0) return `${ch}/${CHART_TOTAL} CHARTED · ${cc ?? "LIVE"}`;
  return cc ? `PILOT FROM ${cc} · LIVE` : "PILOT · LIVE";
}
