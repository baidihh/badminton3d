import { CHARACTERS, getCharacter, isCharacterId } from './characters.js';
import { GameFlow } from './game-flow.js';
import { mountCharacterShowcase } from './character-showcase.js';

const $=id=>document.getElementById(id);
export function mountGameExperience({load, requestCharacter, onEnter, onLobby, isConnected, assetReady, onHelp}) {
  const params=new URLSearchParams(location.search);
  const query=params.get('character');
  let directBackhand=params.get('court')==='backhand';
  const flow=new GameFlow(directBackhand?'young-man':isCharacterId(query)?query:localStorage.getItem('bm3_character'));
  if(directBackhand)flow.page='setup';
  else if(isCharacterId(query))flow.page='characters';
  let snapshot=null,active=true,selectionTimer;
  const preview=mountCharacterShowcase($('characterShowcase'),{load,onStatus:status=>{
    $('showcaseStatus').dataset.ready=String(status.state==='ready');
    $('showcaseStatus').textContent=status.state==='loading'?'正在准备搭档…':status.state==='ready'?'': '角色加载失败，请选择其他搭档';
  }});
  const roleButtons=new Map();
  for(const c of CHARACTERS){
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-label','选择'+c.name);button.dataset.character=c.id;
    const image=document.createElement('img');image.src=c.thumbnail||`/images/characters/${c.id}.png`;image.alt='';
    const label=document.createElement('span');label.textContent=c.name;
    image.onerror=()=>{image.remove();const placeholder=document.createElement('div');placeholder.className='portraitFallback';placeholder.textContent=c.appearance==='athlete'?'01':'棉';button.prepend(placeholder);};
    button.append(image,label);button.onclick=()=>select(c.id);$('gameRoster').append(button);roleButtons.set(c.id,button);
  }
  function select(id,request=true){
    if(request ? !flow.requestSelection(id,performance.now()) : !flow.select(id))return;
    localStorage.setItem('bm3_character',id);
    const c=getCharacter(id);$('showcaseName').textContent=c.name;$('showcaseRole').textContent=c.label;$('showcaseNumber').textContent='NO. '+String(CHARACTERS.indexOf(c)+1).padStart(2,'0');
    for(const [key,button] of roleButtons){button.classList.toggle('selected',key===id);button.setAttribute('aria-pressed',String(key===id));}
    preview.select(id);
    clearTimeout(selectionTimer);
    if(request && isConnected())selectionTimer=setTimeout(()=>requestCharacter('left',id),150);
    refreshEntry();
  }
  function paintPage(){
    setMode(flow.mode);setControl(flow.control);
    active=!['match','result'].includes(flow.page);
    document.body.classList.toggle('inLobby',active);$('start').classList.toggle('off',!active);$('start').dataset.page=flow.page;
    for(const page of document.querySelectorAll('[data-flow-page]'))page.hidden=page.dataset.flowPage!==flow.page;
    for(const button of document.querySelectorAll('[data-jump]')){const current=button.dataset.jump===flow.page;button.classList.toggle('active',current);if(current)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');}
    $('matchResult').hidden=flow.page!=='result';preview.setActive(active);
    if(active){$('qrPanel').classList.remove('on');$('characterPanel').hidden=true;}
    refreshEntry();$('start').scrollTop=0;
  }
  function refreshEntry(){
    const left=snapshot?.left,right=snapshot?.right;
    const ready=flow.canEnter({connected:isConnected(),characterId:left?.characterId,assetReady:assetReady(flow.characterId),leftConnected:left?.connected,rightConnected:right?.connected});
    $('go').disabled=!ready;
    let text=ready?'搭档已就位，随时开球。':!isConnected()?'正在连接球场…':left?.characterId!==flow.characterId?'正在同步所选搭档…':!assetReady(flow.characterId)?'正在准备角色；加载失败时可换一位搭档。':flow.mode==='duo'&&!right?.connected?'等待两位玩家的手机连接。':'等待玩家 1 的手机完成入场。';
    $('entryStatus').textContent=text;
    if(left&&flow.control==='phone')$('connectionHelp').textContent=flow.mode==='duo'?`玩家 1：${left.connected?'已连接':'等待连接'} · 玩家 2：${right?.connected?'已连接':'等待连接'}`:'开启体感 → 握拍校准 → 三次试挥 → 上场';
  }
  function setControl(value){flow.control=value;for(const b of document.querySelectorAll('[data-control]')){b.classList.toggle('selected',b.dataset.control===value);b.setAttribute('aria-pressed',String(b.dataset.control===value));}$('setupQr').hidden=value!=='phone';$('setupKeyboard').hidden=value==='phone';refreshEntry();}
  function setMode(value){flow.mode=value;for(const b of document.querySelectorAll('[data-mode]')){b.classList.toggle('selected',b.dataset.mode===value);b.setAttribute('aria-pressed',String(b.dataset.mode===value));}$('setupDifficulty').hidden=value==='duo';$('duoKeys').hidden=value!=='duo';refreshEntry();}
  function enter(backhand=false){
    refreshEntry();
    if($('go').disabled)return;
    directBackhand=false;flow.enter();onEnter({mode:flow.mode,control:flow.control,backhand});paintPage();
    document.activeElement?.blur();
  }
  $('welcomeNext').onclick=()=>{flow.next();paintPage();};$('characterNext').onclick=()=>{flow.next();paintPage();};$('go').onclick=()=>enter(directBackhand);
  for(const b of document.querySelectorAll('[data-back]'))b.onclick=()=>{flow.back();paintPage();};
  for(const b of document.querySelectorAll('[data-jump]'))b.onclick=()=>{flow.page=b.dataset.jump;paintPage();};
  for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>setMode(b.dataset.mode);
  for(const b of document.querySelectorAll('[data-control]'))b.onclick=()=>setControl(b.dataset.control);
  $('useKeyboard').onclick=()=>setControl('keyboard');$('previewSwing').onclick=()=>preview.swing();
  function lobby(){flow.lobby();onLobby();paintPage();}
  $('backLobby').onclick=lobby;$('resultLobby').onclick=lobby;
  $('rematch').onclick=()=>{refreshEntry();if($('go').disabled){flow.page='setup';paintPage();return;}enter();};
  $('lobbyHelp').onclick=()=>onHelp();
  select(flow.characterId);setMode('solo');setControl('keyboard');paintPage();
  return {
    get inMatch(){return flow.page==='match';},get page(){return flow.page;},get control(){return flow.control;},
    connect(){clearTimeout(selectionTimer);flow.requestSelection(flow.characterId,performance.now());requestCharacter('left',flow.characterId);refreshEntry();},
    disconnect(){refreshEntry();},
    refresh:refreshEntry,
    update(s){
      snapshot=s;
      // Keep optimistic choices briefly, then reconcile if a command was rejected or overwritten.
      if(flow.reconcileSelection(s.left.characterId,performance.now()))select(s.left.characterId,false);
      refreshEntry();
      if(directBackhand && flow.page==='setup' && !$('go').disabled && !s.training) { enter(true); return; }
      if(flow.observe(s)){
        const left=getCharacter(s.left.characterId),right=getCharacter(s.right.characterId);
        const won=s.left.score>s.right.score;
        $('resultTitle').textContent=flow.mode==='duo'?`${won?left.name:right.name}，好球！`:won?'今天，主场属于你。':'再一拍，就会更好。';
        $('resultSubtitle').textContent=flow.mode==='duo'?'谢谢彼此，带来这一场好球。':won?'每一次挥拍，都值得这一刻。':'好搭档不怕重来，下一局继续。';
        $('resultLeftName').textContent=left.name;$('resultRightName').textContent=(s.right.ai?'电脑 · ':'')+right.name;
        $('resultLeftScore').textContent=s.left.score;$('resultRightScore').textContent=s.right.score;paintPage();
      } else if(flow.page==='result'&&s.phase!=='over') { flow.page='match';paintPage(); }
    },
    training(){if(active){flow.enter();paintPage();}},
    dispose(){clearTimeout(selectionTimer);preview.dispose();},
  };
}
