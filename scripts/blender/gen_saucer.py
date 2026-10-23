# Space monster 1: the saucer alien (original work after the owner's reference
# image, docs/superpowers/specs/assets/2026-10-23-saucer-alien-reference.png;
# same character, proportions and parts, not a trace).
#   $BLENDER --background --python scripts/blender/gen_saucer.py [-- --out DIR] [--stage=final|blockout]
# Output: assets-src/saucer.glb, assets-src/saucer.blend, and (final stage)
# src/data/saucerRig.json (next to the glb instead when --out is given).
#
# Stage "blockout" (look check A, approved as v3 on 2026-10-23: shapes,
# proportions, size against the ship): flat-shaded blockout materials, every
# part its own named object under the root "Saucer":
#   - Alien_Body: the pear body (round crown, wide jowls) with the open
#     grin cut in (exact boolean; the mouth's inside is the cut wall), plus
#     Alien_Teeth (sharp crooked fangs), Alien_Tongue, Alien_Goo strings
#     between the jaws;
#   - Alien_EyeL / Alien_EyeR on the face, Alien_EyeTop on the crown (each a
#     ball and a pupil looking along +Z); Alien_Brows: heavy angry lids and
#     brow rolls over all three;
#   - Alien_TentacleL / R raised up inside the dome, tips curled;
#     Alien_ArmL / R resting on the rim; Alien_Fur_Crown and
#     Alien_Fur_TentacleL / R / ArmL / R: wet clumps (the proxy for the shell
#     fur) over the top and front of the head (to the brow line, parted round
#     the top eye) and down the tentacles' backs; Alien_Drips off the fur;
#   - Saucer_Hull: a deep bowl, dark inside; Saucer_Rim: the raised lip the
#     dome sits on; Saucer_Portholes: 16 round portholes (frame + lens), number
#     0 dead ahead; Saucer_Spikes: 4 conical spikes on the diagonals;
#     Saucer_CannonMount + Saucer_Cannon: the domed turret under the bowl,
#     barrel at rest along +Z; Saucer_Slime smeared over the rim and down the
#     hull; Saucer_Dome: the glass dome, a closed thin shell.
#
# Stage "final" (the default; Task 3): the blockout above is the sculpt (the
# high mesh, with smoother fangs and sculpted pupils, spot cups and per-part
# coordinates for its materials), rebuilt from the same seeded layout at game
# resolution (the low mesh) and baked onto it: the probe's method
# (gen_probe.py), 2x supersampled bakes box-filtered down. Each part is baked
# from its own high part only (an exploded bake: every part pair moved apart
# first), so no ray hits a neighbour. Repeated parts share one UV island (the
# 16 portholes, the 4 spikes, the 11 fangs, the 3 eyes, the goo strings, the
# drips, the spots); the body's skin has its own cylindrical unwrap with its
# seam down the back. The look, all procedural (monster_bake.py materials):
#   - skin: wet green, mottled, speckled, pored and finely wrinkled, glossy
#     with a wetter film in patches; the undersides paler;
#   - spots: recessed wet pink cups on the tentacles' undersides (a decal
#     each, its own vertices, so the G zone can tint them), tiny pores in
#     them and a darker wet rim;
#   - teeth: crooked, bent, blade-flat fangs (the lower row taller, so it
#     reads over the lip), enamel streaked and hairline cracked, yellowing to
#     the root, gum-red at the root; the lips gum-red shading into a dark
#     mouth; a pink papillate tongue with a centre groove;
#   - eyes: glossy clear-coat whites with faint veins, an amber iris and a
#     black pupil;
#   - hull: brushed gunmetal (concentric lathe grain), 8 panels with seams
#     (clear of the portholes) and chunky rivet rows, scratches, grime packed in the seams and soot round the
#     portholes, wet green stains run down below each slime smear;
#   - rim: the painted band, satin, chipped to the dark primer at its edges,
#     with a ring of 12 bold stencilled dashes; the six slime smears over the
#     lip and down the wall are painted into the rim's and hull's maps
#     (raised, mirror-wet), not modelled; the porthole frames bolted; amber
#     glass lenses that glow (the emissive map); scorched spike tips; a
#     panelled turret and a ringed, soot-tipped barrel;
#   - slime and goo: lime, near-mirror wet, bubbled, paler and clearer where
#     thin (a drip's neck, a goo string's middle); drips on the tentacles,
#     the fur and the rim; goo strings sagging between the upper fangs and
#     the lower lip, thin in the middle, beaded.
# The fur is shell fur (spec Revision; R7): a fur-base primitive the game
# draws N times outward, alpha-testing a tiling strand/clump mask, plus lock
# cards (LOD0 only): every clump of the approved blockout's shaggy outline
# (its v3 tuft spines, ~220 of them on the crown, the tentacles' backs and
# the arms) as a crossed pair of pointed, drooping cards. The shells are not
# in the file. Raw-material provenance: every map is generated here
# (Cycles bakes of the node fields below, and the numpy strand mask in
# monster_bake.fur_strand_texture); no image, scan or add-on is used.
#
# CONTRACT with the combat stage (Task 5's saucerMaterial.ts) and
# tests/assetContracts.test.ts. glTF space, +Y up, the face and the cannon's
# rest aim +Z, scale 1, origin at the centre of mass (uniform density, as
# the blockout). Longest extent 2.4-3.6 (the player's ship is ~2.4).
#   Nodes "Saucer_LOD0" and "Saucer_LOD1" (no parent), each one mesh of three
#   primitives, no extensions, no tangents:
#   - "SaucerBaked": baseColor (x AO, 2048) + metallicRoughness (512) +
#     normal (2048) + emissive (512: the porthole lenses, warm amber) (R11).
#   - "SaucerDome": alphaMode BLEND, no maps (clear glass), the outer shell
#     only (draw FrontSide).
#   - "SaucerFur": alphaMode MASK, alphaCutoff 0.01 (R14: a stock viewer
#     shows the base whole; the game raises it per shell), double-sided (the
#     cards), baseColor (512, tiling, REPEAT, one repeat per 0.34 u, 4 x 4
#     clumps of ~0.085) whose alpha is the strand height mask and whose RGB
#     is the strand colour root (dark) to tip; no other map.
#   COLOR_0 is a zone mask, never a colour (a stock glTF viewer multiplies it
#   into the base colour, as the spec says; the game's material must not,
#   like ProjectProbes.tsx; turntable_monsters.py routes it out). Each
#   channel 0 or 1: on SaucerBaked R = skin tint zone, G =
#     spot tint zone, B = the saucer's paint band (the rim; authored light
#     neutral grey, the game multiplies a per-instance colour in). On
#     SaucerFur R = 1 on card vertices, 0 on the fur base; G = B = 0.
#     Absent on the dome.
#   _MOTION (vec4, every channel in [0, 1]), on every primitive:
#     x = part slot (id + 0.5) / 16: 0 hull (and the cannon mount), 1 body
#         (skin, lids and brows, upper teeth, the crown fur), 2 tentacle (the
#         four arms, their spots and fur), 3 eye L, 4 eye R, 5 eye top, 6 jaw
#         (lower teeth, tongue, the lower mouth and chin), 7 cannon, 8 goo
#         strings, then the drips by host (R12): 9 on the rim (static),
#         10 on a tentacle, 11 on the body's fur;
#     y = weight: tentacle (and its fur and spots) base 0 -> tip 1; body base
#         0 -> crown 1 (by height); jaw: its influence, 1 on the lower teeth
#         and tongue, easing to 0 where the chin meets the body (rotate the
#         jaw by angle x y about the jaw pivot); cannon 0 on the turret (yaw
#         only), 1 on the barrel (yaw and pitch); goo 0 at the upper teeth ->
#         1 at the lower (stretch between gooTop and gooBottom with the jaw);
#         drips 0 at the root -> 1 at the tip (their own); 0 elsewhere;
#     z = on the hull (part 0) the porthole ramp: 0 off a porthole lens, else
#         (k + 0.5) / 16 for lens k, counted from +Z with the angle
#         increasing toward +X (R8); on a drip (9-11) the host's weight at
#         the drip's root (the tentacle's base->tip weight, the body's
#         height weight; 0 on the rim), so it moves with its host (R12);
#         0 elsewhere;
#     w = thinness for the translucent skin term, 0 thick -> 1 thin (metal
#         and eyes 0; tentacle tips, lids, teeth, goo and drips thin).
#     The dome carries x = hull, y = z = w = 0.
#   _FUR (vec2, [0, 1]), on SaucerFur only:
#     x on the fur base = the fur's length there / furMaxLength (0 at the
#         fur's edges, so the shells close onto the skin; longest, 0.24, at
#         the hem and over the brows; the arms' undercoat is short, their
#         locks carry them); on a lock card vertex = the alpha-test height
#         along the lock (lock_x: 0.04 at its root, nearly solid, rising to
#         0.9 at its tip, where it frays into its strands);
#     y = wetness / matting, 0 dry and fluffy -> 1 wet and clumped.
#   src/data/saucerRig.json: pivots (body, jaw, eyeL, eyeR, eyeTop, cannon,
#     gooTop, gooBottom; glTF, origin-relative), muzzle, portholes (16),
#     portholeOrder "+Z toward +X", eyeRadius, bodySpan (R13: the glTF y range
#     the body weight is linear over), jawAxis, furMaxLength,
#     furShells, lod1Distance (where LOD1's 90th-percentile geometric error
#     projects to one pixel at the game's resting view, sphereLod.ts's 58 deg
#     on 802 px).
#   LOD1 is LOD0 decimated part by part (no cards), each part first cut along
#   its UV seams so no island's texels are dragged across (the stencil),
#   sharing LOD0's maps. Lock-card vertices carry the skin's normal turned out
#   across the lock (custom normals), so each lock shades round.
#   Blender 5.1's glTF importer mis-orders meshes with two custom attributes
#   (_MOTION and _FUR) by hash seed; turntable_monsters.py reads them itself.
#
# Seeded (layout, teeth, fur, spots, drips, maps): re-running reproduces
# saucer.glb byte for byte. No add-ons: bmesh, one boolean, Cycles bakes.
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import monster_bake as mb  # noqa: E402
import monster_lib as ml  # noqa: E402
from monster_lib import DARK, GLASS, GREY, LIGHT, MID, SKIN, SLIME  # noqa: E402

SEED = 20261023
OUT_DIR, STAGE = ml.parse_args("saucer", stages=("blockout", "final"), default="final")
EXTENT = (2.4, 3.6)

# ------------------------------------------------------------ dimensions ---
# (glTF units before the centre-of-mass shift; y = 0 is about the bowl's lip)
N_PORTHOLES = 16
PORTHOLE_Y = -0.10
DOME_Y, DOME_A, DOME_B, DOME_T = 0.28, 1.34, 1.72, 0.025   # centre, radius, height, wall
HULL = GREY
OUTER_CTRL = [(0.0, -0.80), (0.40, -0.78), (0.75, -0.68), (1.05, -0.48), (1.27, -0.22), (1.40, 0.02), (1.44, 0.18)]
INNER_CTRL = [(1.06, 0.18), (1.00, 0.05), (0.90, -0.15), (0.70, -0.32), (0.0, -0.38)]
OUTER = ml.smooth_profile(OUTER_CTRL, 8)
INNER = ml.smooth_profile(INNER_CTRL, 6)
RIM = [(1.02, 0.15), (1.48, 0.15), (1.545, 0.185), (1.53, 0.235), (1.45, 0.265), (1.12, 0.29), (1.05, 0.27),
       (1.00, 0.21)]
FRAME = [(0.046, -0.01), (0.078, -0.01), (0.082, 0.015), (0.074, 0.032), (0.052, 0.032), (0.046, 0.015)]
SPIKE_CTRL = [(0.0, -0.10), (0.15, -0.10), (0.145, 0.02), (0.11, 0.22), (0.065, 0.42), (0.025, 0.58), (0.0, 0.63)]
SPIKE = ml.smooth_profile(SPIKE_CTRL, 4)
MOUNT = [(0.0, -0.74), (0.27, -0.74), (0.285, -0.79), (0.27, -0.83), (0.0, -0.83)]
TURRET = [(0.0, -0.80), (0.225, -0.80)] + [
    (0.225 * math.cos(math.radians(p)), -0.82 - 0.20 * math.sin(math.radians(p))) for p in range(10, 91, 10)]
BARREL = [(0.0, 0.0), (0.058, 0.0), (0.058, 0.30), (0.074, 0.31), (0.08, 0.40), (0.046, 0.40),
          (0.046, 0.36), (0.0, 0.36)]
CANNON_C = Vector((0, -0.92, 0))
BODY_CTRL = [(0.0, -0.25), (0.45, -0.22), (0.62, 0.0), (0.69, 0.30), (0.68, 0.60), (0.62, 0.90), (0.50, 1.15),
             (0.30, 1.36), (0.0, 1.44)]
BODY_Y0, BODY_Y1 = -0.25, 1.44
MOUTH_Y, MA, MB, MC = 0.47, 0.47, 0.25, 0.30
TOP_SQUASH, SMILE = 0.42, 0.40
EYE_R = 0.2

# Low (game) profiles: the same curves, sampled coarser where they are flat.
_o2 = ml.smooth_profile(OUTER_CTRL, 2)
OUTER_L = [_o2[i] for i in (0, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12)]
INNER_L = [INNER_CTRL[i] for i in (0, 2, 3, 4)]
RIM_L = [RIM[i] for i in (0, 1, 2, 3, 4, 5, 7)]
FRAME_L = [(0.086, -0.012), (0.050, 0.031)]      # one band: the frame's bolted face is the normal map's
LENS_L = [(0.0, 0.026), (0.055, 0.012)]
SPIKE_L = [(0.15, -0.10), (0.13, 0.12), (0.07, 0.38), (0.0, 0.63)]
MOUNT_L = MOUNT[1:]
TURRET_L = [(0.225, -0.80)] + [(0.225 * math.cos(math.radians(p)), -0.82 - 0.20 * math.sin(math.radians(p)))
                               for p in (25, 50, 72, 90)]
BARREL_L = BARREL[1:]

# Resolution profiles. BLOCK is the approved v3 blockout, number for number.
# HIGH is the final stage's sculpt (BLOCK with smoother fangs); LOW the game mesh.
BLOCK = dict(final=False, hi=True, hull=64, rim=64, port=24, spike=24, mount=40, turret=40, barrel=24, dome=64,
             body=48, body_n=6, cutter=(40, 24), eye=(32, 18), tube=(18, 8, 4), fang=(6, False),
             goo=(8, 5, 2), drip=(8, 4, 3), lid=(32, 10, 12, 4), smear=(8, 5, 2), tongue=(32, 16))
HIGH = dict(BLOCK, final=True, fang=(16, False))
LOW = dict(final=True, hi=False, hull=48, rim=48, port=12, lens=6, spike=10, mount=16, turret=20, barrel=10,
           dome=48, body=24, body_n=2, cutter=(20, 12), eye=(18, 10), tube=(11, 2, 3), fang=(6, True),
           goo=(6, 2, 2), drip=(6, 1, 2), lid=(14, 3, 7, 1), smear=(4, 1, 2), tongue=(10, 6))

# The fur (R7): shell length per zone (glTF units) and the suggested layer count.
FUR_MAX = 0.24
FUR_CUTOFF = 0.01      # SaucerFur's alphaCutoff (R14)
FUR_SHELLS = 16
FUR_TILE = 0.34        # world units per repeat of the strand mask (4 x 4 clumps of ~0.085)
TAU = 2 * math.pi
PARTS = ("hull", "body", "tentacle", "eyeL", "eyeR", "eyeTop", "jaw", "cannon", "goo", "drips", "dripsTentacle",
         "dripsBody")
P_HULL, P_BODY, P_TENT, P_EYEL, P_EYER, P_EYETOP, P_JAW, P_CANNON, P_GOO, P_DRIP, P_DRIP_T, P_DRIP_B = range(12)


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
    raise ValueError(y)


def in_dome(p, margin=0.03):
    a, b = DOME_A - DOME_T - margin, DOME_B - DOME_T - margin
    return (p.x / a) ** 2 + ((p.y - DOME_Y) / b) ** 2 + (p.z / a) ** 2


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def lip(x, upper):
    s = math.sqrt(max(0.0, 1 - (x / MA) ** 2)) * 0.97
    return MOUTH_Y + (MB * TOP_SQUASH * s if upper else -MB * s) + SMILE * x * x


