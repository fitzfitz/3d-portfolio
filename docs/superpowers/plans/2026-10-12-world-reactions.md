# World Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cargo ships, the jellyfish and the asteroid belt react to the player's ship: cargo ships swerve, flash and hail; the jellyfish gets curious or startled; belt rocks part around the ship and leave a wake.

**Architecture:** Each subject keeps its existing time-driven motion and adds an eased offset on top, computed by pure functions in `src/utils/` (shared helpers in `reactions.ts`, one logic file per subject) and applied in that subject's own `useFrame`. Nothing changes routes, paths or orbits; every offset eases back to zero.

**Tech Stack:** React 19, TypeScript, @react-three/fiber, three.js, zustand, Vitest, a puppeteer-core e2e harness (`tests/e2e/`).

**Spec:** `docs/superpowers/specs/2026-10-12-world-reactions-design.md`

## Global Constraints

- Reactions only: no code path may give the player a task or request.
- Routes (`CargoTraffic` `ROUTES`), `JELLY_PATH`, `JELLY_NEAR_T` and belt orbit parameters are not edited.
- Movement reactions (swerve, jelly offset, belt push) are off when `useSpaceStore.getState().reducedMotion` is true. Hails are text, not motion, and still fire.
- No new materials, draw calls or shader programs. `deep-space programs` must stay at 79 (docs/PERF-BUDGETS.md).
- Every `useFrame` that applies a reaction clamps `dt` to `Math.min(delta, 0.05)`.
- Debug hooks are registered on `fitzDebug` only under `import.meta.env.DEV`, following the pattern in `FuelCrystals.tsx`.
- Tuning values, verbatim from the spec: cargo react radius 30, swerve max 10, hail radius 20, hail cooldown 45s, no hail while `race.phase === "running"`. Jellyfish curious radius 60, curious max speed 4, rest distance 18, startle radius 40, flee distance 40, leash 80, startle duration 2s, `JELLY_RADIUS` 9. Belt push radius 10.
- Ease timings from the spec (as half-lives): cargo swerve in 0.25s (about 1s to settle) and out 0.75s (about 3s); jellyfish startled 0.25s, curious 0.8s, calm 1.5s (about 6s); belt push 0.04s (about 0.15s) and return 0.6s (about 2.5s).
- Copy is uppercase, in the radio's existing voice. All chatter copy lives in `src/data/chatterLines.ts`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never run `pkill` or `kill -9` by process name, and never install packages (`npm ci` only, to repair).

## Review Focus

1. **A huge `dt` on the first frame after a freeze** (orbit lock or photo mode stop the loop, and `delta` can spike when it resumes). Expected: no overshoot, no NaN, offsets stay within their caps. Pinned by `damp`, `stepJelly` and `stepRock` tests with `dt = 5`.
2. **Coincident positions:** the player exactly on a cargo route point, on the jellyfish, or on a belt rock. Expected: a stable, finite direction rather than NaN. Pinned in Tasks 1, 3, 4 and 5.
3. **The jellyfish led into a planet:** a player hovering near a planet must not drag the creature into it. Expected: it drops to calm. Pinned by the keep-out test in Task 4.
4. **Hail spam:** jumping between ships, re-approaching the same ship, or racing. Expected: one hail per approach, at most one per 45s overall, none during a lap. Pinned by the `HailGate` tests in Task 3.
5. **The tilted halo ring** (tilt 1.31 rad, nearly vertical): a wrong frame conversion would push rocks the wrong way only in the halo. Expected: `toRingLocal` inverts the ring tilt exactly. Pinned for both tilts in Task 5.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/utils/reactions.ts` (create) | Shared pure helpers: `Vec3`, `proximity`, `decay`, `damp`, `dampVec`, `awayFrom`. |
| `src/utils/cargoReaction.ts` (create) | Cargo swerve target and `HailGate`; constants. |
| `src/utils/jellyMood.ts` (create) | Jellyfish mood state machine; constants, including `JELLY_RADIUS`. |
| `src/utils/beltPush.ts` (create) | Belt ring-frame conversion, near-ring test, per-rock push step. |
| `src/utils/chatterScheduler.ts` (modify) | Add the `hail` pool and kind. |
| `src/data/chatterLines.ts` (modify) | Hail lines; replace the outdated belt line. |
| `src/components/canvas/CargoTraffic.tsx` (modify) | Apply swerve, roll, alert lights, hails. |
| `src/components/canvas/SpaceJellyfish.tsx` (modify) | Apply mood offset and mood pulse rate; name the group. |
| `src/components/canvas/AsteroidBelt.tsx` (modify) | Per-rock displacement in `BeltRing`. |
| `src/debug/bridge.ts` (modify) | `cargoSwerve` and `jelly` hooks for the e2e probe. |
| `tests/reactions.test.ts`, `tests/cargoReaction.test.ts`, `tests/jellyMood.test.ts`, `tests/beltPush.test.ts` (create) | Unit tests. |
| `tests/chatterScheduler.test.ts`, `tests/planetClearance.test.ts` (modify) | Hail pool fixture; import `JELLY_RADIUS`. |
| `tests/e2e/reactions.probe.mjs` (create), `tests/e2e/run.mjs` (modify) | End-to-end checks. |

---

### Task 1: Shared reaction helpers

**Files:**
- Create: `src/utils/reactions.ts`
- Test: `tests/reactions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Vec3 { x: number; y: number; z: number }`
  - `proximity(d: number, inner: number, outer: number): number`
  - `decay(halfLife: number, dt: number): number`
  - `damp(current: number, target: number, halfLife: number, dt: number): number`
  - `dampVec(current: Vec3, target: Vec3, halfLife: number, dt: number): void` (mutates `current`)
  - `awayFrom(out: Vec3, from: Vec3, to: Vec3): Vec3` (unit vector from `from` toward `to`; `{0,1,0}` when coincident)

- [ ] **Step 1: Write the failing test**

```ts
// tests/reactions.test.ts
import { describe, it, expect } from "vitest";
import { proximity, decay, damp, dampVec, awayFrom } from "../src/utils/reactions";

