# Message in a bottle: a CC0 glass bottle with a rolled note and a cork.
#   $BLENDER --background --python scripts/blender/gen_bottle.py [-- --src DIR]
# Output: assets-src/bottle.glb (raw; optimized by npm run assets:optimize)
#
# Source (sourced, not generated; CLAUDE.md asset rule): the "burgundy" bottle
# of Poly Haven's "Wine Bottles 01" by Rico Cilliers, CC0 1.0
# (https://polyhaven.com/a/wine_bottles_01, licence https://polyhaven.com/license).
# Its glTF (1k variant, mesh only, no textures) is kept in
# assets-src/polyhaven-src/wine_bottles_01/ and pinned by SHA-256 below.
# Adaptation, all in this script:
#   - keep only the bottle's glass (inner and outer walls, the punt, the lip
#     bead); drop the wine, the foil seal and the label;
#   - retessellate it for the game: its own cross-section, read off one
#     meridian of the 24-segment source lathe, thinned and lathed at 16
#     segments (3,408 -> ~1,000 triangles; a collapse decimate ate the body);
#   - scale to LENGTH overall (cork included) and recentre;
#   - add a cork (tapered, pushed into the neck, standing proud of the lip)
#     and a rolled parchment note (a slightly tilted scroll with an
#     overlapping outer edge, tied with twine), both new geometry;
#   - new materials: sea-green glass and a 256² parchment/cork map
#     (numpy, seeded).
# No add-ons, no bake, no unwrap: re-running reproduces the file byte for byte.
#
# CONTRACT with the bottle scene code (Task 5) and tests/assetContracts.test.ts
# (glTF space, +Y up, drawn at scale 1):
#   two nodes, each one mesh with one primitive, so instancing costs 2 draw calls:
#     "Bottle_Contents": the note and the cork, material "BottleContents",
#       OPAQUE, a 256² baseColor map (parchment top half, cork bottom half),
#       metallic 0, roughness 0.85, no emissive, no vertex colours;
#     "Bottle_Glass": the glass, material "BottleGlass", alphaMode BLEND,
#       sea-green baseColorFactor (0.30, 0.55, 0.42) with alpha 0.28 (dark
#       enough that the note reads through it), metallic 0, roughness 0.12,
#       no maps, no emissive in the file.
#   both single-sided (the glass shows its near outer wall and far inner
#     wall); no extensions on either material (three builds
#     MeshStandardMaterial); no tangents; the glass has no UVs.
#   2 draw calls instanced: the opaque contents, then the blended glass.
#   COLOR_0 on Bottle_Glass only is the GLINT ZONE, a mask, never a colour:
#     R = glint weight: 1 on the lip bead at the mouth (the top 4% of the
#         glass, outside and in) and on one ring round the shoulder; 0 on
#         the rings cut just outside both, so each fades across one narrow
#         strip; 0 elsewhere. G = B = 0.
#     The game switches the glass material's vertexColors off and adds
#     emissive = glintColour * intensity * R (it drives the pulse/twinkle), so
#     a bottle reads as a tiny highlight in dark space. Loaded raw (vertex
#     colours on), the glass looks dark except at the glint: that is expected.
#   the bottle's axis is +Y (neck and cork up); the origin is the centre of
#     the bounding box; longest extent LENGTH (0.6-0.8 u; the ship is ~2.4);
#     <= 1,500 triangles in all.
import bpy
import bmesh
import hashlib
import math
import os
import sys

import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets-src", "bottle.glb")
SRC_DIR = os.path.join(ROOT, "assets-src", "polyhaven-src", "wine_bottles_01")
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--src" in argv:
    SRC_DIR = os.path.abspath(argv[argv.index("--src") + 1])
SRC_GLTF = os.path.join(SRC_DIR, "wine_bottles_01_1k.gltf")
PINS = {
    "wine_bottles_01_1k.gltf": "70a8a5eabeac24cf298774aca78bbcf39145ca6bf5ebdf2f296edab73fbce039",
    "wine_bottles_01.bin": "a520b717c7f9d15b7f114d1be5f454f18b2cfd056757fb4d4c5f5054de5db6d6",
}
SRC_OBJECT = "wine_bottles_01_burgundy"
SRC_GLASS = "wine_bottles_01_glass_clear"

