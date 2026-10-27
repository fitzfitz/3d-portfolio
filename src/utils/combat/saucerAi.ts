/**
 * The saucer's AI: it circles the ship, warns with a porthole chase, then
 * fires a 3-bolt burst led at the ship. Allocation-free: one module scratch
 * set, monsters are reused objects (`createSaucer` once, `spawnSaucer` per wave).
 */
import {
  ENEMY_BOLT_DAMAGE, ENEMY_BOLT_RANGE, ENEMY_BOLT_SPEED, DEFEAT_DRIFT, SAUCER_ATTACK_EVERY, SAUCER_BURST,
  SAUCER_BURST_GAP_S, SAUCER_DEFEAT_S, SAUCER_HIT_POSE_S, SAUCER_HITS, SAUCER_ORBIT, SAUCER_SPEED,
  SAUCER_SPREAD_RAD, SAUCER_TURN_RATE, SAUCER_WARN_S,
} from "./constants";
import { fireBolt, type BoltPool } from "./bolts";
import { leadAim, spreadDir } from "./aim";
import {
  T_EPS, driftHome, faceToward, flinch, moveLeashed, roll, slewFacing, startFade, steer, stepFade, takeHit,
  type MonsterBody,
} from "./monsterMotion";
import type { FightView, NestSink, V3 } from "./types";

export type SaucerPhase = "idle" | "warn" | "burst" | "defeated" | "leaving" | "gone";

export interface Saucer extends MonsterBody {
  /** Tint seed (`saucerTint(seed)`). */
  seed: number;
  phase: SaucerPhase; phaseT: number; hp: number;
  /** Orbit radius round the ship, height offset, angle round world Y and its direction. */
  orbitR: number; orbitAngle: number; orbitDir: 1 | -1; orbitY: number;
  /** Seconds to the next warn (counts only while the ship is in). */
  attackIn: number;
  shotsLeft: number; shotIn: number;
  /** Flinch time left. */
  hitT: number;
  /** Facing (unit, world). */
  fx: number; fy: number; fz: number;
  /** Cannon aim (unit, world). */
  ax: number; ay: number; az: number;
  /** The state poses for `SaucerPose`: chase -1 (off) or 0 → 1 (wraps); the rest 0 → 1. */
  pose: { chase: number; fire: number; hit: number; defeat: number };
  scale: number;
}

// Steering (the implementer's choice; the spec pins only the speeds and ranges).
/** The orbit point runs round the ship at this speed (u/s). */
const ORBIT_TANGENT = 9;
/** Pull toward the orbit point (1/s). */
const ORBIT_GAIN = 1.2;
/** Steering acceleration (u/s²). */
const SAUCER_ACCEL = 24;
/** With the ship out, saucers drift home at this speed. */
const HOME_SPEED = SAUCER_SPEED * 0.6;
/** Porthole chase laps per second during the warn. */
const CHASE_RATE = 2;
/** The fire lean eases out over this. */
const FIRE_EASE_S = 0.35;

const _muzzle: V3 = { x: 0, y: 0, z: 0 };
const _lead: V3 = { x: 0, y: 0, z: 0 };
const _dir: V3 = { x: 0, y: 0, z: 0 };

export function createSaucer(): Saucer {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, alive: false,
    seed: 0, phase: "gone", phaseT: 0, hp: 0,
    orbitR: SAUCER_ORBIT[0], orbitAngle: 0, orbitDir: 1, orbitY: 0,
    attackIn: 0, shotsLeft: 0, shotIn: 0, hitT: 0,
    fx: 0, fy: 0, fz: 1, ax: 0, ay: 0, az: 1,
    pose: { chase: -1, fire: 0, hit: 0, defeat: 0 },
    scale: 0,
  };
}

/** (Re)starts a saucer at (x, y, z), facing and aiming at the ship from the first frame. */
export function spawnSaucer(s: Saucer, seed: number, x: number, y: number, z: number, rnd: () => number, ship: V3): void {
  s.seed = seed;
  s.x = x; s.y = y; s.z = z; s.vx = 0; s.vy = 0; s.vz = 0;
  s.alive = true; s.phase = "idle"; s.phaseT = 0; s.hp = SAUCER_HITS;
  s.orbitR = roll(SAUCER_ORBIT, rnd);
  s.orbitY = -6 + 12 * rnd();
  s.orbitDir = rnd() < 0.5 ? -1 : 1;
  s.orbitAngle = Math.atan2(z - ship.z, x - ship.x);
  s.attackIn = roll(SAUCER_ATTACK_EVERY, rnd);
  s.shotsLeft = 0; s.shotIn = 0; s.hitT = 0;
  s.fx = 0; s.fy = 0; s.fz = 1;
  faceToward(s, ship.x - x, ship.y - y, ship.z - z);
  s.ax = s.fx; s.ay = s.fy; s.az = s.fz;
  s.pose.chase = -1; s.pose.fire = 0; s.pose.hit = 0; s.pose.defeat = 0;
  s.scale = 1;
}

