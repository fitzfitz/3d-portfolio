import { useEffect, useRef, type CSSProperties } from "react";
import { Terminal, Cpu, Eye, EyeOff, RotateCcw, Volume2, VolumeX, Zap, ZapOff, RadioTower, BookOpen, ScrollText } from "lucide-react";
import { speedKmS, distanceAU, lightFractionLabel } from "../../utils/realUnits";
import { bodiesGameSeconds } from "../../utils/bodyPositions";
import { formatOrreryDate, orreryJd } from "../../utils/orreryClock";
import { SYSTEM_RADIUS, SHIP_MAX_SPEED, projectById } from "../../constants";
import { PROBES, PROBE_IDS } from "../../data/probes";
import { probePos, probeRelocating } from "../../store/probeState";
import { probeTipText, relocationSettled, probeDossiersRead } from "../../utils/probes";
import { DESTINATIONS, afterProbes, jumpKey, destinationById } from "../../data/destinations";
import { NEST_CENTRE, NEST_JUMP_ID, NEST_LABEL, NEST_RED } from "../../data/nest";
import { flight, combat, useSpaceStore, selectModalOpen } from "../../store/spaceStore";
import { hullBarColor, hullLabel, hullShown, waveReadout } from "../../utils/combat/nestHud";
import { HULL_MAX } from "../../utils/combat/constants";
import { SHARDS } from "../../data/shards";
import { FUEL_MAX, FUEL_LOW } from "../../utils/fuel";
import { beamState } from "../../store/beamState";
import { oreReadout } from "../../utils/mining";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import RadarMap from "./RadarMap";
import RadioChatter from "./RadioChatter";
import RaceHUD from "./RaceHUD";
import { openBottlePanel } from "../../utils/beaconActions";
import ScanRing from "./ScanRing";
import BuoyCard from "./BuoyCard";
import BottleCard from "./BottleCard";
import WaypointMarker from "./WaypointMarker";
import LogbookTracker from "./LogbookTracker";
import { CHANGELOG, hasUnseen } from "../../data/changelog";
import { setText, setStyle } from "../../utils/domWrite";

/**
 * The Nest's number key: 7 with the bundled three probes; none past 9 (six
 * live probes make it tenth), where the row shows no key (Ruling N1).
 */
