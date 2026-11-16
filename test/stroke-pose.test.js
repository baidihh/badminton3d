import test from 'node:test';import assert from 'node:assert/strict';
import {sampleStroke,sampleStrokePose} from '../public/js/stroke.js';
const contact={x:.2,y:2,z:.55};
test('stroke phases rotate body and forearm in sequence while retaining exact contact',()=>{
 const back=sampleStrokePose(.07,'clear',1,contact),hit=sampleStrokePose(.14,'clear',1,contact),follow=sampleStrokePose(.24,'clear',1,contact);
 assert.ok(back.torsoYaw>hit.torsoYaw);assert.ok(Math.abs(back.forearmRoll-follow.forearmRoll)>.5);
 assert.ok(back.freeHand.y>follow.freeHand.y);assert.ok(Math.abs(hit.shaftLag)<1e-9);
 assert.deepEqual(sampleStroke(.14,'clear',1,contact),contact);
});
test('left and right strokes mirror body rotation and balance arm',()=>{
 for(const t of [.04,.08,.14,.24,.4]){
  const a=sampleStrokePose(t,'smash',1,contact),b=sampleStrokePose(t,'smash',-1,{...contact,x:-contact.x});
  assert.ok(Math.abs(a.torsoYaw+b.torsoYaw)<1e-9);assert.ok(Math.abs(a.freeHand.x+b.freeHand.x)<1e-9);
 }
});
test('stroke enters and exits ready with continuous low endpoint velocity',()=>{
 const a=sampleStroke(0,'clear',1,contact),b=sampleStroke(.0001,'clear',1,contact),c=sampleStroke(.4799,'clear',1,contact),d=sampleStroke(.48,'clear',1,contact);
 const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
 assert.ok(dist(a,b)/.0001<.1);assert.ok(dist(c,d)/.0001<.1);
 const pre=sampleStroke(.1399,'clear',1,contact),post=sampleStroke(.1401,'clear',1,contact);assert.ok(dist(pre,post)/.0002>1,'racket travels through contact instead of stopping there');
});
