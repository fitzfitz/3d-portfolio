import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import * as THREE from "three";
import { IO_HOT_SPOTS } from "../src/data/ioHotSpots";
import { ioGlowAt, ioGlowMask, IO_GLOW_SIZE } from "../src/utils/ioGlow";
import { eclipseGlow, NIGHT_GLOW_FRAGMENT, nightGlowFactor, patchNightGlow } from "../src/components/canvas/nightGlow";
import { readKtx2 } from "./ktx2Image";

/**
 * Io's hot spots (spec §5.5, L33): a faint glow from the catalogued volcanic
 * centres, on the night side or in eclipse only, sharing Earth's night-lights
 * program.
 */

const spot = (name: string) => IO_HOT_SPOTS.find((s) => s.name === name)!;

describe("nightGlowFactor: the night-side mask Earth's lights and Io's glow share", () => {
  it("is zero everywhere on the lit hemisphere outside an eclipse", () => {
    for (let d = 0; d <= 1.0001; d += 0.01) expect(nightGlowFactor(d, 0), `n·sun ${d}`).toBe(0);
  });

  it("is full on the night side, past a short twilight", () => {
    expect(nightGlowFactor(-0.2, 0)).toBe(1);
    expect(nightGlowFactor(-1, 0)).toBe(1);
    const mid = nightGlowFactor(-0.1, 0);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("shows the glow on the day side too while the body is in eclipse", () => {
    expect(nightGlowFactor(0.9, 1)).toBe(1);
    expect(nightGlowFactor(0.9, 0.4)).toBeCloseTo(0.4, 12);
  });

  it("lights Io's day side only once Jupiter hides more than half the sun (the drawn sun's penumbra is wide)", () => {
    expect(eclipseGlow(1)).toBe(0);
    expect(eclipseGlow(0.7)).toBe(0); // Io in the wide penumbra (Task 14)
    expect(eclipseGlow(0.5)).toBe(0);
    expect(eclipseGlow(0.25)).toBeGreaterThan(0);
    expect(eclipseGlow(0)).toBe(1);
    expect(readFileSync("src/components/canvas/SolarMoons.tsx", "utf8")).toMatch(/ioEclipse\.value = eclipseGlow\(sunShadowCoverage\(io, occluders\)\)/);
  });

  it("is what the shader computes", () => {
    expect(NIGHT_GLOW_FRAGMENT).toMatch(/max\(\s*smoothstep\(\s*0\.0\s*,\s*-0\.2\s*,\s*dot\(\s*normal\s*,\s*toSun\s*\)\s*\)\s*,\s*uNightEclipse\s*\)/);
    expect(NIGHT_GLOW_FRAGMENT).toMatch(/totalEmissiveRadiance \*=/);
  });
});

describe("patchNightGlow", () => {
  it("gives Earth and Io the same compile hook (so one program) and each its own eclipse uniform", () => {
    const earth = new THREE.MeshStandardMaterial();
    const io = new THREE.MeshStandardMaterial();
    const e1 = patchNightGlow(earth);
    const e2 = patchNightGlow(io, { value: 0.5 });
    expect(earth.onBeforeCompile).toBe(io.onBeforeCompile);
    expect(earth.customProgramCacheKey()).toBe(io.customProgramCacheKey());
    expect(e1).not.toBe(e2);
    expect(e2.value).toBe(0.5);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: "",
      fragmentShader: "#include <common>\n#include <emissivemap_fragment>\n",
    };
    io.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.uNightEclipse).toBe(e2);
    expect(shader.fragmentShader).toContain("uniform vec3 uSunView;");
    expect(shader.fragmentShader).toContain("uniform float uNightEclipse;");
    expect(shader.fragmentShader).toContain(NIGHT_GLOW_FRAGMENT);
  });

  it("is how SolarBodies lights Earth's cities and SolarMoons Io's hot spots", () => {
    expect(readFileSync("src/components/canvas/SolarBodies.tsx", "utf8")).toMatch(/patchNightGlow\(m\)/);
    const moons = readFileSync("src/components/canvas/SolarMoons.tsx", "utf8");
    expect(moons).toMatch(/patchNightGlow\(/);
    expect(moons).toMatch(/emissiveMap = /);
  });
});

describe("Io's glow mask", () => {
  it("is bright at the strongest hot spots (Loki, Pele) and present at the others", () => {
    expect(ioGlowAt(spot("Loki Patera").latDeg, -spot("Loki Patera").lonWDeg)).toBeGreaterThan(0.8);
    expect(ioGlowAt(spot("Pele").latDeg, -spot("Pele").lonWDeg)).toBeGreaterThan(0.4);
    for (const s of IO_HOT_SPOTS) expect(ioGlowAt(s.latDeg, -s.lonWDeg), s.name).toBeGreaterThan(0.15);
    expect(IO_HOT_SPOTS.length).toBeGreaterThanOrEqual(10);
  });

  it("is zero away from them (most of the surface does not glow)", () => {
    expect(ioGlowAt(0, 0)).toBeLessThan(1e-3); // the sub-Jovian point
    expect(ioGlowAt(-80, 0)).toBeLessThan(1e-3);
    const mask = ioGlowMask();
    const [w, h] = IO_GLOW_SIZE;
    expect(mask.length).toBe(w * h);
    let lit = 0, peak = 0;
    for (const v of mask) { if (v > 2) lit++; peak = Math.max(peak, v); }
    expect(lit / mask.length).toBeLessThan(0.08);
    expect(peak).toBeGreaterThan(240); // Loki, sampled within half a texel of its centre
  });

  it("is laid out like the Io map (east-positive, the prime meridian at u = 0.5, north up)", () => {
    const [w, h] = IO_GLOW_SIZE;
    const mask = ioGlowMask();
    const loki = spot("Loki Patera");
    const u = 0.5 - loki.lonWDeg / 360 + 1;
    const x = Math.floor((u % 1) * w);
    // Row 0 is the south (a DataTexture is not flipped: v = 0 at the bottom).
    const y = Math.floor(((loki.latDeg + 90) / 180) * h);
    expect(mask[y * w + x]).toBeGreaterThan(200);
  });

  it("sits on the dark paterae of the shipped Io map (Loki, Prometheus): the catalogue and the map agree", async () => {
    // The shipped map, decoded as the GPU gets it (KTX2 since PR 47).
    const k = await readKtx2("public/models/io.ktx2");
    const { data, info } = await sharp(k.data, { raw: { width: k.w, height: k.h, channels: 4 } }).resize(720, 360).raw().toBuffer({ resolveWithObject: true });
    const s2l = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = (x: number, y: number) => {
      const o = (y * info.width + ((x % info.width) + info.width) % info.width) * info.channels;
      return 0.2126 * s2l(data[o]) + 0.7152 * s2l(data[o + 1]) + 0.0722 * s2l(data[o + 2]);
    };
    const all: number[] = [];
    for (let y = 0; y < info.height; y += 3) for (let x = 0; x < info.width; x += 3) all.push(lum(x, y));
    all.sort((a, b) => a - b);
    const median = all[all.length >> 1];
    for (const name of ["Loki Patera", "Prometheus"]) {
      const s = spot(name);
      const cx = Math.round((0.5 - s.lonWDeg / 360 + 1) % 1 * info.width), cy = Math.round((90 - s.latDeg) / 180 * info.height);
      let min = Infinity;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) min = Math.min(min, lum(cx + dx, cy + dy));
      expect(min, name).toBeLessThan(0.5 * median);
    }
  });
});
