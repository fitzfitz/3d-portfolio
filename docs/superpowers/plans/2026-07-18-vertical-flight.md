# Vertical Flight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Additive 3D navigation — WASD/arrows unchanged, Space=ascend, C/X=descend, Shift=warp — with 3D orbit-lock distances, auto-level, soft altitude bounds, radar altitude bar, and touch RISE/DIVE buttons.

**Architecture:** Vertical motion is a pure, unit-tested step function (`verticalStep`) called from Spaceship's frame loop; proximity goes 3D via `toroidalDistance3`; the altitude advisory reuses the guarded-flag→chatter pattern. Zero per-frame React state, delta-time throughout.

**Tech Stack:** React 19, TS, @react-three/fiber 9, zustand, vitest.

## Global Constraints

- Controls (additive scheme): W/↑ forward, S/↓ brake, A/D/←/→ turn — UNCHANGED. Space=ascend (was warp), KeyC and KeyX=descend, ShiftLeft/ShiftRight=warp.
- Keyboard listener ignores events targeting input/textarea/contentEditable (same guard as KeyJ).
- Vertical: accel 14 u/s², cap 7 u/s, idle decay `pow(0.94, dt*60)`, auto-level factor `pow(0.7, dt)` toward y=0 (only when no vertical key AND no activeZone), soft bound ±55 with a 10-unit slow-down band, never a hard pop.
- Orbit-lock/portal/spawn checks use 3D distance (toroidal xz + Δy).
- Zero per-frame React setState; guarded setter for `altitudeWarn` (|y| > 48).
- Every commit ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Gates per task: `npm run build && npm run lint && npm test`.
- Spec: `docs/superpowers/specs/2026-07-18-vertical-flight-design.md`.

## File Structure

- Create: `src/utils/verticalFlight.ts`, `tests/verticalFlight.test.ts`, `tests/toroidal3.test.ts`
- Modify: `src/utils/toroidal.ts`, `src/store/spaceStore.ts`, `src/hooks/useKeyboardInput.ts`, `src/utils/chatterScheduler.ts`, `src/data/chatterLines.ts`, `src/components/canvas/Spaceship.tsx`, `src/components/canvas/SpacePlanets.tsx`, `src/components/layout/RadarMap.tsx`, `src/components/layout/HUDOverlay.tsx`, `src/components/layout/RadioChatter.tsx`, `src/components/layout/TouchControls.tsx`
- Tests extended: `tests/chatterScheduler.test.ts`, `tests/spaceStore.test.ts`

---

### Task 1: Foundations (TDD) — verticalStep, toroidalDistance3, input remap, altitude flag

**Files:**
- Create: `src/utils/verticalFlight.ts`, `tests/verticalFlight.test.ts`, `tests/toroidal3.test.ts`
- Modify: `src/utils/toroidal.ts`, `src/store/spaceStore.ts`, `src/hooks/useKeyboardInput.ts`, `src/utils/chatterScheduler.ts`, `src/data/chatterLines.ts`
- Test: extend `tests/chatterScheduler.test.ts`, `tests/spaceStore.test.ts`

**Interfaces (later tasks import these exact names):**
- `verticalStep(y: number, vy: number, input: { ascend: boolean; descend: boolean; autoLevel: boolean }, dt: number): { y: number; vy: number }` + exported constants `V_ACCEL=14, V_MAX=7, V_CEIL=55, V_SOFT=10`
- `toroidalDistance3(ax, az, ay, bx, bz, by, bounds): number`
- `FlightInput` += `ascend: boolean; descend: boolean`; `flight.y: number` (init 0)
- Store: `altitudeWarn: boolean` + guarded `setAltitudeWarn(v)`
- `ChatterPools.altitude: string[]`; `ChatterKind` += `"altitude"`

- [ ] **Step 1: Write failing tests**

