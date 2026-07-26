# Fuel and Crystals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make warp cost fuel, and scatter refuelling crystals through open space that respawn up to a cap — so warp becomes a deliberate choice and exploring has a reason.

**Architecture:** Fuel lives in the mutable `flight` telemetry object, never the zustand store, because it changes every frame while warping and the store would turn that into a per-frame React commit. Crystals are one `InstancedMesh` of fixed `CRYSTAL_MAX` slots — inactive slots scale to zero rather than resizing arrays — copying the `DataShards` pattern exactly. All decision logic (drain, refuel, spawn rejection, respawn timing) is extracted into pure functions so it is unit-testable without a scene.

**Tech Stack:** React 19, TypeScript 6, Vite 8, three.js 0.185 / @react-three/fiber 9.6, zustand 5, vitest 4, puppeteer-core 25.

**Spec:** `docs/superpowers/specs/2026-07-27-fuel-and-crystals-design.md`

## Global Constraints

- **Fuel lives in `flight`, not the store.** It changes every frame while warping. In the store that is a per-frame `setState`, which breaks the project's core guarantee of zero React renders during flight — currently verified at `commits=0` by `tests/e2e/perf.probe.mjs`. That check must still report `commits=0` with fuel actively draining; required, not assumed.
- **The store receives only discrete events** — `fuelEmpty` flipping, changing on the order of seconds. Change-guarded like the existing `setActiveZone`.
- **Empty disables warp ONLY.** Normal thrust always works, so no visitor can ever be stranded. This is the single most important behavioural requirement.
- **Fuel does not persist.** Every session starts full at `FUEL_MAX`.
- **Crystal pickup measures the crystal's BASE position, not its bobbed position**, so freezing the bob under reduced motion cannot alter collection. `DataShards` already does this.
- **Decorative crystal motion (bob, spin) reads `ambientTime()`** from `src/utils/ambientTime.ts`, so it freezes under `prefers-reduced-motion` while pickup keeps working.
- **No new assets.** Crystals reuse `public/models/space_crystal.glb`, already in the bundle at 50KB (loaded today by `PlasmaAnomalies`).
- **All rates are delta-time scaled.** `Spaceship` already clamps `dt` to 0.05.
- **Existing gates stay green:** `npm run build`, `npm run lint` (only the two long-standing pre-existing warnings — `Atmosphere.tsx:54`, `Scanner.tsx:9`), `npm test` (119 tests across 23 files at plan time), `npm run test:e2e` (112 checks across 10 probes, 2 capture-only).
- **`.env` is gitignored and holds a real key.** Never read, print, or commit its contents.
- Commit after every task with a conventional-commit prefix.

## File Structure

**Created:**
- `src/utils/fuel.ts` — fuel constants and the two pure transforms (`drainFuel`, `refuel`). One responsibility: how fuel changes.
- `src/utils/crystalField.ts` — crystal constants, the spawn-rejection predicate, random placement, and the respawn scheduler. All pure; no three.js, no React.
- `src/components/canvas/FuelCrystals.tsx` — the `InstancedMesh` entity, bob/spin, and pickup. Mirrors `DataShards.tsx`.
- `tests/fuel.test.ts`, `tests/crystalField.test.ts`
- `tests/e2e/fuel.probe.mjs`

**Modified:**
- `src/store/spaceStore.ts` — `fuel` on the `flight` literal; `fuelEmpty` + `setFuelEmpty` on the store.
- `src/components/canvas/Spaceship.tsx:284` — warp gate gains a fuel term; drain in the same block.
- `src/components/canvas/GlobalCanvas.tsx` — mount `<FuelCrystals />`.
- `src/components/layout/HUDOverlay.tsx` — the fuel bar (rAF-written) and a `DRY` state on the existing `WARP.CORE` line.
- `src/components/layout/RadarMap.tsx` — in-range crystal blips.
- `src/debug/bridge.ts` — expose the live crystal array so the e2e probe can read it.

---

## Task 1: Fuel maths

**Files:**
- Create: `src/utils/fuel.ts`, `tests/fuel.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FUEL_MAX = 100`, `FUEL_DRAIN_PER_SEC = 8`, `FUEL_PER_CRYSTAL = 25`, `drainFuel(fuel: number, dt: number): number`, `refuel(fuel: number): number`. **Tasks 2, 4, 5 and 6 depend on these exact names.**

- [ ] **Step 1: Write the failing test**

`tests/fuel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FUEL_MAX, FUEL_DRAIN_PER_SEC, FUEL_PER_CRYSTAL, drainFuel, refuel } from "../src/utils/fuel";

describe("drainFuel", () => {
  it("drains at the configured rate, scaled by dt", () => {
    expect(drainFuel(100, 1)).toBeCloseTo(100 - FUEL_DRAIN_PER_SEC);
    expect(drainFuel(100, 0.5)).toBeCloseTo(100 - FUEL_DRAIN_PER_SEC / 2);
  });

  it("clamps at zero rather than going negative", () => {
    expect(drainFuel(2, 1)).toBe(0);
    // A tab-switch dt spike must not produce a negative tank.
    expect(drainFuel(100, 999)).toBe(0);
  });

  it("is a no-op at dt zero", () => {
    expect(drainFuel(50, 0)).toBe(50);
  });

  it("gives one full crossing of the map on a full tank", () => {
    // The design's central tuning claim: FUEL_MAX / drain = seconds of warp,
    // times WARP_SPEED (39) should be about the 500-unit width of the world.
    const seconds = FUEL_MAX / FUEL_DRAIN_PER_SEC;
    expect(seconds * 39).toBeGreaterThan(450);
    expect(seconds * 39).toBeLessThan(550);
  });
});

describe("refuel", () => {
  it("adds one crystal's worth", () => {
    expect(refuel(0)).toBe(FUEL_PER_CRYSTAL);
    expect(refuel(50)).toBe(50 + FUEL_PER_CRYSTAL);
  });

  it("clamps at FUEL_MAX rather than overfilling", () => {
    expect(refuel(FUEL_MAX)).toBe(FUEL_MAX);
    expect(refuel(FUEL_MAX - 1)).toBe(FUEL_MAX);
  });

  it("takes four crystals to fill an empty tank", () => {
    let f = 0;
    for (let i = 0; i < 4; i++) f = refuel(f);
    expect(f).toBe(FUEL_MAX);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fuel.test.ts`
