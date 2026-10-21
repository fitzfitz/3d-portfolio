import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SOLAR_BODIES } from "../src/data/solarSystem";
import { orbitShape } from "../src/utils/ephemeris";
import { ORRERY_TEST_JD } from "../src/utils/orreryClock";
import {
  apsides, facingOffset, pxAtDepth, orbitFrameQuaternion, orbitRibbonGeometry, perifocalEllipse, ORBIT_RIBBON_SAMPLES,
  ORBIT_MIN_HALF_PX, ORBIT_TICK_HALF_LENGTH, ORBIT_TICK_MIN_HALF_PX,
} from "../src/components/canvas/orbitRibbon";
import { sweptOrbit } from "./helpers/solarClearance";
import { withGuideOffsets } from "../src/components/canvas/guideLine";
import { AU } from "../src/constants";

const circle = (n: number, r: number) =>
  Array.from({ length: n }, (_, k) => ({ x: r * Math.cos((k / n) * Math.PI * 2), y: r * Math.sin((k / n) * Math.PI * 2), z: 0 }));

describe("orbitRibbonGeometry: a closed strip", () => {
  const pts = circle(512, 100);
  const g = orbitRibbonGeometry(pts, 0.06);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;

  it("closes the loop: the last column repeats the first", () => {
    const cols = pos.count / 2;
    expect(cols).toBe(513);
    for (const side of [0, 1]) {
      const a = side, b = (cols - 1) * 2 + side;
      expect(pos.getX(b)).toBeCloseTo(pos.getX(a), 9);
      expect(pos.getY(b)).toBeCloseTo(pos.getY(a), 9);
      expect(pos.getZ(b)).toBeCloseTo(pos.getZ(a), 9);
    }
    expect(g.getIndex()!.count).toBe(512 * 6);
  });

  it("keeps uv.x in [0, 1]: the arc fraction, 0 at the start and 1 at the seam", () => {
    let prev = -1;
    for (let k = 0; k < uv.count; k += 2) {
      const u = uv.getX(k);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(u).toBeGreaterThan(prev);
      expect(uv.getX(k + 1)).toBe(u);
      prev = u;
    }
    expect(uv.getX(0)).toBe(0);
    expect(uv.getX(uv.count - 1)).toBe(1);
  });

  // Positions are float32: ~1e-5 at r 100.
  it("is 2 × halfWidth wide, across the curve and in its plane", () => {
    for (let k = 0; k < pos.count; k += 64) {
      const w = Math.hypot(pos.getX(k + 1) - pos.getX(k), pos.getY(k + 1) - pos.getY(k), pos.getZ(k + 1) - pos.getZ(k));
      expect(w).toBeCloseTo(0.12, 4);
      expect(pos.getZ(k)).toBeCloseTo(0, 9);
      // Radial: the two edges straddle the circle.
      expect(Math.hypot(pos.getX(k), pos.getY(k)) + Math.hypot(pos.getX(k + 1), pos.getY(k + 1))).toBeCloseTo(200, 3);
    }
  });
});

describe("perifocalEllipse + orbitFrameQuaternion: the true ellipse, in its plane", () => {
  it("lands on the swept orbit (the clearance helper's) for every body", () => {
    for (const b of SOLAR_BODIES) {
      const shape = orbitShape(b.orbit.el, ORRERY_TEST_JD);
      const local = perifocalEllipse(shape.a * AU, shape.e, 64);
      const q = orbitFrameQuaternion(shape, new THREE.Quaternion());
      const ref = sweptOrbit(shape, 64);
      local.forEach((p, k) => {
        const v = new THREE.Vector3(p.x, p.y, p.z).applyQuaternion(q);
        expect(v.x, `${b.id} ${k}`).toBeCloseTo(ref[k][0], 6);
        expect(v.y, `${b.id} ${k}`).toBeCloseTo(ref[k][1], 6);
        expect(v.z, `${b.id} ${k}`).toBeCloseTo(ref[k][2], 6);
      });
    }
  });

  it("puts the Sun at a focus: perihelion a(1 − e), aphelion a(1 + e)", () => {
    const pts = perifocalEllipse(100, 0.2, ORBIT_RIBBON_SAMPLES);
    const r = pts.map((p) => Math.hypot(p.x, p.y, p.z));
    expect(Math.min(...r)).toBeCloseTo(80, 6);
    expect(Math.max(...r)).toBeCloseTo(120, 3);
    expect(ORBIT_RIBBON_SAMPLES).toBe(512);
  });
});

