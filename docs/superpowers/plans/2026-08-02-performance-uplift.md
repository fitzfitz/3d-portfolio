# Performance Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the frame hitches that appear at every state transition — planet approach, plasma spawn, modal open — and install guardrails so the class of regression cannot return.

**Architecture:** Three independent root causes share one principle: nothing may be constructed while the visitor is in control. Fix them by (a) severing React re-render propagation from DOM state into the R3F tree, (b) preallocating the plasma pool so no light or material is ever created at runtime, and (c) removing compositor blur layered over the live canvas. Each fix is landed test-first, and the tests become the permanent guardrails.

**Tech Stack:** React 19, @react-three/fiber 9, @react-three/drei 10, @react-three/postprocessing 3, three 0.185, zustand 5, vitest 4, puppeteer-core 25.

**Spec:** `docs/superpowers/specs/2026-08-02-performance-uplift-design.md`

**Branch:** `perf/transition-hitches` (already created, spec committed at 98fb969)

## Global Constraints

- All debug surfaces gate on `import.meta.env.DEV` so the `__fitz` string is dead-code-eliminated from production builds. Follow the existing pattern in `src/main.tsx:7-9`.
- Never introduce React state that changes during flight. The project's standing guarantee is zero React commits during steady flight, asserted by `tests/e2e/perf.probe.mjs`. Per-frame values live in module-level mutable objects (`flight`, `bodies`, `crystalSlots` in `src/store/spaceStore.ts`).
- Frame loops must allocate nothing. Use module-level scratch objects, as `PlasmaAnomalies.tsx:18-19` and `FuelCrystals.tsx` already do.
- Store setters called from frame loops must be change-guarded (`if (get().x !== v) set(...)`), matching `spaceStore.ts:227-234`.
- Run `npm run lint` (oxlint) and `npm test` (vitest) before every commit. Run `npm run test:e2e` before commits that touch probes or canvas components.
- Commit messages: lowercase conventional prefix, imperative, explain *why* not *what*. Match the existing log style.

---

## File Structure

**New files:**

| Path | Responsibility |
|---|---|
| `src/debug/perfStats.ts` | Module-level frame-time ring buffer + percentile maths. Pure, unit-testable. |
| `src/debug/PerfSampler.tsx` | Inside-canvas component. Samples `gl.info` and frame delta into `perfStats` each frame. |
| `src/debug/PerfOverlay.tsx` | DOM overlay reading `perfStats` on rAF. DEV-only. |
| `src/components/canvas/PostFX.tsx` | Owns the postprocessing chain with a stable children identity. |
| `tests/perfStats.test.ts` | Unit tests for percentile + ring buffer. |
| `tests/noBackdropFilter.test.ts` | Static guardrail (G4): scans `src/**` for `backdrop-filter`. |
| `tests/e2e/transition.probe.mjs` | Guardrails G1 + G2: zero canvas commits and stable renderer counters across transitions. |
| `docs/PERF-BUDGETS.md` | Recorded baselines, their capture date, and the derivation rule. |

**Modified files:**

| Path | Change |
|---|---|
| `src/debug/bridge.ts` | Add `canvasRenderCount`, `perf` fields. |
| `src/components/canvas/GlobalCanvas.tsx` | `memo`, extract PostFX, drop `isWarping` subscription, move `<Preload all />`, add `frameloop`, mount PerfSampler. |
| `src/components/canvas/PlasmaAnomalies.tsx` | Rewrite as pooled `InstancedMesh`; delete per-anomaly light and scene clone. |
| `src/App.tsx` | Mount `PerfOverlay`; remove `backdrop-blur-[3px]` from teleport flash. |
| `src/index.css` | Remove `backdrop-filter` from `.glass-panel` / `.glass-card`; narrow `transition: all`. |
| `src/store/spaceStore.ts` | Add `isSceneFrozen` selector helper. |
| `src/constants.ts` | Add `LIGHT_BUDGET`. |
| `src/components/canvas/Sun.tsx` | Remove inert `castShadow`. |
| `src/components/canvas/SpacePlanets.tsx` | Remove three inert `castShadow`. |
| `tests/e2e/run.mjs` | Register the `transition` probe. |

---

### Task 1: Frame-time statistics module

The instrument everything else is measured with. Pure module first, so the maths is unit-tested before any React touches it.

**Files:**
- Create: `src/debug/perfStats.ts`
- Test: `tests/perfStats.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `perfStats` object with shape `{ frames: Float32Array, idx: number, count: number, calls: number, triangles: number, programs: number, lights: number }`; `pushFrame(ms: number): void`; `percentile(p: number): number`; `resetStats(): void`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/perfStats.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { perfStats, pushFrame, percentile, resetStats } from "../src/debug/perfStats";

describe("perfStats", () => {
  beforeEach(() => resetStats());

  it("reports 0 before any frame is recorded", () => {
    expect(percentile(50)).toBe(0);
    expect(percentile(99)).toBe(0);
  });

  it("computes p50 and p99 over recorded frames", () => {
    for (let i = 1; i <= 100; i++) pushFrame(i);
    expect(percentile(50)).toBe(50);
    expect(percentile(99)).toBe(99);
  });

  // Nearest-rank: p99 of 100 samples is the 99th, i.e. index 98. A single
  // spike in 100 therefore does NOT land at p99 -- it takes 10 spikes in 100
  // for the 99th-ranked sample to be one. Asserting otherwise would be
  // asserting a percentile definition that no percentile uses.
  it("surfaces sustained spikes at p99 but not at p50", () => {
    for (let i = 0; i < 90; i++) pushFrame(16);
    for (let i = 0; i < 10; i++) pushFrame(400);
    expect(percentile(50)).toBe(16);
    expect(percentile(99)).toBe(400);
  });

  it("does not let one outlier in a hundred move p99", () => {
    for (let i = 0; i < 99; i++) pushFrame(16);
    pushFrame(400);
    expect(percentile(99)).toBe(16);
    expect(percentile(100)).toBe(400);
  });

  it("wraps at capacity, keeping only the most recent samples", () => {
    for (let i = 0; i < 300; i++) pushFrame(1);
    for (let i = 0; i < 240; i++) pushFrame(9);
    expect(perfStats.count).toBe(240);
    expect(percentile(50)).toBe(9);
  });

  it("clamps percentile input to the valid range", () => {
    for (let i = 1; i <= 10; i++) pushFrame(i);
    expect(percentile(0)).toBe(1);
    expect(percentile(100)).toBe(10);
    expect(percentile(150)).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/perfStats.test.ts`
Expected: FAIL — `Failed to resolve import "../src/debug/perfStats"`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/debug/perfStats.ts

/**
 * Rolling frame-time window for the DEV perf overlay. A ring buffer rather
 * than a growing array: this is written every frame, so it must allocate
 * nothing after construction — the same discipline the flight loops follow.
 *
 * 240 samples is roughly four seconds at 60fps: long enough that p99 means
 * something, short enough that a hitch shows up while the visitor still
 * remembers causing it.
 */
const CAPACITY = 240;

export const perfStats = {
  frames: new Float32Array(CAPACITY),
  idx: 0,
  count: 0,
  /** Latest renderer.info values, written by PerfSampler. */
  calls: 0,
  triangles: 0,
  programs: 0,
  lights: 0,
};