Expected: FAIL — cannot resolve `../src/utils/fuel`.

- [ ] **Step 3: Write the implementation**

`src/utils/fuel.ts`:

```ts
/**
 * Warp fuel. Pure transforms so the tuning is testable without a scene.
 *
 * Numbers derive from the flight model rather than taste: WARP_SPEED is 39 u/s
 * (Spaceship.tsx) in a 500-unit-wide world (COSMIC_BOUNDS 250), so a 100 tank
 * draining 8/s gives 12.5s of warp ≈ 488 units — one full crossing per tank.
 * That makes warp a decision rather than something you hold down by default.
 */
export const FUEL_MAX = 100;

/** Units per second while warp is active. 100/8 = 12.5s of warp. */
export const FUEL_DRAIN_PER_SEC = 8;

/** Restored per crystal. Four fill an empty tank; one buys ~122 units of warp. */
export const FUEL_PER_CRYSTAL = 25;

/** Drains for `dt` seconds, clamped at empty. */
export function drainFuel(fuel: number, dt: number): number {
  return Math.max(0, fuel - FUEL_DRAIN_PER_SEC * dt);
}

/** Adds one crystal, clamped at full. */
export function refuel(fuel: number): number {
  return Math.min(FUEL_MAX, fuel + FUEL_PER_CRYSTAL);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/fuel.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Full suite and commit**

Run: `npm test` — expected 126 tests (119 + 7).

```bash
git add src/utils/fuel.ts tests/fuel.test.ts
git commit -m "feat: fuel maths — drain and refuel, clamped

Numbers derived from the flight model, not taste: WARP_SPEED 39 u/s in a
500-unit world means a 100 tank at 8/s gives one crossing per tank. A test pins
that relationship so retuning one constant cannot silently break the intent."
```

---

## Task 2: Fuel state, warp gating, and drain

**Files:**
- Modify: `src/store/spaceStore.ts` (the `flight` literal ~line 101; store interface and actions), `src/components/canvas/Spaceship.tsx:284`
- Test: `tests/spaceStore.test.ts` (extend the existing `beforeEach`)

**Interfaces:**
- Consumes: `FUEL_MAX`, `FUEL_DRAIN_PER_SEC`, `drainFuel` from Task 1.
- Produces: `flight.fuel: number`; store `fuelEmpty: boolean` and `setFuelEmpty(v: boolean): void`. **Tasks 3, 5 and 6 read `flight.fuel`; Task 3 reads `fuelEmpty`.**

- [ ] **Step 1: Add fuel to the flight telemetry object**

In `src/store/spaceStore.ts`, add to the `flight` object literal (currently ending with the `input` block around line 111). Import `FUEL_MAX` from `../utils/fuel`:

```ts
  /**
   * Warp fuel, 0..FUEL_MAX. Written ONLY by Spaceship's frame loop and read by
   * the HUD/radar rAF loops. Deliberately here rather than in the store: it
   * changes every frame while warping, and store state would make that a
   * per-frame React commit, breaking the zero-renders-during-flight guarantee.
   * Starts full — fuel is session state, not persisted progress.
   */
  fuel: FUEL_MAX,
```

- [ ] **Step 2: Add the discrete empty flag to the store**

Add to the `SpaceState` interface:

```ts
  fuelEmpty: boolean;
  setFuelEmpty: (v: boolean) => void;
```

To the initial state:

```ts
    fuelEmpty: false,
```

And beside the other change-guarded setters (near `setActiveZone`):

```ts
    // Change-guarded: called from a frame loop, so it must not notify unless the
    // value actually flipped.
    setFuelEmpty: (v) => { if (get().fuelEmpty !== v) set({ fuelEmpty: v }); },
```

- [ ] **Step 3: Extend the store test's reset**

`tests/spaceStore.test.ts`'s `beforeEach` resets every field explicitly. Add:

```ts
    fuelEmpty: false,
```

- [ ] **Step 4: Gate warp on fuel and drain it**

In `src/components/canvas/Spaceship.tsx`, import `drainFuel` and `FUEL_DRAIN_PER_SEC` is not needed directly — `drainFuel` owns the rate:

```ts
import { drainFuel } from "../../utils/fuel";
```

Replace line 284:

```ts
    const warpActive = input.boost && time > warpSuppressUntil.current;
```

with:

```ts
    // Warp needs fuel. Ordering is deliberate: the drain is conditioned on the
    // same `warpActive` the velocity branch uses, so the gate and the drain can
    // never disagree about whether warp happened this frame. Holding Shift on an
    // empty tank drains nothing and simply cruises.
    //
    // Running dry is a graceful coast, not a stop: the warp branch below assigns
    // velocity directly, so when it stops running the ship keeps its 39 u/s and
    // decays through the existing SPACE_DRAG.
    const warpActive = input.boost && time > warpSuppressUntil.current && flight.fuel > 0;
    if (warpActive) flight.fuel = drainFuel(flight.fuel, dt);
    store.setFuelEmpty(flight.fuel <= 0);
