import { describe, it, expect, vi, beforeEach } from "vitest";
import projectsJson from "../src/data/projects.json";
import { BUNDLED_CAREER } from "../src/data/career";
import { BUNDLED_CONTENT } from "../src/data/content";
import { RESERVED_ZONE_IDS } from "../src/data/destinations";
import { parseContent, resolveContent, DESTINATION_IDS } from "../src/utils/contentParse";

/** A project as D1 returns it: every column, `tech` as JSON text, NULL for absent. */
const projectRow = (over: Record<string, unknown> = {}) => ({
  id: "atlas", sort: 10, title: "Atlas", role: "Personal project", duration: "2026", short: "A short line.",
  description: "A longer description.", tech: "[\"Go\",\"SQLite\"]", color: "#12ab9F", repo: null, ...over,
});
/** A career row as D1 returns it. */
const careerRow = (over: Record<string, unknown> = {}) => ({
  id: 1, sort: 10, role: "Engineer", company: "Acme", note: null, start: "Jan 2020", end: null,
  employment: "Full-time", location: "Jakarta, Indonesia", summary: "Built things.", ...over,
});

let warn: ReturnType<typeof vi.fn<(msg: string) => void>>;
beforeEach(() => { warn = vi.fn<(msg: string) => void>(); });

describe("parseContent: projects", () => {
  it("reads a D1 row: tech from JSON text, NULL repo dropped, sort dropped", () => {
    const { projects } = parseContent({ projects: [projectRow()], career: [] }, warn);
    expect(projects).toEqual([{
      id: "atlas", title: "Atlas", role: "Personal project", duration: "2026", short: "A short line.",
      description: "A longer description.", tech: ["Go", "SQLite"], color: "#12ab9F",
    }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("accepts tech as an array and keeps an https repo", () => {
    const { projects } = parseContent({ projects: [projectRow({ tech: ["Rust"], repo: "https://github.com/x/y" })] }, warn);
    expect(projects?.[0].tech).toEqual(["Rust"]);
    expect(projects?.[0].repo).toBe("https://github.com/x/y");
  });

  it("passes the bundled projects through untouched", () => {
    expect(parseContent({ projects: projectsJson }, warn).projects).toEqual(projectsJson);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing title", { title: undefined }],
    ["a blank title", { title: "   " }],
    ["a numeric role", { role: 7 }],
    ["a blank description", { description: "" }],
    ["a three-digit colour", { color: "#fff" }],
    ["a named colour", { color: "red" }],
    ["tech that is not JSON", { tech: "React, Vite" }],
    ["tech that is a JSON object", { tech: "{\"a\":1}" }],
    ["tech with a number in it", { tech: "[\"Go\",3]" }],
    ["empty tech", { tech: "[]" }],
    ["a blank tech entry", { tech: "[\"Go\",\" \"]" }],
    ["a javascript: repo", { repo: "javascript:alert(1)" }],
    ["an http repo", { repo: "http://example.com" }],
    ["an id with spaces", { id: "my project" }],
    ["an upper-case id", { id: "Atlas" }],
    ["a destination's id", { id: "contact" }],
    ["a body's id", { id: "earth" }],
  ])("drops a row with %s, and warns", (_, over) => {
    const { projects } = parseContent({ projects: [projectRow(over), projectRow({ id: "kept" })] }, warn);
    expect(projects?.map((p) => p.id)).toEqual(["kept"]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("keeps the first of two rows with one id", () => {
    const { projects } = parseContent({ projects: [projectRow({ title: "One" }), projectRow({ title: "Two" })] }, warn);
    expect(projects?.map((p) => p.title)).toEqual(["One"]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("gives null (fall back) when no row is valid, the list is empty or missing", () => {
    expect(parseContent({ projects: [projectRow({ color: "nope" })] }, warn).projects).toBeNull();
    expect(parseContent({ projects: [] }, warn).projects).toBeNull();
    expect(parseContent({}, warn).projects).toBeNull();
    expect(parseContent({ projects: "x" }, warn).projects).toBeNull();
  });

  it("names the only destination ids the engine reserves", () => {
    expect([...DESTINATION_IDS].sort()).toEqual([...RESERVED_ZONE_IDS].sort());
  });
});

describe("parseContent: career", () => {
  it("reads a D1 row: NULL note and end become absent, id and sort dropped", () => {
    const { career } = parseContent({ career: [careerRow()] }, warn);
    expect(career).toEqual([{
      role: "Engineer", company: "Acme", start: "Jan 2020", employment: "Full-time", location: "Jakarta, Indonesia", summary: "Built things.",
    }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps a note and an end", () => {
    const { career } = parseContent({ career: [careerRow({ note: "on site", end: "Dec 2021", employment: "Contract" })] }, warn);
    expect(career?.[0]).toMatchObject({ note: "on site", end: "Dec 2021", employment: "Contract" });
  });

  it("passes the bundled career through untouched", () => {
    expect(parseContent({ career: BUNDLED_CAREER }, warn).career).toEqual(BUNDLED_CAREER);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["a blank role", { role: " " }],
    ["a missing company", { company: undefined }],
    ["a blank summary", { summary: "" }],
    ["a blank location", { location: "" }],
    ["an unreadable start", { start: "2020" }],
    ["a lower-case month", { start: "jan 2020" }],
    ["an unreadable end", { end: "Present" }],
    ["another employment type", { employment: "Freelance" }],
    ["a blank note", { note: "" }],
    ["a numeric note", { note: 3 }],
  ])("drops a row with %s, and warns", (_, over) => {
    const { career } = parseContent({ career: [careerRow(over), careerRow({ company: "Kept" })] }, warn);
    expect(career?.map((c) => c.company)).toEqual(["Kept"]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("gives null (fall back) when no row is valid, the list is empty or missing", () => {
    expect(parseContent({ career: [careerRow({ start: "soon" })] }, warn).career).toBeNull();
    expect(parseContent({ career: [] }, warn).career).toBeNull();
    expect(parseContent(null, warn).career).toBeNull();
  });
});

describe("resolveContent", () => {
  it("fills each list that has no valid row from the bundled snapshot, separately", () => {
    const r = resolveContent({ projects: [projectRow()], career: [] }, BUNDLED_CONTENT, warn);
    expect(r.content.projects.map((p) => p.id)).toEqual(["atlas"]);
    expect(r.content.career).toBe(BUNDLED_CONTENT.career);
    expect(r.usable).toBe(true);
  });

  it("is unusable when neither list has a valid row, and is then the bundled snapshot", () => {
    const r = resolveContent({ beacons: [] }, BUNDLED_CONTENT, warn);
    expect(r.usable).toBe(false);
    expect(r.content.projects).toBe(BUNDLED_CONTENT.projects);
    expect(r.content.career).toBe(BUNDLED_CONTENT.career);
  });
});
