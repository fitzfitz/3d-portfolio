# Cycles turntable stills of the project probe: the look gate (spec 4.1).
#   $BLENDER --background --python scripts/blender/turntable_probe.py -- --out=DIR \
#       [--glb=assets-src/probe.glb] [--samples=128] [--res=1024]
#
# Look-dev only: renders are never shipped or committed. Shipped GLBs are
# meshopt-compressed, which Blender cannot import, so this reads the raw
# generator output (assets-src/probe.glb: the same mesh and maps before
# WebP re-encoding).
#
# The zone mask is shaded the way ProjectProbes is meant to: COLOR_0's R
# zone (the painted stripe) multiplies the albedo by a toned-down project
# colour -- the colour desaturated 60% toward its own luminance, no
# emission, so it reads as paint; its G zone (the beacon lamps) emits the
# project colour. Light is a hard key sun (0.53 deg, as at 1 AU; no
# atmosphere in space) raking in about 45 degrees off the camera, and a dim
# neutral-cool fill (about 5% of the key) for the shadow side; the camera
# sees black. Tone mapping is Khronos PBR Neutral, like the game's.
#
# Output: DIR/probe_a030.png, _a120, _a210, _a300 (azimuth about glTF +Y,
# 18 degrees up), DIR/probe_plate.png (close-up of the gold plate),
# DIR/probe_dish.png (the reflector face-on) and DIR/probe_trio.png (the
# three project colours side by side).
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OPT = dict(a[2:].split("=", 1) for a in argv if a.startswith("--") and "=" in a)
if "out" not in OPT:
    sys.exit("turntable_probe.py: pass -- --out=DIR (renders are never written into the repo)")
OUT = os.path.abspath(OPT["out"])
GLB = os.path.abspath(OPT.get("glb", os.path.join(ROOT, "assets-src", "probe.glb")))
SAMPLES = int(OPT.get("samples", 128))
RES = int(OPT.get("res", 1024))
TINTS = ["00ff87", "00f0ff", "bd00ff"]   # projects.json colours
BEACON = 4.0                              # lamp emission strength at full blink
DESAT = 0.6                               # how far the trim tint is pulled to grey


def lin(h):
    def c(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(c(int(h[i:i + 2], 16)) for i in (0, 2, 4))


def gl(x, y, z):
    """glTF (+Y up) to Blender (+Z up)."""
    return Vector((x, -z, y))


# ------------------------------------------------------------------ scene
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "METAL"
    sc.cycles.device = "GPU" if any(d.use for d in prefs.devices) else "CPU"
except TypeError:
    sc.cycles.device = "CPU"
print("cycles device:", sc.cycles.device)
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 8
sc.render.resolution_x = sc.render.resolution_y = RES
sc.render.image_settings.file_format = "PNG"
sc.view_settings.view_transform = "Khronos PBR Neutral"
sc.view_settings.look = "None"

w = bpy.data.worlds.new("Space")
sc.world = w
w.use_nodes = True
nt = w.node_tree
nt.nodes.clear()
fill = nt.nodes.new("ShaderNodeBackground")
fill.inputs["Color"].default_value = (*lin("c4ccdc"), 1)
fill.inputs["Strength"].default_value = 0.075
black = nt.nodes.new("ShaderNodeBackground")
black.inputs["Color"].default_value = (*lin("050310"), 1)
lp = nt.nodes.new("ShaderNodeLightPath")
mix = nt.nodes.new("ShaderNodeMixShader")
out = nt.nodes.new("ShaderNodeOutputWorld")
nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
nt.links.new(fill.outputs["Background"], mix.inputs[1])
nt.links.new(black.outputs["Background"], mix.inputs[2])
nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])