/** Scratch array for percentile sorting — reused so reads allocate nothing. */
const scratch = new Float32Array(CAPACITY);

export function pushFrame(ms: number): void {
  perfStats.frames[perfStats.idx] = ms;
  perfStats.idx = (perfStats.idx + 1) % CAPACITY;
  if (perfStats.count < CAPACITY) perfStats.count++;
}

export function percentile(p: number): number {
  const n = perfStats.count;
  if (n === 0) return 0;
  scratch.set(perfStats.frames.subarray(0, n));
  const view = scratch.subarray(0, n);
  view.sort();
  const clamped = Math.max(0, Math.min(100, p));
  const rank = Math.ceil((clamped / 100) * n) - 1;
  return view[Math.max(0, rank)];
}

export function resetStats(): void {
  perfStats.frames.fill(0);
  perfStats.idx = 0;
  perfStats.count = 0;
  perfStats.calls = 0;
  perfStats.triangles = 0;
  perfStats.programs = 0;
  perfStats.lights = 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/perfStats.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/debug/perfStats.ts tests/perfStats.test.ts
git commit -m "perf: add a frame-time ring buffer for the dev overlay

p99 is the metric that matters here -- every reported symptom is a spike,
and an average would hide all of them. Ring buffer so the per-frame write
allocates nothing."
```

---

### Task 2: Perf sampler and DEV overlay

**Files:**
- Create: `src/debug/PerfSampler.tsx`, `src/debug/PerfOverlay.tsx`
- Modify: `src/components/canvas/GlobalCanvas.tsx` (mount sampler next to `DebugBridge` at line 203), `src/App.tsx` (mount overlay)

**Interfaces:**
- Consumes: `perfStats`, `pushFrame`, `percentile` from Task 1.
- Produces: `<PerfSampler />` (renders null, must be inside `<Canvas>`), `<PerfOverlay />` (renders a fixed-position DOM panel, must be outside `<Canvas>`).

- [ ] **Step 1: Write the sampler**

```tsx
// src/debug/PerfSampler.tsx
import { useFrame, useThree } from "@react-three/fiber";
import { pushFrame, perfStats } from "./perfStats";

/**
 * Samples renderer counters and frame time into `perfStats`. Renders nothing
 * and holds no state, so it cannot itself cause the commits it exists to
 * measure. Mounted only under import.meta.env.DEV, alongside DebugBridge.
 */
export default function PerfSampler() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useFrame((_state, delta) => {
    pushFrame(delta * 1000);
    perfStats.calls = gl.info.render.calls;
    perfStats.triangles = gl.info.render.triangles;
    perfStats.programs = gl.info.programs?.length ?? 0;
    let lights = 0;
    scene.traverse((o) => { if ((o as { isLight?: boolean }).isLight) lights++; });
    perfStats.lights = lights;
  });

  return null;
}
```

- [ ] **Step 2: Write the overlay**

```tsx
// src/debug/PerfOverlay.tsx
import { useEffect, useRef } from "react";
import { perfStats, percentile } from "./perfStats";

/**
 * DEV-only readout. Writes through a ref on rAF rather than React state --
 * a setState here would re-render App every frame and manufacture exactly
 * the problem this overlay exists to find.
 */
export default function PerfOverlay() {
  const ref = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const p50 = percentile(50);
        const p99 = percentile(99);
        el.textContent =
          `p50 ${p50.toFixed(1)}ms  p99 ${p99.toFixed(1)}ms\n` +
          `calls ${perfStats.calls}  tris ${perfStats.triangles}\n` +
          `programs ${perfStats.programs}  lights ${perfStats.lights}`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <pre
      ref={ref}
      className="fixed bottom-4 left-4 z-[100] pointer-events-none select-none
                 font-mono text-[10px] leading-relaxed text-primary/80
                 bg-black/70 border border-primary/20 rounded-lg px-3 py-2"
    />
  );
}
```

- [ ] **Step 3: Mount both**

In `src/components/canvas/GlobalCanvas.tsx`, add the import beside the existing `DebugBridge` import (line 25) and mount at line 203:

```tsx
import PerfSampler from "../../debug/PerfSampler";
```

```tsx
{import.meta.env.DEV && <DebugBridge />}
{import.meta.env.DEV && <PerfSampler />}
```

In `src/App.tsx`, add the import and mount inside the root `<div>`, immediately after `<CustomCursor />` (line 71):

```tsx
import PerfOverlay from "./debug/PerfOverlay";
```

```tsx
{import.meta.env.DEV && <PerfOverlay />}
```

- [ ] **Step 4: Verify manually**

Run: `npm run dev`
Expected: overlay visible bottom-left, numbers updating. Fly around and confirm p50 sits near 16.7ms. Note the p99 you see when approaching a planet, opening a modal, and clicking to spawn plasma — **write these three numbers down**, they are the before-baseline this whole plan is judged against.

- [ ] **Step 5: Verify lint and unit tests still pass**

Run: `npm run lint && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/debug/PerfSampler.tsx src/debug/PerfOverlay.tsx src/components/canvas/GlobalCanvas.tsx src/App.tsx
git commit -m "perf: add a dev-only frame-time and renderer-counter overlay

Headless SwiftShader frame times are noise, so the numbers that matter can
only be read on real hardware. This is where they get read. The overlay
writes through a ref on rAF rather than setState -- a per-frame setState
would manufacture the exact problem it exists to find."
```

---

### Task 3: Canvas isolation (the verification gate)

The spec's Task 1 gate. The probe is written first and must fail; if it *passes* before the fix, RC1 is wrong and the plan branches — see Step 3.

**Files:**
- Modify: `src/debug/bridge.ts`, `src/components/canvas/GlobalCanvas.tsx`, `tests/e2e/run.mjs`
- Create: `src/components/canvas/PostFX.tsx`, `tests/e2e/transition.probe.mjs`

**Interfaces:**
- Consumes: `fitzDebug` from `src/debug/bridge.ts`.
- Produces: `fitzDebug.canvasRenderCount: number`; `<PostFX sunMesh={THREE.Mesh | null} />`.

- [ ] **Step 1: Add the canvas commit counter**

In `src/debug/bridge.ts`, add to the `FitzDebug` interface after `renderCount` (line 19):

```ts
  /**
   * Renders of the GlobalCanvas component, incremented in its render body.
   * Distinct from `renderCount`: main.tsx's Profiler wraps the DOM tree only
   * and structurally cannot observe R3F's separate reconciler root, so the
   * canvas subtree needs its own counter. StrictMode double-renders inflate
   * the absolute value; only deltas across an action are meaningful.
   */
  canvasRenderCount: number;
```

And to the `fitzDebug` literal after `renderCount: 0,`:

```ts
  canvasRenderCount: 0,
```

- [ ] **Step 2: Increment it in GlobalCanvas**

In `src/components/canvas/GlobalCanvas.tsx`, add as the first statement inside `function GlobalCanvas()` (currently line 164):

```tsx
  if (import.meta.env.DEV) fitzDebug.canvasRenderCount++;
```

Add the import alongside the existing `DebugBridge` import:

```tsx
import { fitzDebug } from "../../debug/bridge";
```

- [ ] **Step 3: Write the failing probe**

```js
// tests/e2e/transition.probe.mjs
import { withPage, settle, toDeepSpace } from "./harness.mjs";

