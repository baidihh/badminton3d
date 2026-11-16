// Seconds/meters in the player's local space. Server contact remains at .14s.
export const CONTACT_TIME=.14;
const TIMES=[0,.08,CONTACT_TIME,.23,.48];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function curve(age,values){
 if(age<=0||age>=.48)return values[0];
 let i=0;while(age>TIMES[i+1])i++;
 const k=clamp((age-TIMES[i])/(TIMES[i+1]-TIMES[i]),0,1),s=k*k*(3-2*k);
 return values[i]+(values[i+1]-values[i])*s;
}
export function sampleStroke(age,shot,hand,contact,variant,direction){
 const h=hand<0?-1:1,high=shot==='smash'||shot==='clear';
 const ready={x:.35*h,y:1.7,z:.6};
 const side=variant==='backhand'?-h:h;
 const net=shot==='net';
 const drive=direction||{x:0,y:.25,z:1};
 const points=net?[ready,
  {x:contact.x-drive.x*.18-side*.035,y:contact.y-drive.y*.18,z:contact.z-drive.z*.18},contact,
  {x:contact.x+drive.x*.115+side*.02,y:contact.y+drive.y*.115,z:contact.z+drive.z*.115},ready]:[ready,{x:.48*h,y:high?2.26:1.22,z:.08},contact,{x:-.3*h,y:shot==='smash'?1.13:1.63,z:.83},ready];
 if(age<=0||age>=.48)return {...ready};
 let i=0;while(age>TIMES[i+1])i++;
 const duration=TIMES[i+1]-TIMES[i],t=(age-TIMES[i])/duration,t2=t*t,t3=t2*t,out={};
 for(const key of ['x','y','z']){
  const velocity=j=>j===0||j===4?0:(points[j+1][key]-points[j-1][key])/(TIMES[j+1]-TIMES[j-1]);
  out[key]=(2*t3-3*t2+1)*points[i][key]+(t3-2*t2+t)*duration*velocity(i)+(-2*t3+3*t2)*points[i+1][key]+(t3-t2)*duration*velocity(i+1);
 }
 return out;
}
// Coordinated reference pose; IK still owns the final contact correction.
export function sampleStrokePose(age,shot,hand,contact,variant){
 const h=hand<0?-1:1,high=shot==='smash'||shot==='clear',gain=high?1:.48;
 return {
  target:sampleStroke(age,shot,h,contact,variant),
  load:curve(age,[0,1,.25,.08,0]),
  pelvisYaw:(variant==='backhand'?-h:h)*curve(age,[0,.20,-.13,-.17,0])*gain,
  torsoYaw:(variant==='backhand'?-h:h)*curve(age,[0,.46,-.06,-.32,0])*gain,
  chestPitch:curve(age,[0,-.10,.02,shot==='smash'?.14:.06,0])*gain,
  shaftLag:curve(age,[.34,.9,0,-.42,.34]),
  forearmRoll:(variant==='backhand'?-h:h)*curve(age,[.15,-.95,0,.85,.15])*gain,
  elbowLift:curve(age,[0,high?.8:.2,.35,-.05,0]),
  freeHand:{x:-h*curve(age,[.32,.47,.4,.27,.32]),y:curve(age,[1.08,high?1.94:1.25,1.5,1.0,1.08]),z:curve(age,[.22,.38,.32,.14,.22])},
 };
}
