import type * as THREE from "three";

/**
 * The monsters' rig and pose types and the saucer's muzzle maths, split out
 * of the material modules (Ruling C16) so the game's always-loaded combat
 * code (utils/combat/monsterFrame.ts, NestDirector) reaches only this small
 * module. The materials, the shading and the instancing (saucerMaterial.ts,
 * tardigradeMaterial.ts, monsterShading.ts, monsterInstances.ts) load with
 * the Nest's renderer, on demand (components/canvas/nest/NestGate.tsx).
 * The material modules re-export everything here.
 */

type Vec3 = readonly number[];

/** The saucer's rig (src/data/saucerRig.json; gen_saucer.py's CONTRACT). */
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

/** The tardigrade's rig (src/data/tardigradeRig.json; gen_tardigrade.py's CONTRACT). */
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

/** The barrel's pitch range (rad, + up): down under the saucer, a little above the rim's plane. */
export const AIM_PITCH_MIN = -1.3;
export const AIM_PITCH_MAX = 0.3;

/** Yaw (about +Y, from +Z toward +X) and pitch (+ up) of a direction; 0, 0 for a zero vector. */
export function yawPitch(v: { x: number; y: number; z: number }, out: { yaw: number; pitch: number }) {
  const len = Math.hypot(v.x, v.y, v.z);
  if (!(len > 1e-9)) { out.yaw = 0; out.pitch = 0; return out; }
  out.yaw = v.x === 0 && v.z === 0 ? 0 : Math.atan2(v.x, v.z) + 0;
  out.pitch = Math.asin(Math.max(-1, Math.min(1, v.y / len))) + 0;
  return out;
}

export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

const _aim = { yaw: 0, pitch: 0 };

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