def body_weight(p):
    return max(0.0, min(1.0, (p.y - BODY_Y0) / (BODY_Y1 - BODY_Y0)))


def tuft_spine(base, n, length, radius, flow):
    """The centreline ml.tuft sweeps (same maths), for cards and drips."""
    n = n.normalized()
    f = ml.perp(Vector(flow), n)
    f = f.normalized() if f.length > 1e-4 else ml.perp(Vector((0, 0, -1)), n).normalized()
    p0 = base - n * radius * 0.9
    p1 = base + n * length * 0.2 + f * length * 0.12
    p2 = p1 + (n * 0.3 + f).normalized() * length * 0.42
    p3 = p2 + (f + ml.G * 0.5 - n * 0.1).normalized() * length * 0.38
    return [p0, p1, p2, p3]


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


# ------------------------------------------------------------------ sinks ---
class Span:
    """The vertices and faces a builder adds to a bmesh (they append in order)."""

    def __init__(self, bm):
        self.bm = bm
        self.v0, self.f0 = len(bm.verts), len(bm.faces)
        self.v1 = self.f1 = None

    def close(self):
        """Freeze the span's end (later pieces append after it)."""
        self.v1, self.f1 = len(self.bm.verts), len(self.bm.faces)

    def verts(self):
        self.bm.verts.ensure_lookup_table()
        return [self.bm.verts[i] for i in range(self.v0, len(self.bm.verts) if self.v1 is None else self.v1)]

    def faces(self):
        self.bm.faces.ensure_lookup_table()
        return [self.bm.faces[i] for i in range(self.f0, len(self.bm.faces) if self.f1 is None else self.f1)]


class SpanAll(Span):
    def __init__(self, bm):
        self.bm, self.v0, self.f0 = bm, 0, 0
        self.close()


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

    def mouth(self, objname, body_bm, cutter_bm, **meta):
        body = self.done(objname, body_bm)
        cutter = ml.to_object("MouthCutter", cutter_bm, None)
        ml.boolean_cut(body, cutter)
        return body


class HighSink(BlockSink):
    """The final stage's sculpt: the blockout objects, each vertex tagged with
    its bake group ("grp"), its glTF position ("gp") and, where a part has
    one, its local frame position ("lc") and a scalar ("ft")."""
    final = True

    def __init__(self, rt):
        super().__init__(rt)
        self.grp = 0
        self.groups = {}       # grp -> piece meta (for the report)

    def obj(self, name):
        bm = bmesh.new()
        bm.verts.layers.int.new("grp")
        bm.verts.layers.float_vector.new("gp")
        bm.verts.layers.float_vector.new("lc")
        bm.verts.layers.float.new("ft")
        bm.faces.layers.int.new("bk")
        return bm

    def close_piece(self, bm, span, info):
        g = info.get("grp")
        if g is None:
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

    def mouth(self, objname, body_bm, cutter_bm, **meta):
        # the cutter is tagged as the body's piece, so the cut wall carries
        # the body's group and its glTF position
        info = dict(meta)
        self.close_piece(body_bm, SpanAll(body_bm), info)
        self.close_piece(cutter_bm, SpanAll(cutter_bm), dict(meta, grp=info["grp"]))
        body = self.done(objname, body_bm)
        cutter = ml.to_object("MouthCutter", cutter_bm, None)
        ml.boolean_cut(body, cutter)
        return body


class LowSink:
    """The game mesh: one bmesh, every face tagged with its bake material,
    motion part, tint zones, shared-UV group, porthole, primitive and bake
    group, every vertex with its motion weight and fur data."""
    final = True

    def __init__(self):
        bm = self.bm = bmesh.new()
        for k in ("bk", "part", "zone", "shg", "shi", "shk", "por", "prim", "grp", "card"):
            bm.faces.layers.int.new(k)
        for k in ("wgt", "flen", "wet", "cardf", "thin", "hostw"):
            bm.verts.layers.float.new(k)
        for k in ("vpart", "vpor", "vgrp"):
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
        g = info.get("grp")
        if g is None:
            self.grp += 1
            g = self.grp
        info["grp"] = g
        F = bm.faces.layers.int
        V = bm.verts.layers.float
        sh = info.get("share")
        if sh:
            gid = self.share_ids.setdefault(sh, len(self.share_ids) + 1)
            inst = self.share_count.get(sh, 0)
            self.share_count[sh] = inst + 1
        bake = info.get("bake", {})
        zone = info.get("zone", (0, 0, 0))
        por = info.get("por")
        faces = span.faces()
        for k, f in enumerate(faces):
            name = bake.get(f.material_index)
            if name is None:
                raise SystemExit(f"{info.get('name')}: no bake material for blockout material {f.material_index}")
            f[F["bk"]] = BAKE_IDS[name]
            f[F["part"]] = info["part"]
            f[F["zone"]] = zone[0] | zone[1] << 1 | zone[2] << 2
            f[F["prim"]] = info.get("prim", 0)
            f[F["grp"]] = g
            f[F["card"]] = info.get("card", 0)
            if sh:
                f[F["shg"]], f[F["shi"]], f[F["shk"]] = gid, inst, k
            if por and name == por[1]:
                f[F["por"]] = por[0]
        C = info.get("C")
        T = arc_t(C) if C else None
        wf = info.get("wgt")
        VI = bm.verts.layers.int
        lens_verts = {v for f in faces if por and f[F["bk"]] == BAKE_IDS[por[1]] for v in f.verts}
        for v in span.verts():
            v[VI["vpart"]] = info["part"]
            v[VI["vgrp"]] = g
            v[V["hostw"]] = info.get("hostw", 0.0)
            if v in lens_verts:
                v[VI["vpor"]] = por[0]
            if callable(wf):
                v[V["wgt"]] = wf(v.co)
            elif wf == "C":
                v[V["wgt"]] = nearest_t(C, T, v.co)
            else:
                v[V["wgt"]] = float(wf or 0.0)
        if "after" in info:
            info["after"](bm, span, info)
        self.pieces.append((span, info))

    def mouth(self, objname, body_bm, cutter_bm, **meta):
        """Cut the grin into the low body (exact boolean on temporary objects,
        in glTF space) and append the result as one piece."""
        def tmp(nm, bm):
            me = bpy.data.meshes.new(nm)
            bm.to_mesh(me)
            bm.free()
            used = sorted({p.material_index for p in me.polygons})
            for i in used:
                me.materials.append(ml.MATS[i])
            remap = {g: k for k, g in enumerate(used)}
            me.polygons.foreach_set("material_index", [remap[p.material_index] for p in me.polygons])
            ob = bpy.data.objects.new(nm, me)
            bpy.context.scene.collection.objects.link(ob)
            return ob
        body, cutter = tmp("LowBody", body_bm), tmp("LowCutter", cutter_bm)
        ml.boolean_cut(body, cutter)
        tb = bmesh.new()
        tb.from_mesh(body.data)
        mats = [ml.MATS.index(m) for m in body.data.materials]
        with self.piece(self.bm, **meta) as info:
            vmap = {}
            for v in tb.verts:
                vmap[v] = self.bm.verts.new(v.co)
            for f in tb.faces:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
                nf.material_index = mats[f.material_index]
        tb.free()
        me = body.data
        bpy.data.objects.remove(body)
        bpy.data.meshes.remove(me)
        return info


# -------------------------------------------------------------- bake mats ---
BAKES = ("hull", "hull_in", "band", "frame", "lens", "spike", "turret", "barrel", "bore", "skin", "mouth",
         "tooth", "tongue", "slime", "goo", "eye", "pupil", "spot", "dome", "fur")
BAKE_IDS = {k: i for i, k in enumerate(BAKES)}
# texel density relative to smart-project's uniform one: the face, the teeth,
# the eyes and the spots get the texels; the bowl's inside and the bore almost none
UV_DENSITY = {"hull": 0.85, "hull_in": 0.22, "band": 1.3, "goo": 1.6, "frame": 1.8, "lens": 2.2, "spike": 0.9, "turret": 1.0,
              "barrel": 1.3, "bore": 0.2, "skin": 1.75, "mouth": 1.3, "tooth": 2.6, "tongue": 0.9, "slime": 1.3,
              "eye": 2.4, "spot": 3.0}


def low_body(R, body_sm, bvh):
    """The game mesh's body: the layout body's surface on a grid whose ring K
    runs exactly along the crown's ragged hem (the blockout's hem rule), so
    the fur base splits off along a smooth hairline instead of the grid's
    steps. Rings below and above it are spaced proportionally per column."""
    ys = [y for _, y in ml.smooth_profile(BODY_CTRL, R["body_n"])]
    K = min(range(len(ys)), key=lambda k: abs(ys[k] - 0.92))
    y0, y1 = ys[0], ys[-1]

    def point(th, y):
        r = 0.0 if y <= y0 + 1e-6 or y >= y1 - 1e-6 else profile_at(body_sm, y)[0]
        return Vector((r * math.sin(th), y, r * math.cos(th) * 0.9 + 0.05 * max(y - 0.3, 0.0)))

    def hem_y(th):
        y = 0.9
        for _ in range(12):
            p = point(th, y)
            n = bvh.find_nearest(p)[1]
            y = 1.06 - 0.36 * max(-n.z, 0.0) + 0.04 * math.sin(7 * math.atan2(p.x, p.z))
        return y + 0.002          # (just above it: the hem ring's faces stay skin)

    segs = R["body"]
    bm = bmesh.new()
    cols = []
    for j in range(segs):
        th = TAU * j / segs
        yh = hem_y(th)
        col = []
        for k, y in enumerate(ys):
            if k <= K:
                yy = y0 + (y - y0) * (yh - y0) / (ys[K] - y0)
            else:
                yy = yh + (y - ys[K]) * (y1 - yh) / (y1 - ys[K])
            col.append(yy)
        cols.append(col)
    rings = [[bm.verts.new(Vector((0, y0, 0)))]]
    for k in range(1, len(ys) - 1):
        rings.append([bm.verts.new(point(TAU * j / segs, cols[j][k])) for j in range(segs)])
    rings.append([bm.verts.new(Vector((0, y1, 0.05 * (y1 - 0.3))))])
    faces = []
    for k in range(len(rings) - 1):
        A, B = rings[k], rings[k + 1]
        for j in range(segs):
            j1 = (j + 1) % segs
            vs = (A[0], B[j1], B[j]) if len(A) == 1 else (A[j], A[j1], B[0]) if len(B) == 1 else \
                (A[j], A[j1], B[j1], B[j])
            f = bm.faces.new(vs)
            f.material_index = SKIN
            faces.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return bm


