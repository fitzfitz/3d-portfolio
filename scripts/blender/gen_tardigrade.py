# Space monster 2: a tardigrade (water bear), scaled up to ~3x the player's
# ship (original work, 100% procedural).
#   $BLENDER --background --python scripts/blender/gen_tardigrade.py [-- --out DIR] [--stage=final|blockout]
# Output: assets-src/tardigrade.glb, assets-src/tardigrade.blend, and (final
# stage) src/data/tardigradeRig.json (next to the glb instead when --out is given).
#
# Stage "blockout" (look check A, approved as v3 on 2026-10-23: shapes,
# proportions, size against the ship): flat blockout materials, every part
# its own named object under the root "Tardigrade":
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
#   - (revision v2/v3, scarier: furry and slimy) Tardigrade_Fur: a long,
#     shaggy, drooping coat (a closed matted slab under long wet locks laid
#     along the body and hanging to near the belly line; a coarse proxy for
#     the shell-fur envelope) over the back and sides, the crystals poking
#     through; Tardigrade_Drips off a few lock tips; the belly, legs, claws
#     and mouth tube stay bare; Tardigrade_Teeth: two rings of raked teeth
#     inside the (wider) mouth tube; Tardigrade_Drool; Tardigrade_Brows:
#     scowling lids, thick brow ridges laid on the head's curve, furrows.
#
# Stage "final" (the default; Task 4): the blockout above is the sculpt (the
# high mesh: the same parts, with a ribbed, fluted rim on the mouth tube,
# finer teeth and claws and per-part coordinates for its materials), rebuilt
# from the same seeded layout at game resolution (the low mesh) and baked
# onto it, the saucer's method (gen_saucer.py, monster_bake.py): an exploded
# selected-to-active bake (every part pair moved apart first, so no ray hits
# a neighbour), 2x supersampled and box-filtered down, AO baked on the game
# mesh (the coat's blockout proxy as an occluder) and multiplied into the
# base colour. Repeated parts share one UV island (the 8 legs, the 32 claws,
# the 22 teeth, the 2 eyes, the crystals, the drool and the drips); the
# body's skin has its own cylindrical unwrap (arc length round the
# cross-section and along the body) with its seam down the belly's midline.
# The look, all procedural node fields (recipes below):
#   - skin: warm tan-pink, mottled and freckled, soft tubercles and pores,
#     fine wrinkles running round the body, the folds between the segments
#     flushed darker red and creased with fine rings (wetter in the folds), a
#     wet sheen in patches, the belly paler; thinness (_MOTION.w) drives the
#     game's translucency;
#   - legs: the skin, ringed with creases, flushed toward the feet;
#   - mouth tube: ring ribs round the tube and a fluted (ribbed) rolled rim,
#     its lip wet pink-red, into a dark ridged throat that carries the beam
#     charge's glow (the emissive map, COLOR_0 R);
#   - teeth: off-white, yellowed toward the root, gum-red at it;
#   - claws: near-black horn, lighter toward the tip, glossy, streaked;
#   - crystals: faceted, cyan at the tip to violet at the root, fractured,
#     glowing (the emissive map, COLOR_0 G), a dark crust where they break
#     out of the skin;
#   - eyes: small, glossy, near-black with a mean deep-red iris ring;
#   - slime (drool and drips): pink, near-mirror wet, bubbled, paler and
#     clearer where thin.
# The coat is shell fur (spec Revision; R7, as the saucer): a fur-base
# primitive (the body's skin over the back and sides, split off along the
# blockout's ragged hem, which the game mesh's grid follows exactly) the
# game draws N times outward, alpha-testing a tiling strand/clump mask, plus
# lock cards (LOD0 only): every v3 lock (the approved shaggy outline: laid
# along the body's curve, higher rows over lower ones, then hanging to near
# the belly line), each a crossed pair of cards along the lock's own curve
# (a ribbon lying across it and a fin standing on it) textured as a hair
# lock (monster_bake.fur_lock_atlas), with gaps round the crystals' roots.
# The shells are not in the file. Raw-material provenance: every map is
# generated here (Cycles bakes of the node fields below, and the numpy
# strand masks of monster_bake); no image, scan or add-on is used.
#
# CONTRACT with the combat stage (Task 5's tardigrade material) and
# tests/assetContracts.test.ts. glTF space, +Y up, the mouth +Z (the beam
# fires along +Z), scale 1, origin at the centre of mass (uniform density, as
# the blockout). Longest extent 6.5-7.5 (the player's ship is ~2.4).
#   Nodes "Tardigrade_LOD0" and "Tardigrade_LOD1" (no parent), each one mesh
#   of two primitives (2 draw calls for a group), no extensions, no tangents:
#   - "TardigradeBaked": baseColor (x AO, 2048) + metallicRoughness (512) +
#     normal (1536) + emissive (1024: the crystals' glow, and the throat's
#     glow at full charge) (R15).
#   - "TardigradeFur": alphaMode MASK, alphaCutoff 0.01 (as the saucer's R14;
#     the game raises it per shell), double-sided (the cards), baseColor
#     (1024 x 512) + normal (512 x 256), one atlas:
#       - the left half (rig furAtlas.shells) is the shells' tiling strand
#         mask: alpha the strand height (floored at 0.03, ~5/255 over the
#         cutoff, so lossy WebP alpha and mips keep the remapped base whole),
#         RGB the strand colour root (dark mauve) to tip, one repeat per
#         FUR_TILE (0.6) u. The fur base's TEXCOORD_0 is unbounded (tiling)
#         coordinates: the shells and the base sample (fract(u) x 0.5,
#         fract(v)) (take the gradients from the unwrapped uv, so the mips do
#         not seam). It is the body's cylindrical unwrap, so it runs on
#         unbroken over the whole back;
#       - the right half (rig furAtlas.locks) holds 4 lock variants side by
#         side (v 0 root -> 1 tip): a card's TEXCOORD_0 points into it as is.
#         Outside a lock alpha is 0, so a stock viewer cuts a card to its
#         lock (and shows the unremapped base's lock-coverage holes where it
#         tiles onto this half: accepted, as the saucer's R14a).
#   COLOR_0 is a zone mask, never a colour (a stock glTF viewer multiplies it
#   into the base colour; the game's material must not; turntable_monsters.py
#   routes it out). Each channel 0 or 1: on TardigradeBaked R = the mouth
#   glow zone (the throat: the game scales its emissive by the beam charge,
#   0 -> full), G = the crystal glow zone (the game may pulse it), B = 0. On
#   TardigradeFur R = 1 on card vertices, 0 on the fur base; G = B = 0.
#   _MOTION (vec4, every channel in [0, 1]), on both primitives:
#     x = part slot (id + 0.5) / 16: 0 body (skin, lids, brow ridges and
#         furrows, the fur base and every lock card: the coat hangs on the
#         body, not the legs), 1-8 legs with their claws (front-left 1,
#         front-right 2, mid-left 3, ... back-right 8; +X is the animal's
#         left), 9 mouth tube, 10 crystals, 11 eyes, 12 drool (strands off
#         the mouth tube's lip), 13 body/fur-host drips (each hangs where its
#         lock is still solid, 0.72-0.80 of the way along it; LOD1 has no
#         locks, so it has no part 13), 14 teeth (the two rings inside the
#         tube: they move with it);
#     y = axial position along the rig's axis, tail 0 -> mouth 1 (the
#         projection onto axis.tail -> axis.mouth, clamped), on every part
#         but these two: on drool (12) and drips (13) the strand's own root 0
#         -> tip 1 (they stretch and sway; drool lengthens while charging);
#     z = leg weight on a leg (1-8): 0 at the hip -> 1 at the claw tips (the
#         projection onto the leg's direction from its hip over its reach);
#         on a drip (13) the axial y of its host at its root (so it follows
#         the undulation); 0 everywhere else (drool too);
#     w = thinness for the translucent skin term, 0 thick -> 1 thin (1 -
#         thickness / 0.9 along the inward normal; the eyes 0).
#   _FUR (vec2, [0, 1]), on TardigradeFur only:
#     x on the fur base = the fur's length there / furMaxLength (0 at the
#         coat's edges: the hem, behind the head, round each crystal's root,
#         so the shells close onto the skin there; longest on the flanks);
#         on a lock card vertex = the alpha-test height along the lock
#         (lock_x: 0.04 at its root rising to 0.34 at its tip; the lock's own
#         texture carries its shape);
#     y = wetness / matting, 0 dry and fluffy -> 1 wet and clumped (wetter
#         toward the hem and toward the locks' tips).
#   src/data/tardigradeRig.json (glTF, origin-relative):
#     hips: the 8 hips on the body's surface, in leg order (pairs mirror
#       across x = 0), the legs' paddle pivots;
#     axis: {tail, mouth}: the body's axis, tail pole -> the mouth tube's
#       lip centre (_MOTION.y's ends);
#     curlCentre: the tun ball's centre: the axis's midpoint moved square to
#       the axis toward the belly by L / 2pi (L the axis's length). Bending
#       the axis round it through 2pi (each point at axial y to angle
#       2pi (y - 0.5) on a circle of radius L / 2pi, its cross-section turned
#       with the tangent) closes the tail onto the mouth: a ball. At partial
#       curl k (0..1) the circle's radius is L / (2pi k) and its centre the
#       midpoint moved that far the same way, so k = 0 is the straight body;
#     mouth: the beam's origin, the mouth tube's lip centre;
#     furMaxLength, furShells (8-24), furAtlas (as the saucer's);
#     lod1Distance: where LOD1's 90th-percentile geometric error (over LOD0
#       less the cards and drips LOD1 drops) projects to one pixel at the
#       game's resting view (sphereLod.ts's 58 deg on 802 px).
#   LOD1 is LOD0 decimated part by part (no cards, no drips), its
#   open-boundary and material-edge vertices (and the claw tips) held fixed,
#   so it stays closed (the fur base's hem against the skin too); it shares
#   LOD0's maps. The body's skin and fur base carry the analytic body
#   surface's normals (custom normals), so the shading and the shells do not
#   depend on the game mesh's triangulation. Lock-card vertices carry the
#   body's normal (custom normals); the ribbon's are turned out across its
#   width, so each lock shades round.
#   Blender 5.1's glTF importer mis-orders meshes with two custom attributes
#   (_MOTION and _FUR) by hash seed; turntable_monsters.py reads them itself.
#
# Seeded (layout, teeth, crystals, fur, drips, maps): re-running reproduces
# tardigrade.glb byte for byte (the .blend is not byte-reproducible). No
# add-ons: bmesh, Cycles bakes.
import json
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from bpy_extras.bmesh_utils import bmesh_linked_uv_islands
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import monster_bake as mb  # noqa: E402
import monster_lib as ml  # noqa: E402
from monster_lib import DARK, FUR, LIGHT, SKIN, SLIME  # noqa: E402

SEED = 20261024
OUT_DIR, STAGE = ml.parse_args("tardigrade", stages=("blockout", "final"), default="final")
EXTENT = (6.5, 7.5)
TAU = 2 * math.pi

# ------------------------------------------------------------ dimensions ---
HALF = 3.25                     # body runs z -3.25 (tail) .. +3.25 (snout)
RMAX = 1.36
FOLDS = (1.94, 0.63, -0.68, -1.99)   # segment boundaries: head | 2 | 3 | 4 | tail
FOLD_DEPTH, FOLD_W = 0.09, 0.16
ARCH = 0.12                     # the back's arch (head and tail sit lower)
BELLY, BACK = 0.72, 0.92        # cross-section half-heights below/above, x RMAX
RINGS, SEGS = 160, 40
CLAW = DARK


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


def body_pt(z, theta):
    """The final stage's body surface: surface(), with the back's and the
    belly's half-ellipses blended across the side line (v3 switched at it, a
    slope crease the length of each flank that caught the sun as a line).
    The layout (locks, hips, crystals) stays on surface()."""
    r = radius(z)
    s = math.sin(theta)
    k = BELLY + (BACK - BELLY) * smoothstep(-0.3, 0.3, s)
    return Vector((r * math.cos(theta), centre_y(z) + r * s * k, z))


def body_n(z, theta, h=1e-3):
    dz = body_pt(z + h, theta) - body_pt(z - h, theta)
    dt = body_pt(z, theta + h) - body_pt(z, theta - h)
    return dt.cross(dz).normalized()


def body_theta(p):
    """theta of glTF point p on body_pt's cross-section (a few Newton steps
    from theta_of)."""
    z = max(-HALF + 1e-4, min(HALF - 1e-4, p.z))
    th = theta_of(p)
    for _ in range(6):
        q = body_pt(z, th)
        d = (body_pt(z, th + 1e-4) - body_pt(z, th - 1e-4)) / 2e-4
        th -= ((q - p).dot(d)) / max(d.length_squared, 1e-9)
    return th


def onto_body(P):
    """The body surface point (and normal) under P, along the cross-section."""
    dy = P.y - centre_y(P.z)
    return surface_n(P.z, math.atan2(dy / (BACK if dy > 0 else BELLY), P.x))


def fold(z):
    """0 between the segments' folds -> 1 in a fold."""
    return min(1.0, sum(math.exp(-((z - zk) / FOLD_W) ** 2) for zk in FOLDS))


def theta_of(p):
    """The angle (as surface()'s theta) of a point about the body's axis."""
    dy = p.y - centre_y(max(-HALF, min(HALF, p.z)))
    return math.atan2(dy / (BACK if dy > 0 else BELLY), p.x)


