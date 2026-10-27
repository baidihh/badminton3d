// 对局状态机：发球、击球判定、跑位、AI、计分
import { recorder } from '../recorder.js';
import {
  NET_H, NET_HALF_W, G, HIT_R, WIN_SCORE, RAISE_SPEED,
  MOVE_SPEED, MOVE_ACCEL, COURT_X, CATCH_BEHIND, PLAYER_Z,
  clamp, moveTo, rand, SHOT_TYPES, AI_LEVELS,
} from './constants.js';
import { integrate, solveLaunch, segPointDist } from './physics.js';

class Game {
  constructor() {
    this.aiLevel = 'normal';
    this.hardReset();
    this.setDifficulty('normal');
  }

  setDifficulty(level) {
    const key = AI_LEVELS[level] ? level : 'normal';
    const d = AI_LEVELS[key];
    this.aiLevel = key;
    this.aiReaction = d.react;
    this.aiMissChance = d.miss;
    this.aiSpeed = d.speed;
    this.aiMix = d.mix;
    this.aiAim = d.aim;
    this.aiPower = d.power;
  }

  hardReset() {
    this.t = 0;
    this.left = this.makePlayer('left');
    this.right = this.makePlayer('right');
    this.right.ai = true;
    this.right.name = '电脑';
    this.ball = { x: 0, y: 2.4, z: -3.0, vx: 0, vy: 0, vz: 0 };
    this.phase = 'serve';
    this.serverSide = 'left';
    this.rally = 0;
    this.phaseTimer = 0;
    this.serveMisses = 0;
    this.msg = '';
    this.holder = null;
    this.impact = { x: 0, y: 0, z: 0, power: 0 };
    this.aiPlan = null;
    this.started = false;
    this.hist = [];            // 球的历史轨迹（最近 1 秒），用于时间戳回溯判定
    this.doService();
    this.msg = '挥拍或按空格开始';
    this.lastBallZ = this.ball.z;
  }

  makePlayer(side) {
    return {
      side,
      sign: side === 'left' ? -1 : 1,
      x: 0,
      y: 1.1,
      z: side === 'left' ? -PLAYER_Z : PLAYER_Z,
      armedUntil: 0,
      pending: null,
      dir: 0,
      score: 0,
      connected: false,
      flash: 0,
      name: side === 'left' ? '玩家 1' : '玩家 2',
      ai: false,
      hand: 'right',     // 持拍手：right / left
      pose: null,        // 手机相对姿态四元数 [x,y,z,w]
      poseAt: 0,
      swingId: 0,
      lastGrade: '',
      // 跑位：当前由电脑控制（stepMove 接收任意方向，后续可接人类输入）
      mvx: 0,
      mvz: 0,
    };
  }

  restart() {
    this.left.score = 0;
    this.right.score = 0;
    this.phase = 'serve';
    this.msg = '';
    this.started = true;
    this.doService();
  }

  doService() {
    const s = this.serverSide === 'left' ? this.left : this.right;
    this.phase = 'serve';
    this.phaseTimer = 0;
    this.serveMisses = 0;
    this.serveClock = 0;
    this.aiPlan = null;
    this.rally = 0;
    this.holder = null;
    this.ball.x = s.x * 0.5;
    this.ball.y = 2.5;
    this.ball.z = s.z * 0.85;
    this.ball.vx = rand(-0.2, 0.2);
    this.ball.vy = 0;
    this.ball.vz = rand(-0.2, 0.2);
    s.armedUntil = 0;
    this.msg = `${s.name} 发球`;
  }

  swing(side, power = 0.7, dir = 0, lift = 0.5, shot = 'clear', opts = {}) {
    if (!this.started) {
      // 第一次挥拍 = 开球
      this.started = true;
      this.msg = '';
    }
    if (this.phase === 'over') {
      this.restart();
      return;
    }
    if (this.phase === 'point') return;
    const p = side === 'left' ? this.left : this.right;
    p.armedUntil = this.t + 0.30;
    // 时间戳回溯：把球回退到"玩家挥拍那一刻"（检测延迟 + 单程网络延迟）
    const lagMs = clamp(Number(opts.lagMs) || 0, 0, 250);
    p.pending = {
      power: clamp(power, 0, 1),
      dir: clamp(dir, -1, 1),
      lift: clamp(lift, 0, 1),
      shot: SHOT_TYPES.has(shot) ? shot : 'clear',
      // 手机方位角（控制系：+ 为持拍手一侧）；键盘没有这个信号
      az: Number.isFinite(opts.az) ? clamp(opts.az, -1.25, 1.25) : null,
      // 直接指定落点（电脑用）
      tx: Number.isFinite(opts.tx) ? opts.tx : null,
      lagMs,
      rewind: lagMs > 8 ? this.ballAt(this.t - lagMs / 1000) : null,
      rewindDone: false,
      // 漏击诊断：挥拍瞬间球在哪
      ballY: this.ball.y,
      ballZ: this.ball.z,
      ballDist: Math.hypot(
        this.ball.x - p.x,
        this.ball.y - p.y,
        this.ball.z - (p.z + (p.side === 'left' ? 0.55 : -0.55)),
      ),
    };
    p.dir = p.pending.dir;
    p.flash = 1;
    p.swingId++;
  }

