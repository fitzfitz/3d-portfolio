# Shipyard and Dormant Gate (B2) — Design

**Date:** 2026-10-16
**Status:** Approved in conversation, pending written-spec review
**Goal:** Build the homes for two of the three big features still to come. The **shipyard** is a dock whose Hangar dialog becomes the one place you change your ship's look: it takes over the engine-plume picker now, and hull paint joins it later. The **dormant gate** is a huge alien arch far out in the system that does nothing yet except be found, flicker and refuse to explain itself; the secret sector will go through it.

## Context and decisions

- This is sub-project B2 of the landmarks round. B1 (career station and trail, PR #26) shipped the destination table this builds on: `src/data/destinations.ts`.
- What the user picked:
  - Scope: the shipyard is a real hangar now (with the existing plume picker); the gate is a teaser only.
  - The plume picker **moves** to the hangar; the logbook keeps only a pointer to it.
  - The gate is a **pure mystery**: no stated wake-up condition, no progress lights. The secret-sector project decides what wakes it.
  - Navigation: the shipyard has a jump key and is listed everywhere a destination is, but stays **out of the waypoint chain**. The gate has no key and no waypoint; it is found by flying, and the radar shows it only as an unlabelled dot.
  - The gate is an **ancient alien arch**, not a ring (the contact portal is already a glowing ring).
  - Structure: the shipyard is one more destination row; the gate is a standalone landmark module, like the career trail.
  - Budget: small models, then a deliberate, documented re-baseline of the ceilings they push past.
  - The four deferred PR #25 cleanups ride along in this PR (§4).
- Rules that bind every landmark (user memory): everything visible must be flyable-to; non-project bodies must not look like planets; build only what the user picked.

## 1. What you see and where

### Shipyard: an open dry dock
- Two long, parallel truss arms with a cradle between them and a gantry crane spanning the top. It reads as scaffolding, never as a sphere, and must not resemble the career station's hub-and-ring silhouette.
- Palette: neutral greys, white work lights and a **steel-blue** accent `#5b8cff` (`SHIPYARD_BLUE`). That keeps it distinct from career amber `#ffb547`, contact pink `#ec4899` and the planets' green `#00ff87`, cyan `#00f0ff` and violet `#bd00ff`.
- Motion: the crane trolley slides slowly along the gantry and back (a period of about 20 s). It stops under reduced motion, like other ambient motion.
- Size: bounding radius about 5, like the career station, so its dock radii follow the station's.
- Position: in the inner system, above the orbital plane, on the spawn side, so the hangar is a short trip after a jump. The target is `(-70, 30, 45)`. It sits inside the innermost planet orbit (radius 115) and above the asteroid belt (r 40–70, in-plane). The final value is the nearest point to the target that passes the clearance test (below); the data file records why it moved, as `careerTrail.ts` does.

### Dormant gate: an ancient alien arch
- A huge hexagonal frame of six dark, basalt-like segments. Two segments are cracked through and one is missing outright, leaving a gap in the hexagon. Faint **teal** glyph seams (`GATE_TEAL = "#3de0c8"`) run along the segments.
- Size: bounding radius about 15 (about 3× the career station), the largest built object in the system.
- Position: far out, in the corner of the system away from the planet orbits, the portal and the career station. The target is `(-150, 130, 90)`. The constraint is that every coordinate's absolute value is below 200, so it never sits in the edge haze, which starts at 215 on the nearest axis (`src/utils/edgeHaze.ts`). The final value is the nearest point to the target that passes clearance.
- Orientation: the opening faces the sun (its axis points at the origin), so from the inner system you see it face-on as a dark hexagonal silhouette with faint seams.
- The opening is open space, and the frame has no collider, like the station and the portal.

### Placement rules (tested)
- Both landmarks must clear every planet's full orbit (planet size plus its moons' reach), the sun, the contact portal, the career station and every career buoy, every ring-course gate, the asteroid-belt colliders and the data-shard positions. The gate must also stay outside the edge haze. This uses the same clearance approach as `tests/planetClearance.test.ts` and `tests/careerTrail.test.ts`.
- Each landmark's numbers live in one data file (`src/data/shipyard.ts`, `src/data/dormantGate.ts`), which both the scene and the tests read.

## 2. How it works

### Destination table changes (`src/data/destinations.ts`)
- `DestinationId` becomes `"contact" | "career" | "shipyard"`.
- `Destination` gains `waypoint: boolean`: whether the guided waypoint may point here. Career and contact are `true`; the shipyard is `false`.
- `afterPlanets` only considers waypoint rows, so the waypoint chain stays planets → career → contact. Without this the shipyard, which has no logbook entry, would capture the waypoint forever.
- The new row, in table (key) order between career and contact:
  `{ id: "shipyard", label: "SHIPYARD", jumpLabel: "Shipyard", scanLabel: "DRYDOCK_01", pos: SHIPYARD_POS, color: SHIPYARD_BLUE, waypoint: false, ...SHIPYARD_RADII }`.
