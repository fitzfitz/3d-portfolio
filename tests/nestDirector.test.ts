import { describe, it, expect, afterEach, vi } from "vitest";
import {
  applyNestEvents, createShipTrack, maybeRumour, noseFrom, takeClick, trackShip,
  type NestCombat, type NestEffects,
} from "../src/utils/combat/director";
import {
  createNest, createNestEvents, debugClearAll, debugStartWave, resetNestEvents, stepNest, type NestInput,
} from "../src/utils/combat/nest";
import { ENEMY_BOLT_DAMAGE, ENEMY_BOLT_RANGE, ENEMY_BOLT_SPEED, HULL_AFTER_BREACH } from "../src/utils/combat/constants";
import { fireBolt } from "../src/utils/combat/bolts";
import { noseDirection } from "../src/utils/pitchFlight";
import { NEST_BREACH_LINE, NEST_CLEARED_LINE, NEST_RUMOUR_LINE } from "../src/data/chatterLines";
import { mulberry32 } from "../src/utils/mulberry32";
import type { NestSink, V3 } from "../src/utils/combat/types";
import { markShipTeleport, shipTeleport } from "../src/store/shipTeleport";
import { padRumble } from "../src/utils/padRumble";

const DT = 1 / 60;
const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
const C = v(40, -20, 10);
const sink: NestSink = {
  muzzle: (s, o) => { o.x = s.x; o.y = s.y; o.z = s.z; return o; },
  mouth: (t, o) => { o.x = t.x; o.y = t.y; o.z = t.z; return o; },
};

/** The effects, counted. */
function fakeEffects() {
  const log = {
    zap: 0, plasmaShot: 0, fanfare: 0, broadcasts: [] as [string, boolean][],
    inNest: [] as boolean[], waves: [] as [number, number][], breachAt: [] as number[], clearedAt: [] as number[],
  };
  const fx: NestEffects = {
    zap: () => { log.zap++; },
    plasmaShot: () => { log.plasmaShot++; },
    fanfare: () => { log.fanfare++; },
    broadcast: (text, silent) => { log.broadcasts.push([text, silent]); },
    setInNest: (on) => { log.inNest.push(on); },
    setWave: (wave, contacts) => { log.waves.push([wave, contacts]); },
    markHullBreach: (at) => { log.breachAt.push(at); },
    markNestCleared: (at) => { log.clearedAt.push(at); },
  };
  return { fx, log };
}

function fakeCombat(): NestCombat {
  return {
    nest: createNest(), inArea: false, hits: 0, towRequest: false, click: { pending: false, x: 0, y: 0, z: 0 },
    warm: true, enteredAt: -Infinity, flashAt: -Infinity, clearedAt: -Infinity, breachAt: -Infinity,
  };
}

/** A director loop over the real machine, as NestDirector runs it (without React). */
function setup() {
  const c = fakeCombat();
  const ev = createNestEvents();
  const { fx, log } = fakeEffects();
  const inp: NestInput = {
    ship: v(C.x + 200, C.y, C.z), shipVel: v(0, 0, 0), nose: v(-1, 0, 0), centre: C,
    racing: false, paused: false, lowPerf: false, warm: true, fireHeld: false, click: null,
  };
  const rnd = mulberry32(5);
  let now = 100;
  const at = (d: number) => { inp.ship.x = C.x + d; inp.ship.y = C.y; inp.ship.z = C.z; };
  const frame = (dt = DT) => {
    now += dt;
    stepNest(c.nest, inp, dt, rnd, sink, ev);
    applyNestEvents(c, ev, fx, now, now * 1000);
  };
  const run = (seconds: number, dt = DT) => { for (let i = 0, k = Math.round(seconds / dt); i < k; i++) frame(dt); };
  return { c, ev, fx, log, inp, rnd, at, frame, run, now: () => now };
}

