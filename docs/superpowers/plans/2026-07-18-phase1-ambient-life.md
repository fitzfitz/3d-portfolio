# Phase 1: Ambient Life Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the universe feel inhabited — synthesized ambient sound, an orbiting asteroid belt, planet cloud layers, a heading-up radar, contextual radio chatter, and shooting stars — with zero per-frame React state and zero new network assets.

**Architecture:** Six independent modules, each with one integration point. All animation reads the mutable `flight` object or the three.js clock inside `useFrame`/rAF loops. Discrete events flow through the existing guarded zustand store. Sound is a no-React singleton driven by store subscriptions and an rAF loop.

**Tech Stack:** React 19, TypeScript, @react-three/fiber 9, drei 10, three 0.185, zustand, Web Audio API (no new deps), vitest.

## Global Constraints

- No per-frame React setState anywhere; per-frame data only via `flight` / refs / rAF-to-DOM.
- All motion delta-time or clock-absolute (never per-frame constants).
- Repeated geometry uses InstancedMesh (belt) or pooled buffers (meteors).
- Low-perf mode: belt count 400 → 200; shooting stars unmounted; everything else unaffected.
- Zero new network assets; textures are canvas-generated.
- Sound: fully synthesized; ON by default at subtle volume; starts on first user gesture; mute persisted as `localStorage["fitz-sound-muted"]` = `"1"`/`"0"`; inert no-op if AudioContext unavailable.
- Spec: `docs/superpowers/specs/2026-07-18-phase1-ambient-life-design.md`.
- Every commit ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Gates for every task: `npm run build && npm run lint && npm test`.

## File Structure

- Create: `src/audio/soundManager.ts` (Web Audio singleton), `src/hooks/useSound.ts` (store→sound glue), `src/components/canvas/AsteroidBelt.tsx`, `src/components/canvas/CloudLayer.tsx`, `src/components/canvas/ShootingStars.tsx`, `src/components/layout/RadarMap.tsx`, `src/components/layout/RadioChatter.tsx`, `src/data/chatterLines.ts`, `src/utils/chatterScheduler.ts`
- Create tests: `tests/wrapDelta.test.ts`, `tests/chatterScheduler.test.ts`, additions to `tests/spaceStore.test.ts`
- Modify: `src/utils/toroidal.ts`, `src/store/spaceStore.ts`, `src/components/canvas/Spaceship.tsx`, `src/components/canvas/SpacePlanets.tsx`, `src/components/canvas/GlobalCanvas.tsx`, `src/components/layout/HUDOverlay.tsx`, `src/App.tsx`

---

### Task 1: Foundations — wrapDelta, isMuted, flight.heading

**Files:**
- Modify: `src/utils/toroidal.ts`, `src/store/spaceStore.ts`, `src/components/canvas/Spaceship.tsx`
- Test: `tests/wrapDelta.test.ts`, `tests/spaceStore.test.ts` (append)

**Interfaces:**
- Consumes: existing `flight`, `useSpaceStore`, `toroidalDistance`
- Produces (later tasks import these exact names):
  - `wrapDelta(from: number, to: number, bounds: number): number` from `src/utils/toroidal.ts` — signed shortest delta on an axis wrapping at ±bounds
  - Store: `isMuted: boolean`, `setMuted(v: boolean): void` (persists to `localStorage["fitz-sound-muted"]`)
  - `flight.heading: number` — ship yaw in radians, written every frame by Spaceship

- [ ] **Step 1: Write failing tests**

`tests/wrapDelta.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { wrapDelta } from "../src/utils/toroidal";

describe("wrapDelta", () => {
  it("returns the plain delta when no wrap is shorter", () => {
    expect(wrapDelta(0, 100, 250)).toBe(100);
    expect(wrapDelta(100, 0, 250)).toBe(-100);
  });
  it("wraps when crossing the boundary is shorter", () => {
    // from -245 to 245: direct is +490, through the edge is -10
    expect(wrapDelta(-245, 245, 250)).toBe(-10);
    expect(wrapDelta(245, -245, 250)).toBe(10);
  });
  it("is consistent with toroidalDistance", () => {
    const d = wrapDelta(-245, 240, 250);
    expect(Math.abs(d)).toBeCloseTo(15);
  });
});
```

Append to `tests/spaceStore.test.ts` (inside the existing describe, and add `isMuted: false` to the `beforeEach` setState object):
```ts
  it("setMuted persists to localStorage", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    useSpaceStore.getState().setMuted(true);
    expect(useSpaceStore.getState().isMuted).toBe(true);
    expect(store["fitz-sound-muted"]).toBe("1");
    useSpaceStore.getState().setMuted(false);
    expect(store["fitz-sound-muted"]).toBe("0");
    vi.unstubAllGlobals();
  });
```

- [ ] **Step 2: Run tests, verify failures**

