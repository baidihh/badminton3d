import { backhandAxes, sampleBackhand, sampleBackhandStroke } from './backhand-motion.js';
import { addRosterKit } from './roster-kit.js';
import { getCharacter } from './characters.js';
import { addRabbitKit } from './rabbit-kit.js';
import { addSportsKit } from './sports-kit.js';
import { CONTACT_WINDOW, contactFrame } from './contact-racket.js';
import { CONTACT_TIME, sampleStrokePose } from './stroke.js';
import { ContactLocomotion } from './locomotion.js';
import { readyPose } from './ready-pose.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ============================================================
// GLB 球员视图：Mixamo 骨骼 + 动画混合 + 双骨 IK 覆盖
// ============================================================
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = t => t * t * (3 - 2 * t);
const GRIP_CURL = [.64, .88, .62];
const RELAXED_CURL = [.18, .26, .20];
const READY_REACH = 1.14;   // 准备位拍头到肩的距离（≈ 臂长 + 拍长，手臂接近伸直）
const ARM_YAW_MAX = 1.66;   // 肩水平限位 ≈95°：手臂不允许绕到身体后方
const ARM_EL_MIN = -0.6;    // 手臂最低仰角
const ARM_EL_MAX = 1.35;    // 手臂最高仰角

const _lv = new THREE.Vector3();
const _pv = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _sv = new THREE.Vector3();
const _aq = new THREE.Quaternion();
const _bq = new THREE.Quaternion();
const _cq = new THREE.Quaternion();
const _bm = new THREE.Matrix4();

export function stringTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 320;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 320);
  g.strokeStyle = 'rgba(238,246,255,.78)';
  g.lineWidth = 1;
  for (let x = 8; x < 256; x += 11) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 320); g.stroke();
  }
  for (let y = 8; y < 320; y += 11) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 60);
  grd.addColorStop(0, 'rgba(0,0,0,.62)');
  grd.addColorStop(0.55, 'rgba(0,0,0,.28)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function makeRacket(accent, stringTex) {
  const g = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({
    color: accent, roughness: 0.34, metalness: 0.45,
    emissive: new THREE.Color(accent), emissiveIntensity: 0,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9d6e6, roughness: 0.22, metalness: 0.9 });
  const gripMat = new THREE.MeshStandardMaterial({ color: 0x0e131a, roughness: 0.92 });
  const gripAccent = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.7 });

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.0155, 0.235, 12), gripMat);
  grip.position.y = 0.118;
  g.add(grip);
  for (let i = 0; i < 5; i++) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0175, 0.008, 12), gripAccent);
    ring.position.y = 0.06 + i * 0.037;
    g.add(ring);
  }
  const butt = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.014, 12), chrome);
  butt.position.y = 0.004;
  g.add(butt);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.0072, 0.19, 10), chrome);
  shaft.position.y = 0.33;
  g.add(shaft);

  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.0072, 8, 40), frameMat);
  frame.position.y = 0.535;
  frame.scale.set(0.92, 1.22, 1);
  g.add(frame);

  for (const sx of [-1, 1]) {
    const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.085, 6), chrome);
    throat.position.set(sx * 0.028, 0.445, 0);
    throat.rotation.z = sx * -0.32;
    g.add(throat);
  }

  const strings = new THREE.Mesh(
    new THREE.PlaneGeometry(0.196, 0.258),
    new THREE.MeshBasicMaterial({
      map: stringTex, transparent: true, opacity: 0.62,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  strings.position.set(0, 0.535, 0.001);
  g.add(strings);

  const tape = new THREE.Mesh(
    new THREE.TorusGeometry(0.108, 0.0035, 6, 40, Math.PI * 0.5),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 })
  );
  tape.position.set(0, 0.535, 0);
  tape.rotation.z = Math.PI * 0.75;
  tape.scale.set(0.92, 1.22, 1);
  g.add(tape);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.frameMat = frameMat;
  return g;
}

export function loadPlayerGLTF(url) {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

const BONE_NAMES = {
  hips: 'mixamorig:Hips',
  spine1: 'mixamorig:Spine1',
  spine2: 'mixamorig:Spine2',
  neck: 'mixamorig:Neck',
  head: 'mixamorig:Head',
  headEnd: 'mixamorig:HeadTop_End',
  rArm: 'mixamorig:RightArm',
  rForeArm: 'mixamorig:RightForeArm',
  rHand: 'mixamorig:RightHand',
  lArm: 'mixamorig:LeftArm',
  lForeArm: 'mixamorig:LeftForeArm',
  lHand: 'mixamorig:LeftHand',
  rUpLeg: 'mixamorig:RightUpLeg',
  rLeg: 'mixamorig:RightLeg',
  lUpLeg: 'mixamorig:LeftUpLeg',
  lLeg: 'mixamorig:LeftLeg',
  lFoot: 'mixamorig:LeftFoot',
  rFoot: 'mixamorig:RightFoot',
};

/** GLTFLoader 会清洗节点名（去掉冒号），这里做归一化匹配 */
function findBone(root, name) {
  const target = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  let found = null;
  root.traverse((o) => {
    if (found || !o.isBone) return;
    if (o.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() === target) found = o;
  });
  return found;
}

/** Foot-local, meter-space envelope for heel/toe clearance across rigid kits and skins. */
function footEnvelope(model,foot){
  if(!foot)return [];
  const origin=foot.getWorldPosition(new THREE.Vector3()),inverse=foot.getWorldQuaternion(new THREE.Quaternion()).invert();
  const box=new THREE.Box3(),point=new THREE.Vector3();
  const include=(mesh,index)=>box.expandByPoint(mesh.getVertexPosition(index,point).applyMatrix4(mesh.matrixWorld).sub(origin).applyQuaternion(inverse));
  foot.traverse(o=>{if(o.isMesh&&o.visible&&!o.isSkinnedMesh)for(let i=0;i<o.geometry.attributes.position.count;i++)include(o,i);});
  model.traverse(o=>{
    if(!o.isSkinnedMesh||!o.visible)return;
    const bone=o.skeleton.bones.indexOf(foot);if(bone<0)return;
    const weights=o.geometry.attributes.skinWeight,indices=o.geometry.attributes.skinIndex;
    o.skeleton.update();
    for(let i=0;i<weights.count;i++){
      let influence=0;for(let k=0;k<4;k++)if(indices.getComponent(i,k)===bone)influence+=weights.getComponent(i,k);
      if(influence>.8)include(o,i);
    }
  });
  if(box.isEmpty())return [new THREE.Vector3(0,-.045,.12)];
  return [0,1,2,3,4,5,6,7].map(i=>new THREE.Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z));
}

