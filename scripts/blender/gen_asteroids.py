# Four asteroid variants — distinct silhouettes (boulder / shard / contact
# binary / rubble chunk), faceted like fractured rock, with baked two-tone
# color+AO and hi-poly crater detail in the normal map.
#   $BLENDER --background --python scripts/blender/gen_asteroids.py
# Recipe frozen from a live MCP viewport session (2026-07-19).
import bpy
import bmesh
import math
import os
import sys
from mathutils import Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils

bpy.ops.wm.read_factory_settings(use_empty=True)


def tex(name, ttype, **kw):
    t = bpy.data.textures.new(name, type=ttype)
    for k, v in kw.items():
        setattr(t, k, v)
    return t


def apply_modifiers(o):
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    old = o.data
    o.data = mesh
    o.modifiers.clear()
    bpy.data.meshes.remove(old)


def facet_and_smooth(o, dissolve_deg, sharp_deg):
    """Planar-decimate into rocky facets, then smooth-shade with sharp fracture edges."""
    dec = o.modifiers.new("facet", "DECIMATE")
    dec.decimate_type = "DISSOLVE"
    dec.angle_limit = math.radians(dissolve_deg)
    # Triangulate immediately: the dissolve leaves n-gons whose exported
    # triangulation would disagree with the tangents the normal map was
    # baked against (shows up as black speckles at crevices).
    tri = o.modifiers.new("tri", "TRIANGULATE")
    tri.quad_method = "BEAUTY"
    apply_modifiers(o)
    mesh = o.data
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    bm = bmesh.new()
    bm.from_mesh(mesh)
    limit = math.radians(sharp_deg)
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle() > limit:
            e.smooth = False
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def make_rock(name, x, subdivs, stretch, layers, dissolve=7.0, sharp=26.0, relax=0):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivs, radius=1.0, location=(x, 0, 0))
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.transform(Matrix.Diagonal((*stretch, 1.0)))
    for t, s, m in layers:
        d = o.modifiers.new(t.name, "DISPLACE")
        d.texture = t
        d.strength = s
        d.mid_level = m
    if relax:
        sm = o.modifiers.new("relax", "SMOOTH")
        sm.factor = 0.55
        sm.iterations = relax
    apply_modifiers(o)
    facet_and_smooth(o, dissolve, sharp)
    return o


def rock_material(o, dark, light, ore=None, ore_amount=0.0):
    """Two-tone noise-driven rock color (+ optional ore-vein tint) for the bake."""
    m = bpy.data.materials.new(o.name + "_src")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.92
    bsdf.inputs["Metallic"].default_value = 0.05

    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 7.0
    noise.inputs["Detail"].default_value = 8.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*dark, 1.0)
    ramp.color_ramp.elements[1].color = (*light, 1.0)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    out_color = ramp.outputs["Color"]

    if ore and ore_amount > 0.0:
        vein = nt.nodes.new("ShaderNodeTexNoise")
        vein.inputs["Scale"].default_value = 3.5
        vein.inputs["Detail"].default_value = 6.0
        vein.inputs["Distortion"].default_value = 2.0
        vein_ramp = nt.nodes.new("ShaderNodeValToRGB")
        # narrow band -> thin veins
        vein_ramp.color_ramp.elements[0].position = 0.62
        vein_ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
        vein_ramp.color_ramp.elements[1].position = 0.68
        vein_ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
        nt.links.new(vein.outputs["Fac"], vein_ramp.inputs["Fac"])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs["Factor"].default_value = ore_amount
        nt.links.new(vein_ramp.outputs["Color"], mix.inputs["Factor"])
        mix.inputs["A"].default_value = (0, 0, 0, 1)
        nt.links.new(out_color, mix.inputs["A"])
        mix.inputs["B"].default_value = (*ore, 1.0)
        out_color = mix.outputs["Result"]

    nt.links.new(out_color, bsdf.inputs["Base Color"])
    o.data.materials.append(m)
    return m


