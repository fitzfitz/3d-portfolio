# Asset Uplift — Design

**Date:** 2026-07-18
**Status:** Approved (scope: geometry + motion + baked textures, user-selected)
**Goal:** The Phase 3 objects stop reading as static low-poly props: detailed hulls, cratered moons, icy comet heads — each with baked AO-rich surfaces and idle motion so nothing in the universe sits still.

## Scope decisions

- **Bake:** Cycles headless bakes DIFFUSE(color) and AO per model, multiplied into a single base-color texture in bpy (image pixel math), applied as one baked material. **Emissive parts are never baked** — windows/nav/engine keep their separate emissive materials (NavRed/NavGreen names preserved: the app pulses them by name).
- **No baked normal maps** (deviation from the menu wording): needs hi/lo-poly pairs — most fragile step, least visible gain at our camera distances. Real displaced geometry (moons, comet head) + auto-smooth carries the detail instead.
- Budgets: `public/models` total < 8MB (raised from 6 — textures now exist); per-asset: cargo_ship < 900KB, moon < 700KB, comet_head < 200KB (all optimized, textures 1024 WebP by the existing pipeline).

## Assets

### Cargo ship v2 (`gen_cargo_ship.py` rewrite)
- Geometry: existing silhouette + bevel modifier on hull parts (worn-edge highlights), ~40 seeded greeble boxes on hull/containers, antenna mast, **radar dish as a separate NON-joined object named `RadarDish`** (the app spins it), engine detail rings.
- Bake: smart-UV-project the joined hull (everything except the RadarDish and the emissive parts), 1024px, AO 32 samples, color×AO combined in bpy, single `HullBaked` material. The RadarDish stays a separate object with a plain (unbaked) Accent material — it's small, always moving, and keeping it out of the bake set keeps the pipeline simple.
- Names preserved: `NavRed`, `NavGreen` (emissive, unbaked, still separate primitives after join by material).

### Moon (`gen_moon.py`, new shared asset `moon.glb`)
- Icosphere subdiv, displace stack: voronoi (crater rims) + clouds (roughness), auto-smooth.
- Gray albedo baked with AO (craters shade themselves), single material.
- App: `OrbitingMoon` loads `moon.glb` (cached), clones the material per moon and multiplies its color by the existing per-moon tint; adds self-rotation (`meshRotationSpeed` prop, default ~0.15 rad/s). Flat emissive spheres removed.

### Comet head (`gen_comet_head.py`, new `comet_head.glb`)
- Small displaced icy chunk (sphere + noise displace), no bake — one emissive ice material (`#bff5ff`-ish, strength ~2.5; bloom does the rest).
- App: `Comets.tsx` swaps the sphere for the GLB mesh and adds a slow tumble (per-comet axis/speed).

## Motion pass (nothing sits still)

- **Ships:** `RadarDish` node found by name per clone, spins ~1.2 rad/s; gentle course wobble: `group.position.y += sin(time*0.6 + i*2.1) * 0.35` layered on the spline position.
- **Moons:** self-rotation as above (distinct from orbital revolution).
- **Comet heads:** tumble per-comet.
- Belt/planets/jelly already alive — untouched.

## Pipeline

- `generate.sh` extended to run the two new generators (same `[ -f ... ]` guard pattern); `optimize-assets.mjs` model list += `moon`, `comet_head` (existsSync-guarded). Bakes run in the generator scripts (Cycles, CPU, 1024px, AO samples 32 — seconds-scale for these meshes). Non-deterministic re-encode note already documented.
- Optimizer must not resize the new 1024 bakes (they're already 1024; q92 WebP conversion as with other models).

## Acceptance

1. Probe close-ups (before/after pairs): ship shows panel/greeble detail + AO shading + spinning dish; moon shows crater silhouette + shading, rotating; comet head reads as an icy chunk, tumbling.
2. NavRed/NavGreen blink still works (names survive bake + optimize).
3. Budgets hold; `npm run assets:generate` reproduces everything from scratch on this machine.
4. Gates green (45 tests; no new unit tests — this phase is asset/visual, probe-verified).
5. No frame-loop regressions: motion additions are ref-mutations in existing useFrame loops.

## Out of scope

Baked normals; planet texture upgrades; jellyfish changes; player-ship model changes (it's player-facing and already detailed); LODs.