const NEST_KEY = jumpKey(NEST_JUMP_ID);
const NEST_KEY_TAG = NEST_KEY >= 1 && NEST_KEY <= 9 ? `[${NEST_KEY}]` : "";

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
  const modalOpen = useSpaceStore(selectModalOpen);
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
  const probeNear = useSpaceStore((s) => s.probeNear);
  const probeTip = useSpaceStore((s) => s.probeTip);
  const isCoarse = useMediaQuery("(pointer: coarse)");
  const pad = useSpaceStore((s) => s.padConnected);
  // Buttons with a shortcut carry it in their label (the top card no longer
  // lists them). A touch screen has no keys to show, unless a pad is in.
  const keyHint = (key: string) => (isCoarse && !pad ? "" : ` (${key})`);
  const probeTipLine = probeTipText(probeTip, pad, isCoarse);
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
  const speedRef = useRef<HTMLSpanElement>(null);
  const lightRef = useRef<HTMLSpanElement>(null);
  const sunDistRef = useRef<HTMLSpanElement>(null);
  const orreryDateRef = useRef<HTMLSpanElement>(null);
  const fuelFillRef = useRef<HTMLDivElement>(null);
  const fuelLabelRef = useRef<HTMLDivElement>(null);
  const oreRef = useRef<HTMLDivElement>(null);
  const hullLabelRef = useRef<HTMLDivElement>(null);
  const hullRowRef = useRef<HTMLDivElement>(null);
  const hullBarRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const probeRowRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  // Telemetry readout: rAF straight to the DOM — zero React renders.
  useEffect(() => {
    let raf: number;
    // The wave line's last inputs: its string is rebuilt only when they change.
    let lastWave = -1, lastContacts = -1;
    const tick = () => {
      // setText / setStyle skip unchanged writes (utils/domWrite.ts): at rest
      // nothing here changes, and each rewrite was a relayout and garbage.
      setText(locRef.current, `NAV.LOC: X(${flight.x.toFixed(2)}) / Y(${flight.y.toFixed(1)}) / Z(${flight.z.toFixed(2)})`);
      const kmS = speedKmS(flight.speed);
      setText(speedRef.current, `VELOCITY: ${kmS.toFixed(0)} KM/S`);
      setText(lightRef.current, lightFractionLabel(flight.speed));
      setText(sunDistRef.current, ` · SUN ${distanceAU(Math.hypot(flight.x, flight.y, flight.z)).toFixed(2)} AU`);
      setText(orreryDateRef.current, ` · ORRERY ${formatOrreryDate(orreryJd(bodiesGameSeconds()))}`);
      // Accent while a gravity assist carries the ship past cruise speed.
      setStyle(velRef.current, "color", flight.speed > SHIP_MAX_SPEED ? "#bd00ff" : "");
      const pct = Math.max(0, Math.min(1, flight.fuel / FUEL_MAX));
      // Amber under a quarter, red when dry. Written as style rather than a
      // className so this never touches React.
      setStyle(fuelFillRef.current, "width", `${(pct * 100).toFixed(1)}%`);
      setStyle(fuelFillRef.current, "backgroundColor",
        pct <= 0 ? "#ef4444" : pct < FUEL_LOW / FUEL_MAX ? "#f59e0b" : "#00ff87");
      setText(fuelLabelRef.current, pct <= 0 ? "WARP.FUEL: DRY" : `WARP.FUEL: ${(pct * 100).toFixed(0)}%`);
      // Mining readout: shown while pebbles are coming in, and 2s after.
      if (oreRef.current) {
        const show = performance.now() - beamState.oreAt < 2000;
        setStyle(oreRef.current, "display", show ? "" : "none");
        if (show) setText(oreRef.current, oreReadout(beamState.ore));
      }
      // The Nest's hull row (spec 2026-10-27-combat): in the fighting area, or
      // anywhere while the hull is below full. Red below 30%.
      const hp = combat.nest.hull.hp;
      const hullOn = hullShown(combat.inArea, hp);
      setStyle(hullLabelRef.current, "display", hullOn ? "" : "none");
      setStyle(hullRowRef.current, "display", hullOn ? "" : "none");
      setStyle(hullBarRef.current, "display", hullOn ? "" : "none");
      if (hullOn) {
        setText(hullLabelRef.current, hullLabel(hp));
        setStyle(hullBarRef.current, "width", `${Math.max(0, Math.min(100, (hp / HULL_MAX) * 100)).toFixed(1)}%`);
        setStyle(hullBarRef.current, "backgroundColor", hullBarColor(hp));
      }
      // The wave line, from the store's wave and contacts (event-rate values).
      const st = useSpaceStore.getState();
      if (st.wave !== lastWave || st.contacts !== lastContacts) {
        lastWave = st.wave; lastContacts = st.contacts;
        const line = waveReadout(st.wave, st.contacts);
        setText(waveRef.current, line);
        setStyle(waveRef.current, "display", line ? "" : "none");
      }
      for (const def of PROBES) {
        const b = probePos[def.id];
        if (b) setText(probeRowRefs.current[def.id], `PROBE_${def.id.toUpperCase()} ([${b.x.toFixed(0)}, ${b.y.toFixed(0)}, ${b.z.toFixed(0)}])`);
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
      "WARP CORE DRY // RELEASE WARP TO RECHARGE — THRUSTERS STILL NOMINAL"
    );
  }, [fuelEmpty]);

  // Once every dossier is read, point the pilot at the next destination (the
  // career station, then the contact portal), announced on leaving the last
  // dossier, when the chatter line is actually visible, and only after that
  // probe has relocated (rulings R12, R12b): its PROBE RELOCATING line goes
  // first and stays readable, since the hint is queued through
  // announceLogbook, which yields ~4.5 s to a fresh broadcast; the hint then
  // holds its 8 s. probePos and probeRelocating are not store state, but
  // ProjectProbes settles a probe and then sends its line in the same tick,
  // and that store write re-runs this selector.
  const dossiersRead = probeDossiersRead(visitedDossiers, PROBE_IDS);
  const allRead = dossiersRead >= PROBES.length;
  const relocated = useSpaceStore((s) => relocationSettled(s.relocation?.id ?? null, s.probeSpots, probePos, probeRelocating));
  useEffect(() => {
    if (!allRead || modalOpen || !relocated || completionAnnounced) return;
    completionAnnounced = true;
    const next = destinationById(afterProbes(useSpaceStore.getState().badges));
    if (!next) return;
    const key = jumpKey(next.id);
    useSpaceStore.getState().announceLogbook(
      `ALL ${PROBES.length} DOSSIERS READ // NEXT STOP: THE ${next.label} — PRESS ${key} TO JUMP THERE`
    );
  }, [allRead, modalOpen, relocated]);

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
      {!modalOpen && <ScanRing />}
      {/* Frozen with the scene while docked, so hidden then too. */}
      {!modalOpen && <BuoyCard />}
      {/* A message in a bottle's read card: only with the bottle API, frozen with the scene while docked. */}
      {beaconsEnabled && !modalOpen && <BottleCard />}
      {/* Phones get the three readouts that matter mid-flight; the rest of
          the telemetry is desktop flavour and collided with everything. */}
      {/* items-start: each row is only as wide as its text. Stretched rows took
          the widest row's width (the logbook tracker with its worlds suffix),
          which put the velocity line's box under the gravity warning. */}
      <div className="absolute top-16 left-4 sm:top-24 sm:left-6 flex flex-col items-start gap-1.5">
        <div className="flex items-center gap-1.5 text-primary">
          <Terminal className="w-3.5 h-3.5" />
          <span>VESSEL.NAV: ONLINE</span>
        </div>
        {/* Flavour readouts fold away once the pilot is flying (data-quiet). */}
        <div ref={locRef} className="hidden sm:block group-data-[quiet=true]/hud:sm:hidden">NAV.LOC: X(0.00) / Y(0.0) / Z(18.00)</div>
        <div className="hidden sm:block group-data-[quiet=true]/hud:sm:hidden">SECTOR.RANGE: {distanceAU(SYSTEM_RADIUS * 2).toFixed(2)} AU</div>
        {/* The light-speed, AU and date parts are hidden on phones: the longer
            line ran into the right column (the probe pickup tip). Ruling R30
            accepts the phone line without "% C"; desktops keep it
            (tests/hudLightFraction.test.tsx). */}
        <div ref={velRef} data-testid="hud-velocity">
          <span ref={speedRef}>VELOCITY: 0 KM/S</span>
          <span ref={lightRef} data-testid="hud-light-fraction" className="hidden sm:inline">{lightFractionLabel(0)}</span>
          <span ref={sunDistRef} data-testid="hud-sun-distance" className="hidden sm:inline"> · SUN 0.00 AU</span>
          <span ref={orreryDateRef} data-testid="hud-orrery-date" className="hidden sm:inline"> · ORRERY {formatOrreryDate(orreryJd(0))}</span>
        </div>
        <div className={`hidden sm:block ${!isWarping && !fuelEmpty ? "group-data-[quiet=true]/hud:sm:hidden" : ""}`}>WARP.CORE: {fuelEmpty ? "OFFLINE (NO FUEL)" : isWarping ? "ACTIVE (STRETCH)" : "CHARGED (STANDBY)"}</div>
        <div className={allRead ? "text-primary" : "text-white/70"} data-testid="hud-dossiers">
          DOSSIERS: {dossiersRead}/{PROBES.length}
        </div>
        <div>SHARDS: {shardsCollected.length}/{SHARDS.length}</div>
        <LogbookTracker />
        <div ref={fuelLabelRef} data-testid="hud-fuel-label">WARP.FUEL: 100%</div>
        <div className="w-32 h-1 rounded-full bg-white/10 overflow-hidden">
          <div ref={fuelFillRef} data-testid="hud-fuel-bar"
            className="h-full rounded-full transition-none"
            style={{ width: "100%", backgroundColor: "#00ff87" }} />
        </div>
        {/* The Nest's hull, under the fuel bar; the loop shows it (hullShown). */}
        <div ref={hullLabelRef} data-testid="hud-hull-label" className="text-[#ff8a95]" style={{ display: "none" }}>HULL: 100%</div>
        <div ref={hullRowRef} className="w-32 h-1 rounded-full bg-white/10 overflow-hidden" style={{ display: "none" }}>
          <div ref={hullBarRef} data-testid="hud-hull-bar"
            className="h-full rounded-full transition-none"
            style={{ display: "none", width: "100%", backgroundColor: "#00ff87" }} />
        </div>
        <div ref={waveRef} data-testid="hud-nest-wave" className="text-[#ff8a95]" style={{ display: "none" }} />
        <div ref={oreRef} data-testid="hud-ore" className="text-[#3ff2d0]" style={{ display: "none" }} />
      </div>

      <div className="absolute top-16 right-4 sm:top-24 sm:right-6 flex flex-col items-end gap-1.5">
        <div className="hidden sm:flex items-center gap-1.5 text-secondary">
          <span>SCANNING_CELESTIALS</span>
          <Cpu className="w-3.5 h-3.5" />
        </div>
        <div className="text-[11px] font-bold">
          TARGET:{" "}
          <span className={probeNear || activeZone ? "text-primary animate-pulse" : "text-white/20"}>
            {probeNear ? `PROBE_${probeNear.toUpperCase()}` : (destinationById(activeZone)?.scanLabel ?? "DEEP_SPACE")}
          </span>
        </div>
        {/* "HOLD F" only when the beam would take a probe from where it
            points now (probeTip, ProjectProbes); else fly closer or turn. */}
        {probeNear && probeTipLine && !modalOpen && (
          <div data-testid="hud-probe-tip" data-tip={probeTip ?? ""} className={`text-[9px] ${probeTip === "grab" ? "text-primary/80" : "text-white/55"}`}>
            {probeTipLine}
          </div>
        )}
        {activeZone && (
          <div className="text-[9px] text-primary/70 animate-pulse">
            {isOrbitLocked ? "> [GRAVITY LOCK] ENTERING ORBIT..." : "> [WARNING] GRAVITY FIELD DETECTED"}
          </div>
        )}
      </div>

      {/* Center Top: Space flight instruction card. Desktop only: on a phone
          there is no room, and the touch buttons label themselves. Panel keys
          (L, N, B) live on their own buttons (#55); GUIDE is here because J
          has no button on desktop. */}
      <div className="absolute top-24 left-1/2 -translate-x-1/2 bg-black/60 border border-white/5 px-4 py-2.5 rounded-xl hidden md:flex gap-6 whitespace-nowrap text-[9px] transition-opacity duration-700 pointer-events-auto group-data-[quiet=true]/hud:opacity-0 group-data-[quiet=true]/hud:pointer-events-none"
        data-testid="hud-controls">
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
              <span className="text-white/45">GUIDE</span>
              <span className="text-white">{pad ? "R3" : "J"}</span>
            </div>
            <div className="w-[1px] bg-white/5" />
            <div className="flex flex-col" data-testid="hud-controls-race">
              <span className="text-white/45">RACE</span>
              <span className="text-white">{pad ? "L3" : "R"}</span>
            </div>
          </>
        )}
      </div>

      {/* Icon-only on phones: four labelled buttons ran off the screen edge. */}
      <div className="absolute bottom-5 left-4 sm:bottom-10 sm:left-6 flex gap-2 pointer-events-auto">
        {!modalOpen && <button data-testid="logbook-button" onClick={() => { const s = useSpaceStore.getState(); s.setLogbookOpen(!s.logbookOpen); }}
          aria-label="Pilot logbook" aria-expanded={logbookOpen}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/5 bg-white/2 text-white/50 hover:text-primary hover:border-primary/20 transition-all duration-300">
          <BookOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">LOGBOOK{keyHint(pad ? "X" : "L")}</span>
        </button>}
        {!modalOpen && <button data-testid="changelog-button" onClick={() => { const s = useSpaceStore.getState(); s.setChangelogOpen(!s.changelogOpen); }}
          aria-label={notesUnseen ? "Patch notes, new updates" : "Patch notes"} aria-expanded={changelogOpen}
          className="relative flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/5 bg-white/2 text-white/50 hover:text-primary hover:border-primary/20 transition-all duration-300">
          <ScrollText className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">PATCH_NOTES{keyHint("N")}</span>
          {notesUnseen && (
            <span data-testid="changelog-dot" aria-hidden="true" className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary" />
          )}
        </button>}
        {beaconsEnabled && !modalOpen && (
          <button data-testid="bottle-button" onClick={openBottlePanel}
            aria-label="Leave a message in a bottle"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/5 bg-white/2 text-white/50 hover:text-[#00ff87] hover:border-[#00ff87]/20 transition-all duration-300">
            <RadioTower className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">BOTTLE{keyHint("B")}</span>
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
        <div className="text-[9px] text-white/30">{"// SECTOR_PROBES — CLICK TO JUMP"}</div>
        {/* Rows double as jump buttons (same as the number keys). */}
        {PROBES.map((def, i) => (
          <button key={def.id} onClick={() => requestJump(def.id)}
            title={`Jump to the ${projectById(def.id)?.title ?? def.id} probe [${i + 1}]`}
            // The project colour through a variable, not an inline color, so hover still turns the row white.
            className={`pointer-events-auto cursor-pointer flex items-center gap-1.5 transition-colors hover:text-white ${probeNear === def.id ? "text-[color:var(--probe-color)]" : "text-white/40"}`}
            style={{ "--probe-color": projectById(def.id)?.color } as CSSProperties}>
            <span className="text-white/30">[{i + 1}]</span>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: projectById(def.id)?.color }} />
            <span ref={(el) => { probeRowRefs.current[def.id] = el; }}>
              PROBE_{def.id.toUpperCase()}
            </span>
            <span className="w-3 text-primary">{visitedDossiers.includes(def.id) ? "✓" : ""}</span>
          </button>
        ))}
        {DESTINATIONS.map((d, i) => (
          <button key={d.id} onClick={() => requestJump(d.id)}
            title={`Jump to the ${d.label.toLowerCase()} [${PROBES.length + i + 1}]`}
            className="pointer-events-auto cursor-pointer flex items-center gap-1.5 transition-colors hover:text-white text-white/40"
            style={activeZone === d.id ? { color: d.color } : undefined}>
            <span className="text-white/30">[{PROBES.length + i + 1}]</span>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.color }} />
            <span>{d.scanLabel} ([{d.pos.join(", ")}])</span>
            <span className="w-3" />
          </button>
        ))}
        {/* The Nest: a jump target, not a destination (spec 2026-10-27-nest-playable §1). */}
        <button onClick={() => requestJump(NEST_JUMP_ID)}
          title={`Jump to the Nest${NEST_KEY_TAG ? ` ${NEST_KEY_TAG}` : ""}`}
          className="pointer-events-auto cursor-pointer flex items-center gap-1.5 transition-colors hover:text-white text-white/40">
          <span className="text-white/30">{NEST_KEY_TAG}</span>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: NEST_RED }} />
          <span>{NEST_LABEL} ([{NEST_CENTRE.join(", ")}])</span>
          <span className="w-3" />
        </button>
      </div>
    </div>
  );
}
