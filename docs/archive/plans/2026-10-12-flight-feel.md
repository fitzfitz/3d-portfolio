# Flight Feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the eight parked polish defects, hide the ±250 wrap inside a nebula haze, add gravity wells with a slingshot, and add a tractor beam that pulls crystals, mines belt pebbles and reels the ship toward data shards.

**Architecture:** Each mechanic's maths lives in a pure, unit-tested module under `src/utils/` (`edgeHaze`, `gravityWell`, `capture`, `tractorBeam`, `mining`), following `beltPush.ts` and `eventDirector.ts`. Components stay thin and allocation-free per frame. Shared per-frame state that must not re-render React lives in module-level objects, like `flight` (`src/store/beamState.ts`). Gravity is a separate momentum vector `G` added on top of the pilot's unchanged velocity.

**Tech Stack:** React 19, React Three Fiber, three.js, zustand, Vitest (`npm test`), Puppeteer e2e probes (`npm run test:e2e`), TypeScript (`tsc -b`), oxlint (`npm run lint`).

**Spec:** `docs/archive/specs/2026-10-12-flight-feel-design.md`. Read it before starting any task; §5.6 holds the gravity tuning targets.

## Global Constraints

- No new WebGL shader programs. The deep-space ceiling stays 79/79 (`tests/e2e/transition.probe.mjs:14`). New visuals reuse existing materials; changing a uniform on an existing shader is free, a new `#define` or material type is not.
- No React renders during flight. Per-frame values go through module-level objects and direct DOM writes, never store state or `useState`.
- No allocation inside `useFrame` or rAF loops. Use module-level scratch objects or `out` parameters.
- Every distance or direction that a mechanic computes between the ship and a world object uses `wrapDelta` or `toroidalDistance3` from `src/utils/toroidal.ts` (argument order x, z, y for `toroidalDistance3`).
- Reduced motion: decorative motion freezes (`ambientTime`); player-driven mechanics (gravity, beam, haze) keep working.
- Radio lines added by this plan go through `sendBroadcast(text, { silent: true })`, respect `RADIO_BUSY_S` (6 s), and never fire while `store.race.phase === "running"`. (Exception: the once-per-session first-ore line, Task 17.)
- Copy voice: uppercase, dry, the house tone of `src/data/chatterLines.ts`.
- **Subagents must not** run `pnpm`, `npm install`, `npm ci`, or any package install, and must not `kill`/`pkill` processes by name. If dependencies look broken, stop and report.
- When proving a regression test catches the old bug, stash or revert **only the source file**, never the test file.
- Commit after every task, with the message given, ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before `npm run test:e2e`, close any browser tab that is rendering the app; a live tab skews the startup budget.

## Review Focus

The five conditions most likely to break for a real visitor that the spec implies but does not spell out. Each has a test in the task that owns it.

1. **Low frame rate (dt clamped at 0.05 s).** A dive at 20 fps must still dock outside the planet and never tunnel through it. Test: Task 10, "docks outside the planet at 20 fps".
2. **Break orbit, then get pulled straight back in.** The escape push leaves the ship inside the planet's 56u well; without escape grace the next pass relocks. Test: Task 11, "escape grace in a frame loop".
3. **Window blur or tab switch while holding F.** The beam must release like every other input. Test: Task 14, `resetFlightInput` covers `beam`.
4. **Beam targets across the wrap seam.** A crystal at x = -248 seen from x = 245 is 7u away, not 493u. Test: Task 13, "sees a target across the wrap seam".
5. **Photo mode or a frozen scene mid-beam or mid-slingshot.** Gravity momentum and beam state must not carry into a frozen, docked or teleported ship. Tests: Task 12 (`G` zeroed on teleport, jump, lock and collision) and Task 18 ("the beam stays off in photo mode").

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/utils/cargoReaction.ts` | modify | add `curvatureRoll` (P1) |
| `src/components/canvas/CargoTraffic.tsx` | modify | use `curvatureRoll`; silent hails (P1, P3) |
| `src/utils/jellyMood.ts` | modify | `basePos` for drift cancellation (P2) |
| `src/components/canvas/SpaceJellyfish.tsx` | modify | pass `basePos`; no per-frame allocation (P2, P7) |
| `src/store/spaceStore.ts` | modify | `sendBroadcast` silent option (P3); `beam` input (Task 14) |
| `src/components/layout/RadioChatter.tsx` | modify | skip aria-live for silent; drop wrap reaction (P3, Task 8) |
| `src/utils/worldEvents.ts` | modify | `CONVOY_ORBIT_FACTOR` 2.5 (P4) |
| `src/data/chatterLines.ts` | modify | generic convoy lines; `haze`, `slingshot`, `ore` pools; remove `wrap` |
| `src/components/canvas/WorldEventDirector.tsx` | modify | convoy fallback; reuse step objects (P5, P7) |
| `src/utils/cometDust.ts` | create | `dustEmitBack` (P6) |
| `src/components/canvas/Comets.tsx` | modify | dust drift uses full age; no closure per frame (P6, P7) |
| `src/utils/eventDirector.ts`, `src/utils/orbits.ts`, `src/utils/kepler.ts` | modify | optional `out` parameters (P7) |
| `src/components/canvas/SpacePlanets.tsx` | modify | reuse orbit scratch; capture rule (P7, Task 11) |
| `tests/e2e/basepath.probe.mjs` | modify | poll for network idle (P8) |
| `src/utils/edgeHaze.ts` | create | `edgeDepth`, `wrapCoord`, `HazeLineGate` |
| `src/components/layout/EdgeHaze.tsx` | create | DOM haze overlay + haze radio line |
| `src/utils/chatterScheduler.ts` | modify | pools `haze`, `slingshot`, `ore` replace `wrap` |
| `src/utils/gravityWell.ts` | create | wells, `stepGravity`, mode, `EscapeGrace`, `SlingshotGate` |
| `src/utils/capture.ts` | create | `canCapture` |
| `src/components/canvas/Spaceship.tsx` | modify | wrap, gravity momentum, reel, beam state writes |
| `src/store/beamState.ts` | create | per-frame beam state + selection buffer |
| `src/utils/tractorBeam.ts` | create | cone test, nearest-first selection, pull step, reel accel |
| `src/utils/mining.ts` | create | pebble state per ring, tethers, grab gate, ore |
| `src/components/canvas/TractorBeam.tsx` | create | selection each frame, cone mesh, tether lines |
| `src/components/canvas/enginePlume.ts` | modify | `uColor` uniform |
| `src/components/canvas/FuelCrystals.tsx` | modify | apply crystal pull |
| `src/components/canvas/DataShards.tsx` | modify | document anchoring |
| `src/components/canvas/AsteroidBelt.tsx` | modify | pebble world positions, tethers, absorb, regrow |
| `src/components/canvas/GlobalCanvas.tsx` | modify | mount `TractorBeam` |
| `src/App.tsx` | modify | mount `EdgeHaze`; flash test id; controls hint |
| `src/components/layout/HUDOverlay.tsx` | modify | speed colour, ORE readout, controls hint |
| `src/hooks/useKeyboardInput.ts`, `src/utils/gamepad.ts`, `src/hooks/useGamepadInput.ts`, `src/components/layout/TouchControls.tsx` | modify | `beam` input |
| `src/audio/soundManager.ts` | modify | `whoosh`, `beamOn`, `oreTick`, beam hum |
| `src/debug/bridge.ts` | modify | `gravity`, `beam`, `mining` dev handles |
| `tests/e2e/mechanics.probe.mjs` | create | edge, gravity, beam, budgets, photo mode, reduced motion |
| `tests/e2e/run.mjs`, `tests/e2e/reducedmotion.probe.mjs`, `tests/e2e/events.probe.mjs` | modify | register probe; flash check; convoy radius |

---

## Phase A — Polish

### Task 1: Cargo ships bank into curves (P1)

**Files:**
- Modify: `src/utils/cargoReaction.ts` (append)
- Modify: `src/components/canvas/CargoTraffic.tsx:164-166`
- Test: `tests/cargoReaction.test.ts` (append)

**Interfaces:**
- Produces: `curvatureRoll(a: Vec3, b: Vec3): number`. `a` and `b` are unit tangents now and slightly ahead on the route; returns the roll in radians, clamped to ±0.5, to pass to `group.rotateZ` on a ship whose `lookAt` points its +Z along the route.

Background: `Object3D.lookAt` points an object's **+Z** at the target, so a ship's left wing is local **+X**. `rotateZ(+θ)` raises +X. The old term `tanA.cross(tanB).y * 60` is positive for a left turn, so it raised the inside (left) wing: the ship banked out of the turn. The swerve term below it is already correct; leave it alone.

- [ ] **Step 1: Write the failing test**

Append to `tests/cargoReaction.test.ts`:

```ts
import * as THREE from "three";
import { curvatureRoll } from "../src/utils/cargoReaction";

describe("curvatureRoll", () => {
  // A ship flying +Z whose route bends toward +X is turning left (its left wing is +X).
  const straight = { x: 0, y: 0, z: 1 };
  const leftward = new THREE.Vector3(0.1, 0, 1).normalize();
  const rightward = new THREE.Vector3(-0.1, 0, 1).normalize();

  /** World-space height of the left wing tip after applying the roll, as CargoTraffic does. */
  function leftWingY(roll: number): number {
    const ship = new THREE.Object3D();
    ship.lookAt(0, 0, 1);
    ship.rotateZ(roll);
    ship.updateMatrixWorld();
    return new THREE.Vector3(1, 0, 0).applyMatrix4(ship.matrixWorld).y;
  }

  it("lowers the inside wing in a left turn", () => {
    expect(leftWingY(curvatureRoll(straight, leftward))).toBeLessThan(0);
  });
  it("raises the left (outside) wing in a right turn", () => {
    expect(leftWingY(curvatureRoll(straight, rightward))).toBeGreaterThan(0);
  });
  it("is zero on a straight route and clamped to ±0.5", () => {
    expect(curvatureRoll(straight, straight)).toBe(0);
    expect(Math.abs(curvatureRoll(straight, { x: 1, y: 0, z: 0 }))).toBe(0.5);
  });
  it("does not mutate its inputs", () => {
    const a = { x: 0, y: 0, z: 1 };
    curvatureRoll(a, leftward);
    expect(a).toEqual({ x: 0, y: 0, z: 1 });
  });
});
```

If the file's existing imports already pull from `../src/utils/cargoReaction`, merge `curvatureRoll` into that import instead of adding a second one. Make sure `describe`, `it` and `expect` are imported from `vitest`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cargoReaction.test.ts`
Expected: FAIL, `curvatureRoll` is not exported.

- [ ] **Step 3: Implement**

Append to `src/utils/cargoReaction.ts`:

```ts
/** Largest bank from route curvature alone (rad). */
const CURVE_ROLL_MAX = 0.5;
/** Curvature-to-roll gain, unchanged from the original inline term. */
const CURVE_ROLL_GAIN = 60;

/**
 * Bank angle for a ship following its route's curve: the roll to pass to
 * `rotateZ` on a ship whose `lookAt` points its +Z along the route. Its left
 * wing is local +X, and `rotateZ(+)` raises +X, so a left turn (the tangent
 * swinging toward +X, cross(a, b).y > 0) needs a NEGATIVE roll to dip the
 * inside wing. The inline term this replaces had the sign flipped and banked
 * ships out of every curve. `a` and `b` are unit tangents now and a little
 * further along; neither is modified.
 */
export function curvatureRoll(a: Vec3, b: Vec3): number {
  const crossY = a.z * b.x - a.x * b.z;
  const roll = -crossY * CURVE_ROLL_GAIN;
  return Math.max(-CURVE_ROLL_MAX, Math.min(CURVE_ROLL_MAX, roll));
}
```

In `src/components/canvas/CargoTraffic.tsx`, add `curvatureRoll` to the existing `../../utils/cargoReaction` import and replace:

```ts
      let targetRoll = THREE.MathUtils.clamp(tanA.cross(tanB).y * 60, -0.5, 0.5);
```

with:

```ts
      let targetRoll = curvatureRoll(tanA, tanB);
```

Update the comment above it from "roll into the route's curvature" to "bank into the route's curvature (curvatureRoll explains the sign)".

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/cargoReaction.test.ts tests/reactions.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the test catches the old sign**

Temporarily change `const roll = -crossY * CURVE_ROLL_GAIN;` to `const roll = crossY * CURVE_ROLL_GAIN;` in `src/utils/cargoReaction.ts` only. Run the test: the two wing tests must FAIL. Restore the line and rerun: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/cargoReaction.ts src/components/canvas/CargoTraffic.tsx tests/cargoReaction.test.ts
git commit -m "fix(cargo): bank into route curves, not out of them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A curious jellyfish keeps its swim motion (P2)

**Files:**
- Modify: `src/utils/jellyMood.ts`
- Modify: `src/components/canvas/SpaceJellyfish.tsx` (frame loop, lines ~200-223)
- Test: `tests/jellyMood.test.ts` (append)

**Interfaces:**
- Produces: `JellyInput.basePos?: Vec3`, the path point **before** swim surge and bob. Optional; defaults to `pathPos`, so existing callers and tests keep working.

Background: `stepJelly` cancels the path's drift while curious by subtracting each frame's `pathPos` delta. `pathPos` already includes the surge and bob, so those were cancelled too, and the creature froze. It also aimed its rest offset at `rest - pathPos`, which re-cancels the bob as the offset converges. Both must use the base path.

- [ ] **Step 1: Write the failing test**

Append inside the `describe("stepJelly", ...)` block in `tests/jellyMood.test.ts`:

```ts
  it("keeps its swim surge and bob while curious", () => {
    // Base path fixed; the swim adds a 2u vertical bob on top, period ~2.1s.
    const s = createJellyState();
    const base = v(0, 0, 0);
    const ys: number[] = [];
    for (let t = 0; t < 10; t += 0.05) {
      const inp = input({ pathPos: v(0, Math.sin(t * 3) * 2, 0), basePos: base, dt: 0.05 });
      stepJelly(s, inp);
      if (t > 8) ys.push(jellyAt(s, inp).y);
    }
    expect(s.mood).toBe("curious");
    // Frozen (old behaviour) gives a range near 0; a living bob gives ~4.
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(3);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/jellyMood.test.ts`
Expected: the new test FAILS (TypeScript may also flag `basePos` as unknown; that is the same failure).

- [ ] **Step 3: Implement**

In `src/utils/jellyMood.ts`:

1. In `JellyInput`, after `pathPos`, add:

```ts
  /**
   * The path point BEFORE swim surge and bob. Drift cancellation and the
   * curious rest offset are measured from this, so the creature keeps
   * swimming while it holds still against its path. Defaults to `pathPos`.
   */
  basePos?: Vec3;
```

2. In `stepJelly`, replace the opening drift block:

```ts
  const { pathPos, player, dt } = inp;
  const base = inp.basePos ?? pathPos;
  // While curious, hold the creature still in the world against its path's
  // own drift (~4.6u/s): eased against a moving point, the offset lagged ~5u
  // and it parked at ~23u instead of the rest distance. A jump is not drift.
  // Measured on the BASE path: the swim surge and bob ride on top and must
  // survive, or a curious jellyfish freezes mid-stroke.
  if (s.lastPath) {
    const mx = base.x - s.lastPath.x, my = base.y - s.lastPath.y, mz = base.z - s.lastPath.z;
    if (s.mood === "curious" && Math.hypot(mx, my, mz) < PATH_JUMP) {
      s.offset.x -= mx; s.offset.y -= my; s.offset.z -= mz;
    }
    s.lastPath.x = base.x; s.lastPath.y = base.y; s.lastPath.z = base.z;
  } else {
    s.lastPath = { x: base.x, y: base.y, z: base.z };
  }
```

3. In the curious branch, measure the rest offset from `base`:

```ts
    const ox = rx - base.x, oy = ry - base.y, oz = rz - base.z;
```

Leave the rest of the function (the `jelly` position, keep-out backstop and leash) on `pathPos`.

In `src/components/canvas/SpaceJellyfish.tsx`:

1. Add module-level scratch objects near the other module constants:

```ts
const basePos = new THREE.Vector3();
const tangent = new THREE.Vector3();
```

2. In the frame loop, replace:

```ts
    JELLY_PATH.getPointAt(t, pathPos);
    const tangent = JELLY_PATH.getTangentAt(t);
```

with:

```ts
    JELLY_PATH.getPointAt(t, pathPos);
    basePos.copy(pathPos);
    JELLY_PATH.getTangentAt(t, tangent);
```

3. Replace the mood block's `planets.forEach` and the object literal passed to `stepJelly`:

```ts
    if (!store.reducedMotion) {
      for (let i = 0; i < planets.length; i++) {
        const b = bodies[planets[i].name];
        keepOut[i].x = b.x; keepOut[i].y = b.y; keepOut[i].z = b.z;
      }
      jellyInput.playerSpeed = flight.speed;
      jellyInput.boosting = store.isWarping;
      jellyInput.dt = dt;
      stepJelly(jelly, jellyInput);
    }
```

4. Create `jellyInput` once, after `keepOut` is defined in the component (find where `keepOut` is created and add next to it):

```ts
  const jellyInput = useMemo<JellyInput>(
    () => ({ pathPos, basePos, player: flight, playerSpeed: 0, boosting: false, keepOut, dt: 0 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
```

