# Irregular icy chunk, emissive — bloom does the glow. No bake needed.
import bpy
import os

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1.0)
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
d2.strength = -0.12
d2.mid_level = 0.4
bpy.ops.object.modifier_apply(modifier="pits")

mat = bpy.data.materials.new("IceRock")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.55, 0.66, 0.72, 1.0)
bsdf.inputs["Roughness"].default_value = 0.85
head.data.materials.append(mat)

img = bake_utils.bake_color_ao([head], "comet_baked", size=512, ao_samples=32)
bake_utils.apply_baked_material([head], img, "CometBaked", metallic=0.05, roughness=0.85)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "comet_head.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
print("wrote", out)
