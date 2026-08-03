# Performance Uplift: Eliminating Transition Hitches

**Date:** 2026-08-02
**Status:** Design

## Problem

The site is smooth during steady flight and janky at every state transition. Three
reported symptoms:

1. **Approaching a planet** — lag appears as the ship enters a gravity well.
2. **Clicking to spawn a plasma anomaly** — a visible stall on click.
3. **Orbit-locking into a planet** — heavy lag while the dossier modal is open.

Strolling through deep space, with no state changing, is smooth.

That distribution is the diagnosis. A fill-rate or geometry problem would degrade
steady flight too, and would scale with what is on screen rather than with what
just changed. Cost that appears only on transitions is cost incurred *by* the
transition.

## Evidence

Established by reading the code:

- `Atmosphere` and `CloudLayer` mount unconditionally (`SpacePlanets.tsx:397-455`).
  Nothing new enters the 3D scene when the ship nears a planet, so the approach
  hitch does not originate in the scene graph.
- `App` subscribes to ten store values (`App.tsx:25-34`) and renders
  `<GlobalCanvas />` as an unmemoized child (`App.tsx:77`). Any of those ten
  changing re-renders the entire canvas component.
- The postprocessing effects array is built inside an inline IIFE
  (`GlobalCanvas.tsx:285-301`), so each `GlobalCanvas` render passes
  `EffectComposer` a freshly constructed children array.
- Each plasma anomaly mounts its own `<pointLight>` (`PlasmaAnomalies.tsx:142`),
  on top of nine already in the scene (sun, ship ×2, portal ×2, planets ×3).
- Each anomaly also clones the GLTF scene and its materials on mount
  (`PlasmaAnomalies.tsx:84-112`), producing up to 40 unique materials.
- `.glass-card` applies `backdrop-filter: blur(12px)` and the HUD panel
  `blur(16px)` (`index.css:35-46`), both layered over the live canvas.
- `perf.probe.mjs` asserts zero React commits during five seconds of *steady
  flight* — the only state that was never slow. No transition is tested.

## Root causes

### RC1 — Render cascade from DOM state into the canvas tree (primary, unconfirmed)

`setActiveZone` or `setOrbitLocked` fires → `App` re-renders → `GlobalCanvas`
re-renders → the whole R3F subtree reconciles, and `EffectComposer` receives a new
children array which is expected to rebuild the effect chain, recompiling Bloom,
Vignette, ChromaticAberration and a 60-sample GodRays pass mid-flight.

This mechanism accounts for symptoms 1 and 2's timing and for the transition-only
distribution. It is a hypothesis derived from code reading, not a measurement, and
Task 1 exists to confirm or kill it before the rest of the work proceeds.

### RC2 — Shader permutation change on light count (confirmed by inspection)

Three.js includes the light count in the shader program cache key. Adding a
`<pointLight>` bumps `lightsStateVersion`, forcing every material in the scene to
recompile on the next frame. Each plasma spawn therefore triggers a synchronous
scene-wide recompile, and the steady-state cost then rises because every fragment
loops over up to 49 lights.

This cannot be solved by pre-warming: the spawn sequence walks 40 distinct
permutations (9 lights → 49), each requiring every material recompiled, and
pre-warming the 49-light variant would impose its per-fragment cost permanently.
The light has to go.

### RC3 — Compositor blur over a live canvas (confirmed by inspection)

`backdrop-filter` forces the browser to re-snapshot and re-blur the canvas region
every frame. The modal compounds this: it opens with a framer-motion `scale`
animation (`App.tsx:140`) and is `overflow-y-auto`, so the blur is recomputed
throughout the open transition and on every scroll tick.

The blur is also invisible. `bg-black/90` overrides the glass background, so the
cost buys nothing visually.

## Design principle

One rule, from which every change below follows:

> **Nothing is constructed while the user is in control.** No React reconciliation
> of the canvas tree, no shader compilation, no material or geometry allocation,
> and no compositor effects over the canvas — not on approach, not on click, not
> on modal open.

This is the game-engine "nothing is created during play" discipline. The current
architecture honours it during steady flight and abandons it at every transition.

## Changes

### A. Canvas isolation

- Wrap `GlobalCanvas` in `React.memo`. It takes no props, so DOM-state changes in
  `App` stop propagating into it entirely.
