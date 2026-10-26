# Fuel and Crystals — Design

**Date:** 2026-07-27
**Status:** Approved by user (pressure level, empty-tank behaviour and spawn model all confirmed)

## Goal

Give warp a cost. Holding Shift currently accelerates to `WARP_SPEED` indefinitely and for free, which makes the whole map reachable without thought. Fuel turns warp into a decision, and floating crystals scattered through open space give a reason to explore rather than beeline.

## Decisions (user-confirmed)

1. **Fuel is a real resource, not flavour.** One tank ≈ one full crossing of the map. Rejected: a
   ~60s tank (crystals become decorative and the respawn loop stops mattering) and a ~5s tank
   (cannot cross the map on one tank; on a CV, repeatedly running dry mid-journey reads as friction).
2. **Empty disables warp only — normal thrust always works.** Warp becomes a resource you spend
   deliberately, and no visitor can ever be stranded. Rejected: disabling all thrust (a visitor
   whose nearest crystal is beyond drift range is stuck permanently, losing collected shards to a
   reload) and passive regen (waiting becomes a valid strategy, which undercuts the crystals).
3. **Crystals spawn randomly in the volume and respawn to a cap.** Matches "generate in loop until
   max", keeps exploration rewarding, needs no hand-placement. Rejected: fixed hand-placed positions
   (refuelling degrades into a memorised route) and clustered fields (long punishing gaps when low).

## Decisions made without asking, and why

- **Fuel does NOT persist across reloads. Every session starts full.** Shards persist because they
  are achievements; fuel is session state. A returning visitor landing with an empty tank would be
  punished for coming back, and a tank that always persists *full* is meaningless.
- **Drain is continuous while warp is held**, not discrete jump charges. This matches the existing
  control (hold Shift) and the way the feature was described.

## 1. Architecture: fuel lives in `flight`, not the store

**This is the load-bearing decision.** Fuel changes every frame while warping. In the zustand store
that is a per-frame `setState`, which breaks the project's core guarantee of zero React renders
during flight — currently verified at `commits=0` by `tests/e2e/perf.probe.mjs`.

So fuel joins `flight`, the mutable telemetry object already carrying `x/y/z/speed/heading/pitch`,
which `HUDOverlay` and `RadarMap` read from their own rAF loops without React involvement.

```ts
// src/store/spaceStore.ts — added to the existing `flight` object literal,
// initialised to FUEL_MAX so a fresh session starts full (see "Decisions made
// without asking"). Nothing else in the codebase initialises it.
fuel: number;      // 0..FUEL_MAX, written only by Spaceship's frame loop
```

The store receives only **discrete** events, both changing on the order of seconds:

```ts
fuelEmpty: boolean;                       // gates the HUD's DRY state + one-time chatter
setFuelEmpty: (v: boolean) => void;       // change-guarded, like setActiveZone
```

`Spaceship` owns the write. Nothing else mutates `flight.fuel`.

## 2. Numbers, derived from the existing flight model

Verified constants: `WARP_SPEED = 39` u/s, `MAX_SPEED = 10.8` u/s, `COSMIC_BOUNDS = 250` (so 500
units edge to edge).

| Constant | Value | Derivation |
|---|---|---|
| `FUEL_MAX` | 100 | Arbitrary unit, chosen so the HUD reads as a percentage. |
| `FUEL_DRAIN_PER_SEC` | 8 | 100/8 = 12.5s of warp × 39 u/s ≈ 487 units ≈ one 500-unit crossing. |
| `FUEL_PER_CRYSTAL` | 25 | Four crystals fill an empty tank; one crystal buys ~3s of warp ≈ 122 units. |

**Drain is delta-time scaled** (`flight.fuel -= FUEL_DRAIN_PER_SEC * dt`) so it is frame-rate
independent, like every other rate in `Spaceship`.

**Dropping out of warp on empty is a graceful coast, not a stop.** The warp branch assigns velocity
directly (`vel.set(nose * WARP_SPEED)`) each frame, so when the branch stops running the ship
retains its 39 u/s and decays through the existing `SPACE_DRAG`. No special handling needed — the
ship glides down to cruise on its own, which reads better than a hard cut.

## 3. Warp gating

`Spaceship.tsx` currently computes:

```ts
const warpActive = input.boost && time > warpSuppressUntil.current;
```

This gains a fuel term:

```ts
const warpActive = input.boost && time > warpSuppressUntil.current && flight.fuel > 0;
if (warpActive) flight.fuel = Math.max(0, flight.fuel - FUEL_DRAIN_PER_SEC * dt);
```

Ordering matters and is deliberate: the drain is conditioned on `warpActive`, so a visitor holding
Shift with an empty tank drains nothing (it is already 0) and simply cruises — no special case, and
no risk of the gate and the drain disagreeing about whether warp happened this frame.

Interaction with existing modes, all of which already `return` before the warp code runs, so none
needs new handling: **photo mode** freezes input and physics; **orbit lock** returns before the
steering section. Fuel therefore cannot drain while parked or posing.

