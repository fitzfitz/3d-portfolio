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

**Re-derived 2026-10-19 (New Worlds C1: the five worlds, detail by distance).**
Every calls, triangles and lights ceiling in `transition.probe.mjs` now
comes from this table by the rule above. The programs ceilings do not: they
stay at the deliberate 79 (deep-space family) and 84 (planet states), for the
low-perf-before-warm-up path described below. Each figure is the highest of 11 serial runs of
`npm run test:e2e transition`, with the worlds in the scene and the LOD in
place; see the dated note at the end of this section for what was added and
what is in frame in each state.

| State | calls | triangles | programs | lights | ceilings (calls / triangles / programs / lights) |
|---|---|---|---|---|---|
| Deep space, facing away from the sun | 35 | 241916 | 57 | 4 | 50 / 278210 / 79 / `LIGHT_BUDGET` (4) |
| Deep space, facing the sun | 118 | 401672 | 57 | 4 | 140 / 461930 / 79 / 5 |
| Near the ringed giant, rings in frame | 39 | 251836 | 57 | 4 | 50 / 289620 / 79 / 5 |
| Close approach | 116 | 373512 | 57 | 4 | 140 / 429540 / 84 / 5 |
| Modal open | 128 | 464488 | 57 | 4 | 150 / 534170 / 84 / 5 |
| 40 anomalies, facing away | 35 | 241916 | 58 | 4 | 50 / 278210 / 79 / 5 |

Programs is the page's cumulative count. Its ceilings are the deliberate
79 / 84, not baseline + 1 (see "The ceilings above were deliberately not
lowered" below); the guard that a program is never added in play is the
tour in `programs.probe.mjs`, which must add 0. The table this replaced (kept for
history; the ceilings had not moved with the later re-measurements below):
deep space 32 / 217892 / 78 / 4, close approach 93 / 365726 / 83 / 4, modal
open 94 / 365738 / 83 / 4, 40 anomalies 32 / 217892 / 78 / 4, facing the sun
108 / 418490 / 78 / 4.

**Programs measured 2026-10-15 (warm-up compiles for the PostFX target).**
`ShaderWarmup` used to compile with no render target bound, so every program
got its on-screen variant (sRGB output, tone mapped), while with PostFX on the
scene actually draws into the composer's buffer (linear, no tone mapping).
Visible objects compiled their real variant on the first frames anyway, so
each paid twice, and anything hidden at load (the race ghost, live-sky ghosts)
compiled its real variant mid-play, the first time it appeared. Warm-up now
binds a 1×1 render target when PostFX is on. A full run read deep space 56,
close approach 57, modal 57, 40 anomalies 56 (from 78/83/83/78).

That also explains the old note that programs "reach 90 after crossing the
whole system": a tour of every landmark climbed 79 → 91 on the old warm-up,
all srgb-linear variants, not light-count variants. The god-ray
pass is gone (L21), and the sun keeps no-depth-write so the corona blends over
its disc. `tests/e2e/programs.probe.mjs` flies the tour and
asserts no program is added.

**Programs and calls measured 2026-10-16 (god-ray pass removed).** A full run
read deep space 35 calls / 241916 triangles / 51 programs, close approach
65 / 349702 / 51, modal 109 / 418492 / 51, 40 anomalies 37 / 243964 / 52
(programs were 56 / 57 / 57 / 56 the day before). The EffectPass loses the
GodRays effect, and the new glare sprites reuse the flare ghosts' sprite
program. The tour adds 0 programs. The ceilings are unchanged.

**Programs measured 2026-10-17 (eclipses, F4 / L20).** Analytic sun shadows
patch the three planet surfaces and Ruangrapi's cloud layer (fragment mode, one
variant per planet slot, since each compiles its own slot out), the five moons
and the player ship's nine hull materials (object mode, one shared variant).
Warm-up compiles all of them: deep space, close approach and modal now read 54
programs, 40 anomalies 55 (51 / 51 / 51 / 52 the day before, so +3). The tour
in `programs.probe.mjs` still adds 0. Calls and triangles are unchanged (deep
space 35 / 241,916, close approach 57 / 349,368, modal 109 / 418,492, 40
anomalies 36 / 242,940): the shadows are shader work, not geometry. Startup
read 10.1-10.4 s in the mechanics run. The ceilings are unchanged. Shadowing
Ruangrapi's ring (fix round 1) left the counts at 54 / 55: its one-slot
variant replaces the ring's old program rather than adding one.

