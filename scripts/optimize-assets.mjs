// Re-encodes 3D assets from assets-src/ into public/models/.
// Geometry is NEVER simplified (spec constraint) — only welded, deduped,
// quantized, and meshopt-compressed (all visually lossless).
// Fallback if meshopt decoding ever fails at runtime: remove the meshopt()
// call below and re-run; quantized output loads with no decoder.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, quantize, meshopt, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { statSync, existsSync } from "node:fs";

const SRC = "assets-src";
const OUT = "public/models";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
});

const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(2) + "MB";

// Optional filter: `npm run assets:optimize -- creature fuxx` re-encodes only
// those. Without one, everything is processed — but meshopt re-encoding is
// non-deterministic, so a full run rewrites unchanged files byte-differently.
const only = new Set(process.argv.slice(2));
const wanted = (name) => only.size === 0 || only.has(name);

async function processGlb(name, textureTransforms) {
  const src = `${SRC}/${name}.glb`;
  const out = `${OUT}/${name}.glb`;
  const doc = await io.read(src);
  await doc.transform(weld(), dedup(), prune(), ...textureTransforms, quantize(), meshopt({ encoder: MeshoptEncoder }));
  await io.write(out, doc);
  console.log(`${name}.glb  ${mb(src)} -> ${mb(out)}`);
}

// Per-asset texture settings. Default: WebP q92 at authored size. Moons and
// comet nuclei never fill more than a small part of the screen (moon radius
// <= 0.55u; the nucleus sits inside its coma), so their 1024² bakes are
// halved — that alone was ~1MB of download. Hero asteroids keep 1024² (close
// passes at radius up to 7u) with a slightly lighter quality.
const TEXTURE_OPTS = {
  moon: { quality: 88, resize: [512, 512] },
  comet_head: { quality: 88, resize: [512, 512] },
  asteroids: { quality: 85 },
};
const DEFAULT_TEXTURE_OPTS = { quality: 92 };
// Every Blender-authored model, in one list, so a new model cannot get texture
// settings without also being processed (or the other way round).
const MODELS = ["asteroids", "spaceship", "portal_gateway", "space_crystal", "data_shard", "cargo_ship", "creature", "moon", "comet_head", "career_station", "buoy", "shipyard", "dormant_gate"];
for (const k of MODELS) {
  TEXTURE_OPTS[k] ??= DEFAULT_TEXTURE_OPTS;
}

// Player-facing / already-baked models: format conversion only, no resize
// (except the TEXTURE_OPTS above).
// (asteroids.glb = 4 sculpted variants with 512px bakes, replaces the old
// single 4K-textured asteroid.glb)
for (const name of MODELS) {
  if (!wanted(name)) continue;
  if (!existsSync(`${SRC}/${name}.glb`)) {
    console.log(`skip ${name}.glb (not in assets-src)`);
    continue;
  }
  await processGlb(name, [textureCompress({ encoder: sharp, targetFormat: "webp", ...TEXTURE_OPTS[name] })]);
}

// Planet equirect maps (one per project planet, original procedural art from
// scripts/textures/ or scripts/blender/): keep 2048x1024, convert JPEG -> WebP.
// A `<name>_glow.jpg` emissive map is optional per planet.
for (const name of ["ruangrapi", "portfolio", "fuxx"]) {
  if (!wanted(name)) continue;
  for (const file of [name, `${name}_glow`]) {
    if (!existsSync(`${SRC}/${file}.jpg`)) continue;
    await sharp(`${SRC}/${file}.jpg`).webp({ quality: 88 }).toFile(`${OUT}/${file}.webp`);
    console.log(`${file}.webp  ${mb(`${SRC}/${file}.jpg`)} -> ${mb(`${OUT}/${file}.webp`)}`);
    // Optional desktop-only 4096x2048 variant (assets-src/4k/, same generator
    // at --width=4096): planets fill the screen in orbit lock, where 2048
    // texels show as blocks. SpacePlanets picks it on fine-pointer devices.
    const hi = `${SRC}/4k/${file}.jpg`;
    if (!existsSync(hi)) continue;
    await sharp(hi).webp({ quality: 88 }).toFile(`${OUT}/${file}_4k.webp`);
    console.log(`${file}_4k.webp  ${mb(hi)} -> ${mb(`${OUT}/${file}_4k.webp`)}`);
  }
}

// The new worlds' maps (scripts/textures/gen_worlds.mjs, scripts/blender/gen_world_rock.py),
// at their authored sizes. `-- w-rock` also takes w-rock_normal. The ring strip
// is lossless and keeps the colour under transparent texels: its alpha is the
// rings' optical depth, which lossy alpha would smear. The normal map's R and
// G are independent vector components, so plain 4:2:0 chroma subsampling
// would tilt every texel (~3.4 levels RMS); sharp-YUV (smartSubsample) at q90
// brings that to ~2.5 inside the 90 KB cap (tests/worldMaps.test.ts).
const WORLD_WEBP = {
  "w-ringed_ring": { lossless: true, exact: true },
  "w-rock_normal": { quality: 90, smartSubsample: true },
};
for (const file of ["w-rock", "w-rock_normal", "w-ringed", "w-ringed_ring", "w-tilted", "w-blue", "w-dwarf"]) {
  if (!wanted(file) && !wanted(file.split("_")[0])) continue;
  const src = [`${SRC}/${file}.jpg`, `${SRC}/${file}.png`].find((p) => existsSync(p));
  if (!src) {
    console.log(`skip ${file} (not in assets-src)`);
    continue;
  }
  await sharp(src).webp(WORLD_WEBP[file] ?? { quality: 88 }).toFile(`${OUT}/${file}.webp`);
  console.log(`${file}.webp  ${mb(src)} -> ${mb(`${OUT}/${file}.webp`)}`);
}
console.log("Done.");
