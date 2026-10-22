import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ambientTime } from "../../utils/ambientTime";
import { patchSunShadow } from "./sunShadow";
import { noIbl } from "./noIbl";
import { makeSphereLOD, shellCullDistance } from "../../utils/sphereLod";

/** The cloud shell's radius, in planet radii. */
const CLOUD_SHELL = 1.03;

interface CloudLayerProps {
  radius: number;
  /**
   * The cloud cover (Earth: NASA's Blue Marble clouds): the shell's
   * opacity, stored sRGB-encoded and decoded on upload (SRGBColorSpace). The
   * opacity is NASA's cloud grey^γ (process_body_maps.mjs
   * CLOUD_OPACITY_GAMMA): drawn as stored (γ 1), the thin haze (median grey
   * 0.24) veiled the oceans in grey; at the full sRGB decode (≈ γ 2.2) it
   * all but vanished.
   */
  alphaMap: THREE.Texture;
  /** The cloud tops' colour on the scene's albedo scale, linear (solarSystem.ts `look.clouds.linear`). */
  linear: number;
  /** rotation in rad/s (planet surface speeds are ~0.08-0.16; pass ~1.4x that) */
  speed?: number;
  /**
   * Eclipse shadows (sunShadow.ts). When set, the clouds darken in a moon's
   * shadow like the surface under them; without it, lit clouds drawn over the
   * shadow wash it out. At 1.03 R the shell is inside the self-skip, so its
   * own planet never shadows it, as it never shadows its surface.
   */
  sunShadow?: boolean;
}

export default function CloudLayer({ radius, alphaMap, linear, speed = 0.17, sunShadow = false }: CloudLayerProps) {
  // Built here, not as JSX, so a re-render cannot drop the shadow patch.
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      // setScalar: the working (linear) value itself, no sRGB decode.
      color: new THREE.Color().setScalar(linear),
      alphaMap,
      transparent: true,
      depthWrite: false,
      roughness: 1,
      metalness: 0,
    });
    if (sunShadow) patchSunShadow(m, "fragment");
    return m;
  }, [alphaMap, linear, sunShadow]);
  useEffect(() => () => material.dispose(), [material]);
  const materials = useMemo(() => [material], [material]);
  // Detail by distance with its planet (sphereLod.ts); the clouds cover the
  // whole disc, so they are culled only once the disc is under a pixel.
  const lod = useMemo(() => makeSphereLOD(material, radius, {
    radius: radius * CLOUD_SHELL, name: "CloudLayer", cullBeyond: shellCullDistance(radius * CLOUD_SHELL),
  }), [material, radius]);
  // Each level turns, not the LOD, so the mesh named CloudLayer (what the
  // probes read) carries the rotation and the material.
  const levels = useMemo(() => lod.levels.map((l) => l.object), [lod]);
  useFrame((state) => {
    const y = ambientTime(state.clock.getElapsedTime()) * speed;
    for (let i = 0; i < levels.length; i++) levels[i].rotation.y = y;
    // Sunlit and ambient only, like the surface under it (noIbl.ts, L29).
    noIbl(materials, state.scene.environment);
  });
  return <primitive object={lod} dispose={null} />;
}
