import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { NodeIO, getBounds, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { STATION_RADII } from "../src/data/careerTrail";
import { PLAYER_SHIP_SCALE } from "../src/constants";
import { SHIPYARD_RADII } from "../src/data/shipyard";
import { GATE_RADIUS, GATE_OPENING_R } from "../src/data/dormantGate";
import { MOON_SHAPE_REACH, SOLAR_MOONS } from "../src/data/solarMoons";
import sharp from "sharp";

/**
 * Contracts between the generated models in public/models and the code that
 * loads them by name, size or position (Spaceship, CargoTraffic, FuelCrystals,
 * PlasmaAnomalies, SpacePlanets, SolarMoons, CareerStation, CareerTrail, Shipyard, DormantGate, ProjectProbes). Reads the shipped files, which are quantized
 * and meshopt-compressed, so it checks exactly what visitors download.
 */
let io: NodeIO;
const cache = new Map<string, Document>();

beforeAll(async () => {
  await MeshoptDecoder.ready;
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
});

// Keyed by directory too, so a public/models-lab model never collides with a
// same-named public/models entry.
async function load(name: string, dir = "public/models"): Promise<Document> {
  const key = `${dir}/${name}`;
  if (!cache.has(key)) cache.set(key, await io.read(`${dir}/${name}.glb`));
  return cache.get(key)!;
}

const materialNames = (doc: Document) => doc.getRoot().listMaterials().map((m) => m.getName()).sort();
const nodeNames = (doc: Document) => doc.getRoot().listNodes().map((n) => n.getName()).sort();
const kb = (name: string) => statSync(`public/models/${name}.glb`).size / 1024;
const labKb = (name: string) => statSync(`public/models-lab/${name}.glb`).size / 1024;
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

/** What decides a material's shader program: which texture slots are filled, alpha mode and extensions. */
function textureSet(doc: Document, material: string) {
  const m = doc.getRoot().listMaterials().find((x) => x.getName() === material);
  if (!m) throw new Error(`no material ${material}`);
  return {
    base: !!m.getBaseColorTexture(), normal: !!m.getNormalTexture(), emissive: !!m.getEmissiveTexture(),
    metalRough: !!m.getMetallicRoughnessTexture(), occlusion: !!m.getOcclusionTexture(),
    alpha: m.getAlphaMode(), extensions: m.listExtensions().map((e) => e.extensionName).sort(),
  };
}

/** Every vertex attribute used anywhere in the file (COLOR_0 or TANGENT would add a shader program). */
const semantics = (doc: Document) => [...new Set(doc.getRoot().listMeshes()
  .flatMap((mesh) => mesh.listPrimitives().flatMap((p) => p.listSemantics())))].sort();

function node(doc: Document, name: string) {
  const n = doc.getRoot().listNodes().find((x) => x.getName() === name);
  if (!n) throw new Error(`no node ${name}`);
  return n;
}

/** Farthest vertex from the model's origin, in world space (dequantized). */
function maxRadius(doc: Document): number {
  let max = 0;
  const el: number[] = [];
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const m = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute("POSITION")!;
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, el);
        const x = m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12];
        const y = m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13];
        const z = m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14];
        max = Math.max(max, Math.hypot(x, y, z));
      }
    }
  }
  return max;
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
    const V1_MIN = [-2.704, -0.58, -3.5], V1_MAX = [2.704, 0.646, 3.5];
    for (let i = 0; i < 3; i++) {
      const extent = V1_MAX[i] - V1_MIN[i];
      expect(Math.abs(b.min[i] - V1_MIN[i]), `min[${i}]`).toBeLessThanOrEqual(0.05 * extent);
      expect(Math.abs(b.max[i] - V1_MAX[i]), `max[${i}]`).toBeLessThanOrEqual(0.05 * extent);
    }
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

  it("stays light enough for five on screen at once", async () => {
    // Up to five freighters fly at once, so each triangle counts five times
    // against the deep-space and modal-open ceilings (docs/PERF-BUDGETS.md);
    // a 10.5k build (bevel segments 3) broke both. Detail comes from parts
    // (truss, ribbed racks, radiators), not from rounder bevels.
    expect(triangles(await load("cargo_ship"))).toBeLessThanOrEqual(8500);
    expect(kb("cargo_ship")).toBeLessThanOrEqual(600);
  });

  it("draws its hull in one primitive per material", async () => {
    // Up to five freighters fly at once: seven HullBaked primitives each
    // cost 30 extra draw calls against the modal-open ceiling.
    const prims = (await load("cargo_ship")).getRoot().listMeshes().flatMap((m) => m.listPrimitives());
    const names = prims.map((p) => p.getMaterial()?.getName());
    expect(names.filter((n) => n === "HullBaked")).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
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
    // Drawn instanced 80 times (40 fuel slots + 40 plasma anomalies), so
    // every triangle here costs 80 against the deep-space ceiling; a
    // 626-triangle cluster broke it.
    const t = triangles(await load("space_crystal"));
    expect(t).toBeGreaterThanOrEqual(300);
    expect(t).toBeLessThanOrEqual(520);
  });

  it("is a full cluster, not five plain prisms", async () => {
    // v1 was 366 triangles; six shards with stepped tips land around 500-650.
    expect(triangles(await load("space_crystal"))).toBeGreaterThanOrEqual(450);
  });
});

