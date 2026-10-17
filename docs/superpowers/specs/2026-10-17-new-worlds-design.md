# New Worlds, Charting and the Cartographer — Design

**Date:** 2026-10-17 · **Sub-project C** of the new-worlds work (after A, the bigger universe, PR #32, and B, true proportions, PR #33)
**Laws:** `docs/UNIVERSE-RULES.md`, chiefly:
- P1 (laws exact) and P2 (its own star system, consistent choices);
- Kepler (L5–L7);
- inverse-square light (L19);
- shadows (L20);
- rings and Roche (L14);
- rotation (L9);
- sizes (L35, L36);
- the orrery conventions (P3).

**Owner:** the vision and the charting/title picture are the owner's. Details marked *my call* are mine. The builder check (an engineer, a graphics engineer and a planetary scientist) is folded in.

## Intent

The owner wants more planets that are "just planets, nothing more": realistic, with variety like our own solar system, and rewarded by discovery.

Long term, the owner wants returning visitors who have their own identity, compete to gain something, and might later lose things or own a personal realm. For now: "build the universe from the small things and we can grow."

C is the first small thing:
- five real-type worlds to find;
- a personal record of finding them;
- one title other pilots can see.

An astronomer flying through should recognise each world's type on sight, and find every number it states true **for that world, where it orbits**.

## The experience (agreed with the owner)

- **Charting a world.** You chart a world by flying close and scanning it (hold E). There is no orbit lock, no dossier and no jump key. On the first scan of each world:
  - the radio says `WORLD CHARTED 3/5 — <TYPE>: <one fact>`;
  - the logbook fills in that world's card;
  - the system chart draws its orbit.
- **The fifth world.** No cutscene and no confetti:
  - a rarer radio line: `SYSTEM SURVEY COMPLETE — EVERY WORLD CHARTED. YOU HOLD THE TITLE CARTOGRAPHER.`;
  - the chart is complete, showing every body around the sun;
  - a plume colour that only cartographers can fly unlocks.
- **How other pilots recognise you.**
  - A cartographer's ghost ship flies the cartographer plume.
  - Scanning a ghost shows `CARTOGRAPHER · <country>`, or partial progress (`3/5 CHARTED · <country>`).
  - When someone completes the survey, everyone flying at that moment hears `A PILOT FROM <country> HAS CHARTED THE WHOLE SYSTEM.`
- **No login.** Progress lives in the visitor's browser. Clearing it or switching device loses it, and a determined person can fake it. That is accepted for now; a future identity or realm feature plugs in here.

## Honesty rule for the worlds (*my call*, from the builder check)

The star is the Sun: its GM and inverse-square light, with 1 AU = 115 u. The worlds sit at about 1.8–3.5 AU.

Real Saturn, Uranus and Neptune facts are measured at 9.5–30 AU, so they would be false here. Examples:
- a Neptune-type at 3 AU gets ~100× Neptune's sunlight, so "radiates 2.6× what it receives" becomes ~1×;
- a Pluto-type at 3.5 AU sits near 146 K, far above nitrogen's 63 K triple point, so it has no nitrogen ice.

So:
- **Every stated fact is true at the world's own orbit.** Temperatures are computed from its orbit and its Bond albedo, and labelled as equilibrium temperature: T = 278.6 K · (1 − A)^¼ / √(r/AU). Orbit and period come from `formatOrbit`.
- **Namesake comparisons are labelled as such**, for example `LIKE SATURN, BUT 2.6 AU FROM ITS STAR: −118 °C (SATURN ITSELF: −178 °C)`. This is how real exoplanet catalogues describe "warm Saturns" and "warm Neptunes", which exist.
- **The look follows the type as visitors recognise it,** adjusted where the physics at the world's distance demands it. For example, the Neptune-type's bright cloud streaks are ammonia ice, which condenses near 145 K, not methane ice, which needs about 80 K. They look much the same and are honest.
- Orbits stay circular (L5): e = 0. Nothing claims an eccentric-orbit effect such as Mercury's 3:2 spin resonance.

## The five worlds

**⚠ OWNER DECISION PENDING: the roster (see "Open question" at the end).** This section assumes the recommended option A.

| World | Type | Size (u) | Look | Facts (true at its orbit) |
|---|---|---|---|---|
| Ringed giant (Saturn-type) | gas giant | 15, drawn oblate (polar/equatorial 0.90) | Butterscotch bands, a cooler polar cap, a polar hexagon. Rings with the real profile in equatorial R: C 1.24–1.53 (faint), B 1.53–1.95 (densest), Cassini division 1.95–2.03, A 2.03–2.27, Encke gap ~2.21. | Less dense than water (0.69 g/cm³). Water-ice rings slowly sublimating this close to the star. Its equilibrium temperature, with Saturn's own for comparison. |
| Tilted ice giant (Uranus-type) | ice giant | 13.5 | Pale cyan, almost featureless, faint polar brightening. Axis tipped 98°. Its narrow dark rings (albedo ~0.02) are invisible in visible light, so they are not drawn. | Rolls on its side. Methane gas absorbs red light, hence the cyan. Equilibrium temperature. |
| Blue ice giant (Neptune-type) | ice giant | 13 | Deep blue bands, one dark storm spot, bright ammonia-ice cloud streaks. | Methane gives the blue. Winds like Neptune's are plausible but not stated as measured. Equilibrium temperature. |
| Airless rock (Mercury-type) | rocky, airless | 5.7 (Mars-type 8 × the real Mercury/Mars ratio) | Grey-brown; rayed young craters, smooth plains, lobate scarps, one large impact basin. | No atmosphere to hold heat, so day and night differ enormously. A large iron core (stated as a Mercury-like composition). |
| Salt-spotted dwarf (Ceres-type, option A) | dwarf planet | 3.5 | Dark grey, cratered, a few brilliant white salt spots (like Occator's faculae), one lone mountain (like Ahuna Mons). | Massive enough to be round, not a planet. Bright spots of sodium-carbonate salts. Water ice below the surface. Real Ceres orbits at 2.77 AU, which is where this one sits. |

- **Sizes keep the real order**, compressed (P3): gas giant 16 > ringed giant 15 > Uranus-type 13.5 > Neptune-type 13 > Earth-type 12 > Mars-type 8 > Mercury-type 5.7 > Ceres-type 3.5. `tests/universeRules.test.ts` pins the order. The ringed giant's occluder and clearance use its equatorial radius.
  - The existing Jupiter-type is round; its 6.5% flattening is logged as a follow-up, not changed here.
- **Rotation (L9):**
  - The Uranus-type's 98° axis is a named exception, as in the real solar system. Everything else spins prograde.
  - At 1.8 AU tides cannot slow the Mercury-type's spin, so it spins at an ordinary rate.
- **Ring orientation:** the ring plane is the ringed giant's equator, with its pole 26.7° from its orbit normal and fixed in space.
  - The rings go edge-on to the inner system about twice per orbit (every ~15 min of real time). That is real, and the owner screenshots are timed around it.
- **Roche (L14):** with the world's own density (0.69) and ice (~0.92), the fluid Roche limit is ≈ 2.2 R. The A ring's outer edge at 2.27 R sits at the limit, as the real A ring does. The scan and L14 say exactly that; they don't claim a margin.
- **No moons for the new worlds** (*my call*): the occluder slots, the perf headroom and the scope argue against them. The ringed giant's scan notes "moons not charted".

## Light

- **Albedo is honest**, on the scene's scale (Portfolio's texel median 0.095 ↔ Jupiter 0.538, a factor of ~0.177). Target linear medians:

| World | Target median |
|---|---|
| Mercury-type | ~0.025 |
| Ringed giant | ~0.088 |
| Uranus-type | ~0.086 |
| Neptune-type | ~0.078 |
| Ceres-type | ~0.016 (geometric albedo 0.09) |

- **Exposure:** `EXPOSURE_MAX` becomes `(SYSTEM_RADIUS/AU)^1.5` (≈ 8.5 at 480), so the camera adapts the way a real one does (L22). Net brightness for equal albedo, `(115/r)^0.5`, compared with today's clamp:

| r | 210 | 242 | 300 | 358 | 402 |
|---|---|---|---|---|---|
| New | 0.74 | 0.69 | 0.62 | 0.57 | 0.53 |
| Today | 0.74 | 0.56 | 0.37 | 0.26 | 0.20 |

  - Update `tests/sunLight.test.ts` and the stale L19 line ("0.53 at the edge" dates from the old 250 edge).
  - Stars, plumes and nebulae read up to 3.4× brighter at the edge than today.
- **Fill light falls off with sunlight, everywhere** (*my call*, under P1). The ambient light (0.15) and the IBL environment intensity are fills, not physics.
  - Each frame they are scaled by `irradianceVsAU(camera distance from the sun)`. These are global uniforms, so no program changes.
  - Without it, an exposure of 8.5 would multiply a constant fill until the ship's night side matched its day side near the edge.
  - This also darkens night sides a little in the existing outer system (at Fuxx, the fill drops to ~0.39 of today). That is a visible change to approved planets, shown in the owner screenshots.
- **Low-perf tier:** custom ShaderMaterials (rings, atmospheres) get no tone-mapping exposure without the composer. They must multiply by the current exposure themselves in low-perf, or they read 4–6× too dark next to their planet.
- **Stars must never show through a world's disc.** The star shells ride with the ship at 40–260 u, are additive and don't write depth, so they draw over any world farther away than that. Render them as background (before opaque, behind everything), or otherwise guarantee no star lands on a disc. Add a probe check.
- **Camera far plane:** the longest sightline reaches ~980 against the default far plane of 1000. Raise it (e.g. to 1500) and check depth precision.

## Atmospheres and rings

**Atmospheres** reuse what exists, with no new program per world:
- The ice giants get `LimbDarkening` (0.6–0.8) plus a thin `Atmosphere`.
- The `Atmosphere` dusk tint, hard-coded orange today, becomes a `uDusk` uniform. Methane atmospheres don't redden.
- The Mercury-type and the Ceres-type have none.

**The ringed giant's rings** extend `makePlanetRingMaterial` behind an `#ifdef RING_MAP`, so Ruangrapi's ring keeps its program:
- A 1D radial RGBA strip holds the colour in RGB and the optical depth τ in A.
- Viewer opacity is `1 − exp(−τ/|μ|)`, where μ is the cosine of the view angle to the ring plane: thin face-on, opaque edge-on.
- Lommel–Seeliger lighting, with a dimmer transmitted term when the sun and the viewer are on opposite faces.
- A `uIrradiance` term for its distance. Ruangrapi's ring sits at 1 AU, so it is unchanged.
- The planet's shadow on the rings already exists.

**The rings' shadow on the planet** is new: one ringed-giant-only option on `patchSunShadow`, +1 program, compiled at warm-up.
- From each fragment, the ray toward the sun is intersected with the ring plane.
- The transmitted sunlight is `exp(−τ(r)/μ₀)`, where μ₀ is the sine of the sun's elevation above the ring plane. This is not the viewer's alpha, so the shadow doesn't depend on where the camera is.
- It is blurred by the drawn sun's angular size.
- **Disclosed in L20 as a P3 artifact:** the drawn sun is ~45× the real Sun, so the Cassini division's shadow blurs. The real one is sharp.

## Where they orbit

**Facts from the survey** (read-only scripts reusing the repo's `orbitPosition`, the clearance rules and 1440-sample swept orbits):
- **Nothing fits inside Ruangrapi's orbit (115).** Circular orbits around the sun come within |Δr| at their line of nodes whatever the inclination, so the sun's keep-out, ring gate 0 and shard 0 at ~36, the belt (40–70), the halo (80–95) and Ruangrapi's band (95–115) exclude every radius there.
- Real spacing would put Mercury on the belt (0.39 AU = 45) and Venus in the halo (0.72 AU = 83).
- **The jelly path crosses the whole outer band.** Its control points sit at r ≈ 70, 240 and three between 325 and 347.
- Comet aphelia are 227 and 256. Nothing tests planets against comets today; Portfolio already passes within 1.9 of comet 0's path.
- **Past Fuxx (185), five worlds fit** once the edge moves out. Survey layout:

| Slot | r | inc | node | Worst margin |
|---|---|---|---|---|
| 1 | 210 | −5° | 250° | 4.6 |
| 2 | 242 | −25° | 230° | 7.3 |
| 3 | 300 | −35° | 60° | 3.8 |
| 4 | 358 | 0° | 0° | 3.5 |
| 5 | 402 | 0° | 0° | 11.0 |

**The builder re-runs the search** with the final roster and sizes, preferring:
- the Ceres-type near its real 2.77 AU (≈ 318);
- the airless rock innermost;
- the ice giants outermost.

The ringed giant's reach is 2.3 × size. Every world needs:
- a positive margin against every placed thing;
- a planet-vs-world and world-vs-world gap ≥ 7 after both bodies;
- a margin against both comet paths and the jelly path.

The existing system is already its own star system (P2): Earth-type 115 < Jupiter-type 150 < Mars-type 185.

**The edge moves out:**
- `SYSTEM_RADIUS` goes 400 → **480** and `HAZE_START` 360 → **440**. `HAZE_START` is a literal in `edgeHaze.ts`; make it derived.
- 480 is the cap: the worst return-burn overshoot (~19) must stay inside the fixed, Worker-shared `VALIDATION_RADIUS` 520. The Worker needs no change for positions.
- What follows from the move:
  - HUD `SECTOR.RANGE`, which becomes 8.35 AU;
  - crystals, anomalies and beacons;
  - `realUnits` "6.96";
  - the probes: the flight edge probe (`EDGE_BOUND` 440 → 520, its teleport to 380), `mechanics`, the fuel probe sphere and the harness edge default;
  - L18 and the README.
- **Fuel.** `tests/fuel.test.ts` claims the tank crosses the system three times, which fails above 406. *My call:* keep the owner's fuel tuning (5× warp, 20 s refill), restate the claim as "more than two and a half diameters", and say so in the changelog.
- **Crystals** stay at 40 (*my call*), so they spread ~42% thinner. The tank refills itself, and more instances cost triangles.
- **Beacons:** server-stored beacons up to 433 from the sun become visible again, which is correct now that they are inside the system.

**Discovery, not signposts** (*my call*):
- **Uncharted worlds** show on radar only within its range (220): no rim arrow, no label.
- **Charted worlds** get a rim arrow like the planets, plus a faint orbit line in the sky.
- **Logbook hint:** each uncharted world's card gives one honest hint, e.g. "beyond the Mars-type's orbit, ringed".

**Bodies.**
- **Gravity:** worlds get flight wells by the same size² rule (`planetWell`), and slingshots around them count toward the Slingshot badge (its hint becomes "SKIM A PLANET OR WORLD"). They join the crystal and comet keep-outs.
- **Solid surfaces** (*my call*): planets have no collider today; the orbit lock keeps ships off them. Worlds have no lock, so each gets a moving surface collider: a bounce like the sun's, with an impact sound and shake, and gravity zeroed. That stops the camera ever ending up inside a world.
- **Rings:** you can fly through the rings. No collision, which keeps the scope small.

**Separate table.** Worlds live in `src/data/worlds.ts` (`WORLDS`), not `planets`. In `planets` they would:
- soft-lock the zone loop, since there's no dossier to open;
- count as dossiers;
- push the shipyard and contact off the 1–9 jump keys;
- capture the waypoint;
- become convoy targets;
- break `projects.test`.

They stay out of zones, `PLANET_IDS`, jump keys, waypoints, gamepad jumps and convoy targets. `bodies` is keyed by name and seeded from both tables.

**Stable ids and names** (*my call*; ids never change after C1 ships, because they are saved in `fitz-charted`):

| Id | Display name |
|---|---|
| `w-rock` | AIRLESS ROCK |
| `w-ringed` | RINGED GIANT |
| `w-tilted` | TILTED ICE GIANT |
| `w-blue` | BLUE ICE GIANT |
| `w-dwarf` | SALT-SPOTTED DWARF |

- The display names are descriptive, not solar-system names (P2: this is not the Solar System). Each card and scan adds "<namesake>-TYPE".
- If the roster changes, only the ids of the changed worlds change, and that happens before C1 ships.

## Shadows and occluders

- `MAX_OCCLUDERS` is 8 and full today (3 planets + 5 moons). *My call:* raise it to **16 with fixed slots**, and replace the per-body `selfIndex` compile-time define with a distance skip in the shader loop: `length(o.xyz − p) < 1.05·o.w`, which also covers a cloud shell at 1.03 R.
- **Programs.** The worlds then add no program per body. This doesn't merge today's planet programs, which differ in features (emissive, city lights, clouds), so today's count stays where it is. The ring slot also becomes a uniform.
- **GPU cost:** measure before and after (estimate ≤ +0.5 ms) and record it.
- A body only shadows receivers farther from the sun than itself. The outermost world needs no GPU slot, but still shadows the ship and the sun glare on the CPU.
- Add the worlds to the sun glare's occluder list.
- Slots are fixed: no per-frame nearest-N selection, which would make shadows pop.

## Charting, logbook and title (local)

- **Storage:** `charted: {id, at}[]` in its own localStorage key, `fitz-charted`, with a sanitising loader like `loadBadges`.
  - Not `fitz-logbook`: an older bundle would drop the unknown ids and then overwrite the key.
  - `chartWorld(id)` is idempotent, called from `Scanner.tsx` (the one place a scan completes). It announces through `announceLogbook`, never `sendBroadcast`, so the line queues behind the scan report.
- **Scan report:** `WORLD_REPORTS` in `generateScanReport`, before the hash fallback.
  - Each report gives the type, the facts under the honesty rule and `formatOrbit` in real units.
  - Where relevant it says "sizes compressed": the orrery note's "~290× Jupiter" is the gas giant's enlargement, and the small worlds are enlarged far more.
- **Logbook UI:**
  - A new section, **WORLDS CHARTED n/5**, goes between FLIGHT BADGES and the plume pointer. Each card shows its checked/locked state and `CHARTED <date>` or its hint.
  - The tracker gains a `WORLDS n/5` suffix.
  - `logbookCount` (11) and its milestones are unchanged; the survey has its own milestone line.
- **The system chart** (*my call*): no map exists today. Add a small top-down SVG chart in the logbook panel (DOM, no WebGL cost) in its own section above the cards:
  - it shows the sun, the three project planets and the five worlds' orbits;
  - uncharted orbits are dashed outlines;
  - a world's orbit draws in solid once charted.
- **Title:** derived, not stored: `cartographer = charted.length === 5`. It shows locally in the logbook header (`PILOT LOGBOOK · CARTOGRAPHER`) and the tracker.
- **The plume:** id `cartographer`, named **AURUM**, pale white-gold (~`#ffe9a3`).
  - It must read clearly apart from slingshot's existing GOLD `#ffc23d` under bloom.
  - `plumeAllowed` gains the charted check, and the Hangar's locked label reads "Chart all 5 worlds".
  - `ALL_LINE` becomes "ALL BADGE PLUMES UNLOCKED", so it stays true.

## Live sky (the visible title)

**Deploy order.** The Worker (`beacon-api`) imports `liveSkyProtocol.ts`, `constants.ts` and `plumeColors.ts`, so **the Worker is redeployed before the site merges**.
- If the site ships first, the old Worker rejects the `cartographer` plume and the pilot becomes invisible to everyone.
- After the Worker deploy, old cached clients are fine: no `ch` means 0, an unknown plume shows as stock, and an unknown message type is ignored.
- The PR states the deploy as a pre-merge step, as PR #32 did.

**The wire.**
- **Charted count:** an optional integer `ch` (0–5) on `me`.
  - Absent means 0. Malformed or out-of-range values are coerced to 0, never rejected, so a bad field never hides a pilot.
  - `buildSnap` emits `ch` only when it is above 0, so existing rows stay byte-identical.
  - `CHART_TOTAL = 5` is shared in `liveSkyProtocol.ts`. The worst-case message is ~104 of 256 bytes.
- **Plume coherence:** `plume: "cartographer"` is accepted only with `ch === 5` in the same message. Otherwise it is coerced to stock.

**Ghost scan text** (fixed templates, no free text):

| `ch` | Text |
|---|---|
| 5 | `CARTOGRAPHER · <cc>` |
| 1–4 | `<ch>/5 CHARTED · <cc>` |
| 0 | today's text |

**The shout-out.**
- The client sends `{t:"charted"}` once, when its count first reaches 5. A pending flag in localStorage lets it go out on a later connection within 24 h if nobody is online.
- The room relays `{t:"charted", cc}` to everyone else only if all of these hold:
  - a `me` has been seen, which proves consent;
  - `last.ch === 5`;
  - it hasn't already announced on this connection (an attachment flag);
  - the visitor key hasn't announced within 24 h (in memory, best effort);
  - the room-wide gap is at least 60 s (bursts are dropped).
- The client renders a fixed template ("A PILOT HAS…" when the country is null).

**Server storage, consent and hibernation.**
- **Nothing is stored server-side** (*my call*). The README's "nothing is stored" promise stands, and anti-spam lives in memory. A durable once-a-day limit needs storage and is left for the identity work.
- **Consent:** the live-sky notice, the logbook toggle and the README mention the charted count.
  - *My call:* version the "seen" flag, so pilots who already agreed see the updated notice once before their count is shared.
  - The country still comes only from Cloudflare. No new identifier is added.
- **Hibernation:** the new room code tolerates old attachments (`ch ?? 0`, `announced ?? false`).

## Assets: photoreal and reproducible

**Owner instruction:** photoreal, Blender if needed, trusted plugins allowed.

- **Shipped maps come from seeded scripts**, keeping the repo rule that every shipped asset is original and reproducible (`assets-src/MANIFEST.md`, `assetProvenance.test.ts`).
  - The giants and the dwarf extend `scripts/textures/gen_planets.mjs`, or a sibling `gen_worlds.mjs`, reusing its seam-safe 3D noise.
  - The Mercury-type ports the cratering, ray and maria code from the Blender moon generator (`gen_moon.py`, numpy inside bpy) and gets the only normal map.
- **Blender is the realism gate.** Each world is rendered as a Cycles turntable under a sun lamp at its distance, beside NASA reference imagery. The owner sees these renders. Shipped maps are not Cycles bakes, because sampling noise breaks reproducibility.
- **NASA imagery is reference only**, cited in MANIFEST and not shipped:
  - Shipping it breaks the "original" rule.
  - Uranus and Neptune have no good full-globe maps.
  - Solar System Scope's CC BY maps are partly painted and not reproducible.
- **Plugins:** none needed. Cycles, numpy and image I/O ship with Blender, and the survey found no planet-texturing add-on on the official extensions platform. If one turns out to help, it is installed only from extensions.blender.org and named to the owner.
- **Budget:**

| World | Map | GPU memory |
|---|---|---|
| Mercury-type | 2048 albedo + 1024 normal | 13 MiB |
| Ringed giant | 2048 + 2048×4 ring strip | 11 MiB |
| Neptune-type | 2048 | 11 MiB |
| Uranus-type | 1024 | 3 MiB |
| Ceres-type | 1024 | 3 MiB |
| **Total** | | **~41 MiB** (about +2% of the 2 GB baseline) |

- **Download:** ~450–650 KB. The `public/models` 8 MiB cap is 665 KiB from full, so it **rises to 9 MiB on purpose**, with the reason in the test comment.
- **Loading** (*my call*): the world textures load in the **main** Suspense, so `ShaderWarmup` compiles every world and ring program at start-up. Re-measure start-up against the 20 s ceiling. A later boundary would compile programs during play.
- **Asset tests:**
  - provenance entries;
  - map shape (2:1, width per world);
  - a per-file size cap;
  - an albedo band per world (no repeat of Fuxx's 1.4%);
  - seam continuity;
  - the ring strip: Cassini division τ under 0.15 of the B-ring peak, τ = 0 inside C and outside A;
  - generator determinism at a tiny width.

## Performance

These rules hold throughout:
- no new shader program during play (the tour adds 0);
- frame loops allocate nothing;
- both perf tiers and reduced motion keep working.

**What changes:**
- **Mounting:** worlds are always mounted. Charting toggles visibility, never mounts.
- **Detail by distance:** a three.js `LOD` (64/24/12 segments, one shared unit sphere scaled per body, same material, no new program) on every planet and world, including the atmosphere and limb shells.
  - The overlay shells are also culled beyond a distance where they contribute under a pixel.
- **No extra meshes for uncharted worlds:** no guide ring or gravity circle. A charted world's orbit line costs one call.
- **The deep-space probe point (r 288) moves,** because it is now inside the orbit band. Pick a point clear of every orbit, facing away from the sun as today.
- **Re-baselining, not squeezing.** The new worlds don't have to fit today's ceilings. The ceilings are re-derived after adding them:
  - run the probe ~11 times, since counts depend on orbital phase;
  - apply the rule (+15%, rounded up to ten);
  - date it, and say what was added.
  - Never choose phases or points to keep worlds out of view.
  - Draw calls are the tightest number: deep space reads 35/40.
- **A new probe state** close to the ringed giant, with the rings in frame.

## Shipping (*my call*)

Two PRs, each shipped before the next.

1. **C1 — The worlds (PR #34).**
   - Covers the worlds, the edge move, light and fill falloff, occluders, rings, assets, charting, the logbook section, the chart and the local title.
   - The AURUM plume waits for C2, because a plume id goes on the wire.
   - No Worker change.
   - Changelog: "New Worlds".
2. **C2 — The cartographer in the live sky (PR #35).**
   - Covers `ch`, the plume, the shout-out and the consent update.
   - **Worker deployed first and verified, then the site merged.**
   - Changelog entry.

## Owner gates

1. **This document.**
2. **Before C1's code:** the Blender Cycles turntables of the five worlds, beside their references.
3. **Before C1 merges:** in-game screenshots:
   - each world, from close and from the spawn's direction;
   - the rings lit and backlit;
   - an existing planet's night side under the fill falloff;
   - the logbook chart.
4. **Before C2 merges:** the Worker deploy, run by me when the owner says so.

## Constraints

- Every existing clearance test passes, and nothing existing moves. The new world clearance test covers worlds against planets, worlds, comets, landmarks, the jelly path and the belts.
- `docs/UNIVERSE-RULES.md` gains the worlds under the laws they touch, including the disclosed P3 ring-shadow blur:
  - L9 exceptions;
  - L14 (rings at the Roche limit);
  - L19 (exposure and fill);
  - L20 (ring shadows);
  - L35/L36 (sizes).
- One changelog entry per PR.
- Subagents never install packages, kill processes by name, dispatch subagents or push.

## Non-goals

- Moons for the new worlds.
- Eccentric orbits.
- Landing.
- Accounts or durable server-side identity.
- Losses, realms or competition beyond the visible title.
- Moving the belt, the spawn or any landmark.
- Flight assist and Newtonian gravity (F1, F2).
- Flattening the Jupiter-type: a follow-up.

## Anti-goals

- A world that looks like a stylised ball next to the existing planets, or reads black because of the light law.
- A stated fact that is false where the world orbits.
- A pilot made invisible by a deploy-order mistake.
- A shout-out usable for spam, or any free text on the wire.
- A recruiter's path made slower or more confusing: the worlds stay off the jump keys and waypoints.

## Left to the builder

- Exact orbital elements, from the search under the stated rules.
- Noise parameters and look-dev iterations.
- Ring strip resolution.
- LOD and shell-cull distances.
- The SVG chart's layout.
- Exact radio and scan wording within the templates above.
- How the stars become background.
- How the probes are rewritten.

## Open question for the owner

**The roster.** A real Mercury and Venus orbit inside the Earth-type world (115). There is no room there without moving the asteroid belt, the halo, the spawn, the shipyard, the ring course and shards. Venus-type worlds also exist only close to their star: runaway greenhouse heating needs strong sunlight, so a Venus-type past the Mars-type would be a lie.

- **A (recommended):** the ringed giant, both ice giants and the airless rock, plus a **Ceres-type salt-spotted dwarf** instead of the Venus-type. It sits at real Ceres's own distance (2.77 AU). Every fact is honest and nothing existing moves.
- **B:** rebuild the inner system so a Mercury-type and a Venus-type get their real places (0.39 and 0.72 AU). This moves the belt and the halo, plus the spawn, shipyard, ring course and shards, and with them the recruiter path. It is much bigger and riskier, so it would be its own sub-project first.
