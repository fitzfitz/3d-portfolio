import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  JET_PARTICLES, JET_STREAM_SPEED, SMOKE_EVERY_S, SMOKE_LIFE_S, SMOKE_POOL, THRUST_DROP, boltMatrix, createSmoke, emitSmoke,
  JET_CORE_R, JET_GLOW_SPREAD, JET_SIZE, NEAR_FADE_FAR, NEAR_FADE_NEAR, jetGlow, jetParticle, nearFade, smokeAlpha,
  stepSmoke, thrustMatrix, HIT_SPARKS, SPARK_POOL, SPARK_LIFE_S, SPARK_SPEED, SPARK_R, createSparks, emitSparks, stepSparks,
  sparkMatrix,
} from "../src/utils/combat/effects";
import { JET_RADIUS, JET_RANGE, MAX_SAUCERS, SAUCER_DEFEAT_S, SAUCER_SPEED } from "../src/utils/combat/constants";
import { createSaucer, spawnSaucer, hitSaucer, sleepSaucer, wakeSaucer, type Saucer } from "../src/utils/combat/saucerAi";
import { createTardigrade } from "../src/utils/combat/tardigradeAi";
import {
  idleBlink, nestPhase, saucerRenderPose, sleepBob, SLEEP_BOB_AMP, SLEEP_BOB_PERIOD_S, tardigradeRenderPose,
} from "../src/utils/combat/renderPose";
import { monsterMatrix } from "../src/utils/combat/monsterFrame";
import { mulberry32 } from "../src/utils/mulberry32";
import type { SaucerPose, TardigradePose } from "../src/utils/monsters/monsterRig";
import type { V3 } from "../src/utils/combat/types";

const v = (x: number, y: number, z: number): V3 => ({ x, y, z });

/** A particle's distance along the jet's axis and from it. */
function inJet(p: V3, o: V3, d: V3): { along: number; off: number } {
  const l = Math.hypot(d.x, d.y, d.z);
  const ux = d.x / l, uy = d.y / l, uz = d.z / l;
  const wx = p.x - o.x, wy = p.y - o.y, wz = p.z - o.z;
  const along = wx * ux + wy * uy + wz * uz;
  return { along, off: Math.hypot(wx - ux * along, wy - uy * along, wz - uz * along) };
}

