# Generates the NPC cargo freighter (v3, original work). Run headless:
#   $BLENDER --background --python scripts/blender/gen_cargo_ship.py
# Output: assets-src/cargo_ship.glb (raw; optimized by npm run assets:optimize)
#
# CONTRACT with src/components/canvas/CargoTraffic.tsx and tests/assetContracts.test.ts:
#   nodes: CargoShip (everything joined) + RadarDish (separate; the app spins it)
#   materials: HullBaked (colour x AO bake of every matte part), Windows,
#     EngineGlow, NavRed, NavGreen (emissive, never baked; the app pulses the
#     last three by name), Accent (RadarDish only)
#   Blender +Y = nose (glTF -Z); nose-to-tail 2.62..3.20; red nav light to port (-X)
import bpy
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils  # noqa: E402

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


HULL = make_material("Hull", (0.42, 0.44, 0.48), roughness=0.45)
FRAME = make_material("Frame", (0.20, 0.21, 0.23), roughness=0.55)
ACCENT = make_material("Accent", (0.56, 0.57, 0.62), roughness=0.5)
# Muted shipping-container palette: rust, teal, ochre, slate
CONTAINER_MATS = [make_material(f"Container{i}", c, metallic=0.4, roughness=0.6) for i, c in enumerate(
    ((0.42, 0.16, 0.10), (0.10, 0.30, 0.32), (0.50, 0.33, 0.10), (0.30, 0.32, 0.34)))]
WINDOWS = make_material("Windows", (0.02, 0.02, 0.03), emission=(0.0, 0.94, 1.0), strength=4.0)
ENGINE = make_material("EngineGlow", (0.02, 0.02, 0.03), emission=(0.0, 0.94, 1.0), strength=6.0)
NAV_RED = make_material("NavRed", (0.05, 0.0, 0.0), emission=(1.0, 0.1, 0.1), strength=8.0)
NAV_GREEN = make_material("NavGreen", (0.0, 0.05, 0.0), emission=(0.1, 1.0, 0.3), strength=8.0)

parts = []
# Tiny parts: a bevel costs triangles and adds nothing at traffic distance.
NO_BEVEL = ("rib_", "corner_", "brace_", "diag_", "greeble_", "pipe_")


def _finish(ob, name, mat):
    ob.name = name
    ob.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    parts.append(ob)
    return ob


def add_box(name, size, loc, mat, rot=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    bpy.context.object.scale = size
    return _finish(bpy.context.object, name, mat)


def add_cyl(name, radius, depth, loc, rot, mat, vertices=12):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, vertices=vertices, location=loc, rotation=rot)
    return _finish(bpy.context.object, name, mat)


def add_cone(name, r1, r2, depth, loc, rot, mat, vertices=16):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, vertices=vertices, location=loc, rotation=rot)
    return _finish(bpy.context.object, name, mat)


def add_sphere(name, radius, loc, mat, scale=(1.0, 1.0, 1.0), segments=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=segments, ring_count=rings, location=loc)
    bpy.context.object.scale = scale
    return _finish(bpy.context.object, name, mat)


ALONG_Y = (math.radians(90), 0.0, 0.0)  # cylinder axis Z -> Y

# --- truss spine: two rails, cross braces and alternating diagonals
RAIL_Y0, RAIL_Y1, BAYS = -1.05, 0.70, 7
BAY = (RAIL_Y1 - RAIL_Y0) / BAYS
for s in (-1, 1):
    add_box(f"rail_{s}", (0.05, RAIL_Y1 - RAIL_Y0, 0.05), (s * 0.10, (RAIL_Y0 + RAIL_Y1) / 2, 0.0), FRAME)
for i in range(BAYS + 1):
    add_box(f"brace_{i}", (0.25, 0.03, 0.03), (0.0, RAIL_Y0 + i * BAY, 0.0), FRAME)
