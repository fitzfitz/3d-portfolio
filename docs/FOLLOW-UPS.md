# Follow-ups

Findings noticed while working on something else and deliberately not fixed at
the time, so the change in flight stayed scoped. Each one is real and
reproducible; none is urgent enough to have justified widening a branch.

Delete an entry when it is fixed.

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
