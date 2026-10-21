# Follow-ups

Findings noticed while working on something else and deliberately not fixed at
the time, so the change in flight stayed scoped. Each one is real and
reproducible; none is urgent enough to have justified widening a branch.

Delete an entry when it is fixed.

- **Owner ruling owed: dark bodies under the 25-luma target.** The display
  curve (P3, `displayAlbedo.ts`) is the identity at Earth's map median
  (0.0766) and strictly increasing below it, so no body below the knee can be
  drawn brighter than 0.0766: it lifts Ceres 3×, the Moon 2.47×, Mercury
  2.17×, Mars 1.93×, Callisto 1.79× and Titan 1.63× (Phobos 3.59×, Deimos
  3.27×). The real bodies' lit-side disc medians have not been measured
  against the 25-luma target yet: measure Ceres, Mercury, Mars, the Moon,
  Callisto, Phobos and Deimos at a 2.5×-size, ~22° phase frame. (The same
  check on the retired fictional system left its two darkest bodies under 25
  even after full adaptation; roughness, the atmosphere shell and limb
  darkening each moved the median by 0–2.) What the curve cannot fix is the
  PBR Neutral tone curve's toe, which is global (P4). The choices: accept the
  lawful result; or change the toe or exposure globally and re-baseline every
  body; or raise the knee above Earth's median, which lifts Earth too.
  **Also owed (Ruling R29, 2026-10-20):** Venus's, Saturn's and Uranus's
  discs read olive rather than cream or pale cyan. It is not their maps or
  rims (Venus with its rim hidden reads the same): their surfaces sit at
  ~0.03–0.08 linear on the scene's 0.177 × albedo scale, where the PBR
  Neutral tone mapper's toe subtracts the smallest channel and crushes blue,
  so a warm grey turns olive-brown. A fix is global (exposure, the knee or
  the toe) and re-baselines every body, so it is the same owner call as the
  one above. Screenshots: the real-solar-system run's Task 15 look check.
