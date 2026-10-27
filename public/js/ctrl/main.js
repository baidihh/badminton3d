// 手机手柄主流程：按键、校准、试挥、联机、渲染循环
import * as THREE from 'three';
import { clamp, D2R, R2D, X_AXIS } from './util.js';
import { SENS, onOrientation, onMotion, getInvert, setInvert, setSwingHandler, setCalReadyHandler } from './sens.js';
import { mountMirror, renderMirror } from './mirror.js';
import { drawAim, sizeAimCanvas } from './radar.js';
import { ensureAudio, whoosh } from './audio.js';
import { gate } from './gate.js';

const $ = (id) => document.getElementById(id);

const SHOT_NAME = { clear: '高远球', drop: '吊球', smash: '杀球' };
const SHOT_CSS = { clear: '#BFE9FF', drop: '#7CFFB2', smash: '#FF9A7A' };
const SHOT_HINT = {
  clear: '从低到高向上挥，送到后场',
  drop: '按住「吊球」再轻挥',
  smash: '先把拍头举高，再向下压',
};
let myHand = localStorage.getItem('bm3_hand') === 'left' ? 'left' : 'right';
// 网络往返延迟（毫秒），用于时间戳回溯的单程延迟估计
let rttMs = 0;
let pingAt = 0;

// 入场参数：持拍手 + 屏幕信息（服务端数据采集用）
function joinPayload(extra = {}) {
  return {
    hand: myHand,
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 },
    ...extra,
  };
}

// ============================================================
// 挥拍反馈
// ============================================================
const socket = io({ transports: ['websocket', 'polling'] });
let mySlot = null;

// ============================================================
// 标注模式：?label=1 打开，按提示挥拍，逐拍记录"要求球路 vs 实际判定"
// ============================================================
const LABEL_MODE = new URLSearchParams(location.search).has('label');
const LABEL_HINT = {
  clear: '向上挥，把球送到后场',
  drop: '按住「吊球」再轻挥',
  smash: '先把拍头举高，再向下压',
};
const label = { on: false, seq: [], idx: 0, results: [], done: false };
const LABEL_ROUNDS = 4;

function startLabeling() {
  label.seq = [];
  for (let r = 0; r < LABEL_ROUNDS; r++) {
    label.seq.push(...['clear', 'drop', 'smash'].sort(() => Math.random() - 0.5));
  }
  label.idx = 0;
  label.results = [];
  label.done = false;
  label.on = true;
  // 标注时以提示为主，收起姿态镜腾出位置
  $('mirrorHome').classList.add('hidden');
  $('labelPanel').classList.remove('hidden');
  $('lpDone').classList.add('hidden');
  $('lpPips').innerHTML = label.seq.map(() => '<i></i>').join('');
  // 标注期间保持一局在打，避免结束后球停在"比赛结束"
  if (socket.connected) socket.emit('game:restart');
  renderLabel();
}

function renderLabel() {
  const req = label.seq[label.idx];
  if (!req) return;
  $('lpStep').textContent = `${label.idx + 1}/${label.seq.length}`;
  $('lpTarget').textContent = '请打：' + SHOT_NAME[req];
  $('lpTarget').style.color = SHOT_CSS[req] || '#FFE2AC';
  $('lpHint').textContent = LABEL_HINT[req] || '';
}

function recordLabel(detected) {
  if (!label.on || label.done) return;
  const req = label.seq[label.idx];
  if (!req) return;
  const ok = detected === req;
  label.results.push({ req, detected, ok });
  const pip = $('lpPips').children[label.idx];
  if (pip) pip.className = ok ? 'ok' : 'no';
  label.idx++;
  if (label.idx >= label.seq.length) {
    label.done = true;
    const okCount = label.results.filter((r) => r.ok).length;
    $('lpStep').textContent = `${label.seq.length}/${label.seq.length}`;
    $('lpTarget').textContent = '标注完成';
    $('lpTarget').style.color = '#A8F5C9';
    $('lpHint').textContent = `共 ${label.seq.length} 拍 · 判定一致 ${okCount} 拍`;
    $('lpDone').textContent = '已写入 data/sessions，含 requested 标签';
    $('lpDone').classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    return;
  }
  renderLabel();
}

