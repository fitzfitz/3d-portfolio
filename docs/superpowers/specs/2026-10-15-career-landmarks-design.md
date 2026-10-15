# Career Landmarks (B1) — Design

**Date:** 2026-10-15
**Status:** Approved in conversation, pending written-spec review
**Goal:** Put the career history into the universe: a career station you dock at to read a Career dossier, and a trail of five buoys, one per job in date order, that you can fly through. Along the way, replace the hard-coded `"contact"` destination with a small destination table, so later landmarks (B2's shipyard and gate) are one row each.

## Context and decisions

- This is sub-project B1 of the landmarks round. B2 (shipyard + dormant gate, homes for hull paint and the secret sector) gets its own spec after this ships. The user picked: "big-3 homes + career"; shipyard and dormant gate (no wreck); career as "station + trail"; B1 first.
- Rules that bind every landmark (user memory): everything visible must be flyable-to; non-project bodies must not look like planets; build only what the user picked.
- Career data already exists: `src/data/career.ts`, five engineering roles (SoftwareSeni 2015 → Hubexo, current), rendered today only by the résumé's `src/components/sections/Career.tsx`. No new content is written; the landmarks present this data.

## 1. What you see and where

### Career station
- A modular orbital station: central hub cylinder, a slowly turning habitat ring, two solar-panel arms, small amber docking lights. It must read as something built, never as a sphere or planet.
- Palette: neutral greys with **amber** accents (`#ffb547` family), distinct from the contact portal's pink and the three planet colours.
- Position: below the orbital plane, mirroring the portal above it. Target `(0, -95, 150)`; the final value is whatever passes the clearance test (below) nearest to that target. Like the portal, you have to dive to reach it.
- The habitat ring turns at a slow constant rate (stops under reduced motion, like other ambient motion).

### Career trail
- Five navigation buoys: a short mast, a glowing amber ring, a blinking tip light. One buoy per career entry.
- Order: oldest first. The trail starts near the spawn area with SoftwareSeni (2015): the first buoy sits 30–45 units from the spawn point `(0, 0, 18)`, clear of the spawn pad and the ring-course gates. The trail then curves down toward the station and ends beside it, 15–25 units from the station centre, with Hubexo (current).
- Consecutive buoys are joined by a dashed guide line using the existing `makeGuideLineMaterial` (the material planet orbits already use).
- Spacing: roughly even along the curve, at least 20 units apart, so each card has room to be read.

### Placement rules (tested)
- Station and every buoy must clear: every planet's full orbit (including planet size and its moons' reach), the sun, the contact portal, every ring-course gate, the asteroid-belt colliders, and the data-shard positions, using the same clearance approach as `tests/planetClearance.test.ts`.
- Positions live in one data file (`src/data/careerTrail.ts`), so the test and the scene read the same numbers.

## 2. How it works

### Destination table
Today `"contact"` is a string checked in about 12 places (App jump list and modal, store jump validation and logbook hook, navigation fallback, radar, waypoint, HUD, ship lock, zone detection, scannables). This change introduces `src/data/destinations.ts`:

```ts
interface Destination {
  id: "contact" | "career";
  label: string;            // HUD / waypoint label, e.g. "CONTACT PORTAL"
  jumpLabel: string;        // jump list label, e.g. "Contact"
  scanLabel: string;        // scannable label, e.g. "PORTAL_SUN"
  pos: [number, number, number];
  color: string;
  zoneR: number; lockR: number; retainR: number; orbitR: number;
}
export const DESTINATIONS: readonly Destination[];
```

- `contact` keeps its current position, radii, labels and colour exactly (behaviour unchanged).
- `career` is the station. The station model has a bounding radius of about 5 units (about 4× the portal), so its radii keep the portal's ratios scaled by 3.85: `zoneR` 8.5, `lockR` 5.8, `retainR` 13, `orbitR` 10. This keeps `orbitR` inside `retainR` as `tests/orbitInvariant.test.ts` requires.
- Every consumer that special-cases `"contact"` reads the table instead: zone detection and lock in `SpacePlanets.tsx`, the lock geometry in `Spaceship.tsx`, jump validation in `spaceStore.ts`, `RadarMap.tsx`, `WaypointDriver.tsx`, the HUD sector list, App's `JUMP_TARGETS`, and scannable registration.
- `RESERVED_ZONE_IDS` becomes the table's ids, so no project can claim `career` either.
- The contact form modal and the career dossier stay separate components; App picks the modal by `activeZone`.

