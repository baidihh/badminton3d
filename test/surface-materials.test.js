import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AthleteMaterials } from '../public/js/athlete-materials.js';
import { PlayerView } from '../public/js/player.js';
import { getCharacter } from '../public/js/characters.js';

const bytes = fs.readFileSync(new URL('../models/characters/young-man.glb', import.meta.url));
const asset = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');

test('garment detail uses authored UVs, preserves colors and switches back to the source material', () => {
  const root = new THREE.Group();
  const base = new THREE.MeshStandardMaterial({ color: '#173754', roughness: .8 });
  base.name = 'Jersey';
  const geometry = new THREE.PlaneGeometry();
  const garment = new THREE.Mesh(geometry, base);
  root.add(garment);
  const normal = new THREE.Texture();
  const look = new AthleteMaterials({ normal });
  look.apply(root);
  assert.ok(garment.material.isMeshPhysicalMaterial);
  assert.ok(Object.hasOwn(garment.material.defines, 'PHYSICAL'), 'physical surface lobes must be enabled in the compiled shader');
  assert.equal(garment.material.normalMap, normal);
  assert.equal(garment.material.color.getHex(), base.color.getHex());
  assert.equal(base.normalMap, null);
  const refined = garment.material;
  look.apply(root, false);
  assert.equal(garment.material, base);
  look.apply(root);
  assert.equal(garment.material, refined, 'repeated toggles reuse the same material');
  const unwrapped = new THREE.Mesh(new THREE.BufferGeometry(), base);
  root.add(unwrapped);
  look.apply(root);
  assert.equal(unwrapped.material.normalMap, null, 'a character without UVs remains renderable');
  look.dispose();
});

test('a textured player retains shared fabric textures when replaced', () => {
  globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: (object, key) => object[key] ?? (() => {}), set: (object, key, value) => (object[key] = value, true) }) }) };
  const normal = new THREE.Texture();
  let disposed = 0;
  normal.addEventListener('dispose', () => disposed++);
  const view = new PlayerView(asset, { character: getCharacter('young-man'), shadowTex: new THREE.Texture(), surfaceTextures: { normal } });
  let textured = 0;
  view.model.traverse(mesh => {
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (material.normalMap === normal) textured++;
  });
  assert.ok(textured > 0, 'the Blender export must contain usable garment UVs');
  view.dispose();
  assert.equal(disposed, 0, 'another player still uses the same source texture');
});
