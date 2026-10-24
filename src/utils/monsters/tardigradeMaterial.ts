import * as THREE from "three";
import { TOKSVIG_FRAGMENT } from "../../components/canvas/toksvig";
import {
  MONSTER_VERTEX_COMMON, TRANSLUCENCY_FRAGMENT, furShellCount, furVertexHeader, glslFloat, glslVec, injectShader,
  monsterVertexMain, patchFurFragment, shareMonsterUniforms, translucencyHeader,
} from "./monsterShading";
import { claimSlot, clamp01, writeShell, writeSlot, wrap01 } from "./monsterInstances";

/**
 * The tardigrade's instanced materials and motion (space monsters, Task 5).
 * Contract: gen_tardigrade.py's CONTRACT header and
 * src/data/tardigradeRig.json. Two primitives, two programs, two draw calls
 * per LOD level in use:
 *  - TardigradeBaked ("tardigrade:v1"): parts by _MOTION.x slot (0 body, 1–8
 *    legs front-left 1 … back-right 8, 9 mouth tube, 10 crystals, 11 eyes, 12
 *    drool, 13 body drips, 14 teeth). The body undulates along its axis
 *    (_MOTION.y, tail 0 → mouth 1), the legs paddle about their hips
 *    (_MOTION.z, hip 0 → claw 1), recoil compresses the axis, a hit squashes,
 *    the curl bends the axis round rig.curlCentre into the tun ball and draws
 *    the legs in. The emissive map's throat glow (COLOR_0 R) scales by
 *    charge² × THROAT_GAIN (dark at 0); the crystals (G) glow steadily with a
 *    slow pulse;
 *  - TardigradeFur ("tardigradeFur:v1"): the coat's shells and lock cards,
 *    all on the body (part 0), so they undulate and curl with it.
 * Under reduced motion (uMotion 0) no vertex moves: only the glow changes.
 */

type Vec3 = readonly number[];

export interface TardigradeRig {
  hips: readonly Vec3[];
  axis: { tail: Vec3; mouth: Vec3 };
  curlCentre: Vec3;
  mouth: Vec3;
  furMaxLength: number;
  furAtlas: { shells: readonly number[]; locks: readonly number[]; lockVariants: number };
  furShells: number;
  lod1Distance: number;
}

/** One tardigrade's pose, written per instance each frame. `phase` wraps (0 → 1); the rest are 0 → 1 and clamp. */
export interface TardigradePose { phase: number; swim: number; charge: number; recoil: number; hit: number; curl: number }

/** One LOD level's two InstancedMeshes (each geometry from prepareMonsterGeometry). */
export interface TardigradeLod { body: THREE.InstancedMesh; fur: THREE.InstancedMesh }

/**
 * Per-instance attributes (name → item size): tardigradePose (phase, swim,
 * charge, recoil), tardigradeState (hit, curl), and monsterShell (shell
 * index, shell count) on the fur.
 */
export const TARDIGRADE_INSTANCE_ATTRIBUTES = {
  body: { tardigradePose: 4, tardigradeState: 2 },
  fur: { tardigradePose: 4, tardigradeState: 2, monsterShell: 2 },
} as const;

/** Throat emissive gain at full charge (× the emissive map's full-charge glow). */
export const THROAT_GAIN = 2.5;
/** The crystals' steady glow and its slow pulse (a share of it). */
export const CRYSTAL_GLOW = 1.4;
export const CRYSTAL_PULSE = 0.12;
/** At full curl the legs draw this share of the way in toward their hips (the feet would cross the ball's centre). */
export const LEG_RETRACT = 0.6;

// motion amounts (model units / radians)
const UNDULATE = 0.12;        // the body wave's amplitude at swim 1
const UNDULATE_IDLE = 0.02;   // its idle breath
const PADDLE_SWIM = 0.45;     // the legs' stroke (rad) at swim 1
const PADDLE_IDLE = 0.12;
const RECOIL = 0.18;          // the axis shortens this much at recoil 1 (the body bulges by half)
const HIT_SQUASH = 0.2;       // back-to-belly squash at hit 1 (spreads sideways by half)
const TUBE_SWELL = 0.1;       // the mouth tube swells this much at charge 1
const DROOL_STRETCH = 0.35;   // the drool lengthens this much (u at its tip) at charge 1
const DROOL_SWAY = 0.06;
const DRIP_STRETCH = 0.04;
const DRIP_SWAY = 0.03;
/** Warm wrap-lit share of the light through the thin skin (tan-pink flesh glows red-orange). */
const SKIN_SSS: readonly number[] = [1.0, 0.45, 0.3];
const SKIN_SSS_AMOUNT = 0.9;

