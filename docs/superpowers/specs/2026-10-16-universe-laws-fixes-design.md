# Universe Laws: Fixes Design

**Date:** 2026-10-16 · **Laws catalogue:** `docs/UNIVERSE-RULES.md`

## Intent

The owner's words: someone who knows astronomy and physics should "feel like
they are in a universe in their understanding". The catalogue lists 40 laws.
The scene now follows most of them, but 15 still break, and the rest of this
document fixes them. When this work is done, every law is either followed or
is one of the two disclosed orrery conventions (enlarged sizes, fast clock,
principle P3).

**Already done on `feat/universe-rules`** (commit `1974354`): one Kepler law
for everything around the sun (L7), prograde orbits and spins (L9), tidally
locked moons (L11), captured retrograde moons (L12).

## Goals

- Every law in the catalogue ends as **Follows** or **Convention**.
- The game stays easy to fly and easy to read. A recruiter in a hurry must
  still reach every dossier in under a minute.
- Every fix is lawful *inside* the world (P4). We never paper over a law; we
  supply the real mechanism that would produce what the game needs.

## Non-goals

- True scale or a uniform true clock (P3 conventions stay; F13 discloses them).
- Relativity, n-body chaos, precession: none is visible at these sizes.
- Simulated physics for the ship's own systems (fuel chemistry, hull heat).

## Anti-goals: failure even if it technically works

- A ship that is hard to stop or aim. Realism must not cost the
  recruiter path.
- Murky, unreadable planets (a risk with F3 and F4).
- Frame stalls: new shader programs compiled during play, or losing frame
  budget on mid-range laptops.
- Scenery you can see but never reach (`no-unreachable-scenery`).

## Constraints (unchanged by this work)

- `docs/PERF-BUDGETS.md`: deep-space program ceiling, `LIGHT_BUDGET` 4 lights,
  triangle and draw-call ceilings (modal-open budget is tight), and startup
  compile time.
- Shader warm-up: anything new must compile at load (`ShaderWarmup`) and add
  no program during the tour (`tests/e2e/programs.probe.mjs`).
- Reduced motion freezes ambient time; the low-perf tier halves counts.
- Every feature PR adds a changelog entry (`src/data/changelog.ts`).
- Assets come from seeded scripts (`assets-src/`), never by hand.

## The fixes

Each fix lists the laws it settles, the approach, and the calls I made.
"My call" means the owner has not yet weighed in.

### F1. Flight assist is visible thrust (L1, L3)

The ship's drag becomes what a real ship would need to slow down: a
flight-assist computer firing retro thrusters.
- Physics: velocity persists by itself (Newton's first law). Flight assist
  applies a braking thrust whenever the pilot gives no input, and that thrust
  produces today's slowing curve, so the feel stays the same.
- Visible: reaction-control puffs and a short retro plume at the nose while
  flight assist brakes, with a hull-borne thruster sound (L30).
- HUD: an `FA` indicator. **My call:** a toggle (key `Z` / pad stick-click)
  for "flight assist off", where the ship coasts Newtonian. Default is on,
  and the state persists like other settings.
- Gravity (F2) acts on the ship's real momentum; flight assist damps only
  the velocity the pilot added, so a slingshot is not braked away.

### F2. Newtonian gravity for the ship (L4, L8)

Replace the gravity layer's three departures (separate decaying momentum, the
lenient climb-out, the fling that rotates momentum without a force) with
plain gravity: acceleration GM/r² from each body, integrated into the
ship's velocity.
- Strengths come from the same masses as the orbits: `GM_SUN` for the sun,
  the planets' mass for the wells. **My call:** a planet's flight GM is
  `GM_PLANET` scaled by the inset convention (P3), tuned so a slingshot still
  bends a fly-by visibly. The tuning targets in `tests/gravityWell.test.ts` are
  rewritten against Newtonian integration.
- A real slingshot gains speed only relative to the sun, from the planet's
  own motion. With F1 handling braking, the old fling is no longer needed.
- Station-keeping near bodies becomes flight assist thrusting against
  gravity (visible, per F1).
