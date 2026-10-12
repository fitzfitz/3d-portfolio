# World Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A director schedules a comet close pass, a solar flare and a cargo convoy (first ~45s in, then every 60–120s), and the existing Comets, Sun and CargoTraffic components play them.

**Architecture:** Two pure modules hold all the logic, both unit-tested:
- `src/utils/eventDirector.ts`: scheduling.
- `src/utils/worldEvents.ts`: flare envelope, comet line, convoy path.

A `WorldEventDirector` canvas component steps the director each frame, plans each event's target, stores it as `worldEvent` in the zustand store, and advances a module-level `worldClock`. Components read `worldEventElapsed(kind)` and animate. Event objects stay mounted, hidden when idle.

**Tech Stack:** React 19, TypeScript, @react-three/fiber, three.js, zustand, Vitest, puppeteer-core e2e harness.

**Spec:** `docs/superpowers/specs/2026-10-12-world-events-design.md`

## Global Constraints

- **Watch-only:** events give the player no task.
- **No new shader programs** (`deep-space programs` 79/79). Reuse or clone existing materials only.
- **No new lights.** The sun light stays one `pointLight`; only its intensity changes.
- **Mounted, not mounted on demand:** event objects are always mounted and hidden when idle.
- **Reduced motion:** no events start. A dev `triggerEvent` may still force one.
- **Pausing:** the director clock pauses when `selectSceneFrozen(s) || s.photoMode || s.showClassicCV`.
- **Timing:** first event at 45s; then a gap of 60–120s from the previous event's end; never the same kind twice in a row.
- **Deferred starts:** no start during a race lap (`race.phase === "running"`) or within `RADIO_BUSY_S` (6s) of a broadcast. The start is deferred, not skipped.
- **Durations:** comet 25s, flare 12s, convoy 40s.
- **Comet:** closest approach 35u to the target, entry 250u out, 22u/s, activity forced to 1. Give up after 8 tries without a clear line.
- **Flare:**
  - 12s envelope, peaks ≥3s apart;
  - `uHeat` +0.6;
  - corona ×(1+0.6f);
  - light 2.1→3.2;
  - god rays ×(1+0.5f).
- **Convoy:**
  - 3 ships (1 in low-perf);
  - orbit radius `2.2 × size`, outside lock-retain (1.9×);
  - approach from the anti-sun side;
  - the route must clear the other planets and the sun.
- **Frame time:**
  - Animating `useFrame`s clamp `dt` to `Math.min(delta, 0.05)`.
  - The director's *scheduling* clock caps at `Math.min(delta, 0.25)` instead. A 0.05 cap would run the clock at half speed or less below 20fps, which would delay events on slow devices and in headless e2e. 0.25 still absorbs the first-frame spike after a freeze.
- **Debug hooks:** DEV-only, following the `FuelCrystals.tsx` pattern.
- **Copy:** uppercase, in the radio voice, in `src/data/chatterLines.ts`.
- **Commits:** trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never** `pkill`/`kill -9` by name. Never install packages.

## Review Focus

1. **Player near a planet when a comet event starts.** Expected: the comet's line still clears every planet, or the event quietly skips. It never flies through a planet. Pinned in Task 2 (`planCometPass` clearance and impossible-geometry tests).
2. **An event running when the scene freezes** (orbit lock or dossier, photo mode). Expected: it pauses mid-animation and resumes, rather than jumping ahead. Pinned in Task 1 (paused steps neither advance the clock nor end events).
3. **A dev trigger during an active event.** Expected: the active event ends cleanly before the new one starts, with no leftover hidden-state mismatch. Pinned in Task 1 (`forceStart`).
4. **The convoy's target planet is moving.** Expected: ships ride the planet's live position, so the orbit stays centred. The path is planet-relative (Task 2), and Task 7 checks it end to end.
5. **Gaps at the convoy path's seams** (approach→orbit at 20s, orbit→depart at 35s). Expected: continuous position, no teleport. Pinned in Task 2 (continuity tests).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/utils/eventDirector.ts` (create) | Director state machine, kinds, durations. |
| `src/utils/worldEvents.ts` (create) | `flareEnvelope`/`flareLevel`, comet line planning and position, convoy plan, path and formation. |
| `src/store/spaceStore.ts` (modify) | `worldEvent` state, `startWorldEvent`/`endWorldEvent`, `worldClock`, `worldEventElapsed`. |
| `src/data/chatterLines.ts` (modify) | `eventLines` (comet, flare, convoy per planet). |
| `src/components/canvas/WorldEventDirector.tsx` (create) | Steps the director, plans targets, starts and ends events, dev trigger. |
| `src/components/canvas/GlobalCanvas.tsx` (modify) | Mounts the director; `SunLight` drives the light's intensity. |
| `src/components/canvas/Sun.tsx`, `PostFX.tsx` (modify) | Flare visuals. |
| `src/components/canvas/Comets.tsx` (modify) | Visitor comet slot. |
| `src/components/canvas/CargoTraffic.tsx` (modify) | Convoy ships. |
| `src/debug/bridge.ts` (modify) | `triggerEvent`. |
| `tests/eventDirector.test.ts`, `tests/worldEvents.test.ts`, `tests/worldEventStore.test.ts` (create) | Unit tests. |
| `tests/e2e/events.probe.mjs` (create), `tests/e2e/run.mjs` (modify) | E2E. |

---

### Task 1: Event director

**Files:** Create `src/utils/eventDirector.ts`. Test: `tests/eventDirector.test.ts`.

**Interfaces — Produces:**
- **Constants:** `type WorldEventKind = "comet" | "flare" | "convoy"`; `WORLD_EVENT_KINDS`; `FIRST_EVENT_AT = 45`; `GAP_MIN = 60`; `GAP_SPAN = 60`; `EVENT_DURATION: Record<WorldEventKind, number>`.
- **Types:**
  - `interface ActiveEvent { kind; id: number; startedAt: number; endsAt: number }`
  - `interface DirectorState { clock; nextAt; active: ActiveEvent | null; lastKind: WorldEventKind | null; nextId: number; random: () => number }`
  - `interface DirectorInput { dt; paused; raceRunning; radioBusy; reducedMotion }`
  - `interface DirectorStep { started: ActiveEvent | null; ended: ActiveEvent | null }`
