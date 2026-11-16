import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import * as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PlayerView} from '../public/js/player.js';
globalThis.document={createElement:()=>({getContext:()=>new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})})};
const b=fs.readFileSync(new URL('../models/Xbot.glb',import.meta.url)),g=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
test('planted ankles remain stable during lateral locomotion',()=>{
 const v=new PlayerView(g,{shadowTex:new THREE.Texture()});let prev={},maxSlip=0,samples=0;
 for(let i=0;i<240;i++){
  v.update(1/60,{x:i/60*1.6,y:1.7,z:-4.6,vx:1.6,vz:0,hand:'right',flash:0},{x:0,y:2,z:5});v.root.updateMatrixWorld(true);
  for(const side of ['left','right']){const leg=v.legs[side],pos=leg.foot.getWorldPosition(new THREE.Vector3()),stance=v.motionState?.feet[side].stance??!leg.st.on;
   if(prev[side]?.stance&&stance&&i>30){maxSlip=Math.max(maxSlip,Math.hypot(pos.x-prev[side].x,pos.z-prev[side].z));samples++;}prev[side]={...pos,stance};
  }
 }
 assert.ok(samples>30);assert.ok(maxSlip<.012,`planted ankle moved ${maxSlip*1000}mm in one frame`);v.dispose();
});
test('swing varies the racket plane and balance arm before and after contact',()=>{
 const v=new PlayerView(g,{shadowTex:new THREE.Texture()}),qs=[],free=[];const c={x:.2,y:2,z:-4.05};
 for(const age of [.08,.14,.23]){v.update(1/60,{x:0,y:2,z:-4.6,vx:0,vz:0,hand:'right',flash:.5,stroke:{id:1,age,hit:true,shot:'clear',contact:c}},c);v.root.updateMatrixWorld(true);qs.push(v.racket.getWorldQuaternion(new THREE.Quaternion()));free.push(v.arms.left.hand.getWorldPosition(new THREE.Vector3()));}
 assert.ok(qs[0].angleTo(qs[2])>.6);assert.ok(free[0].y-free[2].y>.15,'balance arm should lower into recovery');v.dispose();
});
test('late hit confirmation rephases the same swing onto its authoritative contact',()=>{
 const v=new PlayerView(g,{shadowTex:new THREE.Texture()}),c={x:.2,y:2,z:-4.05},p={x:0,y:2,z:-4.6,vx:0,vz:0,hand:'right',flash:.5};
 for(let i=0;i<=15;i++)v.update(1/60,{...p,stroke:{id:7,age:i/60,hit:false,shot:'clear'}},c);
 v.update(1/60,{...p,stroke:{id:7,age:.14,hit:true,shot:'clear',contact:c}},c);v.root.updateMatrixWorld(true);
 assert.ok(v.racket.localToWorld(new THREE.Vector3(0,.535,0)).distanceTo(new THREE.Vector3(c.x,c.y,c.z))<.06);v.dispose();
});
test('visible soles stay above the court while the support shoe rolls',async()=>{
 const {getCharacter}=await import('../public/js/characters.js');
 for(const id of ['dino','rabbit-geo']){const v=new PlayerView(g,{character:getCharacter(id),shadowTex:new THREE.Texture()});let min=Infinity;
  for(let i=0;i<120;i++){v.update(1/60,{x:i/60*1.6,y:1.7,z:-4.6,vx:1.6,vz:0,hand:'right',flash:0},{x:0,y:2,z:5});v.root.updateMatrixWorld(true);
   v.root.traverse(o=>{if(!o.isMesh||!o.visible||!/sole/i.test(o.name))return;for(let j=0;j<o.geometry.attributes.position.count;j++){const p=o.getVertexPosition(j,new THREE.Vector3()).applyMatrix4(o.matrixWorld);min=Math.min(min,p.y);}});
  }
  assert.ok(min>=-.002,`${id} sole penetrated ${-min*1000}mm`);v.dispose();
 }
});
test('low-ball anticipation lowers the ready racket into the lunge instead of holding it overhead',()=>{
 const v=new PlayerView(g,{shadowTex:new THREE.Texture()});
 for(let i=0;i<80;i++)v.update(1/60,{x:0,y:1,z:-4.6,vx:0,vz:0,hand:'right',flash:0},{x:.2,y:.75,z:-3.9});
 v.root.updateMatrixWorld(true);const head=v.racket.localToWorld(new THREE.Vector3(0,.535,0));assert.ok(head.y<1.35,`low-ball ready racket stayed at ${head.y}m`);v.dispose();
});