Run: `npm test`
Expected: FAIL — `wrapDelta` is not exported; `setMuted` is not a function.

- [ ] **Step 3: Implement**

Append to `src/utils/toroidal.ts`:
```ts
/** Signed shortest delta from `from` to `to` on an axis wrapping at ±bounds. */
export function wrapDelta(from: number, to: number, bounds: number): number {
  const span = bounds * 2;
  let d = to - from;
  if (d > bounds) d -= span;
  else if (d < -bounds) d += span;
  return d;
}
```

In `src/store/spaceStore.ts`:
1. Add `heading: 0,` to the `flight` object (after `speed: 0,`) with comment `// yaw in radians, written by Spaceship each frame`.
2. Add to the `SpaceState` interface: `isMuted: boolean;` and `setMuted: (v: boolean) => void;`
3. Add to the store implementation:
```ts
    isMuted:
      typeof localStorage !== "undefined" &&
      localStorage.getItem("fitz-sound-muted") === "1",
    setMuted: (v) => {
      set({ isMuted: v });
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("fitz-sound-muted", v ? "1" : "0");
      }
    },
```

In `src/components/canvas/Spaceship.tsx`, in the telemetry block (`// 6. Publish telemetry`), add one line after `flight.speed = ...`:
```ts
    flight.heading = angle.current;
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test` — all tests pass (previous 8 + 4 new). Then `npm run build && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wrapDelta util, isMuted store field, flight.heading telemetry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Synthesized sound

**Files:**
- Create: `src/audio/soundManager.ts`, `src/hooks/useSound.ts`
- Modify: `src/App.tsx` (call `useSound()`), `src/components/layout/HUDOverlay.tsx` (mute button)

**Interfaces:**
- Consumes: `flight` (speed), `useSpaceStore` (`isWarping`, `isOrbitLocked`, `isTeleporting`, `isMuted`, `setMuted`) — subscribeWithSelector is already on the store
- Produces: `soundManager` singleton with `init()`, `setMuted(v: boolean)`, `startLoop()`, `stopLoop()`, `chime()`, `thunk()`, `zap()`, `uiTick()`; `useSound(): void` hook mounted once in App

- [ ] **Step 1: Create `src/audio/soundManager.ts`**

```ts
import { flight, useSpaceStore } from "../store/spaceStore";

/**
 * Fully synthesized Web Audio soundscape. No assets, no React.
 * Inert no-op if AudioContext is unavailable or construction throws.
 * init() must be called from a user gesture (browser autoplay policy).
 */
