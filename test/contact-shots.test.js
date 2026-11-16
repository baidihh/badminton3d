import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../game/game.js';
import { integrate } from '../game/physics.js';

function feed(shot, { x, y, z, dir = 0, offset = 0, vx = 0, vy = 0, vz = 0 }) {
  const game = new Game();
  game.phase = 'rally';
  game.started = true;
  game.holder = 'right';
  game.right.ai = false;
  const p = game.left;
  Object.assign(p, { x: x - .3 + offset, y, z: z - .7 });
  game.autoFootwork = () => {};
  game.ball = { x, y, z, vx, vy, vz };
  game.swing('left', .82, dir, .5, shot);
  for (let i = 0; i < 18 && !game.impact.id && game.phase === 'rally'; i++) game.step(1 / 60);
  return game;
}

function flight(ball) {
  const b = { ...ball };
  let net;
  for (let i = 0; i < 240 && b.y > 0; i++) {
    const prev = { ...b };
    integrate(b, 1 / 120);
    if (prev.z < 0 && b.z >= 0) net = prev.y + (b.y - prev.y) * (-prev.z / (b.z - prev.z));
  }
  return { net, x: b.x, z: b.z };
}

test('the same net feed can travel straight or cross-court just above the tape', () => {
  const position = { x: 1.45, y: 1.45, z: -.77, vy: 1.15 };
  const straight = feed('net', position);
  const cross = feed('net', { ...position, dir: 1 });
  assert.equal(straight.impact.shot, 'net');
  assert.equal(cross.impact.shot, 'net');
  const a = flight(straight.ball), b = flight(cross.ball);
  assert.ok(Math.abs(a.x - position.x) < .3);
  assert.ok(b.x < -.45, JSON.stringify(b));
  assert.ok(b.net > 1.55 && b.net < 1.83, JSON.stringify(b));
  assert.ok(b.z > 0 && b.z < 2, JSON.stringify(b));
});

test('a player stranded a meter away cannot connect with a net shot', () => {
  const game = feed('net', { x: 1.45, y: 1.45, z: -.77, offset: -1.05, vy: 1.15 });
  assert.equal(game.impact.id, undefined);
});

test('a reachable overhead smash launches forward and downward', () => {
  const game = feed('smash', { x: .45, y: 2.56, z: -3.1, vy: 1.1 });
  assert.equal(game.impact.shot, 'smash');
  assert.ok(game.ball.vz > 24);
  assert.ok(game.ball.vy < -2);
  assert.ok(flight(game.ball).net > 1.55);
});

test('a delayed phone smash uses a historical moving racket and keeps its swing ID', () => {
  const game = new Game();
  game.phase = 'rally';
  game.started = true;
  game.holder = 'right';
  game.right.ai = false;
  Object.assign(game.left, { x: .15, z: -3.8 });
  game.autoFootwork = () => {};
  game.ball = { x: .45, y: 2.56, z: -3.1, vx: 0, vy: 1.1, vz: 0 };
  for (let i = 0; i < 16; i++) game.step(1 / 60);
  game.swing('left', .82, 0, .5, 'smash', { lagMs: 110 });
  game.step(1 / 60);
  assert.equal(game.impact.shot, 'smash');
  assert.equal(game.left.stroke.id, game.left.swingId);
  assert.ok(game.impact.y > game.left.stroke.anchor.y - .08);
});
