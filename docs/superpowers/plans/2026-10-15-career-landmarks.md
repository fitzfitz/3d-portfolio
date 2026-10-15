# Career Landmarks (B1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the career history into the universe: a career station you dock at to read a Career dossier, a trail of five buoys (one per job, oldest first) with fly-by cards, and a destination table that replaces every hard-coded `"contact"` check so later landmarks are one row each.

**Architecture:** `src/data/destinations.ts` becomes the single source for non-planet places (id, labels, position, colour, lock radii, jump standoff); every consumer that special-cased `"contact"` iterates it, so adding the station is one row. Placement lives in `src/data/careerTrail.ts`: the station position, a circular trail arc through three anchors, and five buoys computed on that arc, all guarded by a clearance test. Two seeded Blender generators produce the station and buoy GLBs with material configurations the scene already compiles; the station is a `<primitive>` whose `HabitatRing` node spins, the buoys are one `InstancedMesh`, and the trail is one `RingGeometry` arc drawn with `makeGuideLineMaterial`.

**Tech Stack:** React 19 + React Three Fiber 9 + three.js 0.185, zustand 5, framer-motion 12, Vite 8, Vitest 4 (node environment; components tested with `react-dom/server`), the repo's Puppeteer e2e probes (`tests/e2e`), Blender 5.1 headless (bpy, bmesh, numpy), glTF-Transform 4 + meshoptimizer.

**Spec:** `docs/superpowers/specs/2026-10-15-career-landmarks-design.md`

## Global Constraints

