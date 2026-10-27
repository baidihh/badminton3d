// 大屏渲染：球场、角色、球与特效、HUD、主循环
import * as THREE from 'three';
import { PlayerView, loadPlayerGLTF } from './player.js';

// ============================================================
// 世界常量（与服务器一致）
// ============================================================
const HALF_W = 3.0, HALF_L = 6.7, NET_H = 1.55, NET_HALF_W = 3.1;
const FLOOR_W = 16, FLOOR_L = 26;
const BASE_Z = 4.6;             // 球员站位纵深（与服务器 PLAYER_Z 一致）
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

// ============================================================
// 渲染器 / 场景
// ============================================================
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.8));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04070c);
scene.fog = new THREE.Fog(0x050a12, 17, 44);

const camL = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
const camR = new THREE.PerspectiveCamera(48, 1, 0.1, 120);

// ============================================================
// 程序化贴图
// ============================================================
function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// 场馆背景：竖向渐变 + 横向光带
function arenaTexture() {
  const [c, g] = cv(1024, 512);
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#060b14');
  grd.addColorStop(0.42, '#0a1420');
  grd.addColorStop(0.72, '#0d1a26');
  grd.addColorStop(1, '#05080d');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 512);
  // 观众席光带
  for (let i = 0; i < 3; i++) {
    const y = 250 + i * 46;
    g.fillStyle = 'rgba(60,150,210,.05)';
    g.fillRect(0, y, 1024, 10);
  }
  // 零散观众点
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * 1024;
    const y = 236 + Math.random() * 150;
    const a = 0.03 + Math.random() * 0.1;
    g.fillStyle = `rgba(${120 + Math.random() * 100},${170 + Math.random() * 70},220,${a})`;
    g.fillRect(x, y, 2, 2);
  }
  return tex(c);
}

// 场地：蓝色地胶 + 白线 + 细噪点
function courtTexture() {
  const W = 1024, H = 1500;
  const [c, g] = cv(W, H);
  g.fillStyle = '#071119'; g.fillRect(0, 0, W, H);
  const px = (x) => ((x + FLOOR_W / 2) / FLOOR_W) * W;
  const py = (z) => ((z + FLOOR_L / 2) / FLOOR_L) * H;

  const x0 = px(-HALF_W), x1 = px(HALF_W), z0 = py(-HALF_L), z1 = py(HALF_L);
  // 地胶底色
  const mat = g.createLinearGradient(0, z0, 0, z1);
  mat.addColorStop(0, '#125a68');
  mat.addColorStop(0.5, '#0f5b6c');
  mat.addColorStop(1, '#125a68');
  g.fillStyle = mat;
  g.fillRect(x0, z0, x1 - x0, z1 - z0);

  // 左右半场淡色区分
  const mid = py(0);
  g.fillStyle = 'rgba(90,190,230,.045)';
  g.fillRect(x0, z0, x1 - x0, mid - z0);
  g.fillStyle = 'rgba(255,140,110,.04)';
  g.fillRect(x0, mid, x1 - x0, z1 - mid);

  // 场地噪点
  for (let i = 0; i < 9000; i++) {
    const x = x0 + Math.random() * (x1 - x0);
    const y = z0 + Math.random() * (z1 - z0);
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.02)' : 'rgba(0,20,30,.03)';
    g.fillRect(x, y, 1.4, 1.4);
  }

  // 线
  const line = (a, b, c2, d, w, alpha = 0.9) => {
    g.strokeStyle = `rgba(245,250,255,${alpha})`;
    g.lineWidth = w;
    g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke();
  };
  g.strokeStyle = 'rgba(245,250,255,.9)';
  g.lineWidth = 6;
  g.strokeRect(x0, z0, x1 - x0, z1 - z0);

  const ssl = 1.98, dsl = 5.94;
  line(px(0), py(ssl), px(0), z1, 5);
  line(px(0), z0, px(0), py(-ssl), 5);
  line(x0, py(ssl), x1, py(ssl), 5);
  line(x0, py(-ssl), x1, py(-ssl), 5);
  line(x0, py(dsl), x1, py(dsl), 3, 0.42);
  line(x0, py(-dsl), x1, py(-dsl), 3, 0.42);

  // 场地高光
  const glow = g.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, H * 0.55);
  glow.addColorStop(0, 'rgba(190,235,255,.10)');
  glow.addColorStop(1, 'rgba(190,235,255,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);

  return tex(c);
}

// 球网
function netTexture() {
  const W = 512, H = 150;
  const [c, g] = cv(W, H);
  g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(232,242,252,.62)';
  g.lineWidth = 1.4;
  for (let x = 0; x <= W; x += 9) {
    g.beginPath(); g.moveTo(x, 16); g.lineTo(x, H); g.stroke();
  }
  for (let y = 16; y <= H; y += 9) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  // 顶部白带
  g.fillStyle = 'rgba(250,253,255,.97)';
  g.fillRect(0, 0, W, 15);
  g.fillStyle = 'rgba(140,200,230,.25)';
  g.fillRect(0, 13, W, 2);
  return tex(c);
}

