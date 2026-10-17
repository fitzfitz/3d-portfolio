# A Bigger Universe With a Real Edge — Design

**Date:** 2026-10-17 · **Sub-project A** of the new-worlds work
**Then:** B (sizes by type, F12) and C (five new worlds, charting, a visible title)
**Laws:** `docs/UNIVERSE-RULES.md` L18 (space has no edge). This brings F11 of
`docs/superpowers/specs/2026-10-16-universe-laws-fixes-design.md` forward and
revises its radius.

## Intent

The owner wants more planets: five "just planets" that visitors discover
(sub-project C). They do not fit today: space wraps around at ±250. Any body
past 250 is folded to the other side of the map, and the three project
planets already sit at 115, 150 and 185, spaced closer than real systems
allow. This project makes room. Space grows to about 400 units from the
sun, and the wrap-around is replaced by a lawful edge: the ship's flight
computer turns the pilot back.

Long term, the owner wants returning visitors with an identity, competition,
gains and losses, and personal realms. None of that is in this project, but
nothing here should block it.

## Goals

- No wrap-around anywhere: distances, radar, live sky, pickups and gravity
  all use plain 3D positions.
- A spherical system of radius 400 around the sun, with room for orbits out
  to about 380.
- A lawful edge. At about 360 the haze thickens and the radio warns. Past
  400 the flight computer pushes the ship back inward. No wall, no wrap, no
  teleport.
- The recruiter path is unchanged: jumps, the spawn, every landmark and every
  dossier stay where they are.
- L18 flips to Follows, with any remaining exception named.

## Non-goals

- New planets (C), sizes by type (B), flight-assist thrusters (F1), Newtonian
  ship gravity (F2), moving landmarks (F8).
- Accounts, competition and realms.

## Anti-goals

- A pilot stuck, lost or fighting the edge.
- Pilots silently vanishing from the live sky because the server still
  enforces the old ±250 box (see "Deploy order").
- Frame stalls or a perf regression. No new shader program during play.

## Decisions

**Owner (2026-10-17):** grow the system rather than squeeze planets in. Build
A, then B, then C, each shipped before the next.

**My calls:**

