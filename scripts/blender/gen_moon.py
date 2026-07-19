# Cratered moon: displaced icosphere with baked gray color+AO.
#   $BLENDER --background --python scripts/blender/gen_moon.py
import bpy
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils

bpy.ops.wm.read_factory_settings(use_empty=True)

bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1.0)
moon = bpy.context.object
moon.name = "Moon"

basin = bpy.data.textures.new("basins", type="VORONOI")
basin.noise_scale = 1.1
basin.contrast = 1.4
d0 = moon.modifiers.new("basins", "DISPLACE")
d0.texture = basin
d0.strength = -0.11
d0.mid_level = 0.32

vor = bpy.data.textures.new("craters", type="VORONOI")
vor.noise_scale = 0.45
vor.distance_metric = "DISTANCE"
d1 = moon.modifiers.new("craters", "DISPLACE")
d1.texture = vor
d1.strength = -0.22
d1.mid_level = 0.35

cl = bpy.data.textures.new("rough", type="CLOUDS")
cl.noise_scale = 0.3
d2 = moon.modifiers.new("rough", "DISPLACE")
d2.texture = cl
d2.strength = 0.05

mat = bpy.data.materials.new("MoonSurface")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.62, 0.62, 0.66, 1.0)
bsdf.inputs["Metallic"].default_value = 0.05
bsdf.inputs["Roughness"].default_value = 0.9
moon.data.materials.append(mat)

# Apply modifiers so the bake sees final geometry
bpy.context.view_layer.objects.active = moon
for m in list(moon.modifiers):
    bpy.ops.object.modifier_apply(modifier=m.name)
bpy.ops.object.shade_smooth()

img = bake_utils.bake_color_ao([moon], "moon_baked", size=1024, ao_samples=32)
baked = bake_utils.apply_baked_material([moon], img, "MoonBaked", metallic=0.0, roughness=0.9)
# Sculpt-detail normal bake: hi-poly duplicate -> tangent normal map on the lo mesh
hi = bake_utils.make_hipoly_detail(moon, subsurf_levels=2, noise_scale=0.1, noise_strength=0.03)
microcraters = bpy.data.textures.new("microcraters", type="VORONOI")
microcraters.noise_scale = 0.09
microcraters.contrast = 1.3
mc = hi.modifiers.new("microcraters", "DISPLACE")
mc.texture = microcraters
mc.strength = -0.035
mc.mid_level = 0.3
bpy.context.view_layer.objects.active = hi
bpy.ops.object.modifier_apply(modifier=mc.name)
nimg = bake_utils.bake_normal_from_hipoly(moon, hi, "moon_normal", size=1024)
bake_utils.attach_normal_map(baked, nimg)
bpy.data.objects.remove(hi, do_unlink=True)

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "moon.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
print("wrote", out)
