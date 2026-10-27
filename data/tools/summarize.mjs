#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 采集数据汇总：把 data/sessions/*.jsonl 聚合成一份可读统计
// 用法：
//   node data/tools/summarize.mjs                # 汇总全部
//   node data/tools/summarize.mjs --json         # 只输出 JSON
//   node data/tools/summarize.mjs --dir 某目录
// ============================================================

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const dirArg = args.indexOf('--dir');
const root = dirArg >= 0 ? args[dirArg + 1] : path.join(process.cwd(), 'data', 'sessions');

function readLines(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.jsonl')) continue;
    const file = path.join(dir, f);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    let sess = {
      file: f, meta: null, pose: 0,
      swings: [], hitsBySeq: new Map(), hitQueue: new Map(),
      misses: 0, points: [],
    };
    for (const line of lines) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'session') sess.meta = o;
      else if (o.type === 'pose') sess.pose++;
      else if (o.type === 'swing') sess.swings.push(o);
      else if (o.type === 'hit') {
        if (o.seq != null) sess.hitsBySeq.set(o.seq, o);
        else {
          const q = sess.hitQueue.get(o.swingId) || [];
          q.push(o);
          sess.hitQueue.set(o.swingId, q);
        }
      } else if (o.type === 'miss') sess.misses++;
      else if (o.type === 'point') sess.points.push(o);
    }
    out.push(sess);
  }
  return out;
}

const deg = (r) => (typeof r === 'number' ? +(r * 180 / Math.PI).toFixed(1) : null);
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const round = (v, n = 3) => (typeof v === 'number' ? Math.round(v * 10 ** n) / 10 ** n : null);

function summarize(sessions) {
  const perShot = {};
  const grades = {};
  const hands = {};
  let swings = 0;
  let hits = 0;
  let misses = 0;
  let poses = 0;
  let matches = 0;
  const elapsed = [];
  const labelPairs = [];

  const bump = (shot) => {
    perShot[shot] = perShot[shot] || {
      swings: 0, hits: 0, hitRate: 0,
      power: [], peak: [], azDeg: [], elDeg: [], om: [], flyT: [],
      grade: {},
    };
    return perShot[shot];
  };

  for (const s of sessions) {
    poses += s.pose;
    if (s.meta) {
      hands[s.meta.hand || 'right'] = (hands[s.meta.hand || 'right'] || 0) + 1;
    }
    for (const sw of s.swings) {
      swings++;
      const st = bump(sw.shot || 'clear');
      st.swings++;
      if (typeof sw.power === 'number') st.power.push(sw.power);
      if (typeof sw.peak === 'number') st.peak.push(sw.peak);
      if (typeof sw.az === 'number') st.azDeg.push(deg(sw.az));
      if (typeof sw.el === 'number') st.elDeg.push(deg(sw.el));
      if (typeof sw.om === 'number') st.om.push(sw.om);

      let hit = sw.seq != null ? s.hitsBySeq.get(sw.seq) : null;
      if (!hit) {
        const q = s.hitQueue.get(sw.swingId);
        if (q && q.length) hit = q.shift();
      }
      if (hit) {
        hits++;
        matches++;
        st.hits++;
        st.grade[hit.grade || 'unknown'] = (st.grade[hit.grade || 'unknown'] || 0) + 1;
        if (typeof hit.target?.T === 'number') st.flyT.push(hit.target.T);
        grades[hit.grade || 'unknown'] = (grades[hit.grade || 'unknown'] || 0) + 1;
      }
      if (sw.requested) {
        labelPairs.push({
          req: sw.requested,
          detected: sw.shot || 'clear',
          server: hit ? hit.shot : null,
          grade: hit ? hit.grade : null,
        });
      }
    }
    misses += s.misses;
    if (s.points.length && s.meta?.iso) {
      const last = s.points[s.points.length - 1];
      if (typeof last.t === 'number') elapsed.push(last.t / 1000);
    }
  }

  for (const k of Object.keys(perShot)) {
    const st = perShot[k];
    st.hitRate = st.swings ? round(st.hits / st.swings, 3) : 0;
    st.avgPower = round(avg(st.power));
    st.maxPeak = st.peak.length ? Math.round(Math.max(...st.peak)) : null;
    st.avgPeak = round(avg(st.peak), 1);
    st.elRangeDeg = st.elDeg.length ? [Math.round(Math.min(...st.elDeg)), Math.round(Math.max(...st.elDeg))] : null;
    st.azRangeDeg = st.azDeg.length ? [Math.round(Math.min(...st.azDeg)), Math.round(Math.max(...st.azDeg))] : null;
    st.avgOmega = round(avg(st.om), 1);
    st.avgFlyT = round(avg(st.flyT), 2);
    for (const key of ['power', 'peak', 'azDeg', 'elDeg', 'om', 'flyT']) delete st[key];
  }

  const labeling = labelPairs.length ? buildLabeling(labelPairs) : null;

  return {
    sessions: sessions.length,
    poseSamples: poses,
    swings, hits, misses,
    hitRate: swings ? round(hits / swings, 3) : 0,
    hands,
    grades,
    perShot,
    avgSessionSec: round(avg(elapsed), 1),
    labeling,
  };
}

