import { useEffect, useRef } from "react";
import { Terminal, Cpu, Eye, EyeOff, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { COSMIC_BOUNDS, PORTAL_POS, planets } from "../../constants";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { useMediaQuery } from "../../hooks/useMediaQuery";

const ZONE_COLORS: Record<string, string> = {
  saas: "text-primary", video: "text-secondary", agent: "text-accent", contact: "text-pink-500",
};

export default function HUDOverlay() {
  const activeZone = useSpaceStore((s) => s.activeZone);
  const isWarping = useSpaceStore((s) => s.isWarping);
  const isOrbitLocked = useSpaceStore((s) => s.isOrbitLocked);
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const setLowPerf = useSpaceStore((s) => s.setLowPerf);
  const isMuted = useSpaceStore((s) => s.isMuted);
  const setMuted = useSpaceStore((s) => s.setMuted);
  const isCoarse = useMediaQuery("(pointer: coarse)");

  const locRef = useRef<HTMLDivElement>(null);
  const velRef = useRef<HTMLDivElement>(null);

  // Telemetry readout: rAF straight to the DOM — zero React renders.
  useEffect(() => {
    let raf: number;
    const tick = () => {
      if (locRef.current)
        locRef.current.textContent = `NAV.LOC: X(${flight.x.toFixed(2)}) / Z(${flight.z.toFixed(2)})`;
      if (velRef.current)
        velRef.current.textContent = `VELOCITY: ${(flight.speed * 3.7 + Math.random() * 2).toFixed(1)} KM/S`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-50 font-mono text-[10px] text-white/40 select-none">
      <div className="absolute top-24 left-6 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-primary">
          <Terminal className="w-3.5 h-3.5" />
          <span>VESSEL.NAV: ONLINE</span>
        </div>
        <div ref={locRef}>NAV.LOC: X(0.00) / Z(18.00)</div>
        <div>SECTOR.RANGE: {(COSMIC_BOUNDS * 2 * 100).toLocaleString()} KM</div>
        <div ref={velRef}>VELOCITY: 0.0 KM/S</div>
        <div>WARP.CORE: {isWarping ? "ACTIVE (STRETCH)" : "CHARGED (STANDBY)"}</div>
      </div>

      <div className="absolute top-24 right-6 flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5 text-secondary">
          <span>SCANNING_CELESTIALS</span>
          <Cpu className="w-3.5 h-3.5" />
        </div>
        <div className="text-[11px] font-bold">
          TARGET:{" "}
          <span className={activeZone ? "text-primary animate-pulse" : "text-white/20"}>
            {activeZone ? `PLANET_${activeZone.toUpperCase()}` : "DEEP_SPACE"}
          </span>
        </div>
        {activeZone && (
          <div className="text-[8px] text-primary/70 animate-pulse">
            {isOrbitLocked ? "> [GRAVITY LOCK] ENTERING ORBIT..." : "> [WARNING] GRAVITY FIELD DETECTED"}
          </div>
        )}
      </div>

      {/* Center Top: Space flight instruction card */}
      <div className="absolute top-24 left-1/2 -translate-x-1/2 bg-black/60 border border-white/5 px-4 py-2.5 rounded-xl flex gap-6 text-[9px] pointer-events-auto">
        <div className="flex flex-col">
          <span className="text-white/25">PILOT_STEER</span>
          <span className="text-white">{isCoarse ? "LEFT JOYSTICK" : "WASD / ARROWS"}</span>
        </div>
        <div className="w-[1px] bg-white/5" />
        <div className="flex flex-col">
          <span className="text-white/25">WARP_DRIVE</span>
          <span className="text-white">{isCoarse ? "BOOST BUTTON" : "SPACEBAR"}</span>
        </div>
        <div className="w-[1px] bg-white/5" />
        <div className="flex flex-col">
          <span className="text-white/25">SPAWN_PLASMA</span>
          <span className="text-white">{isCoarse ? "TAP SPACE" : "CLICK SPACE"}</span>
        </div>
      </div>

      <div className="absolute bottom-10 left-6 flex gap-2 pointer-events-auto">
        <button onClick={() => setLowPerf(!isLowPerf, true)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all duration-300 ${
            isLowPerf ? "border-red-500/25 bg-red-500/5 text-red-400"
              : "border-white/5 bg-white/2 text-white/50 hover:text-primary hover:border-primary/20"}`}>
          {isLowPerf ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span>{isLowPerf ? "ENABLE_BLOOM" : "LOW_PERF"}</span>
        </button>

        <button
          onClick={() => {
            window.location.reload();
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/5 bg-white/2 text-white/50 hover:text-white"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>RESET_SECTOR</span>
        </button>

        <button
          onClick={() => setMuted(!isMuted)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all duration-300 ${
            isMuted
              ? "border-white/5 bg-white/2 text-white/30"
              : "border-primary/25 bg-primary/5 text-primary"
          }`}
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          <span>{isMuted ? "SOUND_OFF" : "SOUND_ON"}</span>
        </button>
      </div>

      {/* Sector map derived from real data (fixes stale hardcoded coordinates) */}
      <div className="absolute bottom-10 right-6 flex flex-col gap-2 items-end">
        <div className="text-[8px] text-white/20">{"// SECTOR_PLANETS"}</div>
        {planets.map((p) => (
          <div key={p.name} className={`flex items-center gap-1.5 transition-colors ${activeZone === p.name ? ZONE_COLORS[p.name] : "text-white/20"}`}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
            <span>PLANET_{p.name.toUpperCase()} ([{p.pos.join(", ")}])</span>
          </div>
        ))}
        <div className={`flex items-center gap-1.5 transition-colors ${activeZone === "contact" ? ZONE_COLORS.contact : "text-white/20"}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#ec4899]" />
          <span>PORTAL_SUN ([{PORTAL_POS.join(", ")}])</span>
        </div>
      </div>
    </div>
  );
}
