# Phase 3: Encounters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The universe acts on its own — Blender-generated cargo ships flying spline trade routes, a rare space jellyfish, comets with anti-sunward tails announced on the radio, and extra moons.

**Architecture:** Two reproducible Blender-scripted GLBs (committed generators → assets-src → existing optimizer). Four scene components driven by clock/delta inside useFrame; one new guarded store flag (`cometNear`) feeding the existing chatter system; zero per-frame React state.

**Tech Stack:** Blender 5.1.2 headless (bpy), React 19, TS, @react-three/fiber 9, drei 10, three 0.185, vitest.

## Global Constraints

- Blender binary: `/Users/fitzgeral/Applications/Blender.app/Contents/MacOS/Blender` (overridable via `$BLENDER` in `scripts/blender/generate.sh`).
- Asset budgets: cargo_ship.glb < 300KB, creature.glb < 600KB (optimized); `public/models` total < 6MB.
- Nav-light materials MUST be named `NavRed` / `NavGreen` in the ship GLB — the app locates them by name.
- Zero per-frame React setState; guarded setters for events; `getState()` in frame loops; low-perf: 3 ships instead of 5 (everything else unaffected).
- Blender API drift allowance: if bpy 5.x input names differ (e.g. Principled BSDF socket names), adapt minimally to achieve the same material/geometry result and document the deviation.
- Every commit ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Gates per task: `npm run build && npm run lint && npm test`.
- Spec: `docs/superpowers/specs/2026-07-18-phase3-encounters-design.md`.

## File Structure

- Create: `scripts/blender/gen_cargo_ship.py`, `scripts/blender/gen_creature.py`, `scripts/blender/generate.sh`, `src/components/canvas/CargoTraffic.tsx`, `src/components/canvas/SpaceJellyfish.tsx`, `src/components/canvas/Comets.tsx`
- Modify: `scripts/optimize-assets.mjs` (new models, exists-guard), `package.json` (`assets:generate`), `src/store/spaceStore.ts` (`cometNear`), `src/utils/chatterScheduler.ts` (+`comet` kind/pool), `src/data/chatterLines.ts`, `src/components/layout/RadioChatter.tsx`, `src/components/canvas/SpacePlanets.tsx` (OrbitingMoon), `src/components/canvas/GlobalCanvas.tsx` (mounts)
- Tests: extend `tests/chatterScheduler.test.ts`, `tests/spaceStore.test.ts`

---

### Task 1: Cargo ship asset (Blender) + pipeline wiring

**Files:**
- Create: `scripts/blender/gen_cargo_ship.py`, `scripts/blender/generate.sh`
- Modify: `scripts/optimize-assets.mjs`, `package.json`

**Interfaces:**
- Produces: `public/models/cargo_ship.glb` (<300KB) with materials `Hull`, `Accent`, `Windows`, `EngineGlow`, `NavRed`, `NavGreen`; ship nose points +Y in Blender → **−Z forward in glTF/three** (glTF exporter converts Z-up→Y-up; consumers orient via lookAt, so only handedness sanity matters); `npm run assets:generate`.

- [ ] **Step 1: Create `scripts/blender/gen_cargo_ship.py`**

