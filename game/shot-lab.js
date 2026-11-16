import { Game } from './game.js';
import { solveLaunch } from './physics.js';
import { NET_H } from './constants.js';
import { CONTACT_TIME } from '../public/js/stroke.js';
import { contactFrame } from '../public/js/contact-racket.js';

const DT = 1 / 60;
const feeds = {
  slice: [
    { start: [1.50, 2.28, 1.65], land: [2.42, -6.40], time: 1.43, trigger: 60, player: [.25, -4.1] },
    { start: [1.65, 2.12, 1.20], land: [2.51, -6.46], time: 1.33, trigger: 55, player: [.32, -4.14] },
    { start: [1.95, 2.30, 1.46], land: [2.82, -6.48], time: 1.43, trigger: 60, player: [.48, -4.20] },
  ],
  drive: [
    { start: [-1.53, 2.27, 1.7], land: [-2.38, -6.47], time: 1.46, trigger: 66, player: [-.48, -4.10] },
    { start: [-1.62, 2.12, 1.2], land: [-2.42, -6.48], time: 1.31, trigger: 60, player: [-.59, -4.20] },
    { start: [-1.97, 2.22, 1.5], land: [-2.83, -6.60], time: 1.42, trigger: 65, player: [.68, -3.72] },
  ],
  net: [
    { start: [1.55, 2.04, .24], land: [1.25, -1.83], time: .89, trigger: 24, player: [.57, -2.59] },
    { start: [-1.55, 2.04, .24], land: [-1.25, -1.83], time: .89, trigger: 24, player: [-.58, -2.54] },
    { start: [1.94, 2.07, .20], land: [2.30, -1.82], time: .89, trigger: 24, player: [1.14, -2.42] },
  ],
  smash: [
    { start: [.3, 2.65, 1.3], land: [.55, -5.7], time: 1.47, trigger: 51, player: [0, -4.2] },
    { start: [1.26, 2.8, 1.5], land: [2.52, -5.5], time: 1.53, trigger: 58, player: [.75, -4.2] },
    { start: [-1.42, 2.82, 1.55], land: [-2.55, -6.3], time: 1.64, trigger: 64, player: [-.8, -4.4] },
  ],
};

function seedFeed(game, feed, mirror = 1) {
  const [x, y, z] = feed.start;
  const [tx, tz] = feed.land;
  const origin = { x: x * mirror, y, z };
  game.started = true;
  game.phase = 'rally';
  game.holder = 'right';
  game.left.x = feed.player[0] * mirror;
  game.left.z = feed.player[1];
  game.ball = { ...origin, ...solveLaunch(origin, tx * mirror, tz, feed.time) };
}

export function startBackhandFeed(game, auto) {
  game.doService();
  const feed = feeds.slice[0];
  const mirror = game.left.hand === 'left' ? -1 : 1;
  seedFeed(game, feed, mirror);
  game.backhandFeed = { autoAt: auto ? game.t + feed.trigger * DT : null, dir: mirror };
  game.msg = auto ? '反手来球 · 看落脚和回身' : '反手来球 · 空格挥拍';
}

export function shotReplay(shot, index, angle, timing, legacy = false) {
  const feed = feeds[shot][index];
  const game = new Game();
  if (legacy && ['drive', 'slice'].includes(shot)) game.left.rearAttempt = true;
  seedFeed(game, feed);
  game.right.ai = false;
  // A separate instance reuses match rules without affecting live scores or recordings.
  game.awardPoint = function (winner, reason) {
    this.phase = 'point';
    this.msg = reason;
  };
  const [x] = feed.start;
  const ball = game.ball;
  const trigger = timing === null ? -1 : feed.trigger + timing;
  const dir = angle === 'straight' ? 0 : (x < 0 ? -1 : 1);
  const frames = [];
  let impact = null, net = null;
  for (let tick = 0; tick < (shot === 'slice' ? 270 : 180); tick++) {
    if (tick === trigger && game.phase === 'rally') {
      game.swing('left', shot === 'net' ? .72 : shot === 'slice' ? .52 : .88, dir, .45, legacy && shot === 'net' ? 'drop' : legacy && ['drive', 'slice'].includes(shot) ? 'clear' : shot);
      if (legacy && game.left.stroke) {
        game.left.pending.shot = shot === 'net' ? 'drop' : ['drive', 'slice'].includes(shot) ? 'clear' : shot;
        game.left.stroke.shot = game.left.pending.shot;
        delete game.left.stroke.anchor;
      }
    }
    const player = game.pack(game.left);
    const racket = player.stroke?.anchor ? contactFrame({ ...player, side: 'left' }, player.stroke, player.stroke.age) : null;
    frames.push({ player, ball: { ...ball }, racket });
    const previous = { ...ball };
    game.step(DT);
    if (!impact && game.impact.id) {
      impact = { ...game.impact, tick: tick + 1, speed: Math.hypot(ball.vx, ball.vy, ball.vz) };
    } else if (impact && !net && previous.z < 0) {
      if (game.msg === '触网') {
        net = { fault: true, tick: tick + 1 };
      } else if (ball.z >= 0) {
        const f = -previous.z / (ball.z - previous.z);
        net = { tick: tick + 1, clearance: previous.y + (ball.y - previous.y) * f - NET_H };
      }
    }
    if (game.phase === 'point' && (shot !== 'slice' || !game.left.rearPlan)) {
      frames.push({ player: game.pack(game.left), ball: { ...ball }, racket: null });
      break;
    }
  }
  return { frames, impact, net, trigger, suggested: feed.trigger, result: impact ? game.msg || '出球' : '挥空', dt: DT };
}
