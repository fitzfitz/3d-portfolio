# Four hero asteroids — 0 boulder / 1 elongated shard / 2 contact binary /
# 3 rubble chunk — rebuilt for a cinematic, single-hard-sun look (2026-10-10).
#
# Recipe (all original, procedural, seeded — same input gives the same GLB):
#   1. Base form = a signed-distance shape per variant (warped ellipsoids, smooth
#      plane "spall" cuts, fused polyhedral blocks), ray-projected onto a dense
#      icosphere (outermost hit along each ray from the origin).
#   2. Sculpt in numpy on ~650k verts: domain warp, fBm lumps, ridged fault
#      crests, Worley fracture grooves, power-law craters with raised rims and
#      flat floors, scattered boulders.  (Own numpy Perlin/Worley — no addons.)
#   3. Per-vertex colour from multi-scale cavity (dust pools in lows and crater
#      floors, darker exposed basalt on ridges, chipped light edges, warm/cool
#      drift), plus shader-side speckle, metallic flecks, local AO and optional
#      thin emissive fissure veins.
#   4. Decimate to a 5-8k-triangle game mesh, recentre to radius 2.0, then bake
#      hi -> lo: baseColor(xAO), tangent normal, roughness/metal (G/B) and, on
#      variants 2 and 3, an emissive vein map.
#   $BLENDER --background --python scripts/blender/gen_asteroids.py
#   (ASTEROIDS_FAST=1 for a quick low-res iteration pass: 160k-vert hi-poly, 512px;
#    ASTEROIDS_OUT=<path> to write somewhere other than assets-src/asteroids.glb.)
import bpy
import math
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils

FAST = os.environ.get("ASTEROIDS_FAST") == "1"
HI_SUBDIV = 8 if FAST else 9          # 9 -> 655k verts / 1.3M tris sculpt
TEX = 512 if FAST else 1024
RADIUS = 2.0                           # contract: bounding radius per node
CAGE = 0.06
MAX_RAY = 0.16
T0 = time.time()

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.seed = 0
scene.render.bake.margin = 6
scene.render.bake.margin_type = "ADJACENT_FACES"
scene.render.bake.max_ray_distance = MAX_RAY
scene.render.bake.cage_extrusion = CAGE


def log(*a):
    print("[asteroids %6.1fs]" % (time.time() - T0), *a, flush=True)


# --------------------------------------------------------------------------
# numpy noise (Perlin gradient noise, fBm, ridged, Worley F1/F2)
# --------------------------------------------------------------------------
class Noise3:
    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        p = rng.permutation(256)
        self.perm = np.concatenate([p, p]).astype(np.int64)
        g = rng.normal(size=(256, 3))
        self.grad = g / np.linalg.norm(g, axis=1, keepdims=True)
        self.jit = rng.random((256, 3))
        self.off = rng.uniform(-100, 100, size=(16, 3))

    def _hash(self, x, y, z):
        P = self.perm
        return P[P[P[x & 255] + (y & 255)] + (z & 255)]

    def perlin(self, p):
        i = np.floor(p).astype(np.int64)
        f = p - i
        u = f * f * f * (f * (f * 6 - 15) + 10)
        c = {}
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    g = self.grad[self._hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz)]
                    c[dx, dy, dz] = ((f[:, 0] - dx) * g[:, 0] + (f[:, 1] - dy) * g[:, 1]
                                     + (f[:, 2] - dz) * g[:, 2])
        ux, uy, uz = u[:, 0], u[:, 1], u[:, 2]
        x00 = c[0, 0, 0] + ux * (c[1, 0, 0] - c[0, 0, 0])
        x10 = c[0, 1, 0] + ux * (c[1, 1, 0] - c[0, 1, 0])
        x01 = c[0, 0, 1] + ux * (c[1, 0, 1] - c[0, 0, 1])
        x11 = c[0, 1, 1] + ux * (c[1, 1, 1] - c[0, 1, 1])
        y0 = x00 + uy * (x10 - x00)
        y1 = x01 + uy * (x11 - x01)
        return (y0 + uz * (y1 - y0)) * 1.6     # ~[-1, 1]

    def fbm(self, p, octaves, lac=2.03, gain=0.5, k=0):
        s, amp, norm = 0.0, 1.0, 0.0
        for o in range(octaves):
            s = s + amp * self.perlin(p * (lac ** o) + self.off[(k + o) % 16])
            norm += amp
            amp *= gain
        return s / norm

    def ridged(self, p, octaves, lac=2.1, gain=0.5, k=5):
        """Sharp crests (1 at the crest, ~0 in the valleys)."""
        s, amp, norm, w = 0.0, 1.0, 0.0, 1.0
        for o in range(octaves):
            n = 1.0 - np.abs(self.perlin(p * (lac ** o) + self.off[(k + o) % 16]))
            n = n * n * w
            w = np.clip(n * 1.6, 0, 1)
            s = s + amp * n
            norm += amp
            amp *= gain
        return s / norm

    def vec_fbm(self, p, octaves):
        return np.stack([self.fbm(p, octaves, k=3 * j) for j in range(3)], 1)

    def worley(self, p):
        i = np.floor(p).astype(np.int64)
        f1 = np.full(len(p), 9.0)
        f2 = np.full(len(p), 9.0)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    cx, cy, cz = i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz
                    j = self.jit[self._hash(cx, cy, cz)]
                    d = np.sqrt((cx + j[:, 0] - p[:, 0]) ** 2 + (cy + j[:, 1] - p[:, 1]) ** 2
                                + (cz + j[:, 2] - p[:, 2]) ** 2)
                    f2 = np.where(d < f1, f1, np.minimum(f2, d))
                    f1 = np.minimum(f1, d)
        return f1, f2


