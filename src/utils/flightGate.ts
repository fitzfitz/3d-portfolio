/**
 * Whether this visit flies at all: a WebGL context, and no résumé link. Moved
 * out of spaceStore so main.tsx can decide to start the asset packs before the
 * store (which reads the settled content) is loaded. Import-free.
 */

/**
 * Whether this browser can create a WebGL context at all. Without one the 3D
 * scene cannot run, so the visitor starts on the classic résumé instead of a
 * blank page. Never throws: a blocked or broken canvas counts as "no".
 */
export function hasWebGL(doc: Document | undefined = typeof document !== "undefined" ? document : undefined): boolean {
  try {
    if (!doc) return false;
    const c = doc.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * True when the URL asks for the résumé directly (`?cv`, `?resume`, `#cv`,
 * `#resume`) — a link a visitor can be sent that skips the flight entirely.
 */
export function wantsResume(loc: { search: string; hash: string } | undefined =
  typeof window !== "undefined" ? window.location : undefined): boolean {
  if (!loc) return false;
  const q = new URLSearchParams(loc.search);
  return q.has("cv") || q.has("resume") || /^#(cv|resume)$/i.test(loc.hash);
}

/**
 * The invite code of a `?race=CODE` link (the shape raceProtocol's
 * isInviteCode accepts: six characters without the look-alikes), or null. The
 * ship then starts on the race grid instead of the spawn pad (flightState.ts).
 * Import-free like the rest of this file, so the pattern is repeated here
 * (tests/raceHud.test.tsx keeps the two in step).
 */
export function raceLinkCode(loc: { search: string } | undefined =
  typeof window !== "undefined" ? window.location : undefined): string | null {
  if (!loc) return null;
  const code = new URLSearchParams(loc.search).get("race");
  return code !== null && /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(code) ? code : null;
}

/** Probed once at import: each probe creates a throwaway WebGL context. */
export const WEBGL_AVAILABLE = hasWebGL();

/** The canvas mounts on the first render exactly when this holds (spaceStore `showClassicCV`'s start value). */
export const FLIES_AT_START = WEBGL_AVAILABLE && !wantsResume();
