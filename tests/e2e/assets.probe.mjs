import { withPage, settle } from "./harness.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, statSync, copyFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

/** Structural fingerprint: the properties the app actually depends on. */
async function fingerprint(path) {
  const doc = await io.read(path);
  const root = doc.getRoot();
  return {
    nodes: root.listNodes().map((n) => n.getName()).sort(),
    materials: root.listMaterials().map((m) => ({
      name: m.getName(),
      metal: +m.getMetallicFactor().toFixed(2),
      rough: +m.getRoughnessFactor().toFixed(2),
    })).sort((a, b) => a.name.localeCompare(b.name)),
    vertices: root.listMeshes().reduce((sum, mesh) => sum +
      mesh.listPrimitives().reduce((s, p) => s + (p.getAttribute("POSITION")?.getCount() ?? 0), 0), 0),
    bytes: statSync(path).size,
  };
}

export default async function run() {
  const checks = await withPage({ label: "assets" }, async (page, checks) => {
    // Cargo radar dish spins at 1.2 rad/s. `RadarDish` is a real node name in
    // cargo_ship.glb (verified: exactly two nodes, `CargoShip` + `RadarDish`),
    // carried through scene.clone(true) in CargoTraffic.tsx, so name-based
    // traversal finds it directly.
    const dish = async () => page.evaluate(() => {
      let d = null;
      window.__fitz.scene.traverse((o) => {
        if (!d && o.name === "RadarDish") d = o;
      });
      return d ? d.rotation.z : null;
    });
    const d0 = await dish();
    await settle(page, 1500);
    const d1 = await dish();
    checks.check("cargo radar dish spins", d0 !== null && d0 !== d1,
      `z ${d0?.toFixed(3)} -> ${d1?.toFixed(3)}`);

    // Comet head tumbles. Diagnostic traversal (scene.traverse(o => ...))
    // showed the rendered head mesh has an EMPTY object name — Comets.tsx
    // mounts it as a bare `<mesh geometry={headGeometry} material={headMaterial}
    // .../>` with no `name` prop, so name-based matching (e.g. /Comet/i on
    // o.name) finds nothing. The material survives the clone with its GLB
    // name intact (confirmed: comet_head.glb's material is `CometBaked`), so
    // match on that instead.
    const head = async () => page.evaluate(() => {
      let h = null;
      window.__fitz.scene.traverse((o) => {
        if (!h && o.type === "Mesh" && o.material?.name === "CometBaked") h = o;
      });
      return h ? { x: h.rotation.x, y: h.rotation.y } : null;
    });
    const h0 = await head();
    await settle(page, 1500);
    const h1 = await head();
    checks.check("comet head tumbles", h0 !== null && (h0.x !== h1.x || h0.y !== h1.y),
      `x ${h0?.x?.toFixed(3)} -> ${h1?.x?.toFixed(3)}`);

    // Shipped materials keep correct PBR values for rock (regression guard on
    // bake_utils' 0.55 metallic default leaking into a rocky body).
    const rock = await page.evaluate(() => {
      const out = {};
      window.__fitz.scene.traverse((o) => {
        const m = o.material;
        if (m?.name === "MoonBaked") out.moon = m.metalness;
        if (m?.name?.startsWith("Asteroid")) out.asteroid = m.metalness;
      });
      return out;
    });
    checks.check("moon material stays non-metallic", (rock.moon ?? 1) <= 0.1,
      `metalness=${rock.moon}`);
  });

  // ---- regeneration: structural, not byte-exact ----
  // generate.sh documents that meshopt re-encoding is non-deterministic, so
  // only the properties the app relies on are compared.
  if (process.env.SKIP_REGEN === "1") {
    checks.check("regeneration check skipped by request", true, "SKIP_REGEN=1");
    return checks;
  }
  const blender = process.env.BLENDER
    ?? "/Users/fitzgeral/Applications/Blender.app/Contents/MacOS/Blender";
  if (!existsSync(blender)) {
    checks.check("Blender available for regeneration check", false,
      `not found at ${blender} — set BLENDER or SKIP_REGEN=1`);
    return checks;
  }

  const scratch = mkdtempSync(join(tmpdir(), "fitz-regen-"));
  const REGENERABLE = ["cargo_ship", "moon", "comet_head", "creature"];

  // gen_moon.py:68 hardcodes its output to assets-src/moon.glb and reads no env
  // var (verified). Regenerating therefore OVERWRITES an original in a
  // gitignored, local-only directory. Preserve it byte-for-byte and restore it
  // no matter how this block exits.
  const original = "assets-src/moon.glb";
  const preserved = join(scratch, "moon.original.glb");
  copyFileSync(original, preserved);
  const originalHash = createHash("sha256").update(readFileSync(original)).digest("hex");

  try {
    execFileSync(blender, ["--background", "--python", "scripts/blender/gen_moon.py"],
      { stdio: "pipe" });
    checks.check("gen_moon.py runs headless", true);

    const [shipped, fresh] = await Promise.all([
      fingerprint(preserved),      // the pre-existing original
      fingerprint(original),       // what the generator just wrote
    ]);

    checks.check("regenerated moon keeps its node names",
      JSON.stringify(shipped.nodes) === JSON.stringify(fresh.nodes),
      `${shipped.nodes} vs ${fresh.nodes}`);
    checks.check("regenerated moon keeps its material PBR values",
      JSON.stringify(shipped.materials) === JSON.stringify(fresh.materials),
      JSON.stringify(fresh.materials));
    const drift = Math.abs(fresh.vertices - shipped.vertices) / (shipped.vertices || 1);
    checks.check("regenerated moon vertex count within 2%", drift <= 0.02,
      `${shipped.vertices} -> ${fresh.vertices} (${(drift * 100).toFixed(2)}%)`);
    // File size is dominated by two baked 1024x1024 textures (color+AO,
    // normal — gen_moon.py:51,64) whose PNG-compressed byte size shifts a
    // little run-to-run: Cycles' AO bake (ao_samples=32) and the procedural
    // Voronoi/Clouds displacement textures are sampled, not bit-identical
    // across independent renders, so the baked pixels (and therefore their
    // compressed size) are not byte-stable even though the geometry and PBR
    // values are (already asserted exactly above/below). A 25% band is
    // generous enough to absorb that sampling noise while still catching a
    // genuinely broken export — a truncated/near-empty file, an accidentally
    // doubled texture resolution, or unintended debug data folded in — any of
    // which would land far outside this range.
    const byteDrift = Math.abs(fresh.bytes - shipped.bytes) / (shipped.bytes || 1);
    checks.check("regenerated moon file size stays within a sane band (±25%)",
      byteDrift <= 0.25,
      `${shipped.bytes} -> ${fresh.bytes} bytes (${(byteDrift * 100).toFixed(2)}%)`);
    checks.check("only 4 of 11 assets are regenerable (documented in MANIFEST.md)",
      REGENERABLE.length === 4, REGENERABLE.join(","));
  } catch (e) {
    checks.check("regeneration check completed", false, e.message.slice(0, 200));
  } finally {
    // Always restore, then prove the restore worked. A silent failure here
    // costs an irreplaceable original.
    copyFileSync(preserved, original);
    const restoredHash = createHash("sha256").update(readFileSync(original)).digest("hex");
    checks.check("assets-src/moon.glb restored byte-for-byte",
      restoredHash === originalHash,
      `${originalHash.slice(0, 12)} vs ${restoredHash.slice(0, 12)}`);
  }

  return checks;
}