# --------------------------------------------------------------------------
# SDF helpers (vectorised, p is (N, 3))
# --------------------------------------------------------------------------
def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def rand_rot(rng):
    q, r = np.linalg.qr(rng.normal(size=(3, 3)))
    return q * np.sign(np.diag(r))


def sd_ellipsoid(p, c, r, R=None):
    q = p - np.asarray(c)
    if R is not None:
        q = q @ R
    r = np.asarray(r, float)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.maximum(np.linalg.norm(q / (r * r), axis=1), 1e-9)
    # iq's bound is degenerate (0) at the very centre; fall back to a scaled sphere
    return np.where(k0 < 0.5, (k0 - 1.0) * r.min(), k0 * (k0 - 1.0) / k1)


def ellipsoid_support(n, r):
    return np.sqrt(((np.asarray(r) * n) ** 2).sum())


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def sd_cuts(d, p, cuts, k):
    """Intersect with half-spaces (n, offset): smooth spall/fracture facets."""
    for n, off in cuts:
        d = smax(d, p @ n - off, k)
    return d


def random_cuts(rng, radii, count, keep, bias=(1, 1, 1), R=None):
    cuts = []
    for _ in range(count):
        n = unit(rng.normal(size=3) * np.asarray(bias))
        local = n if R is None else n @ R
        cuts.append((n, ellipsoid_support(local, radii) * rng.uniform(*keep)))
    return cuts


def sd_block(p, c, size, rng, planes=11):
    """Irregular convex polyhedral block (no box faces: random normals)."""
    q = p - np.asarray(c)
    d = np.linalg.norm(q, axis=1) - size * 1.22
    for _ in range(planes):
        n = unit(rng.normal(size=3))
        d = smax(d, q @ n - size * rng.uniform(0.72, 1.02), 0.05 * size)
    return d


def project(dirs, sdf, centre, rmax=3.2, steps=60, iters=18):
    """Outermost SDF surface along each ray from `centre` (must be inside)."""
    centre = np.asarray(centre, float)
    assert sdf(centre[None])[0] < -0.05, "projection centre must be inside the form"
    n = len(dirs)
    t_in = np.full(n, 0.05)
    t_out = np.full(n, rmax)
    hit = np.zeros(n, bool)
    ts = np.linspace(rmax, 0.05, steps)
    prev = rmax
    for t in ts:
        todo = ~hit
        if not todo.any():
            break
        idx = np.nonzero(todo)[0]
        inside = sdf(centre + dirs[idx] * t) < 0
        newly = idx[inside]
        t_in[newly] = t
        t_out[newly] = prev
        hit[newly] = True
        prev = t
    for _ in range(iters):
        m = 0.5 * (t_in + t_out)
        ins = sdf(centre + dirs * m[:, None]) < 0
        t_in = np.where(ins, m, t_in)
        t_out = np.where(ins, t_out, m)
    assert hit.all(), "projection: %d rays missed the form" % (~hit).sum()
    return centre + dirs * (0.5 * (t_in + t_out))[:, None]


# --------------------------------------------------------------------------
# Mesh plumbing
# --------------------------------------------------------------------------
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=HI_SUBDIV, radius=1.0)
_tmpl_ob = bpy.context.view_layer.objects.active
TEMPLATE = _tmpl_ob.data
TEMPLATE.use_fake_user = True
bpy.data.objects.remove(_tmpl_ob, do_unlink=True)
NV = len(TEMPLATE.vertices)
_e = np.empty(len(TEMPLATE.edges) * 2, np.int64)
TEMPLATE.edges.foreach_get("vertices", _e)
E0, E1 = _e[0::2], _e[1::2]
DEG = np.bincount(E0, minlength=NV) + np.bincount(E1, minlength=NV)
_t = np.empty(len(TEMPLATE.loops), np.int64)
TEMPLATE.loops.foreach_get("vertex_index", _t)
TRIS = _t.reshape(-1, 3)                      # icosphere faces are all triangles
_co = np.empty(NV * 3, np.float32)
TEMPLATE.vertices.foreach_get("co", _co)
DIRS = _co.reshape(-1, 3).astype(np.float64)
DIRS /= np.linalg.norm(DIRS, axis=1, keepdims=True)
log("template verts", NV)


def get_co(me):
    a = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", a)
    return a.reshape(-1, 3).astype(np.float64)


def set_co(me, P):
    me.vertices.foreach_set("co", P.astype(np.float32).ravel())
    me.update()


def vnormals(me):
    a = np.empty(len(me.vertices) * 3, np.float32)
    me.vertex_normals.foreach_get("vector", a)
    return a.reshape(-1, 3).astype(np.float64)


def untangle(P, P0, rounds=40):
    """Relax vertices of faces the sculpt folded over (normal flipped vs the
    clean base form) — removes the specks they would bake as."""
    def fnorm(Q):
        a, b, c = Q[TRIS[:, 0]], Q[TRIS[:, 1]], Q[TRIS[:, 2]]
        return np.cross(b - a, c - a)
    ref = fnorm(P0)
    bad = 0
    for _ in range(rounds):
        bad_f = (fnorm(P) * ref).sum(1) <= 0
        bad = int(bad_f.sum())
        if bad == 0:
            break
        v = np.zeros(NV, bool)
        v[TRIS[bad_f].ravel()] = True
        v = v | (nmean(v.astype(float)) > 0)            # plus the 1-ring
        P = np.where(v[:, None], P + 0.8 * (nmean(P) - P), P)
    return P, bad