```

`store` is already in scope (`useSpaceStore.getState()` earlier in the loop), and `setFuelEmpty` is change-guarded, so this costs no React commits in the steady state.

- [ ] **Step 5: Verify in the browser**

`tests/e2e/harness.mjs` drives headless Chrome via `puppeteer-core` with the correct path for this machine (`~/Applications/Google Chrome.app`, NOT `/Applications`). Write a throwaway script outside the repo, then delete it.

Confirm: holding `ShiftLeft` drains `window.__fitz.flight.fuel`; releasing it stops the drain; cruising with `KeyW` alone does not drain; and once fuel hits 0, holding Shift produces no speed above `MAX_SPEED` (10.8) while `KeyW` still accelerates.

That last check is the important one — it is the "nobody gets stranded" guarantee.

- [ ] **Step 6: Gates and commit**

Run: `npm run build && npm run lint && npm test` — 126 tests.

```bash
git add src/store/spaceStore.ts src/components/canvas/Spaceship.tsx tests/spaceStore.test.ts
git commit -m "feat: warp consumes fuel; empty disables warp but never thrust

Fuel lives on the mutable flight object, not the store, so a per-frame drain
costs no React commits. Only the discrete fuelEmpty flag reaches the store, and
it is change-guarded. Cruise is untouched at zero fuel — nobody can be stranded."
```

---

## Task 3: HUD fuel gauge

**Files:**
- Modify: `src/components/layout/HUDOverlay.tsx`

**Interfaces:**
- Consumes: `flight.fuel` (Task 2), store `fuelEmpty` (Task 2), `FUEL_MAX` (Task 1).
- Produces: `data-testid="hud-fuel-bar"` and `data-testid="hud-fuel-label"` for Task 6's probe.

- [ ] **Step 1: Add the gauge, written from the existing rAF tick**

`HUDOverlay.tsx` already runs one rAF loop writing `NAV.LOC` and `VELOCITY` straight to the DOM with zero React renders. The gauge joins that loop — do NOT add a second loop and do NOT put fuel in React state.

Add refs beside `locRef` / `velRef`:

```ts
  const fuelFillRef = useRef<HTMLDivElement>(null);
  const fuelLabelRef = useRef<HTMLDivElement>(null);
```

Inside the existing `tick()`, after the `velRef` write:

```ts
      const pct = Math.max(0, Math.min(1, flight.fuel / FUEL_MAX));
      if (fuelFillRef.current) {
        fuelFillRef.current.style.width = `${(pct * 100).toFixed(1)}%`;
        // Amber under a quarter, red when dry. Written as style rather than a
        // className so this never touches React.
        fuelFillRef.current.style.backgroundColor =
          pct <= 0 ? "#ef4444" : pct < 0.25 ? "#f59e0b" : "#00ff87";
      }
      if (fuelLabelRef.current)
        fuelLabelRef.current.textContent =
          pct <= 0 ? "WARP.FUEL: DRY" : `WARP.FUEL: ${(pct * 100).toFixed(0)}%`;
```

Import `FUEL_MAX` from `../../utils/fuel`.

- [ ] **Step 2: Add the markup**

Immediately after the `SHARDS:` row (line ~66), inside the same `flex flex-col` block:

```tsx
        <div ref={fuelLabelRef} data-testid="hud-fuel-label">WARP.FUEL: 100%</div>
        <div className="w-32 h-1 rounded-full bg-white/10 overflow-hidden">
          <div ref={fuelFillRef} data-testid="hud-fuel-bar"
            className="h-full rounded-full transition-none"
            style={{ width: "100%", backgroundColor: "#00ff87" }} />
        </div>
```

`transition-none` is deliberate: the bar is updated every frame from rAF, so a CSS transition would fight it and lag behind the real value.

- [ ] **Step 3: Show DRY on the existing warp line**

Line ~65 currently reads:

```tsx
        <div>WARP.CORE: {isWarping ? "ACTIVE (STRETCH)" : "CHARGED (STANDBY)"}</div>
```

This line is already React-rendered from the `isWarping` selector, and `fuelEmpty` changes just as rarely, so adding a selector here is fine. Add beside the other selectors:

```ts
  const fuelEmpty = useSpaceStore((s) => s.fuelEmpty);
```

and change the line to:

```tsx
        <div>WARP.CORE: {fuelEmpty ? "OFFLINE (NO FUEL)" : isWarping ? "ACTIVE (STRETCH)" : "CHARGED (STANDBY)"}</div>
```

- [ ] **Step 4: One-time chatter when the tank empties**

So the reason warp stopped responding is explained rather than mysterious. In `HUDOverlay.tsx`, add an effect keyed on `fuelEmpty` — it fires only on the transition because the store setter is change-guarded:

```tsx
  useEffect(() => {
    if (!fuelEmpty) return;
    useSpaceStore.getState().sendBroadcast(
      "WARP CORE DRY // COLLECT A FUEL CRYSTAL TO RECHARGE — THRUSTERS STILL NOMINAL"
    );
  }, [fuelEmpty]);
