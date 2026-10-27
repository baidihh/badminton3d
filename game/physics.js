// 羽毛球弹道与碰撞几何：纯函数，无状态
import { G, DRAG, SUB_DT, clamp } from './constants.js';

export function integrate(b, dt) {
  const n = clamp(Math.ceil(dt / SUB_DT), 1, 8);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    const k = DRAG * sp;
    b.vx -= k * b.vx * h;
    b.vy -= (k * b.vy + G) * h;
    b.vz -= k * b.vz * h;
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.z += b.vz * h;
  }
}

/** 用给定初速度模拟 T 秒，返回落点与过网高度 */
export function simBall(x0, y0, z0, vx, vy, vz, T, steps = 36) {
  const h = T / steps;
  let x = x0, y = y0, z = z0;
  let yNet = null;
  for (let i = 0; i < steps; i++) {
    const sp = Math.hypot(vx, vy, vz);
    const k = DRAG * sp;
    vx -= k * vx * h;
    vy -= (k * vy + G) * h;
    vz -= k * vz * h;
    const pz = z;
    const py = y;
    x += vx * h; y += vy * h; z += vz * h;
    if (yNet === null && ((pz < 0) !== (z < 0)) && Math.abs(z - pz) > 1e-6) {
      const f = (0 - pz) / (z - pz);
      yNet = py + (y - py) * f;
    }
  }
  return { x, y, z, vx, vy, vz, yNet };
}

/** 反求初速度：让球在 T 秒后落到 (tx, 0, tz)，牛顿迭代 + 数值雅可比 */
export function solveLaunch(b, tx, tz, T) {
  let vx = (tx - b.x) / T;
  let vz = (tz - b.z) / T;
  let vy = (0 - b.y) / T + 0.5 * G * T;
  let last = null;
  const err = (ax, ay, az) => {
    const r = simBall(b.x, b.y, b.z, ax, ay, az, T);
    return { ex: r.x - tx, ey: r.y, ez: r.z - tz, r };
  };
  for (let it = 0; it < 7; it++) {
    const e = err(vx, vy, vz);
    last = e.r;
    if (Math.abs(e.ex) + Math.abs(e.ey) + Math.abs(e.ez) < 0.02) break;
    const d = 0.08;
    const a = err(vx + d, vy, vz);
    const c = err(vx, vy + d, vz);
    const g = err(vx, vy, vz + d);
    const j11 = (a.ex - e.ex) / d, j12 = (c.ex - e.ex) / d, j13 = (g.ex - e.ex) / d;
    const j21 = (a.ey - e.ey) / d, j22 = (c.ey - e.ey) / d, j23 = (g.ey - e.ey) / d;
    const j31 = (a.ez - e.ez) / d, j32 = (c.ez - e.ez) / d, j33 = (g.ez - e.ez) / d;
    const det = det3(j11, j12, j13, j21, j22, j23, j31, j32, j33);
    if (Math.abs(det) < 1e-9) break;
    const bx = -e.ex, by = -e.ey, bz = -e.ez;
    const dx = det3(bx, j12, j13, by, j22, j23, bz, j32, j33) / det;
    const dy = det3(j11, bx, j13, j21, by, j23, j31, bz, j33) / det;
    const dz = det3(j11, j12, bx, j21, j22, by, j31, j32, bz) / det;
    vx += dx * 0.7; vy += dy * 0.7; vz += dz * 0.7;
  }
  return { vx, vy, vz, netY: last ? last.yNet : null };
}

export function det3(a, b, c, d, e, f, g, h, i) {
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/** 点到线段最短距离：用于挥拍扫掠碰撞，避免高速穿过球 */
export function segPointDist(x1, y1, z1, x2, y2, z2, px, py, pz) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 1e-9 ? ((px - x1) * dx + (py - y1) * dy + (pz - z1) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = x1 + dx * t, cy = y1 + dy * t, cz = z1 + dz * t;
  return Math.hypot(px - cx, py - cy, pz - cz);
}
