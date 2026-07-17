# Smooth Space Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the R3F space-flight portfolio smoother (zero React renders during flight, ~31MB → <4MB assets, delta-time physics) and better-looking (IBL, atmospheres, trail, post-fx) with touch support.

**Architecture:** Per-frame data (ship position, speed, input) moves into a plain mutable `flight` object read/written only inside `useFrame`/rAF loops; discrete events (zone, orbit lock, warp) live in a zustand store. Assets are re-encoded at build time with gltf-transform — geometry untouched, textures resized/WebP'd. Visual uplift comes from an offline-generated environment map, fresnel atmosphere shells, a drei Trail, and two new post-fx passes.

**Tech Stack:** React 19, TypeScript, Vite 8, @react-three/fiber 9, drei 10, three 0.185, zustand (new), vitest (new, dev), @gltf-transform/* + sharp + meshoptimizer (new, dev).

## Global Constraints

- **Never simplify/decimate mesh geometry** — spec requires zero geometry detail loss.
- Normal maps: WebP near-lossless, never resized below source.
- Spec file: `docs/superpowers/specs/2026-07-17-smooth-space-upgrade-design.md`.
- Existing visual feel at 60Hz must be preserved when converting physics to delta-time (constants converted, not re-tuned).
- `assets-src/` is gitignored and holds originals; `public/models/` holds optimized output.
- All commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Verify commands: `npm run build`, `npm run lint`, `npm test`.

## File Structure

- Delete: `src/components/canvas/{Vehicle,PlaygroundLevel,MarblesContainer,Scene,ProjectCarousel,HeroNodeNetwork}.tsx` (dead)
- Create: `scripts/optimize-assets.mjs` — asset pipeline
- Create: `src/constants.ts` — `COSMIC_BOUNDS`, `PORTAL_POS`, `planets`, `projects` (moved out of App.tsx)
- Create: `src/store/spaceStore.ts` — zustand store + mutable `flight` object
- Create: `src/utils/toroidal.ts` — toroidal distance (extracted, tested)
- Create: `src/hooks/useKeyboardInput.ts` — writes `flight.input` (replaces `useKeyboard.ts`)
- Create: `src/components/layout/TouchControls.tsx` — virtual joystick + boost
- Create: `src/components/canvas/Atmosphere.tsx` — fresnel glow shell
- Create: `tests/toroidal.test.ts`, `tests/spaceStore.test.ts`
- Modify: `src/App.tsx`, `src/components/canvas/{GlobalCanvas,Spaceship,SpacePlanets,Asteroids}.tsx`, `src/components/layout/HUDOverlay.tsx`, `package.json`

---

### Task 1: Delete dead code

**Files:**
- Delete: `src/components/canvas/Vehicle.tsx`, `src/components/canvas/PlaygroundLevel.tsx`, `src/components/canvas/MarblesContainer.tsx`, `src/components/canvas/Scene.tsx`, `src/components/canvas/ProjectCarousel.tsx`, `src/components/canvas/HeroNodeNetwork.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: nothing (removal only). `PortalRing.tsx` and `useKeyboard.ts` MUST remain (still referenced by live code).

- [ ] **Step 1: Verify the six files are unreferenced by live code**

Run:
```bash
cd /Users/fitzgeral/Kerja/proj/fitz
for f in Vehicle PlaygroundLevel MarblesContainer Scene ProjectCarousel HeroNodeNetwork; do
  echo "== $f =="; grep -rn "from \"./$f\"\|from \"../canvas/$f\"\|from \"./canvas/$f\"" src --include="*.tsx" --include="*.ts";
done
```
Expected: matches ONLY inside the six files themselves (e.g. PlaygroundLevel imports HeroNodeNetwork). No matches from App.tsx, GlobalCanvas.tsx, or any live file.

- [ ] **Step 2: Delete and verify build**

```bash
git rm src/components/canvas/Vehicle.tsx src/components/canvas/PlaygroundLevel.tsx src/components/canvas/MarblesContainer.tsx src/components/canvas/Scene.tsx src/components/canvas/ProjectCarousel.tsx src/components/canvas/HeroNodeNetwork.tsx
npm run build && npm run lint
```
Expected: build + lint pass.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove dead legacy canvas components

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Asset optimization pipeline

**Files:**
- Create: `scripts/optimize-assets.mjs`
- Modify: `package.json` (devDeps + `assets:optimize` script)
- Modify: `src/components/canvas/SpacePlanets.tsx:139-143` (`.jpg` → `.webp` texture paths)

**Interfaces:**
- Consumes: originals in `assets-src/` (created on first run from `public/models/`)
- Produces: optimized `public/models/*.glb` + `public/models/{earth,jupiter,mars}.webp`. Later tasks load these exact paths. Meshopt decoding is automatic (drei `useGLTF` wires `MeshoptDecoder` by default).

- [ ] **Step 1: Install dev dependencies**

```bash
npm i -D @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
```

- [ ] **Step 2: Back up originals (one-time, gitignored)**

```bash
mkdir -p assets-src && cp -n public/models/*.glb public/models/*.jpg assets-src/
ls -lh assets-src
```
Expected: 4 .glb + 3 .jpg files, asteroid.glb ≈ 28M.

- [ ] **Step 3: Write `scripts/optimize-assets.mjs`**

```js
// Re-encodes 3D assets from assets-src/ into public/models/.
// Geometry is NEVER simplified (spec constraint) — only welded, deduped,
// quantized, and meshopt-compressed (all visually lossless).
// Fallback if meshopt decoding ever fails at runtime: remove the meshopt()
// call below and re-run; quantized output loads with no decoder.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, quantize, meshopt, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";
import { statSync } from "node:fs";

const SRC = "assets-src";
const OUT = "public/models";

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.encoder": MeshoptEncoder,
});

const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(2) + "MB";

async function processGlb(name, textureTransforms) {
  const src = `${SRC}/${name}.glb`;
  const out = `${OUT}/${name}.glb`;
  const doc = await io.read(src);
  await doc.transform(weld(), dedup(), prune(), ...textureTransforms, quantize(), meshopt({ encoder: MeshoptEncoder }));
  await io.write(out, doc);
  console.log(`${name}.glb  ${mb(src)} -> ${mb(out)}`);
}

// Asteroid: 4K textures for a background rock. Resize to what's actually
// sampled at gameplay distance; normal map kept full-res near-lossless.
await processGlb("asteroid", [
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 90, resize: [2048, 2048], slots: /baseColor/i }),
  textureCompress({ encoder: sharp, targetFormat: "webp", nearLossless: true, slots: /normal/i }),
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 90, resize: [1024, 1024], slots: /metallicRoughness/i }),
]);

// Player-facing / already-1K models: format conversion only, no resize.
for (const name of ["spaceship", "portal_gateway", "space_crystal"]) {
  await processGlb(name, [textureCompress({ encoder: sharp, targetFormat: "webp", quality: 92 })]);
}

// Planet equirect maps: keep 2048x1024 resolution, convert JPEG -> WebP.
for (const name of ["earth", "jupiter", "mars"]) {
  await sharp(`${SRC}/${name}.jpg`).webp({ quality: 88 }).toFile(`${OUT}/${name}.webp`);
  console.log(`${name}.webp  ${mb(`${SRC}/${name}.jpg`)} -> ${mb(`${OUT}/${name}.webp`)}`);
}
console.log("Done.");
```

- [ ] **Step 4: Add npm script**

In `package.json` scripts block add:
```json
"assets:optimize": "node scripts/optimize-assets.mjs"
```

- [ ] **Step 5: Run and verify size budget**

```bash
npm run assets:optimize
rm public/models/earth.jpg public/models/jupiter.jpg public/models/mars.jpg
ls -lh public/models
du -sh public/models
```
Expected: asteroid.glb under ~2MB, total directory under 4MB. If asteroid.glb is over 2.5MB, check that the resize actually applied (inspect with `npx @gltf-transform/cli inspect public/models/asteroid.glb` — basecolor should read 2048x2048 image/webp).

- [ ] **Step 6: Update planet texture paths**

In `src/components/canvas/SpacePlanets.tsx` lines 139-143:
```tsx
  const [earthTex, jupiterTex, marsTex] = useTexture([
    "/models/earth.webp",
    "/models/jupiter.webp",
    "/models/mars.webp"
  ]);
```

- [ ] **Step 7: Visual A/B verification**

```bash
npm run dev
```
Open the app; fly toward an asteroid and the portal. Expected: models render identically at gameplay distance (textures, normal detail intact), no console errors about meshopt/webp. Take a screenshot for the record if convenient.

- [ ] **Step 8: Build, lint, commit**

```bash
npm run build && npm run lint
git add -A && git commit -m "feat: asset pipeline — 31MB models re-encoded to <4MB, zero geometry loss

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Test infra + space store

**Files:**
- Create: `src/utils/toroidal.ts`, `src/store/spaceStore.ts`
- Create: `tests/toroidal.test.ts`, `tests/spaceStore.test.ts`
- Modify: `package.json` (vitest devDep + `test` script)

**Interfaces:**
- Consumes: nothing
- Produces (later tasks depend on these EXACT names):
  - `flight: { x: number; z: number; speed: number; input: FlightInput }` — mutable, module-level
  - `FlightInput = { forward: boolean; backward: boolean; left: boolean; right: boolean; boost: boolean; steer: number; thrust: number }` (steer/thrust are analog −1..1, used by touch)
  - `useSpaceStore` with state `{ activeZone: string | null; isOrbitLocked: boolean; isOrbitCooldown: boolean; isWarping: boolean; isLowPerf: boolean; lowPerfManual: boolean; showClassicCV: boolean; isNearSpawn: boolean; isTeleporting: boolean }` and actions `setActiveZone(z)`, `setOrbitLocked(v)`, `breakOrbit()`, `setWarping(v)`, `setLowPerf(v, manual?)`, `setShowClassicCV(v)`, `setNearSpawn(v)`, `triggerTeleportFlash()`
  - `toroidalDistance(ax, az, bx, bz, bounds): number`

- [ ] **Step 1: Install deps**

```bash
npm i zustand && npm i -D vitest
```
Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Write failing tests**

`tests/toroidal.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toroidalDistance } from "../src/utils/toroidal";

describe("toroidalDistance", () => {
  it("computes plain euclidean distance when no wrap is shorter", () => {
    expect(toroidalDistance(0, 0, 3, 4, 250)).toBeCloseTo(5);
  });
  it("wraps across the boundary when that path is shorter", () => {
    // points at x=-245 and x=245 with bounds 250: through the edge = 10, direct = 490
    expect(toroidalDistance(-245, 0, 245, 0, 250)).toBeCloseTo(10);
  });
});
```

`tests/spaceStore.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSpaceStore, flight } from "../src/store/spaceStore";

beforeEach(() => {
  useSpaceStore.setState({
    activeZone: null, isOrbitLocked: false, isOrbitCooldown: false,
    isWarping: false, isLowPerf: false, lowPerfManual: false,
    showClassicCV: false, isNearSpawn: true, isTeleporting: false,
  });
});

describe("spaceStore", () => {
  it("breakOrbit clears lock+zone and runs an 1800ms cooldown", () => {
    vi.useFakeTimers();
    useSpaceStore.setState({ isOrbitLocked: true, activeZone: "saas" });
    useSpaceStore.getState().breakOrbit();
    expect(useSpaceStore.getState().isOrbitLocked).toBe(false);
    expect(useSpaceStore.getState().activeZone).toBe(null);
    expect(useSpaceStore.getState().isOrbitCooldown).toBe(true);
    vi.advanceTimersByTime(1800);
    expect(useSpaceStore.getState().isOrbitCooldown).toBe(false);
    vi.useRealTimers();
  });

  it("setActiveZone does not notify subscribers for identical values", () => {
    const spy = vi.fn();
    const unsub = useSpaceStore.subscribe(spy);
    useSpaceStore.getState().setActiveZone(null); // already null
    expect(spy).not.toHaveBeenCalled();
    useSpaceStore.getState().setActiveZone("video");
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("manual setLowPerf marks lowPerfManual so auto-degrade can defer", () => {
    useSpaceStore.getState().setLowPerf(true, true);
    expect(useSpaceStore.getState().lowPerfManual).toBe(true);
    useSpaceStore.getState().setLowPerf(false, false);
    expect(useSpaceStore.getState().isLowPerf).toBe(false);
    expect(useSpaceStore.getState().lowPerfManual).toBe(true); // sticky
  });

  it("flight is a stable mutable object", () => {
    flight.x = 42;
    expect(flight.x).toBe(42);
    flight.x = 0;
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../src/utils/toroidal` and `../src/store/spaceStore`.

- [ ] **Step 4: Implement `src/utils/toroidal.ts`**

```ts
// Shortest distance on a 2D plane that wraps at ±bounds on both axes.
export function toroidalDistance(ax: number, az: number, bx: number, bz: number, bounds: number): number {
  const span = bounds * 2;
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  const wx = dx > bounds ? span - dx : dx;
  const wz = dz > bounds ? span - dz : dz;
  return Math.hypot(wx, wz);
}
```

- [ ] **Step 5: Implement `src/store/spaceStore.ts`**

```ts
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export interface FlightInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  boost: boolean;
  /** Analog steering from touch joystick, -1 (left) .. 1 (right). 0 = keyboard only. */
  steer: number;
  /** Analog thrust from touch joystick, -1 (brake) .. 1 (full). 0 = keyboard only. */
  thrust: number;
}