describe("the plasma jet's particles", () => {
  const mouth = v(-250, -390, 60);
  const dirs = [v(0.3, -0.5, 0.8), v(0, 1, 0), v(0, -3, 0), v(-1, 0, 0), v(2, 2, -1)];

  it("jet particles stay inside the jet: 0–90 u along the axis, within 2.5 u of it", () => {
    const out = v(0, 0, 0);
    let checked = 0;
    for (const d of dirs) {
      for (let i = 0; i < JET_PARTICLES; i++) {
        for (let k = 0; k <= 24; k++) {
          const t = k * 0.05;
          expect(jetParticle(i, JET_PARTICLES, t, mouth.x, mouth.y, mouth.z, d.x, d.y, d.z, out)).toBe(out);
          const { along, off } = inJet(out, mouth, d);
          expect(along).toBeGreaterThanOrEqual(-1e-9);
          expect(along).toBeLessThanOrEqual(JET_RANGE + 1e-9);
          expect(off).toBeLessThanOrEqual(JET_RADIUS + 1e-9);
          checked++;
        }
      }
    }
    expect(checked).toBe(dirs.length * JET_PARTICLES * 25);
  });

  it("reads as one stream: neighbours overlap along the axis, scattered in a narrow core", () => {
    // Evenly spaced along the 90 u: the spacing is well under a sprite's size.
    expect(JET_PARTICLES).toBe(720);
    expect(JET_SIZE).toBe(1);
    expect(JET_RANGE / JET_PARTICLES).toBeLessThan(JET_SIZE / 2);
    // The visible core sits well inside the hit radius.
    expect(JET_CORE_R).toBe(0.6);
    expect(JET_CORE_R).toBeLessThan(JET_RADIUS);
    const p = v(0, 0, 0);
    for (const d of dirs) {
      let maxOff = 0, offSum = 0;
      for (let i = 0; i < JET_PARTICLES; i++) {
        jetParticle(i, JET_PARTICLES, 0.5, mouth.x, mouth.y, mouth.z, d.x, d.y, d.z, p);
        const { along, off } = inJet(p, mouth, d);
        expect(off).toBeLessThanOrEqual(JET_CORE_R + 1e-9);
        // Narrower at the mouth: within the mouth's share of the core near it.
        if (along < 1) expect(off).toBeLessThanOrEqual(JET_CORE_R * 0.37 + 1e-9);
        maxOff = Math.max(maxOff, off);
        offSum += off;
      }
      // A turbulent spread, not a line: particles reach most of the core, and on average sit off the axis.
      expect(maxOff).toBeGreaterThan(JET_CORE_R * 0.8);
      expect(offSum / JET_PARTICLES).toBeGreaterThan(0.2);
    }
  });

  it("varies each particle's brightness within 1 ± JET_GLOW_SPREAD, fixed per particle", () => {
    let min = Infinity, max = -Infinity, sum = 0;
    for (let i = 0; i < JET_PARTICLES; i++) {
      const g = jetGlow(i);
      expect(jetGlow(i)).toBe(g);
      expect(g).toBeGreaterThanOrEqual(1 - JET_GLOW_SPREAD);
      expect(g).toBeLessThanOrEqual(1 + JET_GLOW_SPREAD);
      min = Math.min(min, g); max = Math.max(max, g); sum += g;
    }
    expect(max - min).toBeGreaterThan(JET_GLOW_SPREAD);
    expect(sum / JET_PARTICLES).toBeCloseTo(1, 1);
  });

  it("jet particles stream outward over time", () => {
    const a = v(0, 0, 0), b = v(0, 0, 0);
    const d = dirs[0];
    // Particle 0 starts at the mouth and is 0.1 s × the stream speed out 0.1 s later.
    jetParticle(0, JET_PARTICLES, 0, mouth.x, mouth.y, mouth.z, d.x, d.y, d.z, a);
    jetParticle(0, JET_PARTICLES, 0.1, mouth.x, mouth.y, mouth.z, d.x, d.y, d.z, b);
    expect(inJet(a, mouth, d).along).toBeCloseTo(0, 9);
    expect(inJet(b, mouth, d).along).toBeCloseTo(JET_STREAM_SPEED * 0.1, 9);
    expect(JET_STREAM_SPEED).toBeGreaterThan(0);
    // Every particle moves out by the same step, or wraps back to the mouth (mod the jet's length).
    for (let i = 0; i < JET_PARTICLES; i++) {
      jetParticle(i, JET_PARTICLES, 0.3, mouth.x, mouth.y, mouth.z, d.x, d.y, d.z, a);
      jetParticle(i, JET_PARTICLES, 0.4, mouth.x, mouth.y, mouth.z, d.x, d.y, d.z, b);
      const step = inJet(b, mouth, d).along - inJet(a, mouth, d).along;
      const wrapped = step < 0 ? step + JET_RANGE : step;
      expect(wrapped).toBeCloseTo(JET_STREAM_SPEED * 0.1, 6);
    }
  });

  it("spreads the particles along the whole jet at any moment", () => {
    const p = v(0, 0, 0);
    const d = dirs[3];
    const bins = new Set<number>();
    for (let i = 0; i < JET_PARTICLES; i++) {
      jetParticle(i, JET_PARTICLES, 0.7, mouth.x, mouth.y, mouth.z, d.x, d.y, d.z, p);
      bins.add(Math.floor(inJet(p, mouth, d).along / (JET_RANGE / 10)));
    }
    expect(bins.size).toBe(10);
  });
});

describe("the sprites' near-camera fade", () => {
  const cam = v(10, -4, 3);
  it("is full from 8 u out and nothing within 2 u, in any direction", () => {
    expect(NEAR_FADE_FAR).toBe(8);
    expect(NEAR_FADE_NEAR).toBe(2);
    for (const [dx, dy, dz] of [[1, 0, 0], [0, -1, 0], [0, 0.6, 0.8]]) {
      expect(nearFade(cam.x + dx * 8, cam.y + dy * 8, cam.z + dz * 8, cam)).toBe(1);
      expect(nearFade(cam.x + dx * 40, cam.y + dy * 40, cam.z + dz * 40, cam)).toBe(1);
      expect(nearFade(cam.x + dx * 2, cam.y + dy * 2, cam.z + dz * 2, cam)).toBe(0);
      expect(nearFade(cam.x + dx * 0.5, cam.y + dy * 0.5, cam.z + dz * 0.5, cam)).toBe(0);
    }
    expect(nearFade(cam.x, cam.y, cam.z, cam)).toBe(0);
  });
  it("rises smoothly in between: half at 5 u, rising with distance", () => {
    expect(nearFade(cam.x + 5, cam.y, cam.z, cam)).toBeCloseTo(0.5, 12);
    let last = 0;
    for (let d = 2; d <= 8; d += 0.25) {
      const f = nearFade(cam.x, cam.y + d, cam.z, cam);
      expect(f).toBeGreaterThanOrEqual(last);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      last = f;
    }
    // Smoothstep: flat at both ends.
    expect(nearFade(cam.x + 2.01, cam.y, cam.z, cam)).toBeLessThan(0.001);
    expect(nearFade(cam.x + 7.99, cam.y, cam.z, cam)).toBeGreaterThan(0.999);
  });
});

