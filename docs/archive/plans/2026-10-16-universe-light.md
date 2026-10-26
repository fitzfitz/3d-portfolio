# Universe Laws Phase 2 ("Light") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make light obey physics. Move the spawn out to 0.92 AU (prerequisite), then make sunlight fall off with the inverse square of distance, with camera auto-exposure (F3). Add real shadows and eclipses (F4).

**Architecture:**
- **Spawn:** one `SPAWN` constant in a dependency-free module replaces four copies.
- **Light (F3):** pure maths in `src/utils/sunLight.ts`. A small `ExposureDriver` component sets `gl.toneMappingExposure`. The sun and the instrument overlays cancel exposure through a shared uniform.
- **Shadows (F4):** analytic sphere shadows in `src/components/canvas/sunShadow.ts`, a GLSL port of `sunVisibility` patched into lit materials. Planets are tested per fragment, against moons and the other planets. Small bodies (moons, the ship) use one CPU-computed value per object.

**Tech Stack:** React 19, @react-three/fiber 9, three 0.185 (physical point lights; `toneMappingExposure` reaches both the ToneMapping pass and the renderer path), @react-three/postprocessing 3, Vitest, Node e2e probes (`npm run test:e2e [probe…]`), Playwright MCP.

**Spec:** `docs/archive/specs/2026-10-16-universe-laws-fixes-design.md`, sections F3, "F3 revision: the spawn moves out", and F4. Catalogue: `docs/UNIVERSE-RULES.md` (L19, L20).

## Global Constraints

- Branch `feat/universe-light` off `main`. One PR at the end; never merge without the owner.
- `SPAWN = { x: -50, y: 62, z: 69 }` exactly. It is 105.4 from the sun (0.92 AU) and clears every planet's swept orbit by 95.1.
- Exposure law, exactly:
  - `targetExposure(d) = clamp((d / AU) ** 1.5, 0.15, 2.5)`, where `d` is the camera's distance from the sun and `AU = 115`;
  - eased toward the target with a half-life of 1.5 s;
  - snapped to the target under reduced motion.
