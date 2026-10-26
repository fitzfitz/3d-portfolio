# True Proportions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Size the planets by type (Portfolio 16 > Ruangrapi 12 > Fuxx 8) with per-planet masses, and grow the sun's core to radius 24 so it outsizes every planet.

**Architecture:** One planet-properties table in `src/constants.ts` replaces `PLANET_SIZE` and the single `GM_PLANET`. Everything that already scales from `planet.size` follows. A per-planet `gmOf(planet)` feeds the moons, and a per-planet well strength feeds flight gravity. `SUN_RADIUS = 24` flows through every sun consumer, and the corona is resized to stay clear of the belt.

**Tech Stack:** React 19, @react-three/fiber, three 0.185, Vitest, Node e2e probes.

**Spec:** `docs/archive/specs/2026-10-17-true-proportions-design.md` (sub-project B). Background: F12 in `docs/archive/specs/2026-10-16-universe-laws-fixes-design.md`.

## Global Constraints

- Sizes: portfolio 16 (`"gas-giant"`), ruangrapi 12 (`"earth"`), fuxx 8 (`"mars"`). Masses: portfolio 3, ruangrapi 1, fuxx 0.3.
- `GM_RUANGRAPI = keplerGM(1.7 × 12, 2π / 0.4)`, and `gmOf(p) = GM_RUANGRAPI × p.mass`.
- Planet well strength `G = 3000 × (size / 16)²`. The radius stays `size × 3.5`.
- `SUN_RADIUS = 24`. `SUN_COLLIDER.r = 25.5`. The corona billboard is about 72 wide, and its glow never reaches r 40.
- `SIZE_ENLARGEMENT` comes from the gas-giant planet (stays 290).
- No landmark, the spawn, the trail or the gate moves. Bodies inside or too near the sun move minimally (shard 6 at r 9.8 for certain). Every clearance test passes.
- No new shader program during play (`added=0`). Frame loops allocate nothing. Both perf tiers and reduced motion keep working.
- `docs/UNIVERSE-RULES.md`: L35 and L36 → Follows. Mark F12 in the fixes design as built, noting the revised numbers and why.
- Changelog: id `2026-10-17-true-proportions`, title "True Proportions", `pr: 33`.
- Branch `feat/true-proportions` off `main`. Subagents never install packages, never kill processes by name, never dispatch subagents, never push. Port 5199 is free before e2e.
- The owner reviews screenshots before merge. Capture them in Task 3.

## Review Focus

1. **A shrunken planet becomes hard to dock or jump to:** lock and zone radii shrink with size. Test: Task 1, Step 1 (`orbitInvariant` / `orbitEscape` stay green per planet) and Task 3's e2e jump probes.
2. **The bigger sun swallows or clips something:** a shard, a ring, an asteroid, the belt, the corona over the belt. Test: Task 2, Step 1 (sun clearance for every placed body; corona radius < 40).
3. **The shadow penumbra and glare use the new sun radius consistently** in the GLSL define and the CPU `sunVisibility`. Test: Task 2, Step 1 (the GLSL constant matches `SUN_RADIUS`).
4. **Moon systems stay lawful** after resizing: Kepler with each planet's own GM, prograde, tidal lock. Test: Task 1, Step 1 (the `universeRules` moon cases).
5. **The orrery note's enlargement figure doesn't drift** when Ruangrapi shrinks. Test: Task 1, Step 1 (`SIZE_ENLARGEMENT === 290`, from the gas giant).

---

### Task 1: Planets sized and weighed by type