/** 让骨骼指向世界方向（在动画姿态上做增量旋转） */
function aimBone(bone, child, dirWorld) {
  if (!bone || !child) return;
  const len = child.position.length();
  if (len < 1e-5) return;
  const localDir = _lv.copy(child.position).multiplyScalar(1 / len);

  const parentQ = _aq;
  if (bone.parent) bone.parent.getWorldQuaternion(parentQ);
  else parentQ.identity();

  const worldQ = _bq.copy(parentQ).multiply(bone.quaternion);
  const curDir = _dv.copy(localDir).applyQuaternion(worldQ).normalize();
  const delta = _cq.setFromUnitVectors(curDir, dirWorld.clone().normalize());
  const newWorldQ = delta.multiply(worldQ);
  bone.quaternion.copy(parentQ.invert().multiply(newWorldQ));
  bone.updateMatrixWorld(true);
}

function solveElbow(shoulder, wrist, l1, l2, pole, outElbow) {
  const dir = _sv.copy(wrist).sub(shoulder);
  let d = dir.length();
  if (d < 1e-4) { dir.set(0, -1, 0); d = 1e-4; }
  d = clamp(d, Math.abs(l1 - l2) + 0.004, l1 + l2 - 0.004);
  dir.normalize();
  const along = (l1 * l1 + d * d - l2 * l2) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const perp = _pv.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1);
  perp.normalize();
  outElbow.copy(shoulder).addScaledVector(dir, along).addScaledVector(perp, h);
}

/** 骨轴指向子骨：axis=+1 表示骨骼本地 +X 指向子骨，-1 表示本地 -X */
function basisQuatBoneAxis(axis, dirToChild, normalHint, out) {
  const x = dirToChild.clone().normalize().multiplyScalar(axis);
  const z = normalHint.clone().addScaledVector(x, -normalHint.dot(x));
  if (z.lengthSq() < 1e-6) {
    z.set(0, 0, 1);
    if (Math.abs(z.dot(x)) > 0.95) z.set(1, 0, 0);
    z.addScaledVector(x, -z.dot(x));
  }
  z.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  _bm.makeBasis(x, y, z);
  out.setFromRotationMatrix(_bm);
  return out;
}

function blendSliceRacket(frame, pose, axes, root, weight) {
  const shaft = new THREE.Vector3(frame.shaft.x, frame.shaft.y, frame.shaft.z);
  const normal = new THREE.Vector3(frame.normal.x, frame.normal.y, frame.normal.z);
  const start = basisQuatBoneAxis(1, shaft, normal, new THREE.Quaternion());
  const end = basisQuatBoneAxis(1,
    shaft.set(pose.shaft.x * axes.x, pose.shaft.y, pose.shaft.z * axes.z),
    normal.set(pose.normal.x * axes.x, pose.normal.y, pose.normal.z * axes.z),
    new THREE.Quaternion());
  start.slerp(end, weight);
  const center = new THREE.Vector3(frame.center.x, frame.center.y, frame.center.z).lerp(new THREE.Vector3(
    root.x + (pose.center.x - pose.hip.x) * axes.x,
    pose.center.y,
    root.z + (pose.center.z - pose.hip.z) * axes.z
  ), weight);
  return { center, shaft: shaft.copy(X).applyQuaternion(start), normal: normal.copy(Z).applyQuaternion(start) };
}