def face_normals(me):
    a = np.empty(len(me.polygons) * 3, np.float32)
    me.polygons.foreach_get("normal", a)
    return a.reshape(-1, 3)


def nmean(F):
    if F.ndim == 2:
        return np.stack([nmean(F[:, j]) for j in range(F.shape[1])], 1)
    return (np.bincount(E0, F[E1], NV) + np.bincount(E1, F[E0], NV)) / DEG


def smooth(F, iters, lam=0.6):
    for _ in range(iters):
        F = F + lam * (nmean(F) - F)
    return F


def norm01(x, lo=2.0, hi=98.0):
    a, b = np.percentile(x, [lo, hi])
    return np.clip((x - a) / max(b - a, 1e-9), 0, 1)


def signed_norm(x, pct=97.0):
    s = np.percentile(np.abs(x), pct)
    return np.clip(x / max(s, 1e-9), -1, 1)


def apply_modifiers(o):
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    old = o.data
    o.data = mesh
    o.modifiers.clear()
    bpy.data.meshes.remove(old)


def relax_onto(P, sdf, iters=8):
    """Even out the radial projection's stretched triangles (plane cuts, the
    binary's neck): Laplacian-relax, then snap back onto the SDF surface."""
    e = 2e-3
    tet = np.array([[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]], float)
    for _ in range(iters):
        P = P + 0.6 * (nmean(P) - P)
        for _ in range(2):
            d = sdf(P)
            g = sum(tet[k] * sdf(P + e * tet[k])[:, None] for k in range(4))
            g /= np.linalg.norm(g, axis=1, keepdims=True) + 1e-12
            P = P - d[:, None] * g
    return P


# --------------------------------------------------------------------------
# Sculpt features
# --------------------------------------------------------------------------
def add_craters(rng, P, N, h, floor_mask, fresh_mask, jitter, tiers):
    """Power-law craters: bowl + flat floor + raised rim (smooth min/max blend).
    Each crater gets an age: young ones are crisp and deep with sharp rims,
    old ones are shallow and softened, which is what sells a battered surface."""
    for count, rmin, rmax, depth_ratio, floor in tiers:
        u = rng.random(count)
        a = -1.6                                    # power law: many small, few large
        radii = (rmin ** (a + 1) + u * (rmax ** (a + 1) - rmin ** (a + 1))) ** (1 / (a + 1))
        centres = rng.integers(0, len(P), count)
        ages = rng.uniform(0.2, 1.0, count)
        for R, ci, age in zip(radii, centres, ages):
            c, nc = P[ci], N[ci]
            d2 = ((P - c) ** 2).sum(1)
            idx = np.nonzero(d2 < (R * 2.0) ** 2)[0]
            if len(idx) == 0:
                continue
            x = np.sqrt(d2[idx]) / R * (1.0 + 0.16 * jitter[idx])
            w = np.clip((N[idx] @ nc - 0.15) / 0.45, 0, 1)
            rim_w, k = 0.65, 0.16 + 0.34 * (1.0 - age)
            cav = x * x - 1.0
            rx = np.minimum(x - 1.0 - rim_w, 0.0)
            shape = smin(smax(cav, floor, k), 0.6 * age * rx * rx, k)
            h[idx] += shape * R * depth_ratio * (0.4 + 0.6 * age) * w
            fm = np.clip(1.1 - x, 0, 1) ** 0.6 * w * min(1.0, R / 0.35) ** 2
            floor_mask[idx] = np.maximum(floor_mask[idx], fm)
            if age > 0.85 and rng.random() < 0.45:   # fresh: bright ejecta halo
                ej = np.clip(1 - np.abs(x - 1.4) / 0.9, 0, 1) * w * (x > 0.95)
                fresh_mask[idx] = np.maximum(fresh_mask[idx], ej * 0.8)


def add_boulders(rng, P, N, h, count, rmin, rmax, bmask=None):
    """Angular blocks (faceted frusta, not domes) sitting on the surface."""
    for _ in range(count):
        R = rng.uniform(rmin, rmax)
        ci = rng.integers(0, len(P))
        c, nc = P[ci], N[ci]
        d2 = ((P - c) ** 2).sum(1)
        idx = np.nonzero(d2 < (1.5 * R) ** 2)[0]
        if len(idx) == 0:
            continue
        q = P[idx] - c
        hgt = np.full(len(idx), R * rng.uniform(0.45, 0.7))     # flat-ish top
        for _ in range(rng.integers(4, 7)):
            m = rng.normal(size=3)
            m = unit(m - (m @ nc) * nc)
            slope = rng.uniform(0.9, 1.8)
            hgt = np.minimum(hgt, (R * rng.uniform(0.6, 1.0) - q @ m) * slope)
        w = np.clip(N[idx] @ nc, 0, 1)
        hb = np.clip(hgt, 0, None)
        hb = hb * hb / (hb + 0.25 * R)          # soften the top edges
        h[idx] += hb * w
        if bmask is not None:
            bmask[idx] = np.maximum(bmask[idx], (hb > 0.05 * R) * w)


