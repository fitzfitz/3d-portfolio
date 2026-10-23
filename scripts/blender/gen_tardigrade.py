# Space monster 2: a tardigrade (water bear), scaled up to ~3x the player's
# ship (original work, 100% procedural).
#   $BLENDER --background --python scripts/blender/gen_tardigrade.py [-- --out DIR] [--stage=blockout]
# Output: assets-src/tardigrade.glb, assets-src/tardigrade.blend
#
# Stage "blockout" (look check A: shapes, proportions, size against the ship):
# flat blockout materials, every part its own named object under the root
# "Tardigrade", so the final stage can build on them:
#   - Tardigrade_Body: plump, five segments (head + four trunk segments)
#     with soft folds between them, a flatter belly and a gently arched back;
#   - Tardigrade_Leg1_FL ... Leg8_BR: eight stubby legs, a pair under each
#     trunk segment, numbered front-left 1, front-right 2, ... back-right 8
#     (+X is the animal's left); the last pair angles back; each foot has
#     four small curved claws;
#   - Tardigrade_Mouth: the round tube mouth at +Z (its beam weapon), a
#     rolled lip around a dark bore;
#   - Tardigrade_Eyes: two tiny dark eyes on the head;
#   - Tardigrade_Crystals: five crystals along the back (they glow, later);
#   - (revision v2, scarier: furry and slimy) Tardigrade_Fur: a matted coat
#     (a closed slab plus wet clumps, a coarse proxy for the shell-fur
#     envelope) over the back and sides, the crystals poking through; the
#     belly, legs, claws and mouth tube stay bare; Tardigrade_Teeth: two
#     rings of raked teeth inside the (wider) mouth tube; Tardigrade_Drool;
#     Tardigrade_Brows: scowling lids and brows over the eyes.
# (Stage "final", Task 4, sculpts, bakes and adds the zones and motion data.)
#
# glTF space: +Y up, the mouth +Z, scale 1, origin at the centre of mass
# (uniform density). Longest extent 6.5-7.5 (the player's ship is ~2.4).
# Seeded (crystals, teeth, fur): re-running reproduces
# tardigrade.glb byte for byte. No add-ons: bmesh only.
import math
import os
import random
import sys

import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import monster_lib as ml  # noqa: E402
from monster_lib import DARK, FUR, LIGHT, SKIN, SLIME  # noqa: E402

SEED = 20261024
OUT_DIR, STAGE = ml.parse_args("tardigrade")
EXTENT = (6.5, 7.5)
rng = random.Random(SEED)

# ------------------------------------------------------------ dimensions ---
HALF = 3.25                     # body runs z -3.25 (tail) .. +3.25 (snout)
RMAX = 1.36
FOLDS = (1.94, 0.63, -0.68, -1.99)   # segment boundaries: head | 2 | 3 | 4 | tail
FOLD_DEPTH, FOLD_W = 0.09, 0.16
ARCH = 0.12                     # the back's arch (head and tail sit lower)
BELLY, BACK = 0.72, 0.92        # cross-section half-heights below/above, x RMAX
RINGS, SEGS = 160, 40
CLAW = DARK

scene = ml.reset_scene()
rt = ml.root("Tardigrade")


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def radius(z):
    u = min(1.0, abs(z) / HALF)
    e = (1 - u ** 2.6) ** (1 / 2.6)                       # plump envelope
    taper = 1 - 0.28 * smoothstep(0.2, 1.0, z / HALF)     # the head is smaller
    fold = sum(math.exp(-((z - zk) / FOLD_W) ** 2) for zk in FOLDS)
    return RMAX * e * taper * (1 - FOLD_DEPTH * fold)


def centre_y(z):
    u = z / HALF
    return ARCH * (1 - u * u)


def surface(z, theta):
    """Body point at axial z, angle theta about the axis (0 = +X, 90 deg = up)."""
    r = radius(z)
    s = math.sin(theta)
    return Vector((r * math.cos(theta), centre_y(z) + r * s * (BACK if s > 0 else BELLY), z))


