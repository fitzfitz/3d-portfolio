/**
 * The Nest machine: the fight's state (phase, wave, hull, the monster and
 * bolt pools) and `stepNest`, which runs one combat step. Pure and
 * allocation-free: the pools are built once in `createNest` and reused, and
 * every vector is module scratch.
 *
 * Phases: ready → (inward crossing of the 70 u zone) countdown → (3 s, warm,
 * the ship in the fighting area) fighting ⇄ gap (5 s after the last defeat) →
 * (wave 3 cleared) rest → (2 min) ready. A breach or 20 s out of the fighting
 * area ends the fight (ready).
 *
 * At home (spec 2026-10-27-nest-playable §2): while ready, warm and within
 * `NEST_LOAD_R`, once every slot is gone, wave 1's saucers sleep at the
 * sleeper offsets and the tardigrade at the centre; they are dropped beyond
 * `SLEEP_DROP_R`. Sleepers are never alive: no target, no attack, no
 * contact. The crossing wakes the saucers, wave 1 takes them in place, and
 * wave 3 wakes the tardigrade; every other spawn is in front of the ship
 * (`frontSpawn`), never within `SPAWN_MIN_SHIP` of the ship.
 *
 * Shooting (§4): held fire locks the nearest live monster within 25° of the
 * nose and keeps it while it is alive and within 40°, in the area and in a
 * fight (`lock`); held shots lead it, else go down the nose. A click leads
 * the monster within 6° of its camera ray, else goes at the click point, and
 * never locks. Every ship-bolt hit writes its point into the `strikes` ring.
 *
 * Events are written into a caller's `NestEvents` and never cleared here: the
 * caller reads them after `stepNest` and then calls `resetNestEvents` (so the
 * debug calls between frames can report too).
 */
import {
  BOLT_POOL, BOLT_R, BOLT_RANGE, BOLT_SPEED, CONTACT_DELAY_S, FIRE_INTERVAL_S, HIT_FEEDBACK_MIN_S, JET_DPS,
  MAX_SAUCERS, MAX_TARDIGRADES, NEST_LOAD_R, NEST_REST_S, NEST_ZONE_R, NOSE_OFFSET, OUT_LIMIT_S, SAUCER_HIT_R,
  SHIP_HIT_R, SLEEP_DROP_R, SPAWN_CONE_RAD, SPAWN_DIST, SPAWN_MAX_R, STRIKE_RING, TARDIGRADE_HIT_R, WAVE_GAP_S,
  WAVES, WAVES_LOW_PERF,
} from "./constants";
import { advanceBolt, clearBolts, createBoltPool, fireBolt, segmentHitsSphere, type BoltPool } from "./bolts";
import { createHull, damageHull, regenHull, restoreAfterBreach, type Hull } from "./hull";
import { acquireLock, clickAssist, leadAim, lockHolds, spreadDir } from "./aim";
import { inNestArea } from "./controls";
import { T_EPS, faceToward, roll, type MonsterBody } from "./monsterMotion";
import {
  createSaucer, hitSaucer, leaveSaucer, sleepSaucer, spawnSaucer, stepSaucer, wakeSaucer, type Saucer,
} from "./saucerAi";
import {
  createTardigrade, hitTardigrade, jetHit, leaveTardigrade, sleepTardigrade, spawnTardigrade, stepTardigrade,
  wakeTardigrade, type Tardigrade,
} from "./tardigradeAi";
import type { AimTarget, ClickShot, FightView, NestSink, V3 } from "./types";

/** A front spawn is never closer than this to the ship (Ruling N5: no point-blank pop-ins). */
export const SPAWN_MIN_SHIP = 20;

export type NestPhase = "ready" | "countdown" | "fighting" | "gap" | "rest";

