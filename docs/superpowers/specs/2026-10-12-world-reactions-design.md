# World Reactions — Design

**Date:** 2026-10-12
**Status:** Approved by user in conversation (scope, approach, and both design sections). This
document is for review before an implementation plan is written.

## Goal

The universe looks alive but does not notice the visitor. Cargo ships fly fixed spline loops,
the jellyfish swims a fixed path, and the asteroid belt orbits on its own whether the ship is
there or not. This spec makes three of them react to the ship, so a visitor sees the world
respond within their first minute of flying.

It is item 2 of three agreed after the 2026-10-12 scale pass (PR #13): 1) scale pass — shipped;
2) things notice you — this spec; 3) ambient events — later, its own spec.

## Decisions (user-confirmed)

1. **Reactions only, no requests.** Things respond to the ship; nothing hands the visitor a task
   (no escort missions, no hails that ask for anything). Requests overlap the logbook/missions
   idea, which was not chosen.
2. **Three subjects: cargo ships, the jellyfish, the asteroid belt.** Scenery asteroids that drift
   when rammed, and fuel crystals that lean toward the ship, were offered and deferred.
3. **Approach A: local reactions with shared helpers.** Each component reads the ship's position
   in its own frame loop and adds an eased offset to its existing motion. Rejected: a central
   "attention" event system (more code for a reactions-only feature) and real steering physics
   (fights the time-driven routes and lets bodies wander into planets).

## Decisions made without asking, and why

- **Offsets only; routes, paths and orbits are untouched.** Every reaction is a displacement added
  on top of the existing motion and always eases back to zero. `tests/planetClearance.test.ts`,
  `JELLY_NEAR_T`, and every placement that assumes these paths keep holding.
- **Reactions are off under reduced motion.** These bodies already freeze in that mode (their
  motion runs on `ambientTime`), so a reaction would be the only thing moving and would contradict
  the setting.
- **Reactions stay on in low-perf mode.** The added cost is a few hundred multiply-adds per frame,
  and low-perf already halves the belt and drops two cargo ships.
- **No new materials, draw calls or shader programs.** `deep-space programs` sits exactly at its
  ceiling (79/79, docs/PERF-BUDGETS.md). The cargo alert blink drives the existing cloned nav-light
  materials, the jellyfish's pulse change goes through its existing `uTime` uniform, and the belt
  reuses its instanced mesh.
- **Frozen scene, frozen reactions.** Orbit lock and photo mode stop the frame loop
  (`selectSceneFrozen`), and the reactions stop with it. There is no special casing.
- **Belt parting runs on the CPU.** The belt already rebuilds every instance matrix on the CPU each
  frame (`AsteroidBelt.tsx`). A per-rock displacement there is simpler and cheaper than a vertex
  shader, and needs no new program. (The conversation first said "on the GPU"; reading the code
  corrected that.)

## Shared helpers — `src/utils/reactions.ts`

Pure functions with no three.js scene access, unit-tested:

- `proximity(d, inner, outer)`: 1 at or inside `inner`, 0 at or beyond `outer`, smoothstep
  between.
- `damp(current, target, rate, dt)`: frame-rate-independent exponential approach, the same idiom
  as `CargoTraffic`'s `1 - Math.pow(0.01, dt)`. There is a scalar form and an in-place vec3 form.
- `awayFrom(out, from, to)`: unit vector from `from` toward `to`, with a stable fallback when the
  two coincide.

Each subject's reaction logic is also a pure function over plain numbers (below), so it can be
tested without rendering.

## Cargo ships (`CargoTraffic.tsx`)

| Behaviour | Rule |
| --- | --- |
| Swerve | Within ~30u of the player, slide off the route along the ship's sideways axis, away from the player, up to ~10u scaled by `proximity`. Ease in ~1s, ease back ~3s after the player leaves. |
| Roll | The existing "roll away under 12u" becomes a roll that follows the swerve's lateral velocity, so the turn reads as piloted. |
| Alert lights | While within ~30u, the nav lights switch from the slow blink to a rapid alert flash, using the same materials with a different `emissiveIntensity` pattern. |
| Hail | The first time the player comes within ~20u of a given ship, broadcast one line from a new `hail` pool in `src/data/chatterLines.ts` via the chatter scheduler (`ChatterKind` gains `"hail"`). At most one hail per 45s across all ships, and none while `race.phase === "running"`. Re-arms after the player has been more than 30u away. |

