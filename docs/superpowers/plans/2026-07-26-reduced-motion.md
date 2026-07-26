# Reduced Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Honour `prefers-reduced-motion: reduce` by stopping involuntary motion (camera shake, teleport flash, warp tunnel, chromatic aberration, and all ambient drift) while keeping user-driven flight fully working.

**Architecture:** A single `ambientTime(realElapsed)` helper derives a frozen-aware clock purely from the elapsed time each `useFrame` consumer already receives, so 14 decorative call sites freeze together with no ordering dependency and no R3F `renderPriority` involvement. A store flag mirrors the existing `isLowPerf`/`isMuted` patterns, with an explicit manual choice overriding the OS media query.

**Tech Stack:** React 19, TypeScript 6, Vite 8, three.js 0.185 / @react-three/fiber 9.6, zustand 5, vitest 4, puppeteer-core 25.

**Spec:** `docs/superpowers/specs/2026-07-26-reduced-motion-design.md`

## Global Constraints

- **`prefers-reduced-motion` targets vestibular triggers — unrequested, large-field motion.** User-initiated motion is acceptable and stays. This is the principle every task decision follows.
- **Reduced motion is NOT an alias for low-perf.** `isLowPerf` gates by cost; reduced motion gates by cause. Reduced motion additionally kills the cheap camera shake and teleport flash that low-perf keeps, and must NOT unmount the sun corona that low-perf drops — the corona stays visible and merely stops animating.
- **Never regress the perf wins.** No per-frame React `setState`. The project's core guarantee is zero React commits during steady flight, currently verified at delta=0 by `tests/e2e/perf.probe.mjs`. That check must still report delta=0 — required, not assumed.
- **Flight must keep working.** `Spaceship.tsx` physics, camera, input and collision keep using `delta` and the real clock. If flight breaks, the feature has failed regardless of how calm the scene is.
- **Existing gates stay green:** `npm run build`, `npm run lint` (only the two long-standing pre-existing warnings — `Scanner.tsx:9`, `Atmosphere.tsx:54`), `npm test` (108 tests across 21 files at plan time), `npm run test:e2e` (101 checks, 2 capture-only).
- **`.env` is gitignored and holds a real key.** Never read, print, or commit its contents.
- Commit after every task with a conventional-commit prefix.

## File Structure

**Created:**
- `src/utils/ambientTime.ts` — the frozen-aware clock. One responsibility: turn real elapsed time into ambient elapsed time.
- `src/utils/reducedMotionPreference.ts` — pure precedence resolution (manual choice vs media query). Separate from the store so it is testable without a DOM.
- `src/hooks/useReducedMotion.ts` — syncs the media query into the store and keeps `ambientTime` in step.
- `tests/ambientTime.test.ts`, `tests/reducedMotionPreference.test.ts`
- `tests/e2e/reducedmotion.probe.mjs`

**Modified:**
- `src/store/spaceStore.ts` — `reducedMotion` + `reducedMotionManual` + `setReducedMotion`, persisted.
- `src/App.tsx` — mount the hook; gate the teleport flash.
- `src/components/layout/HUDOverlay.tsx` — the toggle, beside the low-perf button.
- `src/index.css` — `@media (prefers-reduced-motion: reduce)` block plus `[data-reduced-motion="true"]` rules.
- `src/components/canvas/GlobalCanvas.tsx` — star-layer clock; chromatic aberration; unmount `ShootingStars` and `WarpTunnel`.
- `src/components/canvas/Spaceship.tsx` — skip the camera shake offset only.
- Clock conversions: `SpacePlanets.tsx` (3 sites), `AsteroidBelt.tsx`, `Asteroids.tsx`, `Comets.tsx`, `CargoTraffic.tsx`, `SpaceJellyfish.tsx`, `DataShards.tsx`, `CloudLayer.tsx`, `PortalRing.tsx`, `DistantGalaxies.tsx`, `Sun.tsx`.

**Deliberately NOT modified:**
- `Spaceship.tsx:161`'s clock — that is the ship, user-driven.
- `PlasmaAnomalies.tsx:62` — spawned by clicking, so user-initiated; it keeps animating.
- The scanline overlay in `App.tsx` — a static gradient, no animation.

---

## Task 1: The ambient clock

**Files:**
- Create: `src/utils/ambientTime.ts`, `tests/ambientTime.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ambientTime(realElapsed: number): number`, `setAmbientEnabled(enabled: boolean): void`, `resetAmbientTime(): void` (tests only). **Tasks 5, 6 and 7 depend on these exact names.**

- [ ] **Step 1: Write the failing test**