**Eclipse fragment cost, low-perf tier, measured 2026-10-17 in a real browser.**
Headless SwiftShader times nothing useful, so this was measured with Playwright
on this Mac: Apple M5 (ANGLE Metal), Chrome 155, 1512x806 at DPR 1, a 100 Hz
display, low-perf forced on (`setLowPerf(true, true)`). The ship was parked 25u
from Ruangrapi's centre (9 above the surface) on its day side, facing it, so
the planet, its clouds and its ring filled the screen. Each mode ran 10 s after
a 1.5 s settle, alternated on/off three times; off is
`__fitz.sunShadowDebug.countOverride = 0`, which empties the per-fragment
occluder loop (the ring's one-slot test stays in both).

| Mode | frame p50 / p99 (rAF) | GPU p50 / p99 (scene render, timer query) |
|---|---|---|
| Shadows on | 10.0 / 10.9-11.0 ms | 4.43-4.44 / 4.54-4.66 ms |
| Shadows off | 10.0 / 10.8-10.9 ms | 3.57 / 3.68-3.70 ms |

Frame time is pinned to vsync (10 ms) either way, so frame p50 rose by 0 ms. The
GPU time is the real cost: +0.87 ms p50 (+24% of the scene render), steady in
every alternation and under the 1 ms trigger. The exact lateral-distance
early-out (before the asin/acos, `sunShadowCoverFrom`) was added anyway and
measured again: 4.43-4.44 vs 3.57 ms, no change on the M5, whose trig units are
fast. It is kept for slower GPUs because it is exact (unit-tested against
`sunVisibility`). The low-perf frame keeps about 5.5 ms of headroom at 100 Hz.

**Sixteen occluder slots, measured 2026-10-18 (New Worlds C1, L20).**
`MAX_OCCLUDERS` went 8 → 16 with fixed slots (planets 0-2, moons 3-7, worlds
8-11; the outermost world has none), and the per-body `SUN_SHADOW_SELF` define
became a distance skip in the loop, so bodies share programs. Programs: the
`programs.probe.mjs` tour read 54 before and 54 after, adding 0 both times;
the ring's slot is now a uniform. Same method and machine as above (Apple M5,
ANGLE Metal, Chrome 155, Playwright, 1512x806 at DPR 1, 100 Hz, low-perf
forced, the ship parked 25u from Ruangrapi's centre on its day side, facing
it). Slots 8-15 were filled by hand with the four slotted worlds at their
orbits and the same four a quarter-orbit on, so 16 means sixteen live
occluders. Each count ran 10 s after a 1.5 s settle, alternated 8/16 three
times, then 0/8/16 twice for 6 s each.

