# Generates the contact-portal stargate. Original work: every vertex comes from
# the procedural code below (no imported meshes, no image textures). Run headless:
#   $BLENDER --background --python scripts/blender/gen_portal.py
#   $BLENDER --background --python scripts/blender/gen_portal.py -- --previews DIR [--tag NAME]
# Output: assets-src/portal_gateway.glb (raw; optimized by npm run assets:optimize)
#
# Contract with SpacePlanets.tsx:
#   * +Y up, gate in the XY plane facing +/-Z, centred on the origin.
#   * Node "PortalMembrane": flat disc, radius 3.2, z = 0, planar UVs 0..1
#     (centre 0.5,0.5). The game swaps its material for the swirl shader.
#   * Frame: inner radius 3.32, outer ring ~6.7 (three strut tips 8.28), depth +/-1.17.
#
# Modelling frame: the gate is built with its axis on Blender +Z (ring in XY),
# which is exactly the glTF frame we want. Just before export the mesh data is
# rotated +90 deg about X, so the exporter's Z-up -> Y-up swap lands it back in
# glTF XY facing +/-Z.
import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

bpy.ops.wm.read_factory_settings(use_empty=True)
random.seed(4242)

TAU = 2.0 * math.pi
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def _arg(flag, default=None):
    return ARGV[ARGV.index(flag) + 1] if flag in ARGV else default


PREVIEW_DIR = _arg("--previews")
TAG = _arg("--tag", "preview")

# --------------------------------------------------------------------------
# Materials (site palette on near-black)
# --------------------------------------------------------------------------


def srgb(hexstr):
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def make_material(name, color, metallic=0.8, roughness=0.4, emission=None, strength=0.0):
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


PINK = srgb("#ec4899")
CYAN = srgb("#00f0ff")

HULL = make_material("Hull_Gunmetal", (0.070, 0.074, 0.088), metallic=0.75, roughness=0.44)
PLATING = make_material("Hull_Plating", (0.125, 0.130, 0.150), metallic=0.8, roughness=0.36)
STEEL = make_material("Frame_Steel", (0.30, 0.31, 0.35), metallic=1.0, roughness=0.30)
DARK = make_material("Hull_Recess", (0.012, 0.012, 0.018), metallic=0.5, roughness=0.65)
CONDUIT = make_material("Conduit", (0.11, 0.10, 0.13), metallic=0.7, roughness=0.32)
NEON_PINK = make_material("Neon_Pink", tuple(c * 0.25 for c in PINK), metallic=0.0, roughness=0.4,
                          emission=PINK, strength=2.2)
NEON_CYAN = make_material("Neon_Cyan", tuple(c * 0.25 for c in CYAN), metallic=0.0, roughness=0.4,
                          emission=CYAN, strength=1.6)
MEMBRANE = make_material("Portal_Membrane", (0.0, 0.0, 0.0), metallic=0.0, roughness=1.0,
                         emission=(0.30, 0.02, 0.36), strength=0.25)

parts = []          # (object, bevel_width, bevel_segments)


def link(bm, name, mat, bevel=0.0, segs=1):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    parts.append((ob, bevel, segs))
    return ob


# --------------------------------------------------------------------------
# Geometry primitives (all bmesh, all deterministic)
# --------------------------------------------------------------------------


def mirror_profile(upper):
    """upper: (r, z>0) points from the inner side over the top to the outer
    side. Returns the closed cross-section loop, symmetric in z."""
    return list(upper) + [(r, -z) for (r, z) in reversed(upper)]


def revolve(bm, loop, segs, a0=0.0, a1=TAU, cap=False):
    full = abs((a1 - a0) - TAU) < 1e-9
    n = segs if full else segs + 1
    rings = []
    for i in range(n):
        a = a0 + (a1 - a0) * i / segs
        c, s = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((r * c, r * s, z)) for (r, z) in loop])
    P = len(loop)
    for i in range(segs):
        A, B = rings[i], rings[(i + 1) % n]
        for j in range(P):
            k = (j + 1) % P
            bm.faces.new((A[j], A[k], B[k], B[j]))
    if cap and not full:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    return rings


