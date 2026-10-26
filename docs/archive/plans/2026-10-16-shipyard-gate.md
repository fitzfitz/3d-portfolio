# Shipyard and Dormant Gate (B2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dockable shipyard whose Hangar dialog takes over the engine-plume picker, and a dormant alien gate far out in the system that can be found, scanned and flown through but does nothing yet.

**Architecture:** The shipyard is one more row in `src/data/destinations.ts` (B1's table), flagged `waypoint: false` so the guided path skips it; every destination consumer picks it up from the row. The gate is a standalone landmark like the career trail: a data file, a pure logic module (`src/utils/gatePass.ts`), and one scene component. Both models are seeded Blender generators that reuse the freighter's material configurations, so no shader program is added. The gamepad maps jumps by destination id instead of table index.

**Tech Stack:** React 19 + react-three-fiber + drei, three.js, zustand, Vitest, Puppeteer e2e probes (`tests/e2e/*.probe.mjs`), Blender 5.1 headless (`~/Applications/Blender.app/Contents/MacOS/Blender`), gltf-transform (`npm run assets:optimize`).

**Spec:** `docs/archive/specs/2026-10-16-shipyard-gate-design.md`

## Global Constraints

- Branch `feat/landmarks-b2`; one PR, number **#28**; its changelog entry has `pr: 28`.
- Shipyard position `SHIPYARD_POS = [-70, 30, 45]`; gate position `GATE_POS = [-150, 130, 90]`. Both already pass every clearance rule (checked while planning); the tests in Task 1 pin that.
- Colours: shipyard `#5b8cff` (`SHIPYARD_BLUE`), gate seams `#3de0c8` (`GATE_TEAL`), gate radar dot `#8a8f98`.
- Keys: `[1–3]` planets, `[4]` Career, `[5]` Shipyard, `[6]` Contact. Pad: d-pad = 3 planets + career, Menu (button 9) = `contact`, View (button 8) = `shipyard`.
- Copy, verbatim:
  - Hangar heading `SHIPYARD // HANGAR`.
  - Logbook pointer `ENGINE PLUME: <NAME> · CHANGE IT AT THE SHIPYARD [5]`.
  - Badge line ending `<NAME> PLUME UNLOCKED. DOCK AT THE SHIPYARD [5]`.
  - Gate scan `SCAN[UNKNOWN_STRUCTURE] // ORIGIN UNKNOWN // DORMANT // NO RESPONSE TO HAIL`.
  - Gate radio, approach: `CONTROL // THAT STRUCTURE ISN'T ONE OF OURS. NO RECORD OF IT ANYWHERE.`
  - Gate radio, pass: `CONTROL // YOUR READINGS SPIKED THE MOMENT YOU CROSSED. THEN NOTHING.`
  - Derive the `[5]` from `jumpKey("shipyard")`; never hard-code it.
- No new lights (`LIGHT_BUDGET` stays 4). No vertex colours, no tangents. Every new material must match an existing texture set: `HullBaked` ↔ the cargo ship's `HullBaked`; emissive ↔ the cargo ship's `NavRed`.
- Budgets:
  - `shipyard.glb`: ≤ 5,000 triangles, ≤ 4 primitives, max radius ≤ 5.0 (so `SHIPYARD_RADII.jumpR` 6.7 clears the ship's half length).
  - `dormant_gate.glb`: ≤ 3,000 triangles, ≤ 2 primitives, max radius ≤ `GATE_RADIUS + 0.5`.
- The gate never names itself outside the scanner: no jump key, waypoint, dock, logbook entry, HUD target label or radar label.
- **Subagents must not install packages** (no `npm install`, `pnpm`, `npx <uninstalled>`), and **must not kill processes by name** (no `pkill`, `killall`, `kill -9` on anything they did not start by PID).
- Push as `fitzfitz` with `git -c credential.helper='!gh auth git-credential' push`. Push `assets-src` (its own repo) before opening the PR. If a push stalls, add `-c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60`.
- Before `npm run test:e2e`: close Playwright tabs and make sure nothing is listening on port 5199.

## Review Focus

1. **A jump, teleport or wrap across the gate plane** must not count as flying through the gate. Task 5 tests that a 50-unit step across the opening triggers no pass line, through `crossesGate`'s `MAX_STEP`.
2. **The waypoint and the "next stop" broadcast never point at the shipyard**, even with every logbook entry done. Task 2 tests `afterPlanets` for every badge subset.
3. **Fuel crystals must not spawn inside the gate's frame.** Task 2 tests that `CRYSTAL_LANDMARKS` includes `GATE_POS` and rejects a spawn at the gate centre and 14 units off it.
4. **View or Menu pressed in photo mode, or with the classic résumé up**, must not jump. Task 3 tests both.
5. **The gate's radio lines play once per page load.** Re-entering the sense radius or flying through again stays silent, and a first visit that is a pass plays only the pass line. Task 5 tests all three.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/data/shipyard.ts` | create | Shipyard position, dock radii, colour |
| `src/data/dormantGate.ts` | create | Gate position, sizes, axis, labels, radio copy |
| `src/data/destinations.ts` | modify | Shipyard row, `waypoint` flag, `jumpKey`, `afterPlanets` over waypoint rows |
| `src/utils/crystalField.ts` | modify | `CRYSTAL_LANDMARKS` (destinations + gate) |
| `src/components/canvas/FuelCrystals.tsx` | modify | Uses `CRYSTAL_LANDMARKS` |
| `src/utils/scanReport.ts` | modify | Shipyard and gate scan reports |
| `src/utils/gamepad.ts` | modify | Jumps by id; View → shipyard |
| `src/hooks/useGamepadInput.ts` | modify | `runPadAction` without `jumpIds`; linked message |
| `src/App.tsx` | modify | `useGamepadInput()`; Hangar dialog on `shipyard` |
| `src/components/layout/PlumePicker.tsx` | create | Pure plume radiogroup (moved from the logbook) |
| `src/components/layout/HangarPanel.tsx` | create | Shipyard dock dialog |
| `src/components/layout/LogbookPanel.tsx` | modify | Picker replaced by the pointer line |
| `src/utils/logbook.ts` | modify | `badgeLine` wording |
| `src/utils/gatePass.ts` | create | Gate sensing, pass detection, one-time radio, seam intensity |
| `scripts/blender/gen_shipyard.py` | create | `shipyard.glb` |
| `scripts/blender/gen_dormant_gate.py` | create | `dormant_gate.glb` |
| `scripts/blender/bake_utils.py` | modify | Merge duplicate material slots after baking |
| `src/components/canvas/Shipyard.tsx` | create | Shipyard model; slides the crane trolley |
| `src/components/canvas/DormantGate.tsx` | create | Gate model, facing, seams, scannable, radio |
| `src/components/canvas/GlobalCanvas.tsx` | modify | Mounts both |
| `src/components/layout/RadarMap.tsx` | modify | Unlabelled grey gate dot |
| `tests/helpers/clearance.ts` | create | Clearance helpers shared by landmark tests |
| `tests/shipyardGate.test.ts` | create | B2 placement and data |
| `tests/gatePass.test.ts` | create | Gate logic |
| `tests/hangar.test.ts` | create | Hangar and picker markup |
| `tests/e2e/shipyard.probe.mjs` | create | Hangar, plume, key 6, gate scan and radio |
| `README.md`, `docs/PERF-BUDGETS.md`, `src/data/changelog.ts` | modify | Docs, budgets, patch note |

---

### Task 1: Landmark data and placement tests

**Files:**
- Create: `tests/helpers/clearance.ts`
- Create: `src/data/shipyard.ts`
- Create: `src/data/dormantGate.ts`
- Create: `tests/shipyardGate.test.ts`
- Modify: `tests/careerTrail.test.ts:12-53` (use the shared helpers)

**Interfaces:**
- Produces:
  - `SHIPYARD_POS: Vec3`, `SHIPYARD_RADII: { zoneR; lockR; retainR; orbitR; jumpR }`, `SHIPYARD_BLUE: string` (`src/data/shipyard.ts`).
  - `GATE_POS: Vec3`, `GATE_RADIUS = 15`, `GATE_OPENING_R = 10`, `GATE_SENSE_R = 60`, `GATE_KEEP_OUT = 20`, `GATE_NORMAL: Vec3` (unit, toward the sun), `GATE_TEAL`, `GATE_RADAR_GREY`, `GATE_SCAN_ID = "dormant_gate"`, `GATE_SCAN_LABEL = "UNKNOWN_STRUCTURE"`, `GATE_LINES: { approach: string; pass: string }` (`src/data/dormantGate.ts`).
  - Test helpers `d3`, `closestApproach`, `beltClearance`, `MOON_REACH_FACTOR`, `MARGIN` (`tests/helpers/clearance.ts`).

- [ ] **Step 1: Extract the clearance helpers**

Create `tests/helpers/clearance.ts`. Vitest only collects `*.test.ts`, so this file is not run on its own.

```ts
import { planets } from "../../src/constants";
import { orbitPosition } from "../../src/utils/orbits";

/**
 * Clearance helpers shared by the landmark placement tests
 * (careerTrail.test.ts, shipyardGate.test.ts), same approach as
 * planetClearance.test.ts.
 */
export const SAMPLES = 2000;
/**
 * A planet's reach: its farthest moon is fuxx's ice moon, orbiting at 2.1 ×
 * size with radius 0.0625 × size (SpacePlanets.tsx), so 2.2 × size covers
 * the planet, its proximity zone (1.8 ×) and every moon.
 */
export const MOON_REACH_FACTOR = 2.2;
export const MARGIN = 4;

export const d3 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Closest approach of a planet's centre, over a full orbit, to a fixed point. */
export function closestApproach(planet: (typeof planets)[number], p: readonly number[]): number {
  let min = Infinity;
  const period = (Math.PI * 2) / planet.orbit.angularSpeed;
  for (let k = 0; k < SAMPLES; k++) {
    const q = orbitPosition(planet.orbit, (k / SAMPLES) * period);
    min = Math.min(min, Math.hypot(q.x - p[0], q.y - p[1], q.z - p[2]));
  }
  return min;
}

/**
 * Distance above or below a tilted asteroid ring (AsteroidBelt.tsx: tilt about
 * X, ring radius rMin..rMax, rocks within ±halfThickness of its plane), or
 * Infinity when the point is outside the ring's radial band.
 */
export function beltClearance(p: readonly number[], tilt: number, rMin: number, rMax: number, halfThickness: number): number {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const ly = c * p[1] + s * p[2];
  const lz = -s * p[1] + c * p[2];
  const r = Math.hypot(p[0], lz);
  return r < rMin - MARGIN || r > rMax + MARGIN ? Infinity : Math.abs(ly) - halfThickness;
}
```

In `tests/careerTrail.test.ts`, delete the local `SAMPLES`, `MOON_REACH_FACTOR`, `MARGIN`, `d3`, `closestApproach` and `beltClearance` definitions (lines 12–53, keeping `SPAWN` and `PLACES`), plus the now-unused `orbitPosition` import. Add:

```ts
import { d3, closestApproach, beltClearance, MOON_REACH_FACTOR, MARGIN } from "./helpers/clearance";
```

- [ ] **Step 2: Run the career tests to prove the extraction changed nothing**

Run: `npx vitest run tests/careerTrail.test.ts`
Expected: PASS (same test count as before).

- [ ] **Step 3: Write the failing B2 placement test**

Create `tests/shipyardGate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planets, PORTAL_POS, PORTAL_ZONE_R } from "../src/constants";
import { SHARDS } from "../src/data/shards";
import { ASTEROID_COLLIDERS, SUN_COLLIDER } from "../src/data/asteroids";
import { RING_GATES, RING_RADIUS } from "../src/data/ringCourse";
import { STATION_POS, STATION_RADII, BUOYS, BUOY_CARD_R, type Vec3 } from "../src/data/careerTrail";
import { SHIPYARD_POS, SHIPYARD_RADII, SHIPYARD_BLUE } from "../src/data/shipyard";
import {
  GATE_POS, GATE_RADIUS, GATE_OPENING_R, GATE_SENSE_R, GATE_KEEP_OUT, GATE_NORMAL, GATE_LINES,
} from "../src/data/dormantGate";
import { HAZE_START } from "../src/utils/edgeHaze";
import { d3, closestApproach, beltClearance, MOON_REACH_FACTOR, MARGIN } from "./helpers/clearance";

const SPAWN: Vec3 = [0, 0, 18];
const PLACES: { name: string; pos: Vec3; keepOut: number }[] = [
  { name: "shipyard", pos: SHIPYARD_POS, keepOut: SHIPYARD_RADII.zoneR },
  { name: "gate", pos: GATE_POS, keepOut: GATE_KEEP_OUT },
];

describe("B2 landmark clearance", () => {
  it("never shares space with a planet's swept orbit, its zone or its moons", () => {
    for (const planet of planets) for (const p of PLACES) {
      expect(closestApproach(planet, p.pos), `${planet.name} vs ${p.name}`)
        .toBeGreaterThan(planet.size * MOON_REACH_FACTOR + p.keepOut + MARGIN);
    }
  });
  it("keeps clear of the sun, the portal, the career landmarks and the scenery asteroids", () => {
    for (const p of PLACES) {
      expect(d3(p.pos, [SUN_COLLIDER.x, SUN_COLLIDER.y, SUN_COLLIDER.z]), `sun vs ${p.name}`)
        .toBeGreaterThan(SUN_COLLIDER.r + p.keepOut + MARGIN);
      expect(d3(p.pos, PORTAL_POS), `portal vs ${p.name}`).toBeGreaterThan(PORTAL_ZONE_R + p.keepOut + 40);
      expect(d3(p.pos, STATION_POS), `station vs ${p.name}`).toBeGreaterThan(STATION_RADII.zoneR + p.keepOut + 40);
      for (const b of BUOYS) expect(d3(p.pos, b.pos), `${b.id} vs ${p.name}`).toBeGreaterThan(BUOY_CARD_R + p.keepOut + MARGIN);
      for (const a of ASTEROID_COLLIDERS) {
        expect(d3(p.pos, [a.x, a.y, a.z]), `${a.id} vs ${p.name}`).toBeGreaterThan(a.r + p.keepOut + MARGIN);
      }
    }
  });
  it("keeps clear of every time-trial ring and every data shard", () => {
    for (const p of PLACES) {
      RING_GATES.forEach((g, i) => expect(d3(p.pos, g), `ring ${i} vs ${p.name}`).toBeGreaterThan(RING_RADIUS + p.keepOut + MARGIN));
      SHARDS.forEach((s, i) => expect(d3(p.pos, s.pos), `shard ${i} vs ${p.name}`).toBeGreaterThan(p.keepOut + MARGIN));
    }
  });
  it("is not buried in the asteroid belt or the polar halo", () => {
    for (const p of PLACES) {
      expect(beltClearance(p.pos, 0.436, 40, 70, 2.5), `belt vs ${p.name}`).toBeGreaterThan(p.keepOut);
      expect(beltClearance(p.pos, 1.31, 80, 95, 4.5), `halo vs ${p.name}`).toBeGreaterThan(p.keepOut);
    }
  });
  it("keeps the two new landmarks far apart", () => {
    expect(d3(SHIPYARD_POS, GATE_POS)).toBeGreaterThan(GATE_SENSE_R + SHIPYARD_RADII.zoneR);
  });
});

describe("shipyard placement", () => {
  it("sits above the plane, inside the innermost orbit, a short trip from spawn", () => {
    expect(SHIPYARD_POS[1]).toBeGreaterThan(0);
    expect(Math.hypot(...SHIPYARD_POS)).toBeLessThan(Math.min(...planets.map((p) => p.orbit.radius)) - 20);
    expect(d3(SHIPYARD_POS, SPAWN)).toBeLessThan(100);
  });
  it("docks like the career station (same model radius budget) and is steel blue", () => {
    expect(SHIPYARD_RADII).toEqual({ zoneR: 8.5, lockR: 7.2, retainR: 13, orbitR: 10, jumpR: 6.7 });
    expect(SHIPYARD_BLUE).toBe("#5b8cff");
  });
});

describe("dormant gate placement", () => {
  it("stays out of the edge haze, frame included", () => {
    for (const v of GATE_POS) expect(Math.abs(v) + GATE_RADIUS).toBeLessThan(HAZE_START);
  });
  it("lies beyond the outermost planet orbit", () => {
    expect(Math.hypot(...GATE_POS)).toBeGreaterThan(Math.max(...planets.map((p) => p.orbit.radius)));
  });
  it("faces the sun through an opening narrower than the frame", () => {
    expect(Math.hypot(...GATE_NORMAL)).toBeCloseTo(1, 10);
    const towardSun = GATE_POS.map((v) => -v / Math.hypot(...GATE_POS));
    GATE_NORMAL.forEach((v, i) => expect(v).toBeCloseTo(towardSun[i], 10));
    expect(GATE_OPENING_R).toBeLessThan(GATE_RADIUS - 4);
    expect(GATE_KEEP_OUT).toBeGreaterThan(GATE_RADIUS);
  });
  it("carries the spec's radio copy", () => {
    expect(GATE_LINES.approach).toBe("CONTROL // THAT STRUCTURE ISN'T ONE OF OURS. NO RECORD OF IT ANYWHERE.");
    expect(GATE_LINES.pass).toBe("CONTROL // YOUR READINGS SPIKED THE MOMENT YOU CROSSED. THEN NOTHING.");
  });
});
```

Check that `planets[i].orbit.radius` exists (`src/utils/orbits.ts` `OrbitalElements`; `PLANET_ORBITS` in `src/constants.ts:71-73` uses `radius`).

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run tests/shipyardGate.test.ts`
Expected: FAIL — `Failed to resolve import "../src/data/shipyard"`.

- [ ] **Step 5: Create the two data files**

`src/data/shipyard.ts`:

```ts
import { STATION_RADII, type Vec3 } from "./careerTrail";

/**
 * The shipyard (docs/archive/specs/2026-10-16-shipyard-gate-design.md §1):
 * an open dry dock in the inner system, above the plane on the spawn side, so
 * the hangar is a short trip after a jump. The scene and
 * tests/shipyardGate.test.ts read these same numbers.
 */
export const SHIPYARD_POS: Vec3 = [-70, 30, 45];

/**
 * The model keeps within the career station's radius budget (every vertex
 * within 5.0 of its origin, tests/assetContracts.test.ts), so it docks with
 * the station's radii: jumpR parks the whole ship clear of the hull.
 */
export const SHIPYARD_RADII = { ...STATION_RADII };

/** Accent colour: radar blip, sector list, hangar dialog. */
export const SHIPYARD_BLUE = "#5b8cff";
```

`src/data/dormantGate.ts`:

```ts
import type { Vec3 } from "./careerTrail";

/**
 * The dormant gate (docs/archive/specs/2026-10-16-shipyard-gate-design.md §1–2):
 * a broken hexagonal arch far out in the system. It is found by flying, never
 * by a jump key or a waypoint, and names itself only to the scanner. What
 * wakes it is the secret-sector project's to decide.
 */
export const GATE_POS: Vec3 = [-150, 130, 90];
/** Model bounding radius (tests/assetContracts.test.ts holds the GLB to it). */
export const GATE_RADIUS = 15;
/** A pass counts within this distance of the axis: the opening's inner apothem is 10.5. */
export const GATE_OPENING_R = 10;
/** Inside this distance the seams flicker and the first radio line plays. */
export const GATE_SENSE_R = 60;
/** Placement and crystal keep-out around the centre: the frame plus room. */
export const GATE_KEEP_OUT = 20;

const LEN = Math.hypot(GATE_POS[0], GATE_POS[1], GATE_POS[2]);
/** The opening's axis, toward the sun. DormantGate turns the model's +Z onto it. */
export const GATE_NORMAL: Vec3 = [-GATE_POS[0] / LEN, -GATE_POS[1] / LEN, -GATE_POS[2] / LEN];

export const GATE_TEAL = "#3de0c8";
/** Radar dot: no name, no colour of its own. */
export const GATE_RADAR_GREY = "#8a8f98";
export const GATE_SCAN_ID = "dormant_gate";
export const GATE_SCAN_LABEL = "UNKNOWN_STRUCTURE";

/** One-time radio lines, once per page load (src/utils/gatePass.ts). */
export const GATE_LINES = {
  approach: "CONTROL // THAT STRUCTURE ISN'T ONE OF OURS. NO RECORD OF IT ANYWHERE.",
  pass: "CONTROL // YOUR READINGS SPIKED THE MOMENT YOU CROSSED. THEN NOTHING.",
} as const;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/shipyardGate.test.ts tests/careerTrail.test.ts`
Expected: PASS. If a clearance check fails, do **not** loosen the test. Move the position to the nearest passing point and record why in the data file's comment, as `careerTrail.ts` does for `STATION_POS`.

- [ ] **Step 7: Commit**

```bash
git add tests/helpers/clearance.ts tests/careerTrail.test.ts tests/shipyardGate.test.ts src/data/shipyard.ts src/data/dormantGate.ts
git commit -m "feat(landmarks): shipyard and dormant gate placement data with clearance tests"
```

---

### Task 2: Destination table, crystal keep-out and scan reports

**Files:**
- Modify: `src/data/destinations.ts`
- Modify: `src/utils/crystalField.ts`, `src/components/canvas/FuelCrystals.tsx:71-75`
- Modify: `src/utils/scanReport.ts:9-16`
- Modify: `src/components/layout/HUDOverlay.tsx:155-157` (use `jumpKey`)
- Test: `tests/destinations.test.ts`, `tests/crystalField.test.ts`, `tests/scanReport.test.ts`

**Interfaces:**
- Consumes: `SHIPYARD_POS`, `SHIPYARD_RADII`, `SHIPYARD_BLUE`, `GATE_POS` (Task 1).
- Produces:
  - `DestinationId = "contact" | "career" | "shipyard"`.
  - `Destination.waypoint: boolean`.
  - `jumpKey(id: string): number` (1-based key; 0 when not a jump target).
  - `afterPlanets` over waypoint rows only.
  - `CRYSTAL_LANDMARKS: readonly (readonly [number, number, number])[]` in `crystalField.ts`.

- [ ] **Step 1: Write the failing tests**

In `tests/destinations.test.ts`:
- Add `jumpKey` to the import from `../src/data/destinations`.
- Add `import { SHIPYARD_POS } from "../src/data/shipyard";`.
- Replace the whole `describe("afterPlanets", …)` block and the `"comes before the contact portal…"` test with the code below. Keep everything else.

```ts
describe("afterPlanets", () => {
  const WAYPOINT = DESTINATIONS.filter((d) => d.waypoint).map((d) => d.id);

  it("walks the waypoint rows only: career, then contact", () => {
    expect(WAYPOINT).toEqual(["career", "contact"]);
    expect(afterPlanets([])).toBe("career");
    expect(afterPlanets([{ id: "slingshot" }])).toBe("career");
    expect(afterPlanets([{ id: "career" }])).toBe("contact");
    expect(afterPlanets([{ id: "contact" }])).toBe("career");
    expect(afterPlanets([{ id: "career" }, { id: "contact" }])).toBe("contact");
  });

  it("never points at the shipyard, whatever has been earned", () => {
    const ids = ["career", "contact", "shipyard", "slingshot", "comet", "ring", "ore", "convoy"];
    for (let mask = 0; mask < 1 << ids.length; mask++) {
      const badges = ids.filter((_, i) => mask & (1 << i)).map((id) => ({ id }));
      expect(afterPlanets(badges)).not.toBe("shipyard");
    }
  });
});

describe("shipyard row", () => {
  it("sits at the shipyard with the station's dock radii and stays out of the waypoint chain", () => {
    const s = destinationById("shipyard")!;
    expect(s).toMatchObject({
      id: "shipyard", label: "SHIPYARD", jumpLabel: "Shipyard", scanLabel: "DRYDOCK_01",
      color: "#5b8cff", waypoint: false, zoneR: 8.5, lockR: 7.2, retainR: 13, orbitR: 10, jumpR: 6.7,
    });
    expect(s.pos).toBe(SHIPYARD_POS);
    expect(s.jumpR).toBeLessThan(s.lockR);
  });

  it("keeps career and contact on the waypoint chain", () => {
    expect(destinationById("career")!.waypoint).toBe(true);
    expect(destinationById("contact")!.waypoint).toBe(true);
  });
});

describe("jump keys", () => {
  it("are planets 1-3, career 4, shipyard 5, contact 6", () => {
    expect(JUMP_TARGETS.map((t) => t.id)).toEqual([...planets.map((p) => p.name), "career", "shipyard", "contact"]);
    expect(jumpKey("career")).toBe(4);
    expect(jumpKey("shipyard")).toBe(5);
    expect(jumpKey("contact")).toBe(6);
    expect(jumpKey(planets[0].name)).toBe(1);
    expect(jumpKey("dormant_gate")).toBe(0);
  });
});
```

The `"orders the waypoint: …"` test inside `describe("career station row")` stays as it is. It still holds.

In `tests/crystalField.test.ts`, extend the import with `CRYSTAL_LANDMARKS`, then add:

```ts
import { DESTINATIONS } from "../src/data/destinations";
import { GATE_POS } from "../src/data/dormantGate";

describe("CRYSTAL_LANDMARKS", () => {
  it("covers every destination and the dormant gate", () => {
    for (const d of DESTINATIONS) expect(CRYSTAL_LANDMARKS).toContain(d.pos);
    expect(CRYSTAL_LANDMARKS).toContain(GATE_POS);
  });
  it("rejects a crystal spawn inside the gate's frame", () => {
    const avoid = crystalAvoidPoints([], CRYSTAL_LANDMARKS, { x: 0, y: 0, z: 0 });
    expect(isRejectedSpawn(GATE_POS[0], GATE_POS[1], GATE_POS[2], avoid)).toBe(true);
    expect(isRejectedSpawn(GATE_POS[0] + 14, GATE_POS[1], GATE_POS[2], avoid)).toBe(true);
  });
});
```

In `tests/scanReport.test.ts`, add (import `generateScanReport` if it is not there yet):

```ts
it("reports the shipyard and the dormant gate", () => {
  expect(generateScanReport("shipyard")).toBe("SCAN[DRYDOCK_01] // CRANE RUNNING. ENGINE PLUMES ARE REFITTED HERE. DOCK TO OPEN THE HANGAR");
  expect(generateScanReport("dormant_gate")).toBe("SCAN[UNKNOWN_STRUCTURE] // ORIGIN UNKNOWN // DORMANT // NO RESPONSE TO HAIL");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/destinations.test.ts tests/crystalField.test.ts tests/scanReport.test.ts`
Expected: FAIL. `jumpKey` and `CRYSTAL_LANDMARKS` are not exported, there is no shipyard row, and the reports fall through to the generic `SCAN[SHIPYARD] // …` line.

- [ ] **Step 3: Implement the table changes**

In `src/data/destinations.ts`:

```ts
import { SHIPYARD_POS, SHIPYARD_RADII, SHIPYARD_BLUE } from "./shipyard";
// …
export type DestinationId = "contact" | "career" | "shipyard";

export interface Destination {
  // …existing fields…
  /**
   * Whether the guided waypoint may point here (afterPlanets). The shipyard is
   * a place to visit, not a step of the recruiter path, and has no logbook
   * entry, so without this it would capture the waypoint forever.
   */
  waypoint: boolean;
}

export const DESTINATIONS: readonly Destination[] = [
  // Key 4. Radii in careerTrail.ts, next to the placement they were tested with.
  {
    id: "career", label: "CAREER STATION", jumpLabel: "Career", scanLabel: "STATION_CAREER", pos: STATION_POS,
    color: CAREER_AMBER, waypoint: true, ...STATION_RADII,
  },
  // Key 5. Docking opens the Hangar (App.tsx).
  {
    id: "shipyard", label: "SHIPYARD", jumpLabel: "Shipyard", scanLabel: "DRYDOCK_01", pos: SHIPYARD_POS,
    color: SHIPYARD_BLUE, waypoint: false, ...SHIPYARD_RADII,
  },
  // Key 6.
  {
    id: "contact", label: "CONTACT PORTAL", jumpLabel: "Contact", scanLabel: "PORTAL_SUN", pos: PORTAL_POS, color: "#ec4899",
    waypoint: true,
    zoneR: PORTAL_ZONE_R, lockR: PORTAL_LOCK_R, retainR: PORTAL_RETAIN_R, orbitR: PORTAL_ORBIT_R, jumpR: PORTAL_LOCK_R * 0.8,
  },
];
```

Below `JUMP_TARGETS`, add:

```ts
/** The number key (1-based) that jumps to `id`; 0 if nothing does. */
export function jumpKey(id: string): number {
  return JUMP_TARGETS.findIndex((t) => t.id === id) + 1;
}
```

Replace `afterPlanets`:

```ts
const WAYPOINT_ROWS = DESTINATIONS.filter((d) => d.waypoint);

/**
 * Where the waypoint points once every planet dossier is read: the first
 * waypoint destination (table order) whose logbook badge is not recorded
 * yet, and the last one (the contact portal) once all are. Rows with
 * `waypoint: false` (the shipyard) are never returned.
 */
export function afterPlanets(badges: readonly { id: string }[]): DestinationId {
  const open = WAYPOINT_ROWS.find((d) => !badges.some((b) => b.id === d.id));
  return (open ?? WAYPOINT_ROWS[WAYPOINT_ROWS.length - 1]).id;
}
```

In `src/components/layout/HUDOverlay.tsx`, add `jumpKey` to the destinations import. Replace `const key = JUMP_TARGETS.findIndex((t) => t.id === next.id) + 1;` with `const key = jumpKey(next.id);`. Then drop `JUMP_TARGETS` from that import if nothing else in the file uses it (check with grep first).

- [ ] **Step 4: Crystal keep-out and scan reports**

In `src/utils/crystalField.ts` add, next to `LANDMARK_KEEP_OUT`:

```ts
import { DESTINATIONS } from "../data/destinations";
import { GATE_POS } from "../data/dormantGate";

/** Fixed landmarks a crystal spawn keeps LANDMARK_KEEP_OUT from: every destination, and the gate's frame (radius 15). */
export const CRYSTAL_LANDMARKS: readonly (readonly [number, number, number])[] = [...DESTINATIONS.map((d) => d.pos), GATE_POS];
```

In `src/components/canvas/FuelCrystals.tsx`:
- Replace `DESTINATIONS.map((d) => d.pos),` in `avoidFor` with `CRYSTAL_LANDMARKS,`.
- Import `CRYSTAL_LANDMARKS` from `../../utils/crystalField`.
- Remove the now-unused `DESTINATIONS` import.

In `src/utils/scanReport.ts`, add two rows to `PLANET_REPORTS`:

```ts
  shipyard: "SCAN[DRYDOCK_01] // CRANE RUNNING. ENGINE PLUMES ARE REFITTED HERE. DOCK TO OPEN THE HANGAR",
  dormant_gate: "SCAN[UNKNOWN_STRUCTURE] // ORIGIN UNKNOWN // DORMANT // NO RESPONSE TO HAIL",
```

- [ ] **Step 5: Run the unit suite and the type check**

Run: `npx vitest run && npx tsc -b --noEmit`
Expected: PASS, no type errors. Check `tests/orbitInvariant.test.ts` in particular: it iterates `DESTINATIONS`, so it now covers the shipyard too. If `tsc -b` isn't configured, use `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add src/data/destinations.ts src/utils/crystalField.ts src/components/canvas/FuelCrystals.tsx src/utils/scanReport.ts src/components/layout/HUDOverlay.tsx tests/destinations.test.ts tests/crystalField.test.ts tests/scanReport.test.ts
git commit -m "feat(landmarks): shipyard destination row off the waypoint chain, jumpKey, gate crystal keep-out and scan reports"
```

---

### Task 3: Gamepad jumps by id

**Files:**
- Modify: `src/utils/gamepad.ts:3-9, 26, 74-91`
- Modify: `src/hooks/useGamepadInput.ts:8, 28-37, 39-46, 120`
- Modify: `src/App.tsx:52, 61`
- Test: `tests/gamepad.test.ts:95-103`, `tests/padAction.test.ts`

**Interfaces:**
- Consumes: destination ids `"career" | "shipyard" | "contact"` (Task 2).
- Produces:
  - `PadAction` jump variant `{ kind: "jump"; id: string }`.
  - `runPadAction(a: PadAction, s: PadStore): void` (no third argument).
  - `useGamepadInput(): void`.

- [ ] **Step 1: Write the failing tests**

In `tests/gamepad.test.ts`, replace the two jump tests (lines 95–103) with the code below. Add `import { planets } from "../src/constants";` if it is not there.

```ts
  it("maps the d-pad clockwise from up to the three planets, then the career station, by id", () => {
    expect(padActions(press(), press(12))).toEqual([{ kind: "jump", id: planets[0].name }]);
    expect(padActions(press(), press(15))).toEqual([{ kind: "jump", id: planets[1].name }]);
    expect(padActions(press(), press(13))).toEqual([{ kind: "jump", id: planets[2].name }]);
    expect(padActions(press(), press(14))).toEqual([{ kind: "jump", id: "career" }]);
  });
  it("maps Menu to the contact portal and View to the shipyard", () => {
    expect(padActions(press(), press(9))).toEqual([{ kind: "jump", id: "contact" }]);
    expect(padActions(press(), press(8))).toEqual([{ kind: "jump", id: "shipyard" }]);
  });
```

In `tests/padAction.test.ts`:
- Remove the `JUMP_TARGETS` import and every third argument to `runPadAction`.
- Change `{ kind: "jump", index: 0 }` to `{ kind: "jump", id: "home" }`.
- Replace the first test with:

```ts
  it("sends d-pad left to the career station, View to the shipyard and Menu to the contact portal", () => {
    const s = store();
    const press = (i: number) => Array.from({ length: 17 }, (_, k) => k === i);
    const none = press(-1);
    for (const b of [14, 8, 9]) for (const a of padActions(none, press(b))) runPadAction(a, s);
    expect(s.requestJump.mock.calls).toEqual([["career"], ["shipyard"], ["contact"]]);
  });

  it("ignores View and Menu in photo mode and under the classic résumé", () => {
    for (const over of [{ photoMode: true }, { showClassicCV: true }]) {
      const s = store(over);
      runPadAction({ kind: "jump", id: "shipyard" }, s);
      runPadAction({ kind: "jump", id: "contact" }, s);
      expect(s.requestJump).not.toHaveBeenCalled();
    }
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/gamepad.test.ts tests/padAction.test.ts`
Expected: FAIL. `padActions` still returns `{ kind: "jump", index }`, and View (button 8) returns `[]`.

- [ ] **Step 3: Implement**

`src/utils/gamepad.ts`:
- Header comment: add `8 View/Back` to the buttons line.
- `import { planets } from "../constants";`
- Constants: `const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7, VIEW = 8, MENU = 9;`
- Replace the jump block:

```ts
export type PadAction = { kind: "photo" } | { kind: "close" } | { kind: "logbook" } | { kind: "jump"; id: string };

/**
 * Jumps by destination id, never by table index, so a new destination row
 * cannot silently remap a button. D-pad clockwise from up: the three planets,
 * then the career station (keys 1–4). Menu: the contact portal. View: the
 * shipyard.
 */
const PAD_JUMPS: readonly (readonly [number, string])[] = [
  [DPAD_UP, planets[0].name], [DPAD_RIGHT, planets[1].name], [DPAD_DOWN, planets[2].name], [DPAD_LEFT, "career"],
  [MENU, "contact"], [VIEW, "shipyard"],
];

/** One-shot actions, fired on the press edge only so a held button acts once. */
export function padActions(prev: readonly boolean[], next: readonly boolean[]): PadAction[] {
  const edge = (i: number) => !!next[i] && !prev[i];
  const out: PadAction[] = [];
  if (edge(Y)) out.push({ kind: "photo" });
  if (edge(B)) out.push({ kind: "close" });
  if (edge(X)) out.push({ kind: "logbook" });
  for (const [b, id] of PAD_JUMPS) if (edge(b)) out.push({ kind: "jump", id });
  return out;
}
```

`src/hooks/useGamepadInput.ts`:
- `LINKED_MESSAGE` ends `· D-PAD JUMP · VIEW SHIPYARD · MENU CONTACT"`.
- `runPadAction(a: PadAction, s: PadStore): void`, whose last branch is `else if (!s.photoMode) s.requestJump(a.id);`.
- Doc comment: drop the `jumpIds` paragraph.
- `export function useGamepadInput() {`, effect deps `[]`, and the call becomes `runPadAction(a, useSpaceStore.getState())`.

`src/App.tsx`: delete `const JUMP_IDS = …` (line 52). Line 61 becomes `useGamepadInput();`.

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run tests/gamepad.test.ts tests/padAction.test.ts && npx tsc -b --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/gamepad.ts src/hooks/useGamepadInput.ts src/App.tsx tests/gamepad.test.ts tests/padAction.test.ts
git commit -m "feat(gamepad): jump by destination id; View jumps to the shipyard"
```

---

### Task 4: Hangar dialog and the plume picker move

**Files:**
- Create: `src/components/layout/PlumePicker.tsx`
- Create: `src/components/layout/HangarPanel.tsx`
- Modify: `src/components/layout/LogbookPanel.tsx`
- Modify: `src/App.tsx` (the dialog block near line 400)
- Modify: `src/utils/logbook.ts:71-79`
- Test: `tests/hangar.test.ts`, `tests/logbook.test.ts:67-69`, `tests/spaceStore.test.ts:43`

**Interfaces:**
- Consumes: `jumpKey` (Task 2), `SHIPYARD_BLUE` (Task 1), `plumeAllowed`, `LOGBOOK`, `LogbookProgress` (`src/utils/logbook.ts`), `PLUME_COLORS`, `hasPlumeColour` (`src/data/plumeColors.ts`).
- Produces:
  - `PlumePicker({ progress, plumeColor, onPick }: { progress: LogbookProgress; plumeColor: string; onPick: (id: string) => void })`, a pure component.
  - `HangarPanel({ onClose }: { onClose: () => void })` with `data-testid="hangar-panel"` and heading id `hangar-title`.
  - Logbook pointer `data-testid="logbook-plume-pointer"`.

- [ ] **Step 1: Write the failing tests**

Create `tests/hangar.test.ts`. The `badges` literal's shape must match `LogbookProgress` in `src/utils/logbook.ts`; adjust the field names if they differ.

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PlumePicker from "../src/components/layout/PlumePicker";
import HangarPanel from "../src/components/layout/HangarPanel";
import { PLUME_COLORS } from "../src/data/plumeColors";

const none = { badges: [], visitedDossiers: [], shardsCollected: [] };

describe("PlumePicker", () => {
  it("offers every plume colour, stock unlocked and the rest locked with their badge named", () => {
    const html = renderToStaticMarkup(createElement(PlumePicker, { progress: none, plumeColor: "stock", onPick: () => {} }));
    for (const id of Object.keys(PLUME_COLORS)) expect(html).toContain(`data-testid="plume-${id}"`);
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="plume-stock"/);
    expect(html).toContain("GOLD plume, locked: earn Slingshot");
  });
  it("unlocks a colour once its badge is earned", () => {
    const progress = { ...none, badges: [{ id: "slingshot", at: "2026-10-16" }] };
    const html = renderToStaticMarkup(createElement(PlumePicker, { progress, plumeColor: "slingshot", onPick: () => {} }));
    expect(html).toContain('aria-label="GOLD plume"');
  });
});

describe("HangarPanel", () => {
  const html = renderToStaticMarkup(createElement(HangarPanel, { onClose: () => {} }));
  it("is a labelled modal dialog headed SHIPYARD // HANGAR", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="hangar-title"');
    expect(html).toContain("SHIPYARD // HANGAR");
    expect(html).toContain('data-testid="hangar-panel"');
  });
  it("holds the plume picker and promises nothing for later", () => {
    expect(html).toContain('data-testid="plume-stock"');
    expect(html).not.toMatch(/hull paint|coming soon/i);
  });
});
```

In `tests/logbook.test.ts:68`, the expectation becomes the first line below. Add the second test right after it.

```ts
    expect(badgeLine("slingshot", "GOLD")).toBe("LOGBOOK // SLINGSHOT EARNED — GOLD PLUME UNLOCKED. DOCK AT THE SHIPYARD [5]");
```

```ts
  it("keeps PRESS L for a badge with no plume", () => {
    expect(badgeLine("slingshot", null)).toBe("LOGBOOK // SLINGSHOT EARNED. PRESS L");
  });
```

In `tests/spaceStore.test.ts:43`, the expected text becomes `"LOGBOOK // SLINGSHOT EARNED — GOLD PLUME UNLOCKED. DOCK AT THE SHIPYARD [5]"`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/hangar.test.ts tests/logbook.test.ts tests/spaceStore.test.ts`
Expected: FAIL. The two components don't exist yet, and `badgeLine` still says `PRESS L`.

- [ ] **Step 3: Extract the picker**

Create `src/components/layout/PlumePicker.tsx`. Its body is the radiogroup moved out of `LogbookPanel.tsx` (lines 93–112), unchanged except that it reads props:

```tsx
import { LOGBOOK, plumeAllowed, type LogbookProgress } from "../../utils/logbook";
import { PLUME_COLORS, hasPlumeColour } from "../../data/plumeColors";

/**
 * The engine-plume picker (moved from the logbook to the shipyard's Hangar,
 * docs/archive/specs/2026-10-16-shipyard-gate-design.md §2). Pure: the
 * Hangar passes the progress, the current colour and the setter.
 * Buttons, not radio inputs: a focused <input> counts as a text field to the
 * flight keys, so W/A/S/D and Esc would stop working after a click.
 */
export default function PlumePicker({ progress, plumeColor, onPick }: {
  progress: LogbookProgress; plumeColor: string; onPick: (id: string) => void;
}) {
  return (
    <>
      <div className="text-white/40 mb-1" id="plume-label">ENGINE PLUME</div>
      <div role="radiogroup" aria-labelledby="plume-label" className="flex flex-wrap gap-2">
        {Object.entries(PLUME_COLORS).map(([id, c]) => {
          const allowed = plumeAllowed(id, progress, hasPlumeColour);
          const badge = LOGBOOK.find((e) => e.id === id);
          return (
            <button key={id} type="button" role="radio" aria-checked={plumeColor === id} disabled={!allowed}
              data-testid={`plume-${id}`}
              aria-label={allowed ? `${c.name} plume` : `${c.name} plume, locked: earn ${badge?.title ?? id}`}
              title={allowed ? c.name : `Earn ${badge?.title ?? id} to unlock`}
              onClick={() => onPick(id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border outline-none focus-visible:ring-1 focus-visible:ring-primary ${plumeColor === id ? "border-primary/60" : "border-white/10"} ${allowed ? "cursor-pointer" : "opacity-40 cursor-not-allowed"}`}>
              <span aria-hidden="true" className="w-3 h-3 rounded-full" style={{ backgroundColor: c.hex }} />
              <span aria-hidden="true">{c.name}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Create the Hangar**

`src/components/layout/HangarPanel.tsx`, following `CareerDossier.tsx`'s conventions:

```tsx
import { useMemo } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useSpaceStore } from "../../store/spaceStore";
import type { LogbookProgress } from "../../utils/logbook";
import { SHIPYARD_BLUE } from "../../data/shipyard";
import PlumePicker from "./PlumePicker";

/**
 * The shipyard's dock dialog (docs/archive/specs/2026-10-16-shipyard-gate-design.md §2):
 * the one place to change the ship's look. Today that is the engine plume;
 * hull paint is added here by its own project. Same conventions as the
 * career dossier: a modal dialog, Esc or either button closes it (App's Esc
 * handler breaks orbit), and focus lands on the close button.
 */
export default function HangarPanel({ onClose }: { onClose: () => void }) {
  const badges = useSpaceStore((s) => s.badges);
  const visitedDossiers = useSpaceStore((s) => s.visitedDossiers);
  const shardsCollected = useSpaceStore((s) => s.shardsCollected);
  const plumeColor = useSpaceStore((s) => s.plumeColor);
  const progress = useMemo<LogbookProgress>(
    () => ({ badges, visitedDossiers, shardsCollected }), [badges, visitedDossiers, shardsCollected]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="hangar-title"
      data-testid="hangar-panel"
      className="w-full max-w-xl pointer-events-auto glass-card rounded-3xl p-8 relative border max-h-[85vh] overflow-y-auto select-none bg-black/90 font-mono text-[10px]"
      style={{ borderColor: `${SHIPYARD_BLUE}33`, boxShadow: `0 0 40px ${SHIPYARD_BLUE}11` }}
    >
      <button
        autoFocus
        onClick={onClose}
        aria-label="Close hangar (Esc)"
        title="Close hangar (Esc)"
        className="absolute top-6 right-6 p-2 rounded-lg border border-white/5 bg-white/2 hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="flex flex-wrap items-center gap-6 mb-6">
        <span className="text-xs text-muted tracking-widest">// DRYDOCK_01</span>
        <span className="px-2 py-0.5 rounded text-[9px] uppercase border"
          style={{ color: SHIPYARD_BLUE, borderColor: `${SHIPYARD_BLUE}55` }}>
          DOCKED
        </span>
      </div>

      <h3 id="hangar-title" className="font-display font-black text-3xl sm:text-4xl mb-8 text-white">
        SHIPYARD // HANGAR
      </h3>

      <PlumePicker progress={progress} plumeColor={plumeColor}
        onPick={(id) => useSpaceStore.getState().setPlumeColor(id)} />

      <div className="flex items-center justify-between border-t border-white/5 pt-6 mt-8">
        <button
          onClick={onClose}
          className="px-5 py-3 rounded-xl text-xs font-bold text-black cursor-pointer hover:shadow-lg transition-all"
          style={{ backgroundColor: SHIPYARD_BLUE }}
        >
          THRUSTERS_BREAK_ORBIT
        </button>
      </div>
    </motion.div>
  );
}
```

In `src/App.tsx`, import `HangarPanel` next to `CareerDossier`, then add after the career dossier block:

```tsx
            {/* Shipyard Orbit Lock: Hangar (the plume picker) */}
            {isOrbitLocked && zoneDestination === "shipyard" && (
              <HangarPanel key="hangar" onClose={breakOrbit} />
            )}
```

Update the comment on `zoneDestination` to read "(the contact form, the career dossier, the hangar)".

- [ ] **Step 5: Logbook pointer and badge line**

In `src/components/layout/LogbookPanel.tsx`:
- Delete the picker block: the comment and both `<div>`s from `{/* Buttons, not radio inputs…` through the radiogroup's closing `</div>`.
- Put this in its place:

```tsx
      <div className="text-white/40" data-testid="logbook-plume-pointer">
        ENGINE PLUME: {PLUME_COLORS[plumeColor]?.name ?? PLUME_COLORS.stock.name} · CHANGE IT AT THE SHIPYARD [{jumpKey("shipyard")}]
      </div>
```

- Imports: drop `plumeAllowed` and `hasPlumeColour`, and add `import { jumpKey } from "../../data/destinations";`.
- Doc comment: "listing essentials and flight badges, with a pointer to the shipyard's plume picker".

In `src/utils/logbook.ts`, import `jumpKey` from `"../data/destinations"`, and change the plume branch of `badgeLine`:

```ts
  return plumeName
    ? `LOGBOOK // ${title} EARNED — ${plumeName} PLUME UNLOCKED. DOCK AT THE SHIPYARD [${jumpKey("shipyard")}]`
    : `LOGBOOK // ${title} EARNED. PRESS L`;
```

If that import creates a cycle (`npx vitest run` throws `Cannot access … before initialization`), break it by moving `jumpKey` and `JUMP_TARGETS` into a new `src/data/jumpTargets.ts` that imports `DESTINATIONS`, and re-export both from `destinations.ts`.

- [ ] **Step 6: Run the tests and the type check**

Run: `npx vitest run && npx tsc -b --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/layout/PlumePicker.tsx src/components/layout/HangarPanel.tsx src/components/layout/LogbookPanel.tsx src/App.tsx src/utils/logbook.ts tests/hangar.test.ts tests/logbook.test.ts tests/spaceStore.test.ts
git commit -m "feat(shipyard): Hangar dialog takes over the plume picker; logbook points to it"
```

---

### Task 5: Gate logic

**Files:**
- Create: `src/utils/gatePass.ts`
- Test: `tests/gatePass.test.ts`

**Interfaces:**
- Consumes: `GATE_POS`, `GATE_NORMAL`, `GATE_OPENING_R`, `GATE_SENSE_R`, `GATE_LINES` (Task 1); `crossesGate`, `Gate` (`src/utils/race.ts`, whose `MAX_STEP` = 10 guards jumps).
- Produces:
  - `gateDistance(p: Point): number`
  - `gatePassed(a: Point, b: Point): boolean`
  - `interface GateRadio { approached: boolean; passed: boolean }`
  - `gateLine(state: GateRadio, prev: Point, next: Point): string | null` (mutates `state`)
  - `gateRadio: GateRadio` (module state, once per page load)
  - `seamIntensity(t: number, distance: number, reduced: boolean): number`
  - `SEAM_IDLE = 0.6`, `SEAM_SENSED = 2.4`

- [ ] **Step 1: Write the failing test**

`tests/gatePass.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GATE_POS, GATE_NORMAL, GATE_OPENING_R, GATE_SENSE_R, GATE_LINES } from "../src/data/dormantGate";
import { gateDistance, gatePassed, gateLine, seamIntensity, SEAM_IDLE, SEAM_SENSED, type GateRadio } from "../src/utils/gatePass";

/** A point `along` units in front of the gate plane (toward the sun) and `side` units off the axis. */
const at = (along: number, side = 0) => {
  const off = Math.abs(GATE_NORMAL[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const s = [
    GATE_NORMAL[1] * off[2] - GATE_NORMAL[2] * off[1],
    GATE_NORMAL[2] * off[0] - GATE_NORMAL[0] * off[2],
    GATE_NORMAL[0] * off[1] - GATE_NORMAL[1] * off[0],
  ];
  const l = Math.hypot(s[0], s[1], s[2]);
  return {
    x: GATE_POS[0] + GATE_NORMAL[0] * along + (s[0] / l) * side,
    y: GATE_POS[1] + GATE_NORMAL[1] * along + (s[1] / l) * side,
    z: GATE_POS[2] + GATE_NORMAL[2] * along + (s[2] / l) * side,
  };
};
const fresh = (): GateRadio => ({ approached: false, passed: false });

describe("gate pass-through", () => {
  it("counts a flight through the opening, in either direction", () => {
    expect(gatePassed(at(2), at(-2))).toBe(true);
    expect(gatePassed(at(-2), at(2))).toBe(true);
  });
  it("does not count a crossing outside the opening (through the frame or past it)", () => {
    expect(gatePassed(at(2, GATE_OPENING_R + 1), at(-2, GATE_OPENING_R + 1))).toBe(false);
  });
  it("does not count a jump, teleport or wrap across the plane", () => {
    expect(gatePassed(at(25), at(-25))).toBe(false);
  });
  it("counts a slow drift across the plane exactly once", () => {
    let passes = 0;
    for (let k = 0; k < 40; k++) if (gatePassed(at(2 - k * 0.1), at(2 - (k + 1) * 0.1))) passes++;
    expect(passes).toBe(1);
  });
});

describe("gate radio", () => {
  it("plays the approach line the first time inside the sense radius, then never again", () => {
    const s = fresh();
    expect(gateLine(s, at(GATE_SENSE_R + 5), at(GATE_SENSE_R + 4))).toBeNull();
    expect(gateLine(s, at(GATE_SENSE_R + 1), at(GATE_SENSE_R - 1))).toBe(GATE_LINES.approach);
    expect(gateLine(s, at(GATE_SENSE_R - 1), at(GATE_SENSE_R - 2))).toBeNull();
    expect(gateLine(s, at(GATE_SENSE_R + 30), at(GATE_SENSE_R + 31))).toBeNull();
    expect(gateLine(s, at(GATE_SENSE_R + 1), at(GATE_SENSE_R - 1))).toBeNull();
  });
  it("plays the pass line on the first pass only", () => {
    const s = fresh();
    gateLine(s, at(30), at(29));
    expect(gateLine(s, at(1), at(-1))).toBe(GATE_LINES.pass);
    expect(gateLine(s, at(-1), at(1))).toBeNull();
  });
  it("plays only the pass line when the first visit is a pass", () => {
    const s = fresh();
    expect(gateLine(s, at(1), at(-1))).toBe(GATE_LINES.pass);
    expect(gateLine(s, at(-2), at(-3))).toBeNull();
    expect(s).toEqual({ approached: true, passed: true });
  });
});

describe("seam glow", () => {
  it("holds a steady low glow under reduced motion, near or far", () => {
    for (const t of [0, 1.3, 7]) for (const d of [5, 200]) expect(seamIntensity(t, d, true)).toBe(SEAM_IDLE);
  });
  it("pulses faintly when nobody is near", () => {
    for (let t = 0; t < 12; t += 0.25) {
      const v = seamIntensity(t, 500, false);
      expect(v).toBeGreaterThanOrEqual(SEAM_IDLE * 0.5);
      expect(v).toBeLessThanOrEqual(SEAM_IDLE);
    }
    expect(seamIntensity(0, 500, false)).not.toBe(seamIntensity(1.5, 500, false));
  });
  it("brightens toward SEAM_SENSED as the ship closes in", () => {
    const far = seamIntensity(2, GATE_SENSE_R + 1, false);
    const near = seamIntensity(2, 5, false);
    expect(near).toBeGreaterThan(far);
    expect(near).toBeLessThanOrEqual(SEAM_SENSED);
  });
  it("is deterministic", () => {
    expect(seamIntensity(3.21, 20, false)).toBe(seamIntensity(3.21, 20, false));
  });
});

describe("gateDistance", () => {
  it("measures from the gate centre", () => {
    expect(gateDistance(at(0))).toBeCloseTo(0, 9);
    expect(gateDistance(at(7))).toBeCloseTo(7, 9);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/gatePass.test.ts`
Expected: FAIL — `Failed to resolve import "../src/utils/gatePass"`.

- [ ] **Step 3: Implement**

`src/utils/gatePass.ts`:

```ts
import { crossesGate, type Gate } from "./race";
import { GATE_POS, GATE_NORMAL, GATE_OPENING_R, GATE_SENSE_R, GATE_LINES } from "../data/dormantGate";

interface Point { x: number; y: number; z: number }

/** The gate as a race gate: the same segment test the ring course uses, MAX_STEP guard included. */
const GATE: Gate = {
  c: { x: GATE_POS[0], y: GATE_POS[1], z: GATE_POS[2] },
  n: { x: GATE_NORMAL[0], y: GATE_NORMAL[1], z: GATE_NORMAL[2] },
};

export function gateDistance(p: Point): number {
  return Math.hypot(p.x - GATE_POS[0], p.y - GATE_POS[1], p.z - GATE_POS[2]);
}

/**
 * Whether the move a→b flew through the opening, either way. A jump, a debug
 * teleport or a boundary wrap moves more than race.ts's MAX_STEP and never
 * counts.
 */
export function gatePassed(a: Point, b: Point): boolean {
  return crossesGate(a, b, GATE, GATE_OPENING_R);
}

export interface GateRadio { approached: boolean; passed: boolean }

/** Once per page load: module state, like waypointState. */
export const gateRadio: GateRadio = { approached: false, passed: false };

/**
 * The one-time radio line this frame's move earns, or null, marking it said.
 * A pass implies an approach, so a first visit that is a pass plays only the
 * pass line.
 */
export function gateLine(state: GateRadio, prev: Point, next: Point): string | null {
  if (!state.passed && gatePassed(prev, next)) {
    state.passed = true;
    state.approached = true;
    return GATE_LINES.pass;
  }
  if (!state.approached && gateDistance(next) < GATE_SENSE_R) {
    state.approached = true;
    return GATE_LINES.approach;
  }
  return null;
}

/** Seam emissive intensity: idle pulse peak, and the brightest a close ship drives it. */
export const SEAM_IDLE = 0.6;
export const SEAM_SENSED = 2.4;
const PULSE_PERIOD_S = 6;
const FLICKER_HZ = 12;

/** Cheap deterministic hash in [0, 1). */
const noise = (n: number) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };

/**
 * The glyph seams' emissive intensity (spec §2): a faint pulse far away, and
 * inside GATE_SENSE_R an irregular flicker that brightens toward SEAM_SENSED
 * as the ship closes in. Reduced motion holds a steady SEAM_IDLE. `t` is
 * seconds (ambientTime).
 */
export function seamIntensity(t: number, distance: number, reduced: boolean): number {
  if (reduced) return SEAM_IDLE;
  const pulse = SEAM_IDLE * (0.75 + 0.25 * Math.sin((2 * Math.PI * t) / PULSE_PERIOD_S));
  if (distance >= GATE_SENSE_R) return pulse;
  const k = 1 - distance / GATE_SENSE_R;
  const flicker = 0.6 + 0.4 * noise(Math.floor(t * FLICKER_HZ));
  return Math.min(SEAM_SENSED, pulse + k * (SEAM_SENSED - SEAM_IDLE) * flicker);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/gatePass.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/gatePass.ts tests/gatePass.test.ts
git commit -m "feat(gate): pass-through, one-time radio and seam glow logic"
```

---

### Task 6: Shipyard model

**Files:**
- Create: `scripts/blender/gen_shipyard.py`
- Modify: `scripts/blender/generate.sh` (after the career landmark lines), `scripts/optimize-assets.mjs:50` (`MODELS`)
- Modify: `tests/assetContracts.test.ts` (new `describe`; add "Shipyard" to the doc comment's list of loaders), `tests/assetProvenance.test.ts` (`GENERATORS`)
- Create (generated): `assets-src/shipyard.glb`, `public/models/shipyard.glb`; modify `assets-src/MANIFEST.md`

**Interfaces:**
- Consumes: `SHIPYARD_RADII` (Task 1); `PLAYER_SHIP_SCALE` (`src/constants.ts`).
- Produces: `public/models/shipyard.glb` with:
  - nodes `Shipyard` and `CraneTrolley`; materials `HullBaked` and `WorkLight`;
  - `CraneTrolley` with no rotation, its translation `[0, 2.0, 0]`, slid by the app along local x within ±2.8.

- [ ] **Step 1: Write the failing contract test**

Append to `tests/assetContracts.test.ts`, and add `import { SHIPYARD_RADII } from "../src/data/shipyard";` at the top:

```ts
describe("shipyard (shipyard.glb)", () => {
  it("has the two nodes Shipyard.tsx uses and two materials", async () => {
    const doc = await load("shipyard");
    expect(nodeNames(doc)).toEqual(["CraneTrolley", "Shipyard"]);
    expect(materialNames(doc)).toEqual(["HullBaked", "WorkLight"]);
  });

  it("keeps the crane trolley a separate, unrotated node on the gantry", async () => {
    // Shipyard.tsx slides the trolley by writing position.x on this node.
    const t = node(await load("shipyard"), "CraneTrolley");
    const [x, y, z] = t.getTranslation();
    expect(Math.abs(x)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(z)).toBeLessThanOrEqual(0.02);
    expect(y).toBeGreaterThan(1.6);
    expect(y).toBeLessThan(2.4);
    expect(t.getRotation()).toEqual([0, 0, 0, 1]);
  });

  it("parks a jump with the whole ship clear of the hull", async () => {
    const ship = bounds(await load("spaceship"));
    const SHIP_HALF_LENGTH = Math.max(Math.abs(ship.min[2]), Math.abs(ship.max[2])) * PLAYER_SHIP_SCALE;
    const r = maxRadius(await load("shipyard"));
    expect(r).toBeLessThanOrEqual(5.0);
    expect(r).toBeGreaterThanOrEqual(4.0);
    expect(SHIPYARD_RADII.jumpR).toBeGreaterThanOrEqual(r + SHIP_HALF_LENGTH);
  });

  it("reuses the freighter's material configurations, so it adds no shader program", async () => {
    const [yard, cargo] = [await load("shipyard"), await load("cargo_ship")];
    expect(textureSet(yard, "HullBaked")).toEqual(textureSet(cargo, "HullBaked"));
    expect(textureSet(yard, "WorkLight")).toEqual(textureSet(cargo, "NavRed"));
    expect(semantics(yard)).toEqual(["NORMAL", "POSITION", "TEXCOORD_0"]);
  });

  it("glows cool white-blue at the work lights", async () => {
    const m = (await load("shipyard")).getRoot().listMaterials().find((x) => x.getName() === "WorkLight")!;
    const [r, g, b] = m.getEmissiveFactor();
    expect(b).toBeGreaterThan(0.9);
    expect(r).toBeGreaterThan(0.55);
    expect(r).toBeLessThan(0.9);
    expect(g).toBeGreaterThan(r);
  });

  it("costs four draw calls and stays inside its triangle and download budget", async () => {
    const doc = await load("shipyard");
    expect(doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())).toHaveLength(4);
    const t = triangles(doc);
    expect(t).toBeGreaterThanOrEqual(1500);
    expect(t).toBeLessThanOrEqual(5000);
    expect(kb("shipyard")).toBeLessThanOrEqual(600);
  });
});
```

In `tests/assetProvenance.test.ts` `GENERATORS`, add `"shipyard.glb": "scripts/blender/gen_shipyard.py",`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/assetContracts.test.ts tests/assetProvenance.test.ts`
Expected: FAIL. Contracts fail with `ENOENT … public/models/shipyard.glb`, and provenance fails because the generator or the asset is missing.

- [ ] **Step 3: Write the generator**

Create `scripts/blender/gen_shipyard.py` with `scripts/blender/gen_career_station.py` as the template. Copy these sections **verbatim**, renaming only `career_station` → `shipyard` in image names and paths:
- the imports and `ROOT`/`OUT`/`TEX` preamble (`OUT` = `assets-src/shipyard.glb`);
- `srgb`;
- the node helpers `_n`, `_math`, `_mix_col`, `_scale_col`;
- `bake_material`;
- the builders `activate`, `_finish`, `box`, `cyl`;
- the "bevels + shading", "join the matte parts, unwrap" and "bake" sections;
- the albedo compose and "final hull material" section;
- `keep_part`;
- the "report + export" section.

Replace the header contract, the palette, the emissive material and all geometry with the following:

```python
# Shipyard (original work, 100% procedural). Run headless:
#   $BLENDER --background --python scripts/blender/gen_shipyard.py
# Output: assets-src/shipyard.glb (raw; optimized by npm run assets:optimize)
#
# CONTRACT with src/components/canvas/Shipyard.tsx and tests/assetContracts.test.ts
# (glTF space, +Y up, drawn at scale 1):
#   nodes: Shipyard (truss arms, cradle saddles, hull ribs, gantry towers and
#     rails, tower work lights) and CraneTrolley (trolley, cable, hook block,
#     belly floodlight). CraneTrolley has no rotation, its origin on the
#     gantry centreline (glTF translation [0, 2.0, 0]): the app slides it along x.
#   materials: HullBaked (colour x AO bake + baked normal map, the cargo
#     ship's texture set) and WorkLight (untextured cool-white emissive).
#     One primitive per material per node: 4 draw calls.
#   <= 5000 triangles. Every vertex within 5.0 of the origin (SHIPYARD_RADII.jumpR
#     6.7 minus the ship's half length). No vertex colours, no tangents.
# Blender axes while building: +Z = up (glTF +Y); the dock runs along X.

BODY, TROLLEY = 0, 1
STEEL_BLUE = srgb("5b8cff")
WORK = srgb("cfe0ff")

BAKE = {
    "light": bake_material("BAKE_light", (0.58, 0.60, 0.63), 1.6),
    "dark": bake_material("BAKE_dark", (0.17, 0.18, 0.20), 2.4),
    "blue": bake_material("BAKE_blue", tuple(c * 0.8 for c in STEEL_BLUE), 2.0),
}

WORK_LIGHT = bpy.data.materials.new("WorkLight")
WORK_LIGHT.use_nodes = True
_wl = WORK_LIGHT.node_tree.nodes["Principled BSDF"]
_wl.inputs["Base Color"].default_value = (*[c * 0.05 for c in WORK], 1.0)
_wl.inputs["Metallic"].default_value = 0.0
_wl.inputs["Roughness"].default_value = 0.4
_wl.inputs["Emission Color"].default_value = (*WORK, 1.0)
_wl.inputs["Emission Strength"].default_value = 6.0

LIGHT_PARTS = {}   # light object name -> BODY or TROLLEY


def light_box(name, size, loc, part):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    bpy.context.object.scale = size
    ob = _finish(bpy.context.object, name, WORK_LIGHT, None, 0.0)
    LIGHT_PARTS[ob.name] = part
    return ob


# --------------------- cradle saddle at the origin first (the join target) ---
box("saddle_mid", (0.3, 3.6, 0.25), (0.0, 0.0, -1.3), "dark", BODY)
for x in (-2.4, 2.4):
    box(f"saddle_{x}", (0.3, 3.6, 0.25), (x, 0.0, -1.3), "dark", BODY)
for x in (-2.4, 0.0, 2.4):
    for s in (-1, 1):
        box(f"saddle_post_{x}_{s}", (0.18, 0.18, 0.7), (x, s * 1.2, -0.95), "dark", BODY)

# ----------------------------------------------- two truss arms along X ---
for s in (-1, 1):
    y = s * 1.8
    for z in (-1.2, -0.6):
        cyl(f"chord_{s}_{z}", 0.09, 8.0, (0.0, y, z), "light", BODY, rot=(0.0, math.radians(90), 0.0), verts=8)
    for k in range(10):
        ang = math.radians(37 if k % 2 == 0 else -37)  # alternating diagonal lacing
        cyl(f"lace_{s}_{k}", 0.045, 0.75, (-3.2 + k * 0.8, y, -0.9), "dark", BODY, bevel=0.0,
            rot=(0.0, ang, 0.0), verts=6)

# ------------------------------------------ hull ribs under construction ---
for k, x in enumerate((-2.0, -1.0, 0.0, 1.0, 2.0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=1.1, minor_radius=0.07, major_segments=20, minor_segments=6,
                                     location=(x, 0.0, -0.35), rotation=(0.0, math.radians(90), 0.0))
    rib = bpy.context.object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    # keep the lower half: a keel cradle that opens upward, not a closed hoop
    bm = bmesh.new()
    bm.from_mesh(rib.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.15], context="VERTS")
    bm.to_mesh(rib.data)
    bm.free()
    _finish(rib, f"rib_{k}", BAKE["light"], BODY, 0.0)
box("keel", (4.4, 0.18, 0.18), (0.0, 0.0, -1.42), "light", BODY)

# ------------------------------------ gantry: 4 towers, top beams, rails ---
for x in (-3.6, 3.6):
    for s in (-1, 1):
        box(f"tower_{x}_{s}", (0.3, 0.3, 3.5), (x, s * 1.8, 0.45), "blue", BODY)
        light_box(f"tower_light_{x}_{s}", (0.16, 0.16, 0.1), (x, s * 1.8, 2.27), BODY)
    box(f"top_beam_{x}", (0.28, 3.9, 0.28), (x, 0.0, 2.2), "blue", BODY)
for s in (-1, 1):
    box(f"rail_{s}", (7.5, 0.14, 0.14), (0.0, s * 0.4, 2.2), "dark", BODY, bevel=0.01)
for x in (-2.4, 0.0, 2.4):
    for s in (-1, 1):
        light_box(f"arm_light_{x}_{s}", (0.12, 0.12, 0.08), (x, s * 1.8, -0.5), BODY)

# --------------------------------------- crane trolley (the app slides it) ---
box("trolley_body", (0.9, 1.2, 0.4), (0.0, 0.0, 2.0), "blue", TROLLEY)
cyl("cable", 0.03, 1.1, (0.0, 0.0, 1.25), "dark", TROLLEY, bevel=0.0, verts=6)
box("hook_block", (0.3, 0.3, 0.25), (0.0, 0.0, 0.62), "dark", TROLLEY)
light_box("trolley_flood", (0.4, 0.5, 0.06), (0.0, 0.0, 1.77), TROLLEY)
```

Notes for the rib step:
- The rib's `_finish` re-applies the transform, which is harmless after the explicit `transform_apply`.
- The `z > 0.15` test runs in world-aligned mesh space after the rotation is applied. If the render shows the ribs opening **downward**, flip it to `v.co.z < -0.15 - 0.35`, because the ribs are centred at z = −0.35. Check that by the render, not by reasoning.

After the bake, split by part as the station does:
1. `ring_me = me.copy()` becomes the trolley mesh. Name the object `CraneTrolley`; `keep_part(me, BODY)` and `keep_part(trolley_me, TROLLEY)`.
2. Join each light into the node its `LIGHT_PARTS` entry names. The station joins all its lights into the hub; here, join the `TROLLEY` lights into `CraneTrolley` and the `BODY` lights into the body.
3. Set `CraneTrolley`'s origin with `SCENE.cursor.location = (0.0, 0.0, 2.0)`, then `activate(trolley)` and `bpy.ops.object.origin_set(type="ORIGIN_CURSOR")`.
4. Name the body object and its mesh `Shipyard`.
5. Export both, selected, exactly like the station's export call. Print `TRIS_TOTAL` and `MAX_RADIUS` as the station does.

Run it:

```bash
~/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/gen_shipyard.py 2>&1 | grep -E "TRIS|MAX_RADIUS|BBOX|wrote|Error"
```

Expected: `TRIS_TOTAL` ≤ 5000, `MAX_RADIUS` ≤ 5.0, `wrote …/assets-src/shipyard.glb`. If `MAX_RADIUS` > 5.0, shorten the chords to 7.6 and the rails to 7.2 and move the towers to x = ±3.4; don't change the contract.

- [ ] **Step 4: Optimize and register**

Add `"shipyard"` to `MODELS` in `scripts/optimize-assets.mjs:50`. In `scripts/blender/generate.sh`, after `gen_buoy.py`, add:

```bash
# Shipyard and dormant gate (2026-10-16).
"$BLENDER" --background --python scripts/blender/gen_shipyard.py
```

Run: `npm run assets:optimize`
Expected: writes `public/models/shipyard.glb`.

- [ ] **Step 5: Run the contracts**

Run: `npx vitest run tests/assetContracts.test.ts tests/assetProvenance.test.ts`
Expected: PASS. Fix the generator, never the contract, unless the contract contradicts the spec.

- [ ] **Step 6: Render a check image and look at it**

Render `assets-src/shipyard.glb` in Blender (camera 3/4 view from `(9, -9, 6)` looking at the origin, 800×600, Eevee, one sun light). Save to the session scratchpad and Read the image. Confirm all of these:
- it reads as an open dry dock (two truss arms, a rib cradle, a blue gantry with a trolley);
- it does not read as a sphere or as the career station;
- the work lights are visible.

Blender cannot import the shipped meshopt GLB; render the `assets-src/` file.

- [ ] **Step 7: Manifest and commits**

- Add hash and generator rows for `shipyard.glb` to `assets-src/MANIFEST.md`, in the same form as `career_station.glb`. Hash: `shasum -a 256 assets-src/shipyard.glb | cut -c1-16`.
- Mark the generator row **not byte-reproducible**: it uses the same UV packer as the station.
- Check `git -C assets-src remote -v` first: it should be the private `fitzfitz/3d-portfolio-assets-src`.

```bash
git -C assets-src add shipyard.glb MANIFEST.md
git -C assets-src commit -m "Add shipyard.glb (B2)"
git -C assets-src -c credential.helper='!gh auth git-credential' push
git add scripts/blender/gen_shipyard.py scripts/blender/generate.sh scripts/optimize-assets.mjs public/models/shipyard.glb tests/assetContracts.test.ts tests/assetProvenance.test.ts
git commit -m "feat(shipyard): procedural dry-dock model with a sliding crane trolley"
```

---

### Task 7: Dormant gate model

**Files:**
- Create: `scripts/blender/gen_dormant_gate.py`
- Modify: `scripts/blender/generate.sh`, `scripts/optimize-assets.mjs:50`, `tests/assetContracts.test.ts`, `tests/assetProvenance.test.ts`
- Create (generated): `assets-src/dormant_gate.glb`, `public/models/dormant_gate.glb`; modify `assets-src/MANIFEST.md`

**Interfaces:**
- Consumes: `GATE_RADIUS`, `GATE_OPENING_R` (Task 1).
- Produces: `public/models/dormant_gate.glb` with:
  - one node `DormantGate`;
  - materials `GateStone` (baked base + normal) and `GlyphSeam` (untextured teal emissive);
  - the opening axis along glTF +Z.

- [ ] **Step 1: Write the failing contract test**

Append to `tests/assetContracts.test.ts`, and add `import { GATE_RADIUS, GATE_OPENING_R } from "../src/data/dormantGate";`:

```ts
describe("dormant gate (dormant_gate.glb)", () => {
  it("is one node with a stone and a seam material: two draw calls", async () => {
    const doc = await load("dormant_gate");
    expect(nodeNames(doc)).toEqual(["DormantGate"]);
    expect(materialNames(doc)).toEqual(["GateStone", "GlyphSeam"]);
    expect(doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())).toHaveLength(2);
  });

  it("is a frame about GATE_RADIUS across, thin along its axis (+Z)", async () => {
    const doc = await load("dormant_gate");
    const r = maxRadius(doc);
    expect(r).toBeGreaterThanOrEqual(GATE_RADIUS - 1);
    expect(r).toBeLessThanOrEqual(GATE_RADIUS + 0.5);
    const b = bounds(doc);
    expect(b.max[2] - b.min[2]).toBeLessThanOrEqual(2.8);
    expect(b.max[0] - b.min[0]).toBeGreaterThan(24);
    expect(b.max[1] - b.min[1]).toBeGreaterThan(24);
  });

  it("leaves the opening clear out to GATE_OPENING_R", async () => {
    // No vertex lies within the opening's pass radius of the axis.
    const doc = await load("dormant_gate");
    const el: number[] = [];
    let minAxial = Infinity;
    for (const n of doc.getRoot().listNodes()) {
      const mesh = n.getMesh();
      if (!mesh) continue;
      const m = n.getWorldMatrix();
      for (const p of mesh.listPrimitives()) {
        const pos = p.getAttribute("POSITION")!;
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, el);
          const x = m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12];
          const y = m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13];
          minAxial = Math.min(minAxial, Math.hypot(x, y));
        }
      }
    }
    expect(minAxial).toBeGreaterThan(GATE_OPENING_R);
  });

  it("reuses the freighter's material configurations, so it adds no shader program", async () => {
    const [gate, cargo] = [await load("dormant_gate"), await load("cargo_ship")];
    expect(textureSet(gate, "GateStone")).toEqual(textureSet(cargo, "HullBaked"));
    expect(textureSet(gate, "GlyphSeam")).toEqual(textureSet(cargo, "NavRed"));
    expect(semantics(gate)).toEqual(["NORMAL", "POSITION", "TEXCOORD_0"]);
  });

  it("glows teal at the seams", async () => {
    const m = (await load("dormant_gate")).getRoot().listMaterials().find((x) => x.getName() === "GlyphSeam")!;
    const [r, g, b] = m.getEmissiveFactor();
    expect(r).toBeLessThan(0.35);
    expect(g).toBeGreaterThan(0.75);
    expect(b).toBeGreaterThan(0.6);
  });

  it("stays inside its triangle and download budget", async () => {
    const t = triangles(await load("dormant_gate"));
    expect(t).toBeGreaterThanOrEqual(600);
    expect(t).toBeLessThanOrEqual(3000);
    expect(kb("dormant_gate")).toBeLessThanOrEqual(600);
  });
});
```

In `tests/assetProvenance.test.ts`, add `"dormant_gate.glb": "scripts/blender/gen_dormant_gate.py",`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/assetContracts.test.ts tests/assetProvenance.test.ts`
Expected: FAIL — `ENOENT … dormant_gate.glb`.

- [ ] **Step 3: Write the generator**

Create `scripts/blender/gen_dormant_gate.py`. As in Task 6, copy these from `gen_career_station.py` verbatim:
- the preamble (`OUT` = `assets-src/dormant_gate.glb`);
- `srgb` and the node helpers;
- `activate` and `_finish`;
- the bevels/shading, join/unwrap and bake sections;
- the albedo compose;
- the final material build (renamed `GateStone`);
- the report and export (one object, `DormantGate`).

There is no `keep_part`: it is one node.

Contract header:

```python
# Dormant gate (original work, 100% procedural). Run headless:
#   $BLENDER --background --python scripts/blender/gen_dormant_gate.py
# Output: assets-src/dormant_gate.glb
#
# CONTRACT with src/components/canvas/DormantGate.tsx and tests/assetContracts.test.ts
# (glTF space, +Y up, drawn at scale 1):
#   one node, DormantGate: five basalt segments of a hexagonal arch (the
#     sixth slot is empty, two of the five are cracked through) joined into
#     one GateStone primitive, plus GlyphSeam inlays as the second primitive.
#   the opening's axis is glTF +Z (Blender -Y): DormantGate.tsx turns +Z onto
#     GATE_NORMAL, so the opening faces the sun.
#   GateStone: colour x AO bake + normal bake (cargo HullBaked's texture set).
#   GlyphSeam: untextured teal emissive (cargo NavRed's texture set).
#   <= 3000 triangles. Max radius <= 15.5 (GATE_RADIUS 15). Nothing within
#     10 of the axis (GATE_OPENING_R): the opening is open. Depth <= 2.8.
# Blender axes while building: the hexagon lies in Blender's XZ plane (axis = Y).
```

Stone bake material (used instead of `bake_material`):

```python
def stone_material(name):
    """Dark basalt for baking: noise-driven tone, fine fracture lines in colour and bump."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.85
    tc = _n(nt, "ShaderNodeTexCoord")
    noise = _n(nt, "ShaderNodeTexNoise")
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    noise.inputs["Scale"].default_value = 0.9
    noise.inputs["Detail"].default_value = 8.0
    vor = _n(nt, "ShaderNodeTexVoronoi")
    vor.feature = "DISTANCE_TO_EDGE"
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    vor.inputs["Scale"].default_value = 0.7
    edge = _math(nt, "LESS_THAN", vor.outputs["Distance"], 0.03)
    tone = _math(nt, "ADD", 0.7, _math(nt, "MULTIPLY", noise.outputs["Fac"], 0.6))
    col = _scale_col(nt, (0.055, 0.06, 0.07), tone)
    col = _mix_col(nt, edge, col, _scale_col(nt, col, 0.4))
    nt.links.new(col, bsdf.inputs["Base Color"])
    bump = _n(nt, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.05
    nt.links.new(_math(nt, "ADD", noise.outputs["Fac"], _math(nt, "MULTIPLY", edge, -0.6)), bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


STONE = stone_material("BAKE_stone")
TEAL = srgb("3de0c8")
SEAM = bpy.data.materials.new("GlyphSeam")
SEAM.use_nodes = True
_s = SEAM.node_tree.nodes["Principled BSDF"]
_s.inputs["Base Color"].default_value = (*[c * 0.05 for c in TEAL], 1.0)
_s.inputs["Metallic"].default_value = 0.0
_s.inputs["Roughness"].default_value = 0.4
_s.inputs["Emission Color"].default_value = (*TEAL, 1.0)
_s.inputs["Emission Strength"].default_value = 4.0
```

Segments: each one is a prism spanning one hexagon side, between apothem 10.5 (inner) and 13.0 (outer), depth ±1.2 along Blender Y. Its outer corners reach 13.0 / cos 30° = 15.01, and its inner edge sits at 10.5 > `GATE_OPENING_R`.

```python
import random

APO_IN, APO_OUT, DEPTH = 10.5, 13.0, 1.2
GAP_T = 0.025                 # gap between segments, as a fraction of a side
MISSING = 4                   # the empty slot
CRACKED = {1: 0.42, 3: 0.61}  # slot -> where along the side the crack runs (0..1)
SEGMENTS = []
COS30 = math.cos(math.radians(30))


def side_point(k, apothem, t):
    """Point t (0..1) along hexagon side k at the given apothem, in Blender XZ."""
    r = apothem / COS30
    a0, a1 = math.radians(60 * k), math.radians(60 * (k + 1))
    x0, z0, x1, z1 = r * math.cos(a0), r * math.sin(a0), r * math.cos(a1), r * math.sin(a1)
    return (x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)


def prism(name, k, t0, t1, slip=0.0):
    """One stone block on side k from t0 to t1: an 8-vertex hull, depth ±DEPTH along Y."""
    verts = []
    for y in (-DEPTH, DEPTH):
        for apo, t in ((APO_IN, t0), (APO_OUT, t0), (APO_OUT, t1), (APO_IN, t1)):
            x, z = side_point(k, apo, t)
            verts.append((x, y + slip, z))
    faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    SCENE.collection.objects.link(ob)
    ob.data.materials.append(STONE)
    SEGMENTS.append(ob)
    return ob


for k in range(6):
    if k == MISSING:
        continue
    if k in CRACKED:
        c = CRACKED[k]
        prism(f"seg_{k}_a", k, GAP_T, c - 0.012)
        prism(f"seg_{k}_b", k, c + 0.012, 1 - GAP_T, slip=0.12)  # the broken piece has slipped
    else:
        prism(f"seg_{k}", k, GAP_T, 1 - GAP_T)
```

Then:
- For each segment, apply a 0.06-wide 2-segment bevel (the station's bevel block), and cut its long faces (`bpy.ops.mesh.subdivide(number_cuts=3)` in edit mode) so the normal bake has surface to land on.
- Rough rock detail comes from `bake_utils.make_hipoly_detail(lo, subsurf_levels=2, noise_scale=0.35, noise_strength=0.08)` plus `bake_utils.bake_normal_from_hipoly(...)`. Copy that call pattern exactly from `gen_cargo_ship.py`, which does the same for its hull.
- Join the segments into `DormantGate`, smart-project and pack the UVs, and bake colour, AO and normal like the station (TEX 1024).
- Build `GateStone` exactly as the station builds `HullBaked`: albedo texture plus `bake_utils.attach_normal_map`.

Glyph seams go on after the bake and are joined into `DormantGate` as its second primitive:

```python
rng = random.Random(7)
MID = (APO_IN + APO_OUT) / 2
SEAMS = []


def seam_strip(name, k, t0, t1, apo0, apo1, y):
    """A thin raised strip from (side k, t0, apo0) to (side k, t1, apo1) on the face at y."""
    xa, za = side_point(k, apo0, t0)
    xb, zb = side_point(k, apo1, t1)
    length = math.hypot(xb - xa, zb - za)
    bpy.ops.mesh.primitive_cube_add(size=1, location=((xa + xb) / 2, y, (za + zb) / 2),
                                    rotation=(0.0, -math.atan2(zb - za, xb - xa), 0.0))
    ob = bpy.context.object
    ob.scale = (length, 0.04, 0.10)
    ob.name = name
    ob.data.materials.append(SEAM)
    activate(ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    SEAMS.append(ob)


for k in range(6):
    if k == MISSING:
        continue
    for face_y in (-DEPTH - 0.02, DEPTH + 0.02):           # sun side and far side
        seam_strip(f"seam_{k}_{face_y}_spine", k, 0.15, 0.85, MID, MID, face_y)
        for j in range(rng.randint(2, 3)):                  # glyph ticks across the spine
            t = rng.uniform(0.2, 0.8)
            seam_strip(f"seam_{k}_{face_y}_tick{j}", k, t, t + rng.uniform(-0.03, 0.03), APO_IN + 0.5, APO_OUT - 0.5, face_y)
```

For the cracked slots, the spine crosses the crack, which is fine: it reads as a broken inscription.

Join `SEAMS` into `DormantGate` and export only that object. Run it:

```bash
~/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/gen_dormant_gate.py 2>&1 | grep -E "TRIS|MAX_RADIUS|BBOX|wrote|Error"
```

Expected: `TRIS_TOTAL` ≤ 3000, `MAX_RADIUS` ≤ 15.5.

- [ ] **Step 4: Optimize, register, check, render**

- Add `"dormant_gate"` to `MODELS`.
- Add `"$BLENDER" --background --python scripts/blender/gen_dormant_gate.py` to `generate.sh` under the shipyard line.
- Run `npm run assets:optimize`, then `npx vitest run tests/assetContracts.test.ts tests/assetProvenance.test.ts`. Expected: PASS.
- Render `assets-src/dormant_gate.glb` face-on from the sun side (camera at Blender `(0, -40, 0)` looking along +Y), plus one 3/4 view, and Read both. Confirm:
  - it reads as a broken hexagonal stone arch, not a ring and not a planet;
  - one slot is empty and two segments are visibly cracked;
  - the teal seams are visible, and the stone is near-black.

- [ ] **Step 5: Manifest and commits**

Add the hash and generator rows to `assets-src/MANIFEST.md`, then:

```bash
git -C assets-src add dormant_gate.glb MANIFEST.md
git -C assets-src commit -m "Add dormant_gate.glb (B2)"
git -C assets-src -c credential.helper='!gh auth git-credential' push
git add scripts/blender/gen_dormant_gate.py scripts/blender/generate.sh scripts/optimize-assets.mjs public/models/dormant_gate.glb tests/assetContracts.test.ts tests/assetProvenance.test.ts
git commit -m "feat(gate): procedural broken hexagonal arch with teal glyph seams"
```

---

### Task 8: Scene components and radar

**Files:**
- Create: `src/components/canvas/Shipyard.tsx`
- Create: `src/components/canvas/DormantGate.tsx`
- Modify: `src/components/canvas/GlobalCanvas.tsx:25-26, 599-600`
- Modify: `src/components/layout/RadarMap.tsx` (gate dot after the buoy rings, ~line 172)

**Interfaces:**
- Consumes:
  - `shipyard.glb` nodes `Shipyard` and `CraneTrolley` (Task 6);
  - `dormant_gate.glb` node `DormantGate` and material `GlyphSeam` (Task 7);
  - `SHIPYARD_POS`, `GATE_POS`, `GATE_RADIUS`, `GATE_SCAN_ID`, `GATE_SCAN_LABEL`, `GATE_RADAR_GREY` (Task 1);
  - `gateRadio`, `gateLine`, `gateDistance`, `seamIntensity` (Task 5);
  - `setScannable`/`removeScannable` (`src/utils/scannables.ts`); `ambientTime` (`src/utils/ambientTime.ts`);
  - `flight`, `useSpaceStore` (`src/store/spaceStore.ts`).
- Produces: scene objects named `Shipyard`, `CraneTrolley` and `DormantGate`. The e2e probes find them by those names.

- [ ] **Step 1: Shipyard component**

`src/components/canvas/Shipyard.tsx`:

```tsx
import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { SHIPYARD_POS } from "../../data/shipyard";
import { ambientTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";

/** The trolley slides ±TROLLEY_RUN along the gantry, one round trip every TROLLEY_PERIOD_S. */
const TROLLEY_RUN = 2.8;
const TROLLEY_PERIOD_S = 20;
const POSITION: [number, number, number] = [SHIPYARD_POS[0], SHIPYARD_POS[1], SHIPYARD_POS[2]];

/**
 * The shipyard (docs/archive/specs/2026-10-16-shipyard-gate-design.md §1),
 * built by scripts/blender/gen_shipyard.py. Docking is SpacePlanets' zone
 * check on the destination table and opens the Hangar. No collider, as with
 * the station: the lock radius (7.2) lies outside the model (≤ 5.0) by more
 * than the ship's half length. The crane stops under reduced motion
 * (ambientTime freezes).
 */
export default function Shipyard() {
  const { scene } = useGLTF(assetUrl("/models/shipyard.glb"));
  const trolley = useMemo(() => scene.getObjectByName("CraneTrolley") ?? null, [scene]);
  useFrame((state) => {
    if (!trolley) return;
    const t = ambientTime(state.clock.getElapsedTime());
    trolley.position.x = Math.sin((2 * Math.PI * t) / TROLLEY_PERIOD_S) * TROLLEY_RUN;
  });
  return <primitive object={scene} position={POSITION} />;
}
```

- [ ] **Step 2: Gate component**

`src/components/canvas/DormantGate.tsx`:

```tsx
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { GATE_POS, GATE_RADIUS, GATE_SCAN_ID, GATE_SCAN_LABEL } from "../../data/dormantGate";
import { gateDistance, gateLine, gateRadio, seamIntensity } from "../../utils/gatePass";
import { setScannable, removeScannable } from "../../utils/scannables";
import { ambientTime } from "../../utils/ambientTime";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { assetUrl } from "../../utils/assetUrl";

const POSITION: [number, number, number] = [GATE_POS[0], GATE_POS[1], GATE_POS[2]];

/**
 * The dormant gate (docs/archive/specs/2026-10-16-shipyard-gate-design.md),
 * built by scripts/blender/gen_dormant_gate.py. Its opening (+Z) is turned to
 * face the sun. The glyph seams pulse faintly and flicker as a ship closes
 * in (gatePass.seamIntensity: a uniform change, no new shader program).
 * Two one-time radio lines (gatePass.gateLine) go out as content broadcasts,
 * so the radio hold protects them from chatter. No collider: flying through
 * the frame is allowed, as at the station and the portal.
 */
export default function DormantGate() {
  const { scene } = useGLTF(assetUrl("/models/dormant_gate.glb"));
  const group = useRef<THREE.Group>(null);
  const seam = useMemo(() => {
    let found: THREE.MeshStandardMaterial | null = null;
    scene.traverse((o) => {
      if (!found && o instanceof THREE.Mesh && (o.material as THREE.Material).name === "GlyphSeam") {
        found = o.material as THREE.MeshStandardMaterial;
      }
    });
    return found as THREE.MeshStandardMaterial | null;
  }, [scene]);
  const prev = useRef({ x: flight.x, y: flight.y, z: flight.z });

  // Object3D.lookAt points +Z at the target for non-cameras: the opening faces the sun.
  useLayoutEffect(() => { group.current?.lookAt(0, 0, 0); }, []);

  useEffect(() => {
    setScannable(GATE_SCAN_ID, GATE_POS[0], GATE_POS[1], GATE_POS[2], GATE_SCAN_LABEL, GATE_RADIUS);
    return () => removeScannable(GATE_SCAN_ID);
  }, []);

  useFrame((state) => {
    const { reducedMotion } = useSpaceStore.getState();
    if (seam) seam.emissiveIntensity = seamIntensity(ambientTime(state.clock.getElapsedTime()), gateDistance(flight), reducedMotion);
    const line = gateLine(gateRadio, prev.current, flight);
    if (line) useSpaceStore.getState().sendBroadcast(line);
    prev.current.x = flight.x; prev.current.y = flight.y; prev.current.z = flight.z;
  });

  return (
    <group ref={group} position={POSITION}>
      <primitive object={scene} />
    </group>
  );
}
```

`sendBroadcast(text)` with no options is a non-silent broadcast, so it sets the 8 s hold (`src/utils/radioHold.ts`).

- [ ] **Step 3: Mount both**

In `src/components/canvas/GlobalCanvas.tsx`, import `Shipyard` and `DormantGate` next to `CareerStation`/`CareerTrail`, and render them right after `<CareerTrail />`, in the same Suspense block:

```tsx
          <CareerStation />
          <CareerTrail />
          <Shipyard />
          <DormantGate />
```

- [ ] **Step 4: Radar dot**

In `src/components/layout/RadarMap.tsx`, import `GATE_POS` and `GATE_RADAR_GREY` from `../../data/dormantGate`. After the career-buoy loop's closing `ctx.globalAlpha = 1;`, add:

```ts
      // The dormant gate: an unlabelled grey dot, in range only and never
      // rim-clamped, so it is found by flying (spec §2). No name, no ring.
      {
        const dx = wrapDelta(flight.x, GATE_POS[0], COSMIC_BOUNDS);
        const dz = wrapDelta(flight.z, GATE_POS[2], COSMIC_BOUNDS);
        const dy = wrapDelta(flight.y, GATE_POS[1], COSMIC_BOUNDS);
        if (Math.hypot(dx, dz, dy) <= RANGE) {
          const { x: sx, up } = worldToRadar(dx, dz, a);
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = GATE_RADAR_GREY;
          ctx.beginPath();
          ctx.arc(c + sx * scale, c - up * scale, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
```

The shipyard needs no radar change: it is a destination blip in its table colour.

- [ ] **Step 5: Type check, unit suite, and a real-browser look**

Run: `npx tsc -b --noEmit && npx vitest run`
Expected: PASS.

Then:
1. Start a dev server on a free port that is **not** 5199: `npm run dev -- --port 5173`, in the background, and note its PID.
2. Open it with the Playwright MCP browser at 1512×802.
3. Freeze motion: `window.__fitz.store.getState().setReducedMotion(true, true)`.
4. Teleport to `SHIPYARD_POS + (0, 3, 14)`, face it (`setAttitude(Math.atan2(-ox, -oz), 0)` with `(ox, oz)` the offset), wait 1.8 s and screenshot.
5. Do the same at `GATE_POS + GATE_NORMAL × 45`, facing the gate.
6. Turn reduced motion back off, wait and screenshot twice: the crane must have moved and the seams changed brightness.

Read the screenshots. Confirm:
- the shipyard reads as a dock in steel blue and white;
- the gate is a dark broken hexagon with teal seams, opening toward the sun;
- the radar shows a small grey dot near the gate.

Close the tab and stop the dev server **by its PID**.

- [ ] **Step 6: Commit**

```bash
git add src/components/canvas/Shipyard.tsx src/components/canvas/DormantGate.tsx src/components/canvas/GlobalCanvas.tsx src/components/layout/RadarMap.tsx
git commit -m "feat(landmarks): shipyard and dormant gate in the scene; gate radar dot"
```

---

### Task 9: PR #25 cleanups

**Files:**
- Modify: `tests/assetContracts.test.ts` (crystal comment ~line 251; cargo budget test ~lines 201–204; hero ship footprint ~lines 133–137; new freighter primitive test)
- Modify: `docs/archive/specs/2026-10-15-asset-pass-design.md:48`
- Modify: `scripts/blender/bake_utils.py:92-113`
- Regenerate: `assets-src/cargo_ship.glb`, `public/models/cargo_ship.glb`, `assets-src/MANIFEST.md`

**Interfaces:**
- Produces: `bake_utils.merge_material_slots(ob)`, called at the end of `apply_baked_material`. `cargo_ship.glb` then has one `HullBaked` primitive.

- [ ] **Step 1: Write the failing freighter test and fix the three test-only items**

In `tests/assetContracts.test.ts`:

1. Crystal comment: `// v1 was 366 triangles; six shards with stepped tips land around 500-650.`
2. Delete the cargo `describe`'s `it("stays inside its triangle and download budget", …)`, whose ≤ 12000 is redundant with the 8500 cap. Keep its download check by adding `expect(kb("cargo_ship")).toBeLessThanOrEqual(600);` to the "five on screen" test.
3. The hero-ship footprint check becomes relative, matching its title:

```ts
  it("keeps the v1 footprint (within 5%)", async () => {
    const b = bounds(await load("spaceship"));
    const V1_MIN = [-2.704, -0.58, -3.5], V1_MAX = [2.704, 0.646, 3.5];
    for (let i = 0; i < 3; i++) {
      const extent = V1_MAX[i] - V1_MIN[i];
      expect(Math.abs(b.min[i] - V1_MIN[i]), `min[${i}]`).toBeLessThanOrEqual(0.05 * extent);
      expect(Math.abs(b.max[i] - V1_MAX[i]), `max[${i}]`).toBeLessThanOrEqual(0.05 * extent);
    }
  });
```

   If this fails against the current `spaceship.glb`, report the measured relative error to the coordinator rather than widening it. The old absolute 0.14 was looser on y (extent 1.226 → 5% = 0.061), so a real v2 drift could show up here.

4. New test in the cargo `describe`:

```ts
  it("draws its hull in one primitive per material", async () => {
    // Up to five freighters fly at once: seven HullBaked primitives each
    // cost 30 extra draw calls against the modal-open ceiling.
    const prims = (await load("cargo_ship")).getRoot().listMeshes().flatMap((m) => m.listPrimitives());
    const names = prims.map((p) => p.getMaterial()?.getName());
    expect(names.filter((n) => n === "HullBaked")).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
  });
```

In `docs/archive/specs/2026-10-15-asset-pass-design.md:48`, change the freighter budget line to `- **Budget:** ≤ 8.5k triangles (five fly at once; v2: 8.4k), GLB ≤ 600 KB (v2: 374 KB).`

- [ ] **Step 2: Run them to verify the new one fails**

Run: `npx vitest run tests/assetContracts.test.ts`
Expected: FAIL only on "draws its hull in one primitive per material" (7 HullBaked primitives).

- [ ] **Step 3: Merge the slots in the bake helper**

In `scripts/blender/bake_utils.py`, add:

```python
def merge_material_slots(ob):
    """Point every face at the first slot holding its material, then drop the
    emptied slots, so the glTF export writes one primitive per material
    instead of one per original slot (seven HullBaked primitives per
    freighter before 2026-10-16)."""
    first = {}
    remap = {}
    for i, slot in enumerate(ob.material_slots):
        if slot.material is None:
            continue
        remap[i] = first.setdefault(slot.material.name, i)
    if all(remap[i] == i for i in remap):
        return
    idx = [0] * len(ob.data.polygons)
    ob.data.polygons.foreach_get("material_index", idx)
    ob.data.polygons.foreach_set("material_index", [remap.get(i, i) for i in idx])
    ob.data.update()
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.material_slot_remove_unused()
```

At the end of `apply_baked_material`, before `return mat`, add:

```python
    for ob in objects:
        merge_material_slots(ob)
```

`gen_cargo_ship.py:209` is the only caller (checked while planning), so no other model changes.

- [ ] **Step 4: Regenerate the freighter and check it**

```bash
~/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/gen_cargo_ship.py 2>&1 | grep -E "TRIS|wrote|Error"
npm run assets:optimize
npx vitest run tests/assetContracts.test.ts tests/assetProvenance.test.ts
```

Expected: PASS, every freighter contract included. `cargo_ship.glb` is not byte-reproducible (UV packer), so a changed hash is expected.

Render the new `assets-src/cargo_ship.glb` next to the previous one (`git -C assets-src show HEAD:cargo_ship.glb > <scratchpad>/cargo_prev.glb`) from the same 3/4 view, and Read both: the hull must look the same.

- [ ] **Step 5: Manifest and commits**

Update `cargo_ship.glb`'s hash row in `assets-src/MANIFEST.md`, and add one sentence to its generator row: "Since 2026-10-16 the bake merges duplicate material slots: one HullBaked primitive."

```bash
git -C assets-src add cargo_ship.glb MANIFEST.md
git -C assets-src commit -m "Rebake cargo_ship.glb with one HullBaked primitive"
git -C assets-src -c credential.helper='!gh auth git-credential' push
git add scripts/blender/bake_utils.py public/models/cargo_ship.glb tests/assetContracts.test.ts docs/archive/specs/2026-10-15-asset-pass-design.md
git commit -m "fix(assets): one HullBaked primitive per freighter; tidy PR #25 contract tests"
```

---

### Task 10: End-to-end probes

**Files:**
- Create: `tests/e2e/shipyard.probe.mjs`
- Modify: `tests/e2e/run.mjs:6` (add `"shipyard"` after `"careerphone"`)
- Modify: `tests/e2e/career.probe.mjs:103-111` (contact is key 6)
- Modify: `tests/e2e/logbook.probe.mjs:47-68` (picker → pointer)
- Modify: `tests/e2e/gamepad.probe.mjs:85-111` (View → shipyard)
- Modify: `tests/e2e/programs.probe.mjs:23-35` (tour stops)

**Interfaces:**
- Consumes: everything above; harness helpers `withPage`, `settle`, `lockFullFidelity`, `readStore`, `pollUntil`, `chatterText` (`tests/e2e/harness.mjs`); `window.__fitz.teleport`, `setAttitude`, `flight`, `scene`, `gl`, `store`.

- [ ] **Step 1: Update the existing probes**

`career.probe.mjs`: the "[5] Contact still works" block's first two statements become the code below. The rest of that block stays.

```js
    // [6] Contact still works (the shipyard took 5).
    await page.keyboard.press("Digit6");
    checks.check("key 6 jumps to the contact portal and docks", (await dockedAt(page, "contact")).ok);
```

`logbook.probe.mjs`: replace the section from `// Plume: gold changes uColor…` through the `"after picking a plume, W still flies the ship"` check with the code below. Keep the "header is not covered by the HUD" check that follows.

```js
  // The plume picker moved to the shipyard's Hangar (B2): the logbook points there.
  const pointer = await page.evaluate(() => ({
    text: document.querySelector('[data-testid="logbook-plume-pointer"]')?.textContent ?? "",
    swatches: document.querySelectorAll('[data-testid^="plume-"]').length,
  }));
  checks.check("the logbook points to the shipyard for plumes",
    /ENGINE PLUME: CYAN · CHANGE IT AT THE SHIPYARD \[5\]/.test(pointer.text), pointer.text);
  checks.check("the logbook no longer holds the plume picker", pointer.swatches === 0, `swatches=${pointer.swatches}`);
```

`gamepad.probe.mjs`: change the comment above the d-pad block to `// D-pad jumps mirror keys 1–4; Menu = the contact portal, View = the shipyard.` After the Menu check, add:

```js
    // Let Menu's jump dock and close it, so View's request is a fresh one.
    const atPortal = await pollUntil(async () => (await readStore(page)).isOrbitLocked,
      { timeoutMs: 15_000, intervalMs: 300 });
    if (atPortal.ok) await press(page, 1);
    await press(page, 8);
    s = await readStore(page);
    checks.check("View requests the shipyard", s.jumpRequest?.id === "shipyard", `jump=${s.jumpRequest?.id}`);
```

`programs.probe.mjs`: inside the same `page.evaluate` that imports `careerTrail.ts`, add the imports below and two stops before `"sun"`. Name the new stops in the probe's header comment.

```js
      const { SHIPYARD_POS } = await import("/src/data/shipyard.ts");
      const { GATE_POS, GATE_NORMAL } = await import("/src/data/dormantGate.ts");
      // …in the returned list, before "sun":
        // 14 out: outside the shipyard's 8.5 zone, so the tour never docks.
        ["shipyard", SHIPYARD_POS[0], SHIPYARD_POS[1], SHIPYARD_POS[2] + 14],
        // 40 out along the axis: inside the sense radius, so the seams flicker.
        ["dormant gate", GATE_POS[0] + GATE_NORMAL[0] * 40, GATE_POS[1] + GATE_NORMAL[1] * 40, GATE_POS[2] + GATE_NORMAL[2] * 40],
```

- [ ] **Step 2: Write the shipyard probe**

`tests/e2e/shipyard.probe.mjs`:

```js
import { withPage, settle, lockFullFidelity, readStore, pollUntil, chatterText } from "./harness.mjs";

/**
 * Shipyard and dormant gate (docs/archive/specs/2026-10-16-shipyard-gate-design.md):
 * key 5 docks at the shipyard and opens the Hangar, an unlocked plume can be
 * picked there (uniform change, no new shader program) while a locked one
 * cannot, Esc closes it, the crane trolley moves; the gate plays its
 * approach line inside the sense radius, scans as an unknown structure, plays
 * its pass line on a flight through the opening, and none of it compiles a
 * new program. Physics waits use pollUntil: each read pumps frames under
 * headless SwiftShader (see harness.mjs settle()).
 */
const ready = (page) => page.waitForFunction(() => window.__fitz?.store.getState().sceneReady, { timeout: 60_000 });
const dockedAt = (page, zone) => pollUntil(async () => {
  const s = await readStore(page);
  return s.isOrbitLocked && s.activeZone === zone;
}, { timeoutMs: 15_000, intervalMs: 200 });
const radioHas = (page, text) => pollUntil(async () => {
  const t = (await chatterText(page)) ?? "";
  const b = (await readStore(page)).broadcast?.text ?? "";
  return t.includes(text) || b.includes(text) ? true : null;
}, { timeoutMs: 15_000, intervalMs: 150 });

export default async function run() {
  return withPage({ label: "shipyard" }, async (page, checks) => {
    await page.evaluate(() => ["fitz-logbook", "fitz-dossiers"].forEach((k) => localStorage.removeItem(k)));
    // A reload drops the low-perf pin: register it first (B1 lesson).
    await page.evaluateOnNewDocument(lockFullFidelity);
    await page.reload();
    await ready(page);
    await settle(page, 3000);
    const programsBefore = await page.evaluate(() => window.__fitz.gl.info.programs.length);
    const { gate, lines } = await page.evaluate(async () => {
      const m = await import("/src/data/dormantGate.ts");
      return { gate: { pos: [...m.GATE_POS], n: [...m.GATE_NORMAL] }, lines: m.GATE_LINES };
    });
    const along = (d) => gate.pos.map((v, i) => v + gate.n[i] * d);

    // [5] Shipyard: jump, dock, Hangar.
    await page.evaluate(() => window.__fitz.store.getState().recordBadge("slingshot"));
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Digit5");
    checks.check("key 5 jumps to the shipyard and docks", (await dockedAt(page, "shipyard")).ok);
    await settle(page, 800);
    const hangar = await page.evaluate(() => {
      const d = document.querySelector('[data-testid="hangar-panel"]');
      return d ? { text: d.textContent ?? "", focus: document.activeElement?.getAttribute("aria-label") ?? "" } : null;
    });
    checks.check("docking at the shipyard opens the Hangar", !!hangar && hangar.text.includes("SHIPYARD // HANGAR"));
    checks.check("focus moves into the Hangar", /close hangar/i.test(hangar?.focus ?? ""), hangar?.focus ?? "");

    // Plume: gold (earned above) changes uColor and adds no program; ring stays locked.
    const before = await page.evaluate(() => window.__fitz.gl.info.programs.length);
    await page.click('[data-testid="plume-slingshot"]');
    await settle(page, 600);
    const after = await page.evaluate(() => {
      let hex = null;
      window.__fitz.scene.traverse((o) => {
        const u = o.material?.uniforms;
        if (!hex && u?.uColor && u?.uPower && o.name !== "TractorBeamCone") hex = u.uColor.value.getHexString();
      });
      return { hex, programs: window.__fitz.gl.info.programs.length, plume: window.__fitz.store.getState().plumeColor };
    });
    checks.check("picking gold in the Hangar sets the plume colour", after.plume === "slingshot" && after.hex === "ffc23d", JSON.stringify(after));
    checks.check("a plume colour adds no shader program", after.programs === before, `before=${before} after=${after.programs}`);
    checks.check("a locked plume cannot be picked",
      await page.evaluate(() => document.querySelector('[data-testid="plume-ring"]')?.disabled === true));
    // A swatch click must not trap the keyboard: Esc still closes the Hangar.
    await page.keyboard.press("Escape");
    await settle(page, 2500);
    checks.check("Esc closes the Hangar after a plume click", !(await readStore(page)).isOrbitLocked);

    // The crane trolley slides (reduced motion is off in this probe).
    const trolleyX = () => page.evaluate(() => {
      let x = null;
      window.__fitz.scene.traverse((o) => { if (x === null && o.name === "CraneTrolley") x = o.position.x; });
      return x;
    });
    const x0 = await trolleyX();
    for (let i = 0; i < 8; i++) { await settle(page, 200); await readStore(page); }
    const x1 = await trolleyX();
    checks.check("the crane trolley moves", x0 !== null && x1 !== null && x0 !== x1, `${x0} -> ${x1}`);

    // Gate: the approach line plays inside the sense radius.
    await page.evaluate((p) => window.__fitz.teleport(p[0], p[1], p[2]), along(40));
    checks.check("the gate's approach line plays inside its sense radius", (await radioHas(page, lines.approach)).ok,
      (await chatterText(page)) ?? "");

    // Gate: scan from the axis, 20 out (scan range 22 is measured from the frame's radius).
    await page.evaluate((p) => { window.__fitz.teleport(p[0], p[1], p[2]); window.__fitz.flight.input.scan = true; }, along(20));
    const report = await pollUntil(async () => {
      const t = (await readStore(page)).broadcast?.text ?? "";
      return t.startsWith("SCAN[UNKNOWN_STRUCTURE]") ? t : null;
    }, { timeoutMs: 30_000, intervalMs: 300 });
    await page.evaluate(() => { window.__fitz.flight.input.scan = false; });
    checks.check("scanning the gate reports an unknown, dormant structure",
      report.value === "SCAN[UNKNOWN_STRUCTURE] // ORIGIN UNKNOWN // DORMANT // NO RESPONSE TO HAIL", report.value ?? "no report");

    // Gate: a flight through the opening plays the pass line. Two short
    // teleports (8 units, under race.ts MAX_STEP 10) straddle the plane.
    await page.evaluate((p) => window.__fitz.teleport(p[0], p[1], p[2]), along(4));
    await settle(page, 400);
    await readStore(page);
    await page.evaluate((p) => window.__fitz.teleport(p[0], p[1], p[2]), along(-4));
    checks.check("flying through the gate plays the pass line", (await radioHas(page, lines.pass)).ok,
      (await chatterText(page)) ?? "");

    // The gate stays nameless outside the scanner: the radio panel (which may
    // show the scan line) is excluded; no other HUD text may name it.
    const named = await page.evaluate(() => {
      const radio = document.querySelector('[data-testid="radio-chatter"]');
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let hit = null;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (radio && radio.contains(n)) continue;
        if (/UNKNOWN_STRUCTURE|DORMANT/.test(n.textContent ?? "")) { hit = n.textContent; break; }
      }
      return hit;
    });
    checks.check("no HUD text names the gate outside the scan line", named === null, named ?? "");

    // [6] Contact.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Digit6");
    checks.check("key 6 jumps to the contact portal and docks", (await dockedAt(page, "contact")).ok);
    await settle(page, 800);
    checks.check("the contact portal opens the contact form",
      await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="Contact"]')));
    await page.keyboard.press("Escape");
    await settle(page, 1500);

    const programsAfter = await page.evaluate(() => window.__fitz.gl.info.programs.length);
    checks.check("the shipyard and the gate compile no new shader program", programsAfter === programsBefore,
      `before=${programsBefore} after=${programsAfter}`);
  });
}
```

Add `"shipyard"` to `PROBES` in `tests/e2e/run.mjs`, after `"careerphone"`.

Check how the radio line is marked up: grep for `radio-chatter` in `src/components/layout`. If the test id sits on a different element than the one holding the text, point the exclusion at the element that actually contains the chatter text.

- [ ] **Step 3: Run the affected probes**

Close Playwright tabs and confirm nothing listens on 5199 (`lsof -iTCP:5199 -sTCP:LISTEN`). Then:

Run: `npm run test:e2e -- shipyard career logbook gamepad programs`
Expected: all checks pass. If one fails, debug it with superpowers:systematic-debugging; don't weaken the check. The known B1 pitfalls are a `page.reload()` dropping the low-perf pin, and debug teleport being a silent no-op while orbit-locked: always Esc out of a dock before teleporting.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/shipyard.probe.mjs tests/e2e/run.mjs tests/e2e/career.probe.mjs tests/e2e/logbook.probe.mjs tests/e2e/gamepad.probe.mjs tests/e2e/programs.probe.mjs
git commit -m "test(e2e): shipyard hangar, gate scan and radio, key 6 contact, View shipyard, longer programs tour"
```

---

### Task 11: Budgets, docs, changelog and full verification

**Files:**
- Modify: `tests/e2e/transition.probe.mjs:12-29` (only ceilings the new models push past)
- Modify: `docs/PERF-BUDGETS.md`
- Modify: `README.md:24-27, 45-48, 110-113`
- Modify: `src/data/changelog.ts` (new first entry)

- [ ] **Step 1: Measure**

Close Playwright tabs and make sure 5199 is free. Then:

Run: `npm run test:e2e -- transition`
Record `calls`, `triangles`, `programs` and `lights` for each state (deep space, close approach, modal open, 40 anomalies). Expect calls to fall about 30 from the freighter merge (Task 9) and rise by up to 6 from the new models.

- [ ] **Step 2: Re-baseline only what was pushed past**

For each ceiling the run exceeds, raise it to the new baseline + 15%, rounded up to the nearest ten: the rule in `docs/PERF-BUDGETS.md`. Leave every other ceiling unchanged, and lower none in this PR.

Append a dated section to `docs/PERF-BUDGETS.md`. Fill N, C and T from Step 1 and list exactly which constants changed.

```markdown
**B2 landmarks measured 2026-10-16 (shipyard, dormant gate, freighter rebake).**
`shipyard.glb` (N tris, 4 draw calls) and `dormant_gate.glb` (N tris, 2 draw
calls) joined the scene; both reuse the freighter's HullBaked / NavRed
configurations, so programs did not move. The freighter rebake (one HullBaked
primitive instead of seven) removed up to 30 calls with five freighters on
screen. Measured: deep space C / T, close approach C / T, modal open C / T,
40 anomalies C / T. Ceilings changed: <list, or "none">.
```

- [ ] **Step 3: README**

Key table: replace the `5` row with `| `5` | Jump to the shipyard (opens the Hangar: engine plume colours) |`, and add `| `6` | Jump to the contact portal |`. Esc row: "Close the open dossier, hangar or contact form".

Gamepad sentence: "…the d-pad (clockwise from up) jumps like `1`–`4`, View jumps to the shipyard, and Menu jumps to the contact portal."

Asset table, new row: `| Career station, buoy, shipyard, dormant gate | `scripts/blender/gen_career_station.py`, `gen_buoy.py`, `gen_shipyard.py`, `gen_dormant_gate.py` |`.

Do **not** describe the gate as a feature in the README's controls or prose. It is meant to be found.

- [ ] **Step 4: Changelog entry**

Add as the first element of `CHANGELOG` in `src/data/changelog.ts`. Limits from `tests/changelog.test.ts`: title ≤ 4 words, `what`/`why` ≤ 220 chars, `how` ≤ 240.

```ts
  { id: "2026-10-16-shipyard", date: "2026-10-16", pr: 28, title: "The Shipyard", what: "A shipyard now floats above the asteroid belt: press 5 to dock and change your engine plume in its hangar. Contact moves to 6. Far past the planets, something old is waiting to be found.", why: "Plume colours were buried in the logbook, and the ship's look needed a real home before hull paint arrives. The outer system also had nothing to discover.", how: "The shipyard is one more row in the destination table, so jumps, docking, radar and the sector list picked it up for free. Both models are scripted in Blender, and freighters were rebaked to cost fewer draw calls." },
```

Run `npx vitest run tests/changelog.test.ts`. Expected: PASS. If a length check fails, shorten that field without changing its meaning.

- [ ] **Step 5: Full verification**

Close Playwright tabs and free port 5199, then:

```bash
npx tsc -b --noEmit
npx vitest run
npm run build
npm run test:e2e
```

Expected: no type errors, all unit tests passing, the build succeeding, and every e2e probe passing. Capture-only notes are fine. If a probe fails in the full run, re-run it alone once. If it passes alone and fails in the full run, treat it as a real ordering bug and debug it.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/transition.probe.mjs docs/PERF-BUDGETS.md README.md src/data/changelog.ts
git commit -m "docs: B2 budgets, README keys and the shipyard patch note"
```

---

## Self-review notes

- **Spec coverage:**
  - §1 shipyard look, size and position → Tasks 1, 6 and 8. Gate look, size, position, orientation and no collider → Tasks 1, 7 and 8. Placement rules → Task 1.
  - §2 destination row and `waypoint` → Task 2. Hangar and plume move, logbook pointer and badge line → Task 4. Keys and pad by id → Tasks 2 and 3.
  - §2 gate: idle pulse, flicker and reduced motion → Tasks 5 and 8. Scan → Task 2. Radio → Tasks 5 and 8. Pass detection → Task 5. Radar → Task 8. Nameless HUD → Task 10.
  - §3 assets → Tasks 6 and 7. Performance → Tasks 9 and 11. Tests → every task, plus Task 10.
  - §4 cleanups → Task 9. Delivery: changelog → Task 11; the PR follows execution (superpowers:finishing-a-development-branch).
- **Deliberate deviation from the spec:** the spec put only pass detection in `src/utils/gatePass.ts`. The plan also puts the one-time radio state and the seam intensity there, since they are the same gate's pure logic, and reuses `race.ts`'s `crossesGate` instead of writing a second plane test.
- **Draw-call note found while planning:** `cargo_ship.glb` has 7 `HullBaked` primitives (inspected). Merging them in Task 9 should free about 30 calls at five freighters, which is more than B2 adds (6). Task 11 measures before touching any ceiling.
