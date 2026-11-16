import * as THREE from 'three';
import { PlayerView, loadPlayerGLTF, shadowTexture } from './player.js';
import { getCharacter } from './characters.js';
import { STRING_HALF_LENGTH, STRING_HALF_WIDTH } from './contact-racket.js';

const rearPhase = { split: '分腿启动', crossover: '后交叉步', confirm: '确认步', lunge: '蹬跨', plant: '支撑脚落地', recover: '蹬地回中' };
const $ = id => document.getElementById(id);
const canvas = $('court');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.setClearColor(0x132f2e);
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, .1, 60);
scene.add(new THREE.HemisphereLight(0xfff5df, 0x456760, 2.8));
const sun = new THREE.DirectionalLight(0xfff1d2, 2.5);
sun.position.set(-4, 8, -2);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -8, right: 8, bottom: -8, top: 8 });
sun.shadow.normalBias = .025;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(6.12, 13.4), new THREE.MeshStandardMaterial({ color: 0x25534a }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const lineMaterial = new THREE.LineBasicMaterial({ color: 0x9bbeab });
const vec = p => new THREE.Vector3(p.x, p.y, p.z);
function line(points, material = lineMaterial) {
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
}
for (const x of [-3.06, -2.59, 2.59, 3.06]) scene.add(line([new THREE.Vector3(x,.012,-6.7),new THREE.Vector3(x,.012,6.7)]));
for (const z of [-6.7, -1.98, 0, 1.98, 6.7]) scene.add(line([new THREE.Vector3(-3.06,.012,z),new THREE.Vector3(3.06,.012,z)]));
const net = new THREE.Mesh(new THREE.PlaneGeometry(6.1, .76, 60, 8), new THREE.MeshBasicMaterial({ color: 0xb2cbb5, wireframe: true, transparent: true, opacity: .16 }));
net.position.y = 1.17;
scene.add(net, line([new THREE.Vector3(-3.07,1.55,0),new THREE.Vector3(3.07,1.55,0)], new THREE.LineBasicMaterial({color:0xf1f6dd})));
const shuttle = new THREE.Group();
const cork = new THREE.Mesh(new THREE.SphereGeometry(.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfffdeb }));
const skirt = new THREE.Mesh(new THREE.ConeGeometry(.061,.13,12,1,true), new THREE.MeshBasicMaterial({ color: 0xe8f3bd, side: THREE.DoubleSide, wireframe: true }));
skirt.rotation.z = -Math.PI / 2;
skirt.position.x = -.085;
shuttle.add(cork, skirt);
scene.add(shuttle);
const face = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 32 }, (_, i) => {
  const a = i / 32 * Math.PI * 2;
  return new THREE.Vector3(STRING_HALF_WIDTH * Math.cos(a), STRING_HALF_LENGTH * Math.sin(a), 0);
})), new THREE.LineBasicMaterial({ color: 0xf5fc9a, depthTest: false, transparent: true, opacity: .85 }));
face.visible = false;
scene.add(face);
const contactMark = new THREE.Mesh(new THREE.SphereGeometry(.045, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffa06d, depthTest: false }));
contactMark.visible = false;
scene.add(contactMark);
const trails = new THREE.Group();
scene.add(trails);
const incoming = new THREE.LineBasicMaterial({ color: 0x85bbd2, transparent: true, opacity: .65 });
const outgoing = new THREE.LineBasicMaterial({ color: 0xebfd7e });
const shadow = shadowTexture();
const character = getCharacter('young-man');
const asset = await loadPlayerGLTF(character.modelUrl);
let view, replay, index = 0, applied = -1, generation = 0, paused = true, manual = false, cameraMode = 0, loading = false;
let last = performance.now(), elapsed = 0;

function resetPlayer() {
  view?.dispose();
  view = new PlayerView(asset, { character, accent: 0xc2dd73, shadowTex: shadow });
  view.addTo(scene);
  applied = -1;
}

function showFrame(tick) {
  index = tick;
  if (tick < applied) resetPlayer();
  while (applied < tick) {
    const f = replay.frames[++applied];
    view.update(replay.dt, f.player, f.ball);
  }
  const { ball, racket, player } = replay.frames[tick];
  shuttle.position.copy(vec(ball));
  const flight = new THREE.Vector3(ball.vx, ball.vy, ball.vz);
  if (flight.lengthSq() > .01) shuttle.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), flight.normalize());
  const impact = replay.impact;
  const onContact = impact?.tick === tick;
  const pose = onContact ? replay.frames[tick].player.stroke?.contactPose || racket : racket;
  face.visible = Boolean(pose && (onContact || Math.abs(replay.frames[tick].player.stroke.age - .14) < .08));
  if (face.visible) {
    const shaft = vec(pose.shaft), normal = vec(pose.normal);
    face.position.copy(vec(pose.center));
    face.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(shaft.clone().cross(normal), shaft, normal));
  }
  contactMark.visible = Boolean(onContact);
  if (onContact) contactMark.position.copy(vec(impact));
  $('time').value = tick;
  $('clock').value = `${(tick * replay.dt).toFixed(2)} s`;
  const hit = impact && tick >= impact.tick;
  $('status').textContent = tick === replay.frames.length - 1
    ? manual ? '球已落地，重新喂球再试' : replay.result
    : player.rearMove?.phase === 'recover' ? rearPhase.recover
    : hit ? `已触球${impact.variant === 'backhand' ? ' · 反手' : impact.variant ? ' · 正手' : ''}`
      : replay.trigger >= 0 && tick >= replay.trigger ? '正在挥拍' : rearPhase[player.rearMove?.phase] || '自动跑位';
  $('contact').textContent = hit ? `${impact.y.toFixed(2)} m 高` : '—';
  $('velocity').textContent = hit ? `${Math.round(impact.speed * 3.6)} km/h` : '—';
  const crossed = replay.net && tick >= replay.net.tick;
  $('net').textContent = crossed ? replay.net.fault ? '触网' : `${Math.round(replay.net.clearance * 100)} cm` : '—';
  $('swing').disabled = loading || !manual || paused || tick >= replay.frames.length - 1;
}

