// 离线骨骼预览：输出投影三角形，供 Pillow 光栅化；无需控制浏览器。
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PlayerView } from '../public/js/player.js';
globalThis.document={createElement:()=>({getContext:()=>new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})})};
const bytes=fs.readFileSync(new URL('../models/Xbot.glb',import.meta.url));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const out=[];
for(const age of [0,0.08,0.14,0.23]) {
 const view=new PlayerView(gltf,{shadowTex:new THREE.Texture()});
 if(age===0 && process.env.RIG_MEASURE) {for(const [k,b] of Object.entries(view.bone)) if(b) console.log(k,b.getWorldPosition(new THREE.Vector3()).toArray());}
 const contact={x:0.2,y:2,z:-4.05};
 const p={x:0,y:2,z:-4.6,vx:0,vz:0,hand:'left',flash:0.5,stroke:{id:1,age,hit:true,shot:'smash',contact}};
 view.update(1/60,p,contact);view.root.updateMatrixWorld(true);
 const cam=new THREE.PerspectiveCamera(34,0.8,0.1,30);cam.position.set(2.8,2.3,-1.1);cam.lookAt(0,1.25,-4.6);cam.updateMatrixWorld(true);
 const tris=[];
 view.root.traverse(o=>{
  if(!o.isMesh || !o.visible)return;if(o.isSkinnedMesh)o.skeleton.update();
  const g=o.geometry,idx=g.index;const n=idx?idx.count:g.attributes.position.count;
  const mat=Array.isArray(o.material)?o.material[0]:o.material;const col=mat.color||new THREE.Color('white');
  for(let i=0;i<n;i+=3) {
   const vs=[0,1,2].map(k=>o.getVertexPosition(idx?idx.getX(i+k):i+k,new THREE.Vector3()).applyMatrix4(o.matrixWorld));
   const normal=new THREE.Vector3().subVectors(vs[1],vs[0]).cross(new THREE.Vector3().subVectors(vs[2],vs[0])).normalize();
   const light=0.45+0.55*Math.max(0,normal.dot(new THREE.Vector3(0.4,0.8,0.6).normalize()));
   const rgb=col.clone().multiplyScalar(light).convertLinearToSRGB();
   const projected=vs.map(v=>v.clone().project(cam));
   tris.push({z:projected.reduce((s,v)=>s+v.z,0)/3,xy:projected.flatMap(v=>[Math.round((v.x+1)*180),Math.round((1-v.y)*225)]),c:[rgb.r,rgb.g,rgb.b].map(v=>Math.round(Math.min(1,v)*255))});
  }
 });
 tris.sort((a,b)=>b.z-a.z);out.push(tris);
}
fs.writeFileSync('/tmp/badminton-rig-preview.json',JSON.stringify(out));
