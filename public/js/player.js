import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// ============================================================
// GLB 球员视图：Mixamo 骨骼 + 动画混合 + 双骨 IK 覆盖
// ============================================================
const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
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
  spine1: 'mixamorig:Spine1',
  spine2: 'mixamorig:Spine2',
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

export class PlayerView {
  constructor(gltf, { accent = 0x3FD0FF, shadowTex } = {}) {
    this.root = new THREE.Group();
    this.accent = accent;

    const model = SkeletonUtils.clone(gltf.scene);
    this.model = model;
    this.root.add(model);

    this.bone = {};
    for (const [k, name] of Object.entries(BONE_NAMES)) {
      this.bone[k] = findBone(model, name);
    }

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
    const scale = 1.82 / span;
    model.scale.setScalar(scale);
    model.position.y = -footY * scale;

    // 队服配色
    const bodyColor = new THREE.Color(accent);
    const jointColor = bodyColor.clone().multiplyScalar(0.58);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const next = mats.map((m) => {
        const c = m.clone();
        if (m.name && /joint/i.test(m.name)) {
          c.color.copy(jointColor);
          c.roughness = 0.72;
        } else {
          c.color.copy(bodyColor);
          c.roughness = 0.56;
          c.metalness = 0.04;
        }
        return c;
      });
      o.material = Array.isArray(o.material) ? next : next[0];
    });

    this.model = model;

    // 骨骼长度（绑定姿态，已缩放）
    this.root.updateMatrixWorld(true);
    const seg = (a, b, dflt) => (a && b)
      ? a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()))
      : dflt;

    // 两只手臂：随时可切换持拍手（左右手骨轴镜像：右手 -X，左手 +X）
    const mkArm = (aKey, fKey, hKey, side) => {
      const a = this.bone[aKey], f = this.bone[fKey], h = this.bone[hKey];
      const restQ = h ? h.quaternion.clone() : new THREE.Quaternion();
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
    this.racket.position.set(0, 0.02, 0);
    this.racket.rotation.z = Math.PI / 2;
    this.setHand('right');

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
    this.fwdV = new THREE.Vector3();
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

  /** 程序化羽毛球步法：并步/滑步 + 近球弓步，脚落地后不再滑动 */
  updateLegs(dt, rootQ, p, ball, near) {
    const fwd = this.fwdV.set(0, 0, 1).applyQuaternion(rootQ);
    const sideV = this.rightV.set(1, 0, 0).applyQuaternion(rootQ);
    this.legQInv.copy(rootQ).invert();

    const mvx = p.vx || 0;
    const mvz = p.vz || 0;
    const mSpeed = Math.hypot(mvx, mvz);
    const stepGain = clamp(mSpeed / 3.2, 0, 1);

    // 球在地面上的方向（身体坐标），用于弓步方向
    let ballLx = 0;
    let ballLz = 1;
    if (near > 0.01) {
      const bdx = ball.x - this.root.position.x;
      const bdz = ball.z - this.root.position.z;
      const bl = Math.hypot(bdx, bdz) || 1;
      this.footOffset.set(bdx / bl, 0, bdz / bl).applyQuaternion(this.legQInv);
      ballLx = this.footOffset.x;
      ballLz = this.footOffset.z;
    }
    const mLocal = this.footOffset.set(mvx, 0, mvz);
    if (mSpeed > 1e-3) mLocal.normalize().applyQuaternion(this.legQInv);
    const mlx = mSpeed > 1e-3 ? mLocal.x : 0;
    const mlz = mSpeed > 1e-3 ? mLocal.z : 0;

    const racketFoot = this.handKey === 'left' ? 'left' : 'right';
    // 落脚点前瞻：按当前速度预判，避免脚永远落在身体后面
    const leadX = this.root.position.x + mvx * 0.16;
    const leadZ = this.root.position.z + mvz * 0.16;

    // 启动步：球刚过到自己这边时的小跳蓄力
    const onMy = (p.z < 0) === (ball.z < 0) && Math.abs(ball.z) > 0.1;
    this.splitCool = Math.max(0, this.splitCool - dt);
    if (onMy && !this.prevOnMy && this.splitCool <= 0) {
      this.splitT = 0.16;
      this.splitCool = 0.8;
    }
    this.prevOnMy = onMy;
    this.splitT = Math.max(0, this.splitT - dt);
    const splitK = this.splitT > 0 ? Math.sin(Math.PI * (1 - this.splitT / 0.16)) : 0;

    // 交叉步：大范围横移时，非持拍脚从身后交叉过去
    const lateralFast = Math.abs(mlx) > 0.55 && Math.abs(mlx) > Math.abs(mlz) * 1.2;

    for (const key of ['right', 'left']) {
      const leg = this.legs[key];
      if (!leg.up || !leg.knee || !leg.foot) continue;
      const st = leg.st;
      const isRacket = key === racketFoot;

      // 站位：横向半距；持拍脚略前；移动时朝移动方向预判；近球时持拍脚跨出弓步
      let lx = leg.side * 0.20;
      let lz = isRacket ? 0.08 : -0.04;
      if (stepGain > 0.02) {
        lx += mlx * stepGain * 0.14;
        lz += mlz * stepGain * 0.14;
      }
      if (near > 0.01) {
        if (isRacket) {
          lx += clamp(ballLx, -1, 1) * near * 0.42;
          lz += clamp(ballLz, -1, 1) * near * 0.55;
        } else {
          lz -= near * 0.10;
        }
      }
      // 交叉步：非持拍脚从身后交叉过去，持拍脚只小幅跟进
      if (lateralFast) {
        if (isRacket) {
          lx += mlx * 0.10;
        } else {
          lx += mlx * 0.60;
          lz -= 0.18;
        }
      }
      // 启动步：小跳时站位略宽
      if (splitK > 0) lx += leg.side * 0.05 * splitK;

      const wx = leadX + sideV.x * lx + fwd.x * lz;
      const wz = leadZ + sideV.z * lx + fwd.z * lz;

      if (!st.init) {
        st.x = wx; st.z = wz; st.init = true;
      } else {
        const dd = Math.hypot(wx - st.x, wz - st.z);
        const thresh = near > 0.2 && isRacket ? 0.10 : 0.16;
        if (!st.on && dd > thresh) {
          st.on = true;
          st.t = 0;
          st.dur = clamp(0.24 - mSpeed * 0.035, 0.12, 0.24);
          st.fx = st.x; st.fz = st.z;
          st.tx = wx; st.tz = wz;
        }
        if (st.on) {
          st.t += dt;
          const k = clamp(st.t / st.dur, 0, 1);
          const e = k * k * (3 - 2 * k);
          st.x = st.fx + (st.tx - st.fx) * e;
          st.z = st.fz + (st.tz - st.fz) * e;
          st.lift = Math.sin(Math.PI * k) * clamp(0.055 + dd * 0.1, 0.06, 0.12);
          if (k >= 1) { st.on = false; st.lift = 0; st.x = st.tx; st.z = st.tz; }
        }
      }

      // 腿部 IK：髋 → 踝，膝盖朝前
      const hip = leg.up.getWorldPosition(this.hipW);
      this.ankleW.set(st.x, this.ankleY + st.lift + splitK * 0.05, st.z);
      // 够不到时贴着地面把脚拉近，避免脚悬空
      const maxR = leg.l1 + leg.l2 - 0.02;
      const dyA = this.ankleW.y - hip.y;
      const maxH = Math.sqrt(Math.max(0.02, maxR * maxR - dyA * dyA));
      const hxA = this.ankleW.x - hip.x;
      const hzA = this.ankleW.z - hip.z;
      const hdA = Math.hypot(hxA, hzA) || 1e-4;
      if (hdA > maxH) {
        this.ankleW.x = hip.x + hxA * (maxH / hdA);
        this.ankleW.z = hip.z + hzA * (maxH / hdA);
      }

      this.legPole.copy(fwd).addScaledVector(sideV, leg.side * 0.12).normalize();
      solveElbow(hip, this.ankleW, leg.l1, leg.l2, this.legPole, this.kneeW);
      aimBone(leg.up, leg.knee, this.kneeW.clone().sub(hip));
      leg.up.updateMatrixWorld(true);
      aimBone(leg.knee, leg.foot, this.ankleW.clone().sub(this.kneeW));
      leg.knee.updateMatrixWorld(true);
    }
  }

  update(dt, p, ball) {
    const isLeft = p.z < 0;
    const root = this.root;

    if (!this.inited) {
      this.sx = p.x; this.sz = p.z; this.inited = true;
    }
    this.sx += (p.x - this.sx) * (1 - Math.exp(-9 * dt));
    this.sz += (p.z - this.sz) * (1 - Math.exp(-12 * dt));
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
    this.mixer.update(dt);

    const sw = clamp(p.flash || 0, 0, 1);
    const wantJump = sw > 0.25 && ball.y > 2.05 ? clamp((ball.y - 2.05) * 0.12, 0, 0.26) : 0;
    this.jump += (wantJump - this.jump) * (1 - Math.exp(-10 * dt));

    const face = isLeft ? 1 : -1;
    const bx = face * (ball.x - root.position.x);
    const bz = face * (ball.z - root.position.z);
    const onMy = isLeft ? ball.z < 0 : ball.z > 0;
    const dist = Math.hypot(bx, bz);
    const near = onMy ? clamp(1 - dist / 3.0, 0, 1) : 0;

    // 近球降低重心，配合弓步
    const crouchWant = 0.02 + Math.pow(near, 1.4) * 0.30;
    this.crouch += (crouchWant - this.crouch) * (1 - Math.exp(-8 * dt));
    root.position.y = this.jump - this.crouch;

    root.updateMatrixWorld(true);
    const rootQ = this.rootQ;
    root.getWorldQuaternion(rootQ);

    // 持拍手由手机端设置决定
    const handKey = p.hand === 'left' ? 'left' : 'right';
    this.setHand(handKey);
    const arm = this.arms[handKey] || this.arms.right;

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
        clamp(bx * 0.10, -0.28, 0.28)
          + (aimSide * 0.30 + (p.dir || 0) * sw * 0.32) * arm.side,
        -0.55, 0.55
      );
      this.bone.spine1.quaternion.multiply(this.tmpQ.setFromAxisAngle(Y, -twist));
      this.bone.spine1.quaternion.multiply(this.tmpQ.setFromAxisAngle(X, -near * 0.09));
      this.bone.spine1.updateMatrixWorld(true);
    }
    if (this.bone.spine2) {
      this.bone.spine2.quaternion.multiply(this.tmpQ.setFromAxisAngle(Y, -clamp(bx * 0.05, -0.15, 0.15)));
      this.bone.spine2.updateMatrixWorld(true);
    }

    // 头部追球
    if (this.bone.head && this.bone.headEnd) {
      this.ballW.set(ball.x, ball.y, ball.z);
      const headPos = this.bone.head.getWorldPosition(this.tmpV);
      aimBone(this.bone.head, this.bone.headEnd, this.ballW.clone().sub(headPos));
    }

    // 步法 IK（并步/跨步/弓步）
    this.updateLegs(dt, rootQ, p, ball, near);

    // 持拍手 IK
    const rArm = arm.arm, rFore = arm.fore, rHand = arm.hand;
    if (rArm && rFore && rHand) {
      const shoulderW = rArm.getWorldPosition(this.shoulderW);

      // 准备位由手机机头方向驱动：机头向上 → 拍子向上，机头向左 → 大臂向左
      this.ready.copy(this.phoneAimW).multiplyScalar(READY_REACH).add(shoulderW);
      this.ballW.set(ball.x, ball.y, ball.z);
      const ballDist = this.ballW.distanceTo(shoulderW);
      if (onMy && ballDist < 3.2) {
        this.target.copy(this.ballW);
        this.target.lerp(this.ready, clamp((ballDist - 1.9) / 1.3, 0, 0.65));
      } else {
        this.target.copy(this.ready);
      }

      const dirW = this.tmpV.copy(this.target).sub(shoulderW);
      let tLen = dirW.length();
      if (tLen < 0.2) { dirW.copy(this.ready).sub(shoulderW); tLen = dirW.length(); }
      dirW.normalize();

      // 肩关节硬限位：只能在身体前半球 + 合理仰角内，手臂不能绕到身后
      this.bodyQInv.copy(rootQ).invert();
      this.dirBody.copy(dirW).applyQuaternion(this.bodyQInv);
      const yaw = Math.atan2(this.dirBody.x, this.dirBody.z);
      const el = Math.asin(clamp(this.dirBody.y, -1, 1));
      const yawC = clamp(yaw, -ARM_YAW_MAX, ARM_YAW_MAX);
      const elC = clamp(el, ARM_EL_MIN, ARM_EL_MAX);
      if (yawC !== yaw || elC !== el) {
        const ce = Math.cos(elC);
        this.dirBody.set(Math.sin(yawC) * ce, Math.sin(elC), Math.cos(yawC) * ce);
        dirW.copy(this.dirBody).applyQuaternion(rootQ).normalize();
      }

      const wristDist = clamp(tLen - 0.60, 0.18, arm.l1 + arm.l2 - 0.02);
      this.wristW.copy(shoulderW).addScaledVector(dirW, wristDist);

      this.pole.set(-0.75 * arm.side, -0.62, -0.2).applyQuaternion(rootQ);
      solveElbow(shoulderW, this.wristW, arm.l1, arm.l2, this.pole, this.elbowW);

      aimBone(rArm, rFore, this.elbowW.clone().sub(shoulderW));
      rArm.updateMatrixWorld(true);

      // 小臂和拍杆共线；小臂随拍面滚转（掌面/网面/小臂肌肉面同向）
      this.shaftDir.copy(this.wristW).sub(this.elbowW);
      if (this.shaftDir.lengthSq() < 0.02) this.shaftDir.copy(this.phoneAimW);
      basisQuatBoneAxis(arm.axis, this.shaftDir, this.normal, this.handQ);

      // 小臂世界姿态由拍子姿态反推：腕部保持静止关系，不会出现拧麻花
      const foreQ = this.tmpQ.copy(this.handQ).multiply(arm.restQInv);
      const parentQ = new THREE.Quaternion();
      rFore.parent.getWorldQuaternion(parentQ);
      rFore.quaternion.copy(parentQ.invert().multiply(foreQ));
      rFore.updateMatrixWorld(true);
      rHand.quaternion.copy(arm.restQ);
      rHand.updateMatrixWorld(true);
    }

    // 软影
    this.blob.position.set(root.position.x, 0.008, root.position.z);
    const bs = 1 - clamp(this.jump * 1.5, 0, 0.4);
    this.blob.scale.set(bs, bs, 1);
    this.blob.material.opacity = 0.6 * bs;

    this.racketFlash = Math.max(0, this.racketFlash - dt * 3.4);
    if (this.racket) this.racket.userData.frameMat.emissiveIntensity = this.racketFlash * 2.2;
  }
}
