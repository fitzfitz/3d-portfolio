import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  LOD_SEGMENTS, UNIT_SPHERES, lodDistances, makeSphereLOD, shellCullDistance,
} from "../src/utils/sphereLod";

/**
 * The reference view, computed here rather than imported, so the module's own
 * projection is checked against an independent one: the resting chase FOV
 * (58°, Spaceship.tsx; warp and speed only widen it, which shrinks a body) on
 * a 1512×802 viewport (docs/PERF-BUDGETS.md's real-browser measurements).
 */
const VIEW_H = 802;
const FOV = 58;
const focalPx = VIEW_H / 2 / Math.tan((FOV * Math.PI) / 360);
/** A sphere's projected radius in pixels, seen centred: tan(asin(r/d)) × focal. */
const projectedPx = (r: number, d: number) => (focalPx * r) / Math.sqrt(d * d - r * r);
/** How far a regular n-gon's edge sags inside the true silhouette, in pixels. */
const sagPx = (r: number, d: number, n: number) => projectedPx(r, d) * (1 - Math.cos(Math.PI / n));

/** Which of a LOD's levels draws with the camera `d` away from its centre. */
function levelAt(lod: THREE.LOD, d: number): number {
  const camera = new THREE.PerspectiveCamera(FOV, 1512 / VIEW_H, 0.1, 1500);
  camera.position.set(0, 0, d);
  camera.updateMatrixWorld();
  lod.updateMatrixWorld();
  lod.update(camera);
  const shown = lod.levels.map((l, i) => (l.object.visible ? i : -1)).filter((i) => i >= 0);
  expect(shown).toHaveLength(1);
  return shown[0];
}

describe("the shared unit-sphere LOD (detail by distance)", () => {
  it("has 64, 24 and 12 segment levels, one shared unit sphere each", () => {
    expect([...LOD_SEGMENTS]).toEqual([64, 24, 12]);
    UNIT_SPHERES.forEach((g, i) => {
      expect(g.parameters.radius).toBe(1);
      expect(g.parameters.widthSegments).toBe(LOD_SEGMENTS[i]);
      expect(g.parameters.heightSegments).toBe(LOD_SEGMENTS[i]);
    });
  });

  it("draws every level of a body with that body's one material, on the shared spheres, scaled to its radius", () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    const lodA = makeSphereLOD(a, 12, { name: "Planet_a" });
    const lodB = makeSphereLOD(b, 13.5, { radius: 13.5 * 1.04 });
    for (const [lod, mat] of [[lodA, a], [lodB, b]] as const) {
      expect(lod.levels).toHaveLength(3);
      lod.levels.forEach((l, i) => {
        const mesh = l.object as THREE.Mesh;
        expect(mesh.isMesh).toBe(true);
        expect(mesh.material).toBe(mat);
        expect(mesh.geometry).toBe(UNIT_SPHERES[i]); // shared, not one per body
      });
    }
    expect(lodA.scale.toArray()).toEqual([12, 12, 12]);
    expect(lodB.scale.x).toBeCloseTo(13.5 * 1.04, 12);
    // Every level carries the body's name, so a probe's getObjectByName finds a mesh.
    expect(lodA.levels.every((l) => l.object.name === "Planet_a")).toBe(true);
  });

  it("switches at distances that start at 0, rise monotonically and scale with size", () => {
    for (const size of [3.5, 5.7, 8, 12, 13, 13.5, 15, 16]) {
      const d = lodDistances(size);
      expect(d).toHaveLength(LOD_SEGMENTS.length);
      expect(d[0]).toBe(0);
      for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
      const twice = lodDistances(size * 2);
      d.forEach((x, i) => expect(twice[i]).toBeCloseTo(2 * x, 9));
    }
  });

  it("drops to a coarser level only once its silhouette is within half a pixel of the true limb", () => {
    for (const size of [3.5, 8, 16]) {
      const d = lodDistances(size);
      for (let i = 1; i < d.length; i++) {
        expect(sagPx(size, d[i], LOD_SEGMENTS[i])).toBeLessThanOrEqual(0.5 + 1e-9);
        // and no later than that: just inside, the coarser level would show its facets
        expect(sagPx(size, d[i] * 0.99, LOD_SEGMENTS[i])).toBeGreaterThan(0.5);
      }
      const lod = makeSphereLOD(new THREE.MeshBasicMaterial(), size);
      expect(levelAt(lod, size * 2)).toBe(0);
      expect(levelAt(lod, (d[1] + d[2]) / 2)).toBe(1);
      expect(levelAt(lod, d[2] * 1.5)).toBe(2);
    }
  });
});

describe("the overlay shells' cull distance", () => {
  it("is where the shell's on-screen extent projects under 1 px at 1512×802 and FOV 58°", () => {
    for (const extent of [0.36, 0.52, 1.44, 12.06, 16.1]) {
      const cull = shellCullDistance(extent);
      expect(projectedPx(extent, cull * (1 + 1e-9))).toBeLessThan(1);
      expect(projectedPx(extent, cull * 0.99)).toBeGreaterThan(1);
    }
  });

  it("ends the shell's LOD in an empty level: past the cull nothing draws, before it the shared spheres do", () => {
    const mat = new THREE.MeshBasicMaterial();
    const size = 13;
    const cull = shellCullDistance(size * 0.04); // an ice giant's 1.04 rim
    const lod = makeSphereLOD(mat, size, { radius: size * 1.04, cullBeyond: cull });
    const last = lod.levels[lod.levels.length - 1];
    expect(last.distance).toBe(cull);
    expect((last.object as THREE.Mesh).isMesh).toBeFalsy();
    expect(last.object.children).toHaveLength(0);
    // Levels past the cull would never draw, so they are not built.
    const d = lodDistances(size);
    const meshes = lod.levels.slice(0, -1);
    expect(meshes.map((l) => l.distance)).toEqual(d.filter((x) => x < cull));
    meshes.forEach((l) => expect((l.object as THREE.Mesh).material).toBe(mat));
    expect(levelAt(lod, cull * 0.9)).toBeLessThan(lod.levels.length - 1);
    expect(levelAt(lod, cull * 1.1)).toBe(lod.levels.length - 1);
  });
});