- **New Worlds C1 minors, left for later** (each noticed in review, none
  wrong on screen; the items about `worlds.ts`, `SpaceWorlds.tsx`,
  `worldMaps.test.ts`, the w-rock and w-dwarf maps and the assetContracts cap
  comment went with the fictional worlds in PR #40):
  - Comments: `guideLine.ts`'s ring-strip epsilon reasoning does
    not hold under linear filtering; `gen_worlds.mjs` blames 8-bit
    quantisation for the maps' drift where it is lossy chroma (hue band
    margin ~0.03); `harness.mjs` says the deep-space point is clear of every
    landmark, which no test enforces (`tests/solarClearance.test.ts` holds it
    60 u from the swept orbits, belt, Trojans and comets only), and
    `DEEP_SPACE_POINT` has no 3-tuple JSDoc.
  - Dead generators: `scripts/blender/gen_world_rock.py` and
    `gen_world_dwarf.py` remain although their maps were retired (the real
    Mercury and Ceres wear NASA mosaics); delete them, or keep them only as
    `surface_lib.py` examples. Their own minors (the rock's ray bundles share
    one random stream; the dwarf's comment says Occator is 4 km deep where
    the code makes ~5.6 km) go with them.
  - Duplication: `surface_lib.py`'s `soften_sphere` repeats `soften`'s
    latitude pass; the turntable script (`turntable_bodies.py`) recomputes
    exposure instead of calling `targetExposure`, and loads the TypeScript
    through jiti, which is only a transitive dependency.
  - Tests: `fillLight.test.ts`, `starLayer.test.ts` and `ringOptics.test.ts`
    pin wiring and GLSL by source regex rather than behaviour;
    `destinations.test.ts`'s `nextWaypoint` check is near-tautological (assert
    WaypointDriver's real list); the codec-fidelity guard skips in CI (no
    `assets-src`); `tsconfig.app.json` type-checks `src` only, so `tests/` is
    never type-checked.
  - Look and feel: the camera shake after a push-out can briefly clip the
    near plane's corners into a body after a bounce; the slingshot badge's
    short hint still says "SLINGSHOT A PLANET" (its long hint says "PLANET OR
    WORLD").
- **E2E checks that cannot fail as written** (read-only probe audit during the
  e2e speed-up, 2026-10-19, each finding re-checked by a second reader; not
  fixed there, to keep that branch about speed):
  - `gameplay.probe.mjs:162-175`, the ring check runs while the scene loop is
    frozen, so it reads the same frame it set up.
  - `shipyard.probe.mjs:65`, the same: it reads a frozen frame.
  - `gamepad.probe.mjs:50-57`, "left stick turns the ship" passes on residual
    turn from the earlier steer, so a dead stick still passes. Settle the
    heading first, or raise the bar above 0.5 rad.
  - `touch.probe.mjs` RISE: coasting alone beats its +0.01 pitch bar. Wait
    for pitch to settle before `pitchBefore`, then assert it rises or reaches
    1.45.
- **E2E timing gambles the GPU does not remove:** `transition.probe.mjs`'s two
  orbit-lock setups miss at 25–46% of orbital phases (1–2.5 s of drift), and
  the 1800 ms `breakOrbit` cooldown can block the second lock (:676/:684).
  Pinning orbital phase with a debug hook would make its counters
  pose-determined. `logbook.probe.mjs:28` reads the badge line 400 ms after
  `recordBadge`; if any broadcast (silent chatter too) went out in the 3 s
  before (`BADGE_LINE_HOLD_MS`), `announceLogbook` defers the line by 4.5 s
  (`BADGE_LINE_DELAY_MS`) and the read misses it. Poll the aria-live text for
  SLINGSHOT EARNED (about 6 s) instead of a fixed settle.
- **The real star catalogue.** The background is still the painted Milky Way
  and three random star shells (L24). An astronomy fan who flies to Earth
  expects the real sky: the constellations from a catalogue (e.g. Hipparcos
  or Yale BSC, brightest few thousand), Polaris within a degree of Earth's
  IAU north pole, the Milky Way band along the real galactic plane, and
  every pole in the scene pointing where the real sky says (the poles are
  already IAU, `bodySpin.ts`). A non-goal of the real-solar-system PR (#40,
  spec §2), named there as the natural next step. Keep it inside the
  program and draw-call budgets (one Points per magnitude band).
- **The sun slingshot is a knife-edge.** With the Sun's well cut to 34 u
  (inside Mercury's perihelion, PR #40) and G 3,500, a sun skim leaves above
  SLINGSHOT_SPEED only for impact parameters b ≈ 29.5–30.5 u; the test flies
  a single b (30). It is earnable but hard to find by hand. Revisit with F2
  (Newtonian ship gravity), which replaces the well law; do not retune G
  alone, since 4,000 already brings a surface touch.
- **Convoy events skip Mercury.** The convoy world event flies to the body
  nearest the ship (`WorldEventDirector.tsx`), and its delivery orbit around
  Mercury (convoyRadius 20.8 u at r 35–54) almost always crosses the Sun's
  34 u keep-out, so no route clears and the director silently skips the event.
  From the spawn pad (0.92 AU) Mercury or Venus is often the nearest body,
  depending on the date. Lawful-looking but quiet: choose "the nearest body
  with a clear route" instead, if convoys should show up more near the Sun.
  (`events.probe.mjs` parks by Earth before triggering one.)
- **SwiftShader start-up rose with the real Solar System.** The start-up
  probe's best of three read 13.0 s and 15.4 s in two full runs on PR #40's
  branch, against 10.1–12.1 s for New Worlds: inside the 20 s ceiling, not
  bisected. Suspects: the NASA maps' texture uploads and the nine moons'
  materials at warm-up. Bisect over the branch's commits (`startup.probe.mjs`
  alone, best of three each) before the ceiling is next touched.

