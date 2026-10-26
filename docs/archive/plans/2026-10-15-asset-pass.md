# Asset Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring every non-planet asset up to the planets' standard: a hero ship with three paintable hull zones, a real cargo freighter, a readable ice moon with planet-neutral moon tints, a richer fuel crystal, and proper distant galaxies.

**Architecture:** Every model comes from a seeded Blender generator in `scripts/blender/` that writes `assets-src/*.glb`, which `npm run assets:optimize` compresses into `public/models/`. A new contract test reads the shipped GLBs and pins everything the app depends on (names, bounds, nozzle positions, triangle and size budgets), so each generator change is test-first. Galaxies and moon tints are plain TypeScript with unit tests.

**Tech Stack:** Blender 5.1 headless (bpy, bmesh, numpy), glTF-Transform 4 + meshoptimizer (optimizer and contract test), three.js 0.185 / React Three Fiber, Vitest 4, the repo's Playwright e2e probes.

**Spec:** `docs/archive/specs/2026-10-15-asset-pass-design.md`

## Global Constraints

- Planets, sun, portal, data shard, asteroids, comet and jellyfish are not touched.
- Generators stay seeded and deterministic: re-running one gives a byte-identical `assets-src/*.glb`.
- Names the app looks up never change: `Engine_Emissive`, `Neon_Cyan`, `Neon_Pink`, `Neon_Green`, `Canopy`, `Accent_Metal`, `CargoShip`, `RadarDish`, `HullBaked`, `NavRed`, `NavGreen`, `EngineGlow`, `Moon_Rock`, `Moon_Ice`, `Moon_Volcanic`, `MoonRock`, `MoonIce`, `MoonVolcanic`, `Energy_Crystal`.
- Only `Engine_Emissive` may match `/engine/i` on the hero ship (`Spaceship.tsx` keys on it).
- Hero ship: ≤ 22 000 triangles, GLB ≤ 600 KB, bounds within ±5% of v1, nozzles unmoved (Engine_Emissive bounds within 0.01).
- Cargo ship: ≤ 12 000 triangles, GLB ≤ 600 KB, nose-to-tail 2.62–3.20 units.
- Fuel crystal: one node, one mesh, one primitive, one material; 300–800 triangles; y 0..3.9, |x|,|z| ≤ 1.0.
- Moon tints: HSL saturation ≤ 25%, hue kept.
- `public/models/` total < 8 MB.
- Performance ceilings (`docs/PERF-BUDGETS.md`): deep-space programs ≤ 79, close-approach ≤ 84; calls and triangles within baseline + 15%.
- Memory: GPU-process size within 5% of the Task 1 "before" figure.
- Blender binary: `/Users/fitzgeral/Applications/Blender.app/Contents/MacOS/Blender` (note `~/Applications`, not `/Applications`). Below, `B` means this path.
- `<scratchpad>` means `/private/tmp/claude-502/-Users-fitzgeral-Kerja-proj-fitz/a350a01f-acbc-47eb-abc7-e509d209f0b6/scratchpad` (throwaway files only; never commit them).
- **Never install packages** (`npm install`, `npm ci`, `pnpm`, etc.). Everything needed is already in `node_modules`. If a dependency seems missing, stop and report.
- **Never kill processes by name** (`pkill`, `killall`, `kill -9 $(pgrep …)`). Only stop a server you started yourself, by its port: `lsof -ti tcp:<port> | xargs -r kill`.
- `assets-src/` is its own git repo (remote `fitzfitz/3d-portfolio-assets-src`). Commit there separately, in Task 8; the main repo ignores it.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Live-sky ghosts and the race ghost** replace every ship material with one flat material. The split hull adds two primitives, so each ghost costs two more draw calls but must still render as one even colour. Pinned by the `livesky` e2e probe and the manual ghost check in Task 8.
2. **A material name accidentally matching `/engine/i`** would make `Spaceship.tsx` drive the wrong material with the throttle. Pinned by the "exactly one /engine/i material" assertion (Task 1, kept through Task 2).
3. **Engine plumes drifting off the nozzles** after the ship rebuild. Pinned by the Engine_Emissive bounds assertion (Task 1, kept through Task 2).
4. **The glTF exporter silently dropping the paint-zone colour factors**, which would leave every zone white. Pinned by the baseColorFactor assertions in Task 2.
5. **Quantized crystal positions clamping** when FuelCrystals and PlasmaAnomalies bake the node transform (the 2026-10-10 squashed-crystal bug). Pinned by the crystal bounds assertion (Task 1, kept through Task 6) and the `assets` e2e probe.

---

### Task 1: Asset contract test and "before" captures

Pins today's contracts against the shipped files, so every later task changes an expectation first and watches it fail. Also records the "before" screenshots, renders, program count and memory figure for the PR.

**Files:**
- Create: `tests/assetContracts.test.ts`
- Create (throwaway, not committed): `<scratchpad>/render_assets.py`

**Interfaces:**
- Produces: `tests/assetContracts.test.ts` with module-level helpers `load(name)`, `materialNames(doc)`, `nodeNames(doc)`, `triangles(doc, material?)`, `bounds(doc)`, `materialBounds(doc, material)`, `kb(name)`, `close(a, b, tol)`. Later tasks add `it(...)` blocks to its `describe` blocks and may add helpers below `close`.
- Produces: `.playwright-mcp/asset-pass/before-{ship,cargo,ice-moon,crystal,galaxy}.png`, `<scratchpad>/renders-before/*.png`, and two numbers (program count, GPU-process MB) reported in the task summary.

