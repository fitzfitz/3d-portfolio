import * as THREE from "three";
import { bakeNodeTransform } from "../bakeNodeTransform";
import { prepareMonsterGeometry, splitFurGeometry, type InstanceLayout } from "./monsterInstances";
import {
  SAUCER_INSTANCE_ATTRIBUTES, createSaucerMaterials, saucerBoundsMargin, type SaucerLod, type SaucerRig,
} from "./saucerMaterial";
import {
  TARDIGRADE_INSTANCE_ATTRIBUTES, createTardigradeMaterials, tardigradeBoundsMargin, type TardigradeLod, type TardigradeRig,
} from "./tardigradeMaterial";

/**
 * Builds the instanced monsters from the loaded glbs (moved out of src/lab so
 * the game never imports the lab; the glbs load on demand from
 * monsterAssets.ts's URLs), following the space monsters' Task 5 contract:
 * each LOD node's primitives baked to float with their world matrix
 * (GLTFLoader puts the quantization transform on the node's Group),
 * the fur split into its base and its lock cards (R19), every piece prepared
 * with its instance layout and the model's bounds margin, and one
 * InstancedMesh per piece per LOD. The cards share the fur's material; the
 * dome draws after the body.
 */

/** One monster InstancedMesh, as the debug hooks report it. */
export interface MonsterMesh {
  mesh: THREE.InstancedMesh;
  model: "saucer" | "tardigrade";
  lod: number;
  part: "body" | "dome" | "fur" | "cards";
  /** Triangles in one instance. */
  triangles: number;
}

export interface BuiltSaucer { lods: SaucerLod[]; meshes: MonsterMesh[] }
export interface BuiltTardigrade { lods: TardigradeLod[]; meshes: MonsterMesh[] }

/** The primitives of one LOD node, by material name. */
function lodPrimitives(scene: THREE.Object3D, node: string): Map<string, THREE.Mesh> {
  scene.updateMatrixWorld(true);
  const root = scene.getObjectByName(node);
  if (!root) throw new Error(`monsters: no node ${node} in the glb`);
  const out = new Map<string, THREE.Mesh>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) out.set((m.material as THREE.Material).name, m);
  });
  return out;
}

function piece(prims: Map<string, THREE.Mesh>, material: string): THREE.Mesh {
  const m = prims.get(material);
  if (!m) throw new Error(`monsters: no ${material} primitive`);
  return m;
}

function instanced(g: THREE.BufferGeometry, material: THREE.Material, capacity: number, layout: InstanceLayout,
  margin: number, name: string): THREE.InstancedMesh {
  prepareMonsterGeometry(g, capacity, layout, margin);
  const mesh = new THREE.InstancedMesh(g, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.name = name;
  return mesh;
}

const triangles = (g: THREE.BufferGeometry) => (g.getIndex()?.count ?? g.getAttribute("position").count) / 3;

/** The saucer: body, dome, fur base and cards per LOD (LOD1 has no cards). `capacity` saucers. */
export function buildSaucer(scene: THREE.Object3D, rig: SaucerRig, capacity: number): BuiltSaucer {
  const margin = saucerBoundsMargin(rig);
  const lods: SaucerLod[] = [];
  const meshes: MonsterMesh[] = [];
  let materials: { body: THREE.MeshStandardMaterial; dome: THREE.MeshStandardMaterial; fur: THREE.MeshStandardMaterial } | null = null;
  ["Saucer_LOD0", "Saucer_LOD1"].forEach((node, lod) => {
    const prims = lodPrimitives(scene, node);
    const body = piece(prims, "SaucerBaked"), dome = piece(prims, "SaucerDome"), fur = piece(prims, "SaucerFur");
    // Both levels share the glTF's materials (and so the programs): patch them once.
    if (!materials) {
      materials = {
        body: body.material as THREE.MeshStandardMaterial,
        dome: dome.material as THREE.MeshStandardMaterial,
        fur: fur.material as THREE.MeshStandardMaterial,
      };
      createSaucerMaterials(materials.body, materials.dome, materials.fur, rig);
    }
    const split = splitFurGeometry(bakeNodeTransform(fur, { world: true }));
    const tag = `saucer.lod${lod}`;
    const level: SaucerLod = {
      body: instanced(bakeNodeTransform(body, { world: true }), materials.body, capacity, SAUCER_INSTANCE_ATTRIBUTES.body, margin, `${tag}.body`),
      dome: instanced(bakeNodeTransform(dome, { world: true }), materials.dome, capacity, SAUCER_INSTANCE_ATTRIBUTES.dome, margin, `${tag}.dome`),
      fur: instanced(split.base, materials.fur, capacity * rig.furShells, SAUCER_INSTANCE_ATTRIBUTES.fur, margin, `${tag}.fur`),
      cards: split.cards ? instanced(split.cards, materials.fur, capacity, SAUCER_INSTANCE_ATTRIBUTES.fur, margin, `${tag}.cards`) : null,
    };
    // The glass blends over the alien and its fur, so it draws after them.
    level.dome.renderOrder = 2;
    lods.push(level);
    for (const part of ["body", "dome", "fur", "cards"] as const) {
      const mesh = level[part];
      if (mesh) meshes.push({ mesh, model: "saucer", lod, part, triangles: triangles(mesh.geometry) });
    }
  });
  return { lods, meshes };
}

/** The tardigrade: body, fur base and cards per LOD (LOD1 keeps its merged fringe cards). `capacity` tardigrades. */
export function buildTardigrade(scene: THREE.Object3D, rig: TardigradeRig, capacity: number): BuiltTardigrade {
  const margin = tardigradeBoundsMargin(rig);
  const lods: TardigradeLod[] = [];
  const meshes: MonsterMesh[] = [];
  let materials: { body: THREE.MeshStandardMaterial; fur: THREE.MeshStandardMaterial } | null = null;
  ["Tardigrade_LOD0", "Tardigrade_LOD1"].forEach((node, lod) => {
    const prims = lodPrimitives(scene, node);
    const body = piece(prims, "TardigradeBaked"), fur = piece(prims, "TardigradeFur");
    if (!materials) {
      materials = { body: body.material as THREE.MeshStandardMaterial, fur: fur.material as THREE.MeshStandardMaterial };
      createTardigradeMaterials(materials.body, materials.fur, rig);
    }
    const split = splitFurGeometry(bakeNodeTransform(fur, { world: true }));
    const tag = `tardigrade.lod${lod}`;
    const level: TardigradeLod = {
      body: instanced(bakeNodeTransform(body, { world: true }), materials.body, capacity, TARDIGRADE_INSTANCE_ATTRIBUTES.body, margin, `${tag}.body`),
      fur: instanced(split.base, materials.fur, capacity * rig.furShells, TARDIGRADE_INSTANCE_ATTRIBUTES.fur, margin, `${tag}.fur`),
      cards: split.cards ? instanced(split.cards, materials.fur, capacity, TARDIGRADE_INSTANCE_ATTRIBUTES.fur, margin, `${tag}.cards`) : null,
    };
    lods.push(level);
    for (const part of ["body", "fur", "cards"] as const) {
      const mesh = level[part];
      if (mesh) meshes.push({ mesh, model: "tardigrade", lod, part, triangles: triangles(mesh.geometry) });
    }
  });
  return { lods, meshes };
}
