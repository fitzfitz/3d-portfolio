# Follow-ups

Findings noticed while working on something else and deliberately not fixed at
the time, so the change in flight stayed scoped. Each one is real and
reproducible; none is urgent enough to have justified widening a branch.

Delete an entry when it is fixed.

- **Uranus still reads teal-green.** With the hue-keeping toe and the 1.5×
  exposure lift (2026-10-21), its lit disc's median hue is ~160° against the
  174° its map and sunlight should give (b/g 0.97 against 0.99). The cause is
  not the tone curve: the warm `#fff4e0` sunlight times its map leaves green
  about equal to blue, and every curve tried (the toe, the knee, AgX) read
  158–160°. A fix is a bluer or brighter map, or whiter sunlight, which
  re-baselines every body.
- **Earth's lit disc reads grey-brown.** Since the studio IBL came off the
  bodies (1ffe387, L29), its blue/green is ~0.97 against the 1.56 its map
  should give: the IBL's cyan panel had been faking blue oceans, and its lit
  median is now cloud-dominated (hue ~40°). A targeted fix is the ocean
  albedo or the atmosphere rim's tint, not a global change to the light or
  the tone curve.
- **New Worlds C1 minors, left for later** (each noticed in review, none
  wrong on screen; the items about `worlds.ts`, `SpaceWorlds.tsx`,
  `worldMaps.test.ts`, the w-rock and w-dwarf maps and the assetContracts cap
  comment went with the fictional worlds in PR #40):
  - The turntable script (`turntable_bodies.py`) restates the exposure
    (every body lit as at 1 AU under a uniform 0.15 / PI fill) instead of
    calling `targetExposure`, and loads the TypeScript through jiti, which is
    only a transitive dependency (Node 22's type stripping cannot load `src/`:
    its imports are extensionless). Calling the game's functions needs each
    body's distance, and would change the inner planets' renders: inside
    1 AU the game's fill is AMBIENT_BASE × exposure (Venus ×0.52, Mercury
    ×0.15), not the full 0.15. The owner's colour decision came back
    2026-10-21 (the hue-keeping toe, `hueToe.ts`, and `EXPOSURE_LIFT` 1.5):
    the script applies neither, so its renders now sit ~0.58 stop under the
    game, and its Khronos curve keeps the olive toe.
  - Tests: `fillLight.test.ts`, `starLayer.test.ts` and `ringOptics.test.ts`
    pin wiring and GLSL by source regex rather than behaviour. Not a quick
    swap: vitest has no WebGL to run a shader and no R3F renderer to mount
    the JSX, so behaviour tests would be e2e (the sky probe already reads the
    fill, the star shells and the ring budgets in a browser). The
    codec-fidelity guard skips in CI (no `assets-src`).
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
  alone, since 4,000 already brings a surface touch. Note (2026-10-21): only
  the nine roster bodies' wells are watched for a slingshot (Spaceship's
  `wellNow` loop over BODY_REACH), so a fast exit from the Sun's well earns
  no whoosh, line or badge today; the physics test alone shows it is fast.
- **SwiftShader start-up rose with the real Solar System.** The start-up
  probe's best of three read 13.0 s and 15.4 s in two full runs on PR #40's
  branch, against 10.1–12.1 s for New Worlds: inside the 20 s ceiling, not
  bisected. Suspects: the NASA maps' texture uploads and the nine moons'
  materials at warm-up. Bisect over the branch's commits (`startup.probe.mjs`
  alone, best of three each) before the ceiling is next touched. Tried
  2026-10-21 and abandoned: the machine sat at load 21–46 from other
  processes, and main (6513572) itself read 12–51 s a load, so bisect on a
  quiet machine.