```python
# Generates the low-poly NPC cargo hauler. Run headless:
#   $BLENDER --background --python scripts/blender/gen_cargo_ship.py
# Output: assets-src/cargo_ship.glb (raw; optimized by npm run assets:optimize)
import bpy
import math
import os

bpy.ops.wm.read_factory_settings(use_empty=True)


def make_material(name, color, metallic=0.7, roughness=0.35, emission=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


HULL = make_material("Hull", (0.16, 0.17, 0.22))
ACCENT = make_material("Accent", (0.30, 0.33, 0.40), roughness=0.5)
WINDOWS = make_material("Windows", (0.02, 0.02, 0.03), emission=(0.0, 0.94, 1.0), strength=4.0)
ENGINE = make_material("EngineGlow", (0.02, 0.02, 0.03), emission=(0.0, 0.94, 1.0), strength=6.0)
NAV_RED = make_material("NavRed", (0.05, 0.0, 0.0), emission=(1.0, 0.1, 0.1), strength=8.0)
NAV_GREEN = make_material("NavGreen", (0.0, 0.05, 0.0), emission=(0.1, 1.0, 0.3), strength=8.0)

parts = []


def add_box(name, size, loc, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = size
    ob.data.materials.append(mat)
    parts.append(ob)
    return ob


def add_cyl(name, radius, depth, loc, rot, mat, vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=vertices, location=loc, rotation=rot)
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(mat)
    parts.append(ob)
    return ob


def add_sphere(name, radius, loc, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=10, ring_count=8, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(mat)
    parts.append(ob)
    return ob


# Forward = +Y in Blender. Hull spine.
add_box("hull", (0.5, 2.2, 0.35), (0, 0, 0), HULL)
add_box("cabin", (0.34, 0.5, 0.3), (0, 0.95, 0.28), ACCENT)
add_box("window_l", (0.02, 0.3, 0.08), (-0.18, 0.98, 0.32), WINDOWS)
add_box("window_r", (0.02, 0.3, 0.08), (0.18, 0.98, 0.32), WINDOWS)
# Cargo containers on the spine
for i, y in enumerate((-0.75, -0.15, 0.4)):
    add_box(f"container_{i}", (0.42, 0.5, 0.28), (0, y, 0.3), ACCENT if i % 2 else HULL)
# Wing stubs
add_box("wing_l", (0.7, 0.4, 0.06), (-0.55, -0.2, 0.0), HULL)
add_box("wing_r", (0.7, 0.4, 0.06), (0.55, -0.2, 0.0), HULL)
# Twin engines at the stern (cylinders along Y)
add_cyl("engine_l", 0.14, 0.5, (-0.28, -1.25, 0.0), (math.radians(90), 0, 0), ACCENT)
add_cyl("engine_r", 0.14, 0.5, (0.28, -1.25, 0.0), (math.radians(90), 0, 0), ACCENT)
add_cyl("nozzle_l", 0.10, 0.06, (-0.28, -1.52, 0.0), (math.radians(90), 0, 0), ENGINE)
add_cyl("nozzle_r", 0.10, 0.06, (0.28, -1.52, 0.0), (math.radians(90), 0, 0), ENGINE)
# Nav lights on the wingtips: red = port (-X), green = starboard (+X)
add_sphere("nav_red", 0.06, (-0.92, -0.2, 0.05), NAV_RED)
add_sphere("nav_green", 0.06, (0.92, -0.2, 0.05), NAV_GREEN)

for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
ship = bpy.context.object
ship.name = "CargoShip"

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "cargo_ship.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
print("wrote", out)
```

- [ ] **Step 2: Create `scripts/blender/generate.sh`**

```bash
#!/bin/bash
# Regenerates Blender-authored assets into assets-src/, then optimizes into public/models/.
set -e
BLENDER="${BLENDER:-/Users/fitzgeral/Applications/Blender.app/Contents/MacOS/Blender}"
cd "$(dirname "$0")/../.."
mkdir -p assets-src
"$BLENDER" --background --python scripts/blender/gen_cargo_ship.py
[ -f scripts/blender/gen_creature.py ] && "$BLENDER" --background --python scripts/blender/gen_creature.py
npm run assets:optimize
```
`chmod +x scripts/blender/generate.sh`. Add to package.json scripts: `"assets:generate": "scripts/blender/generate.sh"`.

- [ ] **Step 3: Extend `scripts/optimize-assets.mjs`**

Add `existsSync` to the fs import. Change the format-conversion loop to include the generated models and skip missing sources:
```js
for (const name of ["spaceship", "portal_gateway", "space_crystal", "cargo_ship", "creature"]) {
  if (!existsSync(`${SRC}/${name}.glb`)) {
    console.log(`skip ${name}.glb (not in assets-src)`);
    continue;
  }
  await processGlb(name, [textureCompress({ encoder: sharp, targetFormat: "webp", quality: 92 })]);
}
```

- [ ] **Step 4: Generate + verify**

```bash
npm run assets:generate
ls -la public/models/cargo_ship.glb   # expect < 300KB
npx @gltf-transform/cli inspect public/models/cargo_ship.glb | grep -iE "NavRed|NavGreen|vertices" | head
```
Expected: file present under budget; materials list includes NavRed and NavGreen. If bpy socket names differ in 5.x, adapt (constraint allowance) and note it.