describe("Phobos and Deimos (phobos.glb, deimos.glb; gen_mars_moons.py)", () => {
  const SHAPED = SOLAR_MOONS.filter((m) => m.shape);

  it.each(SHAPED.map((m) => [m.id, m] as const))("%s: one node, one primitive, one matte material SolarMoons looks up", async (id, m) => {
    const doc = await load(id);
    const name = id[0].toUpperCase() + id.slice(1);
    expect(nodeNames(doc)).toEqual([name]);
    expect(materialNames(doc)).toEqual([`${name}Baked`]);
    expect(doc.getRoot().listMeshes()[0].listPrimitives()).toHaveLength(1);
    const mat = doc.getRoot().listMaterials()[0];
    expect(mat.getMetallicFactor()).toBe(0);
    expect(mat.getRoughnessFactor()).toBeCloseTo(0.95, 2);
    expect(mat.getEmissiveFactor()).toEqual([0, 0, 0]);
    // base colour + normal only: Phobos and Deimos share one shader program.
    expect(textureSet(doc, `${name}Baked`)).toEqual(textureSet(await load(SHAPED[0].id), `${SHAPED[0].id[0].toUpperCase()}${SHAPED[0].id.slice(1)}Baked`));
    expect(textureSet(doc, `${name}Baked`)).toMatchObject({ base: true, normal: true, emissive: false, metalRough: false });
    expect(semantics(doc)).toEqual(["NORMAL", "POSITION", "TEXCOORD_0"]);
    expect(m.shape).toBe(id);
  });

  it.each(SHAPED.map((m) => [m.id, m] as const))("%s: at most 1,500 triangles and 120 KiB", async (id) => {
    expect(triangles(await load(id))).toBeLessThanOrEqual(1500);
    expect(kb(id)).toBeLessThanOrEqual(120);
  });

  // The GLB's unit is half the NSSDC mean diameter, so the game scales it by
  // the moon's size; its tips stay inside MOON_SHAPE_REACH (the collider) and
  // reach nearly to it, and the long axis (+X) points at Mars.
  it.each(SHAPED.map((m) => [m.id, m] as const))("%s: centred, tips inside MOON_SHAPE_REACH, long axis on +X, shortest on +Y (the pole)", async (id, m) => {
    const doc = await load(id);
    const reach = MOON_SHAPE_REACH[m.shape!];
    const r = maxRadius(doc);
    expect(r).toBeLessThanOrEqual(reach);
    expect(r).toBeGreaterThan(reach - 0.05);
    const b = bounds(doc);
    const ext = [0, 1, 2].map((i) => b.max[i] - b.min[i]);
    expect(ext[0]).toBeGreaterThan(ext[2]);
    expect(ext[2]).toBeGreaterThan(ext[1]);
    // Published dimensions (km): Phobos 27 x 22 x 18, Deimos 15 x 12 x 11, within 15%.
    const km = id === "phobos" ? [27, 18, 22] : [15, 11, 12];
    ext.forEach((e, i) => expect(Math.abs((e * m.diameterKm) / 2 / km[i] - 1), `${id} axis ${i}`).toBeLessThan(0.15));
  });

  // The scene's albedo rule (tests/bodyMaps.test.ts for the maps): the
  // surface's linear-luminance median (texels sampled over the triangles,
  // area-weighted) times baseColorFactor is 0.177 x the geometric albedo, within 3%.
  it.each(SHAPED.map((m) => [m.id, m] as const))("%s: texel median x baseColorFactor is 0.177 x its albedo within 3%", async (id, m) => {
    const doc = await load(id);
    const mat = doc.getRoot().listMaterials()[0];
    const tex = mat.getBaseColorTexture()!;
    const { data, info } = await sharp(Buffer.from(tex.getImage()!)).raw().toBuffer({ resolveWithObject: true });
    const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lumAt = (u: number, v: number) => {
      const x = Math.min(info.width - 1, Math.max(0, Math.floor(u * info.width)));
      const y = Math.min(info.height - 1, Math.max(0, Math.floor(v * info.height)));
      const k = (y * info.width + x) * info.channels;
      return 0.2126 * lin(data[k] / 255) + 0.7152 * lin(data[k + 1] / 255) + 0.0722 * lin(data[k + 2] / 255);
    };
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    const pos = prim.getAttribute("POSITION")!, uv = prim.getAttribute("TEXCOORD_0")!, idx = prim.getIndices()!;
    const samples: [number, number][] = [];
    const P = [[], [], []] as number[][], T = [[], [], []] as number[][];
    const BARY = [[1 / 3, 1 / 3], [0.6, 0.2], [0.2, 0.6], [0.2, 0.2]];
    for (let t = 0; t < idx.getCount(); t += 3) {
      for (let c = 0; c < 3; c++) { pos.getElement(idx.getScalar(t + c), P[c]); uv.getElement(idx.getScalar(t + c), T[c]); }
      const e1 = [0, 1, 2].map((i) => P[1][i] - P[0][i]), e2 = [0, 1, 2].map((i) => P[2][i] - P[0][i]);
      const area = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
      for (const [a, b] of BARY) {
        const u = T[0][0] + a * (T[1][0] - T[0][0]) + b * (T[2][0] - T[0][0]);
        const v = T[0][1] + a * (T[1][1] - T[0][1]) + b * (T[2][1] - T[0][1]);
        samples.push([lumAt(u, v), area]);
      }
    }
    samples.sort((x, y) => x[0] - y[0]);
    const total = samples.reduce((s2, x) => s2 + x[1], 0);
    let acc = 0, median = 0;
    for (const [l, w] of samples) { acc += w; if (acc >= total / 2) { median = l; break; } }
    const f = mat.getBaseColorFactor();
    const factor = 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
    expect(Math.abs((median * factor) / (0.177 * m.geometricAlbedo) - 1)).toBeLessThan(0.03);
    expect(m.texelMedianLinear).toBeCloseTo(0.177 * m.geometricAlbedo, 9);
  });

  it("moon.glb, the old fictional moons' model, no longer ships", () => {
    expect(readdirSync("public/models")).not.toContain("moon.glb");
  });
});

