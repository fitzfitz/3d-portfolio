import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { makeGalaxyMaterial, makeStarMaterial, STAR_RENDER_ORDER } from "../src/components/canvas/starLayer";

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
  it("is background: drawn before opaque geometry and never over a world", () => {
    const m = makeStarMaterial(0.8);
    // Opaque list (drawn before transparent), first in it (negative order).
    expect(m.transparent).toBe(false);
    expect(STAR_RENDER_ORDER).toBeLessThan(0);
    // Ignores and leaves the depth buffer alone: every world drawn after covers it.
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
    // Still additive (three honours a non-Normal blending on an opaque material).
    expect(m.blending).toBe(THREE.AdditiveBlending);
    const canvas = readFileSync(join("src", "components", "canvas", "GlobalCanvas.tsx"), "utf8");
    expect(canvas).toMatch(/<points ref=\{pointsRef\} name="StarLayer" material=\{material\} renderOrder=\{STAR_RENDER_ORDER\}>/);
  });
  it("the distant galaxies are background too: never drawn over a world", () => {
    const m = makeGalaxyMaterial(null);
    expect(m).toBeInstanceOf(THREE.SpriteMaterial);
    expect(m.transparent).toBe(false);
    expect(m.depthTest).toBe(false);
    expect(m.depthWrite).toBe(false);
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.opacity).toBe(0.5);
    const galaxies = readFileSync(join("src", "components", "canvas", "DistantGalaxies.tsx"), "utf8");
    expect(galaxies).toMatch(/<sprite [^>]*material=\{s\.material\} renderOrder=\{STAR_RENDER_ORDER\} \/>/);
  });
});