function setPaused(value) {
  paused = value;
  $('play').textContent = value ? '播放' : '暂停';
  $('swing').disabled = loading || !manual || paused || !replay || index >= replay.frames.length - 1;
}

async function load(timing, start = 0) {
  const request = ++generation;
  const query = new URLSearchParams({ timing, shot: $('shot').value, feed: $('feed').value,
    direction: $('direction').value, legacy: $('legacy').value });
  loading = true;
  setPaused(true);
  $('status').textContent = '正在计算回放…';
  try {
    const response = await fetch(`/api/shot-replay?${query}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (request !== generation) return;
    replay = result;
    manual = timing === 'wait';
    loading = false;
    elapsed = 0;
    resetPlayer();
    $('time').max = replay.frames.length - 1;
    $('impact').disabled = !replay.impact;
    for (const trail of [...trails.children]) { trails.remove(trail); trail.geometry.dispose(); }
    if (!manual) {
      const split = replay.impact?.tick ?? replay.frames.length - 1;
      trails.add(line(replay.frames.slice(0, split + 1).map(f => vec(f.ball)), incoming));
      if (replay.impact) trails.add(line(replay.frames.slice(split).map(f => vec(f.ball)), outgoing));
    }
    showFrame(Math.min(start, replay.frames.length - 1));
    setPaused(false);
  } catch {
    if (request !== generation) return;
    loading = false;
    $('status').textContent = '回放加载失败，请重试喂球';
  }
}

function swing() {
  if (!manual || loading || paused || $('swing').disabled) return;
  load(index - replay.suggested, index);
}
$('swing').onclick = swing;
$('feedBall').onclick = () => load('wait');
$('play').onclick = () => {
  if (!replay || loading) return;
  if (paused && index === replay.frames.length - 1) showFrame(0);
  setPaused(!paused);
};
$('impact').onclick = () => { if (replay?.impact) { setPaused(true); setCamera(2); showFrame(replay.impact.tick); } };
$('time').oninput = () => { if (replay && !loading) { setPaused(true); showFrame(Number($('time').value)); } };
function setCamera(mode) {
  cameraMode = mode;
  $('camera').textContent = ['切换俯视', '切换近景', '切换全场'][mode];
}
$('camera').onclick = () => setCamera((cameraMode + 1) % 3);
function updateFeedLabels() {
  const labels = $('shot').value === 'net'
    ? ['反手网前', '正手网前', '边线网前']
    : $('shot').value === 'slice' ? ['反手后场', '更低来球', '远侧边线']
    : $('shot').value === 'drive' ? ['正手后场', '更低来球', '远侧边线'] : ['中路高球', '右侧高球', '左侧后场'];
  for (const [i, option] of [...$('feed').options].entries()) option.textContent = labels[i];
}
for (const id of ['shot', 'feed', 'direction', 'legacy']) $(id).onchange = () => {
  updateFeedLabels();
  load(0);
};
for (const button of document.querySelectorAll('[data-timing]')) button.onclick = () => load(Number(button.dataset.timing));
window.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || event.target.closest?.('button, select, input')) return;
  if (!manual) return;
  event.preventDefault();
  swing();
});

function frame(now) {
  const dt = Math.min(.08, (now - last) / 1000);
  last = now;
  if (!paused && replay) {
    elapsed += dt * Number($('speed').value);
    const ticks = Math.floor(elapsed / replay.dt);
    if (ticks) {
      elapsed -= ticks * replay.dt;
      showFrame(Math.min(index + ticks, replay.frames.length - 1));
      if (index === replay.frames.length - 1) setPaused(true);
    }
  }
  const { width, height } = canvas.getBoundingClientRect();
  const ratio = renderer.getPixelRatio();
  if (canvas.width !== Math.floor(width * ratio) || canvas.height !== Math.floor(height * ratio)) renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  const small = camera.aspect < 1.12;
  if (cameraMode === 2 && replay) {
    const { player } = replay.frames[index];
    const offset = player.x > 0 ? 1 : -1;
    camera.position.set(player.x + offset * (small ? 4.7 : 3.5), 2.35, player.z + 2.35);
    camera.lookAt(player.x, 1.27, player.z + .35);
  } else {
    if (cameraMode === 1) camera.position.set(.01, small ? 20 : 17, .05);
    else camera.position.set(small ? 14 : 11, small ? 10 : 8.5, 9);
    camera.lookAt(0, .65, -.9);
  }
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
const requested = new URLSearchParams(location.search).get('shot');
if (['net', 'smash', 'drive', 'slice'].includes(requested)) $('shot').value = requested;
updateFeedLabels();
load(0);
requestAnimationFrame(frame);
