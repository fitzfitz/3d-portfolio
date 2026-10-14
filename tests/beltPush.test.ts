import { describe, it, expect } from "vitest";
import {
  toRingLocal, nearRing, stepRock, holdAt,
  BELT_PUSH_RADIUS, BELT_PUSH_HALFLIFE, BELT_RETURN_HALFLIFE,
} from "../src/utils/beltPush";
import { decay } from "../src/utils/reactions";

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const DT = 1 / 60;
const kP = decay(BELT_PUSH_HALFLIFE, DT);
const kR = decay(BELT_RETURN_HALFLIFE, DT);
const dispLen = (d: Float32Array, i = 0) => Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]);

describe("toRingLocal", () => {
  it("is the identity for an untilted ring", () => {
    expect(toRingLocal(v(), v(1, 2, 3), 0)).toEqual(v(1, 2, 3));
  });
  // Both shipped rings: BeltMain (0.436) and the near-vertical BeltHalo (1.31).
  for (const tilt of [0.436, 1.31]) {
    it(`inverts the ring's X tilt of ${tilt}`, () => {
      // A ring-local point (0,0,10), rotated into the world by Rx(tilt)...
      const c = Math.cos(tilt), s = Math.sin(tilt);
      const world = v(0, -s * 10, c * 10);
      // ...comes back to (0,0,10).
      const back = toRingLocal(v(), world, tilt);
      expect(back.x).toBeCloseTo(0, 9);
      expect(back.y).toBeCloseTo(0, 9);
      expect(back.z).toBeCloseTo(10, 9);
    });
  }
});

describe("nearRing", () => {
  it("is true inside the ring's band, padded by the push radius", () => {
    expect(nearRing(v(55, 0, 0), 40, 70)).toBe(true);
    expect(nearRing(v(40 - BELT_PUSH_RADIUS + 1, 0, 0), 40, 70)).toBe(true);
  });
  it("is false well away from it", () => {
    expect(nearRing(v(0, 0, 0), 40, 70)).toBe(false);
    expect(nearRing(v(200, 0, 0), 40, 70)).toBe(false);
  });
});

describe("stepRock", () => {
  it("pushes a rock at the ship's position out to the push radius", () => {
    const d = new Float32Array(3);
    for (let n = 0; n < 60; n++) stepRock(d, 0, 0, 0, 0, v(), kP, kR);
    expect(dispLen(d)).toBeGreaterThan(BELT_PUSH_RADIUS - 0.01);
  });
  it("pushes directly away from the ship", () => {
    const d = new Float32Array(3);
    for (let n = 0; n < 60; n++) stepRock(d, 0, 4, 0, 0, v(), kP, kR); // rock 4u along +x
    expect(d[0]).toBeCloseTo(BELT_PUSH_RADIUS - 4, 2);
    expect(d[1]).toBeCloseTo(0, 6);
    expect(d[2]).toBeCloseTo(0, 6);
  });
  it("leaves a rock beyond the push radius alone", () => {
    const d = new Float32Array(3);
    stepRock(d, 0, BELT_PUSH_RADIUS + 1, 0, 0, v(), kP, kR);
    expect(dispLen(d)).toBe(0);
  });
  it("springs back toward its orbit once the ship has gone", () => {
    const d = new Float32Array([5, 0, 0]);
    for (let n = 0; n < 150; n++) stepRock(d, 0, 0, 0, 0, null, kP, kR); // 2.5s
    expect(dispLen(d)).toBeLessThan(0.5);
  });
  it("addresses rock i's own slots in a shared buffer", () => {
    const d = new Float32Array(9);
    for (let n = 0; n < 60; n++) stepRock(d, 1, 0, 0, 0, v(), kP, kR);
    expect(dispLen(d, 0)).toBe(0);
    expect(dispLen(d, 1)).toBeGreaterThan(BELT_PUSH_RADIUS - 0.01);
    expect(dispLen(d, 2)).toBe(0);
  });
  it("eases a released pebble home from where the beam left it, without a jump", () => {
    const d = new Float32Array(3);
    const orbit = { x: 10, y: 0, z: 0 }, held = { x: 13, y: 1, z: -2 };
    holdAt(d, 0, orbit.x, orbit.y, orbit.z, held.x, held.y, held.z);
    expect([orbit.x + d[0], orbit.y + d[1], orbit.z + d[2]]).toEqual([held.x, held.y, held.z]);
    // First frame after release: still next to where it was held.
    stepRock(d, 0, orbit.x, orbit.y, orbit.z, null, kP, kR);
    expect(Math.hypot(orbit.x + d[0] - held.x, orbit.y + d[1] - held.y, orbit.z + d[2] - held.z)).toBeLessThan(0.1);
    for (let n = 0; n < 150; n++) stepRock(d, 0, orbit.x, orbit.y, orbit.z, null, kP, kR); // 2.5s
    expect(dispLen(d)).toBeLessThan(0.5);
  });
  it("lands exactly on target, finite, after a huge dt", () => {
    const d = new Float32Array(3);
    stepRock(d, 0, 0, 0, 0, v(), decay(BELT_PUSH_HALFLIFE, 5), decay(BELT_RETURN_HALFLIFE, 5));
    expect([d[0], d[1], d[2]].every(Number.isFinite)).toBe(true);
    expect(dispLen(d)).toBeCloseTo(BELT_PUSH_RADIUS, 6);
  });
});