describe("orbitRibbonGeometry: readable at any range (spec §6.2)", () => {
  const pts = circle(512, 100);
  const g = orbitRibbonGeometry(pts, 0.06);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const side = g.getAttribute("aSide") as THREE.BufferAttribute;
  const along = g.getAttribute("aAlong") as THREE.BufferAttribute;

  it("carries each vertex's offset from the centre line, for the shader to widen to a pixel", () => {
    expect(side.count).toBe(pos.count);
    for (let k = 0; k < pos.count; k += 2) {
      const col = (k / 2) % 512;
      for (const v of [k, k + 1]) {
        expect(Math.hypot(side.getX(v), side.getY(v), side.getZ(v))).toBeCloseTo(0.06, 6);
        // position − aSide is the centre line.
        expect(pos.getX(v) - side.getX(v)).toBeCloseTo(pts[col].x, 4);
        expect(pos.getY(v) - side.getY(v)).toBeCloseTo(pts[col].y, 4);
        expect(along.getX(v)).toBe(0);
        expect(along.getY(v)).toBe(0);
        expect(along.getZ(v)).toBe(0);
      }
    }
  });

  it("never thinner than 1 px, ticks never shorter than 4 px half-length", () => {
    expect(ORBIT_MIN_HALF_PX).toBe(1);
    expect(ORBIT_TICK_MIN_HALF_PX).toBeGreaterThan(ORBIT_MIN_HALF_PX);
    expect(ORBIT_TICK_HALF_LENGTH).toBeGreaterThan(0.06);
  });
});

describe("apsis ticks: short crossbars at perihelion (E = 0) and aphelion (E = π)", () => {
  const a = 100, e = 0.2;
  const [peri, aph] = apsides(a, e);
  const pts = perifocalEllipse(a, e, ORBIT_RIBBON_SAMPLES);
  const plain = orbitRibbonGeometry(pts, 0.06);
  const g = orbitRibbonGeometry(pts, 0.06, [peri, aph]);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const side = g.getAttribute("aSide") as THREE.BufferAttribute;
  const along = g.getAttribute("aAlong") as THREE.BufferAttribute;
  const base = plain.getAttribute("position").count;

  it("finds the apsides on the perifocal x axis, the Sun at the origin", () => {
    expect(peri).toEqual({ x: 80, y: 0, z: 0 });
    expect(aph.x).toBeCloseTo(-120, 9);
    expect(aph.y).toBe(0);
  });

  it("adds four vertices and two triangles per tick, after the ribbon", () => {
    expect(pos.count).toBe(base + 8);
    expect(g.getIndex()!.count).toBe(plain.getIndex()!.count + 12);
  });

  it("each tick crosses the orbit along the radius, centred on its apsis", () => {
    for (const [t, at] of [[0, peri], [1, aph]] as const) {
      let cx = 0, cy = 0;
      for (let v = base + t * 4; v < base + t * 4 + 4; v++) {
        // The bar runs along the radius (x), ORBIT_TICK_HALF_LENGTH each way, and is the ribbon's width across (y).
        expect(Math.abs(along.getX(v))).toBeCloseTo(ORBIT_TICK_HALF_LENGTH, 6);
        expect(along.getY(v)).toBeCloseTo(0, 9);
        expect(Math.abs(side.getY(v))).toBeCloseTo(0.06, 6);
        expect(side.getX(v)).toBeCloseTo(0, 9);
        expect(pos.getZ(v)).toBeCloseTo(0, 9);
        // position − aSide − aAlong is the apsis itself.
        expect(pos.getX(v) - side.getX(v) - along.getX(v)).toBeCloseTo(at.x, 4);
        expect(pos.getY(v) - side.getY(v) - along.getY(v)).toBeCloseTo(at.y, 4);
        cx += pos.getX(v) / 4; cy += pos.getY(v) / 4;
      }
      expect(cx).toBeCloseTo(at.x, 4);
      expect(cy).toBeCloseTo(at.y, 4);
    }
  });
});

