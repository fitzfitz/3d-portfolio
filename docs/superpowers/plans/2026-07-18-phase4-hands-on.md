# Phase 4: Hands On Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gameplay: 10 collectible data shards with resume easter eggs, asteroid/sun collisions with bounce+shake, a hold-to-scan mode with procedural reports, a real orbit-entry animation, and photo mode.

**Architecture:** Every gameplay rule is a pure tested function (`resolveCollision`, `generateScanReport`, shard store logic). Events flow through guarded store actions; custom text reaches the radio via a new `broadcast` store channel; dynamic scan targets live in a mutable module registry updated by existing frame loops.

**Tech Stack:** React 19, TS, @react-three/fiber 9, drei 10 (OrbitControls), zustand, Web Audio, vitest.

## Global Constraints

- Zero per-frame React setState; guarded setters; pure logic TDD'd in src/utils/.
- Collisions: 12 large asteroids (radius scale×2.2) + sun (origin r=4) ONLY — belt excluded by spec.
- localStorage access always via try/catch helpers (SecurityError-safe), keys `fitz-shards`.
- Keyboard additions honor `isEditableTarget`; every interaction has touch parity.
- Photo mode must never require `preserveDrawingBuffer`.
- Every commit ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Gates per task: `npm run build && npm run lint && npm test`.
- Spec: `docs/superpowers/specs/2026-07-18-phase4-hands-on-design.md`.

## File Structure

- Create: `src/data/shards.ts`, `src/data/asteroids.ts` (extracted colliders), `src/utils/collision.ts`, `src/utils/scanReport.ts`, `src/utils/scannables.ts`, `src/components/canvas/DataShards.tsx`, `src/components/canvas/Scanner.tsx`, `src/components/layout/ScanRing.tsx` + tests (`collision`, `scanReport`, store additions)
- Modify: `src/store/spaceStore.ts`, `src/audio/soundManager.ts`, `src/hooks/useKeyboardInput.ts` (KeyE→scan, KeyP handled in usePhotoModeKey inside App or hook), `src/data/chatterLines.ts` + `src/utils/chatterScheduler.ts` (impact pool), `src/components/layout/RadioChatter.tsx` (broadcast + impact subscriptions), `src/components/canvas/{Spaceship,Asteroids,GlobalCanvas,Comets,SpaceJellyfish}.tsx`, `src/components/layout/{HUDOverlay,TouchControls}.tsx`, `src/App.tsx`

---

### Task 1: Foundations (TDD) — shards store, collision, scan reports, broadcast channel, colliders data, sounds, input keys

**Files:**
- Create: `src/data/shards.ts`, `src/data/asteroids.ts`, `src/utils/collision.ts`, `src/utils/scanReport.ts`, `src/utils/scannables.ts`, `tests/collision.test.ts`, `tests/scanReport.test.ts`
- Modify: `src/store/spaceStore.ts`, `src/audio/soundManager.ts`, `src/hooks/useKeyboardInput.ts`, `src/data/chatterLines.ts`, `src/utils/chatterScheduler.ts`, `src/components/canvas/Asteroids.tsx` (import extracted data)
- Test: extend `tests/spaceStore.test.ts`, `tests/chatterScheduler.test.ts`

**Interfaces (exact names, later tasks depend on them):**
- `SHARDS: { pos: [number, number, number]; fact: string }[]` (10 entries, several with y ≠ 0) from `src/data/shards.ts`
- `ASTEROID_COLLIDERS: { x: number; y: number; z: number; r: number }[]` (12, r = scale×2.2) and `asteroidInstances` re-export from `src/data/asteroids.ts`; `SUN_COLLIDER = { x: 0, y: 0, z: 0, r: 4 }`
- `resolveCollision(px,py,pz, vx,vy,vz, cx,cy,cz, radius): { px,py,pz,vx,vy,vz } | null` (null = no hit; on hit: push-out to radius+0.05 along normal, velocity reflected and damped ×0.45)
- `generateScanReport(id: string): string` — deterministic per id; planet ids (`saas|video|agent|contact`) return project-flavored reports (table), others procedural composition/mass/quip from a seeded hash
- `scannables.ts`: `const registry = new Map<string, {x,y,z,label}>`; `setScannable(id, x, y, z, label)`, `removeScannable(id)`, `nearestScannable(x,y,z, range): {id,label,dist} | null` (pure over the Map — unit-testable)
- Store: `shardsCollected: number[]` (init from localStorage, try/catch) + `collectShard(i)` (idempotent, persists, guarded); `broadcast: { id: number; text: string } | null` + `sendBroadcast(text)` (id increments so repeat text retriggers); `impactCount: number` + `bumpImpact()`; `scanTarget: string | null` + guarded `setScanTarget`; `photoMode: boolean` + `setPhotoMode`
- `FlightInput` += `scan: boolean` (KeyE); soundManager += `pickup()`, `fanfare()`, `impact()`, `scanBeep()`
- `ChatterPools` += `impact: string[]` (+kind branch); chatterLines gets 3 impact lines

