import { motion } from "framer-motion";
import { Terminal, Cpu, ArrowRight } from "lucide-react";
import { identity } from "../../data/identity";
import { EXPERIENCE_LABEL } from "../../data/career";
export default function Hero() {
  return (
    <section
      id="home"
      className="min-h-screen relative w-full flex items-center justify-center pt-24 pb-16 overflow-hidden"
    >
      {/* Background glow offsets */}
      <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] rounded-full bg-primary/10 blur-[120px] pointer-events-none animate-pulse-glow" />
      <div className="absolute bottom-[20%] right-[10%] w-[350px] h-[350px] rounded-full bg-accent/5 blur-[120px] pointer-events-none" />

      <div className="max-w-7xl w-full mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center z-10">
        {/* Left: Text Content (DOM) */}
        <div className="lg:col-span-7 flex flex-col justify-center text-left">
          {/* Tagline Badge */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-primary text-xs font-mono w-fit mb-6"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>{identity.name.toUpperCase()} // {identity.role.toUpperCase()}</span>
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="font-display font-black text-4xl sm:text-5xl lg:text-6xl tracking-tight leading-[1.1] mb-6"
          >
            Engineering the <br className="hidden sm:inline" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-secondary to-accent text-neon-green">
              Next-Gen Web
            </span>
          </motion.h1>

          {/* Description */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="text-muted text-base sm:text-lg max-w-xl font-sans font-light leading-relaxed mb-8"
          >
            Hey there! I am a <strong className="font-medium text-white">{identity.role}</strong> with {EXPERIENCE_LABEL} of building React and TypeScript front ends, currently at Hubexo. Off the clock I ship full-stack SaaS, real-time 3D and tools for AI coding agents.
          </motion.p>

          {/* Buttons CTA */}
          <motion.div
            initial={{ opacity: 0, y: 25 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.45 }}
            className="flex flex-wrap items-center gap-4"
          >
            <a
              href="#projects"
              className="px-6 py-3.5 rounded-xl font-mono text-sm bg-gradient-to-r from-primary to-secondary text-black font-semibold hover:shadow-neonGreen transition-all duration-300 flex items-center gap-2 group cursor-pointer"
            >
              EXPLORE_PROJECTS
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="#contact"
              className="px-6 py-3.5 rounded-xl font-mono text-sm border border-white/10 bg-white/5 text-white hover:bg-white/10 hover:border-white/20 transition-all duration-300"
            >
              HIRE_ME
            </a>
          </motion.div>
        </div>

        {/* Right side: orbital emblem. This column used to be a transparent
            window onto the 3D canvas, but the classic view unmounts the canvas,
            so on desktop it rendered as a blank half-page. */}
        <div className="lg:col-span-5 h-[300px] sm:h-[400px] lg:h-[500px] relative w-full flex items-center justify-center pointer-events-none">
          <div className="relative w-64 h-64 lg:w-96 lg:h-96 rounded-full border border-primary/20 flex items-center justify-center animate-pulse-glow">
            <div className="absolute inset-4 rounded-full border border-secondary/15 flex items-center justify-center">
              <div className="absolute inset-8 rounded-full border border-accent/10 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-accent opacity-30 blur-md" />
                <Cpu className="w-8 h-8 text-primary animate-spin" style={{ animationDuration: "12s" }} />
              </div>
            </div>
            {/* Particle nodes around rings */}
            <div className="absolute top-10 left-10 w-2.5 h-2.5 rounded-full bg-primary shadow-neonGreen" />
            <div className="absolute bottom-16 right-10 w-3 h-3 rounded-full bg-secondary shadow-neonCyan" />
            <div className="absolute top-24 right-16 w-2 h-2 rounded-full bg-accent shadow-neonPurple" />
          </div>
        </div>
      </div>
    </section>
  );
}