**Files:**
- Modify:
  - `src/constants.ts`: replace `PLANET_SIZE` and `GM_PLANET` with a per-planet table: `PLANET_PROPS: Record<id, { type: PlanetType; size: number; mass: number }>`. `PlanetData` gains `type` and `mass`. Export `GM_RUANGRAPI` and `gmOf(p: PlanetData): number`.
  - `src/data/moons.ts`: `moonOrbitSpeed` uses `gmOf(planets[m.planet])`.
  - `src/components/canvas/Spaceship.tsx` (`PLANET_WELLS`, ~94–100): G per planet = `PLANET_WELL_G × (size/16)²`.
  - `src/utils/realUnits.ts`: `SIZE_ENLARGEMENT` from the gas-giant planet.
  - Any other `planets[0].size` / `PLANET_SIZE` reader.
- Tests:
  - `tests/universeRules.test.ts`: the moon anchor becomes ruangrapi's moon 0.4 rad/s at 1.7 × 12; moons use `gmOf`; add the size-order test.
  - `tests/projects.test.ts`: the pinned planet table gets the new sizes, types and masses, with a dated note.
  - `tests/realUnits.test.ts`.
  - `tests/gravityWell.test.ts` where it assumes size 16 for a specific planet.
  - Any clearance or e2e expectation that hard-codes 16.

**Interfaces:**
- Produces:
  - `type PlanetType = "earth" | "gas-giant" | "mars"`
  - `PLANET_PROPS`
  - `GM_RUANGRAPI`
  - `gmOf(p: PlanetData): number`
  - `PlanetData` = `{ name, orbit, color, size, type, mass }`

- [ ] **Step 1: Write the failing tests** (add to `tests/universeRules.test.ts`):

```ts
it("L36: planet size follows type — gas giant > earth > mars", () => {
  const by = (t: string) => planets.find((p) => p.type === t)!.size;
  expect(by("gas-giant")).toBe(16); expect(by("earth")).toBe(12); expect(by("mars")).toBe(8);
});
it("L35: the sun outsizes every planet", () => {
  expect(SUN_RADIUS).toBeGreaterThan(Math.max(...planets.map((p) => p.size)));
});
it("masses are ordered gas giant > earth > mars", () => {
  const m = (t: string) => planets.find((p) => p.type === t)!.mass;
  expect(m("gas-giant")).toBeGreaterThan(m("earth")); expect(m("earth")).toBeGreaterThan(m("mars"));
});
it.each(MOONS.map((m) => [m.id, m] as const))("moon %s obeys Kepler around its own planet (gmOf)", (_, m) => {
  const p = planets[m.planet];
  expect(Math.abs(moonOrbitSpeed(m))).toBeCloseTo(keplerOmega(m.distance * p.size, gmOf(p)), 12);
});
it("Ruangrapi's rock moon keeps its 0.4 rad/s (the anchor)", () => {
  expect(Math.abs(moonOrbitSpeed(MOONS.find((m) => m.id === "ruangrapiRock")!))).toBeCloseTo(0.4, 9);
});
```

  Also in `tests/realUnits.test.ts`: `SIZE_ENLARGEMENT === 290` is unchanged. Keep the existing assertion; it must still pass after Ruangrapi shrinks. The `SUN_RADIUS` check above fails until Task 2. Mark it `it.todo` here, and Task 2 enables it.

- [ ] **Step 2: Run them and see them fail.** Run: `npx vitest run tests/universeRules.test.ts`. Expected: FAIL (no `type`/`mass`/`gmOf`).
- [ ] **Step 3: Implement** the changes under Files.
- [ ] **Step 4: Run all checks.** `npx vitest run && npx tsc --noEmit -p tsconfig.app.json && npm run lint`. Expected: all green. Fix any clearance or e2e-side unit test that hard-coded 16 by reading `size`.
- [ ] **Step 5: Commit**

`feat(planets): sized and weighed by type — gas giant 16, earth 12, mars 8 (L36)`

---

### Task 2: A sun bigger than its planets

