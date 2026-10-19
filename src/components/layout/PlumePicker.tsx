import { LOGBOOK, plumeAllowed, type LogbookProgress } from "../../utils/logbook";
import { PLUME_COLORS, hasPlumeColour } from "../../data/plumeColors";
import type { ChartRecord } from "../../utils/charting";

/**
 * The engine-plume picker (moved from the logbook to the shipyard's Hangar,
 * docs/superpowers/specs/2026-10-16-shipyard-gate-design.md §2). Pure: the
 * Hangar passes the progress, the current colour and the setter.
 * Buttons, not radio inputs: a focused <input> counts as a text field to the
 * flight keys, so W/A/S/D and Esc would stop working after a click.
 */
export default function PlumePicker({ progress, charted = [], plumeColor, onPick }: {
  progress: LogbookProgress; charted?: readonly ChartRecord[]; plumeColor: string; onPick: (id: string) => void;
}) {
  return (
    <>
      <div className="text-white/40 mb-1" id="plume-label">ENGINE PLUME</div>
      <div role="radiogroup" aria-labelledby="plume-label" className="flex flex-wrap gap-2">
        {Object.entries(PLUME_COLORS).map(([id, c]) => {
          const allowed = plumeAllowed(id, progress, hasPlumeColour, charted);
          const badge = LOGBOOK.find((e) => e.id === id);
          // AURUM is the survey's reward, not a badge's.
          const unlock = id === "cartographer" ? "chart all 5 worlds" : `earn ${badge?.title ?? id}`;
          return (
            <button key={id} type="button" role="radio" aria-checked={plumeColor === id} disabled={!allowed}
              data-testid={`plume-${id}`}
              aria-label={allowed ? `${c.name} plume` : `${c.name} plume, locked: ${unlock}`}
              title={allowed ? c.name : `${unlock[0].toUpperCase()}${unlock.slice(1)} to unlock`}
              onClick={() => onPick(id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border outline-none focus-visible:ring-1 focus-visible:ring-primary ${plumeColor === id ? "border-primary/60" : "border-white/10"} ${allowed ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}>
              <span aria-hidden="true" className="w-3 h-3 rounded-full" style={{ backgroundColor: c.hex }} />
              <span aria-hidden="true">{c.name}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