def polar(t, r, theta):
    """Local chevron coords (t = tangential, r = radial) -> XY at angle theta."""
    c, s = math.cos(theta), math.sin(theta)
    return (r * c - t * s, r * s + t * c)


def prism(bm, poly, z0, z1, theta):
    """Extrude a 2D (t, r) polygon between z0 and z1, rotated to angle theta."""
    bot = [bm.verts.new((*polar(t, r, theta), z0)) for (t, r) in poly]
    top = [bm.verts.new((*polar(t, r, theta), z1)) for (t, r) in poly]
    fb = bm.faces.new(bot[::-1])
    ft = bm.faces.new(top)
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    return fb, ft


def offset_poly(poly, d):
    """Inset a simple CCW (t, r) polygon by d using mitred vertex offsets."""
    n = len(poly)
    out = []
    for i in range(n):
        p0, p1, p2 = Vector(poly[i - 1]), Vector(poly[i]), Vector(poly[(i + 1) % n])
        e1, e2 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n1, n2 = Vector((-e1.y, e1.x)), Vector((-e2.y, e2.x))
        m = (n1 + n2).normalized()
        out.append(tuple(p1 + m * (d / max(0.2, m.dot(n1)))))
    return out


def ring_prism(bm, outer, inner, z0, z1, theta):
    """Closed bezel: the band between outer and inner (same vertex count)."""
    lv = {}
    for key, poly in (("o", outer), ("i", inner)):
        for zk, z in (("b", z0), ("t", z1)):
            lv[key + zk] = [bm.verts.new((*polar(t, r, theta), z)) for (t, r) in poly]
    n = len(outer)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lv["ot"][i], lv["ot"][j], lv["it"][j], lv["it"][i]))
        bm.faces.new((lv["ob"][j], lv["ob"][i], lv["ib"][i], lv["ib"][j]))
        bm.faces.new((lv["ob"][i], lv["ob"][j], lv["ot"][j], lv["ot"][i]))
        bm.faces.new((lv["ib"][j], lv["ib"][i], lv["it"][i], lv["it"][j]))


def rect(t0, t1, r0, r1):
    return [(t0, r0), (t1, r0), (t1, r1), (t0, r1)]


def box(bm, t0, t1, r0, r1, z0, z1, theta):
    prism(bm, rect(t0, t1, r0, r1), z0, z1, theta)


def loft_box(bm, theta, r0, r1, hw0, hz0, hw1, hz1):
    """Tapered radial strut: half-widths (tangential, z) at r0 and at r1."""
    vs = []
    for r, hw, hz in ((r0, hw0, hz0), (r1, hw1, hz1)):
        for t, z in ((-hw, -hz), (hw, -hz), (hw, hz), (-hw, hz)):
            vs.append(bm.verts.new((*polar(t, r, theta), z)))
    a, b = vs[:4], vs[4:]
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((a[i], a[j], b[j], b[i]))


def cylinder_z(bm, x, y, rad, z0, z1, sides=6, rot=0.0, cap0=True):
    bot, top = [], []
    for i in range(sides):
        a = rot + TAU * i / sides
        p = (x + rad * math.cos(a), y + rad * math.sin(a))
        bot.append(bm.verts.new((*p, z0)))
        top.append(bm.verts.new((*p, z1)))
    if cap0:
        bm.faces.new(bot[::-1])
    bm.faces.new(top)
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((bot[i], bot[j], top[j], top[i]))


def stroke(points, width):
    """Closed outline of a polyline stroke with mitred joints (t, r) space."""
    hw = width / 2.0
    left, right = [], []
    n = len(points)
    for i, p in enumerate(points):
        p = Vector(p)
        dirs = []
        if i > 0:
            dirs.append((p - Vector(points[i - 1])).normalized())
        if i < n - 1:
            dirs.append((Vector(points[i + 1]) - p).normalized())
        d = (dirs[0] + dirs[-1]).normalized()
        nrm = Vector((-d.y, d.x))
        miter = hw / max(0.25, nrm.dot(Vector((-dirs[0].y, dirs[0].x))))
        left.append(tuple(p + nrm * miter))
        right.append(tuple(p - nrm * miter))
    return left + right[::-1]


