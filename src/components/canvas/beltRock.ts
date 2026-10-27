import * as THREE from "three";
import { lowPolyRock } from "../../utils/lowPolyRock";

/**
 * The belt's rock (AsteroidBelt.tsx), which the Nest's rock cluster
 * (nest/NestCluster.tsx) draws too, so both share one program.
 */

/**
 * The geometry is a fixed radius, not measured from the hero mesh. The hero rocks
 * are authored at radius ~2 to match their colliders, and the belt's
 * per-instance scales (0.05-0.22) were tuned against a ~1.1u rock.
 */
export const BELT_ROCK_RADIUS = 1.1;
const BELT_ROCK_SEED = 42;

/**
 * A size-matched stand-in, not the hero mesh. Asteroid1 is 1,244 triangles, and
 * drawing it 560 times at scale 0.05-0.22 was ~85% of the whole scene's
 * triangles, for detail nobody can see. This is an 80-triangle icosahedron
 * (lowPolyRock). The caller owns and disposes it.
 */
export function beltRockGeometry(): THREE.BufferGeometry {
  return lowPolyRock(BELT_ROCK_RADIUS, BELT_ROCK_SEED);
}

/**
 * The hero Asteroid1's own material from asteroids.glb: the model's object,
 * shared and not cloned, so the caller must not dispose it.
 */
export function beltRockMaterial(scene: THREE.Object3D): THREE.Material {
  let src: THREE.Mesh | undefined;
  scene.traverse((c) => {
    if (!src && c instanceof THREE.Mesh && c.name.startsWith("Asteroid1")) src = c;
  });
  if (!src) throw new Error("asteroids.glb is missing mesh Asteroid1");
  return src.material as THREE.Material;
}
