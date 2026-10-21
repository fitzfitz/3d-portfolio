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
  Both were seen with the studio IBL still on the bodies; PR #42 took it
  off (`noIbl.ts`, L29), and its orange and cyan panels tinted lit sides
  too. Same pose and exposure, 2.5× size at 22° phase, inner 60% of the
  disc, IBL on → off: median luma Venus 39.9 → 39.3, Earth 23.5 → 21.8,
  Mars 36.6 → 35.6, Jupiter 48.7 → 47.4, Saturn 52.3 → 50.7, Uranus
  45.5 → 43.7; mean sRGB blue Saturn 22.3 → 18.3, Uranus 45.0 → 42.0,
  Earth 26.3 → 22.3 (the cyan panel had been adding blue). Re-shoot
  before ruling.
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
    ×0.15), not the full 0.15. Left while the look-check renders back an
    owner colour decision (2026-10-21).
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
  alone, best of three each) before the ceiling is next touched.