/**
 * Per-frame telemetry. Mutated inside useFrame/rAF loops and read the same
 * way — deliberately NOT in React state so flight never re-renders the tree.
 */
export const flight = {
  x: 0,
  z: 18,
  speed: 0, // world units / second
  input: {
    forward: false, backward: false, left: false, right: false,
    boost: false, steer: 0, thrust: 0,
  } as FlightInput,
};

interface SpaceState {
  activeZone: string | null;
  isOrbitLocked: boolean;
  isOrbitCooldown: boolean;
  isWarping: boolean;
  isLowPerf: boolean;
  lowPerfManual: boolean;
  showClassicCV: boolean;
  isNearSpawn: boolean;
  isTeleporting: boolean;
  setActiveZone: (z: string | null) => void;
  setOrbitLocked: (v: boolean) => void;
  breakOrbit: () => void;
  setWarping: (v: boolean) => void;
  setLowPerf: (v: boolean, manual?: boolean) => void;
  setShowClassicCV: (v: boolean) => void;
  setNearSpawn: (v: boolean) => void;
  triggerTeleportFlash: () => void;
}

export const useSpaceStore = create<SpaceState>()(
  subscribeWithSelector((set, get) => ({
    activeZone: null,
    isOrbitLocked: false,
    isOrbitCooldown: false,
    isWarping: false,
    isLowPerf: false,
    lowPerfManual: false,
    showClassicCV: false,
    isNearSpawn: true,
    isTeleporting: false,
    // Guarded setters: these are called from frame loops, so bail without
    // notifying when the value hasn't changed.
    setActiveZone: (z) => { if (get().activeZone !== z) set({ activeZone: z }); },
    setOrbitLocked: (v) => { if (get().isOrbitLocked !== v) set({ isOrbitLocked: v }); },
    setWarping: (v) => { if (get().isWarping !== v) set({ isWarping: v }); },
    setNearSpawn: (v) => { if (get().isNearSpawn !== v) set({ isNearSpawn: v }); },
    setLowPerf: (v, manual = false) =>
      set((s) => ({ isLowPerf: v, lowPerfManual: s.lowPerfManual || manual })),
    setShowClassicCV: (v) => set({ showClassicCV: v }),
    breakOrbit: () => {
      set({ isOrbitLocked: false, activeZone: null, isOrbitCooldown: true });
      setTimeout(() => set({ isOrbitCooldown: false }), 1800);
    },
    triggerTeleportFlash: () => {
      set({ isTeleporting: true });
      setTimeout(() => set({ isTeleporting: false }), 380);
    },
  }))
);
```

- [ ] **Step 6: Run tests, verify pass**

Run: `npm test`
Expected: 6 tests pass.

- [ ] **Step 7: Build, lint, commit**

```bash
npm run build && npm run lint
git add -A && git commit -m "feat: zustand space store, mutable flight telemetry, toroidal util (tested)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Keyboard input → flight.input