/** Canvas renders since page load. Deltas across an action are what matter. */
const canvasRenders = (page) => page.evaluate(() => window.__fitz.canvasRenderCount);

/**
 * Teleports into a planet's gravity well but short of the orbit lock.
 *
 * Geometry (src/constants.ts): PLANET_SIZE 4.8, ZONE_FACTOR 1.8 and
 * LOCK_ENGAGE_FACTOR 1.3, so activeZone sets inside 8.64 units and the lock
 * engages inside 6.24. An offset of (5, 0, 5) is 7.07 units out — inside the
 * well, outside the lock, and outside the planet's own 4.8 surface. A measured
 * baseline run using (12, 0, 12) sat at 16.97 units and never entered the well
 * at all, so activeZone stayed null and the check silently proved nothing.
 */
async function approachPlanet(page) {
  return page.evaluate(() => {
    const b = window.__fitz.bodies;
    const name = Object.keys(b)[0];
    const p = b[name];
    window.__fitz.teleport(p.x + 5, p.y, p.z + 5);
    return name;
  });
}

export default async function run() {
  return withPage({ label: "transition" }, async (page, checks) => {
    await toDeepSpace(page);
    await settle(page, 1000);

    // ---- approach: activeZone flips, canvas must not re-render ----
    const beforeApproach = await canvasRenders(page);
    const planet = await approachPlanet(page);
    await settle(page, 1500);
    const afterApproach = await canvasRenders(page);
    const zone = await page.evaluate(() => window.__fitz.store.getState().activeZone);

    checks.check("approach actually entered a gravity well", zone !== null,
      `planet=${planet} activeZone=${zone}`);
    checks.check("zero canvas re-renders when activeZone flips",
      afterApproach - beforeApproach === 0, `delta=${afterApproach - beforeApproach}`);

    // ---- orbit lock: modal opens, canvas must not re-render ----
    const beforeLock = await canvasRenders(page);
    await page.evaluate(() => window.__fitz.store.getState().setOrbitLocked(true));
    await settle(page, 1200);
    const afterLock = await canvasRenders(page);

    checks.check("zero canvas re-renders when the dossier modal opens",
      afterLock - beforeLock === 0, `delta=${afterLock - beforeLock}`);

    await page.evaluate(() => window.__fitz.store.getState().breakOrbit());
    await settle(page, 800);

    // ---- warp: isWarping flips on every boost ----
    await toDeepSpace(page);
    const beforeWarp = await canvasRenders(page);
    await page.evaluate(() => window.__fitz.store.getState().setWarping(true));
    await settle(page, 800);
    await page.evaluate(() => window.__fitz.store.getState().setWarping(false));
    await settle(page, 800);
    const afterWarp = await canvasRenders(page);

    checks.check("zero canvas re-renders across a warp toggle",
      afterWarp - beforeWarp === 0, `delta=${afterWarp - beforeWarp}`);
  });
}
```

Register it in `tests/e2e/run.mjs` by adding `"transition"` to the `PROBES` array, after `"perf"`.

- [ ] **Step 4: Run the probe to verify it fails**

Run: `npm run test:e2e transition`
Expected: FAIL on all three delta checks with non-zero deltas.

**This is the gate.** If all three deltas are already zero, RC1 is wrong: stop, report the result, and skip to Task 4 — the remaining tasks stand on independently confirmed evidence. Record the outcome either way.

- [ ] **Step 5: Extract the postprocessing chain**

```tsx
// src/components/canvas/PostFX.tsx
import { EffectComposer, Bloom, Vignette, ChromaticAberration, GodRays } from "@react-three/postprocessing";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSpaceStore } from "../../store/spaceStore";

/**
 * Stable offset instance, mutated in place rather than replaced. Passing a
 * fresh array literal per render (as GlobalCanvas used to) changed the prop
 * identity every time anything re-rendered, and rebuilding the composer's
 * children means recompiling every pass -- a hitch mid-flight.
 */
const CA_OFFSET = new THREE.Vector2(0, 0);
const WARP_X = 0.0022;
const WARP_Y = 0.0014;

/**
 * Drives chromatic aberration from the store imperatively. This exists so
 * PostFX never has to subscribe to `isWarping`: a subscription there would
 * re-render the composer on every boost, which is precisely the hitch this
 * refactor removes.
 */
function WarpAberration() {
  useFrame(() => {
    const s = useSpaceStore.getState();
    const on = s.isWarping && !s.reducedMotion;
    CA_OFFSET.set(on ? WARP_X : 0, on ? WARP_Y : 0);
  });
  return null;
}

interface PostFXProps {
  sunMesh: THREE.Mesh | null;
}

/**
 * multisampling=0: the GodRays depth passes' buffer formats are incompatible
 * with the MSAA resolve blit (GL_INVALID_OPERATION every frame -> white
 * canvas). Bloom smooths edges anyway, so MSAA here bought nothing.
 */
export default function PostFX({ sunMesh }: PostFXProps) {
  return (
    <>
      <WarpAberration />
      <EffectComposer multisampling={0}>
        <Bloom intensity={1.2} luminanceThreshold={0.2} luminanceSmoothing={0.9} mipmapBlur={true} />
        <Vignette eskil={false} offset={0.28} darkness={0.72} />
        <ChromaticAberration offset={CA_OFFSET} />
        {/* Accumulator budget: HDR sun (emissive 3.2) x weight x decay-series(~10)
            x exposure must stay well under 1.0 or the clamp saturates to a white
            wash. 3.2 x 0.08 x 10 x 0.18 = 0.46 peak. */}
        {sunMesh ? (
          <GodRays sun={sunMesh} samples={60} density={0.8} decay={0.9}
            weight={0.08} exposure={0.18} clampMax={0.8} blur={true} />
        ) : <></>}
      </EffectComposer>
    </>
  );
}
```

- [ ] **Step 6: Rewire GlobalCanvas**

In `src/components/canvas/GlobalCanvas.tsx`:

1. Delete the `EffectComposer, Bloom, Vignette, ChromaticAberration, GodRays` import (line 11) and add `import PostFX from "./PostFX";`.
2. Delete the `isWarping` subscription (line 165).
3. Replace the whole `{!isLowPerf && (<SafeErrorBoundary>...</SafeErrorBoundary>)}` block (lines 279-304) with:

```tsx
        {!isLowPerf && (
          <SafeErrorBoundary>
            <PostFX sunMesh={sunMesh} />
          </SafeErrorBoundary>
        )}
