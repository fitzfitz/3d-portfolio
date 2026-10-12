import { describe, it, expect } from "vitest";
import { sunVisibility } from "../src/utils/sunOcclusion";

const SUN_R = 8;
const cam = { x: 0, y: 0, z: 100 };

describe("sunVisibility", () => {
  it("is fully visible with nothing in the way", () => {
    expect(sunVisibility(cam, [], SUN_R)).toBe(1);
  });

  it("is fully hidden behind a planet centred on the sight line", () => {
    expect(sunVisibility(cam, [{ x: 0, y: 0, z: 50, r: 16 }], SUN_R)).toBe(0);
  });

  it("is fully visible when the planet is well off the sight line", () => {
    expect(sunVisibility(cam, [{ x: 60, y: 0, z: 50, r: 16 }], SUN_R)).toBe(1);
  });

  it("is partly visible when a planet's limb crosses the disc", () => {
    // Planet angular radius ~0.31 rad, sun ~0.08; the limb sits across the disc.
    const v = sunVisibility(cam, [{ x: 17, y: 0, z: 50, r: 16 }], SUN_R);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it("ignores a planet farther away than the sun", () => {
    expect(sunVisibility(cam, [{ x: 0, y: 0, z: -60, r: 16 }], SUN_R)).toBe(1);
  });

  it("ignores a planet behind the camera", () => {
    expect(sunVisibility(cam, [{ x: 0, y: 0, z: 140, r: 16 }], SUN_R)).toBe(1);
  });

  it("caps a small body's cover at its share of the sun's disc", () => {
    // A 1-unit rock dead centre, close to the sun: covers a sliver, not the sun.
    const v = sunVisibility(cam, [{ x: 0, y: 0, z: 10, r: 1 }], SUN_R);
    expect(v).toBeGreaterThan(0.9);
  });

  it("compounds cover from several bodies", () => {
    const one = sunVisibility(cam, [{ x: 17, y: 0, z: 50, r: 16 }], SUN_R);
    const two = sunVisibility(cam, [{ x: 17, y: 0, z: 50, r: 16 }, { x: -17, y: 0, z: 50, r: 16 }], SUN_R);
    expect(two).toBeLessThan(one);
  });
});