class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private warpGain: GainNode | null = null;
  private muted = false;
  private rafId: number | null = null;

  init() {
    if (this.ctx) return;
    try {
      const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);

      // Engine hum: looped brown-noise buffer -> lowpass -> gain
      const noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
      const noise = this.ctx.createBufferSource();
      noise.buffer = noiseBuf;
      noise.loop = true;
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = "lowpass";
      this.engineFilter.frequency.value = 200;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      noise.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
      noise.start();

      // Warp layer: detuned saw pair -> gain (0 until warping)
      this.warpGain = this.ctx.createGain();
      this.warpGain.gain.value = 0;
      for (const detune of [-7, 7]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = 55;
        osc.detune.value = detune;
        osc.connect(this.warpGain);
        osc.start();
      }
      const warpFilter = this.ctx.createBiquadFilter();
      warpFilter.type = "lowpass";
      warpFilter.frequency.value = 400;
      this.warpGain.connect(warpFilter).connect(this.master);

      // Ambient pad: two slow detuned oscillators, barely audible
      const padGain = this.ctx.createGain();
      padGain.gain.value = 0;
      padGain.gain.setTargetAtTime(0.03, this.ctx.currentTime, 4);
      for (const [type, freq] of [["sine", 65.4], ["triangle", 98.0]] as const) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;
        osc.detune.value = Math.random() * 6 - 3;
        osc.connect(padGain);
        osc.start();
      }
      padGain.connect(this.master);
    } catch {
      this.ctx = null; // stay inert forever
    }
  }

  setMuted(v: boolean) {
    this.muted = v;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(v ? 0 : 1, this.ctx.currentTime, 0.05);
    }
  }

  startLoop() {
    if (this.rafId !== null) return;
    const tick = () => {
      if (this.ctx && this.engineFilter && this.engineGain && this.warpGain) {
        const t = this.ctx.currentTime;
        const speedNorm = Math.min(1, flight.speed / 10.8);
        this.engineFilter.frequency.setTargetAtTime(200 + speedNorm * 700, t, 0.1);
        this.engineGain.gain.setTargetAtTime(speedNorm * 0.08, t, 0.15);
        const warping = useSpaceStore.getState().isWarping;
        this.warpGain.gain.setTargetAtTime(warping ? 0.06 : 0, t, warping ? 0.08 : 0.25);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stopLoop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private blip(type: OscillatorType, freq: number, dur: number, vol: number, sweepTo?: number) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Orbit lock: two-note minor-third chime */
  chime() {
    this.blip("sine", 659.25, 0.5, 0.1);
    setTimeout(() => this.blip("sine", 783.99, 0.7, 0.1), 120);
  }
  /** Orbit break: low thunk */
  thunk() {
    this.blip("triangle", 130, 0.18, 0.12, 70);
  }
  /** Boundary-wrap teleport: descending zap */
  zap() {
    this.blip("sawtooth", 1200, 0.3, 0.06, 180);
  }
  /** Chatter line tick */
  uiTick() {
    this.blip("square", 880, 0.04, 0.025);
  }
}

export const soundManager = new SoundManager();
```

- [ ] **Step 2: Create `src/hooks/useSound.ts`**

```ts
import { useEffect } from "react";
import { soundManager } from "../audio/soundManager";
import { useSpaceStore } from "../store/spaceStore";

/** Mount once in App: gesture-gated init, store-event one-shots, engine-hum loop. */
export function useSound() {
  const isMuted = useSpaceStore((s) => s.isMuted);

  useEffect(() => {
    soundManager.setMuted(isMuted);
  }, [isMuted]);

  useEffect(() => {
    const start = () => soundManager.init();
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });

    const unsubs = [
      useSpaceStore.subscribe(
        (s) => s.isOrbitLocked,
        (locked) => (locked ? soundManager.chime() : soundManager.thunk())
      ),
      useSpaceStore.subscribe(
        (s) => s.isTeleporting,
        (flash) => { if (flash) soundManager.zap(); }
      ),
    ];
    soundManager.startLoop();

    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      unsubs.forEach((u) => u());
      soundManager.stopLoop();
    };
  }, []);
}
```

- [ ] **Step 3: Wire into App and HUD**

`src/App.tsx`: add `import { useSound } from "./hooks/useSound";` and call `useSound();` as the first line of the App component body (next to `useKeyboardInput()`).

`src/components/layout/HUDOverlay.tsx`: add `Volume2, VolumeX` to the lucide import. Add store reads `const isMuted = useSpaceStore((s) => s.isMuted);` and `const setMuted = useSpaceStore((s) => s.setMuted);`. In the bottom-left button cluster, after the RESET_SECTOR button, add:
```tsx
        <button
          onClick={() => setMuted(!isMuted)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all duration-300 ${
            isMuted
              ? "border-white/5 bg-white/2 text-white/30"
              : "border-primary/25 bg-primary/5 text-primary"
          }`}
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          <span>{isMuted ? "SOUND_OFF" : "SOUND_ON"}</span>
        </button>
```

- [ ] **Step 4: Gates**

Run: `npm run build && npm run lint && npm test` — all pass (sound has no unit tests: it's Web Audio glue, verified manually; the store side was tested in Task 1).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: synthesized ambient sound — engine hum, warp layer, event chimes, mute toggle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Asteroid belt

**Files:**
- Create: `src/components/canvas/AsteroidBelt.tsx`
- Modify: `src/components/canvas/GlobalCanvas.tsx` (mount inside Suspense, after `<Asteroids />`)

**Interfaces:**
- Consumes: `/models/asteroid.glb` via `useGLTF` (cached — shares Task-6-of-previous-plan GPU resources), `useSpaceStore` (`isLowPerf`)
- Produces: `<AsteroidBelt />`, no props

- [ ] **Step 1: Create `src/components/canvas/AsteroidBelt.tsx`**

```tsx
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { useSpaceStore } from "../../store/spaceStore";

const COUNT_FULL = 400;
const COUNT_LOW = 200;
const dummy = new THREE.Object3D();

/** Deterministic PRNG so the belt is identical every load. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BeltRock {
  radius: number; y: number; speed: number; phase: number;
  spinX: number; spinY: number; scale: number;
}

export default function AsteroidBelt() {
  const { scene } = useGLTF("/models/asteroid.glb");
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const count = isLowPerf ? COUNT_LOW : COUNT_FULL;
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const { geometry, material } = useMemo(() => {
    let g: THREE.BufferGeometry | undefined;
    let m: THREE.Material | undefined;
    scene.traverse((c) => {
      if (!g && c instanceof THREE.Mesh) { g = c.geometry; m = c.material as THREE.Material; }
    });
    if (!g || !m) throw new Error("asteroid.glb contains no mesh");
    return { geometry: g, material: m };
  }, [scene]);

  const rocks = useMemo<BeltRock[]>(() => {
    const rand = mulberry32(42);
    return Array.from({ length: COUNT_FULL }, () => {
      const radius = 40 + rand() * 30;
      return {
        radius,
        y: (rand() - 0.5) * 5,
        // Kepler-ish: inner rocks orbit faster (0.020 at r=40 down to 0.008 at r=70)
        speed: 0.02 - ((radius - 40) / 30) * 0.012,
        phase: rand() * Math.PI * 2,
        spinX: 0.2 + rand() * 0.6,
        spinY: 0.2 + rand() * 0.6,
        scale: 0.05 + rand() * 0.17,
      };
    });
  }, []);

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
    <group rotation={[0.07, 0, 0]}>
      <instancedMesh
        key={count}
        ref={meshRef}
        args={[geometry, material, count]}
        frustumCulled={false}
      />
    </group>
  );
}
```

- [ ] **Step 2: Mount in `src/components/canvas/GlobalCanvas.tsx`**

Import `AsteroidBelt` and render `<AsteroidBelt />` directly after `<Asteroids />` inside the Suspense.

- [ ] **Step 3: Gates + visual check**

`npm run build && npm run lint && npm test`. Dev-server check is pending for the controller (belt visible orbiting the sun, halves in LOW_PERF).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: instanced asteroid belt orbiting the central sun

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Planet cloud layers

**Files:**
- Create: `src/components/canvas/CloudLayer.tsx`
- Modify: `src/components/canvas/SpacePlanets.tsx` (one CloudLayer per planet group)

**Interfaces:**
- Consumes: nothing new
- Produces: `<CloudLayer radius={number} tint={string} speed={number} />` — self-rotating translucent cloud shell placed inside a planet group

- [ ] **Step 1: Create `src/components/canvas/CloudLayer.tsx`**

```tsx
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// One shared wispy alpha texture for all planets, generated once at module load.
// Stacked soft radial blobs (same trick as the nebula sprite) read as cloud bands.
const cloudTexture = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const rBlob = 6 + Math.random() * 26;
      const a = 0.04 + Math.random() * 0.1;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, rBlob);
      grad.addColorStop(0, `rgba(255,255,255,${a})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      // draw twice offset by width so the seam tiles horizontally
      ctx.fillRect(0, 0, 256, 256);
      ctx.save();
      ctx.translate(x < 128 ? 256 : -256, 0);
      ctx.fillRect(0, 0, 256, 256);
      ctx.restore();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
})();

