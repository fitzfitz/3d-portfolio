export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const REDUCED_MOTION_KEY = "fitz-reduced-motion";

/**
 * An explicit choice always wins over the OS signal, which is blunt: it is set
 * for battery and mild preference as often as for a vestibular condition.
 * `null` means the visitor has not chosen, so the query decides.
 */
export function resolveReducedMotion(stored: boolean | null, queryMatches: boolean): boolean {
  return stored ?? queryMatches;
}
