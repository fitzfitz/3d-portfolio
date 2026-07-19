# Full-Volume Solar System — Design

**Date:** 2026-07-19
**Status:** Approved by user (flight model, topology, and layout options all confirmed)

## Goal

Convert the portfolio's mostly-horizontal space (XZ plane, y ≈ 0, altitude ceiling at ±55
with auto-return) into a full 3D volume: the ship flies anywhere with no safe-return, stars
fill the sky in every direction, the sun sits at the exact center of space, and every
object — planets, belts, traffic, collectibles — is arranged through the volume vertically
and horizontally on a living, inclined-orbit architecture.

## Decisions (user-confirmed)

1. **Flight model:** true pitch flight — the nose aims anywhere, thrust follows the nose.
   Implemented as yaw + pitch spherical heading (not quaternion 6DOF): pitch is clamped to
   ±83° so the ship never crosses the pole, roll remains a cosmetic bank, and the radar's
   heading-up projection (yaw) stays meaningful.
2. **World bounds:** the existing ±250 toroidal wrap extends to all three axes (a toroidal
   cube). Teleport flash fires on any axis crossing. No safe-return of any kind.
3. **Layout:** inclined living orbits — each project planet rides its own slowly-precessing
   inclined orbital plane around the central sun; belts tilt; a polar halo band, 3D cargo
   lanes, steep comet orbits, and vertically-scattered collectibles fill the volume.

## 1. Flight core

### New module `src/utils/pitchFlight.ts` (replaces `src/utils/verticalFlight.ts`)

Pure, tested. State: `pitch` (rad), `pitchVel` (rad/s).

- Pitch rate: accelerates toward ±`PITCH_SPEED` (1.8 rad/s) with the same eased lerp feel
  as yaw (`frameLerp(0.07)` attack, `frameLerp(0.12)` release).
- Clamp: `PITCH_MAX = 1.45` rad (~83°). Approaching the clamp eases, never snaps.
- **No auto-level, no ceiling, no drift home.** Pitch stays where the pilot leaves it.
- Exports `noseDirection(yaw, pitch): {x,y,z}` — the spherical unit vector
  `(sin yaw · cos pitch, sin pitch, cos yaw · cos pitch)`.

### Spaceship.tsx changes

- The vertical channel (`vy`, `verticalStep`, grace timer, `V_CEIL` warn) is deleted.
  Velocity is a full 3D vector: thrust (and warp) accelerate along `noseDirection`.
- Controls keep their keys, change meaning: **Space = pitch up, C/X = pitch down**,
  W/↑ thrust, A/D yaw, S brake, Shift warp. `flight.input.ascend/descend` now mean
  pitch up/down.
- Ship visual pitch = flight pitch via the existing YXZ euler order (guarded by
  `shipPitchOrder.test.ts`); bank-on-yaw kept; bob kept.
- Chase cam: camera sits at `pos − noseDir · camDistance + worldUp · camHeight` with the
  existing lerp smoothing and warp FOV. Look target leads the nose by 1.5 units.
- Wrap: X, Y, and Z all wrap at ±250 with the same re-entry inset (3 units) and camera
  offset correction; `triggerTeleportFlash()` on any axis.
- Orbit lock: `lockedCenter` is re-read **every frame** from the live body position (see
  §3 telemetry) so the ship rides along with the moving planet. On lock entry pitch eases
  to 0; the orbit ring stays in the planet's horizontal plane. Escape push uses the 3D
  nose direction.
- `altitudeWarn` repurposed: fires when `|y| > 180` ("ecliptic departure" advisory,
  chatter flavor only — nothing pulls the ship back). Chatter copy updated accordingly.
- Spawn stays (0, 0, 18); `isNearSpawn` check unchanged.

## 2. World topology

- `src/utils/toroidal.ts`: `toroidalDistance3` wraps **all three axes** (per-axis
  `wrapDelta`, then hypot). `wrapDelta` unchanged (already single-axis generic).