| `countOverride` | frame p50 / p99 (rAF) | GPU p50 / p99 (scene render, timer query) |
|---|---|---|
| 0 (shadows off) | — | 2.58 / 2.68-2.89 ms |
| 8 (today's planets and moons) | 10.0 / 12.0 ms | 3.12-3.13 / 3.20-3.23 ms |
| 16 (every slot) | 10.0 / 12.0 ms | 3.67-3.68 / 3.82-4.42 ms |

Frame time stays pinned to vsync. Going from 8 to 16 occluders costs +0.55 ms
GPU p50, steady in every alternation. That is 0.05 ms over the spec's
≤ +0.5 ms estimate, and well under the 1 ms trigger. The p99 tail grows by up
to 1.2 ms in some windows (one 0/8/16 repeat read +0.6 ms). Play still writes
8 for now: the worlds' slots stay unwritten until the worlds render. The
scene render reads cheaper than in the F4 table above (3.12 against 4.43 ms
with 8 on). The cause was not investigated. The tables come from separate
sessions on different branches, so compare within a table, not across.

The ceilings above were deliberately **not** lowered to match (still true
after New Worlds C1: Task 10 briefly set them to baseline + 1, 58 / 59, and
they were restored to 79 / 84 on 2026-10-19). Under headless
SwiftShader the performance monitor can decline to low-perf while assets load,
before warm-up runs; warm-up then rightly compiles for the screen, and the
harness's later switch back to PostFX compiles the real variants on top, which
lands back near the old counts. The table keeps the old baselines so the
ceilings cover both paths; `tests/e2e/livesky.probe.mjs` locks low-perf off
before load and asserts that ghosts appearing add no program at all.

**Programs re-baselined 2026-10-12 (time-trial ring course).** `RingCourse.tsx`
adds two material variants, both compiled by `ShaderWarmup` at load rather than
during play: the instanced, instance-coloured additive ring material, and the
ghost ship's additive wash. Deep space and 40-anomalies read 78 (+2, +3 —
40-anomalies had sat one below deep space), the planet states 83 (+1). Calls
and triangles stayed inside their ceilings (the ten rings are one 5.8k-triangle
draw; the ghost draws only during a lap), so they keep the earlier baselines.

**Re-baselined 2026-10-10 (cinematic asteroids, moons, comets).** The 20 hero
asteroids went from ~3k to ~6.9k triangles each, moons from 1.3k to 4.5k
(three distinct variants) and comet nuclei to 5.6k: +71k triangles in deep
space, deliberately. Programs +2-3 for the new material combinations
(emissive mineral veins on two asteroid variants; MoonRock / MoonIce /
MoonVolcanic). Still 74% below the 825k drawn before phase 3. Earlier the
same day (original ship/portal/crystal/planets): 32 / 147092 / 74,
91 / 289834 / 78, 114 / 306690 / 78, 34 / 147604 / 73.

**Re-baselined 2026-10-10 (original assets).** The ship, portal, fuel crystal
and planet maps were replaced with scripted originals (see
`assets-src/MANIFEST.md`). Triangles rose ~38k in deep space, deliberately: the
hero ship went from 2.7k to 18k triangles, and the fuel crystal now draws its
whole 366-triangle cluster (x40 instances) where the old file's first mesh was
a ~37-triangle base. Calls and programs barely moved. Still 82% below the
825k this scene drew before phase 3.

**Re-baselined 2026-10-10 (leftovers pass: lights, nebula, async warm-up).**
drei's `<Preload all>` was replaced by `ShaderWarmup` (`GlobalCanvas.tsx`):
`compileAsync` plus per-task texture uploads instead of a synchronous compile
followed by six CubeCamera renders. Programs fell 86 -> 74 in deep space — the
cube renders compiled variants the scene never draws. Calls and triangles at
close approach / modal open are higher only because the warm-up shifted *when*
the probe reaches the planet, so a different slice of the system is in frame
behind it; three consecutive runs gave identical numbers except 40-anomalies
programs (68-73, so the table uses the max). Close approach was re-measured
after `approachPlanet` moved to the planet's outward radial (it used a fixed
offset that orbital motion could close into a lock): 89 / 251390 on most runs,
72 / 230258 once, depending on what is in frame. Lights 10 -> 4 (see below).

Earlier the same day, **phase 3 load/render pass** (28 / 108512 / 86,
87 / 251322 / 87, 89 / 251334 / 87, 32 / 109536 / 86): triangles fell 72-87%:
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
the intended hard limit; the other states use `LIGHT_BUDGET + 1` (5) per
the derivation rule above, as slack for measurement noise rather than as
license to add a light.

*Superseded (2026-10-15 onward):* programs used to climb from 74 (deep space,
the first state measured after page load) to 78 in the planet states, the
last four compiling lazily on the first close approach. Warm-up now compiles
them all up front (see "Programs measured 2026-10-15" above), and every state
before the anomalies reads the same count (57 since New Worlds C1). The
planet states' higher ceiling (84) is kept only as the deliberate slack
described above, not because they still compile more.

