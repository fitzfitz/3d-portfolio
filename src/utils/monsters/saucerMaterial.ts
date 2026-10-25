import * as THREE from "three";
import { TOKSVIG_FRAGMENT } from "../../components/canvas/toksvig";
import type { SaucerTint } from "./monsterTint";
import {
  MONSTER_VERTEX_COMMON, TRANSLUCENCY_FRAGMENT, furReach, furShellCount, furVertexHeader, glslFloat, glslVec, injectShader,
  monsterVertexMain, patchFurFragment, shareMonsterUniforms, translucencyHeader,
} from "./monsterShading";
import { claimSlot, clamp01, writeShell, writeSlot, wrap01 } from "./monsterInstances";

/**
 * The saucer alien's instanced materials and motion (space monsters, Task 5).
 * Contract: gen_saucer.py's CONTRACT header and src/data/saucerRig.json.
 * Three programs; four draw calls per LOD level in use (three on LOD1, which
 * has no lock cards):
 *  - SaucerBaked ("saucer:v1"): the hull, the alien, the slime. Every part
 *    moves by its _MOTION.x slot (0 hull, 1 body, 2 tentacle, 3 eye L, 4 eye
 *    R, 5 eye top, 6 jaw, 7 cannon, 8 goo, 9 rim drips, 10 tentacle drips, 11
 *    body drips); the zones of COLOR_0 take the per-instance tint; the
 *    porthole lenses (the only emissive) run the chase;
 *  - SaucerDome ("saucerDome:v1"): the glass, blended over the alien, no
 *    depth write, front faces only (six overlapping domes need no sort);
 *  - SaucerFur ("saucerFur:v1"): split at load (splitFurGeometry, R19)
 *    into the fur base, drawn once per shell, and the lock cards, drawn once
 *    per saucer; both InstancedMeshes share this material and program.
 * Reduced motion (uMotion 0, R20) stops the decorative motion (the tentacle
 * wave, breathing, sway, the idle chew and goo sag, the drips, the fur's
 * flow) and keeps every state pose, without oscillation: look, aim, the
 * fire lean and grin, the hit squash, blink, the defeat swirl (held still).
 * saucerDeformPoint is the vertex shader's TS mirror.
 * Not imported by the game yet (Task 6's lab drives it).
 */

type Vec3 = readonly number[];

export interface SaucerRig {
  pivots: { body: Vec3; jaw: Vec3; eyeL: Vec3; eyeR: Vec3; eyeTop: Vec3; cannon: Vec3; gooTop: Vec3; gooBottom: Vec3 };
  muzzle: Vec3;
  portholes: number;
  portholeOrder: string;
  eyeRadius: number;
  bodySpan: readonly number[];
  jawAxis: Vec3;
  furMaxLength: number;
  furAtlas: { shells: readonly number[]; locks: readonly number[]; lockVariants: number };
  furShells: number;
  lod1Distance: number;
}

/**
 * One saucer's pose, written per instance each frame.
 * `look` and `aim` are directions in the saucer's own (model) space, +Z the
 * rest gaze and the barrel's rest aim; they need not be unit length.
 * `chase` is -1 (off) or the chase's position round the portholes, 0 → 1
 * (it wraps); `phase` (0 → 1, wraps) desynchronises the idle motion; the
 * rest are 0 → 1 and clamp.
 * `blink` is a state pose like the others (R20): the shader applies it
 * whatever uMotion is, so the caller drives idle blinks only while motion is
 * on and passes 0 under reduced motion (a held blink would read as a wink).
 */
export interface SaucerPose {
  phase: number;
  look: THREE.Vector3;
  aim: THREE.Vector3;
  chase: number;
  fire: number;
  hit: number;
  defeat: number;
  blink: number;
}

/**
 * One LOD level's InstancedMeshes (each geometry from prepareMonsterGeometry):
 * `fur` the fur base (capacity saucers × rig.furShells), `cards` the lock
 * cards (capacity saucers; null on LOD1, which has none). Both use the fur's
 * layout and material.
 */
export interface SaucerLod {
  body: THREE.InstancedMesh; dome: THREE.InstancedMesh; fur: THREE.InstancedMesh; cards: THREE.InstancedMesh | null;
}

