"""Build Lingchuan's editable skin. Run Blender in background with this script."""
from math import atan2, cos, pi, sin
from pathlib import Path
import sys

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
OUTPUT.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'models/Xbot.glb'))
rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
rig.animation_data_clear()
for bone in rig.pose.bones:
    bone.matrix_basis.identity()
for obj in list(bpy.context.scene.objects):
    if obj.type == 'MESH':
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.context.view_layer.update()

bones = {bone.name.split(':')[-1].removeprefix('mixamorig'): bone for bone in rig.data.bones}


def point(x, y, z):
    return Vector((x, -z, y))


def joint(name):
    return rig.matrix_world @ bones[name].head_local


def color(hex_color):
    channels = (int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (*(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in channels), 1)


palette = {}
for name, hex_color, roughness in [
    ('Skin', 'bb8262', .68), ('Jersey', '183654', .86), ('Shoulder panels', '2c5775', .85),
    ('Shorts', '142737', .84), ('Amber trim', 'efb64a', .83), ('Sock', 'dee7e7', .83),
    ('Shoe upper', 'eaf0ea', .67), ('Outsole', '415362', .86), ('Hair', '211b22', .81),
    ('Eyes', 'fff0de', .51), ('Iris', '342329', .40), ('Lips', '8e4d46', .70),
]:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color(hex_color)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = mat.diffuse_color
    shader.inputs['Roughness'].default_value = roughness
    palette[name] = mat


def blend(a, b, t):
    return {a: 1 - t, b: t}


class Skin:
    def __init__(self, name):
        self.name = name
        self.vertices = []
        self.weights = []
        self.faces = []
        self.materials = []

    def face(self, indices, material):
        self.faces.append(indices)
        self.materials.append(material)

    def loft(self, sections, frame, *, count=24, opening=None, first_ring=None, angles=None, cap_end=True):
        """Join consecutive cross-sections with shared vertices through each bend."""
        angles = angles if angles is not None else [2 * pi * i / count for i in range(count)]
        rings = [] if first_ring is None else [first_ring]
        for center, a, b, weights, _ in sections:
            start = len(self.vertices)
            for angle in angles:
                self.vertices.append(center + frame[0] * (a * cos(angle)) + frame[1] * (b * sin(angle)))
                self.weights.append(weights)
            rings.append(list(range(start, len(self.vertices))))
        for row, (a, b) in enumerate(zip(rings, rings[1:])):
            material = sections[max(0, row - int(first_ring is not None))][4]
            for i in range(len(a)):
                if opening is not None and opening(row, i):
                    continue
                j = (i + 1) % len(a)
                self.face((a[i], a[j], b[j], b[i]), material)
        if first_ring is None:
            self.face(tuple(rings[0]), sections[0][4])
        if cap_end:
            self.face(tuple(rings[-1]), sections[-1][4])
        return rings

    def oval(self, center, size, bone, material, *, count=16, angle=0):
        a, b, c = size
        sections = []
        for i in range(1, 12):
            lat = pi * i / 12
            sections.append((center + point(0, -b * cos(lat), 0), a * sin(lat), c * sin(lat), {bone: 1}, material))
        self.loft(sections, (point(cos(angle), sin(angle), 0), point(0, 0, 1)), count=count)

    def build(self):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = rig
        obj.matrix_parent_inverse = rig.matrix_world.inverted()
        used = list(dict.fromkeys(self.materials))
        for name in used:
            mesh.materials.append(palette[name])
        for polygon, name in zip(mesh.polygons, self.materials):
            polygon.material_index = used.index(name)
            polygon.use_smooth = True
        groups = {}
        for i, weights in enumerate(self.weights):
            for bone, weight in weights.items():
                if weight > 0:
                    if bone not in groups:
                        groups[bone] = obj.vertex_groups.new(name=bones[bone].name)
                    groups[bone].add([i], weight, 'REPLACE')

        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        modifier = obj.modifiers.new('Shared court skeleton', 'ARMATURE')
        modifier.object = rig
        return obj


horizontal = (point(1, 0, 0), point(0, 0, 1))
vertical = (point(0, 1, 0), point(0, 0, 1))

torso = Skin('roster-young-man')
shirt_sides = [0, 20]
armhole_bottom, armhole_top, armhole_span = 7, 9, 4
shirt = torso.loft([
    (point(0, y, z), width, depth, weights, mat)
    for y, z, width, depth, weights, mat in [
        (1.01, .017, .143, .091, {'Hips': 1}, 'Shorts'),
        (1.061, .014, .158, .101, {'Hips': 1}, 'Shorts'),
        (1.075, .014, .161, .103, {'Hips': 1}, 'Jersey'),
        (1.087, .014, .162, .106, {'Hips': 1}, 'Jersey'),
        (1.14, .013, .156, .102, blend('Hips', 'Spine', .66), 'Jersey'),
        (1.21, .011, .148, .101, blend('Spine', 'Spine1', .62), 'Jersey'),
        (1.29, .007, .164, .111, blend('Spine1', 'Spine2', .52), 'Jersey'),
        (1.376, -.004, .179, .114, {'Spine2': 1}, 'Jersey'),
        (1.425, -.026, .176, .101, {'Spine2': 1}, 'Shoulder panels'),
        (1.464, -.029, .146, .081, blend('Spine2', 'Neck', .13), 'Shoulder panels'),
        (1.492, -.024, .089, .066, blend('Spine2', 'Neck', .25), 'Shoulder panels'),
        (1.502, -.022, .066, .056, blend('Spine2', 'Neck', .35), 'Amber trim'),
        (1.509, -.022, .059, .051, blend('Spine2', 'Neck', .4), 'Amber trim'),
    ]
], horizontal, count=40, opening=lambda row, i: armhole_bottom <= row < armhole_top
   and any((i - side + armhole_span) % 40 < 2 * armhole_span for side in shirt_sides))
for x, y in [(-.07, 1.384), (-.091, 1.371), (-.071, 1.357)]:
    torso.oval(point(x, y, .094), (.016, .006, .011), 'Spine2', 'Amber trim', angle=.43, count=12)
arms, legs, hands, shoes = Skin('Arms'), Skin('Legs'), Skin('Hands'), Skin('Court shoes')
for side, sign, at in [('Left', 1, 0), ('Right', -1, 20)]:
    upper, elbow, wrist = (side + part for part in ('Arm', 'ForeArm', 'Hand'))
    center = joint(upper)
    lo, hi = at - armhole_span, at + armhole_span
    bottom, top = armhole_bottom, armhole_top
    edge = [(bottom, i) for i in range(lo, hi)]
    edge += [(row, hi) for row in range(bottom, top)]
    edge += [(top, i) for i in range(hi, lo, -1)]
    edge += [(row, lo) for row in range(top, bottom, -1)]
    # Reuse the exact shirt-edge vertices, so the shoulder drapes as a single mesh.
    border = [shirt[row][i % 40] for row, i in edge]
    cuff_center = center + point(0, -.009, .004)
    angles = []
    for i in border:
        offset = torso.vertices[i] - cuff_center
        angles.append(atan2(offset.dot(vertical[1]), offset.dot(vertical[0])))
        torso.weights[i] = blend('Spine2', upper, .18)
    torso.loft([
        (cuff_center + point(sign * .058, .002, .002), .061, .058, {upper: 1}, 'Jersey'),
        (cuff_center + point(sign * .105, .004, 0), .055, .053, {upper: 1}, 'Amber trim'),
        (cuff_center + point(sign * .115, .004, 0), .054, .052, {upper: 1}, 'Amber trim'),
    ], vertical, first_ring=border, angles=angles, cap_end=False)
    arms.loft([
        (center + point(sign * x, y, z), height, depth, weights, mat)
        for x, y, z, height, depth, weights, mat in [
            (.091, -.005, .004, .049, .048, {upper: 1}, 'Skin'),
            (.115, -.005, .004, .053, .051, {upper: 1}, 'Skin'),
            (.145, -.002, .004, .052, .049, {upper: 1}, 'Skin'),
            (.205, 0, .004, .048, .044, blend(upper, elbow, .08), 'Skin'),
            (.244, 0, .001, .044, .040, blend(upper, elbow, .23), 'Skin'),
            (.277, -.001, 0, .044, .039, blend(upper, elbow, .50), 'Skin'),
            (.310, -.001, .001, .047, .041, blend(upper, elbow, .76), 'Skin'),
            (.346, .001, .002, .049, .041, blend(upper, elbow, .94), 'Skin'),
            (.413, .001, .001, .043, .037, {elbow: 1}, 'Skin'),
            (.490, 0, 0, .035, .031, {elbow: 1}, 'Skin'),
            (.523, 0, 0, .030, .028, blend(elbow, wrist, .12), 'Skin'),
            (.559, 0, 0, .026, .027, blend(elbow, wrist, .48), 'Skin'),
            (.574, 0, 0, .026, .027, blend(elbow, wrist, .80), 'Skin'),
        ]
    ], vertical)
    hands.loft([
        (joint(wrist) + point(sign * x, -.003, z), a, b, weights, 'Skin')
        for x, z, a, b, weights in [
            (-.008, 0, .027, .027, blend(elbow, wrist, .41)),
            (.014, 0, .029, .034, {wrist: 1}),
            (.043, -.002, .023, .038, {wrist: 1}),
            (.076, -.003, .016, .033, {wrist: 1}),
        ]
    ], vertical)
    for digit, radius in [('Thumb', .015), ('Index', .012), ('Middle', .012), ('Ring', .011), ('Pinky', .009)]:
        a, b, c, end = (side + 'Hand' + digit + str(n) for n in range(1, 5))
        first, second, third, tip = (joint(name) for name in (a, b, c, end))
        fingers = (tip - first).normalized()
        normal = fingers.cross(point(0, 1, 0)).normalized()
        across = normal.cross(fingers).normalized()
        hands.loft([
            (center, radius * scale, radius * scale * .9, weights, 'Skin')
            for center, scale, weights in [
                (first.lerp(second, -.14), 1, blend(wrist, a, .5)),
                (first.lerp(second, .40), 1, {a: 1}),
                (second, .87, blend(a, b, .5)),
                (third, .74, blend(b, c, .5)),
                (third.lerp(tip, .82), .55, {c: 1}),
                (tip, .16, {c: 1}),
            ]
        ], (normal, across), count=10)

    thigh, knee, ankle = (side + part for part in ('UpLeg', 'Leg', 'Foot'))
    legs.loft([
        (point(sign * x, y, z), width, depth, weights, mat)
        for y, x, z, width, depth, weights, mat in [
            (1.047, .076, .013, .079, .084, blend('Hips', thigh, .26), 'Shorts'),
            (.986, .086, .009, .087, .085, blend('Hips', thigh, .64), 'Shorts'),
            (.918, .090, .012, .080, .084, {thigh: 1}, 'Shorts'),
            (.829, .086, .011, .080, .075, {thigh: 1}, 'Shorts'),
            (.782, .084, .009, .073, .071, {thigh: 1}, 'Amber trim'),
            (.772, .084, .008, .072, .069, {thigh: 1}, 'Skin'),
            (.725, .082, .009, .064, .062, {thigh: 1}, 'Skin'),
            (.628, .082, .012, .057, .060, blend(thigh, knee, .08), 'Skin'),
            (.573, .082, .011, .051, .054, blend(thigh, knee, .23), 'Skin'),
            (.529, .082, .011, .049, .054, blend(thigh, knee, .50), 'Skin'),
            (.487, .082, .004, .051, .049, blend(thigh, knee, .77), 'Skin'),
            (.439, .082, -.007, .054, .053, blend(thigh, knee, .94), 'Skin'),
            (.362, .082, -.020, .053, .054, {knee: 1}, 'Skin'),
            (.267, .082, -.026, .043, .042, {knee: 1}, 'Skin'),
            (.221, .082, -.026, .035, .036, {knee: 1}, 'Sock'),
            (.209, .082, -.026, .036, .037, {knee: 1}, 'Amber trim'),
            (.201, .082, -.025, .036, .037, {knee: 1}, 'Sock'),
            (.153, .082, -.024, .033, .034, blend(knee, ankle, .12), 'Sock'),
            (.109, .082, -.023, .033, .034, blend(knee, ankle, .55), 'Sock'),
            (.079, .082, -.022, .032, .032, {ankle: 1}, 'Sock'),
        ]
    ], horizontal)
    shoe = [
        (-.082, .021, .018, .028), (-.069, .047, .034, .065),
        (-.035, .054, .039, .104), (.023, .058, .044, .111),
        (.080, .063, .046, .080), (.132, .060, .045, .064),
        (.170, .045, .037, .054), (.184, .020, .023, .038), (.189, .006, .008, .026),
    ]
    shoes.loft([(point(sign * .086, top / 2 + .007, z), w, top / 2, {ankle: 1}, 'Shoe upper')
                for z, w, _, top in shoe], (point(1, 0, 0), point(0, 1, 0)))
    shoes.loft([(point(sign * .086, .011, z), w * 1.035, min(.014, tread * .6), {ankle: 1}, 'Outsole')
                for z, w, tread, _ in shoe], (point(1, 0, 0), point(0, 1, 0)))
    shoes.oval(point(sign * .128, .049, .046), (.020, .016, .074), ankle, 'Amber trim', count=16)
    for y, z in [(.107, .018), (.102, .037), (.093, .055), (.084, .072)]:
        shoes.oval(point(sign * .087, y, z), (.033, .004, .006), ankle, 'Outsole', count=12)

for mesh in (torso, arms, legs, hands, shoes):
    mesh.build()

face = Skin('Head')
face.loft([
    (point(x, y, z), w, d, weights, 'Skin')
    for x, y, z, w, d, weights in [
        (0, 1.481, -.024, .052, .049, blend('Spine2', 'Neck', .30)),
        (0, 1.515, -.024, .046, .047, {'Neck': 1}),
        (0, 1.549, -.021, .047, .045, blend('Neck', 'Head', .35)),
        (0, 1.576, -.006, .053, .052, blend('Neck', 'Head', .80)),
        (0, 1.598, .015, .051, .065, {'Head': 1}),
        (0, 1.614, .013, .067, .073, {'Head': 1}),
        (0, 1.641, .003, .082, .083, {'Head': 1}),
        (0, 1.675, -.003, .084, .084, {'Head': 1}),
        (0, 1.708, -.012, .081, .080, {'Head': 1}),
        (0, 1.741, -.018, .072, .072, {'Head': 1}),
        (0, 1.769, -.020, .050, .052, {'Head': 1}),
        (0, 1.783, -.021, .014, .020, {'Head': 1}),
    ]
], horizontal, count=40)
face.oval(point(0, 1.647, .081), (.016, .026, .014), 'Head', 'Skin')
face.oval(point(0, 1.637, .089), (.018, .010, .013), 'Head', 'Skin')
face.oval(point(0, 1.615, .082), (.025, .004, .005), 'Head', 'Lips')
for sign in [-1, 1]:
    face.oval(point(sign * .080, 1.647, -.001), (.014, .022, .014), 'Head', 'Skin')
    face.oval(point(sign * .035, 1.671, .069), (.019, .0075, .011), 'Head', 'Eyes', angle=sign * .07)
    face.oval(point(sign * .035, 1.671, .078), (.0075, .0075, .004), 'Head', 'Iris')
    face.oval(point(sign * .035, 1.685, .073), (.023, .0045, .007), 'Head', 'Hair', angle=sign * .13)
face.build()

hair = Skin('Swept quiff')
hair.loft([
    (point(x, y, z), w, d, {'Head': 1}, 'Hair')
    for x, y, z, w, d in [
        (0, 1.671, -.047, .070, .049), (0, 1.706, -.031, .084, .066),
        (0, 1.731, -.022, .085, .080), (.002, 1.756, -.014, .081, .082),
        (.008, 1.780, -.007, .075, .074), (.019, 1.801, .001, .056, .058),
        (.032, 1.812, .012, .034, .038), (.049, 1.813, .018, .008, .012),
    ]
], horizontal, count=40)
hair.oval(point(-.040, 1.742, .052), (.049, .019, .026), 'Head', 'Hair', angle=.36)
hair.oval(point(.018, 1.769, .059), (.058, .018, .029), 'Head', 'Hair', angle=.33)
for sign in [-1, 1]:
    hair.oval(point(sign * .071, 1.713, .016), (.016, .041, .042), 'Head', 'Hair', angle=sign * .13)
hair.build()

bpy.context.view_layer.objects.active = rig
bpy.data.orphans_purge(do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT / 'lingchuan.blend'))
