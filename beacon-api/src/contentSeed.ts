import type { CareerEntry } from "../../src/data/career";
import type { Project } from "../../src/data/content";

/**
 * The seed for the content tables (beacon-api/content.sql), generated from the
 * bundled data so D1 starts identical to the site. scripts/content-seed.mjs
 * writes it to beacon-api/content-seed.sql (`npm run content:seed`), and
 * tests/contentSeed.test.ts fails when the committed file drifts from the
 * bundled data. Type imports only: Node runs this with --experimental-strip-types.
 */

/** Gaps of 10, so a row can go between two others without renumbering (spec build ruling R4). */
export const SORT_STEP = 10;

type Value = string | number | null;
export interface SeedRows {
  projects: Record<string, Value>[];
  career: Record<string, Value>[];
}

export const PROJECT_COLUMNS = ["id", "sort", "title", "role", "duration", "short", "description", "tech", "color", "repo"] as const;
export const CAREER_COLUMNS = ["id", "sort", "role", "company", "note", "start", "end", "employment", "location", "summary"] as const;

/** The rows as D1 stores them (and GET /content returns them): tech as JSON text, NULL for an absent field. */
export function contentSeedRows(projects: readonly Project[], career: readonly CareerEntry[]): SeedRows {
  return {
    projects: projects.map((p, i) => ({
      id: p.id, sort: (i + 1) * SORT_STEP, title: p.title, role: p.role, duration: p.duration, short: p.short,
      description: p.description, tech: JSON.stringify(p.tech), color: p.color, repo: p.repo ?? null,
    })),
    career: career.map((c, i) => ({
      id: i + 1, sort: (i + 1) * SORT_STEP, role: c.role, company: c.company, note: c.note ?? null, start: c.start,
      end: c.end ?? null, employment: c.employment, location: c.location, summary: c.summary,
    })),
  };
}

const sql = (v: Value): string => (v === null ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`);
/** SQLite quotes an identifier in double quotes; `end` is a keyword. */
const col = (c: string): string => (c === "end" ? '"end"' : c);

function insert(table: string, columns: readonly string[], rows: readonly Record<string, Value>[]): string {
  const values = rows.map((r) => `  (${columns.map((c) => sql(r[c])).join(", ")})`).join(",\n");
  return `INSERT OR IGNORE INTO ${table} (${columns.map(col).join(", ")}) VALUES\n${values};\n`;
}

export function contentSeedSql(projects: readonly Project[], career: readonly CareerEntry[]): string {
  const rows = contentSeedRows(projects, career);
  return [
    "-- The content tables' first rows, generated from src/data/projects.json and",
    "-- src/data/career.ts by scripts/content-seed.mjs (npm run content:seed). Do not",
    "-- edit by hand: tests/contentSeed.test.ts fails when it drifts from the bundled data.",
    "-- INSERT OR IGNORE never overwrites a row that is already there, so running it",
    "-- again keeps the owner's edits. Apply after beacon-api/content.sql with:",
    "--   npx wrangler d1 execute fitz-beacons --remote --file=beacon-api/content-seed.sql",
    insert("projects", PROJECT_COLUMNS, rows.projects),
    insert("career", CAREER_COLUMNS, rows.career),
  ].join("\n");
}
