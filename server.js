// 入口：HTTP/HTTPS、静态资源、Socket 装配、主循环
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import selfsigned from 'selfsigned';
import { recorder } from './recorder.js';
import { Game } from './game/game.js';
import { attachSocket, ctrlStats, netStats } from './net/socket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

const HTTP_PORT = Number(process.env.PORT || 3100);
const HTTPS_PORT = Number(process.env.PORT_HTTPS || 3543);

// 收集本机所有可用的 IPv4 地址：排除回环、APIPA(169.254) 和虚拟网卡优先级的干扰
function listLANAddrs() {
  const ifaces = os.networkInterfaces();
  const list = [];
  for (const [name, items] of Object.entries(ifaces)) {
    for (const ni of items || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue;
      if (ni.address.startsWith('169.254.')) continue; // 未拿到 DHCP 时的占位地址
      list.push({ name, address: ni.address });
    }
  }
  // 真实局域网网卡优先，VPN / 虚拟机 / 蓝牙网卡靠后
  const rank = (n) => (/wlan|wi-?fi|无线|以太网|ethernet|^en\d|^eth\d/i.test(n) ? 0
    : /vpn|virtual|vmware|tap|wintun|bluetooth|蓝牙/i.test(n) ? 2 : 1);
  list.sort((a, b) => rank(a.name) - rank(b.name));
  return list;
}

const LAN_ADDRS = listLANAddrs();
const LAN_IP = (LAN_ADDRS[0] && LAN_ADDRS[0].address) || '127.0.0.1';
recorder.setLAN(LAN_IP);

// 手机体感需要安全上下文，必须 HTTPS：证书缺失时自动生成自签证书
function ensureCerts() {
  const dir = path.join(__dirname, 'certs');
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) return { keyPath, certPath };
  fs.mkdirSync(dir, { recursive: true });
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...LAN_ADDRS.map((a) => ({ type: 7, ip: a.address })),
  ];
  return selfsigned.generate(
    [{ name: 'commonName', value: LAN_IP }],
    { days: 3650, keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames }] },
  ).then((pems) => {
    fs.writeFileSync(keyPath, pems.private);
    fs.writeFileSync(certPath, pems.cert);
    console.log('[证书] 未找到证书，已生成自签证书 certs/key.pem / cert.pem');
    return { keyPath, certPath };
  });
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

const game = new Game();

function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);

  if (p === '/api/net') {
    const addrs = listLANAddrs(); // 实时读取：蓝牙网络共享等网卡可能刚连上
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      lanIP: (addrs[0] && addrs[0].address) || LAN_IP,
      http: HTTP_PORT,
      https: HTTPS_PORT,
      // 多网卡时列出全部候选地址，手机连不上可换一个试
      addrs,
    }));
    return;
  }

  if (p === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true, lanIP: LAN_IP, ports: { http: HTTP_PORT, https: HTTPS_PORT },
      stats: netStats, phase: game.phase,
      score: { left: game.left.score, right: game.right.score },
      pos: {
        left: { x: +game.left.x.toFixed(2), z: +game.left.z.toFixed(2) },
        right: { x: +game.right.x.toFixed(2), z: +game.right.z.toFixed(2) },
      },
      controllers: [...ctrlStats.values()],
    }, null, 2));
    return;
  }

  if (p === '/api/rec') {
    const on = url.searchParams.get('on');
    if (on === '0' || on === '1') recorder.toggle(on === '1');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, ...recorder.status() }, null, 2));
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
  const { keyPath, certPath } = await ensureCerts();
  httpsServer = https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }, handler);
} catch (e) {
  console.warn('[warn] 证书不可用，仅启动 HTTP：', e.message);
}

const io = new Server({ cors: { origin: '*' }, pingInterval: 8000, pingTimeout: 20000 });
io.attach(httpServer);
if (httpsServer) io.attach(httpsServer);

// 服务端权威判定 → 手机端触觉/文字反馈
game.onHitFx = (side, grade, power, swingId, shot, impact) => {
  io.to('slot:' + side).emit('ctrl:hit', { grade, power, shot });
  recorder.hit(side, { grade, power, swingId, shot, impact });
};
game.onMissFx = (side, swingId, ball, reason) => {
  io.to('slot:' + side).emit('ctrl:miss', { reason: reason || 'late' });
  recorder.miss(side, { swingId, ball });
};

attachSocket(io, game);

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
  if (LAN_ADDRS.length > 1) {
    console.log('  手机连不上时，可换下面任意一个地址试：');
    for (const a of LAN_ADDRS) {
      console.log(`    https://${a.address}:${HTTPS_PORT}/ctrl   [${a.name}]`);
    }
    console.log('  ────────────────────────────────────────');
  }
  console.log('');
});
if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`  HTTPS      : https://${LAN_IP}:${HTTPS_PORT}/ctrl`);
  });
}

// 退出前把采集缓冲落盘
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    recorder.flushAll();
    setTimeout(() => process.exit(0), 120);
  });
}