/**
 * The per-instance attributes of each primitive (name → item size):
 *  - saucerPose (phase, chase, fire, hit);
 *  - saucerLook (gaze yaw, gaze pitch, aim yaw, aim pitch; radians, clamped);
 *  - saucerMood (defeat, blink);
 *  - saucerSkin / saucerSpot / saucerBand (the tint, linear RGB);
 *  - monsterShell (shell index, shell count) on the fur (base and cards:
 *    a card is shell 0 of 1).
 * The body uses 15 of WebGL2's 16 vertex attributes (5 own + 4 for the
 * instance matrix + 6), so a further body attribute must pack into these.
 */
export const SAUCER_INSTANCE_ATTRIBUTES = {
  body: { saucerPose: 4, saucerLook: 4, saucerMood: 2, saucerSkin: 3, saucerSpot: 3, saucerBand: 3 },
  dome: {},
  fur: { saucerPose: 4, monsterShell: 2 },
} as const;

/** How far the eyes turn from +Z (rad): they never look behind the saucer. */
export const EYE_YAW_MAX = 0.9;
export const EYE_PITCH_MAX = 0.6;
/** The barrel's pitch range (rad, + up): down under the saucer, a little above the rim's plane. */
export const AIM_PITCH_MIN = -1.3;
export const AIM_PITCH_MAX = 0.3;

/** Porthole glow (× PORTHOLE_GAIN × the emissive map): all lit while the chase is off. */
export const PORTHOLE_IDLE = 0.45;
/** The two portholes behind the chase's head fade through these; the rest hold PORTHOLE_DIM. */
export const PORTHOLE_TRAIL = [0.5, 0.22] as const;
export const PORTHOLE_DIM = 0.08;
/** Emissive gain at full glow (Bloom picks it up). */
export const PORTHOLE_GAIN = 2.4;

// motion amounts (model units / radians)
const LEAN_FIRE = 0.16;       // the body leans into a shot
const SWAY = 0.035;           // idle lean and roll
const BREATH = 0.02;          // idle breathing (vertical scale)
const HIT_SQUASH = 0.22;      // a hit squashes the body this much at hit 1
const JAW_FIRE = 0.42;        // the grin opens this far (rad) at fire 1
const JAW_IDLE = 0.05;        // the jaw's idle chew
const WAVE = 0.1;             // tentacle tips' wave
const DRIP_SWAY = 0.025;      // a drip's tip sway
const DRIP_STRETCH = 0.03;    // a drip's slow stretch
const GOO_SAG = 0.035;        // the goo strings' idle sag (decorative); twice this more at fire 1 (pose)
const BLINK = 0.92;           // a blink flattens the eye this much
const SWIRL = 0.32;           // the defeated pupils' circle (rad)
const SWIRL_SPEED = 7.0;      // rad/s (held still under reduced motion)
const SWIRL_SPLIT = 1.2;      // the eyes' swirl phases differ, so held still they still look crossed
/** Warm wrap-lit share of the light through the thin skin (green skin × warm → yellow-green). */
const SKIN_SSS: readonly number[] = [1.0, 0.8, 0.4];
const SKIN_SSS_AMOUNT = 0.9;
/** The dome's edge opacity (glass reflects more at grazing angles). */
const DOME_RIM = 0.55;

/**
 * How far any saucer vertex can reach past its primitive's rest bounding
 * sphere (glTF units), for prepareMonsterGeometry: the fur's shell reach,
 * plus the body's lean, roll, squash and breath about its pivot at the
 * crown's distance from it (the farthest a leaning vertex sits), plus the
 * tentacle wave, the drips' sway and stretch and the goo's sag. A sum of
 * upper bounds, so it is conservative; tests/monsterGeometry.test.ts checks
 * it against every vertex of the shipped glb at the extreme poses. The
 * barrel turns about its pivot and stays inside the hull's sphere.
 */
export function saucerBoundsMargin(rig: SaucerRig): number {
  const crown = rig.bodySpan[1] - rig.pivots.body[1];
  // lean (fire + idle) and roll are about crossed axes; the squash spreads x and z
  const turn = Math.hypot(LEAN_FIRE + SWAY, SWAY) + HIT_SQUASH / 2 + BREATH;
  const wave = WAVE * Math.hypot(1, 0.5, 1);
  const drips = DRIP_SWAY * Math.SQRT2 + DRIP_STRETCH + 3 * GOO_SAG;
  return furReach(rig.furMaxLength) + crown * turn + wave + drips;
}

/** Body weight (base 0 → crown 1), linear in glTF y over rig.bodySpan (R13). */
export function saucerBodyWeight(y: number, rig: SaucerRig): number {
  return clamp01((y - rig.bodySpan[0]) / (rig.bodySpan[1] - rig.bodySpan[0]));
}

