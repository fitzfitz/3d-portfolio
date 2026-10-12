import * as THREE from "three";

export const JELLY_LOOP_SECONDS = 400;
/** Numerically computed closest-approach phase (3D distance — see plan Task 11 step 4b). */
export const JELLY_NEAR_T = 0.1775;

export const JELLY_PATH = new THREE.CatmullRomCurve3(
  [
    // Routed to clear every planet's swept orbit (tests/planetClearance.test.ts).
    new THREE.Vector3(320, -40, 40),
    new THREE.Vector3(30, 30, 55),
    new THREE.Vector3(-320, -60, 120),
    new THREE.Vector3(-120, 90, -300),
    new THREE.Vector3(160, -80, -160),
  ],
  true,
  "catmullrom",
  0.6
);
