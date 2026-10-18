# Cycles turntables of the new worlds: the realism gate (spec "Assets").
#   $BLENDER --background --python scripts/blender/turntable_worlds.py -- --out=DIR \
#       [--only=w-ringed,w-blue] [--samples=96] [--res=768] [--node=node] [--extra-stops=0]
#
# Look-dev only: renders are never shipped or committed. Each world is drawn
# with its SHIPPED maps (public/models/*.webp) on a UV sphere laid out like
# THREE.SphereGeometry, so what is judged is what visitors download.
#
# Light and exposure follow the game, read live from the TypeScript sources
# (src/data/worlds.ts, src/utils/worldPhysics.ts, src/utils/sunLight.ts) via
# node, so nothing here hard-codes an orbit:
#   - a sun lamp from +X with irradiance SUN_IRRADIANCE_AT_AU * fluxEarth(r):
#     three's punctual light gives albedo/PI * E, as does a Cycles sun of strength E;
#   - the ambient fill, 0.15 / PI * fluxEarth(r) as a uniform world the camera
#     does not see (the spec scales the game's 0.15 ambient by irradianceVsAU);
#   - exposure (r / AU)^EXPOSURE_POWER, the camera's adaptation, under
#     Khronos PBR Neutral (the game's NeutralToneMapping). Net brightness falls
#     as (AU / r)^0.5, so dim stays dim.
# The giants get a facing-ratio limb darkening standing in for the game's
# LimbDarkening shader. The rings take tau from the strip's alpha
# (tau = A * RING_TAU_MAX): opacity 1 - exp(-tau / |mu|) for the view ray and
# exp(-tau / mu0) for sunlight, since Cycles evaluates the same shader on
# shadow rays; thin parts also transmit diffusely, so a backlit ring glows.
#
# --extra-stops brightens a look-dev set past the game's exposure, to judge
# texture on worlds the game's tone mapping crushes toward black. The default
# (0) is the game's exposure.
#
# Output: DIR/<id>/f0.png .. f7.png (45-degree spin steps), plus
# DIR/w-ringed/edgeon.png and DIR/w-ringed/backlit.png.
import json
import math
import os
import subprocess
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SEG, RINGS = 256, 128
PHASE_DEG = 40.0          # sun-planet-camera angle of the turntable frames
LIMB = {"w-ringed": 0.5, "w-tilted": 0.45, "w-blue": 0.65}
NORMAL_MAPPED = {"w-rock", "w-dwarf"}     # they ship <map>_normal.webp

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OPT = dict(a[2:].split("=", 1) for a in argv if a.startswith("--") and "=" in a)
if "out" not in OPT:
    sys.exit("turntable_worlds.py: pass -- --out=DIR (renders are never written into the repo)")
OUT = os.path.abspath(OPT["out"])
ONLY = set(OPT["only"].split(",")) if "only" in OPT else None
SAMPLES = int(OPT.get("samples", 96))
RES = int(OPT.get("res", 768))
EXTRA_STOPS = float(OPT.get("extra-stops", 0))

NODE_JS = r"""
const root = process.argv[1];
const jiti = require(root + "/node_modules/jiti")(root + "/turntable.js");
const { WORLDS } = jiti(root + "/src/data/worlds.ts");
const { fluxEarth } = jiti(root + "/src/utils/worldPhysics.ts");
const { SUN_IRRADIANCE_AT_AU, EXPOSURE_POWER } = jiti(root + "/src/utils/sunLight.ts");
const { AU } = jiti(root + "/src/constants.ts");
import(root + "/scripts/textures/gen_worlds.mjs").then((g) => console.log(JSON.stringify({
  AU, SUN_IRRADIANCE_AT_AU, EXPOSURE_POWER, RING_TAU_MAX: g.RING_TAU_MAX, RING_IN: g.RING_IN, RING_OUT: g.RING_OUT,
  worlds: WORLDS.map((w) => ({ id: w.id, map: w.map, flattening: w.flattening, axialTiltDeg: w.axialTiltDeg,
    radius: w.orbit.radius, flux: fluxEarth(w.orbit.radius) })),
})));
"""


def game_params():
    out = subprocess.check_output([OPT.get("node", "node"), "-e", NODE_JS, ROOT], cwd=ROOT)
    return json.loads(out.decode().strip().splitlines()[-1])


# ------------------------------------------------------------------ scene
def setup_scene():
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
    return sc


def setup_world(sc, fill):
    w = bpy.data.worlds.new("Space")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = fill
    black = nt.nodes.new("ShaderNodeBackground")
    black.inputs["Color"].default_value = (0, 0, 0, 1)
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMixShader")
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs["Fac"])
    nt.links.new(bg.outputs["Background"], mix.inputs[1])
    nt.links.new(black.outputs["Background"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])


