import * as THREE from "three";
import type { WorldData } from "../data/worlds";

const DEG = Math.PI / 180;
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
/** Scratch: frame loops call this every frame, so it allocates nothing. */
const tilt = new THREE.Quaternion();
const spin = new THREE.Quaternion();
const node = new THREE.Quaternion();

/**
 * A world's orientation at time `t`, written into `out` (docs/UNIVERSE-RULES.md
 * L9). The mesh's own +Y is its spin axis:
 *
 * - the orbit's frame, as `orbitPosition` builds it (the flat circle tipped
 *   about X by the inclination, then turned about Y by the node);
 * - in it, the axis leans `axialTiltDeg` from the orbit normal, about the
 *   frame's X, and stays there: the axis is fixed in space, as a gyroscope's is;
 * - the world turns about that axis at `spin` (a rotation.y rate, signed by
 *   PROGRADE). Past 90° of tilt the same sign turns it backwards against its
 *   orbit, which is the tilted ice giant's case, as Uranus's.
 */
export function worldSpinQuaternion(w: WorldData, t: number, out: THREE.Quaternion): THREE.Quaternion {
  node.setFromAxisAngle(Y, w.orbit.node);
  out.setFromAxisAngle(X, w.orbit.inclination).premultiply(node);
  tilt.setFromAxisAngle(X, w.axialTiltDeg * DEG);
  spin.setFromAxisAngle(Y, w.spin * t);
  return out.multiply(tilt).multiply(spin);
}

/**
 * The mesh's scale in its own (spin-axis) frame: a flattened world is
 * squashed along its axis. The ringed giant's 0.10 gives [1, 0.9, 1].
 */
export function worldMeshScale(w: WorldData): [number, number, number] {
  return [1, 1 - w.flattening, 1];
}