```

4. Change the export. Replace `export default function GlobalCanvas() {` with `function GlobalCanvas() {` and add at the end of the file:

```tsx
/**
 * memo is load-bearing, not an optimisation. GlobalCanvas takes no props and
 * is rendered by App, which subscribes to ten store values (App.tsx:25-34).
 * Without memo, every activeZone / isOrbitLocked / isNearSpawn flip re-renders
 * the entire R3F tree mid-flight. The canvas reads what it needs from the
 * store directly, so it never needs props to arrive this way.
 *
 * Guarded by tests/e2e/transition.probe.mjs.
 */
export default memo(GlobalCanvas);
```

Add `memo` to the React import on line 3.

- [ ] **Step 7: Run the probe to verify it passes**

Run: `npm run test:e2e transition`
Expected: PASS, all four checks.

- [ ] **Step 8: Verify nothing regressed**

Run: `npm run lint && npm test && npm run test:e2e`
Expected: all probes pass. Pay attention to `perf` and `sky` — they assert on the effect chain's visual output indirectly.

- [ ] **Step 9: Measure the result**

Run: `npm run dev`, and compare the three p99 numbers you recorded in Task 2 Step 4. Record the deltas in the commit message.

- [ ] **Step 10: Commit**

```bash
git add src/debug/bridge.ts src/components/canvas/GlobalCanvas.tsx src/components/canvas/PostFX.tsx tests/e2e/transition.probe.mjs tests/e2e/run.mjs
git commit -m "perf: stop DOM state from re-rendering the canvas tree

App subscribes to ten store values and rendered GlobalCanvas as an unmemoized
child, so every activeZone or isOrbitLocked flip reconciled the whole R3F tree
and handed EffectComposer a fresh children array -- recompiling Bloom, Vignette,
ChromaticAberration and a 60-sample GodRays pass mid-flight.

isWarping was the same bug on a shorter fuse: it flips on every boost. Moved
the chromatic-aberration coupling to an in-place Vector2 mutation so the
composer never re-renders for it.

perf.probe.mjs only ever asserted on steady flight -- the one state that was
never slow. transition.probe.mjs covers the transitions."
```

---

### Task 4: Plasma anomalies as a preallocated pool

**Files:**
- Modify: `src/components/canvas/PlasmaAnomalies.tsx` (full rewrite of the render path), `src/constants.ts`, `tests/e2e/transition.probe.mjs`
- Test: extend `tests/e2e/transition.probe.mjs`

**Interfaces:**
- Consumes: `AnomaliesRef` (unchanged public shape: `{ spawn: (point: THREE.Vector3) => void }`), so `GlobalCanvas.tsx:272` needs no edit.
- Produces: `LIGHT_BUDGET` exported from `src/constants.ts`.

- [ ] **Step 1: Add the light budget constant**

Append to `src/constants.ts`:

```ts
/**
 * Hard ceiling on simultaneous lights in the scene.
 *
 * Three.js bakes the light count into every shader's program cache key, so
 * adding one light bumps lightsStateVersion and forces EVERY material in the
 * scene to recompile on the next frame -- a synchronous, scene-wide stall.
 * This is not a shading-cost budget, it is a "do not recompile during play"
 * budget, and it is why particles must never carry their own light.
 *
 * Current occupants, measured (not enumerated by hand — an earlier hand count
 * said 9 and missed the ambientLight): ambientLight + sun point
 * (GlobalCanvas.tsx:214,217), sun (Sun.tsx), ship x2 (Spaceship.tsx),
 * portal x2 (PortalRing.tsx), planets x3 (SpacePlanets.tsx).
 * Asserted by tests/e2e/transition.probe.mjs.
 */
export const LIGHT_BUDGET = 10;
```

- [ ] **Step 2: Write the failing probe checks**

Append inside the `withPage` callback in `tests/e2e/transition.probe.mjs`, before the closing brace:

```js
    // ---- plasma: spawning must not add lights or recompile shaders ----
    await toDeepSpace(page);
    await settle(page, 1000);

    const beforePlasma = await page.evaluate(() => {
      let lights = 0;
      window.__fitz.scene.traverse((o) => { if (o.isLight) lights++; });
      return { lights, programs: window.__fitz.gl.info.programs.length,
        renders: window.__fitz.canvasRenderCount };
    });

    // 10, measured — see LIGHT_BUDGET in src/constants.ts.
    checks.check("baseline light count is within LIGHT_BUDGET",
      beforePlasma.lights <= 10, `lights=${beforePlasma.lights}`);

    // Spawn 40 anomalies through the same ref path a click uses.
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const r = canvas.getBoundingClientRect();
      for (let i = 0; i < 40; i++) {
        const x = r.left + r.width * (0.3 + 0.4 * (i % 7) / 7);
        const y = r.top + r.height * (0.3 + 0.4 * (i % 5) / 5);
        canvas.dispatchEvent(new PointerEvent("pointerdown",
          { clientX: x, clientY: y, bubbles: true, pointerId: 1 }));
      }
    });
    await settle(page, 2000);

    const afterPlasma = await page.evaluate(() => {
      let lights = 0;
      window.__fitz.scene.traverse((o) => { if (o.isLight) lights++; });
      return { lights, programs: window.__fitz.gl.info.programs.length,
        renders: window.__fitz.canvasRenderCount };
    });

    checks.check("40 plasma spawns add zero lights",
      afterPlasma.lights === beforePlasma.lights,
      `${beforePlasma.lights} -> ${afterPlasma.lights}`);
    checks.check("40 plasma spawns compile zero new shader programs",
      afterPlasma.programs === beforePlasma.programs,
      `${beforePlasma.programs} -> ${afterPlasma.programs}`);
    checks.check("40 plasma spawns cause zero canvas re-renders",
      afterPlasma.renders === beforePlasma.renders,
      `delta=${afterPlasma.renders - beforePlasma.renders}`);
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test:e2e transition`
Expected: FAIL on the light count (9 → 49) and program count checks.

- [ ] **Step 4: Rewrite PlasmaAnomalies**

Replace the entire contents of `src/components/canvas/PlasmaAnomalies.tsx`:

```tsx
import { useRef, useImperativeHandle, forwardRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { flight } from "../../store/spaceStore";
import { assetUrl } from "../../utils/assetUrl";

/** Fixed pool size. Slots are preallocated at load and recycled forever. */
const ANOMALY_MAX = 40;

/** Roomy 3D box around the play space that anomalies bounce inside (spec §5). */
const ANOMALY_LIMIT = 60;

interface Anomaly {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Index into COLORS; written to the instance colour buffer on spawn. */
  colorIdx: number;
  active: boolean;
  /** Rotation phase, so a cluster of spawns does not tumble in lockstep. */
  phase: number;
}

const COLORS = ["#00f0ff", "#bd00ff", "#ec4899", "#00ff87"].map((c) => new THREE.Color(c));

/** Scratch objects, reused every frame so the loop allocates nothing. */
const shipPos = new THREE.Vector3();
const pullDir = new THREE.Vector3();
const dummy = new THREE.Object3D();
const ZERO_SCALE = new THREE.Vector3(0, 0, 0);

/**
 * Advances every active anomaly in place. Deactivates absorbed ones.
 *
 * Returns nothing and touches no React state: absorption used to trigger a
 * setState, which meant a canvas commit mid-flight. A slot going inactive is
 * now expressed purely as a zero-scale matrix.
 */
function stepAnomalies(pool: Anomaly[], ship: THREE.Vector3): void {
  for (const m of pool) {
    if (!m.active) continue;
    const dist = m.position.distanceTo(ship);

    if (dist < 0.4) {
      m.active = false;
      continue;
    }

    // Magnetic suction toward the ship, strengthening as it closes.
    if (dist < 4.5) {
      pullDir.subVectors(ship, m.position).normalize();
      m.velocity.addScaledVector(pullDir, (1.0 - dist / 4.5) * 0.003);
    }

    m.position.add(m.velocity);
    m.velocity.multiplyScalar(0.985); // drag

    // Boundary reflection.
    if (Math.abs(m.position.x) >= ANOMALY_LIMIT) {
      m.position.x = Math.sign(m.position.x) * ANOMALY_LIMIT;
      m.velocity.x = -m.velocity.x * 0.8;
    }
    if (Math.abs(m.position.y) >= ANOMALY_LIMIT) {
      m.position.y = Math.sign(m.position.y) * ANOMALY_LIMIT;
      m.velocity.y = -m.velocity.y * 0.8;
    }
    if (Math.abs(m.position.z) >= ANOMALY_LIMIT) {
      m.position.z = Math.sign(m.position.z) * ANOMALY_LIMIT;
      m.velocity.z = -m.velocity.z * 0.8;
    }
  }
}

export interface AnomaliesRef {
  spawn: (point: THREE.Vector3) => void;
}

/**
 * Click-spawned plasma anomalies, as a preallocated InstancedMesh pool --
 * the same shape FuelCrystals and DataShards use.
 *
 * The previous version mounted a <pointLight> per anomaly. Three.js bakes the
 * light count into every shader's program cache key, so each spawn forced a
 * synchronous scene-wide shader recompile: the visible click stall. It also
 * cloned the GLTF scene and its materials per anomaly, producing 40 unique
 * materials and 40+ draw calls with no batching.
 *
 * Now: one geometry, one shared emissive material, one draw call, per-instance
 * colour, and nothing whatsoever allocated at click time. The glow comes from
 * the Bloom pass, which runs at luminanceThreshold 0.2 and blooms these at
 * emissiveIntensity 3.6 exactly as the per-anomaly lights used to.
 */
export const PlasmaAnomalies = forwardRef<AnomaliesRef>((_props, ref) => {
  const { scene } = useGLTF(assetUrl("/models/space_crystal.glb"));
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const nextSlot = useRef(0);

  // Reuse the GLB's first mesh, baked to world scale -- same approach as
  // FuelCrystals takes with the identical model.
  const { geometry, material } = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((c) => { if (!src && c instanceof THREE.Mesh) src = c; });
    if (!src) throw new Error("space_crystal.glb contains no mesh");
    src.updateMatrix();
    const g = src.geometry.clone();
    g.applyMatrix4(src.matrix);
    const m = (src.material as THREE.MeshStandardMaterial).clone();
    m.emissive = new THREE.Color("#ffffff"); // tinted per-instance below
    m.emissiveIntensity = 3.6;
    // Per-instance colour multiplies into both base and emissive only if the
    // material is told to expect an instance colour attribute.
    m.vertexColors = false;
    return { geometry: g, material: m };
  }, [scene]);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  /** The pool. Allocated once, never resized. */
  const pool = useMemo<Anomaly[]>(() =>
    Array.from({ length: ANOMALY_MAX }, () => ({
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      colorIdx: 0,
      active: false,
      phase: 0,
    })), []);

  // Seed every instance colour once so setColorAt never runs during play.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < ANOMALY_MAX; i++) mesh.setColorAt(i, COLORS[i % COLORS.length]);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);

  useImperativeHandle(ref, () => ({
    spawn(point: THREE.Vector3) {
      // Round-robin over the fixed pool: the oldest slot is recycled once all
      // 40 are live, which is what the old `slice(-39)` cap did by rebuilding
      // the array. No allocation, no state, no render.
      const i = nextSlot.current;
      nextSlot.current = (nextSlot.current + 1) % ANOMALY_MAX;
      const m = pool[i];
      m.position.set(point.x, point.y + (Math.random() - 0.5) * 0.5, point.z);
      m.velocity.set(
        (Math.random() - 0.5) * 0.015,
        (Math.random() - 0.5) * 0.005,
        (Math.random() - 0.5) * 0.015,
      );
      m.phase = Math.random() * Math.PI * 2;
      m.active = true;
    },
  }));

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    shipPos.set(flight.x, flight.y, flight.z);
    stepAnomalies(pool, shipPos);

    // Rotation stays on the real clock rather than ambientTime: anomalies are
    // spawned by clicking, so they are user-initiated and the reduced-motion
    // spec deliberately exempts them.
    const t = state.clock.getElapsedTime();
    for (let i = 0; i < ANOMALY_MAX; i++) {
      const m = pool[i];
      if (!m.active) {
        dummy.position.set(0, 0, 0);
        dummy.scale.copy(ZERO_SCALE);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      dummy.position.copy(m.position);
      dummy.rotation.set(
        0.15 + Math.sin(t * 0.7 + m.phase) * 0.25,
        t * 1.4 + m.phase,
        Math.cos(t * 0.5 + m.phase * 1.7) * 0.2,
      );
      dummy.scale.setScalar(0.55);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh name="PlasmaAnomalies" ref={meshRef}
      args={[geometry, material, ANOMALY_MAX]} frustumCulled={false} />
  );
});

