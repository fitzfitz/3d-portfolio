# Refuel Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A crystal pickup that lifts the tank out of low tells the visitor so, closing the loop the DRY message opens — without adding a chatter line to every pickup.

**Architecture:** The trigger is a pure function `refuelOutcome(before)` in `src/utils/fuel.ts`, unit-tested at its boundaries with no scene. `FuelCrystals` switches on its result inside the existing pickup branch. The "low" threshold is promoted to a single exported constant so the HUD gauge's amber point and the confirmation point can never drift apart.

**Tech Stack:** TypeScript, React 19, @react-three/fiber, zustand, vitest (unit), puppeteer-core via a homegrown probe harness (e2e).

**Design spec:** `docs/superpowers/specs/2026-07-31-refuel-confirmation-design.md`

**Branch:** `refuel-confirmation` (already created, spec already committed there as `ab6886d`).

## Global Constraints

- **Zero React renders during steady flight.** Never introduce a per-frame `set()` on the zustand store. `sendBroadcast` on a discrete pickup event is fine — `DataShards.tsx:84` already does exactly this per shard. Verified by `tests/e2e/perf.probe.mjs` asserting `commits=0`.
- **`FUEL_LOW` and `FUEL_PER_CRYSTAL` are independent numbers that happen to both be 25.** Never write a test or an expression that couples them. One means "when does the tank read as low", the other means "how much does a crystal restore".
- **Exact message strings**, copied verbatim, no rewording:
  - `restored` → `` `WARP CORE RECHARGED // ${pct}% — WARP ONLINE` ``
  - `topped-up` → `` `FUEL CRYSTAL ABSORBED // ${pct}%` ``
  - `vented` → `"FUEL CRYSTAL VENTED // TANK ALREADY FULL"` (already exists, do not touch)
  - The `—` in the `restored` line is an em dash (U+2014), matching the existing DRY line.
- **The percentage uses the gauge's own expression**, `(pct * 100).toFixed(0)` where `pct = flight.fuel / FUEL_MAX` — not `Math.round`. The spec requires the message to match the gauge, so it must be the same formula, not an equivalent one.
- **Do not weaken any existing assertion.** If a probe trips, fix the cause or control the probe's world state; never widen a bound or delete a check.
- **Lint baseline:** `npm run lint` shows exactly two long-standing warnings — `Atmosphere.tsx:54` (`react-hooks/exhaustive-deps`) and `Scanner.tsx:9` (`react/only-export-components`). Any third warning is a regression you introduced.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/utils/fuel.ts` | Modify | Add `FUEL_LOW`, `RefuelOutcome`, `refuelOutcome`. The single home for fuel tuning and fuel rules. |
| `tests/fuel.test.ts` | Modify | Pin every boundary of `refuelOutcome`; scan `HUDOverlay` for the retired literal. |
| `src/components/layout/HUDOverlay.tsx` | Modify (line 62) | Gauge reads the shared threshold instead of a bare `0.25`. |
| `src/components/canvas/FuelCrystals.tsx` | Modify (line 133) | Switch the pickup branch on `refuelOutcome`. |
| `tests/e2e/harness.mjs` | Modify | Promote `chatterText` to a shared helper (two probes need it now). |
| `tests/e2e/gameplay.probe.mjs` | Modify (lines 16-26) | Import the shared `chatterText` instead of defining it locally. |
| `tests/e2e/fuel.probe.mjs` | Modify | Assert the `restored` line reaches the chatter DOM; comment the relocation-ordering hazard. |
| `docs/superpowers/plans/2026-07-31-refuel-confirmation.md` | Modify | Verification record (Task 4). |

---

## Task 1: The rule as a pure function

**Files:**
- Modify: `src/utils/fuel.ts`
- Test: `tests/fuel.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Existing exports in `src/utils/fuel.ts`: `FUEL_MAX = 100`, `FUEL_DRAIN_PER_SEC = 8`, `FUEL_PER_CRYSTAL = 25`, `drainFuel(fuel, dt)`, `refuel(fuel)`.
- Produces:
  - `export const FUEL_LOW: number` (value `25`)
  - `export type RefuelOutcome = "vented" | "restored" | "topped-up" | "quiet"`
  - `export function refuelOutcome(before: number): RefuelOutcome`

  Tasks 2 and 3 rely on these exact names and on the exact string values of the four outcomes.

