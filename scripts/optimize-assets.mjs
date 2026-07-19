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

async function processGlb(name, textureTransforms) {
  const src = `${SRC}/${name}.glb`;
  const out = `${OUT}/${name}.glb`;
  const doc = await io.read(src);
  await doc.transform(weld(), dedup(), prune(), ...textureTransforms, quantize(), meshopt({ encoder: MeshoptEncoder }));
  await io.write(out, doc);
  console.log(`${name}.glb  ${mb(src)} -> ${mb(out)}`);
}

// Player-facing / already-baked models: format conversion only, no resize.
// (asteroids.glb = 4 sculpted variants with 512px bakes, replaces the old
// single 4K-textured asteroid.glb)
for (const name of ["asteroids", "spaceship", "portal_gateway", "space_crystal", "cargo_ship", "creature", "moon", "comet_head"]) {
  if (!existsSync(`${SRC}/${name}.glb`)) {
    console.log(`skip ${name}.glb (not in assets-src)`);
    continue;
  }
  await processGlb(name, [textureCompress({ encoder: sharp, targetFormat: "webp", quality: 92 })]);
}

// Planet equirect maps: keep 2048x1024 resolution, convert JPEG -> WebP.
for (const name of ["earth", "jupiter", "mars"]) {
  await sharp(`${SRC}/${name}.jpg`).webp({ quality: 88 }).toFile(`${OUT}/${name}.webp`);
  console.log(`${name}.webp  ${mb(`${SRC}/${name}.jpg`)} -> ${mb(`${OUT}/${name}.webp`)}`);
}
console.log("Done.");
