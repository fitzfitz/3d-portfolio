# Phase 2: Deep Sky Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A living sky — layered parallax stars, drifting galaxies, hue-shifting nebulae, a flickering sun corona, god rays, and a warp tunnel — all shader/canvas-generated, zero new assets, zero per-frame React state.

**Architecture:** Six visual modules. The sun moves out of SpacePlanets into its own `Sun.tsx` and hands its core mesh up to GlobalCanvas (one-time state set) so the GodRays pass can bind to it. The warp tunnel and corona are custom ShaderMaterials driven by clock/`flight` reads inside `useFrame`.

**Tech Stack:** React 19, TS, @react-three/fiber 9, drei 10, three 0.185, @react-three/postprocessing 3 (GodRays), vitest.

## Global Constraints

- No per-frame React setState (exception: `setSunMesh` fires exactly once on mount — discrete).
- Zero new network assets — all textures canvas-generated, all effects shaders.
- Low-perf mode: god rays, warp tunnel, corona shell + flares OFF; star layers/galaxies/nebula drift stay.
- All motion clock-absolute or delta-based.
- Live-like acceptance bar per spec `docs/superpowers/specs/2026-07-18-phase2-deep-sky-design.md`.
- Every commit ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Gates per task: `npm run build && npm run lint && npm test`.

## File Structure

- Create: `src/components/canvas/DistantGalaxies.tsx`, `src/components/canvas/Sun.tsx`, `src/components/canvas/WarpTunnel.tsx`, `src/utils/nebulaHue.ts`, `tests/nebulaHue.test.ts`
- Modify: `src/components/canvas/GlobalCanvas.tsx`, `src/components/canvas/SpacePlanets.tsx`

---

### Task 1: Parallax star layers

**Files:**
- Modify: `src/components/canvas/GlobalCanvas.tsx` (replace the `GalaxyStarfield` component body)

**Interfaces:**
- Consumes: nothing new
- Produces: internal only — `GalaxyStarfield` keeps its name/usage, now renders three `StarLayer`s

- [ ] **Step 1: Replace `GalaxyStarfield` in `GlobalCanvas.tsx`**

Delete the existing `GalaxyStarfield` function (the single 2,500-star implementation) and replace with:

```tsx
interface StarLayerProps {
  count: number;
  radiusMin: number;
  radiusMax: number;
  size: number;
  opacity: number;
  /** rad/s around Y; sign controls direction */
  speed: number;
  twinkle?: boolean;
}

function StarLayer({ count, radiusMin, radiusMax, size, opacity, speed, twinkle = false }: StarLayerProps) {
  const pointsRef = useRef<THREE.Points>(null);

  const [positions, colors] = useMemo(() => {
    const posArr = new Float32Array(count * 3);
    const colArr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = radiusMin + Math.random() * (radiusMax - radiusMin);
      posArr[i * 3] = Math.sin(angle) * radius;
      posArr[i * 3 + 1] = (Math.random() - 0.5) * 120;
      posArr[i * 3 + 2] = Math.cos(angle) * radius;
      const rand = Math.random();
      if (rand < 0.75) colArr.set([1, 1, 1], i * 3);
      else if (rand < 0.9) colArr.set([0.72, 0.88, 1.0], i * 3);
      else colArr.set([1.0, 0.78, 0.58], i * 3);
    }
    return [posArr, colArr];
  }, [count, radiusMin, radiusMax]);

  useFrame((state) => {
    if (!pointsRef.current) return;
    const time = state.clock.getElapsedTime();
    pointsRef.current.rotation.y = time * speed;
    if (twinkle) {
      const mat = pointsRef.current.material as THREE.PointsMaterial;
      mat.size = size + Math.sin(time * 2.5) * size * 0.3;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} count={count} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial vertexColors={true} size={size} transparent={true} opacity={opacity}
        blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}

// Three-depth parallax sky: far slow, mid counter-rotating, near faster + twinkling.
function GalaxyStarfield() {
  return (
    <>
      <StarLayer count={1300} radiusMin={140} radiusMax={260} size={0.04} opacity={0.35} speed={0.0015} />
      <StarLayer count={800} radiusMin={80} radiusMax={180} size={0.05} opacity={0.45} speed={-0.003} />
      <StarLayer count={400} radiusMin={40} radiusMax={120} size={0.07} opacity={0.6} speed={0.006} twinkle={true} />
    </>
  );
}
```

- [ ] **Step 2: Gates + commit**