- [ ] **Step 1: Write the contract test (characterisation of today's assets)**

Create `tests/assetContracts.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { NodeIO, getBounds, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

/**
 * Contracts between the generated models in public/models and the code that
 * loads them by name, size or position (Spaceship, CargoTraffic, FuelCrystals,
 * PlasmaAnomalies, SpacePlanets). Reads the shipped files, which are quantized
 * and meshopt-compressed, so it checks exactly what visitors download.
 */
let io: NodeIO;
const cache = new Map<string, Document>();

beforeAll(async () => {
  await MeshoptDecoder.ready;
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
});

async function load(name: string): Promise<Document> {
  if (!cache.has(name)) cache.set(name, await io.read(`public/models/${name}.glb`));
  return cache.get(name)!;
}

const materialNames = (doc: Document) => doc.getRoot().listMaterials().map((m) => m.getName()).sort();
const nodeNames = (doc: Document) => doc.getRoot().listNodes().map((n) => n.getName()).sort();
const kb = (name: string) => statSync(`public/models/${name}.glb`).size / 1024;
const close = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

function triangles(doc: Document, material?: string): number {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      if (material && p.getMaterial()?.getName() !== material) continue;
      n += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION")!.getCount()) / 3;
    }
  }
  return n;
}

function bounds(doc: Document) {
  const root = doc.getRoot();
  return getBounds(root.getDefaultScene() ?? root.listScenes()[0]);
}

/** World-space bounds of every vertex drawn with `material` (dequantized). */
function materialBounds(doc: Document, material: string) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const el: number[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      if (p.getMaterial()?.getName() !== material) continue;
      const pos = p.getAttribute("POSITION")!;
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el);
        for (let r = 0; r < 3; r++) {
          const w = m[r] * el[0] + m[4 + r] * el[1] + m[8 + r] * el[2] + m[12 + r];
          min[r] = Math.min(min[r], w);
          max[r] = Math.max(max[r], w);
        }
      }
    }
  }
  return { min, max };
}

describe("hero ship (spaceship.glb)", () => {
  it("keeps the names Spaceship.tsx looks up", async () => {
    const names = materialNames(await load("spaceship"));
    for (const n of ["Accent_Metal", "Canopy", "Engine_Emissive", "Neon_Cyan", "Neon_Green", "Neon_Pink"]) {
      expect(names).toContain(n);
    }
    // Spaceship.tsx picks the throttle-driven glow by /engine/i.
    expect(names.filter((n) => /engine/i.test(n))).toEqual(["Engine_Emissive"]);
  });

  it("keeps the v1 footprint (within 5%)", async () => {
    const b = bounds(await load("spaceship"));
    expect(close(b.min, [-2.704, -0.58, -3.5], 0.14)).toBe(true);
    expect(close(b.max, [2.704, 0.646, 3.5], 0.14)).toBe(true);
  });

  it("keeps the nozzles where the plumes are drawn", async () => {
    const e = materialBounds(await load("spaceship"), "Engine_Emissive");
    expect(close(e.min, [-0.818, -0.286, 3.0], 0.01)).toBe(true);
    expect(close(e.max, [0.818, 0.186, 3.49], 0.01)).toBe(true);
  });

  it("stays inside its triangle and download budget", async () => {
    expect(triangles(await load("spaceship"))).toBeLessThanOrEqual(22000);
    expect(kb("spaceship")).toBeLessThanOrEqual(600);
  });
});

describe("cargo ship (cargo_ship.glb)", () => {
  it("keeps the nodes and materials CargoTraffic.tsx looks up", async () => {
    const doc = await load("cargo_ship");
    expect(nodeNames(doc)).toEqual(["CargoShip", "RadarDish"]);
    const names = materialNames(doc);
    for (const n of ["HullBaked", "NavRed", "NavGreen", "EngineGlow"]) expect(names).toContain(n);
  });

  it("keeps a traffic-lane length", async () => {
    const b = bounds(await load("cargo_ship"));
    const length = b.max[2] - b.min[2];
    expect(length).toBeGreaterThanOrEqual(2.62);
    expect(length).toBeLessThanOrEqual(3.2);
  });

  it("stays inside its triangle and download budget", async () => {
    expect(triangles(await load("cargo_ship"))).toBeLessThanOrEqual(12000);
    expect(kb("cargo_ship")).toBeLessThanOrEqual(600);
  });
});

describe("fuel crystal (space_crystal.glb)", () => {
  it("is one node, one mesh, one primitive, one Energy_Crystal material", async () => {
    const root = (await load("space_crystal")).getRoot();
    expect(root.listNodes()).toHaveLength(1);
    expect(root.listMeshes()).toHaveLength(1);
    expect(root.listMeshes()[0].listPrimitives()).toHaveLength(1);
    expect(root.listMaterials().map((m) => m.getName())).toEqual(["Energy_Crystal"]);
    expect(root.listMaterials()[0].getEmissiveTexture()).not.toBeNull();
  });

  it("stands 3.9 tall on its base, inside a 2-unit footprint", async () => {
    const b = bounds(await load("space_crystal"));
    expect(Math.abs(b.min[1])).toBeLessThanOrEqual(0.01);
    expect(Math.abs(b.max[1] - 3.9)).toBeLessThanOrEqual(0.01);
    for (const r of [0, 2]) {
      expect(b.min[r]).toBeGreaterThanOrEqual(-1.001);
      expect(b.max[r]).toBeLessThanOrEqual(1.001);
    }
  });

  it("stays inside its triangle budget", async () => {
    const t = triangles(await load("space_crystal"));
    expect(t).toBeGreaterThanOrEqual(300);
    expect(t).toBeLessThanOrEqual(800);
  });
});

describe("moons (moon.glb)", () => {
  it("keeps the three named variants OrbitingMoon picks from", async () => {
    const doc = await load("moon");
    expect(nodeNames(doc)).toEqual(["Moon_Ice", "Moon_Rock", "Moon_Volcanic"]);
    expect(materialNames(doc)).toEqual(["MoonIce", "MoonRock", "MoonVolcanic"]);
    for (const m of ["MoonIce", "MoonRock", "MoonVolcanic"]) expect(triangles(doc, m)).toBe(4480);
  });
});

describe("public/models", () => {
  it("stays under 8 MB in total", () => {
    const total = readdirSync("public/models").reduce((s, f) => s + statSync(`public/models/${f}`).size, 0);
    expect(total / 1024 / 1024).toBeLessThan(8);
  });
});
```

- [ ] **Step 2: Run it: it must pass against today's assets**

Run: `npx vitest run tests/assetContracts.test.ts && npm run lint`
Expected: PASS (all tests), lint clean. If an assertion fails, the measured baseline in the test is wrong: print the actual value and fix the test, not the asset.

- [ ] **Step 3: "Before" studio renders**

Shipped GLBs are meshopt-compressed, which Blender cannot import, so render the uncompressed sources. Create `<scratchpad>/render_assets.py`:

```python
"""Audit render: each GLB, 3/4 view, neutral studio light, on dark grey.

Usage: blender -b -P render_assets.py -- <models_dir> <out_dir>
"""
import bpy, sys, os
from mathutils import Vector

models_dir, out_dir = sys.argv[sys.argv.index("--") + 1:][:2]
os.makedirs(out_dir, exist_ok=True)

for name in sorted(os.listdir(models_dir)):
    if not name.endswith(".glb"):
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    scn.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    scn.render.resolution_x, scn.render.resolution_y = 900, 600
    world = bpy.data.worlds.new("w"); scn.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.035, 0.045, 1)

    bpy.ops.import_scene.gltf(filepath=os.path.join(models_dir, name))
    objs = [o for o in scn.objects if o.type == "MESH"]
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    center = (lo + hi) / 2
    size = max((hi - lo).length, 1e-3)

    cam_data = bpy.data.cameras.new("cam"); cam_data.lens = 50
    cam = bpy.data.objects.new("cam", cam_data); scn.collection.objects.link(cam)
    cam.location = center + Vector((1.0, -1.3, 0.7)).normalized() * size * 1.35
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scn.camera = cam

    for loc, energy in (((1, -1, 1.2), 5.0), ((-1.2, -0.4, 0.3), 1.5), ((0, 1.4, 0.8), 3.0)):
        ld = bpy.data.lights.new("l", "SUN"); ld.energy = energy
        lob = bpy.data.objects.new("l", ld); scn.collection.objects.link(lob)
        lob.rotation_euler = (-Vector(loc)).to_track_quat("-Z", "Y").to_euler()

    scn.render.filepath = os.path.join(out_dir, name.replace(".glb", ".png"))
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name, "size", round(size, 2))
```

Run: `$B -b -P <scratchpad>/render_assets.py -- assets-src <scratchpad>/renders-before 2>&1 | grep RENDERED`
Expected: nine `RENDERED` lines.

- [ ] **Step 4: "Before" in-game screenshots and program count**

Start a dev server you own: `npx vite --port 5288 --strictPort` (background). With the Playwright MCP browser at 1280×760, open `http://localhost:5288/` and run this once in `browser_evaluate`:

```js
async () => {
  const f = window.__fitz;
  for (let i = 0; i < 60 && !f.store.getState().sceneReady; i++) await new Promise((r) => setTimeout(r, 500));
  f.store.getState().setLowPerf(false, true);
  window.__shot = async (tx, ty, tz, ox, oy, oz) => {
    f.store.getState().setPhotoMode(false);
    await new Promise((r) => setTimeout(r, 200));
    f.teleport(tx + ox, ty + oy, tz + oz);
    f.setAttitude(Math.atan2(-ox, -oz), 0); // yaw = atan2(dx, dz) toward the target
    await new Promise((r) => setTimeout(r, 1500));
    f.store.getState().setPhotoMode(true); // hides the HUD
    await new Promise((r) => setTimeout(r, 500));
  };
  return f.gl.info.programs.length;
}
```

Record the returned program count. Then one `browser_evaluate` + `browser_take_screenshot` (filename under `.playwright-mcp/asset-pass/`) per pose. Later tasks reuse these exact poses with an `after-` prefix:

| File | `browser_evaluate` body |
|---|---|
| `before-ship.png` | `async () => window.__shot(60, 40, 60, 0, 0, 40)` |
| `before-cargo.png` | `async () => { const d = window.__fitz.scene.getObjectByName("RadarDish"); const p = d.getWorldPosition(d.position.clone()); await window.__shot(p.x, p.y, p.z, 2.5, 1.2, 6); }` |
| `before-ice-moon.png` | `async () => { const b = window.__fitz.bodies.fuxx; await window.__shot(b.x, b.y, b.z, 18, 3, 44); }` |
| `before-crystal.png` | `async () => { const c = window.__fitz.crystals.find((c) => c.active); await window.__shot(c.x, c.y, c.z, 3, 1, 9); }` |
| `before-galaxy.png` | `async () => window.__shot(180, 80, -160, -90, -40, 80)` |

Close the browser tab and stop your server: `lsof -ti tcp:5288 | xargs -r kill`.

- [ ] **Step 5: "Before" memory figure**

Run `npm run build`, then serve it: `npx vite preview --port 5290 --strictPort` (background). Open `http://localhost:5290/` in the Playwright MCP browser at 1512×802, wait 20 s, then:

```bash
ps -axo rss=,command= | grep -- "--type=gpu-process" | grep -i "ms-playwright" | awk '{s+=$1} END {print s/1024 " MB"}'
```

Record the number. Close the tab and stop the preview: `lsof -ti tcp:5290 | xargs -r kill`.

- [ ] **Step 6: Commit**

```bash
git add tests/assetContracts.test.ts
git commit -m "test(assets): pin the model contracts the app depends on

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Report the program count and the memory figure in your task summary.

---

### Task 2: Hero ship v2 — neutral detail bake and three paint zones

**Files:**
- Modify: `scripts/blender/gen_spaceship.py` (materials block ~lines 36–48, livery block ~158–166, `make_obj` ~236–252, canopy arches ~494–496, new greebles section before "normals + bevels" ~788, final materials ~898–930)
- Modify: `tests/assetContracts.test.ts` (new helper + hero ship describe block)
- Output: `assets-src/spaceship.glb`, `public/models/spaceship.glb`

**Interfaces:**
- Consumes: `load`, `materialNames`, `triangles`, `close` from Task 1's test file.
- Produces: ship materials `Hull_Primary`, `Hull_Secondary`, `Hull_Trim` (same texture set and flags as `Accent_Metal`, differing only in `baseColorFactor`). The future hull-paint feature recolours exactly these three names. Test helper `baseColorFactor(doc, material): number[]`.

- [ ] **Step 1: Add the paint-zone expectations (failing)**

In `tests/assetContracts.test.ts`, below `materialBounds`, add:

```ts
function baseColorFactor(doc: Document, material: string): number[] {
  const m = doc.getRoot().listMaterials().find((x) => x.getName() === material);
  if (!m) throw new Error(`no material ${material}`);
  return m.getBaseColorFactor().slice(0, 3);
}
```

Inside `describe("hero ship (spaceship.glb)")`, add:

```ts
  it("splits the hull into three paint zones and drops the old single Hull", async () => {
    const doc = await load("spaceship");
    const names = materialNames(doc);
    for (const n of ["Hull_Primary", "Hull_Secondary", "Hull_Trim"]) {
      expect(names).toContain(n);
      expect(triangles(doc, n), n).toBeGreaterThan(200);
    }
    expect(names).not.toContain("Hull");
  });

  it("colours each zone through baseColorFactor, not the baked texture", async () => {
    const doc = await load("spaceship");
    expect(close(baseColorFactor(doc, "Hull_Primary"), [0.3, 0.32, 0.36], 0.01)).toBe(true);
    expect(close(baseColorFactor(doc, "Hull_Secondary"), [0.12, 0.13, 0.15], 0.01)).toBe(true);
    expect(close(baseColorFactor(doc, "Hull_Trim"), [0.7, 0.86, 0.92], 0.01)).toBe(true);
  });

  it("gives every hull zone the same texture set as Accent_Metal, so they share one shader program", async () => {
    const mats = (await load("spaceship")).getRoot().listMaterials();
    const sig = (name: string) => {
      const m = mats.find((x) => x.getName() === name)!;
      return [!!m.getBaseColorTexture(), !!m.getNormalTexture(), !!m.getEmissiveTexture(), m.getAlphaMode(), m.getDoubleSided()].join();
    };
    for (const n of ["Hull_Primary", "Hull_Secondary", "Hull_Trim"]) expect(sig(n), n).toBe(sig("Accent_Metal"));
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/assetContracts.test.ts -t "hero ship"`
Expected: FAIL in the three new tests (no `Hull_Primary` material yet); the four existing ones still pass.

- [ ] **Step 3: Neutral detail bake — replace the bake palette and drop the baked livery**

In `scripts/blender/gen_spaceship.py`, replace the comment + `BAKE_BASE` + `PAINT_LIGHT` block (from `# Bake materials: albedo is designed procedurally here` through `PAINT_LIGHT = (0.62, 0.62, 0.60)`) with:

```python
# Bake materials: tone and wear are designed procedurally here (panel seams,
# per-panel tone, grime, edge wear) then baked into one GREYSCALE detail map.
# Hue comes from each paint-zone material's colour factor (Hull_Primary /
# Hull_Secondary / Hull_Trim, below), so the hull-paint feature can recolour a
# zone without fighting a baked livery. Values are luminance only and leave
# headroom for the tone x grime x edge-wear gain (up to ~1.6x) before clipping.
# metallic=0 so the DIFFUSE/COLOR pass returns the full albedo.
BAKE_BASE = {
    "hull": (0.62, 0.62, 0.62),
    "hull_mid": (0.68, 0.68, 0.68),
    "panel": (0.74, 0.74, 0.74),
    "metal": (0.300, 0.310, 0.330),  # Accent_Metal: factor stays white, look unchanged
    "dark": (0.16, 0.16, 0.16),
}
```

In `make_bake_material`, delete the whole livery block, from `    if cat not in ("metal", "dark"):` through the `col = _mix_col(nt, _math(nt, "MULTIPLY", fin2, ...), col, PAINT_LIGHT)` line (the trim stripe becomes its own zone instead).

Run: `grep -n PAINT_LIGHT scripts/blender/gen_spaceship.py`
Expected: no output.

- [ ] **Step 4: Tag every baked part with its paint zone**

Directly above `def make_obj(`, add:

```python
# Paint zones. Each baked part carries a per-face "zone" attribute through the
# bevel and join, and the final materials are assigned from it. First matching
# rule wins; anything unmatched is primary. Metal parts become Accent_Metal
# whatever their zone, and non-baked parts (glass, glow, neon) are not tagged.
ZONE_PRIMARY, ZONE_SECONDARY, ZONE_TRIM = 0, 1, 2
ZONE_RULES = (
    (lambda n: n == "spine" or n.startswith(("wing_plate_", "tip_fin_")), ZONE_TRIM),
    (lambda n: n.startswith(("wing_", "flap_", "canard_", "intake_", "nacelle_", "tip_pod_",
                             "ventral_fin", "vane_", "tailfin_")), ZONE_SECONDARY),
)


def zone_of(name):
    for rule, zone in ZONE_RULES:
        if rule(name):
            return zone
    return ZONE_PRIMARY
```

In `make_obj`, after `bm.free()` and before `ob = bpy.data.objects.new(name, me)`, add:

```python
    if cat not in NON_BAKED:
        attr = me.attributes.new("zone", "INT", "FACE")
        attr.data.foreach_set("value", [zone_of(name)] * len(me.polygons))
```

- [ ] **Step 5: Add canopy frame arches and spine greebles**

Change the canopy arch loop tuple from `(1.18, 1.72)` to `(1.18, 1.45, 1.72, 1.95)`.

Immediately above the line `# --------------------------------------------------------- normals + bevels ---`, add:

```python
# ------------------------------------------------------------- v2 greebles ---
# Access hatches and bolt heads on the two bare stretches of spine (between the
# vent grilles, and from the forward grille to the sensor dome). The v1 upper
# hull read as unbroken plating at chase-camera distance.
for k, (y0, y1) in enumerate(((-1.62, -1.05), (-0.15, 0.30))):
    for j in range(3):
        yy = y0 + (j + 0.5) * (y1 - y0) / 3
        zt = lerp_keys(SPINE, yy)[2]
        s = 1 if (k + j) % 2 else -1
        box(f"spine_hatch_{k}_{j}", (s * 0.045, yy, zt + 0.006), (0.06, 0.09, 0.012), "panel", 0.003)
        box(f"spine_bolt_{k}_{j}", (-s * 0.05, yy, zt + 0.010), (0.025, 0.025, 0.02), "metal", 0.002)
```

(`box` takes full extents, as the existing `spine_vent_` call does.)

- [ ] **Step 6: Build the four final materials from the zone attribute**

Replace the block from `def final_mat(name, metallic, roughness):` through the `me.update()` that follows `me.polygons.foreach_set("material_index", new_mi)` with:

```python
def final_mat(name, metallic, roughness, factor=(1.0, 1.0, 1.0)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = albedo
    # Texture x constant colour: the glTF exporter writes the constant as
    # baseColorFactor. Socket indices: RGBA-mode Mix uses inputs 6/7, output 2.
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    nt.links.new(t.outputs["Color"], mix.inputs[6])
    mix.inputs[7].default_value = (*factor, 1.0)
    nt.links.new(mix.outputs[2], b.inputs["Base Color"])
    bake_utils.attach_normal_map(m, nrm_img, strength=1.0)
    return m


# Paint zones (linear RGB). The hull-paint feature changes only these factors.
HULL_PRIMARY = final_mat("Hull_Primary", 0.55, 0.48, (0.30, 0.32, 0.36))    # gunmetal
HULL_SECONDARY = final_mat("Hull_Secondary", 0.55, 0.48, (0.12, 0.13, 0.15))  # graphite
HULL_TRIM = final_mat("Hull_Trim", 0.55, 0.48, (0.70, 0.86, 0.92))         # cyan-white
ACCENT = final_mat("Accent_Metal", 0.9, 0.30)
me = hull.data
slot_is_metal = np.array([mat.name == "BAKE_metal" for mat in me.materials])
mi = np.empty(len(me.polygons), dtype=np.int32)
me.polygons.foreach_get("material_index", mi)
zone = np.empty(len(me.polygons), dtype=np.int32)
me.attributes["zone"].data.foreach_get("value", zone)
new_mi = np.where(slot_is_metal[mi], 3, zone).astype(np.int32)
me.attributes.remove(me.attributes["zone"])
me.materials.clear()
for m in (HULL_PRIMARY, HULL_SECONDARY, HULL_TRIM, ACCENT):
    me.materials.append(m)
me.polygons.foreach_set("material_index", new_mi)
me.update()
print("ZONES", {n: int((new_mi == i).sum()) for i, n in enumerate(("primary", "secondary", "trim", "accent"))})
```

In the file header's CONTRACT comment, add: `#   hull paint zones: Hull_Primary / Hull_Secondary / Hull_Trim share Accent_Metal's maps; colour = baseColorFactor`.

- [ ] **Step 7: Generate twice and confirm determinism**

```bash
$B --background --python scripts/blender/gen_spaceship.py 2>&1 | grep -E "TRIS|ZONES|BLENDER_BBOX|Error"
shasum -a 256 assets-src/spaceship.glb
$B --background --python scripts/blender/gen_spaceship.py > /dev/null 2>&1
shasum -a 256 assets-src/spaceship.glb
```

Expected: `TRIS` ≤ 22000; `ZONES` shows non-zero primary, secondary, trim and accent counts; the bbox matches the header contract (x ±2.7, z ±3.5 in Blender's y); both hashes identical.

- [ ] **Step 8: Optimize only this model and run the contract test**

Run: `npm run assets:optimize -- spaceship && npx vitest run tests/assetContracts.test.ts -t "hero ship"`
Expected: PASS (all seven hero-ship tests).

If only the baseColorFactor test fails with `[1,1,1]`, the exporter did not read the Mix node as a factor. Check that nothing sits between the Mix output and Base Color, that `mix.inputs[0]` (Factor) is exactly 1.0, and that the image feeds input 6 (A) with the constant in input 7 (B). Re-run Steps 7–8.

- [ ] **Step 9: Look at it**

Run: `$B -b -P <scratchpad>/render_assets.py -- assets-src <scratchpad>/renders-after 2>&1 | grep RENDERED` and compare `renders-after/spaceship.png` with `renders-before/spaceship.png`.

In game (dev server on 5288 + the `__shot` helper from Task 1 Step 4), take `.playwright-mcp/asset-pass/after-ship.png` at the `before-ship` pose. The hull must read clearly lighter against space, with visible trim and a darker wing tone. If it still reads near-black, raise `HULL_PRIMARY` to `(0.40, 0.42, 0.46)` and `HULL_SECONDARY` to `(0.16, 0.17, 0.20)`, update the two expectations in the baseColorFactor test to match, and repeat Steps 7–9 once. Check that the engine plumes still sit on the three nozzles and the neon strips still glow. Stop your server by port.

- [ ] **Step 10: Commit (main repo only; assets-src is committed in Task 8)**

```bash
git add scripts/blender/gen_spaceship.py public/models/spaceship.glb tests/assetContracts.test.ts
git commit -m "feat(assets): hero ship v2 — neutral detail bake and three paint zones

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cargo freighter v3

**Files:**
- Rewrite: `scripts/blender/gen_cargo_ship.py`
- Modify: `tests/assetContracts.test.ts` (cargo describe block)
- Output: `assets-src/cargo_ship.glb`, `public/models/cargo_ship.glb`

**Interfaces:**
- Consumes: Task 1 helpers (`load`, `triangles`, `materialBounds`).
- Produces: the same contract as v2 (`CargoShip` + `RadarDish` nodes; `HullBaked`, `Windows`, `EngineGlow`, `NavRed`, `NavGreen`, `Accent` materials) with far more detail.

- [ ] **Step 1: Raise the detail floor in the test (failing)**

In `describe("cargo ship (cargo_ship.glb)")`, add:

```ts
  it("is a detailed freighter, not a box hauler", async () => {
    // v2 was 7.9k triangles of primitive boxes; v3 adds a truss spine,
    // ribbed containers and radiators.
    expect(triangles(await load("cargo_ship"), "HullBaked")).toBeGreaterThan(9000);
  });

  it("keeps the nav lights on opposite sides, red to port", async () => {
    const doc = await load("cargo_ship");
    expect(materialBounds(doc, "NavRed").max[0]).toBeLessThan(0);
    expect(materialBounds(doc, "NavGreen").min[0]).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/assetContracts.test.ts -t "cargo"`
Expected: FAIL on "is a detailed freighter" (7852 is not > 9000). The nav-light test already passes; it guards the rewrite.

- [ ] **Step 3: Rewrite the generator**

Replace `scripts/blender/gen_cargo_ship.py` entirely with:

```python
# Generates the NPC cargo freighter (v3, original work). Run headless:
#   $BLENDER --background --python scripts/blender/gen_cargo_ship.py
# Output: assets-src/cargo_ship.glb (raw; optimized by npm run assets:optimize)
#
# CONTRACT with src/components/canvas/CargoTraffic.tsx and tests/assetContracts.test.ts:
#   nodes: CargoShip (everything joined) + RadarDish (separate; the app spins it)
#   materials: HullBaked (colour x AO bake of every matte part), Windows,
#     EngineGlow, NavRed, NavGreen (emissive, never baked; the app pulses the
#     last three by name), Accent (RadarDish only)
#   Blender +Y = nose (glTF -Z); nose-to-tail 2.62..3.20; red nav light to port (-X)
import bpy
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils  # noqa: E402

bpy.ops.wm.read_factory_settings(use_empty=True)
random.seed(7)


def make_material(name, color, metallic=0.7, roughness=0.35, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


HULL = make_material("Hull", (0.42, 0.44, 0.48), roughness=0.45)
FRAME = make_material("Frame", (0.20, 0.21, 0.23), roughness=0.55)
ACCENT = make_material("Accent", (0.56, 0.57, 0.62), roughness=0.5)
# Muted shipping-container palette: rust, teal, ochre, slate
CONTAINER_MATS = [make_material(f"Container{i}", c, metallic=0.4, roughness=0.6) for i, c in enumerate(
    ((0.42, 0.16, 0.10), (0.10, 0.30, 0.32), (0.50, 0.33, 0.10), (0.30, 0.32, 0.34)))]
WINDOWS = make_material("Windows", (0.02, 0.02, 0.03), emission=(0.0, 0.94, 1.0), strength=4.0)
ENGINE = make_material("EngineGlow", (0.02, 0.02, 0.03), emission=(0.0, 0.94, 1.0), strength=6.0)
NAV_RED = make_material("NavRed", (0.05, 0.0, 0.0), emission=(1.0, 0.1, 0.1), strength=8.0)
NAV_GREEN = make_material("NavGreen", (0.0, 0.05, 0.0), emission=(0.1, 1.0, 0.3), strength=8.0)

parts = []
# Tiny parts: a bevel costs triangles and adds nothing at traffic distance.
NO_BEVEL = ("rib_", "corner_", "brace_", "diag_", "greeble_", "pipe_")


def _finish(ob, name, mat):
    ob.name = name
    ob.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    parts.append(ob)
    return ob


def add_box(name, size, loc, mat, rot=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    bpy.context.object.scale = size
    return _finish(bpy.context.object, name, mat)


def add_cyl(name, radius, depth, loc, rot, mat, vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=vertices, location=loc, rotation=rot)
    return _finish(bpy.context.object, name, mat)


def add_cone(name, r1, r2, depth, loc, rot, mat, vertices=16):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, vertices=vertices, location=loc, rotation=rot)
    return _finish(bpy.context.object, name, mat)


def add_sphere(name, radius, loc, mat, scale=(1.0, 1.0, 1.0), segments=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=segments, ring_count=rings, location=loc)
    bpy.context.object.scale = scale
    return _finish(bpy.context.object, name, mat)


ALONG_Y = (math.radians(90), 0.0, 0.0)  # cylinder axis Z -> Y

# --- truss spine: two rails, cross braces and alternating diagonals
RAIL_Y0, RAIL_Y1, BAYS = -1.05, 0.70, 7
BAY = (RAIL_Y1 - RAIL_Y0) / BAYS
for s in (-1, 1):
    add_box(f"rail_{s}", (0.05, RAIL_Y1 - RAIL_Y0, 0.05), (s * 0.10, (RAIL_Y0 + RAIL_Y1) / 2, 0.0), FRAME)
for i in range(BAYS + 1):
    add_box(f"brace_{i}", (0.25, 0.03, 0.03), (0.0, RAIL_Y0 + i * BAY, 0.0), FRAME)
for i in range(BAYS):
    ang = math.atan2(0.20, BAY)
    add_box(f"diag_{i}", (0.025, math.hypot(0.20, BAY), 0.025), (0.0, RAIL_Y0 + (i + 0.5) * BAY, 0.0), FRAME,
            rot=(0.0, 0.0, ang if i % 2 else -ang))

# --- container racks: port and starboard, two tiers, four slots; a few slots empty
SLOTS_Y = (-0.80, -0.38, 0.04, 0.46)
CW, CL, CH = 0.30, 0.38, 0.26
for s in (-1, 1):
    for tier, cz in enumerate((0.14, -0.14)):
        for k, cy in enumerate(SLOTS_Y):
            if random.random() < 0.12:
                continue  # an unloaded slot breaks the silhouette
            cx = s * 0.28
            add_box(f"container_{s}_{tier}_{k}", (CW, CL, CH), (cx, cy, cz), random.choice(CONTAINER_MATS))
            for r in range(5):  # corrugation on the outward face
                add_box(f"rib_{s}_{tier}_{k}_{r}", (0.012, 0.025, CH - 0.02),
                        (cx + s * (CW / 2 + 0.006), cy + (r - 2) * 0.07, cz), ACCENT)
            for dx in (-1, 1):
                for dy in (-1, 1):
                    add_box(f"corner_{s}_{tier}_{k}_{dx}_{dy}", (0.03, 0.03, 0.03),
                            (cx + dx * CW / 2, cy + dy * CL / 2, cz + CH / 2), FRAME)

# --- crew cab: tapered nose, window band, side ports
cab = add_box("cab", (0.40, 0.42, 0.30), (0.0, 0.93, 0.04), HULL)
for v in cab.data.vertices:  # coordinates are centred on the cab: taper the front half
    if v.co.y > 0:
        v.co.x *= 0.70
        v.co.z *= 0.78
add_box("window_band", (0.22, 0.02, 0.06), (0.0, 1.145, 0.08), WINDOWS)
for s in (-1, 1):
    add_box(f"window_side_{s}", (0.02, 0.12, 0.05), (s * 0.19, 0.90, 0.10), WINDOWS)
add_box("cab_collar", (0.30, 0.06, 0.24), (0.0, 0.70, 0.04), FRAME)
bpy.ops.mesh.primitive_torus_add(major_radius=0.17, minor_radius=0.012, major_segments=24, minor_segments=6,
                                 location=(0.0, 0.66, 0.04), rotation=ALONG_Y)
_finish(bpy.context.object, "dock_ring", WINDOWS)
add_cyl("antenna", 0.012, 0.30, (0.10, 0.85, 0.34), (0.0, 0.0, 0.0), ACCENT, vertices=6)
add_sphere("antenna_tip", 0.025, (0.10, 0.85, 0.50), ACCENT, segments=8, rings=6)

# --- engine block: housing, two bell nozzles, glow discs
add_box("engine_block", (0.56, 0.36, 0.32), (0.0, -1.24, 0.0), HULL)
for s in (-1, 1):
    x = s * 0.15
    add_cyl(f"housing_{s}", 0.13, 0.20, (x, -1.48, 0.0), ALONG_Y, ACCENT, vertices=20)
    add_cone(f"bell_{s}", 0.11, 0.17, 0.18, (x, -1.62, 0.0), (math.radians(-90), 0.0, 0.0), HULL, vertices=20)
    add_cyl(f"nozzle_{s}", 0.105, 0.02, (x, -1.70, 0.0), ALONG_Y, ENGINE, vertices=20)
    add_cyl(f"collar_{s}", 0.145, 0.04, (x, -1.40, 0.0), ALONG_Y, FRAME, vertices=20)

# --- radiators: a fin either side of the engine block, tilted up and out; nav lights on the tips
for s in (-1, 1):
    tilt = math.radians(-20) * s
    add_box(f"radiator_{s}", (0.42, 0.24, 0.012), (s * 0.50, -1.20, 0.10), FRAME, rot=(0.0, tilt, 0.0))
    for r in range(4):
        add_box(f"rib_rad_{s}_{r}", (0.40, 0.012, 0.02), (s * 0.50, -1.29 + r * 0.06, 0.11), ACCENT,
                rot=(0.0, tilt, 0.0))
    tip = (s * (0.50 + 0.21 * math.cos(math.radians(20))), -1.20, 0.10 + 0.21 * math.sin(math.radians(20)))
    add_sphere(f"nav_{s}", 0.045, tip, NAV_RED if s < 0 else NAV_GREEN, segments=10, rings=8)

# --- belly: pipes along the spine and two pressure tanks
for s in (-1, 1):
    add_cyl(f"pipe_{s}", 0.02, 1.60, (s * 0.06, -0.15, -0.09), ALONG_Y, ACCENT, vertices=8)
for k, y in enumerate((-0.60, 0.20)):
    add_sphere(f"tank_{k}", 0.09, (0.0, y, -0.15), HULL, scale=(1.0, 1.8, 1.0))

# --- greebles: seeded boxes on the engine block and cab roof
for g in range(14):
    on_cab = g % 2 == 0
    x = random.uniform(-0.12, 0.12)
    y = random.uniform(0.78, 1.02) if on_cab else random.uniform(-1.36, -1.12)
    z = 0.202 if on_cab else 0.172
    add_box(f"greeble_{g}", (random.uniform(0.03, 0.07), random.uniform(0.03, 0.08), 0.024), (x, y, z),
            HULL if g % 3 else ACCENT)


def _is_emissive(ob):
    for slot in ob.material_slots:
        m = slot.material
        if m is not None and m.use_nodes and "Principled BSDF" in m.node_tree.nodes:
            if m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value > 0:
                return True
    return False


# Bevel every matte part now: join() keeps only the active object's modifiers.
for p in parts:
    if _is_emissive(p) or p.name.startswith(NO_BEVEL):
        continue
    bpy.ops.object.select_all(action="DESELECT")
    p.select_set(True)
    bpy.context.view_layer.objects.active = p
    bev = p.modifiers.new("bevel", "BEVEL")
    bev.width = 0.008
    bev.segments = 2
    bev.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=bev.name)

bpy.ops.object.select_all(action="DESELECT")
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
ship = bpy.context.object
ship.name = "CargoShip"

# --- RadarDish: separate object, NOT joined (CargoTraffic spins it)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.10, segments=12, ring_count=6, location=(-0.08, 0.90, 0.24))
dish = bpy.context.object
dish.name = "RadarDish"
dish.scale = (1.0, 1.0, 0.35)
dish.data.materials.append(ACCENT)

# --- bake hull colour + AO, then a hi-poly normal for plating detail
img = bake_utils.bake_color_ao([ship], "cargo_ship_baked", size=1024, ao_samples=32)
baked = bake_utils.apply_baked_material([ship], img, "HullBaked")
hi = bake_utils.make_hipoly_detail(ship, subsurf_levels=1, noise_scale=0.06, noise_strength=0.008)
nimg = bake_utils.bake_normal_from_hipoly(ship, hi, "cargo_ship_normal", size=1024)
bake_utils.attach_normal_map(baked, nimg)
bpy.data.objects.remove(hi, do_unlink=True)

deps = bpy.context.evaluated_depsgraph_get()
me = ship.evaluated_get(deps).data
me.calc_loop_triangles()
ys = [v.co.y for v in me.vertices]
print("TRIS", len(me.loop_triangles), "LENGTH", round(max(ys) - min(ys), 3))

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "cargo_ship.glb"))
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True)
print("wrote", out)
```

- [ ] **Step 4: Generate twice and confirm determinism**

```bash
$B --background --python scripts/blender/gen_cargo_ship.py 2>&1 | grep -E "TRIS|Error"
shasum -a 256 assets-src/cargo_ship.glb
$B --background --python scripts/blender/gen_cargo_ship.py > /dev/null 2>&1
shasum -a 256 assets-src/cargo_ship.glb
```

Expected: `TRIS` between 9000 and 12000, `LENGTH` between 2.62 and 3.20, identical hashes. If TRIS is over 12000, set `bev.segments = 1`; if under 9000, use seven ribs per container (`range(7)`, offset `(r - 3) * 0.05`). Re-run.

- [ ] **Step 5: Optimize and run the contract test**

Run: `npm run assets:optimize -- cargo_ship && npx vitest run tests/assetContracts.test.ts -t "cargo"`
Expected: PASS (all five cargo tests).

- [ ] **Step 6: Look at it**

Studio render (as in Task 2 Step 9) and the in-game `after-cargo.png` at the `before-cargo` pose. Check: containers read as ribbed and multi-coloured, the dish spins, nav lights blink red on the left and green on the right, the engine glow pulses.

- [ ] **Step 7: Commit**

```bash
git add scripts/blender/gen_cargo_ship.py public/models/cargo_ship.glb tests/assetContracts.test.ts
git commit -m "feat(assets): cargo freighter v3 — truss spine, ribbed container racks, radiators

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Ice moon refine

**Files:**
- Modify: `scripts/blender/gen_moon.py` (`moon_ice()` only, ~lines 352–449, plus the header table row)
- Modify: `docs/archive/specs/2026-10-15-asset-pass-design.md` (one wording fix)
- Create (throwaway): `<scratchpad>/moon_fingerprint.mjs`
- Output: `assets-src/moon.glb`, `public/models/moon.glb`

**Interfaces:**
- Consumes: Task 1 moon contract (names, 4480 triangles each; unchanged).
- Produces: a higher-contrast `Moon_Ice`; `Moon_Rock` and `Moon_Volcanic` identical in geometry and textures.

- [ ] **Step 1: Fingerprint the moons before the change**

Create `<scratchpad>/moon_fingerprint.mjs`:

```js
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { createHash } from "node:crypto";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read("assets-src/moon.glb");
const h = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);
for (const node of doc.getRoot().listNodes()) {
  const p = node.getMesh().listPrimitives()[0];
  const m = p.getMaterial();
  const tex = [m.getBaseColorTexture(), m.getNormalTexture(), m.getEmissiveTexture()].map((t) => (t ? h(t.getImage()) : "-"));
  console.log(node.getName(), h(Buffer.from(p.getAttribute("POSITION").getArray().buffer)), tex.join(" "));
}
```

Run from the repo root (ESM must resolve the repo's `node_modules`, hence stdin):
`node --input-type=module - < <scratchpad>/moon_fingerprint.mjs > <scratchpad>/moon-before.txt && cat <scratchpad>/moon-before.txt`
Expected: three lines, one per moon.

- [ ] **Step 2: Raise the ice moon's contrast**

In `moon_ice()` in `scripts/blender/gen_moon.py`:

Replace `base = np.array([0.89, 0.92, 0.95], np.float32)` with:

```python
    base = np.array([0.80, 0.86, 0.92], np.float32)   # bluer, a touch darker: the white ball read as blank
```

Replace `band = np.array([0.68, 0.57, 0.49], np.float32)   # desaturated tan lineae` with:

```python
    band = np.array([0.50, 0.38, 0.31], np.float32)   # rust-brown lineae: the main contrast on the ice
```

Directly after the line `alb = alb * (1 - 0.5 * tone) + np.array([0.84, 0.82, 0.79], np.float32) * (0.5 * tone)`, add:

```python
    # dark regolith patches: old dusty terrain between the bright ice plains
    patch = smoothstep(0.12, 0.42, fbm(nz, P + 14.0, 1.6, 5))[..., None]
    alb = alb * (1 - 0.55 * patch) + np.array([0.42, 0.44, 0.48], np.float32) * (0.55 * patch)
```

Directly above the comment `# a few fresh impacts with blue-white ejecta`, add:

```python
    # a few large, relaxed old craters: shallow and wide, darker floors, no rays
    for c, r in crater_set(rng, 4, 0.09, 0.16, 1.7):
        idx, x, az, Ps = stamp_crater(H, c, r, depth=r * 0.06, rim=r * 0.02, noise=nz,
                                      floor_frac=0.5, ext=2.5)
        alb[idx] = alb[idx] * (1 - 0.18 * (1 - smoothstep(0.7, 1.0, x)))[..., None]
```

Replace the emissive line at the end of `moon_ice()` with (strength 0.32 → 0.55):

```python
    em = srgb_to_lin(hexcol("#7fe8ff"))[None, None, :] * (0.55 * np.clip(glow, 0, 1))[..., None]
```

In the header table, change the `Moon_Ice` description to `bright blue-white ice, rust lineae, dark regolith patches, relaxed craters, cyan glowing cracks` (keep the column layout).

- [ ] **Step 3: Generate twice; confirm determinism and that Rock/Volcanic did not move**

```bash
$B --background --python scripts/blender/gen_moon.py 2>&1 | grep -E "tris=|Error"
shasum -a 256 assets-src/moon.glb
$B --background --python scripts/blender/gen_moon.py > /dev/null 2>&1
shasum -a 256 assets-src/moon.glb
node --input-type=module - < <scratchpad>/moon_fingerprint.mjs > <scratchpad>/moon-after.txt
diff <scratchpad>/moon-before.txt <scratchpad>/moon-after.txt
```

Expected: identical hashes; `diff` shows only the `Moon_Ice` line changed. If `Moon_Rock` or `Moon_Volcanic` changed, something outside `moon_ice()` was edited: revert it.

- [ ] **Step 4: Optimize and run the contract test**

Run: `npm run assets:optimize -- moon && npx vitest run tests/assetContracts.test.ts -t "moons"`
Expected: PASS.

- [ ] **Step 5: Fix the spec wording**

In `docs/archive/specs/2026-10-15-asset-pass-design.md`, section 3, replace `The cracks are colour only (no emissive), so no new shader program.` with `The cracks glow through Moon_Ice's existing emissive map (it already had one), so there is no new map, material or shader program.`

- [ ] **Step 6: Commit**

```bash
git add scripts/blender/gen_moon.py public/models/moon.glb docs/archive/specs/2026-10-15-asset-pass-design.md
git commit -m "feat(assets): ice moon with real contrast — rust lineae, regolith, relaxed craters

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Planet-neutral moon tints

**Files:**
- Create: `src/data/moonTints.ts`
- Create: `tests/moonTints.test.ts`
- Modify: `src/components/canvas/SpacePlanets.tsx` (imports; the five `<OrbitingMoon … color=…>` lines, ~513, 535, 536, 553, 554)

**Interfaces:**
- Produces: `MOON_TINTS: { ruangrapiRock, portfolioIce, portfolioRock, fuxxVolcanic, fuxxIce }` (hex strings), consumed only by `SpacePlanets.tsx`.

- [ ] **Step 1: Write the failing test**

Create `tests/moonTints.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { MOON_TINTS } from "../src/data/moonTints";

const hsl = (hex: string) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 });

