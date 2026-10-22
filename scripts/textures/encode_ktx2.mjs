#!/usr/bin/env node
/**
 * Encodes the body and moon maps as KTX2, the GPU's own compressed form
 * (memory-budget spec, phase 4): an opaque map as ETC1S, which the GPU holds
 * at half a byte per texel (a 4096×2048 map ~5.6 MB with mipmaps, not ~45),
 * and Earth's, whose alpha carries the ocean mask, as UASTC at one byte.
 * Run after process_body_maps.mjs; it reads the same masters, replaces the
 * WebP each stands in for, and leaves every other file alone.
 *
 *   node scripts/textures/encode_ktx2.mjs            # every map in KTX2_MAPS
 *   KTX=/path/to/ktx node scripts/textures/encode_ktx2.mjs earth_4k
 *
 * Needs KTX-Software's `ktx` (v4.4+, github.com/KhronosGroup/KTX-Software):
 * $KTX, else ~/.local/ktx-software/bin/ktx, else `ktx` on PATH.
 *
 * Choices (measured 2026-10-22, PSNR against the master; the owner chose
 * maps-only ETC1S over UASTC everywhere for the download):
 * - opaque maps, ETC1S at qlevel 255: 7.44 MB for all 19 against 3.88 MB of
 *   WebP and 31.4 MB of UASTC; Mars 2048 36.6 dB (WebP 38.7, UASTC 37.5),
 *   a little softer on crater rims than the WebP at 2×;
 * - Earth (2048 and 4096), UASTC with RDO λ 1.0 and zstd 18: an RGBA map
 *   takes a byte a texel either way, and ETC1S smeared its coastlines and
 *   mask (40 dB); the 4096 is 2.11 MB at ~49 dB. λ 2.0 and 3.0 saved only
 *   7–11% for 2.5 and 4 dB.
 * Mipmaps are made here, so the GPU never generates them. three's KTX2Loader
 * does not flip, so the image is stored bottom row first, as TextureLoader's
 * flipY would draw it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// The fit rereads one decoded file every pass; libvips would serve it from cache.
sharp.cache(false);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "assets-src");
const OUT = path.join(ROOT, "public", "models");

/**
 * Each map: its master (what process_body_maps.mjs, gen_body_maps.mjs or
 * gen_worlds.mjs encode the WebP from) and, for Earth, the ocean mask its
 * alpha carries (oceanGloss.ts). Every body and moon map but two, which stay
 * WebP: Saturn's ring strip, 2048×4 with no mipmaps (ringOptics.ts), and
 * Earth's clouds, whose sRGB-encoded opacity three tests weigh against the
 * ocean beneath (UASTC would cost 1.6 MB of download to save 8 MB of GPU).
 * src/utils/hiResMaps.ts KTX2_VARIANTS lists the same names.
 */
const PLAIN = ["callisto", "ceres", "earth_night", "europa", "ganymede", "io", "jupiter", "mars", "mercury", "moon", "titan", "triton", "venus", "w-blue", "w-ringed", "w-tilted"];
export const KTX2_MAPS = {
  ...Object.fromEntries(PLAIN.map((n) => [n, { master: `${n}.jpg` }])),
  earth: { master: "earth.jpg", alpha: "earth_ocean.png" },
  earth_4k: { master: "4k/earth.jpg", alpha: "4k/earth_ocean.png" },
  mars_4k: { master: "4k/mars.jpg" },
  mercury_4k: { master: "4k/mercury.jpg" },
};

const UASTC = ["--encode", "uastc", "--uastc-quality", "2", "--uastc-rdo", "--uastc-rdo-l", "1.0", "--zstd", "18"];
const ETC1S = ["--encode", "basis-lz", "--qlevel", "255", "--clevel", "4"];