```

The copy deliberately says thrusters still work, because a visitor whose warp just died needs to know they are not stuck.

- [ ] **Step 5: Verify in the browser**

Using the harness as in Task 2 Step 5: burn the tank by holding `ShiftLeft`, and confirm the bar narrows, turns amber under 25%, reads `WARP.FUEL: DRY` at zero, that `WARP.CORE` switches to `OFFLINE (NO FUEL)`, and that the chatter line appears once rather than repeatedly.

- [ ] **Step 6: Gates and commit**

Run: `npm run build && npm run lint && npm test`

```bash
git add src/components/layout/HUDOverlay.tsx
git commit -m "feat: HUD fuel gauge, written from the existing rAF tick

Joins the loop that already writes NAV.LOC and VELOCITY, so the gauge costs zero
React renders. Only the discrete DRY state uses a selector. The empty-tank
chatter says thrusters are still nominal, because a visitor whose warp just died
needs to know they are not stranded."
```

---

## Task 4: Crystal field maths

**Files:**
- Create: `src/utils/crystalField.ts`, `tests/crystalField.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `CRYSTAL_MAX = 40`, `CRYSTAL_RESPAWN_SECONDS = 4`, `CRYSTAL_PICKUP_RADIUS = 3`, `isRejectedSpawn(x, y, z, avoid): boolean`, `randomCrystalPos(rand, avoid): [number, number, number]`, `respawnTick(accum: number, dt: number): { spawns: number; accum: number }`, and the type `AvoidPoint = { x: number; y: number; z: number; r: number }`. **Task 5 depends on all of these.**

- [ ] **Step 1: Write the failing test**

`tests/crystalField.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CRYSTAL_MAX, CRYSTAL_RESPAWN_SECONDS, isRejectedSpawn, randomCrystalPos, respawnTick,
} from "../src/utils/crystalField";
import { COSMIC_BOUNDS } from "../src/constants";

describe("isRejectedSpawn", () => {
  it("rejects inside the asteroid belt band", () => {
    // Belt is radius 40-70 in the XZ plane.
    expect(isRejectedSpawn(55, 0, 0, [])).toBe(true);
    expect(isRejectedSpawn(0, 0, 45, [])).toBe(true);
  });

  it("rejects inside the polar halo band", () => {
    // Halo is radius 80-95.
    expect(isRejectedSpawn(88, 0, 0, [])).toBe(true);
  });

  it("accepts the gaps between and beyond the bands", () => {
    expect(isRejectedSpawn(20, 0, 0, [])).toBe(false);   // inside the belt
    expect(isRejectedSpawn(75, 0, 0, [])).toBe(false);   // between belt and halo
    expect(isRejectedSpawn(200, 0, 0, [])).toBe(false);  // beyond both
  });

  it("rejects near an avoid point, and accepts outside its radius", () => {
    const avoid = [{ x: 200, y: 10, z: -100, r: 20 }];
    expect(isRejectedSpawn(205, 10, -100, avoid)).toBe(true);
    expect(isRejectedSpawn(230, 10, -100, avoid)).toBe(false);
  });

  it("measures avoid distance in 3D, not just the XZ plane", () => {
    // Directly above an avoid point, within its radius: must still reject.
    const avoid = [{ x: 0, y: 0, z: 200, r: 20 }];
    expect(isRejectedSpawn(0, 15, 200, avoid)).toBe(true);
  });
});

describe("randomCrystalPos", () => {
  it("stays inside the world bounds", () => {
    let n = 0;
    const rand = () => [0.1, 0.9, 0.5, 0.3, 0.7, 0.2][n++ % 6];
    for (let i = 0; i < 50; i++) {
      const [x, y, z] = randomCrystalPos(rand, []);
      expect(Math.abs(x)).toBeLessThanOrEqual(COSMIC_BOUNDS);
      expect(Math.abs(y)).toBeLessThanOrEqual(COSMIC_BOUNDS);
      expect(Math.abs(z)).toBeLessThanOrEqual(COSMIC_BOUNDS);
    }
  });

  it("returns a position that passes its own rejection test", () => {
    // Deterministic sequence so the test cannot flake.
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 200; i++) {
      const [x, y, z] = randomCrystalPos(rand, [{ x: 0, y: 0, z: 0, r: 30 }]);
      expect(isRejectedSpawn(x, y, z, [{ x: 0, y: 0, z: 0, r: 30 }])).toBe(false);
    }
  });

  it("gives up rather than looping forever when everything is rejected", () => {
    // An avoid point swallowing the entire volume: must still return, not hang.
    const impossible = [{ x: 0, y: 0, z: 0, r: 10_000 }];
    const pos = randomCrystalPos(() => 0.5, impossible);
    expect(pos).toHaveLength(3);
    expect(pos.every((n) => Number.isFinite(n))).toBe(true);
  });
});

describe("respawnTick", () => {
  it("emits no spawn before the interval elapses", () => {
    const r = respawnTick(0, 1);
    expect(r.spawns).toBe(0);
    expect(r.accum).toBeCloseTo(1);
  });

  it("emits one spawn when the interval is reached and keeps the remainder", () => {
    const r = respawnTick(CRYSTAL_RESPAWN_SECONDS - 0.1, 0.3);
    expect(r.spawns).toBe(1);
    expect(r.accum).toBeCloseTo(0.2);
  });

  it("emits multiple spawns for a large dt rather than losing them", () => {
    const r = respawnTick(0, CRYSTAL_RESPAWN_SECONDS * 3 + 1);
    expect(r.spawns).toBe(3);
    expect(r.accum).toBeCloseTo(1);
  });

  it("has a sane cap so CRYSTAL_MAX is reachable but not absurd", () => {
    expect(CRYSTAL_MAX).toBeGreaterThan(10);
    expect(CRYSTAL_MAX).toBeLessThanOrEqual(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/crystalField.test.ts`
