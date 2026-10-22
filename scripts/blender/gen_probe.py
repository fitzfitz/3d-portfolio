# Project probe: a Voyager-style deep-space probe (original work, 100% procedural).
#   $BLENDER --background --python scripts/blender/gen_probe.py [-- --out DIR]
# Output: assets-src/probe.glb (raw; optimized by npm run assets:optimize)
#         assets-src/probe.blend (the baked original, for look-dev)
#
# Every vertex and texel is generated below (seeded). The layout follows the
# Voyager family only in kind (no drawing or plaque is copied):
#   - a white high-gain dish built as hardware: a panelled reflector (seams,
#     rivet rows, per-panel tone and gloss), a rim ring painted in the
#     project stripe, 12 tapered back ribs and a hoop, a feed horn with a
#     choke ring, a subreflector on three struts with foot pads and rim
#     clamps, and a twin-eye sun sensor on the reflector;
#   - a ten-bay bus: crinkled amber Kapton, silver and black MLI blankets
#     with taped seams and tie buttons, two radiator bays with louvre
#     blades, bolted bay frames and a painted aft band;
#   - the gold plate (a record cover with an original seeded engraving) in a
#     bolted bezel on a painted mounting panel;
#   - an RTG boom (truss and harness) with three eight-finned generators; a
#     science boom (truss, harness, a plasma cup, a particle detector and a
#     cosmic-ray box) to a scan platform with two cameras, an infrared
#     telescope, a photopolarimeter and a UV spectrometer; a lattice
#     magnetometer boom with two sensors; two long radio-antenna whips;
#   - an aft deck with a silver tank cover, a main engine bell and four
#     three-nozzle thruster clusters.
# No add-ons: bmesh and Cycles bakes only.
#
# Texel budget. Repeated parts share one UV island (every truss rod with its
# first rod, every RTG fin with the first fin, every nozzle, louvre blade
# and dish rib with its first), so the atlas goes to the blankets, frames
# and dish. A second, bake-only UV set ("pat", with "psz" the face's size
# and "pid" a per-face random) lays tape, tie buttons, bolt rows and
# fold directions out in each face's own units; it is removed before export.
#
# CONTRACT with ProjectProbes.tsx and tests/assetContracts.test.ts (glTF
# space, +Y up, drawn at scale 1):
#   one node "Probe", one mesh, one primitive, one material "ProbeBaked"
#     (baseColor 1024 + metallicRoughness 512 + normal 1536 maps, no
#     extensions, so three builds a MeshStandardMaterial); no tangents.
#   COLOR_0 is the zone mask, per vertex, each channel 0 or 1:
#     R = the painted project stripe: the dish's rim ring, the bus's aft
#         band and the face of the plate's mounting panel. Satin paint with
#         chipped edges, authored light neutral grey (~0.7 linear, no hue)
#         so the game's multiply reads as paint: base x toned colour, where
#         toned = the project colour pulled 60% toward its own Rec. 709
#         luminance (see turntable_probe.py toned()). The R zone must not emit;
#     G = the two beacon lamps (on the subreflector, under the aft deck);
#     B = the nozzle throats: the main engine bell on the aft axis (its exit
#         at glTF z ~ -0.40, under ProjectProbes' plume) and the twelve RCS
#         bells (a hook for the thruster puff and the relocation burn).
#   the dish faces +Z (boresight); the origin is on the dish axis at the
#     bus's forward deck; the longest extent is 3.0 (the magnetometer boom
#     runs out along +X/+Y), <= 6000 triangles.
#
# Seeded throughout: re-running reproduces assets-src/probe.glb byte for byte
# (verified 2026-10-20 and again for v7 on 2026-10-22; Blender's UV packer,
# which makes cargo_ship.glb vary, is stable on this mesh).
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
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
# `-- --out DIR` writes probe.glb/.blend there instead (look-dev rounds that
# must not touch assets-src/ until the look is signed off)
OUT_DIR = ARGV[ARGV.index("--out") + 1] if "--out" in ARGV else os.path.join(ROOT, "assets-src")
OUT = os.path.join(OUT_DIR, "probe.glb")
OUT_BLEND = os.path.join(OUT_DIR, "probe.blend")
TEX = 1024             # shipped albedo map
NTEX = 1536            # shipped normal map: the blanket crinkle, seams and bolts live here
                       # (NPOT is fine: three r185 is WebGL2-only; 2048 broke the 600 KB budget)
BAKE = 2 * TEX         # albedo, metal/roughness and AO bake 2x and are box-filtered down
NBAKE = 2 * NTEX       # the normal map likewise
LONGEST = 3.0
PLATE_UV_SIDE = 0.22   # target width of the plate's UV island (fraction of the atlas)
# Texel density per part, relative to smart-project's uniform one. The
# dish's back is near-uniform white paint; the blankets (crinkle, tape,
# ties), the bolted frames and the painted trim (edge wear) need the texels.
UV_DENSITY = {"reflector": 0.85, "paint": 0.42, "foil": 2.8, "silver": 2.6, "tank": 1.2, "foil_dark": 2.0,
              "cap": 0.8, "deck": 0.15, "fiber": 0.5, "fin": 0.9, "trim": 0.75, "metal": 0.7, "bezel": 2.4,
              "nozzle": 1.0, "throat": 0.8, "lamp": 0.6, "black": 0.9, "frame": 1.6, "louvre": 1.2}
MR_TEX = 512           # the packed metal/roughness map ships at a quarter of the bake

bpy.ops.wm.read_factory_settings(use_empty=True)
SCENE = bpy.context.scene

# part -> zone (R, G, B). Parts are also the bake materials.
PARTS = {
    "foil": (0, 0, 0),        # amber Kapton MLI blanket
    "silver": (0, 0, 0),      # aluminised MLI blanket
    "tank": (0, 0, 0),        # the same over the aft tank dome (own texel density)
    "foil_dark": (0, 0, 0),   # black (carbon-loaded) Kapton blanket
    "cap": (0, 0, 0),         # black blanket over the aft deck (own texel density)
    "deck": (0, 0, 0),        # the forward deck, hidden under the dish's hub
    "frame": (0, 0, 0),       # anodised bus frame, radiators, instrument boxes (bolted)
    "louvre": (0, 0, 0),      # polished louvre blades
    "paint": (0, 0, 0),       # white paint: the dish's back and the subreflector
    "reflector": (0, 0, 0),   # the dish's concave face: same paint, own texel density
    "trim": (1, 0, 0),        # the project stripe: tinted per instance
    "lamp": (0, 1, 0),        # beacon lamp lens: blinked per instance
    "metal": (0, 0, 0),       # brushed aluminium
    "bezel": (0, 0, 0),       # the plate's bolted bezel
    "fin": (0, 0, 0),         # RTG casing and fins
    "gold": (0, 0, 0),        # the plate
    "nozzle": (0, 0, 0),      # thruster and engine bells
    "throat": (0, 0, 1),      # inside the bells
    "fiber": (0, 0, 0),       # magnetometer boom lattice
    "black": (0, 0, 0),       # instrument housings, lenses, harness
}
PART_IDS = {k: i for i, k in enumerate(PARTS)}
K_PLATE_FACE = 1

bm = bmesh.new()
L_PART = bm.faces.layers.int.new("part")
L_KIND = bm.faces.layers.int.new("kind")
L_SHG = bm.faces.layers.int.new("shg")    # shared-UV group (0 = own island)
L_SHI = bm.faces.layers.int.new("shi")    # instance within the group (0 = the master)
L_SHK = bm.faces.layers.int.new("shk")    # face ordinal within the instance
L_UV = bm.loops.layers.uv.new("UVMap")    # the shipped UVs (smart-projected below)
L_PAT = bm.loops.layers.uv.new("pat")     # bake-only: face-local position (design units)
L_PSZ = bm.loops.layers.uv.new("psz")     # bake-only: the face's size in "pat"
L_PID = bm.loops.layers.uv.new("pid")     # bake-only: a per-face random pair
PAT = {}                                   # face -> ({vert: (u, v)}, (w, h)) for explicit layouts

Z = Vector((0, 0, 1))


# ------------------------------------------------------------ primitives ---
# Built in glTF space (+Y up, dish boresight +Z), rotated into Blender at the end.
def rot_to(d):
    return Z.rotation_difference(Vector(d).normalized()).to_matrix().to_4x4()


def place(origin, direction, spin=0.0):
    """Local frame: local +Z along `direction`, at `origin`, turned `spin` about it."""
    return Matrix.Translation(Vector(origin)) @ rot_to(direction) @ Matrix.Rotation(spin, 4, "Z")


SHARE_IDS, SHARE_COUNT = {}, {}
_share = None


class shared:
    """Faces made inside share the UVs of the group's first instance (made
    in the same order, so face k of every instance maps onto face k of the
    first). For repeated small parts whose texels would only repeat."""

    def __init__(self, group):
        self.group = group

    def __enter__(self):
        global _share
        gid = SHARE_IDS.setdefault(self.group, len(SHARE_IDS) + 1)
        inst = SHARE_COUNT.get(self.group, 0)
        SHARE_COUNT[self.group] = inst + 1
        _share = [gid, inst, 0]

    def __exit__(self, *exc):
        global _share
        _share = None


def face(verts, part, kind=0):
    f = bm.faces.new(verts)
    f[L_PART] = PART_IDS[part]
    f[L_KIND] = kind
    if _share is not None:
        f[L_SHG], f[L_SHI], f[L_SHK] = _share[0], _share[1], _share[2]
        _share[2] += 1
    return f


