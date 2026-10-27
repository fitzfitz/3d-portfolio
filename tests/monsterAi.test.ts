import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  NEST_LEASH_R, SAUCER_SPEED, TARDIGRADE_SPEED, ENEMY_BOLT_SPEED, ENEMY_BOLT_RANGE, ENEMY_BOLT_DAMAGE,
  SAUCER_SPREAD_RAD, DEFEAT_DRIFT, LEAVE_S, SLEEP_GROW_S, UNCURL_S, WAKE_RISE_SPEED, TARDIGRADE_HITS,
} from "../src/utils/combat/constants";
import type { FightView, NestSink, V3 } from "../src/utils/combat/types";
import { createBoltPool, type BoltPool } from "../src/utils/combat/bolts";
import { leadAim } from "../src/utils/combat/aim";
import {
  createSaucer, spawnSaucer, stepSaucer, hitSaucer, leaveSaucer, sleepSaucer, wakeSaucer, type Saucer,
} from "../src/utils/combat/saucerAi";
import {
  createTardigrade, spawnTardigrade, stepTardigrade, hitTardigrade, leaveTardigrade, jetHit, sleepTardigrade, wakeTardigrade,
  type Tardigrade,
} from "../src/utils/combat/tardigradeAi";
import {
  monsterMatrix, worldDirToModel, saucerMuzzleWorld, tardigradeMouthWorld,
} from "../src/utils/combat/monsterFrame";
import { saucerMuzzle, type SaucerRig } from "../src/utils/monsters/saucerMaterial";
import type { TardigradeRig } from "../src/utils/monsters/tardigradeMaterial";
import saucerRigJson from "../src/data/saucerRig.json";
import tardigradeRigJson from "../src/data/tardigradeRig.json";
import { mulberry32 } from "../src/utils/mulberry32";

const SAUCER_RIG = saucerRigJson as unknown as SaucerRig;
const TARDIGRADE_RIG = tardigradeRigJson as unknown as TardigradeRig;

const DT = 1 / 120;
const EPS = 1e-9;
const DEG = Math.PI / 180;
const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angle = (ax: number, ay: number, az: number, b: V3) => {
  const d = (ax * b.x + ay * b.y + az * b.z) / (Math.hypot(ax, ay, az) * Math.hypot(b.x, b.y, b.z));
  return Math.acos(Math.min(1, Math.max(-1, d)));
};
const speed = (m: { vx: number; vy: number; vz: number }) => Math.hypot(m.vx, m.vy, m.vz);
/** Unit-facing dot with the direction from the monster to the ship. */
const facingDot = (m: Saucer | Tardigrade, ship: V3) => {
  const dx = ship.x - m.x, dy = ship.y - m.y, dz = ship.z - m.z;
  return (m.fx * dx + m.fy * dy + m.fz * dz) / Math.hypot(dx, dy, dz);
};

/** The test sink: the muzzle is the saucer's position, the mouth 3.5 u ahead of the tardigrade. */
const sink: NestSink = {
  muzzle: (s, o) => { o.x = s.x; o.y = s.y; o.z = s.z; return o; },
  mouth: (t, o) => { o.x = t.x + t.fx * 3.5; o.y = t.y + t.fy * 3.5; o.z = t.z + t.fz * 3.5; return o; },
};
const view = (ship: V3, shipVel: V3 = v(0, 0, 0), centre: V3 = v(0, 0, 0), shipIn = true): FightView =>
  ({ ship, shipVel, centre, shipIn });

/** Live enemy bolts after a step (the tests never step bolts, so each one is new); kills them once counted. */
function takeNewBolts(pool: BoltPool, out: { x: number; y: number; z: number; dx: number; dy: number; dz: number }[]): number {
  let n = 0;
  for (const b of pool.bolts) {
    if (!b.live) continue;
    expect(b.owner).toBe("enemy");
    expect(b.speed).toBe(ENEMY_BOLT_SPEED);
    expect(b.left).toBe(ENEMY_BOLT_RANGE);
    expect(b.damage).toBe(ENEMY_BOLT_DAMAGE);
    out.push({ x: b.x, y: b.y, z: b.z, dx: b.dx, dy: b.dy, dz: b.dz });
    b.live = false;
    n++;
  }
  return n;
}

function freshSaucer(x: number, y: number, z: number, ship: V3, rnd: () => number): Saucer {
  const s = createSaucer();
  spawnSaucer(s, 7, x, y, z, rnd, ship);
  return s;
}

