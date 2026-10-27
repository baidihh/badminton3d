// 传感器与挥拍识别：姿态解算、滤波、挥拍窗口、球路分类
import * as THREE from 'three';
import { clamp, D2R, R2D, Q_IDENTITY, X_AXIS, MAX_TILT } from './util.js';
import { gate } from './gate.js';

let swingHandler = null;   // 由主流程注入：出球动作
let calReady = null;       // 由主流程注入：可以点「记录初始姿态」了

// ============================================================
// 传感器 / 姿态
// ============================================================
const SENS = {
  motionCount: 0, orientCount: 0,
  hasMotion: false, hasOrient: false,
  qRaw: new THREE.Quaternion(),
  qRef: new THREE.Quaternion(),
  qRel: new THREE.Quaternion(),
  qRefSet: false,
  prevQ: new THREE.Quaternion(),
  prevT: 0,
  lastOrientT: 0,
  // 原始陀螺仪（设备坐标系，deg/s）
  gyroReported: false,
  gyroAvailable: false,
  lastGyroT: 0,
  gx: 0, gy: 0, gz: 0,
  gyroBias: { x: 0, y: 0, z: 0 },
  gyroNoise: 0,
  gyroWarning: '',
  omegaOrient: 0,
  omega: 0, omegaYaw: 0, omegaPitch: 0, omegaRoll: 0, omegaPeak: 0,
  sweep: 0,
  swing: null,
  waitRelease: false,
  dropHold: false,
  acc: 0, accPeak: 0, accBase: 0,
  stillBufA: [], stillBufW: [], stillGyro: [],
  stillStart: 0, stillDone: false,
  calibrated: false,
  thresholdOmega: 260, thresholdAcc: 11,
  thresholdSource: 'orient',
  // 事件时间戳（用于更精确的 dt）
  orientEventT: 0, motionEventT: 0,
  tapMode: false,
  // 前半球瞄准（校准坐标系：+Z = 正前，+X = 右，+Y = 上）
  az: 0, el: 0,
  rawAz: 0,
  prevAim: new THREE.Vector3(0, 0, 1),
  qProj: new THREE.Quaternion(),
  qMirror: new THREE.Quaternion(),
  // 真实姿态：保留初始仰角，用于大屏手臂与姿态镜
  qReal: new THREE.Quaternion(),
  qBase: new THREE.Quaternion(),
  prevAzForSwing: 0,
  aimHist: [],
  // 滤波：方位角历史（出球方向取峰值窗口的中值）、角速度 3 点中值
  azHist: [],
  azF: 0,
  azFInit: false,
  omegaBuf: [],
  elBuf: [],
  elMed: 0,
};

const wrapPi = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

