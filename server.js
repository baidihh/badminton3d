import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

const HTTP_PORT = Number(process.env.PORT || 3100);
const HTTPS_PORT = Number(process.env.PORT_HTTPS || 3543);

const LAN_IP = (() => {
  const ifaces = os.networkInterfaces();
  const order = ['en0', 'en1', 'en2', 'wlan0', 'eth0'];
  for (const name of order) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return '127.0.0.1';
})();

// ---------- 3D 世界常量（单位：米）----------
const HALF_W = 3.0;          // 场地半宽（x）
const HALF_L = 6.7;          // 半场长度（z）
const NET_H = 1.55;          // 网高
const NET_HALF_W = 3.1;
const G = 9.8;               // 重力
const K = 0.75;              // 线性空气阻力（羽毛球的灵魂）
const HIT_R = 0.98;          // 球拍可及半径
const WIN_SCORE = 7;

const RAISE_SPEED = 4.2;     // 抬拍到位速度 m/s

// 跑位系统
const MOVE_SPEED = 3.6;      // 最大移动速度 m/s
const MOVE_ACCEL = 16;       // 加速响应
const COURT_X = 2.9;         // 左右边界
const CATCH_BEHIND = 0.55;   // 站到球后侧的距离

const PLAYER_Z = 4.6;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const moveTo = (cur, target, maxStep) => {
  const d = target - cur;
  return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep;
};
const rand = (a, b) => a + Math.random() * (b - a);

// 线性阻力下的位移与速度解析解（每步精确，不会数值爆炸）
function integrate(b, dt) {
  const e = Math.exp(-K * dt);
  const gk = G / K;
  b.x += (b.vx / K) * (1 - e);
  b.z += (b.vz / K) * (1 - e);
  b.vx *= e;
  b.vz *= e;
  const vyk = b.vy + gk;
  b.y += (vyk / K) * (1 - e) - gk * dt;
  b.vy = vyk * e - gk;
}

// 球飞到网面（z=0）时的高度；用于杀球/吊球的过网保护
function netCrossY(b, vy, vz) {
  if (Math.abs(vz) < 1e-4) return Infinity;
  const u = 1 + (b.z * K) / vz;
  if (!(u > 0 && u < 1)) return Infinity;
  const t = -Math.log(u) / K;
  return b.y + ((vy + G / K) / K) * (1 - u) - (G / K) * t;
}

const SHOT_TYPES = new Set(['clear', 'drop', 'smash']);

// 三档电脑难度：反应、失误率、跑位速度、球路配比、压空当程度、力量区间
const AI_LEVELS = {
  easy: { react: 0.38, miss: 0.35, speed: 0.78, mix: [0.84, 0.12, 0.04], aim: 0.12, power: [0.30, 0.66] },
  normal: { react: 0.23, miss: 0.18, speed: 0.96, mix: [0.56, 0.20, 0.24], aim: 0.55, power: [0.42, 0.88] },
  hard: { react: 0.12, miss: 0.05, speed: 1.10, mix: [0.40, 0.18, 0.42], aim: 0.95, power: [0.58, 1.00] },
};

class Game {
  constructor() {
    this.aiLevel = 'normal';
    this.hardReset();
    this.setDifficulty('normal');
  }

  setDifficulty(level) {
    const key = AI_LEVELS[level] ? level : 'normal';
    const d = AI_LEVELS[key];
    this.aiLevel = key;
    this.aiReaction = d.react;
    this.aiMissChance = d.miss;
    this.aiSpeed = d.speed;
    this.aiMix = d.mix;
    this.aiAim = d.aim;
    this.aiPower = d.power;
  }

  hardReset() {
    this.t = 0;
    this.left = this.makePlayer('left');
    this.right = this.makePlayer('right');
    this.right.ai = true;
    this.right.name = '电脑';
    this.ball = { x: 0, y: 2.4, z: -3.0, vx: 0, vy: 0, vz: 0 };
    this.phase = 'serve';
    this.serverSide = 'left';
    this.rally = 0;
    this.phaseTimer = 0;
    this.serveMisses = 0;
    this.msg = '';
    this.holder = null;
    this.impact = { x: 0, y: 0, z: 0, power: 0 };
    this.aiPlan = null;
    this.started = false;
    this.doService();
    this.msg = '挥拍或按空格开始';
    this.lastBallZ = this.ball.z;
  }