describe("career station (career_station.glb)", () => {
  it("has the two nodes CareerStation.tsx uses and two materials", async () => {
    const doc = await load("career_station");
    expect(nodeNames(doc)).toEqual(["CareerStation", "HabitatRing"]);
    expect(materialNames(doc)).toEqual(["DockLight", "HullBaked"]);
  });

  it("keeps the habitat ring a separate, unrotated node on the hub axis, in HullBaked only", async () => {
    // CareerStation.tsx spins the ring by writing rotation.y on this node.
    const doc = await load("career_station");
    const ring = node(doc, "HabitatRing");
    const [x, , z] = ring.getTranslation();
    expect(Math.abs(x)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(z)).toBeLessThanOrEqual(0.02);
    expect(ring.getRotation()).toEqual([0, 0, 0, 1]);
    expect(ring.getMesh()!.listPrimitives().map((p) => p.getMaterial()?.getName())).toEqual(["HullBaked"]);
    const b = getBounds(ring);
    expect(b.max[1] - b.min[1]).toBeLessThanOrEqual(1.0);
    expect(b.max[0]).toBeGreaterThan(3.8);
    expect(b.max[0]).toBeLessThan(4.3);
  });

  it("fits inside the career jump standoff, so a jump never lands in the hull", async () => {
    const doc = await load("career_station");
    expect(maxRadius(doc)).toBeLessThan(STATION_RADII.jumpR);
    const b = bounds(doc);
    expect(b.min[1]).toBeGreaterThanOrEqual(-3.0);
    expect(b.max[1]).toBeLessThanOrEqual(3.2);
  });

  it("parks a jump with the whole ship clear of the hull, not just its centre", async () => {
    // The ship's origin is what sits at jumpR; its nose or tail reaches half a
    // ship length further toward the station. PLAYER_SHIP_SCALE is the scale
    // Spaceship.tsx renders spaceship.glb at.
    const ship = bounds(await load("spaceship"));
    const SHIP_HALF_LENGTH = Math.max(Math.abs(ship.min[2]), Math.abs(ship.max[2])) * PLAYER_SHIP_SCALE;
    const stationMaxRadius = maxRadius(await load("career_station"));
    expect(STATION_RADII.jumpR).toBeGreaterThanOrEqual(stationMaxRadius + SHIP_HALF_LENGTH);
  });

  it("reuses the freighter's material configurations, so it adds no shader program", async () => {
    const [station, cargo] = [await load("career_station"), await load("cargo_ship")];
    expect(textureSet(station, "HullBaked")).toEqual(textureSet(cargo, "HullBaked"));
    expect(textureSet(station, "DockLight")).toEqual(textureSet(cargo, "NavRed"));
    expect(semantics(station)).toEqual(["NORMAL", "POSITION", "TEXCOORD_0"]);
  });

  it("glows amber at the dock lights", async () => {
    const m = (await load("career_station")).getRoot().listMaterials().find((x) => x.getName() === "DockLight")!;
    const [r, g, b] = m.getEmissiveFactor();
    expect(r).toBeGreaterThan(0.9);
    expect(g).toBeGreaterThan(0.3);
    expect(g).toBeLessThan(0.6);
    expect(b).toBeLessThan(0.15);
  });

  it("stays inside its triangle and download budget", async () => {
    const t = triangles(await load("career_station"));
    expect(t).toBeGreaterThanOrEqual(2000);
    expect(t).toBeLessThanOrEqual(6000);
    expect(kb("career_station")).toBeLessThanOrEqual(600);
  });
});

