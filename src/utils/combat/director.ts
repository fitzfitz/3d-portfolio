/**
 * The Nest director's per-frame rules, outside React so they are unit-tested
 * (tests/nestDirector.test.ts). NestDirector.tsx builds the step's input,
 * runs `stepNest`, then `applyNestEvents`. Allocation-free: every function
 * writes into a caller's object.
 */
import { NEST_BREACH_LINE, NEST_CLEARED_LINE, NEST_RUMOUR_LINE } from "../../data/chatterLines";
import { contactCount, resetNestEvents, type NestEvents, type NestState } from "./nest";
import { rumourDue } from "./nestRadio";
import type { ClickShot, V3 } from "./types";

/** The parts of store/combatState.ts's `combat` the director reads and writes. */
export interface NestCombat {
  nest: NestState;
  inArea: boolean;
  hits: number;
  towRequest: boolean;
  /** A click's aim point and camera ray, pending until the director takes it. */
  click: { pending: boolean } & ClickShot;
  warm: boolean;
  enteredAt: number;
  flashAt: number;
  clearedAt: number;
  breachAt: number;
}

/** What the events set off outside the fight: sounds, the radio and the store. */
export interface NestEffects {
  zap(): void;
  plasmaShot(): void;
  fanfare(): void;
  broadcast(text: string, silent: boolean): void;
  setInNest(on: boolean): void;
  setWave(wave: number, contacts: number): void;
  markHullBreach(atMs: number): void;
  markNestCleared(atMs: number): void;
}

/**
 * The breach tow, for Spaceship's frame: takes (clears) a pending request and
 * says whether to tow now. While the race grid places or holds the ship
 * (`gridHold`), a request is dropped, never kept: one latched on the frame a
 * grid is placed (an R10 rejoin, say) would otherwise tow the racer to the
 * buoy at GO (Ruling C28).
 */
export function takeTowRequest(c: { towRequest: boolean }, gridHold: boolean): boolean {
  const tow = c.towRequest && !gridHold;
  c.towRequest = false;
  return tow;
}

/**
 * Applies one step's events, then clears them (`resetNestEvents`): read
 * every frame, so ENTERING THE NEST shows once per crossing (C12) and a
 * shot sounds once, not on every later frame. `now` is in seconds
 * (performance.now() / 1000, the HUD layers' clock), `nowMs` is Date.now().
 * The store setters are called every frame; they skip unchanged values.
 */
export function applyNestEvents(c: NestCombat, ev: NestEvents, fx: NestEffects, now: number, nowMs: number): void {
  const n = c.nest;
  c.inArea = ev.inArea;
  fx.setInNest(ev.inArea);
  fx.setWave(n.wave, contactCount(n));
  if (ev.entered) c.enteredAt = now;
  if (ev.waveStarted > 0) fx.zap();
  if (ev.shots > 0) fx.plasmaShot();
  if (ev.feedback) { c.hits++; c.flashAt = now; }
  if (ev.breached) {
    c.towRequest = true;
    c.breachAt = now;
    fx.markHullBreach(nowMs);
    fx.broadcast(NEST_BREACH_LINE, false);
  }
  if (ev.cleared) {
    c.clearedAt = now;
    fx.fanfare();
    fx.broadcast(NEST_CLEARED_LINE, false);
    fx.markNestCleared(nowMs);
  }
  resetNestEvents(ev);
}

/** The ship's last position and the teleport count it was seen at. */
export interface ShipTrack { x: number; y: number; z: number; seq: number; has: boolean }

export function createShipTrack(): ShipTrack {
  return { x: 0, y: 0, z: 0, seq: 0, has: false };
}

/**
 * The ship's velocity from its position change over `dt`, into `out`. Zero
 * on the first frame and on a frame the ship teleported (`seq`, the
 * store/shipTeleport.ts count, moved on): a jump's position change would
 * sweep the ship's hit sphere along the whole jump.
 */
export function trackShip(t: ShipTrack, x: number, y: number, z: number, seq: number, dt: number, out: V3): V3 {
  if (!t.has || seq !== t.seq || !(dt > 0)) {
    out.x = 0; out.y = 0; out.z = 0;
  } else {
    out.x = (x - t.x) / dt; out.y = (y - t.y) / dt; out.z = (z - t.z) / dt;
  }
  t.x = x; t.y = y; t.z = z; t.seq = seq; t.has = true;
  return out;
}

/** The nose direction for a yaw and pitch, as pitchFlight.ts noseDirection has it, written in place. */
export function noseFrom(heading: number, pitch: number, out: V3): V3 {
  const cp = Math.cos(pitch);
  out.x = Math.sin(heading) * cp;
  out.y = Math.sin(pitch);
  out.z = Math.cos(heading) * cp;
  return out;
}

/**
 * A pending click (its aim point and camera ray) into `out` (consumed), else null. A click
 * while the fight is paused is dropped (`paused`). One inside the fire
 * cooldown stays pending, as the one queued click (a later click only moves
 * its aim), and is taken on the step whose cooldown ends (stepNest counts
 * `fireIn` down by `dt` before it fires), so a fast clicker loses no shot
 * (Ruling C18).
 */
export function takeClick(c: NestCombat, out: ClickShot, paused = false, dt = 0): ClickShot | null {
  const k = c.click;
  if (!k.pending) return null;
  if (paused) { k.pending = false; return null; }
  if (c.nest.fireIn - dt > 1e-9) return null;
  k.pending = false;
  out.x = k.x; out.y = k.y; out.z = k.z;
  out.ox = k.ox; out.oy = k.oy; out.oz = k.oz;
  out.dx = k.dx; out.dy = k.dy; out.dz = k.dz;
  return out;
}

/** Once per page: the rumour, silent, when `rumourDue`. True when it went out. */
export function maybeRumour(r: { told: boolean }, dist: number, racing: boolean, radioBusy: boolean, fx: NestEffects): boolean {
  if (!rumourDue(r.told, dist, racing, radioBusy)) return false;
  r.told = true;
  fx.broadcast(NEST_RUMOUR_LINE, true);
  return true;
}
