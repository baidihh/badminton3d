"""Add editable garment UVs and tune surfaces on the two adult athletes."""
from math import radians
from pathlib import Path
import bpy

root = Path(__file__).resolve().parent.parent
for character in ('young-man', 'young-woman'):
    source = root / 'art/characters/roster' / f'{character}.blend'
    bpy.ops.wm.open_mainfile(filepath=str(source))
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        garments = {'Jersey', 'Shoulder panels', 'Shorts'}
        if not any(material and material.name in garments for material in obj.data.materials):
            continue
        if not obj.data.uv_layers:
            bpy.ops.object.select_all(action='DESELECT')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.smart_project(angle_limit=radians(66), island_margin=.015)
            bpy.ops.object.mode_set(mode='OBJECT')
    for name, roughness in [('Jersey', .8), ('Shoulder panels', .76), ('Shorts', .84), ('Skin', .54), ('Hair', .42), ('Shoe upper', .65)]:
        material = bpy.data.materials.get(name)
        if material and material.use_nodes:
            shader = material.node_tree.nodes.get('Principled BSDF')
            if shader:
                shader.inputs['Roughness'].default_value = roughness
    # Source files stay texture-free for deterministic Node packing. The shared
    # browser material module supplies the locally bundled CC0 weave normal.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(source))
    print('Refined garment UVs and surfaces:', character, flush=True)