def inside_body(p, margin=0.0):
    z = p.z
    if abs(z) >= HALF:
        return False
    r = radius(z) + margin
    dy = p.y - centre_y(z)
    s = BACK if dy > 0 else BELLY
    return (p.x / r) ** 2 + (dy / (r * s + margin * (1 - s))) ** 2 < 1.0


# ----------------------------------------------------------------- mouth ---
# a short tube out of the snout: rolled lip, a wide dark bore lined with
# two rings of small teeth raked inward, and drool hanging off the lip
MOUTH_Z = 3.06
BORE = 0.25
TUBE = [(0.0, -0.25), (0.40, -0.25), (0.41, 0.20), (0.45, 0.36), (0.46, 0.45), (0.43, 0.53), (0.37, 0.565),
        (0.31, 0.55), (0.27, 0.49), (BORE + 0.005, 0.36), (BORE, 0.06), (0.0, 0.06)]
TUBE_L = TUBE[1:]                  # the game mesh: the base pole is buried in the snout (open)
MC = Vector((0, centre_y(MOUTH_Z), MOUTH_Z))
AX = Vector((0, 0, 1))
MOUTH_TIP = MC + AX * 0.565        # the lip's centre: the beam's origin
# the game mesh's body ends in a flat cap where it meets the tube's outside
# (v3's snout dome rose inside the bore, over the throat's floor)
SNOUT_Z = 3.115

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

# -------------------------------------------------------------- crystals ---
CRYSTALS = ((1.31, 14), (0.42, -16), (-0.42, 12), (-1.26, -14), (-2.04, 10))
CRYSTAL_ROOTS = [surface_n(z, math.radians(90 + off))[0] for z, off in CRYSTALS]


# ------------------------------------------------------------------ coat ---
def hem(z):
    """How far below the side (radians) the coat reaches at axial z."""
    return math.radians(-20 + 9 * math.sin(2.3 * z + 0.7))


COAT_Z0, COAT_Z1 = -HALF + 0.04, FOLDS[0] + 0.06
ROWS = (84, 62, 40, 18)            # root angle above the side, degrees
STEP = 0.2


def lock(rng, z0, a0, side):
    """Points (and the body's normal under each) of one lock from root (z0,
    a0 deg above the side) on `side`: laid along the body's curve, combed a
    little back, then hanging free under gravity (the normal of the last
    laid point carries on down the hanging part)."""
    lift = 0.05 + 0.12 * a0 / 90
    t = math.radians(90 - side * (90 - a0))
    z = z0
    p, n = surface_n(z, t)
    pts, nrm = [p - n * 0.06], [n]
    hang_i = None
    y_tip = centre_y(z0) - radius(z0) * rng.uniform(0.38, 0.74)
    sway = Vector((side * rng.uniform(-0.04, 0.16), 0, rng.uniform(-0.22, 0.1)))
    done = 0.0
    while pts[-1].y > y_tip and len(pts) < 400:
        above = (t if side > 0 else math.pi - t)
        if above > math.radians(-6):
            t -= side * STEP / max(radius(z), 0.35)
            z -= 0.018
            p, n = surface_n(z, t)
            pts.append(p + n * (lift + 0.03 * done))
            nrm.append(n)
        else:
            if hang_i is None:
                hang_i = len(pts)
            pts.append(pts[-1] + (ml.G + sway).normalized() * STEP)
            nrm.append(nrm[-1])
        done += STEP
    return pts, nrm, hang_i


# ---------------------------------------------------- the final's contract ---
P_BODY, P_TUBE, P_CRYSTAL, P_EYE, P_DROOL, P_DRIP, P_TEETH = 0, 9, 10, 11, 12, 13, 14
AXIS_TAIL = Vector((0, centre_y(-HALF), -HALF))
AXIS_MOUTH = MOUTH_TIP.copy()
AXIS_L = (AXIS_MOUTH - AXIS_TAIL).length
AXIS_U = (AXIS_MOUTH - AXIS_TAIL) / AXIS_L


def axial(p):
    """_MOTION.y: the position along the body's axis, tail 0 -> mouth 1."""
    return max(0.0, min(1.0, (Vector(p) - AXIS_TAIL).dot(AXIS_U) / AXIS_L))


FUR_MAX = 0.24         # glTF units: the longest shell fur (the flanks)
FUR_CUTOFF = 0.01      # TardigradeFur's alphaCutoff (as the saucer's R14)
FUR_SHELLS = 16
FUR_TILE = 0.6         # world units per repeat of the strand mask (4 x 4 clumps of ~0.15)
THIN_D = 0.9           # thickness (glTF units) at which _MOTION.w reaches 0
K_TOP, K_BOT = 20, 14  # the game mesh body's columns over the coat (hem to hem) and under the belly
LOW_RINGS = 52
CRYSTAL_GAP = 0.22     # bare skin round each crystal's root (the coat parts round it)
DRIP_ON_LOCK = (0.76, 0.74, 0.78, 0.72, 0.80)   # where along its lock a drip may hang, best first

# Resolution profiles. BLOCK is the approved v3 blockout, number for number.
# HIGH is the final stage's sculpt (BLOCK with a ribbed rim and finer teeth
# and claws); LOW the game mesh.
BLOCK = dict(final=False, hi=True, tube=40, fang=(6, False), drool=(8, 4, 3), eye=(20, 12), lid=(32, 10),
             ridge=(14, 5, 4), furrow=(8, 4, 3), leg=(20, 5, 3), claw=(10, 5, 3), drip=(8, 4, 3))
HIGH = dict(BLOCK, final=True, tube=180, fang=(12, False), claw=(14, 6, 3), eye=(64, 32))
LOW = dict(final=True, hi=False, tube=32, fang=(5, True), drool=(6, 2, 2), eye=(16, 9), lid=(12, 3),
           ridge=(7, 2, 2), furrow=(6, 2, 2), leg=(12, 1, 3), claw=(6, 1, 1), drip=(6, 1, 2))


# ------------------------------------------------------------------- misc ---
def arc_t(C):
    s = [0.0]
    for i in range(1, len(C)):
        s.append(s[-1] + (C[i] - C[i - 1]).length)
    return [x / s[-1] for x in s]


def nearest_t(C, T, p):
    """Arc fraction along centreline C (fractions T) of the point nearest p."""
    best, bt = 1e9, 0.0
    for i in range(len(C) - 1):
        a, b = C[i], C[i + 1]
        ab = b - a
        u = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
        d = (a + ab * u - p).length_squared
        if d < best:
            best, bt = d, T[i] + (T[i + 1] - T[i]) * u
    return bt


def card_rows(c, k_rows=None):
    """A lock card's rows along its v3 lock: (t, point, body normal, tangent)
    at even arc fractions, root (on the skin) to tip; `k_rows` rows (else by
    the lock's length, one per ~0.4 u, 4-8)."""
    pts, nrm = c["pts"], c["nrm"]
    P = [pts[0] + nrm[0] * 0.06] + list(pts[1:])     # (the root up onto the skin)
    dense = ml.catmull(P, 2)
    dn = []
    for j in range(len(dense)):
        i, f = min(j // 2, len(nrm) - 1), (j % 2) / 2
        a, b = nrm[i], nrm[min(i + 1, len(nrm) - 1)]
        dn.append((a * (1 - f) + b * f).normalized())
    T = arc_t(dense)
    # (where the lock leaves the body and starts to hang)
    c["t_hang"] = T[min((c["hang_i"] - 1) * 2, len(T) - 1)] if c.get("hang_i") else 1.0
    length = sum((dense[i + 1] - dense[i]).length for i in range(len(dense) - 1))
    K = k_rows or max(4, min(8, round(length / 0.4) + 1))
    rows = []
    for r in range(K):
        t = r / (K - 1)
        j = max(0, min(len(T) - 2, next((q for q in range(len(T) - 1) if T[q + 1] >= t), len(T) - 2)))
        f = (t - T[j]) / max(T[j + 1] - T[j], 1e-9)
        p = dense[j].lerp(dense[j + 1], f)
        n = dn[j].lerp(dn[j + 1], f).normalized()
        tan = (dense[min(j + 1, len(dense) - 1)] - dense[max(j, 0)]).normalized()
        rows.append((t, p, n, tan))
    return rows, length


def row_at(rows, t):
    """(point, normal) on a card's centreline polyline at arc fraction t."""
    for (t0, p0, n0, _), (t1, p1, n1, _) in zip(rows, rows[1:]):
        if t0 <= t <= t1:
            f = (t - t0) / max(t1 - t0, 1e-9)
            return p0.lerp(p1, f), n0.lerp(n1, f).normalized()
    return rows[-1][1], rows[-1][2]


def leg_frame(hip_z, below, d_left, side):
    """(hip, unit direction, foot, curl, side vector, sole, claw control
    points x 4, reach) of one leg, exactly as v3 builds it."""
    d = Vector((d_left.x * side, d_left.y, d_left.z)).normalized()
    theta = math.radians(180 + below) if side < 0 else math.radians(-below)
    hip, _ = surface_n(hip_z, theta)
    foot = hip + d * LEG_LEN
    curl = Vector((0, -1, 0)) if d.z < -0.5 else Vector((0, -0.3, 1))
    curl = (curl - d * curl.dot(d)).normalized()
    side_v = d.cross(curl).normalized()
    sole = foot + d * FOOT_R * 0.55
    claws = []
    for a in CLAW_SPREAD:
        a = math.radians(a)
        off = curl * math.cos(a) + side_v * math.sin(a)
        base = sole + off * FOOT_R * 0.62
        claws.append([base - d * 0.08, base + d * 0.06 + off * 0.05, base + d * 0.15 + curl * 0.08 + off * 0.08,
                      base + d * 0.17 + curl * 0.22 + off * 0.09])
    reach = max(max((p - hip).dot(d) for p in c) for c in claws) + 0.012
    return hip, d, foot, claws, reach


def drip_anchor(c, length, legs):
    """Where a drip hangs on lock card c: on its centreline at one of
    DRIP_ON_LOCK (the solid part of the lock, variant 0's long centre
    clump), nudged onto its outer face, with the whole drip clear of the body
    and the legs. None if no such point."""
    rows, _ = card_rows(c)
    for t in DRIP_ON_LOCK:
        p, n = row_at(rows, t)
        top = p + n * 0.035
        ok = True
        for k in (0.0, 0.25, 0.5, 0.75, 1.0):
            q = top + ml.G * length * k
            if inside_body(q, 0.05):
                ok = False
            for hip, d, foot, _, _ in legs:
                ab = foot - (hip - d * 0.35)
                u = max(0.0, min(1.0, (q - (hip - d * 0.35)).dot(ab) / ab.length_squared))
                if (q - ((hip - d * 0.35) + ab * u)).length < HIP_R + 0.05:
                    ok = False
        if ok:
            return t, p, top
    return None


# ------------------------------------------------------------------ sinks ---
class Span:
    """The vertices and faces a builder adds to a bmesh (they append in order)."""

    def __init__(self, bm):
        self.bm = bm
        self.v0, self.f0 = len(bm.verts), len(bm.faces)
        self.v1 = self.f1 = None

    def close(self):
        self.v1, self.f1 = len(self.bm.verts), len(self.bm.faces)

    def verts(self):
        self.bm.verts.ensure_lookup_table()
        return [self.bm.verts[i] for i in range(self.v0, len(self.bm.verts) if self.v1 is None else self.v1)]

    def faces(self):
        self.bm.faces.ensure_lookup_table()
        return [self.bm.faces[i] for i in range(self.f0, len(self.bm.faces) if self.f1 is None else self.f1)]


class _Piece:
    def __init__(self, sink, bm, meta):
        self.sink, self.bm, self.meta = sink, bm, meta

    def __enter__(self):
        self.span = Span(self.bm)
        self.info = dict(self.meta)
        return self.info

    def __exit__(self, *exc):
        if exc[0] is None:
            self.span.close()
            self.sink.close_piece(self.bm, self.span, self.info)


class BlockSink:
    """The blockout: one object per name, built as v3 built it."""
    final = False

    def __init__(self, rt):
        self.rt = rt
        self.objects = []

    def obj(self, name):
        return bmesh.new()

    def piece(self, bm, **meta):
        return _Piece(self, bm, meta)

    def close_piece(self, bm, span, info):
        pass

    def done(self, name, bm, smooth_angle=50.0):
        ob = ml.to_object(name, bm, self.rt, smooth_angle=smooth_angle)
        self.objects.append(ob)
        return ob


class HighSink(BlockSink):
    """The final stage's sculpt: the blockout objects, each vertex tagged with
    its bake group ("grp"), its glTF position ("gp") and, where a part has
    one, its local frame position ("lc") and a scalar ("ft")."""
    final = True

    def __init__(self, rt):
        super().__init__(rt)
        self.grp = 0
        self.groups = {}

    def obj(self, name):
        bm = bmesh.new()
        bm.verts.layers.int.new("grp")
        bm.verts.layers.float_vector.new("gp")
        bm.verts.layers.float_vector.new("lc")
        bm.verts.layers.float.new("ft")
        bm.faces.layers.int.new("bk")
        return bm

    def close_piece(self, bm, span, info):
        self.grp += 1
        g = self.grp
        L = bm.verts.layers
        lg, lgp, llc, lft = L.int["grp"], L.float_vector["gp"], L.float_vector["lc"], L.float["ft"]
        lbk = bm.faces.layers.int["bk"]
        Minv = info["M"].inverted() if "M" in info else None
        C = info.get("C")
        T = arc_t(C) if C else None
        for v in span.verts():
            v[lg] = g
            v[lgp] = v.co
            if Minv is not None:
                v[llc] = Minv @ v.co
            if "ftf" in info:
                v[lft] = info["ftf"](v.co, Minv @ v.co if Minv is not None else None)
            elif C:
                v[lft] = nearest_t(C, T, v.co)
        bake = info.get("bake", {})
        for f in span.faces():
            name = bake.get(f.material_index)
            f[lbk] = BAKE_IDS[name] + 1 if name else 0
        info["grp"] = g
        self.groups[g] = info


class LowSink:
    """The game mesh: one bmesh, every face tagged with its bake material,
    motion part, glow zones, shared-UV group, primitive and bake group,
    every vertex with its _MOTION y and z, fur data and part."""
    final = True

    def __init__(self):
        bm = self.bm = bmesh.new()
        for k in ("bk", "part", "zone", "shg", "shi", "shk", "prim", "grp", "card"):
            bm.faces.layers.int.new(k)
        for k in ("ay", "lz", "flen", "wet", "cardf", "thin"):
            bm.verts.layers.float.new(k)
        for k in ("vpart", "vgrp"):
            bm.verts.layers.int.new(k)
        self.grp = 0
        self.share_ids, self.share_count = {}, {}
        self.pieces = []

    def obj(self, name):
        return self.bm

    def piece(self, bm, **meta):
        return _Piece(self, bm, meta)

    def done(self, name, bm, smooth_angle=50.0):
        return None

    def close_piece(self, bm, span, info):
        self.grp += 1
        g = info["grp"] = self.grp
        F = bm.faces.layers.int
        V = bm.verts.layers.float
        VI = bm.verts.layers.int
        sh = info.get("share")
        if sh:
            gid = self.share_ids.setdefault(sh, len(self.share_ids) + 1)
            inst = self.share_count.get(sh, 0)
            self.share_count[sh] = inst + 1
        bake = info.get("bake", {})
        zone = info.get("zone", (0, 0, 0))
        faces = span.faces()
        for k, f in enumerate(faces):
            name = bake.get(f.material_index)
            if name is None:
                raise SystemExit(f"{info.get('name')}: no bake material for blockout material {f.material_index}")
            z = zone.get(f.material_index, (0, 0, 0)) if isinstance(zone, dict) else zone
            f[F["bk"]] = BAKE_IDS[name]
            f[F["part"]] = info["part"]
            f[F["zone"]] = z[0] | z[1] << 1 | z[2] << 2
            f[F["prim"]] = 0
            f[F["grp"]] = g
            f[F["card"]] = 0
            if sh:
                f[F["shg"]], f[F["shi"]], f[F["shk"]] = gid, inst, k
        C = info.get("C")
        T = arc_t(C) if C else None
        yf, zf = info.get("wgt", "axial"), info.get("lz", 0.0)
        for v in span.verts():
            v[VI["vpart"]] = info["part"]
            v[VI["vgrp"]] = g
            v[V["ay"]] = nearest_t(C, T, v.co) if yf == "C" else axial(v.co)
            v[V["lz"]] = zf(v.co) if callable(zf) else float(zf)
        if "after" in info:
            info["after"](bm, span, info)
        self.pieces.append((span, info))


# ------------------------------------------------------------------- body ---
def low_ring_z(n):
    """The game mesh body's ring positions: denser in the folds and toward the
    poles; one ring exactly on the coat's front edge (COAT_Z1)."""
    zs = np.linspace(-HALF, HALF, 6001)
    dens = 1.0 + 2.0 * sum(np.exp(-((zs - zk) / 0.17) ** 2) for zk in FOLDS) + \
        3.5 * np.exp(-(HALF - np.abs(zs)) / 0.2)
    cdf = np.concatenate([[0.0], np.cumsum((dens[1:] + dens[:-1]) * 0.5 * np.diff(zs))])
    cdf /= cdf[-1]
    z = np.interp((np.arange(n) + 1) / (n + 1), cdf, zs)
    k = int(np.argmin(np.abs(z - COAT_Z1)))
    z[k] = COAT_Z1
    return [float(v) for v in z]


def low_body(bm):
    """The game mesh's body: the analytic surface on a grid whose column
    K_TOP and column 0 run exactly along the coat's ragged hem on each side
    (the columns over the back spread hem to hem, those under the belly hem
    to hem the other way), so the fur base splits off along a smooth line;
    the belly's midline is a column (the skin unwrap's seam). The snout ends
    in a flat cap at SNOUT_Z, inside the tube's wall."""
    rings = [[bm.verts.new((0, centre_y(-HALF), -HALF))]]
    for z in [z for z in low_ring_z(LOW_RINGS) if z < SNOUT_Z - 0.03] + [SNOUT_Z]:
        th_h = hem(z)
        ring = []
        for j in range(K_TOP + K_BOT):
            if j <= K_TOP:
                th = th_h + (math.pi - 2 * th_h) * j / K_TOP
            else:
                th = (math.pi - th_h) + (math.pi + 2 * th_h) * (j - K_TOP) / K_BOT
            ring.append(bm.verts.new(body_pt(z, th)))
        rings.append(ring)
    rings.append([bm.verts.new((0, centre_y(SNOUT_Z), SNOUT_Z))])
    n = K_TOP + K_BOT
    faces = []
    for A, B in zip(rings, rings[1:]):
        for k in range(n):
            k1 = (k + 1) % n
            vs = (A[0], B[k1], B[k]) if len(A) == 1 else (A[k], A[k1], B[0]) if len(B) == 1 else (
                A[k], A[k1], B[k1], B[k])
            f = bm.faces.new(vs)
            f.material_index = SKIN
            faces.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=faces)