LENGTH = 0.70        # overall, cork included
TEX = 256
RNG = np.random.default_rng(20261026)

for name, want in PINS.items():
    with open(os.path.join(SRC_DIR, name), "rb") as f:
        got = hashlib.sha256(f.read()).hexdigest()
    if got != want:
        raise SystemExit(f"{name}: sha256 {got} != pinned {want}")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC_GLTF)

# ---------------------------------------------------------------- the glass
# The source glass is a 24-segment lathe (outer wall, punt, lip bead and inner
# wall: 3,408 triangles, six parts joined end to end along each meridian).
# A collapse decimate wrecks it (it ate the body), so instead its own
# cross-section is read off the meridian at angle 0, chained into one
# profile, thinned (Douglas-Peucker, PROFILE_TOL) and lathed again at SEGMENTS.
# The shape is the source's; only the tessellation is new.
src = bpy.data.objects[SRC_OBJECT]
gi = [m.name for m in src.data.materials].index(SRC_GLASS)
bm = bmesh.new()
bm.from_mesh(src.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != gi], context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
merid = {v for v in bm.verts
         if math.hypot(v.co.x, v.co.y) < 1e-4 or (v.co.x > 0 and abs(math.atan2(v.co.y, v.co.x)) < math.radians(0.5))}
adj = {v: [e.other_vert(v) for e in v.link_edges if e.other_vert(v) in merid] for v in merid}
assert all(len(a) <= 2 for a in adj.values()), "source meridian branches"
# the six parts' meridian paths, each walked from one end
paths, seen = [], set()
for v in sorted(merid, key=lambda v: (v.co.z, v.co.x)):
    if v in seen or len(adj[v]) != 1:
        continue
    path = [v]
    seen.add(v)
    while True:
        nxt = [w for w in adj[path[-1]] if w not in seen]
        if not nxt:
            break
        path.append(nxt[0])
        seen.add(nxt[0])
    paths.append([(math.hypot(w.co.x, w.co.y), w.co.z) for w in path])
assert len(seen) == len(merid), "a closed loop on the meridian"
# chain them end to end (the parts meet at coincident points), starting at
# the outer punt's apex: the lower of the two points on the axis
near = lambda a, b: math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-5
start = min((p_ for p_ in paths if p_[0][0] < 1e-4 or p_[-1][0] < 1e-4),
            key=lambda p_: min(q[1] for q in (p_[0], p_[-1]) if q[0] < 1e-4))
chain = start if start[0][0] < 1e-4 else start[::-1]
paths.remove(start)
while paths:
    nxt = next(p_ for p_ in paths if near(p_[0], chain[-1]) or near(p_[-1], chain[-1]))
    paths.remove(nxt)
    chain += (nxt if near(nxt[0], chain[-1]) else nxt[::-1])[1:]
assert chain[-1][0] < 1e-4, "profile does not end on the axis"
PROFILE = [(r if r > 1e-4 else 0.0, z) for r, z in chain]   # (r, z), metres
bm.free()
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
    for d in list(coll):
        coll.remove(d)

PROFILE_TOL = 0.0008    # metres, before scaling (~1.7 mm at the shipped size)
SEGMENTS = 16


def simplify(pts, tol):
    """Douglas-Peucker on a polyline of (r, z)."""
    if len(pts) < 3:
        return pts
    (ax, ay), (bx, by) = pts[0], pts[-1]
    L = math.hypot(bx - ax, by - ay) or 1e-12
    d = [abs((bx - ax) * (ay - y) - (ax - x) * (by - ay)) / L for x, y in pts[1:-1]]
    i = max(range(len(d)), key=d.__getitem__)
    if d[i] <= tol:
        return [pts[0], pts[-1]]
    return simplify(pts[:i + 2], tol)[:-1] + simplify(pts[i + 1:], tol)


