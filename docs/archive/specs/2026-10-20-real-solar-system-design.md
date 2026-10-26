# Real solar system: design

**Date:** 2026-10-20 · **Branch:** `feat/real-solar-system` · **PR:** #40 (next free number; changelog `pr: 40`)
**Status:** draft for owner approval. The owner skipped the brainstorm questions; calls not quoted from the owner are marked *(my call)*. On 2026-10-20 the owner kept all nine §10 calls and answered the builder check's questions (§10, last three items).

## 1. Intent

The system stops being "our own star system" and becomes **the Solar System**: the real planets, at their real distances, on their real orbits, in the real place on those orbits for the date shown, moving by Kepler's laws as NASA states them.

**Owner, in their words:** "go with real solar system first. Pay attention of the laws of kepler from nasa and the orbits." The test, asked what should make an astronomy fan say *this is the real solar system*: "When they look at it and running around it." So it must hold up both **at a glance** (the shape of the system, the planets' faces) and **up close in flight** (orbits, speeds, moons, tilts behave as they know them).

**Agreed earlier (memory `game-vision-combat-economy`, 2026-10-20):** probes first (done, PR #39), then this stage, then the game stages. Exact real placement (real AU distances, near-flat real inclinations), Venus added, real names, NASA maps, sizes enlarged in true order and disclosed, universe grows to ~3,500 u (Neptune), fuel and beacon-api position limits change, probes stay in the inner system, "worlds charted" becomes the real planets, pilots who already hold CARTOGRAPHER/AURUM keep them. Optional bonus: start at today's real positions. This design takes the bonus *(my call)*.

## 2. Goals, non-goals, anti-goals

**Goals**
- G1. **Kepler I:** every planet, Ceres, both comets and every belt rock moves on an ellipse with the Sun at one focus. Mercury's and Mars's orbits look visibly off-centre on the orbit lines.
- G2. **Kepler II:** speed changes along the orbit. Mercury visibly speeds up at perihelion (×1.52 against aphelion), and the scan shows the live speed.
- G3. **Kepler III:** periods come from the real mean motions and agree with T² = 4π²a³/GM_SUN, with one `GM_SUN`. Nothing that orbits the Sun has a hand-picked speed.
- G4. **Real orbits:** NASA/JPL elements a, e, I, L, ϖ, Ω for each planet; real tilts (all within 7.0° of the ecliptic); the true orientation of each ellipse; real positions for the orrery date, which is shown on screen and checkable against any planetarium app.
- G5. **Real bodies:** Mercury, Venus (new), Earth, Mars, Ceres, Jupiter, Saturn, Uranus, Neptune with real names, real surface maps (NASA/USGS where a true-colour global map exists), real axial tilts and pole directions, real spin senses (Venus and Uranus backwards), real oblateness (Jupiter 6.5%, Saturn 9.8%), and real major moons.
- G6. **Flyable at the new scale:** a visitor can fly from Earth to Neptune in well under a minute on one tank, and approaching any body still feels as controlled as today.
- G7. **Honest conventions:** what is enlarged or sped up is stated in the logbook and in each scan, in one sentence each, with numbers.

**Non-goals (this PR)**
- Pluto, the Kuiper belt, the Oort cloud; Halley's comet (it sits near aphelion beyond the edge until ~2061).
- A real star catalogue for the background (constellations, Polaris above Earth's pole). It is the natural next follow-up: add it to `docs/FOLLOW-UPS.md`.
- The open universe-laws fixes F1 (flight assist), F2 (Newtonian ship gravity), F8 (Lagrange-point stations), F9 (hyperbolic visitor comet), F10, F14.
- Minor moons (Saturn's mid-size moons, Uranus's five majors and the rest; see §5.3 for the rule) and the faint rings of Jupiter and Neptune.
- A "true scale" toggle.

**Anti-goals** (failure even if it technically works)
- A planet in the wrong place for the date the HUD shows.
- A circular planet orbit, or any orbital speed not from Kepler.
- The Sun drawn smaller than any planet; a planet drawn out of true size order.
- Leftovers from the fictional system: Earth with a ring, a violet Mars with glowing rifts, a cyan Jupiter, an Io-like volcanic moon around Mars, captured ice moons around Jupiter or Mars.
- Recruiters losing the projects: the probes stay in the inner system, keys 1–3 still find them, and a first-time visitor is never stranded at 30 AU.
- A pilot losing CARTOGRAPHER or the AURUM plume, or old cached clients being rejected by the live sky.
- A performance regression past the documented ceilings without a deliberate, recorded re-baseline.

## 3. Constraints (from the codebase)

- Units stay anchored: `AU = 115` u and `YEAR_S = 420` s (one Julian year). So 1 game second = 365.25 d / 420 ≈ 20.9 h, and `GM_SUN = keplerGM(AU, YEAR_S)` is unchanged (340.4 u³/s²).
- `ambientTime(clock)` starts at 0 on every page load and freezes under reduced motion. Each visitor's sky is already their own; nothing in the live sky depends on planet positions.
- Live-sky positions are plain JSON numbers rounded to 0.01 (`roundState`), with no packed range. Only `VALIDATION_RADIUS` (shared by `beacons.ts` `inBounds` and `liveSkyProtocol.ts` `inWorld`, imported by beacon-api) limits them. **The Worker must be deployed before the site merge** whenever `VALIDATION_RADIUS` or `CHART_TOTAL` semantics change (deploy: `npx wrangler deploy --config beacon-api/wrangler.toml`, owner-approved).
- `SPAWN` (-50, 62, 69) is shared with the Worker's drop keep-out. It stays fixed *(my call)*: at r 105.4 u (0.92 AU) and 62 u above the ecliptic it clears every orbit.
- The camera far plane is 1,500 u with a standard depth buffer, and there is no fog.
- Perf: `docs/PERF-BUDGETS.md` ceilings (calls/triangles = baseline + 15%; programs fixed at 79/84; `LIGHT_BUDGET` 4). `MAX_OCCLUDERS` 16 (+0.55 ms GPU per 8 slots).
- Asset rules: photoreal (memory `asset-quality-photoreal`), seeded and reproducible generators, provenance in `assets-src/MANIFEST.md`, tiered asset packs with a service worker (PR #36).
- Every feature PR adds a changelog entry (`src/data/changelog.ts`, `pr: 40`).

## 4. Orbits and time (Phase 1)

### 4.1 Source of truth
- **Planets:** JPL "Approximate Positions of the Planets" (https://ssd.jpl.nasa.gov/planets/approx_pos.html), **Table 2a** (valid 3000 BC to 3000 AD), including the extra b, c, s, f terms for Jupiter to Neptune from Table 2b. Table 1 (1800–2050) is too short: the orrery clock passes about 206 years per wall-clock day, so a long session would leave Table 1's range. Earth uses the "EM Bary" row: Earth is drawn at the Earth–Moon barycentre (the Moon system is an inset, §5.3). Past 3000 AD, hold the elements at their 3000 AD values: the motion is still exact two-body Kepler.
- **Ceres and the comets:** osculating elements from the JPL Small-Body Database API (`https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=<id>&full-prec=1`), held fixed (pure two-body). The epoch and values go in the data file with the fetch date. Ceres (fetched 2026-10-20, epoch JD 2461200.5): a 2.765552595, e 0.079692295, i 10.588028°, Ω 80.248627°, ω 73.294215°, M 274.419346°.
- **Physical data:** NASA NSSDC Planetary Fact Sheet (diameters, rotation periods, obliquities, moon counts) and the IAU WGCCRE 2015 report (pole right ascension/declination and rotation models). Each value is cited in its data file.

### 4.2 Algorithm (JPL's own)
For orrery Julian date JD: T = (JD − 2451545.0) / 36525; each element = value + rate·T; ω = ϖ − Ω; M = L − ϖ (+ the b, c, s, f terms), normalised to ±180°. Solve M = E − e·sin E by Newton iteration to |ΔE| ≤ 1e-6°. In-plane: x′ = a(cos E − e), y′ = a√(1−e²)·sin E. Rotate by ω, then I, then Ω into the **J2000 ecliptic frame**. The existing `keplerPosition` solver is reused, extended with an argument of perihelion (it has none today) and an epoch.

### 4.3 Frame
- World = ecliptic, mapped by the proper rotation (x, y, z)_world = (x_ecl, z_ecl, −y_ecl): ecliptic north is world +Y, and the vernal equinox is world +X.
- The real system turns counter-clockwise seen from ecliptic north, so **`PROGRADE` flips from −1 to +1**. Every user of it (spins, moons, belt) flips with it; tests assert the sign through the law, not the literal.
- The mapping must stay a proper rotation (determinant +1), never a mirror.

### 4.4 The orrery clock and date
- Orrery JD = JD of the real current UTC time at page load + `ambientTime` × (365.25 / 420) days. Reduced motion freezes it as today.
- The HUD shows **ORRERY DATE YYYY-MM-DD**, small and next to the existing SUN AU readout; the system chart and every scan show it too. An expert can check any planet against any planetarium for that date. The logbook note gives the rate: "1 s ≈ 21 h: a year every 7 minutes".
- Tests and e2e pin the date through a debug hook / URL parameter (the builder picks the form, consistent with existing debug hooks), so positions are reproducible.

### 4.5 Kepler's third law
Each planet's mean motion is JPL's L-rate. A unit test checks it against 2π/√(a³/GM_SUN) within 0.2%; Jupiter's (1 + m/M) correction is about 0.1%, so the test documents why it isn't exact. `GM_SUN` still drives the belt, Trojans and comets. Earth's period becomes 420.007 s (the sidereal year against YEAR_S's Julian year); tests that pin "420 s" move to a tolerance.

### 4.6 The roster's orbits (u = AU × 115; T at 420 s per year)

| Body | a (AU) | e | I | a (u) | perihelion–aphelion (u) | period |
|---|---|---|---|---|---|---|
| Mercury | 0.38710 | 0.2056 | 7.00° | 44.5 | 35.4–53.7 | 101 s |
| Venus *(new)* | 0.72334 | 0.0068 | 3.39° | 83.2 | 82.6–83.8 | 258 s |
| Earth (EM bary) | 1.00000 | 0.0167 | 0.00° | 115.0 | 113.1–116.9 | 420 s |
| Mars | 1.52371 | 0.0934 | 1.85° | 175.2 | 158.9–191.6 | 790 s |
| Ceres | 2.76555 | 0.0797 | 10.59° | 318.0 | 292.7–343.4 | 32 min |
| Jupiter | 5.20289 | 0.0484 | 1.30° | 598.3 | 569.4–627.3 | 83 min |
| Saturn | 9.53668 | 0.0539 | 2.49° | 1,096.7 | 1,037.7–1,155.8 | 3.4 h |
| Uranus | 19.18916 | 0.0473 | 0.77° | 2,206.8 | 2,102.5–2,311.0 | 9.8 h |
| Neptune | 30.06992 | 0.0086 | 1.77° | 3,458.0 | 3,428.3–3,487.8 | 19.2 h |

(Values from Table 1 for orientation; the code uses Table 2a.)

### 4.7 Small bodies
- **Main belt** *(my call)*: moves from r 40–70 to the real 2.1–3.3 AU (241–380 u). Each rock is a Kepler ellipse: a sampled from the real distribution with **Kirkwood gaps** (4:1 at 2.06, 3:1 at 2.50, 5:2 at 2.82, 7:3 at 2.95, 2:1 at 3.27 AU), e ~ Rayleigh σ 0.1 (capped 0.3), I ~ Rayleigh σ 8°, Ω and ω uniform, all on GM_SUN. Keep 400 rocks (200 low-perf); the builder may raise the count if the budgets allow. Real belts look mostly empty (L37); that is right.
- **The halo (r 80–95, tilted 75°) is fictional and goes.** Its 160 rocks become **Jupiter's Trojans**: two swarms at L4 and L5, on Jupiter's a with mean longitude Jupiter's ± 60° plus a spread of up to ±25°, e ≤ 0.15, I ≤ 30°. With the same a they share Jupiter's period, so they stay with it lawfully. This makes L15 (Lagrange points) *followed*.
- **Comets** *(my call)*: the two fictional comets become **2P/Encke** (a 2.22 AU, e 0.85, 3.3 yr ≈ 23 min) and **67P/Churyumov–Gerasimenko** (a 3.46, e 0.64, 6.4 yr ≈ 45 min), with SBDB elements. The realistic-comet tail logic is unchanged.
- **Ring-course gates** inside r < 115 are re-placed clear of Mercury's and Venus's swept orbits.

### 4.8 Things fixed per orbit become live
Today `irradianceVsAU(orbit.radius)` (rings), `Atmosphere`'s `orbitRadius`, world temperatures and type checks assume circles. Lighting-related uniforms use the **live** heliocentric distance (Mercury's sunlight varies 2.3× around its orbit). Scan temperatures quote the namesake's real NASA values.

## 5. Bodies (Phase 2, except names, ids and sizes, which land in Phase 1)

### 5.1 Ids and names
- New body ids: `mercury, venus, earth, mars, ceres, jupiter, saturn, uranus, neptune`; moon ids `moon, phobos, deimos, io, europa, ganymede, callisto, titan, triton`.
- The planet keys `ruangrapi / portfolio / fuxx` stay **only** as project/probe ids (`projects.json`); the planets stop using them. Data keyed by the old planet keys (maps, atmospheres, `displayAlbedo`, moon tints, `PLANET_PROPS`, world ids `w-*`) moves to the new ids.
- No stored progress is lost (§7).
- Labels are real names (MERCURY … NEPTUNE, CERES). The interim labels, the "-TYPE" world names and the project jokes in `PLANET_FACTS` go.

### 5.2 Sizes: one law *(my call)*
All bodies except the Sun are drawn with **radius = 22 u × (D / D_Jupiter)^0.4**. The Sun stays 24 (it would fill Mercury's orbit on any shared scale), so the Sun is still the largest body (L35) and every size keeps its true order (L36). Ganymede > Titan > Mercury comes out true.

| Body | Drawn radius (u) | Today |
|---|---|---|
| Sun | 24 (exception) | 24 |
| Jupiter | 22.0 | 16 (Portfolio) |
| Saturn | 20.6 | 15 |
| Uranus | 14.6 | 13.5 |
| Neptune | 14.4 | 13 |
| Earth | 8.4 | 12 |
| Venus | 8.2 | — |
| Mars | 6.5 | 8 |
| Mercury | 5.7 | 5.7 |
| Ceres | 2.95 | 3.5 |
| Ganymede / Titan / Callisto / Io / Moon / Europa / Triton | 5.9 / 5.8 / 5.7 / 5.1 / 5.0 / 4.8 / 4.5 | — |
| Phobos / Deimos | 0.66 / 0.52 (mean radius, non-spherical shape) | — |

Mercury at 5.7 leaves a 5.6 u gap from the Sun's surface at perihelion, which sets the exponent. Each scan states the body's own enlargement ("DRAWN 1,710× TRUE SIZE" for Earth). The single `SIZE_ENLARGEMENT` constant gives way to the law. Gravity wells keep their size² rule (L36), so Earth's well shrinks to about half; the builder retunes nothing in the well law but checks that the slingshot badge is still earnable at Earth and Jupiter. The Sun's well (radius 110 today) must end inside Mercury's perihelion; the builder sets it, keeping a sun-skim slingshot possible.

### 5.3 Moons (insets)
- **Roster rule** *(my call)*: every moon larger than 2,500 km (the Moon, Io, Europa, Ganymede, Callisto, Titan, Triton), plus Phobos and Deimos because Mars is a destination and they are famous. The logbook says "major moons only".
- **Each moon system is one uniform inset:** real distance ratios within the system (so Io : Europa : Ganymede keeps the 1:2:4 Laplace resonance), one distance scale per system, chosen so the innermost moon clears the planet (Saturn: outside the A ring at 2.27 R) by at least 1.5 × (planet radius + moon radius). Real orbit planes: the Galileans, Titan, Phobos and Deimos in their planet's equator; the Moon about 5.1° to the ecliptic; Triton retrograde, 157° to Neptune's equator. Each system's GM is set so Kepler III holds inside the inset on the close-up clock (§5.4).
- **Moon sizes follow the planets' law (owner, 2026-10-20):** the Moon is drawn 0.6× Earth (real 0.27×) and the Galileans about ¼ of Jupiter; the logbook's size sentence covers moons too.
- All moons are tidally locked (L11). Triton is the one captured, retrograde moon (L12). The old fictional moons are removed.
- Phobos and Deimos are irregular, built from NASA public-domain shape models (or Blender generated to them), with a tri cap fitting the budget.

### 5.4 Spin and the close-up clock *(my call)*
- At the orbit clock, Earth would spin once a second. Spins and moon insets therefore run on one shared **close-up clock, 1 s ≈ 1.2 h**, which keeps the real ratios: Earth's day 20 s, Jupiter 8.3 s, Mars 20.5 s, Phobos's orbit 6.4 s, Io 35 s, the Moon 9 min. Venus (−243 d) barely turns, retrograde; Mercury turns three times per two of its orbits only in ratio, not in sync with the orbit clock. This replaces today's separate moon-inset clock; it is one disclosed convention (L40).
- **Moon phases, moon arrangements and planets' day sides are illustrative (owner, 2026-10-20):** they do not follow the orrery date; only heliocentric positions do. The logbook and each scan say so in one line ("Moons and spins run on a close-up clock and are illustrative").
- **Poles:** each body's spin axis points at its IAU pole (RA, Dec at J2000, converted to the ecliptic frame) and stays fixed in space through the orbit, so seasons are real: Uranus rolls on its side and presents a pole to the Sun at its solstices. A test checks each axis against the NASA obliquity within 0.5°.

### 5.5 Surfaces *(my call: this reverses the manifest's "NASA images cited only, never shipped")*
- Ship maps derived from **NASA/USGS/JPL public-domain global mosaics** where a true-colour (or true-grey) global map exists:
  - Earth: Blue Marble Next Generation, plus a separate cloud layer and Black Marble night lights.
  - The Moon: LRO / SVS CGI Moon Kit.
  - Mercury: MESSENGER MDIS global mosaic.
  - Mars: Viking colourised global mosaic (USGS).
  - Ceres: Dawn FC global mosaic.
  - Jupiter: Cassini global map (PIA07782, the one retired in 2026-10).
  - Saturn: a Cassini global map.
  - Io, Europa, Ganymede, Callisto: USGS Galileo/Voyager mosaics.
  - Triton: Voyager 2 USGS mosaic, with its unimaged parts filled by a seeded generator matched to it.
- Where no true-colour global map exists, a seeded generator calibrated to the body's geometric albedo is judged in turntables next to the cited NASA image (the C1 method):
  - Venus: featureless cream cloud deck, faint banding.
  - Uranus: pale cyan.
  - Neptune: the existing map, its streak note corrected to methane ice, which is right at 30 AU.
  - Titan: orange haze.
- A download script pins each source URL and SHA-256 and writes the processed map into `assets-src` with its provenance row. Maps are scaled in linear light to the body's albedo on the scene scale (the existing 0.177 × geometric rule). The P3 dark-surface curve is re-anchored to Earth's new map median; the builder recalibrates γ by the same method.
- Size budgets follow the asset-pack tiers. 4K maps go to desktop only, as today.
- **Rings and atmospheres:**
  - Saturn's rings keep today's real profile, in Saturn's equator, so the ring opening changes over its 29.5-year orbit.
  - Uranus gets its narrow dark ε ring, faint.
  - Earth loses its ring.
  - Atmosphere rims: Earth (blue, as today), Venus (thick haze), Mars (thin), Titan (orange haze), plus the giants' existing rims.
  - Io keeps a faint glow on its hot spots, visible only on the night side or in eclipse (L33).
- The probe model, the hero ship and the stations are unchanged.

## 6. Scale, flight and rendering (Phase 1)

### 6.1 Bounds
- `SYSTEM_RADIUS` 480 → **3,600** (31.3 AU). Neptune's aphelion (3,488) plus its well plus haze padding fit inside.
- `HAZE_START` stays `SYSTEM_RADIUS − 40`.
- `VALIDATION_RADIUS` 520 → **3,800** (Worker deploy first).
- Beacon drop clamps and `beaconVisible` follow `SYSTEM_RADIUS`.
- Exposure's upper clamp is (SYSTEM_RADIUS / AU)² ≈ 980.
- The backdrop toning must keep the Milky Way band from glaring at Neptune: the near-white frame fraction at 30 AU must not exceed today's value at the old edge (0.7%); the builder picks the curve.

### 6.2 Seeing the whole system
- The far plane must cover the system's diameter (≈ 7,300 u) with no z-fighting on any planet, cloud shell, ring or orbit line from anywhere inside the edge. The builder spikes, in this order:
  1. a reversed depth buffer, if the post-processing chain supports it;
  2. a logarithmic depth buffer;
  3. scaled-space impostors for distant bodies, with corrected sun direction.
  The builder picks by measured program count (must stay within 79/84) and frame cost.
- A body smaller than ~2 px on screen is still drawn as a dot of its sunlit colour, so from Earth the outer planets read as wandering points along the ecliptic, as they do in a real sky.
- Orbit lines are true ellipses in their planes, readable from anywhere: constant screen width, still exposure-compensated. Perihelion and aphelion get small ticks.

### 6.3 Long-range cruise *(my call; replaces "make the tank bigger")*
- Warp's top speed grows with the free distance around the ship: v = 39 × clamp(d_free / 60, 1, 12) u/s.
  - d_free is the distance to the nearest body surface (Sun, planets, Ceres, moons, landmarks, probes) **or to the edge**, whichever is nearer.
  - Near anything it is today's 39 u/s. In empty interplanetary space it reaches up to 468 u/s (8,100 km/s, 2.7% of light speed; L39 holds, and the HUD shows it).
- As a body nears, the limit falls and the ship decelerates smoothly (like a supercruise brake), with a bounded deceleration, so arrivals stay controlled and nobody tunnels through a planet.
- Fuel drain per second is unchanged. Earth → Neptune ≈ 10–20 s on well under one tank; Earth → Mars stays a short hop.
- The constants are the builder's to tune against these acceptance numbers. The return burn at the edge must keep the worst overshoot under 100 u at full cruise speed (inside `VALIDATION_RADIUS`).

### 6.4 Everything else that scales
- **Crystals:** stay within r ≤ 480 (the inner system, where visitors spend their time) *(my call)*.
- **Radar:** range unchanged; planets beyond it rim-clamp, as today.
- **System chart:** draws real ellipses top-down from ecliptic north with the Sun at the focus, the planets at their positions for the orrery date, an inner-system inset (to Jupiter) because Mercury is 1.3% of Neptune's distance, and the date.
- **HUD:** `SECTOR.RANGE` follows the new size.
- **Keep-outs and clearance:** convoy, jellyfish, world-event and crystal keep-outs read live body positions, as today. The clearance helpers (`tests/helpers/worldRules.ts`, `clearance.ts`) sweep ellipses instead of circles.
- **Fixed landmarks** (career station and trail, shipyard, gate, portal, buoys, probe homes and remote spots, the e2e deep-space point): re-checked against every swept orbit plus wells and moon systems. One that fails moves minimally, and the move is recorded in the spec's ledger. Probes stay inside r ≤ 480.

## 7. Charting, titles, live sky (Phase 1)

- "WORLDS CHARTED n/5" → **"WORLDS CHARTED n/9"** (the 8 planets + Ceres; Earth counts). `CHART_TOTAL` derives from the roster count, not a literal.
- Migration of `fitz-charted`: w-rock→mercury, w-ringed→saturn, w-tilted→uranus, w-blue→neptune, w-dwarf→ceres.
- A pilot who held all five old worlds keeps CARTOGRAPHER and AURUM permanently through a stored legacy flag, even before charting the four new ones. Their wire `ch` reports the new total, so others see the title.
- **The Worker accepts the AURUM plume when `ch` equals the new total or the legacy 5.** Old cached clients (asset-pack service worker) therefore keep working. The legacy-5 rule is commented with a removal condition.
- Deploy order: Worker first (new `VALIDATION_RADIUS`, the dual plume rule), a live two-socket check, then the site merge.
- Any other stored state keyed by the old planet ids (logbook entries, scans) is migrated, never dropped.

## 8. Laws document (both phases)

`docs/UNIVERSE-RULES.md` is rewritten for the real system:
- P2 becomes "This is the Solar System".
- P3 lists the conventions with numbers: the size law, the orbit clock, the close-up clock (spins + moon insets), the dark-surface curve, and the Sun's size exception.
- L5 planets on ellipses *(tested)*.
- L9: Venus and Uranus spin backwards, real.
- L10: near-coplanar, the real inclinations *(tested against JPL)*.
- L14: Saturn's real rings; Earth has none.
- L15: Trojans *followed*.
- L18: the edge at 31.3 AU.
- L35/L36: the size law *(tested)*.
- L42: each body sits at its real orbit.
- The units table gains the cruise numbers.

`tests/universeRules.test.ts` is rewritten to assert these: positions match JPL's approximate method faithfully implemented (an independent reference implementation of §4.2, to 1e-6 AU, at sample dates from 1000 to 2900 AD), plus a sanity check against a handful of JPL Horizons heliocentric vectors stored as fixtures, each within the error bound JPL publishes for Table 2a for that planet *(my call: "right for the date" means NASA's approximate method done exactly, not a higher-precision theory; the error is invisible at game scale)*, Kepler III within 0.2%, prograde, obliquities, size law and order, and the Sun the largest.

## 9. Delivery

One branch, two phases, one PR (#40) and one changelog entry, as with PR #29 *(my call)*.
- **Phase 1 "Real orbits":** frame and `PROGRADE`, elements, date and clock, Venus added, ids, names, sizes, bounds, depth, cruise, belt/Trojans/comets, clearance, charting and Worker, laws doc part 1.
  - In this phase the bodies wear today's maps, recoloured only where a leftover would break an anti-goal (no violet Mars, no cyan Jupiter, no ring on Earth). So Phase 1 could ship alone if the owner wants it sooner.
- **Phase 2 "Real faces":** NASA maps, moons, poles and spins, oblateness, rings and atmospheres, laws doc part 2.

Owner checks before merge: in-game screenshots of the inner system, Jupiter with its four moons, Saturn, and a full-system shot with orbit lines; a short flight Earth → Neptune; the HUD date against a planetarium app.

## 10. Calls I made (owner to confirm or overrule)

1. **Today's real positions at page load**, then the fast clock, with the orrery date on screen (§4.4).
2. **Size law** radius ∝ D^0.4 with Jupiter 22 and the Sun 24: Earth shrinks from 12 to 8.4; the Sun is only 1.09× Jupiter (§5.2).
3. **Long-range cruise** (speed grows with free space, up to 12× warp) instead of a bigger tank (§6.3).
4. **Shipping NASA public-domain maps**, reversing the manifest rule (§5.5).
5. **The halo becomes Jupiter's Trojans; the fictional comets become Encke and 67P** (§4.7).
6. **Moon roster:** moons over 2,500 km, plus Phobos and Deimos (§5.3).
7. **One close-up clock**, 1 s ≈ 1.2 h, for spins and moons (§5.4).
8. **Spawn stays fixed**; Earth may be anywhere on its orbit at load (§3).
9. **One PR, two phases** (§9).

**Owner, 2026-10-20:** keep all nine. Ship NASA maps (#4 confirmed). Moons follow the planets' size law. Moons and spins are illustrative, disclosed. Accuracy of "right for the date" means JPL's approximate method done exactly (§8) *(my call, from the builder check)*.
