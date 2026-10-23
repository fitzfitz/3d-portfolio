# Space monster 1: the saucer alien (original work after the owner's reference
# image, docs/superpowers/specs/assets/2026-10-23-saucer-alien-reference.png;
# same character, proportions and parts, not a trace).
#   $BLENDER --background --python scripts/blender/gen_saucer.py [-- --out DIR] [--stage=blockout]
# Output: assets-src/saucer.glb, assets-src/saucer.blend
#
# Stage "blockout" (look check A: shapes, proportions, size against the ship):
# flat-shaded blockout materials, every part its own named object under the
# root "Saucer", so the final stage can build on them:
#   - Alien_Body: the pear body (round crown, wide jowls) with the open
#     grin cut in (exact boolean; the mouth's inside is the cut wall), plus
#     Alien_Teeth (blocky, slightly uneven), Alien_Tongue;
#   - Alien_EyeL / Alien_EyeR on the face, Alien_EyeTop on the crown (each a
#     ball and a pupil looking along +Z);
#   - Alien_TentacleL / R raised up inside the dome, tips curled;
#     Alien_ArmL / R resting on the rim;
#   - Saucer_Hull: a deep bowl, dark inside; Saucer_Rim: the raised lip the
#     dome sits on; Saucer_Portholes: 16 round portholes (frame + lens) in a
#     ring, number 0 dead ahead; Saucer_Spikes: 4 conical spikes on the
#     diagonals underneath; Saucer_CannonMount + Saucer_Cannon: the domed
#     turret under the bowl's centre, barrel at rest along +Z;
#   - Saucer_Dome: the glass dome, a closed thin shell.
# (Stage "final", Task 3, sculpts, bakes and adds the zones and motion data.)
#
# glTF space: +Y up, the face and the cannon's rest aim +Z, scale 1, origin
# at the centre of mass (uniform density). Longest extent 2.4-3.6 (the
# player's ship is ~2.4). Seeded (the teeth's unevenness): re-running
# reproduces saucer.glb byte for byte. No add-ons: bmesh and one boolean.
import math
import os
import random
import sys

import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import monster_lib as ml  # noqa: E402
from monster_lib import DARK, GLASS, GREY, LIGHT, MID  # noqa: E402

SEED = 20261023
OUT_DIR, STAGE = ml.parse_args("saucer")
EXTENT = (2.4, 3.6)
rng = random.Random(SEED)

# ------------------------------------------------------------ dimensions ---
# (glTF units before the centre-of-mass shift; y = 0 is about the bowl's lip)
SEGS = 64
N_PORTHOLES = 16
PORTHOLE_Y = -0.10
DOME_Y, DOME_A, DOME_B, DOME_T = 0.28, 1.28, 1.62, 0.025   # centre, radius, height, wall
SKIN = MID          # the alien reads lighter than the hull in the blockout
HULL = GREY

scene = ml.reset_scene()
rt = ml.root("Saucer")


def profile_at(prof, y):
    """(r, outward normal (nr, ny)) of a monotone-in-y (r, y) profile at height y."""
    for (r0, y0), (r1, y1) in zip(prof, prof[1:]):
        if min(y0, y1) <= y <= max(y0, y1) and y0 != y1:
            t = (y - y0) / (y1 - y0)
            dr, dy = r1 - r0, y1 - y0
            n = Vector((dy, -dr)).normalized()
            if n.x < 0:
                n = -n
            return r0 + t * dr, n
    raise ValueError(y)


def profile_r(prof, r):
    """(y, outward normal) of the profile where it passes radius r."""
    for (r0, y0), (r1, y1) in zip(prof, prof[1:]):
        if min(r0, r1) <= r <= max(r0, r1) and r0 != r1:
            t = (r - r0) / (r1 - r0)
            dr, dy = r1 - r0, y1 - y0
            n = Vector((dy, -dr)).normalized()
            if n.y > 0:
                n = -n
            return y0 + t * dy, n
    raise ValueError(r)


