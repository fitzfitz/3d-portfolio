/**
 * Single source of truth for personal identity. Every visitor-facing name,
 * address, and profile link resolves here — scattering them is what let
 * placeholders survive to production once already (see tests/identity.test.ts).
 */
export const identity = {
  /**
   * Display name for the footer byline (Footer.tsx). NOTE: index.html's
   * <title>, og:title/og:site_name, and twitter:title are plain static HTML
   * — they load before any JS bundle and cannot import this TS module — so
   * they must be kept in sync with this value by hand, not by import.
   */
  name: "Fitzgeral",
  /** In-world handle shown in the spawn banner's "PILOT:" line (App.tsx). */
  callsign: "FITZGERAL_SYS",
  /** Public contact address. Also the mailto fallback target. */
  email: "fitzgeralmedia@gmail.com",
  /**
   * Profile, not the 3d-portfolio repo: it is the fallback target for any
   * project whose own `repo` field is empty (App.tsx, Experience.tsx), where
   * "see my other work" is the useful destination.
   */
  github: "https://github.com/fitzfitz",
  linkedin: "https://www.linkedin.com/in/fitzgeral/",
} as const;

/**
 * Fields of `identity` that are DELIBERATE placeholders, not forgotten ones.
 *
 * **Currently empty — every field above is real.** `github` was the last
 * entry; it held the bare `https://github.com` domain while the owner had not
 * settled a handle. The handle is `fitzfitz` (it owns the repo this site
 * deploys from), so the real profile URL shipped and the entry was removed.
 *
 * Keep the set rather than deleting it: it is the declaration channel for any
 * future placeholder, and tests/identity.test.ts is written against it.
 *
 * tests/identity.test.ts scans all of src/ for bare github.com/linkedin.com
 * URLs and example.com emails; an occurrence only passes if it lives in this
 * file AND its field is listed here. Adding an entry is how you declare a
 * deliberate stand-in; removing one is the deliberate act of shipping the
 * real value.
 */
export const KNOWN_PLACEHOLDERS: ReadonlySet<keyof typeof identity> = new Set<keyof typeof identity>();
