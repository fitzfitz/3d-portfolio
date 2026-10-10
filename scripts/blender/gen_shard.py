# Data shard: a double-terminated hexagonal "data crystal" of dark glass,
# held in a machined gunmetal setting (two chamfered collars joined by three
# corner struts, with claw prongs gripping each tip). Circuit traces etched
# into the collars, data streams in the glass and a hot inner core line all
# glow cyan through the emissive map.
#   $BLENDER --background --python scripts/blender/gen_shard.py
#
# Original work: every vertex and every texel is generated procedurally below
# (seeded, deterministic). Replaces the code-drawn octahedron placeholder.
#
# Game contract (DataShards.tsx draws it as an InstancedMesh of 10):
#   - one node, one mesh, one primitive, one material named Data_Shard
#   - centred on the origin, longest radius ~1.0 (long axis = glTF +Y, which
#     is also the spin axis), 300-1500 triangles
#   - baseColor + RGB emissive map (cyan painted in), emissiveFactor [1,1,1]
#
# Texture trick (same as gen_crystal.py): the atlas is painted in numpy and
# many faces share one UV cell; each face is mapped onto its cell with
# per-face normalised (across, along) coordinates so painted rims, traces and
# core lines land exactly on the face's real edges.
import bpy
import bmesh
import math
import os
import random

import numpy as np
from mathutils import Vector

SEED = 20261011
TEX = 512
RADIUS = 1.0  # max |v| after normalising (glTF units)

# ---------------------------------------------------------------- dimensions
# Blender units before normalising; Z is the long axis (exports as glTF +Y).
R = 0.24            # crystal hex vertex radius
H = 0.56            # body shoulders at z = +-H
TOP_NECK = (0.58, 0.22)   # (radius scale, height above shoulder) of the tip neck
BOT_NECK = (0.58, 0.18)
Z_TOP, Z_BOT = 1.12, -1.00   # apexes
ZC = 0.38           # collar centres at +-ZC
CH = 0.070          # collar half height
CC = 0.020          # collar chamfer
RC = R * 1.40       # collar outer vertex radius
BULGE = 1.14        # mid-body girdle radius / R: a long, shallow double taper


def body_r(z):
    """Crystal vertex radius at height z on the body (|z| <= H)."""
    return R * (BULGE - (BULGE - 1) * abs(z) / H)


RI = body_r(ZC) * 0.95   # collar inner vertex radius (buried in the glass)
GROOVE = (0.014, 0.016)   # (half height, depth) of the glowing collar groove
HEX = [math.radians(30 + 60 * i) for i in range(6)]  # flat face toward +X

(K_BODY, K_NECK, K_APEX, K_BEVEL, K_COL_OUT, K_COL_GROOVE, K_COL_CHAMF,
 K_COL_CAP, K_STRUT_OUT, K_STRUT_SIDE) = range(1, 11)

# Atlas layout in pixels (x0, y0, w, h); y grows upward like UV v.
PAD = 3
BODY_CELLS = [(64 * k, 256, 64, 256) for k in range(6)]
NECK_CELL = (384, 384, 128, 128)
APEX_CELL = (384, 256, 128, 128)
COLLAR_CELLS = [(0, 192, 256, 64), (256, 192, 256, 64), (0, 128, 256, 64), (256, 128, 256, 64)]
GROOVE_CELL = (0, 96, 256, 32)
CHAMF_CELL = (256, 96, 128, 32)
CAP_CELL = (384, 64, 128, 64)
STRUT_OUT_CELL = (0, 0, 256, 32)
STRUT_SIDE_CELL = (0, 32, 256, 32)
BEVEL_CELL = (256, 0, 128, 64)

bpy.ops.wm.read_factory_settings(use_empty=True)
rng = random.Random(SEED)

bm = bmesh.new()
L_KIND = bm.faces.layers.int.new("kind")
L_VAR = bm.faces.layers.int.new("variant")
L_UV = bm.loops.layers.uv.new("UVMap")


def face(verts, kind, outward, variant=0):
    """New face whose normal points along `outward(centre)`."""
    f = bm.faces.new(verts)
    f.normal_update()
    if f.normal.dot(outward(f.calc_center_median())) < 0:
        f.normal_flip()
    f[L_KIND] = kind
    f[L_VAR] = variant
    f.smooth = False
    return f


