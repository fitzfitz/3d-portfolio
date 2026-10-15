import * as THREE from "three";
import type { Arc } from "../data/careerTrail";

/**
 * Where to put a RingGeometry so its arc (local XY plane, angle 0 on +X
 * turning toward +Y) lies on `arc`: local +X → u, +Y → v, +Z → n, origin at
 * the centre. u, v, n are orthonormal and right-handed (careerTrail.ts), so
 * the basis is a pure rotation.
 */
export function arcPlacement(arc: Arc): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...arc.u), new THREE.Vector3(...arc.v), new THREE.Vector3(...arc.n),
  );
  return {
    position: new THREE.Vector3(...arc.centre),
    quaternion: new THREE.Quaternion().setFromRotationMatrix(basis),
  };
}
