import * as THREE from 'three';
// 基于现有骨架的简洁运动员外观。独立几何避免在机器人蒙皮上套衣服造成穿模。
export function addSportsKit(root, bones, accent) {
  const materials = Object.fromEntries(Object.entries({skin:0xd6a080,shirt:accent,shorts:0x17243b,white:0xf0f3ed,hair:0x242122}).map(([k,color])=>[k,new THREE.MeshStandardMaterial({color,roughness:0.9})]));
  const at=(b,x=0,y=0,z=0)=>b.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(x,y,z));
  const attach=(bone,geometry,mat,pos,scale=[1,1,1],rotation)=>{
    const m=new THREE.Mesh(geometry,materials[mat]);m.position.copy(pos);m.scale.set(...scale);
    if(rotation)m.quaternion.copy(rotation);
    m.castShadow=true;root.add(m);root.updateMatrixWorld(true);bone.attach(m);return m;
  };
  const sphere=(bone,pos,scale,mat)=>attach(bone,new THREE.SphereGeometry(1,20,14),mat,pos,scale);
  const limb=(bone,child,radius,mat)=>{
    const a=at(bone),b=at(child),d=b.clone().sub(a);const length=d.length();
    const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
    attach(bone,new THREE.CapsuleGeometry(radius,Math.max(0.01,length-radius*1.3),6,12),mat,a.clone().lerp(b,.5),[1,1,1],q);
  };
  // 隐藏原机器人的蒙皮，保留骨架、动画和 IK。
  root.traverse(o=>{if(o.isSkinnedMesh)o.visible=false;});
  sphere(bones.spine1,at(bones.spine1,0,0.035,0.005),[0.21,0.255,0.14],'shirt');
  let hips;root.traverse(o=>{if(o.isBone&&/hips$/i.test(o.name))hips=o;});
  if(hips)sphere(hips,at(hips,0,-0.01,0),[0.18,0.13,0.115],'shorts');
  for(const side of ['l','r']) {
    const arm=bones[side+'Arm'],fore=bones[side+'ForeArm'],hand=bones[side+'Hand'];
    const thigh=bones[side+'UpLeg'],knee=bones[side+'Leg'],foot=bones[side+'Foot'];
    limb(arm,fore,0.052,'skin');limb(fore,hand,0.043,'skin');
    sphere(arm,at(arm),[0.075,0.075,0.075],'shirt');
    sphere(fore,at(fore),[0.049,0.049,0.049],'skin');
    sphere(hand,at(hand),[0.045,0.06,0.035],'skin');
    limb(thigh,knee,0.077,'skin');limb(knee,foot,0.059,'skin');
    const a=at(thigh),b=at(knee),d=b.clone().sub(a).normalize();
    attach(thigh,new THREE.CapsuleGeometry(0.09,0.10,6,12),'shorts',a.addScaledVector(d,0.085),[1,1,1],new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d));
    sphere(knee,at(knee),[0.064,0.064,0.064],'skin');
    sphere(foot,at(foot,0,0.02,0.065),[0.065,0.06,0.15],'white');
  }
  const head=bones.head;
  sphere(head,at(head,0,0.07,0),[0.105,0.135,0.105],'skin');
  attach(head,new THREE.SphereGeometry(1,20,12,0,Math.PI*2,0,Math.PI/2),'hair',at(head,0,0.115,0),[0.108,0.095,0.108]);
  for(const x of [-0.035,0.035])sphere(head,at(head,x,0.075,0.099),[0.01,0.013,0.006],'hair');
}
