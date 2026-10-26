import { lazy, Suspense, useEffect, useState } from "react";
import { loadAssetPack } from "./utils/assetPack";
import { registerServiceWorker } from "./utils/serviceWorker";
import Navbar from "./components/layout/Navbar";
import Hero from "./components/sections/Hero";
import Experience from "./components/sections/Experience";
import Skills from "./components/sections/Skills";
import Career from "./components/sections/Career";
import Contact from "./components/sections/Contact";
import Changelog from "./components/sections/Changelog";
import Footer from "./components/layout/Footer";
import CustomCursor from "./components/layout/CustomCursor";
import HUDOverlay from "./components/layout/HUDOverlay";
import TouchControls from "./components/layout/TouchControls";
import EdgeHaze from "./components/layout/EdgeHaze";
import LogbookPanel from "./components/layout/LogbookPanel";
import CareerDossier from "./components/layout/CareerDossier";
import ProjectDossier from "./components/layout/ProjectDossier";
import HangarPanel from "./components/layout/HangarPanel";
import ChangelogPanel from "./components/layout/ChangelogPanel";
// The 3D engine (three, R3F, drei, postprocessing) is ~85% of the JS. Loading
// it lazily lets the HUD and classic résumé paint from a small chunk, and a
// `?cv` or no-WebGL visitor never downloads it at all. In a build, the asset
// packs start downloading alongside it; the canvas mounts as soon as its code
// is in, and only the scene inside waits for the packs (GlobalCanvas PackGate).
const GlobalCanvas = lazy(() => {
  void loadAssetPack();
  return import("./components/canvas/GlobalCanvas");
});
import SafeErrorBoundary from "./components/canvas/SafeErrorBoundary";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { Terminal, FileText, X } from "lucide-react";
import { useSpaceStore, WEBGL_AVAILABLE, selectModalOpen } from "./store/spaceStore";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useKeyboardInput, isEditableTarget, gameKeyIgnored } from "./hooks/useKeyboardInput";
import { useGamepadInput } from "./hooks/useGamepadInput";
import BottlePanel from "./components/layout/BottlePanel";
import { beaconApiUrl } from "./utils/beaconApi";
import { loadBottles, openBottlePanel } from "./utils/beaconActions";
import { useSound } from "./hooks/useSound";
import { useReducedMotion } from "./hooks/useReducedMotion";
import { projects, projectById } from "./constants";
import { JUMP_TARGETS, destinationById } from "./data/destinations";
import { PROBES } from "./data/probes";
import { probeIntro } from "./utils/probes";
import { identity } from "./data/identity";
import PerfOverlay from "./debug/PerfOverlay";

/**
 * Shown while the engine chunk downloads. Matches index.html's pre-React
 * overlay, so the hand-off from HTML to React to the canvas's own progress
 * readout (which also shows the asset packs streaming) doesn't flash.
 */
function EngineLoading() {
  return (
    <div className="fixed inset-0 z-0 flex items-center justify-center bg-[#020108] font-mono text-[11px] tracking-[0.22em] text-primary">
      INITIALIZING STAR SYSTEM...
    </div>
  );
}

/** Bottles (the beacon API) exist only when an API is configured; read once per page load. */
const BEACONS_ENABLED = !!beaconApiUrl();

/** The spawn card's first line, for the probes in play. */
const PROBE_INTRO = probeIntro(PROBES.length);

/** Without WebGL there is no cabin to return to. */
const CAN_FLY = WEBGL_AVAILABLE;