PlasmaAnomalies.displayName = "PlasmaAnomalies";
```

- [ ] **Step 5: Run the probe to verify it passes**

Run: `npm run test:e2e transition`
Expected: PASS on all seven checks. Light count stays at 9, programs unchanged, zero canvas renders.

- [ ] **Step 6: Verify the glow visually**

Run: `npm run dev`. Click to spawn anomalies. Confirm: they appear tinted in the four palette colours, they bloom, they tumble out of sync with each other, they get sucked toward the ship inside 4.5 units, and they vanish on contact. Confirm the click stall is gone in the overlay's p99.

If the tint does not show, the instance colour is not reaching the emissive term — set `material.emissive` to black and rely on `toneMapped={false}` with instance colour driving base colour instead. Record which path was needed.

- [ ] **Step 7: Full verification**

Run: `npm run lint && npm test && npm run test:e2e`
Expected: all pass. `gameplay` and `perf` probes both touch the canvas scene graph — check them specifically.

- [ ] **Step 8: Commit**

```bash
git add src/components/canvas/PlasmaAnomalies.tsx src/constants.ts tests/e2e/transition.probe.mjs
git commit -m "perf: pool plasma anomalies instead of building them on click

Each anomaly mounted its own pointLight. Three.js bakes light count into the
shader program cache key, so every spawn forced a synchronous scene-wide
recompile -- the click stall. Forty spawns also meant forty cloned GLTF scenes
and forty unique materials.

Now one InstancedMesh of 40 preallocated slots, one shared material, one draw
call, per-instance colour seeded at mount. Clicking writes a transform and
nothing else. Glow comes from the Bloom pass that was already running.

LIGHT_BUDGET documents why the next pointLight is a mistake."
```

---

### Task 5: Remove compositor blur over the canvas

**Files:**
- Modify: `src/index.css:33-53`, `src/App.tsx:62`
- Create: `tests/noBackdropFilter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Pure removal plus a static guardrail.

- [ ] **Step 1: Write the failing guardrail test**

