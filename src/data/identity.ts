/**
 * Single source of truth for personal identity. Every visitor-facing name,
 * address, and profile link resolves here — scattering them is what let
 * placeholders survive to production once already (see tests/identity.test.ts).
 */
export const identity = {
  /** Display name for <title>, og:title, and the footer byline. */
  name: "Fitzgeral",
  /** In-world handle, already used by the spawn banner. */
  callsign: "FITZGERAL_SYS",
  /** Public contact address. Also the mailto fallback target. */
  email: "fitzgeralmedia@gmail.com",
  github: "https://github.com",
  linkedin: "https://www.linkedin.com/in/fitzgeral/",
} as const;

/**
 * Fields of `identity` that are DELIBERATE placeholders, not forgotten ones.
 *
 * `github` has no personal profile path yet — the owner has not decided a
 * GitHub handle/repo layout — so the bare `https://github.com` domain is a
 * conscious stand-in until that's registered. Every other field is treated
 * as real and is held to the full standard (real email, path-bearing URL).
 *
 * tests/identity.test.ts scans all of src/ for bare github.com/linkedin.com
 * URLs and example.com emails; an occurrence only passes if it lives in this
 * file AND its field is listed here. Removing an entry from this set is the
 * deliberate act of shipping the real value — do that before publishing.
 */
export const KNOWN_PLACEHOLDERS: ReadonlySet<keyof typeof identity> = new Set(["github"]);