describe("saucer AI", () => {
  it("starts gone, and spawns alive, facing the ship, with its rolls in range", () => {
    const s = createSaucer();
    expect(s.phase).toBe("gone");
    expect(s.alive).toBe(false);
    const rnd = mulberry32(1);
    const ship = v(5, 2, -40);
    spawnSaucer(s, 42, 0, 0, 0, rnd, ship);
    expect(s.seed).toBe(42);
    expect(s.phase).toBe("idle");
    expect(s.alive).toBe(true);
    expect(s.hp).toBe(3);
    expect(s.scale).toBe(1);
    expect(s.orbitR).toBeGreaterThanOrEqual(18);
    expect(s.orbitR).toBeLessThanOrEqual(35);
    expect(Math.abs(s.orbitY)).toBeLessThanOrEqual(6);
    expect(s.attackIn).toBeGreaterThanOrEqual(3);
    expect(s.attackIn).toBeLessThanOrEqual(5);
    expect(s.pose.chase).toBe(-1);
    expect(facingDot(s, ship)).toBeGreaterThan(1 - 1e-12);
    expect(Math.hypot(s.fx, s.fy, s.fz)).toBeCloseTo(1, 12);
  });

  it("a saucer circles 18–35 u from a still ship at no more than 14 u/s", () => {
    const rnd = mulberry32(1);
    const ship = v(0, 0, 0);
    const pool = createBoltPool();
    const s = freshSaucer(30, 0, 0, ship, rnd);
    let swept = 0;
    let prev = Math.atan2(s.z, s.x);
    let checked = 0;
    for (let i = 1; i <= 1200; i++) {
      stepSaucer(s, view(ship), DT, rnd, sink, pool);
      takeNewBolts(pool, []);
      if (i * DT <= 5) { prev = Math.atan2(s.z, s.x); continue; }
      const d = dist(s, ship);
      expect(d).toBeGreaterThanOrEqual(17);
      expect(d).toBeLessThanOrEqual(36);
      expect(speed(s)).toBeLessThanOrEqual(SAUCER_SPEED + EPS);
      const a = Math.atan2(s.z, s.x);
      let da = a - prev;
      if (da > Math.PI) da -= 2 * Math.PI;
      if (da < -Math.PI) da += 2 * Math.PI;
      swept += da;
      prev = a;
      checked++;
    }
    expect(checked).toBe(600);
    // It strafes round world Y: over the last 5 s it sweeps a good arc one way.
    expect(Math.abs(swept)).toBeGreaterThan(1);
  });

  it("never passes the leash", () => {
    const rnd = mulberry32(1);
    const centre = v(0, 0, 0);
    const ship = v(109, 0, 0);
    const pool = createBoltPool();
    const orbiting = [freshSaucer(-30, 0, 0, ship, rnd), freshSaucer(100, 5, 20, ship, rnd), freshSaucer(90, -5, -40, ship, rnd)];
    // A defeated saucer near the edge drifts outward, away from an inner ship.
    const inner = v(60, 0, 0);
    const dying = freshSaucer(100, 0, 0, inner, rnd);
    hitSaucer(dying); hitSaucer(dying); expect(hitSaucer(dying)).toBe(true);
    const t = createTardigrade();
    spawnTardigrade(t, 105, 0, 30, rnd, ship);
    let pushed = 0;
    for (let i = 0; i < 3600; i++) {
      for (const s of orbiting) stepSaucer(s, view(ship, v(0, 0, 0), centre), DT, rnd, sink, pool);
      stepSaucer(dying, view(inner, v(0, 0, 0), centre), DT, rnd, sink, pool);
      stepTardigrade(t, view(ship, v(0, 0, 0), centre), DT, rnd, sink);
      takeNewBolts(pool, []);
      for (const m of [...orbiting, dying, t]) {
        if (m.phase === "gone") continue;
        const d = dist(m, centre);
        expect(d).toBeLessThanOrEqual(NEST_LEASH_R + EPS);
        if (d > NEST_LEASH_R - 1e-6) pushed++;
      }
    }
    // The clamp really did work: something sat on the edge.
    expect(pushed).toBeGreaterThan(0);
    expect(dying.phase).toBe("gone");
  });

  it("warns 1.0 s, then fires 3 bolts 0.12 s apart, every 3–5 s", () => {
    const rnd = mulberry32(1);
    const ship = v(0, 0, 0);
    const pool = createBoltPool();
    const s = freshSaucer(30, 0, 0, ship, rnd);
    const warnStarts: number[] = [];
    const shots: number[] = [];
    let wasWarn = false;
    for (let i = 1; i <= 2400; i++) {
      stepSaucer(s, view(ship), DT, rnd, sink, pool);
      const t = i * DT;
      const warn = s.phase === "warn";
      expect(s.pose.chase !== -1).toBe(warn);
      if (warn) {
        expect(s.pose.chase).toBeGreaterThanOrEqual(0);
        expect(s.pose.chase).toBeLessThan(1);
      }
      if (warn && !wasWarn) {
        warnStarts.push(t);
        expect(s.pose.fire).toBe(0);
      }
      wasWarn = warn;
      const n = takeNewBolts(pool, []);
      expect(n).toBeLessThanOrEqual(1);
      if (n === 1) {
        shots.push(t);
        expect(s.pose.fire).toBe(1);
      }
    }
    const complete = warnStarts.filter((w) => w + 1.24 + DT <= 20);
    expect(complete.length).toBeGreaterThanOrEqual(3);
    expect(shots.length).toBe(complete.length * 3);
    complete.forEach((w, k) => {
      expect(Math.abs(shots[3 * k] - (w + 1.0))).toBeLessThanOrEqual(DT + EPS);
      expect(Math.abs(shots[3 * k + 1] - (w + 1.12))).toBeLessThanOrEqual(DT + EPS);
      expect(Math.abs(shots[3 * k + 2] - (w + 1.24))).toBeLessThanOrEqual(DT + EPS);
      if (k + 1 < warnStarts.length) {
        const gap = warnStarts[k + 1] - shots[3 * k + 2];
        expect(gap).toBeGreaterThanOrEqual(3 - DT - EPS);
        expect(gap).toBeLessThanOrEqual(5 + DT + EPS);
      }
    });
    // The first warn too: 3–5 s after the spawn.
    expect(warnStarts[0]).toBeGreaterThanOrEqual(3 - DT - EPS);
    expect(warnStarts[0]).toBeLessThanOrEqual(5 + DT + EPS);
  });

  it("aims each shot within 2° of the lead point", () => {
    const rnd = mulberry32(1);
    const ship = v(-60, 0, 0);
    const vel = v(20, 0, 0);
    const pool = createBoltPool();
    const s = freshSaucer(-60, 0, 30, ship, rnd);
    const lead = v(0, 0, 0);
    let fired = 0;
    let maxOff = 0;
    let maxLead = 0;
    for (let i = 0; i < 2400; i++) {
      stepSaucer(s, view(ship, vel), DT, rnd, sink, pool);
      const got: { x: number; y: number; z: number; dx: number; dy: number; dz: number }[] = [];
      takeNewBolts(pool, got);
      for (const b of got) {
        // The sink's muzzle is the saucer's position.
        expect(b.x).toBe(s.x); expect(b.y).toBe(s.y); expect(b.z).toBe(s.z);
        leadAim(b, ship, vel, ENEMY_BOLT_SPEED, lead);
        const off = angle(b.dx, b.dy, b.dz, lead);
        expect(off).toBeLessThanOrEqual(SAUCER_SPREAD_RAD + 1e-6);
        maxOff = Math.max(maxOff, off);
        maxLead = Math.max(maxLead, angle(b.dx, b.dy, b.dz, v(ship.x - b.x, ship.y - b.y, ship.z - b.z)));
        fired++;
      }
      ship.x += vel.x * DT;
    }
    expect(fired).toBeGreaterThanOrEqual(6);
    // The spread is real and the lead is real (not straight at the ship).
    expect(maxOff).toBeGreaterThan(0.1 * DEG);
    expect(maxLead).toBeGreaterThan(3 * DEG);
  });

  it("aims the cannon at the lead point, not straight at a strafing ship", () => {
    const rnd = mulberry32(1);
    const ship = v(-60, 0, 0);
    const vel = v(20, 0, 0);
    const pool = createBoltPool();
    const s = freshSaucer(-60, 0, 30, ship, rnd);
    const lead = v(0, 0, 0);
    const muzzle = v(0, 0, 0);
    let warnSteps = 0;
    let firstBolt: { x: number; y: number; z: number; dx: number; dy: number; dz: number } | null = null;
    for (let i = 0; i < 1200 && !firstBolt; i++) {
      stepSaucer(s, view(ship, vel), DT, rnd, sink, pool);
      const got: { x: number; y: number; z: number; dx: number; dy: number; dz: number }[] = [];
      takeNewBolts(pool, got);
      // Through the warn, the cannon tracks the lead from its muzzle.
      if (s.phase === "warn") {
        leadAim(sink.muzzle(s, muzzle), ship, vel, ENEMY_BOLT_SPEED, lead);
        expect(angle(s.ax, s.ay, s.az, lead)).toBeLessThanOrEqual(1 * DEG);
        warnSteps++;
      }
      if (got.length > 0) {
        firstBolt = got[0];
        leadAim(firstBolt, ship, vel, ENEMY_BOLT_SPEED, lead);
        // The cannon points down the bolt's (pre-spread) line…
        expect(angle(s.ax, s.ay, s.az, lead)).toBeLessThanOrEqual(1 * DEG);
        expect(angle(s.ax, s.ay, s.az, v(firstBolt.dx, firstBolt.dy, firstBolt.dz))).toBeLessThanOrEqual(SAUCER_SPREAD_RAD + 1 * DEG);
        // …which is well off the straight line to the strafing ship.
        expect(angle(s.ax, s.ay, s.az, v(ship.x - s.x, ship.y - s.y, ship.z - s.z))).toBeGreaterThan(2 * DEG);
        expect(Math.hypot(s.ax, s.ay, s.az)).toBeCloseTo(1, 12);
      }
      ship.x += vel.x * DT;
    }
    expect(firstBolt).not.toBeNull();
    expect(warnSteps).toBeGreaterThan(100);
  });

  it("stops firing and drifts home while the ship is out", () => {
    const rnd = mulberry32(1);
    const centre = v(0, 0, 0);
    const ship = v(100, 0, 0);
    const pool = createBoltPool();
    const s = freshSaucer(90, 0, 25, ship, rnd);
    let guard = 0;
    while (s.phase !== "warn" && guard++ < 1200) {
      stepSaucer(s, view(ship, v(0, 0, 0), centre), DT, rnd, sink, pool);
      takeNewBolts(pool, []);
    }
    expect(s.phase).toBe("warn");
    expect(dist(s, centre)).toBeGreaterThan(60);
    const out = view(ship, v(0, 0, 0), centre, false);
    for (let i = 0; i < 1800; i++) {
      stepSaucer(s, out, DT, rnd, sink, pool);
      expect(takeNewBolts(pool, [])).toBe(0);
      expect(s.phase).toBe("idle");
      expect(s.pose.chase).toBe(-1);
      expect(s.alive).toBe(true);
      expect(speed(s)).toBeLessThanOrEqual(SAUCER_SPEED + EPS);
    }
    expect(dist(s, centre)).toBeLessThanOrEqual(35);
  });

  it("a burst stops when the ship leaves mid-burst", () => {
    const rnd = mulberry32(3);
    const ship = v(0, 0, 0);
    const pool = createBoltPool();
    const s = freshSaucer(30, 0, 0, ship, rnd);
    let guard = 0;
    let first = 0;
    while (first === 0 && guard++ < 1200) {
      stepSaucer(s, view(ship), DT, rnd, sink, pool);
      first = takeNewBolts(pool, []);
    }
    expect(first).toBe(1);
    expect(s.phase).toBe("burst");
    for (let i = 0; i < 600; i++) {
      stepSaucer(s, view(ship, v(0, 0, 0), v(0, 0, 0), false), DT, rnd, sink, pool);
      expect(takeNewBolts(pool, [])).toBe(0);
      expect(s.phase).toBe("idle");
    }
  });

  it("flinches 0.25 s per hit; the third hit defeats it; gone after 3 + 2 s", () => {
    const rnd = mulberry32(1);
    const ship = v(0, 0, 0);
    const pool = createBoltPool();
    const s = freshSaucer(30, 0, 0, ship, rnd);
    const view0 = view(ship);
    expect(hitSaucer(s)).toBe(false);
    expect(s.hp).toBe(2);
    expect(s.pose.hit).toBe(1);
    for (let i = 0; i < 15; i++) stepSaucer(s, view0, DT, rnd, sink, pool);
    expect(s.pose.hit).toBeCloseTo(0.5, 9);
    for (let i = 0; i < 15; i++) stepSaucer(s, view0, DT, rnd, sink, pool);
    expect(s.pose.hit).toBeLessThan(1e-9);
    expect(hitSaucer(s)).toBe(false);
    expect(s.alive).toBe(true);
    expect(hitSaucer(s)).toBe(true);
    expect(s.alive).toBe(false);
    expect(s.phase).toBe("defeated");
    expect(s.pose.defeat).toBe(1);
    expect(s.pose.chase).toBe(-1);
    expect(hitSaucer(s)).toBe(false); // a dying saucer takes no more hits
    const d0 = dist(s, ship);
    for (let i = 1; i <= 601; i++) {
      stepSaucer(s, view0, DT, rnd, sink, pool);
      expect(takeNewBolts(pool, [])).toBe(0);
      if (i === 120) {
        // Drifting away from the ship at 4 u/s.
        expect(speed(s)).toBeCloseTo(DEFEAT_DRIFT, 9);
        expect(dist(s, ship) - d0).toBeCloseTo(DEFEAT_DRIFT, 6);
        expect(s.scale).toBe(1);
      }
      if (i === 588) {
        expect(s.phase).toBe("defeated");
        expect(s.scale).toBeGreaterThan(0);
        expect(s.scale).toBeLessThan(1);
      }
      if (i < 600) expect(s.phase).not.toBe("gone");
    }
    expect(s.phase).toBe("gone");
    expect(s.scale).toBe(0);
    expect(s.alive).toBe(false);
  });

  it("leaving shrinks a saucer away over 2 s", () => {
    const rnd = mulberry32(1);
    const ship = v(0, 0, 0);
    const pool = createBoltPool();
    const s = freshSaucer(30, 0, 0, ship, rnd);
    leaveSaucer(s);
    expect(s.phase).toBe("leaving");
    expect(s.alive).toBe(false);
    for (let i = 1; i <= 241; i++) {
      stepSaucer(s, view(ship), DT, rnd, sink, pool);
      expect(takeNewBolts(pool, [])).toBe(0);
      if (i === 120) expect(s.scale).toBeCloseTo(0.5, 9);
      if (i < 240) expect(s.phase).toBe("leaving");
    }
    expect(s.phase).toBe("gone");
    expect(s.scale).toBe(0);
    leaveSaucer(s);
    expect(s.phase).toBe("gone");
  });
});