function ktxBinary() {
  if (process.env.KTX) return process.env.KTX;
  const local = path.join(homedir(), ".local", "ktx-software", "bin", "ktx");
  return existsSync(local) ? local : "ktx";
}

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** The linear-luminance texel median, the statistic tests/bodyMaps.test.ts holds to the body's albedo. */
function linearMedian(px, w, h, ch) {
  const L = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) L[k] = 0.2126 * s2l(px[k * ch] / 255) + 0.7152 * s2l(px[k * ch + 1] / 255) + 0.0722 * s2l(px[k * ch + 2] / 255);
  return L.sort()[L.length >> 1];
}
/** Per channel, the mean over all rows of column x. */
function columnMean(px, w, h, ch, x) {
  const m = [0, 0, 0];
  for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) m[c] += px[(y * w + x) * ch + c];
  return m.map((v) => v / h);
}

/** Rows evened at each pole: one 4×4 block, so ETC1S cannot smear row 1–3 detail into the pole row. */
const POLE_BAND = 4;
/** Fit targets: the decoded median within 1% of the master's, the ±180° seam's mean step under half a level. */
const MEDIAN_TOLERANCE = 0.01;
/**
 * Past this the map is encoded as UASTC instead: ETC1S snaps tones to a
 * palette, so its median moves in steps and some maps cannot land inside the
 * 3% the albedo tests hold (the Moon: −4.7% plain, +4.2% one gain step up).
 */
const ETC1S_LIMIT = 0.02;
const SEAM_TOLERANCE = 0.5;
const FIT_PASSES = 12;

/**
 * The input ETC1S is given: the master with its colour scaled in linear light
 * by `gain`, both pole bands evened to their row means (a sphere's pole is
 * one point; process_body_maps.mjs evens the last rows already), and the two
 * edge columns offset by `off` (per channel, opposite signs).
 */
function prepare(master, w, h, gain, off) {
  const out = Buffer.alloc(w * h * 4);
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.min(1, l2s(Math.min(1, s2l(v / 255) * gain))) * 255);
  for (let k = 0; k < w * h; k++) {
    for (let c = 0; c < 3; c++) out[k * 4 + c] = lut[master[k * 3 + c]];
    out[k * 4 + 3] = 255;
  }
  const band = [...Array(POLE_BAND).keys(), ...Array.from({ length: POLE_BAND }, (_, i) => h - 1 - i)];
  for (const y of band) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let x = 0; x < w; x++) sum += out[(y * w + x) * 4 + c];
      const mean = Math.round(sum / w);
      for (let x = 0; x < w; x++) out[(y * w + x) * 4 + c] = mean;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      const l = (y * w) * 4 + c, r = (y * w + w - 1) * 4 + c;
      out[l] = Math.max(0, Math.min(255, Math.round(out[l] + off[c])));
      out[r] = Math.max(0, Math.min(255, Math.round(out[r] - off[c])));
    }
  }
  return out;
}

/**
 * ETC1S quantises dark tones coarsely and codes the two edge blocks apart:
 * plain, it shifted Mercury's and the Moon's median 4.4–4.7% (the tests hold
 * 3%), left 4–5 levels of noise in the pole rows and a 1.3–1.8 level step at
 * Mars's ±180° seam. So the encode is fitted to the decoded result: the gain
 * is bracketed and bisected until the median lands within 1%, and the edge
 * columns are pulled toward each other until the seam's mean step is under
 * half a level. The best pass is kept; past ETC1S_LIMIT, encode() falls back
 * to UASTC for that map.
 */
