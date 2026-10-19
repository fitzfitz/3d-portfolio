import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { existsSync, readFileSync } from "node:fs";
import { PLANET_PROPS, planets } from "../src/constants";
import { WORLDS } from "../src/data/worlds";
import { DISPLAY_KNEE_LINEAR, DISPLAY_TOE_GAMMA, displayAlbedoGain } from "../src/utils/displayAlbedo";

/**
 * The one shared display curve for dark surfaces (docs/UNIVERSE-RULES.md P3):
 * identity at and above Ruangrapi's texel median, a power toe below it that
 * keeps the order of real albedos, calibrated so Fuxx keeps its old 3× lift.
 */

const displayed = (a: number) => a * displayAlbedoGain(a);

describe("displayAlbedoGain: one order-preserving curve", () => {
  it("has its knee at Ruangrapi's texel median (~0.053 linear)", () => {
    expect(DISPLAY_KNEE_LINEAR).toBe(PLANET_PROPS.ruangrapi.texelMedianLinear);
    expect(DISPLAY_KNEE_LINEAR).toBeCloseTo(0.053, 3);
  });

  it("is the identity at and above the knee: Ruangrapi, Portfolio and the giants are drawn as they are", () => {
    for (const a of [DISPLAY_KNEE_LINEAR, 0.06, 0.095, 0.3, 1]) expect(displayAlbedoGain(a)).toBe(1);
    expect(displayAlbedoGain(PLANET_PROPS.ruangrapi.texelMedianLinear)).toBe(1);
    expect(displayAlbedoGain(PLANET_PROPS.portfolio.texelMedianLinear)).toBe(1);
    for (const w of WORLDS.filter((x) => x.texelMedianLinear >= DISPLAY_KNEE_LINEAR)) {
      expect(displayAlbedoGain(w.texelMedianLinear), w.id).toBe(1);
    }
  });

  it("gives Fuxx exactly its old 3× lift: the special case is an instance of the rule", () => {
    expect(displayAlbedoGain(PLANET_PROPS.fuxx.texelMedianLinear)).toBeCloseTo(3, 12);
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

  it("keeps a darker real surface darker on screen: the rock above the dwarf", () => {
    const rock = WORLDS.find((w) => w.id === "w-rock")!, dwarf = WORLDS.find((w) => w.id === "w-dwarf")!;
    expect(displayed(rock.texelMedianLinear)).toBeGreaterThan(displayed(dwarf.texelMedianLinear));
  });

  it("draws the worlds in the order of their real albedos", () => {
    // Real geometric albedos of the namesakes (NASA NSSDC fact sheets; Ceres, Dawn): their order is the Bond order too.
    const GEOMETRIC: Record<string, number> = { Saturn: 0.499, Uranus: 0.488, Neptune: 0.442, Mercury: 0.142, Ceres: 0.09 };
    const byDisplayed = [...WORLDS].sort((a, b) => displayed(b.texelMedianLinear) - displayed(a.texelMedianLinear)).map((w) => w.id);
    const byBond = [...WORLDS].sort((a, b) => b.bondAlbedo - a.bondAlbedo).map((w) => w.id);
    const byGeometric = [...WORLDS].sort((a, b) => GEOMETRIC[b.namesake] - GEOMETRIC[a.namesake]).map((w) => w.id);
    expect(byDisplayed).toEqual(byBond);
    expect(byDisplayed).toEqual(byGeometric);
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
  const bodies = [
    ...planets.map((p) => ({ name: p.name, map: p.name, stat: p.texelMedianLinear })),
    ...WORLDS.map((w) => ({ name: w.id, map: w.map, stat: w.texelMedianLinear })),
  ];
  for (const b of bodies) {
    // The desktop's 4k variant (SpacePlanets' HI_RES_MAPS) must agree too.
    for (const file of [`public/models/${b.map}.webp`, `public/models/${b.map}_4k.webp`].filter(existsSync)) {
      it(`${b.name}: ${file} median within 3% of ${b.stat}`, async () => {
        const m = await median(file);
        expect(Math.abs(m / b.stat - 1)).toBeLessThan(0.03);
      });
    }
  }
});

describe("the rule is applied to every body, through its material colour", () => {
  it("SpacePlanets and SpaceWorlds set each surface's colour from the rule; the Fuxx-only lift is gone", () => {
    const planetsSrc = readFileSync("src/components/canvas/SpacePlanets.tsx", "utf8");
    const worldsSrc = readFileSync("src/components/canvas/SpaceWorlds.tsx", "utf8");
    expect(planetsSrc).toMatch(/color\.setScalar\(displayAlbedoGain\(planets\[i\]\.texelMedianLinear\)\)/);
    expect(worldsSrc).toMatch(/color\.setScalar\(displayAlbedoGain\(w\.texelMedianLinear\)\)/);
    expect(planetsSrc).not.toMatch(/FUXX_ALBEDO_LIFT/);
    expect(readFileSync("src/utils/sunLight.ts", "utf8")).not.toMatch(/FUXX_ALBEDO_LIFT|FUXX_TEXEL_P90_LINEAR/);
  });
});
