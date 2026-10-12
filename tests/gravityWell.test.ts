import { describe, it, expect } from "vitest";
import {
  stepGravity, wellAccel, gravityMode, EscapeGrace, SlingshotGate, type Well,
  PLANET_WELL_G, SUN_WELL_G, SUN_WELL_RADIUS, G_MAX, SPEED_CEILING, STATION_KEEP_AFTER, CLIMB_OUT,
} from "../src/utils/gravityWell";
import { canCapture } from "../src/utils/capture";

const MAX = 10.8, ACCEL = 25.2, DRAG = 0.982;
const planet = (x = 0, y = 0, z = 0): Well => ({ x, y, z, g: PLANET_WELL_G, radius: 56, rMin: 16 });
const sun = (): Well => ({ x: 0, y: 0, z: 0, g: SUN_WELL_G, radius: SUN_WELL_RADIUS, rMin: 9.5 });
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });

interface Flight {
  minR: number; peak: number; exitSpeed: number | null; captured: { r: number } | null;
  start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number };
}

/** Spaceship's integrator plus stepGravity. Nose fixed at +x; W held unless `thrust` is false. */
function fly(opts: { b: number; x0?: number; v0?: number; wells?: Well[]; seconds?: number; thrust?: boolean; dt?: number }): Flight {
  const { b, x0 = -90, v0 = MAX, wells = [planet()], seconds = 16, thrust = true, dt = 1 / 60 } = opts;
  const p = v3(x0, b, 0), v = v3(v0, 0, 0), G = v3();
  const start = { ...p };
  let idleFor = 0, minR = Infinity, peak = 0, wasIn = false;
  let exitSpeed: number | null = null, captured: { r: number } | null = null;
  for (let i = 0; i < seconds / dt; i++) {
    if (thrust) {
      v.x += ACCEL * dt;
      const l = Math.hypot(v.x, v.y, v.z);
      if (l > MAX) { v.x *= MAX / l; v.y *= MAX / l; v.z *= MAX / l; }
    }
    const k = Math.pow(DRAG, dt * 60);
    v.x *= k; v.y *= k; v.z *= k;
    idleFor = thrust ? 0 : idleFor + dt;
    stepGravity(G, p, v, wells, wells.length, gravityMode(true, false, idleFor), dt);
    p.x += (v.x + G.x) * dt; p.y += (v.y + G.y) * dt; p.z += (v.z + G.z) * dt;
    const r = Math.hypot(p.x - wells[0].x, p.y - wells[0].y, p.z - wells[0].z);
    const s = Math.hypot(v.x + G.x, v.y + G.y, v.z + G.z);
    if (!captured && canCapture(r, 16, s)) captured = { r };
    minR = Math.min(minR, r);
    peak = Math.max(peak, s);
    if (wasIn && r >= wells[0].radius && exitSpeed === null) exitSpeed = s;
    wasIn = wasIn || r < wells[0].radius;
  }
  return { minR, peak, exitSpeed, captured, start, end: { ...p } };
}

describe("wellAccel", () => {
  const w = planet();
  it("falls off with the square of distance", () => {
    expect(wellAccel(20, w) / wellAccel(40, w)).toBeCloseTo(4, 5);
  });
  it("is softened inside rMin and zero at the well's edge", () => {
    expect(wellAccel(5, w)).toBe(wellAccel(16, w));
    expect(wellAccel(56, w)).toBe(0);
    expect(wellAccel(60, w)).toBe(0);
  });
  it("fades smoothly over the outer 20%", () => {
    expect(wellAccel(44.8, w)).toBeCloseTo(PLANET_WELL_G / 44.8 ** 2, 6);
    const mid = wellAccel(50.4, w);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(PLANET_WELL_G / 50.4 ** 2);
  });
});

