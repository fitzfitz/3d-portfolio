# Cycles turntable stills of the space monsters: look checks A and B.
#   $BLENDER --background --python scripts/blender/turntable_monsters.py -- --out=DIR \
#       [--glb=assets-src/saucer.glb] [--with-ship] [--samples=64] [--res=1024] \
#       [--lod=0|1] [--fur-shells=N] [--no-cards] [--rig=PATH] [--shots=a030,face,...]
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
# A final-stage glb (nodes <Name>_LOD0 / _LOD1) shows one LOD (--lod, 0 by
# default; the other is deleted). Its fur primitive (a material named
# "...Fur") is previewed as the game will draw it: the fur base copied N
# times (--fur-shells, default the rig's furShells; 0 shows the bare base)
# outward along its normals by layer / N x _FUR.x x furMaxLength (from the
# rig JSON: --rig, else src/data/<name>Rig.json, else next to the glb),
# each layer alpha-testing the strand mask at layer / N, plus a gravity
# droop growing with the square of the height (0.6 x the length at the tip); the cards alpha-test at their _FUR.x.
# The face shot of a final glb frames its face's _MOTION parts (FACE_IDS).
#
# Output per monster <name> (the glb's basename):
#   DIR/<name>_a030.png, _a120, _a210, _a300 (azimuth about glTF +Y from the
#     face, +Z, toward +X; 18 degrees up), DIR/<name>_under.png (32 degrees
#     below: the cannon and spikes, the legs and claws), DIR/<name>_face.png
#     (close up, framed on the objects named in FACE_PARTS), and with --with-ship
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
FACE_PARTS = ("Eye", "Brow", "Teeth", "Goo", "Mouth", "Drool")   # objects the face shot frames
# a final glb's _MOTION parts the face shot frames: the saucer's eyes, jaw and
# goo; the tardigrade's mouth tube, eyes, drool and teeth
FACE_IDS = {"saucer": (3, 4, 5, 6, 8), "tardigrade": (9, 11, 12, 14)}
LOD = int(OPT.get("lod", 0))
SHOTS = set(OPT["shots"].split(",")) if "shots" in OPT else None


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
    sc.cycles.transparent_max_bounces = 40       # the fur preview's shells
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


def split_custom(path):
    """Read the custom ("_") vertex attributes of a raw glb per mesh (the
    primitives' arrays concatenated in order, as the importer lays out the
    vertices) and write a copy without them. Blender 5.1's importer keeps
    custom attribute names in a set and indexes them by its iteration order,
    so a mesh with two of them (_MOTION, _FUR) imports or fails by hash
    seed; three.js reads them by name and is unaffected."""
    import json
    import struct
    import tempfile
    import numpy as np
    data = open(path, "rb").read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + jlen])
    rest = data[20 + jlen:]
    blen = struct.unpack_from("<I", rest, 0)[0]
    binc = rest[8:8 + blen]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
    dt = {5126: np.float32, 5123: np.uint16, 5121: np.uint8}

    def acc(i):
        a = doc["accessors"][i]
        bv = doc["bufferViews"][a["bufferView"]]
        n, w = a["count"], width[a["type"]]
        arr = np.frombuffer(binc, dt[a["componentType"]], n * w, bv.get("byteOffset", 0) + a.get("byteOffset", 0))
        arr = arr.reshape(n, w).astype(np.float32)
        if a.get("normalized"):
            arr /= np.iinfo(dt[a["componentType"]]).max
        return arr

    custom = {}
    for mesh in doc.get("meshes", []):
        names = sorted({k for p in mesh["primitives"] for k in p["attributes"] if k.startswith("_")})
        if not names:
            continue
        per = {k: [] for k in names}
        for p in mesh["primitives"]:
            n = doc["accessors"][p["attributes"]["POSITION"]]["count"]
            for k in names:
                if k in p["attributes"]:
                    per[k].append(acc(p["attributes"][k]))
                else:
                    w = next(width[doc["accessors"][q["attributes"][k]]["type"]] for q in mesh["primitives"]
                             if k in q["attributes"])
                    per[k].append(np.zeros((n, w), np.float32))
            for k in [k for k in p["attributes"] if k.startswith("_")]:
                del p["attributes"][k]
        custom[mesh.get("name")] = {k: np.concatenate(v) for k, v in per.items()}
    if not custom:
        return path, {}
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    out = struct.pack("<4sII", b"glTF", 2, 20 + len(js) + len(rest)) + struct.pack("<I4s", len(js), b"JSON") + js + rest
    fd, tmp = tempfile.mkstemp(suffix=".glb")
    os.write(fd, out)
    os.close(fd)
    return tmp, custom