# --------------------------------------------------------------------------
# Variant definitions
# --------------------------------------------------------------------------
def variant_specs():
    specs = []

    # 0 — boulder: lumpy potato with big smooth spall facets and a bulge
    rng = np.random.default_rng(101)
    R0 = rand_rot(rng)
    r0 = (1.85, 1.55, 1.38)
    cuts0 = random_cuts(rng, r0, 7, (0.62, 0.82), R=R0)
    bulge_c = unit(rng.normal(size=3)) * 0.85

    def sdf0(p):
        d = sd_ellipsoid(p, (0, 0, 0), r0, R0)
        d = smin(d, sd_ellipsoid(p, bulge_c, (0.95, 0.85, 0.8)), 0.55)
        return sd_cuts(d, p, cuts0, 0.14)
    specs.append(dict(
        seed=101, sdf=sdf0, warp=(0.36, 0.4), lumps=(0.15, 0.55), ridges=(0.075, 1.0),
        grooves=(0.03, 0.85, 0.06), strata=None,
        craters=[(2, 0.8, 1.05, 0.32, -0.4), (5, 0.35, 0.6, 0.4, -0.5),
                 (18, 0.15, 0.32, 0.45, -0.6), (60, 0.07, 0.15, 0.5, -0.7),
                 (140, 0.045, 0.07, 0.5, -0.75)],
        boulders=(55, 0.05, 0.11), tris=7400,
        palette=dict(cool=(0.036, 0.039, 0.044), warm=(0.054, 0.050, 0.046),
                     dust=(0.15, 0.144, 0.136), chip=(0.2, 0.198, 0.192)),
        flecks=0.6, vein=None))

    # 1 — elongated shard: tapered, twisted blade with crisp fracture facets
    rng = np.random.default_rng(202)
    R1 = rand_rot(rng)
    r1 = (2.05, 1.02, 0.84)
    cuts1 = random_cuts(rng, r1, 8, (0.68, 0.86), bias=(0.3, 1, 1))
    cuts1 += [(unit((1, rng.normal() * 0.35, rng.normal() * 0.35)), 1.62),
              (unit((-1, rng.normal() * 0.35, rng.normal() * 0.35)), 1.7)]

    def sdf1(p):
        q = p @ R1
        s = 1.0 - 0.3 * np.clip(q[:, 0] / 2.0, -1, 1)
        tw = q[:, 0] * 0.22
        ct, st = np.cos(tw), np.sin(tw)
        qy = (q[:, 1] * ct - q[:, 2] * st) / s
        qz = (q[:, 1] * st + q[:, 2] * ct) / s
        qq = np.stack([q[:, 0], qy, qz], 1)
        d = sd_ellipsoid(qq, (0, 0, 0), r1) * s
        return sd_cuts(d, qq, cuts1, 0.07)
    specs.append(dict(
        seed=202, sdf=sdf1, warp=(0.12, 0.5), lumps=(0.07, 0.7), ridges=(0.06, 1.3),
        grooves=(0.03, 1.1, 0.05), strata=(0.028, 3.4, R1[:, 0]),
        craters=[(1, 0.42, 0.55, 0.35, -0.5), (4, 0.18, 0.32, 0.42, -0.6),
                 (14, 0.09, 0.16, 0.45, -0.65), (60, 0.045, 0.08, 0.5, -0.75)],
        boulders=(25, 0.045, 0.08), tris=6200,
        palette=dict(cool=(0.034, 0.038, 0.046), warm=(0.048, 0.047, 0.046),
                     dust=(0.14, 0.137, 0.132), chip=(0.2, 0.2, 0.2)),
        flecks=0.9, vein=None))

    # 2 — contact binary: two unequal lobes fused at a dusty neck
    rng = np.random.default_rng(303)
    RA, RB = rand_rot(rng), rand_rot(rng)
    ca, cb = np.array([-0.7, 0.05, 0.0]), np.array([0.92, -0.08, 0.06])
    ra, rb = (1.12, 1.0, 0.92), (0.86, 0.76, 0.72)
    axis = unit(cb - ca)
    # spall cuts on the outer faces only, so the lobes stay fused at the neck
    cutsA = [(n, o + n @ ca) for n, o in random_cuts(rng, ra, 6, (0.74, 0.88), R=RA)
             if n @ axis < -0.1][:3]
    cutsB = [(n, o + n @ cb) for n, o in random_cuts(rng, rb, 6, (0.74, 0.88), R=RB)
             if n @ axis > 0.1][:3]

    def sdf2(p):
        a = sd_cuts(sd_ellipsoid(p, ca, ra, RA), p, cutsA, 0.3)
        b = sd_cuts(sd_ellipsoid(p, cb, rb, RB), p, cutsB, 0.3)
        return smin(a, b, 0.5)
    seg = ca + np.linspace(0.25, 0.75, 51)[:, None] * (cb - ca)
    neck_c = seg[int(np.argmax(sdf2(seg)))]       # project from the neck
    specs.append(dict(
        seed=303, sdf=sdf2, warp=(0.18, 0.5), lumps=(0.12, 0.6), ridges=(0.06, 1.1),
        grooves=(0.04, 0.9, 0.065), strata=None,
        craters=[(2, 0.55, 0.8, 0.36, -0.45), (6, 0.25, 0.45, 0.42, -0.55),
                 (18, 0.11, 0.25, 0.45, -0.6), (60, 0.06, 0.11, 0.5, -0.7),
                 (110, 0.045, 0.065, 0.5, -0.75)],
        boulders=(50, 0.045, 0.09), tris=7400, centre=neck_c,
        palette=dict(cool=(0.036, 0.040, 0.046), warm=(0.060, 0.053, 0.046),
                     dust=(0.155, 0.147, 0.136), chip=(0.2, 0.196, 0.188)),
        lobe_tint=True, flecks=0.5,
        vein=dict(color=(0.0, 0.871, 1.0), scale=1.7, width=0.022, mask=0.58,
                  neck=True)))

    # 3 — rubble chunk: fused, angular blocks of varied size (rubble pile shard)
    rng = np.random.default_rng(404)
    blocks = [((0.0, 0.0, 0.0), 1.18)]
    for _ in range(5):
        dirn = unit(rng.normal(size=3))
        size = rng.uniform(0.5, 0.82)
        blocks.append((dirn * rng.uniform(0.75, 1.05), size))
    brngs = [np.random.default_rng(4040 + i) for i in range(len(blocks))]
    block_planes = []
    for (c, size), br in zip(blocks, brngs):
        planes = []
        for _ in range(11):
            planes.append((unit(br.normal(size=3)), size * br.uniform(0.72, 1.02)))
        block_planes.append((np.asarray(c), size, planes))

    def sdf3(p):
        d = None
        for c, size, planes in block_planes:
            q = p - c
            b = np.linalg.norm(q, axis=1) - size * 1.22
            for n, off in planes:
                b = smax(b, q @ n - off, 0.05 * size)
            d = b if d is None else smin(d, b, 0.14)
        return d
    specs.append(dict(
        seed=404, sdf=sdf3, warp=(0.1, 0.6), lumps=(0.06, 0.9), ridges=(0.05, 1.4),
        grooves=(0.025, 1.1, 0.045), strata=None,
        craters=[(3, 0.22, 0.38, 0.4, -0.55), (12, 0.1, 0.2, 0.45, -0.6),
                 (50, 0.045, 0.08, 0.5, -0.7)],
        boulders=(110, 0.05, 0.13), tris=6600,
        palette=dict(cool=(0.032, 0.034, 0.038), warm=(0.048, 0.045, 0.042),
                     dust=(0.13, 0.126, 0.12), chip=(0.19, 0.186, 0.18)),
        flecks=1.3,
        vein=dict(color=(1.0, 0.451, 0.0612), scale=2.2, width=0.022, mask=0.6,
                  neck=False)))
    return specs