describe("the smoke trails", () => {
  function saucers(): Saucer[] {
    const out: Saucer[] = [];
    for (let i = 0; i < MAX_SAUCERS; i++) out.push(createSaucer());
    return out;
  }
  const defeat = (s: Saucer, x: number, phaseT: number) => {
    spawnSaucer(s, 1, x, 0, 0, () => 0.5, v(0, 0, 50));
    while (s.alive) hitSaucer(s);
    s.phaseT = phaseT;
  };

  it("puffs come only from defeated saucers, during their 3 s drift", () => {
    const ss = saucers();
    spawnSaucer(ss[0], 0, 100, 0, 0, () => 0.5, v(0, 0, 50)); // alive: no smoke
    defeat(ss[1], 200, 0.5);                                 // drifting: smokes
    defeat(ss[2], 300, SAUCER_DEFEAT_S + 0.1);               // past its drift: no smoke
    const pool = createSmoke();
    const rnd = mulberry32(3);
    let live = 0;
    for (let k = 0; k < 30; k++) live = stepSmoke(pool, ss, 1 / 60, rnd);
    expect(live).toBeGreaterThan(0);
    // 0.5 s at one puff per SMOKE_EVERY_S.
    expect(live).toBeLessThanOrEqual(Math.ceil(0.5 / SMOKE_EVERY_S) + 1);
    for (const p of pool.puffs) {
      if (!p.live) continue;
      expect(Math.hypot(p.x - 200, p.y, p.z)).toBeLessThan(2);
    }
  });

  it("the pool is fixed-length: past SMOKE_POOL puffs, the oldest is reused", () => {
    const pool = createSmoke();
    const rnd = mulberry32(9);
    const first = pool.puffs[0];
    for (let k = 0; k < SMOKE_POOL; k++) emitSmoke(pool, k, 0, 0, rnd);
    expect(pool.puffs.length).toBe(SMOKE_POOL);
    expect(pool.puffs.every((p) => p.live)).toBe(true);
    pool.puffs[0].age = 0.9; // the oldest
    emitSmoke(pool, 999, 0, 0, rnd);
    expect(pool.puffs.length).toBe(SMOKE_POOL);
    expect(pool.puffs[0]).toBe(first); // the same object, reused
    expect(first.age).toBe(0);
    expect(Math.abs(first.x - 999)).toBeLessThan(1);
  });

  it("a puff fades over its life, then frees its slot", () => {
    expect(smokeAlpha(0)).toBeGreaterThan(0);
    expect(smokeAlpha(SMOKE_LIFE_S * 0.5)).toBeLessThan(smokeAlpha(SMOKE_LIFE_S * 0.1));
    expect(smokeAlpha(SMOKE_LIFE_S)).toBe(0);
    const pool = createSmoke();
    emitSmoke(pool, 0, 0, 0, () => 0.5);
    expect(stepSmoke(pool, [], SMOKE_LIFE_S * 0.5, () => 0.5)).toBe(1);
    expect(stepSmoke(pool, [], SMOKE_LIFE_S * 0.6, () => 0.5)).toBe(0);
    expect(pool.puffs[0].live).toBe(false);
  });

  it("freezes with dt 0 (a paused fight): no puff ages, none is emitted", () => {
    const ss = saucers();
    defeat(ss[0], 0, 1);
    const pool = createSmoke();
    stepSmoke(pool, ss, 0.1, () => 0.5);
    const ages = pool.puffs.map((p) => p.age);
    const live = pool.puffs.filter((p) => p.live).length;
    expect(stepSmoke(pool, ss, 0, () => 0.5)).toBe(live);
    expect(pool.puffs.map((p) => p.age)).toEqual(ages);
  });
});

