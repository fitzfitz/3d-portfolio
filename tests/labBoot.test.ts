import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

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

/** Every import specifier in a file: static, type-only, re-exports, side-effect and dynamic import(). */
function allSpecifiers(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"]*?["']([^"']+)["']/gm)) out.push(m[1]);
  for (const m of src.matchAll(/\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) out.push(m[1]);
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Where a relative specifier points, extension or not (null for packages). */
function target(from: string, spec: string): string | null {
  return spec.startsWith(".") ? join(dirname(from), spec) : null;
}

describe("the game never imports the monster lab", () => {
  const LAB = join(ROOT, "src/lab");
  const intoLab = (from: string, spec: string) => {
    const t = target(from, spec);
    return t !== null && (t === LAB || t.startsWith(LAB + sep));
  };

  it("no game module imports src/lab (the game builds monsters from src/utils/monsters)", () => {
    const game = sourceFiles(join(ROOT, "src")).filter((f) => !f.startsWith(LAB + sep));
    expect(game.length).toBeGreaterThan(100);
    const offenders = game.flatMap((f) =>
      allSpecifiers(readFileSync(f, "utf8")).filter((s) => intoLab(f, s)).map((s) => `${relative(ROOT, f)} -> ${s}`));
    expect(offenders).toEqual([]);
  });

  it("the lab builds its monsters from src/utils/monsters/buildMonsters.ts", () => {
    expect(existsSync(join(ROOT, "src/lab/labMonsters.ts"))).toBe(false);
    const lab = join(ROOT, "src/lab/MonsterLab.tsx");
    const specs = allSpecifiers(readFileSync(lab, "utf8"));
    expect(specs).toContain("../utils/monsters/buildMonsters");
    expect(specs).toContain("../utils/monsters/monsterAssets");
  });

  it("the scan sees every import form (so the check above cannot pass by missing one)", () => {
    const from = join(ROOT, "src/components/canvas/X.tsx");
    const src = [
      'import { a } from "../../lab/labScene";',
      'import type { B } from "../../lab/labScene";',
      'export { c } from "../../lab/LabPanel";',
      'import "../../lab/main";',
      'const m = await import("../../lab/MonsterLab");',
      'import { d } from "../../utils/monsters/buildMonsters";',
      'import * as THREE from "three";',
    ].join("\n");
    const specs = allSpecifiers(src);
    expect(specs).toHaveLength(7);
    expect(specs.filter((s) => intoLab(from, s))).toEqual([
      "../../lab/labScene", "../../lab/labScene", "../../lab/LabPanel", "../../lab/main", "../../lab/MonsterLab",
    ]);
  });
});