def surface_n(z, theta, h=1e-3):
    p = surface(z, theta)
    dz = surface(z + h, theta) - surface(z - h, theta)
    dt = surface(z, theta + h) - surface(z, theta - h)
    return p, dt.cross(dz).normalized()


# ------------------------------------------------------------------ body ---
bm = bmesh.new()
rings = [[bm.verts.new((0, centre_y(-HALF), -HALF))]]
for i in range(1, RINGS):
    t = i / RINGS
    z = HALF * (0.5 * -math.cos(math.pi * t) + 0.5 * (2 * t - 1))   # denser at the ends
    rings.append([bm.verts.new(surface(z, 2 * math.pi * k / SEGS)) for k in range(SEGS)])
rings.append([bm.verts.new((0, centre_y(HALF), HALF))])
faces = []
for A, B in zip(rings, rings[1:]):
    for k in range(SEGS):
        k1 = (k + 1) % SEGS
        vs = (A[0], B[k1], B[k]) if len(A) == 1 else (A[k], A[k1], B[0]) if len(B) == 1 else (
            A[k], A[k1], B[k1], B[k])
        f = bm.faces.new(vs)
        f.material_index = SKIN
        faces.append(f)
bmesh.ops.recalc_face_normals(bm, faces=faces)
ml.to_object("Tardigrade_Body", bm, rt)

# ----------------------------------------------------------------- mouth ---
# a short tube out of the snout: rolled lip, a wide dark bore lined with
# two rings of small teeth raked inward, and drool hanging off the lip
MOUTH_Z = 3.06
BORE = 0.25
TUBE = [(0.0, -0.25), (0.40, -0.25), (0.41, 0.20), (0.45, 0.36), (0.46, 0.45), (0.43, 0.53), (0.37, 0.565),
        (0.31, 0.55), (0.27, 0.49), (BORE + 0.005, 0.36), (BORE, 0.06), (0.0, 0.06)]
MC = Vector((0, centre_y(MOUTH_Z), MOUTH_Z))
AX = Vector((0, 0, 1))
bm = bmesh.new()
ml.lathe(bm, TUBE, 40, ml.place(MC, AX), mats=[SKIN] * 8 + [DARK] * 3)
ml.to_object("Tardigrade_Mouth", bm, rt)

bm = bmesh.new()
for depth, count, h, w, phase in ((0.43, 12, 0.10, 0.034, 0.0), (0.24, 10, 0.08, 0.03, 0.5)):
    for k in range(count):
        a = 2 * math.pi * (k + phase) / count
        radial = Vector((math.cos(a), math.sin(a), 0))
        base = MC + AX * depth + radial * (BORE + 0.01)
        d = (-radial * 0.85 - AX * 0.5 + Vector((rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), 0)))
        ml.fang(bm, base, d.normalized(), w * rng.uniform(0.9, 1.1), h * rng.uniform(0.85, 1.15), LIGHT,
                rng.uniform(0, 1))
ml.to_object("Tardigrade_Teeth", bm, rt)

bm = bmesh.new()
for a, length, sway in ((-118, 0.42, (0.0, 0, 0.03)), (-92, 0.85, (0.03, 0, -0.04)), (-66, 0.55, (-0.02, 0, 0.0))):
    a = math.radians(a)
    top = MC + AX * 0.50 + Vector((math.cos(a), math.sin(a), 0)) * 0.43
    ml.drip(bm, top, length, 0.045, SLIME, sway)
ml.to_object("Tardigrade_Drool", bm, rt)