describe("shipyard (shipyard.glb)", () => {
  it("has the two nodes Shipyard.tsx uses and two materials", async () => {
    const doc = await load("shipyard");
    expect(nodeNames(doc)).toEqual(["CraneTrolley", "Shipyard"]);
    expect(materialNames(doc)).toEqual(["HullBaked", "WorkLight"]);
  });

  it("keeps the crane trolley a separate, unrotated node on the gantry", async () => {
    // Shipyard.tsx slides the trolley by writing position.x on this node.
    const t = node(await load("shipyard"), "CraneTrolley");
    const [x, y, z] = t.getTranslation();
    expect(Math.abs(x)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(z)).toBeLessThanOrEqual(0.02);
    expect(y).toBeGreaterThan(1.6);
    expect(y).toBeLessThan(2.4);
    expect(t.getRotation()).toEqual([0, 0, 0, 1]);
  });

  it("parks a jump with the whole ship clear of the hull", async () => {
    const ship = bounds(await load("spaceship"));
    const SHIP_HALF_LENGTH = Math.max(Math.abs(ship.min[2]), Math.abs(ship.max[2])) * PLAYER_SHIP_SCALE;
    const r = maxRadius(await load("shipyard"));
    expect(r).toBeLessThanOrEqual(5.0);
    expect(r).toBeGreaterThanOrEqual(4.0);
    expect(SHIPYARD_RADII.jumpR).toBeGreaterThanOrEqual(r + SHIP_HALF_LENGTH);
  });

  it("reuses the freighter's material configurations, so it adds no shader program", async () => {
    const [yard, cargo] = [await load("shipyard"), await load("cargo_ship")];
    expect(textureSet(yard, "HullBaked")).toEqual(textureSet(cargo, "HullBaked"));
    expect(textureSet(yard, "WorkLight")).toEqual(textureSet(cargo, "NavRed"));
    expect(semantics(yard)).toEqual(["NORMAL", "POSITION", "TEXCOORD_0"]);
  });

  it("glows cool white-blue at the work lights", async () => {
    const m = (await load("shipyard")).getRoot().listMaterials().find((x) => x.getName() === "WorkLight")!;
    const [r, g, b] = m.getEmissiveFactor();
    expect(b).toBeGreaterThan(0.9);
    expect(r).toBeGreaterThan(0.55);
    expect(r).toBeLessThan(0.9);
    expect(g).toBeGreaterThan(r);
  });

  it("costs four draw calls and stays inside its triangle and download budget", async () => {
    const doc = await load("shipyard");
    expect(doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())).toHaveLength(4);
    const t = triangles(doc);
    expect(t).toBeGreaterThanOrEqual(1500);
    expect(t).toBeLessThanOrEqual(5000);
    expect(kb("shipyard")).toBeLessThanOrEqual(600);
  });
});

