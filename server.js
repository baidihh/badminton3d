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
const VENDOR = path.join(__dirname, 'node_modules/three/build');

const HTTP_PORT = 3100;
const HTTPS_PORT = 3543;

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

const RA_SPEED = { x: 6.5, z: 5.5, y: 4.2 };

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

class Game {
  constructor() {
    this.aiReaction = 0.22;
    this.aiMissChance = 0.2;
    this.hardReset();
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
      score: 0,
      connected: false,
      flash: 0,
      name: side === 'left' ? '玩家 1' : '玩家 2',
      ai: false,
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

  swing(side, power = 0.7, dir = 0) {
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
    p.armedUntil = this.t + 0.24;
    p.pending = { power: clamp(power, 0, 1), dir: clamp(dir, -1, 1) };
    p.flash = 1;
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
    const { power, dir } = p.pending;
    const d = Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
    const q = clamp(1 - d / HIT_R, 0, 1);

    // 目标落点：力量决定深度，摆动方向决定左右
    const sign = p.side === 'left' ? 1 : -1;
    const tz = sign * clamp(2.0 + power * 3.6 + (1 - q) * 0.5, 1.4, 6.2);
    const tx = clamp(dir * 2.4 + rand(-0.4, 0.4) * (1 - q), -2.75, 2.75);

    // 飞行时间：力量越大越平越快
    const T = 1.62 - power * 0.52 + (1 - q) * 0.22;

    // 用线性阻力的闭式解反求初速度，保证一定落在目标点
    const A = K / (1 - Math.exp(-K * T));
    b.vx = (tx - b.x) * A;
    b.vz = (tz - b.z) * A;
    b.vy = (0 - b.y + (G / K) * T) * A - G / K;

    this.holder = p.side;
    this.rally++;
    this.impact = { x: b.x, y: b.y, z: b.z, power: 0.35 + power * 0.65 };
    p.armedUntil = 0;
    p.pending = null;
    if (this.phase === 'serve') this.phase = 'rally';
    this.msg = '';
  }

  updateRacket(p, dt) {
    const b = this.ball;
    const onMySide = p.side === 'left' ? b.z < 0 : b.z > 0;

    let tx, ty, tz;
    if (onMySide) {
      tx = clamp(b.x, -2.9, 2.9);
      ty = clamp(b.y, 0.6, 2.7);
      tz = p.side === 'left' ? clamp(b.z, -6.4, -0.5) : clamp(b.z, 0.5, 6.4);
    } else {
      tx = clamp(b.x * 0.5, -1.6, 1.6);
      ty = 1.2;
      tz = p.side === 'left' ? -PLAYER_Z : PLAYER_Z;
    }

    // 球拍跟随有延迟 —— 这就是"手感"和时机判定来源
    p.x = moveTo(p.x, tx, RA_SPEED.x * dt);
    p.y = moveTo(p.y, ty, RA_SPEED.y * dt);
    p.z = moveTo(p.z, tz, RA_SPEED.z * dt);
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

  updateAI(dt) {
    const p = this.right;
    if (!p.ai) return;
    const b = this.ball;

    if (b.z > 0 && this.lastBallZ <= 0) {
      this.aiPlan = {
        reactAt: this.t + this.aiReaction,
        miss: Math.random() < this.aiMissChance,
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
      this.swing('right', rand(0.4, 0.95), rand(-0.65, 0.65));
    }
  }

  step(dt) {
    this.t += dt;

    if (!this.started) {
      // 待机：球悬停，球拍自动就位，等待第一拍
      this.bob = (this.bob || 0) + dt;
      this.ball.y = 2.5 + Math.sin(this.bob * 2.2) * 0.1;
      this.updateRacket(this.left, dt);
      this.updateRacket(this.right, dt);
      return;
    }
    this.left.flash = Math.max(0, this.left.flash - dt * 4);
    this.right.flash = Math.max(0, this.right.flash - dt * 4);
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

    this.updateRacket(this.left, dt);
    this.updateRacket(this.right, dt);
    this.updateAI(dt);
    if (!this.tryHit(this.left)) this.tryHit(this.right);

    const b = this.ball;
    const prevZ = b.z;

    integrate(b, dt);

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
      msg: this.msg,
      rally: this.rally,
      impact: this.impact,
      winScore: WIN_SCORE,
    };
  }

  pack(p) {
    return {
      x: p.x, y: p.y, z: p.z, score: p.score,
      connected: p.connected, flash: p.flash, name: p.name, ai: p.ai,
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
};
const ALIAS = { '/': '/index.html', '/ctrl': '/ctrl.html' };

function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);

  if (p === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true, lanIP: LAN_IP, ports: { http: HTTP_PORT, https: HTTPS_PORT },
      stats, phase: game.phase,
      score: { left: game.left.score, right: game.right.score },
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

  // three.js 本体
  if (p.startsWith('/vendor/')) {
    const f = path.join(VENDOR, path.normalize(p.slice(8)));
    if (!f.startsWith(VENDOR)) { res.writeHead(403); return res.end('403'); }
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'max-age=3600' });
      res.end(data);
    });
    return;
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

// ---------- Socket ----------
const slotOwner = { left: null, right: null };

function assignSlot(id, wanted) {
  if (wanted === 'left' || wanted === 'right') {
    const prev = slotOwner[wanted];
    if (prev && prev !== id) {
      const old = io.sockets.sockets.get(prev);
      if (old) { old.emit('ctrl:released'); old.data.slot = null; }
    }
    slotOwner[wanted] = id;
    return wanted;
  }
  if (!slotOwner.left) { slotOwner.left = id; return 'left'; }
  if (!slotOwner.right) { slotOwner.right = id; return 'right'; }
  return null;
}

function setConnected(slot, val, name) {
  const p = slot === 'left' ? game.left : game.right;
  p.connected = val;
  if (name) p.name = name;
  if (slot === 'right') p.ai = false;
}

io.on('connection', (socket) => {
  const ip = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '').toString();
  bumpCtrl(socket.id, { ip, lastSeen: Date.now() });

  socket.on('ctrl:join', ({ slot, name }) => {
    const got = assignSlot(socket.id, slot);
    if (!got) { socket.emit('ctrl:full'); return; }
    socket.data.slot = got;
    socket.join('ctrl');
    bumpCtrl(socket.id, { slot: got, lastSeen: Date.now() });
    setConnected(got, true, name);
    socket.emit('ctrl:joined', { slot: got });
    console.log(`[手柄接入] ${got} ip=${ip}`);
  });

  socket.on('ctrl:motion', ({ rate, events } = {}) => {
    const s = bumpCtrl(socket.id, { lastSeen: Date.now() });
    s.rate = rate || 0;
    s.motionEvents = events || s.motionEvents;
    stats.motionReports++;
  });

  socket.on('ctrl:swing', ({ power, dir, peak } = {}) => {
    const slot = socket.data.slot;
    if (!slot) return;
    const s = bumpCtrl(socket.id, { lastSeen: Date.now() });
    s.swings++;
    s.lastSwingPeak = Math.round(peak || 0);
    stats.swingsDetected++;
    console.log(`[挥拍] ${slot} peak=${(peak || 0).toFixed(1)} power=${(power || 0).toFixed(2)}`);
    game.swing(slot, power, dir);
  });

  socket.on('game:swing', ({ side, power, dir } = {}) => {
    if (side === 'left' || side === 'right') game.swing(side, power ?? 0.7, dir ?? 0);
  });

  socket.on('game:restart', () => { game.restart(); console.log('[重开]'); });

  socket.on('game:mode', ({ ai } = {}) => {
    game.right.ai = !!ai;
    game.right.name = ai ? '电脑' : (game.right.connected ? game.right.name : '玩家 2');
    game.restart();
    console.log(`[模式] ${ai ? '单人 vs 电脑' : '双人对战'}`);
  });

  socket.on('game:difficulty', ({ level } = {}) => {
    const table = { easy: [0.32, 0.36], normal: [0.22, 0.2], hard: [0.13, 0.08] };
    const [r, m] = table[level] || table.normal;
    game.aiReaction = r;
    game.aiMissChance = m;
  });

  socket.on('disconnect', () => {
    const slot = socket.data.slot;
    if (slot && slotOwner[slot] === socket.id) {
      slotOwner[slot] = null;
      const p = slot === 'left' ? game.left : game.right;
      p.connected = false;
      if (slot === 'right' && !game.right.ai) game.right.ai = true;
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
