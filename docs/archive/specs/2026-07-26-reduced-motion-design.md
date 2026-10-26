# Reduced Motion — Design

**Date:** 2026-07-26
**Status:** Approved by user (default behaviour = calm the world, keep flight)

## Goal

Honour `prefers-reduced-motion: reduce` in a portfolio whose core interaction is flying a
spaceship. Today the site has no handling at all, which is a real accessibility gap for a page
built on bloom, chromatic aberration, warp tunnels, camera shake, a full-screen teleport flash
and eighteen independently animating canvas components.

## The principle this design rests on

`prefers-reduced-motion` exists for **vestibular** triggers: unrequested, large-field motion.
WCAG's intent is that motion the *user initiates* is generally acceptable; it is *involuntary*
motion that causes harm.

That distinction is what makes this tractable. Flying is user-driven and stays. The camera shake
on impact, the teleport flash on a wrap, the warp tunnel, and the constant drift of nebulae,
stars, comets and traffic are not user-driven, and those are what stop.

**Reduced motion is not an alias for low-perf.** `isLowPerf` drops effects by *cost*, to protect
framerate. Reduced motion drops them by *cause*, regardless of cost. They overlap (warp tunnel,
shooting stars) but diverge in both directions: reduced motion must also kill the camera shake and
teleport flash, which are cheap and which low-perf deliberately keeps; and it has no reason to
*unmount* the sun corona the way low-perf does, since the corona is expensive but not a vestibular
trigger — under reduced motion it stays on screen and merely stops animating.

## Decisions (user-confirmed)

1. **Default = calm the world, keep flight.** Rejected: defaulting to the classic resume (hides
   the entire sandbox from everyone with the OS flag set, including people who enable it for
   battery or mild preference); and a first-load interstitial (friction before content, plus
   persistence complexity).
2. **Orbits freeze rather than slow.** Simpler, and `bodies` positions merely stop changing, so
   orbit-lock, radar, scan and the shard systems keep working untouched. A frozen solar system
   loses the "living" quality deliberately — that is what the visitor asked for.
3. **Impacts still register.** Ramming an asteroid keeps its sound, HUD counter and chatter. Only
   the visual jolt goes. The feedback survives without the vestibular trigger.

## 1. Architecture: one shared clock, not eighteen conditionals

**Verified constraint:** eighteen components under `src/components/canvas/` call `useFrame`, most
driving motion from `state.clock.getElapsedTime()` or `delta`. Gating each with its own
`!reducedMotion &&` would mean eighteen chances to miss one, and no way to test the property as a
whole.

Instead, introduce a single ambient time source.

### New module `src/utils/ambientTime.ts`

Pure, testable, no React:

**`ambientTime(realElapsed)` is a pure function of real elapsed time plus how long ambient motion
has been frozen — deliberately NOT an accumulator advanced by one privileged component.**

- The module remembers `lastReal` and `t`.
- On each call: if `realElapsed` differs from `lastReal`, advance `t` by `realElapsed - lastReal`
  when enabled (by nothing when disabled), then store `lastReal = realElapsed`.
- **Correction (final review):** callers within one frame do not read one identical value in
  production. `THREE.Clock.getElapsedTime()` is itself mutating — it calls `getDelta()` internally
  in three@0.185.1 — so each of the 14 call sites passes a slightly larger `realElapsed` than the
  last within the same frame, and each nudges `t` forward by that small slice. The consequence is
  nil: the total advance across the frame still equals real elapsed time, exactly as before this
  module existed, and this is order-independent regardless of which consumer runs first. Only the
  "identical value" phrasing was wrong; `tests/ambientTime.test.ts` only demonstrates the accumulator
  with a synthetic constant argument, which is a different case from the mutating clock in
  production.
- `setAmbientEnabled(enabled: boolean)` — driven by the store.

