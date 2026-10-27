import { describe, it, expect } from "vitest";
import {
  EDGE_INSET_PX, MAX_EDGE_ARROWS, createNestScreen, edgeArrow, nestScreen, projectNdc, updateNestScreen,
  type EdgeSpot, type Ndc,
} from "../src/utils/combat/nestScreen";
import { createNest, type NestState } from "../src/utils/combat/nest";

/** The identity view (camera at the origin looking down −Z), column-major. */
const V = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** A 90° (vertical), aspect 1, near 0.1, far 1000 perspective, column-major (three.js makePerspective). */
const P = (() => {
  const near = 0.1, far = 1000, f = 1 / Math.tan(Math.PI / 4);
  const m = new Array<number>(16).fill(0);
  m[0] = f; m[5] = f;
  m[10] = -(far + near) / (far - near); m[11] = -1;
  m[14] = (-2 * far * near) / (far - near);
  return m;
})();

const near = (e: EdgeSpot, x: number, y: number, a?: number) => {
  expect(e.x).toBeCloseTo(x, 9);
  expect(e.y).toBeCloseTo(y, 9);
  if (a !== undefined) expect(e.angle).toBeCloseTo(a, 9);
};

describe("projectNdc", () => {
  it("projects ahead to NDC and marks behind the camera", () => {
    const o: Ndc = { nx: 0, ny: 0, behind: false };
    projectNdc(V, P, 0, 0, -10, o);
    expect(o.nx).toBeCloseTo(0, 12); expect(o.ny).toBeCloseTo(0, 12); expect(o.behind).toBe(false);
    expect(projectNdc(V, P, 10, 0, -10, o).nx).toBeCloseTo(1, 12);
    expect(projectNdc(V, P, 0, 0, 10, o).behind).toBe(true);
    // It returns `out`.
    expect(projectNdc(V, P, 1, 2, -3, o)).toBe(o);
  });
});

describe("edgeArrow", () => {
  it("places the arrow on the 28 px inset rectangle, pointing out", () => {
    expect(EDGE_INSET_PX).toBe(28);
    const e: EdgeSpot = { x: 0, y: 0, angle: 0 };
    near(edgeArrow(2, 0, false, 1280, 800, e), 1252, 400, 0);
    near(edgeArrow(0, -3, false, 1280, 800, e), 640, 772, Math.PI / 2);
    near(edgeArrow(0.2, 0, true, 1280, 800, e), 28, 400); expect(Math.abs(e.angle)).toBeCloseTo(Math.PI, 9);
    near(edgeArrow(-0.5, 0, true, 1280, 800, e), 1252, 400); // behind and right of the camera → right edge
    near(edgeArrow(0, 0, true, 1280, 800, e), 640, 772, Math.PI / 2); // dead behind (Review Focus 5)
    near(edgeArrow(3, 3, false, 800, 800, e), 772, 28, -Math.PI / 4);
    for (const k of [e.x, e.y, e.angle]) expect(Number.isFinite(k)).toBe(true);
    // It returns `out`.
    expect(edgeArrow(1, 1, false, 100, 100, e)).toBe(e);
  });

  it("stays finite for a point projected from w ≈ 0", () => {
    const o: Ndc = { nx: 0, ny: 0, behind: false };
    projectNdc(V, P, 5, 3, 0, o); // in the camera's plane: w = 0
    expect(o.behind).toBe(true);
    const e = edgeArrow(o.nx, o.ny, o.behind, 1280, 800, { x: 0, y: 0, angle: 0 });
    for (const k of [e.x, e.y, e.angle]) expect(Number.isFinite(k)).toBe(true);
    // Right and up of the camera: the right edge, pointing up-right.
    expect(e.x).toBeCloseTo(1252, 6);
    expect(e.angle).toBeLessThan(0);
  });
});