describe("stepGravity basics", () => {
  it("pulls toward the centre at full strength inbound, CLIMB_OUT outbound", () => {
    const w = planet();
    const inbound = stepGravity(v3(), v3(-30, 0, 0), v3(5, 0, 0), [w], 1, "free", 0.01);
    const outbound = stepGravity(v3(), v3(-30, 0, 0), v3(-5, 0, 0), [w], 1, "free", 0.01);
    expect(inbound.x).toBeGreaterThan(0);
    expect(outbound.x / inbound.x).toBeCloseTo(CLIMB_OUT, 5);
  });
  it("adds overlapping wells", () => {
    const one = stepGravity(v3(), v3(0, 0, 0), v3(0, 0, 1), [planet(30, 0, 0)], 1, "free", 0.01);
    const two = stepGravity(v3(), v3(0, 0, 0), v3(0, 0, 1), [planet(30, 0, 0), planet(30, 0, 0)], 2, "free", 0.01);
    expect(two.x).toBeCloseTo(2 * one.x, 6);
  });
  it("only uses the first `count` wells", () => {
    const g = stepGravity(v3(), v3(0, 0, 0), v3(0, 0, 1), [planet(30, 0, 0), planet(-30, 0, 0)], 1, "free", 0.01);
    expect(g.x).toBeGreaterThan(0);
  });
  it("pulls across the wrap seam the short way", () => {
    const g = stepGravity(v3(), v3(245, 0, 0), v3(0, 0, 1), [planet(-245, 0, 0)], 1, "free", 0.01);
    expect(g.x).toBeGreaterThan(0); // the planet is 10u away through +x, not 490u back through -x
  });
  it("does not pull while keeping station, in warp, or before first input", () => {
    for (const mode of ["keeping", "warp", "off"] as const) {
      const g = stepGravity(v3(), v3(-30, 0, 0), v3(), [planet()], 1, mode, 0.1);
      expect(Math.hypot(g.x, g.y, g.z)).toBe(0);
    }
  });
  it("zeroes momentum when off, decays it fast while keeping station", () => {
    expect(stepGravity(v3(5, 0, 0), v3(), v3(), [], 0, "off", 0.016).x).toBe(0);
    const keep = stepGravity(v3(5, 0, 0), v3(), v3(), [], 0, "keeping", 0.4).x;
    const free = stepGravity(v3(5, 0, 0), v3(), v3(), [], 0, "free", 0.4).x;
    expect(keep).toBeCloseTo(2.5, 5);
    expect(free).toBeGreaterThan(keep);
  });
  it("caps momentum and total speed", () => {
    const g = stepGravity(v3(40, 0, 0), v3(), v3(), [], 0, "free", 0);
    expect(Math.hypot(g.x, g.y, g.z)).toBeCloseTo(G_MAX, 5);
    const g2 = stepGravity(v3(14, 0, 0), v3(), v3(15.8, 0, 0), [], 0, "free", 0);
    expect(15.8 + g2.x).toBeCloseTo(SPEED_CEILING, 5);
  });
});

describe("gravityMode", () => {
  it("maps the safeguards", () => {
    expect(gravityMode(false, false, 0)).toBe("off");
    expect(gravityMode(true, true, 0)).toBe("warp");
    expect(gravityMode(true, false, STATION_KEEP_AFTER)).toBe("keeping");
    expect(gravityMode(true, false, STATION_KEEP_AFTER - 0.01)).toBe("free");
  });
});

describe("tuning targets (spec §5.6)", () => {
  it("b=40: a visible pull and a boost, no capture", () => {
    const f = fly({ b: -40 });
    expect(f.captured).toBeNull();
    expect(f.minR).toBeLessThanOrEqual(36);
    expect(f.peak).toBeGreaterThanOrEqual(14);
  });
  it("b=34: pulled in, leaves the well faster than cruise, no capture", () => {
    const f = fly({ b: -34 });
    expect(f.captured).toBeNull();
    expect(f.minR).toBeLessThanOrEqual(28);
    expect(f.exitSpeed).not.toBeNull();
    expect(f.exitSpeed!).toBeGreaterThanOrEqual(13.5);
  });
  it("b=30: a fast skim inside 20.8 does not open the dossier", () => {
    const f = fly({ b: -30 });
    expect(f.captured).toBeNull();
    expect(f.minR).toBeGreaterThan(18);
  });
  it("b=22 and straight in: docks, never inside 17u first", () => {
    for (const b of [-22, 0.01]) {
      const f = fly({ b });
      expect(f.captured, `b=${b}`).not.toBeNull();
      expect(f.captured!.r, `b=${b}`).toBeGreaterThan(17);
    }
  });
  it("an idle ship 30u out barely drifts (station-keeping)", () => {
    const f = fly({ b: 0.01, x0: -30, v0: 0, thrust: false, seconds: 30 });
    const drift = Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y, f.end.z - f.start.z);
    expect(drift).toBeLessThan(3);
  });
  it("a W-held pass 20u off the sun stays clear of its surface", () => {
    const f = fly({ b: -20, x0: -120, wells: [sun()], seconds: 25 });
    expect(f.minR).toBeGreaterThan(9.5);
  });
});