def both_faces(fn):
    """Run fn(sign) for the front (+Z) and back (-Z) faces."""
    for sgn in (1.0, -1.0):
        fn(sgn)


def zr(sgn, z0, z1):
    """Map a +Z-face z-range to the requested face."""
    return (z0, z1) if sgn > 0 else (-z1, -z0)


# --------------------------------------------------------------------------
# Layout
# --------------------------------------------------------------------------
N_CHEV = 9                                   # chevron clamps
CHEV = [TAU * k / N_CHEV for k in range(N_CHEV)]
BAY = [a + TAU / (2 * N_CHEV) for a in CHEV]  # bay centres (lit seams + fins)
PYLONS = {0, 3, 6}                            # chevrons carrying a long strut
SEG = 84

R_THROAT = 3.32
PLATE_R0, PLATE_R1, PLATE_Z = 4.00, 5.46, 0.78
RECESS = 0.035

# ---- inner throat / rail (steel) with a lit groove on each face ----------
bm = bmesh.new()
revolve(bm, mirror_profile([
    (3.40, 0.10), (R_THROAT, 0.13), (R_THROAT, 0.30), (R_THROAT + 0.06, 0.46), (3.46, 0.55), (3.475, 0.47),
    (3.625, 0.47), (3.64, 0.62), (3.72, 0.70), (4.06, 0.70),
]), SEG)
link(bm, "throat", STEEL)

bm = bmesh.new()
for sgn in (1.0, -1.0):
    z0, z1 = zr(sgn, 0.43, 0.515)
    revolve(bm, [(3.505, z0), (3.595, z0), (3.595, z1), (3.505, z1)], SEG)
revolve(bm, [(3.36, -0.065), (3.42, -0.065), (3.42, 0.065), (3.36, 0.065)], SEG)   # inner emitter
link(bm, "throat_light", NEON_PINK)

# Inner-rail teeth: a geared ring on the throat lip
bm = bmesh.new()
for i in range(36):
    th = TAU * (i + 0.5) / 36
    for sgn in (1.0, -1.0):
        box(bm, -0.085, 0.085, 3.76, 3.98, *zr(sgn, 0.64, 0.79), th)
link(bm, "rail_teeth", STEEL)

# ---- recessed core (seen through the plate seams) -------------------------
bm = bmesh.new()
revolve(bm, [(3.95, -0.56), (5.62, -0.56), (5.62, 0.56), (3.95, 0.56)], 72)
link(bm, "core", DARK)

# ---- hull plates: 18 sectors with an inset panel recess on both faces ----
GAP = math.radians(1.4)
for k in range(2 * N_CHEV):
    a0 = TAU * k / (2 * N_CHEV) + GAP / 2
    a1 = TAU * (k + 1) / (2 * N_CHEV) - GAP / 2
    bm = bmesh.new()
    revolve(bm, [(PLATE_R0, -PLATE_Z), (PLATE_R1, -PLATE_Z), (PLATE_R1, PLATE_Z), (PLATE_R0, PLATE_Z)],
            6, a0, a1, cap=True)
    bm.normal_update()
    for sgn in (1.0, -1.0):
        faces = [f for f in bm.faces if all(abs(v.co.z - sgn * PLATE_Z) < 1e-6 for v in f.verts)]
        bmesh.ops.inset_region(bm, faces=faces, thickness=0.075, depth=-RECESS, use_even_offset=True)
    link(bm, f"plate_{k:02d}", HULL, bevel=0.018)

