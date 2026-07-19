# Generates the low-poly NPC cargo hauler. Run headless:
#   $BLENDER --background --python scripts/blender/gen_cargo_ship.py
# Output: assets-src/cargo_ship.glb (raw; optimized by npm run assets:optimize)
import bpy
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils

bpy.ops.wm.read_factory_settings(use_empty=True)
random.seed(7)


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


HULL = make_material("Hull", (0.40, 0.42, 0.47), roughness=0.45)
ACCENT = make_material("Accent", (0.56, 0.57, 0.62), roughness=0.5)
CONTAINER_RUST = make_material("ContainerRust", (0.48, 0.17, 0.10), metallic=0.4, roughness=0.6)
CONTAINER_TEAL = make_material("ContainerTeal", (0.10, 0.36, 0.36), metallic=0.4, roughness=0.6)
CONTAINER_AMBER = make_material("ContainerAmber", (0.58, 0.36, 0.08), metallic=0.4, roughness=0.6)
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
for i, (y, cmat) in enumerate(zip((-0.75, -0.15, 0.4), (CONTAINER_RUST, CONTAINER_TEAL, CONTAINER_AMBER))):
    add_box(f"container_{i}", (0.42, 0.5, 0.28), (0, y, 0.3), cmat)
    # container ribbing: thin vertical strips like corrugated walls
    for r, ry in enumerate((-0.18, -0.06, 0.06, 0.18)):
        add_box(f"rib_{i}_{r}", (0.44, 0.02, 0.26), (0, y + ry, 0.3), ACCENT)
# Wing stubs
add_box("wing_l", (0.7, 0.4, 0.06), (-0.55, -0.2, 0.0), HULL)
add_box("wing_r", (0.7, 0.4, 0.06), (0.55, -0.2, 0.0), HULL)
# Twin engines at the stern (cylinders along Y)
add_cyl("engine_l", 0.14, 0.5, (-0.28, -1.25, 0.0), (math.radians(90), 0, 0), ACCENT)
add_cyl("engine_r", 0.14, 0.5, (0.28, -1.25, 0.0), (math.radians(90), 0, 0), ACCENT)
add_cyl("nozzle_l", 0.13, 0.06, (-0.28, -1.66, 0.0), (math.radians(90), 0, 0), ENGINE)
add_cyl("nozzle_r", 0.13, 0.06, (0.28, -1.66, 0.0), (math.radians(90), 0, 0), ENGINE)
# Flared engine bells
for bx in (-0.28, 0.28):
    bpy.ops.mesh.primitive_cone_add(radius1=0.10, radius2=0.16, depth=0.18, vertices=16,
                                    location=(bx, -1.62, 0.0), rotation=(math.radians(-90), 0, 0))
    bell = bpy.context.object
    bell.name = f"bell_{bx}"
    bell.data.materials.append(HULL)
    parts.append(bell)
# Lit cargo-bay strip along each hull flank
add_box("strip_l", (0.015, 1.6, 0.04), (-0.26, -0.1, 0.12), WINDOWS)
add_box("strip_r", (0.015, 1.6, 0.04), (0.26, -0.1, 0.12), WINDOWS)
# Nav lights on the wingtips: red = port (-X), green = starboard (+X)
add_sphere("nav_red", 0.06, (-0.92, -0.2, 0.05), NAV_RED)
add_sphere("nav_green", 0.06, (0.92, -0.2, 0.05), NAV_GREEN)

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


def _is_emissive(ob):
    for slot in ob.material_slots:
        m = slot.material
        if m is not None and m.use_nodes and "Principled BSDF" in m.node_tree.nodes:
            if m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value > 0:
                return True
    return False


# Bevel every matte part for worn-edge shading (before join).
# NOTE (deviation from brief): bpy.ops.object.join() only keeps the ACTIVE
# object's modifier stack -- modifiers left on the other selected objects are
# silently dropped when their geometry is merged in. So each bevel is applied
# immediately (object_apply) while that part is still its own object, baking
# the beveled geometry into the mesh before the join collapses everything.
for p in parts:
    if not _is_emissive(p):
        bpy.ops.object.select_all(action="DESELECT")
        p.select_set(True)
        bpy.context.view_layer.objects.active = p
        bev = p.modifiers.new("bevel", "BEVEL")
        bev.width = 0.008
        bev.segments = 2
        bpy.ops.object.modifier_apply(modifier=bev.name)

# join as before -> ship named CargoShip
bpy.ops.object.select_all(action="DESELECT")
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
ship = bpy.context.object
ship.name = "CargoShip"

# --- RadarDish: separate object, NOT joined ---
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.11, segments=12, ring_count=6, location=(-0.12, 0.75, 0.55))
dish = bpy.context.object
dish.name = "RadarDish"
dish.scale = (1.0, 1.0, 0.35)
dish.data.materials.append(ACCENT)

# --- bake hull color+AO and apply ---
img = bake_utils.bake_color_ao([ship], "cargo_ship_baked", size=1024, ao_samples=32)
baked = bake_utils.apply_baked_material([ship], img, "HullBaked")
# Hard-surface detail: level-1 subsurf softens machined edges, fine noise = hull plating
hi = bake_utils.make_hipoly_detail(ship, subsurf_levels=1, noise_scale=0.06, noise_strength=0.008)
nimg = bake_utils.bake_normal_from_hipoly(ship, hi, "cargo_ship_normal", size=1024)
bake_utils.attach_normal_map(baked, nimg)
bpy.data.objects.remove(hi, do_unlink=True)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "cargo_ship.glb"))

# export BOTH objects (ship + dish)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True)
print("wrote", out)