- [ ] **Step 1: Write the failing tests**

Append to `tests/fuel.test.ts`. Also extend the existing import on line 2 to pull in the new symbols, and add the two `node:` imports at the top of the file for the source scan:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
```

Line 2 becomes:

```ts
import { FUEL_MAX, FUEL_DRAIN_PER_SEC, FUEL_PER_CRYSTAL, FUEL_LOW, drainFuel, refuel, refuelOutcome } from "../src/utils/fuel";
```

Then append this block at the end of the file:

```ts
describe("refuelOutcome", () => {
  it("announces a restoration only from a genuinely dry tank", () => {
    expect(refuelOutcome(0)).toBe("restored");
  });

  it("acknowledges a low-but-not-dry pickup without claiming warp came back", () => {
    // Warp was never offline here, so this must NOT be "restored" — the
    // "WARP ONLINE" copy would be stating something untrue.
    expect(refuelOutcome(0.1)).toBe("topped-up");
    expect(refuelOutcome(FUEL_LOW - 0.1)).toBe("topped-up");
  });

  it("is quiet at exactly FUEL_LOW — the boundary comparison is strict", () => {
    expect(refuelOutcome(FUEL_LOW)).toBe("quiet");
  });

  it("is quiet on a healthy tank, so crossing a crystal field cannot stomp the ticker", () => {
    // This is the whole point of the feature: RadioChatter's typeLine
    // interrupts, so a line per pickup would machine-gun the HUD across 40
    // respawning crystals.
    expect(refuelOutcome(50)).toBe("quiet");
    expect(refuelOutcome(FUEL_MAX - 1)).toBe("quiet");
  });

  it("keeps the pre-existing vented case at a full tank", () => {
    expect(refuelOutcome(FUEL_MAX)).toBe("vented");
  });

  it("treats a negative tank as dry rather than falling through to quiet", () => {
    // drainFuel clamps at 0, so this should be unreachable. If it ever does
    // happen, saying something correct beats silently saying nothing.
    expect(refuelOutcome(-1)).toBe("restored");
  });

  it("does not couple the low threshold to the crystal's refuel amount", () => {
    // FUEL_LOW and FUEL_PER_CRYSTAL are both 25 today by coincidence, not by
    // relationship: one is "when does the tank read as low", the other is
    // "how much does a crystal restore". This test exists to state that in
    // writing — retuning one must not be expected to move the other.
    expect(FUEL_LOW).toBe(25);
    expect(FUEL_PER_CRYSTAL).toBe(25);
  });
});