`tests/verticalFlight.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { verticalStep, V_MAX, V_CEIL } from "../src/utils/verticalFlight";

const idle = { ascend: false, descend: false, autoLevel: false };

describe("verticalStep", () => {
  it("ascend accelerates upward", () => {
    const r = verticalStep(0, 0, { ...idle, ascend: true }, 0.1);
    expect(r.vy).toBeGreaterThan(0);
    expect(r.y).toBeGreaterThan(0);
  });
  it("vertical speed is capped at V_MAX", () => {
    let s = { y: 0, vy: 0 };
    for (let i = 0; i < 100; i++) s = verticalStep(s.y, s.vy, { ...idle, ascend: true }, 0.05);
    expect(s.vy).toBeLessThanOrEqual(V_MAX + 1e-9);
  });
  it("idle decays vertical speed", () => {
    const r = verticalStep(10, 5, idle, 0.1);
    expect(r.vy).toBeLessThan(5);
    expect(r.vy).toBeGreaterThan(0);
  });
  it("autoLevel eases y toward 0 when no keys held", () => {
    const r = verticalStep(20, 0, { ...idle, autoLevel: true }, 1);
    expect(r.y).toBeLessThan(20);
    expect(r.y).toBeGreaterThan(0);
  });
  it("autoLevel does nothing while a key is held", () => {
    const r = verticalStep(20, 0, { ascend: true, descend: false, autoLevel: true }, 0.1);
    expect(r.y).toBeGreaterThanOrEqual(20);
  });
  it("soft ceiling: y never exceeds V_CEIL even under sustained ascend", () => {
    let s = { y: 50, vy: V_MAX };
    for (let i = 0; i < 300; i++) s = verticalStep(s.y, s.vy, { ...idle, ascend: true }, 0.05);
    expect(s.y).toBeLessThanOrEqual(V_CEIL);
  });
  it("soft floor mirrors the ceiling", () => {
    let s = { y: -50, vy: -V_MAX };
    for (let i = 0; i < 300; i++) s = verticalStep(s.y, s.vy, { ...idle, descend: true }, 0.05);
    expect(s.y).toBeGreaterThanOrEqual(-V_CEIL);
  });
});
```

`tests/toroidal3.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toroidalDistance3 } from "../src/utils/toroidal";

describe("toroidalDistance3", () => {
  it("equals planar distance when heights match", () => {
    expect(toroidalDistance3(0, 0, 5, 3, 4, 5, 250)).toBeCloseTo(5);
  });
  it("includes the vertical component", () => {
    expect(toroidalDistance3(0, 0, 0, 3, 4, 12, 250)).toBeCloseTo(13);
  });
  it("wraps horizontally like toroidalDistance", () => {
    expect(toroidalDistance3(-245, 0, 0, 245, 0, 0, 250)).toBeCloseTo(10);
  });
});
```

Extend `tests/chatterScheduler.test.ts` (add `altitude: ["alt-1", "alt-2"]` to the fixture pools):
```ts
  it("picks from the altitude pool", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("altitude")).toBe("alt-1");
  });
```
Extend `tests/spaceStore.test.ts` (add `altitudeWarn: false` to beforeEach):
```ts
  it("setAltitudeWarn does not notify subscribers for identical values", () => {
    const spy = vi.fn();
    const unsub = useSpaceStore.subscribe(spy);
    useSpaceStore.getState().setAltitudeWarn(false);
    expect(spy).not.toHaveBeenCalled();
    useSpaceStore.getState().setAltitudeWarn(true);
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
  });
```

Run `npm test` → FAIL (missing modules/members).

- [ ] **Step 2: Implement `src/utils/verticalFlight.ts`**

```ts
export const V_ACCEL = 14; // u/s^2 while a vertical key is held
export const V_MAX = 7;    // u/s vertical speed cap
export const V_CEIL = 55;  // absolute altitude bound
export const V_SOFT = 10;  // width of the slow-down band below the bound

export interface VerticalInput {
  ascend: boolean;
  descend: boolean;
  /** true when no vertical key is held AND the ship is outside any gravity zone */
  autoLevel: boolean;
}

/** Pure vertical-motion step: acceleration, cap, idle decay, auto-level, soft bounds. */
export function verticalStep(
  y: number,
  vy: number,
  input: VerticalInput,
  dt: number
): { y: number; vy: number } {
  if (input.ascend) vy += V_ACCEL * dt;
  else if (input.descend) vy -= V_ACCEL * dt;
  else {
    vy *= Math.pow(0.94, dt * 60);
    if (input.autoLevel) y *= Math.pow(0.7, dt);
  }
  vy = Math.max(-V_MAX, Math.min(V_MAX, vy));

  // Soft bound: inside the last V_SOFT units, outward speed scales linearly to 0.
  if (vy > 0 && y > V_CEIL - V_SOFT) {
    vy *= Math.max(0, (V_CEIL - y) / V_SOFT);
  } else if (vy < 0 && y < -(V_CEIL - V_SOFT)) {
    vy *= Math.max(0, (V_CEIL + y) / V_SOFT);
  }

  y = Math.max(-V_CEIL, Math.min(V_CEIL, y + vy * dt));
  return { y, vy };
}
```

