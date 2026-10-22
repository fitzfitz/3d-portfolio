# E2E speed-up: design

**Goal:** `npm run test:e2e` finishes in under ~10 min, and a busy Mac can no longer fail random pages.
**Owner's ask (2026-10-19):** "we need to think of a way to faster the e2e".

## Measured (2026-10-19, M5, 10 cores)

The baseline was the whole suite run serially on SwiftShader, with per-page phase timing (`E2E_TIMING_OUT`):

| | SwiftShader (today) | GPU (ANGLE/Metal), serial |
|---|---|---|
| suite | **1909 s (31.8 min)**, 512/512 | **995 s (16.6 min)**, 510/512 |
| shader compile | 417 s (11–16 s/page) | 76 s (~2.3 s/page) |
| harness warm `settle(4000)` | 184 s | 136 s |
| probe bodies | 1206 s (421 s blind `settle`) | 709 s (423 s blind `settle`) |
| Chrome launch + close | 16 s | 12 s |

- Headless Chrome on this Mac gets Metal with no flags: about 60 fps, against about 1 fps on SwiftShader.
- Launch is cheap (~0.3 s), so sharing one browser across probes is not worth the coupling. Dropped.

### What the GPU run revealed

Both GPU failures were one probe-side race. `teleport()` moved the ship but `flight` caught up a frame later, so a read straight after it saw the old spot. Fixed at the source (7b86d72), with a smoke check.

## Design

1. **Backends.**
   - The GPU is the default.
   - **startup** and **transition** stay pinned to SwiftShader. The start-up ceiling and transition's call, triangle and program ceilings in PERF-BUDGETS.md were measured there.
   - **programs** moves to the GPU. It asserts that a tour adds 0 programs, and it read the same 57/44 programs on both backends. Its stops hold 1 s plus three real frames, and a guard fails any stop that orbit-locks, since a lock freezes rendering and the check would pass without looking.
   - **perf** moves to the GPU. Its checks are LOD counts and "zero React commits in 5 s of flight", which is about 300 frames on the GPU against 5 on SwiftShader, so the move makes the test stronger.
   - A renderer guard fails any `withPage` page whose WebGL renderer does not match the backend it asked for, so a GPU run cannot silently fall back. basepath launches its own browser and checks only built asset paths, so it is not guarded.
2. **Startup is its own probe (`startup`).**
   - It runs up to three loads on SwiftShader, alone, stops at the first inside `STARTUP_DURATION_CEILING_MS`, and asserts the *best*. A load that times out counts as a slow load.
   - `withPage` stops asserting startup and only records it in the timing report. A loaded machine can then slow a page without failing it.
   - A real doubling still fails, because all three loads double.
3. **Parallel runner.**
   - `run.mjs` starts Vite once and runs each probe in its own Node child (`run-one.mjs`). This keeps the harness singletons (`server`, `timings`) per probe and means a crash takes down only that probe.
   - **Phase 1, alone:** startup, then transition (SwiftShader). Startup's first load also warms Vite's dependency optimizer before anything runs in parallel.
   - **Phase 2:** every other probe on the GPU, in a pool of `E2E_JOBS` (default 4), longest-first by measured cost. Each child's output is printed as one block when it finishes.
   - `npm run test:e2e <names>` still runs a subset, and `E2E_JOBS=1` runs serially.
4. **Wait trims: done in PR 48 (2026-10-23), 370 → 303 s wall at 4 jobs.** The warm-up became frames plus a stable program count (175 → 64 s summed), events sets the director's clock near due (`__fitz.eventDirector`), and the multi-page probes run one page per job (run.mjs `PARTS`). As first deferred: The suite reached ~5.4 min without them, under the 10 min goal. The next win, if one is wanted:
   - The harness warm-up `settle(4000)` (~144 s summed, ~35 s of wall at 4 jobs) could become "N frames rendered and the program count stable for 1 s". Career, livesky, shipyard and mechanics compare program counts, so the stable window must be real time.
   - events (~170 s, the longest probe and phase 2's critical path) could split its two pages into separate jobs and replace its 55 s reduced-motion negative poll.
   - The probe trims rejected in the audit stay rejected.

## Not in scope (→ docs/FOLLOW-UPS.md)

The audit found pre-existing checks that cannot fail as written:
- gameplay ring (:162-175)
- shipyard :65
- gamepad steer (:50-57)
- touch RISE

It also found pre-existing timing gambles:
- transition's orbital-phase lock setups
- logbook :28 badge-line hold

These are listed in the follow-ups, not fixed here.

## Verification

- Three full parallel runs, all green.
- The wall time of each run is recorded in PERF-BUDGETS.md.
- Return-to-edge bounds (flight, mechanics) assert simulated seconds summed by the edge recorder, not a wall-clock guess, so the GPU's real-time frames don't loosen them.
- One run with the machine deliberately loaded (a CPU burner on 6 cores) must also be fully green. Startup is the only check that is allowed to be load-sensitive, and best-of-3 is what absorbs that.
- **Result (2026-10-19):** four normal runs green (324-347 s). Loaded run 1 (base load ~5) found one more load-sensitive window, transition's 1 s classic-CV round trip, now a poll. Loaded run 2 (base load ~9, ~14 during) was green except startup, best of three 21.9 s against 20 s: past what best-of-3 can absorb on an oversubscribed CPU.