- [ ] **Step 1: Failing tests** — `tests/collision.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveCollision } from "../src/utils/collision";

describe("resolveCollision", () => {
  it("returns null when outside the radius", () => {
    expect(resolveCollision(10, 0, 0, -1, 0, 0, 0, 0, 0, 5)).toBeNull();
  });
  it("reflects and damps a head-on hit, pushing out of penetration", () => {
    const r = resolveCollision(4.5, 0, 0, -10, 0, 0, 0, 0, 0, 5);
    expect(r).not.toBeNull();
    expect(r!.vx).toBeCloseTo(4.5); // reflected (+x) and damped x0.45
    expect(r!.px).toBeCloseTo(5.05); // pushed to radius + 0.05
  });
  it("leaves tangential velocity direction intact (graze)", () => {
    const r = resolveCollision(4.9, 0, 0, 0, 0, 8, 0, 0, 0, 5);
    expect(r).not.toBeNull();
    expect(r!.vz).toBeCloseTo(8 * 0.45); // no normal component to flip
    expect(r!.vx).toBeCloseTo(0);
  });
  it("handles the dead-center degenerate case without NaN", () => {
    const r = resolveCollision(0, 0, 0, 1, 0, 0, 0, 0, 0, 5);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.px)).toBe(true);
  });
});
```

`tests/scanReport.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { generateScanReport } from "../src/utils/scanReport";

describe("generateScanReport", () => {
  it("is deterministic per id", () => {
    expect(generateScanReport("asteroid_3")).toBe(generateScanReport("asteroid_3"));
  });
  it("differs across ids", () => {
    expect(generateScanReport("asteroid_3")).not.toBe(generateScanReport("asteroid_7"));
  });
  it("returns project-flavored reports for planets", () => {
    expect(generateScanReport("saas")).toContain("SUBSCRIPTIONS");
    expect(generateScanReport("contact")).toContain("COMM");
  });
  it("always uppercases and prefixes SCAN[", () => {
    expect(generateScanReport("asteroid_1")).toMatch(/^SCAN\[/);
  });
});
```

Store additions in `tests/spaceStore.test.ts` (add fields to beforeEach: `shardsCollected: [], broadcast: null, impactCount: 0, scanTarget: null, photoMode: false`):
```ts
  it("collectShard is idempotent and persists", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    useSpaceStore.getState().collectShard(3);
    useSpaceStore.getState().collectShard(3);
    expect(useSpaceStore.getState().shardsCollected).toEqual([3]);
    expect(JSON.parse(store["fitz-shards"])).toEqual([3]);
    vi.unstubAllGlobals();
  });
  it("sendBroadcast retriggers identical text via incrementing id", () => {
    useSpaceStore.getState().sendBroadcast("HELLO");
    const first = useSpaceStore.getState().broadcast;
    useSpaceStore.getState().sendBroadcast("HELLO");
    const second = useSpaceStore.getState().broadcast;
    expect(first!.text).toBe("HELLO");
    expect(second!.id).toBeGreaterThan(first!.id);
  });
  it("bumpImpact increments", () => {
    useSpaceStore.getState().bumpImpact();
    expect(useSpaceStore.getState().impactCount).toBe(1);
  });
```
Scheduler: add `impact: ["imp-1"]` to fixture + a pick test (same shape as comet).
Run `npm test` → RED.

- [ ] **Step 2: Implement**