PROF = simplify(PROFILE, PROFILE_TOL)
print("profile points", len(PROFILE), "->", len(PROF))
G_Z0 = min(z for _, z in PROF)
G_Z1 = max(z for _, z in PROF)
G_H = G_Z1 - G_Z0
# inner wall: the profile after the mouth (the highest point) back to the axis
top = max(range(len(PROF)), key=lambda i: PROF[i][1])
NECK_IN = min(r for r, z in PROF[top:] if z > G_Z1 - 0.004)                 # mouth bore
BODY_IN = min(r for r, z in PROF[top:] if r > 0.035)                      # body wall, inside
print(f"glass h {G_H:.4f}  neck bore {NECK_IN:.4f}  body inner {BODY_IN:.4f}")


# The glint zones get rings of their own, cut into the profile (on its own
# segments, so the shape is unchanged): without them the mask would fade
# along the long neck and shoulder strips and light the whole neck.
#   mouth: weight 1 above t = 0.96 (the lip bead, outside and in), 0 at the
#     rings cut at t = 0.94 just below it on both walls;
#   shoulder: one ring at t = 0.55 on the outer wall (weight 1) between rings
#     at 0.535 and 0.565 (weight 0): a thin highlight band.
LIP_T, LIP_EDGE_T = 0.96, 0.94
BAND_T, BAND_HALF = 0.55, 0.015


def cut(prof, t, outer):
    """Insert a point at height t on the outer (before the mouth) or inner
    wall, on the segment that crosses it; return the new profile and index."""
    z = G_Z0 + t * G_H
    top_ = max(range(len(prof)), key=lambda i: prof[i][1])
    span = range(top_) if outer else range(top_, len(prof) - 1)
    for i in (reversed(span) if outer else span):
        (r0, z0), (r1, z1) = prof[i], prof[i + 1]
        if min(z0, z1) <= z <= max(z0, z1) and z0 != z1:
            if abs(z - z0) < 1e-6:
                return prof, i
            if abs(z - z1) < 1e-6:
                return prof, i + 1
            f = (z - z0) / (z1 - z0)
            return prof[:i + 1] + [(r0 + f * (r1 - r0), z)] + prof[i + 1:], i + 1
    raise ValueError(f"no wall crosses t={t}")


for t, outer in ((LIP_EDGE_T, True), (LIP_EDGE_T, False), (BAND_T - BAND_HALF, True),
                 (BAND_T, True), (BAND_T + BAND_HALF, True)):
    PROF, _ = cut(PROF, t, outer)
top = max(range(len(PROF)), key=lambda i: PROF[i][1])
SHOULDER = cut(PROF, BAND_T, True)[1]
print("profile with glint rings", len(PROF))


def glint(i):
    """Glint weight (COLOR_0 R) of profile point i."""
    t = (PROF[i][1] - G_Z0) / G_H
    return 1.0 if t > LIP_T or i == SHOULDER else 0.0


bm = bmesh.new()
rings = []
for r, z in PROF:
    if r < 1e-5:
        rings.append([bm.verts.new((0.0, 0.0, z))])
    else:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / SEGMENTS),
                                    r * math.sin(2 * math.pi * k / SEGMENTS), z)) for k in range(SEGMENTS)])
for a, b in zip(rings, rings[1:]):
    for k in range(SEGMENTS):
        k1 = (k + 1) % SEGMENTS
        if len(a) == 1:
            bm.faces.new((a[0], b[k1], b[k]))
        elif len(b) == 1:
            bm.faces.new((a[k], a[k1], b[0]))
        else:
            bm.faces.new((a[k], a[k1], b[k1], b[k]))
bmesh.ops.triangulate(bm, faces=bm.faces[:])
me_g = bpy.data.meshes.new("Bottle_Glass")
bm.to_mesh(me_g)
bm.free()
glass = bpy.data.objects.new("Bottle_Glass", me_g)
bpy.context.collection.objects.link(glass)
GLINT = [glint(i) for i, ring_ in enumerate(rings) for _ in ring_]   # in vertex order
print("glass tris", len(me_g.polygons))