- Contact keeps its current position, radii, labels and colour exactly: pos `[0, 95, -150]`, zoneR 2.2, lockR 1.5, retainR 3.4, orbitR 2.6, colour `#ec4899`, scan label `PORTAL_SUN`, jump standoff 1.2, escape push 3.795.
- Career radii: zoneR 8.5, lockR 5.8, retainR 13, orbitR 10 (spec), plus jumpR 5.4 (this plan's ruling). orbitR must stay inside retainR (`tests/orbitInvariant.test.ts`).
- Keys: `[1–3]` planets, `[4]` Career, `[5]` Contact. Gamepad: d-pad clockwise from up = targets 1–4; Menu/Start (standard button 9) = target 5.
- Logbook: a fifth essential, `id: "career"`, title "Read the career dossier", recorded when you dock at the station.
- Waypoint order: nearest unread planet, then the career station, then the contact portal.
- Station palette: neutral greys with amber `#ffb547`. It must read as built, never as a sphere or planet.
- No new career content: the landmarks render `src/data/career.ts` as it is.
- `career_station.glb`: separate `HabitatRing` node, emissive `DockLight` material, ≤ 6 000 triangles. `buoy.glb`: one mesh, ≤ 400 triangles, emissive `BuoyGlow` material.
- No new lights: `LIGHT_BUDGET` stays 4. The buoys are one `InstancedMesh`. Materials copy existing configurations (station `HullBaked` = cargo `HullBaked`; `DockLight` = cargo `NavRed`; `BuoyGlow` = `Data_Shard`), so the shader-program count stays flat.
- Performance ceilings (`docs/PERF-BUDGETS.md`, `tests/e2e/transition.probe.mjs`): deep space calls ≤ 40, triangles ≤ 250 580, programs ≤ 79. Deep-space triangle headroom is about 10.5k; the station (≤ 6k) plus buoys (≤ 2k) must fit.
- `public/models/` total < 8 MB (6.75 MB today).
- Blender binary: `/Users/fitzgeral/Applications/Blender.app/Contents/MacOS/Blender` (note `~/Applications`, not `/Applications`). Below, `B` means this path.
- `<scratchpad>` means `/private/tmp/claude-502/-Users-fitzgeral-Kerja-proj-fitz/a350a01f-acbc-47eb-abc7-e509d209f0b6/scratchpad` (throwaway files only; never commit them).
- **Never install packages** (`npm install`, `npm ci`, `pnpm`, `npx <new package>`, …). Everything needed is already in `node_modules`. If a dependency seems missing, stop and report.
- **Never kill processes by name** (`pkill`, `killall`, `kill -9 $(pgrep …)`). Only stop a server you started yourself, by its port: `lsof -ti tcp:<port> | xargs -r kill`.
- `assets-src/` is its own git repo (remote `fitzfitz/3d-portfolio-assets-src`); the main repo ignores it. Commit there separately. Push it with `gh auth switch -u fitzfitz`, then `git -C assets-src -c credential.helper= -c 'credential.helper=!gh auth git-credential' push`, then `gh auth switch -u fitz-pro`. Push the main repo the same way.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The PR body ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Do not merge the PR: merging deploys to GitHub Pages and Cloudflare, and that is the user's call.

## Review Focus

1. **The contact portal regressing in the table migration.** Any one of eight consumers (zone, lock, retain, scannable, jump standoff, escape push, radar, waypoint, HUD row, modal) silently changing a value or label. Pinned in Task 1 by `tests/destinations.test.ts` ("keeps the contact portal exactly as it was", which covers jump standoff and escape push) and in Task 8 by the career probe's "key 5 jumps to the contact portal and docks" and "still opens the contact form".
2. **Key 5 / pad Menu not reaching contact, or d-pad left still reaching contact.** Once the career row is fourth, every index-based mapping shifts. Pinned in Task 1 (`padActions` maps Menu to index 4), Task 5 (`JUMP_TARGETS` puts career at index 3 and contact at 4; `runPadAction` sends d-pad left to career and Menu to contact), the updated `gamepad` probe, and the career probe's key 4 and key 5 checks.
3. **Returning visitors whose saved progress has only 4 essentials.** They must drop from "complete" to "one to go" without crashing or announcing anything at load, be pointed at the career dossier, keep their plume colours, and get the tour and "all" milestones exactly once, on docking. Pinned in Task 5 by the "returning visitors" block in `tests/logbook.test.ts` and the stored-career-badge test in `tests/spaceStore.test.ts`.
4. **Orbit-lock geometry for the career radii.** If orbitR leaves retainR the lock breaks a frame after engaging; if jumpR is not inside lockR a jump arrives without docking; if jumpR is inside the model the ship parks in the hull; if the escape push stays inside retainR the lock re-engages. Pinned in Task 1 by the destination loop in `tests/orbitInvariant.test.ts`, which covers the career row once Task 5 adds it, and in Task 3 by the contract "fits inside the career jump standoff" (max vertex radius < jumpR).
5. **Buoy card flicker or stale card at the radius boundary.** A ship drifting at about 6 units must not toggle the card every frame, a card must not open from outside the card radius, and a scanned card must expire. Pinned in Task 7 by `tests/buoyCard.test.ts` (hysteresis sequence, no open from the exit band, scan-hold expiry) and in Task 8 by the career probe's show, hide and scan checks.

## File Structure

| File | Task | Responsibility |
| --- | --- | --- |
| `src/data/destinations.ts` (new) | 1, 5 | Destination table, `RESERVED_ZONE_IDS`, `JUMP_TARGETS`, `destinationById`, `escapeR`, `afterPlanets` |
| `src/data/careerTrail.ts` (new) | 2 | Station position and radii, trail arc, buoys (oldest first), amber colour, card radius |
| `scripts/blender/gen_career_station.py`, `gen_buoy.py` (new) | 3 | Seeded generators → `assets-src/*.glb` |
| `src/components/sections/CareerList.tsx` (new) | 4 | Shared work-history list (résumé + dossier) |
| `src/components/layout/CareerDossier.tsx` (new) | 4 | Career dialog shown when docked at the station |
| `src/components/canvas/CareerStation.tsx` (new) | 6 | Station model, spinning ring |
| `src/components/canvas/CareerTrail.tsx` (new) | 6, 7 | Buoy InstancedMesh, trail guide arc, buoy scannables, card state writer |
| `src/utils/trailGuide.ts` (new) | 6 | Places a RingGeometry arc on the trail arc |
| `src/utils/buoyCard.ts` (new) | 7 | Pure `activeBuoy` (hysteresis + scan hold), `buoyCardState`, `buoyIndex` |
| `src/components/layout/BuoyCard.tsx` (new) | 7 | DOM card, rAF-driven |
| `tests/e2e/career.probe.mjs` (new) | 8 | End-to-end career flow |
| Modified | 1–9 | `App.tsx`, `spaceStore.ts`, `navigation.ts`, `gamepad.ts`, `useGamepadInput.ts`, `Spaceship.tsx`, `SpacePlanets.tsx`, `HUDOverlay.tsx`, `RadarMap.tsx`, `WaypointDriver.tsx`, `Scanner.tsx`, `GlobalCanvas.tsx`, `FuelCrystals.tsx`, `crystalField.ts`, `logbook.ts`, `scanReport.ts`, `chatterLines.ts`, `constants.ts`, `Career.tsx`, `changelog.ts`, `optimize-assets.mjs`, `generate.sh`, `README.md`, probes `logbook`/`gamepad`/`programs`, `run.mjs` |

---

### Task 1: Destination table, with every "contact" special case migrated (behaviour unchanged)

The table holds only `contact` in this task. Every consumer reads it, so Task 5 adds the station by adding one row. One string stays deliberately: App still compares `zoneDestination === "contact"` to pick the contact-form modal, because each destination has its own bespoke modal (spec: "App picks the modal by activeZone"). The comparison is typed against the `DestinationId` union, so a typo fails to compile. The other remaining `"contact"` strings are data rather than special cases (logbook entry and badge line, `scanReport` and `chatterLines` keys, the résumé's `#contact` anchor). The HUD's "all dossiers read" broadcast is copy that names the portal and is rewritten generically in Task 5.

**Files:**
- Create: `src/data/destinations.ts`, `tests/destinations.test.ts`
- Modify: `src/constants.ts:19-24`, `src/utils/navigation.ts:25-35`, `src/utils/gamepad.ts:8,26,74-85`, `src/store/spaceStore.ts:7,321-327,520-523,547-548`, `src/App.tsx:32,49-54,118,134-136,374`, `src/components/canvas/Spaceship.tsx:5,60-66,223-235,469-473`, `src/components/canvas/SpacePlanets.tsx:8-12,376-379,486-495`, `src/components/layout/HUDOverlay.tsx:3,19-21,357-372`, `src/components/layout/RadarMap.tsx:2,10,61`, `src/components/canvas/WaypointDriver.tsx` (whole file)
- Test: `tests/destinations.test.ts`, `tests/navigation.test.ts`, `tests/gamepad.test.ts`, `tests/orbitInvariant.test.ts`, `tests/projects.test.ts`, `tests/spaceStore.test.ts`

**Interfaces:**
- Produces (`src/data/destinations.ts`):
  - `type DestinationId = "contact" | "career"`
  - `interface Destination { id: DestinationId; label: string; jumpLabel: string; scanLabel: string; pos: readonly [number, number, number]; color: string; zoneR: number; lockR: number; retainR: number; orbitR: number; jumpR: number }`
  - `DESTINATIONS: readonly Destination[]` (table order = key order)
  - `RESERVED_ZONE_IDS: readonly DestinationId[]` (moved here from `constants.ts`)
  - `destinationById(id: string | null | undefined): Destination | undefined`
  - `escapeR(d: Destination): number`: the break-orbit push radius, `zoneR × 1.15 × 1.5`
  - `interface JumpTarget { id: string; label: string; color: string }`, `JUMP_TARGETS: readonly JumpTarget[]`: planets in order, then destinations
  - `afterPlanets(badges: readonly { id: string }[]): DestinationId`: the first destination whose badge is not recorded, else the last one
- Produces: `nextWaypoint(ship, names, bodies, visited, fallback: string): string` (new required 5th parameter); `padActions` maps button 9 (Menu) to `{ kind: "jump", index: 4 }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/destinations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DESTINATIONS, RESERVED_ZONE_IDS, JUMP_TARGETS, destinationById, escapeR, afterPlanets,
} from "../src/data/destinations";
import { PORTAL_POS, PORTAL_LOCK_R, projects, planets } from "../src/constants";

describe("destination table", () => {
  it("keeps the contact portal exactly as it was before the table", () => {
    const c = destinationById("contact")!;
    expect(c).toMatchObject({
      id: "contact", label: "CONTACT PORTAL", jumpLabel: "Contact", scanLabel: "PORTAL_SUN",
      color: "#ec4899", zoneR: 2.2, lockR: 1.5, retainR: 3.4, orbitR: 2.6,
    });
    expect(c.pos).toEqual([0, 95, -150]);
    expect(c.pos).toBe(PORTAL_POS);
    // Spaceship's old JUMP_PORTAL_R and break-orbit push, now read from the table.
    expect(c.jumpR).toBe(PORTAL_LOCK_R * 0.8);
    expect(escapeR(c)).toBeCloseTo(2.2 * 1.15 * 1.5, 10);
  });

  it("has unique ids", () => {
    expect(new Set(DESTINATIONS.map((d) => d.id)).size).toBe(DESTINATIONS.length);
  });

  it("reserves every destination id so no project can claim one", () => {
    expect([...RESERVED_ZONE_IDS]).toEqual(DESTINATIONS.map((d) => d.id));
    for (const p of projects) expect(RESERVED_ZONE_IDS).not.toContain(p.id);
  });

  it("looks destinations up by id, and nothing else", () => {
    expect(destinationById(null)).toBeUndefined();
    expect(destinationById(undefined)).toBeUndefined();
    expect(destinationById(planets[0].name)).toBeUndefined();
    for (const d of DESTINATIONS) expect(destinationById(d.id)).toBe(d);
  });
});

describe("jump order", () => {
  it("is every planet in orbit order, then every destination in table order", () => {
    expect(JUMP_TARGETS.map((t) => t.id)).toEqual([...planets.map((p) => p.name), ...DESTINATIONS.map((d) => d.id)]);
    for (const d of DESTINATIONS) {
      expect(JUMP_TARGETS.find((t) => t.id === d.id)).toMatchObject({ label: d.jumpLabel, color: d.color });
    }
  });
});

describe("afterPlanets", () => {
  it("points at the first destination whose essential is not done, then at the last one", () => {
    expect(afterPlanets([])).toBe(DESTINATIONS[0].id);
    expect(afterPlanets([{ id: "slingshot" }])).toBe(DESTINATIONS[0].id);
    expect(afterPlanets(DESTINATIONS.map((d) => ({ id: d.id })))).toBe(DESTINATIONS[DESTINATIONS.length - 1].id);
  });
});
```

In `tests/navigation.test.ts`, replace:

```ts
  it("points at the nearest unvisited planet", () => {
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, [])).toBe("saas");
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, ["saas"])).toBe("video");
  });

  it("points at the contact portal once every dossier is read", () => {
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, ["saas", "video", "agent"])).toBe("contact");
  });
```

with:

```ts
  it("points at the nearest unvisited planet", () => {
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, [], "contact")).toBe("saas");
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, ["saas"], "contact")).toBe("video");
  });

  it("points at the fallback destination once every dossier is read", () => {
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, ["saas", "video", "agent"], "contact")).toBe("contact");
    expect(nextWaypoint({ x: 0, y: 0, z: 0 }, names, bodies, ["saas", "video", "agent"], "career")).toBe("career");
  });
```

In `tests/gamepad.test.ts`, inside `describe("padActions", …)` after the d-pad test, add:

```ts
  it("maps Menu to the fifth jump target (the contact portal once the career station is fourth)", () => {
    expect(padActions(press(), press(9))).toEqual([{ kind: "jump", index: 4 }]);
  });
```

In `tests/orbitInvariant.test.ts`, add below the existing imports:

```ts
import { DESTINATIONS, escapeR } from "../src/data/destinations";
```

and append:

```ts
describe("destination orbit-lock invariants", () => {
  it("every destination's orbit sits inside its retention radius, and a jump lands inside its lock", () => {
    for (const d of DESTINATIONS) {
      expect(d.orbitR, d.id).toBeLessThan(d.retainR - 0.2);
      expect(d.lockR, d.id).toBeLessThan(d.orbitR);
      expect(d.zoneR, d.id).toBeLessThan(d.retainR); // zone must also be retained while locked
      expect(d.jumpR, d.id).toBeLessThan(d.lockR); // a jump docks on arrival
      expect(escapeR(d), d.id).toBeGreaterThan(d.retainR); // a break is not re-retained
    }
  });
});
```

In `tests/projects.test.ts`, replace line 2:

```ts
import { projects, planets, projectById, PLANET_ORBITS, RESERVED_ZONE_IDS } from "../src/constants";
```

with:

```ts
import { projects, planets, projectById, PLANET_ORBITS } from "../src/constants";
import { RESERVED_ZONE_IDS } from "../src/data/destinations";
```

In `tests/spaceStore.test.ts`, add to the imports:

```ts
import { DESTINATIONS } from "../src/data/destinations";
```

and inside `describe("requestJump", …)` add:

```ts
  it("accepts every destination in the table", () => {
    for (const d of DESTINATIONS) {
      useSpaceStore.getState().requestJump(d.id);
      expect(useSpaceStore.getState().jumpRequest?.id).toBe(d.id);
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/destinations.test.ts tests/navigation.test.ts tests/gamepad.test.ts tests/orbitInvariant.test.ts tests/projects.test.ts tests/spaceStore.test.ts`
Expected: FAIL. `destinations`, `orbitInvariant`, `projects` and `spaceStore` fail to import (`Failed to resolve import "../src/data/destinations"`). navigation fails with `expected 'contact' to be 'career'`. gamepad fails with `expected [] to deeply equal [ { kind: 'jump', index: 4 } ]`.

- [ ] **Step 3: Create the destination table**

Create `src/data/destinations.ts`:

```ts
import {
  PORTAL_POS, PORTAL_ZONE_R, PORTAL_LOCK_R, PORTAL_RETAIN_R, PORTAL_ORBIT_R, planets, projectById,
} from "../constants";

/**
 * Places you can jump to and dock at that are not project planets
 * (docs/superpowers/specs/2026-10-15-career-landmarks-design.md §2). Every
 * consumer that used to special-case "contact" reads this table instead:
 * zone detection and lock (SpacePlanets), lock geometry and jumps
 * (Spaceship), jump validation and the dock badge (spaceStore), the radar,
 * the waypoint, the HUD sector list, the jump keys and scannables. A new
 * landmark is one row. Table order is key order, after the planets.
 */
export type DestinationId = "contact" | "career";

export interface Destination {
  id: DestinationId;
  /** HUD and waypoint label, e.g. "CONTACT PORTAL". */
  label: string;
  /** Jump-list label on the spawn card, e.g. "Contact". */
  jumpLabel: string;
  /** Scanner label, HUD sector-list name and HUD target, e.g. "PORTAL_SUN". */
  scanLabel: string;
  pos: readonly [number, number, number];
  color: string;
  /** Proximity zone: the "fly closer" tip and the HUD target. */
  zoneR: number;
  /** Orbit lock engages inside this radius. */
  lockR: number;
  /** Once locked, the lock holds until the ship leaves this radius. */
  retainR: number;
  /** The docked ship's orbit radius. Must sit inside retainR (tests/orbitInvariant.test.ts). */
  orbitR: number;
  /** A jump parks the ship this far out: inside lockR so it docks on arrival, outside the model. */
  jumpR: number;
}

export const DESTINATIONS: readonly Destination[] = [
  {
    id: "contact", label: "CONTACT PORTAL", jumpLabel: "Contact", scanLabel: "PORTAL_SUN", pos: PORTAL_POS, color: "#ec4899",
    zoneR: PORTAL_ZONE_R, lockR: PORTAL_LOCK_R, retainR: PORTAL_RETAIN_R, orbitR: PORTAL_ORBIT_R, jumpR: PORTAL_LOCK_R * 0.8,
  },
];

/**
 * Zone ids the engine reserves. A project may not claim one: `activeZone` is
 * the project id for planets, so a project named "contact" would make flying
 * to the portal open a project dossier instead (tests/projects.test.ts).
 */
export const RESERVED_ZONE_IDS: readonly DestinationId[] = DESTINATIONS.map((d) => d.id);

const byId = new Map<string, Destination>(DESTINATIONS.map((d) => [d.id, d]));

/** The destination with this zone id; undefined for planets, null and unknowns. */
export function destinationById(id: string | null | undefined): Destination | undefined {
  return id ? byId.get(id) : undefined;
}

/** Spaceship's ESCAPE_MARGIN (1.15) × 1.5, the push the portal always used. */
const ESCAPE_FACTOR = 1.15 * 1.5;

/** Breaking orbit at a destination puts the ship this far out: past its zone and its retain radius. */
export function escapeR(d: Destination): number {
  return d.zoneR * ESCAPE_FACTOR;
}

export interface JumpTarget { id: string; label: string; color: string }

/** Number keys, the spawn card and the d-pad, in order: each planet's project, then every destination. */
export const JUMP_TARGETS: readonly JumpTarget[] = [
  ...planets.map((p) => ({ id: p.name, label: projectById(p.name)?.title ?? p.name, color: p.color })),
  ...DESTINATIONS.map((d) => ({ id: d.id, label: d.jumpLabel, color: d.color })),
];

/**
 * Where the waypoint points once every planet dossier is read: the first
 * destination (table order) whose logbook badge is not recorded yet, and the
 * last one (the contact portal) once all are, as it always did.
 */
export function afterPlanets(badges: readonly { id: string }[]): DestinationId {
  const open = DESTINATIONS.find((d) => !badges.some((b) => b.id === d.id));
  return (open ?? DESTINATIONS[DESTINATIONS.length - 1]).id;
}
```

- [ ] **Step 4: Remove `RESERVED_ZONE_IDS` from constants**

It moves to the table. Leaving it in `constants.ts` and deriving it from the table would create a circular import (`constants` → `destinations` → `constants`). In `src/constants.ts`, delete:

```ts
/**
 * Zone ids the engine reserves for non-project destinations. A project may not
 * claim one — `activeZone === "contact"` is the portal, and a project with that
 * id would make flying to the portal open a project dossier instead.
 */
export const RESERVED_ZONE_IDS = ["contact"] as const;

```

- [ ] **Step 5: Give `nextWaypoint` an explicit fallback**

In `src/utils/navigation.ts`, replace:

```ts
/**
 * The destination the HUD waypoint should point at: the nearest planet whose
 * dossier hasn't been opened, then the contact portal once all have.
 */
export function nextWaypoint(
  ship: Vec3,
  names: readonly string[],
  bodies: Record<string, Vec3>,
  visited: readonly string[],
): string {
  let best = "contact", bestD = Infinity;
```

with:

```ts
/**
 * The destination the HUD waypoint should point at: the nearest planet whose
 * dossier hasn't been opened, then `fallback` once all have. The caller passes
 * the next destination from the table (`afterPlanets`, src/data/destinations.ts).
 */
export function nextWaypoint(
  ship: Vec3,
  names: readonly string[],
  bodies: Record<string, Vec3>,
  visited: readonly string[],
  fallback: string,
): string {
  let best = fallback, bestD = Infinity;
```

- [ ] **Step 6: Map Menu to the fifth jump target**

In `src/utils/gamepad.ts`, replace line 8:

```ts
 *   buttons  0 A · 1 B · 2 X (logbook) · 3 Y · 4 LB · 5 RB · 6 LT · 7 RT · 12–15 d-pad up/down/left/right
```

with:

```ts
 *   buttons  0 A · 1 B · 2 X (logbook) · 3 Y · 4 LB · 5 RB · 6 LT · 7 RT · 9 Menu/Start · 12–15 d-pad up/down/left/right
```

Replace line 26:

```ts
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7;
```

with:

```ts
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RB = 5, LT = 6, RT = 7, MENU = 9;
```

Replace:

```ts
/** D-pad clockwise from up → jump targets 1–4, matching the number keys. */
const DPAD_JUMPS = [DPAD_UP, DPAD_RIGHT, DPAD_DOWN, DPAD_LEFT];
```

with:

```ts
/**
 * D-pad clockwise from up → jump targets 1–4, matching the number keys. Menu
 * → target 5: the contact portal once the career station is target 4.
 */
const DPAD_JUMPS = [DPAD_UP, DPAD_RIGHT, DPAD_DOWN, DPAD_LEFT];
const MENU_JUMP = 4;
```

Replace:

```ts
  DPAD_JUMPS.forEach((b, index) => { if (edge(b)) out.push({ kind: "jump", index }); });
  return out;
```

with:

```ts
  DPAD_JUMPS.forEach((b, index) => { if (edge(b)) out.push({ kind: "jump", index }); });
  if (edge(MENU)) out.push({ kind: "jump", index: MENU_JUMP });
  return out;
```

- [ ] **Step 7: Store: jump validation and the dock badge read the table**

In `src/store/spaceStore.ts`, after `import { planets } from "../constants";` add:

```ts
import { destinationById } from "../data/destinations";
```

Replace:

```ts
  /**
   * Pending jump to a planet id or "contact", consumed by Spaceship's frame
   * loop. `seq` makes a repeat request for the same target a new value.
   */
```

with:

```ts
  /**
   * Pending jump to a planet id or a destination id (src/data/destinations.ts),
   * consumed by Spaceship's frame loop. `seq` makes a repeat request for the
   * same target a new value.
   */
```

Replace:

```ts
      if (id !== "contact" && !PLANET_IDS.includes(id)) return;
```

with:

```ts
      if (!destinationById(id) && !PLANET_IDS.includes(id)) return;
```

Replace:

```ts
      // Logbook essential: docking at the contact portal.
      if (zone === "contact") get().recordBadge("contact");
```

with:

```ts
      // Logbook essential: docking at a destination records the badge named
      // after it (recordBadge ignores ids the logbook does not list).
      const dest = destinationById(zone);
      if (dest) get().recordBadge(dest.id);
```

- [ ] **Step 8: App: jump list from the table, modal picked by destination**

In `src/App.tsx`, replace:

```ts
import { projects, projectById, planets } from "./constants";
```

with:

```ts
import { projects, projectById } from "./constants";
import { JUMP_TARGETS, destinationById } from "./data/destinations";
```

Replace:

```ts
/** Jump destinations, in key order: each planet's project, then the portal. */
const JUMP_TARGETS = [
  ...planets.map((p) => ({ id: p.name, label: projectById(p.name)?.title ?? p.name, color: p.color })),
  { id: "contact", label: "Contact", color: "#ec4899" },
];
const JUMP_IDS = JUMP_TARGETS.map((t) => t.id);
```

with:

```ts
/** Jump targets in key order (src/data/destinations.ts): each planet's project, then the destination table. */
const JUMP_IDS = JUMP_TARGETS.map((t) => t.id);
```

Replace:

```ts
      // 1..n jump to each planet in order, n+1 to the contact portal.
```

with:

```ts
      // Number keys jump to JUMP_TARGETS in order: planets, then destinations.
```

Replace:

```ts
  // `activeZone` IS the project id, so this is a lookup rather than a mapping.
  // Returns undefined for the contact portal, which has no dossier.
  const planetProject = projectById(activeZone);
```

with:

```ts
  // `activeZone` IS the project id, so this is a lookup rather than a mapping.
  // Returns undefined for destinations, which have no project dossier.
  const planetProject = projectById(activeZone);
  // Each destination opens its own modal (the contact form, the career dossier).
  const zoneDestination = destinationById(activeZone)?.id;
```

Replace:

```tsx
            {isOrbitLocked && activeZone === "contact" && (
```

with:

```tsx
            {isOrbitLocked && zoneDestination === "contact" && (
```

- [ ] **Step 9: Spaceship: lock geometry and jumps from the table**

In `src/components/canvas/Spaceship.tsx`, replace line 5:

```ts
import { COSMIC_BOUNDS, PORTAL_POS, SHIP_MAX_SPEED, SHIP_WARP_SPEED, planets, ORBIT_RADIUS_FACTOR, PORTAL_ORBIT_R, ZONE_FACTOR, PORTAL_ZONE_R, PORTAL_LOCK_R } from "../../constants";
```

with:

```ts
import { COSMIC_BOUNDS, SHIP_MAX_SPEED, SHIP_WARP_SPEED, planets, ORBIT_RADIUS_FACTOR, ZONE_FACTOR } from "../../constants";
import { destinationById, escapeR } from "../../data/destinations";
```

Replace:

```ts
/**
 * Jump standoffs: inside each lock radius (planet 1.3x size, portal 1.5) and
 * outside the body, so the lock engages on the frame the ship arrives.
 */
const JUMP_PLANET_FACTOR = 1.2;
const JUMP_PORTAL_R = PORTAL_LOCK_R * 0.8;
```

with:

```ts
/**
 * Jump standoff for planets: inside the lock radius (1.3x size) and outside
 * the body, so the lock engages on the frame the ship arrives. Destinations
 * carry their own standoff (`jumpR`, src/data/destinations.ts).
 */
const JUMP_PLANET_FACTOR = 1.2;
```

Replace:

```ts
      const planet = activeZone ? planets.find((p) => p.name === activeZone) : undefined;
      if (planet) {
        const b = bodies[planet.name];
        lockedCenter.current.set(b.x, b.y, b.z);
        targetLockRadius.current = planet.size * ORBIT_RADIUS_FACTOR;
        dockMinRadius.current = planet.size + CAPTURE_SURFACE_MARGIN;
        escapeRadius.current = planet.size * ZONE_FACTOR * ESCAPE_MARGIN;
      } else if (activeZone === "contact") {
        lockedCenter.current.set(...PORTAL_POS);
        dockMinRadius.current = 0;
        targetLockRadius.current = PORTAL_ORBIT_R;
        escapeRadius.current = PORTAL_ZONE_R * ESCAPE_MARGIN * 1.5;
      } else {
```

with:

```ts
      const planet = activeZone ? planets.find((p) => p.name === activeZone) : undefined;
      const dest = destinationById(activeZone);
      if (planet) {
        const b = bodies[planet.name];
        lockedCenter.current.set(b.x, b.y, b.z);
        targetLockRadius.current = planet.size * ORBIT_RADIUS_FACTOR;
        dockMinRadius.current = planet.size + CAPTURE_SURFACE_MARGIN;
        escapeRadius.current = planet.size * ZONE_FACTOR * ESCAPE_MARGIN;
      } else if (dest) {
        lockedCenter.current.set(dest.pos[0], dest.pos[1], dest.pos[2]);
        dockMinRadius.current = 0;
        targetLockRadius.current = dest.orbitR;
        escapeRadius.current = escapeR(dest);
      } else {
```

Replace the jump block:

```ts
    if (pendingJump.current) {
      const id = pendingJump.current;
      pendingJump.current = null;
      const planet = planets.find((p) => p.name === id);
      const target = planet ? bodies[planet.name] : { x: PORTAL_POS[0], y: PORTAL_POS[1], z: PORTAL_POS[2] };
      const standoff = planet ? planet.size * JUMP_PLANET_FACTOR : JUMP_PORTAL_R;
      const j = jumpPoint(pos.current, target, standoff);
      pos.current.set(j.x, j.y, j.z);
      vel.current.set(0, 0, 0);
      zeroGravity();
      angle.current = j.yaw;
      pitch.current = 0;
      turnVelocity.current = 0;
      pitchVel.current = 0;
      hasFlown.current = true;
      flight.hasFlown = true;
      snapCamera.current = true;
      useSpaceStore.setState({ isOrbitCooldown: false });
      store.triggerTeleportFlash();
    }
```

with:

```ts
    if (pendingJump.current) {
      const id = pendingJump.current;
      pendingJump.current = null;
      const planet = planets.find((p) => p.name === id);
      const dest = planet ? undefined : destinationById(id);
      const target = planet ? bodies[planet.name] : dest && { x: dest.pos[0], y: dest.pos[1], z: dest.pos[2] };
      const standoff = planet ? planet.size * JUMP_PLANET_FACTOR : dest?.jumpR;
      if (target && standoff !== undefined) {
        const j = jumpPoint(pos.current, target, standoff);
        pos.current.set(j.x, j.y, j.z);
        vel.current.set(0, 0, 0);
        zeroGravity();
        angle.current = j.yaw;
        pitch.current = 0;
        turnVelocity.current = 0;
        pitchVel.current = 0;
        hasFlown.current = true;
        flight.hasFlown = true;
        snapCamera.current = true;
        useSpaceStore.setState({ isOrbitCooldown: false });
        store.triggerTeleportFlash();
      }
    }
```

- [ ] **Step 10: SpacePlanets: zone, lock and scannables from the table**

In `src/components/canvas/SpacePlanets.tsx`, replace:

```ts
import {
  COSMIC_BOUNDS, PORTAL_POS, planets,
  ZONE_FACTOR, LOCK_RETAIN_FACTOR,
  PORTAL_ZONE_R, PORTAL_LOCK_R, PORTAL_RETAIN_R,
} from "../../constants";
```

with:

```ts
import {
  COSMIC_BOUNDS, PORTAL_POS, planets,
  ZONE_FACTOR, LOCK_RETAIN_FACTOR,
} from "../../constants";
import { DESTINATIONS } from "../../data/destinations";
```

Replace:

```ts
  // Portal is static; planets are re-registered every frame (they orbit).
  useEffect(() => {
    setScannable("contact", PORTAL_POS[0], PORTAL_POS[1], PORTAL_POS[2], "PORTAL_SUN");
  }, []);
```

with:

```ts
  // Destinations are static; planets are re-registered every frame (they orbit).
  useEffect(() => {
    for (const d of DESTINATIONS) setScannable(d.id, d.pos[0], d.pos[1], d.pos[2], d.scanLabel);
  }, []);
```

Replace:

```ts
    const portalDist = toroidalDistance3(flight.x, flight.z, flight.y, PORTAL_POS[0], PORTAL_POS[2], PORTAL_POS[1], COSMIC_BOUNDS);
    if (lockedNow && zoneNow === "contact") {
      if (portalDist < PORTAL_RETAIN_R) {
        activeZone = "contact";
        lockActive = true;
      }
    } else if (portalDist < PORTAL_ZONE_R) {
      activeZone = "contact";
      if (portalDist < PORTAL_LOCK_R && !isOrbitCooldown) lockActive = true;
    }
```

with:

```ts
    // Destinations (src/data/destinations.ts): fixed points with their own
    // radii, checked after the planets exactly as the portal always was.
    for (const d of DESTINATIONS) {
      const dist = toroidalDistance3(flight.x, flight.z, flight.y, d.pos[0], d.pos[2], d.pos[1], COSMIC_BOUNDS);
      if (lockedNow && zoneNow === d.id) {
        if (dist < d.retainR) {
          activeZone = d.id;
          lockActive = true;
        }
      } else if (dist < d.zoneR) {
        activeZone = d.id;
        if (dist < d.lockR && !isOrbitCooldown) lockActive = true;
      }
    }
```

`PORTAL_POS` stays imported: the portal's own visuals still render at it.

- [ ] **Step 11: HUD sector list from the table**

In `src/components/layout/HUDOverlay.tsx`, replace line 3:

```ts
import { COSMIC_BOUNDS, PORTAL_POS, SHIP_MAX_SPEED, planets } from "../../constants";
```

with:

```ts
import { COSMIC_BOUNDS, SHIP_MAX_SPEED, planets } from "../../constants";
import { DESTINATIONS } from "../../data/destinations";
```

Replace:

```ts
const ZONE_COLORS: Record<string, string> = {
  ruangrapi: "text-primary", portfolio: "text-secondary", fuxx: "text-accent", contact: "text-pink-500",
};
```

with:

```ts
/** Planet rows only; destination rows take their colour from the table. */
const ZONE_COLORS: Record<string, string> = {
  ruangrapi: "text-primary", portfolio: "text-secondary", fuxx: "text-accent",
};
```

Replace:

```tsx
        {/* Rows double as jump buttons (same as keys 1..n+1). */}
```

with:

```tsx
        {/* Rows double as jump buttons (same as the number keys). */}
```

Replace:

```tsx
        <button onClick={() => requestJump("contact")}
          title={`Jump to the contact portal [${planets.length + 1}]`}
          className={`pointer-events-auto cursor-pointer flex items-center gap-1.5 transition-colors hover:text-white ${activeZone === "contact" ? ZONE_COLORS.contact : "text-white/40"}`}>
          <span className="text-white/30">[{planets.length + 1}]</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#ec4899]" />
          <span>PORTAL_SUN ([{PORTAL_POS.join(", ")}])</span>
          <span className="w-3" />
        </button>
```

with:

```tsx
        {DESTINATIONS.map((d, i) => (
          <button key={d.id} onClick={() => requestJump(d.id)}
            title={`Jump to the ${d.label.toLowerCase()} [${planets.length + i + 1}]`}
            className="pointer-events-auto cursor-pointer flex items-center gap-1.5 transition-colors hover:text-white text-white/40"
            style={activeZone === d.id ? { color: d.color } : undefined}>
            <span className="text-white/30">[{planets.length + i + 1}]</span>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.color }} />
            <span>{d.scanLabel} ([{d.pos.join(", ")}])</span>
            <span className="w-3" />
          </button>
        ))}
```

(`#ec4899` is Tailwind's `pink-500`, so the active contact row renders the same colour as before.)

- [ ] **Step 12: Radar blips from the table**

In `src/components/layout/RadarMap.tsx`, replace line 2:

```ts
import { COSMIC_BOUNDS, PORTAL_POS, planets } from "../../constants";
```

with:

```ts
import { COSMIC_BOUNDS, planets } from "../../constants";
import { DESTINATIONS } from "../../data/destinations";
```

Replace line 10:

```ts
const PLANET_COLORS = planets.map((p) => ({ name: p.name, color: p.color }));
```

with:

```ts
const PLANET_COLORS = planets.map((p) => ({ name: p.name, color: p.color }));
/** Destinations are fixed: one blip each, in the table's colour. */
const DESTINATION_BLIPS = DESTINATIONS.map((d) => ({ name: d.id, x: d.pos[0], y: d.pos[1], z: d.pos[2], color: d.color }));
```

Replace line 61:

```ts
        { name: "contact", x: PORTAL_POS[0], y: PORTAL_POS[1], z: PORTAL_POS[2], color: "#ec4899" },
```

with:

```ts
        ...DESTINATION_BLIPS,
```

- [ ] **Step 13: Waypoint from the table**

Replace the whole of `src/components/canvas/WaypointDriver.tsx` with:

```tsx
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { planets, projectById } from "../../constants";
import { DESTINATIONS, afterPlanets, destinationById } from "../../data/destinations";
import { bodies, flight, useSpaceStore } from "../../store/spaceStore";
import { nextWaypoint } from "../../utils/navigation";
import { waypointState } from "../../utils/waypointState";
import { RACE_GATES } from "../../data/ringCourse";


const PLANET_NAMES = planets.map((p) => p.name);
/** Destinations are fixed points; built once so the frame loop allocates nothing. */
const DESTINATION_POINTS = new Map<string, { x: number; y: number; z: number }>(
  DESTINATIONS.map((d) => [d.id, { x: d.pos[0], y: d.pos[1], z: d.pos[2] }]),
);
const MARGIN = 0.88; // NDC fraction treated as "on screen"
/**
 * Off-screen targets get an arrow on an ellipse around the screen centre (in
 * NDC), not on the screen edge: the edges are lined with HUD panels
 * (telemetry, radar, sector list, controls strip), and an edge arrow kept
 * landing on one of them. The ellipse clears the ship below centre.
 */
const RING_X = 0.6;
const RING_Y = 0.5;
const v = new THREE.Vector3();

/** Headless: projects the next unread dossier (then the next destination) to the screen — or, mid-lap, the next time-trial ring. */
export default function WaypointDriver() {
  useFrame(({ camera, size }) => {
    const s = useSpaceStore.getState();
    // Mid-lap, the waypoint belongs to the time trial: point at the next ring.
    const race = s.race.phase === "running" ? s.race : null;
    const id = race ? "" : nextWaypoint(flight, PLANET_NAMES, bodies, s.visitedDossiers, afterPlanets(s.badges));
    // Nothing to point at while docked there or already inside its pull.
    if (s.isOrbitLocked || (!race && s.activeZone === id)) { waypointState.active = false; return; }
    const t = race ? RACE_GATES[race.next].c : DESTINATION_POINTS.get(id) ?? bodies[id];
    if (!t) { waypointState.active = false; return; }

    v.set(t.x, t.y, t.z).project(camera);
    const behind = v.z > 1;
    // Behind the camera, projection mirrors through the centre; flip it so the
    // edge arrow points the way the pilot actually has to turn.
    let nx = behind ? -v.x : v.x;
    let ny = behind ? -v.y : v.y;
    const onScreen = !behind && Math.abs(nx) < MARGIN && Math.abs(ny) < MARGIN;
    if (!onScreen) {
      // Direction measured in pixels, so the arrow points the true way on a
      // wide screen, then placed on the ring.
      const a = Math.atan2(ny * size.height, nx * size.width);
      nx = Math.cos(a) * RING_X;
      ny = Math.sin(a) * RING_Y;
    }
    waypointState.active = true;
    waypointState.onScreen = onScreen;
    waypointState.x = (nx * 0.5 + 0.5) * size.width;
    waypointState.y = (-ny * 0.5 + 0.5) * size.height;
    waypointState.angle = Math.atan2(-ny, nx);
    waypointState.distance = Math.hypot(t.x - flight.x, t.y - flight.y, t.z - flight.z);
    if (race) {
      waypointState.label = race.next === 0 ? "FINISH" : `RING ${race.next}/${RACE_GATES.length - 1}`;
      waypointState.color = "#ffb020";
      return;
    }
    const dest = destinationById(id);
    waypointState.label = dest ? dest.label : (projectById(id)?.title ?? id).toUpperCase();
    waypointState.color = dest ? dest.color : (planets.find((p) => p.name === id)?.color ?? "#00ff87");
  });
  return null;
}
```

- [ ] **Step 14: Run the tests, typecheck and lint**

Run: `npx vitest run tests/destinations.test.ts tests/navigation.test.ts tests/gamepad.test.ts tests/orbitInvariant.test.ts tests/projects.test.ts tests/spaceStore.test.ts`
Expected: PASS.

Run: `npm test && npx tsc -b && npm run lint`
Expected: all pass (no unused-import errors; `noUnusedLocals` is on).

Run: `grep -rn '"contact"' src`
Expected: exactly these deliberate keeps:
- `src/App.tsx`: `zoneDestination === "contact"` (picks the contact-form modal)
- `src/data/destinations.ts`: the `DestinationId` union and `id: "contact"` (the row itself)
- `src/utils/logbook.ts`: the logbook entry and the badge line (copy and data)
- `src/components/sections/Contact.tsx`: two résumé-section `#contact` anchors (unrelated)

- [ ] **Step 15: Commit**

```bash
git add src/data/destinations.ts src/constants.ts src/utils/navigation.ts src/utils/gamepad.ts src/store/spaceStore.ts src/App.tsx src/components/canvas/Spaceship.tsx src/components/canvas/SpacePlanets.tsx src/components/layout/HUDOverlay.tsx src/components/layout/RadarMap.tsx src/components/canvas/WaypointDriver.tsx tests/destinations.test.ts tests/navigation.test.ts tests/gamepad.test.ts tests/orbitInvariant.test.ts tests/projects.test.ts tests/spaceStore.test.ts
git commit -m "refactor(nav): destination table replaces the hard-coded contact checks

Contact keeps its position, radii, labels and colour; every consumer now
reads src/data/destinations.ts, so a new landmark is one row. Menu (pad
button 9) maps to jump target 5.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Career trail data and placement clearance

**Chosen placement (computed against the real orbit, gate, collider and shard data, verified with the test below):**

- Station `STATION_POS = [0, -108, 156]`. The spec's target `(0, -95, 150)` fails: the portfolio planet's orbit passes 35.7 units from it, and the test needs more than 2.2 × 16 (moon reach) + 8.5 (station zone) + 4 = 47.7. The nearest passing points on a 2-unit grid lie 12.4–14.3 units from the target. This one keeps x = 0, the portal's x, and is 14.3 from the target. Closest approaches: ruangrapi 83.7, portfolio 49.2, fuxx 127.7. Sun 180 (surface), portal 367, nearest ring gate 165, nearest asteroid surface 115, nearest shard 149, outside both belts.
- Trail: the circular arc from `TRAIL_START [-10, -32, 18]` through `TRAIL_BEND [10, -98, 65]` to `TRAIL_END [10, -126, 144]` (radius 130.62, span 1.3036 rad). The five buoys sit at equal angles on it: `(-10, -32, 18)`, `(2.17, -68.40, 35.97)`, `(10.02, -98.11, 65.15)`, `(12.73, -118.01, 102.47)`, `(10, -126, 144)`. Consecutive buoys are 42.38 apart.
- First buoy: 33.53 from the spawn point `(0, 0, 18)`. Last buoy: 23.83 from the station. The trail dives first (below the ruangrapi and portfolio orbit tori) and then runs out to the station.
- Smallest buoy margins over the test thresholds (the threshold is the keep-out plus a 4-unit margin): planets 19.7 (threshold 45.2), ring gates 26.5 (threshold 12), shards 23.1, sun 18.6, belt slab 38.3. All five buoys pass. The station clears its planet threshold (47.7) by 1.5 units, at portfolio's closest pass.

**Files:**
- Create: `src/data/careerTrail.ts`, `tests/careerTrail.test.ts`

**Interfaces:**
- Consumes: `career`, `CareerEntry` from `src/data/career.ts`.
- Produces (`src/data/careerTrail.ts`):
  - `type Vec3 = readonly [number, number, number]`
  - `STATION_POS: Vec3`; `STATION_RADII: { zoneR: 8.5; lockR: 5.8; retainR: 13; orbitR: 10; jumpR: 5.4 }` (as const)
  - `CAREER_AMBER = "#ffb547"`; `BUOY_CARD_R = 6`
  - `TRAIL_START`, `TRAIL_BEND`, `TRAIL_END: Vec3`
  - `interface Arc { centre: Vec3; radius: number; u: Vec3; v: Vec3; n: Vec3; span: number }`, with u, v, n orthonormal and right-handed; the arc runs from `centre + R·u` at angle 0 to angle `span` toward v
  - `arcThrough(a: Vec3, b: Vec3, c: Vec3): Arc` (throws on collinear points); `arcPoint(arc: Arc, t: number): Vec3` with t in [0, 1]
  - `startKey(e: CareerEntry): number` (year × 12 + month; throws on an unreadable date)
  - `TRAIL_ARC: Arc`; `interface Buoy { id: string; label: string; pos: Vec3; entry: CareerEntry }`; `BUOYS: readonly Buoy[]` (oldest first, ids `career_0`…`career_4`, labels `CAREER_<start year>`); `BUOY_POSITIONS: readonly Vec3[]`

- [ ] **Step 1: Write the failing test**

Create `tests/careerTrail.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planets, PORTAL_POS, PORTAL_ZONE_R } from "../src/constants";
import { orbitPosition } from "../src/utils/orbits";
import { career } from "../src/data/career";
import { SHARDS } from "../src/data/shards";
import { ASTEROID_COLLIDERS, SUN_COLLIDER } from "../src/data/asteroids";
import { RING_GATES, RING_RADIUS } from "../src/data/ringCourse";
import {
  STATION_POS, STATION_RADII, BUOYS, BUOY_CARD_R, TRAIL_ARC, arcThrough, arcPoint, startKey, type Vec3,
} from "../src/data/careerTrail";

/** Spawn pad (Spaceship.tsx SPAWN, beacons.ts SPAWN). */
const SPAWN: Vec3 = [0, 0, 18];
const SAMPLES = 2000;
/**
 * A planet's reach: its farthest moon is fuxx's ice moon, orbiting at 2.1 ×
 * size with radius 0.0625 × size (SpacePlanets.tsx), so 2.2 × size covers
 * the planet, its proximity zone (1.8 ×) and every moon.
 */
const MOON_REACH_FACTOR = 2.2;
const MARGIN = 4;

const d3 = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Closest approach of a planet's centre, over a full orbit, to a fixed point (as planetClearance.test.ts). */
function closestApproach(planet: (typeof planets)[number], p: readonly number[]): number {
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
function beltClearance(p: readonly number[], tilt: number, rMin: number, rMax: number, halfThickness: number): number {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const ly = c * p[1] + s * p[2];
  const lz = -s * p[1] + c * p[2];
  const r = Math.hypot(p[0], lz);
  return r < rMin - MARGIN || r > rMax + MARGIN ? Infinity : Math.abs(ly) - halfThickness;
}

/** Each landmark with its keep-out: the station's proximity zone, a buoy's card radius. */
const PLACES: { name: string; pos: Vec3; keepOut: number }[] = [
  { name: "station", pos: STATION_POS, keepOut: STATION_RADII.zoneR },
  ...BUOYS.map((b) => ({ name: b.id, pos: b.pos, keepOut: BUOY_CARD_R })),
];

describe("arcThrough", () => {
  it("finds the circle through three points and the span from the first to the last", () => {
    const arc = arcThrough([1, 0, 0], [0, 1, 0], [-1, 0, 0]);
    expect(arc.radius).toBeCloseTo(1);
    arc.centre.forEach((v) => expect(v).toBeCloseTo(0));
    expect(arc.span).toBeCloseTo(Math.PI);
    const mid = arcPoint(arc, 0.5);
    expect(mid[0]).toBeCloseTo(0);
    expect(mid[1]).toBeCloseTo(1);
  });
  it("refuses three points on one line", () => {
    expect(() => arcThrough([0, 0, 0], [1, 1, 1], [2, 2, 2])).toThrow(/collinear/);
  });
});

describe("career trail order", () => {
  it("has one buoy per career entry, oldest first", () => {
    expect(BUOYS).toHaveLength(career.length);
    expect(new Set(BUOYS.map((b) => b.entry))).toEqual(new Set(career));
    for (let i = 1; i < BUOYS.length; i++) expect(startKey(BUOYS[i].entry)).toBeGreaterThan(startKey(BUOYS[i - 1].entry));
    expect(BUOYS[0].entry.company).toBe("SoftwareSeni");
    expect(BUOYS[BUOYS.length - 1].entry.company).toBe("Hubexo");
  });
  it("names each buoy career_<n> and labels it with its start year", () => {
    BUOYS.forEach((b, i) => {
      expect(b.id).toBe(`career_${i}`);
      expect(b.label).toBe(`CAREER_${b.entry.start.slice(-4)}`);
    });
  });
  it("rejects a start date it cannot read", () => {
    expect(() => startKey({ ...career[0], start: "Sometime 2015" })).toThrow(/unreadable/);
  });
});

describe("career trail shape", () => {
  it("puts every buoy on the guide arc, evenly spaced and at least 20 apart", () => {
    for (const b of BUOYS) expect(d3(b.pos, TRAIL_ARC.centre)).toBeCloseTo(TRAIL_ARC.radius, 6);
    const gaps = BUOYS.slice(1).map((b, i) => d3(b.pos, BUOYS[i].pos));
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(20);
      expect(g).toBeCloseTo(gaps[0], 6);
    }
  });
  it("starts 30-45 units from the spawn point and ends 15-25 from the station", () => {
    const first = d3(BUOYS[0].pos, SPAWN);
    const last = d3(BUOYS[BUOYS.length - 1].pos, STATION_POS);
    expect(first).toBeGreaterThanOrEqual(30);
    expect(first).toBeLessThanOrEqual(45);
    expect(last).toBeGreaterThanOrEqual(15);
    expect(last).toBeLessThanOrEqual(25);
  });
  it("puts the station below the orbital plane, as the portal is above it", () => {
    expect(STATION_POS[1]).toBeLessThan(-80);
  });
});

describe("career landmark clearance", () => {
  it("never shares space with a planet's swept orbit, its zone or its moons", () => {
    for (const planet of planets) {
      for (const p of PLACES) {
        expect(closestApproach(planet, p.pos), `${planet.name} vs ${p.name}`)
          .toBeGreaterThan(planet.size * MOON_REACH_FACTOR + p.keepOut + MARGIN);
      }
    }
  });
  it("keeps clear of the sun, the contact portal and the scenery asteroids", () => {
    for (const p of PLACES) {
      expect(d3(p.pos, [SUN_COLLIDER.x, SUN_COLLIDER.y, SUN_COLLIDER.z]), `sun vs ${p.name}`)
        .toBeGreaterThan(SUN_COLLIDER.r + p.keepOut + MARGIN);
      expect(d3(p.pos, PORTAL_POS), `portal vs ${p.name}`).toBeGreaterThan(PORTAL_ZONE_R + p.keepOut + 40);
      for (const a of ASTEROID_COLLIDERS) {
        expect(d3(p.pos, [a.x, a.y, a.z]), `${a.id} vs ${p.name}`).toBeGreaterThan(a.r + p.keepOut + MARGIN);
      }
    }
  });
  it("keeps clear of every time-trial ring and every data shard", () => {
    for (const p of PLACES) {
      RING_GATES.forEach((g, i) => {
        expect(d3(p.pos, g), `gate ${i} vs ${p.name}`).toBeGreaterThan(RING_RADIUS + p.keepOut);
      });
      SHARDS.forEach((s, i) => {
        expect(d3(p.pos, s.pos), `shard ${i} vs ${p.name}`).toBeGreaterThan(p.keepOut + MARGIN);
      });
    }
  });
  it("is not buried in the asteroid belt or the polar halo", () => {
    for (const p of PLACES) {
      expect(beltClearance(p.pos, 0.436, 40, 70, 2.5), `belt vs ${p.name}`).toBeGreaterThan(p.keepOut);
      expect(beltClearance(p.pos, 1.31, 80, 95, 4.5), `halo vs ${p.name}`).toBeGreaterThan(p.keepOut);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/careerTrail.test.ts`
Expected: FAIL with `Failed to resolve import "../src/data/careerTrail"`.

- [ ] **Step 3: Create the trail data**

Create `src/data/careerTrail.ts`:

```ts
import { career, type CareerEntry } from "./career";

/**
 * Career landmarks (docs/superpowers/specs/2026-10-15-career-landmarks-design.md §1):
 * the station you dock at for the Career dossier, and five buoys, one per job,
 * oldest first, on a trail from the spawn area down to it. The scene and
 * tests/careerTrail.test.ts read these same numbers.
 */
export type Vec3 = readonly [number, number, number];

/**
 * Below the orbital plane, mirroring the portal above it. The spec's target
 * was (0, -95, 150), but the portfolio planet's orbit (with its moons) passes
 * 35.7 units from that point. This is the nearest point on x = 0 that clears
 * it (tests/careerTrail.test.ts).
 */
export const STATION_POS: Vec3 = [0, -108, 156];

/**
 * The portal's lock radii scaled for a model of radius ~5 (about 4x the
 * portal). jumpR parks a jump just outside the model (radius ≤ 5.3,
 * tests/assetContracts.test.ts) and inside lockR, so it docks on arrival.
 */
export const STATION_RADII = { zoneR: 8.5, lockR: 5.8, retainR: 13, orbitR: 10, jumpR: 5.4 } as const;

/** The career landmarks' accent colour: station lights, buoy glow, radar, dossier. */
export const CAREER_AMBER = "#ffb547";

/** Flying within this distance of a buoy shows its HUD card. */
export const BUOY_CARD_R = 6;

/**
 * The trail is the circular arc from TRAIL_START through TRAIL_BEND to
 * TRAIL_END. It dives first, under the ruangrapi and portfolio orbits, then
 * runs out to the station. The buoys sit at equal angles along it.
 */
export const TRAIL_START: Vec3 = [-10, -32, 18];
export const TRAIL_BEND: Vec3 = [10, -98, 65];
export const TRAIL_END: Vec3 = [10, -126, 144];

/** A circular arc: angle 0 at centre + radius·u, turning toward v, for `span` radians. n = u × v. */
export interface Arc { centre: Vec3; radius: number; u: Vec3; v: Vec3; n: Vec3; span: number }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** The circle through a, b and c, as the arc that starts at a and ends at c (passing b). */
export function arcThrough(a: Vec3, b: Vec3, c: Vec3): Arc {
  const ab = sub(b, a), ac = sub(c, a);
  const n = cross(ab, ac);
  const nn = dot(n, n);
  if (nn < 1e-9) throw new Error("arcThrough: the three points are collinear");
  const w = scale(sub(scale(cross(n, ab), dot(ac, ac)), scale(cross(n, ac), dot(ab, ab))), 1 / (2 * nn));
  const centre: Vec3 = [a[0] + w[0], a[1] + w[1], a[2] + w[2]];
  const u = unit(sub(a, centre));
  const nu = unit(n);
  const v = cross(nu, u);
  const rc = sub(c, centre);
  let span = Math.atan2(dot(rc, v), dot(rc, u));
  if (span <= 0) span += Math.PI * 2;
  return { centre, radius: Math.hypot(w[0], w[1], w[2]), u, v, n: nu, span };
}

/** The point a fraction t (0..1) of the way along the arc. */
export function arcPoint(arc: Arc, t: number): Vec3 {
  const th = arc.span * t;
  const c = Math.cos(th) * arc.radius, s = Math.sin(th) * arc.radius;
  return [
    arc.centre[0] + arc.u[0] * c + arc.v[0] * s,
    arc.centre[1] + arc.u[1] * c + arc.v[1] * s,
    arc.centre[2] + arc.u[2] * c + arc.v[2] * s,
  ];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Sort key for a "Mon YYYY" start date. */
export function startKey(e: CareerEntry): number {
  const [mon, year] = e.start.split(" ");
  const m = MONTHS.indexOf(mon);
  if (m < 0 || !/^\d{4}$/.test(year ?? "")) throw new Error(`careerTrail: unreadable start date "${e.start}"`);
  return Number(year) * 12 + m;
}

export const TRAIL_ARC: Arc = arcThrough(TRAIL_START, TRAIL_BEND, TRAIL_END);

export interface Buoy { id: string; label: string; pos: Vec3; entry: CareerEntry }

/** One buoy per job, oldest first, at equal steps along the trail arc. */
export const BUOYS: readonly Buoy[] = [...career]
  .sort((a, b) => startKey(a) - startKey(b))
  .map((entry, i, all) => ({
    id: `career_${i}`,
    label: `CAREER_${entry.start.slice(-4)}`,
    pos: arcPoint(TRAIL_ARC, all.length > 1 ? i / (all.length - 1) : 0),
    entry,
  }));

export const BUOY_POSITIONS: readonly Vec3[] = BUOYS.map((b) => b.pos);
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/careerTrail.test.ts`
Expected: PASS (12 tests).

Run: `npx tsc -b && npm run lint`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/data/careerTrail.ts tests/careerTrail.test.ts
git commit -m "feat(career): station and buoy-trail placement, clearance-tested

Station at (0,-108,156), the nearest point to the spec's target that clears
the portfolio orbit and its moons; five buoys oldest-first on one circular
arc, 42 units apart.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Station and buoy models (Blender generators, contracts, provenance)

**Files:**
- Create: `scripts/blender/gen_career_station.py`, `scripts/blender/gen_buoy.py`
- Modify: `tests/assetContracts.test.ts` (header comment, imports, helpers after `baseColorFactor`, two new describe blocks before `describe("public/models"`), `tests/assetProvenance.test.ts` (GENERATORS), `scripts/optimize-assets.mjs` (model list), `scripts/blender/generate.sh`
- Output: `assets-src/career_station.glb`, `assets-src/buoy.glb`, `public/models/career_station.glb`, `public/models/buoy.glb`
- Modify (assets-src repo): `assets-src/MANIFEST.md`

**Interfaces:**
- Consumes: `STATION_RADII.jumpR` (5.4) from Task 2.
- Produces: `career_station.glb`, with nodes `CareerStation` and `HabitatRing` (no rotation of its own, origin on the hub axis, `HullBaked` only) and materials `HullBaked` and `DockLight`. `buoy.glb`, with one node `Buoy`, one primitive, and the material `BuoyGlow` (same texture set as `Data_Shard`).

- [ ] **Step 1: Add the contracts (failing)**

In `tests/assetContracts.test.ts`, replace the header comment's first sentence:

```ts
 * Contracts between the generated models in public/models and the code that
 * loads them by name, size or position (Spaceship, CargoTraffic, FuelCrystals,
 * PlasmaAnomalies, SpacePlanets). Reads the shipped files, which are quantized
```

with:

```ts
 * Contracts between the generated models in public/models and the code that
 * loads them by name, size or position (Spaceship, CargoTraffic, FuelCrystals,
 * PlasmaAnomalies, SpacePlanets, CareerStation, CareerTrail). Reads the shipped files, which are quantized
```

Add after the existing imports:

```ts
import { STATION_RADII } from "../src/data/careerTrail";
```

Add after the `baseColorFactor` function:

```ts
/** What decides a material's shader program: which texture slots are filled, alpha mode and extensions. */
function textureSet(doc: Document, material: string) {
  const m = doc.getRoot().listMaterials().find((x) => x.getName() === material);
  if (!m) throw new Error(`no material ${material}`);
  return {
    base: !!m.getBaseColorTexture(), normal: !!m.getNormalTexture(), emissive: !!m.getEmissiveTexture(),
    metalRough: !!m.getMetallicRoughnessTexture(), occlusion: !!m.getOcclusionTexture(),
    alpha: m.getAlphaMode(), extensions: m.listExtensions().map((e) => e.extensionName).sort(),
  };
}

/** Every vertex attribute used anywhere in the file (COLOR_0 or TANGENT would add a shader program). */
const semantics = (doc: Document) => [...new Set(doc.getRoot().listMeshes()
  .flatMap((mesh) => mesh.listPrimitives().flatMap((p) => p.listSemantics())))].sort();

function node(doc: Document, name: string) {
  const n = doc.getRoot().listNodes().find((x) => x.getName() === name);
  if (!n) throw new Error(`no node ${name}`);
  return n;
}

/** Farthest vertex from the model's origin, in world space (dequantized). */
function maxRadius(doc: Document): number {
  let max = 0;
  const el: number[] = [];
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
        const z = m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14];
        max = Math.max(max, Math.hypot(x, y, z));
      }
    }
  }
  return max;
}
```

Add before `describe("public/models", …)`:

```ts
describe("career station (career_station.glb)", () => {
  it("has the two nodes CareerStation.tsx uses and two materials", async () => {
    const doc = await load("career_station");
    expect(nodeNames(doc)).toEqual(["CareerStation", "HabitatRing"]);
    expect(materialNames(doc)).toEqual(["DockLight", "HullBaked"]);
  });

  it("keeps the habitat ring a separate, unrotated node on the hub axis, in HullBaked only", async () => {
    // CareerStation.tsx spins the ring by writing rotation.y on this node.
    const doc = await load("career_station");
    const ring = node(doc, "HabitatRing");
    const [x, , z] = ring.getTranslation();
    expect(Math.abs(x)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(z)).toBeLessThanOrEqual(0.02);
    expect(ring.getRotation()).toEqual([0, 0, 0, 1]);
    expect(ring.getMesh()!.listPrimitives().map((p) => p.getMaterial()?.getName())).toEqual(["HullBaked"]);
    const b = getBounds(ring);
    expect(b.max[1] - b.min[1]).toBeLessThanOrEqual(1.0);
    expect(b.max[0]).toBeGreaterThan(3.8);
    expect(b.max[0]).toBeLessThan(4.3);
  });

  it("fits inside the career jump standoff, so a jump never lands in the hull", async () => {
    const doc = await load("career_station");
    expect(maxRadius(doc)).toBeLessThan(STATION_RADII.jumpR);
    const b = bounds(doc);
    expect(b.min[1]).toBeGreaterThanOrEqual(-3.0);
    expect(b.max[1]).toBeLessThanOrEqual(3.2);
  });

  it("reuses the freighter's material configurations, so it adds no shader program", async () => {
    const [station, cargo] = [await load("career_station"), await load("cargo_ship")];
    expect(textureSet(station, "HullBaked")).toEqual(textureSet(cargo, "HullBaked"));
    expect(textureSet(station, "DockLight")).toEqual(textureSet(cargo, "NavRed"));
    expect(semantics(station)).toEqual(["NORMAL", "POSITION", "TEXCOORD_0"]);
  });

  it("glows amber at the dock lights", async () => {
    const m = (await load("career_station")).getRoot().listMaterials().find((x) => x.getName() === "DockLight")!;
    const [r, g, b] = m.getEmissiveFactor();
    expect(r).toBeGreaterThan(0.9);
    expect(g).toBeGreaterThan(0.3);
    expect(g).toBeLessThan(0.6);
    expect(b).toBeLessThan(0.15);
  });

  it("stays inside its triangle and download budget", async () => {
    const t = triangles(await load("career_station"));
    expect(t).toBeGreaterThanOrEqual(2000);
    expect(t).toBeLessThanOrEqual(6000);
    expect(kb("career_station")).toBeLessThanOrEqual(600);
  });
});

describe("career buoy (buoy.glb)", () => {
  it("is one node, one mesh, one primitive, one BuoyGlow material", async () => {
    const root = (await load("buoy")).getRoot();
    expect(root.listNodes().map((n) => n.getName())).toEqual(["Buoy"]);
    expect(root.listMeshes()).toHaveLength(1);
    expect(root.listMeshes()[0].listPrimitives()).toHaveLength(1);
    expect(root.listMaterials().map((m) => m.getName())).toEqual(["BuoyGlow"]);
  });

  it("shares Data_Shard's texture set, so the instanced buoys add no shader program", async () => {
    const [buoy, shard] = [await load("buoy"), await load("data_shard")];
    expect(textureSet(buoy, "BuoyGlow")).toEqual(textureSet(shard, "Data_Shard"));
    expect(semantics(buoy)).toEqual(semantics(shard));
  });

  it("stands upright around its glow ring", async () => {
    const b = bounds(await load("buoy"));
    expect(b.min[1]).toBeGreaterThanOrEqual(-1.75);
    expect(b.min[1]).toBeLessThanOrEqual(-1.6);
    expect(b.max[1]).toBeGreaterThanOrEqual(1.5);
    expect(b.max[1]).toBeLessThanOrEqual(1.65);
    for (const r of [0, 2]) {
      expect(b.min[r]).toBeGreaterThanOrEqual(-0.75);
      expect(b.max[r]).toBeLessThanOrEqual(0.75);
    }
  });

  it("stays inside its triangle and download budget", async () => {
    // Drawn five times (one InstancedMesh), against the deep-space ceiling.
    const t = triangles(await load("buoy"));
    expect(t).toBeGreaterThanOrEqual(200);
    expect(t).toBeLessThanOrEqual(400);
    expect(kb("buoy")).toBeLessThanOrEqual(40);
  });
});
```

In `tests/assetProvenance.test.ts`, add to `GENERATORS` after the `"creature.glb"` row:

```ts
  "career_station.glb": "scripts/blender/gen_career_station.py",
  "buoy.glb": "scripts/blender/gen_buoy.py",
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/assetContracts.test.ts tests/assetProvenance.test.ts`
Expected: FAIL. The career station and buoy blocks fail with `ENOENT … public/models/career_station.glb` and `… buoy.glb`. Provenance fails "every listed generator exists" (`career_station.glb -> scripts/blender/gen_career_station.py`) and "no listed asset is missing from the build".

- [ ] **Step 3: Write the buoy generator**

Create `scripts/blender/gen_buoy.py`:

```python
# Career-trail buoy (original work, 100% procedural). Run headless:
#   $BLENDER --background --python scripts/blender/gen_buoy.py
# Output: assets-src/buoy.glb (raw; optimized by npm run assets:optimize)
#
# CONTRACT with src/components/canvas/CareerTrail.tsx and tests/assetContracts.test.ts
# (glTF space, +Y up):
#   one node "Buoy", one mesh, one primitive, one material "BuoyGlow": baseColor
#     + RGB emissive map, emissiveFactor [1,1,1], the same texture set as
#     Data_Shard, so the five instanced buoys share its shader program
#   200-400 triangles; mast along +Y with the origin at the glow ring;
#     y -1.75..1.65, |x| and |z| <= 0.75
#   no vertex colours, no tangents
#
# No bake and no unwrap: every face samples the centre of one flat palette
# cell, so re-running reproduces the file byte for byte (the UV packer is what
# makes baked models vary run to run).
# Blender axes while building: +Z = up (glTF +Y).
import bpy
import bmesh
import math
import os

import numpy as np

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "buoy.glb"))
TEX = 64
GRID = 4  # palette: GRID x GRID cells of CELL pixels
CELL = TEX // GRID


def rgb(h):
    """Hex to the 0..1 sRGB values a byte image stores (the PNG carries these bytes)."""
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


# part -> (palette cell, base colour, emissive colour)
PALETTE = {
    "hull": (0, rgb("1b1d22"), rgb("000000")),  # dark gunmetal float, mast and spokes
    "band": (1, rgb("c9ccd1"), rgb("000000")),  # light reflective bands
    "ring": (2, rgb("7a4a12"), rgb("ffb547")),  # the glowing amber ring
    "tip": (3, rgb("f2e2c0"), rgb("fff0d0")),   # the tip light
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bm = bmesh.new()
UV = bm.loops.layers.uv.new("UVMap")


def finish(faces, part, smooth):
    """Point every face outward, set its shading and map it onto its palette cell."""
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    cell = PALETTE[part][0]
    uv = ((cell % GRID + 0.5) / GRID, (cell // GRID + 0.5) / GRID)
    for f in faces:
        f.smooth = smooth
        for loop in f.loops:
            loop[UV].uv = uv


def lathe(profile, part, segments):
    """Revolve (radius, z) points, listed bottom to top, about Z into a closed
    solid: a radius of 0 is a pole, any other open end gets a flat cap."""
    rings = []
    for r, z in profile:
        if r == 0.0:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segments),
                                        r * math.sin(2 * math.pi * i / segments), z))
                          for i in range(segments)])
    sides, caps = [], []
    for a, b in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            if len(a) == 1:
                sides.append(bm.faces.new((a[0], b[i], b[j])))
            elif len(b) == 1:
                sides.append(bm.faces.new((a[i], a[j], b[0])))
            else:
                sides.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    for end in (rings[0], rings[-1]):
        if len(end) > 1:
            caps.append(bm.faces.new(end))
    finish(sides + caps, part, True)
    for f in caps:
        f.smooth = False


def torus(part, major, minor, z, nu, nv):
    grid = [[bm.verts.new(((major + minor * math.cos(2 * math.pi * j / nv)) * math.cos(2 * math.pi * i / nu),
                           (major + minor * math.cos(2 * math.pi * j / nv)) * math.sin(2 * math.pi * i / nu),
                           z + minor * math.sin(2 * math.pi * j / nv)))
             for j in range(nv)] for i in range(nu)]
    faces = []
    for i in range(nu):
        for j in range(nv):
            i2, j2 = (i + 1) % nu, (j + 1) % nv
            faces.append(bm.faces.new((grid[i][j], grid[i2][j], grid[i2][j2], grid[i][j2])))
    finish(faces, part, True)


def box(part, centre, size):
    hx, hy, hz = (s / 2 for s in size)
    v = [bm.verts.new((centre[0] + sx * hx, centre[1] + sy * hy, centre[2] + sz * hz))
         for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    # vertex index = 4 * (sx > 0) + 2 * (sy > 0) + (sz > 0)
    quads = ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3))
    finish([bm.faces.new([v[k] for k in q]) for q in quads], part, False)


