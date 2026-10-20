import { withPage, settle } from "./harness.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, statSync, readFileSync } from "node:fs";
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
    // bake_utils' 0.55 metallic default leaking into a rocky body): the nine
    // real moons (SolarMoons.tsx, meshes named Moon_<id>) are all drawn and
    // all matte, Phobos and Deimos from their GLBs (PhobosBaked / DeimosBaked).
    const rock = await page.evaluate(() => {
      const out = { names: new Set(), metal: 0, baked: new Set() };
      window.__fitz.scene.traverse((o) => {
        const m = o.material;
        if (o.isMesh && o.name.startsWith("Moon_")) {
          out.names.add(o.name);
          out.metal = Math.max(out.metal, m.metalness ?? 0);
          if (/^(Phobos|Deimos)Baked$/.test(m.name)) out.baked.add(m.name);
        }
      });
      return { names: [...out.names].sort(), metal: out.metal, baked: [...out.baked].sort() };
    });
    checks.check("moon materials stay non-metallic", rock.names.length > 0 && rock.metal <= 0.1,
      `max metalness=${rock.metal}`);
    const MOONS = ["callisto", "deimos", "europa", "ganymede", "io", "moon", "phobos", "titan", "triton"].map((id) => `Moon_${id}`);
    checks.check("all nine moons are in the scene", MOONS.every((n) => rock.names.includes(n)), rock.names.join(","));
    checks.check("Phobos and Deimos draw their shape-model GLBs", rock.baked.join() === "DeimosBaked,PhobosBaked", rock.baked.join(","));
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

  // gen_mars_moons.py writes into MARS_MOONS_OUT when set, so the originals in
  // assets-src/ are never touched. It is seeded and byte-reproducible (the
  // shape-model tables are pinned by SHA-256), so the fresh files must match
  // the originals exactly; the structural fingerprint names what differs if not.
  try {
    execFileSync(blender, ["--background", "--python", "scripts/blender/gen_mars_moons.py"],
      { stdio: "pipe", env: { ...process.env, MARS_MOONS_OUT: scratch } });
    checks.check("gen_mars_moons.py runs headless", true);
    for (const name of ["phobos", "deimos"]) {
      const original = `assets-src/${name}.glb`, fresh = join(scratch, `${name}.glb`);
      const [a, b] = await Promise.all([fingerprint(original), fingerprint(fresh)]);
      checks.check(`regenerated ${name} keeps its node names and PBR values`,
        JSON.stringify(a.nodes) === JSON.stringify(b.nodes) && JSON.stringify(a.materials) === JSON.stringify(b.materials),
        `${JSON.stringify(b.nodes)} ${JSON.stringify(b.materials)}`);
      checks.check(`regenerated ${name} keeps its vertex count`, a.vertices === b.vertices, `${a.vertices} -> ${b.vertices}`);
      const hash = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
      checks.check(`regenerated ${name} is byte-identical`, hash(original) === hash(fresh),
        `${hash(original).slice(0, 12)} vs ${hash(fresh).slice(0, 12)}`);
    }
  } catch (e) {
    checks.check("regeneration check completed", false, e.message.slice(0, 200));
  }

  return checks;
}
