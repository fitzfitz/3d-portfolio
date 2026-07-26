import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, ExternalLink, Calendar, Briefcase } from "lucide-react";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { identity } from "../../data/identity";

interface Project {
  title: string;
  description: string;
  role: string;
  duration: string;
  short: string;
  tech: string[];
  color: string;
  /** Public repo URL. Falls back to the profile when a project has none. */
  repo?: string;
}

interface ExperienceProps {
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  projects: Project[];
}

export default function Experience({
  activeIndex,
  setActiveIndex,
  projects,
}: ExperienceProps) {
  const isMobile = useIsMobile();

  const handlePrev = () => {
    setActiveIndex(activeIndex === 0 ? projects.length - 1 : activeIndex - 1);
  };

  const handleNext = () => {
    setActiveIndex(activeIndex === projects.length - 1 ? 0 : activeIndex + 1);
  };

  const activeProject = projects[activeIndex];

  return (
    <section id="projects" className="min-h-screen py-24 relative w-full flex items-center justify-center overflow-hidden">
      {/* Background radial accent */}
      <div className="absolute top-[40%] right-[-10%] w-[400px] h-[400px] rounded-full bg-secondary/5 blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 w-full z-10">
        {/* Section Header */}
        <div className="mb-16 text-center md:text-left">
          <p className="font-mono text-xs text-primary tracking-widest uppercase mb-2">
            // THE_PROOF_OF_WORK
          </p>
          <h2 className="font-display font-black text-3xl sm:text-4xl lg:text-5xl">
            Experience & Projects
          </h2>
        </div>

        {/* Layout: Left side has spacer for Global Canvas, Right side has Details Card */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center min-h-[500px]">
          
          {/* Left Column: Spacer on desktop to let Global Canvas Projects Carousel show through.
              On mobile, it displays small active project navigation page dots. */}
          <div className="lg:col-span-6 h-[250px] sm:h-[350px] lg:h-[450px] w-full relative flex items-center justify-center order-2 lg:order-1 pointer-events-none">
            {isMobile && (
              <div className="flex gap-4 items-center justify-center mt-4 pointer-events-auto">
                {projects.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveIndex(idx)}
                    className={`w-3.5 h-3.5 rounded-full transition-all duration-300 ${
                      activeIndex === idx
                        ? "w-8 animate-pulse"
                        : "bg-white/20 hover:bg-white/40"
                    }`}
                    style={{ backgroundColor: activeIndex === idx ? p.color : undefined }}
                    aria-label={`Show project ${idx + 1}`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Interactive project detail cards */}
          <div className="lg:col-span-6 flex flex-col justify-center order-1 lg:order-2">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeIndex}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4 }}
                className="glass-card rounded-2xl p-6 sm:p-8 relative overflow-hidden"
              >
                {/* Glowing Side border indicator */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1.5 transition-colors duration-300"
                  style={{ backgroundColor: activeProject.color }}
                />

                {/* Subheader Metadata */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                  <span className="flex items-center gap-2 font-mono text-xs text-muted">
                    <Briefcase className="w-4 h-4 text-white/40" />
                    {activeProject.role}
                  </span>
                  <span className="flex items-center gap-2 font-mono text-xs text-muted">
                    <Calendar className="w-4 h-4 text-white/40" />
                    {activeProject.duration}
                  </span>
                </div>

                {/* Project Title */}
                <h3 className="font-display font-extrabold text-2xl sm:text-3xl mb-3 text-white">
                  {activeProject.title}
                </h3>

                {/* Short tagline */}
                <p className="font-mono text-sm mb-6" style={{ color: activeProject.color }}>
                  &gt; {activeProject.short}
                </p>

                {/* Detailed description */}
                <p className="text-muted text-sm sm:text-base font-light leading-relaxed mb-8">
                  {activeProject.description}
                </p>

                {/* Tech tags */}
                <div className="flex flex-wrap gap-2 mb-8">
                  {activeProject.tech.map((tech) => (
                    <span
                      key={tech}
                      className="px-2.5 py-1 rounded-md text-xs font-mono bg-white/5 border border-white/5 text-white/80"
                    >
                      {tech}
                    </span>
                  ))}
                </div>

                {/* Controls & external link */}
                <div className="flex items-center justify-between border-t border-white/5 pt-6">
                  <div className="flex gap-3">
                    <button
                      onClick={handlePrev}
                      className="w-10 h-10 rounded-lg border border-white/5 flex items-center justify-center text-muted hover:text-white hover:border-white/20 transition-all duration-300 cursor-pointer"
                      aria-label="Previous Project"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={handleNext}
                      className="w-10 h-10 rounded-lg border border-white/5 flex items-center justify-center text-muted hover:text-white hover:border-white/20 transition-all duration-300 cursor-pointer"
                      aria-label="Next Project"
                    >
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>

                  <a
                    href={activeProject.repo ?? identity.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-xs font-mono text-muted hover:text-white transition-colors"
                  >
                    VIEW_CODE
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

        </div>
      </div>
    </section>
  );
}