describe("the low threshold has exactly one home", () => {
  it("HUDOverlay reads FUEL_LOW instead of a bare 0.25", () => {
    // Source scan, same convention as tests/identity.test.ts: the gauge's
    // amber point and the pickup's announce point are the same boundary, and
    // a duplicated literal is how they would silently drift apart.
    const src = readFileSync(join("src", "components", "layout", "HUDOverlay.tsx"), "utf8");
    expect(src).toContain("FUEL_LOW");
    expect(src).not.toMatch(/pct < 0\.25/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- fuel`

Expected: FAIL. The `refuelOutcome` block fails to import (`FUEL_LOW`/`refuelOutcome` are not exported yet), and the source-scan test fails on `expect(src).toContain("FUEL_LOW")` because `HUDOverlay.tsx` has not been touched yet.

The source-scan failure is expected at this step and is fixed in Task 2, not here. Do not "fix" it by editing `HUDOverlay.tsx` now.

- [ ] **Step 3: Implement `FUEL_LOW` and `refuelOutcome`**

Append to `src/utils/fuel.ts`, after the existing `refuel` function:

```ts
/**
 * Below this the tank reads as "low": the HUD gauge goes amber
 * (HUDOverlay.tsx) and a pickup announces itself (FuelCrystals.tsx). It lives
 * here, exported, so those two can never disagree about where "low" is — a
 * duplicated literal at each site is how the bar would end up going amber at a
 * level where the pickup had gone silent.
 *
 * Deliberately NOT derived from FUEL_PER_CRYSTAL, which shares its value
 * today. They answer different questions and must be retunable apart.
 */
export const FUEL_LOW = 25;

/** What a pickup should announce, given the tank level before it landed. */
export type RefuelOutcome = "vented" | "restored" | "topped-up" | "quiet";

/**
 * Which confirmation a pickup deserves.
 *
 * Only a pickup that lifts the tank out of low speaks. A pickup on a healthy
 * tank stays quiet on purpose: RadioChatter's `typeLine` interrupts whatever
 * is on screen (cancelling the in-progress typewriter, playing a tick, and
 * resetting the ambient timer), so a line per pickup would stomp the ticker
 * while crossing a field of 40 respawning crystals.
 *
 * `restored` and `topped-up` are separate because only one of them turns warp
 * back on. Announcing "WARP ONLINE" on a 10% -> 35% pickup would state
 * something untrue, and this HUD is careful about that distinction — the DRY
 * line goes out of its way to add "THRUSTERS STILL NOMINAL".
 */
export function refuelOutcome(before: number): RefuelOutcome {
  if (before >= FUEL_MAX) return "vented";
  if (before <= 0) return "restored";
  if (before < FUEL_LOW) return "topped-up";
  return "quiet";
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- fuel`

Expected: the whole `refuelOutcome` block PASSES. The `HUDOverlay reads FUEL_LOW instead of a bare 0.25` test still FAILS — that is Task 2's job.

- [ ] **Step 5: Commit**

```bash
git add src/utils/fuel.ts tests/fuel.test.ts
git commit -m "feat: refuelOutcome — which pickups deserve a confirmation

Only a pickup that lifts the tank out of low speaks. typeLine interrupts, so a
line per pickup would stomp the ticker across 40 respawning crystals.

restored and topped-up are distinct because only one of them turns warp back
on: 'WARP ONLINE' on a 10% -> 35% pickup would be untrue.

FUEL_LOW is promoted here rather than duplicated at each call site, so the
gauge's amber point and the announce point cannot drift. It is deliberately not
derived from FUEL_PER_CRYSTAL, which shares its value by coincidence.

The HUDOverlay source-scan test fails until the next commit wires the gauge up."
```

Note: this commit knowingly leaves one test red. If you would rather not commit a red suite, fold Task 2 into this commit — but do not delete or weaken the source-scan test to make it green.

---

## Task 2: Wire both consumers

**Files:**
- Modify: `src/components/layout/HUDOverlay.tsx:6` (import) and `:62` (threshold)
- Modify: `src/components/canvas/FuelCrystals.tsx:11` (import) and `:133` (broadcast branch)
- Test: `tests/fuel.test.ts` (already written in Task 1 — no new test code)

**Interfaces:**
- Consumes: `FUEL_LOW`, `refuelOutcome` from `src/utils/fuel.ts` (Task 1).
- Produces: the four visitor-facing broadcast strings. Task 3's e2e check greps for `WARP CORE RECHARGED`.

- [ ] **Step 1: Point the HUD gauge at the shared threshold**

In `src/components/layout/HUDOverlay.tsx`, change the import on line 6:

```ts
import { FUEL_MAX, FUEL_LOW } from "../../utils/fuel";
```

Then change the gauge colour expression at lines 61-62. Current:

```ts
        fuelFillRef.current.style.backgroundColor =
          pct <= 0 ? "#ef4444" : pct < 0.25 ? "#f59e0b" : "#00ff87";
```

Becomes:

```ts
        fuelFillRef.current.style.backgroundColor =
          pct <= 0 ? "#ef4444" : pct < FUEL_LOW / FUEL_MAX ? "#f59e0b" : "#00ff87";
```

`pct` is a 0-1 fraction and `FUEL_LOW` is in fuel units, hence the division. Leave the surrounding comment ("Amber under a quarter, red when dry…") in place — it is still accurate.

- [ ] **Step 2: Run the source-scan test**

Run: `npm test -- fuel`

Expected: PASS, all of it now — including `HUDOverlay reads FUEL_LOW instead of a bare 0.25`, which was the one red test left by Task 1.

- [ ] **Step 3: Switch the pickup branch on the outcome**

In `src/components/canvas/FuelCrystals.tsx`, extend the import on line 11:

```ts
import { refuel, refuelOutcome, FUEL_MAX } from "../../utils/fuel";
```

Then replace line 133. Current:

```ts
        if (before >= FUEL_MAX) store.sendBroadcast("FUEL CRYSTAL VENTED // TANK ALREADY FULL");
```

Becomes:

```ts
        // Confirm only the pickup that changes the visitor's situation. A
        // healthy-tank top-up stays silent because typeLine interrupts, and a
        // line per pickup would stomp the ticker across a crystal field.
        // Percentage uses the gauge's own expression (HUDOverlay.tsx:66) so the
        // number in the line always matches the number on the bar.
        const pct = ((flight.fuel / FUEL_MAX) * 100).toFixed(0);
        switch (refuelOutcome(before)) {
          case "vented":
            store.sendBroadcast("FUEL CRYSTAL VENTED // TANK ALREADY FULL");
            break;
          case "restored":
            store.sendBroadcast(`WARP CORE RECHARGED // ${pct}% — WARP ONLINE`);
            break;
          case "topped-up":
            store.sendBroadcast(`FUEL CRYSTAL ABSORBED // ${pct}%`);
            break;
          case "quiet":
            break;
        }
```

`FUEL_MAX` stays imported — it is now used by the `pct` expression rather than by the old comparison.

Leave `store.setFuelEmpty(flight.fuel <= 0)` on line 132 exactly where it is, above this block. It must still run first so the `fuelEmpty` true→false edge resets `dryAnnouncedThisSpell` in `HUDOverlay.tsx:85-95`.

- [ ] **Step 4: Verify the build and lint are clean**

Run: `npm run build && npm run lint`

Expected: build succeeds (the pre-existing chunk-size advisory for `index-*.js` is fine and not caused by you). Lint shows exactly the two baseline warnings — `Atmosphere.tsx:54` and `Scanner.tsx:9` — and nothing else.

- [ ] **Step 5: Run the full unit suite**

Run: `npm test`

Expected: all tests pass, **156 total**. The suite measured **148** on `main` immediately before this work (26 files, verified by running it — the "139" in the fuel-and-crystals record is stale, predating the gh-pages-deploy branch). Task 1 adds 8: `refuelOutcome` × 7, source scan × 1.

If you see a different total, report the number rather than adjusting the expectation.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/HUDOverlay.tsx src/components/canvas/FuelCrystals.tsx
git commit -m "feat: confirm a refuel that lifts the tank out of low

The DRY line tells visitors to collect a crystal; obeying it produced a sound
and a moving bar but no acknowledgement. Now it answers, in the same channel
the instruction arrived on.

Two messages, because only one of them restores warp. A healthy-tank top-up
stays silent.

The gauge now reads FUEL_LOW too, so its amber point and the announce point are
one number rather than two literals that could drift."
```

---

## Task 3: Prove it end-to-end

**Files:**
- Modify: `tests/e2e/harness.mjs` (add shared `chatterText`)
- Modify: `tests/e2e/gameplay.probe.mjs:16-26` (import it instead of defining it)
- Modify: `tests/e2e/fuel.probe.mjs` (new check + hazard comment)

**Interfaces:**
- Consumes: the `WARP CORE RECHARGED` string from Task 2.
- Produces: `export const chatterText = (page) => Promise<string | null>` from `tests/e2e/harness.mjs`.

**Context you need about this probe:** `fuel.probe.mjs` lines 114-131 already build the exact scenario this feature targets — the tank is asserted at exactly `0`, then the ship teleports onto an active crystal and the probe asserts `refuelled === 25`. That is a `restored` pickup. The new check goes immediately after it and needs no new setup. Critically, it **relocates no crystals**, so it does not interact with the ordering hazard described in Step 3.

- [ ] **Step 1: Promote `chatterText` into the harness**

Two probes need this reader now, so it moves next to the other shared page-readers (`readStore`, `sceneQuery`). Add to `tests/e2e/harness.mjs`:

```js
/**
 * Reads the RadioChatter HUD line. Most lines (zone/ambient/warp/wrap/comet/
 * altitude/impact) are typed straight into this DOM node by RadioChatter.tsx's
 * `typeLine` and never touch `store.broadcast`; shard pickups
 * (DataShards.tsx), scan reports (Scanner.tsx), the dry-tank warning
 * (HUDOverlay.tsx) and crystal pickups (FuelCrystals.tsx) go through
 * `sendBroadcast`, which RadioChatter subscribes to and also renders here.
 *
 * So this DOM node — not `store.broadcast` — is the only place that sees every
 * line, which is why assertions read it rather than the store.
 *
 * `text-primary/60` is a className unique to this node in the whole component
 * tree (verified via grep), so a substring match is a safe, stable selector.
 */
export const chatterText = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll("div")].find((d) => d.className?.includes?.("text-primary/60"));
  return el ? el.textContent ?? "" : null;
});
```

Then in `tests/e2e/gameplay.probe.mjs`, delete the local `chatterText` definition and its comment block (lines 16-26) and add it to the existing harness import on line 1:

```js
import { withPage, hold, settle, readStore, chatterText } from "./harness.mjs";
```

- [ ] **Step 2: Confirm the move broke nothing**

Run: `npm run test:e2e gameplay`

Expected: the gameplay probe passes with the same number of checks as before the move. If it fails to find the chatter node, the className selector is the thing to check first — not the move.

- [ ] **Step 3: Add the new check and the hazard comment**

In `tests/e2e/fuel.probe.mjs`, add `chatterText` and `pollUntil` to the imports on line 1 (`pollUntil` is already imported; add only `chatterText`):

```js
import { withPage, hold, settle, readStore, pollUntil, chatterText } from "./harness.mjs";
```

Then, inside the existing `if (target) { … }` block (lines 125-131), immediately after the `"touching a crystal refuels"` check, add:

```js
      // The tank was at exactly 0 before this pickup, so it is a `restored`
      // outcome and must say so — this is the line that closes the loop the
      // DRY broadcast opens. Substring, not full string: typeLine types at
      // ~22ms/char (RadioChatter.tsx:26), so the line arrives progressively
      // and "WARP CORE RECHARGED" (19 chars, ~420ms) lands well before the
      // poll's timeout. Polling rather than a single read also means this
      // does not depend on settle() having waited long enough.
      const saidRecharged = await pollUntil(
        async () => ((await chatterText(page)) ?? "").includes("WARP CORE RECHARGED"),
        { timeoutMs: 5000, intervalMs: 250 });
      checks.check("a refuel from empty confirms itself in the chatter",
        saidRecharged.ok, `chatter="${await chatterText(page)}"`);
```

An ambient line will not overwrite the broadcast inside that window: `typeLine` calls `scheduleAmbient()`, which re-arms the timer to `nextDelayMs()` = 18000-35000ms (`src/utils/chatterScheduler.ts:40-42`), far beyond the 5s poll.

Then add the missing hazard comment. Find the radar-range block that relocates crystals (around `fuel.probe.mjs:246-256`, the `let relocated = 0;` region) and put this immediately above it:

```js
    // ---- KEEP THIS BLOCK LAST IN THE PROBE ----
    // It mutates live crystal positions to build its test geometry. A
    // relocated crystal has a ~2% chance of landing inside an asteroid band,
    // which would break the "no crystal spawned inside the belt or halo" check
    // above if that check ever ran after this point. The probe is correct today
    // purely by ordering; nothing enforces it but this comment.
```

- [ ] **Step 4: Run the fuel probe**

Run: `npm run test:e2e fuel`

Expected: every check passes, and the total is **exactly one more than the baseline you measured in Step 2's sibling run**.

Measure rather than assume the baseline: run `npm run test:e2e fuel` once *before* applying this step and note the count. Published figures for this probe are stale and contradict each other (the fuel-and-crystals record says 16; its own parked-gaps section implies 19 after the radar-range check landed), so neither is a safe expectation to assert against.

If `a refuel from empty confirms itself in the chatter` fails, read the reported `chatter="…"` value before changing anything. A partially-typed line (`"> WARP CORE RECH"`) means the poll window is genuinely too short and the timeout may be raised. A completely unrelated line means the broadcast did not fire — that is a real bug in Task 2, not a probe problem, and must be fixed there.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/harness.mjs tests/e2e/gameplay.probe.mjs tests/e2e/fuel.probe.mjs
git commit -m "test: prove the refuel confirmation reaches the HUD

The probe already built this exact scenario — tank at 0, teleport onto a
crystal — so the check costs no new setup and relocates no crystals, keeping
it clear of the relocation-ordering hazard.

Reads the chatter DOM node rather than store.broadcast, per the reasoning
gameplay.probe.mjs already documents: RadioChatter types some lines directly
without touching the store, so the store is not the channel that sees
everything. chatterText moves to the harness now that two probes need it.

Also comments the relocation-ordering hazard the fuel-and-crystals review
parked as a known gap — the probe was correct only by ordering, with nothing
in the file saying so."
```

---

## Task 4: Full gate and verification record

**Files:**
- Modify: `docs/superpowers/plans/2026-07-31-refuel-confirmation.md` (this file — append the record)

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm the perf guarantee, three times**

Run `npm run test:e2e perf` **three separate times** and record `commits` from each.

Expected: `commits=0` every time.

The spec's §5 predicts this is safe for a specific reason worth confirming rather than assuming: the perf probe's sampling hold is `hold(page, ["KeyW"], 5000)` and `Shift` appears nowhere in that file, so warp never activates, the tank never drains, and `flight.fuel` stays at `FUEL_MAX` throughout. Any pickup during the hold therefore takes the pre-existing `vented` branch — the new `restored`/`topped-up` branches are unreachable there.

If a run does report churn or nonzero commits, **report the numbers and stop**. Do not weaken `commits=0`. The sanctioned fix is to deactivate crystals near the sampling position before the hold, using the same live-reference debug bridge the radar-range block already uses.

- [ ] **Step 2: Full gate run**

```bash
npm run build && npm run lint && npm test && npm run test:e2e
```

Expected:
- Build clean, only the pre-existing chunk-size advisory.
- Lint: exactly the two baseline warnings (`Atmosphere.tsx:54`, `Scanner.tsx:9`).
- Unit: **156 tests** (148 measured baseline + 8 added in Task 1).
- e2e: exactly one more check than the suite reported before this work, with `perf` at `commits=0`. Do **not** assert against the "127" in the fuel-and-crystals record — that figure predates the `basepath` probe, which is now in `run.mjs`'s default list. Measure the baseline on `main` if you need a number to compare against.

**Safety:** the `assets` probe invokes Blender against gitignored, irreplaceable `assets-src/`, asserting a sha256 restore. If `assets-src/moon.glb restored byte-for-byte` fails, **stop immediately and report it** — do not retry, and do not touch `assets-src/`.

- [ ] **Step 3: Confirm production is clean**

```bash
npm run build && ! grep -rq '__fitz' dist/assets/*.js && echo "OK: debug bridge stripped"
```

Expected: `OK: debug bridge stripped`.

Scope note, so this is not over-read: this confirms the dev-only bridge is dead-code-eliminated. It is **not** evidence that the confirmation works in production — that rests on `FuelCrystals.tsx` importing `refuelOutcome` from `src/utils/fuel.ts` directly, the same module-level path `refuel` and `FUEL_MAX` already take, with nothing dev-gated between them.

- [ ] **Step 4: Check the message renders correctly, by eye**

Run `npm run dev`, open the console, and force the exact scenario:

```js
// Empty the tank, then drop the ship onto a crystal.
__fitz.flight.fuel = 0
const c = __fitz.crystals.find((s) => s.active)
__fitz.teleport(c.x, c.y, c.z + 1)
```

Confirm the chatter line reads `WARP CORE RECHARGED // 25% — WARP ONLINE`, that the em dash renders as `—` and not as mojibake, and that the `25%` matches what the HUD gauge shows at that moment.

Note: assigning `__fitz.flight.fuel = 0` **does** work — unlike `flight.x`, fuel is not overwritten from a ref each frame; `Spaceship.tsx` reads and writes `flight.fuel` as the authoritative value. This is the one `flight` field it is safe to poke from the console.

- [ ] **Step 5: Append the verification record and commit**

Append a `## Verification record` section to this plan file covering: the three `commits` figures from Step 1, the gate outcomes from Step 2, the actual unit-test and e2e check totals (report what you measured, not what this plan predicted), and the observed chatter string from Step 4.

If any measured total differs from this plan's expectation, say so explicitly and explain the difference rather than quietly adopting the new number.

```bash
git add docs/superpowers/plans/2026-07-31-refuel-confirmation.md
git commit -m "docs: refuel confirmation verification record"
```

---

## Self-Review

**Spec coverage.** §1 pure function → Task 1. §2 shared threshold → Task 1 (constant) + Task 2 Step 1 (HUD consumer) + Task 1's source-scan test (enforcement). §3 four outcomes and wording → Task 2 Step 3, with strings pinned verbatim in Global Constraints. §4 render pressure → Global Constraints + Task 4 Step 1. §5 perf risk → Task 4 Step 1, including the "report and stop, never weaken" rule. §6 testing → Task 1 (unit boundaries) + Task 3 (e2e). §7 hazard comment → Task 3 Step 3. §8 out of scope → nothing in this plan touches warp duration, the gauge flash, or the other parked test gaps. §9 acceptance → Task 4 Steps 1-4.

**Placeholder scan.** No TBD/TODO. Every code step carries the actual code. Every run step carries the actual command and the expected result.

**Type consistency.** `refuelOutcome` returns the same four string literals in Task 1's implementation, Task 1's tests, and Task 2's switch. `FUEL_LOW` is fuel units everywhere, divided by `FUEL_MAX` only at the HUD's 0-1 comparison site. `chatterText` has the same signature in the harness, in `gameplay.probe.mjs`, and in `fuel.probe.mjs`.

**Known rough edge, called out rather than hidden.** Task 1 commits with one deliberately-red test (the `HUDOverlay` source scan), which Task 2 Step 2 turns green. The alternative — writing the source-scan test in Task 2 instead — would mean Task 2 has no failing test to drive it. The plan states the option to fold the two commits together for anyone who objects to a red commit.
