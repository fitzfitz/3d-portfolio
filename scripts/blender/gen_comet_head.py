# Cinematic comet nucleus (original procedural work, 2026-10-10).
# 67P-class "rubber duck" body: two onion-layered lobes fused by a smooth,
# dust-filled neck, planed into mesas and cliffs, terraced, cut by collapse
# pits (sinkholes) and strewn with boulders. Sooty charcoal-brown crust with
# bright bluish exposed ice on cliff faces / pit walls, and a few faint pale-
# cyan activity vents in pit floors (emissive map) where the jets emerge.
#
# Pipeline: numpy SDF -> occupancy mesh -> voxel remesh -> SDF projection
# (hi-poly, ~250k tris) -> boulders + grit -> per-vertex colour/AO/glow ->
# decimated low-poly (~5k tris) -> Cycles selected-to-active bakes of
# base colour, emission and tangent-space normal at 1024^2.
# Deterministic: every random choice comes from the seeded generators below.
#   $BLENDER --background --python scripts/blender/gen_comet_head.py
import bpy
import math
import os
import time

import numpy as np

SEED = 67
TARGET_TRIS = 5600
TEX = 1024
T0 = time.time()


def log(*a):
    print(f"[comet {time.time() - T0:6.1f}s]", *a, flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
rng = np.random.RandomState(SEED)

# ---------------------------------------------------------------- noise ----
_GRAD = np.array(
    [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1],
     [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]],
    dtype=np.float64,
)
_PERM = np.concatenate([rng.permutation(256)] * 2).astype(np.int64)


def perlin(p):
    """Vectorised 3D gradient noise, roughly in [-1, 1]."""
    pi = np.floor(p)
    f = p - pi
    pi = pi.astype(np.int64) & 255
    u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0)
    X, Y, Z = pi[:, 0], pi[:, 1], pi[:, 2]
    P = _PERM

    def g(dx, dy, dz):
        h = P[P[P[X + dx] + Y + dy] + Z + dz] % 12
        gr = _GRAD[h]
        return gr[:, 0] * (f[:, 0] - dx) + gr[:, 1] * (f[:, 1] - dy) + gr[:, 2] * (f[:, 2] - dz)

    x00 = g(0, 0, 0) + u[:, 0] * (g(1, 0, 0) - g(0, 0, 0))
    x10 = g(0, 1, 0) + u[:, 0] * (g(1, 1, 0) - g(0, 1, 0))
    x01 = g(0, 0, 1) + u[:, 0] * (g(1, 0, 1) - g(0, 0, 1))
    x11 = g(0, 1, 1) + u[:, 0] * (g(1, 1, 1) - g(0, 1, 1))
    y0 = x00 + u[:, 1] * (x10 - x00)
    y1 = x01 + u[:, 1] * (x11 - x01)
    return y0 + u[:, 2] * (y1 - y0)


_OCT_OFF = rng.uniform(-100, 100, size=(16, 3))


def fbm(p, octaves=4, lac=2.03, gain=0.5, off=0):
    s, a, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        s = s + a * perlin(p * (lac ** o) + _OCT_OFF[(o + off) % 16])
        tot += a
        a *= gain
    return s / tot * 1.6


def ridged(p, octaves=3, off=5):
    s, a, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        s = s + a * (1.0 - np.abs(perlin(p * (2.1 ** o) + _OCT_OFF[(o + off) % 16])))
        tot += a
        a *= 0.5
    return s / tot


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def rot(ax, ay, az):
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


# ---------------------------------------------------------------- shape ----
# Big "body" lobe + smaller tilted "head" lobe (67P proportions, more drama).
LOBES = [
    dict(c=np.array([-0.40, 0.00, -0.04]), r=np.array([0.98, 0.80, 0.64]), R=rot(0.10, -0.12, 0.08)),
    dict(c=np.array([0.86, 0.10, 0.40]), r=np.array([0.60, 0.53, 0.47]), R=rot(-0.25, 0.42, 0.30)),
]


