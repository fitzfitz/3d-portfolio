# Phobos and Deimos, built to NASA PDS shape models (real-solar-system spec
# §5.3, Task 14).
#   $BLENDER --background --python scripts/blender/gen_mars_moons.py
#   (MARS_MOONS_OUT=<dir> writes the two GLBs there instead of assets-src/)
#
# Source: P. C. Thomas's numerical shape models in the NASA Planetary Data
# System, Small Bodies Node, data set EAR-A-5-DDR-SHAPE-MODELS-V2.1 (Small
# Body Shape Models V2.1, C. Neese ed., 2010): "M1 PHOBOS SHAPE MODEL"
# (SHAPE-M1PHOBOS-200202; Viking Orbiter images, Thomas 1993; a radius every
# 2 deg of latitude and west longitude) and the M2 Deimos model (5 deg grid). NASA-funded PDS archive data; the labels state no use
# constraint and no copyright. URL and SHA-256 pinned in SOURCES below; the
# tables are fetched into assets-src/nasa-src/ (ignored there, like the maps'
# sources) and checked against the pin before use.
#
# Built here, seeded (SEED): the shape model gives the body (Stickney and the
# other large craters are in it); the seeded part adds what a 2 deg grid
# cannot carry: small craters (power-law sizes), Phobos's groove families
# and pit chains, regolith grain, and the albedo pattern (Phobos's "red" and
# "blue" units, the blue around Stickney; Deimos's smooth regolith and bright
# downslope streaks). Every random choice comes from numpy RandomState(SEED)
# and Cycles' seed.
#
# Game contract (SolarMoons.tsx, tests/assetContracts.test.ts):
#   node / mesh    Phobos / Deimos, one primitive, one material PhobosBaked /
#                  DeimosBaked (metallic 0, roughness 0.95)
#   frame          +X (glTF) at 0 deg longitude, the sub-Mars point; +Y the
#                  north pole (the orbit normal); +Z 90 deg W, the leading
#                  side. The origin is the shape model's centre.
#   unit           half the NSSDC mean diameter (Phobos 11.25 km, Deimos
#                  6.2 km), so the game scales the mesh by the moon's size;
#                  the tips reach MOON_SHAPE_REACH (src/data/solarMoons.ts)
#   tris           <= 1,500 each (icosphere level 4, 1,280)
#   maps           baseColor (colour x AO) + tangent normal, 1024^2, baked
#                  from a ~330k-tri sculpt; baseColorFactor calibrated so the
#                  texel median x factor = 0.177 x the geometric albedo
#                  (Phobos 0.07, Deimos 0.08; NSSDC), the scene's rule.
import bpy
import hashlib
import math
import os
import sys
import time
import urllib.request

import numpy as np
from mathutils import kdtree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from surface_lib import Perlin, crater_height, fbm, smoothstep  # noqa: E402

SEED = 20261020
TEX = 1024
HI_SUBDIV = 8      # 327,680 tris (Blender: 20 x 4^(n-1)): the sculpt the maps are baked from
LO_SUBDIV = 4      # 1,280 tris: what ships
ALBEDO_SCALE = 0.177
T0 = time.time()

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC_DIR = os.path.join(ROOT, "assets-src", "nasa-src")
OUT_DIR = os.environ.get("MARS_MOONS_OUT") or os.path.join(ROOT, "assets-src")

BASE = "https://sbnarchive.psi.edu/pds3/non_mission/EAR_A_5_DDR_SHAPE_MODELS_V2_1/data/"
SOURCES = {
    "phobos": {"url": BASE + "m1phobos.tab", "sha256": "e19d7f585d710747fa4350c078c558003a7e2122162e908d5fdd33b1970f0b1b",
               "step": 2.0, "diameter_km": 22.5, "albedo": 0.07},
    "deimos": {"url": BASE + "m2deimos.tab", "sha256": "9a4dbc132c7546acb2ef26a386d306f155519f0988c8052acb2276ddeb7ca2fd",
               "step": 5.0, "diameter_km": 12.4, "albedo": 0.08},
}


def log(*a):
    print(f"[mars-moons {time.time() - T0:6.1f}s]", *a, flush=True)