def import_glb(path):
    before = set(bpy.data.objects)
    path, custom = split_custom(path)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        attrs = custom.get(o.data.name) if o.type == "MESH" else None
        if not attrs:
            continue
        for k, arr in attrs.items():
            if len(arr) != len(o.data.vertices):
                print(f"{o.name}: {k} has {len(arr)} values for {len(o.data.vertices)} vertices, skipped")
                continue
            kind, prop = {4: ("FLOAT_COLOR", "color"), 2: ("FLOAT2", "vector"), 3: ("FLOAT_VECTOR", "vector"),
                          1: ("FLOAT", "value")}[arr.shape[1]]
            o.data.attributes.new(k, kind, "POINT").data.foreach_set(prop, arr.ravel())
    if custom:
        os.remove(path)
    roots = [o for o in new if o.parent is None]
    return roots, [o for o in new if o.type == "MESH"]


def untint(objs):
    """A final glb's COLOR_0 is a tint-zone mask, not a colour: the importer
    multiplies it into the base colour (as the glTF spec says), so route the
    albedo map straight to Base Color (the zones then show their authored,
    untinted colours)."""
    for o in objs:
        for slot in o.material_slots:
            m = slot.material
            if m is None or not m.use_nodes or "Principled BSDF" not in m.node_tree.nodes:
                continue
            nt = m.node_tree
            inp = nt.nodes["Principled BSDF"].inputs["Base Color"]
            if not inp.links or inp.links[0].from_node.type == "TEX_IMAGE":
                continue
            node = inp.links[0].from_node
            tex = next((lk.from_node for s_ in node.inputs for lk in s_.links if lk.from_node.type == "TEX_IMAGE"), None)
            if tex is not None:
                nt.links.new(tex.outputs["Color"], inp)


def pick_lod(objs):
    """A final glb: keep <Name>_LOD{LOD}, delete the other levels."""
    lods = [o for o in objs if "_LOD" in o.name]
    if not lods:
        return objs
    keep = [o for o in lods if o.name.endswith(f"_LOD{LOD}")]
    for o in lods:
        if o not in keep:
            bpy.data.objects.remove(o)
    return keep


def rig_for(glb, name):
    import json
    for p in (OPT.get("rig"), os.path.join(ROOT, "src", "data", f"{name}Rig.json"),
              os.path.join(os.path.dirname(glb), f"{name}Rig.json")):
        if p and os.path.exists(p):
            with open(p) as f:
                return json.load(f)
    return None