describe("career buoy (buoy.glb)", () => {
  it("is one node, one mesh, one primitive, one BuoyGlow material", async () => {
    const root = (await load("buoy")).getRoot();
    expect(root.listNodes().map((n) => n.getName())).toEqual(["Buoy"]);
    expect(root.listMeshes()).toHaveLength(1);
    expect(root.listMeshes()[0].listPrimitives()).toHaveLength(1);
    expect(root.listMaterials().map((m) => m.getName())).toEqual(["BuoyGlow"]);
  });

  it("shares Data_Shard's texture set, so the instanced buoys add no shader program", async () => {
    const [buoy, shard] = [await load("buoy"), await load("data_shard")];
    expect(textureSet(buoy, "BuoyGlow")).toEqual(textureSet(shard, "Data_Shard"));
    expect(semantics(buoy)).toEqual(semantics(shard));
  });

  it("stands upright around its glow ring", async () => {
    const b = bounds(await load("buoy"));
    expect(b.min[1]).toBeGreaterThanOrEqual(-1.75);
    expect(b.min[1]).toBeLessThanOrEqual(-1.6);
    expect(b.max[1]).toBeGreaterThanOrEqual(1.5);
    expect(b.max[1]).toBeLessThanOrEqual(1.65);
    for (const r of [0, 2]) {
      expect(b.min[r]).toBeGreaterThanOrEqual(-0.75);
      expect(b.max[r]).toBeLessThanOrEqual(0.75);
    }
  });

  it("stays inside its triangle and download budget", async () => {
    // Drawn five times (one InstancedMesh), against the deep-space ceiling.
    const t = triangles(await load("buoy"));
    expect(t).toBeGreaterThanOrEqual(200);
    expect(t).toBeLessThanOrEqual(400);
    expect(kb("buoy")).toBeLessThanOrEqual(40);
  });
});

