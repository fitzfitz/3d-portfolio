# Project probe: a Voyager-style deep-space probe (original work, 100% procedural).
#   $BLENDER --background --python scripts/blender/gen_probe.py
# Output: assets-src/probe.glb (raw; optimized by npm run assets:optimize)
#         assets-src/probe.blend (the baked original, for look-dev)
#
# Every vertex and texel is generated below (seeded). The layout follows the
# Voyager / Pioneer family only in kind: a white high-gain dish with a
# subreflector on a tripod, a ten-bay bus wrapped in gold Kapton blankets, an
# RTG boom carrying three finned generators, a lattice magnetometer boom, a
# short science boom with a scan platform, RCS thruster clusters on the aft
# deck and a gold plate on the bus's +X bay. The plate's engraving is an
# original seeded design (a starburst of ticked lines, a two-circle glyph,
# a perimeter tick ring), not a copy of any real plaque.
#
# CONTRACT with ProjectProbes.tsx and tests/assetContracts.test.ts (glTF
# space, +Y up, drawn at scale 1):
#   one node "Probe", one mesh, one primitive, one material "ProbeBaked"
#     (baseColor + metallicRoughness + normal maps, no extensions, so three
#     builds a MeshStandardMaterial); no tangents.
#   COLOR_0 is the zone mask, per vertex, each channel 0 or 1:
#     R = insignia / trim (dish rim stripe, the bus's aft band, the plate's
#         bezel), painted near-white so a multiplied tint reads true;
#     G = the two beacon lamps (on the subreflector, under the aft deck);
#     B = the RCS nozzle throats (a hook for a thruster-puff flash; no
#         contract on it).
#   the dish faces +Z (boresight); the origin is on the dish axis at the
#     bus's forward deck; the longest extent is 3.0 (the magnetometer boom
#     runs out along +X/+Y), <= 6000 triangles.
#
# Seeded throughout: re-running reproduces assets-src/probe.glb byte for byte
# (verified 2026-10-20; Blender's UV packer, which makes cargo_ship.glb vary,
# is stable on this mesh).
import bpy
import bmesh
import math
import os
import sys

import numpy as np
from bpy_extras.bmesh_utils import bmesh_linked_uv_islands
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils  # noqa: E402

SEED = 20261020
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets-src", "probe.glb")
OUT_BLEND = os.path.join(ROOT, "assets-src", "probe.blend")
TEX = 1024
LONGEST = 3.0
PLATE_UV_SIDE = 0.34   # target width of the plate's UV island (fraction of the atlas)
# Texel density per part, relative to smart-project's uniform one: the dish is
# near-uniform white paint and would otherwise take half the atlas, while the
# crumpled foil needs the texels.
UV_DENSITY = {"paint": 0.45, "foil": 2.0, "foil_dark": 1.2, "fiber": 0.7, "fin": 0.9}
MR_TEX = 512           # the packed metal/roughness map ships at half size

bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene

# part -> zone (R, G, B). Parts are also the bake materials.
PARTS = {
    "foil": (0, 0, 0),        # gold Kapton blanket
    "foil_dark": (0, 0, 0),   # black blanket
    "frame": (0, 0, 0),       # anodised bus frame
    "paint": (0, 0, 0),       # white dish paint
    "trim": (1, 0, 0),        # insignia / trim: tinted per instance
    "lamp": (0, 1, 0),        # beacon lamp lens: blinked per instance
    "metal": (0, 0, 0),       # brushed aluminium
    "fin": (0, 0, 0),         # RTG casing and fins
    "gold": (0, 0, 0),        # the plate
    "nozzle": (0, 0, 0),      # thruster bells
    "throat": (0, 0, 1),      # inside the bells
    "fiber": (0, 0, 0),       # magnetometer boom lattice
    "black": (0, 0, 0),       # instrument housings, lenses
}
PART_IDS = {k: i for i, k in enumerate(PARTS)}
K_PLATE_FACE = 1

bm = bmesh.new()
L_PART = bm.faces.layers.int.new("part")
L_KIND = bm.faces.layers.int.new("kind")

Z = Vector((0, 0, 1))


# ------------------------------------------------------------ primitives ---
# Built in glTF space (+Y up, dish boresight +Z), rotated into Blender at the end.
def rot_to(d):
    return Z.rotation_difference(Vector(d).normalized()).to_matrix().to_4x4()


def place(origin, direction, spin=0.0):
    """Local frame: local +Z along `direction`, at `origin`, turned `spin` about it."""
    return Matrix.Translation(Vector(origin)) @ rot_to(direction) @ Matrix.Rotation(spin, 4, "Z")


def face(verts, part, kind=0):
    f = bm.faces.new(verts)
    f[L_PART] = PART_IDS[part]
    f[L_KIND] = kind
    return f


def orient(faces):
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def lathe(profile, seg, M, parts, closed=False, caps=True, phase=0.0):
    """Revolve (r, z) points about local Z. `parts` is one part or one per
    segment (len(profile) - 1, or len(profile) when the profile is a closed
    loop). r == 0 makes a pole; open ends get a flat cap of the end's part."""
    n = len(profile)
    nseg = n if closed else n - 1
    if isinstance(parts, str):
        parts = [parts] * nseg
    rings = []
    for r, z in profile:
        if r == 0.0:
            rings.append([bm.verts.new(M @ Vector((0, 0, z)))])
        else:
            rings.append([bm.verts.new(M @ Vector((r * math.cos(phase + 2 * math.pi * i / seg),
                                                    r * math.sin(phase + 2 * math.pi * i / seg), z)))
                          for i in range(seg)])
    faces = []
    for k in range(nseg):
        a, b = rings[k], rings[(k + 1) % n]
        for i in range(seg):
            j = (i + 1) % seg
            if len(a) == 1:
                faces.append(face((a[0], b[i], b[j]), parts[k]))
            elif len(b) == 1:
                faces.append(face((a[i], a[j], b[0]), parts[k]))
            else:
                faces.append(face((a[i], a[j], b[j], b[i]), parts[k]))
    if caps and not closed:
        for end, part in ((rings[0], parts[0]), (rings[-1], parts[-1])):
            if len(end) > 1:
                faces.append(face(end, part))
    orient(faces)
    return faces


