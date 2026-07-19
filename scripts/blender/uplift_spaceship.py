# Adds hull panel-line + wear detail to the player ship as a baked normal map
# (no geometry changes — bakes onto the model's existing UVs).
#   $BLENDER --background --python scripts/blender/uplift_spaceship.py
# Backs up the pristine model to assets-src/originals/ before overwriting.
import bpy
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bake_utils

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "assets-src", "spaceship.glb")
BACKUP_DIR = os.path.join(ROOT, "assets-src", "originals")
os.makedirs(BACKUP_DIR, exist_ok=True)
backup = os.path.join(BACKUP_DIR, "spaceship_orig.glb")
if not os.path.exists(backup):
    shutil.copy2(SRC, backup)
    print("backed up original to", backup)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

ship = next(o for o in bpy.data.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = ship

# Hi-poly: subdivided duplicate with panel grooves + micro wear
bpy.ops.object.select_all(action="DESELECT")
ship.select_set(True)
bpy.ops.object.duplicate()
hi = bpy.context.view_layer.objects.active
hi.name = ship.name + "_hipoly"
sub = hi.modifiers.new("sub", "SUBSURF")
sub.subdivision_type = "SIMPLE"
sub.levels = 3
sub.render_levels = 3

panels = bpy.data.textures.new("panels", type="VORONOI")
panels.noise_scale = 0.35
panels.distance_metric = "MANHATTAN"
panels.contrast = 1.6
dp = hi.modifiers.new("panels", "DISPLACE")
dp.texture = panels
dp.strength = -0.012
dp.mid_level = 0.85  # only the cell borders bite -> groove lines

seams = bpy.data.textures.new("seams", type="WOOD")
seams.noise_basis_2 = "TRI"
seams.noise_scale = 0.4
ds = hi.modifiers.new("seams", "DISPLACE")
ds.texture = seams
ds.strength = -0.004
ds.mid_level = 0.5

wear = bpy.data.textures.new("wear", type="CLOUDS")
wear.noise_scale = 0.05
wear.noise_depth = 4
dw = hi.modifiers.new("wear", "DISPLACE")
dw.texture = wear
dw.strength = 0.004
dw.mid_level = 0.5

for m in list(hi.modifiers):
    bpy.context.view_layer.objects.active = hi
    bpy.ops.object.modifier_apply(modifier=m.name)

nimg = bake_utils.bake_normal_from_hipoly(ship, hi, "spaceship_normal", size=1024, extrusion=0.05)
bpy.data.objects.remove(hi, do_unlink=True)

# Attach to the two matte materials (leave the emissive engine untouched)
for slot in ship.material_slots:
    m = slot.material
    if m is None or not m.use_nodes or "Principled BSDF" not in m.node_tree.nodes:
        continue
    if m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value > 0:
        continue
    bake_utils.attach_normal_map(m, nimg, strength=0.8)

bpy.ops.object.select_all(action="DESELECT")
ship.select_set(True)
bpy.ops.export_scene.gltf(filepath=SRC, export_format="GLB", export_apply=True, use_selection=True)
print("wrote", SRC)
