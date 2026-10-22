import * as THREE from "three";

/** One lap of the loop; at ~1,180 u that is a ~3 u/s drift. */
export const JELLY_LOOP_SECONDS = 400;
/** Numerically computed closest approach to the play-area center (3D, tests/jellyfishPath.test.ts). */
export const JELLY_NEAR_T = 0.1957;

/**
 * The jellyfish's loop: a slow, even ring around the inner system, above the
 * plane (y 60–139, r 77–260), that dips once toward the sun beside the spawn
 * pad. Each lap it overtakes a pilot waiting at the pad on the right, ~28 u
 * off (52 s after load), passes nearest the sun ahead of the pad (78 s, the
 * J summon's spot), then drifts out ahead and around. Above the
 * plane because every near-plane spot inside ~2 AU is a swept well and the
 * belt's tilted orbits reach y ~100 by r 250: the ring clears every real swept
 * orbit, well and moon system by 8+ u (tests/solarClearance.test.ts), and the
 * career trail and the landmarks pilots fly to by 20–35 u
 * (tests/jellyfishPath.test.ts). Centripetal, so no corner cusps.
 */
export const JELLY_PATH = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(-175, 88, 46),
    new THREE.Vector3(-101, 88, 95),
    new THREE.Vector3(-36, 76, 89),
    new THREE.Vector3(13, 61, 46),
    new THREE.Vector3(67, 66, 36),
    new THREE.Vector3(157, 110, 39),
    new THREE.Vector3(216, 139, -39),
    new THREE.Vector3(148, 117, -170),
    new THREE.Vector3(39, 110, -220),
    new THREE.Vector3(-76, 126, -192),
    new THREE.Vector3(-161, 127, -123),
    new THREE.Vector3(-201, 104, -41),
  ],
  true,
  "centripetal"
);