**Why not a privileged `advance(delta)` in `GlobalCanvas`:** that requires consumers to run after
the advancer, and controlling `useFrame` order means using its `renderPriority` argument — which in
R3F **takes over the render loop for any priority > 0**, obliging manual `gl.render()` calls. Using
that for mere ordering would be a serious and easily-missed regression. Deriving `t` from the clock
value each consumer already receives removes the ordering question entirely: no privileged
component, no priority argument, order-independent by construction.

Consumers pass the clock they already have — `ambientTime(state.clock.getElapsedTime())` — so no
component gains a new dependency.

**Decorative components read `ambientTime()` instead of `state.clock.getElapsedTime()`.** The
ship, camera, input, physics and collision keep using `delta` and the real clock — they are
user-driven and must never freeze.

**Why this is better than per-component flags:** one concept, one unit test on the accumulator, and
the freeze property holds for any future decorative component that adopts the helper. It also means
"is ambient motion frozen?" is answerable by reading one value in an e2e probe.

## 2. What changes, by tier

### Tier 1 — involuntary jolts, off entirely

| Effect | Location | Change |
|---|---|---|
| Camera shake on impact | `Spaceship.tsx:404-406` (`shake.current`, set at `:303`) | Skip the camera offset. The impact itself, at `:303`, still fires sound/counter/chatter. |
| Teleport flash | `App.tsx:53` (`isTeleporting`), triggered `Spaceship.tsx:324` | Do not render the full-screen 0.85-opacity flash. Wrapping still happens. |
| Chromatic aberration | `GlobalCanvas.tsx:278` (`offset` on warp) | Pin to `[0, 0]`. |
| Warp tunnel | `GlobalCanvas.tsx:242` | Unmount, as low-perf already does. |

### Tier 2 — unrequested ambient drift, frozen via `ambientTime()`

Star shells and DustField (`GlobalCanvas.tsx`), nebula hue drift and particle swirl
(`SpacePlanets.tsx`), cloud rotation (`CloudLayer.tsx`), planet orbits and spin
(`SpacePlanets.tsx`), sun corona shader time (`Sun.tsx`), asteroid tumble (`Asteroids.tsx`), belt
rotation (`AsteroidBelt.tsx`), comets (`Comets.tsx`), jellyfish undulation
(`SpaceJellyfish.tsx`), cargo traffic (`CargoTraffic.tsx`), distant galaxies
(`DistantGalaxies.tsx`), portal ring (`PortalRing.tsx`), shard bob and spin (`DataShards.tsx`).

`ShootingStars.tsx` is unmounted rather than frozen — a frozen meteor mid-streak is an artifact,
not calm.

`PlasmaAnomalies.tsx` is user-initiated (spawned by clicking), so it keeps animating. Its spawn
burst is a direct response to input, which the principle in this spec permits.

### Tier 3 — DOM and CSS motion

- `src/index.css:80` — `animation: pulseGlow 3s infinite alternate`.
- Tailwind `animate-pulse` / `animate-bounce` / `animate-fade-in` across HUD, modals and Contact.
- framer-motion transitions on modals and the dossier.

**Explicitly unchanged:** the scanline overlay in `App.tsx` is a static CSS gradient with no
animation, so it is not a motion concern and stays as-is. Noted here only because its name suggests
otherwise and a future reader would reasonably look for it in this list.

**Deliberate residual exception:** `RadarMap.tsx`'s sweep line rotates continuously off
`performance.now()`, ungated, inside a `<canvas>` 2D loop that CSS neutralisation cannot reach.
Judged acceptable at 148px and ≤35% opacity — small enough, and low-contrast enough, that it does
not read as the large-field motion `prefers-reduced-motion` targets. Recorded here so it is a
decision rather than an omission; the code is intentionally left unchanged.

Handled by a `@media (prefers-reduced-motion: reduce)` block in `index.css` that neutralises
animation and transition durations, **plus** a `data-reduced-motion="true"` attribute on
`<html>` carrying the same rules — so the manual toggle (§3) also drives CSS, which a bare media
query cannot do.

