# Shared final-stage kit for the space monsters (gen_saucer.py now; the
# tardigrade's final stage, Task 4, can reuse it): procedural Cycles bake
# materials, the exploded selected-to-active bake from the sculpted high
# meshes onto the game mesh (supersampled 2x, box-filtered down, as
# gen_probe.py does), the tiling shell-fur strand texture, and a glb tidy-up.
#
# Bake materials ("BAKE_<name>") carry the look as node fields; set_mode()
# routes each material's output to what a pass needs: the albedo or the
# packed (0, roughness, metalness) or the emission as an Emission shader
# (EMIT bakes), or the Principled BSDF with its bump (the NORMAL bake).
# Materials read their coordinates from mesh attributes the generators
# write on the high meshes ("gp" the glTF-space position, "lc" a part's own
# local frame, "ft" a per-part scalar), so a pattern is laid out in the
# model's units however the part is placed.
#
# Nothing here is random except through the seeds passed in: re-runs are
# byte-identical (Cycles CPU bakes with a fixed seed, numpy seeded).
import json
import math
import struct

import bpy
import numpy as np
from mathutils import Vector


# ------------------------------------------------------------------ nodes ---
class Nodes:
    """Terse node building in one material's tree. Inputs may be numbers,
    tuples or sockets."""

    def __init__(self, nt):
        self.nt = nt
        self._attr = {}

    def new(self, kind, **inputs):
        n = self.nt.nodes.new(kind)
        for k, v in inputs.items():
            n.inputs[k].default_value = v
        return n

    def _in(self, sock, v):
        if isinstance(v, (int, float)):
            sock.default_value = v
        elif isinstance(v, tuple):
            sock.default_value = v if len(v) == len(sock.default_value) else (*v, 1.0)
        else:
            self.nt.links.new(v, sock)

    def val(self, v):
        n = self.nt.nodes.new("ShaderNodeValue")
        n.outputs[0].default_value = v
        return n.outputs[0]

    def rgb(self, c):
        n = self.nt.nodes.new("ShaderNodeRGB")
        n.outputs[0].default_value = (*c, 1.0)
        return n.outputs[0]

    def m(self, op, a, b=None, c=None, clamp=False):
        n = self.nt.nodes.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        for i, x in enumerate((a, b, c)):
            if x is not None:
                self._in(n.inputs[i], x)
        return n.outputs[0]

    def add(self, *xs):
        out = xs[0]
        for x in xs[1:]:
            out = self.m("ADD", out, x)
        return out

    def mul(self, *xs):
        out = xs[0]
        for x in xs[1:]:
            out = self.m("MULTIPLY", out, x)
        return out

    def sub(self, a, b):
        return self.m("SUBTRACT", a, b)

    def v(self, op, a, b=None, scale=None):
        """Vector math; returns the Vector output (or Value for DOT/LENGTH/DISTANCE)."""
        n = self.nt.nodes.new("ShaderNodeVectorMath")
        n.operation = op
        if a is not None:
            self._in(n.inputs[0], a)
        if b is not None:
            self._in(n.inputs[1], b)
        if scale is not None:
            self._in(n.inputs[3], scale)
        return n.outputs["Value" if op in ("DOT_PRODUCT", "LENGTH", "DISTANCE") else "Vector"]

    def xyz(self, vec):
        n = self.new("ShaderNodeSeparateXYZ")
        self._in(n.inputs[0], vec)
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def vec(self, x, y, z):
        n = self.new("ShaderNodeCombineXYZ")
        for i, s in enumerate((x, y, z)):
            self._in(n.inputs[i], s)
        return n.outputs[0]

    def chan(self, col, i):
        n = self.new("ShaderNodeSeparateColor")
        self._in(n.inputs[0], col)
        return n.outputs[i]

    def mix(self, fac, a, b):
        """Linear colour mix a -> b by fac."""
        n = self.new("ShaderNodeMix")
        n.data_type = "RGBA"
        n.clamp_factor = True
        self._in(n.inputs[0], fac)
        self._in(n.inputs[6], a)
        self._in(n.inputs[7], b)
        return n.outputs[2]

    def mixf(self, fac, a, b):
        n = self.new("ShaderNodeMix")
        n.data_type = "FLOAT"
        n.clamp_factor = True
        self._in(n.inputs[0], fac)
        self._in(n.inputs[2], a)
        self._in(n.inputs[3], b)
        return n.outputs[0]

    def scale(self, col, s):
        return self.v("SCALE", col, scale=s)

    def mapr(self, x, a, b, c=0.0, d=1.0, smooth=False):
        """Clamped remap of x from [a, b] to [c, d] (smoothstep-shaped if smooth)."""
        n = self.new("ShaderNodeMapRange")
        n.clamp = True
        if smooth:
            n.interpolation_type = "SMOOTHSTEP"
        self._in(n.inputs[0], x)
        for i, v in enumerate((a, b, c, d), 1):
            self._in(n.inputs[i], v)
        return n.outputs[0]

    def noise(self, co, scale, detail=3.0, rough=0.5, dist=0.0, w=0.0):
        n = self.new("ShaderNodeTexNoise", Scale=scale, Detail=detail, Roughness=rough, Distortion=dist)
        n.noise_dimensions = "4D"
        n.inputs["W"].default_value = w
        self._in(n.inputs["Vector"], co)
        return n.outputs["Fac"]

    def vor(self, co, scale, feature="F1", rand=1.0, dims="3D"):
        """Voronoi node (outputs Distance, Color, Position)."""
        n = self.new("ShaderNodeTexVoronoi")
        n.voronoi_dimensions = dims
        n.feature = feature
        n.inputs["Scale"].default_value = scale
        n.inputs["Randomness"].default_value = rand
        self._in(n.inputs["Vector"], co)
        return n

    def attr(self, name):
        if name not in self._attr:
            n = self.new("ShaderNodeAttribute")
            n.attribute_name = name
            self._attr[name] = n
        return self._attr[name]

    def gp(self):
        return self.attr("gp").outputs["Vector"]

    def lc(self):
        return self.attr("lc").outputs["Vector"]

    def ft(self):
        return self.attr("ft").outputs["Fac"]

    def world_normal(self):
        return self.new("ShaderNodeNewGeometry").outputs["Normal"]

    def bevel_edge(self, radius, lo=0.999, hi=0.86):
        """0 on a flat face rising to 1 on a sharp edge (within `radius`)."""
        b = self.new("ShaderNodeBevel", Radius=radius)
        b.samples = 16
        g = self.new("ShaderNodeNewGeometry")
        return self.mapr(self.v("DOT_PRODUCT", b.outputs["Normal"], g.outputs["Normal"]), lo, hi)


