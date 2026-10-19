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
   - **transition** and **programs** stay pinned to SwiftShader. Their call, triangle and program ceilings in PERF-BUDGETS.md were measured there.
   - **perf** moves to the GPU. Its checks are LOD counts and "zero React commits in 5 s of flight", which is about 300 frames on the GPU against 5 on SwiftShader, so the move makes the test stronger.
   - A renderer guard fails any page whose WebGL renderer does not match the backend it asked for, so a GPU run cannot silently fall back.
2. **Startup is its own probe (`startup`).**
   - It runs three loads on SwiftShader, alone, and asserts the *best* against `STARTUP_DURATION_CEILING_MS`.
   - `withPage` stops asserting startup and only records it in the timing report. A loaded machine can then slow a page without failing it.
   - A real doubling still fails, because all three loads double.
3. **Parallel runner.**
   - `run.mjs` starts Vite once and runs each probe in its own Node child (`run-one.mjs`). This keeps the harness singletons (`server`, `timings`) per probe and means a crash takes down only that probe.
   - **Phase 1, alone:** startup, transition, programs (SwiftShader), in that order. Startup's first load also warms Vite's dependency optimizer before anything runs in parallel.
   - **Phase 2:** every other probe on the GPU, in a pool of `E2E_JOBS` (default 4), longest-first by measured cost. Each child's output is printed as one block when it finishes.
   - `npm run test:e2e <names>` still runs a subset, and `E2E_JOBS=1` runs serially.
4. **Wait trims** come only after the runner is green.
   - The harness warm-up settle becomes "N frames rendered and the program count stable for 1 s".
   - The probe trims rejected in the audit are not adopted.

## Not in scope (→ docs/FOLLOW-UPS.md)

The audit found pre-existing checks that cannot fail as written:
- gameplay ring (:162-175)
- shipyard :65
- gamepad steer (:50-57)
- touch RISE
- smoke camera control

It also found pre-existing timing gambles:
- transition's orbital-phase lock setups
- logbook :28 badge-line hold

These are listed in the follow-ups, not fixed here.

## Verification

- Three full parallel runs, all green.
- The wall time of each run is recorded in PERF-BUDGETS.md.
- One run with the machine deliberately loaded (a CPU burner on 6 cores) must also be fully green. Startup is the only check that is allowed to be load-sensitive, and best-of-3 is what absorbs that.