def coat_angle(p):
    """(angular distance above the nearer hem in radians (< 0 off the coat), z)."""
    z = p.z
    th_h = hem(z)
    th = theta_of(p)
    while th < th_h - 1.0:
        th += TAU
    while th >= th_h - 1.0 + TAU:
        th -= TAU
    return min(th - th_h, (math.pi - th_h) - th), z


def is_coat(p):
    d_ang, z = coat_angle(p)
    return d_ang > 0 and z < COAT_Z1 and min((p - c).length for c in CRYSTAL_ROOTS) >= CRYSTAL_GAP


def coat_len(p):
    """(shell length, wetness) of the fur base at p: longest on the flanks,
    closing to the skin at the hem, behind the head, round each crystal's
    root and at the tail's tip; wetter toward the hem."""
    d_ang, z = coat_angle(p)
    if d_ang <= 0:
        return 0.0, 0.0
    d_hem = d_ang * radius(z)
    d_cry = min((p - c).length for c in CRYSTAL_ROOTS) - CRYSTAL_GAP
    ramp = smoothstep(0.0, 0.2, d_hem) * smoothstep(0.0, 0.22, COAT_Z1 - z) * smoothstep(0.0, 0.16, d_cry) * \
        smoothstep(-HALF + 0.02, -HALF + 0.35, z)
    flank = 1 - abs(math.sin(theta_of(p)))
    return (0.17 + 0.07 * flank) * ramp, 0.25 + 0.6 * (1 - smoothstep(0.0, 0.7, d_hem))


def body_after(bm, span, info):
    """The coat's skin splits off into the fur base (prim 2), its shell
    length and wetness per vertex."""
    F, V = bm.faces.layers.int, bm.verts.layers.float
    for f in span.faces():
        if is_coat(f.calc_center_median()):
            f[F["prim"]] = 2
    for v in span.verts():
        v[V["flen"]], v[V["wet"]] = coat_len(v.co)