function fire(power, dir, peak, lift = 0.45, swingStart, shot = 'clear', feat = null) {
  const now = performance.now();
  if (now - gate.lastSwingAt < 220) return;
  gate.lastSwingAt = now;
  gate.cooldownUntil = now + 240;

  // 标注模式：这一拍要求的球路（判对判错都记录）
  const reqShot = (label.on && !label.done) ? label.seq[label.idx] : null;

  // 出球方向用"角速度峰值那一刻"的方位角（此时拍面正对出球方向），
  // 收拍后的方位会明显偏，不能代表意图
  const azOut = Number.isFinite(feat?.azAtPeak) ? feat.azAtPeak : (SENS.az || 0);
  const dirShow = Math.abs(azOut) > 0.10 ? Math.sign(azOut) : 0;
  // 从挥拍峰值到发出这一包的时间差：服务端据此把球回退到挥拍那一刻
  const ageMs = feat?.peakAt ? Math.max(0, Math.min(300, now - feat.peakAt)) : 0;

  $('peak').textContent = '力度 ' + Math.round(power * 100) + '%';
  $('dirtxt').textContent = dirShow === 0 ? '打中路' : (dirShow > 0 ? '打右前' : '打左前');
  $('fill').style.width = Math.round(power * 100) + '%';
  const last = $('lastShot');
  if (last) {
    last.textContent = SHOT_NAME[shot] || '—';
    last.style.color = SHOT_CSS[shot] || '';
  }
  if (navigator.vibrate) navigator.vibrate(Math.round(10 + power * 26));
  whoosh(power, shot);

  if (state.step === 'trial') practiceSwing(swingStart || now, shot);
  if (state.step === 'play' && mySlot && socket.connected) {
    // 出球方向用"角速度峰值那一刻"的方位角（此时拍面正对出球方向），
    // 收拍后的方位会明显偏，不能代表意图
    const azOut = Number.isFinite(feat?.azAtPeak) ? feat.azAtPeak : SENS.az;
    socket.emit('ctrl:swing', {
      power, dir, peak, lift, shot,
      az: (azOut || 0) * getInvert(),
      azRaw: ((Number.isFinite(feat?.azRaw) ? feat.azRaw : azOut) || 0) * getInvert(),
      el: SENS.el, om: SENS.omega,
      dropHold: SENS.dropHold, hand: myHand,
      requested: reqShot,
      ageMs, rttMs,
      elStart: feat?.elStart ?? null,
      elMax: feat?.elMax ?? null,
      elMin: feat?.elMin ?? null,
      elAtPeak: feat?.elAtPeak ?? null,
      sweepDeg: feat?.sweep ?? null,
    });
  }
  if (reqShot && state.step === 'play') recordLabel(shot);
}
// ============================================================
// 教学流程
// ============================================================
const state = { step: 'intro' };

function showOnly(which) {
  for (const id of ['obIntro', 'obCalib', 'obTrial']) {
    $(id).classList.toggle('hidden', id !== which);
  }
}

$('obEnable').onclick = async () => {
  ensureAudio();
  const st = $('obStatus');
  st.className = 'status';
  st.textContent = '正在请求传感器权限…';
  $('obEnable').disabled = true;
  try {
    if (typeof DeviceMotionEvent === 'undefined' && typeof DeviceOrientationEvent === 'undefined') {
      st.textContent = '此浏览器不支持运动传感器。';
      st.classList.add('err');
      $('obTap').classList.remove('hidden');
      return;
    }

    // 方向与运动权限都在同一次点击里发起，iOS 才会给出授权
    const jobs = [];
    let orientAllowed = typeof DeviceOrientationEvent !== 'undefined';
    let motionAllowed = typeof DeviceMotionEvent !== 'undefined';
    if (orientAllowed && typeof DeviceOrientationEvent.requestPermission === 'function') {
      jobs.push(DeviceOrientationEvent.requestPermission()
        .then((r) => { orientAllowed = r === 'granted'; })
        .catch(() => { orientAllowed = false; }));
    }
    if (motionAllowed && typeof DeviceMotionEvent.requestPermission === 'function') {
      jobs.push(DeviceMotionEvent.requestPermission()
        .then((r) => { motionAllowed = r === 'granted'; })
        .catch(() => { motionAllowed = false; }));
    }
    await Promise.all(jobs);

    if (!orientAllowed && !motionAllowed) {
      st.textContent = '权限被拒绝。设置 → Safari → 动作与方向，然后重新打开。';
      st.classList.add('err');
      $('obEnable').disabled = false;
      return;
    }
    if (orientAllowed) addEventListener('deviceorientation', onOrientation);
    if (motionAllowed) addEventListener('devicemotion', onMotion);
    try { if ('wakeLock' in navigator) await navigator.wakeLock.request('screen'); } catch { }

    st.textContent = '正在等待传感器数据…';
    setTimeout(() => {
      if (SENS.orientCount > 0) {
        st.className = 'status ok';
        st.textContent = '传感器已就绪';
        setTimeout(() => beginCalibration(), 500);
        return;
      }
      if (SENS.motionCount > 0) {
        st.className = 'status';
        st.textContent = '方向传感器不可用，只能识别挥动幅度。';
        $('calBtn').disabled = false;
        setTimeout(() => beginCalibration(), 500);
        return;
      }
      st.className = 'status err';
      st.textContent = '未收到传感器数据。请确认用 HTTPS 打开，且系统未关闭动作权限。';
      $('obEnable').disabled = false;
      $('obTap').classList.remove('hidden');
    }, 1600);
  } catch (err) {
    st.className = 'status err';
    st.textContent = '授权失败：' + (err && err.message ? err.message : err);
    $('obEnable').disabled = false;
  }
};

