# Performance Budgets

Captured 2026-08-03 on headless Chrome / SwiftShader (software rendering),
after the transition-hitch uplift
(`.superpowers/sdd/2026-08-02-performance-uplift/`); the baseline table was
re-captured 2026-10-10 after the phase 3 load/render pass (see below).

These are software-rendering figures, captured this way because they are
deterministic in CI — not real-GPU figures, and not representative of actual
user-facing frame times. Asserted by `tests/e2e/transition.probe.mjs`. Frame
times are NOT asserted in CI — headless SwiftShader makes them noise. They
live in the DEV overlay (`src/debug/PerfOverlay.tsx`), which is where the
numbers mean something.

## A correction found while capturing these

The original plan for this file assumed `PerfSampler` (`src/debug/PerfSampler.tsx`)
already sampled `calls`/`triangles` correctly by reading `gl.info.render.*`
inside a plain `useFrame`, timed to run before `EffectComposer` resets
`gl.info`. Measuring it directly (via the newly-exposed `perfStats` on the
debug bridge) showed that was not true: every state read back a stuck
`calls=1 / triangles=1`, identical to the *broken* reading the plan describes
as the original bug, not the fixed one.

The reason: `@react-three/postprocessing`'s `EffectComposer` registers its
render callback at `useFrame` priority 1, and R3F runs `useFrame` subscribers
in ascending priority order — so a plain `useFrame` at the default priority 0
(what `PerfSampler` used) always runs *before* the composer's render call for
that same frame, meaning it only ever observes whatever `gl.info` was left
holding by the *previous* frame's last internal composer pass (a single
fullscreen quad — one draw call, ~1 triangle). Confirmed against
`node_modules/three/src/renderers/WebGLRenderer.js`: every `render()` call
resets `info` at its own start when `autoReset` is true (the default, and
still true here — `gl.info.autoReset = false` was correctly rejected earlier
in this plan and stays rejected).

The actual fix, now in `PerfSampler.tsx`: hook `scene.onAfterRender`, a
standard three.js `Object3D` callback that `WebGLRenderer.render()` invokes
synchronously right after that specific call finishes drawing `scene` —
i.e. exactly when `gl.info` still holds the real scene's totals, strictly
before the composer's later passes (which render their own internal quad, a
different object, so this hook doesn't fire for those) get a chance to reset
it again. Verified before/after: the old approach read a stuck `1/1` in every
state below; the new one reads real, stable numbers that move sensibly across
states (e.g. triangle count rising with close approach as a planet's moon/ring
geometry enters view, and falling back at deep space).

`programs` (`gl.info.programs.length`) and `lights` (a direct `scene.traverse`,
not `perfStats.lights` — see below) were unaffected by this and needed no fix.

## Derivation rule

- Draw calls and triangles: baseline + 15%, rounded up to the nearest ten.
- Programs and lights: baseline + 1. These must not grow during play at all;
  the +1 is slack for a driver-dependent variant, not for a new material.

## Baselines

Measured with `tests/e2e/harness.mjs`'s `withPage`, teleporting into each
state exactly as `transition.probe.mjs` now does for its own assertions (see
that file for the exact reproduction steps). Repeated 4 times; deep space,
close approach and modal-open were bit-for-bit identical on every run. The
40-anomalies state alternated between two nearby readings (`calls` 29 or 31,
`triangles` 825376 or 825888) — the higher of the two is recorded below and
used as the baseline, so the derived ceiling already covers the observed
variance.

| State | calls | triangles | programs | lights |
|---|---|---|---|---|
| Deep space | 28 | 108512 | 86 | 4 |
| Close approach | 87 | 251322 | 87 | 4 |
| Modal open | 89 | 251334 | 87 | 4 |
| 40 anomalies | 32 | 109536 | 86 | 4 |

**Re-baselined 2026-10-10 (phase 3 load/render pass).** Triangles fell 72-87%:
the asteroid belt drew the 1,244-triangle hero asteroid 560 times; it now uses
an 80-triangle size-matched rock (`src/utils/lowPolyRock.ts`). Planets went from
32 to 64 segments (+~18k), the jellyfish is frustum-culled, and three invisible
aura spheres inside the planets were removed. Programs are +1 on the previous
table: SMAA adds two passes and the star shader one, offset by materials that no
longer exist. Measured identically on three consecutive runs, after the harness
started locking low-perf off before the canvas mounts (see `harness.mjs`) —
before that, whether PerformanceMonitor declined first made deep-space programs
read 82 or 105 run to run.

Previous table (2026-10-10, before phase 3): deep space 29 / 825376 / 85,
close approach 91 / 886362 / 86, modal open 89 / 886238 / 86,
40 anomalies 31 / 825888 / 85.

Lights sits at 4 (`LIGHT_BUDGET`, `src/constants.ts`) in every state — cut
from 10 on 2026-10-10 (duplicate sun light, three planet glow lights sealed
inside opaque spheres, a 1.2u ship light, and the portal pair merged into one;
see the comment on `LIGHT_BUDGET`). The whole point of Task 4's plasma-pool fix
is that this number does not move across gameplay. `transition.probe.mjs`'s
deep-space check asserts directly against the imported `LIGHT_BUDGET` constant
rather than a separately-derived ceiling, since that constant already **is**
the intended hard limit; the other three states use `LIGHT_BUDGET + 1` (5) per
the derivation rule above, as slack for measurement noise rather than as
license to add a light.

Programs climbs from 86 (deep space, the very first state measured after
page load) to 87 in the planet states, regardless of which is measured
second — a one-time lazy shader compile that isn't specific to any one
transition. Task 7's eager `Preload` warm-up compiles nearly everything up
front, but not quite everything; this is within the `+1` slack the derivation
rule already allows for exactly this kind of driver/compile variance.

## Changing these

A number going up is not automatically a regression — adding scenery
legitimately costs draw calls. Re-baseline deliberately: capture the new
numbers, update the table AND the capture date, and say in the commit message
what was added. A ceiling raised without a matching scene change is the
signal this file exists to catch.

## Startup (eager compile) duration

`tests/e2e/harness.mjs`'s `withPage` waits for `window.__fitz.scene` under
`SCENE_READY_TIMEOUT_MS` (60s) — generous specifically so a slow-but-not-
broken eager `Preload` compile (Task 7) never crashes the suite. That
generosity is also a gap: a change that doubled compile time would still
finish inside 60s and pass with no signal anything regressed.

Measured baseline (bisect in `.superpowers/sdd/2026-08-02-performance-uplift/
progress.md`, Task 7b): canvas ready at 120ms, `window.__fitz.scene` ready at
**28,358ms**, on headless Chrome / SwiftShader.

`STARTUP_DURATION_CEILING_MS` (`harness.mjs`) asserts this duration directly.

**Re-baselined 2026-10-10.** The 28,358ms figure above was captured on a
machine at load average 15. Normal runs measured 17-18s before the phase 3
pass and **16,952-19,828ms** after it (12 probes, one full suite), so the old
45,000ms ceiling sat ~2.3x above reality — loose enough that a doubling of
compile time would still pass. The ceiling is now **30,000ms**: ~1.5x the
slowest observed run (room for ordinary machine-load noise) and well under
2x, so a doubling fails red instead of running slow and silent. This is a
real-GPU-irrelevant, CI-only guard — same caveat as every other number in
this file.