**Detail by distance and the worlds in view, re-derived 2026-10-19 (New Worlds C1, Task 10).**
What was added since the last re-derivation: the five worlds (Tasks 1-9: five
64-segment spheres, the ringed giant's 256-segment ring, two ice-giant limb
and atmosphere shells, five orbit lines), then detail by distance
(`src/utils/sphereLod.ts`). Every planet and world now draws through one
three.js `LOD` on three shared unit spheres (64 / 24 / 12 segments), scaled to
the body, every level on the body's one material (geometry is not part of a
program's key, so no program is added). A body drops to 24 segments at 12.42
sizes and to 12 at 49.31 sizes: where that polygon's silhouette sags at most
half a pixel inside the true limb at 1512x802 and FOV 58 (a 16 gas giant at
199 and 789 u, the 3.5 dwarf at 43 and 173 u). The atmosphere, limb and
cloud shells follow their body's levels, so a shell is always a scaled copy of
its surface's polygon, and are culled where their on-screen extent falls under
one pixel: the atmosphere's band beyond the limb, (thickness - 1) x radius
(Ruangrapi 1,042 u, Portfolio 694, Fuxx 289, the ice giants 391 and 376).
Limb darkening and clouds cover the disc, so theirs is their whole radius,
about 9,000 u, past the 1,500 far plane: in practice they are never culled.
Near the camera a shell costs more than before: level 0 is 8,064 triangles
where the old fixed 32x32 shell was 1,984.

What is in frame (read from the live camera on one run): deep space and 40
anomalies face away from the sun from (260, -50, 140), so the whole system,
worlds included, is behind the camera, as it was before the worlds; the
states were not moved. Facing the sun has Ruangrapi, the airless rock, the
blue ice giant and the dwarf in or at the edge of frame; the modal view has
Ruangrapi, Portfolio, the rock, the blue ice giant and the dwarf; close
approach has the tilted ice giant at the frame's edge. The new state parks
80 u from the ringed giant, 35 deg above its lit ring face, sunward of it, nose
on the planet: the planet at level 0 and the whole ring in frame, asserted by
a precondition (on screen, outside the A ring, ring opened toward the camera
with |cos| > 0.3, ring drawn, sun behind the camera, so the lens sprites cannot
come and go). The probe then returns to the facing-sun pose before the
approach, which keeps its heading: left on the ringed giant, that heading
changed what the close-approach and modal states had in frame (11 runs read
close approach 48-49 calls, against 113-116 from the facing-sun heading).

Before / after on the same probe, same machine: the commit before the LOD
(4c5e764, worlds in, 4 runs) read facing the sun 117-119 / 375,636-428,016,
close approach 97-106 / 351,076-371,244, modal 124-125 / 409,028-456,860; with
the LOD (11 runs) 115-118 / 349,292-401,672, 113-116 / 365,920-373,512 and
126-128 / 455,528-464,488. Facing the sun is 26,344 triangles lighter in both
of its readings (distant bodies on 24 or 12 segments). Close approach
read 97-106 calls before and 113-116 after. That shift is not attributed to
the LOD, and it is not measured to any one cause: between the two sets the
probe's sequence changed (the new ringed-giant state, then `toDeepSpace` and
`faceFromSun` again before the approach), so the approach and the modal are
read later and after a different path, and nothing isolated which part moved
the count. Treat it as following the changed sequence and timing, otherwise
unexplained. The old modal ceiling (420,600) was already broken before the LOD by the
worlds (456,860 on one of the four runs). Deep space and 40 anomalies are
bit-for-bit what they were before the worlds. Lights 4 in every state.
Programs 57 in every state but the anomalies' 58, on all 22 baseline runs.