// Hues of the original, fully saturated tints (one per moon), so each moon
// still leans toward its planet's colour.
const ORIGINAL_HUE: Record<keyof typeof MOON_TINTS, number> = {
  ruangrapiRock: 0.404, // #8fffc9
  portfolioIce: 0.548, // #9be8ff
  portfolioRock: 0.548, // #9be8ff
  fuxxVolcanic: 0.759, // #e3b8ff
  fuxxIce: 0.727, // #caa2ff
};

describe("MOON_TINTS", () => {
  it("keeps every moon at or below 25% saturation, so none reads as a planet", () => {
    for (const [k, hex] of Object.entries(MOON_TINTS)) expect(hsl(hex).s, k).toBeLessThanOrEqual(0.25);
  });

  it("keeps each moon's hue family", () => {
    for (const [k, hex] of Object.entries(MOON_TINTS)) {
      expect(Math.abs(hsl(hex).h - ORIGINAL_HUE[k as keyof typeof MOON_TINTS]), k).toBeLessThan(0.02);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/moonTints.test.ts`
Expected: FAIL, cannot resolve `../src/data/moonTints`.

- [ ] **Step 3: Add the tints**

Create `src/data/moonTints.ts`:

```ts
/**
 * Per-moon tints, multiplied over moon.glb's neutral bakes by OrbitingMoon in
 * SpacePlanets.tsx. Kept at low saturation (HSL s <= 25%, same hue as before)
 * so a moon reads as rock or ice catching a hint of its planet's colour. The
 * old fully saturated tints made the ice moon beside Fuxx look like a small
 * planet, and visitors try to fly to anything that looks like a planet.
 */
export const MOON_TINTS = {
  ruangrapiRock: "#c5dccf",
  portfolioIce: "#cad9df",
  portfolioRock: "#cad9df",
  fuxxVolcanic: "#e0d7e7",
  fuxxIce: "#d4cde1",
} as const;
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/moonTints.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the tints in SpacePlanets**

In `src/components/canvas/SpacePlanets.tsx`, add `import { MOON_TINTS } from "../../data/moonTints";` beside the other `../../data` imports, then change the five moons' `color` props:

- `variant="Rock"` moon under `planets[0]`: `color={MOON_TINTS.ruangrapiRock}`
- `variant="Ice"` moon under `planets[1]`: `color={MOON_TINTS.portfolioIce}`
- `variant="Rock"` moon under `planets[1]`: `color={MOON_TINTS.portfolioRock}`
- `variant="Volcanic"` moon under `planets[2]`: `color={MOON_TINTS.fuxxVolcanic}`
- `variant="Ice"` moon under `planets[2]`: `color={MOON_TINTS.fuxxIce}`

Run: `grep -n 'OrbitingMoon distance' src/components/canvas/SpacePlanets.tsx`
Expected: five lines, each with `color={MOON_TINTS.…}` and no hex literal.

- [ ] **Step 6: Typecheck and look**

Run: `npx tsc -b && npm run lint`
Expected: no errors.

In game, take `.playwright-mcp/asset-pass/after-ice-moon.png` at the `before-ice-moon` pose: the moon beside Fuxx must read as a pale, cracked ice moon, not a small blue-violet planet.

- [ ] **Step 7: Commit**

```bash
git add src/data/moonTints.ts tests/moonTints.test.ts src/components/canvas/SpacePlanets.tsx
git commit -m "fix(moons): planet-neutral tints so no moon reads as a planet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Fuel crystal refine

**Files:**
- Modify: `scripts/blender/gen_crystal.py` (`add_shard` ~96–153, shard calls ~157–162, body/rock painting ~279–321, header line 1)
- Modify: `tests/assetContracts.test.ts` (crystal describe block)
- Output: `assets-src/space_crystal.glb`, `public/models/space_crystal.glb`

**Interfaces:**
- Consumes: Task 1 crystal contract (unchanged: one node/mesh/primitive/material, bounds, 300–800 triangles).
- Produces: a seven-shard cluster with two-stage tips; FuelCrystals and PlasmaAnomalies load it unchanged.

- [ ] **Step 1: Raise the detail floor (failing)**

In `describe("fuel crystal (space_crystal.glb)")`, add:

```ts
  it("is a full cluster, not five plain prisms", async () => {
    // v1 was 366 triangles; seven shards with stepped tips land around 500-650.
    expect(triangles(await load("space_crystal"))).toBeGreaterThanOrEqual(450);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/assetContracts.test.ts -t "fuel crystal"`
Expected: FAIL on "is a full cluster" (366 < 450).

- [ ] **Step 3: Two-stage tips and chipped tips in `add_shard`**

Change the signature to:

```python
def add_shard(idx, base_xy, base_z, tilt_deg, azim_deg, length, radius, sides, tip_ratio,
              stepped=False, chip=0.14):
```

Replace the line `apex_off = (t1 * rng.uniform(-1, 1) + t2 * rng.uniform(-1, 1)) * radius * 0.14` with:

```python
    # chip > 0.14 pushes the apex off-axis: a broken, asymmetric termination
    apex_off = (t1 * rng.uniform(-1, 1) + t2 * rng.uniform(-1, 1)) * radius * chip
    # stepped: a second, narrower ring partway up the tip -> two-stage termination
    mid = ring(shoulder + (length - shoulder) * 0.42, 0.58) if stepped else None
```

Keep the `apex = bm.verts.new(...)` line after it. Replace the face loop with:

```python
    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append(oriented_face([bottom[i], bottom[j], top[j], top[i]], axis_pt,
                                   KIND_BODY, rng.randrange(len(BODY_CELLS)), idx))
        if mid is None:
            faces.append(oriented_face([top[i], top[j], apex], axis_pt,
                                       KIND_TIP, rng.randrange(len(TIP_CELLS)), idx))
        else:
            faces.append(oriented_face([top[i], top[j], mid[j], mid[i]], axis_pt,
                                       KIND_TIP, rng.randrange(len(TIP_CELLS)), idx))
            faces.append(oriented_face([mid[i], mid[j], apex], axis_pt,
                                       KIND_TIP, rng.randrange(len(TIP_CELLS)), idx))
```

(The UV pass already maps four-sided `KIND_TIP` faces through its generic branch.)

- [ ] **Step 4: Seven shards**

Replace the five `add_shard(...)` calls with:

```python
# idx, base xy, base z, tilt, azimuth, length, radius, sides, tip length / radius
add_shard(0, (0.00, 0.00), 0.40, 5, 40, 3.62, 0.42, 6, 2.3, stepped=True)
add_shard(1, (0.24, 0.12), 0.36, 21, 22, 2.45, 0.31, 6, 2.1, stepped=True)
add_shard(2, (-0.22, 0.16), 0.36, 26, 142, 2.05, 0.28, 6, 2.2, stepped=True)
add_shard(3, (-0.14, -0.26), 0.30, 36, 246, 1.55, 0.23, 6, 2.0, chip=0.35)
add_shard(4, (0.26, -0.22), 0.26, 46, 315, 1.10, 0.18, 5, 1.9)
add_shard(5, (0.05, 0.30), 0.30, 58, 95, 0.85, 0.15, 5, 1.8, chip=0.35)
add_shard(6, (-0.30, -0.02), 0.28, 62, 190, 0.70, 0.13, 5, 1.7, chip=0.30)
```

Change the header's first line to `# Energy crystal: seven bevelled quartz-style shards (three with two-stage tips) growing from a faceted`.

- [ ] **Step 5: Root glow on the shards, darker rock socket**

In the body-facet loop, replace `e = core + rim + crown + pocket + vn * (0.35 + 0.45 * V) + waves(U, V, amp=0.03)` with:

```python
    root = np.exp(-V / 0.10) * 0.28  # glow where shards leave the rock: the cluster's hot core
    e = core + rim + crown + pocket + root + vn * (0.35 + 0.45 * V) + waves(U, V, amp=0.03)
```

In the rock loop, replace `e = 0.025 + 0.015 * grain + rim * 0.05` with:

```python
    e = 0.012 + 0.010 * grain + rim * 0.03  # darker socket so the shards' roots carry the glow
```

- [ ] **Step 6: Generate twice and confirm determinism**

```bash
$B --background --python scripts/blender/gen_crystal.py 2>&1 | grep -E "crystal:|Error"
shasum -a 256 assets-src/space_crystal.glb
$B --background --python scripts/blender/gen_crystal.py > /dev/null 2>&1
shasum -a 256 assets-src/space_crystal.glb
```

Expected: `crystal: triangles` between 450 and 800; `half_width ... -> ` at most 1.000; identical hashes. If triangles exceed 800, drop `stepped=True` from shard 2 and re-run.

- [ ] **Step 7: Optimize and run the contract test**

Run: `npm run assets:optimize -- space_crystal && npx vitest run tests/assetContracts.test.ts -t "fuel crystal"`
Expected: PASS (all four crystal tests, including bounds).

- [ ] **Step 8: Look at it**

In game, `.playwright-mcp/asset-pass/after-crystal.png` at the `before-crystal` pose: a gold cluster with a hot core at the roots and stepped tips. Also click empty space a few times to spawn plasma anomalies and check they still render as crystals at the right size.

- [ ] **Step 9: Commit**

```bash
git add scripts/blender/gen_crystal.py public/models/space_crystal.glb tests/assetContracts.test.ts
git commit -m "feat(assets): fuller fuel crystal — seven shards, stepped tips, glowing core

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Distant galaxies

**Files:**
- Create: `src/utils/galaxyPainter.ts`
- Create: `tests/galaxyPainter.test.ts`
- Modify: `src/components/canvas/DistantGalaxies.tsx` (replace `makeGalaxyTexture`, extend `GALAXIES`, one call site)

**Interfaces:**
- Produces:
  - `type GalaxyKind = "spiral" | "inclined" | "elliptical"`
  - `interface GalaxyDot { x: number; y: number; r: number; alpha: number; hue: number; light: number }` (x, y, r in units of the texture half-size)
  - `interface GalaxyPlan { kind: GalaxyKind; arms: number; squash: number; bulge: number; dots: GalaxyDot[]; lanes: GalaxyDot[] }`
  - `planGalaxy(seed: number, kind: GalaxyKind, hueBase: number): GalaxyPlan`

- [ ] **Step 1: Write the failing test**

Create `tests/galaxyPainter.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { planGalaxy, type GalaxyKind } from "../src/utils/galaxyPainter";

afterEach(() => vi.restoreAllMocks());

describe("planGalaxy", () => {
  it("is deterministic and never uses Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    expect(planGalaxy(11, "spiral", 255)).toEqual(planGalaxy(11, "spiral", 255));
    expect(spy).not.toHaveBeenCalled();
  });

  it("varies with the seed", () => {
    expect(planGalaxy(11, "spiral", 255).dots[0]).not.toEqual(planGalaxy(12, "spiral", 255).dots[0]);
  });

  it("keeps every dot and dust lane inside the texture's disc", () => {
    for (const kind of ["spiral", "inclined", "elliptical"] as GalaxyKind[]) {
      const g = planGalaxy(5, kind, 200);
      for (const d of [...g.dots, ...g.lanes]) expect(Math.hypot(d.x, d.y) + d.r, kind).toBeLessThanOrEqual(1);
    }
  });

  it("gives spirals 2-4 arms with dust lanes, and ellipticals neither", () => {
    const s = planGalaxy(3, "spiral", 255);
    expect(s.arms).toBeGreaterThanOrEqual(2);
    expect(s.arms).toBeLessThanOrEqual(4);
    expect(s.lanes.length).toBeGreaterThan(0);
    const e = planGalaxy(3, "elliptical", 255);
    expect(e.arms).toBe(0);
    expect(e.lanes).toHaveLength(0);
  });

  it("squashes inclined spirals and leaves face-on spirals round", () => {
    expect(planGalaxy(9, "spiral", 255).squash).toBe(1);
    expect(planGalaxy(9, "inclined", 255).squash).toBeLessThan(0.7);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/galaxyPainter.test.ts`
Expected: FAIL, cannot resolve `../src/utils/galaxyPainter`.

- [ ] **Step 3: Implement the planner**

Create `src/utils/galaxyPainter.ts`:

```ts
/**
 * Seeded layout for the distant-galaxy sprites (DistantGalaxies.tsx). Pure, so
 * it is testable without a canvas: the component paints the plan. Coordinates
 * and radii are in units of the texture half-size, so the plan always fits.
 */
export type GalaxyKind = "spiral" | "inclined" | "elliptical";

export interface GalaxyDot { x: number; y: number; r: number; alpha: number; hue: number; light: number }

export interface GalaxyPlan {
  kind: GalaxyKind;
  arms: number;
  /** Vertical scale applied to the whole galaxy: 1 is face-on. */
  squash: number;
  /** Bulge radius (half-size units). */
  bulge: number;
  /** Stars and star-forming knots, painted additively. */
  dots: GalaxyDot[];
  /** Dust, painted with destination-out along the inner edge of each arm. */
  lanes: GalaxyDot[];
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_R = 0.94; // soft margin: nothing touches the sprite edge, so no hard rim shows

function clampToDisc(x: number, y: number, r: number): [number, number] {
  const d = Math.hypot(x, y);
  const limit = MAX_R - r;
  return d > limit ? [(x / d) * limit, (y / d) * limit] : [x, y];
}

export function planGalaxy(seed: number, kind: GalaxyKind, hueBase: number): GalaxyPlan {
  const rand = mulberry32(seed);
  const dots: GalaxyDot[] = [];
  const lanes: GalaxyDot[] = [];
  const push = (list: GalaxyDot[], x: number, y: number, d: Omit<GalaxyDot, "x" | "y">) => {
    const [cx, cy] = clampToDisc(x, y, d.r);
    list.push({ x: cx, y: cy, ...d });
  };

  if (kind === "elliptical") {
    const squash = 0.6 + rand() * 0.25;
    for (let i = 0; i < 1400; i++) {
      // Roughly Gaussian radius: dense core, long faint fall-off.
      const g = (rand() + rand() + rand() - 1.5) / 1.5;
      const rr = Math.min(Math.abs(g) * 0.55, 0.85);
      const a = rand() * Math.PI * 2;
      push(dots, Math.cos(a) * rr, Math.sin(a) * rr * squash, {
        r: 0.003 + rand() * 0.004, alpha: 0.5 * (1 - rr), hue: 35 + rand() * 20, light: 78 - rr * 20,
      });
    }
    return { kind, arms: 0, squash, bulge: 0.35 + rand() * 0.1, dots, lanes };
  }

  const arms = 2 + Math.floor(rand() * 3);
  const squash = kind === "inclined" ? 0.45 + rand() * 0.2 : 1;
  const wind = 3.6 + rand() * 1.2;
  const perArm = Math.round(1800 / arms);
  for (let arm = 0; arm < arms; arm++) {
    const off = (arm / arms) * Math.PI * 2 + (rand() - 0.5) * 0.3;
    for (let p = 0; p < perArm; p++) {
      const t = p / perArm;
      const ang = off + t * wind + (rand() - 0.5) * 0.42;
      const rr = 0.06 + t * 0.82 * (0.92 + rand() * 0.16);
      const knot = p % 60 === 0 && t > 0.2; // star-forming knot: a tight pink cluster
      const n = knot ? 6 : 1;
      for (let k = 0; k < n; k++) {
        const jx = knot ? (rand() - 0.5) * 0.03 : 0;
        const jy = knot ? (rand() - 0.5) * 0.03 : 0;
        push(dots, Math.cos(ang) * rr + jx, (Math.sin(ang) * rr + jy) * squash, {
          r: knot ? 0.004 + rand() * 0.003 : 0.003 + rand() * 0.005,
          alpha: knot ? 0.7 : 0.5 * (1 - t),
          hue: knot ? 330 + rand() * 15 : hueBase + rand() * 40,
          light: knot ? 75 : 72 - t * 25,
        });
      }
      if (p % 4 === 0 && t > 0.08 && t < 0.85) {
        const la = ang - 0.16; // just inside the arm
        push(lanes, Math.cos(la) * rr * 0.97, Math.sin(la) * rr * 0.97 * squash, {
          r: 0.008 + rand() * 0.008, alpha: 0.12, hue: 0, light: 0,
        });
      }
    }
  }
  return { kind, arms, squash, bulge: 0.1 + rand() * 0.06, dots, lanes };
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/galaxyPainter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Paint the plan in DistantGalaxies**

In `src/components/canvas/DistantGalaxies.tsx`, add `import { planGalaxy, type GalaxyKind, type GalaxyPlan } from "../../utils/galaxyPainter";` and replace the whole `makeGalaxyTexture` function (and its doc comment) with:

```ts
/** Paints a seeded galaxy plan: halo, stars and knots, dust lanes, then the bulge. */
function makeGalaxyTexture(plan: GalaxyPlan, hueBase: number): THREE.CanvasTexture | null {
  const size = 512;
  const half = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.translate(half, half);

  const ellipse = (radius: number, inner: string, outer: string) => {
    ctx.save();
    ctx.scale(1, plan.squash);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  ellipse(half * 0.94, `hsla(${hueBase}, 40%, 70%, 0.10)`, `hsla(${hueBase}, 40%, 70%, 0)`);
  for (const d of plan.dots) {
    ctx.fillStyle = `hsla(${d.hue}, 75%, ${d.light}%, ${d.alpha})`;
    ctx.beginPath();
    ctx.arc(d.x * half, d.y * half, d.r * half, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "destination-out";
  for (const d of plan.lanes) {
    ctx.fillStyle = `rgba(0, 0, 0, ${d.alpha})`;
    ctx.beginPath();
    ctx.arc(d.x * half, d.y * half, d.r * half, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  ellipse(plan.bulge * half, "rgba(255, 240, 220, 0.95)", "rgba(255, 200, 170, 0)");
  return new THREE.CanvasTexture(canvas);
}
```

Replace the `GALAXIES` constant (keep the spin comment above it) with:

```ts
const GALAXIES: { pos: readonly [number, number, number]; scale: number; hue: number; spin: number; seed: number; kind: GalaxyKind }[] = [
  { pos: [180, 80, -160], scale: 60, hue: 255, spin: 0.072, seed: 11, kind: "spiral" },
  { pos: [-200, -80, 120], scale: 42, hue: 190, spin: -0.048, seed: 23, kind: "elliptical" },
  { pos: [30, 210, -60], scale: 50, hue: 320, spin: 0.06, seed: 37, kind: "inclined" }, // high above the pole
];
```

In the component, change `const map = makeGalaxyTexture(g.hue);` to `const map = makeGalaxyTexture(planGalaxy(g.seed, g.kind, g.hue), g.hue);`. Leave the material, spin and JSX unchanged.

- [ ] **Step 6: Typecheck, lint, look**

Run: `npx tsc -b && npm run lint`
Expected: no errors.

In game, `.playwright-mcp/asset-pass/after-galaxy.png` at the `before-galaxy` pose: a spiral with a bright bulge, dark dust lanes and pink knots, still faint and clearly far away (no hard edge).

- [ ] **Step 7: Commit**

```bash
git add src/utils/galaxyPainter.ts tests/galaxyPainter.test.ts src/components/canvas/DistantGalaxies.tsx
git commit -m "feat(sky): seeded distant galaxies — bulge, dust lanes, star knots, three kinds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Provenance, gates, changelog and PR

**Files:**
- Modify (assets-src repo): `assets-src/MANIFEST.md`, `assets-src/{spaceship,cargo_ship,moon,space_crystal}.glb`
- Modify: `src/data/changelog.ts`
- Create (throwaway): `<scratchpad>/pr-25-body.md`

**Interfaces:**
- Consumes: everything above, plus the Task 1 program count and memory figure.

- [ ] **Step 1: Update and push assets-src**

Regenerate the hash table with the command recorded in `assets-src/MANIFEST.md` and replace the four changed rows:

```bash
(cd assets-src && shasum -a 256 *.glb *.jpg 4k/*.jpg | awk '{printf "| `%s` | `%s` |\n", $2, substr($1,1,16)}')
```

Update the provenance notes in the same file: `spaceship.glb` → "Hero ship v2 (2026-10-15): neutral greyscale detail bake; three paint zones Hull_Primary/Secondary/Trim coloured by baseColorFactor; four canopy arches; spine hatches."; `cargo_ship.glb` → "Freighter v3 (2026-10-15): truss spine, ribbed two-tier container racks, radiators, bell nozzles."; `moon.glb` → append "Moon_Ice contrast pass 2026-10-15 (Rock and Volcanic unchanged)."; `space_crystal.glb` → "Seven shards, three with two-stage tips (2026-10-15)."

```bash
git -C assets-src add MANIFEST.md spaceship.glb cargo_ship.glb moon.glb space_crystal.glb
git -C assets-src commit -m "Asset pass: hero ship paint zones, freighter v3, ice moon contrast, fuller crystal"
gh auth status   # the active account must be fitzfitz; if not: gh auth switch -u fitzfitz
git -C assets-src push
git -C assets-src status -sb
```

Expected: the last command shows the branch with no `ahead`.

- [ ] **Step 2: Full unit gates**

Run: `npm test && npm run lint && npm run build`
Expected: all pass. `tests/assetProvenance.test.ts` passes untouched (no file was added or renamed).

- [ ] **Step 3: E2E probes**

Close every Playwright MCP tab and stop any server you started on 5199, 5288 or 5290, by port only. Then:

Run: `npm run test:e2e -- assets programs perf smoke livesky`
Expected: all checks pass. `programs` must show no new program on the tour; `perf` must stay inside the `docs/PERF-BUDGETS.md` ceilings.

- [ ] **Step 4: Check the numbers against the ceilings**

From the `perf` output, compare deep-space and close-approach calls/triangles/programs with the table in `docs/PERF-BUDGETS.md`. If programs rose at all, the hull zones are not sharing a program: stop and report (the spec's fallback, per-vertex zones inside one material, is a design change the user must confirm). If a calls or triangles ceiling is exceeded, stop and report. Otherwise leave the doc alone.

- [ ] **Step 5: Ghost check and memory comparison**

On a dev server (5288), open the site in two Playwright tabs so a live-sky ghost appears in one of them, or fly the ring course once to get the race ghost. Confirm the ghost renders as one even translucent colour with no banding between hull zones. Stop the server by port.

Rebuild (`npm run build`), serve it with `npx vite preview --port 5290 --strictPort`, open it in the Playwright MCP browser at 1512×802, wait 20 s, and run the same `ps` command as Task 1 Step 5. Anything more than 5% above the Task 1 figure needs an explanation before the PR (texture sizes are the likely cause; the contract test's size budgets bound them). Close the tab and stop the preview by port.

- [ ] **Step 6: Changelog entry**

Confirm the next free PR number: `gh pr list --state all --limit 1 --json number` (expect 24, so this one is 25). Add at the top of `CHANGELOG` in `src/data/changelog.ts`, with the date you actually ship (it must be ≥ the newest entry's date, and the id must start with it):

```ts
  { id: "2026-10-15-sharper-ships", date: "2026-10-15", pr: 25, title: "Sharper Ships", what: "Your ship is lighter and crisper, with a trim stripe and darker wings. Cargo freighters are real ships now, and the fuel crystals, ice moons and distant galaxies all gained detail.", why: "Next to the planets, the rest of the universe looked unfinished: a ship that vanished against space, box-shaped freighters, and galaxies like flat stickers.", how: "Each model is still built by a seeded script. The hull is now three colour zones over one shared shading texture, ready for hull paint. A test checks every model against the names, sizes and limits the game relies on." },
```

Run: `npx vitest run tests/changelog.test.ts`
Expected: PASS (title ≤ 4 words; what and why ≤ 220 characters; how ≤ 240; no PR gaps).

- [ ] **Step 7: Commit, push and open the PR**

Write `<scratchpad>/pr-25-body.md` covering: a summary per asset; before/after observations for each `.playwright-mcp/asset-pass/` pair (described in words, since the screenshots are not committed); triangle and size numbers; perf probe numbers against the ceilings; program count before and after; the ghost check; the memory figures before and after; the pushed `assets-src` commit hash. End it with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

```bash
git add src/data/changelog.ts
git commit -m "docs(changelog): patch notes for sharper ships (#25)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
gh auth status   # fitzfitz must be active
git push -u origin feat/asset-pass
gh pr create --title "Asset pass: paintable hero ship, freighter v3, ice moon, crystal, galaxies" --body-file <scratchpad>/pr-25-body.md
```

Do not merge: merging deploys to GitHub Pages and Cloudflare, and that is the user's call.
