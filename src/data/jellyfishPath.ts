import * as THREE from "three";

/** One lap of the loop; at ~1,180 u that is a ~3 u/s drift. */
export const JELLY_LOOP_SECONDS = 400;
/** Numerically computed closest approach to the play-area center (3D, tests/jellyfishPath.test.ts). */
export const JELLY_NEAR_T = 0.1957;

/**
 * The jellyfish's loop: a slow, even ring around the inner system, above the
 * plane (y 60–139, r 77–260), that dips once toward the sun beside the spawn
 * pad. Each lap it overtakes a pilot waiting at the pad on the right, ~28 u
 * off (52 s after load), passes nearest the sun ahead of the pad (78 s,
 * JELLY_NEAR_T), then drifts out ahead and around. Above the
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

/** Coarse scan for nearestLoopT: one point per ~4.6 u of loop, built on first use. */
const SCAN_N = 256;
let scan: Float32Array | null = null;
const probe = new THREE.Vector3();

function dist2At(t: number, p: { x: number; y: number; z: number }): number {
  JELLY_PATH.getPointAt(((t % 1) + 1) % 1, probe);
  return (probe.x - p.x) ** 2 + (probe.y - p.y) ** 2 + (probe.z - p.z) ** 2;
}

/**
 * The loop phase (0..1, arc length, as getPointAt reads it) nearest to `p`:
 * where the creature rejoins its loop when the guide hands it back (spec
 * 2026-10-23-jellyfish-guide; plan Task 5: "resumes the loop from the nearest
 * loop phase"). A coarse scan, then a golden-section search inside the best
 * sample's neighbours. Called once per hand-back, never per frame.
 */
export function nearestLoopT(p: { x: number; y: number; z: number }): number {
  if (!scan) {
    scan = new Float32Array(SCAN_N * 3);
    for (let i = 0; i < SCAN_N; i++) {
      JELLY_PATH.getPointAt(i / SCAN_N, probe);
      scan[3 * i] = probe.x; scan[3 * i + 1] = probe.y; scan[3 * i + 2] = probe.z;
    }
  }
  let best = 0, bestD = Infinity;
  for (let i = 0; i < SCAN_N; i++) {
    const d = (scan[3 * i] - p.x) ** 2 + (scan[3 * i + 1] - p.y) ** 2 + (scan[3 * i + 2] - p.z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  // The distance along the loop is unimodal within one sample either side of
  // the best sample (the loop never turns tighter than 30 u; one sample is ~4.6 u).
  const G = (Math.sqrt(5) - 1) / 2;
  let a = (best - 1) / SCAN_N, b = (best + 1) / SCAN_N;
  let c = b - G * (b - a), d = a + G * (b - a);
  let fc = dist2At(c, p), fd = dist2At(d, p);
  for (let i = 0; i < 40; i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - G * (b - a); fc = dist2At(c, p); }
    else { a = c; c = d; fc = fd; d = a + G * (b - a); fd = dist2At(d, p); }
  }
  const t = (a + b) / 2;
  return ((t % 1) + 1) % 1;
}