Programs ceilings stay at the deliberate 79 (deep space, facing the sun, the
ringed giant, 40 anomalies) and 84 (close approach, modal), not the rule's
58 / 59. Task 10 lowered them to 58 / 59, since `withPage` locks low-perf off
as soon as the store exists and no run read anything but 57 / 58; they were
restored on 2026-10-19 because a headless run can still decline to low-perf
before warm-up, and then reads near the old counts. The guard against a new
program in play is the tour below adding 0, not these ceilings. `programs.probe.mjs` now tours all five worlds (asserted)
and runs twice, full fidelity (57 programs at start-up) and with low-perf
pinned on before load (44): both add 0.

## Changing these

A number going up is not automatically a regression — adding scenery
legitimately costs draw calls. Re-baseline deliberately: capture the new
numbers, update the table AND the capture date, and say in the commit message
what was added. A ceiling raised without a matching scene change is the
signal this file exists to catch.

## Startup (eager compile) duration

`tests/e2e/harness.mjs`'s `withPage` waits for the scene to be ready under
`SCENE_READY_TIMEOUT_MS` (60s) — generous specifically so a slow-but-not-
broken eager compile never crashes the suite. That
generosity is also a gap: a change that doubled compile time would still
finish inside 60s and pass with no signal anything regressed.

Measured baseline (bisect in `.superpowers/sdd/2026-08-02-performance-uplift/
progress.md`, Task 7b): canvas ready at 120ms, `window.__fitz.scene` ready at
**28,358ms**, on headless Chrome / SwiftShader.

`STARTUP_DURATION_CEILING_MS` (`harness.mjs`) asserts this duration directly.

**Re-baselined 2026-10-10, twice.** The 28,358ms figure above was captured
on a machine at load average 15; normal runs measured 17-20s. The leftovers
pass then replaced the synchronous Preload with `ShaderWarmup`, and the
harness now times the store's `sceneReady` (set after shaders link and
textures upload) rather than DebugBridge's commit-time `window.__fitz.scene`,
which would have dropped compile from the measurement entirely. Measured:
**10.6-11.8s**. The ceiling is **20,000ms**: ~1.7x the slowest run, under 2x,
so a doubling fails red. Same caveat as every other number in this file:
a real-GPU-irrelevant, CI-only guard.

**New Worlds start-up measured 2026-10-18 and 2026-10-19.** Tasks 6-8 saw
start-ups over 20 s. Measured against `main` (8a120ff) in clean detached
checkouts, alternating, 10 runs each of the programs probe's start-up check:
`main` 10,101-10,312 ms (median about 10.2 s), the worlds (4c5e764)
10,474-10,712 ms (median about 10.56 s), +3.5%, no run near the ceiling; 18
more mechanics-probe start-ups read 10.1-12.1 s. The earlier outliers were
machine load, not the worlds. With detail by distance (2026-10-19, load
average 8-11): 10,427-19,917 ms in the first block of five (the first run after
the edit at 19.9 s, falling to 10.4 s by the fourth), then 10,730-12,906 and
10,786-11,662 ms, against 10,635-11,522 ms for 4c5e764 between them. The LOD
does not move start-up; the 19.9 s first run is the load the 20 s ceiling sits
closest to, and it held. Ceiling unchanged: 20,000 ms.

**Asserted once, best of three, from 2026-10-19 (e2e speed-up).** `withPage`
now records every page's start-up in the timing report but no longer asserts
it: under load a single page reached 15-37 s and failed at random, on `main`
too. `tests/e2e/startup.probe.mjs` asserts the ceiling on the best of up to
three fresh SwiftShader loads (stopping at the first inside it), run first and
alone. A real doubling still fails, since it slows every load. The other probes
run on the GPU (ANGLE/Metal), where start-up reads 1.9-5.1 s with four pages
loading at once: those figures are not budgets. Ceiling unchanged: 20,000 ms.
Suite wall time, same Mac: 1,909 s serial on SwiftShader before; 995 s serial
on the GPU; 324-347 s with the parallel runner (four runs, 483/483). With six of
the ten cores held busy by CPU burners: 380 s at base load ~5 (green apart from
a transition window since fixed) and 553 s at base load ~9 (load ~14 during),
where startup's best of three read 21.9 s and failed. The ceiling is a CPU-time
budget on SwiftShader, so an oversubscribed machine can still trip it; best of
three absorbs ordinary load (14.9 s at load 14 without the burners).

