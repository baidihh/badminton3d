import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../game/game.js';
import { TargetTraining } from '../game/training.js';
import { swingPower } from '../public/js/control.js';
function setup(recording=true) {
  const game=new Game(),events=[];
  const training=new TargetTraining(game,{write:(id,event)=>{events.push(event);return recording;},isRecording:()=>recording});
  game.training=training;return {game,training,events};
}
function swing(t,g,dir=0.8) {return t.swing('controller',t.attemptId,{power:0.9,dir,lift:0.8,shot:'clear',lagMs:0},{samples:[]});}
function land(t,g) {for(let i=0;i<600 && t.status!=='result' && t.status!=='complete';i++)g.step(1/60);}
test('training labels precede input, holds right-side stance and does not leak target into launch',()=>{
  const {game:g,training:t,events}=setup();assert.equal(t.start('controller'),true);
  const label=t.snapshot().target;assert.equal(label.id,'straight_back');assert.equal(label.x,-1.8);
  for(let i=0;i<120;i++)g.step(1/60);assert.equal(g.left.x,-1.8);assert.equal(g.left.z,-4.6);
  assert.equal(events[1].stage,'prompt');assert.equal(events[1].compliance,'assumed');
  assert.equal(swing(t,g,-0.8),true);g.step(1/60);
  assert.ok(g.impact.tx>0,'opposite input must stay opposite even when goal is straight');
  land(t,g);assert.equal(t.result.inTarget,false);assert.ok(t.result.actual.x>0);
  assert.deepEqual([g.left.score,g.right.score],[0,0]);
});
test('neutral ordinary swing from right-side stance can land in straight back zone',()=>{
  const {game:g,training:t}=setup();t.start('controller');
  assert.equal(t.swing('controller',t.attemptId,{power:swingPower(520,220),dir:0,lift:0.6,shot:'clear',lagMs:0},{samples:[]}),true);
  land(t,g);
  assert.equal(t.result.outcome,'landed');
  assert.equal(t.result.inTarget,true);
});
test('full cross-court sweep can reach diagonal back zone without using the prompt as input',()=>{
  const {game:g,training:t}=setup();t.start('controller');
  swing(t,g,0);land(t,g);
  for(let i=0;i<250 && t.status==='result';i++)g.step(1/60);
  assert.equal(t.target.id,'cross_back');
  assert.equal(t.swing('controller',t.attemptId,{power:swingPower(600,220),dir:-1,lift:0.6,shot:'clear',lagMs:0},{samples:[]}),true);
  land(t,g);
  assert.equal(t.result.outcome,'landed');
  assert.equal(t.result.inTarget,true);
});
test('duplicates, other players and old attempt packets are ignored',()=>{
  const {game:g,training:t}=setup();t.start('controller');const old=t.attemptId;
  assert.equal(t.swing('stranger',old,{},{}),false);assert.equal(swing(t,g),true);assert.equal(swing(t,g),false);
  land(t,g);t.retry('controller',old);assert.notEqual(t.attemptId,old);
  assert.equal(t.swing('controller',old,{},{}),false);
});
test('retry invalidates previous result and reuses same target with a fresh id',()=>{
  const {game:g,training:t,events}=setup();t.start('controller');const old=t.attemptId;swing(t,g);land(t,g);
  assert.equal(t.completed,1);assert.equal(t.retry('controller',old),true);
  assert.equal(t.completed,0);assert.equal(t.index,0);assert.equal(t.status,'ready');
  assert.ok(events.some(e=>e.event==='exclude'&&e.attemptId===old));
});
test('six shots finish automatically; training exit restores prior scores and AI',()=>{
  const {game:g,training:t}=setup();g.left.score=3;g.right.score=2;t.start('controller');
  for(let n=0;n<6;n++) {assert.equal(t.index,n);swing(t,g,n%2?-0.8:0.8);land(t,g);for(let i=0;i<250 && t.status==='result';i++)g.step(1/60);}
  assert.equal(t.status,'complete');assert.equal(t.completed,6);assert.equal(t.snapshot().remaining,0);
  t.stop('finished');assert.equal(t.active,false);assert.equal(g.right.ai,true);assert.equal(g.left.score,3);assert.equal(g.right.score,2);
});
test('recording disabled refuses training and leaves game unchanged',()=>{
  const {game:g,training:t}=setup(false);assert.equal(t.start('controller'),false);assert.equal(t.active,false);assert.equal(g.started,false);
});
test('network result is a net contact, not a fabricated landing',()=>{
  const {game:g,training:t}=setup();t.start('controller');swing(t,g);g.step(1/60);
  Object.assign(g.ball,{x:0,y:1,z:-0.03,vx:0,vy:0,vz:8});g.step(1/60);
  assert.equal(t.result.outcome,'net');assert.equal(t.result.actual,null);assert.equal(t.result.inTarget,false);
});
