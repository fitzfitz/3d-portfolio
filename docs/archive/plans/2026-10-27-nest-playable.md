# The Nest, playable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-time visitor can find the Nest, sees a nest with its monsters asleep at home, finds and shoots the monsters easily, and the outer system is no longer washed out.

**Architecture:**
- **Exposure** (`src/utils/sunLight.ts`): `BACKDROP_NET_MAX` drops to 2.2. Two shared glow factors, `glowScale` and `glowScaleUnmapped`, are written by `setExposureCompensation`, so `ExposureDriver` and camera cuts both set them. Self-lit materials multiply by them through a uniform or a per-frame colour/intensity write. A new `look` e2e probe guards the brightness.
- **Finding:** THE NEST is a jump target landing at `NEST_TOW_POSE`, and the radar always shows it (a rim marker beyond range).
- **The nest:**
  - A static cluster of the scenery asteroid rocks plus one glow Points, in the lazily loaded Nest chunk. The rocks are ship colliders.
  - The machine gains sleepers: wave 1's saucers and the tardigrade wait asleep, harmless and untargetable. Crossing the zone wakes the saucers, which become wave 1 in place. Wave 3 wakes the tardigrade. Waves 2 and 3 spawn in front of the ship.
- **Shooting:** `NestState` gains a lock (acquire 25°, hold 40°), click assist (6°), bigger hit spheres, and a strike ring. The ring feeds the spark burst (extra bolt-mesh instances) and the HUD's HIT.
- **HUD:** NestDirector projects the lock, the last strike and off-screen monsters into a shared `nestScreen` object, as WaypointDriver does for the waypoint. NestOverlay's rAF writes the reticle, HIT and up to 8 edge arrows to the DOM.

**Tech Stack:** TypeScript, React 19, React Three Fiber 9, three 0.185, zustand, Vitest, the Puppeteer e2e harness (`tests/e2e/`).

**Spec:** `docs/archive/specs/2026-10-27-nest-playable-design.md` (builds on `docs/archive/specs/2026-10-27-combat-design.md` and the archived plan `docs/archive/plans/2026-10-27-combat.md`).

**Decomposition:** the brief's seven tasks, kept.
- The rock cluster (Task 3) comes before the sleepers (Task 4), because the sleepers' placement test checks clearance from the rocks.
- Lock-on (Task 5) comes before the HUD (Task 6), because the HUD projects `NestState.lock` and `strikes`.

## Global Constraints

- **Never an ambush.** Nothing attacks outside the Nest. A fight starts only on the inward 70 u crossing while the Nest is `ready`.
  - Sleeping monsters never attack, are not targets (`alive === false`), are not counted as contacts, and are not on the radar.
- **No new models, no new shader programs.**
  - The programs tour stays at +0.
  - The Nest perf state's programs ceiling stays **62**.
  - The rocks reuse the scenery asteroids' InstancedMesh material configuration.
  - The glow reuses the ship sparks' PointsMaterial settings.
  - Sparks are extra instances in the existing bolt mesh.
  - Editing a shader's source (the plume, the jellyfish) changes no program count.
- **Unchanged:**
  - the inner system's look inside 1 AU: `glowScale = 1` there, and the backdrop is under its cap;
  - damage, hull and waves, and `SHIP_HIT_R = 1.4`, so the monsters' accuracy is unchanged;
  - the Worker.
- **No per-frame allocation** in any new loop (rules, director, overlay, effects). Pools and scratch are built once.
  - The overlay may build a transform string only for an element that is shown, with positions rounded to whole pixels so `setStyle` skips unchanged writes.
- **Idle budget unchanged.** Outside the Nest, the only new per-frame work is the radar rim marker, the glow scale and the screen driver's early-out.
- **`tests/storeShape.test.ts` does not change.** No new store keys and no new top-level `combat` keys; `combat.click` only gains nested fields.
- **Reduced motion:**
  - sleepers don't bob;
  - sparks burst but hold still;
  - HIT is a static mark for 0.25 s;
  - the wake rise and the uncurl are state changes and still run.
- **Copy, verbatim:** jump label `The Nest`; HUD sector row `THE_NEST`; hit marker `HIT`.
- **Changelog:** one entry, `{ id: "2026-10-27-nest-playable", date: "2026-10-27", pr: 68 }` (Task 7).
- **Before merging:** `npm run build`, `npx vitest run`, and `npm run test:e2e`, all in the main checkout (agent worktrees give false e2e failures).
- **Subagents:** never install packages, never kill a process by name, never run `wrangler deploy`.

**Values pinned by the spec:**

| Spec | Where |
|---|---|
| backdrop net gain cap 8.5 → 2.2 | `BACKDROP_NET_MAX = 2.2` (`sunLight.ts`) |
| `glowScale = min(1, EXPOSURE_LIFT / exposure)` | `sunLight.ts` |
| brightness guard: 3.5 AU and 13 AU ≤ 1.25 × the 1 AU value, sky-only ≤ 1.3 × | `tests/e2e/look.probe.mjs` |
| rocks: shell radius 10–14 u, 18–24 rocks, seeded | `src/data/nestRocks.ts` |
| lock acquire 25°, hold 40°; click assist 6° | `LOCK_ACQUIRE_RAD`, `LOCK_HOLD_RAD`, `CLICK_ASSIST_RAD` (`constants.ts`) |
| hit spheres: saucer 1.8 → 2.6, tardigrade 3.5 → 4.5 | `SAUCER_HIT_R`, `TARDIGRADE_HIT_R` |
| waves 2 and 3: ±50° of forward, 30–40 u, inside the fighting area | `SPAWN_CONE_RAD`, `SPAWN_DIST = [30, 40]`, `SPAWN_MAX_R` |
| uncurl 1 → 0 over 1 s | `UNCURL_S = 1` |
| HIT for 0.25 s | `HIT_MARK_S = 0.25` (`nestHud.ts`) |
| at most 8 edge arrows | `MAX_EDGE_ARROWS = 8` (`nestScreen.ts`) |

## Rulings made while planning (spec gaps)

- **Two glow factors.** Both are written inside `setExposureCompensation`, so camera cuts (`cutExposure`) set them too.
  - `glowScale` is for built-in tone-mapped materials, which the renderer exposes in low-perf and the post pass exposes in the full tier. It is `min(1, EXPOSURE_LIFT / e)` in both tiers.
  - `glowScaleUnmapped` is for custom shaders without `<tonemapping_fragment>` and for `toneMapped: false` materials, which only the post pass exposes. It equals `glowScale` when `postPassExposes`, and 1 otherwise.
- **Self-lit list:**
  - the spec's list, plus `EngineWake` (the cargo wakes, tone-mapped);
  - plume users get it through `makePlumeMaterial`: the ship, the ghosts' flames, the probe plumes and the tractor-beam cone;
  - lights are not scaled;
  - comets (sunlit dust), plasma anomalies, shooting stars, the warp tunnel and the dormant gate's seam are checked and left as they are (Task 7 notes them in FOLLOW-UPS).
- **The jump target:**
  - `id: NEST_JUMP_ID` (`= NEST_SCAN_ID`, `"the_nest"`, already a reserved project id), label `The Nest`, colour `NEST_RED`;
  - it comes last in `JUMP_TARGETS`, which makes it key 7 with the bundled three probes. With six live probes it would be tenth and have no number key; it stays in both jump lists, and copy never names a key;
  - it is not a `Destination`: no dock, zone, lock or waypoint;
  - it lands exactly as the breach tow does;
  - no gamepad button;
  - the memory probe's jump tour skips it, since the Nest's on-demand load has its own budget in the combat probe.
- **The radar rim marker:**
  - Beyond `RADAR_RANGE` (3D), a dimmed red dot (alpha 0.55, like live pilots) sits on the rim along the horizontal direction, with the altitude chevron and no zone ring or monster blips.
  - When the Nest is straight above or below, the dot sits at the centre with the chevron.
- **The rock cluster:**
  - Rock directions: `NEST_FIB_N = 26` Fibonacci-sphere directions, minus those within `NEST_MOUTH_RAD = 40°` of the buoy direction. That opening is a mouth facing the buoy, so the glow shows from there.
  - Seeded (`mulberry32(NEST_ROCK_SEED)`) radius 10–14, scale 1.2–2.0, variant 0–3 and rotation.
  - Static (no tumble); colliders have `r = 2.2 × scale`, as the asteroids' do.
  - Drawn in the lazy Nest chunk (`NestCluster`, mounted by `NestMonsters` beside `NestEffects`): one InstancedMesh per variant used (≤ 4 calls), frustum-culled with a fixed bounding sphere.
