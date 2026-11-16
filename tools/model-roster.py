"""Author the nine editable Blender meshes on COURTSIDE's shared bind skeleton."""
from math import cos, pi, sin
from pathlib import Path
import sys

import bpy
from mathutils import Vector


base, output = (Path(value).resolve() for value in sys.argv[sys.argv.index('--') + 1:])
# Shirt, secondary panel, shorts, trim, skin/fur, hair, shoulder build, face width.
designs = {
    'athlete':     ('e8ebed', '465661', '262f3a', 'f07957', 'b17e60', '242527', 1.20, .97),
    'rabbit-geo':  ('4f949a', '34727f', '28475d', 'f7bd68', 'e5eced', '535979', 1.03, 1),
    'rabbit-glb':  ('90a2d7', '586cae', '323f76', 'f6b9ae', 'fff0db', 'a77c8b', 1.12, 1),
    'dino':        ('397a70', '2b5d5f', '213a42', 'f8ca68', 'de8d40', '468778', 1.24, 1),
    'kitten':      ('9b506e', '753c5b', '4e3556', 'f4bf86', 'f5d8a2', 'b27a4f', .92, 1),
    'junior-boy':  ('317cb9', '255386', '203354', 'f5c759', 'cc9367', '29252e', .88, 1.09),
    'junior-girl': ('8f65b9', '61418c', '493067', 'b9db9b', 'eab28d', '4c2731', .84, 1.07),
    'young-man':   ('173754', '285478', '172b42', 'e9b149', 'bb8262', '211b22', 1.06, 1),
    'young-woman': ('e9e1cf', '2e7977', '285051', '89c3a8', 'b97b60', '332326', .85, .94),
}
mascots = {'rabbit-geo', 'rabbit-glb', 'dino', 'kitten'}


def rgb(code):
    def linear(v):
        return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4
    return (*[linear(int(code[i:i+2], 16) / 255) for i in (0, 2, 4)], 1)


def tint(name, code):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = rgb(code)
    node = mat.node_tree.nodes.get('Principled BSDF') or next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    node.inputs['Base Color'].default_value = mat.diffuse_color
    node.inputs['Roughness'].default_value = .69
    return mat


def point(x, y, z):
    return Vector((x, -z, y))


def mesh_part(name, vertices, faces, mat, weights, faceted=False):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = rig
    obj.matrix_parent_inverse = rig.matrix_world.inverted()
    mesh.materials.append(mat)
    for face in mesh.polygons:
        face.use_smooth = not faceted
    for bone, value in weights.items():
        group = obj.vertex_groups.new(name='mixamorig:' + bone)
        group.add(list(range(len(vertices))), value, 'REPLACE')
    mod = obj.modifiers.new('Skin', 'ARMATURE')
    mod.object = rig
    return obj


def surface(name, centers, mat, weights, *, around=20, flat=False):
    """Elliptical cross sections, aligned transverse to an authored center line."""
    verts = []
    for i, (center, width, depth) in enumerate(centers):
        center = Vector(center)
        tangent = Vector(centers[min(i+1,len(centers)-1)][0]) - Vector(centers[max(0,i-1)][0])
        tangent.normalize()
        right = tangent.cross(Vector((0, -1, 0)))
        if right.length < .01:
            right = tangent.cross(Vector((0, 0, 1)))
        right.normalize()
        front = tangent.cross(right)
        for j in range(around):
            angle = 2 * pi * j / around
            verts.append(center + right * (width*cos(angle)) + front * (depth*sin(angle)))
    faces = [tuple(reversed(range(around)))]
    for row in range(len(centers) - 1):
        for j in range(around):
            k = (j + 1) % around
            n = row*around
            faces.append((n+j,n+k,n+k+around,n+j+around))
    faces.append(tuple(range(len(verts)-around,len(verts))))
    return mesh_part(name, verts, faces, mat, weights, flat)


def oval(name, center, size, mat, bone='Head', *, lean=0, around=20, rows=13, flat=False):
    x, y, z = center
    a, b, c = size
    rings = []
    for i in range(rows):
        angle = pi*(i+.09)/(rows-.82)
        rings.append((point(x + lean * (-cos(angle)), y-b*cos(angle), z), max(.002,a*sin(angle)), max(.002,c*sin(angle))))
    return surface(name, rings, mat, {bone: 1}, around=around, flat=flat)


