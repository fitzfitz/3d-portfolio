// Re-encodes 3D assets from assets-src/ into public/models/ (and the
// ONDEMAND_MODELS into public/models-ondemand/).
// Geometry is NEVER simplified (spec constraint) — only welded, deduped,
// quantized, and meshopt-compressed (all visually lossless).
// Fallback if meshopt decoding ever fails at runtime: remove the meshopt()
// call below and re-run; quantized output loads with no decoder.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, quantize, meshopt, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { statSync, existsSync, mkdirSync } from "node:fs";

const SRC = "assets-src";
const OUT = "public/models";
// On-demand models: compressed for the game but kept out of public/models, whose
// every file vite.config.ts packs into the asset packs each visitor downloads.
// They ship as loose files, fetched only when a stage needs them.
const ONDEMAND_OUT = "public/models-ondemand";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
});

const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(2) + "MB";

// Optional filter: `npm run assets:optimize -- creature fuxx` re-encodes only
// those. Without one, everything is processed — but meshopt re-encoding is
// non-deterministic, so a full run rewrites unchanged files byte-differently.
const only = new Set(process.argv.slice(2));
const wanted = (name) => only.size === 0 || only.has(name);

async function processGlb(name, textureTransforms, outDir = OUT) {
  const src = `${SRC}/${name}.glb`;
  const out = `${outDir}/${name}.glb`;
  const doc = await io.read(src);
  await doc.transform(weld(), dedup(), prune(), ...textureTransforms, quantize(), meshopt({ encoder: MeshoptEncoder }));
  await io.write(out, doc);
  console.log(`${name}.glb  ${mb(src)} -> ${mb(out)}`);
}

// Per-asset texture settings. Default: WebP q92 at authored size. Comet
// nuclei never fill more than a small part of the screen (the nucleus sits
// inside its coma), so their 1024² bakes are halved. Phobos and Deimos
// (gen_mars_moons.py, drawn 0.66 and 0.52 u) keep 1024² at q85: the ship can
// pass close enough for either to fill the view. Hero asteroids keep 1024²
// (close passes at radius up to 7u) with a slightly lighter quality.
// The project probe (v7, 2026-10-22) ships its three maps at q88: in game
// it is never more than ~300 px across, so q92's extra bytes bought nothing
// on screen, and q88 pays for v7's blanket crinkle, taped seams and bolt
// rows in the normal map inside v6's footprint (512 KB at q92 -> 506 KB).
const TEXTURE_OPTS = {
  phobos: { quality: 85 },
  deimos: { quality: 85 },
  comet_head: { quality: 88, resize: [512, 512] },
  asteroids: { quality: 85 },
  probe: { quality: 88 },
  // The space monsters (saucer, tardigrade) are viewed close up but load on
  // demand (only in the Nest), so they get the probe's q88.
  saucer: { quality: 88 },
  tardigrade: { quality: 88 },
  // The message bottle (gen_bottle.py) has one 256² parchment/cork map and is
  // never more than a few hundred px across: the probe's q88.
  bottle: { quality: 88 },
};
const DEFAULT_TEXTURE_OPTS = { quality: 92 };
// Every Blender-authored model, in one list, so a new model cannot get texture
// settings without also being processed (or the other way round).
const MODELS = ["asteroids", "spaceship", "portal_gateway", "space_crystal", "data_shard", "cargo_ship", "creature", "phobos", "deimos", "comet_head", "career_station", "buoy", "shipyard", "dormant_gate", "probe", "bottle"];
// Space monsters: output goes to public/models-ondemand/, never to the packs.
const ONDEMAND_MODELS = ["saucer", "tardigrade"];
for (const k of [...MODELS, ...ONDEMAND_MODELS]) {
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

for (const name of ONDEMAND_MODELS) {
  if (!wanted(name)) continue;
  if (!existsSync(`${SRC}/${name}.glb`)) {
    console.log(`skip ${name}.glb (not in assets-src)`);
    continue;
  }
  mkdirSync(ONDEMAND_OUT, { recursive: true });
  await processGlb(name, [textureCompress({ encoder: sharp, targetFormat: "webp", ...TEXTURE_OPTS[name] })], ONDEMAND_OUT);
}

// Saturn's, Uranus's and Neptune's seeded maps and Saturn's ring strip
// (scripts/textures/gen_worlds.mjs), at their authored sizes. The ring strip
// is lossless and keeps the colour under transparent texels: its alpha is the
// rings' optical depth, which lossy alpha would smear. Every other body and
// moon map (NASA/USGS mosaics, Venus, Titan) is encoded by
// scripts/textures/process_body_maps.mjs, which also makes it. The retired
// fictional maps (ruangrapi, portfolio, fuxx, w-rock, w-dwarf) no longer ship.
const WORLD_WEBP = { "w-ringed_ring": { lossless: true, exact: true } };
for (const file of ["w-ringed", "w-ringed_ring", "w-tilted", "w-blue"]) {
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
