/**
 * The tardigrade's AI: it swims to 40 u from the ship, always turning to
 * face it, charges for 1.6 s, then fires a plasma jet for 1.2 s along the
 * line it faced when the charge ended. Allocation-free.
 */
import {
  DEFEAT_DRIFT, JET_RADIUS, JET_RANGE, JET_S, TARDIGRADE_ATTACK_EVERY, TARDIGRADE_CHARGE_S, TARDIGRADE_DEFEAT_S,
  TARDIGRADE_HIT_POSE_S, TARDIGRADE_HITS, TARDIGRADE_SPEED, TARDIGRADE_STANDOFF, TARDIGRADE_TURN_RATE,
} from "./constants";
import {
  T_EPS, driftHome, faceToward, flinch, moveLeashed, roll, slewFacing, startFade, steer, stepFade, takeHit,
  type MonsterBody,
} from "./monsterMotion";
import type { FightView, NestSink, V3 } from "./types";

export type TardigradePhase = "swim" | "charge" | "jet" | "defeated" | "leaving" | "gone";

export interface Tardigrade extends MonsterBody {
  phase: TardigradePhase; phaseT: number; hp: number;
  /** Seconds to the next charge (counts only while swimming with the ship in). */
  attackIn: number;
  hitT: number;
  /** Facing (unit, world). */
  fx: number; fy: number; fz: number;
  /** The jet's origin (the mouth at the charge's end) and unit direction; fixed through the jet. */
  jx: number; jy: number; jz: number; jdx: number; jdy: number; jdz: number;
  /** The state poses for `TardigradePose`, each 0 → 1. */
  pose: { swim: number; charge: number; recoil: number; hit: number; curl: number };
  scale: number;
}

// Steering (the implementer's choice; the spec pins only the speed and the standoff).
/** Pull toward the standoff point (1/s). */
const SWIM_GAIN = 1;
/** Swimming acceleration (u/s²). */
const SWIM_ACCEL = 4;
/** The charge glow and the recoil ease out over this once the jet ends or is cancelled. */
const EASE_S = 0.5;
/** A defeated tardigrade curls into a tun over this. */
const CURL_S = 1;

const _mouth: V3 = { x: 0, y: 0, z: 0 };

export function createTardigrade(): Tardigrade {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, alive: false,
    phase: "gone", phaseT: 0, hp: 0, attackIn: 0, hitT: 0,
    fx: 0, fy: 0, fz: 1, jx: 0, jy: 0, jz: 0, jdx: 0, jdy: 0, jdz: 1,
    pose: { swim: 0, charge: 0, recoil: 0, hit: 0, curl: 0 },
    scale: 0,
  };
}

/** (Re)starts a tardigrade at (x, y, z), facing the ship from the first frame. */
export function spawnTardigrade(t: Tardigrade, x: number, y: number, z: number, rnd: () => number, ship: V3): void {
  t.x = x; t.y = y; t.z = z; t.vx = 0; t.vy = 0; t.vz = 0;
  t.alive = true; t.phase = "swim"; t.phaseT = 0; t.hp = TARDIGRADE_HITS;
  t.attackIn = roll(TARDIGRADE_ATTACK_EVERY, rnd);
  t.hitT = 0;
  t.fx = 0; t.fy = 0; t.fz = 1;
  faceToward(t, ship.x - x, ship.y - y, ship.z - z);
  t.jx = x; t.jy = y; t.jz = z; t.jdx = t.fx; t.jdy = t.fy; t.jdz = t.fz;
  t.pose.swim = 0; t.pose.charge = 0; t.pose.recoil = 0; t.pose.hit = 0; t.pose.curl = 0;
  t.scale = 1;
}

function backToSwim(t: Tardigrade, rnd: () => number): void {
  t.phase = "swim"; t.phaseT = 0;
  t.attackIn = roll(TARDIGRADE_ATTACK_EVERY, rnd);
}

