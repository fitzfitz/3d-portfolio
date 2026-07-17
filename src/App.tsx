import { useState } from "react";
import Navbar from "./components/layout/Navbar";
import Hero from "./components/sections/Hero";
import Experience from "./components/sections/Experience";
import Skills from "./components/sections/Skills";
import Contact from "./components/sections/Contact";
import Footer from "./components/layout/Footer";
import CustomCursor from "./components/layout/CustomCursor";
import HUDOverlay from "./components/layout/HUDOverlay";
import GlobalCanvas from "./components/canvas/GlobalCanvas";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, FileText, X, ExternalLink, Calendar, Briefcase } from "lucide-react";

const projects = [
  {
    title: "Multi-Tenant SaaS Platform",
    role: "Lead Architect",
    duration: "2024 - Present",
    short: "Subdomain multitenancy with automated Stripe fee splits.",
    description:
      "Architected a scalable, secure subscription platform handling schema-isolated client tenants, dynamic subdomain resolution, and custom platform fee distribution using Stripe Connect. The platform currently orchestrates billing flows for 15,000+ active subscriptions with sub-millisecond route resolution.",
    tech: ["React", "TypeScript", "Hono", "PostgreSQL", "Stripe", "Docker"],
    color: "#00ff87", // Neon Green
  },
  {
    title: "Viral Video Generator",
    role: "Core ML Engineer",
    duration: "2023 - 2024",
    short: "AI semantic scene parser and dynamic video clipper.",
    description:
      "Designed a Python-based processing pipeline parsing lengthy podcasts and webinars. Utilized OpenAI Whisper transcription matched with semantic scene analysis, facial framing detectors, and NLP emotion classifiers to clip high-retention vertical videos, exporting directly to social platform queues.",
    tech: ["Python", "PyTorch", "Whisper API", "OpenCV", "FFmpeg", "Vite"],
    color: "#00f0ff", // Neon Cyan
  },
  {
    title: "Custom Multi-Agent Architecture",
    role: "R&D AI Engineer",
    duration: "2024",
    short: "Closed-loop AI agent workflow automating local engineering.",
    description:
      "Built a custom multi-agent framework mapping hierarchy managers to coder and review agents. Operating within containerized workspaces, the system reads OpenSpec documents, plans feature files, runs local TDD cycles, and standardizes PR validation checks to optimize frontend engineering speeds.",
    tech: ["TypeScript", "Python", "LangChain", "OpenSpec", "Docker", "Portainer"],
    color: "#bd00ff", // Neon Purple
  },
];

export const COSMIC_BOUNDS = 250;

const planets = [
  { name: "saas", pos: [-110, 0, 110] as [number, number, number], color: "#00ff87", size: 4.8 },
  { name: "video", pos: [130, 0, -80] as [number, number, number], color: "#00f0ff", size: 4.8 },
  { name: "agent", pos: [-120, 0, -130] as [number, number, number], color: "#bd00ff", size: 4.8 },
];