// 拍线 / 号码贴图已迁移到 js/player.js

function glowTexture() {
  const [c, g] = cv(128, 128);
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,.98)');
  grd.addColorStop(0.3, 'rgba(200,235,255,.55)');
  grd.addColorStop(1, 'rgba(160,220,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return tex(c);
}

function shadowTexture() {
  const [c, g] = cv(128, 128);
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 60);
  grd.addColorStop(0, 'rgba(0,0,0,.62)');
  grd.addColorStop(0.55, 'rgba(0,0,0,.28)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return tex(c);
}

// ============================================================
// 灯光
// ============================================================
scene.add(new THREE.HemisphereLight(0x9ec7ff, 0x0a1018, 0.62));

const key = new THREE.DirectionalLight(0xf2f8ff, 2.5);
key.position.set(6, 15, 9);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -13;
key.shadow.camera.right = 13;
key.shadow.camera.top = 16;
key.shadow.camera.bottom = -16;
key.shadow.camera.near = 1;
key.shadow.camera.far = 45;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.02;
scene.add(key);

const rim = new THREE.DirectionalLight(0x5fb8ff, 1.15);
rim.position.set(-9, 7, -11);
scene.add(rim);

const warm = new THREE.DirectionalLight(0xffb27a, 0.5);
warm.position.set(8, 5, -6);
scene.add(warm);

// ============================================================
// 场馆
// ============================================================
{
  // 背景穹顶
  const dome = new THREE.Mesh(
    new THREE.CylinderGeometry(30, 30, 17, 48, 1, true),
    new THREE.MeshBasicMaterial({ map: arenaTexture(), side: THREE.BackSide, fog: false })
  );
  dome.position.y = 6.5;
  scene.add(dome);

  // 顶棚
  const roof = new THREE.Mesh(
    new THREE.CircleGeometry(30, 48),
    new THREE.MeshBasicMaterial({ color: 0x04070d, side: THREE.DoubleSide, fog: false })
  );
  roof.rotation.x = Math.PI / 2;
  roof.position.y = 15;
  scene.add(roof);

  // 两侧看台
  const standMat = new THREE.MeshStandardMaterial({ color: 0x0b121b, roughness: 0.9, metalness: 0.05 });
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x2fa8d8, transparent: true, opacity: 0.5 });
  for (const sx of [-1, 1]) {
    for (let row = 0; row < 4; row++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.55, 24), standMat);
      step.position.set(sx * (7.2 + row * 1.22), 0.5 + row * 0.55, 0);
      step.receiveShadow = true;
      scene.add(step);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.045, 23), ledMat);
      led.position.set(sx * (7.2 + row * 1.22 - 0.63), 0.79 + row * 0.55, 0);
      scene.add(led);
    }
  }
  // 两端看台
  for (const sz of [-1, 1]) {
    for (let row = 0; row < 3; row++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(15, 0.55, 1.2), standMat);
      step.position.set(0, 0.5 + row * 0.55, sz * (10.5 + row * 1.15));
      scene.add(step);
    }
  }

  // 观众（实例化小圆点，远景氛围）
  const crowdGeo = new THREE.SphereGeometry(0.085, 7, 6);
  const crowdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, 360);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  let n = 0;
  for (let i = 0; i < 360; i++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    const row = Math.floor(Math.random() * 4);
    const x = side * (7.25 + row * 1.22 + (Math.random() - 0.5) * 0.6);
    const z = (Math.random() - 0.5) * 22;
    const y = 0.95 + row * 0.55 + Math.random() * 0.16;
    m.makeTranslation(x, y, z);
    crowd.setMatrixAt(n, m);
    col.setHSL(0.55 + Math.random() * 0.08, 0.25, 0.16 + Math.random() * 0.12);
    crowd.setColorAt(n, col);
    n++;
  }
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  scene.add(crowd);

  // 场边 LED 广告板
  const [ac, ag] = cv(1024, 128);
  ag.fillStyle = '#061018'; ag.fillRect(0, 0, 1024, 128);
  ag.strokeStyle = 'rgba(63,208,255,.35)'; ag.lineWidth = 3; ag.strokeRect(4, 4, 1016, 120);
  ag.fillStyle = 'rgba(160,230,255,.72)';
  ag.font = '600 52px Inter, sans-serif';
  ag.textAlign = 'center'; ag.textBaseline = 'middle';
  ag.fillText('B A D M I N T O N   3 D', 512, 66);
  const adTex = tex(ac);
  for (const sz of [-1, 1]) {
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(8.4, 0.72, 0.08),
      new THREE.MeshStandardMaterial({ map: adTex, emissive: 0x0b2b3c, emissiveIntensity: 0.7, roughness: 0.7 })
    );
    board.position.set(0, 0.42, sz * 9.4);
    scene.add(board);
  }

  // 顶部灯阵
  for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4], [0, 0]]) {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 20),
      new THREE.MeshBasicMaterial({ color: 0xf4fbff })
    );
    disc.rotation.x = Math.PI / 2;
    disc.position.set(x, 14.2, z);
    scene.add(disc);
  }
}

