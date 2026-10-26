import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * The monster lab (dev only, src/lab/main.tsx) borrows game modules that read
 * the content at module load (constants.ts, data/probes.ts, ...). Like the
 * game's main.tsx (tests/bootOrder.test.ts), it settles the content first and
 * loads MonsterLab only after, so no lab module freezes it unannounced. The
 * lab itself boots in tests/e2e/monsterlab.probe.mjs.
 */
const ROOT = process.cwd();
const ENTRY = join(ROOT, "src/lab/main.tsx");

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
    if (existsSync(c) && /\.(ts|tsx|json)$/.test(c)) return c;
  }
  return null;
}

function graph(entry: string): string[] {
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
  return [...seen].map((f) => relative(ROOT, f));
}

describe("the monster lab's boot", () => {
  const loaded = graph(ENTRY);
  const main = readFileSync(ENTRY, "utf8");

  it("loads the content module statically and MonsterLab dynamically", () => {
    expect(loaded).toContain("src/data/content.ts");
    for (const f of ["src/lab/MonsterLab.tsx", "src/constants.ts", "src/data/probes.ts", "src/store/spaceStore.ts"]) expect(loaded, f).not.toContain(f);
    expect(main).toMatch(/import\(["']\.\/MonsterLab(\.tsx)?["']\)/);
  });

  it("settles the bundled content before MonsterLab loads", () => {
    for (const f of loaded) {
      if (f === "src/data/content.ts") continue;
      expect(readFileSync(join(ROOT, f), "utf8"), f).not.toMatch(/\b(activeContent|contentSource)\(/);
    }
    expect(main).toMatch(/settleContent\(BUNDLED_CONTENT, "bundled"\)/);
    expect(main.indexOf("settleContent(")).toBeGreaterThan(0);
    expect(main.indexOf("settleContent(")).toBeLessThan(main.search(/import\(["']\.\/MonsterLab/));
  });
});