- `SHIPYARD_RADII` follows `STATION_RADII`'s method:
  - `jumpR` is the model's bounding radius plus `PLAYER_SHIP_SCALE`'s half length, so a jump parks the whole ship clear of the hull.
  - `lockR` is above `jumpR`, so a jump docks on arrival.
  - `orbitR` is inside `retainR` (`tests/orbitInvariant.test.ts`).
  - The exact values follow the measured model radius and are pinned in the contract test.
- Because consumers already read the table (B1), the zone, lock, jump validation, radar marker, HUD sector list, jump keys and scannable all pick the shipyard up from the row.

### Hangar dialog
- Docking at the shipyard (orbit lock in its zone, exactly as at the station) opens a **Hangar** dialog (`src/components/layout/HangarPanel.tsx`). App picks the dialog by `activeZone`, as it does for the career dossier and the contact form.
- Dialog conventions match the dossiers: `role="dialog"`, `aria-modal`, a labelled heading `SHIPYARD // HANGAR`, Esc and a close button, and focus moved in on open and restored on close.
- Contents: the **engine plume picker** only. It is extracted from `LogbookPanel.tsx` into `src/components/layout/PlumePicker.tsx` unchanged: the same radiogroup, `data-testid="plume-<id>"` hooks, locked labels (`…plume, locked: earn <badge>`) and the `plumeAllowed` rule. There is no hull-paint placeholder; hull paint is added to this dialog by its own project.

### Logbook changes
- `LogbookPanel` no longer renders the picker. Each badge keeps its colour dot.
- Where the picker was, one line reads `ENGINE PLUME: <NAME> · CHANGE IT AT THE SHIPYARD [5]`, where `<NAME>` is the current plume's name (for example `CYAN`).
- `badgeLine` ends `… <NAME> PLUME UNLOCKED. DOCK AT THE SHIPYARD [5]` instead of `… PRESS L`.
- The shipyard gets no logbook entry: it is not something a visitor must do. Essentials stay at five.

### Keys and gamepad
- Number keys and the HUD sector list: `[1–3]` planets, `[4]` Career, `[5]` Shipyard, `[6]` Contact. Contact moves from 5 to 6.
- The gamepad maps jumps **by destination id**, never by table index:
  - `PadAction`'s jump variant carries an `id`.
  - D-pad clockwise from up: the three planets and Career (as today).
  - Menu/Start (button 9): `contact` (as today).
  - View/Back (button 8, unused today): `shipyard`.
  - Adding a destination row can no longer silently remap a button.

### Dormant gate (`src/data/dormantGate.ts`, `src/components/canvas/DormantGate.tsx`)
- **Idle:** the glyph seams pulse faintly (period about 6 s, low intensity).
- **Approach:** within `GATE_SENSE_R = 60` units of the gate centre, the seams brighten and flicker irregularly (seeded noise on the intensity), as if the gate senses you. This uses emissive-intensity uniform changes only.
- **Scan:** a scannable labelled `UNKNOWN_STRUCTURE`. Its scan report reads `ORIGIN UNKNOWN // DORMANT // NO RESPONSE TO HAIL`.
- **Radio:** two one-time lines per page load, sent as content broadcasts so the 8 s hold (`src/utils/radioHold.ts`) protects them from chatter:
  - First time inside `GATE_SENSE_R`: `CONTROL // THAT STRUCTURE ISN'T ONE OF OURS. NO RECORD OF IT ANYWHERE.`
  - First pass through the opening: `CONTROL // YOUR READINGS SPIKED THE MOMENT YOU CROSSED. THEN NOTHING.`
- **Pass-through detection:** a pure function in `src/utils/gatePass.ts`. A pass is a sign change of the ship's signed distance to the gate plane between two frames, where the crossing point lies within the opening's inner radius.
- **Radar:** an unlabelled grey dot: no name, no colour, no ring.
- **Absent on purpose:** no jump key, no waypoint, no dock, no logbook entry, no HUD target label. Outside the scanner, the gate never names itself.
- **Reduced motion:** the seams hold a steady low glow (no pulse, no flicker). The radio lines still play.

## 3. Assets, performance and tests

### Assets
Two new seeded Blender generators, following the asset-pass conventions: deterministic, source in `assets-src/`, `npm run assets:optimize`, a provenance row and a MANIFEST hash.

