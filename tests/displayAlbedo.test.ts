import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SOLAR_BODIES, bodyById } from "../src/data/solarSystem";
import { SOLAR_MOONS } from "../src/data/solarMoons";
import { DISPLAY_KNEE_LINEAR, DISPLAY_TOE_GAMMA, displayAlbedoGain } from "../src/utils/displayAlbedo";

/**
 * The one shared display curve for dark surfaces (docs/UNIVERSE-RULES.md P3):
 * identity at and above Earth's texel median, a power toe below it that
 * keeps the order of real albedos, calibrated by the "dimmest named body"
 * method: the dimmest mapped body gets exactly the 3× lift the curve was
 * first calibrated on (the retired Fuxx map's). On the real maps that is
 * Ceres. Each map's statistic is checked against its shipped file in
 * tests/bodyMaps.test.ts.
 */

const displayed = (a: number) => a * displayAlbedoGain(a);

/** Every mapped surface: the nine bodies and the moons drawn as spheres. */
const SURFACES = [
  ...SOLAR_BODIES.map((b) => ({ id: b.id as string, albedo: b.geometricAlbedo, stat: b.texelMedianLinear })),
  ...SOLAR_MOONS.filter((m) => !m.shape).map((m) => ({ id: m.id as string, albedo: m.geometricAlbedo, stat: m.texelMedianLinear })),
];

describe("displayAlbedoGain: one order-preserving curve", () => {
  it("has its knee at Earth's texel median (under its clouds: 0.177 × 0.434 ≈ 0.077 linear)", () => {
    expect(DISPLAY_KNEE_LINEAR).toBe(bodyById("earth").texelMedianLinear);
    expect(DISPLAY_KNEE_LINEAR).toBeCloseTo(0.0768, 3);
  });

  it("is the identity at and above the knee: Earth, Venus, the giants and the bright moons are drawn as they are", () => {
    for (const a of [DISPLAY_KNEE_LINEAR, 0.08, 0.095, 0.3, 1]) expect(displayAlbedoGain(a)).toBe(1);
    for (const id of ["earth", "venus", "jupiter", "saturn", "uranus", "neptune"] as const) {
      expect(displayAlbedoGain(bodyById(id).texelMedianLinear), id).toBe(1);
    }
    for (const s of SURFACES.filter((x) => ["io", "europa", "ganymede", "triton"].includes(x.id))) {
      expect(displayAlbedoGain(s.stat), s.id).toBe(1);
    }
  });

  it("is calibrated on the dimmest named body: Ceres, which gets exactly 3×", () => {
    const dimmest = [...SURFACES].sort((a, b) => a.stat - b.stat)[0];
    expect(dimmest.id).toBe("ceres");
    expect(displayAlbedoGain(dimmest.stat)).toBeCloseTo(3, 12);
  });

  it("follows knee·(a/knee)^γ below the knee, with 0 < γ < 1", () => {
    expect(DISPLAY_TOE_GAMMA).toBeGreaterThan(0);
    expect(DISPLAY_TOE_GAMMA).toBeLessThan(1);
    for (const a of [0.005, 0.016, 0.0255, 0.04, 0.07]) {
      expect(displayed(a)).toBeCloseTo(DISPLAY_KNEE_LINEAR * (a / DISPLAY_KNEE_LINEAR) ** DISPLAY_TOE_GAMMA, 12);
    }
  });

  it("only ever brightens, is continuous at the knee and strictly order-preserving", () => {
    let prev = 0;
    for (let a = 0.001; a <= 0.2; a += 0.0005) {
      expect(displayAlbedoGain(a)).toBeGreaterThanOrEqual(1);
      expect(displayed(a), `a=${a}`).toBeGreaterThan(prev);
      prev = displayed(a);
    }
    expect(displayed(DISPLAY_KNEE_LINEAR * (1 - 1e-9))).toBeCloseTo(DISPLAY_KNEE_LINEAR, 9);
  });

  it("keeps a darker real surface darker on screen: Mercury above Ceres, the Moon between", () => {
    const d = (id: string) => displayed(SURFACES.find((s) => s.id === id)!.stat);
    expect(d("mercury")).toBeGreaterThan(d("moon"));
    expect(d("moon")).toBeGreaterThan(d("ceres"));
  });

  it("draws every body and moon strictly in the order of its real geometric albedo", () => {
    // Geometric albedos: NASA NSSDC planetary and satellite fact sheets.
    const byGeometric = [...SURFACES].sort((a, b) => b.albedo - a.albedo);
    for (let i = 1; i < byGeometric.length; i++) {
      const brighter = byGeometric[i - 1], darker = byGeometric[i];
      expect(displayed(darker.stat), `${darker.id} < ${brighter.id}`).toBeLessThan(displayed(brighter.stat));
    }
  });
});

describe("the rule is applied to every body, through its material colour", () => {
  it("SolarBodies sets each surface's colour from the rule; the Fuxx-only lift and the interim tints are gone", () => {
    const src = readFileSync("src/components/canvas/SolarBodies.tsx", "utf8");
    expect(src).toMatch(/multiplyScalar\(displayAlbedoGain\(b\.texelMedianLinear\)\)/);
    expect(src).not.toMatch(/\.tint\b/);
    expect(src).toMatch(/m\.color\.copy\(bodyColor\(b\)\)/);
    expect(src).not.toMatch(/FUXX_ALBEDO_LIFT/);
    expect(readFileSync("src/utils/sunLight.ts", "utf8")).not.toMatch(/FUXX_ALBEDO_LIFT|FUXX_TEXEL_P90_LINEAR/);
  });
});
