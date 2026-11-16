import { backhandClips } from './backhand-clip-data.js';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const angle = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

export function sampleBackhand(progress, direction = 'straight') {
  const clip = backhandClips[direction] || backhandClips.straight;
  const frame = clamp(progress, 0, 1) * (clip.length - 1);
  const i = Math.min(Math.floor(frame), clip.length - 2);
  const a = clip[i], b = clip[i + 1], f = frame - i;
  const point = offset => ({ x: mix(a[offset], b[offset], f), y: mix(a[offset + 1], b[offset + 1], f), z: mix(a[offset + 2], b[offset + 2], f) });
  return { hip: point(0), leftFoot: point(3), rightFoot: point(6), freeHand: point(9),
    elbow: point(12), center: point(15), shaft: point(18), normal: point(21), yaw: a[24] + angle(a[24], b[24]) * f,
    footYaw: [25, 26].map(j => a[j] + angle(a[j], b[j]) * f),
    grip: [27, 28, 29, 30, 31].map(j => mix(a[j], b[j], f)) };
}

export const backhandContact = sampleBackhand(.5);

// Source coordinates are +X to the racket side and -Z toward the net.
export function backhandAxes(side, hand) {
  const forward = side === 'right' ? -1 : 1;
  return { x: (hand === 'left' ? 1 : -1) * forward, z: -forward };
}

const PLANT_PAUSE = .22;
const RECOVERY_START = .58;

// The lesson clip overlaps its two recovery swings. In a match, keep one
// support foot down and preserve each authored lift, path and landing target.
function recoverySteps() {
  const frames = backhandClips.straight;
  const end = frames.length - 1;
  const steps = [];
  for (const [name, y] of [['leftFoot', 4], ['rightFoot', 7]]) {
    let first = null;
    for (let i = Math.ceil(RECOVERY_START * end); i <= end; i++) {
      if (frames[i][y] > .091) first ??= i - 1;
      else if (first !== null) {
        steps.push({ name, from: first / end, to: i / end });
        first = null;
      }
    }
  }
  steps.sort((a, b) => a.from - b.from);
  let cursor = RECOVERY_START;
  for (const step of steps) {
    step.start = Math.max(step.from, cursor);
    step.end = step.start + step.to - step.from;
    cursor = step.end + .006;
  }
  const scale = Math.min(1, (.99 - RECOVERY_START) / (cursor - RECOVERY_START));
  for (const step of steps) {
    step.start = RECOVERY_START + (step.start - RECOVERY_START) * scale;
    step.end = RECOVERY_START + (step.end - RECOVERY_START) * scale;
  }
  return steps;
}
const recoveryTrack = recoverySteps();

function recoveryFoot(name, progress) {
  let source = RECOVERY_START;
  for (const step of recoveryTrack) {
    if (step.name !== name) continue;
    if (progress < step.start) break;
    if (progress < step.end) {
      source = mix(step.from, step.to, (progress - step.start) / (step.end - step.start));
      return { pose: sampleBackhand(source), stance: false };
    }
    source = step.to;
  }
  return { pose: sampleBackhand(source), stance: true };
}

function approachAt(plan, progress) {
  const pose = sampleBackhand(progress);
  const dx = plan.goal.x - plan.from.x, dz = plan.goal.z - plan.from.z;
  const scaleX = dx / backhandContact.hip.x, scaleZ = dz / (backhandContact.hip.z - 1);
  const axes = backhandAxes(plan.side, plan.hand);
  const before = sampleBackhand(progress - .001);
  const after = sampleBackhand(progress + .001);
  const foot = (name, index) => {
    const recovered = progress >= RECOVERY_START ? recoveryFoot(name, progress) : null;
    const p = (recovered?.pose ?? pose)[name], a = before[name], b = after[name];
    const yaw = (recovered?.pose ?? pose).footYaw[index];
    const still = Math.hypot(b.x - a.x, b.z - a.z) < .001;
    const stance = recovered?.stance ?? (p.y < .091 && still);
    return { x: plan.from.x + p.x * scaleX, z: plan.from.z + (p.z - 1) * scaleZ,
    lift: stance ? 0 : Math.max(0, p.y - .09), yaw: (axes.z < 0 ? 0 : Math.PI) + yaw * (plan.hand === 'left' ? -1 : 1), pitch: 0, stance };
  };
  const left = foot('leftFoot', 0), right = foot('rightFoot', 1);
  return { pose, x: plan.from.x + pose.hip.x * scaleX, z: plan.from.z + (pose.hip.z - 1) * scaleZ,
    feet: plan.hand === 'left' ? { left: right, right: left } : { left, right } };
}