def cylinder(p0, p1, r, seg, part, cap_parts=None, spin=0.0):
    d = Vector(p1) - Vector(p0)
    f = lathe([(r, 0.0), (r, d.length)], seg, place(p0, d, spin), part)
    if cap_parts:
        f[-2][L_PART] = PART_IDS[cap_parts[0]]
        f[-1][L_PART] = PART_IDS[cap_parts[1]]
    return f


def rod(p0, p1, r, part, sides=3):
    return cylinder(p0, p1, r, sides, part)


def box(M, size, part):
    hx, hy, hz = (s / 2 for s in size)
    v = [bm.verts.new(M @ Vector((sx * hx, sy * hy, sz * hz)))
         for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    quads = ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3))
    faces = [face([v[k] for k in q], part) for q in quads]
    orient(faces)
    return faces


def frame_m(origin, x, y, z):
    """Matrix whose local X/Y/Z axes are x/y/z, at origin."""
    M = Matrix.Identity(4)
    for c, v in enumerate((x, y, z)):
        for r in range(3):
            M[r][c] = v[r]
    M.translation = Vector(origin)
    return M


def basis(d):
    d = Vector(d).normalized()
    e1 = d.orthogonal().normalized()
    return d, e1, d.cross(e1).normalized()


def truss(p0, p1, side, bays, part, r_member, twist=0.0):
    """Triangular lattice boom: three longerons, a batten triangle at every
    station and one diagonal per face per bay."""
    p0, p1 = Vector(p0), Vector(p1)
    d, e1, e2 = basis(p1 - p0)
    rc = side / math.sqrt(3)

    def corner(k, i):
        a = twist + 2 * math.pi * i / 3
        return p0 + (p1 - p0) * (k / bays) + (e1 * math.cos(a) + e2 * math.sin(a)) * rc

    for i in range(3):
        rod(corner(0, i), corner(bays, i), r_member * 1.3, part)
    for k in range(bays + 1):
        for i in range(3):
            rod(corner(k, i), corner(k, (i + 1) % 3), r_member, part)
    for k in range(bays):
        for i in range(3):
            rod(corner(k, i), corner(k + 1, (i + 1) % 3), r_member * 0.8, part)


# ------------------------------------------------------------- the dish ---
DISH_R = 0.80
DISH_DEPTH = 0.24
FOCAL = DISH_R ** 2 / (4 * DISH_DEPTH)
DISH_Z0 = 0.06          # dish vertex height (the bus deck is at 0)
SHELL = 0.035
STRIPE_R = 0.765        # the painted rim stripe (trim) runs STRIPE_R..DISH_R
SEG_DISH = 32


def dish_z(r):
    return DISH_Z0 + r * r / (4 * FOCAL)


def dish_back(r):
    return dish_z(r) - SHELL - 0.012 * (1 - r / DISH_R)


front = [0.07, 0.21, 0.37, 0.52, 0.64, STRIPE_R, DISH_R]
prof = [(r, dish_z(r)) for r in front]                       # concave face, centre -> rim
parts = ["paint"] * 5 + ["trim"]                             # ... stripe on the outer ring
prof.append((DISH_R + 0.006, dish_z(DISH_R) - SHELL * 0.5))  # rim edge
parts += ["trim", "trim"]
for r in reversed(front):                                    # back face, rim -> centre
    prof.append((r, dish_back(r)))
    parts.append("paint")
parts[-1] = "metal"                                          # the hub bore closing the loop
lathe(prof, SEG_DISH, Matrix(), parts, closed=True)

# back ribs: curved plates under the shell
for k in range(8):
    a = 2 * math.pi * (k + 0.5) / 8
    u = Vector((math.cos(a), math.sin(a), 0))
    t = Vector((-math.sin(a), math.cos(a), 0)) * 0.006
    rs = (0.14, 0.33, 0.52, 0.72)
    top = [u * r + Vector((0, 0, dish_back(r) + 0.003)) for r in rs]
    bot = [p - Vector((0, 0, 0.045 * (1 - 0.5 * i / 3))) for i, p in enumerate(top)]
    vs = [[bm.verts.new(p + s * t) for s in (-1, 1)] for p in top]
    vb = [[bm.verts.new(p + s * t) for s in (-1, 1)] for p in bot]
    fs = []
    for i in range(3):
        fs.append(face((vs[i][0], vs[i + 1][0], vb[i + 1][0], vb[i][0]), "metal"))
        fs.append(face((vs[i][1], vb[i][1], vb[i + 1][1], vs[i + 1][1]), "metal"))
        fs.append(face((vb[i][0], vb[i + 1][0], vb[i + 1][1], vb[i][1]), "metal"))
    fs.append(face((vs[0][0], vb[0][0], vb[0][1], vs[0][1]), "metal"))
    fs.append(face((vs[3][0], vs[3][1], vb[3][1], vb[3][0]), "metal"))
    orient(fs)

# feed horn at the vertex, subreflector on a tripod near the focus
lathe([(0.075, DISH_Z0 - 0.01), (0.07, DISH_Z0 + 0.05), (0.05, DISH_Z0 + 0.13), (0.0, DISH_Z0 + 0.135)],
      12, Matrix(), ["metal", "metal", "black"], caps=True)
SUB_Z = DISH_Z0 + FOCAL * 0.86
lathe([(0.0, SUB_Z - 0.012), (0.06, SUB_Z - 0.004), (0.11, SUB_Z + 0.012), (0.11, SUB_Z + 0.026),
       (0.05, SUB_Z + 0.036), (0.0, SUB_Z + 0.038)], 20, Matrix(), "paint", caps=False)
for k in range(3):
    a = math.pi / 2 + 2 * math.pi * k / 3
    foot = Vector((math.cos(a) * 0.5, math.sin(a) * 0.5, dish_z(0.5) + 0.004))
    head = Vector((math.cos(a) * 0.085, math.sin(a) * 0.085, SUB_Z + 0.004))
    rod(foot, head, 0.009, "metal", sides=6)
