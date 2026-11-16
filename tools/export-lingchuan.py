"""Export the saved Blender character and render its selection portrait."""
from pathlib import Path
import sys

import bpy
from mathutils import Quaternion, Vector


destination, *options = sys.argv[sys.argv.index('--') + 1:]
output = Path(destination)
character = options[0] if options else 'young-man'
bpy.ops.export_scene.gltf(filepath=str(output / 'lingchuan-blender.glb'), export_animations=False)

# The portrait pose and lighting are temporary and never saved to the character file.
rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
angles = {'LeftArm': 1.33, 'RightArm': -1.33, 'LeftForeArm': .18, 'RightForeArm': -.18}
for bone in rig.pose.bones:
    name = bone.name.split(':')[-1].removeprefix('mixamorig')
    if name in angles:
        axis = (rig.matrix_world @ bone.bone.matrix_local).to_3x3().inverted() @ Vector((0, 1, 0))
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = Quaternion(axis.normalized(), angles[name])

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 480
scene.render.resolution_y = 280
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = str(output / 'lingchuan.png')
scene.view_settings.view_transform = 'AgX'

mascot = character in {'rabbit-geo', 'rabbit-glb', 'dino', 'kitten'}
target = Vector((0, 0, 1.73 if mascot else 1.59))
bpy.ops.object.camera_add(location=(.52, -2.8, target.z + .13))
camera = bpy.context.object
camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 1.72 if character.startswith('rabbit-') else 1.21 if mascot else .96
scene.camera = camera

for location, power, size, color in [
    ((-.7, -1.5, 2.45), 90, 1.25, (1, .89, .76)),
    ((.9, -1.2, 1.85), 45, 1.36, (.68, .83, 1)),
    ((.4, .95, 2.15), 70, .85, (1, .81, .56)),
]:
    bpy.ops.object.light_add(type='AREA', location=location)
    light = bpy.context.object
    light.rotation_euler = (target - light.location).to_track_quat('-Z', 'Y').to_euler()
    light.data.energy, light.data.size, light.data.color = power, size, color
bpy.ops.render.render(write_still=True)