# ---------------------------------------------------------------- geometry ---
# float (62 tris), mast (20), two bands (56), glow ring (160), spokes (24), tip (48): 370
lathe([(0.0, -1.70), (0.34, -1.62), (0.42, -1.38), (0.36, -1.10), (0.10, -1.00)], "hull", 8)
lathe([(0.07, -1.00), (0.07, 1.26)], "hull", 6)
lathe([(0.10, -0.60), (0.10, -0.40)], "band", 8)
lathe([(0.10, 0.90), (0.10, 1.05)], "band", 8)
torus("ring", 0.62, 0.11, 0.0, 16, 5)
box("hull", (0.0, 0.0, 0.0), (1.20, 0.05, 0.05))
box("hull", (0.0, 0.0, 0.0), (0.05, 1.20, 0.05))
lathe([(0.0, 1.26), (0.10, 1.31), (0.15, 1.42), (0.10, 1.53), (0.0, 1.58)], "tip", 8)

# ---------------------------------------------------------------- textures ---
col = np.zeros((TEX, TEX, 3), np.float32)
em = np.zeros((TEX, TEX, 3), np.float32)
for cell, base, glow in PALETTE.values():
    x0, y0 = (cell % GRID) * CELL, (cell // GRID) * CELL
    col[y0:y0 + CELL, x0:x0 + CELL] = base
    em[y0:y0 + CELL, x0:x0 + CELL] = glow


def to_image(name, pixels):
    img = bpy.data.images.new(name, width=TEX, height=TEX, alpha=False)
    rgba = np.ones((TEX, TEX, 4), np.float32)
    rgba[..., :3] = pixels
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


img_col = to_image("buoy_color", col)
img_em = to_image("buoy_emissive", em)

# ---------------------------------------------------------------- material ---
mat = bpy.data.materials.new("BuoyGlow")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Metallic"].default_value = 0.4
bsdf.inputs["Roughness"].default_value = 0.45
tc = nt.nodes.new("ShaderNodeTexImage")
tc.image = img_col
nt.links.new(tc.outputs["Color"], bsdf.inputs["Base Color"])
te = nt.nodes.new("ShaderNodeTexImage")
te.image = img_em
nt.links.new(te.outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 1.0

# ------------------------------------------------------------------ object ---
me = bpy.data.meshes.new("Buoy")
bm.to_mesh(me)
bm.free()
me.materials.append(mat)
obj = bpy.data.objects.new("Buoy", me)
bpy.context.scene.collection.objects.link(obj)

me.calc_loop_triangles()
xs = [v.co for v in me.vertices]
print("TRIS", len(me.loop_triangles))
print("BLENDER_BBOX x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % (
    min(v.x for v in xs), max(v.x for v in xs), min(v.y for v in xs), max(v.y for v in xs),
    min(v.z for v in xs), max(v.z for v in xs)))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True)
