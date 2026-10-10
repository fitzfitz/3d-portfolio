# Energy crystal: five bevelled quartz-style shards growing from a faceted
# rock, joined into ONE mesh with ONE material ("Energy_Crystal") carrying a
# painted base-colour atlas and a GRAYSCALE emissive-intensity atlas.
#   $BLENDER --background --python scripts/blender/gen_crystal.py
#
# Original work: every vertex and every texel is generated procedurally below
# (seeded, deterministic). Replaces the old space_crystal.glb.
#
# Game contract (FuelCrystals.tsx / PlasmaAnomalies.tsx take the FIRST mesh,
# bake its node transform and draw it instanced):
#   - one node, one mesh, one primitive, one material named Energy_Crystal
#   - glTF extents ~ x/z +-1.0, y 0..3.9, origin at the base
#   - 300-900 triangles, no transmission
#   - FuelCrystals overrides the emissive COLOUR (gold) but keeps the emissive
#     map, so the map is pure intensity: bright edges/tips/veins, dark cores.
#
# Texture trick: we paint the atlas directly in numpy instead of baking, so
# many faces can share one UV cell (all body facets share 8 painted variants,
# tips share 4, rock tris share 3, every bevel strip shares one gradient).
# Each facet is mapped onto its cell with per-face normalised (across, along)
# coordinates, so the painted rim lands exactly on the facet's real edges.
import bpy
import bmesh
import math
import os
import random

import numpy as np
from mathutils import Vector

SEED = 20261010
TEX = 512
HEIGHT = 3.9  # glTF +Y (Blender +Z)
HALF_W = 1.0  # max |x|, |z| in glTF

KIND_BODY, KIND_TIP, KIND_ROCK, KIND_BEVEL = 1, 2, 3, 4

# Atlas layout in pixels (x0, y0, w, h); y grows upward like UV v.
PAD = 4
BODY_CELLS = [(64 * k, 256, 64, 256) for k in range(8)]
TIP_CELLS = [(128 * k, 128, 128, 128) for k in range(4)]
ROCK_CELLS = [(128 * k, 0, 128, 128) for k in range(3)]
BEVEL_CELL = (384, 0, 128, 128)

bpy.ops.wm.read_factory_settings(use_empty=True)
rng = random.Random(SEED)

bm = bmesh.new()
L_KIND = bm.faces.layers.int.new("kind")
L_VAR = bm.faces.layers.int.new("variant")
L_SHARD = bm.faces.layers.int.new("shard")
L_UV = bm.loops.layers.uv.new("UVMap")


# ---------------------------------------------------------------- geometry
def oriented_face(verts, outward_from, kind, variant=0, shard=-1):
    """Create a face whose normal points away from `outward_from`."""
    f = bm.faces.new(verts)
    f.normal_update()
    centre = f.calc_center_median()
    if f.normal.dot(centre - outward_from(centre)) < 0:
        f.normal_flip()
    f[L_KIND] = kind
    f[L_VAR] = variant
    f[L_SHARD] = shard
    f.smooth = False
    return f


def make_rock():
    """Low faceted rock: jittered icosphere, squashed, cut flat at z=0, capped."""
    res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    for v in res["verts"]:
        d = v.co.normalized()
        r = rng.uniform(0.86, 1.12)
        v.co = Vector((d.x * 0.86 * r, d.y * 0.86 * r, d.z * 0.62 * r + 0.16))
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, 0), plane_no=(0, 0, 1), clear_inner=True)
    boundary = [e for e in bm.edges if e.is_boundary]
    bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    centre = Vector((0, 0, 0.16))
    for f in bm.faces:
        f.normal_update()
        if f.normal.dot(f.calc_center_median() - centre) < 0:
            f.normal_flip()
        f[L_KIND] = KIND_ROCK
        f[L_VAR] = rng.randrange(len(ROCK_CELLS))
        f[L_SHARD] = -1
        f.smooth = False


SHARDS = []  # (base, axis, length) per shard, for UV mapping


