import { career, type CareerEntry } from "./career";

/**
 * Career landmarks (docs/superpowers/specs/2026-10-15-career-landmarks-design.md §1):
 * the station you dock at for the Career dossier, and five buoys, one per job,
 * oldest first, on a trail from the spawn pad down to it. The scene and
 * tests/careerTrail.test.ts read these same numbers.
 */
export type Vec3 = readonly [number, number, number];

/**
 * Below the orbital plane, mirroring the portal above it. The spec's target
 * was (0, -95, 150), but the portfolio planet's orbit (with its moons) passes
 * 35.7 units from that point. This is the nearest point on x = 0 that clears
 * it (tests/careerTrail.test.ts).
 */
export const STATION_POS: Vec3 = [0, -108, 156];

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
 * TRAIL_END. It starts about 45 units from the spawn pad, stays 60+
 * units from the sun along its whole length, and sweeps down through the
 * orbital plane to the station. The buoys sit at equal angles along it, about
 * 77 apart (the real Earth and Mars wells leave no clear buoy spots nearer the
 * plane, so the first moved up and the spacing opened from 50; tests/solarClearance.test.ts).
 */
export const TRAIL_START: Vec3 = [-32, 80, 85];
export const TRAIL_BEND: Vec3 = [-40, 48, 208];
export const TRAIL_END: Vec3 = [-11, -104, 178];

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

/** One buoy per job, oldest first, at equal steps along the trail arc. */
export const BUOYS: readonly Buoy[] = [...career]
  .sort((a, b) => startKey(a) - startKey(b))
  .map((entry, i, all) => ({
    id: `career_${i}`,
    label: `CAREER_${entry.start.slice(-4)}`,
    pos: arcPoint(TRAIL_ARC, all.length > 1 ? i / (all.length - 1) : 0),
    entry,
  }));

export const BUOY_POSITIONS: readonly Vec3[] = BUOYS.map((b) => b.pos);