Import `type JellyInput` from `../../utils/jellyMood`. If `pathPos` is a module-level Vector3, reference it directly; if it is a ref, use its `.current` in the same pattern. `flight` satisfies `Vec3` (it has `x`, `y`, `z`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/jellyMood.test.ts tests/jellyfishPath.test.ts`
Expected: PASS, including the existing "settles at the rest distance even while its path keeps moving" test (it passes no `basePos`, so `base === pathPos`).

- [ ] **Step 5: Prove the test catches the old code**

Temporarily change `const base = inp.basePos ?? pathPos;` to `const base = pathPos;` in `src/utils/jellyMood.ts` only. The new test must FAIL. Restore it.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc -b`
Expected: no errors.

```bash
git add src/utils/jellyMood.ts src/components/canvas/SpaceJellyfish.tsx tests/jellyMood.test.ts
git commit -m "fix(jelly): keep the swim surge and bob while curious; no per-frame allocation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cargo hails stay off screen readers (P3)

**Files:**
- Modify: `src/store/spaceStore.ts` (`broadcast` type, `sendBroadcast`)
- Modify: `src/components/layout/RadioChatter.tsx:65-75`
- Modify: `src/components/canvas/CargoTraffic.tsx` (hail line)
- Test: `tests/spaceStore.test.ts` (append)

**Interfaces:**
- Produces: `sendBroadcast(text: string, opts?: { silent?: boolean }): void`. `broadcast` becomes `{ id: number; text: string; silent: boolean } | null`. Silent lines show on the radio and count as radio activity, but are not written to the aria-live region. Later tasks (haze, slingshot, ore) send silent lines.

- [ ] **Step 1: Write the failing test**

Append to `tests/spaceStore.test.ts`, inside its top-level `describe` (match the file's existing reset pattern in `beforeEach`):

```ts
  it("sendBroadcast marks lines silent only when asked", () => {
    const s = useSpaceStore.getState();
    s.sendBroadcast("SCAN REPORT");
    expect(useSpaceStore.getState().broadcast).toMatchObject({ text: "SCAN REPORT", silent: false });
    s.sendBroadcast("HAIL", { silent: true });
    expect(useSpaceStore.getState().broadcast).toMatchObject({ text: "HAIL", silent: true });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/spaceStore.test.ts`
Expected: FAIL (`silent` is undefined).

- [ ] **Step 3: Implement**

In `src/store/spaceStore.ts`:

```ts
  broadcast: { id: number; text: string; silent: boolean } | null;
```

```ts
  /**
   * Shows a line on the radio. `silent` lines (cargo hails, flavour such as
   * the haze and slingshot callouts) are not announced to screen readers:
   * the aria-live region is for content a visitor acted to get.
   */
  sendBroadcast: (text: string, opts?: { silent?: boolean }) => void;
```

```ts
    sendBroadcast: (text, opts) => set({ broadcast: { id: (get().broadcast?.id ?? 0) + 1, text, silent: opts?.silent ?? false } }),
```

In `src/components/layout/RadioChatter.tsx`, in the broadcast subscription:

```ts
          typeLine(b.text);
          // Broadcasts carry real content (shard facts, scan reports, the
          // completion pointer). Announce them whole: the typewriter line
          // changes every 22ms and would be noise to a screen reader. Silent
          // lines (hails, flavour callouts) are shown but not announced.
          if (liveRef.current && !b.silent) liveRef.current.textContent = b.text;
```

In `src/components/canvas/CargoTraffic.tsx`:

```ts
      if (hailGate.update(i, dist, now, raceRunning, radioBusy)) store.sendBroadcast(hailLines.pick("hail"), { silent: true });
```

Search for other object literals typed as the broadcast (`grep -rn "broadcast: {" src tests`) and add `silent: false` where TypeScript requires it.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/spaceStore.test.ts && npx tsc -b`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/store/spaceStore.ts src/components/layout/RadioChatter.tsx src/components/canvas/CargoTraffic.tsx tests/spaceStore.test.ts
git commit -m "fix(a11y): cargo hails show on the radio but are not announced

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Convoy clears lock-retain on every slot; generic convoy line (P4, P5)

**Files:**
- Modify: `src/utils/worldEvents.ts:90` (`CONVOY_ORBIT_FACTOR`)
- Modify: `src/data/chatterLines.ts` (`eventLines`)
- Modify: `src/components/canvas/WorldEventDirector.tsx:69`
- Modify: `tests/e2e/events.probe.mjs` (orbit radius literal and check name)
- Test: `tests/worldEvents.test.ts`

**Interfaces:**
- Produces: `CONVOY_ORBIT_FACTOR = 2.5`; `eventLines.convoyAny: string[]`.

Background: with the lead at R = 2.2 × 16 = 35.2 and wingmen 6u back and 6u to the side, the inner wingman orbits at 29.2u, inside lock-retain (1.9 × 16 = 30.4u). A tuning run over t = 0…40 s gave inner-slot minima of 29.2 (2.2), 32.4 (2.4), **34.0 (2.5)**. 2.5 leaves a 3.6u margin.

- [ ] **Step 1: Write the failing tests**

In `tests/worldEvents.test.ts`, inside `describe("convoy path", ...)`, add:

```ts
  it("keeps every convoy slot outside lock-retain, with a 2u margin, for the whole event", () => {
    const floor = size * LOCK_RETAIN_FACTOR + 2;
    for (const slot of [0, 1, 2] as const) {
      let min = Infinity;
      for (let t = 0; t <= CONVOY_APPROACH_S + CONVOY_ORBIT_S + 5; t += 0.01) {
        min = Math.min(min, len(convoyShipOffsetAt(v(), plan, t, slot)));
      }
      expect(min, `slot ${slot}`).toBeGreaterThan(floor);
    }
  });
```

Update the existing test title `"orbits at 2.2x size, outside the lock-retain radius"` to `"orbits at CONVOY_ORBIT_FACTOR x size, outside the lock-retain radius"`; its body already uses the constant.

Append at the end of the file:

```ts
import { eventLines } from "../src/data/chatterLines";

describe("convoy lines", () => {
  it("has generic lines for planets without their own", () => {
    expect(eventLines.convoyAny.length).toBeGreaterThan(0);
  });
});
```

(Move the import to the top of the file with the others.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/worldEvents.test.ts`
Expected: FAIL for slot 1 (≈29.2 < 32.4) and for `convoyAny`.

- [ ] **Step 3: Implement**

`src/utils/worldEvents.ts`:

```ts
/**
 * Lead orbit radius, × planet size. 2.5, not 2.2: wingmen fly 6u back and 6u
 * to the side, so during the orbit the inner one sits ~6u inside the lead. At
 * 2.2 that was 29.2u, inside lock-retain (1.9 × 16 = 30.4u); at 2.5 every slot
 * clears it by 3.6u (tests/worldEvents.test.ts).
 */
export const CONVOY_ORBIT_FACTOR = 2.5;
```

`src/data/chatterLines.ts`: change the `eventLines` type and add a generic pool:

```ts
export const eventLines: { comet: string[]; flare: string[]; convoy: Record<string, string[]>; convoyAny: string[] } = {
```

and, after the `convoy: { ... },` entry:

```ts
  /** Any planet without its own convoy lines (a project added later). */
  convoyAny: [
    "CONVOY INBOUND // CARGO MANIFEST: CLASSIFIED. PROBABLY SNACKS",
    "SUPPLY RUN ON FINAL APPROACH. EVERYONE ACT NATURAL",
  ],
```

`src/components/canvas/WorldEventDirector.tsx:69`:

```ts
    ? { state: { ...base, convoy: { planet: target.name, plan } }, line: pick(eventLines.convoy[target.name] ?? eventLines.convoyAny) }
```

`tests/e2e/events.probe.mjs`: in the convoy orbit check, change `16 * 2.2` to `16 * 2.5`, and the check name to `"the convoy settles into orbit at ~2.5x the planet's size"`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/worldEvents.test.ts tests/worldEventStore.test.ts && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/worldEvents.ts src/data/chatterLines.ts src/components/canvas/WorldEventDirector.tsx tests/worldEvents.test.ts tests/e2e/events.probe.mjs
git commit -m "fix(events): every convoy slot clears lock-retain; generic convoy line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The visiting comet's dust tail curves again (P6)

**Files:**
- Create: `src/utils/cometDust.ts`
- Modify: `src/components/canvas/Comets.tsx` (constant at :26, dust loop at :244-251)
- Test: `tests/cometDust.test.ts`

**Interfaces:**
- Produces: `VISITOR_DUST_AGE = 0.25` (moved here from Comets.tsx) and `dustEmitBack(age: number, isVisitor: boolean): number`, the seconds back along the comet's path where a grain of `age` was emitted.

Background: each grain was emitted `tau` seconds ago and drifts anti-sunward by `0.5·β·tau²`. For the fast visitor, the history is compressed (×0.25) so 70 grains don't string out over ~220u. The compression was applied to `tau` itself, so drift shrank 16× and the tail went straight. Only the emission point should be compressed; drift and spread use the grain's real age.

- [ ] **Step 1: Write the failing test**

Create `tests/cometDust.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dustEmitBack, VISITOR_DUST_AGE } from "../src/utils/cometDust";

describe("dustEmitBack", () => {
  it("is the full age for an orbiting comet", () => {
    expect(dustEmitBack(8, false)).toBe(8);
  });
  it("compresses only the visitor's emission history", () => {
    expect(dustEmitBack(8, true)).toBeCloseTo(8 * VISITOR_DUST_AGE);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cometDust.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/utils/cometDust.ts`:

```ts
/**
 * Dust-tail timing for the comets (Comets.tsx, spec D1-D4).
 *
 * A grain of age `age` was emitted `age` seconds ago at the comet's past
 * position, then pushed anti-sunward by radiation pressure (drift ∝ age²).
 * The world-event visitor flies ~4x faster than an orbiting comet, so the same
 * history would string its 70 grains over ~220u as a dotted line; its
 * EMISSION history is compressed by VISITOR_DUST_AGE to keep the tail dense.
 * Drift and spread must still use the real age, or the tail loses its curve.
 */
export const VISITOR_DUST_AGE = 0.25;

/** Seconds back along the comet's path where a grain of `age` was emitted. */
export function dustEmitBack(age: number, isVisitor: boolean): number {
  return isVisitor ? age * VISITOR_DUST_AGE : age;
}
```

In `src/components/canvas/Comets.tsx`:

1. Delete the local `VISITOR_DUST_AGE` constant and its comment (line ~25-26). Import `dustEmitBack` from `../../utils/cometDust`.
2. Replace the grain timing in the dust loop:

```ts
          // Real age drives drift and spread; only the visitor's emission
          // point is compressed (utils/cometDust.ts explains why).
          const age = pt.lag * DUST_MAX_AGE;
          posAt(i, t - dustEmitBack(age, isVisitor), emitted);
          const drift = 0.5 * pt.beta * age * age; // anti-sunward push ∝ age²
          const spread = 0.3 + age * 0.22; // tail broadens with age (D1 "broad")
```

Delete the old three-line comment about the visitor flying ~4x faster (it now lives in `cometDust.ts`). (Task 6 later renames `posAt` to `cometPos`; if Task 6 already ran, use `cometPos(i, t - dustEmitBack(age, isVisitor), pass, emitted)`.)

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/cometDust.test.ts && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/cometDust.ts src/components/canvas/Comets.tsx tests/cometDust.test.ts
git commit -m "fix(comet): visitor dust drifts by its real age, so the tail curves

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: No per-frame allocation in the director, orbits and comets (P7)

**Files:**
- Modify: `src/utils/eventDirector.ts` (`stepDirector`)
- Modify: `src/utils/orbits.ts` (`orbitPosition`)
- Modify: `src/utils/kepler.ts` (`keplerPosition`)
- Modify: `src/components/canvas/WorldEventDirector.tsx` (frame loop)
- Modify: `src/components/canvas/SpacePlanets.tsx:381-388`
- Modify: `src/components/canvas/Comets.tsx:162-169`
- Test: `tests/eventDirector.test.ts`, `tests/orbits.test.ts`, `tests/kepler.test.ts` (append)

**Interfaces:**
- Produces:
  - `stepDirector(s: DirectorState, inp: DirectorInput, out?: DirectorStep): DirectorStep`. Writes into `out` when given (resetting both fields); otherwise allocates as today.
  - `orbitPosition(el: OrbitalElements, t: number, out?: Vec3): Vec3`
  - `keplerPosition(tSeconds: number, o: CometOrbit, out?: Vec3): Vec3`

  `Vec3` is `{ x: number; y: number; z: number }` from `src/utils/reactions.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/orbits.test.ts`:

```ts
describe("orbitPosition out parameter", () => {
  it("writes into and returns `out`, matching the allocating form", () => {
    const el = { radius: 115, angularSpeed: 0.015, inclination: 0.1, node: 0.4, phase: 1 };
    const out = { x: 0, y: 0, z: 0 };
    const r = orbitPosition(el, 12.5, out);
    expect(r).toBe(out);
    expect(out).toEqual(orbitPosition(el, 12.5));
  });
});
```

Append to `tests/kepler.test.ts`:

```ts
describe("keplerPosition out parameter", () => {
  it("writes into and returns `out`, matching the allocating form", () => {
    const o = { a: 140, e: 0.62, periodSeconds: 170, phase: 0, inclination: 0.9, node: 0.6 };
    const out = { x: 0, y: 0, z: 0 };
    expect(keplerPosition(33, o, out)).toBe(out);
    expect(out).toEqual(keplerPosition(33, o));
  });
});
```

Append to `tests/eventDirector.test.ts`:

```ts
describe("stepDirector out parameter", () => {
  it("reuses and resets the given step object", () => {
    const s = createDirector(() => 0.5);
    const out: DirectorStep = { started: null, ended: null };
    const inp = { dt: 50, paused: false, raceRunning: false, radioBusy: false, reducedMotion: false };
    const first = stepDirector(s, inp, out);
    expect(first).toBe(out);
    expect(out.started).not.toBeNull();
    stepDirector(s, { ...inp, dt: 0.01 }, out);
    expect(out.started).toBeNull();
  });
});
```

Make sure each file imports what it uses (`orbitPosition`, `keplerPosition`, `createDirector`, `stepDirector`, `type DirectorStep`); merge into existing imports where present.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/orbits.test.ts tests/kepler.test.ts tests/eventDirector.test.ts`
Expected: FAIL (results are not `out`).

- [ ] **Step 3: Implement**

`src/utils/orbits.ts`:

```ts
import type { Vec3 } from "./reactions";

/** Writes into `out` when given (frame loops), otherwise allocates. */
export function orbitPosition(el: OrbitalElements, t: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const th = el.phase + t * el.angularSpeed;
  const x0 = el.radius * Math.cos(th);
  const z0 = el.radius * Math.sin(th);
  const ci = Math.cos(el.inclination), si = Math.sin(el.inclination);
  const y1 = -z0 * si;
  const z1 = z0 * ci;
  const cn = Math.cos(el.node), sn = Math.sin(el.node);
  out.x = x0 * cn + z1 * sn; out.y = y1; out.z = -x0 * sn + z1 * cn;
  return out;
}
```

`src/utils/kepler.ts`: same pattern. Add `out: Vec3 = { x: 0, y: 0, z: 0 }` as the third parameter, import `type Vec3` from `./reactions`, and replace the final `return { x: …, y: …, z: … };` with `out.x = …; out.y = …; out.z = …; return out;`.

`src/utils/eventDirector.ts`:

```ts
export function stepDirector(s: DirectorState, inp: DirectorInput, out: DirectorStep = { started: null, ended: null }): DirectorStep {
  out.started = null; out.ended = null;
  if (inp.paused) return out;
```

(the rest unchanged).

`src/components/canvas/WorldEventDirector.tsx`: inside the component, create reusable objects once:

```ts
  const stepOut = useMemo<DirectorStep>(() => ({ started: null, ended: null }), []);
  const dirInput = useMemo<DirectorInput>(
    () => ({ dt: 0, paused: false, raceRunning: false, radioBusy: false, reducedMotion: false }), []);
```

In the frame loop, declare `let step: DirectorStep;` and replace the `stepDirector(director, { ... })` call with:

```ts
      dirInput.dt = dt;
      // Not photo mode: the planets keep orbiting there, so the event must too.
      dirInput.paused = selectSceneFrozen(s) || s.showClassicCV;
      dirInput.raceRunning = s.race.phase === "running";
      dirInput.radioBusy = now - lastBroadcast.current.at < RADIO_BUSY_S;
      dirInput.reducedMotion = s.reducedMotion;
      step = stepDirector(director, dirInput, stepOut);
```

Import `type DirectorStep, type DirectorInput`. Replace `lastBroadcast.current = { id: bid, at: now }` with in-place writes: `lastBroadcast.current.id = bid; lastBroadcast.current.at = now;`.

`src/components/canvas/SpacePlanets.tsx` orbit drive: add `const orbitScratch = { x: 0, y: 0, z: 0 };` at module level and replace the `planets.forEach((p, i) => { const pos = orbitPosition(p.orbit, time); ...` block with a `for` loop that calls `orbitPosition(p.orbit, time, orbitScratch)` and reads `orbitScratch` where it read `pos`. Keep the `setScannable` call as is.

`src/components/canvas/Comets.tsx`: delete the per-frame `posAt` closure and add a module-level function above the component:

```ts
/** Slot `i`'s position at its own time `t` (orbit time, or seconds into the visitor's pass). */
function cometPos(i: number, t: number, pass: CometPass | undefined, out: THREE.Vector3): THREE.Vector3 {
  if (i < VISITOR) { keplerPosition(t, COMETS[i], out); return out; }
  if (pass) cometPassAt(out, pass, t);
  return out;
}
```

Import `type CometPass` from `../../utils/worldEvents`. Replace each `posAt(i, x, v)` call with `cometPos(i, x, pass, v)`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/orbits.test.ts tests/kepler.test.ts tests/eventDirector.test.ts tests/orbitInvariant.test.ts tests/planetClearance.test.ts && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/eventDirector.ts src/utils/orbits.ts src/utils/kepler.ts src/components/canvas/WorldEventDirector.tsx src/components/canvas/SpacePlanets.tsx src/components/canvas/Comets.tsx tests/orbits.test.ts tests/kepler.test.ts tests/eventDirector.test.ts
git commit -m "perf: reuse objects in the event director, orbit and comet frame loops

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `basepath.probe` polls for network idle instead of sleeping 6s (P8)

**Files:**
- Modify: `tests/e2e/basepath.probe.mjs:~105-138`

- [ ] **Step 1: Add in-flight tracking**

Right after the existing `page.on("response", ...)` handler, add:

```js
    // Track in-flight requests so the probe waits for the page to go quiet,
    // not a fixed 6s that flaked under full-suite load (moon.glb missing once).
    let inflight = 0;
    let lastActivity = Date.now();
    page.on("request", () => { inflight++; lastActivity = Date.now(); });
    const done = () => { inflight = Math.max(0, inflight - 1); lastActivity = Date.now(); };
    page.on("requestfinished", done);
    page.on("requestfailed", done);
```

- [ ] **Step 2: Replace the fixed wait**

Replace `await settle(null, 6000); // let every GLB/texture fetch resolve` with:

```js
    // Every GLB/texture fetch resolved: nothing in flight for 1.5s.
    const idle = await pollUntil(async () => inflight === 0 && Date.now() - lastActivity > 1500,
      { timeoutMs: 45_000, intervalMs: 250 });
    checks.check("network went idle after load", idle.ok, idle.ok ? "" : `inflight=${inflight}`);
```

Add `pollUntil` to the probe's `./harness.mjs` import. Keep `settle` imported only if still used elsewhere in the file.

- [ ] **Step 3: Run the probe**

Run: `npm run test:e2e -- basepath`
Expected: all basepath checks pass, including "network went idle after load".

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/basepath.probe.mjs
git commit -m "test(e2e): basepath waits for network idle, not a fixed 6s

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase B — Soft edge

### Task 8: Exact, silent wrap and the haze maths

**Files:**
- Create: `src/utils/edgeHaze.ts`
- Modify: `src/components/canvas/Spaceship.tsx:501-515` (wrap)
- Modify: `src/components/layout/RadioChatter.tsx` (remove the `isTeleporting` subscription)
- Modify: `src/utils/chatterScheduler.ts`, `src/data/chatterLines.ts` (pools)
- Modify: `src/App.tsx:131-139` (flash test id)
- Modify: `tests/chatterScheduler.test.ts`, `tests/e2e/reducedmotion.probe.mjs:127-153`
- Test: `tests/edgeHaze.test.ts`

**Interfaces:**
- Produces (from `src/utils/edgeHaze.ts`):
  - `HAZE_START = 215`, `HAZE_MAX_OPACITY = 0.92`
  - `edgeDepth(x: number, y: number, z: number): number`, 0..1
  - `wrapCoord(v: number, bounds?: number): number`, exact 500-unit wrap
  - `class HazeLineGate { update(depth: number, radioBusy: boolean, raceRunning: boolean): boolean }`
- Produces (pools): `ChatterPools` gains `haze`, `slingshot`, `ore` and loses `wrap`; `ChatterKind` likewise.

- [ ] **Step 1: Write the failing test**

Create `tests/edgeHaze.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { edgeDepth, wrapCoord, HazeLineGate, HAZE_START } from "../src/utils/edgeHaze";
import { COSMIC_BOUNDS } from "../src/constants";
import { wrapDelta } from "../src/utils/toroidal";

describe("edgeDepth", () => {
  it("is 0 inside the haze start and 1 at the bounds", () => {
    expect(edgeDepth(0, 0, 0)).toBe(0);
    expect(edgeDepth(HAZE_START, 0, 0)).toBe(0);
    expect(edgeDepth(COSMIC_BOUNDS, 0, 0)).toBe(1);
  });
  it("follows the axis nearest the edge", () => {
    expect(edgeDepth(10, -240, 30)).toBe(edgeDepth(240, 0, 0));
    expect(edgeDepth(0, 0, -232)).toBeGreaterThan(edgeDepth(0, 0, 225));
  });
  it("is symmetric across the seam, so the far side is still deep haze", () => {
    expect(edgeDepth(249, 0, 0)).toBeCloseTo(edgeDepth(-249, 0, 0));
    expect(edgeDepth(-249.6, 0, 0)).toBeGreaterThan(0.9);
  });
});

describe("wrapCoord", () => {
  it("leaves in-bounds values alone", () => {
    expect(wrapCoord(120)).toBe(120);
    expect(wrapCoord(-250)).toBe(-250);
  });
  it("moves by exactly one 500u period, agreeing with wrapDelta", () => {
    expect(wrapCoord(250.4)).toBeCloseTo(-249.6);
    expect(wrapCoord(-251)).toBeCloseTo(249);
    // A point 2u past the seam is the same place the distance helpers think it is.
    expect(wrapDelta(wrapCoord(252), 0, COSMIC_BOUNDS)).toBeCloseTo(wrapDelta(252, 0, COSMIC_BOUNDS));
  });
});

describe("HazeLineGate", () => {
  it("fires once per visit, when depth first passes 0.3", () => {
    const g = new HazeLineGate();
    expect(g.update(0.2, false, false)).toBe(false);
    expect(g.update(0.35, false, false)).toBe(true);
    expect(g.update(0.8, false, false)).toBe(false);
    expect(g.update(0.05, false, false)).toBe(false); // re-arms
    expect(g.update(0.4, false, false)).toBe(true);
  });
  it("holds the line while the radio is busy or a race runs, then fires", () => {
    const g = new HazeLineGate();
    expect(g.update(0.5, true, false)).toBe(false);
    expect(g.update(0.5, false, true)).toBe(false);
    expect(g.update(0.5, false, false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/edgeHaze.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/utils/edgeHaze.ts`**

```ts
import { COSMIC_BOUNDS } from "../constants";

/**
 * The soft edge (docs/archive/specs/2026-10-12-flight-feel-design.md §4):
 * the ±COSMIC_BOUNDS wrap stays, but it happens unseen inside a nebula haze
 * that thickens from HAZE_START to the bounds on whichever axis is nearest.
 */
export const HAZE_START = 215;
/** Overlay opacity at full depth: enough that the wrap is never visible. */
export const HAZE_MAX_OPACITY = 0.92;
const LINE_AT = 0.3;
const REARM_BELOW = 0.1;

/** 0 inside HAZE_START, smoothstep to 1 at the bounds, on the nearest-to-edge axis. */
export function edgeDepth(x: number, y: number, z: number): number {
  const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  const u = Math.min(1, Math.max(0, (m - HAZE_START) / (COSMIC_BOUNDS - HAZE_START)));
  return u * u * (3 - 2 * u);
}

/**
 * Wraps one coordinate by exactly one period (2 × bounds), so the ship lands
 * where `toroidal.ts` already thinks it is. The old wrap snapped to ∓247: a
 * 497u jump against helpers that assume 500.
 */
export function wrapCoord(v: number, bounds = COSMIC_BOUNDS): number {
  if (v > bounds) return v - bounds * 2;
  if (v < -bounds) return v + bounds * 2;
  return v;
}

/**
 * One haze radio line per visit: fires the first time depth passes LINE_AT
 * while the radio is free and no race runs (held, not dropped, while it
 * isn't), and re-arms once the pilot is back below REARM_BELOW.
 */
export class HazeLineGate {
  private armed = true;
  update(depth: number, radioBusy: boolean, raceRunning: boolean): boolean {
    if (depth < REARM_BELOW) { this.armed = true; return false; }
    if (!this.armed || depth < LINE_AT || radioBusy || raceRunning) return false;
    this.armed = false;
    return true;
  }
}
```

- [ ] **Step 4: Replace the wrap in `Spaceship.tsx`**

Import `wrapCoord` from `../../utils/edgeHaze`. Replace the whole block from `// Toroidal boundary wrap — all three axes (spec §2)` through the closing `}` of `if (didWrap) { ... }` with:

```ts
    // Toroidal boundary wrap — all three axes (spec §2). Exactly one period, so
    // it agrees with utils/toroidal.ts, and silent: it happens inside the edge
    // haze (EdgeHaze.tsx), so there is no flash, zap or radio line any more.
    const wx = wrapCoord(pos.current.x), wy = wrapCoord(pos.current.y), wz = wrapCoord(pos.current.z);
    if (wx !== pos.current.x || wy !== pos.current.y || wz !== pos.current.z) {
      state.camera.position.x += wx - pos.current.x;
      state.camera.position.y += wy - pos.current.y;
      state.camera.position.z += wz - pos.current.z;
      pos.current.set(wx, wy, wz);
    }
```

`COSMIC_BOUNDS` may now be unused in Spaceship.tsx; remove it from the import if so (Task 12 adds it back).

- [ ] **Step 5: Pools and RadioChatter**

`src/utils/chatterScheduler.ts`: in `ChatterPools` replace `wrap: string[];` with:

```ts
  /** Entering the edge haze (EdgeHaze). */
  haze: string[];
  /** Leaving a planet's well fast (Spaceship). */
  slingshot: string[];
  /** First ore of a session (AsteroidBelt). */
  ore: string[];
```

`ChatterKind`: replace `"wrap"` with `"haze" | "slingshot" | "ore"`. In `pick`, replace the `wrap` branch with:

```ts
    else if (kind === "haze") pool = this.pools.haze;
    else if (kind === "slingshot") pool = this.pools.slingshot;
    else if (kind === "ore") pool = this.pools.ore;
```

`src/data/chatterLines.ts`: replace the `wrap: [...]` entry with:

```ts
  haze: [
    "NEBULA DENSITY RISING. SENSORS GOING SOFT",
    "THE MAP SAYS 'HERE BE MORE OF THIS'",
    "VISIBILITY ZERO. CONFIDENCE, ALSO ZERO",
    "EDGE HAZE. WHATEVER'S PAST IT, IT'S MORE OF THIS",
  ],
  slingshot: [
    "GRAVITY ASSIST LOGGED. PHYSICS SENDS ITS REGARDS",
    "SLINGSHOT CLEAN. THE PLANET DID MOST OF THE WORK",
    "FREE SPEED, COURTESY OF A LARGE ROCK",
  ],
  ore: [
    "ORE IN THE HOLD. IT'S ROCKS. WE'RE CALLING IT FUEL",
  ],
```

`src/components/layout/RadioChatter.tsx`: delete the `isTeleporting` subscription (the one that picks `"wrap"`) and update the comment above `const unsubs` to `// Zone entry interrupts the ambient cadence immediately`.

`tests/chatterScheduler.test.ts`: in the `pools` fixture replace `wrap: ["wrap-1"],` with `haze: ["haze-1"], slingshot: ["sling-1"], ore: ["ore-1"],`, and in "allows repeats for single-line pools" use `"haze"`/`"haze-1"`. Add:

```ts
  it("picks the haze, slingshot and ore pools", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("haze")).toBe("haze-1");
    expect(s.pick("slingshot")).toBe("sling-1");
    expect(s.pick("ore")).toBe("ore-1");
  });
```

- [ ] **Step 6: Flash test id and the reduced-motion probe**

The teleport flash still exists (number-key and d-pad jumps use it); only the wrap stopped firing it. `reducedmotion.probe.mjs` used a wrap to fire it, and its overlay selector `.backdrop-blur-\[3px\]` matches nothing in App.tsx, so that check could never fail.

`src/App.tsx`: add `data-testid="teleport-flash"` to the flash `motion.div`.

`tests/e2e/reducedmotion.probe.mjs`: replace the `teleport(0, 260, 0)` line and the comment block above it with:

```js
    // The teleport flash must never render under reduced motion. Number-key
    // and d-pad jumps fire it; the wrap no longer does (it is hidden in the
    // edge haze). Fire the store flag directly so the check is deterministic,
    // and confirm below that it really fired, so "never rendered" is evidence.
    await page.evaluate(() => window.__fitz.store.getState().triggerTeleportFlash());
```

In the polling loop replace the selector with `document.querySelector('[data-testid="teleport-flash"]')`, and rename the first check to `"jump flash actually fired the store flag (flash check is not vacuous)"`.

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run tests/edgeHaze.test.ts tests/chatterScheduler.test.ts tests/spaceStore.test.ts tests/toroidal.test.ts tests/toroidal3.test.ts tests/wrapDelta.test.ts tests/fuel.test.ts && npx tsc -b`
Expected: PASS. `tsc` flags any leftover reference to the `wrap` pool; fix each by deleting it.

- [ ] **Step 8: Commit**

```bash
git add src/utils/edgeHaze.ts src/components/canvas/Spaceship.tsx src/components/layout/RadioChatter.tsx src/utils/chatterScheduler.ts src/data/chatterLines.ts src/App.tsx tests/edgeHaze.test.ts tests/chatterScheduler.test.ts tests/e2e/reducedmotion.probe.mjs
git commit -m "feat(edge): exact silent wrap; haze depth maths and radio pools

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The haze overlay

**Files:**
- Create: `src/components/layout/EdgeHaze.tsx`
- Modify: `src/App.tsx` (mount)

**Interfaces:**
- Consumes: `edgeDepth`, `HAZE_MAX_OPACITY`, `HazeLineGate` (Task 8); `sendBroadcast(text, { silent: true })` (Task 3); `chatterPools.haze` (Task 8); `RADIO_BUSY_S` from `src/utils/cargoReaction.ts`.
- Produces: a DOM element `[data-testid="edge-haze"]` whose inline `opacity` is `HAZE_MAX_OPACITY × edgeDepth(ship)`. The e2e probe in Task 18 reads it.

- [ ] **Step 1: Create the component**

```tsx
import { useEffect, useRef } from "react";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { edgeDepth, HAZE_MAX_OPACITY, HazeLineGate } from "../../utils/edgeHaze";
import { ChatterScheduler } from "../../utils/chatterScheduler";
import { chatterPools } from "../../data/chatterLines";
import { RADIO_BUSY_S } from "../../utils/cargoReaction";

/**
 * Nebula haze at the edge of the universe (spec §4). The wrap still happens at
 * ±COSMIC_BOUNDS, but by then this is ~92% opaque, and the far side is just as
 * deep, so the jump is never seen: the view clears as the pilot flies inward.
 *
 * A DOM layer, not a scene object: it costs no shader program, and the rAF
 * loop writes its opacity straight to the element, so flight never renders
 * React (the same pattern as the HUD telemetry). No backdrop-filter
 * (tests/noBackdropFilter.test.ts).
 */
export default function EdgeHaze() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scheduler = new ChatterScheduler(chatterPools);
    const gate = new HazeLineGate();
    const lastBroadcast = { id: 0, at: -Infinity };
    let raf = 0;
    const tick = () => {
      const depth = edgeDepth(flight.x, flight.y, flight.z);
      if (ref.current) ref.current.style.opacity = (HAZE_MAX_OPACITY * depth).toFixed(3);
      const s = useSpaceStore.getState();
      const now = performance.now() / 1000;
      const bid = s.broadcast?.id ?? 0;
      if (bid !== lastBroadcast.id) { lastBroadcast.id = bid; lastBroadcast.at = now; }
      if (gate.update(depth, now - lastBroadcast.at < RADIO_BUSY_S, s.race.phase === "running")) {
        s.sendBroadcast(scheduler.pick("haze"), { silent: true });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={ref} data-testid="edge-haze" aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[35]"
      style={{
        opacity: 0,
        background:
          "radial-gradient(ellipse at center, rgba(88,52,160,0.82) 0%, rgba(30,104,128,0.92) 55%, rgba(10,6,24,1) 100%)",
      }} />
  );
}
```

- [ ] **Step 2: Mount it in `App.tsx`**

Import `EdgeHaze from "./components/layout/EdgeHaze"`. Directly after the cinematic letterbox block, add:

```tsx
      {/* Edge-of-universe nebula haze: above the canvas, under the scanlines
          and HUD. Kept in photo mode, where the ship can sit in it. */}
      {!showClassicCV && <EdgeHaze />}
```

- [ ] **Step 3: Verify**

Run: `npx tsc -b && npx vitest run tests/noBackdropFilter.test.ts`
Expected: PASS.

Run the dev server (`npm run dev`) in its own terminal, open the app, and in the browser console run `__fitz.teleport(235, 0, 0)`. The screen should be mostly violet and teal haze. `__fitz.teleport(0, 0, 18)` clears it. Stop the dev server with Ctrl-C in its terminal (do not `kill` by name).

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/EdgeHaze.tsx src/App.tsx
git commit -m "feat(edge): nebula haze overlay hides the wrap; one haze line per visit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase C — Gravity

### Task 10: Capture needs a slow approach (orbit lock rule)

(Comes before the gravity module because Task 11's tuning tests use `canCapture`.)

**Files:**
- Create: `src/utils/capture.ts`
- Modify: `src/components/canvas/SpacePlanets.tsx:473-476`
- Test: `tests/capture.test.ts`

**Interfaces:**
- Consumes: `LOCK_ENGAGE_FACTOR` (`src/constants.ts`), `flight.speed`.
- Produces: `CAPTURE_SPEED = 14`, `CAPTURE_SURFACE_MARGIN = 2`, `canCapture(dist: number, size: number, speed: number): boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/capture.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canCapture, CAPTURE_SPEED, CAPTURE_SURFACE_MARGIN } from "../src/utils/capture";
import { LOCK_ENGAGE_FACTOR } from "../src/constants";

const size = 16;
const engage = size * LOCK_ENGAGE_FACTOR; // 20.8

describe("canCapture", () => {
  it("never captures outside the engage radius", () => {
    expect(canCapture(engage + 0.01, size, 0)).toBe(false);
  });
  it("captures a slow approach anywhere inside the engage radius", () => {
    expect(canCapture(engage - 0.01, size, CAPTURE_SPEED - 0.01)).toBe(true);
  });
  it("lets a fast pass skim without capture", () => {
    expect(canCapture(19, size, CAPTURE_SPEED)).toBe(false);
  });
  it("always captures within the surface safety net, at any speed", () => {
    expect(canCapture(size + CAPTURE_SURFACE_MARGIN - 0.01, size, 39)).toBe(true);
  });
  it("docks outside the planet at 20 fps", () => {
    // Warp at 39 u/s, dt clamped at 0.05: 1.95u per step. Walk straight in
    // from 25u and take the first captured step: it must be outside the planet.
    let r = 25;
    while (!canCapture(r, size, 39)) r -= 39 * 0.05;
    expect(r).toBeGreaterThan(size);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/capture.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/utils/capture.ts`:

```ts
import { LOCK_ENGAGE_FACTOR } from "../constants";

/**
 * Orbit capture (spec §5.4). Locking opens the dossier modal, so a fast
 * slingshot must be able to skim past without it: capture needs a slow
 * approach, as real capture needs low relative speed. The surface net always
 * captures, so warping straight at a planet still docks and nothing can pass
 * through one. 2u covers a 1.95u warp step at the 0.05s frame clamp.
 */
export const CAPTURE_SPEED = 14;
export const CAPTURE_SURFACE_MARGIN = 2;

export function canCapture(dist: number, size: number, speed: number): boolean {
  return dist < size * LOCK_ENGAGE_FACTOR && (speed < CAPTURE_SPEED || dist < size + CAPTURE_SURFACE_MARGIN);
}
```

`src/components/canvas/SpacePlanets.tsx`: import `canCapture` from `../../utils/capture` and replace:

```ts
        if (dist < p.size * LOCK_ENGAGE_FACTOR && !isOrbitCooldown) lockActive = true;
```

with:

```ts
        // A fast pass skims; a slow one (or one about to touch the surface) docks.
        if (canCapture(dist, p.size, flight.speed) && !isOrbitCooldown) lockActive = true;
```

Remove `LOCK_ENGAGE_FACTOR` from that file's imports if it is now unused. The portal branch is unchanged.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/capture.test.ts tests/orbitInvariant.test.ts tests/orbitEscape.test.ts tests/navigation.test.ts && npx tsc -b`
Expected: PASS. (Jumps land at 1.2 × size with zero speed, so they still capture.)

- [ ] **Step 5: Commit**

```bash
git add src/utils/capture.ts src/components/canvas/SpacePlanets.tsx tests/capture.test.ts
git commit -m "feat(gravity): capture needs a slow approach; surface net always docks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `gravityWell.ts`, pure, matching the tuning run

**Files:**
- Create: `src/utils/gravityWell.ts`
- Test: `tests/gravityWell.test.ts`

**Interfaces:**
- Consumes: `wrapDelta` (`src/utils/toroidal.ts`), `COSMIC_BOUNDS` (`src/constants.ts`), `type Vec3` (`src/utils/reactions.ts`), `canCapture` (Task 10).
- Produces:
  - `interface Well { x: number; y: number; z: number; g: number; radius: number; rMin: number }`
  - constants `PLANET_WELL_G = 3000`, `PLANET_WELL_RADIUS_FACTOR = 3.5`, `SUN_WELL_G = 1000`, `SUN_WELL_RADIUS = 110`, `G_HALF_LIFE = 3`, `G_HALF_LIFE_KEEPING = 0.4`, `G_HALF_LIFE_WARP = 0.2`, `CLIMB_OUT = 0.4`, `FLING_HALF_LIFE = 0.25`, `G_MAX = 14`, `SPEED_CEILING = 24`, `STATION_KEEP_AFTER = 0.6`, `SLINGSHOT_SPEED = 14`, `SLINGSHOT_COOLDOWN_S = 30`
  - `type GravityMode = "off" | "free" | "keeping" | "warp"`
  - `gravityMode(hasFlown: boolean, warp: boolean, idleFor: number): GravityMode`
  - `wellAccel(r: number, w: Well): number`
  - `stepGravity(G: Vec3, pos: Vec3, v: Vec3, wells: readonly Well[], count: number, mode: GravityMode, dt: number): Vec3`, mutating and returning `G`
  - `class EscapeGrace { arm(name: string): void; get skip(): string | null; update(distToBody: number, wellRadius: number): void; clear(): void }`
  - `class SlingshotGate { update(exitedFast: boolean, now: number, radioBusy: boolean, raceRunning: boolean): boolean }`

The tests mirror Spaceship's pilot integrator exactly (thrust along a fixed nose, clamp to 10.8, drag `0.982^(dt·60)`, then `stepGravity`, then `pos += (v + G)·dt`). The numbers come from the 2026-10-12 tuning run in spec §5.6. If an assertion misses by a small margin, **do not retune constants silently**: report the measured value.

- [ ] **Step 1: Write the failing tests**

Create `tests/gravityWell.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  stepGravity, wellAccel, gravityMode, EscapeGrace, SlingshotGate, type Well,
  PLANET_WELL_G, SUN_WELL_G, SUN_WELL_RADIUS, G_MAX, SPEED_CEILING, STATION_KEEP_AFTER, CLIMB_OUT,
} from "../src/utils/gravityWell";
import { canCapture } from "../src/utils/capture";

const MAX = 10.8, ACCEL = 25.2, DRAG = 0.982;
const planet = (x = 0, y = 0, z = 0): Well => ({ x, y, z, g: PLANET_WELL_G, radius: 56, rMin: 16 });
const sun = (): Well => ({ x: 0, y: 0, z: 0, g: SUN_WELL_G, radius: SUN_WELL_RADIUS, rMin: 9.5 });
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });

interface Flight {
  minR: number; peak: number; exitSpeed: number | null; captured: { r: number } | null;
  start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number };
}

/** Spaceship's integrator plus stepGravity. Nose fixed at +x; W held unless `thrust` is false. */
function fly(opts: { b: number; x0?: number; v0?: number; wells?: Well[]; seconds?: number; thrust?: boolean; dt?: number }): Flight {
  const { b, x0 = -90, v0 = MAX, wells = [planet()], seconds = 16, thrust = true, dt = 1 / 60 } = opts;
  const p = v3(x0, b, 0), v = v3(v0, 0, 0), G = v3();
  const start = { ...p };
  let idleFor = 0, minR = Infinity, peak = 0, wasIn = false;
  let exitSpeed: number | null = null, captured: { r: number } | null = null;
  for (let i = 0; i < seconds / dt; i++) {
    if (thrust) {
      v.x += ACCEL * dt;
      const l = Math.hypot(v.x, v.y, v.z);
      if (l > MAX) { v.x *= MAX / l; v.y *= MAX / l; v.z *= MAX / l; }
    }
    const k = Math.pow(DRAG, dt * 60);
    v.x *= k; v.y *= k; v.z *= k;
    idleFor = thrust ? 0 : idleFor + dt;
    stepGravity(G, p, v, wells, wells.length, gravityMode(true, false, idleFor), dt);
    p.x += (v.x + G.x) * dt; p.y += (v.y + G.y) * dt; p.z += (v.z + G.z) * dt;
    const r = Math.hypot(p.x - wells[0].x, p.y - wells[0].y, p.z - wells[0].z);
    const s = Math.hypot(v.x + G.x, v.y + G.y, v.z + G.z);
    if (!captured && canCapture(r, 16, s)) captured = { r };
    minR = Math.min(minR, r);
    peak = Math.max(peak, s);
    if (wasIn && r >= wells[0].radius && exitSpeed === null) exitSpeed = s;
    wasIn = wasIn || r < wells[0].radius;
  }
  return { minR, peak, exitSpeed, captured, start, end: { ...p } };
}

describe("wellAccel", () => {
  const w = planet();
  it("falls off with the square of distance", () => {
    expect(wellAccel(20, w) / wellAccel(40, w)).toBeCloseTo(4, 5);
  });
  it("is softened inside rMin and zero at the well's edge", () => {
    expect(wellAccel(5, w)).toBe(wellAccel(16, w));
    expect(wellAccel(56, w)).toBe(0);
    expect(wellAccel(60, w)).toBe(0);
  });
  it("fades smoothly over the outer 20%", () => {
    expect(wellAccel(44.8, w)).toBeCloseTo(PLANET_WELL_G / 44.8 ** 2, 6);
    const mid = wellAccel(50.4, w);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(PLANET_WELL_G / 50.4 ** 2);
  });
});

describe("stepGravity basics", () => {
  it("pulls toward the centre at full strength inbound, CLIMB_OUT outbound", () => {
    const w = planet();
    const inbound = stepGravity(v3(), v3(-30, 0, 0), v3(5, 0, 0), [w], 1, "free", 0.01);
    const outbound = stepGravity(v3(), v3(-30, 0, 0), v3(-5, 0, 0), [w], 1, "free", 0.01);
    expect(inbound.x).toBeGreaterThan(0);
    expect(outbound.x / inbound.x).toBeCloseTo(CLIMB_OUT, 5);
  });
  it("adds overlapping wells", () => {
    const one = stepGravity(v3(), v3(0, 0, 0), v3(0, 0, 1), [planet(30, 0, 0)], 1, "free", 0.01);
    const two = stepGravity(v3(), v3(0, 0, 0), v3(0, 0, 1), [planet(30, 0, 0), planet(30, 0, 0)], 2, "free", 0.01);
    expect(two.x).toBeCloseTo(2 * one.x, 6);
  });
  it("only uses the first `count` wells", () => {
    const g = stepGravity(v3(), v3(0, 0, 0), v3(0, 0, 1), [planet(30, 0, 0), planet(-30, 0, 0)], 1, "free", 0.01);
    expect(g.x).toBeGreaterThan(0);
  });
  it("pulls across the wrap seam the short way", () => {
    const g = stepGravity(v3(), v3(245, 0, 0), v3(0, 0, 1), [planet(-245, 0, 0)], 1, "free", 0.01);
    expect(g.x).toBeGreaterThan(0); // the planet is 10u away through +x, not 490u back through -x
  });
  it("does not pull while keeping station, in warp, or before first input", () => {
    for (const mode of ["keeping", "warp", "off"] as const) {
      const g = stepGravity(v3(), v3(-30, 0, 0), v3(), [planet()], 1, mode, 0.1);
      expect(Math.hypot(g.x, g.y, g.z)).toBe(0);
    }
  });
  it("zeroes momentum when off, decays it fast while keeping station", () => {
    expect(stepGravity(v3(5, 0, 0), v3(), v3(), [], 0, "off", 0.016).x).toBe(0);
    const keep = stepGravity(v3(5, 0, 0), v3(), v3(), [], 0, "keeping", 0.4).x;
    const free = stepGravity(v3(5, 0, 0), v3(), v3(), [], 0, "free", 0.4).x;
    expect(keep).toBeCloseTo(2.5, 5);
    expect(free).toBeGreaterThan(keep);
  });
  it("caps momentum and total speed", () => {
    const g = stepGravity(v3(40, 0, 0), v3(), v3(), [], 0, "free", 0);
    expect(Math.hypot(g.x, g.y, g.z)).toBeCloseTo(G_MAX, 5);
    const g2 = stepGravity(v3(14, 0, 0), v3(), v3(15.8, 0, 0), [], 0, "free", 0);
    expect(15.8 + g2.x).toBeCloseTo(SPEED_CEILING, 5);
  });
});

describe("gravityMode", () => {
  it("maps the safeguards", () => {
    expect(gravityMode(false, false, 0)).toBe("off");
    expect(gravityMode(true, true, 0)).toBe("warp");
    expect(gravityMode(true, false, STATION_KEEP_AFTER)).toBe("keeping");
    expect(gravityMode(true, false, STATION_KEEP_AFTER - 0.01)).toBe("free");
  });
});

describe("tuning targets (spec §5.6)", () => {
  it("b=40: a visible pull and a boost, no capture", () => {
    const f = fly({ b: -40 });
    expect(f.captured).toBeNull();
    expect(f.minR).toBeLessThanOrEqual(36);
    expect(f.peak).toBeGreaterThanOrEqual(14);
  });
  it("b=34: pulled in, leaves the well faster than cruise, no capture", () => {
    const f = fly({ b: -34 });
    expect(f.captured).toBeNull();
    expect(f.minR).toBeLessThanOrEqual(28);
    expect(f.exitSpeed).not.toBeNull();
    expect(f.exitSpeed!).toBeGreaterThanOrEqual(13.5);
  });
  it("b=30: a fast skim inside 20.8 does not open the dossier", () => {
    const f = fly({ b: -30 });
    expect(f.captured).toBeNull();
    expect(f.minR).toBeGreaterThan(18);
  });
  it("b=22 and straight in: docks, never inside 17u first", () => {
    for (const b of [-22, 0.01]) {
      const f = fly({ b });
      expect(f.captured, `b=${b}`).not.toBeNull();
      expect(f.captured!.r, `b=${b}`).toBeGreaterThan(17);
    }
  });
  it("an idle ship 30u out barely drifts (station-keeping)", () => {
    const f = fly({ b: 0.01, x0: -30, v0: 0, thrust: false, seconds: 30 });
    const drift = Math.hypot(f.end.x - f.start.x, f.end.y - f.start.y, f.end.z - f.start.z);
    expect(drift).toBeLessThan(3);
  });
  it("a W-held pass 20u off the sun stays clear of its surface", () => {
    const f = fly({ b: -20, x0: -120, wells: [sun()], seconds: 25 });
    expect(f.minR).toBeGreaterThan(9.5);
  });
});

describe("EscapeGrace", () => {
  it("skips the planet just left until the ship is outside its well", () => {
    const e = new EscapeGrace();
    e.arm("fuxx");
    expect(e.skip).toBe("fuxx");
    e.update(40, 56);
    expect(e.skip).toBe("fuxx");
    e.update(56, 56);
    expect(e.skip).toBeNull();
  });
});

describe("escape grace in a frame loop", () => {
  it("a ship pushed out of orbit at the escape radius is not pulled back into lock", () => {
    // Spaceship's break-orbit push: out to size × ZONE_FACTOR × 1.15 ≈ 33u, drifting out at 4 u/s, then idle.
    const grace = new EscapeGrace();
    grace.arm("p");
    const w = planet();
    const p = v3(-33, 0, 0), v = v3(-4, 0, 0), G = v3();
    let minR = Infinity, idleFor = 0;
    for (let i = 0; i < 20 * 60; i++) {
      const dt = 1 / 60;
      const k = Math.pow(DRAG, dt * 60);
      v.x *= k; v.y *= k; v.z *= k;
      idleFor += dt;
      grace.update(Math.hypot(p.x, p.y, p.z), 56);
      stepGravity(G, p, v, [w], grace.skip ? 0 : 1, gravityMode(true, false, idleFor), dt);
      p.x += (v.x + G.x) * dt; p.y += (v.y + G.y) * dt; p.z += (v.z + G.z) * dt;
      minR = Math.min(minR, Math.hypot(p.x, p.y, p.z));
    }
    expect(minR).toBeGreaterThan(20.8);
  });
});

describe("SlingshotGate", () => {
  it("fires on a fast exit, then waits out its cooldown", () => {
    const g = new SlingshotGate();
    expect(g.update(false, 0, false, false)).toBe(false);
    expect(g.update(true, 1, false, false)).toBe(true);
    expect(g.update(true, 20, false, false)).toBe(false);
    expect(g.update(true, 32, false, false)).toBe(true);
  });
  it("is spent, not deferred, when the radio is busy or a race runs", () => {
    const g = new SlingshotGate();
    expect(g.update(true, 0, true, false)).toBe(false);
    expect(g.update(true, 1, false, true)).toBe(false);
    expect(g.update(true, 2, false, false)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/gravityWell.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/utils/gravityWell.ts`**

```ts
import { COSMIC_BOUNDS } from "../constants";
import { wrapDelta } from "./toroidal";
import type { Vec3 } from "./reactions";

/**
 * Gravity wells (docs/archive/specs/2026-10-12-flight-feel-design.md §5).
 *
 * The ship's flight model is heavily damped (thrust 25.2 u/s², drag ~1.09/s),
 * so gravity added to the pilot's velocity is erased: a tuning run measured
 * 0.3° of bend and no exit boost. Gravity therefore builds its own momentum
 * `G`, which decays slowly; the ship moves by (pilot velocity + G).
 *
 * Three deliberate departures from real physics, all listed in the spec:
 * the separate momentum layer, the lenient climb-out (CLIMB_OUT) and the fling
 * (G swings to the direction of travel while outbound). Constants come from
 * the 2026-10-12 tuning run; the targets they meet are tests/gravityWell.test.ts.
 */
export interface Well { x: number; y: number; z: number; g: number; radius: number; rMin: number }

export const PLANET_WELL_G = 3000;
/** Planet well radius = size × this (56u at size 16). */
export const PLANET_WELL_RADIUS_FACTOR = 3.5;
export const SUN_WELL_G = 1000;
/** Stops short of the inner planet orbit (115). */
export const SUN_WELL_RADIUS = 110;
export const G_HALF_LIFE = 3;
export const G_HALF_LIFE_KEEPING = 0.4;
export const G_HALF_LIFE_WARP = 0.2;
export const CLIMB_OUT = 0.4;
export const FLING_HALF_LIFE = 0.25;
export const G_MAX = 14;
/** Total speed ceiling outside warp. 24 × 0.05s = 1.2u per step, far under race MAX_STEP. */
export const SPEED_CEILING = 24;
/** No thrust for this long and the ship keeps station: no pull. */
export const STATION_KEEP_AFTER = 0.6;
/** Leaving a planet well faster than this is a slingshot (sound and radio). */
export const SLINGSHOT_SPEED = 14;
export const SLINGSHOT_COOLDOWN_S = 30;
/** Pull fades from full at this share of the radius to zero at the edge. */
const FADE_FROM = 0.8;

export type GravityMode = "off" | "free" | "keeping" | "warp";

/** Which safeguard applies this frame (spec §5.2). */
export function gravityMode(hasFlown: boolean, warp: boolean, idleFor: number): GravityMode {
  if (!hasFlown) return "off";
  if (warp) return "warp";
  return idleFor >= STATION_KEEP_AFTER ? "keeping" : "free";
}

/** Pull magnitude at distance `r` from a well's centre. */
export function wellAccel(r: number, w: Well): number {
  if (r >= w.radius) return 0;
  const rr = Math.max(r, w.rMin);
  const u = Math.min(1, Math.max(0, (r - FADE_FROM * w.radius) / ((1 - FADE_FROM) * w.radius)));
  return (w.g / (rr * rr)) * (1 - u * u * (3 - 2 * u));
}

/**
 * Advances gravity momentum `G` by one frame and returns it. `pos` is the
 * ship, `v` the pilot's velocity (read only), `wells[0..count)` the active
 * wells. Order matches the tuning run: decay, then per well the pull (scaled
 * by CLIMB_OUT outbound) and the outbound fling, then the caps.
 */
export function stepGravity(G: Vec3, pos: Vec3, v: Vec3, wells: readonly Well[], count: number, mode: GravityMode, dt: number): Vec3 {
  if (mode === "off") { G.x = 0; G.y = 0; G.z = 0; return G; }
  const hl = mode === "free" ? G_HALF_LIFE : mode === "keeping" ? G_HALF_LIFE_KEEPING : G_HALF_LIFE_WARP;
  const k = Math.pow(0.5, dt / hl);
  G.x *= k; G.y *= k; G.z *= k;

  if (mode === "free") {
    // Direction of travel, measured once before this frame's pull.
    const tx = v.x + G.x, ty = v.y + G.y, tz = v.z + G.z;
    const ts = Math.hypot(tx, ty, tz) || 1;
    const kFling = 1 - Math.pow(0.5, dt / FLING_HALF_LIFE);
    for (let i = 0; i < count; i++) {
      const w = wells[i];
      const dx = wrapDelta(pos.x, w.x, COSMIC_BOUNDS);
      const dy = wrapDelta(pos.y, w.y, COSMIC_BOUNDS);
      const dz = wrapDelta(pos.z, w.z, COSMIC_BOUNDS);
      const r = Math.hypot(dx, dy, dz);
      if (r >= w.radius || r < 1e-6) continue;
      const ux = dx / r, uy = dy / r, uz = dz / r;
      let a = wellAccel(r, w);
      if (tx * ux + ty * uy + tz * uz < 0) {
        // Outbound: lenient climb-out, and G swings toward the direction of
        // travel, keeping its length (the fling).
        a *= CLIMB_OUT;
        const gl = Math.hypot(G.x, G.y, G.z);
        if (gl > 1e-6) {
          const nx = G.x + ((tx / ts) * gl - G.x) * kFling;
          const ny = G.y + ((ty / ts) * gl - G.y) * kFling;
          const nz = G.z + ((tz / ts) * gl - G.z) * kFling;
          const nl = Math.hypot(nx, ny, nz) || 1;
          G.x = (nx / nl) * gl; G.y = (ny / nl) * gl; G.z = (nz / nl) * gl;
        }
      }
      G.x += ux * a * dt; G.y += uy * a * dt; G.z += uz * a * dt;
    }
  }

  const gl = Math.hypot(G.x, G.y, G.z);
  if (gl > G_MAX) { const s = G_MAX / gl; G.x *= s; G.y *= s; G.z *= s; }
  const sx = v.x + G.x, sy = v.y + G.y, sz = v.z + G.z;
  const sl = Math.hypot(sx, sy, sz);
  if (sl > SPEED_CEILING) {
    const s = SPEED_CEILING / sl;
    G.x = sx * s - v.x; G.y = sy * s - v.y; G.z = sz * s - v.z;
  }
  return G;
}

/**
 * After breaking orbit, the escape push leaves the ship inside the planet's
 * well; pulling it straight back would relock it. The planet just left is
 * skipped until the ship is outside that planet's well.
 */
export class EscapeGrace {
  private name: string | null = null;
  arm(name: string): void { this.name = name; }
  get skip(): string | null { return this.name; }
  update(distToBody: number, wellRadius: number): void { if (this.name && distToBody >= wellRadius) this.name = null; }
  clear(): void { this.name = null; }
}

/**
 * Radio line for a slingshot: on a fast well exit, at most once per
 * SLINGSHOT_COOLDOWN_S, never over a busy radio or during a race. A
 * suppressed exit is spent, not deferred, like cargo hails (HailGate).
 */
export class SlingshotGate {
  private lastAt = -Infinity;
  update(exitedFast: boolean, now: number, radioBusy: boolean, raceRunning: boolean): boolean {
    if (!exitedFast || radioBusy || raceRunning || now - this.lastAt < SLINGSHOT_COOLDOWN_S) return false;
    this.lastAt = now;
    return true;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/gravityWell.test.ts`
Expected: PASS. If a §5.6 target or the escape-grace loop misses, print the measured value (for example `console.log(fly({ b: -34 }))`) and report it with the failing assertion; do not change constants.

- [ ] **Step 5: Commit**

```bash
git add src/utils/gravityWell.ts tests/gravityWell.test.ts
git commit -m "feat(gravity): pure gravity-momentum wells with fling and safeguards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Wire gravity momentum into the ship

**Files:**
- Modify: `src/components/canvas/Spaceship.tsx`
- Modify: `src/debug/bridge.ts` (add `gravity`)
- Modify: `src/audio/soundManager.ts` (`whoosh`)
- Modify: `src/components/layout/HUDOverlay.tsx` (speed colour)

**Interfaces:**
- Consumes: everything from Task 11; `planets`, `bodies`; `SUN_COLLIDER` (already imported in Spaceship).
- Produces: `fitzDebug.gravity: { x: number; y: number; z: number } | null` (live `G`, dev only); `flight.speed` is now `|v + G|`.

- [ ] **Step 1: Add the bridge handle**

In `src/debug/bridge.ts`, add to `FitzDebug`:

```ts
  /** Live gravity momentum G (Spaceship, dev only). */
  gravity: { x: number; y: number; z: number } | null;
```

and `gravity: null,` to the `fitzDebug` object.

- [ ] **Step 2: Module-level well pool in `Spaceship.tsx`**

Add imports (add `COSMIC_BOUNDS` back to the constants import if Task 8 removed it):

```ts
import {
  stepGravity, gravityMode, EscapeGrace, SlingshotGate, type Well,
  PLANET_WELL_G, PLANET_WELL_RADIUS_FACTOR, SUN_WELL_G, SUN_WELL_RADIUS, SLINGSHOT_SPEED, G_MAX,
} from "../../utils/gravityWell";
import { toroidalDistance3 } from "../../utils/toroidal";
import { ChatterScheduler } from "../../utils/chatterScheduler";
import { chatterPools } from "../../data/chatterLines";
import { RADIO_BUSY_S } from "../../utils/cargoReaction";
```

After `const COLLIDERS = ...`:

```ts
/**
 * Gravity wells, one per planet plus the sun, reused every frame: planet
 * entries are refreshed from `bodies`, and the active ones are copied to the
 * front of ACTIVE_WELLS so stepGravity takes a count instead of a fresh array.
 */
const PLANET_WELLS: Well[] = planets.map((p) => ({
  x: 0, y: 0, z: 0, g: PLANET_WELL_G, radius: p.size * PLANET_WELL_RADIUS_FACTOR, rMin: p.size,
}));
const SUN_WELL: Well = { x: SUN_COLLIDER.x, y: SUN_COLLIDER.y, z: SUN_COLLIDER.z, g: SUN_WELL_G, radius: SUN_WELL_RADIUS, rMin: SUN_COLLIDER.r };
const ACTIVE_WELLS: Well[] = Array.from({ length: planets.length + 1 }, () => ({ ...SUN_WELL }));
const slingshotLines = new ChatterScheduler(chatterPools);
/** Total velocity (pilot + gravity) scratch. */
const _total = new THREE.Vector3();
```

- [ ] **Step 3: Refs and reset points**

Inside the component, next to the other refs:

```ts
  // Gravity momentum (spec §5): built by wells, decays slowly; the ship moves
  // by vel + gravity. Zeroed wherever the ship is placed, docked or bounced.
  const gravity = useRef({ x: 0, y: 0, z: 0 });
  const idleFor = useRef(0);
  const escapeGrace = useRef(new EscapeGrace());
  /** Planet whose well the ship was in last frame (for slingshot exits). */
  const inWell = useRef<string | null>(null);
  const slingshotGate = useRef(new SlingshotGate());
  const lastBroadcast = useRef({ id: 0, at: -Infinity });
  const zeroGravity = () => { gravity.current.x = 0; gravity.current.y = 0; gravity.current.z = 0; };
```

Then:

1. In the dev `useEffect`, in `fitzDebug.teleport`, call `zeroGravity()` after `vel.current.set(0, 0, 0)`; register `fitzDebug.gravity = gravity.current;`, and in the cleanup set `fitzDebug.gravity = null;`. (Declare `gravity` above this effect so it is in scope.)
2. In the orbit-lock `useEffect`, at the start of the lock-entry branch (`if (!wasLocked && isOrbitLocked)`), call `zeroGravity();` and `escapeGrace.current.clear();`. In the break branch, after `vel.current.subVectors(...)`, add:

```ts
    zeroGravity();
    // The escape push leaves the ship inside this planet's well; skip its pull
    // until the ship is clear, or it would be dragged straight back into lock.
    const left = lockedZone.current;
    if (left && planets.some((p) => p.name === left)) escapeGrace.current.arm(left);
```

3. In the frame loop's orbit-lock branch, before `applyChaseCam(false, true)`, add `zeroGravity(); _total.set(0, 0, 0);`.
4. In the pending-jump block, after `vel.current.set(0, 0, 0);`, add `zeroGravity();`.

- [ ] **Step 4: Gravity step, integration and collisions**

Replace `pos.current.addScaledVector(vel.current, dt);` with:

```ts
    // Gravity wells (spec §5): momentum G on top of the unchanged pilot velocity.
    idleFor.current = thrustInput > 0 ? 0 : idleFor.current + dt;
    const grace = escapeGrace.current;
    if (grace.skip) {
      const gb = bodies[grace.skip];
      const gp = planets.find((q) => q.name === grace.skip);
      if (gb && gp) grace.update(toroidalDistance3(pos.current.x, pos.current.z, pos.current.y, gb.x, gb.z, gb.y, COSMIC_BOUNDS), gp.size * PLANET_WELL_RADIUS_FACTOR);
      else grace.clear();
    }
    let wellCount = 0;
    for (let i = 0; i < planets.length; i++) {
      if (planets[i].name === grace.skip) continue;
      const b = bodies[planets[i].name], src = PLANET_WELLS[i], dst = ACTIVE_WELLS[wellCount++];
      dst.x = b.x; dst.y = b.y; dst.z = b.z; dst.g = src.g; dst.radius = src.radius; dst.rMin = src.rMin;
    }
    const sunDst = ACTIVE_WELLS[wellCount++];
    sunDst.x = SUN_WELL.x; sunDst.y = SUN_WELL.y; sunDst.z = SUN_WELL.z;
    sunDst.g = SUN_WELL.g; sunDst.radius = SUN_WELL.radius; sunDst.rMin = SUN_WELL.rMin;
    const g = gravity.current;
    stepGravity(g, pos.current, vel.current, ACTIVE_WELLS, wellCount, gravityMode(hasFlown.current, warpActive, idleFor.current), dt);

    pos.current.x += (vel.current.x + g.x) * dt;
    pos.current.y += (vel.current.y + g.y) * dt;
    pos.current.z += (vel.current.z + g.z) * dt;
```

In the collision loop's `if (hit) { ... }`, after `vel.current.set(hit.vx, hit.vy, hit.vz);`, add `zeroGravity(); // momentum into the sun would just hit it again`.

- [ ] **Step 5: Total speed everywhere the ship reports or frames speed**

Right after the collision loop:

```ts
    _total.set(vel.current.x + gravity.current.x, vel.current.y + gravity.current.y, vel.current.z + gravity.current.z);
    const totalSpeed = _total.length();
```

- In `applyChaseCam`, replace `vel.current.length()` with `_total.length()`.
- In the streaks block, replace `const speed = vel.current.length();` with `const speed = totalSpeed;`.
- In telemetry, `flight.speed = totalSpeed;`.

- [ ] **Step 6: Slingshot exit, plume and sound**

After `totalSpeed` is computed, add:

```ts
    // Which planet well the ship is in now; leaving one fast is a slingshot.
    let wellNow: string | null = null;
    for (let i = 0; i < planets.length; i++) {
      const b = bodies[planets[i].name];
      if (toroidalDistance3(pos.current.x, pos.current.z, pos.current.y, b.x, b.z, b.y, COSMIC_BOUNDS) < PLANET_WELLS[i].radius) { wellNow = planets[i].name; break; }
    }
    if (inWell.current && wellNow !== inWell.current) {
      const fast = totalSpeed > SLINGSHOT_SPEED;
      if (fast) soundManager.whoosh();
      const bid = store.broadcast?.id ?? 0;
      if (bid !== lastBroadcast.current.id) { lastBroadcast.current.id = bid; lastBroadcast.current.at = time; }
      if (slingshotGate.current.update(fast, time, time - lastBroadcast.current.at < RADIO_BUSY_S, store.race.phase === "running")) {
        store.sendBroadcast(slingshotLines.pick("slingshot"), { silent: true });
      }
    }
    inWell.current = wellNow;
```

Change the free-flight `drivePlumes(...)` call to:

```ts
    const assist = Math.min(1, Math.hypot(gravity.current.x, gravity.current.y, gravity.current.z) / G_MAX);
    drivePlumes(
      (warpActive ? 2.8 : thrustInput > 0 ? 0.8 + 0.9 * thrustInput : 0.35) + assist * 0.9,
      (warpActive ? 2.0 : thrustInput > 0 ? 0.55 + 0.45 * thrustInput : 0.25) + assist * 0.8,
      time, dt);
```

In `src/audio/soundManager.ts`, add after `scanBeep`:

```ts
  /** Leaving a gravity well fast: rising sweep */
  whoosh() {
    this.blip("sawtooth", 180, 0.55, 0.045, 760);
  }
```

- [ ] **Step 7: HUD speed colour**

In `src/components/layout/HUDOverlay.tsx`'s telemetry rAF loop, after writing `velRef.current.textContent`:

```ts
      // Accent while a gravity assist carries the ship past cruise speed.
      if (velRef.current) velRef.current.style.color = flight.speed > SHIP_MAX_SPEED ? "#bd00ff" : "";
```

Import `SHIP_MAX_SPEED` from `../../constants`.

- [ ] **Step 8: Full unit suite, typecheck, lint**

Run: `npm test && npx tsc -b && npm run lint`
Expected: all green.

- [ ] **Step 9: Manual check**

Run `npm run dev` in its own terminal, open the app, press W once, then in the console:
`const b = __fitz.bodies.portfolio; __fitz.teleport(b.x - 90, b.y + 34, b.z); __fitz.setAttitude(Math.PI / 2, 0)`
and hold W. The ship should visibly bend toward the planet, the speed readout should turn violet, and a whoosh should play on the way out. Stop the dev server with Ctrl-C.

- [ ] **Step 10: Commit**

```bash
git add src/components/canvas/Spaceship.tsx src/debug/bridge.ts src/audio/soundManager.ts src/components/layout/HUDOverlay.tsx
git commit -m "feat(gravity): planets and the sun pull; slingshot boost, whoosh and callout

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase D — Tractor beam and mining

### Task 13: Beam maths and shared state

**Files:**
- Create: `src/utils/tractorBeam.ts`
- Create: `src/store/beamState.ts`
- Test: `tests/tractorBeam.test.ts`

**Interfaces:**
- Produces (`src/utils/tractorBeam.ts`):
  - `BEAM_MAX_TARGETS = 3`, `BEAM_HALF_ANGLE = 20 * Math.PI / 180`, `BEAM_RANGE = 30`, `PEBBLE_RANGE = 15`, `CRYSTAL_PULL_SPEED = 20`, `PEBBLE_PULL_SPEED = 8`, `REEL_ACCEL = 15`
  - `type BeamKind = "crystal" | "shard" | "pebble"`
  - `interface BeamSelection { count: number; kind: BeamKind[]; index: number[]; ring: number[]; dist: number[]; x: number[]; y: number[]; z: number[] }`
  - `createSelection(): BeamSelection`, `clearSelection(sel: BeamSelection): void`
  - `inCone(ox, oy, oz, dx, dy, dz, tx, ty, tz, range): number`, the wrap-aware distance if the target is inside the cone and range, else -1
  - `consider(sel, max, kind, index, ring, dist, x, y, z): void`, nearest-first insertion keeping at most `max`
  - `pullStep(p: Vec3, ship: Vec3, shipVel: Vec3, speed: number, dt: number): number`, moving `p` toward the ship at `speed` relative to it and returning the remaining distance
  - `reelStep(v: Vec3, dirX: number, dirY: number, dirZ: number, dt: number, maxSpeed: number): void`
- Produces (`src/store/beamState.ts`): `beamState` with the fields shown below.

- [ ] **Step 1: Write the failing tests**

Create `tests/tractorBeam.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  inCone, consider, createSelection, clearSelection, pullStep, reelStep,
  BEAM_RANGE, BEAM_MAX_TARGETS, REEL_ACCEL,
} from "../src/utils/tractorBeam";

describe("inCone", () => {
  it("accepts a target ahead within range and rejects one behind or off-axis", () => {
    expect(inCone(0, 0, 0, 0, 0, 1, 0, 0, 20, BEAM_RANGE)).toBeCloseTo(20);
    expect(inCone(0, 0, 0, 0, 0, 1, 0, 0, -20, BEAM_RANGE)).toBe(-1);
    expect(inCone(0, 0, 0, 0, 0, 1, 20, 0, 20, BEAM_RANGE)).toBe(-1); // 45° off
    expect(inCone(0, 0, 0, 0, 0, 1, 0, 0, 31, BEAM_RANGE)).toBe(-1);
  });
  it("sees a target across the wrap seam", () => {
    // Ship at x=245 looking +x; a crystal at x=-248 is 7u ahead through the seam.
    expect(inCone(245, 0, 0, 1, 0, 0, -248, 0, 0, BEAM_RANGE)).toBeCloseTo(7);
  });
});

describe("consider", () => {
  it("keeps the nearest BEAM_MAX_TARGETS, nearest first", () => {
    const sel = createSelection();
    for (const [i, d] of [[0, 25], [1, 5], [2, 18], [3, 9], [4, 30]] as const) consider(sel, BEAM_MAX_TARGETS, "crystal", i, -1, d, 0, 0, d);
    expect(sel.count).toBe(3);
    expect(sel.index.slice(0, 3)).toEqual([1, 3, 2]);
    clearSelection(sel);
    expect(sel.count).toBe(0);
  });
  it("respects a smaller budget", () => {
    const sel = createSelection();
    consider(sel, 1, "shard", 7, -1, 12, 0, 0, 12);
    consider(sel, 1, "shard", 8, -1, 4, 0, 0, 4);
    expect(sel.count).toBe(1);
    expect(sel.index[0]).toBe(8);
  });
});

describe("pullStep", () => {
  it("closes the gap at the pull speed relative to a moving ship", () => {
    const p = { x: 0, y: 0, z: 20 }, ship = { x: 0, y: 0, z: 0 }, vel = { x: 0, y: 0, z: 10 };
    // The ship moves +z at 10; the item first rides along (+1), then closes 2u toward it.
    const left = pullStep(p, ship, vel, 20, 0.1);
    expect(p.z).toBeCloseTo(19);
    expect(left).toBeCloseTo(19);
  });
  it("never overshoots the ship", () => {
    const p = { x: 0, y: 0, z: 1 };
    pullStep(p, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 20, 1);
    expect(p.z).toBeCloseTo(0);
  });
});

describe("reelStep", () => {
  it("accelerates toward the shard and never past cruise speed", () => {
    const v = { x: 0, y: 0, z: 0 };
    reelStep(v, 0, 0, 1, 0.1, 10.8);
    expect(v.z).toBeCloseTo(REEL_ACCEL * 0.1);
    for (let i = 0; i < 100; i++) reelStep(v, 0, 0, 1, 0.1, 10.8);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(10.8);
  });
});
```

Note on the first `pullStep` case: `ship` is passed as a fixed point, so after adding the ship's motion the item is at z = 21 and 21u from the ship; it then closes 2u (20 × 0.1), to z = 19, with 19u left.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/tractorBeam.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/utils/tractorBeam.ts`**

```ts
import { COSMIC_BOUNDS } from "../constants";
import { wrapDelta } from "./toroidal";
import type { Vec3 } from "./reactions";

/**
 * Tractor beam (spec §6). One rule: the lighter object moves. Crystals and
 * belt pebbles come to the ship; data shards are anchored, so the beam reels
 * the ship toward them. Pure and allocation-free; wrap-aware throughout.
 */
export const BEAM_MAX_TARGETS = 3;
export const BEAM_HALF_ANGLE = (20 * Math.PI) / 180;
const COS_HALF = Math.cos(BEAM_HALF_ANGLE);
export const BEAM_RANGE = 30;
export const PEBBLE_RANGE = 15;
export const CRYSTAL_PULL_SPEED = 20;
export const PEBBLE_PULL_SPEED = 8;
export const REEL_ACCEL = 15;

export type BeamKind = "crystal" | "shard" | "pebble";

/** Up to BEAM_MAX_TARGETS targets, nearest first. Parallel arrays: no allocation per frame. */
export interface BeamSelection {
  count: number;
  kind: BeamKind[]; index: number[]; ring: number[]; dist: number[];
  x: number[]; y: number[]; z: number[];
}

export function createSelection(): BeamSelection {
  const n = BEAM_MAX_TARGETS;
  return {
    count: 0, kind: Array<BeamKind>(n).fill("crystal"), index: Array(n).fill(-1), ring: Array(n).fill(-1),
    dist: Array(n).fill(Infinity), x: Array(n).fill(0), y: Array(n).fill(0), z: Array(n).fill(0),
  };
}

export function clearSelection(sel: BeamSelection): void { sel.count = 0; }

/**
 * Distance from the nose origin to the target if it lies inside the beam cone
 * (half-angle BEAM_HALF_ANGLE about the unit direction d) and within `range`;
 * -1 otherwise. Uses the shortest delta across the wrap seam.
 */
export function inCone(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  tx: number, ty: number, tz: number, range: number,
): number {
  const rx = wrapDelta(ox, tx, COSMIC_BOUNDS), ry = wrapDelta(oy, ty, COSMIC_BOUNDS), rz = wrapDelta(oz, tz, COSMIC_BOUNDS);
  const dist = Math.hypot(rx, ry, rz);
  if (dist > range) return -1;
  if (dist < 1e-6) return 0;
  return (rx * dx + ry * dy + rz * dz) / dist >= COS_HALF ? dist : -1;
}

/** Nearest-first insertion; keeps at most `max` (≤ BEAM_MAX_TARGETS). */
export function consider(
  sel: BeamSelection, max: number, kind: BeamKind, index: number, ring: number,
  dist: number, x: number, y: number, z: number,
): void {
  if (max <= 0) return;
  let at = sel.count;
  while (at > 0 && sel.dist[at - 1] > dist) at--;
  if (at >= max) return;
  const last = Math.min(sel.count, max - 1);
  for (let i = last; i > at; i--) {
    sel.kind[i] = sel.kind[i - 1]; sel.index[i] = sel.index[i - 1]; sel.ring[i] = sel.ring[i - 1];
    sel.dist[i] = sel.dist[i - 1]; sel.x[i] = sel.x[i - 1]; sel.y[i] = sel.y[i - 1]; sel.z[i] = sel.z[i - 1];
  }
  sel.kind[at] = kind; sel.index[at] = index; sel.ring[at] = ring; sel.dist[at] = dist;
  sel.x[at] = x; sel.y[at] = y; sel.z[at] = z;
  sel.count = Math.min(max, sel.count + 1);
}

/**
 * Moves `p` toward the ship at `speed` RELATIVE to it (the ship's own motion
 * is added first, so a pull keeps up with a moving ship), never past it.
 * Returns the remaining distance. Wrap-aware.
 */
export function pullStep(p: Vec3, ship: Vec3, shipVel: Vec3, speed: number, dt: number): number {
  p.x += shipVel.x * dt; p.y += shipVel.y * dt; p.z += shipVel.z * dt;
  const dx = wrapDelta(p.x, ship.x, COSMIC_BOUNDS), dy = wrapDelta(p.y, ship.y, COSMIC_BOUNDS), dz = wrapDelta(p.z, ship.z, COSMIC_BOUNDS);
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return 0;
  const step = Math.min(d, speed * dt);
  p.x += (dx / d) * step; p.y += (dy / d) * step; p.z += (dz / d) * step;
  return d - step;
}

/** Reels the pilot's velocity toward a shard along the unit direction, capped at maxSpeed. */
export function reelStep(v: Vec3, dirX: number, dirY: number, dirZ: number, dt: number, maxSpeed: number): void {
  v.x += dirX * REEL_ACCEL * dt; v.y += dirY * REEL_ACCEL * dt; v.z += dirZ * REEL_ACCEL * dt;
  const l = Math.hypot(v.x, v.y, v.z);
  if (l > maxSpeed) { const s = maxSpeed / l; v.x *= s; v.y *= s; v.z *= s; }
}
```

Create `src/store/beamState.ts`:

```ts
import { createSelection } from "../utils/tractorBeam";

/**
 * Per-frame tractor-beam state, mutable outside React like `flight` (spec §6).
 * Spaceship writes the beam's origin, direction, activity and the ship's total
 * velocity; TractorBeam selects crystal and shard targets into `sel`;
 * FuelCrystals and AsteroidBelt apply pulls; HUD and sound read the ore
 * fields. A one-frame lag between writer and readers is acceptable.
 */
export const beamState = {
  active: false,
  ox: 0, oy: 0, oz: 0,
  dx: 0, dy: 0, dz: 1,
  /** Ship's total velocity (pilot + gravity) this frame, for relative pulls. */
  vel: { x: 0, y: 0, z: 0 },
  /** This frame's crystal and shard targets (pebbles are tethered in mining.ts). */
  sel: createSelection(),
  /** Nearest selected shard: Spaceship reels toward it. */
  reel: { active: false, x: 0, y: 0, z: 0 },
  /** Pebbles absorbed toward the next crystal's worth (0..ORE_PER_CRYSTAL-1). */
  ore: 0,
  /** performance.now() of the last absorbed pebble, for the HUD readout. */
  oreAt: -Infinity,
  /** Pebbles absorbed since the beam last switched on (beam hum pitch). */
  oreStreak: 0,
};
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/tractorBeam.test.ts && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/tractorBeam.ts src/store/beamState.ts tests/tractorBeam.test.ts
git commit -m "feat(beam): pure cone, selection, pull and reel maths; shared beam state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Beam input on keyboard, gamepad and touch

**Files:**
- Modify: `src/store/spaceStore.ts` (`FlightInput`, `flight.input`)
- Modify: `src/hooks/useKeyboardInput.ts`
- Modify: `src/utils/gamepad.ts`, `src/hooks/useGamepadInput.ts`
- Modify: `src/components/layout/TouchControls.tsx`
- Modify: `src/components/layout/HUDOverlay.tsx`, `src/App.tsx:232` (controls hints)
- Modify: `src/components/canvas/Spaceship.tsx` (pre-flight `touched`)
- Test: `tests/keyboardGuard.test.ts`, `tests/gamepad.test.ts`

**Interfaces:**
- Produces: `FlightInput.beam: boolean`, driven by F (keyboard), LB / button 4 (gamepad) and BEAM (touch).

- [ ] **Step 1: Update the tests first**

`tests/keyboardGuard.test.ts`, in `describe("resetFlightInput")`: add `beam: true` to the input literal and `beam: false` to the expected literal.

`tests/gamepad.test.ts`: add

```ts
  it("maps LB to the tractor beam", () => {
    const buttons = Array.from({ length: 16 }, (_, i) => ({ pressed: i === 4, value: i === 4 ? 1 : 0 }));
    expect(readPadFlight({ axes: [0, 0, 0, 0], buttons }).beam).toBe(true);
  });
```

The existing `toEqual(PAD_NEUTRAL)` assertions keep working once `PAD_NEUTRAL` includes `beam: false`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/keyboardGuard.test.ts tests/gamepad.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/store/spaceStore.ts`: add to `FlightInput` after `scan`:

```ts
  /** Tractor beam held (F, gamepad LB, touch BEAM). */
  beam: boolean;
```

and `beam: false` to `flight.input`'s initial literal.

`src/hooks/useKeyboardInput.ts`: add `"beam"` to `BoolKey`, `KeyF: "beam",` to `KEYMAP`, and `input.beam = false;` to `resetFlightInput`.

`src/utils/gamepad.ts`: add `"beam"` to the `PadFlight` pick, `beam: false` to `PAD_NEUTRAL`, `LB = 4` to the button constants line, and `beam: pressed(p, LB),` in `readPadFlight`.

`src/hooks/useGamepadInput.ts`: change `LINKED_MESSAGE` to `"CONTROLLER LINKED // L-STICK FLY · R-STICK PITCH · RB WARP · LB BEAM · A SCAN · Y PHOTO · D-PAD JUMP"`.

`src/components/layout/TouchControls.tsx`:
- Add `const beamPointerRef = useRef<number | null>(null);`.
- In both reset effects (orbit lock and unmount) add `flight.input.beam = false;` and `beamPointerRef.current = null;`.
- Add a BEAM button after the dive button, following the BOOST button's pointer pattern exactly:

```tsx
      {/* Tractor beam: hold to pull crystals and pebbles, or reel toward a shard */}
      <button
        className="fixed bottom-32 right-28 z-40 pointer-events-auto touch-none w-14 h-14 rounded-full border border-primary/40 bg-black/50 font-mono text-[10px] text-primary active:bg-primary/20"
        data-testid="touch-beam"
        onPointerDown={(e) => {
          if (beamPointerRef.current !== null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          beamPointerRef.current = e.pointerId;
          flight.input.beam = true;
        }}
        onPointerUp={(e) => {
          if (e.pointerId !== beamPointerRef.current) return;
          beamPointerRef.current = null;
          flight.input.beam = false;
        }}
        onPointerCancel={(e) => {
          if (e.pointerId !== beamPointerRef.current) return;
          beamPointerRef.current = null;
          flight.input.beam = false;
        }}
      >
        BEAM
      </button>
```

`src/components/layout/HUDOverlay.tsx`: in the controls card, after the SCAN entry (inside the `!isCoarse` fragment), add:

```tsx
            <div className="w-[1px] bg-white/5" />
            <div className="flex flex-col">
              <span className="text-white/45">TRACTOR_BEAM</span>
              <span className="text-white">{pad ? "HOLD LB" : "HOLD F"}</span>
            </div>
```

`src/App.tsx:232`: change the desktop hint to `"W/A/S/D FLY · SPACE/C PITCH · SHIFT WARP · F BEAM"` and the pad hint to `"L-STICK FLY · R-STICK PITCH · RB WARP · LB BEAM"`.

`src/components/canvas/Spaceship.tsx`: in the pre-flight `touched` expression, add `|| input.beam`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/keyboardGuard.test.ts tests/gamepad.test.ts && npx tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/spaceStore.ts src/hooks/useKeyboardInput.ts src/utils/gamepad.ts src/hooks/useGamepadInput.ts src/components/layout/TouchControls.tsx src/components/layout/HUDOverlay.tsx src/App.tsx src/components/canvas/Spaceship.tsx tests/keyboardGuard.test.ts tests/gamepad.test.ts
git commit -m "feat(beam): F, LB and a touch BEAM button drive the tractor beam

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The beam pulls crystals, with a cone, tethers and hum

**Files:**
- Modify: `src/components/canvas/Spaceship.tsx` (write `beamState`, reel)
- Modify: `src/components/canvas/enginePlume.ts` (`uColor`)
- Create: `src/components/canvas/TractorBeam.tsx`
- Create: `src/utils/mining.ts` (two-function stub; Task 17 completes it)
- Modify: `src/components/canvas/GlobalCanvas.tsx` (mount)
- Modify: `src/components/canvas/FuelCrystals.tsx` (apply pull)
- Modify: `src/audio/soundManager.ts` (`beamOn`, `oreTick`, hum)
- Modify: `src/debug/bridge.ts` (`beam`)
- Test: `tests/enginePlume.test.ts`

**Interfaces:**
- Consumes: `beamState` and the Task 13 maths; `crystalSlots`; `flight.input.beam`; `gravity` total velocity (`_total`) from Task 12.
- Produces: `makePlumeMaterial(seed, color?)` with a `uColor` uniform; `<TractorBeam />`; `fitzDebug.beam = beamState`; `tetherCount(): number` and `tetherPos(t: number, out: Vec3): Vec3` stubs in `src/utils/mining.ts`.

- [ ] **Step 1: Test the plume colour uniform**

Create `tests/enginePlume.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { makePlumeMaterial } from "../src/components/canvas/enginePlume";

describe("makePlumeMaterial", () => {
  it("defaults to the engine's cyan and accepts a tint without changing the shader source", () => {
    const engine = makePlumeMaterial(0);
    const beam = makePlumeMaterial(1, new THREE.Color("#3ff2d0"));
    expect((engine.uniforms.uColor.value as THREE.Color).getHexString()).toBe("00d9ff");
    expect((beam.uniforms.uColor.value as THREE.Color).getHexString()).toBe("3ff2d0");
    // Same source => three.js reuses one program for both (no new program).
    expect(beam.fragmentShader).toBe(engine.fragmentShader);
    expect(beam.vertexShader).toBe(engine.vertexShader);
  });
});
```

Run: `npx vitest run tests/enginePlume.test.ts` → FAIL.

- [ ] **Step 2: Add `uColor`**

In `src/components/canvas/enginePlume.ts`:
- In `FRAG`, add `uniform vec3 uColor;` with the other uniforms and replace `vec3 cool = vec3(0.0, 0.85, 1.0);` with `vec3 cool = uColor;`.
- Change the factory:

```ts
/** Default "cool" end of the plume: the engine's cyan (0, 0.85, 1). */
const ENGINE_COOL = new THREE.Color(0, 0.85, 1);

export function makePlumeMaterial(seed: number, color: THREE.Color = ENGINE_COOL): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uPower: { value: 0.3 },
      uSeed: { value: seed },
      uColor: { value: color.clone() },
    },
  });
}
```

`new THREE.Color(0, 0.85, 1).getHexString()` is `"00d9ff"`. Run the test → PASS.

- [ ] **Step 3: The mining stub**

Create `src/utils/mining.ts` (Task 17 replaces it and keeps these signatures):

```ts
import type { Vec3 } from "./reactions";

/** Pebbles currently tethered to the beam (completed in Task 17). */
export function tetherCount(): number { return 0; }
/** World position of tether `t`, written into `out`. */
export function tetherPos(_t: number, out: Vec3): Vec3 { return out; }
```

- [ ] **Step 4: Spaceship writes the beam state and reels**

Import `beamState` from `../../store/beamState` and `reelStep` from `../../utils/tractorBeam`.

- In the photo-mode branch and the frame-loop orbit-lock branch, add `beamState.active = false; beamState.reel.active = false;`.
- After `const nose = noseDirection(...)` in free flight:

```ts
    // Tractor beam (spec §6): off in warp; the nose is its origin and axis.
    beamState.active = input.beam && !warpActive;
    beamState.ox = pos.current.x + nose.x * 1.3; beamState.oy = pos.current.y + nose.y * 1.3; beamState.oz = pos.current.z + nose.z * 1.3;
    beamState.dx = nose.x; beamState.dy = nose.y; beamState.dz = nose.z;
    if (!beamState.active) beamState.oreStreak = 0;
```

- After the thrust / brake block and before `vel.current.multiplyScalar(Math.pow(SPACE_DRAG, ...))`, add the reel:

```ts
    // Reeling toward a shard counts as thrust for station-keeping.
    const reeling = beamState.active && beamState.reel.active;
    if (reeling) reelStep(vel.current, beamState.reel.x, beamState.reel.y, beamState.reel.z, dt, MAX_SPEED);
```

  and change Task 12's idle line to `idleFor.current = thrustInput > 0 || reeling ? 0 : idleFor.current + dt;`.
- After `_total` is computed: `beamState.vel.x = _total.x; beamState.vel.y = _total.y; beamState.vel.z = _total.z;`.
- In the dev `useEffect`, register `fitzDebug.beam = beamState;` (cleanup `fitzDebug.beam = null;`). In `src/debug/bridge.ts` add `beam: typeof beamState | null;` to `FitzDebug` (with `import type { beamState } from "../store/beamState";` — use `typeof import("../store/beamState").beamState` if a type-only import of a value is rejected) and `beam: null` to the object.

- [ ] **Step 5: Create `TractorBeam.tsx`**

```tsx
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { beamState } from "../../store/beamState";
import { crystalSlots, flight, useSpaceStore } from "../../store/spaceStore";
import { SHARDS } from "../../data/shards";
import { BEAM_MAX_TARGETS, BEAM_RANGE, BEAM_HALF_ANGLE, clearSelection, consider, inCone } from "../../utils/tractorBeam";
import { tetherCount, tetherPos } from "../../utils/mining";
import { makePlumeGeometry, makePlumeMaterial } from "./enginePlume";
import { ambientTime } from "../../utils/ambientTime";
import { soundManager } from "../../audio/soundManager";

const BEAM_TINT = new THREE.Color("#3ff2d0");
const DOWN = new THREE.Vector3(0, -1, 0);
const _dir = new THREE.Vector3();
const _tether = { x: 0, y: 0, z: 0 };

/**
 * Tractor beam (spec §6): picks this frame's crystal and shard targets
 * (nearest first, sharing the 3-target budget with tethered pebbles), sets the
 * shard reel, and draws a soft cone plus one tether per target. The cone
 * reuses the engine plume's shader with a teal uColor, and the tethers reuse
 * the streak line material's parameters, so neither adds a shader program.
 */
export default function TractorBeam() {
  const coneRef = useRef<THREE.Mesh>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const wasActive = useRef(false);

  // Unit tube along +Y: radius 1 at the top (the plume's bright end), 0.18 at
  // the tip. Shifted so the top sits at the origin and the body spans y ∈ [-1, 0].
  const coneGeometry = useMemo(() => {
    const g = makePlumeGeometry(1);
    g.translate(0, -0.5, 0);
    return g;
  }, []);
  const coneMaterial = useMemo(() => makePlumeMaterial(4.2, BEAM_TINT), []);
  const lineGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BEAM_MAX_TARGETS * 2 * 3), 3));
    return g;
  }, []);
  useEffect(() => () => { coneGeometry.dispose(); coneMaterial.dispose(); lineGeometry.dispose(); },
    [coneGeometry, coneMaterial, lineGeometry]);

  useFrame((state) => {
    const active = beamState.active;
    if (active && !wasActive.current) soundManager.beamOn();
    wasActive.current = active;
    const sel = beamState.sel;
    clearSelection(sel);
    beamState.reel.active = false;
    const cone = coneRef.current, lines = linesRef.current;
    if (!active) {
      if (cone) cone.visible = false;
      if (lines) lines.visible = false;
      return;
    }

    // Tethered pebbles hold their slots; crystals and shards share the rest.
    const budget = BEAM_MAX_TARGETS - tetherCount();
    const { ox, oy, oz, dx, dy, dz } = beamState;
    for (let i = 0; i < crystalSlots.length; i++) {
      const s = crystalSlots[i];
      if (!s.active) continue;
      const d = inCone(ox, oy, oz, dx, dy, dz, s.x, s.y, s.z, BEAM_RANGE);
      if (d >= 0) consider(sel, budget, "crystal", i, -1, d, s.x, s.y, s.z);
    }
    const collected = useSpaceStore.getState().shardsCollected;
    for (let i = 0; i < SHARDS.length; i++) {
      if (collected.includes(i)) continue;
      const [x, y, z] = SHARDS[i].pos;
      const d = inCone(ox, oy, oz, dx, dy, dz, x, y, z, BEAM_RANGE);
      if (d >= 0) consider(sel, budget, "shard", i, -1, d, x, y, z);
    }
    // Shards are anchored: reel the ship toward the nearest selected one.
    for (let k = 0; k < sel.count; k++) {
      if (sel.kind[k] !== "shard") continue;
      const rx = sel.x[k] - flight.x, ry = sel.y[k] - flight.y, rz = sel.z[k] - flight.z;
      const rl = Math.hypot(rx, ry, rz) || 1;
      beamState.reel.active = true;
      beamState.reel.x = rx / rl; beamState.reel.y = ry / rl; beamState.reel.z = rz / rl;
      break;
    }

    // Cone: from the nose along the beam. The tube's body spans -Y, so rotate
    // -Y onto the beam direction.
    if (cone) {
      cone.visible = true;
      cone.position.set(ox, oy, oz);
      cone.quaternion.setFromUnitVectors(DOWN, _dir.set(dx, dy, dz));
      const r = Math.tan(BEAM_HALF_ANGLE) * BEAM_RANGE;
      cone.scale.set(r, BEAM_RANGE, r);
      coneMaterial.uniforms.uTime.value = ambientTime(state.clock.getElapsedTime());
      coneMaterial.uniforms.uPower.value = 0.35;
    }

    // Tethers: nose to each crystal/shard target, then to each tethered pebble.
    if (lines) {
      const arr = lines.geometry.attributes.position.array as Float32Array;
      let n = 0;
      const put = (x: number, y: number, z: number) => {
        const j = n * 6;
        arr[j] = ox; arr[j + 1] = oy; arr[j + 2] = oz; arr[j + 3] = x; arr[j + 4] = y; arr[j + 5] = z;
        n++;
      };
      for (let k = 0; k < sel.count && n < BEAM_MAX_TARGETS; k++) put(sel.x[k], sel.y[k], sel.z[k]);
      for (let t = 0; t < tetherCount() && n < BEAM_MAX_TARGETS; t++) { tetherPos(t, _tether); put(_tether.x, _tether.y, _tether.z); }
      lines.geometry.setDrawRange(0, n * 2);
      lines.geometry.attributes.position.needsUpdate = true;
      lines.visible = n > 0;
    }
  });

  return (
    <>
      <mesh ref={coneRef} name="TractorBeamCone" geometry={coneGeometry} material={coneMaterial} visible={false} frustumCulled={false} />
      <lineSegments ref={linesRef} name="TractorBeamTethers" geometry={lineGeometry} visible={false} frustumCulled={false}>
        {/* Same parameters as the ship's streaks (Spaceship.tsx): shares their program. */}
        <lineBasicMaterial color="#3ff2d0" transparent={true} opacity={0.5}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
    </>
  );
}
```

`put` is an arrow function created once per frame while the beam is held; that single closure is acceptable, but if lint or review objects, hoist it to a module-level function taking `arr`, `n`, origin and point.

The cone's wide end (radius `r`) sits at the nose and the narrow tip at the beam's range, because the plume tube is wide at its bright top. That reads as a soft searchlight. If it looks wrong in Step 9, swap the end radii by building the geometry with `new THREE.CylinderGeometry(0.18, 1, 1, 20, 12, true)` translated the same way; this is still the same material, so still no new program.

- [ ] **Step 6: Mount it**

In `src/components/canvas/GlobalCanvas.tsx`, import `TractorBeam` and render `<TractorBeam />` next to `<Spaceship />`, inside the same Suspense boundary and group.

- [ ] **Step 7: FuelCrystals applies the pull**

In `src/components/canvas/FuelCrystals.tsx`, import `beamState` and `{ pullStep, CRYSTAL_PULL_SPEED }`. At the start of the frame loop (after `dt` is computed), add:

```ts
    // Tractor beam: selected crystals drift to the ship; the pickup check
    // below collects them on arrival. Released ones stay where they are.
    const sel = beamState.sel;
    for (let k = 0; k < sel.count; k++) {
      if (sel.kind[k] !== "crystal") continue;
      const s = slots[sel.index[k]];
      if (s?.active) pullStep(s, flight, beamState.vel, CRYSTAL_PULL_SPEED, dt);
    }
```

(`CrystalSlot` has `x`, `y`, `z`, so it satisfies `Vec3`.)

- [ ] **Step 8: Sounds**

In `src/audio/soundManager.ts`:
- Import `beamState` from `../store/beamState`.
- Add fields `private beamGain: GainNode | null = null;` and `private beamOsc: OscillatorNode | null = null;`.
- In `init()`, after the warp layer:

```ts
      // Tractor-beam hum: a soft sine, silent until the beam is held.
      this.beamGain = this.ctx.createGain();
      this.beamGain.gain.value = 0;
      this.beamOsc = this.ctx.createOscillator();
      this.beamOsc.type = "sine";
      this.beamOsc.frequency.value = 330;
      this.beamOsc.connect(this.beamGain).connect(this.master);
      this.beamOsc.start();
```

- In `startLoop`'s tick, inside the `if (this.ctx && ...)` block, after the warp line:

```ts
        if (this.beamGain && this.beamOsc) {
          const humming = flying && beamState.active;
          this.beamGain.gain.setTargetAtTime(humming ? 0.025 : 0, t, humming ? 0.05 : 0.15);
          // Pitch climbs a little with each pebble absorbed, resets on release.
          this.beamOsc.frequency.setTargetAtTime(330 * (1 + 0.04 * Math.min(beamState.oreStreak, 12)), t, 0.1);
        }
```

- Add cues after `whoosh`:

```ts
  /** Tractor beam engaged */
  beamOn() {
    this.blip("sine", 520, 0.12, 0.05, 780);
  }
  /** A pebble absorbed as ore */
  oreTick() {
    this.blip("triangle", 1500, 0.035, 0.03);
  }
```

- [ ] **Step 9: Verify**

Run: `npm test && npx tsc -b && npm run lint`
Expected: green.

Manual: `npm run dev` in its own terminal, press W once, then in the console run:
`__fitz.teleport(150, 60, 150); __fitz.setAttitude(0, 0); Object.assign(__fitz.crystals[0], { x: 150, y: 60, z: 170, active: true })`
and hold F. A teal cone and tether appear, the crystal flies in and is collected (fuel rises if not full), and the hum plays. Stop the dev server with Ctrl-C.

- [ ] **Step 10: Commit**

```bash
git add src/components/canvas/Spaceship.tsx src/components/canvas/enginePlume.ts src/components/canvas/TractorBeam.tsx src/components/canvas/GlobalCanvas.tsx src/components/canvas/FuelCrystals.tsx src/audio/soundManager.ts src/debug/bridge.ts src/utils/mining.ts tests/enginePlume.test.ts
git commit -m "feat(beam): tractor beam pulls fuel crystals; teal cone, tethers and hum

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The beam reels the ship toward data shards

**Files:**
- Modify: `src/components/canvas/DataShards.tsx` (comment only; collection unchanged)
- Test: `tests/tractorBeam.test.ts` (append a reel-to-collection simulation)

**Interfaces:**
- Consumes: `beamState.reel` (set by TractorBeam in Task 15) and `reelStep` (applied in Spaceship in Task 15).

Shards are anchored: TractorBeam already selects them and sets `beamState.reel`, and Spaceship already reels. This task proves the loop reaches the shard, and documents that shards never move.

- [ ] **Step 1: Write the test**

Append to `tests/tractorBeam.test.ts`:

```ts
describe("reeling to a shard", () => {
  it("brings a parked ship within pickup range of a shard 25u ahead", () => {
    // Spaceship's loop: reel (counts as thrust), drag, integrate.
    const v = { x: 0, y: 0, z: 0 }, p = { x: 0, y: 0, z: 0 }, shard = { x: 0, y: 0, z: 25 };
    let t = 0;
    while (Math.hypot(shard.x - p.x, shard.y - p.y, shard.z - p.z) >= 3 && t < 10) {
      const dt = 1 / 60;
      const dx = shard.x - p.x, dy = shard.y - p.y, dz = shard.z - p.z, d = Math.hypot(dx, dy, dz);
      reelStep(v, dx / d, dy / d, dz / d, dt, 10.8);
      const k = Math.pow(0.982, dt * 60); v.x *= k; v.y *= k; v.z *= k;
      p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
      t += dt;
    }
    expect(t).toBeLessThan(5);
  });
});
```

Run: `npx vitest run tests/tractorBeam.test.ts`
Expected: PASS. (Reel 15 u/s² against drag ~1.09/s settles near 13.8 u/s, capped at 10.8; 22u takes about 2.5 s.) If it fails, report the time reached rather than retuning.

- [ ] **Step 2: Document anchoring in DataShards**

In `src/components/canvas/DataShards.tsx`, add above the pickup check:

```ts
      // Shards are anchored: the tractor beam reels the SHIP toward them
      // (TractorBeam.tsx sets beamState.reel; Spaceship applies it), so their
      // positions never move and the pickup below is unchanged.
```

- [ ] **Step 3: Manual check**

`npm run dev`, press W once, then `__fitz.teleport(53, -18, 28); __fitz.setAttitude(0, 0)` (shard 1 sits at (53, -18, 50), 22u ahead along +z). Hold F: the ship is drawn forward and the shard is collected with its radio line. Stop the dev server with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add src/components/canvas/DataShards.tsx tests/tractorBeam.test.ts
git commit -m "feat(beam): reel the ship toward anchored data shards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Mining belt pebbles into ore

**Files:**
- Replace: `src/utils/mining.ts` (keep `tetherCount`, `tetherPos`)
- Modify: `src/components/canvas/AsteroidBelt.tsx`
- Modify: `src/components/layout/HUDOverlay.tsx` (ORE readout)
- Modify: `src/debug/bridge.ts` (`mining`)
- Test: `tests/mining.test.ts`

**Interfaces:**
- Consumes: `beamState`, `inCone`, `pullStep`, `PEBBLE_RANGE`, `PEBBLE_PULL_SPEED`, `BEAM_MAX_TARGETS`; `FUEL_PER_CRYSTAL`, `FUEL_MAX`.
- Produces (`src/utils/mining.ts`):
  - `ORE_PER_CRYSTAL = 16`, `ORE_FUEL = FUEL_PER_CRYSTAL / ORE_PER_CRYSTAL`, `PEBBLE_REGROW_S = 90`, `PEBBLE_REGROW_EASE_S = 2`, `PEBBLE_GRAB_INTERVAL = 0.65`, `ABSORB_RADIUS = 1.5`, `TETHER_DROP_RANGE = 20`
  - `registerRing(ring: number, total: number): void`
  - `pebbleWorld(ring: number): Float32Array` (xyz per pebble, written by AsteroidBelt each frame)
  - `isAbsorbed(ring: number, i: number, now: number): boolean`, `regrowScale(ring: number, i: number, now: number): number`
  - `isTethered(ring: number, i: number): boolean`
  - `stepMining(now: number, dt: number, ship: Vec3): number`, which grabs, pulls and absorbs, returning the number absorbed this frame
  - `tetherCount(): number`, `tetherPos(t: number, out: Vec3): Vec3`
  - `addOre(fuel: number, ore: number, absorbed: number): { fuel: number; ore: number }`, pure
  - `resetMining(): void` (tests), `miningState` (debug bridge)

- [ ] **Step 1: Write the failing tests**

Create `tests/mining.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerRing, pebbleWorld, stepMining, tetherCount, isAbsorbed, regrowScale, addOre, resetMining,
  ORE_PER_CRYSTAL, ORE_FUEL, PEBBLE_REGROW_S, PEBBLE_GRAB_INTERVAL,
} from "../src/utils/mining";
import { beamState } from "../src/store/beamState";
import { FUEL_MAX, FUEL_PER_CRYSTAL } from "../src/utils/fuel";

/** One ring of `n` pebbles laid out along +z ahead of a ship at the origin looking +z. */
function lineOfPebbles(n: number, start = 4, gap = 0.5) {
  registerRing(0, n);
  const w = pebbleWorld(0);
  for (let i = 0; i < n; i++) { w[i * 3] = 0; w[i * 3 + 1] = 0; w[i * 3 + 2] = start + i * gap; }
  return w;
}
const ship = { x: 0, y: 0, z: 0 };

beforeEach(() => {
  resetMining();
  Object.assign(beamState, { active: true, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1, ore: 0 });
  beamState.vel.x = 0; beamState.vel.y = 0; beamState.vel.z = 0;
});

describe("addOre", () => {
  it("adds 1/16 of a crystal per pebble and rolls the counter", () => {
    expect(ORE_FUEL).toBeCloseTo(FUEL_PER_CRYSTAL / 16);
    const r = addOre(50, 15, 2);
    expect(r.fuel).toBeCloseTo(50 + 2 * ORE_FUEL);
    expect(r.ore).toBe(1);
  });
  it("clamps at a full tank", () => {
    expect(addOre(FUEL_MAX - 0.5, 0, 3).fuel).toBe(FUEL_MAX);
  });
});

describe("stepMining", () => {
  it("tethers at most 3 pebbles and pulls them in until absorbed", () => {
    lineOfPebbles(10);
    let absorbed = 0;
    for (let t = 0; t < 20; t += 1 / 60) {
      absorbed += stepMining(t, 1 / 60, ship);
      expect(tetherCount()).toBeLessThanOrEqual(3);
    }
    expect(absorbed).toBe(10);
  });
  it("hides an absorbed pebble, then regrows it after 90s", () => {
    lineOfPebbles(1);
    let t = 0;
    while (!isAbsorbed(0, 0, t) && t < 10) { stepMining(t, 1 / 60, ship); t += 1 / 60; }
    expect(isAbsorbed(0, 0, t)).toBe(true);
    expect(regrowScale(0, 0, t)).toBe(0);
    expect(isAbsorbed(0, 0, t + PEBBLE_REGROW_S + 0.01)).toBe(false);
    expect(regrowScale(0, 0, t + PEBBLE_REGROW_S + 1)).toBeGreaterThan(0);
    expect(regrowScale(0, 0, t + PEBBLE_REGROW_S + 3)).toBe(1);
  });
  it("needs at least 40s of beaming to fill an empty tank, even with endless pebbles beside the nose", () => {
    lineOfPebbles(200, 1.6, 0.01); // every pebble already almost at the nose
    let ore = 0, t = 0;
    const needed = Math.ceil(FUEL_MAX / ORE_FUEL); // 64
    while (ore < needed && t < 120) { ore += stepMining(t, 1 / 60, ship); t += 1 / 60; }
    expect(ore).toBeGreaterThanOrEqual(needed);
    expect(t).toBeGreaterThanOrEqual(40);
    expect(PEBBLE_GRAB_INTERVAL * needed).toBeGreaterThanOrEqual(40);
  });
  it("drops every tether when the beam switches off", () => {
    lineOfPebbles(5, 10);
    stepMining(0, 1 / 60, ship);
    expect(tetherCount()).toBe(1);
    beamState.active = false;
    stepMining(1 / 60, 1 / 60, ship);
    expect(tetherCount()).toBe(0);
  });
  it("ignores pebbles outside the cone", () => {
    registerRing(0, 1);
    const w = pebbleWorld(0);
    w[0] = 10; w[1] = 0; w[2] = 2; // ~79° off the nose
    stepMining(0, 1 / 60, ship);
    expect(tetherCount()).toBe(0);
  });
  it("makes 16 pebbles one crystal", () => {
    expect(ORE_PER_CRYSTAL).toBe(16);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/mining.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement `src/utils/mining.ts`**

```ts
import type { Vec3 } from "./reactions";
import { beamState } from "../store/beamState";
import { BEAM_MAX_TARGETS, PEBBLE_RANGE, PEBBLE_PULL_SPEED, inCone, pullStep } from "./tractorBeam";
import { FUEL_MAX, FUEL_PER_CRYSTAL } from "./fuel";

/**
 * Mining belt pebbles with the tractor beam (spec §6.3). Belt rocks are
 * pebbles (0.1-0.5u), so each is worth a sliver of fuel: 16 make one crystal.
 * A grab gate caps acquisition at one pebble per PEBBLE_GRAB_INTERVAL, so an
 * empty tank always takes at least 40s of mining (64 × 0.65s = 41.6s): a
 * deliberate choice between mining and flying to crystals, never a free
 * refill mid-race.
 *
 * AsteroidBelt writes each ring's pebble world positions here every frame and
 * reads back which pebbles are tethered (pulled, not orbiting), absorbed
 * (hidden) or regrowing. Module state, like `flight`: no React.
 */
export const ORE_PER_CRYSTAL = 16;
export const ORE_FUEL = FUEL_PER_CRYSTAL / ORE_PER_CRYSTAL;
export const PEBBLE_REGROW_S = 90;
export const PEBBLE_REGROW_EASE_S = 2;
export const PEBBLE_GRAB_INTERVAL = 0.65;
export const ABSORB_RADIUS = 1.5;
/** A tethered pebble that falls this far behind is let go. */
export const TETHER_DROP_RANGE = 20;

interface Ring { world: Float32Array; absorbedAt: Float64Array }
interface Tether { ring: number; index: number; x: number; y: number; z: number }

const rings: Ring[] = [];
const tethers: Tether[] = Array.from({ length: BEAM_MAX_TARGETS }, () => ({ ring: -1, index: -1, x: 0, y: 0, z: 0 }));
let tetherN = 0;
let lastGrabAt = -Infinity;

export const miningState = { rings, tethers, get tetherCount() { return tetherN; } };

export function registerRing(ring: number, total: number): void {
  if (rings[ring]?.world.length === total * 3) return;
  rings[ring] = { world: new Float32Array(total * 3), absorbedAt: new Float64Array(total).fill(-Infinity) };
}

export function pebbleWorld(ring: number): Float32Array { return rings[ring].world; }

export function isAbsorbed(ring: number, i: number, now: number): boolean {
  return now - rings[ring].absorbedAt[i] < PEBBLE_REGROW_S;
}

/** 0 while absorbed, easing back to 1 over PEBBLE_REGROW_EASE_S once regrown; 1 if never mined. */
export function regrowScale(ring: number, i: number, now: number): number {
  const since = now - rings[ring].absorbedAt[i] - PEBBLE_REGROW_S;
  if (since < 0) return 0;
  const u = Math.min(1, since / PEBBLE_REGROW_EASE_S);
  return u * u * (3 - 2 * u);
}

export function isTethered(ring: number, i: number): boolean {
  for (let t = 0; t < tetherN; t++) if (tethers[t].ring === ring && tethers[t].index === i) return true;
  return false;
}

export function tetherCount(): number { return tetherN; }

export function tetherPos(t: number, out: Vec3): Vec3 {
  out.x = tethers[t].x; out.y = tethers[t].y; out.z = tethers[t].z;
  return out;
}

function dropTether(t: number): void {
  tetherN--;
  const last = tethers[tetherN], cur = tethers[t];
  cur.ring = last.ring; cur.index = last.index; cur.x = last.x; cur.y = last.y; cur.z = last.z;
}

/** Fuel and ore counter after `absorbed` pebbles. Pure. */
export function addOre(fuel: number, ore: number, absorbed: number): { fuel: number; ore: number } {
  return { fuel: Math.min(FUEL_MAX, fuel + absorbed * ORE_FUEL), ore: (ore + absorbed) % ORE_PER_CRYSTAL };
}

/**
 * One frame: drops tethers when the beam is off or they fall behind, grabs the
 * nearest in-cone pebble when a slot is free and the grab gate allows, pulls
 * every tether toward the ship and absorbs those that arrive. Returns how many
 * were absorbed this frame. `now` is game time (s).
 */
export function stepMining(now: number, dt: number, ship: Vec3): number {
  if (!beamState.active) { tetherN = 0; return 0; }
  const { ox, oy, oz, dx, dy, dz } = beamState;

  if (tetherN < BEAM_MAX_TARGETS && now - lastGrabAt >= PEBBLE_GRAB_INTERVAL) {
    let bestR = -1, bestI = -1, bestD = Infinity;
    for (let r = 0; r < rings.length; r++) {
      const ring = rings[r];
      if (!ring) continue;
      const w = ring.world, n = w.length / 3;
      for (let i = 0; i < n; i++) {
        if (now - ring.absorbedAt[i] < PEBBLE_REGROW_S + PEBBLE_REGROW_EASE_S) continue;
        const d = inCone(ox, oy, oz, dx, dy, dz, w[i * 3], w[i * 3 + 1], w[i * 3 + 2], PEBBLE_RANGE);
        if (d >= 0 && d < bestD && !isTethered(r, i)) { bestD = d; bestR = r; bestI = i; }
      }
    }
    if (bestI >= 0) {
      const t = tethers[tetherN++], w = rings[bestR].world;
      t.ring = bestR; t.index = bestI; t.x = w[bestI * 3]; t.y = w[bestI * 3 + 1]; t.z = w[bestI * 3 + 2];
      lastGrabAt = now;
    }
  }

  let absorbed = 0;
  for (let t = tetherN - 1; t >= 0; t--) {
    const left = pullStep(tethers[t], ship, beamState.vel, PEBBLE_PULL_SPEED, dt);
    if (left < ABSORB_RADIUS) {
      rings[tethers[t].ring].absorbedAt[tethers[t].index] = now;
      absorbed++;
      dropTether(t);
    } else if (left > TETHER_DROP_RANGE) {
      dropTether(t);
    }
  }
  return absorbed;
}

export function resetMining(): void {
  rings.length = 0;
  tetherN = 0;
  lastGrabAt = -Infinity;
}
```

Run: `npx vitest run tests/mining.test.ts tests/tractorBeam.test.ts`
Expected: PASS.

- [ ] **Step 4: AsteroidBelt writes positions, applies tethers and regrowth, absorbs**

In `src/components/canvas/AsteroidBelt.tsx`:

1. Imports:

```ts
import { registerRing, pebbleWorld, isTethered, regrowScale, stepMining, miningState, tetherPos, addOre } from "../../utils/mining";
import { beamState } from "../../store/beamState";
import { gameTime } from "../../utils/ambientTime";
import { soundManager } from "../../audio/soundManager";
import { ChatterScheduler } from "../../utils/chatterScheduler";
import { chatterPools } from "../../data/chatterLines";
import { fitzDebug } from "../../debug/bridge";
```

(`ambientTime` is already imported from the same module; merge the import.)

2. `BeltRingProps` gains `ring: number` (0 for `BeltMain`, 1 for `BeltHalo`); pass `ring={0}` and `ring={1}` in `AsteroidBelt`. In `BeltRing`, call `useMemo(() => registerRing(ring, total), [ring, total]);`.

3. Module scratch next to `shipLocal`:

```ts
const _tp = { x: 0, y: 0, z: 0 };
/** Module-level so it survives the classic-résumé remount (like FuelCrystals' ventedAnnounced). */
let firstOreAnnounced = false;
const oreLines = new ChatterScheduler(chatterPools);
```

4. In the frame loop, add `const now = gameTime(state.clock.getElapsedTime());`, `const world = pebbleWorld(ring);` and `const c = Math.cos(tilt), s = Math.sin(tilt);`. Inside the per-rock loop, replace the `stepRock` / position / scale / matrix lines with:

```ts
      const j = i * 3;
      const tethered = isTethered(ring, i);
      // A tethered pebble is pulled by mining.ts in world space; it stops
      // following its orbit and the belt's push until absorbed or released.
      if (react && !tethered) stepRock(disp, i, x, y, z, ship, kPush, kReturn);
      const lx = x + disp[j], ly = y + disp[j + 1], lz = z + disp[j + 2];
      // Ring-local -> world (the group rotates by `tilt` about X).
      world[j] = lx; world[j + 1] = c * ly - s * lz; world[j + 2] = s * ly + c * lz;
      dummy.position.set(lx, ly, lz);
      dummy.rotation.set(r.phase + t * r.spinX, t * r.spinY, t * r.spinZ);
      dummy.scale.setScalar(r.scale * regrowScale(ring, i, now));
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
```

   `regrowScale` is 1 for a pebble never mined (`absorbedAt` is -Infinity), so untouched rocks are unchanged. The `const j = i * 3;` line replaces the existing one.

5. After the loop, draw tethered pebbles at their pulled positions, converting the tether's world point back to ring-local with the inverse rotation (the `toRingLocal` maths):

```ts
    for (let k = 0; k < miningState.tetherCount; k++) {
      const tt = miningState.tethers[k];
      if (tt.ring !== ring) continue;
      tetherPos(k, _tp);
      const rk = rocks[tt.index];
      dummy.position.set(_tp.x, c * _tp.y + s * _tp.z, -s * _tp.y + c * _tp.z);
      dummy.rotation.set(rk.phase + t * rk.spinX, t * rk.spinY, t * rk.spinZ);
      dummy.scale.setScalar(rk.scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(tt.index, dummy.matrix);
    }
```

6. Then run mining once per frame, from the main ring only:

```ts
    if (ring === 0) {
      const absorbed = stepMining(now, dt, flight);
      if (absorbed > 0) {
        const next = addOre(flight.fuel, beamState.ore, absorbed);
        flight.fuel = next.fuel;
        beamState.ore = next.ore;
        beamState.oreAt = performance.now();
        beamState.oreStreak += absorbed;
        const store = useSpaceStore.getState();
        store.setFuelEmpty(flight.fuel <= 0);
        soundManager.oreTick();
        // Once per session, the moment the visitor acted: no busy-radio check.
        if (!firstOreAnnounced) {
          firstOreAnnounced = true;
          store.sendBroadcast(oreLines.pick("ore"), { silent: true });
        }
      }
    }
```

7. Dev bridge: in the outer `AsteroidBelt` component add

```ts
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.mining = miningState;
    return () => { fitzDebug.mining = null; };
  }, []);
```

   and in `src/debug/bridge.ts` add `mining: typeof import("../utils/mining").miningState | null;` to `FitzDebug` and `mining: null` to the object.

8. Reduced motion: the belt's existing `react` flag already disables the push and orbit motion is on `ambientTime`; mining still runs (player-driven).

- [ ] **Step 5: ORE readout in the HUD**

In `src/components/layout/HUDOverlay.tsx`:
- `const oreRef = useRef<HTMLDivElement>(null);`; import `beamState` from `../../store/beamState` and `ORE_PER_CRYSTAL` from `../../utils/mining`.
- Under the fuel bar's wrapper `<div>`, add `<div ref={oreRef} data-testid="hud-ore" className="text-[#3ff2d0]" style={{ display: "none" }} />`.
- In the telemetry tick:

```ts
      if (oreRef.current) {
        const show = performance.now() - beamState.oreAt < 2000;
        oreRef.current.style.display = show ? "" : "none";
        if (show) oreRef.current.textContent = `ORE ${beamState.ore}/${ORE_PER_CRYSTAL}`;
      }
```

- [ ] **Step 6: Verify**

Run: `npm test && npx tsc -b && npm run lint`
Expected: green.

Manual: `npm run dev`, press W once, then in the console:
`const w = __fitz.mining.rings[0].world; __fitz.teleport(w[0], w[1], w[2] - 8); __fitz.setAttitude(0, 0)`
and hold F. Pebbles fly in, `ORE n/16` appears under the fuel bar, fuel creeps up, and the first-ore line plays. Stop the dev server with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add src/utils/mining.ts src/components/canvas/AsteroidBelt.tsx src/components/layout/HUDOverlay.tsx src/debug/bridge.ts tests/mining.test.ts
git commit -m "feat(beam): mine belt pebbles into ore; 16 make a crystal, 40s per tank minimum

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Phase E — End-to-end proof

### Task 18: `mechanics.probe.mjs`

**Files:**
- Create: `tests/e2e/mechanics.probe.mjs`
- Modify: `tests/e2e/run.mjs` (register after `events`)

**Interfaces:**
- Consumes: `withPage`, `settle`, `readStore`, `pollUntil` (`tests/e2e/harness.mjs`); `window.__fitz.{teleport, setAttitude, flight, bodies, crystals, mining, beam, store, gl, perfStats, scene}`; `[data-testid="edge-haze"]`, `[data-testid="hud-ore"]`.

- [ ] **Step 1: Write the probe**

```js
import { withPage, settle, readStore, pollUntil } from "./harness.mjs";

const pools = (page) => page.evaluate(async () => (await import("/src/data/chatterLines.ts")).chatterPools);
const hazeOpacity = (page) => page.evaluate(() => Number(document.querySelector('[data-testid="edge-haze"]')?.style.opacity ?? "0"));
/** Faces the ship at a world point (yaw only) and ends the spawn auto-aim. */
const face = (page, x, z) => page.evaluate((tx, tz) => {
  const f = window.__fitz.flight;
  window.__fitz.setAttitude(Math.atan2(tx - f.x, tz - f.z), 0);
}, x, z);
/** Parks the ship in deep space and puts crystal slot 0 20u ahead of it. */
const crystalAhead = (page) => page.evaluate(() => {
  window.__fitz.teleport(150, 60, 150);
  window.__fitz.setAttitude(0, 0);
  Object.assign(window.__fitz.crystals[0], { x: 150, y: 60, z: 170, active: true });
});

async function edge(page, checks) {
  const P = await pools(page);
  await page.keyboard.press("KeyW"); // first input
  await page.evaluate(() => { window.__fitz.teleport(232, 0, 0); window.__fitz.setAttitude(Math.PI / 2, 0); });
  await settle(page, 7000); // let the radio go quiet (RADIO_BUSY_S = 6)
  const op = await hazeOpacity(page);
  checks.check("haze thickens near the edge", op > 0.5, `opacity=${op}`);

  let flashed = false;
  await page.keyboard.down("KeyW");
  const crossed = await pollUntil(async () => {
    const r = await page.evaluate(() => ({ x: window.__fitz.flight.x, flash: window.__fitz.store.getState().isTeleporting }));
    flashed = flashed || r.flash;
    return r.x < 0;
  }, { timeoutMs: 20_000, intervalMs: 100 });
  await page.keyboard.up("KeyW");
  checks.check("the ship crosses the seam", crossed.ok);
  checks.check("the wrap fires no teleport flash", !flashed);
  const opFar = await hazeOpacity(page);
  checks.check("the far side of the seam is still deep haze", opFar > 0.7, `opacity=${opFar}`);
  const line = (await readStore(page)).broadcast;
  checks.check("a haze line played, silently", !!line && P.haze.includes(line.text) && line.silent === true,
    `broadcast=${JSON.stringify(line)}`);
}

async function gravity(page, checks) {
  await page.keyboard.press("KeyW");
  // A W-held pass 34u above a planet's centre, flying +x.
  const name = "portfolio";
  await page.evaluate((n) => {
    const b = window.__fitz.bodies[n];
    window.__fitz.teleport(b.x - 90, b.y + 34, b.z);
    window.__fitz.setAttitude(Math.PI / 2, 0);
  }, name);
  let peak = 0, locked = false;
  await page.keyboard.down("KeyW");
  for (let k = 0; k < 70; k++) {
    const r = await page.evaluate(() => ({ s: window.__fitz.flight.speed, l: window.__fitz.store.getState().isOrbitLocked }));
    peak = Math.max(peak, r.s); locked = locked || r.l;
    await settle(page, 200);
  }
  await page.keyboard.up("KeyW");
  checks.check("a pass 34u off a planet speeds the ship past cruise", peak > 12.5, `peak=${peak.toFixed(1)}`);
  checks.check("that pass does not open the dossier", !locked);

  // Straight in: docks.
  await page.evaluate((n) => {
    const b = window.__fitz.bodies[n];
    window.__fitz.teleport(b.x - 60, b.y, b.z);
    window.__fitz.setAttitude(Math.PI / 2, 0);
  }, name);
  await page.keyboard.down("KeyW");
  const docked = await pollUntil(async () => (await readStore(page)).isOrbitLocked, { timeoutMs: 20_000, intervalMs: 200 });
  await page.keyboard.up("KeyW");
  checks.check("a straight-in approach docks and opens the dossier", docked.ok);
  await page.keyboard.press("Escape");
  await settle(page, 2500);

  // Idle 30u from a planet: station-keeping.
  await page.evaluate((n) => { const b = window.__fitz.bodies[n]; window.__fitz.teleport(b.x - 30, b.y + 5, b.z); }, name);
  const a = await page.evaluate(() => ({ x: window.__fitz.flight.x, y: window.__fitz.flight.y, z: window.__fitz.flight.z }));
  await settle(page, 10_000);
  const b = await page.evaluate(() => ({ x: window.__fitz.flight.x, y: window.__fitz.flight.y, z: window.__fitz.flight.z }));
  const drift = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  checks.check("an idle ship near a planet barely drifts", drift < 3, `drift=${drift.toFixed(2)}`);
}

async function beam(page, checks) {
  await page.keyboard.press("KeyW");
  await crystalAhead(page);
  await settle(page, 1000);
  const programsBefore = await page.evaluate(() => window.__fitz.gl.info.programs.length);
  await page.keyboard.down("KeyF");
  const got = await pollUntil(() => page.evaluate(() => !window.__fitz.crystals[0].active), { timeoutMs: 10_000, intervalMs: 200 });
  const during = await page.evaluate(() => ({
    programs: window.__fitz.gl.info.programs.length,
    calls: window.__fitz.perfStats.calls,
    cone: window.__fitz.scene.getObjectByName("TractorBeamCone")?.visible === true,
  }));
  await page.keyboard.up("KeyF");
  checks.check("holding F pulls in and collects a crystal 20u ahead", got.ok);
  checks.check("the beam cone shows while F is held", during.cone);
  checks.check("the beam adds no shader program", during.programs === programsBefore,
    `before=${programsBefore} during=${during.programs}`);
  checks.check("draw calls stay within the close-approach ceiling with the beam on", during.calls <= 110, `calls=${during.calls}`);

  // Mining: park 8u from a main-belt pebble, facing it.
  await page.evaluate(() => {
    const w = window.__fitz.mining.rings[0].world;
    window.__fitz.teleport(w[0], w[1], w[2] - 8);
  });
  const target = await page.evaluate(() => { const w = window.__fitz.mining.rings[0].world; return { x: w[0], z: w[2] }; });
  await face(page, target.x, target.z);
  await page.keyboard.down("KeyF");
  const ore = await pollUntil(() => page.evaluate(() => {
    const el = document.querySelector('[data-testid="hud-ore"]');
    return !!el && el.style.display !== "none" && /ORE \d+\/16/.test(el.textContent ?? "");
  }), { timeoutMs: 15_000, intervalMs: 250 });
  await page.keyboard.up("KeyF");
  checks.check("mining a belt pebble shows the ORE readout", ore.ok);

  // Shard reel: shard 1 sits at (53, -18, 50); park 22u short of it, facing it.
  const already = (await readStore(page)).shardsCollected.includes(1);
  await page.evaluate(() => { window.__fitz.teleport(53, -18, 28); window.__fitz.setAttitude(0, 0); });
  await page.keyboard.down("KeyF");
  const reeled = await pollUntil(async () => (await readStore(page)).shardsCollected.includes(1), { timeoutMs: 12_000, intervalMs: 200 });
  await page.keyboard.up("KeyF");
  checks.check("the beam reels the ship to a shard and collects it", already || reeled.ok, already ? "already collected" : "");
}

async function photoMode(page, checks) {
  await page.keyboard.press("KeyW");
  await page.keyboard.press("KeyP");
  await settle(page, 500);
  await page.keyboard.down("KeyF");
  await settle(page, 600);
  const active = await page.evaluate(() => window.__fitz.beam.active);
  await page.keyboard.up("KeyF");
  await page.keyboard.press("KeyP");
  checks.check("the beam stays off in photo mode", active === false);
}

async function reducedMotion(page, checks) {
  await page.keyboard.press("KeyW");
  await page.evaluate(() => window.__fitz.teleport(240, 0, 0));
  await settle(page, 600);
  const op = await hazeOpacity(page);
  checks.check("reduced motion: the haze still shows", op > 0.5, `opacity=${op}`);
  await crystalAhead(page);
  await page.keyboard.down("KeyF");
  const got = await pollUntil(() => page.evaluate(() => !window.__fitz.crystals[0].active), { timeoutMs: 10_000, intervalMs: 200 });
  await page.keyboard.up("KeyF");
  checks.check("reduced motion: the beam still pulls a crystal", got.ok);
}

export default async function run() {
  const checks = await withPage({ label: "mechanics: edge" }, edge);
  for (const [label, fn, opts] of [
    ["mechanics: gravity", gravity, {}],
    ["mechanics: beam", beam, {}],
    ["mechanics: photo mode", photoMode, {}],
    ["mechanics: reduced motion", reducedMotion, { emulateReducedMotion: true }],
  ]) {
    const c = await withPage({ label, ...opts }, fn);
    checks.results.push(...c.results);
  }
  return checks;
}
```

Notes for the implementer:
- Check how `events.probe.mjs` begins: if `withPage` does not already wait for `sceneReady`, add the same wait those probes use before the first `teleport`.
- `fitzDebug.crystals` is the live slot array, so writing to it moves the real crystal.
- Planets drift ~2 u/s; the gravity pass asserts a generous threshold (12.5) for that reason.
- If `Escape` does not close the dossier in this build, use `window.__fitz.store.getState().breakOrbit()`.

- [ ] **Step 2: Register it**

In `tests/e2e/run.mjs`, insert `"mechanics"` after `"events"` in the default `PROBES` list.

- [ ] **Step 3: Run the probe**

Close any browser tab rendering the app. Run: `npm run test:e2e -- mechanics`
Expected: all mechanics checks pass. If one fails, report its detail string; fix the cause in the owning task's code, not the threshold, unless the threshold contradicts spec §5.6 or §7.2.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/mechanics.probe.mjs tests/e2e/run.mjs
git commit -m "test(e2e): mechanics probe for the edge, gravity, beam and budgets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Full verification bar

- [ ] **Step 1: Unit, types, lint**

Run: `npm test && npx tsc -b && npm run lint`
Expected: all green. Record the test count.

- [ ] **Step 2: Full e2e**

Close any browser tab rendering the app. Run: `npm run test:e2e`
Expected: every check passes (the previous suite plus the new mechanics checks). Record the `n/n checks passed` line. `transition.probe.mjs` must still report deep-space programs ≤ 79.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: succeeds, and `grep -l "__fitz" dist/assets/*.js` prints nothing (the debug bridge is stripped).

- [ ] **Step 4: Report**

Report the results (unit count, typecheck, lint, e2e line, build) to the controller. Do not push or open a PR; the controller does that after the whole-branch review.
