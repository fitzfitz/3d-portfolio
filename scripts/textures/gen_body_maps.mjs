#!/usr/bin/env node
/**
 * Seeded maps for the real bodies no true-colour global map exists of
 * (real-solar-system spec §5.5): original work, no source imagery.
 *
 *   node scripts/textures/gen_body_maps.mjs                    # all, native widths
 *   node scripts/textures/gen_body_maps.mjs venus --width=64 --out=/tmp/x
 *
 * Writes to assets-src/:
 *   venus.jpg        2048  Venus: the featureless cream cloud deck seen in visible
 *                          light, with faint zonal banding and the super-rotating
 *                          haze's long streaks (a few percent at most)
 *   titan.jpg        2048  Titan: the orange photochemical haze, nearly uniform,
 *                          a slightly darker, greyer north polar hood and faint bands
 *   triton_fill.png  2048  Triton: zero-mean surface detail (grey around 128) that
 *                          process_body_maps.mjs lays over the smooth colour it fills
 *                          into the part of PIA18668 Voyager 2 never saw, scaled to
 *                          the imaged part's own texture contrast
 *
 * Uranus and Neptune keep gen_worlds.mjs's w-tilted and w-blue (and Saturn
 * its w-ringed): those were already Voyager/Cassini-calibrated Uranus-,
 * Neptune- and Saturn-type maps, honest to the real albedos (each median is
 * within 2% of 0.177 × geometric).
 *
 * Albedo is honest: each colour map is scaled in linear light so its
 * linear-luminance texel median is 0.177 × the body's NASA geometric albedo
 * (the scene's scale; tests/bodyMaps.test.ts). Noise, sphere sampling and
 * the JPEG writer are gen_planets.mjs's (seam-safe, THREE.SphereGeometry's
 * layout, byte-for-byte deterministic).
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { clamp, fbm, forEachPixel, makeSimplex, ramp, smooth, sphereGrid, writeJpeg } from "./gen_planets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEG = Math.PI / 180;

/** The scene's albedo scale (Jupiter's 0.538 ↔ its map's 0.095). */
export const ALBEDO_SCALE = 0.177;
/** NASA NSSDC geometric albedos (planetary and Saturnian satellite fact sheets). */
export const TARGET_MEDIAN = { venus: ALBEDO_SCALE * 0.689, titan: ALBEDO_SCALE * 0.22 };

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Scales an sRGB buffer in linear light so its linear-luminance median is `target`. */
function calibrate(rgb, target) {
  const n = rgb.length / 3;
  const L = new Float32Array(n);
  for (let k = 0; k < n; k++) L[k] = lum(s2l(clamp(rgb[k * 3])), s2l(clamp(rgb[k * 3 + 1])), s2l(clamp(rgb[k * 3 + 2])));
  const s = target / Math.max(L.slice().sort()[n >> 1], 1e-6);
  for (let k = 0; k < rgb.length; k++) rgb[k] = l2s(clamp(s2l(clamp(rgb[k])) * s));
  return s;
}

// =================================================================
// Venus — the cloud deck in visible light
// =================================================================

function genVenus(W) {
  const G = sphereGrid(W, W / 2);
  const nB = makeSimplex(901), nW = makeSimplex(902), nS = makeSimplex(903);
  // Pale cream (Venus's visible reflectance falls a little toward the blue).
  // Kept close to neutral: at the scene's albedo (0.122 linear) the tone
  // mapping's toe saturates a dim pixel, and the first, yellower cream read
  // olive-mustard in game (look check 2026-10-20; the w-tilted lesson).
  const pal = ramp([[0, "#d9d1bd"], [0.5, "#e6dfcc"], [1, "#f0ebdc"]]);
  const rgb = new Float32Array(W * (W / 2) * 3);
  const c = [0, 0, 0];
  forEachPixel(G, (k, x, y, z) => {
    // the deck's flow is zonal: warp latitude a little, stretch streaks in longitude
    const L = Math.asin(clamp(y, -1, 1)) / DEG + 2.5 * fbm(nW, x * 1.5, y * 4, z * 1.5, 3);
    let v = 0.5 + 0.035 * Math.sin(L * 0.11) + 0.02 * nB(L * 0.09, 1.7, 4.2);
    v += 0.03 * fbm(nS, x * 3, y * 26, z * 3, 3);   // long, faint streaks
    v -= 0.06 * smooth(55, 85, Math.abs(L));       // slightly dimmer polar collars
    pal(clamp(v), c);
    rgb[k * 3] = c[0]; rgb[k * 3 + 1] = c[1]; rgb[k * 3 + 2] = c[2];
  });
  calibrate(rgb, TARGET_MEDIAN.venus);
  return rgb;
}

