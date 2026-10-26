# World Events — Design

**Date:** 2026-10-12
**Status:** Scope, cadence, approach and Part 1 (director and shared rules) approved by the user in
conversation. Part 2 (the three events and testing) was written straight into this spec at the
user's request ("just go ahead") and is approved through review of this document.

## Goal

The universe has background motion (two periodic comets, distant shooting stars, cargo loops) but no
*events*: nothing happens now, is announced, lasts a while and ends. This spec adds a heartbeat: even
a visitor who only hovers sees something noteworthy within about a minute, and every minute or two
after that.

This is item 3 of three agreed after the 2026-10-12 scale pass:
1. scale pass — shipped, PR #13;
2. things notice you — shipped, PR #14;
3. things happen without you — this spec.

## Decisions (user-confirmed)

1. **Three events: a comet close pass, a solar flare, and a cargo convoy.** A meteor shower and a
   wormhole flicker were offered and not chosen.
2. **Cadence (a), a steady heartbeat.** The first event comes ~45s in, then one every 60–120s
   (~90s average).
3. **Approach A: a director plus the existing components.** A pure scheduler puts the current event
   into the store, and Sun, Comets and CargoTraffic play their own kind. Rejected:
   - one new component per event, which duplicates rendering and costs shader programs;
   - a fixed scripted timeline, which gives every visitor the same show.
4. **Events come to the player.** The comet aims at where the player was when the event starts. The
   convoy heads for the planet nearest the player. The flare is visible from anywhere.
5. **Part 1 rules (approved):**
   - the director's clock pauses while the scene is frozen or the classic résumé is shown;
   - no event starts during a time-trial lap;
   - no event starts within 6s of a broadcast;
   - there are no events under reduced motion;
   - one radio line announces each event;
   - a dev-only `triggerEvent(kind)` hook exists.

Carried from earlier work:
- **No unreachable scenery** and **planets mean projects:** events happen within reach and add no
  planet-like bodies.
- **Events are to watch, not tasks**, the same rule as #2.

## Decisions made without asking, and why

- **No new shader programs.** `deep-space programs` is at its ceiling (79/79, docs/PERF-BUDGETS.md).
  The flare drives the sun's existing uniforms, light and corona transform. The visiting comet clones
  the existing comet materials. The convoy clones the cargo ship as CargoTraffic already does. Cloned
  materials share their program.
- **Event objects stay mounted and hidden when idle.** A hidden object costs no draw call, and
  mounting on demand would compile or upload mid-flight, the hitch ShaderWarmup exists to prevent.
  It would also risk the warm-up race fixed in PR #15.
- **The flare is a slow swell, never a strobe.** At most one brightness peak every 3s keeps it well
  under the photosensitivity guideline of 3 flashes per second.
- **The convoy does not react to the player.** Swerving is the route traffic's behaviour from #2.
  Adding it to the convoy is YAGNI for a 40-second set piece.

## Part 1 — Director and shared state

### `src/utils/eventDirector.ts` (pure, seeded)

- `type WorldEventKind = "comet" | "flare" | "convoy"`.
- `createDirector(random: () => number)` makes a state with its own `clock` (seconds),
  `nextAt` (first event = 45s), `active: { kind, id, startedAt, endsAt } | null` and `lastKind`.
- `stepDirector(state, input) → WorldEventKind | null` advances the clock by `input.dt` unless
  `input.paused`, and returns a kind on the frame an event should start. `input` is
  `{ dt, paused, raceRunning, radioBusy, reducedMotion }`.
  - **Paused** (scene frozen or classic résumé): the clock does not advance, and nothing starts or ends.
  - **Reduced motion:** nothing starts. An active event still ends on time.
  - **Due** (`clock ≥ nextAt`) **but the race is running or the radio is busy:** the start is deferred
    until clear. It is not skipped.
  - **Kind:** uniform random among the kinds other than `lastKind`.
  - **When an event ends:** `nextAt = clock + 60 + random() * 60`.
- `endEvent(state)` ends the active event early, for example when an event cannot find a target.
- Durations: comet 25s, flare 12s, convoy 40s.

### Store (`spaceStore.ts`)

- `worldEvent: { kind, id, startedAt, target: { x, y, z } | string | null } | null`.
  - The comet's target is a point.
  - The convoy's target is a planet name.
  - The flare's target is null.
- `startWorldEvent(kind, target)` sets the event and broadcasts its announcement line.
  `endWorldEvent()` clears it.

### Driver

A small `WorldEventDirector` component inside the canvas, next to the other canvas systems, steps
the director each frame:

