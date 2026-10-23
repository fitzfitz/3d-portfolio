# Cycles turntable stills of the space monsters: look checks A and B.
#   $BLENDER --background --python scripts/blender/turntable_monsters.py -- --out=DIR \
#       [--glb=assets-src/saucer.glb] [--with-ship] [--samples=64] [--res=1024]
#
# Look-dev only: renders are never shipped or committed (pass a scratch DIR).
# Without --glb it renders every monster glb found in assets-src/ (saucer,
# tardigrade). Shipped GLBs are meshopt-compressed, which Blender cannot
# import, so this reads the raw generator output.
#
# Lighting follows turntable_probe.py: a hard key sun (0.53 deg, as at 1 AU)
# raking in about 45 degrees off the camera, a dim neutral-cool fill (about
# 5% of the key) for the shadow side, a black background; tone mapping is
# Khronos PBR Neutral, like the game's. A glass material (name has "Glass"
# or "Dome") is rendered as clear glass.
#
# Output per monster <name> (the glb's basename):
#   DIR/<name>_a030.png, _a120, _a210, _a300 (azimuth about glTF +Y from the
#     face, +Z, toward +X; 18 degrees up), DIR/<name>_under.png (32 degrees
#     below: the cannon and spikes, the legs and claws), and with --with-ship
#   DIR/<name>_scale.png: the monster beside assets-src/spaceship.glb drawn
#     at the game's 0.35 (PLAYER_SHIP_SCALE), both facing glTF +Z.
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OPT = dict(a[2:].split("=", 1) for a in argv if a.startswith("--") and "=" in a)
FLAGS = {a[2:] for a in argv if a.startswith("--") and "=" not in a}
if "out" not in OPT:
    sys.exit("turntable_monsters.py: pass -- --out=DIR (renders are never written into the repo)")
OUT = os.path.abspath(OPT["out"])
if "glb" in OPT:
    GLBS = [os.path.abspath(OPT["glb"])]
else:
    GLBS = [p for p in (os.path.join(ROOT, "assets-src", n + ".glb") for n in ("saucer", "tardigrade"))
            if os.path.exists(p)]
WITH_SHIP = "with-ship" in FLAGS
SHIP_GLB = os.path.join(ROOT, "assets-src", "spaceship.glb")
for p in GLBS + ([SHIP_GLB] if WITH_SHIP else []):
    if not os.path.exists(p):
        sys.exit(f"turntable_monsters.py: {p} not found")
if not GLBS:
    sys.exit("turntable_monsters.py: no monster glb in assets-src/ (run gen_saucer.py / gen_tardigrade.py) "
             "and no --glb=PATH given")
SHIP_SCALE = 0.35          # src/constants.ts PLAYER_SHIP_SCALE
SAMPLES = int(OPT.get("samples", 64))
RES = int(OPT.get("res", 1024))
LENS = 50
SCALE_AZ = 70             # the scale shot's azimuth: both models near broadside