def orient(faces):
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def lathe(profile, seg, M, parts, closed=False, caps=True, phase=0.0):
    """Revolve (r, z) points about local Z. `parts` is one part or one per
    segment (len(profile) - 1, or len(profile) when the profile is a closed
    loop). r == 0 makes a pole; open ends get a flat cap of the end's part.
    Its pattern UVs run round (arc length) and along (profile length)."""
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
    s = [0.0]
    for k in range(1, n + (1 if closed else 0)):
        (r0, z0), (r1, z1) = profile[k - 1], profile[k % n]
        s.append(s[-1] + math.hypot(r1 - r0, z1 - z0))
    rmax = max(r for r, _ in profile)
    circ = 2 * math.pi * rmax

    def uv(k, i):
        return (2 * math.pi * profile[k % n][0] * i / seg, s[k])

    faces = []
    for k in range(nseg):
        a, b = rings[k], rings[(k + 1) % n]
        for i in range(seg):
            j = (i + 1) % seg
            if len(a) == 1:
                f = face((a[0], b[i], b[j]), parts[k])
                m = {a[0]: (2 * math.pi * profile[(k + 1) % n][0] * (i + 0.5) / seg, s[k]),
                     b[i]: uv(k + 1, i), b[j]: uv(k + 1, i + 1)}
            elif len(b) == 1:
                f = face((a[i], a[j], b[0]), parts[k])
                m = {a[i]: uv(k, i), a[j]: uv(k, i + 1),
                     b[0]: (2 * math.pi * profile[k][0] * (i + 0.5) / seg, s[k + 1])}
            else:
                f = face((a[i], a[j], b[j], b[i]), parts[k])
                m = {a[i]: uv(k, i), a[j]: uv(k, i + 1), b[j]: uv(k + 1, i + 1), b[i]: uv(k + 1, i)}
            PAT[f] = (m, (circ, s[nseg]))
            faces.append(f)
    if caps and not closed:
        for end, part in ((rings[0], parts[0]), (rings[-1], parts[-1])):
            if len(end) > 1:
                faces.append(face(end, part))     # planar: laid out by pat_auto
    orient(faces)
    return faces


def cylinder(p0, p1, r, seg, part, cap_parts=None, spin=0.0, caps=True):
    d = Vector(p1) - Vector(p0)
    f = lathe([(r, 0.0), (r, d.length)], seg, place(p0, d, spin), part, caps=caps)
    if cap_parts:
        f[-2][L_PART] = PART_IDS[cap_parts[0]]
        f[-1][L_PART] = PART_IDS[cap_parts[1]]
    return f


def rod(p0, p1, r, part, sides=3, caps=False):
    """A strut. Uncapped by default: its ends sit inside a joint or a part.
    Every rod of a part and side count shares the first one's UVs."""
    with shared(f"rod_{part}_{sides}_{int(caps)}"):
        return cylinder(p0, p1, r, sides, part, caps=caps)


def box(M, size, part, skip=()):
    """A box; `skip` drops faces by index (0/1 = -x/+x, 2/3 = -y/+y... see
    quads) where they would be buried in another part."""
    hx, hy, hz = (s / 2 for s in size)
    v = [bm.verts.new(M @ Vector((sx * hx, sy * hy, sz * hz)))
         for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    quads = ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3))
    faces = [face([v[k] for k in q], part) for i, q in enumerate(quads) if i not in skip]
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
SEG_DISH = 36           # 48 in v6: the rim's chord error at 36 is ~0.003, under a pixel at any range


def dish_z(r):
    return DISH_Z0 + r * r / (4 * FOCAL)


def dish_back(r):
    return dish_z(r) - SHELL - 0.012 * (1 - r / DISH_R)


def dish_normal(u, r):
    """Unit normal of the concave face at radius r along the unit radial u."""
    return (Vector((0, 0, 1)) - u * (r / (2 * FOCAL))).normalized()


RIM_Z = dish_z(DISH_R)
LIP_R = DISH_R + 0.030          # outer face of the rim ring
FOOT_R = 0.60
# one closed profile: reflector face (centre -> rim; a ring at the strut
# feet so the pads sit on it), the rim ring (a lip standing proud of the
# reflector, a deep outer face, a flange underneath: all painted in the
# project stripe so the probe's colour reads from any side), the back face
# (rim -> centre) and the hub bore closing the loop
front = [0.075, 0.33, FOOT_R, 0.785]
prof = [(r, dish_z(r)) for r in front]
prof += [(DISH_R, RIM_Z + 0.016), (LIP_R, RIM_Z + 0.016), (LIP_R, RIM_Z - 0.052), (DISH_R - 0.012, RIM_Z - 0.062)]
prof += [(r, dish_back(r)) for r in (0.68, 0.46, 0.25, 0.075)]
# segments: 3 reflector; lip inner face, lip top, outer face, flange (the
# stripe); 4 back; the hub bore closing the loop
parts = ["reflector"] * 3 + ["trim"] * 4 + ["paint"] * 4 + ["metal"]
assert len(parts) == len(prof)
lathe(prof, SEG_DISH, Matrix(), parts, closed=True)

# back structure: 12 tapered radial ribs (I-beam section: narrow web at the
# shell, wider flange below) and a hoop ring tying them at mid-radius
for k in range(12):
    a = 2 * math.pi * (k + 0.5) / 12
    u = Vector((math.cos(a), math.sin(a), 0))
    t = Vector((-math.sin(a), math.cos(a), 0))
    rs = (0.10, 0.30, 0.52, 0.775)
    deep = (0.058, 0.050, 0.040, 0.030)
    top = [u * r + Vector((0, 0, dish_back(r) + 0.004)) for r in rs]
    bot = [p - Vector((0, 0, dd)) for p, dd in zip(top, deep)]
    with shared("rib"):
        vs = [[bm.verts.new(p + s_ * t * 0.004) for s_ in (-1, 1)] for p in top]
        vb = [[bm.verts.new(p + s_ * t * 0.011) for s_ in (-1, 1)] for p in bot]
        fs = []
        for i in range(3):
            fs.append(face((vs[i][0], vs[i + 1][0], vb[i + 1][0], vb[i][0]), "metal"))
            fs.append(face((vs[i][1], vb[i][1], vb[i + 1][1], vs[i + 1][1]), "metal"))
            fs.append(face((vb[i][0], vb[i + 1][0], vb[i + 1][1], vb[i][1]), "metal"))
        fs.append(face((vs[0][0], vb[0][0], vb[0][1], vs[0][1]), "metal"))
        fs.append(face((vs[3][0], vs[3][1], vb[3][1], vb[3][0]), "metal"))
    orient(fs)
HOOP = (0.47, 0.495)
lathe([(HOOP[0], dish_back(HOOP[0]) + 0.003), (HOOP[0], dish_back(HOOP[0]) - 0.034),
       (HOOP[1], dish_back(HOOP[1]) - 0.034), (HOOP[1], dish_back(HOOP[1]) + 0.003)],
      24, Matrix(), "metal", caps=False, phase=math.pi / 24)

# feed horn at the vertex: a base flange, a conical horn and a choke ring
# round its aperture, dark inside
FH = DISH_Z0
lathe([(0.088, FH - 0.012), (0.088, FH + 0.012), (0.058, FH + 0.014), (0.050, FH + 0.096),
       (0.063, FH + 0.098), (0.063, FH + 0.114), (0.046, FH + 0.120), (0.0, FH + 0.098)],
      12, Matrix(), ["metal"] * 6 + ["black"], caps=False)
# subreflector near the focus: a convex face toward the dish, a machined rim,
# a domed back; held by three struts on foot pads
SUB_Z = DISH_Z0 + FOCAL * 0.86
SUB_R = 0.122
lathe([(0.0, SUB_Z - 0.018), (0.05, SUB_Z - 0.011), (0.10, SUB_Z + 0.004), (SUB_R, SUB_Z + 0.012),
       (SUB_R, SUB_Z + 0.024), (0.095, SUB_Z + 0.031), (0.055, SUB_Z + 0.038), (0.03, SUB_Z + 0.040)],
      18, Matrix(), ["paint", "paint", "paint", "metal", "paint", "paint", "paint"], caps=False)
for k in range(3):
    a = math.pi / 2 + 2 * math.pi * k / 3
    u = Vector((math.cos(a), math.sin(a), 0))
    n = dish_normal(u, FOOT_R)
    foot = u * FOOT_R + Vector((0, 0, dish_z(FOOT_R))) + n * 0.006
    with shared("foot"):
        box(place(foot, n, a), (0.05, 0.034, 0.012), "metal")                 # foot pad
    head = u * (SUB_R - 0.012) + Vector((0, 0, SUB_Z + 0.018))
    rod(foot + n * 0.004, head, 0.011, "metal", sides=6)
    with shared("clamp"):
        box(place(head + u * 0.012, u, 0.0), (0.03, 0.026, 0.02), "metal")    # clamp on the rim
# beacon lamp 1 on the subreflector's back
LAMP_R = 0.042
lathe([(0.03, SUB_Z + 0.040), (0.03, SUB_Z + 0.06)], 8, Matrix(), "metal", caps=False)
lathe([(LAMP_R, SUB_Z + 0.06), (LAMP_R, SUB_Z + 0.075), (LAMP_R * 0.8, SUB_Z + 0.098),
       (LAMP_R * 0.42, SUB_Z + 0.112), (0.0, SUB_Z + 0.116)], 10, Matrix(), "lamp")