/**
 * The TS mirror of saucerDeform's host choice: how strongly a vertex follows
 * the tentacle wave and the body's lean and squash, from its _MOTION and
 * its rest height `y`. Drips follow their root's host (_MOTION.z, R12); the
 * jaw's y is its influence, so its body weight comes from its height.
 */
export function saucerHostWeights(motion: ArrayLike<number>, y: number, rig: SaucerRig, out: { wave: number; body: number }) {
  const part = Math.floor(motion[0] * 16);
  out.wave = 0;
  out.body = 0;
  if (part === 1 || part === 6 || part === 8) out.body = saucerBodyWeight(y, rig);
  else if (part === 2 || part === 10) {
    out.wave = part === 2 ? motion[1] : motion[2];
    out.body = saucerBodyWeight(y, rig) * (1 - out.wave);
  } else if (part === 11) out.body = motion[2];
  else if (part === 3) out.body = saucerBodyWeight(rig.pivots.eyeL[1], rig);
  else if (part === 4) out.body = saucerBodyWeight(rig.pivots.eyeR[1], rig);
  else if (part === 5) out.body = saucerBodyWeight(rig.pivots.eyeTop[1], rig);
  return out;
}

/**
 * The glow of the porthole whose ramp (_MOTION.z: (k + 0.5) / n, 0 off a
 * lens) is `ramp`, with the chase at `chase` (-1 off). The porthole nearest
 * the chase (ramps are counted from +Z toward +X, R8) glows full, the two
 * behind it fade. The TS mirror of saucerPortholeGlow.
 */
export function portholeGlow(ramp: number, chase: number, n: number): number {
  if (ramp <= 0) return 0;
  if (chase < 0) return PORTHOLE_IDLE;
  const k = Math.floor(ramp * n);
  const head = Math.floor(chase * n) % n;
  const d = (((head - k) % n) + n) % n;
  return d === 0 ? 1 : d === 1 ? PORTHOLE_TRAIL[0] : d === 2 ? PORTHOLE_TRAIL[1] : PORTHOLE_DIM;
}

/** Yaw (about +Y, from +Z toward +X) and pitch (+ up) of a direction; 0, 0 for a zero vector. */
function yawPitch(v: THREE.Vector3, out: { yaw: number; pitch: number }) {
  const len = Math.hypot(v.x, v.y, v.z);
  if (!(len > 1e-9)) { out.yaw = 0; out.pitch = 0; return out; }
  out.yaw = v.x === 0 && v.z === 0 ? 0 : Math.atan2(v.x, v.z) + 0;
  out.pitch = Math.asin(Math.max(-1, Math.min(1, v.y / len))) + 0;
  return out;
}
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const _look = { yaw: 0, pitch: 0 };
const _aim = { yaw: 0, pitch: 0 };

/** A pose as the shader sees it: clamped, wrapped, look and aim as clamped angles. */
interface SaucerPacked {
  phase: number; chase: number; fire: number; hit: number;
  lookYaw: number; lookPitch: number; aimYaw: number; aimPitch: number; defeat: number; blink: number;
}
const newPacked = (): SaucerPacked => ({ phase: 0, chase: -1, fire: 0, hit: 0, lookYaw: 0, lookPitch: 0, aimYaw: 0, aimPitch: 0, defeat: 0, blink: 0 });
const _packed = newPacked();
const _mirrorPacked = newPacked();

function packSaucerPose(pose: SaucerPose, out: SaucerPacked): SaucerPacked {
  out.phase = wrap01(pose.phase);
  out.chase = pose.chase < 0 ? -1 : wrap01(pose.chase);
  out.fire = clamp01(pose.fire);
  out.hit = clamp01(pose.hit);
  yawPitch(pose.look, _look);
  yawPitch(pose.aim, _aim);
  out.lookYaw = clamp(_look.yaw, -EYE_YAW_MAX, EYE_YAW_MAX);
  out.lookPitch = clamp(_look.pitch, -EYE_PITCH_MAX, EYE_PITCH_MAX);
  out.aimYaw = _aim.yaw;
  out.aimPitch = clamp(_aim.pitch, AIM_PITCH_MIN, AIM_PITCH_MAX);
  out.defeat = clamp01(pose.defeat);
  out.blink = clamp01(pose.blink);
  return out;
}

/**
 * Packs a saucer's pose and tint into slot `i` of `mesh`'s per-instance
 * attributes (whichever of them that primitive has: the dome has none).
 * Clamps and wraps out-of-range input; allocates nothing.
 */
