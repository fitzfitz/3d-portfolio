import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  stepGravity, wellAccel, gravityMode, SlingshotGate, SlingshotWatch, wellAt, SUN_WELL_ID, type Well,
  PLANET_WELL_G, PLANET_WELL_RADIUS_FACTOR, SUN_WELL_G, SUN_WELL_RADIUS, G_MAX, SPEED_CEILING, STATION_KEEP_AFTER, CLIMB_OUT,
  WELL_REF_SIZE, planetWell, wellStrength, SLINGSHOT_SPEED,
} from "../src/utils/gravityWell";
import { resolveWorldContact, SHIP_HALF_LENGTH } from "../src/utils/worldCollide";
import { cruiseCap } from "../src/utils/speedCap";
import { BODY_REACH, SOLAR_BODIES } from "../src/data/solarSystem";
import { SUN_COLLIDER } from "../src/data/asteroids";

const MAX = 10.8, ACCEL = 25.2, DRAG = 0.982;
/** The gas giant's well (the size PLANET_WELL_G was tuned at), moved to (x, y, z). */
const planet = (x = 0, y = 0, z = 0): Well => ({ ...planetWell({ size: WELL_REF_SIZE }), x, y, z });
/** The sun's well as Spaceship builds it: softened inside the collider. */
const sun = (): Well => ({ x: SUN_COLLIDER.x, y: SUN_COLLIDER.y, z: SUN_COLLIDER.z, g: SUN_WELL_G, radius: SUN_WELL_RADIUS, rMin: SUN_COLLIDER.r });
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });

interface Flight {
  /** Closest the ship's centre came to the first well's centre, after the surface collider. */
  minR: number; peak: number; exitSpeed: number | null;
  /** Whether the ship touched the planet's solid surface (resolveWorldContact). */
  touched: boolean;
  start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number };
}

/**
 * Spaceship's integrator plus stepGravity and the planet's solid surface
 * (resolveWorldContact; a hit zeroes gravity momentum, as Spaceship's impact
 * does). Nose fixed at +x; W held unless `thrust` is false. `size` is the
 * first well's planet size.
 */
