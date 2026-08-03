# Follow-ups

Findings noticed while working on something else and deliberately not fixed at
the time, so the change in flight stayed scoped. Each one is real and
reproducible; none is urgent enough to have justified widening a branch.

Delete an entry when it is fixed.

## Product

### `THRUSTERS_BREAK_ORBIT` can re-capture the ship immediately

`Spaceship.tsx:121-124` pushes the ship 2.8 units along its nose direction when
the orbit lock breaks. The lock re-engages inside `PLANET_SIZE * LOCK_ENGAGE_FACTOR`
= 4.8 × 1.3 = **6.24** units (`constants.ts:36,52`). The escape push therefore
leaves the ship well inside the radius that re-locks it, so `SpacePlanets.tsx:359-371`
can re-engage on a later frame and reopen the dossier the visitor just closed.

Reachable from three real buttons (`App.tsx:147,202,232`), not test-only.

Pre-dates the 2026-08-02 performance uplift — that work only made it *visible*,
because rendering now depends on the same flag. Surfaced by the Task 6 review.

Fix is probably to push past `LOCK_ENGAGE_FACTOR` rather than a fixed 2.8, or to
lean on the existing `isOrbitCooldown` flag for long enough to clear the radius.

### Classic-CV toggle button overlaps the navbar's Contact link

`App.tsx:88` pins the `VIEW_CLASSIC_RESUME` / `RETURN_TO_PILOT_CABIN` button at
`fixed top-6 right-6 z-50`. In classic-CV mode the navbar renders its own links
in the same corner, and the button sits on top of "Contact". Visible in any
screenshot of classic-CV mode at 1280px wide.

### Hero renders literal markdown asterisks

`Hero.tsx:51` contains the raw text `**Creative Software Engineer**` inside JSX,
so the asterisks are displayed rather than rendering bold. Either drop them or
split the phrase into a `<strong>`.

## Performance

### PostFX's Bloom pass never hits the shader program cache on remount

`GlobalCanvas.tsx` mounts `<PostFX>` only when `!isLowPerf`
(`SafeErrorBoundary`-wrapped, sibling of the Suspense boundary). Measured via
`gl.info.programs` cache-key diffing (not just the count, which hides this):
every single isLowPerf on/off cycle recompiles Bloom's three passes
(`LuminanceMaterial`, `DownsamplingMaterial`, `UpsamplingMaterial`) from
scratch — three consecutive cycles produced three completely disjoint sets of
cache keys (0 key overlap between any two cycles), with the embedded numeric
id incrementing monotonically each time (e.g. 43/44/45 -> 48/49/50 ->
53/54/55). `postprocessing`'s effect passes bake a fresh per-instance id into
their shader cache key on every construction, so a remounted Bloom pass never
reuses a previously-compiled program no matter how many times it toggles —
unlike every other isLowPerf-gated object in the scene (which round-trips
through the cache cleanly, per a 10s idle control showing zero drift with no
action taken).

Practical effect: the *first* isLowPerf transition of a session (often
automatic, via `PerformanceMonitor.onDecline` mid-flight) always pays a real
GPU shader compile for Bloom, and so does every transition after that. A real
fix would need PostFX to keep its Bloom pass mounted at low-perf too (perhaps
disabled via `effect.blendMode` or scale-to-zero rather than unmounted), so
`gl.compile()` only ever needs to see one generation of these materials.

**A startup warm-up was tried in Task 7 and reverted on review — do not
re-add it from the plan text.** The idea (walk `isLowPerf` true-then-false
once at boot so the "first transition" cost lands during load) sounds
plausible but doesn't hold up:

- It cannot reach the corona/halo/`WarpTunnel`/`ShootingStars`/`DustField`
  materials it was meant to warm. Those all live inside `GlobalCanvas`'s
  `<Suspense>` boundary, which resolves once, several seconds after mount
  and only after every GLTF-dependent sibling is ready — a boundary commits
  atomically, it does not partially render. The warm-up's `setLowPerf` →
  `setTimeout(0)` → `setLowPerf` round trip completes in single-digit
  milliseconds, in the outer tree, long before any of that exists to
  mount/unmount.