The swerve offset is computed as `cargoSwerve(shipPos, routeTangent, playerPos, current, dt) →
offset` and added after `curve.getPointAt`, before `lookAt`. The look target gets the same offset,
so the hull points along its actual travel.

## Jellyfish (`SpaceJellyfish.tsx`)

A three-state mood, `calm | curious | startled`, as a pure function
`jellyMood(state, jellyPos, pathPos, playerPos, playerSpeed, boosting, dt)`:

| Mood | Enter when | Behaviour |
| --- | --- | --- |
| curious | Player within ~60u, speed < ~4 (cruise max 10.8), not boosting | The offset eases toward the point ~18u from the player on the jellyfish's side. Follows gently; the pulse slows slightly (time warp on the existing clock). |
| startled | Player boosts within ~40u (from any mood) | The offset darts ~40u directly away from the player in ~1s. The pulse quickens for a few beats. After ~2s it returns to calm. |
| calm | Otherwise | The offset eases back to zero over ~6s. This is the current behaviour. |

Guards:

- **Leash:** the offset never exceeds ~80u from the path point. Past it, curious drops to calm.
  This keeps the rare-sighting rhythm and stops the creature being towed across the map.
- **Planet guard:** if the curious resting point falls within any planet's
  `size × ZONE_FACTOR + JELLY_RADIUS`, it drops to calm. The jellyfish never follows the player
  into a planet. (`JELLY_RADIUS` is 9, as in the clearance test.)
- The scannable registration uses the displaced position.
- The `J` summon is unchanged. It moves the path phase; the mood then applies normally.

## Asteroid belt (`AsteroidBelt.tsx`)

- Each rock carries a displacement `d` (3 floats per rock, preallocated).
- Each frame, convert the ship's position into the ring's local frame once (inverse of the ring's
  X tilt). For each rock within the push radius `R ≈ 10u` of the ship, the target displacement is
  away from the ship, with strength `(R − dist)` scaled by a smoothstep. `d` eases toward the
  target quickly while pushed (~0.15s), so rocks clear the ship's path, and springs back slowly
  when not (~2.5s), leaving a visible wake that closes behind the ship.
- **Skip test:** when the ship's distance from the origin is outside `[rMin − R, rMax + R]` for
  that ring, skip the push and only relax `d`. Most frames, the ship is nowhere near a belt.
- Applies to both `BeltMain` and `BeltHalo`. Belt rocks stay non-colliding.
- **Copy:** `"ASTEROID BELT DENSITY: DECORATIVE"` in `chatterLines.ts` is no longer true. Replace
  it with something like `"ASTEROID BELT: POLITE. IT MOVES FOR YOU"`.

## Testing

**Unit (vitest)**

- `reactions.ts`: proximity endpoints and monotonicity; `damp` converges and is frame-rate
  independent (one 0.1s step ≈ ten 0.01s steps); `awayFrom` handles coincident points.
- `cargoSwerve`: zero offset beyond 30u; sideways (perpendicular to the tangent) and away from
  the player when close; capped at ~10u; returns toward zero after the player leaves.
- Hail gate: fires once per approach, respects the 45s cooldown, is silent during a running race,
  and re-arms after 30u.
- `jellyMood`: each transition in the table; the leash cap; the planet guard; startled overrides
  curious.
- Belt push: a rock at the ship's position is displaced at least `R`; a rock beyond `R` is
  untouched; displacement relaxes back toward zero after the ship leaves; the local-frame
  conversion is correct for the tilted ring.

**End-to-end (new `tests/e2e/reactions.probe.mjs`)**

- Teleport beside a cargo ship. Its distance from its route point grows, and a hail broadcast is
  emitted.
- Summon the jellyfish (`J`) and hover slowly. The distance between the ship and the jellyfish
  shrinks toward ~18u. Boost: the distance grows.
- Park inside the main belt. After settling, no belt instance sits within the push radius of the
  ship.
- Reduced motion on: none of the above moves.
- The existing perf probes must stay within budget: draw calls, triangles, and programs 79/79.

## Out of scope

- Requests, missions, escorts (decision 1).
- Scenery asteroid drift and crystal attraction (decision 2), and anything in item 3 (ambient
  events).
- Sound effects for reactions. The hail reuses the existing broadcast and chatter sound path.
