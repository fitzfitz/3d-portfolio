import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CLOSE_UP_HOURS_PER_SECOND } from "../src/data/solarMoons";
import { bodyById, SOLAR_BODIES } from "../src/data/solarSystem";
import { meshScale, poleWorld, spinQuaternion } from "../src/utils/bodySpin";
import { orbitShape } from "../src/utils/ephemeris";
import { ORRERY_TEST_JD } from "../src/utils/orreryClock";

const deg = (r: number) => (r * 180) / Math.PI;
const Y = new THREE.Vector3(0, 1, 0);

/** Orbit normal in the world frame: ecliptic (x, y, z) maps to world (x, z, -y). */
function orbitNormalWorld(id: string): THREE.Vector3 {
  const o = orbitShape(bodyById(id as never).orbit.el, ORRERY_TEST_JD);
  const x = Math.sin(o.i) * Math.sin(o.node), y = -Math.sin(o.i) * Math.cos(o.node), z = Math.cos(o.i);
  return new THREE.Vector3(x, z, -y);
}

describe("poleWorld", () => {
  it("is a unit vector whose angle to the orbit normal is the obliquity (retrograde: 180 minus)", () => {
    for (const b of SOLAR_BODIES) {
      const p = poleWorld(b);
      expect(p.length(), b.id).toBeCloseTo(1, 9);
      const ang = deg(p.angleTo(orbitNormalWorld(b.id)));
      const obl = b.rotationHours < 0 ? 180 - ang : ang;
      expect(Math.abs(obl - b.obliquityDeg), b.id).toBeLessThan(0.5);
    }
  });
});

describe("spinQuaternion", () => {
  const out = new THREE.Quaternion();
  const axisOf = (b: (typeof SOLAR_BODIES)[number], t: number) =>
    Y.clone().applyQuaternion(spinQuaternion(b, t, out));

  it("keeps the pole fixed in world space across a full orbit", () => {
    for (const b of SOLAR_BODIES) {
      const p = poleWorld(b);
      for (const t of [0, 1, 37.3, 1e3, 1e5]) expect(axisOf(b, t).angleTo(p), b.id).toBeLessThan(1e-6);
    }
  });
  it("turns Earth once per 23.9345 / 1.2 s", () => {
    const e = bodyById("earth");
    const day = e.rotationHours / CLOSE_UP_HOURS_PER_SECOND;
    expect(day).toBeCloseTo(23.9345 / 1.2, 6);
    const a = new THREE.Quaternion().copy(spinQuaternion(e, 3, out));
    const b = spinQuaternion(e, 3 + day, out);
    expect(Math.abs(a.dot(b))).toBeCloseTo(1, 9);
    // half a day: a point on the equator is on the far side
    const h = spinQuaternion(e, 3 + day / 2, out);
    const v = new THREE.Vector3(1, 0, 0);
    const v0 = v.clone().applyQuaternion(a), v1 = v.clone().applyQuaternion(h);
    expect(v0.dot(v1)).toBeCloseTo(-1, 6);
  });
  it("turns about +pole for prograde bodies, about -pole for Venus and Uranus", () => {
    for (const b of SOLAR_BODIES) {
      const p = poleWorld(b);
      const q0 = new THREE.Quaternion().copy(spinQuaternion(b, 0, out));
      const dt = 0.01;
      const q1 = spinQuaternion(b, dt, out);
      const d = q1.clone().multiply(q0.clone().invert()); // world-frame rotation over dt
      const s = Math.sqrt(1 - d.w * d.w);
      const axis = new THREE.Vector3(d.x, d.y, d.z).divideScalar(s);
      const sign = Math.sign(axis.dot(p)) * (d.w >= 0 ? 1 : -1);
      expect(sign, b.id).toBe(b.rotationHours < 0 ? -1 : 1);
    }
  });
});

describe("meshScale", () => {
  it("flattens the polar axis only", () => {
    expect(meshScale(bodyById("jupiter"))).toEqual([1, 1 - 0.06487, 1]);
    expect(meshScale(bodyById("jupiter"))[1]).toBeCloseTo(0.935, 3);
    expect(meshScale(bodyById("saturn"))[1]).toBeCloseTo(0.902, 3);
    expect(meshScale(bodyById("mercury"))).toEqual([1, 1, 1]);
  });
});