export interface NestState {
  phase: NestPhase;
  /** Seconds in the current phase. */
  phaseT: number;
  /** 0 = no fight, else 1..3. */
  wave: number;
  /** Seconds the ship has been out of the fighting area during a fight. */
  outFor: number;
  /** The ship's distance to the centre last step (Infinity before the first). */
  prevDist: number;
  /** Unpaused combat seconds (hull times use it). */
  clock: number;
  hull: Hull;
  /** Seconds until the gun can fire again. */
  fireIn: number;
  /** `clock` at the last hit feedback. */
  feedbackAt: number;
  /** The next saucer's tint seed. */
  seeds: number;
  /** Debug formation: the AI holds still. */
  frozen: boolean;
  /** `MAX_SAUCERS` reused objects. */
  saucers: Saucer[];
  /** `MAX_TARDIGRADES` reused objects. */
  tardigrades: Tardigrade[];
  /** `BOLT_POOL` reused bolts, the ship's and the monsters'. */
  bolts: BoltPool;
  /** Every monster, saucers then tardigrades, for the lock-on and click assist (built once; Ruling C2). */
  targets: AimTarget[];
  /** The locked monster: an index into `targets`, -1 for none. */
  lock: number;
  /** `STRIKE_RING` reused points: where the latest ship bolts hit. */
  strikes: V3[];
  /** Hits so far; the latest is `strikes[(strikeSeq - 1) % STRIKE_RING]`. */
  strikeSeq: number;
  /** Sleepers have been placed and not yet dropped or dismissed: the drop loop's guard (Ruling N5). */
  sleepersPlaced: boolean;
}

export interface NestInput {
  ship: V3; shipVel: V3;
  /** The ship's nose direction (any length). */
  nose: V3;
  centre: V3;
  racing: boolean; paused: boolean; lowPerf: boolean;
  /** The monsters' shader programs are compiled: wave 1 waits for it. */
  warm: boolean;
  fireHeld: boolean;
  /** A click this step: its aim point (`clickAimPoint`) and camera ray, else null. */
  click: ClickShot | null;
  /** Where wave 1's saucers sleep: offsets from `centre` (data/nest.ts NEST_SLEEPERS), built once. */
  sleepers: readonly V3[];
}

export interface NestEvents {
  /** An inward crossing of the 70 u zone (once per crossing, whatever the phase). */
  entered: boolean;
  /** The wave that started, else 0. */
  waveStarted: number;
  cleared: boolean; breached: boolean;
  /** 20 s out ended the fight. */
  ended: boolean;
  /** Hit feedback is due (at most once per `HIT_FEEDBACK_MIN_S`). */
  feedback: boolean;
  shots: number; defeats: number;
  /** The ship is in the fighting area (reported even while paused). */
  inArea: boolean;
}

export function createNest(): NestState {
  const saucers: Saucer[] = [];
  for (let i = 0; i < MAX_SAUCERS; i++) saucers.push(createSaucer());
  const tardigrades: Tardigrade[] = [];
  for (let i = 0; i < MAX_TARDIGRADES; i++) tardigrades.push(createTardigrade());
  const targets: AimTarget[] = [...saucers, ...tardigrades];
  const strikes: V3[] = [];
  for (let i = 0; i < STRIKE_RING; i++) strikes.push({ x: 0, y: 0, z: 0 });
  return {
    phase: "ready", phaseT: 0, wave: 0, outFor: 0, prevDist: Infinity, clock: 0,
    hull: createHull(), fireIn: 0, feedbackAt: -Infinity, seeds: 0, frozen: false,
    saucers, tardigrades, bolts: createBoltPool(BOLT_POOL), targets,
    lock: -1, strikes, strikeSeq: 0, sleepersPlaced: false,
  };
}

export function createNestEvents(): NestEvents {
  const e = {} as NestEvents;
  resetNestEvents(e);
  return e;
}

export function resetNestEvents(e: NestEvents): void {
  e.entered = false; e.waveStarted = 0; e.cleared = false; e.breached = false; e.ended = false;
  e.feedback = false; e.shots = 0; e.defeats = 0; e.inArea = false;
}

/** Live monsters (defeated, leaving and gone ones don't count). */
export function contactCount(n: NestState): number {
  let c = 0;
  for (let i = 0; i < n.saucers.length; i++) if (n.saucers[i].alive) c++;
  for (let i = 0; i < n.tardigrades.length; i++) if (n.tardigrades[i].alive) c++;
  return c;
}