// ============================================================
// 场地
// ============================================================
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(FLOOR_W, FLOOR_L),
  new THREE.MeshStandardMaterial({ map: courtTexture(), roughness: 0.62, metalness: 0.06 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// 场外地面（更暗、更光滑）
const outer = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 60),
  new THREE.MeshStandardMaterial({ color: 0x070c13, roughness: 0.45, metalness: 0.16 })
);
outer.rotation.x = -Math.PI / 2;
outer.position.y = -0.012;
outer.receiveShadow = true;
scene.add(outer);

// 球网 + 网柱
const netMat = new THREE.MeshStandardMaterial({
  map: netTexture(), transparent: true, alphaTest: 0.02,
  side: THREE.DoubleSide, roughness: 1, metalness: 0, opacity: 0.96,
  depthWrite: false,
});
const netMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.12, NET_H), netMat);
netMesh.position.set(0, NET_H / 2, 0);
scene.add(netMesh);

const netTape = new THREE.Mesh(
  new THREE.BoxGeometry(6.2, 0.05, 0.02),
  new THREE.MeshStandardMaterial({ color: 0xf6fbff, roughness: 0.6 })
);
netTape.position.set(0, NET_H - 0.02, 0);
scene.add(netTape);

const postMat = new THREE.MeshStandardMaterial({ color: 0xdde8f6, roughness: 0.35, metalness: 0.35 });
for (const x of [-3.08, 3.08]) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, NET_H, 14), postMat);
  post.position.set(x, NET_H / 2, 0);
  post.castShadow = true;
  scene.add(post);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.06, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a2532, roughness: 0.8 }));
  base.position.set(x, 0.03, 0);
  scene.add(base);
}

// 角色（GLB 骨骼模型 + 动画混合 + IK 覆盖）
// ============================================================
const shadowTex = shadowTexture();
const MODEL_URL = '/models/Xbot.glb';
let p1view = null, p2view = null;

loadPlayerGLTF(MODEL_URL)
  .then((gltf) => {
    p1view = new PlayerView(gltf, { accent: 0x3FD0FF, shadowTex });
    p2view = new PlayerView(gltf, { accent: 0xFF8268, shadowTex });
    p1view.addTo(scene);
    p2view.addTo(scene);
    const tip = document.getElementById('modelTip');
    if (tip) tip.classList.add('off');
  })
  .catch((err) => {
    console.error('[GLB] 加载失败', err);
    const tip = document.getElementById('modelTip');
    if (tip) tip.textContent = '模型加载失败：' + (err && err.message ? err.message : err);
  });

// 拖尾 / 球影 / 击球特效
const TRAIL_N = 26;
const trailPos = new Float32Array(TRAIL_N * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
  color: 0xcfeeff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false,
}));
trailLine.frustumCulled = false;
scene.add(trailLine);
let trailCount = 0;

function resetTrail(b) {
  for (let i = 0; i < TRAIL_N; i++) {
    trailPos[i * 3] = b.x;
    trailPos[i * 3 + 1] = b.y;
    trailPos[i * 3 + 2] = b.z;
  }
  trailCount = 1;
  trailGeo.setDrawRange(0, 1);
  trailGeo.attributes.position.needsUpdate = true;
  trailLine.material.color.set(0xcfeeff);
  trailLine.material.opacity = 0.3;
  if (shuttle.userData.halo) shuttle.userData.halo.material.color.set(0xbfe8ff);
  setShotTag('left', '');
  setShotTag('right', '');
}

const ballBlob = new THREE.Mesh(
  new THREE.PlaneGeometry(0.5, 0.5),
  new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.7 })
);
ballBlob.rotation.x = -Math.PI / 2;
ballBlob.position.y = 0.012;
scene.add(ballBlob);

// 羽毛球
const shuttle = new THREE.Group();
{
  const cork = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xf8fbff, roughness: 0.5 })
  );
  cork.scale.set(1, 0.95, 1);
  shuttle.add(cork);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.024, 0.012, 14),
    new THREE.MeshStandardMaterial({ color: 0xd9e4f2, roughness: 0.8 })
  );
  cap.position.x = -0.024;
  cap.rotation.z = Math.PI / 2;
  shuttle.add(cap);

  // 羽毛裙：16 片薄片
  const featherMat = new THREE.MeshStandardMaterial({
    color: 0xf4f8ff, roughness: 0.82, transparent: true, opacity: 0.82,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const featherGeo = new THREE.PlaneGeometry(0.075, 0.022);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const f = new THREE.Mesh(featherGeo, featherMat);
    f.position.set(-0.065, Math.sin(a) * 0.048, Math.cos(a) * 0.048);
    f.rotation.x = Math.PI / 2;
    f.rotation.z = Math.PI / 2;
    f.rotation.y = -a;
    f.lookAt(-0.12, Math.sin(a) * 0.088, Math.cos(a) * 0.088);
    shuttle.add(f);
  }
  const skirtGlow = new THREE.Mesh(
    new THREE.ConeGeometry(0.055, 0.115, 16, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xe8f4ff, transparent: true, opacity: 0.08,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  skirtGlow.rotation.z = Math.PI / 2;
  skirtGlow.position.x = -0.065;
  shuttle.add(skirtGlow);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, opacity: 0.5, color: 0xbfe8ff,
  }));
  halo.scale.setScalar(0.32);
  shuttle.add(halo);
  shuttle.userData.halo = halo;
}
shuttle.scale.setScalar(1.12);
scene.add(shuttle);