describe("EscapeGrace", () => {
  it("skips the planet just left until the ship is outside its well", () => {
    const e = new EscapeGrace();
    e.arm("fuxx");
    expect(e.skip).toBe("fuxx");
    e.update(40, 56);
    expect(e.skip).toBe("fuxx");
    e.update(56, 56);
    expect(e.skip).toBeNull();
  });
});

describe("escape grace in a frame loop", () => {
  it("a ship pushed out of orbit at the escape radius is not pulled back into lock", () => {
    // Spaceship's break-orbit push: out to size × ZONE_FACTOR × 1.15 ≈ 33u, drifting out at 4 u/s, then idle.
    const grace = new EscapeGrace();
    grace.arm("p");
    const w = planet();
    const p = v3(-33, 0, 0), v = v3(-4, 0, 0), G = v3();
    let minR = Infinity, idleFor = 0;
    for (let i = 0; i < 20 * 60; i++) {
      const dt = 1 / 60;
      const k = Math.pow(DRAG, dt * 60);
      v.x *= k; v.y *= k; v.z *= k;
      idleFor += dt;
      grace.update(Math.hypot(p.x, p.y, p.z), 56);
      stepGravity(G, p, v, [w], grace.skip ? 0 : 1, gravityMode(true, false, idleFor), dt);
      p.x += (v.x + G.x) * dt; p.y += (v.y + G.y) * dt; p.z += (v.z + G.z) * dt;
      minR = Math.min(minR, Math.hypot(p.x, p.y, p.z));
    }
    expect(minR).toBeGreaterThan(20.8);
  });
});

describe("SlingshotGate", () => {
  it("fires on a fast exit, then waits out its cooldown", () => {
    const g = new SlingshotGate();
    expect(g.update(false, 0, false, false)).toBe(false);
    expect(g.update(true, 1, false, false)).toBe(true);
    expect(g.update(true, 20, false, false)).toBe(false);
    expect(g.update(true, 32, false, false)).toBe(true);
  });
  it("is spent, not deferred, when the radio is busy or a race runs", () => {
    const g = new SlingshotGate();
    expect(g.update(true, 0, true, false)).toBe(false);
    expect(g.update(true, 1, false, true)).toBe(false);
    expect(g.update(true, 2, false, false)).toBe(true);
  });
});

describe("speed ceiling never fights the pilot (review #1)", () => {
  it("leaves warp at full speed", () => {
    const G = stepGravity(v3(3, 0, 0), v3(), v3(38.3, 0, 0), [], 0, "warp", 1 / 60);
    expect(38.3 + G.x).toBeGreaterThanOrEqual(38);
    expect(G.x).toBeGreaterThanOrEqual(0);
  });
  it("never turns gravity momentum backwards when the pilot alone exceeds the ceiling", () => {
    const G = stepGravity(v3(5, 0, 0), v3(), v3(30, 0, 0), [], 0, "free", 1 / 60);
    expect(G.x).toBeGreaterThanOrEqual(0);
    expect(30 + G.x).toBeGreaterThanOrEqual(30);
  });
  it("a warp then W-held sequence never moves the ship backwards", () => {
    const v = v3(38.3, 0, 0), G = v3(), p = v3(-60, 0, 0);
    const w = [planet()];
    for (let i = 0; i < 120; i++) stepGravity(G, p, v, w, 1, "warp", 1 / 60); // warp past a well
    v.x = 10.8; // Shift released with W held: the thrust branch clamps to cruise
    for (let i = 0; i < 120; i++) {
      stepGravity(G, p, v, w, 1, "free", 1 / 60);
      expect(v.x + G.x).toBeGreaterThan(0);
    }
  });
});