print("wrote", OUT)
```

- [ ] **Step 4: Generate the buoy twice and confirm determinism**

```bash
B=/Users/fitzgeral/Applications/Blender.app/Contents/MacOS/Blender
$B --background --python scripts/blender/gen_buoy.py 2>&1 | grep -E "TRIS|BLENDER_BBOX|Error|wrote"
shasum -a 256 assets-src/buoy.glb
$B --background --python scripts/blender/gen_buoy.py > /dev/null 2>&1
shasum -a 256 assets-src/buoy.glb
```

Expected: `TRIS 370`; `BLENDER_BBOX x[-0.730,0.730] y[-0.730,0.730] z[-1.700,1.580]`; `wrote …/assets-src/buoy.glb`; both hashes identical. If the hashes differ, stop and report: this generator has no packer and must be byte-reproducible.

- [ ] **Step 5: Write the station generator**

Create `scripts/blender/gen_career_station.py`:

```python
# Career station (original work, 100% procedural). Run headless:
#   $BLENDER --background --python scripts/blender/gen_career_station.py
# Output: assets-src/career_station.glb (raw; optimized by npm run assets:optimize)
#
# CONTRACT with src/components/canvas/CareerStation.tsx and tests/assetContracts.test.ts
# (glTF space, +Y up, drawn at scale 1, so 1 unit = 1 world unit):
#   nodes: CareerStation (hub, solar arms, radiators, dock lights) and
#     HabitatRing (ring, pods, spokes, bearing collar). HabitatRing is a
#     separate node with no rotation of its own and its origin on the hub
#     axis: the app spins it by writing rotation.y.
#   materials: HullBaked (colour x AO bake + baked normal map: the same
#     texture set as cargo_ship's HullBaked, so it shares that shader program)
#     and DockLight (untextured amber emissive, never baked). HabitatRing uses
#     HullBaked only.
#   <= 6000 triangles. Every vertex within 5.3 of the centre, inside the
#     career jump standoff (5.4, src/data/careerTrail.ts), so a jump never
#     lands in the hull. glTF y from -3.0 to 3.2.
#   no vertex colours, no tangents (either would add a shader program).
# Blender axes while building: +Z = up (glTF +Y); the ring lies in the XY plane.
import bpy
import bmesh
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets-src", "career_station.glb")
TEX = 1024
BODY, RING = 0, 1  # per-face "part" attribute: which node a matte face ends up in

bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene


