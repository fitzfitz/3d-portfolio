# Asset Pass — Design

**Date:** 2026-10-15
**Status:** Approved in conversation, pending written-spec review
**Goal:** Lift every non-planet asset to the standard the planets and sun already set, and prepare the hero ship for the hull-paint feature. First of two sub-projects; new landmarks (sub-project B) get their own spec after this ships.

## Why now

The user chose a mix aimed at the three big features still on the roadmap (land on planets, hull paint / unlocks, secret sector). The planets and sun are explicitly out of scope: the user rates them as already good. Hull paint needs a ship whose hull is split into paintable zones, and new landmarks (B) should be built to the upgraded look, so this pass goes first.

## Audit (2026-10-15)

Blender studio renders of every `assets-src/*.glb` plus in-game photo-mode shots of the live scene:

| Asset | Verdict | Evidence |
|---|---|---|
| `spaceship.glb` | Evolve | Good silhouette and baked detail, but the livery colour is baked into the texture, the hull is one material, and it reads nearly black against space in game. No paint zones. |
| `cargo_ship.glb` | Rebuild | Weakest asset: primitive boxes, flat-coloured crates, bare cylinders for engines. |
| `moon.glb` → `Moon_Ice` | Refine | Plain white ball with a few scratched lines. Rock and Volcanic variants are good. |
| `space_crystal.glb` | Refine | Five plain prisms on a stub; reads as a placeholder up close. |
| `DistantGalaxies.tsx` | Refine | Flat two-arm dot spirals; read as cheap stickers next to Fuxx. |
| Moon tints | Refine | The blue-tinted ice moon beside Fuxx reads as a small planet, brushing the no-unreachable-scenery rule (non-project bodies must not look like planets). |
| Portal, data shard, asteroids, comet, jellyfish | Keep | Hold up in both renders and game. |
| Planets, sun | Keep | User decision. |

## Assets

All generators stay seeded and deterministic: same script, same bytes. Every rebuilt file keeps the names the app looks up.

### 1. Hero ship v2 (evolve `scripts/blender/gen_spaceship.py`)

The v1 generator is already substantial (~930 lines: part categories, seam bump, edge wear and grime, baked into one colour map and one normal map shared by `Hull` and `Accent_Metal`). Its weakness for this roadmap is that the livery colour is baked into that colour map, so any later recolour would multiply against it. v2 evolves the generator rather than starting over.

- **Silhouette and engine layout unchanged.** `Spaceship.tsx` hard-codes the three nozzle exit centres (derived from the `Engine_Emissive` clusters) and the plume positions; the v2 nozzles land on the same coordinates within 0.01 units. Overall bounds stay within ±5% of v1, so colliders, camera framing and the live-sky ghost scale stay valid.
- **Neutral detail bake.** The colour bake becomes a near-white greyscale detail map (AO, grime, edge wear, seam darkening; no hue). The baked normal map stays. Zone colour comes from each material's `color` factor, so recolouring a zone keeps all its shading.
- **Paint zones.** The `Hull` material splits by part category into `Hull_Primary` (main body), `Hull_Secondary` (wings, intakes) and `Hull_Trim` (spine stripe and wing-edge bands). All three use the same detail and normal textures (one UV atlas) and the same flags, so they differ only in uniforms. Defaults are a lighter gunmetal, a darker graphite and a cyan-white trim, so the ship stops disappearing into the dark backdrop. The hull-paint feature will later change only these three `color` values; this pass adds no paint UI or state.
- **More detail where v1 is sparse:** a canopy frame, intake grilles and extra greebles (vents, antennae, sensor bumps) on the upper hull, all real geometry.
- **Kept names:** `Accent_Metal`, `Canopy`, `Engine_Emissive`, `Neon_Cyan`, `Neon_Pink`, `Neon_Green`. `Spaceship.tsx` keys on `/engine/i` and `/^neon_/i`; the new `Hull_*` names match neither, so their emissive is still dimmed to 0.08 as today.
- **Budget:** ≤ 22k triangles (v1: 18.4k), GLB ≤ 600 KB after optimize (v1: 446 KB).
- **Ghosts unaffected:** `Ghosts.tsx` replaces every material with one `MeshBasicMaterial`, so extra hull materials cost the ghosts nothing.

### 2. Cargo freighter v3 (`scripts/blender/gen_cargo_ship.py`)

- A long truss spine with a crew cab forward, two racks of ribbed shipping containers (corrugated sides, corner castings, colours seeded from a muted four-colour palette, a few slots left empty), an engine block with two bell nozzles and a pair of heat-radiator fins, plus greebles: pipes, tanks, a docking light ring.
- **Kept names:** materials `HullBaked`, `NavRed`, `NavGreen`, `EngineGlow`; the node `RadarDish` stays a separate, unjoined object (`CargoTraffic.tsx` spins it and pulses the nav and engine materials by name).
- Same pipeline as v2: colour × AO bake into `HullBaked` at 1024 px; emissive parts are never baked.
- Nose-to-tail length stays within ±10% of v2, so traffic lanes and swerve radii stay valid.
- **Budget:** ≤ 12k triangles (v2: 8.4k), GLB ≤ 600 KB (v2: 374 KB).