- [ ] **Step 5: Gates + commit**

```bash
npm run build && npm run lint && npm test
git add -A
git commit -m "feat: Blender-generated NPC cargo ship asset + generate pipeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Jellyfish asset (Blender)

**Files:**
- Create: `scripts/blender/gen_creature.py`

**Interfaces:**
- Produces: `public/models/creature.glb` (<600KB): organic bell + 6 tapered tentacles hanging along −Y in three (−Z in Blender), joined mesh named `Jellyfish`. Geometry only — app replaces materials.

- [ ] **Step 1: Create `scripts/blender/gen_creature.py`**

```python
# Generates the space-jellyfish body. Bell = displaced subdivided sphere; 6 tapered tentacles.
#   $BLENDER --background --python scripts/blender/gen_creature.py
import bpy
import math
import os

bpy.ops.wm.read_factory_settings(use_empty=True)

# Bell: squashed sphere with subdivision + noise displacement for an organic silhouette
bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=32, ring_count=16)
bell = bpy.context.object
bell.name = "bell"
bell.scale = (1.0, 1.0, 0.72)
sub = bell.modifiers.new("subsurf", "SUBSURF")
sub.levels = 2
sub.render_levels = 2
tex = bpy.data.textures.new("lumps", type="CLOUDS")
tex.noise_scale = 0.55
disp = bell.modifiers.new("disp", "DISPLACE")
disp.texture = tex
disp.strength = 0.16

parts = [bell]
# Tentacles: tapered cones hanging -Z, ring of 6, alternating lengths, slight outward tilt
for i in range(6):
    a = i / 6.0 * 2.0 * math.pi
    ring_r = 0.45
    depth = 2.6 + (i % 3) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        radius1=0.09, radius2=0.015, depth=depth, vertices=8,
        location=(math.cos(a) * ring_r, math.sin(a) * ring_r, -0.4 - depth / 2.0),
    )
    t = bpy.context.object
    t.name = f"tentacle_{i}"
    t.rotation_euler = (math.radians(7) * math.sin(a), math.radians(-7) * math.cos(a), 0)
    parts.append(t)

for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = bell
bpy.ops.object.join()
jelly = bpy.context.object
jelly.name = "Jellyfish"
bpy.ops.object.shade_smooth()

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "creature.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
print("wrote", out)
```

- [ ] **Step 2: Generate + verify + gates + commit**

```bash
npm run assets:generate
ls -la public/models/creature.glb   # < 600KB
npx @gltf-transform/cli inspect public/models/creature.glb | grep -iE "vertices|Jellyfish" | head
npm run build && npm run lint && npm test
git add -A
git commit -m "feat: Blender-generated space jellyfish body

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: NPC cargo traffic

**Files:**
- Create: `src/components/canvas/CargoTraffic.tsx`
- Modify: `src/components/canvas/GlobalCanvas.tsx` (mount inside Suspense)

**Interfaces:**
- Consumes: `/models/cargo_ship.glb`, `flight`, `useSpaceStore` (isLowPerf)
- Produces: `<CargoTraffic />`, no props

- [ ] **Step 1: Create `src/components/canvas/CargoTraffic.tsx`**