export class PlayerView {
  constructor(gltf, { accent = 0x3FD0FF, shadowTex, character = getCharacter('athlete') } = {}) {
    this.character = character;
    this.id = character.id;
    this.sourceGeometry = new Set();
    this.sourceTextures = new Set([shadowTex]);
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      this.sourceGeometry.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        for (const value of Object.values(m)) if (value?.isTexture) this.sourceTextures.add(value);
    });
    this.root = new THREE.Group();
    this.accent = accent;

    const model = SkeletonUtils.clone(gltf.scene);
    this.model = model;
    this.root.add(model);

    this.bone = {};
    for (const [k, name] of Object.entries(BONE_NAMES)) {
      this.bone[k] = findBone(model, name);
    }

    const required = ['rArm','rForeArm','rHand','lArm','lForeArm','lHand','rUpLeg','rLeg','rFoot','lUpLeg','lLeg','lFoot','spine1','spine2','head'];
    const missing = required.filter(key => !this.bone[key]);
    if (missing.length) throw new Error(`角色骨骼不兼容，缺少：${missing.join(', ')}。请使用登记的 Mixamo 双足骨架。`);

    // 用骨骼量身高：蒙皮网格的包围盒在绑定姿态下不可靠
    this.root.updateMatrixWorld(true);
    const tmpP = new THREE.Vector3();
    const headTopY = this.bone.headEnd
      ? this.bone.headEnd.getWorldPosition(tmpP).y
      : 1.62;
    let footY = Infinity;
    for (const k of ['lFoot', 'rFoot']) {
      const b = this.bone[k];
      if (b) footY = Math.min(footY, b.getWorldPosition(tmpP).y);
    }
    if (!Number.isFinite(footY)) footY = 0.08;
    const span = Math.max(0.4, headTopY - footY) + 0.07;
    const scale = character.effectiveHeight / span;
    model.scale.setScalar(scale);
    model.position.y = -footY * scale;

    // 队服配色
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const next = mats.map((m) => {
        const c = m.clone();
        if (character.appearance !== 'athlete') {
          if (m.userData.teamColor === true) c.color.setHex(accent);
        } else if (m.name && /joint/i.test(m.name)) {
          c.color.setHex(0xc28e70);
          c.roughness = 0.72;
        } else {
          c.color.setHex(0xd6a080);
          c.roughness = 0.56;
          c.metalness = 0.04;
        }
        return c;
      });
      o.material = Array.isArray(o.material) ? next : next[0];
    });

    this.model = model;

    if (character.appearance === 'athlete') addSportsKit(this.root, this.bone, accent);
    else if (character.appearance === 'rabbit') addRabbitKit(this.root, this.bone, accent);
    else if (character.appearance === 'roster') addRosterKit(this.root, this.bone, character);

    // 骨骼长度（绑定姿态，已缩放）
    this.root.updateMatrixWorld(true);
    const seg = (a, b, dflt) => (a && b)
      ? a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()))
      : dflt;

    // 两只手臂：随时可切换持拍手（左右手骨轴镜像：右手 -X，左手 +X）
    const mkArm = (aKey, fKey, hKey, side) => {
      const a = this.bone[aKey], f = this.bone[fKey], h = this.bone[hKey];
      const restQ = h ? h.quaternion.clone() : new THREE.Quaternion();
      const handName = side === 1 ? 'RightHand' : 'LeftHand';
      let ax = 0;
      if (h) {
        for (const c of h.children) {
          if (Math.abs(c.position.x) > Math.abs(ax)) ax = c.position.x;
        }
      }
      return {
        arm: a, fore: f, hand: h, side,
        axis: ax < 0 ? -1 : 1,
        l1: seg(a, f, 0.28), l2: seg(f, h, 0.26),
        restQ, restQInv: restQ.clone().invert(),
        sliceFingers: ['Thumb1', 'Index2', 'Middle2', 'Ring2', 'Pinky2']
          .map(name => findBone(model, handName + name)),
        fingers: ['Index', 'Middle', 'Ring', 'Pinky'].flatMap(name =>
          [1, 2, 3].flatMap(joint => {
            const bone = findBone(model, handName + name + joint);
            return bone ? [{ bone, rest: bone.quaternion.clone(), joint }] : [];
          })),
      };
    };
    this.arms = {
      right: mkArm('rArm', 'rForeArm', 'rHand', 1),
      left: mkArm('lArm', 'lForeArm', 'lHand', -1),
    };
    this.handKey = '';

    // 两条腿：程序化步法 IK
    const mkLeg = (uKey, kKey, fKey, side) => {
      const u = this.bone[uKey], k = this.bone[kKey], f = this.bone[fKey];
      const fp = f ? f.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 0.09, 0);
      return {
        up: u, knee: k, foot: f, side,
        l1: seg(u, k, 0.42), l2: seg(k, f, 0.4),
        restY: fp.y,
        soleCorners: footEnvelope(model,f),
        restWorldQ: f ? f.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion(),
        st: { x: 0, z: 0, init: false, on: false, t: 0, dur: 0.2, fx: 0, fz: 0, tx: 0, tz: 0, lift: 0 },
      };
    };
    this.legs = {
      right: mkLeg('rUpLeg', 'rLeg', 'rFoot', -1),
      left: mkLeg('lUpLeg', 'lLeg', 'lFoot', 1),
    };
    this.ankleY = Math.min(this.legs.left.restY, this.legs.right.restY, 0.09);

    // 球拍：拍杆沿手骨轴向（-X，手指方向），拍面法线 = 手骨 Z
    this.racket = makeRacket(accent, stringTexture());
    this.racket.position.set(0, 0, 0);
    this.racket.rotation.z = Math.PI / 2;
    this.setHand('right');

    // 每帧从绑定局部姿态开始，再叠加动画/IK，禁止程序化旋转累积。
    this.bindPose = [];
    model.traverse(o => { if (o.isBone) this.bindPose.push({ bone:o, q:o.quaternion.clone(), p:o.position.clone() }); });
    this.readyTorso = this.bindPose.filter(rest => [this.bone.spine1, this.bone.spine2, this.bone.neck, this.bone.head].includes(rest.bone));
    this.strokeKey = ''; this.strokeAge = 1;
    this.locomotion = new ContactLocomotion();
    this.hipBind = this.bone.hips ? {p:this.bone.hips.position.clone(),q:this.bone.hips.quaternion.clone()} : null;
    this.pelvisOffset = new THREE.Vector3();
    this.hipParentScale = new THREE.Vector3();

    // 动画混合
    this.mixer = new THREE.AnimationMixer(model);
    const byName = {};
    for (const clip of gltf.animations || []) byName[clip.name.toLowerCase()] = clip;
    const pick = (keys) => keys.map((k) => byName[k]).find(Boolean) || null;
    const mk = (clip, w) => {
      if (!clip) return null;
      const a = this.mixer.clipAction(clip);
      a.setEffectiveWeight(w);
      a.play();
      return a;
    };
    this.actions = {
      idle: mk(pick(['idle', 'sad_pose', 'agree']), 1),
      walk: mk(pick(['walk']), 0),
      run: mk(pick(['run']), 0),
    };

    this.wWalk = 0; this.wRun = 0;
    this.sx = 0;
    this.sz = 0;
    this.speed = 0;
    this.jump = 0;
    this.racketFlash = 0;

    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.0),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.6 })
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.008;

    // 复用对象
    this.shoulderW = new THREE.Vector3();
    this.elbowW = new THREE.Vector3();
    this.wristW = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.ready = new THREE.Vector3();
    this.ballW = new THREE.Vector3();
    this.rootQ = new THREE.Quaternion();
    this.pole = new THREE.Vector3();
    this.shaftDir = new THREE.Vector3();
    this.normal = new THREE.Vector3();
    this.phoneAim = new THREE.Vector3(0, 1, 0);
    this.phoneAimW = new THREE.Vector3(0, 1, 0);
    this.qPose = new THREE.Quaternion();
    this.handQ = new THREE.Quaternion();
    this.tmpQ = new THREE.Quaternion();
    this.tmpV = new THREE.Vector3();
    this.bodyQInv = new THREE.Quaternion();
    this.dirBody = new THREE.Vector3();
    this.rightV = new THREE.Vector3();
    this.legQInv = new THREE.Quaternion();
    this.legPole = new THREE.Vector3();
    this.hipW = new THREE.Vector3();
    this.ankleW = new THREE.Vector3();
    this.kneeW = new THREE.Vector3();
    this.footOffset = new THREE.Vector3();
    this.crouch = 0;
    // 步法状态：启动步、交叉步
    this.prevOnMy = false;
    this.splitT = 0;
    this.splitCool = 0;
    this.stepPhase = 0;
  }

  addTo(scene) {
    scene.add(this.root, this.blob);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
    for (const root of [this.root, this.blob]) root.traverse(o => {
      if (!o.isMesh) return;
      if (!this.sourceGeometry.has(o.geometry)) geometries.add(o.geometry);
      if (o.skeleton) skeletons.add(o.skeleton);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        for (const value of Object.values(m)) if (value?.isTexture && !this.sourceTextures.has(value)) textures.add(value);
      }
    });
    for (const resource of [...geometries, ...materials, ...textures, ...skeletons]) resource.dispose();
    this.root.removeFromParent(); this.blob.removeFromParent(); this.root.clear();
  }

  /** 球拍换到另一只手（骨轴 -X = 手指方向，拍面法线 = 手骨 Z） */
  setHand(key) {
    const a = this.arms[key] || this.arms.right;
    const h = a && a.hand;
    if (!h || this.handKey === key) return;
    this.handKey = key;
    this.root.updateMatrixWorld(true);
    const hs = new THREE.Vector3();
    h.getWorldScale(hs);
    if (hs.x > 0) this.racket.scale.setScalar(1 / hs.x);
    // 右手骨轴 -X、左手 +X：拍杆转到手指方向
    this.racket.rotation.z = a.axis > 0 ? -Math.PI / 2 : Math.PI / 2;
    h.add(this.racket);
    this.racket.updateMatrixWorld(true);
  }

  /** Contact targets are world-space: stance ankles stay planted while the pelvis moves. */
  updateLegs() {
    if (!this.motionState) return;
    for(const key of ['left','right']){
      const leg=this.legs[key],foot=this.motionState.feet[key];
      if(!leg.up||!leg.knee||!leg.foot)continue;
      const hip=leg.up.getWorldPosition(this.hipW);
      this.handQ.setFromAxisAngle(Y,foot.yaw).multiply(this.tmpQ.setFromAxisAngle(X,foot.pitch)).multiply(leg.restWorldQ);
      let bottom=Infinity;
      for(const corner of leg.soleCorners)bottom=Math.min(bottom,this.tmpV.copy(corner).applyQuaternion(this.handQ).y);
      const clearance=Math.max(this.ankleY,-bottom+.001);
      this.ankleW.set(foot.x,clearance+foot.lift+this.jump,foot.z);
      // A small soft extension limit is retained as a safety net, not a sliding foot planner.
      const reach=leg.l1+leg.l2-.004,delta=this.tmpV.copy(this.ankleW).sub(hip);
      if(delta.length()>reach)this.ankleW.copy(hip).add(delta.setLength(reach));
      // During a pivot, bend over the planted toes even while the chest faces away.
      this.legPole.set(leg.side*.12,0,1).applyAxisAngle(Y,foot.yaw).normalize();
      solveElbow(hip,this.ankleW,leg.l1,leg.l2,this.legPole,this.kneeW);
      aimBone(leg.up,leg.knee,this.kneeW.clone().sub(hip));
      aimBone(leg.knee,leg.foot,this.ankleW.clone().sub(this.kneeW));
      // Foot heading/heel-to-toe roll is independent of the torso's turning animation.
      this.handQ.setFromAxisAngle(Y,foot.yaw).multiply(this.tmpQ.setFromAxisAngle(X,foot.pitch)).multiply(leg.restWorldQ);
      leg.knee.getWorldQuaternion(this.tmpQ).invert();
      leg.foot.quaternion.copy(this.tmpQ.multiply(this.handQ));leg.foot.updateMatrixWorld(true);
    }
  }

  update(dt, p, ball, context = {}) {
    const isLeft = p.z < 0;
    const root = this.root;

    if (!this.inited) {
      this.sx = p.x; this.sz = p.z; this.inited = true;
    }
    this.sx += (p.x - this.sx) * (1 - Math.exp(-24 * dt));
    this.sz += (p.z - this.sz) * (1 - Math.exp(-24 * dt));
    root.position.x = this.sx;
    root.position.z = this.sz;
    root.rotation.y = isLeft ? 0 : Math.PI;

    // 速度 → 动画权重
    const inst = Math.hypot(p.vx || 0, p.vz || 0);
    this.speed += (inst - this.speed) * (1 - Math.exp(-8 * dt));

    const moveW = clamp((this.speed - 0.35) / 2.0, 0, 1);
    const runW = clamp((this.speed - 2.0) / 2.2, 0, 1);
    this.wRun += (runW - this.wRun) * (1 - Math.exp(-9 * dt));
    this.wWalk += ((moveW - runW) - this.wWalk) * (1 - Math.exp(-9 * dt));

    if (this.actions.idle) this.actions.idle.setEffectiveWeight(clamp(1 - this.wWalk - this.wRun, 0, 1));
    if (this.actions.walk) {
      this.actions.walk.setEffectiveWeight(this.wWalk);
      this.actions.walk.setEffectiveTimeScale(clamp(this.speed / 1.7, 0.7, 1.7));
    }
    if (this.actions.run) {
      this.actions.run.setEffectiveWeight(this.wRun);
      this.actions.run.setEffectiveTimeScale(clamp(this.speed / 4.0, 0.8, 1.5));
    }
    for (const rest of this.bindPose) { rest.bone.quaternion.copy(rest.q); rest.bone.position.copy(rest.p); }
    this.mixer.update(dt);
    root.updateMatrixWorld(true);

    const sw=clamp(p.flash||0,0,1),face=isLeft?1:-1;
    const bx=face*(ball.x-root.position.x),bz=face*(ball.z-root.position.z);
    const onMy=isLeft?ball.z<0:ball.z>0,dist=Math.hypot(bx,bz);
    const ballInPlay = context.phase !== 'point' && context.phase !== 'over';
    const near=onMy&&ballInPlay?clamp(1-dist/3,0,1):0;
    const lowLunge=near*clamp(1.75-ball.y,0,1);
    const handKey=p.hand==='left'?'left':'right';this.setHand(handKey);
    const arm=this.arms[handKey]||this.arms.right;
    const stroke=p.stroke,key=stroke?`${stroke.id}:${!!stroke.hit}`:'';
    const newStroke = key !== this.strokeKey;
    if(newStroke){this.strokeKey=key;this.strokeAge=stroke?.contactAge??stroke?.age??1;}
    else this.strokeAge=Math.max(this.strokeAge+dt,stroke?.age??0);
    const active=stroke&&this.strokeAge<.48;
    const rear = p.rearMove;
    const rearSwing = active && stroke.shot === 'drive';
    const sliceSwing = active && stroke.shot === 'slice';
    const authoredBody = rear?.kind === 'slice' ? sampleBackhand(rear.progress) : null;
    const slice = sliceSwing ? sampleBackhandStroke(this.strokeAge, stroke.direction) : authoredBody;
    const bodySlice = authoredBody || slice;
    const sliceAxes = bodySlice && backhandAxes(isLeft ? 'left' : 'right', handKey);
    // Keep ready hands through the split, and release them as the turn completes
    // while the feet finish their authored recovery.
    const armLoad = authoredBody ? smooth(clamp((rear.progress - .16) / .16, 0, 1)) : 1;
    const armRelease = authoredBody ? smooth(clamp((rear.progress - .65) / .12, 0, 1)) : 0;
    const sliceArms = (rear?.weight ?? 1) * armLoad * (1 - armRelease);
    const neutralReady = (1 - smooth(clamp(this.speed / 1.2, 0, 1))) * (1 - lowLunge);
    // Returning the arms to the Blender ready pose follows torso progress, not
    // the completion of the feet. Keep the same pose through the last step.
    const readyWeight = active ? 0 : authoredBody
      ? 1 - armLoad * (1 - armRelease)
      : rear ? 0 : neutralReady;
    for (const { bone, q } of this.readyTorso) bone.quaternion.slerp(q, readyWeight);
    const releaseStart = CONTACT_TIME + CONTACT_WINDOW;
    const hasAuthoredSwing = sliceSwing && authoredBody;
    const sliceRelease = hasAuthoredSwing ? smooth(clamp((this.strokeAge - releaseStart) / (.43 - releaseStart), 0, 1)) : 0;
    const sliceWindup = hasAuthoredSwing ? 1 - smooth(clamp(this.strokeAge / (CONTACT_TIME - CONTACT_WINDOW), 0, 1)) : 0;
    const sliceBlend = Math.max(sliceWindup, sliceRelease);
    let frame = active && stroke.anchor
      ? (newStroke && stroke.contactPose) || contactFrame({ ...p, side: isLeft ? 'left' : 'right', hand: handKey }, stroke,
        sliceRelease > 0 ? releaseStart : this.strokeAge)
      : null;
    // Blend the rendered racket into the contact window and back onto the
    // authored motion. The game still resolves the same contact frame.
    if (frame && sliceBlend > 0) frame = blendSliceRacket(frame, authoredBody, sliceAxes, root.position, sliceBlend);
    // Reference profile contact is recalculated again after the pelvis/torso solve.
    const profile=sampleStrokePose(active?this.strokeAge:0,stroke?.shot||'clear',handKey==='left'?-1:1,{x:0,y:clamp(p.y,.8,2.65),z:.55},stroke?.variant);
    // Mixamo's right shoulder is on local -X when the character faces +Z.
    profile.freeHand.x *= -1;
    if ((rear && rear.kind !== 'slice') || rearSwing) {
      const handSign = handKey === 'left' ? 1 : -1;
      const unwind = rearSwing ? clamp((this.strokeAge - .06) / .14, 0, 1) : 0;
      const prep = rear?.turn ?? 0;
      profile.pelvisYaw = handSign * (prep * .46 - unwind * .22);
      profile.torsoYaw = handSign * (prep * .90 - unwind * .39);
      const lowContact = rearSwing && stroke.anchor ? clamp((1.44 - stroke.anchor.y) / .70, 0, 1) : 0;
      profile.chestPitch = (rear?.load ?? 0) * (.14 + Math.max(rear?.low ?? 0, lowContact) * .25);
      profile.elbowLift = rearSwing ? .21 * (1 - unwind) : .16 * prep;
      profile.freeHand.x = -handSign * (.32 + .16 * prep);
      profile.freeHand.z -= .38 * prep;
    }
    if (bodySlice) {
      const mirror = handKey === 'left' ? -1 : 1;
      const yaw = bodySlice.yaw > 2.5 ? bodySlice.yaw - 2 * Math.PI : bodySlice.yaw;
      const weight = rear?.weight ?? 1;
      profile.pelvisYaw = yaw * mirror * weight * .81;
      profile.torsoYaw = yaw * mirror * weight;
      profile.freeHand.x += ((bodySlice.freeHand.x - bodySlice.hip.x) * sliceAxes.x * (isLeft ? 1 : -1) - profile.freeHand.x) * sliceArms;
      profile.freeHand.y += (bodySlice.freeHand.y - profile.freeHand.y) * sliceArms;
      profile.freeHand.z += (bodySlice.hip.z - bodySlice.freeHand.z - profile.freeHand.z) * sliceArms;
    }
    this.strokePose=profile;
    if (!authoredBody && this.sliceFootHandoff) {
      this.locomotion.adoptStance(root.position, this.sliceFootHandoff);
      this.sliceFootHandoff = null;
    }
    this.motionState=this.locomotion.update(dt,{x:root.position.x,z:root.position.z,vx:p.vx||0,vz:p.vz||0,yaw:isLeft?0:Math.PI,hand:handKey,
      near:lowLunge,ballX:ball.x,ballZ:ball.z,
      legReach:Math.min(this.legs.left.l1+this.legs.left.l2,this.legs.right.l1+this.legs.right.l2),
      opponentImpactId:context.opponentImpactId,opponentImpactAge:context.opponentImpactAge});
    if (rear) {
      const blend = rear.weight;
      const footBlend = rear.footWeight ?? blend;
      if (authoredBody) this.sliceFootHandoff = Object.values(rear.feet).every(foot => foot.stance) ? rear.feet : null;
      for (const side of ['left', 'right']) {
        const base = this.motionState.feet[side];
        const target = rear.feet[side];
        for (const key of ['x', 'z', 'yaw', 'lift', 'pitch']) base[key] += (target[key] - base[key]) * footBlend;
        if (footBlend > .7) base.stance = target.stance;
      }
      for (const key of ['x', 'z', 'drop']) this.motionState.pelvis[key] += (rear.pelvis[key] - this.motionState.pelvis[key]) * blend;
      this.motionState.splitHeight *= 1 - footBlend;
    }
    const smashRise = frame && stroke.shot === 'smash'
      ? Math.sin(Math.PI * clamp((this.strokeAge + .015) / .34, 0, 1)) * clamp(stroke.anchor.y - 2.13, .18, .58)
      : 0;
    this.jump=Math.max(this.motionState.splitHeight,smashRise);
    const lowDrive = rearSwing && stroke.anchor
      ? clamp((1.43 - stroke.anchor.y) / .66, 0, 1) * Math.sin(Math.PI * clamp(this.strokeAge / .37, 0, 1)) * .12
      : 0;
    const desiredDrop=.075+(readyPose.hipDrop-.075)*readyWeight+clamp(this.speed/3.6,0,1)*.09+this.motionState.pelvis.drop+profile.load*.025+lowDrive;
    if (!this.crouch) this.crouch = desiredDrop;
    this.crouch+=(clamp(desiredDrop,.075,rear?.weight > .5 ? .40 : .30)-this.crouch)*(1-Math.exp(-15*dt));
    root.position.y=this.jump;
    root.updateMatrixWorld(true);
    if(this.bone.hips&&this.hipBind){
      const hips=this.bone.hips,body=this.motionState.pelvis;
      hips.position.copy(this.hipBind.p);hips.quaternion.copy(this.hipBind.q);
      hips.parent.getWorldQuaternion(this.tmpQ).invert();hips.parent.getWorldScale(this.hipParentScale);
      this.pelvisOffset.set(body.x,-this.crouch,body.z).applyQuaternion(this.tmpQ).divide(this.hipParentScale);
      hips.position.add(this.pelvisOffset);
      hips.quaternion.multiply(this.tmpQ.setFromAxisAngle(Y,profile.pelvisYaw));
      hips.quaternion.multiply(this.tmpQ.setFromAxisAngle(X,body.pitch));
      hips.quaternion.multiply(this.tmpQ.setFromAxisAngle(new THREE.Vector3(0,0,1),body.roll));
      hips.updateMatrixWorld(true);
    }
    const rootQ=this.rootQ;root.getWorldQuaternion(rootQ);

    // 手机姿态 → 手臂/球拍
    // 握拍时手机机头就是拍杆方向，屏幕法线就是拍面法线
    if (p.pose && p.pose.length === 4) this.qPose.fromArray(p.pose);
    else this.qPose.identity();
    this.phoneAim.set(0, 1, 0).applyQuaternion(this.qPose).normalize();
    this.phoneAimW.copy(this.phoneAim).applyQuaternion(rootQ);
    this.normal.set(0, 0, 1).applyQuaternion(this.qPose).applyQuaternion(rootQ);

    // 躯干：追球转身 + 手机机头左右带动大臂/上身
    if (this.bone.spine1) {
      const aimSide = clamp(this.phoneAim.x, -1, 1);
      const twist = clamp(
        profile.torsoYaw-profile.pelvisYaw + clamp(bx * 0.05, -0.12, 0.12)
          + (aimSide * 0.12 + (p.dir || 0) * sw * 0.12) * arm.side,
        -0.55, 0.55
      );
      this.bone.spine1.quaternion.multiply(this.tmpQ.setFromAxisAngle(Y, twist));
      this.bone.spine1.quaternion.multiply(this.tmpQ.setFromAxisAngle(X, profile.chestPitch+(!active?lowLunge*.1:0)+readyPose.chestLean*readyWeight));
      this.bone.spine1.updateMatrixWorld(true);
    }
    if (this.bone.spine2) {
      this.bone.spine2.quaternion.multiply(this.tmpQ.setFromAxisAngle(Y, -clamp(bx * 0.05, -0.15, 0.15)));
      this.bone.spine2.updateMatrixWorld(true);
    }

    // 头骨的子骨方向是头顶，不能直接指向球，否则整个头会横倒。
    if (this.bone.head) {
      const look = ballInPlay ? 1 : 1 - readyWeight;
      const yaw = clamp(Math.atan2(bx,Math.max(1,Math.abs(bz))),-0.45,0.45) * look;
      const pitch = clamp((1.7-ball.y)*0.10,-0.18,0.18) * look - readyPose.chestLean*.72*readyWeight;
      this.bone.head.quaternion.multiply(this.tmpQ.setFromAxisAngle(Y,yaw));
      this.bone.head.quaternion.multiply(this.tmpQ.setFromAxisAngle(X,pitch));
      this.bone.head.updateMatrixWorld(true);
    }

    // Shift the shoulder with the body before solving either arm or planted leg.
    if (frame && this.bone.hips && arm.arm) {
      const hips = this.bone.hips;
      arm.arm.getWorldPosition(this.shoulderW);
      this.pelvisOffset.set(frame.center.x, frame.center.y, frame.center.z)
        .addScaledVector(this.shaftDir.set(frame.shaft.x, frame.shaft.y, frame.shaft.z), -.535)
        .sub(this.shoulderW);
      const excess = this.pelvisOffset.length() - (arm.l1 + arm.l2 - .024);
      if (excess > 0) {
        hips.parent.getWorldQuaternion(this.tmpQ).invert();
        this.pelvisOffset.setLength(Math.min(.29, excess) * (1 - sliceBlend)).applyQuaternion(this.tmpQ).divide(this.hipParentScale);
        hips.position.add(this.pelvisOffset);
        hips.updateMatrixWorld(true);
      }
    }

    // 步法 IK（并步/跨步/弓步）
    this.updateLegs();

    // 持拍手 IK
    const rArm = arm.arm, rFore = arm.fore, rHand = arm.hand;
    if (rArm && rFore && rHand) {
      const shoulderW = rArm.getWorldPosition(this.shoulderW);

      // 手机只小幅影响准备位，击球使用明确的引拍 → 触球 → 收拍轨迹。
      const contact = new THREE.Vector3(0, clamp(p.y,0.8,2.65), 0.55);
      if (stroke?.contact) {
        contact.set(stroke.contact.x-root.position.x, stroke.contact.y-root.position.y, stroke.contact.z-root.position.z);
        contact.applyQuaternion(this.bodyQInv.copy(rootQ).invert());
      }
      const point = sampleStrokePose(active ? this.strokeAge : 0, stroke?.shot || 'clear', handKey==='left'?-1:1, contact).target;
      if (!active) {
        point.x = -.31 * arm.side;
        point.y = 1.43 - .27 * this.crouch;
        point.z = .68;
      }
      if (!active && authoredBody) {
        const weight = sliceArms;
        point.x += ((authoredBody.center.x - authoredBody.hip.x) * sliceAxes.x * (isLeft ? 1 : -1) - point.x) * weight;
        point.y += (authoredBody.center.y - point.y) * weight;
        point.z += ((authoredBody.hip.z - authoredBody.center.z) - point.z) * weight;
      } else if (!active && rear && rear.kind !== 'slice') {
        const turn = rear.turn;
        point.x += ((handKey === 'left' ? .56 : -.56) - point.x) * turn;
        point.y += (1.36 - point.y) * turn;
        point.z -= .84 * turn;
      } else if (!active) {
        // Anticipate a low shuttle with the racket in front of the leading knee.
        // Confirmed strokes retain their authoritative contact trajectory.
        point.y += (Math.max(.45,ball.y-root.position.y+.12)-point.y)*lowLunge;
        point.z += .15*lowLunge;
        point.x += clamp(this.phoneAim.x,-0.5,0.5)*0.12;
        point.y += clamp(this.phoneAim.y,-0.5,0.5)*0.15;
      }
      if (readyWeight > 0) {
        const [x, y, z] = readyPose.racketHand;
        const [dx, dy, dz] = readyPose.shaft;
        point.x += ((x + dx * .535) * arm.side - point.x) * readyWeight;
        point.y += (y + dy * .535 + readyPose.hipDrop - this.crouch - point.y) * readyWeight;
        point.z += (z + dz * .535 - point.z) * readyWeight;
      }
      this.target.set(point.x,point.y,point.z).applyQuaternion(rootQ).add(root.position);
      // 由拍面中心反求腕部，拍杆长度与实际几何一致；肘和腕分别求解。
      if (frame) {
        this.target.set(frame.center.x, frame.center.y, frame.center.z);
        this.shaftDir.set(frame.shaft.x, frame.shaft.y, frame.shaft.z);
      } else if (!active) {
        this.tmpV.fromArray(readyPose.shaft);
        this.tmpV.x *= arm.side;
        this.shaftDir.set(-.12 * arm.side, .83 - lowLunge * .36, .55).normalize().lerp(this.tmpV, readyWeight).normalize().applyQuaternion(rootQ);
      } else {
        this.shaftDir.copy(this.target).sub(shoulderW).normalize();
        this.shaftDir.applyAxisAngle(this.rightV.set(1,0,0).applyQuaternion(rootQ),profile.shaftLag);
      }
      if (!active && authoredBody && sliceArms > 0) {
        this.shaftDir.lerp(this.tmpV.set(authoredBody.shaft.x * sliceAxes.x, authoredBody.shaft.y, authoredBody.shaft.z * sliceAxes.z), sliceArms).normalize();
      }
      this.wristW.copy(this.target).addScaledVector(this.shaftDir,-0.535);
      const armReach = arm.l1 + arm.l2 - 0.012;
      const wristOffset = this.tmpV.copy(this.wristW).sub(shoulderW);
      if (wristOffset.length() > armReach) this.wristW.copy(shoulderW).add(wristOffset.setLength(armReach));
      this.pole.set((.65+profile.load*.15)*arm.side,-.6+profile.elbowLift,-.2-profile.load*.25)
        .lerp(this.tmpV.set(-.32*arm.side,-1,-.25), readyWeight).applyQuaternion(rootQ);
      if (slice) {
        this.tmpV.set(root.position.x + (slice.elbow.x - slice.hip.x) * sliceAxes.x,
          slice.elbow.y, root.position.z + (slice.elbow.z - slice.hip.z) * sliceAxes.z).sub(shoulderW);
        if (sliceBlend > 0) this.tmpV.lerp(this.elbowW.set(
          root.position.x + (authoredBody.elbow.x - authoredBody.hip.x) * sliceAxes.x,
          authoredBody.elbow.y,
          root.position.z + (authoredBody.elbow.z - authoredBody.hip.z) * sliceAxes.z
        ).sub(shoulderW), sliceBlend);
        this.pole.normalize().lerp(this.tmpV.normalize(), sliceArms);
      }
      solveElbow(shoulderW,this.wristW,arm.l1,arm.l2,this.pole,this.elbowW);
      aimBone(rArm,rFore,this.elbowW.clone().sub(shoulderW));
      aimBone(rFore,rHand,this.wristW.clone().sub(this.elbowW));
      this.normal.set(0,0,1).applyQuaternion(rootQ).applyAxisAngle(this.shaftDir,profile.forearmRoll);
      if (readyWeight > 0) {
        this.tmpV.copy(this.shaftDir).multiplyScalar(arm.axis).cross(Y).normalize();
        this.normal.lerp(this.tmpV, readyWeight);
      }
      if (frame) this.normal.set(frame.normal.x, frame.normal.y, frame.normal.z);
      if (!active && authoredBody) {
        this.normal.lerp(this.tmpV.set(authoredBody.normal.x * sliceAxes.x, authoredBody.normal.y, authoredBody.normal.z * sliceAxes.z), sliceArms).normalize();
      }
      basisQuatBoneAxis(arm.axis,this.shaftDir,this.normal,this.handQ);
      rFore.getWorldQuaternion(this.tmpQ).invert();
      rHand.quaternion.copy(this.tmpQ.multiply(this.handQ));
      this.poseFingers(arm, GRIP_CURL);
      if (slice) arm.sliceFingers.forEach((finger, i) => {
        if (!finger) return;
        this.tmpV.set(0, i === 0 ? 1 : 0, i === 0 ? 0 : 1);
        finger.quaternion.multiply(this.tmpQ.setFromAxisAngle(this.tmpV, -arm.axis * slice.grip[i] * sliceArms));
      });
      rHand.updateMatrixWorld(true);
    }

    // 非持拍手保持平衡，避免沿用机器人跑步时的僵直摆臂。
    const free = this.arms[handKey === 'left' ? 'right' : 'left'];
    if (free?.arm && free.fore && free.hand) {
      const shoulder = free.arm.getWorldPosition(this.shoulderW);
      this.wristW.set(profile.freeHand.x,profile.freeHand.y,profile.freeHand.z);
      if (!active) this.wristW.y -= this.crouch * (1 - (authoredBody ? sliceArms : 0)) * .4;
      const [x, y, z] = readyPose.freeHand;
      this.wristW.lerp(this.tmpV.set(x * arm.side, y + readyPose.hipDrop - this.crouch, z), readyWeight).applyQuaternion(rootQ).add(root.position);
      this.pole.set(.8*free.side,-.3,-.2).lerp(this.tmpV.set(-.32*free.side,-1,-.25), readyWeight).applyQuaternion(rootQ);
      solveElbow(shoulder,this.wristW,free.l1,free.l2,this.pole,this.elbowW);
      aimBone(free.arm,free.fore,this.elbowW.clone().sub(shoulder));
      aimBone(free.fore,free.hand,this.wristW.clone().sub(this.elbowW));
      if (readyWeight > 0) {
        this.tmpV.copy(this.wristW).sub(this.elbowW).normalize();
        this.normal.copy(this.tmpV).multiplyScalar(free.axis).cross(Y);
        basisQuatBoneAxis(free.axis,this.tmpV,this.normal,this.handQ);
        free.fore.getWorldQuaternion(this.tmpQ).invert();
        free.hand.quaternion.slerp(this.tmpQ.multiply(this.handQ), readyWeight);
      }
      this.poseFingers(free, RELAXED_CURL);
    }

    // 软影
    this.blob.position.set(root.position.x, 0.008, root.position.z);
    const bs = 1 - clamp(this.jump * 1.5, 0, 0.4);
    this.blob.scale.set(bs, bs, 1);
    this.blob.material.opacity = 0.6 * bs;

    this.racketFlash = Math.max(0, this.racketFlash - dt * 3.4);
    if (this.racket) this.racket.userData.frameMat.emissiveIntensity = this.racketFlash * 2.2;
  }

  poseFingers(arm, curl) {
    for (const { bone, rest, joint } of arm.fingers) {
      bone.quaternion.copy(rest).multiply(this.tmpQ.setFromAxisAngle(Z, -arm.axis * curl[joint - 1]));
    }
    arm.hand.updateMatrixWorld(true);
  }
}