describe("the director: events", () => {
  it("reads the step's events and then clears them, so ENTERING shows once per crossing (C12)", () => {
    const { c, ev, log, at, frame, run, now } = setup();
    at(75); frame();
    at(69); frame();
    const enteredAt = c.enteredAt;
    expect(enteredAt).toBeCloseTo(now(), 9);
    // Cleared after reading: nothing carries into the next frame.
    expect(ev.entered).toBe(false);
    expect(ev.inArea).toBe(false);
    run(1);
    expect(c.enteredAt).toBe(enteredAt); // not re-stamped on later frames
    expect(log.zap).toBe(0);
    run(2.1);
    expect(log.zap).toBe(1); // wave 1, once
    expect(c.nest.wave).toBe(1);
    expect(log.waves.at(-1)).toEqual([1, 3]);
    expect(log.inNest.every((x) => x)).toBe(true);
    expect(c.inArea).toBe(true);
  });

  it("held fire plays one shot sound per frame that fired, not one every frame", () => {
    const { log, inp, at, frame, run } = setup();
    at(75); frame(); at(69); frame(); run(3.1);
    inp.fireHeld = true;
    const before = log.plasmaShot;
    run(1);
    // 5 bolts a second: about 5 sounds in 60 frames.
    expect(log.plasmaShot - before).toBeGreaterThanOrEqual(5);
    expect(log.plasmaShot - before).toBeLessThanOrEqual(6);
  });

  it("hit feedback bumps combat.hits and stamps the flash; a breach asks for the tow and radios once", () => {
    const { c, log, inp, rnd, ev, at, frame, now } = setup();
    at(60);
    frame();
    debugStartWave(c.nest, 1, inp, rnd, ev);
    c.nest.frozen = true;
    const ship = inp.ship;
    fireBolt(c.nest.bolts, "enemy", ship.x, ship.y + 1, ship.z, 0, -1, 0, ENEMY_BOLT_SPEED, ENEMY_BOLT_RANGE, ENEMY_BOLT_DAMAGE);
    frame();
    expect(c.hits).toBe(1);
    expect(c.flashAt).toBeCloseTo(now(), 9);
    expect(c.towRequest).toBe(false);
    c.nest.hull.hp = 3;
    for (let i = 0; i < 20; i++) frame(); // past the 0.25 s feedback throttle
    fireBolt(c.nest.bolts, "enemy", ship.x, ship.y + 1, ship.z, 0, -1, 0, ENEMY_BOLT_SPEED, ENEMY_BOLT_RANGE, ENEMY_BOLT_DAMAGE);
    frame();
    expect(c.hits).toBe(2);
    expect(c.towRequest).toBe(true);
    expect(c.breachAt).toBeCloseTo(now(), 9);
    expect(log.breachAt).toEqual([now() * 1000]);
    expect(log.broadcasts).toEqual([[NEST_BREACH_LINE, false]]);
    expect(c.nest.hull.hp).toBe(HULL_AFTER_BREACH);
    frame(); frame();
    expect(log.broadcasts).toHaveLength(1);
    expect(log.waves.at(-1)).toEqual([0, 0]);
  });

  it("clearing the Nest stamps it, plays the fanfare, radios and records it once", () => {
    const { c, log, inp, rnd, ev, at, frame, now } = setup();
    at(60);
    frame();
    debugStartWave(c.nest, 3, inp, rnd, ev);
    debugClearAll(c.nest, ev);
    frame();
    expect(c.clearedAt).toBeCloseTo(now(), 9);
    expect(log.fanfare).toBe(1);
    expect(log.broadcasts).toEqual([[NEST_CLEARED_LINE, false]]);
    expect(log.clearedAt).toEqual([now() * 1000]);
    frame(); frame();
    expect(log.fanfare).toBe(1);
    expect(log.clearedAt).toHaveLength(1);
  });

  it("events a debug call writes between frames are read on the next frame", () => {
    const { c, log, inp, rnd, ev, at, frame } = setup();
    at(60);
    frame();
    debugStartWave(c.nest, 2, inp, rnd, ev);
    expect(log.zap).toBe(0);
    frame();
    expect(log.zap).toBe(1);
    frame();
    expect(log.zap).toBe(1);
  });

  it("the store setters get the live values each frame (they skip unchanged values themselves)", () => {
    const { log, at, frame } = setup();
    frame();
    at(60); frame();
    expect(log.inNest).toEqual([false, true]);
    expect(log.waves).toEqual([[0, 0], [0, 0]]);
  });

  it("does not throw on an empty event set, and leaves combat alone", () => {
    const c = fakeCombat();
    const ev = createNestEvents();
    const { fx, log } = fakeEffects();
    resetNestEvents(ev);
    applyNestEvents(c, ev, fx, 5, 5000);
    expect([c.hits, c.towRequest, c.enteredAt, c.flashAt]).toEqual([0, false, -Infinity, -Infinity]);
    expect([log.zap, log.plasmaShot, log.fanfare, log.broadcasts.length]).toEqual([0, 0, 0, 0]);
  });
});