```tsx
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { flight, useSpaceStore } from "../../store/spaceStore";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// Three closed trade loops threading the planets and portal at varied heights.
const ROUTES = [
  [v(-110, 8, 80), v(-20, 14, 150), v(130, 6, -40), v(30, -6, -170), v(-140, 10, -70)],
  [v(150, -8, 60), v(60, 4, 180), v(-160, -4, 140), v(-90, 12, -30), v(40, 2, -120)],
  [v(0, 20, -200), v(170, 14, -100), v(200, 6, 80), v(0, -10, 120), v(-190, 16, -20)],
].map((pts) => new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.5));

interface ShipDef { route: number; phase: number; loopSeconds: number }
const SHIPS: ShipDef[] = [
  { route: 0, phase: 0.0, loopSeconds: 110 },
  { route: 0, phase: 0.5, loopSeconds: 110 },
  { route: 1, phase: 0.2, loopSeconds: 140 },
  { route: 1, phase: 0.7, loopSeconds: 140 },
  { route: 2, phase: 0.4, loopSeconds: 90 },
];

const lookTarget = new THREE.Vector3();
const tanA = new THREE.Vector3();
const tanB = new THREE.Vector3();

export default function CargoTraffic() {
  const { scene } = useGLTF("/models/cargo_ship.glb");
  const isLowPerf = useSpaceStore((s) => s.isLowPerf);
  const count = isLowPerf ? 3 : 5;
  const rolls = useRef<number[]>(SHIPS.map(() => 0));

  // Clone the small ship per NPC; clone nav-light materials so each blinks with its own phase.
  const ships = useMemo(
    () =>
      SHIPS.map(() => {
        const model = scene.clone(true);
        // glTF export maps the ship's Blender +Y nose to -Z, but Object3D.lookAt
        // points +Z at the target — flip the model inside a wrapper we steer.
        model.rotation.y = Math.PI;
        const group = new THREE.Group();
        group.add(model);
        const navMats: THREE.MeshStandardMaterial[] = [];
        model.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const m = o.material as THREE.MeshStandardMaterial;
            if (m.name === "NavRed" || m.name === "NavGreen") {
              const c = m.clone();
              o.material = c;
              navMats.push(c);
            }
          }
        });
        return { group, navMats };
      }),
    [scene]
  );

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const time = state.clock.getElapsedTime();
    for (let i = 0; i < count; i++) {
      const def = SHIPS[i];
      const ship = ships[i];
      const curve = ROUTES[def.route];
      const t = (time / def.loopSeconds + def.phase) % 1;

      curve.getPointAt(t, ship.group.position);
      curve.getPointAt((t + 0.003) % 1, lookTarget);
      ship.group.lookAt(lookTarget);

      // Banking: roll into curvature; extra roll away from the player when close.
      curve.getTangentAt(t, tanA);
      curve.getTangentAt((t + 0.01) % 1, tanB);
      let targetRoll = THREE.MathUtils.clamp(tanA.cross(tanB).y * 60, -0.5, 0.5);
      const dx = ship.group.position.x - flight.x;
      const dz = ship.group.position.z - flight.z;
      if (dx * dx + dz * dz < 144) targetRoll += Math.sign(dx || 1) * 0.35;
      rolls.current[i] += (targetRoll - rolls.current[i]) * (1 - Math.pow(0.01, dt));
      ship.group.rotateZ(rolls.current[i]);

      // Nav lights: sharp blink, per-ship phase
      const blink = Math.sin(time * 3 + i * 1.7) > 0.82 ? 8 : 0.4;
      for (const m of ship.navMats) m.emissiveIntensity = blink;
    }
  });

  return (
    <>
      {ships.slice(0, count).map((s, i) => (
        <primitive key={i} object={s.group} scale={1.6} />
      ))}
    </>
  );
}
```

- [ ] **Step 2: Mount `<CargoTraffic />` in GlobalCanvas (inside Suspense, after `<AsteroidBelt />`); gates + commit**

```bash
git add -A
git commit -m "feat: NPC cargo traffic on spline trade routes with blinking nav lights

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Space jellyfish

**Files:**
- Create: `src/components/canvas/SpaceJellyfish.tsx`
- Modify: `src/components/canvas/GlobalCanvas.tsx` (mount inside Suspense)

**Interfaces:**
- Consumes: `/models/creature.glb`
- Produces: `<SpaceJellyfish />`; hidden debug: pressing **J** summons it near the player (fast-forwards path phase)

- [ ] **Step 1: Create `src/components/canvas/SpaceJellyfish.tsx`**

```tsx
import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

