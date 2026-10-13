import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useSpaceStore } from "../../store/spaceStore";
import { CHANGELOG, PR_URL } from "../../data/changelog";

/**
 * Patch notes (spec §8.3): a non-modal sheet like the logbook. Each entry
 * answers WHAT, WHY, WHEN and HOW. Opening it marks the newest entry seen.
 * It closes itself when a dossier opens, photo mode starts or the résumé opens.
 */
export default function ChangelogPanel() {
  const open = useSpaceStore((s) => s.changelogOpen);
  const isOrbitLocked = useSpaceStore((s) => s.isOrbitLocked);
  const photoMode = useSpaceStore((s) => s.photoMode);
  const showClassicCV = useSpaceStore((s) => s.showClassicCV);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && (isOrbitLocked || photoMode || showClassicCV)) useSpaceStore.getState().setChangelogOpen(false);
  }, [open, isOrbitLocked, photoMode, showClassicCV]);

  useEffect(() => {
    if (!open) return;
    useSpaceStore.getState().markChangelogSeen();
    opener.current = document.activeElement as HTMLElement | null;
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") useSpaceStore.getState().setChangelogOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Only on the visitor's own close (see LogbookPanel).
      const s = useSpaceStore.getState();
      if (!s.isOrbitLocked && !s.photoMode && !s.showClassicCV) opener.current?.focus?.();
    };
  }, [open]);

  if (!open || photoMode || showClassicCV) return null;
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="changelog-title" data-testid="changelog-panel"
      className="fixed z-[55] pointer-events-auto font-mono text-[10px] glass-card bg-black/90 border border-white/10 overflow-y-auto
        inset-x-3 bottom-3 max-h-[70vh] rounded-2xl px-4 pb-4
        sm:inset-x-auto sm:right-6 sm:top-24 sm:bottom-auto sm:w-[420px] sm:max-h-[calc(100vh-8rem)]">
      <div className="sticky top-0 -mx-4 px-4 pt-4 pb-3 mb-1 bg-black/95 flex items-center justify-between gap-3">
        <h2 id="changelog-title" ref={headingRef} tabIndex={-1} className="text-primary text-xs outline-none">PATCH NOTES</h2>
        <span className="ml-auto text-white/40">{CHANGELOG.length} UPDATES</span>
        <button type="button" data-testid="changelog-close" aria-label="Close patch notes"
          onClick={() => useSpaceStore.getState().setChangelogOpen(false)}
          className="p-2 -m-1 rounded-lg text-white/60 hover:text-white focus-visible:ring-1 focus-visible:ring-primary outline-none">
          <X className="w-4 h-4" />
        </button>
      </div>
      {CHANGELOG.map((e) => (
        <article key={e.id} data-testid="changelog-entry" className="py-3 border-t border-white/5 first:border-t-0">
          <h3 className="text-white text-[11px] mb-1.5">{e.title.toUpperCase()}</h3>
          <dl className="grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-1 leading-relaxed">
            <dt className="text-white/40">WHAT</dt><dd className="text-white/80">{e.what}</dd>
            <dt className="text-white/40">WHY</dt><dd className="text-white/70">{e.why}</dd>
            <dt className="text-white/40">WHEN</dt>
            <dd className="text-white/70">
              {e.date} · <a href={`${PR_URL}${e.pr}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">PR #{e.pr}</a>
            </dd>
            <dt className="text-white/40">HOW</dt><dd className="text-white/70">{e.how}</dd>
          </dl>
        </article>
      ))}
      <div className="mt-2 text-white/30">CLOSE: N / ESC</div>
    </div>
  );
}
