# Phase 3: Encounters — Design

**Date:** 2026-07-18
**Status:** Approved (creature form: space jellyfish, per user)
**Parent:** `2026-07-18-living-universe-roadmap.md` (Phase 3)
**North star:** the universe acts on its own — things travel, visit, and live here without the player.

## Assets (Blender-generated, reproducible)

Committed generator scripts in `scripts/blender/`, run headless via `/Users/fitzgeral/Applications/Blender.app/Contents/MacOS/Blender --background --python <script>`, output raw GLB to `assets-src/`, then optimized via the existing `npm run assets:optimize` pipeline into `public/models/`.

- **`gen_cargo_ship.py` → `cargo_ship.glb`** (budget <300KB optimized): low-poly hauler — elongated hull, cabin, twin engine cylinders, three cargo containers, emissive window strips, and two tiny nav-light spheres with material names `NavRed` / `NavGreen` (the app finds them by name to pulse them). Single joined mesh + named materials, no textures (flat PBR colors — zero image weight).
- **`gen_creature.py` → `creature.glb`** (budget <600KB optimized): jellyfish — organic bell (sphere + subdivision + displace-noise modifier for lumpy silhouette) and 6 tapered trailing tentacles, joined. Geometry only; the app replaces materials entirely with a custom shader.

`npm run assets:generate` runs both Blender scripts; asset budget: `public/models` total stays under 6MB.

## Features

- **3.1 NPC cargo traffic** — `CargoTraffic.tsx`: 5 ships on three closed CatmullRom spline loops threading the planets/portal at varied heights. Each ship: phase offset + speed (full loop 90–150s), oriented along the curve tangent, gentle banking in curves. Nav lights pulse (per-ship cloned `NavRed`/`NavGreen` materials, emissiveIntensity sine + phase). Avoidance: when the player is within 12 units, the ship banks away (visual-only, no physics). Low-perf: 3 ships.
- **3.2 Space jellyfish** — `SpaceJellyfish.tsx`: loads creature.glb, applies one custom `ShaderMaterial` (vertex: bell pulse along normals + tentacle sway increasing with −y; fragment: cyan→magenta fresnel + slow internal glow pulse; additive, depthWrite false). Drifts along a long far path (~400s loop) that passes within sight of the play area twice per loop; scale ~18. Hidden debug summon: pressing **J** teleports its path phase to near the player (QA + easter egg). Low-perf: still rendered (one mesh, cheap shader) — its rarity is the cost control.
- **3.3 Comets** — `Comets.tsx`: 2 comets on inclined elliptical orbits (periods ~140s/220s) around the sun; head = small bright sphere (emissive, bloom does the rest), tail = ~50-point `Points` cloud stretched anti-sunward with jitter and length scaled by proximity to the sun. Chatter integration: store gains `cometNear: boolean` (guarded setter, set by Comets' frame loop when a comet is within 60 units of the player); RadioChatter subscribes and interrupts with a line from a new `comet` pool ("COMET DETECTED // TAIL COMPOSITION: ICE, DUST, DEADLINES"). `ChatterPools` gains `comet: string[]`; `ChatterKind` gains `"comet"` (scheduler tests extended).
- **3.4 Extra moons** — in `SpacePlanets.tsx`: a local `<OrbitingMoon distance inclination speed size color />` helper; saas +1 moon, agent +2 moons, video keeps its existing moon + gains 1 — each with distinct inclination/speed/size so no two orbits look alike.

## Architecture rules (unchanged)

Zero per-frame React state; clock/delta-driven motion; `getState()` reads in frame loops; guarded store setters for events; parent-gated low-perf variants; all new store logic unit-tested where pure.

## Acceptance

1. Flying for ~2 minutes guarantees at least one encounter (ship crossing, comet, or moons in view); jellyfish reliably summonable via J.
2. Ships visibly follow curved routes, bank in turns, blink red/green; they never intersect the camera aggressively.
3. Comet tails always point away from the sun; chatter announces a near pass exactly once per approach (guarded flag).
4. Headless-probe screenshots (the whiteout-probe rig) capture: a cargo ship, the summoned jellyfish, and a comet — attached to the verification record.
5. Gates: build/lint/test; asset budget <6MB total; profiler still render-free in steady flight.

## Out of scope

Creature/ship interactions with gameplay (Phase 4 territory), NPC dialogue, comet collisions, ring-shadow band (trimmed — YAGNI; ring rotation already exists).
