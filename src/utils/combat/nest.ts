/**
 * The Nest machine: the fight's state (phase, wave, hull, the monster and
 * bolt pools) and `stepNest`, which runs one combat step. Pure and
 * allocation-free: the pools are built once in `createNest` and reused, and
 * every vector is module scratch.
 *
 * Phases: ready → (inward crossing of the 70 u zone) countdown → (3 s, warm)
 * fighting ⇄ gap (5 s after the last defeat) → (wave 3 cleared) rest → (2 min)
 * ready. A breach or 20 s out of the fighting area ends the fight (ready).
 *
 * Events are written into a caller's `NestEvents` and never cleared here: the
 * caller reads them after `stepNest` and then calls `resetNestEvents` (so the
 * debug calls between frames can report too).
 */
import {
  BOLT_POOL, BOLT_R, BOLT_RANGE, BOLT_SPEED, CONTACT_DELAY_S, FIRE_INTERVAL_S, HIT_FEEDBACK_MIN_S, JET_DPS,
  MAX_SAUCERS, MAX_TARDIGRADES, NEST_REST_S, NEST_ZONE_R, NOSE_OFFSET, OUT_LIMIT_S, SAUCER_HIT_R, SHIP_HIT_R,
  SPAWN_R, TARDIGRADE_HIT_R, WAVE_GAP_S, WAVES, WAVES_LOW_PERF,
} from "./constants";
import { advanceBolt, clearBolts, createBoltPool, fireBolt, segmentHitsSphere, type BoltPool } from "./bolts";
import { createHull, damageHull, regenHull, restoreAfterBreach, type Hull } from "./hull";
import { aimAssist, leadAim } from "./aim";
import { inNestArea } from "./controls";
import { T_EPS, faceToward, type MonsterBody } from "./monsterMotion";
import { createSaucer, hitSaucer, leaveSaucer, spawnSaucer, stepSaucer, type Saucer } from "./saucerAi";
import {
  createTardigrade, hitTardigrade, jetHit, leaveTardigrade, spawnTardigrade, stepTardigrade, type Tardigrade,
} from "./tardigradeAi";
import type { AimTarget, FightView, NestSink, V3 } from "./types";

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
  /** Every monster, saucers then tardigrades, for the aim assist (built once; Ruling C2). */
  targets: AimTarget[];
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
  /** A click's aim point this step (`clickAimPoint`), else null. */
  click: V3 | null;
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
  return {
    phase: "ready", phaseT: 0, wave: 0, outFor: 0, prevDist: Infinity, clock: 0,
    hull: createHull(), fireIn: 0, feedbackAt: -Infinity, seeds: 0, frozen: false,
    saucers, tardigrades, bolts: createBoltPool(BOLT_POOL), targets,
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

// ── Waves ──────────────────────────────────────────────────────────────────

/** A spawn point: `SPAWN_R` from the centre away from the ship (+Y when on it), ±10 u per axis. */
function spawnPoint(inp: NestInput, rnd: () => number, out: V3): V3 {
  const c = inp.centre;
  let ux = c.x - inp.ship.x, uy = c.y - inp.ship.y, uz = c.z - inp.ship.z;
  const l = Math.hypot(ux, uy, uz);
  if (l < 1e-9) { ux = 0; uy = 1; uz = 0; } else { ux /= l; uy /= l; uz /= l; }
  out.x = c.x + ux * SPAWN_R + (rnd() * 2 - 1) * 10;
  out.y = c.y + uy * SPAWN_R + (rnd() * 2 - 1) * 10;
  out.z = c.z + uz * SPAWN_R + (rnd() * 2 - 1) * 10;
  return out;
}

/**
 * Spawns wave k (sizes from `inp.lowPerf` now) into the non-alive slots
 * (dying and leaving ones included; Ruling C1), and starts the fight on it.
 */
function startWave(n: NestState, k: number, inp: NestInput, rnd: () => number, ev: NestEvents): void {
  const spec = (inp.lowPerf ? WAVES_LOW_PERF : WAVES)[k - 1];
  let want = spec.saucers;
  for (let i = 0; i < n.saucers.length && want > 0; i++) {
    const s = n.saucers[i];
    if (s.alive) continue;
    spawnPoint(inp, rnd, _tPos);
    spawnSaucer(s, n.seeds++, _tPos.x, _tPos.y, _tPos.z, rnd, inp.ship);
    want--;
  }
  want = spec.tardigrades;
  for (let i = 0; i < n.tardigrades.length && want > 0; i++) {
    const t = n.tardigrades[i];
    if (t.alive) continue;
    spawnPoint(inp, rnd, _tPos);
    spawnTardigrade(t, _tPos.x, _tPos.y, _tPos.z, rnd, inp.ship);
    want--;
  }
  n.wave = k;
  n.phase = "fighting"; n.phaseT = 0;
  ev.waveStarted = k;
}

/** The fight is over: live monsters leave, enemy bolts vanish, wave 0, ready. */
export function endFight(n: NestState): void {
  for (let i = 0; i < n.saucers.length; i++) leaveSaucer(n.saucers[i]);
  for (let i = 0; i < n.tardigrades.length; i++) leaveTardigrade(n.tardigrades[i]);
  clearBolts(n.bolts, "enemy");
  n.wave = 0;
  n.phase = "ready"; n.phaseT = 0;
  n.outFor = 0;
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
    if (n.phase === "ready") { n.phase = "countdown"; n.phaseT = 0; }
  }

  // 3. The phase timers.
  if (n.phase === "countdown") {
    if (n.phaseT >= CONTACT_DELAY_S - T_EPS && inp.warm) startWave(n, 1, inp, rnd, ev);
  } else if (n.phase === "gap") {
    if (n.phaseT >= WAVE_GAP_S - T_EPS) startWave(n, n.wave + 1, inp, rnd, ev);
  } else if (n.phase === "fighting") {
    if (contactCount(n) === 0) {
      if (n.wave >= 3) {
        ev.cleared = true;
        n.phase = "rest"; n.wave = 0;
      } else {
        n.phase = "gap";
      }
      n.phaseT = 0;
    }
  } else if (n.phase === "rest") {
    if (n.phaseT >= NEST_REST_S - T_EPS) { n.phase = "ready"; n.phaseT = 0; }
  }

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

  // 7. The player's fire.
  n.fireIn = Math.max(0, n.fireIn - dt);
  if (inArea && n.fireIn <= 1e-9 && (inp.click !== null || inp.fireHeld)) fire(n, inp, ev);

  // 8. Hull regen; remember the distance.
  regenHull(n.hull, dt, n.clock);
  n.prevDist = dist;
}