- Risk: the earlier tuning run found the damped model erased plain gravity
  (0.3° of bend). F1's split, where assist damps only pilot input, is what
  makes plain gravity visible. Prove it with a tuning run before the rest.

### F3. Inverse-square light with exposure (L19, L22)

- The sun light gets `decay={2}` with intensity re-anchored so Ruangrapi
  (r 115) is lit exactly as today. Portfolio then gets 59% of that light and
  Fuxx 39%, as physics demands. Decay is a uniform, so no new program.
- Readability comes from real camera behaviour: auto-exposure adapts to the
  ship's distance from the sun, the way an eye or camera does. It makes up
  only part of the falloff (eased over about 1.5 s, clamped), so every planet
  stays readable on approach while the outer system still looks dimmer.
- Emissive light (city lights, volcanic fissures, the portal) is unaffected,
  since it is the body's own light (L33).

### F4. Shadows and eclipses (L20)

Analytic sphere shadows rather than shadow maps: every lit body is a sphere,
so a fragment shader can test whether the sun is blocked by up to four
occluding spheres (planet, moons, sun-side neighbour) passed as uniforms.
- Eclipses: a moon's shadow crosses its planet; a planet shadows its moons
  and the ship; the ship goes dark in a planet's umbra. Soft penumbra comes
  from the sun's angular size.
- Implemented as one shared shader chunk injected into the lit materials, so
  the variants compile at load, not during play.
- **My call:** the occluder list is per body and updated each frame with no
  allocation.
- Perf check: added fragment cost must stay within the frame budget on the
  low-perf tier. The low tier may drop moon shadows and keep planet shadows.

### F5. God rays become camera glare (L21, L22)

Remove the volumetric god rays: vacuum has no medium to show beams. Replace
them with lawful lens effects tied to the sun's visibility (the existing
`sunOcclusion` maths):
- a glare bloom and a faint diffraction spike pattern, as a real lens shows,
- veiling glare that lifts contrast when looking near the sun.

The god-ray pass and its transparent-sun workaround (`godRays.ts`) go away,
which removes a post-processing pass; re-baseline programs and passes.

### F6. Steady, fixed stars (L23, L24)

Remove the twinkle from the near star layer and the slow rotation of all star
shells. Keep them following the ship (no parallax, correct). The brightness
and colour distribution already follows L25.

### F7. Vacuum engine plumes (L31)

Rewrite the plume shader for vacuum: no shock diamonds; the plume widens with
distance from the nozzle (a cone of about 25–40° half-angle) and fades fast;
the brightest part sits at the nozzle. Throttle drives length and brightness
as today. Plume colours (logbook unlocks) are unchanged. Uniform changes
only, so no new programs.

### F8. Landmarks in real orbits or at Lagrange points (L15, L16)

Nothing that is not powered may hover.

| Landmark | Lawful home | Notes |
|---|---|---|
| Career station | L4 of Ruangrapi (60° ahead on its orbit) | A Trojan: stable, co-orbits, never meets the planet. |
| Shipyard | L5 of Portfolio (60° behind) | Same. |
| Contact portal | L4 of Fuxx | It stays the highest-priority destination; it moves slowly with Fuxx. |
| Dormant gate | Its own inclined heliocentric orbit outside Fuxx, Kepler speed | An old derelict; its slow drift is part of the mystery. |
| Hero asteroids, shards, fuel crystals, anomalies | Heliocentric circular orbits at their current radius, Kepler speed | `sunOmega(r)`. |
| Career buoys, visitor beacons | Station-keeping beacons with a visible thruster blink | Powered (L3), so they may hold position. |

- Destinations gain live positions like planets (`bodies`): the
  `Destination.pos` field becomes an orbit or Lagrange description resolved
  every frame. Jumps, docking, radar, waypoint and scannables already handle
  moving planets, so they follow.
- L4 and L5 sit on the planet's orbit radius, so clearance tests change from
  fixed points to "co-orbiting at ±60°": `tests/planetClearance.test.ts` is
  rewritten for moving landmarks.
- The career buoy trail from spawn stays put (powered beacons).
- Risk: the biggest change in this list. It touches the destination table,
  the docking geometry and several probes. Do it after F1–F7.

