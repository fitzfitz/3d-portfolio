# Universe Rules

How the flight-sim universe relates to the real one. Every rule here either
**follows** a real law, or **breaks** it on purpose for a stated reason. If you
add something that moves, check it against this page first. If it breaks a
rule, add a B entry below and say why.

`tests/universeRules.test.ts` enforces R1–R3. It measures directions with
real three.js transforms rather than trusting the signs in the code.

## Rules we follow

### R1. One sun, one law: Kepler's third law

> "The squares of the orbital periods of the planets are directly proportional
> to the cubes of the semi-major axes of their orbits." (NASA)

    T = 2π √(a³ / GM)        ω = √(GM / a³)

Every orbit around the sun takes its speed from one value, `GM_SUN`
(`src/constants.ts`), anchored so Ruangrapi keeps its 420 s year. No orbit
around the sun may have a hand-picked speed. Use `sunOmega(r)` for circles and
`keplerPeriod(a, GM_SUN)` for ellipses (`src/utils/kepler.ts`).

| Body | Distance (a) | Period | Where |
|---|---|---|---|
| Asteroid belt | 40–70 | 86–199 s | `AsteroidBelt.tsx` |
| Polar halo | 80–95 | 244–315 s | `AsteroidBelt.tsx` |
| Ruangrapi | 115 | 420 s (anchor) | `PLANET_ORBITS` |
| Comet 1 | 140, e 0.62 | 564 s | `src/data/comets.ts` |
| Portfolio | 150 | 626 s | `PLANET_ORBITS` |
| Comet 2 | 155, e 0.65 | 657 s | `src/data/comets.ts` |
| Fuxx | 185 | 857 s | `PLANET_ORBITS` |

Before 2026-10-16 each group was tuned on its own. The outer planets were 18%
and 30% too fast, the belt about 4× too slow (its outer edge lapped slower than
a planet farther out), and the comets 2.5–3.3× too fast.

### R2. Everything turns the same way

> "All of the planets circle the Sun in the same direction, and their orbits
> all lie in nearly the same plane." (NASA)

The planets inherit this from the disk they formed in, and so does their
spin. Only Venus and Uranus spin backwards. Every orbit around the sun, every
planet spin and every regular moon orbit is **prograde**.

In code, `orbitPosition` with a positive `angularSpeed` runs clockwise seen
from +Y, which is a *negative* `rotation.y`. Any spin or moon orbit driven
through `rotation.y` multiplies by `PROGRADE` (−1). Before 2026-10-16 all three
planets spun backwards.

Small bodies are exempt: belt rocks and loose asteroids tumble every which
way, as real ones do.

### R3. Moons: Kepler around their planet, tidally locked

- **Speed:** Kepler's third law around the planet with one shared
  `GM_PLANET`, since all three planets share `PLANET_SIZE`. Anchored so
  Ruangrapi's moon keeps 0.4 rad/s. Moons live in `src/data/moons.ts`;
  `moonOrbitSpeed()` derives the speed, which is never stored.
- **Tidal lock:** "All the solar system's large moons are tidally locked with
  their planets" (NASA). Each takes exactly as long to spin as to orbit, so it
  shows one face. `OrbitingMoon` gives the mesh no spin of its own: riding the
  orbit group is the lock.
- **Direction:** a moon orbits the way its planet spins, unless it is
  `captured`. Neptune's Triton orbits backwards, which is the main evidence that
  it was caught from the Kuiper Belt. The two ice moons (Portfolio's, Fuxx's)
  are captured; that is two moons out of five, one per planet that has two.

### R4. Comets: Kepler's first and second laws

Ellipses with the sun at a focus, fast at perihelion and slow at aphelion
(`keplerPosition`). With R1 they reach about 3.2 u/s at perihelion and
0.7 u/s at aphelion. Their look follows
`docs/superpowers/specs/2026-07-19-realistic-comet-spec.md`: coal-dark nucleus,
activity rising near the sun, ion tail straight away from the sun, curved dust
tail. Slower comets give straighter dust tails, as real slow comets have.

