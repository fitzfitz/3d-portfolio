# Universe Laws

The test for this universe: someone who really knows astronomy and physics
flies through it and feels they are in a universe that matches their
understanding. This page lists every law that a visitor could see being kept
or broken, how the scene stands on each one, and where it is enforced.

- **Follows**: the scene obeys the law.
- **Convention**: a presentation choice every orrery and planetarium makes,
  disclosed to the visitor (P3 below). Nothing else is allowed to bend a law.
- **Breaks → F*n***: not yet lawful; F*n* is its fix in
  `docs/archive/specs/2026-10-16-universe-laws-fixes-design.md`.

`tests/universeRules.test.ts` enforces the laws marked *(tested)*.

## Principles

**P1. The laws are exact.** What moves, which way, how fast for its orbit,
how light falls, what can be seen and heard in vacuum: all follow physics.

**P2. This is the Solar System.** The Sun, the eight planets, Ceres and the
nine major moons are the real ones, with their real names, NASA/USGS surface
maps where a true-colour global map exists, IAU poles and NASA physical data.
Each body sits where JPL's "Approximate Positions of the Planets" puts it for
the **orrery date** shown on the HUD, in every scan and on the system chart,
so any planetarium app can check it. Nothing about the system is chosen: where
a number is not NASA's or the IAU's, it is one of the conventions below.
(Real-solar-system design: `docs/archive/specs/2026-10-20-real-solar-system-design.md`.)

**P3. The disclosed conventions, the ones every orrery uses:**
- **Sizes are enlarged** against distances, or the bodies would be invisible
  specks: one law draws every planet, Ceres and moon at radius
  r = 22 u × (D / 142,984 km)^0.4 (`sizeLaw.ts`), so bigger bodies are
  enlarged less and the true order holds. Earth is drawn 1,707× its true size,
  Jupiter 400×, Ceres 8,163×; the Moon is 0.6× Earth (real 0.27×). **The Sun
  is the exception**, at 24 u (45× its true radius): on the law it would be
  ~55 u and swallow Mercury's orbit. Each scan says "DRAWN n× TRUE SIZE".
- **Two clocks.** The **orbit clock** runs 1 s ≈ 20.9 h, a year every 420 s
  (7 minutes); every heliocentric position is real for the orrery date it
  shows. At that rate Earth would spin once a second, so spins and the moon
  insets run on one **close-up clock**, 1 s ≈ 1.2 h, which keeps the real
  ratios (Earth's day 20 s, Jupiter's 8.3 s, Io's orbit 35 s, the Moon's
  9 min). Moon phases, moon arrangements and planets' day sides are
  **illustrative**: they do not follow the orrery date.
