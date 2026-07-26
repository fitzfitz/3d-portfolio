# Asset Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detailed, AO-baked, always-moving Phase 3 assets: greebled cargo ships with spinning radar dishes, cratered rotating moons, tumbling icy comet heads.

**Architecture:** Blender generators grow a shared bake helper (smart-UV → Cycles DIFFUSE+AO bakes → pixel-multiply → single baked material); emissive materials are excluded from bakes and keep their names. App-side: name-based node lookup for the dish, material-clone tinting for moons, tumble/wobble refs in existing frame loops.

**Tech Stack:** Blender 5.1.2 headless (Cycles CPU), bpy, React 19, three 0.185.

## Global Constraints

- Emissive materials NEVER baked; `NavRed`/`NavGreen` material names and the `RadarDish` object name must survive generation AND `npm run assets:optimize` (verify with gltf-transform inspect).
- Budgets (optimized): cargo_ship.glb < 900KB, moon.glb < 700KB, comet_head.glb < 200KB; `public/models` total < 8MB.
- Bakes: 1024px, AO samples 32, Cycles CPU (`scene.cycles.device = 'CPU'`), color×AO multiplied via `image.pixels` math in bpy.
- Blender API drift allowance: adapt minimally, document deviations.
- No per-frame React state; motion = ref mutations in existing useFrame loops.
- Every commit ends with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Gates per task: `npm run build && npm run lint && npm test` (45 tests).
- Spec: `docs/superpowers/specs/2026-07-18-asset-uplift-design.md`.

## File Structure

- Create: `scripts/blender/bake_utils.py` (shared bake helper), `scripts/blender/gen_moon.py`, `scripts/blender/gen_comet_head.py`
- Rewrite: `scripts/blender/gen_cargo_ship.py`
- Modify: `scripts/blender/generate.sh`, `scripts/optimize-assets.mjs` (+moon, comet_head), `src/components/canvas/CargoTraffic.tsx` (dish spin + wobble), `src/components/canvas/SpacePlanets.tsx` (OrbitingMoon → GLB), `src/components/canvas/Comets.tsx` (head GLB + tumble)

---

### Task 1: Bake helper + cargo ship v2 + dish/wobble motion

**Files:**
- Create: `scripts/blender/bake_utils.py`
- Rewrite: `scripts/blender/gen_cargo_ship.py`
- Modify: `src/components/canvas/CargoTraffic.tsx`

**Interfaces:**
- `bake_utils.bake_color_ao(objects, image_name, size=1024, ao_samples=32) -> bpy Image` — smart-UV-projects the objects, bakes DIFFUSE color then AO across them into two images, multiplies AO into color via pixel math, returns the combined image
- `bake_utils.apply_baked_material(objects, image, name)` — replaces the objects' non-emissive materials with one Principled material whose Base Color is the baked image
- cargo_ship.glb: joined hull object `CargoShip` (baked `HullBaked` material + separate emissive primitives `Windows`/`EngineGlow`/`NavRed`/`NavGreen`) + separate object `RadarDish` (plain Accent material)
- CargoTraffic: per-clone `dish` node found by name, spun 1.2 rad/s; wobble `+ Math.sin(time * 0.6 + i * 2.1) * 0.35` added to group y after spline positioning

- [ ] **Step 1: Create `scripts/blender/bake_utils.py`**

