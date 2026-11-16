import test from 'node:test';
import assert from 'node:assert/strict';
import { strokeDirection, handedStrokeDirection, aimTarget, swingPower } from '../public/js/control.js';
import { sampleStroke } from '../public/js/stroke.js';
test('stroke direction has a jitter deadzone and preserves left/right symmetry',()=>{
  assert.equal(strokeDirection(0.03),0);
  assert.ok(strokeDirection(0.4)>0);
  assert.equal(strokeDirection(-0.4),-strokeDirection(0.4));
});
test('left hand calibration separates confirmed left sweeps from forward sweeps',()=>{
  for(const yaw of [-0.1426,0.0896,-0.0669])
    assert.ok(handedStrokeDirection(yaw,'left')<-0.78);
  for(const yaw of [0.1883,0.3289,0.1948])
    assert.ok(handedStrokeDirection(yaw,'left')>-0.1);
  assert.equal(handedStrokeDirection(0,'right'),strokeDirection(0));
});
test('landing follows intent without amplifying stance or flight distance',()=>{
  const a=aimTarget('left',0.5),b=aimTarget('right',0.5);
  assert.ok(a<0 && a>-2.4);assert.equal(a,-b);
  assert.equal(aimTarget('left',0),0);
});
test('neutral aim follows stance and full cross court sweep remains reachable',()=>{
  assert.equal(aimTarget('left',0,-1.8),-1.8);
  assert.ok(aimTarget('left',-1,-1.8)>=1.8);
  assert.ok(aimTarget('left',1,-1.8)>=-2.45);
  assert.equal(aimTarget('right',0,1.8),1.8);
});
test('ordinary gyro peaks can reach the back court while weak swings remain short',()=>{
  const weak=swingPower(250,220),normal=swingPower(520,220),strong=swingPower(700,220);
  assert.ok(weak<0.5);
  assert.ok(normal>0.75 && normal<1);
  assert.ok(strong>normal);
});
test('stroke passes through the contact point and returns to ready',()=>{
  const contact={x:0.4,y:2,z:0.7};
  const p=sampleStroke(0.14,'smash',1,contact);
  assert.ok(Math.hypot(p.x-contact.x,p.y-contact.y,p.z-contact.z)<1e-12);
  assert.deepEqual(sampleStroke(0.6,'smash',1,contact),sampleStroke(0,'smash',1,contact));
});
test('stroke has distinct preparation and follow through with continuous contact',()=>{
  const c={x:0,y:2,z:0.55};
  assert.notDeepEqual(sampleStroke(0.08,'clear',1,c),sampleStroke(0.23,'clear',1,c));
  const a=sampleStroke(0.139,'clear',1,c),b=sampleStroke(0.141,'clear',1,c);
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z)<0.1);
});
