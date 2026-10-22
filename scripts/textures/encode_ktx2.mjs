#!/usr/bin/env node
/**
 * Encodes maps as KTX2 (UASTC, rate-distortion tuned, zstd), the GPU's own
 * compressed form: a 4096×2048 map takes ~11 MB of GPU memory instead of
 * ~45 MB uncompressed (memory-budget spec, phase 4). Run after
 * process_body_maps.mjs; it reads the same masters, replaces the WebP it
 * stands in for, and leaves every other map alone.
 *
 *   node scripts/textures/encode_ktx2.mjs            # every map in KTX2_MAPS
 *   KTX=/path/to/ktx node scripts/textures/encode_ktx2.mjs earth_4k
 *
 * Needs KTX-Software's `ktx` (v4.4+, github.com/KhronosGroup/KTX-Software):
 * $KTX, else ~/.local/ktx-software/bin/ktx, else `ktx` on PATH.
 *
 * Choices (Earth 4K from its master, measured 2026-10-22): UASTC with RDO
 * λ 1.0 and zstd 18 is 2.11 MB at ~49 dB PSNR, indistinguishable at 1:1;
 * λ 2.0 and 3.0 saved only 7–11% of the bytes for 2.5 and 4 dB. ETC1S (tried
 * on the WebP) was a quarter the size but 40 dB, smearing coastlines, and
 * an RGBA map takes the same GPU memory either way. The WebP it replaces
 * was 262 KB.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "assets-src");
const OUT = path.join(ROOT, "public", "models");

/**
 * Each map: its master (what process_body_maps.mjs encodes the WebP from)
 * and, for Earth, the ocean mask its alpha carries (oceanGloss.ts).
 */
export const KTX2_MAPS = {
  earth_4k: { master: "4k/earth.jpg", alpha: "4k/earth_ocean.png" },
};

const UASTC = ["--encode", "uastc", "--uastc-quality", "2", "--uastc-rdo", "--uastc-rdo-l", "1.0", "--zstd", "18"];

function ktxBinary() {
  if (process.env.KTX) return process.env.KTX;
  const local = path.join(homedir(), ".local", "ktx-software", "bin", "ktx");
  return existsSync(local) ? local : "ktx";
}

async function encode(name, { master, alpha }) {
  const tmp = mkdtempSync(path.join(tmpdir(), "fitz-ktx2-"));
  try {
    const png = path.join(tmp, `${name}.png`);
    let img = sharp(path.join(SRC, master));
    if (alpha) img = img.joinChannel(path.join(SRC, alpha));
    else img = img.ensureAlpha(1);
    // Join first, flip after, in two passes: within one pipeline sharp flips
    // the image before joining the channel, which left the ocean mask
    // upside down under its colour (bodyMaps.test.ts caught it at 20° S).
    const joined = await img.png({ compressionLevel: 1 }).toBuffer();
    await sharp(joined).flip().png({ compressionLevel: 1 }).toFile(png);
    const out = path.join(OUT, `${name}.ktx2`);
    execFileSync(ktxBinary(), ["create", "--format", "R8G8B8A8_SRGB", "--assign-tf", "srgb", "--generate-mipmap", ...UASTC, png, out], { stdio: "inherit" });
    const webp = path.join(OUT, `${name}.webp`);
    if (existsSync(webp)) rmSync(webp);
    console.log(`${name}.ktx2  ${(statSync(out).size / 1e6).toFixed(2)} MB`);
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