export default function App() {
  const [vehiclePos, setVehiclePos] = useState({ x: 0, z: 0 });
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [isWarping, setIsWarping] = useState(false);
  const [isOrbitLocked, setIsOrbitLocked] = useState(false);
  const [isOrbitCooldown, setIsOrbitCooldown] = useState(false);
  const [isLowPerf, setIsLowPerf] = useState(false);
  const [isTeleporting, setIsTeleporting] = useState(false);

  // States to override game and display classic linear resume scrolling
  const [showClassicCV, setShowClassicCV] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleBoundaryWrap = () => {
    setIsTeleporting(true);
    setTimeout(() => {
      setIsTeleporting(false);
    }, 380);
  };

  const handleBreakOrbit = () => {
    setIsOrbitLocked(false);
    setActiveZone(null);
    setIsOrbitCooldown(true);
    setTimeout(() => {
      setIsOrbitCooldown(false);
    }, 1800);
  };

  const getPlanetDetails = () => {
    if (activeZone === "saas") return projects[0];
    if (activeZone === "video") return projects[1];
    if (activeZone === "agent") return projects[2];
    return null;
  };

  const planetProject = getPlanetDetails();

  return (
    <div className="relative w-full min-h-screen bg-[#020108] text-white selection:bg-primary selection:text-black overflow-hidden">
      {/* Visual Warp Teleport Screen Flash */}
      <AnimatePresence>
        {isTeleporting && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.85 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="pointer-events-none fixed inset-0 z-50 bg-[#00f0ff]/15 backdrop-blur-[3px] border-[12px] border-[#00f0ff]/30"
          />
        )}
      </AnimatePresence>

      {/* Dynamic scanline overlay visual */}
      <div className="pointer-events-none fixed inset-0 z-40 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[size:100%_4px,3px_100%] opacity-[0.12]" />

      {/* Global Interactive Layers */}
      <CustomCursor />
      
      {!showClassicCV && (
        <HUDOverlay
          activeZone={activeZone}
          vehiclePos={vehiclePos}
          isWarping={isWarping}
          isLowPerf={isLowPerf}
          setIsLowPerf={setIsLowPerf}
          isOrbitLocked={isOrbitLocked}
        />
      )}

      {/* Persistent WebGL space Flight Canvas */}
      {!showClassicCV && (
        <GlobalCanvas
          planets={planets}
          vehiclePos={vehiclePos}
          setVehiclePos={setVehiclePos}
          onZoneOverlay={setActiveZone}
          isOrbitLocked={isOrbitLocked}
          setIsOrbitLocked={setIsOrbitLocked}
          isOrbitCooldown={isOrbitCooldown}
          onWarpStatus={setIsWarping}
          isLowPerf={isLowPerf}
          onBoundaryWrap={handleBoundaryWrap}
        />
      )}

      {/* Accessibility Classic CV Toggle Button */}
      <div className="fixed top-6 right-6 z-50 pointer-events-auto flex gap-3">
        <button
          onClick={() => setShowClassicCV(!showClassicCV)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-mono text-xs text-primary border border-primary/30 bg-black/80 hover:bg-primary/20 hover:border-primary transition-all duration-300 shadow-neonGreen cursor-pointer"
        >
          {showClassicCV ? (
            <>
              <X className="w-4 h-4" />
              <span>RETURN_TO_PILOT_CABIN</span>
            </>
          ) : (
            <>
              <FileText className="w-4 h-4" />
              <span>VIEW_CLASSIC_RESUME</span>
            </>
          )}
        </button>
      </div>

      {/* -------------------- DYNAMIC SPACE INTERACTION MODALS -------------------- */}
      {!showClassicCV && (
        <div className="absolute inset-0 pointer-events-none z-20 flex items-center justify-center p-6">
          <AnimatePresence mode="wait">
            {/* Startup Banner Info Card */}
            {Math.abs(vehiclePos.x) < 0.2 && Math.abs(vehiclePos.z - 18) < 0.2 && !activeZone && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="glass-card rounded-2xl p-6 text-center max-w-sm pointer-events-auto border border-primary/20 bg-black/80 select-none"
              >
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-[9px] font-mono mb-4">
                  <Terminal className="w-3.5 h-3.5" />
                  PILOT: FITZGERAL_SYS
                </div>
                <h2 className="font-display font-bold text-xl mb-2 text-white">Space Flight CV Sandbox</h2>
                <p className="text-muted text-[11px] leading-relaxed mb-4">
                  Pilot your spaceship through deep space using your keyboard. Fly close to neon planets to lock into orbit and reveal fullscreen project dossiers, or click to spawn plasma anomalies.
                </p>
                <div className="font-mono text-[9px] text-primary">
                  &gt; PRESS W/A/S/D TO IGNITE ENGINES
                </div>
              </motion.div>
            )}

            {/* Planet gravity Orbit Lock details modal */}
            {isOrbitLocked && planetProject && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                className="w-full max-w-2xl pointer-events-auto glass-card rounded-3xl p-8 relative border max-h-[85vh] overflow-y-auto pr-4 select-none bg-black/90"
                style={{ borderColor: `${planetProject.color}33`, boxShadow: `0 0 40px ${planetProject.color}11` }}
              >
                {/* Close modal / Break Orbit Button */}
                <button
                  onClick={handleBreakOrbit}
                  className="absolute top-6 right-6 p-2 rounded-lg border border-white/5 bg-white/2 hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
                  title="Warp boost engine to break orbit"
                >
                  <X className="w-5 h-5" />
                </button>

                {/* Subheader Info */}
                <div className="flex flex-wrap items-center gap-6 mb-6">
                  <span className="flex items-center gap-2 font-mono text-xs text-muted">
                    <Briefcase className="w-4.5 h-4.5 text-white/40" />
                    {planetProject.role}
                  </span>
                  <span className="flex items-center gap-2 font-mono text-xs text-muted">
                    <Calendar className="w-4.5 h-4.5 text-white/40" />
                    {planetProject.duration}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded font-mono text-[9px] uppercase border"
                    style={{ color: planetProject.color, borderColor: `${planetProject.color}55` }}
                  >
                    ORBIT_LOCKED
                  </span>
                </div>

                {/* Planet name heading */}
                <h3 className="font-display font-black text-3xl sm:text-4xl mb-4 text-white">
                  {planetProject.title}
                </h3>

                {/* short descriptor */}
                <p className="font-mono text-sm mb-6" style={{ color: planetProject.color }}>
                  &gt; {planetProject.short}
                </p>

                {/* description */}
                <p className="text-muted text-sm sm:text-base font-light leading-relaxed mb-8">
                  {planetProject.description}
                </p>

                {/* tech tags */}
                <div className="flex flex-wrap gap-2.5 mb-8">
                  {planetProject.tech.map((tech) => (
                    <span
                      key={tech}
                      className="px-3 py-1.5 rounded-lg text-xs font-mono bg-white/5 border border-white/5 text-white/80"
                    >
                      {tech}
                    </span>
                  ))}
                </div>

                {/* controls */}
                <div className="flex items-center justify-between border-t border-white/5 pt-6">
                  <button
                    onClick={handleBreakOrbit}
                    className="px-5 py-3 rounded-xl font-mono text-xs font-bold text-black cursor-pointer hover:shadow-lg transition-all"
                    style={{ backgroundColor: planetProject.color }}
                  >
                    THRUSTERS_BREAK_ORBIT
                  </button>

                  <a
                    href="https://github.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-xs font-mono text-muted hover:text-white transition-colors"
                  >
                    VIEW_PLANET_CODE
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              </motion.div>
            )}

            {/* Portal gravity Orbit Lock: Contact form modal */}
            {isOrbitLocked && activeZone === "contact" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                className="w-full max-w-lg pointer-events-auto bg-black/90 rounded-3xl p-2 relative"
              >
                <div className="absolute top-8 right-8 z-50">
                  <button
                    onClick={handleBreakOrbit}
                    className="p-2 rounded-lg border border-white/5 bg-white/2 hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <Contact isSidebar={true} />
              </motion.div>
            )}

            {/* Proximity hover tip overlays (if within gravity well but not yet locked) */}
            {activeZone && !isOrbitLocked && (
              <motion.div
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
      )}

      {/* -------------------- CLASSIC SCROLLABLE RESUME MODE -------------------- */}
      {showClassicCV && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="relative z-10 w-full min-h-screen flex flex-col pointer-events-auto"
        >
          <Navbar />
          <main className="flex flex-col">
            <Hero />
            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            <Experience
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              projects={projects}
            />
            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            <Skills />
            <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-white/5 to-transparent" />
            <Contact />
          </main>
          <Footer />
        </motion.div>
      )}
    </div>
  );
}
