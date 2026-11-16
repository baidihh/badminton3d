import { randomUUID } from 'node:crypto';
import { integrate } from './physics.js';
import { NET_H, NET_HALF_W, clamp } from './constants.js';

const STANCE = Object.freeze({ x: -1.8, z: -4.6 });
const TARGETS = [
  { id:'straight_back', label:'正前方后场', x:-1.8, z:5.25, halfWidth:0.75, halfDepth:1 },
  { id:'cross_back', label:'斜左后场', x:1.8, z:5.25, halfWidth:0.75, halfDepth:1 },
];

// 提示目标仅用于记录和比较；永远不能进入 launch 参数，避免把答案喂给算法。
export class TargetTraining {
  constructor(game, { write, isRecording, notify = () => {}, onError = () => {} }) {
    Object.assign(this,{game,write,isRecording,notify,onError});
    this.active=false;this.error='';
  }
  start(ownerId) {
    if (!ownerId || !this.isRecording(ownerId)) {
      this.error='训练采集尚未开启，请先连接手机并开启记录。'; return false;
    }
    if (this.active) this.stop('restart_training');
    const g=this.game;
    this.backup={rightAI:g.right.ai,rightName:g.right.name,started:g.started,serverSide:g.serverSide,
      phase:g.phase,msg:g.msg,leftScore:g.left.score,rightScore:g.right.score,
      left:{x:g.left.x,y:g.left.y,z:g.left.z},right:{x:g.right.x,y:g.right.y,z:g.right.z}};
    this.active=true;this.ownerId=ownerId;this.sessionId=randomUUID();
    this.index=0;this.completed=0;this.total=6;this.result=null;this.lastResult=null;this.error='';
    g.started=true;g.right.ai=false;
    if (!this.record({event:'start',total:this.total,controlVersion:4,labelSource:'prompted',compliance:'assumed'})) return false;
    return this.prepare();
  }
  record(event) {
    const ok=this.write(this.ownerId,{sessionId:this.sessionId,simulationTime:this.game.t,...event});
    if (!ok) {
      this.error='记录中断，训练已停止；这一拍不计入有效采样。';
      this.stop('recording_failed',false);this.onError(this.error);
    }
    return ok;
  }
  prepare() {
    const g=this.game;
    this.attemptId=randomUUID();this.target={...TARGETS[this.index%2]};
    this.status='ready';this.result=null;this.elapsed=0;this.remaining=0;this.input=null;this.plannedTarget=null;
    g.hist=[];g.holder=null;g.rally=0;g.aiPlan=null;g.phase='serve';g.serverSide='left';g.msg=this.target.label;
    for(const p of [g.left,g.right]) {
      p.pending=null;p.armedUntil=0;p.nextSwingAt=0;p.recoverUntil=0;p.stroke=null;p.flash=0;p.mvx=p.mvz=0;
    }
    Object.assign(g.left,{...STANCE,y:2.1});
    Object.assign(g.right,{x:0,y:1.1,z:4.6});
    Object.assign(g.ball,{x:STANCE.x,y:2.1,z:STANCE.z+0.55,vx:0,vy:0,vz:0});
    g.impact.power=0;
    if (!this.record({event:'attempt',stage:'prompt',attemptId:this.attemptId,index:this.index,
      requestedTarget:this.target,stance:{...STANCE},labelSource:'prompted',compliance:'assumed'})) return false;
    this.notify(this.snapshot());return true;
  }
  swing(ownerId, attemptId, input, sensorCapture) {
    if (!this.active || ownerId!==this.ownerId || attemptId!==this.attemptId || this.status!=='ready' || this.input) return false;
    if (!this.isRecording(ownerId)) {this.failRecording();return false;}
    const g=this.game;
    // 标签不进入 opts.tx；按当前实际控制算法击球，保留对照的真实性。
    if (!g.swing('left',input.power,input.dir,input.lift,input.shot,{az:input.az,lagMs:input.lagMs})) return false;
    this.input={...input};this.elapsed=0;
    if (!this.record({event:'attempt',stage:'input',attemptId,index:this.index,
      requestedTarget:this.target,observedInput:{...input},sensorCapture,
      swingId:g.left.swingId,labelSource:'prompted',compliance:'assumed'})) return false;
    return true;
  }
  finish(outcome, actual=null) {
    if (!this.active || this.status==='result' || this.status==='complete') return;
    const inTarget=outcome==='landed' && Math.abs(actual.x-this.target.x)<=this.target.halfWidth
      && Math.abs(actual.z-this.target.z)<=this.target.halfDepth;
    this.result={attemptId:this.attemptId,outcome,actual,inTarget,requestedTarget:{...this.target}};
    if (!this.record({event:'result',attemptId:this.attemptId,index:this.index,
      requestedTarget:this.target,plannedTarget:this.plannedTarget || null,result:this.result})) return;
    this.lastResult={...this.result,index:this.index};
    this.completed++;this.status='result';this.remaining=4;
    const g=this.game;g.phase='point';g.left.pending=null;g.ball.vx=g.ball.vy=g.ball.vz=0;
    this.notify(this.snapshot());
  }
  retry(ownerId, attemptId) {
    if (!this.active || ownerId!==this.ownerId || !this.lastResult || attemptId!==this.lastResult.attemptId) return false;
    // 新题已经挥拍后禁止倒退，避免旧按钮取消正在飞行的另一拍。
    if (this.status!=='result' && this.status!=='complete') return false;
    const previous=this.lastResult;
    if (!this.record({event:'exclude',attemptId:previous.attemptId,reason:'user_retry'})) return false;
    this.completed=Math.max(0,this.completed-1);this.index=previous.index;this.lastResult=null;
    return this.prepare();
  }
  step(dt) {
    const g=this.game;
    if (!this.isRecording(this.ownerId)) {this.failRecording();return;}
    g.pushHist();g.t+=dt;
    for(const p of [g.left,g.right])p.flash=Math.max(0,p.flash-dt*2.8);
    g.impact.power=Math.max(0,g.impact.power-dt*2.6);
    if(this.status==='complete') return;
    if(this.status==='result') {
      this.remaining=Math.max(0,this.remaining-dt);
      if(this.remaining===0) {
        if(this.completed>=this.total) {
          this.status='complete';
          if(this.record({event:'complete',completed:this.completed}))this.notify(this.snapshot());
        } else {this.index++;this.prepare();}
      }
      return;
    }
    if(this.status==='ready') {
      if(!this.input) return;
      this.elapsed+=dt;
      if(g.tryHit(g.left)) {
        this.status='flying';this.elapsed=0;
        this.plannedTarget={x:g.impact.tx,z:g.impact.tz,T:g.impact.T};
        this.notify(this.snapshot());
      } else if(this.elapsed>0.35) this.finish('miss');
      return;
    }
    this.elapsed+=dt;
    const b=g.ball,prev={...b};integrate(b,dt);
    if(![b.x,b.y,b.z,b.vx,b.vy,b.vz].every(Number.isFinite) || this.elapsed>8) {this.finish('miss');return;}
    if((prev.z<0)!==(b.z<0)) {
      const f=-prev.z/(b.z-prev.z),y=prev.y+(b.y-prev.y)*f,x=prev.x+(b.x-prev.x)*f;
      if(y<NET_H+0.06 && Math.abs(x)<NET_HALF_W) {Object.assign(b,{x,y,z:0});this.finish('net');return;}
    }
    if(b.y<=0.02) {
      const f=clamp((prev.y-0.02)/(prev.y-b.y || 1),0,1);
      const actual={x:prev.x+(b.x-prev.x)*f,y:0.02,z:prev.z+(b.z-prev.z)*f};
      Object.assign(b,actual);this.finish('landed',actual);
    }
  }
  stop(reason='user_exit',save=true) {
    if(!this.active)return;
    if(save)this.write(this.ownerId,{event:'stop',sessionId:this.sessionId,attemptId:this.attemptId,reason,simulationTime:this.game.t});
    this.active=false;
    const g=this.game,b=this.backup;
    Object.assign(g.left,b.left,{score:b.leftScore});Object.assign(g.right,b.right,{score:b.rightScore,ai:b.rightAI,name:b.rightName});
    g.started=b.started;g.serverSide=b.serverSide;g.doService();
    if(b.phase==='over'){g.phase='over';g.msg=b.msg;}
    this.notify(null);
  }
  failRecording() {
    this.error='记录中断，训练已停止；这一拍不计入有效采样。';
    this.stop('recording_failed',false);
    this.onError(this.error);
  }
  snapshot() {
    if(!this.active)return null;
    return {active:true,owner:'left',status:this.status,index:this.index,total:this.total,attemptId:this.attemptId,
      prompt:`右侧站位 · 打向${this.target?.label || ''}`,stance:{...STANCE},target:this.target,
      result:this.result,remaining:this.remaining,completed:this.completed,recording:this.isRecording(this.ownerId)};
  }
}