for i in range(BAYS):
    ang = math.atan2(0.20, BAY)
    add_box(f"diag_{i}", (0.025, math.hypot(0.20, BAY), 0.025), (0.0, RAIL_Y0 + (i + 0.5) * BAY, 0.0), FRAME,
            rot=(0.0, 0.0, ang if i % 2 else -ang))

# --- container racks: port and starboard, two tiers, four slots; a few slots empty
SLOTS_Y = (-0.80, -0.38, 0.04, 0.46)
CW, CL, CH = 0.30, 0.38, 0.26
for s in (-1, 1):
    for tier, cz in enumerate((0.14, -0.14)):
        for k, cy in enumerate(SLOTS_Y):
            if random.random() < 0.12:
                continue  # an unloaded slot breaks the silhouette
            cx = s * 0.28
            add_box(f"container_{s}_{tier}_{k}", (CW, CL, CH), (cx, cy, cz), random.choice(CONTAINER_MATS))
            for r in range(7):  # corrugation on the outward face
                add_box(f"rib_{s}_{tier}_{k}_{r}", (0.012, 0.025, CH - 0.02),
                        (cx + s * (CW / 2 + 0.006), cy + (r - 3) * 0.05, cz), ACCENT)
            if tier == 0:  # roof corrugation: the chase camera mostly sees container tops
                for r in range(7):
                    add_box(f"rib_top_{s}_{k}_{r}", (CW - 0.03, 0.025, 0.012),
                            (cx, cy + (r - 3) * 0.05, cz + CH / 2 + 0.006), ACCENT)
            for dx in (-1, 1):
                for dy in (-1, 1):
                    add_box(f"corner_{s}_{tier}_{k}_{dx}_{dy}", (0.03, 0.03, 0.03),
                            (cx + dx * CW / 2, cy + dy * CL / 2, cz + CH / 2), FRAME)

# --- crew cab: tapered nose, window band, side ports
cab = add_box("cab", (0.40, 0.42, 0.30), (0.0, 0.93, 0.04), HULL)
for v in cab.data.vertices:  # coordinates are centred on the cab: taper the front half
    if v.co.y > 0:
        v.co.x *= 0.70
        v.co.z *= 0.78
add_box("window_band", (0.22, 0.02, 0.06), (0.0, 1.145, 0.08), WINDOWS)
for s in (-1, 1):
    add_box(f"window_side_{s}", (0.02, 0.12, 0.05), (s * 0.19, 0.90, 0.10), WINDOWS)
add_box("cab_collar", (0.30, 0.06, 0.24), (0.0, 0.70, 0.04), FRAME)
bpy.ops.mesh.primitive_torus_add(major_radius=0.17, minor_radius=0.012, major_segments=24, minor_segments=6,
                                 location=(0.0, 0.66, 0.04), rotation=ALONG_Y)
_finish(bpy.context.object, "dock_ring", WINDOWS)
add_cyl("antenna", 0.012, 0.30, (0.10, 0.85, 0.34), (0.0, 0.0, 0.0), ACCENT, vertices=6)
add_sphere("antenna_tip", 0.025, (0.10, 0.85, 0.50), ACCENT, segments=8, rings=6)

# --- engine block: housing, two bell nozzles, glow discs
add_box("engine_block", (0.56, 0.36, 0.32), (0.0, -1.24, 0.0), HULL)
for s in (-1, 1):
    x = s * 0.15
    add_cyl(f"housing_{s}", 0.13, 0.20, (x, -1.48, 0.0), ALONG_Y, ACCENT, vertices=20)
    add_cone(f"bell_{s}", 0.11, 0.17, 0.18, (x, -1.62, 0.0), (math.radians(-90), 0.0, 0.0), HULL, vertices=20)
    add_cyl(f"nozzle_{s}", 0.105, 0.02, (x, -1.70, 0.0), ALONG_Y, ENGINE, vertices=20)
    add_cyl(f"collar_{s}", 0.145, 0.04, (x, -1.40, 0.0), ALONG_Y, FRAME, vertices=20)