# sun sensor: a small housing on the reflector near the rim, two dark eyes
# looking down the boresight
a_ss = math.radians(200)
u_ss = Vector((math.cos(a_ss), math.sin(a_ss), 0))
n_ss = dish_normal(u_ss, 0.70)
p_ss = u_ss * 0.70 + Vector((0, 0, dish_z(0.70)))
M_ss = place(p_ss + n_ss * 0.014, n_ss, a_ss)
box(M_ss, (0.05, 0.034, 0.028), "frame", skip=(4,))
for dx in (-0.011, 0.011):
    box(M_ss @ Matrix.Translation((dx, 0, 0.016)), (0.014, 0.014, 0.006), "black", skip=(4,))

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
caps = [face(list(reversed(top_ring)), "deck"), face(bot_ring, "cap")]
orient(sides + caps)
# bays: a recessed blanket inside a bolted anodised frame
res = bmesh.ops.inset_individual(bm, faces=sides, thickness=0.018, depth=-0.007, use_even_offset=True)
for f in res["faces"]:
    f[L_PART] = PART_IDS["frame"]
# amber Kapton on most bays; black on the plate's bay and on bay 8 (the
# antenna base); one silver bay; two radiator bays (frame-coloured)
# carrying louvres
BAY_PART = {0: "foil_dark", 1: "foil", 2: "foil", 3: "frame", 4: "foil", 5: "frame",
            6: "foil", 7: "silver", 8: "foil_dark", 9: "foil"}
for k, f in enumerate(sides):
    f[L_PART] = PART_IDS[BAY_PART[k]]
    # pattern: u round the bus (tangent), v up the bus axis, from the corner
    a = BAY_ANG[k]
    t = Vector((-math.sin(a), math.cos(a), 0))
    o = min((v.co for v in f.verts), key=lambda c: (round(c.z, 6), c.dot(t)))
    m = {v: ((v.co - o).dot(t), v.co.z - o.z) for v in f.verts}
    us, vs_ = [p[0] for p in m.values()], [p[1] for p in m.values()]
    m = {v: (p[0] - min(us), p[1] - min(vs_)) for v, p in m.items()}
    PAT[f] = (m, (max(us) - min(us), max(vs_) - min(vs_)))
# the aft cap: the blanket's tie grid, no taped edges (psz far beyond the cap)
PAT[caps[1]] = ({v: (v.co.x + 5.0, v.co.y + 5.0) for v in caps[1].verts}, (10.0, 10.0))


def bay_frame(k, out=0.0, z=BAY_Z):
    """Frame on bay k's face, `out` beyond it: local +Z points out of the bay."""
    a = BAY_ANG[k]
    n = Vector((math.cos(a), math.sin(a), 0))
    return Matrix.Translation(n * (APO + out) + Vector((0, 0, z))) @ rot_to(n)


# radiator louvres on bays 3 and 5: a base plate, two side rails and eight
# polished blades, each blade one quad turned 22 deg off the bay (they show
# the dark radiator between them)
LOUV_Z = -0.112
for kb in (3, 5):
    a = BAY_ANG[kb]
    n = Vector((math.cos(a), math.sin(a), 0))
    t = Vector((-math.sin(a), math.cos(a), 0))
    base = n * (APO - 0.004) + Vector((0, 0, LOUV_Z))
    box(frame_m(base, t, Vector((0, 0, 1)), n), (0.19, 0.17, 0.008), "frame", skip=(4,))
    for s_ in (-1, 1):
        with shared("louvre_rail"):
            box(frame_m(base + t * s_ * 0.0885 + n * 0.012, t, Vector((0, 0, 1)), n), (0.013, 0.17, 0.018),
                "frame", skip=(4,))
    for i in range(8):
        zc = LOUV_Z - 0.0735 + i * 0.021
        c = base + n * 0.012 + Vector((0, 0, zc - LOUV_Z))
        M = frame_m(c, t, Vector((0, 0, 1)), n) @ Matrix.Rotation(math.radians(-22), 4, "X")
        hw, hh = 0.082, 0.0105
        with shared("blade"):
            q = [bm.verts.new(M @ Vector(p)) for p in ((-hw, -hh, 0), (hw, -hh, 0), (hw, hh, 0), (-hw, hh, 0))]
            face(q, "louvre")                 # wound so its normal is the bay's (t x z = n)

# aft trim band (the painted project stripe): a decagonal collar round the
# bus's aft edge, painted over the frame; taller than v6's so it reads at range
BAND_TOP = BUS_BOT + 0.072
band = []
for zr in ((BAND_TOP, BUS_R + 0.008), (BUS_BOT - 0.004, BUS_R + 0.008)):
    band.append([bm.verts.new((zr[1] * math.cos(a), zr[1] * math.sin(a), zr[0])) for a in VERT_ANG])
inner = [[bm.verts.new((BUS_R * 0.97 * math.cos(a), BUS_R * 0.97 * math.sin(a), z)) for a in VERT_ANG]
         for z in (BAND_TOP, BUS_BOT - 0.004)]
fs = []
for k in range(10):
    j = (k + 1) % 10
    fs.append(face((band[0][k], band[0][j], band[1][j], band[1][k]), "trim"))
    fs.append(face((inner[0][k], band[0][k], band[0][j], inner[0][j]), "trim"))
    fs.append(face((inner[1][k], inner[1][j], band[1][j], band[1][k]), "trim"))
orient(fs)

# the dish's mount: a hub adapter and six struts from the deck to the shell
cylinder((0, 0, BUS_TOP), (0, 0, dish_back(0.13) + 0.003), 0.13, 12, "metal")
for k in range(6):
    a = VERT_ANG[0] + 2 * math.pi * k / 6
    rod((BUS_R * 0.92 * math.cos(a), BUS_R * 0.92 * math.sin(a), BUS_TOP),
        (0.36 * math.cos(a + 0.25), 0.36 * math.sin(a + 0.25), dish_back(0.36) + 0.002),
        0.011, "metal", sides=6)

# --------------------------------------------------------- the aft deck ---
# a silver blanket over the propellant tank, the main engine bell on the
# axis (its throat is the B zone ProjectProbes lights for the burn), the
# second beacon off to one side, and four three-nozzle RCS clusters
TANK_R = 0.17
lathe([(TANK_R, BUS_BOT), (TANK_R, BUS_BOT - 0.026), (0.125, BUS_BOT - 0.048), (0.062, BUS_BOT - 0.058)],
      12, Matrix(), "tank", caps=False)
ENG_EXIT = -0.408
lathe([(0.062, BUS_BOT - 0.058), (0.040, BUS_BOT - 0.066), (0.030, BUS_BOT - 0.072),
       (0.052, -0.375), (0.078, ENG_EXIT), (0.071, ENG_EXIT), (0.047, -0.378), (0.020, BUS_BOT - 0.076),
       (0.0, BUS_BOT - 0.072)],
      12, Matrix(), ["metal", "metal", "nozzle", "nozzle", "nozzle", "throat", "throat", "throat"], caps=False)
# beacon lamp 2, under the deck by the plate's bay
LAMP2 = Vector((0.27, 0.0, BUS_BOT))
lathe([(0.024, 0.002), (0.024, -0.02)], 8, Matrix.Translation(LAMP2), "metal", caps=False)
lathe([(LAMP_R * 0.85, -0.02), (LAMP_R * 0.85, -0.033), (LAMP_R * 0.68, -0.052), (LAMP_R * 0.36, -0.064),
       (0.0, -0.067)], 10, Matrix.Translation(LAMP2), "lamp")


def nozzle(base, direction, r=0.026):
    """A bell: brushed outside, sooty throat (B zone) inside, its root in the
    block. All share the first bell's UVs."""
    M = place(base, direction)
    prof = [(0.011, -0.004), (r * 0.62, 0.022), (r, 0.050), (r * 0.82, 0.050), (0.0, 0.018)]
    with shared("bell"):
        lathe(prof, 6, M, ["nozzle", "nozzle", "nozzle", "throat"], caps=False)


for k in range(4):
    a = math.radians(45 + 90 * k)
    c = Vector((math.cos(a) * 0.30, math.sin(a) * 0.30, BUS_BOT - 0.022))
    out = Vector((math.cos(a), math.sin(a), 0))
    tan = Vector((-math.sin(a), math.cos(a), 0))
    with shared("rcs_block"):
        box(frame_m(c, tan, out, Vector((0, 0, 1))), (0.10, 0.06, 0.044), "frame", skip=(5,))
    nozzle(c + Vector((0, 0, -0.022)), Vector((0, 0, -1)) + out * 0.25)       # aft, canted out
    nozzle(c + tan * 0.05, tan)                                               # roll pair
    nozzle(c - tan * 0.05, -tan)
    # its feed line across the deck to the tank
    a_c = a + 0.11
    rod(Vector((0.272 * math.cos(a_c), 0.272 * math.sin(a_c), BUS_BOT - 0.004)),
        Vector(((TANK_R - 0.004) * math.cos(a_c), (TANK_R - 0.004) * math.sin(a_c), BUS_BOT - 0.004)),
        0.0055, "black")

# ------------------------------------------------------------- the plate ---
PLATE_R = 0.088
pf = bay_frame(0)
# the mounting panel: its face is painted in the project stripe (trim), its
# edges are bare frame; a machined bolted bezel holds the gold record cover.
# local +Z = out of the bay (+X)
mount = box(pf @ Matrix.Translation((0, 0, 0.006)), (0.205, 0.205, 0.012), "frame", skip=(4,))
for f in mount:
    if f.calc_center_median().x > (pf @ Vector((0, 0, 0.0115))).x:
        f[L_PART] = PART_IDS["trim"]
lathe([(PLATE_R, 0.012), (PLATE_R + 0.013, 0.012), (PLATE_R + 0.013, 0.024), (PLATE_R + 0.004, 0.027),
       (PLATE_R, 0.024)], 24, pf, "bezel", closed=True)
disc = lathe([(PLATE_R - 0.001, 0.012), (PLATE_R - 0.001, 0.021)], 24, pf, "gold")
disc[-1][L_KIND] = K_PLATE_FACE          # the outer cap (z = 0.021) carries the engraving
PLATE_C = pf @ Vector((0, 0, 0.021))
BEZEL_C = pf @ Vector((0, 0, 0.0))