## 4. Crystals

### Entity

One `InstancedMesh` reusing `public/models/space_crystal.glb` — already in the bundle at 50KB
(loaded today by `PlasmaAnomalies`), so **no new asset**. Architecturally the same shape as
`DataShards`: a matrix loop plus one `toroidalDistance3` per crystal per frame.

Cost context: `AsteroidBelt` already runs 560 instanced rocks with per-instance trig every frame.
40 crystals is roughly 7% of that loop. Not a performance consideration.

### Spawn placement and rejection zones

Random within the ±250 volume, rejected and re-rolled if the candidate falls:

- inside the main asteroid belt (radius 40–70 from origin)
- inside the polar halo band (radius 80–95)
- within 20 units of any planet's live position, or of `PORTAL_POS`
- within 30 units of the ship, so crystals never pop into view

Rejection is a pure predicate, testable without a scene. Re-roll is capped (e.g. 20 attempts) and
falls back to accepting the last candidate rather than looping forever — a crystal in a slightly
awkward spot is better than a hang.

### Respawn loop

`CRYSTAL_MAX = 40`, one respawn every ~4s while below the cap. Driven by an accumulator in the frame
loop, not a `setInterval`, so it pauses with the tab and stays in step with delta time.

### Reduced motion

Crystal bob and spin are decorative and read `ambientTime()`, so they freeze like everything else.

**Pickup must measure against the crystal's BASE position, not its bobbed position.** This is not a
stylistic preference: it means freezing the bob cannot alter collection. `DataShards` already does
exactly this — a lesson learned there, where a design note claimed the opposite and had to be
corrected against the source.

## 5. Radar — what makes the mechanic work rather than annoy

40 crystals in a 125-million-unit volume is ~146 units between neighbours. At cruise that is 13
seconds of flying blind, so without a cue the feature is frustration rather than exploration.
`RadarMap` already builds blips from a `{name, x, y, z, color}` array with rim-clamping and altitude
chevrons, so crystals extend it.

**Only crystals genuinely within the radar's 160-unit `RANGE` are drawn — deliberately NOT
rim-clamped** the way planets are. Rim-clamping 40 crystals would ring a 148px display with dots and
bury the planet blips that the dossier navigation depends on. In range, typically 1–3 show, which is
exactly the "where is my nearest fuel" cue without clutter.

Crystals draw smaller than planet blips and in a distinct colour so they never compete with a lock
target.

## 6. HUD

A fuel bar beneath the existing telemetry block, written from the **same rAF tick** that already
updates `NAV.LOC` and `VELOCITY` — no new loop, no React involvement:

- above 25%: normal treatment
- below 25%: amber
- at zero: red, reading `DRY`

One chatter line fires the first time the tank empties, via the existing `sendBroadcast`, so the
reason warp stopped responding is explained rather than mysterious. Once per empty transition, not
repeatedly — `fuelEmpty` is change-guarded.

## 7. Error handling and edge cases

- Fuel is clamped to `[0, FUEL_MAX]` on both drain and refuel, so a large `dt` spike cannot drive it
  negative and a pickup at 95% cannot exceed max.
- `dt` is already clamped to 0.05 in `Spaceship`, so a tab-switch cannot dump the whole tank.
- Refuel while already full is a no-op, and the crystal is still consumed — otherwise a full ship
  would plough through a crystal field leaving it intact, which looks broken.
- Respawn while at cap is a no-op.
- A crystal spawning inside the ship's pickup radius is prevented by the 30-unit exclusion, but if it
  happened the pickup would simply fire; no special case needed.
- Photo mode and orbit lock cannot drain fuel (§3).
- There is no "collect them all" state: crystals respawn, so unlike shards there is no completion
  fanfare and no persistence.

## 8. Testing

**Unit (vitest), on the pure parts:**
- drain integration over `dt`, including clamping at 0 and the large-`dt` case
- refuel clamping at `FUEL_MAX`, and that a full-tank pickup still consumes the crystal
- the spawn-rejection predicate against each zone: belt, halo, planet proximity, portal, ship
- the respawn scheduler: fires at the interval, no-ops at the cap

**E2E — `tests/e2e/fuel.probe.mjs`:**
- warping drains `flight.fuel`; cruising does not
- at zero, warp produces no speed increase while cruise still accelerates
- teleporting onto a crystal refuels and decrements the live count
- the live count never exceeds `CRYSTAL_MAX`
- crystals appear on the radar only when within range
- **`perf.probe.mjs` still reports `commits=0` with fuel actively draining** — required, not
  assumed, since a fuel gauge is exactly the kind of feature that reintroduces per-frame renders

## 9. Out of scope

Fuel persistence, warp charges as discrete jumps, crystal rarity tiers, a fuel-capacity upgrade,
and any change to the `PlasmaAnomalies` crystals (a separate click-spawned effect that happens to
use the same GLB).
