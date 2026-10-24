import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { furReach } from "../src/utils/monsters/monsterShading";
import { prepareMonsterGeometry, splitFurGeometry } from "../src/utils/monsters/monsterInstances";
import {
  SAUCER_INSTANCE_ATTRIBUTES, saucerBoundsMargin, saucerDeformPoint, type SaucerPose, type SaucerRig,
} from "../src/utils/monsters/saucerMaterial";
import {
  tardigradeBoundsMargin, tardigradeDeformPoint, type TardigradePose, type TardigradeRig,
} from "../src/utils/monsters/tardigradeMaterial";

/**
 * The space monsters' geometry contract on the real, shipped glbs
 * (public/models-lab), read the way the lab and the combat stage read them:
 * each primitive with its node transform baked in, in float.
 *  - splitFurGeometry: no fur triangle is half card, half base (a majority
 *    vote would silently move it), and each fur splits into the R19 counts.
 *  - The bounds margin each model exports covers every vertex's reach past
 *    its primitive's rest bounding sphere at the extreme poses (the vertex
 *    shader's TS mirrors), plus the fur's shell reach, so an instance at the
 *    edge of the screen is never culled while part of it still shows.
 */
const saucerRig = (): SaucerRig => JSON.parse(readFileSync("src/data/saucerRig.json", "utf8"));
const tardigradeRig = (): TardigradeRig => JSON.parse(readFileSync("src/data/tardigradeRig.json", "utf8"));

let io: NodeIO;
const docs = new Map<string, Document>();
beforeAll(async () => {
  await MeshoptDecoder.ready;
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
});
async function doc(name: string): Promise<Document> {
  if (!docs.has(name)) docs.set(name, await io.read(`public/models-lab/${name}.glb`));
  return docs.get(name)!;
}

interface Prim {
  node: string;
  material: string;
  /** glTF-space positions (the node's quantization transform baked in). */
  position: Float32Array;
  motion: Float32Array;
  fur: Float32Array | null;
  /** COLOR_0, the zone mask (R = card flag on the fur). */
  color: Float32Array | null;
  index: Uint32Array;
}

/** Every primitive of a model, decoded to float with its node's world matrix applied. */
async function primitives(name: string): Promise<Prim[]> {
  const out: Prim[] = [];
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (const node of (await doc(name)).getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    m.fromArray(node.getWorldMatrix());
    for (const p of mesh.listPrimitives()) {
      const read = (semantic: string) => {
        const a = p.getAttribute(semantic);
        if (!a) return null;
        const n = a.getElementSize(), arr = new Float32Array(a.getCount() * n), e: number[] = [];
        for (let i = 0; i < a.getCount(); i++) { a.getElement(i, e); for (let k = 0; k < n; k++) arr[i * n + k] = e[k]; }
        return arr;
      };
      const position = read("POSITION")!;
      for (let i = 0; i < position.length; i += 3) {
        v.fromArray(position, i).applyMatrix4(m).toArray(position, i);
      }
      const idx = p.getIndices()!;
      const index = new Uint32Array(idx.getCount());
      for (let i = 0; i < index.length; i++) index[i] = idx.getScalar(i);
      out.push({
        node: node.getName(), material: p.getMaterial()!.getName(), position,
        motion: read("_MOTION")!, fur: read("_FUR"), color: read("COLOR_0"), index,
      });
    }
  }
  return out;
}

/** A three.js geometry of a fur primitive as GLTFLoader names it (position, color, index). */
function furGeometry(p: Prim): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(p.position, 3));
  g.setAttribute("color", new THREE.BufferAttribute(p.color!, 4));
  g.setIndex(new THREE.BufferAttribute(p.index, 1));
  return g;
}

describe("splitFurGeometry on the shipped glbs (R19)", () => {
  it("refuses a fur triangle that is half card, half base, instead of voting it to one side", () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    for (const flags of [[1, 0, 0], [1, 1, 0]]) {
      g.setAttribute("color", new THREE.Float32BufferAttribute(flags.flatMap((r) => [r, 0, 0, 1]), 4));
      g.setIndex([0, 1, 2]);
      expect(() => splitFurGeometry(g), `${flags}`).toThrow(/mixed/);
    }
  });

  // Triangle counts of the R19 split (task-5-report: saucer cards 3,708 of
  // 4,174 on LOD0, none on LOD1; tardigrade 2,948 of 4,026, LOD1's merged
  // fringe 288 of 690).
  const EXPECTED: Record<string, [number, number]> = {
    Saucer_LOD0: [466, 3708], Saucer_LOD1: [206, 0], Tardigrade_LOD0: [1078, 2948], Tardigrade_LOD1: [402, 288],
  };
  for (const model of ["saucer", "tardigrade"]) {
    it(`${model}: every fur splits cleanly into its base and its cards`, async () => {
      const furs = (await primitives(model)).filter((p) => p.material.endsWith("Fur"));
      expect(furs.length).toBe(2);
      for (const p of furs) {
        const { base, cards } = splitFurGeometry(furGeometry(p));
        const [b, c] = EXPECTED[p.node];
        expect(base.getIndex()!.count / 3, `${p.node} base`).toBe(b);
        expect(cards ? cards.getIndex()!.count / 3 : 0, `${p.node} cards`).toBe(c);
        expect(cards === null, `${p.node} cards null when there are none`).toBe(c === 0);
      }
    });
  }
});