# ----------------------------------------------------------- the texture
# Top half (v 0.5..1): parchment, u around the scroll, v along it. Bottom
# half: cork, left the side (u around), right the top cap.
def smooth_noise(h, w, cells):
    g = RNG.random((cells[0] + 1, cells[1] + 1))
    ys = np.linspace(0, cells[0], h, endpoint=False)
    xs = np.linspace(0, cells[1], w, endpoint=False)
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
    return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy


img = np.zeros((TEX, TEX, 3))
H2 = TEX // 2
# parchment (rows are v, image row 0 = v 1 after the flip below)
pv = np.linspace(0, 1, H2)[:, None] * np.ones((1, TEX))          # along the scroll
mott = 0.6 * smooth_noise(H2, TEX, (4, 8)) + 0.4 * smooth_noise(H2, TEX, (12, 24))
paper = np.stack([0.93, 0.83, 0.60]) * (0.88 + 0.2 * mott)[..., None]
edge = np.clip(np.minimum(pv, 1 - pv) / 0.12, 0, 1)                # browned ends
paper *= (0.62 + 0.38 * edge ** 0.6)[..., None]
# a few lines of brown handwriting across part of the outer turn
ink = np.array([0.24, 0.15, 0.08])
for k, row in enumerate(np.linspace(0.30, 0.70, 6)):
    y = int(row * H2)
    x0 = int(TEX * (0.08 + 0.05 * RNG.random()))
    x1 = int(TEX * (0.42 + 0.10 * RNG.random()))
    gaps = RNG.random(TEX) < 0.25                       # word breaks
    for x in range(x0, x1):
        if gaps[x]:
            continue
        dy = int(round(1.2 * math.sin(x * 0.9 + k)))
        rows = slice(max(0, y + dy - 1), y + dy + 1)
        paper[rows, x] = paper[rows, x] * 0.45 + ink * 0.55
# twine round the middle
band = np.abs(pv - 0.5) < 0.035
twine = np.array([0.42, 0.22, 0.12]) * (0.8 + 0.4 * smooth_noise(H2, TEX, (2, 64)))[..., None]
paper = np.where(band[..., None], twine, paper)
img[:H2] = paper[::-1]
# cork: warm tan with dark pores
cork = np.stack([0.60, 0.43, 0.27]) * (0.85 + 0.25 * smooth_noise(H2, TEX, (8, 16)))[..., None]
pores = RNG.random((H2, TEX)) < 0.05
cork[pores] *= 0.55
img[H2:] = cork[::-1]
srgb = np.clip(img, 0, 1)
image = bpy.data.images.new("BottleContents", TEX, TEX, alpha=False)
rgba = np.concatenate([srgb, np.ones((TEX, TEX, 1))], axis=2)[::-1]   # Blender rows start at the bottom
image.pixels.foreach_set(rgba.astype(np.float32).ravel())
image.file_format = "PNG"
image.pack()

# ----------------------------------------------------------- contents
# Built in source units (metres); everything is scaled together below.
CORK_R_TOP = NECK_IN * 1.12
CORK_R_BOT = NECK_IN * 0.98
CORK_OUT = 0.014                 # proud of the lip
CORK_IN = 0.020                  # pushed into the neck
SEG = 12


def bridge(bm, uv, a, b):
    """Quads between two rings of (vert, u, v); a ring's last entry repeats its
    first vert with u = u1, so the seam gets its own UVs."""
    for i in range(len(a) - 1):
        f = bm.faces.new([a[i][0], a[i + 1][0], b[i + 1][0], b[i][0]])
        for loop, (_, u, v) in zip(f.loops, (a[i], a[i + 1], b[i + 1], b[i])):
            loop[uv].uv = (u, v)


def ring(bm, z, r, n, v, u0=0.0, u1=1.0):
    verts = [bm.verts.new((r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z)) for i in range(n)]
    return [(verts[i % n], u0 + (u1 - u0) * i / n, v) for i in range(n + 1)]


