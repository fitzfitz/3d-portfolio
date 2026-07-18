import * as THREE from "three";

export const JELLY_LOOP_SECONDS = 400;
/** Numerically computed closest-approach phase (~75 units from center). */
export const JELLY_NEAR_T = 0.177;

export const JELLY_PATH = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(300, 40, 0),
    new THREE.Vector3(30, 18, 70),
    new THREE.Vector3(-320, 10, 120),
    new THREE.Vector3(-120, 55, -300),
    new THREE.Vector3(120, 20, -140),
  ],
  true,
  "catmullrom",
  0.6
);