// 取中位数：抑制单帧毛刺，比均值稳
function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 3 点中值：去掉一个单帧尖峰，保留真实的持续峰值
function med3(a, b, c) {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

const tmpQQ = new THREE.Quaternion();
const tmpQInv = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const tmpGyro = new THREE.Vector3();
const realA = new THREE.Vector3();
const realB = new THREE.Vector3();
const zAxis = new THREE.Vector3(0, 0, 1);
const grav = { x: 0, y: 0, z: 0 };

// 用传感器事件自带的时间戳算 dt，比处理函数里的 performance.now() 更准
function sensorDt(e, key) {
  const raw = (e && typeof e.timeStamp === 'number' && isFinite(e.timeStamp) && e.timeStamp > 0)
    ? e.timeStamp
    : performance.now();
  const prev = SENS[key];
  SENS[key] = raw;
  if (!prev) return 0;
  const delta = raw - prev;
  if (delta <= 0 || delta > 2000) return 0;   // 时间基跳变或长时间断流，跳过这一帧
  return clamp(delta / 1000, 0.004, 0.08);
}
let accPrev = null;
// 节流状态在 gate.js：传感器判定与出球共用
let invert = Number(localStorage.getItem('bm3_invert') || 1);
function onOrientation(e) {
  if (e.alpha === null && e.beta === null && e.gamma === null) return;
  SENS.orientCount++;
  SENS.hasOrient = true;

  const alpha = (e.alpha || 0) * D2R;
  const beta = (e.beta || 0) * D2R;
  const gamma = (e.gamma || 0) * D2R;

  // deviceorientation → 四元数（three.js 约定）
  tmpEuler.set(beta, alpha, -gamma, 'YXZ');
  SENS.qRaw.setFromEuler(tmpEuler);
  SENS.qRaw.multiply(tmpQQ.setFromAxisAngle(zAxis, -screenAngle() * D2R));

  const now = performance.now();
  SENS.lastOrientT = now;
  const dtOrient = sensorDt(e, 'orientEventT');

  // 姿态差分角速度：作为陀螺仪不可用时的兜底
  if (SENS.prevT) {
    const dt = dtOrient > 0 ? dtOrient : clamp((now - SENS.prevT) / 1000, 0.006, 0.12);
    const dq = tmpQQ.copy(SENS.qRaw).multiply(tmpQInv.copy(SENS.prevQ).invert());
    const wAbs = Math.abs(dq.w);
    const ang = 2 * Math.acos(clamp(wAbs, 0, 1));
    const sign = dq.w < 0 ? -1 : 1;
    const omegaDeg = (ang / dt) * R2D;
    let yawDeg = 0;
    if (ang > 1e-6) {
      tmpVec.set(dq.x, dq.y, dq.z).normalize();
      yawDeg = tmpVec.y * omegaDeg * sign;
    }
    SENS.omegaOrient = omegaDeg;

    // 静止采样（兜底阈值用）
    if (!SENS.stillDone && SENS.stillStart) {
      SENS.stillBufW.push(omegaDeg);
      if (SENS.stillBufW.length > 240) SENS.stillBufW.shift();
    }

    // 陀螺仪新鲜时由 onMotion 负责判定，避免双触发
    const gyroFresh = SENS.gyroAvailable &&
      SENS.lastGyroT && (now - SENS.lastGyroT < 250);
    if (!gyroFresh) {
      SENS.omega = omegaDeg;
      SENS.omegaYaw = yawDeg;
      updateSwing(now, dt, omegaDeg);
    }
  }

  SENS.prevQ.copy(SENS.qRaw);
  SENS.prevT = now;

  if (!SENS.qRefSet) {
    SENS.qRef.copy(SENS.qRaw);
    SENS.qRefSet = true;
  }
  // 相对校准姿态
  SENS.qRel.copy(SENS.qRef).invert().multiply(SENS.qRaw);

  // 瞄准轴 v：设备 +Y（机头）在"校准坐标系"里的方向
  tmpVec.set(0, 1, 0).applyQuaternion(SENS.qRel);
  // 换到控制坐标系：把校准时的"机头朝上"定义成正前方 +Z
  tmpVec2.copy(tmpVec).applyAxisAngle(X_AXIS, Math.PI / 2);

  const rawLen = tmpVec2.length() || 1;
  SENS.rawAz = Math.atan2(tmpVec2.x / rawLen, tmpVec2.z / rawLen);

  // 前半球投影：越过 180° 的部分压到最大圆平面 z=0 上
  if (tmpVec2.z < 0) {
    tmpVec2.z = 0;
    if (tmpVec2.x * tmpVec2.x + tmpVec2.y * tmpVec2.y < 1e-4) {
      tmpVec2.copy(SENS.prevAim);   // 机头正对身后：沿用上一帧，避免退化
    }
  }
  tmpVec2.normalize();
  SENS.prevAim.copy(tmpVec2);

  SENS.az = Math.atan2(tmpVec2.x, tmpVec2.z);
  SENS.el = Math.asin(clamp(tmpVec2.y, -1, 1));

  // 方位角历史：出球方向取"峰值前后 ±60ms 的中值"，比单帧值稳得多
  const azHist = SENS.azHist;
  azHist.push({ t: now, az: SENS.az });
  while (azHist.length && now - azHist[0].t > 320) azHist.shift();

  // 显示用自适应低通：挥得越快滤波越弱（不牺牲跟手），静止时压抖动
  if (!SENS.azFInit) {
    SENS.azF = SENS.az;
    SENS.azFInit = true;
  } else {
    const k = clamp(SENS.omega / 420, 0, 1);
    SENS.azF += (SENS.az - SENS.azF) * (0.30 + 0.65 * k);
  }

  // 仰角 3 点中值：单帧跳变不会把高远球误判成杀球
  const eb = SENS.elBuf;
  eb.push(SENS.el);
  if (eb.length > 3) eb.shift();
  SENS.elMed = eb.length >= 3 ? med3(eb[0], eb[1], eb[2]) : SENS.el;

  // 把投影结果还原成姿态：瞄准/挥拍判定仍用这套控制坐标系
  tmpVec.normalize();
  tmpVec2.applyAxisAngle(X_AXIS, -Math.PI / 2).normalize();
  SENS.qProj.setFromUnitVectors(tmpVec, tmpVec2).multiply(SENS.qRel);

  // 真实姿态（给大屏球拍）：保留校准时的真实仰角
  SENS.qReal.copy(SENS.qBase).multiply(SENS.qRel);
  const aimNow = realA.set(0, 1, 0).applyQuaternion(SENS.qReal);
  if (aimNow.z < 0) {
    const aimClipped = realB.copy(aimNow);
    aimClipped.z = 0;
    if (aimClipped.lengthSq() < 1e-4) aimClipped.set(0, aimNow.y >= 0 ? 1 : -1, 0);
    aimClipped.normalize();
    SENS.qReal.premultiply(tmpQQ.setFromUnitVectors(aimNow, aimClipped));
  }

  // 姿态镜（给手机屏幕）：以"初始握持"为竖直基准的相对姿态，只在前半球内显示
  const dev = 2 * Math.acos(clamp(Math.abs(SENS.qProj.w), 0, 1));
  if (dev > MAX_TILT) {
    SENS.qMirror.copy(Q_IDENTITY).slerp(SENS.qProj, MAX_TILT / dev);
  } else {
    SENS.qMirror.copy(SENS.qProj);
  }

  // 雷达轨迹（最近 0.35 秒）
  const hist = SENS.aimHist;
  hist.push({ az: SENS.azF, el: SENS.el, t: now });
  while (hist.length && now - hist[0].t > 350) hist.shift();
  if (hist.length > 40) hist.shift();

  if (!SENS.calibrated && SENS.stillDone) {
    if (calReady) calReady();
  }
}

function onMotion(e) {
  SENS.motionCount++;
  SENS.hasMotion = true;

  const now = performance.now();
  const dtMotion = sensorDt(e, 'motionEventT');

  const ag = e.accelerationIncludingGravity;
  if (ag && ag.x !== null && ag.x !== undefined) {
    const k = 0.14;
    grav.x += (ag.x - grav.x) * k;
    grav.y += (ag.y - grav.y) * k;
    grav.z += (ag.z - grav.z) * k;
  }

  let mag = 0;
  if (e.acceleration && e.acceleration.x !== null && e.acceleration.x !== undefined) {
    mag = Math.hypot(e.acceleration.x || 0, e.acceleration.y || 0, e.acceleration.z || 0);
  } else if (ag && ag.x !== null && ag.x !== undefined) {
    mag = Math.hypot((ag.x || 0) - grav.x, (ag.y || 0) - grav.y, (ag.z || 0) - grav.z);
  }
  SENS.acc = mag;

  if (!SENS.stillDone && SENS.stillStart) {
    SENS.stillBufA.push(mag);
    if (SENS.stillBufA.length > 240) SENS.stillBufA.shift();
  }

  // ---------- 原始陀螺仪 ----------
  // rotationRate: alpha 绕 z，beta 绕 x，gamma 绕 y（单位 deg/s）
  const rr = e.rotationRate;
  const hasGyro = !!(rr
    && Number.isFinite(rr.alpha)
    && Number.isFinite(rr.beta)
    && Number.isFinite(rr.gamma));

  if (hasGyro) {
    SENS.gyroReported = true;
    SENS.gx = rr.beta || 0;
    SENS.gy = rr.gamma || 0;
    SENS.gz = rr.alpha || 0;
    SENS.lastGyroT = now;

    // 静止采样：原始三轴，用于算零偏和噪声
    if (!SENS.stillDone && SENS.stillStart) {
      SENS.stillGyro.push([SENS.gx, SENS.gy, SENS.gz]);
      if (SENS.stillGyro.length > 320) SENS.stillGyro.shift();
    }
  }

  const orientFresh = !!(SENS.hasOrient && SENS.lastOrientT &&
    (now - SENS.lastOrientT < 500));

  // 陀螺仪 + 方向都可用 → 世界坐标角速度，交给挥拍判定
  if (hasGyro && SENS.gyroAvailable && orientFresh && dtMotion > 0) {
    const bx = SENS.gx - SENS.gyroBias.x;
    const by = SENS.gy - SENS.gyroBias.y;
    const bz = SENS.gz - SENS.gyroBias.z;
    tmpGyro.set(bx, by, bz).applyQuaternion(SENS.qRaw);
    const omega = tmpGyro.length();
    SENS.omega = omega;
    SENS.omegaYaw = tmpGyro.y;
    SENS.omegaPitch = tmpGyro.x;
    SENS.omegaRoll = tmpGyro.z;
    updateSwing(now, dtMotion, omega);
    return;
  }

  // 方向传感器不可用 / 过期 → 加速度兜底
  if (!orientFresh) {
    let yaw = 0;
    if (hasGyro) {
      const len = Math.hypot(grav.x, grav.y, grav.z) || 1;
      const ux = grav.x / len, uy = grav.y / len, uz = grav.z / len;
      yaw = (SENS.gx * ux + SENS.gy * uy + SENS.gz * uz) * invert;
    }
    updateSwingAcc(now, mag, yaw, dtMotion || 0.016);
  }
}

// 基于方位角（前半球）的挥拍窗口
function updateSwing(now, dt, omegaDeg) {
  if (!SENS.calibrated) return;
  const dAz = wrapPi(SENS.az - SENS.prevAzForSwing);
  SENS.prevAzForSwing = SENS.az;

  // 3 点中值：去掉单帧尖峰，避免误触发；真实挥拍峰值持续多帧，不会被削掉
  const ob = SENS.omegaBuf;
  ob.push(omegaDeg);
  if (ob.length > 3) ob.shift();
  const om = ob.length >= 3 ? med3(ob[0], ob[1], ob[2]) : omegaDeg;

  if (SENS.swing) {
    SENS.swing.sweep += dAz;
    SENS.swing.dropHold = SENS.swing.dropHold || SENS.dropHold;
    SENS.swing.elMin = Math.min(SENS.swing.elMin, SENS.elMed);
    SENS.swing.elMax = Math.max(SENS.swing.elMax, SENS.elMed);
    if (Math.abs(SENS.swing.sweep) > Math.abs(SENS.swing.peakSweep)) {
      SENS.swing.peakSweep = SENS.swing.sweep;
    }
    if (om > SENS.swing.peak) {
      SENS.swing.peak = om;
      SENS.swing.elAtPeak = SENS.elMed;
      // 记录峰值瞬间的方位角与时刻：此时球拍正对出球方向（收拍后的方位会偏）
      SENS.swing.azAtPeak = SENS.az;
      SENS.swing.peakAt = now;
    }
    if (om < SENS.thresholdOmega * 0.6 || now - SENS.swing.start > 300) {
      endSwing(now);
    }
  } else if (SENS.waitRelease) {
    // 等角速度回落到一半以下再允许下一次挥拍，避免持续转动被重复计数
    if (om < SENS.thresholdOmega * 0.5) SENS.waitRelease = false;
  } else if (om > SENS.thresholdOmega && now > gate.cooldownUntil && Math.abs(SENS.rawAz) < 1.55) {
    // 起拍门槛用"未投影"的方位：身后蓄力不触发
    SENS.swing = {
      start: now, peak: om, sweep: 0, peakSweep: 0,
      elStart: SENS.elMed, elAtPeak: SENS.elMed, elMin: SENS.elMed, elMax: SENS.elMed,
      azAtPeak: SENS.az, peakAt: now,
      dropHold: SENS.dropHold,
    };
    SENS.omegaPeak = om;
  }
}

// 球路分类：吊球靠按住修饰；杀球 = 把拍头举高后发力；明显向上挥 = 高远
function classifyShot(sw) {
  if (sw.dropHold) return 'drop';
  const peak = sw.peak || 0;
  const t = SENS.thresholdOmega;
  const fast = peak > Math.max(300, t * 1.35);
  const rise = sw.elMax - sw.elStart;
  // 实测：手机端的杀球是把拍头举到明显高于水平再发力，仰角峰值普遍 28° 以上
  // 临界带（16°–22°）要求更快，避免"高举但挥得慢"被误判成杀球
  if (sw.elMax > 0.38 && peak > Math.max(380, t * 1.2)) return 'smash';
  if (sw.elMax > 0.28 && peak > Math.max(480, t * 1.5)) return 'smash';
  if (rise > 0.15) return 'clear';
  if (sw.elStart > 0.12 && sw.elMin - sw.elStart < -0.16 && fast) return 'smash';
  return 'clear';
}

// 峰值前后 ±60ms 的方位角中值：单帧抖动不会改变出球方向
function robustAz(tPeak, fallback) {
  const hist = SENS.azHist;
  const vals = [];
  const w = 60;
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i];
    if (h.t < tPeak - w) break;
    if (h.t <= tPeak + w) vals.push(h.az);
  }
  if (vals.length >= 3) return median(vals);
  return Number.isFinite(fallback) ? fallback : SENS.az;
}