def add_sun(strength):
    ld = bpy.data.lights.new("Sun", "SUN")
    ld.energy = strength
    ld.angle = math.radians(0.5)
    ob = bpy.data.objects.new("Sun", ld)
    bpy.context.scene.collection.objects.link(ob)
    # a sun lamp shines along its local -Z: point it at -X, i.e. light from +X
    ob.rotation_euler = (0.0, math.radians(90.0), 0.0)
    return ob


def add_camera(direction, extent):
    cd = bpy.data.cameras.new("Cam")
    cd.type = "ORTHO"
    cd.ortho_scale = 2.3 * extent
    cd.clip_end = 1000
    cam = bpy.data.objects.new("Cam", cd)
    bpy.context.scene.collection.objects.link(cam)
    d = Vector(direction).normalized()
    cam.location = d * 50
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


# ------------------------------------------------------------------ geometry
def three_sphere(name):
    """UV sphere with THREE.SphereGeometry's layout: u = phi / 2PI, v = 1 at the north pole.
    THREE (x, y, z) maps to Blender (x, -z, y), so the pole is Blender +Z."""
    verts, uvs = [], []
    for iy in range(RINGS + 1):
        v = iy / RINGS
        th = v * math.pi
        for ix in range(SEG + 1):
            u = ix / SEG
            ph = u * 2 * math.pi
            x, y, z = -math.cos(ph) * math.sin(th), math.cos(th), math.sin(ph) * math.sin(th)
            verts.append((x, -z, y))
            uvs.append((u, 1 - v))
    faces = []
    for iy in range(RINGS):
        for ix in range(SEG):
            a, b = iy * (SEG + 1) + ix, iy * (SEG + 1) + ix + 1
            c, d = (iy + 1) * (SEG + 1) + ix + 1, (iy + 1) * (SEG + 1) + ix
            faces.append((a, d, c, b))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        poly.use_smooth = True
        for li in poly.loop_indices:
            uvl.data[li].uv = uvs[me.loops[li].vertex_index]
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def ring_mesh(name, r_in, r_out, seg=512):
    verts, faces, uvs = [], [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        verts += [(r_in * math.cos(a), r_in * math.sin(a), 0), (r_out * math.cos(a), r_out * math.sin(a), 0)]
    for i in range(seg):
        j = (i + 1) % seg
        faces.append((2 * i, 2 * i + 1, 2 * j + 1, 2 * j))
        uvs.append([(0, 0.5), (1, 0.5), (1, 0.5), (0, 0.5)])
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name="UVMap")
    for poly, uv in zip(me.polygons, uvs):
        for li, t in zip(poly.loop_indices, uv):
            uvl.data[li].uv = t
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ------------------------------------------------------------------ materials
def image(name, non_color=False):
    img = bpy.data.images.load(os.path.join(ROOT, "public", "models", name + ".webp"))
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def planet_material(w):
    mat = bpy.data.materials.new(w["id"])
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfDiffuse")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image(w["map"])
    tex.interpolation = "Cubic"
    col = tex.outputs["Color"]
    if w["id"] in LIMB:
        # colour * (1 - k * (1 - mu)), mu = |N . V|: the giants' limb darkening
        lw = nt.nodes.new("ShaderNodeLayerWeight")
        lw.inputs["Blend"].default_value = 0.5
        k = nt.nodes.new("ShaderNodeMath")
        k.operation = "MULTIPLY_ADD"
        k.inputs[1].default_value = -LIMB[w["id"]]
        k.inputs[2].default_value = 1.0
        nt.links.new(lw.outputs["Facing"], k.inputs[0])
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        nt.links.new(col, mul.inputs["A"])
        nt.links.new(k.outputs["Value"], mul.inputs["B"])
        col = mul.outputs["Result"]
    else:
        bsdf.inputs["Roughness"].default_value = 1.0     # regolith: flatter than Lambert at the limb
    nt.links.new(col, bsdf.inputs["Color"])
    if w["id"] in NORMAL_MAPPED:
        ntex = nt.nodes.new("ShaderNodeTexImage")
        ntex.image = image(w["map"] + "_normal", non_color=True)
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.uv_map = "UVMap"
        nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    return mat


def ring_material(tau_max):
    mat = bpy.data.materials.new("Rings")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    L = nt.links
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image("w-ringed_ring")
    tex.image.alpha_mode = "CHANNEL_PACKED"
    tex.interpolation = "Linear"
    tex.extension = "EXTEND"

    def math_node(op, a=None, b=None):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]

    geo = nt.nodes.new("ShaderNodeNewGeometry")
    dot = nt.nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    L.new(geo.outputs["Incoming"], dot.inputs[0])
    L.new(geo.outputs["True Normal"], dot.inputs[1])
    mu = math_node("MAXIMUM", math_node("ABSOLUTE", dot.outputs["Value"]), 0.01)
    tau = math_node("MULTIPLY", tex.outputs["Alpha"], tau_max)
    opacity = math_node("SUBTRACT", 1.0, math_node("EXPONENT", math_node("DIVIDE", math_node("MULTIPLY", tau, -1.0), mu)))
    # thin parts transmit diffusely (glow when backlit); the opaque B core does not
    trans = math_node("MULTIPLY", math_node("EXPONENT", math_node("MULTIPLY", tau, -1.0)), 0.5)
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    tr = nt.nodes.new("ShaderNodeBsdfTranslucent")
    L.new(tex.outputs["Color"], dif.inputs["Color"])
    L.new(tex.outputs["Color"], tr.inputs["Color"])
    lit = nt.nodes.new("ShaderNodeMixShader")
    L.new(trans, lit.inputs["Fac"])
    L.new(dif.outputs[0], lit.inputs[1])
    L.new(tr.outputs[0], lit.inputs[2])
    clear = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    L.new(opacity, mix.inputs["Fac"])
    L.new(clear.outputs[0], mix.inputs[1])
    L.new(lit.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], out.inputs["Surface"])
    return mat


