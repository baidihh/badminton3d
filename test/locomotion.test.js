import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const moduleUrl=new URL('../public/js/locomotion.js',import.meta.url);
const base={x:0,z:0,vx:0,vz:0,yaw:0,hand:'right',near:0,ballX:0,ballZ:1,legReach:.9};
async function make(){assert.ok(fs.existsSync(moduleUrl),'implement planted-foot locomotion');const {ContactLocomotion}=await import(moduleUrl);return new ContactLocomotion();}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
function finite(pose){for(const v of Object.values(pose.pelvis))assert.ok(Number.isFinite(v));assert.ok(Number.isFinite(pose.splitHeight));for(const foot of Object.values(pose.feet)){for(const key of ['x','z','lift','yaw','pitch','phase'])assert.ok(Number.isFinite(foot[key]),key);assert.ok(foot.lift>=0);}}
for(const speed of[1.6,3.6])test(`speed ${speed} alternates without double swing and stance targets never slide`,async()=>{
 const gait=await make();let before=gait.update(0,base),steps={left:0,right:0},air=0;
 for(let i=1;i<=600;i++){const pose=gait.update(1/60,{...base,z:speed*i/60,vz:speed});finite(pose);
  assert.ok(Object.values(pose.feet).some(f=>f.stance),'both feet airborne without impact cue');
  for(const side of['left','right']){const foot=pose.feet[side],old=before.feet[side];if(foot.stance&&old.stance)assert.equal(distance(foot,old),0,'planted foot moved');if(!foot.stance&&old.stance)steps[side]++;if(!foot.stance)air++;
   assert.ok(distance(foot,{x:0,z:speed*i/60})<.78,'body outran a planted leg');}
  assert.ok(Math.hypot(pose.pelvis.x,pose.pelvis.z)<=.121);before=pose;
 }
 assert.ok(steps.left>10&&steps.right>10,'gait actually steps');assert.ok(Math.abs(steps.left-steps.right)<=1,'steps alternate');assert.ok(air>100,'feet visibly swing');
});

test('a landing target remains fixed when velocity changes during a swing',async()=>{
 const a=await make(),b=await make();a.update(0,base);b.update(0,base);let pose,t=0;
 do{t+=1/120;pose=a.update(1/120,{...base,z:t*1.6,vz:1.6});b.update(1/120,{...base,z:t*1.6,vz:1.6});}while(pose.feet.left.stance&&pose.feet.right.stance);
 const side=pose.feet.left.stance?'right':'left';let landingA,landingB;
 for(let i=0;i<100;i++){t+=1/120;const pa=a.update(1/120,{...base,z:t*1.6,vz:1.6});const pb=b.update(1/120,{...base,z:t*1.6,vx:-1.6,vz:0});if(!landingA&&pa.feet[side].stance)landingA=pa.feet[side];if(!landingB&&pb.feet[side].stance)landingB=pb.feet[side];if(landingA&&landingB)break;}
 assert.ok(landingA&&landingB);assert.ok(distance(landingA,landingB)<1e-9,'in-air foot chased a new landing target');
});

test('opponent impact triggers one age-aware split step and a repeated id cannot retrigger it',async()=>{
 const gait=await make();gait.update(0,base);let peak=0,after=0;
 for(let i=0;i<120;i++){const pose=gait.update(1/120,{...base,opponentImpactId:5,opponentImpactAge:i/120});peak=Math.max(peak,pose.splitHeight);if(i>50)after=Math.max(after,pose.splitHeight);assert.equal(pose.feet.left.lift,0,'split is common root lift');assert.equal(pose.feet.right.lift,0);}
 assert.ok(peak>.035,'impact needs a readable hop');assert.equal(after,0);
 for(let i=0;i<40;i++)assert.equal(gait.update(1/120,{...base,opponentImpactId:5,opponentImpactAge:0}).splitHeight,0);
 const late=await make();late.update(0,base);let latePeak=0;for(let i=0;i<60;i++)latePeak=Math.max(latePeak,late.update(1/120,{...base,opponentImpactId:7,opponentImpactAge:.8+i/120}).splitHeight);assert.equal(latePeak,0,'stale impact must not cause a late hop');
});

test('stopping settles both feet and pelvis without alternating forever',async()=>{
 const gait=await make();gait.update(0,base);let pose;
 for(let i=1;i<=120;i++)pose=gait.update(1/60,{...base,z:1.6*i/60,vz:1.6});
 for(let i=0;i<180;i++)pose=gait.update(1/60,{...base,z:3.2});
 assert.ok(pose.feet.left.stance&&pose.feet.right.stance);assert.equal(pose.feet.left.lift,0);assert.equal(pose.feet.right.lift,0);
 const before=pose;for(let i=0;i<60;i++)pose=gait.update(1/60,{...base,z:3.2});assert.equal(distance(before.feet.left,pose.feet.left),0);assert.equal(distance(before.feet.right,pose.feet.right),0);
 assert.ok(Math.abs(pose.pelvis.drop)<.008);assert.ok(Math.abs(pose.pelvis.pitch)<.008);assert.ok(Math.abs(pose.pelvis.roll)<.008);
});

