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
- **C2, the cartographer in the live sky (PR #35).** The `ch` field on the
  wire, the AURUM plume, the shout-out and the consent update. It touches
  `beacon-api/`, `src/utils/liveSkyProtocol.ts` and `src/data/plumeColors.ts`,
  so the Worker is deployed and verified first, then the site merges (spec
  `docs/superpowers/specs/2026-10-17-new-worlds-design.md`, "Shipping").
- **New Worlds C1 minors, left for later** (each noticed in review, none
  wrong on screen):
  - Comments: `DistantGalaxies.tsx` and `RadarMap.tsx` still say the system
    is 400; `sky.probe.mjs`'s corona calibration says exposure 2.5 (now 2.83
    at that distance); `worlds.ts` gives the ringed giant–dwarf gap as 3.56
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
