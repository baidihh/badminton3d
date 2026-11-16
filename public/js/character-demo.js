import { CHARACTERS, getCharacter, isCharacterId } from './characters.js';
import * as THREE from 'three';
import { PlayerView, loadPlayerGLTF, shadowTexture } from './player.js';
import { CharacterSlot, cachedLoader } from './character-slot.js';

const canvas = document.getElementById('comparison');
const status = document.getElementById('demoStatus');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.7));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const shadowTex = shadowTexture();
const load = cachedLoader(loadPlayerGLTF);
const panels = ['viewA', 'viewB'].map(id => document.getElementById(id));
const states = [];
const scenes = panels.map(() => {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc3cbb4, 2.8));
  const key = new THREE.DirectionalLight(0xfff7e7, 3.2);key.position.set(3,6,2);key.castShadow = true;
  key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-4;key.shadow.camera.right=4;key.shadow.camera.top=4;key.shadow.camera.bottom=-8;key.shadow.normalBias=.03;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xc9e8fc, 1.3);rim.position.set(-3,4,-6);scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.1,80),new THREE.MeshStandardMaterial({color:0xd5dfca,roughness:1}));
  floor.rotation.x=-Math.PI/2;floor.position.set(0,-.025,-4.6);floor.receiveShadow=true;scene.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.85,1.86,80),new THREE.MeshBasicMaterial({color:0xb3c6ac,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.set(0,-.02,-4.6);scene.add(ring);
  return scene;
});
const camera = new THREE.PerspectiveCamera(34,1,.1,60);
let poseDirty = true;
const slots = scenes.map((scene,i) => new CharacterSlot({
  load,
  create: (asset,character) => new PlayerView(asset,{character,accent:0x4589bb,shadowTex}),
  attach: view => view.addTo(scene), detach: view => scene.remove(view.root,view.blob),
  onStatus: next => {
    states[i]=next;
    if(next.state === 'ready' || next.state === 'fallback') poseDirty = true;
    status.textContent = states.some(s=>s.state==='error'||s.state==='fallback') ? '部分角色加载失败，已显示可用角色' : states.length===2&&states.every(s=>s.state==='ready') ? '球员已就位 · 两侧同步预览' : '正在准备球员…';
  },
}));
const selections = ['dino', 'kitten'];
function choose(index, id) {
  if (!isCharacterId(id)) return;
  selections[index] = id;
  const character = getCharacter(id), suffix = index ? 'B' : 'A';
  document.getElementById('select'+suffix).value = id;
  document.getElementById('title'+suffix).textContent = character.name;
  const play = document.getElementById('play'+suffix);
  play.href = '/?character='+encodeURIComponent(id);
  play.textContent = character.name+'上场 ↗';
  document.querySelectorAll('[data-preview]').forEach(b=>b.classList.toggle('active',selections[Number(b.dataset.preview)]===b.dataset.id));
  slots[index].select(id);
  const url = new URL(location.href);url.searchParams.set(index ? 'right' : 'left', id);history.replaceState(null,'',url);
}
for (const [index,suffix] of ['A','B'].entries()) {
  const select = document.getElementById('select'+suffix);
  for (const c of CHARACTERS) { const option=document.createElement('option');option.value=c.id;option.textContent=c.name+' · '+c.label;select.append(option); }
  select.onchange=()=>choose(index,select.value);
}
const cards = document.getElementById('rosterCards');
for (const c of CHARACTERS.filter(c=>c.group)) {
  const article=document.createElement('article');article.className='roster-card';article.dataset.group=c.group;
  article.innerHTML=`<div class="portrait"><img src="${c.thumbnail}" alt="${c.name}的三维角色预览" loading="lazy"><span class="audience">${c.audience} · 风格参考</span></div><div class="roster-info"><h3>${c.name}<span>${c.label}</span></h3><p>${c.description}</p><div class="card-actions"><button data-preview="0" data-id="${c.id}" aria-label="左侧预览${c.name}">左侧看</button><button data-preview="1" data-id="${c.id}" aria-label="右侧预览${c.name}">右侧看</button><a href="/?character=${c.id}" aria-label="选择${c.name}上场">选 TA ↗</a></div></div>`;
  cards.append(article);
}
cards.addEventListener('click',e=>{const button=e.target.closest('[data-preview]');if(button){choose(Number(button.dataset.preview),button.dataset.id);document.querySelector('.lab').scrollIntoView({behavior:'smooth',block:'start'});}});
document.getElementById('rosterFilters').addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button)return;
  selectButton(document.getElementById('rosterFilters'),button);
  for(const card of cards.children)card.hidden=button.dataset.group!=='all'&&card.dataset.group!==button.dataset.group;
});
const params = new URLSearchParams(location.search);
choose(0,isCharacterId(params.get('left'))?params.get('left'):'dino');
choose(1,isCharacterId(params.get('right'))?params.get('right'):'kitten');
let animationFrame;
let action='idle',hand='right',angle=0,paused=false,speed=1,time=0,previous=performance.now();
const selectButton = (container, button) => {
  container.querySelectorAll('button').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
};
for(const id of ['actions','hands','angles']) {
  const container=document.getElementById(id);
  container.addEventListener('click',e=>{
    const button=e.target.closest('button');if(!button)return;selectButton(container,button);
    if(id==='actions'){poseDirty=true;action=button.dataset.action;time=0;for(const slot of slots)if(slot.view){slot.view.strokeKey='';slot.view.strokeAge=1;}}
    if(id==='hands'){hand=button.dataset.hand;poseDirty=true;}
    if(id==='angles')angle=Number(button.dataset.angle);
  });
}
document.getElementById('pause').onclick=e=>{paused=!paused;e.currentTarget.textContent=paused?'继续':'暂停';e.currentTarget.setAttribute('aria-pressed',String(paused));};
document.getElementById('speed').onchange=e=>{speed=Number(e.target.value);};
let drag=null;
canvas.onpointerdown=e=>{drag={x:e.clientX,angle};canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(drag){angle=drag.angle-(e.clientX-drag.x)*.012;selectButton(document.getElementById('angles'),null);}};
canvas.onpointerup=canvas.onpointercancel=()=>{drag=null;};
function frame(now){
  const dt=paused?0:Math.min((now-previous)/1000,.04)*speed;previous=now;time+=dt;
  const rect=canvas.getBoundingClientRect();
  if(canvas.width!==Math.floor(rect.width*renderer.getPixelRatio())||canvas.height!==Math.floor(rect.height*renderer.getPixelRatio()))renderer.setSize(rect.width,rect.height,false);
  const moving=action==='footwork';
  const x=moving?Math.sin(time*2)*.4:0;
  const p={x,y:2,z:-4.6,vx:moving?Math.cos(time*2)*.8:0,vz:0,hand,flash:0};
  const age=time%1.8;
  if(action==='clear'||action==='smash'){
    p.flash=age<.4?.5:0;
    p.stroke={id:Math.floor(time/1.8),age,hit:true,shot:action,contact:{x:x+(hand==='left'?-.2:.2),y:2,z:-4.05}};
  }
  renderer.setScissorTest(false);renderer.clear();renderer.setScissorTest(true);
  for(let i=0;i<2;i++){
    const view=slots[i].view;
    if(view && (!paused || poseDirty))view.update(dt || 1e-6,p,{x:0,y:action==='smash'?2.1:2,z:-3.6});
    const panel=panels[i].getBoundingClientRect();const width=panel.width,height=panel.height;
    // Narrow screens pull back enough to keep ears and racket in frame.
    const distance=width<240?8.8:6.1;
    camera.position.set(Math.sin(angle)*distance,2.45,-4.6+Math.cos(angle)*distance);
    camera.lookAt(0,1.3,-4.6);camera.aspect=width/height;camera.updateProjectionMatrix();
    renderer.setViewport(panel.left-rect.left,rect.bottom-panel.bottom,width,height);
    renderer.setScissor(panel.left-rect.left,rect.bottom-panel.bottom,width,height);
    renderer.render(scenes[i],camera);
  }
  poseDirty = false;
  animationFrame = requestAnimationFrame(frame);
}
animationFrame = requestAnimationFrame(frame);
window.addEventListener('pagehide',event=>{if(event.persisted)return;cancelAnimationFrame(animationFrame);for(const slot of slots)slot.dispose();renderer.dispose();shadowTex.dispose();});