# beacon lamp 1 on the subreflector's back
LAMP_R = 0.042
lathe([(0.03, SUB_Z + 0.036), (0.03, SUB_Z + 0.06)], 10, Matrix(), "metal")
lathe([(LAMP_R, SUB_Z + 0.06), (LAMP_R, SUB_Z + 0.075), (LAMP_R * 0.8, SUB_Z + 0.098),
       (LAMP_R * 0.42, SUB_Z + 0.112), (0.0, SUB_Z + 0.116)], 12, Matrix(), "lamp")

# ------------------------------------------------------------- the bus ---
BUS_R = 0.40                      # decagon circumradius
APO = BUS_R * math.cos(math.pi / 10)
BUS_TOP, BUS_BOT = 0.0, -0.28
BAY_Z = (BUS_TOP + BUS_BOT) / 2 + 0.01
BAY_ANG = [math.radians(36 * k) for k in range(10)]           # bay normals; bay 0 faces +X
VERT_ANG = [a - math.radians(18) for a in BAY_ANG]      # bay k spans VERT_ANG[k]..[k+1]

top_ring = [bm.verts.new((BUS_R * math.cos(a), BUS_R * math.sin(a), BUS_TOP)) for a in VERT_ANG]
bot_ring = [bm.verts.new((BUS_R * math.cos(a), BUS_R * math.sin(a), BUS_BOT)) for a in VERT_ANG]
sides = [face((bot_ring[k], bot_ring[(k + 1) % 10], top_ring[(k + 1) % 10], top_ring[k]), "foil")
         for k in range(10)]
caps = [face(list(reversed(top_ring)), "foil_dark"), face(bot_ring, "foil_dark")]
orient(sides + caps)
# bays: a recessed blanket inside an anodised frame
res = bmesh.ops.inset_individual(bm, faces=sides, thickness=0.018, depth=-0.007, use_even_offset=True)
for f in res["faces"]:
    f[L_PART] = PART_IDS["frame"]
BAY_PART = {0: "foil_dark", 1: "foil", 2: "foil", 3: "foil_dark", 4: "foil", 5: "frame",
            6: "foil", 7: "foil_dark", 8: "foil", 9: "foil"}
for k, f in enumerate(sides):
    f[L_PART] = PART_IDS[BAY_PART[k]]


def bay_frame(k, out=0.0):
    """Frame on bay k's face, `out` beyond it: local +Z points out of the bay."""
    a = BAY_ANG[k]
    n = Vector((math.cos(a), math.sin(a), 0))
    return Matrix.Translation(n * (APO + out) + Vector((0, 0, BAY_Z))) @ rot_to(n)


# louvres on bay 5 (-X): bright slats over the frame-coloured radiator
for i in range(6):
    zc = BUS_BOT + 0.05 + i * 0.034
    a = BAY_ANG[5]
    n = Vector((math.cos(a), math.sin(a), 0))
    t = Vector((-math.sin(a), math.cos(a), 0))
    M = frame_m(n * (APO + 0.002) + Vector((0, 0, zc)), t, Vector((0, 0, 1)), n)
    M = M @ Matrix.Rotation(math.radians(-25), 4, "X")
    box(M, (0.19, 0.028, 0.004), "metal")

# aft trim band (insignia): a proud decagonal collar round the bus's aft edge
band = []
for zr in ((BUS_BOT + 0.042, BUS_R + 0.012), (BUS_BOT - 0.004, BUS_R + 0.012)):
    band.append([bm.verts.new((zr[1] * math.cos(a), zr[1] * math.sin(a), zr[0])) for a in VERT_ANG])
inner = [[bm.verts.new((BUS_R * 0.97 * math.cos(a), BUS_R * 0.97 * math.sin(a), z)) for a in VERT_ANG]
         for z in (BUS_BOT + 0.042, BUS_BOT - 0.004)]
fs = []
for k in range(10):
    j = (k + 1) % 10
    fs.append(face((band[0][k], band[0][j], band[1][j], band[1][k]), "trim"))
    fs.append(face((inner[0][k], band[0][k], band[0][j], inner[0][j]), "trim"))
    fs.append(face((inner[1][k], inner[1][j], band[1][j], band[1][k]), "trim"))
orient(fs)

# the dish's mount: a hub adapter and six struts from the deck to the shell
cylinder((0, 0, BUS_TOP), (0, 0, dish_back(0.13) + 0.003), 0.13, 16, "metal")
for k in range(6):
    a = VERT_ANG[0] + 2 * math.pi * k / 6
    rod((BUS_R * 0.92 * math.cos(a), BUS_R * 0.92 * math.sin(a), BUS_TOP),
        (0.36 * math.cos(a + 0.25), 0.36 * math.sin(a + 0.25), dish_back(0.36) + 0.002),
        0.011, "metal", sides=6)

# aft deck: propellant tank cover, beacon lamp 2, two RCS clusters
lathe([(0.16, BUS_BOT), (0.16, BUS_BOT - 0.045), (0.12, BUS_BOT - 0.07), (0.0, BUS_BOT - 0.075)],
      16, Matrix(), "foil_dark", caps=False)
LAMP2_Z = BUS_BOT - 0.075
lathe([(0.026, LAMP2_Z + 0.002), (0.026, LAMP2_Z - 0.018)], 10, Matrix(), "metal")
lathe([(LAMP_R, LAMP2_Z - 0.018), (LAMP_R, LAMP2_Z - 0.032), (LAMP_R * 0.8, LAMP2_Z - 0.054),
       (LAMP_R * 0.42, LAMP2_Z - 0.068), (0.0, LAMP2_Z - 0.072)], 12, Matrix(), "lamp")


def nozzle(base, direction):
    """A bell: closed lathe, dark outside, sooty throat (B zone) inside."""
    M = place(base, direction)
    prof = [(0.009, 0.0), (0.011, 0.012), (0.018, 0.032), (0.024, 0.046),
            (0.021, 0.046), (0.015, 0.034), (0.008, 0.016), (0.0, 0.012)]
    lathe(prof, 8, M, ["nozzle", "nozzle", "nozzle", "nozzle", "throat", "throat", "throat"], caps=False)
    lathe([(0.0, -0.012), (0.013, -0.01), (0.013, 0.002)], 8, M, "metal", caps=False)