export function writeSaucerInstance(mesh: THREE.InstancedMesh, i: number, pose: SaucerPose, tint: SaucerTint): void {
  const p = packSaucerPose(pose, _packed);
  writeSlot(mesh, "saucerPose", i, p.phase, p.chase, p.fire, p.hit);
  writeSlot(mesh, "saucerLook", i, p.lookYaw, p.lookPitch, p.aimYaw, p.aimPitch);
  writeSlot(mesh, "saucerMood", i, p.defeat, p.blink);
  writeSlot(mesh, "saucerSkin", i, tint.skin.r, tint.skin.g, tint.skin.b);
  writeSlot(mesh, "saucerSpot", i, tint.spot.r, tint.spot.g, tint.spot.b);
  writeSlot(mesh, "saucerBand", i, tint.band.r, tint.band.g, tint.band.b);
}

/**
 * Adds one saucer to this frame (between beginMonsterFrame and
 * endMonsterFrame): picks its LOD level at rig.lod1Distance, claims its body
 * and dome slots, one cards slot (shell 0 of 1) and one fur-base slot per
 * shell (furShellCount by distance), placing each at `matrix`. A full mesh
 * drops the saucer. Allocates nothing.
 */
export function addSaucer(lods: readonly SaucerLod[], rig: SaucerRig, matrix: THREE.Matrix4, distance: number,
  pose: SaucerPose, tint: SaucerTint): void {
  const lod = lods[distance >= rig.lod1Distance && lods.length > 1 ? 1 : 0];
  const i = claimSlot(lod.body, matrix);
  if (i < 0) return;
  writeSaucerInstance(lod.body, i, pose, tint);
  claimSlot(lod.dome, matrix);
  if (lod.cards) {
    const c = claimSlot(lod.cards, matrix);
    if (c >= 0) {
      writeSaucerInstance(lod.cards, c, pose, tint);
      writeShell(lod.cards, c, 0, 1);
    }
  }
  const n = furShellCount(distance, rig.furMaxLength, rig.furShells);
  for (let s = 0; s < n; s++) {
    const j = claimSlot(lod.fur, matrix);
    if (j < 0) return;
    writeSaucerInstance(lod.fur, j, pose, tint);
    writeShell(lod.fur, j, s, n);
  }
}

/**
 * Where a shot leaves the barrel for `aim` (model space, as the pose's): the
 * rig's muzzle turned about the cannon pivot as the shader turns the barrel.
 * Right under reduced motion too: aiming is a state pose (R20), so the
 * barrel still turns to `aim` when uMotion is 0.
 */
export function saucerMuzzle(aim: THREE.Vector3, rig: SaucerRig, out: THREE.Vector3): THREE.Vector3 {
  yawPitch(aim, _aim);
  const pitch = -clamp(_aim.pitch, AIM_PITCH_MIN, AIM_PITCH_MAX), yaw = _aim.yaw;
  const [px, py, pz] = rig.pivots.cannon;
  const qx = rig.muzzle[0] - px, y0 = rig.muzzle[1] - py, z0 = rig.muzzle[2] - pz;
  // monsterRotX, then monsterRotY
  const cx = Math.cos(pitch), sx = Math.sin(pitch);
  const qy = y0 * cx - z0 * sx, qz = y0 * sx + z0 * cx;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return out.set(px + qx * cy + qz * sy, py + qy, pz - qx * sy + qz * cy);
}

// ------------------------------------------------------ TS mirror ------

const TAU = 2 * Math.PI;
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Vector3(), _v = new THREE.Vector3(), _axis = new THREE.Vector3();
const _hw = { wave: 0, body: 0 };

function mirrorEye(p: THREE.Vector3, k: SaucerPacked, pivot: readonly number[], spin: number, eph: number, t: number, m: number) {
  const swirl = t * SWIRL_SPEED * spin * m + eph + spin * SWIRL_SPLIT;
  const yaw = k.lookYaw + k.defeat * SWIRL * Math.cos(swirl);
  const pitch = k.lookPitch + k.defeat * SWIRL * Math.sin(swirl);
  _q.set(p.x - pivot[0], p.y - pivot[1], p.z - pivot[2]).applyAxisAngle(AX, -pitch).applyAxisAngle(AY, yaw);
  _q.y *= 1 - BLINK * k.blink;
  p.set(pivot[0] + _q.x, pivot[1] + _q.y, pivot[2] + _q.z);
}