# -------------------------------------------------------------- materials ---
REGISTRY = {}


def bake_material(name, recipe):
    """recipe(N) -> dict(albedo, rough, metal, height=None, emit=None): RGB
    (linear, metals carry F0) or float values, as tuples, numbers or sockets.
    height is a displacement in model units (fed to a Bump node at distance 1)."""
    m = bpy.data.materials.new("BAKE_" + name)
    m.use_nodes = True
    nt = m.node_tree
    N = Nodes(nt)
    bsdf = nt.nodes["Principled BSDF"]
    out = recipe(N)

    def sock(v, rgb):
        if isinstance(v, (int, float)):
            return N.val(float(v))
        if isinstance(v, tuple):
            return N.rgb(v) if rgb else N.val(float(v[0]))
        return v

    alb = sock(out["albedo"], True)
    rough, metal = sock(out["rough"], False), sock(out["metal"], False)
    if out.get("height") is not None:
        b = N.new("ShaderNodeBump", Strength=1.0, Distance=1.0)
        nt.links.new(sock(out["height"], False), b.inputs["Height"])
        nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    e_alb = N.new("ShaderNodeEmission", Strength=1.0)
    nt.links.new(alb, e_alb.inputs["Color"])
    comb = N.new("ShaderNodeCombineColor")
    nt.links.new(rough, comb.inputs[1])
    nt.links.new(metal, comb.inputs[2])
    e_mr = N.new("ShaderNodeEmission", Strength=1.0)
    nt.links.new(comb.outputs[0], e_mr.inputs["Color"])
    e_em = N.new("ShaderNodeEmission", Strength=1.0)
    emit = out.get("emit")
    if emit is None:
        e_em.inputs["Color"].default_value = (0, 0, 0, 1)
    else:
        N._in(e_em.inputs["Color"], emit)
    REGISTRY[name] = (m, bsdf, e_alb, e_mr, e_em)
    return m


