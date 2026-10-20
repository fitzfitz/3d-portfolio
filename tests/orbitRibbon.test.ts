import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SOLAR_BODIES } from "../src/data/solarSystem";
import { orbitShape } from "../src/utils/ephemeris";
import { ORRERY_TEST_JD } from "../src/utils/orreryClock";
import { orbitFrameQuaternion, orbitRibbonGeometry, perifocalEllipse, ORBIT_RIBBON_SAMPLES } from "../src/components/canvas/orbitRibbon";
import { sweptOrbit } from "./helpers/solarClearance";
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
