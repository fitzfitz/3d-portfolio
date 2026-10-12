# Flight feel: polish, soft edge, gravity wells, tractor beam

**Date:** 2026-10-12 · **Branch:** `feat/flight-feel` · **Status:** approved in brainstorming, awaiting spec review

## 1. Intent

One branch that makes flying itself richer, and clears the parked polish list.

- **Polish:** fix the eight parked defects from the #2/#3 reviews.
- **Soft edge:** the universe stops feeling like a box. The ±250 wrap stays, but it happens unseen inside a nebula haze.
- **Gravity wells:** the HUD already says `GRAVITY FIELD DETECTED` and `[GRAVITY LOCK]`; now gravity is real. Planets and the sun pull, and a well-flown pass slingshots you above the cruise cap.
- **Tractor beam and mining:** hold a key to pull light things in (crystals, belt pebbles) and to reel yourself toward heavy things (data shards).

**What "real" means here.** This is a stylised arcade universe, not a simulator. Every rule must be consistent and believable everywhere it applies; physical accuracy is bent on purpose in three named places, all in §5.1: the separate gravity momentum layer, the lenient climb-out and the fling.

**Success criteria**

1. A casual visitor (recruiter reading dossiers) is never trapped, dragged or interrupted by the new mechanics.
2. A player who flies deliberately gets visible, audible rewards: slingshot boosts, a glowing beam, reeling, ore.
3. No new WebGL shader programs (deep-space ceiling stays 79/79).
4. All existing unit and e2e tests pass, plus the new ones (§7).

**Out of scope:** gravity on NPCs, comets or collectibles; gravity during warp; mining the hero asteroids; the pilot logbook (next feature, which will build on these mechanics).

## 2. Architecture

Pure logic in `src/utils/`, unit-tested without a scene, in the same pattern as `beltPush.ts`, `race.ts` and `eventDirector.ts`. Components stay thin.

| Module | Purpose |
|---|---|
| `src/utils/edgeHaze.ts` | `edgeDepth(x, y, z)` → 0..1; `wrapCoord(v)` exact 500-unit wrap |
| `src/utils/gravityWell.ts` | well list, summed acceleration, safeguards, speed-cap step |
| `src/utils/tractorBeam.ts` | cone test, target picking, pull step, reel step |
| `src/utils/mining.ts` | per-pebble state, ore accounting, regrow |
| `src/store/beamState.ts` | module-level mutable beam state, the same pattern as `flight` and `bodies`; never causes a React render |
| `src/components/layout/EdgeHaze.tsx` | DOM overlay driven by a rAF loop |
| `src/components/canvas/TractorBeam.tsx` | beam cone and tether lines |

All per-frame code reuses scratch objects. No allocation per frame.

## 3. Polish fixes

Each fix lands with a regression test that fails on the old code. When proving that, stash **only the source file**, never the test.

| # | Defect | Fix | File |
|---|---|---|---|
| P1 | Cargo ships bank out of curves | Flip the sign of the curvature roll term so ships bank into turns; leave the swerve term (already correct). Avoid mutating `tanA` with `.cross` | `CargoTraffic.tsx:165` |
| P2 | A curious jellyfish loses its swim surge and bob | Track the path position from *before* surge and bob are added, and cancel drift against that | `jellyMood.ts:73-77`, `SpaceJellyfish.tsx:209-211` |
| P3 | Cargo hails are announced to screen readers | Add a `silent` (not mirrored to aria-live) option to `sendBroadcast`; cargo hails use it. Scan reports and world events still announce | `spaceStore.ts:420`, `RadioChatter.tsx:65-75`, `CargoTraffic.tsx:151` |
| P4 | Inner convoy wingman orbits at 29.2u, inside lock-retain (30.4u) | Raise the convoy orbit factor so every slot clears retain plus a margin; test all three slots with `convoyShipOffsetAt` | `worldEvents.ts:90-94`, `tests/worldEvents.test.ts` |
| P5 | Planet with no convoy lines announces a flare line | Fall back to a generic convoy line | `WorldEventDirector.tsx:69` |
| P6 | Visitor comet's dust tail lost its curve | Apply `VISITOR_DUST_AGE` to the tail's timing only, not to the τ that feeds drift (∝ τ²) and spread | `Comets.tsx:26, 248-251` |
| P7 | Per-frame allocations | Reuse an output object in `eventDirector` step and the director input; give `orbitPosition` and `keplerPosition` an optional `out` parameter; hoist the comet `posAt` closure; reuse the jelly input object and a scratch Vector3 for `getTangentAt` | `eventDirector.ts:62`, `WorldEventDirector.tsx:107-114`, `orbits.ts:26`, `kepler.ts:36`, `Comets.tsx:165-169`, `SpaceJellyfish.tsx:204, 216-222` |
| P8 | `basepath.probe` waits a fixed 6s for assets | Poll until every GLB and texture request has settled, with a timeout | `tests/e2e/basepath.probe.mjs:138` |

