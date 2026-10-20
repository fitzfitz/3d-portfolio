import * as THREE from "three";
import type { SolarBody } from "../../data/solarSystem";
import { displayAlbedoGain } from "../../utils/displayAlbedo";
import { RING_TAU_MAX, ringRadii, URANUS_EPSILON, uranusRingRadii, uranusRingTau } from "../../utils/ringOptics";
import { shellCullDistance } from "../../utils/sphereLod";
import { makePlanetRingMaterial } from "./guideLine";
import { bodySlot } from "./sunShadow";

/**
 * The bodies' rings (L14, spec §5.5): Saturn's measured profile and Uranus's
 * narrow, dark epsilon ring. Both draw the one RING_MAP ring program
 * (guideLine.ts): a radial strip (RGB the particle colour, A = τ /
 * RING_TAU_MAX), lit by the live sunlight (uIrradiance, written each frame)
 * and shadowed by their own planet's occluder slot (L20). The strip, the slot
 * and the colour are uniforms, so the two rings share one program.
 *
 * Each ring lies in its planet's equator: the mesh goes into the pole frame
 * (SolarBodies' group turned by spinQuaternion at time 0, +Y on the IAU pole),
 * turned so RingGeometry's local XY plane is the frame's XZ.
 */

/** Segments around a ring: at Saturn's A ring edge the chord sags under 0.01 u. */
export const RING_SEGMENTS = 256;

/** A body's ring radii (u), or null when it has none (Earth's fictional ring is gone). */
export function ringExtent(b: SolarBody): [number, number] | null {
  if (b.look.rings === "saturn") return ringRadii(b.size);
  if (b.look.rings === "uranus") return uranusRingRadii(b.size);
  return null;
}

/** Texels across the epsilon ring's strip: its τ profile is smooth. */
const URANUS_STRIP_TEXELS = 32;

/**
 * Uranus's strip, built here rather than shipped: white (the ring's colour is
 * its uniform), τ / RING_TAU_MAX in alpha across the drawn width
 * (ringOptics.ts uranusRingTau). Linear, unmipmapped and clamped, like
 * Saturn's strip.
 */
export function makeUranusRingStrip(): THREE.DataTexture {
  const w = URANUS_STRIP_TEXELS;
  const data = new Uint8Array(w * 4);
  for (let x = 0; x < w; x++) {
    data.set([255, 255, 255, Math.round((uranusRingTau((x + 0.5) / w) / RING_TAU_MAX) * 255)], x * 4);
  }
  const tex = new THREE.DataTexture(data, w, 1, THREE.RGBAFormat);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The ring's material: Saturn's colour is its strip's (the uniform white);
 * Uranus's is the epsilon ring's albedo on the scene scale (0.177 × 0.02,
 * the maps' rule) through the dark-surface display curve (displayAlbedo.ts,
 * P3), as a body's map is: 0.0035 drawn 0.030, still the darkest thing in
 * its sky. `ringMap` is the body's strip.
 */
export function makeBodyRingMaterial(b: SolarBody, ringMap: THREE.Texture): THREE.ShaderMaterial {
  const extent = ringExtent(b);
  if (!extent) throw new Error(`${b.id} has no ring`);
  const color = new THREE.Color(1, 1, 1);
  if (b.look.rings === "uranus") {
    const lin = 0.177 * URANUS_EPSILON.albedo;
    color.setScalar(lin * displayAlbedoGain(lin));
  }
  return makePlanetRingMaterial(color, extent[0], extent[1], bodySlot(b.id), { ringMap });
}

/**
 * The ring object for the pole frame: a mesh named `BodyRing_<id>` whose
 * world +Z (RingGeometry's normal) is the frame's +Y. Uranus's is a LOD that
 * empties once its 0.02 R width is under a pixel (shellCullDistance), so the
 * thin ring costs no draw call from afar; Saturn's stays drawn at any range.
 * `renderOrder` goes on the mesh (three does not inherit it from a LOD).
 */
export function makeBodyRing(b: SolarBody, material: THREE.Material, renderOrder = 0): THREE.Object3D {
  const [inner, outer] = ringExtent(b)!;
  const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, RING_SEGMENTS, 1), material);
  mesh.name = `BodyRing_${b.id}`;
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = renderOrder;
  if (b.look.rings !== "uranus") return mesh;
  const lod = new THREE.LOD();
  lod.addLevel(mesh, 0);
  lod.addLevel(new THREE.Object3D(), shellCullDistance(outer - inner));
  return lod;
}