/** The emissive scale of the throat's glow at `charge`: charge² × THROAT_GAIN, 0 at 0 (the default look is dark). */
export function throatEmissiveScale(charge: number): number {
  const c = clamp01(charge);
  return c * c * THROAT_GAIN;
}

/** How far a leg reaches at `curl`, as a share of its rest reach from the hip. */
export function legRetraction(curl: number): number {
  return 1 - LEG_RETRACT * clamp01(curl);
}

interface Frame { mid: THREE.Vector3; axis: THREE.Vector3; belly: THREE.Vector3; lat: THREE.Vector3; length: number }
const frames = new WeakMap<TardigradeRig, Frame>();

/**
 * The body's frame from the rig: the axis (tail → mouth) and its length, its
 * middle, the belly direction (toward curlCentre, made square to the axis)
 * and the lateral axis (axis × belly, the animal's left, +X).
 */
function frameOf(rig: TardigradeRig): Frame {
  let f = frames.get(rig);
  if (f) return f;
  const tail = new THREE.Vector3(...(rig.axis.tail as [number, number, number]));
  const mouth = new THREE.Vector3(...(rig.axis.mouth as [number, number, number]));
  const length = tail.distanceTo(mouth);
  const axis = mouth.clone().sub(tail).normalize();
  const mid = tail.clone().add(mouth).multiplyScalar(0.5);
  const belly = new THREE.Vector3(...(rig.curlCentre as [number, number, number])).sub(mid);
  belly.addScaledVector(axis, -belly.dot(axis)).normalize();
  const lat = axis.clone().cross(belly).normalize();
  f = { mid, axis, belly, lat, length };
  frames.set(rig, f);
  return f;
}

/** (sin φ / φ, (1 − cos φ) / φ), stable at φ → 0. The TS mirror of tardigradeArc. */
function arc(phi: number, out: { s: number; c: number }) {
  if (Math.abs(phi) < 1e-4) { out.s = 1; out.c = 0.5 * phi; return out; }
  out.s = Math.sin(phi) / phi;
  out.c = (1 - Math.cos(phi)) / phi;
  return out;
}
const _arc = { s: 0, c: 0 };

/**
 * Where the axis point at axial position `a` (tail 0 → mouth 1) goes at curl
 * `k` (0 straight → 1 the closed ball): the axis bent round a circle of
 * radius L / (2πk) whose centre sits that far from the axis's middle toward
 * the belly, so k = 1 closes the tail onto the mouth round rig.curlCentre.
 * The TS mirror of tardigradeBody's bend (its cross-sections turn with the
 * tangent about the lateral axis by the same angle φ = 2πk (a − ½)).
 */
export function tardigradeCurlPoint(a: number, k: number, rig: TardigradeRig, out: THREE.Vector3): THREE.Vector3 {
  const f = frameOf(rig);
  const sm = (a - 0.5) * f.length;
  arc((2 * Math.PI * clamp01(k) * sm) / f.length, _arc);
  return out.copy(f.mid).addScaledVector(f.axis, sm * _arc.s).addScaledVector(f.belly, sm * _arc.c);
}

/** Packs a tardigrade's pose into slot `i` of `mesh`'s per-instance attributes; clamps; allocates nothing. */
export function writeTardigradeInstance(mesh: THREE.InstancedMesh, i: number, pose: TardigradePose): void {
  writeSlot(mesh, "tardigradePose", i, wrap01(pose.phase), clamp01(pose.swim), clamp01(pose.charge), clamp01(pose.recoil));
  writeSlot(mesh, "tardigradeState", i, clamp01(pose.hit), clamp01(pose.curl));
}

/**
 * Adds one tardigrade to this frame (between beginMonsterFrame and
 * endMonsterFrame): its LOD level at rig.lod1Distance, its body slot and one
 * fur slot per shell, at `matrix`. A full mesh drops it. Allocates nothing.
 */
export function addTardigrade(lods: readonly TardigradeLod[], rig: TardigradeRig, matrix: THREE.Matrix4, distance: number,
  pose: TardigradePose): void {
  const lod = lods[distance >= rig.lod1Distance && lods.length > 1 ? 1 : 0];
  const i = claimSlot(lod.body, matrix);
  if (i < 0) return;
  writeTardigradeInstance(lod.body, i, pose);
  const n = furShellCount(distance, rig.furMaxLength, rig.furShells);
  for (let s = 0; s < n; s++) {
    const j = claimSlot(lod.fur, matrix);
    if (j < 0) return;
    writeTardigradeInstance(lod.fur, j, pose);
    writeShell(lod.fur, j, s, n);
  }
}