# ---- outer rim band: chamfered, front-face panel channel, lit outer groove
bm = bmesh.new()
revolve(bm, mirror_profile([
    (5.40, 0.66), (5.40, 0.94), (5.47, 1.00), (5.62, 1.00), (5.635, 0.95), (5.715, 0.95),
    (5.73, 1.00), (6.08, 1.00), (6.22, 0.86), (6.22, 0.17), (6.15, 0.17),
]), SEG)
link(bm, "outer_rim", HULL)

bm = bmesh.new()
revolve(bm, [(6.11, -0.075), (6.185, -0.075), (6.185, 0.075), (6.11, 0.075)], SEG)
link(bm, "rim_light", NEON_CYAN)

# ---- conduits: twin pipe runs on each face, clamped every bay ------------
bm = bmesh.new()
for rc in (5.13, 5.25):
    for sgn in (1.0, -1.0):
        zc = sgn * 0.805
        circ = [(rc + 0.042 * math.cos(TAU * i / 6), zc + 0.042 * math.sin(TAU * i / 6)) for i in range(6)]
        revolve(bm, circ, 48)
link(bm, "conduits", CONDUIT)

bm = bmesh.new()
for b in BAY:
    for off in (-0.13, 0.13):
        for sgn in (1.0, -1.0):
            box(bm, -0.055, 0.055, 5.04, 5.34, *zr(sgn, 0.76, 0.875), b + off)
link(bm, "conduit_clamps", STEEL)

# ---- chevron clamps ------------------------------------------------------
SLOPE = 1.318
V_TIP, V_NOTCH, V_TOP, V_HALF = 4.50, 5.42, 6.42, 1.10
chev_poly = [
    (0.0, V_TIP), (V_HALF, V_TIP + V_HALF * SLOPE), (V_HALF, V_TOP),
    ((V_TOP - V_NOTCH) / SLOPE, V_TOP), (0.0, V_NOTCH),
    (-(V_TOP - V_NOTCH) / SLOPE, V_TOP), (-V_HALF, V_TOP), (-V_HALF, V_TIP + V_HALF * SLOPE),
]
cl_r = 6.06
cl_t = (cl_r - 4.96) / SLOPE
v_line = [(-cl_t, cl_r), (0.0, 4.96), (cl_t, cl_r)]

chev_inner = offset_poly(chev_poly, 0.07)
bm_blk, bm_house, bm_neon, bm_bridge, bm_lens, bm_bezel = (bmesh.new() for _ in range(6))
for k, th in enumerate(CHEV):
    for sgn in (1.0, -1.0):
        prism(bm_blk, chev_poly, *zr(sgn, 0.62, 1.08), th)
        # raised steel bezel around the clamp face; the lit V sits inside it
        ring_prism(bm_bezel, chev_poly, chev_inner, *zr(sgn, 1.04, 1.14), th)
        prism(bm_house, stroke(v_line, 0.22), *zr(sgn, 1.06, 1.12), th)
        prism(bm_neon, stroke(v_line, 0.10), *zr(sgn, 1.09, 1.155), th)
        # locking pins on the outer arm ends
        for t in (-0.93, 0.93):
            x, y = polar(t, 6.29, th)
            cylinder_z(bm_house, x, y, 0.065, *zr(sgn, 1.05, 1.17), sides=8, cap0=False)
    # bridge over the outer rim joining the front and back clamps
    box(bm_bridge, -0.80, 0.80, 6.10, 6.62, -1.10, 1.10, th)
    if k not in PYLONS:
        box(bm_house, -0.36, 0.36, 6.56, 6.645, -0.64, 0.64, th)
        box(bm_lens, -0.26, 0.26, 6.61, 6.675, -0.52, 0.52, th)
link(bm_blk, "chevrons", HULL, bevel=0.022, segs=2)
link(bm_bezel, "chevron_bezels", STEEL)
link(bm_house, "chevron_housing", DARK, bevel=0.0)
link(bm_neon, "chevron_lights", NEON_PINK)
link(bm_bridge, "chevron_bridges", STEEL, bevel=0.03, segs=2)

# ---- lit segment seams (odd seams, between chevrons) ---------------------
bm = bmesh.new()
for b in BAY:
    box(bm, -0.03, 0.03, 4.10, 5.34, -0.70, 0.70, b)
