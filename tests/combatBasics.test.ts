import { describe, it, expect } from "vitest";
import {
  NEST_ZONE_R, NEST_LEASH_R, NEST_BUOY_R, NEST_LOAD_R, NEST_HAZE_BAND,
  WAVES, WAVES_LOW_PERF, BOLT_SPEED, BOLT_RANGE, ENEMY_BOLT_SPEED, ENEMY_BOLT_DAMAGE, ENEMY_BOLT_RANGE,
  JET_RANGE, JET_RADIUS, JET_DPS, JET_S, TARDIGRADE_CHARGE_S, AIM_ASSIST_RAD, SAUCER_SPREAD_RAD,
  CONTACT_DELAY_S, WAVE_GAP_S, NEST_REST_S, OUT_LIMIT_S,
  HULL_MAX, HULL_REGEN_PER_S, HULL_REGEN_DELAY_S, HULL_AFTER_BREACH, FIRE_INTERVAL_S,
  SAUCER_HITS, TARDIGRADE_HITS, SAUCER_ORBIT, SAUCER_SPEED, SAUCER_ATTACK_EVERY, SAUCER_WARN_S,
  SAUCER_BURST, SAUCER_BURST_GAP_S, SAUCER_HIT_POSE_S, SAUCER_DEFEAT_S,
  TARDIGRADE_SPEED, TARDIGRADE_STANDOFF, TARDIGRADE_ATTACK_EVERY,
  SAUCER_HIT_R, TARDIGRADE_HIT_R, SHIP_HIT_R, BOLT_R, TARDIGRADE_HIT_POSE_S, TARDIGRADE_DEFEAT_S,
  LEAVE_S, DEFEAT_DRIFT, SPAWN_R, SAUCER_TURN_RATE, TARDIGRADE_TURN_RATE, HIT_FEEDBACK_MIN_S,
  CLICK_AIM_DEPTH, NOSE_OFFSET, MAX_SAUCERS, MAX_TARDIGRADES, BOLT_POOL, NEST_RUMOUR_R, TOW_PAST_BUOY,
} from "../src/utils/combat/constants";
import type { AimTarget, V3 } from "../src/utils/combat/types";
import { createHull, damageHull, regenHull, restoreAfterBreach } from "../src/utils/combat/hull";
import { createBoltPool, fireBolt, stepBolts, clearBolts, segmentHitsSphere } from "../src/utils/combat/bolts";
import { aimAssist, leadAim, spreadDir, clickAimPoint } from "../src/utils/combat/aim";
import { inNestArea, clickUse, beamUse, beamLabel } from "../src/utils/combat/controls";
import { mulberry32 } from "../src/utils/mulberry32";

const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const angle = (a: V3, b: V3) => Math.acos(Math.min(1, Math.max(-1, dot(a, b) / (len(a) * len(b)))));
const DEG = Math.PI / 180;
/** A live, still target `dist` u from the origin, `deg`° off +Z in the x–z plane. */
const target = (deg: number, dist: number, alive = true): AimTarget => ({
  x: dist * Math.sin(deg * DEG), y: 0, z: dist * Math.cos(deg * DEG), vx: 0, vy: 0, vz: 0, alive,
});

