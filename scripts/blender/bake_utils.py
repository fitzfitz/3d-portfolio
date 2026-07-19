# Shared Cycles bake helper: smart-UV + DIFFUSE/AO bakes -> one combined image.
# Emissive materials are auto-excluded by apply_baked_material (bake only matte parts).
import bpy


def _ensure_uv(objects):
    for ob in objects:
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")


def _new_image(name, size):
    img = bpy.data.images.new(name, width=size, height=size, alpha=False)
    return img


def _attach_bake_target(objects, img):
    """Every material on the objects gets an image-texture node pointing at img,
    selected+active so Cycles bakes into it."""
    for ob in objects:
        for slot in ob.material_slots:
            mat = slot.material
            if mat is None:
                continue
            mat.use_nodes = True
            nt = mat.node_tree
            node = nt.nodes.new("ShaderNodeTexImage")
            node.image = img
            node.name = "BakeTarget"
            nt.nodes.active = node


def _detach_bake_targets(objects):
    for ob in objects:
        for slot in ob.material_slots:
            mat = slot.material
            if mat is None or not mat.use_nodes:
                continue
            for node in list(mat.node_tree.nodes):
                if node.name.startswith("BakeTarget"):
                    mat.node_tree.nodes.remove(node)


def _bake(objects, bake_type, img, ao_samples):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = ao_samples
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if bake_type == "DIFFUSE":
        bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, use_clear=True)
    else:
        bpy.ops.object.bake(type="AO", use_clear=True)


def bake_color_ao(objects, image_name, size=1024, ao_samples=32):
    _ensure_uv(objects)
    color_img = _new_image(image_name + "_color", size)
    ao_img = _new_image(image_name + "_ao", size)

    _attach_bake_target(objects, color_img)
    _bake(objects, "DIFFUSE", color_img, ao_samples)
    _detach_bake_targets(objects)

    _attach_bake_target(objects, ao_img)
    _bake(objects, "AO", ao_img, ao_samples)
    _detach_bake_targets(objects)

    # Multiply AO into color (pixel math; both are size x size RGBA)
    combined = _new_image(image_name, size)
    cp = list(color_img.pixels)
    ap = list(ao_img.pixels)
    out = [0.0] * len(cp)
    for i in range(0, len(cp), 4):
        out[i] = cp[i] * ap[i]
        out[i + 1] = cp[i + 1] * ap[i + 1]
        out[i + 2] = cp[i + 2] * ap[i + 2]
        out[i + 3] = 1.0
    combined.pixels = out
    combined.pack()
    return combined


def apply_baked_material(objects, image, name, metallic=0.55, roughness=0.45):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    for ob in objects:
        # Replace every non-emissive slot with the baked material
        for slot in ob.material_slots:
            m = slot.material
            if m is None:
                continue
            emissive = False
            if m.use_nodes and "Principled BSDF" in m.node_tree.nodes:
                emissive = m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value > 0.0
            if not emissive:
                slot.material = mat
    return mat


def bake_normal_from_hipoly(lo, hi, image_name, size=1024, extrusion=0.08, samples=16):
    """Bake a hi-poly duplicate's surface detail into a tangent-space normal map
    on the lo-poly's existing UVs (selected-to-active). The pro trick that makes
    game-budget meshes read as sculpted. Caller deletes `hi` afterwards."""
    img = bpy.data.images.new(image_name, width=size, height=size, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    _attach_bake_target([lo], img)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    bpy.ops.object.select_all(action="DESELECT")
    hi.select_set(True)
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.bake(
        type="NORMAL",
        use_selected_to_active=True,
        cage_extrusion=extrusion,
        use_clear=True,
    )
    _detach_bake_targets([lo])
    img.pack()
    return img


def attach_normal_map(material, image, strength=1.0):
    """Wire a baked normal map into a Principled material (glTF exports it)."""
    nt = material.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = strength
    nt.links.new(tex.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], nt.nodes["Principled BSDF"].inputs["Normal"])


def make_hipoly_detail(lo, subsurf_levels=2, noise_scale=0.12, noise_strength=0.02):
    """Duplicate lo and add fine sculpt-ish surface detail for normal baking."""
    bpy.ops.object.select_all(action="DESELECT")
    lo.select_set(True)
    bpy.context.view_layer.objects.active = lo
    bpy.ops.object.duplicate()
    hi = bpy.context.object
    hi.name = lo.name + "_hipoly"
    sub = hi.modifiers.new("detail_sub", "SUBSURF")
    sub.levels = subsurf_levels
    sub.render_levels = subsurf_levels
    tex = bpy.data.textures.new(hi.name + "_micro", type="CLOUDS")
    tex.noise_scale = noise_scale
    disp = hi.modifiers.new("micro", "DISPLACE")
    disp.texture = tex
    disp.strength = noise_strength
    for m in list(hi.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
    return hi