- The one thing it *does* reach — `PostFX`, which sits outside Suspense —
  gets no benefit. `isLowPerf` defaults `false`, so Bloom already compiles at
  mount regardless. The warm-up then disposed that compile and forced a
  second one (per the cache-key finding above, remounting can't reuse the
  first), i.e. one net *extra* compile at load, with the real first
  user-facing transition still paying full price afterward.
- Worse, it broke `npm run dev`: `main.tsx` wraps the app in `<StrictMode>`
  unconditionally, and StrictMode's synchronous mount → cleanup → remount
  runs before any timer fires. The first invocation set `warmed.current =
  true` and scheduled the revert; the simulated cleanup `clearTimeout`'d it
  immediately; the second invocation was blocked by the `warmed.current`
  guard and never rescheduled it. Net: `isLowPerf` got stuck permanently
  `true` in dev — no corona, no halo, no warp tunnel, no shooting stars, no
  Bloom — for the entire session. The e2e suite never caught this because
  `harness.mjs`'s `withPage` force-calls `setLowPerf(false, true)` for an
  unrelated reason, incidentally papering over it.

So the `gl.info.programs.length` gate ("does it climb on the transition")
was met, but it was measuring the symptom, not whether the proposed remedy
could actually deliver — it can't, and it cost real breakage to boot.

## Tooling

### The plasma liveness precondition asserts an exact count that frame timing can move

`tests/e2e/transition.probe.mjs` asserts `activeAnomalies === 40` between its two
counter reads, to stop the three zero-delta assertions passing vacuously if
spawning ever breaks. Good check, brittle threshold: `stepAnomalies` deactivates
any anomaly within 0.4 units of the ship, and the probe's 40 synthetic click
points land on a plane pinned to the ship's own position facing the camera. At
real frame rates the nearest points can be absorbed before the read, so the
assertion is frame-rate dependent.

It has reported 40 on every run so far, because at SwiftShader speeds the chase
camera has not converged and the click grid maps much wider than it would on
real hardware.

Fix: assert `>= 35`, or move the click grid off screen centre. The check's teeth
come from "not zero", not from "exactly 40".

### The startup-duration ceiling is too loose to fire

`STARTUP_DURATION_CEILING_MS` in `tests/e2e/harness.mjs` is 45,000 ms, derived as
~1.6x the 28,358 ms scene-ready time measured while diagnosing the eager-compile
regression. But that figure was captured on a machine at load average 15;
observed durations in normal runs are 17-18 s, making the real slack ~2.5x —
looser than the 2.1x the review objected to when this ceiling was added.

So a doubling of the current compile time would still pass silently, on the one
guardrail covering the metric the perf uplift deliberately made worse.

Fix: re-baseline against the observed 17-18 s and tighten to roughly 30,000 ms.
Record the new figure in `docs/PERF-BUDGETS.md` alongside the old one.

### `gameTime`'s discontinuity upper bound has no unit coverage

`src/utils/ambientTime.ts`'s `gameTime()` skips any frame whose delta exceeds
`DISCONTINUITY_SECONDS`, which is what protects it from R3F assigning the raw
rAF millisecond timestamp to `clock.elapsedTime` under `frameloop="never"` — a
~1000x artifact. That branch is the whole reason the guard exists, and no test
exercises it: every case in `tests/ambientTime.test.ts` either steps by under 30
seconds or steps backwards. The code was verified correct against R3F's source;
the coverage has a hole.


### `noBackdropFilter` guardrail reports shifted line numbers

`tests/noBackdropFilter.test.ts` strips `/* */` comment blocks by replacing them
with the empty string before splitting into lines, so any offender below a
multi-line comment is reported with a line number short by that comment's
newline count. Detection is unaffected — only the `file:line` pointer in the
failure message. `src/index.css` has a 6-line comment block near the top, so
this will bite there first.

Fix: replace each comment match with an equal run of newlines instead of `""`.

### `noBackdropFilter` guardrail does not scan `index.html`

The guardrail walks `src/` only. `index.html` at the repo root already carries an
inline `<style>` block and a `style=""` attribute on the pre-canvas loading
overlay, so a `backdrop-filter` added there would go undetected.

Low real risk, since that overlay renders before the WebGL canvas mounts and so
is not blurring a live canvas — but it is a genuine gap in the guard's coverage.