for k, a in enumerate((math.radians(90), math.radians(270))):
    c = Vector((math.cos(a) * 0.29, math.sin(a) * 0.29, BUS_BOT - 0.022))
    out = Vector((math.cos(a), math.sin(a), 0))
    tan = Vector((-math.sin(a), math.cos(a), 0))
    M = frame_m(c, tan, out, Vector((0, 0, 1)))
    box(M, (0.09, 0.06, 0.044), "metal")
    nozzle(c + Vector((0, 0, -0.022)), (0, 0, -1))                  # aft
    nozzle(c + tan * 0.045, tan)                                     # roll pair
    nozzle(c - tan * 0.045, -tan)
    nozzle(c + out * 0.03 + Vector((0, 0, -0.01)), out + Vector((0, 0, -0.6)))  # canted out

# ------------------------------------------------------------- the plate ---
PLATE_R = 0.088
pf = bay_frame(0)
box(pf @ Matrix.Translation((0, 0, 0.006)), (0.205, 0.205, 0.012), "frame")
# bezel (trim) and the gold disc; local +Z = out of the bay (+X)
lathe([(PLATE_R, 0.012), (PLATE_R + 0.011, 0.012), (PLATE_R + 0.011, 0.024), (PLATE_R + 0.004, 0.026),
       (PLATE_R, 0.024)], 32, pf, "trim", closed=True)
disc = lathe([(PLATE_R - 0.001, 0.012), (PLATE_R - 0.001, 0.021)], 32, pf, "gold")
disc[-1][L_KIND] = K_PLATE_FACE          # the outer cap (z = 0.021) carries the engraving
PLATE_C = pf @ Vector((0, 0, 0.021))

# ------------------------------------------------------------- the booms ---
TILT = math.radians(5)


def boom_dir(a, tilt=TILT):
    return Vector((math.cos(a) * math.cos(tilt), math.sin(a) * math.cos(tilt), -math.sin(tilt)))


def along(a, r, tilt=TILT, z=BAY_Z):
    return Vector((0, 0, z)) + boom_dir(a, tilt) * r


# RTG boom, bay 6 (216 deg): a truss out to three finned generators in a row
A_RTG = BAY_ANG[6]
d_rtg = boom_dir(A_RTG)
box(bay_frame(6, 0.012), (0.09, 0.09, 0.024), "metal")
truss(along(A_RTG, APO + 0.02), along(A_RTG, 0.80), 0.075, 5, "metal", 0.0075)
for i in range(3):
    r0 = 0.80 + i * 0.178
    p0, p1 = along(A_RTG, r0 + 0.012), along(A_RTG, r0 + 0.168)
    cylinder(along(A_RTG, r0), along(A_RTG, r0 + 0.012), 0.062, 12, "metal")   # flange
    cylinder(p0, p1, 0.046, 10, "fin")
    M = place(p0, d_rtg)
    for k in range(6):
        Mf = M @ Matrix.Rotation(2 * math.pi * k / 6 + 0.3, 4, "Z") @ Matrix.Translation((0.084, 0, 0.078))
        box(Mf, (0.078, 0.007, 0.15), "fin")
cylinder(along(A_RTG, 0.80 + 3 * 0.178 - 0.01), along(A_RTG, 0.80 + 3 * 0.178 + 0.004), 0.062, 12, "metal")

# science boom, bay 4 (144 deg): truss to the scan platform and its cameras
A_SCI = BAY_ANG[4]
box(bay_frame(4, 0.012), (0.09, 0.09, 0.024), "metal")
truss(along(A_SCI, APO + 0.02), along(A_SCI, 0.86), 0.07, 3, "metal", 0.007)
box(place(along(A_SCI, 0.58), boom_dir(A_SCI)) @ Matrix.Translation((0, 0.05, 0)), (0.07, 0.05, 0.09), "foil")
plat = along(A_SCI, 0.93)
Mp = place(plat, boom_dir(A_SCI))
box(Mp, (0.15, 0.13, 0.13), "foil_dark")
box(Mp @ Matrix.Translation((0, 0, 0.068)), (0.12, 0.10, 0.008), "frame")
cam_dir = Vector((0.15, 0.1, 1.0))
for off, r, ln in (((0.035, 0.0), 0.03, 0.22), ((-0.045, 0.02), 0.024, 0.12)):
    base = plat + Vector((off[0], off[1], 0.06))
    tip = base + cam_dir.normalized() * ln
    cylinder(base, tip, r, 10, "metal", cap_parts=("metal", "black"))
    cylinder(tip, tip + cam_dir.normalized() * 0.03, r * 1.25, 10, "black")   # sunshade

# magnetometer boom, bay 1 (36 deg): deployment canister, then a long lattice
A_MAG = BAY_ANG[1]
MAG_TILT = math.radians(3)
d_mag = boom_dir(A_MAG, MAG_TILT)
box(bay_frame(1, 0.012), (0.1, 0.1, 0.024), "metal")
cylinder(along(A_MAG, APO + 0.02, MAG_TILT), along(A_MAG, APO + 0.15, MAG_TILT), 0.052, 14, "metal",
         cap_parts=("metal", "frame"))
MAG_END = 2.36
truss(along(A_MAG, APO + 0.15, MAG_TILT), along(A_MAG, MAG_END - 0.10, MAG_TILT), 0.05, 10, "fiber", 0.0055,
      twist=0.4)
cylinder(along(A_MAG, 1.38, MAG_TILT), along(A_MAG, 1.46, MAG_TILT), 0.034, 12, "metal")
cylinder(along(A_MAG, MAG_END - 0.10, MAG_TILT), along(A_MAG, MAG_END, MAG_TILT), 0.042, 14, "metal",
         cap_parts=("metal", "black"))

# --------------------------------------------- into Blender space + scale ---
bm.verts.ensure_lookup_table()
xs = [v.co for v in bm.verts]
ext = [max(c[i] for c in xs) - min(c[i] for c in xs) for i in range(3)]
S = LONGEST / max(ext)
bmesh.ops.transform(bm, matrix=Matrix.Rotation(math.radians(90), 4, "X") @ Matrix.Scale(S, 4), verts=bm.verts)
bm.normal_update()
plate_c = (Matrix.Rotation(math.radians(90), 4, "X") @ Matrix.Scale(S, 4)) @ PLATE_C
tris = sum(len(f.verts) - 2 for f in bm.faces)
print(f"probe: scale={S:.4f} glTF extent=({ext[0] * S:.3f}, {ext[1] * S:.3f}, {ext[2] * S:.3f}) triangles={tris}")

