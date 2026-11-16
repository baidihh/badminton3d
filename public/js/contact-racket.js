import { backhandRacket } from './backhand-motion.js';
import { rearStroke } from './rear-forehand.js';
import { CONTACT_TIME, sampleStroke } from './stroke.js';

// World dimensions of the virtual string bed, shared by simulation and rendering.
export const STRING_HALF_WIDTH = .115;
export const STRING_HALF_LENGTH = .145;
export const CONTACT_WINDOW = .047;

export function courtAxes(player) {
  const forward = player.side === 'right' ? -1 : 1;
  return { forward, hand: player.hand === 'left' ? 1 : -1 };
}

export function contactFrame(player, stroke, age) {
  if (stroke.shot === 'slice') return backhandRacket(player, stroke, age);
  const { forward, hand } = courtAxes(player);
  const aim = stroke.aim;
  const drive = { x: forward * aim.x, y: Math.sin(aim.pitch), z: forward * aim.z };
  const rear = stroke.shot === 'drive';
  const local = rear ? rearStroke(age, stroke.anchor, hand) : sampleStroke(age, stroke.shot, hand, stroke.anchor, stroke.variant, drive);
  const phase = Math.max(-1, Math.min(1, (age - CONTACT_TIME) / .09));
  // Open/close the face over the last part of the stroke. The nominal face is
  // reached at the planned contact. Early and late hits inherit a different pitch.
  const pitch = aim.pitch - phase * (stroke.shot === 'net' ? .13 : .25);
  const normal = { x: aim.x * Math.cos(pitch), y: Math.sin(pitch), z: aim.z * Math.cos(pitch) };
  const shaftTilt = stroke.shot === 'net' ? -.18 + phase * .34 : .11 + phase * .57;
  const side = stroke.variant === 'backhand' ? -hand : hand;
  const shaft = { x: forward * side * shaftTilt, y: 1, z: forward * (stroke.shot === 'net' ? .73 : .22) };
  if (rear) {
    shaft.x = forward * hand * (.93 - .38 * phase);
    shaft.y = .26 - .28 * phase;
    shaft.z = forward * (.08 + .61 * phase);
  }
  // Orthogonalize the shaft to the face so the visible strings and sweep agree.
  const dot = shaft.x * normal.x + shaft.y * normal.y + shaft.z * normal.z;
  shaft.x -= dot * normal.x;
  shaft.y -= dot * normal.y;
  shaft.z -= dot * normal.z;
  const length = Math.hypot(shaft.x, shaft.y, shaft.z);
  shaft.x /= length;
  shaft.y /= length;
  shaft.z /= length;
  return { center: { x: player.x + forward * local.x, y: local.y, z: player.z + forward * local.z }, normal, shaft };
}