def high_tube(bm, M):
    """The sculpted mouth tube: v3's profile, smoothed, with ring ribs round
    the tube and the rolled rim fluted (18 flutes)."""
    n = 8
    dense = ml.catmull([Vector(p) for p in TUBE], n)
    prof = [(max(0.0, p.x), p.y) for p in dense]
    prof[0], prof[-1] = (0.0, prof[0][1]), (0.0, prof[-1][1])
    mats_orig = [SKIN] * 8 + [DARK] * 3
    mats = [mats_orig[min(j // n, len(mats_orig) - 1)] for j in range(len(prof) - 1)]
    sp = Span(bm)
    ml.lathe(bm, prof, HIGH["tube"], M, mats=mats)
    Minv = M.inverted()
    for v in sp.verts():
        lc = Minv @ v.co
        r = math.hypot(lc.x, lc.z)
        if r < 1e-6:
            continue
        ang = math.atan2(lc.x, lc.z)
        ly = lc.y
        dr = 0.0
        if r > 0.385:                        # ring ribs round the tube
            ph = (ly - 0.02) / 0.085
            dr += 0.018 * max(0.0, math.cos(TAU * ph)) ** 3 * smoothstep(-0.12, -0.02, ly) * \
                (1 - smoothstep(0.30, 0.37, ly))
        lip = smoothstep(0.41, 0.50, ly) * smoothstep(0.26, 0.31, r)
        dr += 0.017 * math.cos(18 * ang) * lip       # the fluted rim
        s = (r + dr) / r
        v.co = M @ Vector((lc.x * s, ly, lc.z * s))
    bm.normal_update()


def low_fang(bm, base, d, w, h, spin, sides):
    prof = [(0.0, -0.03), (w, -0.03), (w * 0.55, h * 0.6), (0.0, h)]
    M = ml.place(base, d, spin)
    ml.lathe(bm, prof, sides, M, LIGHT)
    return M


# ================================================================== build ===
def build(R, S):
    """Every part at resolution R into sink S. The layout (rng draws, coat,
    drips) is the blockout's whatever R is, so the high and the low mesh are
    the same model."""
    rng = random.Random(SEED)          # v3's stream: same draws in the same order
    final, hi = R["final"], R["hi"]
    meta = {"cards": [], "legs": {}, "eyes": [], "hips": {}}
    low = isinstance(S, LowSink)

    # ------------------------------------------------------------ body ---
    bm = S.obj("Tardigrade_Body")
    with S.piece(bm, name="body", part=P_BODY, bake={SKIN: "skin"}, ftf=lambda co, lc: fold(co.z),
                 **({"after": body_after} if low else {})):
        if hi:
            rings = [[bm.verts.new((0, centre_y(-HALF), -HALF))]]
            for i in range(1, RINGS):
                t = i / RINGS
                z = HALF * (0.5 * -math.cos(math.pi * t) + 0.5 * (2 * t - 1))   # denser at the ends
                rings.append([bm.verts.new((body_pt if final else surface)(z, 2 * math.pi * k / SEGS))
                              for k in range(SEGS)])
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
        else:
            low_body(bm)
    S.done("Tardigrade_Body", bm)

    # ----------------------------------------------------------- mouth ---
    bm = S.obj("Tardigrade_Mouth")
    Mm = ml.place(MC, AX)
    with S.piece(bm, name="tube", part=P_TUBE, bake={SKIN: "tube", DARK: "bore"}, zone={DARK: (1, 0, 0)}, M=Mm):
        if not final:
            ml.lathe(bm, TUBE, 40, Mm, mats=[SKIN] * 8 + [DARK] * 3)
        elif hi:
            high_tube(bm, Mm)
        else:
            ml.lathe(bm, TUBE_L, R["tube"], Mm, mats=[SKIN] * 7 + [DARK] * 3)
    S.done("Tardigrade_Mouth", bm)

    bm = S.obj("Tardigrade_Teeth")
    sides, low_t = R["fang"]
    for depth, count, h, w, phase in ((0.43, 12, 0.10, 0.034, 0.0), (0.24, 10, 0.08, 0.03, 0.5)):
        for k in range(count):
            a = 2 * math.pi * (k + phase) / count
            radial = Vector((math.cos(a), math.sin(a), 0))
            base = MC + AX * depth + radial * (BORE + 0.01)
            d = (-radial * 0.85 - AX * 0.5 + Vector((rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), 0)))
            ww = w * rng.uniform(0.9, 1.1)
            hh = h * rng.uniform(0.85, 1.15)
            spin = rng.uniform(0, 1)
            with S.piece(bm, name="tooth", part=P_TEETH, bake={LIGHT: "tooth"}, share="tooth",
                         ftf=lambda co, lc, hh=hh: (lc.y + 0.03) / (hh + 0.03)) as info:
                if low_t:
                    info["M"] = low_fang(bm, base, d.normalized(), ww, hh, spin, sides)
                else:
                    info["M"] = ml.fang(bm, base, d.normalized(), ww, hh, LIGHT, spin, sides=sides)
    S.done("Tardigrade_Teeth", bm)

    bm = S.obj("Tardigrade_Drool")
    ring, per, cap = R["drool"]
    for a, length, sway in ((-118, 0.42, (0.0, 0, 0.03)), (-92, 0.85, (0.03, 0, -0.04)), (-66, 0.55, (-0.02, 0, 0.0))):
        a = math.radians(a)
        top = MC + AX * 0.50 + Vector((math.cos(a), math.sin(a), 0)) * 0.43
        s_ = Vector(sway)
        C = ml.catmull([top + ml.G * length * k + s_ * k * k for k in (0.0, 0.4, 0.75, 1.0)], 8)
        with S.piece(bm, name="drool", part=P_DROOL, bake={SLIME: "slime"}, share="drool", wgt="C", C=C):
            ml.drip(bm, top, length, 0.045, SLIME, sway, ring=ring, per_seg=per, cap=cap)
    S.done("Tardigrade_Drool", bm)
    meta["mouth"] = MOUTH_TIP.copy()

    # ------------------------------------------------------------ eyes ---
    # small dark eyes under heavy lids, and scowling brow ridges: thick rounded
    # rolls laid on the head's own curve (so nothing pokes out of the outline),
    # low over each eye and dipping onto its inner corner, with furrows between
    bm = S.obj("Tardigrade_Eyes")
    brows = S.obj("Tardigrade_Brows")
    for side in (1, -1):
        p, n = surface_n(2.72, math.radians(90 - side * 34))
        c, r = p - n * 0.01, 0.15
        gaze = (AX + n * 0.6).normalized()
        Rg = Vector((0, 0, 1)).rotation_difference(gaze).to_matrix().to_4x4()
        Me = Matrix.Translation(c) @ Rg @ Matrix.Diagonal((r, r, r, 1))
        with S.piece(bm, name="eye", part=P_EYE, bake={DARK: "eye"}, share="eye", M=Me,
                     ftf=lambda co, lc: lc.z / max(lc.length, 1e-6)):
            if hi:
                ml.ellipsoid(bm, c, (r, r, r), *R["eye"], DARK)
            else:
                ml.ellipsoid(bm, c, (r, r, r), *R["eye"], DARK, R=Rg)
        meta["eyes"].append((c, r, gaze))
        toward = Vector((-side, 0, 0.35)).normalized()      # the lids sink toward the midline: a scowl
        with S.piece(brows, name="lid", part=P_BODY, bake={SKIN: "brow"}):
            ml.lid_and_brow(brows, c, r, Vector((0, 1, 0)) + toward * 0.55, gaze, toward, SKIN, cover=24, roll=False,
                            segs=R["lid"][0], steps=R["lid"][1])
        up = ml.perp(Vector((0, 1, 0)), gaze).normalized()
        inner = ml.perp(ml.perp(Vector((-side, 0, 0)), gaze), up).normalized()
        ridge = []
        for s_, h in ((-0.25, 0.15), (-0.13, 0.19), (0.0, 0.19), (0.11, 0.15), (0.2, 0.08)):
            q, qn = onto_body(c + up * h + inner * s_)
            ridge.append(q + qn * 0.03)
        ring, per, cap = R["ridge"]
        with S.piece(brows, name="ridge", part=P_BODY, bake={SKIN: "brow"}):
            ml.sweep(brows, ridge, lambda t: 0.085 + 0.045 * math.sin(math.pi * min(1.0, t * 1.2)), ring=ring,
                     per_seg=per, mi=SKIN, cap=cap)
    ring, per, cap = R["furrow"]
    for x0, x1 in ((0.055, 0.085), (-0.055, -0.085)):          # furrows over the snout, between the brows
        a, b_ = onto_body(Vector((x0, 0.9, 2.66)))[0], onto_body(Vector((x1, 0.9, 2.84)))[0]
        mid, mn = onto_body((a + b_) / 2)
        with S.piece(brows, name="furrow", part=P_BODY, bake={SKIN: "brow"}):
            ml.sweep(brows, [a, mid + mn * 0.012, b_], lambda t: 0.03 + 0.012 * math.sin(math.pi * t), ring=ring,
                     per_seg=per, mi=SKIN, cap=cap)
    S.done("Tardigrade_Eyes", bm, smooth_angle=80)
    S.done("Tardigrade_Brows", brows)

    # ------------------------------------------------------------ legs ---
    legs = []
    n_leg = 1
    for pair, (z, below, d_left) in enumerate(LEGS):
        for tag, side in SIDES:
            name = f"Tardigrade_Leg{n_leg}_{CORNER[pair]}{tag}"
            hip, d, foot, claws, reach = leg_frame(z, below, d_left, side)
            legs.append((hip, d, foot, claws, reach))
            meta["hips"][n_leg] = hip
            meta["legs"][n_leg] = (hip, d, reach)

            def lzf(co, hip=hip, d=d, reach=reach):
                return max(0.0, min(1.0, (co - hip).dot(d) / reach))

            bm = S.obj(name)
            ring, per, cap = R["leg"]
            with S.piece(bm, name="leg", part=n_leg, bake={SKIN: "leg"}, lz=lzf, M=ml.place(hip, d),
                         ftf=lambda co, lc, f=lzf: f(co)):
                ml.sweep(bm, [hip - d * 0.35, hip, hip + d * LEG_LEN * 0.5, foot],
                         lambda t: HIP_R + (FOOT_R - HIP_R) * t, ring=ring, per_seg=per, mi=SKIN, cap=cap)
            # four curved claws round the front of the sole
            ring, per, cap = R["claw"]
            for pts in claws:
                with S.piece(bm, name="claw", part=n_leg, bake={CLAW: "claw"}, share="claw", lz=lzf,
                             C=ml.catmull(pts, 8)):
                    ml.sweep(bm, pts, lambda t: 0.085 * (1 - t) ** 1.2 + 0.012, ring=ring, per_seg=per, mi=CLAW,
                             cap=cap)
            S.done(name, bm)
            n_leg += 1

    # -------------------------------------------------------- crystals ---
    # five along the back, staggered either side of the spine, seeded sizes/tilts
    bm = S.obj("Tardigrade_Crystals")
    for z, off in CRYSTALS:
        theta = math.radians(90 + off)
        p, nrm = surface_n(z, theta)
        h = rng.uniform(0.95, 1.25)          # tall enough to stand clear of the coat
        w = rng.uniform(0.15, 0.21)
        tilt = Vector((rng.uniform(-0.25, 0.25), 0, rng.uniform(-0.35, 0.1)))
        d = (nrm + tilt).normalized()
        prof = [(0.0, -0.15), (w, -0.15), (w, h * 0.68), (w * 0.35, h * 0.92), (0.0, h)]
        Mc = ml.place(p, d, spin=rng.uniform(0, math.pi))
        with S.piece(bm, name="crystal", part=P_CRYSTAL, bake={LIGHT: "crystal"}, zone=(0, 1, 0), share="crystal", M=Mc,
                     ftf=lambda co, lc, h=h: (lc.y + 0.15) / (h + 0.15)):
            ml.lathe(bm, prof, 6, Mc, mi=LIGHT)
        if rng.random() < 0.7:      # a small sibling leaning out of the same root
            d2 = (d + Vector((rng.uniform(-0.6, 0.6), 0, rng.uniform(-0.6, 0.6)))).normalized()
            h2, w2 = h * 0.5, w * 0.7
            prof = [(0.0, -0.12), (w2, -0.12), (w2, h2 * 0.68), (w2 * 0.35, h2 * 0.92), (0.0, h2)]
            Ms = ml.place(p + d * 0.02, d2, spin=rng.uniform(0, math.pi))
            with S.piece(bm, name="crystal", part=P_CRYSTAL, bake={LIGHT: "crystal"}, zone=(0, 1, 0), share="crystal",
                         M=Ms, ftf=lambda co, lc, h2=h2: (lc.y + 0.12) / (h2 + 0.12)):
                ml.lathe(bm, prof, 6, Ms, mi=LIGHT)
    S.done("Tardigrade_Crystals", bm, smooth_angle=30)

    # ------------------------------------------------------------ coat ---
    # a long, shaggy, drooping coat over the back and sides, from behind the
    # head to the rump, the crystals poking through; the head, belly, legs and
    # mouth stay bare (slimy). Long wet locks: rooted in rows from the spine
    # down the flanks, each laid along the body's curve (combed a little back,
    # higher rows lying over lower ones) and then hanging free under gravity
    # to near the belly line, tapering to a clumped wet point; none through
    # the crystals' roots
    locks = []
    for row, a0 in enumerate(ROWS):
        z = COAT_Z0 + 0.38 + 0.1 * (row % 2)
        while z <= COAT_Z1 - 0.02:
            for side in (1, -1):
                zz = z + rng.uniform(-0.05, 0.05)
                pts, nrm, hang_i = lock(rng, zz, a0 + rng.uniform(-6, 6), side)
                if any((q - c).length < 0.3 for q in pts[:4] for c in CRYSTAL_ROOTS):
                    continue
                locks.append(dict(pts=pts, nrm=nrm, hang_i=hang_i, row=row, side=side, drip=False,
                                  wet=0.45 + 0.12 * row))
            z += 0.2
    if hi:
        fb = S.obj("Tardigrade_Fur")
        # the matted under-layer: a closed slab from just under the skin to 0.07 out
        NZ, NU = 64, 44
        grid = {}
        for side, off in ((0, -0.04), (1, 0.07)):
            for i in range(NZ + 1):
                z = COAT_Z0 + (COAT_Z1 - COAT_Z0) * i / NZ
                for j in range(NU + 1):
                    t = hem(z) + (math.pi - 2 * hem(z)) * j / NU
                    p, n = surface_n(z, t)
                    grid[side, i, j] = fb.verts.new(p + n * off)
        slab = []
        for side in (0, 1):
            for i in range(NZ):
                for j in range(NU):
                    slab.append(fb.faces.new([grid[side, i, j], grid[side, i + 1, j], grid[side, i + 1, j + 1],
                                              grid[side, i, j + 1]]))
        for i in range(NZ):                  # the rims: front and back edges, and the hems
            for j in (0, NU):
                slab.append(fb.faces.new([grid[0, i, j], grid[0, i + 1, j], grid[1, i + 1, j], grid[1, i, j]]))
        for j in range(NU):
            for i in (0, NZ):
                slab.append(fb.faces.new([grid[0, i, j], grid[0, i, j + 1], grid[1, i, j + 1], grid[1, i, j]]))
        for f in slab:
            f.material_index = FUR
        bmesh.ops.recalc_face_normals(fb, faces=slab)
    for c in locks:
        r0 = rng.uniform(0.1, 0.19)
        c["r0"] = r0
        if hi:
            ml.sweep(fb, c["pts"], lambda t: r0 * (1 - 0.88 * t ** 1.3) + 0.01, ring=7, per_seg=1, mi=FUR, cap=2)

    # drips off a few locks: v3 hung them off the tips; the final hangs each
    # where its lock is still solid (DRIP_ON_LOCK), clear of the body and legs
    dbm = S.obj("Tardigrade_Drips")
    picks = sorted(rng.sample(range(len(locks)), 9))
    lengths = [rng.uniform(0.12, 0.24) for _ in picks]
    ring, per, cap = R["drip"]
    used = set()
    meta["drip_swaps"] = []
    for i, length in zip(picks, lengths):
        if not final:
            ml.drip(dbm, locks[i]["pts"][-1], length, 0.03, SLIME)
            continue
        length *= 1.5
        got = None
        for j in sorted(range(len(locks)), key=lambda q: (abs(q - i), q)):
            if j in used:
                continue
            got = drip_anchor(locks[j], length, legs)
            if got is not None:
                break
        if j != i:
            meta["drip_swaps"].append((i, j))
        used.add(j)
        locks[j]["drip"] = True
        t, p, top = got
        C = [top + ml.G * length * k for k in (0.0, 0.5, 1.0)]
        with S.piece(dbm, name="drip", part=P_DRIP, bake={SLIME: "slime"}, share="drip", wgt="C", C=C, lz=axial(p)):
            ml.drip(dbm, top, length, 0.038, SLIME, ring=ring, per_seg=per, cap=cap)
    if hi:
        S.done("Tardigrade_Fur", fb, smooth_angle=85)
    S.done("Tardigrade_Drips", dbm)
    meta["cards"] = locks
    return meta


# ================================================================ blockout ===
if STAGE == "blockout":
    ml.reset_scene()
    rt = ml.root("Tardigrade")
    build(BLOCK, BlockSink(rt))
    ml.finish(rt, OUT_DIR, "tardigrade", EXTENT)
    sys.exit(0)


# ============================================================ final stage ===
# ---- the look: one recipe per bake material (linear RGB) -------------------
def skin_fields(N):
    gp = N.gp()
    big = N.noise(gp, 1.3, 3.0, 0.5, w=201.0)
    mott = N.noise(gp, 4.0, 4.0, 0.55, w=202.0)
    fine = N.noise(gp, 26.0, 3.0, 0.5, w=203.0)
    wco = N.v("MULTIPLY", gp, (1.0, 1.0, 2.8))           # fine wrinkles run round the body
    wr = N.noise(wco, 7.0, 5.0, 0.6, 0.5, w=204.0)
    wrinkle = N.mul(N.m("POWER", N.mapr(N.m("ABSOLUTE", N.sub(wr, 0.5)), 0.05, 0.0), 2.0),
                    N.mapr(N.noise(gp, 1.8, 2.0, 0.5, w=208.0), 0.35, 0.65))
    tb = N.vor(gp, 20.0, "F1")                            # soft tubercles
    tub = N.m("POWER", N.mapr(tb.outputs["Distance"], 0.45, 0.0), 1.6)
    pr = N.vor(N.v("ADD", gp, (7.3, 0.2, 5.1)), 70.0, "F1")
    pore = N.mapr(pr.outputs["Distance"], 0.22, 0.08, 0.0, 1.0, smooth=True)
    sp = N.vor(N.v("ADD", gp, (1.7, 3.3, 0.9)), 30.0, "F1")
    speck = N.mul(N.mapr(sp.outputs["Distance"], 0.16, 0.07), N.mapr(N.chan(sp.outputs["Color"], 0), 0.6, 0.66))
    wet = N.mapr(N.noise(gp, 2.5, 3.0, 0.5, w=205.0), 0.44, 0.62, 0.0, 1.0, smooth=True)
    under = N.mapr(N.xyz(N.world_normal())[2], 0.1, -0.7)
    return dict(big=big, mott=mott, fine=fine, wrinkle=wrinkle, tub=tub, pore=pore, speck=speck, wet=wet,
                under=under)


def skin_base(N, f):
    base = N.mix(f["mott"], (0.45, 0.24, 0.19), (0.66, 0.40, 0.32))
    base = N.mix(N.mul(N.mapr(f["big"], 0.45, 0.8, 0.0, 1.0, smooth=True), 0.35), base, (0.36, 0.19, 0.15))
    base = N.mix(N.mul(f["under"], 0.6), base, (0.74, 0.50, 0.42))
    base = N.mix(N.mul(f["tub"], 0.22), base, (0.76, 0.52, 0.44))
    base = N.mix(N.mul(f["speck"], 0.8), base, (0.17, 0.075, 0.065))
    return base


def creases(N, along, period, gate):
    """Fine ring creases: thin dark lines across `along` every `period`,
    wobbled, gated by `gate` (0..1)."""
    gp = N.gp()
    c = N.add(along, N.mul(N.noise(gp, 3.0, 2.0, 0.5, w=206.0), period * 0.7))
    lines = N.m("ABSOLUTE", N.m("SINE", N.mul(c, math.pi / period)))
    br = N.mapr(N.noise(gp, 6.0, 2.0, 0.5, w=207.0), 0.35, 0.55)        # broken, not perfect rings
    return N.mul(N.m("POWER", N.mapr(lines, 0.3, 0.0), 1.5), gate, br)


def skin_recipe(N):
    """The body (ft = fold proximity: the folds flush and crease) and the
    brows and lids (ft 0)."""
    f = skin_fields(N)
    x, y, z = N.xyz(N.gp())
    fd = N.ft()
    flush = N.mapr(fd, 0.15, 0.9, 0.0, 1.0, smooth=True)
    cr = creases(N, z, 0.045, N.mapr(fd, 0.08, 0.6))
    base = skin_base(N, f)
    base = N.mix(N.mul(flush, 0.5), base, (0.56, 0.17, 0.16))
    base = N.mix(N.mul(cr, 0.75), base, (0.22, 0.06, 0.06))
    base = N.scale(base, N.sub(1.0, N.add(N.mul(f["pore"], 0.22), N.mul(f["wrinkle"], 0.12), N.mul(f["wet"], 0.06))))
    wet = N.m("MAXIMUM", f["wet"], N.mul(flush, 0.8))          # slick in the folds
    rough = N.add(0.26, N.mul(wet, -0.19), N.mul(f["pore"], 0.12), N.mul(f["fine"], 0.06), N.mul(f["wrinkle"], 0.08))
    height = N.add(N.mul(f["pore"], -0.0012), N.mul(f["wrinkle"], -0.0016), N.mul(f["fine"], 0.0010),
                   N.mul(f["mott"], 0.004), N.mul(f["tub"], 0.0024), N.mul(cr, -0.0035))
    return dict(albedo=base, rough=rough, metal=0.0, height=height)


def leg_recipe(N):
    """The legs: the skin, ringed with creases along the leg (lc.y from the
    hip), flushed pink toward the foot (ft the leg weight)."""
    f = skin_fields(N)
    lx, ly, lz = N.xyz(N.lc())
    t = N.ft()
    cr = creases(N, ly, 0.05, N.mapr(t, 0.05, 0.3))
    toe = N.mapr(t, 0.55, 0.9, 0.0, 1.0, smooth=True)
    base = skin_base(N, f)
    base = N.mix(N.mul(toe, 0.45), base, (0.68, 0.30, 0.28))
    base = N.mix(N.mul(cr, 0.75), base, (0.24, 0.07, 0.065))
    base = N.scale(base, N.sub(1.0, N.add(N.mul(f["pore"], 0.22), N.mul(f["wrinkle"], 0.12))))
    rough = N.add(0.28, N.mul(f["wet"], -0.18), N.mul(f["pore"], 0.1), N.mul(toe, -0.08))
    height = N.add(N.mul(f["pore"], -0.0010), N.mul(f["wrinkle"], -0.0012), N.mul(f["mott"], 0.003),
                   N.mul(f["tub"], 0.0016), N.mul(cr, -0.0035))
    return dict(albedo=base, rough=rough, metal=0.0, height=height)


def tube_recipe(N):
    """The mouth tube's outside: the skin, its ribs' grooves darker, the
    fluted rolled lip wet pink-red, darker toward the bore."""
    f = skin_fields(N)
    lx, ly, lz = N.xyz(N.lc())
    r = N.m("SQRT", N.add(N.mul(lx, lx), N.mul(lz, lz)))
    ang = N.m("ARCTAN2", lx, lz)
    rib = N.m("ABSOLUTE", N.m("SINE", N.mul(N.sub(ly, 0.0625), math.pi / 0.085)))
    groove = N.mul(N.mapr(rib, 0.35, 0.0), N.mapr(ly, -0.12, -0.02), N.mapr(ly, 0.37, 0.30))
    lip = N.mapr(ly, 0.40, 0.48, 0.0, 1.0, smooth=True)
    flute = N.mul(N.mapr(N.m("COSINE", N.mul(ang, 18.0)), -0.2, -1.0), lip)
    inner = N.mul(N.mapr(r, 0.35, 0.29), lip)
    base = skin_base(N, f)
    base = N.mix(N.mul(lip, 0.75), base, (0.64, 0.22, 0.22))
    base = N.mix(N.mul(inner, 0.8), base, (0.36, 0.06, 0.08))
    base = N.mix(N.mul(groove, 0.7), base, (0.26, 0.08, 0.075))
    base = N.mix(N.mul(flute, 0.6), base, (0.30, 0.06, 0.07))
    base = N.scale(base, N.sub(1.0, N.mul(f["pore"], 0.25)))
    rough = N.add(0.26, N.mul(f["wet"], -0.14), N.mul(lip, -0.16), N.mul(f["pore"], 0.08))
    height = N.add(N.mul(f["pore"], -0.0010), N.mul(groove, -0.0025), N.mul(flute, -0.0025), N.mul(f["mott"], 0.002),
                   N.mul(f["wrinkle"], -0.0012))
    return dict(albedo=base, rough=rough, metal=0.0, height=height)


def bore_recipe(N):
    """The throat: dark red to near black with ring ridges; its emissive is
    the beam charge's glow at full (the game scales it, COLOR_0 R): a violet
    rim deepening to a cyan-white core."""
    lx, ly, lz = N.xyz(N.lc())
    gp = N.gp()
    depth = N.mapr(ly, 0.49, 0.06)
    n = N.noise(gp, 30.0, 3.0, 0.55, w=221.0)
    ridge = N.m("POWER", N.m("ABSOLUTE", N.m("SINE", N.mul(N.add(ly, N.mul(n, 0.012)), math.pi / 0.045))), 4.0)
    col = N.mix(N.mapr(depth, 0.0, 0.35), (0.36, 0.07, 0.09), (0.05, 0.008, 0.014))
    col = N.mix(N.mul(ridge, 0.6), col, (0.18, 0.03, 0.05))
    core = N.mapr(depth, 0.15, 1.0, 0.0, 1.0, smooth=True)
    swirl = N.noise(N.vec(N.mul(N.m("ARCTAN2", lx, lz), 1.2), N.mul(ly, 6.0), 0.0), 2.5, 3.0, 0.6, w=222.0)
    glow = N.mix(core, (0.40, 0.08, 0.95), (0.30, 0.88, 1.0))
    glow = N.mix(N.mul(N.mapr(swirl, 0.55, 0.75), core), glow, (0.80, 0.98, 1.0))
    glow = N.scale(glow, N.mul(N.add(0.26, N.mul(core, 0.60)), N.sub(1.0, N.mul(ridge, 0.18))))
    return dict(albedo=col, rough=N.add(0.10, N.mul(ridge, 0.1)), metal=0.0,
                height=N.add(N.mul(ridge, 0.0012), N.mul(n, 0.0005)), emit=glow)


def tooth_recipe(N):
    t = N.ft()
    gp = N.gp()
    lx, ly, lz = N.xyz(N.lc())
    streak = N.noise(N.vec(N.mul(lx, 1.0), N.mul(ly, 0.08), N.mul(lz, 1.0)), 120.0, 3.0, 0.5, w=231.0)
    col = N.mix(N.mapr(t, 0.18, 0.65, 0.0, 1.0, smooth=True), (0.58, 0.44, 0.20), (0.80, 0.77, 0.66))
    col = N.mix(N.mul(N.mapr(t, 0.8, 1.0), 0.5), col, (0.84, 0.84, 0.80))
    col = N.scale(col, N.add(0.9, N.mul(streak, 0.16)))
    gum = N.mapr(t, 0.22, 0.10, 0.0, 1.0, smooth=True)
    col = N.mix(gum, col, (0.48, 0.10, 0.12))
    return dict(albedo=col, rough=N.add(0.16, N.mul(gum, -0.05), N.mul(streak, 0.05)), metal=0.0,
                height=N.mul(streak, 0.0003))


def claw_recipe(N):
    """Near-black glossy horn, lighter toward the tip, streaked along it,
    with growth rings; the root sunk in dark skin."""
    t = N.ft()
    gp = N.gp()
    streak = N.noise(N.v("MULTIPLY", gp, (1.0, 1.0, 1.0)), 140.0, 3.0, 0.6, w=241.0)
    rings = N.m("POWER", N.m("ABSOLUTE", N.m("SINE", N.mul(t, math.pi * 9.0))), 8.0)
    col = N.mix(N.mapr(t, 0.15, 1.0, 0.0, 1.0, smooth=True), (0.022, 0.014, 0.012), (0.13, 0.095, 0.065))
    col = N.scale(col, N.add(0.8, N.mul(streak, 0.4)))
    col = N.mix(N.mul(rings, 0.4), col, (0.012, 0.008, 0.007))
    root = N.mapr(t, 0.12, 0.04, 0.0, 1.0, smooth=True)
    col = N.mix(root, col, (0.26, 0.10, 0.09))
    return dict(albedo=col, rough=N.add(0.10, N.mul(streak, 0.06), N.mul(root, 0.14)), metal=0.0,
                height=N.add(N.mul(streak, 0.0005), N.mul(rings, -0.0004)))


def crystal_recipe(N):
    """Faceted glowing crystal (ft 0 at its buried base -> 1 at its tip):
    violet at the root to cyan at the tip, fractured, each facet its own
    tone; a dark crust where it breaks out of the skin (no glow there)."""
    t = N.ft()
    lc = N.lc()
    fr = N.vor(N.v("MULTIPLY", lc, (7.0, 2.2, 7.0)), 1.6, "DISTANCE_TO_EDGE")
    crack = N.mapr(fr.outputs["Distance"], 0.05, 0.0)
    facet = N.noise(N.v("MULTIPLY", N.world_normal(), (2.0, 2.0, 2.0)), 1.5, 1.0, 0.5, w=251.0)
    inner = N.noise(lc, 9.0, 3.0, 0.5, w=252.0)
    crust = N.mapr(t, 0.17, 0.10, 0.0, 1.0, smooth=True)
    col = N.mix(N.mapr(t, 0.15, 0.95), (0.30, 0.16, 0.62), (0.36, 0.80, 0.94))
    col = N.scale(col, N.add(0.75, N.mul(facet, 0.4)))
    col = N.mix(N.mul(crack, 0.6), col, (0.85, 0.95, 1.0))
    col = N.mix(crust, col, (0.10, 0.06, 0.06))
    glow = N.mix(N.mapr(t, 0.15, 0.95), (0.30, 0.04, 0.78), (0.12, 0.86, 1.0))
    glow = N.scale(glow, N.mul(N.add(0.32, N.mul(crack, 0.5), N.mul(inner, 0.25), N.mul(t, 0.25)),
                               N.sub(1.0, crust)))
    return dict(albedo=col, rough=N.add(0.04, N.mul(crust, 0.55), N.mul(crack, 0.05)), metal=0.0,
                height=N.add(N.mul(crack, -0.0007), N.mul(crust, N.mul(inner, 0.002))), emit=glow)


def eye_recipe(N):
    """Small, mean and glossy: a near-black ball, a deep-red fibred iris ring
    round a black pupil looking along the gaze (ft the cosine off it)."""
    c = N.ft()
    lx, ly, lz = N.xyz(N.lc())
    ang = N.m("ARCTAN2", lx, ly)
    fib = N.noise(N.vec(N.mul(ang, 6.0), N.mul(c, 40.0), 0.0), 3.0, 3.0, 0.6, w=261.0)
    iris = N.mul(N.mapr(c, 0.865, 0.878), N.mapr(c, 0.962, 0.952))
    limbal = N.m("EXPONENT", N.mul(-1.0, N.m("POWER", N.m("DIVIDE", N.sub(c, 0.871), 0.007), 2.0)))
    ball = N.mix(N.mapr(c, 0.4, -0.4), (0.045, 0.018, 0.02), (0.012, 0.006, 0.008))
    irisc = N.scale((0.36, 0.035, 0.012), N.add(0.5, N.mul(fib, 0.8)))
    col = N.mix(iris, ball, irisc)
    col = N.mix(N.mul(limbal, 0.85), col, (0.02, 0.005, 0.004))
    return dict(albedo=col, rough=0.02, metal=0.0, height=N.mul(fib, N.mul(iris, 0.0003)))


def slime_recipe(N):
    """Pink slime: near-mirror wet, paler and clearer where thin (a drip's
    neck: ft along it), deeper in its bulb; bubbles inside. The game adds the
    translucency from _MOTION.w."""
    gp = N.gp()
    t = N.ft()
    n = N.noise(gp, 9.0, 4.0, 0.55, w=271.0)
    bv = N.vor(gp, 40.0, "F1")
    bub = N.mul(N.mapr(bv.outputs["Distance"], 0.30, 0.18, 0.0, 1.0, smooth=True),
                N.mapr(N.chan(bv.outputs["Color"], 0), 0.45, 0.5))
    tv = N.vor(N.v("ADD", gp, (2.0, 5.0, 1.0)), 120.0, "F1")
    tiny = N.mapr(tv.outputs["Distance"], 0.22, 0.12)
    thin = N.mul(N.mapr(t, 0.03, 0.3), N.mapr(t, 0.85, 0.62))
    col = N.mix(N.mul(thin, 0.85), (0.60, 0.17, 0.28), (0.90, 0.62, 0.70))
    col = N.scale(col, N.add(0.9, N.mul(n, 0.2)))
    col = N.mix(N.mul(bub, 0.5), col, (0.95, 0.75, 0.80))
    col = N.mix(N.mul(tiny, 0.35), col, (0.97, 0.85, 0.88))
    return dict(albedo=col, rough=N.add(0.02, N.mul(n, 0.025)), metal=0.0,
                height=N.add(N.mul(bub, 0.0014), N.mul(tiny, 0.0003)))


BAKES = ("skin", "brow", "leg", "tube", "bore", "tooth", "claw", "crystal", "eye", "slime", "fur")
BAKE_IDS = {k: i for i, k in enumerate(BAKES)}
# texel density relative to smart-project's uniform one: the face (brows,
# lids, tube, eyes) and the small parts get the texels; the throat little
UV_DENSITY = {"brow": 1.7, "leg": 0.6, "tube": 1.5, "bore": 0.55, "tooth": 1.4, "claw": 1.4, "crystal": 1.3,
              "eye": 2.2, "slime": 1.3}
BODY_K = 1.25          # the body's skin (its own cylindrical unwrap) relative to the legs' density


def make_bake_materials():
    for name, recipe in (("skin", skin_recipe), ("brow", skin_recipe), ("leg", leg_recipe), ("tube", tube_recipe),
                         ("bore", bore_recipe), ("tooth", tooth_recipe), ("claw", claw_recipe),
                         ("crystal", crystal_recipe), ("eye", eye_recipe), ("slime", slime_recipe)):
        mb.bake_material(name, recipe)


# ---- the final stage's sizes --------------------------------------------
TEX = 2048             # shipped albedo (R15)
NTEX = 1536            # shipped normal map (as the saucer: room for the fur atlas)
MR_TEX = 512           # metal/roughness
EM_TEX = 1024          # emissive (the crystals' fractures and the throat)
AO_TEX = 2048
FUR_TEX = 512          # the tiling strand mask: the fur atlas's left half (its right half: the lock cards)
LOCK_VARIANTS = 4
BAKE, NBAKE = 2 * TEX, 2 * NTEX     # supersampled bakes, box-filtered down
EXPLODE = 7.0          # each bake group moved this far apart along Blender X
FOCAL_PX = 802 / 2 / math.tan(math.radians(58) / 2)    # sphereLod.ts's reference view
LOD1_RATIO = {"skin": 0.3, "brow": 0.35, "leg": 0.35, "tube": 0.45, "bore": 0.45, "tooth": 0.5, "claw": 0.5,
              "crystal": 1.0, "eye": 0.45, "slime": 0.5}
GL2BL = ml.GL2BL


def bl(v):
    """glTF -> Blender."""
    return GL2BL @ Vector(v)


def gl(v):
    """Blender -> glTF."""
    return Vector((v[0], v[2], -v[1]))


def attr_np(me, name, domain_len, width=1, dtype=np.float32):
    a = np.zeros(domain_len * width, dtype)
    me.attributes[name].data.foreach_get("value" if width == 1 else "vector", a)
    return a.reshape(-1, width) if width > 1 else a


def thinness(L):
    """w per vertex: 1 - thickness / THIN_D along the inward normal, cast
    inside the vertex's own piece (the eyes 0)."""
    bm = L.bm
    bm.normal_update()
    V = bm.verts.layers.float["thin"]
    for span, info in L.pieces:
        if info["part"] == P_EYE:
            continue
        vs, fs = span.verts(), span.faces()
        idx = {v: i for i, v in enumerate(vs)}
        tree = BVHTree.FromPolygons([v.co for v in vs], [[idx[v] for v in f.verts] for f in fs])
        for v in vs:
            nrm = v.normal
            hit = tree.ray_cast(v.co - nrm * 1e-4, -nrm, 4.0)
            d = (hit[0] - v.co).length if hit[0] is not None else 0.05
            v[V] = max(0.0, min(1.0, 1.0 - d / THIN_D))


def to_mesh_object(name, bm, matrix=GL2BL):
    bm.transform(matrix)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def write_motion(ob):
    """_MOTION (x part slot, y axial / own, z leg weight / drip host, w
    thinness), the zone colours and _FUR from the per-element layers."""
    me = ob.data
    nv, npoly, nl = len(me.vertices), len(me.polygons), len(me.loops)
    vpart = attr_np(me, "vpart", nv, dtype=np.int32)
    mo = np.zeros((nv, 4), np.float32)
    mo[:, 0] = (vpart + 0.5) / 16.0
    mo[:, 1] = np.clip(attr_np(me, "ay", nv), 0, 1)
    mo[:, 2] = np.clip(attr_np(me, "lz", nv), 0, 1)
    mo[:, 3] = np.clip(attr_np(me, "thin", nv), 0, 1)
    if "_MOTION" in me.attributes:
        me.attributes.remove(me.attributes["_MOTION"])
    me.attributes.new("_MOTION", "FLOAT_COLOR", "POINT").data.foreach_set("color", mo.ravel())
    zone = attr_np(me, "zone", npoly, dtype=np.int32)
    prim = attr_np(me, "prim", npoly, dtype=np.int32)
    card = attr_np(me, "card", npoly, dtype=np.int32)
    cols = np.zeros((nl, 4), np.float32)
    cols[:, 3] = 1.0
    for p in me.polygons:
        i = p.index
        rgb = (card[i], 0, 0) if prim[i] == 2 else (zone[i] & 1, zone[i] >> 1 & 1, zone[i] >> 2 & 1)
        cols[p.loop_start:p.loop_start + p.loop_total, :3] = rgb
    if "Zones" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Zones"])
    z = me.color_attributes.new("Zones", "BYTE_COLOR", "CORNER")
    z.data.foreach_set("color", cols.ravel())
    me.color_attributes.active_color = z
    me.color_attributes.render_color_index = me.color_attributes.find("Zones")
    is_card = np.zeros(nv, bool)
    for p in me.polygons:
        if card[p.index]:
            is_card[list(p.vertices)] = True
    fur = np.stack([np.where(is_card, attr_np(me, "cardf", nv), attr_np(me, "flen", nv) / FUR_MAX),
                    attr_np(me, "wet", nv)], -1).clip(0, 1).astype(np.float32)
    if "_FUR" in me.attributes:
        me.attributes.remove(me.attributes["_FUR"])
    me.attributes.new("_FUR", "FLOAT2", "POINT").data.foreach_set("vector", fur.ravel())


def separate(ob, sel, name):
    """Split the faces where sel (a bool per polygon) into a new object."""
    me = ob.data
    sel = np.asarray(sel, bool)
    mb.activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    me.polygons.foreach_set("select", sel)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    new = [o for o in bpy.context.selected_objects if o is not ob][0]
    new.name = new.data.name = name
    return new


# the body's cylindrical unwrap: u = arc length round the (two half-ellipse)
# cross-section from the top of the back, v = arc length along the side line
_EA = np.linspace(0.0, math.pi, 4001)
_EI = np.sqrt(np.cos(_EA) ** 2 + (np.where(_EA < math.pi / 2, BACK, BELLY) * np.sin(_EA)) ** 2)
_EC = np.concatenate([[0.0], np.cumsum((_EI[1:] + _EI[:-1]) * 0.5 * np.diff(_EA))])
_ZZ = np.linspace(-HALF, HALF, 8001)
_RR = np.array([radius(z) for z in _ZZ])
_ZS = np.concatenate([[0.0], np.cumsum(np.sqrt(np.diff(_ZZ) ** 2 + np.diff(_RR) ** 2))])


def ell_arc(a):
    a = abs(a)
    if a <= math.pi:
        return float(np.interp(a, _EA, _EC))
    return 2 * float(_EC[-1]) - float(np.interp(TAU - a, _EA, _EC))


def body_uv(p, a_ref=0.0):
    """(u, v) of glTF point p in the body's unwrap; the angle from the top of
    the back (+ toward +X) is taken on the branch nearest a_ref (the seam is
    the belly's midline, a = +-pi)."""
    z = max(-HALF, min(HALF, p.z))
    dy = p.y - centre_y(z)
    a = math.atan2(p.x, dy / (BACK if dy > 0 else BELLY))
    while a - a_ref > math.pi:
        a -= TAU
    while a - a_ref < -math.pi:
        a += TAU
    u = radius(z) * (ell_arc(a) if a >= 0 else -ell_arc(-a))
    return u, float(np.interp(z, _ZZ, _ZS))


def body_a(p):
    z = max(-HALF, min(HALF, p.z))
    dy = p.y - centre_y(z)
    return math.atan2(p.x, dy / (BACK if dy > 0 else BELLY))


def unwrap_baked(ob, body_grp):
    """Smart-project, scale islands by their part's texel density, the body's
    skin by its own cylindrical unwrap, pack only the master of each shared
    group, then copy its UVs onto the others."""
    me = ob.data
    npoly = len(me.polygons)
    bk = attr_np(me, "bk", npoly, dtype=np.int32)
    shg, shi, shk = (attr_np(me, k, npoly, dtype=np.int32) for k in ("shg", "shi", "shk"))
    fg = attr_np(me, "grp", npoly, dtype=np.int32)
    if "UVMap" not in me.uv_layers:
        me.uv_layers.new(name="UVMap")
    mb.activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(58), island_margin=0.003, area_weight=0.0,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    ubm = bmesh.new()
    ubm.from_mesh(me)
    uvl = ubm.loops.layers.uv["UVMap"]
    for island in bmesh_linked_uv_islands(ubm, uvl):
        counts = {}
        for f in island:
            counts[BAKES[bk[f.index]]] = counts.get(BAKES[bk[f.index]], 0) + 1
        k = UV_DENSITY.get(max(counts, key=counts.get), 1.0)
        pts = [lp[uvl].uv.copy() for f in island for lp in f.loops]
        c = sum(pts, Vector((0.0, 0.0))) / len(pts)
        for f in island:
            for lp in f.loops:
                lp[uvl].uv = c + (lp[uvl].uv - c) * k
    s0 = []
    for f in ubm.faces:
        if BAKES[bk[f.index]] != "leg" or f.calc_area() < 1e-6:
            continue
        pts = [lp[uvl].uv for lp in f.loops]
        a2 = sum(abs((pts[i] - pts[0]).cross(pts[i + 1] - pts[0])) / 2 for i in range(1, len(pts) - 1))
        s0.append(math.sqrt(a2 / f.calc_area()) / UV_DENSITY["leg"])
    k_skin = float(np.median(s0)) * BODY_K
    for f in ubm.faces:
        if not (fg[f.index] == body_grp and BAKES[bk[f.index]] == "skin"):
            continue
        a_c = body_a(gl(f.calc_center_median()))
        for lp in f.loops:
            u, v = body_uv(gl(lp.vert.co), a_c)
            lp[uvl].uv = (u * k_skin, v * k_skin)
    ubm.to_mesh(me)
    ubm.free()
    shared = np.nonzero((shg > 0) & (shi > 0))[0]
    master = {(int(shg[i]), int(shk[i])): i for i in np.nonzero((shg > 0) & (shi == 0))[0]}
    bpy.ops.object.mode_set(mode="EDIT")
    ebm = bmesh.from_edit_mesh(me)
    ebm.faces.ensure_lookup_table()
    for i in shared:
        ebm.faces[int(i)].hide_set(True)
    bmesh.update_edit_mesh(me)
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.mesh.reveal(select=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    uv = me.uv_layers["UVMap"].data
    for i in shared:
        p = me.polygons[int(i)]
        q = me.polygons[master[(int(shg[i]), int(shk[i]))]]
        assert p.loop_total == q.loop_total
        for a_, b_ in zip(range(p.loop_start, p.loop_start + p.loop_total),
                          range(q.loop_start, q.loop_start + q.loop_total)):
            uv[a_].uv = uv[b_].uv
    area3, area2 = {}, {}
    for p in me.polygons:
        if shg[p.index] > 0 and shi[p.index] > 0:
            continue
        name = BAKES[bk[p.index]]
        pts = [uv[i].uv for i in range(p.loop_start, p.loop_start + p.loop_total)]
        a2 = sum(abs((pts[i] - pts[0]).cross(pts[i + 1] - pts[0])) / 2 for i in range(1, len(pts) - 1))
        area2[name] = area2.get(name, 0.0) + a2
        area3[name] = area3.get(name, 0.0) + p.area
    print("tardigrade: atlas % / texels per unit at", TEX, {k: (round(100 * area2[k], 1),
          round(TEX * math.sqrt(area2[k] / max(area3[k], 1e-9)))) for k in sorted(area2, key=lambda k: -area2[k])})


def unwrap_fur(ob, rng_):
    """The fur base: the body's own cylindrical unwrap (one unbroken island
    over the whole back) in FUR_TILE world units per repeat of the mask."""
    me = ob.data
    if "UVMap" not in me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers["UVMap"].data
    off = (rng_.uniform(0, 1), rng_.uniform(0, 1))
    for p in me.polygons:
        a_c = body_a(gl(p.center))
        for li in range(p.loop_start, p.loop_start + p.loop_total):
            u, v = body_uv(gl(me.vertices[me.loops[li].vertex_index].co), a_c)
            uv[li].uv = (u / FUR_TILE + off[0], v / FUR_TILE + off[1])


def lock_x(t):
    """_FUR.x along a lock card: its alpha-test height, low (0.04 -> 0.34):
    the lock's own texture carries its shape (a solid root splitting into
    tapering strand clumps, fraying at the tip)."""
    return 0.04 + 0.3 * t ** 2.0


def add_cards(ob, cards, rng_):
    """Lock cards along every v3 lock: each a crossed pair of cards along the
    lock's own curve (card_rows: laid on the body, then hanging), a ribbon
    lying across it and a fin standing on it, wide at the root and narrowing
    to the tip (the texture tapers its clumps). The mask runs along the lock
    and the alpha test rises toward the tip (lock_x), so a lock frays into
    its strands. Normals are the body's under each row (the ribbon's turned
    out across its width, so it shades round). Every lock a drip hangs from
    uses variant 0 (its long solid centre clump)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    F = bm.faces.layers.int
    V = bm.verts.layers.float
    VI = bm.verts.layers.int
    uvl = bm.loops.layers.uv["UVMap"]
    normals = {}
    n_quads = 0
    for c in cards:
        rows_, _ = card_rows(c)
        width = c["r0"] * 2.1
        spin = math.radians(rng_.uniform(-15, 15))
        # the fin stands only where the lock hangs free (on the laid part it
        # stood up off the body as a ridge): from the last row still on the
        # body, narrow there, to the tip
        hang0 = max([k for k, r_ in enumerate(rows_) if r_[0] <= c["t_hang"]] or [0])
        for layer in range(2):              # 0: the fin, 1: the ribbon across it
            k_var = 0 if c["drip"] else rng_.randrange(LOCK_VARIANTS)
            span_ = rows_[hang0:] if layer == 0 else rows_
            if len(span_) < 2:
                continue
            rows = []
            for k, (t, p, n, tan) in enumerate(span_):
                side = tan.cross(n)
                side = side.normalized() if side.length > 1e-5 else tan.orthogonal().normalized()
                fin = side.cross(tan).normalized()
                wdir = Matrix.Rotation(spin, 3, tan) @ (fin if layer == 0 else side)
                w = width * (0.55 + 0.45 * (1.0 - t)) * 0.5 * (0.3 if layer == 0 and k == 0 and hang0 > 0 else 1.0)
                pb, wb, nb = bl(p), (GL2BL.to_3x3() @ wdir).normalized(), (GL2BL.to_3x3() @ n).normalized()
                rows.append(([bm.verts.new(pb - wb * w), bm.verts.new(pb + wb * w)], wb, nb, t, p))
            for i in range(len(rows) - 1):
                (a0, a1), _, _, _, _ = rows[i]
                (b0, b1), _, _, _, _ = rows[i + 1]
                f = bm.faces.new((a0, a1, b1, b0))
                f.smooth = True
                f[F["prim"]], f[F["card"]], f[F["part"]], f[F["bk"]] = 2, 1, P_BODY, BAKE_IDS["fur"]
                n_quads += 1
                for lp in f.loops:
                    ri = next(k for k in range(len(rows)) if lp.vert in rows[k][0])
                    ci = rows[ri][0].index(lp.vert)
                    # (v = t^0.6: the lock's solid root is a short part of these
                    # long locks, so their laid length shows strand clumps, not a plank)
                    lp[uvl].uv = (0.5 + (k_var + 0.02 + 0.96 * ci) / (2 * LOCK_VARIANTS),
                                  0.015 + 0.97 * rows[ri][3] ** 0.6)
            for vs, across, nb, t, p in rows:
                for e, v in zip((-1, 1), vs):
                    v[VI["vpart"]] = P_BODY
                    v[V["ay"]] = axial(p)
                    v[V["lz"]] = 0.0
                    v[V["thin"]] = 1.0
                    v[V["cardf"]] = lock_x(t)
                    v[V["wet"]] = min(1.0, c["wet"] * (0.6 + 0.6 * t))
                    normals[v] = nb if layer == 0 else (nb + across * (0.75 * e)).normalized()
    bm.verts.index_update()
    vn = {v.index: nn for v, nn in normals.items()}
    bm.to_mesh(me)
    bm.free()
    cn = [tuple(c.vector) for c in me.corner_normals]
    for li, lp in enumerate(me.loops):
        if lp.vertex_index in vn:
            cn[li] = tuple(vn[lp.vertex_index])
    me.normals_split_custom_set(cn)
    print("tardigrade: lock cards: %d locks, %d quads (%d hold a drip)" % (
        len(cards), n_quads, sum(c["drip"] for c in cards)))


def protect_group(ob):
    """A vertex group "keep" (weight 1) on every vertex the decimation must
    not move: open-boundary vertices (the fur base's hem against the skin,
    a tube's open end), material edges, and the claw tips (so each leg's
    weight still reaches 1). Decimated with invert on, these stay put."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    keep = set()
    for e in bm.edges:
        if len(e.link_loops) != 2:
            keep.update(v.index for v in e.verts)
            continue
        la, lb = e.link_loops
        if la.face.material_index != lb.face.material_index:
            keep.update(v.index for v in e.verts)
    llz = bm.verts.layers.float.get("lz")
    lpart = bm.verts.layers.int.get("vpart")
    for v in bm.verts:
        if 1 <= v[lpart] <= 8 and v[llz] > 0.97:
            keep.add(v.index)
    bm.free()
    vg = ob.vertex_groups.new(name="keep")
    if keep:
        vg.add(sorted(keep), 1.0, "REPLACE")
    return len(keep)


def lod1_from(lod0):
    """LOD1: LOD0 without its cards and drips, each piece decimated on its
    own, its boundary and material-edge vertices held fixed (protect_group),
    so nothing opens."""
    mb.activate(lod0)
    bpy.ops.object.duplicate()
    ob = bpy.context.object
    ob.name = ob.data.name = "Tardigrade_LOD1"
    me = ob.data
    card = attr_np(me, "card", len(me.polygons), dtype=np.int32)
    part = attr_np(me, "part", len(me.polygons), dtype=np.int32)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    gone = np.nonzero(card | (part == P_DRIP))[0]
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in gone], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    grp = attr_np(me, "grp", len(me.polygons), dtype=np.int32)
    groups = sorted(set(int(g) for g in grp))
    parts = []
    for g in groups:
        if g == groups[-1]:
            piece = ob
        else:
            piece = separate(ob, attr_np(ob.data, "grp", len(ob.data.polygons), dtype=np.int32) == g, f"lod1_{g}")
        pm = piece.data
        bk = attr_np(pm, "bk", len(pm.polygons), dtype=np.int32)
        mi = np.zeros(len(pm.polygons), np.int32)
        pm.polygons.foreach_get("material_index", mi)
        names = [BAKES[b] for b, m in zip(bk, mi) if m == 0]
        name = max(sorted(set(names)), key=names.count) if names else "fur"
        parts.append((name, piece))
    for name, piece in parts:
        r = LOD1_RATIO.get(name, 0.3)
        if r < 1.0:
            protect_group(piece)
            mod = piece.modifiers.new("dec", "DECIMATE")
            mod.decimate_type = "COLLAPSE"
            mod.ratio = r
            mod.vertex_group = "keep"
            mod.invert_vertex_group = True
            mod.vertex_group_factor = 1000.0
            mod.use_collapse_triangulate = True
            mb.activate(piece)
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action="DESELECT")
    for _, piece in parts:
        piece.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()
    return ob


def fix_parts(ob, legs):
    """After decimation: part ids exact again (each vertex its face's part),
    the axial y and the leg weights recomputed from the positions (the
    drool's own root -> tip y is kept, interpolated)."""
    me = ob.data
    nv = len(me.vertices)
    part = attr_np(me, "part", len(me.polygons), dtype=np.int32)
    vpart = attr_np(me, "vpart", nv, dtype=np.int32)
    ay = attr_np(me, "ay", nv)
    lz = attr_np(me, "lz", nv)
    for p in me.polygons:
        for vi in p.vertices:
            vpart[vi] = part[p.index]
    for v in me.vertices:
        pid = int(vpart[v.index])
        co = gl(v.co)
        if pid != P_DROOL:
            ay[v.index] = axial(co)
        if 1 <= pid <= 8:
            hip, d, reach = legs[pid]
            lz[v.index] = max(0.0, min(1.0, (co - hip).dot(d) / reach))
        else:
            lz[v.index] = 0.0
    me.attributes["vpart"].data.foreach_set("value", vpart)
    me.attributes["ay"].data.foreach_set("value", ay)
    me.attributes["lz"].data.foreach_set("value", lz)


def final_material_baked(img_alb, img_mr, img_nrm, img_em):
    m = bpy.data.materials.new("TardigradeBaked")
    m.use_nodes = True
    m.use_backface_culling = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img_alb
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img_mr
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(t.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], b.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], b.inputs["Metallic"])
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img_em
    nt.links.new(t.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 1.0
    import bake_utils
    bake_utils.attach_normal_map(m, img_nrm)
    return m


def final_material_fur(img_fur, img_fur_n):
    m = bpy.data.materials.new("TardigradeFur")
    m.use_nodes = True
    m.use_backface_culling = False           # the cards are seen from both sides
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img_fur
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    # alphaMode MASK at cutoff 0.01: 1 - (alpha < 0.01). A stock viewer cuts
    # the lock cards to their locks; its fur base, tiling unremapped over the
    # whole atlas, shows lock-coverage holes where it wraps onto the locks
    # half (accepted, as the saucer's R14a: the game remaps the base and its
    # shells into furAtlas.shells, floored over the cutoff, and raises the
    # cutoff per shell)
    lt = nt.nodes.new("ShaderNodeMath")
    lt.operation = "LESS_THAN"
    nt.links.new(t.outputs["Alpha"], lt.inputs[0])
    lt.inputs[1].default_value = FUR_CUTOFF
    one = nt.nodes.new("ShaderNodeMath")
    one.operation = "SUBTRACT"
    one.inputs[0].default_value = 1.0
    nt.links.new(lt.outputs[0], one.inputs[1])
    nt.links.new(one.outputs[0], b.inputs["Alpha"])
    b.inputs["Roughness"].default_value = 0.55
    b.inputs["Metallic"].default_value = 0.0
    import bake_utils
    bake_utils.attach_normal_map(m, img_fur_n)
    m.surface_render_method = "DITHERED"
    return m


def final_stage():
    ml.reset_scene()
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.seed = 0

    # ---------------------------------------------------- the sculpt ---
    rt = ml.root("Tardigrade_High")
    H = HighSink(rt)
    hm = build(HIGH, H)
    make_bake_materials()
    com_bl, vol = ml.centre_of_mass(H.objects)          # the blockout's origin: every part, the coat proxy too
    com = gl(com_bl)
    print("tardigrade: centre of mass (glTF) %s, volume %.3f" % (tuple(round(c, 4) for c in com), vol))
    highs, occluders = [], []
    for o in list(H.objects):
        o.parent = None
        if o.name == "Tardigrade_Fur":
            occluders.append(o)          # (kept for the AO bake: the coat shades the skin under it)
            continue
        me = o.data
        bk = attr_np(me, "bk", len(me.polygons), dtype=np.int32)
        used = sorted(set(int(b) for b in bk if b > 0))
        me.materials.clear()
        for b in used:
            me.materials.append(mb.REGISTRY[BAKES[b - 1]][0])
        remap = {b: i for i, b in enumerate(used)}
        me.polygons.foreach_set("material_index", [remap.get(int(b), 0) for b in bk])
        highs.append(o)
    bpy.data.objects.remove(rt)

    # --------------------------------------------------- the game mesh ---
    L = LowSink()
    lm = build(LOW, L)
    hg = sorted(H.groups)
    lg = sorted({info["grp"] for _, info in L.pieces})
    assert len(hg) == len(lg) and [H.groups[g]["name"] for g in hg] == [
        next(i["name"] for _, i in L.pieces if i["grp"] == g) for g in lg], "high and low pieces differ"
    print("tardigrade: %d locks; drips moved off unsuitable locks: %s" % (len(lm["cards"]), lm["drip_swaps"]))
    body_grp = next(i["grp"] for _, i in L.pieces if i["name"] == "body")
    thinness(L)
    by_piece = {}
    for span, info in L.pieces:
        by_piece[info["name"]] = by_piece.get(info["name"], 0) + sum(len(f.verts) - 2 for f in span.faces())
    print("tardigrade: LOD0 triangles by part (before the cards)", dict(sorted(by_piece.items(), key=lambda kv: -kv[1])))
    low = to_mesh_object("TardigradeLow", L.bm)
    mb.activate(low)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50), keep_sharp_edges=True)
    sm = bmesh.new()                # organic parts: smooth across their own edges, whatever the angle
    sm.from_mesh(low.data)
    lbk = sm.faces.layers.int["bk"]
    organic = {BAKE_IDS[k] for k in BAKES if k != "crystal"}
    for e in sm.edges:
        ks = {f[lbk] for f in e.link_faces}
        if len(ks) == 1 and ks <= organic:
            e.smooth = True
    sm.to_mesh(low.data)
    sm.free()
    # the body's skin and fur base take the analytic surface's normals
    me = low.data
    grp_ = attr_np(me, "grp", len(me.polygons), dtype=np.int32)
    cn = [tuple(c.vector) for c in me.corner_normals]
    n_set = 0
    for p in me.polygons:
        if grp_[p.index] != body_grp:
            continue
        for li in range(p.loop_start, p.loop_start + p.loop_total):
            q = gl(me.vertices[me.loops[li].vertex_index].co)
            if abs(q.z) > HALF - 1e-5 or q.z > SNOUT_Z - 1e-5:
                nn = Vector((0, 0, 1 if q.z > 0 else -1))
            else:
                nn = body_n(q.z, body_theta(q))
            cn[li] = tuple(GL2BL.to_3x3() @ nn)
            n_set += 1
    me.normals_split_custom_set(cn)
    print("tardigrade: body corners on the analytic surface's normals:", n_set)
    write_motion(low)
    prim = attr_np(low.data, "prim", len(low.data.polygons), dtype=np.int32)
    fur = separate(low, prim == 2, "TardigradeFurLow")
    for o in (low, fur):
        o.data.polygons.foreach_set("material_index", np.zeros(len(o.data.polygons), np.int32))
    tgt = bpy.data.materials.new("BAKE_TARGET")
    tgt.use_nodes = True
    low.data.materials.clear()
    low.data.materials.append(tgt)
    unwrap_baked(low, body_grp)
    unwrap_fur(fur, random.Random(SEED + 4))

    # ------------------------------------------------------- the bakes ---
    def explode(ob, sign, domain):
        me = ob.data
        if domain == "POINT":
            g = attr_np(me, "grp", len(me.vertices), dtype=np.int32)
        else:
            g = np.zeros(len(me.vertices), np.int32)
            fg = attr_np(me, "grp", len(me.polygons), dtype=np.int32)
            for p in me.polygons:
                g[list(p.vertices)] = fg[p.index]
        co = np.zeros(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        co[:, 0] += sign * EXPLODE * g
        me.vertices.foreach_set("co", co.ravel())
        me.update()

    # a shared UV island takes its master instance's bake only: the other
    # instances' UVs wait outside the image (else every leg's AO and every
    # tooth's shading land in the same texels, as blotches)
    me = low.data
    shg_ = attr_np(me, "shg", len(me.polygons), dtype=np.int32)
    shi_ = attr_np(me, "shi", len(me.polygons), dtype=np.int32)
    uvd = me.uv_layers["UVMap"].data
    parked = [li for p in me.polygons if shg_[p.index] > 0 and shi_[p.index] > 0
              for li in range(p.loop_start, p.loop_start + p.loop_total)]
    for li in parked:
        uvd[li].uv = (uvd[li].uv[0] + 4.0, uvd[li].uv[1])
    for o in highs:
        explode(o, 1, "POINT")
    explode(low, 1, "FACE")
    for o in [fur] + occluders:
        o.hide_render = True
    imgs = {}
    for mode, size, samples in (("albedo", BAKE, 4), ("mr", BAKE, 4), ("emit", BAKE, 2), ("normal", NBAKE, 4)):
        mb.set_mode(mode)
        imgs[mode] = mb.new_img("tardigrade_%s_raw" % mode, size)
        mb.bake(low, highs, "NORMAL" if mode == "normal" else "EMIT", imgs[mode], samples,
                16 if mode == "normal" else 8, extrusion=0.06, max_ray=0.18)
        print("tardigrade: baked", mode)
    explode(low, -1, "FACE")
    for o in highs:
        o.hide_render = True
    for o in [fur] + occluders:
        o.hide_render = False
    world = bpy.data.worlds.new("bake_world")
    sc.world = world
    world.light_settings.distance = 0.3
    imgs["ao"] = mb.new_img("tardigrade_ao_raw", AO_TEX)
    mb.bake(low, None, "AO", imgs["ao"], 64, 8)
    print("tardigrade: baked ao")
    uvd = low.data.uv_layers["UVMap"].data
    for li in parked:
        uvd[li].uv = (uvd[li].uv[0] - 4.0, uvd[li].uv[1])

    alb = mb.down(mb.pixels(imgs["albedo"]), TEX)
    mr = mb.down(mb.pixels(imgs["mr"]), TEX)
    em = mb.down(mb.pixels(imgs["emit"]), EM_TEX)
    ao = mb.pixels(imgs["ao"])
    ao = ao if AO_TEX == TEX else mb.down(ao, TEX)
    nrm = mb.down(mb.pixels(imgs["normal"]) * 2 - 1, NTEX)
    nrm[..., :3] /= np.maximum(np.linalg.norm(nrm[..., :3], axis=-1, keepdims=True), 1e-6)
    nrm = nrm * 0.5 + 0.5
    lin = alb[..., :3] * (0.32 + 0.68 * ao[..., :1])
    alb[..., :3] = mb.to_srgb(lin)
    alb[..., 3] = 1.0
    mr[..., 0] = 1.0
    mr[..., 3] = 1.0
    em[..., :3] = mb.to_srgb(em[..., :3])
    em[..., 3] = 1.0
    nrm[..., 3] = 1.0
    img_alb = mb.to_image("tardigrade_albedo", alb)
    img_mr = mb.to_image("tardigrade_metal_rough", mb.down(mr, MR_TEX), noncolor=True)
    img_em = mb.to_image("tardigrade_emissive", em)
    img_nrm = mb.to_image("tardigrade_normal", nrm, noncolor=True)
    # dusty mauve: dark matted roots, lighter wetter tips
    shell = mb.fur_strand_texture(FUR_TEX, SEED + 5, clump_cells=4, clump=0.6, r_px=(1.5, 2.8), strands=30000,
                                  taper=0.2, base=0.25, flyaway=0.25, root=(0.07, 0.04, 0.055), floor=0.03,
                                  tip=(0.32, 0.19, 0.25), tip_hi=(0.44, 0.29, 0.35))
    locks, lock_n = mb.fur_lock_atlas(FUR_TEX, FUR_TEX, LOCK_VARIANTS, SEED + 8, root=(0.09, 0.05, 0.07),
                                      tip=(0.34, 0.20, 0.27), wet=(0.46, 0.30, 0.37))
    fur_rgba = np.concatenate([shell, locks], 1)                  # (rows, 2 x FUR_TEX, 4)
    fur_rgba[..., :3] = mb.to_srgb(fur_rgba[..., :3])
    fur_n = np.concatenate([mb.height_normal(shell[..., 3], 6.0), lock_n], 1)
    fur_n = mb.down_rect(fur_n * 1.0, 2)
    fur_n /= np.linalg.norm(fur_n, axis=-1, keepdims=True)
    fur_n = np.concatenate([fur_n * 0.5 + 0.5, np.ones_like(fur_n[..., :1])], -1)
    img_fur = mb.to_image("tardigrade_fur", fur_rgba, alpha=True)
    img_fur_n = mb.to_image("tardigrade_fur_normal", fur_n, noncolor=True)
    for img in imgs.values():
        bpy.data.images.remove(img)
    for o in highs + occluders:
        me = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(me)

    # ------------------------------------------------------ the fur cards ---
    add_cards(fur, lm["cards"], random.Random(SEED + 6))
    write_motion(fur)

    # ------------------------------------------------------- LOD0, LOD1 ---
    m_baked, m_fur = final_material_baked(img_alb, img_mr, img_nrm, img_em), final_material_fur(img_fur, img_fur_n)
    for o, m in ((low, m_baked), (fur, m_fur)):
        o.data.materials.clear()
        o.data.materials.append(m)
    bpy.ops.object.select_all(action="DESELECT")
    for o in (low, fur):
        o.hide_render = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.join()
    lod0 = low
    lod0.name = lod0.data.name = "Tardigrade_LOD0"
    mats = lod0.data.materials
    assert [mats.find(n) for n in ("TardigradeBaked", "TardigradeFur")] == [0, 1]
    lod1 = lod1_from(lod0)
    fix_parts(lod1, lm["legs"])
    lod1.vertex_groups.clear()
    write_motion(lod1)

    # LOD1's geometric error -> where it switches (over what LOD1 stands in
    # for: not LOD0's cards, nor the drips hanging from them)
    def bvh_of(o):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        t = BVHTree.FromBMesh(bm)
        bm.free()
        return t

    t1 = bvh_of(lod1)
    card0 = attr_np(lod0.data, "card", len(lod0.data.polygons), dtype=np.int32)
    part0 = attr_np(lod0.data, "part", len(lod0.data.polygons), dtype=np.int32)
    dropped = card0.astype(bool) | (part0 == P_DRIP)
    skip = {vi for p in lod0.data.polygons if dropped[p.index] for vi in p.vertices}
    errs = sorted((t1.find_nearest(v.co)[0] - v.co).length for v in lod0.data.vertices if v.index not in skip)
    e90 = errs[int(len(errs) * 0.9)]
    lod1_distance = round(e90 * FOCAL_PX / 1.0, 1)
    print("tardigrade: LOD1 error p90 %.4f max %.4f -> lod1Distance %.1f" % (e90, errs[-1], lod1_distance))

    # into the final origin (the centre of mass), clean, export
    for o in (lod0, lod1):
        o.data.transform(Matrix.Translation(-com_bl))
        o.data.update()
        for a in ("bk", "part", "zone", "shg", "shi", "shk", "prim", "grp", "card", "ay", "lz", "flen", "wet", "cardf",
                  "thin", "vpart", "vgrp"):
            if a in o.data.attributes:
                o.data.attributes.remove(o.data.attributes[a])
        o.data.color_attributes.active_color = o.data.color_attributes["Zones"]
        o.data.color_attributes.render_color_index = o.data.color_attributes.find("Zones")
        o.data.uv_layers.active = o.data.uv_layers["UVMap"]
        o.data.uv_layers["UVMap"].active_render = True
    lo, hi_ = ml.gl_bounds([lod0])
    ext = hi_ - lo
    longest = max(ext)
    print("GLTF_BBOX x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % (lo.x, hi_.x, lo.y, hi_.y, lo.z, hi_.z))
    print("EXTENT x %.3f y %.3f z %.3f  longest %.3f  (allowed %.1f-%.1f)" % (ext.x, ext.y, ext.z, longest, *EXTENT))
    if not EXTENT[0] <= longest <= EXTENT[1]:
        raise SystemExit(f"tardigrade: longest extent {longest:.3f} outside {EXTENT}")
    for o in (lod0, lod1):
        o.data.calc_loop_triangles()
        per = {}
        for t in o.data.loop_triangles:
            per[t.material_index] = per.get(t.material_index, 0) + 1
        print("TRIS %s %d  %s" % (o.name, len(o.data.loop_triangles),
                                  {o.data.materials[k].name: v for k, v in sorted(per.items())}))

    def r4(v):
        return [round(float(c), 4) for c in v]

    mid = (AXIS_TAIL + AXIS_MOUTH) * 0.5
    down = ml.perp(Vector((0, -1, 0)), AXIS_U).normalized()
    curl = mid + down * (AXIS_L / TAU)
    rig = {
        "hips": [r4(lm["hips"][k] - com) for k in range(1, 9)],
        "axis": {"tail": r4(AXIS_TAIL - com), "mouth": r4(AXIS_MOUTH - com)},
        "curlCentre": r4(curl - com),
        "mouth": r4(lm["mouth"] - com),
        "furMaxLength": FUR_MAX,
        "furAtlas": {"shells": [0, 0, 0.5, 1], "locks": [0.5, 0, 1, 1], "lockVariants": LOCK_VARIANTS},
        "furShells": FUR_SHELLS,
        "lod1Distance": lod1_distance,
    }
    rig_path = os.path.join(ml.ROOT, "src", "data", "tardigradeRig.json") \
        if os.path.abspath(OUT_DIR) == os.path.join(ml.ROOT, "assets-src") else os.path.join(OUT_DIR, "tardigradeRig.json")
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(rig_path, "w") as f:
        f.write(json.dumps(rig, indent=2) + "\n")
    print("wrote", rig_path)

    out = os.path.join(OUT_DIR, "tardigrade.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for o in (lod0, lod1):
        o.select_set(True)
    bpy.context.view_layer.objects.active = lod0
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True,
                              export_yup=True, export_tangents=False, export_vertex_color="ACTIVE",
                              export_all_vertex_colors=False, export_attributes=True, export_animations=False,
                              export_extras=False)
    mb.glb_drop_attributes(out, {"TardigradeBaked": ["_FUR"]})
    print("wrote", out)
    blend = os.path.join(OUT_DIR, "tardigrade.blend")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    print("wrote", blend)


final_stage()
