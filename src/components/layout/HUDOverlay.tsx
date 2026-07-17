import { useEffect, useState } from "react";
import { Terminal, Cpu, Eye, EyeOff, RotateCcw } from "lucide-react";
import { COSMIC_BOUNDS } from "../../App";

interface HUDOverlayProps {
  activeZone: string | null;
  vehiclePos: { x: number; z: number };
  isWarping: boolean;
  isLowPerf: boolean;
  setIsLowPerf: (val: boolean) => void;
  isOrbitLocked: boolean;
}

export default function HUDOverlay({
  activeZone,
  vehiclePos,
  isWarping,
  isLowPerf,
  setIsLowPerf,
  isOrbitLocked,
}: HUDOverlayProps) {
  const [speedVal, setSpeedVal] = useState(0);

  // Telemetry speeds
  useEffect(() => {
    const baseline = isWarping ? 120 : Math.abs(vehiclePos.x + vehiclePos.z) > 0.5 ? 40 : 0;
    const randomNoise = Math.random() * 4;
    setSpeedVal(parseFloat((baseline + randomNoise).toFixed(1)));
  }, [vehiclePos, isWarping]);

  return (
    <div className="fixed inset-0 pointer-events-none z-30 font-mono text-[10px] text-white/40 select-none">
      
      {/* Top Left: Diagnostics HUD */}
      <div className="absolute top-24 left-6 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-primary">
          <Terminal className="w-3.5 h-3.5" />
          <span>VESSEL.NAV: ONLINE</span>
        </div>
        <div>NAV.LOC: X({vehiclePos.x.toFixed(2)}) / Z({vehiclePos.z.toFixed(2)})</div>
        <div>SECTOR.RANGE: {(COSMIC_BOUNDS * 2 * 100).toLocaleString()} KM</div>
        <div>VELOCITY: {speedVal} KM/S</div>
        <div>WARP.CORE: {isWarping ? "ACTIVE (STRETCH)" : "CHARGED (STANDBY)"}</div>
      </div>

      {/* Top Right: Scanning check */}
      <div className="absolute top-24 right-6 flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5 text-secondary">
          <span>SCANNING_CELESTIALS</span>
          <Cpu className="w-3.5 h-3.5" />
        </div>
        <div className="text-[11px] font-bold">
          TARGET: {" "}
          <span className={activeZone ? "text-primary animate-pulse" : "text-white/20"}>
            {activeZone ? `PLANET_${activeZone.toUpperCase()}` : "DEEP_SPACE"}
          </span>
        </div>
        {activeZone && (
          <div className="text-[8px] text-primary/70 animate-pulse">
            {isOrbitLocked ? "&gt; [GRAVITY LOCK] ENTERING ORBIT..." : "&gt; [WARNING] GRAVITY FIELD DETECTED"}
          </div>
        )}
      </div>

      {/* Center Top: Space flight instruction card */}
      <div className="absolute top-24 left-1/2 -translate-x-1/2 bg-black/60 border border-white/5 px-4 py-2.5 rounded-xl flex gap-6 text-[9px] pointer-events-auto">
        <div className="flex flex-col">
          <span className="text-white/25">PILOT_STEER</span>
          <span className="text-white">WASD / ARROWS</span>
        </div>
        <div className="w-[1px] bg-white/5" />
        <div className="flex flex-col">
          <span className="text-white/25">WARP_DRIVE</span>
          <span className="text-white">SPACEBAR</span>
        </div>
        <div className="w-[1px] bg-white/5" />
        <div className="flex flex-col">
          <span className="text-white/25">SPAWN_PLASMA</span>
          <span className="text-white">CLICK SPACE</span>
        </div>
      </div>

      {/* Bottom Left: Custom control tools */}
      <div className="absolute bottom-10 left-6 flex gap-2 pointer-events-auto">
        <button
          onClick={() => setIsLowPerf(!isLowPerf)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all duration-300 ${
            isLowPerf
              ? "border-red-500/25 bg-red-500/5 text-red-400"
              : "border-white/5 bg-white/2 text-white/50 hover:text-primary hover:border-primary/20"
          }`}
        >
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
      </div>

      {/* Bottom Right: Planets sector coordinates map */}
      <div className="absolute bottom-10 right-6 flex flex-col gap-2 items-end">
        <div className="text-[8px] text-white/20">// SECTOR_PLANETS</div>
        <div className={`flex items-center gap-1.5 transition-colors ${activeZone === "saas" ? "text-primary" : "text-white/20"}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#00ff87]" />
          <span>PLANET_SAAS ([-35, 0, 35])</span>
        </div>
        <div className={`flex items-center gap-1.5 transition-colors ${activeZone === "video" ? "text-secondary" : "text-white/20"}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#00f0ff]" />
          <span>PLANET_VIDEO ([45, 0, -25])</span>
        </div>
        <div className={`flex items-center gap-1.5 transition-colors ${activeZone === "agent" ? "text-accent" : "text-white/20"}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#bd00ff]" />
          <span>PLANET_AGENT ([-40, 0, -45])</span>
        </div>
        <div className={`flex items-center gap-1.5 transition-colors ${activeZone === "contact" ? "text-pink-500" : "text-white/20"}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#ec4899]" />
          <span>PORTAL_SUN ([0, 0, -50])</span>
        </div>
      </div>

    </div>
  );
}
