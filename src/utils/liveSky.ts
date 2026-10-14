import * as THREE from "three";
import { COSMIC_BOUNDS } from "../constants";
import { hasPlumeColour } from "../data/plumeColors";
import { toroidalDistance3, wrapDelta } from "./toroidal";
import {
  normQuat, publicCountry, SKY_CAP,
  type Quat, type ServerMessage, type ShipState, type SnapShip, type Vec3,
} from "./liveSkyProtocol";

/**
 * Live sky, client side (spec docs/superpowers/specs/2026-10-14-live-sky-design.md §4):
 * parsing the room's messages, smoothing ghosts between snapshots, and deciding
 * when this ship's pose is worth sending. Pure apart from liveSkyUrl().
 */

export const RENDER_DELAY_MS = 250;
export const FADE_IN_MS = 500;
export const MAX_GHOSTS = 8;
export const GHOST_LABEL = "LIVE PILOT";
export const LIVE_SKY_NOTICE = "LIVE SKY // OTHER PILOTS CAN SEE YOUR SHIP, PLUME AND COUNTRY. TOGGLE IN THE LOGBOOK (L)";
const SEND_INTERVAL_MS = 200;
const MOVE_EPS = 0.05;
const TURN_EPS = Math.PI / 180;

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
const clamp = (v: number) => Math.max(-COSMIC_BOUNDS, Math.min(COSMIC_BOUNDS, v));

function parseShip(row: unknown): SnapShip | null {
  if (!row || typeof row !== "object") return null;
  const { id, p, q, plume, cc } = row as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0 || id.length > 16) return null;
  if (!Array.isArray(p) || p.length !== 3 || !p.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const nq = normQuat(q);
  if (!nq) return null;
  return {
    id,
    p: [clamp(p[0]), clamp(p[1]), clamp(p[2])],
    q: nq,
    plume: typeof plume === "string" && hasPlumeColour(plume) ? plume : "stock",
    cc: typeof cc === "string" ? publicCountry(cc) : null,
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
    case "snap":
      if (!Array.isArray(o.ships)) return null;
      return { t: "snap", ships: o.ships.slice(0, SKY_CAP).map(parseShip).filter((s): s is SnapShip => s !== null) };
    default: return null;
  }
}

export interface GhostPose { id: string; p: Vec3; q: Quat; plume: string; cc: string | null; alpha: number }
interface Sample { at: number; p: Vec3; q: Quat }
interface Track { samples: Sample[]; firstSeen: number; plume: string; cc: string | null }

const wrap = (v: number) => {
  const span = COSMIC_BOUNDS * 2;
  return ((((v + COSMIC_BOUNDS) % span) + span) % span) - COSMIC_BOUNDS;
};

function blend(a: Sample, b: Sample, k: number): { p: Vec3; q: Quat } {
  const p = [0, 1, 2].map((i) => wrap(a.p[i] + wrapDelta(a.p[i], b.p[i], COSMIC_BOUNDS) * k)) as Vec3;
  // Normalised lerp on the short arc; at 250 ms steps it is indistinguishable from slerp.
  const sign = a.q[0] * b.q[0] + a.q[1] * b.q[1] + a.q[2] * b.q[2] + a.q[3] * b.q[3] < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((i) => a.q[i] * (1 - k) + b.q[i] * sign * k) as Quat;
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return { p, q: [q[0] / l, q[1] / l, q[2] / l, q[3] / l] };
}

/** Recent snapshots per ghost, sampled RENDER_DELAY_MS in the past so motion is smooth. */
export class GhostBuffer {
  private tracks = new Map<string, Track>();

  get size(): number { return this.tracks.size; }

  /** One snapshot, stamped with its arrival time. A ghost missing from it has left. */
  push(ships: readonly SnapShip[], at: number): void {
    const seen = new Set<string>();
    for (const s of ships) {
      seen.add(s.id);
      const sample: Sample = { at, p: s.p, q: s.q };
      const t = this.tracks.get(s.id);
      if (!t) { this.tracks.set(s.id, { samples: [sample], firstSeen: at, plume: s.plume, cc: s.cc }); continue; }
      t.samples.push(sample);
      if (t.samples.length > 4) t.samples.shift();
      t.plume = s.plume;
      t.cc = s.cc;
    }
    for (const id of [...this.tracks.keys()]) if (!seen.has(id)) this.tracks.delete(id);
  }

  clear(): void { this.tracks.clear(); }

  sample(now: number, fadeMs = FADE_IN_MS): GhostPose[] {
    const t = now - RENDER_DELAY_MS;
    const out: GhostPose[] = [];
    for (const [id, tr] of this.tracks) {
      const s = tr.samples;
      let i = s.length - 1;
      while (i > 0 && s[i].at > t) i--;
      const a = s[i], b = s[i + 1];
      const pose = !b || t <= a.at
        ? { p: a.p, q: a.q }
        : blend(a, b, Math.min(1, (t - a.at) / Math.max(1, b.at - a.at)));
      const alpha = fadeMs <= 0 ? 1 : Math.min(1, (now - tr.firstSeen) / fadeMs);
      out.push({ id, p: pose.p, q: pose.q, plume: tr.plume, cc: tr.cc, alpha });
    }
    return out;
  }
}

/** The n ghosts nearest the ship, measured across the wrap. */
export function nearestGhosts(ship: { x: number; y: number; z: number }, ghosts: GhostPose[], n: number): GhostPose[] {
  const d = (g: GhostPose) => toroidalDistance3(ship.x, ship.z, ship.y, g.p[0], g.p[2], g.p[1], COSMIC_BOUNDS);
  return ghosts.map((g) => ({ g, d: d(g) })).sort((a, b) => a.d - b.d).slice(0, n).map((e) => e.g);
}

export interface SendState { lastAt: number; lastP: Vec3 | null; lastQ: Quat | null; lastPlume: string | null; syncPending: boolean }
export const newSendState = (): SendState => ({ lastAt: -Infinity, lastP: null, lastQ: null, lastPlume: null, syncPending: false });

/** Spec §3.2: only with company, at most every 200 ms, and only when something changed or the room asked. */
export function shouldSend(s: SendState, peers: number, now: number, me: ShipState): boolean {
  if (peers <= 0 || now - s.lastAt < SEND_INTERVAL_MS) return false;
  if (s.syncPending || !s.lastP || !s.lastQ || s.lastPlume !== me.plume) return true;
  const moved = Math.hypot(
    wrapDelta(s.lastP[0], me.p[0], COSMIC_BOUNDS),
    wrapDelta(s.lastP[1], me.p[1], COSMIC_BOUNDS),
    wrapDelta(s.lastP[2], me.p[2], COSMIC_BOUNDS),
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
  s.syncPending = false;
}

const euler = new THREE.Euler();
const quat = new THREE.Quaternion();
/** The ship's orientation as Spaceship.tsx sets it: rotation (-pitch, heading, 0, "YXZ"). */
export function shipQuat(heading: number, pitch: number): Quat {
  quat.setFromEuler(euler.set(-pitch, heading, 0, "YXZ"));
  return [quat.x, quat.y, quat.z, quat.w];
}

/** Ghost scannables → their pilot's public country, read by generateScanReport. */
export const ghostRegistry = new Map<string, string | null>();
export const ghostScanId = (id: string) => `ghost_${id}`;
export const ghostReport = (cc: string | null) => (cc ? `PILOT FROM ${cc} · LIVE` : "PILOT · LIVE");