```python
# Shared Cycles bake helper: smart-UV + DIFFUSE/AO bakes -> one combined image.
# Emissive materials must be excluded by the caller (bake only matte parts).
import bpy


def _ensure_uv(objects):
    for ob in objects:
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")


def _new_image(name, size):
    img = bpy.data.images.new(name, width=size, height=size, alpha=False)
    return img


def _attach_bake_target(objects, img):
    """Every material on the objects gets an image-texture node pointing at img,
    selected+active so Cycles bakes into it."""
    for ob in objects:
        for slot in ob.material_slots:
            mat = slot.material
            if mat is None:
                continue
            mat.use_nodes = True
            nt = mat.node_tree
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = img
            node.name = "BakeTarget"
            nt.nodes.active = node


def _detach_bake_targets(objects):
    for ob in objects:
        for slot in ob.material_slots:
            mat = slot.material
            if mat is None or not mat.use_nodes:
                continue
            for node in list(mat.node_tree.nodes):
                if node.name.startswith("BakeTarget"):
                    mat.node_tree.nodes.remove(node)


def _bake(objects, bake_type, img, ao_samples):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = ao_samples
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if bake_type == "DIFFUSE":
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_clear=True)
    else:
        bpy.ops.object.bake(type="AO", use_clear=True)


def bake_color_ao(objects, image_name, size=1024, ao_samples=32):
    _ensure_uv(objects)
    color_img = _new_image(image_name + "_color", size)
    ao_img = _new_image(image_name + "_ao", size)

    _attach_bake_target(objects, color_img)
    _bake(objects, "DIFFUSE", color_img, ao_samples)
    _detach_bake_targets(objects)

    _attach_bake_target(objects, ao_img)
    _bake(objects, "AO", ao_img, ao_samples)
    _detach_bake_targets(objects)

    # Multiply AO into color (pixel math; both are size x size RGBA)
    combined = _new_image(image_name, size)
    cp = list(color_img.pixels)
    ap = list(ao_img.pixels)
    out = [0.0] * len(cp)
    for i in range(0, len(cp), 4):
        out[i] = cp[i] * ap[i]
        out[i + 1] = cp[i + 1] * ap[i + 1]
        out[i + 2] = cp[i + 2] * ap[i + 2]
        out[i + 3] = 1.0
    combined.pixels = out
    combined.pack()
    return combined


def apply_baked_material(objects, image, name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = 0.55
    bsdf.inputs["Roughness"].default_value = 0.45
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    for ob in objects:
        # Replace every non-emissive slot with the baked material
        for slot in ob.material_slots:
            m = slot.material
            if m is None:
                continue
            emissive = False
            if m.use_nodes and "Principled BSDF" in m.node_tree.nodes:
                emissive = m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value > 0.0
            if not emissive:
                slot.material = mat
    return mat
```

- [ ] **Step 2: Rewrite `scripts/blender/gen_cargo_ship.py`**

Keep the v1 part layout and material definitions (Hull/Accent/Windows/EngineGlow/NavRed/NavGreen, same positions), then ADD:

```python
import random
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils
random.seed(7)

# --- detail pass (after the v1 parts, before joining) ---
# Greebles: seeded boxes scattered on hull + containers
for g in range(40):
    x = random.uniform(-0.24, 0.24)
    y = random.uniform(-1.1, 1.15)
    z = 0.19 if random.random() < 0.5 else random.uniform(0.42, 0.5)
    s = (random.uniform(0.03, 0.09), random.uniform(0.04, 0.14), random.uniform(0.02, 0.05))
    add_box(f"greeble_{g}", s, (x, y, z), HULL if g % 3 else ACCENT)
# Antenna mast + tip
add_cyl("antenna", 0.015, 0.55, (0.12, 0.7, 0.62), (0, 0, 0), ACCENT, vertices=6)
add_sphere("antenna_tip", 0.03, (0.12, 0.7, 0.9), ACCENT)
# Engine detail rings
add_cyl("ring_l", 0.17, 0.05, (-0.28, -1.42, 0.0), (math.radians(90), 0, 0), HULL)
add_cyl("ring_r", 0.17, 0.05, (0.28, -1.42, 0.0), (math.radians(90), 0, 0), HULL)

# Bevel every matte part for worn-edge shading (before join)
for p in parts:
    has_emissive = any(
        m is not None and m.use_nodes
        and m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value > 0
        for m in [s.material for s in p.material_slots]
    )
    if not has_emissive:
        bev = p.modifiers.new("bevel", "BEVEL")
        bev.width = 0.008
        bev.segments = 2

# join as before -> ship named CargoShip
# ... existing join code ...

# --- RadarDish: separate object, NOT joined ---
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.11, segments=12, ring_count=6, location=(-0.12, 0.75, 0.55))
dish = bpy.context.object
dish.name = "RadarDish"
dish.scale = (1.0, 1.0, 0.35)
dish.data.materials.append(ACCENT)

# --- bake hull color+AO and apply ---
img = bake_utils.bake_color_ao([ship], "cargo_ship_baked", size=1024, ao_samples=32)
bake_utils.apply_baked_material([ship], img, "HullBaked")

# export BOTH objects (ship + dish)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True)
```
(Adapt to the actual v1 file structure; `os`/`math` already imported. IMPORTANT bake caveat the implementer must handle: `apply_baked_material` runs AFTER the join, so the joined ship's emissive slots — Windows/EngineGlow/NavRed/NavGreen — must remain untouched by slot-replacement; verify post-export with inspect that all four names survive.)

- [ ] **Step 3: Generate + verify**

```bash
npm run assets:generate
npx @gltf-transform/cli inspect public/models/cargo_ship.glb | grep -iE "NavRed|NavGreen|RadarDish|HullBaked|webp|texture" | head
ls -la public/models/cargo_ship.glb   # < 900KB
```

- [ ] **Step 4: CargoTraffic dish spin + wobble**

In the ships useMemo, after material cloning:
```tsx
        let dish: THREE.Object3D | null = null;
        model.traverse((o) => { if (o.name === "RadarDish") dish = o; });
```
store `dish` in the ship record. In useFrame, per active ship:
```tsx
      if (ship.dish) ship.dish.rotation.z += 1.2 * dt;
      ship.group.position.y += Math.sin(time * 0.6 + i * 2.1) * 0.35;
```
(the wobble line goes right after `curve.getPointAt(t, ship.group.position);`).

- [ ] **Step 5: Gates + commit**

```bash
npm run build && npm run lint && npm test
git add -A
git commit -m "feat: cargo ship v2 — greebled beveled hull with baked color+AO, spinning radar dish, course wobble

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Cratered moon asset + OrbitingMoon GLB switch

**Files:**
- Create: `scripts/blender/gen_moon.py`
- Modify: `scripts/blender/generate.sh` (guarded run), `scripts/optimize-assets.mjs` (+"moon"), `src/components/canvas/SpacePlanets.tsx` (OrbitingMoon)

**Interfaces:**
- `public/models/moon.glb`: single object `Moon`, baked gray color×AO material
- `OrbitingMoon` gains prop `spin?: number` (default 0.15 rad/s self-rotation); loads moon.glb, clones its material, multiplies color by the `color` prop

- [ ] **Step 1: Create `scripts/blender/gen_moon.py`**

```python
# Cratered moon: displaced icosphere with baked gray color+AO.
import bpy
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils

bpy.ops.wm.read_factory_settings(use_empty=True)

bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1.0)
moon = bpy.context.object
moon.name = "Moon"