def make_hipoly_crater_detail(lo):
    """Hi-poly duplicate with small craters + regolith micro-noise for normal baking."""
    bpy.ops.object.select_all(action="DESELECT")
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.duplicate()
    hi = bpy.context.view_layer.objects.active
    hi.name = lo.name + "_hipoly"
    sub = hi.modifiers.new("detail_sub", "SUBSURF")
    sub.subdivision_type = "SIMPLE"
    sub.levels = 2
    sub.render_levels = 2
    craters = hi.modifiers.new("craters", "DISPLACE")
    craters.texture = tex(hi.name + "_craters", "VORONOI", noise_scale=0.12, contrast=1.3)
    craters.strength = -0.05
    craters.mid_level = 0.3
    micro = hi.modifiers.new("micro", "DISPLACE")
    micro.texture = tex(hi.name + "_micro", "CLOUDS", noise_scale=0.04, noise_depth=4)
    micro.strength = 0.015
    for m in list(hi.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    return hi


# ---- Build the 4 variants (recipe from live session) ----
v0 = make_rock("Asteroid0", -4.5, 5, (1.0, 0.95, 1.05), [
    (tex("v0_bites", "VORONOI", noise_scale=2.0, distance_metric="MANHATTAN", contrast=1.5), -0.4, 0.3),
    (tex("v0_craters", "VORONOI", noise_scale=0.6, contrast=1.2), -0.18, 0.28),
    (tex("v0_rough", "CLOUDS", noise_scale=0.14, noise_depth=3), 0.04, 0.5),
], dissolve=7, sharp=22, relax=4)

v1 = make_rock("Asteroid1", -1.5, 4, (1.15, 0.8, 0.95), [
    (tex("v1_facets", "VORONOI", noise_scale=1.1, distance_metric="CHEBYCHEV", contrast=1.3), 0.7, 0.5),
    (tex("v1_chunks", "VORONOI", noise_scale=0.6, distance_metric="MANHATTAN"), -0.3, 0.45),
    (tex("v1_rough", "CLOUDS", noise_scale=0.18, noise_depth=2), 0.03, 0.5),
], dissolve=9, sharp=20)

v2 = make_rock("Asteroid2", 1.5, 5, (1.75, 0.85, 0.75), [
    (tex("v2_lobes", "CLOUDS", noise_scale=1.6, noise_depth=1), 0.45, 0.4),
    (tex("v2_neck", "VORONOI", noise_scale=1.0, contrast=1.4), -0.26, 0.33),
    (tex("v2_craters", "VORONOI", noise_scale=0.4), -0.14, 0.3),
    (tex("v2_rough", "CLOUDS", noise_scale=0.11, noise_depth=3), 0.03, 0.5),
], dissolve=5, sharp=30, relax=6)

v3 = make_rock("Asteroid3", 4.5, 5, (1.05, 1.1, 0.9), [
    (tex("v3_boulders", "STUCCI", noise_scale=0.8, turbulence=9.0), 0.4, 0.35),
    (tex("v3_bites", "VORONOI", noise_scale=0.55, distance_metric="MANHATTAN", contrast=1.3), -0.28, 0.3),
    (tex("v3_fine", "CLOUDS", noise_scale=0.1, noise_depth=3), 0.035, 0.5),
], dissolve=8, sharp=24)

rocks = [v0, v1, v2, v3]

# Per-variant rock palettes (dark, light, ore, ore_amount)
palettes = [
    ((0.045, 0.040, 0.036), (0.30, 0.27, 0.24), None, 0.0),            # gray-brown boulder
    ((0.035, 0.038, 0.048), (0.26, 0.27, 0.31), None, 0.0),            # slate shard
    ((0.055, 0.044, 0.030), (0.34, 0.28, 0.20), (0.45, 0.28, 0.10), 0.5),  # tan + rust veins
    ((0.040, 0.040, 0.040), (0.29, 0.28, 0.27), (0.55, 0.45, 0.20), 0.4),  # gray + gold flecks
]
for o, (dark, light, ore, amt) in zip(rocks, palettes):
    rock_material(o, dark, light, ore, amt)

# ---- Bake each variant: color x AO + hi-poly crater normal map ----
for i, o in enumerate(rocks):
    img = bake_utils.bake_color_ao([o], "asteroid{:d}_baked".format(i), size=512, ao_samples=32)
    baked = bake_utils.apply_baked_material([o], img, "Asteroid{:d}Baked".format(i), metallic=0.05, roughness=0.92)
    hi = make_hipoly_crater_detail(o)
    nimg = bake_utils.bake_normal_from_hipoly(o, hi, "asteroid{:d}_normal".format(i), size=512, extrusion=0.2)
    bake_utils.attach_normal_map(baked, nimg)
    bpy.data.objects.remove(hi, do_unlink=True)
    print("baked variant", i)

# ---- Export all four to one GLB ----
bpy.ops.object.select_all(action="DESELECT")
for o in rocks:
    o.select_set(True)
out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "asteroids.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True)
print("wrote", out)