// 击球火花
const SPARK_N = 64;
const sparkPos = new Float32Array(SPARK_N * 3);
const sparkVel = [];
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
const sparkMat = new THREE.PointsMaterial({
  color: 0xffeec2, size: 0.042, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
});
const sparks = new THREE.Points(sparkGeo, sparkMat);
sparks.frustumCulled = false;
sparks.visible = false;
scene.add(sparks);
let sparkLife = 0;

// 冲击波
const wave = new THREE.Mesh(
  new THREE.RingGeometry(0.15, 0.19, 40),
  new THREE.MeshBasicMaterial({
    color: 0xdff4ff, transparent: true, opacity: 0, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, depthWrite: false,
  })
);
wave.visible = false;
scene.add(wave);
let waveLife = 0;

// 击球闪光
const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
flashSprite.scale.setScalar(1.4);
flashSprite.visible = false;
scene.add(flashSprite);
let flashLife = 0;

// ============================================================
// 状态
// ============================================================
let S = null;
let twoPlayer = false;
let smoothBall = { x: 0, y: 2.5, z: -3, vx: 0, vy: 0, vz: 0 };
let prevScore = { left: 0, right: 0 };
let prevMsg = '';
let prevBallZ = 0;
let lastBallState = null;
let lastImpactId = 0;
let shake = 0, hitStop = 0, netWobble = 0;
let shakeX = 0, shakeZ = 0;
let soundOn = true;
let poseEuler = new THREE.Euler();
let poseQuat = new THREE.Quaternion();

const $ = (id) => document.getElementById(id);
const toastEl = $('toast');
const gradeEl = $('grade');
let toastTimer = 0, gradeTimer = 0;

const socket = io();

socket.on('state', (s) => {
  const first = !S;
  if (first) {
    smoothBall = { ...s.ball };
    prevBallZ = s.ball.z;
    lastImpactId = s.impact.id || 0;
    camL.position.set(s.left.x * 0.55, 3.85, -BASE_Z - 6.2);
    camR.position.set(s.right.x * 0.55, 3.85, BASE_Z + 6.2);
  }
  S = s;

  // 发球/重开时球会瞬移，必须同步清理拖尾，避免跨场白线
  if (lastBallState) {
    const jump = Math.hypot(
      s.ball.x - lastBallState.x,
      s.ball.y - lastBallState.y,
      s.ball.z - lastBallState.z
    );
    if (jump > 1.2) {
      smoothBall.x = s.ball.x;
      smoothBall.y = s.ball.y;
      smoothBall.z = s.ball.z;
      smoothBall.vx = s.ball.vx;
      smoothBall.vy = s.ball.vy;
      smoothBall.vz = s.ball.vz;
      resetTrail(s.ball);
    }
  }
  lastBallState = { x: s.ball.x, y: s.ball.y, z: s.ball.z };

  // 大屏可能是在第二部手机接入后才打开，这里补一次自动分屏
  if (!twoPlayer && !s.right.ai && s.right.connected) {
    twoPlayer = true;
    layout();
    $('b1').classList.remove('on');
    $('b2').classList.add('on');
  }

  if (s.left.score !== prevScore.left || s.right.score !== prevScore.right) {
    showToast(s.msg || '得分');
    sfxScore();
    prevScore = { left: s.left.score, right: s.right.score };
  } else if (s.msg && s.msg !== prevMsg) {
    showToast(s.msg);
  }
  prevMsg = s.msg;

  if ((s.impact.id || 0) !== lastImpactId) {
    lastImpactId = s.impact.id || 0;
    triggerImpact(s.impact);
  }

  // 触网：球穿过网面且在网高以下
  if ((prevBallZ < 0) !== (s.ball.z < 0) && s.ball.y < NET_H + 0.1) {
    netWobble = 1;
    sfxNet();
  }
  prevBallZ = s.ball.z;
});

socket.on('mode:set', ({ twoPlayer: tp }) => {
  twoPlayer = !!tp;
  layout();
  $('b1').classList.toggle('on', !twoPlayer);
  $('b2').classList.toggle('on', twoPlayer);
});

function showToast(t) {
  toastEl.textContent = t;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('on'), 1000);
}
const SHOT_NAME = { clear: '高远球', drop: '吊球', smash: '杀球' };
const SHOT_TAG = { clear: '高远', drop: '吊球', smash: '杀球' };
const SHOT_COLOR = {
  clear: new THREE.Color(0xbfe8ff),
  drop: new THREE.Color(0x7cffb2),
  smash: new THREE.Color(0xff8a5c),
};

function setShotTag(side, shot) {
  const el = $(side === 'left' ? 'tagL' : 'tagR');
  if (!el) return;
  el.textContent = SHOT_TAG[shot] || '—';
  el.className = 'shotTag' + (SHOT_TAG[shot] ? ' ' + shot : '');
}