vor = bpy.data.textures.new("craters", type="VORONOI")
vor.noise_scale = 0.45
vor.distance_metric = "DISTANCE"
d1 = moon.modifiers.new("craters", "DISPLACE")
d1.texture = vor
d1.strength = -0.14
d1.mid_level = 0.35

cl = bpy.data.textures.new("rough", type="CLOUDS")
cl.noise_scale = 0.3
d2 = moon.modifiers.new("rough", "DISPLACE")
d2.texture = cl
d2.strength = 0.05

mat = bpy.data.materials.new("MoonSurface")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.62, 0.62, 0.66, 1.0)
bsdf.inputs["Metallic"].default_value = 0.05
bsdf.inputs["Roughness"].default_value = 0.9
moon.data.materials.append(mat)

# Apply modifiers so the bake sees final geometry
bpy.context.view_layer.objects.active = moon
for m in list(moon.modifiers):
    bpy.ops.object.modifier_apply(modifier=m.name)
bpy.ops.object.shade_smooth()

img = bake_utils.bake_color_ao([moon], "moon_baked", size=1024, ao_samples=32)
bake_utils.apply_baked_material([moon], img, "MoonBaked")

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "moon.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
print("wrote", out)
```
`generate.sh`: add `[ -f scripts/blender/gen_moon.py ] && "$BLENDER" --background --python scripts/blender/gen_moon.py` (and same for comet_head, Task 3). `optimize-assets.mjs`: add `"moon"` (and `"comet_head"`) to the guarded list.

- [ ] **Step 2: OrbitingMoon → GLB in SpacePlanets.tsx**

```tsx
function OrbitingMoon({ distance, speed, inclination, size, color, phase = 0, spin = 0.15 }: OrbitingMoonProps) {
  const { scene } = useGLTF("/models/moon.glb");
  const orbitRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const { geometry, material } = useMemo(() => {
    let g: THREE.BufferGeometry | undefined;
    let m: THREE.MeshStandardMaterial | undefined;
    scene.traverse((o) => {
      if (!g && o instanceof THREE.Mesh) { g = o.geometry; m = (o.material as THREE.MeshStandardMaterial).clone(); }
    });
    if (!g || !m) throw new Error("moon.glb contains no mesh");
    m.color.multiply(new THREE.Color(color)); // per-moon tint over the baked gray
    return { geometry: g, material: m };
  }, [scene, color]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (orbitRef.current) orbitRef.current.rotation.y = phase + t * speed;
    if (meshRef.current) meshRef.current.rotation.y = t * spin;
  });
  return (
    <group rotation={[inclination, 0, 0]}>
      <group ref={orbitRef}>
        <mesh ref={meshRef} position={[distance, 0, 0]} scale={size} geometry={geometry} material={material} />
      </group>
    </group>
  );
}
```
(add `spin?: number` to the props interface; `useGLTF` import exists in the file; drop the old sphere/emissive JSX.)

- [ ] **Step 3: Generate, verify (<700KB), gates, commit**

```bash
git add -A
git commit -m "feat: cratered baked moon asset; moons now rotate and share one GLB with per-moon tint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Icy comet head + tumble

