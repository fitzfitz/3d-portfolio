import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import projectsJson from "../src/data/projects.json";
import { BUNDLED_CAREER } from "../src/data/career";
import { contentSeedSql, contentSeedRows, PROJECT_COLUMNS, CAREER_COLUMNS } from "../beacon-api/src/contentSeed";
import { parseContent } from "../src/utils/contentParse";

/**
 * D1 starts identical to the site (spec 2026-10-23-dynamic-content, decision
 * 1): beacon-api/content-seed.sql is generated from the bundled data, and this
 * fails when the two drift. Fix: `npm run content:seed`.
 */
describe("beacon-api/content-seed.sql", () => {
  it("is exactly what the generator makes from the bundled data (run npm run content:seed)", () => {
    expect(readFileSync("beacon-api/content-seed.sql", "utf8")).toBe(contentSeedSql(projectsJson, BUNDLED_CAREER));
  });

  it("reads back, as GET /content returns the rows, as the bundled data", () => {
    const rows = contentSeedRows(projectsJson, BUNDLED_CAREER);
    const warn = () => { throw new Error("a seeded row was dropped"); };
    const parsed = parseContent(rows, warn);
    expect(parsed.projects).toEqual(projectsJson);
    expect(parsed.career).toEqual(BUNDLED_CAREER);
  });

  it("fills every column of both tables, in sort steps of 10, never overwriting", () => {
    const schema = readFileSync("beacon-api/content.sql", "utf8");
    for (const c of PROJECT_COLUMNS) expect(schema, `projects.${c}`).toMatch(new RegExp(`\\n  "?${c}"?\\s`));
    for (const c of CAREER_COLUMNS) expect(schema, `career.${c}`).toMatch(new RegExp(`\\n  "?${c}"?\\s`));
    const rows = contentSeedRows(projectsJson, BUNDLED_CAREER);
    expect(rows.projects.map((r) => r.sort)).toEqual([10, 20, 30]);
    expect(rows.career.map((r) => r.sort)).toEqual([10, 20, 30, 40, 50]);
    const sql = contentSeedSql(projectsJson, BUNDLED_CAREER);
    expect(sql.match(/^INSERT OR IGNORE INTO/gm)).toHaveLength(2);
    expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b|\bUPDATE\b/);
  });

  // A real answer: content.sql and content-seed.sql applied with `wrangler d1
  // execute --local`, served by `wrangler dev --local` (2026-10-23). It pins
  // the wire shape (every column, tech as JSON text, NULLs), not the data.
  it("matches what wrangler dev --local served from the seeded tables: every column, nothing dropped", () => {
    const wire = JSON.parse(readFileSync("tests/fixtures/content-wrangler-local.json", "utf8"));
    for (const r of wire.projects) expect(Object.keys(r)).toEqual([...PROJECT_COLUMNS]);
    for (const r of wire.career) expect(Object.keys(r)).toEqual([...CAREER_COLUMNS]);
    expect(typeof wire.projects[0].tech).toBe("string");
    expect(wire.career.some((r: { end: unknown }) => r.end === null)).toBe(true);
    const parsed = parseContent(wire, () => { throw new Error("a served row was dropped"); });
    expect(parsed.projects).toHaveLength(wire.projects.length);
    expect(parsed.career).toHaveLength(wire.career.length);
  });

  it("quotes text for SQL: an apostrophe is doubled, end is quoted", () => {
    const sql = contentSeedSql([{ ...projectsJson[0], title: "Fitz's \"best\"" }], [{ ...BUNDLED_CAREER[1] }]);
    expect(sql).toContain("'Fitz''s \"best\"'");
    expect(sql).toContain('start, "end", employment');
  });
});
