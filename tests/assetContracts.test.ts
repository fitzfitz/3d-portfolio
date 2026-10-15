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

function baseColorFactor(doc: Document, material: string): number[] {
  const m = doc.getRoot().listMaterials().find((x) => x.getName() === material);
  if (!m) throw new Error(`no material ${material}`);
  return m.getBaseColorFactor().slice(0, 3);
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
    expect(close(baseColorFactor(doc, "Hull_Primary"), [0.4, 0.42, 0.46], 0.01)).toBe(true);
    expect(close(baseColorFactor(doc, "Hull_Secondary"), [0.16, 0.17, 0.2], 0.01)).toBe(true);
    expect(close(baseColorFactor(doc, "Hull_Trim"), [0.7, 0.86, 0.92], 0.01)).toBe(true);
  });

  it("paints the hull zones as dielectric paint, so their colour reads against dark space", async () => {
    // At metalness 0.55 the hull mostly mirrored the near-black sky and no
    // albedo change showed in game; paint is a non-metal.
    const mats = (await load("spaceship")).getRoot().listMaterials();
    for (const n of ["Hull_Primary", "Hull_Secondary", "Hull_Trim"]) {
      expect(mats.find((m) => m.getName() === n)!.getMetallicFactor(), n).toBeLessThanOrEqual(0.25);
    }
  });

  it("gives every hull zone the same texture set as Accent_Metal, so they share one shader program", async () => {
    const mats = (await load("spaceship")).getRoot().listMaterials();
    const sig = (name: string) => {
      const m = mats.find((x) => x.getName() === name)!;
      return [!!m.getBaseColorTexture(), !!m.getNormalTexture(), !!m.getEmissiveTexture(), m.getAlphaMode(), m.getDoubleSided()].join();
    };
    for (const n of ["Hull_Primary", "Hull_Secondary", "Hull_Trim"]) expect(sig(n), n).toBe(sig("Accent_Metal"));
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