$('obTap').onclick = () => {
  SENS.tapMode = true;
  SENS.calibrated = true;
  startPlay();
};

function updateSensorLabel() {
  const el = $('sensorTxt');
  if (!el) return;
  if (SENS.tapMode) el.textContent = '触屏模式';
  else if (SENS.gyroAvailable && SENS.hasOrient) el.textContent = '体感已开启 · 陀螺仪';
  else if (SENS.hasOrient) el.textContent = '体感已开启 · 融合姿态';
  else el.textContent = '体感已开启（仅挥动）';
}

function beginCalibration() {
  state.step = 'calib';
  showOnly('obCalib');
  mountMirror($('obMirrorSlot'), true);
  $('mirrorBadge').textContent = SENS.hasOrient ? '转动手机试试' : '无方向数据';
  $('mirrorBadge').classList.remove('ok');
  startStillCalibration();
  updateSensorLabel();
}

function startStillCalibration() {
  SENS.stillDone = false;
  SENS.stillStart = performance.now();
  SENS.stillBufA.length = 0;
  SENS.stillBufW.length = 0;
  SENS.stillGyro.length = 0;
  SENS.gyroBias = { x: 0, y: 0, z: 0 };
  SENS.gyroNoise = 0;
  SENS.gyroAvailable = false;
  SENS.gyroWarning = '';
  SENS.waitRelease = false;
  SENS.orientEventT = 0;
  SENS.motionEventT = 0;
  SENS.swing = null;
  $('calStill').classList.remove('done');
  $('stillFill').style.width = '0%';
  $('stillTxt').textContent = '握稳手机，正在采集…';
  $('calBtn').disabled = true;
  $('calStatus').textContent = '';

  let lastCount = -1;
  const timer = setInterval(() => {
    const t = (performance.now() - SENS.stillStart) / 2000;
    const pct = clamp(t, 0, 1);
    $('stillFill').style.width = (pct * 100).toFixed(0) + '%';
    const count = SENS.motionCount + SENS.orientCount;
    if (count === lastCount && pct > 0.4 && pct < 1) {
      $('stillTxt').textContent = '没有收到数据…请检查传感器权限';
    } else if (pct < 1) {
      $('stillTxt').textContent = '握稳手机，正在采集…';
    }
    lastCount = count;
    if (pct >= 1) {
      clearInterval(timer);
      finishStillCalibration();
    }
  }, 120);
}

