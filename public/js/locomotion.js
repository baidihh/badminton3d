// Numeric contact gait. World X/Z targets are independent of the render skeleton and camera.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const other = side => side === 'left' ? 'right' : 'left';
const sign = side => side === 'left' ? 1 : -1;
const damp = (a, b, rate, dt) => mix(a, b, 1 - Math.exp(-rate * dt));

export class ContactLocomotion {
  constructor() {
    this.root = null;
    this.feet = null;
    this.step = null;
    this.nextSide = 'left';
    this.rest = 0;
    this.pelvis = { x: 0, z: 0, drop: 0, roll: 0, pitch: 0 };
    this.acceleration = { x: 0, z: 0 };
    this.velocity = { x: 0, z: 0 };
    this.impactAge = Infinity;
    this.seenImpacts = new Set();
    this.splitHeight = 0;
    this.lungeSide = null;
    this.lungeGoal = null;
  }

  adoptStance(root, feet) {
    this.root = { x: root.x, z: root.z };
    this.feet = Object.fromEntries(Object.entries(feet).map(([side, foot]) => [side, { ...foot, lift: 0, stance: true, phase: 1 }]));
    this.step = null;
    this.rest = 0;
    this.splitHeight = 0;
    this.impactAge = Infinity;
    this.lungeSide = null;
    this.lungeGoal = null;
  }

  update(dt, input = {}) {
    const state = {
      x: finite(input.x), z: finite(input.z), vx: finite(input.vx), vz: finite(input.vz), yaw: finite(input.yaw),
      hand: input.hand === 'left' ? 'left' : 'right', near: clamp(finite(input.near), 0, 1),
      ballX: finite(input.ballX, finite(input.x)), ballZ: finite(input.ballZ, finite(input.z) + 1),
      legReach: clamp(finite(input.legReach, .9), .55, 1.2),
    };
    const elapsed = clamp(finite(dt), 0, .1);
    const travel = this.root ? dist(this.root, state) : Infinity;
    if (!this.root || travel > Math.max(1.5, Math.hypot(state.vx, state.vz) * elapsed + .8)) {
      this._reset(state); this._impact(input); return this._pose();
    }
    this._impact(input);
    if (!elapsed) return this._pose();
    const previous = { ...this.root }, frames = Math.max(1, Math.ceil(elapsed * 120 - 1e-8)), h = elapsed / frames;
    for (let i = 0; i < frames; i++) {
      const t = (i + 1) / frames;
      this._advance(h, { ...state, x: mix(previous.x, state.x, t), z: mix(previous.z, state.z, t) });
    }
    this.root = { x: state.x, z: state.z };
    return this._pose();
  }

  _neutral(side, state) {
    const width = clamp(state.legReach * .16, .12, .16), s = sign(side);
    return { x: state.x + Math.cos(state.yaw) * width * s + Math.sin(state.yaw) * .025,
      z: state.z - Math.sin(state.yaw) * width * s + Math.cos(state.yaw) * .025,
      yaw: state.yaw + s * .055 };
  }

  _reset(state) {
    this.root = { x: state.x, z: state.z };
    this.feet = Object.fromEntries(['left', 'right'].map(side => [side, { ...this._neutral(side, state), lift: 0, pitch: 0, stance: true, phase: 1 }]));
    this.step = null; this.rest = 0; this.nextSide = 'left';
    this.pelvis = { x: 0, z: 0, drop: 0, roll: 0, pitch: 0 };
    this.acceleration = { x: 0, z: 0 }; this.velocity = { x: state.vx, z: state.vz };
    this.impactAge = Infinity; this.splitHeight = 0; this.lungeSide = null; this.lungeGoal = null;
  }

  _impact(input) {
    const id = input.opponentImpactId;
    if (id === undefined || id === null || id === 0 || this.seenImpacts.has(id)) return;
    this.seenImpacts.add(id);
    if (this.seenImpacts.size > 64) this.seenImpacts.delete(this.seenImpacts.values().next().value);
    const age = Number.isFinite(input.opponentImpactAge) ? Math.max(0,input.opponentImpactAge) : Infinity;
    this.impactAge = age < .26 ? age : Infinity;
  }

