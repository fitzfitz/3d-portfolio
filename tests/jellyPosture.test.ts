import { describe, it, expect } from "vitest";
import {
  createPostureState, stepPosture, stepVelocity, POSTURE_V_SLOW, POSTURE_V_SWIM, POSTURE_V_MAX,
  type PostureState, type Quat,
} from "../src/utils/jellyPosture";

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const quat = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });
/** Model +y rotated into the world by q. */
const bodyUp = (q: Quat) => v(2 * (q.x * q.y - q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.w * q.x));
const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;
/** Angle between two unit quaternions (rad). */
const angleBetween = (a: Quat, b: Quat) => 2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)));
const run = (s: PostureState, vel: { x: number; y: number; z: number }, seconds: number, out = quat(), dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) stepPosture(s, vel, dt, out);
  return out;
};

describe("thresholds", () => {
  it("are ordered and in the measured range (cruise 10.8 u/s, loop ~3 u/s)", () => {
    expect(POSTURE_V_SLOW).toBeGreaterThan(0);
    expect(POSTURE_V_SWIM).toBeGreaterThan(POSTURE_V_SLOW);
    expect(POSTURE_V_SWIM).toBeLessThanOrEqual(3);
  });
});

describe("stepPosture", () => {
  it("is upright at rest (bell up, swim 0)", () => {
    const s = createPostureState();
    const q = run(s, v(), 3);
    expect(dot(bodyUp(q), v(0, 1, 0))).toBeGreaterThan(0.99);
    expect(s.swim).toBeLessThan(0.01);
  });

  it("stays upright below the slow-drift threshold", () => {
    const s = createPostureState();
    const q = run(s, v(POSTURE_V_SLOW * 0.9, 0, 0), 4);
    expect(dot(bodyUp(q), v(0, 1, 0))).toBeGreaterThan(0.99);
  });

  it("points the bell along the velocity at swimming speed", () => {
    for (const d of [v(1, 0, 0), v(0, 0, -1), v(0.6, 0.3, -0.74), v(0, -1, 0), v(0, 1, 0)]) {
      const len = Math.hypot(d.x, d.y, d.z);
      const s = createPostureState();
      const q = run(s, v((d.x / len) * 8, (d.y / len) * 8, (d.z / len) * 8), 4);
      expect(dot(bodyUp(q), v(d.x / len, d.y / len, d.z / len))).toBeGreaterThan(0.95);
      expect(s.swim).toBeGreaterThan(0.99);
    }
  });

  it("eases back upright monotonically when it stops", () => {
    const s = createPostureState();
    const q = run(s, v(8, 0, 0), 4);
    let prev = dot(bodyUp(q), v(0, 1, 0));
    let prevSwim = s.swim;
    for (let i = 0; i < 60 * 4; i++) {
      stepPosture(s, v(), 1 / 60, q);
      const u = dot(bodyUp(q), v(0, 1, 0));
      expect(u).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(s.swim).toBeLessThanOrEqual(prevSwim + 1e-9);
      prev = u; prevSwim = s.swim;
    }
    expect(prev).toBeGreaterThan(0.95);
  });

  it("half-life back to upright is about 1 s, and turning is faster (~0.3 s)", () => {
    const s = createPostureState();
    run(s, v(8, 0, 0), 4);
    run(s, v(), 1);
    // one half-life after stopping, roughly half the swim weight is left
    expect(s.swim).toBeGreaterThan(0.3);
    expect(s.swim).toBeLessThan(0.7);
    const s2 = createPostureState();
    run(s2, v(8, 0, 0), 0.3);
    expect(s2.swim).toBeGreaterThan(0.35);
  });

  it("does not flip on a 180 degree reversal (bounded angular step per frame)", () => {
    const s = createPostureState();
    const q = run(s, v(8, 0, 0), 4);
    const prev = { ...q };
    let worst = 0;
    for (let i = 0; i < 60 * 4; i++) {
      stepPosture(s, v(-8, 0, 0), 1 / 60, q);
      worst = Math.max(worst, angleBetween(prev, q));
      prev.x = q.x; prev.y = q.y; prev.z = q.z; prev.w = q.w;
    }
    // 0.3 s half-life: at most ~ln2/0.3/60 * pi = 0.12 rad a frame, never a jump
    expect(worst).toBeLessThan(0.15);
    expect(dot(bodyUp(q), v(-1, 0, 0))).toBeGreaterThan(0.95);
  });

  it("reversing straight up/down stays continuous too (antiparallel +y/-y)", () => {
    const s = createPostureState();
    const q = run(s, v(0, 8, 0), 4);
    const prev = { ...q };
    let worst = 0;
    for (let i = 0; i < 60 * 4; i++) {
      stepPosture(s, v(0, -8, 0), 1 / 60, q);
      worst = Math.max(worst, angleBetween(prev, q));
      prev.x = q.x; prev.y = q.y; prev.z = q.z; prev.w = q.w;
    }
    expect(worst).toBeLessThan(0.15);
    expect(dot(bodyUp(q), v(0, -1, 0))).toBeGreaterThan(0.95);
  });

  it("banks into a turn while the bell trails the heading by the damping lag", () => {
    const s = createPostureState();
    const q = quat();
    let ang = 0;
    for (let i = 0; i < 60 * 3; i++) { ang += 0.02; stepPosture(s, v(Math.cos(ang) * 8, 0, Math.sin(ang) * 8), 1 / 60, q); }
    expect(Math.abs(s.bank)).toBeGreaterThan(0.01);
    expect(Math.abs(s.bank)).toBeLessThanOrEqual(0.45);
    // turning 1.2 rad/s with a 0.3 s half-life lags ~0.5 rad behind the heading (cos ~0.88)
    expect(dot(bodyUp(q), v(Math.cos(ang), 0, Math.sin(ang)))).toBeGreaterThan(0.8);
  });

  it("keeps out unit-length and finite, and ignores dt = 0", () => {
    const s = createPostureState();
    const q = run(s, v(5, 2, -3), 2);
    const before = { ...q };
    stepPosture(s, v(-5, 0, 0), 0, q);
    expect(q).toEqual(before);
    for (const dt of [1e-9, 0.016, 5]) {
      stepPosture(s, v(1, 1, 1), dt, q);
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 6);
    }
  });

  it("is allocation-free: reuses state and out, no per-call garbage", () => {
    const s = createPostureState();
    const out = quat();
    const { dir, q, vel: sVel, last } = s;
    const vel = v(6, 1, -2);
    const heap = () => process.memoryUsage().heapUsed;
    for (let i = 0; i < 1000; i++) stepPosture(s, vel, 1 / 60, out);
    const h0 = heap();
    for (let i = 0; i < 300000; i++) stepPosture(s, vel, 1 / 60, out);
    // 300k calls that each made a quaternion and a vector would add ~20 MB
    expect(heap() - h0).toBeLessThan(2_000_000);
    expect(s.dir).toBe(dir);
    expect(s.q).toBe(q);
    expect(s.vel).toBe(sVel);
    expect(s.last).toBe(last);
    expect(Object.keys(s).length).toBe(Object.keys(createPostureState()).length);
  });
});

