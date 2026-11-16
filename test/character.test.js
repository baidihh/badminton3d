import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PlayerView } from '../public/js/player.js';
import { getCharacter, isCharacterId, CHARACTERS } from '../public/js/characters.js';
globalThis.document={createElement:()=>({getContext:()=>new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})})};
const b=fs.readFileSync(new URL('../models/Xbot.glb',import.meta.url));
const source=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
test('registry only accepts registered ids and returns a safe default',()=>{
  assert.equal(isCharacterId('__proto__'),false);assert.equal(isCharacterId({id:'athlete'}),false);
  assert.equal(getCharacter('/model.glb').id,'athlete');assert.ok(['athlete','rabbit-geo','rabbit-glb'].every(id=>CHARACTERS.some(c=>c.id===id)));
});
test('imported appearance retains visible skins and original material color',()=>{
  const v=new PlayerView(source,{character:getCharacter('rabbit-glb'),shadowTex:new THREE.Texture()});
  let skins=0;v.model.traverse(o=>{if(o.isSkinnedMesh){skins++;assert.equal(o.visible,true);const original=source.scene.getObjectByName(o.name);assert.equal(o.material.color.getHex(),original.material.color.getHex());assert.notEqual(o.material,original.material);}});
  assert.equal(skins,2);
});
test('missing required bones produces an actionable validation error',()=>{
  assert.throws(()=>new PlayerView({scene:new THREE.Group(),animations:[]},{character:getCharacter('rabbit-glb')}),/骨骼.*rArm/);
});
test('disposing a player releases owned resources without disposing source geometry',()=>{
  let disposed=0;source.scene.traverse(o=>{if(o.isMesh)o.geometry.addEventListener('dispose',()=>disposed++);});
  const v=new PlayerView(source,{character:getCharacter('rabbit-glb'),shadowTex:new THREE.Texture()});v.dispose();assert.equal(disposed,0);assert.equal(v.root.children.length,0);
});
test('registered rabbit requires its second spine joint before appearance construction',()=>{
  let joint;source.scene.traverse(o=>{if(o.isBone&&o.name.replace(/[^a-zA-Z0-9]/g,'').toLowerCase()==='mixamorigspine2')joint=o;});
  const name=joint.name;joint.name='unmapped';
  try {assert.throws(()=>new PlayerView(source,{character:getCharacter('rabbit-geo')}),/骨骼.*spine2/);} finally {joint.name=name;}
});