link(bm, "seam_lights", NEON_PINK)

# ---- radiator fin banks on the outer rim, one per bay --------------------
bm_fin, bm_mount = bmesh.new(), bmesh.new()
for b in BAY:
    for i in range(-2, 3):
        h = 0.50 - 0.09 * abs(i) - 0.02 * i * i
        hz = 0.48 - 0.06 * abs(i)
        box(bm_fin, -0.045, 0.045, 6.18, 6.24 + h, -hz, hz, b + math.radians(2.6 * i))
    revolve(bm_mount, [(6.18, -0.56), (6.30, -0.56), (6.30, 0.56), (6.18, 0.56)], 6,
            b - math.radians(7.4), b + math.radians(7.4), cap=True)
link(bm_fin, "radiator_fins", STEEL)
link(bm_mount, "radiator_mounts", HULL, bevel=0.015)

# ---- three long struts with beacon tips ----------------------------------
bm_p, bm_ant, bm_tip = bmesh.new(), bmesh.new(), bmesh.new()
for k in sorted(PYLONS):
    th = CHEV[k]
    loft_box(bm_p, th, 6.58, 7.80, 0.50, 0.50, 0.16, 0.17)
    loft_box(bm_p, th, 6.58, 7.20, 0.66, 0.20, 0.52, 0.18)   # stabiliser blade
    # antenna mast along the radial direction
    ring0, ring1 = [], []
    for i in range(6):
        a = TAU * i / 6
        t, z = 0.035 * math.cos(a), 0.035 * math.sin(a)
        ring0.append(bm_ant.verts.new((*polar(t, 7.74, th), z)))
        ring1.append(bm_ant.verts.new((*polar(t, 8.12, th), z)))
    bm_ant.faces.new(ring0[::-1])
    bm_ant.faces.new(ring1)
    for i in range(6):
        j = (i + 1) % 6
        bm_ant.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
    # beacon: small octahedron
    cx, cy = polar(0, 8.20, th)
    rr = 0.075
    pts = [(cx + rr, cy, 0), (cx - rr, cy, 0), (cx, cy + rr, 0), (cx, cy - rr, 0), (cx, cy, rr), (cx, cy, -rr)]
    v = [bm_tip.verts.new(p) for p in pts]
    for a, b_, c in ((0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)):
        bm_tip.faces.new((v[a], v[b_], v[c]))
    # pink light band around the strut root
    box(bm_lens, -0.40, 0.40, 7.02, 7.08, -0.41, 0.41, th)
    box(bm_lens, -0.32, 0.32, 7.30, 7.35, -0.33, 0.33, th)
link(bm_p, "pylons", STEEL, bevel=0.025)
link(bm_ant, "antennas", STEEL)
link(bm_tip, "beacons", NEON_CYAN)
link(bm_lens, "chevron_lenses", NEON_PINK)