function finishStillCalibration() {
  const a = SENS.stillBufA.slice();
  const w = SENS.stillBufW.slice();
  const mean = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const std = (arr, m) => arr.length
    ? Math.sqrt(arr.reduce((s, v) => s + (v - m) * (v - m), 0) / arr.length) : 0;
  const median = (arr) => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((x, y) => x - y);
    return s[s.length >> 1];
  };

  const ma = mean(a), sa = std(a, ma);
  const mw = mean(w), sw = std(w, mw);
  SENS.accBase = ma;
  SENS.thresholdAcc = clamp(ma + Math.max(6, sa * 4.5), 7, 22);

  // 陀螺仪零偏：用中位数，短暂晃动不会把零偏带偏
  const g = SENS.stillGyro;
  let gyroOk = false;
  let grms = 0;
  let rawMax = 0;
  if (g.length >= 12) {
    const bx = median(g.map((s) => s[0]));
    const by = median(g.map((s) => s[1]));
    const bz = median(g.map((s) => s[2]));
    let ss = 0;
    for (const s of g) {
      const dx = s[0] - bx;
      const dy = s[1] - by;
      const dz = s[2] - bz;
      ss += dx * dx + dy * dy + dz * dz;
      rawMax = Math.max(rawMax, Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]));
    }
    grms = Math.sqrt(ss / (g.length * 3));
    const biasMag = Math.hypot(bx, by, bz);
    if (biasMag > 45) {
      // 静止校准里出现持续大角速度：不是零偏，是用户在校准中转动
      SENS.gyroBias = { x: 0, y: 0, z: 0 };
      SENS.gyroWarning = '校准中检测到持续转动，改用融合姿态';
      gyroOk = false;
    } else {
      SENS.gyroBias = {
        x: clamp(bx, -20, 20),
        y: clamp(by, -20, 20),
        z: clamp(bz, -20, 20),
      };
      gyroOk = SENS.gyroReported && rawMax > 0.01;
    }
    SENS.gyroNoise = grms;
  } else if (SENS.gyroReported) {
    // 采样不足但设备确实上报了陀螺：用默认零偏，至少保留高频挥拍判定
    SENS.gyroBias = { x: 0, y: 0, z: 0 };
    SENS.gyroNoise = 0;
    gyroOk = true;
  }
  SENS.gyroAvailable = !!(gyroOk && SENS.hasOrient);

  if (SENS.gyroAvailable) {
    SENS.thresholdSource = 'gyro';
    SENS.thresholdOmega = g.length >= 12
      ? clamp(200 + grms * 6, 220, 380)
      : 260;
  } else if (SENS.hasOrient) {
    SENS.thresholdSource = 'orient';
    SENS.thresholdOmega = clamp(mw + Math.max(170, sw * 5), 200, 460);
  } else {
    SENS.thresholdSource = 'accel';
    SENS.thresholdOmega = 260;
  }
  SENS.stillDone = true;

  $('calStill').classList.add('done');
  $('stillTxt').textContent = SENS.gyroAvailable
    ? '完成 · 陀螺噪声 ' + grms.toFixed(1) + '°/s' + (grms > 25 ? '（偏大）' : '')
    : (SENS.gyroWarning
      ? '完成 · ' + SENS.gyroWarning
      : '完成 · 噪声 ' + ma.toFixed(1) + ' m/s² · ' + mw.toFixed(0) + '°/s');
  $('stillFill').style.width = '100%';
  $('calBtn').disabled = SENS.orientCount === 0;
  $('calStatus').className = 'status ok';
  $('calStatus').textContent = SENS.hasOrient
    ? '把手机举到胸前，像举拍一样，然后点「握好了」。'
    : '没有方向数据，只能识别挥动幅度，手屏同步不可用。';
  if (!SENS.hasOrient) {
    $('calBtn').disabled = false;
  }
  updateSensorLabel();
}

// 举拍就位：记录基准姿态（开局与「重置姿态」共用）
function captureReference() {
  SENS.qRef.copy(SENS.qRaw);
  SENS.qRefSet = true;
  // 用校准时的真实仰角作为拍位基准：手机机头指哪，拍子初始就指哪
  const aim0 = new THREE.Vector3(0, 1, 0).applyQuaternion(SENS.qRaw);
  const el0 = Math.asin(clamp(aim0.y, -1, 1));
  SENS.qBase.setFromAxisAngle(X_AXIS, Math.PI / 2 - el0);
  SENS.qReal.copy(SENS.qBase);
  SENS.qRel.identity();
  SENS.qProj.identity();
  SENS.prevAim.set(0, 0, 1);
  SENS.rawAz = 0;
  SENS.prevAzForSwing = SENS.az;
  SENS.swing = null;
  SENS.orientEventT = 0;
  SENS.motionEventT = 0;
  SENS.lastGyroT = 0;
  SENS.omega = 0;
  SENS.waitRelease = false;
  SENS.prevQ.copy(SENS.qRaw);
  SENS.prevT = performance.now();
  SENS.qMirror.identity();
}

$('calBtn').onclick = () => {
  captureReference();
  SENS.calibrated = true;
  $('calPose').classList.add('done');
  $('calStatus').className = 'status ok';
  $('calStatus').textContent = '初始姿态已记录。现在转动手机，球拍与 3D 手机都会实时跟着走。';
  $('mirrorBadge').textContent = '已校准 · 手屏同步';
  $('mirrorBadge').classList.add('ok');
  if (navigator.vibrate) navigator.vibrate([18, 40, 22]);
  startPoseSender();
  setTimeout(() => beginTrial(), 900);
};

