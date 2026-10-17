# True Proportions (Sizes by Type) — Design

**Date:** 2026-10-17 · **Sub-project B** of the new-worlds work (after A, before C)
**Laws:** `docs/UNIVERSE-RULES.md` L35 (stars outsize their planets) and L36 (planet size follows type). This builds F12 of `docs/superpowers/specs/2026-10-16-universe-laws-fixes-design.md`, with revised numbers.
**Owner:** "start on it. just go with it… unless there's something crucial." The one owner gate is a screenshot review of the new sun and planet sizes before merge, which F12 promised.

## Intent

Today the sun's solid core (radius 8) is half the size of every planet (16), and all three planets are the same size, whatever their type. An astronomer winces at both. C will add a Saturn-type and two ice giants, which would make it worse. B fixes the proportions first.

## Decisions (my calls)

1. **Planet sizes by type:**
   - Portfolio (Jupiter-type) stays **16**, the largest.
   - Ruangrapi (Earth-type) becomes **12**.
   - Fuxx (Mars-type) becomes **8**.

   **Deviation from F12's 20/15/11:** every landmark, trail buoy, shard, ring and route was placed and clearance-tested against size 16. The career station clears Portfolio's swept orbit by only 1.55, so growing any planet forces a re-layout of the station and the B1 trail. Shrinking keeps every clearance and the order is still right. Under P3 (sizes drawn enlarged) real ratios aren't required, only the order.
2. **The sun's core radius becomes 24**, bigger than the largest planet, with its colour unchanged.
   - The corona is resized so its glow still reads as the sun's halo but stays clear of the asteroid belt (inner edge r 40). The billboard is about 72 wide (radius about 36), against today's 52 wide with a radius-8 core. Its look is part of the owner's screenshot review.
   - `SUN_COLLIDER` grows with the core (24 + 1.5).
   - Everything that reads `SUN_RADIUS` follows: the sun's visibility for glare, the shadow penumbra (a bigger sun gives softer shadow edges, which is correct), occlusion, world-event keep-outs and the intercept colliders.
   - Bodies now inside or too close to the sun move out, chiefly shard 6 at r 9.8 ("near the sun"). Rings or asteroids that fail their sun clearance are adjusted minimally.
3. **One planet table with a type.** Each project planet gets `type` ("earth" | "gas-giant" | "mars"), `size` and a relative `mass`: Ruangrapi 1, Portfolio 3, Fuxx 0.3.
   - These are compressed but correctly ordered masses (P3). `PLANET_SIZE` goes away.
   - Moons, rings, atmospheres, lock, zone and orbit radii, jump standoffs, scan radius, the shadow occluder radius and crystal and jelly keep-outs already scale from `size`, so they follow automatically.
4. **Moon speeds follow each planet's own mass.** Each planet gets `GM_p = GM_RUANGRAPI × mass`, where `GM_RUANGRAPI` is anchored so Ruangrapi's moon keeps 0.4 rad/s at its new distance (1.7 × 12). This keeps L7 within each moon system (one GM per central body) and makes Portfolio's moons orbit faster than a light planet's would.
5. **Flight gravity wells:** radius stays 3.5 × size, and the strength scales so the pull at the surface is the same for every planet (`G = 3000 × (size/16)²`).
   - The flight gravity layer is already a documented break (L4, until F2), and equal surface pull keeps every planet as easy to fly as today.
   - F2 replaces it with real masses later.
6. **`SIZE_ENLARGEMENT`** (the orrery note's "~290× Jupiter's size") is computed from the gas-giant planet, not `planets[0]`. It stays 290.

## Non-goals

New worlds (C), moving landmarks, F2 gravity, new assets or textures, changing the light law.

## Anti-goals

- A planet so small it reads as a boulder, or hard to dock.
- The corona swallowing the belt.
- A landmark that now clips the sun or a planet.
- A shader program compiled during play.

## Constraints

- Every clearance test passes. Planets only shrink, so landmark clearances can only improve. Re-check everything against the bigger sun.
- `tests/universeRules.test.ts` grows:
  - the size order (sun > gas giant > earth > mars);
  - each moon on Kepler with its own planet's GM;
  - L35 and L36 flip to Follows.
- No new program during play (`added=0`). Frame loops allocate nothing. Both perf tiers and reduced motion keep working.
- One changelog entry, `pr: 33`.
- Owner screenshot review before merge: the sun close and from the spawn, each planet up close, and the planets' relative sizes.

## Left to the builder

The exact corona size and falloff within the stated bounds, which blocking bodies move and where (minimal moves that pass the tests), and the tuning of any probe that assumed size 16.
