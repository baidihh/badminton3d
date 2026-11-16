// Deterministic, texture-free rabbit GLB. Run: node tools/build-rabbit.mjs
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRabbitParts } from '../public/js/rabbit-kit.js';

// GLTFExporter uses only this browser API when binary buffers have no textures.
if (!globalThis.FileReader) globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
};
const bytes = await fs.readFile(new URL('../models/Xbot.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const scene = gltf.scene;
scene.updateMatrixWorld(true);
const originalMeshes = []; let originalSkeleton;
scene.traverse(o => { if (o.isMesh) { originalMeshes.push(o); if (o.isSkinnedMesh) originalSkeleton = o.skeleton; } });
const names = { spine1: 'Spine1', spine2: 'Spine2', head: 'Head', headEnd: 'HeadTop_End', lArm: 'LeftArm', lForeArm: 'LeftForeArm', lHand: 'LeftHand', rArm: 'RightArm', rForeArm: 'RightForeArm', rHand: 'RightHand', lUpLeg: 'LeftUpLeg', lLeg: 'LeftLeg', lFoot: 'LeftFoot', rUpLeg: 'RightUpLeg', rLeg: 'RightLeg', rFoot: 'RightFoot' };
const bones = Object.fromEntries(Object.entries(names).map(([key, name]) => [key, scene.getObjectByName(`mixamorig${name}`)]));
if (!originalSkeleton || Object.values(bones).some(b => !b)) throw new Error('Xbot source is missing the required Mixamo rig');
for (const mesh of originalMeshes) mesh.removeFromParent();
const { parts } = createRabbitParts(scene, bones, { smooth: true });
const skeleton = new THREE.Skeleton(originalSkeleton.bones);
const batches = new Map();
for (const { mesh, weights } of parts) {
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix);
  const indices = [], values = [], p = new THREE.Vector3();
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    p.fromBufferAttribute(geometry.attributes.position, i);
    const influences = weights(p);
    const sum = influences.reduce((total, [, weight]) => total + weight, 0);
    for (let k = 0; k < 4; k++) {
      indices.push(influences[k] ? skeleton.bones.indexOf(influences[k][0]) : 0);
      values.push(influences[k] ? influences[k][1] / sum : 0);
    }
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(values, 4));
  if (!batches.has(mesh.material)) batches.set(mesh.material, []);
  batches.get(mesh.material).push(geometry);
}
for (const [material, geometries] of batches) {
  const mesh = new THREE.SkinnedMesh(mergeGeometries(geometries), material);
  mesh.name = material.name; mesh.castShadow = true; scene.add(mesh); mesh.bind(skeleton);
}
scene.name = 'Locally authored badminton rabbit';
scene.userData = { provenance: 'Locally authored procedural rabbit; original Xbot skeleton and animation clips retained', effectiveHeight: 1.82, decorativeEarsExcludedFromSizing: true };
const result = await new GLTFExporter().parseAsync(scene, { binary: true, animations: gltf.animations, onlyVisible: true });
const destination = new URL('../models/characters/rabbit.glb', import.meta.url);
await fs.mkdir(new URL('../models/characters/', import.meta.url), { recursive: true });
await fs.writeFile(destination, Buffer.from(result));
console.log(`Built ${destination.pathname}: ${result.byteLength} bytes, ${batches.size} skinned material batches, ${gltf.animations.length} original clips`);