**Files:**
- Modify:
  - `src/constants.ts`: `SUN_RADIUS = 24`.
  - `src/data/asteroids.ts`: `SUN_COLLIDER.r = 25.5`.
  - `src/components/canvas/Sun.tsx`: the core follows `SUN_RADIUS`, and the `CORONA_SIZE` billboard is about 72 so the glow ends before r 40. Keep its colour and falloff character; adjust `uDisc` to match.
  - `src/components/canvas/sunShadow.ts`: the GLSL sun radius define reads `SUN_RADIUS`, not a literal.
  - Glare and occlusion users already import `SUN_RADIUS`; confirm.
  - Move any placed body that now fails its sun clearance: shard 6 (`src/data/shards.ts`, at [4,4,8]), and any ring gate, asteroid or the jelly path if a test fails. Make minimal moves, re-run the clearance tests, and keep the shard's "near the sun" fact true.
  - Enable the `SUN_RADIUS` `it.todo` from Task 1.
- Test: `tests/sunProportions.test.ts`

**Interfaces:**
- Consumes: `planets` with sizes (Task 1).
- Produces: `SUN_RADIUS = 24`. `CORONA_SIZE` is exported from `Sun.tsx`, or the corona size moves into a small module if `Sun.tsx` can't export it cleanly for the test.

- [ ] **Step 1: Write the failing test** `tests/sunProportions.test.ts`:
  - `SUN_RADIUS === 24`.
  - `SUN_COLLIDER.r === 25.5`.
  - The corona's outer radius (`CORONA_SIZE / 2`) is greater than `SUN_RADIUS` and less than 40, the belt's inner edge.
  - Every shard, ring gate, scenery asteroid and jelly-path sample is at least `SUN_COLLIDER.r + 4` from the origin (plus its own radius where it has one).
  - The sun-shadow GLSL source contains the sun radius as `24.0`, or the define built from `SUN_RADIUS`.
- [ ] **Step 2: Run it and see it fail.** Run: `npx vitest run tests/sunProportions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the changes under Files.
- [ ] **Step 4: Run all checks.** `npx vitest run && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run build`. Expected: green.
- [ ] **Step 5: Commit**

`feat(sun): the sun outsizes its planets — core radius 24 (L35)`

---

### Task 3: Docs, changelog, e2e and the owner's screenshots

**Files:**
- `docs/UNIVERSE-RULES.md`: L35 and L36 → Follows, stating the sizes, the P3 compression and the order. Mark F12 in the fixes design as built (16/12/8 and sun 24, and why the numbers changed).
- `docs/PERF-BUDGETS.md`: the re-measured numbers.
- `src/data/changelog.ts`: the entry under Global Constraints, within the format limits.
  - **what:** the sun is now bigger than every planet, and planets are sized by type: the gas giant is largest and the Mars-type smallest;
  - **why:** the sun was smaller than its planets, and every planet was the same size;
  - **how:** a planet table with type, size and mass; moons orbit by their own planet's mass; a bigger sun core with a resized corona.
- Any e2e probe that assumed size 16 for a specific planet.

- [ ] **Step 1: Docs and changelog.** Run `npx vitest run tests/changelog.test.ts`. Expected: PASS.
- [ ] **Step 2: Full verification.** `npx tsc --noEmit -p tsconfig.app.json && npx vitest run && npm run lint && npm run build && npm run test:e2e`. Expected: all green and programs `added=0`. Re-run a hung probe alone and report both runs.
- [ ] **Step 3: Owner screenshots** (Playwright MCP against `npm run dev -- --port 5200 --strictPort`; stop only your PID; close tabs). Use reduced motion, teleport and photo mode. Capture:
  - the view at load;
  - the sun from about 60 out (core, corona and the belt behind it);
  - the sun from the spawn;
  - each planet close up from the same relative distance (2.5 × size);
  - one frame showing two planets at once for relative size;
  - the ship docked at Fuxx, to check it doesn't read as a boulder.

  Save them to `scratchpad/proportions-shots/` and describe each.
- [ ] **Step 4: Commit**

`docs: True Proportions — rules, budgets, changelog`