## 4. Soft edge: hidden wrap in fog

### 4.1 Behaviour

- `edgeDepth(x, y, z)` = smoothstep over the largest of `|x|`, `|y|`, `|z|` from `HAZE_START = 215` to `COSMIC_BOUNDS = 250`, giving 0..1.
- **Overlay:** `EdgeHaze.tsx`, a full-screen DOM layer with a radial violet and teal nebula gradient. Opacity = `0.92 × edgeDepth`, written to the element's style each rAF frame from `flight` (the same pattern as the HUD telemetry loop). It sits above the canvas and below the HUD. No `backdrop-filter` (see `tests/noBackdropFilter.test.ts`).
- **Wrap:** the ship lands at about ∓247–250, still deep in the haze, so the view clears as you fly inward and the jump is never visible.
- The wrap uses `wrapCoord`, which subtracts exactly 500 (not the current snap to ∓247), so it agrees with `toroidal.ts`. The camera is offset by the same delta.
- The wrap **no longer** calls `triggerTeleportFlash`: no cyan flash, no zap, no wrap chatter.
- **Number-key and d-pad jumps** keep the flash and the zap. RadioChatter stops reacting to teleport flashes entirely (`RadioChatter.tsx:53-56`), so a jump no longer picks a wrap line; its zone line arrives as it does today.

### 4.2 Radio

- A new `haze` chatter pool replaces `wrap`, including "EDGE OF SPACE REACHED. SPACE DISAGREES". The lines keep the dry voice, for example:
  - "NEBULA DENSITY RISING. SENSORS GOING SOFT."
  - "THE MAP SAYS 'HERE BE MORE OF THIS'."
  - "VISIBILITY ZERO. CONFIDENCE, ALSO ZERO."
- Fires once per haze visit when `edgeDepth` first passes 0.3, only if the radio has been quiet for `RADIO_BUSY_S`, not during a race. Re-arms when depth falls below 0.1.

## 5. Gravity wells

### 5.0 Why a separate momentum layer

The ship's flight model is heavily damped: thrust 25.2 u/s², drag about 1.09/s (`SPACE_DRAG` 0.982 per 60 fps frame), cruise clamp 10.8. A tuning simulation (2026-10-12) showed that real gravity added straight to that velocity is almost invisible (0.3° of bend on a pass with W held). Letting the nose follow the path spirals the ship into the planet, because drag drains the tangential speed an orbit needs, and no configuration produced an exit boost. Damping removes exactly the momentum a slingshot is made of.

So gravity acts on its own vector, **gravity momentum `G`**. The pilot's velocity `v` is integrated exactly as today and is untouched by this feature. The ship moves by `v + G`.

### 5.1 Wells

`gravityWell.ts` exports a well type `{ x, y, z, g, radius, rMin }`.

| Body | `radius` | `rMin` | `g` | Pull at reference distance |
|---|---|---|---|---|
| Planet (×3) | `3.5 × PLANET_SIZE` = 56 | `PLANET_SIZE` = 16 | `PLANET_WELL_G = 3000` | 6.9 u/s² at 21u |
| Sun | 110 (stops short of the inner orbit at 115) | `SUN_COLLIDER.r` = 9.5 | `SUN_WELL_G = 1000` | 3.1 u/s² at 18u (spawn) |
| Portal | none | | | |