# ------------------------------------------------------------- the booms ---
TILT = math.radians(5)


def boom_dir(a, tilt=TILT):
    return Vector((math.cos(a) * math.cos(tilt), math.sin(a) * math.cos(tilt), -math.sin(tilt)))


def along(a, r, tilt=TILT, z=BAY_Z):
    return Vector((0, 0, z)) + boom_dir(a, tilt) * r


# RTG boom, bay 6 (216 deg): a truss (its harness running inside) out to
# three generators in a row, each a finned casing between flanges
A_RTG = BAY_ANG[6]
d_rtg = boom_dir(A_RTG)
box(bay_frame(6, 0.012), (0.09, 0.09, 0.024), "frame", skip=(4,))
truss(along(A_RTG, APO + 0.02), along(A_RTG, 0.80), 0.075, 5, "metal", 0.0075)
rod(along(A_RTG, APO + 0.02), along(A_RTG, 0.80), 0.0065, "black")              # harness
for i in range(3):
    r0 = 0.80 + i * 0.178
    p0, p1 = along(A_RTG, r0 + 0.012), along(A_RTG, r0 + 0.168)
    with shared("rtg_flange"):
        cylinder(along(A_RTG, r0), along(A_RTG, r0 + 0.012), 0.062, 12, "metal")
    with shared("rtg_body"):
        cylinder(p0, p1, 0.046, 10, "fin")
    M = place(p0, d_rtg)
    for k in range(8):
        Mf = M @ Matrix.Rotation(2 * math.pi * k / 8 + 0.3, 4, "Z") @ Matrix.Translation((0.082, 0, 0.078))
        with shared("rtg_fin"):
            box(Mf, (0.074, 0.006, 0.15), "fin", skip=(0,))
with shared("rtg_flange"):
    cylinder(along(A_RTG, 0.80 + 3 * 0.178 - 0.01), along(A_RTG, 0.80 + 3 * 0.178 + 0.002), 0.062, 12, "metal")

# science boom, bay 4 (144 deg): truss to the scan platform; a plasma cup,
# the cosmic-ray box and a particle detector ride along it
A_SCI = BAY_ANG[4]
d_sci = boom_dir(A_SCI)
box(bay_frame(4, 0.012), (0.09, 0.09, 0.024), "frame", skip=(4,))
truss(along(A_SCI, APO + 0.02), along(A_SCI, 0.86), 0.07, 3, "metal", 0.007)
rod(along(A_SCI, APO + 0.02), along(A_SCI, 0.86), 0.006, "black")              # harness
side_sci = d_sci.cross(Z).normalized()
box(place(along(A_SCI, 0.58), d_sci) @ Matrix.Translation((0, 0.05, 0)), (0.07, 0.05, 0.09), "foil")   # cosmic rays
# plasma cup: a box with a cone opening toward the boresight
pls = along(A_SCI, 0.47) + Vector((0, 0, 0.065))
box(frame_m(pls, side_sci, d_sci, Z), (0.05, 0.05, 0.04), "frame")
lathe([(0.012, 0.0), (0.03, 0.034)], 10, place(pls + Z * 0.02, Z), "metal", caps=False)
lathe([(0.0, 0.004), (0.012, 0.0)], 10, place(pls + Z * 0.02, Z), "black", caps=False)
# low-energy particle detector: a drum on a stepper, its dark sensor head out to the side
lec = along(A_SCI, 0.70) - Vector((0, 0, 0.06))
box(frame_m(lec, side_sci, d_sci, Z), (0.045, 0.045, 0.03), "frame")
cylinder(lec - Z * 0.015, lec - Z * 0.07, 0.03, 10, "metal", cap_parts=("metal", "black"))
# the scan platform and its instruments, looking down the boresight-ish
plat = along(A_SCI, 0.93)
Mp = place(plat, d_sci)
box(Mp, (0.16, 0.14, 0.13), "foil_dark")
box(Mp @ Matrix.Translation((0, 0, 0.068)), (0.12, 0.10, 0.008), "frame")
cam_dir = Vector((0.15, 0.1, 1.0)).normalized()
for off, r, ln in (((0.035, 0.0), 0.03, 0.22), ((-0.045, 0.02), 0.024, 0.12)):   # narrow and wide cameras
    base = plat + Vector((off[0], off[1], 0.06))
    tip = base + cam_dir * ln
    cylinder(base, tip, r, 10, "metal", cap_parts=("metal", "black"))
    cylinder(tip, tip + cam_dir * 0.03, r * 1.25, 10, "black")   # sunshade
# infrared telescope: the biggest drum on the platform, gold-blanketed, its
# aperture dark behind a white sunshade ring
iris = plat + side_sci * 0.15
cylinder(iris, iris + cam_dir * 0.15, 0.062, 12, "foil", cap_parts=("foil", "black"))
lathe([(0.062, 0.15), (0.072, 0.15), (0.072, 0.175), (0.066, 0.175)], 12, place(iris, cam_dir), "paint", caps=False)
box(frame_m(iris - side_sci * 0.06, side_sci, d_sci.cross(side_sci), d_sci), (0.04, 0.04, 0.05), "frame")
# photopolarimeter and UV spectrometer
pps = plat - side_sci * 0.09 + Vector((0, 0, 0.03))
cylinder(pps, pps + cam_dir * 0.09, 0.017, 8, "metal", cap_parts=("metal", "black"))
uvs = plat + Vector((0.01, -0.06, 0.07))
box(frame_m(uvs + cam_dir * 0.05, cam_dir.cross(side_sci).normalized(), side_sci, cam_dir), (0.035, 0.035, 0.1), "frame")

# magnetometer boom, bay 1 (36 deg): deployment canister, then a long lattice
# with a sensor half way and one at the tip
A_MAG = BAY_ANG[1]
MAG_TILT = math.radians(3)
d_mag = boom_dir(A_MAG, MAG_TILT)
box(bay_frame(1, 0.012), (0.1, 0.1, 0.024), "frame", skip=(4,))
cylinder(along(A_MAG, APO + 0.02, MAG_TILT), along(A_MAG, APO + 0.15, MAG_TILT), 0.052, 12, "metal",
         cap_parts=("metal", "frame"))
MAG_END = 2.36
truss(along(A_MAG, APO + 0.15, MAG_TILT), along(A_MAG, MAG_END - 0.10, MAG_TILT), 0.05, 10, "fiber", 0.0055,
      twist=0.4)
cylinder(along(A_MAG, 1.38, MAG_TILT), along(A_MAG, 1.46, MAG_TILT), 0.034, 10, "metal")
cylinder(along(A_MAG, MAG_END - 0.10, MAG_TILT), along(A_MAG, MAG_END, MAG_TILT), 0.042, 12, "metal",
         cap_parts=("metal", "black"))

# radio antennas: two long whips in a wide V off a base box low on bay 8,
# swept aft
pra = bay_frame(8, 0.02, BUS_BOT + 0.03)
box(pra, (0.06, 0.05, 0.04), "frame", skip=(4,))
p_pra = pra @ Vector((0, 0, 0.02))
for a_w in (math.radians(250), math.radians(322)):
    d_w = Vector((math.cos(a_w), math.sin(a_w), -0.36)).normalized()
    rod(p_pra, p_pra + d_w * 1.22, 0.0042, "metal", caps=True)

# --------------------------------------------- into Blender space + scale ---
bm.verts.ensure_lookup_table()
xs = [v.co for v in bm.verts]
ext = [max(c[i] for c in xs) - min(c[i] for c in xs) for i in range(3)]
S = LONGEST / max(ext)


# pattern UVs (design units): explicit layouts first, every other face in
# its own plane from its longest edge
def pat_auto(f):
    f.normal_update()
    ls = list(f.loops)
    e = max(ls, key=lambda lp: (lp.link_loop_next.vert.co - lp.vert.co).length)
    o = e.vert.co.copy()
    eu = (e.link_loop_next.vert.co - o).normalized()
    ev = f.normal.cross(eu).normalized()
    m = {lp.vert: ((lp.vert.co - o).dot(eu), (lp.vert.co - o).dot(ev)) for lp in ls}
    us, vs_ = [p[0] for p in m.values()], [p[1] for p in m.values()]
    m = {v: (p[0] - min(us), p[1] - min(vs_)) for v, p in m.items()}
    return m, (max(us) - min(us), max(vs_) - min(vs_))


prng = np.random.default_rng(SEED + 7)
bm.faces.ensure_lookup_table()
for f_ in bm.faces:
    m_, sz = PAT[f_] if f_ in PAT else pat_auto(f_)
    pid = prng.random(2)
    for lp in f_.loops:
        lp[L_PAT].uv = m_[lp.vert]
        lp[L_PSZ].uv = sz
        lp[L_PID].uv = (float(pid[0]), float(pid[1]))
PAT.clear()

bmesh.ops.transform(bm, matrix=Matrix.Rotation(math.radians(90), 4, "X") @ Matrix.Scale(S, 4), verts=bm.verts)
bm.normal_update()
TO_BL = Matrix.Rotation(math.radians(90), 4, "X") @ Matrix.Scale(S, 4)
plate_c = TO_BL @ PLATE_C
bezel_c = TO_BL @ BEZEL_C
tris = sum(len(f.verts) - 2 for f in bm.faces)
by_part = {}
for f_ in bm.faces:
    k_ = list(PARTS)[f_[L_PART]]
    by_part[k_] = by_part.get(k_, 0) + len(f_.verts) - 2
print("probe: triangles by part", dict(sorted(by_part.items(), key=lambda kv: -kv[1])))
print(f"probe: scale={S:.4f} glTF extent=({ext[0] * S:.3f}, {ext[1] * S:.3f}, {ext[2] * S:.3f}) triangles={tris}")
print("probe: shared-UV groups", {g: SHARE_COUNT[g] for g in SHARE_IDS})

