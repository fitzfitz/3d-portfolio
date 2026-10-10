# Generates the space-jellyfish body (original procedural geometry, built vertex
# by vertex from math below; no external meshes or references).
#   $BLENDER --background --python scripts/blender/gen_creature.py
#
# Anatomy (modelled on moon / sea-nettle jellyfish silhouettes):
#   * bell        smooth dome, apex y=+0.72, two surfaces (thick mesoglea at the
#                 top, thin at the margin), open underneath, 16 scalloped lappets
#   * gonads      4 faint horseshoe loops seen through the top of the bell
#   * oral arms   4 long, twisting, ruffled ribbon "curtains" from the centre
#   * tentacles   32 hair-thin tubes from the marginal notches (2 per notch)
#
# Contract with src/components/canvas/SpaceJellyfish.tsx (custom ShaderMaterial,
# GLB material ignored): animation is driven purely by authored vertex Y
# (glTF +Y == Blender +Z here).
#   bell contraction  smoothstep(-0.3, 0.5, y)  -> everything above the rim
#   tentacle sway     below ~0.1, amplitude grows with -y -> every hanging part
#                     is densely ringed along its length so it can bend.
# Extents: x/z within +-1.0, y from about -4.2 (tips) to +0.72 (apex). The mesh
# is authored in final units with an identity object transform.
import bpy
import bmesh
import math
import os
import random

SEED = 20261010
rng = random.Random(SEED)

bpy.ops.wm.read_factory_settings(use_empty=True)

verts = []
faces = []


def add_vert(x, y, z):
    verts.append((x, y, z))
    return len(verts) - 1


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def grid(rows, closed_u, flip=False):
    """Quad faces for a rows[v][u] index grid; u wraps when closed_u."""
    for v in range(len(rows) - 1):
        a_row, b_row = rows[v], rows[v + 1]
        n = len(a_row)
        last = n if closed_u else n - 1
        for u in range(last):
            u2 = (u + 1) % n
            q = (a_row[u], a_row[u2], b_row[u2], b_row[u])
            faces.append(q[::-1] if flip else q)


# --------------------------------------------------------------------- bell
APEX = 0.72
RIM_R = 0.94
LAPPETS = 16
SEG = 128           # around the bell (multiple of LAPPETS)
RINGS = 40          # apex -> margin


def lappet(theta):
    """1 at lappet centres, 0 in the notches between them (rounded lobes)."""
    c = abs(math.cos(theta * LAPPETS / 2.0))
    return c ** 0.6


def outer_profile(t, theta):
    """t: 0 apex -> 1 margin. Returns (radius, z)."""
    a = t * math.pi / 2.0
    # hemispherical-ish dome, slightly flattened on top and flared at the margin
    r = RIM_R * math.sin(a) ** 0.85
    z = APEX * math.cos(a) ** 1.0
    # margin turns gently inward/down like a relaxed swimming bell
    m = smoothstep(0.80, 1.0, t)
    lap = lappet(theta)
    r -= 0.035 * m
    z -= (0.035 + 0.06 * lap) * m       # lappets hang lower than the notches
    r += 0.02 * lap * m
    return r, z


def inner_profile(t, theta):
    """Subumbrella: thick under the apex, meeting the outer surface at the rim."""
    r_o, z_o = outer_profile(t, theta)
    thick = 0.20 * (1.0 - t) ** 1.4 + 0.012
    a = t * math.pi / 2.0
    # offset roughly along the inward normal of the dome
    nx, nz = math.sin(a), math.cos(a) * (RIM_R / APEX)
    ln = math.hypot(nx, nz)
    return r_o - thick * nx / ln, z_o - thick * nz / ln


def build_bell():
    outer_rows, inner_rows = [], []
    for surf, prof, rows in (("o", outer_profile, outer_rows), ("i", inner_profile, inner_rows)):
        apex_r, apex_z = prof(0.0, 0.0)
        apex_idx = add_vert(0.0, 0.0, apex_z)
        for k in range(1, RINGS + 1):
            t = k / RINGS
            # cluster rings toward the margin where the lappets need detail
            t = 1.0 - (1.0 - t) ** 1.25
            row = []
            for s in range(SEG):
                th = s / SEG * 2.0 * math.pi
                r, z = prof(t, th)
                row.append(add_vert(r * math.cos(th), r * math.sin(th), z))
            rows.append(row)
        # apex fan
        first = rows[0]
        for s in range(SEG):
            a, b = first[s], first[(s + 1) % SEG]
            faces.append((apex_idx, a, b) if surf == "o" else (apex_idx, b, a))
    grid(outer_rows, True, flip=True)
    grid(inner_rows, True)
    # rounded margin lip joining outer -> inner
    lip_mid = []
    for s in range(SEG):
        th = s / SEG * 2.0 * math.pi
        ro, zo = outer_profile(1.0, th)
        ri, zi = inner_profile(1.0, th)
        r, z = (ro + ri) * 0.5 - 0.004, min(zo, zi) - 0.01
        lip_mid.append(add_vert(r * math.cos(th), r * math.sin(th), z))
    grid([outer_rows[-1], lip_mid, inner_rows[-1]], True, flip=True)


