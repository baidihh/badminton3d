// Match-time version of the reference lab's crossover, lunge and recovery.
// Court-space anchors are fixed for the move. The stroke samples independently
// around the actual input time, so the player can be early or late.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = t => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

function step(from, to, progress, start, end, lift) {
  const t = clamp((progress - start) / (end - start), 0, 1);
  return {
    x: mix(from.x, to.x, ease(t)), z: mix(from.z, to.z, ease(t)),
    yaw: mix(from.yaw, to.yaw, ease(t)), lift: lift * Math.sin(Math.PI * t) ** 2,
    pitch: .21 * Math.sin(2 * Math.PI * t) * Math.sin(Math.PI * t), stance: t === 0 || t === 1,
  };
}

export function rearForehandPose(plan, now) {
  const { from, goal, duration, startedAt, hand, forward, low } = plan;
  const age = now - startedAt;
  const u = clamp(age / duration, 0, 1);
  const after = age - duration;
  const recovery = clamp((after - .22) / .50, 0, 1);
  const side = (hand === 'left' ? 1 : -1) * forward;
  const facing = forward > 0 ? 0 : Math.PI;
  const anchor = (t, x, z, turn = 0) => ({
    x: mix(from.x, goal.x, t) + side * x,
    z: mix(from.z, goal.z, t) + forward * z, yaw: facing - (hand === 'left' ? -1 : 1) * turn,
  });
  const leadStart = anchor(0, .17, 0), trailStart = anchor(0, -.17, 0);
  const crossover = anchor(.47, .10, -.13, .42);
  const plant = anchor(1, .31, -.15, 1.14);
  const near = anchor(.72, -.16, .13, .2);
  const leadReset = anchor(.70, .16, .06);
  const trailReset = anchor(.70, -.16, .12);
  const lead = after > .22
    ? step(plant, leadReset, recovery, .30, 1, .16)
    : step(leadStart, plant, u, .32, 1, .20);
  const trail = after > .22
    ? step(crossover, trailReset, recovery, 0, .62, .13)
    : step(trailStart, crossover, u, .07, .53, .16);
  if (after <= .22 && u < .13) {
    const lift = .055 * Math.sin(Math.PI * u / .13) ** 2;
    lead.lift += lift;
    trail.lift = Math.max(trail.lift, lift);
    if (lift > .001) lead.stance = trail.stance = false;
  }
  const turn = ease(clamp(u / .65, 0, 1)) * (1 - ease(clamp((after - .03) / .21, 0, 1)));
  const load = ease(clamp((u - .5) / .5, 0, 1)) * (1 - ease(recovery));
  const weight = Math.min(ease(clamp(u / .16, 0, 1)), 1 - ease(clamp((recovery - .77) / .23, 0, 1)));
  const path = ease(u) * (1 - .30 * ease(recovery));
  return {
    x: mix(from.x, goal.x, path), z: mix(from.z, goal.z, path),
    phase: u < .13 ? 'split' : u < .54 ? 'crossover' : u < 1 ? 'lunge' : recovery > 0 ? 'recover' : 'plant',
    feet: hand === 'left' ? { left: lead, right: trail } : { left: trail, right: lead },
    weight, turn, load, low,
    // Draw the pelvis toward the bent support leg, then release it as the other foot leads home.
    pelvis: { x: (plant.x - near.x) * .12 * load, z: (plant.z - near.z) * .12 * load, drop: (.15 + .15 * low) * load },
  };
}

export function rearStroke(age, anchor, hand) {
  const u = Math.max(0, age);
  const keys = [
    [0, 0.52, 1.36, -.27],
    [.065, .66, anchor.y + .19, anchor.z - .30],
    [.14, Math.abs(anchor.x), anchor.y, anchor.z],
    [.245, .31, anchor.y + .16, anchor.z + .49],
    [.48, .29, 1.27, .45],
  ];
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1];
  const span = b[0] - a[0];
  const t = clamp((u - a[0]) / span, 0, 1);
  const t2 = t * t, t3 = t2 * t;
  function at(axis) {
    const slope = j => {
      if (!j || j === keys.length - 1) return 0;
      const x = (keys[j][axis] - keys[j - 1][axis]) / (keys[j][0] - keys[j - 1][0]);
      const y = (keys[j + 1][axis] - keys[j][axis]) / (keys[j + 1][0] - keys[j][0]);
      return x * y > 0 ? 2 * x * y / (x + y) : 0;
    };
    return (2 * t3 - 3 * t2 + 1) * a[axis] + (t3 - 2 * t2 + t) * span * slope(i)
      + (-2 * t3 + 3 * t2) * b[axis] + (t3 - t2) * span * slope(i + 1);
  }
  return { x: hand * at(1), y: at(2), z: at(3) };
}
