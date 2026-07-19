# Irregular icy chunk, emissive — bloom does the glow. No bake needed.
import bpy
import os

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=5, radius=1.0)
head = bpy.context.object
head.name = "CometHead"
tex = bpy.data.textures.new("chunks", type="CLOUDS")
tex.noise_scale = 0.55
d = head.modifiers.new("disp", "DISPLACE")
d.texture = tex
d.strength = 0.35
bpy.context.view_layer.objects.active = head
bpy.ops.object.modifier_apply(modifier="disp")
bpy.ops.object.shade_smooth()

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils

# Rocky-ice surface: patterned via a second crater displace + baked color+AO.
vor = bpy.data.textures.new("pits", type="VORONOI")
vor.noise_scale = 0.35
d2 = head.modifiers.new("pits", "DISPLACE")
d2.texture = vor
d2.strength = -0.15
d2.mid_level = 0.4
bpy.ops.object.modifier_apply(modifier="pits")

fine = bpy.data.textures.new("fine_ice", type="CLOUDS")
fine.noise_scale = 0.1
fine.noise_depth = 4
d3 = head.modifiers.new("fine", "DISPLACE")
d3.texture = fine
d3.strength = 0.05
bpy.ops.object.modifier_apply(modifier="fine")

mat = bpy.data.materials.new("IceRock")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 0.85
noise = nt.nodes.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value = 6.0
noise.inputs["Detail"].default_value = 8.0
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].color = (0.10, 0.11, 0.13, 1.0)   # dark sooty rock
ramp.color_ramp.elements[1].color = (0.62, 0.74, 0.82, 1.0)   # clean blue ice
nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
head.data.materials.append(mat)

img = bake_utils.bake_color_ao([head], "comet_baked", size=512, ao_samples=32)
baked = bake_utils.apply_baked_material([head], img, "CometBaked", metallic=0.05, roughness=0.85)
hi = bake_utils.make_hipoly_detail(head, subsurf_levels=2, noise_scale=0.08, noise_strength=0.05)
micropits = bpy.data.textures.new("micropits", type="VORONOI")
micropits.noise_scale = 0.06
micropits.contrast = 1.3
mp = hi.modifiers.new("micropits", "DISPLACE")
mp.texture = micropits
mp.strength = -0.03
mp.mid_level = 0.3
bpy.context.view_layer.objects.active = hi
bpy.ops.object.modifier_apply(modifier=mp.name)
nimg = bake_utils.bake_normal_from_hipoly(head, hi, "comet_normal", size=512)
bake_utils.attach_normal_map(baked, nimg)
bpy.data.objects.remove(hi, do_unlink=True)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "comet_head.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
print("wrote", out)