# --------------------------------------------------------------------------
# Build one sculpted hi-poly
# --------------------------------------------------------------------------
def build_hipoly(i, spec):
    nz = Noise3(spec["seed"])
    rng = np.random.default_rng(spec["seed"] + 7)
    me = TEMPLATE.copy()
    me.name = "Asteroid%d_hi" % i
    ob = bpy.data.objects.new(me.name, me)
    scene.collection.objects.link(ob)

    P = project(DIRS, spec["sdf"], spec.get("centre", (0, 0, 0)))
    P = relax_onto(P, spec["sdf"])
    P0 = P.copy()
    wa, wf = spec["warp"]
    P = P + wa * nz.vec_fbm(P * wf, 3)                    # domain warp of the form
    set_co(me, P)
    N = vnormals(me)
    log(i, "projected + warped")

    la, lf = spec["lumps"]
    ra, rf = spec["ridges"]
    h = la * nz.fbm(P * lf, 5, k=1)
    h += ra * (nz.ridged(P * rf, 4) - 0.35)
    if spec["strata"]:
        sa, sf, axis = spec["strata"]
        t = (P @ axis) * sf + 0.9 * nz.fbm(P * 0.8, 3, k=9)
        fr = t - np.floor(t)
        h += sa * (np.clip(fr * 3.0, 0, 1) - fr)            # stepped terraces
    P = P + N * h[:, None]
    set_co(me, P)
    N = vnormals(me)
    log(i, "lumps")

    h = np.zeros(NV)
    ga, gs, gw = spec["grooves"]
    # stretched Worley cells -> sub-parallel lineaments (Phobos-style grooves)
    G = rand_rot(rng) * np.array([1.0, 4.0, 4.0])
    f1, f2 = nz.worley((P @ G) * gs + 3.1)
    groove = np.clip(1 - (f2 - f1) / gw, 0, 1) ** 2
    gmask = np.clip(nz.fbm(P * 0.5, 2, k=11) * 2.6 - 0.45, 0, 1)
    h -= ga * groove * gmask
    floor_mask = np.zeros(NV)
    fresh = np.zeros(NV)
    jitter = nz.fbm(P * 4.0, 3, k=13)
    add_craters(rng, P, N, h, floor_mask, fresh, jitter, spec["craters"])
    bmask = np.zeros(NV)
    add_boulders(rng, P, N, h, *spec["boulders"], bmask=bmask)
    h += 0.006 * nz.fbm(P * 18.0, 3, k=4)                  # regolith grain
    h = smooth(h, 1, 0.5)                                   # anti-alias sub-vertex features
    P = P + N * h[:, None]
    P, bad = untangle(P, P0)
    set_co(me, P)
    log(i, "untangled, folded faces left:", bad)
    log(i, "craters/boulders")

    # recentre on bbox and scale to the contract radius (re-done after decimate)
    c = 0.5 * (P.min(0) + P.max(0))
    P = (P - c) * (RADIUS / np.linalg.norm(P - c, axis=1).max())
    set_co(me, P)
    N = vnormals(me)

    # multi-scale cavity: + ridges / - hollows
    Ps = smooth(P, 3)
    cav_f = signed_norm(((P - Ps) * N).sum(1))
    Ps = smooth(Ps, 24)
    cav_m = signed_norm(((P - Ps) * N).sum(1))
    Ps = smooth(Ps, 110)
    cav_l = signed_norm(((P - Ps) * N).sum(1))
    log(i, "cavity")

    pal = spec["palette"]
    cool, warm = np.array(pal["cool"]), np.array(pal["warm"])
    t = norm01(nz.fbm(P * 0.38, 3, k=2))
    if spec.get("lobe_tint"):
        t = np.clip(t * 0.6 + np.clip(-P[:, 0] / 1.2, 0, 1) * 0.55, 0, 1)
    base = cool + (warm - cool) * t[:, None]
    mott = 0.78 + 0.44 * norm01(nz.fbm(P * 1.6, 4, k=6))
    f1, f2 = nz.worley(P * 2.4 + 7.0)                        # mineral patches
    patch = np.clip((0.35 - f1) / 0.2, 0, 1) * (nz.fbm(P * 0.9, 2, k=14) > 0.05)
    base = base * (mott * (1 - 0.18 * patch))[:, None]
    ridge = np.clip(cav_m, 0, 1) * 0.6 + np.clip(cav_l, 0, 1) * 0.4
    base = base * (1 - 0.38 * ridge)[:, None]
    dust = np.clip(-cav_m * 0.5 - cav_l * 0.95 + floor_mask * 0.9 - 0.05, 0, 1) ** 1.15
    dust *= 0.82 + 0.18 * norm01(nz.fbm(P * 3.0, 3, k=12))
    col = base + (np.array(pal["dust"]) - base) * dust[:, None]
    chip = np.clip((cav_f - 0.55) * 2.2, 0, 1) * (1 - dust) * (1 - groove * gmask)
    chip = np.maximum(chip, bmask * 0.35)
    col = col + (np.array(pal["chip"]) - col) * (chip * 0.55)[:, None]
    col = col * (1 + 0.45 * fresh)[:, None]
    rough = np.clip(0.88 + 0.12 * dust - 0.12 * chip, 0, 1)

    def put(name, rgb):
        a = me.color_attributes.new(name, "FLOAT_COLOR", "POINT")
        rgba = np.concatenate([rgb, np.ones((NV, 1))], 1).astype(np.float32)
        a.data.foreach_set("color", rgba.ravel())
    put("rock", col)
    put("aux", np.stack([rough, dust, groove * gmask], 1))
    me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), bool))
    me.update()
    fn1 = face_normals(me)
    set_co(me, P0)
    fn0 = face_normals(me)
    set_co(me, P)
    ob["folded"] = float(((fn0 * fn1).sum(1) < 0).mean())   # sculpt sanity metric
    return ob


