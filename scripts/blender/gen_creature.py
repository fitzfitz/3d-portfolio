# Generates the space-jellyfish body. Bell = displaced subdivided sphere; 6 tapered tentacles.
#   $BLENDER --background --python scripts/blender/gen_creature.py
import bpy
import math
import os

bpy.ops.wm.read_factory_settings(use_empty=True)

# Bell: squashed sphere with subdivision + noise displacement for an organic silhouette
bpy.ops.mesh.primitive_uv_sphere_add(radius=1.0, segments=32, ring_count=16)
bell = bpy.context.object
bell.name = "bell"
bell.scale = (1.0, 1.0, 0.72)
sub = bell.modifiers.new("subsurf", "SUBSURF")
sub.levels = 2
sub.render_levels = 2
tex = bpy.data.textures.new("lumps", type="CLOUDS")
tex.noise_scale = 0.55
disp = bell.modifiers.new("disp", "DISPLACE")
disp.texture = tex
disp.strength = 0.22

parts = [bell]
# Tentacles: tapered cones hanging -Z, ring of 8, varied lengths/radii.
# CRITICAL: a raw Blender cone has only TWO vertex rings (top/bottom) — the
# in-app undulation shader cannot bend a two-ring tube. A SIMPLE-subdivision
# modifier adds rings along the length so traveling waves have geometry to move.
for i in range(8):
    a = i / 8.0 * 2.0 * math.pi
    ring_r = 0.42 + 0.08 * (i % 2)
    depth = 2.4 + (i % 4) * 0.45
    bpy.ops.mesh.primitive_cone_add(
        radius1=0.085 + 0.02 * (i % 3 == 0), radius2=0.012, depth=depth, vertices=8,
        location=(math.cos(a) * ring_r, math.sin(a) * ring_r, -0.4 - depth / 2.0),
    )
    t = bpy.context.object
    t.name = f"tentacle_{i}"
    t.rotation_euler = (math.radians(7) * math.sin(a), math.radians(-7) * math.cos(a), 0)
    seg = t.modifiers.new("segments", "SUBSURF")
    seg.subdivision_type = "SIMPLE"
    seg.levels = 2
    seg.render_levels = 2
    bpy.context.view_layer.objects.active = t
    bpy.ops.object.modifier_apply(modifier="segments")
    parts.append(t)

for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = bell
bpy.ops.object.join()
jelly = bpy.context.object
jelly.name = "Jellyfish"
bpy.ops.object.shade_smooth()

out = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "assets-src", "creature.glb"))
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
print("wrote", out)
