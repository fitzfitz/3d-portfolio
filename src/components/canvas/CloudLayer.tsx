import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ambientTime } from "../../utils/ambientTime";

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
}

export default function CloudLayer({ radius, tint = "#ffffff", speed = 0.17 }: CloudLayerProps) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = ambientTime(state.clock.getElapsedTime()) * speed;
  });
  return (
    <mesh name="CloudLayer" ref={ref}>
      <sphereGeometry args={[radius * 1.03, 32, 32]} />
      <meshStandardMaterial
        color={tint}
        alphaMap={cloudTexture}
        transparent={true}
        opacity={0.35}
        depthWrite={false}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}