function mirrorJaw(v: THREE.Vector3, rig: SaucerRig, a: number) {
  _axis.set(rig.jawAxis[0], rig.jawAxis[1], rig.jawAxis[2]).normalize();
  const j = rig.pivots.jaw;
  return v.set(v.x - j[0], v.y - j[1], v.z - j[2]).applyAxisAngle(_axis, a).add(_v.set(j[0], j[1], j[2]));
}

/**
 * The TS mirror of saucerDeform (the baked primitive's vertex shader; the fur
 * runs the same code for its parts 1 and 2): where the rest vertex `rest`
 * with `_MOTION` `motion` goes for `pose` at time `t`, `m` = uMotion. Line
 * for line with the GLSL (the same constants), for tests and the combat
 * stage; normals are not mirrored.
 */
export function saucerDeformPoint(rig: SaucerRig, motion: ArrayLike<number>, rest: { x: number; y: number; z: number },
  pose: SaucerPose, t: number, m: number, out: THREE.Vector3): THREE.Vector3 {
  const k = packSaucerPose(pose, _mirrorPacked);
  const p = out.set(rest.x, rest.y, rest.z);
  const part = Math.floor(motion[0] * 16);
  const ph = k.phase * TAU;
  const pv = rig.pivots;
  saucerHostWeights(motion, rest.y, rig, _hw);
  const wave = _hw.wave, body = _hw.body;
  const jawAngle = JAW_FIRE * k.fire + JAW_IDLE * (0.5 + 0.5 * Math.sin(t * 1.7 + ph)) * m;
  if (part === 3) mirrorEye(p, k, pv.eyeL, 1, ph, t, m);
  else if (part === 4) mirrorEye(p, k, pv.eyeR, -1, ph, t, m);
  else if (part === 5) mirrorEye(p, k, pv.eyeTop, 1, ph + 2.1, t, m);
  else if (part === 7) {
    const c = pv.cannon;
    _q.set(p.x - c[0], p.y - c[1], p.z - c[2]).applyAxisAngle(AX, -k.aimPitch * motion[1]).applyAxisAngle(AY, k.aimYaw);
    p.set(c[0] + _q.x, c[1] + _q.y, c[2] + _q.z);
  }
  if (wave > 0) {
    const side = p.x * 2.3 + p.z * 1.7, a = wave * wave * WAVE * m;
    p.x += a * Math.sin(t * 1.9 + ph + side - wave * 2.6);
    p.y += a * 0.5 * Math.sin(t * 1.3 + ph * 1.7 + side + 1 - wave * 2);
    p.z += a * Math.cos(t * 1.6 + ph + side * 1.3 - wave * 2.6);
  }
  if (part >= 9) {
    const y = motion[1], s2 = y * y;
    const dx = Math.sin(t * 2.3 + ph + p.x * 7) * DRIP_SWAY * s2;
    const dy = -(0.5 + 0.5 * Math.sin(t * 0.9 + ph + p.z * 5)) * DRIP_STRETCH * y;
    const dz = Math.cos(t * 1.9 + ph + p.z * 7) * DRIP_SWAY * s2;
    p.x += dx * m; p.y += dy * m; p.z += dz * m;
  }
  if (part === 6) mirrorJaw(p, rig, jawAngle * motion[1]);
  if (part === 8) {
    const g = motion[1];
    const jx = p.x, jy = p.y, jz = p.z;
    mirrorJaw(p, rig, jawAngle);
    p.set(jx + (p.x - jx) * g, jy + (p.y - jy) * g, jz + (p.z - jz) * g);
    p.y -= 4 * g * (1 - g) * GOO_SAG * ((0.5 + 0.5 * Math.sin(t * 1.2 + ph)) * m + 2 * k.fire);
  }
  if (body > 0) {
    const b = pv.body;
    const breathe = BREATH * Math.sin(t * 1.6 + ph) * m;
    const sx = 1 + (HIT_SQUASH / 2) * k.hit, sy = 1 + breathe - HIT_SQUASH * k.hit;
    _q.set(p.x - b[0], p.y - b[1], p.z - b[2]);
    _q.x *= 1 + (sx - 1) * body; _q.y *= 1 + (sy - 1) * body; _q.z *= 1 + (sx - 1) * body;
    const lean = (LEAN_FIRE * k.fire + SWAY * Math.sin(t * 0.9 + ph) * m) * body;
    const roll = SWAY * Math.sin(t * 0.7 + ph * 1.3 + 1) * m * body;
    _q.applyAxisAngle(AX, lean).applyAxisAngle(AZ, roll);
    p.set(b[0] + _q.x, b[1] + _q.y, b[2] + _q.z);
  }
  return p;
}