### F9. Hyperbolic visitor comet (L17)

The world-event comet flies a Kepler hyperbola (e ≈ 1.2–2, like 'Oumuamua)
around the sun, solved with the hyperbolic Kepler equation, with perihelion
and timing chosen so the pass still crosses near the target planet in the
event window. The event director's route checks use the hyperbola.

### F10. Powered movers show their thrust (L3)

- Freighters: a short burn from manoeuvring thrusters whenever their route
  turns or their speed wobbles; a main-engine burn when accelerating.
- Jellyfish: it moves by jet propulsion. Each bell contraction pushes out a
  faint gas puff behind it, and its speed changes only on a pulse.

### F11. A lawful boundary instead of wrap-around (L18)

Space no longer wraps. At the edge of the system (today's ±250 box, kept as a
sphere of about 250), the flight computer warns, then turns the ship back
with visible thrust (F1). The nebula haze stays as the visual cue.
- Every `wrapDelta` / `toroidal*` use (13 files) becomes plain distance.
  Spawn, radar and the race course must not depend on wrapping.
- **My call:** auto-return engages only with flight assist on. With it off,
  the pilot can drift out and is told how far they are from the star.

### F12. Sizes that obey stellar and planetary physics (L35, L36)

Under P3 every body is enlarged, but their order must stay real.
- **Sun:** the core outsizes the largest planet. **My call:** core radius 24
  (from 8), corona scaled to keep its look, colour unchanged (L25).
- **Planets by type:** Jupiter-type Portfolio is the largest, Earth-type
  Ruangrapi next, Mars-type Fuxx smallest. **My call:** radii 20 / 15 / 11.
- `PLANET_SIZE` becomes per planet: lock, zone, orbit and well radii, moons,
  rings and clearance already scale from size. `GM_PLANET` becomes per
  planet in proportion to a plausible mass for its type (L7, L13).
- Clearance: the sun at 24 must clear the belt (r 40) and its corona must not
  swallow it. Check sun occlusion and lens glare (F5).
- This visibly changes the sun and planets the owner likes. It ships behind
  a screenshot review.

### F13. Disclose the conventions in the game (P3; L13, L34, L40)

What any good planetarium does:
- A small "not to scale" note: sizes ×290, one second ≈ 21 hours, moon
  systems shown as insets. It sits in the logbook or patch notes and on the
  scan of the sun.
- Real-unit readouts: speed in km/s (cruise 187, warp 675), distance from the
  star in AU, and scans that give real-unit periods.
- The catalogue's Units table is the single source; a test checks the
  readouts against it.

## Order

Each phase is its own PR with its own changelog entry, smallest risk first.

1. **Looks right** (no gameplay change): F6 stars, F7 plumes, F5 glare, F13
   disclosure and readouts.
2. **Light:** F3 inverse-square with exposure, then F4 shadows.
3. **Flight:** F1 flight assist, then F2 Newtonian gravity, after one
   tuning run.
4. **World:** F9 hyperbolic visitor, F10 visible thrust, F12 sizes, F8
   orbits and Lagrange points, F11 boundary.

PR #29 (`feat/universe-rules`) carries the catalogue, this design and the
orbit work already done. It lands before phase 1.

## Verification for every phase

- `tests/universeRules.test.ts` grows with each fix: decay and exposure
  (F3), no fling (F2), Lagrange and orbit positions (F8), hyperbolic
  eccentricity (F9), the size order (F12), readouts against the units table
  (F13).
- The full e2e suite, including program, triangle and draw-call ceilings,
  re-baselined only deliberately and documented in `docs/PERF-BUDGETS.md`.
- A real-browser screenshot pass of every visible change (Playwright MCP),
  reviewed by the owner before merge for F3, F4 and F12.
- Each law's status in `docs/UNIVERSE-RULES.md` flips to Follows in the same
  PR that fixes it.

## Left to the builder

Exact tuning (exposure curve, plume angle, assist braking curve, Newtonian
well GM), shader structure for F4, the boundary radius in F11, and the
puff and burn visuals in F1 and F10, within the constraints above.