# ------------------------------------------------------ mesh + zone mask ---
me = bpy.data.meshes.new("Probe")
bm.to_mesh(me)
bm.free()
ob = bpy.data.objects.new("Probe", me)
SCENE.collection.objects.link(ob)
part_of = np.zeros(len(me.polygons), np.int32)
me.attributes["part"].data.foreach_get("value", part_of)
kind_of = np.zeros(len(me.polygons), np.int32)
me.attributes["kind"].data.foreach_get("value", kind_of)

zones = me.color_attributes.new("Zones", "BYTE_COLOR", "CORNER")
names = list(PARTS)
cols = np.zeros((len(me.loops), 4), np.float32)
cols[:, 3] = 1.0
for p in me.polygons:
    cols[p.loop_start:p.loop_start + p.loop_total, :3] = PARTS[names[part_of[p.index]]]
zones.data.foreach_set("color", cols.ravel())
me.color_attributes.active_color = zones
me.color_attributes.render_color_index = me.color_attributes.find("Zones")


def activate(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


activate(ob)
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50), keep_sharp_edges=True)

# ------------------------------------------------------------- materials ---
def nd(nt, kind, **inputs):
    node = nt.nodes.new(kind)
    for k, v in inputs.items():
        node.inputs[k].default_value = v
    return node