function showGrade(grade, shot) {
  const map = { perfect: '完美 · 甜区', good: '好球', edge: '擦边' };
  const sn = SHOT_NAME[shot] || '';
  const perfect = grade === 'perfect';
  gradeEl.textContent = (sn ? sn + ' · ' : '') + (map[grade] || '击球');
  gradeEl.className = 'grade on' + (perfect ? ' perfect' : '') + (!perfect && sn ? ' ' + shot : '');
  clearTimeout(gradeTimer);
  gradeTimer = setTimeout(() => gradeEl.classList.remove('on'), 900);
}

// ============================================================
// 击球反馈
// ============================================================
function triggerImpact(imp) {
  if (!imp) return;
  const power = clamp(imp.power || 0.5, 0, 1);
  const shot = SHOT_TAG[imp.shot] ? imp.shot : 'clear';
  const col = SHOT_COLOR[shot];

  // 球路视觉编码：高远=冷蓝，吊球=青绿，杀球=橙红
  trailLine.material.color.copy(col);
  trailLine.material.opacity = shot === 'drop' ? 0.26 : shot === 'smash' ? 0.46 : 0.34;
  if (shuttle.userData.halo) shuttle.userData.halo.material.color.copy(col);
  wave.material.color.copy(col);
  flashSprite.material.color.copy(col);
  sparkMat.color.copy(col);
  sparkMat.size = shot === 'smash' ? 0.058 : shot === 'drop' ? 0.034 : 0.044;
  setShotTag(imp.side, shot);

  // 杀球反馈更重，吊球更轻
  const weight = shot === 'smash' ? 1.3 : shot === 'drop' ? 0.55 : 1;
  shake = (0.12 + power * 0.34) * weight;
  hitStop = shot === 'smash' ? 0.075 : shot === 'drop' ? 0.032 : 0.055;
  wave.position.set(imp.x, imp.y, imp.z);
  wave.visible = true;
  waveLife = 1;
  flashSprite.position.set(imp.x, imp.y, imp.z);
  flashSprite.visible = true;
  flashLife = 1;

  sparks.visible = true;
  sparkLife = 1;
  sparkMat.opacity = 1;
  for (let i = 0; i < SPARK_N; i++) {
    sparkPos[i * 3] = imp.x;
    sparkPos[i * 3 + 1] = imp.y;
    sparkPos[i * 3 + 2] = imp.z;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(Math.random() * 1.4 - 0.4);
    const sp = (shot === 'smash' ? 2.2 : shot === 'drop' ? 1.1 : 1.6) + Math.random() * 4.2;
    sparkVel[i] = new THREE.Vector3(
      Math.sin(ph) * Math.cos(th) * sp,
      Math.cos(ph) * sp * 0.85 + 0.6,
      Math.sin(ph) * Math.sin(th) * sp
    );
  }
  sparkGeo.attributes.position.needsUpdate = true;

  // 球拍发光
  const view = imp.side === 'right' ? p2view : p1view;
  if (view) view.racketFlash = 1;

  showGrade(imp.grade, shot);
  sfxHit(power, shot);
}

