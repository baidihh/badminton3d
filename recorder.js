import fs from 'fs';
import path from 'path';

// ============================================================
// 手机体感数据采集：每个手柄一次会话，逐行 JSON（JSONL）
// 目的：积累“真实姿态 → 挥拍 → 击球结果”的样本，用于调参与训练
// ============================================================

const ROOT = process.env.RECORD_DIR || path.join(process.cwd(), 'data');
const SESSIONS = path.join(ROOT, 'sessions');
const POSE_HZ = Number(process.env.RECORD_POSE_HZ || 20);
const POSE_DT = 1000 / POSE_HZ;

let enabled = process.env.RECORD !== '0';
let cachedLAN = '';

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function safeName(s) {
  return String(s || '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48);
}

class Recorder {
  constructor() {
    this.sessions = new Map();
    this.count = 0;
    this.lastFile = '';
    this.lastError = '';
  }

  setLAN(ip) { cachedLAN = ip; }

  status() {
    return {
      on: enabled,
      dir: SESSIONS,
      poseHz: POSE_HZ,
      active: this.sessions.size,
      total: this.count,
      lastFile: this.lastFile,
      lastError: this.lastError,
    };
  }

  toggle(on) {
    enabled = !!on;
    if (!enabled) for (const id of [...this.sessions.keys()]) this.close(id, 'recording off');
    return enabled;
  }

  /** 手柄加入场地时开会话；同一 socket 重复开会自动结束上一份 */
  open(id, meta = {}) {
    if (!enabled) return null;
    this.close(id, 'reopen');
    try {
      fs.mkdirSync(SESSIONS, { recursive: true });
      const ip = safeName(meta.ip);
      const slot = safeName(meta.slot || 'unassigned');
      const file = path.join(SESSIONS, `${stamp()}_${slot}_${ip || 'local'}.jsonl`);
      const stream = fs.createWriteStream(file, { flags: 'a' });
      const sess = {
        file, stream, openedAt: Date.now(), lastPose: 0,
        seq: 0, recent: [],
        meta: {
          v: 1,
          slot: meta.slot || null,
          ip: meta.ip || null,
          hand: meta.hand || 'right',
          ua: meta.ua || '',
          viewport: meta.viewport || null,
          level: meta.level || 'normal',
          mode: meta.mode || 'solo',
          lan: cachedLAN,
        },
      };
      this.sessions.set(id, sess);
      this.count++;
      this.lastFile = file;
      this.write(sess, { type: 'session', t: 0, iso: new Date().toISOString(), ...sess.meta });
      return file;
    } catch (e) {
      this.lastError = String(e.message || e);
      console.warn('[记录] 打开会话失败:', this.lastError);
      return null;
    }
  }

  close(id, reason = 'disconnect') {
    const sess = this.sessions.get(id);
    if (!sess) return;
    this.write(sess, { type: 'session_end', t: this.ms(sess), reason });
    try { sess.stream.end(); } catch {}
    this.sessions.delete(id);
  }

  ms(sess) {
    return Math.round(Date.now() - sess.openedAt);
  }

  write(sess, obj) {
    if (!sess || !sess.stream.writable) return;
    try {
      sess.stream.write(JSON.stringify(obj) + '\n');
    } catch (e) {
      this.lastError = String(e.message || e);
    }
  }

  bySlot(slot) {
    for (const [id, sess] of this.sessions) {
      if (sess.meta.slot === slot) return [id, sess];
    }
    return [null, null];
  }

  /** 姿态采样（默认 20Hz 落盘，避免文件过大） */
  pose(id, { q, az, el, om, hand } = {}) {
    const sess = this.sessions.get(id);
    if (!sess || !Array.isArray(q) || q.length !== 4) return;
    const now = Date.now();
    if (now - sess.lastPose < POSE_DT) return;
    sess.lastPose = now;
    this.write(sess, {
      type: 'pose',
      t: this.ms(sess),
      q,
      az: round(az, 4),
      el: round(el, 4),
      om: round(om, 1),
      hand: hand || sess.meta.hand,
    });
  }

  swing(id, data = {}) {
    const sess = this.sessions.get(id);
    if (!sess) return;
    sess.meta.hand = data.hand || sess.meta.hand;
    const seq = ++sess.seq;
    const rec = {
      type: 'swing',
      t: this.ms(sess),
      seq,
      swingId: data.swingId ?? null,
      power: round(data.power, 3),
      dir: round(data.dir, 3),
      peak: round(data.peak, 1),
      lift: round(data.lift, 3),
      shot: data.shot || 'clear',
      requested: data.requested || null,
      match: data.requested ? data.requested === data.shot : null,
      dropHold: !!data.dropHold,
      az: round(data.az, 4),
      azRaw: round(data.azRaw, 4),
      el: round(data.el, 4),
      om: round(data.om, 1),
      elStart: round(data.elStart, 4),
      elMax: round(data.elMax, 4),
      elMin: round(data.elMin, 4),
      elAtPeak: round(data.elAtPeak, 4),
      sweepDeg: round(data.sweepDeg, 1),
      lag: round(data.lag, 1),
    };
    sess.recent.push(rec);
    if (sess.recent.length > 12) sess.recent.shift();
    this.write(sess, rec);
  }

  /** 服务端确认的击球：按 swingId + 时间就近配对到具体那次挥拍 */
  hit(slot, { grade, power, swingId, shot, impact } = {}) {
    const [, sess] = this.bySlot(slot);
    if (!sess) return;
    let rec = null;
    for (let i = sess.recent.length - 1; i >= 0; i--) {
      const r = sess.recent[i];
      if (r.hitAt) continue;
      if (swingId != null && r.swingId === swingId) { rec = r; break; }
      if (!rec && swingId == null) rec = r;
    }
    if (rec) rec.hitAt = Date.now();
    this.write(sess, {
      type: 'hit',
      t: this.ms(sess),
      seq: rec ? rec.seq : null,
      slot,
      swingId: swingId ?? null,
      grade: grade || '',
      power: round(power, 3),
      shot: shot || 'clear',
      q: round(impact?.q, 3),
      contact: round(impact?.y, 3),
      ball: impact ? { x: round(impact.x, 3), y: round(impact.y, 3), z: round(impact.z, 3) } : null,
      target: impact ? { tx: round(impact.tx, 2), tz: round(impact.tz, 2), T: round(impact.T, 3) } : null,
    });
  }

  miss(slot, { swingId, ball } = {}) {
    const [, sess] = this.bySlot(slot);
    if (!sess) return;
    let rec = null;
    for (let i = sess.recent.length - 1; i >= 0; i--) {
      const r = sess.recent[i];
      if (r.missAt || r.hitAt) continue;
      if (swingId != null && r.swingId === swingId) { rec = r; break; }
    }
    if (rec) rec.missAt = Date.now();
    this.write(sess, {
      type: 'miss',
      t: this.ms(sess),
      seq: rec ? rec.seq : null,
      slot,
      swingId: swingId ?? null,
      ball: ball ? { x: round(ball.x, 3), y: round(ball.y, 3), z: round(ball.z, 3) } : null,
    });
  }

  point({ winner, reason, score, rally, phase } = {}) {
    for (const [, sess] of this.sessions) {
      this.write(sess, {
        type: 'point',
        t: this.ms(sess),
        winner: winner || null,
        reason: reason || '',
        score: score || null,
        rally: rally ?? null,
        phase: phase || null,
      });
    }
  }

  /** 进程退出前把缓冲写盘 */
  flushAll() {
    for (const [id] of [...this.sessions.keys()]) this.close(id, 'shutdown');
  }
}

function round(v, n = 3) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const m = 10 ** n;
  return Math.round(v * m) / m;
}

export const recorder = new Recorder();