# --------------------------------------------------------------------------
# Hi-poly bake-source shader
# --------------------------------------------------------------------------
def _set(sock, v, nt):
    if isinstance(v, bpy.types.NodeSocket):
        nt.links.new(v, sock)
    else:
        sock.default_value = v


def math_node(nt, op, a, b=None, clamp=False):
    m = nt.nodes.new("ShaderNodeMath")
    m.operation = op
    m.use_clamp = clamp
    _set(m.inputs[0], a, nt)
    if b is not None:
        _set(m.inputs[1], b, nt)
    return m.outputs[0]


def map_range(nt, v, a, b, c, d, smooth_step=False):
    m = nt.nodes.new("ShaderNodeMapRange")
    if smooth_step:
        m.interpolation_type = "SMOOTHSTEP"
    m.clamp = True
    _set(m.inputs["Value"], v, nt)
    m.inputs["From Min"].default_value = a
    m.inputs["From Max"].default_value = b
    m.inputs["To Min"].default_value = c
    m.inputs["To Max"].default_value = d
    return m.outputs["Result"]


def mix_rgb(nt, fac, a, b, blend="MIX"):
    m = nt.nodes.new("ShaderNodeMix")
    m.data_type = "RGBA"
    m.blend_type = blend
    _set(m.inputs[0], fac, nt)
    _set(m.inputs[6], a, nt)
    _set(m.inputs[7], b, nt)
    return m.outputs[2]


def noise_tex(nt, vec, scale, detail, rough=0.55):
    n = nt.nodes.new("ShaderNodeTexNoise")
    nt.links.new(vec, n.inputs["Vector"])
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    return n


def voronoi(nt, vec, scale, feature="F1"):
    v = nt.nodes.new("ShaderNodeTexVoronoi")
    v.feature = feature
    nt.links.new(vec, v.inputs["Vector"])
    v.inputs["Scale"].default_value = scale
    return v