test('low-ball lunge leads with the racket foot then recovers when the cue ends',async()=>{
 for(const hand of['left','right']){const gait=await make();gait.update(0,{...base,hand});let pose;
  for(let i=0;i<80;i++)pose=gait.update(1/120,{...base,hand,near:1,ballX:.12,ballZ:.8});
  const side=hand==='left'?'left':'right',other=hand==='left'?'right':'left';assert.ok(pose.feet[side].z-pose.feet[other].z>.18,'racket foot should lead the lunge');assert.ok(pose.pelvis.drop>.04,'lunge must lower weight');
  for(let i=0;i<200;i++)pose=gait.update(1/120,{...base,hand});assert.ok(Math.abs(pose.feet[side].z)<.1);assert.ok(pose.feet.left.stance&&pose.feet.right.stance);
 }
});

test('teleports reset finite feet immediately and stance yaw stays independent of hip yaw',async()=>{
 const gait=await make();let first=gait.update(0,base);const after=gait.update(1/60,{...base,yaw:.2});assert.equal(after.feet.left.yaw,first.feet.left.yaw);assert.equal(after.feet.right.yaw,first.feet.right.yaw);
 const reset=gait.update(1/60,{...base,x:20,z:-30,yaw:Math.PI});finite(reset);assert.ok(distance(reset.feet.left,{x:20,z:-30})<.3);assert.ok(distance(reset.feet.right,{x:20,z:-30})<.3);assert.ok(reset.feet.left.stance&&reset.feet.right.stance);
});

test('30, 60 and 120 Hz preserve step timing and planted-foot trajectories',async()=>{
 const poses=[];for(const hz of[30,60,120]){const gait=await make();gait.update(0,base);let pose;for(let i=1;i<=hz*3;i++)pose=gait.update(1/hz,{...base,z:i/hz*1.6,vz:1.6});poses.push(pose);}
 for(const pose of poses.slice(1)){for(const side of['left','right'])assert.ok(distance(pose.feet[side],poses[0].feet[side])<.025,'gait diverged with frame rate');assert.ok(Math.abs(pose.pelvis.drop-poses[0].pelvis.drop)<.01);}
});

test('shorter legs release a stretched stance before horizontal reach becomes unsafe',async()=>{
 const gait=await make();gait.update(0,{...base,legReach:.78});let max=0;
 for(let i=1;i<=360;i++){const pose=gait.update(1/60,{...base,z:3.6*i/60,vz:3.6,legReach:.78});for(const foot of Object.values(pose.feet))if(foot.stance)max=Math.max(max,distance(foot,{x:0,z:3.6*i/60}));}
 assert.ok(max<.57,`short-leg stance stretched ${max}m horizontally`);
});

test('split-step catches up to impact age and ignores ball recrossings without a new impact',async()=>{
 const gait=await make();gait.update(0,base);
 const fresh=gait.update(1/120,{...base,opponentImpactId:10,opponentImpactAge:.12});assert.ok(fresh.splitHeight>.045,'aged cue should enter the descending hop immediately');
 for(let i=0;i<200;i++)gait.update(1/120,base);
 for(let i=0;i<100;i++)assert.equal(gait.update(1/120,{...base,ballZ:i%2?-.1:.1}).splitHeight,0,'crossing the net invented an impact');
});

test('changing direction keeps locked contacts, bounded transfer and eventually settles',async()=>{
 const gait=await make();gait.update(0,base);let x=0,z=0,previous,pose;
 for(let i=0;i<480;i++){const vx=i<120?2.5:i<240?-2.5:i<360?0:1.8,vz=i<240?0:i<360?-2.5:1.8;x+=vx/60;z+=vz/60;pose=gait.update(1/60,{...base,x,z,vx,vz});finite(pose);assert.ok(pose.feet.left.stance||pose.feet.right.stance);assert.ok(Math.hypot(pose.pelvis.x,pose.pelvis.z)<=.121);if(previous)for(const side of['left','right'])if(previous.feet[side].stance&&pose.feet[side].stance)assert.equal(distance(previous.feet[side],pose.feet[side]),0);previous=pose;}
 for(let i=0;i<180;i++)pose=gait.update(1/60,{...base,x,z});assert.ok(pose.feet.left.stance&&pose.feet.right.stance);
});
test('historical impact with unknown age never produces a fresh hop',async()=>{
 const controller=await make();let highest=0;
 for(let i=0;i<40;i++){const p=controller.update(1/60,{x:0,z:-4.6,vx:0,vz:0,yaw:0,opponentImpactId:99,opponentImpactAge:Infinity});highest=Math.max(highest,p.splitHeight);}
 assert.equal(highest,0);
});