- [ ] **Step 3: Implement the rest**

`src/utils/toroidal.ts` — append:
```ts
/** 3D distance: toroidal in xz, plain in y. */
export function toroidalDistance3(
  ax: number, az: number, ay: number,
  bx: number, bz: number, by: number,
  bounds: number
): number {
  return Math.hypot(toroidalDistance(ax, az, bx, bz, bounds), by - ay);
}
```

`src/store/spaceStore.ts`:
- `FlightInput` += `ascend: boolean; descend: boolean;` — and add `ascend: false, descend: false,` to the `flight.input` literal.
- `flight` += `y: 0,` (comment: `// altitude, written by Spaceship each frame`).
- State += `altitudeWarn: boolean` (init false) and guarded setter:
```ts
    setAltitudeWarn: (v) => { if (get().altitudeWarn !== v) set({ altitudeWarn: v }); },
```

`src/hooks/useKeyboardInput.ts` — replace KEYMAP and add the form-field guard:
```ts
type BoolKey = "forward" | "backward" | "left" | "right" | "boost" | "ascend" | "descend";

const KEYMAP: Record<string, BoolKey> = {
  KeyW: "forward", ArrowUp: "forward",
  KeyS: "backward", ArrowDown: "backward",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  Space: "ascend",
  KeyC: "descend", KeyX: "descend",
  ShiftLeft: "boost", ShiftRight: "boost",
};
```
and in `set(code, value)`'s callers (the down/up handlers), guard first:
```ts
    const el = e.target as HTMLElement | null;
    if (el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) return;
```

`src/utils/chatterScheduler.ts` — `ChatterPools` += `altitude: string[];`, `ChatterKind` += `"altitude"`, pick branch `else if (kind === "altitude") pool = this.pools.altitude;`

`src/data/chatterLines.ts` — add:
```ts
  altitude: [
    "ALTITUDE ADVISORY // THIN VACUUM UP HERE. EVEN FOR VACUUM",
    "CEILING PROXIMITY. THE PORTFOLIO HAS A ROOF, APPARENTLY",
    "NAV.AI: PLANETS ARE DOWN THERE, PILOT",
  ],
```

- [ ] **Step 4: `npm test` → all pass (28 + 12 new = 40 or per actual count). Then build + lint.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: vertical-flight foundations — verticalStep, 3D toroidal distance, input remap (tested)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Physics, camera, and 3D proximity

**Files:**
- Modify: `src/components/canvas/Spaceship.tsx`, `src/components/canvas/SpacePlanets.tsx`

**Interfaces:**
- Consumes: `verticalStep`/constants, `toroidalDistance3`, `flight.y`, store `setAltitudeWarn`
- Produces: ship flies vertically; orbit-lock is 3D; `flight.y` live

- [ ] **Step 1: Spaceship.tsx**

1. Imports: `verticalStep` from `../../utils/verticalFlight`.
2. Add ref: `const vy = useRef(0);`
3. In the main frame branch (after the horizontal velocity work, before the boundary wrap), add:
```ts
    // Vertical channel (pure step; auto-level only outside gravity zones)
    const vRes = verticalStep(
      pos.current.y,
      vy.current,
      {
        ascend: input.ascend,
        descend: input.descend,
        autoLevel: !input.ascend && !input.descend && !store.activeZone,
      },
      dt
    );
    pos.current.y = vRes.y;
    vy.current = vRes.vy;
    store.setAltitudeWarn(Math.abs(pos.current.y) > 48);
```
4. Visual pitch — replace the bob line `pitch.current = Math.sin(time * 2) * 0.03;` with:
```ts
    pitch.current = Math.sin(time * 2) * 0.03 + THREE.MathUtils.clamp(-vy.current * 0.045, -0.3, 0.3);
```
5. Camera vertical lag — replace `state.camera.position.lerp(targetCamPos, frameLerp(0.05, dt));` with per-axis blending:
```ts
    const fXZ = frameLerp(0.05, dt);
    const fY = frameLerp(0.03, dt);
    state.camera.position.x += (targetCamPos.x - state.camera.position.x) * fXZ;
    state.camera.position.z += (targetCamPos.z - state.camera.position.z) * fXZ;
    state.camera.position.y += (targetCamPos.y - state.camera.position.y) * fY;
```
   and add vertical lead to the look target: change `lookOffset` y from `0.2` to `0.2 + THREE.MathUtils.clamp(vy.current * 0.1, -1, 1)`.
   (`targetCamPos` already tracks `pos.current`, which now carries y.)