`npm run build && npm run lint && npm test` (20/20).
```bash
git add -A
git commit -m "feat: three-layer parallax starfield

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Distant galaxies

**Files:**
- Create: `src/components/canvas/DistantGalaxies.tsx`
- Modify: `src/components/canvas/GlobalCanvas.tsx` (mount after `<GalaxyStarfield />`)

**Interfaces:**
- Consumes: nothing
- Produces: `<DistantGalaxies />`, no props

- [ ] **Step 1: Create `src/components/canvas/DistantGalaxies.tsx`**

```tsx
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/** Procedural two-arm spiral galaxy texture. Generated once per size at module use. */
function makeGalaxyTexture(hueBase: number): THREE.CanvasTexture | null {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.translate(size / 2, size / 2);
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 56);
  core.addColorStop(0, "rgba(255,240,220,0.9)");
  core.addColorStop(1, "rgba(200,160,255,0)");
  ctx.fillStyle = core;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  for (let arm = 0; arm < 2; arm++) {
    for (let p = 0; p < 900; p++) {
      const t = p / 900;
      const ang = arm * Math.PI + t * 4.4 + (Math.random() - 0.5) * 0.45;
      const r = 14 + t * 230 * (0.92 + Math.random() * 0.16);
      ctx.fillStyle = `hsla(${hueBase + Math.random() * 40}, 80%, ${72 - t * 25}%, ${0.5 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(Math.cos(ang) * r, Math.sin(ang) * r, 0.8 + Math.random() * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return new THREE.CanvasTexture(canvas);
}

const GALAXIES = [
  { pos: [180, 60, -160] as const, scale: 60, hue: 255, spin: 0.006 },
  { pos: [-200, -40, 120] as const, scale: 42, hue: 190, spin: -0.004 },
];

export default function DistantGalaxies() {
  const sprites = useMemo(
    () =>
      GALAXIES.map((g) => {
        const map = makeGalaxyTexture(g.hue);
        const material = new THREE.SpriteMaterial({
          map: map ?? undefined,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        return { ...g, material };
      }),
    []
  );

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    sprites.forEach((s) => {
      s.material.rotation = t * s.spin;
    });
  });

  return (
    <>
      {sprites.map((s, i) => (
        <sprite key={i} position={[s.pos[0], s.pos[1], s.pos[2]]} scale={[s.scale, s.scale, 1]} material={s.material} />
      ))}
    </>
  );
}
```
(also drop `useRef` from the react import if unused — keep the file lint-clean; the `sprites` memo holds the materials.)

- [ ] **Step 2: Mount in GlobalCanvas after `<GalaxyStarfield />`; gates + commit**

```bash
git add -A
git commit -m "feat: procedural distant spiral galaxies

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Nebula hue drift (TDD)

**Files:**
- Create: `src/utils/nebulaHue.ts`
- Modify: `src/components/canvas/SpacePlanets.tsx` (NebulaCluster tint update)
- Test: `tests/nebulaHue.test.ts`

**Interfaces:**
- Consumes: existing NebulaCluster
- Produces: `driftedHue(baseHue: number, tSeconds: number, amplitudeDeg?: number, periodSeconds?: number): number` (degrees, 0-360)

- [ ] **Step 1: Failing tests** — `tests/nebulaHue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { driftedHue } from "../src/utils/nebulaHue";

describe("driftedHue", () => {
  it("returns the base hue at t=0", () => {
    expect(driftedHue(200, 0)).toBeCloseTo(200);
  });
  it("peaks at +amplitude at a quarter period", () => {
    expect(driftedHue(200, 45, 25, 180)).toBeCloseTo(225);
  });
  it("wraps around 360", () => {
    expect(driftedHue(350, 45, 25, 180)).toBeCloseTo(15);
  });
  it("never returns negative values", () => {
    expect(driftedHue(5, 135, 25, 180)).toBeCloseTo(340);
  });
});
```
Run `npm test` → FAIL (module missing).

- [ ] **Step 2: Implement `src/utils/nebulaHue.ts`**

```ts
/** Sine-drifted hue in degrees, wrapped to [0, 360). Default: ±25° over 3 minutes. */
export function driftedHue(
  baseHue: number,
  tSeconds: number,
  amplitudeDeg = 25,
  periodSeconds = 180
): number {
  const drift = amplitudeDeg * Math.sin((tSeconds / periodSeconds) * Math.PI * 2);
  return ((baseHue + drift) % 360 + 360) % 360;
}
```
`npm test` → 24/24.

- [ ] **Step 3: Wire into `NebulaCluster` in SpacePlanets.tsx**

Inside `NebulaCluster`, capture the base HSL once and re-tint in the existing `useFrame`:

```tsx
  const baseHSL = useMemo(() => {
    const hsl = { h: 0, s: 0, l: 0 };
    new THREE.Color(color).getHSL(hsl);
    return hsl;
  }, [color]);
```
In the existing `useFrame`, after the particle-position loop:
```tsx
    if (pointsRef.current) {
      const mat = pointsRef.current.material as THREE.PointsMaterial;
      mat.color.setHSL(driftedHue(baseHSL.h * 360, time) / 360, baseHSL.s, baseHSL.l);
    }
```
Import `driftedHue` from `../../utils/nebulaHue`.

- [ ] **Step 4: Gates + commit**

```bash
git add -A
git commit -m "feat: slow nebula hue drift (tested util)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Sun extraction + corona

**Files:**
- Create: `src/components/canvas/Sun.tsx`
- Modify: `src/components/canvas/SpacePlanets.tsx` (DELETE the `{/* 5. CENTRAL SOL SUN (at 0, 0, 0) */}` group and the `sunPlanetRef` + its rotation line), `src/components/canvas/GlobalCanvas.tsx` (sun state + mount)

**Interfaces:**
- Consumes: `useSpaceStore` (isLowPerf)
- Produces: `<Sun onSunReady={(mesh: THREE.Mesh) => void} />`; GlobalCanvas gains `const [sunMesh, setSunMesh] = useState<THREE.Mesh | null>(null)` consumed by Task 5

- [ ] **Step 1: Create `src/components/canvas/Sun.tsx`**

```tsx
import { useRef, useMemo, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSpaceStore } from "../../store/spaceStore";

const coronaVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

// Cheap animated value noise: two scrolling sine fields beat against each other.
const coronaFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  float vnoise(vec3 p) {
    return sin(p.x * 5.1 + uTime * 1.7) * sin(p.y * 4.3 - uTime * 1.1) * sin(p.z * 6.7 + uTime * 2.3);
  }
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 2.0);
    float n = 0.5 + 0.5 * vnoise(vNormal * 2.0);
    float flicker = 0.65 + 0.35 * vnoise(vNormal * 4.0 + vec3(0.0, uTime * 0.2, 0.0));
    vec3 col = mix(vec3(1.0, 0.33, 0.0), vec3(1.0, 0.75, 0.35), n);
    gl_FragColor = vec4(col, rim * flicker * 0.85);
  }
`;

/** Shared soft radial flare texture (canvas-generated once). */
const flareTexture = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255, 220, 160, 0.85)");
    g.addColorStop(0.35, "rgba(255, 130, 40, 0.35)");
    g.addColorStop(1, "rgba(255, 85, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(canvas);
})();

