import * as THREE from "three";

/**
 * Detail by distance for the planets, the worlds and their overlay shells
 * (atmosphere, limb darkening, clouds): one three.js LOD per body, built on
 * the unit spheres below, shared by every body and scaled to its radius. All
 * of a body's levels draw with its one material, so the levels add no shader
 * program: geometry is not part of a program's key.
 */

/** Segments (width and height) per level, nearest first. 64 is the old fixed tessellation. */
export const LOD_SEGMENTS = [64, 24, 12] as const;

/** One unit sphere per level, shared by every LOD. Never dispose them. */
export const UNIT_SPHERES: readonly THREE.SphereGeometry[] = LOD_SEGMENTS.map((n) => new THREE.SphereGeometry(1, n, n));

/**
 * The reference view the distances are measured for: the resting chase FOV
 * (58°, Spaceship.tsx; speed and warp only widen it, which makes a body
 * smaller on screen) on an 802 px tall viewport (the 1512×802 window
 * docs/PERF-BUDGETS.md measures real-browser numbers on). A taller window
 * shows the facets at proportionally larger distances.
 */
const VIEW_HEIGHT_PX = 802;
const VIEW_FOV_DEG = 58;
/** Pixels per unit of tangent at the screen centre: (H / 2) / tan(fov / 2). */
export const FOCAL_PX = VIEW_HEIGHT_PX / 2 / Math.tan((VIEW_FOV_DEG * Math.PI) / 360);

/**
 * How far a level's silhouette may sag inside the true limb, in pixels. A
 * sphere of n segments shows an n-sided polygon at worst (seen down its
 * axis), and each edge sags R(1 − cos(π/n)) below a circle of R pixels.
 */
const SILHOUETTE_ERROR_PX = 0.5;

/**
 * The distance at which a sphere of `radius` projects to `px` pixels (radius,
 * seen centred): f·r / √(d² − r²) = px, so d = r·√(1 + (f/px)²). Linear in r.
 */
const distanceForPx = (radius: number, px: number) => radius * Math.sqrt(1 + (FOCAL_PX / px) ** 2);

/** Per unit of size: where each level's polygon sags SILHOUETTE_ERROR_PX. Level 0 from 0. */
const LEVEL_DISTANCE_PER_SIZE = LOD_SEGMENTS.map((n, i) =>
  i === 0 ? 0 : distanceForPx(1, SILHOUETTE_ERROR_PX / (1 - Math.cos(Math.PI / n))));

/**
 * The camera distances (to the body's centre) at which a body of `size`
 * switches to each level: 0, then where the 24- and the 12-segment silhouette
 * is within half a pixel of the true limb. About 12.4 and 49 sizes.
 */
export function lodDistances(size: number): number[] {
  return LEVEL_DISTANCE_PER_SIZE.map((k) => k * size);
}

/**
 * Past this distance an overlay shell whose on-screen extent is `extent`
 * units (measured from the body's centre or from its limb, whichever the
 * shell covers) projects under one pixel, so it is culled: the atmosphere's
 * band beyond the limb is (thickness − 1) × radius; limb darkening and clouds
 * cover the disc, so theirs is their whole radius.
 */
export function shellCullDistance(extent: number): number {
  return distanceForPx(extent, 1);
}

export interface SphereLODOptions {
  /** The sphere's radius; defaults to `size` (a shell passes size × thickness). */
  radius?: number;
  /** Given to every level, so getObjectByName finds a mesh (the nearest level). */
  name?: string;
  /** Explicit draw order, set on each level (three does not inherit it from a LOD). */
  renderOrder?: number;
  /** Past this distance nothing draws: the levels end in an empty one (shellCullDistance). */
  cullBeyond?: number;
}

/**
 * A body's LOD: one mesh per level on the shared unit spheres, all drawing
 * `material`, switched at `lodDistances(size)`; the LOD itself is scaled to
 * the radius. `size` is the body's own size, so a body and its shells switch
 * level together (same centre, same distances) and a shell, a scaled copy of
 * the same polygon, never dips inside its surface. The renderer updates the
 * LOD each frame (`autoUpdate`), with no allocation.
 */
export function makeSphereLOD(material: THREE.Material, size: number, opts: SphereLODOptions = {}): THREE.LOD {
  const { radius = size, name = "", renderOrder = 0, cullBeyond = Infinity } = opts;
  const lod = new THREE.LOD();
  lod.scale.setScalar(radius);
  lodDistances(size).forEach((distance, i) => {
    if (distance >= cullBeyond) return;
    const mesh = new THREE.Mesh(UNIT_SPHERES[i], material);
    mesh.name = name;
    mesh.renderOrder = renderOrder;
    lod.addLevel(mesh, distance);
  });
  if (Number.isFinite(cullBeyond)) lod.addLevel(new THREE.Object3D(), cullBeyond);
  return lod;
}