# ================================================================== build ===
def build(R, S):
    """Every part at resolution R into sink S. The layout (rng draws, fur
    placement, the body the face is placed on) is the blockout's whatever R
    is, so the high and the low mesh are the same model."""
    rng = random.Random(SEED)          # v3's stream: same draws in the same order
    rx = random.Random(SEED + 1)       # the final stage's extras (fang bends, spots)
    meta = {"cards": [], "worst": [], "spots": [], "eyes": []}
    final, hi = R["final"], R["hi"]

    def fit(name, verts):
        meta["worst"].append((name, max([in_dome(v.co) for v in verts if v.co.y > DOME_Y] or [0.0])))

    # -------------------------------------------------------------- hull ---
    bm = S.obj("Saucer_Hull")
    o, i_ = (OUTER, INNER) if hi else (OUTER_L, INNER_L)
    prof = o + i_
    mats = [HULL] * (len(o) - 1) + [HULL] + [DARK] * (len(i_) - 1)
    with S.piece(bm, name="hull", part=P_HULL, bake={HULL: "hull", DARK: "hull_in"}):
        ml.lathe(bm, prof, R["hull"], mats=mats)
    S.done("Saucer_Hull", bm)

    bm = S.obj("Saucer_Rim")
    with S.piece(bm, name="rim", part=P_HULL, bake={LIGHT: "band"}, zone=(0, 0, 1)):
        # a broad lip flaring past the bowl, sloping up to where the dome stands
        ml.lathe(bm, RIM if hi else RIM_L, R["rim"], mi=LIGHT, closed=True)
    S.done("Saucer_Rim", bm)

    # portholes: frame ring + lens, on the bowl's outer wall
    bm = S.obj("Saucer_Portholes")
    r_p, n_p = profile_at(OUTER, PORTHOLE_Y)
    for k in range(N_PORTHOLES):
        a = 2 * math.pi * k / N_PORTHOLES          # k = 0 dead ahead (+Z), increasing toward +X
        out = Vector((math.sin(a), 0, math.cos(a)))
        pos = out * r_p + Vector((0, PORTHOLE_Y, 0))
        nrm = (out * n_p.x + Vector((0, n_p.y, 0))).normalized()
        M = ml.place(pos, nrm)
        with S.piece(bm, name=f"porthole{k}", part=P_HULL, bake={LIGHT: "frame", DARK: "lens"}, share="porthole",
                     por=(k + 1, "lens"), M=M):
            if hi:
                ml.lathe(bm, FRAME, R["port"], M, mi=LIGHT, closed=True)
                ml.ellipsoid(bm, M @ Vector((0, 0.012, 0)), (0.052, 0.012, 0.052), 20, 6, DARK, R=ml.rot_to(nrm))
            else:
                ml.lathe(bm, FRAME_L, R["port"], M, mi=LIGHT)
                ml.lathe(bm, LENS_L, R["lens"], M, mi=DARK)
    S.done("Saucer_Portholes", bm)

    # four spikes on the diagonals, outward and down
    bm = S.obj("Saucer_Spikes")
    y_s, _ = profile_r(OUTER, 0.78)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        out = Vector((math.sin(a), 0, math.cos(a)))
        base = out * 0.78 + Vector((0, y_s, 0))
        d = (out * 0.6 + Vector((0, -1, 0))).normalized()
        M = ml.place(base, d)
        with S.piece(bm, name=f"spike{k}", part=P_HULL, bake={MID: "spike"}, share="spike", M=M,
                     ftf=lambda co, lc: (lc.y + 0.1) / 0.73):
            ml.lathe(bm, SPIKE if hi else SPIKE_L, R["spike"], M, mi=MID)
    S.done("Saucer_Spikes", bm)

    # the cannon: a collar under the bowl, a domed turret, the barrel along +Z
    bm = S.obj("Saucer_CannonMount")
    with S.piece(bm, name="mount", part=P_HULL, bake={LIGHT: "hull"}):
        ml.lathe(bm, MOUNT if hi else MOUNT_L, R["mount"], mi=LIGHT)
    S.done("Saucer_CannonMount", bm)
    bm = S.obj("Saucer_Cannon")
    with S.piece(bm, name="turret", part=P_CANNON, bake={MID: "turret"}, wgt=0.0, M=Matrix.Translation(CANNON_C)):
        ml.lathe(bm, TURRET if hi else TURRET_L, R["turret"], mi=MID)
    Mb = ml.place(CANNON_C, (0, 0, 1))
    with S.piece(bm, name="barrel", part=P_CANNON, bake={MID: "barrel", DARK: "bore"}, wgt=1.0, M=Mb,
                 ftf=lambda co, lc: lc.y / 0.40):
        if hi:
            ml.lathe(bm, BARREL, R["barrel"], Mb, mats=[MID] * 5 + [DARK] * 2)
        else:
            ml.lathe(bm, BARREL_L, R["barrel"], Mb, mats=[MID] * 4 + [DARK] * 2)
    S.done("Saucer_Cannon", bm)
    meta["cannon"] = CANNON_C.copy()
    meta["muzzle"] = Mb @ Vector((0, 0.40, 0))

    # the dome: a closed thin shell standing on the rim (the game's: its outer face)
    bm = S.obj("Saucer_Dome")
    with S.piece(bm, name="dome", part=P_HULL, bake={GLASS: "dome"}, prim=1):
        if hi:
            outer = [(DOME_A * math.sin(math.radians(p)), DOME_Y + DOME_B * math.cos(math.radians(p)))
                     for p in range(0, 91, 5)]
            inner = [(r * (DOME_A - DOME_T) / DOME_A, DOME_Y + (y - DOME_Y) * (DOME_B - DOME_T) / DOME_B)
                     for r, y in outer]
            ml.lathe(bm, inner + outer[::-1], R["dome"], mi=GLASS)
        else:
            outer = [(DOME_A * math.sin(math.radians(p)), DOME_Y + DOME_B * math.cos(math.radians(p)))
                     for p in (0, 16, 31, 45, 58, 70, 81, 90)]
            fs = ml.lathe(bm, outer, R["dome"], mi=GLASS)
            for f in fs:                                   # outward, for FrontSide
                f.normal_update()
                if f.normal.dot(f.calc_center_median() - Vector((0, DOME_Y, 0))) < 0:
                    f.normal_flip()
    S.done("Saucer_Dome", bm, smooth_angle=80)

    # ------------------------------------------------------------- alien ---
    # the layout body (the blockout's, whatever R is): the face is placed on it
    body_sm = ml.smooth_profile(BODY_CTRL, 6)
    lay = bmesh.new()
    ml.lathe(lay, body_sm, 48, mi=SKIN)
    for v in lay.verts:                       # a little flatter front-to-back, crown nodding forward
        v.co.z = v.co.z * 0.9 + 0.05 * max(v.co.y - 0.3, 0.0)
    lay.normal_update()
    bvh = BVHTree.FromBMesh(lay)
    BODY_PTS = [(v.co.copy(), v.normal.copy()) for v in lay.verts]
    meta["body_bvh"] = bvh

    def front(x, y):
        """(point, normal) where a ray along -Z at (x, y) meets the body."""
        loc, nrm, _, _ = bvh.ray_cast(Vector((x, y, 3.0)), Vector((0, 0, -1)))
        return loc, nrm

    if R["body"] == 48 and not S.final:
        body_bm = lay
    elif R["body"] == 48:          # the high sink's layers on a copy of the layout body
        body_bm = S.obj("Alien_Body")
        lay.verts.ensure_lookup_table()
        for v in lay.verts:
            body_bm.verts.new(v.co)
        body_bm.verts.ensure_lookup_table()
        for f in lay.faces:
            body_bm.faces.new([body_bm.verts[v.index] for v in f.verts]).material_index = f.material_index
        lay.free()
    else:
        body_bm = low_body(R, body_sm, bvh)
        lay.free()

    # the grin: a D-shaped cutter (flat top lip, round jaw), corners pulled up
    zf = front(0, MOUTH_Y)[0].z
    MOUTH_C = Vector((0, MOUTH_Y, zf + 0.07))
    cutter_bm = S.obj("MouthCutter") if S.final and hi else bmesh.new()
    ml.ellipsoid(cutter_bm, MOUTH_C, (MA, MB, MC), *R["cutter"], DARK)
    for v in cutter_bm.verts:
        if v.co.y > MOUTH_Y:
            v.co.y = MOUTH_Y + (v.co.y - MOUTH_Y) * TOP_SQUASH
        v.co.y += SMILE * v.co.x ** 2

    def jaw_influence(p):
        """1 in the lower mouth and over the chin, easing to 0 where the jaw
        meets the face (above the mouth's centre line, past its corners,
        down the throat and toward the back of the head)."""
        lb = lip(min(abs(p.x), MA), False)
        s_up = smoothstep(MOUTH_Y + 0.05, MOUTH_Y - 0.08, p.y)
        s_down = smoothstep(lb - 0.52, lb - 0.20, p.y)
        s_lat = 1 - smoothstep(MA - 0.06, MA + 0.16, abs(p.x))
        s_back = smoothstep(zf - 0.62, zf - 0.30, p.z)
        return s_up * s_down * s_lat * s_back

    def body_after(bm, span, info):
        """Split the jaw off the body by influence, and the crown's skin off
        into the fur base (prim 2); zone R on the skin."""
        F, V, VI = bm.faces.layers.int, bm.verts.layers.float, bm.verts.layers.int
        tc, tr, _ = meta["eyes"][2]
        for v in span.verts():
            j = jaw_influence(v.co)
            v[VI["vpart"]] = P_JAW if j > 1e-3 else P_BODY
            v[V["wgt"]] = j if j > 1e-3 else body_weight(v.co)
        bm.normal_update()
        for f in span.faces():
            skin = f[F["bk"]] == BAKE_IDS["skin"]
            f[F["zone"]] = 1 if skin else 0
            if skin and crown_fur(f.calc_center_median(), f.normal, tc, tr):
                f[F["prim"]] = 2
        for v in span.verts():
            # the crown's coat: shorter over the brows, closing to the skin
            # at the hem, round the top eye's parting and over the face eyes
            p, n = v.co, v.normal
            hem = 1.06 - 0.36 * max(-n.z, 0.0) + 0.04 * math.sin(7 * math.atan2(p.x, p.z))
            d_hem = p.y - hem
            d_top = (p - tc).length - (tr + 0.06)
            d_eye = min((p - c).length - (r + 0.12) for c, r, _ in meta["eyes"][:2])
            ramp = smoothstep(-0.01, 0.05, d_hem) * smoothstep(-0.01, 0.06, d_top) * smoothstep(-0.01, 0.05, d_eye)
            # longest at the hem and over the brows (the v3 locks hung there)
            v[V["flen"]] = (0.16 + 0.04 * max(n.z, 0.0) + 0.04 * (1 - smoothstep(0.0, 0.3, d_hem))) * ramp
            v[V["wet"]] = 0.2 + 0.6 * (1 - smoothstep(0.0, 0.22, d_hem))

    meta["MOUTH_C"], meta["zf"], meta["jaw_influence"] = MOUTH_C, zf, jaw_influence
    meta["jaw_pivot"] = Vector((0, lip(MA, True) - 0.04, zf - 0.32))
    body_meta = dict(name="body", part=P_BODY, bake={SKIN: "skin", DARK: "mouth"}, wgt=body_weight)
    # (the crown split needs the top eye, placed below: done after the eyes)
    if isinstance(S, LowSink):
        body_info = S.mouth("Alien_Body", body_bm, cutter_bm, **body_meta)
    else:
        body_ob = S.mouth("Alien_Body", body_bm, cutter_bm, **body_meta)
        meta["body_ob"] = body_ob

    # sharp crooked fangs: the top row hangs from the lip, canines longest;
    # the bottom row stands on the jaw, its outer pair tusk-like
    bm = S.obj("Alien_Teeth")
    sides, low = R["fang"]
    goo_top, goo_bot = [], []

    def fang(base, d, w, h, upper):
        bend, flat = (rx.uniform(-0.22, 0.22), rx.uniform(0.62, 0.8)) if final else (0.0, 1.0)
        with S.piece(bm, name="tooth", part=P_BODY if upper else P_JAW, bake={LIGHT: "tooth"}, share="tooth",
                     wgt=body_weight if upper else 1.0, ftf=lambda co, lc, h=h: (lc.y + 0.03) / (h + 0.03)) as info:
            sp = Span(bm)
            M = ml.fang(bm, base, d, w, h, LIGHT, rng.uniform(0, 1), sides=sides, low=low)
            info["M"] = M
            if final:      # bent and blade-flat: a crooked fang, not a cone
                Mi = M.inverted()
                for v in sp.verts():
                    lc = Mi @ v.co
                    t = max(0.0, lc.y) / h
                    lc.x += bend * h * t * t
                    lc.z *= flat
                    v.co = M @ lc

    for x, h in ((-0.33, 0.10), (-0.21, 0.17), (-0.09, 0.09), (0.04, 0.11), (0.16, 0.08), (0.27, 0.16)):
        yt = lip(x, True)
        p, n = front(x, yt + 0.02)
        d = Vector((rng.uniform(-0.28, 0.28), -1, rng.uniform(0.05, 0.3))).normalized()
        fang(Vector((x, yt + 0.025, p.z - 0.05)), d, 0.042 * rng.uniform(0.9, 1.15), h * rng.uniform(0.9, 1.1), True)
    for x, h in ((-0.30, 0.15), (-0.15, 0.08), (0.0, 0.10), (0.13, 0.07), (0.29, 0.14)):
        yb = lip(x, False)
        p, n = front(x, yb - 0.03)
        d = Vector((rng.uniform(-0.3, 0.3) + 0.25 * x, 1, rng.uniform(0.05, 0.3))).normalized()
        w_, h_ = 0.04 * rng.uniform(0.9, 1.15), h * rng.uniform(0.9, 1.1)
        if final:          # the lower row reads over the lip: taller, a little forward
            fang(Vector((x, yb - 0.025, p.z - 0.045)), d, w_ * 1.1, h_ * 1.55, False)
        else:
            fang(Vector((x, yb - 0.025, p.z - 0.06)), d, w_, h_, False)
    S.done("Alien_Teeth", bm)

    bm = S.obj("Alien_Tongue")
    with S.piece(bm, name="tongue", part=P_JAW, bake={GREY: "tongue"}, wgt=1.0):
        if final:          # a little lower and slimmer, so the lower fangs show
            ml.ellipsoid(bm, (0.05, MOUTH_Y - 0.175, zf - 0.15), (0.24, 0.065, 0.15), *R["tongue"], GREY)
        else:
            ml.ellipsoid(bm, (0.05, MOUTH_Y - 0.15, zf - 0.13), (0.25, 0.08, 0.15), *R["tongue"], GREY)
    S.done("Alien_Tongue", bm)

    # goo strings from the top jaw to the bottom one, bowed and beaded
    bm = S.obj("Alien_Goo")
    ring, per, cap = R["goo"]
    for x, bow, beads in ((-0.27, 0.03, ((0.62, 0.012),)), (-0.03, 0.045, ()), (0.10, 0.02, ((0.45, 0.016),)),
                          (0.22, 0.035, ())):
        yt, yb = lip(x, True), lip(x, False)
        zt, zb = front(x, yt + 0.02)[0].z, front(x, yb - 0.03)[0].z
        sway = rng.uniform(-0.03, 0.03)
        pts = [Vector((x, yt + 0.01, zt - 0.07)), Vector((x + sway, yt * 0.6 + yb * 0.4, zt - 0.06 + bow)),
               Vector((x + sway * 0.6, yt * 0.3 + yb * 0.7, zb - 0.06 + bow * 0.8)), Vector((x, yb - 0.005, zb - 0.08))]
        r_end, r_mid = 0.016, 0.007
        if final:
            # a sagging string: from the upper fangs' roots down to the lower
            # lip in front of the tongue, bellying forward and down (a
            # catenary), thin in the middle, one or two beads
            yb2 = yb + 0.03
            top = Vector((x, yt + 0.005, front(x, yt + 0.02)[0].z - 0.04))
            bot = Vector((x + sway * 0.5, yb2, front(x, yb2)[0].z - 0.022))
            sag = 0.055 + 0.6 * bow + rx.uniform(0.0, 0.02)
            pts = [top.lerp(bot, u) + Vector((sway * math.sin(math.pi * u), -0.35 * sag * math.sin(math.pi * u),
                                              sag * math.sin(math.pi * u))) for u in (0.0, 0.3, 0.55, 0.8, 1.0)]
            beads = beads or ((rx.uniform(0.35, 0.65), rx.uniform(0.008, 0.012)),)
            r_end, r_mid = 0.013, 0.0042
        goo_top.append(pts[0])
        goo_bot.append(pts[-1])
        with S.piece(bm, name="goo", part=P_GOO, bake={SLIME: "goo"}, share="goo", wgt="C",
                     C=ml.catmull(pts, 8)):
            ml.strand(bm, pts, r_end, r_mid, SLIME, beads, ring=ring, per_seg=per, cap=cap)
    S.done("Alien_Goo", bm)
    meta["gooTop"] = sum(goo_top, Vector()) / len(goo_top)
    meta["gooBottom"] = sum(goo_bot, Vector()) / len(goo_bot)

    EYES = meta["eyes"]

    def eye(name, p, n, radius, sink, gaze, part, pupil=0.4):
        """Ball sunk `sink` along -n into the skin, a small dark pupil facing
        `gaze` (the game mesh paints it: its ball turns to the gaze, so the
        three eyes share one island)."""
        bm = S.obj(name)
        c = p - n * sink
        g = Vector(gaze).normalized()
        Rg = Vector((0, 0, 1)).rotation_difference(g).to_matrix().to_4x4()
        M = Matrix.Translation(c) @ Rg @ Matrix.Diagonal((radius, radius, radius, 1))
        with S.piece(bm, name="eye", part=part, bake={LIGHT: "eye", DARK: "pupil"}, share="eye", M=M,
                     ftf=lambda co, lc: lc.z / max(lc.length, 1e-6)):
            if hi:
                ml.ellipsoid(bm, c, (radius,) * 3, *R["eye"], LIGHT)
                ml.ellipsoid(bm, c + g * radius * 0.95, (radius * pupil, radius * pupil, radius * 0.16), 24, 10,
                             DARK, R=Rg)
            else:
                ml.ellipsoid(bm, c, (radius,) * 3, *R["eye"], LIGHT, R=Rg)
        S.done(name, bm)
        EYES.append((c, radius, g))
        return c

    for side, name, part in ((1, "Alien_EyeL", P_EYEL), (-1, "Alien_EyeR", P_EYER)):    # +X is the alien's left
        p, n = front(0.27 * side, 0.98)
        eye(name, p, n, EYE_R, 0.075, n * 0.3 + Vector((0, 0, 1)), part)
    loc, n_top, _, _ = bvh.ray_cast(Vector((0, 3.0, 0.14)), Vector((0, -1, 0)))
    top_c = eye("Alien_EyeTop", loc, n_top, EYE_R, 0.035, (0, 0.25, 1), P_EYETOP)

    # heavy angry brows: a lid over each ball, slanting down to the nose, and a
    # thick brow roll on its edge; the top eye gets a V brow
    bm = S.obj("Alien_Brows")
    segs, steps, bring, bper = R["lid"]
    res = dict(segs=segs, steps=steps, ring=bring, per_seg=bper)
    for c, r, g in EYES[:2]:
        inward = Vector((-math.copysign(1, c.x), 0, 0))
        with S.piece(bm, name="brow", part=P_BODY, bake={SKIN: "skin"}, zone=(1, 0, 0), wgt=body_weight):
            ml.lid_and_brow(bm, c, r, Vector((0, 1, 0)) + inward * 0.55 + Vector((0, 0, 0.22)), g, inward, SKIN,
                            cover=10, brow=(0.045, 0.09), **res)
    c, r, g = EYES[2]
    with S.piece(bm, name="brow", part=P_BODY, bake={SKIN: "skin"}, zone=(1, 0, 0), wgt=body_weight):
        ml.lid_and_brow(bm, c, r, Vector((0, 1, 0.12)), g, None, SKIN, cover=24, dip=0.07, brow=(0.04, 0.08),
                        v_shape=True, **res)
    S.done("Alien_Brows", bm)

    # the body's crown split into the fur base needs the top eye: now
    tc, tr, _ = EYES[2]

    def crown_fur(p, n, tc=tc, tr=tr):
        """The blockout's crown rule: above the ragged hem, clear of the top
        eye's parting and the face eyes' brows."""
        hem = 1.06 - 0.36 * max(-n.z, 0.0) + 0.04 * math.sin(7 * math.atan2(p.x, p.z))
        if p.y < hem or (p - tc).length < tr + 0.06:
            return False
        return not any((p - c).length < r + 0.12 for c, r, _ in EYES[:2])

    meta["crown_fur"] = crown_fur
    if isinstance(S, LowSink):
        body_after(S.bm, *S.pieces[[i for i, (_, inf) in enumerate(S.pieces) if inf is body_info][0]])

    # tentacles: two raised up into the dome (tips curled), two resting on the rim
    DRIPS = []

    def tentacle(name, ctrl, r0, r1, fur_back):
        """The bare tentacle, and its fur: clumps down the back (the side facing
        `fur_back(point)`), leaving the underside bare."""
        rad = lambda t: r0 + (r1 - r0) * t ** 0.8  # noqa: E731
        C = ml.catmull([Vector(p) for p in ctrl], 8)          # the layout centreline (v3's, per_seg 8)
        s = [0.0]
        for i in range(1, len(C)):
            s.append(s[-1] + (C[i] - C[i - 1]).length)
        T = [x / s[-1] for x in s]
        bm = S.obj(name)
        ring, per, cap = R["tube"]

        def tube_after(bm, span, info):
            """Its back faces become the fur base; fur length per vertex."""
            F, V = bm.faces.layers.int, bm.verts.layers.float
            bm.normal_update()
            for f in span.faces():
                cf = f.calc_center_median()
                t = nearest_t(C, T, cf)
                i = min(range(len(C)), key=lambda j: (C[j] - cf).length_squared)
                tan = (C[min(i + 1, len(C) - 1)] - C[max(i - 1, 0)]).normalized()
                back = ml.perp(fur_back(C[i]), tan).normalized()
                dirn = ml.perp(cf - C[i], tan).normalized()
                if 0.10 <= t <= 0.90 and dirn.dot(back) > math.cos(math.radians(88)):
                    f[F["prim"]] = 2
            for v in span.verts():
                t = nearest_t(C, T, v.co)
                i = min(range(len(C)), key=lambda j: (C[j] - v.co).length_squared)
                tan = (C[min(i + 1, len(C) - 1)] - C[max(i - 1, 0)]).normalized()
                back = ml.perp(fur_back(C[i]), tan).normalized()
                dirn = ml.perp(v.co - C[i], tan).normalized()
                edge = smoothstep(math.cos(math.radians(95)), math.cos(math.radians(55)), dirn.dot(back))
                taper = smoothstep(0.08, 0.2, t) * (1 - smoothstep(0.8, 0.92, t))
                # a short undercoat: the arms' look is their locks (round 1)
                v[V["flen"]] = 0.06 * (1.15 - 0.45 * t) * edge * taper
                v[V["wet"]] = 0.35 + 0.5 * t

        with S.piece(bm, name=name, part=P_TENT, bake={SKIN: "skin"}, zone=(1, 0, 0), wgt="C", C=C,
                     after=tube_after) as info:
            sp = Span(bm)
            ml.sweep(bm, ctrl, rad, ring=ring, per_seg=per, mi=SKIN, cap=cap)
            fit(name, sp.verts())
        S.done(name, bm)
        # pink spots: wet recessed cups down the underside (the final stage's)
        if final:
            spots_on(name, C, T, rad, fur_back)
        fb = S.obj(name.replace("Alien_", "Alien_Fur_"))
        tips = []
        row = 0
        sp = Span(fb)
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
                base, length, radius = C[i] + nrm * r * 0.8, rng.uniform(0.15, 0.22) * (1.15 - 0.45 * t), \
                    r * rng.uniform(0.5, 0.62)
                flow = ml.G + tan * 0.3
                if S.final and not hi:
                    spine = tuft_spine(base, nrm, length, radius, flow)
                    meta["cards"].append(dict(spine=spine, n=nrm, radius=radius, part=P_TENT, wgt=t,
                                              wet=0.35 + 0.5 * t, zone=name))
                    tips.append((spine[-1], t))
                else:
                    tips.append((ml.tuft(fb, base, nrm, length, radius, flow), t))
            row += 1
        if not (S.final and not hi):
            fit(name + " fur", sp.verts())
            S.done(name.replace("Alien_", "Alien_Fur_"), fb)
        tip, t_tip = min(tips, key=lambda q: q[0].y)
        DRIPS.append((tip, P_DRIP_T, t_tip))

    def spots_on(name, C, T, rad, fur_back):
        """4-6 recessed pink cups along the bare underside (seeded, rx)."""
        n_spots = 6 if "Tentacle" in name else 4
        for j in range(n_spots):
            t = 0.16 + (0.70 if "Tentacle" in name else 0.62) * (j + rx.uniform(0.15, 0.85)) / n_spots
            i = min(range(len(T)), key=lambda q: abs(T[q] - t))
            tan = (C[min(i + 1, len(C) - 1)] - C[max(i - 1, 0)]).normalized()
            back = ml.perp(fur_back(C[i]), tan).normalized()
            side = tan.cross(back)
            # on the bare underside, turned toward the front where it can (the
            # raised arms' undersides face the head, the resting arms' the rim)
            cands_ = [math.radians(180 + d + rx.uniform(-12, 12)) for d in (-78, -40, 0, 40, 78)]
            nrms = [(back * math.cos(a) + side * math.sin(a)).normalized() for a in cands_]
            nrm = max(nrms, key=lambda q: q.z + 0.35 * q.y + rx.uniform(0, 0.25))
            r = rad(T[i])
            rho = r * rx.uniform(0.32, 0.46)
            meta["spots"].append(dict(c=C[i] + nrm * r, n=nrm, tan=tan, rho=rho, t=T[i], C=C, T=T, r=r,
                                      tube=name))

    def outward(p):
        return Vector((p.x, 0.35, p.z * 0.3))

    def upward(p):
        return Vector((0, 1, 0))

    tentacle("Alien_TentacleL", [(0.42, 0.55, 0.0), (0.68, 0.74, 0.08), (0.78, 1.03, 0.12), (0.65, 1.33, 0.10),
                                 (0.50, 1.55, 0.05), (0.38, 1.61, 0.03), (0.33, 1.50, 0.07)], 0.17, 0.055, outward)
    tentacle("Alien_TentacleR", [(-0.42, 0.55, 0.0), (-0.66, 0.80, 0.12), (-0.70, 1.13, 0.16), (-0.58, 1.43, 0.13),
                                 (-0.42, 1.59, 0.10), (-0.26, 1.62, 0.12), (-0.21, 1.53, 0.18)], 0.17, 0.055,
             outward)
    for side, name in ((1, "Alien_ArmL"), (-1, "Alien_ArmR")):
        tentacle(name, [(0.45 * side, 0.12, 0.10), (0.66 * side, 0.22, 0.36), (0.82 * side, 0.34, 0.60),
                        (0.83 * side, 0.37, 0.72), (0.80 * side, 0.31, 0.80)], 0.12, 0.06, upward)

    # the shaggy crown: wet clumps over the whole top and front of the head down
    # to the brow line, locks falling a little forward in front and back behind,
    # a ragged hem hanging lower at the back; the fur parts round the top eye
    # (no roots near it, and the nearest clumps lean away from it); the face
    # below the brows stays bare
    cands = [(p, n) for p, n in BODY_PTS if crown_fur(p, n)]
    tips = []
    crown = S.obj("Alien_Fur_Crown")
    sp = Span(crown)
    for p, n in ml.scatter(cands, 0.06, rng):
        fwd = max(n.z, 0.0)
        away = ml.perp(p - tc, n)
        near = math.exp(-(((p - tc).length - tr) / 0.12) ** 2)        # the parting round the top eye
        flow = ml.G + Vector((0, 0, 0.35 * fwd - 0.45 * (1 - fwd))) + away.normalized() * 1.6 * near
        length = rng.uniform(0.2, 0.3) * (1 - 0.35 * fwd)              # shorter over the brows
        radius = rng.uniform(0.065, 0.085)
        if S.final and not hi:
            spine = tuft_spine(p, n, length, radius, flow)
            hem = 1.06 - 0.36 * max(-n.z, 0.0) + 0.04 * math.sin(7 * math.atan2(p.x, p.z))
            meta["cards"].append(dict(spine=spine, n=n, radius=radius, part=P_BODY, wgt=body_weight(p),
                                      wet=0.2 + 0.6 * (1 - smoothstep(0.0, 0.22, p.y - hem)), zone="crown",
                                      hem_d=p.y - hem))
            tips.append((spine[-1], 0.0))
        else:
            tips.append((ml.tuft(crown, p, n, length, radius, flow), 0.0))
    if not (S.final and not hi):
        fit("Alien_Fur_Crown", sp.verts())
        S.done("Alien_Fur_Crown", crown)
    crown_drips = [q[0] for q in sorted(tips, key=lambda q: q[0].y)[:3:2]]
    DRIPS += [(p, P_DRIP_B, body_weight(p)) for p in crown_drips]
    meta["drip_tips"] = [p for p, _, _ in DRIPS]       # their clumps become cards, so no drip floats

    # drips off the fur's lowest clumps
    bm = S.obj("Alien_Drips")
    ring, per, cap = R["drip"]
    sp = Span(bm)
    for p, host, hw in DRIPS:
        top = p - Vector((0, 0.01, 0))
        length = rng.uniform(0.12, 0.2)
        with S.piece(bm, name="drip", part=host if final else P_DRIP, hostw=hw, bake={SLIME: "slime"}, share="drip",
                     wgt="C",
                     C=[top + ml.G * length * k for k in (0.0, 0.5, 1.0)]):
            ml.drip(bm, top, length, 0.022, SLIME, ring=ring, per_seg=per, cap=cap)
    fit("Alien_Drips", sp.verts())
    S.done("Alien_Drips", bm)

    # slime smeared over the saucer's lip and down its side, between portholes
    bm = S.obj("Saucer_Slime")
    meta["smears"] = []
    for k in (1, 5, 6, 9, 12, 14):
        a = 2 * math.pi * (k + 0.5) / N_PORTHOLES
        out = Vector((math.sin(a), 0, math.cos(a)))
        y_end = rng.uniform(-0.34, -0.06)
        pts = [out * 1.36 + Vector((0, 0.285, 0)), out * 1.50 + Vector((0, 0.25, 0)),
               out * 1.565 + Vector((0, 0.19, 0)), out * 1.50 + Vector((0, 0.135, 0))]
        for y in [0.09, 0.0, -0.1, -0.2, -0.3]:
            if y > y_end:
                pts.append(out * (profile_at(OUTER, y)[0] + 0.012) + Vector((0, y, 0)))
        pts.append(out * (profile_at(OUTER, y_end)[0] + 0.012) + Vector((0, y_end, 0)))
        ring, per, cap = R["smear"]
        if not final:      # (the final stage paints the smears into the hull's and rim's maps)
            with S.piece(bm, name="smear", part=P_HULL, bake={SLIME: "slime"}):
                ml.strand(bm, pts, 0.05, 0.034, SLIME, ring=ring, per_seg=per, cap=cap)
        length = rng.uniform(0.08, 0.2)
        ring, per, cap = R["drip"]
        top = pts[-1] - out * 0.009 if final else pts[-1]     # (on the wall: the final's smear is painted)
        with S.piece(bm, name="drip", part=P_DRIP, bake={SLIME: "slime"}, share="drip", wgt="C",
                     C=[top + ml.G * length * k for k in (0.0, 0.5, 1.0)]):
            ml.drip(bm, top, length, 0.03, SLIME, ring=ring, per_seg=per, cap=cap)
        meta["smears"].append((a, y_end, length))
    S.done("Saucer_Slime", bm)

    top_r = top_c + Vector((0, 0.2, 0))
    meta["worst"].append(("Alien_EyeTop", in_dome(top_r)))
    return meta