interface SunProps {
  onSunReady: (mesh: THREE.Mesh) => void;
}

export default function Sun({ onSunReady }: SunProps) {
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const flareARef = useRef<THREE.Sprite>(null);
  const flareBRef = useRef<THREE.Sprite>(null);

  const coronaMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: coronaVertex,
        fragmentShader: coronaFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    []
  );

  // Callback ref: fires once when the core mesh mounts.
  const coreRef = useCallback(
    (mesh: THREE.Mesh | null) => {
      if (mesh) onSunReady(mesh);
    },
    [onSunReady]
  );

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    coronaMaterial.uniforms.uTime.value = t;
    // Asynchronous flare pulses
    if (flareARef.current) {
      const s = 9 + Math.sin(t * 0.9) * 1.4 + Math.sin(t * 2.7) * 0.7;
      flareARef.current.scale.set(s, s, 1);
    }
    if (flareBRef.current) {
      const s = 13 + Math.sin(t * 0.53 + 2.1) * 2.0;
      flareBRef.current.scale.set(s, s, 1);
      (flareBRef.current.material as THREE.SpriteMaterial).opacity = 0.4 + 0.15 * Math.sin(t * 1.3 + 1.0);
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Core (this mesh feeds the GodRays pass) */}
      <mesh ref={coreRef} rotation={[0, 0, 0]}>
        <sphereGeometry args={[2.5, 32, 32]} />
        <meshStandardMaterial color="#ff5500" emissive="#ff3300" emissiveIntensity={3.2} roughness={0.15} metalness={0.1} />
      </mesh>

      {/* Animated corona shell + flares (skipped in low-perf) */}
      {!isLowPerf && (
        <>
          <mesh material={coronaMaterial}>
            <sphereGeometry args={[3.2, 48, 48]} />
          </mesh>
          <sprite ref={flareARef}>
            <spriteMaterial map={flareTexture} transparent={true} opacity={0.55}
              blending={THREE.AdditiveBlending} depthWrite={false} />
          </sprite>
          <sprite ref={flareBRef}>
            <spriteMaterial map={flareTexture} transparent={true} opacity={0.4}
              blending={THREE.AdditiveBlending} depthWrite={false} />
          </sprite>
        </>
      )}

      {/* Solar system light (moved verbatim from SpacePlanets) */}
      <pointLight color="#ffffff" intensity={4.8} distance={260} decay={0.8} castShadow={true} />
    </group>
  );
}
```

- [ ] **Step 2: Remove the sun from `SpacePlanets.tsx`**

Delete the `{/* 5. CENTRAL SOL SUN (at 0, 0, 0) */}` group (core sphere mesh + pointLight), the `sunPlanetRef` declaration, and its `sunPlanetRef.current.rotation.y = time * 0.03;` line.

- [ ] **Step 3: Mount in `GlobalCanvas.tsx`**

```tsx
const [sunMesh, setSunMesh] = useState<THREE.Mesh | null>(null);
```
(add `useState` to the react import). Inside the Suspense, next to `<SpacePlanets />`:
```tsx
<Sun onSunReady={setSunMesh} />
```
`sunMesh` is consumed in Task 5 — until then, prefix with underscore or add a `void sunMesh;` line if lint complains about unused; Task 5 removes it.

- [ ] **Step 4: Gates + commit**

Visual note for controller: sun looks identical or better; corona flickers; no double-sun (SpacePlanets section removed).
```bash
git add -A
git commit -m "feat: extract Sun component with animated corona shell and flare sprites

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: God rays

