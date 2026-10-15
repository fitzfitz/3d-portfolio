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
