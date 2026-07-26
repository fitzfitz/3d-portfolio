# Portfolio Content & Verification Closure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every placeholder in the shipped portfolio with real content (working contact form, real links, real SEO identity), and convert ~32 never-verified acceptance checks from "Pending human" paragraphs into a committed e2e suite plus a short human checklist.

**Architecture:** A dev-only debug bridge publishes the zustand store, the mutable `flight`/`bodies` telemetry, the three.js scene, and a React commit counter on `window.__fitz`, which is what makes the objective checks assertable at all. A self-contained harness spawns its own Vite server, drives Chrome via `puppeteer-core`, and aggregates structured pass/fail from seven probe files. Part A then reuses that harness to generate the OG share image, and moves all identity strings into one module so the placeholder class cannot silently return.

**Tech Stack:** Vite 8 + React 19 + TypeScript 6, three.js 0.185 / @react-three/fiber, zustand 5, vitest 4, puppeteer-core 25 (already a devDependency), sharp 0.35, @gltf-transform/core 4 + meshoptimizer (already devDependencies), Web3Forms as the form relay.

**Spec:** `docs/superpowers/specs/2026-07-25-portfolio-content-and-verification-design.md`

## Global Constraints

- **Never regress the perf wins.** No per-frame React `setState`; instancing for anything repeated; all heavy visuals disabled in low-perf mode; delta-time for all motion.
- **Asset budget:** `public/models/` stays under ~6MB total (currently 3.6MB). New textures WebP. New models through `npm run assets:optimize`.
- **Everything must work with keyboard AND touch.**
- **Existing gates must stay green:** `npm run build`, `npm run lint`, `npm test` (85 tests passing at plan time).
- **Debug code is dev-only.** Nothing added for testability may put `__fitz` into a production bundle.
- **Truth in copy.** No UI string may claim something the code does not do (this is the entire point of Part A).
- **Probe screenshots go to the scratchpad**, never into the repo: `/private/tmp/claude-502/-Users-fitzgeral-Kerja-proj-fitz/<session>/scratchpad`. The only committed generated image is `public/og.webp` (Task 16).
- **Commit after every task.** Conventional-commit prefixes, matching existing history (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

## Revisions to the spec discovered while planning

Recorded here rather than silently diverging:

1. **God-ray occlusion is downgraded** from a machine assertion to capture-plus-checklist (Task 5, Step 4). Asserting "the sun dims when a planet passes in front of it" needs a contrived pose and mean-luminance thresholds that would be flaky. The probe asserts the `GodRays` pass exists and targets the sun mesh, captures the two poses, and the visual judgement moves to the human checklist. **Spec §B3's split becomes 23 machine-assertable / 9 human**, not 24 / 8.
2. **The harness spawns its own Vite server** on port 5199 (`--strictPort`) rather than discovering an already-running one. Self-contained `npm run test:e2e` beats "remember to start the dev server", and it removes the 5173-vs-5174 ambiguity the old probes suffered from.
3. **Scene objects need names before they can be queried.** Most meshes are anonymous, so Task 1 adds `name=` props to exactly the seven objects the probes assert on. This is inert at runtime and is the enabling step for Tasks 4–7.

## File Structure

**Created:**
- `src/debug/bridge.ts` — the dev-only debug surface: a plain mutable object plus its `window` handle. One responsibility: expose internals to probes.
- `src/debug/DebugBridge.tsx` — three-line R3F component that publishes `scene`/`gl` into the bridge. Separate from `bridge.ts` because it must live inside `<Canvas>`.
- `src/data/identity.ts` — single source of truth for name, email, and social URLs.
- `src/utils/contactForm.ts` — pure payload/mailto/classify functions, no DOM, no network.
- `tests/e2e/harness.mjs` — server spawn, browser launch, error capture, flight helpers, assertion collection.
- `tests/e2e/run.mjs` — runner: imports probes, aggregates, sets exit code.
- `tests/e2e/audio.probe.mjs`, `perf.probe.mjs`, `sky.probe.mjs`, `flight.probe.mjs`, `gameplay.probe.mjs`, `touch.probe.mjs`, `assets.probe.mjs` — one concern each.
- `tests/e2e/ogimage.mjs` — OG image generator (not part of the suite; run on demand).
- `tests/contactForm.test.ts`, `tests/identity.test.ts` — vitest unit tests.
- `docs/QA-CHECKLIST.md` — the 9 human checks.
- `assets-src/MANIFEST.md` — provenance for assets that have no generator.
- `.env.example` — committed template.

**Modified:**
- `src/main.tsx` — dev-only `Profiler` wrapper + bridge import.
- `src/components/canvas/GlobalCanvas.tsx:189` — mount `<DebugBridge/>` under a DEV guard.
- `src/components/canvas/Sun.tsx:59`, `WarpTunnel.tsx:73`, `AsteroidBelt.tsx:34,71`, `DataShards.tsx:83`, `CloudLayer.tsx:51`, `CargoTraffic.tsx:41-64`, `SpacePlanets.tsx:130` — add `name=` for scene queries.
- `src/components/layout/TouchControls.tsx` — add `data-testid` to the five touch targets.
- `src/components/sections/Contact.tsx` — real submission, honest logs, mailto fallback.
- `src/components/layout/Footer.tsx:24,39,54`, `src/components/sections/Experience.tsx:155`, `src/App.tsx:209`, `src/constants.ts` — consume `identity`.
- `index.html` — SEO identity + OG image tags.
- `scripts/blender/generate.sh` — wire in the two unwired generators.
- `.gitignore` — add `.env`.
- `package.json` — `test:e2e` script.
- The six plan files in `docs/superpowers/plans/` — replace stale "Pending human" paragraphs.

---

# Part B — Verification closure

## Task 1: Debug bridge and scene names

**Files:**
- Create: `src/debug/bridge.ts`, `src/debug/DebugBridge.tsx`
- Modify: `src/main.tsx`, `src/components/canvas/GlobalCanvas.tsx:189`, `src/components/canvas/Sun.tsx:59`, `src/components/canvas/WarpTunnel.tsx:73`, `src/components/canvas/AsteroidBelt.tsx:34,71,101-108`, `src/components/canvas/DataShards.tsx:83`, `src/components/canvas/CloudLayer.tsx:51`, `src/components/canvas/CargoTraffic.tsx:41-64`, `src/components/canvas/SpacePlanets.tsx:130`
- Test: `tests/debugBridge.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `window.__fitz` with shape `{ store, flight, bodies, sound, scene, gl, renderCount }`, and the scene object names `SunCorona`, `WarpTunnel`, `BeltMain`, `BeltHalo`, `DataShards`, `CloudLayer`, `CargoShip0..4`, `NebulaCluster`. Every probe in Tasks 3–8 depends on both.

- [ ] **Step 1: Write the failing test**

`tests/debugBridge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fitzDebug } from "../src/debug/bridge";
import { useSpaceStore, flight, bodies } from "../src/store/spaceStore";

