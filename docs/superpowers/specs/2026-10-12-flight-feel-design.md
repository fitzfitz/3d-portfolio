# Flight feel: polish, soft edge, gravity wells, tractor beam

**Date:** 2026-10-12 · **Branch:** `feat/flight-feel` · **Status:** approved in brainstorming, awaiting spec review

## 1. Intent

One branch that makes flying itself richer, and clears the parked polish list.

- **Polish:** fix the eight parked defects from the #2/#3 reviews.
- **Soft edge:** the universe stops feeling like a box. The ±250 wrap stays, but it happens unseen inside a nebula haze.
- **Gravity wells:** the HUD already says `GRAVITY FIELD DETECTED` and `[GRAVITY LOCK]`; now gravity is real. Planets and the sun pull, and a well-flown pass slingshots you above the cruise cap.
- **Tractor beam and mining:** hold a key to pull light things in (crystals, belt pebbles) and to reel yourself toward heavy things (data shards).

**What "real" means here.** This is a stylised arcade universe, not a simulator. Every rule must be consistent and believable everywhere it applies; physical accuracy is bent on purpose in two named places (the lenient climb-out and the slow overspeed decay, §5.1 and §5.3).

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

### 5.1 Wells

`gravityWell.ts` exports a well type `{ x, y, z, g, radius }` and `wellAccel(ship, vel, wells, out)`.

| Body | Radius | `g` | Pull at reference distance |
|---|---|---|---|
| Planet (×3) | `3.5 × PLANET_SIZE` = 56u | about 5300 (tuned by test) | about 12 u/s² at 21u (thrust is 25.2) |
| Sun | 110u (stops short of the inner orbit at 115) | about 970 (tuned by test) | about 3 u/s² at 18u (the spawn distance) |
| Portal | none | | |

- Acceleration = `g / max(r, rMin)²` toward the centre, times an edge fade (smoothstep from 1 at 0.8 × radius to 0 at radius). `rMin` = body size, which softens the singularity.
- **Lenient climb-out:** when the ship's velocity points away from the centre (`v · r̂ > 0`), that well's pull is scaled by `CLIMB_OUT = 0.4`.
- Overlapping wells add up. Deltas use `wrapDelta`, for consistency with every other distance in the game.

### 5.2 Safeguards

Applied when Spaceship.tsx builds the active well list each frame:

| Rule | Prevents |
|---|---|
| No gravity before the first input (the existing auto-aim flag) | A new visitor at spawn drifting into the sun |
| **Station-keeping:** when there is no thrust input, gravity × smoothstep(1, 3, speed) | An idle visitor reading the HUD or a dossier drifting into lock or the sun |
| While locked: no wells (the lock rides the planet) | Fighting the orbit ride |
| **Escape grace:** after a break-orbit from planet P, P's well is skipped until the ship is outside P's well radius | The lock → escape → re-lock loop |
| No gravity while warp is active (the warp drive overrides it) | Unpredictable warp lines |
| Photo mode: unchanged (the ship is frozen) | |
| Reduced motion: wells still apply (player-driven); planets are frozen there, which is fine | |

### 5.3 Speed above the cap

The current integrator clamps to `MAX_SPEED` (10.8) in the thrust branch and applies `SPACE_DRAG` (about 1.09/s) to all speed, so any boost would be gone in under 0.5s. New rule, in a pure `stepSpeed(vel, speedBefore, dt)` in `gravityWell.ts`:

- **Thrust over the cap steers but cannot add speed:** after thrust, if `speedBefore > MAX_SPEED`, clamp to `speedBefore`; otherwise clamp to `MAX_SPEED`, as today.
- **Overspeed decay:** normal drag applies up to `MAX_SPEED`. The excess above it decays with a half-life of `OVERSPEED_HALF_LIFE = 1.2s`.
- **Hard ceiling** `OVERSPEED_MAX = 24` u/s outside warp. Warp stays assigned at 39. 24 × 0.05 = 1.2u per step, far below race `MAX_STEP` (10).

Order in Spaceship.tsx: thrust → gravity → speed step → integrate → collisions → wrap.

### 5.4 Capture rule (orbit lock)

Lock currently engages at any speed inside `LOCK_ENGAGE` (20.8u), and lock opens the dossier modal. New rule in `SpacePlanets.tsx:473-476`:

- Engage only when `dist < size × LOCK_ENGAGE_FACTOR` **and** (`flight.speed < CAPTURE_SPEED = 14` **or** `dist < size + 1.5`).
- The surface safety net means warping straight at a planet still docks, and the ship can never pass through a planet.
- A fast slingshot can skim down to about 17.5u without opening anything.
- Retain behaviour is unchanged.

### 5.5 Feedback

- **Plume:** `drivePlumes` power target rises with overspeed, through the existing `uPower` uniform.
- **Sound:** `soundManager.whoosh()`, a new `blip()` cue, when the ship leaves a well above 14 u/s.
- **HUD:** the speed readout takes the accent colour while speed > `MAX_SPEED`.
- **Radio:** a new `slingshot` pool, for example "GRAVITY ASSIST LOGGED. PHYSICS SENDS ITS REGARDS." It fires on a well exit above 14 u/s, at most once every 30s, only when the radio is not busy, not during a race.

### 5.6 Tuning targets (unit-test simulations at 60 fps)

| Scenario | Target |
|---|---|
| Cruise (10.8) coast past a planet, closest point 25u | exit speed ≥ 15 u/s; no capture |
| Cruise coast past a planet, closest point 35u | heading bends ≥ 15°; never inside 20.8u |
| Idle at spawn (0, 0, 18), first input already given, no thrust | moves < 1u in 30s |
| Cruise coast straight through the sun's well, closest point 20u | never inside the sun collider (9.5) |
| Slow approach (6 u/s) at a planet | captures |
| Warp (39) straight at a planet | captures through the surface safety net |

`g` values, `CLIMB_OUT` and `OVERSPEED_HALF_LIFE` are tuned until all of these pass. The final numbers are recorded in the module's doc comment.

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
| Data shard (anchored) | 30u, same cone | **Does not move.** The beam reels the *ship* toward it: `REEL_ACCEL = 15` u/s² toward the shard, capped at `MAX_SPEED`, and collected by the existing pickup at 3u. Reeling counts as thrust for station-keeping |

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
| `gravityWell.test.ts` | inverse-square, edge fade to 0, climb-out factor, overlapping sum, each safeguard; `stepSpeed` (no thrust gain over the cap, half-life, ceiling); all §5.6 simulations |
| `capture.test.ts` | the §5.4 capture rule, including the surface safety net |
| `tractorBeam.test.ts` | cone (including across the seam), nearest-first budget of 3, relative pull, reel accel capped at cruise |
| `mining.test.ts` | ore value, regrow timing, the ≥ 40s full-tank simulation |
| Polish | one regression test per P1–P7, in the existing test file for each area |

Existing suites must stay green: `planetClearance`, `orbitInvariant`, `fuel`, `race`, `toroidal*`, `worldEvents` (extended for P4).

### 7.2 End-to-end

New `tests/e2e/mechanics.probe.mjs`, registered in `run.mjs` before `basepath`:

1. **Edge:** teleport to x = 230; haze opacity > 0.5; fly through the seam; `isTeleporting` never set; the haze line appears in the radio.
2. **Gravity:** set attitude and fly a fast pass past a planet; speed > 10.8 after exit, no lock. A slow approach locks and the dossier dialog opens. Idle at spawn after first input: displacement < 1u over 10s.
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
3. Speed step and capture rule
4. Gravity wells, safeguards and feedback
5. Beam core: input, `beamState`, crystal pull, cone and tethers
6. Shard reeling
7. Mining
8. HUD readouts, touch button, sound, radio pools, controls hint
9. `mechanics.probe.mjs`, the full verification bar, then review

## 9. Shipping

One PR from `feat/flight-feel`, pushed and merged as **fitzfitz**. A merge to `main` deploys to GitHub Pages and Cloudflare. The red Cloudflare Workers Builds check on the PR branch is the known configuration issue and does not block.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Gravity tuning feels wrong in the hand despite passing simulations | Constants live in one module; e2e probe plus a manual fly-through before the PR |
| Beam cone material does not share the plume's program | The probe catches it; fallback is tether lines only |
| Mining pebble state complicates `BeltRing` | Pure `mining.ts` owns the state; `BeltRing` only reads arrays |
| The new probe flakes under full-suite load | Use `pollUntil`, never fixed sleeps |
