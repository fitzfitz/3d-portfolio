# Generates the player's hero ship (original work, 100% procedural). Run headless:
#   $BLENDER --background --python scripts/blender/gen_spaceship.py
# Output: assets-src/spaceship.glb (raw; optimized by npm run assets:optimize)
#
# CONTRACT with src/components/canvas/Spaceship.tsx (glTF space, +Y up):
#   nose -> -Z, engines -> +Z; extents ~ x +-2.7, y -0.6..0.65, z -3.5..3.5
#   three nozzles centred at (-0.582|0|+0.582, -0.05, 3.25), exit plane z ~ 3.5
#   nozzle glow material is named exactly "Engine_Emissive" (the code matches
#   /engine/i, so NO other material may contain "engine"); every other emissive
#   is named Neon_* so the code leaves its glow alone.
# Blender axes used while building: +Y = nose, -Y = engines, +Z = up. The glTF
# exporter maps Blender (x, y, z) -> glTF (x, z, -y), giving the contract above.
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
OUT = os.path.join(ROOT, "assets-src", "spaceship.glb")
TEX = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
random.seed(1977)
SCENE = bpy.context.scene

NOZZLE_X = (-0.582, 0.0, 0.582)
NOZZLE_Z = -0.05  # Blender z of the nozzle axis (= glTF y)

# ---------------------------------------------------------------- materials ---
# Bake materials: albedo is designed procedurally here (panel seams, per-panel
# tone, grime, edge wear, livery) then baked into one texture. metallic=0 so the
# DIFFUSE/COLOR pass returns the full albedo.
BAKE_BASE = {
    "hull": (0.052, 0.056, 0.064),
    "hull_mid": (0.080, 0.085, 0.096),
    "panel": (0.150, 0.155, 0.165),
    "metal": (0.300, 0.310, 0.330),
    "dark": (0.014, 0.015, 0.018),
}
PAINT_LIGHT = (0.62, 0.62, 0.60)


def _n(nt, kind, **props):
    node = nt.nodes.new(kind)
    for k, v in props.items():
        setattr(node, k, v)
    return node


def _math(nt, op, a, b=None, clamp=False):
    m = nt.nodes.new("ShaderNodeMath")
    m.operation = op
    m.use_clamp = clamp
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