def radial(c):
    v = Vector((c.x, c.y, 0))
    return v.normalized() if v.length > 1e-6 else Vector((0, 0, 1 if c.z >= 0 else -1))


def hex_ring(r, z, angs=HEX):
    return [bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for a in angs]


# ---------------------------------------------------------------- crystal
def from_axis(c):
    return c - Vector((0, 0, max(-H, min(H, c.z)) * 0.6))


crystal_faces = []
rb = hex_ring(R, -H)
rt = hex_ring(R, H)
rm = hex_ring(R * BULGE, 0)
nt = hex_ring(R * TOP_NECK[0], H + TOP_NECK[1])
nb = hex_ring(R * BOT_NECK[0], -H - BOT_NECK[1])
at = bm.verts.new((0, 0, Z_TOP))
ab = bm.verts.new((0, 0, Z_BOT))
body_vars = list(range(6))
rng.shuffle(body_vars)
for i in range(6):
    j = (i + 1) % 6
    crystal_faces.append(face([rm[i], rm[j], rt[j], rt[i]], K_BODY, from_axis, body_vars[i]))
    crystal_faces.append(face([rb[i], rb[j], rm[j], rm[i]], K_BODY, from_axis, body_vars[(i + 3) % 6]))
    crystal_faces.append(face([rt[i], rt[j], nt[j], nt[i]], K_NECK, from_axis))
    crystal_faces.append(face([rb[i], rb[j], nb[j], nb[i]], K_NECK, from_axis))
    crystal_faces.append(face([nt[i], nt[j], at], K_APEX, from_axis))
    crystal_faces.append(face([nb[i], nb[j], ab], K_APEX, from_axis))

edges = {e for f in crystal_faces for e in f.edges}
res = bmesh.ops.bevel(
    bm, geom=list(edges), offset=0.008, offset_type="OFFSET",
    profile_type="SUPERELLIPSE", segments=1, profile=0.5, affect="EDGES",
    clamp_overlap=True,
)
for f in res["faces"]:
    f[L_KIND] = K_BEVEL
    f[L_VAR] = 0
    f.smooth = False


# ---------------------------------------------------------------- collars
def collar(zc):
    g, gd = GROOVE
    # (radius, z, kind of the face from this ring to the next)
    prof = [
        (RI, CH, K_COL_CAP),
        (RC - CC, CH, K_COL_CHAMF),
        (RC, CH - CC, K_COL_OUT),
        (RC, g, K_COL_GROOVE),       # groove lip
        (RC - gd, g, K_COL_GROOVE),  # groove floor
        (RC - gd, -g, K_COL_GROOVE),
        (RC, -g, K_COL_OUT),
        (RC, -CH + CC, K_COL_CHAMF),
        (RC - CC, -CH, K_COL_CAP),
        (RI, -CH, None),
    ]
    rings = [hex_ring(r, zc + z) for r, z, _ in prof]
    var = rng.randrange(len(COLLAR_CELLS))
    centre = Vector((0, 0, zc))
    for k in range(len(prof) - 1):
        kind = prof[k][2]
        for i in range(6):
            j = (i + 1) % 6
            vs = [rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]]
            if kind == K_COL_CAP:
                out = (lambda c, s=(1 if k == 0 else -1): Vector((0, 0, s)))
            elif kind == K_COL_GROOVE and k != 4:
                # groove side walls face up/down (toward the lip opening)
                out = (lambda c, s=(-1 if k == 3 else 1): Vector((0, 0, s)))
            else:
                out = (lambda c: radial(c) + (c - centre) * 0.0)
            face(vs, kind, out, (var + i) % len(COLLAR_CELLS))


collar(ZC)
collar(-ZC)


