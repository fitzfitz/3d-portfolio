# Vertical Flight — Design

**Date:** 2026-07-18
**Status:** Approved (Additive scheme, user-selected after tradeoff review)
**Goal:** Full 3D navigation without breaking any existing muscle memory: WASD/arrows unchanged, Space=ascend, C (alias X)=descend, Shift=warp (moved from Space).

## Controls

| Input | Action | Change |
|---|---|---|
| W / ↑ | forward | unchanged |
| S / ↓ | brake/reverse | unchanged |
| A / D / ← / → | turn | unchanged |
| **Space** | **ascend** | was warp |
| **C or X** | **descend** | new |
| **ShiftLeft/ShiftRight** | **warp** | was Space |
| Touch ▲/▼ hold-buttons (stacked above BOOST) | ascend/descend | new |

Keyboard listener gains the same form-field guard as KeyJ (inputs/textarea/contentEditable never fly the ship).

## Physics (Spaceship.tsx)

- `FlightInput` += `ascend: boolean`, `descend: boolean`; `flight` += `y: number` (mutable telemetry).
- Vertical channel: accel 14 u/s² while held; vertical speed cap 7 u/s; decay `Math.pow(0.94, dt*60)` when idle.
- **Auto-level:** when neither vertical key held AND no activeZone: `y` eases toward 0 with a ~8s time constant (`y *= Math.pow(0.915, dt*60)` style) — nobody strands themselves above the world.
- **Soft ceiling/floor at y=±55:** pure helper `verticalStep(y, vy, input, dt)` computes the next (y, vy): inside the last 10 units before the bound, vertical speed scales down linearly to 0 at the bound (no hard pop). Extracted to `src/utils/verticalFlight.ts`, TDD.
- Warp: direction stays heading-based (horizontal); altitude preserved during warp.
- Ship visual: pitch `-vy * 0.045` (clamped ±0.3 rad) added to the existing bob pitch.

## World correctness

- New helper `toroidalDistance3(ax, az, ay, bx, bz, by, bounds)` = `hypot(toroidal-xz, Δy)` in `src/utils/toroidal.ts` (TDD). SpacePlanets proximity (planets + portal) and the spawn-card check use it — no orbit-locking from 50 units above a planet.
- Boundary wrap stays xz-only; y is handled by the soft clamp.

## Camera

Follow lerp on y uses a lower factor (frameLerp 0.03 vs 0.05) so climbs/dives feel swoopy; look-target y leads by `vy * 0.1` (clamped ±1).

## Instruments & teaching

- Radar: slim vertical altitude bar on the right edge of the radar canvas — range ±55, zero-line tick, filled marker at current `flight.y` (drawn in the existing rAF loop).
- HUD instruction card: `PILOT_STEER: WASD / ARROWS` · `ALTITUDE: SPACE / C` · `WARP_DRIVE: SHIFT` (touch wording: `LEFT JOYSTICK` · `RISE/DIVE BUTTONS` · `BOOST BUTTON`). SPAWN_PLASMA cell stays.
- NAV.LOC telemetry line gains `Y(..)`.
- Chatter: store flag `altitudeWarn` (guarded setter, set when |y| > 48) + `altitude` pool (3 lines) + RadioChatter subscription — same pattern as cometNear. TDD for scheduler pool + store guard.

## Touch

`TouchControls` adds two 56px hold-buttons (▲ RISE / ▼ DIVE) stacked vertically above the BOOST button, wired to `input.ascend/descend` with per-pointer capture like BOOST; included in the unmount/orbit-lock input reset.

## Testing

- Unit (TDD): `toroidalDistance3`, `verticalStep` (accel, cap, decay, auto-level, soft-clamp cases), scheduler `altitude` pool, store `setAltitudeWarn` guard. Expect 28 → ~36 tests.
- Probe: screenshot at max altitude (radar bar pegged, world below), return-to-plane via auto-level.
- Manual: feel of climb/dive, orbit-lock requires actual proximity, Shift-warp, touch buttons.

## Out of scope

Flight-sim pitch steering (revisit post asset-uplift); vertical NPC/creature reactions; collision (Phase 4).