Expected: FAIL — cannot resolve `../src/utils/crystalField`.

- [ ] **Step 3: Write the implementation**

`src/utils/crystalField.ts`:

```ts
import { COSMIC_BOUNDS } from "../constants";

/** A sphere spawns must stay clear of — a planet, the portal, or the ship. */
export interface AvoidPoint { x: number; y: number; z: number; r: number }

/** Slots in the field. Mean spacing at this count is ~146 units. */
export const CRYSTAL_MAX = 40;

/** Seconds between respawns while below the cap. */
export const CRYSTAL_RESPAWN_SECONDS = 4;

/** Ship-to-crystal distance that collects it. Matches the shard radius. */
export const CRYSTAL_PICKUP_RADIUS = 3;

/** Main asteroid belt band, radius in the XZ plane (AsteroidBelt.tsx). */
const BELT_MIN = 40;
const BELT_MAX = 70;
/** Polar halo band, same file. */
const HALO_MIN = 80;
const HALO_MAX = 95;

/** Attempts before accepting a rejected candidate rather than hanging. */
const MAX_ATTEMPTS = 20;

/**
 * True if a candidate position is somewhere a crystal must not appear: inside
 * the asteroid bands where it would be buried in rock, or too close to a body
 * the player is navigating around.
 *
 * Band tests use XZ radius because the belt and halo are rings around the
 * origin; avoid points use full 3D distance because a crystal directly above a
 * planet is just as wrong as one beside it.
 */
export function isRejectedSpawn(x: number, y: number, z: number, avoid: AvoidPoint[]): boolean {
  const ringR = Math.hypot(x, z);
  if (ringR >= BELT_MIN && ringR <= BELT_MAX) return true;
  if (ringR >= HALO_MIN && ringR <= HALO_MAX) return true;
  for (const a of avoid) {
    if (Math.hypot(x - a.x, y - a.y, z - a.z) < a.r) return true;
  }
  return false;
}

/**
 * A random position in the volume that passes `isRejectedSpawn`.
 *
 * `rand` is injected rather than calling Math.random directly so the placement
 * is testable deterministically. After MAX_ATTEMPTS it returns the last
 * candidate regardless: a crystal in a slightly awkward spot is far better than
 * a frame loop that hangs, and the caller cannot tell the difference.
 */
export function randomCrystalPos(rand: () => number, avoid: AvoidPoint[]): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    x = (rand() * 2 - 1) * COSMIC_BOUNDS;
    y = (rand() * 2 - 1) * COSMIC_BOUNDS;
    z = (rand() * 2 - 1) * COSMIC_BOUNDS;
    if (!isRejectedSpawn(x, y, z, avoid)) break;
  }
  return [x, y, z];
}

/**
 * Accumulator-driven respawn timing. Returns how many crystals are due and the
 * leftover time to carry forward.
 *
 * An accumulator rather than setInterval so it pauses with the tab and stays in
 * step with delta time. It returns a COUNT rather than a boolean so a large dt
 * spike owes the right number of spawns instead of silently dropping them.
 */
export function respawnTick(accum: number, dt: number): { spawns: number; accum: number } {
  const total = accum + dt;
  const spawns = Math.floor(total / CRYSTAL_RESPAWN_SECONDS);
  return { spawns, accum: total - spawns * CRYSTAL_RESPAWN_SECONDS };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/crystalField.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Full suite and commit**

Run: `npm test` — expected 138 tests (126 + 12).

```bash
git add src/utils/crystalField.ts tests/crystalField.test.ts
git commit -m "feat: crystal field maths — spawn rejection, placement, respawn timing

All pure, so the awkward cases are testable without a scene: bands measured in
XZ radius but avoid points in full 3D, placement that gives up after 20 attempts
rather than hanging a frame loop, and a respawn tick that returns a count so a
large dt owes the right number of spawns instead of dropping them."
```

---

## Task 5: The crystal field entity

**Files:**
- Create: `src/components/canvas/FuelCrystals.tsx`
- Modify: `src/components/canvas/GlobalCanvas.tsx`, `src/debug/bridge.ts`

**Interfaces:**
- Consumes: everything from Task 4; `refuel`, `FUEL_MAX` from Task 1; `flight` and `bodies` from the store; `ambientTime`.
- Produces: `fitzDebug.crystals` — the live slot array, for Task 6's probe. Each slot is `{ x: number; y: number; z: number; active: boolean }`.

- [ ] **Step 1: Write the component**

`src/components/canvas/FuelCrystals.tsx`:

```tsx
import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { flight, useSpaceStore, bodies } from "../../store/spaceStore";
import { planets, PORTAL_POS, COSMIC_BOUNDS } from "../../constants";
import { toroidalDistance3 } from "../../utils/toroidal";
import { ambientTime } from "../../utils/ambientTime";
import { refuel, FUEL_MAX } from "../../utils/fuel";
import {
  CRYSTAL_MAX, CRYSTAL_PICKUP_RADIUS, randomCrystalPos, respawnTick,
  type AvoidPoint,
} from "../../utils/crystalField";
import { soundManager } from "../../audio/soundManager";
import { fitzDebug } from "../../debug/bridge";

const dummy = new THREE.Object3D();
const ZERO_SCALE = new THREE.Vector3(0, 0, 0);

export interface CrystalSlot { x: number; y: number; z: number; active: boolean }

/**
 * Floating fuel crystals. One InstancedMesh of CRYSTAL_MAX fixed slots —
 * inactive slots scale to zero rather than resizing any array, exactly as
 * DataShards handles collected shards. No React state, so a pickup costs no
 * render: the matrices and `flight.fuel` carry all of it.
 */