### R5. One sun lights everything

A single sun light at the origin: every planet has a day side, a night side
and a terminator facing the sun
(`docs/superpowers/specs/2026-07-19-realistic-planets-spec.md`).

## Rules we break on purpose

| # | Real universe | Ours | Why |
|---|---|---|---|
| B1 | Planets are specks across enormous distances; the Sun–Earth gap is ~107 Sun diameters. | Compressed: planets 16 across, orbits 115–185 out. | A portfolio has to be flyable in minutes, and every landmark you can see must be reachable. |
| B2 | The Sun's radius is ~10× Jupiter's. | Solid core 8, planets 16. The 52-wide corona is what reads as the sun's size. | The sun already looks right and the owner likes it. A bigger core crowds the belt (r 40) and changes god-ray occlusion. |
| B3 | Light falls off with distance squared: Mars gets 43% of Earth's sunlight (NASA fact sheet). | `decay={0}`: the same light everywhere. | At real falloff Fuxx would get 39% of Ruangrapi's light and read as murky. Projects must be readable. |
| B4 | Planet orbits lie within 7° of one plane (Mercury 7.0°, Pluto 17.2°). | 20°, −40°, 60°; the halo ring is tilted 75°. | So the whole volume is worth flying through, not one flat disc (full-volume solar system design). |
| B5 | Years take months to centuries. | Years take minutes, moon months take seconds. | Motion has to be visible during a visit. Ratios follow R1 and R3; only the clock is fast. |
| B6 | Gravity alone steers a coasting ship. | Flight gravity is its own layer (`gravityWell.ts`), with its own strengths, a lenient climb-out and a fling. | The damped flight model erases plain gravity; its three departures are listed in that file. |
| B7 | Anything not orbiting falls into the sun. | Stations, the shipyard, the gate, the portal, buoys, beacons, shards, fuel crystals and the hero asteroids hold still. | Destinations need fixed places for jumps, radar and keys. Read it as station-keeping. |
| B8 | Space has no edge. | Space wraps around (±250 on every axis) behind a nebula haze. | Keeps the pilot near the content. |
| B9 | A passing comet bends around the sun. | The world-event visitor flies a straight line at 22 u/s. | A short close pass by a planet, where the sun's bend would be tiny. |
| B10 | — | Freighters and the jellyfish follow scripted routes. | Powered ships and a creature, not coasting bodies. |

## Adding something

- **It orbits the sun:** take its speed from `sunOmega(r)` or `keplerPeriod(a, GM_SUN)`.
- **It orbits a planet:** add a row to `MOONS`.
- **It spins or orbits through `rotation.y`:** multiply by `PROGRADE`.
- **It breaks a rule:** add a B row with the reason.
- **Always:** keep `tests/universeRules.test.ts` green, and extend it if the new
  thing has its own table.

## Sources

- NASA, [Orbits and Kepler's Laws](https://science.nasa.gov/resource/orbits-and-keplers-laws/): first, second and third laws.
- NASA, [Planetary Systems](https://science.nasa.gov/universe/stars/planetary-system): same direction, nearly one plane, formed from a disk.
- NASA NSSDC, [Planetary Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) and [notes](https://nssdc.gsfc.nasa.gov/planetary/factsheet/planetfact_notes.html): orbital inclinations.
- NASA NSSDC, [Mars Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html): solar irradiance 586.2 vs 1361.0 W/m², a 0.431 ratio.
- NASA, [Tidal Locking](https://science.nasa.gov/moon/tidal-locking/): synchronous rotation; all large moons are locked.
- Scientific American, [Why Venus Spins the Wrong Way](https://www.scientificamerican.com/article/why-venus-spins-the-wrong/): retrograde rotation (Venus and Uranus).
- The Planetary Society, [Triton](https://www.planetary.org/worlds/triton): retrograde orbit, likely a captured Kuiper Belt object.
- Comet and planet appearance: the sources listed in the two realistic-body specs under `docs/superpowers/specs/`.