# ------------------------------------------------------ mesh + zone mask ---
me = bpy.data.meshes.new("Probe")
bm.to_mesh(me)
bm.free()
ob = bpy.data.objects.new("Probe", me)
SCENE.collection.objects.link(ob)


def face_attr(name):
    a = np.zeros(len(me.polygons), np.int32)
    me.attributes[name].data.foreach_get("value", a)
    return a


part_of, kind_of = face_attr("part"), face_attr("kind")
shg_of, shi_of, shk_of = face_attr("shg"), face_attr("shi"), face_attr("shk")

zones = me.color_attributes.new("Zones", "BYTE_COLOR", "CORNER")
names = list(PARTS)
cols = np.zeros((len(me.loops), 4), np.float32)
cols[:, 3] = 1.0
for p in me.polygons:
    cols[p.loop_start:p.loop_start + p.loop_total, :3] = PARTS[names[part_of[p.index]]]
zones.data.foreach_set("color", cols.ravel())
me.color_attributes.active_color = zones
me.color_attributes.render_color_index = me.color_attributes.find("Zones")
me.uv_layers.active = me.uv_layers["UVMap"]
me.uv_layers["UVMap"].active_render = True


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


def add(nt, *xs):
    out = xs[0]
    for x in xs[1:]:
        out = math_(nt, "ADD", out, x)
    return out


def mul(nt, a, b):
    return math_(nt, "MULTIPLY", a, b)


def rgb_scale(nt, rgb, s):
    v = nt.nodes.new("ShaderNodeVectorMath")
    v.operation = "SCALE"
    if isinstance(rgb, tuple):
        v.inputs[0].default_value = rgb
    else:
        nt.links.new(rgb, v.inputs[0])
    if isinstance(s, (int, float)):
        v.inputs[3].default_value = s
    else:
        nt.links.new(s, v.inputs[3])
    return v.outputs[0]


def mix_rgb(nt, fac, a, b):
    """Linear mix of two colours (tuples or sockets) by fac."""
    m = nd(nt, "ShaderNodeMix")
    m.data_type = "RGBA"
    if isinstance(fac, (int, float)):
        m.inputs[0].default_value = fac
    else:
        nt.links.new(fac, m.inputs[0])
    for idx, x in ((6, a), (7, b)):
        if isinstance(x, tuple):
            m.inputs[idx].default_value = (*x, 1.0)
        else:
            nt.links.new(x, m.inputs[idx])
    return m.outputs[2]


def mix_f(nt, fac, a, b):
    """a + (b - a) * fac for floats/sockets."""
    return add(nt, a if not isinstance(a, (int, float)) else math_(nt, "ADD", a, 0.0),
               mul(nt, math_(nt, "SUBTRACT", b, a), fac))


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
    """Vector math; "SCALE_" scales vector a by the float b."""
    v = nt.nodes.new("ShaderNodeVectorMath")
    if op == "SCALE_":
        v.operation = "SCALE"
        nt.links.new(a, v.inputs[0])
        v.inputs[3].default_value = b
        return v.outputs["Vector"]
    v.operation = op
    for i, x in enumerate((a, b)):
        if isinstance(x, tuple):
            v.inputs[i].default_value = x
        else:
            nt.links.new(x, v.inputs[i])
    return v.outputs["Value" if op == "DOT_PRODUCT" else "Vector"]


def chan(nt, color, i):
    """One channel (0, 1, 2) of a colour socket, as a float in 0..1."""
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(color, sep.inputs["Color"])
    return sep.outputs[i]


def mapr(nt, x, a, b, c=0.0, d=1.0):
    """Clamped linear remap of x from [a, b] to [c, d]."""
    m = nt.nodes.new("ShaderNodeMapRange")
    m.clamp = True
    nt.links.new(x, m.inputs[0])
    for i, v in enumerate((a, b, c, d), 1):
        m.inputs[i].default_value = v
    return m.outputs[0]


def voronoi(nt, co, scale, offset, feature="F1", dims="3D", rand=0.85):
    v = nt.nodes.new("ShaderNodeTexVoronoi")
    v.voronoi_dimensions = dims
    v.feature = feature
    v.inputs["Scale"].default_value = scale
    v.inputs["Randomness"].default_value = rand
    nt.links.new(vmath(nt, "ADD", co, offset), v.inputs["Vector"])
    return v


def facets(nt, co, scale, offset, dims="3D"):
    """Crumpled sheet: every Voronoi cell is a flat facet tilted its own random
    way (height = (p - cell point) . (cell colour - 0.5)), so facets meet at
    sharp creases. Height in the coordinates' units; slopes up to about +-0.5.
    Returns (height, the cell's random 0..1, a second random, crease mask 0..1)."""
    v = voronoi(nt, co, scale, offset, dims=dims)
    d = vmath(nt, "SUBTRACT", vmath(nt, "ADD", co, offset), v.outputs["Position"])
    h = vmath(nt, "DOT_PRODUCT", d, vmath(nt, "SUBTRACT", v.outputs["Color"], (0.5, 0.5, 0.5)))
    edge = voronoi(nt, co, scale, offset, "DISTANCE_TO_EDGE", dims=dims).outputs["Distance"]
    return h, chan(nt, v.outputs["Color"], 0), chan(nt, v.outputs["Color"], 2), mapr(nt, edge, 0.0, 0.07, 1.0, 0.0)


# ---- the pattern UVs -------------------------------------------------------
def pat(nt):
    """(u, v, w, h, id0, id1): the face-local layout, in design units."""
    out = []
    for layer in ("pat", "psz", "pid"):
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = layer
        sep = nd(nt, "ShaderNodeSeparateXYZ")
        nt.links.new(uvn.outputs["UV"], sep.inputs[0])
        out += [sep.outputs[0], sep.outputs[1]]
    return out


def vec2(nt, x, y):
    c = nd(nt, "ShaderNodeCombineXYZ")
    for i, s_ in enumerate((x, y)):
        if isinstance(s_, (int, float)):
            c.inputs[i].default_value = s_
        else:
            nt.links.new(s_, c.inputs[i])
    return c.outputs[0]


def edge_dist(nt, u, v, w, h):
    """Distance to the nearest edge of the face's layout rectangle."""
    return math_(nt, "MINIMUM", math_(nt, "MINIMUM", u, math_(nt, "SUBTRACT", w, u)),
                 math_(nt, "MINIMUM", v, math_(nt, "SUBTRACT", h, v)))


def bolt_row(nt, a, b, length, pitch, r):
    """Bolts every `pitch` along a row (a along it, b across it), centred in
    `length`: 1 on a bolt head, soft-edged."""
    nb = math_(nt, "FLOOR", math_(nt, "DIVIDE", length, pitch))
    rem = math_(nt, "SUBTRACT", length, mul(nt, nb, pitch))
    a2 = math_(nt, "SUBTRACT", a, mul(nt, rem, 0.5))
    ds = mul(nt, math_(nt, "ABSOLUTE", math_(nt, "SUBTRACT", math_(nt, "FRACT", math_(nt, "DIVIDE", a2, pitch)), 0.5)),
             pitch)
    inside = mul(nt, math_(nt, "GREATER_THAN", a2, 0.0), math_(nt, "LESS_THAN", a2, mul(nt, nb, pitch)))
    d = math_(nt, "SQRT", add(nt, mul(nt, ds, ds), mul(nt, b, b)))
    return mul(nt, mapr(nt, d, r, r * 0.55), inside)


def bolts(nt, inset=0.008, pitch=0.034, r=0.0036):
    """Bolt rows on a face: one down the middle of a thin strip, otherwise
    one along each edge at `inset`."""
    u, v, w, h, _, _ = pat(nt)
    mid = bolt_row(nt, u, math_(nt, "SUBTRACT", v, mul(nt, h, 0.5)), w, pitch, r)
    rows = []
    for a, b, ln in ((u, math_(nt, "SUBTRACT", v, inset), w),
                     (u, math_(nt, "SUBTRACT", math_(nt, "SUBTRACT", h, v), inset), w),
                     (v, math_(nt, "SUBTRACT", u, inset), h),
                     (v, math_(nt, "SUBTRACT", math_(nt, "SUBTRACT", w, u), inset), h)):
        rows.append(bolt_row(nt, a, b, ln, pitch, r))
    edges = math_(nt, "MAXIMUM", math_(nt, "MAXIMUM", rows[0], rows[1]), math_(nt, "MAXIMUM", rows[2], rows[3]))
    thin = math_(nt, "LESS_THAN", math_(nt, "MINIMUM", w, h), inset * 3.2)
    # a thin strip runs along u when w > h; the mid row is along u
    return mix_f(nt, thin, edges, mid)


# ---- MLI blankets ------------------------------------------------------------
# Hand-laid multi-layer insulation: the outer film crinkled into small,
# flat, sharply creased facets (each its own tilt and gloss: the sun breaks
# into glints), folds running mostly one way, the blanket dimpled at a grid
# of tie buttons, and every edge closed with a strip of aluminised tape.
TIE_PITCH = 0.072
TAPE_W = 0.010


