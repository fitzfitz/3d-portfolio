# Career-trail buoy (original work, 100% procedural). Run headless:
#   $BLENDER --background --python scripts/blender/gen_buoy.py
# Output: assets-src/buoy.glb (raw; optimized by npm run assets:optimize)
#
# CONTRACT with src/components/canvas/CareerTrail.tsx and tests/assetContracts.test.ts
# (glTF space, +Y up):
#   one node "Buoy", one mesh, one primitive, one material "BuoyGlow": baseColor
#     + RGB emissive map, emissiveFactor [1,1,1], the same texture set as
#     Data_Shard, so the five instanced buoys share its shader program
#   200-400 triangles; mast along +Y with the origin at the glow ring;
#     y -1.75..1.65, |x| and |z| <= 0.75
#   no vertex colours, no tangents
#
# No bake and no unwrap: every face samples the centre of one flat palette
# cell, so re-running reproduces the file byte for byte (the UV packer is what
# makes baked models vary run to run).
# Blender axes while building: +Z = up (glTF +Y).
import bpy
import bmesh
import math
import os

import numpy as np

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "buoy.glb"))
TEX = 64
GRID = 4  # palette: GRID x GRID cells of CELL pixels
CELL = TEX // GRID


def rgb(h):
    """Hex to the 0..1 sRGB values a byte image stores (the PNG carries these bytes)."""
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


# part -> (palette cell, base colour, emissive colour)
PALETTE = {
    "hull": (0, rgb("1b1d22"), rgb("000000")),  # dark gunmetal float, mast and spokes
    "band": (1, rgb("c9ccd1"), rgb("000000")),  # light reflective bands
    "ring": (2, rgb("7a4a12"), rgb("ffb547")),  # the glowing amber ring
    "tip": (3, rgb("f2e2c0"), rgb("fff0d0")),   # the tip light
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bm = bmesh.new()
UV = bm.loops.layers.uv.new("UVMap")


def finish(faces, part, smooth):
    """Point every face outward, set its shading and map it onto its palette cell."""
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    cell = PALETTE[part][0]
    uv = ((cell % GRID + 0.5) / GRID, (cell // GRID + 0.5) / GRID)
    for f in faces:
        f.smooth = smooth
        for loop in f.loops:
            loop[UV].uv = uv


def lathe(profile, part, segments):
    """Revolve (radius, z) points, listed bottom to top, about Z into a closed
    solid: a radius of 0 is a pole, any other open end gets a flat cap."""
    rings = []
    for r, z in profile:
        if r == 0.0:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segments),
                                        r * math.sin(2 * math.pi * i / segments), z))
                          for i in range(segments)])
    sides, caps = [], []
    for a, b in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            if len(a) == 1:
                sides.append(bm.faces.new((a[0], b[i], b[j])))
            elif len(b) == 1:
                sides.append(bm.faces.new((a[i], a[j], b[0])))
            else:
                sides.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    for end in (rings[0], rings[-1]):
        if len(end) > 1:
            caps.append(bm.faces.new(end))
    finish(sides + caps, part, True)
    for f in caps:
        f.smooth = False


def torus(part, major, minor, z, nu, nv):
    grid = [[bm.verts.new(((major + minor * math.cos(2 * math.pi * j / nv)) * math.cos(2 * math.pi * i / nu),
                           (major + minor * math.cos(2 * math.pi * j / nv)) * math.sin(2 * math.pi * i / nu),
                           z + minor * math.sin(2 * math.pi * j / nv)))
             for j in range(nv)] for i in range(nu)]
    faces = []
    for i in range(nu):
        for j in range(nv):
            i2, j2 = (i + 1) % nu, (j + 1) % nv
            faces.append(bm.faces.new((grid[i][j], grid[i2][j], grid[i2][j2], grid[i][j2])))
    finish(faces, part, True)


def box(part, centre, size):
    hx, hy, hz = (s / 2 for s in size)
    v = [bm.verts.new((centre[0] + sx * hx, centre[1] + sy * hy, centre[2] + sz * hz))
         for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    # vertex index = 4 * (sx > 0) + 2 * (sy > 0) + (sz > 0)
    quads = ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3))
    finish([bm.faces.new([v[k] for k in q]) for q in quads], part, False)


# ---------------------------------------------------------------- geometry ---
# float (62 tris), mast (20), two bands (56), glow ring (160), spokes (24), tip (48): 370
lathe([(0.0, -1.70), (0.34, -1.62), (0.42, -1.38), (0.36, -1.10), (0.10, -1.00)], "hull", 8)
lathe([(0.07, -1.00), (0.07, 1.26)], "hull", 6)
lathe([(0.10, -0.60), (0.10, -0.40)], "band", 8)
lathe([(0.10, 0.90), (0.10, 1.05)], "band", 8)
torus("ring", 0.62, 0.11, 0.0, 16, 5)
box("hull", (0.0, 0.0, 0.0), (1.20, 0.05, 0.05))
box("hull", (0.0, 0.0, 0.0), (0.05, 1.20, 0.05))
lathe([(0.0, 1.26), (0.10, 1.31), (0.15, 1.42), (0.10, 1.53), (0.0, 1.58)], "tip", 8)

# ---------------------------------------------------------------- textures ---
col = np.zeros((TEX, TEX, 3), np.float32)
em = np.zeros((TEX, TEX, 3), np.float32)
for cell, base, glow in PALETTE.values():
    x0, y0 = (cell % GRID) * CELL, (cell // GRID) * CELL
    col[y0:y0 + CELL, x0:x0 + CELL] = base
    em[y0:y0 + CELL, x0:x0 + CELL] = glow


def to_image(name, pixels):
    img = bpy.data.images.new(name, width=TEX, height=TEX, alpha=False)
    rgba = np.ones((TEX, TEX, 4), np.float32)
    rgba[..., :3] = pixels
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


img_col = to_image("buoy_color", col)
img_em = to_image("buoy_emissive", em)

# ---------------------------------------------------------------- material ---
mat = bpy.data.materials.new("BuoyGlow")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Metallic"].default_value = 0.4
bsdf.inputs["Roughness"].default_value = 0.45
tc = nt.nodes.new("ShaderNodeTexImage")
tc.image = img_col
nt.links.new(tc.outputs["Color"], bsdf.inputs["Base Color"])
te = nt.nodes.new("ShaderNodeTexImage")
te.image = img_em
nt.links.new(te.outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 1.0

# ------------------------------------------------------------------ object ---
me = bpy.data.meshes.new("Buoy")
bm.to_mesh(me)
bm.free()
me.materials.append(mat)
obj = bpy.data.objects.new("Buoy", me)
bpy.context.scene.collection.objects.link(obj)

me.calc_loop_triangles()
xs = [v.co for v in me.vertices]
print("TRIS", len(me.loop_triangles))
print("BLENDER_BBOX x[%.3f,%.3f] y[%.3f,%.3f] z[%.3f,%.3f]" % (
    min(v.x for v in xs), max(v.x for v in xs), min(v.y for v in xs), max(v.y for v in xs),
    min(v.z for v in xs), max(v.z for v in xs)))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True)
print("wrote", OUT)