# ================================================================ blockout ===
def check_dome(worst):
    for name, w in worst:
        print("DOME_FIT %-22s %.3f (< 1 is inside the glass)" % (name, w))
        if w >= 1:
            raise SystemExit(f"{name} pokes through the dome")


if STAGE == "blockout":
    ml.reset_scene()
    rt = ml.root("Saucer")
    meta = build(BLOCK, BlockSink(rt))
    check_dome(meta["worst"])
    ml.finish(rt, OUT_DIR, "saucer", EXTENT)
    sys.exit(0)

# ============================================================ final stage ===
# ---- the look: one recipe per bake material (linear RGB; metals carry F0) --
SEAM_RING_Y = (0.075, -0.30, -0.62)        # the hull's circumferential panel seams
SEAM_PANELS, SEAM_OFF = 8, 11.25           # radial seams every 45 deg, clear of the portholes
RIVET_PITCH, RIVET_R = 0.08, 0.0095        # chunky cartoon rivets: ~3 texels across at the hull's density
SMEARS = []                                # (angle, y_end, drip length) of the rim slime, from the layout


def polar(N):
    """(x, y, z, r, theta) of the glTF position; theta from +Z toward +X."""
    x, y, z = N.xyz(N.gp())
    r = N.m("SQRT", N.add(N.mul(x, x), N.mul(z, z)))
    return x, y, z, r, N.m("ARCTAN2", x, z)


def wrap(N, a):
    """An angle wrapped into [-pi, pi]."""
    return N.sub(a, N.mul(N.m("ROUND", N.m("DIVIDE", a, TAU)), TAU))


def lines(N, co, angle_axis, scale, width, density, w):
    """Sparse thin straight scratches: a noise stretched along one direction,
    kept where it crosses 0.5 (a thin band), masked by a coarse noise."""
    rot = N.new("ShaderNodeVectorRotate")
    rot.rotation_type = "EULER_XYZ"
    N._in(rot.inputs["Vector"], co)
    rot.inputs["Rotation"].default_value = angle_axis
    st = N.v("MULTIPLY", rot.outputs[0], (scale, scale, scale * 45.0))
    band = N.mapr(N.m("ABSOLUTE", N.sub(N.noise(st, 1.0, 2.0, 0.5, w=w), 0.5)), width, 0.0)
    mask = N.mapr(N.noise(co, 2.5, 2.0, 0.5, w=w + 3), density, density + 0.08)
    return N.mul(band, mask)


def scratches(N, co, w=40.0):
    s = lines(N, co, (0.3, 1.1, 0.2), 7.0, 0.006, 0.52, w)
    s = N.m("MAXIMUM", s, lines(N, co, (1.2, 0.2, 2.1), 9.0, 0.005, 0.55, w + 7))
    return N.m("MAXIMUM", s, lines(N, co, (2.4, 1.7, 0.9), 5.0, 0.007, 0.58, w + 13))


def smear_fields(N, th, r, y, on_rim):
    """The rim slime, painted (round 1: it was geometry): a wavy lime streak
    over the lip and down the wall to each smear's end, raised a little,
    with a wetter rim at its edge. Returns (mask, edge)."""
    mask = None
    for k, (a_k, y_end, drip) in enumerate(SMEARS):
        dk = N.m("ABSOLUTE", N.mul(wrap(N, N.sub(th, a_k)), r))
        wav = N.noise(N.vec(y, r, k * 2.3), 7.0, 3.0, 0.55, w=171.0)
        width = N.add(0.028, N.mul(wav, 0.03))
        across = N.mapr(N.m("DIVIDE", dk, width), 1.0, 0.75, 0.0, 1.0, smooth=True)
        if on_rim:
            along = N.mapr(r, 1.33, 1.37, 0.0, 1.0, smooth=True)
        else:
            along = N.mul(N.mapr(y, y_end - 0.005, y_end + 0.03, 0.0, 1.0, smooth=True), N.mapr(y, 0.2, 0.16))
        sk = N.mul(across, along)
        mask = sk if mask is None else N.m("MAXIMUM", mask, sk)
    edge = N.mul(N.mapr(mask, 0.0, 0.5), N.mapr(mask, 1.0, 0.5))
    return mask, edge


def slime_paint(N, alb, rough, metal, height, mask, edge):
    """Lay the painted slime over a surface's albedo, roughness, metal and height."""
    gp = N.gp()
    n = N.noise(gp, 14.0, 3.0, 0.5, w=172.0)
    col = N.mix(n, (0.22, 0.55, 0.03), (0.42, 0.74, 0.09))
    alb = N.mix(mask, alb, col)
    alb = N.mix(N.mul(edge, 0.5), alb, (0.10, 0.25, 0.02))
    return (alb, N.mixf(mask, rough, 0.03), N.mixf(mask, metal, 0.0),
            N.add(height, N.mul(mask, 0.0022), N.mul(n, N.mul(mask, 0.0006))))