def blanket_fields(nt, co, cell=48.0, aniso=2.2, amp=1.0):
    """Dict of sockets: h (height, design units), rb/rb2/rs (facet randoms),
    crease, tape, button."""
    u, v, w, h, i0, i1 = pat(nt)
    off = vec2(nt, mul(nt, i0, 37.0), mul(nt, i1, 41.0))
    p = vmath(nt, "ADD", vec2(nt, u, mul(nt, v, aniso)), off)
    wn = nd(nt, "ShaderNodeTexNoise", Scale=9.0, Detail=1.0, Roughness=0.5)
    wn.noise_dimensions = "3D"
    nt.links.new(p, wn.inputs["Vector"])
    p = vmath(nt, "ADD", p, vmath(nt, "SCALE_", vmath(nt, "SUBTRACT", wn.outputs["Color"], (0.5, 0.5, 0.5)), 0.012))
    big, rb, rb2, cb = facets(nt, p, cell, (0.0, 0.0, 0.0), dims="2D")
    small, rs, _, cs = facets(nt, p, cell * 2.6, (3.1, 1.7, 0.0), dims="2D")
    # broad folds: soft ridges a few per bay, so the blanket bellies and sags
    fold = noise(nt, p, 5.0, 2.0, 0.5, 0.0, 0.0)
    ridge = mul(nt, math_(nt, "ABSOLUTE", math_(nt, "SUBTRACT", fold, 0.5)), -0.016)
    # tie buttons on a grid: the blanket is drawn in to each (a dimple with
    # radial creases), and the button itself
    du = mul(nt, math_(nt, "SUBTRACT", math_(nt, "FRACT", math_(nt, "DIVIDE", u, TIE_PITCH)), 0.5), TIE_PITCH)
    dv = mul(nt, math_(nt, "SUBTRACT", math_(nt, "FRACT", math_(nt, "DIVIDE", v, TIE_PITCH)), 0.5), TIE_PITCH)
    dt = math_(nt, "SQRT", add(nt, mul(nt, du, du), mul(nt, dv, dv)))
    dimple = math_(nt, "EXPONENT", mul(nt, mul(nt, dt, dt), -1.0 / (0.014 ** 2)))
    spokes = mul(nt, math_(nt, "SINE", mul(nt, math_(nt, "ARCTAN2", dv, du), 7.0)),
                 math_(nt, "EXPONENT", mul(nt, dt, -1.0 / 0.012)))
    e = edge_dist(nt, u, v, w, h)
    inner_ok = math_(nt, "GREATER_THAN", e, TIE_PITCH * 0.45)
    button = mul(nt, mapr(nt, dt, 0.0034, 0.0024), inner_ok)
    tape = mapr(nt, e, TAPE_W, TAPE_W - 0.0012)
    film = add(nt, mul(nt, big, 0.8), mul(nt, small, 0.3), ridge)
    film = add(nt, film, mul(nt, mul(nt, dimple, inner_ok), -0.007), mul(nt, mul(nt, spokes, inner_ok), 0.0008))
    film = mul(nt, film, amp)
    taped = add(nt, 0.0016, mul(nt, small, 0.10), mul(nt, ridge, 0.3))
    hh = mix_f(nt, tape, film, taped)
    hh = add(nt, hh, mul(nt, button, 0.0018))
    crease = math_(nt, "MAXIMUM", cb, mul(nt, cs, 0.55))
    return {"h": hh, "rb": rb, "rb2": rb2, "rs": rs, "crease": crease, "tape": tape, "button": button,
            "var": noise(nt, p, 16.0, 4.0, 0.6, 0.0, 2.0)}


def blanket(part, film, film_dark, metal, rough_lo, rough_hi, tape_rgb, button_rgb, amp, cell, bump_k):
    def albedo(nt, co):
        f = blanket_fields(nt, co, cell, amp=amp)
        tone = add(nt, 0.90, mul(nt, f["rb"], 0.08), mul(nt, f["rs"], 0.04), mul(nt, f["var"], 0.07))
        tone = mul(nt, tone, math_(nt, "SUBTRACT", 1.0, mul(nt, f["crease"], 0.10)))
        # thicker film here and there: a deeper shade on some big facets
        deep = mul(nt, mapr(nt, f["rb2"], 0.55, 1.0), 0.75)
        c = rgb_scale(nt, mix_rgb(nt, deep, film, film_dark), tone)
        c = mix_rgb(nt, f["tape"], c, rgb_scale(nt, tape_rgb, add(nt, 0.92, mul(nt, f["var"], 0.12))))
        return mix_rgb(nt, f["button"], c, button_rgb)

    def rough(nt, co):
        f = blanket_fields(nt, co, cell, amp=amp)
        r = add(nt, rough_lo, mul(nt, f["rs"], (rough_hi - rough_lo) * 0.7), mul(nt, f["rb"], (rough_hi - rough_lo) * 0.3))
        r = add(nt, r, mul(nt, f["crease"], 0.12))
        r = mix_f(nt, f["tape"], r, 0.32)
        return mix_f(nt, f["button"], r, 0.62)

    def met(nt, co):
        f = blanket_fields(nt, co, cell, amp=amp)
        m = mix_f(nt, f["tape"], math_(nt, "ADD", 0.0, metal), 1.0 if metal > 0.5 else 0.0)
        # (full metal: at game range the mipped crinkle would flatten into one
        # mirror of the black sky, but ProjectProbes widens the gloss by the
        # mipped normal's length, Toksvig, so the facets still spread the sun)
        return mix_f(nt, f["button"], m, 0.0)

    def height(nt, co):
        return blanket_fields(nt, co, cell, amp=amp)["h"]

    material(part, albedo, rough, met, height, (bump_k, 1.0))


# ---- the dish's white paint: an engineered panel layout -----------------
# The reflector is built from panels: 6 gores inside RING_SEAMS[0], 12 to
# RING_SEAMS[1], 24 out to the rim. Every panel has its own tone, gloss and
# a faint oil-can warp; the seams are dark grooves with a rivet row each
# side of the ring seams. The dish axis is Blender -Y, so the radius lives
# in x/z. Distances below are in design units (x S in Blender).
RING_SEAMS = (0.26, 0.52)
SEAM_W = 0.0024
RIVET_PITCH, RIVET_OFF, RIVET_R = 0.026, 0.0075, 0.0021


def dish_polar(nt, co):
    sep = nd(nt, "ShaderNodeSeparateXYZ")
    nt.links.new(co, sep.inputs[0])
    x, z = sep.outputs[0], sep.outputs[2]
    rad = math_(nt, "SQRT", math_(nt, "ADD", math_(nt, "MULTIPLY", x, x), math_(nt, "MULTIPLY", z, z)))
    return math_(nt, "DIVIDE", rad, S), math_(nt, "ARCTAN2", z, x)


def dish_panels(nt, co):
    """(seam mask, rivet mask, per-panel random 0..1) on the dish's paint."""
    rad, ang = dish_polar(nt, co)
    zone = math_(nt, "ADD", math_(nt, "GREATER_THAN", rad, RING_SEAMS[0]),
                 math_(nt, "GREATER_THAN", rad, RING_SEAMS[1]))
    n_gore = math_(nt, "MULTIPLY", math_(nt, "POWER", 2.0, zone), 6.0)
    g = math_(nt, "DIVIDE", math_(nt, "MULTIPLY", ang, n_gore), 2 * math.pi)
    arc = math_(nt, "DIVIDE", math_(nt, "MULTIPLY", math_(nt, "ABSOLUTE", math_(nt, "SUBTRACT", g, math_(nt, "ROUND", g))),
                                    math_(nt, "MULTIPLY", rad, 2 * math.pi)), n_gore)
    gore = math_(nt, "MULTIPLY", mapr(nt, arc, SEAM_W, SEAM_W * 0.5), math_(nt, "GREATER_THAN", rad, 0.13))
    seam = gore
    rivet = None
    for r0 in RING_SEAMS + (0.776,):
        dr = math_(nt, "ABSOLUTE", math_(nt, "SUBTRACT", rad, r0))
        if r0 in RING_SEAMS:
            seam = math_(nt, "MAXIMUM", seam, mapr(nt, dr, SEAM_W, SEAM_W * 0.5))
        row = math_(nt, "ABSOLUTE", math_(nt, "SUBTRACT", dr, RIVET_OFF if r0 in RING_SEAMS else 0.0))
        s_ = math_(nt, "DIVIDE", math_(nt, "MULTIPLY", ang, rad), RIVET_PITCH)
        ds = math_(nt, "MULTIPLY", math_(nt, "ABSOLUTE", math_(nt, "SUBTRACT", s_, math_(nt, "ROUND", s_))), RIVET_PITCH)
        dot = mapr(nt, math_(nt, "SQRT", math_(nt, "ADD", math_(nt, "MULTIPLY", row, row), math_(nt, "MULTIPLY", ds, ds))),
                   RIVET_R, RIVET_R * 0.55)
        rivet = dot if rivet is None else math_(nt, "MAXIMUM", rivet, dot)
    cx = nd(nt, "ShaderNodeCombineXYZ")
    nt.links.new(zone, cx.inputs[0])
    nt.links.new(math_(nt, "FLOOR", g), cx.inputs[1])
    wn = nt.nodes.new("ShaderNodeTexWhiteNoise")
    wn.noise_dimensions = "3D"
    nt.links.new(cx.outputs[0], wn.inputs["Vector"])
    return seam, rivet, wn.outputs["Value"]


def pits(nt, co):
    """Sparse micrometeoroid pits and scuffs: 0..1."""
    v = voronoi(nt, co, 55.0, (11.0, 3.0, 7.0))
    sparse = math_(nt, "GREATER_THAN", chan(nt, v.outputs["Color"], 1), 0.82)
    return math_(nt, "MULTIPLY", sparse, mapr(nt, v.outputs["Distance"], 0.10, 0.05))


