const number = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const vector = (v,keys) => Object.fromEntries(keys.map(k=>[k,number(v?.[k])]));
// 只保留约定的原始字段；限制每拍体积，避免日志被任意对象扩展。
export function sanitizeTrainingCapture(value) {
  if(!value || value.v!==1 || value.timebase!=='performance.now' || !Number.isFinite(value.capturedAt)
    || !Array.isArray(value.samples) || !Array.isArray(value.referenceQuaternion)
    || value.referenceQuaternion.length!==4 || !value.referenceQuaternion.every(Number.isFinite))return null;
  const samples=value.samples.slice(-256).flatMap(sample=>{
    if(!sample || !Number.isFinite(sample.t) || sample.t>value.capturedAt+5 || sample.t<value.capturedAt-1200)return [];
    if(sample.kind==='orientation')return [{t:sample.t,kind:sample.kind,...vector(sample,['alpha','beta','gamma','screenAngle'])}];
    if(sample.kind==='motion')return [{t:sample.t,kind:sample.kind,
      rotationRate:vector(sample.rotationRate,['alpha','beta','gamma']),
      acceleration:vector(sample.acceleration,['x','y','z']),
      accelerationIncludingGravity:vector(sample.accelerationIncludingGravity,['x','y','z'])}];
    return [];
  });
  if(!samples.length)return null;
  return {v:1,timebase:value.timebase,capturedAt:value.capturedAt,referenceQuaternion:[...value.referenceQuaternion],
    gyroBias:vector(value.gyroBias,['x','y','z']),thresholdOmega:number(value.thresholdOmega),invert:value.invert===-1?-1:1,samples};
}
