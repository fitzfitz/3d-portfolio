import * as THREE from "three";

export const JELLY_LOOP_SECONDS = 400;
/** Numerically computed closest-approach phase (3D distance — see plan Task 11 step 4b). */
export const JELLY_NEAR_T = 0.1776;

export const JELLY_PATH = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(300, 120, 0),
    new THREE.Vector3(30, 30, 55),
    new THREE.Vector3(-320, -60, 120),
    new THREE.Vector3(-120, 90, -300),
    new THREE.Vector3(120, -20, -140),
  ],
  true,
  "catmullrom",
  0.6
);