def hull_recipe(N):
    x, y, z, r, th = polar(N)
    gp = N.gp()
    # brushed: a concentric lathe grain (constant round the axis, fine across it)
    gco = N.vec(N.mul(r, 1.0), y, N.mul(th, 0.015))
    grain = N.noise(gco, 380.0, 2.0, 0.6, w=1.0)
    grain2 = N.noise(gco, 70.0, 3.0, 0.5, w=2.0)
    mott = N.noise(gp, 3.0, 3.0, 0.5, w=3.0)
    # panel seams: 8 radial (11.25 deg off the portholes), 3 rings, a circle round the mount
    pan = TAU / SEAM_PANELS
    u = N.sub(N.m("DIVIDE", th, pan), SEAM_OFF / 45.0)
    d_rad = N.mul(N.m("ABSOLUTE", N.sub(u, N.m("ROUND", u))), pan, r)
    d_rad = N.add(d_rad, N.mul(N.mapr(y, -0.66, -0.72), 1.0))          # radial seams stop at the bottom
    ds = [N.m("ABSOLUTE", N.sub(y, yk)) for yk in SEAM_RING_Y]
    d_ring = ds[0]
    for d in ds[1:]:
        d_ring = N.m("MINIMUM", d_ring, d)
    d_circ = N.add(N.m("ABSOLUTE", N.sub(r, 0.47)), N.mapr(y, -0.70, -0.64))
    seam_d = N.m("MINIMUM", N.m("MINIMUM", d_rad, d_ring), d_circ)
    groove = N.mapr(seam_d, 0.0045, 0.0015)
    grime = N.mul(N.mapr(seam_d, 0.038, 0.004, 0.0, 1.0, smooth=True),
                  N.mapr(N.noise(gp, 16.0, 4.0, 0.6, w=4.0), 0.30, 0.65))
    grime = N.m("MAXIMUM", grime, N.mul(N.mapr(y, -0.55, -0.80), N.mapr(N.noise(gp, 9.0, 4.0, 0.6, w=5.0), 0.4, 0.7),
                                        0.7))
    # rivets: a row above each ring seam (pitch 0.055 round), one beside each radial seam
    riv = None
    for yk in SEAM_RING_Y[:2]:
        a = N.m("DIVIDE", N.mul(th, r), RIVET_PITCH)
        da = N.mul(N.m("ABSOLUTE", N.sub(a, N.m("ROUND", a))), RIVET_PITCH)
        dy = N.sub(y, yk + 0.026)
        d = N.m("SQRT", N.add(N.mul(da, da), N.mul(dy, dy)))
        riv = d if riv is None else N.m("MINIMUM", riv, d)
    a = N.m("DIVIDE", y, RIVET_PITCH)
    dy = N.mul(N.m("ABSOLUTE", N.sub(a, N.m("ROUND", a))), RIVET_PITCH)
    dt = N.sub(d_rad, 0.026)
    d = N.add(N.m("SQRT", N.add(N.mul(dy, dy), N.mul(dt, dt))), N.mapr(y, 0.05, 0.09, 0.0, 1.0))
    riv = N.m("MINIMUM", riv, d)
    rivet = N.mapr(riv, RIVET_R, RIVET_R * 0.55, 0.0, 1.0, smooth=True)
    rim_ring = N.mapr(riv, RIVET_R * 1.3, RIVET_R)
    rim_ring = N.mul(rim_ring, N.sub(1.0, rivet))
    sc = scratches(N, gp)
    # soot round each porthole, wet green stains run down below each rim smear
    pa = TAU / N_PORTHOLES
    dth = N.mul(wrap(N, N.sub(th, N.mul(N.m("ROUND", N.m("DIVIDE", th, pa)), pa))), r)
    dpy = N.sub(y, PORTHOLE_Y)
    soot = N.mul(N.mapr(N.m("SQRT", N.add(N.mul(dth, dth), N.mul(dpy, dpy))), 0.17, 0.085, 0.0, 1.0, smooth=True),
                 N.mapr(N.noise(gp, 12.0, 3.0, 0.6, w=6.0), 0.25, 0.7))
    stain = None
    for k, (a_k, y_end, drip) in enumerate(SMEARS):
        dk = N.m("ABSOLUTE", N.mul(wrap(N, N.sub(th, a_k)), r))
        width = N.add(0.03, N.mul(N.noise(N.vec(y, 0.0, k * 3.1), 6.0, 2.0, 0.5, w=7.0), 0.04))
        across = N.mapr(N.m("DIVIDE", dk, width), 1.0, 0.0, 0.0, 1.0, smooth=True)
        along = N.mul(N.mapr(y, y_end - drip - 0.22, y_end - drip, 0.0, 1.0, smooth=True), N.mapr(y, 0.16, 0.10))
        sk = N.mul(across, along)
        stain = sk if stain is None else N.m("MAXIMUM", stain, sk)
    stain_edge = N.mul(N.mapr(stain, 0.05, 0.35), N.mapr(stain, 0.75, 0.35))
    base = N.scale((0.30, 0.31, 0.335), N.add(0.84, N.mul(grain, 0.2), N.mul(grain2, 0.1), N.mul(mott, 0.06)))
    alb = N.mix(N.mul(sc, 0.75), base, (0.56, 0.57, 0.59))
    alb = N.mix(rim_ring, alb, (0.10, 0.10, 0.105))
    alb = N.mix(rivet, alb, (0.44, 0.45, 0.47))
    alb = N.mix(N.mul(grime, 0.85), alb, (0.045, 0.040, 0.032))
    alb = N.mix(groove, alb, (0.02, 0.02, 0.02))
    alb = N.mix(N.mul(soot, 0.6), alb, (0.06, 0.045, 0.032))
    alb = N.mix(N.mul(stain, 0.85), alb, (0.06, 0.11, 0.022))
    alb = N.mix(N.mul(stain_edge, 0.5), alb, (0.03, 0.05, 0.012))
    metal = N.sub(0.95, N.add(N.mul(grime, 0.55), N.mul(stain, 0.6), N.mul(soot, 0.4), N.mul(groove, 0.5)))
    rough = N.add(0.27, N.mul(grain2, 0.12), N.mul(grain, 0.06), N.mul(grime, 0.38), N.mul(soot, 0.2),
                  N.mul(sc, -0.1))
    rough = N.mixf(stain, rough, 0.10)
    mask, edge = smear_fields(N, th, r, y, False)
    # (the lathe grain is albedo and roughness only: in the normal map it is
    # sub-texel noise that aliases and costs the WebP its bytes)
    height = N.add(N.mul(groove, -0.0016), N.mul(N.m("SQRT", rivet), 0.0026), N.mul(grain2, 0.00008),
                   N.mul(sc, -0.00025), N.mul(stain, 0.0004))
    alb, rough, metal, height = slime_paint(N, alb, rough, metal, height, mask, edge)
    return dict(albedo=alb, rough=rough, metal=metal, height=height)


def hull_in_recipe(N):
    x, y, z, r, th = polar(N)
    gp = N.gp()
    n = N.noise(gp, 8.0, 4.0, 0.6, w=11.0)
    puddle = N.mul(N.mapr(y, -0.26, -0.36), N.mapr(N.noise(gp, 4.0, 3.0, 0.5, w=12.0), 0.35, 0.55))
    alb = N.scale((0.11, 0.11, 0.12), N.add(0.7, N.mul(n, 0.5)))
    alb = N.mix(puddle, alb, (0.07, 0.17, 0.02))
    return dict(albedo=alb, rough=N.mixf(puddle, N.add(0.5, N.mul(n, 0.2)), 0.08),
                metal=N.mixf(puddle, 0.6, 0.0), height=N.mul(n, 0.0006))


def band_recipe(N):
    x, y, z, r, th = polar(N)
    gp = N.gp()
    edge = N.bevel_edge(0.008)
    wear = N.mapr(N.add(edge, N.mul(N.sub(N.noise(gp, 38.0, 6.0, 0.7, w=21.0), 0.5), 2.4)), 0.96, 1.05)
    scuff = N.mapr(N.noise(gp, 110.0, 3.0, 0.6, w=22.0), 0.70, 0.735, 0.0, 0.8)
    chip = N.m("MAXIMUM", wear, scuff)
    mott = N.noise(gp, 10.0, 4.0, 0.6, w=23.0)
    paint = N.scale((0.70, 0.70, 0.69), N.add(0.92, N.mul(mott, 0.12)))
    # a ring of 12 bold stencilled dashes on the lip's outer face, long and
    # short, clean-edged (round 1: the small noisy ones smeared at a distance)
    seg = N.m("FRACT", N.m("DIVIDE", th, TAU / 12))
    long_ = N.mul(N.mapr(seg, 0.10, 0.115), N.mapr(seg, 0.56, 0.545))
    short = N.mul(N.mapr(seg, 0.66, 0.675), N.mapr(seg, 0.84, 0.825))
    band_y = N.mul(N.mapr(y, 0.186, 0.192), N.mapr(y, 0.232, 0.226), N.mapr(r, 1.50, 1.515))
    stencil = N.mul(N.m("MAXIMUM", long_, short), band_y)
    grime = N.mul(N.add(N.mapr(y, 0.17, 0.152), N.mapr(r, 1.10, 1.03)),
                  N.mapr(N.noise(gp, 14.0, 4.0, 0.6, w=25.0), 0.3, 0.7))
    alb = N.mix(stencil, paint, (0.035, 0.035, 0.038))
    alb = N.mix(N.mul(grime, 0.7), alb, (0.20, 0.19, 0.17))
    alb = N.mix(chip, alb, (0.12, 0.12, 0.12))
    rough = N.add(0.36, N.mul(mott, 0.1), N.mul(chip, 0.26), N.mul(grime, 0.2))
    mask, edge = smear_fields(N, th, r, y, True)
    alb, rough, metal, height = slime_paint(N, alb, rough, N.val(0.0), N.add(N.mul(chip, -0.0008),
                                            N.mul(stencil, 0.00012)), mask, edge)
    return dict(albedo=alb, rough=rough, metal=metal, height=height)


def frame_recipe(N):
    lx, ly, lz = N.xyz(N.lc())
    rr = N.m("SQRT", N.add(N.mul(lx, lx), N.mul(lz, lz)))
    ang = N.m("ARCTAN2", lx, lz)
    a6 = N.m("DIVIDE", ang, TAU / 6)
    da = N.mul(N.m("ABSOLUTE", N.sub(a6, N.m("ROUND", a6))), TAU / 6, rr)
    dr = N.sub(rr, 0.067)
    d = N.m("SQRT", N.add(N.mul(da, da), N.mul(dr, dr)))
    bolt = N.mapr(d, 0.0058, 0.0036, 0.0, 1.0, smooth=True)
    ring = N.mul(N.mapr(d, 0.0075, 0.0058), N.sub(1.0, bolt))
    grain = N.noise(N.vec(N.mul(rr, 1.0), ang, ly), 500.0, 2.0, 0.6, w=31.0)
    grime = N.m("MAXIMUM", N.mapr(rr, 0.054, 0.048), N.mapr(rr, 0.077, 0.084))
    alb = N.scale((0.42, 0.43, 0.45), N.add(0.82, N.mul(grain, 0.25)))
    alb = N.mix(grime, alb, (0.05, 0.045, 0.04))
    alb = N.mix(ring, alb, (0.06, 0.06, 0.065))
    alb = N.mix(bolt, alb, (0.56, 0.56, 0.58))
    return dict(albedo=alb, rough=N.add(0.26, N.mul(grain, 0.1), N.mul(grime, 0.35)),
                metal=N.sub(0.92, N.mul(grime, 0.5)), height=N.add(N.mul(N.m("SQRT", bolt), 0.0016),
                                                                    N.mul(ring, -0.0004)))


def lens_recipe(N):
    lx, ly, lz = N.xyz(N.lc())
    s = N.m("DIVIDE", N.m("SQRT", N.add(N.mul(lx, lx), N.mul(lz, lz))), 0.052)
    hexes = N.vor(N.vec(lx, lz, 0.0), 260.0, "DISTANCE_TO_EDGE", 0.0, "2D")
    hexline = N.mapr(hexes.outputs["Distance"], 0.06, 0.0)
    fleck = N.mapr(N.noise(N.lc(), 500.0, 2.0, 0.5, w=41.0), 0.70, 0.76)
    core = N.sub(1.0, N.mul(s, s))
    glow = N.scale((1.0, 0.50, 0.12), N.mul(N.add(0.42, N.mul(core, 0.58)), N.sub(1.0, N.mul(hexline, 0.22))))
    glow = N.mix(N.mul(fleck, 0.5), glow, (1.0, 0.85, 0.5))
    alb = N.mix(N.mul(core, 0.5), (0.06, 0.025, 0.006), (0.16, 0.075, 0.016))
    return dict(albedo=alb, rough=N.add(0.035, N.mul(hexline, 0.05)), metal=0.0,
                height=N.mul(hexline, -0.00025), emit=glow)


def spike_recipe(N):
    t = N.ft()
    lx, ly, lz = N.xyz(N.lc())
    streak = N.noise(N.vec(N.mul(lx, 160.0), N.mul(ly, 6.0), N.mul(lz, 160.0)), 1.0, 3.0, 0.5, w=51.0)
    sc = scratches(N, N.gp(), 52.0)
    heat = N.mapr(t, 0.55, 0.95, 0.0, 1.0, smooth=True)
    tipc = N.mapr(t, 0.93, 0.985)
    grooves = N.m("MAXIMUM", N.mapr(N.m("ABSOLUTE", N.sub(t, 0.20)), 0.008, 0.003),
                  N.mapr(N.m("ABSOLUTE", N.sub(t, 0.26)), 0.008, 0.003))
    grime = N.mul(N.mapr(t, 0.3, 0.14), N.mapr(N.noise(N.gp(), 20.0, 3.0, 0.6, w=53.0), 0.3, 0.6))
    alb = N.scale((0.25, 0.255, 0.27), N.add(0.82, N.mul(streak, 0.28)))
    alb = N.mix(heat, alb, (0.13, 0.14, 0.21))
    alb = N.mix(tipc, alb, (0.52, 0.52, 0.54))
    alb = N.mix(N.mul(sc, 0.7), alb, (0.55, 0.55, 0.57))
    alb = N.mix(grime, alb, (0.05, 0.045, 0.035))
    alb = N.mix(grooves, alb, (0.03, 0.03, 0.03))
    return dict(albedo=alb, rough=N.add(0.34, N.mul(streak, 0.1), N.mul(heat, -0.1), N.mul(tipc, -0.12),
                                         N.mul(grime, 0.3)),
                metal=N.sub(0.92, N.mul(grime, 0.5)), height=N.add(N.mul(grooves, -0.0014), N.mul(sc, -0.0002)))


def turret_recipe(N):
    lx, ly, lz = N.xyz(N.lc())
    ang = N.m("ARCTAN2", lx, lz)
    rr = N.m("SQRT", N.add(N.mul(lx, lx), N.mul(lz, lz)))
    a4 = N.m("DIVIDE", N.sub(ang, math.pi / 4), TAU / 4)
    d_seam = N.mul(N.m("ABSOLUTE", N.sub(a4, N.m("ROUND", a4))), TAU / 4, rr)
    groove = N.mapr(d_seam, 0.004, 0.0015)
    a = N.m("DIVIDE", N.mul(ang, rr), 0.04)
    da = N.mul(N.m("ABSOLUTE", N.sub(a, N.m("ROUND", a))), 0.04)
    dy = N.sub(ly, 0.098)
    rivet = N.mapr(N.m("SQRT", N.add(N.mul(da, da), N.mul(dy, dy))), 0.0045, 0.0028, 0.0, 1.0, smooth=True)
    grain = N.noise(N.vec(rr, ly, N.mul(ang, 0.02)), 300.0, 2.0, 0.6, w=61.0)
    grime = N.mul(N.mapr(d_seam, 0.03, 0.004), N.mapr(N.noise(N.gp(), 18.0, 3.0, 0.6, w=62.0), 0.3, 0.65))
    sc = scratches(N, N.gp(), 63.0)
    alb = N.scale((0.20, 0.205, 0.225), N.add(0.84, N.mul(grain, 0.22)))
    alb = N.mix(N.mul(sc, 0.6), alb, (0.5, 0.5, 0.52))
    alb = N.mix(grime, alb, (0.04, 0.036, 0.03))
    alb = N.mix(groove, alb, (0.02, 0.02, 0.02))
    alb = N.mix(rivet, alb, (0.40, 0.41, 0.43))
    return dict(albedo=alb, rough=N.add(0.32, N.mul(grain, 0.1), N.mul(grime, 0.35)), metal=N.sub(0.92, N.mul(grime, 0.5)),
                height=N.add(N.mul(groove, -0.0014), N.mul(N.m("SQRT", rivet), 0.0012)))