### 3. Ice moon (`scripts/blender/gen_moon.py`, `Moon_Ice` only)

- Fractured ice shell: a voronoi crack network displaced inward, a faint blue-white subsurface colour in the cracks, darker regolith patches and three to five soft craters. The cracks are colour only (no emissive), so no new shader program.
- `Moon_Rock` and `Moon_Volcanic` must regenerate with identical geometry and textures (the generator's seed order must not shift; checked by comparing their mesh and image data before and after).
- **Tint fix (`SpacePlanets.tsx`):** the five `OrbitingMoon` colours are replaced with lower-saturation versions of the same hues (HSL saturation ≤ 25%), so a moon reads as rock or ice that picks up a hint of its planet's colour. Check: a photo-mode screenshot beside Fuxx where the ice moon reads as a moon, not a small planet.

### 4. Fuel crystal (`scripts/blender/gen_crystal.py`)

- An asymmetric cluster of 5–7 hexagonal prisms with chipped tips and stepped terminations, set in a small rock socket.
- **Still one mesh, one primitive, one material** (`Energy_Crystal`): `FuelCrystals.tsx` clones a single material and drives `emissive` (#ffd24a) and `emissiveIntensity` on it. The "inner core" look comes from the material's emissive map (brighter towards the cluster centre, darker on the rock socket), baked into the existing texture slot, not from a second material.
- **Budget:** ≤ 800 triangles (v1: 366).

### 5. Distant galaxies (`src/components/canvas/DistantGalaxies.tsx`)

- `makeGalaxyTexture` becomes seeded (no `Math.random`) and draws a bright elliptical bulge, two to four logarithmic arms with clustered star knots, dark dust lanes along the inner edge of each arm (drawn with `destination-out` at low alpha) and a soft outer halo.
- Three variants, chosen per galaxy: face-on spiral, inclined spiral (squashed on one axis) and elliptical (bulge and halo only).
- Same draw approach: one `CanvasTexture` and one sprite per galaxy, generated once at mount, so draw calls and shader programs don't change.
- Galaxies stay backdrop: far beyond flyable range, and they must keep looking distant (small, faint, no hard edge), consistent with the no-unreachable-scenery rule.

## Pipeline

- Generators run through `scripts/blender/generate.sh`, then `npm run assets:optimize` (meshopt + WebP). The optimizer's model list doesn't change, since no file is added or renamed.
- `assets-src/` changes are committed **and pushed** to `fitzfitz/3d-portfolio-assets-src`; `assets-src/MANIFEST.md` gets new hashes and updated provenance notes.
- `tests/assetProvenance.test.ts` must stay green (no new files, so no new generator rows).

## Constraints

- **Performance ceilings** (`docs/PERF-BUDGETS.md`): deep-space programs ≤ 79, close-approach programs ≤ 84; calls and triangles within baseline + 15%. The three `Hull_*` materials share one shader configuration with each other and with `Accent_Metal` (same maps, same flags) and differ only in uniforms, so three.js compiles them as one program. If the program count rises anyway, the zones collapse into `Hull_Primary` with per-vertex zone IDs instead; that fallback is decided by measurement during implementation.
- `tests/e2e/programs.probe.mjs` (a tour adds no program) must stay green.
- `public/models/` total stays under 8 MB (6.4 MB today).
- Memory: compare against the ~2 GB prod baseline on the M5; any increase over 5% is investigated before merge.

## Verification

1. **Before/after contact sheets:** Blender studio renders of the four changed models (same camera and lights as the audit), kept in the session scratchpad and summarised in the PR.
2. **In-game before/after:** photo-mode screenshots at fixed poses via the dev `__fitz.teleport` / `setAttitude` hooks: spawn view, a cargo ship at close range, the ice moon beside Fuxx, a crystal field and a galaxy-heavy view.
3. **Names survive:** `NavRed`/`NavGreen` blink, the `RadarDish` spins, engine plumes sit on the nozzles, neon strips stay lit (checked in game).
4. **Gates:** `npm test`, `npm run build`, and the e2e probes `assets`, `programs`, `perf`, `smoke` and `livesky`.
5. **Reproducible:** running each changed generator twice yields identical hashes.

## Delivery

- One PR (#25) on `feat/asset-pass`: one commit per asset plus one for the moon tints, and a changelog entry in `src/data/changelog.ts` (visitor-facing what/why/how, `pr: 25`).
- The `assets-src` commits are pushed before the PR opens.

## Out of scope

- Planets, sun, portal, data shard, asteroids, comet, jellyfish.
- Hull paint UI, unlock logic and persistence (the big hull-paint feature).
- New landmarks (sub-project B).
- LODs, and new baked normal maps beyond the hero ship's existing one.