describe("constants", () => {
  it("pins the spec's numbers", () => {
    expect([NEST_ZONE_R, NEST_LEASH_R, NEST_BUOY_R, NEST_LOAD_R, NEST_HAZE_BAND]).toEqual([70, 110, 120, 200, 30]);
    expect(WAVES).toEqual([{ saucers: 3, tardigrades: 0 }, { saucers: 5, tardigrades: 0 }, { saucers: 3, tardigrades: 1 }]);
    expect(WAVES_LOW_PERF).toEqual([{ saucers: 2, tardigrades: 0 }, { saucers: 3, tardigrades: 0 }, { saucers: 2, tardigrades: 1 }]);
    expect([BOLT_SPEED, BOLT_RANGE, ENEMY_BOLT_SPEED, ENEMY_BOLT_DAMAGE, ENEMY_BOLT_RANGE]).toEqual([140, 160, 48, 6, 120]);
    expect([JET_RANGE, JET_RADIUS, JET_DPS, JET_S, TARDIGRADE_CHARGE_S]).toEqual([90, 2.5, 25, 1.2, 1.6]);
    expect(AIM_ASSIST_RAD).toBeCloseTo((12 * Math.PI) / 180, 12);
  });
  it("pins the rest of the spec's table", () => {
    expect([CONTACT_DELAY_S, WAVE_GAP_S, NEST_REST_S, OUT_LIMIT_S]).toEqual([3, 5, 120, 20]);
    expect([HULL_MAX, HULL_REGEN_PER_S, HULL_REGEN_DELAY_S, HULL_AFTER_BREACH]).toEqual([100, 6, 4, 60]);
    expect(FIRE_INTERVAL_S).toBe(0.2);
    expect([SAUCER_HITS, TARDIGRADE_HITS]).toEqual([3, 18]);
    expect(SAUCER_ORBIT).toEqual([18, 35]);
    expect(SAUCER_ATTACK_EVERY).toEqual([3, 5]);
    expect([SAUCER_SPEED, SAUCER_WARN_S, SAUCER_BURST, SAUCER_BURST_GAP_S, SAUCER_HIT_POSE_S, SAUCER_DEFEAT_S])
      .toEqual([14, 1, 3, 0.12, 0.25, 3]);
    expect(SAUCER_SPREAD_RAD).toBeCloseTo((2 * Math.PI) / 180, 12);
    expect([TARDIGRADE_SPEED, TARDIGRADE_STANDOFF]).toEqual([5, 40]);
    expect(TARDIGRADE_ATTACK_EVERY).toEqual([6, 8]);
  });
  it("pins the controller's values", () => {
    expect([SAUCER_HIT_R, TARDIGRADE_HIT_R, SHIP_HIT_R, BOLT_R]).toEqual([1.8, 3.5, 1.4, 0.3]);
    expect([TARDIGRADE_HIT_POSE_S, TARDIGRADE_DEFEAT_S, LEAVE_S, DEFEAT_DRIFT, SPAWN_R]).toEqual([0.25, 4, 2, 4, 30]);
    expect([SAUCER_TURN_RATE, TARDIGRADE_TURN_RATE, HIT_FEEDBACK_MIN_S, CLICK_AIM_DEPTH, NOSE_OFFSET])
      .toEqual([3, 1.5, 0.25, 80, 1.3]);
    expect([MAX_SAUCERS, MAX_TARDIGRADES, BOLT_POOL, NEST_RUMOUR_R, TOW_PAST_BUOY]).toEqual([5, 1, 48, 400, 8]);
  });
  it("sizes the monster slots for the biggest wave", () => {
    for (const w of [...WAVES, ...WAVES_LOW_PERF]) {
      expect(w.saucers).toBeLessThanOrEqual(MAX_SAUCERS);
      expect(w.tardigrades).toBeLessThanOrEqual(MAX_TARDIGRADES);
    }
  });
});

describe("hull", () => {
  it("starts full with no hit on record", () => {
    expect(createHull()).toEqual({ hp: 100, lastHitAt: -Infinity });
  });
  it("hull: 6 per bolt, breach reported once at 0, then restored to 60", () => {
    const h = createHull();
    for (let i = 0; i < 16; i++) expect(damageHull(h, 6, i)).toBe(false); // hp 4
    expect(h.hp).toBe(4);
    expect(damageHull(h, 6, 16)).toBe(true); expect(h.hp).toBe(0);
    expect(damageHull(h, 6, 16.1)).toBe(false); expect(h.hp).toBe(0);
    restoreAfterBreach(h, 17); expect(h.hp).toBe(60); expect(h.lastHitAt).toBe(17);
  });
  it("hull regenerates 6/s only 4 s after the last hit, up to 100", () => {
    const h = createHull(); damageHull(h, 30, 0);
    regenHull(h, 1, 3.9); expect(h.hp).toBe(70);
    regenHull(h, 1, 4.0); expect(h.hp).toBe(76);
    regenHull(h, 10, 20); expect(h.hp).toBe(100);
  });
  it("a hit restarts the regen delay", () => {
    const h = createHull(); damageHull(h, 30, 0);
    regenHull(h, 1, 5); expect(h.hp).toBe(76);
    damageHull(h, 6, 5); expect(h.hp).toBe(70);
    regenHull(h, 1, 8.9); expect(h.hp).toBe(70);
    regenHull(h, 1, 9); expect(h.hp).toBe(76);
  });
});