describe("the bolt and thrust instances", () => {
  it("a bolt's long axis lies along its flight, its width across it", () => {
    const m = new THREE.Matrix4();
    const d = new THREE.Vector3(1, 2, -2).normalize();
    expect(boltMatrix(5, 6, 7, 1, 2, -2, 0.3, 1.5, m)).toBe(m);
    const tip = new THREE.Vector3(0, 0, 1).applyMatrix4(m);
    expect(tip.distanceTo(new THREE.Vector3(5, 6, 7).addScaledVector(d, 1.5))).toBeLessThan(1e-9);
    const side = new THREE.Vector3(1, 0, 0).applyMatrix4(m).sub(new THREE.Vector3(5, 6, 7));
    expect(side.length()).toBeCloseTo(0.3, 9);
    expect(side.dot(d)).toBeCloseTo(0, 9);
  });

  it("a saucer's thrust glow sits under its hull and grows with its speed", () => {
    const s = createSaucer();
    spawnSaucer(s, 0, 10, 20, 30, () => 0.5, v(10, 20, 80)); // facing +Z, level
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), still = new THREE.Vector3(), fast = new THREE.Vector3();
    s.vx = 0; s.vy = 0; s.vz = 0;
    thrustMatrix(s, m).decompose(pos, q, still);
    expect(pos.x).toBeCloseTo(10, 9);
    expect(pos.y).toBeCloseTo(20 - THRUST_DROP, 9);
    expect(pos.z).toBeCloseTo(30, 9);
    s.vx = SAUCER_SPEED;
    thrustMatrix(s, m).decompose(pos, q, fast);
    expect(still.x).toBeGreaterThan(0);
    expect(fast.x).toBeGreaterThan(still.x * 2);
    // Shrinks with the saucer (a leave's fade).
    s.scale = 0.5;
    const half = new THREE.Vector3();
    thrustMatrix(s, m).decompose(pos, q, half);
    expect(half.x).toBeCloseTo(fast.x * 0.5, 9);
    expect(pos.y).toBeCloseTo(20 - THRUST_DROP * 0.5, 9);
  });
});

