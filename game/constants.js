// 3D 世界常量与通用小工具（单位：米）
export const HALF_W = 3.0;          // 场地半宽（x）
export const HALF_L = 6.7;          // 半场长度（z）
export const NET_H = 1.55;          // 网高
export const NET_HALF_W = 3.1;
export const G = 9.8;               // 重力
export const HIT_R = 0.98;          // 球拍可及半径（扫掠判定）
export const WIN_SCORE = 7;

export const RAISE_SPEED = 4.2;     // 抬拍到位速度 m/s

// 跑位系统
export const MOVE_SPEED = 3.6;      // 最大移动速度 m/s
export const MOVE_ACCEL = 16;       // 加速响应
export const COURT_X = 2.9;         // 左右边界
export const CATCH_BEHIND = 0.55;   // 站到球后侧的距离

export const PLAYER_Z = 4.6;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const moveTo = (cur, target, maxStep) => {
  const d = target - cur;
  return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep;
};
export const rand = (a, b) => a + Math.random() * (b - a);

// 二次空气阻力：a = -DRAG·|v|·v，末端速度约 9.4 m/s
// 羽毛球真实手感来自"出手猛、后段急减速、最后近乎垂直飘落"
export const DRAG = 0.11;
export const SUB_DT = 0.008;        // 子步长，避免高速穿模

export const SHOT_TYPES = new Set(['clear', 'drop', 'smash']);

// 三档电脑难度：反应、失误率、跑位速度、球路配比、压空当程度、力量区间
export const AI_LEVELS = {
  easy: { react: 0.38, miss: 0.35, speed: 0.78, mix: [0.84, 0.12, 0.04], aim: 0.12, power: [0.30, 0.66] },
  normal: { react: 0.23, miss: 0.18, speed: 0.96, mix: [0.56, 0.20, 0.24], aim: 0.55, power: [0.42, 0.88] },
  hard: { react: 0.12, miss: 0.05, speed: 1.10, mix: [0.40, 0.18, 0.42], aim: 0.95, power: [0.58, 1.00] },
};