interface CloudLayerProps {
  radius: number;
  tint?: string;
  /** rotation in rad/s (planet surface speeds are ~0.08-0.16; pass ~1.4x that) */
  speed?: number;
}

export default function CloudLayer({ radius, tint = "#ffffff", speed = 0.17 }: CloudLayerProps) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = state.clock.getElapsedTime() * speed;
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[radius * 1.03, 32, 32]} />
      <meshStandardMaterial
        color={tint}
        alphaMap={cloudTexture}
        transparent={true}
        opacity={0.35}
        depthWrite={false}
        roughness={1}
        metalness={0}
      />
    </mesh>
  );
}
```

- [ ] **Step 2: Add to each planet group in `src/components/canvas/SpacePlanets.tsx`**

Import `CloudLayer`. Inside each planet group, directly after its `<Atmosphere ... />` line (planet surface speeds are 0.12 / 0.08 / 0.16 — clouds at 1.4×):
```tsx
        <CloudLayer radius={planets[0].size} tint="#ffffff" speed={0.168} />
```
```tsx
        <CloudLayer radius={planets[1].size} tint="#bff5ff" speed={0.112} />
```
```tsx
        <CloudLayer radius={planets[2].size} tint="#ffd9c2" speed={0.224} />
```

- [ ] **Step 3: Gates + commit**

`npm run build && npm run lint && npm test` (visual check pending for controller: rotating wisps over each planet, no z-fighting with atmosphere shells).

```bash
git add -A
git commit -m "feat: rotating procedural cloud layers on project planets

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Radar minimap

**Files:**
- Create: `src/components/layout/RadarMap.tsx`
- Modify: `src/components/layout/HUDOverlay.tsx` (mount above the bottom-left buttons)

**Interfaces:**
- Consumes: `flight` (x, z, heading), `useSpaceStore.getState().activeZone`, `planets`/`PORTAL_POS`/`COSMIC_BOUNDS` from constants, `wrapDelta` from Task 1
- Produces: `<RadarMap />`, display-only, `pointer-events-none`