# ---- plate greebles: bolts, vents, sub-panels, canisters ------------------
bm_bolt, bm_gr, bm_grs, bm_led = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
step = TAU / (2 * N_CHEV)
TILE_R0, TILE_R1, TILE_Z = 4.16, 4.96, PLATE_Z + 0.045
bm_tile = bmesh.new()
for k in range(2 * N_CHEV):
    a0 = step * k
    chev_at_start = (k % 2 == 0)        # even seams carry a chevron
    t0, t1 = a0 + GAP / 2 + math.radians(1.4), a0 + step - GAP / 2 - math.radians(1.4)
    for sgn in (1.0, -1.0):
        # raised armour tile in the plate recess (two-tone layering)
        z0, z1 = zr(sgn, PLATE_Z - RECESS - 0.01, TILE_Z)
        revolve(bm_tile, [(TILE_R0, z0), (TILE_R1, z0), (TILE_R1, z1), (TILE_R0, z1)], 3, t0, t1, cap=True)
        # rivets on the tile corners
        zb0, zb1 = zr(sgn, TILE_Z - 0.01, TILE_Z + 0.022)
        for th in (t0 + math.radians(1.0), t1 - math.radians(1.0)):
            for rb in (TILE_R0 + 0.08, TILE_R1 - 0.08):
                x, y = polar(0, rb, th)
                cylinder_z(bm_bolt, x, y, 0.026, zb0, zb1, sides=5, rot=th, cap0=False)
        # greeble cluster on the tile, biased away from the chevron V
        lo, hi = (0.40, 0.78) if chev_at_start else (0.22, 0.60)
        th = a0 + step * random.uniform(lo, hi)
        rc = random.uniform(4.42, 4.70)
        zfloor = TILE_Z
        kind = random.choice(("vent", "panel", "can", "vent", "panel"))
        if kind == "vent":
            for v in range(4):
                t = -0.15 + 0.1 * v
                box(bm_gr, t - 0.03, t + 0.03, rc - 0.20, rc + 0.20, *zr(sgn, zfloor - 0.01, zfloor + 0.045), th)
            box(bm_grs, -0.2, 0.2, rc - 0.25, rc - 0.21, *zr(sgn, zfloor - 0.01, zfloor + 0.03), th)
        elif kind == "panel":
            box(bm_grs, -0.24, 0.24, rc - 0.17, rc + 0.17, *zr(sgn, zfloor - 0.01, zfloor + 0.05), th)
            box(bm_gr, -0.17, 0.05, rc - 0.10, rc + 0.10, *zr(sgn, zfloor + 0.04, zfloor + 0.075), th)
            if random.random() < 0.55:
                box(bm_led, 0.10, 0.17, rc + 0.02, rc + 0.10, *zr(sgn, zfloor + 0.04, zfloor + 0.07), th)
        else:
            x, y = polar(0, rc, th)
            cylinder_z(bm_gr, x, y, 0.12, *zr(sgn, zfloor - 0.01, zfloor + 0.09), sides=10, cap0=False)
            cylinder_z(bm_grs, x, y, 0.07, *zr(sgn, zfloor + 0.08, zfloor + 0.12), sides=8, cap0=False)
link(bm_tile, "armour_tiles", PLATING, bevel=0.016)
link(bm_bolt, "bolts", STEEL)
link(bm_gr, "greebles_steel", STEEL)
link(bm_grs, "greebles_hull", HULL)
link(bm_led, "status_leds", NEON_CYAN)

# --------------------------------------------------------------------------
# Bevel matte parts (applied per part before the join drops modifiers)
# --------------------------------------------------------------------------
for ob, width, segs in parts:
    if width <= 0:
        continue
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bev = ob.modifiers.new("bevel", "BEVEL")
    bev.width = width
    bev.segments = segs
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(40)
    bpy.ops.object.modifier_apply(modifier=bev.name)

_budget = {}   # per-part triangle report (budget 15k-35k)
for ob, _, _ in parts:
    key = ob.name.split("_0")[0].split("_1")[0]
    _budget[key] = _budget.get(key, 0) + sum(len(p.vertices) - 2 for p in ob.data.polygons)
for key, n in sorted(_budget.items(), key=lambda kv: -kv[1]):
    print(f"[gen_portal]   {key:<18} {n:>6} tris")

bpy.ops.object.select_all(action="DESELECT")
for ob, _, _ in parts:
    ob.select_set(True)
bpy.context.view_layer.objects.active = parts[0][0]
bpy.ops.object.join()
frame = bpy.context.object
frame.name = "GateFrame"
frame.data.name = "GateFrame"
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32))
# weld coincident verts inside each part so smoothing is continuous
bm = bmesh.new()
bm.from_mesh(frame.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
bm.to_mesh(frame.data)
bm.free()
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32))


# --------------------------------------------------------------------------
# Ambient-occlusion bake -> glTF occlusionTexture on every matte material.
# Contact shadows under the chevrons, tiles, conduits and fins are what make
# the dark plating read as layered hardware instead of a flat disc.
# --------------------------------------------------------------------------
def is_emissive(mat):
    return mat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value > 0