```ts
// tests/noBackdropFilter.test.ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * backdrop-filter over a live WebGL canvas forces the compositor to
 * re-snapshot and re-blur the canvas region every single frame. The dossier
 * modal did this while animating its own scale and while scrolling, which is
 * what made every modal open lag.
 *
 * It is also invisible here: every overlay that used .glass-card also sets an
 * opaque bg-black/8x, so the blur had nothing to show through it.
 *
 * If a future design genuinely needs a blur, add the file to ALLOWLIST with a
 * comment explaining why the canvas is not behind it.
 */
const ALLOWLIST: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("no backdrop-filter over the live canvas", () => {
  it("finds no backdrop-filter or backdrop-blur outside the allowlist", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (!/\.(css|tsx?|jsx?)$/.test(file)) continue;
      if (ALLOWLIST.includes(file)) continue;
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (/backdrop-filter|backdrop-blur/.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/noBackdropFilter.test.ts`
Expected: FAIL, listing five offenders — `src/index.css:35`, `:36`, `:42`, `:43`, and `src/App.tsx:62`.

- [ ] **Step 3: Remove the blur from index.css**

Replace lines 32-53 of `src/index.css`:

```css
/* Glassmorphism custom classes.
   No backdrop-filter: these panels sit over the live WebGL canvas, and a
   backdrop blur forces the compositor to re-blur the canvas every frame.
   Nothing meaningful sits behind them anyway -- the overlay variants all set
   an opaque bg-black/8x, and in classic-CV mode the canvas is unmounted
   entirely. Alpha raised to compensate for the lost frosting.
   Guarded by tests/noBackdropFilter.test.ts. */
.glass-panel {
  background: rgba(13, 11, 28, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.glass-card {
  background: rgba(15, 12, 34, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.2);
  transition: border-color 0.3s cubic-bezier(0.25, 0.8, 0.25, 1),
              box-shadow 0.3s cubic-bezier(0.25, 0.8, 0.25, 1),
              transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.glass-card:hover {
  border-color: rgba(0, 255, 135, 0.25);
  box-shadow: 0 10px 40px 0 rgba(0, 255, 135, 0.1);
  transform: translateY(-4px);
}
```

Note the `:hover` rule now sets `border-color` rather than re-declaring the full `border` shorthand — the shorthand forced a style recalculation of width and style that never changed.

- [ ] **Step 4: Remove the blur from the teleport flash**

In `src/App.tsx:62`, delete `backdrop-blur-[3px]` from the className, leaving:

```tsx
            className="pointer-events-none fixed inset-0 z-50 bg-[#00f0ff]/15 border-[12px] border-[#00f0ff]/30"
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/noBackdropFilter.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify appearance**

Run: `npm run dev`. Check all six places `.glass-card` and `.glass-panel` render: the spawn banner, the dossier modal, the contact-portal modal, the classic-CV Navbar, Experience cards, and Skills cards. Confirm each still reads as a panel rather than a flat block, and that text contrast is unchanged or better.

Open a modal and watch p99 in the overlay. This is the fix for symptom 3 — record the before/after.

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/App.tsx tests/noBackdropFilter.test.ts
git commit -m "perf: drop backdrop-filter from panels over the live canvas

backdrop-filter makes the compositor re-snapshot and re-blur the canvas region
every frame. The dossier modal did it while animating its own scale and again
on every scroll tick, which is what made opening any modal lag.

The blur was invisible anyway -- every overlay using .glass-card also sets an
opaque bg-black/8x over it. Raised the panel alpha to compensate and narrowed
transition: all to the three properties that actually animate."
```

---

### Task 6: Freeze the scene while a modal is open

**Files:**
- Modify: `src/store/spaceStore.ts`, `src/components/canvas/GlobalCanvas.tsx`
- Test: `tests/spaceStore.test.ts` (extend)

**Interfaces:**
- Consumes: `useSpaceStore`.
- Produces: `selectSceneFrozen(s: SpaceState): boolean` exported from `src/store/spaceStore.ts`.

- [ ] **Step 1: Write the failing unit test**

Append to `tests/spaceStore.test.ts`:

```ts
describe("selectSceneFrozen", () => {
  const base = {
    isOrbitLocked: false, activeZone: null, photoMode: false, showClassicCV: false,
  } as Parameters<typeof selectSceneFrozen>[0];

  it("is false during ordinary flight", () => {
    expect(selectSceneFrozen(base)).toBe(false);
  });

  it("is true while the dossier modal is open", () => {
    expect(selectSceneFrozen({ ...base, isOrbitLocked: true, activeZone: "contact" })).toBe(true);
  });

  it("is false in photo mode, which needs live frames for OrbitControls", () => {
    expect(selectSceneFrozen({ ...base, photoMode: true })).toBe(false);
  });

  it("is false when merely near a planet but not locked", () => {
    expect(selectSceneFrozen({ ...base, activeZone: "saas" })).toBe(false);
  });
});
```

Add `selectSceneFrozen` to the existing import from `../src/store/spaceStore`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/spaceStore.test.ts`
Expected: FAIL — `selectSceneFrozen is not a function`.

- [ ] **Step 3: Implement the selector**

Append to `src/store/spaceStore.ts`:

```ts
/**
 * True when an opaque modal covers the scene and rendering it is wasted work.
 *
 * Photo mode is deliberately excluded: OrbitControls needs continuous frames
 * to damp a drag, and photo mode has no modal over the canvas anyway.
 * Proximity alone is excluded too -- the tooltip is a small strip, and the
 * visitor is still flying.
 */