def make_bake_material(cat):
    base = BAKE_BASE[cat]
    m = bpy.data.materials.new("BAKE_" + cat)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.6
    tc = _n(nt, "ShaderNodeTexCoord")
    sp = _n(nt, "ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sp.inputs[0])
    sn = _n(nt, "ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Normal"], sn.inputs[0])
    ax = _math(nt, "ABSOLUTE", sp.outputs[0])
    any_ = _math(nt, "ABSOLUTE", sn.outputs[1])
    anz = _math(nt, "ABSOLUTE", sn.outputs[2])
    # box projection; |x| keeps the plating mirror-symmetric
    m_front = _math(nt, "GREATER_THAN", any_, 0.7)
    m_top = _math(nt, "MULTIPLY", _math(nt, "GREATER_THAN", anz, 0.55), _math(nt, "SUBTRACT", 1.0, m_front))
    m_side = _math(nt, "SUBTRACT", _math(nt, "SUBTRACT", 1.0, m_front), m_top)
    u = _math(nt, "ADD", _math(nt, "MULTIPLY", m_front, ax),
              _math(nt, "MULTIPLY", _math(nt, "ADD", m_top, m_side), sp.outputs[1]))
    v = _math(nt, "ADD", _math(nt, "ADD", _math(nt, "MULTIPLY", m_front, sp.outputs[2]),
                                 _math(nt, "MULTIPLY", m_top, ax)),
              _math(nt, "MULTIPLY", m_side, sp.outputs[2]))
    vec = _n(nt, "ShaderNodeCombineXYZ")
    nt.links.new(u, vec.inputs[0])
    nt.links.new(v, vec.inputs[1])

    def brick(width, row, mortar, offset, shift):
        b = _n(nt, "ShaderNodeTexBrick", offset=offset, offset_frequency=2)
        add = nt.nodes.new("ShaderNodeVectorMath")
        add.operation = "ADD"
        nt.links.new(vec.outputs[0], add.inputs[0])
        add.inputs[1].default_value = shift
        nt.links.new(add.outputs[0], b.inputs["Vector"])
        b.inputs["Color1"].default_value = (0, 0, 0, 1)
        b.inputs["Color2"].default_value = (1, 1, 1, 1)
        b.inputs["Mortar"].default_value = (0.5, 0.5, 0.5, 1)
        b.inputs["Scale"].default_value = 1.0
        b.inputs["Mortar Size"].default_value = mortar
        b.inputs["Mortar Smooth"].default_value = 0.15
        b.inputs["Brick Width"].default_value = width
        b.inputs["Row Height"].default_value = row
        sep = _n(nt, "ShaderNodeSeparateColor")
        nt.links.new(b.outputs["Color"], sep.inputs[0])
        return b.outputs["Fac"], sep.outputs[0]

    s1, v1 = brick(0.82, 0.29, 0.0040, 0.5, (0.13, 0.07, 0.0))
    s2, v2 = brick(2.10, 0.87, 0.0070, 0.35, (0.41, 0.23, 0.0))
    seam = _math(nt, "MAXIMUM", _math(nt, "MULTIPLY", s1, 0.75), s2)
    var = _math(nt, "ADD", _math(nt, "MULTIPLY", v1, 0.55), _math(nt, "MULTIPLY", v2, 0.45))
    tone = _math(nt, "ADD", 0.78, _math(nt, "MULTIPLY", var, 0.44))
    noise = _n(nt, "ShaderNodeTexNoise")
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    noise.inputs["Scale"].default_value = 2.2
    noise.inputs["Detail"].default_value = 8.0
    grime = _math(nt, "ADD", 0.80, _math(nt, "MULTIPLY", noise.outputs["Fac"], 0.32))
    col = _scale_col(nt, base, _math(nt, "MULTIPLY", tone, grime))
    if cat not in ("metal", "dark"):
        # livery: chordwise double stripe near each wingtip, cyan fin tips
        def band(lo, hi):
            return _math(nt, "MULTIPLY", _math(nt, "GREATER_THAN", ax, lo), _math(nt, "LESS_THAN", ax, hi))
        stripe = _math(nt, "MAXIMUM", band(1.86, 1.95), band(2.00, 2.03))
        col = _mix_col(nt, stripe, col, PAINT_LIGHT)
        fin = _math(nt, "MULTIPLY", _math(nt, "GREATER_THAN", sp.outputs[2], 0.555), _math(nt, "GREATER_THAN", ax, 0.45))
        col = _mix_col(nt, fin, col, PAINT_LIGHT)
        fin2 = _math(nt, "MULTIPLY", _math(nt, "GREATER_THAN", sp.outputs[2], 0.50), _math(nt, "LESS_THAN", sp.outputs[2], 0.53))
        col = _mix_col(nt, _math(nt, "MULTIPLY", fin2, _math(nt, "GREATER_THAN", ax, 0.45)), col, PAINT_LIGHT)
    # seams: dark recessed lines
    col = _mix_col(nt, seam, col, _scale_col(nt, col, 0.28))
    # edge wear: bevel-node normal deviates from the true normal near edges
    bev = _n(nt, "ShaderNodeBevel")
    bev.inputs["Radius"].default_value = 0.012
    geo = _n(nt, "ShaderNodeNewGeometry")
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    nt.links.new(bev.outputs[0], dot.inputs[0])
    nt.links.new(geo.outputs["Normal"], dot.inputs[1])
    edge = _n(nt, "ShaderNodeMapRange")
    nt.links.new(_math(nt, "SUBTRACT", 1.0, dot.outputs["Value"]), edge.inputs["Value"])
    edge.inputs["From Min"].default_value = 0.01
    edge.inputs["From Max"].default_value = 0.12
    edge_amt = _math(nt, "MULTIPLY", edge.outputs[0], 0.9 if cat != "dark" else 0.3)
    col = _mix_col(nt, edge_amt, col, _scale_col(nt, col, 1.9))
    nt.links.new(col, bsdf.inputs["Base Color"])
    # bump from the seams -> baked into the normal map
    bump = _n(nt, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.004
    nt.links.new(_math(nt, "SUBTRACT", 1.0, seam), bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


BAKE_MATS = {c: make_bake_material(c) for c in BAKE_BASE}


def srgb(h):
    def c(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(c(int(h[i:i + 2], 16)) for i in (0, 2, 4))


def emissive_mat(name, hexcol, strength, base_scale=0.05):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    lin = srgb(hexcol)
    b.inputs["Base Color"].default_value = (*[c * base_scale for c in lin], 1.0)
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Roughness"].default_value = 0.4
    b.inputs["Emission Color"].default_value = (*lin, 1.0)
    b.inputs["Emission Strength"].default_value = strength
    m.use_backface_culling = False
    return m


ENGINE = emissive_mat("Engine_Emissive", "00f0ff", 1.0, base_scale=0.6)
NEON_CYAN = emissive_mat("Neon_Cyan", "00f0ff", 2.0)
NEON_GREEN = emissive_mat("Neon_Green", "00ff87", 2.5)
NEON_PINK = emissive_mat("Neon_Pink", "ec4899", 2.5)

CANOPY = bpy.data.materials.new("Canopy")
CANOPY.use_nodes = True
_cb = CANOPY.node_tree.nodes["Principled BSDF"]
_cb.inputs["Base Color"].default_value = (0.010, 0.022, 0.040, 1.0)
_cb.inputs["Metallic"].default_value = 0.35
_cb.inputs["Roughness"].default_value = 0.07

NON_BAKED = {"canopy": CANOPY, "engine": ENGINE, "neon_c": NEON_CYAN, "neon_g": NEON_GREEN, "neon_p": NEON_PINK}

# ------------------------------------------------------------ mesh helpers ---
PARTS = []  # (object, category, bevel_width, bevel_segments)


def make_obj(name, verts, faces, cat, bevel=0.0, segs=2, recalc=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    SCENE.collection.objects.link(ob)
    mat = NON_BAKED.get(cat) or BAKE_MATS[cat]
    me.materials.append(mat)
    PARTS.append((ob, cat, bevel, segs))
    return ob


def loft(name, rings, cat, bevel=0.0, segs=2, cap=True):
    n = len(rings[0])
    verts = [p for r in rings for p in r]
    faces = []
    for i in range(len(rings) - 1):
        for j in range(n):
            a, b = i * n + j, i * n + (j + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap:
        faces.append(tuple(range(n)))
        last = (len(rings) - 1) * n
        faces.append(tuple(range(last, last + n)))
    return make_obj(name, verts, faces, cat, bevel, segs)


def lathe(name, profile, cx, cz, cat, segs=32, closed=False, bevel=0.0, bsegs=2, recalc=True, cap=True):
    """Revolve profile [(r, y), ...] around the Y-parallel axis through (cx, cz)."""
    verts, idx = [], []
    for r, y in profile:
        if r < 1e-6:
            idx.append([len(verts)] * segs)
            verts.append((cx, y, cz))
        else:
            row = []
            for j in range(segs):
                a = 2 * math.pi * j / segs
                row.append(len(verts))
                verts.append((cx + r * math.cos(a), y, cz + r * math.sin(a)))
            idx.append(row)
    faces = []
    count = len(profile) if closed else len(profile) - 1
    for i in range(count):
        r0, r1 = idx[i], idx[(i + 1) % len(profile)]
        for j in range(segs):
            q = (r0[j], r0[(j + 1) % segs], r1[(j + 1) % segs], r1[j])
            uq = []
            for v in q:
                if v not in uq:
                    uq.append(v)
            if len(uq) >= 3:
                faces.append(tuple(uq))
    if not closed and cap:
        for k in (0, len(profile) - 1):
            if profile[k][0] > 1e-6:
                faces.append(tuple(idx[k]))
    return make_obj(name, verts, faces, cat, bevel, bsegs, recalc=recalc)


def inset_poly(poly, d):
    """Mitred inward offset of a simple polygon (either winding)."""
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    sgn = 1.0 if area > 0 else -1.0  # CCW -> inward normal is left of edge
    lines = []
    for i in range(n):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy)
        nx, ny = -dy / L * sgn, dx / L * sgn
        lines.append(((x0 + nx * d, y0 + ny * d), (dx, dy)))
    out = []
    for i in range(n):
        (p, r), (q, s) = lines[i - 1], lines[i]
        den = r[0] * s[1] - r[1] * s[0]
        if abs(den) < 1e-9:
            out.append(q)
            continue
        t = ((q[0] - p[0]) * s[1] - (q[1] - p[1]) * s[0]) / den
        out.append((p[0] + r[0] * t, p[1] + r[1] * t))
    return out


def slab(name, poly, cat, half_fn, xf, inset=0.0, edge_frac=0.35, bevel=0.0, segs=2):
    """Chamfered slab: inner polygon at full thickness, outer rim thinner.
    half_fn(u, v) -> (centre_w, half_thickness); xf(u, v, w) -> world xyz."""
    n = len(poly)
    inner = inset_poly(poly, inset) if inset > 0 else poly
    verts = []

    def put(u, v, k):
        c, h = half_fn(u, v)
        verts.append(xf(u, v, c + h * k))

    for (u, v) in poly:
        put(u, v, edge_frac if inset > 0 else 1.0)   # 0..n-1 outer top
    for (u, v) in poly:
        put(u, v, -edge_frac if inset > 0 else -1.0)  # n..2n-1 outer bottom
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    if inset > 0:
        for (u, v) in inner:
            put(u, v, 1.0)   # 2n.. inner top
        for (u, v) in inner:
            put(u, v, -1.0)  # 3n.. inner bottom
        for i in range(n):
            j = (i + 1) % n
            faces.append((i, j, 2 * n + j, 2 * n + i))
            faces.append((n + i, n + j, 3 * n + j, 3 * n + i))
        faces.append(tuple(range(2 * n, 3 * n)))
        faces.append(tuple(range(3 * n, 4 * n)))
    else:
        faces.append(tuple(range(n)))
        faces.append(tuple(range(n, 2 * n)))
    return make_obj(name, verts, faces, cat, bevel, segs)


def box(name, center, size, cat, bevel=0.0, segs=1):
    cx, cy, cz = center
    sx, sy, sz = (s / 2 for s in size)
    verts = [(cx + x * sx, cy + y * sy, cz + z * sz) for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return make_obj(name, verts, faces, cat, bevel, segs)


def obox(name, c, axes, half, cat, bevel=0.0, segs=1):
    """Oriented box: centre c, unit axes (u, v, w), half extents."""
    verts = []
    for i in (-1, 1):
        for j in (-1, 1):
            for k in (-1, 1):
                verts.append(tuple(c[n] + i * half[0] * axes[0][n] + j * half[1] * axes[1][n] + k * half[2] * axes[2][n]
                                   for n in range(3)))
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return make_obj(name, verts, faces, cat, bevel, segs)


def spline(keys, y):
    """Catmull-Rom through [(y, value-tuple), ...] sorted by y."""
    ys = [k[0] for k in keys]
    vals = [k[1] for k in keys]
    if y <= ys[0]:
        return vals[0]
    if y >= ys[-1]:
        return vals[-1]
    i = max(j for j in range(len(ys) - 1) if ys[j] <= y)
    t = (y - ys[i]) / (ys[i + 1] - ys[i])
    p1, p2 = vals[i], vals[i + 1]
    p0 = vals[i - 1] if i > 0 else tuple(2 * a - b for a, b in zip(p1, p2))
    p3 = vals[i + 2] if i + 2 < len(vals) else tuple(2 * b - a for a, b in zip(p1, p2))
    return tuple(0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3)
                 for a, b, c, d in zip(p0, p1, p2, p3))


def lerp_keys(keys, y):
    ys = [k[0] for k in keys]
    if y <= ys[0]:
        return keys[0][1]
    if y >= ys[-1]:
        return keys[-1][1]
    i = max(j for j in range(len(ys) - 1) if ys[j] <= y)
    t = (y - ys[i]) / (ys[i + 1] - ys[i])
    return tuple(a + (b - a) * t for a, b in zip(keys[i][1], keys[i + 1][1]))


# ---------------------------------------------------------------- fuselage ---
# (y, (half-width, top, bottom, ridge, chine z))
FUS = [
    (-2.40, (0.57, 0.250, -0.32, 0.030, -0.03)),
    (-1.50, (0.62, 0.270, -0.33, 0.030, -0.03)),
    (-0.70, (0.64, 0.280, -0.33, 0.030, -0.03)),
    (0.10, (0.63, 0.285, -0.33, 0.030, -0.03)),
    (0.80, (0.59, 0.275, -0.32, 0.030, -0.035)),
    (1.45, (0.52, 0.250, -0.30, 0.030, -0.04)),
    (2.05, (0.43, 0.205, -0.27, 0.028, -0.05)),
    (2.55, (0.33, 0.150, -0.225, 0.022, -0.055)),
    (3.00, (0.21, 0.085, -0.170, 0.012, -0.06)),
    (3.32, (0.10, 0.020, -0.115, 0.0, -0.06)),
    (3.50, (0.018, -0.035, -0.075, 0.0, -0.055)),
]


def fus_params(y):
    return spline(FUS, y)


def fus_pts2d(y):
    w, t, b, r, cz = fus_params(y)
    half = [(0.0, t + r), (0.40 * w, t), (0.90 * w, cz + (t - cz) * 0.45), (w, cz),
            (0.86 * w, cz + (b - cz) * 0.5), (0.45 * w, b), (0.0, b)]
    return half


def fus_ring(y):
    half = fus_pts2d(y)
    ring = [(x, y, z) for x, z in half]
    ring += [(-x, y, z) for x, z in reversed(half[1:-1])]
    return ring


ys = [-2.40, -1.9, -1.4, -0.9, -0.4, 0.1, 0.6, 1.05, 1.45, 1.8, 2.1, 2.4, 2.65, 2.88, 3.08, 3.25, 3.38, 3.47, 3.50]
loft("fuselage", [fus_ring(y) for y in ys], "hull", bevel=0.018, segs=2)


def fus_top_z(y):
    w, t, b, r, cz = fus_params(y)
    return t + r


def flank_frame(y):
    """Upper flank facet (p1 -> p2) of the fuselage at station y."""
    h = fus_pts2d(y)
    (x1, z1), (x2, z2) = h[1], h[2]
    L = math.hypot(x2 - x1, z2 - z1)
    d = ((x2 - x1) / L, (z2 - z1) / L)
    n = (-d[1], d[0]) if -d[1] > 0 else (d[1], -d[0])  # outward (+x / up)
    if n[1] < 0 and n[0] < 0:
        n = (-n[0], -n[1])
    return (x1, z1), d, n, L


# ---------------------------------------------------------------- canopy ---
CAN = [  # (y, (half-width, peak height above fuselage top))
    (0.80, (0.05, 0.035)),
    (0.98, (0.15, 0.110)),
    (1.25, (0.205, 0.175)),
    (1.60, (0.218, 0.190)),
    (1.95, (0.178, 0.150)),
    (2.20, (0.110, 0.090)),
    (2.38, (0.030, 0.020)),
]


def canopy_ring(y, grow=0.0, lift=0.0):
    cw, ch = spline(CAN, y)
    base = fus_top_z(y) - 0.045
    top = fus_top_z(y) + ch
    ring = []
    k = 10
    for i in range(k + 1):
        th = math.pi * i / k
        s = math.sin(th)
        ring.append(((cw + grow) * math.cos(th), y, base + (top - base + lift) * (s ** 0.7)))
    return ring


can_ys = [0.80, 0.86, 0.95, 1.08, 1.25, 1.42, 1.60, 1.78, 1.95, 2.08, 2.20, 2.30, 2.38]
loft("canopy", [canopy_ring(y) for y in can_ys], "canopy", bevel=0.0)
# canopy frame arches + spine sill
for k, y0 in enumerate((1.18, 1.72)):
    loft(f"canopy_arch_{k}", [canopy_ring(y, 0.012, 0.012) for y in (y0 - 0.022, y0 + 0.022)], "metal", bevel=0.004, segs=1)

# ------------------------------------------------------------- engine block ---
HOUSING = [  # (y, (half-width, top, bottom, chamfer))
    (-2.97, (0.905, 0.275, -0.350, 0.12)),
    (-2.80, (0.930, 0.300, -0.375, 0.14)),
    (-2.00, (0.930, 0.310, -0.380, 0.14)),
    (-1.58, (0.800, 0.300, -0.360, 0.15)),
    (-1.20, (0.450, 0.220, -0.280, 0.12)),
]


def housing_ring(y):
    hw, zt, zb, c = lerp_keys(HOUSING, y)
    return [(hw - c, y, zt), (hw, y, zt - c), (hw, y, zb + c), (hw - c, y, zb),
            (-(hw - c), y, zb), (-hw, y, zb + c), (-hw, y, zt - c), (-(hw - c), y, zt)]


loft("housing", [housing_ring(k[0]) for k in HOUSING], "hull_mid", bevel=0.02, segs=2)

# armoured hood overhanging the nozzles (layered top deck)
hood_poly = [(-0.93, -2.48), (0.93, -2.48), (0.95, -3.05), (0.84, -3.19), (0.36, -3.19), (0.24, -3.11),
             (-0.24, -3.11), (-0.36, -3.19), (-0.84, -3.19), (-0.95, -3.05)]
slab("hood", hood_poly, "panel", lambda u, v: (0.300, 0.036), lambda u, v, w: (u, v, w),
     inset=0.035, edge_frac=0.35, bevel=0.006, segs=1)

for i, x in enumerate(NOZZLE_X):
    # nacelle tube + collar out of the bulkhead
    lathe(f"nacelle_{i}", [(0.248, -2.60), (0.248, -3.06)], x, NOZZLE_Z, "hull_mid", segs=36, bevel=0.006)
    lathe(f"collar_{i}", [(0.255, -2.965), (0.272, -2.975), (0.272, -3.035), (0.255, -3.045)],
          x, NOZZLE_Z, "metal", segs=36, closed=True)
    # bell: closed revolved ring (outer skin, lip, inner wall)
    lathe(f"bell_{i}", [(0.238, -3.03), (0.248, -3.12), (0.260, -3.30), (0.270, -3.45), (0.274, -3.50),
                        (0.254, -3.50), (0.243, -3.43), (0.226, -3.26), (0.209, -3.11), (0.205, -3.03)],
          x, NOZZLE_Z, "metal", segs=40, closed=True)
    # cooling bands on the bell skin
    for k, (y0, r0) in enumerate(((-3.19, 0.254), (-3.36, 0.266))):
        lathe(f"band_{i}_{k}", [(r0 - 0.004, y0 + 0.016), (r0 + 0.007, y0 + 0.012), (r0 + 0.007, y0 - 0.012),
                                (r0 - 0.004, y0 - 0.016)], x, NOZZLE_Z, "dark", segs=40, closed=True)
    # glowing liner: disc + flared wall, inside the bell's inner wall
    lathe(f"glow_{i}", [(0.0, -3.00), (0.180, -3.00), (0.192, -3.10), (0.211, -3.25), (0.229, -3.42),
                        (0.236, -3.49)], x, NOZZLE_Z, "engine", segs=40, recalc=False, cap=False)
    # centre-body spike
    lathe(f"spike_{i}", [(0.0, -2.99), (0.088, -2.99), (0.088, -3.07), (0.074, -3.17), (0.048, -3.27),
                         (0.016, -3.33), (0.0, -3.34)], x, NOZZLE_Z, "metal", segs=24)
    # stator vanes between the centre-body and the liner
    for k in range(8):
        a = 2 * math.pi * (k + 0.5) / 8
        cu, su = math.cos(a), math.sin(a)
        r0, r1 = 0.080, 0.200
        obox(f"vane_{i}_{k}", (x + cu * (r0 + r1) / 2, -3.075, NOZZLE_Z + su * (r0 + r1) / 2),
             ((cu, 0, su), (0, 1, 0), (-su, 0, cu)), ((r1 - r0) / 2, 0.035, 0.0055), "metal")
    # bolts round the collar
    for k in range(10):
        a = 2 * math.pi * (k + 0.5) / 10
        bx, bz = x + 0.276 * math.cos(a), NOZZLE_Z + 0.276 * math.sin(a)
        if bz < 0.25:
            lathe(f"bolt_{i}_{k}", [(0.0, -2.995), (0.012, -2.995), (0.012, -3.025), (0.0, -3.025)],
                  bx, bz, "dark", segs=6)

# bulkhead plates between/above/below the nozzles (visible from the chase cam)
for s in (-1, 1):
    box(f"bulk_plate_hi_{s}", (s * 0.291, -2.982, 0.205), (0.07, 0.03, 0.09), "metal", 0.004)
    box(f"bulk_plate_lo_{s}", (s * 0.291, -2.982, -0.30), (0.08, 0.03, 0.06), "dark", 0.004)
    box(f"bulk_side_{s}", (s * 0.90, -2.99, -0.06), (0.05, 0.04, 0.34), "metal", 0.006)

# twin canted tail fins rising from the engine block
FIN_CANT = math.radians(17)


def fin_xf(x0, z0, cant, s):
    def xf(u, v, w):
        return (x0 * s + v * math.sin(cant) * s + w * math.cos(cant) * s, u, z0 + v * math.cos(cant) - w * math.sin(cant))
    return xf


tail_poly = [(-1.62, 0.0), (-2.86, 0.0), (-3.04, 0.43), (-2.62, 0.43)]
for s in (-1, 1):
    slab(f"tailfin_{s}", tail_poly, "panel", lambda u, v: (0.0, 0.032 - 0.014 * v / 0.43),
         fin_xf(0.60, 0.235, FIN_CANT, s), inset=0.03, edge_frac=0.3, bevel=0.005, segs=1)

# ventral fin
vent_poly = [(-1.86, 0.0), (-2.86, 0.0), (-2.96, 0.26), (-2.55, 0.26)]
slab("ventral_fin", vent_poly, "hull_mid", lambda u, v: (0.0, 0.03 - 0.012 * v / 0.26),
     lambda u, v, w: (w, u, -0.32 - v), inset=0.025, edge_frac=0.3, bevel=0.005, segs=1)

# ---------------------------------------------------------------- dorsal spine ---
SPINE = [  # (y, (hb, ht, ztop))
    (-2.62, (0.18, 0.105, 0.372)),
    (-1.50, (0.20, 0.120, 0.392)),
    (-0.60, (0.19, 0.112, 0.398)),
    (0.40, (0.16, 0.090, 0.388)),
    (0.92, (0.10, 0.050, 0.358)),
]


def spine_ring(y):
    hb, ht, zt = lerp_keys(SPINE, y)
    zb, zm = zt - 0.17, zt - 0.045
    return [(-hb, y, zb), (hb, y, zb), (hb, y, zm), (ht, y, zt), (-ht, y, zt), (-hb, y, zm)]


spine_ys = [-2.62, -2.1, -1.5, -1.05, -0.6, -0.1, 0.4, 0.7, 0.92]
loft("spine", [spine_ring(y) for y in spine_ys], "hull_mid", bevel=0.012, segs=2)


def spine_strip_ring(y, s):
    hb, ht, zt = lerp_keys(SPINE, y)
    zm = zt - 0.045
    a, b = (ht, zt), (hb, zm)
    d = (b[0] - a[0], b[1] - a[1])
    L = math.hypot(*d)
    d = (d[0] / L, d[1] / L)
    n = (-d[1], d[0]) if -d[1] > 0 else (d[1], -d[0])
    if n[0] < 0:
        n = (-n[0], -n[1])
    mid = (a[0] + d[0] * L * 0.5, a[1] + d[1] * L * 0.5)
    hw, th = 0.010, 0.0045
    pts = []
    for (dd, nn) in ((-hw, -0.002), (hw, -0.002), (hw, th), (-hw, th)):
        px = mid[0] + d[0] * dd + n[0] * nn
        pz = mid[1] + d[1] * dd + n[1] * nn
        pts.append((px * s, y, pz))
    return pts


for s in (-1, 1):
    loft(f"spine_neon_{s}", [spine_strip_ring(y, s) for y in (-2.45, -2.1, -1.5, -1.05, -0.6, -0.1, 0.30)], "neon_c")

# spine vent grille (dark well + metal louvres)
for k, (y0, y1) in enumerate(((-0.95, -0.25), (-2.30, -1.70))):
    zt = lerp_keys(SPINE, (y0 + y1) / 2)[2]
    box(f"spine_vent_{k}", (0, (y0 + y1) / 2, zt + 0.004), (0.15, abs(y1 - y0), 0.014), "dark", 0.003)
    n = int(abs(y1 - y0) / 0.07)
    for j in range(n):
        yy = y0 + (j + 0.5) * (y1 - y0) / n
        box(f"spine_louvre_{k}_{j}", (0, yy, zt + 0.013), (0.13, 0.022, 0.014), "metal", 0.003)

# dorsal sensor mast + dome behind the canopy
lathe("sensor_dome", [(0.0, 0.62), (0.05, 0.62), (0.05, 0.50), (0.0, 0.50)], 0, 0.40, "metal", segs=16)
box("mast", (0.0, 0.18, 0.43), (0.018, 0.10, 0.07), "metal", 0.004)

# --------------------------------------------------------------- housing greebles ---
for s in (-1, 1):
    # top radiator grilles flanking the spine
    box(f"rad_well_{s}", (s * 0.40, -2.06, 0.305), (0.24, 0.80, 0.03), "dark", 0.004)
    for j in range(9):
        yy = -1.70 - j * 0.085
        box(f"rad_fin_{s}_{j}", (s * 0.40, yy, 0.322), (0.22, 0.03, 0.022), "metal", 0.003)
    # side conduits
    for k, zz in enumerate((0.035, 0.115)):
        lathe(f"pipe_{s}_{k}", [(0.0, -1.62), (0.024, -1.62), (0.024, -2.92), (0.0, -2.92)],
              s * 0.952, zz, "metal", segs=10)
    for j, yy in enumerate((-1.75, -2.25, -2.75)):
        box(f"pipe_clamp_{s}_{j}", (s * 0.945, yy, 0.075), (0.05, 0.035, 0.15), "dark", 0.004)
    # RCS quads at the rear corners
    box(f"rcs_{s}", (s * 0.86, -2.82, 0.335), (0.12, 0.16, 0.05), "metal", 0.006)
    for j, yy in enumerate((-2.77, -2.87)):
        lathe(f"rcs_n_{s}_{j}", [(0.0, yy - 0.018), (0.014, yy - 0.018), (0.014, yy + 0.018), (0.0, yy + 0.018)],
              s * 0.86, 0.365, "dark", segs=8)
    # raked intake scoops at the wing roots (front leans forward at the top)
    def scoop_ring(yt, yb, x0, x1, z0, z1, ch):
        def yz(z):
            return yb + (yt - yb) * (z - z0) / (z1 - z0)
        pts2 = [(x0, z1), (x1 - ch, z1), (x1, z1 - ch), (x1, z0 + ch), (x1 - ch, z0), (x0, z0)]
        return [(px * s, yz(pz), pz) for px, pz in pts2]
    rings = [scoop_ring(1.12, 0.94, 0.46, 0.715, -0.23, 0.03, 0.035),
             scoop_ring(0.80, 0.66, 0.46, 0.745, -0.24, 0.035, 0.04),
             scoop_ring(0.25, 0.20, 0.46, 0.715, -0.22, 0.01, 0.04),
             scoop_ring(-0.45, -0.45, 0.46, 0.56, -0.16, -0.05, 0.03)]
    loft(f"intake_{s}", rings, "hull_mid", bevel=0.008, segs=2)
    mouth = []
    for dy in (0.012, -0.06):
        r = scoop_ring(1.12 + dy, 0.94 + dy, 0.49, 0.69, -0.20, 0.0, 0.02)
        mouth.append(r)
    loft(f"intake_mouth_{s}", mouth, "dark", bevel=0.0)
    ry, rz = 0.18, 0.26
    rl = math.hypot(ry, rz)
    up, nrm = (0, ry / rl, rz / rl), (0, rz / rl, -ry / rl)
    for k, zz in enumerate((-0.135, -0.065)):
        yy = 0.94 + ry * (zz + 0.23) / rz
        obox(f"intake_splitter_{s}_{k}", (s * 0.60, yy + 0.010, zz), ((1, 0, 0), nrm, up), (0.11, 0.012, 0.006), "metal")

# fuselage flank armour plates (mirror-symmetric, seeded layout)
plate_specs = []
yy = 0.62
while yy > -1.25:
    L = random.uniform(0.26, 0.48)
    u0 = random.uniform(0.03, 0.08)
    u1 = random.uniform(0.22, 0.30)
    plate_specs.append((yy - L / 2, L, u0, u1))
    yy -= L + random.uniform(0.04, 0.09)
for s in (-1, 1):
    for k, (yc, L, u0, u1) in enumerate(plate_specs):
        def xf(u, v, w, s=s):
            p1, d, n, _ = flank_frame(v)
            return ((p1[0] + d[0] * u + n[0] * w) * s, v, p1[1] + d[1] * u + n[1] * w)
        poly = [(u0, yc + L / 2), (u1, yc + L / 2 - 0.03), (u1, yc - L / 2), (u0, yc - L / 2)]
        slab(f"flank_plate_{s}_{k}", poly, "panel", lambda u, v: (0.008, 0.016), xf,
             inset=0.012, edge_frac=0.2, bevel=0.0)

# knife-edge chine blades running from the nose back to the intakes
for s in (-1, 1):
    cys = [3.12, 2.85, 2.55, 2.20, 1.85, 1.50, 1.22]
    outer = []
    for y in cys:
        t = (3.12 - y) / (3.12 - 1.22)
        outer.append((fus_params(y)[0] + 0.012 + 0.085 * math.sin(t * math.pi * 0.5), y))
    inner = [(fus_params(y)[0] - 0.05, y) for y in reversed(cys)]
    slab(f"chine_{s}", outer + inner, "hull_mid", lambda u, v: (fus_params(v)[4], 0.016),
         lambda u, v, w, s=s: (u * s, v, w), inset=0.0, bevel=0.003, segs=1)

# nose sensor chin + canards
lathe("chin_sensor", [(0.0, 3.05), (0.03, 3.02), (0.045, 2.90), (0.045, 2.55), (0.0, 2.52)], 0, -0.20, "metal", segs=12)

# ---------------------------------------------------------------- wings ---
ROOT_X, TIP_X = 0.45, 2.56


def wing_zc(x):
    return -0.095 - (x - ROOT_X) * math.tan(math.radians(3.0))


def wing_half(x):
    return 0.5 * (0.15 - 0.10 * (x - ROOT_X) / (TIP_X - ROOT_X))


def wing_top(x):
    return wing_zc(x) + wing_half(x)


wing_poly = [(0.45, 0.80), (1.15, -0.30), (2.48, -1.50), (2.57, -1.92), (1.62, -2.08), (0.92, -2.36), (0.45, -2.25)]
plate_poly = [(0.66, 0.30), (1.22, -0.55), (2.24, -1.52), (2.28, -1.86), (1.55, -1.99), (0.92, -2.24)]


def flap_poly(P, Q, t0, t1, gap=0.018, depth=0.17):
    dx, dy = Q[0] - P[0], Q[1] - P[1]
    L = math.hypot(dx, dy)
    nx, ny = dy / L, -dx / L
    if ny > 0:
        nx, ny = -nx, -ny  # point aft
    a = (P[0] + dx * t0, P[1] + dy * t0)
    b = (P[0] + dx * t1, P[1] + dy * t1)
    return [(a[0] + nx * gap, a[1] + ny * gap), (b[0] + nx * gap, b[1] + ny * gap),
            (b[0] + nx * (gap + depth), b[1] + ny * (gap + depth)), (a[0] + nx * (gap + depth), a[1] + ny * (gap + depth))]
for s in (-1, 1):
    poly = [(x, y) for x, y in wing_poly]
    slab(f"wing_{s}", poly, "hull", lambda u, v: (wing_zc(u), wing_half(u)),
         lambda u, v, w, s=s: (u * s, v, w), inset=0.07, edge_frac=0.22, bevel=0.006, segs=2)
    # raised armour plate on the wing top
    slab(f"wing_plate_{s}", plate_poly, "panel", lambda u, v: (wing_top(u) + 0.008, 0.018),
         lambda u, v, w, s=s: (u * s, v, w), inset=0.022, edge_frac=0.25, bevel=0.0)
    # neon strip just ahead of the plate's outboard leading edge
    a, b = plate_poly[1], plate_poly[2]
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    fx, fy = -dy / L, dx / L  # unit perpendicular
    if fx + fy < 0:  # make it point forward/outboard (away from the plate)
        fx, fy = -fx, -fy
    t0, t1 = 0.10, 0.96  # trim along the edge
    p0 = (a[0] + dx * t0, a[1] + dy * t0)
    p1 = (a[0] + dx * t1, a[1] + dy * t1)
    o0, o1 = 0.028, 0.044
    strip = [(p0[0] + fx * o0, p0[1] + fy * o0), (p1[0] + fx * o0, p1[1] + fy * o0),
             (p1[0] + fx * o1, p1[1] + fy * o1), (p0[0] + fx * o1, p0[1] + fy * o1)]
    slab(f"wing_neon_{s}", strip, "neon_c", lambda u, v: (wing_top(u) + 0.002, 0.006),
         lambda u, v, w, s=s: (u * s, v, w))
    # split trailing-edge control surfaces (the chase cam looks straight at them)
    for k, (P, Q, t0, t1) in enumerate(((wing_poly[3], wing_poly[4], 0.05, 0.97), (wing_poly[4], wing_poly[5], 0.04, 0.92))):
        slab(f"flap_{s}_{k}", flap_poly(P, Q, t0, t1), "hull_mid", lambda u, v: (wing_zc(u) - 0.004, wing_half(u) * 0.62),
             lambda u, v, w, s=s: (u * s, v, w), inset=0.035, edge_frac=0.3, bevel=0.004, segs=1)
        a, b = flap_poly(P, Q, t0 + 0.03, t1 - 0.03, gap=0.004, depth=0.008)[:2]
        for j, t in enumerate((0.2, 0.5, 0.8)):
            hx, hy = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            box(f"hinge_{s}_{k}_{j}", (hx * s, hy - 0.012, wing_zc(hx) - 0.01), (0.05, 0.05, 0.035), "dark", 0.0)
    # wingtip rail pod + nav lens
    px, pz = 2.585, wing_zc(2.585)
    lathe(f"tip_pod_{s}", [(0.0, -0.93), (0.038, -0.93), (0.055, -1.02), (0.064, -1.16), (0.064, -2.18),
                           (0.056, -2.30), (0.036, -2.37), (0.0, -2.37)], px * s, pz, "hull_mid", segs=16, bevel=0.0)
    lathe(f"tip_band_{s}", [(0.060, -1.30), (0.069, -1.31), (0.069, -1.37), (0.060, -1.38)], px * s, pz, "metal",
          segs=16, closed=True)
    lathe(f"nav_{s}", [(0.0, -0.875), (0.020, -0.884), (0.032, -0.905), (0.036, -0.94), (0.0, -0.94)],
          px * s, pz, "neon_g" if s > 0 else "neon_p", segs=12)
    # canted wingtip fin
    tip_fin = [(-1.48, 0.0), (-2.30, 0.0), (-2.44, 0.30), (-2.08, 0.30)]
    slab(f"tip_fin_{s}", tip_fin, "panel", lambda u, v: (0.0, 0.022 - 0.008 * v / 0.30),
         fin_xf(px, pz, math.radians(22), s), inset=0.02, edge_frac=0.3, bevel=0.004, segs=1)
    # forward canards
    can_poly = [(0.30, 2.42), (0.86, 1.98), (0.90, 1.86), (0.30, 1.86)]
    slab(f"canard_{s}", can_poly, "hull_mid", lambda u, v: (-0.085 - (u - 0.3) * 0.05, 0.03 - 0.012 * (u - 0.3) / 0.6),
         lambda u, v, w, s=s: (u * s, v, w), inset=0.03, edge_frac=0.3, bevel=0.004, segs=1)

# --------------------------------------------------------- normals + bevels ---
def activate(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


for ob, cat, bw, segs in PARTS:
    activate(ob)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32), keep_sharp_edges=True)
    if bw > 0 and cat not in NON_BAKED:
        bev = ob.modifiers.new("bevel", "BEVEL")
        bev.width = bw
        bev.segments = segs
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(30)
        bev.harden_normals = True
        bev.miter_outer = "MITER_ARC"
        bev.use_clamp_overlap = True
        bpy.ops.object.modifier_apply(modifier=bev.name)

# ------------------------------------------------------------------ bake ---
baked_objs = [ob for ob, cat, _, _ in PARTS if cat not in NON_BAKED]
other_objs = [ob for ob, cat, _, _ in PARTS if cat in NON_BAKED]
bpy.ops.object.select_all(action="DESELECT")
for ob in baked_objs:
    ob.select_set(True)
bpy.context.view_layer.objects.active = baked_objs[0]
bpy.ops.object.join()
hull = bpy.context.object
hull.name = "Spaceship"

activate(hull)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=False)
bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")

world = bpy.data.worlds.new("bake_world")
SCENE.world = world
world.light_settings.distance = 0.55  # AO reach (ship units)
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


col_img = new_img("spaceship_color_raw")
ao_img = new_img("spaceship_ao_raw")
nrm_img = new_img("spaceship_normal", noncolor=True)
bake("DIFFUSE", col_img, 4, pass_filter={"COLOR"})
bake("AO", ao_img, 96)
bake("NORMAL", nrm_img, 8, normal_space="TANGENT")

npx = TEX * TEX * 4
c = np.empty(npx, dtype=np.float32)
a = np.empty(npx, dtype=np.float32)
col_img.pixels.foreach_get(c)
ao_img.pixels.foreach_get(a)
c = c.reshape(-1, 4)
a = a.reshape(-1, 4)
c[:, :3] *= 0.22 + 0.78 * a[:, :3]
c[:, 3] = 1.0
albedo = new_img("spaceship_albedo")
albedo.pixels.foreach_set(c.ravel())
albedo.pack()
nrm_img.pack()


def final_mat(name, metallic, roughness):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = albedo
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    bake_utils.attach_normal_map(m, nrm_img, strength=1.0)
    return m


HULL = final_mat("Hull", 0.55, 0.48)
ACCENT = final_mat("Accent_Metal", 0.9, 0.30)
me = hull.data
slot_is_metal = [mat.name == "BAKE_metal" for mat in me.materials]
mi = np.empty(len(me.polygons), dtype=np.int32)
me.polygons.foreach_get("material_index", mi)
new_mi = np.array([1 if slot_is_metal[i] else 0 for i in mi], dtype=np.int32)
me.materials.clear()
me.materials.append(HULL)
me.materials.append(ACCENT)
me.polygons.foreach_set("material_index", new_mi)
me.update()
for m in list(bpy.data.materials):
    if m.name.startswith("BAKE_"):
        bpy.data.materials.remove(m)
for img in (col_img, ao_img):
    bpy.data.images.remove(img)

# join glass + glow + neon into the same mesh (one node, one primitive per material)
bpy.ops.object.select_all(action="DESELECT")
for ob in other_objs:
    ob.select_set(True)
hull.select_set(True)
bpy.context.view_layer.objects.active = hull
bpy.ops.object.join()
bpy.context.object.data.name = "Spaceship"

# --------------------------------------------------------------- report + export ---
ship = bpy.context.object
deps = bpy.context.evaluated_depsgraph_get()
me = ship.evaluated_get(deps).data
me.calc_loop_triangles()
per = {}
for tri in me.loop_triangles:
    nm = me.materials[tri.material_index].name
    per[nm] = per.get(nm, 0) + 1
xs = [v.co for v in me.vertices]
print("TRIS", sum(per.values()), per)
print("BLENDER_BBOX x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % (
    min(v.x for v in xs), max(v.x for v in xs), min(v.y for v in xs), max(v.y for v in xs),
    min(v.z for v in xs), max(v.z for v in xs)))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
ship.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, use_selection=True,
                          export_yup=True)
print("wrote", OUT)
