# Real Solar System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fictional star system with the real Solar System: the planets and Ceres on JPL Keplerian orbits at their real positions for an on-screen orrery date, real bodies, moons, maps and spins, flyable from Mercury to Neptune.

**Architecture:** A pure ephemeris module (JPL "Approximate Positions of the Planets", Table 2a/2b, plus SBDB osculating elements) turns an orrery Julian date into heliocentric J2000-ecliptic positions. A world mapping (x, z, −y)·AU then places them in the scene. One roster (`SOLAR_BODIES`) replaces both `planets` (which was joined to projects) and `WORLDS`. One data-driven renderer (`SolarBodies.tsx`) replaces the planet half of `SpacePlanets.tsx` and all of `SpaceWorlds.tsx`. Every consumer reads positions from `bodies`, which `updateBodies` writes each frame.

**Tech Stack:** TypeScript, React 19, @react-three/fiber 9, three 0.185, @react-three/postprocessing 3, zustand 5, vitest, puppeteer-based e2e (`tests/e2e/*.probe.mjs`), Blender 5.1.2 headless (assets), Node scripts (textures), Cloudflare Worker `beacon-api`.

**Spec:** `docs/archive/specs/2026-10-20-real-solar-system-design.md` (owner-approved 2026-10-20). Read it before any task; section numbers below (§n) refer to it.

## Global Constraints

- Branch `feat/real-solar-system`, one PR **#40**, one changelog entry `pr: 40` (§9).
- Units unchanged: `AU = 115`, `YEAR_S = 420`, `GM_SUN = keplerGM(AU, YEAR_S)`. Orrery rate `365.25 / 420` days per game second (§3, §4.4).
- World frame = J2000 ecliptic via the proper rotation (x, y, z)_world = (x_ecl, z_ecl, −y_ecl) × AU; `PROGRADE = +1` (§4.3).
- Planet elements: JPL Table 2a + Table 2b extra terms, held at their 3000 AD values past 3000 AD (§4.1). Ceres and comets: SBDB osculating elements, fixed.
- Size law: radius = 22 × (D / 142,984 km)^0.4 for every body and moon; the Sun stays `SUN_RADIUS = 24` (§5.2).
- Close-up clock: `CLOSE_UP_HOURS_PER_SECOND = 1.2` for spins and moon insets; moons and spins are illustrative and say so (§5.4).
- `SYSTEM_RADIUS = 3600`, `HAZE_START = SYSTEM_RADIUS − 40`, `VALIDATION_RADIUS = 3800` (§6.1). The Worker deploys before the site merge, with the owner's go-ahead (§7).
- Cruise: v = 39 × clamp(d_free / 60, 1, 12) u/s (§6.3). Fuel constants unchanged.
- New body ids `mercury venus earth mars ceres jupiter saturn uranus neptune`; moon ids `moon phobos deimos io europa ganymede callisto titan triton`. `ruangrapi / portfolio / fuxx` remain **project/probe ids only** (§5.1).
- No stored progress lost: `fitz-charted` legacy ids map w-rock→mercury, w-ringed→saturn, w-tilted→uranus, w-blue→neptune, w-dwarf→ceres. A pilot with all five keeps CARTOGRAPHER and AURUM (§7).
- Perf ceilings in `docs/PERF-BUDGETS.md` hold, or are re-baselined deliberately and recorded there (programs fixed at 79/84 must not grow).
- Asset rules: seeded and reproducible generators. Every shipped NASA-derived file has a `assets-src/MANIFEST.md` row with source URL and SHA-256. Photoreal look (§5.5).
- **Subagents must not install packages** (no `npm i`, `pnpm`, `npx` that installs). They must not kill processes by name (no `pkill`, no `killall`, no `kill -9` by name); stop only a PID they started themselves.
- Unit tests: `npx vitest run <file>`; all: `npm test`. Types: `npx tsc -b`. Lint: `npm run lint`. One e2e probe: `node tests/e2e/run-one.mjs <name>` (e.g. `transition`); all: `npm run test:e2e` (close Playwright tabs and stop any dev server on port 5199 first).
- SDD ledger: `.superpowers/sdd/2026-10-20-real-solar-system/progress.md` records every ruling, landmark move, spike result and re-baseline.

## Review Focus

1. **Page left open for days:** the orrery date passes 3000 AD (about 4.8 wall days). Positions must stay finite and keep moving on held elements; nothing returns NaN or freezes. Test in Task 1.
2. **Malformed or hostile orrery override:** `?orrery=9999-99-99`, `?orrery=abc`, or a non-finite `__FITZ_ORRERY_JD__` must fall back to "now" without throwing. Test in Task 2.
3. **Returning pilot with old storage:** `fitz-charted` holds the five `w-*` ids and the plume is AURUM. The new build keeps the title and the equipped plume, and the logbook shows 5/9 charted with the title. Test in Task 8.
4. **Head-on warp at full cruise into a giant:** the ship must never enter the body and must be at ≤ 39 u/s by 60 u from its surface. Test in Task 10.
5. **A cached old client (ch 5, AURUM) in the room with new clients:** its plume survives server coercion, and new clients still see it as a cartographer. Test in Task 8.

---

## Phase 1: Real orbits

### Task 1: Ephemeris core

**Files:**
- Create: `src/utils/ephemeris.ts`, `src/data/jplElements.ts`, `src/data/smallBodies.ts`
- Create: `tests/ephemeris.test.ts`, `tests/fixtures/horizons.json`

**Interfaces:**
- Produces:
  - `JD_J2000 = 2451545.0`
  - `jdFromUnixMs(ms: number): number` (ms/86 400 000 + 2440587.5); `unixMsFromJd(jd: number): number`
  - `solveKepler(M: number, e: number): number` (radians)
  - `interface Ecl { x: number; y: number; z: number }` (AU, J2000 ecliptic)
  - `interface JplPlanetElements { a: [number, number]; e: [number, number]; I: [number, number]; L: [number, number]; varpi: [number, number]; Omega: [number, number]; extra?: { b: number; c: number; s: number; f: number } }` ([value, rate per Julian century], degrees and AU)
  - `interface OsculatingElements { epochJd: number; a: number; e: number; i: number; node: number; argPeri: number; M0: number; nDegPerDay: number }`
  - `planetEcliptic(el: JplPlanetElements, jd: number, out: Ecl): Ecl`; `osculatingEcliptic(el: OsculatingElements, jd: number, out: Ecl): Ecl`
  - `eclipticToWorld(v: Ecl, out: { x: number; y: number; z: number }): typeof out` (× AU, (x, z, −y))
  - `orbitShape(el: JplPlanetElements | OsculatingElements, jd: number): { a: number; e: number; i: number; node: number; argPeri: number }` (AU and radians, for drawing and clearance)
  - `visVivaKmS(rAU: number, aAU: number): number` (29.7847 × √(2/r − 1/a))
  - `JPL_PLANETS: Record<"mercury"|"venus"|"earth"|"mars"|"jupiter"|"saturn"|"uranus"|"neptune", JplPlanetElements>`; `JPL_HELD_AFTER_T = 10` (centuries past J2000, the 3000 AD hold)
  - `CERES, ENCKE, CHURYUMOV: OsculatingElements`

