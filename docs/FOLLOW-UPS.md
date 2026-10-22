# Follow-ups

Findings noticed while working on something else and deliberately not fixed at
the time, so the change in flight stayed scoped. Each one is real and
reproducible; none is urgent enough to have justified widening a branch.

Delete an entry when it is fixed.

- **Memory, past PR 47** (docs/superpowers/specs/2026-10-22-memory-budget-design.md;
  the game's live share is 909 MB at 1512×802, the target 500):
  - Chrome's GPU process sits ~600 MB above everything WebGL is asked for
    (ledger 388 MB, process 990 MB), in every build measured. Compositing of
    the HUD at device scale 2, the canvas's swap chain and ANGLE/Metal's own
    copies are the suspects; Chrome's memory-infra tracing would split it.
    The largest remaining chunk, and not yet known to be reachable from the page.
  - The model textures are still WebP: ~196 MB uncompressed on the GPU.
    Colour as ETC1S and normal/roughness as UASTC measured −136 MB for +9 MB
    of download (the owner kept maps only, 2026-10-22). GlobalCanvas's
    pack-entry `useGLTF.preload` runs before a renderer exists, which
    KTX2Loader.detectSupport needs: queue it until the canvas is created.
  - In some production sessions the tab's V8 memory climbs ~2.6 MB/s, outside
    the JS heap (which stays ~41 MB), until a major GC clears it; in others it
    stays flat. Not the cargo wakes (both builds do it) and the dev build does
    not reproduce it, so typed-array or WebSocket buffers in a prod-only path
    are the suspects. It makes "steady" footprints swing ±150 MB with GC
    timing; memory-footprint.mjs's post-GC "live" figure is the one to compare.
  - JS allocation is ~114 KB a frame while flying: three's per-draw uniform
    uploads (~36 KB) and many 1–10 KB app sites (AsteroidBelt, RadarMap,
    Spaceship, nearestScannable, sunVisibility), mostly doubles boxed by
    calls V8 does not inline.
  - `.claude/worktrees/agent-ac262aec2ebdde563` (PR 43's branch, merged) is a
    stale agent worktree; vite.config.ts now keeps vitest out of `.claude/`.

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
- **J summons the jellyfish to the spawn pad, not to you.** The key jumps
  its loop to `JELLY_NEAR_T`, the pass nearest the sun just ahead of the pad
  (PR #45), so from anywhere else it lands up to ~300 u away. Jumping to the
  loop phase nearest the ship instead is a few lines in `SpaceJellyfish`
  (sample the path, take the closest t); the reactions probe would then
  stop depending on the pad. Left alone because the QA checklist and the
  probe both use J from the pad today.
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
- **SwiftShader start-up rose with the real Solar System.** The start-up
  probe's best of three read 13.0 s and 15.4 s in two full runs on PR #40's
  branch, against 10.1–12.1 s for New Worlds: inside the 20 s ceiling, not
  bisected. Suspects: the NASA maps' texture uploads and the nine moons'
  materials at warm-up. Bisect over the branch's commits (`startup.probe.mjs`
  alone, best of three each) before the ceiling is next touched. Tried
  2026-10-21 and abandoned: the machine sat at load 21–46 from other
  processes, and main (6513572) itself read 12–51 s a load, so bisect on a
  quiet machine.