## 3. Precedence: manual choice beats the OS signal

The OS flag is a blunt instrument. Someone may set it for battery yet want the full show; another
may want calm without changing system settings. So a HUD toggle sits beside the existing low-perf
button (`HUDOverlay.tsx:109` is the precedent), and an explicit choice wins over the media query
and persists to `localStorage` — mirroring `lowPerfManual` and `fitz-sound-muted`.

Resolution order, extracted as a pure function so it can be tested without a DOM:

1. A stored manual choice, if present.
2. Otherwise the live media query.
3. Otherwise off.

Store shape mirrors the existing pattern: `reducedMotion: boolean`,
`reducedMotionManual: boolean`, `setReducedMotion(v, manual?)`. A hook in `App` syncs the media
query into the store and keeps `setAmbientEnabled` in step.

## 4. The perf guarantee must survive

This project's core guarantee is zero React commits during steady flight, currently verified at
delta=0. The flag changes only on an OS or user action, never during flight, so a selector
subscription cannot fire mid-flight. Even so:

- Mount-time gating (`{!reducedMotion && <ShootingStars />}`) uses a selector — fine, it does not
  change during flight.
- Per-frame decisions (camera shake) read `useSpaceStore.getState()` inside `useFrame`, adding no
  subscription to a hot component.
- `ambientTime()` is a plain module read, not React state.

**`perf.probe.mjs` must still report delta=0 after this change.** That is a required check, not an
assumption.

## 5. Error handling and edge cases

- `matchMedia` unavailable (old browser, SSR-ish context) → treat as no preference; never throw.
  `useMediaQuery` already initialises `false` and only reads inside an effect.
- `localStorage` blocked → fall back to the media query. The store's existing `safeGetJSON` /
  `safeSetJSON` helpers already swallow this.
- OS setting toggled mid-session → the existing `change` listener updates live, unless a manual
  choice is set, which continues to win.
- Photo mode already freezes ship physics; reduced motion must not fight it. Photo mode with
  reduced motion on is a fully static scene, which is coherent. **Final review correction:** this
  was not true as first implemented — the idle bob (photo mode and orbit lock, 0.05 units) and the
  free-flight roll wobble (0.03 rad) in `Spaceship.tsx` ran on the real clock, unconditionally. Since
  these are decorative flourishes rather than physics, they were moved onto `ambientTime()`, which
  freezes with reduced motion on — so the sentence above now holds literally, not just in intent.
- A frozen `ambientTime()` must not divide-by-zero or NaN any shader uniform that derives from it.

## 6. Testing

**Unit (vitest):**
- `ambientTime` — advances when enabled, holds exactly when disabled, resumes from the held value
  rather than jumping.
- The precedence function — manual choice beats media query in both directions; no stored choice
  defers to the query.

**E2E — new `tests/e2e/reducedmotion.probe.mjs`,** using
`page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }])`:
- `ShootingStars` and `WarpTunnel` absent from the scene.
- `ambientTime()` does not advance across 2s, while the real clock does.
- A planet's position is unchanged across 2s (orbits frozen).
- Ramming an asteroid increments `impactCount` **and** leaves the camera unshaken.
- No teleport flash element appears across a wrap.
- **Flight still works** — the ship displaces under thrust. This is the check that proves the
  premise was not broken, and it is the most important assertion in the probe.

**Regression:** the existing 101 checks must stay green, since the default is no-preference; and
`perf.probe.mjs` must still show delta=0.

## 7. What does not change

Flight, orbit lock, radar, scan, shard collection, HUD readability, audio, the contact form, and
the classic resume. The ship still moves, because the user moves it.

## 8. Out of scope

Code splitting / lazy-loading the canvas (a separate concern, tracked separately), the
`THREE.Clock` → `THREE.Timer` deprecation, and any change to the low-perf system's own behaviour.