const LOOP_SECONDS = 400;
const NEAR_T = 0.32; // path phase where the loop passes closest to the play area

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying float vY;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec3 p = position;
    float bell = smoothstep(-0.2, 1.0, p.y);
    float tent = 1.0 - smoothstep(-0.2, 0.6, p.y);
    float pulse = sin(uTime * 1.6) * 0.5 + 0.5;
    p.xz *= 1.0 + bell * (pulse * 0.18 - 0.09);
    p.y += bell * sin(uTime * 1.6 + 1.2) * 0.08;
    float depth = max(0.0, -p.y);
    p.x += tent * sin(uTime * 1.1 + p.y * 1.4) * 0.12 * depth;
    p.z += tent * cos(uTime * 0.9 + p.y * 1.7) * 0.12 * depth;
    vY = p.y;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying float vY;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float fresnel = pow(clamp(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 0.0, 1.0), 1.8);
    vec3 cyan = vec3(0.0, 0.94, 1.0);
    vec3 magenta = vec3(0.93, 0.28, 0.6);
    vec3 col = mix(cyan, magenta, 0.5 + 0.5 * sin(uTime * 0.5 + vY * 0.8));
    float core = smoothstep(0.2, 1.0, vY) * (0.35 + 0.25 * sin(uTime * 2.2));
    gl_FragColor = vec4(col, fresnel * 0.65 + core * 0.3);
  }
`;

// Far drifting loop; two segments pass within sight of the play area.
const PATH = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(300, 40, 0),
    new THREE.Vector3(80, 25, 260),
    new THREE.Vector3(-320, 10, 120),
    new THREE.Vector3(-120, 55, -300),
    new THREE.Vector3(120, 20, -140),
  ],
  true,
  "catmullrom",
  0.6
);

export default function SpaceJellyfish() {
  const { scene } = useGLTF("/models/creature.glb");
  const groupRef = useRef<THREE.Group>(null);
  const tOffset = useRef(0);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);

  const geometry = useMemo(() => {
    let g: THREE.BufferGeometry | undefined;
    scene.traverse((o) => {
      if (!g && o instanceof THREE.Mesh) g = o.geometry;
    });
    if (!g) throw new Error("creature.glb contains no mesh");
    return g;
  }, [scene]);

  // Debug/easter-egg summon: J fast-forwards the loop phase so the jelly appears nearby.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyJ") return;
      const now = performance.now() / 1000;
      tOffset.current = NEAR_T - ((now / LOOP_SECONDS) % 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useFrame((state) => {
    if (!groupRef.current) return;
    const time = state.clock.getElapsedTime();
    material.uniforms.uTime.value = time;
    const t = ((time / LOOP_SECONDS + tOffset.current) % 1 + 1) % 1;
    PATH.getPointAt(t, groupRef.current.position);
    const tangent = PATH.getTangentAt(t);
    groupRef.current.rotation.set(tangent.z * 0.12, 0, -tangent.x * 0.12); // gentle tilt into drift
  });

  return (
    <group ref={groupRef} scale={18}>
      <mesh geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}
```

- [ ] **Step 2: Mount `<SpaceJellyfish />` in GlobalCanvas (inside Suspense); gates + commit**

```bash
git add -A
git commit -m "feat: rare drifting space jellyfish with undulation shader (J to summon)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Comets + chatter integration (TDD for pure parts)

**Files:**
- Create: `src/components/canvas/Comets.tsx`
- Modify: `src/store/spaceStore.ts` (`cometNear` + guarded `setCometNear`), `src/utils/chatterScheduler.ts` (`comet` pool/kind), `src/data/chatterLines.ts`, `src/components/layout/RadioChatter.tsx`, `src/components/canvas/GlobalCanvas.tsx`
- Test: extend `tests/chatterScheduler.test.ts`, `tests/spaceStore.test.ts`

**Interfaces:**
- Produces: store `cometNear: boolean` / `setCometNear(v)` (guarded); `ChatterPools.comet: string[]`; `ChatterKind` includes `"comet"`; `<Comets />`

- [ ] **Step 1: Failing tests**

Append to `tests/chatterScheduler.test.ts` (add `comet: ["comet-1", "comet-2"]` to the fixture pools):
```ts
  it("picks from the comet pool for comet events", () => {
    const s = new ChatterScheduler(pools, () => 0);
    expect(s.pick("comet")).toBe("comet-1");
  });
```
Append to `tests/spaceStore.test.ts` (add `cometNear: false` to the beforeEach setState):
```ts
  it("setCometNear does not notify subscribers for identical values", () => {
    const spy = vi.fn();
    const unsub = useSpaceStore.subscribe(spy);
    useSpaceStore.getState().setCometNear(false); // already false
    expect(spy).not.toHaveBeenCalled();
    useSpaceStore.getState().setCometNear(true);
    expect(spy).toHaveBeenCalledTimes(1);
    unsub();
  });