function resetPoseNow() {
  if (!SENS.hasOrient || !SENS.calibrated) {
    $('sensorTxt').textContent = '先完成初始姿态校准';
    return;
  }
  captureReference();
  $('mirrorBadge').textContent = '姿态已重置 · 手屏同步';
  $('mirrorBadge').classList.add('ok');
  if (navigator.vibrate) navigator.vibrate([12, 30, 14]);
  $('sensorTxt').textContent = '姿态已重置，以当前手机方向为基准';
}

// 重置键：点一下立即生效，游戏中出问题可以马上修正
const poseBtn = $('resetPose');
poseBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  poseBtn.classList.add('holding');
  setTimeout(() => poseBtn.classList.remove('holding'), 160);
  resetPoseNow();
});
poseBtn.addEventListener('contextmenu', (e) => e.preventDefault());

$('calRetry').onclick = () => location.reload();

// ---------------- 试挥练习 ----------------
const practice = {
  active: false, index: 0, ballT0: 0, nextAt: 0, swung: false,
  results: [], types: [], reqType: null,
};
const PRACTICE_BALL_MS = 2000;

function beginTrial() {
  state.step = 'trial';
  showOnly('obTrial');
  mountMirror($('obMirrorSlot2'), true);
  $('pips').querySelectorAll('i').forEach((i) => i.className = '');
  practice.active = true;
  practice.index = 0;
  practice.results = [];
  practice.types = ['clear', 'drop', 'smash'].sort(() => Math.random() - 0.5);
  practice.reqType = null;
  practice.nextAt = performance.now() + 550;
  practice.ballT0 = 0;
  $('obDone').disabled = true;
  $('pText').className = 'pText';
  $('pText').textContent = '准备…';
  $('pShot').textContent = '这一轮指定三种球路';
  $('pdot').style.display = 'none';
  const hold = document.querySelector('.obTrial .trialHold');
  if (hold) hold.classList.remove('want');
}

function startBall() {
  if (!practice.active || practice.index >= 3) return;
  const req = practice.types[practice.index] || 'clear';
  practice.reqType = req;
  practice.swung = false;
  practice.ballT0 = performance.now();
  $('pdot').style.display = 'block';
  $('pdot').style.left = '6%';
  $('pShot').innerHTML = '本拍：<b>' + SHOT_NAME[req] + '</b> · ' + SHOT_HINT[req];
  const hold = document.querySelector('.obTrial .trialHold');
  if (hold) hold.classList.toggle('want', req === 'drop');
  $('pText').className = 'pText';
  $('pText').textContent = '球要来了…';
}

function practiceSwing(swingStart, shot = 'clear') {
  if (!practice.active || practice.swung || !practice.ballT0) return;
  const t = (swingStart - practice.ballT0) / PRACTICE_BALL_MS;
  let kind;
  if (t < 0.60) kind = 'early';
  else if (t <= 0.94) kind = 'perfect';
  else kind = 'late';
  // 判定用起拍时间；下一拍的排期用当前时间
  resolvePractice(kind, performance.now(), shot);
}

function resolvePractice(kind, now, shot = '') {
  if (!practice.active) return;
  practice.swung = true;
  const req = practice.reqType;
  const typeOk = shot === req;
  let txt, cls;

  if (kind === 'missed') {
    txt = '没挥到，球过去了';
    cls = 'miss';
  } else if (!typeOk) {
    txt = '这一拍要' + SHOT_NAME[req] + '，你打成了' + (SHOT_NAME[shot] || '空挥');
    cls = 'miss';
  } else if (kind === 'perfect') {
    txt = '漂亮，' + SHOT_NAME[req] + '到位';
    cls = 'perfect';
  } else if (kind === 'early') {
    txt = '球还没到，再等半拍';
    cls = 'near';
  } else {
    txt = '有点晚，球已经过去';
    cls = 'near';
  }

  $('pText').className = 'pText ' + (cls === 'perfect' ? 'good' : cls === 'miss' ? 'bad' : '');
  $('pText').textContent = txt;
  $('pdot').style.display = 'none';

  const pip = $('pips').querySelectorAll('i')[practice.index];
  if (pip) pip.className = cls;
  practice.results.push({ kind, typeOk });
  practice.index++;
  practice.ballT0 = 0;

  if (practice.index >= 3) {
    const typeGood = practice.results.filter((r) => r.typeOk).length;
    const perfect = practice.results.filter((r) => r.typeOk && r.kind === 'perfect').length;
    setTimeout(() => {
      $('pText').textContent = '球路 ' + typeGood + '/3 · 完美 ' + perfect + '/3'
        + (typeGood === 3 ? ' · 上场吧' : ' · 可以再练一轮');
      $('pShot').textContent = '练习完成 · 三种球路';
      const hold = document.querySelector('.obTrial .trialHold');
      if (hold) hold.classList.remove('want');
      $('obDone').disabled = false;
      if (navigator.vibrate) navigator.vibrate([14, 40, 14]);
    }, 500);
  } else {
    practice.nextAt = now + 1000;
  }
}