`src/utils/collision.ts`:
```ts
const DAMP = 0.45;
const SKIN = 0.05;

/** Sphere collision: push out along the normal, reflect + damp velocity. Null = no hit. */
export function resolveCollision(
  px: number, py: number, pz: number,
  vx: number, vy: number, vz: number,
  cx: number, cy: number, cz: number,
  radius: number
): { px: number; py: number; pz: number; vx: number; vy: number; vz: number } | null {
  let nx = px - cx, ny = py - cy, nz = pz - cz;
  const dist = Math.hypot(nx, ny, nz);
  if (dist >= radius) return null;
  if (dist < 1e-6) { nx = 1; ny = 0; nz = 0; } else { nx /= dist; ny /= dist; nz /= dist; }
  const vDotN = vx * nx + vy * ny + vz * nz;
  const rx = (vx - 2 * vDotN * nx) * DAMP;
  const ry = (vy - 2 * vDotN * ny) * DAMP;
  const rz = (vz - 2 * vDotN * nz) * DAMP;
  const out = radius + SKIN;
  return { px: cx + nx * out, py: cy + ny * out, pz: cz + nz * out, vx: rx, vy: ry, vz: rz };
}
```

`src/utils/scanReport.ts`:
```ts
const PLANET_REPORTS: Record<string, string> = {
  saas: "SCAN[PLANET_SAAS] // CORE: 15,000 ACTIVE SUBSCRIPTIONS · CRUST: TYPESCRIPT+HONO · RINGS: STRIPE CONNECT // STABILITY: SUB-MILLISECOND",
  video: "SCAN[PLANET_VIDEO] // ATMOSPHERE: WHISPER TRANSCRIPTS · SURFACE: SEMANTIC SCENES · EXPORTS: VERTICAL, HIGH-RETENTION",
  agent: "SCAN[PLANET_AGENT] // POPULATION: CODER+REVIEW AGENTS · GOVERNMENT: HIERARCHY MANAGERS · LAW: LOCAL TDD CYCLES",
  contact: "SCAN[PORTAL_SUN] // COMM-GATE RESONANT. THE PILOT ANSWERS TRANSMISSIONS. DOCK TO COMPOSE",
};

const ELEMENTS = ["FE", "NI", "SI", "MG", "H2O-ICE", "IR", "AU", "CAFFEINE"];
const QUIPS = [
  "MASS CLASS: C — MOSTLY HARMLESS",
  "MASS CLASS: B — DO NOT LICK",
  "MASS CLASS: D — SENTIMENTAL VALUE ONLY",
  "MASS CLASS: A — INSURANCE RECOMMENDED",
];

function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function generateScanReport(id: string): string {
  const table = PLANET_REPORTS[id];
  if (table) return table;
  const h = hash(id);
  const e1 = ELEMENTS[h % ELEMENTS.length];
  const e2 = ELEMENTS[(h >> 3) % ELEMENTS.length];
  const p1 = 20 + (h % 45);
  const p2 = 5 + ((h >> 5) % 30);
  const quip = QUIPS[(h >> 8) % QUIPS.length];
  return `SCAN[${id.toUpperCase()}] // ${e1} ${p1}% · ${e2} ${p2}% · UNKNOWN ${100 - p1 - p2}% // ${quip}`;
}
```

`src/utils/scannables.ts`:
```ts
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
    const d = Math.hypot(s.x - x, s.y - y, s.z - z);
    if (d < range && (!best || d < best.dist)) best = { id, label: s.label, dist: d };
  }
  return best;
}
export function clearScannables() { registry.clear(); } // tests
```

`src/data/asteroids.ts` — move `asteroidInstances` verbatim from Asteroids.tsx, export it plus:
```ts
export const ASTEROID_COLLIDERS = asteroidInstances.map((a, i) => ({
  id: `asteroid_${i}`, x: a.position[0], y: a.position[1], z: a.position[2], r: a.scale * 2.2,
}));
export const SUN_COLLIDER = { id: "sol", x: 0, y: 0, z: 0, r: 4 };
```
Asteroids.tsx imports `asteroidInstances` from there (delete its local copy).

`src/data/shards.ts` — 10 entries, mix of ground-level and high/low altitude, each with a fact (write real resume-flavored lines, e.g. "DATA_SHARD 1/10 // THE PILOT SHIPS SCHEMA-ISOLATED TENANTS BEFORE BREAKFAST", "…// 3 AI CODE REVIEWERS APPROVED THIS UNIVERSE", a couple of pure jokes, final tenth hints at the collect-all). Positions spread: near spawn, near each planet, high above the sun (y 30+), deep below (y −30), near the portal, mid-belt gap, far corner.

Store additions (spaceStore.ts) — follow existing idioms; localStorage via safe helpers; `collectShard`:
```ts
    collectShard: (i) => {
      const cur = get().shardsCollected;
      if (cur.includes(i)) return;
      const next = [...cur, i];
      set({ shardsCollected: next });
      safeSetJSON("fitz-shards", next);
    },
    sendBroadcast: (text) => set({ broadcast: { id: (get().broadcast?.id ?? 0) + 1, text } }),
    bumpImpact: () => set({ impactCount: get().impactCount + 1 }),
    setScanTarget: (v) => { if (get().scanTarget !== v) set({ scanTarget: v }); },
    setPhotoMode: (v) => set({ photoMode: v }),