def math_(nt, op, a, b=None, c=None):
    m = nt.nodes.new("ShaderNodeMath")
    m.operation = op
    for i, v in enumerate((a, b, c)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            m.inputs[i].default_value = v
        else:
            nt.links.new(v, m.inputs[i])
    return m.outputs[0]


def rgb_scale(nt, rgb, s):
    v = nt.nodes.new("ShaderNodeVectorMath")
    v.operation = "SCALE"
    v.inputs[0].default_value = rgb
    if isinstance(s, (int, float)):
        v.inputs[3].default_value = s
    else:
        nt.links.new(s, v.inputs[3])
    return v.outputs[0]


def noise(nt, co, scale, detail=4.0, rough=0.55, distortion=0.0, w=0.0):
    n = nd(nt, "ShaderNodeTexNoise", Scale=scale, Detail=detail, Roughness=rough, Distortion=distortion)
    n.noise_dimensions = "4D"
    n.inputs["W"].default_value = w
    nt.links.new(co, n.inputs["Vector"])
    return n.outputs["Fac"]


MATS = {}


def material(part, albedo, rough, metal, height=None, bump=(0.0, 0.0)):
    """A bake material. albedo is an RGB tuple or a function (nt, co) -> socket;
    rough, metal, height likewise for floats. Emission outputs carry the
    albedo and the packed (0, roughness, metalness) for EMIT bakes; the
    Principled BSDF carries the bumped normal for the NORMAL bake."""
    m = bpy.data.materials.new("BAKE_" + part)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    co = nd(nt, "ShaderNodeTexCoord").outputs["Object"]

    def sock(v, value_kind):
        if callable(v):
            return v(nt, co)
        if value_kind == "rgb":
            return _rgb(nt, v)
        n = nd(nt, "ShaderNodeValue")
        n.outputs[0].default_value = v
        return n.outputs[0]

    a, r, mt = sock(albedo, "rgb"), sock(rough, "f"), sock(metal, "f")
    if height is not None:
        b = nd(nt, "ShaderNodeBump", Strength=bump[0], Distance=bump[1])
        nt.links.new(sock(height, "f"), b.inputs["Height"])
        nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    e_alb = nd(nt, "ShaderNodeEmission", Strength=1.0)
    nt.links.new(a, e_alb.inputs["Color"])
    comb = nd(nt, "ShaderNodeCombineColor")
    nt.links.new(r, comb.inputs[1])
    nt.links.new(mt, comb.inputs[2])
    e_mr = nd(nt, "ShaderNodeEmission", Strength=1.0)
    nt.links.new(comb.outputs[0], e_mr.inputs["Color"])
    MATS[part] = (m, bsdf, e_alb, e_mr)
    return m


def _rgb(nt, v):
    n = nt.nodes.new("ShaderNodeRGB")
    n.outputs[0].default_value = (*v, 1.0)
    return n.outputs[0]


def set_mode(mode):
    for m, bsdf, e_alb, e_mr in MATS.values():
        out = m.node_tree.nodes["Material Output"]
        src = {"normal": bsdf.outputs[0], "albedo": e_alb.outputs[0], "mr": e_mr.outputs[0]}[mode]
        m.node_tree.links.new(src, out.inputs["Surface"])


# linear-light values. Metals carry their F0 as albedo.
def vmath(nt, op, a, b):
    v = nt.nodes.new("ShaderNodeVectorMath")
    v.operation = op
    for i, x in enumerate((a, b)):
        if isinstance(x, tuple):
            v.inputs[i].default_value = x
        else:
            nt.links.new(x, v.inputs[i])
    return v.outputs["Value" if op == "DOT_PRODUCT" else "Vector"]


def facets(nt, co, scale, offset):
    """Crumpled sheet: every Voronoi cell is a flat facet tilted its own random
    way (height = (p - cell point) . (cell colour - 0.5)), so facets meet at
    sharp creases. Height in object units; slopes up to about +-0.5."""
    v = nt.nodes.new("ShaderNodeTexVoronoi")
    v.inputs["Scale"].default_value = scale
    v.inputs["Randomness"].default_value = 0.85
    nt.links.new(vmath(nt, "ADD", co, offset), v.inputs["Vector"])
    d = vmath(nt, "SUBTRACT", vmath(nt, "ADD", co, offset), v.outputs["Position"])
    return vmath(nt, "DOT_PRODUCT", d, vmath(nt, "SUBTRACT", v.outputs["Color"], (0.5, 0.5, 0.5)))


def crinkle(nt, co, cell=24.0, w=0.0):
    """Hand-wrapped MLI blanket: two scales of creased facets, a fine wrinkle
    and a soft pillowing between the tie points. Use with bump distance 1."""
    big = facets(nt, co, cell, (w, 2 * w, 3.0))
    small = facets(nt, co, cell * 2.4, (5.0 + w, 1.0, -w))
    fine = noise(nt, co, 140.0, 2.0, 0.5, 0.0, w + 3.0)
    pillow = noise(nt, co, 4.0, 2.0, 0.5, 0.0, w + 7.0)
    h = math_(nt, "ADD", big, math_(nt, "MULTIPLY", small, 0.6))
    h = math_(nt, "ADD", h, math_(nt, "MULTIPLY", fine, 0.0012))
    return math_(nt, "ADD", h, math_(nt, "MULTIPLY", pillow, 0.02))


def foil_albedo(nt, co):
    var = noise(nt, co, 14.0, 5.0, 0.6, 0.4, 2.0)
    tone = math_(nt, "ADD", 0.78, math_(nt, "MULTIPLY", var, 0.36))
    return rgb_scale(nt, (0.86, 0.54, 0.17), tone)


def foil_rough(nt, co):
    # smudges, not grain: low-frequency roughness keeps the packed MR map small
    return math_(nt, "ADD", 0.26, math_(nt, "MULTIPLY", noise(nt, co, 7.0, 2.0, 0.5, 0.0, 4.0), 0.26))


def dark_albedo(nt, co):
    return rgb_scale(nt, (0.035, 0.034, 0.038), math_(nt, "ADD", 0.8, math_(nt, "MULTIPLY",
                     noise(nt, co, 20.0, 4.0, 0.6, 0.3, 5.0), 0.4)))


def paint_seams(nt, co):
    """1 on the dish's panel seams (two rings and 12 gores), 0 elsewhere.
    The dish axis is Blender -Y, so the radius lives in x/z."""
    sep = nd(nt, "ShaderNodeSeparateXYZ")
    nt.links.new(co, sep.inputs[0])
    x, z = sep.outputs[0], sep.outputs[2]
    rad = math_(nt, "SQRT", math_(nt, "ADD", math_(nt, "MULTIPLY", x, x), math_(nt, "MULTIPLY", z, z)))
    w = 0.0028
    rings = [math_(nt, "LESS_THAN", math_(nt, "ABSOLUTE", math_(nt, "SUBTRACT", rad, r0 * S)), w)
             for r0 in (0.30, 0.55)]
    ring = math_(nt, "MAXIMUM", *rings)
    ang = math_(nt, "ARCTAN2", z, x)
    g = math_(nt, "MULTIPLY", ang, 12 / (2 * math.pi))
    arc = math_(nt, "MULTIPLY", math_(nt, "ABSOLUTE", math_(nt, "SUBTRACT", g, math_(nt, "ROUND", g))),
                math_(nt, "MULTIPLY", rad, 2 * math.pi / 12))
    gore = math_(nt, "MULTIPLY", math_(nt, "LESS_THAN", arc, w), math_(nt, "GREATER_THAN", rad, 0.12 * S))
    return math_(nt, "MAXIMUM", ring, gore)


def paint_albedo(nt, co):
    mott = noise(nt, co, 9.0, 5.0, 0.6, 0.0, 6.0)
    tone = math_(nt, "ADD", 0.93, math_(nt, "MULTIPLY", mott, 0.08))
    tone = math_(nt, "MULTIPLY", tone, math_(nt, "SUBTRACT", 1.0, math_(nt, "MULTIPLY", paint_seams(nt, co), 0.2)))
    return rgb_scale(nt, (0.70, 0.70, 0.68), tone)


def paint_height(nt, co):
    return math_(nt, "ADD", math_(nt, "MULTIPLY", noise(nt, co, 60.0, 3.0, 0.5, 0.0, 8.0), 0.15),
                 math_(nt, "MULTIPLY", paint_seams(nt, co), -1.0))


def brushed_albedo(base):
    def f(nt, co):
        return rgb_scale(nt, base, math_(nt, "ADD", 0.9, math_(nt, "MULTIPLY",
                         noise(nt, co, 40.0, 6.0, 0.7, 0.0, 9.0), 0.18)))
    return f


def brushed_rough(lo, hi):
    def f(nt, co):
        return math_(nt, "ADD", lo, math_(nt, "MULTIPLY", noise(nt, co, 9.0, 2.0, 0.5, 0.0, 10.0), hi - lo))
    return f


def fin_albedo(nt, co):
    return rgb_scale(nt, (0.085, 0.082, 0.078), math_(nt, "ADD", 0.75, math_(nt, "MULTIPLY",
                     noise(nt, co, 25.0, 5.0, 0.6, 0.0, 11.0), 0.5)))


def nozzle_albedo(nt, co):
    # heat tint: straw to blue toward the bells' lips, read off a noise
    t = noise(nt, co, 50.0, 3.0, 0.5, 0.0, 12.0)
    mix = nd(nt, "ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(t, mix.inputs[0])
    mix.inputs[6].default_value = (0.32, 0.27, 0.20, 1.0)
    mix.inputs[7].default_value = (0.20, 0.22, 0.30, 1.0)
    return mix.outputs[2]


material("foil", foil_albedo, foil_rough, 0.72, lambda nt, co: crinkle(nt, co), (0.8, 1.0))
material("foil_dark", dark_albedo, 0.42, 0.15, lambda nt, co: crinkle(nt, co, 20.0, 1.5), (0.6, 1.0))
material("frame", brushed_albedo((0.30, 0.30, 0.31)), brushed_rough(0.35, 0.5), 0.85)
material("paint", paint_albedo, 0.58, 0.0, paint_height, (0.25, 0.002))
material("trim", (0.80, 0.80, 0.78), 0.42, 0.0, lambda nt, co: noise(nt, co, 80.0, 2.0, 0.5, 0.0, 13.0),
         (0.05, 0.001))
material("lamp", (0.85, 0.83, 0.78), 0.12, 0.0)
material("metal", brushed_albedo((0.80, 0.80, 0.81)), brushed_rough(0.26, 0.42), 1.0,
         lambda nt, co: noise(nt, co, 120.0, 2.0, 0.5, 0.0, 14.0), (0.08, 0.001))
material("fin", fin_albedo, 0.62, 0.3, lambda nt, co: noise(nt, co, 90.0, 3.0, 0.5, 0.0, 15.0), (0.15, 0.001))
material("gold", (1.0, 0.72, 0.30), 0.2, 1.0)
material("nozzle", nozzle_albedo, 0.35, 0.9)
material("throat", (0.05, 0.045, 0.04), 0.65, 0.4)
material("fiber", brushed_albedo((0.58, 0.55, 0.47)), 0.55, 0.0)
material("black", (0.018, 0.018, 0.02), 0.28, 0.0)

for name in PARTS:
    me.materials.append(MATS[name][0])
me.polygons.foreach_set("material_index", part_of)
me.update()

# ------------------------------------------------------------------- UVs ---
activate(ob)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0, scale_to_bounds=False)
bpy.ops.object.mode_set(mode="OBJECT")
ubm = bmesh.new()
ubm.from_mesh(me)
uvl = ubm.loops.layers.uv.active
for island in bmesh_linked_uv_islands(ubm, uvl):
    counts = {}
    for f in island:
        name = names[part_of[f.index]]
        counts[name] = counts.get(name, 0) + 1
    k = UV_DENSITY.get(max(counts, key=counts.get), 1.0)
    if k == 1.0:
        continue
    pts = [lp[uvl].uv.copy() for f in island for lp in f.loops]
    c = sum(pts, Vector((0.0, 0.0))) / len(pts)
    for f in island:
        for lp in f.loops:
            lp[uvl].uv = c + (lp[uvl].uv - c) * k
ubm.to_mesh(me)
ubm.free()

plate_poly = next(p for p in me.polygons if kind_of[p.index] == K_PLATE_FACE)
plate_loops = list(range(plate_poly.loop_start, plate_poly.loop_start + plate_poly.loop_total))
R_PLATE = PLATE_R * S


def plate_pq(co):
    # viewer at glTF +X with +Y up: right = glTF -Z = Blender +Y, up = glTF +Y = Blender +Z
    return ((co.y - plate_c.y) / R_PLATE, (co.z - plate_c.z) / R_PLATE)


def plate_bbox():
    uv = me.uv_layers.active.data   # re-fetched: edit-mode round trips free the old one
    us = [uv[i].uv.x for i in plate_loops]
    vs = [uv[i].uv.y for i in plate_loops]
    return min(us), min(vs), max(us) - min(us), max(vs) - min(vs)


def map_plate(u0, v0, side):
    uv = me.uv_layers.active.data
    for i in plate_loops:
        p, q = plate_pq(me.vertices[me.loops[i].vertex_index].co)
        uv[i].uv = (u0 + (p + 1) / 2 * side, v0 + (q + 1) / 2 * side)


# grow the plate's island until it packs to PLATE_UV_SIDE of the atlas
for _ in range(3):
    u0, v0, w, h = plate_bbox()
    side = max(w, h)
    cur = side
    if _ > 0:
        k = PLATE_UV_SIDE / cur
        cx, cy = u0 + w / 2, v0 + h / 2
        side *= k
        map_plate(cx - side / 2, cy - side / 2, side)
    else:
        map_plate(u0, v0, side * 3.0)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=0.003)
    bpy.ops.object.mode_set(mode="OBJECT")