export default function App() {
  useKeyboardInput();
  useGamepadInput();
  useSound();
  useReducedMotion();
  // After the first render, not at module load: that render is what starts
  // the asset-pack download (the lazy GlobalCanvas), and the worker must see
  // it started and wait, or its hand-over re-fetch competes with the packs.
  useEffect(() => {
    if (import.meta.env.PROD) registerServiceWorker();
  }, []);
  const activeZone = useSpaceStore((s) => s.activeZone);
  const isOrbitLocked = useSpaceStore((s) => s.isOrbitLocked);
  const openDossier = useSpaceStore((s) => s.openDossier);
  const dossierVia = useSpaceStore((s) => s.dossierVia);
  const closeDossier = useSpaceStore((s) => s.closeDossier);
  const modalOpen = useSpaceStore(selectModalOpen);
  const isTeleporting = useSpaceStore((s) => s.isTeleporting);
  const isNearSpawn = useSpaceStore((s) => s.isNearSpawn);
  const showClassicCV = useSpaceStore((s) => s.showClassicCV);
  const canvasEpoch = useSpaceStore((s) => s.canvasEpoch);
  const setShowClassicCV = useSpaceStore((s) => s.setShowClassicCV);
  const breakOrbit = useSpaceStore((s) => s.breakOrbit);
  const photoMode = useSpaceStore((s) => s.photoMode);
  const logbookOpen = useSpaceStore((s) => s.logbookOpen);
  const changelogOpen = useSpaceStore((s) => s.changelogOpen);
  const setPhotoMode = useSpaceStore((s) => s.setPhotoMode);
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const sceneReady = useSpaceStore((s) => s.sceneReady);
  const showBottles = useSpaceStore((s) => s.showBottles);
  const isOrbitCooldown = useSpaceStore((s) => s.isOrbitCooldown);
  const isCoarse = useMediaQuery("(pointer: coarse)");
  const padConnected = useSpaceStore((s) => s.padConnected);
  const [activeIndex, setActiveIndex] = useState(0);

  // Dossier/contact dialogs close on Esc (outside text fields, so Esc while
  // typing a message doesn't throw the draft away). Focus moves in via the
  // close buttons' autoFocus: AnimatePresence mode="wait" mounts a dialog only
  // after the previous card's exit, so a ref read here would still be empty.
  useEffect(() => {
    if (!isOrbitLocked && openDossier === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isEditableTarget(e.target as HTMLElement | null)) return;
      // The project dossier sits over the flight view, not an orbit lock.
      if (useSpaceStore.getState().openDossier !== null) closeDossier();
      else breakOrbit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOrbitLocked, openDossier, activeZone, breakOrbit, closeDossier]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useSpaceStore.getState();
      // Not while typing, nor behind the résumé, nor while the bottle panel owns the keys.
      if (gameKeyIgnored({ target: e.target as HTMLElement | null, repeat: e.repeat, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey }, s)) return;
      if (e.code === "KeyP") { setPhotoMode(!s.photoMode); return; }
      if (e.code === "KeyB" && BEACONS_ENABLED && !s.photoMode && !selectModalOpen(s)) {
        openBottlePanel();
        return;
      }
      if (e.code === "KeyL" && !s.photoMode && !selectModalOpen(s)) {
        s.setLogbookOpen(!s.logbookOpen);
        return;
      }
      if (e.code === "KeyN" && !s.photoMode && !selectModalOpen(s)) {
        s.setChangelogOpen(!s.changelogOpen);
        return;
      }
      // Number keys jump to JUMP_TARGETS in order: probes, then destinations.
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && !s.photoMode) {
        const target = JUMP_TARGETS[Number(digit[1]) - 1];
        if (target) s.requestJump(target.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPhotoMode]);

  // The sky's bottles load once the scene is up, off the critical path, and
  // only while Show bottles is on: off fetches nothing; turning it on loads them.
  useEffect(() => {
    if (sceneReady && BEACONS_ENABLED && showBottles) void loadBottles();
  }, [sceneReady, showBottles]);
  // A pilot who charted all five before AURUM existed hears about it once.
  useEffect(() => {
    if (sceneReady) useSpaceStore.getState().tellAurumOnce();
  }, [sceneReady]);

  const dossierProject = projectById(openDossier);
  // Each destination opens its own modal (the contact form, the career dossier, the hangar).
  const zoneDestination = destinationById(activeZone)?.id;

  return (
    // framer-motion ignores the CSS reduced-motion rule; drive it from the
    // store, which already merges the OS preference with the HUD toggle.
    <MotionConfig reducedMotion={reducedMotion ? "always" : "never"}>
    <div className="relative w-full min-h-screen bg-[#020108] text-white selection:bg-primary selection:text-black overflow-hidden">
      {/* Visual Warp Teleport Screen Flash */}
      <AnimatePresence>
        {isTeleporting && !reducedMotion && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.85 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            data-testid="teleport-flash"
            className="pointer-events-none fixed inset-0 z-50 bg-[#00f0ff]/15 border-[12px] border-[#00f0ff]/30"
          />
        )}
      </AnimatePresence>

      {/* Cinematic letterbox while docked in orbit (behind the dossier,
          under the HUD); instant under reduced motion (MotionConfig). Each
          bar is its own fixed box, mounted only while docked: the old
          full-window wrapper, bars parked off-screen, was a full-window
          composited layer the whole time (~20 MB of tiles at 2×). */}
      {!photoMode && !showClassicCV && (
        <AnimatePresence>
          {modalOpen && (["top-0", "bottom-0"] as const).map((pos) => (
            <motion.div key={pos} aria-hidden="true"
              initial={{ y: pos === "top-0" ? "-100%" : "100%" }}
              animate={{ y: 0 }}
              exit={{ y: pos === "top-0" ? "-100%" : "100%" }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className={`pointer-events-none fixed inset-x-0 ${pos} z-30 h-[8vh] bg-black/85`} />
          ))}
        </AnimatePresence>
      )}

      {/* Edge-of-universe nebula haze: above the canvas, under the scanlines
          and HUD. Kept in photo mode, where the ship can sit in it. */}
      {!showClassicCV && <EdgeHaze />}

      {import.meta.env.DEV && <PerfOverlay />}

      {/* -------------------- HUD + DYNAMIC SPACE INTERACTION MODALS -------------------- */}
      {/* One wrapper for the scanlines, the cards and the HUD: over the canvas,
          each full-window box was a full-window composited layer of its own
          (~20 MB of tiles at 2× each); inside one they paint into one. Inside,
          bottom to top: the scanlines, the cards (z-45), the HUD (z-50). The
          scanlines are mounted always, as before (photo mode, the résumé). */}
      <div className="pointer-events-none fixed inset-0 z-50">
        {/* Dynamic scanline overlay visual */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[size:100%_4px,3px_100%] opacity-[0.12]" />
        {!photoMode && !showClassicCV && (<>
          {/* z-45: above TouchControls' joystick zone (z-40), which covers the
              left half of the screen and otherwise swallowed taps on the cards.
              The container itself is pointer-events-none, so flight touches
              still reach the joystick everywhere a card isn't. */}
          <div className="absolute inset-0 pointer-events-none z-[45] flex items-center justify-center p-6">
            <AnimatePresence mode="wait">
              {/* Startup Banner Info Card. Waits for the scene: before that it
                  sat on top of the loading readout. Never centred: the ship sits
                  mid-screen and the planet it is aimed at sits on the horizon
                  just above it, so on desktop the card goes to the right. */}
              {sceneReady && isNearSpawn && !activeZone && openDossier === null && (
                <motion.div
                  key="spawn-banner"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className={`self-start mt-[19vh] md:mt-0 md:absolute md:right-6 md:top-[22vh] glass-card rounded-2xl p-5 sm:p-6 text-center max-w-sm border border-primary/20 bg-black/80 select-none ${
                    // On touch the card sits over the joystick's half of the
                    // screen; let drags on its text fall through to steer, and
                    // keep only the buttons tappable.
                    isCoarse ? "pointer-events-none [&_button]:pointer-events-auto" : "pointer-events-auto"}`}
                >
                  <div className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-[10px] font-mono mb-4">
                    <Terminal className="w-3.5 h-3.5" />
                    SPACE FLIGHT CV
                  </div>
                  <h2 className="font-display font-bold text-2xl text-white">{identity.name}</h2>
                  <p className="font-mono text-[11px] text-primary/90 mb-3">{identity.role}</p>
                  <p className="text-white/70 text-xs leading-relaxed mb-3">
                    {PROBE_INTRO}
                  </p>
                  <div className="font-mono text-[10px] text-primary mb-3 sm:mb-4">
                    &gt; {padConnected ? "L-STICK FLY · R-STICK PITCH · RB WARP · LB BEAM" : isCoarse ? "DRAG THE LEFT HALF TO FLY" : "W/A/S/D FLY · SPACE/C PITCH · SHIFT WARP · F BEAM"}
                  </div>
                  {/* Fast path: straight into a dossier, no piloting required. */}
                  <div className="text-[10px] font-mono text-white/50 mb-2">
                    OR JUMP STRAIGHT TO
                    <div className="text-white/40">THEN HOLD {padConnected ? "LB" : isCoarse ? "BEAM" : "F"}</div>
                  </div>
                  <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2 mb-3 sm:mb-4">
                    {JUMP_TARGETS.map((t, i) => (
                      <button
                        key={t.id}
                        onClick={() => useSpaceStore.getState().requestJump(t.id)}
                        className="px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 font-mono text-[10px] text-white/80 hover:text-white cursor-pointer transition-colors"
                        style={{ borderColor: `${t.color}55` }}
                      >
                        {!isCoarse && <span className="text-white/40 mr-1">[{i + 1}]</span>}
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowClassicCV(true)}
                    className="font-mono text-[11px] text-white/60 hover:text-white underline underline-offset-4 decoration-white/20 hover:decoration-white cursor-pointer"
                  >
                    Prefer reading? Open the résumé
                  </button>
                </motion.div>
              )}

              {/* Project dossier: opened by grabbing a probe (or from the logbook) */}
              {dossierProject && dossierVia && (
                <motion.div
                  key={`dossier-${dossierProject.id}`}
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  className="w-full max-w-2xl pointer-events-auto"
                >
                  <ProjectDossier project={dossierProject} via={dossierVia} onClose={closeDossier} />
                </motion.div>
              )}

              {/* Portal gravity Orbit Lock: Contact form modal */}
              {isOrbitLocked && zoneDestination === "contact" && (
                <motion.div
                  key="contact-portal"
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Contact"
                  className="w-full max-w-lg pointer-events-auto bg-black/90 rounded-3xl p-2 relative"
                >
                  <div className="absolute top-8 right-8 z-50">
                    <button
                      autoFocus
                      onClick={breakOrbit}
                      aria-label="Close contact form (Esc)"
                      title="Close contact form (Esc)"
                      className="p-2 rounded-lg border border-white/5 bg-white/2 hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <Contact isSidebar={true} />
                </motion.div>
              )}

              {/* Career station Orbit Lock: Career dossier */}
              {isOrbitLocked && zoneDestination === "career" && (
                <CareerDossier key="career-dossier" onClose={breakOrbit} />
              )}

              {/* Shipyard Orbit Lock: Hangar (the plume picker) */}
              {isOrbitLocked && zoneDestination === "shipyard" && (
                <HangarPanel key="hangar" onClose={breakOrbit} />
              )}

              {/* Proximity hover tip overlays (if within gravity well but not yet
                  locked). Hidden during the post-break cooldown, when flying
                  closer would not lock anyway. */}
              {activeZone && !isOrbitLocked && !isOrbitCooldown && (
                <motion.div
                  key="proximity-tip"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-black/80 border border-primary/20 px-4 py-2.5 rounded-xl text-center pointer-events-none"
                >
                  <span className="text-[10px] font-mono text-primary animate-pulse">
                    &gt; GRAVITATIONAL PULL DETECTED // FLY CLOSER TO COMMENCE ORBITAL DATA DOCK
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <HUDOverlay beaconsEnabled={BEACONS_ENABLED} />
        </>)}
      </div>

      {/* Global Interactive Layers: after the HUD and cards, so the cursor draws over both. */}
      <CustomCursor />
      <LogbookPanel />
      <ChangelogPanel />
      {BEACONS_ENABLED && <BottlePanel />}
      {/* Hidden while the logbook or patch-notes sheet is open on a phone: the
          sheet covers them, and unmounting releases any held touch input. */}
      {!photoMode && !showClassicCV && !logbookOpen && !changelogOpen && <TouchControls />}

      {/* Persistent WebGL space Flight Canvas — always rendered, even in photo mode */}
      {/* A failed GLB/texture load or a lost WebGL context throws out of the
          canvas tree. Without this boundary that unmounted the whole React
          root — a blank page. Fall back to the résumé, which needs no GPU. */}
      {!showClassicCV && (
        <SafeErrorBoundary onError={() => setShowClassicCV(true)}>
          <Suspense fallback={<EngineLoading />}>
            <GlobalCanvas key={canvasEpoch} />
          </Suspense>
        </SafeErrorBoundary>
      )}

      {/* Photo mode: minimal chrome, orbitable clean frame. On a touch screen
          the label is the way out (there is no P key), so it is a button there. */}
      {photoMode && (isCoarse ? (
        <button type="button" data-testid="photo-exit" onClick={() => setPhotoMode(false)}
          className="fixed top-4 left-4 z-50 px-3 py-2 rounded-lg border border-white/10 bg-black/50 font-mono text-[10px] text-white/70 pointer-events-auto">
          PHOTO_MODE — TAP TO EXIT
        </button>
      ) : (
        <div className="fixed top-6 left-6 z-50 font-mono text-[10px] text-white/50 pointer-events-none">
          PHOTO_MODE — [{padConnected ? "Y" : "P"}] EXIT
        </div>
      ))}

      {/* Classic CV toggle. In classic mode the Navbar carries the way back,
          so this floating button would sit on top of its links. */}
      {!photoMode && !showClassicCV && (
        <div className="fixed top-4 right-4 sm:top-6 sm:right-6 z-50 pointer-events-auto flex gap-3">
          <button
            onClick={() => setShowClassicCV(true)}
            className="flex items-center gap-2 px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl font-mono text-[11px] sm:text-xs text-primary border border-primary/30 bg-black/80 hover:bg-primary/20 hover:border-primary transition-all duration-300 shadow-neonGreen cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>VIEW_CLASSIC_RESUME</span>
          </button>
        </div>
      )}


      {/* -------------------- CLASSIC SCROLLABLE RESUME MODE -------------------- */}
      {!photoMode && showClassicCV && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="relative z-10 w-full min-h-screen flex flex-col pointer-events-auto"
        >
          <Navbar onReturnToCabin={CAN_FLY ? () => setShowClassicCV(false) : undefined} />
          <main className="flex flex-col">
            <Hero />
            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            <Experience
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              projects={projects}
            />
            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            <Career />
            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            <Skills />
            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            <Changelog />
            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            <Contact />
          </main>
          <Footer />
        </motion.div>
      )}
    </div>
    </MotionConfig>
  );
}
