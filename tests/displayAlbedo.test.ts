import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { existsSync, readFileSync } from "node:fs";
import { SOLAR_BODIES, bodyById } from "../src/data/solarSystem";
import { DISPLAY_KNEE_LINEAR, DISPLAY_TOE_GAMMA, displayAlbedoGain } from "../src/utils/displayAlbedo";

/**
 * The one shared display curve for dark surfaces (docs/UNIVERSE-RULES.md P3):
 * identity at and above Earth's texel median, a power toe below it that
 * keeps the order of real albedos, calibrated so the retired Fuxx map's
 * median (0.0138) keeps its old 3× lift (Task 12 recalibrates on real maps).
 */

const displayed = (a: number) => a * displayAlbedoGain(a);

describe("displayAlbedoGain: one order-preserving curve", () => {
  it("has its knee at Earth's texel median (~0.053 linear)", () => {
    expect(DISPLAY_KNEE_LINEAR).toBe(bodyById("earth").texelMedianLinear);
    expect(DISPLAY_KNEE_LINEAR).toBeCloseTo(0.053, 3);
  });

  it("is the identity at and above the knee: Earth, Venus and the giants are drawn as they are", () => {
    for (const a of [DISPLAY_KNEE_LINEAR, 0.06, 0.095, 0.3, 1]) expect(displayAlbedoGain(a)).toBe(1);
    for (const id of ["earth", "venus", "jupiter", "saturn", "uranus", "neptune"] as const) {
      expect(displayAlbedoGain(bodyById(id).texelMedianLinear), id).toBe(1);
    }
  });

  it("gives the old calibration median (the retired Fuxx map's 0.0138) exactly its 3× lift", () => {
    expect(displayAlbedoGain(0.0138)).toBeCloseTo(3, 12);
  });

  it("follows knee·(a/knee)^γ below the knee, with 0 < γ < 1", () => {
    expect(DISPLAY_TOE_GAMMA).toBeGreaterThan(0);
    expect(DISPLAY_TOE_GAMMA).toBeLessThan(1);
    for (const a of [0.005, 0.016, 0.0255, 0.04]) {
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

  it("keeps a darker real surface darker on screen: Mercury above Ceres", () => {
    expect(displayed(bodyById("mercury").texelMedianLinear)).toBeGreaterThan(displayed(bodyById("ceres").texelMedianLinear));
  });

  it("draws the bodies in the order of their real geometric albedos (ties where interim maps are shared)", () => {
    // Geometric albedos: NASA NSSDC fact sheets; Ceres, Dawn. The interim maps
    // (Task 12 replaces them) share medians: Jupiter with Saturn, Mars with Mercury.
    const byGeometric = [...SOLAR_BODIES].sort((a, b) => b.geometricAlbedo - a.geometricAlbedo);
    for (let i = 1; i < byGeometric.length; i++) {
      const brighter = byGeometric[i - 1], darker = byGeometric[i];
      expect(displayed(darker.texelMedianLinear), `${darker.id} ≤ ${brighter.id}`).toBeLessThanOrEqual(displayed(brighter.texelMedianLinear));
    }
  });
});

describe("each body's statistic matches its shipped map", () => {
  // The same statistic for every body: the median linear luminance of the
  // shipped map (as tests/worldMaps.test.ts measures). A regenerated texture
  // that drifts more than 3% must update its number, so its gain follows.
  const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  async function median(file: string) {
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const n = info.width * info.height, ch = info.channels, lum = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      lum[k] = 0.2126 * srgbToLinear(data[k * ch] / 255) + 0.7152 * srgbToLinear(data[k * ch + 1] / 255) + 0.0722 * srgbToLinear(data[k * ch + 2] / 255);
    }
    lum.sort();
    return lum[Math.floor(n / 2)];
  }
  // Venus has no map yet (a tint at its scene-scale albedo).
  const bodies = SOLAR_BODIES.filter((b) => b.map !== "").map((b) => ({ name: b.id, map: b.map, stat: b.texelMedianLinear }));
  for (const b of bodies) {
    // The desktop's 4k variant (SolarBodies' HI_RES_MAPS) must agree too.
    for (const file of [`public/models/${b.map}.webp`, `public/models/${b.map}_4k.webp`].filter(existsSync)) {
      it(`${b.name}: ${file} median within 3% of ${b.stat}`, async () => {
        const m = await median(file);
        expect(Math.abs(m / b.stat - 1)).toBeLessThan(0.03);
      });
    }
  }
});

describe("the rule is applied to every body, through its material colour", () => {
  it("SolarBodies sets each surface's colour from the rule; the Fuxx-only lift is gone", () => {
    const src = readFileSync("src/components/canvas/SolarBodies.tsx", "utf8");
    expect(src).toMatch(/multiplyScalar\(displayAlbedoGain\(b\.texelMedianLinear\)\)/);
    expect(src).toMatch(/m\.color\.copy\(bodyColor\(b\)\)/);
    expect(src).not.toMatch(/FUXX_ALBEDO_LIFT/);
    expect(readFileSync("src/utils/sunLight.ts", "utf8")).not.toMatch(/FUXX_ALBEDO_LIFT|FUXX_TEXEL_P90_LINEAR/);
  });
});
