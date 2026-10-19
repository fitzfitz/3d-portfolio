import { useMemo } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useSpaceStore } from "../../store/spaceStore";
import type { LogbookProgress } from "../../utils/logbook";
import { SHIPYARD_BLUE } from "../../data/shipyard";
import PlumePicker from "./PlumePicker";

/**
 * The shipyard's dock dialog (docs/superpowers/specs/2026-10-16-shipyard-gate-design.md §2):
 * the one place to change the ship's look. Today that is the engine plume;
 * hull paint is added here by its own project. Same conventions as the
 * career dossier: a modal dialog, Esc or either button closes it (App's Esc
 * handler breaks orbit), and focus lands on the close button.
 */
export default function HangarPanel({ onClose }: { onClose: () => void }) {
  const badges = useSpaceStore((s) => s.badges);
  const visitedDossiers = useSpaceStore((s) => s.visitedDossiers);
  const shardsCollected = useSpaceStore((s) => s.shardsCollected);
  const plumeColor = useSpaceStore((s) => s.plumeColor);
  const charted = useSpaceStore((s) => s.charted);
  const progress = useMemo<LogbookProgress>(
    () => ({ badges, visitedDossiers, shardsCollected }), [badges, visitedDossiers, shardsCollected]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hangar-title"
      data-testid="hangar-panel"
      className="w-full max-w-xl pointer-events-auto glass-card rounded-3xl p-8 relative border max-h-[85vh] overflow-y-auto select-none bg-black/90 font-mono text-[10px]"
      style={{ borderColor: `${SHIPYARD_BLUE}33`, boxShadow: `0 0 40px ${SHIPYARD_BLUE}11` }}
    >
      <button
        autoFocus
        onClick={onClose}
        aria-label="Close hangar (Esc)"
        title="Close hangar (Esc)"
        className="absolute top-6 right-6 p-2 rounded-lg border border-white/5 bg-white/2 hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="flex flex-wrap items-center gap-6 mb-6">
        <span className="text-xs text-muted tracking-widest">// DRYDOCK_01</span>
        <span className="px-2 py-0.5 rounded text-[9px] uppercase border"
          style={{ color: SHIPYARD_BLUE, borderColor: `${SHIPYARD_BLUE}55` }}>
          DOCKED
        </span>
      </div>

      <h3 id="hangar-title" className="font-display font-black text-3xl sm:text-4xl mb-8 text-white">
        SHIPYARD // HANGAR
      </h3>

      <PlumePicker progress={progress} charted={charted} plumeColor={plumeColor}
        onPick={(id) => useSpaceStore.getState().setPlumeColor(id)} />

      <div className="flex items-center justify-between border-t border-white/5 pt-6 mt-8">
        <button
          onClick={onClose}
          className="px-5 py-3 rounded-xl text-xs font-bold text-black cursor-pointer hover:shadow-lg transition-all"
          style={{ backgroundColor: SHIPYARD_BLUE }}
        >
          THRUSTERS_BREAK_ORBIT
        </button>
      </div>
    </motion.div>
  );
}