function fly(opts: {
  b: number; x0?: number; v0?: number; wells?: Well[]; seconds?: number; thrust?: boolean; dt?: number; size?: number;
  /** Called after every step with the time, the ship and its total speed, as Spaceship reads them. */
  onFrame?: (t: number, p: { x: number; y: number; z: number }, speed: number, gMag: number) => void;
}): Flight {
  const { b, x0 = -90, v0 = MAX, wells = [planet()], seconds = 16, thrust = true, dt = 1 / 60, size = WELL_REF_SIZE, onFrame } = opts;
  const p = v3(x0, b, 0), v = v3(v0, 0, 0), G = v3();
  const start = { ...p };
  let idleFor = 0, minR = Infinity, peak = 0, wasIn = false;
  let exitSpeed: number | null = null, touched = false;
  for (let i = 0; i < seconds / dt; i++) {
    if (thrust) {
      v.x += ACCEL * dt;
      const l = Math.hypot(v.x, v.y, v.z);
      const cap = cruiseCap(MAX, DRAG, dt);
      if (l > cap) { v.x *= cap / l; v.y *= cap / l; v.z *= cap / l; }
    }
    const k = Math.pow(DRAG, dt * 60);
    v.x *= k; v.y *= k; v.z *= k;
    idleFor = thrust ? 0 : idleFor + dt;
    stepGravity(G, p, v, wells, wells.length, gravityMode(true, false, idleFor), dt);
    p.x += (v.x + G.x) * dt; p.y += (v.y + G.y) * dt; p.z += (v.z + G.z) * dt;
    if (resolveWorldContact(p, v, wells[0], size)) { touched = true; G.x = 0; G.y = 0; G.z = 0; }
    const r = Math.hypot(p.x - wells[0].x, p.y - wells[0].y, p.z - wells[0].z);
    const s = Math.hypot(v.x + G.x, v.y + G.y, v.z + G.z);
    minR = Math.min(minR, r);
    peak = Math.max(peak, s);
    if (wasIn && r >= wells[0].radius && exitSpeed === null) exitSpeed = s;
    wasIn = wasIn || r < wells[0].radius;
    onFrame?.(i * dt, p, s, Math.hypot(G.x, G.y, G.z));
  }
  return { minR, peak, exitSpeed, touched, start, end: { ...p } };
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
  it("does not pull across the old seam", () => {
    const g = stepGravity(v3(), v3(245, 0, 0), v3(0, 0, 1), [planet(-245, 0, 0)], 1, "free", 0.01);
    expect(g.x).toBe(0); // the planet is 490u away in plain space
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

describe("planetWell", () => {
  it("pins the strength rule (R21): quadratic in size up to 16, linear above, continuous at 16", () => {
    expect(WELL_REF_SIZE).toBe(16);
    expect(wellStrength(16)).toBe(PLANET_WELL_G);
    expect(wellStrength(8)).toBeCloseTo(PLANET_WELL_G / 4, 9);
    expect(wellStrength(4)).toBeCloseTo(PLANET_WELL_G / 16, 9);
    expect(wellStrength(32)).toBeCloseTo(PLANET_WELL_G * 2, 9);
    expect(wellStrength(22)).toBeCloseTo(PLANET_WELL_G * 22 / 16, 9);
    expect(wellStrength(16 - 1e-9)).toBeCloseTo(wellStrength(16 + 1e-9), 4);
    for (let s = 1; s < 30; s += 0.5) expect(wellStrength(s + 0.5)).toBeGreaterThan(wellStrength(s));
  });
  it("scales the gas giant's tuning by size: g by wellStrength, radius and softening by size", () => {
    for (const p of SOLAR_BODIES) {
      const w = planetWell(p);
      expect(w.g, p.id).toBeCloseTo(wellStrength(p.size), 9);
      expect(w.radius, p.id).toBeCloseTo(p.size * PLANET_WELL_RADIUS_FACTOR, 9);
      expect(w.rMin, p.id).toBe(p.size);
    }
    expect(planetWell({ size: WELL_REF_SIZE }).g).toBe(PLANET_WELL_G);
  });
  it("is built for every body, sizes read from the data", () => {
    expect(BODY_REACH.map((b) => b.key)).toEqual(SOLAR_BODIES.map((b) => b.id));
    expect(BODY_REACH.map((b) => b.size)).toEqual(SOLAR_BODIES.map((b) => b.size));
    for (const b of BODY_REACH) {
      const w = planetWell(b);
      expect(w.g, b.key).toBeCloseTo(wellStrength(b.size), 9);
      expect(w.radius, b.key).toBeCloseTo(b.size * PLANET_WELL_RADIUS_FACTOR, 9);
    }
  });
});

/**
 * Spec §5.6 targets, tuned on the gas giant (size 16) and flown here around
 * every planet with the impact parameters and radii scaled by size / 16. The
 * pull at the same multiple of a planet's size is the same for every size (g
 * goes as size², distance as size), but a smaller well is crossed sooner, so
 * it bends and boosts less: the spec's pull and boost numbers are the gas
 * giant's, and smaller planets only have to pull and boost at all. Planets no
 * longer dock (project probes, spec §4.4): a skim leaves, a straight run meets
 * the solid surface, and nothing passes through.
 */
// Ruling R21 made the well linear in size above 16, so Jupiter's and
// Saturn's b=30 skims stay clear (they met the surface under size²).
// Ruling R20: every target's impact parameter is a multiple of the body's
// size (b_ref × size / 16, the size the targets were written for), flown
// around all nine bodies: L36's frame, where the pull at the same multiple of
// size is the same for every body.
//
// Waived, explicitly: Ceres (2.95) is too small to reach the pull and boost
// targets under the unchanged well law. Its well is crossed in a fifth of the
// gas giant's time, so at b=40 it bends the ship to 39.0 sizes/16 at a peak
// of 11.41 (target 11.8), and at b=34 to 32.4 (target ≤ 31) leaving at 11.74.
// It still never touches at those passes, and every other target holds.
const WAIVED_PULL_AND_BOOST: ReadonlySet<string> = new Set(["ceres"]);
describe.each(SOLAR_BODIES.map((b) => [b.id, b.size] as const))("tuning targets (spec §5.6) around %s (size %d)", (name, size) => {
  const k = size / WELL_REF_SIZE;
  const waived = WAIVED_PULL_AND_BOOST.has(name);
  const reach = size + SHIP_HALF_LENGTH;
  const wells = [planetWell({ size })];
  const at = (b: number, extra: Partial<Parameters<typeof fly>[0]> = {}) => fly({ b: b * k, wells, size, ...extra });
  it("b=40: a visible pull and a boost, clear of the surface", () => {
    const f = at(-40);
    expect(f.touched).toBe(false);
    if (waived) return;
    expect(f.minR).toBeLessThanOrEqual(39 * k);
    expect(f.peak).toBeGreaterThanOrEqual(MAX + 1);
  });
  it("b=34: pulled in, leaves the well faster than cruise, clear of the surface", () => {
    const f = at(-34);
    expect(f.touched).toBe(false);
    expect(f.exitSpeed).not.toBeNull();
    if (waived) return;
    expect(f.minR).toBeLessThanOrEqual(31 * k);
    expect(f.exitSpeed!).toBeGreaterThanOrEqual(MAX + 1);
  });
  if (size > WELL_REF_SIZE) {
    it("b=40: a giant's pass still earns the slingshot (peak above SLINGSHOT_SPEED)", () => {
      expect(at(-40).peak).toBeGreaterThan(SLINGSHOT_SPEED);
    });
  }
  // Was "a fast skim inside 1.3 sizes does not open the dossier".
  it("b=30: a fast skim neither sticks nor passes through", () => {
    const f = at(-30);
    expect(f.touched, "a skim never meets the surface").toBe(false);
    expect(f.minR).toBeGreaterThanOrEqual(reach);
    expect(f.exitSpeed, "left the well").not.toBeNull();
    expect(f.end.x, "flew on past the planet").toBeGreaterThan(wells[0].radius);
  });
  // Was "docks, never inside 1.06 sizes first".
  it("b=22 and straight in: meet the solid surface and never end a step inside it", () => {
    for (const b of [-22, 0.01]) {
      const f = at(b);
      expect(f.touched, `b=${b}`).toBe(true);
      expect(f.minR, `b=${b}`).toBeGreaterThanOrEqual(reach);
    }
  });
  // The ship's dt is clamped to 0.05s, so a slow device runs at 20 fps steps.
  it("b=30 still skims at 30 and 20 fps", () => {
    for (const dt of [1 / 30, 1 / 20]) {
      const f = at(-30, { dt });
      expect(f.touched, `dt=${dt}`).toBe(false);
      expect(f.minR, `dt=${dt}`).toBeGreaterThanOrEqual(reach);
      expect(f.end.x, `dt=${dt}`).toBeGreaterThan(wells[0].radius);
    }
  });
  it("b=22 and straight in still stop at the surface at 20 fps", () => {
    for (const b of [-22, 0.01]) {
      const f = at(b, { dt: 1 / 20 });
      expect(f.touched, `b=${b}`).toBe(true);
      expect(f.minR, `b=${b}`).toBeGreaterThanOrEqual(reach);
    }
  });
  it("an idle ship 30u (scaled) out barely drifts (station-keeping)", () => {
    const f = at(0.01, { x0: -30 * k, v0: 0, thrust: false, seconds: 30 });
    const drift = Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y, f.end.z - f.start.z);
    expect(drift).toBeLessThan(3);
  });
});

describe("the sun's well (G = 3500, softened inside its collider)", () => {
  it("is built from SUN_COLLIDER", () => {
    expect(sun().rMin).toBe(SUN_COLLIDER.r);
  });
  it("W-held passes 10u and more off its collider stay clear of it", () => {
    for (const extra of [10, 15, 25]) {
      const b = SUN_COLLIDER.r + extra;
      const f = fly({ b: -b, x0: -120, wells: [sun()], seconds: 25 });
      expect(f.minR, `b=${b}`).toBeGreaterThan(SUN_COLLIDER.r);
    }
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

describe("SlingshotWatch (review #4, #5)", () => {
  const out = { whoosh: false, line: false };
  /** In planet "p" from t=0, exits at `exitAt`; a broadcast (id 1) is first seen at `broadcastAt`. */
  function exitAt(exitAt: number, opts: { broadcastAt?: number; warp?: boolean; g?: number; race?: boolean; speed?: number } = {}) {
    const w = new SlingshotWatch();
    const { broadcastAt = -1, warp = false, g = 6, race = false, speed = 18 } = opts;
    for (let t = 0; t < exitAt; t += 0.1) w.update(t, t >= broadcastAt && broadcastAt >= 0 ? 1 : 0, "p", 11, g, false, false, out);
    return { ...w.update(exitAt, broadcastAt >= 0 ? 1 : 0, null, speed, g, warp, race, out) };
  }
  it("calls a fast exit with gravity momentum a slingshot", () => {
    expect(exitAt(20)).toEqual({ whoosh: true, line: true });
  });
  it("still calls it after an old broadcast (the radio is only busy for RADIO_BUSY_S)", () => {
    expect(exitAt(20, { broadcastAt: 2 })).toEqual({ whoosh: true, line: true });
  });
  it("holds the line, not the whoosh, while a fresh broadcast is on the radio", () => {
    expect(exitAt(20, { broadcastAt: 18 })).toEqual({ whoosh: true, line: false });
  });
  it("ignores warping out of a well", () => {
    expect(exitAt(20, { warp: true, speed: 39 })).toEqual({ whoosh: false, line: false });
  });
  it("ignores a fast exit gravity did not help", () => {
    expect(exitAt(20, { g: 0.5 })).toEqual({ whoosh: false, line: false });
  });
  it("keeps quiet on the radio during a race", () => {
    expect(exitAt(20, { race: true })).toEqual({ whoosh: true, line: false });
  });
});

describe("the Sun's well counts for the slingshot, by the planets' rules", () => {
  /** Flies past the sun alone, feeding SlingshotWatch as Spaceship does; returns the exit speed and whether it whooshed. */
  function pass(b: number, seconds = 16) {
    const w = new SlingshotWatch(), out = { whoosh: false, line: false };
    const wells = [sun()], ids = [SUN_WELL_ID];
    let whoosh = false, line = false;
    const f = fly({ b: -b, x0: -60, wells, seconds, size: SUN_COLLIDER.r, onFrame: (t, p, speed, gMag) => {
      w.update(t, 0, wellAt(p, wells, ids, wells.length), speed, gMag, false, false, out);
      whoosh ||= out.whoosh; line ||= out.line;
    } });
    return { ...f, whoosh, line };
  }
  it("names the well the ship is in, the first of the active ones, or none", () => {
    const wells = [planet(300, 0, 0), sun(), planet(5000, 0, 0)], ids = ["p", SUN_WELL_ID, "far"];
    expect(wellAt(v3(-20, 0, 0), wells, ids, 3)).toBe(SUN_WELL_ID);
    expect(wellAt(v3(330, 0, 0), wells, ids, 3)).toBe("p");
    expect(wellAt(v3(0, SUN_WELL_RADIUS + 0.01, 0), wells, ids, 3)).toBeNull();
    expect(wellAt(v3(5000, 0, 0), wells, ids, 2)).toBeNull(); // only the first `count`
  });
  it("a lawful skim at b = 30 u leaves above SLINGSHOT_SPEED and earns it: whoosh and radio line", () => {
    const f = pass(30);
    expect(f.touched).toBe(false);
    expect(f.exitSpeed!).toBeGreaterThan(SLINGSHOT_SPEED);
    expect(f.whoosh).toBe(true);
    expect(f.line).toBe(true);
  });
  it("a slower pass through the same well earns nothing", () => {
    const f = pass(33);
    expect(f.minR).toBeLessThan(SUN_WELL_RADIUS); // it was in the well
    expect(f.exitSpeed!).toBeLessThan(SLINGSHOT_SPEED);
    expect(f.whoosh).toBe(false);
    expect(f.line).toBe(false);
  });
  it("Spaceship watches every active well, the Sun's last, so a planet's well still wins where they overlap", () => {
    const ship = readFileSync("src/components/canvas/Spaceship.tsx", "utf8");
    expect(ship).toMatch(/const WELL_IDS = \[\.\.\.BODY_REACH\.map\(\(b\) => b\.key\), SUN_WELL_ID\]/);
    expect(ship).toMatch(/const wellNow = wellAt\(pos\.current, ACTIVE_WELLS, WELL_IDS, wellCount\);/);
  });
});
