import { useEffect } from "react";
import { useMediaQuery } from "./useMediaQuery";
import { useSpaceStore } from "../store/spaceStore";
import { resolveReducedMotion, REDUCED_MOTION_QUERY } from "../utils/reducedMotionPreference";

/**
 * Mount once in App. Keeps the store in step with the OS setting (which people
 * do toggle mid-session) unless the visitor has made an explicit choice, and
 * mirrors the result onto <html> so CSS rules can key off the manual toggle —
 * something a bare media query cannot do.
 */
export function useReducedMotion(): void {
  const queryMatches = useMediaQuery(REDUCED_MOTION_QUERY);
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const manual = useSpaceStore((s) => s.reducedMotionManual);
  const setReducedMotion = useSpaceStore((s) => s.setReducedMotion);

  useEffect(() => {
    if (manual) return; // an explicit choice wins
    const next = resolveReducedMotion(null, queryMatches);
    if (next !== useSpaceStore.getState().reducedMotion) setReducedMotion(next);
  }, [queryMatches, manual, setReducedMotion]);

  useEffect(() => {
    // "false" is a deliberate opt-out in CSS (index.css excludes it from the
    // media-query block), so it must only be written for an explicit manual
    // choice. Absent a choice, remove the attribute so the media query alone
    // governs — otherwise an OS-reduce visitor with nothing stored would have
    // "false" written first (useMediaQuery initialises false and only reads
    // the query inside an effect), un-neutralising the CSS for a render cycle.
    if (reducedMotion) {
      document.documentElement.setAttribute("data-reduced-motion", "true");
    } else if (manual) {
      document.documentElement.setAttribute("data-reduced-motion", "false");
    } else {
      document.documentElement.removeAttribute("data-reduced-motion");
    }
  }, [reducedMotion, manual]);
}