  awardPoint(winnerSide, reason) {
    const w = winnerSide === 'left' ? this.left : this.right;
    w.score++;
    recorder.point({
      winner: winnerSide,
      reason,
      score: { left: this.left.score, right: this.right.score },
      rally: this.rally,
      phase: this.phase,
    });
    this.phase = 'point';
    this.phaseTimer = 0;
    this.rally = 0;
    this.msg = reason;
    this.serverSide = winnerSide;
    console.log(`[得分] ${winnerSide} · ${reason} · ${this.left.score}:${this.right.score}`);
  }

  onHit(p, contactPos = null) {
    const b = this.ball;
    // 触球点：时间戳回溯命中时用回溯位置，否则用当前球位
    const cs = contactPos || b;
    const { power, dir, lift = 0.5, shot: rawShot = 'clear' } = p.pending;
    const d = Number.isFinite(p.hitDist)
      ? p.hitDist
      : Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z);
    p.hitDist = null;
    const q = clamp(1 - d / HIT_R, 0, 1);          // 甜区质量：越靠近拍面中心越高
    const grade = q > 0.72 ? 'perfect' : q > 0.42 ? 'good' : 'edge';
    const effPower = clamp(power * (0.74 + q * 0.34), 0, 1);

    // 球路类型：低点不能算杀球，其余沿用客户端判定
    let shot = SHOT_TYPES.has(rawShot) ? rawShot : 'clear';
    if (shot === 'smash' && cs.y < 1.75) shot = 'clear';

    // 目标落点：深度由球路和力量决定；横向在下面按挥拍方向推算
    const sign = p.side === 'left' ? 1 : -1;

    // 不同球路：目标深度 + 飞行时间；触球高度也参与
    const contactH = clamp((cs.y - 1.3) / 1.3, 0, 1);
    let tz, T;
    if (shot === 'drop') {
      const pDrop = effPower * 0.6;
      tz = sign * clamp(1.5 + pDrop * 1.7 + contactH * 0.3, 1.5, 3.4);
      T = 1.34 + lift * 0.10 - pDrop * 0.12 - contactH * 0.06;
    } else if (shot === 'smash') {
      tz = sign * clamp(3.0 + effPower * 1.8 + contactH * 0.7, 3.0, 5.4);
      T = clamp(1.03 - effPower * 0.30 - contactH * 0.07, 0.70, 1.0);
    } else {
      tz = sign * clamp(2.0 + effPower * 3.6 + (1 - q) * 0.5, 1.4, 6.2);
      T = 1.52 - effPower * 0.46 + (1 - q) * 0.20 + lift * 0.62 + (1 - contactH) * 0.10;
    }

    // 横向落点：从站位沿挥拍方向延伸的射线
    // 站右侧向左挥 = 对角；向正前 = 直线；向中间 = 中路
    const sideSign = p.side === 'left' ? -1 : 1;
    const reach = Math.max(1.6, Math.abs(tz - cs.z));
    let tx;
    if (p.pending.tx !== null) {
      tx = p.pending.tx;
    } else if (p.pending.az !== null) {
      // 手感修正（参考体感游戏的"意图一致性"）：
      // 1) 死区：4° 以内的手腕抖动不改落点
      // 2) 软饱和：大角度不再线性放大，避免一下顶到边线
      const DEAD = 0.07;
      let azUse = p.pending.az;
      if (Math.abs(azUse) < DEAD) azUse = 0;
      else azUse -= Math.sign(azUse) * DEAD;
      azUse = Math.tanh(azUse * 1.15) * 0.9;
      tx = p.x + sideSign * Math.tan(azUse) * reach;
    } else {
      // 键盘兜底：没有方位角，用方向键比例
      tx = p.x + sideSign * p.pending.dir * 2.4;
    }
    // 落点辅助：始终留 0.45 m 边线余量，不把球判死在线上
    tx = clamp(tx + rand(-0.45, 0.45) * (1 - q), -2.45, 2.45);