describe("stepVelocity", () => {
  it("measures speed from the position delta, smoothed", () => {
    const s = createPostureState();
    for (let i = 0; i < 600; i++) stepVelocity(s, i * 0.05, 0, 0, 1 / 60 * 1);
    // 3 u per second ... positions step 0.05 each 1/60 s = 3 u/s
    expect(s.vel.x).toBeGreaterThan(2.8);
    expect(s.vel.x).toBeLessThan(3.2);
  });

  it("treats the first sample, dt = 0 and a teleport as no sample", () => {
    const s = createPostureState();
    stepVelocity(s, 100, 0, 0, 1 / 60);
    expect(s.vel).toEqual(v());
    stepVelocity(s, 100, 0, 0, 0);
    expect(s.vel).toEqual(v());
    for (let i = 0; i < 120; i++) stepVelocity(s, 100 + i * 0.05, 0, 0, 1 / 60);
    const settled = s.vel.x;
    stepVelocity(s, 5000, 0, 0, 1 / 60); // teleport (the J summon)
    expect(s.vel.x).toBeCloseTo(settled, 6);
    stepVelocity(s, 5000.05, 0, 0, 1 / 60); // next frame resumes from the new spot
    expect(Math.abs(s.vel.x - settled)).toBeLessThan(0.5);
  });

  it("a teleport does not yank the posture", () => {
    const s = createPostureState();
    const q = quat();
    for (let i = 0; i < 300; i++) { stepVelocity(s, i * 0.05, 0, 0, 1 / 60); stepPosture(s, s.vel, 1 / 60, q); }
    const prev = { ...q };
    stepVelocity(s, -9000, 3000, 0, 1 / 60);
    stepPosture(s, s.vel, 1 / 60, q);
    expect(angleBetween(prev, q)).toBeLessThan(0.05);
  });
});