# ------------------------------------------------------------------ eyes ---
# small dark eyes under heavy lids that slant down toward the snout
bm = bmesh.new()
brows = bmesh.new()
for side in (1, -1):
    p, n = surface_n(2.72, math.radians(90 - side * 34))
    c, r = p - n * 0.01, 0.15
    ml.ellipsoid(bm, c, (r, r, r), 20, 12, DARK)
    gaze = (AX + n * 0.6).normalized()
    toward = Vector((-side, 0, 0.35)).normalized()      # the lids sink toward the midline: a scowl
    ml.lid_and_brow(brows, c, r, Vector((0, 1, 0)) + toward * 0.55, gaze, toward, SKIN, cover=24,
                    brow=(0.045, 0.08), span=45)
ml.to_object("Tardigrade_Eyes", bm, rt, smooth_angle=80)
ml.to_object("Tardigrade_Brows", brows, rt)

# ------------------------------------------------------------------ legs ---
# (z of the hip, angle below the side, leg direction (x for the left side)):
# short tapered stumps splayed out under the body, the last pair angled back
LEGS = [
    (1.28, 40, Vector((0.62, -1.0, 0.12))),
    (-0.02, 42, Vector((0.66, -1.0, 0.0))),
    (-1.33, 42, Vector((0.62, -1.0, -0.10))),
    (-2.50, 32, Vector((0.38, -0.55, -1.0))),
]
SIDES = (("L", 1), ("R", -1))
CORNER = {0: "F", 1: "M", 2: "N", 3: "B"}      # front, middle, next, back
CLAW_SPREAD = (-48, -16, 16, 48)
LEG_LEN, HIP_R, FOOT_R = 0.44, 0.47, 0.31


def leg(name, hip_z, below, d_left, side):
    d = Vector((d_left.x * side, d_left.y, d_left.z)).normalized()
    theta = math.radians(180 + below) if side < 0 else math.radians(-below)
    hip, _ = surface_n(hip_z, theta)
    bm = bmesh.new()
    foot = hip + d * LEG_LEN
    ml.sweep(bm, [hip - d * 0.35, hip, hip + d * LEG_LEN * 0.5, foot],
             lambda t: HIP_R + (FOOT_R - HIP_R) * t, ring=20, per_seg=5, mi=SKIN, cap=3)
    # four curved claws round the front of the sole, hooking toward `curl`
    curl = Vector((0, -1, 0)) if d.z < -0.5 else Vector((0, -0.3, 1))
    curl = (curl - d * curl.dot(d)).normalized()
    side_v = d.cross(curl).normalized()
    sole = foot + d * FOOT_R * 0.55
    for a in CLAW_SPREAD:
        a = math.radians(a)
        off = curl * math.cos(a) + side_v * math.sin(a)
        base = sole + off * FOOT_R * 0.62
        ml.sweep(bm, [base - d * 0.08, base + d * 0.06 + off * 0.05, base + d * 0.15 + curl * 0.08 + off * 0.08,
                      base + d * 0.17 + curl * 0.22 + off * 0.09],
                 lambda t: 0.085 * (1 - t) ** 1.2 + 0.012, ring=10, per_seg=5, mi=CLAW, cap=3)
    ml.to_object(name, bm, rt)


n = 1
for pair, (z, below, d) in enumerate(LEGS):
    for tag, side in SIDES:
        leg(f"Tardigrade_Leg{n}_{CORNER[pair]}{tag}", z, below, d, side)
        n += 1