  makePlayer(side) {
    return {
      side,
      sign: side === 'left' ? -1 : 1,
      x: 0,
      y: 1.1,
      z: side === 'left' ? -PLAYER_Z : PLAYER_Z,
      armedUntil: 0,
      pending: null,
      dir: 0,
      score: 0,
      connected: false,
      flash: 0,
      name: side === 'left' ? '玩家 1' : '玩家 2',
      ai: false,
      hand: 'right',     // 持拍手：right / left
      pose: null,        // 手机相对姿态四元数 [x,y,z,w]
      poseAt: 0,
      swingId: 0,
      lastGrade: '',
      // 跑位：当前由电脑控制（stepMove 接收任意方向，后续可接人类输入）
      mvx: 0,
      mvz: 0,
    };
  }

  restart() {
    this.left.score = 0;
    this.right.score = 0;
    this.phase = 'serve';
    this.msg = '';
    this.started = true;
    this.doService();
  }

  doService() {
    const s = this.serverSide === 'left' ? this.left : this.right;
    this.phase = 'serve';
    this.phaseTimer = 0;
    this.serveMisses = 0;
    this.serveClock = 0;
    this.aiPlan = null;
    this.rally = 0;
    this.holder = null;
    this.ball.x = s.x * 0.5;
    this.ball.y = 2.5;
    this.ball.z = s.z * 0.85;
    this.ball.vx = rand(-0.2, 0.2);
    this.ball.vy = 0;
    this.ball.vz = rand(-0.2, 0.2);
    s.armedUntil = 0;
    this.msg = `${s.name} 发球`;
  }

  swing(side, power = 0.7, dir = 0, lift = 0.5, shot = 'clear') {
    if (!this.started) {
      // 第一次挥拍 = 开球
      this.started = true;
      this.msg = '';
    }
    if (this.phase === 'over') {
      this.restart();
      return;
    }
    if (this.phase === 'point') return;
    const p = side === 'left' ? this.left : this.right;
    p.armedUntil = this.t + 0.30;
    p.pending = {
      power: clamp(power, 0, 1),
      dir: clamp(dir, -1, 1),
      lift: clamp(lift, 0, 1),
      shot: SHOT_TYPES.has(shot) ? shot : 'clear',
    };
    p.dir = p.pending.dir;
    p.flash = 1;
    p.swingId++;
  }

  awardPoint(winnerSide, reason) {
    const w = winnerSide === 'left' ? this.left : this.right;
    w.score++;
    this.phase = 'point';
    this.phaseTimer = 0;
    this.rally = 0;
    this.msg = reason;
    this.serverSide = winnerSide;
  }

