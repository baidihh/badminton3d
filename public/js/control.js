// 输入与落点共享的纯函数：挥拍内的有符号横向转角，不依赖绝对罗盘朝向。
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export function strokeDirection(yaw) {
  if (!Number.isFinite(yaw)) return 0;
  const dead = 8 * Math.PI / 180;
  return Math.sign(yaw) * clamp((Math.abs(yaw)-dead)/(37*Math.PI/180),0,1);
}
// 左手当前握法的正前方挥拍带有约 0.18rad 的自然正向旋转；
// 用确认过的训练样本校正中性点，避免小幅左挥被当作直打。
export function handedStrokeDirection(yaw, hand = 'right') {
  if (!Number.isFinite(yaw)) return 0;
  if (hand !== 'left') return strokeDirection(yaw);
  return clamp((yaw - 0.18) / 0.10, -1, 1);
}
export function aimTarget(side, intent, stanceX = 0) {
  const direction = Number.isFinite(intent) ? clamp(intent,-1,1) : 0;
  const base = Number.isFinite(stanceX) ? clamp(stanceX,-2.45,2.45) : 0;
  if (direction === 0) return base;
  // 中性挥拍沿站位直线；扫向场地中央时允许更大的横移，边线方向则收窄。
  const signed = (side === 'left' ? -1 : 1) * direction;
  const towardCenter = signed * base < 0;
  const reach = 2.25 + (towardCenter ? 0.75 : -0.75) * Math.abs(base);
  return clamp(base + signed * reach,-2.45,2.45);
}

export function swingPower(peak, threshold) {
  if (!Number.isFinite(peak) || !Number.isFinite(threshold)) return 0.12;
  const start = threshold * 0.75;
  return clamp(Math.sqrt(clamp((peak - start) / Math.max(1,750 - start),0,1)),0.12,1);
}