```
soundManager one-shots (reuse `blip`): `pickup()` = sine 880 then 1174 (60ms apart, vol 0.09); `fanfare()` = 4 notes 523/659/784/1046 stepped 110ms; `impact()` = triangle 70Hz 0.35s vol 0.18 + a short noise burst if trivial, else just the triangle boom; `scanBeep()` = square 1320, 0.06s, vol 0.05.
Keymap += `KeyE: "scan"`; FlightInput += `scan: boolean` (init false). chatterLines += impact pool (3 lines: "HULL SMACK REGISTERED. THE ASTEROID IS FINE", "COLLISION. INSURANCE PREMIUM: RISING", "THAT ROCK HAS BEEN THERE FOR 4 BILLION YEARS, PILOT"); scheduler kind + branch.

- [ ] **Step 3: GREEN (expect ~57 tests), gates, commit**
```bash
git add -A
git commit -m "feat: phase 4 foundations — collision/scan/shard logic, broadcast channel, colliders data (tested)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Data shards in the world

**Files:**
- Create: `src/components/canvas/DataShards.tsx`
- Modify: `src/components/canvas/GlobalCanvas.tsx` (mount), `src/components/layout/HUDOverlay.tsx` (counter), `src/components/layout/RadioChatter.tsx` (broadcast subscription)

**Interfaces:**
- `<DataShards />`: one InstancedMesh (octahedron r=0.9, emissive cyan-white additive standard material), bob `sin(t*1.5+i)*0.4`, spin `t*0.8+i`; collected → zero-scale matrix; pickup check `toroidalDistance3 < 3` per active shard → `collectShard(i)` + `soundManager.pickup()` + `sendBroadcast(SHARDS[i].fact)`; when the collect makes it 10/10 → `fanfare()` + `sendBroadcast("ALL SHARDS RECOVERED // ...")`.
- RadioChatter: subscribe `(s) => s.broadcast` → `if (b) typeLine(b.text)` (typeLine already handles the `> ` prefix), and `(s) => s.impactCount` → `typeLine(scheduler.pick("impact"))`.
- HUD diagnostics block gains `<div>SHARDS: {shardsCollected.length}/10</div>` (React state is fine — changes only on pickup).

Implementation notes: read `shardsCollected` inside the frame loop via `getState()` (skip collected); the component re-renders on collect (selector) only to update nothing visual — matrices handle visibility, so use `getState()` everywhere and NO selector in DataShards (HUD shows the count instead).

- [ ] Steps: build component → mount inside Suspense → wire chatter subscriptions + HUD counter → gates → commit `feat: collectible data shards with facts, counter, and collect-all fanfare`.

---

### Task 3: Collisions

**Files:**
- Modify: `src/components/canvas/Spaceship.tsx`

**Interfaces:**
- After position integration + vertical step, before boundary wrap: loop `ASTEROID_COLLIDERS` + `SUN_COLLIDER`, call `resolveCollision(pos.x, pos.y, pos.z, vel.x, vy, vel.z, c.x, c.y, c.z, c.r)`; on hit: write back pos/vel/vy, `shake.current = 0.5`, `soundManager.impact()`, `store.bumpImpact()`, and if warping force `flight.input.boost = false` is NOT allowed (input is user-owned) — instead the damped velocity naturally kills the warp speed for a frame; acceptable.
- Camera shake: `shake` ref; after camera positioning add `state.camera.position.x += (Math.random()-0.5) * shake.current; (y,z likewise) * shake.current; shake.current *= Math.pow(0.03, dt);` (decays in ~1s). Skip shake when photoMode (Task 6 adds the flag — guard with `!store.photoMode` once it exists; use `(store as any).photoMode ?? false` NO — just add plain check in Task 6).

