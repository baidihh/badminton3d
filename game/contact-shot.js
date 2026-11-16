import { backhandApproach } from '../public/js/backhand-motion.js';
import { aimTarget } from '../public/js/control.js';
import { CONTACT_TIME } from '../public/js/stroke.js';
import { contactFrame, courtAxes, CONTACT_WINDOW, STRING_HALF_WIDTH, STRING_HALF_LENGTH } from '../public/js/contact-racket.js';
import { clamp, DRAG, G, NET_H } from './constants.js';
import { integrate, solveLaunch } from './physics.js';

export function isContactShot(shot) {
  return shot === 'net' || shot === 'smash' || shot === 'drive' || shot === 'slice';
}

export function netOpportunity(player, ball) {
  const { forward } = courtAxes(player);
  return ball.z * forward < 0 && Math.abs(ball.z) < 2.25 && ball.y < 1.9;
}

function sliceLaunch(x, y, z, targetX, targetZ, duration) {
  let launch;
  for (let i = 0; i < 8; i++) {
    launch = solveLaunch({ x, y, z }, targetX, targetZ, duration + i * .025);
    if (launch.netY >= NET_H + .21) break;
  }
  return launch;
}

export function planContact(player, ball, input, startedAt) {
  const predicted = { ...ball };
  for (let i = 0; i < 8; i++) integrate(predicted, CONTACT_TIME / 8);
  const { forward, hand } = courtAxes(player);
  const net = input.shot === 'net';
  const drive = input.shot === 'drive';
  const slice = input.shot === 'slice';
  const plant = slice && player.rearPlan?.kind === 'slice' ? backhandApproach(player.rearPlan, startedAt + CONTACT_TIME) : null;
  const plantX = plant?.x ?? player.x + player.mvx * .075;
  const plantZ = plant?.z ?? player.z + player.mvz * .075;
  const x = forward * (predicted.x - plantX);
  const z = forward * (predicted.z - plantZ);
  const variant = x * hand < -.12 ? 'backhand' : 'forehand';
  const anchor = {
    x: clamp(x, -.58, .58),
    y: clamp(predicted.y, net ? .52 : 2.04, net ? 1.8 : 2.72),
    z: clamp(z, net ? .37 : .16, net ? .97 : .82),
  };
  // Limit the available lateral extension when reaching high or far forward.
  const extent = net ? .65 - .32 * Math.max(0, anchor.z - .63) : .55;
  anchor.x = clamp(anchor.x, -extent, extent);
  if (drive) {
    anchor.x = hand * clamp(x * hand, .35, .91);
    anchor.y = clamp(predicted.y, .56, 1.63);
    anchor.z = clamp(z, -.28, .64);
  }
  if (slice) {
    anchor.x = -hand * clamp(-x * hand, .54, 1.05);
    anchor.y = clamp(predicted.y, 1.27, 2.04);
    anchor.z = clamp(z, -.68, .13);
  }
  const originX = (plant?.x ?? player.x) + forward * anchor.x;
  const originZ = (plant?.z ?? player.z) + forward * anchor.z;
  const targetX = Number.isFinite(input.tx) ? clamp(input.tx, -2.45, 2.45) : aimTarget(player.side, input.dir, originX);
  const dx = targetX - originX;
  const depth = net ? 1.23 : drive ? 5.65 : slice ? 1.45 : 4.3;
  const dz = forward * Math.max(.8, depth - originZ * forward);
  const length = Math.hypot(dx, dz);
  const azX = dx / length;
  const azZ = dz / length;
  let speed, pitch;
  if (net) {
    // Nominal touch direction. Estimate time to the tape with high drag, then
    // set the face angle once. Real contacts are free to hit the tape or go out.
    speed = clamp(length * (1.53 + input.power * .34), 2.25, 8.2);
    const netDistance = Math.abs(originZ / azZ);
    const timeToTape = Math.max(.055, Math.expm1(DRAG * netDistance) / (DRAG * speed));
    const rise = clamp((NET_H + .13 - anchor.y) / timeToTape + .5 * G * timeToTape, .28, 4.8);
    pitch = Math.atan2(rise, speed);
    speed = Math.hypot(speed, rise);
  } else if (slice) {
    const flight = 1.06 - input.power * .14;
    const reference = sliceLaunch(originX, anchor.y, originZ, targetX, forward * depth, flight);
    speed = Math.hypot(reference.vx, reference.vy, reference.vz) / (Math.abs(dx) > .85 ? .84 : .82);
    pitch = Math.atan2(reference.vy, Math.hypot(reference.vx, reference.vz));
  } else if (drive) {
    speed = 17 + input.power * 8;
    const distance = Math.abs(originZ / azZ);
    const horizontal = speed * .89;
    const time = Math.expm1(DRAG * distance) / (DRAG * horizontal);
    pitch = clamp(Math.atan2((NET_H + .28 - anchor.y) / time + .59 * G * time, horizontal), .075, .42);
  } else {
    speed = 22 + input.power * 27;
    pitch = -clamp((anchor.y - 1.78) / Math.max(2.8, Math.abs(originZ)), .055, .32);
  }
  return { id: player.swingId, startedAt, shot: input.shot, variant: slice ? 'backhand' : drive ? 'forehand' : variant, anchor, forward,
    direction: Math.abs(dx) > .85 ? 'cross' : 'straight',
    aim: { x: azX, z: azZ, pitch, speed }, hit: false, contact: null };
}

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const mix = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });

export function sweepStrings(player, fromPlayer, stroke, previous, ball, now, dt) {
  const age = now - stroke.startedAt;
  if (age < CONTACT_TIME - CONTACT_WINDOW || age - dt > CONTACT_TIME + CONTACT_WINDOW) return null;
  const poseAt = fraction => contactFrame({ ...player, ...mix(fromPlayer, player, fraction) }, stroke, age - dt * (1 - fraction));
  let previousDistance;
  for (let i = 0; i <= 8; i++) {
    const f = i / 8;
    const pose = poseAt(f);
    const cork = mix(previous, ball, f);
    const distance = dot(sub(cork, pose.center), pose.normal);
    const crossed = i > 0 && previousDistance > 0 && distance <= 0;
    const at = crossed ? f - (1 / 8) * (-distance / (previousDistance - distance)) : f;
    previousDistance = distance;
    if (!crossed && Math.abs(distance) > .028) continue;
    const atAge = age - dt * (1 - at);
    if (Math.abs(atAge - CONTACT_TIME) > CONTACT_WINDOW) continue;
    const frame = poseAt(at), position = mix(previous, ball, at);
    const delta = sub(position, frame.center);
    const axial = dot(delta, frame.shaft) / (STRING_HALF_LENGTH + .025);
    const lateral = dot(delta, cross(frame.shaft, frame.normal)) / (STRING_HALF_WIDTH + .025);
    const edge = Math.hypot(axial, lateral);
    const { forward } = courtAxes(player);
    if (edge > 1 || position.z * forward >= 0 || position.y < .06) continue;
    const a = contactFrame(player, stroke, atAge - .003).center;
    const b = contactFrame(player, stroke, atAge + .003).center;
    const racketSpeed = Math.max(0, dot(sub(b, a), frame.normal) / .006);
    return { ...frame, position, age: atAge, edge, racketSpeed };
  }
  return null;
}

export function contactVelocity(stroke, hit, incoming) {
  const normal = hit.normal;
  const incomingSpeed = incoming.vx * normal.x + incoming.vy * normal.y + incoming.vz * normal.z;
  const net = stroke.shot === 'net';
  // Intent controls racket effort; string-bed speed, incoming ball and edge
  // contact perturb the transfer. This is an arcade-scale restitution model.
  const transfer = net ? .36 : stroke.shot === 'drive' ? .40 : stroke.shot === 'slice' ? .15 : .62;
  const speed = Math.max(.5, (stroke.aim.speed * .84 + hit.racketSpeed * transfer - incomingSpeed * .09) * (1 - .43 * hit.edge ** 2));
  return { vx: speed * normal.x + incoming.vx * .025, vy: speed * normal.y + incoming.vy * .025,
    vz: speed * normal.z + incoming.vz * .025 };
}
