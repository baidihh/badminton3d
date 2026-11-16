import test from 'node:test';
import assert from 'node:assert/strict';
import { shotReplay } from '../game/shot-lab.js';

test('a reachable rear forehand feed plays the approach and keeps the racket foot planted through contact', () => {
  const replay = shotReplay('drive', 0, 'straight', 0);
  assert.equal(replay.impact?.shot, 'drive');
  const frames = replay.frames.filter(frame => frame.player.rearMove);
  assert.ok(frames.some(frame => frame.player.rearMove.phase === 'crossover'));
  const stance = frames.filter(frame => frame.player.rearMove.phase === 'plant');
  assert.ok(stance.length > 5);
  for (const frame of stance) assert.deepEqual(frame.player.rearMove.feet.right, stance[0].player.rearMove.feet.right);
  assert.ok(frames.some(frame => frame.player.rearMove.phase === 'recover'));
});

test('a low rear forehand changes the contact height and a late input misses', () => {
  const regular = shotReplay('drive', 0, 'straight', 0);
  const low = shotReplay('drive', 1, 'straight', 0);
  assert.equal(low.impact?.shot, 'drive');
  assert.ok(low.impact.y < regular.impact.y - .15);
  assert.equal(shotReplay('drive', 1, 'straight', 18).impact, null);
});

test('the authored rear backhand cuts the same feed straight or cross and misses when late', () => {
  const straight = shotReplay('slice', 0, 'straight', 0);
  const cross = shotReplay('slice', 0, 'cross', 0);
  assert.equal(straight.impact?.shot, 'slice');
  assert.equal(cross.impact?.shot, 'slice');
  assert.ok(straight.net?.clearance > .06 && cross.net?.clearance > .06);
  assert.ok(straight.impact.tz < 2.8 && cross.impact.tz < 2.8);
  assert.ok(straight.impact.tx - cross.impact.tx > 1.2);
  assert.ok(straight.frames.some(frame => frame.player.rearMove?.phase === 'confirm'));
  assert.equal(shotReplay('slice', 0, 'straight', 17).impact, null);
});

test('backhand recovery preserves planted foot targets and stays within running pace', () => {
  const { frames, dt } = shotReplay('slice', 0, 'cross', 0);
  const recovery = frames.filter(f => f.player.rearMove?.phase === 'recover');
  assert.ok(recovery.length > 30);
  assert.equal(recovery.at(-1).player.rearMove.done, true);
  const steps = [];
  let moving = null;
  for (const frame of recovery) {
    const { feet } = frame.player.rearMove;
    const next = ['left', 'right'].find(side => !feet[side].stance);
    if (next && next !== moving) steps.push(next);
    moving = next;
  }
  assert.ok(steps.length >= 2, 'recovery includes actual steps');
  assert.ok(steps.every((side, i) => i === 0 || side !== steps[i - 1]), 'recovery alternates feet');
  for (let i = 1; i < recovery.length; i++) {
    const a = recovery[i - 1].player, b = recovery[i].player;
    assert.ok(b.rearMove.feet.left.stance || b.rearMove.feet.right.stance, 'recovery retains one support foot');
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) / dt <= 3.65);
    for (const side of ['left', 'right']) {
      const from = a.rearMove.feet[side], to = b.rearMove.feet[side];
      if (from.stance && to.stance) assert.ok(Math.hypot(to.x - from.x, to.z - from.z) < .007);
    }
  }
});
