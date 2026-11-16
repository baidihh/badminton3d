import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage={getItem:()=>null};
const {SENS,onMotion,setSwingHandler}=await import('../public/js/ctrl/sens.js');
let ts=100;
function stroke(yaw,pitch,heading=0){
  SENS.calibrated=true;SENS.hasOrient=true;SENS.lastOrientT=performance.now();
  SENS.gyroAvailable=true;SENS.stillDone=true;SENS.thresholdOmega=220;
  SENS.qRaw.set(0,Math.sin(heading/2),0,Math.cos(heading/2));
  SENS.swing=null;SENS.waitRelease=false;SENS.omegaBuf=[];SENS.motionEventT=0;
  let result;setSwingHandler((power,dir)=>{result=dir;});
  for(let i=0;i<9;i++) {
    onMotion({timeStamp:ts+=16,rotationRate:{alpha:0,beta:i<6?pitch:0,gamma:i<6?yaw:0},acceleration:{x:0,y:0,z:0}});
  }
  return result;
}
test('gyro yaw selects opposite directions for opposite sweeps',()=>{
  assert.ok(stroke(500,0)>0);assert.ok(stroke(-500,0)<0);
});
test('changing compass heading does not change the same sweep intent',()=>{
  assert.equal(stroke(500,0,0),stroke(500,0,1.2));
});
test('pure upward/downward swing does not invent lateral aim',()=>{
  assert.equal(stroke(0,500),0);
});
