# Living Universe — Phased Roadmap

**Date:** 2026-07-18
**Status:** Approved direction (all 21 ideas accepted); each phase gets its own design spec + implementation plan before build.
**Baseline:** main @ post-smooth-space-upgrade (31.5MB→3.87MB assets, zero React renders during flight, delta-time physics, instanced rendering, zustand + mutable `flight` store, touch controls).

**Standing constraints for every phase:**
- Never regress the perf wins: no per-frame React setState, instancing for anything repeated, all heavy visuals disabled in low-perf mode, delta-time for all motion.
- Asset budget: keep `public/models/` under ~6MB total; new textures WebP; new models through `npm run assets:optimize`.
- Everything must work with keyboard AND touch controls.
- Each phase lands independently: main is always shippable.

---

## Phase 1 — Ambient Life (the bundle)

Maximum aliveness per effort; mostly low-risk. Target: one build session.

| # | Feature | Approach sketch | Perf note |
|---|---------|-----------------|-----------|
| 1.1 | **Sound** | Web Audio via a tiny manager (no library): engine hum (oscillator/noise, pitch tied to `flight.speed`), warp whoosh, orbit-lock chime, ambient pad loop. Mute toggle in HUD, persisted to localStorage. Autoplay policy: start on first user gesture. | Negligible; runs off rAF reads of `flight` |
| 1.2 | **Asteroid belt** | 300–500 small rocks orbiting the central sun in a torus band (radius ~40–70). One InstancedMesh reusing the optimized asteroid geometry at small scales; per-instance orbital angle/speed/tilt seeded once; matrices updated in one loop. | 1 draw call; matrix loop is the only cost |
| 1.3 | **Planet cloud layers** | Second sphere per planet (1.03×) with a procedural alpha cloud texture (canvas-generated noise, no new asset), rotating ~1.4× surface speed, slight color tint per planet. | 3 extra transparent spheres — trivial |
| 1.4 | **Radar minimap** | Canvas-2D overlay in HUD corner, drawn from a rAF loop reading `flight` + static planet/portal positions; rotates with ship heading; blips pulse when in gravity zone. Zero React involvement. | 2D canvas, ~free |
| 1.5 | **HUD radio chatter** | Ticker line in HUD cycling flavor/lore strings; context-aware pools (deep space / near planet X / warping / post-wrap). Strings double as resume storytelling. Driven by store zone changes + a timer, DOM-written like telemetry. | Zero |
| 1.6 | **Shooting stars** | 3–5 line-segment meteors spawning at random intervals on far-sphere trajectories, fading out. Reuses the warp-streak lineSegments pattern. | Negligible |

**Acceptance:** 60fps flight unchanged (profiler: still zero React renders steady-state); sound audible + mutable + persisted; belt visibly orbits; radar matches world positions including toroidal wrap behavior; chatter reacts to zones; all features off/degraded appropriately in low-perf mode where relevant (belt count halved, shooting stars off).

## Phase 2 — Deep Sky (the backdrop)

Pure visuals, self-contained, no gameplay coupling.

| # | Feature | Approach sketch |
|---|---------|-----------------|
| 2.1 | **Parallax star layers** | Split GalaxyStarfield into 3 layers (distances/speeds/sizes), opposite slow rotations |
| 2.2 | **Distant galaxy backdrop** | 1–2 faint spiral galaxy sprites (procedural or tiny WebP) on the far sphere |
| 2.3 | **Nebula color drift** | Slow HSL hue rotation on the five NebulaCluster materials (minutes-long period) |
| 2.4 | **Sun corona** | Noise-displaced shader shell + billboard flare sprites on the central sun |
| 2.5 | **God rays** | postprocessing `GodRays` pass tied to sun mesh; inside SafeErrorBoundary; low-perf disabled |
| 2.6 | **Warp tunnel** | Full-screen radial streak shader (custom pass or big cylinder shell) active during warp, layered over existing local streaks |

**Acceptance:** side-by-side screenshots show clear depth improvement; low-perf mode drops god rays/tunnel/corona shell; no new assets over budget.

## Phase 3 — Encounters (the wow features)

The universe acts on its own. Highest effort, highest payoff.

| # | Feature | Approach sketch |
|---|---------|-----------------|
| 3.1 | **NPC traffic** | 4–6 tiny cargo ships (one low-poly model or built from primitives, instanced) flying catmull-rom spline loops between planets; blinking nav lights (emissive pulse); slight avoidance bank when player within radius |
| 3.2 | **Space creature** | One large slow silhouette (jellyfish/whale) on a far drifting path; vertex-shader sine deformation for undulation; additive fresnel glow; appears on a long loop so sightings feel rare |
| 3.3 | **Comets** | 1–2 comets on long elliptical orbits; particle tail (points, velocity-stretched) always pointing away from sun; HUD chatter announces "COMET DETECTED" when one is near (ties into 1.5) |
| 3.4 | **More moons + ring shadows** | 1–2 extra moons per planet (varied inclination/speed); SaaS planet ring gets slow texture rotation and a fake shadow band on the planet |

**Acceptance:** encounters visible within ~2 minutes of normal flying; NPC ships never collide with player path in a janky way (pure visual avoidance, no physics); creature sighting reliably reproducible via a debug key for QA.

## Phase 4 — Hands On (gameplay)

Most design decisions; spec each item carefully before building.

| # | Feature | Approach sketch |
|---|---------|-----------------|
| 4.1 | **Data-shard collectibles** | ~10 glowing shards hidden across the map (instanced octahedrons, bob+spin); pickup on proximity → chime + HUD counter + resume fun-fact toast; persistence in localStorage; collect-all easter egg |
| 4.2 | **Asteroid collisions** | Sphere-distance check vs belt/large asteroids in the physics loop → velocity reflection + damped bounce + camera shake + thud (needs 1.1 sound) |
| 4.3 | **Scanner mode** | Hold E (or touch button) near scannable objects → progress ring → HUD prints procedurally generated report (seeded by object id) |
| 4.4 | **Orbit entry animation** | On lock, ship lerps onto a circular orbit path around the planet (visible behind modal) instead of freezing; break-orbit exits tangentially |
| 4.5 | **Photo mode** | P key / HUD button: hide HUD+modals, free orbit camera (drei OrbitControls temporarily), screenshot button (needs `preserveDrawingBuffer` ONLY during capture — re-enable per-shot via `gl.domElement.toBlob` after a forced render, not globally) |

**Acceptance:** per-item specs define exact interactions; everything reachable on touch; collision never traps the ship; photo mode restores state cleanly.

---

## Sequencing rationale

1 → 2 → 3 → 4. Phase 1 transforms the feel immediately at low risk. Phase 2 is safe visual compounding. Phase 3 needs the chatter/sound hooks from Phase 1 to land properly. Phase 4 touches the physics loop and input (highest regression risk) — do it last, when the world is already alive and worth interacting with.

## Process per phase

Each phase: short design spec (details + open decisions) → user approval → implementation plan (bite-sized tasks, TDD where logic is pure) → subagent-driven build with per-task review → whole-phase review → merge. Same pipeline as the smooth-space upgrade.