export function selectSceneFrozen(
  s: Pick<SpaceState, "isOrbitLocked" | "photoMode">,
): boolean {
  return s.isOrbitLocked && !s.photoMode;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/spaceStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the Canvas**

In `src/components/canvas/GlobalCanvas.tsx`, add the subscription beside the existing ones (around line 164):

```tsx
  const sceneFrozen = useSpaceStore(selectSceneFrozen);
```

Add `selectSceneFrozen` to the existing `spaceStore` import, and add the prop to `<Canvas>`:

```tsx
        frameloop={sceneFrozen ? "never" : "always"}
```

Add an unfreeze nudge so the first post-modal frame renders. Inside `GlobalCanvas`, after the subscription:

```tsx
  // frameloop="never" means R3F stops driving rAF entirely; the first frame
  // after unfreezing has to be requested explicitly or the canvas holds the
  // stale frame until something else invalidates it.
  const wasFrozen = useRef(false);
  useEffect(() => {
    if (wasFrozen.current && !sceneFrozen) invalidate();
    wasFrozen.current = sceneFrozen;
  }, [sceneFrozen]);
```

Import `invalidate` from `@react-three/fiber` and `useEffect` from React.

- [ ] **Step 6: Verify the tradeoff visually**

Run: `npm run dev`. Fly into a planet until the dossier opens.

**This is the judgement call flagged in the spec.** The ship is circling when the modal opens, and freezing stops that motion visibly around the panel edges. Decide: does it read as "docked", matching the `ORBIT_LOCKED` framing, or as crashed?

If it reads as crashed, revert this task's Canvas change and instead render `<PostFX>` conditionally on `!sceneFrozen`, which recovers most of the cost while keeping the orbit alive. Record which path was taken and why.

- [ ] **Step 7: Verify nothing regressed**

Run: `npm run lint && npm test && npm run test:e2e`

**Watch for probe breakage specifically here.** `settle()` pumps frames, and any probe that opens a modal and then expects the scene to advance will now stall. `gameplay` and `contact` are the likely candidates. If one breaks, that is a real finding about the freeze, not a test to paper over — fix by having the probe unfreeze first.

- [ ] **Step 8: Commit**

```bash
git add src/store/spaceStore.ts src/components/canvas/GlobalCanvas.tsx tests/spaceStore.test.ts
git commit -m "perf: stop rendering the scene behind an open dossier

An opaque modal covers the scene, so the frames behind it are wasted GPU work
at exactly the moment the DOM needs the budget for a scale animation and a
scrollable panel.

Photo mode is excluded: OrbitControls needs live frames to damp a drag."
```

---

### Task 7: Fix Preload placement and warm the low-perf permutations

**Files:**
- Modify: `src/components/canvas/GlobalCanvas.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

- [ ] **Step 1: Confirm the Preload problem**

Run `npm run dev` with the overlay visible. Note the `programs` count at first paint, then again after five seconds of flight. If it climbs after the scene settles, `<Preload all />` at line 306 ran before the suspended GLTF subtree resolved and is warming a near-empty scene.

Record the two numbers. If `programs` is already stable at first paint, skip to Step 3 — the placement is harmless and only the low-perf warm-up is needed.

- [ ] **Step 2: Move Preload inside the Suspense boundary**

In `src/components/canvas/GlobalCanvas.tsx`, delete `<Preload all />` from line 306 and re-add it as the last child inside `<Suspense>`, immediately after the `{!photoMode && <FollowingClickPlane .../>}` line:

```tsx
          {/* Inside Suspense deliberately: Preload compiles the scene as it
              exists when it mounts, so as a sibling of the boundary it ran
              before any GLTF-dependent component had resolved and warmed a
              near-empty scene. */}
          <Preload all />
```

- [ ] **Step 3: Measure whether a warm-up is needed at all**

The spec assumed low-perf transitions need warming. Verify before building it, because the reasoning cuts the other way on inspection: the app *starts* at full detail, so the corona, halo, warp tunnel and shooting stars all mount and compile during load already. Toggling low-perf *removes* objects rather than adding new ones, and three.js keys its program cache by shader source and defines — so a remounted identical material should hit the cache rather than recompile.

Run `npm run dev` and watch `programs` in the overlay while:

1. Toggling low-perf from the HUD, on and back off
2. Boosting into a warp and releasing

**If `programs` does not climb in either case, skip to Step 4 and add nothing.** A speculative warm-up here would toggle `isLowPerf` at startup, causing a visible one-frame flash of the scene losing and regaining its corona, in exchange for nothing.

**If `programs` does climb**, add the warm-up below and record which action caused the climb:

```tsx
  // Walk the low-perf state once at startup so the affected materials compile
  // during load rather than on the frame the visitor first changes quality.
  // Only added because `programs` was measured climbing on that transition --
  // see docs/PERF-BUDGETS.md for the numbers.
  const warmed = useRef(false);
  useEffect(() => {
    if (warmed.current) return;
    warmed.current = true;
    const original = useSpaceStore.getState().isLowPerf;
    useSpaceStore.getState().setLowPerf(!original);
    const id = setTimeout(() => useSpaceStore.getState().setLowPerf(original), 0);
    return () => clearTimeout(id);
  }, []);
```

Note that `setLowPerf(v, manual = false)` ORs `lowPerfManual` rather than setting it, so these two calls cannot clear a manual flag a probe has set.

- [ ] **Step 4: Verify**

Run: `npm run dev`. Confirm `programs` is stable within the first second and does not climb when toggling low-perf from the HUD or when boosting into a warp.

Run: `npm run lint && npm test && npm run test:e2e`

**Expect probe attention here.** `withPage` sets `lowPerfManual = true`, and `setLowPerf(v, manual)` ORs `lowPerfManual` — so the warm-up's two calls pass `manual = false` and will not clear the flag. Confirm `perf.probe.mjs`'s full-detail baselines still pass; if the warm-up races the probe's first assertions, gate it behind `!import.meta.env.DEV` being false is wrong — instead have the probe `settle()` before its first scene query.

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/GlobalCanvas.tsx
git commit -m "perf: warm shaders at load instead of mid-flight

Preload sat outside the Suspense boundary it was meant to warm, so it compiled
whatever existed before the GLTF subtree resolved -- a near-empty scene.

Toggling low-perf mounts the corona, halo, warp tunnel and shooting stars, each
compiling on the frame it appears. Walk that state once during load so no
permutation is new while the visitor is flying."
```

---

### Task 8: Progress-gated load screen

**Files:**
- Modify: `src/components/canvas/GlobalCanvas.tsx:198-202`

**Interfaces:**
- Consumes: drei's `useProgress`.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Replace the indefinite fallback**

The current fallback is a pulsing "Initializing Star System..." with no progress signal. Total payload is 3.6MB across eleven GLBs and three textures, so the wait is real and worth reporting honestly.

In `src/components/canvas/GlobalCanvas.tsx`, add `useProgress` to the drei import (line 2) and replace the `<Suspense fallback={...}>` prop:

```tsx
function LoadProgress() {
  const { progress, item } = useProgress();
  return (
    <Html center className="select-none pointer-events-none whitespace-nowrap text-center">
      <div className="font-mono text-xs tracking-widest uppercase text-primary mb-2">
        Initializing Star System
      </div>
      <div className="w-48 h-[2px] bg-primary/20 mx-auto overflow-hidden rounded-full">
        <div className="h-full bg-primary transition-[width] duration-200"
          style={{ width: `${progress.toFixed(0)}%` }} />
      </div>
      <div className="font-mono text-[9px] text-primary/50 mt-2">
        {progress.toFixed(0)}% {item ? `— ${item.split("/").pop()}` : ""}
      </div>
    </Html>
  );
}
```

Then use it: `<Suspense fallback={<LoadProgress />}>`.

- [ ] **Step 2: Verify**

Run: `npm run dev` with the browser devtools network throttle set to "Fast 3G" so the loader is visible for long enough to judge. Confirm the bar advances monotonically and reaches 100% before the scene appears.

- [ ] **Step 3: Verify probes still pass**

Run: `npm run test:e2e`

`harness.mjs` waits for the canvas and first frame; confirm that wait still resolves. The `smoke` and `assets` probes are the ones to watch.

- [ ] **Step 4: Commit**

```bash
git add src/components/canvas/GlobalCanvas.tsx
git commit -m "feat: report real load progress instead of an indefinite pulse

3.6MB across eleven GLBs and three textures is a real wait on a slow
connection, and an indefinite pulsing label gives a visitor no way to tell
loading from hung."
```

---

### Task 9: Lock in the budgets and clean up

**Files:**
- Modify: `src/components/canvas/Sun.tsx:172`, `src/components/canvas/SpacePlanets.tsx:393,425,451`, `tests/e2e/transition.probe.mjs`
- Create: `docs/PERF-BUDGETS.md`

**Interfaces:**
- Consumes: `LIGHT_BUDGET` from Task 4.
- Produces: the recorded baselines in `docs/PERF-BUDGETS.md`.

- [ ] **Step 1: Delete the inert castShadow flags**

`<Canvas>` has no `shadows` prop (`GlobalCanvas.tsx:179`), so `gl.shadowMap.enabled` is false and every `castShadow` in the scene is dead configuration that reads as if shadows were on.

Remove `castShadow={true}` from `src/components/canvas/Sun.tsx:172` and from the three planet meshes at `src/components/canvas/SpacePlanets.tsx:393,425,451`.

**Measurement caveat discovered during the pre-fix baseline run.** Sampling `gl.info.render.calls` and `.triangles` from `page.evaluate` returned `1` and `1` in every state — implausible for this scene. `EffectComposer` resets `gl.info` during its own passes, so a sample taken between frames reads the composer's last internal pass rather than the scene render.

**Resolved — do NOT use `gl.info.autoReset = false`.** A later measurement found the values are already sampled correctly: the DEV overlay read `calls 70`, `tris 876368` in the same session where external sampling read `1` and `1`. The difference is *when* the read happens. `PerfSampler` (`src/debug/PerfSampler.tsx`) reads `gl.info.render.*` from inside `useFrame`, before `EffectComposer` resets it; a `page.evaluate` between frames reads the composer's last internal pass.

So the probe must read **`perfStats.calls` and `perfStats.triangles`** — the values `PerfSampler` already captured in-frame — not `gl.info.render.*`. Expose `perfStats` on the debug bridge for this. No renderer state gets mutated and the infrastructure already exists.

Two constraints on the same principle:

- **`perfStats.lights` is NOT usable in e2e.** The light count is throttled to one traversal every 30 frames. Headless SwiftShader runs at roughly 1fps, so that is ~30 seconds of lag. Count lights with `scene.traverse` inside `page.evaluate` instead, exactly as the existing `transition.probe.mjs` checks already do — that read is instantaneous and frame-independent.
- **`programs` stays read from `gl.info.programs.length`.** It is a cumulative array length, not a per-frame counter, so it is not affected by the reset and was verified reliable in the pre-fix baseline.

A budget asserting `calls <= 10` against a broken `calls === 1` reading is worse than no budget: it passes forever and reads like coverage.

- [ ] **Step 2: Capture the baselines**

Run: `npm run dev` and record `calls`, `triangles`, `programs` and `lights` from the overlay in each of four states:

1. Deep space, no planet nearby
2. Close approach to a planet
3. Dossier modal open
4. 40 anomalies spawned

- [ ] **Step 3: Write the budgets document**

```markdown
# Performance Budgets

Captured 2026-08-02 on <machine/GPU>, after the transition-hitch uplift
(`docs/superpowers/specs/2026-08-02-performance-uplift-design.md`).

Asserted by `tests/e2e/transition.probe.mjs`. Frame times are NOT asserted in
CI — headless SwiftShader makes them noise. They live in the DEV overlay
(`src/debug/PerfOverlay.tsx`), which is where the numbers mean something.

## Derivation rule

- Draw calls and triangles: baseline + 15%, rounded up to the nearest ten.
- Programs and lights: baseline + 1. These must not grow during play at all;
  the +1 is slack for a driver-dependent variant, not for a new material.

## Baselines

| State | calls | triangles | programs | lights |
|---|---|---|---|---|
| Deep space | | | | |
| Close approach | | | | |
| Modal open | | | | |
| 40 anomalies | | | | |

## Changing these

A number going up is not automatically a regression — adding scenery
legitimately costs draw calls. Re-baseline deliberately: capture the new
numbers, update the table AND the capture date, and say in the commit message
what was added. A ceiling raised without a matching scene change is the
signal this file exists to catch.
```

Fill the table from Step 2 before committing. An empty table is a plan failure, not a placeholder to leave behind.

- [ ] **Step 4: Add the budget assertions**

Append to `tests/e2e/transition.probe.mjs`, using the ceilings derived in Step 3:

```js
    // ---- renderer counter budgets (docs/PERF-BUDGETS.md) ----
    await toDeepSpace(page);
    await settle(page, 1500);
    const deep = await page.evaluate(() => {
      let lights = 0;
      window.__fitz.scene.traverse((o) => { if (o.isLight) lights++; });
      return { calls: window.__fitz.gl.info.render.calls,
        triangles: window.__fitz.gl.info.render.triangles,
        programs: window.__fitz.gl.info.programs.length, lights };
    });

    // Replace each ceiling with the derived value from docs/PERF-BUDGETS.md.
    checks.check("deep-space draw calls within budget", deep.calls <= DEEP_CALLS_CEILING,
      `calls=${deep.calls} ceiling=${DEEP_CALLS_CEILING}`);
    checks.check("deep-space triangles within budget", deep.triangles <= DEEP_TRIS_CEILING,
      `tris=${deep.triangles} ceiling=${DEEP_TRIS_CEILING}`);
    checks.check("light count within LIGHT_BUDGET", deep.lights <= 9,
      `lights=${deep.lights}`);
```

Define the ceilings as named constants at the top of the probe file with a comment pointing at `docs/PERF-BUDGETS.md`.

- [ ] **Step 5: Full verification**

Run: `npm run lint && npm test && npm run test:e2e`
Expected: everything passes, including the new budget assertions.

- [ ] **Step 6: Confirm the original symptoms are gone**

Run: `npm run dev` and compare against the three p99 numbers recorded in Task 2 Step 4:

1. Approach a planet — p99 should no longer spike
2. Click to spawn plasma — no stall, light count stays at 9
3. Fly into a planet until the dossier opens — no lag

Report all three before/after pairs. If any symptom survives, that is the finding — do not close the work out as done.

- [ ] **Step 7: Commit**

```bash
git add docs/PERF-BUDGETS.md tests/e2e/transition.probe.mjs src/components/canvas/Sun.tsx src/components/canvas/SpacePlanets.tsx
git commit -m "test: assert renderer-counter budgets and record the baselines

Counters rather than frame times: headless SwiftShader makes frame times noise,
but draw calls, triangles, programs and light count are deterministic and are
exactly the numbers that moved in all three bugs.

Also drops four castShadow flags that have never done anything -- Canvas has no
shadows prop, so shadowMap is disabled and they only ever misled the reader."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Change A — canvas isolation | Task 3 |
| Change B — plasma pool | Task 4 |
| Change C — modal cost | Tasks 5, 6 |
| Change D — preload and warm-up | Tasks 7, 8 |
| Change E — castShadow cleanup | Task 9 Step 1 |
| G1 — transition commit assertions | Task 3 Step 3, extended in Task 4 |
| G2 — renderer counter budgets | Task 9 Step 4 |
| G3 — light budget constant | Task 4 Step 1 |
| G4 — CSS static check | Task 5 Step 1 |
| G5 — DEV perf overlay | Tasks 1, 2 |
| Task 1 verification gate | Task 3 Step 4, with both branches stated |
| Budget derivation procedure | Task 9 Steps 2-3 |
| Risk: orbit freeze reads as crashed | Task 6 Step 6, with the fallback |
| Risk: memo masking future state | Task 3 Step 6 comment + G1 |
| Risk: frameloop needs invalidation | Task 6 Step 5 |

No spec requirement is unassigned.

**Ordering note:** G5 is built first (Tasks 1-2) because it is the instrument every later measurement depends on. The spec calls this out explicitly.

**Known deviation from the spec:** the spec describes per-instance colour on the anomalies as settled. Task 4 Step 6 carries a contingency because `setColorAt` interacting with an emissive `MeshStandardMaterial` is version-dependent in three 0.185, and the fallback path is stated rather than left to the implementer.