- `paused` comes from `selectSceneFrozen` or `showClassicCV`.
- `raceRunning` comes from `race.phase`.
- `radioBusy` is a broadcast less than 6s old, the same rule and constant as the cargo hails
  (`RADIO_BUSY_S`).
- `reducedMotion` comes from the store.

When the director starts an event, the driver picks its target and calls `startWorldEvent`:
- **comet:** the player's position;
- **convoy:** the nearest planet;
- **flare:** none.

### Radio

A new `events` section in `src/data/chatterLines.ts`:
- `comet` lines;
- `flare` lines;
- `convoy` lines keyed by planet id, so each delivery fits its project (Ruangrapi: tenants and
  leases; Portfolio: shaders; Fuxx: agents).

### Debug

`fitzDebug.triggerEvent(kind)` (DEV only) forces an event to start now, with its normal target.

## Part 2 — The events

### Comet close pass (`Comets.tsx`)

- A third, **visitor** comet is always mounted. It is hidden while idle.
- **On start:** it enters ~250u from the target point, with a direction picked at random. It flies a
  straight line whose closest approach to the target is **~35u** at **~22u/s**, so it is in view for
  about 20s. Then it hides.
- **Tail:** the existing physics, with the ion tail anti-sunward. `activity` is forced to ~1, because
  heliocentric activity would make it nearly tailless far from the sun.
- **Planet guard:** the closest-approach point is offset away from any planet whose zone it would
  enter, and the whole line must clear every planet's sphere. If no clear line is found in 8 tries,
  the director ends the event early.
- It is scannable as `COMET_VISITOR` and announced, for example "INTERSTELLAR VISITOR INBOUND //
  CLOSEST PASS 35U. WAVE".

### Solar flare (`Sun.tsx`, `GlobalCanvas.tsx` light, `PostFX.tsx` god rays)

The flare is a 12s envelope `flare(t)` from 0 to 1 and back to 0, with two gentle swells. It drives:
- the sun's `uHeat`, from 1.0 up to 1.6 at peak;
- the corona billboard's scale, from 1 to 1.6;
- the sun point light's intensity, from 2.1 to 3.2;
- the god-ray exposure, with up to +50%, still multiplied by the planet-occlusion visibility from
  PR #13.

At most one peak every 3s. It is announced, for example "SOLAR FLARE // HULL TEMP RISING. THE PILOT
WEARS SUNSCREEN". This changes no gameplay: no damage, no fuel effect.

### Cargo convoy (`CargoTraffic.tsx`)

- Three extra cargo clones, a lead and two wingmen in a V, are always mounted and hidden while idle.
- **On start:** the convoy appears ~200u from the target planet, on the far side from the sun so the
  pass is lit. It follows a smooth curve to an orbit at **2.2× the planet's size**, circles for
  ~15s, then climbs away and hides beyond 250u.
- The nav lights and engine flicker are the same as route traffic. In low-perf mode, the convoy uses
  one ship instead of three.
- **Route guard:** the approach curve must clear the other planets and the sun, and the orbit must
  stay outside the target's lock-retain radius, so the convoy never triggers or blocks the player's
  orbit lock.
- It is announced per planet, for example "CONVOY 7 INBOUND TO RUANGRAPI // CARGO: NEW TENANTS".

## Testing

**Unit (vitest):**
- **Director:**
  - first event at 45s;
  - later events 60–120s after the previous one ends;
  - never the same kind twice in a row;
  - the clock does not advance while paused;
  - a race or a busy radio defers an event rather than skipping it;
  - nothing starts under reduced motion, but an active event still ends;
  - a seeded sequence is deterministic.
- **Comet line:** the closest approach is within ~2u of 35 from the target; the line clears every
  planet sphere; an impossible geometry gives up after 8 tries.
- **Flare envelope:** it starts and ends at 0, its peak is 1, and two peaks are at least 3s apart.
- **Convoy path:** it ends on an orbit of 2.2× size around the target, outside the lock-retain radius;
  the wingmen keep their V spacing; the curve clears the other planets and the sun.

**End-to-end (new `tests/e2e/events.probe.mjs`):**
- Trigger each event with `triggerEvent`:
  - the visitor comet comes within ~40u of the ship;
  - the sun's corona scale rises and returns to 1;
  - the convoy reaches its orbit radius around the nearest planet;
  - each event broadcasts its line.
- Without triggering, the first event starts within ~50s of `sceneReady`.
- With reduced motion, no event starts.
- The existing perf probes still hold: programs 79/79, and draw calls within the ceilings while an
  event runs.

## Out of scope

- A meteor shower and a wormhole flicker (decision 1).
- Events that give the player something to do.
- Sound effects. Events use the existing broadcast path and its UI tick.
- The deferred minor items from #2's review.