# --- radiators: a fin either side of the engine block, tilted up and out; nav lights on the tips
for s in (-1, 1):
    tilt = math.radians(-20) * s
    add_box(f"radiator_{s}", (0.42, 0.24, 0.012), (s * 0.50, -1.20, 0.10), FRAME, rot=(0.0, tilt, 0.0))
    for r in range(4):
        add_box(f"rib_rad_{s}_{r}", (0.40, 0.012, 0.02), (s * 0.50, -1.29 + r * 0.06, 0.11), ACCENT,
                rot=(0.0, tilt, 0.0))
    tip = (s * (0.50 + 0.21 * math.cos(math.radians(20))), -1.20, 0.10 + 0.21 * math.sin(math.radians(20)))
    add_sphere(f"nav_{s}", 0.045, tip, NAV_RED if s < 0 else NAV_GREEN, segments=10, rings=8)

# --- belly: pipes along the spine and two pressure tanks
for s in (-1, 1):
    add_cyl(f"pipe_{s}", 0.02, 1.60, (s * 0.06, -0.15, -0.09), ALONG_Y, ACCENT, vertices=8)
for k, y in enumerate((-0.60, 0.20)):
    add_sphere(f"tank_{k}", 0.09, (0.0, y, -0.15), HULL, scale=(1.0, 1.8, 1.0))

# --- greebles: seeded boxes on the engine block and cab roof
for g in range(14):
    on_cab = g % 2 == 0
    x = random.uniform(-0.12, 0.12)
    y = random.uniform(0.78, 1.02) if on_cab else random.uniform(-1.36, -1.12)
    z = 0.202 if on_cab else 0.172
    add_box(f"greeble_{g}", (random.uniform(0.03, 0.07), random.uniform(0.03, 0.08), 0.024), (x, y, z),
            HULL if g % 3 else ACCENT)


def _is_emissive(ob):
    for slot in ob.material_slots:
        m = slot.material
        if m is not None and m.use_nodes and "Principled BSDF" in m.node_tree.nodes:
            if m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value > 0:
                return True
    return False


# Bevel every matte part now: join() keeps only the active object's modifiers.
for p in parts:
    if _is_emissive(p) or p.name.startswith(NO_BEVEL):
        continue
    bpy.ops.object.select_all(action="DESELECT")
    p.select_set(True)
    bpy.context.view_layer.objects.active = p
    bev = p.modifiers.new("bevel", "BEVEL")
    bev.width = 0.008
    bev.segments = 2
    bev.limit_method = "ANGLE"
    bpy.ops.object.modifier_apply(modifier=bev.name)

bpy.ops.object.select_all(action="DESELECT")
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
ship = bpy.context.object
ship.name = "CargoShip"

# --- RadarDish: separate object, NOT joined (CargoTraffic spins it)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.10, segments=12, ring_count=6, location=(-0.08, 0.90, 0.24))
dish = bpy.context.object
dish.name = "RadarDish"
dish.scale = (1.0, 1.0, 0.35)
dish.data.materials.append(ACCENT)

# --- bake hull colour + AO, then a hi-poly normal for plating detail
img = bake_utils.bake_color_ao([ship], "cargo_ship_baked", size=1024, ao_samples=32)
baked = bake_utils.apply_baked_material([ship], img, "HullBaked")
hi = bake_utils.make_hipoly_detail(ship, subsurf_levels=1, noise_scale=0.06, noise_strength=0.008)
nimg = bake_utils.bake_normal_from_hipoly(ship, hi, "cargo_ship_normal", size=1024)
bake_utils.attach_normal_map(baked, nimg)
bpy.data.objects.remove(hi, do_unlink=True)

deps = bpy.context.evaluated_depsgraph_get()
me = ship.evaluated_get(deps).data
me.calc_loop_triangles()
ys = [v.co.y for v in me.vertices]
print("TRIS", len(me.loop_triangles), "LENGTH", round(max(ys) - min(ys), 3))

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "cargo_ship.glb"))
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True)
print("wrote", out)