def paint_albedo(nt, co):
    seam, rivet, pid = dish_panels(nt, co)
    mott = noise(nt, co, 9.0, 5.0, 0.6, 0.0, 6.0)
    tone = math_(nt, "ADD", 0.90, math_(nt, "MULTIPLY", mott, 0.08))
    tone = math_(nt, "MULTIPLY", tone, math_(nt, "ADD", 0.955, math_(nt, "MULTIPLY", pid, 0.09)))
    tone = math_(nt, "MULTIPLY", tone, math_(nt, "SUBTRACT", 1.0, math_(nt, "MULTIPLY", seam, 0.28)))
    tone = math_(nt, "MULTIPLY", tone, math_(nt, "SUBTRACT", 1.0, math_(nt, "MULTIPLY", rivet, 0.30)))
    tone = math_(nt, "MULTIPLY", tone, math_(nt, "SUBTRACT", 1.0, math_(nt, "MULTIPLY", pits(nt, co), 0.45)))
    # years of UV: the white has gone faintly warm, patchily
    age = mapr(nt, noise(nt, co, 2.5, 3.0, 0.5, 0.0, 19.0), 0.3, 0.72)
    return rgb_scale(nt, mix_rgb(nt, age, (0.74, 0.74, 0.72), (0.72, 0.69, 0.61)), tone)


def paint_rough(nt, co):
    seam, rivet, pid = dish_panels(nt, co)
    r = math_(nt, "ADD", 0.40, math_(nt, "MULTIPLY", pid, 0.24))
    r = math_(nt, "ADD", r, math_(nt, "MULTIPLY", noise(nt, co, 8.0, 2.0, 0.5, 0.0, 20.0), 0.10))
    r = math_(nt, "ADD", r, math_(nt, "MULTIPLY", seam, 0.25))
    return math_(nt, "SUBTRACT", r, math_(nt, "MULTIPLY", rivet, 0.2))


def paint_height(nt, co):
    seam, rivet, pid = dish_panels(nt, co)
    warp = nd(nt, "ShaderNodeTexNoise", Scale=7.0, Detail=1.0, Roughness=0.5)
    warp.noise_dimensions = "4D"
    nt.links.new(co, warp.inputs["Vector"])
    nt.links.new(math_(nt, "MULTIPLY", pid, 40.0), warp.inputs["W"])
    h = math_(nt, "MULTIPLY", warp.outputs["Fac"], 0.5)
    h = math_(nt, "SUBTRACT", h, seam)
    h = math_(nt, "ADD", h, math_(nt, "MULTIPLY", rivet, 0.5))
    return math_(nt, "SUBTRACT", h, math_(nt, "MULTIPLY", pits(nt, co), 0.6))


# ---- the trim: satin paint with chipped edges -----------------------------
# Authored light neutral (no hue): the game multiplies it by a toned-down
# project colour. Chips show a dark primer, not bare metal, so they take the
# tint as a darker shade of the same paint instead of a coloured metal.
def edge_mask(nt):
    """0 on flat paint rising to 1 on a sharp edge, over the bevel radius."""
    bev = nd(nt, "ShaderNodeBevel", Radius=0.009 * S)
    bev.samples = 16
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    return mapr(nt, vmath(nt, "DOT_PRODUCT", bev.outputs["Normal"], geo.outputs["Normal"]), 0.999, 0.86)


def trim_wear(nt, co):
    """Chipped edges: the edge mask pushed in and out by a noise, so chips
    come and go along an edge instead of drawing an outline; plus a few
    scuffs on the flat."""
    n = noise(nt, co, 45.0, 8.0, 0.7, 0.0, 16.0)
    w = math_(nt, "ADD", edge_mask(nt), math_(nt, "MULTIPLY", math_(nt, "SUBTRACT", n, 0.5), 2.4))
    edge = mapr(nt, w, 0.97, 1.05)
    scuff = mapr(nt, noise(nt, co, 140.0, 3.0, 0.6, 0.0, 18.0), 0.70, 0.73, 0.0, 0.8)
    return math_(nt, "MAXIMUM", edge, scuff)


def trim_albedo(nt, co):
    mott = noise(nt, co, 12.0, 4.0, 0.6, 0.0, 21.0)
    paint = rgb_scale(nt, (0.70, 0.70, 0.685), math_(nt, "ADD", 0.93, math_(nt, "MULTIPLY", mott, 0.1)))
    return mix_rgb(nt, trim_wear(nt, co), paint, (0.16, 0.16, 0.155))


def trim_rough(nt, co):
    r = math_(nt, "ADD", 0.36, math_(nt, "MULTIPLY", noise(nt, co, 20.0, 3.0, 0.5, 0.0, 22.0), 0.14))
    return math_(nt, "ADD", r, math_(nt, "MULTIPLY", trim_wear(nt, co), 0.28))


def trim_height(nt, co):
    return math_(nt, "MULTIPLY", trim_wear(nt, co), -0.6)


def brushed_albedo(base):
    def f(nt, co):
        return rgb_scale(nt, base, math_(nt, "ADD", 0.9, math_(nt, "MULTIPLY",
                         noise(nt, co, 40.0, 3.0, 0.6, 0.0, 9.0), 0.18)))
    return f


def brushed_rough(lo, hi):
    def f(nt, co):
        return math_(nt, "ADD", lo, math_(nt, "MULTIPLY", noise(nt, co, 9.0, 2.0, 0.5, 0.0, 10.0), hi - lo))
    return f


# ---- the bus frame and boxes: anodised, bolted, worn at the edges ----------
def frame_albedo(nt, co):
    b = bolts(nt)
    u, v, w, h, _, _ = pat(nt)
    worn = mapr(nt, edge_dist(nt, u, v, w, h), 0.0028, 0.0012)
    c = rgb_scale(nt, (0.30, 0.30, 0.31), add(nt, 0.9, mul(nt, noise(nt, co, 40.0, 3.0, 0.6, 0.0, 9.0), 0.18)))
    c = mix_rgb(nt, mul(nt, worn, 0.6), c, (0.55, 0.55, 0.56))
    return mix_rgb(nt, b, c, (0.62, 0.62, 0.63))


def frame_rough(nt, co):
    r = brushed_rough(0.35, 0.5)(nt, co)
    return mix_f(nt, bolts(nt), r, 0.26)


def frame_height(nt, co):
    return mul(nt, bolts(nt), 0.0024)


def black_albedo(nt, co):
    u, v, w, h, _, _ = pat(nt)
    worn = mapr(nt, edge_dist(nt, u, v, w, h), 0.0026, 0.0010)
    return mix_rgb(nt, mul(nt, worn, 0.7), (0.018, 0.018, 0.02), (0.09, 0.09, 0.095))


# ---- the plate's bezel: machined ring with eight bolt heads --------------
def bezel_bolts(nt, co):
    sep = nd(nt, "ShaderNodeSeparateXYZ")
    nt.links.new(co, sep.inputs[0])
    py = math_(nt, "SUBTRACT", sep.outputs[1], bezel_c.y)
    pz = math_(nt, "SUBTRACT", sep.outputs[2], bezel_c.z)
    rad = math_(nt, "DIVIDE", math_(nt, "SQRT", add(nt, mul(nt, py, py), mul(nt, pz, pz))), S)
    ang = math_(nt, "ARCTAN2", pz, py)
    s_ = math_(nt, "DIVIDE", math_(nt, "SUBTRACT", ang, math.pi / 8), math.pi / 4)
    da = mul(nt, mul(nt, math_(nt, "ABSOLUTE", math_(nt, "SUBTRACT", s_, math_(nt, "ROUND", s_))), math.pi / 4), rad)
    dr = math_(nt, "SUBTRACT", rad, PLATE_R + 0.0066)
    d = math_(nt, "SQRT", add(nt, mul(nt, da, da), mul(nt, dr, dr)))
    return mapr(nt, d, 0.0042, 0.0026)


def bezel_albedo(nt, co):
    return mix_rgb(nt, bezel_bolts(nt, co), brushed_albedo((0.78, 0.78, 0.79))(nt, co), (0.42, 0.42, 0.43))


def bezel_rough(nt, co):
    return mix_f(nt, bezel_bolts(nt, co), brushed_rough(0.24, 0.36)(nt, co), 0.45)


def fin_albedo(nt, co):
    return rgb_scale(nt, (0.085, 0.082, 0.078), math_(nt, "ADD", 0.75, math_(nt, "MULTIPLY",
                     noise(nt, co, 25.0, 3.0, 0.5, 0.0, 11.0), 0.5)))


def nozzle_albedo(nt, co):
    # heat tint: straw to blue toward the bells' lips, read off a noise
    t = noise(nt, co, 50.0, 3.0, 0.5, 0.0, 12.0)
    return mix_rgb(nt, t, (0.32, 0.27, 0.20), (0.20, 0.22, 0.30))


# amber Kapton: F0 of an aluminised film seen through amber polyimide
blanket("foil", (0.93, 0.61, 0.23), (0.74, 0.37, 0.10), 1.0, 0.10, 0.40,
        (0.80, 0.80, 0.82), (0.42, 0.40, 0.36), 0.85, 48.0, 1.0)
for _p in ("silver", "tank"):
    blanket(_p, (0.88, 0.885, 0.90), (0.76, 0.77, 0.79), 1.0, 0.10, 0.40,
            (0.66, 0.66, 0.68), (0.42, 0.40, 0.36), 0.85, 48.0, 1.0)
for _p in ("foil_dark", "cap"):
    blanket(_p, (0.040, 0.039, 0.044), (0.028, 0.027, 0.03), 0.0, 0.26, 0.48,
            (0.05, 0.05, 0.055), (0.22, 0.215, 0.20), 0.55, 34.0, 0.6)
material("frame", frame_albedo, frame_rough, 0.85, frame_height, (0.6, 1.0))
material("deck", brushed_albedo((0.30, 0.30, 0.31)), brushed_rough(0.35, 0.5), 0.85)
material("louvre", brushed_albedo((0.92, 0.92, 0.93)), brushed_rough(0.08, 0.16), 1.0)
for _p in ("paint", "reflector"):
    material(_p, paint_albedo, paint_rough, 0.0, paint_height, (0.45, 0.0022 * S))