export default function FuelCrystals() {
  const { scene } = useGLTF("/models/space_crystal.glb");
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const respawnAccum = useRef(0);

  // Reuse the GLB's first mesh, baked to world scale — same approach as
  // AsteroidBelt takes with asteroids.glb.
  const { geometry, material } = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((c) => { if (!src && c instanceof THREE.Mesh) src = c; });
    if (!src) throw new Error("space_crystal.glb contains no mesh");
    src.updateMatrix();
    const g = src.geometry.clone();
    g.applyMatrix4(src.matrix);
    const m = (src.material as THREE.MeshStandardMaterial).clone();
    m.emissive = new THREE.Color("#ffd24a");
    m.emissiveIntensity = 1.8;
    return { geometry: g, material: m };
  }, [scene]);

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  /** Places to keep clear of, rebuilt per spawn from live positions. */
  const avoidFor = (): AvoidPoint[] => [
    ...planets.map((p) => ({ ...bodies[p.name], r: 20 })),
    { x: PORTAL_POS[0], y: PORTAL_POS[1], z: PORTAL_POS[2], r: 20 },
    // Keep clear of the ship so crystals never pop into view.
    { x: flight.x, y: flight.y, z: flight.z, r: 30 },
  ];

  const slots = useMemo<CrystalSlot[]>(() => {
    const out: CrystalSlot[] = [];
    for (let i = 0; i < CRYSTAL_MAX; i++) {
      const [x, y, z] = randomCrystalPos(Math.random, avoidFor());
      out.push({ x, y, z, active: true });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expose for the e2e probe. Dev-only; dead-code-eliminated in production.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.crystals = slots;
    return () => { fitzDebug.crystals = null; };
  }, [slots]);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dt = Math.min(delta, 0.05);
    const t = ambientTime(state.clock.getElapsedTime());
    const store = useSpaceStore.getState();

    // Refill empty slots on a timer while below the cap.
    const tick = respawnTick(respawnAccum.current, dt);
    respawnAccum.current = tick.accum;
    for (let n = 0; n < tick.spawns; n++) {
      const slot = slots.find((s) => !s.active);
      if (!slot) break; // at cap — nothing to do
      const [x, y, z] = randomCrystalPos(Math.random, avoidFor());
      slot.x = x; slot.y = y; slot.z = z; slot.active = true;
    }

    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s.active) {
        dummy.position.set(0, 0, 0);
        dummy.scale.copy(ZERO_SCALE);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      // Bob and spin are decorative and read ambientTime, so they freeze under
      // reduced motion. Per-slot rate/phase from the index so a cluster does not
      // move as one rigid body.
      const bob = Math.sin(t * (1.0 + (i % 5) * 0.17) + i) * 0.9;
      dummy.position.set(s.x, s.y + bob, s.z);
      dummy.rotation.set(Math.sin(t * 0.3 + i) * 0.4, t * (0.5 + (i % 4) * 0.15) + i, 0);
      dummy.scale.setScalar(0.6);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Pickup measures the BASE position, never `s.y + bob`. That is what makes
      // freezing the bob under reduced motion unable to affect collection.
      const dist = toroidalDistance3(flight.x, flight.z, flight.y, s.x, s.z, s.y, COSMIC_BOUNDS);
      if (dist < CRYSTAL_PICKUP_RADIUS) {
        // Consume it even at a full tank, or a full ship would plough through a
        // crystal field leaving it visibly intact.
        const before = flight.fuel;
        flight.fuel = refuel(flight.fuel);
        s.active = false;
        soundManager.pickup();
        if (before >= FUEL_MAX) store.sendBroadcast("FUEL CRYSTAL VENTED // TANK ALREADY FULL");
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh name="FuelCrystals" ref={meshRef}
      args={[geometry, material, CRYSTAL_MAX]} frustumCulled={false} />
  );
}
```

- [ ] **Step 2: Add the bridge field**

In `src/debug/bridge.ts`, add to the `FitzDebug` interface and initialise `null`:

```ts
  /** Live crystal slots, registered by FuelCrystals in dev. Null until mounted. */
  crystals: { x: number; y: number; z: number; active: boolean }[] | null;
```

- [ ] **Step 3: Mount it**

In `src/components/canvas/GlobalCanvas.tsx`, import `FuelCrystals` and mount it inside `<Suspense>` beside `<DataShards />`:

```tsx
          {/* Floating warp-fuel crystals */}
          <FuelCrystals />
```

Not gated on `isLowPerf`: it is gameplay, not decoration, and 40 instances in one draw call is ~7% of the belt's existing 560-rock loop.

- [ ] **Step 4: Verify in the browser**

Using the harness: confirm crystals exist (`window.__fitz.crystals.filter(c => c.active).length` is 40 at load), that teleporting onto one via `window.__fitz.teleport` deactivates it and raises `flight.fuel`, and that the active count climbs back toward 40 over the following seconds.

Also confirm none spawned inside the belt: check every active slot's XZ radius against the 40–70 and 80–95 bands.

- [ ] **Step 5: Gates and commit**

Run: `npm run build && npm run lint && npm test`

```bash
git add src/components/canvas/FuelCrystals.tsx src/components/canvas/GlobalCanvas.tsx src/debug/bridge.ts
git commit -m "feat: floating fuel crystals — instanced, respawning, no React state

