import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { planets } from "../src/constants";
import { MOONS, moonOffset } from "../src/data/moons";
import { MAX_OCCLUDERS, occluders, setOccluder, sunShadowUniforms } from "../src/components/canvas/sunShadow";

describe("moon occluders (F4, L20)", () => {
  it("every planet and moon has an occluder slot", () => {
    expect(planets.length + MOONS.length).toBeLessThanOrEqual(MAX_OCCLUDERS);
  });

  it("moonOffset is where OrbitingMoon's groups put the moon", () => {
    for (const m of MOONS) {
      for (const angle of [0, 0.7, 2.5, -1.9]) {
        const tilt = new THREE.Group();
        tilt.rotation.set(m.inclination, 0, 0);
        const orbit = new THREE.Group();
        orbit.rotation.y = angle;
        const mesh = new THREE.Object3D();
        mesh.position.set(m.distance * planets[m.planet].size, 0, 0);
        tilt.add(orbit);
        orbit.add(mesh);
        tilt.updateMatrixWorld(true);
        const want = mesh.getWorldPosition(new THREE.Vector3());
        const got = moonOffset(m, angle, { x: 0, y: 0, z: 0 });
        expect(got.x).toBeCloseTo(want.x, 9);
        expect(got.y).toBeCloseTo(want.y, 9);
        expect(got.z).toBeCloseTo(want.z, 9);
      }
    }
  });

  it("setOccluder keeps the CPU list that sunVisibility reads in step with the uniform", () => {
    const o = occluders[5];
    setOccluder(5, 1, -2, 3, 0.5);
    expect(occluders[5]).toBe(o);
    expect(o).toEqual({ x: 1, y: -2, z: 3, r: 0.5 });
    expect(sunShadowUniforms.uOccluders.value[5].toArray()).toEqual([1, -2, 3, 0.5]);
    expect(occluders).toHaveLength(MAX_OCCLUDERS);
  });
});
