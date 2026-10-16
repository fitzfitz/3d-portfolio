import { describe, it, expect } from "vitest";
import { makeStarMaterial } from "../src/components/canvas/starLayer";

describe("star layer (L23 no twinkle, L24 fixed stars)", () => {
  it("has no time input: stars do not twinkle or move", () => {
    const m = makeStarMaterial(0.8);
    expect(Object.keys(m.uniforms).sort()).toEqual(["uOpacity", "uPixelRatio"]);
    expect(m.vertexShader).not.toMatch(/uTime|uTwinkle|sin\(/);
    expect(m.fragmentShader).not.toMatch(/uTime|vFlicker/);
  });
  it("keeps the opacity it was given", () => {
    expect(makeStarMaterial(0.8).uniforms.uOpacity.value).toBe(0.8);
  });
});
