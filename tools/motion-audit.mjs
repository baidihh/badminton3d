// Deterministic kinematic audit, not a ground-force or human biomechanics measurement.
import fs from 'node:fs';import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {PlayerView} from '../public/js/player.js';
import {PlayerView as LegacyPlayerView} from '../public/js/motion-legacy-player.js';
globalThis.document={createElement:()=>({getContext:()=>new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})})};
const b=fs.readFileSync(new URL('../models/Xbot.glb',import.meta.url)),g=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
const output=[];
for(const [driver,View] of [['before',LegacyPlayerView],['after',PlayerView]])for(const fps of [30,60,120])for(const speed of [0,1.6,3.6]){
 const v=new View(g,{shadowTex:new THREE.Texture()});let previous={},sum=0,max=0,samples=0,bothAir=0;
 for(let i=0;i<fps*4;i++){
  v.update(1/fps,{x:speed*i/fps,y:1.7,z:-4.6,vx:speed,vz:0,hand:'right',flash:0},{x:0,y:2,z:5});v.root.updateMatrixWorld(true);
  let supports=0;
  for(const side of ['left','right']){const leg=v.legs[side],position=leg.foot.getWorldPosition(new THREE.Vector3());const stance=v.motionState?.feet[side].stance??!leg.st.on;
   if(stance)supports++;
   if(i>fps/2&&stance&&previous[side]?.stance){const d=Math.hypot(position.x-previous[side].x,position.z-previous[side].z);sum+=d;max=Math.max(max,d);samples++;}
   previous[side]={...position,stance};
  }
  if(!supports)bothAir++;
 }
 output.push({driver,fps,speed,meanStanceSlipMm:sum/Math.max(1,samples)*1000,maxStanceSlipMm:max*1000,stanceSamples:samples,bothAirFrames:bothAir});v.dispose();
}
console.log(JSON.stringify(output,null,2));