/** Fire's lean (rad) at body weight 1, and the grin's jaw angle (rad) at fire 1: for tests and the combat stage. */
export const SAUCER_FIRE_LEAN = LEAN_FIRE;
export const SAUCER_FIRE_JAW = JAW_FIRE;
export const SAUCER_HIT_SQUASH = HIT_SQUASH;

// ----------------------------------------------------------- shaders -----

function saucerVertexHeader(rig: SaucerRig, face: boolean): string {
  const p = rig.pivots;
  const axis = new THREE.Vector3(...(rig.jawAxis as [number, number, number])).normalize().toArray();
  const common = /* glsl */ `
attribute vec4 saucerPose;
const vec3 SAUCER_BODY_PIVOT = ${glslVec(p.body)};
const vec2 SAUCER_BODY_SPAN = ${glslVec(rig.bodySpan)};
float saucerBodyWeight( float y ) {
  return clamp( ( y - SAUCER_BODY_SPAN.x ) / ( SAUCER_BODY_SPAN.y - SAUCER_BODY_SPAN.x ), 0.0, 1.0 );
}
vec3 saucerWave( float w, vec3 p, float t, float ph ) {
  float side = p.x * 2.3 + p.z * 1.7;
  float a = w * w * ${glslFloat(WAVE)};
  return a * vec3( sin( t * 1.9 + ph + side - w * 2.6 ), 0.5 * sin( t * 1.3 + ph * 1.7 + side + 1.0 - w * 2.0 ), cos( t * 1.6 + ph + side * 1.3 - w * 2.6 ) );
}
void saucerBody( inout vec3 p, inout vec3 n, float bw, float t, float ph, float m ) {
  float fire = saucerPose.z, hit = saucerPose.w;
  vec3 q = p - SAUCER_BODY_PIVOT;
  float breathe = ${glslFloat(BREATH)} * sin( t * 1.6 + ph ) * m;
  vec3 s = vec3( 1.0 + ${glslFloat(HIT_SQUASH / 2)} * hit, 1.0 + breathe - ${glslFloat(HIT_SQUASH)} * hit, 1.0 + ${glslFloat(HIT_SQUASH / 2)} * hit );
  s = mix( vec3( 1.0 ), s, bw );
  q *= s;
  n /= s;
  float lean = ( ${glslFloat(LEAN_FIRE)} * fire + ${glslFloat(SWAY)} * sin( t * 0.9 + ph ) * m ) * bw;
  float roll = ${glslFloat(SWAY)} * sin( t * 0.7 + ph * 1.3 + 1.0 ) * m * bw;
  q = monsterRotZ( monsterRotX( q, lean ), roll );
  n = monsterRotZ( monsterRotX( n, lean ), roll );
  p = SAUCER_BODY_PIVOT + q;
}
`;
  if (!face) return common;
  return common + /* glsl */ `
attribute vec4 saucerLook;
attribute vec2 saucerMood;
attribute vec3 saucerSkin;
attribute vec3 saucerSpot;
attribute vec3 saucerBand;
varying vec3 vMonsterTint;
varying float vMonsterGlow;
const vec3 SAUCER_JAW_PIVOT = ${glslVec(p.jaw)};
const vec3 SAUCER_JAW_AXIS = ${glslVec(axis)};
const vec3 SAUCER_EYE_L = ${glslVec(p.eyeL)};
const vec3 SAUCER_EYE_R = ${glslVec(p.eyeR)};
const vec3 SAUCER_EYE_TOP = ${glslVec(p.eyeTop)};
const vec3 SAUCER_CANNON_PIVOT = ${glslVec(p.cannon)};
const float SAUCER_PORTHOLES = ${glslFloat(rig.portholes)};
vec3 saucerDripSway( float y, vec3 p, float t, float ph ) {
  float s = y * y;
  return vec3( sin( t * 2.3 + ph + p.x * 7.0 ) * ${glslFloat(DRIP_SWAY)} * s,
    - ( 0.5 + 0.5 * sin( t * 0.9 + ph + p.z * 5.0 ) ) * ${glslFloat(DRIP_STRETCH)} * y,
    cos( t * 1.9 + ph + p.z * 7.0 ) * ${glslFloat(DRIP_SWAY)} * s );
}
void saucerEye( inout vec3 p, inout vec3 n, vec3 pivot, float spin, float t, float ph, float m ) {
  float defeat = saucerMood.x, blink = saucerMood.y;
  float swirl = t * ${glslFloat(SWIRL_SPEED)} * spin * m + ph + spin * ${glslFloat(SWIRL_SPLIT)};
  float yaw = saucerLook.x + defeat * ${glslFloat(SWIRL)} * cos( swirl );
  float pitch = saucerLook.y + defeat * ${glslFloat(SWIRL)} * sin( swirl );
  vec3 q = monsterRotY( monsterRotX( p - pivot, - pitch ), yaw );
  n = monsterRotY( monsterRotX( n, - pitch ), yaw );
  float squash = 1.0 - ${glslFloat(BLINK)} * blink;
  q.y *= squash;
  n.y /= max( squash, 0.05 );
  p = pivot + q;
}
float saucerJawAngle( float t, float ph, float m ) {
  return ${glslFloat(JAW_FIRE)} * saucerPose.z + ${glslFloat(JAW_IDLE)} * ( 0.5 + 0.5 * sin( t * 1.7 + ph ) ) * m;
}
vec3 saucerJaw( vec3 v, float a ) {
  return SAUCER_JAW_PIVOT + monsterRotate( v - SAUCER_JAW_PIVOT, SAUCER_JAW_AXIS, a );
}
void saucerCannon( inout vec3 p, inout vec3 n, float barrel ) {
  float pitch = - saucerLook.w * barrel;
  float yaw = saucerLook.z;
  vec3 q = monsterRotY( monsterRotX( p - SAUCER_CANNON_PIVOT, pitch ), yaw );
  n = monsterRotY( monsterRotX( n, pitch ), yaw );
  p = SAUCER_CANNON_PIVOT + q;
}
float saucerPortholeGlow( float ramp, float chase ) {
  if ( ramp <= 0.0 ) return 0.0;
  if ( chase < 0.0 ) return ${glslFloat(PORTHOLE_IDLE)};
  float k = floor( ramp * SAUCER_PORTHOLES );
  float head = mod( floor( chase * SAUCER_PORTHOLES ), SAUCER_PORTHOLES );
  float d = mod( head - k + SAUCER_PORTHOLES, SAUCER_PORTHOLES );
  return d < 0.5 ? 1.0 : d < 1.5 ? ${glslFloat(PORTHOLE_TRAIL[0])} : d < 2.5 ? ${glslFloat(PORTHOLE_TRAIL[1])} : ${glslFloat(PORTHOLE_DIM)};
}
`;
}