- [ ] **Step 1: Fill `jplElements.ts`** from https://ssd.jpl.nasa.gov/planets/approx_pos.html Table 2a (all eight rows; Earth = "EM Bary") and Table 2b (Jupiter–Neptune b, c, s, f). Copy every digit from the page itself, not from a summary. Cite the URL and fetch date in the header. f·T is in degrees (check against the page's linked document "keplerian elements" PDF and say what it states in a comment).
- [ ] **Step 2: Fill `smallBodies.ts`** from `https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=<id>&full-prec=1` for `1` (Ceres), `2P`, `67P`. Use the epoch and elements as returned; n in deg/day. Put the fetch date in a comment. The spec quotes Ceres at epoch JD 2461200.5: a 2.765552595, e 0.079692295, i 10.588028°, Ω 80.248627°, ω 73.294215°, M 274.419346°.
- [ ] **Step 3: Fetch Horizons fixtures** into `tests/fixtures/horizons.json`: heliocentric ecliptic J2000 position vectors (AU), via `https://ssd.jpl.nasa.gov/api/horizons.api` (`EPHEM_TYPE=VECTORS`, `CENTER=@10`, `REF_PLANE=ECLIPTIC`, `REF_SYSTEM=J2000`, `OUT_UNITS=AU-D`). Targets: 199, 299, 3 (EM barycentre), 499, 599, 699, 799, 899, and `1;` (Ceres). Epochs: 2026-10-20 00:00 TDB and 2100-01-01 00:00 TDB. Store each request URL next to its numbers.
- [ ] **Step 4: Write the failing tests** in `tests/ephemeris.test.ts`:
  - `solveKepler` residual: for e ∈ {0, 0.2056, 0.85, 0.967} and 64 M values in (−π, π], |E − e·sin E − M| < 1e-12.
  - **Reference agreement:** a plain transcription of JPL's step list inside the test (degrees throughout, no shared code) agrees with `planetEcliptic` to 1e-9 AU for every planet at JD of 1000-01-01, 1500-01-01, J2000, 2026-10-20 (2461333.5), 2500-01-01 and 2900-01-01.
  - **Horizons sanity:** for each fixture, |Δ| ≤ r·√(λ_err² + φ_err²)(rad) + ρ_err. Bounds per planet, in arcsec / arcsec / 1000 km: Mercury 20/15/1, Venus 40/30/8, EM 40/15/15, Mars 100/40/30, Jupiter 600/100/1000, Saturn 1000/100/4000, Uranus 2000/30/8000, Neptune 400/15/4000. Ceres within 0.01 AU at 2026-10-20.
  - **Kepler III:** for each planet, the period from the L rate (36 525 × 360 / L̇ days) agrees with 365.25 × a^1.5 days within 0.2%.
  - **Frame:** `eclipticToWorld` sends (1,0,0)→(115,0,0), (0,1,0)→(0,0,−115), (0,0,1)→(0,115,0). Every planet's world-frame angular momentum r × v (central difference over 1 day) has a positive y component (prograde about +Y).
  - **Held elements (Review Focus 1):** at JD of 3500-01-01 every planet's position is finite. It equals the position computed with T clamped to `JPL_HELD_AFTER_T` and M advanced by the L rate. Two dates a day apart differ.
- [ ] **Step 5: Run** `npx vitest run tests/ephemeris.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 6: Implement `ephemeris.ts`** following §4.2 exactly: Newton iteration to |ΔE| ≤ 1e-6° (the tests' 1e-12 rad residual sets the real stopping point), rotations ω → I → Ω. Past `JPL_HELD_AFTER_T`, clamp T for every element except L, which keeps advancing at its rate. Allocation-free when `out` is given.
- [ ] **Step 7: Run** `npx vitest run tests/ephemeris.test.ts`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(ephemeris): JPL Table 2a planets and SBDB small bodies, J2000 ecliptic to world`.

### Task 2: Orrery clock

**Files:**
- Create: `src/utils/orreryClock.ts`, `tests/orreryClock.test.ts`
- Modify: `src/debug/bridge.ts` (add `orrery`), `tests/e2e/harness.mjs` (`withPage` pins the date)

**Interfaces:**
- Consumes: `jdFromUnixMs`, `unixMsFromJd` (Task 1).
- Produces:
  - `ORRERY_DAYS_PER_SECOND = 365.25 / YEAR_S`
  - `orreryEpochJd(): number`; `setOrreryEpochJd(jd: number): void`
  - `orreryJd(gameSeconds: number): number` (epoch + seconds × rate)
  - `formatOrreryDate(jd: number): string` ("YYYY-MM-DD", UTC; years beyond 9999 are clamped to the 3000 AD hold, so this never sees them)
  - `parseOrreryParam(search: string): number | null` (`?orrery=YYYY-MM-DD` → JD at 00:00 UTC; anything not a real calendar date → null)
  - `ORRERY_TEST_JD = 2461333.5` (2026-10-20 00:00 UTC), exported for tests and e2e
  - `window.__fitz.orrery = { epochJd: orreryEpochJd, setEpochJd: setOrreryEpochJd }`

- [ ] **Step 1: Write failing tests:**
  - `jdFromUnixMs(Date.UTC(2000,0,1,12)) === 2451545`
  - `formatOrreryDate(2461333.5) === "2026-10-20"`
  - `orreryJd(420) - orreryJd(0) === 365.25`
  - `parseOrreryParam("?orrery=2026-10-20") === 2461333.5`
  - **Review Focus 2:** `parseOrreryParam` returns null for `"?orrery=9999-99-99"`, `"?orrery=2026-02-30"`, `"?orrery=abc"` and `""`. Initial epoch precedence is a finite `globalThis.__FITZ_ORRERY_JD__`, then the URL parameter, then `Date.now()`; a non-finite global (NaN, Infinity, a string) is ignored.