describe("facingOffset: the line's width turned to face the camera (guideLine.ts mirror)", () => {
  // An orbit of radius 1000 in the XY plane (normal +z), seen exactly edge-on
  // from 3000 u away in the plane: the in-plane offset projects to nothing.
  const n = { x: 0, y: 0, z: 1 };
  const H = 800, fov = Math.PI / 3;
  const cam = new THREE.PerspectiveCamera(60, 1280 / 800, 0.1, 8000);
  cam.position.set(0, -4000, 0);
  cam.up.set(0, 0, 1);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  const toPx = (v: THREE.Vector3) => {
    const s = v.clone().project(cam);
    return new THREE.Vector2(s.x * 640, s.y * 400);
  };
  const across = (centre: THREE.Vector3, off: { x: number; y: number; z: number }) =>
    toPx(centre.clone().add(new THREE.Vector3(off.x, off.y, off.z))).distanceTo(toPx(centre.clone().sub(new THREE.Vector3(off.x, off.y, off.z))));

  it("one CSS px at a depth: 2 z tan(fov / 2) / H", () => {
    expect(pxAtDepth(400, fov, H)).toBeCloseTo((2 * 400 * Math.tan(fov / 2)) / H, 12);
  });

  it("edge-on, the strip stays at least 2 px wide (1 px each side); in-plane it would vanish", () => {
    // The near side of the circle: its tangent (x) runs across the screen, its
    // radius (−y) points at the camera, so the built offset is pure depth.
    const centre = new THREE.Vector3(0, -1000, 0);
    const toCam = { x: cam.position.x - centre.x, y: cam.position.y - centre.y, z: cam.position.z - centre.z };
    const px = pxAtDepth(-centre.clone().applyMatrix4(cam.matrixWorldInverse).z, fov, H);
    expect(across(centre, { x: 0, y: -Math.max(0.06, px), z: 0 })).toBeLessThan(0.01);
    const f = facingOffset({ x: 0, y: -0.06, z: 0 }, n, toCam, px);
    expect(across(centre, f)).toBeGreaterThanOrEqual(2 - 1e-6);
    // Still across the line: ⟂ its tangent (x).
    expect(f.x).toBeCloseTo(0, 9);
  });

  it("face-on, it is the offset as built (only grown to the pixel)", () => {
    const f = facingOffset({ x: 0.06, y: 0, z: 0 }, n, { x: 0, y: 0, z: 3000 }, 0.01);
    expect(f.x).toBeCloseTo(0.06, 9);
    expect(f.y).toBeCloseTo(0, 9);
    expect(f.z).toBeCloseTo(0, 9);
    const g = facingOffset({ x: -0.06, y: 0, z: 0 }, n, { x: 0, y: 0, z: 3000 }, 1);
    expect(g.x).toBeCloseTo(-1, 9);
  });

  it("the two edges and a tick's two ends go opposite ways", () => {
    const toCam = { x: 30, y: -4000, z: 5 };
    const a = facingOffset({ x: 0.06, y: 0, z: 0 }, n, toCam, 1);
    const b = facingOffset({ x: -0.06, y: 0, z: 0 }, n, toCam, 1);
    expect(a.x + b.x).toBeCloseTo(0, 9);
    expect(a.y + b.y).toBeCloseTo(0, 9);
    expect(a.z + b.z).toBeCloseTo(0, 9);
  });

  it("looking straight along the line, it keeps the built direction (no NaN)", () => {
    // Offset along x, line tangent along y, camera straight down the tangent.
    const f = facingOffset({ x: 0.06, y: 0, z: 0 }, n, { x: 0, y: 3000, z: 0 }, 1);
    expect(f.x).toBeCloseTo(1, 9);
    expect(Number.isNaN(f.y)).toBe(false);
  });
});

describe("withGuideOffsets: a RingGeometry guide binds the guide-line attributes", () => {
  it("adds zero aSide and aAlong, one per vertex, and keeps any already there", () => {
    const g = withGuideOffsets(new THREE.RingGeometry(10, 11, 16, 1));
    const n = g.getAttribute("position").count;
    for (const name of ["aSide", "aAlong"]) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      expect(a.count).toBe(n);
      expect(Array.from(a.array as Float32Array).every((v) => v === 0)).toBe(true);
    }
    const r = orbitRibbonGeometry(circle(8, 10), 0.06);
    const side = r.getAttribute("aSide");
    expect(withGuideOffsets(r).getAttribute("aSide")).toBe(side);
  });
});
