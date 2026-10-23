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
from monster_lib import DARK, GLASS, GREY, LIGHT, MID, SKIN, SLIME  # noqa: E402

SEED = 20261023
OUT_DIR, STAGE = ml.parse_args("saucer")
EXTENT = (2.4, 3.6)
rng = random.Random(SEED)

# ------------------------------------------------------------ dimensions ---
# (glTF units before the centre-of-mass shift; y = 0 is about the bowl's lip)
SEGS = 64
N_PORTHOLES = 16
PORTHOLE_Y = -0.10
DOME_Y, DOME_A, DOME_B, DOME_T = 0.28, 1.34, 1.72, 0.025   # centre, radius, height, wall
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
bm.normal_update()
bvh = BVHTree.FromBMesh(bm)
BODY_PTS = [(v.co.copy(), v.normal.copy()) for v in bm.verts]


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


# sharp crooked fangs: the top row hangs from the lip, canines longest;
# the bottom row stands on the jaw, its outer pair tusk-like
bm = bmesh.new()
for x, h in ((-0.33, 0.10), (-0.21, 0.17), (-0.09, 0.09), (0.04, 0.11), (0.16, 0.08), (0.27, 0.16)):
    yt = lip(x, True)
    p, n = front(x, yt + 0.02)
    d = Vector((rng.uniform(-0.28, 0.28), -1, rng.uniform(0.05, 0.3))).normalized()
    ml.fang(bm, Vector((x, yt + 0.025, p.z - 0.05)), d, 0.042 * rng.uniform(0.9, 1.15), h * rng.uniform(0.9, 1.1),
            LIGHT, rng.uniform(0, 1))
for x, h in ((-0.30, 0.15), (-0.15, 0.08), (0.0, 0.10), (0.13, 0.07), (0.29, 0.14)):
    yb = lip(x, False)
    p, n = front(x, yb - 0.03)
    d = Vector((rng.uniform(-0.3, 0.3) + 0.25 * x, 1, rng.uniform(0.05, 0.3))).normalized()
    ml.fang(bm, Vector((x, yb - 0.025, p.z - 0.06)), d, 0.04 * rng.uniform(0.9, 1.15), h * rng.uniform(0.9, 1.1),
            LIGHT, rng.uniform(0, 1))
ml.to_object("Alien_Teeth", bm, rt)

bm = bmesh.new()
ml.ellipsoid(bm, (0.05, MOUTH_Y - 0.15, zf - 0.13), (0.25, 0.08, 0.15), 32, 16, GREY)
ml.to_object("Alien_Tongue", bm, rt)

# goo strings from the top jaw to the bottom one, bowed and beaded
bm = bmesh.new()
for x, bow, beads in ((-0.27, 0.03, ((0.62, 0.012),)), (-0.03, 0.045, ()), (0.10, 0.02, ((0.45, 0.016),)),
                      (0.22, 0.035, ())):
    yt, yb = lip(x, True), lip(x, False)
    zt, zb = front(x, yt + 0.02)[0].z, front(x, yb - 0.03)[0].z
    sway = rng.uniform(-0.03, 0.03)
    ml.strand(bm, [Vector((x, yt + 0.01, zt - 0.07)), Vector((x + sway, yt * 0.6 + yb * 0.4, zt - 0.06 + bow)),
                   Vector((x + sway * 0.6, yt * 0.3 + yb * 0.7, zb - 0.06 + bow * 0.8)),
                   Vector((x, yb - 0.005, zb - 0.08))], 0.016, 0.007, SLIME, beads)
ml.to_object("Alien_Goo", bm, rt)

EYES = []


def eye(name, p, n, radius, sink, gaze, pupil=0.4):
    """Ball sunk `sink` along -n into the skin, a small dark pupil facing `gaze`."""
    bm = bmesh.new()
    c = p - n * sink
    ml.ellipsoid(bm, c, (radius,) * 3, 32, 18, LIGHT)
    g = Vector(gaze).normalized()
    R = Vector((0, 0, 1)).rotation_difference(g).to_matrix().to_4x4()
    ml.ellipsoid(bm, c + g * radius * 0.95, (radius * pupil, radius * pupil, radius * 0.16), 24, 10, DARK, R=R)
    ml.to_object(name, bm, rt)
    EYES.append((c, radius, g))
    return c


