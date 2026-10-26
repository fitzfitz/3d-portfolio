/**
 * FROZEN copy of the old site's response parser: `parseBeacons` from
 * src/utils/beacons.ts on main at 061f9a1, before messages in bottles. Do not
 * update it to match the current client. It stands in for a cached old page
 * still running in a visitor's browser while the new Worker is live (spec
 * docs/superpowers/specs/2026-10-26-message-bottles-design.md, deploy order:
 * the Worker ships before the site). tests/legacyBeaconCompat.test.ts feeds it
 * the new Worker's output.
 *
 * Its constants are inlined as they were at that commit, so a later change to
 * the live ones cannot quietly change what this old client accepts.
 */

/** BEACON_PHRASES.length at 061f9a1. */
const PHRASE_COUNT = 9;
/** VALIDATION_RADIUS at 061f9a1 (src/constants.ts). */
const VALIDATION_RADIUS = 3800;
/** BEACON_LIMIT at 061f9a1. */
const BEACON_LIMIT = 40;

export interface LegacyBeacon {
  id: string;
  x: number; y: number; z: number;
  phrase: number;
  at: number;
  country: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCoord = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inBounds = (x: number, y: number, z: number) => Math.hypot(x, y, z) <= VALIDATION_RADIUS;
const isPhrase = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < PHRASE_COUNT;

const ID_RE = /^[a-zA-Z0-9-]{1,64}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

export function legacyParseBeacons(body: unknown): LegacyBeacon[] {
  if (!isObj(body) || !Array.isArray(body.beacons)) return [];
  const out: LegacyBeacon[] = [];
  for (const r of body.beacons) {
    if (out.length >= BEACON_LIMIT) break;
    if (!isObj(r)) continue;
    const { id, x, y, z, phrase, at, country } = r;
    if (typeof id !== "string" || !ID_RE.test(id)) continue;
    if (!isCoord(x) || !isCoord(y) || !isCoord(z) || !inBounds(x, y, z) || !isPhrase(phrase)) continue;
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    if (country !== null && (typeof country !== "string" || !COUNTRY_RE.test(country))) continue;
    out.push({ id, x, y, z, phrase, at, country });
  }
  return out;
}