def srgb(h):
    def c(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(c(int(h[i:i + 2], 16)) for i in (0, 2, 4))


AMBER = srgb("ffb547")


# ------------------------------------------------------------ node helpers ---
def _n(nt, kind, **props):
    node = nt.nodes.new(kind)
    for k, v in props.items():
        setattr(node, k, v)
    return node


def _math(nt, op, a, b=None):
    m = nt.nodes.new("ShaderNodeMath")
    m.operation = op
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            m.inputs[i].default_value = v
        else:
            nt.links.new(v, m.inputs[i])
    return m.outputs[0]


def _mix_col(nt, fac, a, b):
    m = nt.nodes.new("ShaderNodeMix")
    m.data_type = "RGBA"
    m.blend_type = "MIX"
    for sock, v in ((m.inputs[0], fac), (m.inputs[6], a), (m.inputs[7], b)):
        if isinstance(v, (int, float)):
            sock.default_value = v
        elif isinstance(v, tuple):
            sock.default_value = (*v, 1.0)
        else:
            nt.links.new(v, sock)
    return m.outputs[2]


def _scale_col(nt, col, s):
    v = nt.nodes.new("ShaderNodeVectorMath")
    v.operation = "SCALE"
    if isinstance(col, tuple):
        v.inputs[0].default_value = col
    else:
        nt.links.new(col, v.inputs[0])
    if isinstance(s, (int, float)):
        v.inputs[3].default_value = s
    else:
        nt.links.new(s, v.inputs[3])
    return v.outputs[0]


# ---------------------------------------------------------------- materials ---
def bake_material(name, base, seam_scale):
    """Matte hull material designed for baking: per-panel tone, grime, dark
    plating seams (colour pass) and recessed seams (normal pass)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = 0.0  # the DIFFUSE/COLOR pass returns the full albedo
    bsdf.inputs["Roughness"].default_value = 0.6
    tc = _n(nt, "ShaderNodeTexCoord")
    sp = _n(nt, "ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sp.inputs[0])
    sn = _n(nt, "ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Normal"], sn.inputs[0])
    # Two coordinates across each face: (x, y) on faces facing up or down,
    # (x + y, z) on the sides, so plating seams wrap around the hull.
    top = _math(nt, "GREATER_THAN", _math(nt, "ABSOLUTE", sn.outputs[2]), 0.7)
    side = _math(nt, "SUBTRACT", 1.0, top)
    u = _math(nt, "ADD", _math(nt, "MULTIPLY", top, sp.outputs[0]),
              _math(nt, "MULTIPLY", side, _math(nt, "ADD", sp.outputs[0], sp.outputs[1])))
    v = _math(nt, "ADD", _math(nt, "MULTIPLY", top, sp.outputs[1]), _math(nt, "MULTIPLY", side, sp.outputs[2]))
    vec = _n(nt, "ShaderNodeCombineXYZ")
    nt.links.new(u, vec.inputs[0])
    nt.links.new(v, vec.inputs[1])
    brick = _n(nt, "ShaderNodeTexBrick", offset=0.5, offset_frequency=2)
    nt.links.new(vec.outputs[0], brick.inputs["Vector"])
    brick.inputs["Color1"].default_value = (0, 0, 0, 1)
    brick.inputs["Color2"].default_value = (1, 1, 1, 1)
    brick.inputs["Mortar"].default_value = (0.5, 0.5, 0.5, 1)
    brick.inputs["Scale"].default_value = seam_scale
    brick.inputs["Mortar Size"].default_value = 0.012
    brick.inputs["Mortar Smooth"].default_value = 0.15
    brick.inputs["Brick Width"].default_value = 0.9
    brick.inputs["Row Height"].default_value = 0.45
    seam = brick.outputs["Fac"]
    panel = _n(nt, "ShaderNodeSeparateColor")
    nt.links.new(brick.outputs["Color"], panel.inputs[0])
    tone = _math(nt, "ADD", 0.85, _math(nt, "MULTIPLY", panel.outputs[0], 0.3))
    noise = _n(nt, "ShaderNodeTexNoise")
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    noise.inputs["Scale"].default_value = 1.4
    noise.inputs["Detail"].default_value = 6.0
    grime = _math(nt, "ADD", 0.82, _math(nt, "MULTIPLY", noise.outputs["Fac"], 0.3))
    col = _scale_col(nt, base, _math(nt, "MULTIPLY", tone, grime))
    col = _mix_col(nt, seam, col, _scale_col(nt, col, 0.35))
    nt.links.new(col, bsdf.inputs["Base Color"])
    bump = _n(nt, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.8
    bump.inputs["Distance"].default_value = 0.01
    nt.links.new(_math(nt, "SUBTRACT", 1.0, seam), bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


BAKE = {
    "light": bake_material("BAKE_light", (0.60, 0.61, 0.63), 1.6),
    "dark": bake_material("BAKE_dark", (0.19, 0.20, 0.22), 2.4),
    "amber": bake_material("BAKE_amber", tuple(c * 0.85 for c in AMBER), 2.4),
    "panel": bake_material("BAKE_panel", (0.05, 0.07, 0.13), 6.0),
}

DOCK_LIGHT = bpy.data.materials.new("DockLight")
DOCK_LIGHT.use_nodes = True
_dl = DOCK_LIGHT.node_tree.nodes["Principled BSDF"]
_dl.inputs["Base Color"].default_value = (*[c * 0.05 for c in AMBER], 1.0)
_dl.inputs["Metallic"].default_value = 0.0
_dl.inputs["Roughness"].default_value = 0.4
_dl.inputs["Emission Color"].default_value = (*AMBER, 1.0)
_dl.inputs["Emission Strength"].default_value = 6.0

# ---------------------------------------------------------------- builders ---
MATTE = []   # (object, bevel width)
LIGHTS = []


def activate(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def _finish(ob, name, mat, part, bevel):
    ob.name = name
    ob.data.name = name
    ob.data.materials.append(mat)
    activate(ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if part is None:
        LIGHTS.append(ob)
    else:
        attr = ob.data.attributes.new("part", "INT", "FACE")
        attr.data.foreach_set("value", [part] * len(ob.data.polygons))
        MATTE.append((ob, bevel))
    return ob


def box(name, size, loc, cat, part, bevel=0.02, rot=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    bpy.context.object.scale = size
    return _finish(bpy.context.object, name, BAKE[cat], part, bevel)


def cyl(name, r, depth, loc, cat, part, bevel=0.02, rot=(0.0, 0.0, 0.0), verts=16):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc, rotation=rot)
    return _finish(bpy.context.object, name, BAKE[cat], part, bevel)


def cone(name, r1, r2, depth, loc, cat, part, bevel=0.02, verts=16):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, vertices=verts, location=loc)
    return _finish(bpy.context.object, name, BAKE[cat], part, bevel)


def light_sphere(name, r, loc):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=8, ring_count=5, location=loc)
    return _finish(bpy.context.object, name, DOCK_LIGHT, None, 0.0)


def light_torus(name, major, minor, z):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=24,
                                     minor_segments=6, location=(0.0, 0.0, z))
    return _finish(bpy.context.object, name, DOCK_LIGHT, None, 0.0)


# ---------------------------------------------------------------- the hub ---
# Built first and at the origin: it is the join target, so the joined object
# (and the ring split from it) keeps its origin on the hub axis.
cyl("hub_core", 1.0, 3.8, (0.0, 0.0, 0.0), "light", BODY, verts=20)
cyl("hub_band_top", 1.03, 0.22, (0.0, 0.0, 1.25), "amber", BODY, bevel=0.0, verts=20)
cyl("hub_band_low", 1.03, 0.22, (0.0, 0.0, -1.25), "amber", BODY, bevel=0.0, verts=20)
cone("hub_cap_top", 1.0, 0.5, 0.5, (0.0, 0.0, 2.15), "light", BODY)
cyl("hub_deck", 0.5, 0.3, (0.0, 0.0, 2.55), "dark", BODY)
cyl("antenna", 0.04, 0.4, (0.0, 0.0, 2.9), "dark", BODY, bevel=0.0, verts=6)
cone("hub_cap_low", 0.55, 1.0, 0.5, (0.0, 0.0, -2.15), "light", BODY)
cyl("dock_port", 0.4, 0.4, (0.0, 0.0, -2.6), "dark", BODY)

# ------------------------------------- solar arms (above the ring's plane) ---
for s in (-1, 1):
    box(f"arm_truss_{s}", (1.4, 0.16, 0.16), (s * 1.7, 0.0, 1.5), "dark", BODY, bevel=0.01)
    box(f"panel_spine_{s}", (2.4, 0.08, 0.08), (s * 3.6, 0.0, 1.44), "dark", BODY, bevel=0.0)
    for k, cx in enumerate((2.975, 4.225)):
        box(f"panel_{s}_{k}", (1.15, 1.5, 0.05), (s * cx, 0.0, 1.5), "panel", BODY, bevel=0.01)
    # radiators below the ring's plane, clear of the spinning spokes
    box(f"radiator_{s}", (0.06, 1.2, 0.9), (0.0, s * 1.6, -1.0), "light", BODY, bevel=0.01)

# ------------------------------------------ habitat ring (the app spins it) ---
bpy.ops.mesh.primitive_torus_add(major_radius=3.6, minor_radius=0.32, major_segments=40, minor_segments=8,
                                 location=(0.0, 0.0, 0.0))
_finish(bpy.context.object, "ring_torus", BAKE["light"], RING, 0.0)
cyl("ring_collar", 1.15, 0.45, (0.0, 0.0, 0.0), "dark", RING, verts=20)
for k in range(4):
    a = math.radians(45 + 90 * k)
    cyl(f"spoke_{k}", 0.08, 2.2, (2.25 * math.cos(a), 2.25 * math.sin(a), 0.0), "dark", RING, bevel=0.0,
        rot=(0.0, math.radians(90), a), verts=8)
    b = math.radians(90 * k)
    box(f"pod_{k}", (0.9, 0.9, 0.8), (3.6 * math.cos(b), 3.6 * math.sin(b), 0.0), "dark", RING, bevel=0.03,
        rot=(0.0, 0.0, b + math.radians(90)))
    box(f"pod_window_{k}", (0.6, 0.03, 0.14), (4.065 * math.cos(b), 4.065 * math.sin(b), 0.1), "amber", RING,
        bevel=0.0, rot=(0.0, 0.0, b + math.radians(90)))

# ---------------------------------------------------- amber docking lights ---
light_sphere("light_top", 0.07, (0.0, 0.0, 3.05))
light_torus("light_port", 0.42, 0.05, -2.82)
for s in (-1, 1):
    light_sphere(f"light_tip_{s}", 0.08, (s * 4.86, 0.0, 1.5))
for k in range(4):
    a = math.radians(45 + 90 * k)
    light_sphere(f"light_rim_{k}", 0.07, (math.cos(a), math.sin(a), 1.92))

# ------------------------------------------------------- bevels + shading ---
for ob, bevel in MATTE:
    activate(ob)
    if bevel > 0:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(30)
        mod.use_clamp_overlap = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32), keep_sharp_edges=True)
for ob in LIGHTS:
    activate(ob)
    bpy.ops.object.shade_smooth()

# ------------------------------------------- join the matte parts, unwrap ---
bpy.ops.object.select_all(action="DESELECT")
for ob, _ in MATTE:
    ob.select_set(True)
bpy.context.view_layer.objects.active = MATTE[0][0]
bpy.ops.object.join()
station = bpy.context.object

activate(station)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=False)
bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")

# ------------------------------------------------------------------- bake ---
world = bpy.data.worlds.new("bake_world")
SCENE.world = world
world.light_settings.distance = 0.8  # AO reach (station units)
SCENE.render.engine = "CYCLES"
SCENE.cycles.device = "CPU"
SCENE.cycles.seed = 0
SCENE.render.bake.margin = 6


def new_img(name, noncolor=False):
    img = bpy.data.images.new(name, width=TEX, height=TEX, alpha=False)
    if noncolor:
        img.colorspace_settings.name = "Non-Color"
    return img


def bake(kind, img, samples, **kw):
    bake_utils._attach_bake_target([station], img)
    SCENE.cycles.samples = samples
    activate(station)
    bpy.ops.object.bake(type=kind, use_clear=True, **kw)
    bake_utils._detach_bake_targets([station])


col_img = new_img("career_station_color_raw")
ao_img = new_img("career_station_ao_raw")
nrm_img = new_img("career_station_normal", noncolor=True)
bake("DIFFUSE", col_img, 4, pass_filter={"COLOR"})
bake("AO", ao_img, 64)
bake("NORMAL", nrm_img, 8, normal_space="TANGENT")

npx = TEX * TEX * 4
c = np.empty(npx, dtype=np.float32)
a = np.empty(npx, dtype=np.float32)
col_img.pixels.foreach_get(c)
ao_img.pixels.foreach_get(a)
c = c.reshape(-1, 4)
a = a.reshape(-1, 4)
c[:, :3] *= 0.25 + 0.75 * a[:, :3]
c[:, 3] = 1.0
albedo = new_img("career_station_albedo")
albedo.pixels.foreach_set(c.ravel())
albedo.pack()
nrm_img.pack()

# ------------------------------------------------- final hull material ---
HULL = bpy.data.materials.new("HullBaked")
HULL.use_nodes = True
_hb = HULL.node_tree.nodes["Principled BSDF"]
_hb.inputs["Metallic"].default_value = 0.3   # dielectric enough to read grey against black space
_hb.inputs["Roughness"].default_value = 0.5
_tex = HULL.node_tree.nodes.new("ShaderNodeTexImage")
_tex.image = albedo
HULL.node_tree.links.new(_tex.outputs["Color"], _hb.inputs["Base Color"])
bake_utils.attach_normal_map(HULL, nrm_img)

me = station.data
me.materials.clear()
me.materials.append(HULL)
me.polygons.foreach_set("material_index", np.zeros(len(me.polygons), dtype=np.int32))
me.update()
for m in list(bpy.data.materials):
    if m.name.startswith("BAKE_"):
        bpy.data.materials.remove(m)
for img in (col_img, ao_img):
    bpy.data.images.remove(img)


# ---------------------------- split the ring into its own node, by part ---
def keep_part(mesh, part):
    bm = bmesh.new()
    bm.from_mesh(mesh)
    layer = bm.faces.layers.int.get("part")
    doomed = [f for f in bm.faces if f[layer] != part]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(mesh)
    bm.free()
    mesh.attributes.remove(mesh.attributes["part"])
    mesh.update()


ring_me = me.copy()
ring = bpy.data.objects.new("HabitatRing", ring_me)
SCENE.collection.objects.link(ring)
ring_me.name = "HabitatRing"
keep_part(me, BODY)
keep_part(ring_me, RING)

# the dock lights join the hub's node (one primitive per material)
bpy.ops.object.select_all(action="DESELECT")
for ob in LIGHTS:
    ob.select_set(True)
station.select_set(True)
bpy.context.view_layer.objects.active = station
bpy.ops.object.join()
body = bpy.context.object
body.name = "CareerStation"
body.data.name = "CareerStation"

# ---------------------------------------------------------- report + export ---
deps = bpy.context.evaluated_depsgraph_get()
total = 0
for ob in (body, ring):
    m = ob.evaluated_get(deps).data
    m.calc_loop_triangles()
    print("TRIS", ob.name, len(m.loop_triangles))
    total += len(m.loop_triangles)
vs = [v.co for ob in (body, ring) for v in ob.data.vertices]
print("TRIS_TOTAL", total)
print("MAX_RADIUS", round(max(v.length for v in vs), 3))
print("BLENDER_BBOX x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % (
    min(v.x for v in vs), max(v.x for v in vs), min(v.y for v in vs), max(v.y for v in vs),
    min(v.z for v in vs), max(v.z for v in vs)))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
ring.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, use_selection=True,
                          export_yup=True)
print("wrote", OUT)
```

- [ ] **Step 6: Generate the station twice; check budget, radius and determinism**

```bash
B=/Users/fitzgeral/Applications/Blender.app/Contents/MacOS/Blender
$B --background --python scripts/blender/gen_career_station.py 2>&1 | grep -E "TRIS|MAX_RADIUS|BLENDER_BBOX|Error|wrote"
shasum -a 256 assets-src/career_station.glb
$B --background --python scripts/blender/gen_career_station.py 2>&1 | grep -E "TRIS_TOTAL|MAX_RADIUS"
shasum -a 256 assets-src/career_station.glb
```

Expected:
- `TRIS_TOTAL` between 2000 and 6000 (about 4.5k by estimate). `MAX_RADIUS` about 5.16 (the solar-panel tip lights) and below 5.3. The bbox is about `x[-4.94,4.94] y[-4.08,4.08] z[-2.87,3.12]`.
- The second run prints the same `TRIS_TOTAL` and `MAX_RADIUS`.
- The two hashes may differ: the UV packer can lay out identical parts (4 pods, 4 spokes, 4 panels) differently run to run, as it does for `cargo_ship.glb`. Record which case you got; Step 9 writes it into the MANIFEST.

If `TRIS_TOTAL` exceeds 6000: in the ring torus call change `major_segments=40` to `32`, and in `light_torus` change `major_segments=24` to `16`. Re-run this step. If `MAX_RADIUS` is 5.3 or more: change the tip-light x from `s * 4.86` to `s * 4.80` and the panel centres from `(2.975, 4.225)` to `(2.95, 4.15)`, then re-run.

- [ ] **Step 7: Optimizer and generate.sh**

In `scripts/optimize-assets.mjs`, replace:

```js
const DEFAULT_TEXTURE_OPTS = { quality: 92 };
for (const k of ["asteroids", "spaceship", "portal_gateway", "space_crystal", "data_shard", "cargo_ship", "creature", "moon", "comet_head"]) {
  TEXTURE_OPTS[k] ??= DEFAULT_TEXTURE_OPTS;
}
```

with:

```js
const DEFAULT_TEXTURE_OPTS = { quality: 92 };
// Every Blender-authored model, in one list, so a new model cannot get texture
// settings without also being processed (or the other way round).
const MODELS = ["asteroids", "spaceship", "portal_gateway", "space_crystal", "data_shard", "cargo_ship", "creature", "moon", "comet_head", "career_station", "buoy"];
for (const k of MODELS) {
  TEXTURE_OPTS[k] ??= DEFAULT_TEXTURE_OPTS;
}
```

and replace:

```js
for (const name of ["asteroids", "spaceship", "portal_gateway", "space_crystal", "data_shard", "cargo_ship", "creature", "moon", "comet_head"]) {
```

with:

```js
for (const name of MODELS) {
```

In `scripts/blender/generate.sh`, replace:

```bash
"$BLENDER" --background --python scripts/blender/gen_shard.py
```

with:

```bash
"$BLENDER" --background --python scripts/blender/gen_shard.py
# Career landmarks (2026-10-15): the career station and its trail buoy.
"$BLENDER" --background --python scripts/blender/gen_career_station.py
"$BLENDER" --background --python scripts/blender/gen_buoy.py
```

- [ ] **Step 8: Optimize the two models and run the contracts**

Run: `npm run assets:optimize -- career_station buoy`
Expected: two lines, `career_station.glb  X.XXMB -> 0.XXMB` and `buoy.glb  0.0XMB -> 0.0XMB`, then `Done.`

Run: `npx vitest run tests/assetContracts.test.ts tests/assetProvenance.test.ts`
Expected: PASS, including every career station and buoy test and "stays under 8 MB in total".

If only "reuses the freighter's material configurations" fails on `extensions` (for example the station's HullBaked lists `KHR_materials_specular` and cargo's does not), the exporter wrote a Principled default the cargo bake does not. Set `_hb.inputs["Specular IOR Level"].default_value = 0.5` and `_hb.inputs["IOR"].default_value = 1.5` in the generator, then repeat Steps 6 and 8. Fix the DockLight block the same way if it is the one that differs.

- [ ] **Step 9: Record provenance in assets-src (commit locally; Task 9 pushes)**

Print the two hash rows:

```bash
(cd assets-src && shasum -a 256 career_station.glb buoy.glb | awk '{printf "| `%s` | `%s` |\n", $2, substr($1,1,16)}')
```

In `assets-src/MANIFEST.md`, add both printed rows to the hash table after the `cargo_ship.glb` row. Add these two rows to the provenance table after the `creature.glb` row:

```markdown
| `career_station.glb` | `scripts/blender/gen_career_station.py` | Career station (2026-10-15): hub, two solar arms, radiators, amber `DockLight` docking lights, and a separate `HabitatRing` node (ring, pods, spokes, collar) that the app spins. Colour x AO + normal bake into `HullBaked` (same texture set as the freighter). |
| `buoy.glb` | `scripts/blender/gen_buoy.py` | Career-trail buoy (2026-10-15): float, mast, glowing amber ring, tip light; one primitive, `BuoyGlow` with palette base + emissive maps (no bake), 370 tris. Byte-reproducible. |
```

If Step 6's two station hashes differed, append to the station row: `**Not byte-reproducible** (like cargo_ship.glb): positions repeat exactly, but the UV packer lays out its identical parts differently each run. Regenerations are equivalent, not identical.` If they matched, append: `Byte-reproducible.`

In the same file, change the Summary bullet `**16 files, all original and regenerable.**` to `**18 files, all original and regenerable.**`

```bash
git -C assets-src add career_station.glb buoy.glb MANIFEST.md
git -C assets-src commit -m "Add career_station.glb and buoy.glb (gen_career_station.py, gen_buoy.py)"
git -C assets-src status -sb
```

Expected: the status line shows `ahead 1` (pushed in Task 9).

- [ ] **Step 10: Commit (main repo)**

```bash
git add scripts/blender/gen_career_station.py scripts/blender/gen_buoy.py scripts/blender/generate.sh scripts/optimize-assets.mjs public/models/career_station.glb public/models/buoy.glb tests/assetContracts.test.ts tests/assetProvenance.test.ts
git commit -m "feat(assets): career station and trail buoy generators

Station: hub, solar arms, spinning HabitatRing node, amber DockLight,
freighter-style HullBaked bake. Buoy: one primitive with Data_Shard's
texture set, no bake. Contracts pin names, budgets, the jump-standoff
radius and shader-config parity.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Shared CareerList and the Career dossier dialog

**Files:**
- Create: `src/components/sections/CareerList.tsx`, `src/components/layout/CareerDossier.tsx`, `tests/careerList.test.ts`
- Modify: `src/components/sections/Career.tsx` (whole file)

**Interfaces:**
- Consumes: `career` (`src/data/career.ts`), `CAREER_AMBER` (Task 2).
- Produces: `export default function CareerList(): JSX.Element` (the `<ol>` timeline, newest first). `export default function CareerDossier({ onClose }: { onClose: () => void }): JSX.Element` (a motion dialog: `role="dialog"`, `aria-modal="true"`, `aria-labelledby="career-dossier-title"`, `data-testid="career-dossier"`, an autofocused close button labelled "Close career dossier (Esc)").

- [ ] **Step 1: Write the failing test**

Create `tests/careerList.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CareerList from "../src/components/sections/CareerList";
import Career from "../src/components/sections/Career";
import CareerDossier from "../src/components/layout/CareerDossier";
import { career } from "../src/data/career";

/** React escapes these in markup. */
const escapeHtml = (s: string) => s
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const list = renderToStaticMarkup(createElement(CareerList));

describe("CareerList", () => {
  it("lists every role newest first, with company, note, dates, type, place and summary", () => {
    let at = -1;
    for (const c of career) {
      const i = list.indexOf(`${escapeHtml(c.role)}</h3>`);
      expect(i, c.role).toBeGreaterThan(at);
      at = i;
      const texts = [c.company, c.employment, c.location, c.summary, `${c.start} – ${c.end ?? "Present"}`];
      if (c.note) texts.push(`(${c.note})`);
      for (const t of texts) expect(list, t).toContain(escapeHtml(t));
    }
  });

  it("is exactly what the résumé's Career section renders, so the two cannot drift", () => {
    expect(renderToStaticMarkup(createElement(Career))).toContain(list);
  });
});

describe("CareerDossier", () => {
  const html = renderToStaticMarkup(createElement(CareerDossier, { onClose: () => {} }));

  it("is a labelled modal dialog", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="career-dossier-title"');
    expect(html).toContain('id="career-dossier-title"');
  });

  it("renders the shared career list", () => {
    expect(html).toContain(list);
  });

  it("has a close button that names Esc", () => {
    expect(html).toContain('aria-label="Close career dossier (Esc)"');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/careerList.test.ts`
Expected: FAIL with `Failed to resolve import "../src/components/sections/CareerList"`.

- [ ] **Step 3: Extract CareerList**

Create `src/components/sections/CareerList.tsx`:

```tsx
import { motion } from "framer-motion";
import { Briefcase, MapPin } from "lucide-react";
import { career } from "../../data/career";

/**
 * The work-history timeline, newest first. Rendered by the résumé's Career
 * section and by the career station's dossier, so the two can never drift.
 */
export default function CareerList() {
  return (
    <ol className="relative border-l border-white/10 ml-2">
      {career.map((c, i) => (
        <motion.li
          key={`${c.company}-${c.start}`}
          initial={{ opacity: 0, x: -12 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.4, delay: i * 0.05 }}
          className="mb-10 ml-6 last:mb-0"
        >
          <span
            className={`absolute -left-[7px] mt-1.5 w-3.5 h-3.5 rounded-full border-2 ${
              c.end ? "border-white/30 bg-[#020108]" : "border-primary bg-primary shadow-neonGreen"
            }`}
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-1">
            <h3 className="font-display font-bold text-lg text-white">{c.role}</h3>
            <span className="font-mono text-xs text-muted">
              {c.start} – {c.end ?? "Present"}
            </span>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-white/70 mb-2">
            <span className="flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5 text-white/40" />
              {c.company}
              {c.note && <span className="text-white/40">({c.note})</span>}
            </span>
            <span className="text-white/40">{c.employment}</span>
            <span className="flex items-center gap-1.5 text-white/40">
              <MapPin className="w-3.5 h-3.5" />
              {c.location}
            </span>
          </p>
          <p className="text-muted text-sm font-light leading-relaxed max-w-2xl">{c.summary}</p>
        </motion.li>
      ))}
    </ol>
  );
}
```

Replace the whole of `src/components/sections/Career.tsx` with:

```tsx
import CareerList from "./CareerList";

/** Classic-résumé work history: a vertical timeline, newest first. */
export default function Career() {
  return (
    <section id="career" className="py-24 relative w-full">
      <div className="max-w-4xl mx-auto px-6 w-full">
        <div className="mb-14 text-center md:text-left">
          <p className="font-mono text-xs text-primary tracking-widest uppercase mb-2">
            // WORK_HISTORY
          </p>
          <h2 className="font-display font-black text-3xl sm:text-4xl lg:text-5xl">Career</h2>
        </div>

        <CareerList />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create the dossier**

Create `src/components/layout/CareerDossier.tsx`:

```tsx
import { motion } from "framer-motion";
import { X } from "lucide-react";
import CareerList from "../sections/CareerList";
import { CAREER_AMBER } from "../../data/careerTrail";

/**
 * The career station's dossier (spec §2): the résumé's work history, opened by
 * docking at the station. Same conventions as a project dossier: a modal
 * dialog, Esc or either button closes it (App's Esc handler breaks orbit), and
 * focus lands on the close button.
 */
export default function CareerDossier({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="career-dossier-title"
      data-testid="career-dossier"
      className="w-full max-w-2xl pointer-events-auto glass-card rounded-3xl p-8 relative border max-h-[85vh] overflow-y-auto pr-4 select-none bg-black/90"
      style={{ borderColor: `${CAREER_AMBER}33`, boxShadow: `0 0 40px ${CAREER_AMBER}11` }}
    >
      <button
        autoFocus
        onClick={onClose}
        aria-label="Close career dossier (Esc)"
        title="Close career dossier (Esc)"
        className="absolute top-6 right-6 p-2 rounded-lg border border-white/5 bg-white/2 hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
      >
        <X className="w-5 h-5" />
      </button>

      <div className="flex flex-wrap items-center gap-6 mb-6">
        <span className="font-mono text-xs text-muted tracking-widest">// WORK_HISTORY</span>
        <span
          className="px-2 py-0.5 rounded font-mono text-[9px] uppercase border"
          style={{ color: CAREER_AMBER, borderColor: `${CAREER_AMBER}55` }}
        >
          DOCKED
        </span>
      </div>

      <h3 id="career-dossier-title" className="font-display font-black text-3xl sm:text-4xl mb-8 text-white">
        Career
      </h3>

      <CareerList />

      <div className="flex items-center justify-between border-t border-white/5 pt-6 mt-8">
        <button
          onClick={onClose}
          className="px-5 py-3 rounded-xl font-mono text-xs font-bold text-black cursor-pointer hover:shadow-lg transition-all"
          style={{ backgroundColor: CAREER_AMBER }}
        >
          THRUSTERS_BREAK_ORBIT
        </button>
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 5: Run the test, typecheck and lint**

Run: `npx vitest run tests/careerList.test.ts`
Expected: PASS (5 tests).

Run: `npm test && npx tsc -b && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/sections/CareerList.tsx src/components/sections/Career.tsx src/components/layout/CareerDossier.tsx tests/careerList.test.ts
git commit -m "feat(career): shared CareerList and the Career dossier dialog

The résumé section and the station dossier render the same list.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The career destination goes live (row, dossier, logbook, keys, HUD, pad)

Adding the row makes keys `[4]` Career and `[5]` Contact, the HUD rows, the radar marker, the pad mapping (d-pad left = career, Menu = contact) and zone detection all follow from Task 1's generic code. Task 6 adds the visible station. The dossier works from now on, because a jump to the station's position docks there.

**Files:**
- Modify: `src/data/destinations.ts` (imports, career row), `src/App.tsx` (import, career modal), `src/utils/logbook.ts:7,26-31,70-71`, `src/utils/scanReport.ts:4-10`, `src/data/chatterLines.ts` (zones), `src/components/layout/HUDOverlay.tsx` (imports, target label, completion line), `src/hooks/useGamepadInput.ts:8`, `README.md` (controls), `tests/e2e/logbook.probe.mjs`, `tests/e2e/gamepad.probe.mjs`
- Test: `tests/destinations.test.ts`, `tests/logbook.test.ts`, `tests/spaceStore.test.ts`, `tests/padAction.test.ts`, `tests/scanReport.test.ts`

**Interfaces:**
- Consumes: `STATION_POS`, `STATION_RADII`, `CAREER_AMBER` (Task 2); `CareerDossier` (Task 4); `destinationById`, `afterPlanets`, `JUMP_TARGETS`, `nextWaypoint` (Task 1).
- Produces: a `career` row in `DESTINATIONS` (index 0, before contact); a `career` LOGBOOK essential (before contact); `badgeLine("career", …) === "LOGBOOK // CAREER DOSSIER READ"`; the `scanReport` entry for `career`; the `career` chatter zone.

- [ ] **Step 1: Write the failing tests**

Append to `tests/destinations.test.ts` (and add `import { STATION_POS } from "../src/data/careerTrail";` and `import { nextWaypoint } from "../src/utils/navigation";` to its imports):

```ts
describe("career station row", () => {
  it("sits at the trail's station with the portal's radii scaled for a ~5-unit model", () => {
    const c = destinationById("career")!;
    expect(c).toMatchObject({
      id: "career", label: "CAREER STATION", jumpLabel: "Career", scanLabel: "STATION_CAREER",
      color: "#ffb547", zoneR: 8.5, lockR: 5.8, retainR: 13, orbitR: 10, jumpR: 5.4,
    });
    expect(c.pos).toBe(STATION_POS);
  });

  it("comes before the contact portal: keys 4 and 5, d-pad left and Menu", () => {
    const ids = JUMP_TARGETS.map((t) => t.id);
    expect(ids.indexOf("career")).toBe(3);
    expect(ids.indexOf("contact")).toBe(4);
  });

  it("orders the waypoint: unread planets, then the career station, then the contact portal", () => {
    const names = planets.map((p) => p.name);
    const bodies = Object.fromEntries(planets.map((p, i) => [p.name, { x: 10 * (i + 1), y: 0, z: 0 }]));
    const ship = { x: 0, y: 0, z: 0 };
    expect(nextWaypoint(ship, names, bodies, [], afterPlanets([]))).toBe(names[0]);
    expect(nextWaypoint(ship, names, bodies, names, afterPlanets([]))).toBe("career");
    expect(nextWaypoint(ship, names, bodies, names, afterPlanets([{ id: "contact" }]))).toBe("career");
    expect(nextWaypoint(ship, names, bodies, names, afterPlanets([{ id: "career" }]))).toBe("contact");
    expect(nextWaypoint(ship, names, bodies, names, afterPlanets([{ id: "career" }, { id: "contact" }]))).toBe("contact");
  });
});
```

In `tests/logbook.test.ts`, make these replacements:

```ts
  it("has 4 essentials then 6 badges, ids unique", () => {
    expect(LOGBOOK.map((e) => e.section)).toEqual([...Array(4).fill("essential"), ...Array(6).fill("badge")]);
```
→
```ts
  it("has 5 essentials then 6 badges, ids unique", () => {
    expect(LOGBOOK.map((e) => e.section)).toEqual([...Array(5).fill("essential"), ...Array(6).fill("badge")]);
```

```ts
    expect(logbookCount(empty)).toEqual({ done: 0, total: 10 });
    expect(logbookCount({ ...withBadges("slingshot"), visitedDossiers: ["fuxx"] })).toEqual({ done: 2, total: 10 });
```
→
```ts
    expect(logbookCount(empty)).toEqual({ done: 0, total: 11 });
    expect(logbookCount({ ...withBadges("slingshot"), visitedDossiers: ["fuxx"] })).toEqual({ done: 2, total: 11 });
```

```ts
    const essentials: LogbookProgress = { ...withBadges("contact"), visitedDossiers: projects.map((p) => p.id) };
    expect(essentialsDone(essentials)).toBe(true);
```
→
```ts
    const essentials: LogbookProgress = { ...withBadges("career", "contact"), visitedDossiers: projects.map((p) => p.id) };
    expect(essentialsDone(essentials)).toBe(true);
```

```ts
      ...withBadges("contact", "slingshot", "comet", "ring", "ore", "convoy"),
      visitedDossiers: projects.map((p) => p.id), shardsCollected: [1, 2, 3],
    };
    expect(allDone(everything)).toBe(true);
```
→
```ts
      ...withBadges("career", "contact", "slingshot", "comet", "ring", "ore", "convoy"),
      visitedDossiers: projects.map((p) => p.id), shardsCollected: [1, 2, 3],
    };
    expect(allDone(everything)).toBe(true);
```

```ts
    for (const id of ["contact", "slingshot", "comet", "ring", "ore", "convoy"]) expect(isRecordable(id)).toBe(true);
```
→
```ts
    for (const id of ["career", "contact", "slingshot", "comet", "ring", "ore", "convoy"]) expect(isRecordable(id)).toBe(true);
```

```ts
  it("uses the portal line for the contact essential", () => {
    expect(badgeLine("contact", null)).toBe("LOGBOOK // CONTACT PORTAL REACHED");
  });
```
→
```ts
  it("uses the portal line for the contact essential", () => {
    expect(badgeLine("contact", null)).toBe("LOGBOOK // CONTACT PORTAL REACHED");
  });
  it("uses the dossier line for the career essential", () => {
    expect(badgeLine("career", null)).toBe("LOGBOOK // CAREER DOSSIER READ");
  });
```

and in `describe("milestoneFor", …)`:

```ts
  const essentials: LogbookProgress = { ...withBadges("contact"), visitedDossiers: projects.map((p) => p.id) };
  const all: LogbookProgress = {
    ...withBadges("contact", "slingshot", "comet", "ring", "ore", "convoy"),
```
→
```ts
  const essentials: LogbookProgress = { ...withBadges("career", "contact"), visitedDossiers: projects.map((p) => p.id) };
  const all: LogbookProgress = {
    ...withBadges("career", "contact", "slingshot", "comet", "ring", "ore", "convoy"),
```

Then append to `tests/logbook.test.ts`:

```ts
describe("returning visitors (progress saved before the career essential existed)", () => {
  const oldEssentials: LogbookProgress = { ...withBadges("contact"), visitedDossiers: projects.map((p) => p.id) };
  const docked = (p: LogbookProgress): LogbookProgress => ({ ...p, badges: [...p.badges, { id: "career", at: "2026-10-15" }] });

  it("are one essential short, and are pointed at the career dossier", () => {
    expect(essentialsDone(oldEssentials)).toBe(false);
    expect(nextGoal(oldEssentials)?.id).toBe("career");
    expect(logbookCount(oldEssentials)).toEqual({ done: 4, total: 11 });
  });

  it("get the tour milestone once, when they dock at the station", () => {
    expect(milestoneFor(oldEssentials, docked(oldEssentials))).toBe("essentials");
    expect(milestoneFor(docked(oldEssentials), docked(oldEssentials))).toBeNull();
  });

  it("who had everything keep their plumes, and complete the logbook again only by docking", () => {
    const old: LogbookProgress = {
      ...withBadges("contact", "slingshot", "comet", "ring", "ore", "convoy"),
      visitedDossiers: projects.map((p) => p.id), shardsCollected: [1, 2, 3],
    };
    expect(allDone(old)).toBe(false);
    expect(plumeAllowed("slingshot", old, () => true)).toBe(true);
    expect(milestoneFor(old, docked(old))).toBe("all");
  });
});
```

In `tests/spaceStore.test.ts`, inside `describe("spaceStore", …)` after the contact-essential test, add:

```ts
  it("records the career essential on the first dock at the station, and it is not a planet dossier", () => {
    useSpaceStore.setState({ activeZone: "career" });
    useSpaceStore.getState().setOrbitLocked(true);
    expect(useSpaceStore.getState().badges.map((b) => b.id)).toEqual(["career"]);
    expect(useSpaceStore.getState().visitedDossiers).toEqual([]);
  });

  it("keeps a stored career badge (returning visitors who already docked)", () => {
    expect(loadBadges([{ id: "career", at: "2026-10-15" }])).toEqual([{ id: "career", at: "2026-10-15" }]);
  });
```

In `tests/padAction.test.ts`, add to the imports:

```ts
import { padActions } from "../src/utils/gamepad";
import { JUMP_TARGETS } from "../src/data/destinations";
```

and inside `describe("runPadAction", …)` add:

```ts
  it("sends d-pad left to the career station and Menu to the contact portal", () => {
    const s = store();
    const ids = JUMP_TARGETS.map((t) => t.id);
    const press = (i: number) => Array.from({ length: 17 }, (_, k) => k === i);
    const none = press(-1);
    for (const a of padActions(none, press(14))) runPadAction(a, s, ids);
    for (const a of padActions(none, press(9))) runPadAction(a, s, ids);
    expect(s.requestJump.mock.calls).toEqual([["career"], ["contact"]]);
  });
```

In `tests/scanReport.test.ts`, inside `describe("generateScanReport", …)` add:

```ts
  it("reports the career station by its scan label", () => {
    expect(generateScanReport("career")).toMatch(/^SCAN\[STATION_CAREER\] \/\/ .*DOCK/);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/destinations.test.ts tests/logbook.test.ts tests/spaceStore.test.ts tests/padAction.test.ts tests/scanReport.test.ts`
Expected: FAIL. `destinationById("career")` is undefined (`Cannot read properties of undefined`). Logbook expects 5 essentials and total 11. The store expects `["career"]` but gets `[]`. padAction gets `[["contact"]]` instead of `[["career"], ["contact"]]`. The scan report is a generic `SCAN[CAREER] // …` line.

- [ ] **Step 3: Add the career row**

In `src/data/destinations.ts`, add after the constants import:

```ts
import { STATION_POS, STATION_RADII, CAREER_AMBER } from "./careerTrail";
```

Replace:

```ts
export const DESTINATIONS: readonly Destination[] = [
  {
    id: "contact",
```

with:

```ts
export const DESTINATIONS: readonly Destination[] = [
  // Key 4. Radii in careerTrail.ts, next to the placement they were tested with.
  {
    id: "career", label: "CAREER STATION", jumpLabel: "Career", scanLabel: "STATION_CAREER", pos: STATION_POS,
    color: CAREER_AMBER, ...STATION_RADII,
  },
  // Key 5.
  {
    id: "contact",
```

- [ ] **Step 4: App renders the Career dossier when docked at the station**

In `src/App.tsx`, add after `import LogbookPanel from "./components/layout/LogbookPanel";`:

```ts
import CareerDossier from "./components/layout/CareerDossier";
```

Replace:

```tsx
                <Contact isSidebar={true} />
              </motion.div>
            )}
```

with:

```tsx
                <Contact isSidebar={true} />
              </motion.div>
            )}

            {/* Career station Orbit Lock: Career dossier */}
            {isOrbitLocked && zoneDestination === "career" && (
              <CareerDossier key="career-dossier" onClose={breakOrbit} />
            )}
```

- [ ] **Step 5: Logbook fifth essential**

In `src/utils/logbook.ts`, replace:

```ts
 * four essentials that tour the portfolio, then six flight badges that each
```

with:

```ts
 * five essentials that tour the portfolio, then six flight badges that each
```

Replace:

```ts
  { id: "fuxx", section: "essential", title: "Read the fuxx dossier", hint: "READ THE FUXX DOSSIER", hintShort: "FUXX DOSSIER", plume: false },
```

with:

```ts
  { id: "fuxx", section: "essential", title: "Read the fuxx dossier", hint: "READ THE FUXX DOSSIER", hintShort: "FUXX DOSSIER", plume: false },
  { id: "career", section: "essential", title: "Read the career dossier", hint: "DOCK AT THE CAREER STATION", hintShort: "CAREER DOSSIER", plume: false },
```

Replace:

```ts
  if (id === "contact") return "LOGBOOK // CONTACT PORTAL REACHED";
```

with:

```ts
  if (id === "contact") return "LOGBOOK // CONTACT PORTAL REACHED";
  if (id === "career") return "LOGBOOK // CAREER DOSSIER READ";
```

- [ ] **Step 6: Station scan report and radio lines**

In `src/utils/scanReport.ts`, replace:

```ts
  contact: "SCAN[PORTAL_SUN] // COMM-GATE RESONANT. THE PILOT ANSWERS TRANSMISSIONS. DOCK TO COMPOSE",
```

with:

```ts
  contact: "SCAN[PORTAL_SUN] // COMM-GATE RESONANT. THE PILOT ANSWERS TRANSMISSIONS. DOCK TO COMPOSE",
  career: "SCAN[STATION_CAREER] // HABITAT RING SPINNING. THE PILOT'S WORK HISTORY IS ON FILE. DOCK TO READ IT",
```

In `src/data/chatterLines.ts`, replace:

```ts
    contact: [
      "PORTAL GATEWAY IN RANGE // COMM-LINK READY",
      "THE PILOT ACCEPTS TRANSMISSIONS. DOCK TO COMPOSE",
      "STARGATE HARMONICS STABLE. SAY HELLO",
    ],
```

with:

```ts
    contact: [
      "PORTAL GATEWAY IN RANGE // COMM-LINK READY",
      "THE PILOT ACCEPTS TRANSMISSIONS. DOCK TO COMPOSE",
      "STARGATE HARMONICS STABLE. SAY HELLO",
    ],
    career: [
      "CAREER STATION IN RANGE // DOCKING LIGHTS AMBER",
      "HABITAT RING SPINNING. THE PILOT'S WORK HISTORY IS ABOARD",
      "DOCK TO READ THE FULL CAREER LOG",
    ],
```

- [ ] **Step 7: HUD target label and the all-dossiers line read the table**

In `src/components/layout/HUDOverlay.tsx`, replace:

```ts
import { DESTINATIONS } from "../../data/destinations";
```

with:

```ts
import { DESTINATIONS, JUMP_TARGETS, afterPlanets, destinationById } from "../../data/destinations";
```

Replace:

```tsx
  // Once every dossier is read, point the pilot at the portal — announced on
  // leaving the last dossier, when the chatter line is actually visible.
  const allRead = visitedDossiers.length >= planets.length;
  useEffect(() => {
    if (!allRead || isOrbitLocked || completionAnnounced) return;
    completionAnnounced = true;
    useSpaceStore.getState().sendBroadcast(
      `ALL ${planets.length} DOSSIERS READ // THE PILOT TAKES MESSAGES AT THE PORTAL ABOVE THE SUN — PRESS ${planets.length + 1} TO JUMP THERE`
    );
  }, [allRead, isOrbitLocked]);
```

with:

```tsx
  // Once every dossier is read, point the pilot at the next destination (the
  // career station, then the contact portal), announced on leaving the last
  // dossier, when the chatter line is actually visible.
  const allRead = visitedDossiers.length >= planets.length;
  useEffect(() => {
    if (!allRead || isOrbitLocked || completionAnnounced) return;
    completionAnnounced = true;
    const next = destinationById(afterPlanets(useSpaceStore.getState().badges));
    if (!next) return;
    const key = JUMP_TARGETS.findIndex((t) => t.id === next.id) + 1;
    useSpaceStore.getState().sendBroadcast(
      `ALL ${planets.length} DOSSIERS READ // NEXT STOP: THE ${next.label} — PRESS ${key} TO JUMP THERE`
    );
  }, [allRead, isOrbitLocked]);
```

Replace:

```tsx
            {activeZone ? `PLANET_${activeZone.toUpperCase()}` : "DEEP_SPACE"}
```

with:

```tsx
            {activeZone ? (destinationById(activeZone)?.scanLabel ?? `PLANET_${activeZone.toUpperCase()}`) : "DEEP_SPACE"}
```

(`DESTINATIONS` is still used by the sector rows from Task 1.)

- [ ] **Step 8: Pad message and README**

In `src/hooks/useGamepadInput.ts`, replace:

```ts
const LINKED_MESSAGE = "CONTROLLER LINKED // L-STICK FLY · R-STICK PITCH · RB WARP · LB BEAM · A SCAN · Y PHOTO · X LOGBOOK · D-PAD JUMP";
```

with:

```ts
const LINKED_MESSAGE = "CONTROLLER LINKED // L-STICK FLY · R-STICK PITCH · RB WARP · LB BEAM · A SCAN · Y PHOTO · X LOGBOOK · D-PAD JUMP · MENU CONTACT";
```

In `README.md`, replace:

```markdown
| `4` | Jump to the contact portal |
```

with:

```markdown
| `4` | Jump to the career station (opens the Career dossier) |
| `5` | Jump to the contact portal |
```

and replace:

```markdown
photo mode, `B` closes a dossier, and the d-pad (clockwise from up) jumps like
`1`–`4`. Impacts rumble the pad in Chrome.
```

with:

```markdown
photo mode, `B` closes a dossier, the d-pad (clockwise from up) jumps like
`1`–`4`, and Menu jumps to the contact portal. Impacts rumble the pad in Chrome.
```

- [ ] **Step 9: Update the two probes whose numbers this changes**

In `tests/e2e/logbook.probe.mjs`, change the four totals from 10 to 11:
- `/LOGBOOK 0\/10.*RUANGRAPI/` → `/LOGBOOK 0\/11.*RUANGRAPI/` and its check name `"fresh tracker shows 0/10 and the first essential"` → `"fresh tracker shows 0/11 and the first essential"`
- `/LOGBOOK 1\/10.*FLIGHT-SIM CV/` → `/LOGBOOK 1\/11.*FLIGHT-SIM CV/`
- `/LOGBOOK 3\/10/` → `/LOGBOOK 3\/11/`
- `/LOGBOOK 4\/10/` → `/LOGBOOK 4\/11/`

In `tests/e2e/gamepad.probe.mjs`, replace:

```js
    // D-pad jumps mirror the number keys: up = 1st target, left = 4th (contact).
```

with:

```js
    // D-pad jumps mirror the number keys: up = 1st target, left = 4th (the
    // career station); Menu = 5th (the contact portal).
```

and replace:

```js
    await press(page, 14);
    s = await readStore(page);
    checks.check("d-pad left requests the contact portal", s.jumpRequest?.id === "contact",
      `jump=${s.jumpRequest?.id}`);
```

with:

```js
    await press(page, 14);
    s = await readStore(page);
    checks.check("d-pad left requests the career station", s.jumpRequest?.id === "career",
      `jump=${s.jumpRequest?.id}`);
    // Let that jump dock and close it, so Menu's request is a fresh one.
    const atStation = await pollUntil(async () => (await readStore(page)).isOrbitLocked,
      { timeoutMs: 15_000, intervalMs: 300 });
    if (atStation.ok) await press(page, 1);
    await press(page, 9);
    s = await readStore(page);
    checks.check("Menu requests the contact portal", s.jumpRequest?.id === "contact",
      `jump=${s.jumpRequest?.id}`);
```

- [ ] **Step 10: Run the tests, typecheck and lint**

Run: `npx vitest run tests/destinations.test.ts tests/logbook.test.ts tests/spaceStore.test.ts tests/padAction.test.ts tests/scanReport.test.ts tests/orbitInvariant.test.ts`
Expected: PASS. `orbitInvariant` now covers the career row: 10 < 12.8, 5.8 < 10, 8.5 < 13, 5.4 < 5.8, escape 14.66 > 13.

Run: `npm test && npx tsc -b && npm run lint`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add src/data/destinations.ts src/App.tsx src/utils/logbook.ts src/utils/scanReport.ts src/data/chatterLines.ts src/components/layout/HUDOverlay.tsx src/hooks/useGamepadInput.ts README.md tests/destinations.test.ts tests/logbook.test.ts tests/spaceStore.test.ts tests/padAction.test.ts tests/scanReport.test.ts tests/e2e/logbook.probe.mjs tests/e2e/gamepad.probe.mjs
git commit -m "feat(career): career station destination, dossier and fifth logbook essential

Keys [4] Career, [5] Contact; d-pad left reaches the station, Menu the
portal. Waypoint goes planets, then career, then contact. Docking records
the career essential; returning visitors are pointed at it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Station, buoys and trail in the scene

**Files:**
- Create: `src/utils/trailGuide.ts`, `src/components/canvas/CareerStation.tsx`, `src/components/canvas/CareerTrail.tsx`, `tests/trailGuide.test.ts`
- Modify: `src/components/canvas/GlobalCanvas.tsx` (imports, mount), `src/components/layout/RadarMap.tsx` (buoy dots), `src/utils/crystalField.ts:4,48-70`, `src/components/canvas/FuelCrystals.tsx:6,70-75`, `tests/planetClearance.test.ts:81-85`, `tests/crystalField.test.ts`, `tests/e2e/programs.probe.mjs`

**Interfaces:**
- Consumes: `STATION_POS`, `BUOYS`, `BUOY_POSITIONS`, `TRAIL_ARC`, `CAREER_AMBER`, `Arc` (Task 2); `career_station.glb` and `buoy.glb` (Task 3); `DESTINATIONS` (Task 1/5); `makeGuideLineMaterial` (`src/components/canvas/guideLine.ts`).
- Produces: `arcPlacement(arc: Arc): { position: THREE.Vector3; quaternion: THREE.Quaternion }`. `crystalAvoidPoints(planetBodies, landmarks: readonly (readonly [number, number, number])[], ship)` (was `portal`) and `LANDMARK_KEEP_OUT = 20`. Scene objects named `CareerBuoys` (InstancedMesh), `CareerTrailGuide` and `HabitatRing`. Buoy scannables `career_0`…`career_4`. Task 7 extends the `CareerTrail` frame loop.

- [ ] **Step 1: Record the "before" renderer counters**

Run: `npm run test:e2e -- transition`
Write down the deep-space `calls=…`, `triangles=…` and `programs=…` values and the close-approach ones from the output. Expected: all checks pass. These are the numbers Step 11 compares against.

- [ ] **Step 2: Write the failing tests**

Create `tests/trailGuide.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { TRAIL_ARC, arcPoint } from "../src/data/careerTrail";
import { arcPlacement } from "../src/utils/trailGuide";

describe("arcPlacement", () => {
  it("lays a RingGeometry's local arc exactly over the trail arc", () => {
    const { position, quaternion } = arcPlacement(TRAIL_ARC);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const th = TRAIL_ARC.span * t;
      const local = new THREE.Vector3(Math.cos(th) * TRAIL_ARC.radius, Math.sin(th) * TRAIL_ARC.radius, 0);
      const world = local.applyQuaternion(quaternion).add(position);
      expect(world.distanceTo(new THREE.Vector3(...arcPoint(TRAIL_ARC, t)))).toBeLessThan(1e-6);
    }
  });
});
```

In `tests/crystalField.test.ts`, replace the import block:

```ts
import {
  CRYSTAL_MAX, CRYSTAL_RESPAWN_SECONDS, isRejectedSpawn, randomCrystalPos, respawnTick,
} from "../src/utils/crystalField";
```

with:

```ts
import {
  CRYSTAL_MAX, CRYSTAL_RESPAWN_SECONDS, LANDMARK_KEEP_OUT, crystalAvoidPoints, isRejectedSpawn, randomCrystalPos, respawnTick,
} from "../src/utils/crystalField";
```

and append:

```ts
describe("crystalAvoidPoints", () => {
  it("keeps every landmark clear, not only the portal", () => {
    const avoid = crystalAvoidPoints([], [[0, 95, -150], [0, -108, 156]], { x: 0, y: 0, z: 0 });
    // Both points are outside the belt bands and far from the ship.
    expect(isRejectedSpawn(0, -108 + LANDMARK_KEEP_OUT - 1, 156, avoid)).toBe(true);
    expect(isRejectedSpawn(0, 95, -150 + LANDMARK_KEEP_OUT - 1, avoid)).toBe(true);
    expect(isRejectedSpawn(0, -108 + LANDMARK_KEEP_OUT + 1, 156, avoid)).toBe(false);
  });
});
```

In `tests/planetClearance.test.ts`, replace:

```ts
    const avoid = crystalAvoidPoints(
      planets.map((p) => ({ ...at, size: p.size })),
      PORTAL_POS,
      { x: 0, y: 200, z: 0 },
    );
```

with:

```ts
    const avoid = crystalAvoidPoints(
      planets.map((p) => ({ ...at, size: p.size })),
      [PORTAL_POS],
      { x: 0, y: 200, z: 0 },
    );
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/trailGuide.test.ts tests/crystalField.test.ts tests/planetClearance.test.ts`
Expected: FAIL. trailGuide fails with `Failed to resolve import "../src/utils/trailGuide"`. crystalField's new test fails: `LANDMARK_KEEP_OUT` is undefined, and the old signature reads the list of tuples as one point. planetClearance still passes, because its assertion covers only the planet keep-outs; the call changes only to match the new signature.

- [ ] **Step 4: The guide placement helper**

Create `src/utils/trailGuide.ts`:

```ts
import * as THREE from "three";
import type { Arc } from "../data/careerTrail";

/**
 * Where to put a RingGeometry so its arc (local XY plane, angle 0 on +X
 * turning toward +Y) lies on `arc`: local +X → u, +Y → v, +Z → n, origin at
 * the centre. u, v, n are orthonormal and right-handed (careerTrail.ts), so
 * the basis is a pure rotation.
 */
export function arcPlacement(arc: Arc): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(...arc.u), new THREE.Vector3(...arc.v), new THREE.Vector3(...arc.n),
  );
  return {
    position: new THREE.Vector3(...arc.centre),
    quaternion: new THREE.Quaternion().setFromRotationMatrix(basis),
  };
}
```

- [ ] **Step 5: Crystals keep clear of every landmark**

In `src/utils/crystalField.ts`, replace:

```ts
/** A sphere spawns must stay clear of — a planet, the portal, or the ship. */
```

with:

```ts
/** A sphere spawns must stay clear of — a planet, a landmark, or the ship. */
```

Replace:

```ts
/** Keep-out around the portal and the ship (crystals never pop into view). */
const PORTAL_KEEP_OUT = 20;
const SHIP_KEEP_OUT = 30;

/**
 * Spheres a crystal spawn must avoid. A planet's keep-out follows its size:
 * its lock-retain radius plus the pickup radius, so collecting a crystal never
 * drags the ship into orbit lock. A fixed radius here went stale the moment
 * planets grew past it.
 */
export function crystalAvoidPoints(
  planetBodies: readonly { x: number; y: number; z: number; size: number }[],
  portal: readonly [number, number, number],
  ship: { x: number; y: number; z: number },
): AvoidPoint[] {
  return [
    ...planetBodies.map((b) => ({ x: b.x, y: b.y, z: b.z, r: b.size * LOCK_RETAIN_FACTOR + CRYSTAL_PICKUP_RADIUS })),
    { x: portal[0], y: portal[1], z: portal[2], r: PORTAL_KEEP_OUT },
    { x: ship.x, y: ship.y, z: ship.z, r: SHIP_KEEP_OUT },
  ];
}
```

with:

```ts
/**
 * Keep-out around each landmark (the contact portal, the career station),
 * well outside their lock radii, so collecting a crystal never docks you;
 * and around the ship, so crystals never pop into view.
 */
export const LANDMARK_KEEP_OUT = 20;
const SHIP_KEEP_OUT = 30;

/**
 * Spheres a crystal spawn must avoid. A planet's keep-out follows its size:
 * its lock-retain radius plus the pickup radius, so collecting a crystal never
 * drags the ship into orbit lock. A fixed radius here went stale the moment
 * planets grew past it.
 */
export function crystalAvoidPoints(
  planetBodies: readonly { x: number; y: number; z: number; size: number }[],
  landmarks: readonly (readonly [number, number, number])[],
  ship: { x: number; y: number; z: number },
): AvoidPoint[] {
  return [
    ...planetBodies.map((b) => ({ x: b.x, y: b.y, z: b.z, r: b.size * LOCK_RETAIN_FACTOR + CRYSTAL_PICKUP_RADIUS })),
    ...landmarks.map((p) => ({ x: p[0], y: p[1], z: p[2], r: LANDMARK_KEEP_OUT })),
    { x: ship.x, y: ship.y, z: ship.z, r: SHIP_KEEP_OUT },
  ];
}
```

In `src/components/canvas/FuelCrystals.tsx`, replace:

```ts
import { planets, PORTAL_POS, COSMIC_BOUNDS } from "../../constants";
```

with:

```ts
import { planets, COSMIC_BOUNDS } from "../../constants";
import { DESTINATIONS } from "../../data/destinations";
```

and replace:

```ts
  const avoidFor = () => crystalAvoidPoints(
    planets.map((p) => ({ ...bodies[p.name], size: p.size })),
    PORTAL_POS,
    flight,
  );
```

with:

```ts
  const avoidFor = () => crystalAvoidPoints(
    planets.map((p) => ({ ...bodies[p.name], size: p.size })),
    DESTINATIONS.map((d) => d.pos),
    flight,
  );
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/trailGuide.test.ts tests/crystalField.test.ts tests/planetClearance.test.ts`
Expected: PASS.

- [ ] **Step 7: The station and trail components**

Create `src/components/canvas/CareerStation.tsx`:

```tsx
import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { STATION_POS } from "../../data/careerTrail";
import { ambientTime } from "../../utils/ambientTime";
import { assetUrl } from "../../utils/assetUrl";

/** rad/s: one turn in about 50 s, slow enough to read as mass. */
const RING_SPIN = 0.12;
const POSITION: [number, number, number] = [STATION_POS[0], STATION_POS[1], STATION_POS[2]];

/**
 * The career station (docs/superpowers/specs/2026-10-15-career-landmarks-design.md §1),
 * built by scripts/blender/gen_career_station.py. Docking is SpacePlanets'
 * zone check on the destination table and opens the Career dossier. There is
 * no collider, as with the portal: the lock radius (5.8) lies outside the
 * model (≤ 5.3), so an approaching ship docks before it reaches the hull. The
 * habitat ring stops turning under reduced motion (ambientTime freezes).
 */
export default function CareerStation() {
  const { scene } = useGLTF(assetUrl("/models/career_station.glb"));
  const ring = useMemo(() => scene.getObjectByName("HabitatRing") ?? null, [scene]);
  useFrame((state) => {
    if (ring) ring.rotation.y = ambientTime(state.clock.getElapsedTime()) * RING_SPIN;
  });
  return <primitive object={scene} position={POSITION} />;
}
```

Create `src/components/canvas/CareerTrail.tsx`:

```tsx
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { BUOYS, BUOY_POSITIONS, CAREER_AMBER, TRAIL_ARC } from "../../data/careerTrail";
import { setScannable, removeScannable } from "../../utils/scannables";
import { ambientTime } from "../../utils/ambientTime";
import { bakeNodeTransform } from "../../utils/bakeNodeTransform";
import { assetUrl } from "../../utils/assetUrl";
import { arcPlacement } from "../../utils/trailGuide";
import { makeGuideLineMaterial } from "./guideLine";

/** The model is ~3.3 tall; at 1.8x a buoy reads from the next one, 42 units away. */
const BUOY_SCALE = 1.8;
const BUOY_GLOW = 2.2;
/** Dash period along the trail, in world units. */
const DASH_LENGTH = 2.5;
const GUIDE_HALF_WIDTH = 0.08;
const dummy = new THREE.Object3D();

/**
 * The career trail (spec §1): five buoys, oldest job first, as ONE
 * InstancedMesh with Data_Shard's material configuration (no new shader
 * program), joined by one dashed guide arc drawn with the orbit rings' guide
 * material. Each buoy is a scannable (career_<n>, CAREER_<year>).
 */
export default function CareerTrail() {
  const { scene } = useGLTF(assetUrl("/models/buoy.glb"));
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const { geometry, material } = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((o) => { if (!src && o instanceof THREE.Mesh) src = o; });
    if (!src) throw new Error("buoy.glb contains no mesh");
    // Float-safe: the quantized GLB stores positions in [-1, 1] (see util).
    const g = bakeNodeTransform(src);
    const m = (src.material as THREE.MeshStandardMaterial).clone();
    m.emissiveIntensity = BUOY_GLOW;
    return { geometry: g, material: m };
  }, [scene]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  const guide = useMemo(() => {
    const g = new THREE.RingGeometry(
      TRAIL_ARC.radius - GUIDE_HALF_WIDTH, TRAIL_ARC.radius + GUIDE_HALF_WIDTH, 160, 1, 0, TRAIL_ARC.span,
    );
    const m = makeGuideLineMaterial({
      color: CAREER_AMBER, opacity: 0.5,
      dashes: Math.round((2 * Math.PI * TRAIL_ARC.radius) / DASH_LENGTH),
      fadeIn: [4, 14], fadeOut: [180, 280],
    });
    return { geometry: g, material: m, ...arcPlacement(TRAIL_ARC) };
  }, []);
  useEffect(() => () => { guide.geometry.dispose(); guide.material.dispose(); }, [guide]);

  // Buoys never move: their matrices are written once.
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    BUOY_POSITIONS.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]);
      dummy.rotation.set(0, i * 1.3, 0);
      dummy.scale.setScalar(BUOY_SCALE);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [geometry]);

  useEffect(() => {
    for (const b of BUOYS) setScannable(b.id, b.pos[0], b.pos[1], b.pos[2], b.label);
    return () => { for (const b of BUOYS) removeScannable(b.id); };
  }, []);

  useFrame((state) => {
    // Nav-light blink: a short full-strength flash about every 2.5 s. ambientTime
    // freezes under reduced motion, which leaves the glow steady.
    const phase = (ambientTime(state.clock.getElapsedTime()) * 0.4) % 1;
    material.emissiveIntensity = BUOY_GLOW * (phase < 0.12 ? 1 : 0.55);
  });

  return (
    <group>
      <instancedMesh name="CareerBuoys" ref={meshRef} args={[geometry, material, BUOYS.length]} frustumCulled={false} />
      <mesh name="CareerTrailGuide" geometry={guide.geometry} material={guide.material}
        position={guide.position} quaternion={guide.quaternion} />
    </group>
  );
}
```

In `src/components/canvas/GlobalCanvas.tsx`, replace:

```ts
import DataShards from "./DataShards";
```

with:

```ts
import DataShards from "./DataShards";
import CareerStation from "./CareerStation";
import CareerTrail from "./CareerTrail";
```

and replace:

```tsx
          {/* Collectible data shards scattered across the system */}
          <DataShards />
```

with:

```tsx
          {/* Collectible data shards scattered across the system */}
          <DataShards />

          {/* Career station (dock for the Career dossier) and its buoy trail */}
          <CareerStation />
          <CareerTrail />
```

Both components are inside the existing Suspense boundary, so `ShaderWarmup` compiles them at load.

- [ ] **Step 8: Buoys on the radar**

In `src/components/layout/RadarMap.tsx`, add after the destinations import:

```ts
import { BUOY_POSITIONS, CAREER_AMBER } from "../../data/careerTrail";
```

and replace:

```ts
      // Live pilots (live sky): a hollow diamond in the pilot's plume colour,
```

with:

```ts
      // Career buoys: small amber dots, in range only and never rim-clamped,
      // like crystals; the station itself is a destination blip above.
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = CAREER_AMBER;
      for (const p of BUOY_POSITIONS) {
        const dx = wrapDelta(flight.x, p[0], COSMIC_BOUNDS);
        const dz = wrapDelta(flight.z, p[2], COSMIC_BOUNDS);
        const dy = wrapDelta(flight.y, p[1], COSMIC_BOUNDS);
        if (Math.hypot(dx, dz, dy) > RANGE) continue;
        const { x: sx, up } = worldToRadar(dx, dz, a);
        ctx.beginPath();
        ctx.arc(c + sx * scale, c - up * scale, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Live pilots (live sky): a hollow diamond in the pilot's plume colour,
```

- [ ] **Step 9: The programs probe tours the career landmarks too**

In `tests/e2e/programs.probe.mjs`, replace:

```js
    const stops = await page.evaluate(() => [
      ...Object.entries(window.__fitz.bodies).map(([name, b]) => [name, b.x, b.y, b.z + 30]),
      ["contact portal", 0, 95, -140],
      ["sun", 0, 0, 40],
      ["deep space", -230, -210, -230],
      ["world edge", 240, 200, 240],
    ]);
```

with:

```js
    const stops = await page.evaluate(async () => {
      const { STATION_POS, BUOYS } = await import("/src/data/careerTrail.ts");
      const mid = BUOYS[2].pos;
      return [
        ...Object.entries(window.__fitz.bodies).map(([name, b]) => [name, b.x, b.y, b.z + 30]),
        ["contact portal", 0, 95, -140],
        // 14 out: outside the station's 8.5 zone, so the tour never docks.
        ["career station", STATION_POS[0], STATION_POS[1], STATION_POS[2] + 14],
        ["career trail", mid[0] + 10, mid[1], mid[2]],
        ["sun", 0, 0, 40],
        ["deep space", -230, -210, -230],
        ["world edge", 240, 200, 240],
      ];
    });
```

- [ ] **Step 10: Unit gates**

Run: `npm test && npx tsc -b && npm run lint`
Expected: all pass.

- [ ] **Step 11: Renderer counters and the program tour**

Run: `npm run test:e2e -- programs transition`
Expected: every check passes. `programs` reports `added=0`. In `transition`, deep-space and close-approach `programs` equal the Step 1 values exactly. A rise of even one means a station or buoy material is not sharing a program: re-check the Task 3 `textureSet` contracts and that `CareerTrail` clones the GLB's material instead of building a new one. Calls rise by at most 6 and triangles by at most about 8k, each within its ceiling (deep space ≤ 40 calls, ≤ 250 580 triangles). If a ceiling is exceeded, stop and report.

- [ ] **Step 12: Look at it**

Start a dev server: `npx vite --port 5288 --strictPort` (in the background). Open `http://localhost:5288` in the Playwright MCP browser at 1512×802. Check that:
- Pressing `4` drops the ship beside a grey hub with a ring, two dark-blue solar arms and amber lights, and the Career dialog opens. The station must not read as a sphere or planet.
- After Esc, the ring turns slowly.
- Running `window.__fitz.teleport(-10, -20, 40)` in the console, then looking down, shows the first buoy and a dashed amber line leading away from it.
- The radar shows amber dots near the start of the trail.

Close the tab and stop the server: `lsof -ti tcp:5288 | xargs -r kill`.

- [ ] **Step 13: Commit**

```bash
git add src/utils/trailGuide.ts src/components/canvas/CareerStation.tsx src/components/canvas/CareerTrail.tsx src/components/canvas/GlobalCanvas.tsx src/components/layout/RadarMap.tsx src/utils/crystalField.ts src/components/canvas/FuelCrystals.tsx tests/trailGuide.test.ts tests/crystalField.test.ts tests/planetClearance.test.ts tests/e2e/programs.probe.mjs
git commit -m "feat(career): station, buoy trail and guide arc in the scene

Spinning habitat ring; five buoys as one InstancedMesh with blinking glow;
one dashed guide arc; buoys scannable and on the radar; crystals keep clear
of every landmark. No new lights or shader programs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Buoy cards

**Files:**
- Create: `src/utils/buoyCard.ts`, `src/components/layout/BuoyCard.tsx`, `tests/buoyCard.test.ts`
- Modify: `src/components/canvas/CareerTrail.tsx` (imports, frame loop), `src/components/canvas/Scanner.tsx` (imports, frame signature, scan hold), `src/utils/scanReport.ts` (buoy reports), `src/components/layout/HUDOverlay.tsx` (mount), `tests/scanReport.test.ts`

**Interfaces:**
- Consumes: `BUOYS`, `BUOY_POSITIONS`, `BUOY_CARD_R`, `CAREER_AMBER`, `Vec3` (Task 2); `gameTime` (`src/utils/ambientTime.ts`).
- Produces (`src/utils/buoyCard.ts`):
  - `BUOY_CARD_EXIT_R = 7.5`, `BUOY_SCAN_HOLD_S = 6`
  - `interface ScanHold { index: number; until: number }`
  - `activeBuoy(ship: { x: number; y: number; z: number }, buoys: readonly Vec3[], prev: number | null, scan: ScanHold | null, now: number): number | null`
  - `buoyIndex(id: string): number` (−1 if not a buoy id)
  - `buoyCardState: { index: number; scan: ScanHold | null }` (index −1 means no card)
- Produces: `[data-testid="buoy-card"]` with `data-index` and inline `style.opacity` `"1"` or `"0"` (read by Task 8).

- [ ] **Step 1: Write the failing tests**

Create `tests/buoyCard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { activeBuoy, buoyIndex, BUOY_CARD_EXIT_R, BUOY_SCAN_HOLD_S } from "../src/utils/buoyCard";
import { BUOY_CARD_R, BUOY_POSITIONS, BUOYS } from "../src/data/careerTrail";

const B = [[0, 0, 0], [40, 0, 0], [80, 0, 0]] as const;
const at = (x: number) => ({ x, y: 0, z: 0 });

describe("activeBuoy", () => {
  it("shows a buoy's card inside its card radius, and none between buoys", () => {
    expect(activeBuoy(at(40 + BUOY_CARD_R - 0.1), B, null, null, 0)).toBe(1);
    expect(activeBuoy(at(20), B, null, null, 0)).toBeNull();
  });

  it("keeps a shown card until the wider exit radius, so hovering on the edge never flickers", () => {
    let prev: number | null = null;
    const seen = [5.9, 6.1, 5.95, 6.4, 7.0, 6.2, 7.4].map((x) => (prev = activeBuoy(at(x), B, prev, null, 0)));
    expect(seen).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(activeBuoy(at(BUOY_CARD_EXIT_R + 0.1), B, 0, null, 0)).toBeNull();
  });

  it("does not open a card from the exit band", () => {
    expect(activeBuoy(at(7.0), B, null, null, 0)).toBeNull();
  });

  it("holds a scanned buoy's card from anywhere until the hold runs out", () => {
    const scan = { index: 2, until: 10 };
    expect(activeBuoy(at(20), B, null, scan, 9.9)).toBe(2);
    expect(activeBuoy(at(20), B, 2, scan, 10.1)).toBeNull();
    expect(BUOY_SCAN_HOLD_S).toBeGreaterThanOrEqual(3);
  });

  it("lets a buoy you fly up to replace a held scan", () => {
    expect(activeBuoy(at(41), B, null, { index: 2, until: 10 }, 5)).toBe(1);
  });

  it("finds each of the trail's real buoys", () => {
    BUOY_POSITIONS.forEach((p, i) => {
      expect(activeBuoy({ x: p[0], y: p[1] + 1, z: p[2] }, BUOY_POSITIONS, null, null, 0)).toBe(i);
    });
  });
});

describe("buoyIndex", () => {
  it("reads career_<n> ids of real buoys, and nothing else", () => {
    expect(buoyIndex("career_3")).toBe(3);
    expect(buoyIndex("career")).toBe(-1);
    expect(buoyIndex("asteroid_3")).toBe(-1);
    expect(buoyIndex(`career_${BUOYS.length}`)).toBe(-1);
  });
});
```

In `tests/scanReport.test.ts`, inside `describe("generateScanReport", …)` add:

```ts
  it("reports a career buoy's posting, oldest first", () => {
    expect(generateScanReport("career_0")).toMatch(/^SCAN\[CAREER_2015\] \/\/ FRONT-END DEVELOPER · SOFTWARESENI · JUN 2015 – JAN 2016 \/\/ /);
    expect(generateScanReport("career_4")).toContain("HUBEXO");
    expect(generateScanReport("career_4")).toContain("NOV 2020 – PRESENT");
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/buoyCard.test.ts tests/scanReport.test.ts`
Expected: FAIL. buoyCard fails with `Failed to resolve import "../src/utils/buoyCard"`. scanReport returns the generic `SCAN[CAREER_0] // …` line.

- [ ] **Step 3: The pure card logic and shared state**

Create `src/utils/buoyCard.ts`:

```ts
import { BUOYS, BUOY_CARD_R, type Vec3 } from "../data/careerTrail";

/** A card shown at BUOY_CARD_R stays up until this radius, so a ship hovering on the edge cannot flicker it. */
export const BUOY_CARD_EXIT_R = 7.5;
/** Seconds a scanned buoy's card stays up, from anywhere in scan range or beyond. */
export const BUOY_SCAN_HOLD_S = 6;

export interface ScanHold { index: number; until: number }

interface Point { x: number; y: number; z: number }
const dist = (s: Point, b: Vec3) => Math.hypot(s.x - b[0], s.y - b[1], s.z - b[2]);

/**
 * Which buoy's card to show (spec §2, "Buoy cards"), or null. A card already
 * up is kept until BUOY_CARD_EXIT_R. Otherwise the nearest buoy within
 * BUOY_CARD_R wins. Failing both, a recent scan is held until `scan.until`.
 * `now` is gameTime seconds, the clock Scanner stamps `until` with.
 */
export function activeBuoy(ship: Point, buoys: readonly Vec3[], prev: number | null, scan: ScanHold | null, now: number): number | null {
  if (prev !== null && buoys[prev] && dist(ship, buoys[prev]) < BUOY_CARD_EXIT_R) return prev;
  let best: number | null = null;
  let bestD = BUOY_CARD_R;
  for (let i = 0; i < buoys.length; i++) {
    const d = dist(ship, buoys[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best !== null) return best;
  return scan && now < scan.until ? scan.index : null;
}

/** The buoy index in a scannable id ("career_3" → 3), or -1 if it is not one. */
export function buoyIndex(id: string): number {
  const m = /^career_(\d+)$/.exec(id);
  const i = m ? Number(m[1]) : -1;
  return i >= 0 && i < BUOYS.length ? i : -1;
}

/**
 * Written by CareerTrail's frame loop (index) and Scanner (scan), read by the
 * HUD's BuoyCard rAF loop. Never React state, like waypointState, so the card
 * costs no renders during flight. index -1 = no card.
 */
export const buoyCardState: { index: number; scan: ScanHold | null } = { index: -1, scan: null };
```

- [ ] **Step 4: Buoy scan reports**

In `src/utils/scanReport.ts`, replace:

```ts
import { beaconRegistry, beaconReport } from "./beacons";
import { ghostRegistry, ghostReport } from "./liveSky";
```

with:

```ts
import { beaconRegistry, beaconReport } from "./beacons";
import { ghostRegistry, ghostReport } from "./liveSky";
import { BUOYS } from "../data/careerTrail";

/** One report per career buoy: the posting it marks, from src/data/career.ts. */
const BUOY_REPORTS = new Map(BUOYS.map((b) => [b.id,
  `SCAN[${b.label}] // ${b.entry.role} · ${b.entry.company} · ${b.entry.start} – ${b.entry.end ?? "Present"} // ${b.entry.summary}`.toUpperCase()]));
```

and replace:

```ts
  const table = PLANET_REPORTS[id];
  if (table) return table;
```

with:

```ts
  const buoy = BUOY_REPORTS.get(id);
  if (buoy) return buoy;
  const table = PLANET_REPORTS[id];
  if (table) return table;
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/buoyCard.test.ts tests/scanReport.test.ts`
Expected: PASS.

- [ ] **Step 6: The frame loop drives the card**

In `src/components/canvas/CareerTrail.tsx`, replace:

```ts
import { ambientTime } from "../../utils/ambientTime";
```

with:

```ts
import { ambientTime, gameTime } from "../../utils/ambientTime";
import { activeBuoy, buoyCardState } from "../../utils/buoyCard";
import { flight } from "../../store/spaceStore";
```

and replace:

```tsx
  useFrame((state) => {
    // Nav-light blink: a short full-strength flash about every 2.5 s. ambientTime
    // freezes under reduced motion, which leaves the glow steady.
    const phase = (ambientTime(state.clock.getElapsedTime()) * 0.4) % 1;
    material.emissiveIntensity = BUOY_GLOW * (phase < 0.12 ? 1 : 0.55);
  });
```

with:

```tsx
  useFrame((state) => {
    // Nav-light blink: a short full-strength flash about every 2.5 s. ambientTime
    // freezes under reduced motion, which leaves the glow steady.
    const phase = (ambientTime(state.clock.getElapsedTime()) * 0.4) % 1;
    material.emissiveIntensity = BUOY_GLOW * (phase < 0.12 ? 1 : 0.55);
    // Fly-by card (BuoyCard reads this). gameTime survives the clock reset an
    // orbit lock causes, and keeps running under reduced motion.
    const prev = buoyCardState.index >= 0 ? buoyCardState.index : null;
    const next = activeBuoy(flight, BUOY_POSITIONS, prev, buoyCardState.scan, gameTime(state.clock.getElapsedTime()));
    buoyCardState.index = next ?? -1;
  });
```

- [ ] **Step 7: A completed scan holds the buoy's card**

In `src/components/canvas/Scanner.tsx`, replace:

```ts
import { scanState } from "../../utils/scanState";
```

with:

```ts
import { scanState } from "../../utils/scanState";
import { gameTime } from "../../utils/ambientTime";
import { buoyCardState, buoyIndex, BUOY_SCAN_HOLD_S } from "../../utils/buoyCard";
```

Replace:

```ts
  useFrame((_, dt) => {
```

with:

```ts
  useFrame((state, dt) => {
```

Replace:

```ts
        if (near.id === "comet_visitor") store.recordBadge("comet"); // logbook: Comet chaser
```

with:

```ts
        if (near.id === "comet_visitor") store.recordBadge("comet"); // logbook: Comet chaser
        // A scanned career buoy keeps its HUD card up for a while (CareerTrail shows it).
        const buoy = buoyIndex(near.id);
        if (buoy >= 0) buoyCardState.scan = { index: buoy, until: gameTime(state.clock.getElapsedTime()) + BUOY_SCAN_HOLD_S };
```

- [ ] **Step 8: The DOM card**

Create `src/components/layout/BuoyCard.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { BUOYS, CAREER_AMBER } from "../../data/careerTrail";
import { buoyCardState } from "../../utils/buoyCard";
import { useSpaceStore } from "../../store/spaceStore";

/**
 * HUD card for the career buoy you are passing or just scanned: role,
 * company, dates and a one-line summary (spec §2). rAF + DOM writes, zero
 * renders, like WaypointMarker; text is rewritten only when the buoy changes.
 * Hidden from screen readers: the scan report (announced) and the Career
 * dossier carry the same text, and a second live region would compete with
 * the radio's.
 */
export default function BuoyCard() {
  const reducedMotion = useSpaceStore((s) => s.reducedMotion);
  const rootRef = useRef<HTMLDivElement>(null);
  const roleRef = useRef<HTMLDivElement>(null);
  const companyRef = useRef<HTMLSpanElement>(null);
  const datesRef = useRef<HTMLSpanElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    let shown = -2; // forces the first write, including after a remount
    const tick = () => {
      const i = buoyCardState.index;
      const root = rootRef.current;
      if (root && i !== shown) {
        shown = i;
        root.dataset.index = String(i);
        root.style.opacity = i >= 0 ? "1" : "0";
        const e = BUOYS[i]?.entry;
        if (e) {
          if (roleRef.current) roleRef.current.textContent = e.role;
          if (companyRef.current) companyRef.current.textContent = e.note ? `${e.company} (${e.note})` : e.company;
          if (datesRef.current) datesRef.current.textContent = `${e.start} – ${e.end ?? "Present"}`;
          if (summaryRef.current) summaryRef.current.textContent = e.summary;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={rootRef} data-testid="buoy-card" data-index="-1" aria-hidden="true"
      className={`absolute bottom-40 left-1/2 -translate-x-1/2 w-[min(92vw,26rem)] rounded-xl border bg-black/80 px-4 py-3 pointer-events-none ${reducedMotion ? "" : "transition-opacity duration-300"}`}
      style={{ borderColor: `${CAREER_AMBER}55`, opacity: 0 }}>
      <div className="text-[9px] tracking-widest mb-1" style={{ color: CAREER_AMBER }}>CAREER_BUOY</div>
      <div ref={roleRef} className="font-display font-bold text-sm text-white" />
      <div className="flex justify-between gap-3 text-[10px] text-white/70">
        <span ref={companyRef} />
        <span ref={datesRef} className="text-white/50 whitespace-nowrap" />
      </div>
      <div ref={summaryRef} className="text-[10px] text-white/60 truncate mt-1" />
    </div>
  );
}
```

In `src/components/layout/HUDOverlay.tsx`, add after `import ScanRing from "./ScanRing";`:

```ts
import BuoyCard from "./BuoyCard";
```

and replace:

```tsx
      {!isOrbitLocked && <ScanRing />}
```

with:

```tsx
      {!isOrbitLocked && <ScanRing />}
      {/* Frozen with the scene while docked, so hidden then too. */}
      {!isOrbitLocked && <BuoyCard />}
```

React would reset the card's inline opacity on re-render if it were a style prop React tracks. The `style` object here is static, so React does not touch it after mount. The rAF loop owns `opacity` from then on.

- [ ] **Step 9: Unit gates**

Run: `npm test && npx tsc -b && npm run lint`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/utils/buoyCard.ts src/components/layout/BuoyCard.tsx src/components/canvas/CareerTrail.tsx src/components/canvas/Scanner.tsx src/utils/scanReport.ts src/components/layout/HUDOverlay.tsx tests/buoyCard.test.ts tests/scanReport.test.ts
git commit -m "feat(career): buoy fly-by cards and buoy scan reports

Within 6 units (kept to 7.5, so the edge never flickers) or for 6 s after a
scan, a HUD card shows the posting. Frame-loop driven through module state,
no React renders.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end career probe

**Files:**
- Create: `tests/e2e/career.probe.mjs`
- Modify: `tests/e2e/run.mjs:6`

**Interfaces:**
- Consumes: key 4 / key 5 jumps, `[role="dialog"][aria-labelledby="career-dossier-title"]`, `[role="dialog"][aria-label="Contact"]`, `[data-testid="buoy-card"]` (`data-index`, `style.opacity`), scene node `HabitatRing`, `window.__fitz.teleport`, `window.__fitz.flight.input.scan`, and `BUOYS` from `/src/data/careerTrail.ts`.

- [ ] **Step 1: Write the probe**

Create `tests/e2e/career.probe.mjs`:

```js
import { withPage, settle, readStore, pollUntil } from "./harness.mjs";

/**
 * Career landmarks (docs/superpowers/specs/2026-10-15-career-landmarks-design.md):
 * key 4 docks at the career station and opens the Career dossier, key 5 still
 * reaches the contact portal, the habitat ring turns, flying to a buoy shows
 * its card, scanning one reports it, and none of it compiles a new shader
 * program. Physics waits use pollUntil: each read pumps frames under headless
 * SwiftShader (see harness.mjs settle()).
 */
const ready = (page) => page.waitForFunction(() => window.__fitz?.store.getState().sceneReady, { timeout: 60_000 });
const card = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="buoy-card"]');
  return el ? { index: Number(el.dataset.index), opacity: el.style.opacity, text: el.textContent ?? "" } : null;
});
const dockedAt = (page, zone) => pollUntil(async () => {
  const s = await readStore(page);
  return s.isOrbitLocked && s.activeZone === zone;
}, { timeoutMs: 15_000, intervalMs: 200 });

export default async function run() {
  return withPage({ label: "career" }, async (page, checks) => {
    await page.evaluate(() => ["fitz-logbook", "fitz-dossiers"].forEach((k) => localStorage.removeItem(k)));
    await page.reload();
    await ready(page);
    await settle(page, 3000);
    const programsBefore = await page.evaluate(() => window.__fitz.gl.info.programs.length);
    const trail = await page.evaluate(async () => {
      const m = await import("/src/data/careerTrail.ts");
      return m.BUOYS.map((b) => ({ id: b.id, pos: [...b.pos], company: b.entry.company }));
    });

    // [4] Career: jump, dock, dossier, essential.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press("Digit4");
    checks.check("key 4 jumps to the career station and docks", (await dockedAt(page, "career")).ok);
    await settle(page, 800);
    const dossier = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-labelledby="career-dossier-title"]');
      return d ? { text: d.textContent ?? "", focus: document.activeElement?.getAttribute("aria-label") ?? "" } : null;
    });
    checks.check("docking at the station opens the Career dialog", !!dossier);
    const missing = trail.filter((b) => !(dossier?.text ?? "").includes(b.company)).map((b) => b.company);
    checks.check("the Career dialog lists every role", missing.length === 0, missing.join(", "));
    checks.check("focus moves into the Career dialog", /career dossier/i.test(dossier?.focus ?? ""), dossier?.focus ?? "");
    const st = await readStore(page);
    checks.check("docking records the career essential", st.badges.some((b) => b.id === "career"), JSON.stringify(st.badges));
    await page.keyboard.press("Escape");
    await settle(page, 2500);
    checks.check("Esc closes the Career dialog", !(await readStore(page)).isOrbitLocked);

    // [5] Contact still works.
    await page.keyboard.press("Digit5");
    checks.check("key 5 jumps to the contact portal and docks", (await dockedAt(page, "contact")).ok);
    await settle(page, 800);
    checks.check("the contact portal still opens the contact form",
      await page.evaluate(() => !!document.querySelector('[role="dialog"][aria-label="Contact"]')));
    await page.keyboard.press("Escape");
    await settle(page, 2500);

    // The habitat ring turns (reduced motion is off in this probe).
    const ring = () => page.evaluate(() => {
      let r = null;
      window.__fitz.scene.traverse((o) => { if (r === null && o.name === "HabitatRing") r = o.rotation.y; });
      return r;
    });
    const r0 = await ring();
    for (let i = 0; i < 8; i++) { await settle(page, 200); await readStore(page); }
    const r1 = await ring();
    checks.check("the habitat ring turns", r0 !== null && r1 !== null && r0 !== r1, `${r0} -> ${r1}`);

    // A buoy's card shows nearby and hides when you leave.
    const b2 = trail[2];
    await page.evaluate((p) => { window.__fitz.teleport(p[0] + 2, p[1], p[2]); window.__fitz.setAttitude(0, 0); }, b2.pos);
    const shown = await pollUntil(async () => {
      const c = await card(page);
      return c && c.index === 2 && c.opacity === "1" ? c : null;
    }, { timeoutMs: 10_000, intervalMs: 200 });
    checks.check("flying to a buoy shows its card", shown.ok && shown.value.text.includes(b2.company), JSON.stringify(shown.value));
    await page.evaluate((p) => window.__fitz.teleport(p[0], p[1] + 30, p[2]), b2.pos);
    const hidden = await pollUntil(async () => {
      const c = await card(page);
      return c && c.index === -1 && c.opacity === "0" ? c : null;
    }, { timeoutMs: 10_000, intervalMs: 200 });
    checks.check("leaving a buoy hides its card", hidden.ok, JSON.stringify(await card(page)));

    // Scanning a buoy reports its posting and holds its card from scan range.
    const b3 = trail[3];
    await page.evaluate((p) => { window.__fitz.teleport(p[0], p[1] + 12, p[2]); window.__fitz.flight.input.scan = true; }, b3.pos);
    const report = await pollUntil(async () => {
      const t = (await readStore(page)).broadcast?.text ?? "";
      return t.startsWith("SCAN[CAREER_") ? t : null;
    }, { timeoutMs: 30_000, intervalMs: 300 });
    await page.evaluate(() => { window.__fitz.flight.input.scan = false; });
    checks.check("scanning a buoy reports its posting", report.ok && report.value.includes(b3.company.toUpperCase()),
      report.value ?? "no report");
    const held = await pollUntil(async () => ((await card(page))?.index === 3 ? true : null), { timeoutMs: 5_000, intervalMs: 200 });
    checks.check("a scanned buoy's card shows from scan range", held.ok, JSON.stringify(await card(page)));

    const programsAfter = await page.evaluate(() => window.__fitz.gl.info.programs.length);
    checks.check("the career landmarks compile no new shader program", programsAfter === programsBefore,
      `before=${programsBefore} after=${programsAfter}`);
  });
}
```

In `tests/e2e/run.mjs`, replace:

```js
  : ["smoke", "audio", "perf", "transition", "sky", "flight", "gameplay", "touch", "gamepad", "race", "beacons", "assets", "contact", "reducedmotion", "fuel", "reactions", "events", "mechanics", "logbook", "livesky", "programs", "basepath"];
```

with:

```js
  : ["smoke", "audio", "perf", "transition", "sky", "flight", "gameplay", "touch", "gamepad", "race", "beacons", "assets", "contact", "career", "reducedmotion", "fuel", "reactions", "events", "mechanics", "logbook", "livesky", "programs", "basepath"];
```

- [ ] **Step 2: Run it**

Make sure nothing you started is still listening on 5199: `lsof -ti tcp:5199 | xargs -r kill`. The harness starts its own server.

Run: `npm run test:e2e -- career`
Expected: every check passes, ending with `N/N checks passed`.

If "a scanned buoy's card shows from scan range" fails while the report check passes, the Scanner hold and CareerTrail clocks disagree. Check that both call `gameTime(state.clock.getElapsedTime())`, not `state.clock.elapsedTime`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/career.probe.mjs tests/e2e/run.mjs
git commit -m "test(e2e): career probe — dock at the station, key 5 still reaches contact, buoy cards and scans

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Gates, assets-src push, changelog and PR

**Files:**
- Modify: `src/data/changelog.ts` (new top entry)
- Create (throwaway): `<scratchpad>/pr-26-body.md`

**Interfaces:**
- Consumes: everything above, and the Task 6 Step 1 counters.

- [ ] **Step 1: Full unit gates**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 2: E2E probes**

Close every Playwright MCP tab. Stop any server you started on 5199, 5288 or 5290, by port only (`lsof -ti tcp:<port> | xargs -r kill`). Then:

Run: `npm run test:e2e -- assets programs perf smoke livesky transition contact career gamepad logbook`
Expected: all checks pass. `programs` shows `added=0` over a tour that now includes the career station and trail. `transition` stays inside every ceiling, deep-space programs equal the Task 6 Step 1 value, and the light count equals `LIGHT_BUDGET` (4). `perf` stays inside `docs/PERF-BUDGETS.md`.

- [ ] **Step 3: Check the numbers against the ceilings**

From the `transition` output, compare deep-space and close-approach calls, triangles and programs with the Task 6 Step 1 values and the ceilings (deep space 40 / 250 580 / 79). If programs rose, stop and report: a new material configuration slipped in. If a calls or triangles ceiling is exceeded, stop and report. Otherwise leave `docs/PERF-BUDGETS.md` alone.

- [ ] **Step 4: Push assets-src**

```bash
gh auth switch -u fitzfitz
git -C assets-src -c credential.helper= -c 'credential.helper=!gh auth git-credential' push
git -C assets-src status -sb
gh auth switch -u fitz-pro
```

Expected: the status line shows the branch with no `ahead`.

- [ ] **Step 5: Changelog entry**

Confirm the next free PR number: `gh pr list --state all --limit 1 --json number` (expect 25, so this PR is 26). At the top of `CHANGELOG` in `src/data/changelog.ts`, add the line below. Use the date you actually ship: it must be ≥ the newest entry's date, and the id must start with it.

```ts
  { id: "2026-10-15-career-landmarks", date: "2026-10-15", pr: 26, title: "Career Landmarks", what: "A career station now orbits below the sun: dock there to read every job in one dossier. Five amber buoys lead to it from the spawn pad, one per job, oldest first. Press 4 for Career, 5 for Contact.", why: "The work history only lived in the classic résumé, so a recruiter flying the site never saw it. Now it sits in the universe beside the projects.", how: "A small destination table replaced a dozen hard-coded contact checks, so the station is one row in it. Both models come from seeded Blender scripts, and the buoys are one instanced mesh, so nothing new is compiled." },
```

Run: `npx vitest run tests/changelog.test.ts`
Expected: PASS (title ≤ 4 words; what 197, why 144, how 214 characters, within 220 / 220 / 240; no PR gaps).

- [ ] **Step 6: Commit, push and open the PR**

Write `<scratchpad>/pr-26-body.md` covering:
- a summary of the destination table, listing each migrated consumer and the deliberate keeps;
- the station and trail placement, with the clearance numbers from Task 2;
- the two models' triangle counts, sizes and determinism result (from Task 3 Step 6);
- before/after renderer counters from Task 6 Step 1 and Task 9 Step 2;
- the e2e probe results;
- the pushed `assets-src` commit hash.

End the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

```bash
git add src/data/changelog.ts
git commit -m "docs(changelog): patch notes for career landmarks (#26)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
gh auth switch -u fitzfitz
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push -u origin feat/landmarks
gh pr create --title "Career landmarks: station, buoy trail and destination table" --body-file <scratchpad>/pr-26-body.md
gh auth switch -u fitz-pro
```

Do not merge: merging deploys to GitHub Pages and Cloudflare, and that is the user's call.