- `src/utils/scannables.ts` `nearestScannable`: wrap-aware 3D distance.
- All proximity checks become wrap-aware 3D: cargo reaction (`CargoTraffic.tsx`), comet
  `cometNear` (`Comets.tsx`), shard pickup (already `toroidalDistance3` — inherits the
  Y-wrap fix).
- Collision (`utils/collision.ts`) is already 3D spheres; unchanged. Interior colliders
  never straddle the seam, so non-toroidal collision remains fine.

## 3. The living system

### New module `src/utils/orbits.ts`

Classic orbital elements per body: `{ radius, angularSpeed, inclination, node, phase }`.

`orbitPosition(el, t)` = rotate the flat circle `(r·cos θ, 0, r·sin θ)`,
`θ = phase + t·angularSpeed`, by inclination (about X) then ascending node (about Y).
Pure, tested (radius invariant, inclination extremes, node rotation).

### Body table (constants.ts)

| body   | radius | inclination | node  | period (~) | color   |
|--------|--------|-------------|-------|------------|---------|
| saas   | 115    | +20°        | 0°    | ~7 min     | #00ff87 |
| video  | 150    | −40°        | 120°  | ~8.5 min   | #00f0ff |
| agent  | 185    | +60°        | 240°  | ~10 min    | #bd00ff |

Periods are slow enough that orbit-lock tracking is trivial (planet moves ≪ ship speed).
`PlanetData.pos` is replaced by `PlanetData.orbit: OrbitalElements`.

### Shared body telemetry

`export const bodies: Record<string, {x,y,z}>` (same mutable-outside-React pattern as
`flight`), written once per frame by SpacePlanets' `useFrame`, read by:
- Spaceship (live lock center),
- SpacePlanets' own proximity/zone detection,
- RadarMap blips,
- HUDOverlay planet coordinates (fixes the already-stale hardcoded readout),
- the scannable registry (planets re-registered live each frame, like the jellyfish).

### Visuals

- Each planet group is positioned from `bodies` each frame; per-planet contents
  (atmosphere, moons, rings, zone ring, point light) ride along unchanged.
- Faint orbit-line rings (planet signature colors, ~0.25 opacity) render the three
  inclined orbital circles so the 3D architecture reads at a glance.
- The **contact portal moves to [0, 95, −150]** — static, but well off-plane so pilots
  must climb to reach it. `PORTAL_POS` updated; everything else about the portal stands.
- Sun: stays at origin — collider r 4, GodRays, corona unchanged; point light `distance`
  260 → **450** so the cube's corners still receive sunlight (decay stays 0).

## 4. Sky

- `StarLayer` distribution: cylinders with a ±60 y-slab → **uniform spherical shells**
  (uniform on the sphere via `randomDirection`-equivalent, radius in [radiusMin, radiusMax]).
  Same three-depth parallax (140–260) and twinkle.
- The starfield group **follows the ship** (position set from `flight` each frame) so the
  shells surround the pilot anywhere in the cube; rotation drift kept.
- New fourth layer: ~350 faint "dust" stars filling a 120-unit cube around the ship,
  positions wrapped modulo the cube as the ship moves — near-field parallax speed cues in
  every direction, all axes. Skipped in low-perf mode.
- Nebula clusters redistributed: two pushed to y ≈ ±100, others spread; positions in §7.
- DistantGalaxies: both sprites repositioned off-plane; one new third galaxy near the
  +Y pole.

## 5. Content redistribution

- **Asteroid belt** (`AsteroidBelt.tsx`): main belt (r 40–70) tilts to a 25° inclined
  plane (group rotation, replacing the 0.07 tilt). New second **polar halo band**: sparser
  instanced ring, r 80–95, inclination ~75°, so climbing threads asteroid country.
- **Scenery asteroids** (`data/asteroids.ts`): 12 → 18 instances, redistributed with y in
  ±190. Colliders derive from the same table (automatic).