function updateFx(dt) {
  if (sparkLife > 0) {
    sparkLife = Math.max(0, sparkLife - dt * 2.4);
    sparkMat.opacity = sparkLife;
    for (let i = 0; i < SPARK_N; i++) {
      const v = sparkVel[i];
      if (!v) continue;
      sparkPos[i * 3] += v.x * dt;
      sparkPos[i * 3 + 1] += v.y * dt;
      sparkPos[i * 3 + 2] += v.z * dt;
      v.y -= 13 * dt;
      v.multiplyScalar(1 - 2.6 * dt);
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparks.visible = sparkLife > 0.01;
  }

  if (waveLife > 0) {
    waveLife = Math.max(0, waveLife - dt * 4.2);
    const s = 1 + (1 - waveLife) * 2.4;
    wave.scale.set(s, s, 1);
    wave.material.opacity = waveLife * 0.55;
    wave.quaternion.copy(camL.quaternion);
    wave.visible = waveLife > 0.01;
  }

  if (flashLife > 0) {
    flashLife = Math.max(0, flashLife - dt * 6.5);
    flashSprite.material.opacity = flashLife * 0.55;
    flashSprite.scale.setScalar(0.5 + (1 - flashLife) * 1.1);
    flashSprite.visible = flashLife > 0.01;
  }

  shake = Math.max(0, shake - dt * 2.4);
  hitStop = Math.max(0, hitStop - dt);
  netWobble = Math.max(0, netWobble - dt * 2.2);

  const amp = shake * 0.16;
  shakeX = (Math.random() - 0.5) * amp;
  shakeZ = (Math.random() - 0.5) * amp;

  netMesh.rotation.y = Math.sin(performance.now() * 0.03) * 0.045 * netWobble;
  netMesh.position.x = Math.sin(performance.now() * 0.045) * 0.02 * netWobble;
}

// ============================================================
// 音效
// ============================================================
let ac = null;
function ensureAudio() {
  if (!ac) {
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { }
  }
  if (ac && ac.state === 'suspended') ac.resume();
}
function noiseBurst(dur, freq, q, gain, type = 'bandpass') {
  if (!ac || !soundOn) return;
  const n = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 2.6);
  }
  const src = ac.createBufferSource(); src.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(ac.destination);
  src.start();
}
function tone(freq, dur, gain, type = 'sine', slide = 0) {
  if (!ac || !soundOn) return;
  const o = ac.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(freq, ac.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, ac.currentTime + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(gain, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  o.connect(g).connect(ac.destination);
  o.start(); o.stop(ac.currentTime + dur + 0.02);
}
function sfxHit(power, shot = 'clear') {
  if (shot === 'smash') {
    noiseBurst(0.07, 2400 + power * 1800, 0.9, 0.42 + power * 0.2);
    tone(82, 0.16, 0.28, 'sawtooth', 0.45);
  } else if (shot === 'drop') {
    noiseBurst(0.13, 500 + power * 500, 0.7, 0.14 + power * 0.1, 'lowpass');
    tone(160, 0.12, 0.1, 'sine', 0.8);
  } else {
    noiseBurst(0.09, 1100 + power * 1900, 1.2, 0.32 + power * 0.2);
    tone(120 + power * 50, 0.1, 0.16, 'sine', 0.55);
  }
}
function sfxNet() {
  noiseBurst(0.16, 420, 2.4, 0.2, 'lowpass');
  tone(90, 0.12, 0.1, 'sine', 0.7);
}
function sfxScore() {
  tone(660, 0.16, 0.06, 'sine', 1.5);
  setTimeout(() => tone(990, 0.18, 0.05, 'sine', 1.3), 70);
}

// ============================================================
// 角色更新（核心）
// ============================================================
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

function updatePlayers(dt) {
  if (!S) return;
  if (p1view) p1view.update(dt, S.left, smoothBall);
  if (p2view) p2view.update(dt, S.right, smoothBall);
}

// ============================================================
// 球
// ============================================================
function updateShuttle(dt) {
  const s = smoothBall;
  shuttle.position.set(s.x, s.y, s.z);

  const sp = Math.hypot(s.vx, s.vy, s.vz);
  if (sp > 0.4) {
    tmpV.set(s.vx, s.vy, s.vz).normalize();
    tmpQ.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tmpV);
    shuttle.quaternion.slerp(tmpQ, 1 - Math.exp(-14 * dt));
  }
  // 轻微自旋
  shuttle.rotateOnAxis(new THREE.Vector3(1, 0, 0), dt * 1.2);

  ballBlob.position.set(s.x, 0.012, s.z);
  const hgt = clamp(s.y / 3.5, 0, 1);
  ballBlob.material.opacity = 0.7 - hgt * 0.5;
  const sc = 0.5 + hgt * 0.55;
  ballBlob.scale.set(sc, sc, 1);

  // 拖尾
  for (let i = TRAIL_N - 1; i > 0; i--) {
    trailPos[i * 3] = trailPos[(i - 1) * 3];
    trailPos[i * 3 + 1] = trailPos[(i - 1) * 3 + 1];
    trailPos[i * 3 + 2] = trailPos[(i - 1) * 3 + 2];
  }
  trailPos[0] = s.x; trailPos[1] = s.y; trailPos[2] = s.z;
  trailCount = Math.min(TRAIL_N, trailCount + 1);
  trailGeo.setDrawRange(0, trailCount);
  trailGeo.attributes.position.needsUpdate = true;
}

// ============================================================
// 相机
// ============================================================
const camTarget = new THREE.Vector3();
function updateCameras(dt) {
  if (!S) return;
  const b = smoothBall;
  const k = 1 - Math.exp(-5.5 * dt);

  // 镜头只跟 30% 的前后移动，避免扑网时镜头怼到网带上
  const lx = S.left.x * 0.55;
  const lz = -BASE_Z - 6.2 + (S.left.z + BASE_Z) * 0.3;
  tmpV.set(lx + shakeX, 3.85 + (p1view ? p1view.jump : 0) * 0.35, lz + shakeZ);
  camL.position.lerp(tmpV, k);
  camTarget.set(b.x * 0.22, 0.55, 0.4 - b.z * 0.02);
  camL.lookAt(camTarget);

  const rx = S.right.x * 0.55;
  const rz = BASE_Z + 6.2 + (S.right.z - BASE_Z) * 0.3;
  tmpV.set(rx + shakeX, 3.85 + (p2view ? p2view.jump : 0) * 0.35, rz + shakeZ);
  camR.position.lerp(tmpV, k);
  camTarget.set(b.x * 0.22, 0.55, -0.4 + b.z * 0.02);
  camR.lookAt(camTarget);
}

// ============================================================
// HUD
// ============================================================
let hudTick = 0;
function updateHud(s) {
  $('sL').textContent = s.left.score;
  $('sR').textContent = s.right.score;
  $('nL').textContent = s.left.name || '玩家 1';
  $('nR').textContent = s.right.name || '电脑';
  $('dotL').className = 'dot' + (s.left.connected ? ' live' : '');
  $('dotR').className = 'dot' + (!s.right.ai && s.right.connected ? ' live' : '');
  $('rally').textContent = 'RALLY ' + (s.rally || 0);

  // 手机连接状态
  const phoneLive = s.left.connected;
  $('phoneDot').className = 'dot' + (phoneLive ? ' live' : '');
  $('phoneTxt').textContent = phoneLive
    ? (s.left.pose ? '手机已就绪' : '手机已连接')
    : '手机未连接';
  $('startDot').className = 'dot' + (phoneLive ? ' live' : '');
  $('startPhoneTxt').textContent = phoneLive
    ? '手机已连接 · 可以开始'
    : '手机未连接 · 也可用键盘';

  // 手屏同步小卡（分屏时各人看自己的手机，不显示公共卡）
  const pose = s.left.pose;
  $('poseCard').classList.toggle('on', !!pose && !twoPlayer);
  if (pose) {
    poseQuat.fromArray(pose);
    poseEuler.setFromQuaternion(poseQuat, 'YXZ');
    const deg = 180 / Math.PI;
    $('phone3d').style.transform =
      `rotateX(${(-poseEuler.x * deg * 0.9).toFixed(1)}deg) ` +
      `rotateY(${(poseEuler.y * deg * 0.9).toFixed(1)}deg) ` +
      `rotateZ(${(-poseEuler.z * deg * 0.9).toFixed(1)}deg)`;
  }

  if (++hudTick % 6) return;

  // 连接面板
  $('dL').className = 'sd l' + (s.left.connected ? ' ok' : '');
  $('kL').textContent = `左边 · ${s.left.name}${s.left.connected ? ' 已连接' : ' 未连接（可用键盘）'}`;
  if (s.right.ai) {
    $('dR').className = 'sd r';
    $('kR').textContent = '右边 · 电脑（无需连接）';
  } else {
    $('dR').className = 'sd r' + (s.right.connected ? ' ok' : '');
    $('kR').textContent = `右边 · ${s.right.name}${s.right.connected ? ' 已连接' : ' 未连接（可用回车）'}`;
  }

  const ready = !s.started;
  $('ready').classList.toggle('on', ready);
  if (ready) {
    $('ready').textContent = s.left.connected
      ? '手机已就绪 · 挥拍开始'
      : '按空格开始 · 或扫码用手机挥拍';
  }

  const nearL = s.ball.z < 0 && Math.hypot(s.ball.x - s.left.x, s.ball.y - s.left.y, s.ball.z - s.left.z) < 1.75;
  const nearR = s.ball.z > 0 && Math.hypot(s.ball.x - s.right.x, s.ball.y - s.right.y, s.ball.z - s.right.z) < 1.75;
  $('pL').classList.toggle('on', nearL && s.phase === 'rally');
  $('pR').classList.toggle('on', nearR && s.phase === 'rally' && twoPlayer);
}

// ============================================================
// 布局
// ============================================================
function layout() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  $('split').classList.toggle('off', !twoPlayer);
  $('hL').classList.toggle('wide', !twoPlayer);
  $('hL').style.width = twoPlayer ? '50%' : '100%';
  $('hR').classList.toggle('hide', !twoPlayer);
  $('diffSet').style.display = twoPlayer ? 'none' : 'flex';
}
addEventListener('resize', layout);