# ---------------------------------------------------------------- struts / prongs
def tube(points, ang, half_w, half_d, kind_out=K_STRUT_OUT, kind_side=K_STRUT_SIDE):
    """Rectangular bar along `points`, its outer face looking along `ang`."""
    n = Vector((math.cos(ang), math.sin(ang), 0))
    rings = []
    for k, p in enumerate(points):
        a = points[max(k - 1, 0)]
        b = points[min(k + 1, len(points) - 1)]
        t = (b - a).normalized()
        out = (n - t * n.dot(t)).normalized()
        s = t.cross(out).normalized()
        rings.append([bm.verts.new(p + s * sx * half_w + out * dx * half_d)
                      for sx, dx in ((-1, 1), (1, 1), (1, -1), (-1, -1))])
    mid = sum(points, Vector()) / len(points)
    axis_out = (lambda c: (c - Vector((0, 0, c.z))) * 1.0 + (c - mid) * 0.15)
    for k in range(len(rings) - 1):
        r0, r1 = rings[k], rings[k + 1]
        face([r0[0], r0[1], r1[1], r1[0]], kind_out, axis_out)
        face([r0[1], r0[2], r1[2], r1[1]], kind_side, axis_out)
        face([r0[3], r0[0], r1[0], r1[3]], kind_side, axis_out)
        # inner face is buried in the glass: skipped
    end = rings[-1]
    face([end[0], end[1], end[2], end[3]], K_STRUT_SIDE,
         lambda c: (points[-1] - points[-2]))


def corner(ang, r, z):
    return Vector((r * math.cos(ang), r * math.sin(ang), z))


for k in range(3):
    ang = HEX[2 * k]  # every other hex corner
    # cage strut between the collars, riding the crystal's corner edge
    tube([corner(ang, body_r(ZC) + 0.010, -ZC), corner(ang, R * BULGE + 0.010, 0),
          corner(ang, body_r(ZC) + 0.010, ZC)], ang, 0.014, 0.024)
    # claw prongs on the alternate corners: out of each collar, up the corner
    # edge and bent over the shoulder onto the neck, like a gem setting
    ang2 = HEX[2 * k + 1]
    for sgn, neck in ((1, TOP_NECK), (-1, BOT_NECK)):
        z0 = sgn * (ZC + CH - 0.01)
        f = 0.45  # how far up the neck the claw reaches
        rn = R * (1 - f * (1 - neck[0]))
        pts = [corner(ang2, body_r(z0) + 0.008, z0), corner(ang2, R + 0.008, sgn * (H - 0.01)),
               corner(ang2, rn + 0.006, sgn * (H + neck[1] * f))]
        tube(pts, ang2, 0.012, 0.015, kind_out=K_COL_CHAMF)

bm.normal_update()

# ---------------------------------------------------------------- UVs
def cell_uv(cell, u, v):
    x0, y0, w, h = cell
    return ((x0 + PAD + u * (w - 2 * PAD)) / TEX, (y0 + PAD + v * (h - 2 * PAD)) / TEX)


def norm01(vals):
    lo, hi = min(vals), max(vals)
    span = (hi - lo) or 1.0
    return [(x - lo) / span for x in vals]


ZMIN = min(v.co.z for v in bm.verts)
ZMAX = max(v.co.z for v in bm.verts)

for f in bm.faces:
    kind, var = f[L_KIND], f[L_VAR]
    loops = list(f.loops)
    n = f.normal
    c = f.calc_center_median()
    # "along" axis: world Z projected into the face, or radial for flat faces
    if abs(n.z) < 0.92:
        up = Vector((0, 0, 1)) - n * n.z
    else:
        up = radial(c)
        up = up - n * n.dot(up)
    up.normalize()
    across = up.cross(n).normalized()
    us = norm01([(lp.vert.co - c).dot(across) for lp in loops])
    vs = norm01([(lp.vert.co - c).dot(up) for lp in loops])
    if kind == K_APEX and len(loops) == 3:
        hs = [lp.vert.co.z * (1 if c.z > 0 else -1) for lp in loops]
        top = max(range(3), key=lambda i: hs[i])
        rest = sorted((i for i in range(3) if i != top), key=lambda i: us[i])
        loops[top][L_UV].uv = cell_uv(APEX_CELL, 0.5, 1.0)
        loops[rest[0]][L_UV].uv = cell_uv(APEX_CELL, 0.0, 0.0)
        loops[rest[1]][L_UV].uv = cell_uv(APEX_CELL, 1.0, 0.0)
        continue
    if kind in (K_NECK, K_BODY) and c.z < 0:
        vs = [1 - v for v in vs]  # V runs girdle -> shoulder -> apex on both ends
    if kind == K_BEVEL:
        # shared glow strip: V = global height, so edges fade identically
        for lp, u in zip(loops, us):
            hz = (lp.vert.co.z - ZMIN) / (ZMAX - ZMIN)
            lp[L_UV].uv = cell_uv(BEVEL_CELL, 0.2 + 0.6 * u, hz)
        continue
    cell = {
        K_BODY: lambda: BODY_CELLS[var],
        K_NECK: lambda: NECK_CELL,
        K_COL_OUT: lambda: COLLAR_CELLS[var],
        K_COL_GROOVE: lambda: GROOVE_CELL,
        K_COL_CHAMF: lambda: CHAMF_CELL,
        K_COL_CAP: lambda: CAP_CELL,
        K_STRUT_OUT: lambda: STRUT_OUT_CELL,
        K_STRUT_SIDE: lambda: STRUT_SIDE_CELL,
    }[kind]()
    if kind == K_COL_CAP:
        # V: 0 at the inner (glass) edge, 1 at the outer rim
        vs = norm01([(lp.vert.co.xy.length) for lp in loops])
    if kind == K_COL_OUT:
        # upper and lower bands share the cell; map each to its half so the
        # trace lanes meet the groove from both sides
        vs = [0.5 + 0.5 * v if c.z - (ZC if c.z > 0 else -ZC) > 0 else 0.5 * v for v in vs]
    if kind in (K_STRUT_OUT, K_STRUT_SIDE):
        # long bars: the along-axis runs across the wide cell
        for lp, u, v in zip(loops, us, vs):
            lp[L_UV].uv = cell_uv(cell, v, u)
        continue
    for lp, u, v in zip(loops, us, vs):
        lp[L_UV].uv = cell_uv(cell, u, v)