  onHit(p) {
    const b = this.ball;
    const { power, dir, lift = 0.5, shot: rawShot = 'clear' } = p.pending;
    const d = Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
    const q = clamp(1 - d / HIT_R, 0, 1);          // 甜区质量：越靠近拍面中心越高
    const grade = q > 0.72 ? 'perfect' : q > 0.42 ? 'good' : 'edge';
    const effPower = clamp(power * (0.74 + q * 0.34), 0, 1);

    // 球路类型：低点不能算杀球，其余沿用客户端判定
    let shot = SHOT_TYPES.has(rawShot) ? rawShot : 'clear';
    if (shot === 'smash' && b.y < 1.75) shot = 'clear';

    // 目标落点横向仍由 dir 决定
    const faceSign = p.side === 'left' ? -1 : 1;
    const sign = p.side === 'left' ? 1 : -1;
    const tx = clamp(faceSign * dir * 2.4 + rand(-0.4, 0.4) * (1 - q), -2.75, 2.75);

    // 不同球路：目标深度 + 飞行时间；触球高度也参与
    const contact = clamp((b.y - 1.3) / 1.3, 0, 1);
    let tz, T;
    if (shot === 'drop') {
      const pDrop = effPower * 0.6;
      tz = sign * clamp(1.5 + pDrop * 1.7 + contact * 0.3, 1.5, 3.4);
      T = 1.34 + lift * 0.10 - pDrop * 0.12 - contact * 0.06;
    } else if (shot === 'smash') {
      tz = sign * clamp(3.0 + effPower * 1.8 + contact * 0.7, 3.0, 5.4);
      T = clamp(1.03 - effPower * 0.30 - contact * 0.07, 0.70, 1.0);
    } else {
      tz = sign * clamp(2.0 + effPower * 3.6 + (1 - q) * 0.5, 1.4, 6.2);
      T = 1.52 - effPower * 0.46 + (1 - q) * 0.20 + lift * 0.62 + (1 - contact) * 0.10;
    }

    // 用线性阻力的闭式解反求初速度；过网高度不够就抬高弧线
    let A = 0;
    for (let i = 0; i < 8; i++) {
      A = K / (1 - Math.exp(-K * T));
      b.vx = (tx - b.x) * A;
      b.vz = (tz - b.z) * A;
      b.vy = (0 - b.y + (G / K) * T) * A - G / K;
      if (netCrossY(b, b.vy, b.vz) >= NET_H + 0.08) break;
      T += 0.06;
    }

    this.holder = p.side;
    this.rally++;
    this.impact = {
      x: b.x, y: b.y, z: b.z,
      power: 0.35 + effPower * 0.65,
      id: (this.impact.id || 0) + 1,
      grade, q, side: p.side, lift, shot,
    };
    p.lastGrade = grade;
    p.armedUntil = 0;
    p.pending = null;
    if (this.phase === 'serve') this.phase = 'rally';
    this.msg = '';
    if (this.onHitFx) this.onHitFx(p.side, grade, effPower, p.swingId, shot);
  }

  updateRacket(p, dt) {
    const b = this.ball;
    const onMySide = p.side === 'left' ? b.z < 0 : b.z > 0;
    // 水平位置由跑位系统负责，这里只跟球的高度
    const ty = onMySide ? clamp(b.y, 0.55, 2.75) : 1.15;
    p.y = moveTo(p.y, ty, RAISE_SPEED * dt);
  }

  // 通用位移积分器：任意方向 (dirX, dirZ)，带加速与场地边界
  stepMove(p, dt, dirX, dirZ, speedScale = 1) {
    const len = Math.hypot(dirX, dirZ);
    const ux = len > 1e-4 ? dirX / len : 0;
    const uz = len > 1e-4 ? dirZ / len : 0;
    const maxV = MOVE_SPEED * clamp(speedScale, 0, 1.2);
    const k = Math.min(1, MOVE_ACCEL * dt);
    p.mvx += (ux * maxV - p.mvx) * k;
    p.mvz += (uz * maxV - p.mvz) * k;
    p.x += p.mvx * dt;
    p.z += p.mvz * dt;

    if (p.x < -COURT_X) { p.x = -COURT_X; p.mvx = Math.max(0, p.mvx); }
    if (p.x > COURT_X) { p.x = COURT_X; p.mvx = Math.min(0, p.mvx); }
    const zMin = p.side === 'left' ? -6.35 : 0.9;
    const zMax = p.side === 'left' ? -0.9 : 6.35;
    if (p.z < zMin) { p.z = zMin; p.mvz = Math.max(0, p.mvz); }
    if (p.z > zMax) { p.z = zMax; p.mvz = Math.min(0, p.mvz); }
  }