**`scripts/blender/gen_shipyard.py` → `shipyard.glb`**
- At most 5,000 triangles and at most 4 draw calls.
- A separate `CraneTrolley` node that the app slides along its local x axis.
- An emissive `WorkLight` material.
- The steel-blue accent is a `baseColorFactor` over a neutral grey bake, the approach the hero ship's paint zones use.

**`scripts/blender/gen_dormant_gate.py` → `dormant_gate.glb`**
- At most 3,000 triangles and at most 2 draw calls.
- A `GateStone` material (baked base plus normal) and an emissive `GlyphSeam` material, whose intensity the app drives.
- The five present segments (the sixth slot is the gap) are joined into one stone mesh, so the frame costs one draw call and the seams the other. Two of the five are visibly cracked.

**Contract tests.** `tests/assetContracts.test.ts` pins for both models:
- node and material names;
- triangle and draw-call budgets;
- bounding radius. The radius feeds the shipyard's `jumpR` check and both clearance tests.

`tests/assetProvenance.test.ts` lists both generators. `scripts/blender/generate.sh` and `scripts/optimize-assets.mjs` include both.

### Performance
- No new lights: `LIGHT_BUDGET` stays 4. Glow is emissive plus bloom.
- Materials reuse existing configurations: baked base plus normal for hulls and stone, untextured emissive for lights and seams. The seam pulse and flicker are uniform values. The `programs` probe's tour gains the shipyard and the gate, and must still add no program.
- Budget re-baseline:
  - B1 left the modal-open state at 126/130 calls and 414k/420.6k triangles, so two more models exceed the ceilings.
  - After implementation, measure the states with `npm run test:e2e -- transition` and raise only the ceilings that the new models push past, by the measured additions under the existing rule (baseline + 15%, rounded up to the nearest ten).
  - Add a dated note to `docs/PERF-BUDGETS.md` naming the two models and their measured cost. Leave every other ceiling unchanged.

### Tests
**Unit tests**
- Destination table:
  - contact's and career's values are unchanged;
  - ids are unique and reserved against project ids;
  - the shipyard has `waypoint: false`;
  - the shipyard's `jumpR` sits inside `lockR` and outside the model radius plus the ship's half length.
- `afterPlanets` and `nextWaypoint` never return `shipyard`, for any badge state.
- `JUMP_TARGETS` order: planets, career, shipyard, contact.
- Gamepad: the d-pad maps to planets plus career, Menu to `contact` and View to `shipyard`, all by id.
- Plume rules unchanged (`plumeAllowed`); `badgeLine`'s new wording.
- Placement clearance for the shipyard and the gate, and the gate's coordinates all below 200 in absolute value.
- Gate: proximity (`GATE_SENSE_R`) and pass-through detection as pure functions, including a pass outside the opening (no trigger) and a slow drift across the plane (exactly one trigger).

**End-to-end**
- Key 5 docks at the shipyard and opens the Hangar; selecting an unlocked plume there changes the plume.
- The logbook has no picker and shows the pointer line.
- Key 6 reaches the contact portal and opens the contact form.
- Scanning the gate reports `ORIGIN UNKNOWN // DORMANT // NO RESPONSE TO HAIL`.
- Teleporting inside `GATE_SENSE_R` plays the first gate radio line.
- The gamepad probe uses the new mapping (View → shipyard, Menu → contact).
- The programs probe still passes with the longer tour, and every budget ceiling passes.
- The logbook and gameplay probes that clicked `plume-<id>` in the logbook now open the Hangar first.

## 4. PR #25 cleanups (ride-along)
1. `tests/assetContracts.test.ts`: the crystal comment says "seven shards"; the model has six. Fix the comment.
2. `tests/assetContracts.test.ts`: the cargo-ship `≤ 12000` triangle check is redundant with the tighter "five on screen" cap (≤ 8500). Remove it, and update the asset-pass spec §2's freighter budget line to match.
3. `tests/assetContracts.test.ts`: the hero-ship footprint check uses an absolute tolerance (`0.14`) while its title says "within 5%". Make it relative: 5% of each extent.
4. `scripts/blender/bake_utils.apply_baked_material` leaves seven `HullBaked` primitives per freighter. Join the same-material primitives so each freighter has one, then regenerate `cargo_ship.glb`. The freighter's existing contracts must still pass; its draw calls in the `transition` probe should fall.

## Delivery
- One PR (#28) on `feat/landmarks-b2`, with its changelog entry (`pr: 28`). `assets-src` commits are pushed before the PR opens.

## Out of scope
- Hull paint, and any hull-paint UI or placeholder in the Hangar.
- Waking the gate, its unlock condition, and the secret sector.
- Landing on planets.
- New logbook entries or badges.