// ── Scratch ────────────────────────────────────────────────────────────────
const ZERO: V3 = { x: 0, y: 0, z: 0 };
const _view: FightView = { ship: ZERO, shipVel: ZERO, centre: ZERO, shipIn: false };
const _origin: V3 = { x: 0, y: 0, z: 0 };
const _dir: V3 = { x: 0, y: 0, z: 0 };
const _tPos: V3 = { x: 0, y: 0, z: 0 };
const _tVel: V3 = { x: 0, y: 0, z: 0 };
const _cone: V3 = { x: 0, y: 0, z: 0 };
const _rayO: V3 = { x: 0, y: 0, z: 0 };
const _rayD: V3 = { x: 0, y: 0, z: 0 };

// ── Waves ──────────────────────────────────────────────────────────────────

/**
 * A spawn point in front of the ship: a direction uniform over the
 * `SPAWN_CONE_RAD` cone round the nose, `SPAWN_DIST` out; pulled in radially
 * to `SPAWN_MAX_R` from the centre when it lands beyond, so it is always
 * inside the fighting area. A pulled-in point closer than `SPAWN_MIN_SHIP` to
 * the ship (a ship near the edge, nose outward) slides along that sphere,
 * away from the ship, until it is that far (Ruling N5).
 */
export function frontSpawn(inp: NestInput, rnd: () => number, out: V3): V3 {
  const ship = inp.ship, c = inp.centre;
  spreadDir(inp.nose, SPAWN_CONE_RAD, rnd, _cone);
  const d = roll(SPAWN_DIST, rnd);
  out.x = ship.x + _cone.x * d; out.y = ship.y + _cone.y * d; out.z = ship.z + _cone.z * d;
  const rx = out.x - c.x, ry = out.y - c.y, rz = out.z - c.z;
  const r = Math.hypot(rx, ry, rz);
  if (r > SPAWN_MAX_R) {
    const k = SPAWN_MAX_R / r;
    out.x = c.x + rx * k; out.y = c.y + ry * k; out.z = c.z + rz * k;
    keepFromShip(c, ship, out);
  }
  return out;
}

/**
 * `p` on the `SPAWN_MAX_R` sphere round `c`: if it is within `SPAWN_MIN_SHIP`
 * of the ship, it turns about `c`, in the plane of the ship's and its own
 * direction, away from the ship's, to the nearest angle where it is that far
 * (|p − ship|² = R² + s² − 2Rs·cos θ). Straight along the ship's direction,
 * it turns toward any side.
 */
function keepFromShip(c: V3, ship: V3, p: V3): void {
  const R = SPAWN_MAX_R, min = SPAWN_MIN_SHIP;
  if (Math.hypot(p.x - ship.x, p.y - ship.y, p.z - ship.z) >= min) return;
  const sx = ship.x - c.x, sy = ship.y - c.y, sz = ship.z - c.z;
  const s = Math.hypot(sx, sy, sz);
  // Within min of p on the sphere means s > R − min > 0.
  const ux = sx / s, uy = sy / s, uz = sz / s;
  // p's part across the ship's direction.
  const px = p.x - c.x, py = p.y - c.y, pz = p.z - c.z;
  const along = px * ux + py * uy + pz * uz;
  let ex = px - ux * along, ey = py - uy * along, ez = pz - uz * along;
  let el = Math.hypot(ex, ey, ez);
  if (el < 1e-9) {
    // Any side: u × (world X, or world Y when u is near X).
    const useX = Math.abs(ux) < 0.9;
    ex = useX ? 0 : -uz; ey = useX ? uz : 0; ez = useX ? -uy : ux;
    el = Math.hypot(ex, ey, ez);
  }
  ex /= el; ey /= el; ez /= el;
  const cosT = Math.min(1, Math.max(-1, (R * R + s * s - min * min) / (2 * R * s)));
  const sinT = Math.sqrt(1 - cosT * cosT);
  p.x = c.x + R * (ux * cosT + ex * sinT);
  p.y = c.y + R * (uy * cosT + ey * sinT);
  p.z = c.z + R * (uz * cosT + ez * sinT);
}