- Sun light: `decay = 2`. Intensity is chosen so the irradiance at 1 AU equals today's 2.1, which gives a base of `2.1 × AU²` = 27,772.5. The flare keeps today's relative swell (today 2.1 + 1.1 × flare).
- The sun (core, corona, glare sprites) and the instrument overlays (orbit rings, zone circles, guide lines) look the same at every exposure and in both perf tiers.
- No new shader program during play: `tests/e2e/programs.probe.mjs` tour `added=0`. New program variants compile at warm-up. The transition-probe ceilings may be re-baselined only deliberately, recorded in `docs/PERF-BUDGETS.md`.
- `LIGHT_BUDGET` stays 4. Shadows are maths, not lights or shadow maps.
- Frame loops allocate nothing.
- Reduced motion and the low-perf tier keep working.
- Every law fixed here flips to **Follows** in `docs/UNIVERSE-RULES.md` in the same task.
- One changelog entry, `pr: 30` (the next free number; #29 is merged).
- Subagents never install packages, never kill processes by name, never dispatch subagents, never push.
- Before `npm run test:e2e`: no Playwright tabs open and nothing listening on port 5199.
- The beacon Worker (`beacon-api`) imports `src/utils/beacons.ts`. Keep that file's import graph free of `constants.ts` and React (use the new spawn module). Do not deploy the Worker.

## Review Focus

1. **The load sweep.** The chase camera starts at `[0, 5, 8]` and lerps. With the ship 105 away it would sweep through the sun. Test: Task 1, Step 6 (camera within 30 of `SPAWN` on the first rendered frames).
2. **Orbit lock or planet fly-through at the pad.** Test: Task 1, Step 1 (spawn clearance against the swept orbits with moon reach).
3. **Exposure differs between tiers.** The composer path applies exposure in its ToneMapping pass; the low-perf path applies it in the renderer, and custom shaders without tone mapping skip it. Test: Task 4, Step 8 (`toneMappingExposure` read in both tiers, and the sun's on-screen brightness equal within 10% across exposures in both tiers).
4. **Terminator acne or self-shadowing on planets** from the per-fragment test. Test: Task 6, Step 1 (the self index is excluded) and the Task 7 screenshot of a lit planet with no moon in front.
5. **Beacons near the new pad.** The client must refuse them. Test: Task 1, Step 1 (`validateDrop` at `SPAWN` refused, 16 away accepted).

---

### Task 1: One spawn, moved to 0.92 AU

**Files:**
- Create: `src/data/spawn.ts`. Export `SPAWN = { x: -50, y: 62, z: 69 } as const` and `SPAWN_PAD_R = 0.6` (today's `isNearSpawn` box half-width). No imports.
- Modify:
  - `src/components/canvas/Spaceship.tsx:80,139,177,773`: use `SPAWN`; `isNearSpawn` becomes `|x−SPAWN.x|<0.6 && |z−SPAWN.z|<0.6 && |y−SPAWN.y|<3`.
  - `src/store/spaceStore.ts:220`: the `flight` initial x, y, z come from `SPAWN`.
  - `src/utils/beacons.ts:22-26`: import `SPAWN` from `../data/spawn`. `SPAWN_KEEP_OUT` stays 15.
  - `src/components/canvas/GlobalCanvas.tsx:448`: the initial camera sits behind and above `SPAWN`. The first frame also snaps the chase camera (`snapCamera`), so there is no sweep.
  - `tests/beacons.test.ts:21-26`, `tests/intercept.test.ts:7`, `tests/shipyardGate.test.ts:14`, `tests/careerTrail.test.ts:13`: import `SPAWN` instead of literals. Expect `careerTrail.test.ts` to fail until Task 2.
  - `tests/e2e/beacons.probe.mjs:92-117`: the pad check teleports to `SPAWN` + (2, 0, 2). The number-key drop teleports 40 away from the pad first.
- Test: `tests/spawn.test.ts`

**Interfaces:**
- Produces: `SPAWN`, `SPAWN_PAD_R` from `src/data/spawn.ts`. Later tasks import them.

- [ ] **Step 1: Write the failing test** `tests/spawn.test.ts`. Use the clearance helpers in `tests/helpers/clearance.ts` (`closestApproach`, `beltClearance`, `MOON_REACH_FACTOR`, `MARGIN`) and the colliders in `src/data/asteroids.ts`.

```ts
describe("spawn at 0.92 AU (F3 revision)", () => {
  it("sits 105.4 from the sun", () => { expect(Math.hypot(SPAWN.x, SPAWN.y, SPAWN.z)).toBeCloseTo(105.4, 1); });
  it("gets about Ruangrapi's sunlight (1.0–1.3x)", () => { const r = Math.hypot(SPAWN.x, SPAWN.y, SPAWN.z); const k = (AU / r) ** 2; expect(k).toBeGreaterThan(1); expect(k).toBeLessThan(1.3); });
  it.each(planets.map((p) => [p.name, p] as const))("clears %s's swept orbit, moons included, by a wide margin", (_, p) => {
    expect(closestApproach(p, [SPAWN.x, SPAWN.y, SPAWN.z])).toBeGreaterThan(p.size * MOON_REACH_FACTOR + 8.5 + MARGIN + 40);
  });
  it("is clear of the belt and the halo", () => {
    expect(beltClearance([SPAWN.x, SPAWN.y, SPAWN.z], 0.436, 40, 70, 2.5)).toBeGreaterThan(15);
    expect(beltClearance([SPAWN.x, SPAWN.y, SPAWN.z], 1.31, 80, 95, 4.5)).toBeGreaterThan(15);
  });
  it("is clear of every scenery asteroid", () => { for (const a of ASTEROIDS) expect(d3(a.pos, SPAWN) - a.r).toBeGreaterThan(20); });
  it("refuses beacons on the new pad and accepts them 16 away", () => {
    expect(validateDrop({ x: SPAWN.x + 2, y: SPAWN.y, z: SPAWN.z + 2 }, /*…*/).ok).toBe(false);
    expect(validateDrop({ x: SPAWN.x, y: SPAWN.y, z: SPAWN.z + 16 }, /*…*/).ok).toBe(true);
  });
});
```

Use the real names of the asteroid list and the `validateDrop` signature (read `src/data/asteroids.ts` and `src/utils/beacons.ts`). The assertions and numbers above are binding.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/spawn.test.ts`
Expected: FAIL, cannot resolve `../src/data/spawn`.

- [ ] **Step 3: Implement** the module and the four replacements listed under Files.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/spawn.test.ts tests/beacons.test.ts tests/intercept.test.ts tests/shipyardGate.test.ts`
Expected: PASS. `shipyardGate`'s "under 100 from spawn" holds at 45. If `intercept.test.ts` cases no longer describe a sensible first flight from the new pad, update their expectations and say so in the report.

- [ ] **Step 5: Confirm nothing else holds the old pad**

Run: `grep -rnE "z: ?18\b|\b0, ?0, ?18\b" src tests`
Expected: no spawn hits left (shard or other unrelated hits are fine; list them in the report).

- [ ] **Step 6: Add an e2e check** to `tests/e2e/smoke.probe.mjs`: **"the camera starts at the ship, not across the system"**. Read `__fitz.camera.position` on the first frames after the scene is ready and require its distance to `SPAWN` to be under 30.

- [ ] **Step 7: Commit**

`feat(spawn): one SPAWN constant, moved out to 0.92 AU (F3 revision)`

---

### Task 2: Career trail and spawn-side layout

**Files:**
- Modify:
  - `src/data/careerTrail.ts`: `TRAIL_START`, `TRAIL_BEND`, `TRAIL_END`, plus the header comment.
  - `src/data/shards.ts`: shards 0 ("WELCOME, PILOT") and 9 move beside the new pad, and the "TWO SHARDS THIS CLOSE TO SPAWN" fact stays true. Shard 6 ("near the sun") stays.
  - `src/components/canvas/DataShards.tsx:37`: comment.
  - Copy that says the ring course or the buoys are "by/beside the spawn pad": `src/data/ringCourse.ts:5`, `src/components/canvas/RingCourse.tsx:54`, `src/data/chatterLines.ts:15`, `README.md:30,35`, `docs/QA-CHECKLIST.md:127`. The ring course stays where it is; describe it as in the inner belt.
  - `tests/careerTrail.test.ts`: the spawn-distance check now reads `SPAWN` (Task 1). Keep every other clearance rule.
- Do not edit old changelog entries (they are history).

**Interfaces:**
- Consumes: `SPAWN` (Task 1). Produces: the new trail constants (same names and types).

- [ ] **Step 1: Run the trail test** and see the spawn-distance case fail. Run: `npx vitest run tests/careerTrail.test.ts`. Expected: FAIL on "starts 30-45 units from the spawn point".
- [ ] **Step 2: Choose the trail.** The arc runs from a start 30–45 from `SPAWN` to an end beside `STATION_POS` (unchanged). Choose `TRAIL_BEND` so every existing rule in `tests/careerTrail.test.ts` passes:
  - planet swept-orbit clearance with moon reach;
  - sun, portal, asteroids, rings and shards;
  - belt and halo;
  - equal arc steps, buoy spacing of 20 or more.

  A small search script in your scratch space is the intended way. Record the chosen points and their margins in the report.
- [ ] **Step 3: Move shards 0 and 9** beside the new pad (8–12 from `SPAWN`). They must pass `tests/planetClearance.test.ts` and `tests/shards.test.ts`.
- [ ] **Step 4: Update the copy** listed under Files.
- [ ] **Step 5: Run the tests**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

`feat(career): buoy trail and welcome shards follow the new spawn`

---

### Task 3: Probes that fly from the pad

**Files:** only those in `tests/e2e/` that fail because of the new pad. Known candidates: `flight.probe.mjs` (wrap seam, 90 s deadline), `reducedmotion.probe.mjs`, `fuel.probe.mjs`, `gamepad.probe.mjs`, `touch.probe.mjs`, `livesky.probe.mjs`, `events.probe.mjs`.

- [ ] **Step 1: Run the full suite.** `npm run build && npm run test:e2e`. Record every failure with its check name.
- [ ] **Step 2: Fix each failure at its cause.** A probe that assumed the old pad gets an explicit teleport or `breakOrbit` to a known point, with a comment naming the new spawn. A failure that reveals a real game problem (for example the first flight orbit-locking within seconds, or a world event clipping the pad) is reported as `DONE_WITH_CONCERNS` with details, not papered over.
- [ ] **Step 3: Run the full suite again.** Expected: all checks pass, programs tour `added=0`.
- [ ] **Step 4: Commit**

`test(e2e): probes that flew from the old pad`

---

### Task 4: Inverse-square sunlight with exposure (F3; L19)

**Files:**
- Create: `src/utils/sunLight.ts`
- Modify:
  - `src/components/canvas/GlobalCanvas.tsx:385-390` (`SunLight`): `decay={2}`, with intensity from `sunLight.ts` and the same relative flare swell. Add an `ExposureDriver` component mounted in both tiers.
  - The sun (`src/components/canvas/Sun.tsx`: core, corona, `SunFlare` sprites) and the instrument overlays (`src/components/canvas/guideLine.ts`: `makeGuideLineMaterial`, `makePlanetRingMaterial`) multiply their output by a shared exposure-compensation uniform. That uniform equals `1 / exposure` wherever the scene is exposed by the post pass, and in the low-perf tier wherever that material is tone-mapped by the renderer; otherwise 1. Read how each material is tone-mapped in each tier and handle both.
  - `docs/UNIVERSE-RULES.md`: L19 → Follows.
- Test: `tests/sunLight.test.ts`

**Interfaces:**
- Produces, from `src/utils/sunLight.ts`:
  - `SUN_IRRADIANCE_AT_AU = 2.1`
  - `SUN_LIGHT_INTENSITY = SUN_IRRADIANCE_AT_AU * AU * AU`
  - `SUN_FLARE_SWELL = 1.1 / 2.1`
  - `EXPOSURE_POWER = 1.5`, `EXPOSURE_MIN = 0.15`, `EXPOSURE_MAX = 2.5`, `EXPOSURE_HALF_LIFE_S = 1.5`
  - `sunIrradiance(d: number): number`
  - `targetExposure(d: number): number`
  - `stepExposure(current: number, target: number, dt: number, snap: boolean): number`
  - `exposureCompensation`: a shared `{ value: number }` uniform object

- [ ] **Step 1: Write the failing tests** `tests/sunLight.test.ts`

```ts
it("irradiance at 1 AU is today's 2.1, and falls with distance squared", () => {
  expect(sunIrradiance(AU)).toBeCloseTo(2.1, 9);
  expect(sunIrradiance(2 * AU)).toBeCloseTo(2.1 / 4, 9);
});
it("exposure is exactly 1 at 1 AU and follows (d/AU)^1.5 between the clamps", () => {
  expect(targetExposure(AU)).toBeCloseTo(1, 12);
  expect(targetExposure(185)).toBeCloseTo((185 / 115) ** 1.5, 9);
  expect(targetExposure(1)).toBe(0.15);
  expect(targetExposure(10_000)).toBe(2.5);
});
it("the outer system reads dimmer but readable; the spawn reads as today", () => {
  const net = (d: number) => (sunIrradiance(d) * targetExposure(d)) / 2.1;
  expect(net(185)).toBeCloseTo(0.79, 2);
  expect(net(250)).toBeCloseTo(0.53, 2);
  expect(net(105.4)).toBeGreaterThan(0.95);
  expect(net(105.4)).toBeLessThan(1.15);
});
it("eases with a 1.5 s half-life and snaps when asked", () => {
  expect(stepExposure(1, 2, 1.5, false)).toBeCloseTo(1.5, 9);
  expect(stepExposure(1, 2, 0.016, true)).toBe(2);
});
```

- [ ] **Step 2: Run them and see them fail.** Run: `npx vitest run tests/sunLight.test.ts`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement `sunLight.ts`.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Wire it in**
  - `SunLight` uses decay 2 and `SUN_LIGHT_INTENSITY × (1 + SUN_FLARE_SWELL × flare)`.
  - `ExposureDriver` reads the camera's distance from the origin each frame, steps `gl.toneMappingExposure` (snap under reduced motion), and updates `exposureCompensation` without allocating.
  - Then apply the compensation as described under Files.
- [ ] **Step 6: Verify the tiers by reading code.** For each compensated material, write down in the report which pass tone-maps it in each tier, and therefore what the compensation must be.
- [ ] **Step 7: Add e2e checks** to `tests/e2e/sky.probe.mjs`, with reduced motion on so exposure snaps:
  - **"exposure is 1 at Ruangrapi's distance"**: teleport to a point 115 from the sun, clear of planets; `gl.toneMappingExposure` is within 0.02 of 1.
  - **"exposure falls near the sun and rises far out"**: at 40 from the sun it is below 0.3; at 230 it is above 2.
  - **"the sun's disc looks the same at every exposure"**: sample the brightest pixel of the sun's disc at d = 115 and at d = 230 with the sun in view. They must be within 10%.
- [ ] **Step 8: Repeat Step 7 in the low-perf tier.** Use the project's existing way to force low-perf in probes.
- [ ] **Step 9: Run the probes.** `npm run build && npm run test:e2e sky transition programs`. Expected: PASS and programs tour `added=0`.
- [ ] **Step 10: Commit**

`feat(light): inverse-square sunlight with camera exposure (F3, L19)`

---

### Task 5: The sun-shadow module (F4 core)

**Files:**
- Create: `src/components/canvas/sunShadow.ts`
- Test: `tests/sunShadow.test.ts`

**Interfaces:**
- Consumes: `sunVisibility(cam: Point, bodies: readonly Occluder[], sunRadius: number): number` from `src/utils/sunOcclusion.ts`. This is the CPU reference, and the GLSL must implement the same disc-coverage maths.
- Produces:
  - `MAX_OCCLUDERS = 8`.
  - `sunShadowUniforms`: shared uniform objects:
    - `uOccluders: { value: THREE.Vector4[] }`, length `MAX_OCCLUDERS`: xyz is the world position, w is the radius;
    - `uOccluderCount: { value: number }`;
    - `uSunView: { value: THREE.Vector3 }`: the sun's view-space position, refreshed each frame.
  - `setOccluder(i: number, x: number, y: number, z: number, r: number): void`.
  - `patchSunShadow(material: THREE.Material, mode: "fragment" | "object", opts?: { selfIndex?: number }): { sunVis?: { value: number } }`.
    - It composes with any existing `onBeforeCompile`.
    - It sets a `customProgramCacheKey` that includes the mode.
    - In `"fragment"` mode the shader computes coverage per fragment against the occluders, skipping `selfIndex`.
    - In `"object"` mode it multiplies by the returned per-material `sunVis` uniform.
    - Either way it scales only the point light at `uSunView` (the sun), never the engine or portal light.
  - `SUN_SHADOW_GLSL: string`: the shader chunk, exported for tests.

- [ ] **Step 1: Write the failing tests.**
  - `patchSunShadow` keeps an existing `onBeforeCompile` working. Run the composed callback on a stub shader and assert that both modifications are present.
  - Cache keys differ between `"fragment"` and `"object"`, and between two different `selfIndex` values.
  - `setOccluder` writes into the same `Vector4` instances (identity preserved, so no allocation).
  - `SUN_SHADOW_GLSL` defines the coverage function and the sun-light gate.
  - The object-mode `sunVis` starts at 1.
- [ ] **Step 2: Run them and see them fail.** Run: `npx vitest run tests/sunShadow.test.ts`. Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement** against three r185's `lights_fragment_begin` point-light loop. Identify the sun light by comparing `pointLight.position` with `uSunView` within a small epsilon.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit**

`feat(shadow): analytic sun-shadow patch, CPU reference sunVisibility (F4)`

---

### Task 6: Eclipses on planets, moons and the ship (F4; L20)

**Files:**
- Modify:
  - `src/components/canvas/SpacePlanets.tsx`:
    - patch the three planet surface materials in `"fragment"` mode, with `selfIndex` = that planet's slot, composing with Ruangrapi's `cityLights` `onBeforeCompile`;
    - patch moon materials in `"object"` mode;
    - each frame, write the occluder slots (0–2 the planets, 3–7 the moons, using their world positions and radii; no allocation);
    - each frame, update every moon's `sunVis` from `sunVisibility` against the planets.
  - `src/components/canvas/Spaceship.tsx`: patch the player ship's hull materials in `"object"` mode, and update `sunVis` each frame from `sunVisibility(shipPos, planets + moons, SUN_RADIUS)`. Ghost and race-ghost ships have their own materials; leave them alone.
  - `docs/UNIVERSE-RULES.md`: L20 → Follows. `docs/PERF-BUDGETS.md`: the new program counts, if they rose.
- Test: `tests/e2e/mechanics.probe.mjs` (or the probe that already freezes planets with reduced motion)

**Interfaces:**
- Consumes: `patchSunShadow`, `setOccluder`, `sunShadowUniforms`, `MAX_OCCLUDERS` (Task 5); `sunVisibility` (`src/utils/sunOcclusion.ts`).

- [ ] **Step 1: Write the failing e2e checks**, with reduced motion on so the planets are frozen:
  - **"the ship goes dark in a planet's umbra"**: teleport the ship to `P + unit(P) × size × 2.5`, where P is Ruangrapi's live position, so the planet is between the ship and the sun. The ship's `sunVis` is below 0.05.
  - **"…and is fully lit beside it"**: teleport sideways by 4× size. `sunVis` is above 0.95.
  - **"occluder slots track the moons"**: every moon's slot is within 0.01 of its mesh's world position.
  - **"a planet does not shadow itself"**: a planet's own slot is skipped. Assert the `selfIndex` cache key per planet through the debug bridge.
- [ ] **Step 2: Run them and see them fail.** Run: `npm run build && npm run test:e2e mechanics`. Expected: FAIL; there is no `sunVis` yet.
- [ ] **Step 3: Implement** the wiring listed under Files. Expose the ship's `sunVis` and the occluder slots on `window.__fitz` in dev, following `src/debug/bridge.ts`.
- [ ] **Step 4: Run the probes.** `npm run test:e2e mechanics programs transition`. Expected: PASS; programs tour `added=0`. Any warm-up program increase goes into `docs/PERF-BUDGETS.md`.
- [ ] **Step 5: Commit**

`feat(shadow): eclipses — moons shadow planets, planets shadow moons and the ship (F4, L20)`

---

### Task 7: Changelog, screenshots and verification

**Files:** `src/data/changelog.ts`, `README.md` (if it describes the spawn view), `docs/QA-CHECKLIST.md` (light and eclipse items).

- [ ] **Step 1: Changelog entry.** Title "Real Sunlight", id `2026-10-16-real-sunlight`, `pr: 30`, within the format limits:
  - **what:** the light falls off with distance from the sun and the camera adapts; planets cast real shadows and moons eclipse; you now start out near Ruangrapi's orbit;
  - **why:** near the sun the old spawn would be blinding under real light; shadows were missing;
  - **how:** inverse-square sun, auto-exposure, analytic eclipses with no shadow maps.

  Run: `npx vitest run tests/changelog.test.ts`. Expected: PASS.
- [ ] **Step 2: Screenshots.** Playwright MCP against `npm run dev -- --port 5200 --strictPort`; stop only your PID; close the tabs. Capture:
  - the view at load;
  - Ruangrapi from the spawn;
  - Fuxx close up (dimmer);
  - the inner belt near the sun (brighter, stars fading);
  - a moon's shadow on a planet;
  - the ship in a planet's umbra;
  - a lit planet with no moon in front (no acne);
  - the same three in the low-perf tier.

  Describe each in the report.
- [ ] **Step 3: Full verification.**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx vitest run && npm run lint && npm run build && npm run test:e2e`
Expected: all green; lint shows only the one existing warning.
- [ ] **Step 4: Commit**

`docs: Real Sunlight changelog and QA items`

The controller pushes and opens the PR after the final review.
