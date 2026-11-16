import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
const moduleUrl=new URL('../public/js/roster-kit.js',import.meta.url);
const b=fs.readFileSync(new URL('../models/Xbot.glb',import.meta.url));
const source=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
const names={spine1:'Spine1',spine2:'Spine2',head:'Head',headEnd:'HeadTop_End',lArm:'LeftArm',lForeArm:'LeftForeArm',lHand:'LeftHand',rArm:'RightArm',rForeArm:'RightForeArm',rHand:'RightHand',lUpLeg:'LeftUpLeg',lLeg:'LeftLeg',lFoot:'LeftFoot',rUpLeg:'RightUpLeg',rLeg:'RightLeg',rFoot:'RightFoot'};
const characters=[['dino','Dinosaur dorsal spike'],['kitten','Kitten triangular ear'],['junior-boy','Junior boy headband'],['junior-girl','Junior girl ponytail'],['young-man','Young man swept quiff'],['young-woman','Young woman bun']];
function fixture(){const root=new THREE.Group();root.add(SkeletonUtils.clone(source.scene));root.updateMatrixWorld(true);const bones=Object.fromEntries(Object.entries(names).map(([key,name])=>[key,root.getObjectByName('mixamorig'+name)]));return{root,bones};}
for(const [avatar,signature] of characters){
  test(`${avatar} has a recognizable fully surfaced appearance without moving gameplay joints`,async()=>{
    assert.ok(fs.existsSync(moduleUrl),'create the roster appearance module');const {addRosterKit}=await import(moduleUrl);
    const {root,bones}=fixture(),before=Object.values(bones).map(b=>b.matrixWorld.clone());
    addRosterKit(root,bones,{avatar});root.updateMatrixWorld(true);const visible=[];
    root.traverse(o=>{if(o.isSkinnedMesh)assert.equal(o.visible,false);if(o.isMesh&&o.visible)visible.push(o);});
    assert.ok(visible.length>=35,'outfit, face and signature silhouette are complete');
    assert.ok(visible.some(m=>m.name===signature),`missing recognizable ${signature}`);
    assert.ok(visible.some(m=>m.name==='Eye highlight'),'eyes need visible catchlights');
    assert.ok(visible.some(m=>m.name==='Sewn club badge'),'outfit needs its club detail');
    const triangles=visible.reduce((n,m)=>n+(m.geometry.index?.count||m.geometry.attributes.position.count)/3,0);
    assert.ok(triangles<40000,`${triangles} triangles exceeds the character budget`);
    assert.ok(visible.every(m=>m.material.isMeshStandardMaterial && m.material.roughness>=.2),'materials support soft studio lighting');
    for(const [i,bone]of Object.values(bones).entries())assert.ok(bone.matrixWorld.elements.every((v,k)=>Math.abs(v-before[i].elements[k])<1e-8),`${bone.name} was changed by a cosmetic`);
    const sole=visible.filter(m=>m.name==='Trainer sole');for(const m of sole){m.geometry.computeBoundingBox();const box=m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);assert.ok(box.min.y>=bones.lFoot.getWorldPosition(new THREE.Vector3()).y-.012,'soles sink beneath normalized floor');}
  });
  test(`${avatar} face and outfit remain attached with finite geometry during joint motion`,async()=>{
    assert.ok(fs.existsSync(moduleUrl),'create the roster appearance module');const {addRosterKit}=await import(moduleUrl);
    const {root,bones}=fixture();addRosterKit(root,bones,{avatar});root.updateMatrixWorld(true);
    const feature=root.getObjectByName(signature),before=feature.getVertexPosition(0,new THREE.Vector3()).applyMatrix4(feature.matrixWorld);
    assert.ok(feature.parent.isBone,'signature is attached to its rig joint');
    for(let i=0;i<60;i++){bones.head.rotation.y=i*.008;bones.lForeArm.rotation.z=i*.01;bones.rForeArm.rotation.z=-i*.01;bones.lLeg.rotation.x=i*.005;root.updateMatrixWorld(true);}
    assert.ok(feature.getVertexPosition(0,new THREE.Vector3()).applyMatrix4(feature.matrixWorld).distanceTo(before)>.01,'head silhouette follows the head');
    root.traverse(o=>{assert.ok(o.matrixWorld.elements.every(Number.isFinite),'posing generated non-finite transforms');if(o.isMesh&&o.visible){const a=o.geometry.attributes.position.array;assert.ok(a.every(Number.isFinite),'geometry contains invalid vertices');}});
  });
}