**Files:**
- Create: `src/hooks/useKeyboardInput.ts`
- Delete: `src/hooks/useKeyboard.ts` (in Task 5 — Spaceship still imports it until then; this task only adds the new hook)

**Interfaces:**
- Consumes: `flight` from `src/store/spaceStore`
- Produces: `useKeyboardInput(): void` — attach once anywhere inside the app; writes `flight.input` booleans directly, no React state.

- [ ] **Step 1: Implement `src/hooks/useKeyboardInput.ts`**

```ts
import { useEffect } from "react";
import { flight, type FlightInput } from "../store/spaceStore";

type BoolKey = "forward" | "backward" | "left" | "right" | "boost";

const KEYMAP: Record<string, BoolKey> = {
  KeyW: "forward", ArrowUp: "forward",
  KeyS: "backward", ArrowDown: "backward",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  Space: "boost",
};

/** Writes key state straight into flight.input — zero React re-renders. */
export function useKeyboardInput() {
  useEffect(() => {
    const set = (code: string, value: boolean) => {
      const key = KEYMAP[code];
      if (key) (flight.input as FlightInput)[key] = value;
    };
    const down = (e: KeyboardEvent) => set(e.code, true);
    const up = (e: KeyboardEvent) => set(e.code, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
}
```

- [ ] **Step 2: Build, lint, commit**

```bash
npm run build && npm run lint
git add -A && git commit -m "feat: keyboard input hook writing mutable flight.input

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Rewire per-frame data flow + delta-time physics

The core task. After it: **zero React renders during steady flight**, physics identical at any refresh rate, HUD bugs fixed.

**Files:**
- Create: `src/constants.ts`
- Modify: `src/App.tsx` (full rewrite of state handling)
- Modify: `src/components/canvas/Spaceship.tsx` (full rewrite)
- Modify: `src/components/canvas/SpacePlanets.tsx` (props + frame loop)
- Modify: `src/components/canvas/GlobalCanvas.tsx` (props + click plane)
- Modify: `src/components/layout/HUDOverlay.tsx` (full rewrite)
- Delete: `src/hooks/useKeyboard.ts`

**Interfaces:**
- Consumes: `flight`, `useSpaceStore`, `toroidalDistance`, `useKeyboardInput` from Tasks 3-4
- Produces:
  - `src/constants.ts` exports `COSMIC_BOUNDS = 250`, `PORTAL_POS: [number, number, number] = [0, 0.2, -160]`, `planets: PlanetData[]`, `projects: Project[]`, and types `PlanetData { name: string; pos: [number,number,number]; color: string; size: number }`, `Project { title: string; role: string; duration: string; short: string; description: string; tech: string[]; color: string }`
  - `Spaceship` props become `{}` (none) · `SpacePlanets` props become `{}` (none, imports `planets` from constants) · `GlobalCanvas` props become `{}` · `HUDOverlay` props become `{}`

- [ ] **Step 1: Create `src/constants.ts`**

Move `projects` (App.tsx:14-45), `COSMIC_BOUNDS` (App.tsx:47), `planets` (App.tsx:49-53) verbatim into `src/constants.ts`, adding the two type exports and `PORTAL_POS`:

```ts
export interface Project {
  title: string; role: string; duration: string; short: string;
  description: string; tech: string[]; color: string;
}
export interface PlanetData {
  name: string; pos: [number, number, number]; color: string; size: number;
}

export const COSMIC_BOUNDS = 250;
export const PORTAL_POS: [number, number, number] = [0, 0.2, -160];

export const projects: Project[] = [ /* moved verbatim from App.tsx lines 14-45 */ ];
export const planets: PlanetData[] = [ /* moved verbatim from App.tsx lines 49-53 */ ];
```

Update the two existing `import { COSMIC_BOUNDS } from "../../App"` sites (Spaceship.tsx:6, SpacePlanets.tsx:6) to `from "../../constants"` — both files are rewritten below anyway.

- [ ] **Step 2: Rewrite `src/components/canvas/Spaceship.tsx`**

Full replacement. Physics constants converted from per-frame@60fps to per-second (feel identical at 60Hz): accel 0.007 → **25.2 u/s²**, maxSpeed 0.18 → **10.8 u/s**, warp 0.65 → **39 u/s**, turnSpeed 0.04 → **2.4 rad/s**; multiplicative decays become `Math.pow(k, dt*60)`; lerp factors become `1 - Math.pow(1-k, dt*60)`.

```tsx
import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { COSMIC_BOUNDS } from "../../constants";
import { flight, useSpaceStore } from "../../store/spaceStore";

// Per-second physics constants (converted from the old per-frame@60fps values)
const ACCEL = 25.2;         // was 0.007/frame
const MAX_SPEED = 10.8;     // was 0.18/frame
const WARP_SPEED = 39;      // was 0.65/frame
const TURN_SPEED = 2.4;     // rad/s, was 0.04/frame
const SPACE_DRAG = 0.982;   // per-frame decay basis
const BRAKE = 0.92;         // per-frame decay basis

// Frame-rate independent lerp: equivalent to lerp(a, b, k) once per frame at 60fps.
const frameLerp = (k: number, dt: number) => 1 - Math.pow(1 - k, dt * 60);