describe("the monsters' render poses", () => {
  it("turns the saucer's world aim and the ship's direction into its model space (worldDirToModel)", () => {
    const s = createSaucer();
    // At the origin, facing world +X (the ship 50 u along +X).
    spawnSaucer(s, 0, 0, 0, 0, () => 0.5, v(50, 0, 0));
    const m = monsterMatrix(s.x, s.y, s.z, s.fx, s.fy, s.fz, s.scale, new THREE.Matrix4());
    const pose: SaucerPose = { phase: 0, look: new THREE.Vector3(), aim: new THREE.Vector3(), chase: -1, fire: 0, hit: 0, defeat: 0, blink: 0 };
    s.ax = 0; s.ay = -1; s.az = 0; // the cannon aims straight down
    expect(saucerRenderPose(s, m, v(50, 0, 0), 0, 0.3, false, pose)).toBe(pose);
    // Model +Z is the facing (world +X), so the ship is straight ahead and down is model -Y.
    expect(pose.look.x).toBeCloseTo(0, 9); expect(pose.look.y).toBeCloseTo(0, 9); expect(pose.look.z).toBeCloseTo(50, 9);
    expect(pose.aim.x).toBeCloseTo(0, 9); expect(pose.aim.y).toBeCloseTo(-1, 9); expect(pose.aim.z).toBeCloseTo(0, 9);
    // World +X aim reads as the rest aim, model +Z.
    s.ax = 1; s.ay = 0; s.az = 0;
    saucerRenderPose(s, m, v(50, 0, 0), 0, 0.3, false, pose);
    expect(pose.aim.z).toBeCloseTo(1, 9);
    expect(pose.phase).toBe(0.3);
  });

  it("passes the AI's state poses through (chase, fire, hit, defeat)", () => {
    const s = createSaucer();
    spawnSaucer(s, 0, 0, 0, 0, () => 0.5, v(0, 0, 50));
    const m = monsterMatrix(0, 0, 0, s.fx, s.fy, s.fz, 1, new THREE.Matrix4());
    const pose: SaucerPose = { phase: 0, look: new THREE.Vector3(), aim: new THREE.Vector3(), chase: -1, fire: 0, hit: 0, defeat: 0, blink: 0 };
    s.pose.chase = 0.4; s.pose.fire = 0.7; s.pose.hit = 0.2; s.pose.defeat = 0;
    saucerRenderPose(s, m, v(0, 0, 50), 1, 0, false, pose);
    expect([pose.chase, pose.fire, pose.hit, pose.defeat]).toEqual([0.4, 0.7, 0.2, 0]);
    const t = createTardigrade();
    t.pose.swim = 0.5; t.pose.charge = 0.6; t.pose.recoil = 0.1; t.pose.hit = 0.9; t.pose.curl = 0.3;
    const tp: TardigradePose = { phase: 0, swim: 0, charge: 0, recoil: 0, hit: 0, curl: 0 };
    expect(tardigradeRenderPose(t, 0.25, tp)).toBe(tp);
    expect(tp).toEqual({ phase: 0.25, swim: 0.5, charge: 0.6, recoil: 0.1, hit: 0.9, curl: 0.3 });
  });

  it("idle blinks only while motion is on and the saucer is alive (R20)", () => {
    const s = createSaucer();
    spawnSaucer(s, 0, 0, 0, 0, () => 0.5, v(0, 0, 50));
    const m = monsterMatrix(0, 0, 0, s.fx, s.fy, s.fz, 1, new THREE.Matrix4());
    const pose: SaucerPose = { phase: 0, look: new THREE.Vector3(), aim: new THREE.Vector3(), chase: -1, fire: 0, hit: 0, defeat: 0, blink: 0 };
    let blinks = 0, reducedBlinks = 0, deadBlinks = 0;
    for (let k = 0; k < 1000; k++) {
      const t = k * 0.01;
      saucerRenderPose(s, m, v(0, 0, 50), t, 0.6, false, pose);
      expect(pose.blink).toBeGreaterThanOrEqual(0); expect(pose.blink).toBeLessThanOrEqual(1);
      if (pose.blink > 0) blinks++;
      saucerRenderPose(s, m, v(0, 0, 50), t, 0.6, true, pose);
      if (pose.blink > 0) reducedBlinks++;
    }
    hitSaucer(s); hitSaucer(s); hitSaucer(s);
    for (let k = 0; k < 1000; k++) {
      saucerRenderPose(s, m, v(0, 0, 50), k * 0.01, 0.6, false, pose);
      if (pose.blink > 0) deadBlinks++;
    }
    expect(blinks).toBeGreaterThan(0);
    expect(blinks).toBeLessThan(200); // brief: about 0.18 s every 3–5 s
    expect(reducedBlinks).toBe(0);
    expect(deadBlinks).toBe(0);
    expect(idleBlink(0, 0)).toBe(0);
  });

  it("gives each slot its own steady idle phase in [0, 1)", () => {
    const phases = Array.from({ length: 6 }, (_, i) => nestPhase(i));
    for (const p of phases) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(1); }
    expect(new Set(phases).size).toBe(6);
    expect(nestPhase(3)).toBe(phases[3]);
  });

  it("holds the eyes shut while asleep and opens them on waking", () => {
    const s = createSaucer();
    sleepSaucer(s, 2, 0, 0, 0, 0, 0, 1);
    const m = monsterMatrix(0, 0, 0, s.fx, s.fy, s.fz, 1, new THREE.Matrix4());
    const pose: SaucerPose = { phase: 0, look: new THREE.Vector3(), aim: new THREE.Vector3(), chase: -1, fire: 0, hit: 0, defeat: 0, blink: 0 };
    for (const reduced of [false, true]) {
      for (let k = 0; k < 100; k++) {
        saucerRenderPose(s, m, v(0, 0, 50), k * 0.05, 0.6, reduced, pose);
        expect(pose.blink).toBe(1);
      }
    }
    wakeSaucer(s);
    for (let k = 0; k < 100; k++) {
      saucerRenderPose(s, m, v(0, 0, 50), k * 0.05, 0.6, false, pose);
      expect(pose.blink).toBe(0);
    }
  });
});

describe("the sleepers' bob", () => {
  it("bobs ±0.35 u with a 4 s period, and not at all under reduced motion", () => {
    expect([SLEEP_BOB_AMP, SLEEP_BOB_PERIOD_S]).toEqual([0.35, 4]);
    let max = 0;
    for (const phase of [0, 0.3, 0.77]) {
      for (let k = 0; k < 400; k++) {
        const t = k * 0.037;
        const y = sleepBob(t, phase, false);
        expect(Math.abs(y)).toBeLessThanOrEqual(SLEEP_BOB_AMP + 1e-12);
        expect(sleepBob(t + 4, phase, false)).toBeCloseTo(y, 9);
        expect(sleepBob(t, phase, true)).toBe(0);
        max = Math.max(max, Math.abs(y));
      }
    }
    expect(max).toBeGreaterThan(0.34);
    // Slots bob out of step.
    expect(sleepBob(1, nestPhase(0), false)).not.toBeCloseTo(sleepBob(1, nestPhase(1), false), 3);
  });
});