**Files:**
- Create: `scripts/blender/gen_comet_head.py`
- Modify: `scripts/blender/generate.sh`, `src/components/canvas/Comets.tsx`

**Interfaces:**
- `public/models/comet_head.glb`: object `CometHead`, emissive ice material (no bake)
- Comets.tsx: head mesh uses the GLB geometry/material; per-comet tumble axis/speed

- [ ] **Step 1: `scripts/blender/gen_comet_head.py`**

```python
# Irregular icy chunk, emissive — bloom does the glow. No bake needed.
import bpy
import os

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1.0)
head = bpy.context.object
head.name = "CometHead"
tex = bpy.data.textures.new("chunks", type="CLOUDS")
tex.noise_scale = 0.55
d = head.modifiers.new("disp", "DISPLACE")
d.texture = tex
d.strength = 0.35
bpy.context.view_layer.objects.active = head
bpy.ops.object.modifier_apply(modifier="disp")
bpy.ops.object.shade_smooth()

mat = bpy.data.materials.new("Ice")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.85, 0.97, 1.0, 1.0)
bsdf.inputs["Roughness"].default_value = 0.25
bsdf.inputs["Emission Color"].default_value = (0.75, 0.96, 1.0, 1.0)
bsdf.inputs["Emission Strength"].default_value = 2.5
head.data.materials.append(mat)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "comet_head.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
print("wrote", out)
```

- [ ] **Step 2: Comets.tsx — GLB head + tumble**

Load once: `const { scene } = useGLTF("/models/comet_head.glb");` extract geometry+material (shared across both heads — no clone needed, no per-head tint). Replace the `<sphereGeometry args={[0.8, 12, 12]} /> + material` JSX with `<mesh ref=... geometry={headGeometry} material={headMaterial} scale={0.8} />`. Add per-comet tumble in the frame loop:
```tsx
      if (mesh) {
        mesh.position.copy(head);
        mesh.rotation.set(time * (0.4 + i * 0.17), time * (0.31 + i * 0.11), 0);
      }
```

- [ ] **Step 3: Generate, verify (<200KB), gates, commit**

```bash
git add -A
git commit -m "feat: irregular icy comet heads with slow tumble

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Final verification pass

- [ ] **Step 1: Gates + budgets** — build/lint/test (45); `du -sh public/models` < 8MB; inspect cargo_ship for NavRed/NavGreen/RadarDish survival post-optimize.
- [ ] **Step 2: Probe close-ups** — extend the puppeteer rig to park near a trade route and screenshot a passing ship (dish spinning across two frames = different dish angle), a moon at a planet, a comet head. Compare against Phase 3 screenshots.
- [ ] **Step 3: `npm run assets:generate` full re-run from clean assets-src regenerates everything (reproducibility check).**
- [ ] **Step 4: Append `## Verification`; commit.**

## Verification (2026-07-18)

Gates: build ✓ · lint ✓ · tests 45/45 · public/models 4.8M (< 8MB). Name survival verified post-optimize via gltf-transform API: nodes CargoShip + RadarDish; materials HullBaked/Windows/EngineGlow/NavRed/NavGreen/Accent.
Asset sizes: cargo_ship 202KB (baked 1024 color×AO webp), moon 39.5KB, comet_head 4.1KB.
Probe: cratered moon visible orbiting with real surface shading near the video planet (two frames apart — orbital + textured); orbit-lock at warp approach still works; zone chatter fired.
## Verification closure (2026-07-25)

Pending-human items from this plan, resolved:

- Cargo ship close-up (dish spin) — closed by `tests/e2e/assets.probe.mjs` (`cargo
  radar dish spins`); the "greebles" surface-detail close-up judgment is not asserted
  by any probe or QA-checklist item — NOT RUN for that portion.
- Comet head close-up (tumble) — closed by `tests/e2e/assets.probe.mjs` (`comet head
  tumbles`); close-up surface-detail judgment beyond the tumble motion is NOT RUN, same
  caveat as above.
- moon metalness — NOT a defect. The 0.55 default in `bake_utils.apply_baked_material`
  is consumed only by `gen_cargo_ship.py` (a metal hull). `gen_moon.py:52` passes
  `metallic=0.0`, and the shipped artifact confirms it: reading
  `public/models/moon.glb` yields `MoonBaked metal=0.00 rough=0.90`
  (asteroids 0.05/0.92, comet head 0.00/0.96). Guarded against regression by
  `tests/e2e/assets.probe.mjs` ("moon material stays non-metallic").

See `docs/superpowers/plans/2026-07-25-portfolio-content-and-verification.md`.
