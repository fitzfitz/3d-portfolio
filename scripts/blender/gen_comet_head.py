# Realistic comet nucleus, built to docs/superpowers/specs/2026-07-19-realistic-comet-spec.md:
# bilobed 67P-class body (N1), coal-dark crust albedo ~0.04-0.06 (N2), pitted/
# bouldered/cliff-faceted surface (N3), sparse exposed-ice patches (N4).
#   $BLENDER --background --python scripts/blender/gen_comet_head.py
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


# --- N1: two unequal lobes + narrow neck, merged into one body ---
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1.0, location=(0, 0, 0))
big = bpy.context.view_layer.objects.active
big.data.transform(Matrix.Diagonal((1.15, 0.95, 0.75, 1.0)))  # 67P big lobe ~4.1x3.5x1.6 proportions

bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=0.62, location=(1.35, 0.1, 0.28))
small = bpy.context.view_layer.objects.active
small.data.transform(Matrix.Diagonal((1.0, 0.85, 0.75, 1.0)))

bpy.ops.object.select_all(action="DESELECT")
big.select_set(True)
small.select_set(True)
bpy.context.view_layer.objects.active = big
bpy.ops.object.join()
head = bpy.context.view_layer.objects.active
head.name = "CometHead"

# Voxel remesh fuses the lobes with a smooth narrow neck
rm = head.modifiers.new("fuse", "REMESH")
rm.mode = "VOXEL"
rm.voxel_size = 0.09
apply_modifiers(head)

# --- N3: pits, boulders, layering; cliff facets from planar decimate ---
for t, s, m in (
    (tex("pits", "VORONOI", noise_scale=0.4, contrast=1.3), -0.16, 0.35),
    (tex("boulders", "STUCCI", noise_scale=0.28, turbulence=7.0), 0.07, 0.45),
    (tex("layers", "WOOD", noise_scale=0.5, noise_basis_2="TRI"), 0.03, 0.5),
    (tex("rough", "CLOUDS", noise_scale=0.1, noise_depth=4), 0.045, 0.5),
):
    d = head.modifiers.new(t.name, "DISPLACE")
    d.texture = t
    d.strength = s
    d.mid_level = m
sm = head.modifiers.new("relax", "SMOOTH")
sm.factor = 0.4
sm.iterations = 2
dec = head.modifiers.new("facet", "DECIMATE")
dec.decimate_type = "DISSOLVE"
dec.angle_limit = math.radians(5)
tri = head.modifiers.new("tri", "TRIANGULATE")
tri.quad_method = "BEAUTY"
apply_modifiers(head)

mesh = head.data
mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
bm = bmesh.new()
bm.from_mesh(mesh)
limit = math.radians(26)
for e in bm.edges:
    if len(e.link_faces) == 2 and e.calc_face_angle() > limit:
        e.smooth = False  # cliff edges read sharp
bm.to_mesh(mesh)
bm.free()
mesh.update()
print("nucleus tris:", len(mesh.polygons))

# --- N2 + N4: coal-dark crust with sparse bright ice patches ---
mat = bpy.data.materials.new("CometCrust")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.96
bsdf.inputs["Metallic"].default_value = 0.0

crust_noise = nt.nodes.new("ShaderNodeTexNoise")
crust_noise.inputs["Scale"].default_value = 5.5
crust_noise.inputs["Detail"].default_value = 8.0
crust_ramp = nt.nodes.new("ShaderNodeValToRGB")
crust_ramp.color_ramp.elements[0].color = (0.028, 0.026, 0.024, 1.0)  # albedo ~0.03
crust_ramp.color_ramp.elements[1].color = (0.070, 0.064, 0.058, 1.0)  # albedo ~0.07
nt.links.new(crust_noise.outputs["Fac"], crust_ramp.inputs["Fac"])

# Ice: high-threshold voronoi -> few isolated bright patches (~3% coverage)
ice_noise = nt.nodes.new("ShaderNodeTexVoronoi")
ice_noise.inputs["Scale"].default_value = 7.0
ice_ramp = nt.nodes.new("ShaderNodeValToRGB")
ice_ramp.color_ramp.elements[0].position = 0.08
ice_ramp.color_ramp.elements[0].color = (1, 1, 1, 1)
ice_ramp.color_ramp.elements[1].position = 0.17
ice_ramp.color_ramp.elements[1].color = (0, 0, 0, 1)
nt.links.new(ice_noise.outputs["Distance"], ice_ramp.inputs["Fac"])
# Break the round voronoi patches with a ragged noise mask (real exposed ice
# is irregular debris-field patches, not polka dots)
ragged = nt.nodes.new("ShaderNodeTexNoise")
ragged.inputs["Scale"].default_value = 22.0
ragged.inputs["Detail"].default_value = 6.0
ragged_ramp = nt.nodes.new("ShaderNodeValToRGB")
ragged_ramp.color_ramp.elements[0].position = 0.34
ragged_ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
ragged_ramp.color_ramp.elements[1].position = 0.5
ragged_ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
nt.links.new(ragged.outputs["Fac"], ragged_ramp.inputs["Fac"])
ice_mask = nt.nodes.new("ShaderNodeMix")
ice_mask.data_type = "RGBA"
ice_mask.blend_type = "MULTIPLY"
ice_mask.inputs["Factor"].default_value = 1.0
nt.links.new(ice_ramp.outputs["Color"], ice_mask.inputs["A"])
nt.links.new(ragged_ramp.outputs["Color"], ice_mask.inputs["B"])
mix = nt.nodes.new("ShaderNodeMix")
mix.data_type = "RGBA"
nt.links.new(ice_mask.outputs["Result"], mix.inputs["Factor"])
nt.links.new(crust_ramp.outputs["Color"], mix.inputs["A"])
mix.inputs["B"].default_value = (0.55, 0.62, 0.68, 1.0)  # exposed H2O ice
nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
head.data.materials.append(mat)

# --- bake: color x AO + hi-poly micro detail normal map ---
img = bake_utils.bake_color_ao([head], "comet_baked", size=512, ao_samples=32)
baked = bake_utils.apply_baked_material([head], img, "CometBaked", metallic=0.0, roughness=0.96)
hi = bake_utils.make_hipoly_detail(head, subsurf_levels=2, noise_scale=0.07, noise_strength=0.03)
micropits = tex("micropits", "VORONOI", noise_scale=0.05, contrast=1.3)
mp = hi.modifiers.new("micropits", "DISPLACE")
mp.texture = micropits
mp.strength = -0.025
mp.mid_level = 0.3
bpy.context.view_layer.objects.active = hi
bpy.ops.object.modifier_apply(modifier=mp.name)
nimg = bake_utils.bake_normal_from_hipoly(head, hi, "comet_normal", size=512, extrusion=0.15)
bake_utils.attach_normal_map(baked, nimg)
bpy.data.objects.remove(hi, do_unlink=True)

bpy.ops.object.select_all(action="DESELECT")
head.select_set(True)
out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "comet_head.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True, use_selection=True)
print("wrote", out)