export default function Spaceship() {
  const { scene } = useGLTF("/models/spaceship.glb");
  const isOrbitLocked = useSpaceStore((s) => s.isOrbitLocked);

  useMemo(() => {
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.emissive) mat.emissiveIntensity = 0.08;
      }
    });
  }, [scene]);

  const pos = useRef(new THREE.Vector3(0, 0, 18));
  const vel = useRef(new THREE.Vector3(0, 0, 0)); // units/second
  const angle = useRef(0);
  const roll = useRef(0);
  const pitch = useRef(0);
  const turnVelocity = useRef(0); // rad/second

  useEffect(() => {
    if (!isOrbitLocked && pos.current.length() > 0.5) {
      const escapePush = new THREE.Vector3(
        -Math.sin(angle.current) * 2.8, 0, -Math.cos(angle.current) * 2.8
      );
      pos.current.add(escapePush);
      vel.current.set(0, 0, 0);
    }
  }, [isOrbitLocked]);

  const shipRef = useRef<THREE.Group>(null);
  const thrusterRef = useRef<THREE.Group>(null);

  const particleCount = 20;
  const [particleGeometry, particleVelocities] = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(particleCount * 3);
    const vArr = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      posArr[i * 3] = (Math.random() - 0.5) * 0.1;
      posArr[i * 3 + 1] = (Math.random() - 0.5) * 0.1;
      posArr[i * 3 + 2] = -0.5 - Math.random() * 0.5;
      vArr[i * 3] = (Math.random() - 0.5) * 0.02;
      vArr[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
      vArr[i * 3 + 2] = -0.05 - Math.random() * 0.05;
    }
    geom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    return [geom, vArr];
  }, []);
  const particlesRef = useRef<THREE.Points>(null);

  const dustCount = 80;
  const dustGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      posArr[i * 3] = (Math.random() - 0.5) * 8.0;
      posArr[i * 3 + 1] = (Math.random() - 0.5) * 6.0;
      posArr[i * 3 + 2] = (Math.random() - 0.5) * 10.0;
    }
    geom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    return geom;
  }, []);
  const dustRef = useRef<THREE.Points>(null);

  useFrame((state, delta) => {
    if (!shipRef.current) return;
    const dt = Math.min(delta, 0.05); // clamp tab-switch spikes
    const store = useSpaceStore.getState();
    const input = flight.input;

    if (isOrbitLocked) {
      vel.current.set(0, 0, 0);
      roll.current = THREE.MathUtils.lerp(roll.current, 0, frameLerp(0.1, dt));
      shipRef.current.rotation.z = roll.current;
      shipRef.current.position.y = Math.sin(state.clock.getElapsedTime() * 2) * 0.05;
      if (thrusterRef.current) thrusterRef.current.scale.setScalar(0.1);
      return;
    }

    // 1. Steering: keyboard is full-rate, touch joystick is analog
    const steerInput = input.left ? 1 : input.right ? -1 : -input.steer;
    if (steerInput !== 0) {
      turnVelocity.current = THREE.MathUtils.lerp(turnVelocity.current, TURN_SPEED * steerInput, frameLerp(0.07, dt));
      roll.current = THREE.MathUtils.lerp(roll.current, 0.42 * steerInput, frameLerp(0.07, dt));
    } else {
      turnVelocity.current = THREE.MathUtils.lerp(turnVelocity.current, 0, frameLerp(0.12, dt));
      roll.current = THREE.MathUtils.lerp(roll.current, 0, frameLerp(0.12, dt));
    }
    angle.current += turnVelocity.current * dt;

    // 2. Warp vs impulse. Touch thrust is analog (0..1 forward, <0 brakes).
    const warpActive = input.boost;
    store.setWarping(warpActive);
    const thrustInput = input.forward ? 1 : Math.max(0, input.thrust);
    const braking = input.backward || input.thrust < -0.2;

    const headingX = Math.sin(angle.current);
    const headingZ = Math.cos(angle.current);

    if (warpActive) {
      vel.current.set(headingX * WARP_SPEED, 0, headingZ * WARP_SPEED);
    } else if (thrustInput > 0) {
      vel.current.x += headingX * ACCEL * thrustInput * dt;
      vel.current.z += headingZ * ACCEL * thrustInput * dt;
      if (vel.current.length() > MAX_SPEED) vel.current.normalize().multiplyScalar(MAX_SPEED);
    } else if (braking) {
      vel.current.multiplyScalar(Math.pow(BRAKE, dt * 60));
    }
    vel.current.multiplyScalar(Math.pow(SPACE_DRAG, dt * 60));

    const time = state.clock.getElapsedTime();
    pitch.current = Math.sin(time * 2) * 0.03;

    pos.current.x += vel.current.x * dt;
    pos.current.z += vel.current.z * dt;

    // Toroidal boundary wrap
    const bounds = COSMIC_BOUNDS;
    let wrapOffsetX = 0, wrapOffsetZ = 0, didWrap = false;
    if (pos.current.x > bounds) { pos.current.x = -bounds + 3; wrapOffsetX = -bounds * 2 + 3; didWrap = true; }
    else if (pos.current.x < -bounds) { pos.current.x = bounds - 3; wrapOffsetX = bounds * 2 - 3; didWrap = true; }
    if (pos.current.z > bounds) { pos.current.z = -bounds + 3; wrapOffsetZ = -bounds * 2 + 3; didWrap = true; }
    else if (pos.current.z < -bounds) { pos.current.z = bounds - 3; wrapOffsetZ = bounds * 2 - 3; didWrap = true; }
    if (didWrap) {
      state.camera.position.x += wrapOffsetX;
      state.camera.position.z += wrapOffsetZ;
      store.triggerTeleportFlash();
    }

    shipRef.current.position.copy(pos.current);
    shipRef.current.rotation.set(pitch.current, angle.current, roll.current);

    // 3. Thruster scale
    if (thrusterRef.current) {
      const targetScale = warpActive ? 2.5 : thrustInput > 0 ? 1.4 : 0.4;
      thrusterRef.current.scale.y = THREE.MathUtils.lerp(thrusterRef.current.scale.y, targetScale, frameLerp(0.2, dt));
      thrusterRef.current.scale.x = THREE.MathUtils.lerp(thrusterRef.current.scale.x, warpActive ? 1.4 : 1.0, frameLerp(0.2, dt));
      thrusterRef.current.scale.z = thrusterRef.current.scale.x;
    }

    // 4. Exhaust particles (velocities were per-frame — scale by dt*60)
    if (particlesRef.current) {
      const attr = particlesRef.current.geometry.attributes.position;
      const data = attr.array as Float32Array;
      const step = dt * 60;
      for (let i = 0; i < particleCount; i++) {
        const idx = i * 3;
        data[idx] += particleVelocities[idx] * step;
        data[idx + 1] += particleVelocities[idx + 1] * step;
        data[idx + 2] += particleVelocities[idx + 2] * step;
        if (data[idx + 2] < -2.2) {
          data[idx] = (Math.random() - 0.5) * 0.15;
          data[idx + 1] = (Math.random() - 0.5) * 0.15;
          data[idx + 2] = -0.4;
        }
      }
      attr.needsUpdate = true;
    }

    // 4.5. Local dust streaks
    if (dustRef.current) {
      const attr = dustRef.current.geometry.attributes.position;
      const data = attr.array as Float32Array;
      const speed = vel.current.length();
      const zSpeed = (warpActive ? 0.38 : 0.02 + (speed / 60) * 1.5) * dt * 60;
      for (let i = 0; i < dustCount; i++) {
        const idx = i * 3;
        data[idx + 2] += zSpeed;
        if (data[idx + 2] > 5.0) {
          data[idx] = (Math.random() - 0.5) * 8.0;
          data[idx + 1] = (Math.random() - 0.5) * 6.0;
          data[idx + 2] = -5.0;
        }
      }
      attr.needsUpdate = true;
    }

    // 5. Camera follow + FOV
    const camDistance = warpActive ? 6.8 : 4.8;
    const camHeight = warpActive ? 2.8 : 1.8;
    const targetFov = warpActive ? 86 : 60;
    const perspCam = state.camera as THREE.PerspectiveCamera;
    if (Math.abs(perspCam.fov - targetFov) > 0.01) {
      perspCam.fov = THREE.MathUtils.lerp(perspCam.fov, targetFov, frameLerp(0.1, dt));
      perspCam.updateProjectionMatrix();
    }
    const camOffset = new THREE.Vector3(
      -Math.sin(angle.current) * camDistance, camHeight, -Math.cos(angle.current) * camDistance
    );
    const targetCamPos = pos.current.clone().add(camOffset);
    state.camera.position.lerp(targetCamPos, frameLerp(0.05, dt));
    const lookOffset = new THREE.Vector3(Math.sin(angle.current) * 1.5, 0.2, Math.cos(angle.current) * 1.5);
    state.camera.lookAt(pos.current.clone().add(lookOffset));

    // 6. Publish telemetry (mutable — no React involvement)
    flight.x = pos.current.x;
    flight.z = pos.current.z;
    flight.speed = vel.current.length();
    store.setNearSpawn(Math.abs(pos.current.x) < 0.6 && Math.abs(pos.current.z - 18) < 0.6);
  });

  return (
    <group ref={shipRef}>
      <primitive object={scene} scale={0.35} rotation={[0, Math.PI, 0]} position={[0, -0.05, 0]} />
      <group ref={thrusterRef}>
        <mesh position={[-0.14, -0.04, -0.62]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.04, 0.22, 8]} />
          <meshBasicMaterial color="#00f0ff" transparent={true} opacity={0.35} />
        </mesh>
        <mesh position={[0.14, -0.04, -0.62]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.04, 0.22, 8]} />
          <meshBasicMaterial color="#00f0ff" transparent={true} opacity={0.35} />
        </mesh>
      </group>
      <points ref={particlesRef} geometry={particleGeometry}>
        <pointsMaterial color="#00f0ff" size={0.06} transparent={true} opacity={0.8}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      <points ref={dustRef} geometry={dustGeometry}>
        <pointsMaterial color="#00f0ff" size={0.038} transparent={true} opacity={0.55}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
      <pointLight position={[0, 0, -0.6]} color="#00f0ff" intensity={0.4} distance={1.2} />
    </group>
  );
}
```

Note: the old thruster ref was typed `THREE.Mesh` but held a `<group>` — fixed to `THREE.Group` here. The dust `zSpeed` divides speed by 60 to keep the old visual rate (speed used to be per-frame units).

- [ ] **Step 3: Update `src/components/canvas/SpacePlanets.tsx`**

Change imports/props/frame loop only — all JSX below the frame loop stays as-is except portal group position becomes `position={PORTAL_POS}`:

```tsx
// imports: replace App import, add store + util + constants
import { COSMIC_BOUNDS, PORTAL_POS, planets } from "../../constants";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { toroidalDistance } from "../../utils/toroidal";

