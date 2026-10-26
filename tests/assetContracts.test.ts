import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import type { Node, Primitive } from "@gltf-transform/core";
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
 * loads them by name, size or position (Spaceship, CargoTraffic,
 * PlasmaAnomalies, SpacePlanets, SolarMoons, CareerStation, CareerTrail, Shipyard, DormantGate, ProjectProbes, the bottles). Reads the shipped files, which are quantized
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

/**
 * UV overlaps on one primitive, rasterised at texel centres (res x res):
 * within-island folds (two triangles of one UV island on a texel) and
 * cross-island overlaps. An island is the triangles joined through shared
 * (position, uv) vertices; islands whose UV vertex sets are identical are
 * deliberate shares (repeated parts baked once) and may overlap each other.
 */
function uvOverlaps(p: Primitive, res: number, m?: number[]) {
  const get = (sem: string) => {
    const a = p.getAttribute(sem)!;
    const out: number[][] = [];
    for (let i = 0; i < a.getCount(); i++) out.push(a.getElement(i, []));
    return out;
  };
  const pos = get("POSITION"), uv = get("TEXCOORD_0"), idx = p.getIndices()!;
  const wpos = m ? pos.map(([x, y, z]) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r])) : pos;
  const nt = idx.getCount() / 3;
  const weld = new Map<string, number>();
  const vid = pos.map((q, i) => {
    const k = `${q.map((v) => Math.round(v * 1e4)).join(",")}|${uv[i].map((v) => Math.round(v * 1e6)).join(",")}`;
    if (!weld.has(k)) weld.set(k, weld.size);
    return weld.get(k)!;
  });
  const parent = Array.from({ length: nt }, (_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const byVert = new Map<number, number>();
  for (let t = 0; t < nt; t++) {
    for (let c = 0; c < 3; c++) {
      const v = vid[idx.getScalar(3 * t + c)];
      const o = byVert.get(v);
      if (o === undefined) byVert.set(v, t);
      else parent[find(t)] = find(o);
    }
  }
  const isl = Array.from({ length: nt }, (_, t) => find(t));
  const sets = new Map<number, Set<string>>();
  for (let t = 0; t < nt; t++) {
    const s_ = sets.get(isl[t]) ?? new Set<string>();
    for (let c = 0; c < 3; c++) s_.add(uv[idx.getScalar(3 * t + c)].map((v) => Math.round(v * 1e5)).join(","));
    sets.set(isl[t], s_);
  }
  const sig = new Map<number, string>([...sets].map(([k, v]) => [k, [...v].sort().join(";")]));
  const owner = new Int32Array(res * res).fill(-1);
  const folds = new Map<number, number>();
  let cross = 0;
  for (let t = 0; t < nt; t++) {
    const q = [0, 1, 2].map((c) => uv[idx.getScalar(3 * t + c)].map((v) => v * res - 0.5));
    const [[ax, ay], [bx, by], [cx, cy]] = q;
    const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(d) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(res - 1, Math.ceil(Math.max(ax, bx, cx)));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(res - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const w1 = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / d;
        const w2 = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / d;
        if (w1 <= 1e-6 || w2 <= 1e-6 || 1 - w1 - w2 <= 1e-6) continue;
        const o = owner[y * res + x];
        if (o >= 0 && o !== t) {
          if (isl[o] === isl[t]) folds.set(isl[t], (folds.get(isl[t]) ?? 0) + 1);
          else if (sig.get(isl[o]) !== sig.get(isl[t])) cross++;
        }
        owner[y * res + x] = t;
      }
    }
  }
  // each folding island: its texels and its triangles' mean (world) position
  const foldIslands = [...folds].map(([i, texels]) => {
    const ts = isl.map((v, t) => (v === i ? t : -1)).filter((t) => t >= 0);
    const c = [0, 1, 2].map((k) => ts.reduce((s_, t) => s_ + [0, 1, 2].reduce((a, cc) => a + wpos[idx.getScalar(3 * t + cc)][k], 0) / 3, 0) / ts.length);
    return { texels, tris: ts.length, centre: c };
  });
  return { cross, foldIslands };
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

describe("plasma crystal (space_crystal.glb)", () => {
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
    // Drawn instanced up to 40 times (plasma anomalies; it also drew 40 fuel
    // crystals until those went in 2026-10-26), so every triangle here costs
    // 40 against the deep-space ceiling; a 626-triangle cluster broke it when
    // it cost 80. The budget is kept as it was.
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

describe("message bottle (bottle.glb)", () => {
  // The bottles scene draws it as two InstancedMeshes (one per node): the
  // opaque note and cork, then the blended glass. gen_bottle.py's header has
  // the contract; COLOR_0's R on the glass is the glint zone the game lights.
  it("bottle.glb: a glass node and a contents node, one primitive each, two materials, no extensions", async () => {
    const doc = await load("bottle");
    expect(nodeNames(doc).filter((n) => n.startsWith("Bottle_"))).toEqual(["Bottle_Contents", "Bottle_Glass"]);
    for (const n of ["Bottle_Contents", "Bottle_Glass"]) expect(node(doc, n).getMesh()!.listPrimitives()).toHaveLength(1);
    expect(materialNames(doc)).toEqual(["BottleContents", "BottleGlass"]);
    // no KHR_materials_* extension, so three builds a MeshStandardMaterial
    for (const m of doc.getRoot().listMaterials()) expect(m.listExtensions(), m.getName()).toEqual([]);
    expect(semantics(doc)).not.toContain("TANGENT");
  });

  it("bottle.glb: the glass blends with no maps; the note and cork are one opaque textured material; nothing emits in the file", async () => {
    const doc = await load("bottle");
    expect(textureSet(doc, "BottleGlass")).toMatchObject({ base: false, normal: false, emissive: false, metalRough: false, alpha: "BLEND" });
    expect(textureSet(doc, "BottleContents")).toMatchObject({ base: true, emissive: false, alpha: "OPAQUE" });
    for (const m of doc.getRoot().listMaterials()) {
      expect(m.getEmissiveFactor(), m.getName()).toEqual([0, 0, 0]);
      // single-sided: the glass shows its near outer and far inner wall only
      expect(m.getDoubleSided(), m.getName()).toBe(false);
    }
    const a = doc.getRoot().listMaterials().find((m) => m.getName() === "BottleGlass")!.getAlpha();
    expect(a).toBeGreaterThan(0.1);
    expect(a).toBeLessThan(0.6);
  });

  it("bottle.glb: the glint zone (COLOR_0 R on the glass) is present and small; the contents carry no COLOR_0", async () => {
    const doc = await load("bottle");
    const glass = node(doc, "Bottle_Glass").getMesh()!.listPrimitives()[0];
    const col = glass.getAttribute("COLOR_0");
    expect(col).not.toBeNull();
    const n = col!.getCount();
    const el: number[] = [];
    let lit = 0;
    for (let i = 0; i < n; i++) {
      col!.getElement(i, el);
      if (el[0] > 0.5) lit++;
    }
    expect(lit).toBeGreaterThan(0);
    expect(lit / n).toBeLessThan(0.3);
    expect(node(doc, "Bottle_Contents").getMesh()!.listPrimitives()[0].getAttribute("COLOR_0")).toBeNull();
  });

  it("bottle.glb: triangles <= 1500", async () => {
    expect(triangles(await load("bottle"))).toBeLessThanOrEqual(1500);
  });

  it("bottle.glb: longest extent 0.6–0.8, along +Y (the neck)", async () => {
    // Measured as the scene will see it: node transforms (quantization) applied.
    const b = bounds(await load("bottle"));
    const size = [0, 1, 2].map((i) => b.max[i] - b.min[i]);
    const longest = Math.max(...size);
    expect(longest).toBeGreaterThanOrEqual(0.6);
    expect(longest).toBeLessThanOrEqual(0.8);
    expect(size[1]).toBe(longest);
  });

  it("bottle.glb: the note sits inside the glass (only the cork stands proud, at +Y)", async () => {
    const doc = await load("bottle");
    const g = materialBounds(doc, "BottleGlass"), c = materialBounds(doc, "BottleContents");
    for (const i of [0, 2]) {
      expect(c.min[i]).toBeGreaterThan(g.min[i]);
      expect(c.max[i]).toBeLessThan(g.max[i]);
    }
    expect(c.min[1]).toBeGreaterThan(g.min[1]);
  });

  it("bottle.glb: stays inside its download budget (150 KB)", () => {
    expect(kb("bottle")).toBeLessThanOrEqual(150);
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

  it("the lab monsters stay inside their download budgets (1,600 KB each: R11, R15)", () => {
    expect(labKb("saucer")).toBeLessThanOrEqual(1600);
    expect(labKb("tardigrade")).toBeLessThanOrEqual(1600);
  });
});

describe("saucer (saucer.glb)", () => {
  // The saucer alien (scripts/blender/gen_saucer.py, whose header holds the
  // full contract). Dormant: optimized into public/models-lab for the combat
  // stage, which draws each LOD's primitives as one InstancedMesh per
  // material (3 draw calls for a group) and plays every move in the vertex
  // shader from _MOTION, _FUR and src/data/saucerRig.json.
  const lab = () => load("saucer", "public/models-lab");
  const rig = () => JSON.parse(readFileSync("src/data/saucerRig.json", "utf8"));
  const MATS = ["SaucerBaked", "SaucerDome", "SaucerFur"];
  // 0 hull, 1 body, 2 tentacle, 3 eye L, 4 eye R, 5 eye top, 6 jaw, 7 cannon, 8 goo, then the drips by
  // host (R12): 9 on the rim, 10 on a tentacle, 11 on the body's fur
  const PART_IDS = 12;
  const slot = (id: number) => (id + 0.5) / 16;
  const partOf = (x: number) => {
    const id = Math.round(x * 16 - 0.5);
    return id >= 0 && id < PART_IDS && Math.abs(x - slot(id)) <= 0.01 ? id : -1;
  };
  const lod = async (k: 0 | 1) => node(await lab(), `Saucer_LOD${k}`);
  const prim = (n: Node, material: string) => {
    const p = n.getMesh()!.listPrimitives().find((q) => q.getMaterial()?.getName() === material);
    if (!p) throw new Error(`${n.getName()}: no ${material} primitive`);
    return p;
  };
  /** Every element of a primitive's attribute, decoded (normalized ints back to floats). */
  const elements = (p: Primitive, semantic: string) => {
    const a = p.getAttribute(semantic);
    if (!a) throw new Error(`no ${semantic}`);
    const out: number[][] = [];
    for (let i = 0; i < a.getCount(); i++) out.push(a.getElement(i, []));
    return out;
  };
  const tris = (n: Node) => n.getMesh()!.listPrimitives()
    .reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION")!.getCount()) / 3, 0);
  /** World-space positions of a primitive's vertices (quantization puts a scale on the node). */
  const world = (n: Node, p: Primitive) => {
    const m = n.getWorldMatrix();
    return elements(p, "POSITION").map(([x, y, z]) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]));
  };

  it("has two LOD nodes, each one mesh of the baked, dome and fur primitives", async () => {
    const doc = await lab();
    for (const k of [0, 1] as const) {
      const mesh = (await lod(k)).getMesh();
      expect(mesh, `LOD${k}`).not.toBeNull();
      expect(mesh!.listPrimitives().map((p) => p.getMaterial()?.getName()).sort()).toEqual(MATS);
    }
    expect(nodeNames(doc).filter((n) => n.startsWith("Saucer_LOD"))).toEqual(["Saucer_LOD0", "Saucer_LOD1"]);
  });

  it("stays inside its triangle budget: LOD0 <= 16000, LOD1 <= 4000 (R10; R23 for Gate B fix B's crossing cards and part D's crown strips; R25 for part F's five-row strips and fuller brow fringe: LOD0 15,700)", async () => {
    expect(tris(await lod(0))).toBeLessThanOrEqual(16000);
    expect(tris(await lod(1))).toBeLessThanOrEqual(4000);
  });

  it("is ship-sized: longest extent 2.4–3.6", async () => {
    const b = bounds(await lab());
    const longest = Math.max(...[0, 1, 2].map((i) => b.max[i] - b.min[i]));
    expect(longest).toBeGreaterThanOrEqual(2.4);
    expect(longest).toBeLessThanOrEqual(3.6);
  });

  it("has the three materials, no extensions; the dome blends, the fur alpha-tests", async () => {
    const doc = await lab();
    expect(materialNames(doc)).toEqual(MATS);
    for (const m of MATS) expect(textureSet(doc, m).extensions, m).toEqual([]);
    expect(textureSet(doc, "SaucerDome").alpha).toBe("BLEND");
    expect(textureSet(doc, "SaucerFur").alpha).toBe("MASK");
    // R14/R14a: a stock viewer cuts the lock cards (its unremapped fur base may show lock holes); the game raises the cutoff per shell
    expect(doc.getRoot().listMaterials().find((m) => m.getName() === "SaucerFur")!.getAlphaCutoff()).toBeCloseTo(0.01, 3);
    const baked = textureSet(doc, "SaucerBaked");
    expect([baked.base, baked.metalRough, baked.normal]).toEqual([true, true, true]);
    const dome = textureSet(doc, "SaucerDome");
    expect([dome.base, dome.metalRough, dome.normal, dome.emissive]).toEqual([false, false, false, false]);
    expect(textureSet(doc, "SaucerFur").base).toBe(true);
  });

  it("COLOR_0 zones: skin > 0 and < 75%, spots and band each > 0 and < 40% of SaucerBaked vertices", async () => {
    for (const k of [0, 1] as const) {
      const col = elements(prim(await lod(k), "SaucerBaked"), "COLOR_0");
      const share = (c: number) => col.filter((e) => e[c] > 0.5).length / col.length;
      for (const c of [0, 1, 2]) for (const e of col) expect([0, 1]).toContain(Math.round(e[c] * 100) / 100);
      expect(share(0), `LOD${k} R`).toBeGreaterThan(0);
      expect(share(0), `LOD${k} R`).toBeLessThan(0.75);
      for (const [c, z] of [[1, "G"], [2, "B"]] as const) {
        expect(share(c), `LOD${k} ${z}`).toBeGreaterThan(0);
        expect(share(c), `LOD${k} ${z}`).toBeLessThan(0.4);
      }
    }
  });

  it("_MOTION.x is a part slot on every vertex, and LOD0 has every alien, goo and drip part", async () => {
    const seen = new Set<number>();
    for (const k of [0, 1] as const) {
      for (const p of (await lod(k)).getMesh()!.listPrimitives()) {
        for (const e of elements(p, "_MOTION")) {
          const id = partOf(e[0]);
          expect(id, `LOD${k} ${p.getMaterial()?.getName()} x=${e[0]}`).toBeGreaterThanOrEqual(0);
          for (const v of e) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
          if (k === 0) seen.add(id);
        }
      }
    }
    for (let id = 1; id < PART_IDS; id++) expect(seen.has(id), `part ${id}`).toBe(true);
  });

  it("_MOTION.z ramps the portholes on the hull: exactly rig.portholes non-zero values, (k + 0.5) / N", async () => {
    const n = rig().portholes;
    expect(rig().portholeOrder).toBe("+Z toward +X");
    for (const k of [0, 1] as const) {
      const zs = new Set<number>();
      for (const p of (await lod(k)).getMesh()!.listPrimitives()) {
        for (const e of elements(p, "_MOTION")) if (partOf(e[0]) === 0 && e[2] > 0.001) zs.add(Math.round(e[2] * n - 0.5));
      }
      expect([...zs].sort((a, b) => a - b), `LOD${k}`).toEqual([...Array(n).keys()]);
    }
  });

  it("drips carry their host's weight in _MOTION.z (R12): > 0 on tentacle and body drips, 0 on the rim's", async () => {
    const e = elements(prim(await lod(0), "SaucerBaked"), "_MOTION");
    const z = (id: number) => e.filter((v) => partOf(v[0]) === id).map((v) => v[2]);
    expect(Math.max(...z(9))).toBeLessThan(0.001);
    for (const id of [10, 11]) {
      expect(z(id).length, `part ${id}`).toBeGreaterThan(0);
      expect(Math.min(...z(id)), `part ${id}`).toBeGreaterThan(0);
    }
  });

  it("the dome carries only the hull's slot", async () => {
    for (const k of [0, 1] as const) {
      for (const e of elements(prim(await lod(k), "SaucerDome"), "_MOTION")) {
        expect(partOf(e[0])).toBe(0);
        expect(e.slice(1).every((v) => v === 0)).toBe(true);
      }
    }
  });

  it("slime is never band-tinted, and the rim's slime is geometry over the band (round 2)", async () => {
    // Slime vertices are found by part id: 8 goo strings, 9 the rim's static
    // slime (its smears, raised zone-0 decals, and their drips), 10/11 drips
    // on a tentacle or the body. None may sit in the B (band tint) zone.
    for (const k of [0, 1] as const) {
      const n = await lod(k);
      const p = prim(n, "SaucerBaked");
      const mo = elements(p, "_MOTION"), col = elements(p, "COLOR_0"), pos = world(n, p);
      let slime = 0;
      for (let i = 0; i < mo.length; i++) {
        if ([8, 9, 10, 11].includes(partOf(mo[i][0]))) {
          slime++;
          expect(col[i][2], `LOD${k} slime vertex ${i} in the band zone`).toBeLessThan(0.5);
        }
      }
      expect(slime, `LOD${k}`).toBeGreaterThan(0);
      // the rim's slime reaches up onto the band: part-9 vertices at the band's height
      const bandY = pos.filter((_, i) => col[i][2] > 0.5).map((v) => v[1]);
      const lo = Math.min(...bandY);
      const onRim = pos.filter((v, i) => partOf(mo[i][0]) === 9 && v[1] >= lo).length;
      expect(onRim, `LOD${k} rim slime at the band's height`).toBeGreaterThan(0);
    }
  });

  it("lock cards sample the fur atlas's lock half; the rig says where the halves are", async () => {
    const r = rig();
    expect(r.furAtlas.shells).toEqual([0, 0, 0.5, 1]);
    expect(r.furAtlas.locks).toEqual([0.5, 0, 1, 1]);
    const p = prim(await lod(0), "SaucerFur");
    const uv = elements(p, "TEXCOORD_0"), col = elements(p, "COLOR_0");
    let cards = 0;
    for (let i = 0; i < uv.length; i++) {
      if (col[i][0] < 0.5) continue;
      cards++;
      expect(uv[i][0]).toBeGreaterThanOrEqual(0.5);
      expect(uv[i][0]).toBeLessThanOrEqual(1);
      expect(uv[i][1]).toBeGreaterThanOrEqual(0);
      expect(uv[i][1]).toBeLessThanOrEqual(1);
    }
    expect(cards).toBeGreaterThan(0);
  });

  it("the fur atlas's shell half stays clear of the alpha cutoff after compression (round 4)", async () => {
    // The shells' strand mask is floored over SaucerFur's 0.01 cutoff, so the
    // remapped fur base never cuts; lossy WebP alpha must not pull it under.
    const doc = await lab();
    const fur = doc.getRoot().listMaterials().find((m) => m.getName() === "SaucerFur")!;
    const img = Buffer.from(fur.getBaseColorTexture()!.getImage()!);
    const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let min = 255;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width / 2; x++) min = Math.min(min, data[(y * info.width + x) * info.channels + 3]);
    }
    expect(min / 255).toBeGreaterThan(2 * fur.getAlphaCutoff());
  });

  it("LOD1 keeps the rim slime smears whole, not decimated to their outline (round 4)", async () => {
    // The smears are part 9 with _MOTION.y = 0 (static); their drips ramp y.
    const smearTris = async (k: 0 | 1) => {
      const p = prim(await lod(k), "SaucerBaked");
      const mo = elements(p, "_MOTION"), idx = p.getIndices()!;
      let n = 0;
      for (let t = 0; t < idx.getCount(); t += 3) {
        const vs = [0, 1, 2].map((c) => mo[idx.getScalar(t + c)]);
        if (vs.every((e) => partOf(e[0]) === 9 && e[1] === 0)) n++;
      }
      return n;
    };
    const [t0, t1] = [await smearTris(0), await smearTris(1)];
    expect(t0).toBeGreaterThan(0);
    expect(t1 / t0).toBeGreaterThan(0.6);
  });

  it("the rig's muzzle is under the saucer, inside the bounds, at the cannon", async () => {
    const r = rig();
    const b = bounds(await lab());
    expect(r.muzzle[1]).toBeLessThan(0);
    for (let i = 0; i < 3; i++) {
      expect(r.muzzle[i]).toBeGreaterThanOrEqual(b.min[i]);
      expect(r.muzzle[i]).toBeLessThanOrEqual(b.max[i]);
    }
    const n = await lod(0);
    const p = prim(n, "SaucerBaked");
    const motion = elements(p, "_MOTION");
    const near = world(n, p).filter((_, i) => partOf(motion[i][0]) === 7)
      .map((v) => Math.hypot(v[0] - r.muzzle[0], v[1] - r.muzzle[1], v[2] - r.muzzle[2]));
    expect(near.length).toBeGreaterThan(0);
    expect(Math.min(...near)).toBeLessThanOrEqual(0.15);
  });

  it("the rig has every pivot, the fur's length and shell count, and a LOD distance", () => {
    const r = rig();
    for (const k of ["body", "jaw", "eyeL", "eyeR", "eyeTop", "cannon", "gooTop", "gooBottom"]) {
      expect(r.pivots[k], k).toHaveLength(3);
      for (const v of r.pivots[k]) expect(Number.isFinite(v), k).toBe(true);
    }
    expect(r.muzzle).toHaveLength(3);
    expect(Number.isInteger(r.portholes) && r.portholes > 0).toBe(true);
    expect(r.furMaxLength).toBeGreaterThan(0);
    expect(r.furShells).toBeGreaterThanOrEqual(8);
    expect(r.furShells).toBeLessThanOrEqual(24);
    expect(r.lod1Distance).toBeGreaterThan(0);
    // R13: the glTF y range the body weight is linear over
    expect(r.bodySpan).toHaveLength(2);
    expect(r.bodySpan[1]).toBeGreaterThan(r.bodySpan[0]);
  });

  it("the fur carries _FUR in [0,1]; cards (COLOR_0 R) on LOD0 only", async () => {
    for (const k of [0, 1] as const) {
      const p = prim(await lod(k), "SaucerFur");
      for (const e of elements(p, "_FUR")) {
        expect(e).toHaveLength(2);
        for (const v of e) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
      const cards = elements(p, "COLOR_0").filter((e) => e[0] > 0.5).length;
      if (k === 0) expect(cards, "LOD0 cards").toBeGreaterThan(0);
      else expect(cards, "LOD1 cards").toBe(0);
    }
  });

  it("the baked atlas has no UV overlaps but deliberate shares; one known crown fold is allowed", async () => {
    const n = await lod(0);
    const { cross, foldIslands } = uvOverlaps(prim(n, "SaucerBaked"), 1024, n.getWorldMatrix());
    expect(cross, "cross-island overlaps").toBe(0);
    // The one known fold (found in Task 4's round-2 review) is a small skin
    // island on the crown, high on the head (72 triangles); the saucer is
    // frozen, so it is allowed explicitly. Folds of <= 2 texels are edge
    // precision after quantization (the body's 546-triangle island shows 1).
    const real = foldIslands.filter((f) => f.texels > 2);
    const crown = real.filter((f) => f.centre[1] > 0.9 && f.tris <= 80);
    expect(real.length - crown.length, JSON.stringify(foldIslands)).toBe(0);
    expect(crown.length).toBeLessThanOrEqual(1);
  });

  it("stays inside its 1,600 KB download budget (R11)", () => {
    expect(labKb("saucer")).toBeLessThanOrEqual(1600);
  });
});

describe("tardigrade (tardigrade.glb)", () => {
  // The tardigrade (scripts/blender/gen_tardigrade.py, whose header holds the
  // full contract). Dormant: optimized into public/models-lab for the combat
  // stage, which draws each LOD's two primitives as one InstancedMesh per
  // material (2 draw calls for a group) and plays every move in the vertex
  // shader from _MOTION, _FUR and src/data/tardigradeRig.json.
  const lab = () => load("tardigrade", "public/models-lab");
  const rig = () => JSON.parse(readFileSync("src/data/tardigradeRig.json", "utf8"));
  const MATS = ["TardigradeBaked", "TardigradeFur"];
  // 0 body, 1–8 legs (front-left 1, front-right 2, … back-right 8), 9 mouth tube, 10 crystals, 11 eyes,
  // 12 drool, 13 body/fur-host drips, 14 teeth (task-4 supplement)
  const PART_IDS = 15;
  const slot = (id: number) => (id + 0.5) / 16;
  const partOf = (x: number) => {
    const id = Math.round(x * 16 - 0.5);
    return id >= 0 && id < PART_IDS && Math.abs(x - slot(id)) <= 0.01 ? id : -1;
  };
  const lod = async (k: 0 | 1) => node(await lab(), `Tardigrade_LOD${k}`);
  const prim = (n: Node, material: string) => {
    const p = n.getMesh()!.listPrimitives().find((q) => q.getMaterial()?.getName() === material);
    if (!p) throw new Error(`${n.getName()}: no ${material} primitive`);
    return p;
  };
  const elements = (p: Primitive, semantic: string) => {
    const a = p.getAttribute(semantic);
    if (!a) throw new Error(`no ${semantic}`);
    const out: number[][] = [];
    for (let i = 0; i < a.getCount(); i++) out.push(a.getElement(i, []));
    return out;
  };
  const tris = (n: Node) => n.getMesh()!.listPrimitives()
    .reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute("POSITION")!.getCount()) / 3, 0);
  const world = (n: Node, p: Primitive) => {
    const m = n.getWorldMatrix();
    return elements(p, "POSITION").map(([x, y, z]) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]));
  };
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  it("has two LOD nodes, each one mesh of the baked and fur primitives", async () => {
    const doc = await lab();
    for (const k of [0, 1] as const) {
      const mesh = (await lod(k)).getMesh();
      expect(mesh, `LOD${k}`).not.toBeNull();
      expect(mesh!.listPrimitives().map((p) => p.getMaterial()?.getName()).sort()).toEqual(MATS);
    }
    expect(nodeNames(doc).filter((n) => n.startsWith("Tardigrade_LOD"))).toEqual(["Tardigrade_LOD0", "Tardigrade_LOD1"]);
  });

  it("stays inside its triangle budget: LOD0 <= 15000, LOD1 <= 4000 (R15; R23 for Gate B fix C's spine tufts)", async () => {
    expect(tris(await lod(0))).toBeLessThanOrEqual(15000);
    expect(tris(await lod(1))).toBeLessThanOrEqual(4000);
  });

  it("is about 3x the ship: longest extent 6.5–7.5, the fur counted", async () => {
    const b = bounds(await lab());
    const longest = Math.max(...[0, 1, 2].map((i) => b.max[i] - b.min[i]));
    expect(longest).toBeGreaterThanOrEqual(6.5);
    expect(longest).toBeLessThanOrEqual(7.5);
  });

  it("has exactly the two materials, no extensions; the fur alpha-tests at 0.01", async () => {
    const doc = await lab();
    expect(materialNames(doc)).toEqual(MATS);
    for (const m of MATS) expect(textureSet(doc, m).extensions, m).toEqual([]);
    expect(textureSet(doc, "TardigradeFur").alpha).toBe("MASK");
    expect(doc.getRoot().listMaterials().find((m) => m.getName() === "TardigradeFur")!.getAlphaCutoff()).toBeCloseTo(0.01, 3);
    const baked = textureSet(doc, "TardigradeBaked");
    expect([baked.base, baked.metalRough, baked.normal]).toEqual([true, true, true]);
    expect(baked.alpha).toBe("OPAQUE");
    expect(textureSet(doc, "TardigradeFur").base).toBe(true);
  });

  it("COLOR_0 zones on TardigradeBaked: R (mouth glow) and G (crystals) each > 0 and < 15%, B = 0", async () => {
    for (const k of [0, 1] as const) {
      const col = elements(prim(await lod(k), "TardigradeBaked"), "COLOR_0");
      const share = (c: number) => col.filter((e) => e[c] > 0.5).length / col.length;
      for (const c of [0, 1, 2]) for (const e of col) expect([0, 1]).toContain(Math.round(e[c] * 100) / 100);
      for (const [c, z] of [[0, "R"], [1, "G"]] as const) {
        expect(share(c), `LOD${k} ${z}`).toBeGreaterThan(0);
        expect(share(c), `LOD${k} ${z}`).toBeLessThan(0.15);
      }
      expect(share(2), `LOD${k} B`).toBe(0);
    }
  });

  it("_MOTION.x is a part slot on every vertex, and LOD0 has all 15 parts", async () => {
    const seen = new Set<number>();
    for (const k of [0, 1] as const) {
      for (const p of (await lod(k)).getMesh()!.listPrimitives()) {
        for (const e of elements(p, "_MOTION")) {
          const id = partOf(e[0]);
          expect(id, `LOD${k} ${p.getMaterial()?.getName()} x=${e[0]}`).toBeGreaterThanOrEqual(0);
          for (const v of e) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
          if (k === 0) seen.add(id);
        }
      }
    }
    for (let id = 0; id < PART_IDS; id++) expect(seen.has(id), `part ${id}`).toBe(true);
  });

  it("_MOTION.y runs along the body axis, tail 0 -> mouth 1", async () => {
    const n = await lod(0);
    const p = prim(n, "TardigradeBaked");
    const mo = elements(p, "_MOTION"), pos = world(n, p);
    const body = pos.map((v, i) => [v[2], mo[i][1]]).filter((_, i) => partOf(mo[i][0]) === 0);
    const front = body.reduce((a, b) => (b[0] > a[0] ? b : a));
    const back = body.reduce((a, b) => (b[0] < a[0] ? b : a));
    expect(front[1]).toBeGreaterThan(0.85);
    expect(back[1]).toBeLessThan(0.1);
    // the mouth tube sits at the front of the axis
    const tube = mo.filter((e) => partOf(e[0]) === 9).map((e) => e[1]);
    expect(Math.min(...tube)).toBeGreaterThan(0.8);
  });

  it("_MOTION.z is the leg weight: 0 off the legs, hip 0 -> claw tip 1 on each leg", async () => {
    for (const k of [0, 1] as const) {
      const max = new Map<number, number>();
      for (const p of (await lod(k)).getMesh()!.listPrimitives()) {
        for (const e of elements(p, "_MOTION")) {
          const id = partOf(e[0]);
          if (id >= 1 && id <= 8) max.set(id, Math.max(max.get(id) ?? 0, e[2]));
          else if (id !== 13) expect(e[2], `LOD${k} part ${id} z`).toBe(0);
        }
      }
      for (let id = 1; id <= 8; id++) expect(max.get(id), `LOD${k} leg ${id}`).toBeGreaterThan(0.95);
    }
  });

  it("drips (13) carry the host's axial y at their root in _MOTION.z (within 0.05)", async () => {
    // Honest check: each drip's root vertices (its own y near 0) against the
    // axial y of the nearest body-part vertex (the lock card or skin it hangs from).
    const n = await lod(0);
    const host: { pos: number[]; y: number }[] = [];
    const roots: { pos: number[]; z: number }[] = [];
    for (const p of n.getMesh()!.listPrimitives()) {
      const mo = elements(p, "_MOTION"), pos = world(n, p);
      for (let i = 0; i < mo.length; i++) {
        const id = partOf(mo[i][0]);
        if (id === 0) host.push({ pos: pos[i], y: mo[i][1] });
        if (id === 13 && mo[i][1] < 0.05) roots.push({ pos: pos[i], z: mo[i][2] });
      }
    }
    expect(roots.length).toBeGreaterThan(0);
    for (const r of roots) {
      const near = host.reduce((a, b) => (dist(b.pos, r.pos) < dist(a.pos, r.pos) ? b : a));
      expect(dist(near.pos, r.pos), "drip root near its host").toBeLessThan(0.25);
      expect(Math.abs(near.y - r.z)).toBeLessThanOrEqual(0.05);
    }
  });

  it("the fur carries _FUR in [0,1]; cards (COLOR_0 R) in the atlas's lock half; LOD1 keeps <= 400 fringe-card triangles (R17)", async () => {
    const r = rig();
    expect(r.furAtlas.shells).toEqual([0, 0, 0.5, 1]);
    expect(r.furAtlas.locks).toEqual([0.5, 0, 1, 1]);
    expect(r.furAtlas.lockVariants).toBeGreaterThan(0);
    for (const k of [0, 1] as const) {
      const p = prim(await lod(k), "TardigradeFur");
      for (const e of elements(p, "_FUR")) {
        expect(e).toHaveLength(2);
        for (const v of e) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
      const col = elements(p, "COLOR_0"), uv = elements(p, "TEXCOORD_0");
      let cards = 0;
      for (let i = 0; i < col.length; i++) {
        expect(col[i][1] + col[i][2]).toBe(0);
        if (col[i][0] < 0.5) continue;
        cards++;
        expect(uv[i][0]).toBeGreaterThanOrEqual(0.5);
        expect(uv[i][0]).toBeLessThanOrEqual(1);
        expect(uv[i][1]).toBeGreaterThanOrEqual(0);
        expect(uv[i][1]).toBeLessThanOrEqual(1);
      }
      expect(cards, `LOD${k} cards`).toBeGreaterThan(0);
      if (k === 1) {
        // R17: LOD1's coat outline is a few large merged fringe cards
        const idx = p.getIndices()!;
        let cardTris = 0;
        for (let t = 0; t < idx.getCount(); t += 3) {
          if ([0, 1, 2].every((c) => col[idx.getScalar(t + c)][0] > 0.5)) cardTris++;
        }
        expect(cardTris, "LOD1 card triangles").toBeGreaterThan(0);
        expect(cardTris, "LOD1 card triangles").toBeLessThanOrEqual(400);
      }
    }
  });

  it("the glow zones are exact: COLOR_0 R only on the mouth tube (9), G only on the crystals (10)", async () => {
    for (const k of [0, 1] as const) {
      const p = prim(await lod(k), "TardigradeBaked");
      const col = elements(p, "COLOR_0"), mo = elements(p, "_MOTION");
      for (let i = 0; i < col.length; i++) {
        if (col[i][0] > 0.5) expect(partOf(mo[i][0]), `LOD${k} R vertex ${i}`).toBe(9);
        if (col[i][1] > 0.5) expect(partOf(mo[i][0]), `LOD${k} G vertex ${i}`).toBe(10);
      }
    }
  });

  it("the emissive map is the glow zones' only: lit on the throat, dark off R and G (so the game can scale the charge)", async () => {
    const doc = await lab();
    const baked = doc.getRoot().listMaterials().find((m) => m.getName() === "TardigradeBaked")!;
    const tex = baked.getEmissiveTexture();
    expect(tex, "emissive texture").not.toBeNull();
    const { data, info } = await sharp(Buffer.from(tex!.getImage()!)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (u: number, v: number) => {
      const x = Math.min(info.width - 1, Math.max(0, Math.floor(u * info.width)));
      const y = Math.min(info.height - 1, Math.max(0, Math.floor(v * info.height)));
      const o = (y * info.width + x) * info.channels;
      return Math.max(data[o], data[o + 1], data[o + 2]);
    };
    const p = prim(await lod(0), "TardigradeBaked");
    const uv = elements(p, "TEXCOORD_0"), col = elements(p, "COLOR_0"), idx = p.getIndices()!;
    const off: number[] = [], throat: number[] = [];
    for (let t = 0; t < idx.getCount(); t += 3) {
      const vs = [0, 1, 2].map((c) => idx.getScalar(t + c));
      const u = vs.reduce((s_, i) => s_ + uv[i][0], 0) / 3, v = vs.reduce((s_, i) => s_ + uv[i][1], 0) / 3;
      if (vs.every((i) => col[i][0] < 0.5 && col[i][1] < 0.5)) off.push(at(u, v));
      else if (vs.every((i) => col[i][0] > 0.5)) throat.push(at(u, v));
    }
    // (triangle centroids; a few tiny ones sit within the bake margin of a glowing island)
    expect(off.filter((x) => x > 10).length / off.length).toBeLessThan(0.01);
    throat.sort((a, b) => a - b);
    expect(throat[Math.floor(throat.length / 2)], "throat glow (median)").toBeGreaterThan(20);
  });

  it("the fur moves with the body: every fur vertex is part 0", async () => {
    for (const k of [0, 1] as const) {
      for (const e of elements(prim(await lod(k), "TardigradeFur"), "_MOTION")) expect(partOf(e[0])).toBe(0);
    }
  });

  it("the fur atlas's shell half stays clear of the alpha cutoff after compression", async () => {
    const doc = await lab();
    const fur = doc.getRoot().listMaterials().find((m) => m.getName() === "TardigradeFur")!;
    const img = Buffer.from(fur.getBaseColorTexture()!.getImage()!);
    const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let min = 255;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width / 2; x++) min = Math.min(min, data[(y * info.width + x) * info.channels + 3]);
    }
    expect(min / 255).toBeGreaterThan(2 * fur.getAlphaCutoff());
  });

  it("the rig's mouth is at the front: within 0.3 of the bounds' +Z face", async () => {
    const r = rig();
    const b = bounds(await lab());
    expect(r.mouth).toHaveLength(3);
    expect(b.max[2] - r.mouth[2]).toBeGreaterThanOrEqual(0);
    expect(b.max[2] - r.mouth[2]).toBeLessThanOrEqual(0.3);
    for (const i of [0, 1]) {
      expect(r.mouth[i]).toBeGreaterThanOrEqual(b.min[i]);
      expect(r.mouth[i]).toBeLessThanOrEqual(b.max[i]);
    }
    // the mouth tube is at the rig's mouth
    const n = await lod(0);
    const p = prim(n, "TardigradeBaked");
    const mo = elements(p, "_MOTION");
    const near = world(n, p).filter((_, i) => partOf(mo[i][0]) === 9).map((v) => dist(v, r.mouth));
    expect(Math.min(...near)).toBeLessThanOrEqual(0.6);
  });

  it("the 8 hips mirror in pairs across x = 0 (within 0.005: the origin sits on the symmetry plane), left (+X) first", () => {
    const h: number[][] = rig().hips;
    expect(rig().axis.tail[0]).toBeCloseTo(0, 4);
    expect(h).toHaveLength(8);
    for (let k = 0; k < 8; k += 2) {
      const [l, r] = [h[k], h[k + 1]];
      expect(l[0], `hip ${k + 1} on +X`).toBeGreaterThan(0);
      expect(Math.abs(l[0] + r[0]), `pair ${k / 2}`).toBeLessThanOrEqual(0.005);
      expect(Math.abs(l[1] - r[1]), `pair ${k / 2}`).toBeLessThanOrEqual(0.005);
      expect(Math.abs(l[2] - r[2]), `pair ${k / 2}`).toBeLessThanOrEqual(0.005);
    }
    // front to back
    for (let k = 2; k < 8; k += 2) expect(h[k][2]).toBeLessThan(h[k - 2][2]);
  });

  it("the curl: axis tail -> mouth, and a curlCentre the axis closes into a ball around (2π)", () => {
    const r = rig();
    const { tail, mouth } = r.axis;
    const L = dist(tail, mouth);
    expect(mouth[2]).toBeGreaterThan(tail[2]);
    const mid = [0, 1, 2].map((i) => (tail[i] + mouth[i]) / 2);
    const c: number[] = r.curlCentre;
    const off = [0, 1, 2].map((i) => c[i] - mid[i]);
    // bending the axis (length L) through 2π makes a circle of radius L / 2π
    // about curlCentre: it sits that far from the axis's middle, square to
    // the axis, on the belly side
    expect(Math.hypot(...off)).toBeCloseTo(L / (2 * Math.PI), 3);
    const ax = [0, 1, 2].map((i) => (mouth[i] - tail[i]) / L);
    expect(Math.abs(off[0] * ax[0] + off[1] * ax[1] + off[2] * ax[2])).toBeLessThan(1e-3);
    expect(off[1]).toBeLessThan(0);
  });

  it("the rig has the fur's length and shell count, and a LOD distance", () => {
    const r = rig();
    expect(r.furMaxLength).toBeGreaterThan(0);
    expect(r.furShells).toBeGreaterThanOrEqual(8);
    expect(r.furShells).toBeLessThanOrEqual(24);
    expect(r.lod1Distance).toBeGreaterThan(0);
  });

  it("the baked atlas has no UV folds and no overlaps but deliberate shares (round 2)", async () => {
    // (round 1 found the mouth tube's lip folded onto the throat's floor: its glow showed on the lip)
    const n = await lod(0);
    const { cross, foldIslands } = uvOverlaps(prim(n, "TardigradeBaked"), 1024, n.getWorldMatrix());
    expect(cross, "cross-island overlaps").toBe(0);
    expect(foldIslands, "within-island folds").toEqual([]);
  });

  it("stays inside its 1,600 KB download budget (R15)", () => {
    expect(labKb("tardigrade")).toBeLessThanOrEqual(1600);
  });
});
