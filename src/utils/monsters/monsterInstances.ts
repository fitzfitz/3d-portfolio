import * as THREE from "three";

/**
 * Instancing for the space monsters (Task 5): geometry preparation and the
 * per-frame slot packing every monster type shares.
 *
 * Each LOD level of a monster type is one InstancedMesh per primitive, the
 * fur split in two (R19: the base, once per shell; the lock cards, once per
 * monster): the saucer 4 (3 on LOD1, which has no cards), the tardigrade 3,
 * whatever the group's size, per LOD level in use. Every frame the caller
 * zeroes the counts (beginMonsterFrame), adds each monster (addSaucer /
 * addTardigrade pick its LOD by distance and claim the next slots), then
 * closes the frame (endMonsterFrame). Slots are packed, so a mesh draws
 * exactly the instances in use: no hidden or collapsed shells are submitted.
 * Nothing here allocates per frame.
 */

/** Per-instance attributes of one primitive: name → item size. */
export type InstanceLayout = Readonly<Record<string, number>>;

/** GLTFLoader's names for the monster channels → the names the shaders read. */
const RENAMES = [["color", "monsterMask"], ["_motion", "monsterMotion"], ["_fur", "monsterFur"]] as const;

/**
 * Readies a monster primitive's geometry for instancing, in place:
 *  - renames COLOR_0 (a zone mask), _MOTION and _FUR to the shaders' names;
 *  - adds the layout's per-instance attributes, `capacity` slots each
 *    (the fur's capacity is monsters × rig.furShells), dynamic;
 *  - pads the bounding sphere by `margin`, the model's own bounds margin
 *    (saucerBoundsMargin / tardigradeBoundsMargin: the vertex motion and the
 *    fur's shells reach past the rest mesh), so InstancedMesh's bounds never
 *    cull a monster at the edge of the screen while part of it still shows.
 *    Required: a forgotten margin of 0 culls early.
 * Pass the geometry with its node transform baked in, in float: the rigs are
 * in glTF space, and the files quantize positions onto the node. Each LOD
 * node is one mesh of 2–3 primitives, which GLTFLoader loads as a Group (the
 * node, carrying the quantization scale and offset) of one Mesh per
 * primitive whose own matrix is identity, so bake the mesh's matrixWorld
 * (after updateWorldMatrix), not mesh.matrix as bakeNodeTransform does.
 */
export function prepareMonsterGeometry(g: THREE.BufferGeometry, capacity: number, layout: InstanceLayout, margin: number): void {
  for (const [from, to] of RENAMES) {
    const a = g.getAttribute(from);
    if (!a) continue;
    g.deleteAttribute(from);
    g.setAttribute(to, a);
  }
  for (const name of Object.keys(layout)) {
    const size = layout[name];
    const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size);
    a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
  }
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += margin;
}

/**
 * Splits a fur primitive (R19) by its card flag (COLOR_0 R, 1 on lock-card
 * vertices) into the fur base, which draws once per shell, and the lock
 * cards, which draw once per monster (null when the primitive has none, as
 * the saucer's LOD1). Each part keeps only its own vertices, every
 * attribute copied as float. Call it at load, on the baked geometry, before
 * prepareMonsterGeometry; both parts take the fur's material and layout (a
 * card is shell 0 of 1 in the same program). A triangle with one or two
 * card-flagged vertices is a broken export (the shader would stretch it
 * between a shell and a card), so it throws rather than vote it to a side.
 */
export function splitFurGeometry(g: THREE.BufferGeometry): { base: THREE.BufferGeometry; cards: THREE.BufferGeometry | null } {
  const mask = g.getAttribute("color") ?? g.getAttribute("monsterMask");
  if (!mask) throw new Error("splitFurGeometry: the fur has no COLOR_0 card mask");
  const index = g.getIndex();
  const n = index ? index.count : g.getAttribute("position").count;
  const vert = (k: number) => (index ? index.getX(k) : k);
  const base: number[] = [], cards: number[] = [];
  for (let k = 0; k < n; k += 3) {
    let flagged = 0;
    for (let c = 0; c < 3; c++) if (mask.getX(vert(k + c)) > 0.5) flagged++;
    if (flagged === 1 || flagged === 2) {
      throw new Error(`splitFurGeometry: triangle ${k / 3} is mixed card and base (${flagged} of 3 vertices card-flagged)`);
    }
    (flagged === 3 ? cards : base).push(vert(k), vert(k + 1), vert(k + 2));
  }
  return { base: subsetGeometry(g, base), cards: cards.length ? subsetGeometry(g, cards) : null };
}

/** A geometry of the listed triangles' vertices only (float attributes, compacted, re-indexed). */
function subsetGeometry(g: THREE.BufferGeometry, tris: readonly number[]): THREE.BufferGeometry {
  const remap = new Map<number, number>();
  const order: number[] = [];
  const idx = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) {
    let v = remap.get(tris[i]);
    if (v === undefined) { v = order.length; remap.set(tris[i], v); order.push(tris[i]); }
    idx[i] = v;
  }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name);
    const arr = new Float32Array(order.length * a.itemSize);
    for (let i = 0; i < order.length; i++) for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(order[i], c);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** Starts a frame: every mesh draws nothing until monsters are added. */
export function beginMonsterFrame(meshes: readonly THREE.InstancedMesh[]): void {
  for (let i = 0; i < meshes.length; i++) meshes[i].count = 0;
}

/** Ends a frame: uploads the instance matrices and fits each mesh's bounds to its instances. */
export function endMonsterFrame(meshes: readonly THREE.InstancedMesh[]): void {
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }
}

/** Claims the next slot of `mesh` at `matrix`; -1 when the mesh is full. */
export function claimSlot(mesh: THREE.InstancedMesh, matrix: THREE.Matrix4): number {
  const i = mesh.count;
  if (i >= mesh.instanceMatrix.count) return -1;
  mesh.count = i + 1;
  mesh.setMatrixAt(i, matrix);
  return i;
}

/** Writes a fur slot's shell: index `shell` of `shells`. */
export function writeShell(mesh: THREE.InstancedMesh, i: number, shell: number, shells: number): void {
  const a = mesh.geometry.getAttribute("monsterShell") as THREE.InstancedBufferAttribute | undefined;
  if (!a) return;
  a.setXY(i, shell, shells);
  a.needsUpdate = true;
}

/** Writes a vec2/vec3/vec4 per-instance attribute's slot, if the mesh has it. */
export function writeSlot(mesh: THREE.InstancedMesh, name: string, i: number, x: number, y: number, z = 0, w = 0): void {
  const a = mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute | undefined;
  if (!a) return;
  const o = i * a.itemSize, arr = a.array as Float32Array;
  arr[o] = x;
  arr[o + 1] = y;
  if (a.itemSize > 2) arr[o + 2] = z;
  if (a.itemSize > 3) arr[o + 3] = w;
  a.needsUpdate = true;
}

export const clamp01 = (x: number): number => (x > 0 ? (x < 1 ? x : 1) : 0);
/** Wraps into [0, 1) (and never returns -0). */
export const wrap01 = (x: number): number => x - Math.floor(x) + 0;
