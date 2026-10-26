import type { CareerEntry } from "../data/career";
import type { Content, Project } from "../data/content";
import { BODY_IDS, MOON_IDS } from "../data/bodyIds";
import { ASTEROID_COLLIDERS, SUN_COLLIDER } from "../data/asteroids";
import { GATE_SCAN_ID } from "../data/dormantGate";

/**
 * Validates GET /content (beacon-api/src/content.ts) row by row (spec
 * 2026-10-23-dynamic-content, decision 5). The owner edits these rows by hand
 * in the D1 console, so a typo must cost one row, never the page: a bad row is
 * dropped with a console.warn, and a list with no valid row falls back to the
 * bundled one. Import-light: main.tsx runs this before the app's modules load.
 */

/**
 * The destination ids (data/destinations.ts RESERVED_ZONE_IDS), repeated here
 * because importing that table would load constants.ts, which reads the
 * content before it is settled. tests/contentParse.test.ts keeps them equal.
 */
export const DESTINATION_IDS: readonly string[] = ["career", "shipyard", "contact"];
/** The logbook's badge ids (utils/logbook.ts): a project's dossier entry shares their id space. Kept equal by the same test. */
export const BADGE_IDS: readonly string[] = ["slingshot", "comet", "ring", "ore", "convoy", "shards", "nest"];
/**
 * The comets' scan ids (data/smallBodyField.ts COMET_SCAN_IDS), repeated
 * because that module loads the ephemeris, which loads constants.ts. Kept
 * equal by tests/contentParse.test.ts.
 */
export const COMET_IDS: readonly string[] = ["comet_2p", "comet_67p"];

/**
 * Every id a project id would collide with: a probe id keys a scannable, a
 * radio zone pool, a jump target and a logbook entry, beside these. Derived
 * from the import-free source constants where there are some.
 */
export const RESERVED_IDS: ReadonlySet<string> = new Set<string>([
  ...DESTINATION_IDS, ...BADGE_IDS, ...BODY_IDS, ...MOON_IDS, ...COMET_IDS,
  ...ASTEROID_COLLIDERS.map((a) => a.id), SUN_COLLIDER.id, GATE_SCAN_ID,
  // The sun's well (utils/gravityWell.ts SUN_WELL_ID), the creature, the race's start gate (utils/raceScene.ts), the visiting comet, the Nest.
  "sun", "jellyfish", "race_start", "comet_visitor", "the_nest",
]);
/** Families of generated scan ids: buoys (career_<n>), bottles (and the old beacons), live-sky ghosts, comets, scenery asteroids. */
export const RESERVED_PREFIXES: readonly string[] = ["career_", "bottle_", "beacon_", "ghost_", "comet_", "asteroid_"];

/** True when a project may not take this id. */
export const isReservedId = (id: string): boolean => RESERVED_IDS.has(id) || RESERVED_PREFIXES.some((p) => id.startsWith(p));

/** A probe id: it keys localStorage, scannables and the HUD row, so a short slug. */
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const COLOUR_RE = /^#[0-9a-f]{6}$/i;
/** startKey (data/careerTrail.ts) reads these: "Mon YYYY". */
const DATE_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/;
const EMPLOYMENT: readonly string[] = ["Full-time", "Contract"];

type Row = Record<string, unknown>;
type Warn = (msg: string) => void;

const isRow = (v: unknown): v is Row => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
/**
 * D1 sends NULL for an absent optional column, the bundled files leave the key
 * out, and the D1 console may leave a cleared cell as '' or spaces: all absent.
 */
const absent = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** `tech` is JSON-array TEXT in D1 and an array in projects.json; either must give non-empty strings. */
function techList(v: unknown): string[] | null {
  let list: unknown = v;
  if (typeof v === "string") {
    try { list = JSON.parse(v); } catch { return null; }
  }
  if (!Array.isArray(list) || list.length === 0 || !list.every(text)) return null;
  return list as string[];
}

