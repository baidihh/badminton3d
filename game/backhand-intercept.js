import { backhandRecoveryTime } from '../public/js/backhand-motion.js';
import { integrate } from './physics.js';
import { courtAxes } from '../public/js/contact-racket.js';
import { clamp } from './constants.js';

export function backhandOpportunity(player, ball) {
  const { forward, hand } = courtAxes(player);
  return ball.z * forward < -4.15 && ball.x * forward * hand < -.85 && ball.y >= 1.22 && ball.y <= 2.25;
}

export function planBackhandIntercept(player, ball, now) {
  const { forward, hand } = courtAxes(player);
  if (ball.vz * forward > -.4) return null;
  const future = { ...ball };
  for (let tick = 1; tick <= 67; tick++) {
    integrate(future, 1 / 60);
    if (future.y < 1.2 || future.z * forward < -6.6) break;
    if (tick < 24 || future.vy > 0 || future.y > 1.96 || !backhandOpportunity(player, future)) continue;
    const goal = { x: clamp(future.x + forward * hand * .88, -2.57, 2.57), z: future.z + forward * .34 };
    const duration = tick / 60 - .065;
    const sideTravel = (goal.x - player.x) * forward * hand;
    const depthTravel = (goal.z - player.z) * forward;
    const distance = Math.hypot(sideTravel, depthTravel);
    if (sideTravel > -.20 || depthTravel > -.20 || distance > duration * (player.ai ? 2.75 : 3.25)) continue;
    const from = { x: player.x, z: player.z };
    return { kind: 'slice', side: player.side, hand: player.hand, from, goal, duration, startedAt: now,
      recoveryTime: backhandRecoveryTime(from, goal) };
  }
  return null;
}