// =================================================================
// Titan — the orange haze
// =================================================================

function genTitan(W) {
  const G = sphereGrid(W, W / 2);
  const nB = makeSimplex(911), nW = makeSimplex(912);
  // Tan-orange, less saturated than it looks in print for the same toe reason.
  const pal = ramp([[0, "#a07a45"], [0.5, "#b68d55"], [1, "#c49c63"]]);
  const hood = [0.52, 0.47, 0.38]; // greyer, darker north polar hood (Cassini)
  const rgb = new Float32Array(W * (W / 2) * 3);
  const c = [0, 0, 0];
  forEachPixel(G, (k, x, y, z) => {
    const L = Math.asin(clamp(y, -1, 1)) / DEG + 1.5 * fbm(nW, x * 1.2, y * 3, z * 1.2, 3);
    let v = 0.5 + 0.03 * Math.sin(L * 0.07) + 0.015 * nB(L * 0.08, 3.1, 0.7);
    v += 0.03 * smooth(-10, -60, L); // the south a touch brighter (seasonal asymmetry)
    pal(clamp(v), c);
    const h = 0.55 * smooth(50, 72, L);
    for (let i = 0; i < 3; i++) c[i] = c[i] * (1 - h) + hood[i] * h;
    rgb[k * 3] = c[0]; rgb[k * 3 + 1] = c[1]; rgb[k * 3 + 2] = c[2];
  });
  calibrate(rgb, TARGET_MEDIAN.titan);
  return rgb;
}

// =================================================================
// Triton fill — zero-mean detail for the unimaged north
// =================================================================

/**
 * Grey around 0.5: mottled "cantaloupe"-scale detail (cells of a few
 * hundred km on a 2,707 km moon) plus finer grain, unit standard deviation
 * scaled to 0.12. process_body_maps.mjs rescales it to the imaged part's
 * contrast before laying it over the filled colour.
 */
function genTritonFill(W) {
  const G = sphereGrid(W, W / 2);
  const nA = makeSimplex(921), nB = makeSimplex(922);
  const grey = new Float32Array(W * (W / 2));
  forEachPixel(G, (k, x, y, z) => {
    const cells = Math.abs(fbm(nA, x * 9, y * 9, z * 9, 4));
    const grain = fbm(nB, x * 40, y * 40, z * 40, 3);
    grey[k] = 0.5 + 0.12 * (1.6 * (cells - 0.3) + 0.6 * grain);
  });
  return grey;
}

// ------------------------------------------------------------------- main

const MAPS = {
  venus: { width: 2048, gen: genVenus, kind: "rgb" },
  titan: { width: 2048, gen: genTitan, kind: "rgb" },
  triton_fill: { width: 2048, gen: genTritonFill, kind: "grey" },
};

async function main() {
  const args = process.argv.slice(2);
  const opt = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
  const names = args.filter((a) => !a.startsWith("--"));
  const override = opt.width === undefined ? null : Number(opt.width);
  if (override !== null && (!Number.isInteger(override) || override % 2)) throw new Error("--width must be an even integer");
  const outDir = path.resolve(opt.out ?? path.join(ROOT, "assets-src"));
  mkdirSync(outDir, { recursive: true });
  for (const name of names.length ? names : Object.keys(MAPS)) {
    const m = MAPS[name];
    if (!m) throw new Error(`unknown map "${name}" (expected: ${Object.keys(MAPS).join(", ")})`);
    const W = override ?? m.width, H = W / 2;
    const t = Date.now();
    console.log(`${name} @ ${W}x${H}`);
    if (m.kind === "rgb") {
      await writeJpeg(m.gen(W), W, H, path.join(outDir, `${name}.jpg`));
    } else {
      const g = m.gen(W);
      const out = Buffer.alloc(W * H);
      for (let k = 0; k < out.length; k++) out[k] = Math.round(clamp(g[k]) * 255);
      const file = path.join(outDir, `${name}.png`);
      await sharp(out, { raw: { width: W, height: H, channels: 1 } }).png({ compressionLevel: 9 }).toFile(file);
      console.log("  wrote", path.relative(ROOT, file) || file);
    }
    console.log(`  ${((Date.now() - t) / 1000).toFixed(1)}s`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
