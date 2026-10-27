// 前半球落点雷达
import { SENS } from './sens.js';
import { clamp, D2R } from './util.js';
const $ = (id) => document.getElementById(id);

// ============================================================
// 前半球瞄准雷达
// ============================================================
const aimCanvas = $('aim');
const actx = aimCanvas.getContext('2d');

function sizeAimCanvas() {
  const w = aimCanvas.clientWidth, h = aimCanvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  aimCanvas.width = Math.floor(w * dpr);
  aimCanvas.height = Math.floor(h * dpr);
  actx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', sizeAimCanvas);

const aimPt = (az, el, cx, cy, R) => {
  const a = Math.PI * 1.5 + clamp(az, -1.75, 1.75);
  const r = R * (0.45 + 0.5 * clamp((el + 0.7) / 1.4, 0, 1));
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
};

function drawAim() {
  const w = aimCanvas.clientWidth, h = aimCanvas.clientHeight;
  if (!w || !h) return;
  const cx = w / 2, cy = h - 12, R = Math.min(w / 2 - 12, h - 20);
  actx.clearRect(0, 0, w, h);

  if (!SENS.hasOrient) {
    actx.fillStyle = 'rgba(255,255,255,.28)';
    actx.font = '11px sans-serif';
    actx.textAlign = 'center';
    actx.fillText('无方向传感器 · 仅识别挥动幅度', cx, cy - 22);
    return;
  }

  // 底盘 + 三个落点区域
  actx.beginPath();
  actx.arc(cx, cy, R, Math.PI, Math.PI * 2);
  actx.strokeStyle = 'rgba(255,255,255,.10)';
  actx.lineWidth = 1;
  actx.stroke();

  for (const [a0, a1, alpha] of [[-100, -33, 0.10], [-33, 33, 0.20], [33, 100, 0.10]]) {
    actx.beginPath();
    actx.moveTo(cx, cy);
    actx.arc(cx, cy, R, Math.PI * 1.5 + a0 * D2R, Math.PI * 1.5 + a1 * D2R);
    actx.closePath();
    actx.fillStyle = `rgba(63,208,255,${alpha})`;
    actx.fill();
  }

  actx.beginPath();
  actx.moveTo(cx, cy);
  actx.lineTo(cx, cy - R);
  actx.strokeStyle = 'rgba(160,230,255,.3)';
  actx.stroke();

  // 挥拍轨迹
  const hist = SENS.aimHist;
  if (hist.length > 1) {
    for (let i = 1; i < hist.length; i++) {
      const a = (i / hist.length) * 0.85;
      const p0 = aimPt(hist[i - 1].az, hist[i - 1].el, cx, cy, R);
      const p1 = aimPt(hist[i].az, hist[i].el, cx, cy, R);
      actx.beginPath();
      actx.moveTo(p0[0], p0[1]);
      actx.lineTo(p1[0], p1[1]);
      actx.strokeStyle = `rgba(140,225,255,${a})`;
      actx.lineWidth = 2.4;
      actx.lineCap = 'round';
      actx.stroke();
    }
  }

  // 当前瞄准点
  const [px, py] = aimPt(SENS.azF, SENS.el, cx, cy, R);
  const grad = actx.createRadialGradient(px, py, 0, px, py, 13);
  grad.addColorStop(0, 'rgba(220,250,255,.95)');
  grad.addColorStop(0.4, 'rgba(63,208,255,.55)');
  grad.addColorStop(1, 'rgba(63,208,255,0)');
  actx.fillStyle = grad;
  actx.beginPath();
  actx.arc(px, py, 13, 0, Math.PI * 2);
  actx.fill();
  actx.fillStyle = '#EAFBFF';
  actx.beginPath();
  actx.arc(px, py, 3.2, 0, Math.PI * 2);
  actx.fill();

  // 文字标注
  actx.font = '10px sans-serif';
  actx.fillStyle = 'rgba(200,228,245,.42)';
  actx.textAlign = 'center';
  actx.fillText('左', cx - R * 0.88, cy - 4);
  actx.fillText('右', cx + R * 0.88, cy - 4);
  actx.fillText('前', cx, cy - R - 5);
  actx.textAlign = 'left';
  actx.fillText('落点指示', 10, 14);
  actx.textAlign = 'right';
  actx.fillText('超出范围自动限位', w - 10, 14);
}

export { drawAim, sizeAimCanvas };