**Files:**
- Modify: `src/components/canvas/GlobalCanvas.tsx` (effects array + GodRays)

**Interfaces:**
- Consumes: `sunMesh` state from Task 4; `GodRays` from @react-three/postprocessing
- Produces: no API change

- [ ] **Step 1: Build the composer children as an array**

Import `GodRays` alongside the other effects. Replace the current literal children of `<EffectComposer>` with:

```tsx
{(() => {
  const effects = [
    <Bloom key="bloom" intensity={1.2} luminanceThreshold={0.2} luminanceSmoothing={0.9} mipmapBlur={true} />,
    <Vignette key="vignette" eskil={false} offset={0.28} darkness={0.72} />,
    <ChromaticAberration key="ca" offset={isWarping ? [0.0022, 0.0014] : [0, 0]} />,
  ];
  if (sunMesh) {
    effects.push(
      <GodRays key="rays" sun={sunMesh} samples={60} density={0.9} decay={0.94}
        weight={0.25} exposure={0.28} clampMax={1} blur={true} />
    );
  }
  return effects;
})()}
```

- [ ] **Step 2: Gates + commit**

Visual note for controller: rays radiate from the sun, occluded by planets/ship crossing in front; whole composer still dies in low-perf.
```bash
git add -A
git commit -m "feat: volumetric god rays from the sun core

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Warp tunnel

**Files:**
- Create: `src/components/canvas/WarpTunnel.tsx`
- Modify: `src/components/canvas/GlobalCanvas.tsx` (mount `{!isLowPerf && <WarpTunnel />}`)

**Interfaces:**
- Consumes: `flight` (x, z, heading), `useSpaceStore.getState().isWarping`
- Produces: `<WarpTunnel />`, parent-gated on `!isLowPerf`

- [ ] **Step 1: Create `src/components/canvas/WarpTunnel.tsx`**

```tsx
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { flight, useSpaceStore } from "../../store/spaceStore";

const tunnelVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Scrolling streaks: thin bright lines racing along the tube, fading at both ends.
const tunnelFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  void main() {
    float lane = floor(vUv.x * 48.0);
    float laneRand = hash(lane);
    float speed = 2.2 + laneRand * 2.4;
    float phase = fract(vUv.y * (1.5 + laneRand) + uTime * speed + laneRand * 7.0);
    float streak = smoothstep(0.0, 0.12, phase) * smoothstep(0.5, 0.13, phase);
    float laneCenter = smoothstep(0.45, 0.0, abs(fract(vUv.x * 48.0) - 0.5));
    float endFade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
    vec3 col = mix(vec3(0.0, 0.94, 1.0), vec3(0.85, 0.98, 1.0), laneRand);
    gl_FragColor = vec4(col, streak * laneCenter * endFade * uIntensity * 0.75);
  }