def ellip(p, L):
    q = (p - L["c"]) @ L["R"]  # world -> lobe frame
    k0 = np.linalg.norm(q / L["r"], axis=1)
    k1 = np.linalg.norm(q / (L["r"] ** 2), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def support(L, n):
    nl = L["R"].T @ n
    return math.sqrt(float(np.sum((nl * L["r"]) ** 2)))


def warp(p):
    return p + 0.09 * np.stack([fbm(p * 0.8, 2, off=0), fbm(p * 0.8, 2, off=3), fbm(p * 0.8, 2, off=6)], 1)


# Planar "mesa" cuts: big flat terraced faces bounded by cliffs (Hathor-like).
CUTS = []
_axis = LOBES[1]["c"] - LOBES[0]["c"]
_axis /= np.linalg.norm(_axis)
for li, count in ((0, 6), (1, 3)):
    L, O = LOBES[li], LOBES[1 - li]
    made = 0
    while made < count:
        n = rng.normal(size=3)
        n /= np.linalg.norm(n)
        toward = float(n @ (_axis if li == 0 else -_axis))
        if toward > 0.25:
            continue
        h = support(L, n) * rng.uniform(0.66, 0.82)
        # never slice the other lobe
        if float((O["c"] - L["c"]) @ n) + support(O, n) > h - 0.05:
            continue
        CUTS.append((L["c"].copy(), n, h))
        made += 1


def base_fields(p):
    w = warp(p)
    dA = ellip(w, LOBES[0])
    dB = ellip(w, LOBES[1])
    d = smin(dA, dB, 0.24)
    neck = np.clip(1.0 - np.abs(dA - dB) / 0.42, 0.0, 1.0) ** 2
    basin = sstep(0.10, 0.50, fbm(w * 1.25, 2, off=9))  # smooth dust plains
    return w, d, neck, basin


def sdf_nopits(p):
    w, d, neck, basin = base_fields(p)
    for c, n, h in CUTS:
        d = smax(d, (w - c) @ n - h, 0.04)
    D = 0.06 * fbm(w * 1.4, 3, off=1)
    # one long winding scarp: a plateau edge where low-freq noise crosses zero
    D = D + 0.07 * sstep(-0.05, 0.05, fbm(w * 0.7, 2, off=15))
    s = 0.032  # onion-layer terraces: flat treads, steep risers
    x = D / s
    fl = np.floor(x)
    Dt = (fl + sstep(0.62, 1.0, x - fl)) * s
    tm = sstep(-0.10, 0.25, fbm(w * 0.8, 2, off=12))
    D = D + (Dt - D) * tm
    D = D * (1.0 - 0.82 * np.maximum(neck, basin))
    return d - D


# Collapse pits / sinkholes (Seth-like), placed on the surface by ray march.
def surface_point(c, dirv):
    ts = np.linspace(0.0, 2.6, 400)
    pts = c[None, :] + ts[:, None] * dirv[None, :]
    d = sdf_nopits(pts)
    i = int(np.argmax(d > 0))
    lo_t, hi_t = ts[i - 1], ts[i]
    for _ in range(30):
        m = 0.5 * (lo_t + hi_t)
        if sdf_nopits((c + m * dirv)[None, :])[0] > 0:
            hi_t = m
        else:
            lo_t = m
    return c + 0.5 * (lo_t + hi_t) * dirv


def grad(fn, p, e=0.004):
    g = np.zeros_like(p)
    for k in range(3):
        dp = np.zeros(3)
        dp[k] = e
        g[:, k] = (fn(p + dp) - fn(p - dp)) / (2 * e)
    return g


PITS = []
_pit_spec = [0.13, 0.115, 0.10, 0.09, 0.08, 0.07, 0.065, 0.055]
for r in _pit_spec:
    for _try in range(200):
        li = 0 if rng.uniform() < 0.68 else 1
        dirv = rng.normal(size=3)
        dirv /= np.linalg.norm(dirv)
        sp = surface_point(LOBES[li]["c"], dirv)
        _, _, neck, _ = base_fields(sp[None, :])
        if neck[0] > 0.15:
            continue
        if any(np.linalg.norm(sp - q["c"]) < r + q["r"] + 0.07 for q in PITS):
            continue
        a = grad(sdf_nopits, sp[None, :])[0]
        a /= np.linalg.norm(a)
        t = np.cross(a, rng.normal(size=3))
        t /= np.linalg.norm(t)
        PITS.append(dict(c=sp, a=a, r=r, depth=r * rng.uniform(0.7, 1.15),
                         t=t, b=np.cross(a, t), ell=rng.uniform(1.15, 1.6)))
        break
VENTS = [PITS[i] for i in (1, 2, 4, 6)]  # 4 active pits


def sdf(p):
    d = sdf_nopits(p)
    for q in PITS:
        near = np.nonzero(np.linalg.norm(p - q["c"], axis=1) < 2.0 * q["r"] + q["depth"] + 0.05)[0]
        if len(near) == 0:
            continue
        pn = p[near]
        v = pn - q["c"]
        h = v @ q["a"]
        rad = np.sqrt((v @ q["t"] / q["ell"]) ** 2 + (v @ q["b"]) ** 2)  # elongated
        ragged = 1.0 + 0.26 * fbm(pn * (1.1 / q["r"]), 3, off=10)
        reff = q["r"] * ragged * (1.0 - 0.30 * np.clip(-h / q["depth"], 0.0, 1.0))
        cyl = np.maximum(rad - reff, -(h + q["depth"]))
        d[near] = smax(d[near], -cyl, 0.014)
    return d


log(f"{len(CUTS)} cuts, {len(PITS)} pits, {len(VENTS)} vents")

# ------------------------------------------------ occupancy -> base mesh ----
H = 0.022
lo_b = np.array([-1.75, -1.25, -1.15])
hi_b = np.array([1.75, 1.25, 1.35])
n = np.ceil((hi_b - lo_b) / H).astype(int)
gx, gy, gz = [lo_b[k] + (np.arange(n[k]) + 0.5) * H for k in range(3)]
G = np.stack(np.meshgrid(gx, gy, gz, indexing="ij"), -1).reshape(-1, 3)
occ = np.zeros(len(G), dtype=bool)
for s0 in range(0, len(G), 400000):
    occ[s0:s0 + 400000] = sdf(G[s0:s0 + 400000]) < 0
occ = occ.reshape(n)
occ = np.pad(occ, 1)  # empty border
nx, ny, nz = occ.shape
log("occupancy", occ.sum(), "of", occ.size)


def cid(i, j, k):
    return (i * (ny + 1) + j) * (nz + 1) + k


quads = []
for ax in range(3):
    a = occ
    b = np.roll(occ, -1, axis=ax)
    for sign, mask in ((1, a & ~b), (-1, ~a & b)):
        I, J, K = np.nonzero(mask)
        if ax == 0:
            I = I + 1
            c = [cid(I, J, K), cid(I, J + 1, K), cid(I, J + 1, K + 1), cid(I, J, K + 1)]
        elif ax == 1:
            J = J + 1
            c = [cid(I, J, K), cid(I, J, K + 1), cid(I + 1, J, K + 1), cid(I + 1, J, K)]
        else:
            K = K + 1
            c = [cid(I, J, K), cid(I + 1, J, K), cid(I + 1, J + 1, K), cid(I, J + 1, K)]
        q = np.stack(c, 1)
        if sign < 0:
            q = q[:, ::-1]
        quads.append(q)
quads = np.concatenate(quads)
uniq, inv = np.unique(quads, return_inverse=True)
quads = inv.reshape(-1, 4)
ci = uniq // ((ny + 1) * (nz + 1))
cj = (uniq // (nz + 1)) % (ny + 1)
ck = uniq % (nz + 1)
verts = lo_b[None, :] + (np.stack([ci, cj, ck], 1) - 1) * H

me = bpy.data.meshes.new("CometHead")
me.from_pydata(verts.tolist(), [], quads.tolist())
me.update()
head = bpy.data.objects.new("CometHead", me)
bpy.context.scene.collection.objects.link(head)
bpy.context.view_layer.objects.active = head
head.select_set(True)

rm = head.modifiers.new("remesh", "REMESH")
rm.mode = "VOXEL"
rm.voxel_size = 0.0095
sm = head.modifiers.new("relax", "SMOOTH")
sm.factor = 0.6
sm.iterations = 12
for m in list(head.modifiers):
    bpy.ops.object.modifier_apply(modifier=m.name)
log("remeshed verts", len(me.vertices))


# ----------------------------------------------- mesh helpers (numpy) ----
def get_co(mesh):
    a = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def set_co(mesh, co):
    mesh.vertices.foreach_set("co", co.astype(np.float32).ravel())
    mesh.update()


def get_vnormals(mesh):
    a = np.empty(len(mesh.vertices) * 3)
    mesh.vertex_normals.foreach_get("vector", a)
    return a.reshape(-1, 3)


def get_edges(mesh):
    e = np.empty(len(mesh.edges) * 2, dtype=np.int64)
    mesh.edges.foreach_get("vertices", e)
    return e.reshape(-1, 2)


def neighbour_mean(vals, E, nv):
    out = np.empty_like(vals)
    deg = np.bincount(E[:, 0], minlength=nv) + np.bincount(E[:, 1], minlength=nv)
    for k in range(vals.shape[1]):
        s = np.bincount(E[:, 0], weights=vals[E[:, 1], k], minlength=nv)
        s += np.bincount(E[:, 1], weights=vals[E[:, 0], k], minlength=nv)
        out[:, k] = s / np.maximum(deg, 1)
    return out


def project(co, iters=4):
    for _ in range(iters):
        d = sdf(co)
        g = grad(sdf, co)
        g2 = np.maximum(np.sum(g * g, 1), 1e-6)
        step = (d / g2)[:, None] * g
        ln = np.linalg.norm(step, axis=1, keepdims=True)
        step *= np.minimum(1.0, 0.05 / np.maximum(ln, 1e-9))
        co = co - step
    return co


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-9)


# --------------------------------------------- hi-poly: exact surface ----
E = get_edges(me)
nv = len(me.vertices)
co = project(get_co(me), 5)
for _ in range(3):  # tangential relax + re-project evens out sharp features
    set_co(me, co)
    nrm = get_vnormals(me)
    lap = neighbour_mean(co, E, nv) - co
    lap -= np.sum(lap * nrm, 1, keepdims=True) * nrm
    co = project(co + 0.5 * lap, 3)
set_co(me, co)
log("projected")

# Slope fields come from the boulder-free surface so ice follows cliffs,
# terrace risers and pit walls rather than ringing every rock.
nrm0 = get_vnormals(me)
ns_l = nrm0.copy()
for _ in range(50):
    ns_l = unit(neighbour_mean(ns_l, E, nv))
ns_m = ns_l.copy()
for _ in range(350):
    ns_m = unit(neighbour_mean(ns_m, E, nv))
steep_l = 1.0 - np.sum(nrm0 * ns_l, 1)
steep_m = 1.0 - np.sum(nrm0 * ns_m, 1)

# Boulders: power-law sizes, gathered in dust basins / neck and at cliff feet.
nrm = get_vnormals(me)
_, _, neck_v, basin_v = base_fields(co)
from mathutils.kdtree import KDTree

kd = KDTree(nv)
for i, v in enumerate(co):
    kd.insert(v.tolist(), i)
kd.balance()
w_place = 0.25 + 1.5 * np.maximum(neck_v, basin_v)
w_place /= w_place.sum()
disp = np.zeros(nv)
brng = np.random.RandomState(SEED + 1)
for idx in brng.choice(nv, size=320, p=w_place):
    r = 0.011 * (1.0 / (1.0 - 0.93 * brng.uniform())) ** 0.55
    r = min(r, 0.045)
    squash = brng.uniform(0.35, 0.65)
    ph = brng.uniform(0, 6.283, size=3)
    for (_, j, dist) in kd.find_range(co[idx].tolist(), r):
        dv = co[j] - co[idx]
        lumpy = 1.0 + 0.25 * math.sin(9.0 * dv[0] / r + ph[0]) * math.sin(7.0 * dv[1] / r + ph[1])
        t = min(1.0, dist / (r * lumpy))
        disp[j] = max(disp[j], r * squash * (1.0 - t * t) ** 0.7)
grit = (0.010 * (ridged(co * 7.0, 3, off=2) - 0.6) + 0.0045 * fbm(co * 22.0, 3, off=4)
        + 0.0022 * fbm(co * 55.0, 2, off=7))
roughness_amp = 1.0 - 0.6 * np.maximum(neck_v, basin_v)
co = co + nrm * (disp + grit * roughness_amp)[:, None]
set_co(me, co)
nrm = get_vnormals(me)
log("boulders + grit")

# ---------------------------------------------------- colour fields ----
w_v, _, neck_v, basin_v = base_fields(co)
dust = np.clip(np.maximum(neck_v * 1.2, basin_v * 0.85) * (1.0 - sstep(0.05, 0.2, steep_l)), 0, 1)

# AO baked by Cycles into a point colour attribute on the hi-poly
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.seed = SEED
world = bpy.data.worlds.new("bakeworld")
sc.world = world
world.light_settings.distance = 0.45
ao_attr = me.color_attributes.new("ao", "FLOAT_COLOR", "POINT")
me.color_attributes.active_color = ao_attr
tmpmat = bpy.data.materials.new("ao_tmp")
tmpmat.use_nodes = True
me.materials.append(tmpmat)
sc.cycles.samples = 96
bpy.ops.object.select_all(action="DESELECT")
head.select_set(True)
bpy.context.view_layer.objects.active = head
bpy.ops.object.bake(type="AO", target="VERTEX_COLORS", use_clear=True)
ao = np.empty(nv * 4)
me.color_attributes["ao"].data.foreach_get("color", ao)
ao = ao.reshape(-1, 4)[:, 0]
log("ao baked, mean", float(ao.mean()))

# Sooty crust: charcoal with a faint brown/red cast, mottled
mott = sstep(-0.45, 0.55, fbm(co * 3.6, 4, off=2))
crust = np.array([0.019, 0.018, 0.017]) + mott[:, None] * np.array([0.021, 0.018, 0.014])
warm = sstep(0.1, 0.6, fbm(co * 1.1, 2, off=11))[:, None]
crust = crust * (1.0 + warm * np.array([0.12, 0.03, -0.06]))
dust_col = np.array([0.064, 0.057, 0.048]) * (0.9 + 0.2 * mott[:, None])
base = crust + (dust_col - crust) * dust[:, None]

# Exposed ice on cliff faces, terrace risers and pit walls, broken up
breakup = sstep(-0.10, 0.30, fbm(co * 8.5, 3, off=13))
patch = sstep(-0.25, 0.10, fbm(co * 4.0, 3, off=13))  # blobby exposure gate
ice = sstep(0.07, 0.25, steep_m) * 1.2 + sstep(0.10, 0.30, steep_l) * 0.6
ice = ice * patch * (0.4 + 0.6 * breakup)
for q in PITS:  # pit walls + frosted rims (strongest around active vents)
    v = co - q["c"]
    h = v @ q["a"]
    rad = np.sqrt((v @ q["t"] / q["ell"]) ** 2 + (v @ q["b"]) ** 2)
    wall = (rad < q["r"] * 1.2) & (h < 0.01) & (h > -q["depth"] * 0.9)
    ice = ice + wall * 0.6 * breakup
for q in VENTS:
    v = co - q["c"]
    h = v @ q["a"]
    rad = np.sqrt((v @ q["t"] / q["ell"]) ** 2 + (v @ q["b"]) ** 2)
    side = sstep(-0.3 * q["r"], 0.6 * q["r"], v @ q["t"])  # frost on the lee side only
    rim = sstep(q["r"] * 1.8, q["r"] * 1.0, rad) * (np.abs(h) < 0.05) * side
    ice = ice + rim * 0.7 * sstep(0.0, 0.35, fbm(co * 11.0, 2, off=3))
ice = ice + 0.8 * sstep(0.46, 0.66, fbm(co * 5.5, 3, off=14)) * breakup  # a few fresh exposures
# Diffuse the thin riser/wall lines into ragged sheets, then re-threshold:
# exposures read as irregular bright patches, not pin-stripes.
ice_s = ice[:, None].copy()
for _ in range(30):
    ice_s = neighbour_mean(ice_s, E, nv)
ice = np.maximum(sstep(0.10, 0.36, ice_s[:, 0] + 0.25 * (breakup - 0.5)), 0.6 * np.clip(ice, 0, 1))
ice = ice * (0.65 + 0.35 * sstep(-0.3, 0.3, fbm(co * 18.0, 2, off=1)))  # debris-pocked
ice = np.clip(ice * (1.0 - 0.75 * dust), 0.0, 1.0)
dirty = np.array([0.15, 0.17, 0.20])
bright = np.array([0.60, 0.75, 0.95])
ice_col = dirty + (bright - dirty) * sstep(0.40, 0.92, ice)[:, None]
ice_col = ice_col * (0.72 + 0.28 * sstep(-0.6, 0.6, fbm(co * 26.0, 3, off=6)))[:, None]  # grain + soot
col = base + (ice_col - base) * sstep(0.04, 0.50, ice)[:, None]
occl = 0.30 + 0.70 * np.clip(ao, 0, 1) ** 1.3
occl = occl + (1.0 - occl) * 0.5 * ice
col = col * occl[:, None]
log("ice coverage >0.5:", float((sstep(0.08, 0.55, ice) > 0.5).mean()))

# Activity vents: tiny pale-cyan cores at the pit floors
glow = np.zeros(nv)
for q in VENTS:
    vc = q["c"] - q["a"] * q["depth"] * 0.85
    dd = np.linalg.norm(co - vc, axis=1)
    glow = np.maximum(glow, np.exp(-(dd / 0.011) ** 2) + 0.05 * np.exp(-(dd / 0.035) ** 2))
glow = np.clip(glow, 0, 1)
glow_col = glow[:, None] * np.array([0.50, 0.92, 1.0])


def put_attr(name, rgb):
    a = me.color_attributes.new(name, "FLOAT_COLOR", "POINT")
    rgba = np.concatenate([rgb, np.ones((len(rgb), 1))], 1)
    a.data.foreach_set("color", rgba.astype(np.float32).ravel())


put_attr("col", col)
put_attr("glow", glow_col)

# ------------------------------------------ normalise: centred, R = 1 ----
c0 = 0.5 * (co.min(0) + co.max(0))
co = co - c0
S_NORM = float(np.linalg.norm(co, axis=1).max())
co = co / S_NORM
set_co(me, co)
log("hi tris ~", sum(len(p.vertices) - 2 for p in me.polygons))

# Bake-source material on the hi-poly: attributes -> albedo / emission
src = bpy.data.materials.new("bake_src")
src.use_nodes = True
nt = src.node_tree
bs = nt.nodes["Principled BSDF"]
a_col = nt.nodes.new("ShaderNodeAttribute")
a_col.attribute_name = "col"
a_glow = nt.nodes.new("ShaderNodeAttribute")
a_glow.attribute_name = "glow"
nt.links.new(a_col.outputs["Color"], bs.inputs["Base Color"])
nt.links.new(a_glow.outputs["Color"], bs.inputs["Emission Color"])
bs.inputs["Emission Strength"].default_value = 1.0
me.materials.clear()
me.materials.append(src)

# ------------------------------------------------------------ low-poly ----
bpy.ops.object.select_all(action="DESELECT")
head.select_set(True)
bpy.context.view_layer.objects.active = head
bpy.ops.object.duplicate()
lo = bpy.context.view_layer.objects.active
head.name = "CometHead_hi"
head.data.name = "CometHead_hi"
lo.name = "CometHead"
lo.data.name = "CometHead"
for nm in ("ao", "col", "glow"):
    lo.data.color_attributes.remove(lo.data.color_attributes[nm])
hi_tris = sum(len(p.vertices) - 2 for p in head.data.polygons)
dec = lo.modifiers.new("dec", "DECIMATE")
dec.decimate_type = "COLLAPSE"
dec.ratio = TARGET_TRIS / hi_tris
dec.use_collapse_triangulate = True
tri = lo.modifiers.new("tri", "TRIANGULATE")
for m in list(lo.modifiers):
    bpy.ops.object.modifier_apply(modifier=m.name)
lo.data.validate()
lo.data.shade_smooth()
log("lo tris", len(lo.data.polygons))

# UVs: ~12 large disc-like charts (6 cube-direction charts per lobe), seams
# on chart borders, angle-based unwrap -> few islands, few seams, good texel use.
import bmesh

bm = bmesh.new()
bm.from_mesh(lo.data)
bm.faces.ensure_lookup_table()
fc = np.array([f.calc_center_median() for f in bm.faces]) * S_NORM + c0
wf = warp(fc)
lobe_id = (ellip(wf, LOBES[1]) < ellip(wf, LOBES[0])).astype(int)
label = np.zeros(len(fc), dtype=int)
for li, L in enumerate(LOBES):
    q = ((fc - L["c"]) @ L["R"]) / L["r"]
    ax = np.argmax(np.abs(q), 1)
    sg = (q[np.arange(len(q)), ax] > 0).astype(int)
    m = lobe_id == li
    label[m] = li * 6 + ax[m] * 2 + sg[m]
nbrs = [[g.index for e in f.edges for g in e.link_faces if g is not f] for f in bm.faces]
for _ in range(4):  # majority filter: clean jagged borders
    new = label.copy()
    for i, nb in enumerate(nbrs):
        vals, cnt = np.unique(label[nb], return_counts=True)
        if cnt.max() >= 2 and vals[cnt.argmax()] != label[i]:
            new[i] = vals[cnt.argmax()]
    label = new
for _ in range(3):  # absorb tiny fragments into a neighbouring chart
    seen = np.zeros(len(label), bool)
    for i0 in range(len(label)):
        if seen[i0]:
            continue
        comp, stack = [], [i0]
        seen[i0] = True
        while stack:
            i = stack.pop()
            comp.append(i)
            for j in nbrs[i]:
                if not seen[j] and label[j] == label[i0]:
                    seen[j] = True
                    stack.append(j)
        if len(comp) < 40:
            outside = [label[j] for i in comp for j in nbrs[i] if label[j] != label[i0]]
            if outside:
                vals, cnt = np.unique(outside, return_counts=True)
                label[comp] = vals[cnt.argmax()]
for e in bm.edges:
    lf = e.link_faces
    e.seam = bool(len(lf) == 2 and label[lf[0].index] != label[lf[1].index])
bm.to_mesh(lo.data)
bm.free()
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.004)
bpy.ops.uv.pack_islands(rotate=True, margin=0.006, shape_method="CONCAVE")
bpy.ops.object.mode_set(mode="OBJECT")
log("uv charts", len(np.unique(label)))

