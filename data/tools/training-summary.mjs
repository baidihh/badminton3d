#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// node data/tools/training-summary.mjs [--dir data/sessions] [--json]
// Prompt and input stages share an attempt id. Exclusion is append-only and
// applies to the entire trial even when source files are read out of order.
export function summarizeTraining(records) {
  const sessions = new Set();
  const trials = new Map();
  for (const record of records) {
    if (record?.type !== 'training' || typeof record.sessionId !== 'string') continue;
    sessions.add(record.sessionId);
    if (typeof record.attemptId !== 'string') continue;
    const key = JSON.stringify([record.sessionId, record.attemptId]);
    let trial = trials.get(key);
    if (!trial) {
      trial = { sessionId: record.sessionId, attemptId: record.attemptId, prompt: null, input: null, result: null, exclusion: null };
      trials.set(key, trial);
    }
    if (record.event === 'attempt' && record.stage === 'prompt') trial.prompt = record;
    if (record.event === 'attempt' && record.stage === 'input') trial.input = record;
    if (record.event === 'result') trial.result = record;
    if (record.event === 'exclude') trial.exclusion = record;
  }

  const attempts = [...trials.values()].map(({ sessionId, attemptId, prompt, input, result, exclusion }) => ({
    sessionId, attemptId,
    index: prompt?.index ?? input?.index ?? result?.index ?? null,
    requestedTarget: prompt?.requestedTarget ?? input?.requestedTarget ?? result?.requestedTarget ?? null,
    labelSource: prompt?.labelSource ?? input?.labelSource ?? null,
    compliance: prompt?.compliance ?? input?.compliance ?? null,
    stance: prompt?.stance ?? null,
    prompted: !!prompt, submitted: !!input, completed: !!result,
    excluded: !!exclusion, exclusionReason: exclusion?.reason ?? null,
    observedInput: input?.observedInput ?? null,
    sensorSampleCount: input?.sensorCapture?.samples?.length ?? 0,
    plannedTarget: result?.plannedTarget ?? null,
    observedResult: result?.result ?? null,
  }));
  const valid = attempts.filter((attempt) => !attempt.excluded);
  const usable = (attempt) => attempt.prompted && attempt.submitted && attempt.completed;
  const perRequestedTarget = {};
  for (const target of ['straight_back', 'cross_back']) {
    const targetAttempts = valid.filter((attempt) =>
      (typeof attempt.requestedTarget === 'string' ? attempt.requestedTarget : attempt.requestedTarget?.id) === target);
    const completed = targetAttempts.filter(usable);
    const evaluated = completed.filter((attempt) => typeof attempt.observedResult?.inTarget === 'boolean');
    const inTarget = evaluated.filter((attempt) => attempt.observedResult.inTarget).length;
    perRequestedTarget[target] = {
      prompted: targetAttempts.filter((attempt) => attempt.prompted).length,
      submitted: targetAttempts.filter((attempt) => attempt.submitted).length,
      completed: completed.length, evaluated: evaluated.length, inTarget,
      targetMatchRate: evaluated.length ? inTarget / evaluated.length : null,
    };
  }
  return {
    sessions: sessions.size,
    excluded: attempts.length - valid.length,
    usableResults: valid.filter(usable).length,
    pending: valid.filter((attempt) => !usable(attempt)).length,
    labelPolicy: 'requestedTarget 是系统事先提示；compliance=assumed 未独立核验用户意图；actual 是仿真落点，目标命中率不是意图识别准确率。',
    perRequestedTarget, attempts,
  };
}

function* readRecords(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.jsonl')) continue;
    for (const line of fs.readFileSync(path.join(dir, name), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      // A live recording may end in an incomplete line; only fold full records.
      try { yield JSON.parse(line); } catch { /* skip incomplete records */ }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  const dir = dirIndex >= 0 ? args[dirIndex + 1] : path.join(process.env.RECORD_DIR || path.join(process.cwd(), 'data'), 'sessions');
  if (!dir) throw new Error('--dir 需要提供目录');
  const summary = summarizeTraining(readRecords(dir));
  if (args.includes('--json')) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`采集目录：${dir}`);
    console.log(`训练 ${summary.sessions} 组 · 有效结果 ${summary.usableResults} · 排除 ${summary.excluded} · 未完成 ${summary.pending}`);
    for (const [target, data] of Object.entries(summary.perRequestedTarget)) {
      const rate = data.targetMatchRate === null ? '—' : `${(data.targetMatchRate * 100).toFixed(0)}%`;
      console.log(`${target}：提示 ${data.prompted} · 输入 ${data.submitted} · 有效结果 ${data.completed} · 目标命中 ${data.inTarget}/${data.evaluated} (${rate})`);
    }
    console.log(summary.labelPolicy);
  }
}
