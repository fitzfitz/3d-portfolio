import { describe, it, expect } from "vitest";
import {
  BOLT_SPEED, BOLT_RANGE, ENEMY_BOLT_DAMAGE, ENEMY_BOLT_RANGE, ENEMY_BOLT_SPEED, HULL_AFTER_BREACH, JET_DPS,
  NEST_LEASH_R, NOSE_OFFSET, SPAWN_R,
} from "../src/utils/combat/constants";
import type { NestSink, V3 } from "../src/utils/combat/types";
import { fireBolt, type Bolt } from "../src/utils/combat/bolts";
import { leadAim } from "../src/utils/combat/aim";
import { hitSaucer } from "../src/utils/combat/saucerAi";
import {
  contactCount, createNest, createNestEvents, debugClearAll, debugClearWave, debugFormation, debugStartWave, endFight,
  resetNestEvents, stepNest, type NestEvents, type NestInput, type NestState,
} from "../src/utils/combat/nest";
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

/** The test Nest's centre: off the origin so nothing passes by accident. */
const C: V3 = v(40, -20, 10);

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
    racing: false, paused: false, lowPerf: false, warm: true, fireHeld: false, click: null,
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

  it("monsters spawn 30 u from the centre on the side away from the ship, ±10 u", () => {
    const { n, startFight } = setup();
    startFight(); // the ship is 69 u out on +X
    const base = v(C.x - SPAWN_R, C.y, C.z);
    const live = n.saucers.filter((s) => s.alive);
    expect(live).toHaveLength(3);
    for (const s of live) {
      // ±10 u of jitter per axis, plus the one step of motion on the spawn step.
      expect(Math.abs(s.x - base.x)).toBeLessThanOrEqual(10.1);
      expect(Math.abs(s.y - base.y)).toBeLessThanOrEqual(10.1);
      expect(Math.abs(s.z - base.z)).toBeLessThanOrEqual(10.1);
    }
    expect(new Set(live.map((s) => s.seed)).size).toBe(3);

    // At the spawn step itself, and with the ship sitting on the centre (+Y side).
    const c = setup();
    c.at(0);
    debugStartWave(c.n, 1, c.inp, c.rnd, c.ev);
    const up = v(C.x, C.y + SPAWN_R, C.z);
    for (const s of c.n.saucers.filter((m) => m.alive)) {
      expect(Math.abs(s.x - up.x)).toBeLessThanOrEqual(10);
      expect(Math.abs(s.y - up.y)).toBeLessThanOrEqual(10);
      expect(Math.abs(s.z - up.z)).toBeLessThanOrEqual(10);
    }
    const f = setup();
    f.at(-90);
    debugStartWave(f.n, 3, f.inp, f.rnd, f.ev);
    const far = v(C.x + SPAWN_R, C.y, C.z);
    const spawned = [...f.n.saucers.filter((m) => m.alive), ...f.n.tardigrades.filter((m) => m.alive)];
    expect(spawned).toHaveLength(4);
    for (const m of spawned) {
      expect(Math.abs(m.x - far.x)).toBeLessThanOrEqual(10);
      expect(Math.abs(m.y - far.y)).toBeLessThanOrEqual(10);
      expect(Math.abs(m.z - far.z)).toBeLessThanOrEqual(10);
    }
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
    // They shrink away over 2 s.
    run(2.1);
    for (const s of wasAlive) expect(s.phase).toBe("gone");
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
    const aim = v(C.x, C.y + 40, C.z);
    let shots = 0;
    for (let i = 0; i < 60; i++) {
      clicks.inp.click = i % 3 === 0 ? aim : null; // 20 clicks in 1 s
      shots += clicks.step().shots;
    }
    expect(shots).toBe(5);
    const b = liveBolts(clicks.n, "ship").reduce((a, c) => (c.left > a.left ? c : a));
    const origin = v(clicks.inp.ship.x - NOSE_OFFSET, C.y, C.z);
    expectDir(b, unit(v(aim.x - origin.x, aim.y - origin.y, aim.z - origin.z)));
  });

  it("held fire leads the nearest monster in the cone", () => {
    const { n, ev, inp, rnd, step } = setup(100);
    debugStartWave(n, 1, inp, rnd, ev);
    n.frozen = true;
    const ship = inp.ship;
    const [s, a, b] = n.saucers;
    // 8° off the nose (−X), 40 u out, strafing at 12 u/s.
    s.x = ship.x - 40 * Math.cos(8 * DEG); s.y = ship.y; s.z = ship.z + 40 * Math.sin(8 * DEG);
    s.vx = 0; s.vy = 0; s.vz = 12;
    // The others well outside the cone.
    a.x = ship.x; a.y = ship.y + 60; a.z = ship.z;
    b.x = ship.x; b.y = ship.y - 60; b.z = ship.z;
    inp.fireHeld = true;
    expect(step().shots).toBe(1);
    const bolt = liveBolts(n, "ship")[0];
    const origin = v(ship.x - NOSE_OFFSET, ship.y, ship.z);
    const want = leadAim(origin, v(s.x, s.y, s.z), v(s.vx, s.vy, s.vz), BOLT_SPEED, v(0, 0, 0));
    expectDir(bolt, want);
    // And it is a lead, not a straight shot.
    expect(angle(v(bolt.dx, bolt.dy, bolt.dz), v(s.x - origin.x, s.y - origin.y, s.z - origin.z))).toBeGreaterThan(1 * DEG);
  });

  it("three ship bolts defeat a saucer even at dt 0.05 (Review Focus 3)", () => {
    const { n, ev, inp, rnd, run } = setup(100);
    debugStartWave(n, 1, inp, rnd, ev);
    n.frozen = true;
    const ship = inp.ship;
    const [s, a, b] = n.saucers;
    // 33 u ahead: bolt points at 1.3 + 7k u never land within 2.1 u of it; only the swept segment hits.
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

    // A bolt that would reach the saucer only by overshooting its range misses.
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
    // 3.6 u off the bolt's line: inside 3.5 + 0.3, outside a saucer's 1.8 + 0.3.
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
    inp.click = v(C.x, C.y + 30, C.z);
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
    const targets = n.targets.slice(), hull = n.hull;
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
    inp.click = v(C.x, C.y, C.z + 5);
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
  });
});
