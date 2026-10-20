import { useEffect, useMemo, useRef } from "react";
import { Lock, Check, X } from "lucide-react";
import { useSpaceStore, selectModalOpen } from "../../store/spaceStore";
import { LOGBOOK, entryDone, isDossierEntry, logbookCount, type LogbookProgress } from "../../utils/logbook";
import { PLUME_COLORS } from "../../data/plumeColors";
import { jumpKey } from "../../data/destinations";
import { liveSkyUrl } from "../../utils/liveSky";
import { ORRERY_NOTE } from "../../utils/realUnits";
import { WORLDS, WORLD_COUNT } from "../../data/worlds";
import { isCartographer } from "../../utils/charting";
import { reopenDossier } from "./reopenDossier";
import SystemChart from "../dom/SystemChart";

const LIVE_SKY_ENABLED = !!liveSkyUrl();

/**
 * The pilot logbook (spec §4.3): a non-modal sheet (flight keeps running)
 * listing essentials and flight badges, the system chart and the worlds
 * charted, with a pointer to the shipyard's plume picker. Esc closes it;
 * focus moves to its heading on open and back to the opener on close. It
 * closes itself when a dossier opens, photo mode starts or the résumé opens.
 */
export default function LogbookPanel() {
  const open = useSpaceStore((s) => s.logbookOpen);
  const badges = useSpaceStore((s) => s.badges);
  const visitedDossiers = useSpaceStore((s) => s.visitedDossiers);
  const shardsCollected = useSpaceStore((s) => s.shardsCollected);
  const plumeColor = useSpaceStore((s) => s.plumeColor);
  const modalOpen = useSpaceStore(selectModalOpen);
  const photoMode = useSpaceStore((s) => s.photoMode);
  const showClassicCV = useSpaceStore((s) => s.showClassicCV);
  const liveSky = useSpaceStore((s) => s.liveSky);
  const charted = useSpaceStore((s) => s.charted);
  const chartedIds = useMemo(() => new Set(charted.map((c) => c.id)), [charted]);
  const progress = useMemo<LogbookProgress>(
    () => ({ badges, visitedDossiers, shardsCollected }), [badges, visitedDossiers, shardsCollected]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && (modalOpen || photoMode || showClassicCV)) useSpaceStore.getState().setLogbookOpen(false);
  }, [open, modalOpen, photoMode, showClassicCV]);

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
      if (!selectModalOpen(s) && !s.photoMode && !s.showClassicCV) opener.current?.focus?.();
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
          {isDone && isDossierEntry(e.id) ? (
            <button type="button" data-testid={`logbook-reopen-${e.id}`}
              onClick={() => reopenDossier(e.id)}
              className="text-white underline decoration-white/30 underline-offset-2 hover:decoration-primary focus-visible:ring-1 focus-visible:ring-primary outline-none cursor-pointer text-left">
              {e.title}<span className="sr-only">, re-open</span>
            </button>
          ) : (
            <span className={isDone ? "text-white" : "text-white/60"}>{e.title}</span>
          )}
          <span className="sr-only">{isDone ? ", done." : ", not yet."}</span>
          <span className="block text-[9px] text-white/40">{isDone ? (at ? `EARNED ${at}` : "DONE") : e.hint}</span>
        </span>
        {swatch && <span aria-hidden="true" className="mt-1 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: swatch, opacity: isDone ? 1 : 0.3 }} />}
      </li>
    );
  });

  return (
    <div role="dialog" aria-modal="false" aria-labelledby="logbook-title" data-testid="logbook-panel"
      className="fixed z-[55] pointer-events-auto font-mono text-[10px] bg-[#07051a] shadow-2xl shadow-black/60 border border-white/10 overflow-y-auto
        inset-x-3 bottom-3 max-h-[70vh] rounded-2xl px-4 pb-4
        sm:inset-x-auto sm:right-6 sm:top-24 sm:bottom-auto sm:w-[380px] sm:max-h-[calc(100vh-8rem)]">
      {/* Sticky header: above the HUD (z-55 > HUD z-50), so its close button is
          always tappable, on phones too. */}
      <div className="sticky top-0 -mx-4 px-4 pt-4 pb-3 mb-1 bg-[#07051a] flex items-center justify-between gap-3">
        <h2 id="logbook-title" ref={headingRef} tabIndex={-1} className="text-primary text-xs outline-none">
          PILOT LOGBOOK{isCartographer(charted) && " · CARTOGRAPHER"}
        </h2>
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
      <div className="text-white/40 mb-1">SYSTEM CHART</div>
      <div className="mb-3"><SystemChart charted={chartedIds} /></div>
      <div className="text-white/40 mb-1">WORLDS CHARTED {charted.length}/{WORLD_COUNT}</div>
      <ul className="mb-3">
        {WORLDS.map((w) => {
          const at = charted.find((c) => c.id === w.id)?.at;
          return (
            <li key={w.id} data-testid={`logbook-world-${w.id}`} className="flex items-start gap-2 py-1">
              <span aria-hidden="true" className={`mt-0.5 ${at ? "text-primary" : "text-white/30"}`}>
                {at ? <Check className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              </span>
              <span className="flex-1">
                <span className={at ? "text-white" : "text-white/60"}>{w.name}{at && ` · ${w.namesake.toUpperCase()}-TYPE`}</span>
                <span className="sr-only">{at ? ", charted." : ", not yet."}</span>
                <span className="block text-[9px] text-white/40">{at ? `CHARTED ${at}` : w.hint.toUpperCase()}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="text-white/40" data-testid="logbook-plume-pointer">
        ENGINE PLUME: {PLUME_COLORS[plumeColor]?.name ?? PLUME_COLORS.stock.name} · CHANGE IT AT THE SHIPYARD [{jumpKey("shipyard")}]
      </div>
      {LIVE_SKY_ENABLED && (
        <>
          <div className="text-white/40 mt-3 mb-1" id="livesky-label">LIVE SKY</div>
          {/* A button, not a checkbox: a focused <input> would swallow the flight keys. */}
          <button type="button" role="switch" aria-checked={liveSky} aria-labelledby="livesky-label"
            aria-describedby="livesky-desc" data-testid="livesky-toggle"
            onClick={() => useSpaceStore.getState().setLiveSky(!liveSky)}
            className={`px-2 py-1 rounded-lg border outline-none focus-visible:ring-1 focus-visible:ring-primary cursor-pointer ${liveSky ? "border-primary/60 text-primary" : "border-white/10 text-white/60"}`}>
            {liveSky ? "ON" : "OFF"}
          </button>
          <p id="livesky-desc" className="mt-1 text-white/40">See other pilots flying now. They see your ship, plume, country and worlds charted.</p>
        </>
      )}
      <div className="text-white/40 mt-3 mb-1">THE UNIVERSE</div>
      <p className="mt-1 text-white/40" data-testid="logbook-universe-note">{ORRERY_NOTE}</p>
      <div className="mt-3 text-white/30">CLOSE: L / ESC</div>
    </div>
  );
}