  // 自动跑位：预判落点，站到球后侧；球不在本方半场就回中场
  autoFootwork(p, dt) {
    const b = this.ball;
    const onMy = p.side === 'left' ? b.z < 0 : b.z > 0;

    let tx, tz;
    if (onMy && this.phase !== 'point') {
      tx = clamp(b.x + b.vx * 0.22, -COURT_X + 0.05, COURT_X - 0.05);
      tz = p.side === 'left' ? b.z - CATCH_BEHIND : b.z + CATCH_BEHIND;
    } else {
      tx = 0;
      tz = p.side === 'left' ? -PLAYER_Z : PLAYER_Z;
    }
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.04) {
      this.stepMove(p, dt, 0, 0, 0);
      return;
    }
    // 接近目标时减速，避免来回抖；电脑按难度调整跑位速度
    const spd = p.ai ? (this.aiSpeed || 1) : 1;
    this.stepMove(p, dt, dx / d, dz / d, clamp(d / 0.9, 0.15, 1) * spd);
  }

  tryHit(p) {
    if (p.armedUntil < this.t || !p.pending) return false;
    const b = this.ball;
    const onMySide = p.side === 'left' ? b.z < 0 : b.z > 0;
    if (!onMySide) return false;
    const d = Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
    if (d > HIT_R) return false;
    this.onHit(p);
    return true;
  }

  /** 发球超时兜底：把球直接送到拍面，强制打出一拍，避免整局卡死 */
  forceServe(p) {
    const b = this.ball;
    b.x = p.x;
    b.y = clamp(p.y, 1.4, 2.7);
    b.z = p.z;
    p.pending = { power: 0.68, dir: rand(-0.2, 0.2), lift: 0.72, shot: 'clear' };
    p.armedUntil = this.t + 0.4;
    p.flash = 1;
    this.onHit(p);
    console.log('[发球超时] 强制发球');
  }

  updateAI(dt) {
    const p = this.right;
    if (!p.ai) return;
    const b = this.ball;

    // 发球：电脑是发球方时直接准备发球，不能等球过网（否则会一直等下去）
    if (this.phase === 'serve' && this.serverSide === 'right') {
      if (!this.aiPlan || !this.aiPlan.serve) {
        this.aiPlan = {
          reactAt: this.t + clamp(this.aiReaction + 0.45, 0.5, 1.1),
          miss: false,
          serve: true,
          shot: 'clear',
        };
      }
      if (this.t < this.aiPlan.reactAt) return;
      if (p.armedUntil > this.t) return;
      const ds = Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
      if (ds < HIT_R) {
        const pw = this.aiPower[0] + (this.aiPower[1] - this.aiPower[0]) * 0.5;
        this.swing('right', pw, rand(-0.3, 0.3), 0.75, 'clear');
        this.aiPlan = null;
        console.log('[电脑发球]');
      }
      return;
    }

    if (b.z > 0 && this.lastBallZ <= 0) {
      // 按难度抽球路：高远 / 吊球 / 杀球
      const mix = this.aiMix;
      const r = Math.random();
      const shot = r < mix[0] ? 'clear' : r < mix[0] + mix[1] ? 'drop' : 'smash';
      this.aiPlan = {
        reactAt: this.t + this.aiReaction,
        miss: Math.random() < this.aiMissChance,
        serve: false,
        shot,
      };
    }
    this.lastBallZ = b.z;

    if (b.z <= 0 || !this.aiPlan) return;
    if (this.t < this.aiPlan.reactAt) return;
    if (p.armedUntil > this.t) return;

    const d = Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
    if (this.aiPlan.miss) {
      // 故意失误：只做挥拍动作，不进入击球判定
      if (d < HIT_R * 1.9) p.flash = 1;
      return;
    }
    if (d < HIT_R * 0.88) {
      const shot = this.aiPlan.shot || 'clear';
      let dir;
      if (this.aiLevel === 'easy') {
        dir = rand(-0.45, 0.45);
      } else {
        // 中等/困难：往玩家反方向的空当压
        const oppX = this.left.x;
        const open = Math.abs(oppX) < 0.35 ? (Math.random() < 0.5 ? -1 : 1) : -Math.sign(oppX);
        dir = clamp(
          open * (0.35 + Math.random() * 0.5) * this.aiAim + rand(-0.4, 0.4) * (1 - this.aiAim),
          -1, 1
        );
      }
      let power;
      let lift;
      if (shot === 'smash') {
        power = rand(0.75, 1);
        lift = rand(0.08, 0.3);
      } else if (shot === 'drop') {
        power = rand(0.2, 0.42);
        lift = rand(0.2, 0.5);
      } else {
        power = rand(this.aiPower[0], this.aiPower[1]);
        lift = rand(0.55, 0.85);
      }
      this.swing('right', power, dir, lift, shot);
      this.aiPlan = null;
      console.log(`[电脑击球] ${shot} 难度=${this.aiLevel}`);
    }
  }

  step(dt) {
    this.t += dt;

    if (!this.started) {
      // 待机：球悬停，两人回到中场，等待第一拍
      this.bob = (this.bob || 0) + dt;
      this.ball.y = 2.5 + Math.sin(this.bob * 2.2) * 0.1;
      this.autoFootwork(this.left, dt);
      this.autoFootwork(this.right, dt);
      this.updateRacket(this.left, dt);
      this.updateRacket(this.right, dt);
      return;
    }
    this.left.flash = Math.max(0, this.left.flash - dt * 2.8);
    this.right.flash = Math.max(0, this.right.flash - dt * 2.8);
    this.impact.power = Math.max(0, this.impact.power - dt * 2.6);

    if (this.phase === 'point') {
      this.phaseTimer += dt;
      if (this.phaseTimer > 1.6) {
        if (this.left.score >= WIN_SCORE || this.right.score >= WIN_SCORE) {
          this.phase = 'over';
          const champ = this.left.score > this.right.score ? this.left : this.right;
          this.msg = `${champ.name} 获胜`;
        } else {
          this.doService();
        }
      }
      return;
    }
    if (this.phase === 'over') return;

    this.autoFootwork(this.left, dt);
    this.autoFootwork(this.right, dt);
    this.updateRacket(this.left, dt);
    this.updateRacket(this.right, dt);
    this.updateAI(dt);

    // 发球超时兜底：电脑发球超过 3.5 秒还没打出去，就强制发球
    if (this.phase === 'serve') {
      this.serveClock = (this.serveClock || 0) + dt;
      if (this.serveClock > 3.5 && this.serverSide === 'right' && this.right.ai) {
        this.forceServe(this.right);
      }
    }

    if (!this.tryHit(this.left)) this.tryHit(this.right);

    // 挥拍窗口结束仍未碰到球 = 漏击，给手机端一个明确的时机反馈
    for (const p of [this.left, this.right]) {
      if (p.pending && this.t > p.armedUntil) {
        p.pending = null;
        p.armedUntil = 0;
        if (this.onMissFx) this.onMissFx(p.side, p.swingId);
      }
    }

    const b = this.ball;
    const prevZ = b.z;

    // 发球阶段球停在发球点等发球方挥拍，不再自己掉落（避免一直“颠球”）
    if (this.phase === 'serve') {
      b.vx = 0; b.vy = 0; b.vz = 0;
      b.y = 2.5;
    } else {
      integrate(b, dt);
    }

    // 侧墙兜底，避免球飞出场景
    if (b.x < -7.5) { b.x = -7.5; b.vx = Math.abs(b.vx) * 0.4; }
    if (b.x > 7.5) { b.x = 7.5; b.vx = -Math.abs(b.vx) * 0.4; }

    // 触网
    if ((prevZ < 0) !== (b.z < 0) && b.y < NET_H + 0.06 && Math.abs(b.x) < NET_HALF_W) {
      const hitter = b.z > 0 ? 'left' : 'right';
      b.vz = -b.vz * 0.25;
      b.vy = Math.abs(b.vy) * 0.2;
      b.z = b.z > 0 ? 0.12 : -0.12;
      if (this.phase === 'serve') {
        this.doService();
      } else {
        this.awardPoint(hitter === 'left' ? 'right' : 'left', '触网');
      }
      return;
    }

    // 落地
    if (b.y <= 0.02) {
      b.y = 0.02;
      if (this.phase === 'serve') {
        this.serveMisses++;
        if (this.serveMisses >= 3) {
          const sign = this.serverSide === 'left' ? 1 : -1;
          const A = K / (1 - Math.exp(-K * 1.35));
          b.vz = sign * 4.8 * A;
          b.vx = rand(-0.4, 0.4);
          b.vy = (0 - b.y + (G / K) * 1.35) * A - G / K;
          this.phase = 'rally';
          this.holder = this.serverSide;
          this.serveMisses = 0;
          this.msg = '自动发球';
        } else {
          this.doService();
        }
        return;
      }
      const landedOn = b.z < 0 ? 'left' : 'right';
      this.awardPoint(landedOn === 'left' ? 'right' : 'left', '落地得分');
      return;
    }
  }

  snapshot() {
    return {
      ball: { x: this.ball.x, y: this.ball.y, z: this.ball.z, vx: this.ball.vx, vy: this.ball.vy, vz: this.ball.vz },
      left: this.pack(this.left),
      right: this.pack(this.right),
      phase: this.phase,
      server: this.serverSide,
      started: this.started,
      msg: this.msg,
      rally: this.rally,
      impact: this.impact,
      winScore: WIN_SCORE,
    };
  }

  pack(p) {
    const fresh = p.pose && Date.now() - p.poseAt < 1500;
    return {
      x: p.x, y: p.y, z: p.z, score: p.score, dir: p.dir,
      connected: p.connected, flash: p.flash, name: p.name, ai: p.ai,
      hand: p.hand,
      pose: fresh ? p.pose : null,
      grade: p.lastGrade,
      vx: p.mvx,
      vz: p.mvz,
    };
  }
}

