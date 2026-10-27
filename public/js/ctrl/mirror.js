// 手机端 3D 姿态镜：手机 + 球拍实时跟随
import * as THREE from 'three';
import { SENS } from './sens.js';

const $ = (id) => document.getElementById(id);

// ============================================================
// 3D 姿态镜：手机 + 球拍，实时跟随真实手机
// ============================================================
const mirrorWrap = $('mirrorWrap');
const mirrorCanvas = $('mirror3d');
const mRenderer = new THREE.WebGLRenderer({ canvas: mirrorCanvas, alpha: true, antialias: true });
mRenderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
mRenderer.outputColorSpace = THREE.SRGBColorSpace;

const mScene = new THREE.Scene();
const mCam = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
mCam.position.set(0, 0.28, 2.8);
mCam.lookAt(0, 0.22, 0);

mScene.add(new THREE.HemisphereLight(0xa8d8ff, 0x0a1420, 1.5));
const mKey = new THREE.DirectionalLight(0xffffff, 2.2);
mKey.position.set(1.6, 2.2, 2.4);
mScene.add(mKey);
const mRim = new THREE.DirectionalLight(0x3FD0FF, 1.4);
mRim.position.set(-1.8, 0.6, -1.2);
mScene.add(mRim);

// 地面光晕
{
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.48, 48),
    new THREE.MeshBasicMaterial({ color: 0x3FD0FF, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.46;
  mScene.add(ring);
}

const phoneGroup = new THREE.Group();
mScene.add(phoneGroup);

// 手机
{
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x16232f, roughness: 0.34, metalness: 0.55 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.7, 0.045), bodyMat);
  phoneGroup.add(body);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.33, 0.7, 0.045)),
    new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.5 })
  );
  phoneGroup.add(edge);

  const [sc, sg] = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    return [c, c.getContext('2d')];
  })();
  const grad = sg.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#0a2a3d');
  grad.addColorStop(0.55, '#061420');
  grad.addColorStop(1, '#04101a');
  sg.fillStyle = grad; sg.fillRect(0, 0, 256, 512);
  sg.strokeStyle = 'rgba(63,208,255,.5)'; sg.lineWidth = 2;
  sg.strokeRect(10, 10, 236, 492);
  sg.fillStyle = 'rgba(63,208,255,.2)';
  sg.fillRect(24, 30, 208, 56);
  sg.fillStyle = 'rgba(200,240,255,.72)';
  sg.font = '600 22px Inter, sans-serif';
  sg.fillText('MOTION', 34, 62);
  sg.font = '11px Inter, sans-serif';
  sg.fillStyle = 'rgba(160,210,240,.45)';
  sg.fillText('READY', 34, 79);
  // 挥拍轨迹示意
  sg.strokeStyle = 'rgba(63,208,255,.35)'; sg.lineWidth = 3;
  sg.beginPath(); sg.arc(128, 300, 76, Math.PI * 0.9, Math.PI * 2.1); sg.stroke();
  sg.fillStyle = 'rgba(255,255,255,.85)';
  sg.beginPath(); sg.arc(128, 300, 7, 0, Math.PI * 2); sg.fill();
  sg.fillStyle = 'rgba(120,200,240,.35)';
  sg.fillRect(24, 430, 208, 3);
  sg.fillRect(24, 444, 150, 3);
  const screenTex = new THREE.CanvasTexture(sc);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.29, 0.64),
    new THREE.MeshBasicMaterial({ map: screenTex })
  );
  screen.position.z = 0.0235;
  phoneGroup.add(screen);

  const notch = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.012, 0.008),
    new THREE.MeshStandardMaterial({ color: 0x05090d, roughness: 0.5 })
  );
  notch.position.set(0, 0.338, 0.025);
  phoneGroup.add(notch);

  for (const sx of [-1, 1]) {
    const key = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.07, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x2a3b4c, roughness: 0.4 })
    );
    key.position.set(sx * 0.17, 0.18, 0);
    phoneGroup.add(key);
  }
}

// 手机顶端的球拍
{
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x1c2835, roughness: 0.32, metalness: 0.6 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfe0f0, roughness: 0.25, metalness: 0.9 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0x3FD0FF, roughness: 0.4, emissive: 0x3FD0FF, emissiveIntensity: 1.1,
  });
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.013, 0.12, 10), accentMat);
  grip.position.y = 0.41;
  phoneGroup.add(grip);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.006, 0.2, 8), chrome);
  shaft.position.y = 0.56;
  phoneGroup.add(shaft);
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.0065, 8, 36), glowMat);
  frame.position.y = 0.76;
  frame.scale.set(0.92, 1.18, 1);
  phoneGroup.add(frame);
  const strings = new THREE.Mesh(
    new THREE.PlaneGeometry(0.17, 0.21),
    new THREE.MeshBasicMaterial({
      color: 0xDFF6FF, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false,
    })
  );
  strings.position.y = 0.76;
  strings.position.z = 0.001;
  phoneGroup.add(strings);
}

// 校准参考幽灵
const ghost = new THREE.Group();
{
  const gPhone = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.35, 0.73, 0.05)),
    new THREE.LineBasicMaterial({ color: 0x3FD0FF, transparent: true, opacity: 0.18 })
  );
  ghost.add(gPhone);
  const gRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.095, 0.003, 6, 30),
    new THREE.MeshBasicMaterial({ color: 0x3FD0FF, transparent: true, opacity: 0.12 })
  );
  gRing.position.y = 0.76;
  gRing.scale.set(0.92, 1.18, 1);
  ghost.add(gRing);
}
// 手机与球拍整体稍放大，便于看清手屏同步
phoneGroup.scale.setScalar(1.12);
ghost.scale.setScalar(1.12);
mScene.add(ghost);

let mirrorVisible = false;

function resizeMirror() {
  const w = mirrorWrap.clientWidth, h = mirrorWrap.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (mirrorCanvas.width !== Math.floor(w * dpr) || mirrorCanvas.height !== Math.floor(h * dpr)) {
    mRenderer.setSize(w, h, false);
    mCam.aspect = w / h;
    mCam.updateProjectionMatrix();
  }
}
function renderMirror(dt) {
  if (!mirrorVisible) return;
  resizeMirror();
  phoneGroup.quaternion.slerp(SENS.qMirror, 1 - Math.exp(-16 * dt));
  mRenderer.render(mScene, mCam);
}
function mountMirror(parent, tall) {
  if (mirrorWrap.parentElement !== parent) parent.appendChild(mirrorWrap);
  mirrorWrap.classList.toggle('tall', !!tall);
  mirrorWrap.classList.remove('hidden');
  mirrorVisible = true;
  setTimeout(resizeMirror, 30);
}

export { mountMirror, renderMirror, resizeMirror };