def fur_preview(objs, rig):
    """Shell fur as the game draws it (see the header)."""
    import bmesh
    import numpy as np
    for o in objs:
        slots = [i for i, s in enumerate(o.material_slots) if s.material and "Fur" in s.material.name]
        if not slots or rig is None:
            continue
        fur_mat = o.material_slots[slots[0]].material
        texs = [n for n in fur_mat.node_tree.nodes if n.type == "TEX_IMAGE"]
        tex = next(n for n in texs if n.image.colorspace_settings.name != "Non-Color")
        ntex = next((n for n in texs if n is not tex), None)
        atlas = rig.get("furAtlas")
        n_shell = int(OPT.get("fur-shells", rig["furShells"]))
        if n_shell < 1:
            continue
        L = rig["furMaxLength"]
        me = o.data
        col = me.color_attributes[0].name if len(me.color_attributes) else None
        bm = bmesh.new()
        bm.from_mesh(me)
        furl = bm.verts.layers.float_vector.get("_FUR") or bm.verts.layers.float_vector.get("_fur")
        if furl is None:      # imported as a 2D float attribute
            vals = np.zeros(len(me.vertices) * 2, np.float32)
            me.attributes["_FUR"].data.foreach_get("vector", vals)
            fv = vals.reshape(-1, 2)
        cl = bm.loops.layers.float_color.get(col) or bm.loops.layers.color.get(col)
        bm.verts.ensure_lookup_table()
        base_faces = [f for f in bm.faces if f.material_index == slots[0] and f.loops[0][cl][0] < 0.5]
        card_faces = [f for f in bm.faces if f.material_index == slots[0] and f.loops[0][cl][0] >= 0.5]

        def shell_mat(name, thr, use_attr):
            m = bpy.data.materials.new(name)
            m.use_nodes = True
            nt = m.node_tree
            b = nt.nodes["Principled BSDF"]
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = tex.image
            uv = nt.nodes.new("ShaderNodeUVMap")
            src = uv.outputs[0]
            if atlas and not use_attr:
                # shells and the base sample the atlas's tiling half:
                # (fract(u) x its width, fract(v)), as the game's shader does
                sep = nt.nodes.new("ShaderNodeSeparateXYZ")
                nt.links.new(src, sep.inputs[0])
                fu, fv = nt.nodes.new("ShaderNodeMath"), nt.nodes.new("ShaderNodeMath")
                fu.operation = fv.operation = "FRACT"
                nt.links.new(sep.outputs[0], fu.inputs[0])
                nt.links.new(sep.outputs[1], fv.inputs[0])
                su = nt.nodes.new("ShaderNodeMath")
                su.operation = "MULTIPLY"
                nt.links.new(fu.outputs[0], su.inputs[0])
                su.inputs[1].default_value = atlas["shells"][2] - atlas["shells"][0]
                cmb = nt.nodes.new("ShaderNodeCombineXYZ")
                nt.links.new(su.outputs[0], cmb.inputs[0])
                nt.links.new(fv.outputs[0], cmb.inputs[1])
                src = cmb.outputs[0]
            nt.links.new(src, t.inputs[0])
            if ntex is not None:          # the fur's strand normal map, same lookup
                tn = nt.nodes.new("ShaderNodeTexImage")
                tn.image = ntex.image
                nt.links.new(src, tn.inputs[0])
                nm = nt.nodes.new("ShaderNodeNormalMap")
                nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
                nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
            at = nt.nodes.new("ShaderNodeAttribute")
            at.attribute_name = "furx"
            wt = nt.nodes.new("ShaderNodeAttribute")
            wt.attribute_name = "furwet"
            ge = nt.nodes.new("ShaderNodeMath")
            ge.operation = "GREATER_THAN"
            nt.links.new(t.outputs["Alpha"], ge.inputs[0])
            if use_attr:
                nt.links.new(at.outputs["Fac"], ge.inputs[1])
            else:
                ge.inputs[1].default_value = thr - 1e-4
            dark = nt.nodes.new("ShaderNodeMix")
            dark.data_type = "RGBA"
            nt.links.new(wt.outputs["Fac"], dark.inputs[0])
            dark.blend_type = "MULTIPLY"
            dark.inputs[7].default_value = (0.7, 0.72, 0.7, 1)
            nt.links.new(t.outputs["Color"], dark.inputs[6])
            nt.links.new(dark.outputs[2], b.inputs["Base Color"])
            rough = nt.nodes.new("ShaderNodeMapRange")
            nt.links.new(wt.outputs["Fac"], rough.inputs[0])
            rough.inputs[3].default_value, rough.inputs[4].default_value = 0.65, 0.3
            nt.links.new(rough.outputs[0], b.inputs["Roughness"])
            nt.links.new(ge.outputs[0], b.inputs["Alpha"])
            return m

        def build(name, faces, h, thr, use_attr):
            nb = bmesh.new()
            vmap = {}
            x = nb.verts.layers.float.new("furx")
            w = nb.verts.layers.float.new("furwet")
            uvn = nb.loops.layers.uv.new("UVMap")
            uvo = bm.loops.layers.uv.active
            for f in faces:
                for v in f.verts:
                    if v not in vmap:
                        fx, fw = (v[furl][0], v[furl][1]) if furl else (fv[v.index][0], fv[v.index][1])
                        d = v.normal * (h * fx * L) + Vector((0, 0, -1)) * (0.6 * h * h * fx * L)
                        nv = nb.verts.new(o.matrix_world @ (v.co + d))
                        nv[x], nv[w] = fx, fw
                        vmap[v] = nv
                nf = nb.faces.new([vmap[v] for v in f.verts])
                for lo, ln in zip(f.loops, nf.loops):
                    ln[uvn].uv = lo[uvo].uv
            mesh = bpy.data.meshes.new(name)
            nb.to_mesh(mesh)
            nb.free()
            mesh.materials.append(shell_mat(name + "_mat", thr, use_attr))
            ob = bpy.data.objects.new(name, mesh)
            bpy.context.scene.collection.objects.link(ob)
            ob.data.shade_smooth() if hasattr(ob.data, "shade_smooth") else None
            return ob

        bm.normal_update()
        out = [build(f"{o.name}_shell{i:02d}", base_faces, i / n_shell, i / n_shell * 0.98, False)
               for i in range(0, n_shell + 1)]          # layer 0: the base, opaque
        if card_faces and "no-cards" not in FLAGS:
            out.append(build(f"{o.name}_cards", card_faces, 0.0, 0.0, True))
        bmesh.ops.delete(bm, geom=base_faces + card_faces, context="FACES")
        bm.to_mesh(me)
        bm.free()
        print("fur preview: %d shells over %d base faces, %d card faces" % (n_shell, len(base_faces), len(card_faces)))
        yield from out


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
    objs = pick_lod(objs)
    if any("_LOD" in o.name for o in objs):
        untint(objs)
    glassify(objs)
    lo, hi = bounds(objs)
    centre, radius = (lo + hi) / 2, (hi - lo).length / 2
    ext = hi - lo
    print("%s: extent (glTF x, y, z) %.3f %.3f %.3f" % (name, ext.x, ext.z, ext.y))
    face_pts = []
    for o in objs:      # a final glb: the face's parts by their _MOTION slot
        if "_MOTION" in o.data.attributes:
            mo = [0.0] * (len(o.data.vertices) * 4)
            o.data.attributes["_MOTION"].data.foreach_get("color", mo)
            face_pts += [o.matrix_world @ v.co for v in o.data.vertices
                         if round(mo[4 * v.index] * 16 - 0.5) in FACE_IDS.get(name, FACE_IDS["saucer"])]
    if any("_LOD" in o.name for o in objs) and OPT.get("fur-shells", "1") != "0":
        objs = objs + list(fur_preview(objs, rig_for(glb, name)))
    want = (lambda s: SHOTS is None or s in SHOTS)
    for az, key in ((30, 1), (120, 1), (210, 1), (300, -1)):
        if want(f"a{az:03d}"):
            shoot(sc, sun, cam, os.path.join(OUT, f"{name}_a{az:03d}.png"), centre, radius * 0.92, az, 18, key)
    # from below: the saucer's cannon and spikes, the tardigrade's legs and claws
    if want("under"):
        shoot(sc, sun, cam, os.path.join(OUT, f"{name}_under.png"), centre, radius * 0.92, 30, -32)
    # the face up close, fitted to the parts that make its expression
    face = [o for o in objs if any(k in o.name for k in FACE_PARTS)]
    if (face or face_pts) and want("face"):
        shoot(sc, sun, cam, os.path.join(OUT, f"{name}_face.png"), None, None, 22, 10, fit=face_pts or [
            o.matrix_world @ v.co for o in face for v in o.data.vertices], margin=0.12)
    if WITH_SHIP and want("scale"):
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
