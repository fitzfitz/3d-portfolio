# New Worlds C1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five scan-only worlds orbit past the Mars-type. Each is lawful where it orbits, photoreal and charted on first scan. The system edge moves to 480 and the light law reaches it. The logbook records the survey and grants the local title CARTOGRAPHER.

**Architecture:**
- A pure layer, independent of rendering:
  - `worldPhysics.ts`: flux and equilibrium temperature;
  - `worldTypes.ts`: which type can exist where;
  - `worlds.ts`: the world table.
  - Tests prove it is lawful and clear of everything.
- Assets come from seeded generators, gated on Blender Cycles turntables. A new `SpaceWorlds.tsx` renders the worlds next to `SpacePlanets.tsx`, reusing the planet material path.
- Occluders become 16 fixed slots, with a distance self-skip instead of per-body programs.
- Charting is a separate store slice (`fitz-charted`) feeding a new logbook section and an SVG chart.

**Tech Stack:** React 19, @react-three/fiber 9, three 0.185, zustand, Vitest, Node e2e probes (`npm run test:e2e`), sharp, Blender 5.1.2 (`~/Applications/Blender.app`, headless bpy).

**Spec:** `docs/superpowers/specs/2026-10-17-new-worlds-design.md`. This plan covers **C1 only (PR #34)**. C2 (the live sky) gets its own plan after C1 merges.

## Global Constraints

**Branch and scope**
- Branch `feat/new-worlds`, which already holds the spec commits. One PR, #34.
- **No change to `beacon-api/`, `src/utils/liveSkyProtocol.ts` or `src/data/plumeColors.ts`.** The Worker imports them, and they are C2. `VALIDATION_RADIUS` stays 520.

**The worlds**
- Roster (ids are final; they are saved in visitors' browsers):

| Id | Name | Namesake | Size (u) | Bond albedo | Axial tilt |
|---|---|---|---|---|---|
| `w-rock` | AIRLESS ROCK | Mercury | 5.7 | 0.068 | 0.03° |
| `w-ringed` | RINGED GIANT | Saturn | 15 (flattening 0.10) | 0.342 | 26.7° |
| `w-tilted` | TILTED ICE GIANT | Uranus | 13.5 | 0.300 | 97.8° |
| `w-blue` | BLUE ICE GIANT | Neptune | 13 | 0.290 | 28.3° |
| `w-dwarf` | SALT-SPOTTED DWARF | Ceres | 3.5 | 0.034 | 4° |

- Size order, pinned in `universeRules`: gas giant 16 > 15 > 13.5 > 13 > Earth-type 12 > Mars-type 8 > 5.7 > 3.5.
- Every stated number is true at the world's own orbit. `T_eq = 278.6 K · (1 − A)^¼ / √(r/AU)`, and flux is `(AU/r)²` S⊕. Namesake data is labelled as the real planet's.
- Orbits are circular (e = 0). The world-vs-world and world-vs-planet gap is ≥ 7 after both bodies. Clearances follow the existing rules; the ringed giant's reach is 2.3 × size.
- Placement preferences:
  - `w-dwarf` near 318 (2.77 AU);
  - `w-rock` innermost;
  - the ice giants outermost.

**Space and light**
- `SYSTEM_RADIUS` 400 → 480. `HAZE_START` = `SYSTEM_RADIUS − 40` (440), derived, not literal.
- `EXPOSURE_MAX = (SYSTEM_RADIUS / AU) ** EXPOSURE_POWER` (≈ 8.53).
- The fill falls off: ambient light intensity and `scene.environmentIntensity` × `irradianceVsAU(camera distance)`, clamped to at most 1.
- The camera far plane is 1500.

**Rings**
- Profile in equatorial R: C 1.24–1.53, B 1.53–1.95, Cassini 1.95–2.03, A 2.03–2.27, Encke ~2.21.
- Viewer opacity `1 − exp(−τ/|μ|)`; sunlight transmitted to the planet `exp(−τ/μ₀)`.
- The fluid Roche limit for this world is ≈ 2.2 R, and the A ring's edge sits at the limit.
- The rings' shadow blur is a disclosed P3 artifact.

**Rendering and performance**
- No new shader program during play: the `programs.probe.mjs` tour adds 0.
- Frame loops allocate nothing. Both perf tiers and reduced motion keep working.
- Worlds are always mounted. Their textures load in the main Suspense. Charting toggles visibility only.
- `MAX_OCCLUDERS` 8 → 16 with fixed slots. No per-frame nearest-N selection.

**Assets**
- The `public/models` cap goes 8 MiB → 9 MiB.
- Shipped maps come from seeded scripts. NASA imagery is reference only and never shipped. No Blender add-on is installed without naming it to the owner.

**Logbook and title**
- Charting lives in its own localStorage key, `fitz-charted`; never `fitz-logbook`.
- `logbookCount` stays 11.
- The AURUM plume is C2, not here.

**Docs and process**
- Changelog: id `2026-10-17-new-worlds`, title "New Worlds", `pr: 34`.
- Subagents never install packages, never kill processes by name, never dispatch subagents and never push.
- Port 5199 must be free before any e2e run.
- Owner gates:
  - **after Task 2** (the turntables): the controller stops for the owner;
  - **in Task 11** (in-game screenshots, before merge).

## Review Focus

1. **A returning visitor with no, old or corrupt `fitz-charted`** (missing, not JSON, unknown ids, duplicate ids, bad dates). They load 0 or the valid subset, and `fitz-logbook` is never touched. Test: Task 9, Step 1.
2. **Scanning the same world again, or a second world while the radio is busy.** Each world is charted once, each charting line queues behind its scan report, and the 5/5 line fires exactly once. Test: Task 9, Step 1.
3. **Hitting a world at warp** (39 u/s at dt 0.05, the frame clamp). The ship ends outside the surface, with no tunnelling and the camera never inside. Test: Task 8, Step 1.
4. **The recruiter path.** Jump keys and pad jumps are unchanged, the waypoint never targets a world, and the orbit lock or zone never engages near one. Test: Task 8, Step 1.
5. **The low-perf tier.** Rings and atmospheres are exposed like their planet, and the tour adds 0 programs with low-perf on. Test: Task 4, Step 1 and Task 10, Step 2.

---

### Task 1: The lawful core: physics, the type law, the world table, placement

**Files:**
- Create:
  - `src/utils/worldPhysics.ts`
  - `src/data/worldTypes.ts`
  - `src/data/worlds.ts`
  - `tests/worldPhysics.test.ts`
  - `tests/worldTypes.test.ts`
  - `tests/worldClearance.test.ts`
  - `tests/worldOrbitSearch.test.ts` (the search tool)
- Modify:
  - `tests/helpers/clearance.ts`: `closestApproach` takes any `{ orbit: OrbitalElements }`.
  - `tests/universeRules.test.ts`: the size ladder, and the L9 named exceptions.

**Interfaces:**
- Produces:
  - `fluxEarth(r: number): number`
  - `equilibriumTempK(r: number, bondAlbedo: number): number`
  - `kToC(k: number): number`
  - `type WorldTypeId = "airless-rock" | "ringed-giant" | "ice-giant" | "salt-dwarf" | "venus-type" | "nitrogen-dwarf"`
    - The last two exist so the law can reject them.
  - `WORLD_TYPES: Record<WorldTypeId, { label: string; canExistAt(r: number, bondAlbedo: number): { ok: boolean; reason: string } }>`
  - `type WorldId = "w-rock" | "w-ringed" | "w-tilted" | "w-blue" | "w-dwarf"`
  - `interface WorldData { id: WorldId; name: string; namesake: string; type: WorldTypeId; size: number; flattening: number; bondAlbedo: number; axialTiltDeg: number; spin: number; orbit: OrbitalElements; map: string; hint: string; namesakeRef: { distanceAU: number; tempC: number } }`
  - `WORLDS: readonly WorldData[]`
  - `WORLD_IDS`
  - `isWorld(id: string): id is WorldId`
  - `WORLD_COUNT = 5`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/worldPhysics.test.ts
it("flux is inverse-square in AU", () => {
  expect(fluxEarth(AU)).toBeCloseTo(1, 12);
  expect(fluxEarth(2 * AU)).toBeCloseTo(0.25, 12);
});
it("equilibrium temperature: Earth-like at 1 AU, falls as 1/sqrt(r)", () => {
  expect(equilibriumTempK(AU, 0)).toBeCloseTo(278.6, 1);
  expect(equilibriumTempK(4 * AU, 0)).toBeCloseTo(139.3, 1);
});
// Real Ceres (2.77 AU, A 0.034): about 166 K
it("matches Ceres at its real distance", () => {
  expect(equilibriumTempK(2.77 * AU, 0.034)).toBeCloseTo(166, 0);
});

// tests/worldTypes.test.ts
it("a Venus-type cannot exist past ~1.1 S⊕", () => {
  expect(WORLD_TYPES["venus-type"].canExistAt(1.2 * AU, 0.77).ok).toBe(false);
});
it("a nitrogen-ice dwarf cannot exist inside the system edge", () => {
  expect(WORLD_TYPES["nitrogen-dwarf"].canExistAt(SYSTEM_RADIUS_FOR_C, 0.6).ok).toBe(false);
});
it.each(WORLDS.map((w) => [w.id, w] as const))("%s can exist where it orbits", (_, w) => {
  const v = WORLD_TYPES[w.type].canExistAt(w.orbit.radius, w.bondAlbedo);
  expect(v.ok, v.reason).toBe(true);
});

// tests/worldClearance.test.ts, against swept orbits (SAMPLES):
//   every world vs every planet and every other world: gap >= 7 after both bodies
//     (ringed reach 2.3 * size);
//   every world vs both COMETS paths (sampled over their period);
//   every world vs JELLY_PATH (> size + JELLY_RADIUS + 2);
//   every world vs the belt, the halo and SUN_COLLIDER;
//   every world vs every shard, scenery asteroid, ring gate, buoy, landmark and spawn,
//     by the same rule each of those uses in planetClearance / careerTrail / shipyardGate / spawn tests;
//   every world's outer reach + its well radius stays inside HAZE_START.

// tests/universeRules.test.ts
it("L36: the size ladder runs gas giant > ringed > ice giants > earth > mars > rock > dwarf", ...);
it("L9: only the tilted ice giant is retrograde-tipped (axial tilt > 90°), a named exception", ...);
```

  `SYSTEM_RADIUS_FOR_C` is 480, imported once Task 3 lands. Until then, the test uses the literal `480` with a `// Task 3` comment.

- [ ] **Step 2: Run them and see them fail.**
  - Run: `npx vitest run tests/worldPhysics.test.ts tests/worldTypes.test.ts tests/worldClearance.test.ts tests/universeRules.test.ts`
  - Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the physics and the type law.**
  - `worldTypes.ts` thresholds, each with a source comment and stated as approximate:
    - venus-type: flux ≥ 1.1 S⊕ (runaway greenhouse, Kopparapu et al. 2013);
    - nitrogen-dwarf: T_eq ≤ 60 K (N₂ triple point 63 K);
    - ringed-giant: T_eq ≤ 170 K (water-ice rings survive);
    - salt-dwarf: T_eq ≤ 180 K (subsurface water ice, Ceres-like);
    - airless-rock and ice-giant: unconstrained (the reason is "forms beyond the frost line and may migrate").

- [ ] **Step 4: Write the search tool and run it to choose the orbits.**
  - `tests/worldOrbitSearch.test.ts` is wrapped in `describe.skipIf(!process.env.WORLD_SEARCH)`.
  - It grid-searches radius (±25 around the preferences), inclination −40°…40° in 2.5° steps, and node 0…360° in 10° steps, under the same rules as `worldClearance`. It prints the best margins per world.
  - Run: `WORLD_SEARCH=1 npx vitest run tests/worldOrbitSearch.test.ts`.
  - Put the chosen elements in `WORLDS`, with `angularSpeed: sunOmega(radius)` (Kepler), and a comment giving each world's worst margin.
  - **Ruling:** the spec names `scripts/worlds/searchOrbits.mjs`. The repo has no TS runner outside vitest, so the tool lives here, skipped by default.

- [ ] **Step 5: Run all checks.**
  - Run: `npx vitest run && npx tsc --noEmit -p tsconfig.app.json && npm run lint`
  - Expected: all green. `worldClearance` positive everywhere.

- [ ] **Step 6: Commit**
  - Message: `feat(worlds): lawful core — world physics, the type law, five worlds placed and cleared`

---

### Task 2: Photoreal assets and the Cycles turntables (owner gate follows)

**Files:**
- Create:
  - `scripts/textures/gen_worlds.mjs`: `w-ringed`, `w-tilted`, `w-blue` and `w-dwarf` albedo maps, plus `w-ringed_ring` (an RGBA strip, 2048×4).
  - `scripts/blender/gen_world_rock.py`: `w-rock` albedo and normal, porting `gen_moon.py`'s craters, rays and maria. Seeded.
  - `scripts/blender/turntable_worlds.py`: Cycles renders.
  - `tests/worldMaps.test.ts`
- Modify:
  - `scripts/optimize-assets.mjs`: the planet list gains the new names.
  - `scripts/blender/generate.sh`
  - `assets-src/MANIFEST.md`: rows, plus the NASA references, cited only.
  - `tests/assetProvenance.test.ts`: `GENERATORS` entries.
  - `tests/assetContracts.test.ts`: cap 8 → 9 MiB, with the reason.

**Interfaces:**
- Consumes: `WORLDS` (Task 1) for orbit radius and target albedo.
- Produces the files `public/models/{w-rock,w-rock_normal,w-ringed,w-ringed_ring,w-tilted,w-blue,w-dwarf}.webp`:

| Map | Size |
|---|---|
| `w-rock`, `w-ringed`, `w-blue` | 2048×1024 |
| `w-rock_normal`, `w-tilted`, `w-dwarf` | 1024×512 |
| `w-ringed_ring` | 2048×4, lossless |

- [ ] **Step 1: Write the failing test** `tests/worldMaps.test.ts` (sharp):
  - Each map is 2:1 at the width above.
  - Seam: mean |column 0 − column W−1| < 2/255. Pole rows are near-uniform.
  - Linear-luminance median within ±35% of target:

| Map | Target median |
|---|---|
| `w-rock` | 0.025 |
| `w-ringed` | 0.088 |
| `w-tilted` | 0.086 |
| `w-blue` | 0.078 |
| `w-dwarf` | 0.016 |

  - Ring strip:
    - the strip spans the C ring's inner edge (1.24 R, t = 0) to the A ring's outer edge (2.27 R, t = 1); τ is 0 in the first and last texel;
    - the Cassini division's τ is < 0.15 × the B ring's peak;
    - the Encke gap's τ is below the A ring's mean.
  - Each file stays under its own byte cap (≤ 260 KB at 2048, ≤ 90 KB at 1024).
  - Determinism: `gen_worlds.mjs --width=64` run twice gives identical hashes.

- [ ] **Step 2: Run it and see it fail.**
  - Run: `npx vitest run tests/worldMaps.test.ts`
  - Expected: FAIL.

- [ ] **Step 3: Implement the generators.**
  - Reuse `gen_planets.mjs`'s sphere sampling, noise and writer by importing them; don't copy.
  - The looks follow the spec's table. The blue giant's bright streaks are ammonia-ice clouds.
  - Run `npm run assets:generate` for these names, then `npm run assets:optimize`.

- [ ] **Step 4: Run the checks.**
  - Run: `npx vitest run`
  - Expected: green, including provenance and the 9 MiB cap.

- [ ] **Step 5: Render the turntables.**
  - `turntable_worlds.py` renders each world under a sun lamp from the +X direction, with strength ∝ `fluxEarth(r)`. Exposure is set the way the game meters it, so dim stays dim.
  - It renders 8 frames per world, and for `w-ringed` three ring angles: open, near edge-on, and backlit.
  - Output goes to the scratchpad `worlds-turntables/`.
  - Download a NASA reference image per namesake (Mercury MESSENGER, Saturn Cassini, Uranus Voyager 2/JWST, Neptune Voyager 2, Ceres Dawn) into that folder for side-by-side contact sheets. **Do not commit them.**
  - Commit only the scripts and the maps.

- [ ] **Step 6: Commit**
  - Message: `feat(worlds): seeded photoreal maps, ring strip, Cycles turntables`

**→ OWNER GATE:** the controller shows the contact sheets and waits for approval or look changes before Task 3.

---

### Task 3: The edge moves to 480

**Files:**
- Modify:
  - `src/constants.ts` (`SYSTEM_RADIUS` 480)
  - `src/utils/edgeHaze.ts` (`HAZE_START = SYSTEM_RADIUS - 40`; the comments)
  - `tests/fuel.test.ts` (the claim becomes "more than two and a half diameters": `2437.5 > 5 * SYSTEM_RADIUS`)
  - `tests/realUnits.test.ts` ("8.35")
  - `tests/edgeHaze.test.ts`
  - `tests/e2e/flight.probe.mjs` (`SYSTEM_RADIUS` 480, `EDGE_BOUND` 520, teleport 460)
  - `tests/e2e/harness.mjs` (edge default 480; the `toDeepSpace` point moves, see below)
  - `tests/e2e/mechanics.probe.mjs`
  - `tests/e2e/fuel.probe.mjs` (`SPHERE` 460)
  - `src/components/canvas/GlobalCanvas.tsx` (camera `far` 1500)
  - `README.md`
- Test: `tests/edgeHaze.test.ts`, `tests/worldClearance.test.ts` (adds `deep-space probe point clear of every orbit`).

**Interfaces:**
- Consumes: `WORLDS` and `planets`.
- Produces: `DEEP_SPACE_POINT: readonly [number, number, number]`, exported from `tests/e2e/deepSpacePoint.mjs` (plain data). `harness.mjs` and the clearance test both import it.

- [ ] **Step 1: Write the failing tests.**
  - `HAZE_START === SYSTEM_RADIUS - 40`.
  - `edgeReturn` brings a warp-speed ship back with overshoot < `SYSTEM_RADIUS + 20` and ≤ `VALIDATION_RADIUS`.
  - The deep-space point's distance to every swept planet and world orbit is > reach + 20, and its radius is < `HAZE_START`.

- [ ] **Step 2: Run and see them fail.**
  - Run: `npx vitest run tests/edgeHaze.test.ts tests/worldClearance.test.ts`

- [ ] **Step 3: Implement.**
  - Choose `DEEP_SPACE_POINT` between orbit bands, clear by the test.

- [ ] **Step 4: Run the checks.**
  - Run: `npx vitest run && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run test:e2e flight mechanics fuel`
  - Expected: green.

- [ ] **Step 5: Commit**
  - Message: `feat(space): the system edge moves to 480 for the outer worlds (L18)`

---

### Task 4: Light reaches the edge: exposure, fill falloff, low-perf exposure, stars behind worlds

**Files:**
- Modify:
  - `src/utils/sunLight.ts`: `EXPOSURE_MAX` derived; new `fillScale(cameraDistance: number): number = Math.min(1, irradianceVsAU(cameraDistance))`.
  - The frame hook that runs `cutExposure` / `stepExposure` (find it from `cutExposure`'s callers): sets `ambientLight.intensity = AMBIENT_BASE * fillScale(d)` and `scene.environmentIntensity = fillScale(d)` every frame. No allocation.
  - `src/components/canvas/guideLine.ts` (`RING_FRAG`) and `Atmosphere.tsx`: multiply by `exposureCompensation` when the post pass doesn't expose (low-perf).
  - The star layers (`starLayer.ts` / `GlobalCanvas.tsx`): render as background, behind every world.
- Test: `tests/sunLight.test.ts`, `tests/fillLight.test.ts`, `tests/starLayer.test.ts`

**Interfaces:**
- Produces:
  - `fillScale(d: number): number`
  - `EXPOSURE_MAX`, now ≈ 8.53, from `SYSTEM_RADIUS`

- [ ] **Step 1: Write the failing tests.**
  - `EXPOSURE_MAX ≈ (480/115)^1.5` (8.53).
  - Net brightness `sunIrradiance(r) * targetExposure(r) / sunIrradiance(AU)` at r = 210, 242, 300, 358, 402 is 0.74, 0.69, 0.62, 0.57, 0.53 (±0.01).
  - `fillScale(AU) === 1`, `fillScale(2 * AU) ≈ 0.25`, and `fillScale(50) === 1` (clamped).
  - Low-perf: the ring and atmosphere materials read the exposure uniform when `postPassExposes` is false (assert the uniform is wired and its value equals the exposure after `setExposureCompensation(e, false)`).
  - Star materials draw before opaque geometry and never depth-test in front of a world (assert `renderOrder` < 0 and the depth config chosen).

- [ ] **Step 2: Run and see them fail.**
  - Run: `npx vitest run tests/sunLight.test.ts tests/fillLight.test.ts tests/starLayer.test.ts`

- [ ] **Step 3: Implement.**
  - Update L19's stale "0.53 at the edge" line in `docs/UNIVERSE-RULES.md` here.

- [ ] **Step 4: Run the checks.**
  - Run: `npx vitest run && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run test:e2e sky transition programs`
  - Expected: green, programs added 0. Record whether any reading moved.

- [ ] **Step 5: Commit**
  - Message: `feat(light): exposure and fill reach the system edge; low-perf rings and rims exposed; stars stay behind worlds (L19, L22)`

---

### Task 5: Sixteen occluder slots, one program per material kind

**Files:**
- Modify:
  - `src/components/canvas/sunShadow.ts`: `MAX_OCCLUDERS` 16. Remove the `SUN_SHADOW_SELF` define and the `selfIndex` cache-key part, and replace them with a skip in the loop (`length(o.xyz - p) < 1.05 * o.w`). The ring slot becomes a uniform.
  - `SpacePlanets.tsx`: slot constants.
  - `CloudLayer.tsx`
  - `guideLine.ts`
  - `Spaceship.tsx` (the CPU occluder read)
  - `Sun.tsx` (`OCCLUDERS`)
- Tests: `tests/sunShadow.test.ts` (`:50` → 16; `:152` → cache keys no longer differ by body), `tests/moonOccluders.test.ts`

**Interfaces:**
- Produces: the slot map `OCCLUDER_SLOTS = { planets: 0..2, moons: 3..7, worlds: 8..11 }`, exported from `sunShadow.ts`.
  - `w-blue` (outermost) takes no GPU slot. The `worldSlot(id)` helper returns −1 for it.
  - Its CPU occluder stays in `Sun.tsx` and in the ship's list.

- [ ] **Step 1: Write the failing tests.**
  - `MAX_OCCLUDERS === 16`.
  - Two planet materials with identical features share a cache key.
  - A fragment on the occluder's own surface (and at 1.03 R) is not self-shadowed: the GLSL skip is mirrored by the CPU `sunShadowVisibility`, tested on the CPU path.
  - The world slots are 8–11 and `worldSlot("w-blue") === -1`.

- [ ] **Step 2: Run and see them fail.**
  - Run: `npx vitest run tests/sunShadow.test.ts tests/moonOccluders.test.ts`

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the checks and measure.**
  - Run: `npx vitest run && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run test:e2e transition programs mechanics`
  - Expected: green, programs added 0. Report the program count before and after (it must not rise).
  - Measure GPU p50 with `sunShadowDebug.countOverride` at 8 and 16 in Playwright MCP (Ruangrapi filling the screen, low-perf tier, as the PERF-BUDGETS method describes). Record it in `docs/PERF-BUDGETS.md`.

- [ ] **Step 5: Commit**
  - Message: `refactor(shadows): sixteen fixed occluder slots; self-skip by distance instead of a program per body (L20)`

---

### Task 6: The worlds in the sky

**Files:**
- Create:
  - `src/components/canvas/SpaceWorlds.tsx`
  - `src/utils/worldSpin.ts`
- Modify:
  - `GlobalCanvas.tsx`: mount inside the main Suspense, next to `SpacePlanets`.
  - `spaceStore.ts`: `bodies` is seeded from `[...planets, ...WORLDS]`.
  - `Atmosphere.tsx`: `uDusk` uniform, default the current orange.
  - `LimbDarkening` (exposed for reuse).
- Test: `tests/worldSpin.test.ts`, `tests/spaceWorlds.test.ts`

**Interfaces:**
- Consumes: `WORLDS`, the maps from Task 2, `OCCLUDER_SLOTS` / `worldSlot` (Task 5).
- Produces:
  - `bodies[w.id]` updated every frame;
  - `setScannable(w.id, x, y, z, "WORLD_" + w.name, w.size)`;
  - `worldVisibility: Record<WorldId, { charted: boolean }>`, a module-level object that Task 9 writes;
  - `worldSpinQuaternion(w: WorldData, t: number, out: THREE.Quaternion): THREE.Quaternion`, which sets the axial tilt and spins about that axis.

- [ ] **Step 1: Write the failing tests.**
  - `worldSpinQuaternion` keeps the spin axis fixed in space over t, at the world's tilt from its orbit normal. For `w-tilted`, the axis is 97.8° from the orbit normal.
  - Spin is prograde for all but `w-tilted` (L9).
  - `SpaceWorlds` registers one scannable and one `bodies` entry per world (render with `@react-three/test-renderer` if the repo uses it; otherwise test the pure `updateWorlds(t, outBodies)` helper the component calls).
  - The ringed giant's mesh scale is `[1, 0.9, 1]` in its own frame.

- [ ] **Step 2: Run and see them fail.**
  - Run: `npx vitest run tests/worldSpin.test.ts tests/spaceWorlds.test.ts`

- [ ] **Step 3: Implement.** Reuse the planet material path:
  - `MeshStandardMaterial` with the map, `patchSunShadow` on its world slot;
  - `w-rock` also gets `normalMap`;
  - ice giants get `LimbDarkening` 0.7 and `Atmosphere` thickness 1.04 with a cool `uDusk`;
  - no guide ring and no gravity circle.
  - Orbit positions come from `orbitPosition` into a scratch object.
  - Add the worlds to the CPU occluder lists: the sun glare (`Sun.tsx` `OCCLUDERS`) and the ship's shadow read, from live `bodies` positions.

- [ ] **Step 4: Run the checks.**
  - Run: `npx vitest run && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run test:e2e programs transition`
  - Expected: the tour covers the worlds (they are in `bodies`) and programs added stays 0. Note the readings; the ceilings move in Task 10.

- [ ] **Step 5: Commit**
  - Message: `feat(worlds): five worlds orbit, spin on their axes and catch the light`

---

### Task 7: The ringed giant's rings and their shadow

**Files:**
- Modify:
  - `src/components/canvas/guideLine.ts` (`makePlanetRingMaterial` gains an optional `ringMap`, behind `#ifdef RING_MAP`, plus `uIrradiance`, Lommel–Seeliger lighting and a transmitted term)
  - `sunShadow.ts` (`patchSunShadow` option `ringShadow: { normal: THREE.Vector3 uniform; inner: number; outer: number; map: THREE.Texture }`)
  - `SpaceWorlds.tsx`
- Test: `tests/ringOptics.test.ts`

**Interfaces:**
- Produces two pure mirrors of the GLSL, for tests:
  - `ringViewOpacity(tau: number, mu: number): number = 1 - Math.exp(-tau / Math.abs(mu))`
  - `ringTransmission(tau: number, mu0: number): number = Math.exp(-tau / mu0)`

- [ ] **Step 1: Write the failing tests.**
  - Opacity rises toward 1 as μ → 0, and equals 1 − e^(−τ) face-on.
  - Transmission depends on μ₀ only.
  - For μ₀ ≤ 0.45, the B ring's shadow transmits less than half of the face-on value.
  - Ruangrapi's ring material has no `RING_MAP` define (its program is unchanged).
  - The ring's outer radius = 2.27 × the ringed giant's equatorial size, and L14's Roche value 2.44 × (0.69/0.92)^(1/3) ≈ 2.22 is within 0.06 of it ("at the limit").

- [ ] **Step 2: Run and see them fail.**
  - Run: `npx vitest run tests/ringOptics.test.ts`

- [ ] **Step 3: Implement.**
  - The ring plane is the ringed giant's equator (from `worldSpinQuaternion`'s axis).
  - The ring geometry has 256 θ-segments.
  - Set an explicit `renderOrder`: limb, then atmosphere, then ring.
  - The shadow on the planet blurs by the drawn sun's angular size (comment: a P3 artifact).

- [ ] **Step 4: Run the checks.**
  - Run: `npx vitest run && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run test:e2e programs`
  - Expected: green. Exactly one new program, compiled at warm-up, and the tour adds 0.

- [ ] **Step 5: Commit**
  - Message: `feat(worlds): the ringed giant's rings — real profile, optical depth, their shadow on the planet (L14, L20)`

---

### Task 8: Flying among the worlds: wells, solid surfaces, keep-outs, radar, orbit lines

**Files:**
- Modify:
  - `src/components/canvas/Spaceship.tsx`: `ACTIVE_WELLS` includes `planetWell(w)` per world; the slingshot watch covers worlds; moving surface colliders for worlds.
  - `src/utils/worldCollide.ts` (create): `resolveWorldContact(pos: Vec3, vel: Vec3, center: Vec3, radius: number): boolean`
  - `FuelCrystals.tsx` (keep-outs)
  - `WorldEventDirector.tsx` (comet avoid list only, not convoy targets)
  - `RadarMap.tsx`: uncharted worlds only within `RANGE`, with no rim arrow; charted worlds as planets.
  - `src/utils/logbook.ts`: the slingshot hint becomes "SKIM A PLANET OR WORLD".
  - `SpaceWorlds.tsx`: an orbit line for charted worlds (one line, visibility-toggled).
- Tests:
  - `tests/worldCollide.test.ts`
  - `tests/destinations.test.ts`
  - `tests/gamepad.test.ts`
  - `tests/radarWorlds.test.ts`
  - `tests/gravityWell.test.ts` (the size list no longer pinned to `[16,12,8]`; read it from data)

**Interfaces:**
- Consumes: `bodies`, `worldVisibility` (Task 6).
- Produces: `resolveWorldContact`, and `radarShowsWorld(charted: boolean, dist: number): "blip" | "rim" | "hidden"`.

- [ ] **Step 1: Write the failing tests.**
  - **Warp contact (Review Focus 3):** a ship at 39 u/s aimed at a world's centre, stepped at dt 0.05, always ends with |pos − c| ≥ radius + ship half-length. Its inward velocity is reflected or zeroed, and it never tunnels.
  - **The recruiter path (Review Focus 4):**
    - `JUMP_TARGETS` and `PAD_JUMPS` contain no world id;
    - keys 1–6 map exactly as before;
    - `nextWaypoint` never returns a world;
    - the zone/lock detection input list is `planets` only (assert on the exported list, or the helper the loop uses).
  - **Radar:** `radarShowsWorld(false, 300) === "hidden"`, `radarShowsWorld(false, 150) === "blip"` and `radarShowsWorld(true, 300) === "rim"`.

- [ ] **Step 2: Run and see them fail.**
  - Run: `npx vitest run tests/worldCollide.test.ts tests/destinations.test.ts tests/gamepad.test.ts tests/radarWorlds.test.ts tests/gravityWell.test.ts`

- [ ] **Step 3: Implement.**
  - The contact resolves like the sun's: impact sound, shake (none under reduced motion), and `zeroGravity`.
  - You can fly through the rings.

- [ ] **Step 4: Run the checks.**
  - Run: `npx vitest run && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run test:e2e flight gameplay mechanics`
  - Expected: green.

- [ ] **Step 5: Commit**
  - Message: `feat(worlds): wells, solid surfaces and discovery on radar; worlds stay off the recruiter path`

---

### Task 9: Charting, scan reports, the logbook section, the chart and the title

**Files:**
- Create:
  - `src/utils/charting.ts`: `loadCharted(raw: unknown): ChartRecord[]`, `chartLine(id: WorldId, count: number): string`, `SURVEY_LINE`, `isCartographer(c: readonly ChartRecord[]): boolean`
  - `src/utils/worldReports.ts`: `worldReport(w: WorldData): string`, built from `worldPhysics` plus `formatOrbit`
  - `src/components/dom/SystemChart.tsx` (SVG)
  - `tests/charting.test.ts`
  - `tests/worldReports.test.ts`
- Modify:
  - `spaceStore.ts`:
    - `charted: ChartRecord[]` from `fitz-charted`;
    - `chartWorld(id: WorldId): void`, idempotent: it persists, writes `worldVisibility`, then calls `announceLogbook(chartLine(...))`;
    - at 5/5 it then calls `announceLogbook(SURVEY_LINE)`.
    - at store creation, `worldVisibility` is set from the loaded `charted`, so a returning visitor's orbit lines and radar arrows show at once.
  - `Scanner.tsx`: `if (isWorld(near.id)) store.chartWorld(near.id)`
  - `scanReport.ts`: `worldReport` before the hash fallback.
  - `LogbookPanel.tsx`:
    - the header gets `· CARTOGRAPHER`;
    - a SYSTEM CHART section;
    - a WORLDS CHARTED n/5 section between FLIGHT BADGES and the plume pointer.
  - `LogbookTracker.tsx`: the `WORLDS n/5` suffix.
  - `logbook.ts`: `ALL_LINE` becomes "ALL BADGE PLUMES UNLOCKED".
- Test: `tests/spaceStore.test.ts`, `tests/scanReport.test.ts`, `tests/e2e/logbook.probe.mjs`

**Interfaces:**
- Consumes: `WORLDS`, `worldVisibility`, `isWorld`.
- Produces: `interface ChartRecord { id: WorldId; at: string /* YYYY-MM-DD */ }`, and the store fields `charted` and `chartWorld`.

- [ ] **Step 1: Write the failing tests.**
  - **Corrupt storage (Review Focus 1):** `loadCharted` returns `[]` for `undefined`, `"x"`, `{}` and `[1]`. It keeps valid `{id,at}` entries only, dedupes by id (keeping the earliest date), and drops unknown ids and bad dates. `fitz-logbook` is unchanged after `chartWorld`.
  - **Repeat scans (Review Focus 2):** `chartWorld("w-rock")` twice records once and announces once.
    - Charting all five in a row queues five charting lines and exactly one `SURVEY_LINE`, last.
    - Each line goes through `announceLogbook`, never `sendBroadcast`.
  - **Facts and titles:**
    - `worldReport` contains the world's T_eq in °C, equal to `kToC(equilibriumTempK(r, A))` rounded.
    - It contains `formatOrbit(w.orbit)`, and the namesake value labelled with the namesake's name.
    - No report states a number that `worldPhysics` doesn't produce, apart from namesake data and fixed type facts.
  - `isCartographer` is true only at 5 distinct valid ids.
  - `logbookCount(p).total === 11`.
  - **e2e** `logbook.probe.mjs`:
    - teleport next to `w-dwarf` and hold scan, then `WORLDS 1/5` shows;
    - reload, and it still shows 1/5;
    - the logbook card says CHARTED with today's date.

- [ ] **Step 2: Run and see them fail.**
  - Run: `npx vitest run tests/charting.test.ts tests/worldReports.test.ts tests/spaceStore.test.ts tests/scanReport.test.ts`

- [ ] **Step 3: Implement.**
  - Radio templates:
    - `WORLD CHARTED n/5 — <NAMESAKE>-TYPE: <one fact>`
    - `SYSTEM SURVEY COMPLETE — EVERY WORLD CHARTED. YOU HOLD THE TITLE CARTOGRAPHER.`
  - Card hints come from `WorldData.hint`.
  - The chart is top-down and to scale in r. Uncharted orbits are dashed; charted ones are solid, with the world's dot.

- [ ] **Step 4: Run the checks.**
  - Run: `npx vitest run && npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm run test:e2e logbook`
  - Expected: green.

- [ ] **Step 5: Commit**
  - Message: `feat(worlds): charting — scan reports true where each world orbits, the logbook survey, the system chart, CARTOGRAPHER`

---

### Task 10: Detail by distance and honest budgets

**Files:**
- Modify:
  - `SpacePlanets.tsx` and `SpaceWorlds.tsx`: one shared unit-sphere `LOD` (64/24/12 segments) scaled per body; the overlay shells (atmosphere, limb, clouds) culled past a distance where they cover under one pixel.
  - `tests/e2e/transition.probe.mjs`: a new state "near the ringed giant, rings in frame"; ceilings re-derived.
  - `tests/e2e/programs.probe.mjs`: the tour includes the worlds; the low-perf variant runs it.
  - `docs/PERF-BUDGETS.md`
- Test: those probes, plus `tests/lod.test.ts`.

- [ ] **Step 1: Write the failing test** `tests/lod.test.ts`:
  - The LOD levels share one material per body. The LOD level distances are monotonic and scale with `size`.
  - The shell-cull distance gives a projected radius < 1 px at 1512×802 and FOV 58°.

- [ ] **Step 2: Implement, then run** `npm run test:e2e transition` about 11 times serially, recording calls, triangles and programs per state.
  - Re-derive the ceilings by the rule (+15%, rounded up to ten; programs and lights +1), dated, with what was added.
  - Never pick phases or points to keep worlds out of view.
  - Run `programs` with low-perf pinned on as well (Review Focus 5).
  - Re-measure start-up against 20 s.

- [ ] **Step 3: Run the full suite.**
  - Run: `npx tsc --noEmit -p tsconfig.app.json && npx vitest run && npm run lint && npm run build && npm run test:e2e`
  - Expected: all green, programs added 0 in both tiers. Re-run a hung probe alone and report both runs.

- [ ] **Step 4: Commit**
  - Message: `perf: detail by distance for planets and worlds; budgets re-derived with the worlds in view`

---

### Task 11: Laws, changelog and the owner's screenshots

**Files:**
- `docs/UNIVERSE-RULES.md`:
  - L9 (named exceptions);
  - L14 (rings at the Roche limit);
  - L18 (edge 480);
  - L19 (exposure and fill);
  - L20 (ring shadows, the P3 blur disclosed);
  - L35/L36 (the ladder);
  - a new short entry on the world-type law.
- `src/data/changelog.ts`: `2026-10-17-new-worlds`, "New Worlds", `pr: 34`.
  - **what:** five new worlds past the Mars-type to find and chart, a system chart in the logbook, the title CARTOGRAPHER;
  - **why:** the system had only the three project planets, and the owner wanted real-type worlds rewarded by discovery;
  - **how:** a world-type law so no world sits where it couldn't exist, facts computed from each orbit, seeded photoreal maps, the edge moved to 480, the fuel claim restated.
- `docs/FOLLOW-UPS.md`: the Jupiter-type's flattening, and C2.

- [ ] **Step 1: Docs and changelog.**
  - Run: `npx vitest run tests/changelog.test.ts`
  - Expected: PASS.

- [ ] **Step 2: Owner screenshots** (Playwright MCP against `npm run dev -- --port 5200 --strictPort`; stop only your own PID; close tabs). Use reduced motion, teleport, `setAttitude` and photo mode. Capture:
  - each world close up (2.5 × size) and from the spawn's direction;
  - the rings lit, near edge-on and backlit;
  - Fuxx's and Portfolio's night sides under the fill falloff, against the same frames from `main`;
  - the logbook with 2/5 charted and with 5/5 (CARTOGRAPHER);
  - the radar showing an uncharted blip and a charted rim arrow.

  Save them to the scratchpad `worlds-shots/` and describe each.

- [ ] **Step 3: Commit**
  - Message: `docs: New Worlds — laws, budgets, changelog`
