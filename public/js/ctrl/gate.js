// 挥拍节流状态：传感器检测与出球共用，避免两处各存一份
export const gate = { lastSwingAt: 0, cooldownUntil: 0 };
