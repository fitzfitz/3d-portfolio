import { useEffect, useRef } from "react";
import { planets } from "../../constants";
import { DESTINATIONS } from "../../data/destinations";
import { BUOY_POSITIONS, CAREER_AMBER } from "../../data/careerTrail";
import { GATE_POS, GATE_RADAR_GREY } from "../../data/dormantGate";
import { flight, useSpaceStore, bodies, crystalSlots } from "../../store/spaceStore";
import { worldToRadar, altitudeCue } from "../../utils/radarTransform";
import { liveRadar } from "../../utils/liveSky";

const SIZE = 148;
const RANGE = 220; // world units mapped to radar radius
const PLANET_COLORS = planets.map((p) => ({ name: p.name, color: p.color }));
/** Destinations are fixed: one blip each, in the table's colour. */
const DESTINATION_BLIPS = DESTINATIONS.map((d) => ({ name: d.id, x: d.pos[0], y: d.pos[1], z: d.pos[2], color: d.color }));

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

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);

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
      const { activeZone, visitedDossiers: visited } = useSpaceStore.getState();
      const targets = [
        ...PLANET_COLORS.map((p) => {
          const b = bodies[p.name];
          return { name: p.name, x: b.x, y: b.y, z: b.z, color: p.color };
        }),
        ...DESTINATION_BLIPS,
        { name: "sun", x: 0, y: 0, z: 0, color: "#ff5500" },
      ];
      for (const t of targets) {
        const dx = (t.x - flight.x);
        const dz = (t.z - flight.z);
        const { x: sx, up } = worldToRadar(dx, dz, a);
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
        // Read dossiers get an outline ring, so what's left reads at a glance.
        if (visited.includes(t.name)) {
          ctx.strokeStyle = t.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(c + px, c + py, 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Relative-altitude chevron: ▲ target above, ▼ below
        const dy = (t.y - flight.y);
        const cue = altitudeCue(dy);
        if (cue.dir !== 0) {
          ctx.globalAlpha = cue.alpha * (onRim ? 0.45 : 0.9);
          const by = c + py - cue.dir * 6; // apex offset from the blip
          ctx.beginPath();
          ctx.moveTo(c + px - 2.5, by + cue.dir * 2.5);
          ctx.lineTo(c + px, by);
          ctx.lineTo(c + px + 2.5, by + cue.dir * 2.5);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Fuel crystals: in-range only (3D gate — a horizontal-only
      // gate here used to draw ~57% of blips farther than RANGE with no
      // altitude cue at all), never rim-clamped. Only crystals inside the
      // 3D RANGE sphere draw, so the radar is the "where is my nearest fuel"
      // cue without swamping the display with all 40 across the 400 system.
      {
        for (const s of crystalSlots) {
          if (!s.active) continue;
          const dx = (s.x - flight.x);
          const dz = (s.z - flight.z);
          const dy = (s.y - flight.y);
          if (Math.hypot(dx, dz, dy) > RANGE) continue; // out of range: simply absent
          const { x: sx, up } = worldToRadar(dx, dz, a);
          const px = sx * scale;
          const py = -up * scale;
          // Re-established every iteration: the chevron below changes
          // globalAlpha, and without this reset that alpha would bleed into
          // the NEXT crystal's dot in the loop.
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = "#ffd24a";
          ctx.beginPath();
          ctx.arc(c + px, c + py, 1.5, 0, Math.PI * 2);
          ctx.fill();
          // Relative-altitude chevron, mirroring the planet pass above but
          // scaled to the crystals' smaller 1.5px blip (vs. 2.4px for
          // planets — same ~0.625 ratio applied to the apex offset and
          // half-width). Crystals are never rim-clamped, so this is always
          // the "not onRim" alpha treatment.
          const cue = altitudeCue(dy);
          if (cue.dir !== 0) {
            ctx.globalAlpha = cue.alpha * 0.9;
            const by = c + py - cue.dir * 3.75;
            ctx.beginPath();
            ctx.moveTo(c + px - 1.5625, by + cue.dir * 1.5625);
            ctx.lineTo(c + px, by);
            ctx.lineTo(c + px + 1.5625, by + cue.dir * 1.5625);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      }

      // Career buoys: small hollow amber rings (crystals are filled dots), in
      // range only and never rim-clamped; the station itself is a destination
      // blip above.
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = CAREER_AMBER;
      ctx.lineWidth = 1.2;
      for (const p of BUOY_POSITIONS) {
        const dx = (p[0] - flight.x);
        const dz = (p[2] - flight.z);
        const dy = (p[1] - flight.y);
        if (Math.hypot(dx, dz, dy) > RANGE) continue;
        const { x: sx, up } = worldToRadar(dx, dz, a);
        ctx.beginPath();
        ctx.arc(c + sx * scale, c - up * scale, 2.4, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // The dormant gate: an unlabelled grey dot, in range only and never
      // rim-clamped, so it is found by flying (spec §2). No name, no ring.
      {
        const dx = (GATE_POS[0] - flight.x);
        const dz = (GATE_POS[2] - flight.z);
        const dy = (GATE_POS[1] - flight.y);
        if (Math.hypot(dx, dz, dy) <= RANGE) {
          const { x: sx, up } = worldToRadar(dx, dz, a);
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = GATE_RADAR_GREY;
          ctx.beginPath();
          ctx.arc(c + sx * scale, c - up * scale, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // Live pilots (live sky): a hollow diamond in the pilot's plume colour,
      // so it never reads as a planet dot. Rim-clamped and dimmed like distant
      // planets: the point is knowing which way the other pilots are.
      for (let i = 0; i < liveRadar.count; i++) {
        const g = liveRadar.blips[i];
        const dx = (g.x - flight.x);
        const dz = (g.z - flight.z);
        const { x: sx, up } = worldToRadar(dx, dz, a);
        let px = sx * scale;
        let py = -up * scale;
        const dist = Math.hypot(px, py);
        let onRim = false;
        if (dist > rimR - 3) {
          const k = (rimR - 3) / dist;
          px *= k; py *= k; onRim = true;
        }
        ctx.globalAlpha = onRim ? 0.55 : 1;
        ctx.strokeStyle = g.hex;
        ctx.fillStyle = g.hex;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(c + px, c + py - 3.2);
        ctx.lineTo(c + px + 3.2, c + py);
        ctx.lineTo(c + px, c + py + 3.2);
        ctx.lineTo(c + px - 3.2, c + py);
        ctx.closePath();
        ctx.stroke();
        const cue = altitudeCue((g.y - flight.y));
        if (cue.dir !== 0) {
          ctx.globalAlpha = cue.alpha * (onRim ? 0.55 : 0.9);
          const by = c + py - cue.dir * 7;
          ctx.beginPath();
          ctx.moveTo(c + px - 2.5, by + cue.dir * 2.5);
          ctx.lineTo(c + px, by);
          ctx.lineTo(c + px + 2.5, by + cue.dir * 2.5);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // Ship chevron (always center, pointing up)
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c - 4, c + 4);
      ctx.lineTo(c, c - 5);
      ctx.lineTo(c + 4, c + 4);
      ctx.stroke();

      // Pitch ladder (right edge): nose angle −90°…+90°, notch at level flight
      const barX = SIZE - 7;
      const barTop = 14;
      const barH = SIZE - 28;
      ctx.strokeStyle = "rgba(0,255,135,0.25)";
      ctx.strokeRect(barX - 1.5, barTop, 3, barH);
      ctx.beginPath(); // level-flight notch
      ctx.moveTo(barX - 4, barTop + barH / 2);
      ctx.lineTo(barX + 4, barTop + barH / 2);
      ctx.stroke();
      const pitchNorm = Math.max(-1, Math.min(1, flight.pitch / (Math.PI / 2)));
      ctx.fillStyle = "#00ff87";
      ctx.beginPath();
      ctx.arc(barX, barTop + barH / 2 - pitchNorm * (barH / 2), 2.2, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    // Phones: shrunk and lifted to the upper left, clear of the ship (which
    // sits low-centre on a tall screen) and of the bottom button row.
    <div data-testid="radar" className="absolute top-56 left-4 origin-top-left scale-[0.7] sm:scale-100 sm:top-auto sm:bottom-24 sm:left-6 pointer-events-none rounded-full border border-primary/20 bg-black/50" style={{ width: SIZE, height: SIZE }}>
      <canvas ref={canvasRef} width={SIZE} height={SIZE} style={{ width: SIZE, height: SIZE }} data-testid="radar-canvas" />
      <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] text-primary/50 font-mono">RADAR.SYS</div>
    </div>
  );
}