- **Moon systems are insets.** Each system keeps its moons' real distance
  ratios at one scale of its own (the Moon 0.040, Mars 0.599, Jupiter 0.313,
  Saturn 0.131, Neptune 0.137), chosen so the innermost moon clears its planet
  (Saturn's: the A ring), so Io : Europa : Ganymede keeps the 1 : 2 : 4
  Laplace resonance. Major moons only: those over 2,500 km, plus Phobos and
  Deimos.
- **Very dark surfaces are drawn brighter** than their true albedo by one
  shared, order-preserving display curve, so they stay visible; their
  relative order is real (`displayAlbedo.ts`). On a body's median linear
  albedo a (its map's texel median), the curve is the identity at and above a
  knee of 0.0766 (Earth's map, measured as its mean under its clouds) and knee·(a/knee)^γ below it, with
  γ ≈ 0.2985, set so that the dimmest mapped body, Ceres (0.016), gets
  exactly 3×. It lifts Ceres 3×, the Moon 2.47×, Mercury 2.17×, Mars 1.93×,
  Callisto 1.79×, Titan 1.63× (Phobos 3.59×, Deimos 3.27×); Earth, Venus, the
  giants, Io, Europa, Ganymede and Triton are drawn as they are.

The logbook's ORRERY CONVENTIONS note (`ORRERY_NOTE`, `realUnits.ts`) tells
the visitor all of them, and each scan repeats the ones that touch its body.
Nothing else may bend a law.

**P4. Anything the game needs beyond that is done lawfully in the world**:
thrust (flight assist, station-keeping), stable points (Lagrange points), real
camera optics (bloom, glare, exposure), sound carried through the hull.

### Units

The system is pinned to real units by two anchors: 1 AU is 115 units and a
Julian year is 420 game seconds.

| Quantity | Scene | Real |
|---|---|---|
| 1 unit of distance | 1 | 1.30 million km (1 AU / 115) |
| 1 game second | 1 s | 20.9 hours (1 year / 420), the orbit clock |
| `GM_SUN` | 340.4 u³/s² | 1.327 × 10²⁰ m³/s², the Sun's own value |
| A circular orbit at 1 AU | 1.72 u/s | 29.8 km/s, Earth's mean orbital speed |
| Ship cruise | 10.8 u/s | 187 km/s, close to Parker Solar Probe's 192 km/s record |
| Ship warp | 39 u/s | 675 km/s, 0.23% of light speed |
| Long-range cruise, at most | 468 u/s | 8,102 km/s, 2.7% of light speed |
| The system's edge | 3,600 u | 31.3 AU, just past Neptune's aphelion (30.3 AU) |

Long-range cruise is warp grown with the clear space around the ship:
v = 39 × clamp(d_free / 60, 1, 12) u/s, d_free being the distance to the
nearest body, moon, landmark or probe surface, or to the edge (`cruise.ts`).
Near anything it is plain warp; in open space it reaches 12×, so Earth to
Neptune takes 10–20 s on less than one tank. The camera sees the whole system
(far plane 8,000 u, 69.6 AU) through a logarithmic depth buffer
(`logDepth.ts`), so no cloud shell or ring fights at any range. No orbit lines are drawn in the scene (owner, 2026-10-21); the logbook's system chart shows the true ellipses.

The code source of these numbers is `src/utils/realUnits.ts`; `tests/realUnits.test.ts` pins them.

## A. Motion and gravity

| # | Law | Status |
|---|---|---|
| L1 | **Newton's first law.** A moving body keeps its velocity until a force acts. | **Breaks → F1.** The ship slows by itself (`SPACE_DRAG`) with no visible cause. |
| L2 | **Newton's second law.** F = ma: thrust changes velocity in proportion. | Follows. |
| L3 | **Newton's third law.** Every push has an equal push back, so a change of motion needs visible thrust. | **Breaks → F1, F10.** The ship brakes, and freighters and the jellyfish turn, with no visible thrust; long-range cruise sheds speed near a body with no visible burn. |
| L4 | **Universal gravitation.** Every mass pulls every other with F = GMm/r². | **Breaks → F2.** The flight gravity wells use 1/r², but with their own strengths, a lenient climb-out and a "fling" that turns momentum with no force. A body's well reaches 3.5 sizes and its strength goes by size, not mass (L36). The Sun's well is 34 u wide, ending inside Mercury's perihelion (35.4 u), with G 3,500 so a sun skim at r ≈ 30 still slingshots, and counts like a planet's (whoosh, radio line, badge); it is the only place the Sun pulls, so the belt is unaffected. |
| L5 | **Kepler's first law.** Orbits are ellipses with the central body at a focus. | Follows *(tested)*. Every planet, Ceres, both comets and every belt and Trojan rock flies a Kepler ellipse with the Sun at a focus, solved from Kepler's equation. Mercury's and Mars's orbits are visibly off-centre (Mercury 35.4–53.7 u). Positions are JPL's: Table 2a elements and rates (valid 3000 BC to 3000 AD) with Table 2b's extra terms for Jupiter to Neptune, M = E − e·sin E solved by Newton's method, rotated by ω, I and Ω into the J2000 ecliptic (`ephemeris.ts`); Ceres and the comets from JPL SBDB osculating elements. An independent implementation agrees to 10⁻⁶ AU from 1000 to 2900 AD, and JPL Horizons vectors fall inside JPL's published error bounds. Past 3000 AD the elements are held at their 3000 AD values. |
| L6 | **Kepler's second law.** A body moves fastest nearest its star (equal areas in equal times). | Follows *(tested)*: Mercury moves (1 + e)/(1 − e) ≈ 1.52× faster at perihelion than at aphelion, and scans show the live speed (vis-viva). |
| L7 | **Kepler's third law.** T² = 4π²a³/GM, with one GM per central body. | Follows *(tested)*. One `GM_SUN` sets the belt, the Trojans and the comets through `keplerPeriod`; the planets' mean motions are JPL's and agree with Kepler's on `GM_SUN` within 0.2% (the remainder is each planet's own mass, (1 + m/M), ~0.1% for Jupiter). Each moon system has one GM of its own, set so Kepler III holds inside the inset on the close-up clock (`insetGM`; every moon within 1%). No orbit may have a hand-picked speed. |
| L8 | **Conservation of energy and angular momentum.** | Follows for orbits. **Breaks → F2** for the ship's gravity fling. |
| L9 | **One direction.** Planets formed in one spinning disk, so they orbit and spin the same way (only Venus and Uranus spin backwards). | Follows *(tested)*. Every body orbits counter-clockwise seen from ecliptic north, which is world +Y (`PROGRADE` +1; the ecliptic-to-world map is a proper rotation, never a mirror). Each spin axis is the body's IAU pole, fixed in space through its orbit, at NASA's obliquity within 0.5°; Venus and Uranus turn backwards about it (obliquities 177.4° and 97.8°, negative sidereal days), as in reality, so Uranus rolls on its side and shows a pole to the Sun at its solstices. Every moon orbits forwards but Triton (L12). The belt, the Trojans and both comets are prograde. |
| L10 | **Near-coplanar orbits.** The planets formed in one disk, so their orbits lie close to one plane. | Follows *(tested against JPL)*: each orbit is tilted to the ecliptic by JPL's I (Mercury 7.00°, Venus 3.39°, Earth 0.00°, Mars 1.85°, Jupiter 1.30°, Saturn 2.49°, Uranus 0.77°, Neptune 1.77°; Ceres 10.59°), with JPL's nodes and perihelia, and no two orbits lie 12° apart. |
| L11 | **Tidal locking.** Large moons spin once per orbit and show one face. | Follows *(tested)*: every moon keeps one face on its planet (local +X, map longitude 0) and leads with its 90° W hemisphere. |
| L12 | **Captured moons may orbit backwards** (Neptune's Triton). | Follows *(tested)*: Triton orbits 156.9° to Neptune's equator, against Neptune's spin; it is the only moon that does. |
| L13 | **Mass hierarchy and the Hill sphere.** A planet is far lighter than its star, and moons stay bound only close to it. | Convention (P3). Each moon system is an inset with real distance ratios at its own scale and its own clock, so the moons sit closer to their planets than real; their GM is the inset's, not the planet's. Disclosed in the logbook; the HUD and scans read in real units (F13). |
| L14 | **Roche limit.** Inside about 2.44 planet radii, tides tear a fluid body apart: rings form inside it, moons outside. | Follows *(tested)*. Saturn's real rings lie in its equator (its IAU pole), so their opening to the Sun changes over its 29.5-year orbit, with Saturn's profile in equatorial R (C 1.24–1.53, B 1.53–1.95, Cassini division 1.95–2.03, A 2.03–2.27, Encke gap ~2.21). For ice particles (0.92 g/cm³) around Saturn's density (0.69) the fluid limit is 2.44 · (0.69 / 0.92)^⅓ ≈ 2.2 R (`fluidRocheLimit`), and the A ring's outer edge sits at it, as the real one does; no margin is claimed. Uranus has its narrow, dark ε ring at 2.00 R (51,149 km), drawn 0.02 R wide because its real 20–96 km would be under a pixel, optical depth 0.5–2.5, albedo 0.02. Earth has no ring. Jupiter's and Neptune's faint rings are not drawn. |
| L15 | **Lagrange points.** L4 and L5, 60° ahead of and behind a planet on its orbit, are stable; Trojans live there. | Follows *(tested)*: Jupiter's Trojans, 160 rocks in two swarms at L4 and L5, on Jupiter's semi-major axis and mean motion, within ±25° of the points (e ≤ 0.15, I ≤ 30°), so they keep pace with Jupiter lawfully. F8 can park stations at Lagrange points too. |
| L16 | **Nothing unpowered hovers.** A body that is not orbiting falls toward the star; holding still costs constant thrust. | **Breaks → F8.** Stations, the shipyard, the gate, the portal, buoys, the project probes (station-keeping, RCS puffs shown), beacons, shards, fuel crystals and the hero asteroids hold still. |
| L17 | **Escape velocity.** A visitor from outside the system flies a hyperbola that bends around the star ('Oumuamua: e ≈ 1.2). | **Breaks → F9.** The world-event comet flies a straight line. |
| L18 | **Space has no edge.** | Follows *(tested)*: the system is a 3,600-unit (31.3 AU) sphere with a real edge (`SYSTEM_RADIUS`). Neptune's aphelion (3,488) plus its 50 u well fits inside the nebula haze, which thickens from 3,560 (`HAZE_START`, `SYSTEM_RADIUS` − 40) to 3,600. Past the edge the flight computer cuts warp and flies a return burn that brings the ship back; nothing wraps. The worst overshoot at full cruise (under 100 u) stays inside the beacon Worker's 3,800 `VALIDATION_RADIUS`. The burn's visible thrusters come with F1. |

## B. Light and optics

| # | Law | Status |
|---|---|---|
| L19 | **Inverse-square law.** Light weakens with distance squared (Mars gets 43% of Earth's sunlight). | Follows *(tested)*: the sun light has `decay={2}`, 2.1 at 1 AU (`sunLight.ts`). The camera adapts fully, like a spacecraft camera exposing for its target (L22): its exposure is 1.5 × clamp((d / AU)^2, 0.15, (3,600 / 115)^2 ≈ 980), d being the camera's distance from the Sun, eased with a 1.5 s half-life. It cancels the inverse-square sunlight exactly, so a lit surface reads at the same brightness at every distance from 44.5 u (AU·√0.15, where the near-sun floor begins) out to the edge: a body shows its true albedo wherever the camera meets it, and distance reads from the Sun's shrinking disc instead. (The owner chose full adaptation on 2026-10-19, so the bodies read like the NASA references.) The constant 1.5 (`EXPOSURE_LIFT`, owner's pick 2026-10-21) is a longer exposure everywhere: with it every lit disc's median reads at least 25 luma (the Moon and Earth, the darkest, ~32). The tone curve is three's PBR Neutral with one change, a hue-keeping toe (`hueToe.ts`): three's toe subtracts the same offset from every channel, which crushed blue in dark warm greys and turned Venus and Saturn olive; the patched toe scales the colour instead, so they read cream and tan at their maps' own blue/green. The maps are honest to their bodies' geometric albedos on the scene's scale, 0.177 × geometric, each within 3%; the dark ones are lifted by the display curve (P3). The Sun's core, corona and glare, the instrument overlays (zone circles, guide lines) and the ring-course gates are compensated by 1 / exposure, so they look the same at every exposure. Lit matter is not: the rings and the atmosphere rims (L27) scale with the sunlight at their body's **live** distance (Mercury's sunlight varies 2.3× around its orbit, Saturn's rings (Q/q)² ≈ 1.24×), and in low-perf, where no post pass exposes custom shaders, they multiply by the exposure themselves (`litExposure`). A body under 2 px across is drawn as a dot of its sunlit colour (`BodyDots`); under the size law that is mostly Ceres, and Mercury from far out, since the planets stay at least 2 px across from almost anywhere inside the edge. The fill is sunlight too: the ambient light (0.15 at full) and `scene.environmentIntensity` scale with (AU / d)² at the camera, clamped to at most 1 (`fillScale`); from 1 AU out the exposure cancels that falloff, so a night side keeps the same ratio to its day side at every distance. The unlit backdrop (the painted sky, the nebula clouds and the distant galaxies) is not sunlit, so a longer exposure brightens it, as it would in a real camera, and the Milky Way band glared far out. So the backdrop alone is toned down by one disclosed factor (`backdropScale`): (AU / d)^0.5 from 1 AU, so it follows 1.5 × (d / AU)^1.5 (the lift brightens it too), and past ~365 u its net gain holds at 8.5 (`BACKDROP_NET_MAX`, the old 480 u edge's value before the lift) all the way to Neptune and the edge. The stars are not toned: they read brighter far out. |
| L20 | **Shadows and eclipses.** A body in another's shadow goes dark; moons cast shadows on planets. | Follows *(tested)* (F4): analytic sphere-against-disc shadows, no shadow maps (`sunShadow.ts`). The occluder slots are fixed: 16 slots, 15 used, the six bodies with a moon or a ring (Earth, Mars, Jupiter, Saturn, Uranus, Neptune) and then the nine moons. Mercury, Venus and Ceres hold no GPU slot (no moon or ring, and their shadows never reach another body): they shadow the ship and the Sun's glare on the CPU only (`allOccluders`). Shadowed per fragment: the planets and Earth's cloud layer against their moons, the round moons against their planet and their siblings (eclipses: at the pinned test date Ganymede sits in Jupiter's umbra and Titan half in Saturn's); Phobos and Deimos take one CPU sun-visibility factor each; the ship against every body and moon; the Sun's glare dims by every body and moon in front of it. Saturn's rings shadow Saturn: the sunlight through the ring plane is exp(−τ/μ₀) at the radius it crosses, with no viewer term, so the shadow does not move with the camera; Saturn's shadow darkens the rings. Only the Sun's light is scaled; ambient and emissive light stay, so an umbra keeps what a night side keeps. **Disclosed P3 artifact:** the drawn Sun is ~45× its true angular size from everywhere, so every shadow has a wide penumbra: moon shadows on a planet are soft, Io's and Europa's eclipses are partial (0.70 and 0.83 of the light kept at their deepest at the test date), and the Cassini division's shadow is soft where the real one is sharp. Not shadowed, all minor: Uranus's ε ring on Uranus, the belt, Trojan and comet rocks, the career station and shipyard, and the atmosphere rims. The ghost ships are unlit holograms, so there is nothing to shadow. |
| L21 | **Light is invisible in flight.** Beams show only where dust or air scatters them, and vacuum has none. | Follows. The god-ray pass is gone; nothing draws beams through empty space. The tractor beam is drawn as a glowing field (L33), not as scattered light. |
| L22 | **Camera optics are real.** Bloom, glare, lens flare, diffraction and exposure are effects of the lens and eye, so they are lawful. | Follows: bloom, and the Sun's glare, diffraction spikes and flare ghosts are the lens. F3 and F5 lean on this. The exposure is the camera's: it adapts fully (power 2, L19), like a spacecraft camera exposing for its target, with one constant 1.5× lift, so surfaces read at the same brightness at every distance and the Sun's shrinking disc tells the distance. The tone curve is the camera's too: PBR Neutral with a hue-keeping toe (L19). Unlit light (stars, the backdrop) brightens with a longer exposure, as in any camera; only the backdrop is toned, by one disclosed factor (L19). |
| L23 | **Stars don't twinkle in space.** Twinkling comes from Earth's air; Hubble sees steady points. | Follows. The star shaders have no time input; the stars hold steady. |
| L24 | **Fixed stars.** At these distances stars show no parallax and do not move. | Follows *(tested)*: the three star shells ride with the ship and never rotate; they show no parallax. They are not yet the real sky (no constellations, no Polaris above Earth's pole): `docs/FOLLOW-UPS.md`. |
| L25 | **Wien's law.** Colour shows temperature: hot is blue-white, cool is orange-red. | Follows: the Sun is about 5,800 K white (`#fff4e0`); background stars are mostly white with some blue-white and orange. |
| L26 | **Stefan–Boltzmann law.** Luminosity ∝ R²T⁴. | Follows: no conflict at our sizes (P3). F12 must keep the Sun's colour and brightness consistent if its size changes. |
| L27 | **Rayleigh scattering.** Thin air glows blue at the limb. | Follows: Earth's blue rim, bright on the day side with a sunset-orange terminator; Mars's thin rim with a blue dusk (as the rovers see it); Venus's pale cream haze; Titan's orange haze; the giants' rims, the ice giants' terminators a cool methane blue. |
| L28 | **Limb darkening.** A gas giant dims toward its edge. | Follows: Jupiter, Uranus and Neptune. |
| L29 | **One light source.** Every lit body has a day side, a night side and a terminator facing the star. | Follows *(tested)*: the planets, moons and cloud shells take no image-based light (`noIbl.ts`), so a night side has only the uniform ambient fill (L19) and its own night lights (L33). The studio environment in `GlobalCanvas.tsx` (coloured panels fixed in world space) still gives the ship, the probes and the small props their reflections; on the bodies it used to light the night sides faintly red, wherever the Sun was. The sky probe holds Earth's night half neutral. |
| L41 | **Meteors need an atmosphere.** Shooting-star streaks are air glowing around a falling grain; in vacuum a grain is invisible unless sunlit. | **Breaks → F14.** `ShootingStars.tsx` draws meteor streaks. |

## C. Matter, heat and sound

| # | Law | Status |
|---|---|---|
| L30 | **Sound needs a medium.** Vacuum carries none. | Follows. Every sound is heard inside the ship: engine hum through the hull, contact on impact, instruments, radio. Nothing is heard from outside; there is no positional audio. The slingshot "whoosh" is an instrument tone. Keep it that way. |
| L31 | **Vacuum plumes spread.** With no air pressure an exhaust plume fans out wide and fades; shock diamonds need an atmosphere. | Follows: the plume fans out to a cone of about 30° half-angle at every throttle (the shader widens it with distance, so the angle holds as it lengthens) and thins and fades toward the wide end; no shock diamonds in the shader. A project probe's relocation plume leaves its main engine bell at the bell's own exit radius and fades in over its first 0.3 u, so the bell and its lit throat show at the root, as a real engine's do. Shock diamonds in air (none yet) would be a separate, air-only effect. |
| L32 | **Comets.** Ice sublimates near the star; radiation pressure pushes dust into a curved tail; the solar wind pushes gas into a straight tail away from the star. | Follows (realistic-comet spec): the comets are the real 2P/Encke and 67P/Churyumov–Gerasimenko on their SBDB orbits. |
| L33 | **Only hot or excited matter glows.** | Follows: the Sun, Earth's city lights (Black Marble) on the night side only, Io's volcanic hot spots (USGS-named, Loki the brightest) seen only on its night side or in eclipse, the comet coma, the atmosphere rims. |

## D. Scale and cosmos

| # | Law | Status |
|---|---|---|
| L34 | **Real sizes and distances.** Planets are specks across vast gaps. | Distances are real (L42); sizes are a convention (P3), disclosed in the logbook and in each scan ("DRAWN n× TRUE SIZE"); the HUD and scans read in real units (F13). |
| L35 | **Stars outsize their planets.** The smallest star is about Jupiter's size; the Sun is 10× Jupiter. | **Follows (P3)** *(tested)*. The solid Sun (radius 24) outsizes every body (Jupiter 22, the largest), though not 10× Jupiter: the order is true, the ratio (1.09×) is compressed. Its corona is 72 across. |
| L36 | **Planet size follows type.** Gas giants are many times larger than rocky worlds (Jupiter 11× Earth, Mars half of Earth). | **Follows (P3)** *(tested)*. One size law, r = 22 × (D / 142,984 km)^0.4, for every body and moon, so every size keeps its true order: Jupiter 22.0 > Saturn 20.6 > Uranus 14.6 > Neptune 14.4 > Earth 8.4 > Venus 8.2 > Mars 6.5 > Ganymede 5.9 > Titan 5.8 > Mercury 5.7 > Callisto 5.7 > Io 5.1 > the Moon 5.0 > Europa 4.8 > Triton 4.5 > Ceres 2.95 > Phobos 0.66 > Deimos 0.52. Jupiter and Saturn are drawn oblate by their real flattening (6.5% and 9.8%; Uranus, Neptune, Earth and Mars too). Flight gravity wells go by drawn size, not mass (L4, F2): a well reaches 3.5 sizes, and its strength is `PLANET_WELL_G` × (size / 16)² up to size 16, so its pull at the same multiple of a body's size is the same, and × (size / 16) above it (Ruling R21), because a bigger well is crossed for longer and the giants' size-scaled skims would otherwise end in their surfaces. Jupiter's and Saturn's wells therefore pull 27–37% less than a pure size² law. Do not "fix" the wells to masses. |
| L37 | **Asteroid belts are mostly empty.** | Follows *(tested)*. The main belt is the real one, 2.1–3.3 AU (241–380 u), with the Kirkwood gaps (4:1 at 2.06, 3:1 at 2.50, 5:2 at 2.82, 7:3 at 2.95, 2:1 at 3.27 AU) cleared, each rock on its own Kepler ellipse (e ~ Rayleigh 0.1, capped 0.3; I ~ Rayleigh 8°). Its 400 rocks (200 in low-perf) sit about 30 units (40 million km) from their nearest neighbour, against roughly 0.2–0.7 units for real asteroids larger than 1 km: mostly empty, as a real belt is. Each rock is drawn enlarged (P3). |
| L38 | **Hubble–Lemaître law.** Galaxies recede, but too slowly to see in a lifetime. | Follows: the galaxies are static. |
| L39 | **Speed of light.** Nothing outruns light. | Follows *(tested)*: warp is 0.23% of light speed, and long-range cruise at most 2.7% (Units). |
| L40 | **One clock.** Everything in a system runs on the same time. | Follows for every orbit around the Sun (the orbit clock). Spins and the moon insets run on the close-up clock (P3), a convention disclosed in the logbook; the HUD and scans read in real units (F13). |
| L42 | **Each body sits at its real orbit.** A body's kind fits where it is: water-ice rings sublimate in strong sunlight, a runaway greenhouse needs plenty of it, nitrogen ice needs deep cold. | Follows *(tested)*: every body flies its own NASA orbit (JPL Table 2a, SBDB for Ceres) at its real distance, so nothing is placed by choice. `src/data/worldTypes.ts` still checks each kind's conditions all the way round the real orbits, from the flux (AU / r)² S⊕ and T_eq = 278.6 K · (1 − A)^¼ / √(r / AU): Saturn's water-ice rings T_eq ≤ ~170 K, Ceres's buried ice ≤ ~180 K, Venus's runaway greenhouse ≥ ~1.1 S⊕; and no nitrogen-ice dwarf could sit inside Saturn's orbit. Scan temperatures quote NASA's measured values. |

## Adding something

- **It orbits the Sun:** give it real elements (JPL Table 2a / SBDB) in `src/utils/ephemeris.ts`'s format, or take its speed from `keplerPeriod(a, GM_SUN)`. Never a hand-picked speed (L7).
- **It orbits a planet:** add a row to `SOLAR_MOONS` (`src/data/solarMoons.ts`) with its real a, period and plane; its inset distance, GM and occluder slot follow.
- **It is a new body:** add it to `SOLAR_BODIES` (`src/data/solarSystem.ts`) with NASA's diameter, rotation, albedos and the IAU pole (its size comes from `drawnRadius`), and keep `tests/solarClearance.test.ts` and `tests/worldTypes.test.ts` green.
- **It holds a fixed position:** keep it clear of every swept orbit, well and moon system (`tests/helpers/solarClearance.ts`), since the bodies move with the date; better, put it in an orbit or at a Lagrange point, or show the thrust that holds it (L16).
- **It spins or orbits through `rotation.y`:** multiply by `PROGRADE`.
- **It changes speed or direction:** show the push (L3).
- **It makes a sound:** the sound must be heard inside the ship (L30).
- **It glows or casts light:** it must be hot or excited (L33), and its light falls off with distance (L19).
- **Always:** keep `tests/universeRules.test.ts` green, and extend it when the new thing has its own table.

## Sources

- JPL Solar System Dynamics, [Approximate Positions of the Planets](https://ssd.jpl.nasa.gov/planets/approx_pos.html) (E. M. Standish, Tables 2a and 2b, and their error bounds): L5–L7, L10, L42.
- JPL, [Small-Body Database API](https://ssd-api.jpl.nasa.gov/doc/sbdb.html) (Ceres, 2P/Encke, 67P) and [Horizons](https://ssd.jpl.nasa.gov/horizons/) (the test vectors): L5, L32, L42.
- JPL, [Planetary Satellite Mean Elements](https://ssd.jpl.nasa.gov/sats/elem/): L11–L13.
- NASA NSSDC, [Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/), [notes](https://nssdc.gsfc.nasa.gov/planetary/factsheet/planetfact_notes.html) and the satellite fact sheets: diameters, rotation, obliquity, albedo, flattening; L9, L19, L36.
- Archinal et al. 2018, [Report of the IAU WGCCRE: 2015](https://doi.org/10.1007/s10569-017-9805-5), Celest. Mech. Dyn. Astron. 130:22 (poles; Mars from the 2009 report, Archinal et al. 2011): L9, L14.
- NASA, [Orbits and Kepler's Laws](https://science.nasa.gov/resource/orbits-and-keplers-laws/): L5–L7.
- NASA Glenn, [Newton's Laws of Motion](https://www.grc.nasa.gov/WWW/K-12/BGP/newton.html): L1–L3.
- OpenStax Astronomy, [Newton's Universal Law of Gravitation](https://openstax.org/books/astronomy/pages/3-3-newtons-universal-law-of-gravitation): L4, L7.
- NASA, [Planetary Systems](https://science.nasa.gov/universe/stars/planetary-system): L9, L10.
- NASA, [Tidal Locking](https://science.nasa.gov/moon/tidal-locking/): L11.
- Scientific American, [Why Venus Spins the Wrong Way](https://www.scientificamerican.com/article/why-venus-spins-the-wrong/): L9.
- The Planetary Society, [Triton](https://www.planetary.org/worlds/triton): L12.
- Sky at Night, [The Roche limit](https://skyatnightmagazine.com/space-science/roche-limit); [Planetary Rings (arXiv)](https://arxiv.org/pdf/1112.3305): L13, L14.
- Kopparapu et al. 2013, [Habitable zones around main-sequence stars](https://arxiv.org/abs/1301.6674) (runaway greenhouse); Hayashi 1981 (the snow line): L42.
- Space.com, [What are Lagrange points?](https://www.space.com/30302-lagrange-points.html): L15.
- ESA, ['Oumuamua](https://neo.ssa.esa.int/-/-oumuamua-the-first-interstellar-object-found-in-our-solar-system); [orbit solutions](https://www.johnstonsarchive.net/astro/oumuamua.html): L17.
- [Volumetric light needs a scattering medium](https://melies.co/cinematic-techniques/lighting/volumetric-light): L21.
- NASA APOD, [Why stars twinkle](https://apod.nasa.gov/apod/ap000725.html); Scientific American, [What makes stars twinkle?](https://www.scientificamerican.com/article/what-makes-stars-twinkle/): L23.
- OpenStax University Physics, [Blackbody radiation](https://theexpertta.com/book-files/OpenStaxUniversityPhysicsVol3/UP3_6.1.%20Blackbody%20Radiation_pg248-255.pdf): L25, L26.
- The Conversation, [Why isn't there any sound in space?](https://theconversation.com/why-isnt-there-any-sound-in-space-an-astronomer-explains-why-in-space-no-one-can-hear-you-scream-217885): L30.
- FIU, [rocket nozzle expansion](https://web.eng.fiu.edu/allstar/rocket3.htm); Aerospaceweb, [shock diamonds](https://aerospaceweb.org/question/propulsion/q0224.shtml): L31.
- SwRI Lucy mission, [Density of the asteroid belt](https://lucy.swri.edu/MainBeltDensity.html); Universe Today, [the asteroid belt](https://www.universetoday.com/130230/far-asteroid-belt-sun/): L37.
- [Hubble's law and the expanding universe (arXiv)](https://ar5iv.arxiv.org/html/0904.2633): L38.
- Guinness World Records, [Fastest spacecraft speed](https://www.guinnessworldrecords.com/world-records/66135-fastest-spacecraft-speed): Units.
- Surface maps: the NASA/USGS/JPL public-domain mosaics pinned in `scripts/textures/fetch_nasa_maps.mjs` and listed in `assets-src/MANIFEST.md`.
- Comet and planet appearance: the sources in the realistic-body specs under `docs/archive/specs/`.
