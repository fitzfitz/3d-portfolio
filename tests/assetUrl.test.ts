import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { assetUrl } from "../src/utils/assetUrl";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const SRC_FILES = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));

/**
 * The helper module is allowed to mention the literal in its own explanatory
 * comment — it is documenting the bug it exists to prevent.
 */
const HELPER_FILE = join("src", "utils", "assetUrl.ts");

describe("assetUrl", () => {
  it("returns a root-absolute path when the base is the domain root", () => {
    expect(assetUrl("/models/spaceship.glb", "/")).toBe("/models/spaceship.glb");
  });

  it("prefixes a subpath base, as served by a GitHub Pages project page", () => {
    expect(assetUrl("/models/spaceship.glb", "/3d-portfolio/")).toBe(
      "/3d-portfolio/models/spaceship.glb",
    );
  });

  it("accepts a base with or without a trailing slash", () => {
    expect(assetUrl("/models/x.glb", "/sub")).toBe("/sub/models/x.glb");
    expect(assetUrl("/models/x.glb", "/sub/")).toBe("/sub/models/x.glb");
  });

  it("accepts a path with or without a leading slash", () => {
    expect(assetUrl("models/x.glb", "/sub/")).toBe("/sub/models/x.glb");
    expect(assetUrl("/models/x.glb", "/sub/")).toBe("/sub/models/x.glb");
  });

  it("never emits a protocol-relative double slash, which would resolve to a host", () => {
    // "//models/x.glb" is not a path — it is a URL pointing at a host called
    // "models". Any base/path slash combination must stay a plain path.
    for (const base of ["/", "//", "/sub", "/sub/", "/sub//"]) {
      for (const path of ["models/x.glb", "/models/x.glb", "//models/x.glb"]) {
        expect(assetUrl(path, base)).not.toMatch(/^\/\//);
      }
    }
  });

  it("defaults to Vite's configured base when none is passed", () => {
    // Under vitest this is "/", but the assertion that matters is that the
    // default is wired to import.meta.env.BASE_URL at all rather than
    // hardcoded — so it is checked against the same value Vite reports.
    expect(assetUrl("/models/x.glb")).toBe(
      assetUrl("/models/x.glb", import.meta.env.BASE_URL),
    );
  });
});

describe("no root-absolute asset literals survive in src/", () => {
  /**
   * This is the check that actually protects the deploy. A root-absolute
   * "/models/..." literal builds cleanly, passes every other test, and only
   * fails in a visitor's browser as an empty sky — because it is a runtime
   * fetch Vite never rewrites. Without this scan, the next model someone adds
   * silently reintroduces the bug.
   *
   * Mirrors the source-scanning approach in identity.test.ts.
   */
  it("has no bare /models/ string literals", () => {
    const offenders: string[] = [];
    for (const file of SRC_FILES) {
      if (file === HELPER_FILE) continue;
      const text = readFileSync(file, "utf8");

      // Blank out correctly-wrapped calls before scanning. A naive search for
      // `"/models/` cannot tell `useGLTF("/models/x.glb")` from
      // `useGLTF(assetUrl("/models/x.glb"))` — the offending substring is
      // present in both. The replacement is the same length in lines (single
      // line, no newlines touched), so reported line numbers stay accurate.
      const scanned = text.replace(/assetUrl\(\s*["'`][^"'`]*["'`]\s*\)/g, "assetUrl(WRAPPED)");

      for (const m of scanned.matchAll(/["'`]\/+models\//g)) {
        const line = scanned.slice(0, m.index).split("\n").length;
        offenders.push(`${file}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the wrapped-call blanking does not hide a genuinely bare literal", () => {
    // Pins the discrimination the check above depends on. Without this, a
    // blanking pattern broad enough to swallow bare literals too would make the
    // guard silently useless.
    const strip = (t: string) => t.replace(/assetUrl\(\s*["'`][^"'`]*["'`]\s*\)/g, "assetUrl(WRAPPED)");
    const bare = /["'`]\/+models\//;

    expect(bare.test(strip('useGLTF(assetUrl("/models/x.glb"))'))).toBe(false);
    expect(bare.test(strip('useGLTF("/models/x.glb")'))).toBe(true);
    expect(bare.test(strip('useTexture(["/models/a.webp"])'))).toBe(true);
  });

  it("still loads assets through the helper — the scan above is not passing by deletion", () => {
    // Guards against the vacuous pass: if the models were simply removed, the
    // scan would go green while the app rendered nothing. Thirteen call sites
    // were migrated; the floor is deliberately below that so adding a model is
    // not a failure, but dropping them all is.
    const uses = SRC_FILES.filter((f) => f !== HELPER_FILE).reduce(
      (n, f) => n + [...readFileSync(f, "utf8").matchAll(/assetUrl\(/g)].length,
      0,
    );
    expect(uses).toBeGreaterThanOrEqual(13);
  });
});
