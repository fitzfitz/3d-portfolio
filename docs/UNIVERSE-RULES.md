# Universe Laws

The test for this universe: someone who really knows astronomy and physics
flies through it and feels they are in a universe that matches their
understanding. This page lists every law that a visitor could see being kept
or broken, how the scene stands on each one, and where it is enforced.

- **Follows**: the scene obeys the law.
- **Convention**: a presentation choice every orrery and planetarium makes,
  disclosed to the visitor (P3 below). Nothing else is allowed to bend a law.
- **Breaks → F*n***: not yet lawful; F*n* is its fix in
  `docs/superpowers/specs/2026-10-16-universe-laws-fixes-design.md`.

`tests/universeRules.test.ts` enforces the laws marked *(tested)*.

## Principles

**P1. The laws are exact.** What moves, which way, how fast for its orbit,
how light falls, what can be seen and heard in vacuum: all follow physics.

**P2. Our star system, our parameters.** This is not the Solar System. We
choose the star, the planets, their masses and distances, the way nature
chose TRAPPIST-1's. Choices must agree with each other.

**P3. Two disclosed conventions, the ones every orrery uses:**
- **Sizes are enlarged** against distances, or the planets would be
  invisible specks. A planet is drawn about 290× its true size.
- **Time runs fast**: one game second is about 21 hours, so a year takes
  minutes. Each planet's moon system is a magnified inset that runs on its own
  slower time-lapse; at the system clock a real moon would circle several
  times a second.

The game tells the visitor both (F13). Nothing else may bend a law.

**P4. Anything the game needs beyond that is done lawfully in the world**:
thrust (flight assist, station-keeping), stable points (Lagrange points), real
camera optics (bloom, glare, exposure), sound carried through the hull.

### Units

The system is pinned to real units by two anchors: Ruangrapi orbits at
1 AU with a one-year period.

| Quantity | Scene | Real |
|---|---|---|
| 1 unit of distance | 1 | 1.30 million km (1 AU / 115) |
| 1 game second | 1 s | 20.9 hours (1 year / 420) |
| `GM_SUN` | 340.4 u³/s² | 1.327 × 10²⁰ m³/s², the Sun's own value |
| Ruangrapi's orbital speed | 1.72 u/s | 29.8 km/s, the same as Earth's |
| Ship cruise | 10.8 u/s | 187 km/s, close to Parker Solar Probe's 192 km/s record |
| Ship warp | 39 u/s | 675 km/s, 0.23% of light speed |

The code source of these numbers is `src/utils/realUnits.ts`; `tests/realUnits.test.ts` pins them.

## A. Motion and gravity

