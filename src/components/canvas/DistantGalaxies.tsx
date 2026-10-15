import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ambientTime } from "../../utils/ambientTime";
import { planGalaxy, type GalaxyKind, type GalaxyPlan } from "../../utils/galaxyPainter";

/** Paints a seeded galaxy plan: halo, stars and knots, dust lanes, then the bulge. */
function makeGalaxyTexture(plan: GalaxyPlan, hueBase: number): THREE.CanvasTexture | null {
  const size = 512;
  const half = size / 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.translate(half, half);

  const ellipse = (radius: number, inner: string, outer: string) => {
    ctx.save();
    ctx.scale(1, plan.squash);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  ellipse(half * 0.94, `hsla(${hueBase}, 40%, 70%, 0.10)`, `hsla(${hueBase}, 40%, 70%, 0)`);
  // Unresolved starlight: a wide, faint disc under every star so arms read as
  // glowing bands rather than chains of dots. Knots (alpha 0.7) are skipped:
  // a halo each turned them into beads.
  for (const d of plan.dots) {
    if (d.alpha > 0.6) continue;
    ctx.fillStyle = `hsla(${d.hue}, 60%, ${d.light}%, ${d.alpha * 0.05})`;
    ctx.beginPath();
    ctx.arc(d.x * half, d.y * half, d.r * half * 7, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const d of plan.dots) {
    ctx.fillStyle = `hsla(${d.hue}, 75%, ${d.light}%, ${d.alpha})`;
    ctx.beginPath();
    ctx.arc(d.x * half, d.y * half, d.r * half, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "destination-out";
  for (const d of plan.lanes) {
    ctx.fillStyle = `rgba(0, 0, 0, ${d.alpha})`;
    ctx.beginPath();
    ctx.arc(d.x * half, d.y * half, d.r * half, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  ellipse(plan.bulge * half, "rgba(255, 240, 220, 0.95)", "rgba(255, 200, 170, 0)");
  return new THREE.CanvasTexture(canvas);
}

// Spins were 0.006 / -0.004 / 0.005 rad/s — 17 to 26 minute periods, which no
// visitor perceives. Tripled to ~6 / 8.7 / 7 minute periods. The generated
// texture's spiral arms are asymmetric, so a lopsided shape turning is an easy
// motion cue even at a low angular rate — cheap for how much it adds.
const GALAXIES: { pos: readonly [number, number, number]; scale: number; hue: number; spin: number; seed: number; kind: GalaxyKind }[] = [
  { pos: [180, 80, -160], scale: 60, hue: 255, spin: 0.072, seed: 11, kind: "spiral" },
  { pos: [-200, -80, 120], scale: 42, hue: 190, spin: -0.048, seed: 23, kind: "elliptical" },
  { pos: [30, 210, -60], scale: 50, hue: 320, spin: 0.06, seed: 37, kind: "inclined" }, // high above the pole
];

export default function DistantGalaxies() {
  const sprites = useMemo(
    () =>
      GALAXIES.map((g) => {
        const map = makeGalaxyTexture(planGalaxy(g.seed, g.kind, g.hue), g.hue);
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
    const t = ambientTime(state.clock.getElapsedTime());
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