function loopPractice(now) {
  if (!practice.active) return;
  if (practice.nextAt && now >= practice.nextAt) {
    practice.nextAt = 0;
    startBall();
    return;
  }
  if (!practice.ballT0) return;
  const t = (now - practice.ballT0) / PRACTICE_BALL_MS;
  if (t > 1.35) {
    if (!practice.swung) resolvePractice('missed', now);
    return;
  }
  const p = clamp(t, 0, 1);
  $('pdot').style.left = (6 + p * 88) + '%';
  if (t > 0.60 && t <= 0.94) {
    $('pText').textContent = '就是现在！';
  }
}

$('obDone').onclick = () => startPlay();
$('obSkip').onclick = () => startPlay();

function startPlay() {
  state.step = 'play';
  practice.active = false;
  $('onboard').classList.add('hide');
  $('app').classList.remove('hidden');
  mountMirror($('mirrorHome'), false);
  sizeAimCanvas();
  updateSensorLabel();
  const last = $('lastShot');
  if (last) {
    last.textContent = '—';
    last.style.color = '';
  }
  $('peak').textContent = '力度 0%';
  $('dirtxt').textContent = '—';
  $('fill').style.width = '0%';
  if (SENS.hasOrient) {
    $('mirrorBadge').textContent = SENS.calibrated ? '手屏同步中' : '未校准';
    $('mirrorBadge').classList.toggle('ok', SENS.calibrated);
  } else {
    $('mirrorBadge').textContent = SENS.tapMode ? '触屏模式' : '仅挥动模式';
    $('mirrorBadge').classList.remove('ok');
  }
  if (socket.connected) socket.emit('ctrl:join', joinPayload());
  startPoseSender();
  keepAwake();
  if (LABEL_MODE) startLabeling();
}

$('replay').onclick = () => {
  state.step = 'trial';
  $('app').classList.add('hidden');
  $('onboard').classList.remove('hide');
  showOnly('obTrial');
  mountMirror($('obMirrorSlot2'), true);
  beginTrial();
};

// ============================================================
// 姿态回传（30Hz）
// ============================================================
let poseTimer = 0;
function startPoseSender() {
  if (poseTimer) return;
  poseTimer = setInterval(() => {
    if (!SENS.calibrated || !SENS.hasOrient || !mySlot || !socket.connected) return;
    const q = SENS.qReal;
    socket.emit('ctrl:pose', {
      q: [q.x, q.y, q.z, q.w],
      az: SENS.az, el: SENS.el, om: SENS.omega, hand: myHand,
    });
  }, 33);
}

// ============================================================
// Socket
// ============================================================
const $tip = { big: $('big'), hint: $('hint'), ring: $('ring'), label: $('label') };
let lastState = null;
let hitFlashUntil = 0;
let missFlashUntil = 0;

socket.on('connect', () => {
  $('dot').className = 'dot live';
  $('stat').textContent = '已连接';
  if (state.step === 'play') socket.emit('ctrl:join', joinPayload());
});
socket.on('disconnect', () => {
  $('dot').className = 'dot';
  $('stat').textContent = '连接断开';
});
socket.on('ctrl:joined', ({ slot }) => {
  mySlot = slot;
  const el = $('slotb');
  el.textContent = slot === 'left' ? '左边场地' : '右边场地';
  el.className = 'badge slot ' + slot;
});
socket.on('ctrl:full', () => {
  $('stat').textContent = '场地已满';
  $('dot').className = 'dot';
});
socket.on('ctrl:released', () => { mySlot = null; $('slotb').textContent = '被接管'; });

// 网络延迟测量：服务端立刻回包；单程延迟 = RTT / 2
setInterval(() => {
  if (!socket.connected) return;
  pingAt = performance.now();
  socket.emit('ctrl:ping', { t: Date.now() });
}, 3000);
socket.on('ctrl:pong', () => {
  if (!pingAt) return;
  const r = performance.now() - pingAt;
  pingAt = 0;
  if (r >= 0 && r < 1500) rttMs = rttMs > 0 ? rttMs * 0.75 + r * 0.25 : r;
});