```
Run `npm test` → FAIL (missing pool type / setCometNear).

- [ ] **Step 2: Implement store + scheduler + lines**

`spaceStore.ts`: add `cometNear: boolean` (init false) + interface entries + guarded setter:
```ts
    setCometNear: (v) => { if (get().cometNear !== v) set({ cometNear: v }); },
```
`chatterScheduler.ts`: add `comet: string[];` to `ChatterPools`; extend `ChatterKind` with `"comet"`; add branch `else if (kind === "comet") pool = this.pools.comet;`
`chatterLines.ts`: add pool:
```ts
  comet: [
    "COMET DETECTED // TAIL COMPOSITION: ICE, DUST, DEADLINES",
    "INBOUND ICE WANDERER. ORBIT: ECCENTRIC. VIBE: IMMACULATE",
    "COMET FLYBY IN PROGRESS. NO AUTOGRAPHS",
    "TAIL ALWAYS POINTS AWAY FROM THE SUN. RESUME ALWAYS POINTS AT YOU",
  ],
```
`RadioChatter.tsx`: add subscription alongside the existing ones:
```tsx
      useSpaceStore.subscribe(
        (s) => s.cometNear,
        (near) => { if (near) typeLine(scheduler.pick("comet")); }
      ),
```
Run `npm test` → 26/26 pass.

- [ ] **Step 3: Create `src/components/canvas/Comets.tsx`**

```tsx
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { flight, useSpaceStore } from "../../store/spaceStore";

const TAIL_POINTS = 50;
interface CometDef { a: number; b: number; tiltY: number; periodSeconds: number; phase: number }
const COMETS: CometDef[] = [
  { a: 150, b: 95, tiltY: 18, periodSeconds: 140, phase: 0 },
  { a: 210, b: 130, tiltY: -14, periodSeconds: 220, phase: 2.1 },
];

const head = new THREE.Vector3();
const away = new THREE.Vector3();

export default function Comets() {
  const headRefs = useRef<(THREE.Mesh | null)[]>([null, null]);
  const tailRefs = useRef<(THREE.Points | null)[]>([null, null]);

  const tails = useMemo(
    () =>
      COMETS.map(() => {
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TAIL_POINTS * 3), 3));
        const jitter = Array.from({ length: TAIL_POINTS }, () => ({
          x: (Math.random() - 0.5), y: (Math.random() - 0.5), z: (Math.random() - 0.5),
        }));
        return { geom, jitter };
      }),
    []
  );

  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    const store = useSpaceStore.getState();
    let anyNear = false;

    COMETS.forEach((c, i) => {
      const ang = (time / c.periodSeconds) * Math.PI * 2 + c.phase;
      head.set(Math.cos(ang) * c.a, Math.sin(ang) * c.tiltY, Math.sin(ang) * c.b);
      const mesh = headRefs.current[i];
      if (mesh) mesh.position.copy(head);

      // Tail points away from the sun (origin), longer when closer to the sun
      away.copy(head).normalize();
      const distSun = head.length();
      const len = THREE.MathUtils.clamp(45 - distSun * 0.12, 8, 40);
      const tail = tailRefs.current[i];
      if (tail) {
        const attr = tail.geometry.attributes.position;
        const data = attr.array as Float32Array;
        const jit = tails[i].jitter;
        for (let p = 0; p < TAIL_POINTS; p++) {
          const f = p / TAIL_POINTS;
          const spread = f * 3.2;
          data[p * 3] = head.x + away.x * f * len + jit[p].x * spread;
          data[p * 3 + 1] = head.y + away.y * f * len + jit[p].y * spread;
          data[p * 3 + 2] = head.z + away.z * f * len + jit[p].z * spread;
        }
        attr.needsUpdate = true;
      }

      const dx = head.x - flight.x;
      const dz = head.z - flight.z;
      if (dx * dx + dz * dz < 3600) anyNear = true;
    });

    store.setCometNear(anyNear);
  });

  return (
    <>
      {COMETS.map((_, i) => (
        <group key={i}>
          <mesh ref={(m) => { headRefs.current[i] = m; }}>
            <sphereGeometry args={[0.8, 12, 12]} />
            <meshStandardMaterial color="#eaffff" emissive="#bff5ff" emissiveIntensity={2.6} />
          </mesh>
          <points ref={(p) => { tailRefs.current[i] = p; }} geometry={tails[i].geom} frustumCulled={false}>
            <pointsMaterial color="#bff5ff" size={0.5} transparent={true} opacity={0.55}
              blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation={true} />
          </points>
        </group>
      ))}
    </>
  );
}
```

- [ ] **Step 4: Mount `<Comets />` in GlobalCanvas (inside Suspense); gates + commit**

```bash
git add -A
git commit -m "feat: comets with anti-sunward tails + radio chatter announcements (tested)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Extra moons