describe("bolts", () => {
  it("a segment through a sphere hits even when both ends are outside (no tunnelling)", () => {
    expect(segmentHitsSphere(-3.5, 0, 0, 3.5, 0, 0, 0, 0, 0, 1.8)).toBe(true);   // a 7 u step at 140 u/s, dt 0.05
    expect(segmentHitsSphere(-3.5, 2, 0, 3.5, 2, 0, 0, 0, 0, 1.8)).toBe(false);
    expect(segmentHitsSphere(-5, 0, 0, -2, 0, 0, 0, 0, 0, 1.8)).toBe(false);    // stops short
    expect(segmentHitsSphere(0.5, 0, 0, 9, 0, 0, 0, 0, 0, 1.8)).toBe(true);     // starts inside
  });
  it("a zero-length segment is a point test", () => {
    expect(segmentHitsSphere(1, 1, 0, 1, 1, 0, 0, 0, 0, 1.8)).toBe(true);
    expect(segmentHitsSphere(2, 2, 0, 2, 2, 0, 0, 0, 0, 1.8)).toBe(false);
  });
  it("a ship bolt lives for 160 u; the pool never grows", () => {
    const p = createBoltPool(2); const b = fireBolt(p, "ship", 0, 0, 0, 0, 0, 1, 140, 160, 1)!;
    for (let i = 0; i < 22; i++) stepBolts(p, 0.05); expect(b.live).toBe(true);   // 154 u
    expect(b.z).toBeCloseTo(154, 9); expect(b.pz).toBeCloseTo(147, 9);
    stepBolts(p, 0.05); expect(b.live).toBe(false);                               // 161 u
    fireBolt(p, "enemy", 0, 0, 0, 1, 0, 0, 48, 120, 6); fireBolt(p, "enemy", 0, 0, 0, 1, 0, 0, 48, 120, 6);
    expect(fireBolt(p, "enemy", 0, 0, 0, 1, 0, 0, 48, 120, 6)).toBeNull(); expect(p.bolts).toHaveLength(2);
  });
  it("the default pool is BOLT_POOL long and reuses its objects", () => {
    const p = createBoltPool();
    expect(p.bolts).toHaveLength(BOLT_POOL);
    expect(p.bolts.every((b) => !b.live)).toBe(true);
    const first = p.bolts[0];
    const b = fireBolt(p, "ship", 1, 2, 3, 0, 0, 2, 140, 160, 1)!;
    expect(b).toBe(first);
    expect([b.x, b.y, b.z, b.px, b.py, b.pz]).toEqual([1, 2, 3, 1, 2, 3]);
    expect([b.dx, b.dy, b.dz]).toEqual([0, 0, 1]); // normalised
    expect([b.owner, b.speed, b.left, b.damage]).toEqual(["ship", 140, 160, 1]);
  });
  it("clears by owner, or all", () => {
    const p = createBoltPool(4);
    fireBolt(p, "ship", 0, 0, 0, 0, 0, 1, 140, 160, 1);
    fireBolt(p, "enemy", 0, 0, 0, 0, 0, 1, 48, 120, 6);
    fireBolt(p, "enemy", 0, 0, 0, 0, 0, 1, 48, 120, 6);
    clearBolts(p, "enemy");
    expect(p.bolts.filter((b) => b.live).map((b) => b.owner)).toEqual(["ship"]);
    clearBolts(p);
    expect(p.bolts.some((b) => b.live)).toBe(false);
  });
  it("a dead bolt does not move", () => {
    const p = createBoltPool(1);
    const b = fireBolt(p, "ship", 0, 0, 0, 0, 0, 1, 140, 160, 1)!;
    clearBolts(p);
    stepBolts(p, 0.05);
    expect(b.z).toBe(0);
  });
});