# ------------------------------------------------------------------ render
def render(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("rendered", path)


def cam_dir(phase_deg):
    """Viewer direction in the orbit plane, phase_deg from the sun (+X)."""
    a = math.radians(phase_deg)
    return Vector((math.cos(a), math.sin(a), 0.0))


def pole_frame(pole, roll_hint):
    """Rotation taking +Z to `pole`, keeping +X close to roll_hint."""
    z = Vector(pole).normalized()
    x = (Vector(roll_hint) - z * z.dot(Vector(roll_hint))).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed().to_4x4()


def tilted_pole(cam, toward_cam_deg, roll_deg):
    """A pole tipped `toward_cam_deg` toward the viewer, then rolled in the image plane by roll_deg."""
    p = Vector((0, 0, 1)) * math.cos(math.radians(toward_cam_deg)) + cam * math.sin(math.radians(toward_cam_deg))
    return (Matrix.Rotation(math.radians(roll_deg), 3, cam) @ p).normalized()


def world_scene(w, g, params):
    sc = setup_scene()
    E = g["SUN_IRRADIANCE_AT_AU"] * w["flux"]
    setup_world(sc, 0.15 / math.pi * w["flux"])
    add_sun(E)
    sc.view_settings.exposure = g["EXPOSURE_POWER"] * math.log2(w["radius"] / g["AU"]) + EXTRA_STOPS
    print(f"{w['id']}: r={w['radius']} flux={w['flux']:.4f} sun={E:.4f} exposure={sc.view_settings.exposure:+.3f} stops"
          f" view={sc.view_settings.view_transform}")
    tilt = bpy.data.objects.new("Tilt", None)
    sc.collection.objects.link(tilt)
    body = three_sphere(w["id"])
    body.parent = tilt
    body.scale = (1, 1, 1 - w["flattening"])
    body.data.materials.append(planet_material(w))
    extent = 1.0
    if w["id"] == "w-ringed":
        ring = ring_mesh("Rings", g["RING_IN"], g["RING_OUT"])
        ring.parent = tilt
        ring.data.materials.append(ring_material(g["RING_TAU_MAX"]))
        extent = g["RING_OUT"]
    cam = cam_dir(params["phase"])
    add_camera(cam, extent)
    tilt.matrix_world = pole_frame(params["pole"], Vector((1, 0, 0)))
    return body


def main():
    g = game_params()
    for w in g["worlds"]:
        if ONLY and w["id"] not in ONLY:
            continue
        cam = cam_dir(PHASE_DEG)
        if w["id"] == "w-ringed":
            # open: the pole tipped toward the viewer by the axial tilt (rings at full opening)
            pole = (Vector((0, 0, 1)) * math.cos(math.radians(w["axialTiltDeg"])) + cam * math.sin(math.radians(w["axialTiltDeg"]))).normalized()
        else:
            # pole tipped 15 degrees toward the viewer, the axis rolled by the axial tilt
            pole = tilted_pole(cam, 15.0, w["axialTiltDeg"])
        body = world_scene(w, g, {"phase": PHASE_DEG, "pole": pole})
        for i in range(8):
            body.rotation_euler = (0, 0, math.radians(45 * i))
            render(os.path.join(OUT, w["id"], f"f{i}.png"))
        if w["id"] == "w-ringed":
            # near edge-on: rings 3 degrees open to the viewer
            pole = (Vector((0, 0, 1)) * math.cos(math.radians(3)) + cam * math.sin(math.radians(3))).normalized()
            world_scene(w, g, {"phase": PHASE_DEG, "pole": pole})
            render(os.path.join(OUT, w["id"], "edgeon.png"))
            # backlit: viewer at 140 degrees phase on the rings' unlit face, the sun 20 degrees above them
            pole = (Vector((0, 0, 1)) * math.cos(math.radians(20)) + Vector((1, 0, 0)) * math.sin(math.radians(20))).normalized()
            world_scene(w, g, {"phase": 140.0, "pole": pole})
            render(os.path.join(OUT, w["id"], "backlit.png"))


main()