// 服务端反馈：命中质量 / 漏击
socket.on('ctrl:hit', ({ grade, shot }) => {
  hitFlashUntil = performance.now() + 420;
  const txt = grade === 'perfect' ? '完美甜区' : grade === 'good' ? '好球' : '擦边';
  const sn = SHOT_NAME[shot] || '';
  $tip.label.textContent = '命中';
  $tip.big.textContent = sn || txt;
  $tip.big.className = 'big hot' + (sn ? ' ' + shot : '');
  $tip.hint.textContent = sn ? txt + (grade === 'perfect' ? ' · 时机和位置都很好' : '') : '';
  const last = $('lastShot');
  if (last && sn) {
    last.textContent = sn;
    last.style.color = SHOT_CSS[shot] || '';
  }
  if (navigator.vibrate) {
    navigator.vibrate(grade === 'perfect' ? [12, 26, 30] : grade === 'good' ? [14, 30, 16] : [10]);
  }
});
const MISS_TIP = {
  high: ['球还高', '等它下落再挥'],
  far: ['够不到', '往球的落点走一步'],
  late: ['慢了一点', '球已过身，再早一点'],
  early: ['早了一点', '球到身边再挥'],
};
socket.on('ctrl:miss', ({ reason } = {}) => {
  const tip = MISS_TIP[reason] || MISS_TIP.early;
  missFlashUntil = performance.now() + 1200;
  $tip.big.textContent = tip[0];
  $tip.big.className = 'big';
  $tip.hint.textContent = tip[1];
  if (navigator.vibrate) navigator.vibrate([8, 60, 8]);
});

socket.on('ctrl:tick', (s) => {
  lastState = s;
  const me = mySlot === 'left' ? s.l : s.r;
  const other = mySlot === 'left' ? s.r : s.l;
  if (!me || !other) return;
  $('mysc').textContent = me.score;
  $('thsc').textContent = other.score;

  const now = performance.now();
  if (now < hitFlashUntil) {
    $tip.ring.className = 'ring hit';
    return;
  }
  if (now < missFlashUntil) {
    $tip.ring.className = 'ring miss';
    return;
  }

  const onMine = mySlot === 'left' ? s.bz < 0 : s.bz > 0;
  const d = Math.hypot(s.bx - me.x, s.by - me.y, s.bz - me.z);

  if (s.phase === 'over') {
    $tip.ring.className = 'ring';
    $tip.label.textContent = '比分';
    $tip.big.textContent = me.score > other.score ? '获胜' : '结束';
    $tip.big.className = 'big';
    $tip.hint.textContent = '';
  } else if (s.phase === 'serve' && s.srv === mySlot) {
    $tip.ring.className = 'ring hot';
    $tip.label.textContent = '发球';
    $tip.big.textContent = '挥拍';
    $tip.big.className = 'big hot';
    $tip.hint.textContent = '把球打过网';
  } else if (s.phase === 'rally' && onMine && d < 2.2) {
    $tip.ring.className = 'ring hot';
    $tip.label.textContent = '击球';
    $tip.big.textContent = '现在挥';
    $tip.big.className = 'big hot';
    $tip.hint.textContent = '球在拍边';
  } else {
    $tip.ring.className = 'ring';
    $tip.label.textContent = '挥拍';
    $tip.big.textContent = '等球';
    $tip.big.className = 'big';
    $tip.hint.textContent = onMine ? '球在你这边，准备挥' : '球在对手那边';
  }
});

// ============================================================
// 按钮 / 触屏兜底
// ============================================================
$('swap').onclick = () => {
  mySlot = mySlot === 'left' ? 'right' : 'left';
  socket.emit('ctrl:join', joinPayload({ slot: mySlot }));
  if (navigator.vibrate) navigator.vibrate(16);
};

// 持拍手：决定吊球键在左/右，并同步给大屏 3D 人物
function applyHandUI() {
  const right = myHand === 'right';
  $('handBtn').textContent = right ? '右手持拍' : '左手持拍';
  $('handBtn').classList.toggle('handOn', !right);
  $('shotDock').classList.toggle('rightHand', right);
  document.querySelectorAll('.obTrial .shotDock').forEach((d) => d.classList.toggle('rightHand', right));
  $('handTip').textContent = right ? '吊球键在右侧，用右拇指按住' : '吊球键在左侧，用左拇指按住';
  socket.emit('ctrl:hand', { hand: myHand });
}
$('handBtn').onclick = () => {
  myHand = myHand === 'right' ? 'left' : 'right';
  localStorage.setItem('bm3_hand', myHand);
  applyHandUI();
  if (navigator.vibrate) navigator.vibrate(16);
};
applyHandUI();