describe("dormant gate (dormant_gate.glb)", () => {
  it("is one node with a stone and a seam material: two draw calls", async () => {
    const doc = await load("dormant_gate");
    expect(nodeNames(doc)).toEqual(["DormantGate"]);
    expect(materialNames(doc)).toEqual(["GateStone", "GlyphSeam"]);
    expect(doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())).toHaveLength(2);
  });

  it("is a frame about GATE_RADIUS across, thin along its axis (+Z)", async () => {
    const doc = await load("dormant_gate");
    const r = maxRadius(doc);
    expect(r).toBeGreaterThanOrEqual(GATE_RADIUS - 1);
    expect(r).toBeLessThanOrEqual(GATE_RADIUS + 0.5);
    const b = bounds(doc);
    expect(b.max[2] - b.min[2]).toBeLessThanOrEqual(2.8);
    expect(b.max[0] - b.min[0]).toBeGreaterThan(24);
    expect(b.max[1] - b.min[1]).toBeGreaterThan(24);
  });

  it("leaves the opening clear out to GATE_OPENING_R", async () => {
    // No vertex lies within the opening's pass radius of the axis.
    const doc = await load("dormant_gate");
    const el: number[] = [];
    let minAxial = Infinity;
    for (const n of doc.getRoot().listNodes()) {
      const mesh = n.getMesh();
      if (!mesh) continue;
      const m = n.getWorldMatrix();
      for (const p of mesh.listPrimitives()) {
        const pos = p.getAttribute("POSITION")!;
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, el);
          const x = m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12];
          const y = m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13];
          minAxial = Math.min(minAxial, Math.hypot(x, y));
        }
      }
    }
    expect(minAxial).toBeGreaterThan(GATE_OPENING_R);
  });

  it("reuses the freighter's material configurations, so it adds no shader program", async () => {
    const [gate, cargo] = [await load("dormant_gate"), await load("cargo_ship")];
    expect(textureSet(gate, "GateStone")).toEqual(textureSet(cargo, "HullBaked"));
    expect(textureSet(gate, "GlyphSeam")).toEqual(textureSet(cargo, "NavRed"));
    expect(semantics(gate)).toEqual(["NORMAL", "POSITION", "TEXCOORD_0"]);
  });

  it("glows teal at the seams", async () => {
    const m = (await load("dormant_gate")).getRoot().listMaterials().find((x) => x.getName() === "GlyphSeam")!;
    const [r, g, b] = m.getEmissiveFactor();
    expect(r).toBeLessThan(0.35);
    expect(g).toBeGreaterThan(0.75);
    expect(b).toBeGreaterThan(0.6);
  });

  it("stays inside its triangle and download budget", async () => {
    const t = triangles(await load("dormant_gate"));
    expect(t).toBeGreaterThanOrEqual(600);
    expect(t).toBeLessThanOrEqual(3000);
    expect(kb("dormant_gate")).toBeLessThanOrEqual(600);
  });
});

