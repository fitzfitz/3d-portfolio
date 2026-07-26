import { useEffect, useRef } from "react";
import { Terminal, Cpu, Eye, EyeOff, RotateCcw, Volume2, VolumeX, Zap, ZapOff } from "lucide-react";
import { COSMIC_BOUNDS, PORTAL_POS, planets } from "../../constants";
import { flight, useSpaceStore, bodies } from "../../store/spaceStore";
import { SHARDS } from "../../data/shards";
import { FUEL_MAX } from "../../utils/fuel";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import RadarMap from "./RadarMap";
import RadioChatter from "./RadioChatter";
import ScanRing from "./ScanRing";

const ZONE_COLORS: Record<string, string> = {
  saas: "text-primary", video: "text-secondary", agent: "text-accent", contact: "text-pink-500",
};

/**
 * Module-level, NOT a ref: App.tsx conditionally unmounts HUDOverlay for
 * photo mode (`P` key) and classic CV, both ordinary user actions. A ref
 * would be reinitialised by that same remount and let the effect below
 * re-announce mid dry-spell, which is exactly the bug this guards against.
 * Living at module scope lets it survive the remount; it still resets on the
 * true→false edge (see the effect) so a later dry spell announces again, and
 * resets on page reload along with fuel itself. Do not "simplify" this back
 * into a useRef.
 */
let dryAnnouncedThisSpell = false;

export default function HUDOverlay() {
  const activeZone = useSpaceStore((s) => s.activeZone);
  const isWarping = useSpaceStore((s) => s.isWarping);
  const isOrbitLocked = useSpaceStore((s) => s.isOrbitLocked);
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const setLowPerf = useSpaceStore((s) => s.setLowPerf);
  const isMuted = useSpaceStore((s) => s.isMuted);
  const setMuted = useSpaceStore((s) => s.setMuted);
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const setReducedMotion = useSpaceStore((s) => s.setReducedMotion);
  const shardsCollected = useSpaceStore((s) => s.shardsCollected);
  const fuelEmpty = useSpaceStore((s) => s.fuelEmpty);
  const isCoarse = useMediaQuery("(pointer: coarse)");

  const locRef = useRef<HTMLDivElement>(null);
  const velRef = useRef<HTMLDivElement>(null);
  const fuelFillRef = useRef<HTMLDivElement>(null);
  const fuelLabelRef = useRef<HTMLDivElement>(null);
  const planetRowRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  // Telemetry readout: rAF straight to the DOM — zero React renders.
  useEffect(() => {
    let raf: number;
    const tick = () => {
      if (locRef.current)
        locRef.current.textContent = `NAV.LOC: X(${flight.x.toFixed(2)}) / Y(${flight.y.toFixed(1)}) / Z(${flight.z.toFixed(2)})`;
      if (velRef.current)
        velRef.current.textContent = `VELOCITY: ${(flight.speed * 3.7 + Math.random() * 2).toFixed(1)} KM/S`;
      const pct = Math.max(0, Math.min(1, flight.fuel / FUEL_MAX));
      if (fuelFillRef.current) {
        fuelFillRef.current.style.width = `${(pct * 100).toFixed(1)}%`;
        // Amber under a quarter, red when dry. Written as style rather than a
        // className so this never touches React.
        fuelFillRef.current.style.backgroundColor =
          pct <= 0 ? "#ef4444" : pct < 0.25 ? "#f59e0b" : "#00ff87";
      }
      if (fuelLabelRef.current)
        fuelLabelRef.current.textContent =
          pct <= 0 ? "WARP.FUEL: DRY" : `WARP.FUEL: ${(pct * 100).toFixed(0)}%`;
      for (const p of planets) {
        const el = planetRowRefs.current[p.name];
        const b = bodies[p.name];
        if (el && b) el.textContent =
          `PLANET_${p.name.toUpperCase()} ([${b.x.toFixed(0)}, ${b.y.toFixed(0)}, ${b.z.toFixed(0)}])`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // One-time chatter when the tank empties. `fuelEmpty` flips on the order of
  // seconds (not frames), and the store setter is change-guarded — but this
  // component itself can remount mid dry-spell (photo mode, classic CV), so
  // the module-level `dryAnnouncedThisSpell` (not component state) is what
  // actually prevents a duplicate announcement on that remount. Reset on the
  // true→false edge so the NEXT dry spell still announces.
  useEffect(() => {
    if (!fuelEmpty) {
      dryAnnouncedThisSpell = false;
      return;
    }
    if (dryAnnouncedThisSpell) return;
    dryAnnouncedThisSpell = true;
    useSpaceStore.getState().sendBroadcast(
      "WARP CORE DRY // COLLECT A FUEL CRYSTAL TO RECHARGE — THRUSTERS STILL NOMINAL"
    );
  }, [fuelEmpty]);

  return (
    <div className="fixed inset-0 pointer-events-none z-50 font-mono text-[10px] text-white/40 select-none">
      <RadarMap />
      <RadioChatter />
      <ScanRing />
      <div className="absolute top-24 left-6 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-primary">
          <Terminal className="w-3.5 h-3.5" />
          <span>VESSEL.NAV: ONLINE</span>
        </div>
        <div ref={locRef}>NAV.LOC: X(0.00) / Y(0.0) / Z(18.00)</div>
        <div>SECTOR.RANGE: {(COSMIC_BOUNDS * 2 * 100).toLocaleString()} KM</div>
        <div ref={velRef}>VELOCITY: 0.0 KM/S</div>
        <div>WARP.CORE: {fuelEmpty ? "OFFLINE (NO FUEL)" : isWarping ? "ACTIVE (STRETCH)" : "CHARGED (STANDBY)"}</div>
        <div>SHARDS: {shardsCollected.length}/{SHARDS.length}</div>
        <div ref={fuelLabelRef} data-testid="hud-fuel-label">WARP.FUEL: 100%</div>
        <div className="w-32 h-1 rounded-full bg-white/10 overflow-hidden">
          <div ref={fuelFillRef} data-testid="hud-fuel-bar"
            className="h-full rounded-full transition-none"
            style={{ width: "100%", backgroundColor: "#00ff87" }} />
        </div>
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
          <span className="text-white/25">PITCH</span>
          <span className="text-white">{isCoarse ? "PITCH ▲ / ▼" : "SPACE / C"}</span>
        </div>
        <div className="w-[1px] bg-white/5" />
        <div className="flex flex-col">
          <span className="text-white/25">WARP_DRIVE</span>
          <span className="text-white">{isCoarse ? "BOOST BUTTON" : "SHIFT"}</span>
        </div>
        <div className="w-[1px] bg-white/5" />
        <div className="flex flex-col">
          <span className="text-white/25">SPAWN_PLASMA</span>
          <span className="text-white">{isCoarse ? "TAP VOID" : "CLICK VOID"}</span>
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
          data-testid="hud-reduced-motion"
          onClick={() => setReducedMotion(!reducedMotion, true)}
          title="Freeze ambient motion; flight still works"
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all duration-300 ${
            reducedMotion ? "border-amber-400/25 bg-amber-400/5 text-amber-300"
              : "border-white/5 bg-white/2 text-white/50 hover:text-primary hover:border-primary/20"}`}>
          {reducedMotion ? <ZapOff className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
          <span>{reducedMotion ? "MOTION_OFF" : "REDUCE_MOTION"}</span>
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
            <span ref={(el) => { planetRowRefs.current[p.name] = el; }}>
              PLANET_{p.name.toUpperCase()}
            </span>
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