# ---------------------------------------------------------------- normalise
xs = [v.co.x for v in bm.verts]
ys = [v.co.y for v in bm.verts]
zs = [v.co.z for v in bm.verts]
centre = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2))
for v in bm.verts:
    v.co -= centre
s = RADIUS / max(v.co.length for v in bm.verts)
for v in bm.verts:
    v.co *= s
tris = sum(len(f.verts) - 2 for f in bm.faces)
print(f"shard: scale={s:.3f} triangles={tris}")


# ---------------------------------------------------------------- textures
nrng = np.random.default_rng(SEED)
em = np.zeros((TEX, TEX, 3), np.float32)
col = np.zeros((TEX, TEX, 3), np.float32)

CYAN = np.array([0.0, 0.941, 1.0], np.float32)     # #00f0ff (sRGB)
HOT = np.array([0.72, 1.0, 1.0], np.float32)       # white-hot core
GLASS_LO = np.array([0.012, 0.022, 0.040], np.float32)
GLASS_HI = np.array([0.040, 0.070, 0.110], np.float32)
GUN = np.array([0.20, 0.215, 0.24], np.float32)
STEEL = np.array([0.58, 0.60, 0.64], np.float32)


def grid(cell):
    x0, y0, w, h = cell
    ys_, xs_ = np.mgrid[y0:y0 + h, x0:x0 + w].astype(np.float32)
    U = np.clip((xs_ + 0.5 - (x0 + PAD)) / (w - 2 * PAD), 0, 1)
    V = np.clip((ys_ + 0.5 - (y0 + PAD)) / (h - 2 * PAD), 0, 1)
    return U, V


def put(cell, e, c):
    x0, y0, w, h = cell
    em[y0:y0 + h, x0:x0 + w] = np.clip(e, 0, 1)
    col[y0:y0 + h, x0:x0 + w] = np.clip(c, 0, 1)


def tint(mask, rgb):
    return mask[..., None] * rgb[None, None]


def line(d, w):
    """Crisp anti-aliased line of half width w from a distance field."""
    return np.clip(1.0 - (d - w) / (w * 0.6 + 1e-4), 0, 1)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy + 1e-9), 0, 1)
    return np.hypot(px - ax - t * dx, py - ay - t * dy)


def dashes(V, n_seg, lo=0.04, hi=0.22, gap=(0.03, 0.10)):
    """Random on/off dash mask along V (a 'data stream')."""
    m = np.zeros_like(V)
    v = nrng.uniform(0, 0.08)
    while v < 1:
        ln = nrng.uniform(lo, hi)
        m = np.maximum(m, ((V >= v) & (V <= v + ln)).astype(np.float32) * nrng.uniform(0.55, 1.0))
        v += ln + nrng.uniform(*gap)
    return m


