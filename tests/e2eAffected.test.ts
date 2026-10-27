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

  it("runs only the monster lab's probe for the dev-only lab", () => {
    for (const f of ["src/lab/MonsterLab.tsx", "monster-lab.html"]) {
      expect(affectedProbes([f]), f).toEqual(["monsterlab"]);
    }
  });

  it("runs the combat probe and the budgets for the monsters the game now draws", () => {
    for (const f of ["src/utils/monsters/saucerMaterial.ts", "src/data/saucerRig.json", "public/models-ondemand/saucer.glb", "public/models-ondemand/tardigrade.glb"]) {
      const picked = affectedProbes([f]);
      for (const p of ["monsterlab", "combat", "programs", "memory", "perf", "transition", "smoke"]) expect(picked, `${f}: ${p}`).toContain(p);
    }
  });

  it("runs the combat probe for the Nest's canvas, rules, data and HUD", () => {
    for (const f of ["src/components/canvas/nest/NestMonsters.tsx", "src/components/canvas/NestDirector.tsx", "src/data/nest.ts"]) {
      const picked = affectedProbes([f]);
      expect(picked, f).toContain("combat");
      expect(picked, f).toContain("programs");
      expect(picked, f).not.toEqual(ALL);
    }
    expect(affectedProbes(["src/utils/combat/nest.ts"])).toEqual(["smoke", "flight", "gameplay", "touch", "gamepad", "reactions", "combat", "memory"]);
    for (const f of ["src/utils/combat/nestRadio.ts", "src/components/canvas/NestDirector.tsx", "src/data/nest.ts"]) expect(affectedProbes([f]), f).toContain("reactions");
    expect(affectedProbes(["src/components/layout/NestOverlay.tsx"])).toEqual(["smoke", "reducedmotion", "combat"]);
  });

  it("runs the idle-allocation probe for the Nest's per-frame code (C28)", () => {
    for (const f of ["src/utils/combat/nest.ts", "src/utils/combat/effects.ts", "src/utils/combat/renderPose.ts", "src/utils/combat/monsterFrame.ts"]) {
      expect(affectedProbes([f]), f).toContain("memory");
    }
  });

  it("runs the budget probes with a canvas change, and nothing for docs", () => {
    const wake = affectedProbes(["src/components/canvas/EngineWake.tsx"]);
    for (const p of ["programs", "memory", "perf", "transition", "events"]) expect(wake).toContain(p);
    expect(affectedProbes(["docs/PERF-BUDGETS.md", "tests/changelog.test.ts"])).toEqual([]);
  });
});
