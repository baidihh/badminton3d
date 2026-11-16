// 米、秒，球员局部坐标。触球点在 0.14s；服务端命中事件与此帧对齐。
export const CONTACT_TIME = 0.14;
export function sampleStroke(age, shot, hand, contact) {
  const h = hand < 0 ? -1 : 1;
  const ready = {x:0.35*h,y:1.7,z:0.6};
  const high = shot === 'smash' || shot === 'clear';
  const points = [ready,
    {x:0.5*h,y:high?2.35:1.25,z:0.12}, contact,
    {x:-0.3*h,y:shot==='smash'?1.15:1.65,z:0.85},ready];
  const times=[0,0.08,CONTACT_TIME,0.23,0.48];
  if(age<=0 || age>=times.at(-1)) return {...ready};
  let i=0;while(age>times[i+1])i++;
  const t=(age-times[i])/(times[i+1]-times[i]);
  const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],d=points[Math.min(4,i+2)];
  const out={};
  for(const key of ['x','y','z']) {
    out[key]=0.5*((2*b[key])+(-a[key]+c[key])*t+(2*a[key]-5*b[key]+4*c[key]-d[key])*t*t+(-a[key]+3*b[key]-3*c[key]+d[key])*t*t*t);
  }
  return out;
}