describe("tardigrade AI", () => {
  it("a tardigrade swims to 40 u at no more than 5 u/s, facing the ship", () => {
    const rnd = mulberry32(1);
    const ship = v(0, 0, 0);
    const t = createTardigrade();
    expect(t.phase).toBe("gone");
    spawnTardigrade(t, 0, 10, 80, rnd, ship);
    expect(t.phase).toBe("swim");
    expect(t.alive).toBe(true);
    expect(t.hp).toBe(18);
    expect(facingDot(t, ship)).toBeGreaterThan(0.999);
    let swimSteps = 0;
    for (let i = 0; i < 1440; i++) {
      stepTardigrade(t, view(ship), DT, rnd, sink);
      const sp = speed(t);
      expect(sp).toBeLessThanOrEqual(TARDIGRADE_SPEED + EPS);
      expect(t.pose.swim).toBeCloseTo(sp / TARDIGRADE_SPEED, 12);
      if (t.phase === "swim") {
        expect(facingDot(t, ship)).toBeGreaterThan(0.999);
        swimSteps++;
      }
    }
    expect(swimSteps).toBeGreaterThan(600);
    expect(Math.abs(dist(t, ship) - 40)).toBeLessThan(1);
  });

  it("charges 1.6 s, then jets 1.2 s along the line it faced when the charge ended", () => {
    const rnd = mulberry32(1);
    const ship = v(0, 0, 0);
    const t = createTardigrade();
    spawnTardigrade(t, 0, 0, 60, rnd, ship);
    const changes: { phase: string; t: number }[] = [{ phase: t.phase, t: 0 }];
    let lastCharge = -1;
    let chargeStartF: V3 | null = null;
    let jd: V3 | null = null;
    let jo: V3 | null = null;
    let jetSteps = 0;
    for (let i = 1; i <= 1320; i++) {
      // The ship strafes sideways at 20 u/s through the charge and the jet.
      const moving = t.phase === "charge" || t.phase === "jet";
      stepTardigrade(t, view(ship, v(moving ? 20 : 0, 0, 0)), DT, rnd, sink);
      if (moving) ship.x += 20 * DT;
      const now = i * DT;
      if (t.phase !== changes[changes.length - 1].phase) changes.push({ phase: t.phase, t: now });
      if (t.phase === "charge") {
        expect(t.pose.charge).toBeGreaterThanOrEqual(lastCharge);
        lastCharge = t.pose.charge;
        if (!chargeStartF) chargeStartF = v(t.fx, t.fy, t.fz);
      }
      if (t.phase === "jet") {
        if (!jd) {
          // Fixed at the charge's end: the facing then, from the mouth then.
          jd = v(t.jdx, t.jdy, t.jdz);
          expect(jd).toEqual(v(t.fx, t.fy, t.fz));
          jo = v(t.jx, t.jy, t.jz);
          expect(jo.x).toBeCloseTo(t.x + t.fx * 3.5, 9);
          expect(jo.y).toBeCloseTo(t.y + t.fy * 3.5, 9);
          expect(jo.z).toBeCloseTo(t.z + t.fz * 3.5, 9);
          expect(lastCharge).toBeGreaterThan(0.99);
        }
        expect(v(t.jdx, t.jdy, t.jdz)).toEqual(jd);
        // The body holds the jet's line too (the mouth stays on it).
        expect(v(t.fx, t.fy, t.fz)).toEqual(jd);
        expect(v(t.jx, t.jy, t.jz)).toEqual(jo);
        expect(t.pose.recoil).toBeGreaterThan(0);
        jetSteps++;
      }
    }
    expect(changes.slice(0, 4).map((c) => c.phase)).toEqual(["swim", "charge", "jet", "swim"]);
    const [, charge, jet, swim] = changes;
    expect(charge.t).toBeGreaterThanOrEqual(6 - DT - EPS);
    expect(charge.t).toBeLessThanOrEqual(8 + DT + EPS);
    expect(Math.abs(jet.t - charge.t - 1.6)).toBeLessThanOrEqual(DT + EPS);
    expect(Math.abs(swim.t - jet.t - 1.2)).toBeLessThanOrEqual(DT + EPS);
    expect(jetSteps).toBeGreaterThan(140);
    // It kept turning through the charge (the ship moved), then held the line.
    expect(angle(jd!.x, jd!.y, jd!.z, chargeStartF!)).toBeGreaterThan(0.3);
    // By the jet's end the strafing ship is well off the jet's line.
    expect(jetHit(jo!.x, jo!.y, jo!.z, jd!.x, jd!.y, jd!.z, ship.x, ship.y, ship.z)).toBe(false);
  });

  it("jetHit: 90 u long, 2.5 u wide, nothing behind the mouth", () => {
    expect(jetHit(0, 0, 0, 0, 0, 1, 0, 0, 89)).toBe(true);
    expect(jetHit(0, 0, 0, 0, 0, 1, 0, 0, 91)).toBe(false);
    expect(jetHit(0, 0, 0, 0, 0, 1, 2.4, 0, 50)).toBe(true);
    expect(jetHit(0, 0, 0, 0, 0, 1, 2.6, 0, 50)).toBe(false);
    expect(jetHit(0, 0, 0, 0, 0, 1, 0, 0, -1)).toBe(false);
    // Off-axis origin and a non-unit direction; explicit range and radius.
    expect(jetHit(10, 5, 0, 3, 0, 0, 70, 6.5, 0)).toBe(true);
    expect(jetHit(10, 5, 0, 3, 0, 0, 70, 8, 0)).toBe(false);
    expect(jetHit(0, 0, 0, 1, 0, 0, 30, 0, 0, 20)).toBe(false);
    expect(jetHit(0, 0, 0, 1, 0, 0, 30, 4, 0, 90, 5)).toBe(true);
  });

  it("stops attacking and drifts home while the ship is out", () => {
    const rnd = mulberry32(1);
    const centre = v(0, 0, 0);
    const ship = v(100, 0, 0);
    const t = createTardigrade();
    spawnTardigrade(t, 90, 0, 25, rnd, ship);
    let guard = 0;
    while (t.phase !== "charge" && guard++ < 1200) stepTardigrade(t, view(ship, v(0, 0, 0), centre), DT, rnd, sink);
    expect(t.phase).toBe("charge");
    expect(dist(t, centre)).toBeGreaterThan(80);
    const out = view(ship, v(0, 0, 0), centre, false);
    for (let i = 0; i < 1800; i++) {
      stepTardigrade(t, out, DT, rnd, sink);
      expect(t.phase).toBe("swim");
      expect(t.alive).toBe(true);
      const sp = speed(t);
      expect(sp).toBeLessThanOrEqual(TARDIGRADE_SPEED + EPS);
      expect(t.pose.swim).toBeCloseTo(sp / TARDIGRADE_SPEED, 12);
    }
    expect(dist(t, centre)).toBeLessThanOrEqual(35);
    expect(t.pose.charge).toBe(0);
  });

  it("the ship leaving cancels a charge", () => {
    const rnd = mulberry32(1);
    const ship = v(0, 0, 0);
    const t = createTardigrade();
    spawnTardigrade(t, 0, 0, 60, rnd, ship);
    let guard = 0;
    while (t.phase !== "charge" && guard++ < 1200) stepTardigrade(t, view(ship), DT, rnd, sink);
    for (let i = 0; i < 60; i++) stepTardigrade(t, view(ship), DT, rnd, sink);
    expect(t.phase).toBe("charge");
    const mid = t.pose.charge;
    expect(mid).toBeGreaterThan(0.3);
    const out = view(ship, v(0, 0, 0), v(0, 0, 0), false);
    let prev = mid;
    for (let i = 0; i < 240; i++) {
      stepTardigrade(t, out, DT, rnd, sink);
      expect(t.phase).toBe("swim");
      expect(t.pose.charge).toBeLessThanOrEqual(prev);
      prev = t.pose.charge;
    }
    expect(t.pose.charge).toBe(0);
  });

  it("the ship leaving cancels a jet", () => {
    const rnd = mulberry32(1);
    const ship = v(0, 0, 0);
    const t = createTardigrade();
    spawnTardigrade(t, 0, 0, 60, rnd, ship);
    let guard = 0;
    while (t.phase !== "jet" && guard++ < 1400) stepTardigrade(t, view(ship), DT, rnd, sink);
    expect(t.phase).toBe("jet");
    expect(t.pose.recoil).toBe(1);
    stepTardigrade(t, view(ship, v(0, 0, 0), v(0, 0, 0), false), DT, rnd, sink);
    expect(t.phase).toBe("swim");
    for (let i = 0; i < 240; i++) stepTardigrade(t, view(ship, v(0, 0, 0), v(0, 0, 0), false), DT, rnd, sink);
    expect(t.phase).toBe("swim");
    expect(t.pose.recoil).toBe(0);
  });

  it("18 hits curl the tardigrade; gone after 4 + 2 s", () => {
    const rnd = mulberry32(1);
    const ship = v(0, 0, 0);
    const t = createTardigrade();
    spawnTardigrade(t, 0, 0, 40, rnd, ship);
    for (let k = 1; k <= 17; k++) {
      expect(hitTardigrade(t)).toBe(false);
      expect(t.pose.hit).toBe(1);
      expect(t.alive).toBe(true);
    }
    for (let i = 0; i < 30; i++) stepTardigrade(t, view(ship), DT, rnd, sink);
    expect(t.pose.hit).toBeLessThan(1e-9);
    expect(hitTardigrade(t)).toBe(true);
    expect(t.alive).toBe(false);
    expect(t.phase).toBe("defeated");
    expect(hitTardigrade(t)).toBe(false);
    expect(t.pose.curl).toBe(0);
    for (let i = 1; i <= 721; i++) {
      stepTardigrade(t, view(ship), DT, rnd, sink);
      if (i === 60) expect(t.pose.curl).toBeCloseTo(0.5, 9);
      if (i === 120) {
        expect(t.pose.curl).toBeCloseTo(1, 9);
        expect(speed(t)).toBeCloseTo(DEFEAT_DRIFT, 9);
      }
      if (i === 708) {
        expect(t.phase).toBe("defeated");
        expect(t.scale).toBeGreaterThan(0);
        expect(t.scale).toBeLessThan(1);
      }
      if (i < 720) expect(t.phase).not.toBe("gone");
    }
    expect(t.phase).toBe("gone");
    expect(t.scale).toBe(0);
  });

  it("leaving shrinks a tardigrade away over 2 s", () => {
    const rnd = mulberry32(1);
    const ship = v(0, 0, 0);
    const t = createTardigrade();
    spawnTardigrade(t, 0, 0, 40, rnd, ship);
    leaveTardigrade(t);
    expect(t.phase).toBe("leaving");
    expect(t.alive).toBe(false);
    for (let i = 1; i <= 241; i++) {
      stepTardigrade(t, view(ship), DT, rnd, sink);
      if (i === 120) expect(t.scale).toBeCloseTo(0.5, 9);
      if (i < 240) expect(t.phase).toBe("leaving");
    }
    expect(t.phase).toBe("gone");
  });
});

