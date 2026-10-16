# Shipyard (original work, 100% procedural). Run headless:
#   $BLENDER --background --python scripts/blender/gen_shipyard.py
# Output: assets-src/shipyard.glb (raw; optimized by npm run assets:optimize)
#
# CONTRACT with src/components/canvas/Shipyard.tsx and tests/assetContracts.test.ts
# (glTF space, +Y up, drawn at scale 1):
#   nodes: Shipyard (truss arms, cradle saddles, hull ribs, gantry towers and
#     rails, tower work lights) and CraneTrolley (trolley, hoist house, beacon,
#     cable, hook block, belly floodlight). CraneTrolley has no rotation, its origin on the
#     gantry centreline (glTF translation [0, 2.0, 0]): the app slides it along x.
#   materials: HullBaked (colour x AO bake + baked normal map, the cargo
#     ship's texture set) and WorkLight (untextured cool-white emissive).
#     One primitive per material per node: 4 draw calls.
#   <= 5000 triangles. Every vertex within 5.0 of the origin (SHIPYARD_RADII.jumpR
#     6.7 minus the ship's half length). No vertex colours, no tangents.
# Blender axes while building: +Z = up (glTF +Y); the dock runs along X.
import bpy
import bmesh
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets-src", "shipyard.glb")
TEX = 1024
BODY, TROLLEY = 0, 1  # per-face "part" attribute: which node a matte face ends up in

bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene


def srgb(h):
    def c(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(c(int(h[i:i + 2], 16)) for i in (0, 2, 4))


STEEL_BLUE = srgb("5b8cff")
WORK = srgb("cfe0ff")


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
    "light": bake_material("BAKE_light", (0.58, 0.60, 0.63), 1.6),
    "dark": bake_material("BAKE_dark", (0.17, 0.18, 0.20), 2.4),
    "blue": bake_material("BAKE_blue", tuple(c * 0.8 for c in STEEL_BLUE), 2.0),
}

WORK_LIGHT = bpy.data.materials.new("WorkLight")
WORK_LIGHT.use_nodes = True
_wl = WORK_LIGHT.node_tree.nodes["Principled BSDF"]
_wl.inputs["Base Color"].default_value = (*[c * 0.05 for c in WORK], 1.0)
_wl.inputs["Metallic"].default_value = 0.0
_wl.inputs["Roughness"].default_value = 0.4
_wl.inputs["Emission Color"].default_value = (*WORK, 1.0)
_wl.inputs["Emission Strength"].default_value = 6.0

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


LIGHT_PARTS = {}   # light object name -> BODY or TROLLEY


def light_box(name, size, loc, part):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    bpy.context.object.scale = size
    ob = _finish(bpy.context.object, name, WORK_LIGHT, None, 0.0)
    LIGHT_PARTS[ob.name] = part
    return ob


# --------------------- cradle saddle at the origin first (the join target) ---
box("saddle_mid", (0.3, 3.6, 0.25), (0.0, 0.0, -1.3), "dark", BODY)
for x in (-2.4, 2.4):
    box(f"saddle_{x}", (0.3, 3.6, 0.25), (x, 0.0, -1.3), "dark", BODY)
for x in (-2.4, 0.0, 2.4):
    for s in (-1, 1):
        box(f"saddle_post_{x}_{s}", (0.18, 0.18, 0.7), (x, s * 1.2, -0.95), "dark", BODY)

# ----------------------------------------------- two truss arms along X ---
for s in (-1, 1):
    y = s * 1.8
    for z in (-1.2, -0.6):
        cyl(f"chord_{s}_{z}", 0.09, 8.0, (0.0, y, z), "light", BODY, rot=(0.0, math.radians(90), 0.0), verts=8)
    for k in range(10):  # centred on the chords: x = -3.6 .. 3.6
        ang = math.radians(37 if k % 2 == 0 else -37)  # alternating diagonal lacing
        cyl(f"lace_{s}_{k}", 0.045, 0.75, (-3.6 + k * 0.8, y, -0.9), "dark", BODY, bevel=0.0,
            rot=(0.0, ang, 0.0), verts=6)

# ------------------------------------------ hull ribs under construction ---
for k, x in enumerate((-2.0, -1.0, 0.0, 1.0, 2.0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=1.1, minor_radius=0.07, major_segments=20, minor_segments=6,
                                     location=(x, 0.0, -0.35), rotation=(0.0, math.radians(90), 0.0))
    rib = bpy.context.object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    # keep the lower half: a keel cradle that opens upward, not a closed hoop
    bm = bmesh.new()
    bm.from_mesh(rib.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.15], context="VERTS")
    bm.to_mesh(rib.data)
    bm.free()
    _finish(rib, f"rib_{k}", BAKE["light"], BODY, 0.0)
box("keel", (4.4, 0.18, 0.18), (0.0, 0.0, -1.42), "light", BODY)