function setMode(tp) {
  twoPlayer = tp;
  layout();
  socket.emit('game:mode', { ai: !tp });
  $('b1').classList.toggle('on', !tp);
  $('b2').classList.toggle('on', tp);
}

// ============================================================
// 主循环
// ============================================================
let lastT = performance.now();
let timeAcc = 0;
function frame(now) {
  const rawDt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;

  // 顿帧：击球瞬间整个世界慢下来，力量感更真实
  const dt = hitStop > 0 ? rawDt * 0.18 : rawDt;
  timeAcc += dt;

  if (S) {
    // 球位置：先按速度外推，再拉回服务器权威位置
    const k = 1 - Math.exp(-16 * dt);
    smoothBall.x += smoothBall.vx * dt;
    smoothBall.y += smoothBall.vy * dt;
    smoothBall.z += smoothBall.vz * dt;
    smoothBall.x += (S.ball.x - smoothBall.x) * k;
    smoothBall.y += (S.ball.y - smoothBall.y) * k;
    smoothBall.z += (S.ball.z - smoothBall.z) * k;
    smoothBall.vx = S.ball.vx; smoothBall.vy = S.ball.vy; smoothBall.vz = S.ball.vz;

    updatePlayers(dt);
    updateShuttle(dt);
    updateCameras(rawDt);
    updateHud(S);
  } else {
    updateCameras(rawDt);
  }

  updateFx(rawDt);

  const w = innerWidth, h = innerHeight;
  if (twoPlayer) {
    const hw = Math.floor(w / 2);
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, hw, h);
    renderer.setScissor(0, 0, hw, h);
    camL.aspect = hw / h;
    camL.updateProjectionMatrix();
    renderer.render(scene, camL);

    renderer.setViewport(hw, 0, w - hw, h);
    renderer.setScissor(hw, 0, w - hw, h);
    camR.aspect = (w - hw) / h;
    camR.updateProjectionMatrix();
    renderer.render(scene, camR);
    renderer.setScissorTest(false);
  } else {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    camL.aspect = w / h;
    camL.updateProjectionMatrix();
    renderer.render(scene, camL);
  }

  requestAnimationFrame(frame);
}

