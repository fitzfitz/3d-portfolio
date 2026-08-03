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

## Tooling

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