/** Points the cannon (`a*`) at the lead point from the current muzzle; leaves `_muzzle`, `_lead` set. */
function aimCannon(s: Saucer, v: FightView, sink: NestSink): void {
  sink.muzzle(s, _muzzle);
  leadAim(_muzzle, v.ship, v.shipVel, ENEMY_BOLT_SPEED, _lead);
  s.ax = _lead.x; s.ay = _lead.y; s.az = _lead.z;
}

function fireShot(s: Saucer, v: FightView, rnd: () => number, sink: NestSink, bolts: BoltPool): void {
  aimCannon(s, v, sink);
  spreadDir(_lead, SAUCER_SPREAD_RAD, rnd, _dir);
  fireBolt(bolts, "enemy", _muzzle.x, _muzzle.y, _muzzle.z, _dir.x, _dir.y, _dir.z,
    ENEMY_BOLT_SPEED, ENEMY_BOLT_RANGE, ENEMY_BOLT_DAMAGE);
  s.pose.fire = 1;
  s.shotsLeft--;
}

export function stepSaucer(s: Saucer, v: FightView, dt: number, rnd: () => number, sink: NestSink, bolts: BoltPool): void {
  if (s.phase === "gone") return;
  s.phaseT += dt;
  s.pose.hit = flinch(s, dt, SAUCER_HIT_POSE_S);
  s.pose.fire = Math.max(0, s.pose.fire - dt / FIRE_EASE_S);

  if (s.phase === "defeated" || s.phase === "leaving") {
    s.pose.chase = -1;
    const defeated = s.phase === "defeated";
    if (stepFade(s, v.ship, v.centre, dt, defeated ? SAUCER_DEFEAT_S : 0, defeated ? DEFEAT_DRIFT : 0)) s.phase = "gone";
    return;
  }

  const ship = v.ship;
  if (v.shipIn) {
    // Circle the ship round world Y: a point running round the orbit, plus a pull onto it.
    s.orbitAngle += (s.orbitDir * ORBIT_TANGENT / s.orbitR) * dt;
    const c = Math.cos(s.orbitAngle), sn = Math.sin(s.orbitAngle);
    const tx = ship.x + s.orbitR * c, ty = ship.y + s.orbitY, tz = ship.z + s.orbitR * sn;
    const tang = s.orbitDir * ORBIT_TANGENT;
    steer(s,
      v.shipVel.x - sn * tang + (tx - s.x) * ORBIT_GAIN,
      v.shipVel.y + (ty - s.y) * ORBIT_GAIN,
      v.shipVel.z + c * tang + (tz - s.z) * ORBIT_GAIN,
      SAUCER_SPEED, SAUCER_ACCEL, dt);
  } else {
    driftHome(s, v.centre, HOME_SPEED, SAUCER_ACCEL, dt);
  }
  moveLeashed(s, dt, v.centre);
  slewFacing(s, ship.x - s.x, ship.y - s.y, ship.z - s.z, SAUCER_TURN_RATE * dt);
  // The cannon aims where its bolt would meet the ship (from the muzzle as it stands).
  aimCannon(s, v, sink);

  if (!v.shipIn) {
    // No new warn; a running warn or burst stops (and the clock restarts).
    if (s.phase !== "idle") {
      s.phase = "idle"; s.phaseT = 0; s.shotsLeft = 0;
      s.attackIn = roll(SAUCER_ATTACK_EVERY, rnd);
    }
    s.pose.chase = -1;
    return;
  }

  if (s.phase === "idle") {
    s.attackIn -= dt;
    if (s.attackIn <= T_EPS) { s.phase = "warn"; s.phaseT = 0; }
  } else if (s.phase === "warn" && s.phaseT >= SAUCER_WARN_S - T_EPS) {
    s.phase = "burst"; s.phaseT = 0;
    s.shotsLeft = SAUCER_BURST; s.shotIn = 0;
  } else if (s.phase === "burst") {
    s.shotIn -= dt;
  }
  if (s.phase === "burst" && s.shotIn <= T_EPS) {
    fireShot(s, v, rnd, sink, bolts);
    s.shotIn += SAUCER_BURST_GAP_S;
    if (s.shotsLeft <= 0) {
      s.phase = "idle"; s.phaseT = 0;
      s.attackIn = roll(SAUCER_ATTACK_EVERY, rnd);
    }
  }
  s.pose.chase = s.phase === "warn" ? (s.phaseT * CHASE_RATE) % 1 : -1;
}

/** A bolt hit: flinch; true on the defeating hit. A dying or gone saucer takes none. */
export function hitSaucer(s: Saucer): boolean {
  if (!takeHit(s, s.pose, SAUCER_HIT_POSE_S)) return false;
  s.phase = "defeated";
  s.pose.defeat = 1; s.pose.chase = -1;
  s.shotsLeft = 0;
  return true;
}

/** The fight ended: a live saucer shrinks away over `LEAVE_S`. A defeated one finishes its own fade. */
export function leaveSaucer(s: Saucer): void {
  if (!s.alive) return;
  s.phase = "leaving";
  startFade(s);
  s.pose.chase = -1;
  s.shotsLeft = 0;
}
