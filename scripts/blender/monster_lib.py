# Shared blockout kit for the space monsters (gen_saucer.py, gen_tardigrade.py).
#
# Geometry is authored in glTF space (+Y up, the model's forward +Z) with
# bmesh only (no add-ons) and turned into Blender space (+Z up, forward -Y)
# when each part becomes an object, so the exporter's +Y-up conversion hands
# back the authored coordinates exactly.
#
# Every part is its own named object under one root empty, with flat
# blockout materials; finish() recentres the whole model on its centre of
# mass (uniform density, closed parts), reports extents and triangles,
# exports the glb and saves the .blend. Nothing here is random: the
# generators seed their own jitter, so re-runs are byte-identical.
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GL2BL = Matrix.Rotation(math.radians(90), 4, "X")   # glTF (x, y, z) -> Blender (x, -z, y)
Y = Vector((0, 1, 0))

# blockout materials: flat tones so shapes read, nothing more. Skin is bare
# and glossy, fur matte and darker, slime near-mirror, so the owner can tell
# the zones apart before any texture exists.
GREY, LIGHT, DARK, GLASS, MID, SKIN, FUR, SLIME = range(8)
_MAT_DEFS = [
    ("Blockout_Grey", (0.42, 0.42, 0.42), 0.55, 1.0),
    ("Blockout_Light", (0.78, 0.78, 0.78), 0.45, 1.0),
    ("Blockout_Dark", (0.035, 0.035, 0.04), 0.35, 1.0),
    ("Blockout_Glass", (0.9, 0.93, 1.0), 0.05, 0.18),
    ("Blockout_Mid", (0.6, 0.6, 0.6), 0.5, 1.0),
    ("Blockout_Skin", (0.6, 0.6, 0.6), 0.18, 1.0),
    ("Blockout_Fur", (0.3, 0.3, 0.3), 0.9, 1.0),
    ("Blockout_Slime", (0.72, 0.74, 0.72), 0.03, 1.0),
]
G = Vector((0, -1, 0))   # gravity, for drooping fur and hanging drips
MATS = []