/** One bolt from the nose: at the click's point, else held fire's assist (leading the locked monster). */
function fire(n: NestState, inp: NestInput, ev: NestEvents): void {
  const ship = inp.ship, nose = inp.nose;
  const nl = Math.hypot(nose.x, nose.y, nose.z) || 1;
  _origin.x = ship.x + (nose.x / nl) * NOSE_OFFSET;
  _origin.y = ship.y + (nose.y / nl) * NOSE_OFFSET;
  _origin.z = ship.z + (nose.z / nl) * NOSE_OFFSET;
  const click = inp.click;
  if (click !== null) {
    _dir.x = click.x - _origin.x; _dir.y = click.y - _origin.y; _dir.z = click.z - _origin.z;
  } else {
    const k = aimAssist(_origin, nose, n.targets, _dir);
    if (k >= 0) {
      const t = n.targets[k];
      _tPos.x = t.x; _tPos.y = t.y; _tPos.z = t.z;
      _tVel.x = t.vx; _tVel.y = t.vy; _tVel.z = t.vz;
      leadAim(_origin, _tPos, _tVel, BOLT_SPEED, _dir);
    }
  }
  if (!fireBolt(n.bolts, "ship", _origin.x, _origin.y, _origin.z, _dir.x, _dir.y, _dir.z, BOLT_SPEED, BOLT_RANGE, 1)) return;
  n.fireIn = FIRE_INTERVAL_S;
  ev.shots++;
}

// ── Debug (the bridge's `nest` handle; dev and probes only) ────────────────

/** Starts wave k now: live monsters leave first, then the wave spawns into the free slots. */
export function debugStartWave(n: NestState, k: 1 | 2 | 3, inp: NestInput, rnd: () => number, ev: NestEvents): void {
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

/** Wave 3, fighting, every live monster defeated: the next step clears the Nest. */
export function debugClearAll(n: NestState, ev: NestEvents): void {
  debugClearWave(n, ev);
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