def hipoly_material(i, spec, neck_x):
    m = bpy.data.materials.new("Asteroid%d_src" % i)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    emit.inputs["Strength"].default_value = 1.0
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
    co = nt.nodes.new("ShaderNodeTexCoord").outputs["Object"]

    rock = nt.nodes.new("ShaderNodeAttribute")
    rock.attribute_name = "rock"
    aux = nt.nodes.new("ShaderNodeAttribute")
    aux.attribute_name = "aux"
    auxs = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(aux.outputs["Color"], auxs.inputs["Color"])
    rough_in, dust_in = auxs.outputs[0], auxs.outputs[1]

    fine = noise_tex(nt, co, 34.0, 8.0, 0.62)
    mid = noise_tex(nt, co, 9.0, 5.0, 0.55)
    # speckle (regolith grain) on colour
    speck = map_range(nt, fine.outputs["Fac"], 0.3, 0.7, 0.8, 1.18)
    col = mix_rgb(nt, 1.0, rock.outputs["Color"], (1, 1, 1, 1), "MULTIPLY")
    col = mix_rgb(nt, 1.0, col, speck, "MULTIPLY")

    # metallic flecks (sparse bright grains, mostly outside the dust)
    fv = voronoi(nt, co, 48.0)
    fsep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(fv.outputs["Color"], fsep.inputs["Color"])
    fpick = math_node(nt, "GREATER_THAN", fsep.outputs[0], 1.0 - 0.085 * spec["flecks"])
    fdot = map_range(nt, fv.outputs["Distance"], 0.07, 0.17, 1.0, 0.0)
    fleck = math_node(nt, "MULTIPLY", fpick, fdot)
    fleck = math_node(nt, "MULTIPLY", fleck, map_range(nt, dust_in, 0.2, 0.7, 1.0, 0.25))
    col = mix_rgb(nt, math_node(nt, "MULTIPLY", fleck, 0.75), col, (0.26, 0.245, 0.22, 1))

    # micro pits (normal map only)
    pits = voronoi(nt, co, 22.0)
    pit = map_range(nt, pits.outputs["Distance"], 0.0, 0.32, -1.0, 0.0, smooth_step=True)

    height = math_node(nt, "MULTIPLY", fine.outputs["Fac"], 0.55)
    height = math_node(nt, "ADD", height, math_node(nt, "MULTIPLY", mid.outputs["Fac"], 0.6))
    height = math_node(nt, "ADD", height, math_node(nt, "MULTIPLY", pit, 0.28))

    vein_val = None
    vein = spec["vein"]
    if vein:
        warpn = noise_tex(nt, co, 1.3, 3.0)
        wv = nt.nodes.new("ShaderNodeVectorMath")
        wv.operation = "MULTIPLY_ADD"
        nt.links.new(warpn.outputs["Color"], wv.inputs[0])
        wv.inputs[1].default_value = (0.3, 0.3, 0.3)
        nt.links.new(co, wv.inputs[2])
        v1 = voronoi(nt, wv.outputs[0], vein["scale"], "DISTANCE_TO_EDGE")
        v2 = voronoi(nt, wv.outputs[0], vein["scale"] * 2.9, "DISTANCE_TO_EDGE")
        w = vein["width"]
        line1 = map_range(nt, v1.outputs["Distance"], 0.0, w, 1.0, 0.0, smooth_step=True)
        line2 = map_range(nt, v2.outputs["Distance"], 0.0, w * 1.3, 0.7, 0.0, smooth_step=True)
        mnz = noise_tex(nt, co, 0.6, 2.0)
        mask1 = map_range(nt, mnz.outputs["Fac"], vein["mask"], vein["mask"] + 0.07, 0.0, 1.0)
        mask2 = map_range(nt, mnz.outputs["Fac"], vein["mask"] + 0.06, vein["mask"] + 0.14, 0.0, 1.0)
        vl = math_node(nt, "MAXIMUM", math_node(nt, "MULTIPLY", line1, mask1),
                       math_node(nt, "MULTIPLY", line2, mask2))
        if vein["neck"]:
            sx = nt.nodes.new("ShaderNodeSeparateXYZ")
            nt.links.new(co, sx.inputs[0])
            dx = math_node(nt, "ABSOLUTE", math_node(nt, "SUBTRACT", sx.outputs["X"], neck_x))
            vl = math_node(nt, "MULTIPLY", vl, map_range(nt, dx, 0.35, 1.25, 1.0, 0.12))
        # keep veins out of dust-filled lows (they read as cracks in bare rock)
        vl = math_node(nt, "MULTIPLY", vl, map_range(nt, dust_in, 0.35, 0.8, 1.0, 0.2))
        vein_val = vl
        groove_w = map_range(nt, v1.outputs["Distance"], 0.0, w * 2.6, 1.0, 0.0, smooth_step=True)
        groove_w = math_node(nt, "MULTIPLY", groove_w, mask1)
        height = math_node(nt, "SUBTRACT", height, math_node(nt, "MULTIPLY", groove_w, 0.9))
        col = mix_rgb(nt, math_node(nt, "MULTIPLY", groove_w, 0.7), col, (0.012, 0.016, 0.02, 1))
        vcol = mix_rgb(nt, vl, (0, 0, 0, 1), (*vein["color"], 1))
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.010
    nt.links.new(height, bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], diff.inputs["Normal"])

    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.only_local = True
    ao.samples = 12
    ao.inputs["Distance"].default_value = 0.6
    aof = map_range(nt, ao.outputs["AO"], 0.0, 1.0, 0.32, 1.0)
    col = mix_rgb(nt, 1.0, col, aof, "MULTIPLY")

    rough = mix_rgb(nt, fleck, rough_in, (0.42, 0.42, 0.42, 1))
    if vein_val is not None:
        rough = mix_rgb(nt, vein_val, rough, (0.35, 0.35, 0.35, 1))
    orm = nt.nodes.new("ShaderNodeCombineColor")
    orm.inputs[0].default_value = 1.0
    gr = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(rough, gr.inputs["Color"])
    nt.links.new(gr.outputs[0], orm.inputs[1])
    nt.links.new(fleck, orm.inputs[2])

    channels = {"color": col, "orm": orm.outputs[0]}
    if vein_val is not None:
        channels["emissive"] = vcol

    def mode(name):
        if name == "normal":
            nt.links.new(diff.outputs[0], out.inputs["Surface"])
        else:
            nt.links.new(channels[name], emit.inputs["Color"])
            nt.links.new(emit.outputs[0], out.inputs["Surface"])
    return m, mode


# --------------------------------------------------------------------------
# Low-poly + bakes
# --------------------------------------------------------------------------
def make_lowpoly(i, hi, target):
    me = hi.data.copy()
    me.name = "Asteroid%d" % i
    while me.color_attributes:
        me.color_attributes.remove(me.color_attributes[0])
    lo = bpy.data.objects.new("Asteroid%d" % i, me)
    scene.collection.objects.link(lo)
    dec = lo.modifiers.new("dec", "DECIMATE")
    dec.ratio = target / len(me.polygons)
    tri = lo.modifiers.new("tri", "TRIANGULATE")
    tri.quad_method = "BEAUTY"
    apply_modifiers(lo)
    lo.data.name = "Asteroid%d" % i
    lo.data.polygons.foreach_set("use_smooth", np.ones(len(lo.data.polygons), bool))
    lo.data.update()
    return lo