def set_mode(mode):
    """Route every bake material's surface to one pass: albedo, mr, emit or normal."""
    for m, bsdf, e_alb, e_mr, e_em in REGISTRY.values():
        src = {"normal": bsdf.outputs[0], "albedo": e_alb.outputs[0], "mr": e_mr.outputs[0],
               "emit": e_em.outputs[0]}[mode]
        m.node_tree.links.new(src, m.node_tree.nodes["Material Output"].inputs["Surface"])


# ------------------------------------------------------------------ bakes ---
def new_img(name, size, float_buffer=True):
    """A float bake target (linear values, no 8-bit banding in the darks)."""
    img = bpy.data.images.new(name, width=size, height=size, alpha=False, float_buffer=float_buffer)
    img.colorspace_settings.name = "Non-Color"
    return img


def attach_target(ob, img):
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        node = nt.nodes.get("BakeTarget") or nt.nodes.new("ShaderNodeTexImage")
        node.name = "BakeTarget"
        node.image = img
        nt.nodes.active = node


def activate(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def bake(target, sources, kind, img, samples, margin, extrusion=0.04, max_ray=0.12):
    """Bake `kind` into img on target's UVs; from `sources` (selected to
    active) when given, else from target itself."""
    sc = bpy.context.scene
    attach_target(target, img)
    sc.cycles.samples = samples
    sc.render.bake.margin = margin
    sc.render.bake.margin_type = "EXTEND"
    activate(target)
    kw = {}
    if sources:
        for s in sources:
            s.select_set(True)
        kw = dict(use_selected_to_active=True, cage_extrusion=extrusion, max_ray_distance=max_ray)
    bpy.ops.object.bake(type=kind, use_clear=True, margin=margin, **kw)


def pixels(img):
    n = img.size[0]
    a = np.empty(n * n * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(n, n, 4)


def down(a, size):
    """Box-filter a square float image down to size (supersampled bakes)."""
    f = a.shape[0] // size
    return a.reshape(size, f, size, f, a.shape[-1]).mean(axis=(1, 3))


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def to_image(name, rgba, noncolor=False, alpha=False):
    size = rgba.shape[0]
    img = bpy.data.images.new(name, width=size, height=size, alpha=alpha)
    if noncolor:
        img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.pack()
    return img


# --------------------------------------------------------------- shell fur ---
def fur_strand_texture(size, seed, clump_cells=8, strands=90000, r_px=(1.1, 2.1), flyaway=0.06, clump=0.78,
                       taper=0.5, base=0.5,
                       root=(0.008, 0.024, 0.007), tip=(0.10, 0.20, 0.045), tip_hi=(0.19, 0.30, 0.085)):
    """A tiling (torus) strand/clump mask for shell fur, size x size RGBA, linear.

    alpha is each texel's strand height in [0, 1]: a shell at height h of the
    fur's length keeps the texels whose alpha >= h, so the coat is dense at
    the roots and thins outward to the strand tips (the coverage falls
    smoothly with height, printed when the mask is made, so no shell is a
    solid sheet and none is empty). A strand is a soft dot whose height falls
    off from its centre, so each strand also thins toward its tip. Strands
    gather in clumps (wet fur mats): a strand's reach falls with its distance
    from its clump's centre, so the outer shells keep the clump cores and
    every clump tapers to a point (`clump` sets how strongly: 0 none, 1 every
    clump a cone); `taper` shapes a strand's cross-section (0.5 a round tip,
    lower keeps it full until near its end); a few flyaway strands reach high
    anywhere
    (the coat's fuzz). RGB is the strand colour by height: dark roots (root)
    to lighter tips (tip; a few clumps tip_hi), so the coat's depth shades
    itself.
    """
    rng = np.random.default_rng(seed)
    n = clump_cells
    cx = (np.arange(n)[:, None] + 0.5 + rng.uniform(-0.4, 0.4, (n, n))) / n
    cy = (np.arange(n)[None, :] + 0.5 + rng.uniform(-0.4, 0.4, (n, n))) / n
    centres = np.stack([np.broadcast_to(cx, (n, n)).ravel(), np.broadcast_to(cy, (n, n)).ravel()], -1)
    c_tone = rng.uniform(0.0, 1.0, n * n) ** 2
    c_reach = rng.uniform(0.82, 1.0, n * n)
    alpha = np.zeros((size, size), np.float32)
    tone = np.zeros((size, size), np.float32)
    pos = rng.uniform(0, 1, (strands, 2))
    rad = rng.uniform(r_px[0], r_px[1], strands)
    jitter = rng.uniform(0.0, 1.0, strands)
    fly = rng.uniform(0, 1, strands) < flyaway
    # clumps are irregular, not discs: the strands' positions are warped by a
    # smooth periodic field (integer frequencies, so it still tiles) before
    # they are given to their nearest clump centre
    wp = pos.copy()
    for fx, fy, amp in ((1, 2, 0.045), (3, 1, 0.03), (2, 3, 0.02)):
        ph = rng.uniform(0, 2 * np.pi, 2)
        wp[:, 0] += amp * np.sin(2 * np.pi * (fx * pos[:, 1] + fy * pos[:, 0]) + ph[0])
        wp[:, 1] += amp * np.sin(2 * np.pi * (fy * pos[:, 0] - fx * pos[:, 1]) + ph[1])
    d = wp[:, None, :] - centres[None, :, :]
    d -= np.round(d)
    dist = np.sqrt((d ** 2).sum(-1))
    k = dist.argmin(1)
    dk = np.clip(dist[np.arange(strands), k] / (0.75 / n), 0, 1.4)
    # reach: the clump's core strands long, its edge short; flyaways long anywhere
    h_strand = c_reach[k] * (base + (1 - base) * jitter ** 0.6) * (1.0 - clump * np.clip(dk, 0, 1) ** 1.25)
    h_strand = np.where(fly, rng.uniform(0.7, 1.0, strands), h_strand).clip(0.04, 1.0)
    order = np.argsort(h_strand)          # tall strands drawn last win
    for i in order:
        px, py, r = pos[i, 0] * size, pos[i, 1] * size, rad[i]
        x0, x1 = int(math.floor(px - r)), int(math.ceil(px + r)) + 1
        y0, y1 = int(math.floor(py - r)), int(math.ceil(py + r)) + 1
        xs, ys = np.arange(x0, x1), np.arange(y0, y1)
        gx, gy = np.meshgrid(xs + 0.5 - px, ys + 0.5 - py)
        prof = np.clip(1.0 - (gx * gx + gy * gy) / (r * r), 0.0, 1.0)
        h = h_strand[i] * prof ** taper
        yy, xx = np.ix_(ys % size, xs % size)
        cur = alpha[yy, xx]
        win = h > cur
        alpha[yy, xx] = np.where(win, h, cur)
        tone[yy, xx] = np.where(win, c_tone[k[i]], tone[yy, xx])
    a = alpha[..., None]
    root, tip, tip_hi = (np.array(c, np.float32) for c in (root, tip, tip_hi))
    tipc = tip + (tip_hi - tip) * tone[..., None]
    rgb = root + (tipc - root) * np.clip(a, 0, 1) ** 0.75
    cover = {h: round(float((alpha >= h).mean()), 3) for h in (0.02, 0.1, 0.25, 0.4, 0.55, 0.75, 0.9)}
    print("fur mask coverage by shell height", cover)
    return np.concatenate([rgb, a], -1).astype(np.float32)


# ------------------------------------------------------------------- glb ---
def glb_drop_attributes(path, drop):
    """Remove vertex attributes from primitives by material name, e.g.
    {"SaucerDome": ["COLOR_0", "TEXCOORD_0"]}. Blender writes every mesh
    attribute on every primitive of a mesh; the accessors left unused are
    dropped by the optimizer's prune(). Edits the JSON chunk only."""
    with open(path, "rb") as f:
        data = f.read()
    magic, version, _ = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and version == 2
    jlen, jtype = struct.unpack_from("<I4s", data, 12)
    assert jtype == b"JSON"
    doc = json.loads(data[20:20 + jlen])
    rest = data[20 + jlen:]
    names = [m.get("name") for m in doc.get("materials", [])]
    for mesh in doc.get("meshes", []):
        for p in mesh["primitives"]:
            for sem in drop.get(names[p["material"]] if "material" in p else None, ()):
                p["attributes"].pop(sem, None)
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    out = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(js) + len(rest)) + struct.pack("<I4s", len(js), b"JSON") + js + rest
    with open(path, "wb") as f:
        f.write(out)