def ears(kind, fur, lining):
    for s in [-1, 1]:
        if kind == 'kitten':
            rings = [(point(s*x,y,z), w,d) for x,y,z,w,d in [
                (.112,1.855,.026,.060,.038), (.146,1.915,.032,.047,.029),
                (.182,1.981,.034,.026,.019), (.205,2.016,.033,.004,.005)]]
            surface('Cat ear', rings, fur, {'Head':1}, around=12)
            surface('Cat ear velvet', [(c+point(0,0,.024),w*.64,d*.34) for c,w,d in rings[1:]], lining, {'Head':1}, around=12)
        else:
            angular = kind == 'rabbit-geo'
            rings = [(point(s*x,y,z),w,d) for x,y,z,w,d in [
                (.101,1.863,-.014,.038,.030), (.122,1.925,-.018,.052,.032),
                (.146,2.031,-.027,.048,.031), (.172,2.137,-.040,.032,.023),
                (.190,2.174,-.049,.006,.005)]]
            if not angular and s > 0:
                rings = [(c+point((i/4)**2*.09,-(i/4)**2*.065,0),w,d) for i,(c,w,d) in enumerate(rings)]
            surface('Rabbit ear', rings, fur, {'Head':1}, around=10 if angular else 20, flat=angular)
            surface('Rabbit ear velvet', [
                (c+point(0,0,d*.78),w*.58,d*.25) for c,w,d in rings[1:]
            ], lining, {'Head':1}, around=10)


def mascot(kind, fur, detail):
    dino, cat = kind == 'dino', kind == 'kitten'
    angular = kind == 'rabbit-geo'
    light = tint('Muzzle', 'f5d69a' if dino else 'fff0d9')
    black = tint('Eye ink', '262332')
    white = tint('Eye gleam', 'fff8ec')
    pink = tint('Velvet', 'd8918c' if not angular else '919bb7')
    # Two smoothly joined bands form a neck with enough room through rotation.
    neck = oval('Neck', (0,1.548,-.007),(.070,.097,.068),fur,'Neck')
    group = neck.vertex_groups.new(name='mixamorig:Head')
    source = neck.vertex_groups['mixamorig:Neck']
    for vertex in neck.data.vertices:
        blend = max(0,min(1,(vertex.co.z-1.55)/.086))
        group.add([vertex.index],blend,'REPLACE')
        source.add([vertex.index],1-blend,'REPLACE')
    oval('Head', (0,1.739,.012),(.186 if dino else .165,.173 if dino else .153,.155 if dino else .140),
         fur,around=16 if angular else 32, rows=10 if angular else 17, flat=angular)
    if dino:
        oval('Snout', (0,1.688,.121),(.141,.079,.114),light)
        for s in [-1,1]:
            oval('Nostril',(s*.053,1.741,.200),(.013,.010,.014),detail)
        for y,z,h in [(1.887,-.054,.076),(1.841,-.112,.065),(1.77,-.141,.053)]:
            surface('Dorsal plate',[(point(0,y,z),.057,.037),(point(0,y+h,z-.018),.003,.004)],detail,{'Head':1},around=8)
    else:
        ears(kind, fur, pink)
        for s in [-1,1]:
            oval('Muzzle cheek',(s*.042,1.691,.124),(.059,.039,.041),light)
        oval('Nose',(0,1.716,.164),(.027,.012,.014),pink)
        if cat:
            for s in [-1,1]:
                for row in range(3):
                    oval('Tabby marking',(s*(.13-row*.002),1.782-row*.025,.09+row*.010),(.041,.008,.017),detail,lean=s*.004)
        else:
            for s in [-1,1]:
                oval('Blush',(s*.119,1.688,.102),(.027,.014,.022),pink)
    for s in [-1,1]:
        xpos, y, z = (s*.082,1.778,.139) if dino else (s*.072,1.766,.135)
        oval('Eye', (xpos,y,z),(.033,.045,.019),white)
        oval('Pupil',(xpos+s*.002,y-.003,z+.016),(.019,.028,.009),black)
        oval('Eye catchlight',(xpos-.007,y+.011,z+.024),(.006,.007,.004),white)
    if dino or cat:
        coordinates = [(0,1.09,-.095),(.027,.994,-.216),(.090,1.005,-.325),(.147,1.073,-.418),(.184,1.150,-.442)]
        widths = (.088,.071,.049,.029,.006) if dino else (.046,.038,.034,.032,.016)
        surface('Tail',[(point(*c),w,w*.88) for c,w in zip(coordinates,widths)],fur,{'Hips':1})
        if cat:
            oval('Tail tip',coordinates[-1],(.025,.029,.023),detail,'Hips')
    else:
        oval('Cottontail',(0,1.043,-.138),(.100,.088,.088),light,'Hips')