function endSwing(now) {
  const sw = SENS.swing;
  SENS.swing = null;
  if (!sw) return;
  SENS.waitRelease = true;
  const t = SENS.thresholdOmega;
  const power = clamp((sw.peak - t * 0.75) / (1150 - t * 0.75), 0.12, 1);
  // 用挥拍过程中的最大单向扫角，避免收拍/回落把左右抵消掉
  let dir = (sw.peakSweep * R2D) / 80 * invert;
  if (Math.abs(dir) < 0.15) dir = 0;
  dir = clamp(dir, -1, 1);
  // 抬拍角决定弧线高度：取本次挥拍的最高点
  const lift = clamp((sw.elMax + 0.45) / 1.1, 0, 1);
  // 出球方向：峰值窗口的中值，抗单帧抖动
  const azPeak = robustAz(sw.peakAt, sw.azAtPeak);
  if (swingHandler) swingHandler(power, dir, sw.peak, lift, sw.start, classifyShot(sw), {
    elStart: sw.elStart, elMax: sw.elMax, elMin: sw.elMin,
    elAtPeak: sw.elAtPeak, azAtPeak: azPeak, azRaw: sw.azAtPeak,
    peakAt: sw.peakAt, sweep: sw.peakSweep * R2D,
  });
}

// 加速度兜底
function updateSwingAcc(now, mag, yawDeg, dt) {
  if (!SENS.calibrated) return;
  if (SENS.swing) {
    SENS.swing.peak = Math.max(SENS.swing.peak, mag);
    SENS.swing.sweep += yawDeg * dt;
    SENS.swing.dropHold = SENS.swing.dropHold || SENS.dropHold;
    if (Math.abs(SENS.swing.sweep) > Math.abs(SENS.swing.peakSweep)) {
      SENS.swing.peakSweep = SENS.swing.sweep;
    }
    if (mag < SENS.thresholdAcc * 0.6 || now - SENS.swing.start > 300) {
      const sw = SENS.swing;
      SENS.swing = null;
      SENS.waitRelease = true;
      const power = clamp((sw.peak - SENS.thresholdAcc) / 28, 0.12, 1);
      let dir = sw.peakSweep / 140;
      if (Math.abs(dir) < 0.15) dir = 0;
      dir = clamp(dir, -1, 1);
      if (swingHandler) swingHandler(power, dir, sw.peak, 0.45, sw.start, sw.dropHold ? 'drop' : 'clear');
    }
  } else if (SENS.waitRelease) {
    if (mag < SENS.thresholdAcc * 0.5) SENS.waitRelease = false;
  } else if (mag > SENS.thresholdAcc && now > gate.cooldownUntil) {
    SENS.swing = {
      start: now, peak: mag, sweep: 0, peakSweep: 0,
      elStart: 0, elAtPeak: 0, azAtPeak: SENS.az, peakAt: now, dropHold: SENS.dropHold,
    };
  }
}
function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  return (typeof window.orientation === 'number') ? window.orientation : 0;
}

export { SENS, onOrientation, onMotion };
export function getInvert() { return invert; }
export function setInvert(v) { invert = v; }
export function setSwingHandler(fn) { swingHandler = fn; }
export function setCalReadyHandler(fn) { calReady = fn; }