def add_shard(idx, base_xy, base_z, tilt_deg, azim_deg, length, radius, sides, tip_ratio):
    tilt, az = math.radians(tilt_deg), math.radians(azim_deg)
    a = Vector((math.sin(tilt) * math.cos(az), math.sin(tilt) * math.sin(az), math.cos(tilt)))
    t1 = a.cross(Vector((0, 1, 0)) if abs(a.y) < 0.9 else Vector((1, 0, 0))).normalized()
    t2 = a.cross(t1).normalized()
    base = Vector((base_xy[0], base_xy[1], base_z))
    twist = rng.uniform(0, 2 * math.pi)
    angs = [twist + 2 * math.pi * i / sides + rng.uniform(-0.10, 0.10) for i in range(sides)]
    rads = [radius * rng.uniform(0.86, 1.10) for _ in range(sides)]
    # Sink the root into the rock, but never through its flat underside.
    bury = max(0.08, min(0.55, (base_z - 0.06 - radius * math.sin(tilt)) / math.cos(tilt)))
    shoulder = length - radius * tip_ratio

    def ring(h, scale):
        return [bm.verts.new(base + a * h + (t1 * math.cos(t) + t2 * math.sin(t)) * r * scale)
                for t, r in zip(angs, rads)]

    bottom = ring(-bury, 0.80)  # slight taper: shards flare as they grow out
    top = ring(shoulder, 0.97)
    apex_off = (t1 * rng.uniform(-1, 1) + t2 * rng.uniform(-1, 1)) * radius * 0.14
    apex = bm.verts.new(base + a * length + apex_off)

    def axis_pt(p):
        return base + a * (p - base).dot(a)

    faces = []
    for i in range(sides):
        j = (i + 1) % sides
        faces.append(oriented_face([bottom[i], bottom[j], top[j], top[i]], axis_pt,
                                   KIND_BODY, rng.randrange(len(BODY_CELLS)), idx))
        faces.append(oriented_face([top[i], top[j], apex], axis_pt,
                                   KIND_TIP, rng.randrange(len(TIP_CELLS)), idx))
    bottom_set = set(bottom)
    edges = {e for f in faces for e in f.edges
             if not (e.verts[0] in bottom_set and e.verts[1] in bottom_set)}
    res = bmesh.ops.bevel(
        bm, geom=list(edges), offset=radius * 0.075, offset_type="OFFSET",
        profile_type="SUPERELLIPSE", segments=1, profile=0.5, affect="EDGES",
        clamp_overlap=True,
    )
    for f in res["faces"]:
        f[L_KIND] = KIND_BEVEL
        f[L_VAR] = 0
        f[L_SHARD] = idx
        f.smooth = False
    SHARDS.append((base, a, length))


make_rock()
# idx, base xy, base z, tilt, azimuth, length, radius, sides, tip length / radius
add_shard(0, (0.00, 0.00), 0.40, 5, 40, 3.62, 0.42, 6, 2.3)
add_shard(1, (0.24, 0.12), 0.36, 21, 22, 2.45, 0.31, 6, 2.1)
add_shard(2, (-0.22, 0.16), 0.36, 26, 142, 2.05, 0.28, 6, 2.2)
add_shard(3, (-0.14, -0.26), 0.30, 36, 246, 1.55, 0.23, 6, 2.0)
add_shard(4, (0.26, -0.22), 0.26, 46, 315, 1.10, 0.18, 5, 1.9)

bm.normal_update()


# ---------------------------------------------------------------- UVs
def cell_uv(cell, u, v):
    x0, y0, w, h = cell
    return ((x0 + PAD + u * (w - 2 * PAD)) / TEX, (y0 + PAD + v * (h - 2 * PAD)) / TEX)


def norm01(vals):
    lo, hi = min(vals), max(vals)
    span = (hi - lo) or 1.0
    return [(x - lo) / span for x in vals]


for f in bm.faces:
    kind = f[L_KIND]
    loops = list(f.loops)
    if kind == KIND_ROCK:
        cell = ROCK_CELLS[f[L_VAR]]
        corners = [(0.0, 0.0), (1.0, 0.0), (0.5, 1.0)]
        if f.normal.z < -0.9:  # flat underside cap: plain slate, no lit rims
            corners = [(0.45, 0.4), (0.55, 0.4), (0.5, 0.5)]
        for i, lp in enumerate(loops):
            lp[L_UV].uv = cell_uv(cell, *corners[i % 3])
        continue
    base, a, length = SHARDS[f[L_SHARD]]
    centre = f.calc_center_median()
    tangent = f.normal.cross(a)
    if tangent.length < 1e-6:
        tangent = a.orthogonal()
    tangent.normalize()
    hs = [(lp.vert.co - base).dot(a) for lp in loops]
    lats = [(lp.vert.co - centre).dot(tangent) for lp in loops]
    if kind == KIND_BEVEL:
        us = norm01(lats)
        for lp, u, h in zip(loops, us, hs):
            lp[L_UV].uv = cell_uv(BEVEL_CELL, 0.2 + 0.6 * u, min(1.0, max(0.0, h / length)))
    elif kind == KIND_TIP and len(loops) == 3:
        cell = TIP_CELLS[f[L_VAR]]
        top = max(range(3), key=lambda i: hs[i])
        rest = sorted((i for i in range(3) if i != top), key=lambda i: lats[i])
        loops[top][L_UV].uv = cell_uv(cell, 0.5, 1.0)
        loops[rest[0]][L_UV].uv = cell_uv(cell, 0.0, 0.0)
        loops[rest[1]][L_UV].uv = cell_uv(cell, 1.0, 0.0)
    else:
        cell = (BODY_CELLS if kind == KIND_BODY else TIP_CELLS)[f[L_VAR]]
        for lp, u, v in zip(loops, norm01(lats), norm01(hs)):
            lp[L_UV].uv = cell_uv(cell, u, v)