Each frame (`stepGravity`), in order:

1. **Decay:** `G *= 0.5^(dt / G_HALF_LIFE)`, with `G_HALF_LIFE = 3` s.
2. **Per well** within `radius` (deltas via `wrapDelta`):
   - Acceleration `a = g / max(r, rMin)²`, times an edge fade: 1 inside 0.8 × radius, smoothstep down to 0 at radius.
   - **Lenient climb-out:** if the ship's total velocity `v + G` points away from the centre, `a *= CLIMB_OUT = 0.4`.
   - **Fling (outbound alignment):** while moving away from the centre, `G`'s direction eases toward the direction of `v + G` with a half-life of `FLING_HALF_LIFE = 0.25` s, keeping its length. This stands in for real gravity turning the velocity, and it is what produces the exit boost.
   - `G += toward-centre × a × dt`.
3. **Cap:** `|G| ≤ G_MAX = 14`, and `|v + G| ≤ SPEED_CEILING = 24`; when over, `G` is shortened. 24 × 0.05 = 1.2u per step, far below race `MAX_STEP` (10).

Overlapping wells add up.

### 5.2 Safeguards

| Rule | Effect | Prevents |
|---|---|---|
| Before the first input (the existing `hasFlown` flag) | no pull, `G = 0` | A new visitor at spawn drifting into the sun |
| **Station-keeping:** no thrust input (W, analog thrust, reel) for `STATION_KEEP_AFTER = 0.6` s | no pull; `G` decays with a 0.4 s half-life instead of 3 s | An idle visitor drifting into lock or the sun (simulated: 1.6u drift from 30u) |
| Warp active | no pull; `G` decays with a 0.2 s half-life | Unpredictable warp lines |
| Collision (asteroid or sun) | `G = 0` | Repeated impacts against the sun |
| Orbit lock | `G = 0`, no wells | Fighting the orbit ride |
| **Escape grace:** after a break-orbit from planet P | P's well is skipped until the ship is outside P's well radius | The lock → escape → re-lock loop |
| Photo mode | unchanged; the ship is frozen | |
| Reduced motion | wells still apply (player-driven); planets are frozen there, which is fine | |

### 5.3 Integration order in Spaceship.tsx

Thrust and drag on `v` (unchanged) → `stepGravity` (updates `G`) → integrate `pos += (v + G) × dt` → collisions (zero `G` on a hit) → wrap. `flight.speed = |v + G|`. The chase-cam speed framing and the streaks read the same total.

### 5.4 Capture rule (orbit lock)

Lock currently engages at any speed inside `LOCK_ENGAGE` (20.8u), and lock opens the dossier modal. New rule in `SpacePlanets.tsx:473-476`:

- Engage only when `dist < size × LOCK_ENGAGE_FACTOR` **and** (`flight.speed < CAPTURE_SPEED = 14` **or** `dist < size + CAPTURE_SURFACE_MARGIN`, where `CAPTURE_SURFACE_MARGIN = 2`).
- The surface safety net means warping or diving straight at a planet still docks (simulated at about 17.9u), and the ship can never pass through a planet.
- Retain behaviour is unchanged.

### 5.5 Feedback

- **Plume:** `drivePlumes` power target rises with `|G|`, through the existing `uPower` uniform.
- **Sound:** `soundManager.whoosh()`, a new `blip()` cue, when the ship leaves a planet well above 14 u/s.
- **HUD:** the speed readout takes the accent colour while `flight.speed > SHIP_MAX_SPEED`.
- **Radio:** a new `slingshot` pool, for example "GRAVITY ASSIST LOGGED. PHYSICS SENDS ITS REGARDS." It fires on a planet-well exit above 14 u/s, at most once every 30 s, only when the radio is not busy, not during a race.

### 5.6 Tuning targets (unit-test simulations at 60 fps, from the 2026-10-12 tuning run)

