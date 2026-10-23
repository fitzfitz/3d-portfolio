import { describe, it, expect, vi, beforeEach } from "vitest";
import projectsJson from "../src/data/projects.json";
import { BUNDLED_CAREER } from "../src/data/career";

/** A fresh module instance per test: the settled content is module state. */
const fresh = async () => {
  vi.resetModules();
  return import("../src/data/content");
};

beforeEach(() => { vi.restoreAllMocks(); });

describe("the settled content (src/data/content.ts)", () => {
  it("is the bundled snapshot when nothing settles it", async () => {
    const c = await fresh();
    expect(c.activeContent().projects).toEqual(projectsJson);
    expect(c.activeContent().career).toEqual(BUNDLED_CAREER);
    expect(c.contentSource()).toBe("bundled");
  });

  it("is what settleContent gave it, with its source", async () => {
    const c = await fresh();
    const content = { projects: [projectsJson[1]], career: [BUNDLED_CAREER[0]] };
    expect(c.settleContent(content, "api")).toBe(true);
    expect(c.activeContent()).toBe(content);
    expect(c.contentSource()).toBe("api");
  });

  it("freezes on the first read: a later settle is refused with a warning, and nothing moves", async () => {
    const c = await fresh();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = c.activeContent();
    expect(c.settleContent({ projects: [projectsJson[2]], career: [] }, "api")).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    expect(c.activeContent()).toBe(first);
    expect(c.contentSource()).toBe("bundled");
  });

  it("refuses a second settle", async () => {
    const c = await fresh();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = { projects: [projectsJson[0]], career: [BUNDLED_CAREER[0]] };
    expect(c.settleContent(a, "cache")).toBe(true);
    expect(c.settleContent(c.BUNDLED_CONTENT, "api")).toBe(false);
    expect(c.activeContent()).toBe(a);
  });
});