describe("proximity", () => {
  it("is 1 at or inside inner and 0 at or beyond outer", () => {
    expect(proximity(0, 10, 30)).toBe(1);
    expect(proximity(10, 10, 30)).toBe(1);
    expect(proximity(30, 10, 30)).toBe(0);
    expect(proximity(99, 10, 30)).toBe(0);
  });
  it("falls monotonically between inner and outer", () => {
    let prev = 1;
    for (let d = 10; d <= 30; d += 0.5) {
      const p = proximity(d, 10, 30);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });
});

describe("decay", () => {
  it("is the per-step factor damp applies", () => {
    expect(decay(1, 1)).toBeCloseTo(0.5);
    expect(decay(0, 1)).toBe(0);
  });
});

describe("damp", () => {
  it("closes half the gap per half-life", () => {
    expect(damp(0, 10, 1, 1)).toBeCloseTo(5);
  });
  it("is frame-rate independent", () => {
    const one = damp(0, 10, 0.5, 0.1);
    let ten = 0;
    for (let i = 0; i < 10; i++) ten = damp(ten, 10, 0.5, 0.01);
    expect(ten).toBeCloseTo(one, 6);
  });
  it("never overshoots, even for a huge dt after a frozen frame", () => {
    const v = damp(0, 10, 0.25, 5);
    expect(v).toBeLessThanOrEqual(10);
    expect(v).toBeGreaterThan(9.99);
  });
  it("snaps to the target when the half-life is zero", () => {
    expect(damp(3, 7, 0, 0.016)).toBe(7);
  });
});

describe("dampVec", () => {
  it("moves each axis like damp", () => {
    const v = { x: 0, y: 10, z: -4 };
    dampVec(v, { x: 10, y: 0, z: 0 }, 1, 1);
    expect(v).toEqual({ x: 5, y: 5, z: -2 });
  });
});

describe("awayFrom", () => {
  it("returns the unit direction from `from` toward `to`", () => {
    const o = { x: 0, y: 0, z: 0 };
    awayFrom(o, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 });
    expect(o.x).toBeCloseTo(0.6);
    expect(o.y).toBeCloseTo(0);
    expect(o.z).toBeCloseTo(0.8);
  });
  it("falls back to straight up when the points coincide", () => {
    const o = { x: 9, y: 9, z: 9 };
    awayFrom(o, { x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 });
    expect(o).toEqual({ x: 0, y: 1, z: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/reactions.test.ts`
Expected: FAIL with `Cannot find module '../src/utils/reactions'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/utils/reactions.ts
/**
 * Shared, pure building blocks for the world reacting to the player's ship
 * (docs/superpowers/specs/2026-10-12-world-reactions-design.md). Every
 * reaction is an eased offset on top of existing motion; these helpers do the
 * easing and the geometry. No three.js scene access, so all of it unit-tests.
 */

export interface Vec3 { x: number; y: number; z: number }

/** 1 at or inside `inner`, 0 at or beyond `outer`, smoothstep between. */
export function proximity(d: number, inner: number, outer: number): number {
  if (d <= inner) return 1;
  if (d >= outer) return 0;
  const t = (outer - d) / (outer - inner);
  return t * t * (3 - 2 * t);
}

/**
 * The factor that closes half the remaining gap every `halfLife` seconds.
 * Computed once per frame when many values share one half-life (the belt).
 */
export function decay(halfLife: number, dt: number): number {
  return halfLife <= 0 ? 0 : Math.pow(0.5, dt / halfLife);
}

/**
 * Frame-rate-independent exponential approach: the same idiom as
 * CargoTraffic's `1 - Math.pow(0.01, dt)`, expressed as a half-life so the
 * spec's "eases in ~1s" maps to a number. Never overshoots, whatever `dt`.
 */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  return target + (current - target) * decay(halfLife, dt);
}

/** `damp` on each axis, in place. */
export function dampVec(current: Vec3, target: Vec3, halfLife: number, dt: number): void {
  const k = decay(halfLife, dt);
  current.x = target.x + (current.x - target.x) * k;
  current.y = target.y + (current.y - target.y) * k;
  current.z = target.z + (current.z - target.z) * k;
}

/**
 * Unit vector from `from` toward `to`, written into `out`. Coincident points
 * give straight up rather than NaN, so a player sitting exactly on a body
 * still gets a defined reaction.
 */
export function awayFrom(out: Vec3, from: Vec3, to: Vec3): Vec3 {
  const x = to.x - from.x, y = to.y - from.y, z = to.z - from.z;
  const len = Math.hypot(x, y, z);
  if (len < 1e-6) { out.x = 0; out.y = 1; out.z = 0; return out; }
  out.x = x / len; out.y = y / len; out.z = z / len;
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/reactions.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/reactions.ts tests/reactions.test.ts
git commit -m "feat(reactions): shared easing and proximity helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Hail lines and the updated belt line

**Files:**
- Modify: `src/utils/chatterScheduler.ts` (the `ChatterPools` interface, `ChatterKind`, `pick`)
- Modify: `src/data/chatterLines.ts` (the `deepSpace` belt line; add `hail`)
- Test: `tests/chatterScheduler.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ChatterPools.hail: string[]`; `ChatterKind` includes `"hail"`; `new ChatterScheduler(chatterPools).pick("hail")` returns a hail line.

- [ ] **Step 1: Write the failing test**

In `tests/chatterScheduler.test.ts`, add `hail` to the fixture and a test:

```ts
const pools: ChatterPools = {
  deepSpace: ["ds-1", "ds-2", "ds-3"],
  zones: { saas: ["saas-1", "saas-2"], video: ["video-1"] },
  warp: ["warp-1", "warp-2"],
  wrap: ["wrap-1"],
  comet: ["comet-1", "comet-2"],
  altitude: ["alt-1", "alt-2"],
  impact: ["imp-1"],
  hail: ["hail-1"],
};
```

Inside `describe("ChatterScheduler", ...)`:

```ts
  it("picks from the hail pool for cargo hails", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("hail")).toBe("hail-1");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/chatterScheduler.test.ts`
Expected: FAIL. The type check rejects the `hail` key, or `pick("hail")` returns a deepSpace line (`"ds-1"`).

- [ ] **Step 3: Implement**

In `src/utils/chatterScheduler.ts`:

```ts
export interface ChatterPools {
  deepSpace: string[];
  zones: Record<string, string[]>;
  warp: string[];
  wrap: string[];
  comet: string[];
  altitude: string[];
  impact: string[];
  /** Cargo ships hailing a pilot who flies close (CargoTraffic). */
  hail: string[];
}

export type ChatterKind = "ambient" | "zone" | "warp" | "wrap" | "comet" | "altitude" | "impact" | "hail";
```

In `pick`, add a branch before the final `else`:

```ts
    else if (kind === "impact") pool = this.pools.impact;
    else if (kind === "hail") pool = this.pools.hail;
    else pool = this.pools.deepSpace;
```

In `src/data/chatterLines.ts`, replace the line `"ASTEROID BELT DENSITY: DECORATIVE",` with:

```ts
    "ASTEROID BELT: POLITE. IT MOVES FOR YOU",
```

and add a `hail` pool to `chatterPools` (after `impact`):

```ts
  hail: [
    "CARGO HAULER: EASY, PILOT. THIS FREIGHT IS UNINSURED",
    "FREIGHTER KV-7: YOU'RE IN OUR LANE. WE'LL ALLOW IT",
    "HAULER NET: SLOW DOWN, PILOT. WE'RE CARRYING CONFIG FILES",
    "CARGO 3: NICE SHIP. WHO RUNS YOUR DEPLOY PIPELINE?",
    "FREIGHTER: GIVING YOU ROOM, PILOT. FLY SAFE",
    "HAULER: IF YOU'RE HIRING, OUR CAPTAIN WRITES TYPESCRIPT",
  ],
```

- [ ] **Step 4: Run the tests and type-check**

Run: `npx vitest run tests/chatterScheduler.test.ts && npx tsc -b`
Expected: PASS; `tsc` prints nothing. If `tsc` reports another `ChatterPools` literal missing `hail`, add `hail` to it.

- [ ] **Step 5: Commit**

```bash
git add src/utils/chatterScheduler.ts src/data/chatterLines.ts tests/chatterScheduler.test.ts
git commit -m "feat(chatter): cargo hail lines; the belt line tells the truth now

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cargo ships swerve, flash and hail

**Files:**
- Create: `src/utils/cargoReaction.ts`
- Modify: `src/components/canvas/CargoTraffic.tsx` (imports, component body, `useFrame`)
- Modify: `src/debug/bridge.ts` (add `cargoSwerve`)
- Test: `tests/cargoReaction.test.ts`

**Interfaces:**
- Consumes: `Vec3`, `proximity`, `dampVec` (Task 1); `ChatterScheduler`, `chatterPools.hail` (Task 2).
- Produces:
  - Constants `CARGO_REACT_RADIUS = 30`, `CARGO_SWERVE_MAX = 10`, `CARGO_HAIL_RADIUS = 20`, `HAIL_COOLDOWN_S = 45`.
  - `cargoSwerveTarget(out: Vec3, routePos: Vec3, tangent: Vec3, player: Vec3): Vec3` (`tangent` must be unit length).
  - `class HailGate { constructor(ships: number); update(i: number, dist: number, now: number, raceRunning: boolean): boolean }`.
  - `fitzDebug.cargoSwerve: Vec3[] | null` (one live offset per ship).

- [ ] **Step 1: Write the failing test**

```ts
// tests/cargoReaction.test.ts
import { describe, it, expect } from "vitest";
import {
  cargoSwerveTarget, HailGate,
  CARGO_REACT_RADIUS, CARGO_SWERVE_MAX, CARGO_HAIL_RADIUS, HAIL_COOLDOWN_S,
} from "../src/utils/cargoReaction";

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const HEADING = v(0, 0, 1); // the route runs along +z here
const len = (o: { x: number; y: number; z: number }) => Math.hypot(o.x, o.y, o.z);

describe("cargoSwerveTarget", () => {
  it("is zero when the player is beyond the react radius", () => {
    expect(cargoSwerveTarget(v(), v(), HEADING, v(CARGO_REACT_RADIUS + 1, 0, 0))).toEqual(v());
  });
  it("pushes sideways and away from the player, never along the route", () => {
    const o = cargoSwerveTarget(v(), v(), HEADING, v(5, 0, 3)); // player off the +x side, a little ahead
    expect(o.x).toBeLessThan(0);
    expect(o.z).toBeCloseTo(0, 6);
  });
  it("is capped at the swerve max", () => {
    expect(len(cargoSwerveTarget(v(), v(), HEADING, v(0.5, 0, 0)))).toBeCloseTo(CARGO_SWERVE_MAX);
  });
  it("grows as the player closes in", () => {
    const far = cargoSwerveTarget(v(), v(), HEADING, v(25, 0, 0));
    const near = cargoSwerveTarget(v(), v(), HEADING, v(15, 0, 0));
    expect(len(near)).toBeGreaterThan(len(far));
  });
  it("still picks a finite sideways direction when the player is dead ahead on the route", () => {
    const o = cargoSwerveTarget(v(), v(), HEADING, v(0, 0, 5));
    expect([o.x, o.y, o.z].every(Number.isFinite)).toBe(true);
    expect(len(o)).toBeGreaterThan(0);
    expect(o.z).toBeCloseTo(0, 6);
  });
});

describe("HailGate", () => {
  it("hails once per approach", () => {
    const g = new HailGate(1);
    expect(g.update(0, CARGO_HAIL_RADIUS - 1, 0, false)).toBe(true);
    expect(g.update(0, CARGO_HAIL_RADIUS - 1, 100, false)).toBe(false);
  });
  it("re-arms once the player has left the react radius", () => {
    const g = new HailGate(1);
    g.update(0, 5, 0, false);
    g.update(0, CARGO_REACT_RADIUS + 1, 50, false);
    expect(g.update(0, 5, 100, false)).toBe(true);
  });
  it("holds one cooldown across all ships", () => {
    const g = new HailGate(2);
    expect(g.update(0, 5, 0, false)).toBe(true);
    expect(g.update(1, 5, HAIL_COOLDOWN_S - 1, false)).toBe(false);
  });
  it("lets another ship hail after the cooldown", () => {
    const g = new HailGate(2);
    g.update(0, 5, 0, false);
    expect(g.update(1, 5, HAIL_COOLDOWN_S + 1, false)).toBe(true);
  });
  it("stays silent during a running race, and that approach is spent", () => {
    const g = new HailGate(1);
    expect(g.update(0, 5, 0, true)).toBe(false);
    expect(g.update(0, 5, 100, false)).toBe(false);
  });
  it("does not hail between the hail radius and the react radius", () => {
    const g = new HailGate(1);
    expect(g.update(0, (CARGO_HAIL_RADIUS + CARGO_REACT_RADIUS) / 2, 0, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cargoReaction.test.ts`
Expected: FAIL with `Cannot find module '../src/utils/cargoReaction'`.

- [ ] **Step 3: Implement the logic**

```ts
// src/utils/cargoReaction.ts
import { proximity, type Vec3 } from "./reactions";

/** Cargo ships react inside this distance of the player (spec: ~30u). */
export const CARGO_REACT_RADIUS = 30;
/** Largest sideways slide off the route (spec: ~10u). */
export const CARGO_SWERVE_MAX = 10;
/** A ship hails when the player first comes this close (spec: ~20u). */
export const CARGO_HAIL_RADIUS = 20;
/** At most one hail across all ships per this many seconds. */
export const HAIL_COOLDOWN_S = 45;

/** Full swerve inside this share of the react radius; it ramps off beyond. */
const FULL_SWERVE_AT = 0.4;

/**
 * The offset a cargo ship wants right now: sideways to its route (the part of
 * "away from the player" that is perpendicular to `tangent`), scaled by how
 * close the player is. A player dead ahead or behind on the route line has no
 * sideways component, so the ship then picks its horizontal right-hand side.
 * Writes and returns `out`. `tangent` must be unit length.
 */
export function cargoSwerveTarget(out: Vec3, routePos: Vec3, tangent: Vec3, player: Vec3): Vec3 {
  const dx = routePos.x - player.x, dy = routePos.y - player.y, dz = routePos.z - player.z;
  const p = proximity(Math.hypot(dx, dy, dz), CARGO_REACT_RADIUS * FULL_SWERVE_AT, CARGO_REACT_RADIUS);
  if (p === 0) { out.x = 0; out.y = 0; out.z = 0; return out; }
  const along = dx * tangent.x + dy * tangent.y + dz * tangent.z;
  let sx = dx - along * tangent.x, sy = dy - along * tangent.y, sz = dz - along * tangent.z;
  let len = Math.hypot(sx, sy, sz);
  if (len < 1e-6) {
    sx = tangent.z; sy = 0; sz = -tangent.x;
    len = Math.hypot(sx, sz);
    if (len < 1e-6) { sx = 1; sz = 0; len = 1; } // vertical route: any horizontal side
  }
  const k = (CARGO_SWERVE_MAX * p) / len;
  out.x = sx * k; out.y = sy * k; out.z = sz * k;
  return out;
}

/**
 * Decides when a cargo ship hails: once per approach (re-armed only after the
 * player has left the react radius), at most once per HAIL_COOLDOWN_S across
 * every ship, and never during a running time-trial lap. An approach that
 * reaches the hail radius while suppressed is spent, not deferred, so a hail
 * never fires late, after the moment has passed.
 */
export class HailGate {
  private armed: boolean[];
  private lastHailAt = -Infinity;

  constructor(ships: number) {
    this.armed = Array.from({ length: ships }, () => true);
  }

  /** `now` is game time in seconds. Returns true when ship `i` should hail. */
  update(i: number, dist: number, now: number, raceRunning: boolean): boolean {
    if (dist > CARGO_REACT_RADIUS) { this.armed[i] = true; return false; }
    if (dist > CARGO_HAIL_RADIUS || !this.armed[i]) return false;
    this.armed[i] = false;
    if (raceRunning || now - this.lastHailAt < HAIL_COOLDOWN_S) return false;
    this.lastHailAt = now;
    return true;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/cargoReaction.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Add the debug hook**

In `src/debug/bridge.ts`, add to `interface FitzDebug` (after `anomalies`):

```ts
  /** Live cargo swerve offsets, one per ship, registered by CargoTraffic in dev. */
  cargoSwerve: { x: number; y: number; z: number }[] | null;
```

and to the `fitzDebug` object (after `anomalies: null,`):

```ts
  cargoSwerve: null,
```

- [ ] **Step 6: Wire it into CargoTraffic**

In `src/components/canvas/CargoTraffic.tsx`, change the imports to:

```ts
import { useRef, useMemo, useEffect, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF, Trail } from "@react-three/drei";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { ambientTime, gameTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";
import { dampVec } from "../../utils/reactions";
import { cargoSwerveTarget, HailGate, CARGO_REACT_RADIUS } from "../../utils/cargoReaction";
import { ChatterScheduler } from "../../utils/chatterScheduler";
import { chatterPools } from "../../data/chatterLines";
import { fitzDebug } from "../../debug/bridge";
```

Below the existing `const tanB = new THREE.Vector3();`, add:

```ts
const UP = new THREE.Vector3(0, 1, 0);
const right = new THREE.Vector3();
const swerveTarget = { x: 0, y: 0, z: 0 };
/** Spec: swerve in over ~1s, settle back over ~3s (half-lives). */
const SWERVE_IN_HALFLIFE = 0.25;
const SWERVE_OUT_HALFLIFE = 0.75;
/** Roll (rad) per unit/s of sideways swerve velocity, so the slide reads as piloted. */
const SWERVE_ROLL = 0.08;
const hailLines = new ChatterScheduler(chatterPools);
```

Inside the component, after `const rolls = useRef<number[]>(SHIPS.map(() => 0));`, add:

```ts
  const offsets = useMemo(() => SHIPS.map(() => new THREE.Vector3()), []);
  const hailGate = useMemo(() => new HailGate(SHIPS.length), []);

  // Mirrored onto the bridge purely so the e2e probe can read it.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.cargoSwerve = offsets;
    return () => { fitzDebug.cargoSwerve = null; };
  }, [offsets]);
```

Replace the whole `useFrame` with the code below. Move the existing comment block about the speed wobble (the one above `const drift`) into the marked spot unchanged.

```ts
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const elapsed = state.clock.getElapsedTime();
    const time = ambientTime(elapsed);
    const now = gameTime(elapsed);
    const store = useSpaceStore.getState();
    const react = !store.reducedMotion;
    const raceRunning = store.race.phase === "running";
    for (let i = 0; i < count; i++) {
      const def = SHIPS[i];
      const ship = ships[i];
      const curve = ROUTES[def.route];
      // <-- existing speed-wobble comment block goes here, unchanged -->
      const drift = (Math.sin(time * 0.12 + i * 1.7) * 0.010 + Math.sin(time * 0.27 + i * 0.9) * 0.005);
      const t = (time / def.loopSeconds + def.phase + drift) % 1;

      const pos = ship.group.position;
      curve.getPointAt(t, pos);
      curve.getTangentAt(t, tanA);
      const dist = Math.hypot(pos.x - flight.x, pos.y - flight.y, pos.z - flight.z);

      // Swerve: an eased sideways offset on top of the route, never a route change.
      const off = offsets[i];
      const prevX = off.x, prevY = off.y, prevZ = off.z;
      if (react) {
        cargoSwerveTarget(swerveTarget, pos, tanA, flight);
        const swerving = swerveTarget.x !== 0 || swerveTarget.y !== 0 || swerveTarget.z !== 0;
        dampVec(off, swerveTarget, swerving ? SWERVE_IN_HALFLIFE : SWERVE_OUT_HALFLIFE, dt);
      }
      // Hails are text, not motion: they run under reduced motion too.
      if (hailGate.update(i, dist, now, raceRunning)) store.sendBroadcast(hailLines.pick("hail"));

      pos.y += Math.sin(time * 0.6 + i * 2.1) * 0.35;
      pos.add(off);
      curve.getPointAt((t + 0.003) % 1, lookTarget);
      lookTarget.add(off);
      ship.group.lookAt(lookTarget);

      // Banking: roll into the route's curvature, plus into the swerve's slide.
      right.crossVectors(tanA, UP).normalize();
      const lateral = dt > 0
        ? ((off.x - prevX) * right.x + (off.y - prevY) * right.y + (off.z - prevZ) * right.z) / dt
        : 0;
      curve.getTangentAt((t + 0.01) % 1, tanB);
      let targetRoll = THREE.MathUtils.clamp(tanA.cross(tanB).y * 60, -0.5, 0.5);
      targetRoll += THREE.MathUtils.clamp(lateral * SWERVE_ROLL, -0.6, 0.6);
      rolls.current[i] += (targetRoll - rolls.current[i]) * (1 - Math.pow(0.01, dt));
      ship.group.rotateZ(rolls.current[i]);

      // Nav lights: a slow blink, or a rapid alert flash while the player is close.
      const blink = dist < CARGO_REACT_RADIUS
        ? (Math.sin(time * 14 + i) > 0 ? 6 : 0.4)
        : (Math.sin(time * 3 + i * 1.7) > 0.82 ? 4.5 : 0.3);
      for (const m of ship.navMats) m.emissiveIntensity = blink;

      // Engine burn: uneven thruster flicker, per-ship phase
      const burn = 2.6 + Math.sin(time * 7.3 + i * 2.3) * 0.6 + Math.sin(time * 13.7 + i) * 0.3;
      for (const m of ship.engineMats) m.emissiveIntensity = burn;

      // Radar dish: constant spin, on the ambient clock like everything else
      // in this loop (dt would keep it spinning under reduced motion).
      if (ship.dish) ship.dish.rotation.z = time * 1.2;
    }
  });
```

The old `dx`/`dy`/`dz` "extra roll away from the player when close" lines are gone in this version, because the swerve roll replaces them.

- [ ] **Step 7: Type-check and run the unit tests**

Run: `npx tsc -b && npx vitest run`
Expected: `tsc` prints nothing; all tests pass.

- [ ] **Step 8: Check it visually**

Run `npx vite --port 5179 --strictPort` in the background and open `http://localhost:5179/`. In the devtools console:

```js
const g = window.__fitz.scene.getObjectByName("CargoShip0");
window.__fitz.teleport(g.position.x + 6, g.position.y + 4, g.position.z);
```

Expected:
- The cargo ship slides away from you over about a second and banks into the slide.
- Its nav lights flash rapidly.
- One `CARGO`/`FREIGHTER`/`HAULER` line types out on the radio.
- Once you've flown off, it eases back onto its route.

If it banks *toward* the side it slides to and that reads wrong, flip the sign of `SWERVE_ROLL`.

- [ ] **Step 9: Commit**

```bash
git add src/utils/cargoReaction.ts tests/cargoReaction.test.ts src/components/canvas/CargoTraffic.tsx src/debug/bridge.ts
git commit -m "feat(cargo): ships swerve around the pilot, flash, and hail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The jellyfish gets curious or startled

**Files:**
- Create: `src/utils/jellyMood.ts`
- Modify: `src/components/canvas/SpaceJellyfish.tsx` (imports, component body, `useFrame`, group name)
- Modify: `src/debug/bridge.ts` (add `jelly`)
- Modify: `tests/planetClearance.test.ts` (import `JELLY_RADIUS` instead of redefining it)
- Test: `tests/jellyMood.test.ts`

**Interfaces:**
- Consumes: `Vec3`, `awayFrom`, `dampVec`, `damp` (Task 1).
- Produces:
  - `type JellyMood = "calm" | "curious" | "startled"`.
  - `interface JellyState { mood: JellyMood; offset: Vec3; target: Vec3; startledFor: number }`.
  - `interface JellyKeepOut { x: number; y: number; z: number; r: number }`.
  - `interface JellyInput { pathPos: Vec3; player: Vec3; playerSpeed: number; boosting: boolean; keepOut: readonly JellyKeepOut[]; dt: number }`.
  - `createJellyState(): JellyState` and `stepJelly(s: JellyState, inp: JellyInput): JellyState` (mutates and returns `s`).
  - Constants `JELLY_RADIUS = 9`, `JELLY_CURIOUS_RADIUS = 60`, `JELLY_CURIOUS_MAX_SPEED = 4`, `JELLY_REST_DIST = 18`, `JELLY_STARTLE_RADIUS = 40`, `JELLY_FLEE_DIST = 40`, `JELLY_LEASH = 80`, `JELLY_STARTLE_SECONDS = 2`, and `JELLY_PULSE_RATE: Record<JellyMood, number>`.
  - `fitzDebug.jelly: JellyState | null`, and a scene object named `"SpaceJellyfish"`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/jellyMood.test.ts
import { describe, it, expect } from "vitest";
import {
  createJellyState, stepJelly, type JellyInput, type JellyState,
  JELLY_REST_DIST, JELLY_LEASH, JELLY_STARTLE_SECONDS,
} from "../src/utils/jellyMood";

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const input = (over: Partial<JellyInput> = {}): JellyInput => ({
  pathPos: v(), player: v(30, 0, 0), playerSpeed: 0, boosting: false, keepOut: [], dt: 0.1, ...over,
});
const run = (s: JellyState, inp: JellyInput, seconds: number) => {
  for (let t = 0; t < seconds; t += inp.dt) stepJelly(s, inp);
  return s;
};
const jellyAt = (s: JellyState, inp: JellyInput) =>
  v(inp.pathPos.x + s.offset.x, inp.pathPos.y + s.offset.y, inp.pathPos.z + s.offset.z);
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const len = (o: { x: number; y: number; z: number }) => Math.hypot(o.x, o.y, o.z);

describe("stepJelly", () => {
  it("stays calm and on its path when the player is far away", () => {
    const s = stepJelly(createJellyState(), input({ player: v(100, 0, 0) }));
    expect(s.mood).toBe("calm");
    expect(s.offset).toEqual(v());
  });

  it("turns curious and settles at the rest distance when the player hovers close", () => {
    const inp = input();
    const s = run(createJellyState(), inp, 8);
    expect(s.mood).toBe("curious");
    expect(dist(jellyAt(s, inp), inp.player)).toBeCloseTo(JELLY_REST_DIST, 0);
  });

  it("ignores a player flying past fast", () => {
    const s = run(createJellyState(), input({ playerSpeed: 8 }), 2);
    expect(s.mood).toBe("calm");
    expect(len(s.offset)).toBeLessThan(1e-6);
  });

  it("startles on a boost nearby and darts away", () => {
    const inp = input({ player: v(20, 0, 0), boosting: true });
    const s = run(createJellyState(), inp, 1);
    expect(s.mood).toBe("startled");
    expect(dist(jellyAt(s, inp), inp.player)).toBeGreaterThan(35);
  });

  it("lets a startle override curiosity", () => {
    const s = run(createJellyState(), input(), 3);
    expect(s.mood).toBe("curious");
    stepJelly(s, input({ boosting: true }));
    expect(s.mood).toBe("startled");
  });

  it("calms down after the startle and eases home", () => {
    const s = run(createJellyState(), input({ player: v(20, 0, 0), boosting: true }), 0.5);
    run(s, input({ player: v(200, 0, 0) }), JELLY_STARTLE_SECONDS + 0.5);
    expect(s.mood).toBe("calm");
    run(s, input({ player: v(200, 0, 0) }), 12);
    expect(len(s.offset)).toBeLessThan(0.5);
  });

  it("never strays beyond the leash, and gives up when towed past it", () => {
    const s = createJellyState();
    for (let x = 30; x <= 150; x += 0.5) {
      stepJelly(s, input({ player: v(x, 0, 0) }));
      expect(len(s.offset)).toBeLessThanOrEqual(JELLY_LEASH + 1e-9);
    }
    expect(s.mood).toBe("calm");
  });

  it("won't follow the player into a planet's keep-out", () => {
    // Player at +30, jelly at the origin: the resting point would be (12,0,0).
    const s = stepJelly(createJellyState(), input({ keepOut: [{ x: 12, y: 0, z: 0, r: 10 }] }));
    expect(s.mood).toBe("calm");
  });

  it("survives a huge dt after a frozen frame", () => {
    const s = stepJelly(createJellyState(), input({ dt: 5 }));
    expect([s.offset.x, s.offset.y, s.offset.z].every(Number.isFinite)).toBe(true);
    expect(len(s.offset)).toBeLessThanOrEqual(JELLY_LEASH);
  });

  it("handles the player sitting exactly on the jellyfish", () => {
    const s = stepJelly(createJellyState(), input({ player: v() }));
    expect([s.offset.x, s.offset.y, s.offset.z].every(Number.isFinite)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/jellyMood.test.ts`
Expected: FAIL with `Cannot find module '../src/utils/jellyMood'`.

- [ ] **Step 3: Implement the logic**

```ts
// src/utils/jellyMood.ts
import { awayFrom, dampVec, type Vec3 } from "./reactions";

export type JellyMood = "calm" | "curious" | "startled";

/** `offset` is added to the path position; `target` is where the offset is easing to. */
export interface JellyState { mood: JellyMood; offset: Vec3; target: Vec3; startledFor: number }

/** A sphere the curious resting point must stay out of (a planet's zone plus the body). */
export interface JellyKeepOut { x: number; y: number; z: number; r: number }

export interface JellyInput {
  /** Where the path (plus swim surge and bob) puts the jellyfish this frame. */
  pathPos: Vec3;
  player: Vec3;
  playerSpeed: number;
  boosting: boolean;
  keepOut: readonly JellyKeepOut[];
  dt: number;
}

/** Body radius: creature.glb spans ±1, drawn at scale 6, sway-padded 1.5x. */
export const JELLY_RADIUS = 9;
export const JELLY_CURIOUS_RADIUS = 60;
/** Cruise max is 10.8; under this the player reads as hovering. */
export const JELLY_CURIOUS_MAX_SPEED = 4;
export const JELLY_REST_DIST = 18;
export const JELLY_STARTLE_RADIUS = 40;
export const JELLY_FLEE_DIST = 40;
/** Never more than this from where the path puts it: keeps the rare-sighting rhythm. */
export const JELLY_LEASH = 80;
export const JELLY_STARTLE_SECONDS = 2;

/** Spec: dart ~1s, follow gently, ease home ~6s (as half-lives). */
const HALF_LIFE: Record<JellyMood, number> = { startled: 0.25, curious: 0.8, calm: 1.5 };

/** Pulse-rate multiplier: calm interest beats slower, fright faster. */
export const JELLY_PULSE_RATE: Record<JellyMood, number> = { calm: 1, curious: 0.8, startled: 1.7 };

export function createJellyState(): JellyState {
  return { mood: "calm", offset: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, startledFor: 0 };
}

const jelly = { x: 0, y: 0, z: 0 };
const dir = { x: 0, y: 0, z: 0 };

function setTarget(s: JellyState, x: number, y: number, z: number) {
  const l = Math.hypot(x, y, z);
  const k = l > JELLY_LEASH ? JELLY_LEASH / l : 1;
  s.target.x = x * k; s.target.y = y * k; s.target.z = z * k;
}

/**
 * One frame of the jellyfish's mood (spec table). A boost within the startle
 * radius beats everything; a startle runs its course; otherwise a slow player
 * close by makes it curious, unless its resting spot would break the leash or
 * sit inside a planet's keep-out, in which case it stays calm.
 */
export function stepJelly(s: JellyState, inp: JellyInput): JellyState {
  const { pathPos, player, dt } = inp;
  jelly.x = pathPos.x + s.offset.x; jelly.y = pathPos.y + s.offset.y; jelly.z = pathPos.z + s.offset.z;
  const dist = Math.hypot(jelly.x - player.x, jelly.y - player.y, jelly.z - player.z);

  if (inp.boosting && dist < JELLY_STARTLE_RADIUS) {
    awayFrom(dir, player, jelly);
    s.mood = "startled";
    s.startledFor = JELLY_STARTLE_SECONDS;
    setTarget(s, s.offset.x + dir.x * JELLY_FLEE_DIST, s.offset.y + dir.y * JELLY_FLEE_DIST, s.offset.z + dir.z * JELLY_FLEE_DIST);
  } else if (s.mood === "startled") {
    s.startledFor -= dt;
    if (s.startledFor <= 0) { s.mood = "calm"; setTarget(s, 0, 0, 0); }
  } else if (dist < JELLY_CURIOUS_RADIUS && inp.playerSpeed < JELLY_CURIOUS_MAX_SPEED && !inp.boosting) {
    awayFrom(dir, player, jelly);
    const rx = player.x + dir.x * JELLY_REST_DIST, ry = player.y + dir.y * JELLY_REST_DIST, rz = player.z + dir.z * JELLY_REST_DIST;
    const ox = rx - pathPos.x, oy = ry - pathPos.y, oz = rz - pathPos.z;
    let blocked = Math.hypot(ox, oy, oz) > JELLY_LEASH;
    for (const k of inp.keepOut) {
      if (Math.hypot(rx - k.x, ry - k.y, rz - k.z) < k.r) { blocked = true; break; }
    }
    if (blocked) { s.mood = "calm"; setTarget(s, 0, 0, 0); }
    else { s.mood = "curious"; setTarget(s, ox, oy, oz); }
  } else {
    s.mood = "calm";
    setTarget(s, 0, 0, 0);
  }

  dampVec(s.offset, s.target, HALF_LIFE[s.mood], dt);
  return s;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/jellyMood.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Make the clearance test use the shared radius**

In `tests/planetClearance.test.ts`:
- Delete the lines `/** Jellyfish body radius: creature.glb spans ±1, drawn at scale 6, sway-padded 1.5x. */` and `const JELLY_RADIUS = 9;`.
- Add an import: `import { JELLY_RADIUS } from "../src/utils/jellyMood";`.

Run: `npx vitest run tests/planetClearance.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the debug hook**

In `src/debug/bridge.ts`, add `import type { JellyState } from "../utils/jellyMood";` with the other imports. Add to `interface FitzDebug`:

```ts
  /** Live jellyfish mood and offset, registered by SpaceJellyfish in dev. */
  jelly: JellyState | null;
```

and add `jelly: null,` to the `fitzDebug` object.

- [ ] **Step 7: Wire it into SpaceJellyfish**

In `src/components/canvas/SpaceJellyfish.tsx`, add these imports:

```ts
import { flight, useSpaceStore, bodies } from "../../store/spaceStore";
import { planets, ZONE_FACTOR } from "../../constants";
import { damp } from "../../utils/reactions";
import { createJellyState, stepJelly, JELLY_PULSE_RATE, JELLY_RADIUS, type JellyKeepOut } from "../../utils/jellyMood";
import { fitzDebug } from "../../debug/bridge";
```

After `const tOffset = useRef(0);`, add:

```ts
  const jelly = useMemo(createJellyState, []);
  const pathPos = useMemo(() => new THREE.Vector3(), []);
  const keepOut = useMemo<JellyKeepOut[]>(
    () => planets.map((p) => ({ x: 0, y: 0, z: 0, r: p.size * ZONE_FACTOR + JELLY_RADIUS })), []);
  // The pulse runs on its own accumulated clock so its rate can follow the
  // mood without jumping the phase. It advances on ambient time, so it still
  // freezes under reduced motion.
  const pulseClock = useRef(0);
  const pulseRate = useRef(1);
  const lastAmbient = useRef<number | null>(null);

  // Mirrored onto the bridge purely so the e2e probe can read it.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.jelly = jelly;
    return () => { fitzDebug.jelly = null; };
  }, [jelly]);
```

In `useFrame`, change the signature to `useFrame((state, delta) => {`. Replace everything from `const pulseTime = time + 4 * Math.sin(time * 0.045);` through the closing `);` of `groupRef.current.rotation.set(...)` with the block below. Keep the long pulse-rhythm comment above it, and add one line to it: "The base clock now accumulates at a mood-dependent rate (JELLY_PULSE_RATE)."

```ts
    const dt = Math.min(delta, 0.05);
    const step = lastAmbient.current === null ? 0 : time - lastAmbient.current;
    lastAmbient.current = time;
    pulseRate.current = damp(pulseRate.current, JELLY_PULSE_RATE[jelly.mood], 0.5, dt);
    pulseClock.current += step * pulseRate.current;
    const pulseTime = pulseClock.current + 4 * Math.sin(time * 0.045);
    material.uniforms.uTime.value = pulseTime;
    const t = ((time / JELLY_LOOP_SECONDS + tOffset.current) % 1 + 1) % 1;
    JELLY_PATH.getPointAt(t, pathPos);
    const tangent = JELLY_PATH.getTangentAt(t);
    const surge = pulseCycle(pulseTime - 0.15);
    pathPos.addScaledVector(tangent, surge * 2.2);
    pathPos.y += Math.sin(time * 0.5) * 0.8;

    // Mood: an eased offset off the path toward or away from the pilot.
    const store = useSpaceStore.getState();
    if (!store.reducedMotion) {
      planets.forEach((p, i) => {
        const b = bodies[p.name];
        keepOut[i].x = b.x; keepOut[i].y = b.y; keepOut[i].z = b.z;
      });
      stepJelly(jelly, {
        pathPos, player: flight, playerSpeed: flight.speed, boosting: store.isWarping, keepOut, dt,
      });
    }
    groupRef.current.position.set(pathPos.x + jelly.offset.x, pathPos.y + jelly.offset.y, pathPos.z + jelly.offset.z);
    groupRef.current.rotation.set(
      tangent.z * 0.12 + Math.sin(time * 0.31) * 0.06,
      Math.sin(time * 0.23) * 0.25,
      -tangent.x * 0.12 + Math.cos(time * 0.27) * 0.06
    );
```

Keep the existing surge comments where they were, above `const surge`. Leave the `setScannable("jellyfish", ...)` call after this block unchanged; it already reads `groupRef.current.position`, which is now the displaced position.

Finally, name the group: `<group ref={groupRef} name="SpaceJellyfish" scale={6}>`.

- [ ] **Step 8: Type-check and run the unit tests**

Run: `npx tsc -b && npx vitest run`
Expected: `tsc` prints nothing; all tests pass.

- [ ] **Step 9: Check it visually**

With the dev server running, press `J` to summon the jellyfish, then in the console:

```js
const j = window.__fitz.scene.getObjectByName("SpaceJellyfish").position;
window.__fitz.teleport(j.x + 30, j.y, j.z);
```

Don't touch the controls. Expected:
- The jellyfish drifts toward you and settles about 18u away, pulsing slower. `window.__fitz.jelly.mood` is `"curious"`.
- When you hold Shift, it darts away and pulses fast (`"startled"`), then calms.

- [ ] **Step 10: Commit**

```bash
git add src/utils/jellyMood.ts tests/jellyMood.test.ts tests/planetClearance.test.ts src/components/canvas/SpaceJellyfish.tsx src/debug/bridge.ts
git commit -m "feat(jellyfish): curious when you hover, startled when you boost

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The belt parts around the ship

**Files:**
- Create: `src/utils/beltPush.ts`
- Modify: `src/components/canvas/AsteroidBelt.tsx` (imports, `BeltRing`)
- Test: `tests/beltPush.test.ts`

**Interfaces:**
- Consumes: `Vec3`, `decay` (Task 1).
- Produces: `BELT_PUSH_RADIUS = 10`, `BELT_PUSH_HALFLIFE = 0.04`, `BELT_RETURN_HALFLIFE = 0.6`; `toRingLocal(out: Vec3, p: Vec3, tilt: number): Vec3`; `nearRing(p: Vec3, rMin: number, rMax: number): boolean`; `stepRock(disp: Float32Array, i: number, rx: number, ry: number, rz: number, ship: Vec3 | null, kPush: number, kReturn: number): void`.

**Note on the spec:** the spec scales the push strength `(R − dist)` by a smoothstep. That would leave rocks *inside* the radius, contradicting its own test ("a rock at the ship's position is displaced at least R"). This plan uses plain `(R − dist)`, which puts a pushed rock exactly on the radius surface.

- [ ] **Step 1: Write the failing test**

```ts
// tests/beltPush.test.ts
import { describe, it, expect } from "vitest";
import {
  toRingLocal, nearRing, stepRock,
  BELT_PUSH_RADIUS, BELT_PUSH_HALFLIFE, BELT_RETURN_HALFLIFE,
} from "../src/utils/beltPush";
import { decay } from "../src/utils/reactions";

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const DT = 1 / 60;
const kP = decay(BELT_PUSH_HALFLIFE, DT);
const kR = decay(BELT_RETURN_HALFLIFE, DT);
const dispLen = (d: Float32Array, i = 0) => Math.hypot(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]);

describe("toRingLocal", () => {
  it("is the identity for an untilted ring", () => {
    expect(toRingLocal(v(), v(1, 2, 3), 0)).toEqual(v(1, 2, 3));
  });
  // Both shipped rings: BeltMain (0.436) and the near-vertical BeltHalo (1.31).
  for (const tilt of [0.436, 1.31]) {
    it(`inverts the ring's X tilt of ${tilt}`, () => {
      // A ring-local point (0,0,10), rotated into the world by Rx(tilt)...
      const c = Math.cos(tilt), s = Math.sin(tilt);
      const world = v(0, -s * 10, c * 10);
      // ...comes back to (0,0,10).
      const back = toRingLocal(v(), world, tilt);
      expect(back.x).toBeCloseTo(0, 9);
      expect(back.y).toBeCloseTo(0, 9);
      expect(back.z).toBeCloseTo(10, 9);
    });
  }
});

describe("nearRing", () => {
  it("is true inside the ring's band, padded by the push radius", () => {
    expect(nearRing(v(55, 0, 0), 40, 70)).toBe(true);
    expect(nearRing(v(40 - BELT_PUSH_RADIUS + 1, 0, 0), 40, 70)).toBe(true);
  });
  it("is false well away from it", () => {
    expect(nearRing(v(0, 0, 0), 40, 70)).toBe(false);
    expect(nearRing(v(200, 0, 0), 40, 70)).toBe(false);
  });
});

describe("stepRock", () => {
  it("pushes a rock at the ship's position out to the push radius", () => {
    const d = new Float32Array(3);
    for (let n = 0; n < 60; n++) stepRock(d, 0, 0, 0, 0, v(), kP, kR);
    expect(dispLen(d)).toBeGreaterThan(BELT_PUSH_RADIUS - 0.01);
  });
  it("pushes directly away from the ship", () => {
    const d = new Float32Array(3);
    for (let n = 0; n < 60; n++) stepRock(d, 0, 4, 0, 0, v(), kP, kR); // rock 4u along +x
    expect(d[0]).toBeCloseTo(BELT_PUSH_RADIUS - 4, 2);
    expect(d[1]).toBeCloseTo(0, 6);
    expect(d[2]).toBeCloseTo(0, 6);
  });
  it("leaves a rock beyond the push radius alone", () => {
    const d = new Float32Array(3);
    stepRock(d, 0, BELT_PUSH_RADIUS + 1, 0, 0, v(), kP, kR);
    expect(dispLen(d)).toBe(0);
  });
  it("springs back toward its orbit once the ship has gone", () => {
    const d = new Float32Array([5, 0, 0]);
    for (let n = 0; n < 150; n++) stepRock(d, 0, 0, 0, 0, null, kP, kR); // 2.5s
    expect(dispLen(d)).toBeLessThan(0.5);
  });
  it("addresses rock i's own slots in a shared buffer", () => {
    const d = new Float32Array(9);
    for (let n = 0; n < 60; n++) stepRock(d, 1, 0, 0, 0, v(), kP, kR);
    expect(dispLen(d, 0)).toBe(0);
    expect(dispLen(d, 1)).toBeGreaterThan(BELT_PUSH_RADIUS - 0.01);
    expect(dispLen(d, 2)).toBe(0);
  });
  it("lands exactly on target, finite, after a huge dt", () => {
    const d = new Float32Array(3);
    stepRock(d, 0, 0, 0, 0, v(), decay(BELT_PUSH_HALFLIFE, 5), decay(BELT_RETURN_HALFLIFE, 5));
    expect([d[0], d[1], d[2]].every(Number.isFinite)).toBe(true);
    expect(dispLen(d)).toBeCloseTo(BELT_PUSH_RADIUS, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/beltPush.test.ts`
Expected: FAIL with `Cannot find module '../src/utils/beltPush'`.

- [ ] **Step 3: Implement the logic**

```ts
// src/utils/beltPush.ts
import type { Vec3 } from "./reactions";

/** Rocks closer than this to the ship get pushed out to it (spec: R ≈ 10u). */
export const BELT_PUSH_RADIUS = 10;
/** Spec: clear the ship's path in ~0.15s... */
export const BELT_PUSH_HALFLIFE = 0.04;
/** ...and spring back over ~2.5s, so the ship leaves a wake that closes behind it. */
export const BELT_RETURN_HALFLIFE = 0.6;

/**
 * The ship's position in a ring's local frame. Each BeltRing sits in a group
 * rotated `tilt` about X, so this applies the inverse rotation, Rx(-tilt).
 */
export function toRingLocal(out: Vec3, p: Vec3, tilt: number): Vec3 {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const y = c * p.y + s * p.z;
  const z = -s * p.y + c * p.z;
  out.x = p.x; out.y = y; out.z = z;
  return out;
}

/**
 * Whether the ship can reach any rock of a ring spanning rMin..rMax from the
 * origin. Distance from the origin is the same in every frame, so this needs
 * no tilt. Most frames the ship is nowhere near a belt and the push is skipped.
 */
export function nearRing(p: Vec3, rMin: number, rMax: number): boolean {
  const r = Math.hypot(p.x, p.y, p.z);
  return r >= rMin - BELT_PUSH_RADIUS && r <= rMax + BELT_PUSH_RADIUS;
}

/**
 * Eases rock `i`'s displacement (disp[i*3 .. i*3+2]) toward its target. A rock
 * whose orbit position (rx, ry, rz) is within the push radius of `ship` (both
 * ring-local) targets the radius surface, directly away from the ship;
 * otherwise it targets zero. Distance is measured from the orbit position, not
 * the displaced one, so a pushed rock holds still rather than oscillating.
 * `kPush`/`kReturn` come from `decay(halfLife, dt)`, computed once per frame.
 */
export function stepRock(
  disp: Float32Array, i: number, rx: number, ry: number, rz: number,
  ship: Vec3 | null, kPush: number, kReturn: number,
): void {
  const j = i * 3;
  let tx = 0, ty = 0, tz = 0, k = kReturn;
  if (ship) {
    let dx = rx - ship.x, dy = ry - ship.y, dz = rz - ship.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < BELT_PUSH_RADIUS) {
      if (d < 1e-6) { dx = 0; dy = 1; dz = 0; } else { dx /= d; dy /= d; dz /= d; }
      const push = BELT_PUSH_RADIUS - d;
      tx = dx * push; ty = dy * push; tz = dz * push;
      k = kPush;
    }
  }
  disp[j] = tx + (disp[j] - tx) * k;
  disp[j + 1] = ty + (disp[j + 1] - ty) * k;
  disp[j + 2] = tz + (disp[j + 2] - tz) * k;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/beltPush.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Wire it into AsteroidBelt**

In `src/components/canvas/AsteroidBelt.tsx`, change the store import and add the others:

```ts
import { useSpaceStore, flight } from "../../store/spaceStore";
import { decay } from "../../utils/reactions";
import {
  toRingLocal, nearRing, stepRock, BELT_PUSH_HALFLIFE, BELT_RETURN_HALFLIFE,
} from "../../utils/beltPush";
```

Below `const dummy = new THREE.Object3D();`, add:

```ts
/** Scratch for the ship's ring-local position (one per frame per ring). */
const shipLocal = { x: 0, y: 0, z: 0 };
```

In `BeltRing`, after the `rocks` `useMemo`, add:

```ts
  // Per-rock push displacement (spec: belt parts around the ship). Sized to
  // `total` so a low-perf count change never reallocates.
  const disp = useMemo(() => new Float32Array(total * 3), [total]);
```

Replace `BeltRing`'s `useFrame` with:

```ts
  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const t = ambientTime(state.clock.getElapsedTime());
    const dt = Math.min(delta, 0.05);
    const react = !useSpaceStore.getState().reducedMotion;
    const ship = react && nearRing(flight, rMin, rMax) ? toRingLocal(shipLocal, flight, tilt) : null;
    const kPush = decay(BELT_PUSH_HALFLIFE, dt);
    const kReturn = decay(BELT_RETURN_HALFLIFE, dt);
    for (let i = 0; i < count; i++) {
      const r = rocks[i];
      const angle = r.phase + t * r.speed;
      const x = Math.cos(angle) * r.radius, y = r.y, z = Math.sin(angle) * r.radius;
      if (react) stepRock(disp, i, x, y, z, ship, kPush, kReturn);
      const j = i * 3;
      dummy.position.set(x + disp[j], y + disp[j + 1], z + disp[j + 2]);
      dummy.rotation.set(r.phase + t * r.spinX, t * r.spinY, t * r.spinZ);
      dummy.scale.setScalar(r.scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });
```

- [ ] **Step 6: Type-check and run the unit tests**

Run: `npx tsc -b && npx vitest run`
Expected: `tsc` prints nothing; all tests pass.

- [ ] **Step 7: Check it visually**

With the dev server running: `window.__fitz.teleport(55, 0, 0)`, then fly slowly with `W`. Expected: rocks slide out of the ship's way and drift back behind it.

- [ ] **Step 8: Commit**

```bash
git add src/utils/beltPush.ts tests/beltPush.test.ts src/components/canvas/AsteroidBelt.tsx
git commit -m "feat(belt): rocks part around the ship and close behind it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end probe and full verification

**Files:**
- Create: `tests/e2e/reactions.probe.mjs`
- Modify: `tests/e2e/run.mjs` (the `PROBES` default list)

**Interfaces:**
- Consumes:
  - `fitzDebug.cargoSwerve` (Task 3) and `fitzDebug.jelly` (Task 4).
  - The scene objects `CargoShip0..4`, `SpaceJellyfish` and `BeltMain`.
  - `chatterPools.hail` (Task 2) and `BELT_PUSH_RADIUS` (Task 5, mirrored as a literal).
- Produces: a probe module whose default export returns a `Checks` object, as every probe does.

- [ ] **Step 1: Write the probe**

```js
// tests/e2e/reactions.probe.mjs
import { withPage, settle, readStore, pollUntil } from "./harness.mjs";

// Mirrors src/utils/beltPush.ts (the probe runs in Node, outside Vite);
// tests/beltPush.test.ts guards the source of truth.
const BELT_PUSH_RADIUS = 10;

const teleport = (page, [x, y, z]) => page.evaluate((x, y, z) => window.__fitz.teleport(x, y, z), x, y, z);

/** The cargo ship farthest from every planet, so chasing it can't trip an orbit lock. */
const safestCargo = (page) => page.evaluate(() => {
  const d = window.__fitz;
  let best = 0, bestGap = -1;
  for (let i = 0; i < 5; i++) {
    const g = d.scene.getObjectByName(`CargoShip${i}`);
    if (!g) continue;
    const gap = Math.min(...Object.values(d.bodies).map((b) =>
      Math.hypot(g.position.x - b.x, g.position.y - b.y, g.position.z - b.z)));
    if (gap > bestGap) { bestGap = gap; best = i; }
  }
  return best;
});

/** Sits the ship 8u above cargo ship `i` for ~2.5s, re-teleporting as it moves on. */
async function shadowCargo(page, i) {
  for (let k = 0; k < 25; k++) {
    await page.evaluate((i) => {
      const g = window.__fitz.scene.getObjectByName(`CargoShip${i}`);
      window.__fitz.teleport(g.position.x, g.position.y + 8, g.position.z);
    }, i);
    await settle(page, 100);
  }
}

const swerve = (page, i) => page.evaluate((i) => {
  const o = window.__fitz.cargoSwerve[i];
  return Math.hypot(o.x, o.y, o.z);
}, i);

/** World positions of the main belt's rocks, read from the live instance matrices. */
const beltRocks = (page) => page.evaluate(() => {
  const m = window.__fitz.scene.getObjectByName("BeltMain");
  m.updateMatrixWorld(true);
  const e = m.matrixWorld.elements, a = m.instanceMatrix.array, out = [];
  for (let i = 0; i < m.count; i++) {
    const x = a[i * 16 + 12], y = a[i * 16 + 13], z = a[i * 16 + 14];
    out.push([e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]]);
  }
  return out;
});
const nearestTo = (rocks, p) => rocks.reduce((best, r) => {
  const d = Math.hypot(r[0] - p[0], r[1] - p[1], r[2] - p[2]);
  return d < best.d ? { r, d } : best;
}, { r: null, d: Infinity });
const shipPos = (page) => page.evaluate(() => [window.__fitz.flight.x, window.__fitz.flight.y, window.__fitz.flight.z]);

async function reacting(page, checks) {
  // ---- cargo: swerve + hail ----
  const hailPool = await page.evaluate(async () => (await import("/src/data/chatterLines.ts")).chatterPools.hail);
  const i = await safestCargo(page);
  const before = (await readStore(page)).broadcast?.id ?? 0;
  await shadowCargo(page, i);
  const off = await swerve(page, i);
  checks.check("a cargo ship swerves off its route when the ship comes close", off > 3, `ship=${i} offset=${off.toFixed(2)}`);
  const b = (await readStore(page)).broadcast;
  checks.check("it hails the pilot on the radio", (b?.id ?? 0) > before && hailPool.includes(b?.text),
    `broadcast=${b?.text}`);

  // ---- jellyfish: curious, then startled ----
  await page.keyboard.press("KeyJ");
  await settle(page, 800);
  const jelly = () => page.evaluate(() => {
    const p = window.__fitz.scene.getObjectByName("SpaceJellyfish").position;
    const f = window.__fitz.flight;
    return { mood: window.__fitz.jelly.mood, dist: Math.hypot(p.x - f.x, p.y - f.y, p.z - f.z), p: [p.x, p.y, p.z] };
  });
  const j0 = await jelly();
  await teleport(page, [j0.p[0] + 30, j0.p[1], j0.p[2]]);
  await settle(page, 300);
  const start = (await jelly()).dist;
  // pollUntil resolves to { ok, value }, never the bare value.
  const curious = (await pollUntil(async () => {
    const j = await jelly();
    return j.mood === "curious" && j.dist < start - 5 ? j : null;
  }, { timeoutMs: 8000 })).value;
  checks.check("the jellyfish turns curious and drifts toward a hovering ship", !!curious,
    curious ? `dist ${start.toFixed(1)} -> ${curious.dist.toFixed(1)}` : `start=${start.toFixed(1)}`);

  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  const startled = (await pollUntil(async () => ((await jelly()).mood === "startled" ? true : null), { timeoutMs: 1500 })).ok;
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ShiftLeft");
  checks.check("a boost nearby startles it", !!startled);

  // ---- belt: rocks part around a parked ship ----
  const target = nearestTo(await beltRocks(page), [55, 0, 0]).r;
  await teleport(page, target);
  await settle(page, 1500);
  const ship = await shipPos(page);
  const nearest = nearestTo(await beltRocks(page), ship).d;
  checks.check("belt rocks part around a parked ship", nearest > BELT_PUSH_RADIUS * 0.7,
    `nearest rock ${nearest.toFixed(2)}u (push radius ${BELT_PUSH_RADIUS})`);
}

async function stillUnderReducedMotion(page, checks) {
  const i = await safestCargo(page);
  await shadowCargo(page, i);
  const off = await swerve(page, i);
  checks.check("reduced motion: cargo ships hold their route", off < 0.01, `offset=${off.toFixed(3)}`);

  const target = nearestTo(await beltRocks(page), [55, 0, 0]).r;
  await teleport(page, target);
  await settle(page, 1500);
  const nearest = nearestTo(await beltRocks(page), await shipPos(page)).d;
  checks.check("reduced motion: the belt does not part", nearest < 1, `nearest rock ${nearest.toFixed(2)}u`);
}

export default async function run() {
  const checks = await withPage({ label: "reactions" }, reacting);
  const rm = await withPage({ label: "reactions (reduced motion)", emulateReducedMotion: true }, stillUnderReducedMotion);
  checks.results.push(...rm.results);
  return checks;
}
```

- [ ] **Step 2: Confirm `pollUntil`'s contract**

`pollUntil` (tests/e2e/harness.mjs) resolves to `{ ok, value, error? }` and never throws on a timeout: `ok` is true with the first truthy callback result as `value`, or false with `value: null`. The probe reads `.value` and `.ok` accordingly. Do not compare the returned object itself for truthiness, because it is always an object and so always truthy.

- [ ] **Step 3: Register the probe**

In `tests/e2e/run.mjs`, add `"reactions"` to the default `PROBES` list, after `"fuel"`:

```js
  : ["smoke", "audio", "perf", "transition", "sky", "flight", "gameplay", "touch", "gamepad", "race", "beacons", "assets", "contact", "reducedmotion", "fuel", "reactions", "basepath"];
```

- [ ] **Step 4: Run the new probe**

Close any browser tab rendering the app first. A busy tab skews the startup-time budget check.

Run: `node tests/e2e/run.mjs reactions`
Expected: every check passes, including the harness's own startup and page-error checks.

If "belt rocks part" fails with a nearest distance between 5 and 7, the parked ship is inside a dense clump; re-read the nearest rock after another `settle(page, 1000)` before concluding.

- [ ] **Step 5: Run everything**

Run: `npx tsc -b && npx oxlint && npx vitest run && npm run test:e2e`
Expected:
- `tsc` is clean.
- `oxlint` shows only the existing `Atmosphere.tsx` warning.
- All unit tests pass.
- Every e2e probe passes, in particular `perf` and `transition` with `deep-space programs` 79/79 and draw calls within their ceilings.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/reactions.probe.mjs tests/e2e/run.mjs
git commit -m "test(e2e): cargo, jellyfish and belt react to the ship

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
