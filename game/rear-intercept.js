import { integrate } from './physics.js';
import { courtAxes } from '../public/js/contact-racket.js';
import { clamp, COURT_X } from './constants.js';

export function rearOpportunity(player, ball) {
  const { forward, hand } = courtAxes(player);
  return ball.z * forward < -4.25 && ball.x * forward * hand > .72 && ball.y < 1.74;
}

export function planRearIntercept(player, ball, now) {
  const { forward, hand } = courtAxes(player);
  if (ball.vz * forward >= -.4 || ball.y > 3.85) return null;
  const future = { ...ball };
  for (let tick = 1; tick <= 45; tick++) {
    integrate(future, 1 / 60);
    if (future.y < .43 || Math.abs(future.z) > 6.65) break;
    if (tick < 22 || future.y > 1.42 || !rearOpportunity(player, future)) continue;
    const goal = {
      x: clamp(future.x - forward * hand * .70, -COURT_X + .30, COURT_X - .30),
      z: -forward * clamp(Math.abs(future.z) + .13, 4.42, 6.14),
    };
    const distance = Math.hypot(goal.x - player.x, goal.z - player.z);
    const duration = tick / 60 - .075;
    if (distance < .34 || distance > duration * (player.ai ? 2.55 : 2.9)) continue;
    return { from: { x: player.x, z: player.z }, goal, startedAt: now, duration,
      hand: player.hand, forward, low: clamp((1.32 - future.y) / .66, 0, 1) };
  }
  return null;
}
