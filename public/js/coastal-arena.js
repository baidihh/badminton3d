import * as THREE from 'three';

const HALF_W = 3, HALF_L = 6.7, FLOOR_W = 16, FLOOR_L = 26;
const Y = new THREE.Vector3(0, 1, 0);

function canvasTexture(width, height, draw, renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities?.getMaxAnisotropy?.() || 1);
  return texture;
}

function courtTexture(renderer) {
  return canvasTexture(1536, 2496, (g, width, height) => {
    const px = x => (x + FLOOR_W / 2) / FLOOR_W * width;
    const pz = z => (z + FLOOR_L / 2) / FLOOR_L * height;
    const rect = (x, z, w, l, color) => { g.fillStyle = color; g.fillRect(px(x), pz(z), w / FLOOR_W * width, l / FLOOR_L * height); };
    g.fillStyle = '#e9dfc8'; g.fillRect(0, 0, width, height);
    // Sand pavers and a calm cream run-off apron make the actual court immediately readable.
    g.strokeStyle = '#ded4be'; g.lineWidth = 1.1;
    for (let x = -8; x <= 8; x += 1.6) { g.beginPath(); g.moveTo(px(x), 0); g.lineTo(px(x), height); g.stroke(); }
    for (let z = -13; z <= 13; z += 1.6) { g.beginPath(); g.moveTo(0, pz(z)); g.lineTo(width, pz(z)); g.stroke(); }
    rect(-4.18, -7.85, 8.36, 15.7, '#c9e1d4');
    rect(-3.31, -7.01, 6.62, 14.02, '#ee9e88');
    rect(-3.13, -6.83, 6.26, 13.66, '#f7f0da');
    rect(-HALF_W, -HALF_L, HALF_W * 2, HALF_L * 2, '#368e87');
    rect(-HALF_W, -HALF_L, HALF_W * 2, HALF_L, '#3b9991');
    rect(-HALF_W, 1.98, HALF_W, HALF_L - 1.98, '#3c948d');
    rect(0, -HALF_L, HALF_W, HALF_L - 1.98, '#3d9a91');
    // Deterministic tiny flecks suggest painted rubber, without adding render geometry.
    for (let i = 0; i < 4500; i++) {
      const x = ((i * 7919) % 10007) / 10007, z = ((i * 3571) % 10009) / 10009;
      g.fillStyle = i % 2 ? 'rgba(255,255,240,.027)' : 'rgba(14,73,70,.028)';
      g.fillRect(px(-3 + x * 6), pz(-6.7 + z * 13.4), 1.5, 1.5);
    }
    const line = (x1, z1, x2, z2, thickness = .045) => {
      g.strokeStyle = '#fffbed'; g.lineWidth = thickness / FLOOR_W * width; g.lineCap = 'butt';
      g.beginPath(); g.moveTo(px(x1), pz(z1)); g.lineTo(px(x2), pz(z2)); g.stroke();
    };
    for (const x of [-HALF_W, HALF_W]) line(x, -HALF_L, x, HALF_L);
    for (const z of [-HALF_L, HALF_L, -1.98, 1.98, -5.94, 5.94]) line(-HALF_W, z, HALF_W, z);
    for (const x of [-2.59, 2.59]) line(x, -HALF_L, x, HALF_L, .036);
    line(0, -HALF_L, 0, -1.98); line(0, 1.98, 0, HALF_L);
    // Sideline court IDs and end-apron lettering are outside all playable lines.
    for (const side of [-1, 1]) {
      g.save(); g.translate(px(0), pz(side * 8.54)); if (side > 0) g.rotate(Math.PI);
      g.fillStyle = '#468780'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 66px "Avenir Next", sans-serif'; g.fillText('COURTSIDE', 0, 0);
      g.font = '600 16px "Avenir Next", sans-serif'; g.fillStyle = '#7b9283';
      g.fillText('COASTAL CLUB   /   GOOD RALLIES, GOOD DAYS', 0, 43); g.restore();
      rect(side < 0 ? -3.82 : 3.66, -6.7, .16, 13.4, '#fff4df');
    }
  }, renderer);
}

function bannerTexture(renderer, side = false) {
  return canvasTexture(1536, 256, (g, w, h) => {
    g.fillStyle = '#f7f0da'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ec9c83'; g.fillRect(0, h - 18, w, 18);
    g.fillStyle = '#ebac6e'; g.beginPath(); g.arc(130, 118, 57, Math.PI, Math.PI * 2); g.fill();
    g.strokeStyle = '#458f83'; g.lineWidth = 12;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(70, 137 + i * 22); g.bezierCurveTo(110, 118 + i * 22, 150, 157 + i * 22, 193, 137 + i * 22); g.stroke(); }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#2e716b';
    g.font = '900 104px "Avenir Next", sans-serif'; g.fillText(side ? 'PLAY. SMILE. REPEAT.' : 'COURTSIDE', 866, 105, 1200);
    g.font = '600 25px "Avenir Next", sans-serif'; g.fillStyle = '#7d8d79';
    g.fillText(side ? 'A LITTLE SUNSHINE. A LOT OF GAME.' : 'C O A S T A L   B A D M I N T O N   C L U B', 866, 190, 1150);
  }, renderer);
}