describe("the hit sparks", () => {
  const live = (p: ReturnType<typeof createSparks>) => p.sparks.filter((s) => s.live);

  it("pins the sparks' values", () => {
    expect([HIT_SPARKS, SPARK_POOL, SPARK_LIFE_S, SPARK_SPEED, SPARK_R]).toEqual([4, 24, 0.3, 6, 0.12]);
    expect(createSparks().sparks).toHaveLength(SPARK_POOL);
    expect(createSparks().sparks.every((s) => !s.live)).toBe(true);
  });

  it("a strike makes 4 live sparks at the hit point, flying out at 6 u/s for 0.3 s", () => {
    const p = createSparks();
    emitSparks(p, 10, -5, 3, mulberry32(4), false);
    const sp = live(p);
    expect(sp).toHaveLength(4);
    for (const s of sp) {
      expect([s.x, s.y, s.z, s.age]).toEqual([10, -5, 3, 0]);
      expect(Math.hypot(s.vx, s.vy, s.vz)).toBeCloseTo(SPARK_SPEED, 9);
    }
    expect(stepSparks(p, 0.29)).toBe(4);
    for (const s of live(p)) expect(Math.hypot(s.x - 10, s.y + 5, s.z - 3)).toBeCloseTo(SPARK_SPEED * 0.29, 9);
    expect(stepSparks(p, 0.02)).toBe(0);
    expect(live(p)).toHaveLength(0);
  });

  it("under reduced motion they burst but hold still", () => {
    const p = createSparks();
    emitSparks(p, 1, 2, 3, mulberry32(5), true);
    expect(live(p)).toHaveLength(4);
    for (let i = 0; i < 5; i++) stepSparks(p, 0.05);
    for (const s of live(p)) expect([s.x, s.y, s.z]).toEqual([1, 2, 3]);
    expect(stepSparks(p, 0.1)).toBe(0);
  });

  it("dt 0 (a paused fight) freezes them", () => {
    const p = createSparks();
    emitSparks(p, 0, 0, 0, mulberry32(6), false);
    const before = p.sparks.map((s) => [s.x, s.y, s.z, s.age]);
    expect(stepSparks(p, 0)).toBe(4);
    expect(p.sparks.map((s) => [s.x, s.y, s.z, s.age])).toEqual(before);
  });

  it("the pool is fixed at 24: a 7th strike reuses the oldest slots", () => {
    const p = createSparks();
    const objs = p.sparks.slice();
    const rnd = mulberry32(7);
    for (let k = 0; k < 6; k++) { emitSparks(p, k, 0, 0, rnd, true); stepSparks(p, 0.01); }
    expect(live(p)).toHaveLength(24);
    emitSparks(p, 100, 0, 0, rnd, true);
    expect(p.sparks).toHaveLength(24);
    p.sparks.forEach((s, i) => expect(s).toBe(objs[i]));
    expect(live(p)).toHaveLength(24);
    // The first strike's four (the oldest) now sit at the 7th's point.
    for (let i = 0; i < 4; i++) expect([p.sparks[i].x, p.sparks[i].age]).toEqual([100, 0]);
    for (let i = 4; i < 24; i++) expect(p.sparks[i].x).toBe(Math.floor(i / 4));
  });

  it("a spark's instance is a sphere of 0.12 at birth, shrinking to half at half life", () => {
    const p = createSparks();
    emitSparks(p, 4, 5, 6, mulberry32(8), false);
    const s = live(p)[0];
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    expect(sparkMatrix(s, m)).toBe(m);
    m.decompose(pos, q, sc);
    expect([pos.x, pos.y, pos.z]).toEqual([4, 5, 6]);
    for (const k of [sc.x, sc.y, sc.z]) expect(k).toBeCloseTo(0.12, 12);
    stepSparks(p, SPARK_LIFE_S / 2);
    sparkMatrix(s, m).decompose(pos, q, sc);
    for (const k of [sc.x, sc.y, sc.z]) expect(k).toBeCloseTo(0.06, 12);
    expect(pos.distanceTo(new THREE.Vector3(4, 5, 6))).toBeCloseTo(SPARK_SPEED * SPARK_LIFE_S / 2, 9);
  });
});