bmc = bmesh.new()
uv = bmc.loops.layers.uv.new("UVMap")
# cork side (u 0..0.6 of the bottom half; v 0.05..0.45)
zc0, zc1 = G_Z1 - CORK_IN, G_Z1 + CORK_OUT
c_lo = ring(bmc, zc0, CORK_R_BOT, SEG, 0.05, 0.0, 0.6)
c_hi = ring(bmc, zc1, CORK_R_TOP, SEG, 0.45, 0.0, 0.6)
bridge(bmc, uv, c_lo, c_hi)
# top cap with a slight dome edge: inner ring then a centre fan (u 0.65..0.95)
cap_r = CORK_R_TOP * 0.9
c_top = [bmc.verts.new((cap_r * math.cos(2 * math.pi * i / SEG), cap_r * math.sin(2 * math.pi * i / SEG), zc1 + 0.0015)) for i in range(SEG)]
centre = bmc.verts.new((0, 0, zc1 + 0.002))
cu, cv, cr = 0.80, 0.25, 0.15
for i in range(SEG):
    j = (i + 1) % SEG
    f = bmc.faces.new([c_hi[i][0], c_hi[j][0], c_top[j], c_top[i]])
    for loop, (a, r) in zip(f.loops, [(i, 1.0), (j, 1.0), (j, 0.9), (i, 0.9)]):
        t = 2 * math.pi * a / SEG
        loop[uv].uv = (cu + cr * r * math.cos(t), cv + cr * r * math.sin(t))
    f = bmc.faces.new([c_top[i], c_top[j], centre])
    for loop, (a, r) in zip(f.loops, [(i, 0.9), (j, 0.9), (None, 0)]):
        t = 2 * math.pi * (a or 0) / SEG
        loop[uv].uv = (cu + cr * r * math.cos(t), cv + cr * r * math.sin(t))
# bottom cap (hidden in the neck; a plain fan)
c_bot = bmc.verts.new((0, 0, zc0))
for i in range(SEG):
    j = (i + 1) % SEG
    f = bmc.faces.new([c_lo[j][0], c_lo[i][0], c_bot])
    for loop in f.loops:
        loop[uv].uv = (0.3, 0.1)

# the scroll: a rolled sheet, radius SR, length SL, axis tilted in X, with
# the outer edge overlapping as a lip (a slightly larger partial turn)
# It must stay inside the glass: above the punt and below the shoulder, where
# the bore narrows (checked below).
SR = BODY_IN * 0.45
SL = G_H * 0.34
TILT = math.radians(6)
z_mid = G_Z0 + G_H * 0.28
SSEG = 14
paper_faces_start = len(bmc.faces)
tube = []
for t in (0.0, 0.47, 0.53, 1.0):
    z = -SL / 2 + SL * t
    tube.append(ring(bmc, z, SR, SSEG, 0.5 + 0.5 * t, 0.0, 1.0))
for a, b in zip(tube, tube[1:]):
    bridge(bmc, uv, a, b)
# overlapping outer edge: a strip from angle 0 to 0.9 rad, a hair outside
lip = []
for t in (0.0, 1.0):
    z = -SL / 2 + SL * t
    row = []
    for i, ang in enumerate(np.linspace(0, 0.9, 4)):
        r = SR * (1.06 - 0.05 * i / 3)
        row.append((bmc.verts.new((r * math.cos(ang), r * math.sin(ang), z)), 0.02 + 0.12 * i / 3, 0.5 + 0.5 * t))
    lip.append(row)
for i in range(3):
    a, b = lip[0], lip[1]
    f = bmc.faces.new([a[i][0], a[i + 1][0], b[i + 1][0], b[i][0]])
    for loop, c in zip(f.loops, [(a[i][1], a[i][2]), (a[i + 1][1], a[i + 1][2]), (b[i + 1][1], b[i + 1][2]), (b[i][1], b[i][2])]):
        loop[uv].uv = c
# open ends show the roll: a ring of inner turn (a smaller tube end) at each end
for end, t in ((0, 0.0), (1, 1.0)):
    z = -SL / 2 + SL * t
    outer = tube[0] if end == 0 else tube[-1]
    inner = ring(bmc, z + (0.003 if end == 0 else -0.003), SR * 0.55, SSEG, 0.5 + 0.5 * t, 0.0, 1.0)
    if end == 0:
        bridge(bmc, uv, inner, outer)
    else:
        bridge(bmc, uv, outer, inner)
    # the bore of the roll, shaded by the browned end texels
    deep = ring(bmc, z + (0.03 if end == 0 else -0.03), SR * 0.45, SSEG, 0.5 + 0.5 * (0.02 if end == 0 else 0.98), 0.0, 1.0)
    if end == 0:
        bridge(bmc, uv, deep, inner)
    else:
        bridge(bmc, uv, inner, deep)