// 全屏（iOS Safari 不支持时给出提示）
document.addEventListener('fullscreenchange', () => {
  $('fsBtn').textContent = document.fullscreenElement ? '退出全屏' : '全屏';
});
$('fsBtn').onclick = async () => {
  const el = document.documentElement;
  try {
    const isFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (isFs) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else document.webkitExitFullscreen();
    } else if (el.requestFullscreen) {
      await el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    } else {
      $('sensorTxt').textContent = '此浏览器不支持全屏（iOS 可加到主屏幕）';
      return;
    }
    setTimeout(sizeAimCanvas, 350);
  } catch {
    $('sensorTxt').textContent = '全屏被浏览器阻止';
  }
};

// 息屏防误触：纯黑遮罩拦住所有触摸，长按 0.65 秒唤醒；传感器继续工作
let dimHoldT = 0;
$('dimBtn').onclick = () => {
  setDropHold(false);
  $('dimMask').classList.remove('hidden');
  keepAwake();
};
$('dimMask').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  clearTimeout(dimHoldT);
  dimHoldT = setTimeout(() => $('dimMask').classList.add('hidden'), 650);
});
$('dimMask').addEventListener('pointerup', () => clearTimeout(dimHoldT));
$('dimMask').addEventListener('pointercancel', () => clearTimeout(dimHoldT));

// 屏幕常亮：息屏遮罩下也保持页面与传感器活跃
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('dimMask').classList.contains('hidden')) keepAwake();
});

function paintInvert() {
  $('invert').textContent = getInvert() > 0 ? '左右打反了？' : '已反转 · 点此恢复';
}
paintInvert();
$('invert').onclick = () => {
  setInvert(-getInvert());
  localStorage.setItem('bm3_invert', String(getInvert()));
  paintInvert();
  if (navigator.vibrate) navigator.vibrate(20);
};

// 按住 = 吊球；松手恢复
function setDropHold(on) {
  SENS.dropHold = !!on;
  document.querySelectorAll('.holdBtn').forEach((b) => b.classList.toggle('held', !!on));
}
document.querySelectorAll('.holdBtn').forEach((btn) => {
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); setDropHold(true); });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('touchstart', (e) => { e.preventDefault(); setDropHold(true); }, { passive: false });
});
addEventListener('pointerup', () => setDropHold(false));
addEventListener('pointercancel', () => setDropHold(false));
addEventListener('touchend', () => setDropHold(false));
addEventListener('touchcancel', () => setDropHold(false));
addEventListener('blur', () => setDropHold(false));
addEventListener('keydown', (e) => { if (e.key === 'Shift') setDropHold(true); });
addEventListener('keyup', (e) => { if (e.key === 'Shift') setDropHold(false); });

// 触屏兜底：传感器不可用时点圆环挥拍
$('ring').addEventListener('click', () => {
  if (SENS.tapMode && state.step === 'play') fire(0.65, 0, 0);
  if (SENS.tapMode && state.step === 'trial') practiceSwing(performance.now());
});

document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ============================================================
// 主循环
// ============================================================
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  loopPractice(now);
  renderMirror(dt);
  if (state.step === 'play') drawAim();

  // 静置校准进度（不依赖传感器事件频率）
  if (state.step === 'calib' && SENS.stillStart && !SENS.stillDone) {
    const pct = clamp((now - SENS.stillStart) / 2000, 0, 1);
    $('stillFill').style.width = (pct * 100).toFixed(0) + '%';
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 兜底：3 秒没有方向数据就提示
setTimeout(() => {
  if (state.step === 'intro' && SENS.orientCount === 0 && SENS.motionCount === 0) {
    const st = $('obStatus');
    if (st && !st.textContent.includes('未收到')) {
      st.className = 'status';
      st.textContent = '提示：需要 HTTPS 访问，并允许「动作与方向」权限。';
    }
  }
}, 3000);

// 传感器 → 主流程 的回调装配
setSwingHandler(fire);
setCalReadyHandler(() => { const b = $('calBtn'); if (b) b.disabled = false; });