**Files:**
- Modify: `src/components/canvas/SpacePlanets.tsx`

**Interfaces:**
- Produces: local `OrbitingMoon` helper; saas +1, agent +2, video +1 moons

- [ ] **Step 1: Add the helper (top-level in SpacePlanets.tsx, near NebulaCluster)**

```tsx
interface OrbitingMoonProps {
  distance: number; speed: number; inclination: number;
  size: number; color: string; phase?: number;
}

function OrbitingMoon({ distance, speed, inclination, size, color, phase = 0 }: OrbitingMoonProps) {
  const ref = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = phase + state.clock.getElapsedTime() * speed;
  });
  return (
    <group rotation={[inclination, 0, 0]}>
      <group ref={ref}>
        <mesh position={[distance, 0, 0]}>
          <sphereGeometry args={[size, 12, 12]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
        </mesh>
      </group>
    </group>
  );
}
```

- [ ] **Step 2: Add moons inside the planet groups**

SaaS group (after its CloudLayer): `<OrbitingMoon distance={planets[0].size * 1.7} speed={0.4} inclination={0.45} size={0.5} color="#8fffc9" />`
Video group: `<OrbitingMoon distance={planets[1].size * 1.9} speed={-0.28} inclination={-0.3} size={0.42} color="#9be8ff" phase={2} />`
Agent group: `<OrbitingMoon distance={planets[2].size * 1.6} speed={0.5} inclination={0.6} size={0.45} color="#e3b8ff" />` and `<OrbitingMoon distance={planets[2].size * 2.1} speed={-0.22} inclination={-0.2} size={0.3} color="#caa2ff" phase={3.5} />`

- [ ] **Step 3: Gates + commit**

```bash
git add -A
git commit -m "feat: extra moons with varied inclinations on all project planets

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Final verification pass

- [ ] **Step 1: Gates** — build/lint/test (26/26); `du -sh public/models` < 6MB.
- [ ] **Step 2: Headless probe** — run `.superpowers/whiteout-probe.mjs` against the dev server; extend it to press **J** and screenshot the summoned jellyfish; capture a ship/comet if timing allows. Attach observations to the verification record.
- [ ] **Step 3: Manual checklist** — ships bank on curves + blink red/green; jelly undulates and drifts; comet tails point anti-sunward; chatter announces near pass once per approach; moons on varied inclinations; low-perf drops to 3 ships; profiler still render-free.
- [ ] **Step 4: Append `## Verification` to this plan; commit.**

## Verification (2026-07-18)

Automated gates — all pass: build ✓ · lint ✓ · tests 26/26 · public/models ≈ 4.0M (< 6MB budget; ship 13.6KB, jellyfish 117KB — both Blender-generated, reproducible via `npm run assets:generate`).

Headless-probe visual verification (screenshots captured via puppeteer rig):
- Scene @6s: comet with tail visible top-center; cargo ship with glowing windows crossing on the left; chatter/radar live; console fully clean (zero GL errors).
- Sweep frames: distant spiral galaxy sprite, purple/pink nebulae, sun corona (not blown out), planets/moons.
- Jellyfish: J-summon verified — huge undulating tentacle trails on screen after pressing J and flying forward. NOTE: the plan's original NEAR_T=0.32 was numerically wrong (284 units out); path waypoint 2 moved to (30,18,70) and NEAR_T recomputed to 0.177 (closest approach ~75 units), fixed in 6227a60.

Pending human checks: ship banking feel on curves, comet chatter announcement timing in normal play, low-perf 3-ship reduction.