- [ ] **Step 1: Create `src/components/layout/RadarMap.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { COSMIC_BOUNDS, PORTAL_POS, planets } from "../../constants";
import { flight, useSpaceStore } from "../../store/spaceStore";
import { wrapDelta } from "../../utils/toroidal";

const SIZE = 148;
const RANGE = 120; // world units mapped to radar radius
const targets = [
  ...planets.map((p) => ({ name: p.name, x: p.pos[0], z: p.pos[2], color: p.color })),
  { name: "contact", x: PORTAL_POS[0], z: PORTAL_POS[2], color: "#ec4899" },
  { name: "sun", x: 0, z: 0, color: "#ff5500" },
];

/** Heading-up radar. Canvas 2D, own rAF loop, zero React renders. */
export default function RadarMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf: number;
    const c = SIZE / 2;
    const rimR = c - 6;
    const scale = rimR / RANGE;

    const draw = () => {
      const now = performance.now() / 1000;
      ctx.clearRect(0, 0, SIZE, SIZE);

      // Frame + range rings
      ctx.strokeStyle = "rgba(0,255,135,0.25)";
      ctx.lineWidth = 1;
      for (const r of [rimR, rimR * 0.66, rimR * 0.33]) {
        ctx.beginPath();
        ctx.arc(c, c, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Sweep line
      const sweep = (now * 1.2) % (Math.PI * 2);
      const grad = ctx.createLinearGradient(c, c, c + Math.cos(sweep) * rimR, c + Math.sin(sweep) * rimR);
      grad.addColorStop(0, "rgba(0,255,135,0)");
      grad.addColorStop(1, "rgba(0,255,135,0.35)");
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + Math.cos(sweep) * rimR, c + Math.sin(sweep) * rimR);
      ctx.stroke();

      // Blips (heading-up: rotate world deltas by ship heading)
      const a = flight.heading;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const activeZone = useSpaceStore.getState().activeZone;
      for (const t of targets) {
        const dx = wrapDelta(flight.x, t.x, COSMIC_BOUNDS);
        const dz = wrapDelta(flight.z, t.z, COSMIC_BOUNDS);
        // right = (cosA, -sinA), forward = (sinA, cosA)
        const sx = dx * cosA - dz * sinA;
        const up = dx * sinA + dz * cosA;
        let px = sx * scale;
        let py = -up * scale;
        const dist = Math.hypot(px, py);
        let onRim = false;
        if (dist > rimR - 3) {
          const k = (rimR - 3) / dist;
          px *= k; py *= k; onRim = true;
        }
        const pulse = activeZone === t.name ? 1 + 0.5 * Math.sin(now * 8) : 1;
        ctx.globalAlpha = onRim ? 0.45 : 1;
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.arc(c + px, c + py, (t.name === "sun" ? 3 : 2.4) * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Ship chevron (always center, pointing up)
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c - 4, c + 4);
      ctx.lineTo(c, c - 5);
      ctx.lineTo(c + 4, c + 4);
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="absolute bottom-24 left-6 pointer-events-none rounded-full border border-primary/20 bg-black/50" style={{ width: SIZE, height: SIZE }}>
      <canvas ref={canvasRef} width={SIZE} height={SIZE} />
      <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] text-primary/50 font-mono">RADAR.SYS</div>
    </div>
  );
}
```

- [ ] **Step 2: Mount in `src/components/layout/HUDOverlay.tsx`**

Import and render `<RadarMap />` as a direct child of the HUD root div (its own absolute positioning places it above the bottom-left buttons — the buttons sit at `bottom-10`, radar at `bottom-24` clears them at all sizes... verify visually; if overlapping, change radar to `bottom-28`).

- [ ] **Step 3: Gates + commit**

`npm run build && npm run lint && npm test` (controller verifies: blips match world layout, rotates with heading, rim-clamping for far targets, pulse in gravity zones, wrap-correct near boundaries).

```bash
git add -A
git commit -m "feat: heading-up radar minimap with toroidal-aware blips

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Radio chatter

**Files:**
- Create: `src/utils/chatterScheduler.ts`, `src/data/chatterLines.ts`, `src/components/layout/RadioChatter.tsx`
- Modify: `src/components/layout/HUDOverlay.tsx` (mount bottom-center)
- Test: `tests/chatterScheduler.test.ts`

**Interfaces:**
- Consumes: `useSpaceStore` (`activeZone`, `isTeleporting`, `isWarping`), `soundManager.uiTick()`
- Produces: `ChatterScheduler` class (`pick(kind, zone?)`, `nextDelayMs()`), `ChatterPools` interface, `chatterPools` data export, `<RadioChatter />`

- [ ] **Step 1: Write failing tests**

`tests/chatterScheduler.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ChatterScheduler, type ChatterPools } from "../src/utils/chatterScheduler";

const pools: ChatterPools = {
  deepSpace: ["ds-1", "ds-2", "ds-3"],
  zones: { saas: ["saas-1", "saas-2"], video: ["video-1"] },
  warp: ["warp-1", "warp-2"],
  wrap: ["wrap-1"],
};