export function stepTardigrade(t: Tardigrade, v: FightView, dt: number, rnd: () => number, sink: NestSink): void {
  if (t.phase === "gone") return;
  t.phaseT += dt;
  t.pose.hit = flinch(t, dt, TARDIGRADE_HIT_POSE_S);

  if (t.phase === "defeated" || t.phase === "leaving") {
    const defeated = t.phase === "defeated";
    if (defeated) t.pose.curl = Math.min(1, t.phaseT / CURL_S);
    t.pose.swim = 0;
    easeOut(t, dt);
    if (stepFade(t, v.ship, v.centre, dt, defeated ? TARDIGRADE_DEFEAT_S : 0, defeated ? DEFEAT_DRIFT : 0)) t.phase = "gone";
    return;
  }

  if (!v.shipIn && (t.phase === "charge" || t.phase === "jet")) backToSwim(t, rnd);

  const ship = v.ship;
  if (t.phase === "jet") {
    // Held still while it fires, so the jet stays on the mouth.
    t.vx = 0; t.vy = 0; t.vz = 0;
  } else if (!v.shipIn) {
    // The ship is out: no attacks, drift back toward the centre.
    driftHome(t, v.centre, TARDIGRADE_SPEED, SWIM_ACCEL, dt);
  } else {
    // Swim to the point TARDIGRADE_STANDOFF from the ship, on this side.
    let ox = t.x - ship.x, oy = t.y - ship.y, oz = t.z - ship.z;
    const od = Math.hypot(ox, oy, oz);
    if (od > 0) { ox /= od; oy /= od; oz /= od; } else { ox = -t.fx; oy = -t.fy; oz = -t.fz; }
    const tx = ship.x + ox * TARDIGRADE_STANDOFF, ty = ship.y + oy * TARDIGRADE_STANDOFF, tz = ship.z + oz * TARDIGRADE_STANDOFF;
    let wx = (tx - t.x) * SWIM_GAIN, wy = (ty - t.y) * SWIM_GAIN, wz = (tz - t.z) * SWIM_GAIN;
    const wl = Math.hypot(wx, wy, wz);
    if (wl > TARDIGRADE_SPEED) { const k = TARDIGRADE_SPEED / wl; wx *= k; wy *= k; wz *= k; }
    steer(t, wx, wy, wz, TARDIGRADE_SPEED, SWIM_ACCEL, dt);
  }
  moveLeashed(t, dt, v.centre);
  t.pose.swim = Math.hypot(t.vx, t.vy, t.vz) / TARDIGRADE_SPEED;
  // Still turning through the charge; the jet holds its line.
  if (t.phase !== "jet") slewFacing(t, ship.x - t.x, ship.y - t.y, ship.z - t.z, TARDIGRADE_TURN_RATE * dt);

  if (t.phase === "swim") {
    easeOut(t, dt);
    if (v.shipIn) {
      t.attackIn -= dt;
      if (t.attackIn <= T_EPS) { t.phase = "charge"; t.phaseT = 0; t.pose.charge = 0; }
    }
  } else if (t.phase === "charge") {
    t.pose.charge = Math.min(1, t.phaseT / TARDIGRADE_CHARGE_S);
    if (t.phaseT >= TARDIGRADE_CHARGE_S - T_EPS) {
      t.phase = "jet"; t.phaseT = 0;
      sink.mouth(t, _mouth);
      t.jx = _mouth.x; t.jy = _mouth.y; t.jz = _mouth.z;
      t.jdx = t.fx; t.jdy = t.fy; t.jdz = t.fz;
      t.pose.charge = 1; t.pose.recoil = 1;
    }
  } else if (t.phase === "jet") {
    t.pose.recoil = 1;
    if (t.phaseT >= JET_S - T_EPS) backToSwim(t, rnd);
  }
}

function easeOut(t: Tardigrade, dt: number): void {
  t.pose.charge = Math.max(0, t.pose.charge - dt / EASE_S);
  t.pose.recoil = Math.max(0, t.pose.recoil - dt / EASE_S);
}

/** A bolt hit: flinch; true on the defeating (18th) hit. A dying or gone tardigrade takes none. */
export function hitTardigrade(t: Tardigrade): boolean {
  if (!takeHit(t, t.pose, TARDIGRADE_HIT_POSE_S)) return false;
  t.phase = "defeated";
  t.pose.curl = 0;
  return true;
}

/** The fight ended: a live tardigrade shrinks away over `LEAVE_S`. A defeated one finishes its own fade. */
export function leaveTardigrade(t: Tardigrade): void {
  if (!t.alive) return;
  t.phase = "leaving";
  startFade(t);
}

/**
 * Whether the point p is in the jet: within `radius` of the axis from the
 * mouth o along d, and 0–`range` u ahead of the mouth (nothing behind it).
 * `d` need not be unit length.
 */
export function jetHit(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  px: number, py: number, pz: number, range: number = JET_RANGE, radius: number = JET_RADIUS,
): boolean {
  const l = Math.hypot(dx, dy, dz);
  if (l === 0) return false;
  const ux = dx / l, uy = dy / l, uz = dz / l;
  const wx = px - ox, wy = py - oy, wz = pz - oz;
  const along = wx * ux + wy * uy + wz * uz;
  if (along < 0 || along > range) return false;
  const qx = wx - ux * along, qy = wy - uy * along, qz = wz - uz * along;
  return qx * qx + qy * qy + qz * qz <= radius * radius;
}