/** 标注对照：要求球路 vs 手机判定 / 服务端最终球路 */
function buildLabeling(pairs) {
  const shots = ['clear', 'drop', 'smash'];
  const matrix = {};
  for (const r of shots) {
    matrix[r] = { clear: 0, drop: 0, smash: 0 };
  }
  let detectedOk = 0;
  let serverOk = 0;
  let serverN = 0;
  for (const p of pairs) {
    if (!matrix[p.req]) matrix[p.req] = { clear: 0, drop: 0, smash: 0 };
    matrix[p.req][p.detected] = (matrix[p.req][p.detected] || 0) + 1;
    if (p.req === p.detected) detectedOk++;
    if (p.server) {
      serverN++;
      if (p.req === p.server) serverOk++;
    }
  }
  return {
    total: pairs.length,
    detectedAcc: round(detectedOk / pairs.length, 3),
    serverAcc: serverN ? round(serverOk / serverN, 3) : null,
    serverN,
    matrix,
  };
}

const sessions = readLines(root);
const data = summarize(sessions);

if (asJson) {
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

const pct = (v) => (typeof v === 'number' ? (v * 100).toFixed(0) + '%' : '—');
const fmt = (v) => (v === null || v === undefined ? '—' : String(v));

console.log(`采集目录：${root}`);
console.log(`会话 ${data.sessions} · 姿态样本 ${data.poseSamples} · 挥拍 ${data.swings} · 命中 ${data.hits} · 漏击 ${data.misses} · 命中率 ${pct(data.hitRate)}`);
console.log(`持拍手：${Object.entries(data.hands).map(([k, v]) => `${k}=${v}`).join('  ') || '—'}`);
console.log(`评价分布：${Object.entries(data.grades).map(([k, v]) => `${k}=${v}`).join('  ') || '—'}`);
console.log('');
console.log('球路      挥拍   命中率   平均力量  峰值均/最大   仰角范围(°)    方位范围(°)   平均角速度');
for (const [k, v] of Object.entries(data.perShot)) {
  console.log(
    `${k.padEnd(8)}  ${String(v.swings).padStart(4)}  ${pct(v.hitRate).padStart(6)}  ` +
    `${fmt(v.avgPower).padStart(8)}  ${fmt(v.avgPeak).padStart(5)}/${fmt(v.maxPeak).padEnd(5)}  ` +
    `${fmt(v.elRangeDeg ? v.elRangeDeg.join('~') : null).padStart(12)}  ` +
    `${fmt(v.azRangeDeg ? v.azRangeDeg.join('~') : null).padStart(11)}  ` +
    `${fmt(v.avgOmega).padStart(9)}°/s`
  );
}

if (data.labeling) {
  const L = data.labeling;
  const nameOf = { clear: '高远', drop: '吊球', smash: '杀球' };
  console.log('');
  console.log(`标注对照：共 ${L.total} 拍 · 手机判定一致 ${pct(L.detectedAcc)}` +
    (L.serverAcc === null ? '' : ` · 服务端最终球路一致 ${pct(L.serverAcc)}（${L.serverN} 拍命中）`));
  console.log('要求 \\ 判定   高远   吊球   杀球');
  for (const req of ['clear', 'drop', 'smash']) {
    const row = L.matrix[req] || {};
    console.log(`${nameOf[req].padEnd(8)}  ${String(row.clear || 0).padStart(4)}  ` +
      `${String(row.drop || 0).padStart(5)}  ${String(row.smash || 0).padStart(5)}`);
  }
}