- **The glow:**
  - 40 seeded points within 7 u of the centre, sprite size 6 u, slime green `#7dff6a`, gain 0.6;
  - per-frame vertex colour = base × `mappedCompensation` × `nearFade` (corrected 2026-10-27 in the final review's fix: `mappedCompensation`, 1 / exposure in both tiers, since a PointsMaterial is tone-mapped and the renderer exposes it in low-perf; `exposureCompensation` is 1 there);
  - one call.
- **Sleepers:**
  - **Placement.** Three offsets 22 u from the centre, 45° off the buoy axis, 120° apart around it (`NEST_SLEEPERS`). The saucers face outward along their offsets. The tardigrade sleeps at the centre, facing the mean of the offsets.
  - **When.** They are placed while `ready`, `warm`, within `NEST_LOAD_R`, and once every slot is `gone`. Their number is wave 1's size for the current tier. They grow in over `SLEEP_GROW_S = 1`.
  - **Dropped.** They are dropped instantly beyond `SLEEP_DROP_R = 220`, so the instance frame stops after a visit (C21).
  - **Waking.** The crossing turns them `waking`: eyes open, rising at `WAKE_RISE_SPEED = 2` u/s, turning to the ship. Wave 1 takes them in place, and the rest of a wave spawns in front.
  - **Dismissed.** `endFight`, the clear (→ rest), `debugStartWave` and `debugClearAll` send asleep and waking monsters away. Fresh ones grow back in once the Nest is `ready` again.
  - **The bob.** Render-only: `sleepBob` adds ±0.35 u with a 4 s period, 0 under reduced motion.
- **The tardigrade at wave 3:**
  - It wakes in place, `alive` (a target) from the start of the uncurl.
  - It holds still while `curl > 0`; `curl` eases 1 → 0 over `UNCURL_S`.
  - With no sleeper in its slot it spawns in front, curl 0.
- **The spawn cone:**
  - A direction uniform over the 50° cone's disc (`spreadDir`), at a distance rolled in [30, 40].
  - Clamped radially to `SPAWN_MAX_R = NEST_LEASH_R − 5 = 105` u from the centre.
  - Also used for any wave-1 saucer without a sleeper. `SPAWN_R` is removed.
- **Lock:**
  - **Acquire.** Only with fire held: the nearest alive monster within 25° of the nose and `BOLT_RANGE`.
  - **Hold.** While it is alive, within 40°, in the area and in a fight, fire held or not, so the reticle stays after a tap.
  - **Cleared** outside the area and by `endFight`.
  - **Clicks** never set the lock. Click assist picks the smallest angle within 6° of the camera ray, ahead of the ray's origin.
- **Strikes:**
  - A ship bolt that hits writes its position into an 8-slot ring (`strikes`, `strikeSeq`).
  - **Sparks:** 4 per strike from a pool of 24; life 0.3 s, 6 u/s, radius 0.12 shrinking to 0; still under reduced motion.
  - **HIT** sits at the reticle when locked, else at the strike's projection. It fades 1 → 0 over 0.25 s, or holds at 1 under reduced motion.
- **Edge arrows:**
  - only while `fighting` or `gap`, for alive monsters off screen (behind, or |ndc| > 1);
  - placed on a rectangle inset 28 px from the window edge, pointing outward;
  - a monster dead behind points down;
  - hidden in photo mode, as the reticle and HIT are.
- **The brightness guard:**
  - a new `look` probe: GPU, full fidelity (`lockFullFidelity`);
  - each read comes at least 6 s after placing the ship and once `toneMappingExposure` is within 1% of its target;
  - Rec. 709 luma over every 7th pixel;
  - `look` joins the `BUDGETS` probes in `affected.mjs`.
- **Perf:** the Nest state's calls and triangles ceilings are re-derived with the existing rule (Task 7). The programs ceiling stays 62.

## Review Focus

1. **The locked monster is defeated, or leaves the 40° cone, mid-hold.** The lock drops on that step. The next held shot locks the next monster in 25°, or goes straight ahead. No bolt is aimed at a dying monster. *Test in Task 5.*
2. **A fight ends during the countdown while the saucers are waking** (20 s out, or a breach). They leave, never become `alive` outside a fight, and fresh sleepers grow back in once all are gone. *Test in Task 4.*
3. **Leaving after a visit.** Beyond 220 u the sleepers are dropped (`monstersOnShow` false, so C21's skip holds), and they come back within 200 u. *Test in Task 4.*
4. **Low-perf flips between the sleepers settling and wave 1.** Wave 1 has the tier's size, from 3 down to 2 (the extra sleeper leaves) or from 2 up to 3 (one more spawns in front). *Test in Task 4.*
5. **A monster dead behind the camera, or the camera's w ≈ 0.** The edge arrow is placed at the bottom edge, pointing down, with no NaN. *Test in Task 6.*

## Task file map (shared files, in task order)

| File | Tasks |
|---|---|
| `src/components/canvas/Spaceship.tsx` | 1 (glow writes), 2 (jump branch), 3 (colliders) |
| `src/data/nest.ts` | 2 (`NEST_JUMP_ID`, `NEST_JUMP_LABEL`), 4 (`NEST_SLEEPERS`) |
| `src/utils/combat/constants.ts` | 4 (spawn, sleep), 5 (lock, radii, strikes) |
| `src/utils/combat/nest.ts` | 4 (sleepers, spawn), 5 (lock, click, strikes) |
| `src/utils/combat/nestHud.ts` | 2 (`nestRadarSpot`), 6 (`hitMarkOpacity`) |
| `src/components/canvas/nest/NestMonsters.tsx` | 3 (mount `NestCluster`), 4 (bob) |
| `src/components/canvas/NestDirector.tsx` | 4 (`inp.sleepers`), 5 (click type), 6 (screen driver) |
| `tests/nestMachine.test.ts` | 4, 5 |
| `tests/nestPlacement.test.ts` | 3, 4 |
| `tests/nestHud.test.ts`, `tests/nestHudMarkup.test.tsx` | 2, 6 |
| `tests/e2e/combat.probe.mjs` | 2 (the away radar check only), 7 |
| `tests/e2e/affected.mjs` | 1 (`look` in BUDGETS), 3 (rules for the new files) |
| `docs/PERF-BUDGETS.md` | 1 (look note), 7 (Nest row) |

---

### Task 1: Not washed out far from the Sun

**Files:**
- Modify:
  - `src/utils/sunLight.ts`
  - `src/components/canvas/enginePlume.ts`, `Spaceship.tsx`, `SpaceJellyfish.tsx`, `EngineWake.tsx`, `Ghosts.tsx`, `ProjectProbes.tsx`, `DataShards.tsx`, `PortalRing.tsx`, `CareerTrail.tsx`, `CargoTraffic.tsx`, `TractorBeam.tsx`, `nest/NestBuoy.tsx` (all under `src/components/canvas/`)
  - `tests/backdropExposure.test.ts`
  - `tests/e2e/probeList.mjs`, `tests/e2e/run.mjs` (COST `look: 60`), `tests/e2e/affected.mjs`, `tests/e2eAffected.test.ts`
  - `docs/PERF-BUDGETS.md`, `docs/UNIVERSE-RULES.md` (L19)
- Create: `tests/glowScale.test.ts`, `tests/e2e/look.probe.mjs`

**Interfaces:**
- Produces:
  - `BACKDROP_NET_MAX = 2.2`
  - `glowScale: { value: number }`
  - `glowScaleUnmapped: { value: number }` (both start at 1)
  - `setExposureCompensation(exposure: number, postPassExposes: boolean): void`, which now also writes both glow factors
  - `makePlumeMaterial(...)`, whose uniforms gain `uGlow` (the `glowScaleUnmapped` object itself)

- [ ] **Step 1: Write the failing tests**

`tests/glowScale.test.ts`:
```ts
it("undoes the exposure above the 1 AU lift and never brightens", () => {
  setExposureCompensation(EXPOSURE_LIFT, true);  expect([glowScale.value, glowScaleUnmapped.value]).toEqual([1, 1]);
  setExposureCompensation(0.5, true);            expect(glowScale.value).toBe(1);
  setExposureCompensation(targetExposure(13 * AU), true);
  expect(glowScale.value).toBeCloseTo(1 / 169, 12); expect(glowScaleUnmapped.value).toBeCloseTo(1 / 169, 12);
  setExposureCompensation(6, false);             expect(glowScale.value).toBeCloseTo(0.25, 12); expect(glowScaleUnmapped.value).toBe(1);
  for (const d of [AU, 2 * AU, 3.5 * AU, 13 * AU]) {
    const e = targetExposure(d); setExposureCompensation(e, true);
    expect(glowScale.value * e, `d=${d}`).toBeCloseTo(EXPOSURE_LIFT, 9);
  }
});
it("a camera cut sets it too", () => { cutExposure({ toneMappingExposure: 1 }, 13 * AU, true); expect(glowScale.value).toBeCloseTo(1 / 169, 12); });
it("every plume shares the one unmapped factor", () => { expect(makePlumeMaterial(1).uniforms.uGlow).toBe(glowScaleUnmapped); });
it("each self-lit source reads its factor", () => {
  // source regexes (readFileSync, as exposureShare.test.ts does):
  // enginePlume.ts, SpaceJellyfish.tsx: /uGlow: glowScaleUnmapped/ and /\* uGlow/ in the fragment
  // EngineWake.tsx: /uGlow: glowScale\b/ ; Ghosts.tsx: /glowScaleUnmapped\.value/
  // Spaceship, ProjectProbes, DataShards, PortalRing, CareerTrail, CargoTraffic, TractorBeam, nest/NestBuoy: /glowScale\.value/
});
```
Restore with `setExposureCompensation(EXPOSURE_LIFT, true)` in `afterEach`.

`tests/backdropExposure.test.ts`:
- `BACKDROP_NET_MAX` is 2.2.
- The power-1.5 loop runs over `[AU, 130, 140, 148]` only.
- The crossover `AU * (BACKDROP_NET_MAX / EXPOSURE_LIFT) ** (1 / BACKDROP_EXPOSURE_POWER)` is `toBeCloseTo(148.4, 0)`.
- `backdropScale(d) * targetExposure(d)` is `toBeCloseTo(2.2, 9)` for d in `[3.5 * AU, 13 * AU, SYSTEM_RADIUS]`.
- Drop the `(480 / AU) ** 1.5 ≈ 8.5` assertion.
- Keep the non-decreasing ≤ cap loop.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/glowScale.test.ts tests/backdropExposure.test.ts`
Expected: FAIL (`glowScale` not exported; `BACKDROP_NET_MAX` is 8.5).

- [ ] **Step 3: Implement the factors and the cap in `src/utils/sunLight.ts`**

- Set `BACKDROP_NET_MAX = 2.2` and rewrite its comment and `backdropScale`'s: the curve follows `EXPOSURE_LIFT × (d/AU)^1.5` to ≈ 148 u, then stays flat; L19 lets the camera lift the unlit sky a little, not 5×.
- Export the two factor objects.
- In `setExposureCompensation`, add `glowScale.value = Math.min(1, EXPOSURE_LIFT / exposure)` and `glowScaleUnmapped.value = postPassExposes ? glowScale.value : 1`. Document the two tiers there.

- [ ] **Step 4: Apply the factors (uniform or per-frame write, no new program)**

| Where | What multiplies by the factor |
|---|---|
| `enginePlume.ts` | add `uniform float uGlow;`, `uGlow: glowScaleUnmapped` in uniforms, `gl_FragColor.rgb` × `uGlow`. This covers the ship, ghost flames, probe plumes and the tractor cone. |
| `SpaceJellyfish.tsx` | the same `uGlow: glowScaleUnmapped` uniform; output rgb × `uGlow` |
| `EngineWake.tsx` | `uGlow: glowScale` (it includes `<tonemapping_fragment>`); `color` × `uGlow` |
| `Spaceship.tsx` | the engine's `targetBurn`; each `Neon_*` material's emissive intensity (capture each base once, write base × factor); the sparks' `pointsMaterial.color.setScalar(glowScale.value)`; the streak line colour (base × factor). All use `glowScale`. |
| `Ghosts.tsx` | the hull colour: `stock × GHOST_WASH × glowScaleUnmapped.value`, each frame |
| `ProjectProbes.tsx` | the beacon lamp gain and the RCS/burn flash where they are written each frame; the flare `pointsMaterial` colour. All use `glowScale`. |
| `DataShards.tsx`, `CareerTrail.tsx`, `nest/NestBuoy.tsx`, `CargoTraffic.tsx` | the per-frame `emissiveIntensity` (1.6, `BUOY_GLOW × blink`, the blink levels, `blink`/`burn`) × `glowScale.value` |
| `PortalRing.tsx` | both rings' emissive intensity (2.5, 3.0) written per frame through refs, and the particles' colour, × `glowScale.value` |
| `TractorBeam.tsx` | the line colour (base `#3ff2d0`) × `glowScale.value` |

- [ ] **Step 5: Run the unit tests and see them pass**

Run: `npx vitest run tests/glowScale.test.ts tests/backdropExposure.test.ts tests/sunLight.test.ts tests/exposureShare.test.ts tests/enginePlume.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the brightness guard `tests/e2e/look.probe.mjs`**

Setup:
- One page: `withPage({ label: "look", initScript: lockFullFidelity }, ...)`.
- `u = unit(-0.62, 0.30, 0.72)`. For each `r` in `[1, 3.5, 13]` (AU from `/src/constants.ts`):
  - `__fitz.teleport(u × r × AU)`;
  - `__fitz.setAttitude(Math.atan2(-u.x, -u.z) + 0.5, Math.asin(-u.y) * 0.6)`.
- Wait at least 6 s, then poll (timeout 20 s) until `|gl.toneMappingExposure − targetExposure(camera.position.length())| ≤ 0.01 × target`.

Two reads per place:
- the **whole screen**;
- the **sky alone**: every `scene.children[i].visible = false`, 3 frames, read, then restore each child's own visibility.

Each read:
- in a double rAF, `gl.getContext().readPixels` over the whole drawing buffer;
- every 7th pixel, mean `0.2126 R + 0.7152 G + 0.0722 B`.

Never write `scene.backgroundIntensity`: `applyBackdrop` rewrites it every frame.

Checks:
- `whole(3.5) ≤ 1.25 × whole(1)` and `whole(13) ≤ 1.25 × whole(1)`;
- `sky(3.5) ≤ 1.3 × sky(1)` and `sky(13) ≤ 1.3 × sky(1)`;
- `checks.note` the six numbers.

Registration:
- Register `"look"` in `ALL` (after `"sky"`) and in `affected.mjs` `BUDGETS`.
- Fix `tests/e2eAffected.test.ts` wherever its expected lists include the BUDGETS probes.

- [ ] **Step 7: Run the guard**

Run: `node tests/e2e/run.mjs look`
Expected: PASS on all four ratios. (The controller's readings before this task: whole 63 / 100 / 130, sky 37 / 92 / 90.)

- [ ] **Step 8: Record the readings and update the docs**

- `docs/PERF-BUDGETS.md`: a "Look budget: brightness far from the Sun" section with the method above, the before readings and the six after readings.
- `docs/UNIVERSE-RULES.md` L19:
  - the backdrop's net gain now holds at 2.2 past ≈ 148 u (it was 8.5 past ≈ 365 u);
  - self-lit glows are scaled by `glowScale`, so they read the same from 1 AU out.

- [ ] **Step 9: Commit**

```bash
git add src/utils/sunLight.ts src/components/canvas tests/glowScale.test.ts tests/backdropExposure.test.ts tests/e2e tests/e2eAffected.test.ts docs/PERF-BUDGETS.md docs/UNIVERSE-RULES.md
git commit -m "feat(look): self-lit glows and the backdrop hold their 1 AU brightness far out"
```

---

### Task 2: Finding the Nest (jump target and radar rim marker)

**Files:**
- Modify:
  - `src/data/nest.ts`, `src/data/destinations.ts`, `src/store/slices/flight.ts`, `src/App.tsx` (a comment only)
  - `src/components/canvas/Spaceship.tsx`
  - `src/components/layout/HUDOverlay.tsx`, `src/components/layout/RadarMap.tsx`
  - `src/utils/combat/nestHud.ts`
  - `tests/destinations.test.ts`, `tests/nestHud.test.ts`, `tests/nestHudMarkup.test.tsx`
  - `tests/e2e/memory.probe.mjs`, `tests/e2e/combat.probe.mjs` (the `away` radar check only)

**Interfaces:**
- Produces:
  - `NEST_JUMP_ID = NEST_SCAN_ID` (`"the_nest"`)
  - `NEST_JUMP_LABEL = "The Nest"` (`data/nest.ts`)
  - `JUMP_TARGETS`'s last row `{ id: NEST_JUMP_ID, label: NEST_JUMP_LABEL, color: NEST_RED }`
  - `interface RadarSpot { px: number; py: number; onRim: boolean }`
  - `nestRadarSpot(dx: number, dy: number, dz: number, heading: number, scale: number, rimR: number, out: RadarSpot): RadarSpot`
  - `nestRadarShown` is kept.

- [ ] **Step 1: Write the failing tests**

`tests/destinations.test.ts`:
- Every expected id list ends with `"the_nest"`: lines ~51, ~102 and ~140 become `[..., "contact", "the_nest"]`.
- `jumpKey(NEST_JUMP_ID)` is 7.
- `JUMP_TARGETS.at(-1)` equals `{ id: "the_nest", label: "The Nest", color: "#ff3b4a" }`.
- The ids are unique.
- `useSpaceStore.getState().requestJump("the_nest")` sets `jumpRequest.id` to `"the_nest"`.
- The Spaceship source matches `/NEST_JUMP_ID[\s\S]*NEST_TOW_POSE/`.

`tests/nestHud.test.ts`, a new describe "the radar's rim marker":
```ts
const out = { px: 0, py: 0, onRim: false }; const scale = 68 / RADAR_RANGE, rimR = 68;
nestRadarSpot(100, 0, 0, 0, scale, rimR, out); // in range: unclamped
expect(out.onRim).toBe(false); expect(Math.hypot(out.px, out.py)).toBeCloseTo(100 * scale, 9);
nestRadarSpot(-510, -209, -80, 0.3, scale, rimR, out); // beyond: on the rim, the horizontal direction kept
expect(out.onRim).toBe(true); expect(Math.hypot(out.px, out.py)).toBeCloseTo(rimR - 3, 9);
const w = worldToRadar(-510, -80, 0.3); expect(Math.atan2(out.py, out.px)).toBeCloseTo(Math.atan2(-w.up, w.x), 9);
nestRadarSpot(100, -300, 0, 0, scale, rimR, out); // beyond in 3D, inside horizontally: still on the rim
expect(Math.hypot(out.px, out.py)).toBeCloseTo(rimR - 3, 9);
nestRadarSpot(0, -300, 0, 0, scale, rimR, out); // straight below: the centre, no NaN
expect([out.px, out.py, out.onRim]).toEqual([0, 0, true]);
expect(nestRadarSpot(1, 2, 3, 0, scale, rimR, out)).toBe(out);
```
Rename the existing `nestRadarShown` test to "is in range within RADAR_RANGE of the centre (3D)", with its assertions unchanged.

`tests/nestHudMarkup.test.tsx` radar test: RadarMap matches `/nestRadarSpot\(/`, still matches `/NEST_ZONE_R \* scale/` and `/combat\.nest\.saucers/`, and the ring and blips sit under `!spot.onRim` (`/if \(!\w+\.onRim\)/`).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/destinations.test.ts tests/nestHud.test.ts tests/nestHudMarkup.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- **`destinations.ts`:** append the Nest row to `JUMP_TARGETS` (import from `./nest`). Update the "probes, then destinations" comments here and in `App.tsx` to add "then the Nest".
- **`flight.ts` `requestJump`:** also accepts `NEST_JUMP_ID`.
- **`Spaceship.tsx`:**
  - Extract the breach-tow placement into a local `towToNest()`.
  - The pending-jump branch calls it when `id === NEST_JUMP_ID`, before the probe and destination lookup.
  - The tow path calls the same function.
- **`HUDOverlay.tsx` sector list:** after the destinations, a row that jumps to `NEST_JUMP_ID`, keyed `[{jumpKey(NEST_JUMP_ID)}]`, with a `NEST_RED` dot, text `THE_NEST ([-250, -390, 60])` (from `NEST_CENTRE`) and a title `Jump to the Nest [${jumpKey(NEST_JUMP_ID)}]`.
- **`nestHud.ts` `nestRadarSpot`:**
  - In range (`nestRadarShown`): `px = sx·scale`, `py = −up·scale`.
  - Beyond range: scale `(sx, up)` to length `rimR − 3`. When `hypot(sx, up) < 1e-6`, use (0, 0).
- **`RadarMap.tsx`:** the Nest block always calls `nestRadarSpot`. In range it draws as today; on the rim it draws the dot at alpha 0.55 plus the altitude chevron, with no zone ring and no monster blips.
- **`memory.probe.mjs`:** the tour filters out `"the_nest"` (comment: the Nest's on-demand load is budgeted by the combat probe).
- **`combat.probe.mjs` `away`:** "the radar shows no Nest marker" becomes "the radar shows only the Nest's rim marker". It uses a helper returning each red pixel's distance from the canvas centre in CSS px: count ≥ 3, and every distance ≥ 55.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/destinations.test.ts tests/nestHud.test.ts tests/nestHudMarkup.test.tsx tests/gamepad.test.ts tests/projects.test.ts tests/contentParse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data src/store/slices/flight.ts src/App.tsx src/components src/utils/combat/nestHud.ts tests
git commit -m "feat(nest): THE NEST is a jump target and always on the radar"
```

---

### Task 3: A nest you can see (rock cluster and slime glow)

**Files:**
- Create:
  - `src/data/nestRocks.ts`
  - `src/components/canvas/asteroidVariants.ts`
  - `src/components/canvas/nest/NestCluster.tsx`
- Modify:
  - `src/components/canvas/Asteroids.tsx`, `src/components/canvas/nest/NestMonsters.tsx`, `src/components/canvas/Spaceship.tsx`
  - `tests/nestPlacement.test.ts`, `tests/nestImports.test.ts`
  - `tests/e2e/affected.mjs`: the `data/nest` rule becomes `^src\/data\/nest(Rocks)?\.ts$`; `asteroidVariants` joins the Asteroids rule, which gains `"combat"`
  - `tests/e2eAffected.test.ts`, wherever it pins those rules

**Interfaces:**
- Produces, in `src/data/nestRocks.ts`:
  - `interface NestRock { offset: Vec3; scale: number; variant: 0 | 1 | 2 | 3; rotation: Vec3 }`
  - `NEST_ROCK_SEED`, `NEST_FIB_N = 26`, `NEST_SHELL_R: readonly [number, number] = [10, 14]`, `NEST_ROCK_SCALE: readonly [number, number] = [1.2, 2.0]`, `NEST_MOUTH_RAD = 40°`
  - `buildNestRocks(seed: number): NestRock[]`
  - `NEST_ROCKS: readonly NestRock[]`
  - `NEST_ROCK_COLLIDERS: readonly { id: string; x: number; y: number; z: number; r: number }[]`, with ids `nest_rock_<i>`, world positions and `r = 2.2 × scale`
  - `NEST_GLOW: readonly Vec3[]` (40 offsets)
  - `NEST_GLOW_R = 7`
- Produces, in `src/components/canvas/asteroidVariants.ts`:
  - `asteroidVariants(scene: THREE.Object3D): { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial }[]`, the loop moved out of `Asteroids.tsx` unchanged
- Produces scene object names: group `NestRocks`, meshes `NestRocks<v>`, Points `NestGlow`.

- [ ] **Step 1: Write the failing tests**

`tests/nestPlacement.test.ts`, a new describe "the Nest's rock cluster". `p(r)` is the rock's world position, and `L` is the buoy direction `unit(NEST_BUOY_POS − NEST_CENTRE)`.
```ts
expect(buildNestRocks(NEST_ROCK_SEED)).toEqual(NEST_ROCKS);
expect(NEST_ROCKS.length).toBeGreaterThanOrEqual(18); expect(NEST_ROCKS.length).toBeLessThanOrEqual(24);
for (const r of NEST_ROCKS) {
  const d = Math.hypot(...r.offset);
  expect(d).toBeGreaterThanOrEqual(10); expect(d).toBeLessThanOrEqual(14);
  expect(r.scale).toBeGreaterThanOrEqual(1.2); expect(r.scale).toBeLessThanOrEqual(2.0);
  expect(angle(r.offset, L)).toBeGreaterThan(40 * DEG);                 // the mouth faces the buoy
}
NEST_ROCK_COLLIDERS.forEach((c, i) => {
  expect(c.r).toBeCloseTo(2.2 * NEST_ROCKS[i].scale, 12);
  expect(dist([c.x, c.y, c.z], NEST_CENTRE) - c.r).toBeGreaterThanOrEqual(4.5); // the sleeping tardigrade's new hit radius (Task 5)
  expect(dist([c.x, c.y, c.z], NEST_CENTRE) + c.r).toBeLessThanOrEqual(NEST_ZONE_R - 40);
  expect(dist([c.x, c.y, c.z], NEST_BUOY_POS)).toBeGreaterThan(100);
  expect(dist([c.x, c.y, c.z], [NEST_TOW_POSE.x, NEST_TOW_POSE.y, NEST_TOW_POSE.z])).toBeGreaterThan(100);
});
expect(NEST_GLOW).toHaveLength(40); for (const g of NEST_GLOW) expect(Math.hypot(...g)).toBeLessThanOrEqual(NEST_GLOW_R);
expect(readFileSync("src/components/canvas/Spaceship.tsx", "utf8")).toMatch(/COLLIDERS = \[[^\]]*NEST_ROCK_COLLIDERS/);
```
`tests/nestImports.test.ts`: add `src/components/canvas/nest/NestCluster.tsx` to `LAZY_FX`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/nestPlacement.test.ts tests/nestImports.test.ts`
Expected: FAIL (`nestRocks` missing).

- [ ] **Step 3: Implement**

- **`nestRocks.ts`:**
  - Fibonacci-sphere directions `i = 0..NEST_FIB_N−1`, minus any within `NEST_MOUTH_RAD` of the buoy direction (`unit(−NEST_CENTRE)`).
  - Then, in order, from `mulberry32(seed)`: radius in `NEST_SHELL_R`, scale in `NEST_ROCK_SCALE`, variant `floor(rnd·4)`, and a rotation of three angles in [0, 2π).
  - `NEST_GLOW`: 40 points uniform in the 7 u ball, from the same generator after the rocks.
- **`asteroidVariants.ts`:** move the loop out of `Asteroids.tsx`, which uses it with unchanged behaviour.
- **`NestCluster.tsx`:**
  - `useModel(assetUrl("/models/asteroids.glb"))` → `asteroidVariants`.
  - One InstancedMesh per variant present. Matrices are set once (position `NEST_CENTRE + offset`, the rotation, the scale), with `computeBoundingSphere()` and `frustumCulled` left true.
  - The glow is one `Points` with the ship sparks' material settings (`vertexColors`, `map: softSprite`, `transparent`, `opacity 1`, `AdditiveBlending`, `depthWrite false`), at size 6.
  - Each frame the glow's colour is `#7dff6a × 0.6 × mappedCompensation.value × nearFade(p, camera)` (corrected 2026-10-27 in the final review's fix: `mappedCompensation`, 1 / exposure in both tiers, since a PointsMaterial is tone-mapped and the renderer exposes it in low-perf; `exposureCompensation` is 1 there).
  - Dispose the geometries and material clones on unmount (not the textures).
- **`NestMonsters.tsx`:** render `<NestCluster />` beside `<NestEffects />`, inside the Nest group, so `warmNest` walks it.
- **`Spaceship.tsx`:** `COLLIDERS = [...ASTEROID_COLLIDERS, ...NEST_ROCK_COLLIDERS, SUN_COLLIDER]`.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run tests/nestPlacement.test.ts tests/nestImports.test.ts tests/solarClearance.test.ts tests/e2eAffected.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/nestRocks.ts src/components/canvas tests/nestPlacement.test.ts tests/nestImports.test.ts tests/e2e/affected.mjs tests/e2eAffected.test.ts
git commit -m "feat(nest): a rock cluster with a slime glow, solid to the ship"
```

---

### Task 4: Monsters at home (sleepers, waking, spawning in front)

**Files:**
- Modify:
  - `src/utils/combat/constants.ts`, `saucerAi.ts`, `tardigradeAi.ts`, `nest.ts`, `renderPose.ts` (all in `src/utils/combat/`)
  - `src/data/nest.ts`
  - `src/components/canvas/nest/NestMonsters.tsx`, `src/components/canvas/NestDirector.tsx`
  - `tests/nestMachine.test.ts`, `tests/combatBasics.test.ts`, `tests/nestPlacement.test.ts`, `tests/nestEffects.test.ts`
  - `tests/nestDirector.test.ts` and `tests/nestHud.test.ts`: every `NestInput` they build gains `sleepers`

**Interfaces:**
- Consumes: `NEST_ROCK_COLLIDERS` (Task 3).
- Produces, in `constants.ts`:
  - `SPAWN_CONE_RAD = 50°`, `SPAWN_DIST: readonly [number, number] = [30, 40]`, `SPAWN_MAX_R = NEST_LEASH_R - 5`
  - `SLEEP_GROW_S = 1`, `SLEEP_DROP_R = NEST_LOAD_R + 20`, `WAKE_RISE_SPEED = 2`, `UNCURL_S = 1`
  - `SPAWN_R` is removed.
- Produces, in `data/nest.ts`: `NEST_SLEEPER_R = 22` and `NEST_SLEEPERS: readonly Vec3[]` (the offsets in the Rulings).
- Produces, in `saucerAi.ts`:
  - `SaucerPhase` adds `"asleep" | "waking"`
  - `sleepSaucer(s: Saucer, seed: number, x: number, y: number, z: number, fx: number, fy: number, fz: number): void` (alive false, scale 0)
  - `wakeSaucer(s: Saucer): void`
  - `leaveSaucer` also sends away `asleep` and `waking` saucers
- Produces, in `tardigradeAi.ts`:
  - `TardigradePhase` adds `"asleep"`
  - `sleepTardigrade(t: Tardigrade, x: number, y: number, z: number, fx: number, fy: number, fz: number): void` (curl 1, scale 0)
  - `wakeTardigrade(t: Tardigrade, rnd: () => number, ship: V3): void` (alive, `hp = TARDIGRADE_HITS`, swim, curl stays 1)
  - `leaveTardigrade` also sends away an `asleep` one
- Produces, in `nest.ts`:
  - `NestInput.sleepers: readonly V3[]` (offsets from `centre`)
  - `frontSpawn(inp: NestInput, rnd: () => number, out: V3): V3`
  - `dismissSleepers(n: NestState): void`
- Produces, in `renderPose.ts`: `SLEEP_BOB_AMP = 0.35`, `SLEEP_BOB_PERIOD_S = 4`, and `sleepBob(t: number, phase: number, reduced: boolean): number`. `saucerRenderPose` holds `blink = 1` while asleep.

- [ ] **Step 1: Write the failing tests** (`tests/nestMachine.test.ts`; `setup()` gains `sleepers: [v(0, 0, 22), v(19.05, 0, -11), v(-19.05, 0, -11)]`)

Remove "monsters spawn 30 u from the centre on the side away from the ship" and add:
```ts
describe("the Nest: sleepers", () => {
  it("appear in ready once warm and within 200 u, growing in over 1 s", () => {
    // setup(150): one step → saucers[0..2].phase "asleep", alive false, at C + offset exactly; tardigrades[0] "asleep" at C, pose.curl 1;
    // contactCount 0; scale ≈ DT; run(1) → every sleeper's scale 1. setup(250): none placed. warm false: none placed.
  });
  it("are harmless and untargetable", () => {
    // ship at 80 u (in the area, outside the zone) for 10 s: no enemy bolt ever live, hull 100;
    // a ship bolt fired straight through sleeper 0 (fireBolt) flies on: hp unchanged, defeats 0
  });
  it("crossing wakes the saucers; they rise through the countdown and become wave 1 in place", () => {
    // at(75) step at(69) step → saucers[0..2] "waking"; record y; run(3) → wave 1: those same slots alive, idle,
    // y risen 6 ± 0.2 u, x and z within 0.01 u of C + offset at the spawn step (one step of motion follows the spawn)
  });
  it("the tardigrade sleeps through waves 1 and 2, then wakes in place at wave 3 and uncurls over 1 s", () => {
    // wave 1, then wave 2 (debugClearWave + run(WAVE_GAP_S)): tardigrade "asleep", contactCount 5 in wave 2;
    // wave 3: alive at C, curl 1 → ≈0.5 after 0.5 s → 0 after 1 s; velocity 0 while curl > 0
  });
  it("a fight ended during the countdown sends the waking saucers away, then fresh sleepers grow back (Review Focus 2)", () => {
    // cross; at(130) (outside the 110 u area, inside 200 u); run(20) → ended; waking slots "leaving"; at no step is any saucer alive;
    // run(LEAVE_S + SLEEP_GROW_S + 0.1) → three "asleep" at their offsets, scale 1
  });
  it("are dropped beyond 220 u and come back within 200 u (Review Focus 3)", () => {
    // placed; at(230) step → all gone, monstersOnShow(n) false; at(210) step → still none; at(190) step → "asleep" again
  });
  it("wave 1 keeps the tier's size if low-perf flips after they settle (Review Focus 4)", () => {
    // 3 sleepers, then lowPerf true → wave 1 has 2 alive, the third sleeper "leaving";
    // 2 sleepers (lowPerf), then false → wave 1 has 3 alive: the 2 sleeper slots in place plus 1 within the front cone
  });
  it("clearing wave 3 leaves no sleeper during the rest; they return at ready", () => { /* rest: none asleep; after NEST_REST_S: placed */ });
});
describe("the Nest: spawning in front", () => {
  it("waves 2 and 3 spawn within 50° of the nose, 30–40 u out, inside 105 u of the centre", () => {
    // at(60), nose (-1,0,0): debugStartWave(2) then (3) → every alive monster: angle(nose, m − ship) ≤ 50°+1e-9,
    // 30−1e-9 ≤ dist(m, ship) ≤ 40+1e-9; at(100), nose (+1,0,0): every dist(m, C) ≤ SPAWN_MAX_R + 1e-9
  });
});
```
- `tests/combatBasics.test.ts`: drop `SPAWN_R` from the pins; pin `[SPAWN_DIST, SPAWN_MAX_R, SLEEP_GROW_S, SLEEP_DROP_R, WAKE_RISE_SPEED, UNCURL_S]` and `SPAWN_CONE_RAD ≈ 50°`.
- `tests/nestPlacement.test.ts`, the sleepers:
  - `|offset| = 22`;
  - `angle(offset, L) = 45° ± 1e-9`;
  - pairwise distances equal to within 1e-9;
  - each sleeper clear of every rock collider by ≥ `c.r + 2.6`;
  - each inside `NEST_ZONE_R`.
- `tests/nestEffects.test.ts`:
  - `sleepBob(t, φ, false)` stays within ±0.35;
  - `sleepBob(t + 4, φ, false) ≈ sleepBob(t, φ, false)`;
  - `sleepBob(t, φ, true) === 0`;
  - `saucerRenderPose` of an asleep saucer has `blink` 1, and of a waking one 0.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/nestMachine.test.ts tests/combatBasics.test.ts tests/nestPlacement.test.ts tests/nestEffects.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the rules**

**`nest.ts` `stepNest`:**
- **In `ready`:**
  - Beyond `SLEEP_DROP_R`, set every asleep monster to `gone` (scale 0).
  - Within `NEST_LOAD_R`, with `inp.warm` and every slot `gone`, place the sleepers:
    - `min(sleepers.length, wave 1's tier size)` saucers at `centre + offset`, facing along the offset;
    - the tardigrade at `centre`, facing the offsets' mean (+Y if zero).
- **On the crossing into `countdown`:** `wakeSaucer` on every asleep saucer.
- **`startWave(k)`:** for each wanted monster, first an asleep or waking slot of its kind, spawned in place:
  - `spawnSaucer` at its own position;
  - `wakeTardigrade` for the tardigrade.
- **Then the other non-alive slots** at `frontSpawn`.
- **Wave 1's leftover sleepers** leave.
- **`dismissSleepers`** runs in `endFight`, on the clear (→ rest), in `debugStartWave` (before it spawns) and in `debugClearAll`.

**`frontSpawn`:**
- `spreadDir(nose, SPAWN_CONE_RAD, rnd)` × `roll(SPAWN_DIST)` from the ship;
- if the result is more than `SPAWN_MAX_R` from the centre, pull it in radially to `SPAWN_MAX_R`.

**AI:**
- **Saucer `asleep`:** only `scale = min(1, scale + dt / SLEEP_GROW_S)`.
- **Saucer `waking`:** the same grow, `vy = WAKE_RISE_SPEED` (no other motion), and `slewFacing` toward the ship.
- **Tardigrade `asleep`:** only the grow.
- **Tardigrade `swim`** with `curl > 0`: `curl -= dt / UNCURL_S` (clamped at 0), velocity 0, no steering, no attack countdown.

- [ ] **Step 4: Wire the scene**

- **`data/nest.ts` `NEST_SLEEPERS`:**
  - `f` is the buoy direction, `s = unit(f × Y)` and `u = s × f`;
  - offset i is `22 · unit(f + tan 45° · (s cos φᵢ + u sin φᵢ))`, with φ = 90°, 210°, 330°.
- **`NestDirector.tsx`:** `inp.sleepers` is built once from `NEST_SLEEPERS`.
- **`NestMonsters.tsx`:** an asleep saucer or tardigrade's matrix gets `sleepBob(t, slot.phase, reduced)` added to its y.
- **`renderPose.ts`:** blink 1 while asleep.

- [ ] **Step 5: Run them and see them pass**

Run: `npx vitest run tests/nestMachine.test.ts tests/combatBasics.test.ts tests/nestPlacement.test.ts tests/nestEffects.test.ts tests/nestDirector.test.ts tests/monsterAi.test.ts tests/nestHud.test.ts`
Expected: PASS.

Any older test asserting that slots are `gone` while `ready` near the Nest must now allow for the sleepers: update its expectation, don't weaken its intent.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat src/data/nest.ts src/components/canvas tests
git commit -m "feat(nest): monsters sleep at home, wake on the crossing, and spawn in front"
```

---

### Task 5: Shooting (lock-on, click assist, bigger hit spheres, hit sparks)

**Files:**
- Modify:
  - `src/utils/combat/constants.ts`, `aim.ts`, `types.ts`, `nest.ts`, `director.ts`, `effects.ts` (all in `src/utils/combat/`)
  - `src/store/combatState.ts`
  - `src/components/canvas/GlobalCanvas.tsx` (the click), `src/components/canvas/nest/NestEffects.tsx`, `src/components/canvas/NestDirector.tsx`
  - `tests/combatBasics.test.ts`, `tests/nestMachine.test.ts`, `tests/nestDirector.test.ts`, `tests/nestEffects.test.ts`

**Interfaces:**
- Consumes: `NestInput.sleepers` and the `alive` rule (Task 4).
- Produces, in `constants.ts`:
  - `LOCK_ACQUIRE_RAD = 25°`, `LOCK_HOLD_RAD = 40°`, `CLICK_ASSIST_RAD = 6°`
  - `SAUCER_HIT_R = 2.6`, `TARDIGRADE_HIT_R = 4.5`
  - `STRIKE_RING = 8`
  - `AIM_ASSIST_RAD` is removed.
- Produces, in `aim.ts` (`aimAssist` is removed):
  - `acquireLock(origin: V3, nose: V3, targets: readonly AimTarget[]): number` (nearest alive within 25° and `BOLT_RANGE`, else −1)
  - `lockHolds(origin: V3, nose: V3, t: AimTarget): boolean`
  - `clickAssist(rayOrigin: V3, rayDir: V3, targets: readonly AimTarget[]): number` (smallest angle ≤ 6°, ahead of the origin, else −1)
- Produces, in `types.ts`: `interface ClickShot extends V3 { ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }`.
- Produces, in `nest.ts`:
  - `NestState.lock: number` (an index into `targets`, −1 for none)
  - `NestState.strikes: V3[]` (`STRIKE_RING` reused objects)
  - `NestState.strikeSeq: number` (the latest strike is `strikes[(strikeSeq − 1) % STRIKE_RING]`)
  - `NestInput.click: ClickShot | null`
- Produces, in `director.ts`:
  - `NestCombat.click: { pending: boolean } & ClickShot`
  - `takeClick(c: NestCombat, out: ClickShot, paused?: boolean, dt?: number): ClickShot | null`
- Produces, in `effects.ts`:
  - `HIT_SPARKS = 4`, `SPARK_POOL = 24`, `SPARK_LIFE_S = 0.3`, `SPARK_SPEED = 6`, `SPARK_R = 0.12`
  - `interface Spark { live: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number }`
  - `interface SparkPool { sparks: Spark[]; next: number }`
  - `createSparks(n?: number): SparkPool`
  - `emitSparks(p: SparkPool, x: number, y: number, z: number, rnd: () => number, still: boolean): void`
  - `stepSparks(p: SparkPool, dt: number): number`
  - `sparkMatrix(s: Spark, out: THREE.Matrix4): THREE.Matrix4`

- [ ] **Step 1: Write the failing tests**

`tests/combatBasics.test.ts`:
```ts
expect(LOCK_ACQUIRE_RAD).toBeCloseTo(25 * DEG, 12); expect(LOCK_HOLD_RAD).toBeCloseTo(40 * DEG, 12); expect(CLICK_ASSIST_RAD).toBeCloseTo(6 * DEG, 12);
expect([SAUCER_HIT_R, TARDIGRADE_HIT_R, SHIP_HIT_R, BOLT_R]).toEqual([2.6, 4.5, 1.4, 0.3]);
expect("AIM_ASSIST_RAD" in constants).toBe(false);
expect(acquireLock(origin, nose, [target(24, 50)])).toBe(0);  expect(acquireLock(origin, nose, [target(26, 50)])).toBe(-1);
expect(acquireLock(origin, nose, [target(5, 50, false)])).toBe(-1); expect(acquireLock(origin, nose, [target(0, 170)])).toBe(-1);
expect(lockHolds(origin, nose, target(39, 50))).toBe(true); expect(lockHolds(origin, nose, target(41, 50))).toBe(false);
expect(lockHolds(origin, nose, target(5, 50, false))).toBe(false);
// click: ray from (0,0,-10) along +Z
expect(clickAssist(o, d, [target(5, 50)])).toBe(0); expect(clickAssist(o, d, [target(7, 50)])).toBe(-1);
expect(clickAssist(o, d, [target(180, 5)])).toBe(-1);          // behind the ray's origin
expect(clickAssist(o, d, [target(5, 20), target(2, 80)])).toBe(1); // the smallest angle, not the nearest
```
Replace the old `aimAssist` tests with these.

`tests/nestMachine.test.ts`, a new describe "the Nest: lock-on, click assist and strikes":
- **Lock acquire and hold.** A saucer held still (`n.frozen = true`, `hp = 99` so the bolts don't defeat it), 40 u out at 20°, with fire held → `n.lock` is its index after one step. Turn the nose so it sits at 35° → the lock holds; at 45° → `n.lock === -1` on that step. The next held shot's direction equals the unit nose (`expectDir`).
- **The tap.** The lock holds with `fireHeld` false while within 40° (the reticle stays after a tap).
- **Review Focus 1.** Two frozen saucers, at 10° and 30 u and at 20° and 40 u, fire held until the first is defeated. On that step the lock moves to the second. No ship bolt fired after the defeat step points within 1° of the defeated saucer's position.
- **Fight's end.** `endFight` → lock −1. The ship outside the area → lock −1.
- **Lead.** Held fire leads the locked monster: the bolt direction equals `leadAim(origin, pos, vel, BOLT_SPEED)` to 1e-9 (the old "held fire leads" test, rewritten).
- **Clicks.** A click whose ray passes 4° off a saucer → the bolt leads the saucer. A click 10° off → the bolt heads for the click point. `n.lock` is unchanged by clicks.
- **Hit spheres.**
  - Bolts passing a still saucer's centre at 2.85 u hit and at 2.95 u miss.
  - A tardigrade: 4.75 u hits and 4.85 u misses.
  - The enemy bolt vs the ship is unchanged (1.65 u hits, 1.75 u misses).
- **Strikes.** Every hit makes `strikeSeq` += 1 and `strikes[(strikeSeq−1) % 8]` equal to the bolt's position on that step. Nine hits wrap the ring without growing it.

`tests/nestDirector.test.ts`: `takeClick` copies all nine `ClickShot` fields. The C18 queue tests still pass with the ray fields set.

`tests/nestEffects.test.ts`:
- `emitSparks` makes 4 live sparks;
- `stepSparks(p, 0.29)` still has 4 live; after a further 0.02 s, 0;
- `still` → their positions never change;
- 7 emits keep the 24-slot pool (the oldest is reused);
- `sparkMatrix`'s scale is 0.12 at age 0 and 0.06 at half life.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/combatBasics.test.ts tests/nestMachine.test.ts tests/nestDirector.test.ts tests/nestEffects.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the rules**

- **`nest.ts` step 7, before `fire`:**
  - Not in the area, or the phase not `countdown`/`fighting`/`gap` → `lock = -1`.
  - Else a lock that fails `lockHolds` (from the nose origin) → −1.
  - Then, with `lock < 0 && fireHeld`, `lock = acquireLock(...)`.
- **`fire`:**
  - A click with `clickAssist ≥ 0` → `leadAim` at that target. Otherwise straight at the click point.
  - Held fire with `lock ≥ 0` → `leadAim`. Otherwise along the nose.
- **Step 6:** a hit records the strike (`recordStrike`, allocation-free).
- **`endFight`** clears the lock.
- **`createNest`:** `lock: -1`, `strikes` (8 objects), `strikeSeq: 0`.

- [ ] **Step 4: Wire the scene**

- **`combatState.ts`:** `click: { pending: false, x: 0, y: 0, z: 0, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1 }`.
- **`GlobalCanvas.tsx` `FollowingClickPlane`:** also copy `e.ray.origin` and `e.ray.direction` into `combat.click.o*` and `d*`.
- **`NestDirector.tsx`:** `clickAim` becomes a `ClickShot`.
- **`NestEffects.tsx`:**
  - `BOLTS = BOLT_POOL + MAX_SAUCERS + SPARK_POOL`.
  - A `seen` strike counter starts at `n.strikeSeq` on mount.
  - Each frame, for every new strike (at most `STRIKE_RING` back), `emitSparks(..., reducedMotion)`.
  - `stepSparks(dt)`, where `dt` is 0 when paused.
  - Each live spark is one more instance: `sparkMatrix`, in the ship's plume colour × `BOLT_GLOW`.

- [ ] **Step 5: Run them and see them pass**

Run: `npx vitest run tests/combatBasics.test.ts tests/nestMachine.test.ts tests/nestDirector.test.ts tests/nestEffects.test.ts tests/storeShape.test.ts tests/nestImports.test.ts`
Expected: PASS. (`storeShape` is unchanged: `click` is not a new top-level key.)

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat src/store/combatState.ts src/components/canvas tests
git commit -m "feat(nest): lock-on, click assist, bigger hit spheres and hit sparks"
```

---

### Task 6: The HUD (lock reticle, HIT, edge arrows)

**Files:**
- Create: `src/utils/combat/nestScreen.ts`, `tests/nestScreen.test.ts`
- Modify:
  - `src/utils/combat/nestHud.ts`
  - `src/components/canvas/NestDirector.tsx`, `src/components/layout/NestOverlay.tsx`
  - `tests/nestHud.test.ts`, `tests/nestHudMarkup.test.tsx`

**Interfaces:**
- Consumes: `NestState.lock`, `strikes`, `strikeSeq` and `targets` (Task 5); the `alive` and phase rules (Task 4).
- Produces, in `nestScreen.ts`:
  - `MAX_EDGE_ARROWS = 8`, `EDGE_INSET_PX = 28`
  - `interface Ndc { nx: number; ny: number; behind: boolean }`
  - `interface EdgeSpot { x: number; y: number; angle: number }` (CSS px, y down; `angle` in radians, 0 pointing right, π/2 down)
  - `interface NestScreen { lock: { on: boolean; x: number; y: number }; hit: { on: boolean; x: number; y: number }; hitAt: number; seenSeq: number; arrows: { count: number; x: Float32Array; y: Float32Array; angle: Float32Array } }`
  - `createNestScreen(): NestScreen`
  - `nestScreen: NestScreen` (shared, like `waypointState`)
  - `projectNdc(view: ArrayLike<number>, proj: ArrayLike<number>, x: number, y: number, z: number, out: Ndc): Ndc` (column-major three.js elements; `behind` when clip w ≤ 1e-9)
  - `edgeArrow(nx: number, ny: number, behind: boolean, width: number, height: number, out: EdgeSpot): EdgeSpot`
  - `updateNestScreen(n: NestState, view: ArrayLike<number>, proj: ArrayLike<number>, width: number, height: number, now: number, out: NestScreen): NestScreen`
- Produces, in `nestHud.ts`: `HIT_MARK_S = 0.25` and `hitMarkOpacity(now: number, hitAt: number, reduced: boolean): number`.

- [ ] **Step 1: Write the failing tests** (`tests/nestScreen.test.ts`; `V` is the identity and `P` a 90°, aspect 1, near 0.1, far 1000 perspective, column-major)

```ts
// near(e, x, y, a?) = toBeCloseTo(_, 9) on x, y (and angle when given)
projectNdc(V, P, 0, 0, -10, o); expect(o.nx).toBeCloseTo(0, 12); expect(o.ny).toBeCloseTo(0, 12); expect(o.behind).toBe(false);
expect(projectNdc(V, P, 10, 0, -10, o).nx).toBeCloseTo(1, 12);
expect(projectNdc(V, P, 0, 0, 10, o).behind).toBe(true);
near(edgeArrow(2, 0, false, 1280, 800, e), 1252, 400, 0);
near(edgeArrow(0, -3, false, 1280, 800, e), 640, 772, Math.PI / 2);
near(edgeArrow(0.2, 0, true, 1280, 800, e), 28, 400); expect(Math.abs(e.angle)).toBeCloseTo(Math.PI, 9);
near(edgeArrow(-0.5, 0, true, 1280, 800, e), 1252, 400);                      // behind and right of the camera → right edge
near(edgeArrow(0, 0, true, 1280, 800, e), 640, 772, Math.PI / 2);            // dead behind (Review Focus 5)
near(edgeArrow(3, 3, false, 800, 800, e), 772, 28, -Math.PI / 4);
for (const k of [e.x, e.y, e.angle]) expect(Number.isFinite(k)).toBe(true);
```
`updateNestScreen`, with a `createNest()` whose monsters are set by hand and the camera at the origin looking down −Z:
- `fighting`, one alive saucer in view and two behind → `arrows.count === 2`.
- `ready` → 0.
- Asleep monsters never get an arrow.
- `count ≤ MAX_EDGE_ARROWS`.
- `lock` on the in-view saucer → `lock.on`, with `x`, `y` its pixel; on a monster behind → `lock.on === false`.
- A `strikeSeq` change at `now` → `hit.on` at the lock's pixel until `now + 0.249`, and off at `now + 0.25`. Unlocked → `hit` at the strike's projection.
- It returns `out` itself, and 1,000 calls keep the same `arrows.x` array.

`tests/nestHud.test.ts`:
- `hitMarkOpacity(t, t, false) === 1`, `(t + 0.125)` is 0.5, `(t + 0.25)` is 0;
- reduced: 1 at `t + 0.2`, 0 at `t + 0.25`.

`tests/nestHudMarkup.test.tsx`, NestOverlay:
- holds `nest-lock`, `nest-hit` (text `HIT`, `data-mode="fade"`) and exactly 8 `nest-arrow` elements, each `display:none` at rest;
- the source matches `/nestScreen\./` and `/hitMarkOpacity\(now, nestScreen\.hitAt, reduced\)/`;
- still no `animate-|transition-|@keyframes`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/nestScreen.test.ts tests/nestHud.test.ts tests/nestHudMarkup.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `nestScreen.ts` and `hitMarkOpacity`**

**`edgeArrow`:**
- Flip `(nx, ny)` when behind.
- Pixel direction `(nx·w/2, −ny·h/2)`; when both parts are below 1e-9, use (0, 1).
- Scale it onto the rectangle inset `EDGE_INSET_PX`.
- `angle = atan2(dyPx, dxPx)`.

**`updateNestScreen`:**
- **Arrows:** only in `fighting`/`gap`, for alive monsters whose projection is behind or has |nx| or |ny| above 1.
- **Lock:** on when `n.lock ≥ 0`, its target is alive, and it projects on screen. Pixel `x = (nx/2 + 0.5)·w`, `y = (−ny/2 + 0.5)·h`.
- **Hit:**
  - `seenSeq`/`hitAt` stamp the latest strike;
  - it is on for `HIT_MARK_S`, at the lock's pixel when locked, else at the strike's on-screen projection.

**`hitMarkOpacity`:** mirrors `flashOpacity`, with a 0.25 s window and a static 1 under reduced motion.

- [ ] **Step 4: Wire the driver and the overlay**

- **`NestDirector.tsx`:** after `applyNestEvents`, call `updateNestScreen(combat.nest, camera.matrixWorldInverse.elements, camera.projectionMatrix.elements, size.width, size.height, performance.now() / 1000, nestScreen)`, using `useFrame`'s `state.camera` and `state.size`, as WaypointDriver does.
- **`NestOverlay.tsx`**, in the same `tick`:
  - **Elements:**
    - a 36 px red bracket reticle (four corner borders) at the lock;
    - a small `HIT` label at `hit`, with opacity from `hitMarkOpacity` and `data-mode` static/fade like the flash;
    - 8 small red arrow elements, each `translate(x, y) rotate(angle rad)`.
  - **Visibility:** each element has `display:none` when unused. All three are hidden in photo mode. The root's `on` now includes them.
  - **Writes:** only for shown elements, through `setStyle` with whole pixels.

- [ ] **Step 5: Run them and see them pass**

Run: `npx vitest run tests/nestScreen.test.ts tests/nestHud.test.ts tests/nestHudMarkup.test.tsx tests/nestImports.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/nestScreen.ts src/utils/combat/nestHud.ts src/components/canvas/NestDirector.tsx src/components/layout/NestOverlay.tsx tests
git commit -m "feat(nest): lock reticle, HIT marker and edge arrows"
```

---

### Task 7: The combat probe, perf re-measure, changelog and follow-ups

**Files:**
- Modify:
  - `tests/e2e/combat.probe.mjs`
  - `tests/e2e/run.mjs` (the combat parts' COST, from the run's own timings)
  - `docs/PERF-BUDGETS.md`
  - `src/data/changelog.ts`
  - `docs/FOLLOW-UPS.md`

**Interfaces:**
- Consumes:
  - `NEST_JUMP_ID` (Task 2)
  - the scene names `NestRocks` and `NestGlow` (Task 3)
  - the phases `"asleep"`/`"waking"` (Task 4)
  - `strikeSeq` (Task 5)
  - the test ids `nest-lock`, `nest-hit` and `nest-arrow` (Task 6)

- [ ] **Step 1: Write the probe additions** (all in part 1, `fight`; `PARTS.combat` stays 5)

1. **In `fight` only, replace `approach`'s teleport with a jump** (`reducedMotion` keeps `approach`). Run `__fitz.store.getState().requestJump("the_nest")` from the start pose, then wait for `warm` and both glbs as before.
   - Check: "a jump to THE NEST lands within 1 u of the tow pose, nose on the centre". Distance < 1, and `|flight.heading − tow.yaw| < 1e-6`.
2. **"sleepers sit at home before the fight":**
   - poll ≤ 5 s for saucers 0–2 and the tardigrade all `asleep` with scale 1;
   - the instances drawn sum to ≥ 4;
   - a variant of `onScreen` that includes asleep monsters has all 4 on screen;
   - `NestRocks` and `NestGlow` are found and visible;
   - screenshot `combat-sleepers.png`.
3. **Wave 1 from the sleepers:** after the existing "wave 1 spawns 3 saucers", check the three alive saucers are slots 0–2.
4. **"edge arrows point at monsters behind":**
   - after the formation screenshot, `setAttitude(yaw + π, 0)` and 30 frames (the chase camera swings round) → exactly 3 `[data-testid="nest-arrow"]` shown;
   - turn back and 30 frames → 0 shown.
5. **Replace the frozen F hold with a strafing one.** Run `__fitz.nest.resume()`, `aimAt` the first alive saucer, and hold `KeyF`. Poll every 20 ms; within the 10 s that the defeat poll already allows, see:
   - `nest-lock` shown ("held F locks a strafing saucer: the reticle shows");
   - `strikeSeq` > 0 and `nest-hit` shown at least once ("a hit flashes HIT");
   - contacts 3 → 2 (the existing defeat check).

   The later "Take hits" section keeps its `resume()` (harmless).

- [ ] **Step 2: Run the probe**

Run: `node tests/e2e/run.mjs combat`
Expected: all five parts pass, including part 0's rim marker (Task 2).

- [ ] **Step 3: Re-measure "In the Nest (wave 3)"**

Run: `node tests/e2e/run-one.mjs combat#2` six times, serially, alone on the machine.
Expected: the same reading every run, with programs ≤ 61.

Set the ceilings by the existing rule:
- `NEST_CALLS_CEILING` = calls × 1.15, rounded up to ten;
- `NEST_TRIS_CEILING` = triangles × 1.15, rounded up to ten;
- `NEST_PROGRAMS_CEILING` stays 62.

The calls may grow only by the rocks (≤ 4) and the glow (1). Fail the task if they grow more.

Update the probe's ceiling comment and `docs/PERF-BUDGETS.md`'s row and paragraph. The paragraph gives the new baseline, the Nest's own share, and the cause: rocks one call per variant drawn, glow one call, sparks inside the bolt mesh.

- [ ] **Step 4: Add the changelog entry, newest first** (title ≤ 4 words; what/why ≤ 220 chars; how ≤ 240 chars)

```ts
{ id: "2026-10-27-nest-playable", date: "2026-10-27", pr: 68, title: "The Nest, Playable",
  what: "Pick The Nest in the jump list to fly straight there, and the radar always points to it. Its monsters sleep in a glowing rock nest until you cross in. Hold F to lock on; red arrows show where they are.",
  why: "Pilots said the Nest and its monsters were hard to find and harder to hit, and that far from the Sun the screen washed out.",
  how: "A jump target and a radar rim marker, scenery rocks around a slime glow, sleeping monsters that wake on entry, a lock-on with bigger hit spheres, and glows and sky held at their near-Sun brightness." },
```

- [ ] **Step 5: Update `docs/FOLLOW-UPS.md`**

Under "Combat, for the coins stage", add:
- the self-lit materials checked and left as they are (comets, plasma anomalies, shooting stars, the warp tunnel, the dormant gate's seam), each with its reason;
- point lights are not glow-scaled;
- no gamepad button for the Nest jump, and no number key once more than six probes fly;
- the rocks don't tumble.

- [ ] **Step 6: Verify the whole branch**

Run: `npm run build && npx vitest run && npm run test:e2e` (main checkout).
Expected:
- all green;
- `programs` still +0;
- `memory` idle allocation and tour within budget;
- `look` passes.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/combat.probe.mjs tests/e2e/run.mjs docs/PERF-BUDGETS.md src/data/changelog.ts docs/FOLLOW-UPS.md
git commit -m "test(nest): jump, sleepers, arrows and lock in the combat probe; perf re-measured; changelog"
```