describe("ChatterScheduler", () => {
  it("picks from the zone pool when a known zone is given", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("zone", "saas")).toBe("saas-1");
  });
  it("falls back to deepSpace for unknown zones", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("zone", "nope")).toBe("ds-1");
  });
  it("never repeats the immediately-previous line when the pool has 2+ lines", () => {
    const s = new ChatterScheduler(pools, () => 0);
    const first = s.pick("ambient");
    const second = s.pick("ambient");
    expect(second).not.toBe(first);
  });
  it("allows repeats for single-line pools", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("wrap")).toBe("wrap-1");
    expect(s.pick("wrap")).toBe("wrap-1");
  });
  it("nextDelayMs stays within [18000, 35000]", () => {
    const lo = new ChatterScheduler(pools, () => 0);
    const hi = new ChatterScheduler(pools, () => 0.9999999);
    expect(lo.nextDelayMs()).toBe(18000);
    expect(hi.nextDelayMs()).toBeLessThanOrEqual(35000);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npm test` — FAIL, cannot resolve `../src/utils/chatterScheduler`.

- [ ] **Step 3: Implement `src/utils/chatterScheduler.ts`**

```ts
export interface ChatterPools {
  deepSpace: string[];
  zones: Record<string, string[]>;
  warp: string[];
  wrap: string[];
}

export type ChatterKind = "ambient" | "zone" | "warp" | "wrap";

/** Pure line-selection + pacing logic. Injectable RNG for tests. */
export class ChatterScheduler {
  private lastLine: string | null = null;

  constructor(
    private pools: ChatterPools,
    private random: () => number = Math.random
  ) {}

  pick(kind: ChatterKind, zone?: string | null): string {
    let pool: string[];
    if (kind === "zone" && zone && this.pools.zones[zone]) pool = this.pools.zones[zone];
    else if (kind === "warp") pool = this.pools.warp;
    else if (kind === "wrap") pool = this.pools.wrap;
    else pool = this.pools.deepSpace;

    const candidates = pool.length > 1 ? pool.filter((l) => l !== this.lastLine) : pool;
    const line = candidates[Math.floor(this.random() * candidates.length)];
    this.lastLine = line;
    return line;
  }

  nextDelayMs(): number {
    return 18000 + Math.floor(this.random() * 17000);
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

`npm test` — all pass.

- [ ] **Step 5: Create `src/data/chatterLines.ts`**

```ts
import type { ChatterPools } from "../utils/chatterScheduler";

/** All radio-chatter copy lives here — edit freely, one line per entry. */
export const chatterPools: ChatterPools = {
  deepSpace: [
    "LONG_RANGE_SCAN: 99.7% VACUUM // 0.3% AMBITION",
    "STARFIELD INDEX RECALIBRATED. 2,500 POINTS TRACKED",
    "HULL INTEGRITY NOMINAL. COFFEE RESERVES: CRITICAL",
    "INCOMING TRANSMISSION... SIGNAL LOST. PROBABLY A RECRUITER",
    "NAV.AI SUGGESTS: FLY TOWARD THE GLOWING PLANETS",
    "BACKGROUND RADIATION WITHIN PORTFOLIO LIMITS",
    "DEEP SPACE IS QUIET. TOO QUIET. SPAWN A PLASMA ANOMALY?",
    "TELEMETRY ARCHIVED. NOBODY WILL EVER READ IT",
    "ASTEROID BELT DENSITY: DECORATIVE",
  ],
  zones: {
    saas: [
      "ENTERING SAAS SECTOR // 15,000 SUBSCRIPTIONS IN STABLE ORBIT",
      "DETECTED: SCHEMA-ISOLATED TENANTS. IMPRESSIVE CONTAINMENT FIELD",
      "STRIPE CONNECT RELAYS ONLINE. FEE SPLITS NOMINAL",
      "WARNING: SUB-MILLISECOND ROUTE RESOLUTION AHEAD",
    ],
    video: [
      "ENTERING VIDEO SECTOR // SEMANTIC SCENE PARSER ACTIVE",
      "WHISPER ARRAYS TRANSCRIBING LOCAL PODCAST NEBULAE",
      "EMOTION CLASSIFIERS REPORT: HIGH RETENTION PROBABILITY",
      "CLIPPING VERTICAL VIDEO... EXPORT QUEUE SYNCED",
    ],
    agent: [
      "ENTERING AGENT SECTOR // HIERARCHY MANAGERS COORDINATING",
      "CODER AND REVIEW AGENTS RUNNING LOCAL TDD CYCLES",
      "OPENSPEC DOCUMENTS PARSED. FEATURE FILES PLANNED",
      "PR VALIDATION CHECKS: STANDARDIZED. VELOCITY: OPTIMIZED",
    ],
    contact: [
      "PORTAL GATEWAY IN RANGE // COMM-LINK READY",
      "THE PILOT ACCEPTS TRANSMISSIONS. DOCK TO COMPOSE",
      "STARGATE HARMONICS STABLE. SAY HELLO",
    ],
  },
  warp: [
    "WARP CORE ENGAGED. HOLD ONTO YOUR RESUME",
    "RELATIVISTIC EFFECTS DETECTED IN CSS ANIMATIONS",
    "SPEED LIMIT? IN DEEP SPACE? BOLD ASSUMPTION",
  ],
  wrap: [
    "SECTOR BOUNDARY CROSSED. TOPOLOGY: TOROIDAL. YOU'RE BACK",
    "CONGRATULATIONS: YOU CIRCUMNAVIGATED THE PORTFOLIO",
    "EDGE OF SPACE REACHED. SPACE DISAGREES",
  ],
};
```

- [ ] **Step 6: Create `src/components/layout/RadioChatter.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { ChatterScheduler } from "../../utils/chatterScheduler";
import { chatterPools } from "../../data/chatterLines";
import { useSpaceStore } from "../../store/spaceStore";
import { soundManager } from "../../audio/soundManager";

/** Typewriter terminal line, bottom-center HUD. rAF + DOM writes, no React state. */
export default function RadioChatter() {
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scheduler = new ChatterScheduler(chatterPools);
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const typeLine = (text: string) => {
      if (disposed || !lineRef.current) return;
      soundManager.uiTick();
      const el = lineRef.current;
      const full = `> ${text}`;
      const startedAt = performance.now();
      const type = () => {
        if (disposed) return;
        const chars = Math.min(full.length, Math.floor((performance.now() - startedAt) / 22));
        el.textContent = full.slice(0, chars);
        if (chars < full.length) raf = requestAnimationFrame(type);
      };
      raf = requestAnimationFrame(type);
    };

    const scheduleAmbient = () => {
      timer = setTimeout(() => {
        const s = useSpaceStore.getState();
        typeLine(
          s.isWarping
            ? scheduler.pick("warp")
            : scheduler.pick(s.activeZone ? "zone" : "ambient", s.activeZone)
        );
        scheduleAmbient();
      }, scheduler.nextDelayMs());
    };

    // Zone entry + boundary wrap interrupt the ambient cadence immediately
    const unsubs = [
      useSpaceStore.subscribe(
        (s) => s.activeZone,
        (zone) => { if (zone) typeLine(scheduler.pick("zone", zone)); }
      ),
      useSpaceStore.subscribe(
        (s) => s.isTeleporting,
        (flash) => { if (flash) typeLine(scheduler.pick("wrap")); }
      ),
    ];

    typeLine(scheduler.pick("ambient"));
    scheduleAmbient();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      unsubs.forEach((u) => u());
    };
  }, []);

  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 max-w-[60vw] pointer-events-none">
      <div ref={lineRef} className="font-mono text-[9px] text-primary/60 whitespace-nowrap overflow-hidden text-ellipsis" />
    </div>
  );
}
```

- [ ] **Step 7: Mount in HUD + gates + commit**

Import and render `<RadioChatter />` as a direct child of the HUD root div in `HUDOverlay.tsx`.

`npm run build && npm run lint && npm test` — all pass.

```bash
git add -A
git commit -m "feat: contextual radio chatter with typewriter terminal line (scheduler TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Shooting stars

**Files:**
- Create: `src/components/canvas/ShootingStars.tsx`
- Modify: `src/components/canvas/GlobalCanvas.tsx` (mount gated on `!isLowPerf`)

**Interfaces:**
- Consumes: nothing new (camera from useFrame state)
- Produces: `<ShootingStars />`; parent gates mounting: `{!isLowPerf && <ShootingStars />}` (GlobalCanvas already selects `isLowPerf`)

- [ ] **Step 1: Create `src/components/canvas/ShootingStars.tsx`**

```tsx
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const POOL = 4;
const SPAWN_MIN = 4;   // seconds
const SPAWN_SPAN = 8;  // spawn interval = 4-12s
const MAX_CONCURRENT = 2;

interface Meteor {
  active: boolean;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  age: number;
  ttl: number;
}

/** Pooled meteor streaks on the far sphere. Parent must gate on !isLowPerf. */
export default function ShootingStars() {
  const linesRef = useRef<THREE.LineSegments>(null);
  const nextSpawn = useRef(2);

  const { geometry, meteors } = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(POOL * 6), 3));
    geom.setAttribute("color", new THREE.BufferAttribute(new Float32Array(POOL * 6), 3));
    const m: Meteor[] = Array.from({ length: POOL }, () => ({
      active: false,
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      speed: 0,
      age: 0,
      ttl: 0,
    }));
    return { geometry: geom, meteors: m };
  }, []);

  useFrame((state, delta) => {
    if (!linesRef.current) return;
    const dt = Math.min(delta, 0.05);
    const t = state.clock.getElapsedTime();

    // Spawner
    if (t > nextSpawn.current) {
      nextSpawn.current = t + SPAWN_MIN + Math.random() * SPAWN_SPAN;
      const activeCount = meteors.filter((m) => m.active).length;
      const slot = meteors.find((m) => !m.active);
      if (slot && activeCount < MAX_CONCURRENT) {
        // Random point on a far sphere around the camera, moving along a random tangent
        const dir = new THREE.Vector3().randomDirection();
        slot.pos.copy(state.camera.position).addScaledVector(dir, 190);
        slot.dir.copy(dir).cross(new THREE.Vector3().randomDirection()).normalize();
        slot.speed = 120 + Math.random() * 80;
        slot.age = 0;
        slot.ttl = 0.8 + Math.random() * 0.6;
        slot.active = true;
      }
    }

    // Update
    const posAttr = linesRef.current.geometry.attributes.position;
    const colAttr = linesRef.current.geometry.attributes.color;
    const pos = posAttr.array as Float32Array;
    const col = colAttr.array as Float32Array;
    meteors.forEach((m, i) => {
      const o = i * 6;
      if (!m.active) {
        col.fill(0, o, o + 6); // black = invisible with additive blending
        return;
      }
      m.age += dt;
      if (m.age >= m.ttl) { m.active = false; return; }
      m.pos.addScaledVector(m.dir, m.speed * dt);
      const tailLen = 6 + m.speed * 0.06;
      pos[o] = m.pos.x; pos[o + 1] = m.pos.y; pos[o + 2] = m.pos.z;
      pos[o + 3] = m.pos.x - m.dir.x * tailLen;
      pos[o + 4] = m.pos.y - m.dir.y * tailLen;
      pos[o + 5] = m.pos.z - m.dir.z * tailLen;
      // Fade in fast, fade out over life: brightness IS alpha under additive blending
      const life = m.age / m.ttl;
      const bright = Math.min(1, life * 6) * (1 - life);
      col[o] = bright; col[o + 1] = bright; col[o + 2] = bright;         // white head
      col[o + 3] = 0; col[o + 4] = bright * 0.5; col[o + 5] = bright * 0.6; // teal tail
    });
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  });

  return (
    <lineSegments ref={linesRef} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial
        vertexColors={true}
        transparent={true}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </lineSegments>
  );
}
```

- [ ] **Step 2: Mount in `src/components/canvas/GlobalCanvas.tsx`**

Import `ShootingStars`; inside the Suspense add `{!isLowPerf && <ShootingStars />}` (the `isLowPerf` selector already exists in GlobalCanvas).

- [ ] **Step 3: Gates + commit**

`npm run build && npm run lint && npm test`.

```bash
git add -A
git commit -m "feat: pooled shooting-star streaks in the far sky

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Final verification pass

