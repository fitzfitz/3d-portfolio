import { describe, it, expect } from "vitest";
import { worldToRadar } from "../src/utils/radarTransform";

describe("worldToRadar", () => {
  it("target dead ahead maps to straight up", () => {
    // heading 0 = facing +z; target at dz=+100
    // (x is ~0 up to floating-point sign-of-zero; toBeCloseTo avoids the -0/+0 distinction toEqual would enforce)
    const ahead = worldToRadar(0, 100, 0);
    expect(ahead.x).toBeCloseTo(0);
    expect(ahead.up).toBe(100);
    // heading pi/2 = facing +x; target at dx=+100
    const r = worldToRadar(100, 0, Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.up).toBeCloseTo(100);
  });
  it("target to the ship's right maps to screen right", () => {
    // heading 0 (facing +z): world right is -x direction? No: right = (-cos0, sin0) = (-1, 0),
    // so a target at dx=-100 is to the ship's RIGHT and must get positive x.
    expect(worldToRadar(-100, 0, 0).x).toBeCloseTo(100);
    // heading pi/2 (facing +x): right = (0, 1) in x/z, so dz=+100 is right -> positive x.
    expect(worldToRadar(0, 100, Math.PI / 2).x).toBeCloseTo(100);
  });
  it("target behind maps to negative up", () => {
    expect(worldToRadar(0, -100, 0).up).toBeCloseTo(-100);
  });
});