# ------------------------------------ gantry: 4 towers, top beams, rails ---
for x in (-3.6, 3.6):
    for s in (-1, 1):
        box(f"tower_{x}_{s}", (0.3, 0.3, 3.5), (x, s * 1.8, 0.45), "blue", BODY)
        # on top of the top beam (z 2.06 .. 2.34), not buried in it
        light_box(f"tower_light_{x}_{s}", (0.16, 0.16, 0.1), (x, s * 1.8, 2.39), BODY)
    box(f"top_beam_{x}", (0.28, 3.9, 0.28), (x, 0.0, 2.2), "blue", BODY)
for s in (-1, 1):
    box(f"rail_{s}", (7.5, 0.14, 0.14), (0.0, s * 0.4, 2.2), "dark", BODY, bevel=0.01)
for x in (-2.4, 0.0, 2.4):
    for s in (-1, 1):
        light_box(f"arm_light_{x}_{s}", (0.12, 0.12, 0.08), (x, s * 1.8, -0.5), BODY)

# --------------------------------------- crane trolley (the app slides it) ---
# Its bounding box is centred on its origin (z 1.05 .. 2.95 around 2.0): the
# optimizer's quantize() folds each mesh's bbox centre into its node's
# translation, so a lopsided trolley would ship off the gantry centreline.
box("trolley_body", (0.9, 1.2, 0.4), (0.0, 0.0, 2.0), "blue", TROLLEY)
box("hoist_house", (0.6, 0.8, 0.35), (0.0, 0.0, 2.375), "blue", TROLLEY)
cyl("beacon_mast", 0.03, 0.3, (0.0, 0.0, 2.7), "dark", TROLLEY, bevel=0.0, verts=6)
light_box("trolley_beacon", (0.1, 0.1, 0.1), (0.0, 0.0, 2.9), TROLLEY)
cyl("cable", 0.03, 0.5, (0.0, 0.0, 1.55), "dark", TROLLEY, bevel=0.0, verts=6)
box("hook_block", (0.3, 0.3, 0.25), (0.0, 0.0, 1.175), "dark", TROLLEY)
light_box("trolley_flood", (0.4, 0.5, 0.06), (0.0, 0.0, 1.77), TROLLEY)

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
hull = bpy.context.object

activate(hull)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=False)
bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")

# ------------------------------------------------------------------- bake ---
world = bpy.data.worlds.new("bake_world")
SCENE.world = world
world.light_settings.distance = 0.8  # AO reach (shipyard units)
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
    bake_utils._attach_bake_target([hull], img)
    SCENE.cycles.samples = samples
    activate(hull)
    bpy.ops.object.bake(type=kind, use_clear=True, **kw)
    bake_utils._detach_bake_targets([hull])


col_img = new_img("shipyard_color_raw")
ao_img = new_img("shipyard_ao_raw")
nrm_img = new_img("shipyard_normal", noncolor=True)
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
albedo = new_img("shipyard_albedo")
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

me = hull.data
me.materials.clear()
me.materials.append(HULL)
me.polygons.foreach_set("material_index", np.zeros(len(me.polygons), dtype=np.int32))
me.update()
for m in list(bpy.data.materials):
    if m.name.startswith("BAKE_"):
        bpy.data.materials.remove(m)
for img in (col_img, ao_img):
    bpy.data.images.remove(img)


# ---------------------------- split the trolley into its own node, by part ---
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


trolley_me = me.copy()
trolley = bpy.data.objects.new("CraneTrolley", trolley_me)
SCENE.collection.objects.link(trolley)
trolley_me.name = "CraneTrolley"
keep_part(me, BODY)
keep_part(trolley_me, TROLLEY)

# each work light joins the node it belongs to (one primitive per material);
# grouped first, because a join frees the objects joined in
groups = {part: [ob for ob in LIGHTS if LIGHT_PARTS[ob.name] == part] for part in (BODY, TROLLEY)}
for target, part in ((hull, BODY), (trolley, TROLLEY)):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in groups[part]:
        ob.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()

# the trolley's origin on the gantry centreline: glTF translation [0, 2.0, 0]
SCENE.cursor.location = (0.0, 0.0, 2.0)
activate(trolley)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")

body = hull
body.name = "Shipyard"
body.data.name = "Shipyard"

# ---------------------------------------------------------- report + export ---
deps = bpy.context.evaluated_depsgraph_get()
total = 0
for ob in (body, trolley):
    m = ob.evaluated_get(deps).data
    m.calc_loop_triangles()
    print("TRIS", ob.name, len(m.loop_triangles))
    total += len(m.loop_triangles)
# world space: the trolley's origin sits at z = 2.0, not at the centre
vs = [ob.matrix_world @ v.co for ob in (body, trolley) for v in ob.data.vertices]
print("TRIS_TOTAL", total)
print("MAX_RADIUS", round(max(v.length for v in vs), 3))
print("BLENDER_BBOX x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % (
    min(v.x for v in vs), max(v.x for v in vs), min(v.y for v in vs), max(v.y for v in vs),
    min(v.z for v in vs), max(v.z for v in vs)))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
trolley.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, use_selection=True,
                          export_yup=True)
print("wrote", OUT)
