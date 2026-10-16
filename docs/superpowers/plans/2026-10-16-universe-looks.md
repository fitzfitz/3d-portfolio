# Universe Laws Phase 1 ("Looks right") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make what the visitor sees obey the laws of vacuum optics, and tell them the two orrery conventions: steady fixed stars (F6), vacuum engine plumes (F7), lens glare instead of god rays (F5), and real-unit readouts plus a "not to scale" note (F13).

**Architecture:** Each fix stays in the file that already owns the effect. Each one also extracts a small pure module that can be unit-tested: `starLayer.ts` (star shader), `sunGlare.ts` (glare levels), and `realUnits.ts` (scene units to km, AU and years). The GodRays post pass and its workaround file are removed, not replaced. The new glare is sprites in the existing `SunFlare`, which reuse the sprite program the flare ghosts already compile.

**Tech Stack:** React 19, @react-three/fiber, three.js, @react-three/postprocessing, Vitest, Node e2e probes (`npm run test:e2e`), Playwright MCP for screenshots.

**Spec:** `docs/superpowers/specs/2026-10-16-universe-laws-fixes-design.md` (F5, F6, F7, F13), with the catalogue at `docs/UNIVERSE-RULES.md`.

## Global Constraints

- Work on branch `feat/universe-looks`, cut from `feat/universe-rules` (PR #29). Rebase onto `main` once #29 merges. Never merge without the owner.
- No new shader program during play: `tests/e2e/programs.probe.mjs` must report `added=0` for the tour. Ceilings in `tests/e2e/transition.probe.mjs` may only go down; record any drop in `docs/PERF-BUDGETS.md`.
- `LIGHT_BUDGET` stays 4; add no lights.
- Reduced motion and the low-perf tier keep working; `SunFlare` stays skipped in low-perf, as today.
- Every law fixed here flips to **Follows** in `docs/UNIVERSE-RULES.md` in the same task.
- One changelog entry for the PR (`src/data/changelog.ts`), with the PR number it will get (next free; `tests/changelog.test.ts` forbids gaps).
- Subagents must not install packages or kill processes by name.
- Before `npm run test:e2e`: close Playwright MCP tabs and make sure nothing listens on port 5199.

**Spec deviation (decided while planning):** F13 said the "not to scale" note also sits "on the scan of the sun". The ship spawns at (0, 0, 18), only 10 units from the sun's surface, inside `SCAN_RANGE` 22. A scannable sun would capture the first scan of every visit. The note goes in the logbook, the HUD and the planet scans instead; the sun stays unscannable.

## Review Focus

1. **Phone-width HUD.** The velocity line grows ("VELOCITY: 187 KM/S · SUN 1.02 AU"). On a 390 px screen it must not overflow or overlap. Test: Task 4, Step 7.
2. **Sun behind the camera or off screen.** The glare must vanish, not appear at a mirrored point. Test: Task 3, Step 1 (`inFront=false`, off-screen offset).
3. **A first look at the sun compiles a program.** The new sprites must reuse the ghosts' `SpriteMaterial` program. Test: Task 3, Step 8 (programs probe `added=0`).
4. **Solar-flare world event washes the screen white.** Glare must stay bounded during a flare. Test: Task 3, Step 1 (flare multiplier capped at 1.5).
5. **Ghost ships and the tractor beam share the plume shader and geometry.** Ghosts must keep their plume; the beam must keep its cone. Test: Task 2, Step 1 (beam geometry unchanged) and Step 6 (live-sky probe).

---

### Task 1: Steady, fixed stars (F6; L23, L24)

**Files:**
- Create: `src/components/canvas/starLayer.ts`
- Modify: `src/components/canvas/GlobalCanvas.tsx:47-150` (the `StarLayer` props, shaders, `useFrame`) and `:210-222` (`GalaxyStarfield`)
- Modify: `tests/e2e/sky.probe.mjs` (one new check)
- Modify: `docs/UNIVERSE-RULES.md` (L23, L24)
- Test: `tests/starLayer.test.ts`

**Interfaces:**
- Produces: `makeStarMaterial(opacity: number): THREE.ShaderMaterial`, whose uniforms are exactly `uOpacity` and `uPixelRatio`. The star `<points>` objects are named `"StarLayer"`.

- [ ] **Step 1: Write the failing test** `tests/starLayer.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { makeStarMaterial } from "../src/components/canvas/starLayer";

describe("star layer (L23 no twinkle, L24 fixed stars)", () => {
  it("has no time input: stars do not twinkle or move", () => {
    const m = makeStarMaterial(0.8);
    expect(Object.keys(m.uniforms).sort()).toEqual(["uOpacity", "uPixelRatio"]);
    expect(m.vertexShader).not.toMatch(/uTime|uTwinkle|sin\(/);
    expect(m.fragmentShader).not.toMatch(/uTime|vFlicker/);
  });
  it("keeps the opacity it was given", () => {
    expect(makeStarMaterial(0.8).uniforms.uOpacity.value).toBe(0.8);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/starLayer.test.ts`
Expected: FAIL, cannot resolve `../src/components/canvas/starLayer`.

- [ ] **Step 3: Create `starLayer.ts` and slim `StarLayer`**

`starLayer.ts` takes the star vertex and fragment shaders from `GlobalCanvas.tsx` with the flicker removed. `gl_PointSize = max(1.0, aSize * uPixelRatio)`; the fragment alpha is `a * a`. The `aPhase` attribute goes. `makeStarMaterial` keeps the current flags (`vertexColors`, transparent, no depth write, additive).

In `GlobalCanvas.tsx`, `StarLayer` loses its `speed` and `twinkle` props, its phase array and its rotation write. `useFrame` keeps only `position.set(flight.x, flight.y, flight.z)` and the `uPixelRatio` update. Name the points `"StarLayer"`. Replace the `GalaxyStarfield` comments: three depths of fixed stars that ride with the ship, so they show no parallax, never move (L24) and never twinkle in vacuum (L23).

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run tests/starLayer.test.ts && npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS, no type errors.

- [ ] **Step 5: Add the e2e check** in `tests/e2e/sky.probe.mjs`, following that probe's existing scene-traversal pattern

Check `"the star shells hold still"`: every object named `StarLayer` has the same world quaternion before and after a 2 s wait. The count of such objects is 3.

- [ ] **Step 6: Flip L23 and L24** in `docs/UNIVERSE-RULES.md` to **Follows**, stating what the scene does now.

- [ ] **Step 7: Commit**

```bash
git add src/components/canvas/starLayer.ts src/components/canvas/GlobalCanvas.tsx tests/starLayer.test.ts tests/e2e/sky.probe.mjs docs/UNIVERSE-RULES.md
git commit -m "feat(sky): steady fixed stars — no twinkle or drift in vacuum (L23, L24)"
```

---

### Task 2: Vacuum engine plumes (F7; L31)

**Files:**
- Modify: `src/components/canvas/enginePlume.ts` (header comment, `FRAG`, `makePlumeGeometry`)
- Modify: `docs/UNIVERSE-RULES.md` (L31)
- Test: `tests/enginePlume.test.ts`

**Interfaces:**
- Produces: `export const PLUME_TIP_SPREAD = 3.2`: the tip radius ÷ the nozzle radius. `makePlumeGeometry(nozzleRadius)` keeps its signature and segment counts (20 × 12, open-ended), so the triangle count is unchanged. `makeBeamGeometry` is untouched.

- [ ] **Step 1: Write the failing tests** (append to `tests/enginePlume.test.ts`)

```ts
import { makePlumeGeometry, PLUME_TIP_SPREAD } from "../src/components/canvas/enginePlume";

describe("vacuum plume (L31)", () => {
  const radiusAt = (g: THREE.BufferGeometry, y: number) => {
    const p = g.attributes.position; let r = 0;
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - y) < 1e-6) r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i)));
    return r;
  };
  it("spreads toward the tip instead of tapering (no ambient pressure to hold it in)", () => {
    const g = makePlumeGeometry(0.07);
    expect(radiusAt(g, 0.5)).toBeCloseTo(0.07, 6);            // nozzle (top)
    expect(radiusAt(g, -0.5)).toBeCloseTo(0.07 * PLUME_TIP_SPREAD, 6); // tip
    expect(PLUME_TIP_SPREAD).toBeGreaterThanOrEqual(2);
  });
  it("keeps the same triangle count", () => {
    expect(makePlumeGeometry(0.07).index!.count).toBe(20 * 12 * 6);
  });
  it("has no shock diamonds (they need an atmosphere)", () => {
    const f = makePlumeMaterial(0).fragmentShader;
    expect(f).not.toMatch(/diamond/i);
    expect(f).not.toMatch(/sin\(t \*/);
  });
});
```

The existing `makeBeamGeometry` test stays and must keep passing.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/enginePlume.test.ts`
Expected: FAIL, `PLUME_TIP_SPREAD` is not exported and the shader still contains `diamonds`.

- [ ] **Step 3: Implement**

- `makePlumeGeometry` becomes `CylinderGeometry(nozzleRadius, nozzleRadius * PLUME_TIP_SPREAD, 1, 20, 12, true)`.
- In `FRAG`, delete the diamonds term and its `mix`. Use `fall = pow(1.0 - t, 2.4)` so a widening plume fades fast and stays brightest at the nozzle. The flicker, the colour ramp and the power scaling stay.
- Rewrite the header comment: a vacuum plume fans out and fades; shock diamonds form only against air pressure (L31).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/enginePlume.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Flip L31** in `docs/UNIVERSE-RULES.md` to **Follows**.

- [ ] **Step 6: Run the probes that draw plumes**

Run: `npm run build && node tests/e2e/run.mjs livesky transition`. If the runner takes no filter, run `npm run test:e2e` and read those sections.
Expected: live sky is all PASS (ghosts still draw their plume) and the transition triangle counts are unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/components/canvas/enginePlume.ts tests/enginePlume.test.ts docs/UNIVERSE-RULES.md
git commit -m "feat(ship): vacuum engine plumes — spread and fade, no shock diamonds (L31)"
```

---

### Task 3: Lens glare replaces god rays (F5; L21, L22)

**Files:**
- Create: `src/utils/sunGlare.ts`
- Modify: `src/components/canvas/Sun.tsx`. Drop the `onSunReady` prop and the `coreRef` callback. Inline the core's `transparent: true, depthWrite: false`, with the reason: the corona billboard blends across the disc. Add glare sprites to `SunFlare`. Move the planet occluder array here from PostFX.
- Modify: `src/components/canvas/PostFX.tsx`. Remove `GodRays`, `GODRAYS_EXPOSURE`, `OCCLUDERS`, `useGodRaysOcclusion`, the `sunMesh` prop and their now-unused imports. Keep `multisampling={0}` and reword its comment (SMAA handles edges).
- Modify: `src/components/canvas/GlobalCanvas.tsx:465,571,645`. Remove the `sunMesh` state; render `<Sun />` and `<PostFX enabled={!isLowPerf} />`.
- Delete: `src/components/canvas/godRays.ts`, `tests/godRaysSource.test.ts`
- Modify: `tests/e2e/sky.probe.mjs:185-193` (capture renamed to "sun glare", file `sky-glare-open.png`), `tests/e2e/programs.probe.mjs:8` (comment), `docs/QA-CHECKLIST.md` (god-ray item becomes a glare item), `docs/PERF-BUDGETS.md` (god-ray pass removed, with the new measured numbers), `docs/UNIVERSE-RULES.md` (L21, L22)
- Test: `tests/sunGlare.test.ts`

**Interfaces:**
- Consumes: `sunVisibility(camera: Vec3, occluders: Occluder[], sunRadius: number): number` (0..1) from `src/utils/sunOcclusion.ts`, and `flareLevel(...)` from `src/utils/worldEvents.ts`.
- Produces: `glareLevels(ndcX: number, ndcY: number, inFront: boolean, visibility: number, flare: number): { spikes: number; veil: number }`.

- [ ] **Step 1: Write the failing test** `tests/sunGlare.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { glareLevels } from "../src/utils/sunGlare";

describe("glareLevels (L21: no beams in vacuum; L22: lens glare is real)", () => {
  it("is zero behind the camera or when the sun is fully covered", () => {
    expect(glareLevels(0, 0, false, 1, 0)).toEqual({ spikes: 0, veil: 0 });
    expect(glareLevels(0, 0, true, 0, 0)).toEqual({ spikes: 0, veil: 0 });
  });
  it("veiling glare is strongest looking straight at the sun and gone by the screen edge", () => {
    const c = glareLevels(0, 0, true, 1, 0).veil, mid = glareLevels(0.6, 0, true, 1, 0).veil;
    expect(c).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(0);
    expect(glareLevels(1.0, 0, true, 1, 0).veil).toBe(0);
  });
  it("diffraction spikes stay visible toward the edge but not past it", () => {
    expect(glareLevels(1.0, 0, true, 1, 0).spikes).toBeGreaterThan(0);
    expect(glareLevels(1.7, 0, true, 1, 0).spikes).toBe(0);
  });
  it("scales linearly with how much of the sun is uncovered", () => {
    const full = glareLevels(0.2, 0.1, true, 1, 0), half = glareLevels(0.2, 0.1, true, 0.5, 0);
    expect(half.spikes).toBeCloseTo(full.spikes / 2, 9);
    expect(half.veil).toBeCloseTo(full.veil / 2, 9);
  });
  it("a solar flare brightens it by at most 1.5x", () => {
    const calm = glareLevels(0, 0, true, 1, 0), flare = glareLevels(0, 0, true, 1, 1);
    expect(flare.spikes / calm.spikes).toBeCloseTo(1.5, 9);
    expect(glareLevels(0, 0, true, 1, 5).spikes / calm.spikes).toBeCloseTo(1.5, 9);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run tests/sunGlare.test.ts`
Expected: FAIL, cannot resolve `../src/utils/sunGlare`.

- [ ] **Step 3: Implement `glareLevels`** in `src/utils/sunGlare.ts`

Let `k = visibility × (1 + 0.5 × min(flare, 1))` and `off = hypot(ndcX, ndcY)`.
- `spikes = k × clamp(1 − off / 1.6, 0, 1)`
- `veil = 0.35 × k × clamp(1 − off / 0.9, 0, 1)²`

Both are 0 when `!inFront`. The file comment cites L21 and L22.

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/sunGlare.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the glare into `SunFlare`** (`Sun.tsx`)

- Add two sprites with the same `spriteMaterial` setup as the ghosts (additive, `depthTest={false}`, `renderOrder={10}`), so they share the ghosts' program.
  - **Diffraction spikes:** a new canvas texture, `flareTexture("spikes")`, with six thin rays fading outward. Size `0.45 × halfH × 2`.
  - **Veil:** the existing `soft` texture. Size `1.2 × halfH × 2`.
- Place both at the sun's screen point `(ndc.x × halfW, ndc.y × halfH, −FLARE_DEPTH)`. Their opacities are `glareLevels(...)` with `visibility = sunVisibility(cam.position, OCCLUDERS, SUN_RADIUS)` and `flare = flareLevel(worldEventElapsed("flare"))`.
- The flare ghosts use the same `visibility` in place of their boolean ray test, so there is one occlusion model.
- Update the stale `useFrame` comment about the GodRays pass sampling the silhouette.

- [ ] **Step 6: Remove the god-ray pass and plumbing**

Make the edits to PostFX, GlobalCanvas and Sun listed under Files, then delete `godRays.ts` and `tests/godRaysSource.test.ts`.

Run: `npx tsc --noEmit -p tsconfig.app.json && npx vitest run && npm run lint`
Expected: no type errors; all unit tests pass; lint shows only the one existing `Atmosphere.tsx` warning.

- [ ] **Step 7: Update the probes and docs** listed under Files

In `docs/PERF-BUDGETS.md`, replace the GodRays transparent-sun paragraph with one sentence: the pass is gone (L21), and the sun keeps no-depth-write so the corona blends over its disc.

- [ ] **Step 8: Measure**

Run: `npm run build && npm run test:e2e`
Expected: everything passes. The programs tour reports `added=0`. The transition probe's calls and programs are at or below the old values; write the new numbers into `docs/PERF-BUDGETS.md`.

- [ ] **Step 9: Flip L21** to **Follows**, and note under L22 that glare, spikes and flare ghosts are the lens.

- [ ] **Step 10: Commit**

```bash
git add -A src/utils/sunGlare.ts tests/sunGlare.test.ts src/components/canvas/Sun.tsx src/components/canvas/PostFX.tsx src/components/canvas/GlobalCanvas.tsx src/components/canvas/godRays.ts tests/godRaysSource.test.ts tests/e2e/sky.probe.mjs tests/e2e/programs.probe.mjs docs/QA-CHECKLIST.md docs/PERF-BUDGETS.md docs/UNIVERSE-RULES.md
git commit -m "feat(sun): lens glare and diffraction spikes replace god rays — no beams in vacuum (L21, L22)"
```

---

### Task 4: Real units and the orrery note (F13; L13, L34, L40)

**Files:**
- Modify: `src/constants.ts`. Add `export const AU = 115` (scene units per AU, Ruangrapi's orbit) and `export const YEAR_S = 420` (game seconds per year). `GM_SUN = keplerGM(AU, YEAR_S)`.
- Create: `src/utils/realUnits.ts`
- Modify: `src/components/layout/HUDOverlay.tsx:95-100` (velocity line, plus `data-testid="hud-velocity"` on the `velRef` element)
- Modify: `src/utils/scanReport.ts` (planet reports gain the orbit line)
- Modify: `src/components/layout/LogbookPanel.tsx` (a "THE UNIVERSE" note just above `CLOSE: L / ESC`)
- Modify: `tests/e2e/careerphone.probe.mjs` (phone-width HUD check)
- Modify: `docs/UNIVERSE-RULES.md` (L13, L34, L40, and the Units table: cite `realUnits.ts`)
- Test: `tests/realUnits.test.ts`, `tests/scanReport.test.ts`

**Interfaces:**
- Consumes: `planets`, `SHIP_MAX_SPEED`, `SHIP_WARP_SPEED`, `GM_SUN`, `AU`, `YEAR_S` from `src/constants.ts`.
- Produces:
  - `AU_KM = 149_597_870.7`
  - `KM_PER_UNIT = AU_KM / AU`
  - `SECONDS_PER_GAME_SECOND = (365.25 × 86400) / YEAR_S`
  - `speedKmS(uPerS: number): number`
  - `distanceAU(units: number): number`
  - `earthYears(gameSeconds: number): number`
  - `formatOrbit(orbit: OrbitalElements): string`, returning e.g. `"ORBIT 1.30 AU · YEAR 1.49 EARTH-YR"`
  - `SIZE_ENLARGEMENT: number`: planet radius in km ÷ Jupiter's 71,492 km, rounded to the nearest 10 (290 today)
  - `ORRERY_NOTE: string`: the copy shown in the logbook

- [ ] **Step 1: Write the failing tests** `tests/realUnits.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { planets, SHIP_MAX_SPEED, SHIP_WARP_SPEED, GM_SUN } from "../src/constants";
import { KM_PER_UNIT, SECONDS_PER_GAME_SECOND, speedKmS, distanceAU, earthYears, formatOrbit, SIZE_ENLARGEMENT, ORRERY_NOTE } from "../src/utils/realUnits";

// These are the numbers in docs/UNIVERSE-RULES.md "Units". Change both together.
describe("real units", () => {
  it("one game second is 20.9 hours", () => {
    expect(SECONDS_PER_GAME_SECOND / 3600).toBeCloseTo(20.87, 2);
  });
  it("GM_SUN in real units is the Sun's own 1.327e20 m^3/s^2", () => {
    const gmReal = GM_SUN * (KM_PER_UNIT * 1000) ** 3 / SECONDS_PER_GAME_SECOND ** 2;
    expect(gmReal / 1.327e20).toBeCloseTo(1, 2);
  });
  it("Ruangrapi moves at Earth's 29.8 km/s", () => {
    const o = planets[0].orbit;
    expect(speedKmS(o.radius * o.angularSpeed)).toBeCloseTo(29.78, 1);
  });
  it("the ship cruises at 187 km/s and warps at 675 km/s, under 1% of light speed", () => {
    expect(Math.round(speedKmS(SHIP_MAX_SPEED))).toBe(187);
    expect(Math.round(speedKmS(SHIP_WARP_SPEED))).toBe(675);
    expect(speedKmS(SHIP_WARP_SPEED) / 299_792.458).toBeLessThan(0.01);
  });
  it("orbits read in AU and Earth years", () => {
    expect(distanceAU(115)).toBe(1);
    expect(earthYears(420)).toBeCloseTo(1, 9);
    expect(formatOrbit(planets[0].orbit)).toBe("ORBIT 1.00 AU · YEAR 1.00 EARTH-YR");
    expect(formatOrbit(planets[1].orbit)).toBe("ORBIT 1.30 AU · YEAR 1.49 EARTH-YR");
    expect(formatOrbit(planets[2].orbit)).toBe("ORBIT 1.61 AU · YEAR 2.04 EARTH-YR");
  });
  it("the orrery note states the real enlargement and clock", () => {
    expect(SIZE_ENLARGEMENT).toBe(290);
    expect(ORRERY_NOTE).toBe("REAL PHYSICS, TWO ORRERY CONVENTIONS: BODIES DRAWN ~290× TRUE SIZE · 1 S ≈ 21 H · MOON SYSTEMS SHOWN AS INSETS");
  });
});
```

Append to `tests/scanReport.test.ts`:

```ts
it("planet scans end with the orbit in real units", () => {
  expect(generateScanReport("portfolio")).toMatch(/ \/\/ ORBIT 1\.30 AU · YEAR 1\.49 EARTH-YR$/);
  expect(generateScanReport("ruangrapi")).toContain("SUPABASE");
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run tests/realUnits.test.ts tests/scanReport.test.ts`
Expected: FAIL, cannot resolve `../src/utils/realUnits`; the scan assertion fails.

- [ ] **Step 3: Implement** the `AU` and `YEAR_S` constants, `realUnits.ts`, and the orbit suffix in `generateScanReport`

For planet ids, append `" // " + formatOrbit(orbit)` to the `PLANET_REPORTS` text, looking the orbit up in `planets` by name. `ORRERY_NOTE` is built from `SIZE_ENLARGEMENT` and the rounded hours, so it stays true if F12 changes sizes.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/realUnits.test.ts tests/scanReport.test.ts tests/universeRules.test.ts tests/projects.test.ts`
Expected: PASS.

- [ ] **Step 5: HUD readout**

The velocity line becomes `` `VELOCITY: ${speedKmS(flight.speed).toFixed(0)} KM/S · SUN ${distanceAU(Math.hypot(flight.x, flight.y, flight.z)).toFixed(2)} AU` ``. The old ×3.7 + random jitter goes. Add `data-testid="hud-velocity"`. The gravity-assist accent colour stays.

- [ ] **Step 6: Logbook note**

Add a `"THE UNIVERSE"` label and one line showing `ORRERY_NOTE`, styled like the `livesky-desc` paragraph, with `data-testid="logbook-universe-note"`, just above `CLOSE: L / ESC`.

- [ ] **Step 7: Phone-width check**

In `tests/e2e/careerphone.probe.mjs`, add the check `"the HUD velocity line fits the phone screen"`. Read the bounding box of `[data-testid=hud-velocity]` after flying for 1 s and require `right <= window.innerWidth`.

Run: `npm run build && npm run test:e2e`
Expected: all checks pass, including the new phone check and `logbook.probe.mjs`.

- [ ] **Step 8: Flip the statuses**

In `docs/UNIVERSE-RULES.md`, L13, L34 and L40 now read "Convention, disclosed in the logbook, the HUD and planet scans". The Units table cites `src/utils/realUnits.ts` as the code source of those numbers.

- [ ] **Step 9: Commit**

```bash
git add src/constants.ts src/utils/realUnits.ts src/utils/scanReport.ts src/components/layout/HUDOverlay.tsx src/components/layout/LogbookPanel.tsx tests/realUnits.test.ts tests/scanReport.test.ts tests/e2e/careerphone.probe.mjs docs/UNIVERSE-RULES.md
git commit -m "feat(hud): real units and the orrery note — km/s, AU, Earth years (P3)"
```

---

### Task 5: Changelog, browser check and PR

**Files:**
- Modify: `src/data/changelog.ts`
- Modify: `docs/superpowers/specs/2026-10-16-universe-laws-fixes-design.md` (record the sun-scan deviation under F13)

- [ ] **Step 1: Changelog entry**

Add the entry at the top. Use `pr` = the next free number (`gh pr list --state all --limit 1 --repo fitzfitz/3d-portfolio`, +1). The title is `"Honest Optics"`. Within the format limits, it says:
- **what:** steady stars, plumes that spread in vacuum, lens glare instead of light beams, and speed and distance in real units;
- **why:** vacuum has no air to make stars twinkle, shape plumes or show beams;
- **how:** the four mechanisms above.

Run: `npx vitest run tests/changelog.test.ts`
Expected: PASS.

- [ ] **Step 2: Record the deviation** under F13 in the design: no sun scan, because spawn is 10 units from the sun's surface, inside the scan range.

- [ ] **Step 3: Real-browser screenshots** (Playwright MCP, `npm run dev` on a port other than 5199)

Capture:
- stars over 10 s, unchanged;
- the plume at cruise and at warp, and a ghost plume if live sky has company;
- the sun head-on, at the screen edge, and half-covered by a planet;
- the HUD at 1512 × 802 and at 390 × 844;
- the logbook with the universe note.

Use the reduced-motion and teleport recipe from the project notes for stable shots. Close the tab and stop the dev server afterwards.

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx vitest run && npm run lint && npm run build && npm run test:e2e`
Expected: all green; lint shows only the one existing warning.

- [ ] **Step 5: Commit, push, open the PR**

```bash
git add src/data/changelog.ts docs/superpowers/specs/2026-10-16-universe-laws-fixes-design.md
git commit -m "docs: Honest Optics changelog and the F13 sun-scan note"
GH_TOKEN=$(gh auth token --user fitzfitz) git -c credential.helper= -c "credential.helper=!f() { echo username=fitzfitz; echo password=\$GH_TOKEN; }; f" push -u origin feat/universe-looks
```

Open the PR against `feat/universe-rules`, or `main` if #29 has merged. Attach the screenshots and the measured perf numbers. Hand the link to the owner; do not merge.