u0, v0, w, h = plate_bbox()
side = max(w, h)
map_plate(u0 + (w - side) / 2, v0 + (h - side) / 2, side)     # undo any packer rotation
PU0, PV0, PSIDE = u0 + (w - side) / 2, v0 + (h - side) / 2, side
print(f"probe: plate island {PSIDE * TEX:.0f} px across")

# ------------------------------------------------------------------ bake ---
world = bpy.data.worlds.new("bake_world")
SCENE.world = world
world.light_settings.distance = 0.10
SCENE.render.engine = "CYCLES"
SCENE.cycles.device = "CPU"
SCENE.cycles.seed = 0
SCENE.render.bake.margin = 4


def new_img(name, noncolor=False, raw=False):
    """raw: a float bake target (linear values, no 8-bit banding in the darks)."""
    img = bpy.data.images.new(name, width=TEX, height=TEX, alpha=False, float_buffer=raw)
    if noncolor or raw:
        img.colorspace_settings.name = "Non-Color"
    return img


def bake(kind, img, samples, **kw):
    bake_utils._attach_bake_target([ob], img)
    SCENE.cycles.samples = samples
    activate(ob)
    bpy.ops.object.bake(type=kind, use_clear=True, **kw)
    bake_utils._detach_bake_targets([ob])