describe("monster frames", () => {
  const close = (a: V3, b: V3, eps = 1e-9) => {
    expect(Math.abs(a.x - b.x)).toBeLessThan(eps);
    expect(Math.abs(a.y - b.y)).toBeLessThan(eps);
    expect(Math.abs(a.z - b.z)).toBeLessThan(eps);
  };
  /** +90° about world Y: +Z → +X. */
  const rotY90 = (p: V3) => v(p.z, p.y, -p.x);

  it("monster frames: model +Z faces the ship, the muzzle turns with the saucer", () => {
    const m = new THREE.Matrix4();
    const out = new THREE.Vector3();
    // Facing +X: a 90° turn about Y; model +Z goes to +X, +Y stays up.
    monsterMatrix(0, 0, 0, 1, 0, 0, 1, m);
    close(worldDirToModel(m, 1, 0, 0, out), v(0, 0, 1));
    close(new THREE.Vector3(0, 0, 1).transformDirection(m), v(1, 0, 0));
    close(new THREE.Vector3(0, 1, 0).transformDirection(m), v(0, 1, 0));
    // A tilted facing: +Z follows it, +Y leans toward world up; position and scale apply.
    const f = v(1 / Math.SQRT2, 1 / Math.SQRT2, 0);
    monsterMatrix(4, 5, 6, f.x, f.y, f.z, 2, m);
    close(new THREE.Vector3(0, 0, 1).transformDirection(m), f);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(m);
    expect(up.y).toBeGreaterThan(0);
    expect(Math.abs(up.dot(new THREE.Vector3(f.x, f.y, f.z)))).toBeLessThan(1e-9);
    close(new THREE.Vector3(0, 0, 1).applyMatrix4(m), v(4 + 2 * f.x, 5 + 2 * f.y, 6));
    close(worldDirToModel(m, f.x, f.y, f.z, out), v(0, 0, 1));
    // Facing straight up still gives a frame.
    monsterMatrix(0, 0, 0, 0, 1, 0, 1, m);
    close(new THREE.Vector3(0, 0, 1).transformDirection(m), v(0, 1, 0));
    expect(Number.isFinite(m.elements[0])).toBe(true);

    const s = createSaucer();
    const aim = new THREE.Vector3(0, -1, 0.2);
    const rest = saucerMuzzle(aim, SAUCER_RIG, new THREE.Vector3());
    // Facing +Z at the origin: world equals model.
    s.x = 0; s.y = 0; s.z = 0; s.scale = 1;
    s.fx = 0; s.fy = 0; s.fz = 1;
    const al = aim.length();
    s.ax = aim.x / al; s.ay = aim.y / al; s.az = aim.z / al;
    const w = v(0, 0, 0);
    close(saucerMuzzleWorld(s, SAUCER_RIG, w), rest);
    // Facing +X with the aim turned the same way: the muzzle turns 90° about Y.
    s.fx = 1; s.fy = 0; s.fz = 0;
    s.ax = aim.z / al; s.ay = aim.y / al; s.az = -aim.x / al;
    close(saucerMuzzleWorld(s, SAUCER_RIG, w), rotY90(rest));
    // Moved: the muzzle moves with it.
    s.x = 10; s.y = -3; s.z = 7;
    const r = rotY90(rest);
    close(saucerMuzzleWorld(s, SAUCER_RIG, w), v(r.x + 10, r.y - 3, r.z + 7));

    const t = createTardigrade();
    t.x = 0; t.y = 0; t.z = 0; t.scale = 1;
    t.fx = 0; t.fy = 0; t.fz = 1;
    const mouth = v(TARDIGRADE_RIG.mouth[0], TARDIGRADE_RIG.mouth[1], TARDIGRADE_RIG.mouth[2]);
    close(tardigradeMouthWorld(t, TARDIGRADE_RIG, w), mouth);
    t.fx = 1; t.fz = 0;
    close(tardigradeMouthWorld(t, TARDIGRADE_RIG, w), rotY90(mouth));
  });
});

