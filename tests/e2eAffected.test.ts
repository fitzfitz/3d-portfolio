import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { ALL } from "./e2e/probeList.mjs";
import { RULES, affectedProbes } from "./e2e/affected.mjs";

describe("e2e affected-probe selection", () => {
  it("lists exactly the probe files that exist", () => {
    for (const p of ALL) expect(existsSync(`tests/e2e/${p}.probe.mjs`), p).toBe(true);
  });

  it("names only real probes in its rules", () => {
    const named = new Set<string>();
    for (const [re, pick] of RULES as [RegExp, (m: RegExpMatchArray | null) => string[] | "ALL"][]) {
      const out = pick(re.source.includes("probe") ? ["", "smoke"] as unknown as RegExpMatchArray : null);
      if (Array.isArray(out)) out.forEach((p) => named.add(p));
    }
    for (const p of named) expect(ALL, p).toContain(p);
  });

  it("runs a changed probe, and only it, when nothing else changed", () => {
    expect(affectedProbes(["tests/e2e/events.probe.mjs"])).toEqual(["events"]);
  });

  it("runs the full suite for the harness, the app shell and any file no rule covers", () => {
    for (const f of ["tests/e2e/harness.mjs", "src/App.tsx", "src/store/spaceStore.ts", "src/components/canvas/GlobalCanvas.tsx", "something/new.txt"]) {
      expect(affectedProbes([f]), f).toEqual(ALL);
    }
  });

  it("runs only the monster lab's probe for the dev-only monsters (the game imports none of them)", () => {
    for (const f of ["src/lab/MonsterLab.tsx", "src/utils/monsters/saucerMaterial.ts", "src/data/saucerRig.json", "public/models-ondemand/tardigrade.glb", "monster-lab.html"]) {
      expect(affectedProbes([f]), f).toEqual(["monsterlab"]);
    }
  });

  it("runs the budget probes with a canvas change, and nothing for docs", () => {
    const wake = affectedProbes(["src/components/canvas/EngineWake.tsx"]);
    for (const p of ["programs", "memory", "perf", "transition", "events"]) expect(wake).toContain(p);
    expect(affectedProbes(["docs/PERF-BUDGETS.md", "tests/changelog.test.ts"])).toEqual([]);
  });
});
