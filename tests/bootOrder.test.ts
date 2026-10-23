import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * main.tsx settles the content before App's modules load (spec
 * 2026-10-23-dynamic-content, decision 4): App and the debug bridge are
 * imported dynamically, after settleContent. If any module main.tsx imports
 * statically read the content, it would freeze the bundled snapshot first and
 * the D1 content would be refused. This walks main.tsx's static imports.
 */
const ROOT = process.cwd();

/** Relative static imports and re-exports, skipping `import type` / `export type` (erased at build). */
function staticImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (const m of src.matchAll(re)) if (m[1].startsWith(".")) out.push(m[1]);
  return out;
}

function resolve(from: string, spec: string): string | null {
  const base = join(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(c) && !c.endsWith(".css") && /\.(ts|tsx|json)$/.test(c)) return c;
  }
  return null;
}

function graph(entry: string): Set<string> {
  const seen = new Set<string>();
  const todo = [entry];
  while (todo.length) {
    const f = todo.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (f.endsWith(".json")) continue;
    for (const s of staticImports(f)) {
      const r = resolve(f, s);
      if (r) todo.push(r);
    }
  }
  return seen;
}

describe("boot order (main.tsx)", () => {
  const loaded = [...graph(join(ROOT, "src/main.tsx"))].map((f) => relative(ROOT, f));

  it("loads the content loader statically", () => {
    expect(loaded).toContain("src/utils/contentLoader.ts");
    expect(loaded).toContain("src/data/content.ts");
  });

  it("loads nothing before settling that reads the content", () => {
    for (const f of loaded) {
      if (f === "src/data/content.ts") continue;
      expect(readFileSync(join(ROOT, f), "utf8"), f).not.toMatch(/\b(activeContent|contentSource)\(/);
    }
  });

  it("leaves App and the debug bridge to dynamic imports", () => {
    for (const f of ["src/App.tsx", "src/debug/bridge.ts", "src/constants.ts", "src/store/spaceStore.ts"]) {
      expect(loaded, f).not.toContain(f);
    }
    const main = readFileSync(join(ROOT, "src/main.tsx"), "utf8");
    expect(main).toMatch(/import\(["']\.\/App(\.tsx)?["']\)/);
    expect(main.indexOf("settleContent(")).toBeGreaterThan(0);
    expect(main.indexOf("settleContent(")).toBeLessThan(main.search(/import\(["']\.\/App/));
  });
});