`tests/ambientTime.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { ambientTime, setAmbientEnabled, resetAmbientTime } from "../src/utils/ambientTime";

beforeEach(() => {
  resetAmbientTime();
  setAmbientEnabled(true);
});

describe("ambientTime", () => {
  it("tracks real elapsed time while enabled", () => {
    expect(ambientTime(0)).toBe(0);
    expect(ambientTime(1)).toBe(1);
    expect(ambientTime(2.5)).toBe(2.5);
  });

  it("holds its value exactly while disabled", () => {
    ambientTime(5);
    setAmbientEnabled(false);
    expect(ambientTime(6)).toBe(5);
    expect(ambientTime(90)).toBe(5);
  });

  it("resumes from the held value instead of jumping to real time", () => {
    ambientTime(5);
    setAmbientEnabled(false);
    ambientTime(100); // 95s frozen
    setAmbientEnabled(true);
    // The next advance adds only the delta since the last call, not the frozen gap.
    expect(ambientTime(101)).toBe(6);
  });

  it("returns the same value for repeated calls within one frame", () => {
    ambientTime(3);
    expect(ambientTime(3)).toBe(3);
    expect(ambientTime(3)).toBe(3);
  });

  it("is order-independent across consumers in a frame", () => {
    ambientTime(1);
    const first = ambientTime(2);
    const second = ambientTime(2);
    const third = ambientTime(2);
    expect([second, third]).toEqual([first, first]);
  });

  it("ignores a clock that moves backwards rather than going negative", () => {
    ambientTime(10);
    expect(ambientTime(4)).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ambientTime.test.ts`
Expected: FAIL — cannot resolve `../src/utils/ambientTime`.

- [ ] **Step 3: Write the implementation**

`src/utils/ambientTime.ts`:

```ts
/**
 * Ambient (decorative) elapsed time, which freezes under reduced motion while
 * the real clock keeps running for user-driven flight.
 *
 * Deliberately a pure function of the caller's own elapsed time rather than an
 * accumulator advanced by one privileged component. Controlling `useFrame`
 * order would mean using R3F's `renderPriority`, and any priority > 0 takes
 * over the render loop and obliges manual `gl.render()` calls. Deriving the
 * value from the clock each consumer already has removes the ordering question
 * entirely: the first caller in a frame advances it, later callers in the same
 * frame read the identical value, and no component is special.
 */
let t = 0;
let lastReal: number | null = null;
let enabled = true;

export function setAmbientEnabled(value: boolean): void {
  enabled = value;
}

export function ambientTime(realElapsed: number): number {
  if (lastReal === null) {
    lastReal = realElapsed;
    return t;
  }
  const delta = realElapsed - lastReal;
  lastReal = realElapsed;
  // A backwards or zero delta advances nothing: repeated calls in one frame
  // must agree, and a reset clock must not rewind ambient time.
  if (enabled && delta > 0) t += delta;
  return t;
}

/** Test-only: restore module state between cases. */
export function resetAmbientTime(): void {
  t = 0;
  lastReal = null;
  enabled = true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ambientTime.test.ts`
Expected: PASS (6 tests).

Note the first-call behaviour: the very first `ambientTime(x)` returns 0 and seeds `lastReal`, so a non-zero starting clock does not produce a jump. The test's first case relies on this (`ambientTime(0)` → 0, then `ambientTime(1)` → 1).

- [ ] **Step 5: Full unit suite and commit**

Run: `npm test` — expected 114 tests (108 + 6).

```bash
git add src/utils/ambientTime.ts tests/ambientTime.test.ts
git commit -m "feat: ambientTime — decorative clock that freezes under reduced motion

Pure function of the caller's own elapsed time, so 14 decorative call sites can
freeze together without any useFrame ordering dependency. Avoids R3F's
renderPriority, where any priority > 0 takes over the render loop."
```

---

## Task 2: Preference precedence and store flag

**Files:**
- Create: `src/utils/reducedMotionPreference.ts`, `tests/reducedMotionPreference.test.ts`
- Modify: `src/store/spaceStore.ts`

**Interfaces:**
- Consumes: `setAmbientEnabled` from Task 1.
- Produces: `resolveReducedMotion(stored: boolean | null, queryMatches: boolean): boolean`; store fields `reducedMotion: boolean`, `reducedMotionManual: boolean`, and action `setReducedMotion(v: boolean, manual?: boolean): void`. **Tasks 3, 4, 5, 6, 7 and 8 depend on these names.**

- [ ] **Step 1: Write the failing test**

`tests/reducedMotionPreference.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveReducedMotion } from "../src/utils/reducedMotionPreference";

describe("resolveReducedMotion", () => {
  it("defers to the media query when nothing is stored", () => {
    expect(resolveReducedMotion(null, true)).toBe(true);
    expect(resolveReducedMotion(null, false)).toBe(false);
  });

  it("lets a stored choice override the media query in both directions", () => {
    // Someone who set the OS flag for battery but wants the full show.
    expect(resolveReducedMotion(false, true)).toBe(false);
    // Someone who wants calm without changing system settings.
    expect(resolveReducedMotion(true, false)).toBe(true);
  });

  it("agrees with the query when the stored choice matches it", () => {
    expect(resolveReducedMotion(true, true)).toBe(true);
    expect(resolveReducedMotion(false, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/reducedMotionPreference.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the pure resolver**

`src/utils/reducedMotionPreference.ts`:

```ts
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const REDUCED_MOTION_KEY = "fitz-reduced-motion";