function projectProblem(r: Row, seen: ReadonlySet<string>): string | null {
  if (typeof r.id !== "string" || !ID_RE.test(r.id)) return "id must be a lower-case slug (a-z, 0-9, - or _)";
  if (seen.has(r.id)) return "a project with this id came earlier";
  if (isReservedId(r.id)) return "id is taken by a destination, a logbook badge, a planet, a moon or another scannable";
  for (const f of ["title", "role", "duration", "short", "description"] as const) if (!text(r[f])) return `${f} must be non-empty text`;
  if (typeof r.color !== "string" || !COLOUR_RE.test(r.color)) return "color must be #rrggbb";
  if (!techList(r.tech)) return "tech must be a JSON array of non-empty strings, e.g. [\"React\",\"TypeScript\"]";
  if (!absent(r.repo) && !(typeof r.repo === "string" && /^https:\/\/\S+$/.test(r.repo))) return "repo must be NULL or an https:// URL";
  return null;
}

function careerProblem(r: Row): string | null {
  for (const f of ["role", "company", "location", "summary"] as const) if (!text(r[f])) return `${f} must be non-empty text`;
  if (typeof r.start !== "string" || !DATE_RE.test(r.start)) return "start must read like \"Nov 2020\"";
  if (!absent(r.end) && !(typeof r.end === "string" && DATE_RE.test(r.end))) return "end must be NULL (current role) or read like \"Apr 2022\"";
  if (typeof r.employment !== "string" || !EMPLOYMENT.includes(r.employment)) return "employment must be Full-time or Contract";
  if (!absent(r.note) && typeof r.note !== "string") return "note must be NULL or text";
  return null;
}

const label = (r: unknown, i: number) => (isRow(r) && typeof r.id !== "undefined" ? `${i} (id ${String(r.id)})` : String(i));

function parseProjects(raw: unknown, warn: Warn): Project[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Project[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const problem = isRow(r) ? projectProblem(r, seen) : "not an object";
    if (problem) { warn(`content: dropped project row ${label(r, i)}: ${problem}`); return; }
    const row = r as Row;
    const p: Project = {
      id: row.id as string, title: row.title as string, role: row.role as string, duration: row.duration as string,
      short: row.short as string, description: row.description as string, tech: techList(row.tech)!, color: row.color as string,
    };
    if (!absent(row.repo)) p.repo = row.repo as string;
    seen.add(p.id);
    out.push(p);
  });
  return out.length ? out : null;
}

function parseCareer(raw: unknown, warn: Warn): CareerEntry[] | null {
  if (!Array.isArray(raw)) return null;
  const out: CareerEntry[] = [];
  raw.forEach((r, i) => {
    const problem = isRow(r) ? careerProblem(r) : "not an object";
    if (problem) { warn(`content: dropped career row ${label(r, i)}: ${problem}`); return; }
    const row = r as Row;
    const e: CareerEntry = {
      role: row.role as string, company: row.company as string, start: row.start as string,
      employment: row.employment as CareerEntry["employment"], location: row.location as string, summary: row.summary as string,
    };
    if (!absent(row.note)) e.note = row.note as string;
    if (!absent(row.end)) e.end = row.end as string;
    out.push(e);
  });
  return out.length ? out : null;
}

/** Each list's valid rows, in the order given, or null when none is valid (or the list is missing). */
export function parseContent(raw: unknown, warn: Warn = console.warn): { projects: Project[] | null; career: CareerEntry[] | null } {
  const body = isRow(raw) ? raw : {};
  return { projects: parseProjects(body.projects, warn), career: parseCareer(body.career, warn) };
}

/**
 * The content to use for a response: each list from the response when it has
 * a valid row, else from `fallback`. `usable` is false when neither list came
 * from the response (it is then just the fallback).
 */
export function resolveContent(raw: unknown, fallback: Content, warn: Warn = console.warn): { content: Content; usable: boolean } {
  const { projects, career } = parseContent(raw, warn);
  if (!projects) warn("content: no valid project rows; using the bundled projects");
  if (!career) warn("content: no valid career rows; using the bundled career");
  return {
    content: { projects: projects ?? fallback.projects, career: career ?? fallback.career },
    usable: projects !== null || career !== null,
  };
}
