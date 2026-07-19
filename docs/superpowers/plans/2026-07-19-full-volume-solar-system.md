# Full-Volume Solar System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the flat (y≈0, ±55 ceiling, auto-return) space portfolio into a full 3D volume: pitch flight with no safe-return, toroidal wrap on all three axes at ±250, sun at the exact center, planets on inclined living orbits, and stars/content filling the volume vertically and horizontally.

**Architecture:** Yaw+pitch spherical heading (pitch clamped ±83°, no quaternions); a pure `orbits.ts` module drives planet positions written once per frame into a shared mutable `bodies` telemetry (same pattern as `flight`); all proximity math becomes wrap-aware 3D; sky becomes ship-following spherical shells plus a wrapping near-field dust cube.

**Tech Stack:** React Three Fiber, three.js, zustand (mutable telemetry pattern), vitest, TypeScript, Vite.

**Spec:** `docs/superpowers/specs/2026-07-19-full-volume-solar-system-design.md`

## Global Constraints

- `COSMIC_BOUNDS = 250` wraps on **X, Y, and Z** (re-entry inset 3 units, teleport flash on any axis).
- Pitch clamp `PITCH_MAX = 1.45` rad (~83°); pitch rate 1.8 rad/s; **no auto-level, no ceiling, no drift home**.
- Keys keep bindings, change meaning: Space = pitch up, C/X = pitch down (`flight.input.ascend/descend` = pitch up/down).
- Planet orbits: saas r 115 / +20° / node 0°, video r 150 / −40° / node 120°, agent r 185 / +60° / node 240°; periods 420/510/600 s.
- `PORTAL_POS = [0, 95, -150]`.
- `altitudeWarn` fires at `|y| > 180` (ecliptic-departure flavor only).
- Sun light `distance` 260 → 450. Sun stays at origin.
- Low-perf mode skips: dust layer, polar halo band (in addition to existing gates).
- Test command: `npx vitest run` (all tests), `npx vitest run tests/<file>` (one file). Build check: `npm run build`.
- Every commit message ends with the standard co-author trailer used in this repo.

---

### Task 1: 3-axis toroidal math + wrap-aware scanner

**Files:**
- Modify: `src/utils/toroidal.ts`
- Modify: `src/utils/scannables.ts`
- Modify: `tests/toroidal3.test.ts`
- Create: `tests/scannables.test.ts`

**Interfaces:**
- Consumes: existing `wrapDelta(from, to, bounds)` (unchanged).
- Produces: `toroidalDistance3(ax, az, ay, bx, bz, by, bounds)` now wraps **all three axes** (argument order unchanged: x, z, y). `nearestScannable(x, y, z, range)` is wrap-aware. Callers (`DataShards`, `SpacePlanets`, `Scanner`) need no signature changes.

- [ ] **Step 1: Rewrite `tests/toroidal3.test.ts` to demand Y wrap**

Replace the whole file with:

```ts
import { describe, it, expect } from "vitest";
import { toroidalDistance3 } from "../src/utils/toroidal";

describe("toroidalDistance3", () => {
  it("equals planar distance when heights match", () => {
    expect(toroidalDistance3(0, 0, 5, 3, 4, 5, 250)).toBeCloseTo(5);
  });
  it("includes the vertical component", () => {
    expect(toroidalDistance3(0, 0, 0, 3, 4, 12, 250)).toBeCloseTo(13);
  });
  it("wraps horizontally like toroidalDistance", () => {
    expect(toroidalDistance3(-245, 0, 0, 245, 0, 0, 250)).toBeCloseTo(10);
  });
  it("wraps vertically at the same bounds", () => {
    // y = -245 and y = +245 are 10 apart through the seam
    expect(toroidalDistance3(0, 0, -245, 0, 0, 245, 250)).toBeCloseTo(10);
  });
  it("wraps all three axes at once", () => {
    // 6 through x-seam, 8 through y-seam -> 10
    expect(toroidalDistance3(-247, 0, -246, 247, 0, 246, 250)).toBeCloseTo(10);
  });
});
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `npx vitest run tests/toroidal3.test.ts`
Expected: FAIL — "wraps vertically" expects 10, receives 490.

- [ ] **Step 3: Make `toroidalDistance3` wrap Y**

In `src/utils/toroidal.ts` replace the `toroidalDistance3` function (keep `toroidalDistance` and `wrapDelta` untouched):

```ts
/** 3D distance on a 3-torus: every axis wraps at ±bounds. */
export function toroidalDistance3(
  ax: number, az: number, ay: number,
  bx: number, bz: number, by: number,
  bounds: number
): number {
  return Math.hypot(
    wrapDelta(ax, bx, bounds),
    wrapDelta(az, bz, bounds),
    wrapDelta(ay, by, bounds)
  );
}
```

- [ ] **Step 4: Run toroidal tests**

Run: `npx vitest run tests/toroidal3.test.ts tests/toroidal.test.ts tests/wrapDelta.test.ts`
Expected: PASS (all three files).

- [ ] **Step 5: Write failing test for wrap-aware scanner**

Create `tests/scannables.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { setScannable, nearestScannable, clearScannables } from "../src/utils/scannables";