describe("project probe (probe.glb)", () => {
  // ProjectProbes.tsx draws it as one InstancedMesh of 3 with one shared
  // MeshStandardMaterial; an onBeforeCompile patch tints COLOR_0's R zone
  // with the project colour and blinks the G zone (the beacon lamp).
  it("probe.glb: one mesh, one primitive, one material", async () => {
    const root = (await load("probe")).getRoot();
    expect(root.listMeshes()).toHaveLength(1);
    expect(root.listMeshes()[0].listPrimitives()).toHaveLength(1);
    expect(root.listMaterials()).toHaveLength(1);
    // no KHR_materials_* extension, so three builds a MeshStandardMaterial
    expect(root.listMaterials()[0].listExtensions()).toEqual([]);
  });

  it("probe.glb: COLOR_0 present; R and G masks each cover > 0 and < 25% of vertices", async () => {
    const prim = (await load("probe")).getRoot().listMeshes()[0].listPrimitives()[0];
    const col = prim.getAttribute("COLOR_0");
    expect(col).not.toBeNull();
    const n = col!.getCount();
    const el: number[] = [];
    let r = 0, g = 0;
    for (let i = 0; i < n; i++) {
      col!.getElement(i, el);
      if (el[0] > 0.5) r++;
      if (el[1] > 0.5) g++;
    }
    for (const [zone, count] of [["R", r], ["G", g]] as const) {
      expect(count, zone).toBeGreaterThan(0);
      expect(count / n, zone).toBeLessThan(0.25);
    }
  });

  it("probe.glb: the trim is paint, not light (no emissive), and the maps are all there", async () => {
    // The R zone is a painted stripe the game tints by multiplying the base
    // colour; only the G zone (the beacon) is ever lit, by ProjectProbes.
    const mat = (await load("probe")).getRoot().listMaterials()[0];
    expect(mat.getEmissiveFactor()).toEqual([0, 0, 0]);
    expect(mat.getEmissiveTexture()).toBeNull();
    expect(mat.getBaseColorTexture()).not.toBeNull();
    expect(mat.getMetallicRoughnessTexture()).not.toBeNull();
    expect(mat.getNormalTexture()).not.toBeNull();
  });

  it("probe.glb: triangles <= 6000", async () => {
    expect(triangles(await load("probe"))).toBeLessThanOrEqual(6000);
  });

  it("probe.glb: longest extent 2.7–3.3", async () => {
    // Measured as ProjectProbes sees it: bakeNodeTransform applies the node
    // transform (the quantization scale), which getBounds also applies.
    const b = bounds(await load("probe"));
    const longest = Math.max(...[0, 1, 2].map((i) => b.max[i] - b.min[i]));
    expect(longest).toBeGreaterThanOrEqual(2.7);
    expect(longest).toBeLessThanOrEqual(3.3);
  });

  it("probe.glb: stays inside its download budget", () => {
    expect(kb("probe")).toBeLessThanOrEqual(600);
  });
});

describe("public/models", () => {
  // 8 → 9 MiB on purpose (2026-10-17): the five new worlds' maps add ~0.6–0.8
  // MiB and the old cap was 665 KiB from full (spec "Assets", Budget).
  // 9 → 10 MiB on purpose (2026-10-20, real-solar-system Task 12): NASA/USGS
  // photographic maps compress worse than the seeded ones, Earth gains its
  // cloud and Black Marble maps, and the seven sphere moons' maps (~1 MiB,
  // drawn from Task 14) ship now. This total counts both texture tiers; a
  // device downloads common plus one (tests/bodyMaps.test.ts caps each).
  // 10 → 9 MiB (2026-10-20, Task 14): the moons arrived (maps 9.19 MiB in
  // total at Task 12; moon.glb, 416 KiB, retired; phobos.glb + deimos.glb,
  // 131 KiB, added) for 8.91 MiB, so the cap sits ~90 KiB above the real total.
  // 9 → 17 MiB on purpose (2026-10-22, PR 47): the body and moon maps ship
  // as KTX2 (ETC1S, UASTC where it must), 290 → ~45 MB of GPU memory for the
  // maps at 1512×802 for ~7.6 MiB more download (16.4 MiB; the owner chose
  // maps-only over model textures too). Return visits read the packs from cache.
  it("stays under 17 MiB in total", () => {
    const total = readdirSync("public/models").reduce((s, f) => s + statSync(`public/models/${f}`).size, 0);
    expect(total / 1024 / 1024).toBeLessThan(17);
  });
});

describe("dormant monsters", () => {
  it("no monster file is in public/models (so no asset pack carries one)", () => {
    const names = readdirSync("public/models");
    for (const m of ["saucer", "tardigrade"]) expect(names.some((f) => f.startsWith(m))).toBe(false);
  });

  it("both monsters are optimized into public/models-lab", () => {
    for (const m of ["saucer", "tardigrade"]) expect(existsSync(`public/models-lab/${m}.glb`)).toBe(true);
  });

  it("the lab monsters stay small (blockout sizes; a later task tightens these)", () => {
    for (const m of ["saucer", "tardigrade"]) expect(labKb(m)).toBeLessThanOrEqual(600);
  });
});