def hairstyle(kind, hair, trim, breadth):
    # Scalp cap, lower at the nape, with a hairline shaped around the face.
    around = 36
    verts, faces = [], []
    for row in range(12):
        for j in range(around):
            angle = 2*pi*j/around
            front = (sin(angle)+1)/2
            extent = 2.12 - .91*front + .10*cos(angle)
            phi = extent*(row+.12)/11.12
            verts.append(point(.004+.091*breadth*sin(phi)*cos(angle),
                               1.697+.100*cos(phi), -.017+.085*sin(phi)*sin(angle)))
    for row in range(11):
        for j in range(around):
            a=row*around+j
            b=row*around+(j+1)%around
            faces.append((a,b,b+around,a+around))
    faces.extend([tuple(range(around-1,-1,-1)),tuple(range(11*around,12*around))])
    mesh_part('Scalp',verts,faces,hair,{'Head':1})
    if kind == 'junior-girl':
        oval('Ponytail tie',(.046,1.743,-.110),(.037,.034,.031),trim)
        surface('Ponytail',[(point(x,y,z),w,d) for x,y,z,w,d in [
             (.039,1.750,-.096,.030,.034),(.067,1.722,-.146,.048,.035),
             (.086,1.664,-.163,.042,.032),(.102,1.603,-.162,.029,.024),
             (.125,1.562,-.150,.007,.011)]],hair,{'Head':1})
        oval('Side-swept fringe',(-.048,1.751,.041),(.057,.031,.044),hair,lean=.023)
    elif kind == 'young-woman':
        oval('Runner bun',(.024,1.771,-.095),(.064,.059,.060),hair)
        oval('Bun tie',(.024,1.749,-.086),(.053,.052,.049),trim)
        oval('Parted fringe',(-.041,1.75,.045),(.053,.022,.034),hair,lean=.020)
    elif kind == 'junior-boy':
        surface('Headband',[(point(0,y,-.016),w,d) for y,w,d in [(1.731,.085,.079),(1.747,.088,.081),(1.750,.085,.079)]],trim,{'Head':1},around=36)
        for x, y in [(-.044,1.775),(.003,1.790),(.040,1.784)]:
            oval('Cropped locks',(x,y,.025),(.041,.031,.052),hair,lean=-.019)
    elif kind == 'young-man':
        for x,y,w in [(-.042,1.765,.044),(.003,1.788,.046),(.041,1.799,.034)]:
            oval('Swept locks',(x,y,.028),(w,.025,.057),hair,lean=.023)
    else:
        oval('Short brushed crop',(0,1.772,.006),(.081,.026,.068),hair)


def reshape_body(kind, shoulder):
    for name in ['roster-young-man', 'Arms', 'Legs', 'Court shoes']:
        obj = bpy.data.objects[name]
        for v in obj.data.vertices:
            x,y,z = v.co
            if name == 'roster-young-man':
                # Taper toward the waist. Keep cuff rim coordinates in sync with the arm.
                blend = max(0,1 - abs(z-1.27)/.15) * min(1,max(0,(.235-abs(x))/.085))
                v.co.x *= 1 + (shoulder-1)*blend
                v.co.y *= 1 + (shoulder-1)*.60*blend
                if kind in {'junior-girl','young-woman'}:
                    waist = max(0,1-abs(z-1.17)/.15)
                    v.co.x *= 1 - .08*waist
            elif name == 'Legs':
                center = .083 if x > 0 else -.083
                factor = 1 + (shoulder - 1)*.57 + (.22 if kind in mascots else 0)*max(0,1-abs(z-.40)/.27)
                if kind == 'junior-girl':
                    factor += .16 * max(0,1-abs(z-.80)/.15)
                v.co.x = center + (x-center)*factor
                v.co.y = .012 + (y-.012)*factor
            elif name == 'Court shoes' and kind in mascots:
                center = .086 if x > 0 else -.086
                v.co.x = center + (x-center)*1.12
        obj.data.update()


for kind, values in designs.items():
    bpy.ops.wm.open_mainfile(filepath=str(base))
    rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
    top, panel, shorts, accent, body, hair, width, face_width = values
    trim = None
    for label, hex_code in [('Jersey',top),('Shoulder panels',panel),('Shorts',shorts),('Skin',body),
                            ('Hair',hair),('Shoe upper','edf0eb'),('Outsole',shorts),('Amber trim',accent)]:
        material = tint(label, hex_code)
        if label == 'Amber trim':
            trim = material
    reshape_body(kind,width)
    bpy.data.objects['roster-young-man'].name = 'roster-' + kind
    bpy.data.objects.remove(bpy.data.objects['Swept quiff'],do_unlink=True)
    if kind in mascots:
        bpy.data.objects.remove(bpy.data.objects['Head'],do_unlink=True)
        mascot(kind, bpy.data.materials['Skin'], bpy.data.materials['Hair'])
    else:
        head = bpy.data.objects['Head']
        for vertex in head.data.vertices:
            if vertex.co.z > 1.58:
                vertex.co.x *= face_width
                vertex.co.y *= 1 + (face_width-1)*.42
        head.data.update()
        hairstyle(kind,bpy.data.materials['Hair'],trim,face_width)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == 'VIEW_3D':
                view = area.spaces.active
                view.shading.color_type = 'MATERIAL'
                view.overlay.show_overlays = False
                view.region_3d.view_location = (0, 0, 1)
                view.region_3d.view_distance = 3.9
                view.region_3d.view_rotation = Vector((0,1,-.12)).to_track_quat('-Z','Y')
                view.region_3d.view_perspective = 'ORTHO'
    bpy.data.orphans_purge(do_recursive=True)
    bpy.context.preferences.filepaths.save_version = 0
    directory = output / kind
    directory.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(directory / (kind+'.blend')))