material("trim", trim_albedo, trim_rough, 0.0, trim_height, (0.4, 0.0012 * S))
material("lamp", (0.85, 0.83, 0.78), 0.12, 0.0)
# (no sub-texel grain in any height: it reads as nothing on screen and
# costs the normal map's WebP most of its bytes)
material("metal", brushed_albedo((0.80, 0.80, 0.81)), brushed_rough(0.26, 0.42), 1.0)
material("bezel", bezel_albedo, bezel_rough, 1.0, lambda nt, co: mul(nt, bezel_bolts(nt, co), 0.003), (0.6, 1.0))
material("fin", fin_albedo, 0.62, 0.3)
material("gold", (1.0, 0.72, 0.30), 0.2, 1.0)
material("nozzle", nozzle_albedo, 0.35, 0.9)
material("throat", (0.05, 0.045, 0.04), 0.65, 0.4)
material("fiber", brushed_albedo((0.58, 0.55, 0.47)), 0.55, 0.0)
material("black", black_albedo, 0.30, 0.0)

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
uvl = ubm.loops.layers.uv["UVMap"]
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

# shared faces: every instance after the first copies its master's UVs, so
# only the masters are packed
SHARED = np.nonzero((shg_of > 0) & (shi_of > 0))[0]
MASTER = {(int(shg_of[i]), int(shk_of[i])): i for i in np.nonzero((shg_of > 0) & (shi_of == 0))[0]}


def pack():
    bpy.ops.object.mode_set(mode="EDIT")
    ebm = bmesh.from_edit_mesh(me)
    ebm.faces.ensure_lookup_table()
    for i in SHARED:
        ebm.faces[int(i)].hide_set(True)
    bmesh.update_edit_mesh(me)
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=0.003)
    bpy.ops.mesh.reveal(select=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def copy_shared():
    uv = me.uv_layers["UVMap"].data
    for i in SHARED:
        p = me.polygons[int(i)]
        q = me.polygons[MASTER[(int(shg_of[i]), int(shk_of[i]))]]
        assert p.loop_total == q.loop_total
        for a_, b_ in zip(range(p.loop_start, p.loop_start + p.loop_total),
                          range(q.loop_start, q.loop_start + q.loop_total)):
            uv[a_].uv = uv[b_].uv


plate_poly = next(p for p in me.polygons if kind_of[p.index] == K_PLATE_FACE)
plate_loops = list(range(plate_poly.loop_start, plate_poly.loop_start + plate_poly.loop_total))
R_PLATE = PLATE_R * S


def plate_pq(co):
    # viewer at glTF +X with +Y up: right = glTF -Z = Blender +Y, up = glTF +Y = Blender +Z
    return ((co.y - plate_c.y) / R_PLATE, (co.z - plate_c.z) / R_PLATE)


def plate_bbox():
    uv = me.uv_layers["UVMap"].data   # re-fetched: edit-mode round trips free the old one
    us = [uv[i].uv.x for i in plate_loops]
    vs = [uv[i].uv.y for i in plate_loops]
    return min(us), min(vs), max(us) - min(us), max(vs) - min(vs)


def map_plate(u0, v0, side):
    uv = me.uv_layers["UVMap"].data
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
    pack()
u0, v0, w, h = plate_bbox()
side = max(w, h)
map_plate(u0 + (w - side) / 2, v0 + (h - side) / 2, side)     # undo any packer rotation
PU0, PV0, PSIDE = u0 + (w - side) / 2, v0 + (h - side) / 2, side
copy_shared()
print(f"probe: plate island {PSIDE * TEX:.0f} px across")


def uv_area_by_part():
    uv = me.uv_layers["UVMap"].data
    out = {}
    for p in me.polygons:
        if shg_of[p.index] > 0 and shi_of[p.index] > 0:
            continue
        pts = [uv[i].uv for i in range(p.loop_start, p.loop_start + p.loop_total)]
        a = 0.0
        for i in range(1, len(pts) - 1):
            a += abs((pts[i] - pts[0]).cross(pts[i + 1] - pts[0])) / 2
        out[names[part_of[p.index]]] = out.get(names[part_of[p.index]], 0.0) + a
    return {k: round(v * 100, 2) for k, v in sorted(out.items(), key=lambda kv: -kv[1])}


print("probe: atlas % by part", uv_area_by_part())

# ------------------------------------------------------------------ bake ---
world = bpy.data.worlds.new("bake_world")
SCENE.world = world
world.light_settings.distance = 0.10
SCENE.render.engine = "CYCLES"
SCENE.cycles.device = "CPU"
SCENE.cycles.seed = 0


def new_img(name, size, raw=True):
    """A float bake target (linear values, no 8-bit banding in the darks)."""
    img = bpy.data.images.new(name, width=size, height=size, alpha=False, float_buffer=raw)
    img.colorspace_settings.name = "Non-Color"
    return img


def bake(kind, img, samples, margin, **kw):
    bake_utils._attach_bake_target([ob], img)
    SCENE.cycles.samples = samples
    SCENE.render.bake.margin = margin
    activate(ob)
    bpy.ops.object.bake(type=kind, use_clear=True, **kw)
    bake_utils._detach_bake_targets([ob])


def pixels(img):
    n = img.size[0]
    a = np.empty(n * n * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(n, n, 4)


def down(a, size):
    """Box-filter a square float image down to size (supersampled bakes)."""
    f = a.shape[0] // size
    return a.reshape(size, f, size, f, a.shape[-1]).mean(axis=(1, 3))


alb_raw, mr_raw = new_img("probe_albedo_raw", BAKE), new_img("probe_mr_raw", BAKE)
nrm_img, ao_raw = new_img("probe_normal_raw", NBAKE), new_img("probe_ao_raw", BAKE)
set_mode("albedo")
bake("EMIT", alb_raw, 8, 8)
set_mode("mr")
bake("EMIT", mr_raw, 8, 8)
set_mode("normal")
bake("NORMAL", nrm_img, 4, 12)
bake("AO", ao_raw, 64, 8)

alb, mr = down(pixels(alb_raw), TEX), down(pixels(mr_raw), TEX)   # MR shrinks to MR_TEX at the end
ao = down(pixels(ao_raw), TEX)                  # supersampled AO: less noise per texel
nrm = down(pixels(nrm_img) * 2 - 1, NTEX)       # supersampled normals: crisp, not aliased
nrm[..., :3] /= np.linalg.norm(nrm[..., :3], axis=-1, keepdims=True)
nrm = nrm * 0.5 + 0.5
# The raw bakes are linear floats; the shipped albedo is 8-bit sRGB.


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


lin = alb[..., :3].copy()
occl = 0.4 + 0.6 * ao[..., :1]
lin *= occl


# --------------------------------------------- the plate: engraved gold ---
def plate_fields(res):
    """The plate's engraving at a map resolution: (slice, inside mask, etch,
    turn, radius). Re-seeded per call, so every map gets the same design."""
    nrng = np.random.default_rng(SEED)
    x0, y0 = int(PU0 * res), int(PV0 * res)
    x1 = min(res, int(math.ceil((PU0 + PSIDE) * res)) + 1)
    y1 = min(res, int(math.ceil((PV0 + PSIDE) * res)) + 1)
    ys_, xs_ = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    P = ((xs_ + 0.5) / res - PU0) / PSIDE * 2 - 1
    Q = ((ys_ + 0.5) / res - PV0) / PSIDE * 2 - 1
    Rr = np.hypot(P, Q)
    px = 2.0 / (PSIDE * res)          # one texel in plate units

    def seg_d(ax, ay, bx, by):
        dx, dy = bx - ax, by - ay
        t = np.clip(((P - ax) * dx + (Q - ay) * dy) / (dx * dx + dy * dy + 1e-9), 0, 1)
        return np.hypot(P - ax - t * dx, Q - ay - t * dy)

    def stroke(d, w):
        return np.clip(1 - (d - w) / (1.2 * px), 0, 1)

    etch = np.zeros_like(P)
    LW = 0.014
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
    return (slice(y0, y1), slice(x0, x1)), Rr <= 1.03, etch, turn, Rr


# albedo and metal/roughness at TEX
sl, inside, etch, turn, Rr = plate_fields(TEX)
gold = np.array([1.0, 0.70, 0.30], np.float32)
g_lin = gold[None, None] * (0.9 + 0.08 * turn)[..., None]
g_lin = g_lin * (1 - 0.6 * etch)[..., None]
g_lin[Rr > 0.97] *= 0.85
lin[sl][inside] = (g_lin * (0.75 + 0.25 * ao[sl][..., :1]))[inside]
mr[sl][..., 1][inside] = (0.34 + 0.06 * turn + 0.22 * etch)[inside]
mr[sl][..., 2][inside] = 1.0
# the engraving's normals at NTEX (gradients per texel: scale with resolution)
sl, inside, etch, turn, Rr = plate_fields(NTEX)
height = -etch * 1.0 + 0.04 * turn - 0.6 * np.clip((Rr - 0.97) / 0.03, 0, 1)
gy, gx = np.gradient(height)
strength = 0.9 * NTEX / 1024 * (0.34 / PLATE_UV_SIDE)
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
img_alb = to_image("probe_albedo", alb)
img_mr = to_image("probe_metal_rough", down(mr, MR_TEX), True, MR_TEX)
img_nrm = to_image("probe_normal_map", nrm, True, NTEX)

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
for a in ("part", "kind", "shg", "shi", "shk"):
    me.attributes.remove(me.attributes[a])
for layer in ("pat", "psz", "pid"):          # bake-only: never shipped
    me.uv_layers.remove(me.uv_layers[layer])
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
