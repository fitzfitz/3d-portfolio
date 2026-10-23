import type { CareerEntry } from "./career";
import { activeContent } from "./content";

/**
 * Career landmarks (docs/superpowers/specs/2026-10-15-career-landmarks-design.md §1):
 * the station you dock at for the Career dossier, and a buoy per job (five in
 * the bundled list), oldest first, on a trail that climbs from the spawn pad up
 * to it. The buoys derive from the settled career list (src/data/content.ts,
 * 1 to MAX_BUOYS entries). The scene and tests/careerTrail.test.ts read these
 * same numbers.
 */
export type Vec3 = readonly [number, number, number];

/**
 * High above the orbital plane, at the top of the trail. Every planet, its
 * swept gravity well, the belt and the comets live near the plane, so the
 * station sits where none of them ever reaches (latitude ~51°, r 193; the
 * nearest rule is 33 u off, tests/careerTrail.test.ts). It was below the plane
 * at (0, -108, 156), but a trail down to it has to cross the plane, and inside
 * ~2 AU every near-plane spot is in Earth's or Mars's swept well.
 */
export const STATION_POS: Vec3 = [67, 152, -104];

/**
 * The portal's lock radii scaled for a model of radius ~5 (about 4x the
 * portal). jumpR parks a jump outside the model (radius ≤ 5.3) with the
 * whole ship clear of the hull too (model radius + the ship's half length,
 * tests/assetContracts.test.ts), and inside lockR, so it docks on arrival.
 */
export const STATION_RADII = { zoneR: 8.5, lockR: 7.2, retainR: 13, orbitR: 10, jumpR: 6.7 } as const;

/** The career landmarks' accent colour: station lights, buoy glow, radar, dossier. */
export const CAREER_AMBER = "#ffb547";

/** Flying within this distance of a buoy shows its HUD card. */
export const BUOY_CARD_R = 6;

/**
 * The trail is the circular arc from TRAIL_START through TRAIL_BEND to
 * TRAIL_END: a rising ramp out of the ecliptic. It starts about 40 units
 * ahead of the spawn pad, in the opening view, climbs from ~14° to ~33° as it
 * passes over the sun (never nearer than 60), and the station sits 20 on along
 * the same curve. Five buoys sit at equal angles along it, 43 apart (buildBuoys
 * for other counts). The whole
 * flight stays above every swept well and rock orbit, with no waivers
 * (tests/careerTrail.test.ts, tests/solarClearance.test.ts).
 */
export const TRAIL_START: Vec3 = [-37, 71, 32];
export const TRAIL_BEND: Vec3 = [14, 101, -43];
export const TRAIL_END: Vec3 = [56, 140, -93];

/** A circular arc: angle 0 at centre + radius·u, turning toward v, for `span` radians. n = u × v. */
export interface Arc { centre: Vec3; radius: number; u: Vec3; v: Vec3; n: Vec3; span: number }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** The circle through a, b and c, as the arc that starts at a and ends at c (passing b). */
export function arcThrough(a: Vec3, b: Vec3, c: Vec3): Arc {
  const ab = sub(b, a), ac = sub(c, a);
  const n = cross(ab, ac);
  const nn = dot(n, n);
  if (nn < 1e-9) throw new Error("arcThrough: the three points are collinear");
  const w = scale(sub(scale(cross(n, ab), dot(ac, ac)), scale(cross(n, ac), dot(ab, ab))), 1 / (2 * nn));
  const centre: Vec3 = [a[0] + w[0], a[1] + w[1], a[2] + w[2]];
  const u = unit(sub(a, centre));
  const nu = unit(n);
  const v = cross(nu, u);
  const rc = sub(c, centre);
  let span = Math.atan2(dot(rc, v), dot(rc, u));
  if (span <= 0) span += Math.PI * 2;
  return { centre, radius: Math.hypot(w[0], w[1], w[2]), u, v, n: nu, span };
}

/** The point a fraction t (0..1) of the way along the arc. */
export function arcPoint(arc: Arc, t: number): Vec3 {
  const th = arc.span * t;
  const c = Math.cos(th) * arc.radius, s = Math.sin(th) * arc.radius;
  return [
    arc.centre[0] + arc.u[0] * c + arc.v[0] * s,
    arc.centre[1] + arc.u[1] * c + arc.v[1] * s,
    arc.centre[2] + arc.u[2] * c + arc.v[2] * s,
  ];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Sort key for a "Mon YYYY" start date. */
export function startKey(e: CareerEntry): number {
  const [mon, year] = e.start.split(" ");
  const m = MONTHS.indexOf(mon);
  if (m < 0 || !/^\d{4}$/.test(year ?? "")) throw new Error(`careerTrail: unreadable start date "${e.start}"`);
  return Number(year) * 12 + m;
}

export const TRAIL_ARC: Arc = arcThrough(TRAIL_START, TRAIL_BEND, TRAIL_END);

export interface Buoy { id: string; label: string; pos: Vec3; entry: CareerEntry }

/** Buoys the trail holds: twelve jobs put them ~15.6 u apart, still clear of each other's 6 u cards. */
export const MAX_BUOYS = 12;
/**
 * The fewest steps the arc is cut into. Five jobs fill it at today's 43 u
 * (a buoy reads from the next one there, CareerTrail BUOY_SCALE); fewer keep
 * that step and stop short of the arc's end, the dashed guide still running
 * on to the station, instead of spreading past the 50 u the trail allows.
 */
export const MIN_TRAIL_STEPS = 4;

/** Where along the arc (0..1) buoy i of n sits (spec 2026-10-23-dynamic-content, build ruling R7). */
export function buoyFraction(i: number, n: number): number {
  return n > 1 ? i / Math.max(n - 1, MIN_TRAIL_STEPS) : 0;
}

/**
 * One buoy per job, oldest first, at equal steps along the trail arc. Past
 * MAX_BUOYS the newest MAX_BUOYS get buoys (the résumé still lists them all).
 */
export function buildBuoys(career: readonly CareerEntry[], warn: (msg: string) => void = console.warn): Buoy[] {
  const sorted = [...career].sort((a, b) => startKey(a) - startKey(b));
  if (sorted.length > MAX_BUOYS) {
    warn(`careerTrail: ${sorted.length} career entries, the trail holds ${MAX_BUOYS}; the oldest ${sorted.length - MAX_BUOYS} get no buoy (the résumé still lists them)`);
  }
  const kept = sorted.slice(-MAX_BUOYS);
  return kept.map((entry, i) => ({
    id: `career_${i}`,
    label: `CAREER_${entry.start.slice(-4)}`,
    pos: arcPoint(TRAIL_ARC, buoyFraction(i, kept.length)),
    entry,
  }));
}

/** Every position a buoy can take for 1 to MAX_BUOYS jobs: what the clearance tests hold to. */
export function possibleBuoyPositions(): Vec3[] {
  const fractions = new Set<number>();
  for (let n = 1; n <= MAX_BUOYS; n++) for (let i = 0; i < n; i++) fractions.add(buoyFraction(i, n));
  return [...fractions].sort((a, b) => a - b).map((t) => arcPoint(TRAIL_ARC, t));
}

/** This visit's buoys, from the settled career list. */
export const BUOYS: readonly Buoy[] = buildBuoys(activeContent().career);

export const BUOY_POSITIONS: readonly Vec3[] = BUOYS.map((b) => b.pos);