const sleeping = (s: Saucer) => s.phase === "asleep" || s.phase === "waking";

/**
 * Spawns wave k (sizes from `inp.lowPerf` now) and starts the fight on it.
 * Each wanted monster takes a sleeping (or waking) slot of its kind first,
 * spawned in place (a saucer keeps its tint; the tardigrade wakes and
 * uncurls); the rest take the other non-alive slots (dying and leaving ones
 * included; Ruling C1) at `frontSpawn`. Sleeping saucers left over (wave 1
 * after a low-perf flip) leave; the tardigrade sleeps on until a wave wants it.
 */
function startWave(n: NestState, k: number, inp: NestInput, rnd: () => number, ev: NestEvents): void {
  const spec = (inp.lowPerf ? WAVES_LOW_PERF : WAVES)[k - 1];
  let want = spec.saucers;
  for (let i = 0; i < n.saucers.length && want > 0; i++) {
    const s = n.saucers[i];
    if (!sleeping(s)) continue;
    spawnSaucer(s, s.seed, s.x, s.y, s.z, rnd, inp.ship);
    want--;
  }
  for (let i = 0; i < n.saucers.length && want > 0; i++) {
    const s = n.saucers[i];
    if (s.alive || sleeping(s)) continue;
    frontSpawn(inp, rnd, _tPos);
    spawnSaucer(s, n.seeds++, _tPos.x, _tPos.y, _tPos.z, rnd, inp.ship);
    want--;
  }
  for (let i = 0; i < n.saucers.length; i++) if (sleeping(n.saucers[i])) leaveSaucer(n.saucers[i]);
  want = spec.tardigrades;
  for (let i = 0; i < n.tardigrades.length && want > 0; i++) {
    const t = n.tardigrades[i];
    if (t.phase !== "asleep") continue;
    wakeTardigrade(t, rnd, inp.ship);
    want--;
  }
  for (let i = 0; i < n.tardigrades.length && want > 0; i++) {
    const t = n.tardigrades[i];
    if (t.alive || t.phase === "asleep") continue;
    frontSpawn(inp, rnd, _tPos);
    spawnTardigrade(t, _tPos.x, _tPos.y, _tPos.z, rnd, inp.ship);
    want--;
  }
  n.wave = k;
  n.phase = "fighting"; n.phaseT = 0;
  ev.waveStarted = k;
}

// ── At home ────────────────────────────────────────────────────────────────

/** Sends every sleeping and waking monster away (they shrink over `LEAVE_S`); fresh ones grow back once all are gone. */
export function dismissSleepers(n: NestState): void {
  n.sleepersPlaced = false;
  for (let i = 0; i < n.saucers.length; i++) if (sleeping(n.saucers[i])) leaveSaucer(n.saucers[i]);
  for (let i = 0; i < n.tardigrades.length; i++) if (n.tardigrades[i].phase === "asleep") leaveTardigrade(n.tardigrades[i]);
}

function allGone(n: NestState): boolean {
  for (let i = 0; i < n.saucers.length; i++) if (n.saucers[i].phase !== "gone") return false;
  for (let i = 0; i < n.tardigrades.length; i++) if (n.tardigrades[i].phase !== "gone") return false;
  return true;
}

/**
 * While ready: beyond `SLEEP_DROP_R` the sleepers are dropped at once; within
 * `NEST_LOAD_R`, warm, with every slot gone, they are placed: wave 1's
 * saucers for this tier (at most one per offset) at `centre + offset`,
 * facing out along it, and the tardigrade at the centre, facing the offsets'
 * mean (+Y when that is zero).
 */