- [ ] **Step 2: Run** `npx vitest run tests/orreryClock.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The epoch is resolved once at import, by an exported `resolveInitialEpoch(global: unknown, search: string, nowMs: number): number` so tests can call it directly. The TT−UTC offset (about 69 s) is ignored; write that as a one-line comment.
- [ ] **Step 4: Pin e2e:** in `withPage`, always register `window.__FITZ_ORRERY_JD__ = 2461333.5` with `evaluateOnNewDocument` before any probe `initScript`, so a probe can override it.
- [ ] **Step 5: Run** `npx vitest run tests/orreryClock.test.ts tests/debugBridge.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(orrery): real-date epoch at load, fast clock, pinnable for tests`.

### Task 3: Roster, moon insets and size law (data only)

**Files:**
- Create: `src/data/bodyIds.ts` (import-free: it is shipped to the Worker), `src/utils/sizeLaw.ts`, `src/data/solarSystem.ts`, `src/data/solarMoons.ts`
- Create: `tests/sizeLaw.test.ts`, `tests/solarSystem.test.ts`, `tests/solarMoons.test.ts`

**Interfaces:**
- Consumes: `JPL_PLANETS`, `CERES`, `JplPlanetElements`, `OsculatingElements`, `orbitShape` (Task 1); `ORRERY_TEST_JD` (Task 2).
- Produces:
  - `bodyIds.ts`:
    - `BODY_IDS = ["mercury","venus","earth","mars","ceres","jupiter","saturn","uranus","neptune"] as const`; `type BodyId`; `isBodyId(id: string): id is BodyId`
    - `LEGACY_WORLD_TO_BODY: Readonly<Record<"w-rock"|"w-ringed"|"w-tilted"|"w-blue"|"w-dwarf", BodyId>>`
    - `LEGACY_CHART_TOTAL = 5`
  - `sizeLaw.ts`: `SIZE_LAW_EXPONENT = 0.4`, `SIZE_LAW_JUPITER_R = 22`, `JUPITER_DIAMETER_KM = 142_984`, `drawnRadius(diameterKm: number): number`, `enlargement(diameterKm: number): number` (drawn radius in km ÷ true radius, using `KM_PER_UNIT`)
  - `solarSystem.ts`:
    - `interface SolarBody`, with fields:
      - `id: BodyId; name: string; ordinal: string` ("3RD PLANET" / "DWARF PLANET")
      - `diameterKm; size` (= `drawnRadius`); `flattening; obliquityDeg; pole: { raDeg; decDeg }; rotationHours` (negative = retrograde)
      - `orbit: { kind: "jpl"; el: JplPlanetElements } | { kind: "osculating"; el: OsculatingElements }`
      - `geometricAlbedo; bondAlbedo; map: string; tint?: string; texelMedianLinear; color`
      - `look: { clouds?: true; nightLights?: true; rings?: "saturn" | "uranus"; atmosphere?: { color: string; thickness: number; intensity: number; dusk?: string }; limb?: number }`
      - `facts: { moons: number; dayHours: number; yearDays: number; meanTempC: number }`
      - `hint: string`
    - `SOLAR_BODIES: readonly SolarBody[]` (in BODY_IDS order); `bodyById(id: BodyId): SolarBody`; `BODY_COUNT`
    - `BODY_REACH: readonly { key: BodyId; size: number; reach: number }[]` (reach = rings' outer edge for Saturn and Uranus, else size)
  - `solarMoons.ts`:
    - `MOON_IDS`; `type MoonId`; `CLOSE_UP_HOURS_PER_SECOND = 1.2`
    - `interface SolarMoon { id: MoonId; name: string; parent: BodyId; diameterKm; size; aKm; periodHours; plane: "equator" | "ecliptic"; inclinationDeg; retrograde: boolean; map: string; shape?: "phobos" | "deimos" }`
    - `SOLAR_MOONS: readonly SolarMoon[]`
    - `insetScale(parent: BodyId): number`; `insetDistance(m: SolarMoon): number` (u from the parent's centre); `insetPeriod(m): number` (s); `insetGM(parent: BodyId): number`; `moonSystemReach(parent: BodyId): number` (outermost insetDistance + that moon's size)

Data to enter, with the source cited per file:
- **Bodies:** NSSDC fact sheet (diameter, rotation period, obliquity, moons, mean temperature, period). IAU WGCCRE 2015 (Archinal et al. 2018) poles. Bond and geometric albedos from the NSSDC sheets (Mercury 0.068/0.142, Venus 0.76/0.689, Earth 0.306/0.434, Mars 0.250/0.170, Jupiter 0.343/0.538, Saturn 0.342/0.499, Uranus 0.300/0.488, Neptune 0.290/0.442, Ceres 0.034/0.09). Flattening: Earth 0.00335, Mars 0.00589, Jupiter 0.06487, Saturn 0.09796, Uranus 0.02293, Neptune 0.01708, others 0.
- **Interim maps until Task 12** (§9, anti-goals):
  - mercury `w-rock`; venus none (`tint #e6d8b4`); earth `ruangrapi` with clouds and night lights; mars `w-rock` tinted `#b5653a`; ceres `w-dwarf`; jupiter `w-ringed` (no rings); saturn `w-ringed` (rings "saturn"); uranus `w-tilted`; neptune `w-blue`.
  - `texelMedianLinear` copied from the map's current value.