- [ ] Steps: integrate → gates → commit `feat: asteroid and sun collisions — bounce, camera shake, impact chatter`.

---

### Task 4: Scanner

**Files:**
- Create: `src/components/canvas/Scanner.tsx`, `src/components/layout/ScanRing.tsx`
- Modify: `src/components/canvas/{SpacePlanets,Comets,SpaceJellyfish,GlobalCanvas}.tsx` (register scannables), `src/components/layout/{HUDOverlay,TouchControls}.tsx`

**Interfaces:**
- Static registrations (one-time useEffect): planets + portal in SpacePlanets (`setScannable("saas", ...pos, "PLANET_SAAS")` etc.), asteroids in GlobalCanvas or Asteroids (`ASTEROID_COLLIDERS.forEach(c => setScannable(c.id, c.x, c.y, c.z, c.id.toUpperCase()))`). Dynamic: Comets update `comet_0/comet_1` each frame (one `setScannable` call per comet — mutates in place, no allocation); SpaceJellyfish updates `jellyfish`.
- `Scanner.tsx` (inside Canvas): module-scoped `export const scanState = { progress: 0, label: "" };` useFrame: `const near = nearestScannable(flight.x, flight.y, flight.z, 22); store.setScanTarget(near?.id ?? null);` if `flight.input.scan && near`: `scanState.progress += dt / 1.6`; on ≥1: `sendBroadcast(generateScanReport(near.id)); soundManager.scanBeep(); scanState.progress = 0;` else decay progress toward 0 fast. `scanState.label = near?.label ?? ""`.
- `ScanRing.tsx` (HUD): rAF reads `scanState`; a 56px div centered-lowish (`bottom-40 left-1/2`) with conic-gradient ring + label text; hidden (`opacity 0`) when no target; `pointer-events-none`.
- TouchControls: SCAN hold-button (same HoldButton pattern + per-pointer ref) mounted only when `useSpaceStore((s) => s.scanTarget) !== null` (discrete re-render, fine), writes `flight.input.scan`; include in both reset paths.

- [ ] Steps: registry wiring → Scanner + ScanRing → touch button → gates → commit `feat: hold-to-scan with procedural reports and contextual touch button`.

---

### Task 5: Orbit entry animation

**Files:**
- Modify: `src/components/canvas/Spaceship.tsx`, `src/constants.ts` (export `LOCK_BODIES` lookup if helpful)

**Interfaces:**
- On lock transition (reuse `prevOrbitLocked` effect or detect in-frame): resolve `lockedCenter` (Vector3) + `lockRadius` from `activeZone` (`planets` size×1.5, portal 2.6); init `orbitAngle = atan2(pos.x - c.x, pos.z - c.z)`.
- Locked branch replaces the freeze: `orbitAngle += dt * 0.25; pos.current.x = c.x + sin(orbitAngle)*lockRadius; pos.current.z = c.z + cos(orbitAngle)*lockRadius;` altitude eases to `c.y` (keep existing ease); heading faces tangent: `angle.current = orbitAngle + Math.PI / 2;` ship rotation via the standard YXZ set (roll eased to a gentle bank −0.15); THEN fall through to (or duplicate) the camera-follow block so the chase cam keeps framing the ship. `flight.x/z/y` published.
- Break-orbit: existing tangential escape push now uses the tangent heading — verify direction pushes AWAY from the gravity radius (it pushes backward along heading; tangent heading → exits along orbit tangent ✓ spec).

- [ ] Steps: implement → gates → probe screenshot of the ship mid-orbit beside the modal → commit `feat: orbit-entry animation — ship circles the locked body behind the dossier`.

---

### Task 6: Photo mode

**Files:**
- Modify: `src/App.tsx` (P key hook + chrome hiding), `src/components/layout/HUDOverlay.tsx` (hide + PHOTO_MODE tag), `src/components/canvas/GlobalCanvas.tsx` (OrbitControls), `src/components/canvas/Spaceship.tsx` (skip cam/input while photoMode; skip shake)