function tendSleepers(n: NestState, inp: NestInput, dist: number): void {
  if (dist > SLEEP_DROP_R) {
    // Nothing placed: no work outside the Nest (the idle budget).
    if (!n.sleepersPlaced) return;
    n.sleepersPlaced = false;
    for (let i = 0; i < n.saucers.length; i++) {
      const s = n.saucers[i];
      if (s.phase === "asleep") { s.phase = "gone"; s.scale = 0; }
    }
    for (let i = 0; i < n.tardigrades.length; i++) {
      const t = n.tardigrades[i];
      if (t.phase === "asleep") { t.phase = "gone"; t.scale = 0; }
    }
    return;
  }
  if (dist > NEST_LOAD_R || !inp.warm || !allGone(n)) return;
  const c = inp.centre, off = inp.sleepers;
  const count = Math.min(off.length, n.saucers.length, (inp.lowPerf ? WAVES_LOW_PERF : WAVES)[0].saucers);
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < count; i++) {
    const o = off[i];
    sleepSaucer(n.saucers[i], n.seeds++, c.x + o.x, c.y + o.y, c.z + o.z, o.x, o.y, o.z);
  }
  for (let i = 0; i < off.length; i++) { mx += off[i].x; my += off[i].y; mz += off[i].z; }
  if (Math.hypot(mx, my, mz) < 1e-9) { mx = 0; my = 1; mz = 0; }
  for (let i = 0; i < n.tardigrades.length; i++) sleepTardigrade(n.tardigrades[i], c.x, c.y, c.z, mx, my, mz);
  n.sleepersPlaced = true;
}

/** The fight is over: live, sleeping and waking monsters leave, enemy bolts vanish, wave 0, ready. */
export function endFight(n: NestState): void {
  dismissSleepers(n);
  for (let i = 0; i < n.saucers.length; i++) leaveSaucer(n.saucers[i]);
  for (let i = 0; i < n.tardigrades.length; i++) leaveTardigrade(n.tardigrades[i]);
  clearBolts(n.bolts, "enemy");
  n.wave = 0;
  n.phase = "ready"; n.phaseT = 0;
  n.outFor = 0;
  n.lock = -1;
  // Leaving monsters must be stepped to fade.
  n.frozen = false;
}

// ── Damage ─────────────────────────────────────────────────────────────────

/** One hit on the hull. True on the breach, which also ends the fight and restores the hull. */
function hurt(n: NestState, amount: number, ev: NestEvents): boolean {
  const breach = damageHull(n.hull, amount, n.clock);
  if (n.clock - n.feedbackAt >= HIT_FEEDBACK_MIN_S - T_EPS) {
    ev.feedback = true;
    n.feedbackAt = n.clock;
  }
  if (!breach) return false;
  ev.breached = true;
  endFight(n);
  restoreAfterBreach(n.hull, n.clock);
  return true;
}

/**
 * Whether the bolt's last segment hits a moving sphere, tested in the
 * target's frame (it moved by `v · mdt` this step), so neither the bolt nor
 * the target can step through the other.
 */
function boltHits(
  px: number, py: number, pz: number, x: number, y: number, z: number,
  cx: number, cy: number, cz: number, vx: number, vy: number, vz: number, mdt: number, r: number,
): boolean {
  return segmentHitsSphere(
    px - (cx - vx * mdt), py - (cy - vy * mdt), pz - (cz - vz * mdt),
    x - cx, y - cy, z - cz, 0, 0, 0, r,
  );
}

/**
 * A ship bolt's segment against the live monsters: the index in `n.targets`
 * of the nearest one hit (by distance from the segment's start), else -1.
 */
