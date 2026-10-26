import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { identity } from "../src/data/identity";
import { projects } from "../src/constants";
import { BUNDLED_CAREER as career } from "../src/data/career";

// index.html is static and loads before the bundle, so it cannot import the
// identity/project data. These checks are what keeps its copies honest.
const html = readFileSync("index.html", "utf8");
const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? "";
const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? "{}");

describe("index.html static copies", () => {
  it("noscript summary names every project and the real contact links", () => {
    for (const p of projects) expect(noscript).toContain(p.title);
    for (const c of career) expect(noscript).toContain(c.company);
    expect(noscript).toContain(identity.email);
    expect(noscript).toContain(identity.github);
    expect(noscript).toContain(identity.linkedin);
  });

  it("JSON-LD Person matches identity", () => {
    expect(ld["@type"]).toBe("Person");
    expect(ld.name).toBe(identity.name);
    expect(ld.jobTitle).toBe(identity.role);
    expect(ld.sameAs).toEqual(expect.arrayContaining([identity.github, identity.linkedin]));
  });

  it("Twitter card tags use name=, which is what Twitter reads", () => {
    expect(html).not.toMatch(/property="twitter:/);
    expect(html).toMatch(/name="twitter:card"/);
  });
});