# -------------------------------------------------------------- tube helper
def tube(points, radii, sides, cap_tip=True):
    """Sweep a circle along points (parallel-transport frames)."""
    n = len(points)
    rows = []
    # initial frame
    def sub(a, b):
        return (a[0] - b[0], a[1] - b[1], a[2] - b[2])

    def norm(v):
        l = math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) or 1.0
        return (v[0] / l, v[1] / l, v[2] / l)

    def cross(a, b):
        return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

    def dot(a, b):
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

    tangents = []
    for i in range(n):
        p0 = points[max(0, i - 1)]
        p1 = points[min(n - 1, i + 1)]
        tangents.append(norm(sub(p1, p0)))
    ref = (1.0, 0.0, 0.0) if abs(tangents[0][0]) < 0.9 else (0.0, 1.0, 0.0)
    nrm = norm(cross(tangents[0], ref))
    for i in range(n):
        tg = tangents[i]
        nrm = norm(sub(nrm, tuple(tg[j] * dot(nrm, tg) for j in range(3))))
        bin_ = cross(tg, nrm)
        row = []
        for s in range(sides):
            a = s / sides * 2.0 * math.pi
            ca, sa = math.cos(a) * radii[i], math.sin(a) * radii[i]
            p = points[i]
            row.append(add_vert(p[0] + nrm[0] * ca + bin_[0] * sa,
                                p[1] + nrm[1] * ca + bin_[1] * sa,
                                p[2] + nrm[2] * ca + bin_[2] * sa))
        rows.append(row)
    grid(rows, True)
    if cap_tip:
        tip = points[-1]
        tg = tangents[-1]
        c = add_vert(tip[0] + tg[0] * radii[-1], tip[1] + tg[1] * radii[-1], tip[2] + tg[2] * radii[-1])
        last = rows[-1]
        for s in range(sides):
            faces.append((last[s], last[(s + 1) % sides], c))
    return rows


# ---------------------------------------------------------------- tentacles
TENTACLES = 32      # two per marginal notch
T_SIDES = 5
T_RINGS = 56


def build_tentacles():
    for i in range(TENTACLES):
        notch = i // 2
        side = -1.0 if i % 2 == 0 else 1.0
        th = (notch + 0.5) / LAPPETS * 2.0 * math.pi + side * 0.045
        r0, z0 = outer_profile(1.0, th)
        r0 -= 0.03
        z0 += 0.005
        tip_z = -3.35 - rng.random() * 0.85           # -3.35 .. -4.2
        length = z0 - tip_z
        phase = rng.random() * 2 * math.pi
        phase2 = rng.random() * 2 * math.pi
        flare = 0.06 + rng.random() * 0.08             # drifts out, then back in
        curl = (rng.random() - 0.5) * 0.6              # gentle sideways curve
        drawn_in = 0.10 + rng.random() * 0.22          # tips trail toward the axis
        wav_r = 0.06 + rng.random() * 0.10             # slow sinuous drift,
        wav_a = 0.05 + rng.random() * 0.10             # growing toward the tip
        wav_f = 4.0 + rng.random() * 4.0
        pts, rad = [], []
        for k in range(T_RINGS):
            u = k / (T_RINGS - 1)
            u_s = u ** 1.15                            # a bit denser near root
            z = z0 - length * u_s
            rr = r0 + flare * math.sin(u_s * math.pi * 0.9) - drawn_in * u_s ** 1.5
            rr += wav_r * u_s * math.sin(u_s * wav_f + phase)
            a = th + curl * u_s + wav_a * u_s * math.sin(u_s * wav_f * 0.7 + phase2)
            rr = min(rr, 0.98)
            pts.append((rr * math.cos(a), rr * math.sin(a), z))
            rad.append(0.017 * (1.0 - u_s) ** 0.8 + 0.0045)
        tube(pts, rad, T_SIDES)