describe("sleeping and waking", () => {
  const ship = v(0, 0, 80);
  const run = (seconds: number, f: () => void) => { for (let i = 0, k = Math.round(seconds / DT); i < k; i++) f(); };

  it("a sleeping saucer only grows in; awake, it rises and turns to the ship; neither is a target nor fires", () => {
    const s = createSaucer();
    const pool = createBoltPool(8);
    sleepSaucer(s, 7, 3, 4, 5, 1, 0, 0);
    expect([s.alive, s.phase, s.scale, s.seed, s.x, s.y, s.z, s.fx, s.fy, s.fz]).toEqual([false, "asleep", 0, 7, 3, 4, 5, 1, 0, 0]);
    run(0.5, () => stepSaucer(s, view(ship), DT, Math.random, sink, pool));
    expect(s.scale).toBeCloseTo(0.5 / SLEEP_GROW_S, 9);
    expect([s.x, s.y, s.z, s.vx, s.vy, s.vz, s.fx]).toEqual([3, 4, 5, 0, 0, 0, 1]);
    run(1, () => stepSaucer(s, view(ship), DT, Math.random, sink, pool));
    expect(s.scale).toBe(1);
    wakeSaucer(s);
    expect([s.alive, s.phase]).toEqual([false, "waking"]);
    run(1, () => stepSaucer(s, view(ship), DT, Math.random, sink, pool));
    expect(s.y).toBeCloseTo(4 + WAKE_RISE_SPEED, 9);
    expect([s.x, s.z]).toEqual([3, 5]);
    expect(facingDot(s, ship)).toBeGreaterThan(0.99);
    expect(pool.bolts.some((b) => b.live)).toBe(false);
    expect(hitSaucer(s)).toBe(false);
  });

  it("a sleeping or waking saucer leaves when sent away", () => {
    for (const wake of [false, true]) {
      const s = createSaucer();
      sleepSaucer(s, 1, 0, 0, 0, 0, 0, 1);
      run(1.2, () => stepSaucer(s, view(ship), DT, Math.random, sink, createBoltPool(1)));
      if (wake) wakeSaucer(s);
      leaveSaucer(s);
      expect(s.phase).toBe("leaving");
      run(LEAVE_S + 0.05, () => stepSaucer(s, view(ship), DT, Math.random, sink, createBoltPool(1)));
      expect([s.phase, s.scale, s.alive]).toEqual(["gone", 0, false]);
    }
  });

  it("a sleeping tardigrade grows in curled; woken, it holds still and uncurls over 1 s, then swims", () => {
    const t = createTardigrade();
    sleepTardigrade(t, 1, 2, 3, 0, 1, 0);
    expect([t.alive, t.phase, t.scale, t.pose.curl, t.fy]).toEqual([false, "asleep", 0, 1, 1]);
    run(1.5, () => stepTardigrade(t, view(ship), DT, Math.random, sink));
    expect([t.scale, t.pose.curl, t.x, t.y, t.z]).toEqual([1, 1, 1, 2, 3]);
    expect(hitTardigrade(t)).toBe(false);
    wakeTardigrade(t, mulberry32(1), ship);
    expect([t.alive, t.phase, t.hp, t.pose.curl]).toEqual([true, "swim", TARDIGRADE_HITS, 1]);
    run(UNCURL_S / 2, () => {
      stepTardigrade(t, view(ship), DT, Math.random, sink);
      expect(speed(t)).toBe(0);
    });
    expect(t.pose.curl).toBeCloseTo(0.5, 9);
    run(UNCURL_S / 2, () => stepTardigrade(t, view(ship), DT, Math.random, sink));
    expect(t.pose.curl).toBe(0);
    expect([t.x, t.y, t.z]).toEqual([1, 2, 3]);
    expect(t.phase).toBe("swim"); // no charge while uncurling
    run(0.5, () => stepTardigrade(t, view(ship), DT, Math.random, sink));
    expect(speed(t)).toBeGreaterThan(0);
  });

  it("a sleeping tardigrade leaves when sent away", () => {
    const t = createTardigrade();
    sleepTardigrade(t, 0, 0, 0, 0, 0, 1);
    run(1, () => stepTardigrade(t, view(ship), DT, Math.random, sink));
    leaveTardigrade(t);
    expect(t.phase).toBe("leaving");
    run(LEAVE_S + 0.05, () => stepTardigrade(t, view(ship), DT, Math.random, sink));
    expect([t.phase, t.scale]).toEqual(["gone", 0]);
  });
});
