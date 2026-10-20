import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { STAR_RENDER_ORDER } from "../src/components/canvas/starLayer";

/** SolarBodies.tsx, the one renderer for the nine bodies (source checks for what a unit test cannot mount). */
const src = readFileSync("src/components/canvas/SolarBodies.tsx", "utf8");

describe("the bodies' transparent layers' draw order", () => {
  it("is limb, atmosphere, ring, all between the stars and the order-0 transparents (the ring depth-sorts with them)", () => {
    const m = src.match(/const BODY_RENDER_ORDER = \{ limb: (-?[\d.]+), atmosphere: (-?[\d.]+), ring: (-?[\d.]+) \} as const;/);
    expect(m).not.toBeNull();
    const [limb, atmosphere, ring] = m!.slice(1).map(Number);
    expect(limb).toBeGreaterThan(STAR_RENDER_ORDER);
    expect(atmosphere).toBeGreaterThan(limb);
    expect(ring).toBeGreaterThan(atmosphere);
    // Above 0 the ring would draw after every order-0 transparent, the ship's
    // plume in front of it included, whatever their depths.
    expect(ring).toBe(0);
    for (const k of ["limb", "atmosphere", "ring"]) expect(src).toContain(`renderOrder={BODY_RENDER_ORDER.${k}}`);
  });
});

describe("what SolarBodies draws", () => {
  it("draws Saturn's rings only: Earth's fictional ring is gone (spec §5.5)", () => {
    expect(src).toMatch(/b\.look\.rings === "saturn" && \(/);
    expect(src).not.toMatch(/PlanetRing_|ruangrapi_ring/);
  });

  it("keeps all nine orbit ribbons always visible (charting rewards the radar arrow and the chart)", () => {
    expect(src).toMatch(/name=\{`BodyOrbit_\$\{b\.id\}`\}/);
    expect(src).not.toMatch(/visible=\{false\}/);
  });

  it("writes `bodies` through updateBodies, once a frame, on the ambient clock", () => {
    expect(src).toMatch(/updateBodies\(time, bodies\)/);
  });
});