1. **Edge radius `SYSTEM_RADIUS = 400`**, a sphere around the sun that
   replaces `COSMIC_BOUNDS` everywhere. The haze starts at 360 and is full at
   400; the radio warning (today's `HazeLineGate`) moves to 360.
2. **Turn-back (the return burn).**
   - Beyond 400 the flight computer cuts warp.
   - It decelerates the ship's outward velocity at up to 25 u/s², then pushes
     it gently back inward. From full warp (39 u/s) that stops the ship within
     about 30 units (39²/(2·25) ≈ 30.4), so the overshoot stays under 440.
   - The burn adds to the pilot's input rather than overriding it. Steering
     and inward thrust still work; holding thrust outward cannot carry the
     ship past the cap.
   - Target for tests: back inside 400 within 6 s of crossing it, at warp or
     cruise, with a maximum overshoot under 440. "Never thrown": the burn
     never adds speed beyond cruise.
   - A radio line says why ("FLIGHT COMPUTER // RETURN BURN — EDGE OF THE
     SYSTEM"), with a cooldown so it doesn't repeat on every bounce.
   - It is thrust, not a wall, so it follows the laws. The visible thrusters
     for it arrive with F1 (L3 stays "Breaks → F1").
   - It is unconditional for now. Flight assist (F1) doesn't exist yet, so the
     earlier F11 idea of letting a pilot with assist off drift out is
     deferred to F1. F11 is marked built except for that clause.
   - The boundary applies only to the ship. Comets and world events keep
     their own planned paths inside the system. The sun sits at the origin,
     so the sphere is centred on (0, 0, 0).
3. **The altitude warning** (`|y| > 180`) is removed. It existed for the
   cube's Y-wrap.
4. **Validation bounds** for live-sky poses (`inWorld`) and beacon drops
   (`inBounds`) become a sphere of radius `SYSTEM_RADIUS + 40`, which covers
   the worst overshoot under item 2.
   - Beacons already stored on the server can sit in the old cube's corners,
     up to 433 from the sun. The client does not draw or scan any beacon
     beyond `SYSTEM_RADIUS` (no unreachable scenery), and nothing is migrated
     on the server.
   - Every landmark placed today is inside 230 (the farthest is the dormant
     gate at about 222), so nothing else lands outside the sphere.
5. **Fuel crystals** stay at 40 (the triangle budget has no room for more,
   and the tank now refills on its own). They spawn in the sphere instead of
   the cube, keeping today's keep-outs. Density falls to roughly a quarter;
   that is intended.
6. **Plasma anomalies** clamp to the sphere.
7. **Radar `RANGE` 160 → 220**, so a larger share of the bigger system shows
   as blips rather than rim arrows. Anything farther stays clamped to the rim
   as an arrow, as today.
8. **Exposure is unchanged** (`EXPOSURE_MAX` 2.5). Nothing new is lit out
   there in A. C decides how the outer worlds read: ice giants are naturally
   bright (albedo about 0.3–0.5), so a raised clamp may not be needed.
9. **HUD `SECTOR.RANGE`** shows the system's diameter in AU, 6.96 AU, from
   `SYSTEM_RADIUS`.
10. **World events** keep their own distances (`COMET_ENTRY_DIST`,
    `CONVOY_HIDE_DIST`). They only shared the number 250.

## Constraints

- Every existing clearance test still passes. Landmarks, the spawn, the
  trail, the ring course and the gate do not move.
- The perf ceilings in `tests/e2e/transition.probe.mjs`: programs tour
  `added=0`, frame loops allocate nothing.
- Reduced motion and the low-perf tier keep working. The return burn under
  reduced motion is still applied, but with no camera shake.
- One changelog entry. The PR number is whatever is free when it ships (the
  fuel PR, #31, may land first).
- `docs/UNIVERSE-RULES.md` L18 flips in the same PR, and the F11 section of
  the fixes design is marked as built (radius 400).

## Deploy order (owner action)

The live-sky room and the beacon service run in the `beacon-api` Cloudflare
Worker. They reuse `src/utils/liveSkyProtocol.ts` (`inWorld`) and
`src/utils/beacons.ts` (`inBounds`), and they reject anything outside the
old ±250 box. **The Worker must be redeployed with the new bounds before the
site change is merged.** Otherwise a pilot beyond 250 silently disappears for
everyone else, and beacon drops out there fail.

The Worker's source is in this repo (`beacon-api/`), sharing those two files.
The PR states the redeploy as a pre-merge step, and the owner runs it (or
tells me to).

During the gap, a visitor with an old cached page still wraps at 250, so
until they reload they can see a new pilot's ghost in the wrong place. That
is brief and acceptable.

## Scope of change (from the survey)

The survey counted about 20 source files, 12 tests and 4 probes:
- **Core:** `constants.ts`, `toroidal.ts` (removed or reduced to plain
  distance), `edgeHaze.ts`.
- **Flight:** `Spaceship.tsx` (wrap removal, return burn, altitude warning).
- **Distance users:** `SpacePlanets.tsx`, `gravityWell.ts`, `scannables.ts`,
  `logbook.ts`, `FuelCrystals.tsx`, `DataShards.tsx`, `tractorBeam.ts`.
- **HUD and live sky:** `RadarMap.tsx`, `Ghosts.tsx`, `liveSky.ts`,
  `liveSkyProtocol.ts`, `beacons.ts`, `crystalField.ts`,
  `PlasmaAnomalies.tsx`, `HUDOverlay.tsx`, `EdgeHaze.tsx`, chatter lines.
- **Probes:** `flight.probe.mjs` (the wrap-seam test becomes an edge-return
  test), `mechanics.probe.mjs` (the edge test is rewritten), and the fuel
  probe's torus-specific crystal search.

## Verification

- **Unit:**
  - plain-distance helpers;
  - return burn: the ship comes back from 400 + overshoot within the bound at
    warp and at cruise, and is never thrown;
  - sphere spawn of crystals;
  - validation radius;
  - HUD range.
- **e2e:**
  - fly out past 400 at warp and cruise; the ship returns, the radio line
    plays, and the live-sky pose stays valid;
  - no seam anywhere;
  - the full suite stays green.
- **Screenshots:** the edge haze at 360 and 400, and the radar at the
  system's middle.

## Left to the builder

The exact return-burn curve within the stated bounds, the haze ramp shape,
how to restructure `toroidal.ts`, and the probe rewrites.