def renormalise(lo, hi):
    """Centre both on the game mesh's bbox and set its max radius to RADIUS."""
    P = get_co(lo.data)
    c = 0.5 * (P.min(0) + P.max(0))
    s = RADIUS / np.linalg.norm(P - c, axis=1).max()
    set_co(lo.data, (P - c) * s)
    set_co(hi.data, (get_co(hi.data) - c) * s)


def unwrap(lo):
    """Few big islands: smart-project a heavily smoothed proxy of the game mesh
    (raw decimated rock shatters into hundreds of islands), keep its island
    boundaries as seams, restore the real shape, conformal-unwrap, pack."""
    me = lo.data
    P = get_co(me)
    e = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get("vertices", e)
    a, b = e[0::2], e[1::2]
    n = len(P)
    deg = np.bincount(a, minlength=n) + np.bincount(b, minlength=n)
    Q = P.copy()
    for _ in range(60):
        nb = np.stack([np.bincount(a, Q[b, j], n) + np.bincount(b, Q[a, j], n)
                       for j in range(3)], 1) / deg[:, None]
        Q = Q + 0.7 * (nb - Q)
    Q = Q * (np.linalg.norm(P, axis=1).mean() / np.linalg.norm(Q, axis=1).mean())
    set_co(me, Q)
    bpy.ops.object.select_all(action="DESELECT")
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.01)
    bpy.ops.uv.seams_from_islands()
    bpy.ops.object.mode_set(mode="OBJECT")
    set_co(me, P)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method="CONFORMAL", margin=0.01)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=0.006)
    bpy.ops.object.mode_set(mode="OBJECT")


def new_image(name, non_color):
    img = bpy.data.images.new(name, width=TEX, height=TEX, alpha=False)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def bake_emit(lo, hi, img, samples):
    bake_utils._attach_bake_target([lo], img)
    scene.cycles.samples = samples
    bpy.ops.object.select_all(action="DESELECT")
    hi.select_set(True)
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.bake(type="EMIT", use_selected_to_active=True, cage_extrusion=CAGE,
                        max_ray_distance=MAX_RAY, use_clear=True)
    bake_utils._detach_bake_targets([lo])
    img.pack()
    return img


def pixels(img):
    a = np.empty(TEX * TEX * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(TEX, TEX, 4)


specs = variant_specs()
rocks = []
for i, spec in enumerate(specs):
    hi = build_hipoly(i, spec)
    lo = make_lowpoly(i, hi, spec["tris"])
    renormalise(lo, hi)
    unwrap(lo)
    log(i, "lowpoly tris", len(lo.data.polygons))
    if os.environ.get("ASTEROIDS_DEBUG"):
        from mathutils.bvhtree import BVHTree
        bvh = BVHTree.FromObject(lo, bpy.context.evaluated_depsgraph_get())
        Ph = get_co(hi.data)
        sub = Ph[:: max(1, len(Ph) // 20000)]
        dev = np.array([(bvh.find_nearest(v)[3] or 0.0) for v in sub])
        log(i, "DEBUG dev p50 %.3f p95 %.3f p99 %.3f max %.3f; folded faces %.3f%%"
            % (*np.percentile(dev, [50, 95, 99]), dev.max(), hi["folded"] * 100))

    neck_x = 0.0
    if spec["vein"] and spec["vein"]["neck"]:
        # neck = slimmest cross-section along x of the (normalised) hi-poly
        P = get_co(hi.data)
        xs = np.linspace(P[:, 0].min() + 0.6, P[:, 0].max() - 0.6, 40)
        widths = []
        for x in xs:
            sl = P[np.abs(P[:, 0] - x) < 0.06][:, 1:]
            widths.append(np.ptp(sl, axis=0).sum() if len(sl) > 8 else 9.0)
        neck_x = float(xs[int(np.argmin(widths))])
        log(i, "neck x", round(neck_x, 3))
    src, mode = hipoly_material(i, spec, neck_x)
    hi.data.materials.append(src)

    mat = bpy.data.materials.new("Asteroid%dBaked" % i)
    mat.use_nodes = True
    lo.data.materials.append(mat)

    mode("color")
    col_img = bake_emit(lo, hi, new_image("asteroid%d_color" % i, False), 16)
    log(i, "baked color")
    mode("orm")
    orm_img = bake_emit(lo, hi, new_image("asteroid%d_orm" % i, True), 6)
    log(i, "baked orm")
    emi_img = None
    if spec["vein"]:
        mode("emissive")
        emi_img = bake_emit(lo, hi, new_image("asteroid%d_emissive" % i, False), 12)
        e, c = pixels(emi_img), pixels(col_img)
        used = c[..., :3].max(2) > 0.0
        lit = e[..., :3].max(2) > 0.12
        log(i, "emissive coverage %.2f%%" % (100.0 * lit.sum() / max(used.sum(), 1)))
    mode("normal")
    nrm_img = bake_utils.bake_normal_from_hipoly(lo, hi, "asteroid%d_normal" % i,
                                                 size=TEX, extrusion=CAGE, samples=8)
    log(i, "baked normal")

    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = col_img
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = orm_img
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(t.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs[2], bsdf.inputs["Metallic"])
    bake_utils.attach_normal_map(mat, nrm_img, 1.0)
    if emi_img is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = emi_img
        nt.links.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0

    bpy.data.objects.remove(hi, do_unlink=True)
    rocks.append(lo)
    P = get_co(lo.data)
    log(i, "done: tris %d radius %.3f" % (len(lo.data.polygons), np.linalg.norm(P, axis=1).max()))

# ---- Export: four nodes at the origin, each mesh centred on its own origin ----
bpy.ops.object.select_all(action="DESELECT")
for o in rocks:
    o.select_set(True)
out = os.environ.get("ASTEROIDS_OUT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "asteroids.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True)
log("wrote", out)