- **Cargo routes** (`CargoTraffic.tsx`): three CatmullRom loops become genuinely 3D —
  one long spiral climbing −80 → +110, one diving through the belt gap, one ringing the
  portal altitude (y ≈ 95). Proximity/banking check goes 3D (`dx,dy,dz`).
- **Comets** (`utils/kepler.ts`, `Comets.tsx`): the `y = z·tilt` shear becomes true
  orbital elements (inclination + node, reusing §3 rotation math) with steep inclinations
  (45–70°) so slingshots dive through the ecliptic. Tail math is already 3D.
- **Data shards** (`data/shards.ts`): redistributed — two clusters high (y ≈ +140), two
  deep (y ≈ −140), the rest scattered, several near planet orbits and the portal.
- **Jellyfish** (`data/jellyfishPath.ts`): control points stretched vertically
  (y −60 → +120); `JELLY_NEAR_T` recomputed against 3D distance.
- **Plasma anomalies** (`PlasmaAnomalies.tsx`): reflection walls become a 3D box
  including Y, size 26 → 60.
- **FollowingClickPlane** (`GlobalCanvas.tsx`): becomes camera-facing (billboard) so
  click-to-spawn works while pitched.

## 6. HUD, radar, touch

- **RadarMap**: stays a heading-up XZ disc driven by yaw. Each blip gains a
  **relative-altitude chevron** (▲ above / ▼ below, opacity scaled by |Δy| with Y-wrap
  aware delta). Planet blips read live `bodies`. The `V_CEIL` altitude bar is replaced by
  a **pitch ladder strip** (nose angle −90°…+90°, center notch at level).
- **HUDOverlay**: planet list prints live orbital coordinates; SPACE/C legend relabels
  "ALTITUDE" → "PITCH"; NAV.LOC unchanged (already prints x/y/z).
- **TouchControls**: RISE/DIVE buttons relabel to PITCH ▲ / PITCH ▼ (still write
  `ascend`/`descend`).
- **RadioChatter**: altitude advisory lines become ecliptic-departure flavor.

## 7. Placement tables (initial values, tune during implementation)

- Nebulae: (120, 100, −120) purple · (−130, −95, 110) cyan · (140, −30, 130) pink ·
  (−120, 40, −140) green · (0, 30, −180) golden.
- Galaxies: reposition existing two to y ±80; new third at (30, 210, −60).

## 8. Error handling & edge cases

- Pitch clamp prevents pole singularity in the chase cam; camera up stays world-up.
- Warp during steep pitch: velocity is `noseDir · WARP_SPEED` — wrap on Y behaves exactly
  like X/Z (inset re-entry prevents oscillation).
- Orbit lock on a moving planet: lock geometry factors (`ZONE/ENGAGE/RETAIN`) unchanged;
  since the center moves ≪ ship speed, the existing hysteresis invariants hold — the
  invariant test gains a moving-center case.
- Photo mode: freezes ship physics as today; planets keep orbiting (alive backdrop).
- Low-perf mode: dust layer and polar halo band are skipped.

## 9. Tests

- **New:** `pitchFlight.test.ts` (rates, clamp, no drift, noseDirection math),
  `orbits.test.ts` (radius invariant, inclination/node geometry, period),
  3-axis wrap cases in `toroidal3.test.ts`.
- **Rewritten:** `toroidal3.test.ts` (Y now wraps), `kepler.test.ts` (real elements),
  `radarTransform.test.ts` (+ chevron delta math), `jellyfishPath.test.ts` (3D near-pass).
- **Deleted:** `verticalFlight.test.ts` (with its module).
- **Kept as guards:** `orbitInvariant.test.ts` (+ moving-center case),
  `collision.test.ts`, `shipPitchOrder.test.ts`, `wrapDelta.test.ts`,
  `spaceStore.test.ts` (altitudeWarn semantics updated).

## 10. What disappears

`V_CEIL`, the soft ceiling and slow-down band, auto-level drift home, the vertical-strafe
channel, the 48-unit altitude warn, the radar altitude bar, the thin star slab, and every
XZ-only proximity check.
