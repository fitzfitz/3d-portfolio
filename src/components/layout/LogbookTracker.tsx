import { useEffect, useMemo, useRef, useState } from "react";
import { useSpaceStore } from "../../store/spaceStore";
import { logbookCount, nextGoal, milestoneFor, type LogbookProgress } from "../../utils/logbook";
import { soundManager } from "../../audio/soundManager";

const TOUR_LINE = "TOUR COMPLETE // THE PILOT'S RÉSUMÉ AND CONTACT ARE ONE CLICK AWAY";
const ALL_LINE = "LOGBOOK COMPLETE // ALL PLUMES UNLOCKED. FLY PRETTY, PILOT";

/**
 * HUD line: progress and the next goal (spec §4.1). Re-renders only when
 * progress changes. Also fires the two milestones, once, and only on a
 * transition during this visit: a returning visitor's stored progress is the
 * starting point, never an announcement.
 */
export default function LogbookTracker() {
  const badges = useSpaceStore((s) => s.badges);
  const visitedDossiers = useSpaceStore((s) => s.visitedDossiers);
  const shardsCollected = useSpaceStore((s) => s.shardsCollected);
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const progress = useMemo<LogbookProgress>(
    () => ({ badges, visitedDossiers, shardsCollected }), [badges, visitedDossiers, shardsCollected]);
  const { done, total } = logbookCount(progress);
  const goal = nextGoal(progress);

  // Previous progress, for the pulse and the milestones.
  const prev = useRef(progress);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = progress;
    if (was === progress) return;
    const m = milestoneFor(was, progress);
    if (m === "all") { soundManager.fanfare(); useSpaceStore.getState().sendBroadcast(ALL_LINE); }
    else if (m === "essentials") useSpaceStore.getState().sendBroadcast(TOUR_LINE);
    if (logbookCount(progress).done > logbookCount(was).done && !reducedMotion) {
      setPulse(true);
      const id = setTimeout(() => setPulse(false), 1500);
      return () => clearTimeout(id);
    }
  }, [progress, reducedMotion]);

  const complete = goal === null;
  return (
    <button type="button" data-testid="logbook-tracker"
      onClick={() => useSpaceStore.getState().setLogbookOpen(true)}
      aria-label={complete ? `Logbook complete, ${done} of ${total}. Open logbook` : `Logbook ${done} of ${total}. Next: ${goal.title}. Open logbook`}
      className={`pointer-events-auto text-left cursor-pointer hover:text-white transition-colors ${complete ? "text-accent" : "text-white/70"} ${pulse ? "animate-pulse text-primary" : ""}`}>
      <span className="hidden sm:inline">LOGBOOK {done}/{total}</span>
      <span className="sm:hidden">LOG {done}/{total}</span>
      {complete
        ? <span> // COMPLETE</span>
        : <>
            <span className="hidden sm:inline">  &gt; NEXT: {goal.hint}</span>
            <span className="sm:hidden"> &gt; {goal.hintShort}</span>
          </>}
    </button>
  );
}