# ------------------------------------------------------------ the shape model
def fetch(name):
    s = SOURCES[name]
    path = os.path.join(SRC_DIR, os.path.basename(s["url"]))
    if not os.path.exists(path):
        os.makedirs(SRC_DIR, exist_ok=True)
        log("fetching", s["url"])
        # The archive refuses Python's default user agent.
        req = urllib.request.Request(s["url"], headers={"User-Agent": "curl/8"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        with open(path, "wb") as f:
            f.write(data)
    with open(path, "rb") as f:
        data = f.read()
    got = hashlib.sha256(data).hexdigest()
    if got != s["sha256"]:
        raise SystemExit(f"{path}: sha256 {got} is not the pinned {s['sha256']}")
    return data.decode("ascii")


def radius_grid(name):
    """(lat rows south to north) x (west longitude 0..360) radii in km."""
    step = SOURCES[name]["step"]
    rows = [tuple(map(float, ln.split())) for ln in fetch(name).splitlines() if ln.strip()]
    nlat, nlon = int(round(180 / step)) + 1, int(round(360 / step)) + 1
    R = np.zeros((nlat, nlon))
    for la, lo, r in rows:
        R[int(round((la + 90) / step)), int(round(lo / step))] = r
    assert (R > 0).all(), f"{name}: grid has holes"
    return R, step


def radius_at(R, step, d):
    """Bilinear radius (km) of the grid in unit directions d (n, 3): x = lon 0, y = lon 90 E, z = north.
    The tables' longitudes are west-positive (Thomas's convention): Stickney,
    at 1 S 49 W, is the deep basin at table longitude ~50, not ~310."""
    lat = np.degrees(np.arcsin(np.clip(d[:, 2], -1, 1)))
    lon = np.degrees(-np.arctan2(d[:, 1], d[:, 0])) % 360.0
    fi, fj = (lat + 90) / step, lon / step
    i0 = np.clip(np.floor(fi).astype(int), 0, R.shape[0] - 2)
    j0 = np.clip(np.floor(fj).astype(int), 0, R.shape[1] - 2)
    ti, tj = fi - i0, fj - j0
    return ((R[i0, j0] * (1 - tj) + R[i0, j0 + 1] * tj) * (1 - ti)
            + (R[i0 + 1, j0] * (1 - tj) + R[i0 + 1, j0 + 1] * tj) * ti)


# ----------------------------------------------------------- mesh helpers
def ico(name, subdiv):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=1.0)
    ob = bpy.context.object
    ob.name = name
    ob.data.name = name
    return ob


def get_co(me):
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def set_co(me, co):
    me.vertices.foreach_set("co", co.astype(np.float32).ravel())
    me.update()


def get_edges(me):
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", e)
    return e.reshape(-1, 2)


def neighbour_mean(vals, E, nv):
    deg = np.bincount(E[:, 0], minlength=nv) + np.bincount(E[:, 1], minlength=nv)
    s = np.bincount(E[:, 0], weights=vals[E[:, 1]], minlength=nv) + np.bincount(E[:, 1], weights=vals[E[:, 0]], minlength=nv)
    return s / np.maximum(deg, 1)


def vnormals(me):
    a = np.empty(len(me.vertices) * 3)
    me.vertex_normals.foreach_get("vector", a)
    return a.reshape(-1, 3)


# ------------------------------------------------------------- the sculpt
def sculpt(name, rng, noise):
    """Hi-poly in km: the shape model's radius, smoothed to the grid's own
    resolution, plus seeded craters, grooves and grain. Returns the object,
    its unit directions and the radius field."""
    R, step = radius_grid(name)
    hi = ico(name + "_hi", HI_SUBDIV)
    me = hi.data
    d = get_co(me)
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    nv = len(d)
    E = get_edges(me)
    r = radius_at(R, step, d)
    # The bilinear grid has creases along its rows and columns; relax them
    # (each pass spreads ~one hi-poly edge, ~0.1 km on Phobos).
    for _ in range(12 if step > 2 else 6):
        r = 0.5 * r + 0.5 * neighbour_mean(r, E, nv)
    base = r.copy()
    mean_r = SOURCES[name]["diameter_km"] / 2
    p = d * r[:, None]

    kd = kdtree.KDTree(nv)
    for i, v in enumerate(p):
        kd.insert(v.tolist(), i)
    kd.balance()

    # Small craters, power law, largest first. Deimos's are shallower and
    # half-buried: its regolith is thick and smooths everything.
    deimos = name == "deimos"
    n, rmin, rmax = (520, 0.07, 0.9) if deimos else (900, 0.08, 1.4)
    u = rng.uniform(size=n)
    a_, b_ = rmin ** -1.2, rmax ** -1.2
    radii = np.sort((a_ + u * (b_ - a_)) ** (1 / -1.2))[::-1]
    dh = np.zeros(nv)
    fresh = np.zeros(nv)
    for cr in radii:
        c = rng.normal(size=3)
        c /= np.linalg.norm(c)
        centre = c * radius_at(R, step, c[None, :])[0]
        depth = cr * (0.10 if deimos else 0.19) * rng.uniform(0.6, 1.1)
        rim = cr * (0.015 if deimos else 0.04)
        hits = kd.find_range(centre.tolist(), cr * 2.4)
        if not hits:
            continue
        js = np.array([h[1] for h in hits])
        x = np.array([h[2] for h in hits]) / cr
        taper = 1.0 - smoothstep(0.7, 0.97, x / 2.4)
        dh[js] += crater_height(x, depth, rim) * taper
        if cr < 0.3:
            fresh[js] = np.maximum(fresh[js], np.clip(1.0 - x / 1.15, 0, 1))
    log(name, "craters", n)

    grooves = np.zeros(nv)
    if not deimos:
        # Phobos's grooves: three families of parallel troughs, broken into
        # pit chains, faint on the trailing side (they centre on the leading
        # apex, 90 W = -y, and fade toward 90 E).
        lead = smoothstep(-0.6, 0.6, -d[:, 1])
        for k in range(3):
            # The first family runs nearly parallel to the equator (normals
            # near the pole); the other two are oblique.
            if k == 0:
                g = np.array([rng.uniform(-0.25, 0.25), rng.uniform(-0.35, 0.35), 1.0])
            else:
                g = np.array([rng.normal(), rng.normal(), rng.normal() * 0.4 + 1.0])
            g /= np.linalg.norm(g)
            spacing = rng.uniform(0.55, 1.0)
            width = spacing * rng.uniform(0.16, 0.24)
            s = (p @ g) / spacing
            f = np.abs(s - np.round(s)) * spacing
            along = p @ np.cross(g, [0.3, 0.2, 0.93])
            pits = 0.55 + 0.45 * np.cos(along * (2 * math.pi / (width * 3.2)) + rng.uniform(0, 6.28))
            seg = smoothstep(-0.05, 0.25, fbm(noise, p * 0.18, 1.0, 3) + 0.05 * k)
            grooves = np.maximum(grooves, (1 - smoothstep(0, width, f)) * pits * seg * (0.4 + 0.6 * lead) * rng.uniform(0.035, 0.06))
        log(name, "grooves")

    grain = 0.012 * fbm(noise, p * 1.7, 1.0, 4) + 0.005 * fbm(noise, p * 6.0, 1.0, 2)
    r = base + dh - grooves + grain * mean_r / 11.25
    set_co(me, d * r[:, None])
    me.shade_smooth()
    return hi, d, base, r, fresh, grooves, E


def colours(name, hi, d, base, r, fresh, grooves, E, noise):
    """Linear albedo per vertex x AO; returns the colours (before calibration)."""
    me = hi.data
    p = d * r[:, None]
    nrm = vnormals(me)
    slope = 1.0 - np.abs(np.sum(nrm * d, 1))
    mott = fbm(noise, p * 0.35, 1.0, 4)
    if name == "phobos":
        # Red unit (most of Phobos) and blue unit (around Stickney, ~1 S 49 W,
        # and the leading side): spectra from Mars Express / MRO CRISM.
        stickney = np.array([math.cos(math.radians(-1)) * math.cos(math.radians(-49)),
                             math.cos(math.radians(-1)) * math.sin(math.radians(-49)), math.sin(math.radians(-1))])
        blue = smoothstep(0.55, 0.9, d @ stickney) * 0.8 + 0.25 * smoothstep(0.2, 0.8, -d[:, 1])
        blue = np.clip(blue + 0.15 * mott, 0, 1)
        red = np.array([0.215, 0.185, 0.160])
        bl = np.array([0.205, 0.200, 0.200])
        col = red + (bl - red) * blue[:, None]
        col = col * (0.88 + 0.24 * smoothstep(-0.5, 0.5, mott))[:, None]
        col = col * (1.0 + 0.25 * fresh)[:, None]           # fresh crater interiors brighter
        col = col * (1.0 - 1.8 * grooves)[:, None]          # groove floors catch dust shadow
    else:
        # Deimos: smooth, slightly redder regolith; bright streaks where it
        # slides down crater walls and ridges.
        reg = np.array([0.215, 0.190, 0.165])
        col = reg * (0.92 + 0.16 * smoothstep(-0.5, 0.5, mott))[:, None]
        streak = smoothstep(0.18, 0.45, slope) * smoothstep(-0.1, 0.4, fbm(noise, p * np.array([0.6, 0.6, 2.2]), 1.0, 3))
        col = col * (1.0 + 0.35 * streak + 0.2 * fresh)[:, None]

    # AO from Cycles into a point colour attribute on the sculpt.
    sc = bpy.context.scene
    world = bpy.data.worlds.new(name + "_ao_world")
    sc.world = world
    world.light_settings.distance = 0.25 * SOURCES[name]["diameter_km"]
    ao_attr = me.color_attributes.new("ao", "FLOAT_COLOR", "POINT")
    me.color_attributes.active_color = ao_attr
    tmp = bpy.data.materials.new(name + "_ao_tmp")
    tmp.use_nodes = True
    me.materials.clear()
    me.materials.append(tmp)
    sc.cycles.samples = 64
    bpy.ops.object.select_all(action="DESELECT")
    hi.select_set(True)
    bpy.context.view_layer.objects.active = hi
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS", use_clear=True)
    ao = np.empty(len(me.vertices) * 4)
    me.color_attributes["ao"].data.foreach_get("color", ao)
    ao = ao.reshape(-1, 4)[:, 0]
    col = col * (0.35 + 0.65 * np.clip(ao, 0, 1) ** 1.2)[:, None]
    log(name, "ao mean", float(ao.mean()))
    return np.clip(col, 0, 1)


def put_colours(me, col):
    a = me.color_attributes.new("col", "FLOAT_COLOR", "POINT")
    rgba = np.concatenate([col, np.ones((len(col), 1))], 1)
    a.data.foreach_set("color", rgba.astype(np.float32).ravel())
    src = bpy.data.materials.new(me.name + "_bake_src")
    src.use_nodes = True
    nt = src.node_tree
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "col"
    nt.links.new(attr.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    me.materials.clear()
    me.materials.append(src)


def luminance(c):
    return 0.2126 * c[:, 0] + 0.7152 * c[:, 1] + 0.0722 * c[:, 2]


def surface_median(lo, img):
    """The baked map's linear-luminance median over the surface: texels at
    four points of every triangle, weighted by its area (as
    tests/assetContracts.test.ts measures the shipped file)."""
    px = np.array(img.pixels[:]).reshape(img.size[1], img.size[0], 4)[..., :3]
    px = np.where(px <= 0.04045, px / 12.92, ((px + 0.055) / 1.055) ** 2.4)  # byte images read sRGB-encoded
    me = lo.data
    me.calc_loop_triangles()
    uvl = me.uv_layers.active.data
    co = get_co(me)
    lum, wts = [], []
    for t in me.loop_triangles:
        P = co[list(t.vertices)]
        T = np.array([uvl[li].uv[:] for li in t.loops])
        area = 0.5 * np.linalg.norm(np.cross(P[1] - P[0], P[2] - P[0]))
        for a, b in ((1 / 3, 1 / 3), (0.6, 0.2), (0.2, 0.6), (0.2, 0.2)):
            u, v = T[0] + a * (T[1] - T[0]) + b * (T[2] - T[0])
            x = min(img.size[0] - 1, max(0, int(u * img.size[0])))
            y = min(img.size[1] - 1, max(0, int(v * img.size[1])))
            lum.append(float(luminance(px[y, x][None, :])[0]))
            wts.append(area)
    lum, wts = np.array(lum), np.array(wts)
    o = np.argsort(lum)
    cum = np.cumsum(wts[o])
    return float(lum[o][np.searchsorted(cum, cum[-1] / 2)])


# ------------------------------------------------------------- one moon
def build(name):
    log("building", name)
    rng = np.random.RandomState(SEED + (0 if name == "phobos" else 1))
    noise = Perlin(SEED + (10 if name == "phobos" else 11))
    hi, d, base, r, fresh, grooves, E = sculpt(name, rng, noise)
    col = colours(name, hi, d, base, r, fresh, grooves, E, noise)
    put_colours(hi.data, col)

    # The shipped mesh: icosphere level 3 on the relaxed shape-model radius.
    lo = ico(name.capitalize(), LO_SUBDIV)
    ld = get_co(lo.data)
    ld /= np.linalg.norm(ld, axis=1, keepdims=True)
    # The relaxed radius at the low vertices: the sculpt's base at the same directions.
    hd = d
    kd = kdtree.KDTree(len(hd))
    for i, v in enumerate(hd):
        kd.insert(v.tolist(), i)
    kd.balance()
    lr = np.array([base[kd.find(v.tolist())[1]] for v in ld])
    set_co(lo.data, ld * lr[:, None])
    lo.data.shade_smooth()

    bpy.ops.object.select_all(action="DESELECT")
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")

    mat = bpy.data.materials.new(name.capitalize() + "Baked")
    mat.use_nodes = True
    mnt = mat.node_tree
    bsdf = mnt.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.95
    lo.data.materials.clear()
    lo.data.materials.append(mat)

    sc = bpy.context.scene
    km = SOURCES[name]["diameter_km"]

    def bake(btype, noncolor, samples, **kw):
        img = bpy.data.images.new(f"{name}_{btype.lower()}", TEX, TEX, alpha=False)
        if noncolor:
            img.colorspace_settings.name = "Non-Color"
        node = mnt.nodes.new("ShaderNodeTexImage")
        node.image = img
        mnt.nodes.active = node
        sc.cycles.samples = samples
        bpy.ops.object.select_all(action="DESELECT")
        hi.select_set(True)
        lo.select_set(True)
        bpy.context.view_layer.objects.active = lo
        bpy.ops.object.bake(type=btype, use_selected_to_active=True, cage_extrusion=0.06 * km,
                            max_ray_distance=0.12 * km, margin=16, use_clear=True, **kw)
        img.pack()
        return node

    n_col = bake("DIFFUSE", False, 8, pass_filter={"COLOR"})
    log(name, "baked colour")
    tex_median = surface_median(lo, n_col.image)
    n_nrm = bake("NORMAL", True, 8)
    log(name, "baked normal")
    nmap = mnt.nodes.new("ShaderNodeNormalMap")
    mnt.links.new(n_nrm.outputs["Color"], nmap.inputs["Color"])
    mnt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    # The scene's albedo rule: texel median x factor = 0.177 x geometric
    # albedo. The glTF exporter writes a Multiply of the texture by a constant
    # colour as baseColorFactor.
    k = ALBEDO_SCALE * SOURCES[name]["albedo"] / tex_median
    mix = mnt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mnt.links.new(n_col.outputs["Color"], mix.inputs[6])
    mix.inputs[7].default_value = (k, k, k, 1.0)
    mnt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    log(name, "texel median", tex_median, "factor", k)

    bpy.data.objects.remove(hi, do_unlink=True)
    # km -> the game's unit, half the mean diameter.
    s = 2.0 / km
    lo.scale = (s, s, s)
    bpy.ops.object.select_all(action="DESELECT")
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    reach = float(np.linalg.norm(get_co(lo.data), axis=1).max())
    log(name, "tris", len(lo.data.polygons), "reach", reach)
    out = os.path.join(OUT_DIR, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True)
    log("wrote", out)
    bpy.data.objects.remove(lo, do_unlink=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.seed = SEED
os.makedirs(OUT_DIR, exist_ok=True)
for moon_name in ("phobos", "deimos"):
    build(moon_name)