def parse_args(name):
    """`-- [--out DIR | --out=DIR] [--stage=blockout|final]` -> (out_dir, stage)."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opt = {}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--") and "=" in a:
            k, v = a[2:].split("=", 1)
            opt[k] = v
        elif a.startswith("--") and i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            opt[a[2:]] = argv[i + 1]
            i += 1
        i += 1
    out_dir = os.path.abspath(opt.get("out", os.path.join(ROOT, "assets-src")))
    stage = opt.get("stage", "blockout")   # Task 3/4 add "final" and make it the default
    if stage != "blockout":
        sys.exit(f"gen_{name}.py: --stage={stage} is not built yet (only blockout exists)")
    return out_dir, stage


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    for name, col, rough, alpha in _MAT_DEFS:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*col, 1)
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = 0.0
        if alpha < 1:
            b.inputs["Alpha"].default_value = alpha
            m.surface_render_method = "BLENDED"   # exported as alphaMode BLEND
        MATS.append(m)
    return bpy.context.scene


# --------------------------------------------------------------- frames ---
def rot_to(d, spin=0.0):
    """Rotation taking local +Y onto direction d, turned `spin` about it."""
    q = Y.rotation_difference(Vector(d).normalized())
    return q.to_matrix().to_4x4() @ Matrix.Rotation(spin, 4, "Y")


def place(origin, direction=(0, 1, 0), spin=0.0, scale=(1, 1, 1)):
    """Local frame: local +Y along `direction`, at `origin`, scaled per axis first."""
    S = Matrix.Diagonal((*scale, 1))
    return Matrix.Translation(Vector(origin)) @ rot_to(direction, spin) @ S


# --------------------------------------------------------------- curves ---
def catmull(pts, n):
    """Uniform Catmull-Rom through pts (Vectors, 2D or 3D), n samples a segment."""
    P = [pts[0] * 2 - pts[1]] + list(pts) + [pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1].copy())
    return out


def smooth_profile(pts, n=6):
    """Dense (r, y) list through the given (r, y) control points."""
    return [(max(0.0, p.x), p.y) for p in catmull([Vector(p) for p in pts], n)]


# ----------------------------------------------------------- primitives ---
def lathe(bm, prof, segs, M=None, mi=GREY, mats=None, closed=False):
    """Revolve (r, y) points about local +Y (angle 0 at local +Z). r == 0 makes a
    pole. mats[i] is the material of the band between points i and i+1.
    closed=True also joins the last point back to the first (a ring)."""
    M = M or Matrix.Identity(4)
    rings = []
    for r, y in prof:
        if r < 1e-6:
            rings.append([bm.verts.new(M @ Vector((0, y, 0)))])
        else:
            rings.append([bm.verts.new(M @ Vector((r * math.sin(2 * math.pi * k / segs), y,
                                                   r * math.cos(2 * math.pi * k / segs))))
                          for k in range(segs)])
    pairs = [(i, i + 1) for i in range(len(rings) - 1)]
    if closed:
        pairs.append((len(rings) - 1, 0))
    faces = []
    for band, (i, j) in enumerate(pairs):
        A, B = rings[i], rings[j]
        if len(A) == 1 and len(B) == 1:
            continue
        for k in range(segs):
            k1 = (k + 1) % segs
            if len(A) == 1:
                vs = (A[0], B[k1], B[k])
            elif len(B) == 1:
                vs = (A[k], A[k1], B[0])
            else:
                vs = (A[k], A[k1], B[k1], B[k])
            f = bm.faces.new(vs)
            f.material_index = mats[band] if mats else mi
            faces.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces


def ellipsoid(bm, centre, radii, segs=24, rings=14, mi=GREY, R=None):
    """Ellipsoid with the given semi-axes (local x, y, z), rotated by R (a 4x4)."""
    prof = [(math.sin(math.pi * i / rings), -math.cos(math.pi * i / rings)) for i in range(rings + 1)]
    M = Matrix.Translation(Vector(centre)) @ (R or Matrix.Identity(4)) @ Matrix.Diagonal((*radii, 1))
    return lathe(bm, prof, segs, M, mi)


def rounded_box(bm, size, M, mi=GREY, bevel=0.2):
    """Box of the given full size, its edges rounded by `bevel` x the smallest side.
    Built in its own bmesh (bevel replaces faces) and appended to bm."""
    tmp = bmesh.new()
    ret = bmesh.ops.create_cube(tmp, size=1.0)
    bmesh.ops.scale(tmp, vec=Vector(size), verts=ret["verts"])
    bmesh.ops.bevel(tmp, geom=list(tmp.edges), offset=bevel * min(size), segments=2, affect="EDGES",
                    profile=0.5)
    for f in tmp.faces:              # (after the bevel: its corner patches take material 0)
        f.material_index = mi
    tmp.transform(M)
    bmesh.ops.recalc_face_normals(tmp, faces=list(tmp.faces))
    vmap = {v: bm.verts.new(v.co) for v in tmp.verts}
    for f in tmp.faces:
        bm.faces.new([vmap[v] for v in f.verts]).material_index = f.material_index
    tmp.free()


def sweep(bm, ctrl, radius, ring=16, per_seg=8, mi=GREY, cap=4):
    """Tube through the control points (Catmull-Rom), radius(t) with t the arc
    fraction 0..1, both ends rounded with `cap` rings. Returns (faces, centreline)."""
    C = catmull([Vector(p) for p in ctrl], per_seg)
    n = len(C)
    s = [0.0]
    for i in range(1, n):
        s.append(s[-1] + (C[i] - C[i - 1]).length)
    T = [(C[min(i + 1, n - 1)] - C[max(i - 1, 0)]).normalized() for i in range(n)]
    a = Vector((0, 1, 0)) if abs(T[0].y) < 0.9 else Vector((1, 0, 0))
    N = (a - T[0] * a.dot(T[0])).normalized()
    frames = []
    for i in range(n):
        if i:
            N = T[i - 1].rotation_difference(T[i]) @ N
            N = (N - T[i] * N.dot(T[i])).normalized()
        frames.append((C[i], T[i], N, T[i].cross(N), radius(s[i] / s[-1])))
    # rounded caps: quarter-circle rings past each end, then a pole
    c0, t0, n0, b0, r0 = frames[0]
    c1, t1, n1, b1, r1 = frames[-1]
    head = [(c0 - t0 * r0 * math.sin(a), t0, n0, b0, r0 * math.cos(a))
            for a in (math.pi / 2 * j / cap for j in range(cap - 1, 0, -1))]
    tail = [(c1 + t1 * r1 * math.sin(a), t1, n1, b1, r1 * math.cos(a))
            for a in (math.pi / 2 * j / cap for j in range(1, cap))]
    rings = [[bm.verts.new(c0 - t0 * r0)]]
    for c, t, nn, b, r in head + frames + tail:
        rings.append([bm.verts.new(c + (nn * math.cos(2 * math.pi * k / ring)
                                        + b * math.sin(2 * math.pi * k / ring)) * r) for k in range(ring)])
    rings.append([bm.verts.new(c1 + t1 * r1)])
    faces = []
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        for k in range(ring):
            k1 = (k + 1) % ring
            if len(A) == 1:
                vs = (A[0], B[k1], B[k])
            elif len(B) == 1:
                vs = (A[k], A[k1], B[0])
            else:
                vs = (A[k], A[k1], B[k1], B[k])
            f = bm.faces.new(vs)
            f.material_index = mi
            faces.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces, C


def perp(v, n):
    """v with its component along unit n removed."""
    return v - n * v.dot(n)


def tuft(bm, base, n, length, radius, flow, mi=FUR, ring=5):
    """One wet clump of fur: rises out of the surface along n, then bends over
    along `flow` (already perpendicular-ish to n) and tapers to a point.
    Returns the tip."""
    n = n.normalized()
    f = perp(Vector(flow), n)
    f = f.normalized() if f.length > 1e-4 else perp(Vector((0, 0, -1)), n).normalized()
    # wet fur lies down: a short rise, then it slumps along the flow and
    # hangs its pointed tip a little (the clump's root is fat, so they mat)
    p0 = base - n * radius * 0.9
    p1 = base + n * length * 0.2 + f * length * 0.12
    p2 = p1 + (n * 0.3 + f).normalized() * length * 0.42
    p3 = p2 + (f + G * 0.5 - n * 0.1).normalized() * length * 0.38
    sweep(bm, [p0, p1, p2, p3], lambda t: radius * (1 - t) ** 0.75 + 0.005, ring=ring, per_seg=2, mi=mi, cap=2)
    return p3


def drip(bm, top, length, r, mi=SLIME, sway=(0, 0, 0)):
    """A hanging drop of slime: a thin neck from `top` down to a round bulb."""
    s = Vector(sway)
    pts = [Vector(top) + G * length * k + s * k * k for k in (0.0, 0.4, 0.75, 1.0)]
    sweep(bm, pts, lambda t: r * (0.5 + 0.3 * t) + r * 0.85 * math.exp(-((t - 0.9) / 0.13) ** 2),
          ring=8, per_seg=4, mi=mi, cap=3)


def strand(bm, pts, r_end, r_mid, mi=SLIME, beads=()):
    """A goo string through pts: thick where it clings, thin in the middle,
    optional beads (t, radius) along it."""
    def rad(t):
        r = r_mid + (r_end - r_mid) * abs(2 * t - 1) ** 2
        return r + sum(b * math.exp(-((t - tb) / 0.07) ** 2) for tb, b in beads)
    sweep(bm, pts, rad, ring=8, per_seg=5, mi=mi, cap=2)


def fang(bm, base, d, w, h, mi=LIGHT, spin=0.0):
    """A sharp six-sided tooth from `base` along d, w wide at the root, h long."""
    prof = [(0.0, -0.03), (w, -0.03), (w * 0.92, h * 0.28), (w * 0.5, h * 0.7), (w * 0.1, h * 0.96), (0.0, h)]
    lathe(bm, prof, 6, place(base, d, spin), mi)


def lid_and_brow(bm, c, r, a, gaze, heavy, mi=SKIN, cover=8.0, dip=0.0, brow=(0.03, 0.06), v_shape=False,
                 span=88.0):
    """An angry upper lid over the eye ball (centre c, radius r): a thick cap
    about axis a whose edge stops `cover` degrees short of the pupil's centre
    (the pupil looks along gaze; it is ~23 deg across, so ~10 hides its top
    half), and a heavy brow roll along the edge, thickest at the end toward
    `heavy` (or in the middle, dipped by `dip`, for a V brow), `span` degrees
    either side of the gaze."""
    a, g = Vector(a).normalized(), Vector(gaze).normalized()
    beta = math.acos(max(-1.0, min(1.0, a.dot(g)))) - math.radians(cover)
    steps = 10
    cap = [(math.sin(beta * i / steps), math.cos(beta * i / steps)) for i in range(steps + 1)]
    prof = [(1.01 * r * x, 1.01 * r * y) for x, y in cap] + [(1.13 * r * x, 1.13 * r * y) for x, y in cap[::-1]]
    lathe(bm, prof, 32, place(c, a), mi)
    u = perp(g, a).normalized()
    w = a.cross(u)
    pts = []
    for k in range(9):
        psi = math.radians(span * (k / 4 - 1))
        d = a * math.cos(beta) + (u * math.cos(psi) + w * math.sin(psi)) * math.sin(beta)
        p = c + d * (1.13 * r + brow[0] * 0.6) + a * 0.015
        if dip:
            p += (g * 0.6 - a) * dip * math.exp(-(psi / math.radians(32)) ** 2)
        pts.append(p)
    if v_shape:
        rad = lambda t: brow[1] - (brow[1] - brow[0]) * abs(2 * t - 1)  # noqa: E731
    else:
        if pts[0].dot(heavy) > pts[-1].dot(heavy):
            pts.reverse()
        rad = lambda t: brow[0] + (brow[1] - brow[0]) * t  # noqa: E731
    sweep(bm, pts, rad, ring=12, per_seg=4, mi=mi, cap=3)


def scatter(cands, spacing, rng):
    """Greedy blue-noise pick from (point, normal) candidates (seeded order)."""
    order = list(range(len(cands)))
    rng.shuffle(order)
    picked = []
    for i in order:
        p = cands[i][0]
        if all((p - q[0]).length >= spacing for q in picked):
            picked.append(cands[i])
    return picked


# -------------------------------------------------------------- objects ---
def to_object(name, bm, parent, smooth_angle=50.0):
    """bmesh in glTF space -> a Blender object under `parent`, with only the
    blockout materials it uses, shaded smooth with edges past smooth_angle sharp."""
    bm.transform(GL2BL)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    idx = [p.material_index for p in me.polygons]
    used = sorted(set(idx))
    for i in used:
        me.materials.append(MATS[i])
    remap = {g: k for k, g in enumerate(used)}
    me.polygons.foreach_set("material_index", [remap[i] for i in idx])
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    activate(ob)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle), keep_sharp_edges=True)
    return ob


def activate(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def root(name):
    ob = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def boolean_cut(target, cutter):
    """target -= cutter (exact solver; the cut faces take the cutter's material)."""
    mod = target.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.material_mode = "TRANSFER"
    mod.object = cutter
    activate(target)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    me = cutter.data
    bpy.data.objects.remove(cutter)
    bpy.data.meshes.remove(me)


# --------------------------------------------------------------- finish ---
def mesh_objects(rt):
    return sorted((o for o in rt.children_recursive if o.type == "MESH"), key=lambda o: o.name)


def centre_of_mass(objs):
    """Volume centroid (uniform density) of closed, outward-facing meshes."""
    vol, acc = 0.0, Vector()
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        co = [o.matrix_world @ v.co for v in me.vertices]
        for tri in me.loop_triangles:
            a, b, c = (co[i] for i in tri.vertices)
            v = a.dot(b.cross(c)) / 6.0
            vol += v
            acc += (a + b + c) * (v / 4.0)
    return acc / vol, vol


def gl_bounds(objs):
    """(lo, hi) in glTF space over every vertex."""
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    g = [Vector((p.x, p.z, -p.y)) for p in pts]
    lo = Vector([min(p[i] for p in g) for i in range(3)])
    hi = Vector([max(p[i] for p in g) for i in range(3)])
    return lo, hi


def finish(rt, out_dir, name, extent_range):
    objs = mesh_objects(rt)
    com, vol = centre_of_mass(objs)
    for o in objs:
        o.data.transform(Matrix.Translation(-com))
        o.data.update()
    com2, _ = centre_of_mass(objs)
    lo, hi = gl_bounds(objs)
    ext = hi - lo
    longest = max(ext)
    tris = 0
    for o in objs:
        o.data.calc_loop_triangles()
        n = len(o.data.loop_triangles)
        tris += n
        print("PART %-24s tris %6d  mats %s" % (o.name, n, [m.name for m in o.data.materials]))
    print("TRIS", tris)
    print("COM moved (Blender) %s -> residual %.2e (volume %.3f)" % (
        tuple(round(c, 4) for c in com), com2.length, vol))
    print("GLTF_BBOX x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % (lo.x, hi.x, lo.y, hi.y, lo.z, hi.z))
    print("EXTENT x %.3f y %.3f z %.3f  longest %.3f  (allowed %.1f-%.1f)" % (
        ext.x, ext.y, ext.z, longest, *extent_range))
    if not extent_range[0] <= longest <= extent_range[1]:
        raise SystemExit(f"{name}: longest extent {longest:.3f} outside {extent_range}")

    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, name + ".glb")
    bpy.ops.object.select_all(action="DESELECT")
    rt.select_set(True)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rt
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True,
                              export_yup=True, export_tangents=False, export_vertex_color="NONE",
                              export_animations=False, export_extras=False)
    print("wrote", out)
    blend = os.path.join(out_dir, name + ".blend")
    bpy.context.preferences.filepaths.save_version = 0   # no .blend1 backup
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    print("wrote", blend)
