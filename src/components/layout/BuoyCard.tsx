import { useEffect, useRef } from "react";
import { BUOYS, CAREER_AMBER } from "../../data/careerTrail";
import { buoyCardState } from "../../utils/buoyCard";
import { useSpaceStore } from "../../store/spaceStore";

/**
 * HUD card for the career buoy you are passing or just scanned: role,
 * company, dates and a one-line summary (spec §2). rAF + DOM writes, zero
 * renders, like WaypointMarker; text is rewritten only when the buoy changes.
 * Hidden from screen readers: the scan report (announced) and the Career
 * dossier carry the same text, and a second live region would compete with
 * the radio's.
 */
export default function BuoyCard() {
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const rootRef = useRef<HTMLDivElement>(null);
  const roleRef = useRef<HTMLDivElement>(null);
  const companyRef = useRef<HTMLSpanElement>(null);
  const datesRef = useRef<HTMLSpanElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let shown = -2; // forces the first write, including after a remount
    const tick = () => {
      const i = buoyCardState.index;
      const root = rootRef.current;
      if (root && i !== shown) {
        shown = i;
        root.dataset.index = String(i);
        root.style.opacity = i >= 0 ? "1" : "0";
        const e = BUOYS[i]?.entry;
        if (e) {
          if (roleRef.current) roleRef.current.textContent = e.role;
          if (companyRef.current) companyRef.current.textContent = e.note ? `${e.company} (${e.note})` : e.company;
          if (datesRef.current) datesRef.current.textContent = `${e.start} – ${e.end ?? "Present"}`;
          if (summaryRef.current) summaryRef.current.textContent = e.summary;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={rootRef} data-testid="buoy-card" data-index="-1" aria-hidden="true"
      className={`absolute bottom-[17rem] left-1/2 -translate-x-1/2 w-[min(92vw,26rem)] rounded-xl border bg-black/80 px-4 py-3 pointer-events-none ${reducedMotion ? "" : "transition-opacity duration-300"}`}
      style={{ borderColor: `${CAREER_AMBER}55`, opacity: 0 }}>
      <div className="text-[9px] tracking-widest mb-1" style={{ color: CAREER_AMBER }}>CAREER_BUOY</div>
      <div ref={roleRef} className="font-display font-bold text-sm text-white" />
      <div className="flex justify-between gap-3 text-[10px] text-white/70">
        <span ref={companyRef} />
        <span ref={datesRef} className="text-white/50 whitespace-nowrap" />
      </div>
      <div ref={summaryRef} className="text-[10px] text-white/60 truncate mt-1" />
    </div>
  );
}