// ----------------------------------------------------------- shaders -----

function tardigradeVertexHeader(rig: TardigradeRig, baked: boolean): string {
  const f = frameOf(rig);
  const common = /* glsl */ `
attribute vec4 tardigradePose;
attribute vec2 tardigradeState;
const vec3 TARDI_MID = ${glslVec(f.mid.toArray())};
const vec3 TARDI_AXIS = ${glslVec(f.axis.toArray())};
const vec3 TARDI_BELLY = ${glslVec(f.belly.toArray())};
const vec3 TARDI_LAT = ${glslVec(f.lat.toArray())};
const float TARDI_LENGTH = ${glslFloat(f.length)};
vec2 tardigradeArc( float phi ) {
  if ( abs( phi ) < 1e-4 ) return vec2( 1.0, 0.5 * phi );
  return vec2( sin( phi ) / phi, ( 1.0 - cos( phi ) ) / phi );
}
void tardigradeBody( inout vec3 p, inout vec3 n, float a, int part, float t, float ph, float m ) {
  float swim = tardigradePose.y, charge = tardigradePose.z, recoil = tardigradePose.w;
  float hit = tardigradeState.x, curl = tardigradeState.y * m;
  float sm = ( a - 0.5 ) * TARDI_LENGTH;
  vec3 q = p - ( TARDI_MID + TARDI_AXIS * sm );
  float qa = dot( q, TARDI_AXIS );
  vec3 qp = q - TARDI_AXIS * qa;
  if ( part == 9 || part == 12 || part == 14 ) qp *= 1.0 + ${glslFloat(TUBE_SWELL)} * charge * charge * m;
  sm *= 1.0 - ${glslFloat(RECOIL)} * recoil * m;
  qp *= 1.0 + ${glslFloat(RECOIL / 2)} * recoil * m;
  float hk = ${glslFloat(HIT_SQUASH)} * hit * m;
  qp += TARDI_BELLY * ( - hk * dot( qp, TARDI_BELLY ) ) + TARDI_LAT * ( 0.5 * hk * dot( qp, TARDI_LAT ) );
  float amp = ( ${glslFloat(UNDULATE_IDLE)} + ${glslFloat(UNDULATE)} * swim ) * ( 0.35 + 0.65 * ( 1.0 - a ) ) * m;
  qp += ( - TARDI_BELLY * 0.7 * sin( MONSTER_TAU * 1.1 * a - t * ( 1.6 + 2.2 * swim ) + ph )
    + TARDI_LAT * sin( MONSTER_TAU * 0.8 * a - t * ( 1.2 + 1.8 * swim ) + ph + 1.3 ) ) * amp;
  float phi = MONSTER_TAU * curl * sm / TARDI_LENGTH;
  vec2 arc = tardigradeArc( phi );
  p = TARDI_MID + TARDI_AXIS * ( sm * arc.x ) + TARDI_BELLY * ( sm * arc.y ) + monsterRotate( qp + TARDI_AXIS * qa, TARDI_LAT, phi );
  n = monsterRotate( n, TARDI_LAT, phi );
}
`;
  if (!baked) return common;
  return common + /* glsl */ `
varying float vMonsterGlow;
const vec3 TARDI_HIPS[ 8 ] = vec3[ 8 ]( ${rig.hips.map(glslVec).join(", ")} );
void tardigradeLeg( inout vec3 p, inout vec3 n, int leg, float t, float ph, float m ) {
  float swim = tardigradePose.y;
  vec3 hip = TARDI_HIPS[ leg ];
  float side = float( leg % 2 ) * 3.14159265;
  float pair = float( leg / 2 ) * 1.57079633;
  float amp = ( ${glslFloat(PADDLE_IDLE)} + ${glslFloat(PADDLE_SWIM)} * swim ) * m;
  float ang = amp * sin( t * ( 1.8 + 2.6 * swim ) + ph + side + pair ) * min( 1.0, monsterMotion.z * 3.0 );
  vec3 q = monsterRotate( p - hip, TARDI_LAT, ang );
  n = monsterRotate( n, TARDI_LAT, ang );
  p = hip + q * ( 1.0 - ${glslFloat(LEG_RETRACT)} * tardigradeState.y * m );
}
`;
}