- **Functions:** `createDirector(random?)`, `stepDirector(s, inp)`, `endEvent(s)`, `forceStart(s, kind)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/eventDirector.test.ts
import { describe, it, expect } from "vitest";
import {
  createDirector, stepDirector, endEvent, forceStart,
  FIRST_EVENT_AT, GAP_MIN, GAP_SPAN, EVENT_DURATION, type DirectorInput, type WorldEventKind,
} from "../src/utils/eventDirector";

const calm: DirectorInput = { dt: 1, paused: false, raceRunning: false, radioBusy: false, reducedMotion: false };
/** Deterministic LCG in [0,1). */
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

describe("eventDirector", () => {
  it("starts the first event at 45s", () => {
    const d = createDirector(() => 0);
    let at = -1;
    for (let n = 0; n < 60 && at < 0; n++) if (stepDirector(d, calm).started) at = d.clock;
    expect(at).toBe(FIRST_EVENT_AT);
  });

  it("ends an event after its duration and waits 60–120s before the next", () => {
    const d = createDirector(() => 0); // gap = GAP_MIN, kinds in list order
    const starts: { kind: WorldEventKind; at: number }[] = [];
    const ends: number[] = [];
    for (let n = 0; n < 400; n++) {
      const st = stepDirector(d, calm);
      if (st.started) starts.push({ kind: st.started.kind, at: d.clock });
      if (st.ended) ends.push(d.clock);
    }
    expect(starts[0]).toEqual({ kind: "comet", at: 45 });
    expect(ends[0]).toBe(45 + EVENT_DURATION.comet);
    expect(starts[1].at).toBe(ends[0] + GAP_MIN);
    expect(starts[1].kind).toBe("flare");
  });

  it("never repeats a kind back to back, and keeps every gap within 60–120s", () => {
    const d = createDirector(lcg(7));
    let lastKind: WorldEventKind | null = null;
    let lastEnd: number | null = null;
    for (let n = 0; n < 20000; n++) {
      const st = stepDirector(d, { ...calm, dt: 0.5 });
      if (st.ended) lastEnd = d.clock;
      if (st.started) {
        expect(st.started.kind).not.toBe(lastKind);
        if (lastEnd !== null) {
          const gap = d.clock - lastEnd;
          expect(gap).toBeGreaterThanOrEqual(GAP_MIN - 0.5);
          expect(gap).toBeLessThanOrEqual(GAP_MIN + GAP_SPAN + 0.5);
        }
        lastKind = st.started.kind;
      }
    }
  });

  it("does not advance, start or end anything while paused", () => {
    const d = createDirector(() => 0);
    for (let n = 0; n < 100; n++) expect(stepDirector(d, { ...calm, paused: true })).toEqual({ started: null, ended: null });
    expect(d.clock).toBe(0);
    forceStart(d, "flare");
    for (let n = 0; n < 100; n++) stepDirector(d, { ...calm, paused: true });
    expect(d.active?.kind).toBe("flare");
  });

  it("defers, not skips, a due start during a race or a busy radio", () => {
    for (const block of [{ raceRunning: true }, { radioBusy: true }]) {
      const d = createDirector(() => 0);
      for (let n = 0; n < 55; n++) expect(stepDirector(d, { ...calm, ...block }).started).toBeNull();
      expect(stepDirector(d, calm).started?.kind).toBe("comet");
    }
  });

  it("starts nothing under reduced motion, but lets an active event end on time", () => {
    const d = createDirector(() => 0);
    for (let n = 0; n < 200; n++) expect(stepDirector(d, { ...calm, reducedMotion: true }).started).toBeNull();
    forceStart(d, "flare");
    let ended = false;
    for (let n = 0; n < EVENT_DURATION.flare + 1; n++) if (stepDirector(d, { ...calm, reducedMotion: true }).ended) ended = true;
    expect(ended).toBe(true);
  });

  it("forceStart ends the active event and starts the requested one", () => {
    const d = createDirector(() => 0);
    forceStart(d, "comet");
    const st = forceStart(d, "convoy");
    expect(st.ended?.kind).toBe("comet");
    expect(st.started?.kind).toBe("convoy");
    expect(d.active?.kind).toBe("convoy");
  });

  it("endEvent schedules the next start from the end time", () => {
    const d = createDirector(() => 0.5);
    forceStart(d, "flare");
    endEvent(d);
    expect(d.active).toBeNull();
    expect(d.nextAt).toBe(d.clock + GAP_MIN + 0.5 * GAP_SPAN);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/eventDirector.test.ts`
Expected: FAIL with `Cannot find module '../src/utils/eventDirector'`.

- [ ] **Step 3: Implement**

```ts
// src/utils/eventDirector.ts
/**
 * Schedules world events (docs/superpowers/specs/2026-10-12-world-events-design.md):
 * the first at 45s of flying time, then one every 60–120s after the previous
 * ends, never the same kind twice running. Pure, with an injected RNG so the
 * sequence is testable. Its clock is flying time: it only advances on
 * unpaused steps, so an event caught by an orbit lock or photo mode resumes
 * where it was.
 */

export type WorldEventKind = "comet" | "flare" | "convoy";
export const WORLD_EVENT_KINDS: readonly WorldEventKind[] = ["comet", "flare", "convoy"];
export const FIRST_EVENT_AT = 45;
export const GAP_MIN = 60;
export const GAP_SPAN = 60;
export const EVENT_DURATION: Record<WorldEventKind, number> = { comet: 25, flare: 12, convoy: 40 };

export interface ActiveEvent { kind: WorldEventKind; id: number; startedAt: number; endsAt: number }
export interface DirectorState {
  clock: number;
  nextAt: number;
  active: ActiveEvent | null;
  lastKind: WorldEventKind | null;
  nextId: number;
  random: () => number;
}
export interface DirectorInput { dt: number; paused: boolean; raceRunning: boolean; radioBusy: boolean; reducedMotion: boolean }
export interface DirectorStep { started: ActiveEvent | null; ended: ActiveEvent | null }

export function createDirector(random: () => number = Math.random): DirectorState {
  return { clock: 0, nextAt: FIRST_EVENT_AT, active: null, lastKind: null, nextId: 1, random };
}

function pickKind(s: DirectorState): WorldEventKind {
  const options = WORLD_EVENT_KINDS.filter((k) => k !== s.lastKind);
  return options[Math.min(options.length - 1, Math.floor(s.random() * options.length))];
}

function begin(s: DirectorState, kind: WorldEventKind): ActiveEvent {
  const ev = { kind, id: s.nextId++, startedAt: s.clock, endsAt: s.clock + EVENT_DURATION[kind] };
  s.active = ev;
  s.lastKind = kind;
  return ev;
}

/** Ends the active event (if any) and schedules the next start from now. */
export function endEvent(s: DirectorState): ActiveEvent | null {
  const ev = s.active;
  if (!ev) return null;
  s.active = null;
  s.nextAt = s.clock + GAP_MIN + s.random() * GAP_SPAN;
  return ev;
}

/**
 * One frame. Paused: nothing moves. Otherwise the clock advances, an active
 * event ends on time, and a due start fires unless reduced motion is on or a
 * race / busy radio holds it (held, not skipped: it fires once clear).
 */
export function stepDirector(s: DirectorState, inp: DirectorInput): DirectorStep {
  const out: DirectorStep = { started: null, ended: null };
  if (inp.paused) return out;
  s.clock += inp.dt;
  if (s.active) {
    if (s.clock >= s.active.endsAt) out.ended = endEvent(s);
    return out;
  }
  if (inp.reducedMotion || inp.raceRunning || inp.radioBusy) return out;
  if (s.clock >= s.nextAt) out.started = begin(s, pickKind(s));
  return out;
}

/** Dev trigger: ends whatever is running, then starts `kind` now. */
export function forceStart(s: DirectorState, kind: WorldEventKind): DirectorStep {
  const ended = endEvent(s);
  return { started: begin(s, kind), ended };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/eventDirector.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/eventDirector.ts tests/eventDirector.test.ts
git commit -m "feat(events): director schedules comet, flare and convoy events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Event geometry (flare, comet line, convoy path)

**Files:** Create `src/utils/worldEvents.ts`. Test: `tests/worldEvents.test.ts`.

**Interfaces:**
- **Consumes:** `Vec3` from `src/utils/reactions.ts`.
- **Produces:**
  - **Flare:** `flareEnvelope(t: number, duration?: number): number`; `flareLevel(elapsed: number | null): number`.
  - **Shared:** `interface Sphere extends Vec3 { r: number }`.
  - **Comet:**
    - `interface CometPass { sx; sy; sz; dx; dy; dz; speed: number }`
    - `COMET_PASS_DIST = 35`, `COMET_ENTRY_DIST = 250`, `COMET_SPEED = 22`, `COMET_TRIES = 8`
    - `planCometPass(target: Vec3, avoid: readonly Sphere[], random: () => number): CometPass | null`
    - `cometPassAt(out: Vec3, p: CometPass, t: number): Vec3`
  - **Convoy:**
    - `interface ConvoyPlan { ux; uy; uz; vx; vy; vz; wx; wy; wz; R: number }`
    - `CONVOY_ORBIT_FACTOR = 2.2`, `CONVOY_APPROACH_S = 20`, `CONVOY_ORBIT_S = 15`, `CONVOY_HIDE_DIST = 250`, `CONVOY_SPACING = 6`
    - `convoyOffsetAt(out: Vec3, plan: ConvoyPlan, t: number): Vec3` (relative to the planet centre)
    - `convoyShipOffsetAt(out: Vec3, plan: ConvoyPlan, t: number, slot: 0 | 1 | 2): Vec3`
    - `planConvoy(planetPos: Vec3, planetSize: number, isClear: (plan: ConvoyPlan) => boolean): ConvoyPlan | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/worldEvents.test.ts
