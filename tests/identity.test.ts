import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { identity, KNOWN_PLACEHOLDERS } from "../src/data/identity";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const IDENTITY_FILE = join("src", "data", "identity.ts");

describe("identity", () => {
  it("has a real email address", () => {
    expect(identity.email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);
    expect(identity.email).not.toMatch(/example\.com$/);
  });

  it("has absolute social URLs, with a path required unless declared as a known placeholder", () => {
    const fields = [
      ["github", identity.github],
      ["linkedin", identity.linkedin],
    ] as const;

    for (const [field, url] of fields) {
      expect(url).toMatch(/^https:\/\//);
      const hasPath = new URL(url).pathname.replace(/\/$/, "") !== "";
      if (!KNOWN_PLACEHOLDERS.has(field)) {
        // linkedin (and any future non-placeholder field) must resolve to a
        // real profile, not just the bare domain.
        expect(hasPath).toBe(true);
      }
    }

    // The registry itself must not be empty-checked against nothing — assert
    // linkedin specifically is not the declared placeholder, so the branch
    // above is actually exercised.
    expect(KNOWN_PLACEHOLDERS.has("linkedin")).toBe(false);
  });

  it("leaves no undeclared placeholder contact strings anywhere in src/", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const text = readFileSync(file, "utf8");

      if (/hello@example\.com/.test(text)) offenders.push(`${file}: example email`);

      const bareUrlPattern = /["']https:\/\/(github|linkedin)\.com\/?["']/g;
      for (const match of text.matchAll(bareUrlPattern)) {
        const field = match[1] as "github" | "linkedin";
        // A bare social URL only passes if it lives in the identity module
        // AND that field is explicitly declared as a known placeholder there.
        // Anywhere else — or any undeclared field — it's a forgotten
        // placeholder and must fail loudly.
        const isDeclaredPlaceholder = file === IDENTITY_FILE && KNOWN_PLACEHOLDERS.has(field);
        if (!isDeclaredPlaceholder) {
          offenders.push(`${file}: bare social URL (${field})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