# Body facets: dark glass, a hot core line down the middle with a soft halo
# (light from the core under the glass), two dashed data streams, faint rims.
BODY_ASPECT = 0.46  # facet width / height
for cell in BODY_CELLS:
    U, V = grid(cell)
    P = (U - 0.5) * BODY_ASPECT
    glow = 0.7 + 0.6 * np.exp(-V / 0.35)  # the core burns brightest at the girdle
    halo = (np.exp(-(P / 0.075) ** 2) * 0.42 + np.exp(-(P / 0.20) ** 2) * 0.14) * glow
    core = line(np.abs(P), 0.0065) * (0.85 + 0.15 * np.sin(V * 40 + nrng.uniform(0, 6)))
    data = np.zeros_like(U)
    for side in (-1, 1):
        off = nrng.uniform(0.11, 0.14) * side
        data = np.maximum(data, line(np.abs(P - off), 0.0045) * dashes(V, 6) * 0.7)
    rim = np.exp(-(0.5 * BODY_ASPECT - np.abs(P)) / 0.010) * 0.22
    e = tint(halo + rim, CYAN) + tint(data * 0.65, CYAN) + tint(core, HOT)
    c = GLASS_LO + (GLASS_HI - GLASS_LO) * np.exp(-V / 0.4)[..., None]
    c = c + tint(np.exp(-(0.5 * BODY_ASPECT - np.abs(P)) / 0.016), np.array([0.05, 0.08, 0.10], np.float32))
    put(cell, e, c)

# Neck facets (trapezoids shoulder -> neck): core line continues, fading in.
U, V = grid(NECK_CELL)
P = U - 0.5
halo = np.exp(-(P / 0.12) ** 2) * (0.25 + 0.2 * V)
core = line(np.abs(P), 0.010) * (0.7 + 0.3 * V)
e = tint(halo, CYAN) + tint(core, HOT)
c = GLASS_HI[None, None] * (0.8 + 0.6 * V[..., None])
put(NECK_CELL, e, c)

# Apex tris (0,0)-(1,0)-(0.5,1): core line converges to a hot point.
U, V = grid(APEX_CELL)
P = U - 0.5
core = line(np.abs(P), 0.012 * (1 - V) + 0.002)
spark = np.exp(-((P / 0.15) ** 2 + ((1 - V) / 0.18) ** 2))
e = tint(np.exp(-(P / 0.12) ** 2) * 0.35, CYAN) + tint(core + spark * 0.9, HOT)
c = GLASS_HI[None, None] * (1.0 + 0.8 * V[..., None])
put(APEX_CELL, e, c)


# Collar bands: brushed gunmetal with etched circuit traces. Lanes always hit
# the face edges at the same heights so traces run on around the hexagon.
def brushed(U, V, base, amount=0.08):
    streak = np.zeros_like(U)
    for _ in range(5):
        streak += np.sin(V * nrng.uniform(40, 140) + nrng.uniform(0, 6.28))
    return base[None, None] * (1 + amount * streak[..., None] / 5)


COL_ASPECT = 4.0
LANES = [0.20, 0.38, 0.62, 0.80]  # V lanes; 0.5 is the groove
for cell in COLLAR_CELLS:
    U, V = grid(cell)
    P = U * COL_ASPECT
    d = np.full_like(U, 9.0)
    pads = np.zeros_like(U)
    for lane_set in ((0, 1), (2, 3)):
        v = LANES[lane_set[0]]
        p = 0.0
        pts = [(p, v)]
        while p < COL_ASPECT:
            p_next = min(COL_ASPECT, p + nrng.uniform(0.35, 0.9))
            pts.append((p_next, v))
            if p_next < COL_ASPECT - 0.4 and nrng.random() < 0.7:
                v2 = LANES[lane_set[1]] if v == LANES[lane_set[0]] else LANES[lane_set[0]]
                jog = abs(v2 - v) * 1.0
                pts.append((p_next + jog, v2))
                p_next += jog
                v = v2
            p = p_next
        for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
            d = np.minimum(d, seg_dist(P, V, ax, ay, bx, by))
        # vias: short stubs to the groove ending in a pad
        for _ in range(2):
            px = nrng.uniform(0.3, COL_ASPECT - 0.3)
            vy = LANES[lane_set[0]] if lane_set[0] == 0 else LANES[lane_set[1]]
            d = np.minimum(d, seg_dist(P, V, px, vy, px, 0.5 + (0.06 if vy > 0.5 else -0.06)))
            pr = np.hypot(P - px, (V - vy))
            pads = np.maximum(pads, line(np.abs(pr - 0.045), 0.012))
    trace = line(d, 0.022)
    etch = line(d, 0.040)
    e = tint(trace * 0.95 + pads * 0.9, CYAN)
    c = brushed(U, V, GUN) * (1 - 0.65 * etch[..., None])
    edge = np.exp(-np.minimum(V, 1 - V) / 0.04)
    c = c + tint(edge * 0.25, STEEL)
    put(cell, e, c)

