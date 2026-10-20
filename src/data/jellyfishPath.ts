import * as THREE from "three";

export const JELLY_LOOP_SECONDS = 400;
/** Numerically computed closest-approach phase (3D distance — see plan Task 11 step 4b). */
export const JELLY_NEAR_T = 0.1713;

export const JELLY_PATH = new THREE.CatmullRomCurve3(
  [
    // Routed above the plane and inside r 250 to clear every real swept orbit, well and moon system
    // (tests/solarClearance.test.ts); Jupiter's well reaches in to r ~300 and the inner tubes fill the plane.
    new THREE.Vector3(236, 122, 30),
    new THREE.Vector3(30, 60, 55),
    new THREE.Vector3(-226, 111, 83),
    new THREE.Vector3(-106, 145, -271),
    new THREE.Vector3(140, 79, -140),
  ],
  true,
  "catmullrom",
  0.6
);