**Files:** none (verification; fixes as follow-up commits)

- [ ] **Step 1: Gates**

```bash
npm run build && npm run lint && npm test
du -sh public/models   # unchanged (~3.9MB) — this phase added zero assets
```

- [ ] **Step 2: Manual checklist (dev server / preview)**

1. First keypress starts sound; engine hum rises with speed; warp adds the low saw layer; orbit lock chimes; orbit break thunks; boundary wrap zaps; chatter ticks.
2. SOUND_ON/OFF toggle works and survives reload (localStorage).
3. Belt: ring of small rocks orbiting the sun, inner ones faster; count visibly halves in LOW_PERF.
4. Clouds: each planet has drifting wisps above the surface, no z-fighting.
5. Radar: blips match world layout, rotates heading-up, far targets clamp to rim dimmed, gravity-zone blip pulses, correct across a boundary wrap.
6. Chatter: ambient lines every ~18-35s; entering any planet zone interrupts with a zone line; wrap fires a wrap line; no immediate repeats.
7. Shooting stars: streak every ~4-12s, max 2 at once; gone in LOW_PERF.
8. Profiler: still zero React renders during steady flight (sound/radar/chatter are all rAF+DOM).
9. React StrictMode dev-mode double-mount does not double sound (soundManager.init is idempotent; useSound cleanup unsubscribes).

- [ ] **Step 3: Record results + commit**

Append a `## Verification` section with outcomes to this plan file:
```bash
git add -A
git commit -m "docs: record Phase 1 verification results

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Verification (2026-07-18)

Automated gates — all pass:
- `npm run build`: pass (chunk-size warning only) · `npm run lint`: pass · `npm test`: 17/17 (wrapDelta ×3, chatterScheduler ×5, spaceStore ×9)
- Asset budget: public/models unchanged at 3.9M — Phase 1 added zero asset bytes (all textures canvas-generated, all audio synthesized)

Pending human browser checks (plan Task 8 checklist): sound behaviors + persistence, belt orbit + low-perf halving, cloud rotation, radar accuracy incl. boundary wrap, chatter cadence + zone interrupts, meteors, steady-flight profiler, StrictMode single-init.