**B2 landmarks measured 2026-10-16 (shipyard, dormant gate, freighter rebake).**
`shipyard.glb` (4,332 tris, 4 draw calls) and `dormant_gate.glb` (2,440 tris, 2 draw
calls) joined the scene; both reuse the freighter's HullBaked / NavRed
configurations, so programs did not move. The freighter rebake (one HullBaked
primitive instead of seven) removed up to 30 calls with five freighters on
screen. Measured: deep space 35 / 241,916, close approach 67 / 362,628, modal open
107 / 418,488, 40 anomalies 36 / 242,940 (calls / triangles; programs 56 and
lights 4 in every state). Ceilings changed: none.

**Bigger universe measured 2026-10-17 (400-unit sphere, radial haze, return burn).**
No geometry, material or shader was added: the edge is CPU maths and one DOM
overlay that already existed. Measured in a full e2e run: deep space 35 /
241,916 (calls / triangles), close approach 57 / 349,368, modal open 109 /
418,492, 40 anomalies 36 / 242,940; programs 54 in the three static states and
55 with anomalies; the tour in `programs.probe.mjs` adds 0. Startup read 10.2-11.7 s.
Ceilings changed: none.

**True proportions measured 2026-10-17 (planets 16 / 12 / 8, sun core 24, corona 72).**
No geometry, material or shader was added: the sun's sphere keeps its 64x64 tessellation
at a larger radius, the corona billboard is one quad at a new scale, and the planet
sizes are table values. Measured in a full e2e run: deep space 35 / 241,916 (calls /
triangles), close approach 59 / 349,372, modal open 108 / 418,494, 40 anomalies
39 / 244,990 (+2,050 on the last run, a view-dependent count; the 250,580 ceiling holds with about 2% to spare);
programs 54 in the three static states and 55 with anomalies; the tour in
`programs.probe.mjs` adds 0. Startup read 8.3-12.3 s. Ceilings changed: none.
Review fixes (same day): the corona quad moves onto the limb each frame, the spike and veil
sprites rescale with the disc, and the photosphere gained one `uGain` uniform (x0.15 with
bloom, 1 in low-perf); still no new geometry, material or program. Full run: deep space
35 / 241,916, close approach 57 / 338,124, modal open 108 / 418,494, 40 anomalies 39 / 244,990,
programs 54 (tour adds 0), startup 7.7-11.6 s. One earlier run read deep space 41 calls (+6
calls, +12 triangles: the six lens sprites, with the sun inside the glare cone from the
deep-space point at that hour); a re-run read 35.

**Deep-space heading pinned 2026-10-17 (facing-sun state added).** The 41 was the teleport
keeping whatever heading the ship had, so about one run in 15 had the sun inside the glare
cone. `transition.probe.mjs` now turns the nose straight away from the sun before the
deep-space and 40-anomalies reads, puts the chase camera on its resting point, and asserts
the sun is behind the camera with the glare group (`SunGlare`) hidden. A new state at the
same point faces the sun and asserts it is on screen with the glare showing: 108 / 418,490
/ 54 / 4, the disc, corona, sprites and the inner system in frame. Calls and triangles
take the rule (130 / 481,270); programs is the page's cumulative count, read seconds after
deep space, so it shares deep space's table baseline and ceiling (79) instead of a tighter
one that the low-perf path above would trip; lights 5. Eleven baseline runs and eight
verification runs read the same: deep space 35 / 241,916, 40 anomalies 35 / 241,916 (the
39 and 36 before were view-dependent), programs 54 / 55. Facing the sun read 108 on every
run but one independent re-run, which read 107 with the same triangles (a points or lines
draw that comes and goes); the 130 ceiling has 22 to spare. Ceilings changed: none; one added.