All scenarios: planet well at the origin, ship starting at x = -90 moving +x at 10.8 with W held and the nose fixed at +x, offset `b` on y.

| Scenario | Simulated | Test asserts |
|---|---|---|
| `b = 40` | closest 33.6, peak 14.8 | no capture; closest ≤ 36; peak ≥ 14 |
| `b = 34` | closest 24.6, peak 17.0, speed at well exit 14.7 | no capture; closest ≤ 28; exit speed ≥ 13.5 |
| `b = 30` | closest 18.8, peak 19.1, not captured | no capture (speed ≥ 14 inside 20.8; never inside 18) |
| `b = 22` or straight in | captured at about 17.9 | captured; never closer than 17 before capture |
| Idle at 30u: no thrust from t = 0, starting at rest (after first input) | drift 1.6u in 30 s | drift < 3u |
| Sun well, `b = 20` | closest 14.7 | closest > 9.5 |

The final constants are recorded in the module's doc comment, with a pointer to this table.

## 6. Tractor beam and mining

### 6.1 Input and state

- Hold **F** (keyboard), **LB** (gamepad button 4), or a new **BEAM** button in `TouchControls.tsx`. Added to the shared input as `input.beam`.
- Active only when not warping, not in photo mode, not orbit-locked.
- Spaceship.tsx writes `beamState` each frame: `active`, nose position, nose direction (pitch included), and resets the per-frame target budget (`BEAM_MAX_TARGETS = 3`). The crystal, shard and belt components claim from that budget. A one-frame lag is acceptable.

### 6.2 The mass rule: the lighter object moves

| Target | Range | Behaviour |
|---|---|---|
| Fuel crystal (light) | 30u, cone half-angle 20° | Pulled toward the ship at 20 u/s *relative to the ship*; collected by the existing pickup code. If released, it stays where it is |
| Belt pebble (light) | 15u, same cone | Leaves its orbit and flies in at 8 u/s relative; absorbed at the nose as ore |
| Data shard (anchored) | 30u, same cone | **Does not move.** The beam reels the *ship* toward it: `REEL_ACCEL = 15` u/s² toward the shard, capped at `MAX_SPEED`, and collected by the existing pickup at 3u. Reeling counts as thrust input for station-keeping (`STATION_KEEP_AFTER`, §5.2) |

- Targets are picked nearest first. Cone and distance use `wrapDelta`, so they work across the seam.
- Pulled items ignore gravity.

### 6.3 Mining

- `mining.ts` holds per-pebble state in typed arrays sized to the ring's full count: `pulled`, `absorbed`, `regrowAt`.
- A pulled pebble's ring-local displacement is driven toward the ship (using the existing `toRingLocal`). `stepRock` skips pulled and absorbed pebbles.
- An absorbed pebble has scale 0 until `regrowAt` (90s, game time), then grows back over 2s at its home position.
- **Ore:** each pebble adds `FUEL_PER_CRYSTAL / 16` (= 1.5625) fuel, clamped at `FUEL_MAX`. Target: **filling an empty tank by mining takes at least 40s** of continuous beaming in the densest part of the belt (unit simulation; at most about 1.6 pebbles/s).
- Mining is allowed during races; the 40s target keeps it from being a shortcut.

### 6.4 Visuals and sound

- **Beam cone:** a tapered cone mesh at the nose using the engine plume's existing `ShaderMaterial`. Add a `uColor` uniform to `enginePlume.ts`, which defaults to the current colours so the plume is unchanged; the beam sets it to teal. A uniform adds no program. The e2e probe verifies that the program count stays at 79 or below.
- **Tethers:** one line from the nose to each target, reusing the streak line material's parameters.
- **Absorb spark:** reuse the ship's existing spark burst at the nose.
- **Sound:** `soundManager.beamOn()` on activation, and a quiet `oreTick()` per pebble. A soft hum loop, built like the existing engine loop, while the beam is active; its pitch rises slightly with each pebble and resets on release.
- **HUD:** a small `ORE n/16` readout next to the fuel bar, visible while mining and for 2s after.
- **Radio:** a first-ore-of-the-session line in the house voice, for example "ORE IN THE HOLD. IT'S ROCKS. WE'RE CALLING IT FUEL." Same busy and race rules as the other pools.
- **Controls hint:** add `F BEAM` (and LB on gamepad) wherever the existing controls hint lists keys.
- Reduced motion: the beam works. Ambient spin is already frozen, and the cone's shimmer reads `ambientTime`, so it freezes too.