# -------------------------------------------------------------- crystals ---
# five along the back, staggered either side of the spine, seeded sizes/tilts
CRYSTAL_ROOTS = []
bm = bmesh.new()
for z, off in ((1.31, 14), (0.42, -16), (-0.42, 12), (-1.26, -14), (-2.04, 10)):
    theta = math.radians(90 + off)
    p, nrm = surface_n(z, theta)
    h = rng.uniform(0.95, 1.25)          # tall enough to stand clear of the coat
    w = rng.uniform(0.15, 0.21)
    tilt = Vector((rng.uniform(-0.25, 0.25), 0, rng.uniform(-0.35, 0.1)))
    d = (nrm + tilt).normalized()
    prof = [(0.0, -0.15), (w, -0.15), (w, h * 0.68), (w * 0.35, h * 0.92), (0.0, h)]
    ml.lathe(bm, prof, 6, ml.place(p, d, spin=rng.uniform(0, math.pi)), mi=LIGHT)
    CRYSTAL_ROOTS.append(p)
    if rng.random() < 0.7:      # a small sibling leaning out of the same root
        d2 = (d + Vector((rng.uniform(-0.6, 0.6), 0, rng.uniform(-0.6, 0.6)))).normalized()
        h2, w2 = h * 0.5, w * 0.7
        prof = [(0.0, -0.12), (w2, -0.12), (w2, h2 * 0.68), (w2 * 0.35, h2 * 0.92), (0.0, h2)]
        ml.lathe(bm, prof, 6, ml.place(p + d * 0.02, d2, spin=rng.uniform(0, math.pi)), mi=LIGHT)
ml.to_object("Tardigrade_Crystals", bm, rt, smooth_angle=30)

# ------------------------------------------------------------------ coat ---
def hem(z):
    """How far below the side (radians) the coat reaches at axial z."""
    return math.radians(-20 + 9 * math.sin(2.3 * z + 0.7))


COAT_Z0, COAT_Z1 = -HALF + 0.04, FOLDS[0] + 0.06
# a shaggy, matted coat of wet clumps over the back and sides, from behind
# the head to the rump, combed back and hanging down; a ragged hem above the
# legs; bare round the crystals so they poke through. The head, belly, legs
# and mouth stay bare (slimy, later).
bm = bmesh.new()
# the matted under-layer: a closed slab from just under the skin to 0.07 out
NZ, NU = 64, 44
grid = {}
for side, off in ((0, -0.04), (1, 0.07)):
    for i in range(NZ + 1):
        z = COAT_Z0 + (COAT_Z1 - COAT_Z0) * i / NZ
        for j in range(NU + 1):
            t = hem(z) + (math.pi - 2 * hem(z)) * j / NU
            p, n = surface_n(z, t)
            grid[side, i, j] = bm.verts.new(p + n * off)
slab = []
for side in (0, 1):
    for i in range(NZ):
        for j in range(NU):
            slab.append(bm.faces.new([grid[side, i, j], grid[side, i + 1, j], grid[side, i + 1, j + 1],
                                      grid[side, i, j + 1]]))
for i in range(NZ):                  # the rims: front and back edges, and the hems
    for j in (0, NU):
        slab.append(bm.faces.new([grid[0, i, j], grid[0, i + 1, j], grid[1, i + 1, j], grid[1, i, j]]))
for j in range(NU):
    for i in (0, NZ):
        slab.append(bm.faces.new([grid[0, i, j], grid[0, i, j + 1], grid[1, i, j + 1], grid[1, i, j]]))
for f in slab:
    f.material_index = FUR
bmesh.ops.recalc_face_normals(bm, faces=slab)
cands = []
z = COAT_Z0
while z <= COAT_Z1:
    t = hem(z)
    while t <= math.pi - hem(z):
        p, n = surface_n(z, t)
        if all((p - q).length > 0.24 for q in CRYSTAL_ROOTS):
            cands.append((p, n))
        t += math.radians(3.5)
    z += 0.07
tufts = ml.scatter(cands, 0.24, rng)
for p, n in tufts:
    hang = 1 + 0.6 * max(0.0, 0.45 - n.y)          # longer, heavier clumps down the sides
    ml.tuft(bm, p, n, rng.uniform(0.32, 0.48) * hang, rng.uniform(0.12, 0.155), ml.G + Vector((0, 0, -0.6)), FUR)
print("COAT tufts", len(tufts), "from", len(cands))
ml.to_object("Tardigrade_Fur", bm, rt)

ml.finish(rt, OUT_DIR, "tardigrade", EXTENT)