describe("the director: the ship's velocity", () => {
  it("is the position change over the frame", () => {
    const t = createShipTrack();
    const out = v(9, 9, 9);
    trackShip(t, 0, 0, 0, 0, 0.05, out);
    expect(out).toEqual(v(0, 0, 0)); // the first frame has nothing to compare
    trackShip(t, 1.95, 0, -0.5, 0, 0.05, out);
    expect(out.x).toBeCloseTo(39, 9);
    expect(out.y).toBe(0);
    expect(out.z).toBeCloseTo(-10, 9);
  });

  it("is zero on a frame the ship teleported (a jump, the tow, the race grid, a debug teleport)", () => {
    const t = createShipTrack();
    const out = v(0, 0, 0);
    trackShip(t, 0, 0, 0, 7, DT, out);
    trackShip(t, 0.5, 0, 0, 7, DT, out);
    expect(out.x).toBeCloseTo(30, 9);
    trackShip(t, 400, -300, 20, 8, DT, out); // seq moved on: a teleport
    expect(out).toEqual(v(0, 0, 0));
    trackShip(t, 400.5, -300, 20, 8, DT, out);
    expect(out.x).toBeCloseTo(30, 9);
  });

  it("a teleport frame's zero velocity means no false enemy-bolt hit from the jump", () => {
    /** The ship was 2000 u away last frame; an enemy bolt hangs halfway along that line. */
    const jumpIn = (teleported: boolean) => {
      const s = setup();
      s.at(60); s.frame();
      debugStartWave(s.c.nest, 1, s.inp, s.rnd, s.ev);
      s.c.nest.frozen = true;
      const ship = s.inp.ship;
      const t = createShipTrack();
      trackShip(t, ship.x - 2000, ship.y, ship.z, shipTeleport.seq, DT, s.inp.shipVel);
      if (teleported) markShipTeleport();
      trackShip(t, ship.x, ship.y, ship.z, shipTeleport.seq, DT, s.inp.shipVel);
      fireBolt(s.c.nest.bolts, "enemy", ship.x - 1000, ship.y, ship.z + 0.5, 0, 0, 1,
        ENEMY_BOLT_SPEED, ENEMY_BOLT_RANGE, ENEMY_BOLT_DAMAGE);
      s.frame();
      return s;
    };
    const seq = shipTeleport.seq;
    const jumped = jumpIn(true);
    expect(shipTeleport.seq).toBe(seq + 1);
    expect(jumped.inp.shipVel).toEqual(v(0, 0, 0));
    expect(jumped.c.nest.hull.hp).toBe(100);
    expect(jumped.c.hits).toBe(0);
    // The control: velocity from the delta sweeps the ship 2000 u through the bolt.
    const swept = jumpIn(false);
    expect(swept.inp.shipVel.x).toBeCloseTo(2000 / DT, 6);
    expect(swept.c.nest.hull.hp).toBe(100 - ENEMY_BOLT_DAMAGE);
  });
});

describe("the director: nose, click and rumour", () => {
  it("the nose matches pitchFlight's noseDirection, written in place", () => {
    const out = v(0, 0, 0);
    for (const [yaw, pitch] of [[0, 0], [1.2, 0.3], [-2.5, -0.9], [Math.PI, 1.4]]) {
      const want = noseDirection(yaw, pitch);
      expect(noseFrom(yaw, pitch, out)).toBe(out);
      expect(out.x).toBeCloseTo(want.x, 12); expect(out.y).toBeCloseTo(want.y, 12); expect(out.z).toBeCloseTo(want.z, 12);
    }
  });

  it("a pending click is taken once", () => {
    const c = fakeCombat();
    const out = v(0, 0, 0);
    expect(takeClick(c, out)).toBeNull();
    c.click.pending = true; c.click.x = 1; c.click.y = 2; c.click.z = 3;
    expect(takeClick(c, out)).toBe(out);
    expect(out).toEqual(v(1, 2, 3));
    expect(c.click.pending).toBe(false);
    expect(takeClick(c, out)).toBeNull();
  });

  it("the rumour goes out once per page, silent, when due", () => {
    const r = { told: false };
    const { fx, log } = fakeEffects();
    expect(maybeRumour(r, 500, false, false, fx)).toBe(false);
    expect(maybeRumour(r, 300, false, true, fx)).toBe(false); // radio busy
    expect(maybeRumour(r, 300, true, false, fx)).toBe(false); // racing
    expect(log.broadcasts).toEqual([]);
    expect(maybeRumour(r, 300, false, false, fx)).toBe(true);
    expect(log.broadcasts).toEqual([[NEST_RUMOUR_LINE, true]]);
    expect(r.told).toBe(true);
    expect(maybeRumour(r, 300, false, false, fx)).toBe(false);
    expect(log.broadcasts).toHaveLength(1);
  });
});

describe("combat hit rumble (C3)", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("rumbles the first standard pad, without the store's impact counter", () => {
    const playEffect = vi.fn(() => Promise.resolve("complete"));
    const pads = [
      null,
      { connected: true, mapping: "", vibrationActuator: { playEffect: vi.fn(() => Promise.resolve("complete")) } },
      { connected: true, mapping: "standard", vibrationActuator: { playEffect } },
    ];
    vi.stubGlobal("navigator", { getGamepads: () => pads });
    padRumble();
    expect(playEffect).toHaveBeenCalledTimes(1);
    expect(playEffect.mock.calls[0]).toEqual(["dual-rumble", { duration: 140, strongMagnitude: 0.7, weakMagnitude: 0.4 }]);
    expect(pads[1]!.vibrationActuator.playEffect).not.toHaveBeenCalled();
  });

  it("is a no-op without a pad, an actuator or the Gamepad API, and swallows a rejected effect", async () => {
    vi.stubGlobal("navigator", { getGamepads: () => [] });
    expect(() => padRumble()).not.toThrow();
    vi.stubGlobal("navigator", { getGamepads: () => [{ connected: true, mapping: "standard" }] });
    expect(() => padRumble()).not.toThrow();
    vi.stubGlobal("navigator", {});
    expect(() => padRumble()).not.toThrow();
    const rejected = vi.fn(() => Promise.reject(new Error("busy")));
    vi.stubGlobal("navigator", { getGamepads: () => [{ connected: true, mapping: "standard", vibrationActuator: { playEffect: rejected } }] });
    expect(() => padRumble()).not.toThrow();
    await Promise.resolve();
    expect(rejected).toHaveBeenCalledTimes(1);
  });
});
