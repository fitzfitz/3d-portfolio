import { describe, it, expect } from "vitest";
import { DOT_PX, dotBrightness, dotColor, dotPosition, lambertPhase, needsDot, projectedRadiusPx } from "../src/utils/bodyDots";
import { AU } from "../src/constants";

const FOV = Math.PI / 3;

describe("needsDot: a body under 2 px across is drawn as a dot (spec §6.2)", () => {
  it("Jupiter-sized at 3000 u is still a disc; Ceres-sized there is a dot", () => {
    expect(needsDot(22, 3000, FOV, 800)).toBe(false);
    expect(needsDot(2.95, 3000, FOV, 800)).toBe(true);
  });

  it("switches where the projected radius crosses 1 px (a 2 px disc)", () => {
    // f·r/√(d² − r²) = 1 at d = r·√(1 + f²), f = (H/2)/tan(fov/2).
    const f = 400 / Math.tan(FOV / 2);
    const d = 5 * Math.sqrt(1 + f * f);
    expect(projectedRadiusPx(5, d, FOV, 800)).toBeCloseTo(1, 9);
    expect(needsDot(5, d * 0.999, FOV, 800)).toBe(false);
    expect(needsDot(5, d * 1.001, FOV, 800)).toBe(true);
  });

  it("is never a dot from inside or at the surface", () => {
    expect(needsDot(8, 8, FOV, 800)).toBe(false);
    expect(needsDot(8, 3, FOV, 800)).toBe(false);
  });

  it("a taller viewport or a narrower lens keeps the disc further out", () => {
    expect(needsDot(4, 3000, FOV, 800)).toBe(true);
    expect(needsDot(4, 3000, FOV, 1600)).toBe(false);
    expect(needsDot(4, 3000, FOV / 2, 800)).toBe(false);
  });

  it("the dot is 2 px across: the disc it stands in for", () => {
    expect(DOT_PX).toBe(2);
  });
});

describe("dot colour: the body's colour, sunlit (ruling R25)", () => {
  it("lambertPhase is 1 at full phase, 0 at new, 1/π at quarter", () => {
    expect(lambertPhase(0)).toBeCloseTo(1, 12);
    expect(lambertPhase(Math.PI)).toBeCloseTo(0, 12);
    expect(lambertPhase(Math.PI / 2)).toBeCloseTo(1 / Math.PI, 12);
  });

  it("a crescent is far dimmer than a full disc at the same distance", () => {
    const p = { x: AU, y: 0, z: 0 };
    const full = dotBrightness(p, { x: AU - 500, y: 0, z: 0 }); // camera sunward: α = 0
    // Phase angle α = 150°: the camera 30° off the anti-sunward line, seeing mostly night.
    const a = (150 * Math.PI) / 180;
    const crescent = dotBrightness(p, { x: AU + 500 * Math.cos(Math.PI - a), y: 0, z: 500 * Math.sin(Math.PI - a) });
    expect(full).toBeCloseTo(1, 9);
    expect(crescent).toBeCloseTo(lambertPhase(a), 6);
    expect(crescent).toBeLessThan(0.05 * full);
  });

  it("falls off as the inverse square of the body's distance from the Sun: 1 AU vs 30 AU", () => {
    const at = (r: number) => dotBrightness({ x: r, y: 0, z: 0 }, { x: r - 100, y: 0, z: 0 });
    expect(at(AU)).toBeCloseTo(1, 9);
    expect(at(30 * AU)).toBeCloseTo(1 / 900, 9);
  });

  it("writes colour × brightness, linear, in place", () => {
    const out = { r: 0, g: 0, b: 0 };
    dotColor({ r: 0.5, g: 0.25, b: 1 }, { x: 2 * AU, y: 0, z: 0 }, { x: 2 * AU - 10, y: 0, z: 0 }, out);
    expect(out.r).toBeCloseTo(0.125, 9);
    expect(out.g).toBeCloseTo(0.0625, 9);
    expect(out.b).toBeCloseTo(0.25, 9);
  });

  it("each dot sits on its body's near limb, toward the camera, so its own sphere cannot hide it", () => {
    const out = { x: 0, y: 0, z: 0 };
    dotPosition({ x: 100, y: 0, z: 0 }, 8, { x: 100, y: 0, z: 3000 }, out);
    expect(out.x).toBeCloseTo(100, 9);
    expect(out.z).toBeGreaterThan(8);
    expect(out.z).toBeLessThan(9);
  });
});