**Interfaces:**
- Key: in App, a small effect listening for KeyP (with `isEditableTarget` guard) toggling `setPhotoMode(!photoMode)`.
- App/HUD: when `photoMode`, render NOTHING of: HUDOverlay, TouchControls, modals, startup card, classic-CV button; render only `<div className="fixed top-6 left-6 z-50 font-mono text-[10px] text-white/50">PHOTO_MODE — [P] EXIT</div>`.
- GlobalCanvas: `{photoMode && <OrbitControls makeDefault target={photoTarget} />}` where `photoTarget` is a `THREE.Vector3` snapshot of `(flight.x, flight.y, flight.z)` captured when photoMode flips true (useMemo on photoMode).
- Spaceship frame loop: `if (store.photoMode)` → keep bob/idle animation and trail, but skip: input handling, physics integration, camera follow, shake (ship poses in place). Simplest: early sub-branch that only does bob + thruster idle + rotation hold + publishes flight unchanged.
- RadioChatter/sound: leave running (radio crackle in photos is fine — spec doesn't demand silence).

- [ ] Steps: implement → gates → commit `feat: photo mode — press P for clean orbitable frames`.

---

### Task 7: Final verification pass

- [ ] Gates (≈57 tests); `du -sh public/models` unchanged.
- [ ] Probe: fly to the spawn-adjacent shard → pickup line + counter; ram the nearest big asteroid → shake frame + impact line; hold E at a planet → ring + report; orbit-lock → mid-orbit screenshot; press P → clean frame screenshot.
- [ ] Manual checklist: persistence across reload; collect-all fanfare (localStorage pre-seed 9 shards to test quickly); touch SCAN/RISE/DIVE/BOOST coexistence; photo-mode restore.
- [ ] Append `## Verification`; commit.

## Verification (2026-07-18)

Gates: build ✓ · lint ✓ (one informational fast-refresh note on Scanner.tsx) · tests 57/57 · assets unchanged 4.8M.
Probe-verified (screenshots): scanner full loop — target acquisition ("PLANET_VIDEO" label + ring UI), completed hold → project-flavored SCAN report typed on the radio; photo mode — clean frame, orbit-drag to a side profile, PHOTO_MODE tag only; SHARDS: 0/10 HUD counter live; cratered moons + cloud layer visible on approach. Zero page errors across runs.
## Verification closure (2026-07-25)

Pending-human items from this plan, resolved:

- Shard pickup — closed by `tests/e2e/gameplay.probe.mjs` (`ship is within the shard
  pickup radius (precondition)`, `flying into a shard collects it`, `HUD shard counter
  reflects the pickup`).
- Collect-all fanfare — closed at the mechanism level by `tests/e2e/gameplay.probe.mjs`
  (`collecting the 10th shard completes the set`, `collect-all broadcasts the
  completion fanfare`); whether it *feels* celebratory folds into the general audio-mix
  judgment — NOT RUN — awaiting human pass, see `docs/QA-CHECKLIST.md` §9.
- Asteroid ram feel (bounce/shake/boom) — the underlying mechanism (impact registers,
  rate-limited) is closed by `tests/e2e/gameplay.probe.mjs` (`ramming an asteroid
  registers an impact`, `impacts are rate-limited to one per 0.5s`); whether it *feels*
  weighted rather than floaty/machine-gun is NOT RUN — awaiting human pass, see
  `docs/QA-CHECKLIST.md` §6.
- Orbit-entry circling behind the dossier — NOT RUN: `tests/e2e/gameplay.probe.mjs`
  confirms the orbit-lock ring-radius mechanism (`locked ship holds a ring radius
  around the moving planet`), but no probe or QA-checklist item judges the visual
  composition of the ship circling behind the fullscreen dossier modal.
- Touch SCAN button on device — partially closed: `tests/e2e/touch.probe.mjs` verifies
  SCAN under iPhone emulation (`scan target acquired near ${name}`, `SCAN button
  appears when a target is in range`, `SCAN sets the scan input`), but emulation cannot
  judge real-device thumb-reach ergonomics — that half is NOT RUN — awaiting human
  pass, see `docs/QA-CHECKLIST.md` §8.

See `docs/superpowers/plans/2026-07-25-portfolio-content-and-verification.md`.