describe("nearestScannable", () => {
  beforeEach(() => clearScannables());

  it("finds the nearest target in plain 3D", () => {
    setScannable("a", 10, 0, 0, "A");
    setScannable("b", 5, 0, 0, "B");
    expect(nearestScannable(0, 0, 0, 22)?.id).toBe("b");
  });
  it("returns null when nothing is in range", () => {
    setScannable("a", 100, 0, 0, "A");
    expect(nearestScannable(0, 0, 0, 22)).toBeNull();
  });
  it("sees targets across the wrap seam on any axis", () => {
    // ship at x=249, target at x=-249: 2 apart through the seam
    setScannable("seam", -249, 0, 0, "SEAM");
    expect(nearestScannable(249, 0, 0, 22)?.id).toBe("seam");
    clearScannables();
    // vertical seam
    setScannable("vseam", 0, -249, 0, "VSEAM");
    expect(nearestScannable(0, 249, 0, 22)?.id).toBe("vseam");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run tests/scannables.test.ts`
Expected: FAIL — seam cases return null (plain Euclidean distance is 498).

- [ ] **Step 7: Make `nearestScannable` wrap-aware**

Replace `src/utils/scannables.ts` content:

```ts
import { COSMIC_BOUNDS } from "../constants";
import { toroidalDistance3 } from "./toroidal";

export interface Scannable { x: number; y: number; z: number; label: string }
const registry = new Map<string, Scannable>();

export function setScannable(id: string, x: number, y: number, z: number, label: string) {
  const s = registry.get(id);
  if (s) { s.x = x; s.y = y; s.z = z; } else registry.set(id, { x, y, z, label });
}
export function removeScannable(id: string) { registry.delete(id); }
export function nearestScannable(x: number, y: number, z: number, range: number) {
  let best: { id: string; label: string; dist: number } | null = null;
  for (const [id, s] of registry) {
    const d = toroidalDistance3(x, z, y, s.x, s.z, s.y, COSMIC_BOUNDS);
    if (d < range && (!best || d < best.dist)) best = { id, label: s.label, dist: d };
  }
  return best;
}
export function clearScannables() { registry.clear(); } // tests
```

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: PASS (nothing else depends on the old Y-plain behavior — `DataShards` and `SpacePlanets` proximity simply gain Y wrap).

- [ ] **Step 9: Commit**

```bash
git add src/utils/toroidal.ts src/utils/scannables.ts tests/toroidal3.test.ts tests/scannables.test.ts
git commit -m "feat: 3-axis toroidal wrap math — toroidalDistance3 wraps Y, scanner sees across all seams"
```

---

### Task 2: pitchFlight module

**Files:**
- Create: `src/utils/pitchFlight.ts`
- Create: `tests/pitchFlight.test.ts`

**Interfaces:**
- Produces:
  - `PITCH_RATE = 1.8` (rad/s), `PITCH_MAX = 1.45` (rad)
  - `pitchStep(pitch: number, pitchVel: number, input: { up: boolean; down: boolean }, dt: number): { pitch: number; pitchVel: number }`
  - `noseDirection(yaw: number, pitch: number): { x: number; y: number; z: number }` — unit vector; yaw 0 & pitch 0 = +Z; positive pitch = +Y (nose up).
- Note: `verticalFlight.ts` is NOT deleted yet (RadarMap still imports `V_CEIL`); deletion happens in Task 6.

- [ ] **Step 1: Write the failing tests**

Create `tests/pitchFlight.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pitchStep, noseDirection, PITCH_MAX } from "../src/utils/pitchFlight";

const idle = { up: false, down: false };

describe("pitchStep", () => {
  it("pitch-up input raises pitch", () => {
    let s = { pitch: 0, pitchVel: 0 };
    for (let i = 0; i < 30; i++) s = pitchStep(s.pitch, s.pitchVel, { up: true, down: false }, 1 / 60);
    expect(s.pitch).toBeGreaterThan(0.1);
  });
  it("pitch-down input lowers pitch", () => {
    let s = { pitch: 0, pitchVel: 0 };
    for (let i = 0; i < 30; i++) s = pitchStep(s.pitch, s.pitchVel, { up: false, down: true }, 1 / 60);
    expect(s.pitch).toBeLessThan(-0.1);
  });
  it("clamps at ±PITCH_MAX and kills outward velocity", () => {
    let s = { pitch: 0, pitchVel: 0 };
    for (let i = 0; i < 600; i++) s = pitchStep(s.pitch, s.pitchVel, { up: true, down: false }, 1 / 60);
    expect(s.pitch).toBeLessThanOrEqual(PITCH_MAX + 1e-9);
    expect(s.pitchVel).toBeLessThanOrEqual(0 + 1e-9);
  });
  it("NO safe-return: idle pitch stays exactly where it was left", () => {
    let s = { pitch: 0.8, pitchVel: 0 };
    for (let i = 0; i < 600; i++) s = pitchStep(s.pitch, s.pitchVel, idle, 1 / 60);
    expect(s.pitch).toBeCloseTo(0.8, 5);
  });
  it("release decays pitch velocity toward zero", () => {
    let s = { pitch: 0, pitchVel: 1.8 };
    for (let i = 0; i < 120; i++) s = pitchStep(s.pitch, s.pitchVel, idle, 1 / 60);
    expect(Math.abs(s.pitchVel)).toBeLessThan(0.05);
  });
});

describe("noseDirection", () => {
  it("is always unit length", () => {
    for (const [yaw, pitch] of [[0, 0], [1.1, 0.7], [-2.4, -1.3], [Math.PI, 1.45]]) {
      const d = noseDirection(yaw, pitch);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
    }
  });
  it("level flight matches the old yaw heading convention (sin, 0, cos)", () => {
    const d = noseDirection(0.6, 0);
    expect(d.x).toBeCloseTo(Math.sin(0.6));
    expect(d.y).toBeCloseTo(0);
    expect(d.z).toBeCloseTo(Math.cos(0.6));
  });
  it("positive pitch points the nose up", () => {
    expect(noseDirection(0, 0.5).y).toBeCloseTo(Math.sin(0.5));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/pitchFlight.test.ts`
Expected: FAIL — cannot resolve `../src/utils/pitchFlight`.

- [ ] **Step 3: Implement the module**

Create `src/utils/pitchFlight.ts`:

```ts
export const PITCH_RATE = 1.8; // rad/s at full deflection
export const PITCH_MAX = 1.45; // ~83° — keeps the chase cam off the pole

export interface PitchInput { up: boolean; down: boolean }

/**
 * Pure pitch step, mirroring the yaw feel in Spaceship: eased attack toward
 * the full rate, eased release toward zero. NO auto-level, NO ceiling, NO
 * drift home — the nose stays wherever the pilot leaves it (spec §1).
 */
export function pitchStep(
  pitch: number,
  pitchVel: number,
  input: PitchInput,
  dt: number
): { pitch: number; pitchVel: number } {
  const frameLerp = (k: number) => 1 - Math.pow(1 - k, dt * 60);
  const target = input.up ? PITCH_RATE : input.down ? -PITCH_RATE : 0;
  pitchVel += (target - pitchVel) * (target !== 0 ? frameLerp(0.07) : frameLerp(0.12));
  pitch += pitchVel * dt;
  if (pitch > PITCH_MAX) { pitch = PITCH_MAX; pitchVel = Math.min(0, pitchVel); }
  else if (pitch < -PITCH_MAX) { pitch = -PITCH_MAX; pitchVel = Math.max(0, pitchVel); }
  return { pitch, pitchVel };
}

/** Spherical heading: yaw 0 / pitch 0 = +Z (matches the old sin/cos yaw convention). */
export function noseDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: Math.cos(yaw) * c };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/pitchFlight.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/pitchFlight.ts tests/pitchFlight.test.ts
git commit -m "feat: pitchFlight module — eased pitch with ±83° clamp, no safe-return, spherical noseDirection"
```

---

### Task 3: orbits module

**Files:**
- Create: `src/utils/orbits.ts`
- Create: `tests/orbits.test.ts`

**Interfaces:**
- Produces:
  - `interface OrbitalElements { radius: number; angularSpeed: number; inclination: number; node: number; phase: number }` (radians, rad/s)
  - `orbitPosition(el: OrbitalElements, t: number): { x: number; y: number; z: number }`
- Math convention (must match three.js group nesting used in Task 4): flat circle `(r·cosθ, 0, r·sinθ)` → rotate about X by `inclination` (`y1 = −z0·sin i`, `z1 = z0·cos i`) → rotate about Y by `node` (`x2 = x0·cos Ω + z1·sin Ω`, `z2 = −x0·sin Ω + z1·cos Ω`). These are three.js's standard `rotation.x` / `rotation.y` matrices, so a `<group rotation={[0, node, 0]}><group rotation={[inclination, 0, 0]}>` nesting renders the same circle.

- [ ] **Step 1: Write the failing tests**

Create `tests/orbits.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { orbitPosition, type OrbitalElements } from "../src/utils/orbits";

const base: OrbitalElements = { radius: 100, angularSpeed: 0.01, inclination: 0, node: 0, phase: 0 };

describe("orbitPosition", () => {
  it("stays exactly on the sphere of its radius (rotations preserve length)", () => {
    const el = { ...base, inclination: 1.0472, node: 4.1888, phase: 1.3 };
    for (const t of [0, 10, 100, 1000, 5000]) {
      const p = orbitPosition(el, t);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(100, 6);
    }
  });
  it("zero inclination keeps the orbit flat in XZ", () => {
    for (const t of [0, 50, 333]) {
      expect(orbitPosition(base, t).y).toBeCloseTo(0, 6);
    }
  });
  it("90° inclination puts the orbit in the XY plane (node 0)", () => {
    const el = { ...base, inclination: Math.PI / 2 };
    for (const t of [0, 50, 333]) {
      expect(orbitPosition(el, t).z).toBeCloseTo(0, 6);
    }
  });
  it("node rotates the inclined orbit about Y", () => {
    // i=0 so inclination is a no-op; node 90° maps (x0, 0, z0) -> (z0, 0, -x0)
    const el = { ...base, node: Math.PI / 2 };
    const flat = orbitPosition(base, 40);
    const spun = orbitPosition(el, 40);
    expect(spun.x).toBeCloseTo(flat.z, 6);
    expect(spun.z).toBeCloseTo(-flat.x, 6);
  });
  it("is periodic with period 2π/angularSpeed", () => {
    const el = { ...base, inclination: 0.35, node: 2.1, phase: 0.5 };
    const period = (Math.PI * 2) / el.angularSpeed;
    const a = orbitPosition(el, 12);
    const b = orbitPosition(el, 12 + period);
    expect(b.x).toBeCloseTo(a.x, 4);
    expect(b.y).toBeCloseTo(a.y, 4);
    expect(b.z).toBeCloseTo(a.z, 4);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/orbits.test.ts`
Expected: FAIL — cannot resolve `../src/utils/orbits`.

- [ ] **Step 3: Implement the module**

Create `src/utils/orbits.ts`:

```ts
/**
 * Circular inclined orbits around the origin (the sun).
 * Convention (matches three.js R_x / R_y and the ring-group nesting in
 * SpacePlanets): flat circle in XZ -> rotation.x = inclination -> rotation.y = node.
 */
export interface OrbitalElements {
  radius: number;
  /** rad/s */
  angularSpeed: number;
  /** rad, rotation about X applied to the flat circle */
  inclination: number;
  /** rad, ascending-node rotation about Y, applied after inclination */
  node: number;
  /** rad, starting angle along the circle */
  phase: number;
}

export function orbitPosition(el: OrbitalElements, t: number): { x: number; y: number; z: number } {
  const th = el.phase + t * el.angularSpeed;
  const x0 = el.radius * Math.cos(th);
  const z0 = el.radius * Math.sin(th);
  const ci = Math.cos(el.inclination), si = Math.sin(el.inclination);
  const y1 = -z0 * si;
  const z1 = z0 * ci;
  const cn = Math.cos(el.node), sn = Math.sin(el.node);
  return { x: x0 * cn + z1 * sn, y: y1, z: -x0 * sn + z1 * cn };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/orbits.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/orbits.ts tests/orbits.test.ts
git commit -m "feat: orbits module — inclined circular orbital elements around the origin"
```

---

### Task 4: Planets on rails — constants, bodies telemetry, moving SpacePlanets, live consumers

**Files:**
- Modify: `src/constants.ts` (PlanetData gains `orbit`, loses `pos`; `PORTAL_POS` moves)
- Modify: `src/store/spaceStore.ts` (add `bodies` telemetry)
- Modify: `src/components/canvas/SpacePlanets.tsx` (planets move; zone detection + scannables live; orbit rings)
- Modify: `src/components/canvas/Spaceship.tsx` (lock center tracks `bodies` — minimal edit, old flight model untouched)
- Modify: `src/components/layout/RadarMap.tsx` (targets read `bodies` live)
- Modify: `src/components/layout/HUDOverlay.tsx` (planet list reads `bodies` live)
- Modify: `tests/orbitInvariant.test.ts` (add moving-center safety invariant)

**Interfaces:**
- Consumes: `orbitPosition`, `OrbitalElements` from Task 3.
- Produces:
  - `constants.ts`: `PlanetData = { name: string; orbit: OrbitalElements; color: string; size: number }`; `PORTAL_POS: [0, 95, -150]`.
  - `spaceStore.ts`: `export const bodies: Record<string, { x: number; y: number; z: number }>` — keys `"saas" | "video" | "agent"`, initialized at `orbitPosition(p.orbit, 0)`, overwritten every frame by SpacePlanets. Later tasks (5, 6) read it.

- [ ] **Step 1: Add the moving-center invariant test (fails until constants change)**

Append to `tests/orbitInvariant.test.ts` (add the two imports to the existing import block):

```ts
import { planets, SHIP_MAX_SPEED } from "../src/constants";

describe("moving-center lock safety", () => {
  it("every planet's orbital speed is well below ship speed so lock tracking cannot be outrun", () => {
    for (const p of planets) {
      const orbitalSpeed = p.orbit.radius * p.orbit.angularSpeed;
      expect(orbitalSpeed).toBeLessThan(SHIP_MAX_SPEED / 4);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/orbitInvariant.test.ts`
Expected: FAIL — `p.orbit` is undefined (planets still have `pos`).

- [ ] **Step 3: Rewrite the planet table in `src/constants.ts`**

Replace the `PlanetData` interface and `planets` array (keep everything else — projects, factors, `COSMIC_BOUNDS`, `SHIP_MAX_SPEED`):

```ts
import type { OrbitalElements } from "./utils/orbits";

export interface PlanetData {
  name: string; orbit: OrbitalElements; color: string; size: number;
}
```

Replace `PORTAL_POS`:

```ts
// Off-plane destination: pilots must climb to reach the contact portal (spec §3).
export const PORTAL_POS: [number, number, number] = [0, 95, -150];
```

Replace the `planets` export:

```ts
// Inclined living orbits around the sun at origin (spec §3). Periods are
// minutes-slow: orbital speed stays ≪ ship speed so orbit-lock tracking is
// trivial (tests/orbitInvariant.test.ts).
export const planets: PlanetData[] = [
  {
    name: "saas", color: "#00ff87", size: 4.8,
    orbit: { radius: 115, angularSpeed: (Math.PI * 2) / 420, inclination: 0.3491, node: 0, phase: 0 },
  },
  {
    name: "video", color: "#00f0ff", size: 4.8,
    orbit: { radius: 150, angularSpeed: (Math.PI * 2) / 510, inclination: -0.6981, node: 2.0944, phase: 2.1 },
  },
  {
    name: "agent", color: "#bd00ff", size: 4.8,
    orbit: { radius: 185, angularSpeed: (Math.PI * 2) / 600, inclination: 1.0472, node: 4.1888, phase: 4.2 },
  },
];
```

- [ ] **Step 4: Add `bodies` telemetry to `src/store/spaceStore.ts`**

Directly below the `flight` export add:

```ts
import { planets } from "../constants";
import { orbitPosition } from "../utils/orbits";

/**
 * Live positions of orbiting bodies, written once per frame by SpacePlanets'
 * useFrame and read by Spaceship (lock center), RadarMap, HUD, and the
 * scannable registry. Mutable outside React — same pattern as `flight`.
 */
export const bodies: Record<string, { x: number; y: number; z: number }> = Object.fromEntries(
  planets.map((p) => [p.name, orbitPosition(p.orbit, 0)])
);
```

(Place the two imports at the top of the file with the existing imports. `constants.ts` imports only `utils/orbits`, which imports nothing — no cycle.)

- [ ] **Step 5: Run the invariant test**

Run: `npx vitest run tests/orbitInvariant.test.ts`
Expected: PASS. (`npm run build` would still fail — consumers of `p.pos` are fixed in the next steps.)

- [ ] **Step 6: Drive the planets in `SpacePlanets.tsx`**

All edits in `src/components/canvas/SpacePlanets.tsx`:

6a. Add imports:

```ts
import { orbitPosition } from "../../utils/orbits";
import { flight, useSpaceStore, bodies } from "../../store/spaceStore"; // bodies added to existing import
```

6b. Add three group refs next to the existing planet mesh refs:

```ts
const planetGroupRefs = useRef<(THREE.Group | null)[]>([null, null, null]);
```

6c. Replace the static scannable registration effect (the `useEffect` that registers planets once with the comment "positions never move") with portal-only registration — planets are registered live in the frame loop:

```ts
// Portal is static; planets are re-registered every frame (they orbit).
useEffect(() => {
  setScannable("contact", PORTAL_POS[0], PORTAL_POS[1], PORTAL_POS[2], "PORTAL_SUN");
}, []);
```

6d. At the top of the `useFrame` body (after `const time = ...`), drive orbits, groups, telemetry, and scannables:

```ts
// 0. Orbit drive: single writer of `bodies` (spec §3)
planets.forEach((p, i) => {
  const pos = orbitPosition(p.orbit, time);
  const b = bodies[p.name];
  b.x = pos.x; b.y = pos.y; b.z = pos.z;
  const g = planetGroupRefs.current[i];
  if (g) g.position.set(pos.x, pos.y, pos.z);
  setScannable(p.name, pos.x, pos.y, pos.z, "PLANET_" + p.name.toUpperCase());
});
```

6e. In the proximity block, replace each `toroidalDistance3(flight.x, flight.z, flight.y, p.pos[0], p.pos[2], p.pos[1], COSMIC_BOUNDS)` with:

```ts
const b = bodies[p.name];
const dist = toroidalDistance3(flight.x, flight.z, flight.y, b.x, b.z, b.y, COSMIC_BOUNDS);
```

6f. In the JSX, change each of the three planet wrapper groups from `<group position={planets[i].pos}>` to a ref'd group (position driven by the frame loop):

```tsx
<group ref={(g) => { planetGroupRefs.current[0] = g; }}>
```

(indices 1 and 2 for video and agent). The `Atmosphere` components receive `planetPos={planets[i].pos}` today — change that prop to the initial orbit position; check `Atmosphere.tsx`: if `planetPos` is used for sun-direction math it must read the group's world position instead. If `Atmosphere` only needs a static-ish direction hint, pass `bodies[planets[i].name]` as a mutable object IF the component reads it per frame; otherwise update `Atmosphere` to compute sun direction from its own world position each frame (it is a child of the moving group, so `getWorldPosition` is correct). Whichever is needed, the atmosphere must keep pointing its Rayleigh gradient at the origin as the planet moves.

6g. Add three orbit-ring visuals inside the root `<group>` (after the planet groups, before the portal). One per planet, nested to match `orbitPosition` convention:

```tsx
{/* Faint orbit architecture: one inclined ring per planet (spec §3) */}
{planets.map((p) => (
  <group key={`ring-${p.name}`} rotation={[0, p.orbit.node, 0]}>
    <group rotation={[p.orbit.inclination, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[p.orbit.radius - 0.15, p.orbit.radius + 0.15, 128]} />
        <meshBasicMaterial color={p.color} transparent={true} opacity={0.22}
          side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  </group>
))}
```

- [ ] **Step 7: Track the moving lock center in `Spaceship.tsx` (minimal edit)**

7a. Add `bodies` to the store import:

```ts
import { flight, useSpaceStore, bodies } from "../../store/spaceStore";
```

7b. In the lock-entry `useEffect`, replace `lockedCenter.current.set(...planet.pos)` with:

```ts
const b = bodies[planet.name];
lockedCenter.current.set(b.x, b.y, b.z);
```

7c. In the `isOrbitLocked` frame branch, re-read the live center each frame — insert at the top of the branch (before `orbitRadius.current += ...`):

```ts
// The locked body orbits the sun — ride along with it (spec §1).
const zone = store.activeZone;
const live = zone ? bodies[zone] : undefined;
if (live) lockedCenter.current.set(live.x, live.y, live.z);
```

(For `zone === "contact"` `bodies` has no entry, `live` is undefined, and the static portal center set at lock entry stands.)

- [ ] **Step 8: Live radar targets in `RadarMap.tsx`**

Replace the module-level `targets` array with a color/static lookup and read positions inside `draw`:

```ts
import { flight, useSpaceStore, bodies } from "../../store/spaceStore"; // bodies added

const PLANET_COLORS = planets.map((p) => ({ name: p.name, color: p.color }));
```

Inside `draw()`, replace the `for (const t of targets)` loop header with:

```ts
const targets = [
  ...PLANET_COLORS.map((p) => {
    const b = bodies[p.name];
    return { name: p.name, x: b.x, y: b.y, z: b.z, color: p.color };
  }),
  { name: "contact", x: PORTAL_POS[0], y: PORTAL_POS[1], z: PORTAL_POS[2], color: "#ec4899" },
  { name: "sun", x: 0, y: 0, z: 0, color: "#ff5500" },
];
for (const t of targets) {
```

(The `y` field is unused until Task 6 adds chevrons; including it now avoids touching this loop twice.)

- [ ] **Step 9: Live planet coordinates in `HUDOverlay.tsx`**

9a. Add `bodies` to the store import.

9b. Add a row-ref map next to `locRef`/`velRef`:

```ts
const planetRowRefs = useRef<Record<string, HTMLSpanElement | null>>({});
```

9c. In the existing rAF `tick`, after the velocity line, add:

```ts
for (const p of planets) {
  const el = planetRowRefs.current[p.name];
  const b = bodies[p.name];
  if (el && b) el.textContent =
    `PLANET_${p.name.toUpperCase()} ([${b.x.toFixed(0)}, ${b.y.toFixed(0)}, ${b.z.toFixed(0)}])`;
}
```

9d. In the sector-planets JSX, replace the static coordinate span:

```tsx
<span ref={(el) => { planetRowRefs.current[p.name] = el; }}>
  PLANET_{p.name.toUpperCase()}
</span>
```

- [ ] **Step 10: Verify build + suite**

Run: `npx vitest run && npm run build`
Expected: all tests PASS; `tsc -b && vite build` succeeds (this is the step that catches any remaining `p.pos` reader — grep to be sure):

Run: `grep -rn "\.pos\b" src/ --include="*.ts*" | grep -v "PORTAL_POS"`
Expected: no `planets`-related hits remain.

- [ ] **Step 11: Manual smoke check**

Run: `npm run dev` and load the page. Expected: three planets slowly orbiting on visibly tilted rings (green shallow, cyan tilted opposite, purple steep), portal high above the plane behind spawn, HUD sector list ticking live coordinates, radar blips tracking the moving planets, orbit-lock still engages when flying to a planet and the ship rides along with it. Stop the dev server.

- [ ] **Step 12: Commit**

```bash
git add src/constants.ts src/store/spaceStore.ts src/components/canvas/SpacePlanets.tsx src/components/canvas/Spaceship.tsx src/components/layout/RadarMap.tsx src/components/layout/HUDOverlay.tsx tests/orbitInvariant.test.ts
git commit -m "feat: planets on inclined living orbits — bodies telemetry, orbit rings, live lock/radar/HUD/scan tracking, portal raised to y=95"
```

---

### Task 5: Spaceship pitch flight — thrust follows the nose, 3-axis wrap, no safe-return

**Files:**
- Modify: `src/components/canvas/Spaceship.tsx`
- Modify: `src/store/spaceStore.ts` (add `flight.pitch`)
- Modify: `src/data/chatterLines.ts` (ecliptic-departure lines)

**Interfaces:**
- Consumes: `pitchStep`, `noseDirection`, `PITCH_MAX` from Task 2; `bodies` from Task 4.
- Produces: `flight.pitch` (rad, published every frame — Task 6's pitch ladder reads it). `flight.heading` stays pure yaw. `altitudeWarn` now means `|y| > 180`.

- [ ] **Step 1: Add `pitch` to the flight telemetry**

In `src/store/spaceStore.ts`, extend the `flight` object:

```ts
export const flight = {
  x: 0,
  z: 18,
  y: 0, // altitude, written by Spaceship each frame
  speed: 0, // world units / second
  heading: 0, // yaw in radians, written by Spaceship each frame
  pitch: 0, // nose pitch in radians (+up), written by Spaceship each frame
  input: { /* unchanged */ },
};
```

- [ ] **Step 2: Rework `Spaceship.tsx` — imports and refs**

2a. Replace the verticalFlight import:

```ts
// old: import { verticalStep, V_CEIL } from "../../utils/verticalFlight";
import { pitchStep, noseDirection } from "../../utils/pitchFlight";
```

2b. Replace the vertical-channel refs. Delete `const vy = useRef(0);` and `const lastVerticalInput = useRef(0);` and add:

```ts
const pitchVel = useRef(0); // rad/s — `pitch` ref (existing) is now flight state, not just visual
```

- [ ] **Step 3: Rework the free-flight physics block**

Replace the section from `// 2. Warp vs impulse` down to (and including) the `store.setAltitudeWarn(...)` line with:

```ts
// 2. Pitch channel: nose angle, eased like yaw. No auto-level, no ceiling —
// the nose and the ship stay wherever the pilot leaves them (spec §1).
const pRes = pitchStep(pitch.current, pitchVel.current,
  { up: input.ascend, down: input.descend }, dt);
pitch.current = pRes.pitch;
pitchVel.current = pRes.pitchVel;

// 3. Warp vs impulse along the nose direction. Touch thrust is analog.
// Briefly suppressed right after an impact so the reflected velocity can
// actually push the ship away instead of being overwritten by warp speed.
const warpActive = input.boost && time > warpSuppressUntil.current;
store.setWarping(warpActive);
const thrustInput = input.forward ? 1 : Math.max(0, input.thrust);
const braking = input.backward || input.thrust < -0.2;

const nose = noseDirection(angle.current, pitch.current);

if (warpActive) {
  vel.current.set(nose.x * WARP_SPEED, nose.y * WARP_SPEED, nose.z * WARP_SPEED);
} else if (thrustInput > 0) {
  vel.current.x += nose.x * ACCEL * thrustInput * dt;
  vel.current.y += nose.y * ACCEL * thrustInput * dt;
  vel.current.z += nose.z * ACCEL * thrustInput * dt;
  if (vel.current.length() > MAX_SPEED) vel.current.normalize().multiplyScalar(MAX_SPEED);
} else if (braking) {
  vel.current.multiplyScalar(Math.pow(BRAKE, dt * 60));
}
vel.current.multiplyScalar(Math.pow(SPACE_DRAG, dt * 60));

pos.current.addScaledVector(vel.current, dt);

// Ecliptic-departure advisory (flavor only — nothing pulls the ship back)
store.setAltitudeWarn(Math.abs(pos.current.y) > 180);
```

Notes for the implementer:
- The old `headingX/headingZ` locals are gone; nothing else referenced them.
- The old code moved x/z from `vel` and y from `vy` separately; now `addScaledVector` covers all three.
- Keep the old comment style; delete the "Vertical channel (pure step; ...)" block entirely.

- [ ] **Step 4: Visual pitch, collisions, wrap**

4a. The line `pitch.current = Math.sin(time * 2) * 0.03 + clamp(-vy...)` is deleted (pitch is now flight state). The ship rotation line becomes (note the sign — positive flight pitch = nose up = negative rotation.x, and the bob moves into the rotation expression):

```ts
shipRef.current.rotation.set(
  -pitch.current + Math.sin(time * 2) * 0.03,
  angle.current,
  roll.current,
  "YXZ"
);
```

4b. Collision loop: replace the `vy.current` velocity args with `vel.current.y`:

```ts
const hit = resolveCollision(
  pos.current.x, pos.current.y, pos.current.z,
  vel.current.x, vel.current.y, vel.current.z,
  c.x, c.y, c.z, c.r
);
if (hit) {
  pos.current.set(hit.px, hit.py, hit.pz);
  vel.current.set(hit.vx, hit.vy, hit.vz);
  ...
```

4c. Toroidal wrap — extend to Y (replace the whole wrap block):

```ts
// Toroidal boundary wrap — all three axes (spec §2)
const bounds = COSMIC_BOUNDS;
let wrapOffsetX = 0, wrapOffsetY = 0, wrapOffsetZ = 0, didWrap = false;
if (pos.current.x > bounds) { pos.current.x = -bounds + 3; wrapOffsetX = -bounds * 2 + 3; didWrap = true; }
else if (pos.current.x < -bounds) { pos.current.x = bounds - 3; wrapOffsetX = bounds * 2 - 3; didWrap = true; }
if (pos.current.y > bounds) { pos.current.y = -bounds + 3; wrapOffsetY = -bounds * 2 + 3; didWrap = true; }
else if (pos.current.y < -bounds) { pos.current.y = bounds - 3; wrapOffsetY = bounds * 2 - 3; didWrap = true; }
if (pos.current.z > bounds) { pos.current.z = -bounds + 3; wrapOffsetZ = -bounds * 2 + 3; didWrap = true; }
else if (pos.current.z < -bounds) { pos.current.z = bounds - 3; wrapOffsetZ = bounds * 2 - 3; didWrap = true; }
if (didWrap) {
  state.camera.position.x += wrapOffsetX;
  state.camera.position.y += wrapOffsetY;
  state.camera.position.z += wrapOffsetZ;
  store.triggerTeleportFlash();
}
```

- [ ] **Step 5: Chase cam behind the 3D nose**

Replace the body of `applyChaseCam` (keep the FOV part unchanged) — the offset now derives from the nose direction, and Y follows at the same rate as XZ (the vertical axis is as dynamic as the horizontal ones now):

```ts
const applyChaseCam = (warpActive: boolean) => {
  const camDistance = warpActive ? 6.8 : 4.8;
  const camHeight = warpActive ? 2.8 : 1.8;
  const targetFov = warpActive ? 86 : 60;
  const perspCam = state.camera as THREE.PerspectiveCamera;
  if (Math.abs(perspCam.fov - targetFov) > 0.01) {
    perspCam.fov = THREE.MathUtils.lerp(perspCam.fov, targetFov, frameLerp(0.1, dt));
    perspCam.updateProjectionMatrix();
  }
  const nose = noseDirection(angle.current, pitch.current);
  const targetCamPos = new THREE.Vector3(
    pos.current.x - nose.x * camDistance,
    pos.current.y - nose.y * camDistance + camHeight,
    pos.current.z - nose.z * camDistance
  );
  const f = frameLerp(0.05, dt);
  state.camera.position.lerp(targetCamPos, f);
  state.camera.lookAt(
    pos.current.x + nose.x * 1.5,
    pos.current.y + nose.y * 1.5 + 0.2,
    pos.current.z + nose.z * 1.5
  );
};
```

(PITCH_MAX = 83° keeps the view direction ≥7° away from world up, so `lookAt`'s default up vector never degenerates.)

- [ ] **Step 6: Orbit lock + escape push + telemetry**

6a. In the `isOrbitLocked` branch, replace `vy.current = 0;` with `pitchVel.current = 0;` and add pitch easing after the roll lerp:

```ts
pitch.current = THREE.MathUtils.lerp(pitch.current, 0, frameLerp(0.05, dt)); // level out in orbit
```

Also update the locked ship rotation line the same way as Step 4a (it currently sets rotation with no pitch component — give it `-pitch.current`):

```ts
shipRef.current.rotation.set(-pitch.current, angle.current, roll.current, "YXZ");
```

6b. Escape push in the lock-exit `useEffect` becomes 3D (the effect can't read the pitch ref before declaration order issues — it can, both are refs in component scope):

```ts
if (pos.current.length() > 0.5) {
  const d = noseDirection(angle.current, pitch.current);
  pos.current.add(new THREE.Vector3(-d.x * 2.8, -d.y * 2.8, -d.z * 2.8));
  vel.current.set(0, 0, 0);
}
```

6c. Telemetry publish (section 6) — replace the speed line and add pitch:

```ts
flight.speed = vel.current.length();
flight.heading = angle.current;
flight.pitch = pitch.current;
```

6d. In the photo-mode and orbit-locked early-return branches, also publish `flight.pitch = pitch.current;` next to the existing `flight.heading` writes (orbit branch) / `flight.y` writes (photo branch).

- [ ] **Step 7: Ecliptic chatter copy**

In `src/data/chatterLines.ts` replace the `altitude` array:

```ts
altitude: [
  "ECLIPTIC DEPARTURE LOGGED // MOST PILOTS NEVER SEE THE SYSTEM FROM OUTSIDE ITS PLANE",
  "NAV.AI: THE SUN IS THAT WAY. ROUGHLY. EVERYTHING IS ROUGHLY THAT WAY",
  "DEEP VOLUME ADVISORY // STARS IN EVERY DIRECTION. NO ROOF DETECTED",
],
```

- [ ] **Step 8: Verify**

Run: `npx vitest run && npm run build`
Expected: PASS + clean build. (`verticalFlight.ts` still exists and its test still passes — deletion is Task 6.)

- [ ] **Step 9: Manual smoke check**

Run: `npm run dev`. Verify: holding Space pitches the nose up and W climbs along it; the ship keeps its pitch when keys are released and NEVER drifts back to y=0; flying straight up past ±250 wraps with the teleport flash and re-enters from below; warp while pitched carves a 3D path; orbit-lock still levels out and rides the moving planet; near |y|=180 the ecliptic chatter fires once. Stop the server.

- [ ] **Step 10: Commit**

```bash
git add src/components/canvas/Spaceship.tsx src/store/spaceStore.ts src/data/chatterLines.ts
git commit -m "feat: pitch flight — thrust follows the nose, 3-axis toroidal wrap, safe-return removed, ecliptic advisory at |y|>180"
```

---

### Task 6: Radar chevrons + pitch ladder; delete verticalFlight

**Files:**
- Modify: `src/utils/radarTransform.ts` (add `altitudeCue`)
- Modify: `tests/radarTransform.test.ts`
- Modify: `src/components/layout/RadarMap.tsx`
- Delete: `src/utils/verticalFlight.ts`, `tests/verticalFlight.test.ts`

**Interfaces:**
- Consumes: `flight.pitch` (Task 5), live `targets` with `y` (Task 4), `wrapDelta`.
- Produces: `altitudeCue(dy: number): { dir: -1 | 0 | 1; alpha: number }` — `dir` 0 inside the ±6 dead band, otherwise sign of dy (+1 = target above); `alpha` ramps 0→1 as |dy| goes 6→80.

- [ ] **Step 1: Write failing tests for `altitudeCue`**

Append to `tests/radarTransform.test.ts`:

```ts
import { altitudeCue } from "../src/utils/radarTransform";

describe("altitudeCue", () => {
  it("dead band: no chevron within ±6 units", () => {
    expect(altitudeCue(0).dir).toBe(0);
    expect(altitudeCue(5.9).dir).toBe(0);
    expect(altitudeCue(-5.9).dir).toBe(0);
  });
  it("direction follows the sign of the delta", () => {
    expect(altitudeCue(30).dir).toBe(1);
    expect(altitudeCue(-30).dir).toBe(-1);
  });
  it("alpha ramps from 0 at the dead band to 1 at 80 units and clamps", () => {
    expect(altitudeCue(6).alpha).toBeCloseTo(0, 5);
    expect(altitudeCue(43).alpha).toBeCloseTo(0.5, 2);
    expect(altitudeCue(200).alpha).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/radarTransform.test.ts`
Expected: FAIL — `altitudeCue` is not exported.

- [ ] **Step 3: Implement `altitudeCue`**

Append to `src/utils/radarTransform.ts`:

```ts
/**
 * Relative-altitude chevron for a radar blip. Dead band ±6 (targets at the
 * ship's level get no chevron); alpha ramps linearly and saturates at 80.
 */
export function altitudeCue(dy: number): { dir: -1 | 0 | 1; alpha: number } {
  const mag = Math.abs(dy);
  if (mag < 6) return { dir: 0, alpha: 0 };
  return { dir: dy > 0 ? 1 : -1, alpha: Math.min(1, (mag - 6) / 74) };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/radarTransform.test.ts`
Expected: PASS.

- [ ] **Step 5: RadarMap — chevrons, pitch ladder, drop V_CEIL**

All edits in `src/components/layout/RadarMap.tsx`:

5a. Imports: remove `import { V_CEIL } from "../../utils/verticalFlight";`, extend the transform import:

```ts
import { worldToRadar, altitudeCue } from "../../utils/radarTransform";
```

5b. Bump `RANGE` for the wider system: `const RANGE = 160;`

5c. Inside the blip loop, after the blip `ctx.fill()` and before `ctx.globalAlpha = 1`, draw the chevron:

```ts
// Relative-altitude chevron: ▲ target above, ▼ below (Y-wrap aware)
const dy = wrapDelta(flight.y, t.y, COSMIC_BOUNDS);
const cue = altitudeCue(dy);
if (cue.dir !== 0) {
  ctx.globalAlpha = cue.alpha * (onRim ? 0.45 : 0.9);
  const by = c + py - cue.dir * 6; // apex offset from the blip
  ctx.beginPath();
  ctx.moveTo(c + px - 2.5, by + cue.dir * 2.5);
  ctx.lineTo(c + px, by);
  ctx.lineTo(c + px + 2.5, by + cue.dir * 2.5);
  ctx.closePath();
  ctx.fill();
}
```

5d. Replace the altitude bar block (everything from `// Altitude bar (right edge)` to the marker `ctx.fill()`) with a pitch ladder driven by `flight.pitch`:

```ts
// Pitch ladder (right edge): nose angle −90°…+90°, notch at level flight
const barX = SIZE - 7;
const barTop = 14;
const barH = SIZE - 28;
ctx.strokeStyle = "rgba(0,255,135,0.25)";
ctx.strokeRect(barX - 1.5, barTop, 3, barH);
ctx.beginPath(); // level-flight notch
ctx.moveTo(barX - 4, barTop + barH / 2);
ctx.lineTo(barX + 4, barTop + barH / 2);
ctx.stroke();
const pitchNorm = Math.max(-1, Math.min(1, flight.pitch / (Math.PI / 2)));
ctx.fillStyle = "#00ff87";
ctx.beginPath();
ctx.arc(barX, barTop + barH / 2 - pitchNorm * (barH / 2), 2.2, 0, Math.PI * 2);
ctx.fill();
```

- [ ] **Step 6: Delete the vertical-flight module**

```bash
rm src/utils/verticalFlight.ts tests/verticalFlight.test.ts
grep -rn "verticalFlight\|V_CEIL" src/ tests/
```

Expected: grep returns nothing.

- [ ] **Step 7: Verify**

Run: `npx vitest run && npm run build`
Expected: PASS + clean build.

- [ ] **Step 8: Manual smoke check**

Run: `npm run dev`. Verify: radar blips show ▲ when a planet is above you and ▼ when below (fly above the green ring and watch its chevron flip); the right-edge marker now follows your nose pitch, not your altitude. Stop the server.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: radar altitude chevrons + pitch ladder — verticalFlight module retired"
```

---

### Task 7: HUD + touch control relabels

**Files:**
- Modify: `src/components/layout/HUDOverlay.tsx`
- Modify: `src/components/layout/TouchControls.tsx`

**Interfaces:** none produced — copy changes only (`ascend`/`descend` inputs already mean pitch since Task 5).

- [ ] **Step 1: HUD legend**

In `HUDOverlay.tsx` instruction card, replace the ALTITUDE block:

```tsx
<div className="flex flex-col">
  <span className="text-white/25">PITCH</span>
  <span className="text-white">{isCoarse ? "PITCH ▲ / ▼" : "SPACE / C"}</span>
</div>
```

- [ ] **Step 2: Touch buttons**

In `TouchControls.tsx`, change the Rise button label text `▲ RISE` → `▲ PITCH` and the Dive button label `▼ DIVE` → `▼ PITCH`.

- [ ] **Step 3: Verify + commit**

Run: `npx vitest run && npm run build` — PASS.

```bash
git add src/components/layout/HUDOverlay.tsx src/components/layout/TouchControls.tsx
git commit -m "feat: HUD/touch copy — altitude controls relabeled as pitch"
```

---

### Task 8: Sky — spherical starfield, dust cube, off-plane nebulae/galaxies, billboard click plane

**Files:**
- Modify: `src/components/canvas/GlobalCanvas.tsx` (StarLayer distribution + follow, DustField, FollowingClickPlane)
- Modify: `src/components/canvas/SpacePlanets.tsx` (nebula positions)
- Modify: `src/components/canvas/DistantGalaxies.tsx` (repositioned + third galaxy)

**Interfaces:**
- Consumes: `flight` telemetry.
- Produces: nothing consumed later — visual layer.

- [ ] **Step 1: Spherical, ship-following star shells**

In `GlobalCanvas.tsx` `StarLayer`:

1a. Replace the position generation loop body (cylinder + y-slab) with a uniform spherical distribution:

```ts
for (let i = 0; i < count; i++) {
  // Uniform on the sphere: y = cos(polar) uniform in [-1, 1)
  const u = Math.random() * 2 - 1;
  const az = Math.random() * Math.PI * 2;
  const sr = Math.sqrt(1 - u * u);
  const radius = radiusMin + Math.random() * (radiusMax - radiusMin);
  posArr[i * 3] = sr * Math.cos(az) * radius;
  posArr[i * 3 + 1] = u * radius;
  posArr[i * 3 + 2] = sr * Math.sin(az) * radius;
  const rand = Math.random();
  if (rand < 0.75) colArr.set([1, 1, 1], i * 3);
  else if (rand < 0.9) colArr.set([0.72, 0.88, 1.0], i * 3);
  else colArr.set([1.0, 0.78, 0.58], i * 3);
}
```

1b. In `StarLayer`'s `useFrame`, make the shell ride with the ship (import `flight` from the store at the top of the file — `flight` is already imported in this file):

```ts
useFrame((state) => {
  if (!pointsRef.current) return;
  const time = state.clock.getElapsedTime();
  // The shells are the infinite sky: they translate with the ship (no positional
  // parallax — the DustField supplies that) and keep their slow rotation drift.
  pointsRef.current.position.set(flight.x, flight.y, flight.z);
  pointsRef.current.rotation.y = time * speed;
  if (twinkle) {
    const mat = pointsRef.current.material as THREE.PointsMaterial;
    mat.size = size + Math.sin(time * 2.5) * size * 0.3;
  }
});
```

- [ ] **Step 2: DustField near-parallax layer**

Add to `GlobalCanvas.tsx` (below `StarLayer`):

```tsx
const DUST_COUNT = 350;
const DUST_CUBE = 120;
const DUST_HALF = DUST_CUBE / 2;

/**
 * Near-field "dust" stars: world-anchored points wrapped modulo a cube that
 * rides with the ship — free parallax speed cues on every axis (spec §4).
 */
function DustField() {
  const pointsRef = useRef<THREE.Points>(null);
  const seeds = useMemo(() => {
    const a = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < a.length; i++) a[i] = Math.random() * DUST_CUBE;
    return a;
  }, []);
  const positions = useMemo(() => new Float32Array(DUST_COUNT * 3), []);

  useFrame(() => {
    if (!pointsRef.current) return;
    pointsRef.current.position.set(flight.x, flight.y, flight.z);
    const ship = [flight.x, flight.y, flight.z];
    const attr = pointsRef.current.geometry.attributes.position;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i++) {
      let d = (seeds[i] - ship[i % 3]) % DUST_CUBE;
      if (d < -DUST_HALF) d += DUST_CUBE;
      else if (d >= DUST_HALF) d -= DUST_CUBE;
      arr[i] = d;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]}
          count={DUST_COUNT} array={positions} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial color="#9fb4d8" size={0.05} transparent={true} opacity={0.5}
        blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}
```

Mount it in `GalaxyStarfield`, gated off in low-perf mode — `GalaxyStarfield` becomes:

```tsx
function GalaxyStarfield({ isLowPerf }: { isLowPerf: boolean }) {
  return (
    <>
      <StarLayer count={1300} radiusMin={140} radiusMax={260} size={0.04} opacity={0.35} speed={0.0015} />
      <StarLayer count={800} radiusMin={80} radiusMax={180} size={0.05} opacity={0.45} speed={-0.003} />
      <StarLayer count={400} radiusMin={40} radiusMax={120} size={0.07} opacity={0.6} speed={0.006} twinkle={true} />
      {!isLowPerf && <DustField />}
    </>
  );
}
```

and the usage in the canvas becomes `<GalaxyStarfield isLowPerf={isLowPerf} />`.

- [ ] **Step 3: Billboard click plane**

Replace `FollowingClickPlane`'s mesh orientation: remove the fixed `rotation={[-Math.PI / 2, 0, 0]}` and copy the camera quaternion each frame so the plane always faces the pilot:

```tsx
function FollowingClickPlane({ onSpawn }: { onSpawn: (p: THREE.Vector3) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    if (!ref.current) return;
    ref.current.position.set(flight.x, flight.y, flight.z);
    ref.current.quaternion.copy(camera.quaternion); // face the camera at any pitch
  });
  return (
    <mesh ref={ref}
      onPointerDown={(e) => { e.stopPropagation(); if (e.point) onSpawn(e.point.clone()); }}>
      <planeGeometry args={[180, 180]} />
      <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
```

- [ ] **Step 4: Nebulae + galaxies off-plane**

4a. In `SpacePlanets.tsx`, replace the five `NebulaCluster` positions:

```tsx
<NebulaCluster position={[120, 100, -120]} color="#bd00ff" size={35} opacity={0.038} />
<NebulaCluster position={[-130, -95, 110]} color="#00f0ff" size={40} opacity={0.038} />
<NebulaCluster position={[140, -30, 130]} color="#ec4899" size={45} opacity={0.035} />
<NebulaCluster position={[-120, 40, -140]} color="#00ff87" size={30} opacity={0.035} />
<NebulaCluster position={[0, 30, -180]} color="#ffa500" size={55} opacity={0.04} />
```

4b. In `DistantGalaxies.tsx`, replace the `GALAXIES` table:

```ts
const GALAXIES = [
  { pos: [180, 80, -160] as const, scale: 60, hue: 255, spin: 0.006 },
  { pos: [-200, -80, 120] as const, scale: 42, hue: 190, spin: -0.004 },
  { pos: [30, 210, -60] as const, scale: 50, hue: 320, spin: 0.005 }, // high above the pole
];
```

- [ ] **Step 5: Verify**

Run: `npx vitest run && npm run build` — PASS.
Run: `npm run dev`. Verify: pitch straight up — the sky above is as dense as the horizon (no empty pole, no slab edge); flying gives near-field dust streaming past on every axis; click-to-spawn plasma works while pitched steeply; a pink galaxy hangs high above the system. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add src/components/canvas/GlobalCanvas.tsx src/components/canvas/SpacePlanets.tsx src/components/canvas/DistantGalaxies.tsx
git commit -m "feat: full-sphere sky — spherical star shells follow the ship, wrapping dust cube, off-plane nebulae + polar galaxy, billboard click plane"
```

---

### Task 9: Belt tilt + polar halo, asteroid volume, sun light range

**Files:**
- Modify: `src/components/canvas/AsteroidBelt.tsx`
- Modify: `src/data/asteroids.ts`
- Modify: `src/components/canvas/Sun.tsx`

**Interfaces:**
- Produces: `ASTEROID_COLLIDERS` derives from the new table automatically (same export shape). No other contracts change.

- [ ] **Step 1: Parameterize the belt and add the polar halo**

Rewrite the bottom half of `AsteroidBelt.tsx`: extract the ring into an internal component and render two of them. Replace everything from `interface BeltRock` to the end of the file with:

```tsx
interface BeltRock {
  radius: number; y: number; speed: number; phase: number;
  spinX: number; spinY: number; scale: number;
}

interface BeltRingProps {
  geometry: THREE.BufferGeometry; material: THREE.Material;
  count: number; total: number; seed: number;
  rMin: number; rMax: number; yJitter: number;
  /** plane tilt about X (rad) */
  tilt: number;
}

function BeltRing({ geometry, material, count, total, seed, rMin, rMax, yJitter, tilt }: BeltRingProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const rocks = useMemo<BeltRock[]>(() => {
    const rand = mulberry32(seed);
    const span = rMax - rMin;
    return Array.from({ length: total }, () => {
      const radius = rMin + rand() * span;
      return {
        radius,
        y: (rand() - 0.5) * yJitter,
        // Kepler-ish: inner rocks orbit faster
        speed: 0.02 - ((radius - rMin) / span) * 0.012,
        phase: rand() * Math.PI * 2,
        spinX: 0.2 + rand() * 0.6,
        spinY: 0.2 + rand() * 0.6,
        scale: 0.05 + rand() * 0.17,
      };
    });
  }, [total, seed, rMin, rMax, yJitter]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.getElapsedTime();
    for (let i = 0; i < count; i++) {
      const r = rocks[i];
      const angle = r.phase + t * r.speed;
      dummy.position.set(Math.cos(angle) * r.radius, r.y, Math.sin(angle) * r.radius);
      dummy.rotation.set(r.phase + t * r.spinX, t * r.spinY, 0);
      dummy.scale.setScalar(r.scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group rotation={[tilt, 0, 0]}>
      <instancedMesh key={count} ref={meshRef} args={[geometry, material, count]}
        frustumCulled={false} dispose={null} />
    </group>
  );
}

const HALO_FULL = 160;

export default function AsteroidBelt() {
  const { scene } = useGLTF("/models/asteroids.glb");
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const count = isLowPerf ? COUNT_LOW : COUNT_FULL;

  const { geometry, material } = useMemo(() => {
    let src: THREE.Mesh | undefined;
    scene.traverse((c) => {
      if (!src && c instanceof THREE.Mesh && c.name.startsWith("Asteroid1")) src = c;
    });
    if (!src) throw new Error("asteroids.glb is missing mesh Asteroid1");
    src.updateMatrix();
    const g = src.geometry.clone();
    g.applyMatrix4(src.matrix);
    return { geometry: g, material: src.material as THREE.Material };
  }, [scene]);

  return (
    <>
      {/* Main belt: 25° inclined plane (spec §5) */}
      <BeltRing geometry={geometry} material={material} count={count} total={COUNT_FULL}
        seed={42} rMin={40} rMax={70} yJitter={5} tilt={0.436} />
      {/* Polar halo: sparse steep band crossing the main belt — climbing threads
          asteroid country. Skipped in low-perf mode. */}
      {!isLowPerf && (
        <BeltRing geometry={geometry} material={material} count={HALO_FULL} total={HALO_FULL}
          seed={1337} rMin={80} rMax={95} yJitter={9} tilt={1.31} />
      )}
    </>
  );
}
```

(`COUNT_FULL`, `COUNT_LOW`, `mulberry32`, `dummy` stay as they are at the top of the file.)

- [ ] **Step 2: Redistribute the scenery asteroid field through the volume**

Replace the `asteroidInstances` table in `src/data/asteroids.ts` (18 instances, y spread ±190, clear of spawn (0,0,18), the sun, and the portal at (0,95,−150); colliders derive automatically):

```ts
export const asteroidInstances: AsteroidData[] = [
  // Near-ecliptic band (familiar territory)
  { position: [-40, -5, -60], scale: 1.5, rotationSpeed: [0.08, 0.05, 0.03], initialRotation: [0.2, 0.5, 0.1], variant: 0 },
  { position: [60, 12, 70], scale: 2.2, rotationSpeed: [-0.05, 0.08, 0.04], initialRotation: [1.2, 0.2, 0.5], variant: 1 },
  { position: [-90, -18, -20], scale: 1.2, rotationSpeed: [0.04, -0.06, 0.08], initialRotation: [0.5, 1.1, 0.2], variant: 3 },
  { position: [80, 25, -120], scale: 2.8, rotationSpeed: [0.03, 0.04, -0.05], initialRotation: [0.8, 0.3, 0.9], variant: 2 },
  { position: [-160, 30, 20], scale: 3.5, rotationSpeed: [-0.04, 0.03, 0.06], initialRotation: [2.1, 0.4, 0.2], variant: 2 },
  { position: [110, -35, 120], scale: 1.8, rotationSpeed: [0.06, -0.08, 0.03], initialRotation: [0.4, 1.8, 0.6], variant: 0 },
  // Mid-altitude wanderers
  { position: [-30, 70, 140], scale: 2.0, rotationSpeed: [0.05, 0.05, -0.04], initialRotation: [0.9, 0.9, 0.1], variant: 1 },
  { position: [140, -75, 40], scale: 1.4, rotationSpeed: [-0.03, 0.04, 0.07], initialRotation: [1.5, 0.2, 1.2], variant: 3 },
  { position: [-70, 90, -170], scale: 2.5, rotationSpeed: [0.07, -0.03, 0.05], initialRotation: [0.1, 0.5, 1.8], variant: 0 },
  { position: [40, -95, -190], scale: 3.0, rotationSpeed: [-0.06, 0.06, -0.03], initialRotation: [0.5, 2.2, 0.4], variant: 2 },
  { position: [-200, 60, -80], scale: 2.4, rotationSpeed: [0.04, 0.05, 0.08], initialRotation: [1.8, 0.1, 0.5], variant: 3 },
  { position: [210, -50, -30], scale: 1.6, rotationSpeed: [-0.05, -0.04, 0.05], initialRotation: [0.3, 0.8, 1.1], variant: 1 },
  // Deep-volume sentinels (high above / far below the ecliptic)
  { position: [70, 150, 90], scale: 2.6, rotationSpeed: [0.05, -0.04, 0.06], initialRotation: [0.7, 1.4, 0.3], variant: 0 },
  { position: [-120, 165, 60], scale: 1.9, rotationSpeed: [-0.04, 0.06, 0.03], initialRotation: [1.1, 0.6, 0.8], variant: 2 },
  { position: [90, 185, -60], scale: 3.2, rotationSpeed: [0.03, 0.05, -0.06], initialRotation: [0.2, 1.9, 1.4], variant: 3 },
  { position: [-60, -155, -110], scale: 2.3, rotationSpeed: [0.06, 0.04, 0.05], initialRotation: [1.6, 0.3, 0.7], variant: 1 },
  { position: [150, -170, 130], scale: 2.7, rotationSpeed: [-0.05, 0.03, 0.04], initialRotation: [0.9, 1.2, 0.5], variant: 0 },
  { position: [-40, -190, 80], scale: 1.7, rotationSpeed: [0.04, -0.05, 0.07], initialRotation: [2.0, 0.8, 1.0], variant: 2 },
];
```

- [ ] **Step 3: Sun light reaches the corners**

In `src/components/canvas/Sun.tsx`, change the point light:

```tsx
<pointLight color="#ffffff" intensity={4.8} distance={450} decay={0.8} castShadow={true} />
```

- [ ] **Step 4: Verify**

Run: `npx vitest run && npm run build` — PASS.
Run: `npm run dev`. Verify: main belt visibly tilted; a steep sparse ring crosses it; asteroids appear when flying high/deep and colliding with one still bumps the ship (fly into the one at [70, 150, 90]); high-altitude asteroids are still sunlit. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/AsteroidBelt.tsx src/data/asteroids.ts src/components/canvas/Sun.tsx
git commit -m "feat: volumetric rock — 25° belt + 75° polar halo, 18 asteroids through ±190y, sun light range 450"
```

---

### Task 10: 3D cargo lanes + true inclined comet orbits

**Files:**
- Modify: `src/components/canvas/CargoTraffic.tsx`
- Modify: `src/utils/kepler.ts`
- Modify: `tests/kepler.test.ts`
- Modify: `src/components/canvas/Comets.tsx`

**Interfaces:**
- Produces: `CometOrbit` gains `inclination` + `node` (rad), loses `tilt`. `keplerPosition(tSeconds, o)` signature unchanged.

- [ ] **Step 1: Rewrite `tests/kepler.test.ts` for true elements**

Replace the file:

```ts
import { describe, it, expect } from "vitest";
import { keplerPosition, type CometOrbit } from "../src/utils/kepler";

const flat: CometOrbit = { a: 140, e: 0.62, periodSeconds: 380, phase: 0, inclination: 0, node: 0 };

const dist = (p: { x: number; y: number; z: number }) => Math.hypot(p.x, p.y, p.z);

describe("keplerPosition", () => {
  it("starts at perihelion: closest approach a(1-e)", () => {
    expect(dist(keplerPosition(0, flat))).toBeCloseTo(140 * (1 - 0.62), 1);
  });
  it("reaches aphelion a(1+e) at half period", () => {
    expect(dist(keplerPosition(190, flat))).toBeCloseTo(140 * (1 + 0.62), 0);
  });
  it("is periodic", () => {
    const p0 = keplerPosition(0, flat);
    const p1 = keplerPosition(380, flat);
    expect(p1.x).toBeCloseTo(p0.x, 1);
    expect(p1.z).toBeCloseTo(p0.z, 1);
  });
  it("moves much faster at perihelion than aphelion (Kepler's second law)", () => {
    const d = (t: number) => {
      const a = keplerPosition(t, flat);
      const b = keplerPosition(t + 1, flat);
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    };
    expect(d(0)).toBeGreaterThan(d(190) * 3);
  });
  it("rotations preserve heliocentric distance", () => {
    const steep = { ...flat, inclination: 1.1, node: 2.4 };
    for (const t of [0, 60, 190, 300]) {
      expect(dist(keplerPosition(t, steep))).toBeCloseTo(dist(keplerPosition(t, flat)), 6);
    }
  });
  it("90° inclination with node 0 puts the orbit in the XY plane", () => {
    const polar = { ...flat, inclination: Math.PI / 2 };
    for (const t of [30, 100, 250]) {
      expect(keplerPosition(t, polar).z).toBeCloseTo(0, 6);
    }
  });
  it("node rotates the flat orbit about Y", () => {
    const spun = { ...flat, node: Math.PI / 2 };
    const a = keplerPosition(60, flat);
    const b = keplerPosition(60, spun);
    expect(b.x).toBeCloseTo(a.z, 6);
    expect(b.z).toBeCloseTo(-a.x, 6);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/kepler.test.ts`
Expected: FAIL — `inclination`/`node` not in `CometOrbit` (type error) / `tilt` missing.

- [ ] **Step 3: Upgrade `src/utils/kepler.ts`**

Replace the file (same inclination/node convention as `orbits.ts`):

```ts
export interface CometOrbit {
  /** semi-major axis (world units) */
  a: number;
  /** eccentricity 0..<1 — higher = more dramatic slingshot */
  e: number;
  periodSeconds: number;
  /** mean-anomaly offset (radians) so comets don't sync up */
  phase: number;
  /** orbital-plane inclination (rad, rotation about X — same convention as utils/orbits.ts) */
  inclination: number;
  /** ascending-node rotation (rad, about Y, applied after inclination) */
  node: number;
}

/**
 * Keplerian orbit position with the sun at the FOCUS (origin): the body
 * whips past perihelion and crawls at aphelion, per Kepler's second law.
 * Solves Kepler's equation E - e·sinE = M with a few Newton iterations,
 * then rotates the in-plane ellipse by inclination and node.
 */
export function keplerPosition(
  tSeconds: number,
  o: CometOrbit
): { x: number; y: number; z: number } {
  const M = ((tSeconds / o.periodSeconds) * Math.PI * 2 + o.phase) % (Math.PI * 2);
  let E = M;
  for (let i = 0; i < 5; i++) {
    E -= (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
  }
  const x0 = o.a * (Math.cos(E) - o.e);
  const z0 = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  const ci = Math.cos(o.inclination), si = Math.sin(o.inclination);
  const y1 = -z0 * si;
  const z1 = z0 * ci;
  const cn = Math.cos(o.node), sn = Math.sin(o.node);
  return { x: x0 * cn + z1 * sn, y: y1, z: -x0 * sn + z1 * cn };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/kepler.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Steep comet orbits + 3D proximity in `Comets.tsx`**

5a. Replace the `COMETS` table:

```ts
const COMETS = [
  { a: 140, e: 0.62, periodSeconds: 170, phase: 0, inclination: 0.9, node: 0.6 },   // ~52° diver
  { a: 155, e: 0.65, periodSeconds: 260, phase: 2.1, inclination: -1.15, node: 2.4 }, // ~66° retrograde-feel
];
```

5b. Replace the xz-only near check (and its "out of scope" comment — vertical reactions are now IN scope):

```ts
// Full 3D proximity — comets dive through the ecliptic now (spec §5)
const dx = head.x - flight.x;
const dy = head.y - flight.y;
const dz = head.z - flight.z;
if (dx * dx + dy * dy + dz * dz < 3600) anyNear = true;
```

- [ ] **Step 6: 3D cargo lanes + spherical proximity in `CargoTraffic.tsx`**

6a. Replace `ROUTES`:

```ts
// Three trade loops threading the volume: a climbing run (−80 → +110 with a
// return dive), a belt-gap weaver, and a high ring at portal altitude (spec §5).
const ROUTES = [
  [v(-110, -80, 80), v(-20, -30, 150), v(130, 20, -40), v(30, 65, -170), v(-140, 110, -70)],
  [v(150, -40, 60), v(60, 10, 180), v(-160, -25, 140), v(-90, 30, -30), v(40, -10, -120)],
  [v(0, 95, -200), v(170, 80, -100), v(200, 60, 80), v(0, 110, 120), v(-190, 90, -20)],
].map((pts) => new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5));
```

6b. Make the player-proximity dodge spherical:

```ts
const dx = ship.group.position.x - flight.x;
const dy = ship.group.position.y - flight.y;
const dz = ship.group.position.z - flight.z;
if (dx * dx + dy * dy + dz * dz < 144) targetRoll += Math.sign(dx || 1) * 0.35;
```

- [ ] **Step 7: Verify**

Run: `npx vitest run && npm run build` — PASS.
Run: `npm run dev`. Verify: comets slice through the system at steep angles with tails still anti-sunward; cargo ships climb and dive along their loops (watch one near the portal altitude); flying under a cargo ship no longer triggers its dodge roll when it's 50 units above you. Stop the server.

- [ ] **Step 8: Commit**

```bash
git add src/components/canvas/CargoTraffic.tsx src/utils/kepler.ts tests/kepler.test.ts src/components/canvas/Comets.tsx
git commit -m "feat: 3D traffic + steep comets — kepler true inclination/node elements, volumetric cargo loops, spherical proximity"
```

---

### Task 11: Shards + jellyfish through the volume

**Files:**
- Modify: `src/data/shards.ts`
- Modify: `src/data/jellyfishPath.ts`
- Modify: `tests/jellyfishPath.test.ts`

**Interfaces:** none change — data only (`JELLY_NEAR_T` value updates).

- [ ] **Step 1: Redistribute the shards**

Replace the `SHARDS` positions (facts unchanged — position each shard to match its fact's flavor):

```ts
export const SHARDS: Shard[] = [
  // Near spawn — easy first find
  { pos: [8, 1, 22], fact: "DATA_SHARD 1/10 // WELCOME, PILOT. THIS PORTFOLIO IS ALSO A FLIGHT SIM. NO REFUNDS" },
  // On the saas orbit ring, ahead of the planet's start position
  { pos: [80, -28, 75], fact: "DATA_SHARD 2/10 // THE PILOT SHIPS SCHEMA-ISOLATED TENANTS BEFORE BREAKFAST — 15,000 SUBSCRIPTIONS, ZERO CROSS-TALK" },
  // High above the sun (fact says so)
  { pos: [0, 140, 0], fact: "DATA_SHARD 3/10 // STRIPE CONNECT SPLITS FEES IN REAL TIME. THE PILOT SPLITS ATOMS. KIDDING. MOSTLY" },
  // High cluster, near the video orbit's upper reach
  { pos: [-95, 120, 60], fact: "DATA_SHARD 4/10 // WHISPER TRANSCRIBES EVERY FRAME. THE AI VIRAL-VIDEO PIPELINE NEVER SLEEPS, NEVER COMPLAINS" },
  // Deep below (fact says so)
  { pos: [6, -140, -10], fact: "DATA_SHARD 5/10 // DOWN HERE IT'S DARK, COLD, AND FULL OF UNIT TESTS" },
  // Deep cluster, far side
  { pos: [-110, -135, -90], fact: "DATA_SHARD 6/10 // 3 AI CODE REVIEWERS APPROVED THIS UNIVERSE. A FOURTH IS STILL THINKING" },
  // Near the sun
  { pos: [4, 4, 8], fact: "DATA_SHARD 7/10 // THE MULTI-AGENT TDD FRAMEWORK WRITES THE FAILING TEST FIRST. SO DOES THIS SENTENCE" },
  // Beside the portal — reward for the climb
  { pos: [10, 98, -140], fact: "DATA_SHARD 8/10 // ASTEROIDS DO NOT HAVE STANDUPS. THE PILOT ENVIES THIS" },
  // Far corner, high
  { pos: [190, 90, -160], fact: "DATA_SHARD 9/10 // YOU HAVE TRAVELED FAR FOR A JPEG OF A RESUME. RESPECT" },
  // Final shard — near spawn, hints at completion
  { pos: [-8, 1, 20], fact: "DATA_SHARD 10/10 // ALL SHARDS FOUND. THE PILOT IS IMPRESSED AND SLIGHTLY CONCERNED ABOUT YOUR FREE TIME" },
];
```

- [ ] **Step 2: Rewrite the jellyfish path test in 3D**

Replace `tests/jellyfishPath.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { JELLY_PATH, JELLY_NEAR_T } from "../src/data/jellyfishPath";

describe("jellyfish path", () => {
  it("NEAR_T is a genuine near pass (within 80 units of the play-area center, 3D)", () => {
    const p = JELLY_PATH.getPointAt(JELLY_NEAR_T);
    expect(p.length()).toBeLessThan(80);
  });
  it("NEAR_T is the true closest approach (no sampled point is meaningfully closer)", () => {
    const near = JELLY_PATH.getPointAt(JELLY_NEAR_T).length();
    for (let i = 0; i < 500; i++) {
      expect(JELLY_PATH.getPointAt(i / 500).length()).toBeGreaterThan(near - 2);
    }
  });
  it("most of the loop stays far away (rare-sighting behavior)", () => {
    let far = 0;
    for (let i = 0; i < 100; i++) {
      if (JELLY_PATH.getPointAt(i / 100).length() > 150) far++;
    }
    expect(far).toBeGreaterThan(70);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/jellyfishPath.test.ts`
Expected: the "true closest approach" case likely FAILS against the old path/constant (and must pass against the new ones).

- [ ] **Step 4: Stretch the path vertically and recompute `JELLY_NEAR_T`**

4a. Update `src/data/jellyfishPath.ts` control points:

```ts
export const JELLY_PATH = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(300, 120, 0),
    new THREE.Vector3(30, 40, 70),
    new THREE.Vector3(-320, -60, 120),
    new THREE.Vector3(-120, 90, -300),
    new THREE.Vector3(120, -20, -140),
  ],
  true,
  "catmullrom",
  0.6
);
```

4b. Recompute the closest-approach phase numerically:

```bash
node --input-type=module -e "
import { CatmullRomCurve3, Vector3 } from 'three';
const path = new CatmullRomCurve3([
  new Vector3(300, 120, 0), new Vector3(30, 40, 70), new Vector3(-320, -60, 120),
  new Vector3(-120, 90, -300), new Vector3(120, -20, -140),
], true, 'catmullrom', 0.6);
let best = 0, bestD = Infinity;
for (let i = 0; i <= 5000; i++) {
  const t = i / 5000;
  const d = path.getPointAt(t).length();
  if (d < bestD) { bestD = d; best = t; }
}
console.log('JELLY_NEAR_T =', best.toFixed(4), 'dist =', bestD.toFixed(1));
"
```

4c. Write the printed value into `jellyfishPath.ts` and update its comment:

```ts
export const JELLY_LOOP_SECONDS = 400;
/** Numerically computed closest-approach phase (3D distance — see plan Task 11 step 4b). */
export const JELLY_NEAR_T = <printed value>;
```

If the printed `dist` is ≥ 80, nudge the second control point toward the origin (e.g. `(30, 30, 55)`) and re-run 4b until dist < 80.

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/jellyfishPath.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Verify + manual check**

Run: `npx vitest run && npm run build` — PASS.
Run: `npm run dev`. Verify: shard counter still shows collected shards from localStorage; fly up to (0, 140, 0) and collect shard 3; press J and watch the jellyfish ride a visibly climbing/diving path. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add src/data/shards.ts src/data/jellyfishPath.ts tests/jellyfishPath.test.ts
git commit -m "feat: collectibles through the volume — high/deep shard clusters, vertically stretched jellyfish path with 3D near-pass"
```

---

### Task 12: Plasma bounds, final sweep, full verification

**Files:**
- Modify: `src/components/canvas/PlasmaAnomalies.tsx`
- Verify: everything.

- [ ] **Step 1: 3D plasma reflection box**

In `PlasmaAnomalies.tsx`, replace the boundary-reflection block (`const limit = 26;` and the two `if` clauses) with:

```ts
// Boundary reflection: a roomy 3D box around the play space (spec §5)
const limit = 60;
if (Math.abs(nextPos.x) >= limit) {
  nextPos.x = Math.sign(nextPos.x) * limit;
  nextVel.x = -nextVel.x * 0.8;
}
if (Math.abs(nextPos.y) >= limit) {
  nextPos.y = Math.sign(nextPos.y) * limit;
  nextVel.y = -nextVel.y * 0.8;
}
if (Math.abs(nextPos.z) >= limit) {
  nextPos.z = Math.sign(nextPos.z) * limit;
  nextVel.z = -nextVel.z * 0.8;
}
```

- [ ] **Step 2: Stale-reference sweep**

```bash
grep -rn "verticalFlight\|V_CEIL\|autoLevel\|verticalStep" src/ tests/
grep -rn "\btilt\b" src/utils/kepler.ts src/components/canvas/Comets.tsx
grep -rn "planets\[.\]\.pos\|p\.pos\[" src/
```

Expected: all three greps return nothing. Fix anything that appears.

- [ ] **Step 3: Full suite + build**

Run: `npx vitest run`
Expected: all test files pass (including the rewritten toroidal3, kepler, radarTransform, jellyfishPath, orbitInvariant and new pitchFlight, orbits, scannables).

Run: `npm run build`
Expected: clean `tsc -b && vite build`.

- [ ] **Step 4: Full manual flight verification**

Run: `npm run dev` and fly the checklist:
1. Spawn: sun dead ahead at the center, three tilted orbit rings visible, portal glow high above the horizon behind the sun.
2. Hold Space + W: climb steeply; release everything — the ship stays put at altitude (no drift home). Nose stays pitched.
3. Warp straight up: teleport flash at y=250, re-enter from below, stars equally dense the whole way.
4. Fly to the green planet, enter orbit lock: ship levels, rides the moving planet; project panel opens; break orbit — 3D escape push.
5. Radar: green blip chevron flips ▲/▼ as you pass the planet's altitude; right-edge marker follows nose pitch.
6. Climb to the portal (y≈95): contact zone engages; shard 8 beside it.
7. |y| > 180: ecliptic chatter line appears once.
8. Watch a comet dive through the ecliptic; cargo ships climbing/diving; jellyfish (J) on its stretched path; belt tilted with the steep halo crossing it.
9. Toggle LOW_PERF: dust layer and polar halo disappear, everything still works.
10. Photo mode (if bound): planets keep orbiting while the ship idles.

- [ ] **Step 5: Commit**

```bash
git add src/components/canvas/PlasmaAnomalies.tsx
git commit -m "feat: 3D plasma bounds + full-volume verification sweep"
```

---

## Self-Review Notes

- **Spec coverage:** §1 flight → Tasks 2, 5; §2 topology → Tasks 1, 5; §3 living system → Tasks 3, 4 (sun light range in Task 9); §4 sky → Task 8; §5 content → Tasks 9, 10, 11, 12; §6 HUD/radar/touch → Tasks 4 (live coords), 6, 7; §7 placement tables → Tasks 8, 9, 11; §8 edge cases → encoded in Tasks 5 (clamp, wrap), 4 (moving lock); §9 tests → distributed per task; §10 deletions → Tasks 5, 6, 12 sweep.
- **Ordering:** Task 4 must precede Task 5 (Spaceship reads `bodies`); Task 5 must precede Task 6 (`flight.pitch`); Task 6 owns the `verticalFlight` deletion because RadarMap holds the last import.
- **Atmosphere caveat (Task 4, step 6f):** `Atmosphere.tsx` receives a `planetPos` prop for sun-direction math; the implementer must check whether it reads per-frame or once, and make the sun direction track the moving planet (world-position-based is the robust fix).
