import * as THREE from 'three';

/** Shared locally authored shapes: faceted attachments in-game, smooth weighted export offline. */
export function createRabbitParts(root, bones, { accent = 0x4ba8df, smooth = false } = {}) {
  root.updateMatrixWorld(true);
  let hips;
  root.traverse(o => { if (o.isBone && /hips$/i.test(o.name)) hips = o; });
  const palette = {
    fur: ['Rabbit cream', 0xfff0d6], white: ['Rabbit ivory', 0xfffdf2],
    rose: ['Rabbit rose', 0xed9caa], eyes: ['Rabbit eyes', 0x211c29],
    shirt: ['Rabbit team shirt', accent], shorts: ['Rabbit navy shorts', 0x274268],
    sole: ['Rabbit rubber soles', 0xe0dfd8], trim: ['Rabbit jersey trim', 0xbce4f5],
  };
  const materials = Object.fromEntries(Object.entries(palette).map(([key, [name, color]]) => {
    const m = new THREE.MeshStandardMaterial({ name, color, roughness: key === 'eyes' ? 0.24 : 0.86, flatShading: !smooth });
    if (key === 'shirt') m.userData.teamColor = true;
    return [key, m];
  }));
  const parts = [];
  const at = (bone, x = 0, y = 0, z = 0) => bone.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(x, y, z));
  const rigid = bone => () => [[bone, 1]];
  const part = (name, bone, geometry, material, position, scale = [1, 1, 1], rotation, weights = rigid(bone)) => {
    const mesh = new THREE.Mesh(geometry, materials[material]);
    mesh.name = name; mesh.position.copy(position); mesh.scale.set(...scale);
    if (rotation) mesh.quaternion.copy(rotation);
    mesh.updateMatrix(); mesh.castShadow = true;
    parts.push({ mesh, bone, weights }); return mesh;
  };
  const ball = (name, bone, position, scale, material, rotation, weights) => part(name, bone,
    new THREE.SphereGeometry(1, smooth ? 28 : 10, smooth ? 20 : 7), material, position, scale, rotation, weights);
  const rotateZ = angle => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
  const blend = (a, b, value) => { const t = THREE.MathUtils.smoothstep(value, 0, 1); return [[a, 1 - t], [b, t]]; };
  const tube = (name, bone, from, to, radius, material, weights) => {
    const d = to.clone().sub(from); const length = d.length();
    return part(name, bone, new THREE.CapsuleGeometry(radius, Math.max(.01, length - radius * 2), smooth ? 8 : 3, smooth ? 20 : 8, smooth ? 18 : 1), material,
      from.clone().lerp(to, .5), [1, 1, 1], new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), weights);
  };
  const torsoWeight = p => blend(hips || bones.spine1, bones.spine2, (p.y - at(bones.spine1).y + .17) / .38);
  ball('Pear-shaped team jersey', bones.spine1, at(bones.spine1, 0, .015, .018), [.245, .255, .17], 'shirt', null, torsoWeight);
  ball('Jersey lower hem', bones.spine1, at(bones.spine1, 0, -.175, .014), [.228, .035, .16], 'trim', null, torsoWeight);
  ball('Shorts waistband', hips || bones.spine1, at(hips || bones.spine1, 0, -.005, .01), [.205, .13, .151], 'shorts');
  // Readable sewn-on club badge and a small number, made entirely from geometry.
  ball('Ivory club badge', bones.spine2, at(bones.spine2, .105, -.025, .176), [.034, .038, .009], 'white');
  ball('Badge blue center', bones.spine2, at(bones.spine2, .105, -.025, .186), [.019, .023, .005], 'shorts');
  part('Jersey number 1', bones.spine1, new THREE.BoxGeometry(.018, .076, .008), 'white', at(bones.spine1, -.045, -.035, .189), [1, 1, 1], null, torsoWeight);
  // White collar at the neck, with a V opening suggested by two rounded strips.
  for (const s of [-1, 1]) {
    ball('Collar piping', bones.spine2, at(bones.spine2, s * .045, .14, .11), [.018, .065, .016], 'white', rotateZ(s * -.65));
  }
  for (const [side, sign] of [['l', 1], ['r', -1]]) {
    const arm = bones[side + 'Arm'], fore = bones[side + 'ForeArm'], hand = bones[side + 'Hand'];
    const thigh = bones[side + 'UpLeg'], knee = bones[side + 'Leg'], foot = bones[side + 'Foot'];
    const a = at(arm), e = at(fore), h = at(hand), armDirection = h.clone().sub(a).normalize();
    if (smooth) {
      const elbow = e.clone().sub(a).dot(armDirection);
      tube(`${side} soft continuous arm`, arm, a, h, .075, 'fur', p => blend(arm, fore, (p.clone().sub(a).dot(armDirection) - elbow + .10) / .20));
    } else {
      tube(`${side} upper arm`, arm, a, e, .078, 'fur');
      tube(`${side} forearm`, fore, e, h, .069, 'fur');
      ball(`${side} elbow`, fore, e, [.078, .078, .078], 'fur');
    }
    const sleeveEnd = a.clone().addScaledVector(armDirection, .13);
    tube(`${side} jersey sleeve`, arm, a, sleeveEnd, .096, 'shirt');
    ball(`${side} sleeve cuff`, arm, sleeveEnd, [.026, .091, .09], 'white');
    ball(`${side} mitten paw`, hand, h.clone().addScaledVector(armDirection, .025), [.09, .074, .066], 'fur');
    ball(`${side} paw thumb`, hand, h.clone().add(new THREE.Vector3(-sign * .015, -.052, .025)), [.044, .042, .044], 'fur');
    const u = at(thigh), k = at(knee), f = at(foot), legDirection = f.clone().sub(u).normalize();
    if (smooth) {
      const joint = k.clone().sub(u).dot(legDirection);
      tube(`${side} soft continuous leg`, thigh, u, f, .092, 'fur', p => blend(thigh, knee, (p.clone().sub(u).dot(legDirection) - joint + .11) / .22));
    } else {
      tube(`${side} upper leg`, thigh, u, k, .094, 'fur'); tube(`${side} shin`, knee, k, f, .085, 'fur');
      ball(`${side} knee`, knee, k, [.091, .091, .091], 'fur');
    }
    tube(`${side} shorts leg`, thigh, u, u.clone().addScaledVector(legDirection, .205), .118, 'shorts');
    ball(`${side} shorts piping`, thigh, u.clone().addScaledVector(legDirection, .19), [.12, .024, .115], 'trim');
    // Chunky cream trainers, a flat sole and raised blue tongues; ankle never changes.
    const shoe = f.clone().add(new THREE.Vector3(sign * .027, 0, 0));
    ball(`${side} trainer`, foot, shoe.clone().add(new THREE.Vector3(0, .087, .067)), [.108, .085, .19], 'white');
    ball(`${side} sole`, foot, shoe.clone().add(new THREE.Vector3(0, .024, .065)), [.112, .024, .192], 'sole');
    ball(`${side} trainer tongue`, foot, shoe.clone().add(new THREE.Vector3(0, .142, .104)), [.065, .044, .091], 'shirt');
    for (const dz of [.075, .115, .15]) ball(`${side} trainer lace`, foot, shoe.clone().add(new THREE.Vector3(0, .172, dz)), [.051, .009, .011], 'white');
    ball(`${side} sock cuff`, knee, f.clone().add(new THREE.Vector3(0, .193, 0)), [.086, .045, .084], 'white');
  }
  const head = bones.head;
  ball('Oversized rabbit head', head, at(head, 0, .045, .005), [.31, .275, .245], 'fur');
  for (const s of [-1, 1]) {
    const earQ = rotateZ(-s * .17);
    ball('Rabbit outer ear', head, at(head, s * .155, .46, -.016), [.091, .295, .072], 'fur', earQ);
    ball('Rabbit inner ear', head, at(head, s * .155, .475, .044), [.049, .226, .022], 'rose', earQ);
    ball('Velvety cheek', head, at(head, s * .185, -.01, .201), [.049, .03, .018], 'rose');
    ball('Bright oval eye', head, at(head, s * .107, .078, .231), [.038, .053, .023], 'eyes');
    ball('Large eye glint', head, at(head, s * .107 - .01, .097, .251), [.012, .017, .006], 'white');
    ball('Small eye glint', head, at(head, s * .107 + .011, .063, .253), [.006, .007, .004], 'white');
    ball('Soft muzzle', head, at(head, s * .041, -.049, .228), [.065, .044, .039], 'white');
    ball('Smile', head, at(head, s * .019, -.078, .262), [.022, .006, .004], 'eyes', rotateZ(s * .34));
  }
  ball('Rose button nose', head, at(head, 0, -.027, .275), [.026, .019, .018], 'rose');
  ball('Nose shine', head, at(head, -.007, -.02, .291), [.007, .004, .003], 'white');
  ball('Cotton tail', hips || bones.spine1, at(hips || bones.spine1, 0, .005, -.185), [.102, .095, .095], 'white');
  return { parts, materials };
}

/** Add the faceted demo to a normalized Xbot rig without changing any joint. */
export function addRabbitKit(root, bones, accent) {
  root.traverse(o => { if (o.isSkinnedMesh) o.visible = false; });
  const kit = createRabbitParts(root, bones, { accent });
  for (const { mesh, bone } of kit.parts) {
    root.add(mesh); root.updateMatrixWorld(true); bone.attach(mesh);
  }
  return kit;
}