CRYSTAL_MAX fixed slots in one InstancedMesh; inactive slots scale to zero
rather than resizing arrays, so a pickup costs no render. Reuses the
space_crystal GLB already in the bundle. Pickup measures the base position, not
the bobbed one, so the reduced-motion freeze cannot affect collection."
```

---

## Task 6: Radar blips and the e2e probe

**Files:**
- Modify: `src/components/layout/RadarMap.tsx`
- Create: `tests/e2e/fuel.probe.mjs`
- Modify: `tests/e2e/run.mjs` (add `"fuel"` to the default list)

**Interfaces:**
- Consumes: `fitzDebug.crystals` (Task 5), `flight.fuel` (Task 2), HUD test ids (Task 3).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Draw in-range crystals on the radar**

`RadarMap.tsx` builds a `targets` array then loops it, rim-clamping anything beyond the rim. Crystals must NOT join that array, because rim-clamping 40 of them would ring a 148px display and bury the planet blips the dossier navigation depends on.

Instead, after the existing `for (const t of targets)` loop, add a separate pass that draws only crystals genuinely inside `RANGE`:

```ts
      // Fuel crystals: in-range only, never rim-clamped. 40 crystals at ~146
      // units mean spacing means typically 1-3 are visible — the "where is my
      // nearest fuel" cue without swamping the display.
      const crystals = crystalSlots();
      if (crystals) {
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = "#ffd24a";
        for (const s of crystals) {
          if (!s.active) continue;
          const dx = wrapDelta(flight.x, s.x, COSMIC_BOUNDS);
          const dz = wrapDelta(flight.z, s.z, COSMIC_BOUNDS);
          if (Math.hypot(dx, dz) > RANGE) continue; // out of range: simply absent
          const { x: sx, up } = worldToRadar(dx, dz, a);
          ctx.beginPath();
          ctx.arc(c + sx * scale, c - up * scale, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
```

Radius 1.5 against the planets' 2.4 so crystals never compete with a lock target.

`crystalSlots()` reads the live array without importing the canvas component, keeping the HUD free of a scene dependency. Add near the top of `RadarMap.tsx`:

```ts
import { fitzDebug } from "../../debug/bridge";

/**
 * The live crystal array, or null before FuelCrystals mounts.
 *
 * Read through the debug bridge in dev; in production the bridge is
 * dead-code-eliminated, so this returns null and the radar draws no crystal
 * blips at all. That is a REAL GAP and it is not covered by the spec — the spec
 * assumes crystals are visible on the radar for every visitor, because without
 * that cue the mechanic is a blind hunt. See the coordinator note below.
 */
function crystalSlots() {
  return import.meta.env.DEV ? fitzDebug.crystals : null;
}
```

**Stop and flag this to the coordinator before continuing** if that trade-off looks wrong to you — it means crystals are invisible on the radar in a production build, which materially weakens the mechanic for real visitors. The alternative is a small module-level array in `src/state/` that both the canvas component and the radar import, with no bridge involvement. Ask which is wanted rather than guessing.

- [ ] **Step 2: Write the probe**

`tests/e2e/fuel.probe.mjs`:

```js
import { withPage, hold, settle, readStore } from "./harness.mjs";

export default async function run() {
  return withPage({ label: "fuel" }, async (page, checks) => {
    const fuel = () => page.evaluate(() => window.__fitz.flight.fuel);
    const activeCrystals = () =>
      page.evaluate(() => (window.__fitz.crystals ?? []).filter((c) => c.active).length);

    checks.check("tank starts full", (await fuel()) === 100, `fuel=${await fuel()}`);

    const n0 = await activeCrystals();
    checks.check("field starts at the cap", n0 === 40, `active=${n0}`);

    // Cruising must not drain.
    const beforeCruise = await fuel();
    await hold(page, ["KeyW"], 1500);
    checks.check("cruising does not drain fuel", (await fuel()) === beforeCruise,
      `${beforeCruise} -> ${await fuel()}`);

    // Warping must drain, at roughly the configured rate.
    const beforeWarp = await fuel();
    await hold(page, ["KeyW", "ShiftLeft"], 2000);
    const afterWarp = await fuel();
    const burned = beforeWarp - afterWarp;
    checks.check("warping drains fuel", burned > 0, `burned ${burned.toFixed(1)} over ~2s`);
    checks.check("drain is near the configured 8/sec", burned > 8 && burned < 24,
      `burned ${burned.toFixed(1)}`);

    // Burn it dry, then prove warp is dead and cruise is not.
    await page.evaluate(() => { window.__fitz.flight.fuel = 0; });
    await settle(page, 300);
    const s = await readStore(page);
    checks.check("store registers the empty tank", s.fuelEmpty === true, `fuelEmpty=${s.fuelEmpty}`);

    const hudLabel = await page.evaluate(() =>
      document.querySelector('[data-testid="hud-fuel-label"]')?.textContent);
    checks.check("HUD reads DRY", /DRY/.test(hudLabel ?? ""), `label="${hudLabel}"`);

    await page.evaluate(() => window.__fitz.teleport(-230, -210, -230));
    await settle(page, 1200);
    await hold(page, ["KeyW", "ShiftLeft"], 1500);
    // ONE measurement, two assertions on it. Reading flight.speed twice with no
    // action between would just be the same number twice dressed up as two
    // independent checks.
    const speedOnEmpty = await page.evaluate(() => window.__fitz.flight.speed);
    checks.check("warp is disabled at zero fuel", speedOnEmpty <= 12,
      `speed with Shift held on an empty tank: ${speedOnEmpty.toFixed(2)} (cruise max is 10.8, warp is 39)`);
    checks.check("cruise still works at zero fuel (nobody is stranded)", speedOnEmpty > 1,
      `speed=${speedOnEmpty.toFixed(2)} — the ship is still moving under thrust`);
    // Fuel must not have drained while warp was gated off.
    checks.check("an empty tank does not drain further", (await fuel()) === 0, `fuel=${await fuel()}`);

    // Refuel by flying onto a crystal.
    const target = await page.evaluate(() => {
      const c = (window.__fitz.crystals ?? []).find((s) => s.active);
      if (c) window.__fitz.teleport(c.x, c.y, c.z + 1);
      return c ? { x: c.x, y: c.y, z: c.z } : null;
    });
    checks.check("found an active crystal to fly to", target !== null, JSON.stringify(target));
    if (target) {
      await settle(page, 1500);
      const refuelled = await fuel();
      checks.check("touching a crystal refuels", refuelled >= 25, `fuel=${refuelled}`);
    }

    // Cap is respected as the field refills.
    await settle(page, 6000);
    const n1 = await activeCrystals();
    checks.check("active count never exceeds the cap", n1 <= 40, `active=${n1}`);

    // No crystal buried in the asteroid bands.
    const buried = await page.evaluate(() =>
      (window.__fitz.crystals ?? []).filter((s) => {
        if (!s.active) return false;
        const r = Math.hypot(s.x, s.z);
        return (r >= 40 && r <= 70) || (r >= 80 && r <= 95);
      }).length);
    checks.check("no crystal spawned inside the belt or halo", buried === 0, `buried=${buried}`);
  });
}
```

Add `"fuel"` to the default array in `tests/e2e/run.mjs`.

- [ ] **Step 3: Run the probe**

Run: `npm run test:e2e fuel`
Expected: 12 checks plus "no page errors".

If "drain is near the configured 8/sec" fails high, check whether `hold` overshoots its window under headless SwiftShader before adjusting the bound — the bound is deliberately generous (8–24 for a nominal 16) precisely because timing there is loose. **Do not widen it further without reporting the measured numbers.**

- [ ] **Step 4: Confirm the perf guarantee survives**

Run: `npm run test:e2e perf`
Expected: **`commits=0`**. A fuel gauge is exactly the kind of feature that reintroduces per-frame renders, so this is the check that matters most. If it is nonzero, something is writing fuel into React state and that is a real regression, not a flake — report the number.

- [ ] **Step 5: Confirm nothing else regressed**

Run: `npm run test:e2e`
Expected: the previous 112 checks still pass, plus this probe's.

**Safety:** the assets probe invokes Blender against gitignored, irreplaceable `assets-src/`, asserting a sha256 restore. If `assets-src/moon.glb restored byte-for-byte` fails, stop immediately and report it.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/RadarMap.tsx tests/e2e/fuel.probe.mjs tests/e2e/run.mjs
git commit -m "feat: crystals on the radar (in-range only) + fuel e2e probe

Crystals draw in a separate pass rather than joining the rim-clamped targets
array: 40 rim-clamped blips would ring a 148px display and bury the planet blips
the dossier navigation depends on. In range, typically 1-3 show.

The probe's load-bearing assertion is that cruise still works at zero fuel —
everything else proves the resource drains, that one proves nobody gets stranded."
```

---

## Final verification

- [ ] **Step 1: Full gate run**

```bash
npm run build && npm run lint && npm test && npm run test:e2e
```

Expected: build clean (chunk-size advisory only); lint shows only `Atmosphere.tsx:54` and `Scanner.tsx:9`; **138 unit tests**; e2e green with `perf` at `commits=0`.

- [ ] **Step 2: Confirm production is clean**

```bash
npm run build && ! grep -rq '__fitz' dist/assets/*.js && echo "OK: production bundle clean"
```

- [ ] **Step 3: Confirm the empty-tank guarantee by hand**

Run `npm run dev`, burn the tank by holding Shift, then verify by feel that W/A/S/D still fly, that the HUD reads `DRY`, and that flying into a crystal restores warp. This is the one behaviour whose failure would make the feature actively hostile, so it is worth confirming with your own hands and not only by probe.

- [ ] **Step 4: Append a verification record to this plan and commit**

Record: gate outcomes, the probe's check count, the `commits=0` figure, the measured drain rate, and the resolution of the Task 6 Step 1 production-radar question.

---

## Self-review notes

**Spec coverage.** §1 architecture → Task 2 (fuel in `flight`, discrete `fuelEmpty`). §2 numbers → Task 1, with a test pinning the one-crossing-per-tank relationship. §3 warp gating → Task 2 Step 4, including the photo-mode/orbit-lock non-issue. §4 crystals → Tasks 4 (maths) and 5 (entity), with the base-position pickup rule and `ambientTime` both in Task 5. §5 radar → Task 6 Step 1. §6 HUD → Task 3. §7 edge cases → clamping in Task 1's tests, full-tank consumption in Task 5, cap no-op in Task 5, `MAX_ATTEMPTS` in Task 4. §8 testing → Tasks 1, 4, 6. §9 out of scope → untouched.

**Known open question, deliberately surfaced rather than guessed:** Task 6 Step 1 reads the crystal array through the dev-only debug bridge, which means **no crystal blips in a production build**. That materially weakens the mechanic for real visitors. The implementer is instructed to stop and ask rather than pick. The alternative — a small shared module-level array both the canvas and the radar import — is cleaner but touches state ownership, so it deserves an explicit decision.

**Ordering.** Task 1 before 2, 3, 5. Task 2 before 3 and 6. Task 4 before 5. Task 5 before 6 (the probe reads `fitzDebug.crystals`).
