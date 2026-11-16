import { startBackhandFeed } from '../game/shot-lab.js';
import { isCharacterId } from '../public/js/characters.js';
import { TargetTraining } from '../game/training.js';
import { sanitizeTrainingCapture } from './training-input.js';
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
  const training = new TargetTraining(game, {
    write: (id, event) => recorder.training(id, event),
    isRecording: id => recorder.isRecording(id),
    notify: state => io.emit('training:state', state),
    onError: message => io.emit('training:error', { message }),
  });
  game.training = training;

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
        if (training.active && training.ownerId === oldId) training.stop('controller_replaced');
        const old = io.sockets.sockets.get(oldId);
        if (old) {
          old.emit('ctrl:released'); old.data.slot = null;
          old.leave('slot:' + slot); old.leave('ctrl'); recorder.close(oldId, 'replaced');
        }
      }
      slotOwner[slot] = id;
      return slot;
    };

    if (wanted === 'left' || wanted === 'right') return take(wanted);
    // 重复自动入场保持原位置，避免校准/重连流程把同一手柄切到另一方。
    for (const slot of ['left', 'right']) if (slotOwner[slot] === id) return slot;
    // 自动分配：优先左边（单人模式直接接管玩家 1）
    if (!slotAlive('left')) return take('left');
    // 同一手机刷新后旧 socket 可能还存活数秒；优先接回蓝方，避免误分到红方。
    const leftStats = ctrlStats.get(slotOwner.left);
    if (leftStats?.ip && leftStats.ip === ip) return take('left');
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
    if (slot === 'right') p.ai = !val;
  }

  io.on('connection', (socket) => {
    // 限制消息形状与频率，所有处理器只接收普通对象。
    const rates = new Map();
    const on = (event, handler) => socket.on(event, (payload = {}) => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
      const now = Date.now();
      const entry = rates.get(event) || { start: now, count: 0 };
      if (now - entry.start >= 1000) { entry.start = now; entry.count = 0; }
      const limit = event === 'ctrl:pose' ? 40 : event === 'ctrl:swing' || event === 'game:swing' ? 6 : 10;
      if (++entry.count > limit) return;
      rates.set(event, entry);
      handler(payload);
    });
    const ownsSlot = () => socket.data.slot && slotOwner[socket.data.slot] === socket.id;
    const canManage = () => socket.data.screen === true;
    on('screen:join', () => { if (!ownsSlot()) socket.data.screen = true; socket.emit('training:state', training.snapshot()); });
    const trainingError = message => socket.emit('training:error', { message });
    const trainingOwner = () => canManage() ? slotOwner.left : (ownsSlot() && socket.data.slot === 'left' ? socket.id : null);
    on('training:start', () => {
      const owner = trainingOwner();
      if (!owner) return trainingError('请先连接玩家 1 手机，再开始定点训练。');
      if (!training.start(owner)) trainingError(training.error);
      else io.emit('mode:set', { twoPlayer: false });
    });
    on('training:stop', () => {
      if (training.active && trainingOwner() === training.ownerId) {
        training.stop();io.emit('mode:set', { twoPlayer: !game.right.ai });
      }
    });
    on('training:retry', ({ attemptId }) => {
      if (!training.retry(trainingOwner(), attemptId)) trainingError('这一拍已开始或已被替换，请在结果显示时重来。');
    });
    const ip = (socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '').toString();
    bumpCtrl(socket.id, { ip, lastSeen: Date.now() });

    on('ctrl:join', ({ slot, name, hand, viewport, characterId } = {}) => {
      const previous = socket.data.slot;
      if (training.active && socket.id === training.ownerId && slot && slot !== previous) training.stop('controller_join');
      const got = assignSlot(socket.id, slot, ip);
      if (!got) { socket.emit('ctrl:full'); return; }
      if (previous && previous !== got && slotOwner[previous] === socket.id) {
        slotOwner[previous] = null;
        setConnected(previous, false);
        socket.leave('slot:' + previous);
        if (previous === 'right') {
          game.right.ai = true; game.right.name = '电脑';
          io.emit('mode:set', { twoPlayer: false });
        }
      }
      socket.data.screen = false;
      socket.data.slot = got;
      socket.join('ctrl');
      socket.join('slot:' + got);
      bumpCtrl(socket.id, { slot: got, lastSeen: Date.now() });

      const wasAI = game.right.ai;
      setConnected(got, true, typeof name === 'string' ? name.slice(0, 24) : undefined);
      const joined = got === 'left' ? game.left : game.right;
      if (hand === 'left' || hand === 'right') joined.hand = hand;
      if (isCharacterId(characterId)) joined.characterId = characterId;

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
      socket.emit('ctrl:joined', { slot: got, characterId: joined.characterId });
      socket.emit('training:state', training.snapshot());
      console.log(`[手柄接入] ${got} ip=${ip}`);
    });

    on('ctrl:character', ({ characterId }) => {
      if (!ownsSlot() || !isCharacterId(characterId) || training.active) return;
      game[socket.data.slot].characterId = characterId;
      socket.emit('character:selected', { side: socket.data.slot, characterId });
    });
    on('game:character', ({ side, characterId }) => {
      if (!canManage() || !['left', 'right'].includes(side) || !isCharacterId(characterId) || training.active) return;
      game[side].characterId = characterId;
    });

    on('ctrl:hand', ({ hand } = {}) => {
      const slot = socket.data.slot;
      if (!ownsSlot() || hand !== 'left' && hand !== 'right') return;
      const p = slot === 'left' ? game.left : game.right;
      p.hand = hand;
    });

    on('ctrl:motion', ({ rate, events } = {}) => {
      const s = bumpCtrl(socket.id, { lastSeen: Date.now() });
      s.rate = Number.isFinite(rate) ? clamp(rate, 0, 1000) : 0;
      s.motionEvents = Number.isFinite(events) ? Math.max(0, events) : s.motionEvents;
      netStats.motionReports++;
    });

    on('ctrl:pose', ({ q, az, el, om, hand } = {}) => {
      const slot = socket.data.slot;
      if (!ownsSlot() || !Array.isArray(q) || q.length !== 4) return;
      if (!q.every((n) => Number.isFinite(n))) return;
      let [x, y, z, w] = q;
      const len = Math.hypot(x, y, z, w) || 1;
      x /= len; y /= len; z /= len; w /= len;
      const p = slot === 'left' ? game.left : game.right;
      p.pose = [x, y, z, w];
      p.poseAt = Date.now();
      recorder.pose(socket.id, { q: [x, y, z, w], az, el, om, hand });
    });

    on('ctrl:swing', ({ power, dir, peak, lift, shot, az, azRaw, el, om, dropHold, hand, requested, elStart, elMax, elMin, elAtPeak, sweepDeg, yawSweep, ageMs, rttMs, attemptId, sensorCapture } = {}) => {
      const slot = socket.data.slot;
      if (!ownsSlot()) return;
      if (![power, dir, lift, peak, az, ageMs, rttMs].every(v => v === undefined || Number.isFinite(v))) return;
      const s = bumpCtrl(socket.id, { lastSeen: Date.now() });
      s.swings++;
      s.lastSwingPeak = Math.round(peak || 0);
      netStats.swingsDetected++;
      // 时间戳回溯的时长 = 检测延迟 + 单程网络延迟（上限 250 ms）
      const lagMs = clamp((Number(ageMs) || 0) + Math.max(0, Number(rttMs) || 0) / 2, 0, 250);
      console.log(`[挥拍] ${slot} peak=${(peak || 0).toFixed(1)} power=${(power || 0).toFixed(2)} lift=${(lift ?? 0.5).toFixed(2)} shot=${shot || 'clear'} lag=${lagMs.toFixed(0)}ms`);
      if (training.active) {
        if (socket.id !== training.ownerId || training.status !== 'ready') return;
        const capture = sanitizeTrainingCapture(sensorCapture);
        if (!capture) return trainingError('还没有收到本拍传感器数据，请刷新手机、完成校准后再试。');
        if (!training.swing(socket.id, attemptId, { power, dir, lift, shot, az, lagMs, peak, azRaw, el, om, yawSweep, hand, rttMs, ageMs }, capture)) return;
      } else if (!game.swing(slot, power, dir, lift, shot, { az, lagMs })) return;
      const pl = slot === 'left' ? game.left : game.right;
      recorder.swing(socket.id, { swingId: pl.swingId, power, dir, peak, lift, shot, az, azRaw, el, om, dropHold, hand, requested, elStart, elMax, elMin, elAtPeak, sweepDeg, yawSweep, lag: lagMs });
    });

    // 延迟测量：立刻回包，手机端用 RTT 估算单程延迟
    on('ctrl:ping', ({ t } = {}) => {
      socket.emit('ctrl:pong', { t, now: game.t });
    });

    on('game:swing', ({ side, power, dir, lift, shot } = {}) => {
      if (training.active) return;
      if (!canManage() && (!ownsSlot() || socket.data.slot !== side)) return;
      if (side === 'left' || side === 'right') game.swing(side, power ?? 0.7, dir ?? 0, lift ?? 0.5, shot);
    });

    on('game:backhand-feed', ({ auto } = {}) => {
      if (!canManage() || training.active || !game.right.ai) return;
      if (game.backhandFeed && (game.phase === 'rally' || game.left.rearPlan)) return;
      startBackhandFeed(game, auto === true);
    });

    on('game:restart', () => { if (!canManage() && !ownsSlot()) return; if (training.active && trainingOwner() !== training.ownerId) return; training.stop('restart_match'); game.restart(); console.log('[重开]'); });

    on('game:mode', ({ ai } = {}) => {
      if (!canManage() || typeof ai !== 'boolean') return;
      training.stop('mode_changed');
      game.right.ai = ai;
      game.right.name = ai ? '电脑' : (game.right.connected ? game.right.name : '玩家 2');
      game.restart();
      console.log(`[模式] ${ai ? '单人 vs 电脑' : '双人对战'}`);
    });

    on('game:difficulty', ({ level } = {}) => {
      if (!canManage() || !['easy', 'normal', 'hard'].includes(level)) return;
      training.stop('difficulty_changed');
      game.setDifficulty(level);
      console.log(`[难度] ${game.aiLevel}`);
    });

    socket.on('disconnect', () => {
      const slot = socket.data.slot;
      if (training.active && training.ownerId === socket.id) training.stop('controller_disconnected');
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