for side, name in ((1, "Alien_EyeL"), (-1, "Alien_EyeR")):    # +X is the alien's left
    p, n = front(0.27 * side, 0.98)
    eye(name, p, n, 0.2, 0.075, n * 0.3 + Vector((0, 0, 1)))
loc, n_top, _, _ = bvh.ray_cast(Vector((0, 3.0, 0.14)), Vector((0, -1, 0)))
top_c = eye("Alien_EyeTop", loc, n_top, 0.2, 0.035, (0, 0.25, 1))

# heavy angry brows: a lid over each ball, slanting down to the nose, and a
# thick brow roll on its edge; the top eye gets a V brow
bm = bmesh.new()
for c, r, g in EYES[:2]:
    inward = Vector((-math.copysign(1, c.x), 0, 0))
    ml.lid_and_brow(bm, c, r, Vector((0, 1, 0)) + inward * 0.55 + Vector((0, 0, 0.22)), g, inward, SKIN,
                    cover=10, brow=(0.045, 0.09))
c, r, g = EYES[2]
ml.lid_and_brow(bm, c, r, Vector((0, 1, 0.12)), g, None, SKIN, cover=24, dip=0.07, brow=(0.04, 0.08),
                v_shape=True)
ml.to_object("Alien_Brows", bm, rt)

# tentacles: two raised up into the dome (tips curled), two resting on the rim
WORST = []
DRIPS = []


def tentacle(name, ctrl, r0, r1, fur_back):
    """The bare tentacle, and its fur: clumps down the back (the side facing
    `fur_back(point)`), leaving the underside bare."""
    bm = bmesh.new()
    rad = lambda t: r0 + (r1 - r0) * t ** 0.8  # noqa: E731
    _, C = ml.sweep(bm, ctrl, rad, ring=18, per_seg=8, mi=SKIN)
    # (the dome starts at its base ring; below that is the bowl)
    WORST.append((name, max(in_dome(v.co) for v in bm.verts if v.co.y > DOME_Y)))
    ml.to_object(name, bm, rt)
    s = [0.0]
    for i in range(1, len(C)):
        s.append(s[-1] + (C[i] - C[i - 1]).length)
    bm = bmesh.new()
    tips = []
    row = 0
    for i in range(len(C)):
        t = s[i] / s[-1]
        if not 0.12 <= t <= 0.88 or i % 2:
            continue
        tan = (C[min(i + 1, len(C) - 1)] - C[max(i - 1, 0)]).normalized()
        back = ml.perp(fur_back(C[i]), tan).normalized()
        side = tan.cross(back)
        for a in ((-70, -25, 25, 70) if row % 2 == 0 else (-48, 0, 48)):
            a = math.radians(a + rng.uniform(-8, 8))
            nrm = back * math.cos(a) + side * math.sin(a)
            r = rad(t)
            tips.append(ml.tuft(bm, C[i] + nrm * r * 0.8, nrm, rng.uniform(0.15, 0.22) * (1.15 - 0.45 * t),
                                r * rng.uniform(0.5, 0.62), ml.G + tan * 0.3))
        row += 1
    WORST.append((name + " fur", max(in_dome(v.co) for v in bm.verts if v.co.y > DOME_Y)))
    ml.to_object(name.replace("Alien_", "Alien_Fur_"), bm, rt)
    DRIPS.append(min(tips, key=lambda p: p.y))


def outward(p):
    return Vector((p.x, 0.35, p.z * 0.3))


def upward(p):
    return Vector((0, 1, 0))


tentacle("Alien_TentacleL", [(0.42, 0.55, 0.0), (0.68, 0.74, 0.08), (0.78, 1.03, 0.12), (0.65, 1.33, 0.10),
                             (0.50, 1.55, 0.05), (0.38, 1.61, 0.03), (0.33, 1.50, 0.07)], 0.17, 0.055, outward)