describe("aim", () => {
  const origin = v(0, 0, 0);
  const nose = v(0, 0, 1);
  it("aim assist locks the nearest live target inside 12° and 160 u, else flies straight", () => {
    const out = v(9, 9, 9);
    const t10 = target(10, 50);
    expect(aimAssist(origin, nose, [t10], out)).toBe(0);
    expect(len(out)).toBeCloseTo(1, 12);
    expect(angle(out, t10)).toBeCloseTo(0, 9);

    expect(aimAssist(origin, nose, [target(13, 50)], out)).toBe(-1);
    expect(out).toEqual({ x: 0, y: 0, z: 1 });
    expect(aimAssist(origin, nose, [target(5, 50, false)], out)).toBe(-1);
    expect(aimAssist(origin, nose, [target(0, 170)], out)).toBe(-1);
    expect(aimAssist(origin, nose, [], out)).toBe(-1);

    // two in the cone → the nearer one's index; out is unit
    const ts = [target(13, 20), target(3, 100), target(8, 50), target(1, 30, false)];
    expect(aimAssist(origin, nose, ts, out)).toBe(2);
    expect(len(out)).toBeCloseTo(1, 12);
    expect(angle(out, ts[2])).toBeCloseTo(0, 9);
  });
  it("aim assist works from any origin and returns a unit nose when nothing locks", () => {
    const out = v(0, 0, 0);
    const o = v(10, -5, 3);
    const rel = target(6, 80);
    const t = { ...rel, x: o.x + rel.x, y: o.y + rel.y, z: o.z + rel.z };
    expect(aimAssist(o, v(0, 0, 4), [t], out)).toBe(0);
    expect(aimAssist(o, v(0, 4, 0), [t], out)).toBe(-1);
    expect(out).toEqual({ x: 0, y: 1, z: 0 });
  });
  it("lead aim meets a crossing target; falls back to direct when it cannot", () => {
    const out = v(0, 0, 0);
    const tgt = v(0, 0, 40); const vel = v(20, 0, 0); const s = 48;
    leadAim(origin, tgt, vel, s, out);
    expect(len(out)).toBeCloseTo(1, 12);
    const t = Math.sqrt(1600 / (s * s - 400)); // |d + v t| = s t with d ⟂ v
    const miss = Math.hypot(out.x * s * t - (tgt.x + vel.x * t), out.y * s * t - tgt.y, out.z * s * t - tgt.z);
    expect(miss).toBeLessThan(1e-6);
    expect(out.x).toBeGreaterThan(0); // leads in the direction of travel

    // target 40 u away receding at 60 u/s: no intercept at 48 u/s
    const r = leadAim(origin, tgt, v(0, 0, 60), s, out);
    expect(r).toBe(out);
    expect(out.x).toBeCloseTo(0, 12); expect(out.y).toBeCloseTo(0, 12); expect(out.z).toBeCloseTo(1, 12);
  });
  it("lead aim from an offset origin, and a still target is aimed at directly", () => {
    const out = v(0, 0, 0);
    leadAim(v(5, 5, 5), v(5, 5, 25), v(0, 0, 0), 48, out);
    expect(out.x).toBeCloseTo(0, 12); expect(out.y).toBeCloseTo(0, 12); expect(out.z).toBeCloseTo(1, 12);
    // target closing head-on at the bolt speed (the linear case): still an intercept
    leadAim(v(0, 0, 0), v(0, 0, 40), v(0, 0, -48), 48, out);
    expect(out.z).toBeCloseTo(1, 12);
  });
  it("spread stays within ±2°", () => {
    const rnd = mulberry32(7);
    const d0 = v(1, 2, 3); const l = len(d0);
    const dir = v(d0.x / l, d0.y / l, d0.z / l);
    const out = v(0, 0, 0);
    let maxA = 0;
    for (let i = 0; i < 1000; i++) {
      spreadDir(dir, SAUCER_SPREAD_RAD, rnd, out);
      expect(len(out)).toBeCloseTo(1, 12);
      const a = angle(out, dir);
      expect(a).toBeLessThanOrEqual(2 * DEG + 1e-9);
      maxA = Math.max(maxA, a);
    }
    expect(maxA).toBeGreaterThan(1.5 * DEG); // it really spreads
  });
  it("spread may write into its own input", () => {
    const rnd = mulberry32(3);
    const d = v(0, 1, 0);
    const r = spreadDir(d, SAUCER_SPREAD_RAD, rnd, d);
    expect(r).toBe(d);
    expect(len(d)).toBeCloseTo(1, 12);
    expect(angle(d, v(0, 1, 0))).toBeLessThanOrEqual(2 * DEG + 1e-9);
  });
  it("a click aims 80 u past the ship along the camera ray", () => {
    expect(clickAimPoint({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: -80 });
    const out = v(0, 0, 0);
    clickAimPoint(v(0, 3, 4), v(0, -3, -4), v(0, 0, 0), out); // ship 5 u from the camera, ray not unit
    expect(out.x).toBeCloseTo(0, 12); expect(out.y).toBeCloseTo(-3 * 85 / 5 + 3, 9); expect(out.z).toBeCloseTo(-4 * 85 / 5 + 4, 9);
  });
});

describe("controls", () => {
  it.each([[109.9, false, "fire", "fire", "FIRE"], [110, false, "fire", "fire", "FIRE"], [110.1, false, "spark", "beam", "BEAM"],
    [50, true, "spark", "beam", "BEAM"]])("controls at %f u, racing %s", (d, racing, click, beam, label) => {
    const a = inNestArea(d as number, racing as boolean);
    expect([clickUse(a), beamUse(a), beamLabel(a)]).toEqual([click, beam, label]);
  });
});
