import { useEffect, useRef } from "react";
import { Terminal, Cpu, Eye, EyeOff, RotateCcw, Volume2, VolumeX, Zap, ZapOff, RadioTower, BookOpen, ScrollText } from "lucide-react";
import { COSMIC_BOUNDS, PORTAL_POS, SHIP_MAX_SPEED, planets } from "../../constants";
import { flight, useSpaceStore, bodies } from "../../store/spaceStore";
import { SHARDS } from "../../data/shards";
import { FUEL_MAX, FUEL_LOW } from "../../utils/fuel";
import { beamState } from "../../store/beamState";
import { ORE_PER_CRYSTAL } from "../../utils/mining";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import RadarMap from "./RadarMap";
import RadioChatter from "./RadioChatter";
import RaceHUD from "./RaceHUD";
import { openBeaconPicker } from "../../utils/beaconActions";
import ScanRing from "./ScanRing";
import WaypointMarker from "./WaypointMarker";
import LogbookTracker from "./LogbookTracker";
import { CHANGELOG, hasUnseen } from "../../data/changelog";

const ZONE_COLORS: Record<string, string> = {
  ruangrapi: "text-primary", portfolio: "text-secondary", fuxx: "text-accent", contact: "text-pink-500",
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

/** Module-level for the same remount reason as dryAnnouncedThisSpell. */
let completionAnnounced = false;

/** How long after leaving the spawn pad the HUD quiets down. */
const QUIET_AFTER_MS = 6000;

export default function HUDOverlay({ beaconsEnabled = false }: { beaconsEnabled?: boolean }) {
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
  const visitedDossiers = useSpaceStore((s) => s.visitedDossiers);
  const requestJump = useSpaceStore((s) => s.requestJump);
  const isCoarse = useMediaQuery("(pointer: coarse)");
  const pad = useSpaceStore((s) => s.padConnected);
  const changelogSeen = useSpaceStore((s) => s.changelogSeen);
  const logbookOpen = useSpaceStore((s) => s.logbookOpen);
  const changelogOpen = useSpaceStore((s) => s.changelogOpen);
  const notesUnseen = hasUnseen(CHANGELOG[0].id, changelogSeen);
  // Mirrors App's spawn-banner condition. On a phone the banner spans the
  // full width over the radar's spot, and the radar is no use before flying.
  const sceneReady = useSpaceStore((s) => s.sceneReady);
  const isNearSpawn = useSpaceStore((s) => s.isNearSpawn);
  const bannerUp = sceneReady && isNearSpawn && !activeZone;
  // Quiet HUD: once the pilot has left the spawn pad and kept flying for a
  // few seconds, the controls strip and the flavour telemetry fold away so
  // the scene gets the screen. Back at spawn (or after RESET) they return.
  // Toggled as a data attribute on the HUD root, not React state: a state
  // flip would be a React commit mid-flight, breaking the zero-renders-in-
  // flight guarantee the perf probe enforces.
  const hudRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = hudRootRef.current;
    if (!root) return;
    if (isNearSpawn) { root.dataset.quiet = "false"; return; }
    const id = setTimeout(() => { root.dataset.quiet = "true"; }, QUIET_AFTER_MS);
    return () => clearTimeout(id);
  }, [isNearSpawn]);

  const locRef = useRef<HTMLDivElement>(null);
  const velRef = useRef<HTMLDivElement>(null);
  const fuelFillRef = useRef<HTMLDivElement>(null);
  const fuelLabelRef = useRef<HTMLDivElement>(null);
  const oreRef = useRef<HTMLDivElement>(null);
  const planetRowRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  // Telemetry readout: rAF straight to the DOM — zero React renders.
  useEffect(() => {
    let raf: number;
    const tick = () => {
      if (locRef.current)
        locRef.current.textContent = `NAV.LOC: X(${flight.x.toFixed(2)}) / Y(${flight.y.toFixed(1)}) / Z(${flight.z.toFixed(2)})`;
      if (velRef.current)
        velRef.current.textContent = `VELOCITY: ${(flight.speed * 3.7 + Math.random() * 2).toFixed(1)} KM/S`;
      // Accent while a gravity assist carries the ship past cruise speed.
      if (velRef.current) velRef.current.style.color = flight.speed > SHIP_MAX_SPEED ? "#bd00ff" : "";
      const pct = Math.max(0, Math.min(1, flight.fuel / FUEL_MAX));
      if (fuelFillRef.current) {
        fuelFillRef.current.style.width = `${(pct * 100).toFixed(1)}%`;
        // Amber under a quarter, red when dry. Written as style rather than a
        // className so this never touches React.
        fuelFillRef.current.style.backgroundColor =
          pct <= 0 ? "#ef4444" : pct < FUEL_LOW / FUEL_MAX ? "#f59e0b" : "#00ff87";
      }
      if (fuelLabelRef.current)
        fuelLabelRef.current.textContent =
          pct <= 0 ? "WARP.FUEL: DRY" : `WARP.FUEL: ${(pct * 100).toFixed(0)}%`;
      // Mining readout: shown while pebbles are coming in, and 2s after.
      if (oreRef.current) {
        const show = performance.now() - beamState.oreAt < 2000;
        oreRef.current.style.display = show ? "" : "none";
        if (show) oreRef.current.textContent = `ORE ${beamState.ore}/${ORE_PER_CRYSTAL}`;
      }
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

  // Once every dossier is read, point the pilot at the portal — announced on
  // leaving the last dossier, when the chatter line is actually visible.
  const allRead = visitedDossiers.length >= planets.length;
  useEffect(() => {
    if (!allRead || isOrbitLocked || completionAnnounced) return;
    completionAnnounced = true;
    useSpaceStore.getState().sendBroadcast(
      `ALL ${planets.length} DOSSIERS READ // THE PILOT TAKES MESSAGES AT THE PORTAL ABOVE THE SUN — PRESS ${planets.length + 1} TO JUMP THERE`
    );
  }, [allRead, isOrbitLocked]);

  return (
    <div ref={hudRootRef} data-quiet="false" className="group/hud fixed inset-0 pointer-events-none z-50 font-mono text-[10px] text-white/60 select-none">
      {/* Same phone rule as the radar: the full-width banner already offers
          jumps, and the marker's label would draw over it. */}
      <div className={bannerUp ? "max-sm:hidden" : undefined}>
        <WaypointMarker />
      </div>
      <div className={bannerUp ? "max-sm:hidden" : undefined}>
        <RadarMap />
      </div>
      <RadioChatter />
      <RaceHUD />
      {/* The Scanner stops with the frozen scene, so its last label would
          otherwise hang over the dossier. */}
      {!isOrbitLocked && <ScanRing />}
      {/* Phones get the three readouts that matter mid-flight; the rest of
          the telemetry is desktop flavour and collided with everything. */}
      <div className="absolute top-16 left-4 sm:top-24 sm:left-6 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-primary">
          <Terminal className="w-3.5 h-3.5" />
          <span>VESSEL.NAV: ONLINE</span>
        </div>
        {/* Flavour readouts fold away once the pilot is flying (data-quiet). */}
        <div ref={locRef} className="hidden sm:block group-data-[quiet=true]/hud:sm:hidden">NAV.LOC: X(0.00) / Y(0.0) / Z(18.00)</div>
        <div className="hidden sm:block group-data-[quiet=true]/hud:sm:hidden">SECTOR.RANGE: {(COSMIC_BOUNDS * 2 * 100).toLocaleString()} KM</div>
        <div ref={velRef}>VELOCITY: 0.0 KM/S</div>
        <div className={`hidden sm:block ${!isWarping && !fuelEmpty ? "group-data-[quiet=true]/hud:sm:hidden" : ""}`}>WARP.CORE: {fuelEmpty ? "OFFLINE (NO FUEL)" : isWarping ? "ACTIVE (STRETCH)" : "CHARGED (STANDBY)"}</div>
        <div className={allRead ? "text-primary" : "text-white/70"} data-testid="hud-dossiers">
          DOSSIERS: {visitedDossiers.length}/{planets.length}
        </div>
        <div>SHARDS: {shardsCollected.length}/{SHARDS.length}</div>
        <LogbookTracker />
        <div ref={fuelLabelRef} data-testid="hud-fuel-label">WARP.FUEL: 100%</div>
        <div className="w-32 h-1 rounded-full bg-white/10 overflow-hidden">
          <div ref={fuelFillRef} data-testid="hud-fuel-bar"
            className="h-full rounded-full transition-none"
            style={{ width: "100%", backgroundColor: "#00ff87" }} />
        </div>
        <div ref={oreRef} data-testid="hud-ore" className="text-[#3ff2d0]" style={{ display: "none" }} />
      </div>

      <div className="absolute top-16 right-4 sm:top-24 sm:right-6 flex flex-col items-end gap-1.5">
        <div className="hidden sm:flex items-center gap-1.5 text-secondary">
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
          <div className="text-[9px] text-primary/70 animate-pulse">
            {isOrbitLocked ? "> [GRAVITY LOCK] ENTERING ORBIT..." : "> [WARNING] GRAVITY FIELD DETECTED"}
          </div>
        )}
      </div>

      {/* Center Top: Space flight instruction card. Desktop only: on a phone
          there is no room, and the touch buttons label themselves. */}
      <div className="absolute top-24 left-1/2 -translate-x-1/2 bg-black/60 border border-white/5 px-4 py-2.5 rounded-xl hidden md:flex gap-6 text-[9px] transition-opacity duration-700 pointer-events-auto group-data-[quiet=true]/hud:opacity-0 group-data-[quiet=true]/hud:pointer-events-none">
        <div className="flex flex-col">
          <span className="text-white/45">PILOT_STEER</span>
          <span className="text-white">{pad ? "LEFT STICK" : isCoarse ? "LEFT JOYSTICK" : "WASD / ARROWS"}</span>
        </div>
        <div className="w-[1px] bg-white/5" />
        <div className="flex flex-col">
          <span className="text-white/45">PITCH</span>
          <span className="text-white">{pad ? "RIGHT STICK" : isCoarse ? "PITCH ▲ / ▼" : "SPACE / C"}</span>
        </div>
        <div className="w-[1px] bg-white/5" />
        <div className="flex flex-col">
          <span className="text-white/45">WARP_DRIVE</span>
          <span className="text-white">{pad ? "RB" : isCoarse ? "BOOST BUTTON" : "SHIFT"}</span>
        </div>
        <div className="w-[1px] bg-white/5" />
        <div className="flex flex-col">
          <span className="text-white/45">SPAWN_PLASMA</span>
          <span className="text-white">{isCoarse ? "TAP VOID" : "CLICK VOID"}</span>
        </div>
        {!isCoarse && (
          <>
            <div className="w-[1px] bg-white/5" />
            <div className="flex flex-col">
              <span className="text-white/45">SCAN</span>
              <span className="text-white">{pad ? "HOLD A" : "HOLD E"}</span>
            </div>
            <div className="w-[1px] bg-white/5" />
            <div className="flex flex-col">
              <span className="text-white/45">TRACTOR_BEAM</span>
              <span className="text-white">{pad ? "HOLD LB" : "HOLD F"}</span>
            </div>
            <div className="w-[1px] bg-white/5" />
            <div className="flex flex-col">
              <span className="text-white/45">PHOTO_MODE</span>
              <span className="text-white">{pad ? "Y" : "P"}</span>
            </div>
            <div className="w-[1px] bg-white/5" />
            <div className="flex flex-col">
              <span className="text-white/45">LOGBOOK</span>
              <span className="text-white">{pad ? "X" : "L"}</span>
            </div>
            <div className="w-[1px] bg-white/5" />
            <div className="flex flex-col">
              <span className="text-white/45">PATCH_NOTES</span>
              <span className="text-white">N</span>
            </div>
            {beaconsEnabled && (
              <>
                <div className="w-[1px] bg-white/5" />
                <div className="flex flex-col">
                  <span className="text-white/45">BEACON</span>
                  <span className="text-white">B</span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Icon-only on phones: four labelled buttons ran off the screen edge. */}
      <div className="absolute bottom-5 left-4 sm:bottom-10 sm:left-6 flex gap-2 pointer-events-auto">
        {!isOrbitLocked && <button data-testid="logbook-button" onClick={() => { const s = useSpaceStore.getState(); s.setLogbookOpen(!s.logbookOpen); }}
          aria-label="Pilot logbook" aria-expanded={logbookOpen}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/5 bg-white/2 text-white/50 hover:text-primary hover:border-primary/20 transition-all duration-300">
          <BookOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">LOGBOOK</span>
        </button>}
        {!isOrbitLocked && <button data-testid="changelog-button" onClick={() => { const s = useSpaceStore.getState(); s.setChangelogOpen(!s.changelogOpen); }}
          aria-label={notesUnseen ? "Patch notes, new updates" : "Patch notes"} aria-expanded={changelogOpen}
          className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/5 bg-white/2 text-white/50 hover:text-primary hover:border-primary/20 transition-all duration-300">
          <ScrollText className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">PATCH_NOTES</span>
          {notesUnseen && (
            <span data-testid="changelog-dot" aria-hidden="true" className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary" />
          )}
        </button>}
        {beaconsEnabled && !isOrbitLocked && (
          <button data-testid="beacon-button" onClick={openBeaconPicker}
            aria-label="Drop a beacon"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/5 bg-white/2 text-white/50 hover:text-[#00ff87] hover:border-[#00ff87]/20 transition-all duration-300">
            <RadioTower className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">BEACON</span>
          </button>
        )}
        <button onClick={() => setLowPerf(!isLowPerf, true)}
          aria-label={isLowPerf ? "Enable bloom" : "Low performance mode"} aria-pressed={isLowPerf}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all duration-300 ${
            isLowPerf ? "border-red-500/25 bg-red-500/5 text-red-400"
              : "border-white/5 bg-white/2 text-white/50 hover:text-primary hover:border-primary/20"}`}>
          {isLowPerf ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{isLowPerf ? "ENABLE_BLOOM" : "LOW_PERF"}</span>
        </button>

        <button
          data-testid="hud-reduced-motion"
          onClick={() => setReducedMotion(!reducedMotion, true)}
          title="Freeze ambient motion; flight still works"
          aria-label="Reduce motion" aria-pressed={reducedMotion}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all duration-300 ${
            reducedMotion ? "border-amber-400/25 bg-amber-400/5 text-amber-300"
              : "border-white/5 bg-white/2 text-white/50 hover:text-primary hover:border-primary/20"}`}>
          {reducedMotion ? <ZapOff className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{reducedMotion ? "MOTION_OFF" : "REDUCE_MOTION"}</span>
        </button>

        <button
          onClick={() => {
            window.location.reload();
          }}
          aria-label="Reset sector"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/5 bg-white/2 text-white/50 hover:text-white"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">RESET_SECTOR</span>
        </button>

        <button
          onClick={() => setMuted(!isMuted)}
          aria-label={isMuted ? "Sound off" : "Sound on"} aria-pressed={!isMuted}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all duration-300 ${
            isMuted
              ? "border-white/5 bg-white/2 text-white/30"
              : "border-primary/25 bg-primary/5 text-primary"
          }`}
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{isMuted ? "SOUND_OFF" : "SOUND_ON"}</span>
        </button>
      </div>

      {/* Sector map derived from real data (fixes stale hardcoded coordinates) */}
      <div className="absolute bottom-10 right-6 hidden md:flex flex-col gap-2 items-end">
        <div className="text-[9px] text-white/30">{"// SECTOR_PLANETS — CLICK TO JUMP"}</div>
        {/* Rows double as jump buttons (same as keys 1..n+1). */}
        {planets.map((p, i) => (
          <button key={p.name} onClick={() => requestJump(p.name)}
            title={`Jump to ${p.name} [${i + 1}]`}
            className={`pointer-events-auto cursor-pointer flex items-center gap-1.5 transition-colors hover:text-white ${activeZone === p.name ? ZONE_COLORS[p.name] : "text-white/40"}`}>
            <span className="text-white/30">[{i + 1}]</span>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
            <span ref={(el) => { planetRowRefs.current[p.name] = el; }}>
              PLANET_{p.name.toUpperCase()}
            </span>
            <span className="w-3 text-primary">{visitedDossiers.includes(p.name) ? "✓" : ""}</span>
          </button>
        ))}
        <button onClick={() => requestJump("contact")}
          title={`Jump to the contact portal [${planets.length + 1}]`}
          className={`pointer-events-auto cursor-pointer flex items-center gap-1.5 transition-colors hover:text-white ${activeZone === "contact" ? ZONE_COLORS.contact : "text-white/40"}`}>
          <span className="text-white/30">[{planets.length + 1}]</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#ec4899]" />
          <span>PORTAL_SUN ([{PORTAL_POS.join(", ")}])</span>
          <span className="w-3" />
        </button>
      </div>
    </div>
  );
}