`;

export default function WarpTunnel() {
  const meshRef = useRef<THREE.Mesh>(null);
  const intensity = useRef(0);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 } },
        vertexShader: tunnelVertex,
        fragmentShader: tunnelFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    []
  );

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const dt = Math.min(delta, 0.05);
    const target = useSpaceStore.getState().isWarping ? 1 : 0;
    intensity.current += (target - intensity.current) * (1 - Math.pow(0.002, dt)); // ~0.5s ease
    material.uniforms.uIntensity.value = intensity.current;
    material.uniforms.uTime.value = state.clock.getElapsedTime();

    const visible = intensity.current > 0.01;
    meshRef.current.visible = visible;
    if (visible) {
      meshRef.current.position.set(flight.x, 0, flight.z);
      meshRef.current.rotation.set(Math.PI / 2, flight.heading, 0, "YXZ");
    }
  });

  return (
    <mesh ref={meshRef} material={material} visible={false}>
      {/* open-ended tube around the ship, long axis = flight direction */}
      <cylinderGeometry args={[3.5, 3.5, 14, 32, 1, true]} />
    </mesh>
  );
}
```

- [ ] **Step 2: Mount in GlobalCanvas** — inside Suspense: `{!isLowPerf && <WarpTunnel />}`.

- [ ] **Step 3: Gates + commit**

Visual note: hold Space — tube of cyan streaks eases in around the ship aligned with travel direction, eases out on release; nothing visible at rest.
```bash
git add -A
git commit -m "feat: shader warp tunnel around the ship during boost

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification pass

- [ ] **Step 1: Gates** — `npm run build && npm run lint && npm test` (24/24); `du -sh public/models` unchanged.
- [ ] **Step 2: Manual live-like checklist** (spec acceptance): star-layer parallax while turning; organic corona flicker; god rays swing/occlude; warp tunnel ease-in/out aligned to heading; nebula tint shift over 90s; profiler zero renders; low-perf drops rays/tunnel/corona.
- [ ] **Step 3: Append `## Verification` results to this plan; commit.**

## Verification (2026-07-18)

Automated gates — all pass:
- `npm run build`: pass (chunk-size warning only) · `npm run lint`: pass · `npm test`: 24/24 (+4 driftedHue)
- Asset budget: public/models unchanged at 3.9M — Phase 2 added zero asset bytes (galaxy/flare textures canvas-generated; corona/tunnel pure shaders)

## Verification closure (2026-07-25)

Pending-human items from this plan, resolved:

- Star-layer parallax while turning — closed by `tests/e2e/sky.probe.mjs` (`heading
  changes when turning`, `star shells drift independently of heading`, `star shells
  stay centred on the ship`).
- Organic corona flicker — closed at the mechanism level by `tests/e2e/sky.probe.mjs`
  (`sun corona shader animates`), confirming the shader is not static; whether the
  flicker actually *reads* as organic is a quality judgment no probe or QA-checklist
  item covers — NOT RUN for that qualitative claim.
- God rays swing/occlusion — capture-only: `tests/e2e/sky.probe.mjs` captures
  `sky-godrays-open.png` (note `god-ray occlusion`) as a reference frame, because
  proving "the sun dims behind a planet" needs a contrived pose and flaky luminance
  thresholds. A human judges the dim/recover behavior against that baseline — NOT RUN
  — awaiting human pass, see `docs/QA-CHECKLIST.md` §7. (No probe checks rays
  "swinging" with heading independent of occlusion.)
- Warp tunnel ease-in/out aligned to heading — the heading/pitch alignment is closed by
  `tests/e2e/flight.probe.mjs` (`warp tunnel is visible while boosting`, `warp tunnel
  pitch follows the nose`, `warp tunnel yaw follows the heading`); the ease-in/out
  timing itself is not separately asserted by any probe or QA-checklist item — NOT RUN
  for that portion.
- Nebula tint shift over 90s — closed by `tests/e2e/sky.probe.mjs` (`nebula material is
  readable`, `nebula hue drifts over 20s`); note the probe watches 20s, not the plan's
  original 90s, but demonstrates the same continuous-drift mechanism.
- Profiler zero renders — closed by `tests/e2e/perf.probe.mjs` (`zero React commits
  during 5s of steady flight`, gated on `ship displaced during the 5s hold (flight
  input genuinely moved it)`). Same claim as phase1-ambient-life's "steady-flight
  profiler" — this project's longest-standing unverified performance assertion, now
  genuinely measured.
- Low-perf drops rays/tunnel/corona — tunnel and corona closed by
  `tests/e2e/perf.probe.mjs` (`warp tunnel dropped in low-perf`, `sun corona dropped in
  low-perf`); the `GodRays` postprocessing pass is gated by the same `!isLowPerf` flag
  in `src/components/canvas/GlobalCanvas.tsx` but isn't a queryable scene object, so no
  probe check asserts it directly — NOT RUN for the rays portion specifically
  (structurally implied by the shared guard, not independently tested).

See `docs/superpowers/plans/2026-07-25-portfolio-content-and-verification.md`.