import { describe, it, expect } from "vitest";
import {
  flareEnvelope, flareLevel, planCometPass, cometPassAt, convoyOffsetAt, convoyShipOffsetAt, planConvoy,
  COMET_PASS_DIST, COMET_ENTRY_DIST, COMET_SPEED,
  CONVOY_ORBIT_FACTOR, CONVOY_APPROACH_S, CONVOY_ORBIT_S, CONVOY_HIDE_DIST, CONVOY_SPACING,
  type CometPass, type ConvoyPlan,
} from "../src/utils/worldEvents";
import { LOCK_RETAIN_FACTOR } from "../src/constants";

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const len = (o: { x: number; y: number; z: number }) => Math.hypot(o.x, o.y, o.z);
const sub = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

/** Closest distance from `target` to the comet's line over its whole pass. */
function closestToTarget(p: CometPass, target: { x: number; y: number; z: number }) {
  let best = Infinity;
  const total = (2 * COMET_ENTRY_DIST) / COMET_SPEED;
  for (let t = 0; t <= total; t += 0.01) best = Math.min(best, len(sub(cometPassAt(v(), p, t), target)));
  return best;
}

describe("flareEnvelope", () => {
  it("starts and ends at zero", () => {
    expect(flareEnvelope(0)).toBe(0);
    expect(flareEnvelope(12)).toBe(0);
    expect(flareEnvelope(-1)).toBe(0);
    expect(flareEnvelope(20)).toBe(0);
  });
  it("swells to exactly 1, twice, at least 3s apart, and never above 1", () => {
    const peaks: number[] = [];
    let prev = 0, rising = true;
    for (let t = 0; t <= 12; t += 0.01) {
      const f = flareEnvelope(t);
      expect(f).toBeLessThanOrEqual(1 + 1e-9);
      if (rising && f < prev) peaks.push(t - 0.01);
      rising = f >= prev;
      prev = f;
    }
    expect(peaks.length).toBe(2);
    expect(peaks[1] - peaks[0]).toBeGreaterThanOrEqual(3);
    expect(flareEnvelope(3)).toBeCloseTo(1, 6);
  });
  it("flareLevel is 0 with no flare running and follows the envelope otherwise", () => {
    expect(flareLevel(null)).toBe(0);
    expect(flareLevel(3)).toBeCloseTo(1, 6);
    expect(flareLevel(6)).toBeCloseTo(0, 6);
  });
});

describe("comet pass", () => {
  it("passes the target at the planned distance", () => {
    const target = v(10, 20, 30);
    const p = planCometPass(target, [], lcg(3))!;
    expect(closestToTarget(p, target)).toBeCloseTo(COMET_PASS_DIST, 1);
  });
  it("enters far away and flies at the planned speed", () => {
    const p = planCometPass(v(), [], lcg(5))!;
    expect(len(sub(cometPassAt(v(), p, 0), v()))).toBeCloseTo(Math.hypot(COMET_ENTRY_DIST, COMET_PASS_DIST), 3);
    expect(len(sub(cometPassAt(v(), p, 1), cometPassAt(v(), p, 0)))).toBeCloseTo(COMET_SPEED, 6);
  });
  it("never flies through an obstacle sphere", () => {
    const avoid = [{ x: 60, y: 0, z: 0, r: 40 }, { x: -60, y: 0, z: 0, r: 40 }];
    for (let seed = 1; seed < 30; seed++) {
      const p = planCometPass(v(), avoid, lcg(seed));
      if (!p) continue;
      const total = (2 * COMET_ENTRY_DIST) / COMET_SPEED;
      for (let t = 0; t <= total; t += 0.05) {
        const q = cometPassAt(v(), p, t);
        for (const a of avoid) expect(len(sub(q, a))).toBeGreaterThan(a.r);
      }
    }
  });
  it("gives up when no clear line exists", () => {
    expect(planCometPass(v(), [{ x: 0, y: 0, z: 0, r: 1000 }], lcg(9))).toBeNull();
  });
  it("is deterministic for a given random source", () => {
    expect(planCometPass(v(1, 2, 3), [], lcg(11))).toEqual(planCometPass(v(1, 2, 3), [], lcg(11)));
  });
});

