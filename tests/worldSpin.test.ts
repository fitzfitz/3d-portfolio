import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { WORLDS, type WorldData } from "../src/data/worlds";
import { orbitPosition } from "../src/utils/orbits";
import { worldSpinQuaternion } from "../src/utils/worldSpin";

const DEG = 180 / Math.PI;

/** The spin axis: the mesh's own +Y, carried into world space. */
const axisAt = (w: WorldData, t: number) =>
  new THREE.Vector3(0, 1, 0).applyQuaternion(worldSpinQuaternion(w, t, new THREE.Quaternion()));

/** The spin's angular velocity in world space, measured from two quaternions dt apart. */
function spinVector(w: WorldData, t: number): THREE.Vector3 {
  const dt = 1e-3;
  const q0 = worldSpinQuaternion(w, t, new THREE.Quaternion());
  const q1 = worldSpinQuaternion(w, t + dt, new THREE.Quaternion());
  const dq = q1.multiply(q0.invert()); // world-frame increment
  if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
  return new THREE.Vector3(dq.x, dq.y, dq.z).multiplyScalar(2 / dt);
}

/** The orbit normal: the direction of the orbital angular momentum, r × v, from the orbit itself. */
function orbitNormal(w: WorldData): THREE.Vector3 {
  const a = orbitPosition(w.orbit, 0), b = orbitPosition(w.orbit, 1);
  return new THREE.Vector3(a.x, a.y, a.z).cross(new THREE.Vector3(b.x, b.y, b.z)).normalize();
}

describe("worldSpinQuaternion (L9, axial tilt)", () => {
  it("keeps the spin axis fixed in space as the world turns", () => {
    for (const w of WORLDS) {
      const a0 = axisAt(w, 0);
      for (const t of [3.7, 100, 2500]) expect(axisAt(w, t).distanceTo(a0)).toBeLessThan(1e-9);
    }
  });

  it("spins about that axis at the world's own rate", () => {
    for (const w of WORLDS) {
      const omega = spinVector(w, 12);
      expect(omega.length()).toBeCloseTo(Math.abs(w.spin), 6);
      expect(Math.abs(omega.clone().normalize().dot(axisAt(w, 12)))).toBeCloseTo(1, 9);
    }
  });

  it("holds the spin at the world's obliquity from its orbit normal; the tilted ice giant's is 97.8°", () => {
    for (const w of WORLDS) {
      const obliquity = spinVector(w, 5).angleTo(orbitNormal(w)) * DEG;
      expect(obliquity).toBeCloseTo(w.axialTiltDeg, 4);
    }
    const tilted = WORLDS.find((w) => w.id === "w-tilted")!;
    expect(spinVector(tilted, 5).angleTo(orbitNormal(tilted)) * DEG).toBeCloseTo(97.8, 4);
  });

  it("spins prograde for every world but the tilted ice giant (L9)", () => {
    for (const w of WORLDS) {
      const prograde = spinVector(w, 5).dot(orbitNormal(w)) > 0;
      expect(prograde, w.id).toBe(w.id !== "w-tilted");
    }
  });

  it("writes into the quaternion it is given", () => {
    const out = new THREE.Quaternion();
    expect(worldSpinQuaternion(WORLDS[0], 1, out)).toBe(out);
  });
});