## 7. Testing

### 7.1 Unit (vitest, `tests/`)

| File | Covers |
|---|---|
| `edgeHaze.test.ts` | depth 0 inside 215 and 1 at 250, largest-axis rule, symmetry across the seam; `wrapCoord` exact 500 period |
| `gravityWell.test.ts` | inverse-square, edge fade to 0, climb-out factor, fling alignment, overlapping sum, `G` decay and caps, each safeguard; all §5.6 simulations |
| `capture.test.ts` | the §5.4 capture rule, including the 2u surface safety net |
| `tractorBeam.test.ts` | cone (including across the seam), nearest-first budget of 3, relative pull, reel accel capped at cruise |
| `mining.test.ts` | ore value, regrow timing, the ≥ 40s full-tank simulation |
| Polish | one regression test per P1–P7, in the existing test file for each area |

Existing suites must stay green: `planetClearance`, `orbitInvariant`, `fuel`, `race`, `toroidal*`, `worldEvents` (extended for P4).

### 7.2 End-to-end

New `tests/e2e/mechanics.probe.mjs`, registered in `run.mjs` before `basepath`:

1. **Edge:** teleport to x = 230; haze opacity > 0.5; fly through the seam; `isTeleporting` never set; the haze line appears in the radio.
2. **Gravity:** set attitude and fly a W-held pass 34u off a planet's centre; peak speed > 13, no lock. A straight-in approach locks and the dossier dialog opens. Idle after first input: displacement < 3u over 10s.
3. **Beam:** place a crystal ahead and hold F; it is collected. Hold F at a belt pebble; the ORE readout increments. Hold F at a shard; the ship reels in and the shard is collected.
4. **Budgets:** with the beam on and speed over the cap, the program count is ≤ 79 and the frame-time budget holds.
5. **Reduced motion:** the haze shows and the beam works.

Updated: `flight.probe.mjs`, because the wrap seam no longer flashes; `basepath.probe.mjs` (P8). Test hooks go through the existing debug bridge (`window.__fitz` / `fitzDebug`), which is dead-code-eliminated in production.

### 7.3 Verification bar

- `npm test` all green.
- `tsc -b` clean.
- `npm run lint` clean.
- `npm run test:e2e` all green: the previous 28 plus the new probe. Close any Playwright tab that is rendering the app first.
- A fresh reviewer checks the whole branch before the PR.

## 8. Build order

Each step is committed separately, and each leaves the app shippable.

1. P1–P8 polish
2. Edge haze and wrap
3. Gravity momentum, wells, safeguards, capture rule and feedback
4. Beam core: input, `beamState`, crystal pull, cone and tethers
5. Shard reeling
6. Mining
7. HUD readouts, touch button, sound, radio pools, controls hint
8. `mechanics.probe.mjs`, the full verification bar, then review

## 9. Shipping

One PR from `feat/flight-feel`, pushed and merged as **fitzfitz**. A merge to `main` deploys to GitHub Pages and Cloudflare. The red Cloudflare Workers Builds check on the PR branch is the known configuration issue and does not block.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Gravity tuning feels wrong in the hand despite passing simulations | Constants live in one module and match the §5.6 tuning run; e2e probe plus a manual fly-through before the PR |
| Beam cone material does not share the plume's program | The probe catches it; fallback is tether lines only |
| Mining pebble state complicates `BeltRing` | Pure `mining.ts` owns the state; `BeltRing` only reads arrays |
| The new probe flakes under full-suite load | Use `pollUntil`, never fixed sleeps |