# ---------------------------------------------------------------- normalise
xs = [v.co.x for v in bm.verts]
ys = [v.co.y for v in bm.verts]
zs = [v.co.z for v in bm.verts]
cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
s = HEIGHT / (max(zs) - min(zs))
z0 = min(zs)
for v in bm.verts:
    v.co = Vector(((v.co.x - cx) * s, (v.co.y - cy) * s, (v.co.z - z0) * s))
half = max(max(abs(v.co.x), abs(v.co.y)) for v in bm.verts)
if half > HALF_W:  # tiny horizontal squeeze only if the cluster overshoots
    k = HALF_W / half
    for v in bm.verts:
        v.co.x *= k
        v.co.y *= k
print(f"crystal: scale={s:.3f} half_width={half:.3f} -> {min(half, HALF_W):.3f}")

tris = sum(len(f.verts) - 2 for f in bm.faces)
print("crystal: triangles", tris)


# ---------------------------------------------------------------- textures
nrng = np.random.default_rng(SEED)
em = np.zeros((TEX, TEX), np.float32)
col = np.zeros((TEX, TEX, 3), np.float32)


def grid(cell):
    """Per-pixel (U, V) in 0..1 over the padded cell; the pad replicates edges."""
    x0, y0, w, h = cell
    ys_, xs_ = np.mgrid[y0:y0 + h, x0:x0 + w].astype(np.float32)
    U = np.clip((xs_ + 0.5 - (x0 + PAD)) / (w - 2 * PAD), 0, 1)
    V = np.clip((ys_ + 0.5 - (y0 + PAD)) / (h - 2 * PAD), 0, 1)
    return U, V


def put(cell, e, c):
    x0, y0, w, h = cell
    em[y0:y0 + h, x0:x0 + w] = np.clip(e, 0, 1)
    col[y0:y0 + h, x0:x0 + w] = np.clip(c, 0, 1)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy + 1e-9), 0, 1)
    return np.hypot(px - ax - t * dx, py - ay - t * dy)


def waves(U, V, n=3, amp=1.0):
    out = np.zeros_like(U)
    for _ in range(n):
        fu, fv = nrng.uniform(2, 7), nrng.uniform(2, 9)
        out += np.sin(U * fu * 6.283 + V * fv * 2.1 + nrng.uniform(0, 6.283))
    return out * (amp / n)


def veins(P, Q, count, width, v_lo=0.0, v_hi=1.0, aspect=1.0):
    """Thin jagged fracture lines (two segments each) in (P*aspect, Q) space."""
    acc = np.zeros_like(P)
    for _ in range(count):
        u0 = nrng.uniform(0.2, 0.8)
        v0 = nrng.uniform(v_lo, v_lo + 0.3 * (v_hi - v_lo))
        um = np.clip(u0 + nrng.uniform(-0.35, 0.35), 0.1, 0.9)
        vm = nrng.uniform(v0 + 0.15, v_hi - 0.1)
        u1 = np.clip(um + nrng.uniform(-0.3, 0.3), 0.05, 0.95)
        v1 = nrng.uniform(vm + 0.05, v_hi)
        d = np.minimum(seg_dist(P * aspect, Q, u0 * aspect, v0, um * aspect, vm),
                       seg_dist(P * aspect, Q, um * aspect, vm, u1 * aspect, v1))
        acc = np.maximum(acc, np.exp(-(d / width) ** 2) * nrng.uniform(0.55, 0.9))
    return acc


CRYS_ROOT = np.array([0.10, 0.11, 0.14], np.float32)
CRYS_TOP = np.array([0.30, 0.32, 0.36], np.float32)