# ------------------------------------------------------------------ hull ---
OUTER = ml.smooth_profile([(0.0, -0.80), (0.40, -0.78), (0.75, -0.68), (1.05, -0.48), (1.27, -0.22),
                           (1.40, 0.02), (1.44, 0.18)], 8)
INNER = ml.smooth_profile([(1.06, 0.18), (1.00, 0.05), (0.90, -0.15), (0.70, -0.32), (0.0, -0.38)], 6)
bm = bmesh.new()
prof = OUTER + INNER
mats = [HULL] * (len(OUTER) - 1) + [HULL] + [DARK] * (len(INNER) - 1)
ml.lathe(bm, prof, SEGS, mats=mats)
ml.to_object("Saucer_Hull", bm, rt)

bm = bmesh.new()
# a broad lip flaring past the bowl, sloping up to where the dome stands
ml.lathe(bm, [(1.02, 0.15), (1.48, 0.15), (1.545, 0.185), (1.53, 0.235), (1.45, 0.265), (1.12, 0.29),
              (1.05, 0.27), (1.00, 0.21)], SEGS, mi=LIGHT, closed=True)
ml.to_object("Saucer_Rim", bm, rt)

# portholes: frame ring + dark lens, on the bowl's outer wall
bm = bmesh.new()
r_p, n_p = profile_at(OUTER, PORTHOLE_Y)
FRAME = [(0.046, -0.01), (0.078, -0.01), (0.082, 0.015), (0.074, 0.032), (0.052, 0.032), (0.046, 0.015)]
for k in range(N_PORTHOLES):
    a = 2 * math.pi * k / N_PORTHOLES          # k = 0 dead ahead (+Z)
    out = Vector((math.sin(a), 0, math.cos(a)))
    pos = out * r_p + Vector((0, PORTHOLE_Y, 0))
    nrm = (out * n_p.x + Vector((0, n_p.y, 0))).normalized()
    M = ml.place(pos, nrm)
    ml.lathe(bm, FRAME, 24, M, mi=LIGHT, closed=True)
    ml.ellipsoid(bm, M @ Vector((0, 0.012, 0)), (0.052, 0.012, 0.052), 20, 6, DARK, R=ml.rot_to(nrm))
ml.to_object("Saucer_Portholes", bm, rt)

# four spikes on the diagonals, outward and down
bm = bmesh.new()
SPIKE = ml.smooth_profile([(0.0, -0.10), (0.15, -0.10), (0.145, 0.02), (0.11, 0.22), (0.065, 0.42),
                           (0.025, 0.58), (0.0, 0.63)], 4)
y_s, _ = profile_r(OUTER, 0.78)
for k in range(4):
    a = math.radians(45 + 90 * k)
    out = Vector((math.sin(a), 0, math.cos(a)))
    base = out * 0.78 + Vector((0, y_s, 0))
    d = (out * 0.6 + Vector((0, -1, 0))).normalized()
    ml.lathe(bm, SPIKE, 24, ml.place(base, d), mi=MID)
ml.to_object("Saucer_Spikes", bm, rt)

# the cannon: a collar under the bowl, a domed turret, the barrel along +Z
bm = bmesh.new()
ml.lathe(bm, [(0.0, -0.74), (0.27, -0.74), (0.285, -0.79), (0.27, -0.83), (0.0, -0.83)], 40, mi=LIGHT)
ml.to_object("Saucer_CannonMount", bm, rt)
bm = bmesh.new()
TURRET = [(0.0, -0.80), (0.225, -0.80)] + [
    (0.225 * math.cos(math.radians(p)), -0.82 - 0.20 * math.sin(math.radians(p))) for p in range(10, 91, 10)]
ml.lathe(bm, TURRET, 40, mi=MID)
BARREL = [(0.0, 0.0), (0.058, 0.0), (0.058, 0.30), (0.074, 0.31), (0.08, 0.40), (0.046, 0.40),
          (0.046, 0.36), (0.0, 0.36)]
