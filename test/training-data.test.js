import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as recording from '../recorder.js';

function setup(t, enabled = true) {
  assert.equal(typeof recording.Recorder, 'function');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'badminton-training-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return new recording.Recorder({ root, enabled });
}

test('training lifecycle is written to a real JSONL file with requested target and observed landing', async (t) => {
  const recorder = setup(t);
  const file = recorder.open('controller-id', { slot: 'left' });
  assert.equal(recorder.isRecording('controller-id'), true);
  assert.equal(recorder.isRecording('unknown'), false);
  const common = { sessionId: 'training-session', attemptId: 'trial-1', requestedTarget: 'straight_back' };
  const events = [
    { event: 'start', sessionId: common.sessionId },
    { ...common, event: 'attempt', stage: 'prompt', labelSource: 'prompted', compliance: 'assumed' },
    { ...common, event: 'attempt', stage: 'input', observedInput: { dir: -0.7 }, sensorCapture: { samples: [] } },
    { ...common, event: 'result', result: { outcome: 'landed', actual: { x: 1.2, z: 5 }, inTarget: false } },
    { ...common, event: 'exclude', reason: 'user_retry' },
    { event: 'complete', sessionId: common.sessionId },
    { event: 'stop', sessionId: common.sessionId },
  ];
  for (const event of events) assert.equal(recorder.training('controller-id', event), true);
  const stream = recorder.sessions.get('controller-id').stream;
  const closed = once(stream, 'close');
  recorder.close('controller-id');
  assert.equal(recorder.isRecording('controller-id'), false);
  assert.equal(recorder.training('controller-id', events[0]), false);
  await closed;
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].type, 'session');
  assert.equal(rows.at(-1).type, 'session_end');
  const training = rows.filter((row) => row.type === 'training');
  assert.equal(training.length, events.length);
  for (let i = 0; i < events.length; i++) {
    const { type, t: elapsed, ...event } = training[i];
    assert.equal(typeof elapsed, 'number');
    assert.ok(elapsed >= 0);
    assert.deepEqual(event, events[i]);
  }
});

test('recording disabled cannot be enabled by opening or submitting training', (t) => {
  const recorder = setup(t, false);
  assert.equal(recorder.open('disabled'), null);
  assert.equal(recorder.isRecording('disabled'), false);
  assert.equal(recorder.training('disabled', { event: 'start' }), false);
  assert.equal(recorder.status().on, false);
  assert.equal(recorder.status().active, 0);
});

test('reopening a controller creates a distinct file and flushAll closes full controller ids', async (t) => {
  const recorder = setup(t);
  const one = recorder.open('controller-long-id');
  const firstClosed = once(recorder.sessions.get('controller-long-id').stream, 'close');
  const two = recorder.open('controller-long-id');
  assert.notEqual(one, two);
  const secondClosed = once(recorder.sessions.get('controller-long-id').stream, 'close');
  recorder.flushAll();
  assert.equal(recorder.status().active, 0);
  await Promise.all([firstClosed, secondClosed]);
  assert.ok(fs.readFileSync(one, 'utf8').includes('reopen'));
  assert.ok(fs.readFileSync(two, 'utf8').includes('shutdown'));
});

test('stream failures reject further training and expose recording error', async (t) => {
  const recorder = setup(t);
  recorder.open('controller-id');
  const sess = recorder.sessions.get('controller-id');
  await new Promise((resolve, reject) => sess.stream.write('', (error) => error ? reject(error) : resolve()));
  const failed = once(sess.stream, 'error');
  sess.stream.destroy(new Error('test disk write failure'));
  await failed;
  assert.equal(recorder.isRecording('controller-id'), false);
  assert.equal(recorder.training('controller-id', { event: 'start' }), false);
  assert.match(recorder.status().lastError, /test disk write failure/);
  recorder.close('controller-id');
});

test('summary merges attempt stages, applies exclusions in any order and separates prompts from observations', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'badminton-summary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const event = (attemptId, fields = {}) => ({ type: 'training', sessionId: 'session-1', attemptId, ...fields });
  const prompt = (attemptId, requestedTarget = 'straight_back', fields = {}) => event(attemptId, {
    event: 'attempt', stage: 'prompt', requestedTarget, labelSource: 'prompted', compliance: 'assumed', ...fields,
  });
  const input = (attemptId) => event(attemptId, { event: 'attempt', stage: 'input', observedInput: { dir: 0.3 } });
  const result = (attemptId, inTarget) => event(attemptId, {
    event: 'result', plannedTarget: { x: 1, z: 5 },
    result: { actual: { x: 0.7, z: 4.9 }, inTarget, outcome: 'landed' },
  });
  const rows = [
    prompt('a'), input('a'), result('a', true), event('a', { event: 'exclude', reason: 'user_retry' }),
    event('b', { event: 'exclude', reason: 'user_retry' }), prompt('b'), input('b'), result('b', true),
    prompt('c'), input('c'), input('c'), result('c', false),
    prompt('pending'),
    prompt('object-target', { id: 'straight_back', x: -1.8, z: 5.25 }), input('object-target'), result('object-target', true),
    prompt('c', 'cross_back', { sessionId: 'session-2' }),
    { ...input('c'), sessionId: 'session-2' }, { ...result('c', true), sessionId: 'session-2' },
    { type: 'swing', requested: 'clear' },
  ];
  fs.writeFileSync(path.join(root, 'session.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../data/tools/training-summary.mjs', import.meta.url)), '--dir', root, '--json'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const summary = JSON.parse(cli.stdout);
  assert.equal(summary.sessions, 2);
  assert.equal(summary.attempts.length, 6);
  assert.equal(summary.excluded, 2);
  assert.equal(summary.usableResults, 3);
  assert.equal(summary.pending, 1);
  assert.equal(summary.perRequestedTarget.straight_back.completed, 2);
  assert.equal(summary.perRequestedTarget.straight_back.inTarget, 1);
  assert.equal(summary.perRequestedTarget.cross_back.completed, 1);
  assert.equal(summary.perRequestedTarget.cross_back.inTarget, 1);
  const usable = summary.attempts.find((attempt) => attempt.sessionId === 'session-1' && attempt.attemptId === 'c');
  assert.equal(usable.requestedTarget, 'straight_back');
  assert.equal(usable.labelSource, 'prompted');
  assert.equal(usable.compliance, 'assumed');
  assert.deepEqual(usable.observedInput, { dir: 0.3 });
  assert.deepEqual(usable.plannedTarget, { x: 1, z: 5 });
  assert.deepEqual(usable.observedResult.actual, { x: 0.7, z: 4.9 });
});
