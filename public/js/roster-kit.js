import * as THREE from 'three';

const LOOKS = {
  dino: { skin: 0xf3a151, top: 0x87cbb6, bottom: 0x3c746d, accent: 0xfff3cc, hair: 0x6bb89e, mascot: true },
  kitten: { skin: 0xffedd0, top: 0xd98fa6, bottom: 0x715574, accent: 0xfff5e9, hair: 0xe5b582, mascot: true },
  'junior-boy': { skin: 0xd5a27b, top: 0x3c91cc, bottom: 0x263b61, accent: 0xf7ca58, hair: 0x28212a, junior: true },
  'junior-girl': { skin: 0xf0c3a1, top: 0xab8dcb, bottom: 0x4b3c78, accent: 0xc6e8c1, hair: 0x483038, junior: true, female: true },
  'young-man': { skin: 0xa87554, top: 0x263e60, bottom: 0x202d43, accent: 0xefb953, hair: 0x211e25 },
  'young-woman': { skin: 0xdca67f, top: 0xf3e5c8, bottom: 0x316c71, accent: 0x5daaa5, hair: 0x372821, female: true },
};
const Y = new THREE.Vector3(0, 1, 0);

/** Six locally authored, cosmetic-only looks on the existing normalized Mixamo rig. */
export function addRosterKit(root, bones, character) {
  const avatar = character.avatar;
  if (!LOOKS[avatar]) throw new Error(`Unknown roster avatar: ${avatar}`);
  const style = { ...LOOKS[avatar], ...character.palette };
  root.updateMatrixWorld(true);
  let hips;
  root.traverse(o => { if (o.isSkinnedMesh) o.visible = false; if (o.isBone && /hips$/i.test(o.name)) hips = o; });
  hips ||= bones.spine1;
  const colors = { skin: style.skin, top: style.top, bottom: style.bottom, accent: style.accent, hair: style.hair,
    white: 0xfffcf1, sole: 0xd9dcd9, eyes: 0x251f2b, blush: 0xe6a2a1, mouth: 0x925c51 };
  const materials = Object.fromEntries(Object.entries(colors).map(([key, color]) => [key, new THREE.MeshStandardMaterial({
    name: `${avatar} ${key}`, color, roughness: key === 'eyes' ? .27 : .86,
  })]));
  const meshes = [];
  const sphere = new THREE.SphereGeometry(1, 16, 10);
  const smallSphere = new THREE.SphereGeometry(1, 12, 8);
  const at = (bone, x = 0, y = 0, z = 0) => bone.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(x, y, z));
  const add = (name, bone, geometry, material, position, scale = [1, 1, 1], rotation) => {
    const mesh = new THREE.Mesh(geometry, materials[material]);
    mesh.name = name; mesh.position.copy(position); mesh.scale.set(...scale);
    if (rotation) mesh.quaternion.copy(rotation);
    mesh.castShadow = true; root.add(mesh); root.updateMatrixWorld(true); bone.attach(mesh); meshes.push(mesh); return mesh;
  };
  const ball = (name, bone, position, scale, material, rotation, small = false) => add(name, bone, small ? smallSphere : sphere, material, position, scale, rotation);
  const zq = angle => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
  const tube = (name, bone, a, b, radius, material, endRadius = radius) => {
    const d = b.clone().sub(a), length = d.length();
    // Rounded capsule segments meet at spherical joints; tapered cylinders are reserved for details.
    const geometry = Math.abs(radius - endRadius) < .00001
      ? new THREE.CapsuleGeometry(radius, Math.max(.005, length - 2 * radius), 4, 12, 1)
      : new THREE.CylinderGeometry(endRadius, radius, length, 12);
    return add(name, bone, geometry, material, a.clone().lerp(b, .5), [1, 1, 1], new THREE.Quaternion().setFromUnitVectors(Y, d.normalize()));
  };
  const curve = (name, bone, points, radius, material, tapered = false) => {
    const path = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const geometry = new THREE.TubeGeometry(path, 24, radius, 8, false);
    if (tapered) {
      const pos = geometry.attributes.position;
      for (let i = 0; i <= 24; i++) {
        const c = path.getPointAt(i / 24), taper = .12 + .88 * (1 - i / 24);
        for (let j = 0; j <= 8; j++) {
          const k = i * 9 + j, p = new THREE.Vector3().fromBufferAttribute(pos, k).sub(c).multiplyScalar(taper).add(c);
          pos.setXYZ(k, p.x, p.y, p.z);
        }
      }
      geometry.computeVertexNormals();
    }
    return add(name, bone, geometry, material, at(bone));
  };
  const width = style.mascot ? .24 : style.female ? .197 : .215;
  ball('Sculpted sports jersey', bones.spine1, at(bones.spine1, 0, .025, .015), [width, .25, .145], 'top');
  ball('Piped jersey hem', bones.spine1, at(bones.spine1, 0, -.175, .015), [width * .93, .025, .139], 'accent');
  ball('Shorts waistband', hips, at(hips, 0, -.012, 0), [.185, .12, .134], 'bottom');
  // Contrasting sewn side panels remain on the torso in action.
  for (const s of [-1, 1]) {
    ball('Jersey side panel', bones.spine1, at(bones.spine1, s * width * .84, -.015, .065), [.027, .165, .089], 'accent');
    tube('V collar piping', bones.spine2, at(bones.spine2, s * .073, .129, .11), at(bones.spine2, 0, .073, .151), .012, 'white');
  }
  ball('Sewn club badge', bones.spine2, at(bones.spine2, .092, -.023, .157), [.027, .032, .008], 'white', null, true);
  ball('Club badge center', bones.spine2, at(bones.spine2, .092, -.023, .166), [.014, .018, .005], 'accent', null, true);
  const number = avatar === 'dino' ? 2 : avatar === 'kitten' ? 3 : avatar === 'junior-boy' ? 4 : avatar === 'junior-girl' ? 5 : avatar === 'young-man' ? 6 : 7;
  // A row of small dots gives each jersey its own sewn club number motif.
  for (let i = 0; i < number - 1; i++) ball('Jersey number dots', bones.spine1, at(bones.spine1, -.055 + (i % 3) * .023, -.052 - Math.floor(i / 3) * .026, .16), [.008, .008, .004], 'white', null, true);
  if (avatar === 'young-man') {
    for (let i = 0; i < 2; i++) tube('Amber diagonal chest stripe', bones.spine2,
      at(bones.spine2, -.14, .035 - i * .03, .145), at(bones.spine2, .01, -.045 - i * .03, .163), .011, 'accent');
  }
  if (avatar === 'young-woman') {
    ball('Vest front teal inset', bones.spine1, at(bones.spine1, 0, .014, .156), [.058, .158, .012], 'accent');
    tube('Vest zip', bones.spine1, at(bones.spine1, 0, -.10, .173), at(bones.spine1, 0, .115, .173), .006, 'white');
  }
  for (const [side, sign] of [['l', 1], ['r', -1]]) {
    const arm = bones[side + 'Arm'], fore = bones[side + 'ForeArm'], hand = bones[side + 'Hand'];
    const thigh = bones[side + 'UpLeg'], knee = bones[side + 'Leg'], foot = bones[side + 'Foot'];
    const a = at(arm), e = at(fore), h = at(hand), direction = e.clone().sub(a).normalize();
    const limbRadius = style.mascot ? .073 : style.junior ? .057 : .061;
    tube('Upper arm', arm, a, e, limbRadius, 'skin'); tube('Forearm', fore, e, h, limbRadius * .86, 'skin');
    ball('Elbow cap', fore, e, [limbRadius * .95, limbRadius * .95, limbRadius * .95], 'skin');
    if (avatar !== 'young-woman') {
      const sleeveEnd = a.clone().addScaledVector(direction, style.mascot ? .13 : .105);
      tube('Piped jersey sleeve', arm, a, sleeveEnd, limbRadius * 1.22, 'top');
      ball('Sleeve cuff', arm, sleeveEnd, [.018, limbRadius * 1.23, limbRadius * 1.23], 'accent');
    } else ball('Sleeveless armhole trim', arm, a, [.027, .079, .079], 'accent');
    ball(style.mascot ? 'Mitten paw' : 'Rounded athlete hand', hand, h.clone().addScaledVector(direction, .026), [style.mascot ? .079 : .063, .061, .047], 'skin');
    ball('Thumb', hand, h.clone().add(new THREE.Vector3(-sign * .004, -.039, .025)), [.025, .033, .029], 'skin', null, true);
    const wrist = h.clone().lerp(e, .17);
    ball('Wrist sweatband', fore, wrist, [.027, limbRadius * .92, limbRadius * .92], side === 'l' ? 'accent' : 'white');
    const u = at(thigh), k = at(knee), f = at(foot), legDirection = k.clone().sub(u).normalize();
    tube('Upper leg', thigh, u, k, style.mascot ? .085 : .077, 'skin');
    tube('Lower leg', knee, k, f, style.mascot ? .075 : .064, 'skin');
    ball('Knee cap', knee, k, [style.mascot ? .081 : .073, .075, .075], 'skin');
    const shortsEnd = u.clone().addScaledVector(legDirection, style.female ? .18 : .22);
    tube('Sport shorts leg', thigh, u, shortsEnd, style.mascot ? .112 : .099, 'bottom');
    ball('Shorts piping', thigh, shortsEnd, [style.mascot ? .114 : .1, .018, .104], 'accent');
    if (avatar === 'junior-girl') {
      // Two flared pleated panels sit over functional shorts and move with each thigh.
      const panel = new THREE.CylinderGeometry(.099, .139, .19, 10, 1, false, 0, Math.PI * 2);
      add('Pleated skort panel', thigh, panel, 'bottom', u.clone().addScaledVector(legDirection, .09), [1, 1, .91]);
      for (let i = 0; i < 3; i++) tube('Skort pleat piping', thigh, u.clone().add(new THREE.Vector3(sign * (.04 + i * .034), -.02, .102)), u.clone().add(new THREE.Vector3(sign * (.045 + i * .042), -.165, .12)), .005, 'accent');
    }
    // Shoes sit on the ankle floor used by PlayerView normalization.
    const shoe = f.clone().add(new THREE.Vector3(sign * .025, 0, 0));
    ball('Trainer sole', foot, shoe.clone().add(new THREE.Vector3(0, .022, .065)), [.097, .022, .171], 'sole');
    ball('Rounded trainer', foot, shoe.clone().add(new THREE.Vector3(0, .081, .063)), [.094, .077, .165], 'white');
    ball('Trainer color panel', foot, shoe.clone().add(new THREE.Vector3(sign * .055, .087, .06)), [.043, .046, .105], 'accent');
    ball('Trainer tongue', foot, shoe.clone().add(new THREE.Vector3(0, .127, .083)), [.047, .045, .069], 'top');
    for (const dz of [.085, .122]) ball('Trainer lace', foot, shoe.clone().add(new THREE.Vector3(0, .157, dz)), [.045, .007, .01], 'white', null, true);
    ball('Sport sock', knee, f.clone().add(new THREE.Vector3(0, .16, 0)), [.071, .065, .07], 'white');
    ball('Sock stripe', knee, f.clone().add(new THREE.Vector3(0, .205, 0)), [.072, .012, .072], 'accent');
  }
  const head = bones.head;
  const headScale = style.mascot ? [.29, .267, .236] : style.junior ? [.235, .25, .20] : [.211, .251, .187];
  const front = headScale[2], eyeX = style.mascot ? .105 : .074;
  ball(`roster-${avatar}`, head, at(head, 0, .035, 0), headScale, 'skin');
  if (!style.mascot) {
    tube('Neck', bones.spine2, at(bones.spine2, 0, .09, -.015), at(head, 0, -.07, -.015), .057, 'skin');
    for (const s of [-1, 1]) {
      ball('Rounded ear', head, at(head, s * headScale[0] * .97, -.005, -.005), [.032, .048, .029], 'skin', null, true);
      ball('Ear inner', head, at(head, s * (headScale[0] + .003), -.006, .019), [.013, .023, .008], 'blush', null, true);
    }
  }
  for (const s of [-1, 1]) {
    const eyeZ = front * .92, eyeY = avatar === 'dino' ? .106 : .065;
    ball('Bright expressive eye', head, at(head, s * eyeX, eyeY, eyeZ), [style.mascot ? .034 : .025, style.mascot ? .048 : .035, .018], 'eyes', null, true);
    ball('Eye highlight', head, at(head, s * eyeX - .008, eyeY + .013, eyeZ + .016), [.008, .011, .004], 'white', null, true);
    ball('Eye second glint', head, at(head, s * eyeX + .008, eyeY - .013, eyeZ + .017), [.004, .005, .003], 'white', null, true);
    ball('Soft cheek blush', head, at(head, s * (style.mascot ? .169 : .127), -.012, front * .79), [style.mascot ? .039 : .025, .017, .009], 'blush', null, true);
    if (!style.mascot) {
      ball('Sculpted brow', head, at(head, s * eyeX, .119, eyeZ - .009), [.035, .009, .009], 'hair', zq(s * -.12), true);
      if (style.female) tube('Outer eyelash', head, at(head, s * (eyeX + .012), .08, eyeZ + .012), at(head, s * (eyeX + .035), .097, eyeZ + .013), .005, 'eyes');
    }
  }
  if (avatar === 'dino') {
    ball('Dinosaur rounded muzzle', head, at(head, 0, -.065, .208), [.213, .11, .108], 'accent');
    for (const s of [-1, 1]) {
      ball('Dinosaur nostril', head, at(head, s * .073, -.003, .303), [.013, .009, .007], 'bottom', null, true);
      ball('Dinosaur raised eye ridge', head, at(head, s * .108, .168, .176), [.068, .028, .041], 'skin', zq(s * -.15));
    }
    curve('Dinosaur friendly smile', head, [[-.086, -.08, .306], [0, -.10, .315], [.086, -.08, .306]], .005, 'mouth');
    for (const [y, z, size] of [[.31, -.04, .095], [.23, -.187, .092], [.08, -.24, .08]]) {
      add('Dinosaur dorsal spike', head, new THREE.ConeGeometry(size, size * 1.65, 4), 'hair', at(head, 0, y, z), [1, 1, .7], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -.35));
    }
    for (let i = 0; i < 3; i++) add('Back dorsal spike', bones.spine1, new THREE.ConeGeometry(.065, .115, 4), 'hair', at(bones.spine1, 0, .15 - i * .14, -.165), [1, 1, .75], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
    curve('Dinosaur tapered tail', hips, [[0, -.01, -.12], [0, -.04, -.31], [.10, .01, -.50], [.22, .16, -.60]], .102, 'skin', true);
    ball('Dinosaur tail tip', hips, at(hips, .22, .16, -.60), [.021, .021, .025], 'hair', null, true);
  } else if (avatar === 'kitten') {
    const earShape = new THREE.Shape();earShape.moveTo(-.1, 0);earShape.quadraticCurveTo(-.115, .025, -.02, .195);earShape.quadraticCurveTo(0, .23, .02, .195);earShape.lineTo(.1, 0);earShape.closePath();
    const earGeometry = new THREE.ExtrudeGeometry(earShape, { depth: .045, bevelEnabled: true, bevelSize: .012, bevelThickness: .012, bevelSegments: 2, steps: 1 });
    for (const s of [-1, 1]) {
      add('Kitten triangular ear', head, earGeometry, 'skin', at(head, s * .177, .218, -.016), [1, 1, 1], zq(-s * .19));
      add('Kitten rose inner ear', head, earGeometry, 'blush', at(head, s * .177, .239, .047), [.60, .68, .12], zq(-s * .19));
      ball('Kitten ivory muzzle', head, at(head, s * .039, -.05, .222), [.064, .048, .039], 'white');
      for (const dy of [-.016, .018]) tube('Kitten whisker', head, at(head, s * .106, -.044 + dy, .229), at(head, s * .222, -.044 + dy * 1.8, .216), .004, 'hair');
      tube('Kitten smile', head, at(head, 0, -.065, .264), at(head, s * .035, -.087, .259), .004, 'mouth');
    }
    ball('Kitten button nose', head, at(head, 0, -.028, .27), [.023, .017, .014], 'blush', null, true);
    for (const x of [-.073, 0, .073]) ball('Kitten forehead marking', head, at(head, x, .195, .187), [.023, .053, .016], 'hair', zq(-x * 2));
    curve('Kitten curled tail', hips, [[0, 0, -.13], [.14, -.04, -.30], [.32, .02, -.32], [.35, .22, -.27], [.20, .26, -.24]], .042, 'skin');
    ball('Kitten tail tip', hips, at(hips, .20, .26, -.24), [.048, .048, .047], 'hair');
  } else {
    ball('Nose', head, at(head, 0, -.012, front * .98), [.022, .03, .029], 'skin', null, true);
    curve('Friendly athlete smile', head, [[-.044, -.071, front * .92], [0, -.084, front], [.044, -.071, front * .92]], .004, 'mouth');
    const cap = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    add('Sculpted hair cap', head, cap, 'hair', at(head, 0, .108, -.009), [headScale[0] * 1.035, .187, headScale[2] * 1.035]);
    ball('Hair back volume', head, at(head, 0, .047, -.10), [headScale[0] * 1.012, .205, .107], 'hair');
    if (avatar === 'junior-boy') {
      for (const [x, y, angle] of [[-.12, .184, -.46], [-.045, .206, -.22], [.035, .214, .22], [.11, .19, .45]]) ball('Junior boy cropped hair tuft', head, at(head, x, y, .151), [.056, .08, .047], 'hair', zq(angle));
      curve('Junior boy headband', head, [[-.22, .11, .02], [-.15, .119, .153], [0, .12, .194], [.15, .119, .153], [.22, .11, .02]], .018, 'accent');
      ball('Headband center patch', head, at(head, 0, .12, .212), [.023, .014, .005], 'white', null, true);
    } else if (avatar === 'junior-girl') {
      for (const s of [-1, 1]) ball('Junior girl side fringe', head, at(head, s * .132, .11, .112), [.063, .145, .052], 'hair', zq(-s * .35));
      curve('Junior girl ponytail', head, [[.13, .17, -.15], [.27, .17, -.24], [.32, .01, -.28], [.28, -.15, -.24]], .073, 'hair', true);
      ball('Ponytail tie', head, at(head, .17, .18, -.19), [.049, .043, .044], 'accent');
      curve('Junior girl headband', head, [[-.21, .09, .015], [-.16, .15, .12], [0, .18, .212], [.16, .15, .12], [.21, .09, .015]], .012, 'accent');
    } else if (avatar === 'young-man') {
      ball('Young man swept quiff', head, at(head, -.038, .263, .078), [.166, .10, .108], 'hair', zq(-.3));
      for (let i = 0; i < 3; i++) ball('Quiff swept lock', head, at(head, -.12 + i * .07, .236 + i * .009, .14), [.047, .086, .041], 'hair', zq(-.6));
      for (const s of [-1, 1]) ball('Trimmed sideburn', head, at(head, s * .19, .032, -.003), [.022, .064, .055], 'hair');
    } else {
      ball('Young woman bun', head, at(head, .035, .268, -.139), [.105, .108, .10], 'hair');
      add('Bun teal ribbon', head, new THREE.TorusGeometry(.085, .011, 6, 20), 'accent', at(head, .035, .27, -.152), [1, 1, 1]);
      for (const s of [-1, 1]) ball('Swept side fringe', head, at(head, s * .117, .129, .11), [.075, .118, .045], 'hair', zq(-s * .55));
      curve('Slim teal hairband', head, [[-.20, .10, .025], [-.14, .192, .103], [0, .225, .177], [.14, .192, .103], [.20, .10, .025]], .009, 'accent');
      ball('Loose side hair curl', head, at(head, -.195, -.012, .02), [.025, .09, .035], 'hair', zq(-.12));
    }
  }
  return { meshes, materials };
}
