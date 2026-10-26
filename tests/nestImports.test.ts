import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * The Nest's renderer (the monster materials, ~23 kB min) is a lazily loaded
 * chunk that mounts only within the 200 u load radius (Ruling C16): nothing
 * the canvas imports statically may reach it. NestDirector reaches the rigs'
 * maths through the tiny monsters/monsterRig.ts only, and NestGate loads
 * NestMonsters with a dynamic import(). Walks the static imports, as the
 * boot-order tests do (tests/bootOrder.test.ts).
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
    if (existsSync(c) && /\.(ts|tsx|json)$/.test(c)) return c;
  }
  return null;
}

function graph(entry: string): string[] {
  const seen = new Set<string>();
  const todo = [join(ROOT, entry)];
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

/** The renderer's modules: only the lazily loaded chunk may hold them. */
const RENDERER = [
  "src/utils/monsters/saucerMaterial.ts",
  "src/utils/monsters/tardigradeMaterial.ts",
  "src/utils/monsters/monsterShading.ts",
  "src/utils/monsters/monsterInstances.ts",
  "src/utils/monsters/buildMonsters.ts",
];

describe("the Nest's renderer loads on demand (C16)", () => {
  it("NestDirector's static imports reach the rig maths (monsterRig.ts), never the materials", () => {
    const loaded = graph("src/components/canvas/NestDirector.tsx");
    expect(loaded).toContain("src/utils/combat/monsterFrame.ts");
    expect(loaded).toContain("src/utils/monsters/monsterRig.ts");
    for (const f of RENDERER) expect(loaded, f).not.toContain(f);
  });

  it("the canvas's static graph (GlobalCanvas, NestGate, NestBuoy, NestEffects) holds none of them", () => {
    const loaded = graph("src/components/canvas/GlobalCanvas.tsx");
    for (const f of ["src/components/canvas/nest/NestGate.tsx", "src/components/canvas/nest/NestBuoy.tsx",
      "src/components/canvas/nest/NestEffects.tsx", "src/components/canvas/NestDirector.tsx"]) expect(loaded, f).toContain(f);
    for (const f of [...RENDERER, "src/components/canvas/nest/NestMonsters.tsx", "src/utils/monsters/monsterAssets.ts"]) {
      expect(loaded, f).not.toContain(f);
    }
  });

  it("NestGate loads NestMonsters with a dynamic import, and NestMonsters holds the renderer", () => {
    const gate = readFileSync(join(ROOT, "src/components/canvas/nest/NestGate.tsx"), "utf8");
    expect(gate).toMatch(/import\(\s*["']\.\/NestMonsters(\.tsx)?["']\s*\)/);
    const chunk = graph("src/components/canvas/nest/NestMonsters.tsx");
    for (const f of RENDERER) expect(chunk, f).toContain(f);
  });

  it("NestDirector reads uMotion through the renderer's debug handle, not MONSTER_UNIFORMS", () => {
    const src = readFileSync(join(ROOT, "src/components/canvas/NestDirector.tsx"), "utf8");
    expect(src).not.toMatch(/MONSTER_UNIFORMS/);
    expect(src).toMatch(/nestRender/);
  });
});