function tardigradeDeform(baked: boolean): string {
  return /* glsl */ `
void tardigradeDeform( inout vec3 p, inout vec3 n ) {
  int part = monsterPart( monsterMotion.x );
  float m = uMotion;
  float t = uTime;
  float ph = tardigradePose.x * MONSTER_TAU;
  float a = monsterMotion.y;${baked ? `
  float y = monsterMotion.y;
  if ( part >= 1 && part <= 8 ) tardigradeLeg( p, n, part - 1, t, ph, m );
  else if ( part == 12 ) {
    a = 1.0;
    float stretch = ${glslFloat(DROOL_STRETCH)} * ( tardigradePose.z + 0.25 * ( 0.5 + 0.5 * sin( t * 1.1 + ph ) ) );
    p += ( TARDI_BELLY * y * stretch + TARDI_LAT * y * y * ${glslFloat(DROOL_SWAY)} * sin( t * 2.0 + ph + p.x * 6.0 ) ) * m;
  }
  else if ( part == 13 ) {
    a = monsterMotion.z;
    p += ( TARDI_BELLY * y * ${glslFloat(DRIP_STRETCH)} * ( 0.5 + 0.5 * sin( t * 0.9 + ph + p.z * 3.0 ) )
      + TARDI_LAT * y * y * ${glslFloat(DRIP_SWAY)} * sin( t * 2.2 + ph + p.z * 5.0 ) ) * m;
  }` : ""}
  tardigradeBody( p, n, a, part, t, ph, m );
}
`;
}

/**
 * Patches the tardigrade's two glTF materials in place (Task 5; R18
 * signature). `rig` is src/data/tardigradeRig.json; its numbers are compiled
 * into the programs, whose keys are fixed per material (one rig per model).
 */
export function createTardigradeMaterials(body: THREE.MeshStandardMaterial, fur: THREE.MeshStandardMaterial, rig: TardigradeRig): void {
  const sss = translucencyHeader(SKIN_SSS, SKIN_SSS_AMOUNT);

  body.vertexColors = false;
  body.onBeforeCompile = (shader) => {
    shareMonsterUniforms(shader);
    const main = monsterVertexMain("tardigradeDeform( monsterPos, objectNormal );",
      `vMonsterGlow = monsterMask.r * tardigradePose.z * tardigradePose.z * ${glslFloat(THROAT_GAIN)}
  + monsterMask.g * ${glslFloat(CRYSTAL_GLOW)} * ( 1.0 + ${glslFloat(CRYSTAL_PULSE)} * sin( uTime * 0.8 + tardigradePose.x * MONSTER_TAU ) );`);
    let vs = injectShader(shader.vertexShader, "#include <common>", MONSTER_VERTEX_COMMON + tardigradeVertexHeader(rig, true) + tardigradeDeform(true), "after");
    vs = injectShader(vs, "#include <beginnormal_vertex>", main.beginnormal, "after");
    shader.vertexShader = injectShader(vs, "#include <begin_vertex>", main.begin, "after");
    let fs = injectShader(shader.fragmentShader, "#include <common>", `varying float vMonsterGlow;${sss}`, "after");
    fs = injectShader(fs, "#include <emissivemap_fragment>", "totalEmissiveRadiance *= vMonsterGlow;", "after");
    fs = injectShader(fs, "#include <lights_physical_fragment>", TOKSVIG_FRAGMENT, "before");
    shader.fragmentShader = injectShader(fs, "#include <lights_fragment_begin>", TRANSLUCENCY_FRAGMENT, "after");
  };
  body.customProgramCacheKey = () => "tardigrade:v1";

  fur.vertexColors = false;
  fur.onBeforeCompile = (shader) => {
    shareMonsterUniforms(shader);
    const main = monsterVertexMain("tardigradeDeform( monsterPos, objectNormal );",
      "monsterFurShell( monsterPos, objectNormal, tardigradePose.x * MONSTER_TAU );");
    let vs = injectShader(shader.vertexShader, "#include <common>",
      MONSTER_VERTEX_COMMON + tardigradeVertexHeader(rig, false) + tardigradeDeform(false) + furVertexHeader(rig.furMaxLength), "after");
    vs = injectShader(vs, "#include <beginnormal_vertex>", main.beginnormal, "after");
    shader.vertexShader = injectShader(vs, "#include <begin_vertex>", main.begin, "after");
    shader.fragmentShader = patchFurFragment(shader.fragmentShader, rig.furAtlas.shells, sss);
  };
  fur.customProgramCacheKey = () => "tardigradeFur:v1";
}
