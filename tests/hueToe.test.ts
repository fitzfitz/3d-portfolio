import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { patchHueToe, NEUTRAL_TOE, HUE_KEEPING_TOE } from "../src/components/canvas/hueToe";

const src = (...p: string[]) => readFileSync(join("src", ...p), "utf8");

// three's PBR Neutral toe subtracts one offset from every channel, which
// crushes blue in a dark warm grey: Venus and Saturn read olive. The patch
// takes the same offset off the peak channel as a scale, so the hue holds.
// If a three upgrade changes the chunk's text, the replace silently does
// nothing; these fail instead.
describe("the tone curve's toe keeps the hue", () => {
  const chunk = () => THREE.ShaderChunk.tonemapping_pars_fragment;
  const neutral = () => chunk().slice(chunk().indexOf("vec3 NeutralToneMapping("), chunk().indexOf("vec3 CustomToneMapping("));

  it("replaced three's subtracting toe inside NeutralToneMapping", () => {
    expect(NEUTRAL_TOE).toBe("\tcolor -= offset;");
    expect(chunk()).not.toContain(NEUTRAL_TOE);
    expect(neutral()).toContain(HUE_KEEPING_TOE);
    // In the same place: right after the offset is computed.
    expect(neutral()).toMatch(/float offset = x < 0\.08 \? x - 6\.25 \* x \* x : 0\.04;\n+\tcolor \*= 1\. - offset/);
  });
  it("is idempotent: patching again changes nothing", () => {
    const before = chunk();
    patchHueToe();
    expect(chunk()).toBe(before);
    expect(chunk().split(HUE_KEEPING_TOE)).toHaveLength(2);
  });
  it("runs before any material compiles: GlobalCanvas imports it first, on every tier", () => {
    // GlobalCanvas owns the renderer, the warm-up and the low-perf path
    // (renderer tone mapping without PostFX), so its first import covers all.
    expect(src("components", "canvas", "GlobalCanvas.tsx")).toMatch(/^(\/\/[^\n]*\n)*import "\.\/hueToe";\n/);
  });
});