### Career dossier
- Docking at the station (orbit lock in its zone, exactly like the portal) opens a Career dialog listing all five roles: role, company (+ note), dates, employment type, location, summary.
- It reuses the résumé's rendering: the list markup in `Career.tsx` is extracted into a shared `CareerList` component that both the résumé section and the dialog render, so the two can never drift.
- Same dialog conventions as the project dossiers: `role="dialog"`, `aria-modal`, Esc / close button, focus handling.

### Buoy cards
- Flying within a buoy's card radius (about 6 units), or scanning it, shows a compact HUD card: role, company, dates, one-line summary. It fades when you leave. No docking, no orbit lock: the trail is cruised.
- Each buoy is a scannable (`setScannable("career_<n>", …, "CAREER_<YEAR>")`), so the existing scanner and scan report work on it.
- The card is DOM (like the other HUD panels) and is driven from the frame loop through a small module-level state, without React re-renders per frame (the same pattern as `waypointState`).

### Recruiter path, keys and logbook
- Jump keys and HUD list: `[1–3]` planets, `[4]` Career, `[5]` Contact (contact moves from 4 to 5).
- Gamepad: the d-pad (clockwise from up) keeps mapping to targets 1–4, so it now reaches the three planets and Career. Contact (target 5) moves to the Menu/Start button (standard-mapping button 9, currently unused).
- Logbook: a fifth essential, "Read the career dossier" (`id: "career"`), recorded when you dock at the station, like the portal's essential.
- Waypoint order: nearest unread planet first, then the career station, then the contact portal.
- Radar: the station shows as an amber marker; buoys show as small amber dots.

## 3. Assets, performance and tests

### Assets
- Two new seeded Blender generators, following the asset-pass conventions (deterministic, `assets-src/` source, `npm run assets:optimize`, provenance row, MANIFEST hash):
  - `scripts/blender/gen_career_station.py` → `career_station.glb`: ≤ 6,000 triangles, a separate `HabitatRing` node (the app spins it), emissive `DockLight` material.
  - `scripts/blender/gen_buoy.py` → `buoy.glb`: one mesh, ≤ 400 triangles, emissive `BuoyGlow` material.
- `tests/assetContracts.test.ts` gains contracts for both (names, node layout, budgets). `tests/assetProvenance.test.ts` lists both generators.

### Performance
- No new lights (`LIGHT_BUDGET` stays 4); glow is emissive plus bloom.
- The five buoys are one `InstancedMesh`.
- Materials follow existing configurations (baked base + normal for hulls, untextured emissive for lights), so the shader-program count stays flat. The `programs` probe must still show the tour adding none.
- Triangle headroom in deep space is about 10.5k (240k of 250.6k). Station (≤ 6k) plus buoys (≤ 2k) fits; the `transition` probe must still pass every ceiling.

### Tests
- Unit tests:
  - Destination table: contact's values are unchanged, ids are unique, and they are reserved against project ids.
  - `nextWaypoint` order: planets, then career, then contact.
  - Logbook: five essentials, with `career` recorded on dock.
  - Placement clearance for the station and all buoys.
  - Buoy order matches `career.ts` (oldest first) and the count matches.
  - Buoy-card visibility logic (pure function: ship position → active buoy or none).
- e2e: jump with key 4 docks at the station and opens the Career dialog; key 5 still reaches the contact portal; flying to a buoy shows its card; scanning a buoy reports it; no new shader program; all budgets pass.

## Delivery
- One PR on `feat/landmarks` with the changelog entry (`pr` = next free number). `assets-src` commits are pushed before the PR opens.

## Out of scope
- B2: shipyard and dormant gate.
- Hull paint, the secret sector, landing on planets.
- Any change to career content.