/**
 * An explicit choice always wins over the OS signal, which is blunt: it is set
 * for battery and mild preference as often as for a vestibular condition.
 * `null` means the visitor has not chosen, so the query decides.
 */
export function resolveReducedMotion(stored: boolean | null, queryMatches: boolean): boolean {
  return stored ?? queryMatches;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/reducedMotionPreference.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the store flag**

In `src/store/spaceStore.ts`, beside the existing `safeGetMuted`/`safeSetMuted` helpers (lines ~12-26), add persistence for the manual choice. It stores three states — `"1"`, `"0"`, or absent — because absent must remain distinguishable from an explicit `false`:

```ts
function safeGetReducedMotion(): boolean | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(REDUCED_MOTION_KEY);
    return raw === null ? null : raw === "1";
  } catch {
    return null;
  }
}
function safeSetReducedMotion(v: boolean) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(REDUCED_MOTION_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}
```

Import `REDUCED_MOTION_KEY` from `../utils/reducedMotionPreference` and `setAmbientEnabled` from `../utils/ambientTime`.

Add to the `SpaceState` interface:

```ts
  reducedMotion: boolean;
  reducedMotionManual: boolean;
  setReducedMotion: (v: boolean, manual?: boolean) => void;
```

Add to the initial state — seeded from a stored choice if there is one, otherwise `false` (the hook in Task 3 applies the live query on mount). Read storage **once** into a module-level const above `create()`, rather than calling the helper twice, so the two fields cannot disagree:

```ts
const storedReducedMotion = safeGetReducedMotion();
```
```ts
    reducedMotion: storedReducedMotion ?? false,
    reducedMotionManual: storedReducedMotion !== null,
```

Add the action beside `setLowPerf`:

```ts
    setReducedMotion: (v, manual = false) => {
      if (manual) safeSetReducedMotion(v);
      // Ambient motion is the inverse of reduced motion.
      setAmbientEnabled(!v);
      set((s) => ({ reducedMotion: v, reducedMotionManual: s.reducedMotionManual || manual }));
    },
```

- [ ] **Step 6: Extend the store's own test reset**

`tests/spaceStore.test.ts`'s `beforeEach` resets every field explicitly. Add the two new ones so its cases stay isolated:

```ts
    reducedMotion: false, reducedMotionManual: false,
```

- [ ] **Step 7: Gates and commit**

Run: `npm test` — expected 117 tests (114 + 3). Then `npm run build && npm run lint`.

```bash
git add src/utils/reducedMotionPreference.ts tests/reducedMotionPreference.test.ts src/store/spaceStore.ts tests/spaceStore.test.ts
git commit -m "feat: reducedMotion store flag with manual override of the OS signal

An explicit choice persists and beats the media query in both directions, since
prefers-reduced-motion is set for battery as often as for vestibular need.
Stored as three states so 'unset' stays distinguishable from an explicit false."
```

---

## Task 3: Sync hook, CSS, and the HUD toggle

**Files:**
- Create: `src/hooks/useReducedMotion.ts`
- Modify: `src/App.tsx`, `src/index.css`, `src/components/layout/HUDOverlay.tsx`

**Interfaces:**
- Consumes: `resolveReducedMotion`, `REDUCED_MOTION_QUERY` (Task 2); the store's `reducedMotion` / `setReducedMotion` (Task 2).
- Produces: `useReducedMotion(): void` — mounted once in `App`. Sets `data-reduced-motion` on `<html>`. **Task 8's probe asserts that attribute.**

- [ ] **Step 1: Write the hook**

`src/hooks/useReducedMotion.ts`:

```tsx
import { useEffect } from "react";
import { useMediaQuery } from "./useMediaQuery";
import { useSpaceStore } from "../store/spaceStore";
import { resolveReducedMotion, REDUCED_MOTION_QUERY } from "../utils/reducedMotionPreference";

/**
 * Mount once in App. Keeps the store in step with the OS setting (which people
 * do toggle mid-session) unless the visitor has made an explicit choice, and
 * mirrors the result onto <html> so CSS rules can key off the manual toggle —
 * something a bare media query cannot do.
 */
export function useReducedMotion(): void {
  const queryMatches = useMediaQuery(REDUCED_MOTION_QUERY);
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const manual = useSpaceStore((s) => s.reducedMotionManual);
  const setReducedMotion = useSpaceStore((s) => s.setReducedMotion);

  useEffect(() => {
    if (manual) return; // an explicit choice wins
    const next = resolveReducedMotion(null, queryMatches);
    if (next !== useSpaceStore.getState().reducedMotion) setReducedMotion(next);
  }, [queryMatches, manual, setReducedMotion]);

  useEffect(() => {
    document.documentElement.setAttribute("data-reduced-motion", reducedMotion ? "true" : "false");
  }, [reducedMotion]);
}
```

- [ ] **Step 2: Mount it in App**

In `src/App.tsx`, beside the existing `useKeyboardInput()` / `useSound()` calls, add the import and the call:

```tsx
import { useReducedMotion } from "./hooks/useReducedMotion";
```
```tsx
  useReducedMotion();
```

- [ ] **Step 3: Gate the teleport flash**

`src/App.tsx:53` renders a full-screen 0.85-opacity flash on every toroidal wrap — an involuntary jolt. Read the flag and require it to be off. Add the selector beside the other `useSpaceStore` reads:

```tsx
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
```

and change the condition from `{isTeleporting && (` to:

```tsx
        {isTeleporting && !reducedMotion && (
```

Wrapping itself still happens; only the flash is suppressed.

- [ ] **Step 4: Add the CSS**

Append to `src/index.css`. Both selectors carry the same rules so the manual toggle works too:

```css
/* Reduced motion: neutralise decorative CSS animation and transitions.
   Motion the visitor initiates (flight) is driven by WebGL, not CSS, and is
   unaffected by either rule below.

   The media query covers the OS signal — including the window before React
   hydrates and can set the attribute — but excludes an explicit opt-out.
   The attribute rule covers the in-app toggle, which a media query cannot see. */
@media (prefers-reduced-motion: reduce) {
  :root:not([data-reduced-motion="false"]) *,
  :root:not([data-reduced-motion="false"]) *::before,
  :root:not([data-reduced-motion="false"]) *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

:root[data-reduced-motion="true"] *,
:root[data-reduced-motion="true"] *::before,
:root[data-reduced-motion="true"] *::after {
  animation-duration: 0.01ms !important;
  animation-iteration-count: 1 !important;
  transition-duration: 0.01ms !important;
  scroll-behavior: auto !important;
}
```

**Why `0.01ms` rather than `none`:** animations that rely on a completion event still fire, so nothing waits forever for a transition that never runs. This is the standard approach.

**Why the opt-out is a `:not()` exclusion rather than a third block that re-enables motion.** The obvious-looking inverse — a `[data-reduced-motion="false"]` block setting `animation-duration: revert !important` — is **wrong**. `revert` rolls a property back to the previous cascade origin, which for an author stylesheet means the user-agent value, so it would delete Tailwind's animation durations rather than restore them. Excluding the opt-out from the media query in the first place is the only correct shape: nothing to undo.

- [ ] **Step 5: Add the HUD toggle**

In `src/components/layout/HUDOverlay.tsx`, the low-perf button at line ~109 sits in a `flex gap-2` row — add a sibling. Read the state beside the existing selectors:

```tsx
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const setReducedMotion = useSpaceStore((s) => s.setReducedMotion);
```

and add the button immediately after the low-perf one, matching its shape (`Zap`/`ZapOff` come from `lucide-react`, which the file already imports from):

```tsx
        <button
          data-testid="hud-reduced-motion"
          onClick={() => setReducedMotion(!reducedMotion, true)}
          title="Freeze ambient motion; flight still works"
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all duration-300 ${
            reducedMotion ? "border-amber-400/25 bg-amber-400/5 text-amber-300"
              : "border-white/5 bg-white/2 text-white/50 hover:text-primary hover:border-primary/20"}`}>
          {reducedMotion ? <ZapOff className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
          <span>{reducedMotion ? "MOTION_OFF" : "REDUCE_MOTION"}</span>
        </button>
```

Add `Zap, ZapOff` to the existing `lucide-react` import.

- [ ] **Step 6: Verify by hand**

Run `npm run dev`. Confirm: the HUD button toggles, `<html data-reduced-motion>` flips in devtools, and the `animate-pulse` elements stop pulsing when it is on. Then in devtools' Rendering panel set `prefers-reduced-motion: reduce` and confirm the flag turns on by itself with no stored choice, and that clicking the toggle off keeps it off (manual wins).

- [ ] **Step 7: Gates and commit**

Run: `npm run build && npm run lint && npm test` — 117 tests, no new lint warnings.

```bash
git add src/hooks/useReducedMotion.ts src/App.tsx src/index.css src/components/layout/HUDOverlay.tsx
git commit -m "feat: reduced-motion sync hook, CSS neutralisation, HUD toggle

Mirrors the flag onto <html data-reduced-motion> so CSS keys off the in-app
toggle too, which a bare media query cannot. Suppresses the full-screen
teleport flash on wrap; wrapping itself is unchanged."
```

---

## Task 4: Tier 1 — the involuntary jolts

**Files:**
- Modify: `src/components/canvas/Spaceship.tsx:404-406`, `src/components/canvas/GlobalCanvas.tsx:242,278`

**Interfaces:**
- Consumes: the store's `reducedMotion` (Task 2).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Skip the camera shake**

`Spaceship.tsx:404-406` offsets the camera by a random jitter after an impact. The impact itself at `:303` must keep firing — sound, HUD counter and chatter are feedback, not vestibular triggers. Only the camera offset goes.

This is inside `useFrame`, so read via `getState()` rather than a selector — a subscription here would put the flag in the hottest component in the app:

```tsx
    if (shake.current > 0.001 && !useSpaceStore.getState().reducedMotion) {
      state.camera.position.x += (Math.random() - 0.5) * shake.current;
      state.camera.position.y += (Math.random() - 0.5) * shake.current;
```

Leave the decay of `shake.current` itself outside the new condition, so the value still winds down normally and toggling mid-shake cannot leave it stuck.

- [ ] **Step 2: Pin chromatic aberration and unmount the warp tunnel**

In `GlobalCanvas.tsx`, add the selector beside `isLowPerf`:

```tsx
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
```

Line ~242 — the tunnel is a full-field motion effect:

```tsx
          {!isLowPerf && !reducedMotion && <WarpTunnel />}
```

Line ~278 — pin the offset so boosting adds no distortion:

```tsx
                  <ChromaticAberration key="ca" offset={isWarping && !reducedMotion ? [0.0022, 0.0014] : [0, 0]} />,
```

- [ ] **Step 3: Verify by hand**

Run `npm run dev`, turn the HUD toggle on, then: boost (no tunnel, no colour fringing), and ram a scenery asteroid — confirm the HUD impact counter still increments and the thud still plays while the camera stays steady.

- [ ] **Step 4: Gates and commit**

Run: `npm run build && npm run lint && npm test`

```bash
git add src/components/canvas/Spaceship.tsx src/components/canvas/GlobalCanvas.tsx
git commit -m "feat: reduced motion suppresses camera shake, warp tunnel, chromatic aberration

Impacts still register — sound, counter and chatter are feedback, not vestibular
triggers. Only the camera jolt goes. Shake decay stays outside the condition so
toggling mid-shake cannot leave it stuck."
```

---

## Task 5: Tier 2a — freeze the sky

**Files:**
- Modify: `src/components/canvas/GlobalCanvas.tsx:61`, `Sun.tsx:83`, `CloudLayer.tsx:48`, `PortalRing.tsx:26`, `DistantGalaxies.tsx:56`

**Interfaces:**
- Consumes: `ambientTime` from Task 1.
- Produces: nothing consumed downstream.

Each edit is the same shape: import the helper and replace the clock read. Add to each file:

```tsx
import { ambientTime } from "../../utils/ambientTime";
```

- [ ] **Step 1: Convert the five call sites**

`GlobalCanvas.tsx:61` (star-shell rotation and twinkle):
```tsx
    const time = ambientTime(state.clock.getElapsedTime());
```

`Sun.tsx:83` (corona shader time and flare drift) — note the corona stays *mounted*; only its animation stops, unlike low-perf which unmounts it:
```tsx
    const t = ambientTime(state.clock.getElapsedTime());
```

`CloudLayer.tsx:48`:
```tsx
    if (ref.current) ref.current.rotation.y = ambientTime(state.clock.getElapsedTime()) * speed;
```

`PortalRing.tsx:26`:
```tsx
    const time = ambientTime(state.clock.getElapsedTime());
```

`DistantGalaxies.tsx:56`:
```tsx
    const t = ambientTime(state.clock.getElapsedTime());
```

- [ ] **Step 2: Verify by hand**

Run `npm run dev`, toggle reduced motion on, and confirm the starfield stops rotating, the corona stops churning but is still visible, cloud layers stop turning, and the portal ring stops swirling. Fly — the ship still moves.

- [ ] **Step 3: Gates and commit**

Run: `npm run build && npm run lint && npm test`

```bash
git add src/components/canvas/GlobalCanvas.tsx src/components/canvas/Sun.tsx src/components/canvas/CloudLayer.tsx src/components/canvas/PortalRing.tsx src/components/canvas/DistantGalaxies.tsx
git commit -m "feat: freeze sky ambient motion under reduced motion

Star shells, sun corona, cloud layers, portal ring and distant galaxies now read
ambientTime. The corona stays mounted and merely stops animating — expensive is
not the same as jarring, which is where this differs from low-perf."
```

---

## Task 6: Tier 2b — freeze the bodies and traffic

**Files:**
- Modify: `src/components/canvas/SpacePlanets.tsx:104,181,254`, `AsteroidBelt.tsx:58`, `Asteroids.tsx:62`, `Comets.tsx:154`, `CargoTraffic.tsx:72`, `SpaceJellyfish.tsx:134`, `DataShards.tsx:44`

**Interfaces:**
- Consumes: `ambientTime` from Task 1.
- Produces: nothing consumed downstream.

**The most consequential edit in the plan is `SpacePlanets.tsx:254`.** Line 258 (`orbitPosition(p.orbit, time)`) is the single writer of the shared `bodies` telemetry, so freezing that clock freezes the whole solar system. That is the spec's decision: `bodies` simply stops changing, and orbit-lock, radar, scan and the HUD keep reading it exactly as before.

- [ ] **Step 1: Convert the nine call sites**

Add `import { ambientTime } from "../../utils/ambientTime";` to each file, then replace each clock read (the local variable name differs per file — keep whatever is already there):

- `SpacePlanets.tsx:104` — nebula particle swirl and hue drift: `const time = ambientTime(state.clock.getElapsedTime());`
- `SpacePlanets.tsx:181` — orbit-ring rotation and planet spin: `const t = ambientTime(state.clock.getElapsedTime());`
- `SpacePlanets.tsx:254` — the orbit drive: `const time = ambientTime(state.clock.getElapsedTime());`
- `AsteroidBelt.tsx:58` — belt rotation: `const t = ambientTime(state.clock.getElapsedTime());`
- `Asteroids.tsx:62` — scenery tumble: `const time = ambientTime(state.clock.getElapsedTime());`
- `Comets.tsx:154` — comet travel and tails: `const time = ambientTime(state.clock.getElapsedTime());`
- `CargoTraffic.tsx:72` — traffic along splines: `const time = ambientTime(state.clock.getElapsedTime());`
- `SpaceJellyfish.tsx:134` — undulation and drift: `const time = ambientTime(state.clock.getElapsedTime());`
- `DataShards.tsx:44` — shard bob and spin: `const t = ambientTime(state.clock.getElapsedTime());`

**`DataShards` needs care.** `t` drives the bob offset, and the same loop's proximity check at line ~74 measures distance to the *bobbed* position. Freezing `t` parks each shard at a fixed offset, which is correct — but **do not move the proximity check or `collectShard` behind any condition.** Collection must keep working with reduced motion on; Task 8's probe does not cover it, so a mistake here would be caught only by the existing `gameplay` probe.

- [ ] **Step 2: Confirm the untouched sites really are untouched**

Run:

```bash
grep -n 'getElapsedTime()' src/components/canvas/Spaceship.tsx src/components/canvas/PlasmaAnomalies.tsx
```

Expected: `Spaceship.tsx:161` and `PlasmaAnomalies.tsx:62` both still read the clock **directly**, with no `ambientTime`. The ship is user-driven; plasma is spawned by clicking. Freezing either would break the spec's principle.

- [ ] **Step 3: Verify by hand — including that flight and lock still work**

Run `npm run dev`, toggle reduced motion on, then:
- Planets, belt, asteroids, comets, cargo and jellyfish all stop moving.
- Fly to a planet and confirm orbit lock still engages and the dossier opens.
- Confirm the radar still shows blips at the (now static) planet positions.
- Fly into a shard and confirm it is still collected and the counter increments.

- [ ] **Step 4: Gates and commit**

Run: `npm run build && npm run lint && npm test`

```bash
git add src/components/canvas
git commit -m "feat: freeze orbits, belt, traffic and creatures under reduced motion

SpacePlanets' orbit drive is the single writer of shared body telemetry, so
freezing its clock freezes the solar system; bodies simply stops changing and
orbit-lock, radar and scan keep reading it unchanged. Shard bob freezes while
collection keeps working."
```

---

## Task 7: Unmount shooting stars

**Files:**
- Modify: `src/components/canvas/GlobalCanvas.tsx:239`

**Interfaces:**
- Consumes: the store's `reducedMotion` (Task 2); the selector added in Task 4.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Unmount rather than freeze**

A frozen meteor is a bright streak stuck mid-flight — an artifact, not calm. So unlike the Tier 2 components, `ShootingStars` is removed entirely, as low-perf already does:

```tsx
          {!isLowPerf && !reducedMotion && <ShootingStars />}
```

- [ ] **Step 2: Verify no stuck streak**

Run `npm run dev`. Watch until a meteor appears (they spawn on a random interval, typically within 30s), then toggle reduced motion on mid-streak and confirm no frozen line remains on screen.

- [ ] **Step 3: Gates and commit**

Run: `npm run build && npm run lint && npm test`

```bash
git add src/components/canvas/GlobalCanvas.tsx
git commit -m "feat: unmount shooting stars under reduced motion

Unmounted rather than frozen: a meteor stopped mid-streak is a bright artifact
stuck on screen, which is not calm."
```

---

## Task 8: The e2e probe

**Files:**
- Create: `tests/e2e/reducedmotion.probe.mjs`
- Modify: `tests/e2e/run.mjs` (add `"reducedmotion"` to the default list)

**Interfaces:**
- Consumes: `withPage`, `hold`, `settle`, `readStore`, `sceneQuery` from `harness.mjs`; `window.__fitz` (store, flight, scene, teleport).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Write the probe**

`tests/e2e/reducedmotion.probe.mjs`:

```js
import { withPage, hold, settle, readStore, sceneQuery } from "./harness.mjs";

/** Emulates the OS preference, so this exercises the real media-query path. */
export default async function run() {
  return withPage({ label: "reducedmotion", emulateReducedMotion: true }, async (page, checks) => {
    const s = await readStore(page);
    checks.check("store picks up the emulated OS preference", s.reducedMotion === true,
      `reducedMotion=${s.reducedMotion}`);

    const attr = await page.evaluate(() =>
      document.documentElement.getAttribute("data-reduced-motion"));
    checks.check("html carries data-reduced-motion=true", attr === "true", `attr=${attr}`);

    // Decorative components are gone.
    for (const name of ["WarpTunnel"]) {
      const o = await sceneQuery(page, name);
      checks.check(`${name} is unmounted`, !o.found);
    }

    // Ambient motion is frozen. Asserted through an observable effect — the
    // cloud layer's rotation — rather than by calling ambientTime() from the
    // probe. Vite serves the app one module instance, so a probe call would
    // ADVANCE the very clock it is measuring, and with `performance.now()` as
    // its argument it would also corrupt `lastReal` for the real consumers.
    const rot0 = await sceneQuery(page, "CloudLayer");
    await settle(page, 2000);
    const rot1 = await sceneQuery(page, "CloudLayer");
    checks.check("cloud layer rotation is frozen",
      rot0.found && rot1.found && Math.abs(rot1.rotation.y - rot0.rotation.y) < 1e-6,
      `y ${rot0.rotation?.y} -> ${rot1.rotation?.y}`);

    // Orbits are frozen: a body's position must not change.
    const p0 = await page.evaluate(() => ({ ...window.__fitz.bodies.saas }));
    await settle(page, 2000);
    const p1 = await page.evaluate(() => ({ ...window.__fitz.bodies.saas }));
    const moved = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
    checks.check("planet orbit is frozen", moved < 0.01, `moved ${moved.toFixed(4)}`);

    // THE CHECK THAT MATTERS MOST: flight still works.
    const before = await page.evaluate(() => ({ ...window.__fitz.flight }));
    await hold(page, ["KeyW"], 3000);
    const after = await page.evaluate(() => ({ ...window.__fitz.flight }));
    const flew = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    checks.check("flight still works with reduced motion on", flew > 5, `displaced ${flew.toFixed(2)}`);

    // Impacts still register, but the camera must not be shaken.
    const target = await page.evaluate(async () => {
      const { ASTEROID_COLLIDERS } = await import("/src/data/asteroids.ts");
      return ASTEROID_COLLIDERS[0];
    });
    await page.evaluate((t) => window.__fitz.teleport(t.x, t.y, t.z - t.r - 2), target);
    await settle(page, 800);

    // Sample the camera across consecutive frames DURING the ram. The shake is
    // a per-frame random jitter, so with it suppressed the camera's offset from
    // its smoothed chase position must not jump frame to frame.
    const impactsBefore = (await readStore(page)).impactCount;
    const ramSamples = await page.evaluate(async () => {
      const out = [];
      for (let i = 0; i < 30; i++) {
        const c = window.__fitz.camera;
        out.push({ x: c.position.x, y: c.position.y });
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return out;
    });
    await hold(page, ["KeyW"], 2500);
    const impactsAfter = (await readStore(page)).impactCount;
    checks.check("ramming still registers an impact", impactsAfter > impactsBefore,
      `${impactsBefore} -> ${impactsAfter}`);

    // Shake is ±0.25 per axis per frame at its peak, so a suppressed shake keeps
    // consecutive-frame deltas far below that. The chase camera itself eases
    // smoothly, so 0.1 separates "eased" from "jittered".
    const maxJump = ramSamples.slice(1).reduce((m, s, i) => {
      const p = ramSamples[i];
      return Math.max(m, Math.abs(s.x - p.x), Math.abs(s.y - p.y));
    }, 0);
    checks.check("camera is not shaken while reduced motion is on", maxJump < 0.1,
      `max consecutive-frame camera jump ${maxJump.toFixed(4)}`);

    // The teleport flash element must never appear on a wrap.
    const flashSeen = await page.evaluate(async () => {
      let seen = false;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (window.__fitz.store.getState().isTeleporting) {
          // The store flag may fire; the overlay must not render.
          if (document.querySelector(".backdrop-blur-\\[3px\\]")) seen = true;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return seen;
    });
    checks.check("no teleport flash overlay rendered", flashSeen === false);
  });
}
```

- [ ] **Step 2: Add emulation support to the harness**

`withPage` does not yet know about this option. In `tests/e2e/harness.mjs`, inside `withPage` after the device/viewport setup and **before** `page.goto` (the preference must be in effect for the first render):

```js
    if (opts.emulateReducedMotion) {
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    }
```

Destructure `emulateReducedMotion` alongside `label`, `device` and `viewport`, and note it in `withPage`'s JSDoc.

- [ ] **Step 3: Run it**

Run: `SCRATCH=/private/tmp/claude-502/-Users-fitzgeral-Kerja-proj-fitz/15c0a375-87d0-4797-bc59-e4e30e1dcf96/scratchpad npm run test:e2e reducedmotion`

Expected: all checks pass. Two need groundwork or may need adjustment — **adapt the mechanism, never the claim**:

- **`window.__fitz.camera` does not exist yet.** The debug bridge exposes `scene` and `gl` but not the camera, and R3F's default camera is not reliably a scene child, so it cannot be found by traversal. Add it: `src/debug/bridge.ts` gains `camera: THREE.Camera | null` (initialised `null`) and `src/debug/DebugBridge.tsx` publishes it from the `useThree` selector it already uses for `scene`/`gl`. This is one line in each, matches the established dev-only pattern exactly, and is dead-code-eliminated from production like the rest — Final Verification Step 2 re-checks that.
- The flash selector is brittle (a Tailwind arbitrary-value class). If it does not match, add `data-testid="teleport-flash"` to the flash element in `App.tsx` and select on that — an inert production change, mirroring the `data-testid` attributes already established in `TouchControls.tsx`. Prefer that over a cleverer selector.

- [ ] **Step 4: Confirm the default suite is unaffected**

Run: `npm run test:e2e`
Expected: the previous 101 checks still pass, plus this probe's. **`perf.probe.mjs` must still report `commits=0`** — if it does not, a selector subscription landed in a hot component and that is a real regression, not a flake.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/reducedmotion.probe.mjs tests/e2e/run.mjs tests/e2e/harness.mjs
git commit -m "test: reduced-motion probe under emulated OS preference

Asserts ambient time frozen, orbits static, warp tunnel unmounted, no teleport
flash — and, most importantly, that flight still works, which is the check that
proves the premise was not broken."
```

---

## Final verification

- [ ] **Step 1: Full gate run**

```bash
npm run build && npm run lint && npm test && npm run test:e2e
```

Expected: build clean (chunk-size advisory only); lint shows only `Scanner.tsx:9` and `Atmosphere.tsx:54`; 117 unit tests; e2e green with `perf` still at `commits=0`.

- [ ] **Step 2: Confirm nothing dev-only leaked**

```bash
npm run build && ! grep -rq '__fitz' dist/assets/*.js && echo "OK: production bundle clean"
```

- [ ] **Step 3: Confirm the untouched-by-design sites**

```bash
grep -c 'ambientTime' src/components/canvas/Spaceship.tsx src/components/canvas/PlasmaAnomalies.tsx
```

Expected: `0` for both. The ship and the click-spawned plasma must still use the real clock.

- [ ] **Step 4: Append a verification record to this plan and commit**

Record: gate outcomes, the probe's check count, what was verified by hand, and any check adapted during Task 8 with its reasoning.

---

## Self-review notes

**Spec coverage.** Principle → Global Constraints. §1 architecture → Task 1. §2 Tier 1 → Task 4 (plus the teleport flash in Task 3 Step 3, since it lives in `App.tsx` alongside the hook mount). §2 Tier 2 → Tasks 5 and 6; `ShootingStars` → Task 7; `PlasmaAnomalies` exemption → Task 6 Step 2. §2 Tier 3 CSS → Task 3 Step 4. §3 precedence → Task 2; HUD toggle → Task 3 Step 5. §4 perf guarantee → Task 4 Step 1 (`getState()` in the frame loop) and Task 8 Step 4 (the delta=0 check). §5 edge cases → Task 2's three-state persistence and Task 1's backwards-clock test. §6 testing → Tasks 1, 2, 8. §7/§8 → the "Deliberately NOT modified" list and Final Verification Step 3.

**Known risks, stated rather than hidden.** Task 8's camera-shake and flash-overlay assertions are the two least certain in the plan; both carry explicit instructions to adapt the mechanism without weakening the claim, and to prefer an inert `data-testid` over any production debug hook. Task 6's `SpacePlanets.tsx:254` edit is the highest-consequence single line, since it freezes the shared body telemetry that orbit-lock, radar and scan all read.

**Ordering.** Task 1 before 5, 6 (they import `ambientTime`). Task 2 before 3, 4, 7, 8 (they read the store flag). Task 4 adds the `reducedMotion` selector in `GlobalCanvas` that Task 7 reuses — if executed out of order, Task 7 must add it itself.