// component signature: no props
export default function SpacePlanets() {
```

Replace the proximity section of the `useFrame` (old lines 194-235) with:

```tsx
    // 2. Proximity: read mutable telemetry, write store only on change
    const { isOrbitCooldown, setActiveZone, setOrbitLocked } = useSpaceStore.getState();
    let activeZone: string | null = null;
    let lockActive = false;

    planets.forEach((p) => {
      const dist = toroidalDistance(flight.x, flight.z, p.pos[0], p.pos[2], COSMIC_BOUNDS);
      if (dist < p.size * 1.8) {
        activeZone = p.name;
        if (dist < p.size * 1.3 && !isOrbitCooldown) lockActive = true;
      }
    });

    const portalDist = toroidalDistance(flight.x, flight.z, PORTAL_POS[0], PORTAL_POS[2], COSMIC_BOUNDS);
    if (portalDist < 2.2) {
      activeZone = "contact";
      if (portalDist < 1.5 && !isOrbitCooldown) lockActive = true;
    }

    setActiveZone(activeZone);
    setOrbitLocked(lockActive);
```

Delete the local `getToroidalDistance` helper and the `SpacePlanetsProps` interface. Keep the `PlanetData` usages by importing the type from constants.

- [ ] **Step 4: Update `src/components/canvas/GlobalCanvas.tsx`**

- Component takes no props; delete `GlobalCanvasProps` and the `PlanetData` interface; import `planets` where `<SpacePlanets />` no longer needs it (SpacePlanets imports its own).
- `<Spaceship />` and `<SpacePlanets />` rendered with no props. `<PlasmaAnomalies ref={anomaliesRef} />` — also remove its `vehiclePos` prop; inside `PlasmaAnomalies.tsx` replace any `vehiclePos` prop usage with reads of `flight.x`/`flight.z` in its frame loop (check the file; if the prop is only stored, delete it).
- `isLowPerf` comes from the store: `const isLowPerf = useSpaceStore((s) => s.isLowPerf);`
- Click plane follows the ship without React:

```tsx
function FollowingClickPlane({ onSpawn }: { onSpawn: (p: THREE.Vector3) => void }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (ref.current) ref.current.position.set(flight.x, 0, flight.z);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}
      onPointerDown={(e) => { e.stopPropagation(); if (e.point) onSpawn(e.point.clone()); }}>
      <planeGeometry args={[180, 180]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}
```
Use it as `<FollowingClickPlane onSpawn={(p) => anomaliesRef.current?.spawn(p)} />`.

- [ ] **Step 5: Rewrite `src/App.tsx`**

Keep all JSX/markup, but:
- Delete `projects`, `planets`, `COSMIC_BOUNDS` definitions — import `projects` from `./constants`.
- Delete ALL useState except `activeIndex`. Read from store:

```tsx
import { useSpaceStore } from "./store/spaceStore";
import { useKeyboardInput } from "./hooks/useKeyboardInput";
import { projects } from "./constants";

export default function App() {
  useKeyboardInput();
  const activeZone = useSpaceStore((s) => s.activeZone);
  const isOrbitLocked = useSpaceStore((s) => s.isOrbitLocked);
  const isTeleporting = useSpaceStore((s) => s.isTeleporting);
  const isNearSpawn = useSpaceStore((s) => s.isNearSpawn);
  const showClassicCV = useSpaceStore((s) => s.showClassicCV);
  const setShowClassicCV = useSpaceStore((s) => s.setShowClassicCV);
  const breakOrbit = useSpaceStore((s) => s.breakOrbit);
  const [activeIndex, setActiveIndex] = useState(0);
```
- `handleBoundaryWrap`, `handleBreakOrbit`, `setIsTeleporting` logic → deleted (now store actions). All `handleBreakOrbit` call sites become `breakOrbit`.
- Startup card condition (old line 166) becomes `{isNearSpawn && !activeZone && (`.
- `<HUDOverlay />` and `<GlobalCanvas />` with no props.
- `getPlanetDetails` stays, using imported `projects`.

- [ ] **Step 6: Rewrite `src/components/layout/HUDOverlay.tsx`**

No props. Discrete state from store selectors; telemetry via rAF writing DOM refs; sector map derived from `planets`/`PORTAL_POS`; fixes the literal `&gt;` bug (old line 60) by using a JSX entity properly.

```tsx
import { useEffect, useRef } from "react";
import { Terminal, Cpu, Eye, EyeOff, RotateCcw } from "lucide-react";
import { COSMIC_BOUNDS, PORTAL_POS, planets } from "../../constants";
import { flight, useSpaceStore } from "../../store/spaceStore";

const ZONE_COLORS: Record<string, string> = {
  saas: "text-primary", video: "text-secondary", agent: "text-accent", contact: "text-pink-500",
};

export default function HUDOverlay() {
  const activeZone = useSpaceStore((s) => s.activeZone);
  const isWarping = useSpaceStore((s) => s.isWarping);
  const isOrbitLocked = useSpaceStore((s) => s.isOrbitLocked);
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const setLowPerf = useSpaceStore((s) => s.setLowPerf);

  const locRef = useRef<HTMLDivElement>(null);
  const velRef = useRef<HTMLDivElement>(null);

  // Telemetry readout: rAF straight to the DOM — zero React renders.
  useEffect(() => {
    let raf: number;
    const tick = () => {
      if (locRef.current)
        locRef.current.textContent = `NAV.LOC: X(${flight.x.toFixed(2)}) / Z(${flight.z.toFixed(2)})`;
      if (velRef.current)
        velRef.current.textContent = `VELOCITY: ${(flight.speed * 3.7 + Math.random() * 2).toFixed(1)} KM/S`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-30 font-mono text-[10px] text-white/40 select-none">
      <div className="absolute top-24 left-6 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 text-primary">
          <Terminal className="w-3.5 h-3.5" />
          <span>VESSEL.NAV: ONLINE</span>
        </div>
        <div ref={locRef}>NAV.LOC: X(0.00) / Z(18.00)</div>
        <div>SECTOR.RANGE: {(COSMIC_BOUNDS * 2 * 100).toLocaleString()} KM</div>
        <div ref={velRef}>VELOCITY: 0.0 KM/S</div>
        <div>WARP.CORE: {isWarping ? "ACTIVE (STRETCH)" : "CHARGED (STANDBY)"}</div>
      </div>

      <div className="absolute top-24 right-6 flex flex-col items-end gap-1.5">
        <div className="flex items-center gap-1.5 text-secondary">
          <span>SCANNING_CELESTIALS</span>
          <Cpu className="w-3.5 h-3.5" />
        </div>
        <div className="text-[11px] font-bold">
          TARGET:{" "}
          <span className={activeZone ? "text-primary animate-pulse" : "text-white/20"}>
            {activeZone ? `PLANET_${activeZone.toUpperCase()}` : "DEEP_SPACE"}
          </span>
        </div>
        {activeZone && (
          <div className="text-[8px] text-primary/70 animate-pulse">
            {isOrbitLocked ? "> [GRAVITY LOCK] ENTERING ORBIT..." : "> [WARNING] GRAVITY FIELD DETECTED"}
          </div>
        )}
      </div>

      {/* keep instruction card exactly as before (Task 11 adapts it for touch) */}
      {/* ...existing center-top card JSX unchanged... */}

      <div className="absolute bottom-10 left-6 flex gap-2 pointer-events-auto">
        <button onClick={() => setLowPerf(!isLowPerf, true)} className={/* unchanged classes */`flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all duration-300 ${
            isLowPerf ? "border-red-500/25 bg-red-500/5 text-red-400"
              : "border-white/5 bg-white/2 text-white/50 hover:text-primary hover:border-primary/20"}`}>
          {isLowPerf ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          <span>{isLowPerf ? "ENABLE_BLOOM" : "LOW_PERF"}</span>
        </button>
        {/* RESET_SECTOR button unchanged */}
      </div>

      {/* Sector map derived from real data (fixes stale hardcoded coordinates) */}
      <div className="absolute bottom-10 right-6 flex flex-col gap-2 items-end">
        <div className="text-[8px] text-white/20">{"// SECTOR_PLANETS"}</div>
        {planets.map((p) => (
          <div key={p.name} className={`flex items-center gap-1.5 transition-colors ${activeZone === p.name ? ZONE_COLORS[p.name] : "text-white/20"}`}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
            <span>PLANET_{p.name.toUpperCase()} ([{p.pos.join(", ")}])</span>
          </div>
        ))}
        <div className={`flex items-center gap-1.5 transition-colors ${activeZone === "contact" ? ZONE_COLORS.contact : "text-white/20"}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-[#ec4899]" />
          <span>PORTAL_SUN ([{PORTAL_POS.join(", ")}])</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Delete old hook, build, lint, test**

```bash
git rm src/hooks/useKeyboard.ts
npm run build && npm run lint && npm test
```
Expected: all pass. If `PlasmaAnomalies.tsx` still references `vehiclePos`, fix per Step 4 note.

- [ ] **Step 8: Manual verification (the money check)**

```bash
npm run dev
```
1. Fly with WASD — motion feels identical to before at 60Hz; warp (Space) works; boundary wrap flashes.
2. Open React DevTools Profiler, record 5s of steady flight: **expect zero component renders** (HUD numbers still ticking — they're rAF).
3. Approach each planet: proximity tip → orbit lock modal → THRUSTERS_BREAK_ORBIT works with 1.8s cooldown; contact portal opens Contact form.
4. Startup card visible at spawn, disappears when flying away.
5. HUD sector map shows real coordinates ([-110, 0, 110] etc.); gravity-lock line shows `>` not `&gt;`.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: transient flight store rewire — zero React renders during flight, delta-time physics

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Instanced asteroids

**Files:**
- Modify: `src/components/canvas/Asteroids.tsx` (full rewrite)

**Interfaces:**
- Consumes: optimized `/models/asteroid.glb` (Task 2)
- Produces: same `<Asteroids />` default export, no props

- [ ] **Step 1: Rewrite `src/components/canvas/Asteroids.tsx`**

```tsx
import { useRef, useMemo, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

interface AsteroidData {
  position: [number, number, number];
  scale: number;
  rotationSpeed: [number, number, number];
  initialRotation: [number, number, number];
}

const asteroidInstances: AsteroidData[] = [
  { position: [-40, -5, -60], scale: 1.5, rotationSpeed: [0.08, 0.05, 0.03], initialRotation: [0.2, 0.5, 0.1] },
  { position: [60, 2, 70], scale: 2.2, rotationSpeed: [-0.05, 0.08, 0.04], initialRotation: [1.2, 0.2, 0.5] },
  { position: [-90, -10, -20], scale: 1.2, rotationSpeed: [0.04, -0.06, 0.08], initialRotation: [0.5, 1.1, 0.2] },
  { position: [80, 5, -120], scale: 2.8, rotationSpeed: [0.03, 0.04, -0.05], initialRotation: [0.8, 0.3, 0.9] },
  { position: [-160, 3, 20], scale: 3.5, rotationSpeed: [-0.04, 0.03, 0.06], initialRotation: [2.1, 0.4, 0.2] },
  { position: [110, -8, 120], scale: 1.8, rotationSpeed: [0.06, -0.08, 0.03], initialRotation: [0.4, 1.8, 0.6] },
  { position: [-30, 6, 140], scale: 2.0, rotationSpeed: [0.05, 0.05, -0.04], initialRotation: [0.9, 0.9, 0.1] },
  { position: [140, -4, 40], scale: 1.4, rotationSpeed: [-0.03, 0.04, 0.07], initialRotation: [1.5, 0.2, 1.2] },
  { position: [-70, 0, -170], scale: 2.5, rotationSpeed: [0.07, -0.03, 0.05], initialRotation: [0.1, 0.5, 1.8] },
  { position: [40, -2, -190], scale: 3.0, rotationSpeed: [-0.06, 0.06, -0.03], initialRotation: [0.5, 2.2, 0.4] },
  { position: [-200, 4, -80], scale: 2.4, rotationSpeed: [0.04, 0.05, 0.08], initialRotation: [1.8, 0.1, 0.5] },
  { position: [210, -6, -30], scale: 1.6, rotationSpeed: [-0.05, -0.04, 0.05], initialRotation: [0.3, 0.8, 1.1] },
];

const COUNT = asteroidInstances.length;
const dummy = new THREE.Object3D();

export default function Asteroids() {
  const { scene } = useGLTF("/models/asteroid.glb");
  const gl = useThree((s) => s.gl);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Pull the single mesh's geometry+material out of the GLB
  const { geometry, material } = useMemo(() => {
    let g: THREE.BufferGeometry | undefined;
    let m: THREE.Material | undefined;
    scene.traverse((c) => {
      if (!g && c instanceof THREE.Mesh) { g = c.geometry; m = c.material as THREE.Material; }
    });
    if (!g || !m) throw new Error("asteroid.glb contains no mesh");
    return { geometry: g, material: m };
  }, [scene]);

  // Sharper texture sampling at grazing angles — effectively free
  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    const mat = material as THREE.MeshStandardMaterial;
    for (const tex of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap]) {
      if (tex) { tex.anisotropy = maxAniso; tex.needsUpdate = true; }
    }
  }, [material, gl]);

  useFrame((state) => {
    if (!meshRef.current) return;
    const time = state.clock.getElapsedTime();
    for (let i = 0; i < COUNT; i++) {
      const d = asteroidInstances[i];
      dummy.position.set(...d.position);
      dummy.rotation.set(
        d.initialRotation[0] + time * d.rotationSpeed[0],
        d.initialRotation[1] + time * d.rotationSpeed[1],
        d.initialRotation[2] + time * d.rotationSpeed[2],
      );
      dummy.scale.setScalar(d.scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, COUNT]} frustumCulled={false} />;
}
```
(`frustumCulled={false}` because instanced bounds don't account for the spread-out positions; 12 instances of one draw call is trivially cheap.)

- [ ] **Step 2: Verify + commit**

```bash
npm run build && npm run lint
npm run dev  # visually confirm 12 tumbling asteroids at the same positions as before
git add -A && git commit -m "perf: single InstancedMesh for asteroids + anisotropic filtering

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Canvas performance config

**Files:**
- Modify: `src/components/canvas/GlobalCanvas.tsx`

**Interfaces:**
- Consumes: `useSpaceStore` (`setLowPerf(true)` auto-degrade path, `lowPerfManual` guard)
- Produces: no API change

- [ ] **Step 1: Apply config changes**

In the `<Canvas>` `gl` prop: **delete** `preserveDrawingBuffer: true`.
Add imports: `import { Preload, Html, AdaptiveDpr, PerformanceMonitor } from "@react-three/drei";`
Inside `<Canvas>` add:

```tsx
        <AdaptiveDpr pixelated />
        <PerformanceMonitor
          onDecline={() => {
            const s = useSpaceStore.getState();
            if (!s.lowPerfManual && !s.isLowPerf) s.setLowPerf(true);
          }}
        />
```

- [ ] **Step 2: Verify + commit**

```bash
npm run build && npm run lint
npm run dev  # app renders normally; LOW_PERF button still toggles bloom
git add -A && git commit -m "perf: drop preserveDrawingBuffer, adaptive DPR, auto low-perf on decline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Image-based lighting + planet texture quality

**Files:**
- Modify: `src/components/canvas/GlobalCanvas.tsx` (Environment)
- Modify: `src/components/canvas/SpacePlanets.tsx` (anisotropy/color space)

**Interfaces:**
- Consumes: nothing new
- Produces: scene-wide `THREE.Scene.environment` via drei `<Environment>` — makes PBR normal/roughness/metalness detail readable on ship, asteroids, portal

- [ ] **Step 1: Add generated environment (no network fetch — presets download at runtime, so build one from Lightformers)**

In `GlobalCanvas.tsx`, import `Environment, Lightformer` from drei and add inside `<Suspense>`:

```tsx
          {/* Static generated IBL: cool spacelight + warm sun echo. frames={1} renders it once. */}
          <Environment resolution={64} frames={1}>
            <color attach="background" args={["#050310"]} />
            <Lightformer form="rect" intensity={1.1} color="#3a4a8f" position={[0, 8, -10]} scale={[14, 7, 1]} />
            <Lightformer form="rect" intensity={0.7} color="#ff5500" position={[9, -3, 4]} scale={[8, 4, 1]} />
            <Lightformer form="rect" intensity={0.6} color="#00f0ff" position={[-9, 2, 5]} scale={[6, 6, 1]} />
          </Environment>
```
Reduce `<ambientLight intensity={0.35} />` → `intensity={0.15}` (the env map now carries fill light).

- [ ] **Step 2: Planet texture sampling quality**

In `SpacePlanets.tsx` after the `useTexture` call:

```tsx
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    for (const tex of [earthTex, jupiterTex, marsTex]) {
      tex.anisotropy = maxAniso;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
  }, [earthTex, jupiterTex, marsTex, gl]);
```
(add `useThree` to the fiber import and `useEffect` to the react import).

- [ ] **Step 3: Verify + commit**

```bash
npm run build && npm run lint
npm run dev
```
Expected: asteroid surface detail and ship hull reflections visibly richer; scene not washed out (if too bright, drop Lightformer intensities by ~30% — note the change in the commit).
```bash
git add -A && git commit -m "feat: generated IBL environment + anisotropic sRGB planet textures

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Planet atmospheres

**Files:**
- Create: `src/components/canvas/Atmosphere.tsx`
- Modify: `src/components/canvas/SpacePlanets.tsx` (add one line per planet group)

**Interfaces:**
- Consumes: nothing
- Produces: `<Atmosphere radius={number} color={string} />` — fresnel glow shell, expects to be placed inside a planet's `<group>`

- [ ] **Step 1: Create `src/components/canvas/Atmosphere.tsx`**

```tsx
import { useMemo } from "react";
import * as THREE from "three";

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 3.0);
    gl_FragColor = vec4(uColor, fresnel * 1.15);
  }
`;

/** Fresnel rim-glow shell. Place inside a planet group; radius = planet radius. */
export default function Atmosphere({ radius, color }: { radius: number; color: string }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) } },
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [color]
  );
  return (
    <mesh material={material}>
      <sphereGeometry args={[radius * 1.12, 32, 32]} />
    </mesh>
  );
}
```

- [ ] **Step 2: Add to each planet group in `SpacePlanets.tsx`**

Inside each of the three planet `<group position={planets[i].pos}>` blocks, directly after the planet `<mesh>`:
```tsx
        <Atmosphere radius={planets[0].size} color={planets[0].color} />
```
(index 1 and 2 accordingly). Import: `import Atmosphere from "./Atmosphere";`

- [ ] **Step 3: Verify + commit**

```bash
npm run build && npm run lint
npm run dev  # each planet has a soft rim glow in its own color; no z-fighting with the aura core
git add -A && git commit -m "feat: fresnel atmosphere shells on project planets

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Engine trail, warp streaks, post-fx

**Files:**
- Modify: `src/components/canvas/Spaceship.tsx` (Trail + streak lines)
- Modify: `src/components/canvas/GlobalCanvas.tsx` (Vignette + ChromaticAberration)

**Interfaces:**
- Consumes: `useSpaceStore((s) => s.isWarping)` for warp-only effects
- Produces: no API change

- [ ] **Step 1: Engine trail in `Spaceship.tsx`**

Import `Trail` from drei. Inside the returned `<group ref={shipRef}>`, wrap an invisible anchor at the exhaust:

```tsx
      <Trail
        width={1.4}
        length={5}
        color="#00f0ff"
        attenuation={(t) => t * t}
      >
        <mesh position={[0, -0.04, -0.6]}>
          <sphereGeometry args={[0.02, 4, 4]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </Trail>
```
(The trail naturally collapses to nothing when stationary — no speed plumbing needed.)

- [ ] **Step 2: Upgrade dust points to stretched line streaks**

In `Spaceship.tsx`, replace the dust `<points>` + its geometry with line segments (2 verts per streak, tail stretched by speed):

```tsx
  const streakCount = 60;
  const streakGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const posArr = new Float32Array(streakCount * 2 * 3);
    for (let i = 0; i < streakCount; i++) {
      const x = (Math.random() - 0.5) * 8.0;
      const y = (Math.random() - 0.5) * 6.0;
      const z = (Math.random() - 0.5) * 10.0;
      posArr.set([x, y, z, x, y, z - 0.05], i * 6);
    }
    geom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    return geom;
  }, []);
  const streaksRef = useRef<THREE.LineSegments>(null);
```

Frame-loop block (replaces the old dust block):
```tsx
    if (streaksRef.current) {
      const attr = streaksRef.current.geometry.attributes.position;
      const data = attr.array as Float32Array;
      const speed = vel.current.length();
      const zSpeed = (warpActive ? 0.38 : 0.02 + (speed / 60) * 1.5) * dt * 60;
      const stretch = warpActive ? 2.2 : Math.min(0.6, 0.05 + speed * 0.04);
      for (let i = 0; i < streakCount; i++) {
        const head = i * 6;
        data[head + 2] += zSpeed;
        if (data[head + 2] > 5.0) {
          data[head] = (Math.random() - 0.5) * 8.0;
          data[head + 1] = (Math.random() - 0.5) * 6.0;
          data[head + 2] = -5.0;
        }
        data[head + 3] = data[head];
        data[head + 4] = data[head + 1];
        data[head + 5] = data[head + 2] - stretch;
      }
      attr.needsUpdate = true;
    }
```

JSX (replaces dust `<points>`):
```tsx
      <lineSegments ref={streaksRef} geometry={streakGeometry}>
        <lineBasicMaterial color="#00f0ff" transparent={true} opacity={0.5}
          blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
```
Delete `dustGeometry`, `dustRef`, `dustCount` and the old dust frame block.

- [ ] **Step 3: Post-fx in `GlobalCanvas.tsx`**

```tsx
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from "@react-three/postprocessing";
```
Inside the composer, after `<Bloom ... />`:
```tsx
              <Vignette eskil={false} offset={0.28} darkness={0.72} />
              {isWarping && <ChromaticAberration offset={[0.0022, 0.0014]} />}
```
with `const isWarping = useSpaceStore((s) => s.isWarping);` added to the component.

- [ ] **Step 4: Verify + commit**

```bash
npm run build && npm run lint
npm run dev
```
Expected: cyan ribbon trail while flying, collapses at rest; streak lines elongate hard during warp with color fringing at screen edges; subtle vignette always on; all of it disappears in LOW_PERF mode.
```bash
git add -A && git commit -m "feat: engine trail, stretched warp streaks, vignette + warp chromatic aberration

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Touch controls

**Files:**
- Create: `src/components/layout/TouchControls.tsx`
- Modify: `src/App.tsx` (mount it), `src/components/layout/HUDOverlay.tsx` (touch wording)

**Interfaces:**
- Consumes: `flight.input.steer/thrust/boost` (Task 3), `useMediaQuery` (existing hook)
- Produces: `<TouchControls />` — self-hiding on non-touch devices

- [ ] **Step 1: Create `src/components/layout/TouchControls.tsx`**

```tsx
import { useRef } from "react";
import { flight } from "../../store/spaceStore";
import { useMediaQuery } from "../../hooks/useMediaQuery";

const RADIUS = 56; // px travel of the joystick knob

/** Virtual joystick (left half) + boost button. Writes flight.input directly. */
export default function TouchControls() {
  const isCoarse = useMediaQuery("(pointer: coarse)");
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  if (!isCoarse) return null;

  const moveKnob = (dx: number, dy: number) => {
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = { x: e.clientX, y: e.clientY };
    if (baseRef.current) {
      baseRef.current.style.left = `${e.clientX - 72}px`;
      baseRef.current.style.top = `${e.clientY - 72}px`;
      baseRef.current.style.opacity = "1";
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!origin.current) return;
    const dx = Math.max(-RADIUS, Math.min(RADIUS, e.clientX - origin.current.x));
    const dy = Math.max(-RADIUS, Math.min(RADIUS, e.clientY - origin.current.y));
    flight.input.steer = dx / RADIUS;   // right = +1 (physics negates: stick right turns right)
    flight.input.thrust = -dy / RADIUS; // up = +1 forward, down = brake
    moveKnob(dx, dy);
  };

  const onPointerEnd = () => {
    origin.current = null;
    flight.input.steer = 0;
    flight.input.thrust = 0;
    moveKnob(0, 0);
    if (baseRef.current) baseRef.current.style.opacity = "0";
  };

  return (
    <>
      {/* Left-half touch zone: joystick appears where the finger lands */}
      <div
        className="fixed inset-y-0 left-0 w-1/2 z-40 pointer-events-auto touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      >
        <div
          ref={baseRef}
          className="absolute w-36 h-36 rounded-full border border-primary/30 bg-black/40 opacity-0 transition-opacity duration-150 flex items-center justify-center"
        >
          <div ref={knobRef} className="w-14 h-14 rounded-full bg-primary/25 border border-primary/60" />
        </div>
      </div>

      {/* Boost button */}
      <button
        className="fixed bottom-24 right-8 z-40 pointer-events-auto touch-none w-20 h-20 rounded-full border border-secondary/40 bg-black/50 font-mono text-[10px] text-secondary active:bg-secondary/20"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); flight.input.boost = true; }}
        onPointerUp={() => { flight.input.boost = false; }}
        onPointerCancel={() => { flight.input.boost = false; }}
      >
        BOOST
      </button>
    </>
  );
}
```

- [ ] **Step 2: Mount in `App.tsx`**

Next to `<HUDOverlay />` (only in space mode):
```tsx
      {!showClassicCV && <TouchControls />}
```

- [ ] **Step 3: Touch wording in `HUDOverlay.tsx`**

```tsx
  const isCoarse = useMediaQuery("(pointer: coarse)");
```
In the instruction card: `PILOT_STEER` value → `{isCoarse ? "LEFT JOYSTICK" : "WASD / ARROWS"}`, `WARP_DRIVE` value → `{isCoarse ? "BOOST BUTTON" : "SPACEBAR"}`, `SPAWN_PLASMA` value → `{isCoarse ? "TAP SPACE" : "CLICK SPACE"}`.

- [ ] **Step 4: Verify + commit**

```bash
npm run build && npm run lint
npm run dev
```
Chrome DevTools device emulation (e.g. iPhone): joystick appears under finger on left half, ship steers and thrusts; BOOST warps; instruction card shows touch wording. Desktop: no touch UI visible.
```bash
git add -A && git commit -m "feat: virtual joystick + boost touch controls

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Final verification pass

**Files:** none (verification only; fixes go in follow-up commits)

- [ ] **Step 1: Full gates**

```bash
npm run build && npm run lint && npm test
du -sh public/models   # expect < 4MB
```

- [ ] **Step 2: Full manual flight-test checklist (dev server)**

1. Load: "Initializing Star System..." then scene; network tab shows asteroid.glb < ~2MB.
2. WASD flight + Space warp + boundary wrap flash.
3. React DevTools profiler: zero renders during 5s steady flight.
4. All 3 planets: tip → orbit lock → dossier → break orbit (cooldown works).
5. Portal: contact form opens/closes.
6. Click space: plasma anomaly spawns at click point.
7. LOW_PERF toggle kills bloom/vignette/CA; RESET_SECTOR reloads.
8. VIEW_CLASSIC_RESUME: classic mode renders all sections; return works.
9. Touch emulation: joystick + boost.
10. Visual quality: asteroid close-up shows crisp texture + normal detail; planets show atmosphere rims; ship leaves trail.

- [ ] **Step 3: Record results**

Append a `## Verification` section with checklist outcomes + final asset sizes to this plan file, commit:
```bash
git add -A && git commit -m "docs: record verification results for smooth-space upgrade

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