describe("convoy path", () => {
  const size = 16;
  const plan = planConvoy(v(130, 0, 0), size, () => true)!;
  const R = CONVOY_ORBIT_FACTOR * size;

  it("orbits at 2.2x size, outside the lock-retain radius", () => {
    expect(plan.R).toBeCloseTo(R);
    expect(plan.R).toBeGreaterThan(size * LOCK_RETAIN_FACTOR);
    for (let t = CONVOY_APPROACH_S; t <= CONVOY_APPROACH_S + CONVOY_ORBIT_S; t += 0.5) {
      expect(len(convoyOffsetAt(v(), plan, t))).toBeCloseTo(R, 6);
    }
  });
  it("approaches from the side away from the sun", () => {
    expect(convoyOffsetAt(v(), plan, 0).x).toBeGreaterThan(150); // planet at +x: start further out on +x
  });
  it("is continuous at both seams", () => {
    for (const seam of [CONVOY_APPROACH_S, CONVOY_APPROACH_S + CONVOY_ORBIT_S]) {
      const a = convoyOffsetAt(v(), plan, seam - 1e-4);
      const b = convoyOffsetAt(v(), plan, seam + 1e-4);
      expect(len(sub(a, b))).toBeLessThan(0.01);
    }
  });
  it("leaves past the hide distance by the end", () => {
    expect(len(convoyOffsetAt(v(), plan, 40))).toBeGreaterThan(CONVOY_HIDE_DIST);
  });
  it("never cuts through the target planet", () => {
    for (let t = 0; t <= 40; t += 0.1) expect(len(convoyOffsetAt(v(), plan, t))).toBeGreaterThan(size + 3);
  });
  it("keeps the wingmen in a V at constant spacing", () => {
    for (let t = 1; t <= 38; t += 1.5) {
      const lead = convoyShipOffsetAt(v(), plan, t, 0);
      for (const slot of [1, 2] as const) {
        expect(len(sub(convoyShipOffsetAt(v(), plan, t, slot), lead))).toBeCloseTo(Math.SQRT2 * CONVOY_SPACING, 3);
      }
      expect(len(sub(convoyShipOffsetAt(v(), plan, t, 1), convoyShipOffsetAt(v(), plan, t, 2)))).toBeCloseTo(2 * CONVOY_SPACING, 3);
    }
  });
  it("tries other approach angles, and gives up when none is clear", () => {
    let calls = 0;
    expect(planConvoy(v(130, 0, 0), size, () => ++calls === 2)).not.toBeNull();
    expect(calls).toBe(2);
    expect(planConvoy(v(130, 0, 0), size, () => false)).toBeNull();
  });
  it("produces orthonormal frame vectors", () => {
    const p: ConvoyPlan = plan;
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const u = [p.ux, p.uy, p.uz], vv = [p.vx, p.vy, p.vz], w = [p.wx, p.wy, p.wz];
    expect(dot(u, u)).toBeCloseTo(1); expect(dot(vv, vv)).toBeCloseTo(1); expect(dot(w, w)).toBeCloseTo(1);
    expect(dot(u, vv)).toBeCloseTo(0); expect(dot(u, w)).toBeCloseTo(0); expect(dot(vv, w)).toBeCloseTo(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/worldEvents.test.ts`
Expected: FAIL with `Cannot find module '../src/utils/worldEvents'`.

- [ ] **Step 3: Implement**

```ts
// src/utils/worldEvents.ts
import type { Vec3 } from "./reactions";

/**
 * Pure geometry for the world events (docs/superpowers/specs/2026-10-12-world-events-design.md).
 * Components read these with the event's elapsed time; nothing here touches the scene.
 */

/** Flare brightness 0..1 over `duration` seconds: two swells peaking at D/4 and 3D/4 (6s apart). */
export function flareEnvelope(t: number, duration = 12): number {
  if (t <= 0 || t >= duration) return 0;
  return 0.5 - 0.5 * Math.cos((4 * Math.PI * t) / duration);
}

/** Flare level for an elapsed time from worldEventElapsed("flare"); 0 when none is running. */
export function flareLevel(elapsed: number | null): number {
  return elapsed === null ? 0 : flareEnvelope(elapsed);
}

export interface Sphere extends Vec3 { r: number }

/** A straight comet pass: position = start + dir * speed * t. */
export interface CometPass { sx: number; sy: number; sz: number; dx: number; dy: number; dz: number; speed: number }

export const COMET_PASS_DIST = 35;
export const COMET_ENTRY_DIST = 250;
export const COMET_SPEED = 22;
export const COMET_TRIES = 8;

function randomUnit(random: () => number, out: Vec3): Vec3 {
  const z = 2 * random() - 1;
  const phi = 2 * Math.PI * random();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  out.x = r * Math.cos(phi); out.y = r * Math.sin(phi); out.z = z;
  return out;
}

/** A unit vector perpendicular to unit `d`, rotated by a random angle around it. */
function randomPerpendicular(d: Vec3, random: () => number, out: Vec3): Vec3 {
  // Any axis not parallel to d, then Gram-Schmidt.
  const ax = Math.abs(d.x) < 0.9 ? 1 : 0, ay = ax ? 0 : 1;
  const k = ax * d.x + ay * d.y;
  let px = ax - d.x * k, py = ay - d.y * k, pz = -d.z * k;
  const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
  const qx = d.y * pz - d.z * py, qy = d.z * px - d.x * pz, qz = d.x * py - d.y * px; // d × p
  const a = 2 * Math.PI * random();
  const c = Math.cos(a), s = Math.sin(a);
  out.x = px * c + qx * s; out.y = py * c + qy * s; out.z = pz * c + qz * s;
  return out;
}

/** Whether the segment start + d*[0,length] stays outside every sphere. */
function segmentClear(sx: number, sy: number, sz: number, d: Vec3, length: number, avoid: readonly Sphere[]): boolean {
  for (const a of avoid) {
    const cx = a.x - sx, cy = a.y - sy, cz = a.z - sz;
    const t = Math.min(length, Math.max(0, cx * d.x + cy * d.y + cz * d.z));
    if (Math.hypot(cx - d.x * t, cy - d.y * t, cz - d.z * t) <= a.r) return false;
  }
  return true;
}

/**
 * A pass whose closest approach to `target` is COMET_PASS_DIST, entering
 * COMET_ENTRY_DIST before that point, clear of every `avoid` sphere along its
 * whole length. Null after COMET_TRIES random directions all hit something.
 */
export function planCometPass(target: Vec3, avoid: readonly Sphere[], random: () => number): CometPass | null {
  const d = { x: 0, y: 0, z: 0 }, n = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < COMET_TRIES; i++) {
    randomUnit(random, d);
    randomPerpendicular(d, random, n);
    const cx = target.x + n.x * COMET_PASS_DIST, cy = target.y + n.y * COMET_PASS_DIST, cz = target.z + n.z * COMET_PASS_DIST;
    const sx = cx - d.x * COMET_ENTRY_DIST, sy = cy - d.y * COMET_ENTRY_DIST, sz = cz - d.z * COMET_ENTRY_DIST;
    if (segmentClear(sx, sy, sz, d, 2 * COMET_ENTRY_DIST, avoid)) {
      return { sx, sy, sz, dx: d.x, dy: d.y, dz: d.z, speed: COMET_SPEED };
    }
  }
  return null;
}

export function cometPassAt(out: Vec3, p: CometPass, t: number): Vec3 {
  out.x = p.sx + p.dx * p.speed * t; out.y = p.sy + p.dy * p.speed * t; out.z = p.sz + p.dz * p.speed * t;
  return out;
}

/** Convoy frame: u away from the sun through the planet, v the orbit-entry side, w = u × v. */
export interface ConvoyPlan { ux: number; uy: number; uz: number; vx: number; vy: number; vz: number; wx: number; wy: number; wz: number; R: number }

export const CONVOY_ORBIT_FACTOR = 2.2;
export const CONVOY_APPROACH_S = 20;
export const CONVOY_ORBIT_S = 15;
export const CONVOY_HIDE_DIST = 250;
export const CONVOY_SPACING = 6;
/** ~1.25 turns over the orbit phase. */
const CONVOY_OMEGA = (2 * Math.PI * 1.25) / CONVOY_ORBIT_S;

/**
 * The lead ship's offset from the planet centre at `t` seconds. Approach
 * (0–20s): a cubic Bézier in from 200u out on the anti-sun side, arriving
 * tangent to the orbit. Orbit (20–35s): a circle of radius R. Depart (35s+):
 * accelerating along the exit tangent with a climb, past the hide distance.
 */
export function convoyOffsetAt(out: Vec3, p: ConvoyPlan, t: number): Vec3 {
  const R = p.R;
  if (t < CONVOY_APPROACH_S) {
    const s = Math.max(0, t) / CONVOY_APPROACH_S, m = 1 - s;
    const b0 = m * m * m, b1 = 3 * m * m * s, b2 = 3 * m * s * s, b3 = s * s * s;
    // P0 = 200u + 40w, P1 = 110u, P2 = 2R u + R v, P3 = R v
    const cu = b0 * 200 + b1 * 110 + b2 * 2 * R, cv = (b2 + b3) * R, cw = b0 * 40;
    out.x = p.ux * cu + p.vx * cv + p.wx * cw;
    out.y = p.uy * cu + p.vy * cv + p.wy * cw;
    out.z = p.uz * cu + p.vz * cv + p.wz * cw;
    return out;
  }
  const orbitT = Math.min(t - CONVOY_APPROACH_S, CONVOY_ORBIT_S);
  const th = CONVOY_OMEGA * orbitT;
  // Circle R(v cos θ − u sin θ): starts at R v heading −u, the Bézier's end tangent.
  const cv = R * Math.cos(th), cu = -R * Math.sin(th);
  out.x = p.vx * cv + p.ux * cu; out.y = p.vy * cv + p.uy * cu; out.z = p.vz * cv + p.uz * cu;
  const tau = t - CONVOY_APPROACH_S - CONVOY_ORBIT_S;
  if (tau <= 0) return out;
  // Exit tangent (−v sin θ − u cos θ), accelerating, plus a climb along w.
  const tv = -Math.sin(th), tu = -Math.cos(th);
  const along = R * CONVOY_OMEGA * tau + 12 * tau * tau, climb = 4 * tau * tau;
  out.x += (p.vx * tv + p.ux * tu) * along + p.wx * climb;
  out.y += (p.vy * tv + p.uy * tu) * along + p.wy * climb;
  out.z += (p.vz * tv + p.uz * tu) * along + p.wz * climb;
  return out;
}

const ahead = { x: 0, y: 0, z: 0 };

/** Ship `slot`'s offset: 0 is the lead; 1 and 2 sit behind it, left and right, in a V. */
export function convoyShipOffsetAt(out: Vec3, p: ConvoyPlan, t: number, slot: 0 | 1 | 2): Vec3 {
  convoyOffsetAt(out, p, t);
  if (slot === 0) return out;
  convoyOffsetAt(ahead, p, t + 0.05);
  let fx = ahead.x - out.x, fy = ahead.y - out.y, fz = ahead.z - out.z;
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  // side = forward × w (w is roughly "up" for the convoy's plane), normalised
  let sx = fy * p.wz - fz * p.wy, sy = fz * p.wx - fx * p.wz, sz = fx * p.wy - fy * p.wx;
  const sl = Math.hypot(sx, sy, sz);
  if (sl < 1e-6) { sx = p.vx; sy = p.vy; sz = p.vz; } else { sx /= sl; sy /= sl; sz /= sl; }
  const side = slot === 1 ? -1 : 1;
  out.x += -fx * CONVOY_SPACING + sx * CONVOY_SPACING * side;
  out.y += -fy * CONVOY_SPACING + sy * CONVOY_SPACING * side;
  out.z += -fz * CONVOY_SPACING + sz * CONVOY_SPACING * side;
  return out;
}

/**
 * A convoy frame for a planet at `planetPos` (sun at the origin), trying eight
 * orbit-entry angles until `isClear` accepts one. Null if none does.
 */
export function planConvoy(planetPos: Vec3, planetSize: number, isClear: (plan: ConvoyPlan) => boolean): ConvoyPlan | null {
  const ul = Math.hypot(planetPos.x, planetPos.y, planetPos.z) || 1;
  const ux = planetPos.x / ul, uy = planetPos.y / ul, uz = planetPos.z / ul;
  // Base perpendicular: u × up, falling back to a z-x choice for a polar planet.
  let ax = -uz, ay = 0, az = ux;
  if (Math.hypot(ax, ay, az) < 1e-6) { ax = 0; ay = uz; az = -uy; }
  const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
  const bx = uy * az - uz * ay, by = uz * ax - ux * az, bz = ux * ay - uy * ax; // u × a
  for (let k = 0; k < 8; k++) {
    const ang = (k * Math.PI) / 4, c = Math.cos(ang), s = Math.sin(ang);
    const vx = ax * c + bx * s, vy = ay * c + by * s, vz = az * c + bz * s;
    const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
    const plan = { ux, uy, uz, vx, vy, vz, wx, wy, wz, R: CONVOY_ORBIT_FACTOR * planetSize };
    if (isClear(plan)) return plan;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/worldEvents.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/worldEvents.ts tests/worldEvents.test.ts
git commit -m "feat(events): flare envelope, comet pass line and convoy path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Store, radio lines and the director component

**Files:**
- **Modify:** `src/store/spaceStore.ts`, `src/data/chatterLines.ts`, `src/debug/bridge.ts`, `src/components/canvas/GlobalCanvas.tsx`, `tests/spaceStore.test.ts`.
- **Create:** `src/components/canvas/WorldEventDirector.tsx`.
- **Test:** `tests/worldEventStore.test.ts`.

**Interfaces:**
- **Consumes:** Tasks 1–2; `RADIO_BUSY_S` from `src/utils/cargoReaction.ts`; `gameTime`, `ambientTime`; `orbitPosition`.
- **Produces:**
  - `interface WorldEventState { kind: WorldEventKind; id: number; startedAt: number; comet?: CometPass; convoy?: { planet: string; plan: ConvoyPlan } }`.
  - **Store:** `worldEvent: WorldEventState | null`; `startWorldEvent(ev, line)`; `endWorldEvent()`.
  - **From `spaceStore.ts`:** `export const worldClock = { now: 0 }` and `worldEventElapsed(kind): number | null`.
  - **From `chatterLines.ts`:** `eventLines`.
  - **Debug:** `fitzDebug.triggerEvent: ((kind: WorldEventKind) => void) | null`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/worldEventStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useSpaceStore, worldClock, worldEventElapsed } from "../src/store/spaceStore";
import { eventLines } from "../src/data/chatterLines";
import { planets } from "../src/constants";

beforeEach(() => { useSpaceStore.setState({ worldEvent: null, broadcast: null }); worldClock.now = 0; });

describe("world event store", () => {
  it("startWorldEvent sets the event and broadcasts its line", () => {
    useSpaceStore.getState().startWorldEvent({ kind: "flare", id: 1, startedAt: 10 }, "FLARE LINE");
    expect(useSpaceStore.getState().worldEvent?.kind).toBe("flare");
    expect(useSpaceStore.getState().broadcast?.text).toBe("FLARE LINE");
  });
  it("worldEventElapsed reads the world clock for the matching kind only", () => {
    useSpaceStore.getState().startWorldEvent({ kind: "flare", id: 1, startedAt: 10 }, "x");
    worldClock.now = 14.5;
    expect(worldEventElapsed("flare")).toBe(4.5);
    expect(worldEventElapsed("comet")).toBeNull();
  });
  it("endWorldEvent clears it", () => {
    useSpaceStore.getState().startWorldEvent({ kind: "comet", id: 2, startedAt: 0 }, "x");
    useSpaceStore.getState().endWorldEvent();
    expect(useSpaceStore.getState().worldEvent).toBeNull();
    expect(worldEventElapsed("comet")).toBeNull();
  });
  it("has radio lines for every event and every planet's convoy", () => {
    expect(eventLines.comet.length).toBeGreaterThan(0);
    expect(eventLines.flare.length).toBeGreaterThan(0);
    for (const p of planets) expect(eventLines.convoy[p.name]?.length, p.name).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/worldEventStore.test.ts`
Expected: FAIL (`worldClock`, `worldEventElapsed` and `eventLines` are not exported).

- [ ] **Step 3: Implement the store, lines and bridge**

In `src/store/spaceStore.ts`:

- Add type imports: `import type { WorldEventKind } from "../utils/eventDirector";` and `import type { CometPass, ConvoyPlan } from "../utils/worldEvents";`.
- Before the `SpaceState` interface, add:

  ```ts
  /** The running world event (docs/superpowers/specs/2026-10-12-world-events-design.md). */
  export interface WorldEventState {
    kind: WorldEventKind;
    id: number;
    /** Director clock (flying seconds) at start; compare with worldClock.now. */
    startedAt: number;
    comet?: CometPass;
    convoy?: { planet: string; plan: ConvoyPlan };
  }
  ```

- In `SpaceState`, add `worldEvent: WorldEventState | null;` after `pendingLowPerf`. Among the actions, add `startWorldEvent: (ev: WorldEventState, line: string) => void;` and `endWorldEvent: () => void;`.
- In the initial state, add `worldEvent: null,`. Among the action implementations, add:

  ```ts
      startWorldEvent: (ev, line) => {
        set({ worldEvent: ev });
        get().sendBroadcast(line);
      },
      endWorldEvent: () => { if (get().worldEvent) set({ worldEvent: null }); },
  ```

- At the end of the file, after `useSpaceStore` and `selectSceneFrozen`, add:

  ```ts
  /**
   * The world-event director's clock (flying seconds), written once per frame by
   * WorldEventDirector. Mutable outside React, like `flight`, so event
   * animations read it per frame without a subscription.
   */
  export const worldClock = { now: 0 };

  /** Seconds since the running event of `kind` started, or null if none is running. */
  export function worldEventElapsed(kind: WorldEventKind): number | null {
    const ev = useSpaceStore.getState().worldEvent;
    return ev && ev.kind === kind ? worldClock.now - ev.startedAt : null;
  }
  ```

In `tests/spaceStore.test.ts`, add `worldEvent: null,` to the `beforeEach` `setState`.

In `src/data/chatterLines.ts`, append:

```ts
/** World-event announcements (WorldEventDirector). Convoy lines are keyed by planet id. */
export const eventLines: { comet: string[]; flare: string[]; convoy: Record<string, string[]> } = {
  comet: [
    "INTERSTELLAR VISITOR INBOUND // CLOSEST PASS 35U. WAVE",
    "UNSCHEDULED COMET ON APPROACH. IT DID NOT BOOK A MEETING",
    "ROGUE COMET CROSSING YOUR BOW. TAIL LENGTH: EXCESSIVE",
  ],
  flare: [
    "SOLAR FLARE // HULL TEMP RISING. THE PILOT WEARS SUNSCREEN",
    "STAR ACTIVITY SPIKE. SHIELDS 100%. DIGNITY 80%",
    "FLARE IN PROGRESS. PLEASE DO NOT STARE DIRECTLY AT THE PORTFOLIO",
  ],
  convoy: {
    ruangrapi: [
      "CONVOY 7 INBOUND TO RUANGRAPI // CARGO: NEW TENANTS",
      "RUANGRAPI DELIVERY RUN // 40 LEASES, SIGNED AND SEALED",
    ],
    portfolio: [
      "CONVOY 3 INBOUND TO THIS FLIGHT-SIM CV // CARGO: FRESH SHADERS",
      "PORTFOLIO RESUPPLY // MORE POLYGONS, AS REQUESTED",
    ],
    fuxx: [
      "CONVOY 9 INBOUND TO FUXX // CARGO: IDLE AI AGENTS",
      "FUXX SUPPLY DROP // TERMINAL SESSIONS, STILL WARM",
    ],
  },
};
```

In `src/debug/bridge.ts`:
- Add `import type { WorldEventKind } from "../utils/eventDirector";`.
- Add to the interface: `/** Starts a world event now (dev only), registered by WorldEventDirector. */ triggerEvent: ((kind: WorldEventKind) => void) | null;`.
- Add `triggerEvent: null,` to the object.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/worldEventStore.test.ts tests/spaceStore.test.ts && npx tsc -b`
Expected: PASS; `tsc` prints nothing.

- [ ] **Step 5: Create the director component**

```tsx
// src/components/canvas/WorldEventDirector.tsx
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useSpaceStore, flight, bodies, worldClock, selectSceneFrozen, type WorldEventState } from "../../store/spaceStore";
import { planets, SUN_RADIUS } from "../../constants";
import { createDirector, stepDirector, endEvent, forceStart, type WorldEventKind, type ActiveEvent } from "../../utils/eventDirector";
import { planCometPass, planConvoy, convoyShipOffsetAt, type Sphere } from "../../utils/worldEvents";
import { RADIO_BUSY_S } from "../../utils/cargoReaction";
import { gameTime, ambientTime } from "../../utils/ambientTime";
import { orbitPosition } from "../../utils/orbits";
import { eventLines } from "../../data/chatterLines";
import { fitzDebug } from "../../debug/bridge";

/** Planets drift ≤ ~1.8u/s, so a 25s comet pass pads each planet by this much. */
const COMET_PLANET_PAD = 4 + 1.8 * 25;
const pick = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)];

/**
 * Turns a director start into a stored event with its target, or null when no
 * clear route exists (the event is then skipped and the next is scheduled).
 * Comet: a line past the player's current position, clear of the sun and of
 * every planet padded for its drift. Convoy: the planet nearest the player,
 * on an approach that clears the other planets and the sun at their positions
 * through the next 40s.
 */
function planEvent(ev: ActiveEvent, ambientNow: number): { state: WorldEventState; line: string } | null {
  const base = { kind: ev.kind, id: ev.id, startedAt: ev.startedAt };
  if (ev.kind === "flare") return { state: base, line: pick(eventLines.flare) };

  if (ev.kind === "comet") {
    const avoid: Sphere[] = [
      { x: 0, y: 0, z: 0, r: SUN_RADIUS + 6 },
      ...planets.map((p) => ({ ...bodies[p.name], r: p.size + COMET_PLANET_PAD })),
    ];
    const comet = planCometPass(flight, avoid, Math.random);
    return comet ? { state: { ...base, comet }, line: pick(eventLines.comet) } : null;
  }

  // convoy: the nearest planet
  let target = planets[0];
  let best = Infinity;
  for (const p of planets) {
    const b = bodies[p.name];
    const d = Math.hypot(b.x - flight.x, b.y - flight.y, b.z - flight.z);
    if (d < best) { best = d; target = p; }
  }
  const off = { x: 0, y: 0, z: 0 };
  const plan = planConvoy(bodies[target.name], target.size, (candidate) => {
    for (let t = 0; t <= 40; t += 0.5) {
      const c = orbitPosition(target.orbit, ambientNow + t);
      for (const slot of [0, 1, 2] as const) {
        convoyShipOffsetAt(off, candidate, t, slot);
        const x = c.x + off.x, y = c.y + off.y, z = c.z + off.z;
        if (Math.hypot(x, y, z) < SUN_RADIUS + 10) return false;
        for (const p of planets) {
          if (p.name === target.name) continue;
          const q = orbitPosition(p.orbit, ambientNow + t);
          if (Math.hypot(x - q.x, y - q.y, z - q.z) < p.size + 6) return false;
        }
      }
    }
    return true;
  });
  return plan
    ? { state: { ...base, convoy: { planet: target.name, plan } }, line: pick(eventLines.convoy[target.name] ?? eventLines.flare) }
    : null;
}

/** Steps the world-event director each frame and publishes its events to the store. */
export default function WorldEventDirector() {
  const director = useMemo(() => createDirector(Math.random), []);
  const lastBroadcast = useRef({ id: 0, at: -Infinity });
  const forced = useRef<WorldEventKind | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    fitzDebug.triggerEvent = (kind) => { forced.current = kind; };
    return () => { fitzDebug.triggerEvent = null; };
  }, []);
  // Unmounting (the classic-résumé round trip) must not leave an event behind.
  useEffect(() => () => useSpaceStore.getState().endWorldEvent(), []);

  useFrame((state, delta) => {
    // Scheduling clock, not motion: capped at 0.25s rather than 0.05 so slow
    // devices don't run it at a fraction of real time (see plan constraints).
    const dt = Math.min(delta, 0.25);
    const elapsed = state.clock.getElapsedTime();
    const now = gameTime(elapsed);
    const s = useSpaceStore.getState();
    const bid = s.broadcast?.id ?? 0;
    if (bid !== lastBroadcast.current.id) lastBroadcast.current = { id: bid, at: now };

    let step;
    if (forced.current) {
      step = forceStart(director, forced.current);
      forced.current = null;
    } else {
      step = stepDirector(director, {
        dt,
        paused: selectSceneFrozen(s) || s.photoMode || s.showClassicCV,
        raceRunning: s.race.phase === "running",
        radioBusy: now - lastBroadcast.current.at < RADIO_BUSY_S,
        reducedMotion: s.reducedMotion,
      });
    }
    worldClock.now = director.clock;

    if (step.ended) s.endWorldEvent();
    if (step.started) {
      const planned = planEvent(step.started, ambientTime(elapsed));
      if (planned) s.startWorldEvent(planned.state, planned.line);
      else endEvent(director); // no clear route this time: skip it, schedule the next
    }
  });

  return null;
}
```

In `src/components/canvas/GlobalCanvas.tsx`, add `import WorldEventDirector from "./WorldEventDirector";` and mount `<WorldEventDirector />` immediately before `{/* Spaceship craft */}`.

- [ ] **Step 6: Type-check and run all tests**

Run: `npx tsc -b && npx vitest run`
Expected: `tsc` prints nothing; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/store/spaceStore.ts src/data/chatterLines.ts src/debug/bridge.ts src/components/canvas/WorldEventDirector.tsx src/components/canvas/GlobalCanvas.tsx tests/worldEventStore.test.ts tests/spaceStore.test.ts
git commit -m "feat(events): store, radio lines and the director component

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Solar flare visuals

**Files:** Modify `src/components/canvas/Sun.tsx`, `src/components/canvas/GlobalCanvas.tsx`, `src/components/canvas/PostFX.tsx`.

**Interfaces:** Consumes `worldEventElapsed` (Task 3) and `flareLevel` (Task 2, already tested).

- [ ] **Step 1: Drive the sun**

In `src/components/canvas/Sun.tsx`, import `worldEventElapsed` (add it to the `spaceStore` import) and `flareLevel` from `../../utils/worldEvents`. In `useFrame`, replace `surfaceMaterial.uniforms.uHeat.value = 0.5 + 0.5 * Math.sin(t * 0.9);` with:

```ts
    // A world-event flare swells the heat and the corona (spec: slow, two peaks 6s apart).
    const flare = flareLevel(worldEventElapsed("flare"));
    surfaceMaterial.uniforms.uHeat.value = 0.5 + 0.5 * Math.sin(t * 0.9) + 0.6 * flare;
```

After `if (coronaRef.current) coronaRef.current.quaternion.copy(state.camera.quaternion);`, add:

```ts
    if (coronaRef.current) coronaRef.current.scale.setScalar(1 + 0.6 * flare);
```

- [ ] **Step 2: Drive the sun light**

In `src/components/canvas/GlobalCanvas.tsx`, add `worldEventElapsed` to the `spaceStore` import, and import `flareLevel` from `../../utils/worldEvents`. Add above `GlobalCanvas`:

```tsx
/** The scene's one sun light; a world-event flare lifts it 2.1 → 3.2 (no new light). */
function SunLight() {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(() => {
    if (ref.current) ref.current.intensity = 2.1 + 1.1 * flareLevel(worldEventElapsed("flare"));
  });
  return <pointLight ref={ref} position={[0, 0, 0]} intensity={2.1} decay={0} color="#fff4e0" />;
}
```

Replace `<pointLight position={[0, 0, 0]} intensity={2.1} decay={0} color="#fff4e0" />` with `<SunLight />`, keeping the comment above it.

- [ ] **Step 3: Drive the god rays**

In `src/components/canvas/PostFX.tsx`, add `worldEventElapsed` to the `spaceStore` import, and import `flareLevel` from `../../utils/worldEvents`. In `useGodRaysOcclusion`, replace the exposure assignment with:

```ts
    const flare = flareLevel(worldEventElapsed("flare"));
    e.godRaysMaterial.exposure = GODRAYS_EXPOSURE * (1 + 0.5 * flare) * sunVisibility(camera.position, OCCLUDERS, SUN_RADIUS);
```

- [ ] **Step 4: Type-check, test, and check live**

Run: `npx tsc -b && npx vitest run`
Expected: clean; all tests pass.

Live: run `npx vite --port 5179 --strictPort`, then in the console `window.__fitz.triggerEvent("flare")`. Expected: a flare line on the radio; the sun brightens and its corona grows and shrinks twice over about 12s, then returns to normal.

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/Sun.tsx src/components/canvas/GlobalCanvas.tsx src/components/canvas/PostFX.tsx
git commit -m "feat(events): solar flare swells the sun, its light and the god rays

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The visiting comet

**Files:** Modify `src/components/canvas/Comets.tsx`.

**Interfaces:**
- **Consumes:** `worldEventElapsed` and `worldEvent.comet` (Task 3); `cometPassAt` (Task 2); `removeScannable`.
- **Produces:** a scene group `"CometVisitor"` and the scannable `"comet_visitor"` (label `"COMET_VISITOR"`).

- [ ] **Step 1: Generalise the comet slots**

In `src/components/canvas/Comets.tsx`:

- Add `removeScannable` to the `scannables` import, `worldEventElapsed` to the `spaceStore` import, and `import { cometPassAt } from "../../utils/worldEvents";`.
- Below the `COMETS` constant, add:

  ```ts
  /** Slot COMETS.length is the world-event visitor (spec: comet close pass); hidden while idle. */
  const VISITOR = COMETS.length;
  const SLOTS = COMETS.length + 1;
  ```

- In the component:
  - Change the `headRefs`, `comaRefs`, `ionRefs` and `dustRefs` initialisers from `[null, null]` to `Array(SLOTS).fill(null)`.
  - Add `const groupRefs = useRef<(THREE.Group | null)[]>(Array(SLOTS).fill(null));`.
  - In the `comaMaterials`, `ions` and `dusts` `useMemo`s, replace `COMETS.map(` with `Array.from({ length: SLOTS }, ` and keep each callback body.

- [ ] **Step 2: Route positions through one function**

In `useFrame`, keep `const store = useSpaceStore.getState();` and add after it:

```ts
    const visitorElapsed = worldEventElapsed("comet");
    const pass = store.worldEvent?.comet;
    /** Slot `i`'s position at its own time `t` (orbit time, or seconds into the visitor's pass). */
    const posAt = (i: number, t: number, out: THREE.Vector3) => {
      if (i < VISITOR) { const k = keplerPosition(t, COMETS[i]); return out.set(k.x, k.y, k.z); }
      cometPassAt(out, pass!, t);
      return out;
    };
```

Then make these changes inside the loop:

- Replace `COMETS.forEach((c, i) => {` with `for (let i = 0; i < SLOTS; i++) {`, and change its closing `});` to `}`.
- At the top of the loop body, add:

  ```ts
      const isVisitor = i === VISITOR;
      const group = groupRefs.current[i];
      if (isVisitor && (visitorElapsed === null || !pass)) {
        if (group) group.visible = false;
        removeScannable("comet_visitor");
        continue;
      }
      if (group) group.visible = true;
      const t = isVisitor ? visitorElapsed! : time;
  ```

- Replace `const kp = keplerPosition(time, c);` and `head.set(kp.x, kp.y, kp.z);` with `posAt(i, t, head);`.
- Replace the `setScannable("comet_" + i, ...)` line with:

  ```ts
      if (isVisitor) setScannable("comet_visitor", head.x, head.y, head.z, "COMET_VISITOR");
      else setScannable("comet_" + i, head.x, head.y, head.z, "COMET_" + i);
  ```

- Replace `const act = activityAt(distSun);` with `const act = isVisitor ? 1 : activityAt(distSun); // the visitor stays bright far from the sun`.
- In the dust tail, replace the two lines `const ke = keplerPosition(time - tau, c);` and `emitted.set(ke.x, ke.y, ke.z);` with `posAt(i, t - tau, emitted);`.
- Wrap the proximity block (`const dx = head.x - flight.x;` through `anyNear = true;`) in `if (!isVisitor) { ... }`. The event already announces the visitor, so it must not also trigger the comet chatter.

- [ ] **Step 3: Render all slots**

In the JSX:
- Change `COMETS.map((_, i) => (` to `Array.from({ length: SLOTS }, (_, i) => (`.
- Change `<group key={i}>` to `<group key={i} ref={(g) => { groupRefs.current[i] = g; }} name={i === VISITOR ? "CometVisitor" : undefined} visible={i !== VISITOR}>`.

- [ ] **Step 4: Type-check, test, and check live**

Run: `npx tsc -b && npx vitest run`
Expected: clean; all tests pass.

Live: run `window.__fitz.triggerEvent("comet")`. Expected:
- a comet line on the radio;
- within about 10s, a bright comet streaks past about 35u away, its tail pointing away from the sun;
- it disappears after about 25s.

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/Comets.tsx
git commit -m "feat(events): a visiting comet makes a close pass

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The cargo convoy

**Files:** Modify `src/components/canvas/CargoTraffic.tsx`.

**Interfaces:**
- **Consumes:** `worldEventElapsed` and `worldEvent.convoy` (Task 3); `convoyShipOffsetAt` and `CONVOY_HIDE_DIST` (Task 2); `bodies`.
- **Produces:** scene groups `"ConvoyShip0"` to `"ConvoyShip2"`.

- [ ] **Step 1: Build the convoy ships**

In `CargoTraffic.tsx`:

- Move the body of the `ships` `useMemo` callback (clone, flip, wrapper, nav/engine/dish collection, trailTarget) into a module-level `function buildShip(scene: THREE.Object3D, name: string)`. It sets `group.name = name` and returns `{ group, navMats, engineMats, dish, trailTarget }`.
- Make `ships` use `SHIPS.map((_, i) => buildShip(scene, \`CargoShip${i}\`))`.
- Add:

  ```ts
    const convoy = useMemo(() => [0, 1, 2].map((i) => {
      const s = buildShip(scene, `ConvoyShip${i}`);
      s.group.visible = false; // hidden until a convoy event; never flashes at the origin
      return s;
    }), [scene]);
  ```

- Add `bodies` and `worldEventElapsed` to the `spaceStore` import. Import `convoyShipOffsetAt` and `CONVOY_HIDE_DIST` from `../../utils/worldEvents`.
- Add module scratch: `const convoyOff = new THREE.Vector3(); const convoyAhead = new THREE.Vector3();`.

- [ ] **Step 2: Fly the convoy**

At the end of `useFrame`, after the route-ships loop, add:

```ts
    // World-event convoy: a planet-relative V formation riding the target's live position.
    const convoyElapsed = worldEventElapsed("convoy");
    const convoyEv = store.worldEvent?.convoy;
    const convoyCount = isLowPerf ? 1 : 3;
    for (let k = 0; k < convoy.length; k++) {
      const ship = convoy[k];
      if (convoyElapsed === null || !convoyEv || k >= convoyCount) { ship.group.visible = false; continue; }
      const c = bodies[convoyEv.planet];
      const slot = k as 0 | 1 | 2;
      convoyShipOffsetAt(convoyOff, convoyEv.plan, convoyElapsed, slot);
      if (convoyOff.length() > CONVOY_HIDE_DIST) { ship.group.visible = false; continue; }
      ship.group.visible = true;
      ship.group.position.set(c.x + convoyOff.x, c.y + convoyOff.y, c.z + convoyOff.z);
      convoyShipOffsetAt(convoyAhead, convoyEv.plan, convoyElapsed + 0.1, slot);
      lookTarget.set(c.x + convoyAhead.x, c.y + convoyAhead.y, c.z + convoyAhead.z);
      ship.group.lookAt(lookTarget);
      const blink = Math.sin(time * 3 + k * 1.7) > 0.82 ? 4.5 : 0.3;
      for (const m of ship.navMats) m.emissiveIntensity = blink;
      const burn = 2.6 + Math.sin(time * 7.3 + k * 2.3) * 0.6;
      for (const m of ship.engineMats) m.emissiveIntensity = burn;
    }
```

- [ ] **Step 3: Render the convoy**

In the JSX, after the route ships, add:

```tsx
      {convoy.map((s, i) => (
        <primitive key={`c${i}`} object={s.group} scale={1.6} />
      ))}
```

- [ ] **Step 4: Type-check, test, and check live**

Run: `npx tsc -b && npx vitest run`
Expected: clean; all tests pass.

Live: press `1`, then `Esc`, then run `window.__fitz.triggerEvent("convoy")`. Expected:
- "CONVOY ... INBOUND TO RUANGRAPI" on the radio;
- three ships fly in as a V, circle at about twice the planet's size for about 15s, then climb away;
- your ship is not locked into orbit by them.

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/CargoTraffic.tsx
git commit -m "feat(events): a cargo convoy delivers to the nearest planet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: End-to-end probe and full verification

**Files:** Create `tests/e2e/events.probe.mjs`; modify `tests/e2e/run.mjs`.

**Interfaces — Consumes:**
- `fitzDebug.triggerEvent`, `store.worldEvent`, `bodies`.
- Scene objects `CometVisitor`, `SunCorona`, `ConvoyShip0`.
- `eventLines`, via a dynamic import.
- `pollUntil`, which returns `{ ok, value }`.

- [ ] **Step 1: Write the probe**

```js
// tests/e2e/events.probe.mjs
import { withPage, settle, readStore, pollUntil } from "./harness.mjs";

const trigger = (page, kind) => page.evaluate((k) => window.__fitz.triggerEvent(k), kind);
const lines = (page) => page.evaluate(async () => (await import("/src/data/chatterLines.ts")).eventLines);

async function events(page, checks) {
  const L = await lines(page);

  // ---- the director starts one on its own ----
  const auto = (await pollUntil(async () => (await readStore(page)).worldEvent, { timeoutMs: 55_000 })).value;
  checks.check("an event starts on its own within ~50s of the scene being ready", !!auto, auto ? `kind=${auto.kind}` : "none");

  // ---- comet: passes close ----
  await trigger(page, "comet");
  await settle(page, 300);
  const cometLine = (await readStore(page)).broadcast?.text;
  checks.check("the comet event announces itself", L.comet.includes(cometLine), `broadcast=${cometLine}`);
  let closest = Infinity;
  for (let k = 0; k < 60; k++) {
    const d = await page.evaluate(() => {
      const g = window.__fitz.scene.getObjectByName("CometVisitor");
      const f = window.__fitz.flight;
      if (!g || !g.visible) return Infinity;
      const head = g.children[0].position; // the nucleus mesh carries the world position
      return Math.hypot(head.x - f.x, head.y - f.y, head.z - f.z);
    });
    closest = Math.min(closest, d);
    await settle(page, 400);
  }
  checks.check("the visiting comet passes within ~40u of the ship", closest < 40, `closest=${closest.toFixed(1)}`);

  // ---- flare: corona swells and settles ----
  await trigger(page, "flare");
  let peak = 1;
  for (let k = 0; k < 30; k++) {
    const s = await page.evaluate(() => window.__fitz.scene.getObjectByName("SunCorona")?.scale.x ?? 1);
    peak = Math.max(peak, s);
    await settle(page, 200);
  }
  checks.check("a flare swells the sun's corona", peak > 1.3, `peak scale=${peak.toFixed(2)}`);
  await settle(page, 7000);
  const after = await page.evaluate(() => window.__fitz.scene.getObjectByName("SunCorona")?.scale.x ?? 1);
  checks.check("the corona settles back after the flare", Math.abs(after - 1) < 0.02, `scale=${after.toFixed(3)}`);

  // ---- convoy: reaches its orbit around the nearest planet ----
  await trigger(page, "convoy");
  await settle(page, 300);
  const ev = (await readStore(page)).worldEvent;
  checks.check("the convoy targets a planet", ev?.kind === "convoy" && !!ev.convoy?.planet, `planet=${ev?.convoy?.planet}`);
  const orbiting = (await pollUntil(async () => {
    const r = await page.evaluate((name) => {
      const g = window.__fitz.scene.getObjectByName("ConvoyShip0");
      const b = window.__fitz.bodies[name];
      if (!g || !g.visible) return null;
      return Math.hypot(g.position.x - b.x, g.position.y - b.y, g.position.z - b.z);
    }, ev.convoy.planet);
    return r !== null && Math.abs(r - 16 * 2.2) < 3 ? r : null;
  }, { timeoutMs: 30_000 })).value;
  checks.check("the convoy settles into orbit at ~2.2x the planet's size", !!orbiting,
    orbiting ? `radius=${orbiting.toFixed(1)}` : "never reached orbit");
}

async function quietUnderReducedMotion(page, checks) {
  const started = (await pollUntil(async () => (await readStore(page)).worldEvent, { timeoutMs: 55_000 })).ok;
  checks.check("reduced motion: no world event starts", !started);
}

export default async function run() {
  const checks = await withPage({ label: "events" }, events);
  const rm = await withPage({ label: "events (reduced motion)", emulateReducedMotion: true }, quietUnderReducedMotion);
  checks.results.push(...rm.results);
  return checks;
}
```

- [ ] **Step 2: Register the probe and run it**

In `tests/e2e/run.mjs`, add `"events"` to `PROBES` after `"reactions"`. Close any browser tab rendering the app, then run `node tests/e2e/run.mjs events`.
Expected: all checks pass.

- [ ] **Step 3: Run everything**

Run: `npx tsc -b && npx oxlint && npx vitest run && npm run test:e2e`
Expected:
- `tsc` is clean;
- `oxlint` shows only the existing `Atmosphere.tsx` warning;
- all unit tests pass;
- the e2e suite passes, with `perf` and `transition` still at programs 79/79 and draw calls within their ceilings.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/events.probe.mjs tests/e2e/run.mjs
git commit -m "test(e2e): world events start, play and stay quiet under reduced motion

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