6. Telemetry: add `flight.y = pos.current.y;` next to the x/z writes. NearSpawn check gains altitude: `Math.abs(pos.current.x) < 0.6 && Math.abs(pos.current.z - 18) < 0.6 && Math.abs(pos.current.y) < 3`.
7. Orbit-locked branch: also zero the vertical channel (`vy.current = 0;`).

- [ ] **Step 2: SpacePlanets.tsx — 3D proximity**

Replace `toroidalDistance` import/usage with `toroidalDistance3`:
```ts
      const dist = toroidalDistance3(flight.x, flight.z, flight.y, p.pos[0], p.pos[2], p.pos[1], COSMIC_BOUNDS);
```
and for the portal:
```ts
    const portalDist = toroidalDistance3(flight.x, flight.z, flight.y, PORTAL_POS[0], PORTAL_POS[2], PORTAL_POS[1], COSMIC_BOUNDS);
```

- [ ] **Step 3: Gates + commit**

```bash
git add -A
git commit -m "feat: vertical flight physics, swoopy camera, 3D orbit-lock distances

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Instruments — radar altitude bar, HUD teaching, altitude chatter

**Files:**
- Modify: `src/components/layout/RadarMap.tsx`, `src/components/layout/HUDOverlay.tsx`, `src/components/layout/RadioChatter.tsx`

- [ ] **Step 1: RadarMap.tsx — altitude bar**

In the draw loop, after the ship chevron, add:
```ts
      // Altitude bar (right edge): ±V_CEIL mapped to bar height, zero-line at middle
      const barX = SIZE - 7;
      const barTop = 14;
      const barH = SIZE - 28;
      ctx.strokeStyle = "rgba(0,255,135,0.25)";
      ctx.strokeRect(barX - 1.5, barTop, 3, barH);
      ctx.beginPath(); // zero line
      ctx.moveTo(barX - 4, barTop + barH / 2);
      ctx.lineTo(barX + 4, barTop + barH / 2);
      ctx.stroke();
      const yNorm = Math.max(-1, Math.min(1, flight.y / 55));
      ctx.fillStyle = "#00ff87";
      ctx.beginPath();
      ctx.arc(barX, barTop + barH / 2 - yNorm * (barH / 2), 2.2, 0, Math.PI * 2);
      ctx.fill();
```

- [ ] **Step 2: HUDOverlay.tsx**

1. NAV.LOC rAF line becomes:
```ts
        locRef.current.textContent = `NAV.LOC: X(${flight.x.toFixed(2)}) / Y(${flight.y.toFixed(1)}) / Z(${flight.z.toFixed(2)})`;
```
(update the static placeholder text in the JSX to match: `NAV.LOC: X(0.00) / Y(0.0) / Z(18.00)`.)
2. Instruction card: insert an ALTITUDE cell between PILOT_STEER and WARP_DRIVE (copy an existing cell's markup):
   - label `ALTITUDE`, value `{isCoarse ? "RISE / DIVE" : "SPACE / C"}`
   - WARP_DRIVE value becomes `{isCoarse ? "BOOST BUTTON" : "SHIFT"}`

- [ ] **Step 3: RadioChatter.tsx — altitude advisory**

Add alongside the comet subscription:
```tsx
      useSpaceStore.subscribe(
        (s) => s.altitudeWarn,
        (warn) => { if (warn) typeLine(scheduler.pick("altitude")); }
      ),
```

- [ ] **Step 4: Gates + commit**

```bash
git add -A
git commit -m "feat: altitude instruments — radar bar, HUD teaching, ceiling advisory chatter

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Touch RISE/DIVE buttons

**Files:**
- Modify: `src/components/layout/TouchControls.tsx`

