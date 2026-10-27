import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useModel } from "../../../utils/sceneAssets";
import { assetUrl } from "../../../utils/assetUrl";
import { exposureCompensation } from "../../../utils/sunLight";
import { NEST_CENTRE } from "../../../data/nest";
import { NEST_GLOW, NEST_GLOW_R, NEST_ROCKS } from "../../../data/nestRocks";
import { NEAR_FADE_FAR, nearFade } from "../../../utils/combat/effects";
import type { V3 } from "../../../utils/combat/types";
import { BELT_ROCK_RADIUS, beltRockGeometry, beltRockMaterial } from "../beltRock";
import { softSprite } from "../softSprite";

/** The slime glow's colour and gain (Rulings: "The glow"). */
const GLOW_HEX = "#7dff6a";
const GLOW_GAIN = 0.6;
/** The glow's sprite size (u). */
const GLOW_SIZE = 6;
/**
 * A rock's drawn radius per unit of NestRock.scale (u): a little inside its
 * collider (2.2 × scale), as the scenery asteroids' radius ~2 is.
 */
const ROCK_R_PER_SCALE = 1.8;
/** Per-axis stretch by NestRock.variant, so one 80-triangle rock reads as four shapes (with the seeded rotation). */
const STRETCH: readonly (readonly [number, number, number])[] = [
  [1, 1, 1], [1.2, 0.8, 0.95], [0.9, 1.15, 0.8], [1.1, 0.85, 1.2],
];

/** Beyond this from the centre the camera is past every glow point's near fade, which then is 1 for all. */
const GLOW_FAR = NEST_GLOW_R + NEAR_FADE_FAR;

/**
 * The Nest's rock cluster and slime glow (spec 2026-10-27-nest-playable §2),
 * in the lazily loaded Nest chunk: NestMonsters mounts it beside
 * NestEffects, under NestGate's Nest group, so the warm-up walks it.
 *  - The rocks: the belt's 80-triangle rock in its material (beltRock.ts:
 *    the same geometry recipe and the same material object, so the belt's
 *    program; Ruling N4), one InstancedMesh, one call, under 2k triangles.
 *    Each rock varies by its seeded scale, rotation and a per-variant
 *    stretch. Static: the matrices are set once, with a fixed bounding
 *    sphere for culling.
 *  - The glow: one Points, the ship sparks' PointsMaterial settings (so
 *    their program), its vertex colours written each frame as slime green ×
 *    gain × exposureCompensation × nearFade, so it reads the same at any
 *    exposure and fades out near the camera. Far from the centre with the
 *    compensation unchanged, nothing is written.
 * The rocks' colliders (NEST_ROCK_COLLIDERS) are Spaceship's, near the Nest.
 * On unmount it disposes its geometries and the glow's material, not the
 * rocks' material (the model's, shared with the belt) or the maps.
 */
export default function NestCluster() {
  const { scene } = useModel(assetUrl("/models/asteroids.glb"));
  const rocks = useMemo(() => {
    const mesh = new THREE.InstancedMesh(beltRockGeometry(), beltRockMaterial(scene), NEST_ROCKS.length);
    const dummy = new THREE.Object3D();
    NEST_ROCKS.forEach((r, i) => {
      const k = (ROCK_R_PER_SCALE / BELT_ROCK_RADIUS) * r.scale;
      const st = STRETCH[r.variant];
      dummy.position.set(NEST_CENTRE[0] + r.offset[0], NEST_CENTRE[1] + r.offset[1], NEST_CENTRE[2] + r.offset[2]);
      dummy.rotation.set(r.rotation[0], r.rotation[1], r.rotation[2]);
      dummy.scale.set(k * st[0], k * st[1], k * st[2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = "NestRocks";
    return mesh;
  }, [scene]);

  const glow = useMemo(() => {
    const n = NEST_GLOW.length;
    const pos = new Float32Array(n * 3);
    NEST_GLOW.forEach((g, i) => {
      pos[i * 3] = NEST_CENTRE[0] + g[0]; pos[i * 3 + 1] = NEST_CENTRE[1] + g[1]; pos[i * 3 + 2] = NEST_CENTRE[2] + g[2];
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    // Fixed, with room for the sprites' half size, so they don't pop at the screen's edge.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(...NEST_CENTRE), NEST_GLOW_R + GLOW_SIZE / 2);
    const material = new THREE.PointsMaterial({
      vertexColors: true, size: GLOW_SIZE, map: softSprite, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    points.name = "NestGlow";
    return points;
  }, []);

  useEffect(() => () => {
    // Not the rocks' material: the model's own, shared with the belt.
    rocks.geometry.dispose();
    rocks.dispose();
    glow.geometry.dispose();
    (glow.material as THREE.Material).dispose();
  }, [rocks, glow]);

  // Per-frame scratch, and what was last written (NaN: nothing yet).
  const scratch = useMemo(() => ({
    base: new THREE.Color(GLOW_HEX).multiplyScalar(GLOW_GAIN), cam: { x: 0, y: 0, z: 0 } as V3, comp: NaN, far: false,
  }), []);

  useFrame((state) => {
    const comp = exposureCompensation.value;
    const c = state.camera.position;
    const S = scratch;
    const far = Math.hypot(c.x - NEST_CENTRE[0], c.y - NEST_CENTRE[1], c.z - NEST_CENTRE[2]) > GLOW_FAR;
    // Far off, every fade is 1: the colours depend only on the compensation.
    if (far && S.far && comp === S.comp) return;
    S.far = far; S.comp = comp;
    S.cam.x = c.x; S.cam.y = c.y; S.cam.z = c.z;
    const pa = glow.geometry.getAttribute("position") as THREE.BufferAttribute;
    const ca = glow.geometry.getAttribute("color") as THREE.BufferAttribute;
    const p = pa.array as Float32Array, col = ca.array as Float32Array;
    for (let i = 0; i < NEST_GLOW.length; i++) {
      const g = comp * (far ? 1 : nearFade(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], S.cam));
      col[i * 3] = S.base.r * g; col[i * 3 + 1] = S.base.g * g; col[i * 3 + 2] = S.base.b * g;
    }
    ca.needsUpdate = true;
  });

  return (
    <>
      <primitive object={rocks} />
      <primitive object={glow} />
    </>
  );
}
