# Combat: the Nest (design)

**Date:** 2026-10-27.
**Status:** the owner said "go ahead. just go ahead" and skipped the questions. Every decision below is the controller's call unless it is marked *(owner)*.
**Builds on:**
- the space monsters (PR #60; `docs/archive/specs/2026-10-23-space-monsters-design.md`);
- the game vision (battles → coins → shop → realms → PvP).

## Why

The owner wants "activity in my universe … battles … achievements" *(owner, 2026-10-20)*. The two monsters were built for this stage *(owner)*: the saucer alien fires bursts from an under-saucer cannon after a porthole chase-light, and the tardigrade "will attack me by shooting a beam at me" *(owner)*. The look is Pixar-film scary, fluffy and slimy *(owner)*. This stage makes them real enemies.

## Goals
- A place where a visitor can fight both monsters, win, lose and come back.
- Shooting that works with a mouse, a keyboard, a gamepad and touch, with no new buttons.
- A reward: a new logbook badge and plume colour.
- The visitor-facing groundwork that the coins stage builds on: hull, damage and defeat.

## Non-goals and anti-goals
- **Never an ambush.** Fights happen only inside one marked hostile zone that the visitor chooses to fly into. Most visitors are recruiters on their way to the projects; nothing attacks them anywhere else *(owner's rule, game vision)*.
- **No gore and no explosions.** Defeated monsters spin off dizzy or curl into a ball and drift away, as the monster design says *(owner-approved)*.
- **No real death.** Losing tows the ship out of the zone. Nothing is lost.
- **No server changes.** Combat runs in the browser. Monsters are per visitor; other live-sky pilots see your ship but not your fight. Coins and PvP come later.
- **No new art.** Use the PR #60 models, the existing buoy asset, and effects drawn in code.
- **No coins yet.** Shards-as-money is the next stage.

## The Nest (the hostile zone)
- **Placement.** One zone, "THE NEST", below the orbital plane in deep space.
  - Its centre is 300–500 u from spawn.
  - It sits at least `DEEP_SPACE_MIN` + the zone radius from every swept orbit (`tests/helpers/solarClearance.ts`).
  - It is at least 250 u from `DEEP_SPACE_POINT` (the perf baseline point), and more than 200 u from every stop on the programs probe's tour, so neither ever loads the monsters.
  - The builder places it with those tests.
- **Size, three radii** *(my calls, after the builder check)*:
  - **The zone, 70 u.** Crossing it inward is what starts a fight.
  - **The fighting area, 110 u (the leash).** Inside it the ship can fire, the monsters attack, `inNest` is true, the HUD shows the hull, and warp is held at normal speed (39 u/s, no cruise build-up, as in races). Monsters never go past it.
  - **The buoy, 120 u,** just outside the fighting area.
- **Finding it.**
  - A warning buoy 120 u from the centre, on the side facing the inner system. It reuses the buoy model with a red tint and blinking red light, and holds position like the career buoys.
  - Scannable: `SCAN[THE_NEST] // HOSTILE LIFEFORMS · ENTER AT YOUR OWN RISK · F OR CLICK TO FIRE`.
  - A red radar marker when within radar range; the live monsters show there as small red blips too (Ruling C24: only within radar range of the Nest).
  - An ambient radio line at most once per visit: `RADIO // SOMETHING IS NESTING BELOW THE PLANE. PILOTS REPORT SAUCERS`.
  - It is not on the jump keys; reaching it is part of the adventure.
- **The zone edge** is a faint red haze shell drawn only when the ship is within 30 u of it, like the world-edge haze. Crossing inward shows `ENTERING THE NEST` on the HUD.
- **Racing.** While racing, the zone does nothing: no waves, no shooting. The jellyfish guide never leads into the Nest and stops at its edge.

## The fight
- **When a fight starts.** A fight starts only when the ship crosses the 70 u zone boundary inward while the Nest is ready. Wave 1 comes 3 s later (the HUD shows `CONTACT IN 3…`). A ship that stays inside after a rest or a breach is never attacked again until it leaves and comes back in. No ambush, even inside the Nest.
- **Waves.**
  1. 3 saucers.
  2. 5 saucers.
  3. 1 tardigrade + 3 saucers.

  The next wave comes 5 s after the last monster of a wave is defeated. Clearing wave 3 is "NEST CLEARED". The Nest then rests for 2 minutes, after which it is ready again (the next inward crossing starts a fight).
- **Low-perf mode:** waves of 2, 3, then 1 tardigrade + 2.
- **Leaving.**
  - Monsters never go past the leash radius.
  - A ship more than 110 u from the centre is "out": monsters stop firing and drift back.
  - 20 s out ends the fight: the monsters leave, the wave resets to 1, and the Nest is ready again.
  - Leaving mid-fight is always allowed, and warp outruns everything.

### The ship
- **Hull:** 100. It shows as a HULL bar under the fuel bar while in the zone or while below 100.
- **Regeneration:** 6 per second after 4 s without damage, like fuel.
- **Hits:** each hit
  - plays the existing impact sound;
  - shakes the camera (none under reduced motion);
  - flashes the screen edge red briefly (a static tint under reduced motion);
  - rumbles a gamepad.
- **Hull 0:** "HULL BREACH".
  - The ship is towed to the warning buoy, outside the fighting area, with the teleport flash.
  - The hull is restored to 60. The fight ends: the monsters leave, the wave resets to 1, and the Nest is ready again.
  - Radio: `RADIO // HULL BREACH · TOWED TO THE BUOY · THE NEST IS STILL HUNGRY`.
- **Speed:** inside the fighting area, warp is held at normal speed (39 u/s, the open-space cruise build-up is off, as in races). Boost and normal flight work. Enemy bolts (48 u/s) are just faster than warp.

### The weapon
- **Desktop:**
  - **Left click** fires a plasma bolt from the ship's nose toward the clicked point, inside the fighting area. Outside the Nest, left click keeps making today's plasma sparks. One control, two meanings by place.
  - **F (the beam key)** fires while held, inside the fighting area only.
- **Gamepad:** LB fires while held, inside the fighting area only.
- **Touch:** the BEAM button reads **FIRE** inside the fighting area and fires while held.
- **Aim.** Held fire (F, LB, touch FIRE) aims with an assist: toward the nearest live monster inside a 12° cone of the nose, else straight ahead.
- **Rate:** 5 bolts per second, held or clicked.
- **Bolts:** 140 u/s, 160 u range.
- **Damage:** a saucer takes 3 hits, the tardigrade 18.
- **Look:** glowing plasma blobs (hot, excited matter, so L33 is fine) in the ship's plume colour.

### The saucers
- **Movement.**
  - They circle the ship at 18–35 u, strafing, at up to 14 u/s. They turn toward the ship and look at it (look pose).
  - Each has its own tint from `saucerTint(seed)`.
- **The attack.**
  - Every 3–5 s (random per saucer), a 1.0 s porthole chase-light (the warning), then a burst of 3 bolts 0.12 s apart from the cannon muzzle (`saucerMuzzle`).
  - The bolts are aimed at where the ship will be (simple lead), with ±2° of spread.
  - The cannon aims at the ship (aim pose) and the saucer leans into the fire pose.
- **Enemy bolts:** 48 u/s (just faster than warp, so dodge sideways, not straight away), 6 damage each, 120 u range. Coloured green-yellow to read as alien and differ from the ship's.
- **When hit:** the flinch pose (hit) for 0.25 s.
- **When defeated:** the defeat pose (dizzy spin). It drifts off with a smoke trail for 3 s, then fades or shrinks away. No explosion.

### The tardigrade
- **Movement.** It swims slowly (5 u/s) toward 40 u from the ship, always turning to face it.
- **The attack.**
  - Every 6–8 s it charges for 1.6 s: the mouth glows from 0 to full (the charge pose) and the body tenses. That is the warning.
  - It then fires a **plasma jet** for 1.2 s along the line it faced when the charge ended, so a moving ship can dodge. Recoil pose.
  - The jet is drawn as a stream of glowing plasma particles, not a laser line (L21: no beams through vacuum, but hot plasma is visible).
  - Range 90 u, radius 2.5 u. It deals 25 damage per second while the ship is inside it.
- **When hit:** a flinch.
- **When defeated:** it curls into a tun ball and drifts away (the curl pose).

### Rewards
- **Clearing the Nest** records a new badge, **"Nest breaker"** (hint `CLEAR THE NEST`).
  - It unlocks the plume colour **CRIMSON** (`#ff3b4a`).
  - It joins `LOGBOOK`, `BADGE_IDS` and `PLUME_COLORS`; the logbook goes from 6 to 7 badges.
- **Radio on clearing:** `RADIO // NEST CLEARED · THE CRITTERS WILL BE BACK`.
- Shards and coins rewards come with the coins stage.

## Look, sound and rules
- Monsters use the PR #60 materials and poses exactly as the monster lab drives them. Reduced motion uses `uMotion = 0`: the state poses stay and the decorative motion stops.
- Sounds stay inside the ship (L30): firing, hits on the hull, and the wave cue. Reuse `soundManager` cues. At most two new synthesized cues (fire and hull hit), if `soundManager` synthesizes.
- Monsters move under their own power: saucers show a small thrust glow and tardigrades swim. That covers L3 and L16 (no unexplained hovering). Keep `tests/universeRules.test.ts` green.
- Nothing here appears outside the Nest except:
  - the buoy;
  - the radar marker;
  - the edge haze within 30 u;
  - the one radio line.

## Performance
- **Loading on demand.**
  - The monster models (about 2.9 MB) load only when the ship comes within 200 u of the Nest's centre, and then stay loaded. A visitor who never goes near it downloads nothing.
  - They move out of `public/models-lab/` into a load-on-demand location that stays out of the startup asset packs. The monster lab follows them.
  - Their shader programs compile before wave 1 can start. The first wave waits for that, and the HUD says `CONTACT IN …`.
- **Draw calls.**
  - The monsters stay instanced: saucers 4 calls and the tardigrade 3, whatever the count.
  - Bolts (player and enemy) are one instanced call.
  - The plasma jet is one call.
  - Smoke trails are one call.
- **A new perf state, "In the Nest (wave 3)",** gets its own call, triangle and program ceilings. They are measured and recorded in `docs/PERF-BUDGETS.md` using the existing derivation (baseline +15%). Every other state's ceilings are unchanged: no monster draws outside the zone.
- **The programs probe's tour** stays at zero new programs. The Nest is not on the tour; a separate combat probe checks its own program set.
- **Allocation:** no per-frame allocations in the combat loop (pooled bolts, monsters and particles). The idle-allocation budget is unchanged.

## State
- **Per-frame:** a new mutable `combat` object next to `flight` (non-React, read in frames). It holds hull, monsters, bolts, wave and timers.
- **React-visible:** a small store slice `combat`, with `inNest`, `wave`, `contacts`, `hullBreachAt` and `nestClearedAt`. It changes only at events: zone entry and exit, wave start, a defeat, a breach, clearing.
- **`tests/storeShape.test.ts`** is updated on purpose.
- **Persisted:** only the badge, through the logbook. Hull and waves reset on reload.

## Tests
- **Unit:**
  - wave sequencing (entry, clear, rest, leave and reset);
  - hull damage and regeneration, and the breach tow;
  - saucer attack timing and lead aim;
  - tardigrade charge and jet line hit tests;
  - bolt-versus-sphere hits;
  - the aim-assist cone;
  - the zone and leash rules;
  - control mapping by place (click and F inside versus outside);
  - the badge, plume and logbook counts;
  - the placement and clearance tests for the Nest and the buoy.
- **e2e probe `combat`:**
  - away from the Nest: no monsters, no models fetched, and left click makes plasma sparks;
  - fly in: the models load and wave 1 spawns 3 saucers;
  - fire and defeat a saucer;
  - take hits and see the hull drop;
  - a breach tows the ship to the buoy;
  - debug-clear the waves and get the badge;
  - the perf ceilings for the new state;
  - reduced motion.
- **Changelog:** one visitor-facing entry.

## Out of scope
- Coins, the shop, ship upgrades and shields.
- Monsters anywhere but the Nest, roaming events, and boss variants.
- Sharing fights through live sky, co-op and PvP.
- New models or new sound files.
