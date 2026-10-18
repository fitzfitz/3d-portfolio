import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ambientTime } from "../../utils/ambientTime";
import { patchSunShadow } from "./sunShadow";
import { makeSphereLOD, shellCullDistance } from "../../utils/sphereLod";

/** The cloud shell's radius, in planet radii. */
const CLOUD_SHELL = 1.03;

// One shared wispy alpha texture for all planets, generated once at module load.
// Stacked soft radial blobs (same trick as the nebula sprite) read as cloud bands.
const cloudTexture = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const rBlob = 6 + Math.random() * 26;
      const a = 0.04 + Math.random() * 0.1;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, rBlob);
      grad.addColorStop(0, `rgba(255,255,255,${a})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      // draw twice offset by width so the seam tiles horizontally
      ctx.fillRect(0, 0, 256, 256);
      ctx.save();
      const s = x < 128 ? 256 : -256;
      ctx.translate(s, 0);
      ctx.fillRect(-s, 0, 256, 256);
      ctx.restore();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
})();

interface CloudLayerProps {
  radius: number;
  tint?: string;
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

export default function CloudLayer({ radius, tint = "#ffffff", speed = 0.17, sunShadow = false }: CloudLayerProps) {
  // Built here, not as JSX, so a re-render cannot drop the shadow patch.
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(tint),
      alphaMap: cloudTexture,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      roughness: 1,
      metalness: 0,
    });
    if (sunShadow) patchSunShadow(m, "fragment");
    return m;
  }, [tint, sunShadow]);
  useEffect(() => () => material.dispose(), [material]);
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
  });
  return <primitive object={lod} dispose={null} />;
}