def barrel_recipe(N):
    t = N.ft()
    lx, ly, lz = N.xyz(N.lc())
    ang = N.m("ARCTAN2", lx, lz)
    grooves = None
    for tk in (0.36, 0.50, 0.64):
        g = N.mapr(N.m("ABSOLUTE", N.sub(t, tk)), 0.016, 0.006)
        grooves = g if grooves is None else N.m("MAXIMUM", grooves, g)
    heat = N.mapr(t, 0.70, 0.95, 0.0, 1.0, smooth=True)
    tint = N.mix(N.noise(N.vec(ang, N.mul(t, 4.0), 0.0), 3.0, 2.0, 0.5, w=71.0), (0.26, 0.20, 0.11), (0.12, 0.13, 0.21))
    soot = N.mul(N.mapr(t, 0.86, 0.99), N.mapr(N.noise(N.gp(), 30.0, 3.0, 0.6, w=72.0), 0.2, 0.6))
    grain = N.noise(N.vec(N.mul(ang, 0.02), N.mul(t, 1.0), 0.0), 220.0, 2.0, 0.6, w=73.0)
    alb = N.scale((0.17, 0.17, 0.18), N.add(0.85, N.mul(grain, 0.2)))
    alb = N.mix(N.mul(heat, 0.7), alb, tint)
    alb = N.mix(grooves, alb, (0.025, 0.025, 0.025))
    alb = N.mix(soot, alb, (0.02, 0.017, 0.014))
    return dict(albedo=alb, rough=N.add(0.3, N.mul(soot, 0.5), N.mul(grooves, 0.2)), metal=N.sub(0.9, N.mul(soot, 0.7)),
                height=N.mul(grooves, -0.0018))


def skin_fields(N):
    gp = N.gp()
    big = N.noise(gp, 2.2, 3.0, 0.5, w=101.0)
    mott = N.noise(gp, 7.0, 4.0, 0.55, w=102.0)
    fine = N.noise(gp, 30.0, 3.0, 0.5, w=103.0)
    wco = N.v("MULTIPLY", gp, (1.0, 2.6, 1.0))
    wr = N.noise(wco, 13.0, 5.0, 0.6, 0.5, w=104.0)
    wrinkle = N.m("POWER", N.mapr(N.m("ABSOLUTE", N.sub(wr, 0.5)), 0.08, 0.0), 2.0)
    sp = N.vor(gp, 34.0, "F1")
    speck = N.mul(N.mapr(sp.outputs["Distance"], 0.16, 0.08), N.mapr(N.chan(sp.outputs["Color"], 0), 0.55, 0.62))
    lp = N.vor(N.v("ADD", gp, (3.1, 1.7, 0.4)), 21.0, "F1")
    fleck = N.mul(N.mapr(lp.outputs["Distance"], 0.12, 0.05), N.mapr(N.chan(lp.outputs["Color"], 1), 0.80, 0.86))
    pr = N.vor(N.v("ADD", gp, (7.3, 0.2, 5.1)), 62.0, "F1")
    pore = N.mapr(pr.outputs["Distance"], 0.24, 0.10, 0.0, 1.0, smooth=True)
    wet = N.mapr(N.noise(gp, 4.0, 3.0, 0.5, w=105.0), 0.46, 0.62, 0.0, 1.0, smooth=True)
    under = N.mapr(N.xyz(N.world_normal())[2], 0.15, -0.75)
    return dict(big=big, mott=mott, fine=fine, wrinkle=wrinkle, speck=speck, fleck=fleck, pore=pore, wet=wet,
                under=under)


def skin_recipe(N):
    f = skin_fields(N)
    base = N.mix(f["mott"], (0.062, 0.25, 0.026), (0.15, 0.45, 0.040))
    base = N.mix(N.mul(N.mapr(f["big"], 0.45, 0.8, 0.0, 1.0, smooth=True), 0.3), base, (0.05, 0.18, 0.032))
    base = N.mix(N.mul(f["under"], 0.55), base, (0.25, 0.52, 0.095))
    base = N.mix(N.mul(f["fleck"], 0.55), base, (0.34, 0.60, 0.20))
    base = N.mix(N.mul(f["speck"], 0.9), base, (0.022, 0.07, 0.018))
    base = N.scale(base, N.sub(1.0, N.add(N.mul(f["pore"], 0.32), N.mul(f["wrinkle"], 0.18), N.mul(f["wet"], 0.08))))
    rough = N.add(0.26, N.mul(f["wet"], -0.17), N.mul(f["pore"], 0.12), N.mul(f["fine"], 0.06),
                  N.mul(f["wrinkle"], 0.06))
    height = N.add(N.mul(f["pore"], -0.0011), N.mul(f["wrinkle"], -0.0010), N.mul(f["fine"], 0.0010),
                   N.mul(f["mott"], 0.0025), N.mul(f["speck"], 0.0003))
    return dict(albedo=base, rough=rough, metal=0.0, height=height)


def spot_recipe(N):
    lx, ly, lz = N.xyz(N.lc())
    s = N.m("SQRT", N.add(N.mul(lx, lx), N.mul(lz, lz)))
    gp = N.gp()
    deep = N.mapr(s, 0.75, 0.0, 0.0, 1.0, smooth=True)
    rim = N.m("EXPONENT", N.mul(-1.0, N.m("POWER", N.m("DIVIDE", N.sub(s, 0.93), 0.085), 2.0)))
    pv = N.vor(gp, 150.0, "F1")
    pits = N.mul(N.mapr(pv.outputs["Distance"], 0.30, 0.12), N.mapr(s, 0.82, 0.7))
    mott = N.noise(gp, 40.0, 3.0, 0.5, w=111.0)
    col = N.mix(deep, (0.74, 0.21, 0.31), (0.46, 0.06, 0.14))
    col = N.scale(col, N.add(0.9, N.mul(mott, 0.2)))
    col = N.mix(N.mul(rim, 0.75), col, (0.30, 0.06, 0.09))
    col = N.mix(N.mul(pits, 0.8), col, (0.20, 0.02, 0.06))
    return dict(albedo=col, rough=N.add(0.04, N.mul(rim, 0.12), N.mul(pits, 0.1)), metal=0.0,
                height=N.add(N.mul(pits, -0.0006), N.mul(rim, 0.0010), N.mul(mott, 0.0002)))


def tooth_recipe(N):
    t = N.ft()
    gp = N.gp()
    lx, ly, lz = N.xyz(N.lc())
    streak = N.noise(N.vec(N.mul(lx, 1.0), N.mul(ly, 0.08), N.mul(lz, 1.0)), 90.0, 3.0, 0.5, w=121.0)
    cr = N.vor(N.v("MULTIPLY", gp, (1.0, 0.4, 1.0)), 26.0, "DISTANCE_TO_EDGE")
    crack = N.mul(N.mapr(cr.outputs["Distance"], 0.03, 0.0), N.mapr(N.noise(gp, 9.0, 2.0, 0.5, w=122.0), 0.55, 0.62))
    col = N.mix(N.mapr(t, 0.16, 0.6, 0.0, 1.0, smooth=True), (0.60, 0.44, 0.17), (0.80, 0.76, 0.62))
    col = N.mix(N.mul(N.mapr(t, 0.8, 1.0), 0.5), col, (0.80, 0.81, 0.78))
    col = N.scale(col, N.add(0.9, N.mul(streak, 0.16)))
    col = N.mix(N.mul(N.m("EXPONENT", N.mul(-1.0, N.m("POWER", N.m("DIVIDE", N.sub(t, 0.22), 0.03), 2.0))), 0.6),
                col, (0.30, 0.20, 0.08))
    gum = N.mapr(t, 0.22, 0.12, 0.0, 1.0, smooth=True)
    col = N.mix(gum, col, (0.50, 0.12, 0.13))
    col = N.mix(N.mul(crack, 0.7), col, (0.36, 0.30, 0.20))
    return dict(albedo=col, rough=N.add(0.2, N.mul(gum, -0.06), N.mul(crack, 0.25), N.mul(streak, 0.05)), metal=0.0,
                height=N.add(N.mul(streak, 0.0004), N.mul(crack, -0.0004)))


def mouth_recipe(N):
    d = N.ft()
    gp = N.gp()
    x, y, z = N.xyz(gp)
    n = N.noise(gp, 25.0, 4.0, 0.6, w=131.0)
    # the mouth is shallow (~0.23 at the back): gum-red lips, then dark fast
    col = N.mix(N.mapr(d, 0.004, 0.03, 0.0, 1.0, smooth=True), (0.56, 0.13, 0.15), (0.26, 0.04, 0.05))
    col = N.mix(N.mapr(d, 0.025, 0.08, 0.0, 1.0, smooth=True), col, (0.05, 0.008, 0.010))
    col = N.mix(N.mapr(d, 0.07, 0.17, 0.0, 1.0, smooth=True), col, (0.008, 0.0015, 0.002))
    col = N.scale(col, N.add(0.85, N.mul(n, 0.3)))
    ridge = N.mul(N.m("POWER", N.m("ABSOLUTE", N.m("SINE", N.mul(z, 70.0))), 6.0), N.mapr(y, MOUTH_Y - 0.02, MOUTH_Y + 0.03))
    return dict(albedo=col, rough=N.add(0.11, N.mul(n, 0.08)), metal=0.0,
                height=N.add(N.mul(ridge, 0.0012), N.mul(n, 0.0006)))


def tongue_recipe(N):
    gp = N.gp()
    x, y, z = N.xyz(gp)
    pv = N.vor(gp, 75.0, "F1")
    pap = N.mapr(pv.outputs["Distance"], 0.36, 0.14, 0.0, 1.0, smooth=True)
    groove = N.mapr(N.m("ABSOLUTE", N.sub(x, 0.05)), 0.04, 0.006, 0.0, 1.0, smooth=True)
    back = N.mapr(z, 0.45, 0.32)
    n = N.noise(gp, 18.0, 3.0, 0.5, w=141.0)
    col = N.scale((0.62, 0.17, 0.21), N.add(0.86, N.mul(n, 0.22)))
    col = N.mix(N.mul(pap, 0.7), col, (0.86, 0.38, 0.40))
    col = N.mix(N.mul(groove, 0.8), col, (0.28, 0.04, 0.07))
    col = N.mix(N.mul(back, 0.6), col, (0.25, 0.04, 0.06))
    return dict(albedo=col, rough=N.add(0.13, N.mul(pap, 0.18)), metal=0.0,
                height=N.add(N.mul(pap, 0.0010), N.mul(groove, -0.003)))


def slime_recipe(N, goo=False):
    """Wet lime slime: a strong, near-mirror specular, paler and clearer
    where it is thin (a drip's neck, a goo string's middle: ft along it) and
    deeper, more saturated in its bulbs; bubbles inside. The game adds the
    translucency from _MOTION.w."""
    gp = N.gp()
    t = N.ft()
    n = N.noise(gp, 9.0, 4.0, 0.55, w=151.0)
    bv = N.vor(gp, 46.0, "F1")
    bub = N.mul(N.mapr(bv.outputs["Distance"], 0.30, 0.18, 0.0, 1.0, smooth=True),
                N.mapr(N.chan(bv.outputs["Color"], 0), 0.45, 0.5))
    tv = N.vor(N.v("ADD", gp, (2.0, 5.0, 1.0)), 130.0, "F1")
    tiny = N.mapr(tv.outputs["Distance"], 0.22, 0.12)
    if goo:            # thin in the middle of the string
        thin = N.sub(1.0, N.m("ABSOLUTE", N.sub(N.mul(t, 2.0), 1.0)))
        deep, pale = (0.30, 0.62, 0.05), (0.70, 0.90, 0.40)
    else:              # a drip: thin neck, round bulb at the tip
        thin = N.mul(N.mapr(t, 0.05, 0.3), N.mapr(t, 0.85, 0.62))
        deep, pale = (0.20, 0.52, 0.02), (0.58, 0.86, 0.26)
    col = N.mix(N.mul(thin, 0.85), deep, pale)
    col = N.scale(col, N.add(0.9, N.mul(n, 0.2)))
    col = N.mix(N.mul(bub, 0.5), col, (0.75, 0.95, 0.45))
    col = N.mix(N.mul(tiny, 0.35), col, (0.85, 0.97, 0.6))
    return dict(albedo=col, rough=N.add(0.02, N.mul(n, 0.025)), metal=0.0,
                height=N.add(N.mul(bub, 0.0014), N.mul(tiny, 0.0003)))


def eye_recipe(N):
    c = N.ft()                     # cos of the angle off the gaze
    gp = N.gp()
    lx, ly, lz = N.xyz(N.lc())
    ang = N.m("ARCTAN2", lx, ly)
    # veins: thin wandering ridges of a noise, only toward the eye's edge
    r1 = N.sub(1.0, N.m("ABSOLUTE", N.sub(N.mul(N.noise(gp, 6.5, 3.0, 0.55, 0.6, w=161.0), 2.0), 1.0)))
    r2 = N.sub(1.0, N.m("ABSOLUTE", N.sub(N.mul(N.noise(gp, 13.0, 2.0, 0.5, 0.4, w=163.0), 2.0), 1.0)))
    ridge = N.m("MAXIMUM", N.mapr(r1, 0.955, 0.99), N.mul(N.mapr(r2, 0.965, 0.993), 0.6))
    vein = N.mul(ridge, N.mapr(c, 0.62, 0.05), N.mapr(N.noise(gp, 3.0, 2.0, 0.5, w=164.0), 0.42, 0.55), 0.55)
    iris = N.mul(N.mapr(c, 0.818, 0.832), N.mapr(c, 0.935, 0.925))
    fib = N.noise(N.vec(N.mul(ang, 6.0), N.mul(c, 40.0), 0.0), 3.0, 3.0, 0.6, w=162.0)
    limbal = N.m("EXPONENT", N.mul(-1.0, N.m("POWER", N.m("DIVIDE", N.sub(c, 0.826), 0.007), 2.0)))
    white = N.mix(N.mapr(c, 0.25, -0.5), (0.88, 0.87, 0.81), (0.70, 0.64, 0.52))
    col = N.mix(vein, white, (0.58, 0.09, 0.07))
    irisc = N.scale((0.86, 0.50, 0.045), N.add(0.62, N.mul(fib, 0.6)))
    col = N.mix(iris, col, irisc)
    col = N.mix(N.mul(limbal, 0.8), col, (0.10, 0.04, 0.005))
    return dict(albedo=col, rough=0.018, metal=0.0, height=N.mul(fib, N.mul(iris, 0.0003)))


def pupil_recipe(N):
    return dict(albedo=(0.006, 0.006, 0.008), rough=0.035, metal=0.0)


def make_bake_materials():
    for name, recipe in (("hull", hull_recipe), ("hull_in", hull_in_recipe), ("band", band_recipe),
                         ("frame", frame_recipe), ("lens", lens_recipe), ("spike", spike_recipe),
                         ("turret", turret_recipe), ("barrel", barrel_recipe),
                         ("bore", lambda N: dict(albedo=(0.008, 0.008, 0.009), rough=0.7, metal=0.3)),
                         ("skin", skin_recipe), ("mouth", mouth_recipe), ("tooth", tooth_recipe),
                         ("tongue", tongue_recipe), ("slime", slime_recipe),
                         ("goo", lambda N: slime_recipe(N, goo=True)), ("eye", eye_recipe),
                         ("pupil", pupil_recipe), ("spot", spot_recipe)):
        mb.bake_material(name, recipe)

# ---- the final stage's sizes --------------------------------------------
TEX = 2048             # shipped albedo (R11)
NTEX = 2048            # shipped normal map (R11)
MR_TEX = 512           # metal/roughness (1024 cost the size cap its margin)
EM_TEX = 512           # emissive (the lenses)
AO_TEX = 2048          # the AO bake (multiplied into the albedo; low frequency: not supersampled)
FUR_TEX = 512          # the tiling strand mask
BAKE, NBAKE = 2 * TEX, 2 * NTEX     # supersampled bakes, box-filtered down
EXPLODE = 7.0          # each bake group moved this far apart along Blender X
FOCAL_PX = 802 / 2 / math.tan(math.radians(58) / 2)    # sphereLod.ts's reference view
LOD1_RATIO = {"hull": 0.2, "hull_in": 0.2, "band": 0.28, "frame": 1.0, "lens": 1.0, "spike": 0.5, "turret": 0.35,
              "barrel": 0.45, "bore": 1.0, "skin": 0.26, "mouth": 0.26, "tooth": 0.5, "tongue": 0.4, "slime": 0.4, "goo": 0.5,
              "eye": 0.36, "spot": 1.0, "dome": 0.3, "fur": 0.3}
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


