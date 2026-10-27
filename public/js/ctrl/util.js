// 通用常量与小工具
import * as THREE from 'three';

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const Q_IDENTITY = new THREE.Quaternion();
export const X_AXIS = new THREE.Vector3(1, 0, 0);
export const MAX_TILT = 60 * D2R;   // 姿态镜最大偏离角度
