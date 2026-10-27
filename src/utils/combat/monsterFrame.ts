/**
 * Monster frames for the render: the instance matrix from a monster's
 * position, facing and scale, and the world-space muzzle and mouth the AI's
 * sink reads. Model +Z (the rest gaze, the barrel's rest aim, the
 * tardigrade's tail → mouth axis) turns to the facing; model +Y leans toward
 * world up. Allocation-free: module scratch only.
 */
import * as THREE from "three";
// The rig maths only (Ruling C16): the materials load with the Nest's renderer, on demand.
import { saucerMuzzle, type SaucerRig, type TardigradeRig } from "../monsters/monsterRig";
import type { Saucer } from "./saucerAi";
import type { Tardigrade } from "./tardigradeAi";
import type { V3 } from "./types";

const _m = new THREE.Matrix4();
const _aim = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Model +Z → the facing (fx, fy, fz), +Y toward world up (world +X stands in
 * as the side axis when the facing is vertical), scaled, at (x, y, z).
 */
export function monsterMatrix(
  x: number, y: number, z: number, fx: number, fy: number, fz: number, scale: number, out: THREE.Matrix4,
): THREE.Matrix4 {
  const zl = Math.hypot(fx, fy, fz);
  let zx = 0, zy = 0, zz = 1;
  if (zl > 0) { zx = fx / zl; zy = fy / zl; zz = fz / zl; }
  // Side axis: world up × facing.
  let xx = zz, xy = 0, xz = -zx;
  const xl = Math.hypot(xx, xz);
  if (xl < 1e-9) { xx = 1; xy = 0; xz = 0; } else { xx /= xl; xz /= xl; }
  // Up axis: facing × side.
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const k = scale;
  return out.set(
    xx * k, yx * k, zx * k, x,
    xy * k, yy * k, zy * k, y,
    xz * k, yz * k, zz * k, z,
    0, 0, 0, 1,
  );
}

/** A world direction in the frame's model space (the matrix's rotation undone; its scale ignored). */
export function worldDirToModel(m: THREE.Matrix4, dx: number, dy: number, dz: number, out: THREE.Vector3): THREE.Vector3 {
  const e = m.elements;
  const l0 = Math.hypot(e[0], e[1], e[2]) || 1;
  const l1 = Math.hypot(e[4], e[5], e[6]) || 1;
  const l2 = Math.hypot(e[8], e[9], e[10]) || 1;
  return out.set(
    (e[0] * dx + e[1] * dy + e[2] * dz) / l0,
    (e[4] * dx + e[5] * dy + e[6] * dz) / l1,
    (e[8] * dx + e[9] * dy + e[10] * dz) / l2,
  );
}

/** The saucer's cannon muzzle in world space: `saucerMuzzle` of its aim (in model space), through its frame. */
export function saucerMuzzleWorld(s: Saucer, rig: SaucerRig, out: V3): V3 {
  monsterMatrix(s.x, s.y, s.z, s.fx, s.fy, s.fz, s.scale, _m);
  worldDirToModel(_m, s.ax, s.ay, s.az, _aim);
  saucerMuzzle(_aim, rig, _p).applyMatrix4(_m);
  out.x = _p.x; out.y = _p.y; out.z = _p.z;
  return out;
}

/** The tardigrade's mouth (`rig.mouth`) in world space. */
export function tardigradeMouthWorld(t: Tardigrade, rig: TardigradeRig, out: V3): V3 {
  monsterMatrix(t.x, t.y, t.z, t.fx, t.fy, t.fz, t.scale, _m);
  _p.set(rig.mouth[0], rig.mouth[1], rig.mouth[2]).applyMatrix4(_m);
  out.x = _p.x; out.y = _p.y; out.z = _p.z;
  return out;
}
