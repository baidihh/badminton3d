import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
const asset = new URL('../models/characters/rabbit.glb', import.meta.url);
const source = new URL('../models/Xbot.glb', import.meta.url);
const parse = async url => { const b=fs.readFileSync(url); return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),''); };
const find = (root,name) => root.getObjectByName(`mixamorig${name}`);

test('locally authored rabbit ships a standalone visible skinned GLB with retained team and face materials', async () => {
  assert.ok(fs.existsSync(asset),'build the local rabbit GLB');
  const g=await parse(asset); const meshes=[]; const materials=new Set();
  g.scene.traverse(o=>{ if(o.isMesh && o.visible){meshes.push(o);for(const m of [].concat(o.material))materials.add(m);} });
  assert.ok(meshes.length>0 && meshes.every(m=>m.isSkinnedMesh),'all exported rabbit parts are skinned');
  assert.ok([...materials].some(m=>m.userData.teamColor===true),'shirt remains recolorable after GLB round trip');
  assert.ok([...materials].some(m=>m.name==='Rabbit eyes' && m.color.getHex()<0x303040),'black eyes retain their own material');
  assert.ok([...materials].some(m=>m.name==='Rabbit rose'),'inner ears and cheeks retain pink');
  assert.ok(meshes.every(m=>!m.material.map),'standalone asset needs no browser texture decoding');
});

test('rabbit preserves original Mixamo joint positions, local axes and animation clips', async () => {
  assert.ok(fs.existsSync(asset),'build the local rabbit GLB');
  const [g,original]=await Promise.all([parse(asset),parse(source)]);g.scene.updateMatrixWorld(true);original.scene.updateMatrixWorld(true);
  for(const name of ['Hips','Spine1','Spine2','Head','HeadTop_End','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot']) {
    const actual=find(g.scene,name),expected=find(original.scene,name);assert.ok(actual,`missing ${name}`);
    assert.ok(actual.getWorldPosition(new THREE.Vector3()).distanceTo(expected.getWorldPosition(new THREE.Vector3()))<1e-5,`${name} reach changed`);
    assert.ok(actual.quaternion.angleTo(expected.quaternion)<1e-5,`${name} local axes changed`);
  }
  assert.deepEqual(g.animations.map(a=>[a.name,a.duration]),original.animations.map(a=>[a.name,a.duration]));
  const mixer=new THREE.AnimationMixer(g.scene);const hips=find(g.scene,'Hips'),before=hips.position.clone();mixer.clipAction(g.animations.find(a=>a.name==='run')).play();mixer.update(.2);
  assert.ok(hips.position.distanceTo(before)>.01,'exported clips actually target the rabbit skeleton');
});

test('smooth rabbit uses normalized blended skinning and deforms both arms independently', async () => {
  assert.ok(fs.existsSync(asset),'build the local rabbit GLB');const g=await parse(asset);g.scene.updateMatrixWorld(true);
  for(const side of ['Left','Right']) {
    let found=false;
    g.scene.traverse(m=>{if(!m.isSkinnedMesh)return;const w=m.geometry.attributes.skinWeight,idx=m.geometry.attributes.skinIndex;
      const joint=m.skeleton.bones.indexOf(find(g.scene,`${side}ForeArm`));
      for(let i=0;i<w.count;i++) {const sum=w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i);assert.ok(Math.abs(sum-1)<1e-5,'weights normalize');
        if(idx.getY(i)!==joint || w.getY(i)<.1 || w.getY(i)>.9)continue;
        m.skeleton.update();const before=m.getVertexPosition(i,new THREE.Vector3());const bone=find(g.scene,`${side}ForeArm`),q=bone.quaternion.clone();bone.rotateZ(.5);g.scene.updateMatrixWorld(true);m.skeleton.update();const after=m.getVertexPosition(i,new THREE.Vector3());bone.quaternion.copy(q);g.scene.updateMatrixWorld(true);m.skeleton.update();
        if(before.distanceTo(after)>.005)found=true;
      }
    });assert.ok(found,`${side} elbow must blend and deform visible geometry`);
  }
  const clone=SkeletonUtils.clone(g.scene);const left=find(clone,'LeftForeArm');left.rotateZ(.4);assert.ok(left.quaternion.angleTo(find(g.scene,'LeftForeArm').quaternion)>.3,'clones own independent bones');
  const mesh=[];clone.traverse(o=>{if(o.isSkinnedMesh)mesh.push(o);});assert.ok(mesh.every(m=>m.skeleton.bones.every(b=>b===find(clone,b.name.replace('mixamorig','')))),'cloned skins use cloned bones');
});