layout();
requestAnimationFrame(frame);

// ============================================================
// 键盘
// ============================================================
const pressed = new Set();
let dir1 = 0, dir2 = 0;
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (e.code === 'Space') {
    e.preventDefault();
    if (!pressed.has('space')) {
      pressed.add('space');
      socket.emit('game:swing', { side: 'left', power: 0.55 + Math.random() * 0.4, dir: dir1 });
    }
  }
  if (e.code === 'Enter') {
    e.preventDefault();
    if (!pressed.has('enter')) {
      pressed.add('enter');
      socket.emit('game:swing', { side: 'right', power: 0.55 + Math.random() * 0.4, dir: dir2 });
    }
  }
  pressed.add(k);
  dir1 = (pressed.has('d') ? 1 : 0) - (pressed.has('a') ? 1 : 0);
  dir2 = (pressed.has('l') ? 1 : 0) - (pressed.has('j') ? 1 : 0);
});
addEventListener('keyup', (e) => {
  pressed.delete(e.key.toLowerCase());
  if (e.code === 'Space') pressed.delete('space');
  if (e.code === 'Enter') pressed.delete('enter');
  dir1 = (pressed.has('d') ? 1 : 0) - (pressed.has('a') ? 1 : 0);
  dir2 = (pressed.has('l') ? 1 : 0) - (pressed.has('j') ? 1 : 0);
});

// ============================================================
// 按钮 / 二维码 / 开场
// ============================================================
// 电脑难度：简单 / 中等 / 困难
let aiLevel = localStorage.getItem('bm3_ai') || 'normal';
if (!['easy', 'normal', 'hard'].includes(aiLevel)) aiLevel = 'normal';
function paintDiff() {
  document.querySelectorAll('button.diff').forEach((b) => b.classList.toggle('on', b.dataset.lv === aiLevel));
}
document.querySelectorAll('button.diff').forEach((b) => {
  b.onclick = () => {
    aiLevel = b.dataset.lv;
    localStorage.setItem('bm3_ai', aiLevel);
    paintDiff();
    socket.emit('game:difficulty', { level: aiLevel });
    showToast('电脑难度 · ' + b.textContent);
  };
});
paintDiff();
socket.on('connect', () => socket.emit('game:difficulty', { level: aiLevel }));

$('b1').onclick = () => setMode(false);
$('b2').onclick = () => setMode(true);
$('brs').onclick = () => socket.emit('game:restart');
$('bqr').onclick = () => {
  // 每次打开都重新读网卡：蓝牙网络共享可能刚连上
  if ($('qrPanel').classList.toggle('on')) loadQr();
};
$('bsnd').onclick = () => {
  soundOn = !soundOn;
  $('bsnd').textContent = soundOn ? '声音开' : '声音关';
  if (soundOn) { ensureAudio(); tone(880, 0.08, 0.04); }
};
$('go').onclick = () => {
  $('start').classList.add('off');
  ensureAudio();
};
document.addEventListener('click', () => ensureAudio(), { once: true });

// 二维码：支持多网卡切换（WiFi / 蓝牙网络共享 / 手机热点）
let ctrlUrl = `https://${location.hostname}:3543/ctrl`;
let ctrlHost = localStorage.getItem('bm3_host') || '';
let netAddrs = [];

function fillQr(url, svg) {
  $('qurl').textContent = url;
  $('qurlPanel').textContent = url;
  $('qrbox').innerHTML = svg;
  $('qrboxPanel').innerHTML = svg;
}

function renderAddrPick() {
  for (const id of ['addrPickStart', 'addrPickPanel']) {
    const wrap = $(id);
    wrap.innerHTML = '';
    // 只有一个地址时不显示切换条
    if (netAddrs.length < 2) continue;
    for (const a of netAddrs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.name;
      b.title = a.address;
      b.className = a.address === ctrlHost ? 'on' : '';
      b.onclick = () => {
        ctrlHost = a.address;
        localStorage.setItem('bm3_host', ctrlHost);
        renderAddrPick();
        loadQr();
      };
      wrap.appendChild(b);
    }
  }
}

function loadQr() {
  fetch('/api/net')
    .then((r) => r.json())
    .then((n) => {
      netAddrs = (n.addrs && n.addrs.length) ? n.addrs : [{ address: n.lanIP, name: 'WLAN' }];
      // 记住的地址已失效（换了网），回退到第一个
      if (!netAddrs.some((a) => a.address === ctrlHost)) ctrlHost = netAddrs[0].address;
      renderAddrPick();
      ctrlUrl = `https://${ctrlHost}:${n.https}/ctrl`;
      return fetch('/api/qr?text=' + encodeURIComponent(ctrlUrl));
    })
    .then((r) => r.text())
    .then((svg) => fillQr(ctrlUrl, svg))
    .catch(() => {});
}
loadQr();