    // 二次阻力下反求初速度；过网高度不够就抬高弧线重算
    let sol;
    for (let i = 0; i < 10; i++) {
      sol = solveLaunch(b, tx, tz, T);
      const netY = sol.netY === null ? Infinity : sol.netY;
      if (netY >= NET_H + 0.10 || netY === Infinity) break;
      T += 0.05;
    }
    if (!Number.isFinite(sol.vx) || !Number.isFinite(sol.vy) || !Number.isFinite(sol.vz)) {
      // 兜底：直接朝目标飞（极端参数下避免 NaN 把球卡死）
      sol = {
        vx: (tx - b.x) / T,
        vz: (tz - b.z) / T,
        vy: (0 - b.y) / T + 0.5 * G * T,
      };
    }
    b.vx = sol.vx;
    b.vy = sol.vy;
    b.vz = sol.vz;

    this.holder = p.side;
    this.rally++;
    this.impact = {
      x: b.x, y: b.y, z: b.z,
      power: 0.35 + effPower * 0.65,
      id: (this.impact.id || 0) + 1,
      grade, q, side: p.side, lift, shot,
      // 采样记录用：实际落点与飞行时间
      tx, tz, T,
    };
    p.lastGrade = grade;
    p.armedUntil = 0;
    p.pending = null;
    if (this.phase === 'serve') this.phase = 'rally';
    this.msg = '';
    if (this.onHitFx) this.onHitFx(p.side, grade, effPower, p.swingId, shot, this.impact);
  }

  updateRacket(p, dt) {
    const b = this.ball;
    const onMySide = p.side === 'left' ? b.z < 0 : b.z > 0;
    // 水平位置由跑位系统负责，这里只跟球的高度
    const ty = onMySide ? clamp(b.y, 0.55, 2.75) : 1.15;
    p.y = moveTo(p.y, ty, RAISE_SPEED * dt);
  }

  // 通用位移积分器：任意方向 (dirX, dirZ)，带加速与场地边界
  stepMove(p, dt, dirX, dirZ, speedScale = 1) {
    const len = Math.hypot(dirX, dirZ);
    const ux = len > 1e-4 ? dirX / len : 0;
    const uz = len > 1e-4 ? dirZ / len : 0;
    const maxV = MOVE_SPEED * clamp(speedScale, 0, 1.2);
    const k = Math.min(1, MOVE_ACCEL * dt);
    p.mvx += (ux * maxV - p.mvx) * k;
    p.mvz += (uz * maxV - p.mvz) * k;
    p.x += p.mvx * dt;
    p.z += p.mvz * dt;

    if (p.x < -COURT_X) { p.x = -COURT_X; p.mvx = Math.max(0, p.mvx); }
    if (p.x > COURT_X) { p.x = COURT_X; p.mvx = Math.min(0, p.mvx); }
    const zMin = p.side === 'left' ? -6.35 : 0.9;
    const zMax = p.side === 'left' ? -0.9 : 6.35;
    if (p.z < zMin) { p.z = zMin; p.mvz = Math.max(0, p.mvz); }
    if (p.z > zMax) { p.z = zMax; p.mvz = Math.min(0, p.mvz); }
  }

  // 自动跑位：预判落点，站到球后侧；球不在本方半场就回中场
  autoFootwork(p, dt) {
    const b = this.ball;
    const onMy = p.side === 'left' ? b.z < 0 : b.z > 0;

    let tx, tz;
    if (onMy && this.phase !== 'point') {
      tx = clamp(b.x + b.vx * 0.22, -COURT_X + 0.05, COURT_X - 0.05);
      tz = p.side === 'left' ? b.z - CATCH_BEHIND : b.z + CATCH_BEHIND;
    } else {
      tx = 0;
      tz = p.side === 'left' ? -PLAYER_Z : PLAYER_Z;
    }
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.04) {
      this.stepMove(p, dt, 0, 0, 0);
      return;
    }
    // 接近目标时减速，避免来回抖；电脑按难度调整跑位速度
    const spd = p.ai ? (this.aiSpeed || 1) : 1;
    this.stepMove(p, dt, dx / d, dz / d, clamp(d / 0.9, 0.15, 1) * spd);
  }

  /** 拍面中心：在身体前方约 0.55 m（球拍伸出），背后不再可击球 */
  racketAt(p) {
    return { x: p.x, y: p.y, z: p.z + (p.side === 'left' ? 0.55 : -0.55) };
  }

  /** 漏击原因：够不到 / 球还高 / 已过身 */
  missReason(p, pad) {
    if (!pad) return 'late';
    if (pad.ballDist > 2.3) return 'far';
    if (pad.ballY > 2.9) return 'high';
    const behind = p.side === 'left' ? pad.ballZ > p.z + 0.15 : pad.ballZ < p.z - 0.15;
    return behind ? 'late' : 'early';
  }

  tryHit(p, prev) {
    if (p.armedUntil < this.t || !p.pending) return false;
    // 同一次持球不能连击（回溯判定可能把球拉回本方半场，必须挡住二次触球）
    if (this.holder === p.side) return false;
    const b = this.ball;
    // 判定用的球位：优先用"挥拍那一刻"的回溯位置（时间戳回溯）
    const rw = p.pending.rewind;
    const bx = rw ? rw.x : b.x;
    const by = rw ? rw.y : b.y;
    const bz = rw ? rw.z : b.z;
    const onMySide = p.side === 'left' ? bz < 0 : bz > 0;
    if (!onMySide) return false;
    if (by < 0.06 || by > 3.7) return false;
    const rc = this.racketAt(p);

    // 1) 回溯判定：只判一次；命中就用当时的触球点算球路
    if (rw && !p.pending.rewindDone) {
      p.pending.rewindDone = true;
      const dr = Math.hypot(bx - rc.x, by - rc.y, bz - rc.z);
      if (dr <= HIT_R) {
        p.hitDist = dr;
        this.onHit(p, rw);
        return true;
      }
    }

    // 2) 实时扫掠兜底：保留原有容错窗口，挥早了也能捞回来
    // 扫掠碰撞：用这一帧球走过的线段到拍心的最近距离，避免高速穿过
    const d = prev
      ? segPointDist(prev.x, prev.y, prev.z, b.x, b.y, b.z, rc.x, rc.y, rc.z)
      : Math.hypot(b.x - rc.x, b.y - rc.y, b.z - rc.z);
    if (d > HIT_R) return false;
    p.hitDist = d;
    this.onHit(p);
    return true;
  }

  /** 发球超时兜底：把球直接送到拍面，强制打出一拍，避免整局卡死 */
  forceServe(p) {
    const b = this.ball;
    const rc = this.racketAt(p);
    b.x = rc.x;
    b.y = clamp(rc.y, 1.4, 2.7);
    b.z = rc.z;
    p.pending = { power: 0.68, dir: rand(-0.2, 0.2), lift: 0.72, shot: 'clear' };
    p.armedUntil = this.t + 0.4;
    p.flash = 1;
    this.onHit(p);
    console.log('[发球超时] 强制发球');
  }

  updateAI(dt) {
    const p = this.right;
    if (!p.ai) return;
    const b = this.ball;

    // 发球：电脑是发球方时直接准备发球，不能等球过网（否则会一直等下去）
    if (this.phase === 'serve' && this.serverSide === 'right') {
      if (!this.aiPlan || !this.aiPlan.serve) {
        this.aiPlan = {
          reactAt: this.t + clamp(this.aiReaction + 0.45, 0.5, 1.1),
          miss: false,
          serve: true,
          shot: 'clear',
        };
      }
      if (this.t < this.aiPlan.reactAt) return;
      if (p.armedUntil > this.t) return;
      const rc = this.racketAt(p);
      const ds = Math.hypot(b.x - rc.x, b.y - rc.y, b.z - rc.z);
      if (ds < HIT_R) {
        const pw = this.aiPower[0] + (this.aiPower[1] - this.aiPower[0]) * 0.5;
        this.swing('right', pw, 0, 0.75, 'clear', { tx: rand(-1.0, 1.0) });
        this.aiPlan = null;
        console.log('[电脑发球]');
      }
      return;
    }

    if (b.z > 0 && this.lastBallZ <= 0) {
      // 按难度抽球路：高远 / 吊球 / 杀球
      const mix = this.aiMix;
      const r = Math.random();
      const shot = r < mix[0] ? 'clear' : r < mix[0] + mix[1] ? 'drop' : 'smash';
      this.aiPlan = {
        reactAt: this.t + this.aiReaction,
        miss: Math.random() < this.aiMissChance,
        serve: false,
        shot,
      };
    }
    this.lastBallZ = b.z;

    if (b.z <= 0 || !this.aiPlan) return;
    if (this.t < this.aiPlan.reactAt) return;
    if (p.armedUntil > this.t) return;

    const rc = this.racketAt(p);
    const d = Math.hypot(b.x - rc.x, b.y - rc.y, b.z - rc.z);
    if (this.aiPlan.miss) {
      // 故意失误：只做挥拍动作，不进入击球判定
      if (d < HIT_R * 1.9) p.flash = 1;
      return;
    }
    if (d < HIT_R * 0.88) {
      const shot = this.aiPlan.shot || 'clear';
      // 电脑直接指定落点：难度越高越压边线和空当
      let aimX;
      if (this.aiLevel === 'easy') {
        aimX = rand(-1.9, 1.9);
      } else {
        const oppX = this.left.x;
        const open = Math.abs(oppX) < 0.35 ? (Math.random() < 0.5 ? -1 : 1) : -Math.sign(oppX);
        const edge = 1.6 + Math.random() * 0.9;
        aimX = clamp(open * edge * this.aiAim + rand(-1.5, 1.5) * (1 - this.aiAim), -2.75, 2.75);
      }
      let power;
      let lift;
      if (shot === 'smash') {
        power = rand(0.75, 1);
        lift = rand(0.08, 0.3);
      } else if (shot === 'drop') {
        power = rand(0.2, 0.42);
        lift = rand(0.2, 0.5);
      } else {
        power = rand(this.aiPower[0], this.aiPower[1]);
        lift = rand(0.55, 0.85);
      }
      this.swing('right', power, 0, lift, shot, { tx: aimX });
      this.aiPlan = null;
      console.log(`[电脑击球] ${shot} 难度=${this.aiLevel}`);
    }
  }

  /** 每秒 60 条，保留 1 秒；回溯最多用 250 ms（和 Source 的 lag compensation 同思路） */
  pushHist() {
    const b = this.ball;
    this.hist.push({ t: this.t, x: b.x, y: b.y, z: b.z });
    const cut = this.t - 1.05;
    while (this.hist.length > 2 && this.hist[0].t < cut) this.hist.shift();
  }

  /** 取 t 时刻的球位置（线性插值），用于把判定回退到玩家挥拍的那一刻 */
  ballAt(t) {
    const h = this.hist;
    if (!h.length) return { x: this.ball.x, y: this.ball.y, z: this.ball.z };
    if (t <= h[0].t) return { x: h[0].x, y: h[0].y, z: h[0].z };
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].t <= t) {
        const a = h[i - 1];
        const c = h[i];
        const k = c.t > a.t ? (t - a.t) / (c.t - a.t) : 1;
        return {
          x: a.x + (c.x - a.x) * k,
          y: a.y + (c.y - a.y) * k,
          z: a.z + (c.z - a.z) * k,
        };
      }
    }
    return { x: h[0].x, y: h[0].y, z: h[0].z };
  }

  step(dt) {
    // 先记录这一刻的球状态（此时 this.ball 正好对应 this.t）
    this.pushHist();
    this.t += dt;

    if (!this.started) {
      // 待机：球悬停，两人回到中场，等待第一拍
      this.bob = (this.bob || 0) + dt;
      this.ball.y = 2.5 + Math.sin(this.bob * 2.2) * 0.1;
      this.autoFootwork(this.left, dt);
      this.autoFootwork(this.right, dt);
      this.updateRacket(this.left, dt);
      this.updateRacket(this.right, dt);
      return;
    }
    this.left.flash = Math.max(0, this.left.flash - dt * 2.8);
    this.right.flash = Math.max(0, this.right.flash - dt * 2.8);
    this.impact.power = Math.max(0, this.impact.power - dt * 2.6);

    if (this.phase === 'point') {
      this.phaseTimer += dt;
      if (this.phaseTimer > 1.6) {
        if (this.left.score >= WIN_SCORE || this.right.score >= WIN_SCORE) {
          this.phase = 'over';
          const champ = this.left.score > this.right.score ? this.left : this.right;
          this.msg = `${champ.name} 获胜`;
        } else {
          this.doService();
        }
      }
      return;
    }
    if (this.phase === 'over') return;

    this.autoFootwork(this.left, dt);
    this.autoFootwork(this.right, dt);
    this.updateRacket(this.left, dt);
    this.updateRacket(this.right, dt);
    this.updateAI(dt);

    // 发球超时兜底：电脑发球超过 3.5 秒还没打出去，就强制发球
    if (this.phase === 'serve') {
      this.serveClock = (this.serveClock || 0) + dt;
      if (this.serveClock > 3.5 && this.serverSide === 'right' && this.right.ai) {
        this.forceServe(this.right);
      }
    }

    const b = this.ball;
    const prevBall = { x: b.x, y: b.y, z: b.z };
    const prevZ = b.z;

    // 发球阶段球停在发球点等发球方挥拍，不再自己掉落（避免一直“颠球”）
    if (this.phase === 'serve') {
      b.vx = 0; b.vy = 0; b.vz = 0;
      b.y = 2.5;
    } else {
      integrate(b, dt);
    }

    // 命中判定放在积分之后，用这一帧的球路做扫掠检测
    if (!this.tryHit(this.left, prevBall)) this.tryHit(this.right, prevBall);

    // 挥拍窗口结束仍未碰到球 = 漏击，告诉手机是打早了、打晚了还是够不到
    for (const p of [this.left, this.right]) {
      if (p.pending && this.t > p.armedUntil) {
        const pad = p.pending;
        p.pending = null;
        p.armedUntil = 0;
        if (this.onMissFx) this.onMissFx(p.side, p.swingId, b, this.missReason(p, pad));
      }
    }

    // 侧墙兜底，避免球飞出场景
    if (b.x < -7.5) { b.x = -7.5; b.vx = Math.abs(b.vx) * 0.4; }
    if (b.x > 7.5) { b.x = 7.5; b.vx = -Math.abs(b.vx) * 0.4; }

    // 触网
    if ((prevZ < 0) !== (b.z < 0) && b.y < NET_H + 0.06 && Math.abs(b.x) < NET_HALF_W) {
      const hitter = b.z > 0 ? 'left' : 'right';
      // 撞网带：球被网吃掉，几乎垂直落回击球方一侧
      b.vx *= 0.15;
      b.vy = Math.min(b.vy, 0) * 0.1 - 0.4;
      b.vz *= -0.08;
      b.z = b.z > 0 ? 0.10 : -0.10;
      if (this.phase === 'serve') {
        this.doService();
      } else {
        this.awardPoint(hitter === 'left' ? 'right' : 'left', '触网');
      }
      return;
    }

    // 落地
    if (b.y <= 0.02) {
      b.y = 0.02;
      if (this.phase === 'serve') {
        this.serveMisses++;
        if (this.serveMisses >= 3) {
          const sign = this.serverSide === 'left' ? 1 : -1;
          const sol = solveLaunch(b, rand(-0.6, 0.6), sign * 5.0, 1.35);
          b.vx = sol.vx;
          b.vy = sol.vy;
          b.vz = sol.vz;
          this.phase = 'rally';
          this.holder = this.serverSide;
          this.serveMisses = 0;
          this.msg = '自动发球';
        } else {
          this.doService();
        }
        return;
      }
      const landedOn = b.z < 0 ? 'left' : 'right';
      this.awardPoint(landedOn === 'left' ? 'right' : 'left', '落地得分');
      return;
    }
  }

  snapshot() {
    return {
      ball: { x: this.ball.x, y: this.ball.y, z: this.ball.z, vx: this.ball.vx, vy: this.ball.vy, vz: this.ball.vz },
      left: this.pack(this.left),
      right: this.pack(this.right),
      phase: this.phase,
      server: this.serverSide,
      started: this.started,
      msg: this.msg,
      rally: this.rally,
      impact: this.impact,
      winScore: WIN_SCORE,
    };
  }

  pack(p) {
    const fresh = p.pose && Date.now() - p.poseAt < 1500;
    return {
      x: p.x, y: p.y, z: p.z, score: p.score, dir: p.dir,
      connected: p.connected, flash: p.flash, name: p.name, ai: p.ai,
      hand: p.hand,
      pose: fresh ? p.pose : null,
      grade: p.lastGrade,
      vx: p.mvx,
      vz: p.mvz,
    };
  }
}

const game = new Game();


export { Game };