describe("updateNestScreen", () => {
  const W = 1280, H = 800;
  /** A fight with one alive saucer 20 u ahead (5 u right) and two alive behind. */
  function fight(): NestState {
    const n = createNest();
    n.phase = "fighting"; n.wave = 1;
    const [a, b, c] = n.saucers;
    for (const s of [a, b, c]) { s.alive = true; s.phase = "idle"; }
    a.x = 5; a.y = 0; a.z = -20;
    b.x = 0; b.y = 0; b.z = 20;
    c.x = -30; c.y = 4; c.z = 15;
    return n;
  }

  it("gives an arrow to each alive monster off screen, only while fighting or in the gap", () => {
    const n = fight();
    const o = createNestScreen();
    updateNestScreen(n, V, P, W, H, 10, o);
    expect(o.arrows.count).toBe(2);
    for (let i = 0; i < o.arrows.count; i++) {
      // On the inset rectangle.
      const x = o.arrows.x[i], y = o.arrows.y[i];
      const onX = Math.abs(x - 28) < 1e-6 || Math.abs(x - (W - 28)) < 1e-6;
      const onY = Math.abs(y - 28) < 1e-6 || Math.abs(y - (H - 28)) < 1e-6;
      expect(onX || onY).toBe(true);
    }
    n.phase = "gap";
    expect(updateNestScreen(n, V, P, W, H, 10, o).arrows.count).toBe(2);
    for (const ph of ["ready", "countdown", "rest"] as const) {
      n.phase = ph;
      expect(updateNestScreen(n, V, P, W, H, 10, o).arrows.count, ph).toBe(0);
    }
  });

  it("asleep monsters never get an arrow", () => {
    const n = fight();
    n.saucers[1].alive = false; n.saucers[1].phase = "asleep";
    n.saucers[2].alive = false; n.saucers[2].phase = "asleep";
    n.tardigrades[0].alive = false; n.tardigrades[0].phase = "asleep";
    n.tardigrades[0].x = 0; n.tardigrades[0].y = 0; n.tardigrades[0].z = 40;
    expect(updateNestScreen(n, V, P, W, H, 10, createNestScreen()).arrows.count).toBe(0);
  });

  it("never draws more than MAX_EDGE_ARROWS", () => {
    expect(MAX_EDGE_ARROWS).toBe(8);
    const n = createNest();
    n.phase = "fighting";
    // The pools hold fewer than 8 today; the cap guards a larger roster.
    while (n.targets.length <= MAX_EDGE_ARROWS) n.targets.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, alive: true });
    for (const t of n.targets) { t.alive = true; t.x = 3; t.y = 1; t.z = 30; }
    const o = updateNestScreen(n, V, P, W, H, 10, createNestScreen());
    expect(o.arrows.count).toBe(MAX_EDGE_ARROWS);
    expect(o.arrows.x).toHaveLength(MAX_EDGE_ARROWS);
  });

  it("puts the lock reticle on the locked monster's pixel, and none for one behind or fallen", () => {
    const n = fight();
    const o = createNestScreen();
    n.lock = 0;
    updateNestScreen(n, V, P, W, H, 10, o);
    expect(o.lock.on).toBe(true);
    // nx = 5 / 20 = 0.25 → x = (0.125 + 0.5) · 1280; ny = 0 → mid-height.
    expect(o.lock.x).toBeCloseTo(800, 9);
    expect(o.lock.y).toBeCloseTo(400, 9);
    n.lock = 1;
    expect(updateNestScreen(n, V, P, W, H, 10, o).lock.on).toBe(false);
    n.lock = 0; n.saucers[0].alive = false;
    expect(updateNestScreen(n, V, P, W, H, 10, o).lock.on).toBe(false);
    n.lock = -1; n.saucers[0].alive = true;
    expect(updateNestScreen(n, V, P, W, H, 10, o).lock.on).toBe(false);
  });

  it("shows HIT for 0.25 s after a strike: at the lock's pixel when locked, else at the strike's projection", () => {
    const n = fight();
    const o = createNestScreen();
    n.lock = 0;
    const t = 12.3;
    updateNestScreen(n, V, P, W, H, t - 1, o);
    expect(o.hit.on).toBe(false);
    n.strikes[0].x = 2.6 + 5; n.strikes[0].y = 0; n.strikes[0].z = -20;
    n.strikeSeq = 1;
    updateNestScreen(n, V, P, W, H, t, o);
    expect(o.hitAt).toBe(t);
    expect(o.seenSeq).toBe(1);
    expect(o.hit.on).toBe(true);
    expect([o.hit.x, o.hit.y]).toEqual([o.lock.x, o.lock.y]);
    expect(updateNestScreen(n, V, P, W, H, t + 0.249, o).hit.on).toBe(true);
    expect(updateNestScreen(n, V, P, W, H, t + 0.25, o).hit.on).toBe(false);
    // Unlocked: at the strike's own projection (nx = 7.6 / 20).
    n.lock = -1;
    n.strikes[1].x = 7.6; n.strikes[1].y = 0; n.strikes[1].z = -20;
    n.strikeSeq = 2;
    updateNestScreen(n, V, P, W, H, t + 1, o);
    expect(o.hit.on).toBe(true);
    expect(o.hit.x).toBeCloseTo((7.6 / 20 / 2 + 0.5) * W, 9);
    expect(o.hit.y).toBeCloseTo(H / 2, 9);
    // A strike behind the camera shows no HIT.
    n.strikes[2].x = 0; n.strikes[2].y = 0; n.strikes[2].z = 5;
    n.strikeSeq = 3;
    expect(updateNestScreen(n, V, P, W, H, t + 2, o).hit.on).toBe(false);
  });

  it("returns `out` and allocates no new arrays over 1,000 calls", () => {
    const n = fight();
    const o = createNestScreen();
    const xs = o.arrows.x, ys = o.arrows.y, as = o.arrows.angle, lock = o.lock, hit = o.hit;
    for (let i = 0; i < 1000; i++) {
      n.lock = i % 2 === 0 ? 0 : -1;
      n.strikeSeq = i >> 3;
      expect(updateNestScreen(n, V, P, W, H, i / 60, o)).toBe(o);
    }
    expect(o.arrows.x).toBe(xs); expect(o.arrows.y).toBe(ys); expect(o.arrows.angle).toBe(as);
    expect(o.lock).toBe(lock); expect(o.hit).toBe(hit);
  });

  it("has a shared screen for the driver and the overlay", () => {
    expect(nestScreen.arrows.x).toHaveLength(MAX_EDGE_ARROWS);
    expect(nestScreen.lock.on).toBe(false);
    expect(nestScreen.hit.on).toBe(false);
    expect(nestScreen.arrows.count).toBe(0);
  });
});