function shipBoltTarget(
  n: NestState, px: number, py: number, pz: number, x: number, y: number, z: number, mdt: number,
): number {
  let best = -1;
  let bestD = Infinity;
  const rs = SAUCER_HIT_R + BOLT_R, rt = TARDIGRADE_HIT_R + BOLT_R;
  for (let i = 0; i < n.targets.length; i++) {
    const m = n.targets[i] as MonsterBody;
    if (!m.alive) continue;
    const r = i < n.saucers.length ? rs : rt;
    if (!boltHits(px, py, pz, x, y, z, m.x, m.y, m.z, m.vx, m.vy, m.vz, mdt, r)) continue;
    const d = Math.hypot(m.x - px, m.y - py, m.z - pz);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ── The step ───────────────────────────────────────────────────────────────

/**
 * One combat step. Paused: only `ev.inArea` is reported; nothing changes.
 * Order: the zone crossing, the phase timers, the out timer, the monsters and
 * bolts (and their hits), the player's fire, the hull regen.
 */
export function stepNest(
  n: NestState, inp: NestInput, dt: number, rnd: () => number, sink: NestSink, ev: NestEvents,
): void {
  const ship = inp.ship, c = inp.centre;
  // 1. Where the ship is.
  const dist = Math.hypot(ship.x - c.x, ship.y - c.y, ship.z - c.z);
  const inArea = inNestArea(dist, inp.racing);
  ev.inArea = inArea;
  if (inp.paused) return;

  n.clock += dt;
  n.phaseT += dt;

  // 2. An inward crossing of the zone (once per crossing, however fast).
  if (!inp.racing && n.prevDist >= NEST_ZONE_R && dist < NEST_ZONE_R) {
    ev.entered = true;
    if (n.phase === "ready") {
      n.phase = "countdown"; n.phaseT = 0;
      for (let i = 0; i < n.saucers.length; i++) wakeSaucer(n.saucers[i]);
    }
  }

  // 3. The phase timers. Wave 1 also waits for the ship in the fighting area:
  // monsters never come alive while it is outside (Review Focus 2).
  if (n.phase === "countdown") {
    if (n.phaseT >= CONTACT_DELAY_S - T_EPS && inp.warm && inArea) startWave(n, 1, inp, rnd, ev);
  } else if (n.phase === "gap") {
    if (n.phaseT >= WAVE_GAP_S - T_EPS) startWave(n, n.wave + 1, inp, rnd, ev);
  } else if (n.phase === "fighting") {
    if (contactCount(n) === 0) {
      if (n.wave >= 3) {
        ev.cleared = true;
        n.phase = "rest"; n.wave = 0;
        dismissSleepers(n);
      } else {
        n.phase = "gap";
      }
      n.phaseT = 0;
    }
  } else if (n.phase === "rest") {
    if (n.phaseT >= NEST_REST_S - T_EPS) { n.phase = "ready"; n.phaseT = 0; }
  }
  if (n.phase === "ready") tendSleepers(n, inp, dist);

  // 4. The out timer.
  if (n.phase === "countdown" || n.phase === "fighting" || n.phase === "gap") {
    n.outFor = inArea ? 0 : n.outFor + dt;
    if (n.outFor >= OUT_LIMIT_S - T_EPS) {
      endFight(n);
      ev.ended = true;
    }
  }

  // 5. Monsters, then bolts and their hits.
  _view.ship = ship; _view.shipVel = inp.shipVel; _view.centre = c; _view.shipIn = inArea;
  if (!n.frozen) {
    for (let i = 0; i < n.saucers.length; i++) stepSaucer(n.saucers[i], _view, dt, rnd, sink, n.bolts);
    for (let i = 0; i < n.tardigrades.length; i++) stepTardigrade(n.tardigrades[i], _view, dt, rnd, sink);
  }
  const mdt = n.frozen ? 0 : dt;
  const sv = inp.shipVel;
  const shipR = SHIP_HIT_R + BOLT_R;
  // 6. The ship takes damage only inside the fighting area and never while
  // racing (C15): outside, an enemy bolt or the jet passes through it
  // harmlessly. Damage also stops at a breach (the fight is over).
  let harmless = !inArea;
  const bolts = n.bolts.bolts;
  for (let i = 0; i < bolts.length; i++) {
    const b = bolts[i];
    if (!b.live) continue;
    const spent = advanceBolt(b, dt);
    if (b.owner === "ship") {
      const k = shipBoltTarget(n, b.px, b.py, b.pz, b.x, b.y, b.z, mdt);
      if (k >= 0) {
        b.live = false;
        recordStrike(n, b.x, b.y, b.z);
        const ns = n.saucers.length;
        if (k < ns ? hitSaucer(n.saucers[k]) : hitTardigrade(n.tardigrades[k - ns])) ev.defeats++;
        continue;
      }
    } else if (!harmless && boltHits(b.px, b.py, b.pz, b.x, b.y, b.z, ship.x, ship.y, ship.z, sv.x, sv.y, sv.z, dt, shipR)) {
      b.live = false;
      if (hurt(n, b.damage, ev)) harmless = true;
      continue;
    }
    if (spent) b.live = false;
  }
  if (!harmless) {
    for (let i = 0; i < n.tardigrades.length; i++) {
      const t = n.tardigrades[i];
      if (!t.alive || t.phase !== "jet") continue;
      if (!jetHit(t.jx, t.jy, t.jz, t.jdx, t.jdy, t.jdz, ship.x, ship.y, ship.z)) continue;
      if (hurt(n, JET_DPS * dt, ev)) break;
    }
  }

  // 7. The lock (only in the area, in a fight; nothing else outside), then the player's fire.
  if (!inArea || !(n.phase === "countdown" || n.phase === "fighting" || n.phase === "gap")) {
    n.lock = -1;
  } else {
    noseOrigin(inp, _origin);
    if (n.lock >= 0 && !lockHolds(_origin, inp.nose, n.targets[n.lock])) n.lock = -1;
    if (n.lock < 0 && inp.fireHeld) n.lock = acquireLock(_origin, inp.nose, n.targets);
  }
  n.fireIn = Math.max(0, n.fireIn - dt);
  if (inArea && n.fireIn <= 1e-9 && (inp.click !== null || inp.fireHeld)) fire(n, inp, ev);

  // 8. Hull regen; remember the distance.
  regenHull(n.hull, dt, n.clock);
  n.prevDist = dist;
}

/** The bolts' origin: the ship's nose, `NOSE_OFFSET` ahead of its centre. */
function noseOrigin(inp: NestInput, out: V3): V3 {
  const ship = inp.ship, nose = inp.nose;
  const nl = Math.hypot(nose.x, nose.y, nose.z) || 1;
  out.x = ship.x + (nose.x / nl) * NOSE_OFFSET;
  out.y = ship.y + (nose.y / nl) * NOSE_OFFSET;
  out.z = ship.z + (nose.z / nl) * NOSE_OFFSET;
  return out;
}

/** A ship bolt hit at (x, y, z): into the strike ring's next slot (no allocation). */
function recordStrike(n: NestState, x: number, y: number, z: number): void {
  const p = n.strikes[n.strikeSeq % n.strikes.length];
  p.x = x; p.y = y; p.z = z;
  n.strikeSeq++;
}

/** `_dir` toward target k, leading it (`leadAim`) from `_origin`. */
function leadTarget(n: NestState, k: number): void {
  const t = n.targets[k];
  _tPos.x = t.x; _tPos.y = t.y; _tPos.z = t.z;
  _tVel.x = t.vx; _tVel.y = t.vy; _tVel.z = t.vz;
  leadAim(_origin, _tPos, _tVel, BOLT_SPEED, _dir);
}

/**
 * One bolt from the nose. A click leads the monster its camera ray passes
 * within 6° of, else goes at the click point; held fire leads the locked
 * monster, else goes down the nose.
 */
function fire(n: NestState, inp: NestInput, ev: NestEvents): void {
  noseOrigin(inp, _origin);
  const click = inp.click;
  if (click !== null) {
    _rayO.x = click.ox; _rayO.y = click.oy; _rayO.z = click.oz;
    _rayD.x = click.dx; _rayD.y = click.dy; _rayD.z = click.dz;
    const k = clickAssist(_rayO, _rayD, n.targets);
    if (k >= 0) leadTarget(n, k);
    else { _dir.x = click.x - _origin.x; _dir.y = click.y - _origin.y; _dir.z = click.z - _origin.z; }
  } else if (n.lock >= 0) {
    leadTarget(n, n.lock);
  } else {
    _dir.x = inp.nose.x; _dir.y = inp.nose.y; _dir.z = inp.nose.z;
  }
  if (!fireBolt(n.bolts, "ship", _origin.x, _origin.y, _origin.z, _dir.x, _dir.y, _dir.z, BOLT_SPEED, BOLT_RANGE, 1)) return;
  n.fireIn = FIRE_INTERVAL_S;
  ev.shots++;
}

// ── Debug (the bridge's `nest` handle; dev and probes only) ────────────────

/** Starts wave k now: live and sleeping monsters leave first, then the wave spawns into the free slots, in front. */
export function debugStartWave(n: NestState, k: 1 | 2 | 3, inp: NestInput, rnd: () => number, ev: NestEvents): void {
  dismissSleepers(n);
  for (let i = 0; i < n.saucers.length; i++) leaveSaucer(n.saucers[i]);
  for (let i = 0; i < n.tardigrades.length; i++) leaveTardigrade(n.tardigrades[i]);
  n.outFor = 0;
  startWave(n, k, inp, rnd, ev);
}

/** Defeats every live monster now. */
export function debugClearWave(n: NestState, ev: NestEvents): void {
  for (let i = 0; i < n.saucers.length; i++) {
    const s = n.saucers[i];
    while (s.alive) if (hitSaucer(s)) ev.defeats++;
  }
  for (let i = 0; i < n.tardigrades.length; i++) {
    const t = n.tardigrades[i];
    while (t.alive) if (hitTardigrade(t)) ev.defeats++;
  }
}

/** Wave 3, fighting, every live monster defeated and the sleepers sent away: the next step clears the Nest. */
export function debugClearAll(n: NestState, ev: NestEvents): void {
  debugClearWave(n, ev);
  dismissSleepers(n);
  n.wave = 3;
  n.phase = "fighting"; n.phaseT = 0;
}

/**
 * A fixed frame for the perf probe: live saucers in a row 25 u ahead of the
 * ship, 6 u apart (across the nose, level); the tardigrade 45 u ahead; all
 * still, facing the ship, not attacking; the AI frozen.
 */
export function debugFormation(n: NestState, ship: V3, nose: V3): void {
  const nl = Math.hypot(nose.x, nose.y, nose.z) || 1;
  const fx = nose.x / nl, fy = nose.y / nl, fz = nose.z / nl;
  // Side axis: world up × nose (world X when the nose is vertical).
  let sx = fz, sz = -fx;
  const sl = Math.hypot(sx, sz);
  if (sl < 1e-9) { sx = 1; sz = 0; } else { sx /= sl; sz /= sl; }
  let live = 0;
  for (let i = 0; i < n.saucers.length; i++) if (n.saucers[i].alive) live++;
  let j = 0;
  for (let i = 0; i < n.saucers.length; i++) {
    const s = n.saucers[i];
    if (!s.alive) continue;
    const off = (j++ - (live - 1) / 2) * 6;
    s.x = ship.x + fx * 25 + sx * off; s.y = ship.y + fy * 25; s.z = ship.z + fz * 25 + sz * off;
    hold(s, ship);
    s.ax = s.fx; s.ay = s.fy; s.az = s.fz;
    s.phase = "idle"; s.phaseT = 0; s.shotsLeft = 0;
    s.pose.chase = -1; s.pose.fire = 0;
  }
  for (let i = 0; i < n.tardigrades.length; i++) {
    const t = n.tardigrades[i];
    if (!t.alive) continue;
    t.x = ship.x + fx * 45; t.y = ship.y + fy * 45; t.z = ship.z + fz * 45;
    hold(t, ship);
    t.phase = "swim"; t.phaseT = 0;
    t.pose.charge = 0; t.pose.recoil = 0; t.pose.swim = 0;
  }
  n.frozen = true;
}

function hold(m: MonsterBody, ship: V3): void {
  m.vx = 0; m.vy = 0; m.vz = 0;
  faceToward(m, ship.x - m.x, ship.y - m.y, ship.z - m.z);
}
