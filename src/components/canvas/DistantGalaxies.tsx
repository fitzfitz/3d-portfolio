import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ambientTime } from "../../utils/ambientTime";
import { animScale } from "../../utils/animScale";

/** Procedural two-arm spiral galaxy texture. Generated once per size at module use. */
function makeGalaxyTexture(hueBase: number): THREE.CanvasTexture | null {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.translate(size / 2, size / 2);
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 56);
  core.addColorStop(0, "rgba(255,240,220,0.9)");
  core.addColorStop(1, "rgba(200,160,255,0)");
  ctx.fillStyle = core;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  for (let arm = 0; arm < 2; arm++) {
    for (let p = 0; p < 900; p++) {
      const t = p / 900;
      const ang = arm * Math.PI + t * 4.4 + (Math.random() - 0.5) * 0.45;
      const r = 14 + t * 230 * (0.92 + Math.random() * 0.16);
      ctx.fillStyle = `hsla(${hueBase + Math.random() * 40}, 80%, ${72 - t * 25}%, ${0.5 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * r, Math.sin(ang) * r, 0.8 + Math.random() * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return new THREE.CanvasTexture(canvas);
}

// Spins were 0.006 / -0.004 / 0.005 rad/s — 17 to 26 minute periods, which no
// visitor perceives. Tripled to ~6 / 8.7 / 7 minute periods. The generated
// texture's spiral arms are asymmetric, so a lopsided shape turning is an easy
// motion cue even at a low angular rate — cheap for how much it adds.
const GALAXIES = [
  { pos: [180, 80, -160] as const, scale: 60, hue: 255, spin: 0.018 },
  { pos: [-200, -80, 120] as const, scale: 42, hue: 190, spin: -0.012 },
  { pos: [30, 210, -60] as const, scale: 50, hue: 320, spin: 0.015 }, // high above the pole
];

export default function DistantGalaxies() {
  const sprites = useMemo(
    () =>
      GALAXIES.map((g) => {
        const map = makeGalaxyTexture(g.hue);
        const material = new THREE.SpriteMaterial({
          map: map ?? undefined,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        return { ...g, material };
      }),
    []
  );

  useFrame((state) => {
    const t = ambientTime(state.clock.getElapsedTime()) * animScale();
    sprites.forEach((s) => {
      s.material.rotation = t * s.spin;
    });
  });

  return (
    <>
      {sprites.map((s, i) => (
        <sprite key={i} position={[s.pos[0], s.pos[1], s.pos[2]]} scale={[s.scale, s.scale, 1]} material={s.material} />
      ))}
    </>
  );
}
