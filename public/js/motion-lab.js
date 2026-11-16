import * as THREE from 'three';
import {PlayerView,loadPlayerGLTF,shadowTexture} from './player.js';
import {PlayerView as LegacyPlayerView} from './motion-legacy-player.js';
import {CHARACTERS,getCharacter} from './characters.js';
import {cachedLoader} from './character-slot.js';
const $=id=>document.getElementById(id),canvas=$('motionCanvas');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const panels=[$('motionA'),$('motionB')],shadowTex=shadowTexture(),load=cachedLoader(loadPlayerGLTF),camera=new THREE.PerspectiveCamera(35,1,.1,40);
const scenes=panels.map(()=>{const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0xbac9a9,2.8));const sun=new THREE.DirectionalLight(0xfff2dd,3);sun.position.set(3,6,1);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-4;sun.shadow.camera.right=4;sun.shadow.camera.top=4;sun.shadow.camera.bottom=-9;sun.shadow.normalBias=.03;scene.add(sun);const floor=new THREE.Mesh(new THREE.CircleGeometry(2.6,64),new THREE.MeshStandardMaterial({color:0xdce5d0,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.set(0,-.02,-4.6);floor.receiveShadow=true;scene.add(floor);const grid=new THREE.GridHelper(5,10,0xb7c9ac,0xc8d5bc);grid.position.set(0,-.015,-4.6);scene.add(grid);return scene;});
let views=[],time=0,action='clear',hand='right',angle=.65,speed=1,paused=false,dirty=false,last=performance.now(),generation=0,metrics=[],frameId,disposed=false;
function resetMetrics(){metrics=[{previous:{},sum:0,count:0},{previous:{},sum:0,count:0}];}
function stateAt(t){
 let x=0,vx=0;
 if(action==='strafe'){x=Math.sin(t*1.7)*1.05;vx=Math.cos(t*1.7)*1.785;}
 if(action==='stop'){const u=t%4;if(u<1.7){x=-.85+u;vx=1;}else if(u<2.5)x=.85;else {x=.85-(u-2.5)*1.1;vx=-1.1;}}
 const p={x,y:2,z:-4.6,vx,vz:0,hand,flash:0};let ball={x:0,y:2,z:3};
 if(action==='clear'||action==='smash'){const age=t%1.5;p.flash=age<.4?.5:0;p.stroke={id:Math.floor(t/1.5)+1,age,hit:true,shot:action,contact:{x:(hand==='left'?-.2:.2),y:2,z:-4.05}};ball={x:0,y:2,z:-3.7};}
 if(action==='lunge')ball={x:(hand==='left'?-.38:.38),y:t%4<2?.8:2.2,z:t%4<2?-3.7:3};
 const context=action==='strafe'||action==='stop'?{opponentImpactId:Math.floor(t/2)+1,opponentImpactAge:t%2}:{};
 return {p,ball,context};
}
function update(dt,t,record=true){const {p,ball,context}=stateAt(t);views.forEach((view,i)=>{view.update(dt,p,ball,context);view.root.updateMatrixWorld(true);if(!record)return;for(const side of ['left','right']){const position=view.legs[side].foot.getWorldPosition(new THREE.Vector3()),stance=view.motionState?.feet[side].stance??!view.legs[side].st.on,prev=metrics[i].previous[side];if(prev?.stance&&stance&&t>.25){metrics[i].sum+=Math.hypot(position.x-prev.x,position.z-prev.z)*1000;metrics[i].count++;}metrics[i].previous[side]={...position,stance};}});}
function fresh(){for(const view of views)view.dispose();views=[];}
let asset,character;
function construct(){fresh();if(!asset)return;views=[new LegacyPlayerView(asset,{character,accent:0x478c9c,shadowTex}),new PlayerView(asset,{character,accent:0x478c9c,shadowTex})];views.forEach((v,i)=>v.addTo(scenes[i]));resetMetrics();update(1/120,0,false);}
function replay(t){construct();for(let at=0;at<t;at+=1/120)update(Math.min(1/120,t-at),Math.min(t,at+1/120),false);time=t;dirty=false;resetMetrics();}
async function choose(id){const serial=++generation;$('motionStatus').textContent='正在准备对照…';const next=getCharacter(id);try{const result=await load(next.modelUrl);if(serial!==generation||disposed)return;asset=result;character=next;time=0;construct();$('motionStatus').textContent='升级前 / 升级后 · 已同步';}catch{$('motionStatus').textContent='角色加载失败，请换一位搭档';}}
for(const c of CHARACTERS){const option=document.createElement('option');option.value=c.id;option.textContent=c.name;$('role').append(option);}$('role').value='young-man';$('role').onchange=()=>choose($('role').value);
function mark(container,button){container.querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});}
$('actions').onclick=e=>{const b=e.target.closest('button');if(b){action=b.dataset.action;mark($('actions'),b);replay(0);}};
$('hands').onclick=e=>{const b=e.target.closest('button');if(b){hand=b.dataset.hand;mark($('hands'),b);replay(time);}};
$('angles').onclick=e=>{const b=e.target.closest('button');if(b){angle=Number(b.dataset.angle);mark($('angles'),b);}};
$('pause').onclick=()=>{paused=!paused;$('pause').textContent=paused?'继续':'暂停';$('pause').setAttribute('aria-pressed',String(paused));};$('speed').onchange=e=>{speed=Number(e.target.value);resetMetrics();};
$('timeline').oninput=e=>{paused=true;$('pause').textContent='继续';$('pause').setAttribute('aria-pressed','true');replay(Number(e.target.value));};$('reset').onclick=()=>replay(0);
let drag=null;canvas.onpointerdown=e=>{drag={x:e.clientX,angle};canvas.setPointerCapture(e.pointerId);};canvas.onpointermove=e=>{if(drag){angle=drag.angle-(e.clientX-drag.x)*.01;mark($('angles'),null);}};canvas.onpointerup=canvas.onpointercancel=()=>{drag=null;};
function frame(now){if(disposed)return;const dt=paused?0:Math.min((now-last)/1000,.04)*speed;last=now;if(!paused){time+=dt;update(dt,time);}const rect=canvas.getBoundingClientRect(),ratio=renderer.getPixelRatio();if(canvas.width!==Math.floor(rect.width*ratio)||canvas.height!==Math.floor(rect.height*ratio))renderer.setSize(rect.width,rect.height,false);renderer.setScissorTest(false);renderer.clear();renderer.setScissorTest(true);panels.forEach((panel,i)=>{const box=panel.getBoundingClientRect(),distance=box.width<240?9:6.5;camera.position.set(Math.sin(angle)*distance,2.7,-4.6+Math.cos(angle)*distance);camera.lookAt(0,1.08,-4.6);camera.aspect=box.width/box.height;camera.updateProjectionMatrix();renderer.setViewport(box.left-rect.left,rect.bottom-box.bottom,box.width,box.height);renderer.setScissor(box.left-rect.left,rect.bottom-box.bottom,box.width,box.height);renderer.render(scenes[i],camera);const m=metrics[i];$('metric'+(i?'B':'A')).textContent=m?.count?(m.sum/m.count).toFixed(2):'—';});$('timeline').value=String(time%4);$('timeLabel').textContent=time.toFixed(2)+'s';frameId=requestAnimationFrame(frame);}
resetMetrics();choose('young-man');frameId=requestAnimationFrame(frame);
window.addEventListener('pagehide',event=>{if(event.persisted)return;disposed=true;generation++;cancelAnimationFrame(frameId);fresh();renderer.dispose();shadowTex.dispose();});
