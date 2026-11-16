import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../game/game.js';
import { attachSocket } from '../net/socket.js';
import { recorder } from '../recorder.js';
recorder.toggle(false);
function setup() {
  let connect;
  const io={sockets:{sockets:new Map()},on:(name,fn)=>{connect=fn;},emit:()=>{}};
  const game=new Game(); attachSocket(io,game);
  const client=(id,ip=id)=>{
    const handlers=new Map(); const rooms=new Set();
    const socket={id,data:{},handshake:{headers:{},address:ip},join:r=>rooms.add(r),leave:r=>rooms.delete(r),emit:()=>{},on:(e,f)=>handlers.set(e,f)};
    io.sockets.sockets.set(id,socket); connect(socket);
    return {socket,rooms,send:(e,p)=>handlers.get(e)(p)};
  };
  return {game,client};
}
test('slot switch releases old ownership and feedback room',()=>{
  const {game,client}=setup(); const a=client('a');
  a.send('ctrl:join',{slot:'left'}); a.send('ctrl:join',{slot:'right'});
  assert.equal(game.left.connected,false); assert.equal(a.rooms.has('slot:left'),false);
  a.send('disconnect'); assert.equal(game.right.connected,false);
  const b=client('b'); b.send('ctrl:join',{}); assert.equal(b.socket.data.slot,'left');
});
test('malformed swing is ignored without throwing',()=>{
  const {game,client}=setup(); const a=client('a'); a.send('ctrl:join',{});
  assert.doesNotThrow(()=>a.send('ctrl:swing',{peak:'bad',power:'bad'}));
  assert.equal(game.left.pending,null);
});
test('unassigned connection cannot restart or swing either player',()=>{
  const {game,client}=setup(); const a=client('a'); game.left.score=3;
  a.send('game:restart'); assert.equal(game.left.score,3);
  a.send('game:swing',{side:'left'}); assert.equal(game.left.pending,null);
});
test('disconnect with a real Socket.IO reason releases the slot',()=>{
  const {game,client}=setup(); const a=client('a'); a.send('ctrl:join',{slot:'left'});
  a.send('disconnect','transport close'); assert.equal(game.left.connected,false);
});
test('repeated automatic join keeps the current player slot',()=>{
  const {game,client}=setup(); const a=client('a');
  a.send('ctrl:join',{}); a.send('ctrl:join',{});
  assert.equal(a.socket.data.slot,'left'); assert.equal(game.right.ai,true);
});
test('a refreshed phone reclaims blue side before the empty red side',()=>{
  const {game,client}=setup();const old=client('old','phone');old.send('ctrl:join',{});
  const fresh=client('fresh','phone');fresh.send('ctrl:join',{});
  assert.equal(fresh.socket.data.slot,'left');
  assert.equal(old.socket.data.slot,null);
  assert.equal(game.right.ai,true);
});
test('training is controlled by player 1, requires raw capture, and stops on disconnect',()=>{
  const originalWrite=recorder.training,originalCheck=recorder.isRecording;const recorded=[];
  recorder.training=(id,event)=>{recorded.push(event);return true;};recorder.isRecording=()=>true;
  try {
    const {game,client}=setup();const a=client('a'),b=client('b');
    b.send('training:start');assert.equal(game.training.active,false);
    a.send('ctrl:join',{slot:'left'});b.send('ctrl:join',{slot:'right'});
    b.send('training:start');assert.equal(game.training.active,false);
    a.send('training:start');assert.equal(game.training.active,true);
    const id=game.training.attemptId;
    a.send('ctrl:swing',{attemptId:id,power:0.8,dir:0.8,lift:0.8,shot:'clear'});
    assert.equal(game.left.pending,null,'missing capture cannot masquerade as a training sample');
    const capture={v:1,timebase:'performance.now',capturedAt:100,referenceQuaternion:[0,0,0,1],samples:[{kind:'motion',t:99,rotationRate:{alpha:1,beta:2,gamma:3}}]};
    a.send('ctrl:swing',{attemptId:id,sensorCapture:capture,power:0.8,dir:0.8,lift:0.8,shot:'clear'});
    assert.ok(game.left.pending);assert.ok(recorded.some(e=>e.stage==='input'&&e.sensorCapture));
    b.send('training:stop');assert.equal(game.training.active,true);
    a.send('disconnect','transport close');assert.equal(game.training.active,false);
    assert.ok(recorded.some(e=>e.event==='stop'&&e.reason==='controller_disconnected'));
  } finally {recorder.training=originalWrite;recorder.isRecording=originalCheck;}
});

test('character selection is authoritative and survives refresh and restart',()=>{
  const {game,client}=setup(); const a=client('character-a','phone-char');
  a.send('ctrl:join',{characterId:'rabbit-geo'});
  assert.equal(game.snapshot().left.characterId,'rabbit-geo');
  a.send('ctrl:character',{characterId:'rabbit-glb'});
  assert.equal(game.pack(game.left).characterId,'rabbit-glb');
  game.restart(); assert.equal(game.left.characterId,'rabbit-glb');
  const fresh=client('character-fresh','phone-char'); fresh.send('ctrl:join',{});
  assert.equal(game.left.characterId,'rabbit-glb');
});
test('character changes reject unknown ids and require slot ownership',()=>{
  const {game,client}=setup();const a=client('char-owner'),b=client('char-outsider');
  a.send('ctrl:join',{slot:'left'});
  b.send('ctrl:character',{characterId:'rabbit-glb',side:'left'});
  assert.equal(game.left.characterId,'athlete');
  a.send('ctrl:character',{characterId:'https://evil.invalid/model.glb'});
  assert.equal(game.left.characterId,'athlete');
  b.send('ctrl:join',{slot:'left'});
  a.send('ctrl:character',{characterId:'rabbit-glb'});
  assert.equal(game.left.characterId,'athlete');
  b.send('ctrl:character',{characterId:'rabbit-geo',side:'right'});
  assert.equal(game.left.characterId,'rabbit-geo');
  assert.equal(game.right.characterId,'athlete');
});
test('only a registered screen can select either displayed character',()=>{
  const {game,client}=setup(); const a=client('char-screen');
  a.send('game:character',{side:'right',characterId:'rabbit-glb'});
  assert.equal(game.right.characterId,'athlete');
  a.send('screen:join');
  a.send('game:character',{side:'right',characterId:'rabbit-glb'});
  assert.equal(game.right.characterId,'rabbit-glb');
  a.send('game:character',{side:'invalid',characterId:'rabbit-geo'});
  assert.equal(game.left.characterId,'athlete');
});

test('a screen can start a backhand feed on the match court and it completes recovery', () => {
  const { game, client } = setup();
  const screen = client('screen');
  screen.send('game:backhand-feed', { auto: true });
  assert.equal(game.phase, 'serve');
  screen.send('screen:join');
  screen.send('game:backhand-feed', { auto: true });
  assert.equal(game.phase, 'rally');
  let recovered = false;
  for (let i = 0; i < 260; i++) {
    game.step(1 / 60);
    recovered ||= game.left.rearMove?.done === true;
  }
  assert.equal(game.impact.shot, 'slice');
  assert.ok(recovered);
  assert.equal(game.left.score, 0);
  assert.equal(game.phase, 'point');
  screen.send('game:restart');
  assert.equal(game.backhandFeed, null);
});
