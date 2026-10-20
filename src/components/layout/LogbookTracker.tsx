import { useEffect, useMemo, useRef, useState } from "react";
import { useSpaceStore } from "../../store/spaceStore";
import { logbookCount, nextGoal, milestoneFor, ALL_LINE, type LogbookProgress } from "../../utils/logbook";
import { isCartographer } from "../../utils/charting";
import { BODY_COUNT } from "../../data/solarSystem";
import { soundManager } from "../../audio/soundManager";

const TOUR_LINE = "TOUR COMPLETE // THE PILOT'S RÉSUMÉ AND CONTACT ARE ONE CLICK AWAY";

/**
 * HUD line: progress and the next goal (spec §4.1). Re-renders only when
 * progress changes. Also fires the two milestones, once, and only on a
 * transition during this visit: a returning visitor's stored progress is the
 * starting point, never an announcement. The worlds charted ride along as a
 * suffix, outside the 11, with the CARTOGRAPHER title once all are.
 */
export default function LogbookTracker() {
  const badges = useSpaceStore((s) => s.badges);
  const visitedDossiers = useSpaceStore((s) => s.visitedDossiers);
  const shardsCollected = useSpaceStore((s) => s.shardsCollected);
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const charted = useSpaceStore((s) => s.charted);
  const progress = useMemo<LogbookProgress>(
    () => ({ badges, visitedDossiers, shardsCollected }), [badges, visitedDossiers, shardsCollected]);
  const { done, total } = logbookCount(progress);
  const goal = nextGoal(progress);

  // Previous progress, for the pulse and the milestones.
  const prev = useRef(progress);
  const [pulse, setPulse] = useState(false);
  // The pulse timer lives in a ref, not an effect cleanup: a later progress
  // change (a 4th shard, a reduced-motion toggle) must not cancel the timer
  // that ends the pulse, or the tracker would pulse for the rest of the visit.
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pulseTimer.current) clearTimeout(pulseTimer.current); }, []);
  useEffect(() => {
    const was = prev.current;
    prev.current = progress;
    if (was === progress) return;
    // Milestones queue behind the badge line that triggered them (announceLogbook).
    const m = milestoneFor(was, progress);
    if (m === "all") { soundManager.fanfare(); useSpaceStore.getState().announceLogbook(ALL_LINE); }
    else if (m === "essentials") useSpaceStore.getState().announceLogbook(TOUR_LINE);
    if (logbookCount(progress).done > logbookCount(was).done && !reducedMotion) {
      setPulse(true);
      if (pulseTimer.current) clearTimeout(pulseTimer.current);
      pulseTimer.current = setTimeout(() => setPulse(false), 1500);
    }
  }, [progress, reducedMotion]);

  const complete = goal === null;
  const cartographer = isCartographer(charted);
  const worlds = `WORLDS ${charted.length}/${BODY_COUNT}`;
  return (
    <button type="button" data-testid="logbook-tracker"
      onClick={() => useSpaceStore.getState().setLogbookOpen(true)}
      aria-label={`${complete ? `Logbook complete, ${done} of ${total}.` : `Logbook ${done} of ${total}. Next: ${goal.title}.`} Worlds charted ${charted.length} of ${BODY_COUNT}${cartographer ? ", cartographer" : ""}. Open logbook`}
      className={`pointer-events-auto text-left cursor-pointer hover:text-white transition-colors ${complete ? "text-accent" : "text-white/70"} ${pulse ? "animate-pulse text-primary" : ""}`}>
      <span className="hidden sm:inline">LOGBOOK {done}/{total}</span>
      <span className="sm:hidden">LOG {done}/{total}</span>
      {complete
        ? <span> // COMPLETE</span>
        : <>
            <span className="hidden sm:inline">  &gt; NEXT: {goal.hint}</span>
            <span className="sm:hidden"> &gt; {goal.hintShort}</span>
          </>}
      <span data-testid="logbook-tracker-worlds"> · {worlds}{cartographer && <span className="hidden sm:inline"> · CARTOGRAPHER</span>}</span>
    </button>
  );
}
