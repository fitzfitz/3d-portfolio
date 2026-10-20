import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CAMERA_FAR, LOG_DEPTH_BUFFER } from "../src/components/canvas/logDepth";
import { SYSTEM_RADIUS } from "../src/constants";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const count = (s: string, needle: string) => s.split(needle).length - 1;

/**
 * Custom shaders that never meet the scene's depth buffer, so they need no
 * log depth (logDepth.ts). Each with its reason.
 */
const EXEMPT: Record<string, string> = {
  // depthTest: false — the star layers draw behind everything by order.
  "src/components/canvas/starLayer.ts": "not depth-tested",
  // Painted once into a cube map in its own scene, then used as the background.
  "src/components/canvas/SkyBackdrop.tsx": "drawn into its own cube target",
};

describe("depth across the whole system (logDepth.ts, spec §6.2)", () => {
  it("sees past the far side of the system", () => {
    expect(CAMERA_FAR).toBe(8000);
    expect(CAMERA_FAR).toBeGreaterThan(2 * SYSTEM_RADIUS);
    expect(LOG_DEPTH_BUFFER).toBe(true);
  });

  // A custom shader without them compares its hyperbolic depth with the log
  // values in the buffer and hides behind objects far beyond it.
  it("every depth-tested custom shader in src writes the log depth", () => {
    const files = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith("logDepth.ts"));
    const shaderFiles = files.filter((f) => /void main\s*\(/.test(readFileSync(f, "utf8")));
    expect(shaderFiles.length).toBeGreaterThan(8);
    for (const f of shaderFiles) {
      if (EXEMPT[f.replace(/\\/g, "/")]) continue;
      const src = readFileSync(f, "utf8");
      const vertex = count(src, "gl_Position =");
      const fragment = (src.match(/void main\s*\(/g) ?? []).length - vertex;
      expect({ f, vert: count(src, "${LOG_DEPTH_VERT}"), varsV: count(src, "${LOG_DEPTH_VERT_PARS}") })
        .toEqual({ f, vert: vertex, varsV: vertex });
      expect({ f, frag: count(src, "${LOG_DEPTH_FRAG}"), varsF: count(src, "${LOG_DEPTH_FRAG_PARS}") })
        .toEqual({ f, frag: fragment, varsF: fragment });
    }
  });
});