mat = bpy.data.materials.new("CometBaked")
mat.use_nodes = True
mnt = mat.node_tree
mbs = mnt.nodes["Principled BSDF"]
mbs.inputs["Metallic"].default_value = 0.0
mbs.inputs["Roughness"].default_value = 0.88
lo.data.materials.clear()
lo.data.materials.append(mat)


def new_img(name, noncolor=False):
    img = bpy.data.images.new(name, TEX, TEX, alpha=False)
    if noncolor:
        img.colorspace_settings.name = "Non-Color"
    return img


def bake(btype, img, samples, **kw):
    node = mnt.nodes.new("ShaderNodeTexImage")
    node.image = img
    mnt.nodes.active = node
    sc.cycles.samples = samples
    bpy.ops.object.select_all(action="DESELECT")
    head.select_set(True)
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.bake(
        type=btype, use_selected_to_active=True, cage_extrusion=0.03,
        max_ray_distance=0.08, margin=12, use_clear=True, **kw,
    )
    img.pack()
    return node


col_img = new_img("comet_color")
n_col = bake("DIFFUSE", col_img, 8, pass_filter={"COLOR"})
log("baked colour")
emi_img = new_img("comet_emissive")
n_emi = bake("EMIT", emi_img, 8)
log("baked emissive")
nrm_img = new_img("comet_normal", noncolor=True)
n_nrm = bake("NORMAL", nrm_img, 16)
log("baked normal")

mnt.links.new(n_col.outputs["Color"], mbs.inputs["Base Color"])
mnt.links.new(n_emi.outputs["Color"], mbs.inputs["Emission Color"])
mbs.inputs["Emission Strength"].default_value = 1.0
nmap = mnt.nodes.new("ShaderNodeNormalMap")
mnt.links.new(n_nrm.outputs["Color"], nmap.inputs["Color"])
mnt.links.new(nmap.outputs["Normal"], mbs.inputs["Normal"])

bpy.data.objects.remove(head, do_unlink=True)
bpy.ops.object.select_all(action="DESELECT")
lo.select_set(True)
bpy.context.view_layer.objects.active = lo
out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "comet_head.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True)
log("wrote", out, "tris", len(lo.data.polygons))