def bake_ao(ob, size=1024, samples=96, distance=1.1):
    scene = bpy.context.scene
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, margin_method="FRACTION")
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new("portal_ao", width=size, height=size, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    targets = []
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = img
        nt.nodes.active = node
        targets.append((nt, node))
    if scene.world is None:
        scene.world = bpy.data.worlds.new("BakeWorld")
    scene.world.light_settings.distance = distance
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.render.bake.margin = 6
    bpy.ops.object.bake(type="AO", use_clear=True)
    for nt, node in targets:
        nt.nodes.remove(node)
    img.pack()
    return img


def gltf_output_group():
    g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g.nodes.new("NodeGroupOutput")
    g.nodes.new("NodeGroupInput")
    return g


AO_IMG = bake_ao(frame)
GLTF_OUT = gltf_output_group()
AO_PREVIEW = []          # (node_tree, mix node) multiplied into base colour for previews only
for slot in frame.material_slots:
    mat = slot.material
    if is_emissive(mat):
        continue
    nt = mat.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = AO_IMG
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
    grp = nt.nodes.new("ShaderNodeGroup")
    grp.node_tree = GLTF_OUT
    nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    AO_PREVIEW.append((nt, tex))

# --------------------------------------------------------------------------
# Membrane: flat disc r=3.2, planar UVs 0..1
# --------------------------------------------------------------------------
R_MEM = 3.2
bm = bmesh.new()
uv = bm.loops.layers.uv.new("UVMap")
centre = bm.verts.new((0, 0, 0))
MEM_SEG, MEM_RINGS = 64, 4
rings = []
for j in range(1, MEM_RINGS + 1):
    r = R_MEM * j / MEM_RINGS
    rings.append([bm.verts.new((r * math.cos(TAU * i / MEM_SEG), r * math.sin(TAU * i / MEM_SEG), 0))
                  for i in range(MEM_SEG)])
for i in range(MEM_SEG):
    k = (i + 1) % MEM_SEG
    bm.faces.new((centre, rings[0][i], rings[0][k]))
    for j in range(MEM_RINGS - 1):
        bm.faces.new((rings[j][i], rings[j + 1][i], rings[j + 1][k], rings[j][k]))
for f in bm.faces:
    for loop in f.loops:
        co = loop.vert.co
        loop[uv].uv = (0.5 + co.x / (2 * R_MEM), 0.5 + co.y / (2 * R_MEM))
me = bpy.data.meshes.new("PortalMembrane")
bm.to_mesh(me)
bm.free()
membrane = bpy.data.objects.new("PortalMembrane", me)
bpy.context.scene.collection.objects.link(membrane)
me.materials.append(MEMBRANE)

root = bpy.data.objects.new("PortalGateway", None)
bpy.context.scene.collection.objects.link(root)
frame.parent = root
membrane.parent = root

tri_count = sum(len(p.vertices) - 2 for p in frame.data.polygons) + sum(
    len(p.vertices) - 2 for p in membrane.data.polygons)
print(f"[gen_portal] triangles: {tri_count}")


# --------------------------------------------------------------------------
# Optional preview renders (Eevee + numpy bloom), in the modelling frame
# --------------------------------------------------------------------------
def look_at(cam, eye, target=(0, 0, 0), up=(0, 1, 0)):
    eye, target = Vector(eye), Vector(target)
    f = (target - eye).normalized()
    r = f.cross(Vector(up)).normalized()
    u = r.cross(f)
    m = Matrix((r, u, -f)).transposed().to_4x4()
    cam.matrix_world = Matrix.Translation(eye) @ m


def box_blur(a, r, axis):
    import numpy as np
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    c = np.cumsum(np.pad(a, pad, mode="edge"), axis=axis)
    n = a.shape[axis]
    hi = np.take(c, range(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, range(0, n), axis=axis)
    return (hi - lo) / (2 * r + 1)


def bloom(path):
    import numpy as np
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    rgb = px[..., :3]
    lum = rgb.max(axis=2, keepdims=True)
    bright = rgb * np.clip((lum - 0.5) / 0.5, 0, 1)
    acc = np.zeros_like(rgb)
    for rad, wt in ((3, 0.55), (10, 0.45), (28, 0.35)):
        b = bright
        for _ in range(3):
            b = box_blur(box_blur(b, rad, 0), rad, 1)
        acc += b * wt
    px[..., :3] = 1.0 - (1.0 - rgb) * (1.0 - np.clip(acc, 0, 1))
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()


def render_previews(outdir):
    os.makedirs(outdir, exist_ok=True)
    scene = bpy.context.scene
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = eng
            break
        except TypeError:
            continue
    try:
        scene.eevee.taa_render_samples = 48
        scene.eevee.use_raytracing = True
    except AttributeError:
        pass
    scene.render.resolution_x, scene.render.resolution_y = 1280, 800
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    world = bpy.data.worlds.new("Space")
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(tc.outputs["Normal"], sep.inputs[0])
    nt.links.new(sep.outputs["Y"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (0.004, 0.003, 0.010, 1)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = (0.035, 0.045, 0.11, 1)
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    scene.world = world

    def area(name, loc, color, energy, size):
        ld = bpy.data.lights.new(name, "AREA")
        ld.color, ld.energy, ld.size = color, energy, size
        lo = bpy.data.objects.new(name, ld)
        scene.collection.objects.link(lo)
        look_at(lo, loc, (0, 0, 0), up=(0, 0, 1) if abs(loc[2]) < 1e-3 else (0, 1, 0))
        return lo

    area("key", (-11, 12, 14), (1.0, 0.93, 0.85), 1500, 8)
    area("rim_cyan", (13, -3, -9), (0.3, 0.9, 1.0), 1600, 6)
    area("fill_blue", (2, -14, 7), (0.35, 0.42, 0.9), 900, 8)
    pl = bpy.data.lights.new("core", "POINT")
    pl.color, pl.energy, pl.shadow_soft_size = (1.0, 0.35, 0.1), 500, 0.5
    plo = bpy.data.objects.new("core", pl)
    scene.collection.objects.link(plo)

    cam_d = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_d)
    scene.collection.objects.link(cam)
    scene.camera = cam
    shots = {
        "face": ((0, 0, 32), 50),
        "threequarter": ((19, 7, 21), 50),
        "edge": ((34, 0.0, 0.0), 50),
        "edge_slight": ((32, 2.5, 7.0), 50),
        "approach": ((1.4, 0.9, 14.0), 22),
        "detail": ((7.2, 3.2, 6.0), 40, (5.3, 0.6, 0.6)),
    }
    for name, (eye, lens, *tgt) in shots.items():
        cam_d.lens = lens
        cam_d.clip_start, cam_d.clip_end = 0.1, 200
        look_at(cam, eye, tgt[0] if tgt else (0, 0, 0))
        path = os.path.join(outdir, f"{TAG}_{name}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        bloom(path)
        print("[gen_portal] preview", path)


if PREVIEW_DIR:
    mixes = []
    for nt, tex in AO_PREVIEW:
        bsdf = nt.nodes["Principled BSDF"]
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs["A"].default_value = bsdf.inputs["Base Color"].default_value
        nt.links.new(tex.outputs["Color"], mix.inputs["B"])
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        mixes.append((nt, mix))
    render_previews(PREVIEW_DIR)
    for nt, mix in mixes:
        nt.nodes.remove(mix)

# --------------------------------------------------------------------------
# Export: rotate mesh data so modelling-Z becomes glTF +Z (gate faces +/-Z)
# --------------------------------------------------------------------------
rot = Matrix.Rotation(math.radians(90), 4, "X")
for ob in (frame, membrane):
    ob.data.transform(rot)
    ob.data.update()

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "portal_gateway.glb"))
os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
for ob in (root, frame, membrane):
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True,
                          export_yup=True)
print("wrote", out)