/** saucerDeform: the whole saucer's vertex motion (the face's parts only on the baked primitive). */
function saucerDeform(face: boolean): string {
  return /* glsl */ `
void saucerDeform( inout vec3 p, inout vec3 n ) {
  int part = monsterPart( monsterMotion.x );
  float m = uMotion;
  float t = uTime;
  float ph = saucerPose.x * MONSTER_TAU;
  float y0 = p.y;
  float wave = 0.0, body = 0.0;
  if ( part == 1 || part == 6 || part == 8 ) body = saucerBodyWeight( y0 );
  else if ( part == 2 || part == 10 ) {
    wave = part == 2 ? monsterMotion.y : monsterMotion.z;
    body = saucerBodyWeight( y0 ) * ( 1.0 - wave );
  }
  else if ( part == 11 ) body = monsterMotion.z;${face ? `
  else if ( part == 3 ) { body = saucerBodyWeight( SAUCER_EYE_L.y ); saucerEye( p, n, SAUCER_EYE_L, 1.0, t, ph, m ); }
  else if ( part == 4 ) { body = saucerBodyWeight( SAUCER_EYE_R.y ); saucerEye( p, n, SAUCER_EYE_R, - 1.0, t, ph, m ); }
  else if ( part == 5 ) { body = saucerBodyWeight( SAUCER_EYE_TOP.y ); saucerEye( p, n, SAUCER_EYE_TOP, 1.0, t, ph + 2.1, m ); }
  else if ( part == 7 ) saucerCannon( p, n, monsterMotion.y );` : ""}
  if ( wave > 0.0 ) p += saucerWave( wave, p, t, ph ) * m;${face ? `
  if ( part >= 9 ) p += saucerDripSway( monsterMotion.y, p, t, ph ) * m;
  if ( part == 6 ) {
    float a = saucerJawAngle( t, ph, m ) * monsterMotion.y;
    p = saucerJaw( p, a );
    n = monsterRotate( n, SAUCER_JAW_AXIS, a );
  }
  if ( part == 8 ) {
    float g = monsterMotion.y;
    p = mix( p, saucerJaw( p, saucerJawAngle( t, ph, m ) ), g );
    p.y -= 4.0 * g * ( 1.0 - g ) * ${glslFloat(GOO_SAG)} * ( ( 0.5 + 0.5 * sin( t * 1.2 + ph ) ) * m + 2.0 * saucerPose.z );
  }` : ""}
  if ( body > 0.0 ) saucerBody( p, n, body, t, ph, m );
}
`;
}