| # | Law | Status |
|---|---|---|
| L1 | **Newton's first law.** A moving body keeps its velocity until a force acts. | **Breaks → F1.** The ship slows by itself (`SPACE_DRAG`) with no visible cause. |
| L2 | **Newton's second law.** F = ma: thrust changes velocity in proportion. | Follows. |
| L3 | **Newton's third law.** Every push has an equal push back, so a change of motion needs visible thrust. | **Breaks → F1, F10.** The ship brakes, and freighters and the jellyfish turn, with no visible thrust. |
| L4 | **Universal gravitation.** Every mass pulls every other with F = GMm/r². | **Breaks → F2.** The flight gravity wells use 1/r², but with their own strengths, a lenient climb-out and a "fling" that turns momentum with no force. The sun's well keeps G = 1000 while its softening radius follows its 25.5 collider, so its grazing pull is now the gentlest in the system, by design: scaling it like the planets would make every pull across the belt ~9× stronger. |
| L5 | **Kepler's first law.** Orbits are ellipses with the central body at a focus. | Follows *(tested)*: comets solve Kepler's equation; planets are circles (e = 0). |
| L6 | **Kepler's second law.** A body moves fastest nearest its star (equal areas in equal times). | Follows *(tested)*. |
| L7 | **Kepler's third law.** T² = 4π²a³/GM, with one GM per central body. | Follows *(tested)*. One `GM_SUN` sets planets, belt, halo and comets through `sunOmega` / `keplerPeriod`; `gmOf` (`GM_RUANGRAPI` × planet mass) sets each planet's moons. No orbit around the sun may have a hand-picked speed. |
| L8 | **Conservation of energy and angular momentum.** | Follows for orbits. **Breaks → F2** for the ship's gravity fling. |
| L9 | **One direction.** Planets formed in one spinning disk, so they orbit and spin the same way (only Venus and Uranus spin backwards). | Follows *(tested)*: every orbit, planet and world spin and regular moon is prograde. A `rotation.y` rate multiplies by `PROGRADE`; a world spins about its own tilted axis. One named exception, as in the real system: the tilted ice giant's axis lies 97.8° from its orbit normal, Uranus's tilt, so it rolls around its star on its side and its spin counts as backwards. Small bodies tumble freely. |
| L10 | **Near-coplanar orbits** are typical but not required: a system disturbed by planet–planet scattering keeps tilted orbits (Upsilon Andromedae c and d are 30° apart). | Follows: ours is such a system (orbits at 20°, −40°, 60°; halo at 75°). |
| L11 | **Tidal locking.** Large moons spin once per orbit and show one face. | Follows *(tested)*: moon meshes have no spin of their own. |
| L12 | **Captured moons may orbit backwards** (Neptune's Triton). | Follows *(tested)*: the two ice moons are captured and retrograde; the other three are regular. |
| L13 | **Mass hierarchy and the Hill sphere.** A planet is far lighter than its star, and moons stay bound only close to it. | Convention (P3). At drawn sizes the moons sit far outside any real Hill sphere, and the scene's numbers make a planet out-pull the sun: in scene units Portfolio's GM is ~12× `GM_SUN`, Ruangrapi's ~4× and Fuxx's ~1.2× (`gmOf` / `GM_SUN` = 11.97, 3.99, 1.20). Moon systems are magnified insets with their own clock. Convention, disclosed in the logbook; the HUD and planet scans read in real units (F13). |
| L14 | **Roche limit.** Inside about 2.44 planet radii, tides tear a fluid body apart: rings form inside it, moons outside. | Follows: Ruangrapi's ring spans 1.15–1.6 R. The moons at 1.38–2.1 R are inside the fluid limit, which rigid moons survive (rigid limit about 1.3–1.4 R; Jupiter's Metis orbits at 1.8 R). The ringed giant's rings have Saturn's profile in equatorial R (C 1.24–1.53, B 1.53–1.95, Cassini division 1.95–2.03, A 2.03–2.27, Encke gap ~2.21). For ice particles (0.92 g/cm³) around a planet of Saturn's density (0.69) the fluid limit is 2.44 · (0.69 / 0.92)^⅓ ≈ 2.2 R (`fluidRocheLimit`), and the A ring's outer edge sits at it, as the real A ring's does; no margin is claimed. |
| L15 | **Lagrange points.** L4 and L5, 60° ahead of and behind a planet on its orbit, are stable; Trojans live there. | Not used yet. F8 parks stations there. |
| L16 | **Nothing unpowered hovers.** A body that is not orbiting falls toward the star; holding still costs constant thrust. | **Breaks → F8.** Stations, the shipyard, the gate, the portal, buoys, beacons, shards, fuel crystals and the hero asteroids hold still. |
| L17 | **Escape velocity.** A visitor from outside the system flies a hyperbola that bends around the star ('Oumuamua: e ≈ 1.2). | **Breaks → F9.** The world-event comet flies a straight line. |
| L18 | **Space has no edge.** | Follows: the system is a 480-unit sphere with a real edge (`SYSTEM_RADIUS`, moved out from 400 for the outer worlds). A nebula haze thickens from 440 (`HAZE_START`, derived as `SYSTEM_RADIUS` − 40) to 480, and past 480 the flight computer cuts warp and flies a return burn that brings the ship back; nothing wraps. The worst overshoot (~19) stays inside the beacon Worker's fixed 520 `VALIDATION_RADIUS`. The burn's visible thrusters come with F1. |

## B. Light and optics

| # | Law | Status |
|---|---|---|
| L19 | **Inverse-square law.** Light weakens with distance squared (Mars gets 43% of Earth's sunlight). | Follows *(tested)*: the sun light has `decay={2}`, 2.1 at 1 AU (`sunLight.ts`). The camera's exposure, clamp((d / AU)^1.5, 0.15, (SYSTEM_RADIUS / AU)^1.5 ≈ 8.53) eased with a 1.5 s half-life, keeps the outer system readable: net brightness falls as (AU / d)^0.5 with no clamp inside the edge (0.79 of Ruangrapi's brightness at Fuxx for equal albedo with the camera at Fuxx's distance, since exposure is metered at the camera, 0.62 at 300, 0.53 at 402 and 0.49 at the edge, 480; Fuxx's own albedo is lifted 3x on its material, `FUXX_ALBEDO_LIFT`, because its baked texture was ~1.4% against a C-type ~4%), as a lens would (L22). The sun's core, corona and glare, the instrument overlays (orbit rings, zone circles, guide lines) and the ring-course gates are compensated by 1 / exposure, so they look the same at every exposure. Lit matter is not: Ruangrapi's ring follows exposure, and the atmosphere rims (L27) scale with the sunlight at their orbit; in low-perf, where no post pass exposes custom shaders, both multiply by the exposure themselves (`litExposure`). The fill is sunlight too: the ambient light (0.15 at full) and `scene.environmentIntensity` scale with (AU / d)² at the camera, clamped to at most 1 (`fillScale`), so the fill is a quarter at 2 AU and ~6% at the edge. That darkens night sides in the outer system too: at Fuxx the fill is (115 / 185)² ≈ 0.39 of its old constant. The five worlds' maps are honest to their Bond albedos on the scene's scale, with no lift like Fuxx's, so the airless rock (0.068) and the dwarf (0.034) read dark at true brightness. |
| L20 | **Shadows and eclipses.** A body in another's shadow goes dark; moons cast shadows on planets. | Follows *(tested)* (F4): analytic sphere-against-disc shadows, no shadow maps (`sunShadow.ts`). Shadowed: the three planet surfaces and Ruangrapi's cloud layer per fragment, against the other planets and all five moons (a moon's shadow crosses its planet's day side with a soft penumbra); Ruangrapi's ring against its planet, so the arc in the planet's umbra goes dark (`guideLine.ts`); since the sun grew to radius 24 (L35), three moons look smaller than its disc from their planets' surfaces, so their eclipses are annular, not black: at the deepest point the ground keeps 60% of its sunlight under Ruangrapi's moon, 71% under Portfolio's ice moon and 83% under Fuxx's ice moon, as under any moon smaller than the star's disc; Portfolio's rock moon and Fuxx's volcanic moon still eclipse totally; the moons against the planets and the player ship against planets and moons, one CPU `sunVisibility` factor each. Only the sun's light is scaled; ambient and emissive light stay, so an umbra keeps what a night side keeps. Not shadowed, all minor: moon on moon (only Portfolio's two moons can line up with the sun, and rarely), moons on the ring, the belt, halo and comet rocks, the career station and shipyard, and the atmosphere rims. The ghost ships are unlit holograms, so there is nothing to shadow. The worlds' surfaces are shadowed per fragment like the planets'. The occluder slots are fixed, 16 of them: the planets, the moons, then four worlds. The outermost world, the blue ice giant, needs no slot, since a body only shadows what lies farther from the sun; it still shadows the ship and the sun's glare on the CPU. The ringed giant's rings shadow their planet: the sunlight through the ring plane is exp(−τ/μ₀) at the radius it crosses, with no viewer term, so the shadow does not move with the camera; the planet's shadow darkens the rings. **Disclosed P3 artifact:** the rings' shadow is blurred by the drawn sun's angular size, ~45× the real Sun's from that distance, so the Cassini division's shadow is soft where the real one is sharp. The rings are not shadowed by any body but their planet. |
| L21 | **Light is invisible in flight.** Beams show only where dust or air scatters them, and vacuum has none. | Follows. The god-ray pass is gone; nothing draws beams through empty space. The tractor beam is drawn as a glowing field (L33), not as scattered light. |
| L22 | **Camera optics are real.** Bloom, glare, lens flare, diffraction and exposure are effects of the lens and eye, so they are lawful. | Follows: bloom, and the sun's glare, diffraction spikes and flare ghosts are the lens. F3 and F5 lean on this. |
| L23 | **Stars don't twinkle in space.** Twinkling comes from Earth's air; Hubble sees steady points. | Follows. The star shaders have no time input; the stars hold steady. |
| L24 | **Fixed stars.** At these distances stars show no parallax and do not move. | Follows *(tested)*: the three star shells ride with the ship and never rotate; they show no parallax. |
| L25 | **Wien's law.** Colour shows temperature: hot is blue-white, cool is orange-red. | Follows: the sun is about 5,800 K white (`#fff4e0`); background stars are mostly white with some blue-white and orange. |
| L26 | **Stefan–Boltzmann law.** Luminosity ∝ R²T⁴. | Follows: no conflict at our sizes (P3). F12 must keep the sun's colour and brightness consistent if its size changes. |
| L27 | **Rayleigh scattering.** Thin air glows blue at the limb. | Follows: Ruangrapi's rim, bright on the day side. |
| L28 | **Limb darkening.** A gas giant dims toward its edge. | Follows: Portfolio. |
| L29 | **One light source.** Every lit body has a day side, a night side and a terminator facing the star. | Follows, with one known exception: the studio environment's orange Lightformer (`GlobalCanvas.tsx`) adds a faint red specular reflection on night sides, constant and lifted by exposure. See docs/FOLLOW-UPS.md. |
| L41 | **Meteors need an atmosphere.** Shooting-star streaks are air glowing around a falling grain; in vacuum a grain is invisible unless sunlit. | **Breaks → F14.** `ShootingStars.tsx` draws meteor streaks. |

## C. Matter, heat and sound

| # | Law | Status |
|---|---|---|
| L30 | **Sound needs a medium.** Vacuum carries none. | Follows. Every sound is heard inside the ship: engine hum through the hull, contact on impact, instruments, radio. Nothing is heard from outside; there is no positional audio. The slingshot "whoosh" is an instrument tone. Keep it that way. |
| L31 | **Vacuum plumes spread.** With no air pressure an exhaust plume fans out wide and fades; shock diamonds need an atmosphere. | Follows: the plume fans out to a cone of about 30° half-angle at every throttle (the shader widens it with distance, so the angle holds as it lengthens) and thins and fades toward the wide end; no shock diamonds in the shader. Shock diamonds in air (none yet) would be a separate, air-only effect. |
| L32 | **Comets.** Ice sublimates near the star; radiation pressure pushes dust into a curved tail; the solar wind pushes gas into a straight tail away from the star. | Follows (realistic-comet spec). |
| L33 | **Only hot or excited matter glows.** | Follows: the sun, volcanic fissures, night-side city lights, the C2 coma, aurora-like rims. |

## D. Scale and cosmos

| # | Law | Status |
|---|---|---|
| L34 | **Real sizes and distances.** Planets are specks across vast gaps. | Convention, disclosed in the logbook; the HUD and planet scans read in real units (F13). |
| L35 | **Stars outsize their planets.** The smallest star is about Jupiter's size; the Sun is 10× Jupiter. | **Follows (P3).** The solid sun (core radius 24) outsizes every planet and world (16 at most), though not 10× Jupiter: the order is real, the ratio is compressed. Corona resized to 72 across so its halo stays clear of the belt (r 40). |
| L36 | **Planet size follows type.** Gas giants are many times larger than rocky worlds (Jupiter 11× Earth, Mars half of Earth). | **Follows (P3).** Sizes follow type, in the right order but compressed: gas giant Portfolio 16 > ringed giant 15 > Uranus-type 13.5 > Neptune-type 13 > Earth-type Ruangrapi 12 > Mars-type Fuxx 8 > Mercury-type 5.7 (Mars-type × the real Mercury/Mars ratio) > Ceres-type 3.5 (`PLANET_PROPS`, with masses 3 / 1 / 0.3, and `WORLDS`; `tests/universeRules.test.ts` pins the order). The world scans say "SIZE COMPRESSED". The ringed giant is drawn 10% oblate; Portfolio is round, though a real Jupiter-type is 6.5% flattened (docs/FOLLOW-UPS.md). Moons orbit on their own planet's GM. Two different "weights", on purpose: moons orbit by mass (3 / 1 / 0.3, through `gmOf`), while flight gravity wells scale by size² (~1.78 / 1 / 0.44 against Ruangrapi, `planetWell`), so a well's pull at the same multiple of a planet's size is the same for every planet, and the worlds' wells follow the same rule (L4, F2). Do not "fix" one to match the other. |
| L42 | **A world's type fits its orbit.** Water-ice rings sublimate in strong sunlight, a runaway greenhouse needs plenty of it, nitrogen ice needs deep cold. | Follows *(tested)*: `src/data/worldTypes.ts` gives each type its conditions as functions of the orbit, from the flux (AU / r)² S⊕ and T_eq = 278.6 K · (1 − A)^¼ / √(r / AU): water-ice rings T_eq ≤ ~170 K, a Ceres-like dwarf's buried ice ≤ ~180 K, a Venus-type ≥ ~1.1 S⊕, a nitrogen-ice dwarf ≤ ~60 K; airless rocks and ice giants anywhere. `tests/worldTypes.test.ts` fails if a world sits where its type cannot exist. Scan numbers are computed from the orbit (`worldReports.ts`), and the namesake's are labelled as the real planet's. |
| L37 | **Asteroid belts are mostly empty.** | Follows. In our units, rocks sit about 5 units (6.6 million km) apart, against roughly 0.2–0.7 units for real asteroids larger than 1 km. Each rock is drawn enlarged (P3). |
| L38 | **Hubble–Lemaître law.** Galaxies recede, but too slowly to see in a lifetime. | Follows: the galaxies are static. |
| L39 | **Speed of light.** Nothing outruns light. | Follows: warp is 0.23% of light speed (Units). |
| L40 | **One clock.** Everything in a system runs on the same time. | Follows, apart from the moon insets (P3), which are a convention, disclosed in the logbook; the HUD and planet scans read in real units (F13). |

## Adding something

- **It orbits the sun:** take its speed from `sunOmega(r)` or `keplerPeriod(a, GM_SUN)`.
- **It orbits a planet:** add a row to `MOONS` (`src/data/moons.ts`).
- **It is a new world:** give it a type in `src/data/worldTypes.ts` that can exist at its orbit (L42), and keep `tests/worldClearance.test.ts` green.
- **It spins or orbits through `rotation.y`:** multiply by `PROGRADE`.
- **It holds a position:** put it in an orbit or at a Lagrange point, or show the thrust that holds it (L16).
- **It changes speed or direction:** show the push (L3).
- **It makes a sound:** the sound must be heard inside the ship (L30).
- **It glows or casts light:** it must be hot or excited (L33), and its light falls off with distance (L19).
- **Always:** keep `tests/universeRules.test.ts` green, and extend it when the new thing has its own table.

## Sources

- NASA, [Orbits and Kepler's Laws](https://science.nasa.gov/resource/orbits-and-keplers-laws/): L5–L7.
- NASA Glenn, [Newton's Laws of Motion](https://www.grc.nasa.gov/WWW/K-12/BGP/newton.html): L1–L3.
- OpenStax Astronomy, [Newton's Universal Law of Gravitation](https://openstax.org/books/astronomy/pages/3-3-newtons-universal-law-of-gravitation): L4, L7.
- NASA, [Planetary Systems](https://science.nasa.gov/universe/stars/planetary-system): L9, L10.
- NASA / McDonald Observatory, ["Out of Whack" Planetary System](https://science.nasa.gov/missions/hubble/out-of-whack-planetary-system-offers-clues-to-a-disturbed-past) and [Barnes et al. 2010](https://ar5iv.arxiv.org/html/1011.2216): L10.
- NASA, [Tidal Locking](https://science.nasa.gov/moon/tidal-locking/): L11.
- Scientific American, [Why Venus Spins the Wrong Way](https://www.scientificamerican.com/article/why-venus-spins-the-wrong/): L9.
- The Planetary Society, [Triton](https://www.planetary.org/worlds/triton): L12.
- Sky at Night, [The Roche limit](https://skyatnightmagazine.com/space-science/roche-limit); [Planetary Rings (arXiv)](https://arxiv.org/pdf/1112.3305): L13, L14.
- Kopparapu et al. 2013, [Habitable zones around main-sequence stars](https://arxiv.org/abs/1301.6674) (runaway greenhouse); Hayashi 1981 (the snow line): L42.
- Space.com, [What are Lagrange points?](https://www.space.com/30302-lagrange-points.html): L15.
- ESA, ['Oumuamua](https://neo.ssa.esa.int/-/-oumuamua-the-first-interstellar-object-found-in-our-solar-system); [orbit solutions](https://www.johnstonsarchive.net/astro/oumuamua.html): L17.
- NASA NSSDC, [Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/), [notes](https://nssdc.gsfc.nasa.gov/planetary/factsheet/planetfact_notes.html) and [Mars Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html): L10, L19, L36.
- [Volumetric light needs a scattering medium](https://melies.co/cinematic-techniques/lighting/volumetric-light): L21.
- NASA APOD, [Why stars twinkle](https://apod.nasa.gov/apod/ap000725.html); Scientific American, [What makes stars twinkle?](https://www.scientificamerican.com/article/what-makes-stars-twinkle/): L23.
- OpenStax University Physics, [Blackbody radiation](https://theexpertta.com/book-files/OpenStaxUniversityPhysicsVol3/UP3_6.1.%20Blackbody%20Radiation_pg248-255.pdf): L25, L26.
- The Conversation, [Why isn't there any sound in space?](https://theconversation.com/why-isnt-there-any-sound-in-space-an-astronomer-explains-why-in-space-no-one-can-hear-you-scream-217885): L30.
- FIU, [rocket nozzle expansion](https://web.eng.fiu.edu/allstar/rocket3.htm); Aerospaceweb, [shock diamonds](https://aerospaceweb.org/question/propulsion/q0224.shtml): L31.
- SwRI Lucy mission, [Density of the asteroid belt](https://lucy.swri.edu/MainBeltDensity.html); Universe Today, [the asteroid belt](https://www.universetoday.com/130230/far-asteroid-belt-sun/): L37.
- [Hubble's law and the expanding universe (arXiv)](https://ar5iv.arxiv.org/html/0904.2633): L38.
- Guinness World Records, [Fastest spacecraft speed](https://www.guinnessworldrecords.com/world-records/66135-fastest-spacecraft-speed): Units.
- Comet and planet appearance: the sources in the two realistic-body specs under `docs/superpowers/specs/`.
