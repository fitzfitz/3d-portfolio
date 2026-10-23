# Follow-ups

Findings noticed while working on something else and deliberately not fixed at
the time, so the change in flight stayed scoped. Each one is real and
reproducible; none is urgent enough to have justified widening a branch.

Delete an entry when it is fixed.

- **Memory, past PR 53** (docs/superpowers/specs/2026-10-22-memory-budget-design.md;
  Chrome's memory-infra dump, 2026-10-23, at 1512×802@2):
  - ~550 MB of the GPU process is Chrome's own for any WebGL page here (a blank
    WebGL2 canvas: ANGLE/Metal 252 MB, shared images 304 MB). ANGLE holds what
    the page allocates plus ~255 MB more, internal and not reachable from the
    page. An opaque canvas (`alpha: false`) changed nothing.
  - Done: the HTML overlays were five full-window layers over the canvas (PRs
    51, 52: ~80 MB of the GPU process); the HUD rewrote unchanged text every
    frame, growing Blink's heap ~2.6 MB/s at rest (PR 53, now ~0.3 MB/s).
  - The model textures are still WebP: ~196 MB uncompressed on the GPU.
    Colour as ETC1S and normal/roughness as UASTC measured −136 MB for +9 MB
    of download; the owner deferred it (2026-10-23) to keep the hero ship sharp
    and the first load fast. GlobalCanvas's pack-entry `useGLTF.preload` runs
    before a renderer exists, which KTX2Loader.detectSupport needs: queue it.
  - What is left of Blink's growth (~0.3 MB/s at rest) is the radio's
    typewriter and other text that really changes.

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
  SLINGSHOT_SPEED only for impact parameters b ≈ 29.5–30.5 u; the tests fly
  a single b (30). Since 2026-10-21 the Sun's well is watched like a
  planet's (`wellAt` over every active well), so that skim earns the whoosh,
  the radio line and the badge (tests/gravityWell.test.ts), but the window is
  still hard to find by hand. Revisit with F2 (Newtonian ship gravity), which
  replaces the well law; do not retune G alone, since 4,000 already brings a
  surface touch.
- **Jellyfish guide, left for later** (spec
  docs/superpowers/specs/2026-10-23-jellyfish-guide-design.md, PR #54):
  - No gamepad button calls the guide (build ruling R2). The spec assumed J
    already had one; nothing maps to it in `utils/gamepad.ts`, and inventing
    one risked clashing with the layout: every face, shoulder and d-pad
    button is taken; only the stick clicks (buttons 10 and 11) are free. Pick
    one with the owner and have it call `requestGuideToggle()`, as the touch
    GUIDE button does.
  - Arriving does not lock the HUD's target (build ruling R9). The spec says
    "the HUD's target locks on", but no store action locks a target; the
    guide only arrives at the radius where the HUD's own target line locks
    on. Wants a lock flourish action the guide can call on `arrived`.
  - The memory probe's idle allocation ceiling (`ALLOC_KB_PER_FRAME`, 160 KB
    a frame in `tests/e2e/memory.probe.mjs`) is flaky at baseline: about 2
    runs in 6 over, median ~142 KB, measured while building the guide and
    not caused by it. Find the remaining per-frame garbage or re-measure the
    ceiling on a quiet machine.
  - The guide's lean toward the target (`GUIDE_LEAD_MAX_ANGLE`, added after
    #54) is 20°, the largest that keeps it on a landscape screen in every
    direction. A lean straight up from a hovering ship sits 26.9° above the
    view axis, inside the 29° vertical half-fov; the derivation is in the
    constant's comment. That is an accepted limitation: on a portrait phone
    the horizontal half-fov is only ~14°, so a sideways lean (~16° off the
    axis) is still off screen. Within ~37 u of its target (20 u plus the
    16.7 u presenting radius) the station is beside the target, wherever the
    nose points, so a reduced-motion call made there can still appear out
    of view.
  - The keep-out list holds the planets only (SolarBodies). The guide keeps
    its own target's radius clear (the station or portal it leads to), but
    not a station it only passes (the shipyard, or the career station on the
    way to a probe), nor the moons. Add the destinations (career station
    5.2 u, shipyard 4.8 u, portal frame 7.0 u from their centres) and the
    moons (moving, like the planets) to the list.
- **SwiftShader start-up rose with the real Solar System.** The start-up
  probe's best of three read 13.0 s and 15.4 s in two full runs on PR #40's
  branch, against 10.1–12.1 s for New Worlds: inside the 20 s ceiling, not
  bisected. Suspects: the NASA maps' texture uploads and the nine moons'
  materials at warm-up. Bisect over the branch's commits (`startup.probe.mjs`
  alone, best of three each) before the ceiling is next touched. Tried
  2026-10-21 and abandoned: the machine sat at load 21–46 from other
  processes, and main (6513572) itself read 12–51 s a load, so bisect on a
  quiet machine.