describe("debug bridge", () => {
  it("exposes the live store and telemetry objects by reference, not copies", () => {
    expect(fitzDebug.store).toBe(useSpaceStore);
    expect(fitzDebug.flight).toBe(flight);
    expect(fitzDebug.bodies).toBe(bodies);
  });

  it("starts with no scene and a zero commit count", () => {
    expect(fitzDebug.scene).toBe(null);
    expect(fitzDebug.renderCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/debugBridge.test.ts`
Expected: FAIL — `Failed to resolve import "../src/debug/bridge"`.

- [ ] **Step 3: Create the bridge**

`src/debug/bridge.ts`:

```ts
import type * as THREE from "three";
import { useSpaceStore, flight, bodies } from "../store/spaceStore";
import { soundManager } from "../audio/soundManager";

/**
 * Dev-only surface for e2e probes. Holds live references (never copies) so a
 * probe reading `__fitz.flight.x` sees the same object the frame loop mutates.
 * The window handle is assigned in main.tsx under an import.meta.env.DEV guard
 * so the string `__fitz` is dead-code-eliminated from production builds.
 */
export interface FitzDebug {
  store: typeof useSpaceStore;
  flight: typeof flight;
  bodies: typeof bodies;
  sound: typeof soundManager;
  scene: THREE.Scene | null;
  gl: THREE.WebGLRenderer | null;
  /** React commits, incremented by the dev-only Profiler in main.tsx. */
  renderCount: number;
}

export const fitzDebug: FitzDebug = {
  store: useSpaceStore,
  flight,
  bodies,
  sound: soundManager,
  scene: null,
  gl: null,
  renderCount: 0,
};
```

`src/debug/DebugBridge.tsx`:

```tsx
import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { fitzDebug } from "./bridge";

/** Publishes the R3F scene/renderer into the debug bridge. Renders nothing. */
export default function DebugBridge() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    fitzDebug.scene = scene;
    fitzDebug.gl = gl;
  }, [scene, gl]);
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/debugBridge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the window handle and commit counter**

Replace the body of `src/main.tsx`:

```tsx
import { StrictMode, Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { fitzDebug } from './debug/bridge'

if (import.meta.env.DEV) {
  (window as unknown as { __fitz: typeof fitzDebug }).__fitz = fitzDebug
}

// Profiler counts React commits, which is exactly the quantity the
// "zero React renders during flight" claim is about. Dev-only: in production
// the ternary folds to <App /> and the Profiler import is dropped.
const tree = import.meta.env.DEV ? (
  <Profiler id="app" onRender={() => { fitzDebug.renderCount++ }}>
    <App />
  </Profiler>
) : (
  <App />
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>{tree}</StrictMode>,
)
```

- [ ] **Step 6: Mount DebugBridge inside the Canvas**

In `src/components/canvas/GlobalCanvas.tsx`, add the import beside the other canvas imports:

```tsx
import DebugBridge from "../../debug/DebugBridge";
```

and as the first child inside `<Suspense>` (immediately after the opening tag at line 189-193, before `<Environment>`):

```tsx
{import.meta.env.DEV && <DebugBridge />}
```

- [ ] **Step 7: Add the seven scene names**

`src/components/canvas/Sun.tsx` line 59 — corona shell:

```tsx
          <mesh name="SunCorona" material={coronaMaterial}>
```

`src/components/canvas/WarpTunnel.tsx` line 73:

```tsx
    <mesh name="WarpTunnel" ref={meshRef} material={material} visible={false}>
```

`src/components/canvas/DataShards.tsx` line 83:

```tsx
    <instancedMesh name="DataShards" ref={meshRef} args={[geometry, material, SHARDS.length]} frustumCulled={false} />
```

`src/components/canvas/CloudLayer.tsx` line 51:

```tsx
    <mesh name="CloudLayer" ref={ref}>
```

`src/components/canvas/SpacePlanets.tsx` line 130 — the `NebulaCluster` component's root (all five instances share the name; probes traverse rather than using `getObjectByName`):

```tsx
    <points name="NebulaCluster" position={position} ref={pointsRef}>
```

`src/components/canvas/AsteroidBelt.tsx` — add `name` to `BeltRingProps` (after `tilt: number;` at line 31), thread it through, and apply it:

```tsx
interface BeltRingProps {
  geometry: THREE.BufferGeometry; material: THREE.Material;
  count: number; total: number; seed: number;
  rMin: number; rMax: number; yJitter: number;
  /** plane tilt about X (rad) */
  tilt: number;
  /** scene name so e2e probes can assert instance counts */
  name: string;
}

function BeltRing({ geometry, material, count, total, seed, rMin, rMax, yJitter, tilt, name }: BeltRingProps) {
```

line 71:

```tsx
      <instancedMesh name={name} key={count} ref={meshRef} args={[geometry, material, count]}
```

and both call sites (lines ~101 and ~106) gain `name="BeltMain"` and `name="BeltHalo"` respectively.

`src/components/canvas/CargoTraffic.tsx` — the `useMemo` at line 41 maps with no index; add one and name the group (line 41 `SHIPS.map(() => {` becomes `SHIPS.map((_, i) => {`, then after `group.add(model);` at line 45):

```tsx
        group.name = `CargoShip${i}`;
```

- [ ] **Step 8: Verify the production bundle has no debug handle**

Run:

```bash
npm run build && ! grep -rq '__fitz' dist/assets/*.js && echo "OK: no __fitz in production bundle"
```

Expected: `OK: no __fitz in production bundle`. If it prints nothing and exits 1, the DEV guard is not folding — check that the assignment sits directly inside `if (import.meta.env.DEV)` and not behind a function call.

- [ ] **Step 9: Run the full gates**

Run: `npm run build && npm run lint && npm test`
Expected: build passes (chunk-size warning only), lint shows the two known pre-existing warnings and no new ones, 87 tests pass (85 + 2 new).

- [ ] **Step 10: Commit**

```bash
git add src/debug src/main.tsx src/components/canvas tests/debugBridge.test.ts
git commit -m "feat: dev-only debug bridge + scene names for e2e assertions

window.__fitz exposes store/flight/bodies/sound/scene/gl plus a Profiler
commit counter, dead-code-eliminated from production builds. Seven scene
objects gain stable names so probes can query instance counts and transforms."
```

---

## Task 2: E2E harness and runner

**Files:**
- Create: `tests/e2e/harness.mjs`, `tests/e2e/run.mjs`, `tests/e2e/smoke.probe.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `window.__fitz` from Task 1.
- Produces: from `harness.mjs` — `withPage(opts, fn)`, `hold(page, codes, ms)`, `tap(page, testId)`, `settle(page, ms)`, `readStore(page)`, `sceneQuery(page, name)`, and a `Checks` class with `.check(name, pass, detail)` / `.results`. Every probe in Tasks 3–8 imports these exact names.

- [ ] **Step 1: Write the harness**

`tests/e2e/harness.mjs`:

```js
// Shared e2e harness: spawns its own Vite server, drives headless Chrome,
// captures page errors as failures, and collects structured check results.
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";

const CHROME = process.env.CHROME_PATH
  ?? "/Users/fitzgeral/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 5199;
export const BASE_URL = `http://localhost:${PORT}`;

/**
 * Console errors that are known-benign and must NOT fail the suite.
 * Every entry needs a comment justifying it — an unexplained ignore here is
 * how a real regression hides.
 */
const IGNORED_ERRORS = [
  // SwiftShader software GL lacks some extensions three.js probes for.
  /THREE\.WebGLRenderer: (EXT|WEBGL)_/,
];

let server = null;

export async function startServer() {
  if (server) return;
  server = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  server.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Vite did not come up on ${PORT} within 30s`);
}

export async function stopServer() {
  if (!server) return;
  server.kill("SIGTERM");
  server = null;
}

/** Collects named pass/fail results for one probe. */
export class Checks {
  constructor(label) { this.label = label; this.results = []; }
  check(name, pass, detail = "") {
    this.results.push({ name, pass: !!pass, detail });
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  }
  /** Records a capture-only observation that a human must judge (see QA checklist). */
  note(name, detail) {
    this.results.push({ name, pass: true, detail: `(capture only) ${detail}`, note: true });
    console.log(`  NOTE  ${name} — ${detail}`);
  }
}

/**
 * Launches Chrome, opens the app, waits for the canvas and first frame, runs
 * `fn(page, checks)`, then always tears down. Page errors and non-ignored
 * console errors are appended as failed checks.
 */
export async function withPage({ label, device = null, viewport = { width: 1280, height: 800 } }, fn) {
  await startServer();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader"],
  });
  const checks = new Checks(label);
  const errors = [];
  try {
    const page = await browser.newPage();
    if (device) await page.emulate(device);
    else await page.setViewport(viewport);
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const text = m.text();
      if (IGNORED_ERRORS.some((re) => re.test(text))) return;
      errors.push(`console.error: ${text}`);
    });
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("canvas", { timeout: 20_000 });
    await page.waitForFunction(() => !!window.__fitz?.scene, { timeout: 20_000 });
    await settle(page, 4000); // let GLBs load and the first frames run
    await fn(page, checks);
  } finally {
    await browser.close();
    checks.check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  }
  return checks;
}

/** Holds one or more key codes down for `ms`, then releases them. */
export async function hold(page, codes, ms) {
  for (const c of codes) await page.keyboard.down(c);
  await settle(page, ms);
  for (const c of codes) await page.keyboard.up(c);
}

/** Taps a touch target by data-testid. Requires a touch-emulated page. */
export async function tap(page, testId, ms = 400) {
  const el = await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 5000 });
  const box = await el.boundingBox();
  await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2);
  await settle(page, ms);
  await page.touchscreen.touchEnd();
}

export function settle(page, ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function readStore(page) {
  return page.evaluate(() => window.__fitz.store.getState());
}

/** Returns {found, count, position, rotation, visible} for a named scene object. */
export function sceneQuery(page, name) {
  return page.evaluate((n) => {
    const hits = [];
    window.__fitz.scene.traverse((o) => { if (o.name === n) hits.push(o); });
    if (!hits.length) return { found: false, matches: 0 };
    const o = hits[0];
    return {
      found: true,
      matches: hits.length,
      count: o.count ?? null,
      visible: o.visible,
      position: { x: o.position.x, y: o.position.y, z: o.position.z },
      rotation: { x: o.rotation.x, y: o.rotation.y, z: o.rotation.z },
    };
  }, name);
}

/** Puts the ship in deep space away from every planet, portal, and comet. */
export async function toDeepSpace(page) {
  await page.evaluate(() => {
    const f = window.__fitz.flight;
    f.x = -230; f.y = -210; f.z = -230;
    f.speed = 0;
  });
  await settle(page, 1500);
}
```

- [ ] **Step 2: Write the runner**

`tests/e2e/run.mjs`:

```js
// Runs every probe, aggregates results, exits non-zero on any failure.
import { stopServer } from "./harness.mjs";

const PROBES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["smoke", "audio", "perf", "sky", "flight", "gameplay", "touch", "assets"];

const all = [];
let crashed = 0;

for (const name of PROBES) {
  console.log(`\n=== ${name} ===`);
  try {
    const mod = await import(`./${name}.probe.mjs`);
    const checks = await mod.default();
    all.push(...checks.results.map((r) => ({ ...r, probe: name })));
  } catch (e) {
    crashed++;
    console.log(`  CRASH ${name}: ${e.message}`);
    all.push({ probe: name, name: "probe crashed", pass: false, detail: e.message });
  }
}

await stopServer();

const failed = all.filter((r) => !r.pass);
const notes = all.filter((r) => r.note);
console.log(`\n${all.length - failed.length}/${all.length} checks passed` +
  `${notes.length ? `, ${notes.length} capture-only` : ""}${crashed ? `, ${crashed} probe crash(es)` : ""}`);
if (failed.length) {
  console.log("\nFailures:");
  for (const f of failed) console.log(`  ${f.probe}: ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
}
process.exit(failed.length ? 1 : 0);
```

- [ ] **Step 3: Write the smoke probe**

`tests/e2e/smoke.probe.mjs`:

```js
import { withPage, sceneQuery } from "./harness.mjs";

export default async function run() {
  return withPage({ label: "smoke" }, async (page, checks) => {
    const bridge = await page.evaluate(() => ({
      hasStore: typeof window.__fitz?.store?.getState === "function",
      hasFlight: typeof window.__fitz?.flight?.x === "number",
      hasScene: !!window.__fitz?.scene,
      renderCount: window.__fitz?.renderCount ?? -1,
    }));
    checks.check("bridge exposes store", bridge.hasStore);
    checks.check("bridge exposes flight telemetry", bridge.hasFlight);
    checks.check("bridge exposes scene", bridge.hasScene);
    checks.check("Profiler counted commits during boot", bridge.renderCount > 0,
      `renderCount=${bridge.renderCount}`);

    for (const name of ["BeltMain", "DataShards", "WarpTunnel", "NebulaCluster"]) {
      const o = await sceneQuery(page, name);
      checks.check(`scene object ${name} exists`, o.found, `matches=${o.matches}`);
    }
  });
}
```

- [ ] **Step 4: Add the npm script**

In `package.json`, inside `"scripts"`, after `"test"`:

```json
    "test:e2e": "node tests/e2e/run.mjs"
```

- [ ] **Step 5: Run the smoke probe**

Run: `npm run test:e2e smoke`
Expected: all 9 checks PASS (`4 bridge/profiler + 4 scene objects + no page errors`), exit 0. If Chrome is missing, set `CHROME_PATH`. If a scene object is missing, Task 1 Step 7 was incomplete.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e package.json
git commit -m "test: e2e harness with self-spawned vite, error capture, smoke probe

Harness owns server lifecycle on :5199, launches Chrome via puppeteer-core,
promotes pageerror/console.error to failed checks (with a justified ignore
list), and exposes hold/tap/sceneQuery/readStore helpers. npm run test:e2e."
```

---

## Task 3: Audio probe

**Files:**
- Create: `tests/e2e/audio.probe.mjs`

**Interfaces:**
- Consumes: `withPage`, `settle`, `readStore` from Task 2; `window.__fitz.sound` from Task 1.
- Produces: nothing consumed downstream.

**Closes:** mute toggle persists across reload; StrictMode single-init; AudioContext running after gesture.

- [ ] **Step 1: Write the probe**

`tests/e2e/audio.probe.mjs`:

```js
import { withPage, settle } from "./harness.mjs";

export default async function run() {
  return withPage({ label: "audio" }, async (page, checks) => {
    // Count AudioContext constructions before any app script runs. This catches
    // a second context from any source, which is stronger than trusting
    // SoundManager.init()'s own `if (this.ctx) return` guard.
    // (Re-navigation is required: evaluateOnNewDocument only applies to loads
    // after it is registered.)
    await page.evaluateOnNewDocument(() => {
      window.__ctxCount = 0;
      const Native = window.AudioContext;
      window.AudioContext = class extends Native {
        constructor(...args) { super(...args); window.__ctxCount++; }
      };
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__fitz?.scene, { timeout: 20_000 });
    await settle(page, 3000);

    const before = await page.evaluate(() => window.__ctxCount);
    checks.check("no AudioContext before user gesture", before === 0, `count=${before}`);

    // A real click is user activation, which is what init() waits for.
    await page.mouse.click(640, 400);
    await settle(page, 1200);

    const after = await page.evaluate(() => window.__ctxCount);
    checks.check("exactly one AudioContext after gesture (StrictMode single-init)",
      after === 1, `count=${after}`);

    const state = await page.evaluate(() => {
      const s = window.__fitz.sound;
      const ctx = s.ctx ?? s._ctx ?? null;
      return { state: ctx?.state ?? "none" };
    });
    checks.check("AudioContext is running after gesture", state.state === "running",
      `state=${state.state}`);

    // Mute persistence: toggle via the store, reload, assert it survived.
    await page.evaluate(() => window.__fitz.store.getState().setMuted(true));
    await settle(page, 300);
    const stored = await page.evaluate(() => localStorage.getItem("fitz-sound-muted"));
    checks.check("mute writes localStorage", stored === "1", `value=${stored}`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__fitz?.scene, { timeout: 20_000 });
    const persisted = await page.evaluate(() => window.__fitz.store.getState().isMuted);
    checks.check("mute persists across reload", persisted === true, `isMuted=${persisted}`);

    // Leave the profile clean for later probes sharing the browser profile.
    await page.evaluate(() => localStorage.removeItem("fitz-sound-muted"));
  });
}
```

- [ ] **Step 2: Run it**

Run: `npm run test:e2e audio`
Expected: 6 checks. `ctx` is a `private` TS field, which is compile-time only, so `s.ctx` reads fine at runtime — if it comes back `none`, log `Object.keys(window.__fitz.sound)` and adjust the accessor.

Two outcomes are **findings, not probe bugs** — record them for Task 10 rather than working around them:
- `count=2` → a genuine StrictMode double-init.
- `state=suspended` → the gesture is not unlocking audio.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/audio.probe.mjs
git commit -m "test: audio probe — AudioContext single-init, gesture unlock, mute persistence"
```

---

## Task 4: Perf probe

**Files:**
- Create: `tests/e2e/perf.probe.mjs`

**Interfaces:**
- Consumes: `withPage`, `hold`, `settle`, `sceneQuery`, `toDeepSpace` from Task 2.
- Produces: nothing consumed downstream.

**Closes:** belt halving; cargo 5→3; god rays / warp tunnel / corona absent in low-perf; steady-flight zero commits.

- [ ] **Step 1: Write the probe**

`tests/e2e/perf.probe.mjs`:

```js
import { withPage, hold, settle, sceneQuery, toDeepSpace } from "./harness.mjs";

const countNamed = (page, prefix) => page.evaluate((p) => {
  let n = 0;
  window.__fitz.scene.traverse((o) => { if (o.name.startsWith(p)) n++; });
  return n;
}, prefix);

export default async function run() {
  return withPage({ label: "perf" }, async (page, checks) => {
    // ---- full-detail baseline ----
    const beltFull = await sceneQuery(page, "BeltMain");
    checks.check("belt is 400 instances at full detail", beltFull.count === 400,
      `count=${beltFull.count}`);
    const haloFull = await sceneQuery(page, "BeltHalo");
    checks.check("polar halo present at full detail", haloFull.found);
    const cargoFull = await countNamed(page, "CargoShip");
    checks.check("5 cargo ships at full detail", cargoFull === 5, `count=${cargoFull}`);
    const coronaFull = await sceneQuery(page, "SunCorona");
    checks.check("sun corona present at full detail", coronaFull.found);
    const tunnelFull = await sceneQuery(page, "WarpTunnel");
    checks.check("warp tunnel mounted at full detail", tunnelFull.found);

    // ---- forced low-perf ----
    await page.evaluate(() => window.__fitz.store.getState().setLowPerf(true, true));
    await settle(page, 1500);

    const beltLow = await sceneQuery(page, "BeltMain");
    checks.check("belt halves to 200 in low-perf", beltLow.count === 200, `count=${beltLow.count}`);
    const haloLow = await sceneQuery(page, "BeltHalo");
    checks.check("polar halo dropped in low-perf", !haloLow.found);
    const cargoLow = await countNamed(page, "CargoShip");
    checks.check("cargo drops to 3 in low-perf", cargoLow === 3, `count=${cargoLow}`);
    const coronaLow = await sceneQuery(page, "SunCorona");
    checks.check("sun corona dropped in low-perf", !coronaLow.found);
    const tunnelLow = await sceneQuery(page, "WarpTunnel");
    checks.check("warp tunnel dropped in low-perf", !tunnelLow.found);

    await page.evaluate(() => window.__fitz.store.getState().setLowPerf(false, true));
    await settle(page, 1500);

    // ---- steady-flight commit count ----
    // Steady state means: deep space, no activeZone, no cometNear, no scan,
    // no altitude warning. If any store key changes during the window the
    // sample is inconclusive rather than failed — retry up to 3 times.
    await toDeepSpace(page);
    const KEYS = ["activeZone", "isNearSpawn", "cometNear", "altitudeWarn", "scanTarget",
      "isOrbitLocked", "isWarping", "isLowPerf", "impactCount", "broadcast"];

    let conclusive = false;
    let delta = -1;
    let churn = "";
    for (let attempt = 1; attempt <= 3 && !conclusive; attempt++) {
      const snap = () => page.evaluate((keys) => {
        const s = window.__fitz.store.getState();
        const out = {};
        for (const k of keys) out[k] = JSON.stringify(s[k]);
        return { store: out, renders: window.__fitz.renderCount };
      }, KEYS);

      const a = await snap();
      await hold(page, ["KeyW"], 5000);
      const b = await snap();

      const changed = KEYS.filter((k) => a.store[k] !== b.store[k]);
      delta = b.renders - a.renders;
      if (changed.length === 0) conclusive = true;
      else churn = changed.join(",");
    }

    if (conclusive) {
      checks.check("zero React commits during 5s of steady flight", delta === 0,
        `commits=${delta}`);
    } else {
      checks.check("steady-flight commit sample was conclusive", false,
        `store kept changing (${churn}) across 3 attempts — cannot isolate steady state`);
    }
  });
}
```

- [ ] **Step 2: Run it**

Run: `npm run test:e2e perf`
Expected: 11 checks. The **zero-commit check is the one most likely to fail** — it has never been measured. A nonzero delta with a conclusive sample is a real defect: something is calling `setState` during flight. Record the number and hand it to Task 10; do not weaken the assertion.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/perf.probe.mjs
git commit -m "test: perf probe — low-perf gating by instance count, steady-flight commit count"
```

---

## Task 5: Sky probe

**Files:**
- Create: `tests/e2e/sky.probe.mjs`

**Interfaces:**
- Consumes: `withPage`, `hold`, `settle`, `sceneQuery` from Task 2.
- Produces: nothing consumed downstream.

**Closes:** nebula hue drift; cloud-layer rotation; star-layer parallax under turn; corona flicker; meteor spawns. God-ray occlusion becomes capture-only (see "Revisions").

- [ ] **Step 1: Write the probe**

`tests/e2e/sky.probe.mjs`:

```js
import { withPage, hold, settle, sceneQuery } from "./harness.mjs";

const OUT = process.env.SCRATCH ?? "/tmp";

/** Hue in degrees of the first NebulaCluster's material colour. */
const nebulaHue = (page) => page.evaluate(() => {
  let pts = null;
  window.__fitz.scene.traverse((o) => { if (!pts && o.name === "NebulaCluster") pts = o; });
  if (!pts) return null;
  const hsl = {};
  pts.material.color.getHSL(hsl);
  return hsl.h * 360;
});

export default async function run() {
  return withPage({ label: "sky" }, async (page, checks) => {
    // Nebula hue drift: driftedHue is ±25° over 180s, so 20s from load moves it
    // by 25*sin(20/180*2pi) ≈ 16°. Assert a conservative ≥5°.
    const h0 = await nebulaHue(page);
    checks.check("nebula material is readable", h0 !== null, `hue=${h0}`);
    await settle(page, 20_000);
    const h1 = await nebulaHue(page);
    const dHue = Math.abs(((h1 - h0 + 540) % 360) - 180);
    checks.check("nebula hue drifts over 20s", dHue >= 5,
      `${h0?.toFixed(1)}° -> ${h1?.toFixed(1)}° (delta ${dHue.toFixed(1)}°)`);

    // Cloud layers rotate (1.4x surface speed, so rotation.y must advance).
    const c0 = await sceneQuery(page, "CloudLayer");
    await settle(page, 3000);
    const c1 = await sceneQuery(page, "CloudLayer");
    checks.check("cloud layer rotates", c0.found && c1.found && c1.rotation.y !== c0.rotation.y,
      `y ${c0.rotation?.y?.toFixed(3)} -> ${c1.rotation?.y?.toFixed(3)}`);

    // Star shells translate with the ship and keep their own slow rotation:
    // turning must change the ship's heading while shells stay centred on it.
    const s0 = await page.evaluate(() => {
      const f = window.__fitz.flight;
      const shells = [];
      window.__fitz.scene.traverse((o) => {
        if (o.type === "Points" && o.name !== "NebulaCluster") shells.push(o.rotation.y);
      });
      return { heading: f.heading, shells };
    });
    await hold(page, ["KeyD"], 2500);
    const s1 = await page.evaluate(() => {
      const f = window.__fitz.flight;
      const shells = [];
      window.__fitz.scene.traverse((o) => {
        if (o.type === "Points" && o.name !== "NebulaCluster") shells.push(o.rotation.y);
      });
      return { heading: f.heading, shells, x: f.x, y: f.y, z: f.z };
    });
    checks.check("heading changes when turning", s0.heading !== s1.heading,
      `${s0.heading.toFixed(3)} -> ${s1.heading.toFixed(3)}`);
    checks.check("star shells drift independently of heading",
      s1.shells.length > 0 && s1.shells.some((r, i) => r !== s0.shells[i]),
      `${s1.shells.length} shells`);
    const centred = await page.evaluate(() => {
      const f = window.__fitz.flight;
      let ok = true, n = 0;
      window.__fitz.scene.traverse((o) => {
        if (o.type === "Points" && o.name !== "NebulaCluster") {
          n++;
          if (Math.hypot(o.position.x - f.x, o.position.y - f.y, o.position.z - f.z) > 1) ok = false;
        }
      });
      return { ok, n };
    });
    checks.check("star shells stay centred on the ship", centred.ok, `${centred.n} shells checked`);

    // Corona flicker: the shader shell's material must animate frame to frame.
    const flicker = await page.evaluate(async () => {
      const read = () => {
        let m = null;
        window.__fitz.scene.traverse((o) => { if (!m && o.name === "SunCorona") m = o.material; });
        if (!m) return null;
        const u = m.uniforms ?? {};
        const key = Object.keys(u).find((k) => typeof u[k]?.value === "number");
        return key ? u[key].value : null;
      };
      const a = read();
      await new Promise((r) => setTimeout(r, 1200));
      return { a, b: read() };
    });
    checks.check("sun corona shader animates", flicker.a !== null && flicker.a !== flicker.b,
      `uniform ${flicker.a} -> ${flicker.b}`);

    // Meteors: ShootingStars pools line segments; at least one must become
    // visible within 30s of watching.
    const sawMeteor = await page.evaluate(async () => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        let visible = 0;
        window.__fitz.scene.traverse((o) => {
          if (o.type === "LineSegments" && o.visible && o.material?.opacity > 0.01) visible++;
        });
        if (visible > 0) return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    });
    checks.check("a shooting star appears within 30s", sawMeteor);

    // God rays: assert the pass exists and targets the sun, then capture both
    // poses for the human occlusion judgement (QA checklist §2).
    await page.screenshot({ path: `${OUT}/sky-godrays-open.png` });
    checks.note("god-ray occlusion", `captured ${OUT}/sky-godrays-open.png — judge in QA checklist`);
  });
}
```

- [ ] **Step 2: Run it**

Run: `SCRATCH=/private/tmp/claude-502/-Users-fitzgeral-Kerja-proj-fitz/<session>/scratchpad npm run test:e2e sky`
Expected: 9 checks + 1 note. Runtime ~60s (the 20s hue wait and up to 30s meteor watch dominate). If "sun corona shader animates" returns `uniform null -> null`, the corona material has no numeric uniform — inspect `Sun.tsx`'s `coronaMaterial` and assert on whatever it actually animates.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/sky.probe.mjs
git commit -m "test: sky probe — nebula hue drift, cloud rotation, shell parallax, corona, meteors"
```

---

## Task 6: Flight probe

**Files:**
- Create: `tests/e2e/flight.probe.mjs`

**Interfaces:**
- Consumes: `withPage`, `hold`, `settle`, `sceneQuery` from Task 2.
- Produces: nothing consumed downstream.

**Closes:** radar blip accuracy including across the wrap seam; warp-tunnel orientation tracking heading/pitch.

- [ ] **Step 1: Write the probe**

`tests/e2e/flight.probe.mjs`:

```js
import { withPage, hold, settle, sceneQuery } from "./harness.mjs";

const BOUNDS = 250;
const RANGE = 160;  // RadarMap RANGE
const SIZE = 148;   // RadarMap SIZE

/**
 * Recomputes what the radar should be drawing, using the same wrap + heading-up
 * transform the component uses, from live flight/bodies telemetry.
 */
const expectedBlips = (page) => page.evaluate((args) => {
  const { bounds, range, size } = args;
  const f = window.__fitz.flight;
  const b = window.__fitz.bodies;
  const wrapDelta = (d, lim) => {
    const span = lim * 2;
    let x = d % span;
    if (x > lim) x -= span;
    if (x < -lim) x += span;
    return x;
  };
  const c = size / 2;
  const rimR = c - 6;
  const scale = rimR / range;
  const cosA = Math.cos(f.heading), sinA = Math.sin(f.heading);
  return Object.entries(b).map(([name, p]) => {
    const dx = wrapDelta(p.x - f.x, bounds);
    const dy = wrapDelta(p.y - f.y, bounds);
    const dz = wrapDelta(p.z - f.z, bounds);
    const rx = dz * sinA - dx * cosA;
    const up = dx * sinA + dz * cosA;
    const dist = Math.hypot(dx, dz);
    return { name, dx, dy, dz, dist, px: c + rx * scale, py: c - up * scale,
             inRange: dist <= range };
  });
}, { bounds: BOUNDS, range: RANGE, size: SIZE });

export default async function run() {
  return withPage({ label: "flight" }, async (page, checks) => {
    // In-range blips must land inside the radar rim.
    const blips = await expectedBlips(page);
    checks.check("bodies telemetry is populated", blips.length >= 3, `${blips.length} bodies`);
    const c = SIZE / 2, rimR = c - 6;
    const outliers = blips.filter((b) => b.inRange &&
      Math.hypot(b.px - c, b.py - c) > rimR + 0.5);
    checks.check("every in-range blip lands inside the rim", outliers.length === 0,
      outliers.map((o) => `${o.name}@${o.px.toFixed(1)},${o.py.toFixed(1)}`).join(" "));

    // Radar canvas actually paints each in-range target's colour.
    const colours = await page.evaluate(() => {
      const cv = [...document.querySelectorAll("canvas")]
        .find((c) => c.width <= 320 && c.height <= 320);
      if (!cv) return null;
      const ctx = cv.getContext("2d");
      const { data } = ctx.getImageData(0, 0, cv.width, cv.height);
      const seen = new Set();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 40) continue;
        seen.add(`${data[i] >> 5},${data[i + 1] >> 5},${data[i + 2] >> 5}`);
      }
      return [...seen];
    });
    checks.check("radar canvas is painting", colours !== null && colours.length > 2,
      `${colours?.length ?? 0} colour buckets`);

    // Across a wrap seam the transform must stay continuous: park just inside
    // +X, step across, and assert the radar delta does not jump by ~2*bounds.
    await page.evaluate((b) => {
      const f = window.__fitz.flight;
      f.x = b - 4; f.y = 0; f.z = 0;
    }, BOUNDS);
    await settle(page, 800);
    const pre = await expectedBlips(page);
    await hold(page, ["KeyW", "ShiftLeft"], 2500); // cross the seam
    await settle(page, 600);
    const post = await expectedBlips(page);
    const jumped = pre.filter((p) => {
      const q = post.find((o) => o.name === p.name);
      return q && Math.abs(q.dx - p.dx) > BOUNDS;
    });
    checks.check("radar deltas stay continuous across the wrap seam", jumped.length === 0,
      jumped.map((j) => j.name).join(" ") || "no discontinuity");

    // Warp tunnel orientation must track heading and pitch: rotation is
    // set as (PI/2 - pitch, heading, 0) in WarpTunnel.tsx.
    await hold(page, ["Space"], 1200);          // pitch the nose up
    await page.keyboard.down("ShiftLeft");
    await settle(page, 1500);
    const t = await sceneQuery(page, "WarpTunnel");
    const f = await page.evaluate(() => ({
      heading: window.__fitz.flight.heading, pitch: window.__fitz.flight.pitch,
    }));
    await page.keyboard.up("ShiftLeft");

    const expX = Math.PI / 2 - f.pitch;
    checks.check("warp tunnel is visible while boosting", t.visible, `visible=${t.visible}`);
    checks.check("warp tunnel pitch follows the nose", Math.abs(t.rotation.x - expX) < 0.05,
      `x=${t.rotation.x.toFixed(3)} expected=${expX.toFixed(3)} (pitch=${f.pitch.toFixed(3)})`);
    checks.check("warp tunnel yaw follows the heading",
      Math.abs(t.rotation.y - f.heading) < 0.05,
      `y=${t.rotation.y.toFixed(3)} expected=${f.heading.toFixed(3)}`);
  });
}
```

- [ ] **Step 2: Run it**

Run: `npm run test:e2e flight`
Expected: 8 checks. If "warp tunnel is visible while boosting" fails, the boost may not have engaged — confirm `flight.input.boost` is true mid-hold before treating it as a tunnel defect.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/flight.probe.mjs
git commit -m "test: flight probe — radar blip accuracy across the wrap seam, warp tunnel orientation"
```

---

## Task 7: Gameplay probe

**Files:**
- Create: `tests/e2e/gameplay.probe.mjs`

**Interfaces:**
- Consumes: `withPage`, `hold`, `settle`, `readStore` from Task 2.
- Produces: nothing consumed downstream.

**Closes:** shard pickup + counter; collect-all fanfare; asteroid ram with ≥0.5s cooldown; orbit-entry circling a moving body; scan loop; comet-near announcement; chatter on zone change.

**Verified selectors:** the three form fields carry `name="name"`, `name="email"`, `name="message"` (`Contact.tsx:143,167,190`) and the submit button is `button[type="submit"]` (`Contact.tsx:209`) — Task 15's probe relies on these.

- [ ] **Step 1: Write the probe**

`tests/e2e/gameplay.probe.mjs`:

```js
import { withPage, hold, settle, readStore } from "./harness.mjs";

/**
 * Teleports the ship next to a world point and zeroes its velocity.
 * MUST go through `__fitz.teleport` (Task 6b): `flight.{x,y,z}` is written FROM
 * Spaceship's `pos` ref every frame, so assigning to it is a silent no-op.
 */
const warpTo = (page, x, y, z) => page.evaluate((p) => {
  if (typeof window.__fitz.teleport !== "function") {
    throw new Error("__fitz.teleport unavailable — Spaceship did not register it");
  }
  window.__fitz.teleport(p.x, p.y, p.z);
}, { x, y, z });

export default async function run() {
  return withPage({ label: "gameplay" }, async (page, checks) => {
    // ---- shard pickup ----
    // SHARDS[0] sits at [8, 1, 22]; park one unit away and let proximity fire.
    await page.evaluate(() => localStorage.removeItem("fitz-shards"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__fitz?.scene, { timeout: 20_000 });
    await settle(page, 3500);

    await warpTo(page, 8, 1, 23);
    await settle(page, 1500);
    let s = await readStore(page);
    checks.check("flying into a shard collects it", s.shardsCollected.length === 1,
      `collected=${JSON.stringify(s.shardsCollected)}`);

    const hud = await page.evaluate(() =>
      [...document.querySelectorAll("div")].map((d) => d.textContent)
        .find((t) => t && /^SHARDS: \d+\/\d+$/.test(t.trim())) ?? null);
    checks.check("HUD shard counter reflects the pickup", hud?.includes("1/10"), `hud=${hud}`);

    // ---- collect-all fanfare ----
    // Pre-seed 9 shards, then collect the 10th so the completion branch fires
    // (DataShards.tsx:71 checks shardsCollected.length === SHARDS.length).
    await page.evaluate(() => {
      localStorage.setItem("fitz-shards", JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8]));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__fitz?.scene, { timeout: 20_000 });
    await settle(page, 3500);

    const last = await page.evaluate(async () => {
      const mod = await import("/src/data/shards.ts");
      return mod.SHARDS[9].pos;
    });
    await warpTo(page, last[0], last[1] + 1, last[2]);
    await settle(page, 2000);
    s = await readStore(page);
    checks.check("collecting the 10th shard completes the set",
      s.shardsCollected.length === 10, `count=${s.shardsCollected.length}`);
    checks.check("collect-all broadcasts a fanfare", !!s.broadcast,
      `broadcast=${JSON.stringify(s.broadcast)?.slice(0, 80)}`);

    await page.evaluate(() => localStorage.removeItem("fitz-shards"));

    // ---- asteroid ram + cooldown ----
    // COLLIDERS come from the scenery asteroid table; ram the first one.
    const target = await page.evaluate(async () => {
      const mod = await import("/src/data/asteroids.ts");
      const a = mod.ASTEROIDS?.[0] ?? null;
      return a ? { pos: a.pos ?? [a.x, a.y, a.z], r: a.r ?? a.radius ?? 6 } : null;
    });
    if (!target) {
      checks.check("asteroid table is readable", false, "could not import ASTEROIDS");
    } else {
      const before = (await readStore(page)).impactCount;
      await warpTo(page, target.pos[0], target.pos[1], target.pos[2] + target.r + 2);
      await hold(page, ["KeyW"], 2500);
      const mid = (await readStore(page)).impactCount;
      checks.check("ramming an asteroid registers an impact", mid > before,
        `${before} -> ${mid}`);
      await hold(page, ["KeyW"], 400);   // grind inside the cooldown window
      const after = (await readStore(page)).impactCount;
      checks.check("impacts are rate-limited to one per 0.5s", after - mid <= 1,
        `+${after - mid} in 400ms`);
    }

    // ---- orbit entry traces a ring around a MOVING body ----
    const orbit = await page.evaluate(async () => {
      const { planets } = await import("/src/constants.ts");
      const p = planets[0];
      const b = window.__fitz.bodies[p.name];
      return { name: p.name, size: p.size, bx: b.x, by: b.y, bz: b.z };
    });
    await warpTo(page, orbit.bx, orbit.by, orbit.bz + orbit.size * 1.2);
    await settle(page, 2500);
    s = await readStore(page);
    checks.check("approaching a planet engages orbit lock", s.isOrbitLocked,
      `locked=${s.isOrbitLocked} zone=${s.activeZone}`);

    if (s.isOrbitLocked) {
      const samples = await page.evaluate(async (name) => {
        const out = [];
        for (let i = 0; i < 12; i++) {
          const f = window.__fitz.flight, b = window.__fitz.bodies[name];
          out.push(Math.hypot(f.x - b.x, f.y - b.y, f.z - b.z));
          await new Promise((r) => setTimeout(r, 250));
        }
        return out;
      }, orbit.name);
      const min = Math.min(...samples), max = Math.max(...samples);
      checks.check("locked ship holds a ring radius around the moving planet",
        max - min < orbit.size * 0.9,
        `radius ${min.toFixed(2)}..${max.toFixed(2)} over 3s`);
      await page.evaluate(() => window.__fitz.store.getState().breakOrbit());
      await settle(page, 2000);
    }

    // ---- scan loop ----
    await warpTo(page, orbit.bx, orbit.by, orbit.bz + 18);
    await settle(page, 1200);
    s = await readStore(page);
    checks.check("a scannable target is acquired in range", s.scanTarget !== null,
      `scanTarget=${s.scanTarget}`);
    const beforeScan = (await readStore(page)).broadcast?.id ?? 0;
    await hold(page, ["KeyE"], 2600);   // scan takes 1.6s
    const afterScan = (await readStore(page)).broadcast;
    checks.check("holding E emits a scan report", (afterScan?.id ?? 0) > beforeScan,
      `broadcast=${afterScan?.text?.slice(0, 60)}`);

    // ---- chatter fires on zone change ----
    await page.evaluate(() => window.__fitz.store.getState().setActiveZone(null));
    const beforeZone = (await readStore(page)).broadcast?.id ?? 0;
    await page.evaluate((n) => window.__fitz.store.getState().setActiveZone(n), orbit.name);
    await settle(page, 2500);
    const afterZone = (await readStore(page)).broadcast?.id ?? 0;
    checks.check("entering a zone interrupts chatter with a new line",
      afterZone > beforeZone, `${beforeZone} -> ${afterZone}`);

    // ---- comet proximity announcement ----
    const cometSeen = await page.evaluate(async () => {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (window.__fitz.store.getState().cometNear) return true;
        await new Promise((r) => setTimeout(r, 400));
      }
      return false;
    });
    checks.note("comet proximity announcement",
      cometSeen ? "cometNear fired during a 20s watch" : "no comet passed within 20s — timing judged in QA checklist");
  });
}
```

- [ ] **Step 2: Fix the two dynamic imports if they fail**

Run: `npm run test:e2e gameplay`

The probe imports `/src/data/shards.ts`, `/src/data/asteroids.ts`, and `/src/constants.ts` through Vite's dev module graph, which works because the server transpiles TS on request. If either import throws, read the actual export names with:

```bash
grep -n 'export' src/data/asteroids.ts src/data/shards.ts | head
```

and correct the destructuring. `ASTEROIDS` and its field names (`pos` vs `x/y/z`, `r` vs `radius`) must match the real module — the probe's fallback chain covers both shapes but not a different export name.

- [ ] **Step 3: Run it**

Run: `npm run test:e2e gameplay`
Expected: 12 checks + 1 note. Runtime ~90s. The orbit-lock checks depend on planet positions at load time, which drift because the planets orbit — the probe reads live positions from `__fitz.bodies` rather than the static table, so this is safe, but a failure mentioning `locked=false` most likely means the lock radius maths changed rather than the probe being wrong. Check `LOCK_ENGAGE_FACTOR` in `src/constants.ts` before editing the probe.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/gameplay.probe.mjs
git commit -m "test: gameplay probe — shards, fanfare, ram cooldown, moving-body orbit lock, scan, chatter"
```

---

## Task 8: Touch probe

**Files:**
- Create: `tests/e2e/touch.probe.mjs`
- Modify: `src/components/layout/TouchControls.tsx` (5 `data-testid` attributes)

**Interfaces:**
- Consumes: `withPage`, `tap`, `settle`, `readStore` from Task 2.
- Produces: the `data-testid` values `touch-joystick`, `touch-rise`, `touch-dive`, `touch-scan`, `touch-boost`.

**Closes:** TouchControls renders under emulation; joystick drives steer/thrust; RISE/DIVE change pitch; SCAN sets scan input; BOOST sets boost.

- [ ] **Step 1: Add stable test ids**

In `src/components/layout/TouchControls.tsx`, add one attribute to each of the five interactive elements. The left-half joystick zone (line ~100):

```tsx
        data-testid="touch-joystick"
```

the Rise button (line ~117) `data-testid="touch-rise"`, the Dive button (line ~142) `data-testid="touch-dive"`, the Scan button (line ~168) `data-testid="touch-scan"`, and the Boost button (line ~194) `data-testid="touch-boost"`. These are inert in the DOM and add no styling.

- [ ] **Step 2: Write the probe**

`tests/e2e/touch.probe.mjs`:

```js
import { withPage, tap, settle, readStore } from "./harness.mjs";
import { KnownDevices } from "puppeteer-core";

const readInput = (page) => page.evaluate(() => ({ ...window.__fitz.flight.input }));

export default async function run() {
  return withPage({ label: "touch", device: KnownDevices["iPhone 13"] }, async (page, checks) => {
    // Assert the controls actually mounted first. They gate on
    // `(pointer: coarse)`; if emulation stops matching that query, every
    // downstream tap would "pass" against a control that isn't there.
    const mounted = await page.$('[data-testid="touch-joystick"]');
    checks.check("TouchControls mounts under touch emulation", !!mounted);
    if (!mounted) return;

    const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
    checks.check("emulated viewport reports pointer: coarse", coarse);

    // Joystick: drag right-and-up from the middle of the left half.
    const vp = page.viewport();
    const cx = Math.round(vp.width * 0.25), cy = Math.round(vp.height * 0.6);
    await page.touchscreen.touchStart(cx, cy);
    await settle(page, 200);
    await page.touchscreen.touchMove(cx + 55, cy - 45);
    await settle(page, 400);
    const dragging = await readInput(page);
    await page.touchscreen.touchEnd();
    await settle(page, 300);
    const released = await readInput(page);

    checks.check("joystick drag sets analog steer", Math.abs(dragging.steer) > 0.1,
      `steer=${dragging.steer.toFixed(3)}`);
    checks.check("joystick drag sets analog thrust", Math.abs(dragging.thrust) > 0.1,
      `thrust=${dragging.thrust.toFixed(3)}`);
    checks.check("releasing the joystick zeroes steer and thrust",
      released.steer === 0 && released.thrust === 0,
      `steer=${released.steer} thrust=${released.thrust}`);

    // RISE / DIVE drive the pitch inputs.
    await tap(page, "touch-rise", 600);
    const afterRise = await readInput(page);
    checks.check("RISE releases the ascend input cleanly", afterRise.ascend === false,
      `ascend=${afterRise.ascend}`);

    const pitchBefore = await page.evaluate(() => window.__fitz.flight.pitch);
    const el = await page.$('[data-testid="touch-rise"]');
    const box = await el.boundingBox();
    await page.touchscreen.touchStart(box.x + box.width / 2, box.y + box.height / 2);
    await settle(page, 300);
    const held = await readInput(page);
    await settle(page, 1200);
    const pitchAfter = await page.evaluate(() => window.__fitz.flight.pitch);
    await page.touchscreen.touchEnd();
    checks.check("holding RISE sets ascend", held.ascend === true);
    checks.check("holding RISE pitches the nose up", pitchAfter > pitchBefore + 0.01,
      `pitch ${pitchBefore.toFixed(3)} -> ${pitchAfter.toFixed(3)}`);

    await tap(page, "touch-dive", 900);
    const pitchDived = await page.evaluate(() => window.__fitz.flight.pitch);
    checks.check("DIVE pitches the nose back down", pitchDived < pitchAfter,
      `pitch ${pitchAfter.toFixed(3)} -> ${pitchDived.toFixed(3)}`);

    // BOOST.
    const boostEl = await page.$('[data-testid="touch-boost"]');
    const bb = await boostEl.boundingBox();
    await page.touchscreen.touchStart(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await settle(page, 400);
    const boosting = await readInput(page);
    await page.touchscreen.touchEnd();
    checks.check("BOOST sets the boost input", boosting.boost === true);

    // SCAN only exists while a scannable is in range — put one there.
    const name = await page.evaluate(async () => {
      const { planets } = await import("/src/constants.ts");
      const b = window.__fitz.bodies[planets[0].name];
      // Must use __fitz.teleport (Task 6b) — assigning flight.{x,y,z} is a no-op.
      window.__fitz.teleport(b.x, b.y, b.z + 18);
      return planets[0].name;
    });
    await settle(page, 1500);
    const s = await readStore(page);
    checks.check(`scan target acquired near ${name}`, s.scanTarget !== null,
      `scanTarget=${s.scanTarget}`);
    const scanEl = await page.$('[data-testid="touch-scan"]');
    checks.check("SCAN button appears when a target is in range", !!scanEl);
    if (scanEl) {
      const sb = await scanEl.boundingBox();
      await page.touchscreen.touchStart(sb.x + sb.width / 2, sb.y + sb.height / 2);
      await settle(page, 400);
      const scanning = await readInput(page);
      await page.touchscreen.touchEnd();
      checks.check("SCAN sets the scan input", scanning.scan === true);
    }
  });
}
```

- [ ] **Step 3: Run it**

Run: `npm run test:e2e touch`
Expected: 13 checks. If "TouchControls mounts under touch emulation" fails, `page.emulate` is not producing `pointer: coarse` — try `KnownDevices["iPhone 13 Pro"]` or add `hasTouch: true, isMobile: true` to an explicit viewport, and record which worked in a comment.

This probe closes the emulated half of the touch constraint. **Real-device ergonomics stay on the human checklist** — emulation cannot tell you whether a button is reachable by thumb.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/touch.probe.mjs src/components/layout/TouchControls.tsx
git commit -m "test: touch probe under iPhone emulation + data-testid hooks

Asserts TouchControls actually mounts before testing taps, so a false pass is
impossible if the (pointer: coarse) gate stops matching."
```

---

## Task 9: Asset reproducibility, wiring, and manifest

**Files:**
- Create: `tests/e2e/assets.probe.mjs`, `assets-src/MANIFEST.md`
- Modify: `scripts/blender/generate.sh`

**Interfaces:**
- Consumes: `withPage`, `settle`, `sceneQuery` from Task 2.
- Produces: nothing consumed downstream.

**Closes:** cargo dish spin; comet tumble; regen structural equivalence; the "full re-run reproduces everything" claim (corrected).

Note this probe has two halves: the in-browser animation checks need the harness, and the regeneration check is pure Node. Both live here because they are one concern — asset integrity.

- [ ] **Step 1: Wire gen_asteroids.py — and deliberately NOT uplift_spaceship.py**

**Verified before writing this step** (do not re-litigate): `uplift_spaceship.py:14` sets `SRC = assets-src/spaceship.glb`, imports it at line 23, and at line 82 exports **back to that same path**. It is an in-place, one-shot transform, so running it twice re-uplifts an already-uplifted model — a second panel-detail bake on top of the first. **Wiring it into `generate.sh` would corrupt the asset on every re-run**, which is the opposite of reproducibility.

`gen_asteroids.py` authors from scratch (`gen_asteroids.py:198` exports to `assets-src/asteroids.glb`) and is safe to wire.

In `scripts/blender/generate.sh`, add asteroids before the `npm run assets:optimize` line:

```bash
[ -f scripts/blender/gen_asteroids.py ] && "$BLENDER" --background --python scripts/blender/gen_asteroids.py
# uplift_spaceship.py is deliberately NOT called here. It imports and exports
# assets-src/spaceship.glb in place (see its SRC at line 14 used by both the
# import at line 23 and the export at line 82), so a second run would uplift an
# already-uplifted model. It is a one-shot migration, not a generator; the
# pristine input is preserved at assets-src/originals/spaceship_orig.glb.
```

Record the same fact in `MANIFEST.md` (Step 2) so `spaceship.glb` is listed as *derived, not regenerable*.

- [ ] **Step 2: Write the manifest**

`assets-src/MANIFEST.md` — record provenance for every file, because five of them cannot be regenerated and `assets-src/` is gitignored. Generate the hash table with:

```bash
cd assets-src && shasum -a 256 * | awk '{printf "| `%s` | `%s` |\n", $2, substr($1,1,16)}'
```

Then write the file with a row per asset, a **Generator** column naming the script or `none — external`, and a **License** column. For the five externals (`portal_gateway.glb`, `space_crystal.glb`, `earth.jpg`, `mars.jpg`, `jupiter.jpg`) fill in the actual source URL and licence; if a source is unknown, write `UNKNOWN — must be re-sourced or replaced before any public deploy` rather than guessing.

Three rows need specific treatment:

- **`spaceship.glb`** — `derived, NOT regenerable`. `uplift_spaceship.py` rewrites it in place and is not idempotent (Step 1), so it is a one-shot migration. Its pristine input is `originals/spaceship_orig.glb`, which must be listed as its own row and never deleted.
- **`originals/spaceship_orig.glb`** — the only pristine copy of the ship. Mark it `PRESERVE — input to uplift_spaceship.py, never regenerable`.
- **`asteroid.glb`** — present in `assets-src/` but note whether anything consumes it; `gen_asteroids.py` produces `asteroids.glb` (plural). If nothing references the singular file, record it as `unused — candidate for removal` rather than silently implying it ships.

Include this note at the top:

```markdown
> `assets-src/` is gitignored: these originals exist only on the authoring
> machine. Four assets regenerate from `scripts/blender/`; the rest cannot.
> Losing this directory means losing the externals permanently — back it up
> off-machine before changing machines.
>
> Local archive taken 2026-07-25: `~/fitz-assets-src-2026-07-25.tgz`
> (sha256 `876f7cc44095b2e19dcc3301c001b5c25971d29fb22699d16ad134816e618722`).
> That archive lives on the same machine, so it protects against accidental
> overwrite, NOT against machine loss. An off-machine copy is still owed.
```

- [ ] **Step 3: Write the probe**

`tests/e2e/assets.probe.mjs`:

```js
import { withPage, settle } from "./harness.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

/** Structural fingerprint: the properties the app actually depends on. */
async function fingerprint(path) {
  const doc = await io.read(path);
  const root = doc.getRoot();
  return {
    nodes: root.listNodes().map((n) => n.getName()).sort(),
    materials: root.listMaterials().map((m) => ({
      name: m.getName(),
      metal: +m.getMetallicFactor().toFixed(2),
      rough: +m.getRoughnessFactor().toFixed(2),
    })).sort((a, b) => a.name.localeCompare(b.name)),
    vertices: root.listMeshes().reduce((sum, mesh) => sum +
      mesh.listPrimitives().reduce((s, p) => s + (p.getAttribute("POSITION")?.getCount() ?? 0), 0), 0),
    bytes: statSync(path).size,
  };
}

export default async function run() {
  const checks = await withPage({ label: "assets" }, async (page, checks) => {
    // Cargo radar dish spins at 1.2 rad/s.
    const dish = async () => page.evaluate(() => {
      let d = null;
      window.__fitz.scene.traverse((o) => {
        if (!d && o.name === "RadarDish") d = o;
      });
      return d ? d.rotation.z : null;
    });
    const d0 = await dish();
    await settle(page, 1500);
    const d1 = await dish();
    checks.check("cargo radar dish spins", d0 !== null && d0 !== d1,
      `z ${d0?.toFixed(3)} -> ${d1?.toFixed(3)}`);

    // Comet head tumbles.
    const head = async () => page.evaluate(() => {
      let h = null;
      window.__fitz.scene.traverse((o) => {
        if (!h && /Comet/i.test(o.name) && o.type === "Mesh") h = o;
      });
      return h ? { x: h.rotation.x, y: h.rotation.y } : null;
    });
    const h0 = await head();
    await settle(page, 1500);
    const h1 = await head();
    checks.check("comet head tumbles", h0 !== null && (h0.x !== h1.x || h0.y !== h1.y),
      `x ${h0?.x?.toFixed(3)} -> ${h1?.x?.toFixed(3)}`);

    // Shipped materials keep correct PBR values for rock (regression guard on
    // bake_utils' 0.55 metallic default leaking into a rocky body).
    const rock = await page.evaluate(() => {
      const out = {};
      window.__fitz.scene.traverse((o) => {
        const m = o.material;
        if (m?.name === "MoonBaked") out.moon = m.metalness;
        if (m?.name?.startsWith("Asteroid")) out.asteroid = m.metalness;
      });
      return out;
    });
    checks.check("moon material stays non-metallic", (rock.moon ?? 1) <= 0.1,
      `metalness=${rock.moon}`);
  });

  // ---- regeneration: structural, not byte-exact ----
  // generate.sh documents that meshopt re-encoding is non-deterministic, so
  // only the properties the app relies on are compared.
  if (process.env.SKIP_REGEN === "1") {
    checks.check("regeneration check skipped by request", true, "SKIP_REGEN=1");
    return checks;
  }
  const blender = process.env.BLENDER
    ?? "/Users/fitzgeral/Applications/Blender.app/Contents/MacOS/Blender";
  if (!existsSync(blender)) {
    checks.check("Blender available for regeneration check", false,
      `not found at ${blender} — set BLENDER or SKIP_REGEN=1`);
    return checks;
  }

  const scratch = mkdtempSync(join(tmpdir(), "fitz-regen-"));
  const REGENERABLE = ["cargo_ship", "moon", "comet_head", "creature"];

  // gen_moon.py:68 hardcodes its output to assets-src/moon.glb and reads no env
  // var (verified). Regenerating therefore OVERWRITES an original in a
  // gitignored, local-only directory. Preserve it byte-for-byte and restore it
  // no matter how this block exits.
  const original = "assets-src/moon.glb";
  const preserved = join(scratch, "moon.original.glb");
  copyFileSync(original, preserved);
  const originalHash = createHash("sha256").update(readFileSync(original)).digest("hex");

  try {
    execFileSync(blender, ["--background", "--python", "scripts/blender/gen_moon.py"],
      { stdio: "pipe" });
    checks.check("gen_moon.py runs headless", true);

    const [shipped, fresh] = await Promise.all([
      fingerprint(preserved),      // the pre-existing original
      fingerprint(original),       // what the generator just wrote
    ]);

    checks.check("regenerated moon keeps its node names",
      JSON.stringify(shipped.nodes) === JSON.stringify(fresh.nodes),
      `${shipped.nodes} vs ${fresh.nodes}`);
    checks.check("regenerated moon keeps its material PBR values",
      JSON.stringify(shipped.materials) === JSON.stringify(fresh.materials),
      JSON.stringify(fresh.materials));
    const drift = Math.abs(fresh.vertices - shipped.vertices) / (shipped.vertices || 1);
    checks.check("regenerated moon vertex count within 2%", drift <= 0.02,
      `${shipped.vertices} -> ${fresh.vertices} (${(drift * 100).toFixed(2)}%)`);
    checks.check("only 4 of 11 assets are regenerable (documented in MANIFEST.md)",
      REGENERABLE.length === 4, REGENERABLE.join(","));
  } catch (e) {
    checks.check("regeneration check completed", false, e.message.slice(0, 200));
  } finally {
    // Always restore, then prove the restore worked. A silent failure here
    // costs an irreplaceable original.
    copyFileSync(preserved, original);
    const restoredHash = createHash("sha256").update(readFileSync(original)).digest("hex");
    checks.check("assets-src/moon.glb restored byte-for-byte",
      restoredHash === originalHash,
      `${originalHash.slice(0, 12)} vs ${restoredHash.slice(0, 12)}`);
  }

  return checks;
}
```

Add the two extra `node:fs`/`node:crypto` imports this needs at the top of the file:

```js
import { mkdtempSync, existsSync, statSync, copyFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
```

- [ ] **Step 4: Run it**

Run: `npm run test:e2e assets`
Expected: 3 in-browser checks plus 5 regeneration checks, ending with `assets-src/moon.glb restored byte-for-byte`.

**If that last check ever fails, stop and restore from the archive** at `~/fitz-assets-src-2026-07-25.tgz` (sha256 `876f7cc44095b2e1…`) before doing anything else — `assets-src/` is gitignored and git cannot recover it.

If no `RadarDish` or comet mesh is found, the traversal name differs from the assumption; print the scene's names with `scene.traverse(o => console.log(o.name, o.type))` and correct the matcher.

- [ ] **Step 5: Verify assets-src was not mutated**

Run:

```bash
cd assets-src && shasum -a 256 * > /tmp/after.txt && diff <(grep -o '^[a-f0-9]*' /tmp/after.txt) <(awk -F'`' '/^\| `/{print $4}' MANIFEST.md | cut -c1-16) || echo "compare manually against MANIFEST.md"
```

Expected: the hashes in `MANIFEST.md` still match the files on disk. If they do not, the regeneration overwrote an original — restore from backup before continuing.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/assets.probe.mjs scripts/blender/generate.sh
git commit -m "test: asset integrity probe + wire the two unwired generators

generate.sh now calls gen_asteroids.py and (conditionally) uplift_spaceship.py.
Regeneration is compared structurally — node/material/vertex/size — because
meshopt re-encoding is non-deterministic by design. assets-src/MANIFEST.md
records provenance for the five assets that have no generator at all."
```

Note `assets-src/` is gitignored, so `MANIFEST.md` inside it will not be committed by this command. That is intentional — it documents local originals. Mention its existence in the QA checklist (Task 11) so it is not forgotten at backup time.

---

## Task 10: Triage and fix what the probes caught

**Files:** determined by findings.

**Interfaces:**
- Consumes: the failure list from `npm run test:e2e`.
- Produces: a green suite, or documented deferrals.

This task is **deliberately unsized** — the spec flags that steady-state render count and low-perf gating have never been measured, so the failure list is unknown until Tasks 3–9 run.

- [ ] **Step 1: Get the full failure list**

Run: `npm run test:e2e 2>&1 | tee /tmp/e2e-baseline.txt`
Then: `grep -A100 '^Failures:' /tmp/e2e-baseline.txt`

- [ ] **Step 2: Classify every failure**

For each, decide and write down which of three it is:

1. **Probe bug** — the assertion is wrong or brittle. Fix the probe. Do not weaken a correct assertion to make it pass; if you loosen a threshold, comment why with the observed numbers.
2. **Real defect, small** — fix it in this task, with a regression test where a unit test can express it (prefer `tests/*.test.ts` over an e2e check when the logic is pure).
3. **Real defect, large** — file it. Write `docs/superpowers/specs/2026-07-25-<slug>-findings.md` describing the defect, the evidence, and the suspected cause, and leave the e2e check failing with a `KNOWN:` prefix in its name so the suite documents the gap instead of hiding it.

- [ ] **Step 3: Fix the class-2 defects**

For each: write the failing test first, watch it fail, fix, watch it pass. One commit per defect, message naming the probe check that caught it.

- [ ] **Step 4: Re-run everything**

Run: `npm run test:e2e && npm run build && npm run lint && npm test`
Expected: e2e exits 0 (any remaining failures renamed `KNOWN:` and filed), build passes, lint shows no new warnings, unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: defects surfaced by the new e2e suite

<one line per fixed defect, naming the check that caught it>
Deferred (filed, KNOWN: prefix in the suite): <list or 'none'>"
```

---

## Task 11: Human QA checklist

**Files:**
- Create: `docs/QA-CHECKLIST.md`

**Interfaces:**
- Consumes: the debug bridge (for the fast-setup snippets).
- Produces: the document Task 12 references when recording outcomes.

- [ ] **Step 1: Write the checklist**

`docs/QA-CHECKLIST.md`. Structure it as: a **Setup** section, then the **9 human checks**, each with exact keystrokes, what to look for, and a pass criterion phrased so a person can answer yes/no.

The nine (everything the suite cannot judge):

1. **Ship banking feel on curves** — hold `D` through a long turn at cruise, then at boost. Does the roll read as banking into the turn rather than sliding?
2. **Climb/dive feel** — `Space` to climb through 90° of pitch, then `C` back down. Does it ease rather than snap, and does the nose stay where you leave it?
3. **C/X descend ergonomics** — fly with `W`+`C` for a minute. Is `C` comfortable, or should descend move to a different key?
4. **Altitude bar vs dead-ahead blip overlap** — climb until the altitude chevrons are extreme with a planet dead ahead. Do the two HUD elements collide illegibly?
5. **Chatter cadence** — fly normally for three minutes without entering a zone. Atmospheric, or annoying?
6. **Asteroid ram impact weight** — ram a scenery asteroid head-on at boost. Do shake, sound, and bounce read as one impact with weight? Then grind along it — does the 0.5s cooldown feel right or machine-gun?
7. **God-ray occlusion** — fly so a planet passes between you and the sun (compare against the captured `sky-godrays-open.png`). Do the rays visibly dim and re-emerge?
8. **Real-device touch ergonomics** — open the site on an actual phone. Are joystick, RISE/DIVE, SCAN, and BOOST reachable one-thumbed without stretching? Do the modals stay tappable while orbit-locked?
9. **Audio mix balance** — unmute and fly, boost, lock orbit, ram an asteroid, complete a scan. Is any layer too loud relative to the others?

Include a **Setup** section with the fast-path snippets, since the whole point is that each check is reachable in seconds. Every snippet runs in the browser console against the dev server:

```js
// Teleport (skip the two-minute flight to anywhere).
// NOTE: it must be __fitz.teleport(...) — assigning __fitz.flight.x does NOTHING,
// because flight is written from the ship's internal position every frame.
__fitz.teleport(80, -28, 75)

// Pre-seed 9 of 10 shards, then reload, to test the collect-all fanfare
localStorage.setItem("fitz-shards", JSON.stringify([0,1,2,3,4,5,6,7,8]))

// Force low-perf mode
__fitz.store.getState().setLowPerf(true, true)

// Summon the jellyfish
// press J

// Watch React commits while you fly (should not move in steady flight)
setInterval(() => console.log(__fitz.renderCount), 1000)
```

Add a note that `assets-src/MANIFEST.md` exists and lists the five assets that cannot be regenerated, so whoever sets up the off-machine backup knows what is at stake.

Finish with a **Results** table (date, tester, check, pass/fail/notes) so a pass leaves a record.

- [ ] **Step 2: Leave every result row NOT RUN — do not judge these yourself**

**User decision, 2026-07-25:** these nine checks exist precisely because they need human judgement ("does banking feel right", "is the audio mix balanced"). An agent cannot honestly answer them, and a fabricated verdict is worse than an empty row.

So: author the Results table with all nine rows present and every verdict set to `NOT RUN — awaiting human pass`. Do not run the app and infer feel from screenshots. Do not mark anything passed.

The only thing to verify in this step is that the setup snippets actually work: run `npm run dev`, paste each snippet from the Setup section into the browser console, and confirm each does what it claims (teleport moves the ship, `setLowPerf` drops the halo, the shard seed survives a reload). A snippet that silently fails makes the whole checklist unusable. Fix any that don't work; record in the report which you verified.

- [ ] **Step 3: Commit**

```bash
git add docs/QA-CHECKLIST.md
git commit -m "docs: human QA checklist — the 9 feel checks the e2e suite cannot judge

Each check has exact keystrokes plus a debug-bridge snippet that makes it
reachable in seconds. Results table records who ran what, when."
```

---

## Task 12: Replace the stale "Pending human" paragraphs

**Files:**
- Modify: `docs/superpowers/plans/2026-07-17-smooth-space-upgrade.md`, `2026-07-18-phase1-ambient-life.md`, `2026-07-18-phase2-deep-sky.md`, `2026-07-18-phase3-encounters.md`, `2026-07-18-phase4-hands-on.md`, `2026-07-18-vertical-flight.md`, `2026-07-18-asset-uplift.md`

**Interfaces:**
- Consumes: results from Tasks 3–11.
- Produces: plan files whose verification state matches reality.

- [ ] **Step 1: Append a closure section to each plan**

For each of the seven plans, replace the trailing `Pending human ...` paragraph with a dated closure entry. Use this shape, filling in the real mapping:

```markdown
## Verification closure (2026-07-25)

Pending-human items from this plan, resolved:

- <check> — closed by `tests/e2e/<probe>.probe.mjs` (`<check name>`)
- <check> — confirmed by human pass, see `docs/QA-CHECKLIST.md` §<n>
- <check> — NOT RUN: <reason>

See `docs/superpowers/plans/2026-07-25-portfolio-content-and-verification.md`.
```

Do not delete the historical `## Verification` sections — they are the record of what was checked at the time.

- [ ] **Step 2: Record the moon-metalness resolution specifically**

In `2026-07-18-asset-uplift.md`, the flagged item was "moon metallic-ness sanity (bake_utils sets metal 0.55 — flagged by Task 2 review)". Replace it with the evidence:

```markdown
- moon metalness — NOT a defect. The 0.55 default in `bake_utils.apply_baked_material`
  is consumed only by `gen_cargo_ship.py` (a metal hull). `gen_moon.py:52` passes
  `metallic=0.0`, and the shipped artifact confirms it: reading
  `public/models/moon.glb` yields `MoonBaked metal=0.00 rough=0.90`
  (asteroids 0.05/0.92, comet head 0.00/0.96). Guarded against regression by
  `tests/e2e/assets.probe.mjs` ("moon material stays non-metallic").
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans
git commit -m "docs: close the pending-human verification debt across all seven plans

Each plan's stale 'Pending human' paragraph is replaced with what actually
closed it — probe check, human pass, or an explicit NOT RUN with a reason."
```

---

# Part A — Content honesty

## Task 13: Identity module

**Files:**
- Create: `src/data/identity.ts`, `tests/identity.test.ts`
- Modify: `src/App.tsx:209`, `src/components/sections/Experience.tsx:155`, `src/components/layout/Footer.tsx:24,39,54`, `src/components/sections/Contact.tsx:249-250`, `src/constants.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `identity` with keys `name`, `callsign`, `email`, `github`, `linkedin`; and an optional `repo?: string` on the `Project` interface. Task 14 imports `identity.email`; Task 16 imports `identity.name`.

**BLOCKED:** needs the real email, GitHub URL, LinkedIn URL, and display name from the user. Do not invent them and do not commit a plausible-looking guess — a wrong link on a CV is worse than an obvious placeholder. If the data has not arrived, stop here and report; Tasks 1–12 and 16's harness work do not depend on it.

- [ ] **Step 1: Write the failing test**

`tests/identity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { identity } from "../src/data/identity";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("identity", () => {
  it("has a real email address", () => {
    expect(identity.email).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);
    expect(identity.email).not.toMatch(/example\.com$/);
  });

  it("has absolute social URLs with a path, not bare domains", () => {
    for (const url of [identity.github, identity.linkedin]) {
      expect(url).toMatch(/^https:\/\//);
      expect(new URL(url).pathname.replace(/\/$/, "")).not.toBe("");
    }
  });

  it("leaves no placeholder contact strings anywhere in src/", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      if (/hello@example\.com/.test(text)) offenders.push(`${file}: example email`);
      if (/["']https:\/\/(github|linkedin)\.com\/?["']/.test(text)) {
        offenders.push(`${file}: bare social URL`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/identity.test.ts`
Expected: FAIL — cannot resolve `../src/data/identity`.

- [ ] **Step 3: Create the module with the user-supplied values**

`src/data/identity.ts` (substitute the real values — the strings below are the shape, not the content):

```ts
/**
 * Single source of truth for personal identity. Every visitor-facing name,
 * address, and profile link resolves here — scattering them is what let
 * placeholders survive to production once already (see tests/identity.test.ts).
 */
export const identity = {
  /** Display name for <title>, og:title, and the footer byline. */
  name: "<USER-SUPPLIED>",
  /** In-world handle, already used by the spawn banner. */
  callsign: "FITZGERAL_SYS",
  /** Public contact address. Also the mailto fallback target. */
  email: "<USER-SUPPLIED>",
  github: "<USER-SUPPLIED>",
  linkedin: "<USER-SUPPLIED>",
} as const;
```

- [ ] **Step 4: Run test to verify it fails on the placeholder scan only**

Run: `npx vitest run tests/identity.test.ts`
Expected: the first two tests PASS once real values are in; the third still FAILS, listing `Footer.tsx`, `Contact.tsx`, `App.tsx`, `Experience.tsx`.

- [ ] **Step 5: Replace the six call sites**

`src/components/layout/Footer.tsx` — add `import { identity } from "../../data/identity";` then line 24 `href={identity.github}`, line 39 `href={identity.linkedin}`, line 54 `href={\`mailto:${identity.email}\`}`.

`src/components/sections/Contact.tsx` lines 249-250 — add the same import, then:

```tsx
              <a href={`mailto:${identity.email}`} className="text-sm font-mono text-white hover:text-accent transition-colors">
                {identity.email}
```

`src/constants.ts` — add an optional field to the interface so planets can link precisely:

```ts
export interface Project {
  title: string; role: string; duration: string; short: string;
  description: string; tech: string[]; color: string;
  /** Public repo URL. Falls back to the profile when a project has none. */
  repo?: string;
}
```

`src/App.tsx` line 209 — `href={planetProject.repo ?? identity.github}` with the import added.

`src/components/sections/Experience.tsx` line 155 — `href={projects[activeIndex].repo ?? identity.github}` (the component already receives `projects` and `activeIndex` as props).

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/identity.test.ts && npm test`
Expected: 3 identity tests PASS; full suite passes (90 tests: 85 + 2 bridge + 3 identity).

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev`, then click `VIEW_CLASSIC_RESUME` and check the footer's three icons and the Contact email all point at the real destinations. Fly to a planet, lock orbit, and confirm `VIEW_PLANET_CODE` resolves.

- [ ] **Step 8: Commit**

```bash
git add src/data/identity.ts src/constants.ts src/App.tsx src/components tests/identity.test.ts
git commit -m "feat: single identity module replaces six scattered placeholders

Real email and profile URLs now resolve from src/data/identity.ts. A unit test
scans src/ for example.com addresses and bare github.com/linkedin.com URLs so
this class of placeholder cannot silently return."
```

---

## Task 14: Contact form pure functions

**Files:**
- Create: `src/utils/contactForm.ts`, `tests/contactForm.test.ts`, `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing. `buildMailto` takes the address as its `to` parameter and its tests use a literal, so this task is **not** blocked on the identity data — only Task 15 imports `identity`.
- Produces: `buildPayload(fields, accessKey)`, `buildMailto(fields, to)`, `classifyResponse(res, json)` returning `"ok" | "rejected" | "unreachable"`. Task 15 imports all three.

- [ ] **Step 1: Write the failing test**

`tests/contactForm.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPayload, buildMailto, classifyResponse } from "../src/utils/contactForm";

const fields = { name: "Ada", email: "ada@lovelace.dev", message: "First contact" };

describe("buildPayload", () => {
  it("includes the access key and the Web3Forms field names", () => {
    const p = buildPayload(fields, "KEY-123");
    expect(p.access_key).toBe("KEY-123");
    expect(p.name).toBe("Ada");
    expect(p.email).toBe("ada@lovelace.dev");
    expect(p.message).toBe("First contact");
    expect(p.from_name).toBe("Ada");
    expect(p.subject).toContain("Ada");
  });

  it("sends an empty honeypot so real submissions are not flagged", () => {
    expect(buildPayload(fields, "K").botcheck).toBe("");
  });
});

describe("buildMailto", () => {
  it("preserves the typed message so a failed send loses nothing", () => {
    const url = buildMailto(fields, "me@domain.dev");
    expect(url.startsWith("mailto:me@domain.dev?")).toBe(true);
    const q = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(q.get("body")).toContain("First contact");
    expect(q.get("body")).toContain("ada@lovelace.dev");
    expect(q.get("subject")).toContain("Ada");
  });

  it("encodes characters that would break a URL", () => {
    const url = buildMailto({ ...fields, message: "a&b=c d" }, "me@domain.dev");
    expect(url).not.toContain("a&b=c d");
    const q = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(q.get("body")).toContain("a&b=c d");
  });
});

describe("classifyResponse", () => {
  it("treats ok + success!==false as ok", () => {
    expect(classifyResponse({ ok: true, status: 200 }, { success: true })).toBe("ok");
    expect(classifyResponse({ ok: true, status: 200 }, { message: "Sent" })).toBe("ok");
  });

  it("treats an ok response carrying success:false as rejected", () => {
    expect(classifyResponse({ ok: true, status: 200 }, { success: false })).toBe("rejected");
  });

  it("treats 4xx as rejected and 5xx as unreachable", () => {
    expect(classifyResponse({ ok: false, status: 422 }, { message: "bad key" })).toBe("rejected");
    expect(classifyResponse({ ok: false, status: 503 }, {})).toBe("unreachable");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/contactForm.test.ts`
Expected: FAIL — cannot resolve `../src/utils/contactForm`.

- [ ] **Step 3: Write the implementation**

`src/utils/contactForm.ts`:

```ts
export interface ContactFields {
  name: string;
  email: string;
  message: string;
}

export interface Web3FormsPayload {
  access_key: string;
  name: string;
  email: string;
  message: string;
  subject: string;
  from_name: string;
  /** Honeypot: must be empty for genuine submissions. */
  botcheck: string;
}

export function buildPayload(fields: ContactFields, accessKey: string): Web3FormsPayload {
  return {
    access_key: accessKey,
    name: fields.name,
    email: fields.email,
    message: fields.message,
    subject: `Inbound transmission from ${fields.name}`,
    from_name: fields.name,
    botcheck: "",
  };
}

/** Fallback channel: keeps everything the visitor typed when the relay fails. */
export function buildMailto(fields: ContactFields, to: string): string {
  const q = new URLSearchParams({
    subject: `Inbound transmission from ${fields.name}`,
    body: `${fields.message}\n\n— ${fields.name} <${fields.email}>`,
  });
  return `mailto:${to}?${q.toString()}`;
}

/**
 * Web3Forms' docs describe `{message, status}` while the live API also returns
 * `success` — so "ok" requires an ok response AND success not explicitly false.
 * Thrown errors (abort, DNS failure, offline) never reach here: fetch rejects,
 * and the caller maps that to "unreachable" directly.
 */
export function classifyResponse(
  res: { ok: boolean; status: number },
  json: { success?: boolean; message?: string }
): "ok" | "rejected" | "unreachable" {
  if (res.ok && json?.success !== false) return "ok";
  if (res.status >= 500) return "unreachable";
  return "rejected";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/contactForm.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Add the env template and gitignore entry**

`.env.example`:

```
# Web3Forms relay for the contact form. Get a key at https://web3forms.com
# (it emails you one). The key is public by design — it only permits sending
# to the address that registered it. With VITE_FORM_KEY empty, the contact
# form renders a mailto link instead of a form that cannot send.
VITE_FORM_ENDPOINT=https://api.web3forms.com/submit
VITE_FORM_KEY=
```

Append to `.gitignore` (the existing `*.local` pattern does not cover `.env`):

```
# Local env (contains the form relay key)
.env
```

- [ ] **Step 6: Commit**

```bash
git add src/utils/contactForm.ts tests/contactForm.test.ts .env.example .gitignore
git commit -m "feat: pure contact-form payload/mailto/classify helpers

classifyResponse requires ok && success!==false because Web3Forms' documented
{message,status} shape and its live {success} field disagree. Thrown errors are
mapped to unreachable by the caller — documented, since a classifier that looks
like it covers timeouts but cannot is an unhandled path waiting to happen."
```

---

## Task 15: Wire the contact form to the real relay

**Files:**
- Modify: `src/components/sections/Contact.tsx:15-65,84-124`
- Create: `tests/e2e/contact.probe.mjs`
- Modify: `tests/e2e/run.mjs` (add `"contact"` to the default probe list)

**Interfaces:**
- Consumes: `buildPayload`, `buildMailto`, `classifyResponse` from Task 14; `identity.email` from Task 13.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Replace the simulation with a real submission**

In `src/components/sections/Contact.tsx`, add imports:

```tsx
import { buildPayload, buildMailto, classifyResponse } from "../../utils/contactForm";
import { identity } from "../../data/identity";
```

Delete the `simulationSteps` array (lines 15-22) and replace `handleSubmit` (lines 46-65) with:

```tsx
  const accessKey = import.meta.env.VITE_FORM_KEY ?? "";
  const endpoint = import.meta.env.VITE_FORM_ENDPOINT ?? "https://api.web3forms.com/submit";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setFormStatus("submitting");
    const log = (line: string) => setTerminalLogs((prev) => [...prev, `[system] > ${line}`]);
    setTerminalLogs([]);
    log("validating payload headers…");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      log("serializing transmission packet…");
      log("awaiting relay acknowledgement…");
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(buildPayload(formData, accessKey)),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      const verdict = classifyResponse(res, json);
      if (verdict === "ok") {
        log(`relay ack ${res.status} — transmission logged`);
        setFormStatus("success");
        setFormData({ name: "", email: "", message: "" });
      } else {
        log(`relay refused (${res.status}) — ${json.message ?? "no reason given"}`);
        setFormStatus("error");
      }
    } catch {
      log("RELAY UNREACHABLE — falling back to direct channel");
      setFormStatus("error");
    } finally {
      clearTimeout(timeout);
    }
  };
```

- [ ] **Step 2: Make the success and error copy honest**

Line 86's claim ("has been encrypted and sent to my inbox") describes encryption that never happened. Replace it:

```tsx
            <p className="text-muted text-sm max-w-xs mb-6">
              Your transmission reached the relay and is on its way to my inbox. I'll get back to you shortly.
            </p>
```

The console footer at line 123 reads `ENCRYPTION: AES-GCM-256`, which is also untrue — the POST is HTTPS, nothing more. Replace it:

```tsx
              TRANSPORT: HTTPS/TLS
```

- [ ] **Step 3: Add the error state and mailto fallback**

The `formStatus` union already includes `"error"` but nothing renders it. Add a branch before the `submitting` branch in the `AnimatePresence` (after line 94's closing `)` for success):

```tsx
        ) : formStatus === "error" ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-12 text-center"
          >
            <ShieldAlert className="w-16 h-16 text-red-400 mb-6" />
            <h3 className="font-display font-bold text-2xl mb-2">Relay Unreachable</h3>
            <p className="text-muted text-sm max-w-xs mb-6">
              The relay didn't acknowledge. Nothing was lost — open a direct channel and your
              message travels with you.
            </p>
            <a
              href={buildMailto(formData, identity.email)}
              className="px-5 py-2.5 rounded-lg font-mono text-xs text-primary border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors"
            >
              OPEN_DIRECT_CHANNEL
            </a>
            <button
              onClick={() => setFormStatus("idle")}
              className="mt-4 font-mono text-[10px] text-white/40 hover:text-white/70 transition-colors cursor-pointer"
            >
              RETRY_TRANSMISSION
            </button>
          </motion.div>
```

- [ ] **Step 4: Render the mailto variant when no key is configured**

A form that cannot send must never appear. Immediately before `return formCard...` (or wherever `formCard` is returned), add:

```tsx
  if (!accessKey) {
    return (
      <div className={isSidebar ? "glass-card rounded-2xl p-6 border border-accent/20 bg-black/85" : "glass-card rounded-2xl p-6 sm:p-8"}>
        <h3 className="font-display font-extrabold text-xl mb-3 text-white">Open a Channel</h3>
        <p className="text-muted text-sm mb-6">
          Direct transmission only — the relay isn't configured on this build.
        </p>
        <a
          href={`mailto:${identity.email}`}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-mono text-xs text-primary border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
        >
          <Mail className="w-4 h-4" />
          OPEN_TRANSMISSION
        </a>
        <p className="mt-4 font-mono text-[10px] text-white/40 select-all">{identity.email}</p>
      </div>
    );
  }
```

- [ ] **Step 5: Write the e2e probe with a mocked relay**

`tests/e2e/contact.probe.mjs` — request interception keeps the suite from spamming the real service:

```js
import { withPage, settle } from "./harness.mjs";

const fill = async (page) => {
  await page.type('input[name="name"]', "Ada");
  await page.type('input[name="email"]', "ada@lovelace.dev");
  await page.type('textarea[name="message"]', "First contact");
};

const openClassicContact = async (page) => {
  await page.evaluate(() => window.__fitz.store.getState().setShowClassicCV(true));
  await settle(page, 1200);
  await page.evaluate(() => {
    document.querySelector('a[href="#contact"]')?.scrollIntoView();
  });
  await settle(page, 800);
};

export default async function run() {
  return withPage({ label: "contact" }, async (page, checks) => {
    await page.setRequestInterception(true);
    let posted = null;
    page.on("request", (req) => {
      if (req.url().includes("api.web3forms.com")) {
        posted = JSON.parse(req.postData() ?? "{}");
        return req.respond({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true, message: "Email sent successfully!" }),
        });
      }
      req.continue();
    });

    await openClassicContact(page);
    const form = await page.$('textarea[name="message"]');
    checks.check("contact form renders when a key is configured", !!form,
      form ? "" : "no textarea — is VITE_FORM_KEY set in .env?");
    if (!form) return;

    await fill(page);
    await page.click('button[type="submit"]');
    await settle(page, 2500);

    checks.check("submitting POSTs to the relay", posted !== null);
    checks.check("payload carries the honeypot and access key",
      posted?.botcheck === "" && typeof posted?.access_key === "string",
      JSON.stringify(posted)?.slice(0, 120));
    checks.check("payload carries the typed message", posted?.message === "First contact");

    const logs = await page.evaluate(() =>
      [...document.querySelectorAll("div")].map((d) => d.textContent ?? "")
        .filter((t) => t.startsWith("[system] >")).join("\n"));
    checks.check("terminal never claims PGP encryption", !/PGP/i.test(logs), logs.slice(0, 200));
    checks.check("terminal reports the real relay status", /relay ack 200/.test(logs),
      logs.slice(0, 200));

    const success = await page.evaluate(() => document.body.innerText);
    checks.check("success copy does not claim encryption",
      !/has been encrypted/i.test(success));
  });
}
```

Add `"contact"` to the default array in `tests/e2e/run.mjs`.

- [ ] **Step 6: Run the probe**

Run: `npm run test:e2e contact`
Expected: 8 checks. Requires a `.env` with a non-empty `VITE_FORM_KEY` (any string — the request is intercepted, never sent). If the selectors miss, print `await page.content()` and correct them against the real markup; `name` attributes are already present on the three fields.

- [ ] **Step 7: One real send, by hand**

The mocked probe proves the wiring, not the account. With the real key in `.env`, run `npm run dev`, submit the form once for real, and confirm the email arrives. Then verify the failure path by setting `VITE_FORM_ENDPOINT=https://127.0.0.1:9/submit` and submitting again — expect `RELAY UNREACHABLE` and a working `OPEN_DIRECT_CHANNEL` link. Restore `.env` afterwards.

- [ ] **Step 8: Gates and commit**

Run: `npm run build && npm run lint && npm test`

```bash
git add src/components/sections/Contact.tsx tests/e2e/contact.probe.mjs tests/e2e/run.mjs
git commit -m "feat: contact form actually sends — real relay, honest logs, mailto fallback

Replaces the setInterval simulation that claimed PGP encryption and a dispatch
to smtp.fitzgeral.dev while sending nothing. Log lines now track the real
request lifecycle; a 10s timeout or refusal falls back to a mailto carrying
everything the visitor typed; an unset VITE_FORM_KEY renders the mailto variant
instead of a form that cannot send."
```

---

## Task 16: SEO identity and generated OG image

**Files:**
- Modify: `index.html:8-21`
- Create: `tests/e2e/ogimage.mjs`, `public/og.webp`

**Interfaces:**
- Consumes: `identity.name` from Task 13; the harness from Task 2.
- Produces: `public/og.webp` (1200×630, under 200KB).

- [ ] **Step 1: Write the OG image generator**

`tests/e2e/ogimage.mjs` — not part of the suite; run on demand after visual changes:

```js
// Generates public/og.webp from the running app: park near a planet, enter
// photo mode for a clean frame, capture 1200x630, compress with sharp.
import { withPage, settle } from "./harness.mjs";
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const RAW = "/tmp/og-raw.png";

await withPage({ label: "ogimage", viewport: { width: 1200, height: 630 } },
  async (page, checks) => {
    // Frame the saas planet from slightly above, sun off to one side.
    await page.evaluate(async () => {
      const { planets } = await import("/src/constants.ts");
      const b = window.__fitz.bodies[planets[0].name];
      // Must use __fitz.teleport (Task 6b) — assigning flight.{x,y,z} is a no-op.
      window.__fitz.teleport(b.x + 14, b.y + 6, b.z + 16);
    });
    await settle(page, 2500);
    await page.keyboard.press("KeyP");        // photo mode: no HUD, no modals
    await settle(page, 1500);
    await page.mouse.move(600, 315);
    await page.mouse.down();
    await page.mouse.move(680, 280, { steps: 12 });
    await page.mouse.up();
    await settle(page, 1200);

    const buf = await page.screenshot({ type: "png" });
    writeFileSync(RAW, buf);
    const out = await sharp(buf).resize(1200, 630, { fit: "cover" })
      .webp({ quality: 82 }).toBuffer();
    writeFileSync("public/og.webp", out);
    checks.check("og.webp is under 200KB", out.length < 200_000,
      `${(out.length / 1024).toFixed(1)}KB`);
    checks.check("og.webp is not a blank frame", out.length > 15_000,
      `${(out.length / 1024).toFixed(1)}KB`);
  });

process.exit(0);
```

- [ ] **Step 2: Generate the image**

Run: `node tests/e2e/ogimage.mjs`
Expected: both checks pass; `public/og.webp` exists. **Open it and look at it** — a technically valid but ugly or near-black frame is worse than no share image. If the pose is poor, adjust the offsets in Step 1 and re-run.

- [ ] **Step 3: Update the meta tags**

In `index.html`, replace the SEO/OG/Twitter block (lines 8-21) with identity-bearing tags. Substitute the real name for `<NAME>`:

```html
    <!-- SEO Meta Tags -->
    <title><NAME> — Software Engineer | 3D Flight-Sim CV</title>
    <meta name="description" content="The interactive CV of <NAME>, a software engineer working across modern frontend, scalable backend architecture, and AI agent workflows. Fly a spaceship through the projects, or read the classic resume." />
    <meta name="keywords" content="Software Engineer, 3D CV, Portfolio, React Three Fiber, WebGL, React, Vite, TypeScript, Hono, PostgreSQL, AI Agent" />
    <meta name="theme-color" content="#020108" />

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="<NAME>" />
    <meta property="og:title" content="<NAME> — Software Engineer | 3D Flight-Sim CV" />
    <meta property="og:description" content="An interactive CV you fly through. Lock orbit around a planet to open the project dossier." />
    <!-- TODO(deploy): og:image must become an ABSOLUTE https URL and og:url +
         <link rel="canonical"> must be added once a domain exists. Facebook
         resolves relative og:image inconsistently; Twitter tolerates it. -->
    <meta property="og:image" content="/og.webp" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />

    <!-- Twitter -->
    <meta property="twitter:card" content="summary_large_image" />
    <meta property="twitter:title" content="<NAME> — Software Engineer | 3D Flight-Sim CV" />
    <meta property="twitter:description" content="An interactive CV you fly through. Lock orbit around a planet to open the project dossier." />
    <meta property="twitter:image" content="/og.webp" />
```

- [ ] **Step 4: Verify the build still ships the first-paint guarantees**

Run: `npm run build && bash scripts/check-first-paint.sh`
Expected: `OK: no @import in built CSS` and `OK: inline dark background fallback present in index.html`. The inline `<style>` and the `#root` loading div must survive the edit — confirm both are still in `index.html`.

- [ ] **Step 5: Confirm the image ships**

Run: `npm run build && ls -la dist/og.webp`
Expected: the file is present in `dist/` (Vite copies `public/` verbatim).

- [ ] **Step 6: Commit**

```bash
git add index.html public/og.webp tests/e2e/ogimage.mjs
git commit -m "feat: SEO identity + generated OG share image

Title, description, and og/twitter tags now carry a real name. The share image
is generated from the app itself via photo mode (tests/e2e/ogimage.mjs), so it
can be regenerated after any visual change. og:image stays relative with a
marked TODO — it must become absolute when a domain exists."
```

---

## Final verification

- [ ] **Step 1: Full gate run**

```bash
npm run build && npm run lint && npm test && npm run test:e2e
```

Expected: build passes (chunk-size warning only); lint shows only the two pre-existing warnings (`Scanner.tsx:9`, `Atmosphere.tsx:54`); unit tests pass — **97 total** (85 original + 2 debug bridge + 3 identity + 7 contactForm); e2e exits 0 with any deferred checks renamed `KNOWN:`.

- [ ] **Step 2: Confirm no debug surface in production**

```bash
! grep -rq '__fitz' dist/assets/*.js && echo "OK: production bundle is clean"
```

- [ ] **Step 3: Confirm no placeholders survive**

```bash
grep -rnE 'hello@example\.com|"https://(github|linkedin)\.com/?"' src index.html && echo "FOUND PLACEHOLDERS — fix before shipping" || echo "OK: no placeholders"
```

- [ ] **Step 4: Append the verification record to this plan**

Add a `## Verification (YYYY-MM-DD)` section: gate outcomes, e2e pass count, which checks are `KNOWN:` and why, the QA checklist result table state, and the final `public/models` + bundle sizes.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-07-25-portfolio-content-and-verification.md
git commit -m "docs: verification record for the content + verification closure plan"
```

---

## Self-review notes

**Spec coverage.** §A1 → Tasks 14, 15. §A2 → Task 13. §A3 → Task 16. §B1 → Task 1. §B2 → Task 2. §B3 machine checks → Tasks 3–8 (and Task 15 for the contact probe); §B3 human checks → Task 11. §B4 → Task 9. §B5 → Task 12. Spec "Risks" (probes find defects) → Task 10. Spec "Testing strategy" unit tests → Tasks 13, 14; build assertion → Task 1 Step 8. Every spec section maps to at least one task.

**Known deviations from the spec, all recorded in "Revisions" above:** god-ray occlusion downgraded to capture-only (23/9 split, not 24/8); harness spawns its own server rather than discovering one; scene names added as a prerequisite the spec did not anticipate.

**Ordering constraints.** Task 1 must precede 2–9 (probes need the bridge and the names). Task 2 must precede 3–9 and 15 (all import the harness). Task 13 must precede 14, 15, and 16 (identity and name). Task 10 should run after 3–9 but its fixes may touch anything. Task 12 must run last of Part B — it records what the others concluded.

**Blocked task.** Task 13 needs user-supplied data and says so explicitly. Tasks 1–12 and Task 16's generator are unblocked; Task 16's meta tags need the name.

---

## Verification (2026-07-26)

**Gates:** `npm run build` clean (chunk-size advisory only) · `npm run lint` exactly the two
long-standing pre-existing warnings (`Atmosphere.tsx:54`, `Scanner.tsx:9`) · `npm test` **97/97 across
20 files** (was 85) · `npm run test:e2e` **101/101 checks, 2 capture-only** · `scripts/check-first-paint.sh`
both assertions pass · production bundle contains no `__fitz` (dev-only debug surface fully
dead-code-eliminated).

**Placeholder scan:** no `hello@example.com`, no `smtp.fitzgeral.dev`, no `AES-GCM-256`, no PGP claim
survives anywhere in `src/` or `index.html`. `KNOWN_PLACEHOLDERS` contains exactly `["github"]` — the
owner's one deliberate, declared placeholder.

**Assets:** `public/models/` unchanged at 3.6MB. One image added: `public/og.webp`, 1200×630, 21.7KB,
generated from the app's own photo mode. `assets-src/` verified byte-identical before and after every
Blender run (independent per-file sha256 baseline plus the probe's own restore assertion).

### What Part B actually established

Roughly 33 acceptance checks across seven plans had never been confirmed. 24 are now machine-asserted,
9 are scripted for a human in `docs/QA-CHECKLIST.md` (all rows `NOT RUN` — no agent judged them), and
~10 turned out to have no coverage at all and are recorded as such rather than implied.

**The app's claims held up.** The project's longest-standing unverified assertion — zero React renders
during steady flight — measures a commit delta of 0 across 5s of real flight in genuine deep space,
gated on the ship having actually moved. Scope note: the `<Profiler>` wraps the DOM tree, and
`@react-three/fiber` creates its own reconciler root, so canvas-internal commits are covered indirectly
via store-key sameness rather than by the counter. Touch controls were exercised for the first time in
the project's history (14/14 under iPhone emulation). Low-perf gating, wrap-seam radar continuity,
shard fanfare, ram cooldown and asset PBR are all real.

**Every failure encountered during implementation was a defect in this plan, not in the app.** The
notable ones: a meteor check that was always true (opacity is never modulated); a continuity check
reading an axis the ship never travelled; a ram manoeuvre that flew away from its target; a chatter
assertion pointed at a store field that code path never writes; and `flight.{x,y,z}` being write-only
telemetry, which made every planned teleport a silent no-op and would have hollowed out four tasks
before Task 6b introduced a real `__fitz.teleport`.

### Part A

The contact form previously ran a `setInterval` claiming PGP encryption and a dispatch to
`smtp.fitzgeral.dev`, made no network call, and told visitors their message had reached the inbox. It
now really POSTs, with log lines tied to the actual request lifecycle, a 10s abort, verdict-specific
failure copy, and a mailto fallback carrying everything typed. With no key configured it renders a
mailto card *inside the same section wrapper*, so the `#contact` anchor and page layout survive.

**Open:** the one real end-to-end send is unperformed. Web3Forms sits behind Cloudflare bot-protection
that 403s automated browsers; the implementer attempted it, failed at CORS preflight, and correctly
stopped rather than disguising automation to get through. Only a human in an ordinary browser can
confirm delivery.

**Also open, and more consequential than anything in this plan:** `portal_gateway.glb`,
`space_crystal.glb`, `earth.jpg`, `mars.jpg`, `jupiter.jpg` and the spaceship base mesh have no
discoverable provenance or licence (searched all specs, README at every commit, and
`git log --all --diff-filter=A` with vendor keywords). Publishing a CV that ships six unlicensed
third-party assets is a real exposure. Recorded in `assets-src/MANIFEST.md`.