CANNON_C = Vector((0, -0.92, 0))
ml.lathe(bm, BARREL, 24, ml.place(CANNON_C, (0, 0, 1)), mats=[MID] * 5 + [DARK] * 2)
ml.to_object("Saucer_Cannon", bm, rt)

# the dome: a closed thin shell standing on the rim
bm = bmesh.new()
outer = [(DOME_A * math.sin(math.radians(p)), DOME_Y + DOME_B * math.cos(math.radians(p)))
         for p in range(0, 91, 5)]
inner = [(r * (DOME_A - DOME_T) / DOME_A, DOME_Y + (y - DOME_Y) * (DOME_B - DOME_T) / DOME_B) for r, y in outer]
ml.lathe(bm, inner + outer[::-1], SEGS, mi=GLASS)
ml.to_object("Saucer_Dome", bm, rt, smooth_angle=80)


def in_dome(p, margin=0.03):
    a, b = DOME_A - DOME_T - margin, DOME_B - DOME_T - margin
    return (p.x / a) ** 2 + ((p.y - DOME_Y) / b) ** 2 + (p.z / a) ** 2


# ----------------------------------------------------------------- alien ---
BODY = ml.smooth_profile([(0.0, -0.25), (0.45, -0.22), (0.62, 0.0), (0.69, 0.30), (0.68, 0.60),
                          (0.62, 0.90), (0.50, 1.15), (0.30, 1.36), (0.0, 1.44)], 6)
bm = bmesh.new()
ml.lathe(bm, BODY, 48, mi=SKIN)
for v in bm.verts:                       # a little flatter front-to-back, crown nodding forward
    v.co.z = v.co.z * 0.9 + 0.05 * max(v.co.y - 0.3, 0.0)
bvh = BVHTree.FromBMesh(bm)


def front(x, y):
    """(point, normal) where a ray along -Z at (x, y) meets the body."""
    loc, nrm, _, _ = bvh.ray_cast(Vector((x, y, 3.0)), Vector((0, 0, -1)))
    return loc, nrm


body = ml.to_object("Alien_Body", bm, rt)

# the grin: a D-shaped cutter (flat top lip, round jaw), corners pulled up
MOUTH_Y, MA, MB, MC = 0.47, 0.47, 0.25, 0.30
TOP_SQUASH, SMILE = 0.42, 0.40
zf = front(0, MOUTH_Y)[0].z
MOUTH_C = Vector((0, MOUTH_Y, zf + 0.07))
bm = bmesh.new()
ml.ellipsoid(bm, MOUTH_C, (MA, MB, MC), 40, 24, DARK)
for v in bm.verts:
    if v.co.y > MOUTH_Y:
        v.co.y = MOUTH_Y + (v.co.y - MOUTH_Y) * TOP_SQUASH
    v.co.y += SMILE * v.co.x ** 2
cutter = ml.to_object("MouthCutter", bm, None)
ml.boolean_cut(body, cutter)


def lip(x, upper):
    s = math.sqrt(max(0.0, 1 - (x / MA) ** 2)) * 0.97
    return MOUTH_Y + (MB * TOP_SQUASH * s if upper else -MB * s) + SMILE * x * x


bm = bmesh.new()
for x in (-0.30, -0.18, -0.06, 0.06, 0.18, 0.30):          # top row, hanging from the lip
    h = 0.10 * rng.uniform(0.88, 1.12)
    w = 0.095 * rng.uniform(0.92, 1.06)
    yt = lip(x, True)
    p, n = front(x, yt + 0.02)
    M = Matrix.Translation((x, yt + 0.006 - h / 2, p.z - 0.045)) @ Matrix.Rotation(
        math.atan2(n.x, n.z) + rng.uniform(-0.08, 0.08), 4, "Y")
    ml.rounded_box(bm, (w, h, 0.08), M, LIGHT, 0.22)