export function backhandRecoveryTime(from, goal) {
  const plan = { from, goal };
  const steps = 96;
  let peak = 0, previous = approachAt(plan, RECOVERY_START);
  for (let i = 1; i <= steps; i++) {
    const frame = approachAt(plan, mix(RECOVERY_START, 1, i / steps));
    const speed = Math.hypot(frame.x - previous.x, frame.z - previous.z) * steps;
    const turnSpeed = Math.abs(angle(previous.pose.yaw, frame.pose.yaw)) * steps;
    peak = Math.max(peak, speed / 3.45, turnSpeed / 10);
    previous = frame;
  }
  return Math.max(.96, peak * 1.10);
}

function supportPelvis(feet, x, z, pose, progress, blend) {
  const pelvis = { x: 0, z: 0, drop: Math.max(0, .98 - pose.hip.y) + .065 * blend };
  const strength = smooth(clamp((progress - RECOVERY_START) / .04, 0, 1));
  for (const planted of Object.values(feet)) {
    const dx = planted.x - x, dz = planted.z - z;
    const distance = Math.hypot(dx, dz);
    const weight = strength * (1 - smooth(clamp(planted.lift / .14, 0, 1)));
    const shift = Math.min(.28, Math.max(0, distance - .41)) * weight;
    if (shift > 0) {
      pelvis.x += dx / distance * shift;
      pelvis.z += dz / distance * shift;
      pelvis.drop += .21 * shift;
    }
  }
  return pelvis;
}

export function backhandApproach(plan, now) {
  const age = now - plan.startedAt;
  const approach = clamp(age / plan.duration, 0, 1);
  const recovery = clamp((age - plan.duration - PLANT_PAUSE) / plan.recoveryTime, 0, 1);
  const progress = approach < 1 ? .42 * approach : .42 + (RECOVERY_START - .42) * clamp((age - plan.duration) / PLANT_PAUSE, 0, 1) + (1 - RECOVERY_START) * recovery;
  const { pose, x, z, feet } = approachAt(plan, progress);
  const blend = Math.min(smooth(clamp(approach / .14, 0, 1)), 1 - smooth(clamp((recovery - .86) / .14, 0, 1)));
  return {
    kind: 'slice', progress, done: recovery === 1, x, z,
    phase: progress < .15 ? 'split' : progress < .285 ? 'crossover' : progress < .35 ? 'confirm' : progress < .423 ? 'lunge' : progress < .585 ? 'plant' : 'recover',
    feet,
    weight: blend, footWeight: smooth(clamp(approach / .14, 0, 1)), pelvis: supportPelvis(feet, x, z, pose, progress, blend),
    yaw: pose.yaw * (plan.hand === 'left' ? -1 : 1),
  };
}

export function sampleBackhandStroke(age, direction) {
  const p = age <= .14 ? mix(.32, .5, clamp(age / .14, 0, 1)) : mix(.5, .72, clamp((age - .14) / .34, 0, 1));
  return sampleBackhand(p, direction);
}

export function backhandRacket(player, stroke, age) {
  const axes = backhandAxes(player.side, player.hand);
  const pose = sampleBackhandStroke(age, stroke.direction);
  const nominal = sampleBackhand(.5, stroke.direction);
  const { forward } = stroke;
  const anchor = stroke.anchor;
  const horizontal = Math.atan2(stroke.aim.x, stroke.aim.z);
  const authored = Math.atan2(nominal.normal.x * axes.x, nominal.normal.z * axes.z);
  const yaw = angle(authored, horizontal);
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const rotate = vector => ({ x: cos * vector.x * axes.x + sin * vector.z * axes.z, y: vector.y, z: cos * vector.z * axes.z - sin * vector.x * axes.x });
  const raw = rotate(pose.normal);
  const elevation = stroke.aim.pitch + .24 * (Math.atan2(raw.y, Math.hypot(raw.x, raw.z)) - Math.asin(nominal.normal.y));
  const azimuth = horizontal + .23 * angle(horizontal, Math.atan2(raw.x, raw.z));
  const normal = { x: Math.sin(azimuth) * Math.cos(elevation), y: Math.sin(elevation), z: Math.cos(azimuth) * Math.cos(elevation) };
  const shaft = rotate(pose.shaft);
  const projection = shaft.x * normal.x + shaft.y * normal.y + shaft.z * normal.z;
  const perpendicular = { x: shaft.x - projection * normal.x, y: shaft.y - projection * normal.y, z: shaft.z - projection * normal.z };
  const length = Math.hypot(perpendicular.x, perpendicular.y, perpendicular.z);
  return { center: {
    x: player.x + forward * anchor.x + axes.x * ((pose.center.x - pose.hip.x) - (nominal.center.x - nominal.hip.x)) * .76,
    y: anchor.y + (pose.center.y - nominal.center.y) * .65,
    z: player.z + forward * anchor.z + axes.z * ((pose.center.z - pose.hip.z) - (nominal.center.z - nominal.hip.z)) * .76,
  }, normal, shaft: { x: perpendicular.x / length, y: perpendicular.y / length, z: perpendicular.z / length } };
}