tentacle("Alien_TentacleR", [(-0.42, 0.55, 0.0), (-0.66, 0.80, 0.12), (-0.70, 1.13, 0.16), (-0.58, 1.43, 0.13),
                             (-0.42, 1.59, 0.10), (-0.26, 1.62, 0.12), (-0.21, 1.53, 0.18)], 0.17, 0.055, outward)
for side, name in ((1, "Alien_ArmL"), (-1, "Alien_ArmR")):
    tentacle(name, [(0.45 * side, 0.12, 0.10), (0.66 * side, 0.22, 0.36), (0.82 * side, 0.34, 0.60),
                    (0.83 * side, 0.37, 0.72), (0.80 * side, 0.31, 0.80)], 0.12, 0.06, upward)

# the shaggy crown: clumps over the top and back of the head, down to a
# ragged hem that hangs lower behind; the face and the eyes stay bare
bm = bmesh.new()
cands = []
for p, n in BODY_PTS:
    hem = 1.10 + 0.10 * max(n.z, 0.0) - 0.32 * max(-n.z, 0.0) + 0.05 * math.sin(7 * math.atan2(p.x, p.z))
    if p.y < hem or any((p - c).length < r + 0.07 for c, r, _ in EYES):
        continue
    tc, tr, _ = EYES[2]          # nothing grows over the top eye's face
    if p.z > tc.z - 0.04 and abs(p.x) < tr + 0.08:
        continue
    cands.append((p, n))
tips = []
for p, n in ml.scatter(cands, 0.072, rng):
    tips.append(ml.tuft(bm, p, n, rng.uniform(0.22, 0.34), rng.uniform(0.07, 0.09), ml.G + Vector((0, 0, -0.45))))
WORST.append(("Alien_Fur_Crown", max(in_dome(v.co) for v in bm.verts if v.co.y > DOME_Y)))
ml.to_object("Alien_Fur_Crown", bm, rt)
print("CROWN tufts", len(tips))
DRIPS += sorted(tips, key=lambda p: p.y)[:3:2]

# drips off the fur's lowest clumps
bm = bmesh.new()
for p in DRIPS:
    ml.drip(bm, p - Vector((0, 0.01, 0)), rng.uniform(0.12, 0.2), 0.022, SLIME)
WORST.append(("Alien_Drips", max(in_dome(v.co) for v in bm.verts if v.co.y > DOME_Y)))
ml.to_object("Alien_Drips", bm, rt)

# slime smeared over the saucer's lip and down its side, between portholes
bm = bmesh.new()
for k in (1, 5, 6, 9, 12, 14):
    a = 2 * math.pi * (k + 0.5) / N_PORTHOLES
    out = Vector((math.sin(a), 0, math.cos(a)))
    y_end = rng.uniform(-0.34, -0.06)
    pts = [out * 1.36 + Vector((0, 0.285, 0)), out * 1.50 + Vector((0, 0.25, 0)), out * 1.565 + Vector((0, 0.19, 0)),
           out * 1.50 + Vector((0, 0.135, 0))]
    for y in [0.09, 0.0, -0.1, -0.2, -0.3]:
        if y > y_end:
            pts.append(out * (profile_at(OUTER, y)[0] + 0.012) + Vector((0, y, 0)))
    pts.append(out * (profile_at(OUTER, y_end)[0] + 0.012) + Vector((0, y_end, 0)))
    ml.strand(bm, pts, 0.05, 0.034, SLIME)
    ml.drip(bm, pts[-1], rng.uniform(0.08, 0.2), 0.03, SLIME)
ml.to_object("Saucer_Slime", bm, rt)

top_r = top_c + Vector((0, 0.2, 0))
WORST.append(("Alien_EyeTop", in_dome(top_r)))
for name, w in WORST:
    print("DOME_FIT %-22s %.3f (< 1 is inside the glass)" % (name, w))
    if w >= 1:
        raise SystemExit(f"{name} pokes through the dome")

ml.finish(rt, OUT_DIR, "saucer", EXTENT)