test('faceted assembly hides the athlete and follows supplied normalized joints', async () => {
  const path=new URL('../public/js/rabbit-kit.js',import.meta.url);assert.ok(fs.existsSync(path),'build the faceted rabbit kit');
  const {addRabbitKit}=await import(path);const g=await parse(source);const root=new THREE.Group();root.add(g.scene);root.updateMatrixWorld(true);
  const bones=Object.fromEntries(Object.entries({spine1:'Spine1',spine2:'Spine2',head:'Head',headEnd:'HeadTop_End',lArm:'LeftArm',lForeArm:'LeftForeArm',lHand:'LeftHand',rArm:'RightArm',rForeArm:'RightForeArm',rHand:'RightHand',lUpLeg:'LeftUpLeg',lLeg:'LeftLeg',lFoot:'LeftFoot',rUpLeg:'RightUpLeg',rLeg:'RightLeg',rFoot:'RightFoot'}).map(([k,n])=>[k,find(root,n)]));
  const before=bones.head.getWorldPosition(new THREE.Vector3());addRabbitKit(root,bones,0x23a9e8);root.updateMatrixWorld(true);
  const visible=[];root.traverse(o=>{if(o.isSkinnedMesh)assert.equal(o.visible,false);if(o.isMesh&&o.visible)visible.push(o);});
  assert.ok(visible.length>30,'faceted character has ears, expressive face and sports outfit');assert.ok(visible.every(o=>o.material.flatShading),'assembled rabbit is visibly faceted');
  assert.ok(bones.head.children.some(o=>o.isMesh),'face is attached to the head');
  const feature=bones.head.children.find(o=>o.isMesh),p=feature.getWorldPosition(new THREE.Vector3());bones.head.rotateX(.3);root.updateMatrixWorld(true);assert.ok(feature.getWorldPosition(new THREE.Vector3()).distanceTo(p)>.01);
  assert.ok(bones.head.getWorldPosition(new THREE.Vector3()).distanceTo(before)<1e-5,'kit never changes rig dimensions');
});

test('rabbit soles stay above the normalized ankle floor and ears remain decorative', async () => {
  assert.ok(fs.existsSync(asset),'build the local rabbit GLB');const g=await parse(asset);g.scene.updateMatrixWorld(true);
  const bounds=new THREE.Box3();g.scene.traverse(m=>{if(m.isSkinnedMesh){m.skeleton.update();m.computeBoundingBox();bounds.union(m.boundingBox.clone().applyMatrix4(m.matrixWorld));}});
  const foot=find(g.scene,'LeftFoot').getWorldPosition(new THREE.Vector3()).y;
  assert.ok(bounds.min.y>=foot-.01,`skin ${bounds.min.y} sinks beneath ankle floor ${foot}`);
  assert.ok(bounds.max.y>2.2,'long visible ears survive export');
  assert.ok(find(g.scene,'HeadTop_End').getWorldPosition(new THREE.Vector3()).y<1.8,'ears must not move the sizing joint');
});

for (const id of ['rabbit-geo', 'rabbit-glb']) for (const hand of ['left', 'right']) {
  test(`${id} ${hand} racket still meets authoritative contact after appearance changes`, async () => {
    const { PlayerView } = await import('../public/js/player.js');
    const { getCharacter } = await import('../public/js/characters.js');
    globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: (o,k) => o[k] ?? (() => {}), set: (o,k,v) => (o[k]=v,true) }) }) };
    const g=await parse(id==='rabbit-glb'?asset:source),view=new PlayerView(g,{character:getCharacter(id),shadowTex:new THREE.Texture()});
    const contact={x:.2,y:2,z:-4.05};
    view.update(1/60,{x:0,y:2,z:-4.6,vx:0,vz:0,hand,flash:.5,stroke:{id:1,age:.14,hit:true,shot:'clear',contact}},contact);
    view.root.updateMatrixWorld(true);
    const center=view.racket.localToWorld(new THREE.Vector3(0,.535,0));
    assert.ok(center.distanceTo(new THREE.Vector3(contact.x,contact.y,contact.z))<.06,`${id} ${hand} reach changed`);
    view.dispose();
  });
}