  _start(side, target, duration, speed, kind = 'move') {
    const foot = this.feet[side];
    this.step = { side, from: { x: foot.x, z: foot.z, yaw: foot.yaw }, target: { ...target }, elapsed: 0, duration,
      height: kind === 'lunge' ? .065 : kind === 'recover' ? .055 : clamp(.052 + speed * .019, .055, .12), kind };
    foot.stance = false; foot.phase = 0; foot.pitch = .19;
    this.rest = 0;
  }

  _advance(dt, state) {
    const speed = Math.hypot(state.vx, state.vz), reach = clamp(state.legReach * .64, .37, .67);
    const cos = Math.cos(state.yaw), sin = Math.sin(state.yaw);
    this.acceleration.x = damp(this.acceleration.x, clamp((state.vx - this.velocity.x) / dt, -8, 8), 8, dt);
    this.acceleration.z = damp(this.acceleration.z, clamp((state.vz - this.velocity.z) / dt, -8, 8), 8, dt);
    this.velocity = { x: state.vx, z: state.vz };
    this.impactAge += dt;
    this.splitHeight = 0;
    if (this.impactAge < .24 && !this.step && speed < 1.4) {
      const u = (this.impactAge - .035) / .165;
      if (u > 0 && u < 1) this.splitHeight = .057 * Math.sin(Math.PI * u);
    }
    const splitBusy = this.splitHeight > .00001;
    // A low-ball lunge is a small racket-foot placement, never a new body teleport.
    const forwardBall = (state.ballX - state.x) * sin + (state.ballZ - state.z) * cos;
    const wantsLunge = state.near > .3 && speed < .65 && forwardBall > -.03;
    if (!wantsLunge && (state.near < .16 || speed > .75)) { this.lungeSide = null; this.lungeGoal = null; }
    if (!this.step && !splitBusy) {
      this.rest += dt;
      const side = state.hand === 'left' ? 'left' : 'right';
      if (wantsLunge && !this.lungeSide && this.rest > .04) {
        const target = this._neutral(side, state), lateralBall = (state.ballX - state.x) * cos - (state.ballZ - state.z) * sin;
        const advance = clamp(forwardBall, .18, .36) * state.near;
        const lateral = clamp(lateralBall * .25, -.055, .055);
        target.x += sin * advance + cos * lateral; target.z += cos * advance - sin * lateral;
        target.yaw += clamp(angle(Math.atan2(state.ballX - state.x, state.ballZ - state.z) - state.yaw), -.22, .22);
        this.lungeSide = side; this.lungeGoal = { ...target };
        this._start(side, target, .29, speed, 'lunge');
      } else if (speed > .2 && !wantsLunge) {
        const stretched = Math.max(dist(this.feet.left, state), dist(this.feet.right, state)) > reach - .09;
        const gap = speed > 2.6 ? .008 : .032;
        if (this.rest >= gap || stretched) {
          const movingSide = this.nextSide, target = this._neutral(movingSide, state);
          // Predict once at toe-off; neither future root corrections nor ball motion retarget this landing.
          const duration = clamp(.38 - speed * .05, .18, .34);
          const lead = clamp(.08 + speed * .028, .09, .21), forecast = duration + lead / Math.max(.2, speed);
          target.x += state.vx * forecast; target.z += state.vz * forecast;
          this._start(movingSide, target, duration, speed);
        }
      } else if (!wantsLunge && !this.lungeSide && this.rest > .065) {
        let recoverSide = null, error = .073;
        for (const candidate of ['left', 'right']) {
          const target = this._neutral(candidate, state), deviation = dist(this.feet[candidate], target);
          const turn = Math.abs(angle(target.yaw - this.feet[candidate].yaw));
          if (deviation > error || (turn > .48 && !recoverSide)) { recoverSide = candidate; error = deviation; }
        }
        if (recoverSide) this._start(recoverSide, this._neutral(recoverSide, state), .23, 0, 'recover');
      }
    }
    if (this.step) {
      const step = this.step, foot = this.feet[step.side], support = this.feet[other(step.side)];
      step.elapsed += dt;
      // Bring the existing, frozen touchdown forward in time before the support leg overextends.
      const supportStretch = dist(support, state);
      if (supportStretch > reach - .035 && step.elapsed / step.duration > .5) {
        const timeLeft = Math.max(.008, (reach - supportStretch) / Math.max(.3, speed));
        step.elapsed = Math.max(step.elapsed, step.duration - timeLeft);
      }
      const u = clamp(step.elapsed / step.duration, 0, 1), travel = smooth(u);
      foot.x = mix(step.from.x, step.target.x, travel); foot.z = mix(step.from.z, step.target.z, travel);
      foot.yaw = step.from.yaw + angle(step.target.yaw - step.from.yaw) * travel;
      foot.lift = step.height * Math.sin(Math.PI * u); foot.pitch = .24 * (1 - u) - .15 * u; foot.phase = u;
      support.pitch = damp(support.pitch, .22 * smooth((u - .68) / .32), 22, dt);
      if (u >= 1) {
        foot.x = step.target.x; foot.z = step.target.z; foot.yaw = step.target.yaw;
        foot.lift = 0; foot.stance = true; foot.phase = 1; foot.pitch = -.11;
        this.nextSide = other(step.side); this.step = null; this.rest = 0;
      }
    } else {
      for (const foot of Object.values(this.feet)) { foot.lift = 0; foot.pitch = damp(foot.pitch, 0, 18, dt); }
    }
    const lunge = this.lungeSide && this.lungeGoal ? state.near : 0;
    const support = this.step ? this.feet[other(this.step.side)] : lunge ? this.feet[this.lungeSide] : {
      x: (this.feet.left.x + this.feet.right.x) / 2, z: (this.feet.left.z + this.feet.right.z) / 2,
    };
    let shiftX = (support.x - state.x) * .38, shiftZ = (support.z - state.z) * .24;
    const shiftLength = Math.hypot(shiftX, shiftZ), maxShift = lunge ? .105 : .087;
    if (shiftLength > maxShift) { shiftX *= maxShift / shiftLength; shiftZ *= maxShift / shiftLength; }
    const swingDrop = this.step ? .025 * Math.sin(Math.PI * this.feet[this.step.side].phase) : 0;
    const splitDrop = this.impactAge < .035 ? .025 * smooth(this.impactAge / .035)
      : this.impactAge > .19 && this.impactAge < .31 ? .023 * Math.sin(Math.PI * (this.impactAge - .19) / .12) : 0;
    const forwardAccel = this.acceleration.x * sin + this.acceleration.z * cos;
    const sideAccel = this.acceleration.x * cos - this.acceleration.z * sin;
    const forwardSpeed = state.vx * sin + state.vz * cos;
    this.pelvis.x = damp(this.pelvis.x, shiftX, 13, dt); this.pelvis.z = damp(this.pelvis.z, shiftZ, 13, dt);
    this.pelvis.drop = damp(this.pelvis.drop, swingDrop + splitDrop + lunge * .09, 14, dt);
    this.pelvis.pitch = damp(this.pelvis.pitch, clamp(forwardAccel * .009 + forwardSpeed * .014 + lunge * .075, -.14, .17), 9, dt);
    this.pelvis.roll = damp(this.pelvis.roll, clamp(-sideAccel * .01 - (shiftX * cos - shiftZ * sin) * .3, -.13, .13), 9, dt);
    this.root = { x: state.x, z: state.z };
  }

  _pose() {
    const feet = {};
    for (const side of ['left', 'right']) feet[side] = { ...this.feet[side], stance: this.splitHeight > .00001 ? false : this.feet[side].stance };
    return { feet, pelvis: { ...this.pelvis }, splitHeight: this.splitHeight };
  }
}