def light(name, kind, energy, direction, colour=(1, 1, 1), size=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = colour
    if kind == "SUN":
        ld.angle = math.radians(0.53)
    if size:
        ld.size = size
    ob = bpy.data.objects.new(name, ld)
    sc.collection.objects.link(ob)
    d = Vector(direction).normalized()
    ob.location = -d * 12
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


# the key sun; shoot() turns it with the camera (a turntable spins the
# model, not the lighting)
SUN = light("Sun", "SUN", 3.6, (0, 0, -1), colour=(1.0, 0.975, 0.94))


def aim(ob, d):
    d = d.normalized()
    ob.location = -d * 12
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

# ------------------------------------------------------------------ model
bpy.ops.import_scene.gltf(filepath=GLB)
probe = next(o for o in sc.objects if o.type == "MESH")
src = probe.data.materials[0]
imgs = {n.image.name: n.image for n in src.node_tree.nodes if n.type == "TEX_IMAGE" and n.image}


def find(key):
    return next(img for name, img in imgs.items() if key in name)


IMG_ALB, IMG_MR, IMG_NRM = find("albedo"), find("metal_rough"), find("normal")
COLOR_ATTR = probe.data.color_attributes[0].name


def toned(tint):
    """The trim's multiply colour: the project colour pulled DESAT of the way
    to its own luminance (linear Rec. 709), so the stripe reads as paint."""
    c = lin(tint)
    y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    return tuple(v + DESAT * (y - v) for v in c)


def probe_material(tint):
    """The game's look: albedo x (toned tint on R), MR, normal map, G zone
    glowing the tint. The R zone never emits."""
    m = bpy.data.materials.new("Probe_" + tint)
    m.use_nodes = True
    t = m.node_tree
    bsdf = t.nodes["Principled BSDF"]
    ta = t.nodes.new("ShaderNodeTexImage")
    ta.image = IMG_ALB
    tm = t.nodes.new("ShaderNodeTexImage")
    tm.image = IMG_MR
    tn = t.nodes.new("ShaderNodeTexImage")
    tn.image = IMG_NRM
    ca = t.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = COLOR_ATTR
    zones = t.nodes.new("ShaderNodeSeparateColor")
    t.links.new(ca.outputs["Color"], zones.inputs["Color"])
    tinted = t.nodes.new("ShaderNodeMix")
    tinted.data_type = "RGBA"
    tinted.blend_type = "MULTIPLY"
    t.links.new(zones.outputs["Red"], tinted.inputs[0])
    t.links.new(ta.outputs["Color"], tinted.inputs[6])
    tinted.inputs[7].default_value = (*toned(tint), 1)
    t.links.new(tinted.outputs[2], bsdf.inputs["Base Color"])
    sep = t.nodes.new("ShaderNodeSeparateColor")
    t.links.new(tm.outputs["Color"], sep.inputs["Color"])
    t.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    t.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nm = t.nodes.new("ShaderNodeNormalMap")
    t.links.new(tn.outputs["Color"], nm.inputs["Color"])
    t.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Emission Color"].default_value = (*lin(tint), 1)
    em = t.nodes.new("ShaderNodeMath")
    em.operation = "MULTIPLY"
    t.links.new(zones.outputs["Green"], em.inputs[0])
    em.inputs[1].default_value = BEACON
    t.links.new(em.outputs[0], bsdf.inputs["Emission Strength"])
    return m


probe.data.materials[0] = probe_material(TINTS[0])

# plate centre: the bezel's trim-zone vertices on the +X bay (glTF)
attr = probe.data.color_attributes[COLOR_ATTR]
mask_r = set()
if attr.domain == "POINT":
    mask_r = {i for i, d in enumerate(attr.data) if d.color[0] > 0.5}
else:
    for li, d in enumerate(attr.data):
        if d.color[0] > 0.5:
            mask_r.add(probe.data.loops[li].vertex_index)
# (the aft band's nearest corners sit at |y| 0.125, the dish stripe far forward)
vco = [probe.data.vertices[i].co for i in mask_r]
bezel = [c for c in vco if 0.375 < c.x < 0.42 and 0.0 < c.y < 0.26 and abs(c.z) < 0.11]
PLATE = sum(bezel, Vector()) / len(bezel)
print("plate centre (Blender):", tuple(round(c, 3) for c in PLATE), "from", len(bezel), "verts")

# ------------------------------------------------------------------ camera
cd = bpy.data.cameras.new("Cam")
cd.lens = 50
cd.clip_start = 0.01
cam = bpy.data.objects.new("Cam", cd)
sc.collection.objects.link(cam)
sc.camera = cam
os.makedirs(OUT, exist_ok=True)
lo = Vector([min(v.co[i] for v in probe.data.vertices) for i in range(3)])
hi = Vector([max(v.co[i] for v in probe.data.vertices) for i in range(3)])
BODY = (lo + hi) / 2               # bbox centre, so the long boom fits


def shoot(name, target, az_deg, el_deg, dist, lens=50, key=1):
    """key=1 lights from the camera's upper left, -1 from its upper right."""
    cd.lens = lens
    az, el = math.radians(az_deg), math.radians(el_deg)
    # azimuth about glTF +Y from glTF +Z (the dish face) toward glTF +X
    d = gl(math.sin(az) * math.cos(el), math.sin(el), math.cos(az) * math.cos(el))
    cam.location = target + d * dist
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    f = -d
    right = f.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(f).normalized()
    aim(SUN, f * 0.75 + right * 0.55 * key - up * 0.45)   # key ~45 deg off the camera, raking
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)
    print("wrote", sc.render.filepath)


for az, key in ((30, 1), (120, 1), (210, 1), (300, -1)):
    shoot(f"probe_a{az:03d}", BODY, az, 18, 5.6, key=key)
shoot("probe_plate", PLATE, 90, 6, 0.62)
# the blanket up close: a gold bay (bay 2, its normal 72 deg from glTF +X
# toward +Y) from above and to the side, the key raking across it
BAY2 = gl(0.38 * 0.978 * math.cos(math.radians(72)), 0.38 * 0.978 * math.sin(math.radians(72)), -0.13 * 0.978)
shoot("probe_foil", BAY2, 70, 58, 1.05)
# the aft deck: the thruster clusters and the main bell (glTF -Z)
shoot("probe_aft", gl(0, 0, -0.3), 160, 24, 2.4, key=-1)
# the reflector face-on, a few degrees off axis so the rim's depth shows
DISH_C = gl(0, 0, 0.22)
shoot("probe_dish", DISH_C, 4, 5, 2.55)

# the three colours side by side, spaced along the camera's right
TRIO_AZ = math.radians(150)
step = gl(math.cos(TRIO_AZ), 0, -math.sin(TRIO_AZ)) * 3.5
for k, tint in enumerate(TINTS[1:], 1):
    twin = probe.copy()
    twin.data = probe.data.copy()
    twin.data.materials[0] = probe_material(tint)
    twin.location = step * k
    sc.collection.objects.link(twin)
shoot("probe_trio", BODY + step, 150, 16, 14.5)