paper_verts = {v for f in list(bmc.faces)[paper_faces_start:] for v in f.verts}
rot = Matrix.Rotation(TILT, 4, "Y")
for v in paper_verts:
    v.co = rot @ v.co + Vector((BODY_IN * 0.10, 0.0, z_mid))
inner = sorted((z, r) for r, z in PROF[top:] if r > 0.02)   # the inner wall (not the punt), by height
punt_top = max(z for r, z in PROF[top:] if r < 1e-5)


def bore(z):
    """Inner radius of the glass at height z (above the punt)."""
    for (z0, r0), (z1, r1) in zip(inner, inner[1:]):
        if z0 <= z <= z1:
            return r0 + (r1 - r0) * (z - z0) / ((z1 - z0) or 1)
    return 0.0


for v in paper_verts:
    assert v.co.z > punt_top + 0.003 and math.hypot(v.co.x, v.co.y) < bore(v.co.z) - 0.002, \
        f"note pokes through the glass at {tuple(v.co)}"
me_c = bpy.data.meshes.new("Bottle_Contents")
bmc.to_mesh(me_c)
bmc.free()
contents = bpy.data.objects.new("Bottle_Contents", me_c)
bpy.context.collection.objects.link(contents)
for p in me_c.polygons:
    p.use_smooth = True

# ----------------------------------------------------------- scale, recentre
all_z = [v.co.z for v in glass.data.vertices] + [v.co.z for v in me_c.vertices]
z0, z1 = min(all_z), max(all_z)
k = LENGTH / (z1 - z0)
zc = (z0 + z1) / 2
for ob in (glass, contents):
    ob.data.transform(Matrix.Translation((0, 0, -zc)))
    ob.data.transform(Matrix.Scale(k, 4))
    ob.data.update()
print(f"scale {k:.4f}  length {(z1 - z0) * k:.4f}")

# ----------------------------------------------------------- glint mask
col = glass.data.color_attributes.new("Glint", "FLOAT_COLOR", "POINT")
for v in glass.data.vertices:
    col.data[v.index].color = (GLINT[v.index], 0.0, 0.0, 1.0)
glass.data.color_attributes.active_color = col
glass.data.color_attributes.render_color_index = 0

# smooth shading by angle (the punt, the lip bead and the cork keep their creases)
for ob in (glass, contents):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))

# ----------------------------------------------------------- materials
def principled(name):
    m = bpy.data.materials.new(name)
    return m, m.node_tree.nodes["Principled BSDF"]


m_glass, bsdf = principled("BottleGlass")
bsdf.inputs["Base Color"].default_value = (0.30, 0.55, 0.42, 1.0)
bsdf.inputs["Alpha"].default_value = 0.28
bsdf.inputs["Roughness"].default_value = 0.12
bsdf.inputs["Metallic"].default_value = 0.0
m_glass.surface_render_method = "BLENDED"
m_glass.use_backface_culling = True    # single-sided: near outer wall + far inner wall
glass.data.materials.append(m_glass)

m_c, bsdf = principled("BottleContents")
tex = m_c.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = image
tex.interpolation = "Linear"
m_c.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.85
bsdf.inputs["Metallic"].default_value = 0.0
m_c.use_backface_culling = True
contents.data.materials.append(m_c)

# ----------------------------------------------------------- export
n_tris = sum(len(p.vertices) - 2 for ob in (glass, contents) for p in ob.data.polygons)
print("triangles", n_tris)
assert n_tris <= 1500, n_tris
bpy.ops.object.select_all(action="DESELECT")
for ob in (glass, contents):
    ob.select_set(True)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, use_selection=True,
                          export_yup=True, export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                          export_tangents=False, export_image_format="AUTO")
print("wrote", OUT)
