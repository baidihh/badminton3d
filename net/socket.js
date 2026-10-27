// Socket.IO 网络层：场地分配、手柄输入、延迟测量
import { recorder } from '../recorder.js';
import { clamp } from '../game/constants.js';

export const ctrlStats = new Map();
// 手柄统计：/api/stats 也读这两个表
export const netStats = { swingsDetected: 0, motionReports: 0 };

function bumpCtrl(id, patch) {
  const s = ctrlStats.get(id) || {
    id, ip: '', slot: null, motionEvents: 0, swings: 0,
    lastSwingPeak: 0, lastSeen: 0, rate: 0,
  };
  Object.assign(s, patch);
  ctrlStats.set(id, s);
  return s;
}

export function attachSocket(io, game) {
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

    socket.on('ctrl:join', ({ slot, name, hand, viewport } = {}) => {
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

      // 采集：每个手柄一次会话，记录真实姿态与击球结果
      recorder.open(socket.id, {
        ip, slot: got, hand: joined.hand,
        ua: socket.handshake.headers['user-agent'] || '',
        viewport: viewport || null,
        level: game.aiLevel,
        mode: game.right.ai ? 'solo' : 'duo',
      });

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
      netStats.motionReports++;
    });

    socket.on('ctrl:pose', ({ q, az, el, om, hand } = {}) => {
      const slot = socket.data.slot;
      if (!slot || !Array.isArray(q) || q.length !== 4) return;
      if (!q.every((n) => Number.isFinite(n))) return;
      let [x, y, z, w] = q;
      const len = Math.hypot(x, y, z, w) || 1;
      x /= len; y /= len; z /= len; w /= len;
      const p = slot === 'left' ? game.left : game.right;
      p.pose = [x, y, z, w];
      p.poseAt = Date.now();
      recorder.pose(socket.id, { q: [x, y, z, w], az, el, om, hand });
    });

    socket.on('ctrl:swing', ({ power, dir, peak, lift, shot, az, azRaw, el, om, dropHold, hand, requested, elStart, elMax, elMin, elAtPeak, sweepDeg, ageMs, rttMs } = {}) => {
      const slot = socket.data.slot;
      if (!slot) return;
      const s = bumpCtrl(socket.id, { lastSeen: Date.now() });
      s.swings++;
      s.lastSwingPeak = Math.round(peak || 0);
      netStats.swingsDetected++;
      // 时间戳回溯的时长 = 检测延迟 + 单程网络延迟（上限 250 ms）
      const lagMs = clamp((Number(ageMs) || 0) + Math.max(0, Number(rttMs) || 0) / 2, 0, 250);
      console.log(`[挥拍] ${slot} peak=${(peak || 0).toFixed(1)} power=${(power || 0).toFixed(2)} lift=${(lift ?? 0.5).toFixed(2)} shot=${shot || 'clear'} lag=${lagMs.toFixed(0)}ms`);
      game.swing(slot, power, dir, lift, shot, { az, lagMs });
      const pl = slot === 'left' ? game.left : game.right;
      recorder.swing(socket.id, { swingId: pl.swingId, power, dir, peak, lift, shot, az, azRaw, el, om, dropHold, hand, requested, elStart, elMax, elMin, elAtPeak, sweepDeg, lag: lagMs });
    });

    // 延迟测量：立刻回包，手机端用 RTT 估算单程延迟
    socket.on('ctrl:ping', ({ t } = {}) => {
      socket.emit('ctrl:pong', { t, now: game.t });
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
      recorder.close(socket.id);
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
}