/**
 * Patches the saucer's three glTF materials in place (Task 5; R18
 * signature). `rig` is src/data/saucerRig.json; its numbers are compiled
 * into the programs, whose keys are fixed per material (one rig per model).
 */
export function createSaucerMaterials(body: THREE.MeshStandardMaterial, dome: THREE.MeshStandardMaterial,
  fur: THREE.MeshStandardMaterial, rig: SaucerRig): void {
  const sss = translucencyHeader(SKIN_SSS, SKIN_SSS_AMOUNT);

  body.vertexColors = false;
  body.onBeforeCompile = (shader) => {
    shareMonsterUniforms(shader);
    const main = monsterVertexMain("saucerDeform( monsterPos, objectNormal );", `vMonsterTint = mix( vec3( 1.0 ), saucerSkin, monsterMask.r ) * mix( vec3( 1.0 ), saucerSpot, monsterMask.g ) * mix( vec3( 1.0 ), saucerBand, monsterMask.b );
vMonsterGlow = monsterPart( monsterMotion.x ) == 0 ? saucerPortholeGlow( monsterMotion.z, saucerPose.y ) : 0.0;`);
    let vs = injectShader(shader.vertexShader, "#include <common>", MONSTER_VERTEX_COMMON + saucerVertexHeader(rig, true) + saucerDeform(true), "after");
    vs = injectShader(vs, "#include <beginnormal_vertex>", main.beginnormal, "after");
    shader.vertexShader = injectShader(vs, "#include <begin_vertex>", main.begin, "after");
    let fs = injectShader(shader.fragmentShader, "#include <common>", `varying vec3 vMonsterTint;
varying float vMonsterGlow;
uniform float uExposureComp;${sss}`, "after");
    fs = injectShader(fs, "#include <color_fragment>", "diffuseColor.rgb *= vMonsterTint;", "after");
    fs = injectShader(fs, "#include <emissivemap_fragment>", `totalEmissiveRadiance *= vMonsterGlow * ${glslFloat(PORTHOLE_GAIN)} * uExposureComp;`, "after");
    fs = injectShader(fs, "#include <lights_physical_fragment>", TOKSVIG_FRAGMENT, "before");
    shader.fragmentShader = injectShader(fs, "#include <lights_fragment_begin>", TRANSLUCENCY_FRAGMENT, "after");
  };
  body.customProgramCacheKey = () => "saucer:v1";

  dome.transparent = true;
  dome.depthWrite = false;
  dome.side = THREE.FrontSide;
  dome.vertexColors = false;
  dome.onBeforeCompile = (shader) => {
    shareMonsterUniforms(shader); // the dome draws no emissive, but all five materials share the same uniform objects
    const fs = injectShader(shader.fragmentShader, "#include <common>", `const float SAUCER_DOME_RIM = ${glslFloat(DOME_RIM)};`, "after");
    shader.fragmentShader = injectShader(fs, "#include <opaque_fragment>", `{
  float monsterFacing = abs( dot( normalize( normal ), normalize( vViewPosition ) ) );
  diffuseColor.a = mix( diffuseColor.a, 1.0, SAUCER_DOME_RIM * pow( 1.0 - monsterFacing, 3.0 ) );
}`, "before");
  };
  dome.customProgramCacheKey = () => "saucerDome:v1";

  fur.vertexColors = false;
  fur.onBeforeCompile = (shader) => {
    shareMonsterUniforms(shader);
    const main = monsterVertexMain("saucerDeform( monsterPos, objectNormal );",
      "monsterFurShell( monsterPos, objectNormal, saucerPose.x * MONSTER_TAU );");
    let vs = injectShader(shader.vertexShader, "#include <common>",
      MONSTER_VERTEX_COMMON + saucerVertexHeader(rig, false) + saucerDeform(false) + furVertexHeader(rig.furMaxLength), "after");
    vs = injectShader(vs, "#include <beginnormal_vertex>", main.beginnormal, "after");
    shader.vertexShader = injectShader(vs, "#include <begin_vertex>", main.begin, "after");
    shader.fragmentShader = patchFurFragment(shader.fragmentShader, rig.furAtlas.shells, sss);
  };
  fur.customProgramCacheKey = () => "saucerFur:v1";
}
