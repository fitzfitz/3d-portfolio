import { useEffect, useMemo, useRef } from "react";
import { Lock, Check, X } from "lucide-react";
import { useSpaceStore } from "../../store/spaceStore";
import { LOGBOOK, entryDone, logbookCount, plumeAllowed, type LogbookProgress } from "../../utils/logbook";
import { PLUME_COLORS, hasPlumeColour } from "../../data/plumeColors";

/**
 * The pilot logbook (spec §4.3): a non-modal sheet (flight keeps running)
 * listing essentials and flight badges, with the plume picker. Esc closes it;
 * focus moves to its heading on open and back to the opener on close. It
 * closes itself when a dossier opens, photo mode starts or the résumé opens.
 */
export default function LogbookPanel() {
  const open = useSpaceStore((s) => s.logbookOpen);
  const badges = useSpaceStore((s) => s.badges);
  const visitedDossiers = useSpaceStore((s) => s.visitedDossiers);
  const shardsCollected = useSpaceStore((s) => s.shardsCollected);
  const plumeColor = useSpaceStore((s) => s.plumeColor);
  const isOrbitLocked = useSpaceStore((s) => s.isOrbitLocked);
  const photoMode = useSpaceStore((s) => s.photoMode);
  const showClassicCV = useSpaceStore((s) => s.showClassicCV);
  const progress = useMemo<LogbookProgress>(
    () => ({ badges, visitedDossiers, shardsCollected }), [badges, visitedDossiers, shardsCollected]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && (isOrbitLocked || photoMode || showClassicCV)) useSpaceStore.getState().setLogbookOpen(false);
  }, [open, isOrbitLocked, photoMode, showClassicCV]);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") useSpaceStore.getState().setLogbookOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Give focus back only on a visitor's own close. When the sheet closed
      // itself because a dossier opened (or photo mode / the résumé), focus
      // belongs to that, and pulling it back would strand a screen reader.
      const s = useSpaceStore.getState();
      if (!s.isOrbitLocked && !s.photoMode && !s.showClassicCV) opener.current?.focus?.();
    };
  }, [open]);

  if (!open || photoMode || showClassicCV) return null;
  const { done, total } = logbookCount(progress);
  const earnedAt = (id: string) => badges.find((b) => b.id === id)?.at;
  const list = (kind: "essential" | "badge") => LOGBOOK.filter((e) => e.section === kind).map((e) => {
    const isDone = entryDone(e, progress);
    const at = earnedAt(e.id);
    const swatch = e.plume ? PLUME_COLORS[e.id]?.hex : undefined;
    return (
      <li key={e.id} className="flex items-start gap-2 py-1">
        <span aria-hidden="true" className={`mt-0.5 ${isDone ? "text-primary" : "text-white/30"}`}>
          {isDone ? <Check className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
        </span>
        <span className="flex-1">
          <span className={isDone ? "text-white" : "text-white/60"}>{e.title}</span>
          <span className="sr-only">{isDone ? ", done." : ", not yet."}</span>
          <span className="block text-[9px] text-white/40">{isDone ? (at ? `EARNED ${at}` : "DONE") : e.hint}</span>
        </span>
        {swatch && <span aria-hidden="true" className="mt-1 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: swatch, opacity: isDone ? 1 : 0.3 }} />}
      </li>
    );
  });

  return (
    <div role="dialog" aria-modal="false" aria-labelledby="logbook-title" data-testid="logbook-panel"
      className="fixed z-[55] pointer-events-auto font-mono text-[10px] glass-card bg-black/90 border border-white/10 overflow-y-auto
        inset-x-3 bottom-3 max-h-[70vh] rounded-2xl px-4 pb-4
        sm:inset-x-auto sm:right-6 sm:top-24 sm:bottom-auto sm:w-[380px] sm:max-h-[calc(100vh-8rem)]">
      {/* Sticky header: above the HUD (z-55 > HUD z-50), so its close button is
          always tappable, on phones too. */}
      <div className="sticky top-0 -mx-4 px-4 pt-4 pb-3 mb-1 bg-black/95 flex items-center justify-between gap-3">
        <h2 id="logbook-title" ref={headingRef} tabIndex={-1} className="text-primary text-xs outline-none">PILOT LOGBOOK</h2>
        <span className="ml-auto text-white/60">{done} / {total}</span>
        <button type="button" data-testid="logbook-close" aria-label="Close logbook"
          onClick={() => useSpaceStore.getState().setLogbookOpen(false)}
          className="p-2 -m-1 rounded-lg text-white/60 hover:text-white focus-visible:ring-1 focus-visible:ring-primary outline-none">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="text-white/40 mb-1">ESSENTIALS</div>
      <ul className="mb-3">{list("essential")}</ul>
      <div className="text-white/40 mb-1">FLIGHT BADGES</div>
      <ul className="mb-3">{list("badge")}</ul>
      {/* Buttons, not radio inputs: a focused <input> counts as a text field to
          the flight keys, so W/A/S/D and L would stop working after a click. */}
      <div className="text-white/40 mb-1" id="plume-label">ENGINE PLUME</div>
      <div role="radiogroup" aria-labelledby="plume-label" className="flex flex-wrap gap-2">
        {Object.entries(PLUME_COLORS).map(([id, c]) => {
          const allowed = plumeAllowed(id, progress, hasPlumeColour);
          const badge = LOGBOOK.find((e) => e.id === id);
          return (
            <button key={id} type="button" role="radio" aria-checked={plumeColor === id} disabled={!allowed}
              data-testid={`plume-${id}`}
              aria-label={allowed ? `${c.name} plume` : `${c.name} plume, locked: earn ${badge?.title ?? id}`}
              title={allowed ? c.name : `Earn ${badge?.title ?? id} to unlock`}
              onClick={() => useSpaceStore.getState().setPlumeColor(id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border outline-none focus-visible:ring-1 focus-visible:ring-primary ${plumeColor === id ? "border-primary/60" : "border-white/10"} ${allowed ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}>
              <span aria-hidden="true" className="w-3 h-3 rounded-full" style={{ backgroundColor: c.hex }} />
              <span aria-hidden="true">{c.name}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 text-white/30">CLOSE: L / ESC</div>
    </div>
  );
}