- Hoist the postprocessing effects out of the inline IIFE. Bloom, Vignette and
  ChromaticAberration become module-scope constants. `ChromaticAberration`'s
  `offset` currently allocates a new array per render; move the warp/idle values
  to two module-level constants selected by ternary.
- `GodRays` depends on `sunMesh` resolving, so it must stay conditional. Isolate
  it so its arrival does not rebuild the sibling passes.
- Establish the invariant: the canvas subtree re-renders only when `isLowPerf`,
  `reducedMotion` or `photoMode` change — never for `activeZone`, `isOrbitLocked`,
  `isNearSpawn`, `isTeleporting` or `broadcast`.

### B. Plasma anomalies as a preallocated pool

- Delete the per-anomaly `<pointLight>`. Glow comes from emissive material plus
  the existing Bloom pass, which runs at `luminanceThreshold={0.2}` and already
  blooms these at `emissiveIntensity={3.6}`.
- Replace the 40 cloned scenes with a single `InstancedMesh` built once at load:
  one shared geometry from `space_crystal.glb`, one shared emissive material,
  per-instance colour via instance colour attribute.
- Allocate all 40 slots at startup with `count` fixed and inactive slots scaled to
  zero. Spawn flips a dead slot to active and writes its transform. No allocation,
  no material creation, no shader compilation at click time.
- Keep the existing simulation loop shape from `stepAnomalies` — it already
  mutates in place and allocates nothing per frame.

### C. Modal cost

- Remove `backdrop-filter` and `-webkit-backdrop-filter` from `.glass-card` and
  the HUD panel rule. Replace with a solid background matching the current
  rendered appearance.
- Replace `transition: all 0.3s` (`index.css:46`) with explicit properties
  (`border-color`, `box-shadow`, `transform`).
- Remove `backdrop-blur-[3px]` from the teleport flash (`App.tsx:62`).
- Add an `isSceneFrozen` derived selector, true when a modal is open. Drive
  `frameloop={isSceneFrozen ? "never" : "always"}` on the Canvas, calling
  `invalidate()` once on unfreeze so the first post-modal frame renders.

### D. Preload and shader warm-up

- `<Preload all />` currently sits at `GlobalCanvas.tsx:306`, outside the
  `<Suspense>` boundary that closes at line 273. Verify whether it runs before the
  suspended GLTF subtree resolves; if so it is warming a near-empty scene. Move it
  inside the boundary.
- Add a deterministic load gate: hold the visitor on a progress screen until all
  eleven GLBs and three planet textures are fetched, decoded and uploaded. Total
  payload is 3.6MB, so this costs one to three seconds on a normal connection.
- Warm the state transitions known to remount components: toggling `isLowPerf`
  mounts and unmounts the sun corona, polar halo and warp tunnel. Walk these
  states during the load gate so no permutation compiles during play.
- Replace the pulsing "Initializing Star System..." text with a real progress
  indicator.

### E. Cleanup

- Delete `castShadow` from `Sun.tsx:172` and `SpacePlanets.tsx:393,425,451`. The
  `<Canvas>` has no `shadows` prop (`GlobalCanvas.tsx:179`), so these are inert.

## Guardrails

The permanent half of this work. Each targets a class of regression that shipped
undetected.

**Ordering note:** G5 is the instrument the other work is measured with, so it is
built *first*, before Task 1. G1–G4 encode numbers and invariants that only exist
once changes A–E have landed, so they come last.

### G1 — Transition commit assertions

Extend `perf.probe.mjs` to count canvas-tree commits *across* transitions, not
only during steady flight: approach a planet, orbit-lock, open a modal, spawn an
anomaly. Assert zero canvas re-renders for each.

**Amended after Task 6:** the orbit-lock/modal-open transition is NOT zero —
Task 6 deliberately adds a `selectSceneFrozen` subscription so `GlobalCanvas`
can react to the lock by flipping `frameloop` to freeze the canvas behind the
dossier. That reaction IS the feature, and it costs exactly one canvas
re-render per open (StrictMode double-invoke aside), not zero.
`tests/e2e/transition.probe.mjs` asserts this correctly as two separate
invariants: a re-render *does* happen when the modal opens (`delta > 0`), and
it does *not* keep happening while the modal stays open (`delta === 0` on a
subsequent settle) — see that file's own comment at the orbit-lock section for
the full reasoning. Approach, plasma-spawn and warp-toggle transitions remain
zero as originally specified here.