def high_spots(H, meta):
    """The sculpted spot cups: a dish conforming to the high tube, lipped."""
    bm = H.obj("Alien_Spots")
    for sp in meta["spots"]:
        c, n, tan, rho, C = sp["c"], sp["n"], sp["tan"], sp["rho"], sp["C"]
        side = tan.cross(n).normalized()
        M = Matrix.Identity(4)
        for col, v in enumerate((tan * rho, n * rho, side * rho)):
            for row in range(3):
                M[row][col] = v[row]
        M.translation = c
        with H.piece(bm, name="spot", bake={SKIN: "spot"}, M=M):
            rings, segs = 8, 24
            grid = []
            for j in range(rings + 1):
                s = 1.12 * j / rings
                ring_ = []
                for k in range(segs if j else 1):
                    a = TAU * k / segs
                    q = c + (tan * math.cos(a) + side * math.sin(a)) * rho * s
                    i = min(range(len(C)), key=lambda q_: (C[q_] - q).length_squared)
                    tn = (C[min(i + 1, len(C) - 1)] - C[max(i - 1, 0)]).normalized()
                    cq = C[i] + tn * (q - C[i]).dot(tn)
                    dirn = ml.perp(q - cq, tn).normalized()
                    dish = -0.007 * max(0.0, 1 - s * s) ** 1.5 + 0.0035 * math.exp(-((s - 0.95) / 0.1) ** 2)
                    ring_.append(bm.verts.new(cq + dirn * (sp["r"] + 0.0015 + dish)))
                grid.append(ring_)
            for j in range(rings):
                A, B = grid[j], grid[j + 1]
                for k in range(segs):
                    k1 = (k + 1) % segs
                    f = bm.faces.new((A[0], B[k], B[k1]) if len(A) == 1 else (A[k], B[k], B[k1], A[k1]))
                    f.material_index = SKIN
                    f.normal_update()
                    if f.normal.dot(n) < 0:
                        f.normal_flip()
    H.done("Alien_Spots", bm)


def low_spots(L, meta):
    """The game mesh's spots: an 8-gon decal each, laid on the low tube."""
    bm = L.bm
    tubes = {}
    for span, info in L.pieces:
        if info.get("name", "").startswith("Alien_"):
            vs, fs = span.verts(), span.faces()
            idx = {v: i for i, v in enumerate(vs)}
            tubes[info["name"]] = BVHTree.FromPolygons([v.co for v in vs], [[idx[v] for v in f.verts] for f in fs])
    for sp in meta["spots"]:
        c, n, tan, rho = sp["c"], sp["n"], sp["tan"], sp["rho"]
        side = tan.cross(n).normalized()
        bvh = tubes[sp["tube"]]
        with L.piece(bm, name="spot", part=P_TENT, bake={SKIN: "spot"}, zone=(0, 1, 0), share="spot",
                     wgt=sp["t"], thick_from=sp["tube"]):
            loc, nrm, _, _ = bvh.find_nearest(c)
            centre = bm.verts.new(loc + nrm * 0.0022)
            ring_ = []
            for k in range(8):
                a = TAU * k / 8
                loc, nrm, _, _ = bvh.find_nearest(c + (tan * math.cos(a) + side * math.sin(a)) * rho)
                ring_.append(bm.verts.new(loc + nrm * 0.0045))
            fs = []
            for k in range(8):
                f = bm.faces.new((centre, ring_[k], ring_[(k + 1) % 8]))
                f.material_index = SKIN
                f.normal_update()
                if f.normal.dot(n) < 0:
                    f.normal_flip()
                fs.append(f)


def thinness(L):
    """w per vertex: 1 - thickness / 0.45 along the inward normal, cast
    inside the vertex's own piece (or the piece it lies on)."""
    bm = L.bm
    bm.normal_update()
    V = bm.verts.layers.float["thin"]
    by_name = {}
    for span, info in L.pieces:
        by_name.setdefault(info.get("name"), (span, info))
    for span, info in L.pieces:
        part, bake = info["part"], set(info.get("bake", {}).values())
        if part in (P_HULL, P_CANNON, P_EYEL, P_EYER, P_EYETOP) and not bake & {"slime"}:
            continue
        src = by_name[info["thick_from"]][0] if "thick_from" in info else span
        vs, fs = src.verts(), src.faces()
        idx = {v: i for i, v in enumerate(vs)}
        tree = BVHTree.FromPolygons([v.co for v in vs], [[idx[v] for v in f.verts] for f in fs])
        for v in span.verts():
            nrm = v.normal
            hit = tree.ray_cast(v.co - nrm * 1e-4, -nrm, 2.0)
            d = (hit[0] - v.co).length if hit[0] is not None else 0.04
            v[V] = max(0.0, min(1.0, 1.0 - d / 0.45))


def to_mesh_object(name, bm, matrix=GL2BL):
    bm.transform(matrix)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def write_motion(ob, mouth_jaw=None):
    """_MOTION (x part slot, y weight, z porthole ramp, w thinness) and the
    zone colours from the per-element layers."""
    me = ob.data
    nv, npoly, nl = len(me.vertices), len(me.polygons), len(me.loops)
    vpart = attr_np(me, "vpart", nv, dtype=np.int32)
    wgt = attr_np(me, "wgt", nv)
    vpor = attr_np(me, "vpor", nv, dtype=np.int32)
    thin = attr_np(me, "thin", nv)
    hostw = attr_np(me, "hostw", nv)
    mo = np.zeros((nv, 4), np.float32)
    mo[:, 0] = (vpart + 0.5) / 16.0
    mo[:, 1] = np.clip(wgt, 0, 1)
    # z: the porthole ramp on the hull (part 0), the host's weight at the root on a drip (R12)
    drip = np.isin(vpart, (P_DRIP, P_DRIP_T, P_DRIP_B))
    mo[:, 2] = np.where(drip, np.clip(hostw, 0, 1), np.where((vpart == P_HULL) & (vpor > 0),
                                                              (vpor - 1 + 0.5) / N_PORTHOLES, 0.0))
    mo[:, 3] = np.clip(thin, 0, 1)
    if "_MOTION" in me.attributes:
        me.attributes.remove(me.attributes["_MOTION"])
    a = me.attributes.new("_MOTION", "FLOAT_COLOR", "POINT")
    a.data.foreach_set("color", mo.ravel())
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
    flen = attr_np(me, "flen", nv)
    wet = attr_np(me, "wet", nv)
    cardf = attr_np(me, "cardf", nv)
    is_card = np.zeros(nv, bool)
    for p in me.polygons:
        if card[p.index]:
            is_card[list(p.vertices)] = True
    fur = np.stack([np.where(is_card, cardf, flen / FUR_MAX), wet], -1).clip(0, 1).astype(np.float32)
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


def body_uv(co_gl):
    """The body skin's own unwrap: cylindrical about its axis, the seam down
    the back (round 1: smart-project put one down the front of the face),
    u = angle x 0.62 (its mean radius), v = arc length up the profile."""
    th = math.atan2(co_gl.x, co_gl.z)
    y = max(BODY_Y0, min(BODY_Y1, co_gl.y))
    ys, ss = BODY_ARC
    k = max(0, min(len(ys) - 2, int(np.searchsorted(ys, y)) - 1))
    v = ss[k] + (ss[k + 1] - ss[k]) * (y - ys[k]) / max(ys[k + 1] - ys[k], 1e-9)
    return th * 0.62, v


_bp = ml.smooth_profile(BODY_CTRL, 6)
BODY_ARC = (np.array([y for _, y in _bp]), np.concatenate([[0.0], np.cumsum(
    [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(_bp, _bp[1:])])]))


def unwrap_baked(ob, body_grp):
    """Smart-project, scale islands by their part's texel density, pack only
    the master of each shared group, then copy its UVs onto the others."""
    me = ob.data
    npoly = len(me.polygons)
    bk = attr_np(me, "bk", npoly, dtype=np.int32)
    shg, shi, shk = (attr_np(me, k, npoly, dtype=np.int32) for k in ("shg", "shi", "shk"))
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
    # the body's skin: replaced by its cylindrical unwrap, at the skin's density
    fg = attr_np(me, "grp", len(me.polygons), dtype=np.int32)
    s0 = []
    for f in ubm.faces:
        if fg[f.index] == body_grp:
            continue
        pts = [lp[uvl].uv for lp in f.loops]
        a2 = sum(abs((pts[i] - pts[0]).cross(pts[i + 1] - pts[0])) / 2 for i in range(1, len(pts) - 1))
        if f.calc_area() > 1e-6 and BAKES[bk[f.index]] == "skin":
            s0.append(math.sqrt(a2 / f.calc_area()))
    k_skin = float(np.median(s0))
    for f in ubm.faces:
        if not (fg[f.index] == body_grp and BAKES[bk[f.index]] == "skin"):
            continue
        uvs = [body_uv(gl(lp.vert.co)) for lp in f.loops]
        if max(u for u, _ in uvs) - min(u for u, _ in uvs) > math.pi * 0.62:     # across the back seam
            uvs = [(u + TAU * 0.62 if u < 0 else u, v) for u, v in uvs]
        for lp, (u, v) in zip(f.loops, uvs):
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
    # report: atlas share and texels per unit by part
    area3, area2 = {}, {}
    for p in me.polygons:
        if shg[p.index] > 0 and shi[p.index] > 0:
            continue
        name = BAKES[bk[p.index]]
        pts = [uv[i].uv for i in range(p.loop_start, p.loop_start + p.loop_total)]
        a2 = sum(abs((pts[i] - pts[0]).cross(pts[i + 1] - pts[0])) / 2 for i in range(1, len(pts) - 1))
        area2[name] = area2.get(name, 0.0) + a2
        area3[name] = area3.get(name, 0.0) + p.area
    print("saucer: atlas % / texels per unit at", TEX, {k: (round(100 * area2[k], 1),
          round(TEX * math.sqrt(area2[k] / max(area3[k], 1e-9)))) for k in sorted(area2, key=lambda k: -area2[k])})


def unwrap_fur(ob, rng_):
    """The fur base: smart-projected islands scaled to FUR_TILE world units
    per repeat (the mask tiles), each shifted by a seeded offset."""
    me = ob.data
    mb.activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    ubm = bmesh.new()
    ubm.from_mesh(me)
    uvl = ubm.loops.layers.uv["UVMap"]
    for island in bmesh_linked_uv_islands(ubm, uvl):
        a3 = sum(f.calc_area() for f in island)
        a2 = 0.0
        for f in island:
            pts = [lp[uvl].uv for lp in f.loops]
            a2 += sum(abs((pts[i] - pts[0]).cross(pts[i + 1] - pts[0])) / 2 for i in range(1, len(pts) - 1))
        k = math.sqrt(a3 / max(a2, 1e-12)) / FUR_TILE
        off = Vector((rng_.uniform(0, 1), rng_.uniform(0, 1)))
        for f in island:
            for lp in f.loops:
                lp[uvl].uv = lp[uvl].uv * k + off
    ubm.to_mesh(me)
    ubm.free()


def lock_x(t):
    """_FUR.x along a lock card (fur lengths out): nearly solid at its root,
    fraying through its last third to the clump cores at its tip."""
    return 0.04 + 0.86 * t ** 2.0


def add_cards(ob, cards, drip_tips, rng_):
    """Lock cards along the approved blockout's clumps (its v3 tuft spines):
    each clump becomes a crossed pair of 4-row cards (a fin standing on the
    skin and a ribbon across it) that rises, slumps and droops exactly as the
    tuft did, wide at the root and pointed at the tip, so the shaggy v3
    outline comes back from any side. The mask runs along the lock (its
    strands stretched 2.5x down its length) and the alpha test rises toward
    the tip (lock_x), so a lock frays into its strands. Normals are the
    skin's turned out across the lock's width, so each lock shades round. Every clump a drip hangs
    from is a lock, so no drip floats."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    F = bm.faces.layers.int
    V = bm.verts.layers.float
    VI = bm.verts.layers.int
    uvl = bm.loops.layers.uv["UVMap"]
    normals = {}
    forced = [(c["spine"][0], c) for c in cards if any((c["spine"][-1] - q).length < 1e-6 for q in drip_tips)]
    taken = [p for p, _ in forced]

    def pick_from(sel, spacing, gap):
        cand = [(c["spine"][0], c) for c in cards if sel(c) and all((c["spine"][0] - q).length >= gap for q in taken)]
        got = ml.scatter(cand, spacing, rng_)
        taken.extend(p for p, _ in got)
        return got

    pick = forced + pick_from(lambda c: c["zone"] == "crown" and c["hem_d"] < 0.14, 0.06, 0.04)
    pick += pick_from(lambda c: c["zone"] == "crown", 0.072, 0.05)
    pick += pick_from(lambda c: c["zone"] != "crown", 0.032, 0.03)
    for _, c in pick:
        n = (GL2BL.to_3x3() @ c["n"]).normalized()
        sp_gl = list(c["spine"])
        sp_gl[0] = c["spine"][0] + (c["spine"][1] - c["spine"][0]) * 0.55 - c["n"].normalized() * 0.014
        dense = [bl(p) for p in ml.catmull(sp_gl, 6)]
        Td = arc_t(dense)
        length = sum((dense[i + 1] - dense[i]).length for i in range(len(dense) - 1))
        rows_t = (0.0, 0.36, 0.7, 1.0)
        spine = []
        for t in rows_t:
            j = min(range(len(Td)), key=lambda q: abs(Td[q] - t))
            spine.append(dense[j])
        width = c["radius"] * 2.1
        spin = math.radians(rng_.uniform(-20, 20))
        for layer in range(2):              # 0: the fin, 1: the ribbon across it
            u0, v0 = rng_.uniform(0, 1), rng_.uniform(0, 1)
            rows = []
            for i, p in enumerate(spine):
                tan = (spine[min(i + 1, 3)] - spine[max(i - 1, 0)]).normalized()
                side = tan.cross(n)
                side = side.normalized() if side.length > 1e-5 else tan.orthogonal().normalized()
                fin = tan.cross(side).normalized()
                wdir = Matrix.Rotation(spin, 3, tan) @ (fin if layer == 0 else side)
                w = width * (0.08 + 0.92 * (1.0 - rows_t[i]) ** 0.85) * 0.5
                rows.append(([bm.verts.new(p - wdir * w), bm.verts.new(p + wdir * w)], w, side))
            for i in range(3):
                (a0, a1), _, _ = rows[i]
                (b0, b1), _, _ = rows[i + 1]
                f = bm.faces.new((a0, a1, b1, b0))
                f.smooth = True
                f[F["prim"]], f[F["card"]], f[F["part"]], f[F["bk"]] = 2, 1, c["part"], BAKE_IDS["fur"]
                for lp in f.loops:
                    ri = next(k for k in range(4) if lp.vert in rows[k][0])
                    ci = rows[ri][0].index(lp.vert)
                    lp[uvl].uv = (u0 + (ci - 0.5) * 2 * rows[ri][1] / FUR_TILE,
                                  v0 + rows_t[ri] * length / FUR_TILE / 2.5)
            for i, (vs, _, side) in enumerate(rows):
                for e, v in zip((-1, 1), vs):
                    v[VI["vpart"]] = c["part"]
                    v[V["wgt"]] = c["wgt"]
                    v[V["cardf"]] = lock_x(rows_t[i])
                    v[V["wet"]] = c["wet"]
                    # the skin's normal, turned out across the lock: each lock
                    # shades round, like the blockout's tufts, not flat
                    normals[v] = (n + side * (0.75 * e)).normalized()
    bm.verts.index_update()
    vn = {v.index: nn for v, nn in normals.items()}
    bm.to_mesh(me)
    bm.free()
    me.normals_split_custom_set_from_vertices([tuple(vn.get(i, v.normal)) for i, v in enumerate(me.vertices)])
    print("saucer: lock cards: %d clumps (%d hold a drip), crown %d, arms %d" % (
        len(pick), len(forced), sum(c["zone"] == "crown" for _, c in pick), sum(c["zone"] != "crown" for _, c in pick)))
    return len(pick)


def split_uv_seams(ob):
    """Cut the mesh along its UV seams (edges whose two faces disagree on
    the UVs), so a collapse decimation keeps every island's border instead
    of dragging texels across it (the band's stencil smeared, round 1)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    uvl = bm.loops.layers.uv["UVMap"]
    seams = []
    for e in bm.edges:
        if len(e.link_loops) != 2:
            continue
        la, lb = e.link_loops
        # la runs v0 -> v1; lb runs the other way round its face
        a0, a1 = la[uvl].uv, la.link_loop_next[uvl].uv
        b1, b0 = lb[uvl].uv, lb.link_loop_next[uvl].uv
        if (a0 - b0).length > 1e-6 or (a1 - b1).length > 1e-6:
            seams.append(e)
    bmesh.ops.split_edges(bm, edges=seams)
    bm.to_mesh(ob.data)
    bm.free()


def lod1_from(lod0):
    """LOD1: LOD0 without its cards, each piece decimated on its own, cut
    along its UV seams first so the islands keep their borders."""
    mb.activate(lod0)
    bpy.ops.object.duplicate()
    ob = bpy.context.object
    ob.name = ob.data.name = "Saucer_LOD1"
    me = ob.data
    card = attr_np(me, "card", len(me.polygons), dtype=np.int32)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in np.nonzero(card)[0]], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    grp = attr_np(me, "grp", len(me.polygons), dtype=np.int32)
    groups = sorted(set(int(g) for g in grp))
    parts = []
    for g in groups:
        if g == groups[-1]:
            part = ob
        else:
            part = separate(ob, attr_np(ob.data, "grp", len(ob.data.polygons), dtype=np.int32) == g, f"lod1_{g}")
        pm = part.data
        bk = attr_np(pm, "bk", len(pm.polygons), dtype=np.int32)
        mi = np.zeros(len(pm.polygons), np.int32)
        pm.polygons.foreach_get("material_index", mi)
        names = [("dome" if m == 1 else BAKES[b]) for b, m in zip(bk, mi) if m != 2]
        parts.append((max(set(names), key=names.count) if names else "fur", part))
    for name, part in parts:
        r = LOD1_RATIO.get(name, 0.4)
        if r < 1.0:
            split_uv_seams(part)
            mod = part.modifiers.new("dec", "DECIMATE")
            mod.decimate_type = "COLLAPSE"
            mod.ratio = r
            mod.use_collapse_triangulate = True
            mb.activate(part)
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action="DESELECT")
    for _, part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()
    return ob