def lin(h):
    def c(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(c(int(h[i:i + 2], 16)) for i in (0, 2, 4))


def gl(x, y, z):
    """glTF (+Y up) to Blender (+Z up)."""
    return Vector((x, -z, y))


def setup():
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
    sc.cycles.transparent_max_bounces = 16
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

    ld = bpy.data.lights.new("Sun", "SUN")
    ld.energy = 3.6
    ld.color = (1.0, 0.975, 0.94)
    ld.angle = math.radians(0.53)
    sun = bpy.data.objects.new("Sun", ld)
    sc.collection.objects.link(sun)

    cd = bpy.data.cameras.new("Cam")
    cd.lens = LENS
    cd.clip_start = 0.01
    cam = bpy.data.objects.new("Cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, sun, cam


def glassify(objs):
    """Clear glass for the dome (the blockout's flat alpha reads as fog)."""
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if m is None or not any(k in m.name for k in ("Glass", "Dome")):
                continue
            g = bpy.data.materials.new(m.name + "_render")
            g.use_nodes = True
            b = g.node_tree.nodes["Principled BSDF"]
            b.inputs["Base Color"].default_value = (0.96, 0.98, 1.0, 1)
            b.inputs["Transmission Weight"].default_value = 1.0
            b.inputs["Roughness"].default_value = 0.03
            b.inputs["IOR"].default_value = 1.45
            slot.material = g


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None]
    return roots, [o for o in new if o.type == "MESH"]


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


def shoot(sc, sun, cam, path, target, radius, az_deg, el_deg, key=1, fit=None, margin=0.10):
    """Camera on a sphere about target, framing a sphere of `radius`; or, with
    fit (world points), aimed at the middle of their on-screen span and backed
    off until every point lies `margin` of the frame inside each edge.
    key=1 lights from the camera's upper left, -1 from its upper right."""
    az, el = math.radians(az_deg), math.radians(el_deg)
    d = gl(math.sin(az) * math.cos(el), math.sin(el), math.cos(az) * math.cos(el))
    f = -d
    right = f.cross(Vector((0, 0, 1))).normalized()
    up = right.cross(f).normalized()
    half_fov = math.atan(18.0 / LENS)
    if fit is None:
        dist = radius / math.sin(half_fov) * 1.04
    else:
        def mid(axis):
            ps = [p.dot(axis) for p in fit]
            return (min(ps) + max(ps)) / 2
        target = right * mid(right) + up * mid(up) + d * mid(d)
        t = math.tan(half_fov) * (1 - 2 * margin)   # square frame: same both ways
        dist = max((p - target).dot(d) + max(abs((p - target).dot(right)), abs((p - target).dot(up))) / t
                   for p in fit)
    cam.location = target + d * dist
    cam.rotation_euler = f.to_track_quat("-Z", "Y").to_euler()
    sd = (f * 0.75 + right * 0.55 * key - up * 0.45).normalized()   # ~45 deg off the camera, raking
    sun.rotation_euler = sd.to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("wrote", path)


os.makedirs(OUT, exist_ok=True)
for glb in GLBS:
    name = os.path.splitext(os.path.basename(glb))[0]
    sc, sun, cam = setup()
    _, objs = import_glb(glb)
    glassify(objs)
    lo, hi = bounds(objs)
    centre, radius = (lo + hi) / 2, (hi - lo).length / 2
    ext = hi - lo
    print("%s: extent (glTF x, y, z) %.3f %.3f %.3f" % (name, ext.x, ext.z, ext.y))
    for az, key in ((30, 1), (120, 1), (210, 1), (300, -1)):
        shoot(sc, sun, cam, os.path.join(OUT, f"{name}_a{az:03d}.png"), centre, radius * 0.92, az, 18, key)
    # from below: the saucer's cannon and spikes, the tardigrade's legs and claws
    shoot(sc, sun, cam, os.path.join(OUT, f"{name}_under.png"), centre, radius * 0.92, 30, -32)
    if WITH_SHIP:
        roots, ship = import_glb(SHIP_GLB)
        for r in roots:      # nose to glTF +Z like the monster (its engines face +Z unturned)
            r.matrix_world = Matrix.Rotation(math.pi, 4, "Z") @ Matrix.Diagonal((SHIP_SCALE,) * 3 + (1,))
        bpy.context.view_layer.update()
        # side by side on screen, at the same depth: the ship to the monster's
        # left as the camera sees it, both broadside-ish (azimuth SCALE_AZ)
        a = math.radians(SCALE_AZ)
        right = gl(math.cos(a), 0, -math.sin(a))

        def span(o_list):
            ps = [(o.matrix_world @ Vector(c)).dot(right) for o in o_list for c in o.bound_box]
            return min(ps), max(ps)

        slo, shi = bounds(ship)
        s_mid = (slo + shi) / 2
        m_min, _ = span(objs)
        s_min, s_max = span(ship)
        level = (centre - s_mid) - right * (centre - s_mid).dot(right)   # same depth and height
        shift = right * (m_min - 0.5 - s_max) + level                    # 0.5 u gap
        for r in roots:
            r.location = r.location + shift
        bpy.context.view_layer.update()
        sext = bounds(ship)[1] - bounds(ship)[0]
        print("ship at %.2f: extent (glTF x, y, z) %.3f %.3f %.3f" % (SHIP_SCALE, sext.x, sext.z, sext.y))
        pts = [o.matrix_world @ v.co for o in objs + ship for v in o.data.vertices]
        shoot(sc, sun, cam, os.path.join(OUT, f"{name}_scale.png"), None, None, SCALE_AZ, 12, fit=pts)
