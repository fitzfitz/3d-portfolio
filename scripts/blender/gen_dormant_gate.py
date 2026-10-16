# Dormant gate (original work, 100% procedural). Run headless:
#   $BLENDER --background --python scripts/blender/gen_dormant_gate.py
# Output: assets-src/dormant_gate.glb
#
# CONTRACT with src/components/canvas/DormantGate.tsx and tests/assetContracts.test.ts
# (glTF space, +Y up, drawn at scale 1):
#   one node, DormantGate: five basalt segments of a hexagonal arch (the
#     sixth slot is empty, two of the five are cracked through) joined into
#     one GateStone primitive, plus GlyphSeam inlays as the second primitive.
#   the opening's axis is glTF +Z (Blender -Y): DormantGate.tsx turns +Z onto
#     GATE_NORMAL, so the opening faces the sun.
#   GateStone: colour x AO bake + normal bake (cargo HullBaked's texture set).
#   GlyphSeam: untextured teal emissive (cargo NavRed's texture set).
#   <= 3000 triangles. Max radius <= 15.5 (GATE_RADIUS 15). Nothing within
#     10 of the axis (GATE_OPENING_R): the opening is open. Depth <= 2.8.
# Blender axes while building: the hexagon lies in Blender's XZ plane (axis = Y).
import bpy
import bmesh
import math
import os
import random
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets-src", "dormant_gate.glb")
TEX = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene


def srgb(h):
    def c(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(c(int(h[i:i + 2], 16)) for i in (0, 2, 4))


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
def stone_material(name):
    """Dark basalt for baking: noise-driven tone, fine fracture lines in colour and bump."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.85
    tc = _n(nt, "ShaderNodeTexCoord")
    noise = _n(nt, "ShaderNodeTexNoise")
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    noise.inputs["Scale"].default_value = 0.9
    noise.inputs["Detail"].default_value = 8.0
    vor = _n(nt, "ShaderNodeTexVoronoi")
    vor.feature = "DISTANCE_TO_EDGE"
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    vor.inputs["Scale"].default_value = 0.7
    # near-black basalt with hairline fractures: brighter or wider lines read
    # as crazy paving at the gate's size (renders, 2026-10-16)
    edge = _math(nt, "LESS_THAN", vor.outputs["Distance"], 0.015)
    tone = _math(nt, "ADD", 0.7, _math(nt, "MULTIPLY", noise.outputs["Fac"], 0.6))
    col = _scale_col(nt, (0.03, 0.032, 0.038), tone)
    col = _mix_col(nt, edge, col, _scale_col(nt, col, 0.5))
    nt.links.new(col, bsdf.inputs["Base Color"])
    bump = _n(nt, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.05
    nt.links.new(_math(nt, "ADD", noise.outputs["Fac"], _math(nt, "MULTIPLY", edge, -0.6)), bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


STONE = stone_material("BAKE_stone")
TEAL = srgb("3de0c8")
SEAM = bpy.data.materials.new("GlyphSeam")
SEAM.use_nodes = True
_s = SEAM.node_tree.nodes["Principled BSDF"]
_s.inputs["Base Color"].default_value = (*[c * 0.05 for c in TEAL], 1.0)
_s.inputs["Metallic"].default_value = 0.0
_s.inputs["Roughness"].default_value = 0.4
_s.inputs["Emission Color"].default_value = (*TEAL, 1.0)
_s.inputs["Emission Strength"].default_value = 4.0


# ---------------------------------------------------------------- builders ---
def activate(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


# ------------------------------------------------- the hexagonal arch ---
APO_IN, APO_OUT, DEPTH = 10.5, 13.0, 1.2
GAP_T = 0.025                 # gap between segments, as a fraction of a side
MISSING = 4                   # the empty slot
CRACKED = {1: 0.42, 3: 0.61}  # slot -> where along the side the crack runs (0..1)
CRACK_HALF = 0.012            # half the crack's width, as a fraction of a side
# A crack is a fracture, not a joint: it zig-zags. Its t offset at the inner
# edge, at JAG_APO and at the outer edge (both halves share it, so they mate).
JAG_APO = 11.6
JAG = {1: (0.015, -0.035, 0.01), 3: (-0.02, 0.03, -0.005)}
SLIP = 0.12                   # how far the broken piece has slipped along the axis
SEGMENTS = []
COS30 = math.cos(math.radians(30))


def side_point(k, apothem, t):
    """Point t (0..1) along hexagon side k at the given apothem, in Blender XZ."""
    r = apothem / COS30
    a0, a1 = math.radians(60 * k), math.radians(60 * (k + 1))
    x0, z0, x1, z1 = r * math.cos(a0), r * math.sin(a0), r * math.cos(a1), r * math.sin(a1)
    return (x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)


def crack_t(k, apo):
    """Where the crack of slot k runs (its centre, as t) at the given apothem."""
    ji, jm, jo = JAG[k]
    if apo <= JAG_APO:
        j = ji + (jm - ji) * (apo - APO_IN) / (JAG_APO - APO_IN)
    else:
        j = jm + (jo - jm) * (apo - JAG_APO) / (APO_OUT - JAG_APO)
    return CRACKED[k] + j


def prism(name, k, profile, slip=0.0):
    """One stone block on side k: the (apothem, t) outline in the hexagon's
    plane, extruded to depth ±DEPTH along Y."""
    n = len(profile)
    verts = []
    for y in (-DEPTH, DEPTH):
        for apo, t in profile:
            x, z = side_point(k, apo, t)
            verts.append((x, y + slip, z))
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    faces += [(i, i + n, (i + 1) % n + n, (i + 1) % n) for i in range(n)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    SCENE.collection.objects.link(ob)
    ob.data.materials.append(STONE)
    SEGMENTS.append(ob)
    return ob


def block(t0, t1):
    return [(APO_IN, t0), (APO_OUT, t0), (APO_OUT, t1), (APO_IN, t1)]


for k in range(6):
    if k == MISSING:
        continue
    if k in CRACKED:
        crack = [(apo, crack_t(k, apo)) for apo in (APO_IN, JAG_APO, APO_OUT)]
        prism(f"seg_{k}_a", k, [(APO_IN, GAP_T), (APO_OUT, GAP_T)]
              + [(apo, t - CRACK_HALF) for apo, t in reversed(crack)])
        prism(f"seg_{k}_b", k, [(apo, t + CRACK_HALF) for apo, t in crack]
              + [(APO_OUT, 1 - GAP_T), (APO_IN, 1 - GAP_T)], slip=SLIP)  # the broken piece has slipped
    else:
        prism(f"seg_{k}", k, block(GAP_T, 1 - GAP_T))

# ------------------------------------------------------- bevels + shading ---
for ob in SEGMENTS:
    activate(ob)
    # outward normals whatever the winding of the hand-built faces
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    mod = ob.modifiers.new("bevel", "BEVEL")
    mod.width = 0.06
    mod.segments = 2
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(30)
    mod.use_clamp_overlap = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    # cut the long faces (both axial faces, inner and outer edge) so the
    # normal bake has surface to land on: end and crack faces are under 6 in
    # area, every long face of even the shortest broken piece is over 9
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    long_edges = {e for f in bm.faces if f.calc_area() > 8.0 for e in f.edges}
    bmesh.ops.subdivide_edges(bm, edges=list(long_edges), cuts=3, use_grid_fill=True)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32), keep_sharp_edges=True)

# ---------------------------------------------- join the segments, unwrap ---
bpy.ops.object.select_all(action="DESELECT")
for ob in SEGMENTS:
    ob.select_set(True)
bpy.context.view_layer.objects.active = SEGMENTS[0]
bpy.ops.object.join()
gate = bpy.context.object
gate.name = "DormantGate"
gate.data.name = "DormantGate"

activate(gate)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=False)
bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")

# ------------------------------------------------------------------- bake ---
world = bpy.data.worlds.new("bake_world")
SCENE.world = world
world.light_settings.distance = 0.8  # AO reach (gate units)
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
    bake_utils._attach_bake_target([gate], img)
    SCENE.cycles.samples = samples
    activate(gate)
    bpy.ops.object.bake(type=kind, use_clear=True, **kw)
    bake_utils._detach_bake_targets([gate])


col_img = new_img("dormant_gate_color_raw")
ao_img = new_img("dormant_gate_ao_raw")
bake("DIFFUSE", col_img, 4, pass_filter={"COLOR"})
bake("AO", ao_img, 64)
# rough rock: a displaced hi-poly duplicate's surface (and the stone's bump)
# baked onto the low-poly UVs, as the freighter does for its hull
hi = bake_utils.make_hipoly_detail(gate, subsurf_levels=2, noise_scale=0.35, noise_strength=0.08)
nrm_img = bake_utils.bake_normal_from_hipoly(gate, hi, "dormant_gate_normal", size=TEX)
bpy.data.objects.remove(hi, do_unlink=True)

npx = TEX * TEX * 4
c = np.empty(npx, dtype=np.float32)
a = np.empty(npx, dtype=np.float32)
col_img.pixels.foreach_get(c)
ao_img.pixels.foreach_get(a)
c = c.reshape(-1, 4)
a = a.reshape(-1, 4)
c[:, :3] *= 0.25 + 0.75 * a[:, :3]
c[:, 3] = 1.0
albedo = new_img("dormant_gate_albedo")
albedo.pixels.foreach_set(c.ravel())
albedo.pack()
nrm_img.pack()

# ------------------------------------------------- final stone material ---
GATE_STONE = bpy.data.materials.new("GateStone")
GATE_STONE.use_nodes = True
_hb = GATE_STONE.node_tree.nodes["Principled BSDF"]
# Matte stone, unlike the hull: the gate faces the sun and is seen from the
# sun side, so view and light share the face normal. At metalness 0.3 /
# roughness 0.5 the GGX highlight filled every face with the warm sun colour
# (in-app, 2026-10-16: tan plates) at ~4x the near-black diffuse. Factors
# only, so the texture set (and shader program) stays the freighter's.
_hb.inputs["Metallic"].default_value = 0.0
_hb.inputs["Roughness"].default_value = 0.92
_tex = GATE_STONE.node_tree.nodes.new("ShaderNodeTexImage")
_tex.image = albedo
GATE_STONE.node_tree.links.new(_tex.outputs["Color"], _hb.inputs["Base Color"])
bake_utils.attach_normal_map(GATE_STONE, nrm_img)

me = gate.data
me.materials.clear()
me.materials.append(GATE_STONE)
me.polygons.foreach_set("material_index", np.zeros(len(me.polygons), dtype=np.int32))
me.update()
for m in list(bpy.data.materials):
    if m.name.startswith("BAKE_"):
        bpy.data.materials.remove(m)
for img in (col_img, ao_img):
    bpy.data.images.remove(img)

# ----------------------------------------- glyph seams (after the bake) ---
rng = random.Random(7)
MID = (APO_IN + APO_OUT) / 2
SEAMS = []


def seam_strip(name, k, t0, t1, apo0, apo1, y):
    """A thin raised strip from (side k, t0, apo0) to (side k, t1, apo1) on the face at y."""
    xa, za = side_point(k, apo0, t0)
    xb, zb = side_point(k, apo1, t1)
    length = math.hypot(xb - xa, zb - za)
    bpy.ops.mesh.primitive_cube_add(size=1, location=((xa + xb) / 2, y, (za + zb) / 2),
                                    rotation=(0.0, -math.atan2(zb - za, xb - xa), 0.0))
    ob = bpy.context.object
    ob.scale = (length, 0.04, 0.10)
    ob.name = name
    ob.data.materials.append(SEAM)
    activate(ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    SEAMS.append(ob)


def piece_slip(k, t):
    """How far the stone under point t of side k has slipped along Y."""
    return SLIP if k in CRACKED and t > CRACKED[k] else 0.0


for k in range(6):
    if k == MISSING:
        continue
    for face_y in (-DEPTH - 0.02, DEPTH + 0.02):           # sun side and far side
        if k in CRACKED:
            # the inscription breaks with the stone: each half rides its own piece
            ct = crack_t(k, MID)
            seam_strip(f"seam_{k}_{face_y}_spine_a", k, 0.15, ct - CRACK_HALF - 0.02, MID, MID, face_y)
            seam_strip(f"seam_{k}_{face_y}_spine_b", k, ct + CRACK_HALF + 0.02, 0.85, MID, MID, face_y + SLIP)
        else:
            seam_strip(f"seam_{k}_{face_y}_spine", k, 0.15, 0.85, MID, MID, face_y)
        for j in range(rng.randint(2, 3)):                  # glyph ticks across the spine
            t = rng.uniform(0.2, 0.8)
            dt = rng.uniform(-0.03, 0.03)
            if k in CRACKED and abs(t - CRACKED[k]) < 0.09:
                # keep a tick off the zig-zag crack, so it never bridges the gap
                t = CRACKED[k] + math.copysign(0.09, t - CRACKED[k])
            seam_strip(f"seam_{k}_{face_y}_tick{j}", k, t, t + dt, APO_IN + 0.5, APO_OUT - 0.5,
                       face_y + piece_slip(k, t))

bpy.ops.object.select_all(action="DESELECT")
for ob in SEAMS:
    ob.select_set(True)
gate.select_set(True)
bpy.context.view_layer.objects.active = gate
bpy.ops.object.join()
body = bpy.context.object
body.name = "DormantGate"
body.data.name = "DormantGate"

# ---------------------------------------------------------- report + export ---
deps = bpy.context.evaluated_depsgraph_get()
m = body.evaluated_get(deps).data
m.calc_loop_triangles()
vs = [v.co for v in body.data.vertices]
print("TRIS_TOTAL", len(m.loop_triangles))
print("MAX_RADIUS", round(max(v.length for v in vs), 3))
print("MIN_AXIAL", round(min(math.hypot(v.x, v.z) for v in vs), 3))
print("BLENDER_BBOX x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % (
    min(v.x for v in vs), max(v.x for v in vs), min(v.y for v in vs), max(v.y for v in vs),
    min(v.z for v in vs), max(v.z for v in vs)))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, use_selection=True,
                          export_yup=True)
print("wrote", OUT)
