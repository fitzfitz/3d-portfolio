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
    document.documentElement.setAttribute("data-reduced-motion", reducedMotion ? "true" : "false");
  }, [reducedMotion]);
}
