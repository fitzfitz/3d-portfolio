import { useEffect, useRef } from "react";
import { COSMIC_BOUNDS, PORTAL_POS, planets } from "../../constants";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { wrapDelta } from "../../utils/toroidal";

const SIZE = 148;
const RANGE = 120; // world units mapped to radar radius
const targets = [
  ...planets.map((p) => ({ name: p.name, x: p.pos[0], z: p.pos[2], color: p.color })),
  { name: "contact", x: PORTAL_POS[0], z: PORTAL_POS[2], color: "#ec4899" },
  { name: "sun", x: 0, z: 0, color: "#ff5500" },
];

/** Heading-up radar. Canvas 2D, own rAF loop, zero React renders. */
export default function RadarMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf: number;
    const c = SIZE / 2;
    const rimR = c - 6;
    const scale = rimR / RANGE;

    const draw = () => {
      const now = performance.now() / 1000;
      ctx.clearRect(0, 0, SIZE, SIZE);

      // Frame + range rings
      ctx.strokeStyle = "rgba(0,255,135,0.25)";
      ctx.lineWidth = 1;
      for (const r of [rimR, rimR * 0.66, rimR * 0.33]) {
        ctx.beginPath();
        ctx.arc(c, c, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Sweep line
      const sweep = (now * 1.2) % (Math.PI * 2);
      const grad = ctx.createLinearGradient(c, c, c + Math.cos(sweep) * rimR, c + Math.sin(sweep) * rimR);
      grad.addColorStop(0, "rgba(0,255,135,0)");
      grad.addColorStop(1, "rgba(0,255,135,0.35)");
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(sweep) * rimR, c + Math.sin(sweep) * rimR);
      ctx.stroke();

      // Blips (heading-up: rotate world deltas by ship heading)
      const a = flight.heading;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const activeZone = useSpaceStore.getState().activeZone;
      for (const t of targets) {
        const dx = wrapDelta(flight.x, t.x, COSMIC_BOUNDS);
        const dz = wrapDelta(flight.z, t.z, COSMIC_BOUNDS);
        // right = (cosA, -sinA), forward = (sinA, cosA)
        const sx = dx * cosA - dz * sinA;
        const up = dx * sinA + dz * cosA;
        let px = sx * scale;
        let py = -up * scale;
        const dist = Math.hypot(px, py);
        let onRim = false;
        if (dist > rimR - 3) {
          const k = (rimR - 3) / dist;
          px *= k; py *= k; onRim = true;
        }
        const pulse = activeZone === t.name ? 1 + 0.5 * Math.sin(now * 8) : 1;
        ctx.globalAlpha = onRim ? 0.45 : 1;
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.arc(c + px, c + py, (t.name === "sun" ? 3 : 2.4) * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Ship chevron (always center, pointing up)
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c - 4, c + 4);
      ctx.lineTo(c, c - 5);
      ctx.lineTo(c + 4, c + 4);
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="absolute bottom-24 left-6 pointer-events-none rounded-full border border-primary/20 bg-black/50" style={{ width: SIZE, height: SIZE }}>
      <canvas ref={canvasRef} width={SIZE} height={SIZE} />
      <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] text-primary/50 font-mono">RADAR.SYS</div>
    </div>
  );
}