const game = new Game();

// ---------- 手柄统计 ----------
const ctrlStats = new Map();
const stats = { swingsDetected: 0, motionReports: 0 };

function bumpCtrl(id, patch) {
  const s = ctrlStats.get(id) || {
    id, ip: '', slot: null, motionEvents: 0, swings: 0,
    lastSwingPeak: 0, lastSeen: 0, rate: 0,
  };
  Object.assign(s, patch);
  ctrlStats.set(id, s);
  return s;
}

// ---------- 静态服务 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
};
const ALIAS = { '/': '/index.html', '/ctrl': '/ctrl.html' };

// 静态目录白名单：/vendor → three/build，/addons → three/examples/jsm，/models → GLB
const STATIC_DIRS = {
  '/vendor/': path.join(__dirname, 'node_modules/three/build'),
  '/addons/': path.join(__dirname, 'node_modules/three/examples/jsm'),
  '/models/': path.join(__dirname, 'models'),
};

function serveStatic(base, rel, res) {
  const f = path.join(base, path.normalize(rel));
  if (!f.startsWith(base)) { res.writeHead(403); return res.end('403'); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(f)] || 'application/octet-stream',
      'Cache-Control': 'max-age=3600',
    });
    res.end(data);
  });
}

function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);

  if (p === '/api/net') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ lanIP: LAN_IP, http: HTTP_PORT, https: HTTPS_PORT }));
    return;
  }

  if (p === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true, lanIP: LAN_IP, ports: { http: HTTP_PORT, https: HTTPS_PORT },
      stats, phase: game.phase,
      score: { left: game.left.score, right: game.right.score },
      pos: {
        left: { x: +game.left.x.toFixed(2), z: +game.left.z.toFixed(2) },
        right: { x: +game.right.x.toFixed(2), z: +game.right.z.toFixed(2) },
      },
      controllers: [...ctrlStats.values()],
    }, null, 2));
    return;
  }

  if (p === '/api/qr') {
    const text = url.searchParams.get('text') || `https://${LAN_IP}:${HTTPS_PORT}/ctrl`;
    QRCode.toString(text, { type: 'svg', margin: 1, width: 280 }, (err, svg) => {
      if (err) { res.writeHead(500); return res.end('qr error'); }
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      res.end(svg);
    });
    return;
  }

  // three.js 本体 / 官方 addons / GLB 模型
  for (const [prefix, base] of Object.entries(STATIC_DIRS)) {
    if (p.startsWith(prefix)) {
      serveStatic(base, p.slice(prefix.length), res);
      return;
    }
  }

  if (ALIAS[p]) p = ALIAS[p];
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('403'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

const httpServer = http.createServer(handler);
let httpsServer = null;
try {
  httpsServer = https.createServer({
    key: fs.readFileSync(path.join(__dirname, 'certs/key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'certs/cert.pem')),
  }, handler);
} catch {
  console.warn('[warn] 证书缺失，仅启动 HTTP');
}

const io = new Server({ cors: { origin: '*' }, pingInterval: 8000, pingTimeout: 20000 });
io.attach(httpServer);
if (httpsServer) io.attach(httpsServer);

// 服务端权威判定 → 手机端触觉/文字反馈
game.onHitFx = (side, grade, power, swingId, shot) => {
  io.to('slot:' + side).emit('ctrl:hit', { grade, power, shot });
};
game.onMissFx = (side) => {
  io.to('slot:' + side).emit('ctrl:miss', {});
};

// ---------- Socket ----------
const slotOwner = { left: null, right: null };

// 占位是否还有活着的 socket，防止已断开的连接一直占着场地
function slotAlive(slot) {
  const id = slotOwner[slot];
  if (!id) return false;
  if (io.sockets.sockets.has(id)) return true;
  slotOwner[slot] = null;
  return false;
}

function assignSlot(id, wanted, ip) {
  const take = (slot) => {
    const oldId = slotOwner[slot];
    if (oldId && oldId !== id) {
      const old = io.sockets.sockets.get(oldId);
      if (old) { old.emit('ctrl:released'); old.data.slot = null; }
    }
    slotOwner[slot] = id;
    return slot;
  };

  if (wanted === 'left' || wanted === 'right') return take(wanted);
  // 自动分配：优先左边（单人模式直接接管玩家 1）
  if (!slotAlive('left')) return take('left');
  if (!slotAlive('right')) return take('right');

  // 场地满：同一 IP 刷新/重连，直接接管原场地
  for (const slot of ['left', 'right']) {
    const s = ctrlStats.get(slotOwner[slot]);
    if (s && s.ip && s.ip === ip) return take(slot);
  }
  // 否则接管最久没有上报数据的手柄，避免残留连接长期占位
  for (const slot of ['left', 'right']) {
    const s = ctrlStats.get(slotOwner[slot]);
    const stale = Date.now() - ((s && s.lastSeen) || 0);
    if (stale > 8000) return take(slot);
  }
  return null;
}

function setConnected(slot, val, name) {
  const p = slot === 'left' ? game.left : game.right;
  p.connected = val;
  p.name = name || (slot === 'left' ? '玩家 1' : '玩家 2');
  if (slot === 'right') p.ai = false;
}

io.on('connection', (socket) => {
  const ip = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '').toString();
  bumpCtrl(socket.id, { ip, lastSeen: Date.now() });

  socket.on('ctrl:join', ({ slot, name, hand } = {}) => {
    const got = assignSlot(socket.id, slot, ip);
    if (!got) { socket.emit('ctrl:full'); return; }
    socket.data.slot = got;
    socket.join('ctrl');
    socket.join('slot:' + got);
    bumpCtrl(socket.id, { slot: got, lastSeen: Date.now() });

    const wasAI = game.right.ai;
    setConnected(got, true, name);
    const joined = got === 'left' ? game.left : game.right;
    if (hand === 'left' || hand === 'right') joined.hand = hand;

    // 第二部手机接管右边 → 自动切双人分屏
    if (got === 'right' && wasAI) {
      game.restart();
      io.emit('mode:set', { twoPlayer: true });
    }
    socket.emit('ctrl:joined', { slot: got });
    console.log(`[手柄接入] ${got} ip=${ip}`);
  });

  socket.on('ctrl:hand', ({ hand } = {}) => {
    const slot = socket.data.slot;
    if (!slot || hand !== 'left' && hand !== 'right') return;
    const p = slot === 'left' ? game.left : game.right;
    p.hand = hand;
  });

  socket.on('ctrl:motion', ({ rate, events } = {}) => {
    const s = bumpCtrl(socket.id, { lastSeen: Date.now() });
    s.rate = rate || 0;
    s.motionEvents = events || s.motionEvents;
    stats.motionReports++;
  });

  socket.on('ctrl:pose', ({ q } = {}) => {
    const slot = socket.data.slot;
    if (!slot || !Array.isArray(q) || q.length !== 4) return;
    if (!q.every((n) => Number.isFinite(n))) return;
    let [x, y, z, w] = q;
    const len = Math.hypot(x, y, z, w) || 1;
    x /= len; y /= len; z /= len; w /= len;
    const p = slot === 'left' ? game.left : game.right;
    p.pose = [x, y, z, w];
    p.poseAt = Date.now();
  });

  socket.on('ctrl:swing', ({ power, dir, peak, lift, shot } = {}) => {
    const slot = socket.data.slot;
    if (!slot) return;
    const s = bumpCtrl(socket.id, { lastSeen: Date.now() });
    s.swings++;
    s.lastSwingPeak = Math.round(peak || 0);
    stats.swingsDetected++;
    console.log(`[挥拍] ${slot} peak=${(peak || 0).toFixed(1)} power=${(power || 0).toFixed(2)} lift=${(lift ?? 0.5).toFixed(2)} shot=${shot || 'clear'}`);
    game.swing(slot, power, dir, lift, shot);
  });

  socket.on('game:swing', ({ side, power, dir, lift, shot } = {}) => {
    if (side === 'left' || side === 'right') game.swing(side, power ?? 0.7, dir ?? 0, lift ?? 0.5, shot);
  });

  socket.on('game:restart', () => { game.restart(); console.log('[重开]'); });

  socket.on('game:mode', ({ ai } = {}) => {
    game.right.ai = !!ai;
    game.right.name = ai ? '电脑' : (game.right.connected ? game.right.name : '玩家 2');
    game.restart();
    console.log(`[模式] ${ai ? '单人 vs 电脑' : '双人对战'}`);
  });

  socket.on('game:difficulty', ({ level } = {}) => {
    game.setDifficulty(level);
    console.log(`[难度] ${game.aiLevel}`);
  });

  socket.on('disconnect', () => {
    const slot = socket.data.slot;
    if (slot && slotOwner[slot] === socket.id) {
      slotOwner[slot] = null;
      const p = slot === 'left' ? game.left : game.right;
      p.connected = false;
      if (slot === 'right' && !game.right.ai) {
        game.right.ai = true;
        game.right.name = '电脑';
        io.emit('mode:set', { twoPlayer: false });
      }
      console.log(`[手柄断开] ${slot}`);
    }
    ctrlStats.delete(socket.id);
  });
});

// ---------- 主循环 ----------
const TICK = 1 / 60;
let last = process.hrtime.bigint();
let acc = 0;

function loop() {
  const now = process.hrtime.bigint();
  const dt = Number(now - last) / 1e9;
  last = now;
  acc += Math.min(dt, 0.25);
  let steps = 0;
  while (acc >= TICK && steps < 5) {
    game.step(TICK);
    acc -= TICK;
    steps++;
  }
  if (steps) io.emit('state', game.snapshot());
}
setInterval(loop, 16);

setInterval(() => {
  io.to('ctrl').emit('ctrl:tick', {
    bx: game.ball.x, by: game.ball.y, bz: game.ball.z,
    l: { x: game.left.x, y: game.left.y, z: game.left.z, score: game.left.score },
    r: { x: game.right.x, y: game.right.y, z: game.right.z, score: game.right.score },
    phase: game.phase, srv: game.serverSide, msg: game.msg,
  });
}, 66);

// ---------- 启动 ----------
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  3D 体感羽毛球已启动');
  console.log('  ────────────────────────────────────────');
  console.log(`  大屏游戏   : http://${LAN_IP}:${HTTP_PORT}/`);
  console.log(`  手机手柄   : https://${LAN_IP}:${HTTPS_PORT}/ctrl`);
  console.log(`  统计       : http://${LAN_IP}:${HTTP_PORT}/api/stats`);
  console.log('  ────────────────────────────────────────');
  console.log('');
});
if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`  HTTPS      : https://${LAN_IP}:${HTTPS_PORT}/ctrl`);
  });
}