- [ ] **Step 1: Add two hold-buttons above BOOST**

Following the BOOST button's exact per-pointer-capture pattern (own pointer ref each), add:
```tsx
      <button
        className="fixed bottom-64 right-9 z-40 pointer-events-auto touch-none w-14 h-14 rounded-full border border-primary/40 bg-black/50 font-mono text-[10px] text-primary active:bg-primary/20"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); risepointer.current = e.pointerId; flight.input.ascend = true; }}
        onPointerUp={(e) => { if (e.pointerId === risepointer.current) { risepointer.current = null; flight.input.ascend = false; } }}
        onPointerCancel={(e) => { if (e.pointerId === risepointer.current) { risepointer.current = null; flight.input.ascend = false; } }}
      >
        ▲ RISE
      </button>
      <button
        className="fixed bottom-48 right-9 z-40 pointer-events-auto touch-none w-14 h-14 rounded-full border border-primary/40 bg-black/50 font-mono text-[10px] text-primary active:bg-primary/20"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); divepointer.current = e.pointerId; flight.input.descend = true; }}
        onPointerUp={(e) => { if (e.pointerId === divepointer.current) { divepointer.current = null; flight.input.descend = false; } }}
        onPointerCancel={(e) => { if (e.pointerId === divepointer.current) { divepointer.current = null; flight.input.descend = false; } }}
      >
        ▼ DIVE
      </button>
```
with `const risepointer = useRef<number | null>(null);` and `const divepointer = useRef<number | null>(null);` beside the existing pointer refs. Extend BOTH reset paths (the isOrbitLocked effect and the unmount cleanup) to also zero `flight.input.ascend/descend` and clear the two new refs.

- [ ] **Step 2: Gates + commit**

```bash
git add -A
git commit -m "feat: touch RISE/DIVE hold-buttons for vertical flight

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Final verification pass

- [ ] **Step 1: Gates** — build/lint/test (expect ~40 tests green).
- [ ] **Step 2: Probe** — extend the puppeteer rig: hold Space 4s → screenshot (world below, radar altitude marker up, advisory line typed at ceiling); release → wait 10s → screenshot (auto-level brought y near 0). Press Shift+W → warp streaks confirm Shift-warp works.
- [ ] **Step 3: Manual** — feel of climb/dive; can't orbit-lock from above a planet; contact-form typing doesn't fly the ship; touch buttons on emulation.
- [ ] **Step 4: Append `## Verification`; commit.**

## Verification (2026-07-18)

Gates: build ✓ · lint ✓ · tests 40/40 (12 new: verticalStep ×7, toroidalDistance3 ×3, altitude pool, setAltitudeWarn guard).

Probe-verified (screenshots): hold-Space climb to Y(28.7) with radar altitude marker up + vertical engine trail; 12s idle auto-level back to Y(0.4) with spawn card reappearing (3D spawn check); Shift-warp fires the full warp stack (tunnel + CA + chatter + 144 KM/S). New 4-cell HUD card (ALTITUDE: SPACE/C · WARP_DRIVE: SHIFT) rendering. Zero page errors.

## Verification closure (2026-07-25)

Pending-human items from this plan, resolved:

- Climb/dive feel — NOT RUN — awaiting human pass, see `docs/QA-CHECKLIST.md` §2.
- C/X descend key comfort — NOT RUN — awaiting human pass, see `docs/QA-CHECKLIST.md`
  §3.
- Touch RISE/DIVE on device — partially closed: `tests/e2e/touch.probe.mjs` verifies
  RISE/DIVE under iPhone emulation (`RISE releases the ascend input cleanly`, `holding
  RISE sets ascend`, `holding RISE pitches the nose up`, `holding DIVE sets descend`,
  `DIVE pitches the nose back down`), but emulation cannot judge real-device
  thumb-reach ergonomics — that half is NOT RUN — awaiting human pass, see
  `docs/QA-CHECKLIST.md` §8.
- Altitude-bar vs dead-ahead-blip overlap aesthetics — NOT RUN — awaiting human pass,
  see `docs/QA-CHECKLIST.md` §4.

See `docs/superpowers/plans/2026-07-25-portfolio-content-and-verification.md`.

Note: auto-level implemented as y *= 0.7^dt (~2s half-life) — matches spec intent; spec's "~8s"/0.915 wording was self-contradictory.
