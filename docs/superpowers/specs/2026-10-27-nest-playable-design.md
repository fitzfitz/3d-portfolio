# The Nest, playable (design)

**Date:** 2026-10-27.
**Status:** the owner said "go" to the plan in chat. Decisions are marked *(owner)* when they were the owner's words, and are otherwise the controller's calls.
**Builds on:** the Nest (`docs/archive/specs/2026-10-27-combat-design.md`, PR #67, live in v1.4.0).

## Why

The owner flew the live Nest and reported *(owner, 2026-10-27)*:
- "it's hard to find the nest";
- "it's hard to find the monsters";
- "it's hard to shoot the monster";
- "the nest doesn't look like a nest";
- far from the Sun, everything is "so lighty, hard to see things through".

The controller measured the last point in the dev build, on whole-screen mean luma (0–255) along one heading:

| Place | Sky alone | Whole screen |
|---|---|---|
| 1 AU | 37 | 63 |
| 3.5 AU | 92 | 100 |
| 13 AU | 90 | 130 |

Two causes:
1. **The unlit backdrop's net gain is allowed to reach 8.5×** (`BACKDROP_NET_MAX` in `src/utils/sunLight.ts`), against 1.8× at 1 AU.
2. **Older self-lit materials grow with the exposure.** The exposure follows (d/AU)², and nothing divides it out of the ship's emissive strips, its engine plume and sparks, or the jellyfish (+28 luma at 13 AU) and others. Newer self-lit things (monsters, bottles, race rings, guide lines, Nest effects) already use `exposureCompensation`.

## Goals
1. A first-time visitor can find the Nest from anywhere.
2. The Nest looks like a nest from the buoy.
3. The monsters are easy to find on screen during a fight.
4. Shooting a monster is easy with F, a pad, touch or a click.
5. The outer system is not washed out.

## Non-goals and anti-goals
- Still **never an ambush**. Nothing attacks outside the Nest, and a fight starts only on the inward 70 u crossing.
- No new models. Reuse the existing asteroid rocks, the monster models and the code-drawn effects.
- No change to the inner system's look (inside 1 AU), the fight's balance (damage, hull, waves) or the Worker.

## Changes

### 1. Finding the Nest
- **THE NEST joins the jump targets.** It appears in the click-to-jump list and on the next free number key. A jump lands at the existing tow pose (`NEST_TOW_POSE`: 8 u past the buoy, facing the Nest), outside the fighting area. *(owner: "go" to "THE NEST joins the jump list … lands you at the buoy, facing in")*
- **The radar always shows the Nest.** Beyond radar range, a red marker sits on the radar rim in the Nest's direction, as live pilots' rim markers do. Within range it is the existing red marker.

### 2. A nest you can see
- **A rock cluster.** A hollow cluster of the existing scenery asteroid rocks (the same model and material as the asteroids in `data/asteroids.ts`; no new program) forms a rough shell of radius about 10–14 u around `NEST_CENTRE`, with gaps.
  - About 18–24 rocks, deterministic placement (seeded).
  - The rocks are solid to the ship: they are added to the ship's colliders. Bolts and monsters ignore them.
- **Slime glow inside.** A code-drawn green glow fills the cluster: one Points or sprite call, reusing an existing additive material config so there is no new program. It uses the shared `exposureCompensation`. Visible from the buoy.
- **Monsters at home.**
  - Once the models are loaded (within 200 u) and the Nest is **ready**, wave 1's three saucers sit parked around the cluster, bobbing slowly with eyes closed (blink held, idle pose).
  - The tardigrade sleeps curled in its tun ball inside the cluster (curl pose).
  - **Waking:** crossing the 70 u line wakes the saucers. They lift off and wave 1 starts with them, so wave 1 is in front of the pilot. The tardigrade stays asleep until wave 3, when it uncurls (curl 1→0 over 1 s) and fights.
  - **Asleep is harmless.** Sleeping monsters never attack and can't be hit (they are not targets until awake).
- **Placement.** The cluster and the sleepers stay inside the zone and clear of the buoy. `tests/nestPlacement.test.ts` and `solarClearance` stay green.

### 3. Finding the monsters
- **Edge arrows.** During a fight, each awake monster that is off screen gets a small red arrow at the screen edge, pointing to it.
  - At most 8 arrows.
  - One DOM layer, written in the existing overlay rAF with no React renders, and `display:none` when unused.
- **Waves 2 and 3** spawn in front of the ship: within ±50° of the ship's forward direction, 30–40 u away, inside the fighting area (clamped to it). They no longer appear behind.

### 4. Shooting
- **Lock-on.** The held fire (F, LB, touch FIRE) locks the nearest awake monster within **25°** of the nose and keeps that lock while the monster stays within **40°** and alive.
  - A red bracket reticle sits on the locked monster, as a DOM overlay projected from the 3D position.
  - Shots lead the locked monster (the existing `leadAim`).
  - Without a lock, held fire goes straight ahead.
  - The aim-assist cone constant `AIM_ASSIST_RAD` is replaced by `LOCK_ACQUIRE_RAD` (25°) and `LOCK_HOLD_RAD` (40°).
- **Clicks.** A click fires at the clicked point. If an awake monster lies within **6°** of the click ray, the shot aims at it with lead instead.
- **Bigger hit spheres:** saucer 1.8 → **2.6**, tardigrade 3.5 → **4.5**. The ship's own hit sphere is unchanged, so the monsters' accuracy is unchanged.
- **Hits show.**
  - A burst of a few sparks at the hit point, as extra instances in the existing bolt mesh (no new call or program).
  - A small `HIT` marker flashing at the reticle for 0.25 s. Under reduced motion it is static, with no animation.

### 5. Not washed out far from the Sun
- **The sky.** The backdrop's net gain is capped near its 1 AU value. `BACKDROP_NET_MAX` changes from 8.5 to **2.2**, and its curve and comments are updated (L19: the camera may lift the unlit sky a little, not 5×).
- **Self-lit things look the same at every distance from 1 AU out.**
  - A shared `glowScale = { value }` in `sunLight.ts`: `min(1, EXPOSURE_LIFT / exposure)` in the full tier, and the same in low-perf where the renderer exposes built-in materials. The builder confirms the tier maths against `setExposureCompensation`.
  - It is set by `ExposureDriver` each frame.
  - It is applied, as a uniform or a per-frame material colour/intensity write (no new programs), to:
    - the ship's emissive strips;
    - the engine plume and the plume sparks;
    - the jellyfish;
    - and any other self-lit material the builder finds still growing with exposure: ghosts' plumes, probe beacons, data shards, the portal, buoys, cargo lights and the tractor beam.
  - Inside 1 AU nothing changes (`glowScale` = 1).
- **The guard.** A new e2e check measures the whole-screen mean luma at 1 AU, 3.5 AU and 13 AU along a fixed heading, after the exposure settles. The 3.5 AU and 13 AU values may be at most **1.25×** the 1 AU value. A sky-only measurement (objects hidden) may be at most **1.3×**. The probe records the numbers in `docs/PERF-BUDGETS.md` (or a look-budget note).

## Performance
- No new shader programs: the programs tour stays at +0 and the Nest state at ≤ 62.
- The Nest state's call ceiling (60) may grow only for the rock cluster and the glow. Re-measure it and record it with the existing derivation.
- No per-frame allocation in the new loops.
- The idle budget is unchanged. Nothing new runs outside the Nest except the radar rim marker (a few arithmetic operations) and the glow scale.

## Tests
- **Unit:**
  - jump target and landing pose;
  - the radar rim-marker maths;
  - deterministic rock-cluster placement, clear of the buoy and the zone line;
  - the sleeper states and waking (saucers on crossing, the tardigrade at wave 3, asleep harmless and untargetable);
  - the wave 2 and 3 spawn cone;
  - lock acquire and hold, plus click assist;
  - the new hit radii;
  - the edge-arrow maths;
  - `glowScale` and the backdrop cap.
- **e2e:**
  - the combat probe gains: a jump to the Nest; sleepers visible before the fight; edge arrows when a monster is behind; a lock reticle and a hit with held F on a strafing saucer; the new Nest perf numbers;
  - the brightness checks at 1, 3.5 and 13 AU.
- **Changelog:** one entry.

## Out of scope
- New monster models or a nest model.
- Changing damage, hull or waves.
- PvP and coins.
