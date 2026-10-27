import { describe, it, expect } from "vitest";
import {
  BOLT_SPEED, BOLT_RANGE, ENEMY_BOLT_DAMAGE, ENEMY_BOLT_RANGE, ENEMY_BOLT_SPEED, HULL_AFTER_BREACH, JET_DPS,
  LEAVE_S, NEST_LEASH_R, NEST_REST_S, NOSE_OFFSET, SAUCER_HITS, SLEEP_GROW_S, SPAWN_CONE_RAD, SPAWN_MAX_R, WAVE_GAP_S,
  STRIKE_RING,
} from "../src/utils/combat/constants";
import type { ClickShot, NestSink, V3 } from "../src/utils/combat/types";
import { fireBolt, type Bolt } from "../src/utils/combat/bolts";
import { clickAimPoint, leadAim } from "../src/utils/combat/aim";
import { hitSaucer } from "../src/utils/combat/saucerAi";
import {
  contactCount, createNest, createNestEvents, debugClearAll, debugClearWave, debugFormation, debugStartWave, endFight,
  frontSpawn, resetNestEvents, stepNest, type NestEvents, type NestInput, type NestState,
} from "../src/utils/combat/nest";
import { monstersOnShow } from "../src/utils/combat/renderPose";
import { mulberry32 } from "../src/utils/mulberry32";