for x in (-0.24, -0.08, 0.08, 0.24):                          # bottom row, standing on the jaw
    h = 0.095 * rng.uniform(0.85, 1.1)
    yb = lip(x, False)
    p, n = front(x, yb - 0.03)
    M = Matrix.Translation((x, yb - 0.004 + h / 2, p.z - 0.06)) @ Matrix.Rotation(
        math.atan2(n.x, n.z) + rng.uniform(-0.08, 0.08), 4, "Y")
    ml.rounded_box(bm, (0.09 * rng.uniform(0.92, 1.06), h, 0.075), M, LIGHT, 0.22)
ml.to_object("Alien_Teeth", bm, rt)

bm = bmesh.new()
ml.ellipsoid(bm, (0.05, MOUTH_Y - 0.15, zf - 0.13), (0.25, 0.08, 0.15), 32, 16, GREY)
ml.to_object("Alien_Tongue", bm, rt)


def eye(name, p, n, radius, sink, gaze):
    """Ball sunk `sink` along -n into the skin, a dark pupil facing `gaze`."""
    bm = bmesh.new()
    c = p - n * sink
    ml.ellipsoid(bm, c, (radius,) * 3, 32, 18, LIGHT)
    g = Vector(gaze).normalized()
    R = Vector((0, 0, 1)).rotation_difference(g).to_matrix().to_4x4()
    ml.ellipsoid(bm, c + g * radius * 0.93, (radius * 0.52, radius * 0.52, radius * 0.2), 24, 10, DARK, R=R)
    ml.to_object(name, bm, rt)
    return c


for side, name in ((1, "Alien_EyeL"), (-1, "Alien_EyeR")):    # +X is the alien's left
    p, n = front(0.27 * side, 0.98)
    eye(name, p, n, 0.2, 0.075, n * 0.3 + Vector((0, 0, 1)))
loc, n_top, _, _ = bvh.ray_cast(Vector((0, 3.0, 0.14)), Vector((0, -1, 0)))
top_c = eye("Alien_EyeTop", loc, n_top, 0.18, 0.07, (0, 0.25, 1))

# tentacles: two raised up into the dome (tips curled), two resting on the rim
WORST = []


def tentacle(name, ctrl, r0, r1):
    bm = bmesh.new()
    faces, _ = ml.sweep(bm, ctrl, lambda t: r0 + (r1 - r0) * t ** 0.8, ring=18, per_seg=8, mi=SKIN)
    # (the dome starts at its base ring; below that is the bowl)
    WORST.append((name, max(in_dome(v.co) for v in bm.verts if v.co.y > DOME_Y)))
    ml.to_object(name, bm, rt)


tentacle("Alien_TentacleL", [(0.42, 0.55, 0.0), (0.72, 0.74, 0.08), (0.84, 1.03, 0.12), (0.71, 1.33, 0.10),
                             (0.56, 1.56, 0.05), (0.42, 1.63, 0.03), (0.36, 1.52, 0.07)], 0.17, 0.055)
tentacle("Alien_TentacleR", [(-0.42, 0.55, 0.0), (-0.70, 0.80, 0.12), (-0.76, 1.13, 0.16), (-0.64, 1.43, 0.13),
                             (-0.46, 1.60, 0.10), (-0.28, 1.64, 0.12), (-0.22, 1.55, 0.18)], 0.17, 0.055)
for side, name in ((1, "Alien_ArmL"), (-1, "Alien_ArmR")):
    tentacle(name, [(0.45 * side, 0.12, 0.10), (0.66 * side, 0.22, 0.36), (0.82 * side, 0.34, 0.60),
                    (0.83 * side, 0.37, 0.72), (0.80 * side, 0.31, 0.80)], 0.12, 0.06)
top_r = top_c + Vector((0, 0.18, 0))
WORST.append(("Alien_EyeTop", in_dome(top_r)))
for name, w in WORST:
    print("DOME_FIT %-16s %.3f (< 1 is inside the glass)" % (name, w))
    if w >= 1:
        raise SystemExit(f"{name} pokes through the dome")

ml.finish(rt, OUT_DIR, "saucer", EXTENT)