def fix_parts(ob, jaw_influence, body_grp):
    """After decimation: part ids exact again (the body/jaw split by its
    rule, every other vertex its face's part)."""
    me = ob.data
    nv = len(me.vertices)
    part = attr_np(me, "part", len(me.polygons), dtype=np.int32)
    grp = attr_np(me, "grp", len(me.polygons), dtype=np.int32)
    vpart = attr_np(me, "vpart", nv, dtype=np.int32)
    wgt = attr_np(me, "wgt", nv)
    for p in me.polygons:
        for vi in p.vertices:
            if grp[p.index] == body_grp:
                co = gl(me.vertices[vi].co)
                j = jaw_influence(co)
                vpart[vi] = P_JAW if j > 1e-3 else P_BODY
                wgt[vi] = j if j > 1e-3 else body_weight(co)
            else:
                vpart[vi] = part[p.index]
    me.attributes["vpart"].data.foreach_set("value", vpart)
    me.attributes["wgt"].data.foreach_set("value", wgt)


def final_material_baked(img_alb, img_mr, img_nrm, img_em):
    m = bpy.data.materials.new("SaucerBaked")
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


def final_material_dome():
    m = bpy.data.materials.new("SaucerDome")
    m.use_nodes = True
    m.use_backface_culling = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.90, 0.95, 1.0, 1)
    b.inputs["Roughness"].default_value = 0.04
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Alpha"].default_value = 0.16
    m.surface_render_method = "BLENDED"
    return m


def final_material_fur(img_fur):
    m = bpy.data.materials.new("SaucerFur")
    m.use_nodes = True
    m.use_backface_culling = False           # the cards are seen from both sides
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img_fur
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    # alphaMode MASK at cutoff 0.01 (R14): 1 - (alpha < 0.01). A stock viewer
    # then shows the fur base whole; the game raises the cutoff per shell
    lt = nt.nodes.new("ShaderNodeMath")
    lt.operation = "LESS_THAN"
    nt.links.new(t.outputs["Alpha"], lt.inputs[0])
    lt.inputs[1].default_value = FUR_CUTOFF
    one = nt.nodes.new("ShaderNodeMath")
    one.operation = "SUBTRACT"
    one.inputs[0].default_value = 1.0
    nt.links.new(lt.outputs[0], one.inputs[1])
    nt.links.new(one.outputs[0], b.inputs["Alpha"])
    b.inputs["Roughness"].default_value = 0.62
    b.inputs["Metallic"].default_value = 0.0
    m.surface_render_method = "DITHERED"
    return m


def final_stage():
    ml.reset_scene()
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.seed = 0

    # ---------------------------------------------------- the sculpt ---
    rt = ml.root("Saucer_High")
    H = HighSink(rt)
    hm = build(HIGH, H)
    check_dome(hm["worst"])
    SMEARS[:] = hm["smears"]
    make_bake_materials()         # (the hull's stains follow the smears' layout)
    com_bl, vol = ml.centre_of_mass(H.objects)          # the blockout's origin: every part, fur proxies too
    com = gl(com_bl)
    print("saucer: centre of mass (glTF) %s, volume %.3f" % (tuple(round(c, 4) for c in com), vol))
    high_spots(H, hm)
    # its mouth: depth into the grin (ft) for the lips-to-throat shading
    body = hm["body_ob"]
    bvh = hm["body_bvh"]
    me = body.data
    ft = np.zeros(len(me.vertices), np.float32)
    for v in me.vertices:
        p = gl(v.co)
        loc, _, _, _ = bvh.ray_cast(Vector((p.x, p.y, 3.0)), Vector((0, 0, -1)))
        ft[v.index] = max(0.0, loc.z - p.z) if loc is not None else 0.3
    me.attributes["ft"].data.foreach_set("value", ft)
    print("saucer: mouth depth (ft) on the high body: max %.3f, %d vertices deeper than 0.05" % (
        ft.max(), int((ft > 0.05).sum())))
    highs = []
    for o in list(H.objects):
        if o.name.startswith("Alien_Fur_") or o.name == "Saucer_Dome" or "bk" not in o.data.attributes:
            bpy.data.objects.remove(o)
            continue
        me = o.data
        bk = attr_np(me, "bk", len(me.polygons), dtype=np.int32)
        used = sorted(set(int(b) for b in bk if b > 0))
        me.materials.clear()
        for b in used:
            me.materials.append(mb.REGISTRY[BAKES[b - 1]][0])
        remap = {b: i for i, b in enumerate(used)}
        me.polygons.foreach_set("material_index", [remap.get(int(b), 0) for b in bk])
        o.parent = None
        highs.append(o)
    bpy.data.objects.remove(rt)

    # --------------------------------------------------- the game mesh ---
    L = LowSink()
    lm = build(LOW, L)
    check_dome(lm["worst"])
    low_spots(L, lm)
    hg = sorted(H.groups)
    lg = sorted({info["grp"] for _, info in L.pieces})
    assert len(hg) == len(lg) and [H.groups[g]["name"] for g in hg] == [
        next(i["name"] for _, i in L.pieces if i["grp"] == g) for g in lg], "high and low pieces differ"
    body_grp = next(i["grp"] for _, i in L.pieces if i["name"] == "body")
    thinness(L)
    by_piece = {}
    for span, info in L.pieces:
        k = info["name"] if not info["name"].startswith("porthole") else "porthole"
        k = k.rstrip("0123456789") if k.startswith("spike") else k
        by_piece[k] = by_piece.get(k, 0) + sum(len(f.verts) - 2 for f in span.faces())
    print("saucer: LOD0 triangles by part (before the cards)", dict(sorted(by_piece.items(), key=lambda kv: -kv[1])))
    low = to_mesh_object("SaucerLow", L.bm)
    mb.activate(low)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50), keep_sharp_edges=True)
    sm = bmesh.new()                # organic parts: smooth across their own edges, whatever the angle
    sm.from_mesh(low.data)
    lbk = sm.faces.layers.int["bk"]
    organic = {BAKE_IDS[k] for k in ("skin", "tooth", "tongue", "slime", "goo", "eye", "spot")}
    for e in sm.edges:
        ks = {f[lbk] for f in e.link_faces}
        if len(ks) == 1 and ks <= organic:
            e.smooth = True
    sm.to_mesh(low.data)
    sm.free()
    write_motion(low)
    prim = attr_np(low.data, "prim", len(low.data.polygons), dtype=np.int32)
    dome = separate(low, prim == 1, "SaucerDomeLow")
    prim = attr_np(low.data, "prim", len(low.data.polygons), dtype=np.int32)
    fur = separate(low, prim == 2, "SaucerFurLow")
    for o in (dome,):
        mb.activate(o)
        bpy.ops.object.shade_smooth()
    for o in (low, dome, fur):
        o.data.polygons.foreach_set("material_index", np.zeros(len(o.data.polygons), np.int32))
    tgt = bpy.data.materials.new("BAKE_TARGET")
    tgt.use_nodes = True
    low.data.materials.clear()
    low.data.materials.append(tgt)
    unwrap_baked(low, body_grp)
    if "UVMap" not in fur.data.uv_layers:
        fur.data.uv_layers.new(name="UVMap")
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

    for o in highs:
        explode(o, 1, "POINT")
    explode(low, 1, "FACE")
    for o in (fur, dome):
        o.hide_render = True
    imgs = {}
    for mode, size, samples in (("albedo", BAKE, 4), ("mr", BAKE, 4), ("emit", BAKE, 2), ("normal", NBAKE, 4)):
        mb.set_mode(mode)
        imgs[mode] = mb.new_img("saucer_%s_raw" % mode, size)
        mb.bake(low, highs, "NORMAL" if mode == "normal" else "EMIT", imgs[mode], samples, 16 if mode == "normal" else 8,
                extrusion=0.045, max_ray=0.14)
        print("saucer: baked", mode)
    explode(low, -1, "FACE")
    for o in highs:
        o.hide_render = True
    fur.hide_render = False
    world = bpy.data.worlds.new("bake_world")
    sc.world = world
    world.light_settings.distance = 0.14
    imgs["ao"] = mb.new_img("saucer_ao_raw", AO_TEX)
    mb.bake(low, None, "AO", imgs["ao"], 64, 8)
    print("saucer: baked ao")

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
    img_alb = mb.to_image("saucer_albedo", alb)
    img_mr = mb.to_image("saucer_metal_rough", mb.down(mr, MR_TEX), noncolor=True)
    img_em = mb.to_image("saucer_emissive", em)
    img_nrm = mb.to_image("saucer_normal", nrm, noncolor=True)
    fur_rgba = mb.fur_strand_texture(FUR_TEX, SEED + 5, clump_cells=4, clump=0.6, r_px=(1.5, 2.8), strands=30000,
                                     taper=0.2, base=0.25, flyaway=0.25,
                                     root=(0.045, 0.12, 0.028),
                                     tip=(0.105, 0.235, 0.050), tip_hi=(0.17, 0.32, 0.075))
    fur_rgba[..., :3] = mb.to_srgb(fur_rgba[..., :3])
    img_fur = mb.to_image("saucer_fur", fur_rgba, alpha=True)
    for img in imgs.values():
        bpy.data.images.remove(img)
    for o in highs:
        me = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(me)

    # ------------------------------------------------------ the fur cards ---
    n_cards = add_cards(fur, lm["cards"], lm["drip_tips"], random.Random(SEED + 6))
    write_motion(fur)
    print("saucer: %d hair cards" % n_cards)

    # ------------------------------------------------------- LOD0, LOD1 ---
    m_baked = final_material_baked(img_alb, img_mr, img_nrm, img_em)
    m_dome, m_fur = final_material_dome(), final_material_fur(img_fur)
    for o, m in ((low, m_baked), (dome, m_dome), (fur, m_fur)):
        o.data.materials.clear()
        o.data.materials.append(m)
    bpy.ops.object.select_all(action="DESELECT")
    for o in (low, dome, fur):
        o.hide_render = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.join()
    lod0 = low
    lod0.name = lod0.data.name = "Saucer_LOD0"
    mats = lod0.data.materials
    order = [mats.find(n) for n in ("SaucerBaked", "SaucerDome", "SaucerFur")]
    assert order == [0, 1, 2], order
    lod1 = lod1_from(lod0)
    fix_parts(lod1, lm["jaw_influence"], body_grp)
    write_motion(lod1)
    for o in (lod0, lod1):         # the dome: the hull's slot and nothing else
        me = o.data
        mo = np.zeros(len(me.vertices) * 4, np.float32)
        me.attributes["_MOTION"].data.foreach_get("color", mo)
        mo = mo.reshape(-1, 4)
        for p in me.polygons:
            if p.material_index == 1:
                mo[list(p.vertices)] = (0.5 / 16, 0.0, 0.0, 0.0)
        me.attributes["_MOTION"].data.foreach_set("color", mo.ravel())

    # LOD1's geometric error -> where it switches
    def bvh_of(o):
        bm = bmesh.new()
        bm.from_mesh(o.data)
        t = BVHTree.FromBMesh(bm)
        bm.free()
        return t

    t1 = bvh_of(lod1)
    card0 = attr_np(lod0.data, "card", len(lod0.data.polygons), dtype=np.int32)
    on_card = {vi for p in lod0.data.polygons if card0[p.index] for vi in p.vertices}
    errs = sorted((t1.find_nearest(v.co)[0] - v.co).length for v in lod0.data.vertices if v.index not in on_card)
    e90 = errs[int(len(errs) * 0.9)]
    lod1_distance = round(e90 * FOCAL_PX / 1.0, 1)
    print("saucer: LOD1 error p90 %.4f max %.4f -> lod1Distance %.1f" % (e90, errs[-1], lod1_distance))

    # into the final origin (the centre of mass), clean, export
    for o in (lod0, lod1):
        o.data.transform(Matrix.Translation(-com_bl))
        o.data.update()
        for a in ("bk", "part", "zone", "shg", "shi", "shk", "por", "prim", "grp", "card", "wgt", "flen", "wet",
                  "cardf", "thin", "vpart", "vpor", "vgrp"):
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
        raise SystemExit(f"saucer: longest extent {longest:.3f} outside {EXTENT}")
    for o in (lod0, lod1):
        o.data.calc_loop_triangles()
        per = {}
        for t in o.data.loop_triangles:
            per[t.material_index] = per.get(t.material_index, 0) + 1
        print("TRIS %s %d  %s" % (o.name, len(o.data.loop_triangles),
                                  {o.data.materials[k].name: v for k, v in sorted(per.items())}))

    def r4(v):
        return [round(float(c), 4) for c in v]

    rig = {
        "pivots": {"body": r4(Vector((0, BODY_Y0 + 0.03, 0)) - com), "jaw": r4(lm["jaw_pivot"] - com),
                   "eyeL": r4(lm["eyes"][0][0] - com), "eyeR": r4(lm["eyes"][1][0] - com),
                   "eyeTop": r4(lm["eyes"][2][0] - com), "cannon": r4(lm["cannon"] - com),
                   "gooTop": r4(lm["gooTop"] - com), "gooBottom": r4(lm["gooBottom"] - com)},
        "muzzle": r4(lm["muzzle"] - com),
        "portholes": N_PORTHOLES,
        "portholeOrder": "+Z toward +X",
        "eyeRadius": EYE_R,
        "bodySpan": [round(BODY_Y0 - com.y, 4), round(BODY_Y1 - com.y, 4)],
        "jawAxis": [1, 0, 0],
        "furMaxLength": FUR_MAX,
        "furShells": FUR_SHELLS,
        "lod1Distance": lod1_distance,
    }
    rig_path = os.path.join(ml.ROOT, "src", "data", "saucerRig.json") \
        if os.path.abspath(OUT_DIR) == os.path.join(ml.ROOT, "assets-src") else os.path.join(OUT_DIR, "saucerRig.json")
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(rig_path, "w") as f:
        f.write(json.dumps(rig, indent=2) + "\n")
    print("wrote", rig_path)

    out = os.path.join(OUT_DIR, "saucer.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for o in (lod0, lod1):
        o.select_set(True)
    bpy.context.view_layer.objects.active = lod0
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True,
                              export_yup=True, export_tangents=False, export_vertex_color="ACTIVE",
                              export_all_vertex_colors=False, export_attributes=True, export_animations=False,
                              export_extras=False)
    mb.glb_drop_attributes(out, {"SaucerBaked": ["_FUR"], "SaucerDome": ["_FUR", "COLOR_0", "TEXCOORD_0"]})
    print("wrote", out)
    blend = os.path.join(OUT_DIR, "saucer.blend")
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    print("wrote", blend)


final_stage()