async function encodeEtc1s(masterPath, out, tmp) {
  const { data: master, info } = await sharp(masterPath).flip().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const target = linearMedian(master, w, h, 3);
  const png = path.join(tmp, "in.png"), trial = path.join(tmp, "trial.ktx2"), decoded = path.join(tmp, "decoded.png");
  let gain = 1, lo = null, hi = null, best = null;
  const off = [0, 0, 0];
  for (let pass = 0; pass < FIT_PASSES; pass++) {
    await sharp(prepare(master, w, h, gain, off), { raw: { width: w, height: h, channels: 4 } }).png({ compressionLevel: 1 }).toFile(png);
    execFileSync(ktxBinary(), ["create", "--format", "R8G8B8A8_SRGB", "--assign-tf", "srgb", "--generate-mipmap", ...ETC1S, png, trial]);
    rmSync(decoded, { force: true });
    execFileSync(ktxBinary(), ["extract", "--transcode", "rgba8", trial, decoded]);
    // ktx extract writes RGB for an opaque map, RGBA otherwise.
    const { data, info: d } = await sharp(decoded).raw().toBuffer({ resolveWithObject: true });
    if (d.width !== w || d.height !== h) throw new Error(`${masterPath}: decoded ${d.width}×${d.height}, master ${w}×${h}`);
    // A map that is mostly black (Earth's night side) has a median of 0: nothing to hold.
    const shift = target > 0 ? linearMedian(data, w, h, d.channels) / target - 1 : 0;
    const left = columnMean(data, w, h, d.channels, 0), right = columnMean(data, w, h, d.channels, w - 1);
    const step = left.map((v, c) => v - right[c]);
    const seam = Math.max(...step.map(Math.abs));
    const score = Math.abs(shift) / MEDIAN_TOLERANCE + seam / SEAM_TOLERANCE;
    if (!best || score < best.score) {
      best = { score, shift, seam, gain };
      execFileSync("cp", [trial, out]);
    }
    if (Math.abs(shift) < MEDIAN_TOLERANCE && seam < SEAM_TOLERANCE) break;
    if (shift < 0) lo = gain; else hi = gain;
    gain = lo !== null && hi !== null ? (lo + hi) / 2 : gain / (1 + shift);
    for (let c = 0; c < 3; c++) off[c] -= step[c] / 2;
  }
  return best;
}

async function encode(name, { master, alpha }) {
  const tmp = mkdtempSync(path.join(tmpdir(), "fitz-ktx2-"));
  try {
    const out = path.join(OUT, `${name}.ktx2`);
    let note = "";
    if (alpha) {
      const png = path.join(tmp, `${name}.png`);
      // Join first, flip after, in two passes: within one pipeline sharp flips
      // the image before joining the channel, which left the ocean mask
      // upside down under its colour (bodyMaps.test.ts caught it at 20° S).
      const joined = await sharp(path.join(SRC, master)).joinChannel(path.join(SRC, alpha)).png({ compressionLevel: 1 }).toBuffer();
      await sharp(joined).flip().png({ compressionLevel: 1 }).toFile(png);
      execFileSync(ktxBinary(), ["create", "--format", "R8G8B8A8_SRGB", "--assign-tf", "srgb", "--generate-mipmap", ...UASTC, png, out], { stdio: "inherit" });
      note = "UASTC";
    } else {
      const fit = await encodeEtc1s(path.join(SRC, master), out, tmp);
      note = `ETC1S, gain ${fit.gain.toFixed(4)}, median ${(fit.shift * 100).toFixed(2)}%, seam ${fit.seam.toFixed(2)}`;
      if (Math.abs(fit.shift) > ETC1S_LIMIT || fit.seam > 1) {
        const png = path.join(tmp, "uastc.png");
        await sharp(path.join(SRC, master)).ensureAlpha(1).png({ compressionLevel: 1 }).toBuffer()
          .then((b) => sharp(b).flip().png({ compressionLevel: 1 }).toFile(png));
        execFileSync(ktxBinary(), ["create", "--format", "R8G8B8A8_SRGB", "--assign-tf", "srgb", "--generate-mipmap", ...UASTC, png, out], { stdio: "inherit" });
        note = `UASTC: ETC1S's best was ${note}`;
      }
    }
    const webp = path.join(OUT, `${name}.webp`);
    if (existsSync(webp)) rmSync(webp);
    console.log(`${name}.ktx2  ${(statSync(out).size / 1e6).toFixed(2)} MB  (${note})`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2);
  for (const [name, spec] of Object.entries(KTX2_MAPS)) {
    if (only.length && !only.includes(name)) continue;
    await encode(name, spec);
  }
}
