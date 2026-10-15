import { motion } from "framer-motion";
import { X } from "lucide-react";
import CareerList from "../sections/CareerList";
import { CAREER_AMBER } from "../../data/careerTrail";

/**
 * The career station's dossier (spec §2): the résumé's work history, opened by
 * docking at the station. Same conventions as a project dossier: a modal
 * dialog, Esc or either button closes it (App's Esc handler breaks orbit), and
 * focus lands on the close button.
 */
export default function CareerDossier({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="career-dossier-title"
      data-testid="career-dossier"
      className="w-full max-w-2xl pointer-events-auto glass-card rounded-3xl p-8 relative border max-h-[85vh] overflow-y-auto pr-4 select-none bg-black/90"
      style={{ borderColor: `${CAREER_AMBER}33`, boxShadow: `0 0 40px ${CAREER_AMBER}11` }}
    >
      <button
        autoFocus
        onClick={onClose}
        aria-label="Close career dossier (Esc)"
        title="Close career dossier (Esc)"
        className="absolute top-6 right-6 p-2 rounded-lg border border-white/5 bg-white/2 hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="flex flex-wrap items-center gap-6 mb-6">
        <span className="font-mono text-xs text-muted tracking-widest">// WORK_HISTORY</span>
        <span
          className="px-2 py-0.5 rounded font-mono text-[9px] uppercase border"
          style={{ color: CAREER_AMBER, borderColor: `${CAREER_AMBER}55` }}
        >
          DOCKED
        </span>
      </div>

      <h3 id="career-dossier-title" className="font-display font-black text-3xl sm:text-4xl mb-8 text-white">
        Career
      </h3>

      <CareerList />

      <div className="flex items-center justify-between border-t border-white/5 pt-6 mt-8">
        <button
          onClick={onClose}
          className="px-5 py-3 rounded-xl font-mono text-xs font-bold text-black cursor-pointer hover:shadow-lg transition-all"
          style={{ backgroundColor: CAREER_AMBER }}
        >
          THRUSTERS_BREAK_ORBIT
        </button>
      </div>
    </motion.div>
  );
}