const DT = 1 / 60;
const EPS = 1e-9;
const DEG = Math.PI / 180;
const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
const dist = (a: V3, b: V3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const angle = (a: V3, b: V3) => {
  const d = (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
  return Math.acos(Math.min(1, Math.max(-1, d)));
};

const unit = (a: V3) => { const l = Math.hypot(a.x, a.y, a.z); return v(a.x / l, a.y / l, a.z / l); };
/** A bolt's unit direction equals `want` (unit) to 1e-9 per component. */
const expectDir = (b: { dx: number; dy: number; dz: number }, want: V3) => {
  expect(b.dx).toBeCloseTo(want.x, 9); expect(b.dy).toBeCloseTo(want.y, 9); expect(b.dz).toBeCloseTo(want.z, 9);
};

/** A click at `point`, seen from a camera at `cam` (the ray runs from the camera through the point). */
const clickAt = (point: V3, cam: V3): ClickShot => ({
  x: point.x, y: point.y, z: point.z, ox: cam.x, oy: cam.y, oz: cam.z,
  dx: point.x - cam.x, dy: point.y - cam.y, dz: point.z - cam.z,
});

/** The test Nest's centre: off the origin so nothing passes by accident. */
const C: V3 = v(40, -20, 10);

/** The sleepers' offsets from the centre: 22 u out, 120° apart round Y (the test's own; the scene's are NEST_SLEEPERS). */
const SLEEPERS: V3[] = [v(0, 0, 22), v(19.05, 0, -11), v(-19.05, 0, -11)];
const home = (i: number): V3 => v(C.x + SLEEPERS[i].x, C.y + SLEEPERS[i].y, C.z + SLEEPERS[i].z);

/** The test sink: the muzzle is the saucer's position, the mouth 3.5 u ahead of the tardigrade. */
const sink: NestSink = {
  muzzle: (s, o) => { o.x = s.x; o.y = s.y; o.z = s.z; return o; },
  mouth: (t, o) => { o.x = t.x + t.fx * 3.5; o.y = t.y + t.fy * 3.5; o.z = t.z + t.fz * 3.5; return o; },
};

interface Tally {
  entered: number; waveStarted: number[]; cleared: number; breached: number; ended: number;
  feedback: number; shots: number; defeats: number;
}

/** A Nest, its events and an input with the ship on the +X line through the centre, nose at the centre. */
function setup(d = 200) {
  const n = createNest();
  const ev = createNestEvents();
  const inp: NestInput = {
    ship: v(C.x + d, C.y, C.z), shipVel: v(0, 0, 0), nose: v(-1, 0, 0), centre: C,
    racing: false, paused: false, lowPerf: false, warm: true, fireHeld: false, click: null, sleepers: SLEEPERS,
  };
  const rnd = mulberry32(3);
  /** Puts the ship `d` u from the centre on the +X line (negative: the −X side). */
  const at = (dd: number) => { inp.ship.x = C.x + dd; inp.ship.y = C.y; inp.ship.z = C.z; };
  const step = (dt = DT): NestEvents => { resetNestEvents(ev); stepNest(n, inp, dt, rnd, sink, ev); return ev; };
  const run = (seconds: number, dt = DT, each?: (e: NestEvents) => void): Tally => {
    const t: Tally = { entered: 0, waveStarted: [], cleared: 0, breached: 0, ended: 0, feedback: 0, shots: 0, defeats: 0 };
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      const e = step(dt);
      if (e.entered) t.entered++;
      if (e.waveStarted) t.waveStarted.push(e.waveStarted);
      if (e.cleared) t.cleared++;
      if (e.breached) t.breached++;
      if (e.ended) t.ended++;
      if (e.feedback) t.feedback++;
      t.shots += e.shots; t.defeats += e.defeats;
      each?.(e);
    }
    return t;
  };
  /** Crosses 75 → 69 (one step each) and waits out the 3 s countdown: wave 1 is live. */
  const startFight = () => { at(75); step(); at(69); step(); run(3); };
  return { n, ev, inp, rnd, at, step, run, startFight };
}

const aliveSaucers = (n: NestState) => n.saucers.filter((s) => s.alive).length;
const aliveTardigrades = (n: NestState) => n.tardigrades.filter((t) => t.alive).length;
const liveBolts = (n: NestState, owner: "ship" | "enemy") => n.bolts.bolts.filter((b) => b.live && b.owner === owner);

describe("the Nest: starting a fight", () => {
  it("starts a fight only on an inward crossing of 70 u while ready", () => {
    const { n, at, step } = setup();
    at(75);
    expect(step().entered).toBe(false);
    expect(n.phase).toBe("ready");
    at(69);
    expect(step().entered).toBe(true);
    expect(n.phase).toBe("countdown");
    expect(n.wave).toBe(0);
    at(60);
    expect(step().entered).toBe(false); // already inside
    at(75);
    expect(step().entered).toBe(false); // outward
    expect(n.phase).toBe("countdown");
  });

  it("a crossing at warp or by a jump counts once (Review Focus 1)", () => {
    const warp = setup();
    let enteredSteps = 0;
    const steps = Math.round(100 / (39 * DT));
    for (let i = 0; i <= steps; i++) {
      warp.at(100 - 39 * DT * i);
      if (warp.step().entered) enteredSteps++;
    }
    expect(enteredSteps).toBe(1);
    expect(warp.n.phase).toBe("countdown");

    const jump = setup();
    jump.at(300);
    expect(jump.step().entered).toBe(false);
    jump.at(20);
    expect(jump.step().entered).toBe(true);
    expect(jump.n.phase).toBe("countdown");
    expect(jump.run(1).entered).toBe(0);
  });

  it("does nothing while racing: no entry, no fight", () => {
    const { n, inp, at, step } = setup();
    inp.racing = true;
    at(75); step(); at(60);
    const e = step();
    expect(e.entered).toBe(false);
    expect(e.inArea).toBe(false);
    expect(n.phase).toBe("ready");
    inp.racing = false;
    expect(step().entered).toBe(false); // already inside when the race ended: no ambush
    expect(n.phase).toBe("ready");
  });

  it("wave 1 comes 3 s after the crossing, and not before the programs are warm", () => {
    const early = setup();
    early.at(75); early.step(); early.at(69); early.step();
    early.run(2.9);
    expect(early.n.phase).toBe("countdown");
    expect(contactCount(early.n)).toBe(0);
    const t = early.run(0.1);
    expect(t.waveStarted).toEqual([1]);
    expect(early.n.phase).toBe("fighting");

    const { n, inp, at, step, run } = setup();
    inp.warm = false;
    at(75); step(); at(69); step();
    expect(run(3.5).waveStarted).toEqual([]);
    expect(n.phase).toBe("countdown");
    expect(contactCount(n)).toBe(0);
    inp.warm = true;
    const e = step();
    expect(e.waveStarted).toBe(1);
    expect(n.phase).toBe("fighting");
    expect(n.wave).toBe(1);
    expect(contactCount(n)).toBe(3);
  });
});

describe("the Nest: waves", () => {
  it("waves of 3, 5, then 1 tardigrade + 3, each 5 s after the last defeat", () => {
    const { n, ev, step, run, startFight } = setup();
    startFight();
    expect([n.wave, aliveSaucers(n), aliveTardigrades(n)]).toEqual([1, 3, 0]);

    resetNestEvents(ev);
    debugClearWave(n, ev);
    expect(ev.defeats).toBe(3);
    expect(contactCount(n)).toBe(0);
    step();
    expect(n.phase).toBe("gap");
    expect(run(4.9).waveStarted).toEqual([]);
    expect(n.phase).toBe("gap");
    expect(run(0.1).waveStarted).toEqual([2]);
    expect([n.phase, n.wave, contactCount(n), aliveSaucers(n)]).toEqual(["fighting", 2, 5, 5]);
    expect(new Set(n.saucers.map((s) => s.seed)).size).toBe(5);

    debugClearWave(n, ev);
    step();
    expect(n.phase).toBe("gap");
    expect(run(5).waveStarted).toEqual([3]);
    expect([n.wave, aliveSaucers(n), aliveTardigrades(n)]).toEqual([3, 3, 1]);
  });

  it("low-perf waves of 2, 3, then 1 tardigrade + 2", () => {
    const { n, ev, inp, step, run, startFight } = setup();
    inp.lowPerf = true;
    startFight();
    expect([n.wave, aliveSaucers(n), aliveTardigrades(n)]).toEqual([1, 2, 0]);
    debugClearWave(n, ev); step(); run(5);
    expect([n.wave, aliveSaucers(n), aliveTardigrades(n)]).toEqual([2, 3, 0]);
    debugClearWave(n, ev); step(); run(5);
    expect([n.wave, aliveSaucers(n), aliveTardigrades(n)]).toEqual([3, 2, 1]);
  });

  it("a low-perf flip mid-wave keeps the wave and sizes the next (Review Focus 4)", () => {
    const { n, ev, inp, step, run, startFight } = setup();
    startFight();
    debugClearWave(n, ev); step(); run(5);
    expect([n.wave, contactCount(n)]).toEqual([2, 5]);
    inp.lowPerf = true;
    run(0.5);
    expect([n.wave, contactCount(n)]).toEqual([2, 5]);
    debugClearWave(n, ev); step(); run(5);
    expect([n.wave, aliveSaucers(n), aliveTardigrades(n)]).toEqual([3, 2, 1]);
  });

  it("a wave reuses dying slots, so wave 2 is never short (C1)", () => {
    const { n, ev, step, run, startFight } = setup();
    startFight();
    debugClearWave(n, ev); step();
    // The defeated saucers drift for 3 s and shrink for 2 s: some may still be fading when wave 2 comes.
    run(5);
    expect(aliveSaucers(n)).toBe(5);
    expect(n.saucers).toHaveLength(5);
  });

  it("clearing wave 3 reports cleared once, rests 2 minutes, then needs a fresh crossing", () => {
    const { n, ev, at, step, run, startFight } = setup();
    startFight();
    debugClearAll(n, ev);
    expect([n.wave, n.phase, contactCount(n)]).toEqual([3, "fighting", 0]);
    const e = step();
    expect(e.cleared).toBe(true);
    expect([n.phase, n.wave]).toEqual(["rest", 0]);
    expect(run(1).cleared).toBe(0);

    // Re-cross during the rest: the HUD hears it, but no countdown.
    at(80); step(); at(69);
    expect(step().entered).toBe(true);
    expect(n.phase).toBe("rest");
    // 1 s + 2 steps of rest so far: 118.8 s more is 119.83 s, then 0.2 s passes 120 s.
    expect(run(118.8).waveStarted).toEqual([]);
    expect(n.phase).toBe("rest");
    run(0.2);
    expect(n.phase).toBe("ready");
    // Still inside after the rest: never attacked again.
    const t = run(10);
    expect([t.entered, t.waveStarted.length, t.cleared]).toEqual([0, 0, 0]);
    expect([n.phase, contactCount(n)]).toEqual(["ready", 0]);
    // Out and back in: a new fight.
    at(80); step(); at(69);
    expect(step().entered).toBe(true);
    expect(n.phase).toBe("countdown");
  });
});

describe("the Nest: leaving", () => {
  it("20 s out ends the fight; coming back resets the timer", () => {
    const { n, at, step, run, startFight } = setup();
    startFight();
    at(111);
    expect(run(19.9).ended).toBe(0);
    expect(n.phase).toBe("fighting");
    at(100);
    step();
    expect(n.outFor).toBe(0);
    expect(n.phase).toBe("fighting");
    at(111);
    const wasAlive = n.saucers.filter((s) => s.alive);
    expect(wasAlive).toHaveLength(3);
    expect(run(19.9).ended).toBe(0);
    expect(run(0.1).ended).toBe(1);
    expect([n.wave, n.phase, n.outFor, contactCount(n)]).toEqual([0, "ready", 0, 0]);
    for (const s of wasAlive) expect(s.phase).toBe("leaving");
    expect(liveBolts(n, "enemy")).toHaveLength(0);
    // They shrink away over 2 s; then, every slot gone and the ship within 200 u, fresh sleepers are placed.
    const goneSeen = new Set<number>();
    run(2.1, DT, () => wasAlive.forEach((s, i) => { if (s.phase === "gone") goneSeen.add(i); }));
    expect(goneSeen.size).toBe(3);
    for (const s of wasAlive) expect(s.phase).toBe("asleep");
    // Back in: a fresh fight from wave 1.
    at(75); step(); at(69);
    expect(step().entered).toBe(true);
    expect(n.phase).toBe("countdown");
    expect(run(3).waveStarted).toEqual([1]);
  });

  it("endFight sends the live monsters away and resets to ready", () => {
    const { n, ev, step, startFight } = setup();
    startFight();
    debugClearWave(n, ev); step(); // gap
    n.outFor = 7;
    endFight(n);
    expect([n.wave, n.phase, n.outFor]).toEqual([0, "ready", 0]);
    fireBolt(n.bolts, "enemy", 0, 0, 0, 1, 0, 0, ENEMY_BOLT_SPEED, ENEMY_BOLT_RANGE, ENEMY_BOLT_DAMAGE);
    fireBolt(n.bolts, "ship", 0, 0, 0, 1, 0, 0, BOLT_SPEED, BOLT_RANGE, 1);
    endFight(n);
    expect(liveBolts(n, "enemy")).toHaveLength(0);
    expect(liveBolts(n, "ship")).toHaveLength(1); // the ship's own bolts fly on
  });

  it("monsters never pass the leash in a full wave 3", () => {
    const { n, inp, rnd, ev, step } = setup();
    const R = 105, W = 8 / R; // circling at 8 u/s, slow enough for the saucers to keep station
    inp.ship.x = C.x + R;
    debugStartWave(n, 3, inp, rnd, ev);
    let maxD = 0;
    const steps = Math.round(60 / DT);
    for (let i = 1; i <= steps; i++) {
      const a = W * i * DT;
      inp.ship.x = C.x + R * Math.cos(a); inp.ship.y = C.y; inp.ship.z = C.z + R * Math.sin(a);
      inp.shipVel.x = -R * W * Math.sin(a); inp.shipVel.y = 0; inp.shipVel.z = R * W * Math.cos(a);
      n.hull.hp = 100; // no breach: this test is about the leash
      step();
      for (const m of [...n.saucers, ...n.tardigrades]) {
        if (m.phase === "gone") continue;
        const d = dist(m, C);
        expect(d).toBeLessThanOrEqual(NEST_LEASH_R + EPS);
        maxD = Math.max(maxD, d);
      }
    }
    expect([n.wave, n.phase, contactCount(n)]).toEqual([3, "fighting", 4]);
    expect(maxD).toBeGreaterThan(100); // they did press on the edge
  });
});

describe("the Nest: the plasma gun", () => {
  it("fires 5 bolts a second, held or clicked, only inside the fighting area", () => {
    const held = setup(100);
    held.inp.fireHeld = true;
    expect(held.step().shots).toBe(1);
    const first = liveBolts(held.n, "ship")[0];
    expect([first.owner, first.speed, first.left, first.damage]).toEqual(["ship", BOLT_SPEED, BOLT_RANGE, 1]);
    expect([first.dx, first.dy, first.dz]).toEqual([-1, 0, 0]); // no monsters: straight down the nose
    expect([first.x, first.y, first.z]).toEqual([held.inp.ship.x - NOSE_OFFSET, C.y, C.z]); // from the nose
    expect(held.run(59 / 60).shots).toBe(4); // 5 in the first second
    expect(liveBolts(held.n, "ship")).toHaveLength(5);

    const out = setup(111);
    out.inp.fireHeld = true;
    expect(out.run(1).shots).toBe(0);
    expect(liveBolts(out.n, "ship")).toHaveLength(0);

    const racing = setup(100);
    racing.inp.fireHeld = true; racing.inp.racing = true;
    expect(racing.run(1).shots).toBe(0);

    const clicks = setup(100);
    const aimPoint = v(C.x, C.y + 40, C.z);
    const aim = clickAt(aimPoint, v(clicks.inp.ship.x + 10, C.y + 3, C.z));
    let shots = 0;
    for (let i = 0; i < 60; i++) {
      clicks.inp.click = i % 3 === 0 ? aim : null; // 20 clicks in 1 s
      shots += clicks.step().shots;
    }
    expect(shots).toBe(5);
    const b = liveBolts(clicks.n, "ship").reduce((a, c) => (c.left > a.left ? c : a));
    const origin = v(clicks.inp.ship.x - NOSE_OFFSET, C.y, C.z);
    expectDir(b, unit(v(aimPoint.x - origin.x, aimPoint.y - origin.y, aimPoint.z - origin.z)));
  });

  it("three ship bolts defeat a saucer even at dt 0.05 (Review Focus 3)", () => {
    const { n, ev, inp, rnd, run } = setup(100);
    debugStartWave(n, 1, inp, rnd, ev);
    n.frozen = true;
    const ship = inp.ship;
    const [s, a, b] = n.saucers;
    // 33 u ahead: bolt points at 1.3 + 7k u never land within 2.9 u of it; only the swept segment hits.
    s.x = ship.x - 33; s.y = ship.y; s.z = ship.z;
    a.x = ship.x; a.y = ship.y + 60; a.z = ship.z;
    b.x = ship.x; b.y = ship.y - 60; b.z = ship.z;
    const before = contactCount(n);
    inp.fireHeld = true;
    const t1 = run(0.45, 0.05); // fires at steps 1, 5, 9
    expect(t1.shots).toBe(3);
    inp.fireHeld = false;
    const t2 = run(1, 0.05);
    expect(s.alive).toBe(false);
    expect(s.phase).toBe("defeated");
    expect(contactCount(n)).toBe(before - 1);
    expect(t1.defeats + t2.defeats).toBe(1);
    expect(liveBolts(n, "ship")).toHaveLength(0); // all three were spent on it
  });

  it("a bolt whose last, range-ending step passes through a monster still hits; it stops at its range", () => {
    const { n, ev, inp, rnd, step } = setup(100);
    debugStartWave(n, 1, inp, rnd, ev);
    n.frozen = true;
    const ship = inp.ship;
    const [s, a, b] = n.saucers;
    s.x = ship.x - 33; s.y = ship.y; s.z = ship.z;
    a.x = ship.x; a.y = ship.y + 60; a.z = ship.z;
    b.x = ship.x; b.y = ship.y - 60; b.z = ship.z;
    // 4 u of range left at 30 u ahead: the last step (4 u of a 7 u step at dt 0.05) ends at 34 u, past the saucer.
    fireBolt(n.bolts, "ship", ship.x - 30, ship.y, ship.z, -1, 0, 0, BOLT_SPEED, 4, 1);
    step(0.05);
    expect(s.hp).toBe(2);
    expect(liveBolts(n, "ship")).toHaveLength(0);

    // A bolt that would reach the saucer only by overshooting its range misses (3.1 u short of it, past 2.6 + 0.3).
    s.x = ship.x - 37.1;
    const bolt: Bolt = fireBolt(n.bolts, "ship", ship.x - 30, ship.y, ship.z, -1, 0, 0, BOLT_SPEED, 4, 1)!;
    step(0.05);
    expect(bolt.live).toBe(false);
    expect(bolt.x).toBeCloseTo(ship.x - 34, 9);
    expect(s.hp).toBe(2);
  });

  it("a tardigrade takes ship bolts on its larger radius", () => {
    const { n, ev, inp, rnd, step } = setup(100);
    debugStartWave(n, 3, inp, rnd, ev);
    n.frozen = true;
    const ship = inp.ship;
    for (const s of n.saucers) { s.x = ship.x; s.y = ship.y + 60; s.z = ship.z; }
    const t = n.tardigrades[0];
    // 3.6 u off the bolt's line: inside 4.5 + 0.3, outside a saucer's 2.6 + 0.3.
    t.x = ship.x - 40; t.y = ship.y + 3.6; t.z = ship.z;
    fireBolt(n.bolts, "ship", ship.x - 30, ship.y, ship.z, -1, 0, 0, BOLT_SPEED, BOLT_RANGE, 1);
    step(0.05); step(0.05);
    expect(t.hp).toBe(17);
  });
});

describe("the Nest: the hull", () => {
  it("several hits in one step breach once, restore 60 and end the fight (Review Focus 5)", () => {
    const { n, inp, step, run, startFight } = setup();
    startFight();
    const ship = inp.ship;
    const live = n.saucers.filter((s) => s.alive);
    n.hull.hp = 7;
    for (const dz of [1, -1, 1.2]) {
      fireBolt(n.bolts, "enemy", ship.x, ship.y, ship.z + dz, 0, 0, -Math.sign(dz),
        ENEMY_BOLT_SPEED, ENEMY_BOLT_RANGE, ENEMY_BOLT_DAMAGE);
    }
    const e = step();
    expect(e.breached).toBe(true);
    expect(e.feedback).toBe(true);
    expect(n.hull.hp).toBe(HULL_AFTER_BREACH);
    expect([n.wave, n.phase, contactCount(n)]).toEqual([0, "ready", 0]);
    for (const s of live) expect(s.phase).toBe("leaving");
    expect(liveBolts(n, "enemy")).toHaveLength(0);
    // No second breach; the restore holds (regen waits 4 s again).
    const t = run(1);
    expect(t.breached).toBe(0);
    expect(n.hull.hp).toBe(HULL_AFTER_BREACH);
  });

  it("a bolt plus the jet in one step also breach once", () => {
    const { n, inp, rnd, ev, step } = setup(100);
    debugStartWave(n, 3, inp, rnd, ev);
    const ship = inp.ship;
    for (const s of n.saucers) { hitSaucer(s); hitSaucer(s); hitSaucer(s); }
    const t = n.tardigrades[0];
    t.phase = "jet"; t.phaseT = 0;
    t.x = ship.x - 30; t.y = ship.y; t.z = ship.z;
    t.jx = ship.x - 26; t.jy = ship.y; t.jz = ship.z; t.jdx = 1; t.jdy = 0; t.jdz = 0;
    n.hull.hp = 4;
    fireBolt(n.bolts, "enemy", ship.x, ship.y + 1, ship.z, 0, -1, 0, ENEMY_BOLT_SPEED, ENEMY_BOLT_RANGE, ENEMY_BOLT_DAMAGE);
    const e = step();
    expect(e.breached).toBe(true);
    expect(n.hull.hp).toBe(HULL_AFTER_BREACH);
    expect([n.wave, n.phase]).toEqual([0, "ready"]);
    expect(t.phase).toBe("leaving");
  });

  it("hit feedback at most every 0.25 s; jet damage is not throttled", () => {
    const { n, inp, rnd, ev, run } = setup(100);
    debugStartWave(n, 3, inp, rnd, ev);
    const ship = inp.ship;
    for (const s of n.saucers) { hitSaucer(s); hitSaucer(s); hitSaucer(s); }
    const t = n.tardigrades[0];
    t.phase = "jet"; t.phaseT = 0;
    t.x = ship.x - 30; t.y = ship.y; t.z = ship.z;
    t.jx = ship.x - 26; t.jy = ship.y; t.jz = ship.z; t.jdx = 1; t.jdy = 0; t.jdz = 0;
    const tally = run(1.3);
    expect(t.phase).toBe("swim"); // the jet ran its 1.2 s
    expect(100 - n.hull.hp).toBeCloseTo(JET_DPS * 1.2, 0);
    expect(Math.abs(100 - n.hull.hp - 30)).toBeLessThanOrEqual(0.5);
    expect(tally.feedback).toBeGreaterThanOrEqual(4);
    expect(tally.feedback).toBeLessThanOrEqual(5);
  });

  it("an enemy bolt that crosses a moving ship's path mid-step hits it (dt 0.05), and the hull regenerates after 4 s", () => {
    const { n, inp, step, run, startFight } = setup();
    startFight();
    n.frozen = true;
    // The ship flies +X at 39 u/s: 1.95 u this step. The bolt crosses its start point going +Y (2.4 u).
    const p0 = v(inp.ship.x, inp.ship.y, inp.ship.z);
    inp.shipVel.x = 39;
    inp.ship.x = p0.x + 39 * 0.05;
    fireBolt(n.bolts, "enemy", p0.x, p0.y - 1.2, p0.z, 0, 1, 0, ENEMY_BOLT_SPEED, ENEMY_BOLT_RANGE, ENEMY_BOLT_DAMAGE);
    // Both of the bolt's end points, and its whole segment, stay > 1.7 u from where the ship ends the step;
    // in the ship's frame the bolt passes 0.975 u from it.
    step(0.05);
    expect(n.hull.hp).toBe(100 - ENEMY_BOLT_DAMAGE);
    expect(liveBolts(n, "enemy")).toHaveLength(0);
    inp.shipVel.x = 0;
    run(3.9, 0.05);
    expect(n.hull.hp).toBe(100 - ENEMY_BOLT_DAMAGE);
    run(0.5, 0.05);
    expect(n.hull.hp).toBeGreaterThan(100 - ENEMY_BOLT_DAMAGE);
  });
});

describe("the Nest: no damage outside the fighting area or while racing (C15)", () => {
  /** An enemy bolt 1 u above the ship, flying down through it. */
  const boltAtShip = (n: NestState, ship: V3) =>
    fireBolt(n.bolts, "enemy", ship.x, ship.y + 1, ship.z, 0, -1, 0, ENEMY_BOLT_SPEED, ENEMY_BOLT_RANGE, ENEMY_BOLT_DAMAGE)!;

  it("an enemy bolt through the ship outside the fighting area does no damage and flies on", () => {
    const { n, inp, at, step, startFight } = setup();
    startFight();
    n.frozen = true;
    at(NEST_LEASH_R + 5);
    const b = boltAtShip(n, inp.ship);
    const e = step();
    expect(e.inArea).toBe(false);
    expect(n.hull.hp).toBe(100);
    expect(e.feedback).toBe(false);
    expect(b.live).toBe(true);
    // The same bolt inside the area hits (the control).
    at(60);
    const b2 = boltAtShip(n, inp.ship);
    expect(step().inArea).toBe(true);
    expect(n.hull.hp).toBe(100 - ENEMY_BOLT_DAMAGE);
    expect(b2.live).toBe(false);
  });

  it("racing through the middle of the Nest, an enemy bolt does no damage", () => {
    const { n, inp, at, step, startFight } = setup();
    startFight();
    n.frozen = true;
    at(30);
    inp.racing = true;
    boltAtShip(n, inp.ship);
    const e = step();
    expect(e.inArea).toBe(false);
    expect(n.hull.hp).toBe(100);
  });

  it("the jet does no damage outside the fighting area", () => {
    const { n, inp, rnd, ev, at, run } = setup();
    at(NEST_LEASH_R + 5);
    debugStartWave(n, 3, inp, rnd, ev);
    for (const s of n.saucers) { hitSaucer(s); hitSaucer(s); hitSaucer(s); }
    const ship = inp.ship;
    const t = n.tardigrades[0];
    t.phase = "jet"; t.phaseT = 0;
    t.x = ship.x - 30; t.y = ship.y; t.z = ship.z;
    t.jx = ship.x - 26; t.jy = ship.y; t.jz = ship.z; t.jdx = 1; t.jdy = 0; t.jdz = 0;
    const tally = run(0.5);
    expect(n.hull.hp).toBe(100);
    expect(tally.feedback).toBe(0);
  });
});

describe("the Nest: pause, debug and pools", () => {
  it("paused changes nothing (Review Focus 2)", () => {
    const { n, inp, run, step, startFight } = setup();
    startFight();
    inp.fireHeld = true;
    run(0.5);
    expect(liveBolts(n, "ship").length).toBeGreaterThan(0);
    const before = JSON.stringify(n);
    inp.paused = true;
    inp.click = clickAt(v(C.x, C.y + 30, C.z), v(inp.ship.x + 10, C.y + 3, C.z));
    for (let i = 0; i < 100; i++) {
      const e = step();
      expect(e).toEqual({
        entered: false, waveStarted: 0, cleared: false, breached: false, ended: false,
        feedback: false, shots: 0, defeats: 0, inArea: true,
      });
    }
    expect(JSON.stringify(n)).toBe(before);
    // Paused outside the area still reports it.
    inp.ship.x = C.x + 150;
    expect(step().inArea).toBe(false);
  });

  it("debug: clearAll then one step clears; formation freezes monsters ahead", () => {
    const a = setup(100);
    debugStartWave(a.n, 2, a.inp, a.rnd, a.ev);
    expect(a.ev.waveStarted).toBe(2);
    expect([a.n.wave, a.n.phase, contactCount(a.n)]).toEqual([2, "fighting", 5]);
    resetNestEvents(a.ev);
    debugClearAll(a.n, a.ev);
    expect(a.ev.defeats).toBe(5);
    expect([a.n.wave, a.n.phase, contactCount(a.n)]).toEqual([3, "fighting", 0]);
    expect(a.step().cleared).toBe(true);
    expect(a.n.phase).toBe("rest");

    const { n, ev, inp, rnd, run } = setup(100);
    debugStartWave(n, 3, inp, rnd, ev);
    debugFormation(n, inp.ship, inp.nose);
    expect(n.frozen).toBe(true);
    const ship = inp.ship;
    const saucers = n.saucers.filter((s) => s.alive);
    expect(saucers).toHaveLength(3);
    const ahead = saucers.map((s) => ship.x - s.x);
    for (const d of ahead) expect(d).toBeCloseTo(25, 9);
    const side = saucers.map((s) => s.z - ship.z).sort((p, q) => p - q);
    expect(side[1] - side[0]).toBeCloseTo(6, 9);
    expect(side[2] - side[1]).toBeCloseTo(6, 9);
    for (const s of saucers) expect(s.y).toBeCloseTo(ship.y, 9);
    const t = n.tardigrades[0];
    expect(dist(t, v(ship.x - 45, ship.y, ship.z))).toBeLessThan(1e-9);
    const snap = JSON.stringify([n.saucers, n.tardigrades]);
    const tally = run(3);
    expect(JSON.stringify([n.saucers, n.tardigrades])).toBe(snap); // frozen: nothing moves or attacks
    expect(liveBolts(n, "enemy")).toHaveLength(0);
    expect(tally.feedback).toBe(0);
  });

  it("allocates nothing per step: the pools keep their objects", () => {
    const { n, ev, inp, at, step, run, startFight } = setup();
    const saucers = n.saucers.slice(), tardigrades = n.tardigrades.slice(), bolts = n.bolts.bolts.slice();
    const targets = n.targets.slice(), hull = n.hull, strikes = n.strikes.slice();
    const poses = n.saucers.map((s) => s.pose);
    expect(saucers).toHaveLength(5);
    expect(tardigrades).toHaveLength(1);
    expect(bolts).toHaveLength(48);
    expect(targets).toEqual([...saucers, ...tardigrades]);

    startFight();
    inp.fireHeld = true;
    for (let w = 0; w < 3; w++) {
      run(4, DT, () => { n.hull.hp = 100; });
      debugClearWave(n, ev);
      step();
      if (w < 2) run(5);
    }
    run(1);
    at(80); step(); at(69); step(); run(3.5);
    inp.click = clickAt(v(C.x, C.y, C.z + 5), v(inp.ship.x + 10, C.y + 3, C.z));
    run(2, DT, () => { n.hull.hp = 100; });

    expect(n.saucers).toHaveLength(5);
    expect(n.tardigrades).toHaveLength(1);
    expect(n.bolts.bolts).toHaveLength(48);
    expect(n.targets).toHaveLength(6);
    n.saucers.forEach((s, i) => { expect(s).toBe(saucers[i]); expect(s.pose).toBe(poses[i]); });
    n.tardigrades.forEach((t, i) => expect(t).toBe(tardigrades[i]));
    n.bolts.bolts.forEach((b, i) => expect(b).toBe(bolts[i]));
    n.targets.forEach((t, i) => expect(t).toBe(targets[i]));
    expect(n.hull).toBe(hull);
    expect(n.strikeSeq).toBeGreaterThan(0);
    expect(n.strikes).toHaveLength(STRIKE_RING);
    n.strikes.forEach((k, i) => expect(k).toBe(strikes[i]));
  });
});

describe("the Nest: sleepers", () => {
  const ALL = 3;
  const sleepersOf = (n: NestState) => n.saucers.slice(0, ALL);

  it("appear in ready once warm and within 200 u, growing in over 1 s", () => {
    const { n, step, run } = setup(150);
    step();
    sleepersOf(n).forEach((s, i) => {
      expect([s.phase, s.alive]).toEqual(["asleep", false]);
      expect([s.x, s.y, s.z]).toEqual([home(i).x, home(i).y, home(i).z]);
      expect(s.scale).toBeCloseTo(DT / SLEEP_GROW_S, 9);
      // Facing out along the offset.
      const u = unit(SLEEPERS[i]);
      expect(s.fx).toBeCloseTo(u.x, 9); expect(s.fy).toBeCloseTo(u.y, 9); expect(s.fz).toBeCloseTo(u.z, 9);
    });
    expect([n.saucers[3].phase, n.saucers[4].phase]).toEqual(["gone", "gone"]);
    const t = n.tardigrades[0];
    expect([t.phase, t.alive, t.x, t.y, t.z, t.pose.curl]).toEqual(["asleep", false, C.x, C.y, C.z, 1]);
    // The offsets' mean is zero here: it faces +Y.
    expect([t.fx, t.fy, t.fz]).toEqual([0, 1, 0]);
    expect(t.scale).toBeCloseTo(DT / SLEEP_GROW_S, 9);
    expect(contactCount(n)).toBe(0);
    run(1);
    for (const s of sleepersOf(n)) expect(s.scale).toBe(1);
    expect(t.scale).toBe(1);

    const far = setup(250);
    far.run(1);
    expect(monstersOnShow(far.n)).toBe(false);
    for (const m of [...far.n.saucers, ...far.n.tardigrades]) expect(m.phase).toBe("gone");

    const cold = setup(150);
    cold.inp.warm = false;
    cold.run(1);
    for (const m of [...cold.n.saucers, ...cold.n.tardigrades]) expect(m.phase).toBe("gone");
  });

  it("are harmless and untargetable", () => {
    const { n, ev, inp, step, run } = setup(80);
    step();
    // 10 s in the area, outside the zone: nothing fires at the ship.
    run(10, DT, (e) => {
      expect(e.entered).toBe(false);
      expect(liveBolts(n, "enemy")).toHaveLength(0);
    });
    expect(n.hull.hp).toBe(100);
    expect(n.phase).toBe("ready");
    // Held fire with the nose on sleeper 0: no assist, the bolt goes straight down the nose.
    const s = n.saucers[0];
    inp.nose = v(s.x - inp.ship.x, s.y - inp.ship.y, s.z - inp.ship.z);
    inp.fireHeld = true;
    expect(step().shots).toBe(1);
    inp.fireHeld = false;
    expectDir(liveBolts(n, "ship")[0], unit(inp.nose));
    // A ship bolt fired straight through sleeper 0 flies on.
    for (const b of n.bolts.bolts) b.live = false;
    const b = fireBolt(n.bolts, "ship", s.x, s.y, s.z - 10, 0, 0, 1, BOLT_SPEED, BOLT_RANGE, 1)!;
    resetNestEvents(ev);
    const t = run(0.3);
    expect(b.live).toBe(true);
    expect(b.z).toBeGreaterThan(s.z + 20);
    expect(t.defeats).toBe(0);
    expect(s.hp).toBe(SAUCER_HITS);
    expect([s.phase, s.alive]).toEqual(["asleep", false]);
  });

  it("crossing wakes the saucers; they rise through the countdown and become wave 1 in place", () => {
    const { n, at, step, run } = setup(150);
    step(); run(1);
    at(75); step(); at(69); step();
    expect(n.phase).toBe("countdown");
    for (const s of sleepersOf(n)) expect([s.phase, s.alive]).toEqual(["waking", false]);
    expect(n.tardigrades[0].phase).toBe("asleep");
    const t = run(3, DT, (e) => { if (!e.waveStarted) expect(contactCount(n)).toBe(0); });
    expect(t.waveStarted).toEqual([1]);
    expect(aliveSaucers(n)).toBe(3);
    sleepersOf(n).forEach((s, i) => {
      expect([s.phase, s.alive]).toEqual(["idle", true]);
      expect(Math.abs(s.y - home(i).y - 6)).toBeLessThanOrEqual(0.2);
      expect(Math.abs(s.x - home(i).x)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(s.z - home(i).z)).toBeLessThanOrEqual(0.01);
    });
    expect([n.saucers[3].phase, n.saucers[4].phase]).toEqual(["gone", "gone"]);
    // The sleepers keep their tints (their seeds).
    expect(new Set(sleepersOf(n).map((s) => s.seed)).size).toBe(3);
  });

  it("the tardigrade sleeps through waves 1 and 2, then wakes in place at wave 3 and uncurls over 1 s", () => {
    const { n, ev, step, run, startFight } = setup(150);
    step(); run(1);
    startFight();
    const t = n.tardigrades[0];
    expect([n.wave, t.phase]).toEqual([1, "asleep"]);
    debugClearWave(n, ev); step();
    expect(run(WAVE_GAP_S).waveStarted).toEqual([2]);
    expect([t.phase, contactCount(n)]).toEqual(["asleep", 5]);
    debugClearWave(n, ev); step();
    expect(run(WAVE_GAP_S).waveStarted).toEqual([3]);
    expect([t.alive, t.phase, t.hp]).toEqual([true, "swim", 18]);
    expect(dist(t, C)).toBeLessThan(1e-9);
    expect(t.pose.curl).toBeCloseTo(1 - DT, 9);
    expect(contactCount(n)).toBe(4);
    const still = () => { if (t.pose.curl > 0) expect([t.vx, t.vy, t.vz]).toEqual([0, 0, 0]); };
    run(0.5, DT, still);
    expect(t.pose.curl).toBeCloseTo(0.5, 1);
    expect(dist(t, C)).toBeLessThan(1e-9);
    run(0.5, DT, still);
    expect(t.pose.curl).toBe(0);
  });

  it("a fight ended during the countdown sends the waking saucers away, then fresh sleepers grow back (Review Focus 2)", () => {
    const { n, at, step, run } = setup(150);
    step(); run(1);
    at(75); step(); at(69); step();
    const waking = sleepersOf(n);
    at(130); // outside the 110 u area, inside 200 u
    let everAlive = false;
    const t = run(20, DT, () => { if (n.saucers.some((s) => s.alive) || n.tardigrades.some((g) => g.alive)) everAlive = true; });
    expect(t.ended).toBe(1);
    expect(t.waveStarted).toEqual([]);
    expect(everAlive).toBe(false);
    expect(n.phase).toBe("ready");
    for (const s of waking) expect(s.phase).toBe("leaving");
    expect(n.tardigrades[0].phase).toBe("leaving");
    run(LEAVE_S + SLEEP_GROW_S + 0.1, DT, () => { if (n.saucers.some((s) => s.alive)) everAlive = true; });
    expect(everAlive).toBe(false);
    sleepersOf(n).forEach((s, i) => {
      expect([s.phase, s.scale]).toEqual(["asleep", 1]);
      expect(dist(s, home(i))).toBeLessThan(1e-9);
    });
    expect([n.tardigrades[0].phase, n.tardigrades[0].scale]).toEqual(["asleep", 1]);
  });

  it("are dropped beyond 220 u and come back within 200 u (Review Focus 3)", () => {
    const { n, at, step, run } = setup(150);
    step(); run(1);
    expect(monstersOnShow(n)).toBe(true);
    at(230); step();
    for (const m of [...n.saucers, ...n.tardigrades]) expect([m.phase, m.scale]).toEqual(["gone", 0]);
    expect(monstersOnShow(n)).toBe(false);
    at(210); step();
    for (const m of [...n.saucers, ...n.tardigrades]) expect(m.phase).toBe("gone");
    at(190); step();
    for (const s of sleepersOf(n)) expect(s.phase).toBe("asleep");
    expect(n.tardigrades[0].phase).toBe("asleep");
  });

  it("wave 1 keeps the tier's size if low-perf flips after they settle (Review Focus 4)", () => {
    const a = setup(150);
    a.step(); a.run(1);
    expect(sleepersOf(a.n).every((s) => s.phase === "asleep")).toBe(true);
    a.inp.lowPerf = true;
    a.startFight();
    expect(aliveSaucers(a.n)).toBe(2);
    expect([a.n.saucers[0].alive, a.n.saucers[1].alive]).toEqual([true, true]);
    expect(a.n.saucers[2].phase).toBe("leaving");

    const b = setup(150);
    b.inp.lowPerf = true;
    b.step(); b.run(1);
    expect(b.n.saucers.map((s) => s.phase)).toEqual(["asleep", "asleep", "gone", "gone", "gone"]);
    b.inp.lowPerf = false;
    b.startFight();
    expect(aliveSaucers(b.n)).toBe(3);
    for (const i of [0, 1]) {
      const s = b.n.saucers[i];
      expect(s.alive).toBe(true);
      expect(Math.abs(s.x - home(i).x)).toBeLessThanOrEqual(0.01);
      expect(Math.abs(s.z - home(i).z)).toBeLessThanOrEqual(0.01);
    }
    const extra = b.n.saucers[2];
    expect(extra.alive).toBe(true);
    const ship = b.inp.ship;
    // In the front cone at the spawn step, then one step of motion.
    expect(angle(b.inp.nose, v(extra.x - ship.x, extra.y - ship.y, extra.z - ship.z))).toBeLessThanOrEqual(SPAWN_CONE_RAD + 0.5 * DEG);
    expect(dist(extra, ship)).toBeGreaterThanOrEqual(30 - 0.05);
    expect(dist(extra, ship)).toBeLessThanOrEqual(40 + 0.05);
  });

  it("clearing wave 3 leaves no sleeper during the rest; they return at ready", () => {
    const { n, ev, step, run, startFight } = setup(150);
    step(); run(1);
    startFight();
    debugClearAll(n, ev);
    expect(step().cleared).toBe(true);
    expect(n.phase).toBe("rest");
    const asleep = () => [...n.saucers, ...n.tardigrades].filter((m) => m.phase === "asleep" || m.phase === "waking").length;
    run(NEST_REST_S - 0.5, DT, () => expect(asleep()).toBe(0));
    expect(n.phase).toBe("rest");
    run(0.5 + SLEEP_GROW_S + 0.1);
    expect(n.phase).toBe("ready");
    for (const s of sleepersOf(n)) expect([s.phase, s.scale]).toEqual(["asleep", 1]);
    expect(n.tardigrades[0].phase).toBe("asleep");
  });
});

describe("the Nest: spawning in front", () => {
  it("waves 2 and 3 spawn within 50° of the nose, 30–40 u out, inside 105 u of the centre", () => {
    const { n, ev, inp, rnd, at } = setup(60);
    at(60);
    inp.nose = v(-1, 0, 0);
    const alive = () => [...n.saucers.filter((s) => s.alive), ...n.tardigrades.filter((t) => t.alive)];
    for (const k of [2, 3] as const) {
      debugStartWave(n, k, inp, rnd, ev);
      const live = alive();
      expect(live).toHaveLength(k === 2 ? 5 : 4);
      for (const m of live) {
        const d = v(m.x - inp.ship.x, m.y - inp.ship.y, m.z - inp.ship.z);
        expect(angle(inp.nose, d)).toBeLessThanOrEqual(SPAWN_CONE_RAD + 1e-9);
        expect(dist(m, inp.ship)).toBeGreaterThanOrEqual(30 - 1e-9);
        expect(dist(m, inp.ship)).toBeLessThanOrEqual(40 + 1e-9);
      }
    }
    // Facing away, near the edge: pulled in radially to SPAWN_MAX_R.
    at(100);
    inp.nose = v(1, 0, 0);
    for (const k of [2, 3] as const) {
      debugStartWave(n, k, inp, rnd, ev);
      for (const m of alive()) {
        expect(dist(m, C)).toBeLessThanOrEqual(SPAWN_MAX_R + 1e-9);
        expect(dist(m, C)).toBeCloseTo(SPAWN_MAX_R, 9); // every cone point there is beyond it
      }
    }
    // A front-spawned tardigrade is uncurled.
    expect(n.tardigrades[0].pose.curl).toBe(0);
  });
});

describe("the Nest: front spawns keep their distance (Ruling N5)", () => {
  it("a clamped spawn is never within 20 u of the ship, and stays on the 105 u sphere", () => {
    const { inp } = setup();
    const rnd = mulberry32(11);
    const out = v(0, 0, 0);
    let moved = 0;
    for (const d of [85, 95, 100, 105, 108, 110, 115]) {
      for (const nose of [v(1, 0, 0), v(1, 0.3, 0.2), v(0.6, 0, 0.8), v(0, 1, 0)]) {
        inp.ship.x = C.x + d; inp.ship.y = C.y; inp.ship.z = C.z;
        inp.nose = nose;
        for (let i = 0; i < 400; i++) {
          frontSpawn(inp, rnd, out);
          expect(dist(out, inp.ship)).toBeGreaterThanOrEqual(20 - 1e-9);
          expect(dist(out, C)).toBeLessThanOrEqual(SPAWN_MAX_R + 1e-9);
          if (Math.abs(dist(out, inp.ship) - 20) < 1e-6) moved++;
        }
      }
    }
    expect(moved).toBeGreaterThan(0); // the rule really moved some
    // Straight out along the ship's own radius (no sideways part to keep): still 20 u away, on the sphere.
    inp.ship.x = C.x + 105; inp.nose = v(1, 0, 0);
    frontSpawn(inp, () => 0, out); // the cone's axis
    expect(dist(out, inp.ship)).toBeCloseTo(20, 9);
    expect(dist(out, C)).toBeCloseTo(SPAWN_MAX_R, 9);
  });

  it("a ship 105 u out, nose outward, gets no wave spawn within 20 u", () => {
    const { n, ev, inp, rnd, at } = setup();
    at(105);
    inp.nose = v(1, 0, 0);
    for (let r = 0; r < 20; r++) {
      debugStartWave(n, r % 2 === 0 ? 2 : 3, inp, rnd, ev);
      for (const m of [...n.saucers, ...n.tardigrades]) {
        if (!m.alive) continue;
        expect(dist(m, inp.ship)).toBeGreaterThanOrEqual(20 - 1e-9);
        expect(dist(m, C)).toBeLessThanOrEqual(SPAWN_MAX_R + 1e-9);
      }
    }
  });
});

describe("the Nest: the sleepers' placed flag (Ruling N5)", () => {
  it("is set on placement and cleared on drop or dismiss", () => {
    expect(createNest().sleepersPlaced).toBe(false);
    const { n, at, step } = setup(150);
    step();
    expect(n.sleepersPlaced).toBe(true);
    at(230); step();
    expect(n.sleepersPlaced).toBe(false);
    for (const m of [...n.saucers, ...n.tardigrades]) expect(m.phase).toBe("gone");
    at(190); step();
    expect(n.sleepersPlaced).toBe(true);
    endFight(n);
    expect(n.sleepersPlaced).toBe(false);
  });

  it("guards the drop loop: with the flag down, nothing is touched beyond 220 u", () => {
    const { n, at, step } = setup(150);
    step();
    n.sleepersPlaced = false; // as if no sleeper existed
    at(230); step();
    expect(n.saucers[0].phase).toBe("asleep");
    expect(n.tardigrades[0].phase).toBe("asleep");
  });
});

describe("the Nest: lock-on, click assist and strikes", () => {
  /** The direction `deg`° off the −X nose, turning toward +Z, in the x–z plane. */
  const dirAt = (deg: number) => v(-Math.cos(deg * DEG), 0, Math.sin(deg * DEG));
  /** Wave 1 live and frozen, the ship 100 u out on +X, nose −X, every saucer parked 60 u above the ship. */
  function lockSetup() {
    const f = setup(100);
    debugStartWave(f.n, 1, f.inp, f.rnd, f.ev);
    f.n.frozen = true;
    const ship = f.inp.ship;
    for (const s of f.n.saucers) { s.x = ship.x; s.y = ship.y + 60; s.z = ship.z; s.vx = 0; s.vy = 0; s.vz = 0; }
    /** The bolts' origin: the ship's nose. */
    const origin = () => {
      const u = unit(f.inp.nose);
      return v(ship.x + u.x * NOSE_OFFSET, ship.y + u.y * NOSE_OFFSET, ship.z + u.z * NOSE_OFFSET);
    };
    /** Puts m `d` u from the nose origin, `deg`° off −X. */
    const place = (m: V3, deg: number, d: number) => {
      const o = origin(), u = dirAt(deg);
      m.x = o.x + u.x * d; m.y = o.y + u.y * d; m.z = o.z + u.z * d;
    };
    /** The newest live ship bolt (the one with the most range left). */
    const newest = () => liveBolts(f.n, "ship").reduce((a, c) => (c.left > a.left ? c : a));
    return { ...f, origin, place, newest };
  }

  it("starts with no lock and an empty strike ring", () => {
    const n = createNest();
    expect(n.lock).toBe(-1);
    expect(n.strikeSeq).toBe(0);
    expect(n.strikes).toHaveLength(STRIKE_RING);
    expect(new Set(n.strikes).size).toBe(STRIKE_RING);
  });

  it("held fire locks within 25°, the lock holds to 40°, and is lost past it (then fire goes down the nose)", () => {
    const { n, inp, step, run, place, newest } = lockSetup();
    const s = n.saucers[0];
    place(s, 20, 40);
    s.hp = 99; // the bolts never defeat it
    inp.fireHeld = true;
    step();
    expect(n.lock).toBe(0);
    // Turn the nose 15° the other way: the saucer sits 35° off it.
    inp.nose = dirAt(-15);
    run(0.5, DT, () => expect(n.lock).toBe(0));
    // 45° off: lost on that step, and nothing else to lock.
    inp.nose = dirAt(-25);
    step();
    expect(n.lock).toBe(-1);
    let shots = 0;
    for (let i = 0; i < 30 && shots === 0; i++) shots = step().shots;
    expect(shots).toBe(1);
    expectDir(newest(), unit(inp.nose));
  });

  it("acquires only with fire held, and holds after a tap (the reticle stays)", () => {
    const { n, inp, step, run, place } = lockSetup();
    const s = n.saucers[0];
    place(s, 10, 40);
    s.hp = 99;
    run(0.5);
    expect(n.lock).toBe(-1); // in the cone, but fire is not held
    inp.fireHeld = true;
    step();
    expect(n.lock).toBe(0);
    inp.fireHeld = false;
    inp.nose = dirAt(-20); // 30° off: past acquiring, inside holding
    run(1, DT, () => expect(n.lock).toBe(0));
  });

  it("when the locked monster falls, the lock moves on that step; no later bolt goes at the fallen one (Review Focus 1)", () => {
    const { n, inp, step, origin, place, newest } = lockSetup();
    const [s, a] = n.saucers;
    place(s, 10, 30);
    place(a, 20, 40);
    inp.fireHeld = true;
    step();
    expect(n.lock).toBe(0);
    let steps = 0;
    let e = step();
    while (s.alive && steps < 240) { e = step(); steps++; }
    expect(s.alive).toBe(false);
    // The defeat step.
    expect(n.lock).toBe(1);
    const fallen = v(s.x, s.y, s.z);
    let checked = 0;
    const check = () => {
      const b = newest();
      const o = origin();
      expect(angle(v(b.dx, b.dy, b.dz), v(fallen.x - o.x, fallen.y - o.y, fallen.z - o.z))).toBeGreaterThan(1 * DEG);
      checked++;
    };
    if (e.shots > 0) check();
    for (let i = 0; i < 60; i++) if (step().shots > 0) check();
    expect(checked).toBeGreaterThan(2);
  });

  it("the fight's end and leaving the area clear the lock", () => {
    const a = lockSetup();
    a.place(a.n.saucers[0], 10, 40);
    a.n.saucers[0].hp = 99;
    a.inp.fireHeld = true;
    a.step();
    expect(a.n.lock).toBe(0);
    endFight(a.n);
    expect(a.n.lock).toBe(-1);

    const b = lockSetup();
    b.place(b.n.saucers[0], 10, 40);
    b.n.saucers[0].hp = 99;
    b.inp.fireHeld = true;
    b.step();
    expect(b.n.lock).toBe(0);
    b.at(115);
    b.step();
    expect(b.n.lock).toBe(-1);
  });

  it("held fire leads the locked monster", () => {
    const { n, inp, step, origin, place, newest } = lockSetup();
    const s = n.saucers[0];
    place(s, 8, 40);
    s.vx = 0; s.vy = 0; s.vz = 12; // strafing
    inp.fireHeld = true;
    expect(step().shots).toBe(1);
    expect(n.lock).toBe(0);
    const bolt = newest();
    const o = origin();
    const want = leadAim(o, v(s.x, s.y, s.z), v(s.vx, s.vy, s.vz), BOLT_SPEED, v(0, 0, 0));
    expectDir(bolt, want);
    // And it is a lead, not a straight shot.
    expect(angle(v(bolt.dx, bolt.dy, bolt.dz), v(s.x - o.x, s.y - o.y, s.z - o.z))).toBeGreaterThan(1 * DEG);
  });

  it("a click within 6° of a monster leads it; one further off goes at the click point; clicks never lock", () => {
    const { n, inp, step, run, origin, place, newest } = lockSetup();
    const s = n.saucers[0];
    place(s, 15, 40);
    s.vx = 0; s.vy = 0; s.vz = 12;
    s.hp = 99;
    const ship = inp.ship;
    const cam = v(ship.x + 10, ship.y + 3, ship.z);
    /** A camera ray `deg`° off the line from the camera to the saucer (turned about world up). */
    const rayOff = (deg: number) => {
      const d = unit(v(s.x - cam.x, s.y - cam.y, s.z - cam.z));
      const side = unit(v(-d.z, 0, d.x));
      const c = Math.cos(deg * DEG), sn = Math.sin(deg * DEG);
      return v(d.x * c + side.x * sn, d.y * c + side.y * sn, d.z * c + side.z * sn);
    };
    const click = (deg: number): ClickShot => {
      const dir = rayOff(deg);
      const p = clickAimPoint(cam, dir, ship, v(0, 0, 0));
      return { x: p.x, y: p.y, z: p.z, ox: cam.x, oy: cam.y, oz: cam.z, dx: dir.x, dy: dir.y, dz: dir.z };
    };
    inp.click = click(4);
    expect(step().shots).toBe(1);
    inp.click = null;
    expectDir(newest(), leadAim(origin(), v(s.x, s.y, s.z), v(s.vx, s.vy, s.vz), BOLT_SPEED, v(0, 0, 0)));
    expect(n.lock).toBe(-1);
    run(0.3);
    const far = click(10);
    inp.click = far;
    expect(step().shots).toBe(1);
    inp.click = null;
    const o = origin();
    expectDir(newest(), unit(v(far.x - o.x, far.y - o.y, far.z - o.z)));
    expect(n.lock).toBe(-1);
    // With a lock held, a click leaves it as it is.
    inp.fireHeld = true; step(); inp.fireHeld = false;
    expect(n.lock).toBe(0);
    run(0.3);
    inp.click = click(10);
    step();
    inp.click = null;
    expect(n.lock).toBe(0);
  });

  it("the hit spheres: saucer 2.6, tardigrade 4.5 (+ the bolt's 0.3); the ship's is unchanged", () => {
    /** One ship bolt along −X from 30 u ahead, `off` u above the monster's centre 40 u ahead: hit or not. */
    const shipBoltHits = (wave: 1 | 3, off: number): boolean => {
      const { n, inp, rnd, ev, step } = setup(100);
      debugStartWave(n, wave, inp, rnd, ev);
      n.frozen = true;
      const ship = inp.ship;
      for (const s of n.saucers) { s.x = ship.x; s.y = ship.y + 60; s.z = ship.z; s.vx = 0; s.vy = 0; s.vz = 0; }
      const m = wave === 1 ? n.saucers[0] : n.tardigrades[0];
      m.x = ship.x - 40; m.y = ship.y + off; m.z = ship.z; m.vx = 0; m.vy = 0; m.vz = 0;
      const hp = m.hp;
      fireBolt(n.bolts, "ship", ship.x - 30, ship.y, ship.z, -1, 0, 0, BOLT_SPEED, BOLT_RANGE, 1);
      step(0.05); step(0.05);
      return m.hp < hp;
    };
    expect(shipBoltHits(1, 2.85)).toBe(true);
    expect(shipBoltHits(1, 2.95)).toBe(false);
    expect(shipBoltHits(3, 4.75)).toBe(true);
    expect(shipBoltHits(3, 4.85)).toBe(false);

    const enemyBoltHits = (off: number): boolean => {
      const { n, inp, step, startFight } = setup();
      startFight();
      n.frozen = true;
      for (const b of n.bolts.bolts) b.live = false;
      const ship = inp.ship;
      fireBolt(n.bolts, "enemy", ship.x - 3, ship.y + off, ship.z, 1, 0, 0, ENEMY_BOLT_SPEED, ENEMY_BOLT_RANGE, ENEMY_BOLT_DAMAGE);
      step(0.05); step(0.05);
      return n.hull.hp < 100;
    };
    expect(enemyBoltHits(1.65)).toBe(true);
    expect(enemyBoltHits(1.75)).toBe(false);
  });

  it("every hit writes its point into the 8-slot strike ring; nine wrap it without growing it", () => {
    const { n, step, inp } = lockSetup();
    const s = n.saucers[0];
    const ship = inp.ship;
    s.x = ship.x - 33; s.y = ship.y; s.z = ship.z;
    s.hp = 99;
    const ring = n.strikes.slice();
    const points: V3[] = [];
    for (let i = 0; i < 9; i++) {
      const b = fireBolt(n.bolts, "ship", ship.x - 30, ship.y + 0.1 * i, ship.z, -1, 0, 0, BOLT_SPEED, BOLT_RANGE, 1)!;
      step(0.05);
      expect(b.live).toBe(false);
      expect(n.strikeSeq).toBe(i + 1);
      const k = n.strikes[(n.strikeSeq - 1) % STRIKE_RING];
      expect([k.x, k.y, k.z]).toEqual([b.x, b.y, b.z]);
      points.push(v(b.x, b.y, b.z));
    }
    expect(s.hp).toBe(90);
    expect(n.strikes).toHaveLength(STRIKE_RING);
    n.strikes.forEach((k, i) => expect(k).toBe(ring[i]));
    // The ninth overwrote the first slot; the rest hold hits 2–8.
    expect([n.strikes[0].x, n.strikes[0].y, n.strikes[0].z]).toEqual([points[8].x, points[8].y, points[8].z]);
    for (let i = 1; i < 8; i++) expect(n.strikes[i].y).toBe(points[i].y);
  });
});
