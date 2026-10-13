import { describe, it, expect } from "vitest";
import { CHANGELOG, hasUnseen, PR_URL } from "../src/data/changelog";

describe("CHANGELOG", () => {
  it("is newest first with valid ISO dates", () => {
    for (const e of CHANGELOG) expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (let i = 1; i < CHANGELOG.length; i++) expect(CHANGELOG[i - 1].date >= CHANGELOG[i].date).toBe(true);
  });
  it("has unique ids that start with their date, and unique positive PR numbers", () => {
    expect(new Set(CHANGELOG.map((e) => e.id)).size).toBe(CHANGELOG.length);
    for (const e of CHANGELOG) expect(e.id.startsWith(e.date)).toBe(true);
    const prs = CHANGELOG.map((e) => e.pr);
    expect(new Set(prs).size).toBe(prs.length);
    for (const n of prs) expect(Number.isInteger(n) && n > 0).toBe(true);
  });
  it("answers what, why and how in short plain text", () => {
    for (const e of CHANGELOG) {
      expect(e.title.split(" ").length, e.id).toBeLessThanOrEqual(4);
      expect(e.what.length, `${e.id} what`).toBeGreaterThan(0);
      expect(e.what.length, `${e.id} what`).toBeLessThanOrEqual(220);
      expect(e.why.length, `${e.id} why`).toBeGreaterThan(0);
      expect(e.why.length, `${e.id} why`).toBeLessThanOrEqual(220);
      expect(e.how.length, `${e.id} how`).toBeGreaterThan(0);
      expect(e.how.length, `${e.id} how`).toBeLessThanOrEqual(240);
    }
  });
  it("starts with October 2026 and covers every PR from #1 up", () => {
    expect(CHANGELOG.at(-1)!.date >= "2026-10-01").toBe(true);
    const prs = new Set(CHANGELOG.map((e) => e.pr));
    for (let n = 1; n <= Math.max(...prs); n++) expect(prs.has(n), `PR #${n}`).toBe(true);
  });
  it("links PRs on GitHub", () => {
    expect(PR_URL).toBe("https://github.com/fitzfitz/3d-portfolio/pull/");
  });
});

describe("hasUnseen", () => {
  it("is true only when the newest entry differs from the one last seen", () => {
    expect(hasUnseen("b", "a")).toBe(true);
    expect(hasUnseen("b", "b")).toBe(false);
  });
});
