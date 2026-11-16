import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../game/game.js';
import { integrate, simBall, solveLaunch } from '../game/physics.js';

function match() { const g = new Game(); g.started = true; g.phase = 'rally'; g.right.ai = false; return g; }
test('out of bounds awards opponent of last hitter', () => {
  const g = match(); g.holder = 'left'; g.ball = {x:4,y:0.001,z:2,vx:0,vy:0,vz:0};
  g.step(1/60); assert.equal(g.right.score, 1);
});
test('invalid swing cannot corrupt the simulation', () => {
  const g = match(); g.swing('left', NaN, Infinity, 'bad');
  assert.equal(g.left.pending, null);
});
test('repeated empty swings cost more running distance, then recover', () => {
  function distance(count) {
    const g = match(); g.ball = {x:0,y:3,z:5,vx:0,vy:0,vz:0}; const p=g.left; p.x=-2.8;
    for(let i=0;i<60;i++) {
      if(i===0 && count>0 || i===15 && count>1) g.swing('left');
      g.t += 1/60; g.stepMove(p,1/60,1,0);
    }
    return p.x;
  }
  assert.ok(distance(0)>distance(1)+0.1);
  assert.ok(distance(1)>distance(2)+0.1);
});
test('restart clears input, history and movement recovery', () => {
  const g=match(); g.swing('left'); g.pushHist(); g.restart();
  assert.equal(g.left.pending,null); assert.equal(g.hist.length,0);
  assert.equal(g.left.recoverUntil,0);
});
test('history is clamped to newest sample', () => {
  const g=match(); g.hist=[{t:1,x:1,y:2,z:3},{t:2,x:2,y:2,z:3}];
  assert.equal(g.ballAt(2.1).x,2);
});
test('prediction and live physics use the same integration', () => {
  const b={x:0,y:2,z:-4,vx:4,vy:10,vz:12}; const initial={...b};
  for(let i=0;i<90;i++) integrate(b,1/60);
  const pred=simBall(initial.x,initial.y,initial.z,initial.vx,initial.vy,initial.vz,1.5);
  assert.ok(Math.hypot(pred.x-b.x,pred.y-b.y,pred.z-b.z)<0.001);
});
test('launch solution reaches its intended landing', () => {
  const b={x:0,y:2.4,z:-4}; const s=solveLaunch(b,1.5,5,1.5);
  const r=simBall(b.x,b.y,b.z,s.vx,s.vy,s.vz,1.5);
  assert.ok(Math.hypot(r.x-1.5,r.y,r.z-5)<0.04);
  assert.equal(s.netY,r.yNet);
});
test('rewind pairs the historical racket with the historical ball', () => {
  const g=match(); const p=g.left; g.t=1; p.y=2; p.x=2;
  g.ball={x:2,y:2,z:-4,vx:0,vy:0,vz:0};
  g.hist=[{t:0.9,x:0,y:2,z:-4,holder:null,left:{x:0,y:2,z:-4},right:{x:0,y:2,z:4}}];
  g.swing('left',0.7,0,0.5,'clear',{lagMs:100});
  assert.equal(g.tryHit(p),true);
  assert.equal(g.impact.x,0); assert.equal(g.impact.grade,'perfect');
});
test('failed rewind does not block a later real-time hit', () => {
  const g=match(); const p=g.left; g.t=1; p.y=2;
  g.ball={x:0,y:2,z:-4.05,vx:0,vy:0,vz:0};
  g.hist=[{t:0.9,x:0,y:2,z:2,holder:null,left:{x:0,y:2,z:-4},right:{x:0,y:2,z:4}}];
  g.swing('left',0.7,0,0.5,'clear',{lagMs:100});
  assert.equal(g.tryHit(p),true);
});
test('forced serve emits finite velocities', () => {
  const g=match(); g.phase='serve'; g.forceServe(g.right);
  assert.ok([g.ball.vx,g.ball.vy,g.ball.vz].every(Number.isFinite));
});
test('footwork starts intercepting before the shuttle crosses the net', () => {
  const g=match(); g.holder='right'; g.ball={x:1.5,y:2,z:1,vx:0,vy:1,vz:-7};
  g.autoFootwork(g.left,1/60); assert.ok(g.left.mvx>0);
});
test('movement speed recovers fully after empty swing', () => {
  const g=match(); g.swing('left'); g.t=2; g.left.x=-2;
  for(let i=0;i<30;i++) g.stepMove(g.left,1/60,1,0);
  assert.ok(g.left.mvx>3.59);
});
test('ordinary cross-court ball is reachable, two early swings lose the interception', () => {
  function closest(swings) {
    const g=match(); g.holder='right'; g.left.x=-2;
    const b={x:-1,y:2.4,z:3}; Object.assign(b,solveLaunch(b,2,-4,1.1));g.ball=b;
    let closest=Infinity;
    for(let i=0;i<66;i++) {
      if(i===0 && swings>0 || i===15 && swings>1) g.swing('left');
      g.step(1/60);
      if(g.phase!=='rally') break;
      const rc=g.racketAt(g.left);
      if(g.ball.z<0) closest=Math.min(closest,Math.hypot(g.ball.x-rc.x,g.ball.y-rc.y,g.ball.z-rc.z));
    }
    return closest;
  }
  assert.ok(closest(0)<0.98); assert.ok(closest(1)<0.98); assert.ok(closest(2)>0.98);
});
test('landing uses stroke intent even when compass angle disagrees',()=>{
  const g=match();g.left.y=2;g.left.x=1;
  g.ball={x:1,y:2,z:-4.05,vx:0,vy:0,vz:0};
  g.swing('left',0.7,0.5,0.5,'clear',{az:-1.5});g.tryHit(g.left);
  assert.equal(g.impact.tx,-0.5);
  assert.equal(g.left.stroke.hit,true);
  assert.equal(g.left.stroke.age,undefined);
  assert.ok(Math.abs(g.pack(g.left).stroke.age-0.14)<1e-10);
});