// The guide streaks in at ~250 u/s and stops dead on its station (spec
// 2026-10-23-jellyfish-guide, "Calling it"); it leads at warp and stops when
// the pilot does. Smoothed in raw u/s, that speed took ~5 s to fall under the
// swim threshold, so a stopped guide hung sideways (measured in the browser
// while building the guide). Spec "Swim posture": "easing back upright over ~1 s as it slows".
describe("stepVelocity: a fast stop still reads as a stop", () => {
  /** Dash along +x at `speed` for 2 s, then stand still; returns seconds until upright (body up · +y > 0.95). */
  function uprightAfterStop(speed: number): number {
    const s = createPostureState(), q = quat(), dt = 1 / 60;
    let x = 0;
    for (let i = 0; i < 120; i++) { x += speed * dt; stepVelocity(s, x, 0, 0, dt); stepPosture(s, s.vel, dt, q); }
    expect(bodyUp(q).x).toBeGreaterThan(0.9); // it was swimming bell first
    for (let i = 1; i < 600; i++) {
      stepVelocity(s, x, 0, 0, dt); stepPosture(s, s.vel, dt, q);
      if (bodyUp(q).y > 0.95) return i * dt;
    }
    return Infinity;
  }
  it("caps each sample at POSTURE_V_MAX, keeping its direction", () => {
    const s = createPostureState();
    for (let i = 0; i < 900; i++) stepVelocity(s, i * 3, i * 4, 0, 1 / 60); // 300 u/s along (3, 4, 0)
    expect(Math.hypot(s.vel.x, s.vel.y, s.vel.z)).toBeCloseTo(POSTURE_V_MAX, 3);
    expect(s.vel.x / s.vel.y).toBeCloseTo(3 / 4, 6);
  });
  it("the cap is more than 3 and at most 4 times the swim threshold", () => {
    expect(POSTURE_V_MAX).toBeGreaterThan(POSTURE_V_SWIM * 3);
    expect(POSTURE_V_MAX).toBeLessThanOrEqual(POSTURE_V_SWIM * 4);
  });
  it("upright as soon after a 250 u/s streak stops as after a 10 u/s swim stops", () => {
    // A 10 u/s swim's own stop (the posture's 1 s half-lives) is the bar: ~3.6 s to 0.95.
    const fast = uprightAfterStop(250), slow = uprightAfterStop(10);
    expect(fast).toBeLessThan(4);
    expect(fast - slow).toBeLessThan(0.1);
  });
});

describe("loop speed", () => {
  it("roaming the loop is above the swim threshold's 0.8 floor", async () => {
    const { JELLY_PATH, JELLY_LOOP_SECONDS } = await import("../src/data/jellyfishPath");
    const mean = JELLY_PATH.getLength() / JELLY_LOOP_SECONDS;
    expect(POSTURE_V_SWIM).toBeLessThanOrEqual(mean * 0.8 + 1e-2);
  });
});