function isOldStadium(object) {
  if (!object.isMesh) return false;
  const p = object.geometry?.parameters || {}, y = object.position.y;
  return (object.geometry.type === 'CylinderGeometry' && p.radiusTop === 30)
    || (object.geometry.type === 'CircleGeometry' && (p.radius === 30 || (p.radius === .55 && y > 14)))
    || (object.isInstancedMesh && object.count === 360 && p.radius === .085)
    || (object.geometry.type === 'BoxGeometry' && (
      (p.width === 1.25 && p.height === .55 && p.depth === 24)
      || (p.width === 15 && p.height === .55 && p.depth === 1.2)
      || (p.width === .06 && p.height === .045 && p.depth === 23)
      || (p.width === 8.4 && p.height === .72 && p.depth === .08)));
}

/** Install once after the existing net/posts, before players. Repeated calls return the same layer. */
export function applyCoastalArena({ scene, renderer, floor, outer, key, rim, warm, netMesh, netTape }) {
  const installed = scene.getObjectByName('coastal-arena');
  if (installed) return installed;
  const hidden = [];
  for (const object of [...scene.children]) {
    if (isOldStadium(object)) { object.visible = false; hidden.push(object); }
    if (object.isHemisphereLight) {
      object.color.setHex(0xe1f4ff); object.groundColor.setHex(0xb5b39a); object.intensity = 1.5;
    }
    const p = object.geometry?.parameters || {};
    if (object.isMesh && object.geometry.type === 'CylinderGeometry' && Math.abs(object.position.z) < .001 && Math.abs(object.position.x) > 3 && Math.abs(object.position.x) < 3.2) {
      if (p.height > 1) { object.material.color.setHex(0x3e7771); object.material.metalness = .15; }
      else object.material.color.setHex(0xe8a18a);
    }
  }
  const group = new THREE.Group(); group.name = 'coastal-arena';
  group.userData = { halfWidth: HALF_W, halfLength: HALF_L, shortService: 1.98, longService: 5.94,
    singlesHalfWidth: 2.59, floorWidth: FLOOR_W, floorLength: FLOOR_L,
    hiddenStadiumObjects: hidden.length, decorativeExclusion: { minX: -3, maxX: 3, minZ: -6.7, maxZ: 6.7 } };
  scene.add(group);
  scene.background = new THREE.Color(0xc5e6e9);
  scene.fog = new THREE.Fog(0xd8e9df, 24, 66);
  renderer.toneMappingExposure = 1.03;
  key.color.setHex(0xffedcf); key.intensity = 3.0; key.position.set(-9, 17, 8);
  key.shadow.normalBias = .022; key.shadow.bias = -.00035;
  rim.color.setHex(0xccecf8); rim.intensity = .75;
  warm.color.setHex(0xffd7ae); warm.intensity = .38;
  floor.material.map = courtTexture(renderer); floor.material.color.setHex(0xffffff);
  floor.material.roughness = .94; floor.material.metalness = 0; floor.material.needsUpdate = true;
  floor.userData.coastalCourt = { ...group.userData };
  outer.material.color.setHex(0xe4d7b7); outer.material.roughness = .98; outer.material.metalness = 0;
  netMesh.material.color.setHex(0x547d77); netMesh.material.opacity = .8;
  netTape.material.color.setHex(0xfffbed); netTape.material.roughness = .8;

  const colors = { cream: 0xf2e5cb, sand: 0xdac7a6, coral: 0xe99e84, teal: 0x548f85,
    mint: 0xb5d6bc, dark: 0x347166, leaf: 0x589981, wood: 0xb4906d,
    white: 0xfaf5e8, ocean: 0x76bdb9, foam: 0xd2e7d9 };
  const materials = Object.fromEntries(Object.entries(colors).map(([name, color]) => [name,
    new THREE.MeshStandardMaterial({ name: `Coastal ${name}`, color, roughness: .92, side: name === 'leaf' || name === 'dark' ? THREE.DoubleSide : THREE.FrontSide })]));
  const add = (name, geometry, material, position, rotation, scale) => {
    const mesh = new THREE.Mesh(geometry, materials[material]); mesh.name = name;
    mesh.position.set(...position); if (rotation) mesh.rotation.set(...rotation); if (scale) mesh.scale.set(...scale);
    mesh.receiveShadow = true; mesh.castShadow = !['ocean', 'foam'].includes(material); group.add(mesh); return mesh;
  };
  const box = (name, size, material, position, rotation) => add(name, new THREE.BoxGeometry(...size), material, position, rotation);
  const batch = (name, geometry, material, placements, shadows = true) => {
    const mesh = new THREE.InstancedMesh(geometry, materials[material], placements.length); mesh.name = name;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < placements.length; i++) {
      const { p, r = [0, 0, 0], s = [1, 1, 1], q } = placements[i];
      dummy.position.set(...p); dummy.rotation.set(...r); if (q) dummy.quaternion.copy(q); dummy.scale.set(...s); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = shadows; mesh.receiveShadow = shadows; group.add(mesh); return mesh;
  };
  // Low sand terraces frame the club, leaving a generous clear run-off apron.
  for (const side of [-1, 1]) {
    for (let row = 0; row < 3; row++) {
      box('Sandstone side terrace', [1.05, .38 + row * .34, 23], row === 2 ? 'sand' : 'cream', [side * (6.5 + row * 1.08), (.38 + row * .34) / 2 - .02, 0]);
      box('Mint terrace seat edge', [.8, .065, 22.5], row % 2 ? 'coral' : 'mint', [side * (6.5 + row * 1.08), .38 + row * .34, 0]);
    }
    for (let row = 0; row < 2; row++) box('End terrace', [13, .34 + row * .32, 1.1], 'cream', [0, (.34 + row * .32) / 2, side * (12.2 + row * 1.1)]);
    // Low barriers stop well outside the sideline and do not obstruct either baseline camera.
    for (const z of [-3.75, 3.75]) {
      box('Coral sideline barrier', [.15, .63, 3.9], 'coral', [side * 4.85, .315, z]);
      box('Cream barrier cap', [.2, .07, 3.95], 'cream', [side * 4.85, .665, z]);
    }
  }
  const banner = bannerTexture(renderer), sideBanner = bannerTexture(renderer, true);
  const signMaterial = new THREE.MeshStandardMaterial({ map: banner, roughness: 1 });
  const sideSignMaterial = new THREE.MeshStandardMaterial({ map: sideBanner, roughness: 1 });
  for (const side of [-1, 1]) {
    const sign = new THREE.Group(); sign.name = 'Courtside end banner'; sign.position.set(0, .74, side * 10.5); sign.rotation.y = side > 0 ? Math.PI : 0;
    const backing = new THREE.Mesh(new THREE.BoxGeometry(7.5, 1.03, .13), materials.cream); backing.castShadow = true; sign.add(backing);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(7.35, .92), signMaterial); face.position.z = .071; sign.add(face); group.add(sign);
    const sideFace = new THREE.Mesh(new THREE.PlaneGeometry(3.65, .5), sideSignMaterial);
    sideFace.name = 'Sideline club banner'; sideFace.position.set(side * 4.755, .36, 3.75); sideFace.rotation.y = -side * Math.PI / 2; group.add(sideFace);
  }
  // Ocean bands and narrow foam strokes turn the terraces into a small sporting island.
  for (const side of [-1, 1]) {
    add('Coastal water', new THREE.PlaneGeometry(24, 94), 'ocean', [side * 26, -.004, 0], [-Math.PI / 2, 0, 0]);
    for (let i = 0; i < 4; i++) box('Shoreline foam', [.08 + i * .025, .009, 74 - i * 6], 'foam', [side * (14.3 + i * .7), .004, i % 2 ? 1 : -1]);
    add('Far coastal water', new THREE.PlaneGeometry(30, 30), 'ocean', [0, -.003, side * 33], [-Math.PI / 2, 0, 0]);
  }

  const trunks = [], leaves = [], darkLeaves = [], coconuts = [], cloudPuffs = [];
  const palms = [[-6.1, -10.2, 4.6], [6.2, -10.7, 4.9], [-6.6, 10.6, 4.9], [6.1, 10.2, 4.5], [-10, -3.9, 5.1], [10.2, 4.2, 5.3], [-10.3, 5.1, 4.7], [10.1, -5.7, 4.8]];
  for (let tree = 0; tree < palms.length; tree++) {
    const [x, z, height] = palms[tree], lean = x > 0 ? -.48 : .48;
    for (let i = 0; i < 7; i++) {
      const t0 = i / 7, t1 = (i + 1) / 7;
      const a = new THREE.Vector3(x + lean * t0 * t0, height * t0, z + .17 * t0 * t0), b = new THREE.Vector3(x + lean * t1 * t1, height * t1, z + .17 * t1 * t1);
      const d = b.clone().sub(a);
      trunks.push({ p: a.clone().lerp(b, .5).toArray(), q: new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize()), s: [1 - t0 * .3, d.length(), 1 - t0 * .3] });
    }
    for (let i = 0; i < 8; i++) (i % 2 ? leaves : darkLeaves).push({ p: [x + lean, height, z + .17], r: [0, i * Math.PI / 4 + tree * .16, (i % 3 - 1) * .1], s: [1, 1, .84 + (tree % 3) * .1] });
    for (let i = 0; i < 2; i++) coconuts.push({ p: [x + lean + (i ? .13 : -.1), height - .15, z + .17], s: [.13, .16, .13] });
    add('Palm planter', new THREE.CylinderGeometry(.51, .62, .25, 16), tree % 2 ? 'cream' : 'coral', [x, .125, z]);
  }
  batch('Instanced palm trunks', new THREE.CylinderGeometry(.13, .16, 1, 8), 'wood', trunks);
  const frond = new THREE.BufferGeometry(), vertices = [], indices = [];
  for (let i = 0; i <= 9; i++) {
    const t = i / 9, w = Math.sin(t * Math.PI) * .27, y = .35 * Math.sin(t * Math.PI) - .73 * t * t;
    vertices.push(-w, y - w * .32, t * 2.25, 0, y + .045, t * 2.25, w, y - w * .32, t * 2.25);
    if (i < 9) for (let j = 0; j < 2; j++) { const a = i * 3 + j; indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4); }
  }
  frond.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); frond.setIndex(indices); frond.computeVertexNormals();
  batch('Mint palm fronds', frond, 'leaf', leaves); batch('Deep palm fronds', frond, 'dark', darkLeaves);
  batch('Palm coconuts', new THREE.SphereGeometry(1, 10, 7), 'wood', coconuts);
  // Coral striped parasols, loungers and club benches stay beyond the run-off zone.
  for (const [i, [x, z]] of [[-5.55, -7.95], [5.65, 7.95], [-9.5, 8.1], [9.6, -8.1]].entries()) {
    add('Beach parasol pole', new THREE.CylinderGeometry(.035, .035, 2.75, 8), 'wood', [x, 1.375, z]);
    const canopy = add('Beach parasol canopy', new THREE.ConeGeometry(1.35, .5, 12, 1, true), i % 2 ? 'mint' : 'coral', [x, 2.85, z]);
    canopy.material = [materials[i % 2 ? 'mint' : 'coral'], materials.cream];
    const stripes = [[], []], index = canopy.geometry.index;
    for (let face = 0; face < index.count / 3; face++) for (let vertex = 0; vertex < 3; vertex++) stripes[face % 2].push(index.getX(face * 3 + vertex));
    canopy.geometry.setIndex([...stripes[0], ...stripes[1]]); canopy.geometry.clearGroups();
    canopy.geometry.addGroup(0, stripes[0].length, 0); canopy.geometry.addGroup(stripes[0].length, stripes[1].length, 1);
    add('Parasol finial', new THREE.SphereGeometry(.075, 10, 7), 'cream', [x, 3.12, z]);
    box('Club bench seat', [.62, .16, 1.65], 'cream', [x + .55, .48, z + .3]);
    box('Club bench leg', [.42, .43, .13], 'wood', [x + .55, .22, z - .27]);
    box('Club bench leg', [.42, .43, .13], 'wood', [x + .55, .22, z + .88]);
  }
  const seats = [];
  for (const side of [-1, 1]) for (let i = 0; i < 16; i++) seats.push({ p: [side * 7.5, .82, -9.6 + i * 1.27], s: [.48, .13, .58] });
  batch('Mint terrace cushions', new THREE.BoxGeometry(1, 1, 1), 'mint', seats);
  for (const [x, y, z, scale] of [[-16, 10, -24, 1.1], [14, 12, -29, 1.2], [-18, 11, 23, 1.25], [16, 10, 24, 1.1], [0, 13, 31, 1]]) {
    for (let i = 0; i < 4; i++) cloudPuffs.push({ p: [x + (i - 1.5) * 1.2 * scale, y + (i % 2) * .3, z], s: [(1.1 + (i % 2) * .2) * scale, (.55 + (i % 2) * .18) * scale, .75 * scale] });
  }
  batch('Soft coastal clouds', new THREE.SphereGeometry(1, 12, 8), 'white', cloudPuffs, false);
  group.userData.palms = palms.length;
  group.userData.instancedBatches = 6;
  group.userData.provenance = 'Locally authored coastal club scene and canvas lettering; no external assets';
  return group;
}