# Body facets: dark root -> brighter crown, hot rims on the long edges,
# a couple of internal fractures and a soft energy pocket.
BODY_ASPECT = 0.2  # facet width / height, so veins/rims are even in world space
for cell in BODY_CELLS:
    U, V = grid(cell)
    d = np.minimum(U, 1 - U) * BODY_ASPECT
    core = 0.04 + 0.24 * V ** 1.8
    rim = np.exp(-d / 0.018) * (0.45 + 0.50 * V)
    crown = np.exp(-(1 - V) / 0.025) * 0.45
    pocket = np.zeros_like(U)
    for _ in range(nrng.integers(1, 3)):
        pu, pv = nrng.uniform(0.3, 0.7), nrng.uniform(0.35, 0.85)
        pocket += np.exp(-(((U - pu) * BODY_ASPECT) ** 2 + (V - pv) ** 2 * 0.25) / 0.012) * 0.22
    vn = veins(U, V, int(nrng.integers(2, 4)), 0.010, aspect=BODY_ASPECT)
    e = core + rim + crown + pocket + vn * (0.35 + 0.45 * V) + waves(U, V, amp=0.03)
    c = CRYS_ROOT[None, None] * (1 - V[..., None]) + CRYS_TOP[None, None] * V[..., None]
    c = c + (rim[..., None] * 0.25) + vn[..., None] * 0.12
    put(cell, e, c)

# Tip facets: triangle (0,0)-(1,0)-(0.5,1); brightest at the apex, hot rims.
TIP_ASPECT = 0.55
for cell in TIP_CELLS:
    U, V = grid(cell)
    P = U * TIP_ASPECT
    dl = seg_dist(P, V, 0, 0, 0.5 * TIP_ASPECT, 1)
    dr = seg_dist(P, V, TIP_ASPECT, 0, 0.5 * TIP_ASPECT, 1)
    db = V
    d = np.minimum(np.minimum(dl, dr), db)
    core = 0.22 + 0.46 * V ** 1.3
    rim = np.exp(-d / 0.03) * 0.55
    vn = veins(U, V, 2, 0.012, v_lo=0.0, v_hi=0.9, aspect=TIP_ASPECT)
    e = core + rim + vn * 0.35 + np.exp(-(1 - V) / 0.08) * 0.3 + waves(U, V, amp=0.03)
    c = CRYS_TOP[None, None] * (0.9 + 0.2 * V[..., None]) + rim[..., None] * 0.2
    put(cell, e, c)

# Rock tris: near-black slate, faint lit edges, glowing seams on two variants.
for k, cell in enumerate(ROCK_CELLS):
    U, V = grid(cell)
    dl = seg_dist(U, V, 0, 0, 0.5, 1)
    dr = seg_dist(U, V, 1, 0, 0.5, 1)
    d = np.minimum(np.minimum(dl, dr), V)
    grain = waves(U * 3, V * 3, n=4, amp=1.0)
    rim = np.exp(-d / 0.04)
    e = 0.025 + 0.015 * grain + rim * 0.05
    if k > 0:
        e = e + veins(U, V, 2, 0.018, v_lo=0.0, v_hi=1.0) * 0.55
    slate = np.array([0.075, 0.072, 0.085], np.float32)
    c = slate[None, None] * (1 + 0.25 * grain[..., None]) + rim[..., None] * 0.07
    put(cell, e, c)

# Bevel strips (all shards share it): hot edges, fading toward the roots.
U, V = grid(BEVEL_CELL)
put(BEVEL_CELL, 0.55 + 0.45 * V ** 0.8, np.repeat((0.80 + 0.12 * V)[..., None], 3, axis=2))


def to_image(name, rgb):
    img = bpy.data.images.new(name, width=TEX, height=TEX, alpha=False)
    rgba = np.ones((TEX, TEX, 4), np.float32)
    rgba[..., :3] = rgb
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


img_col = to_image("energy_crystal_color", col)
img_em = to_image("energy_crystal_emissive", np.repeat(em[..., None], 3, axis=2))

# ---------------------------------------------------------------- material
mat = bpy.data.materials.new("Energy_Crystal")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = 0.3
tc = nt.nodes.new("ShaderNodeTexImage")
tc.image = img_col
nt.links.new(tc.outputs["Color"], bsdf.inputs["Base Color"])
te = nt.nodes.new("ShaderNodeTexImage")
te.image = img_em
nt.links.new(te.outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 1.0

# ---------------------------------------------------------------- object
for layer in (L_KIND, L_VAR, L_SHARD):
    bm.faces.layers.int.remove(layer)
me = bpy.data.meshes.new("Energy_Crystal")
bm.to_mesh(me)
bm.free()
me.materials.append(mat)
obj = bpy.data.objects.new("Energy_Crystal", me)
bpy.context.scene.collection.objects.link(obj)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "space_crystal.glb"))
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
print("wrote", out)