# ---------------------------------------------------------------- oral arms
ARMS = 4
ARM_ALONG = 150
ARM_ACROSS = 11


def build_oral_arms():
    for i in range(ARMS):
        base_a = (i + 0.5) / ARMS * 2.0 * math.pi
        z_top = 0.44
        z_tip = -2.55 - rng.random() * 0.45            # -2.55 .. -3.0
        twist_rate = 2.6 + rng.random() * 0.8          # half-turns along the arm
        wander = rng.random() * 2 * math.pi
        ruffle_f = 26.0 + rng.random() * 6.0
        rows = []
        for k in range(ARM_ALONG):
            u = k / (ARM_ALONG - 1)
            z = z_top + (z_tip - z_top) * u
            # centreline: leaves the manubrium, drifts outward, slow spiral
            rad_c = 0.05 + 0.24 * math.sin(min(u * 1.6, 1.0) * math.pi / 2) + 0.05 * math.sin(u * 4.0 + wander)
            ang_c = base_a + 0.55 * u + 0.12 * math.sin(u * 3.0 + wander)
            cx, cy = rad_c * math.cos(ang_c), rad_c * math.sin(ang_c)
            # ribbon width: thin stalk at top, broad curtain, tapering tip
            width = 0.035 + 0.20 * math.sin(min(1.0, u * 1.25) * math.pi) ** 0.7
            width *= 1.0 - 0.75 * smoothstep(0.75, 1.0, u)
            tw = ang_c + twist_rate * math.pi * u    # ribbon plane rotates (twist)
            dx, dy = math.cos(tw), math.sin(tw)        # across-ribbon direction
            nx, ny = -dy, dx                           # ribbon face normal (horizontal)
            row = []
            for j in range(ARM_ACROSS):
                v = j / (ARM_ACROSS - 1) * 2.0 - 1.0   # -1 .. 1 across
                # folded "V" cross-section plus frilly ruffled edges
                fold = 0.35 * width * (1.0 - v * v)
                edge = abs(v) ** 2.2
                ruf = 0.075 * edge * math.sin(u * ruffle_f + v * 2.0 + wander) * (0.3 + width * 5.0)
                ruf += 0.025 * edge * math.sin(u * ruffle_f * 2.3 + wander * 1.7)
                off_n = fold + ruf
                x = cx + dx * v * width + nx * off_n
                y = cy + dy * v * width + ny * off_n
                zz = z + 0.03 * edge * math.sin(u * ruffle_f * 0.5 + wander)
                row.append(add_vert(x, y, zz))
            rows.append(row)
        grid(rows, False)


# -------------------------------------------------------------------- gonads
def build_gonads():
    for i in range(4):
        c_a = i / 4.0 * 2.0 * math.pi
        pts, rad = [], []
        n = 40
        for k in range(n):
            u = k / (n - 1)
            # horseshoe: 3/4 of a loop, opening toward the bell centre
            a = c_a + math.pi + (u - 0.5) * 1.6 * math.pi
            cr = 0.17
            cx, cy = 0.30 * math.cos(c_a), 0.30 * math.sin(c_a)
            x, y = cx + cr * math.cos(a), cy + cr * math.sin(a)
            rr = math.hypot(x, y)
            t = (2.0 / math.pi) * math.asin(min(1.0, rr / RIM_R))
            _, z_in = inner_profile(t, 0.0)
            pts.append((x, y, z_in + 0.06))
            rad.append(0.022 * math.sin(math.pi * (0.08 + 0.84 * u)))
        tube(pts, rad, 6)


build_bell()
build_gonads()
build_oral_arms()
build_tentacles()

mesh = bpy.data.meshes.new("Jellyfish")
mesh.from_pydata(verts, [], faces)
mesh.validate(clean_customdata=False)
mesh.update()
bm = bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)   # safety net: outward winding
bm.to_mesh(mesh)
bm.free()
mesh.update()
obj = bpy.data.objects.new("Jellyfish", mesh)
bpy.context.scene.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.shade_smooth()

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
zs = [v.co.z for v in mesh.vertices]
print(f"jellyfish: verts={len(mesh.vertices)} tris={tris} z=[{min(zs):.3f}, {max(zs):.3f}]")

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "creature.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True,
                          export_materials="NONE", export_texcoords=False)
print("wrote", out)
