# Follow-ups

Findings noticed while working on something else and deliberately not fixed at
the time, so the change in flight stayed scoped. Each one is real and
reproducible; none is urgent enough to have justified widening a branch.

Delete an entry when it is fixed.

- **Bake Fuxx's albedo into the texture.** The shared dark-surface display
  curve (`displayAlbedo.ts`, P3) draws Fuxx 3× brighter because its baked map
  is ~1.4% median linear luminance, far below a C-type's ~4%. Raising it in
  `scripts/textures/gen_planets.mjs` would let the curve lift it less: then
  update `PLANET_PROPS.fuxx.texelMedianLinear` (tests/displayAlbedo.test.ts
  checks it against the map) and re-pick the curve's calibration, which today
  pins γ by Fuxx's median getting 3×.
- **Owner ruling owed: dark worlds and ice giants under the 25-luma target.**
  At a 2.5×-size, ~22° phase frame the lit-side disc medians are rock 19,
  dwarf 14, Fuxx 15, tilted 22, blue 24 (ringed 30, Ruangrapi ~40, Portfolio
  51). The display curve cannot fix the dark ones within its own terms: it
  is identity at Ruangrapi's median and strictly increasing, so no body below
  the knee can be drawn above 0.0533, and at exactly 0.0533 the rock reads 22
  and the dwarf 16 (displayed-albedo sweep on the same frame). The giants'
  named suspects were measured one at a time: roughness 0.95 → 0.8 or 1.0
  moves the median 0, the Atmosphere shell 0 (it only adds a rim), the limb
  darkening 1–2. What is left is the law's distance falloff and the PBR
  Neutral tone curve's toe, which is global (P4). The choices: accept these
  as the lawful result; or change the toe or exposure globally and
  re-baseline Fuxx and Portfolio; or raise the knee above Ruangrapi's median,
  which lifts Ruangrapi too.
  Since the camera adapts fully (2026-10-19, L19) the same frames read rock
  25, dwarf 23, Fuxx 19, tilted 34, blue 35, ringed 39, Ruangrapi ~39 and
  Portfolio 50: only the dwarf and Fuxx are still under 25.
- **Night-side red glow breaks L29.** The faint red on night sides is the
  specular IBL reflection of the `#ff5500` Lightformer in the studio
  `<Environment>` (GlobalCanvas.tsx), constant and lifted by exposure. Fix:
  give planet and cloud materials an explicit `envMap` with a low
  `envMapIntensity`, or neutralise the orange Lightformer. Verify the e2e
  programs probe still reports `added=0`.
- **Draw the Jupiter-type oblate.** Portfolio is a round sphere, but a real
  Jupiter-type is 6.5% flattened (Jupiter's own (equatorial − polar) /
  equatorial). The ringed giant already draws its 10% through `flattening`
  in `src/data/worlds.ts`; give `PLANET_PROPS` the same field and scale
  Portfolio's polar axis, with its atmosphere and limb shells. Its occluder
  and clearance stay on the equatorial radius (L36).
- **C2, the cartographer in the live sky (PR #37).** The `ch` field on the
  wire, the AURUM plume, the shout-out and the consent update. It touches
  `beacon-api/`, `src/utils/liveSkyProtocol.ts` and `src/data/plumeColors.ts`,
  so the Worker is deployed and verified first, then the site merges (spec
  `docs/superpowers/specs/2026-10-17-new-worlds-design.md`, "Shipping").
- **New Worlds C1 minors, left for later** (each noticed in review, none
  wrong on screen):
  - Comments: `DistantGalaxies.tsx` and `RadarMap.tsx` still say the system
    is 400; `worlds.ts` gives the ringed giant–dwarf gap as 3.56
    on one world and 3.55 on the other; `guideLine.ts`'s ring-strip epsilon
    reasoning does not hold under linear filtering; `gen_worlds.mjs` blames
    8-bit quantisation for the maps' drift where it is lossy chroma (hue band
    margin ~0.03); `gen_world_dwarf.py` says Occator is 4 km deep where the
    code makes ~5.6 km; `assetContracts.test.ts`'s cap comment overstates the
    new maps (~0.15 MiB real); `worldMaps.test.ts` labels KiB caps as KB;
    `deepSpacePoint.mjs` and `harness.mjs` claim comet, jelly and landmark
    clearances no test enforces, and `DEEP_SPACE_POINT` has no 3-tuple JSDoc.
  - Duplication: `SpaceWorlds.tsx` exports `ICE_GIANT_DUSK` from a component
    (the test imports the `.tsx`; move it to `atmosphereMaterial.ts`), its
    `mapUrl` re-implements `planetMap`'s non-hi-res branch, and its per-tier
    `uNightFloor` effect copies SpacePlanets' (extract a hook); the worlds'
    albedo targets are written in three places (`gen_worlds.mjs`,
    `gen_world_rock.py`, `worldMaps.test.ts`); `surface_lib.py`'s
    `soften_sphere` repeats `soften`'s latitude pass; the turntable script
    recomputes exposure instead of calling `targetExposure`, and loads the
    TypeScript through jiti, which is only a transitive dependency.
  - Tests: `fillLight.test.ts`, `starLayer.test.ts` and `ringOptics.test.ts`
    pin wiring and GLSL by source regex rather than behaviour;
    `destinations.test.ts`'s `nextWaypoint` check is near-tautological (assert
    WaypointDriver's real list); the orbit-line in-plane placement test was
    deleted and wants a regression test back; the codec-fidelity guard skips
    in CI (no `assets-src`); `w-dwarf_normal`'s seam reads 4.65 against a
    bound of 5 (the plan's 2/255 was ratified as < 5 for the normal maps);
    `tsconfig.app.json` type-checks `src` only, so `tests/` is never
    type-checked.
  - Look and feel: `gen_world_rock.py`'s ray bundles share one random stream,
    so the lesser ray systems still read as stars; the camera shake after a
    push-out can briefly clip the near plane's corners into a world after a
    bounce; the slingshot badge's short hint still says "SLINGSHOT A PLANET"
    (its long hint says "PLANET OR WORLD").
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