The existing steady-flight check uses a `<Profiler>` in `main.tsx` that wraps the
DOM tree only and cannot observe R3F's separate reconciler root. This guardrail
needs a counter inside the canvas tree — a `useRef` increment in `GlobalCanvas`
exposed via the debug bridge — to observe what the DOM Profiler structurally
cannot.

### G2 — Renderer counter budgets

Assert `renderer.info.render.calls`, `.triangles`, `.programs.length` and scene
light count against ceilings in four states: deep space, close approach, modal
open, 40 anomalies spawned.

These are deterministic under headless SwiftShader, unlike frame times. A
per-entity light, a draw-call blowup or a mid-session shader recompile each move
one of these numbers.

### G3 — Light budget constant

A `LIGHT_BUDGET` constant in `constants.ts` with a comment explaining the
permutation-recompile mechanism, asserted by G2. The next person reaching for a
`<pointLight>` hits a documented wall.

### G4 — Static check for canvas-killing CSS

A vitest that scans `src/**` for `backdrop-filter` and `backdrop-blur` and fails
on anything outside a documented allowlist.

### G5 — DEV perf overlay

Frame time p50/p99, draw calls, triangles, program count and light count, gated on
`import.meta.env.DEV`. This is where frame-time numbers are meaningful — real
hardware, not software rendering. It is the tool for diagnosing the next problem,
not just this one.

## Task 1: the verification gate

Before any other work: apply `React.memo` to `GlobalCanvas`, hoist the effects
array, and measure the approach and orbit-lock hitches with G5's overlay.

- **If the hitch disappears or drops sharply** — RC1 is confirmed, changes A, B, C
  proceed as written, and symptoms 1 and 3 collapse into one root cause.
- **If the hitch is unchanged** — RC1 is wrong. Symptom 1 needs fresh
  investigation, and change A shrinks to the effects-array hoist on its own
  merits; changes B, C, D, E and all guardrails still stand on their own
  confirmed evidence and proceed unaffected.

The spec is valid under either branch. Only the scope of symptom 1's fix depends
on the outcome.

## Budget derivation

G2's ceilings are not guessed. Procedure:

1. After changes A–E land, capture each counter in all four states via the G5
   overlay.
2. Set each ceiling at the measured baseline plus 15%, rounded up to the nearest
   ten for call and triangle counts, and to the exact value plus one for program
   and light counts, which should never grow at all during play.
3. Record the baselines and their capture date alongside the assertions, so a
   future change to the scene can distinguish an intentional increase from a
   regression.

## Risks and tradeoffs

**Freezing the scene during orbit lock.** The ship is circling a planet when the
dossier opens; freezing stops that motion, visible around the edges of a
`max-w-2xl` panel on a wide screen. It may read as "docked", matching the
`ORBIT_LOCKED` framing, or as crashed. Assessed visually during change C; the
fallback is freezing postprocessing only and letting the orbit continue, which
recovers most of the cost.

**`React.memo` masking future state needs.** If the canvas later needs a DOM-owned
value, `memo` will silently prevent it from arriving. Mitigated by the canvas
subscribing to the store directly, which is already the established pattern here,
and by G1 failing loudly if the subscription set changes.

**Load gate lengthens time to first interaction.** 3.6MB is one to three seconds
on a normal connection and considerably longer on poor mobile data. Mitigated by a
real progress indicator, which reads better than the current indefinite pulsing
text.

**`frameloop="never"` requires explicit invalidation.** Any code path that expects
continuous rendering while a modal is open will stall. Only the modal states set
the flag; photo mode, which needs continuous frames for OrbitControls, does not.

## Out of scope

- LOD or impostor systems for distant bodies. No evidence of geometry cost.
- Migrating away from three.js's forward renderer. A clustered or deferred
  renderer would decouple light count from shader permutations, but the light
  budget solves the actual problem at a fraction of the cost.
- Texture compression (KTX2/Basis). Worth revisiting if the load gate proves slow
  in practice; the current 3.6MB does not justify it.
- Reworking the `Trail` components on the ship and cargo traffic. Present during
  smooth steady flight, so not implicated.
