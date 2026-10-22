import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TOKSVIG_FRAGMENT, TOKSVIG_NOISE, toksvigRoughness } from "../src/components/canvas/toksvig";

describe("Toksvig: a mipped normal map's lost detail becomes roughness (FOLLOW-UPS: the probes' foil)", () => {
  it("leaves a full-length normal (and the WebP's quantisation noise) alone", () => {
    expect(toksvigRoughness(0.3, 1)).toBeCloseTo(0.3, 6);
    expect(toksvigRoughness(0.3, 1.02)).toBeCloseTo(0.3, 6);
    expect(toksvigRoughness(0.3, 1 - TOKSVIG_NOISE)).toBeCloseTo(0.3, 6);
  });

  it("widens the gloss as the mips average facets into a shorter normal, monotonically, never past 1", () => {
    let prev = toksvigRoughness(0.1, 1);
    for (const len of [0.97, 0.95, 0.92, 0.88, 0.8, 0.6]) {
      const r = toksvigRoughness(0.1, len);
      expect(r).toBeGreaterThan(prev);
      expect(r).toBeLessThanOrEqual(1);
      prev = r;
    }
    expect(toksvigRoughness(0.1, 0.05)).toBe(1);
  });

  it("turns the foil's averaged crinkle (length ~0.92 at the mips seen past 15 u) from a mirror into a broad gloss", () => {
    // The blankets' facets: roughness 0.1–0.4; their mip-4/5 normals measure 0.92–0.95 long.
    expect(toksvigRoughness(0.1, 0.92)).toBeGreaterThan(0.5);
    expect(toksvigRoughness(0.1, 0.95)).toBeGreaterThan(0.4);
  });

  it("is the GLSL the probe patch runs: before the lights read the roughness, from the normal map's own sample", () => {
    expect(TOKSVIG_FRAGMENT).toMatch(/texture2D\( normalMap, vNormalMapUv \)/);
    expect(TOKSVIG_FRAGMENT).toMatch(/roughnessFactor = /);
    const src = readFileSync("src/components/canvas/ProjectProbes.tsx", "utf8");
    expect(src).toMatch(/\$\{TOKSVIG_FRAGMENT\}\s*\n#include <lights_physical_fragment>/);
  });
});