- **Moons** (a km / sidereal period h / diameter km):
  - Moon 384 400 / 655.72 / 3474.8 (plane: ecliptic, 5.145°)
  - Phobos 9 376 / 7.6539 / 22.5; Deimos 23 463 / 30.312 / 12.4
  - Io 421 700 / 42.459 / 3643.2; Europa 671 034 / 85.228 / 3121.6; Ganymede 1 070 412 / 171.709 / 5268.2; Callisto 1 882 709 / 400.536 / 4820.6
  - Titan 1 221 870 / 382.69 / 5149.5
  - Triton 354 759 / 141.045 / 2706.8 (retrograde, 156.885° to Neptune's equator)
  - The rest are equatorial, with their small real inclinations.
- **`insetScale`:** min(1, required / real) for the system's innermost moon. Required centre distance = max(1.5 × (planet size + moon size), Saturn only: 2.27 × size + moon size + 2), using equatorial radii in km (Earth 6378.1, Mars 3396.2, Jupiter 71 492, Saturn 60 268, Neptune 24 764). Expected: Mars 1, Earth ≈ 0.040, Jupiter ≈ 0.313, Saturn ≈ 0.126, Neptune ≈ 0.138.

- [ ] **Step 1: Write failing tests:**
  - `drawnRadius(142984) === 22`; drawn sizes within 0.05 of §5.2's table (Saturn 20.55, Uranus 14.58, Neptune 14.40, Earth 8.37, Venus 8.19, Mars 6.50, Mercury 5.70, Ceres 2.95; Ganymede 5.87, Titan 5.82, Callisto 5.67, Io 5.07, Moon 4.97, Europa 4.77, Triton 4.50, Phobos 0.66, Deimos 0.52).
  - Order by size equals order by diameter across all bodies and moons. `SUN_RADIUS` is greater than every size.
  - Mercury's perihelion (`orbitShape` at `ORRERY_TEST_JD`) × AU − `SUN_RADIUS` − Mercury's size ≥ 5.5.
  - Each body's obliquity, computed from its IAU pole against its orbit normal, is within 0.5° of `obliquityDeg` (NASA: Mercury 0.034, Venus 177.4, Earth 23.4, Mars 25.2, Jupiter 3.1, Saturn 26.7, Uranus 97.8, Neptune 28.3; Ceres ≈ 4).
  - Moons: inset periods = periodHours / 1.2. `insetGM` from each moon of a system agrees within 1%. Io : Europa : Ganymede period ratios are 1 : 2.007 : 4.044 within 0.5%. Triton is the only retrograde moon. Each innermost moon meets its required distance. Mars's scale is exactly 1.
  - `isBodyId`, `LEGACY_WORLD_TO_BODY` covers all five legacy ids, and `bodyIds.ts` has no imports (read the source and assert no `import`).
- [ ] **Step 2: Run** `npx vitest run tests/sizeLaw.test.ts tests/solarSystem.test.ts tests/solarMoons.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the four modules** with the data above. Nothing in the app imports them yet.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(roster): the nine real bodies, nine major moons, one size law`.

### Task 4: Belt, Trojan and comet models (data only)

**Files:**
- Create: `src/data/smallBodyField.ts`, `tests/smallBodyField.test.ts`
- Modify: `src/data/comets.ts` (Encke and 67P from `ENCKE`/`CHURYUMOV`), `src/utils/gravityWell.ts` (`SUN_WELL_RADIUS`)

**Interfaces:**
- Consumes: `OsculatingElements`, `osculatingEcliptic`, `JPL_PLANETS.jupiter` (Task 1); `ORRERY_TEST_JD` (Task 2); `GM_SUN`; `bodyById` (Task 3).
- Produces:
  - `interface FieldRock { el: OsculatingElements; scale: number; variant: number }`
  - `KIRKWOOD_GAPS_AU = [2.06, 2.50, 2.82, 2.95, 3.27]`; `GAP_HALF_WIDTH_AU = 0.025`
  - `makeBelt(count: number, seed: number): FieldRock[]`: a sampled in 2.1–3.3 AU outside every gap; e Rayleigh σ 0.1 capped at 0.3; i Rayleigh σ 8°; Ω, ω, M0 uniform; epoch `ORRERY_TEST_JD`; n by Kepler from `GM_SUN` in real units (n = 0.9856076686 / a^1.5 deg/day).
  - `makeTrojans(count: number, seed: number): FieldRock[]`: half at L4, half at L5. Jupiter's a at J2000; mean longitude = Jupiter's ± 60° plus uniform ±25°; e ≤ 0.15; i ≤ 30°; same n as Jupiter.
  - `BELT_COUNT = 400`, `BELT_COUNT_LOW = 200`, `TROJAN_COUNT = 160` (seeds 42 and 1337 kept)
  - `COMETS: readonly OsculatingElements[]` (Encke, 67P)

- [ ] **Step 1: Write failing tests:**
  - No belt rock has an a within `GAP_HALF_WIDTH_AU` of a gap centre, and every a is in [2.1, 3.3].
  - The e cap holds; mean i is between 6° and 11°.
  - Every Trojan's longitude difference from Jupiter at `ORRERY_TEST_JD` lies in 60 ± 25° or −60 ± 25°, and stays there 10 000 game seconds later (same mean motion).
  - The comets' elements equal SBDB's.
  - `SUN_WELL_RADIUS` < Mercury's perihelion in u (35.36). A sun-skim at r ≈ 30 still crosses `SLINGSHOT_SPEED` with the existing `stepGravity`, by the same simulation style as `tests/gravityWell.test.ts`, retuning `SUN_WELL_G` if needed.
  - The slingshot stays earnable at Earth (size 8.37) and Jupiter (size 22) under `planetWell`'s unchanged size² rule: the existing slingshot simulation, run at each body's size, crosses `SLINGSHOT_SPEED` (§5.2).
- [ ] **Step 2: Run** `npx vitest run tests/smallBodyField.test.ts tests/gravityWell.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use the repo's existing seeded RNG (the one `AsteroidBelt.tsx` uses).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(belt): Kirkwood-gapped main belt, Jupiter Trojans, Encke and 67P`.

### Task 5: Clearance on the real system, landmark moves

**Files:**
- Create: `tests/helpers/solarClearance.ts`, `tests/solarClearance.test.ts`
- Modify (only where a check fails): `src/data/probes.ts`, `src/data/destinations.ts`, `src/data/spawn.ts` (expected unchanged), career trail/buoys, shipyard and gate data, `PORTAL_POS`, ring-course gates (find with `grep -rn "gate" src/data`), `tests/e2e/deepSpacePoint.mjs`
- Delete: `tests/planetClearance.test.ts`, `tests/worldClearance.test.ts`, `tests/worldOrbitSearch.test.ts` (they guard the retired system), and the parts of `tests/helpers/worldRules.ts` / `clearance.ts` that only they use

**Interfaces:**
- Consumes: `SOLAR_BODIES`, `BODY_REACH`, `SOLAR_MOONS`, `moonSystemReach` (Task 3); `makeBelt`, `makeTrojans`, `COMETS` (Task 4); `orbitShape`, `eclipticToWorld` (Task 1).
- Produces: `sweptOrbit(shape, samples: number): Vec3[]` (world units, uniform in eccentric anomaly) and `clearanceReport(): { name: string; margin: number }[]` for the ledger.

Rules (keep today's constants: `BODY_GAP` 7, `MARGIN` 4, `HAZE_PAD` 20):
- A fixed landmark (career station, trail points, buoys, shipyard, gate, portal, the probe homes and all remote spots, the ring-course gates, `SPAWN`, the e2e deep-space point) must keep, from every swept body orbit:
  - its distance ≥ the body's well radius (size × 3.5) + the moon-system reach for a body with moons + the landmark's radius + `MARGIN`;
  - and from every swept belt, Trojan and comet orbit: ≥ rock radius 2 + landmark radius + `MARGIN`.
- Every probe spot is at r ≤ 480.
- The deep-space point must also be ≥ 60 u from any swept orbit, so it stays a fair "deep space".

- [ ] **Step 1: Write the tests** using these rules, sampling 2 000 points per body orbit and 64 per rock orbit.
- [ ] **Step 2: Run** `npx vitest run tests/solarClearance.test.ts`. Expected: FAIL on whatever does not clear (or PASS; record either way).
- [ ] **Step 3: Move each failing landmark minimally.** Search along its own radial line, then vertically, in 1 u steps; take the smallest move that clears. Write `old → new, margin, reason` to the ledger. A destination's `jumpR`/standoff constraints in `tests/destinations.test.ts`, `tests/careerTrail.test.ts` and `tests/shipyardGate.test.ts` must still pass.
- [ ] **Step 4: Run** `npx vitest run tests/solarClearance.test.ts tests/destinations.test.ts tests/careerTrail.test.ts tests/shipyardGate.test.ts tests/probes.test.ts tests/spawn.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `test(clearance): landmarks clear the real orbits, belt, Trojans and comets`.

### Task 6: The cut-over: one roster, one renderer, real positions

The largest task. The build must compile and `npm test` must pass at its end. Give it to the most capable implementer.

**Files:**
- Create: `src/utils/bodyPositions.ts`, `src/components/canvas/SolarBodies.tsx`, `src/components/canvas/orbitRibbon.ts`, `tests/bodyPositions.test.ts`, `tests/orbitRibbon.test.ts`
- Delete: `src/components/canvas/SpaceWorlds.tsx`, `src/components/canvas/worldDrive.ts`, `src/data/worlds.ts`, `src/data/moons.ts` (moons return in Task 14), `src/utils/orbits.ts` (after its last user is gone), and the tests that only covered them (`spaceWorlds`, `worldSpin`, `orbits`, `moonOccluders`; rewrite `worldTypes`, `worldReports` and `worldPhysics` onto `SolarBody`)
- Modify:
  - `src/constants.ts`: drop `PLANET_PROPS`, `PLANET_ORBITS`, `planets`, `PlanetData`, `GM_RUANGRAPI`, `gmOf`; `PROGRADE = 1`; update `Project.id`'s doc to "probe id only".
  - The planet half of `src/components/canvas/SpacePlanets.tsx`: the portal, nebulae and the rest stay.
  - Every consumer listed by `grep -rlE "\bplanets\b|\bWORLDS\b|PLANET_PROPS|PLANETS_AND_WORLDS|orbitPosition|WORLD_IDS|isWorld|MOONS" src tests` (≈ 40 source files, the unit tests and the e2e probes).

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - `bodyPositionAt(b: SolarBody, gameSeconds: number, out: Vec3): Vec3` (via `orreryJd`)
  - `updateBodies(gameSeconds: number, out: Record<BodyId, Vec3>): void`: positions, `setScannable(id, …, b.name, b.size)`, and occluder slots: every body except the outermost, in BODY_IDS order, starting at 0 (Task 14 re-cuts these)
  - `heliocentric(b: SolarBody, gameSeconds: number): { rAU: number; speedKmS: number }` (for scans and lighting)
  - `bodies: Record<BodyId, Vec3>` (the store's existing export, re-keyed)
  - `orbitRibbonGeometry(points: Vec3[], halfWidth: number): THREE.BufferGeometry` (closed strip, uv.x = arc fraction, so `makeGuideLineMaterial` works unchanged)

Old → new mapping (apply everywhere):
- `planets` / `WORLDS` / `PLANETS_AND_WORLDS` → `SOLAR_BODIES` / `BODY_REACH`
- `p.name` / `w.id` → `b.id`
- `p.label` / `w.name` → `b.name`
- `orbitPosition(x.orbit, t, out)` → `bodyPositionAt(b, t, out)`
- `x.orbit.radius` → the live `heliocentric(b, t).rAU × AU` where it is lighting (`Atmosphere` `orbitRadius`, ring irradiance, §4.8); the semi-major axis from `orbitShape` × AU where it is layout (chart, radar ordering)
- `WORLD_COUNT` → `BODY_COUNT`; `isWorld` → `isBodyId`; `worldSlot(id)` → `bodySlot(id)`
- Probe/project code keeps `ruangrapi/portfolio/fuxx` untouched: grep each hit and decide planet or probe

Renderer (`SolarBodies.tsx`), built from `SpaceWorlds.tsx`'s pattern:
- One LOD sphere per body, flattened via its `flattening`, map or tint, the `displayAlbedoGain` curve re-anchored with `DISPLAY_KNEE_LINEAR = bodyById("earth").texelMedianLinear`, and the `patchSunShadow` "fragment" mode.
- Earth's `CloudLayer` and night lights.
- Saturn's existing ring code.
- `LimbDarkening` and `Atmosphere` from `look`.
- Spin: interim tilt from `obliquityDeg` about X at today's rates (Task 13 replaces it).
- Earth's ring (`PlanetRing_ruangrapi`, `makePlanetRingMaterial` use in SpacePlanets) is removed.
- Orbit lines: one ribbon per body from `sweptOrbit`-style sampling (512 points, half-width 0.06) with the planets' guide material. **All nine are always visible** (they are known orbits; charting keeps the radar arrow and the chart as its reward); record this in the ledger.

Charting ids: `loadCharted` maps legacy ids through `LEGACY_WORLD_TO_BODY` before validating. `fitz-charted` is rewritten in the new ids on the next charting write. Any other stored state that names a planet or world id must be found (`grep -rn "safeGetJSON\|localStorage" src`) and migrated the same way, never dropped (§7). List what was found in the ledger, even if it is nothing.

- [ ] **Step 1: Write failing tests:**
  - `bodyPositionAt` equals `eclipticToWorld(planetEcliptic(...))` at `ORRERY_TEST_JD` for every body.
  - `updateBodies` writes all nine ids and no others, and gives the outermost body no slot.
  - `orbitRibbonGeometry` closes the loop and keeps uv.x in [0, 1].
  - `loadCharted([{id:"w-rock",at:"2026-10-19"}])` returns `[{id:"mercury",at:"2026-10-19"}]`.
- [ ] **Step 2: Run** `npx vitest run tests/bodyPositions.test.ts tests/orbitRibbon.test.ts tests/charting.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the new modules and the renderer.
- [ ] **Step 4: Migrate every consumer** and its tests by the mapping. `tests/universeRules.test.ts` keeps only what still holds; it is rewritten in Task 16. Leave a ledger note listing the tests reduced.
- [ ] **Step 5: Verify the build:** `npx tsc -b && npm run lint && npm test`. Expected: all green.
- [ ] **Step 6: Update e2e** probes and `tests/e2e/ogimage.mjs` for the new ids. Planet lookups become `bodies.earth` etc. `logbook.probe` scans `ceres` and expects "1/9" and "CERES". `mechanics.probe` no longer looks for `PlanetRing_ruangrapi`, and its occluder count follows `updateBodies`. Run `node tests/e2e/run-one.mjs mechanics`, then `logbook`, then `transition`. Expected: PASS. A ceiling breach here is expected only if the body count raised calls; re-baseline happens in Task 16, so record the numbers in the ledger.
- [ ] **Step 7: Commit** `feat(solar): one roster and renderer, bodies on JPL orbits, PROGRADE +1`.

### Task 7: Belt, Trojans and comets in the scene

**Files:**
- Modify: `src/components/canvas/AsteroidBelt.tsx` (rocks from `makeBelt`/`makeTrojans`, positions by `osculatingEcliptic` + `eclipticToWorld` each frame into the instance matrices; the halo group becomes the Trojans), `src/components/canvas/Comets.tsx` (comet positions from `COMETS`), `tests/beltPush.test.ts`, `tests/cometDust.test.ts`, `tests/mining.test.ts` (if they read belt radii)

**Interfaces:**
- Consumes: `makeBelt`, `makeTrojans`, `BELT_COUNT`, `BELT_COUNT_LOW`, `TROJAN_COUNT`, `COMETS` (Task 4); `orreryJd` (Task 2).
- Produces: `beltRockPosition(rock: FieldRock, jd: number, out: Vec3): Vec3` (exported for tests and the mining and push code).

- [ ] **Step 1: Write a failing test:** `beltRockPosition` at `ORRERY_TEST_JD` lies between 2.1 × (1 − 0.3) and 3.3 × (1 + 0.3) AU × 115 from the origin, and the comets pass their SBDB perihelion.
- [ ] **Step 2: Run** `npx vitest run tests/beltPush.test.ts tests/cometDust.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write positions in place: no per-frame allocation. The realistic-comet tail logic is unchanged.
- [ ] **Step 4: Run** `npm test && node tests/e2e/run-one.mjs transition`. Expected: PASS (record call counts).
- [ ] **Step 5: Commit** `feat(belt): rocks, Trojans and comets fly Kepler ellipses in the scene`.

### Task 8: Bounds, live sky and legacy titles

**Files:**
- Modify:
  - `src/constants.ts` (`SYSTEM_RADIUS = 3600`, `VALIDATION_RADIUS = 3800`)
  - `src/utils/sunLight.ts` (`EXPOSURE_MAX` stays derived; `backdropScale` capped)
  - `src/utils/liveSkyProtocol.ts`, `beacon-api/src/sky.ts`, `src/utils/charting.ts`, `src/store/spaceStore.ts`, `src/utils/crystalField.ts`
  - The radar and HUD `SECTOR.RANGE`
- Test: `tests/liveSkyProtocol.test.ts`, `tests/skyRoom.test.ts`, `tests/charting.test.ts`, `tests/spaceStore.test.ts`, `tests/backdropExposure.test.ts`, `tests/edgeHaze.test.ts`, `tests/beacons.test.ts`, `tests/crystalField.test.ts`, `tests/realUnits.test.ts`

**Interfaces:**
- Consumes: `BODY_IDS`, `LEGACY_CHART_TOTAL`, `LEGACY_WORLD_TO_BODY` (Task 3).
- Produces:
  - `CHART_TOTAL = BODY_IDS.length`; `isCartographerCount(n: number): boolean` (n === CHART_TOTAL || n === LEGACY_CHART_TOTAL)
  - `chartCount` accepts 0..CHART_TOTAL
  - `LEGACY_CARTOGRAPHER_KEY = "fitz-cartographer-legacy"`; `isCartographer(c: readonly ChartRecord[], legacy: boolean): boolean`
  - the wire `ch` sent by a legacy cartographer = CHART_TOTAL
  - `CRYSTAL_FIELD_RADIUS = 480` (crystals keep the inner system)
  - `BACKDROP_NET_MAX = 8.5` (backdropScale × targetExposure never exceeds the old edge's value)

- [ ] **Step 1: Write failing tests:**
  - A room snapshot keeps `plume: "cartographer"` for ch 9 and for ch 5, and coerces it to stock for ch 4 and ch 8.
  - The announce rule fires once for ch 9 and once for ch 5.
  - `inWorld` accepts r 3 790 and rejects r 3 810.
  - **Review Focus 3:** a store initialised from `fitz-charted` = the five legacy records and `fitz-plume` = AURUM sets the legacy flag. It reports `isCartographer` true and keeps the AURUM plume equipped. `chartedCount` is 5 (now mercury, saturn, uranus, neptune, ceres). The logbook line reads "WORLDS CHARTED 5/9".
  - **Review Focus 5:** a parsed old-client `me` with ch 5 and AURUM keeps AURUM, and a new client's `SnapShip` view treats ch 5 as a cartographer for the ghost scan.
  - For d in [AU, 3600], backdropScale(d) × targetExposure(d) ≤ 8.5 and is non-decreasing.
  - `edgeDepth` and `HAZE_START` follow 3600.
  - Crystals spawn within 480.
- [ ] **Step 2: Run** the listed tests. Expected: FAIL.
- [ ] **Step 3: Implement.** The legacy flag is written once, at load, when the raw stored records cover all five legacy ids, and is never cleared. Comment the legacy-5 rule in `sky.ts` and the protocol with its removal condition: "remove once no client older than PR #40 can be cached (asset-pack SW max age)".
- [ ] **Step 4: Run** `npm test` and `cd beacon-api && npx vitest run` (if the Worker has its own suite, use its existing command). Expected: PASS.
- [ ] **Step 5: Commit** `feat(bounds): 31 AU system, live sky to 3800, legacy cartographers keep AURUM`.

### Task 9: Seeing the whole system (spike, then build)

**Files:**
- Modify: `src/components/canvas/GlobalCanvas.tsx` (far plane and depth), `src/components/canvas/orbitRibbon.ts` and the guide material (screen-constant width)
- Create: `src/components/canvas/BodyDots.tsx`, `tests/bodyDots.test.ts`

**Interfaces:**
- Produces: `CAMERA_FAR = 8000`; `needsDot(radius: number, distance: number, fovYRad: number, viewportH: number): boolean` (projected radius < 1 px, i.e. a disc under 2 px across); `DOT_PX = 2`.

- [ ] **Step 1: Spike** in this order, stopping at the first that passes:
  1. three's reversed depth buffer (check the 0.185 renderer option name in `node_modules/three/src/renderers/WebGLRenderer.js`; it needs `EXT_clip_control`) with the existing `@react-three/postprocessing` chain;
  2. `logarithmicDepthBuffer: true`;
  3. scaled-space impostors.

  Pass means:
  - no z-fighting on Earth's cloud shell, Saturn's rings or any orbit ribbon, in screenshots from Earth, from Neptune and from the edge (debug `teleport` + `setAttitude`);
  - `node tests/e2e/run-one.mjs programs` reports `added=0`;
  - the programs ceiling 79/84 holds.

  Record the result and the numbers in the ledger.
- [ ] **Step 2: Write a failing test:** `needsDot(22, 3000, π/3, 800)` is false. `needsDot(2.95, 3000, π/3, 800)` is true.
- [ ] **Step 3: Implement** the chosen depth mode and `CAMERA_FAR`. `BodyDots` is one `THREE.Points` with `sizeAttenuation: false`, one vertex per body, colour = `b.color`, drawn only where `needsDot`, written in place. The ribbon half-width grows with camera distance in the vertex shader so it stays ≥ 1 px. Small perihelion and aphelion ticks (short ribbon crossbars at E = 0 and E = π, same material) mark each orbit (§6.2).
- [ ] **Step 4: Run** `npm test && node tests/e2e/run-one.mjs programs && node tests/e2e/run-one.mjs transition`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(view): the whole system in view, far bodies as dots, ribbons readable at any range`.

### Task 10: Long-range cruise

**Files:**
- Create: `src/utils/cruise.ts`, `tests/cruise.test.ts`
- Modify: `src/components/canvas/Spaceship.tsx` (the warp branch around `cruiseCap(WARP_SPEED, …)`), the HUD speed readout (km/s and % of light speed), `tests/e2e/harness.mjs` (`installEdgeRecorder` default edge → `SYSTEM_RADIUS`), `tests/e2e/fuel.probe.mjs`, `tests/e2e/flight.probe.mjs`

**Interfaces:**
- Consumes: `bodies`, `BODY_REACH` (Task 6), moon positions (none until Task 14; `freeDistance` takes a list, so moons join it there), landmark and probe positions, `SYSTEM_RADIUS`.
- Produces:
  - `CRUISE_FREE_REF = 60`; `CRUISE_MAX_FACTOR = 12`; `CRUISE_ACCEL = 150` (u/s², so 39 → 468 takes about 3 s)
  - `cruiseLimit(dFree: number): number`
  - `stepCruise(current: number, limit: number, dt: number): number` (rises by at most `CRUISE_ACCEL·dt`; falls to the limit at once)
  - `freeDistance(p: Vec3, spheres: readonly { x: number; y: number; z: number; r: number }[], count: number, edgeR: number): number` (minimum of surface distances and `edgeR − |p|`)

- [ ] **Step 1: Write failing tests:**
  - `cruiseLimit(0) === 39`, `cruiseLimit(60) === 39`, `cruiseLimit(300) === 195`, `cruiseLimit(1e5) === 468`.
  - `stepCruise(39, 468, 1/60)` is 41.5; `stepCruise(400, 39, 1/60)` is 39.
  - **Trip:** a pure simulation (dt 1/60, the ship always steering at the target, bodies at `ORRERY_TEST_JD` held still) from 20 u outside Earth's surface to 100 u from Neptune's centre takes ≤ 20 s. Fuel drain over the trip (`FUEL_DRAIN_PER_SEC` × time) < `FUEL_MAX`.
  - **Review Focus 4:** a head-on run from 1 500 u straight at Jupiter's centre never has the ship inside size + 1, and its speed is ≤ 39 when the surface distance ≤ 60.
  - **Edge:** a straight run outward at full cruise, with `edgeReturn` applied as in `Spaceship.tsx`, peaks below `SYSTEM_RADIUS + 100`.
- [ ] **Step 2: Run** `npx vitest run tests/cruise.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and wire it: a `warpSpeed` ref in `Spaceship.tsx` stepped by `stepCruise(…, cruiseLimit(freeDistance(…)), dt)` replaces the constant `WARP_SPEED` inside `cruiseCap`. The sphere list is reused per frame: bodies (r = reach), the Sun (`SUN_RADIUS`), fixed landmarks and probes. Fuel code is unchanged.
- [ ] **Step 4: Run** `npm test && node tests/e2e/run-one.mjs fuel && node tests/e2e/run-one.mjs flight`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(flight): long-range cruise, up to 12x warp in open space`.

### Task 11: Orrery date, scans, chart and logbook copy

**Files:**
- Modify:
  - `src/components/layout/HUDOverlay.tsx`
  - `src/components/dom/SystemChart.tsx`
  - `src/utils/scanReport.ts` and `src/utils/worldReports.ts` (merge into `src/utils/bodyReports.ts`)
  - `src/utils/realUnits.ts` (`ORRERY_NOTE`; drop `SIZE_ENLARGEMENT`)
  - `src/utils/charting.ts` (`chartLine`)
  - `src/components/layout/LogbookPanel.tsx`, `src/components/layout/LogbookTracker.tsx`, `src/components/canvas/Scanner.tsx`
- Test: `tests/bodyReports.test.ts`, `tests/systemChart.test.ts`, `tests/realUnits.test.ts`, `tests/charting.test.ts`, `tests/logbookPanel.test.tsx`

**Interfaces:**
- Consumes: `formatOrreryDate`, `orreryJd` (Task 2); `heliocentric`, `SOLAR_BODIES` (Task 6); `enlargement` (Task 3).
- Produces: `bodyReport(b: SolarBody, gameSeconds: number): string`; HUD testid `hud-orrery-date`.

Exact copy:
- `ORRERY_NOTE` = `ORRERY CONVENTIONS: POSITIONS ARE REAL FOR THE ORRERY DATE · 1 S ≈ 21 H, A YEAR EVERY 7 MIN · BODIES DRAWN ENLARGED, BIGGER ONES LESS (RADIUS ∝ DIAMETER^0.4); THE SUN IS NOT TO THAT SCALE · MOONS AND SPINS RUN ON A CLOSE-UP CLOCK (1 S ≈ 1.2 H) AND ARE ILLUSTRATIVE; MAJOR MOONS ONLY · DARK SURFACES DRAWN BRIGHTER THAN TRUE`
- HUD: `ORRERY {YYYY-MM-DD}` beside the SUN AU readout.
- Scan lines, in order:
  - `{NAME} · {ordinal}`
  - `DIAMETER {d,ddd} KM · DRAWN {n,nnn}× TRUE SIZE`
  - `NOW {r.rr} AU FROM THE SUN · {v.v} KM/S`
  - `ORBIT {a.aa} AU ({q.qq}–{Q.QQ}) · e {e.eee} · i {i.ii}° · YEAR {y.yy} EARTH-YR`
  - `DAY {h.h} H · TILT {t.t}° · MOONS {n}`
  - `ORRERY DATE {YYYY-MM-DD} · SPINS AND MOONS ILLUSTRATIVE`
- `chartLine` = `WORLD CHARTED {n}/9 — {NAME}: {first fact}`
- Each body gets two real facts in `bodyReports.ts` (NASA-sourced, one sentence each); the old "-TYPE" lines and `PLANET_FACTS` go.
- System chart: ellipses from `orbitShape` seen from +Y, the Sun at the focus, dots at the orrery positions, an inset panel (Sun to Jupiter's aphelion) at a larger scale, and the date in the corner. `aria-label` updated.

- [ ] **Step 1: Write failing tests:**
  - `bodyReport(mercury, t)` shows a speed 1.52 ± 0.02 times higher at perihelion than at aphelion (pick the two t values with `orbitShape`).
  - Earth's report contains `DRAWN 1,7` and `MOONS 1`.
  - `ORRERY_NOTE` equals the copy above.
  - The chart renders 9 ellipses and an inset, and the inset contains Mercury.
  - `chartLine("ceres", 1)` starts `WORLD CHARTED 1/9 — CERES:`.
- [ ] **Step 2: Run** the listed tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && node tests/e2e/run-one.mjs logbook`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(hud): orrery date, real scans, system chart of real ellipses`.

## Phase 2: Real faces

### Task 12: NASA maps

**Files:**
- Create: `scripts/textures/fetch_nasa_maps.mjs` (pinned URL + SHA-256 per source; download to `assets-src/nasa-src/`, ignored by the main repo like the rest of `assets-src`), `scripts/textures/process_body_maps.mjs` (equirectangular resample to the tiers, linear-light scaling to 0.177 × geometric albedo, WebP out), `scripts/textures/gen_body_maps.mjs` (seeded: Venus cloud deck, Uranus, Titan haze, the Triton fill; Neptune reuses `w-blue` with the methane note fixed)
- Modify: `assets-src/MANIFEST.md` (replace the "cited only, never shipped" paragraph with the new rule and add a row per file), `src/data/solarSystem.ts` (`map`, `texelMedianLinear`, `color`; drop interim tints), `src/utils/displayAlbedo.ts` (knee = Earth's new median; γ recalibrated by the same "dimmest named body" method, documented), the asset-pack lists (`src/utils/assetPack.ts`, `packFormat.ts`, `hiResMaps.ts`), `tests/displayAlbedo.test.ts`, `tests/worldMaps.test.ts` → `tests/bodyMaps.test.ts`, `tests/assetProvenance.test.ts`

Sources (each one's exact product page goes in the script): Earth Blue Marble Next Generation + cloud layer + Black Marble 2016; Moon SVS CGI Moon Kit; Mercury MESSENGER MDIS global mosaic; Mars Viking MDIM colourised (USGS); Ceres Dawn FC global mosaic; Jupiter Cassini PIA07782; Saturn Cassini global map; Io, Europa, Ganymede, Callisto USGS mosaics; Triton Voyager 2 USGS mosaic. Every one must be public domain. If a page states otherwise, use the generator instead and say so in the ledger.

- [ ] **Step 1: Write failing tests:**
  - Every body and moon map in the manifest has a source URL and SHA-256.
  - Each shipped map's median linear luminance is within 3% of its `texelMedianLinear`, and that equals 0.177 × geometric albedo within 10% (dark bodies before the display curve).
  - `displayAlbedoGain` is the identity at and above Earth's median and keeps every body's order.
  - Map byte sizes are within the asset-pack tier caps.
- [ ] **Step 2: Run** `npx vitest run tests/bodyMaps.test.ts tests/displayAlbedo.test.ts tests/assetProvenance.test.ts`. Expected: FAIL.
- [ ] **Step 3: Run the scripts and wire the maps.** The 4K variants are desktop-only, as today. Commit and push `assets-src` as fitzfitz (memory `github-push-account`; use the low-speed-limit flags if a push stalls).
- [ ] **Step 4: Owner look check:** Cycles turntables (the C1 method, `scripts/blender/turntable_worlds.py` adapted) and in-game screenshots of every body, saved to the session scratchpad. Stop and wait for the owner's OK.
- [ ] **Step 5: Run** `npm test && node tests/e2e/run-one.mjs assets`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(maps): NASA public-domain surfaces, generated where none exists`.

### Task 13: Poles, spins and oblateness

**Files:**
- Create: `src/utils/bodySpin.ts`, `tests/bodySpin.test.ts`
- Modify: `src/components/canvas/SolarBodies.tsx`, `src/components/canvas/CloudLayer.tsx` (cloud drift on the close-up clock)

**Interfaces:**
- Consumes: `SolarBody.pole`, `rotationHours`, `flattening` (Task 3); `CLOSE_UP_HOURS_PER_SECOND`.
- Produces:
  - `poleWorld(b: SolarBody): THREE.Vector3` (IAU RA/Dec → equatorial → ecliptic with ε = 23.43928° → world)
  - `spinQuaternion(b: SolarBody, gameSeconds: number, out: THREE.Quaternion): THREE.Quaternion` (local +Y onto `poleWorld`, then turned by 2π·t·1.2 / rotationHours about it; negative hours turn backwards)
  - `meshScale(b): [number, number, number]` (polar axis × (1 − flattening))

- [ ] **Step 1: Write failing tests:**
  - The angle between `poleWorld` and the orbit normal matches `obliquityDeg` within 0.5° for all nine.
  - Earth's day is 23.93 / 1.2 s; Venus and Uranus turn with negative angular velocity about their poles.
  - The pole stays fixed in world space across a full orbit.
  - Jupiter's polar scale is 0.935 and Saturn's 0.902.
- [ ] **Step 2: Run** `npx vitest run tests/bodySpin.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and swap the interim spin in `SolarBodies.tsx`. Occluders and collisions keep the equatorial radius.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(spin): IAU poles fixed in space, real spin senses on the close-up clock, oblate giants`.

### Task 14: Moons

**Files:**
- Create: `src/components/canvas/SolarMoons.tsx`, `scripts/blender/gen_mars_moons.py` (Phobos and Deimos to NASA shape models, seeded, tri cap 1 500 each), `tests/solarMoonsScene.test.ts`
- Modify: `src/components/canvas/sunShadow.ts` (slots), `src/store/moonState.ts`, `src/utils/worldCollide.ts` (`SOLID_BODIES` gains the moons), `src/debug/bridge.ts`, `src/utils/cruise.ts` callers (moons join the `freeDistance` list), `tests/e2e/mechanics.probe.mjs`

**Interfaces:**
- Consumes: `SOLAR_MOONS`, `insetDistance`, `insetPeriod`, `insetScale` (Task 3); `poleWorld` (Task 13); `bodies`.
- Produces:
  - `moonPositionAt(m: SolarMoon, gameSeconds: number, parentPos: Vec3, out: Vec3): Vec3`: an equatorial-plane orbit about `poleWorld(parent)` (the Moon about the ecliptic normal at 5.145°), period `insetPeriod`, sense from `retrograde`, phase from a fixed per-moon seed
  - `moonPositions: Record<MoonId, Vec3>`
  - Occluder slots (`OCCLUDER_SLOTS`): bodies with a moon or a ring (earth, mars, jupiter, saturn, uranus, neptune) first, then the nine moons, for 15 of 16. Mercury, Venus and Ceres shadow only on the CPU.
  - `bodySlot(id): number` (−1 when CPU-only)

- [ ] **Step 1: Write failing tests:**
  - Each moon's distance from its parent equals `insetDistance` at any time.
  - Its angular rate equals 2π / `insetPeriod`.
  - Triton turns against Neptune's spin.
  - The Galileans lie in Jupiter's equator within 0.5°.
  - Slots total 15, and every receiver (a planet with moons, a ring, a moon) has its shadow casters in GPU slots.
  - Moons are tidally locked: the same face points at the parent.
- [ ] **Step 2: Run** `npx vitest run tests/solarMoonsScene.test.ts tests/sunShadow.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with the moon maps from Task 12 and the Phobos and Deimos GLBs (contract pinned in `tests/assetContracts.test.ts`). Run the owner look check as in Task 12 Step 4 before wiring.
- [ ] **Step 4: Run** `npm test && node tests/e2e/run-one.mjs mechanics`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(moons): nine major moons as real-ratio insets, Laplace resonance, retrograde Triton`.

### Task 15: Rings, atmospheres and glow

**Files:**
- Modify: `src/components/canvas/SolarBodies.tsx`, `src/components/canvas/guideLine.ts` (ring irradiance becomes a per-frame uniform), `src/utils/ringOptics.ts` (Uranus ε ring profile: radius 51 149 km / R 25 559 = 2.001 R, width ~20–96 km drawn at a visible minimum of 0.02 R, τ 0.5–2.5, albedo ~0.02), `src/data/planetAtmospheres.ts` (rims keyed by body id), `scripts/blender/gen_moon.py` or the Io map (Io hot spots as an emissive mask, night side only)
- Test: `tests/ringOptics.test.ts`, `tests/ringShadow.test.ts`, `tests/sunLight.test.ts`, `tests/atmosphere*.test.ts` (existing names)

**Interfaces:**
- Consumes: `heliocentric` (Task 6), `spinQuaternion` (Task 13).
- Produces: `ringIrradiance(rAU: number): number` (live); `BODY_ATMOSPHERES: Partial<Record<BodyId, AtmosphereLook>>`.

- [ ] **Step 1: Write failing tests:**
  - Saturn's ring normal equals its pole.
  - Ring irradiance at Saturn's perihelion is (Q/q)² times that at aphelion.
  - Uranus's ε ring lies at 2.00 R in Uranus's equator.
  - Earth has no ring mesh.
  - Rims exist for Earth, Venus, Mars, Titan, Uranus and Neptune.
  - Io's glow mask is zero on the lit hemisphere.
- [ ] **Step 2: Run** the listed tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && node tests/e2e/run-one.mjs transition`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(look): Saturn's rings in its equator, Uranus's epsilon ring, real atmospheres`.

### Task 16: Laws, changelog, perf and the full suite

**Files:**
- Modify:
  - `docs/UNIVERSE-RULES.md` (§8 list: P2, P3, L5, L9, L10, L14, L15, L18, L35, L36, L42, the units table with cruise)
  - `tests/universeRules.test.ts` (rewritten to §8's assertions, calling Task 1 to 15's modules)
  - `src/data/changelog.ts` (pr 40, "The Real Solar System", visitor-facing what/why/how)
  - `docs/FOLLOW-UPS.md` (add: the real star catalogue; remove the entries this PR settled: the Fuxx albedo bake, the Jupiter-type oblateness, the C1 world minors whose files are gone)
  - `docs/PERF-BUDGETS.md` (deliberate re-baseline with before/after numbers)
  - `src/data/projects.json` docs where they mention planets

- [ ] **Step 1: Rewrite** `universeRules.test.ts` and run `npx vitest run tests/universeRules.test.ts tests/changelog.test.ts`. Expected: PASS.
- [ ] **Step 2: Full verification:** `npx tsc -b && npm run lint && npm test && npm run test:e2e`. Expected: all green. Re-run any probe that fails under load once, alone, before calling it real (memory: headless loads can hang).
- [ ] **Step 3: Perf:** run `perf` and `transition`, then compare against `docs/PERF-BUDGETS.md`. Re-baseline only what changed for a stated reason, in the doc and the ledger.
- [ ] **Step 4: Commit** `docs(laws): the Solar System's laws, changelog #40, perf re-baseline`.

### Task 17: Release (owner-gated)

- [ ] **Step 1: Owner checks** (§9): in-game screenshots of the inner system, Jupiter with its four moons, Saturn, and the full system with orbit lines; a recorded Earth → Neptune flight; the HUD date checked against a planetarium app. Wait for the OK.
- [ ] **Step 2: Worker first.** With the owner's go-ahead, run `npx wrangler deploy --config beacon-api/wrangler.toml`. Then do a live two-socket check: a pose at r 3 700 relays; ch 9 + AURUM and ch 5 + AURUM both keep the plume; ch 4 + AURUM is coerced.
- [ ] **Step 3: Push and open PR #40** as fitzfitz, with the ledger's rulings, landmark moves, spike result and re-baselines in the body. Wait for the Cloudflare branch check.
- [ ] **Step 4: Merge only on the owner's word.** Then verify porto.fitzgeral.my.id and GitHub Pages serve the new bundle with 0 console errors.