describe("the bounds margin covers every vertex's reach past its rest sphere", () => {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const TIMES = [0, 0.41, 0.93, 1.7, 2.6, 3.3, 4.4, 5.9, 7.2, 9.1];

  /** The worst excess, over vertices and poses, of |deformed − c| (+ the fur's shell reach) beyond the rest radius. */
  function worstExcess(p: Prim, rigFur: number, poses: readonly unknown[],
    deform: (motion: number[], rest: THREE.Vector3, pose: never, t: number, out: THREE.Vector3) => void) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p.position, 3));
    g.computeBoundingSphere();
    const { center, radius } = g.boundingSphere!;
    const rest = new THREE.Vector3(), out = new THREE.Vector3(), motion = [0, 0, 0, 0];
    let worst = -Infinity;
    for (let i = 0; i < p.position.length / 3; i++) {
      rest.fromArray(p.position, i * 3);
      for (let k = 0; k < 4; k++) motion[k] = p.motion[i * 4 + k];
      const card = p.color && p.fur ? p.color[i * 4] > 0.5 : false;
      const shell = p.fur && !card ? furReach(rigFur) * p.fur[i * 2] : 0;
      for (const pose of poses) {
        for (const t of TIMES) {
          deform(motion, rest, pose as never, t, out);
          worst = Math.max(worst, out.distanceTo(center) + shell - radius);
        }
      }
    }
    return { worst, radius };
  }

  it("saucer: fire, hit, lean, wave, look and aim at their extremes stay inside the padded sphere", async () => {
    const rig = saucerRig();
    const margin = saucerBoundsMargin(rig);
    const pose = (o: Partial<SaucerPose>): SaucerPose => ({
      phase: 0, look: v(0, 0, 1), aim: v(0, 0, 1), chase: -1, fire: 0, hit: 0, defeat: 0, blink: 0, ...o,
    });
    const poses: SaucerPose[] = [];
    for (const fire of [0, 1]) for (const hit of [0, 1]) for (const aim of [v(0, 0, 1), v(1, -3, 0.2), v(-1, 0.3, -1)]) {
      for (const phase of [0, 0.37]) poses.push(pose({ fire, hit, aim, phase, look: v(1, 1, 1), defeat: fire, blink: hit }));
    }
    for (const p of await primitives("saucer")) {
      const { worst, radius } = worstExcess(p, rig.furMaxLength, poses,
        (motion, rest, ps: SaucerPose, t, out) => saucerDeformPoint(rig, motion, rest, ps, t, 1, out));
      expect(worst, `${p.node} ${p.material}: reach past the rest sphere`).toBeLessThanOrEqual(margin);
      // Conservative, not absurd: the padding never doubles the sphere.
      expect(margin, `${p.node} ${p.material}`).toBeLessThan(radius);
    }
  });

  it("tardigrade: swim, paddle, charge, recoil, hit and every stage of the curl stay inside the padded sphere", async () => {
    const rig = tardigradeRig();
    const margin = tardigradeBoundsMargin(rig);
    const poses: TardigradePose[] = [];
    for (const swim of [0, 1]) for (const charge of [0, 1]) for (const recoil of [0, 1]) for (const hit of [0, 1]) {
      for (const curl of [0, 0.25, 0.5, 0.75, 1]) poses.push({ phase: 0.2, swim, charge, recoil, hit, curl });
    }
    for (const p of await primitives("tardigrade")) {
      const { worst, radius } = worstExcess(p, rig.furMaxLength, poses,
        (motion, rest, ps: TardigradePose, t, out) => tardigradeDeformPoint(rig, motion, rest, ps, t, 1, out));
      expect(worst, `${p.node} ${p.material}: reach past the rest sphere`).toBeLessThanOrEqual(margin);
      expect(margin, `${p.node} ${p.material}`).toBeLessThan(radius);
    }
  });

  it("prepareMonsterGeometry pads the rest sphere by exactly the margin it is given", () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 2, 0], 3));
    g.computeBoundingSphere();
    const r0 = g.boundingSphere!.radius;
    const margin = saucerBoundsMargin(saucerRig());
    prepareMonsterGeometry(g, 4, SAUCER_INSTANCE_ATTRIBUTES.body, margin);
    expect(g.boundingSphere!.radius).toBeCloseTo(r0 + margin, 6);
    expect(margin).toBeGreaterThan(furReach(saucerRig().furMaxLength));
  });
});
