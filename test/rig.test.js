import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PlayerView } from '../public/js/player.js';
// 骨骼运算不需要 WebGL。只替代球拍网线贴图使用的 canvas。
globalThis.document={createElement:()=>({getContext:()=>new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})})};
const bytes=fs.readFileSync(new URL('../models/Xbot.glb',import.meta.url));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
for(const hand of ['left','right']) test(`${hand} hand racket center coincides with a reachable authoritative contact`,()=>{
  const view=new PlayerView(gltf,{shadowTex:new THREE.Texture()});
  const contact={x:0.2,y:2,z:-4.05};
  const p={x:0,y:2,z:-4.6,vx:0,vz:0,hand,flash:0.5,stroke:{id:1,age:0.14,hit:true,shot:'clear',contact}};
  view.update(1/60,p,{...contact});view.root.updateMatrixWorld(true);
  const tip=view.racket.localToWorld(new THREE.Vector3(0,0.535,0));
  assert.ok(tip.distanceTo(new THREE.Vector3(contact.x,contact.y,contact.z))<0.06,`tip error ${tip.distanceTo(new THREE.Vector3(contact.x,contact.y,contact.z))}`);
});
test('repeated idle frames keep every bone quaternion finite and normalized',()=>{
  const view=new PlayerView(gltf,{shadowTex:new THREE.Texture()});const p={x:0,y:1.5,z:-4.6,vx:0,vz:0,hand:'right',flash:0};
  for(let i=0;i<300;i++) view.update(1/60,p,{x:2,y:2,z:4});
  view.root.traverse(o=>{if(o.isBone) assert.ok(Number.isFinite(o.quaternion.w)&&Math.abs(o.quaternion.length()-1)<1e-4);});
});