def pixels(img):
    a = np.empty(TEX * TEX * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(TEX, TEX, 4)


alb_raw, mr_raw = new_img("probe_albedo_raw", raw=True), new_img("probe_mr_raw", raw=True)
ao_raw, nrm_img = new_img("probe_ao_raw", raw=True), new_img("probe_normal_raw", raw=True)
set_mode("albedo")
bake("EMIT", alb_raw, 8)
set_mode("mr")
bake("EMIT", mr_raw, 8)
set_mode("normal")
bake("NORMAL", nrm_img, 8)
bake("AO", ao_raw, 96)

alb, mr, ao, nrm = pixels(alb_raw), pixels(mr_raw), pixels(ao_raw), pixels(nrm_img)
# The raw bakes are linear floats; the shipped albedo is 8-bit sRGB.


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


lin = alb[..., :3].copy()
occl = 0.3 + 0.7 * ao[..., :1]
lin *= occl

# --------------------------------------------- the plate: engraved gold ---
nrng = np.random.default_rng(SEED)
x0, y0 = int(PU0 * TEX), int(PV0 * TEX)
x1 = min(TEX, int(math.ceil((PU0 + PSIDE) * TEX)) + 1)
y1 = min(TEX, int(math.ceil((PV0 + PSIDE) * TEX)) + 1)
ys_, xs_ = np.mgrid[y0:y1, x0:x1].astype(np.float32)
P = ((xs_ + 0.5) / TEX - PU0) / PSIDE * 2 - 1
Q = ((ys_ + 0.5) / TEX - PV0) / PSIDE * 2 - 1
Rr = np.hypot(P, Q)
px = 2.0 / (PSIDE * TEX)          # one texel in plate units


def seg_d(ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = np.clip(((P - ax) * dx + (Q - ay) * dy) / (dx * dx + dy * dy + 1e-9), 0, 1)
    return np.hypot(P - ax - t * dx, Q - ay - t * dy)


def stroke(d, w):
    return np.clip(1 - (d - w) / (1.2 * px), 0, 1)


etch = np.zeros_like(P)
LW = max(0.012, 1.3 * px)
# starburst: 13 ticked lines out of one point
cx, cy = -0.30, -0.12
for i in range(13):
    a = 2 * math.pi * i / 13 + nrng.uniform(-0.12, 0.12)
    ln = nrng.uniform(0.25, 0.62)
    bx, by = cx + ln * math.cos(a), cy + ln * math.sin(a)
    etch = np.maximum(etch, stroke(seg_d(cx, cy, bx, by), LW * 0.8))
    for t in np.linspace(0.3, 0.92, int(nrng.integers(3, 6))):
        if nrng.random() < 0.55:
            mx, my = cx + t * ln * math.cos(a), cy + t * ln * math.sin(a)
            nx_, ny_ = -math.sin(a) * 0.03, math.cos(a) * 0.03
            etch = np.maximum(etch, stroke(seg_d(mx - nx_, my - ny_, mx + nx_, my + ny_), LW * 0.7))
# two-circle glyph
for gx in (0.30, 0.58):
    etch = np.maximum(etch, stroke(np.abs(np.hypot(P - gx, Q - 0.52) - 0.075), LW * 0.8))
etch = np.maximum(etch, stroke(seg_d(0.375, 0.52, 0.505, 0.52), LW * 0.6))
# a concentric "disc and stylus" figure, lower right
for rr in (0.10, 0.17, 0.24):
    etch = np.maximum(etch, stroke(np.abs(np.hypot(P - 0.42, Q + 0.42) - rr), LW * 0.6))
etch = np.maximum(etch, stroke(seg_d(0.42, -0.42, 0.72, -0.12), LW * 0.7))
# perimeter ring and ticks
etch = np.maximum(etch, stroke(np.abs(Rr - 0.88), LW * 0.7))
ang = np.arctan2(Q, P)
ticks = (np.abs(((ang / (2 * math.pi) * 72) % 1) - 0.5) > 0.42) & (Rr > 0.88) & (Rr < 0.95)
etch = np.maximum(etch, ticks.astype(np.float32) * stroke(np.abs(Rr - 0.915), 0.035))
etch *= (Rr < 0.97)

turn = 0.5 + 0.5 * np.sin(Rr * 2 * math.pi * 38 + nrng.uniform(0, 6.28))   # lathe-turned finish
gold = np.array([1.0, 0.70, 0.30], np.float32)
g_lin = gold[None, None] * (0.9 + 0.08 * turn)[..., None]
g_lin = g_lin * (1 - 0.6 * etch)[..., None]
rim = (Rr > 0.97)
g_lin[rim] *= 0.85
inside = Rr <= 1.03
sl = (slice(y0, y1), slice(x0, x1))
lin[sl][inside] = (g_lin * (0.75 + 0.25 * ao[sl][..., :1]))[inside]
mr[sl][..., 1][inside] = (0.34 + 0.06 * turn + 0.22 * etch)[inside]
mr[sl][..., 2][inside] = 1.0
height = -etch * 1.0 + 0.04 * turn - 0.6 * np.clip((Rr - 0.97) / 0.03, 0, 1)
gy, gx = np.gradient(height)
strength = 0.9
nv = np.stack([-gx * strength, -gy * strength, np.ones_like(gx)], -1)
nv /= np.linalg.norm(nv, axis=-1, keepdims=True)
nrm[sl][..., :3][inside] = (nv * 0.5 + 0.5)[inside]

# ------------------------------------------------------- final material ---
def to_image(name, rgba, noncolor=False, size=TEX):
    img = bpy.data.images.new(name, width=size, height=size, alpha=False)
    if noncolor:
        img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.pack()
    return img


alb[..., :3] = to_srgb(lin)
alb[..., 3] = 1.0
mr[..., 0] = 1.0
mr[..., 3] = 1.0
nrm[..., 3] = 1.0
f = TEX // MR_TEX
mr_small = mr.reshape(MR_TEX, f, MR_TEX, f, 4).mean(axis=(1, 3))
img_alb = to_image("probe_albedo", alb)
img_mr = to_image("probe_metal_rough", mr_small, True, MR_TEX)
img_nrm = to_image("probe_normal_map", nrm, True)

final = bpy.data.materials.new("ProbeBaked")
final.use_nodes = True
nt = final.node_tree
bsdf = nt.nodes["Principled BSDF"]
t_alb = nt.nodes.new("ShaderNodeTexImage")
t_alb.image = img_alb
nt.links.new(t_alb.outputs["Color"], bsdf.inputs["Base Color"])
t_mr = nt.nodes.new("ShaderNodeTexImage")
t_mr.image = img_mr
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(t_mr.outputs["Color"], sep.inputs["Color"])
nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
bake_utils.attach_normal_map(final, img_nrm)

me.materials.clear()
me.materials.append(final)
me.polygons.foreach_set("material_index", np.zeros(len(me.polygons), np.int32))
for a in ("part", "kind"):
    me.attributes.remove(me.attributes[a])
me.update()
for m in list(bpy.data.materials):
    if m.name.startswith("BAKE_"):
        bpy.data.materials.remove(m)
for img in (alb_raw, mr_raw, ao_raw, nrm_img):
    bpy.data.images.remove(img)

# ------------------------------------------------------- report + export ---
me.calc_loop_triangles()
vs = [v.co for v in me.vertices]
zone = np.empty(len(me.loops) * 4, np.float32)
me.color_attributes["Zones"].data.foreach_get("color", zone)
zone = zone.reshape(-1, 4)
print("TRIS", len(me.loop_triangles))
print("BLENDER_BBOX x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % (
    min(v.x for v in vs), max(v.x for v in vs), min(v.y for v in vs), max(v.y for v in vs),
    min(v.z for v in vs), max(v.z for v in vs)))
print("ZONE corners R %.1f%% G %.1f%% B %.1f%%" % tuple(100 * (zone[:, i] > 0.5).mean() for i in range(3)))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
activate(ob)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, use_selection=True,
                          export_yup=True, export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                          export_tangents=False)
print("wrote", OUT)
bpy.context.preferences.filepaths.save_version = 0   # no probe.blend1 backup
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, compress=True)
print("wrote", OUT_BLEND)