# Groove: a continuous hot seam.
U, V = grid(GROOVE_CELL)
put(GROOVE_CELL, tint(np.full_like(U, 0.9), CYAN) + tint(np.full_like(U, 0.25), HOT),
    np.repeat(np.full_like(U, 0.2)[..., None], 3, axis=2))

# Chamfers: bright machined steel catching the key light.
U, V = grid(CHAMF_CELL)
put(CHAMF_CELL, np.zeros((*U.shape, 3), np.float32), brushed(U, V, STEEL, 0.05))

# Caps (annulus top/bottom): gunmetal; light leaks where they meet the glass.
U, V = grid(CAP_CELL)
leak = np.exp(-np.clip(V - 0.15, 0, None) / 0.10)  # inner ~15% is under the glass
ticks = (np.sin(U * math.pi * 7) > 0.75).astype(np.float32) * line(np.abs(V - 0.66), 0.07)
ring = (0.9 + 0.1 * np.sin(V * 25))[..., None]
put(CAP_CELL, tint(leak * 0.75 + ticks * 0.55, CYAN),
    GUN[None, None] * 0.8 * ring + tint(np.exp(-(1 - V) / 0.06) * 0.25, STEEL))

# Strut outer faces: gunmetal with a dashed data line down the middle.
U, V = grid(STRUT_OUT_CELL)
stream = line(np.abs(V - 0.5), 0.10) * dashes(U, 8, 0.03, 0.12, (0.02, 0.06))
c = brushed(V, U, GUN) + tint(np.exp(-np.minimum(V, 1 - V) / 0.08) * 0.3, STEEL)
put(STRUT_OUT_CELL, tint(stream * 0.85, CYAN), c)
U, V = grid(STRUT_SIDE_CELL)
put(STRUT_SIDE_CELL, np.zeros((*U.shape, 3), np.float32), brushed(V, U, GUN * 0.85))

# Crystal bevels: bright glass edges glowing softly, hotter toward the tips.
U, V = grid(BEVEL_CELL)
tips = np.maximum(np.exp(-(1 - V) / 0.07), np.exp(-V / 0.06))
e = tint(0.05 + 0.30 * tips, CYAN)
put(BEVEL_CELL, e, np.repeat((0.34 + 0.2 * tips)[..., None], 3, axis=2) * np.array([0.85, 0.92, 1.0], np.float32))


def to_image(name, rgb):
    img = bpy.data.images.new(name, width=TEX, height=TEX, alpha=False)
    rgba = np.ones((TEX, TEX, 4), np.float32)
    rgba[..., :3] = rgb
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


img_col = to_image("data_shard_color", col)
img_em = to_image("data_shard_emissive", em)

# ---------------------------------------------------------------- material
mat = bpy.data.materials.new("Data_Shard")
mat.use_nodes = True
ntree = mat.node_tree
bsdf = ntree.nodes["Principled BSDF"]
bsdf.inputs["Metallic"].default_value = 0.55
bsdf.inputs["Roughness"].default_value = 0.24
tc = ntree.nodes.new("ShaderNodeTexImage")
tc.image = img_col
ntree.links.new(tc.outputs["Color"], bsdf.inputs["Base Color"])
te = ntree.nodes.new("ShaderNodeTexImage")
te.image = img_em
ntree.links.new(te.outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 1.0

# ---------------------------------------------------------------- object
for layer in (L_KIND, L_VAR):
    bm.faces.layers.int.remove(layer)
me = bpy.data.meshes.new("Data_Shard")
bm.to_mesh(me)
bm.free()
me.materials.append(mat)
obj = bpy.data.objects.new("Data_Shard", me)
bpy.context.scene.collection.objects.link(obj)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "data_shard.glb"))
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
print("wrote", out)
