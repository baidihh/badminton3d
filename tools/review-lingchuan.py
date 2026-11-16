"""Create an editable Blender review scene. This command does not export game assets."""
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector


lab_arg, output_arg, *options = sys.argv[sys.argv.index('--') + 1:]
lab, output = Path(lab_arg).resolve(), Path(output_arg).resolve()
roster_preview = '--roster' in options
output.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
original = next(obj for obj in scene.objects if obj.type == 'ARMATURE')
skins = [obj for obj in scene.objects if obj.type == 'MESH']

# Refine the existing editable mesh at the shoulders and shins in bind pose.
# Leave joint centers in place so the reference clip can drive the same rig.
shirt = next(obj for obj in skins if obj.name.startswith('roster-'))
shore = {vertex.index for vertex in shirt.data.vertices
         if not roster_preview and .105 < abs(vertex.co.x) < .238 and 1.365 < vertex.co.z < 1.475}
neighbors = [set() for _ in shirt.data.vertices]
for edge in shirt.data.edges:
    a, b = edge.vertices
    neighbors[a].add(b)
    neighbors[b].add(a)
for _ in range(2):
    points = [vertex.co.copy() for vertex in shirt.data.vertices]
    for i in shore:
        if neighbors[i]:
            average = sum((points[j] for j in neighbors[i]), Vector()) / len(neighbors[i])
            shirt.data.vertices[i].co = points[i].lerp(average, .24)
shirt.data.update()
legs = next(obj for obj in skins if obj.name == 'Legs')
for vertex in [] if roster_preview else legs.data.vertices:
    x, y, z = vertex.co
    taper = max(0, 1 - abs(z - .355) / .155) * .10
    center = math.copysign(.082, x)
    vertex.co.x = center + (x - center) * (1 - taper)
    vertex.co.y = .02 + (y - .02) * (1 - taper)
legs.data.update()

# The training action plays inside Blender on a shared bind rig, alongside
# its original racket track. The training project's robot mesh is discarded.
bpy.ops.import_scene.gltf(filepath=str(lab))
rig = bpy.data.objects['AthleteRig']
racket = bpy.data.objects['RacketRoot']
action = bpy.data.actions['backhand_cross']
for bone in original.data.bones:
    assert (bone.matrix_local - rig.data.bones[bone.name].matrix_local).to_scale().length < .03, bone.name
for obj in skins:
    world = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = world
    for modifier in obj.modifiers:
        if modifier.type == 'ARMATURE':
            modifier.object = rig

keepers = {rig, racket, *racket.children_recursive, *skins}
for obj in (rig, racket):
    parent = obj.parent
    while parent:
        keepers.add(parent)
        parent = parent.parent
for obj in list(scene.objects):
    if obj not in keepers:
        bpy.data.objects.remove(obj, do_unlink=True)
for obj, slot_name in [(rig, 'OBAthleteRig'), (racket, 'OBRacketRoot')]:
    animation = obj.animation_data
    for track in list(animation.nla_tracks):
        animation.nla_tracks.remove(track)
    animation.action = action
    animation.action_slot = next(slot for slot in action.slots if slot.identifier == slot_name)

scene.render.fps = 60
scene.frame_start, scene.frame_end = round(action.frame_range[0]), round(action.frame_range[1])
stages = [(0, 'Ready'), (72, 'Contact')] if roster_preview else [(0, 'Ready'), (48, 'Turn'), (72, 'Contact'), (121, 'Recover')]
for frame, label in stages:
    scene.timeline_markers.new(label, frame=frame)

def look(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat('-Z', 'Y').to_euler()

bpy.ops.mesh.primitive_plane_add(size=200)
floor = bpy.context.object
floor.name = 'Review floor'
floor.location.z = -.011
mat = bpy.data.materials.new('Court blue')
mat.diffuse_color = (.029, .078, .108, 1)
floor.data.materials.append(mat)
bpy.ops.object.camera_add()
camera = bpy.context.object
camera.name = 'Character review camera'
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 2.75
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16 if roster_preview else 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 360 if roster_preview else 520
scene.render.resolution_y = 340 if roster_preview else 480
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'
scene.world = bpy.data.worlds.new('Studio ambient')
scene.world.use_nodes = True
world = scene.world.node_tree
world.nodes.clear()
ambient = world.nodes.new('ShaderNodeBackground')
ambient.inputs[0].default_value = (.30, .38, .48, 1)
ambient.inputs[1].default_value = .45
world.links.new(ambient.outputs[0], world.nodes.new('ShaderNodeOutputWorld').inputs['Surface'])
for location, power, size, color in [
    ((-3, 2, 5), 780, 3.3, (1, .89, .77)),
    ((-3, -4, 3), 500, 4, (.64, .80, 1)),
    ((4, 2, 4), 850, 3.5, (.83, .90, 1)),
]:
    bpy.ops.object.light_add(type='AREA', location=location)
    light = bpy.context.object
    look(light, Vector((0, -1.4, 1.0)))
    light.data.energy, light.data.size, light.data.color = power, size, color

hips = rig.pose.bones['mixamorig:Hips']
wrist = rig.pose.bones['mixamorig:RightHand']
grip = next(child for child in racket.children_recursive if child.name == 'RacketGrip')
# Blender bone objects parent to the bone tail. The imported racket track's
# tail compensation is in meters while this armature uses centimeters.
if racket.parent == rig and racket.parent_type == 'BONE':
    tail_offset = wrist.bone.length * (1 - rig.matrix_world.to_scale().y)
    racket.matrix_parent_inverse = Matrix.Translation((0, -tail_offset, 0))
offset = Vector((-4.6, 3.0, 1.55))

def position_camera():
    hip = rig.matrix_world @ hips.head
    target = Vector((hip.x, hip.y, 1.02))
    camera.location = target + offset
    look(camera, target)

# Store the studio framing in the viewport. The saved file starts in Ready.
scene.frame_set(scene.frame_start)
position_camera()
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active = shirt
shirt.select_set(True)
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            space = area.spaces.active
            space.overlay.show_overlays = False
            space.shading.color_type = 'MATERIAL'
            space.region_3d.view_rotation = camera.rotation_euler.to_quaternion()
            space.region_3d.view_location = rig.matrix_world @ hips.head
            space.region_3d.view_distance = 3.75
            space.region_3d.view_perspective = 'ORTHO'
bpy.data.orphans_purge(do_recursive=True)
bpy.context.preferences.filepaths.save_version = 0
if not roster_preview:
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'lingchuan-review.blend'))

positions = []
for frame, label in stages:
    scene.frame_set(frame)
    positions.append((rig.matrix_world @ wrist.head).copy())
    assert .035 < (positions[-1] - grip.matrix_world.translation).length < .085, label
    position_camera()
    scene.render.filepath = str(output / f'{label.lower()}.png')
    bpy.ops.render.render(write_still=True)
assert (positions[0] - positions[1 if roster_preview else 2]).length > .5, 'Reference action did not move the racket hand'
print('Verified the review render across', len(stages), 'authored poses.')
