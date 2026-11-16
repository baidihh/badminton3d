import test from 'node:test';
import assert from 'node:assert/strict';
import { GameFlow } from '../public/js/game-flow.js';
test('flow requires character confirmation and control readiness before entering match',()=>{
 const f=new GameFlow('kitten');assert.equal(f.page,'welcome');f.next();assert.equal(f.page,'characters');f.next();assert.equal(f.page,'setup');
 assert.equal(f.canEnter({connected:false,characterId:'kitten',assetReady:true,leftConnected:false}),false);
 assert.equal(f.canEnter({connected:true,characterId:'dino',assetReady:true,leftConnected:false}),false);
 assert.equal(f.canEnter({connected:true,characterId:'kitten',assetReady:false,leftConnected:false}),false);
 assert.equal(f.canEnter({connected:true,characterId:'kitten',assetReady:true,leftConnected:false}),true);
 f.control='phone';assert.equal(f.canEnter({connected:true,characterId:'kitten',assetReady:true,leftConnected:false}),false);
});
test('result requires a match ending after entry, closes on restart and lobby navigation is reversible',()=>{
 const f=new GameFlow('dino');f.enter();assert.equal(f.observe({phase:'over'}),false);f.observe({phase:'serve'});assert.equal(f.observe({phase:'over',left:{score:7},right:{score:4}}),true);assert.equal(f.page,'result');
 f.enter();f.observe({phase:'serve',left:{score:0},right:{score:0}});assert.equal(f.page,'match');f.lobby();assert.equal(f.page,'characters');f.back();assert.equal(f.page,'welcome');
 assert.equal(f.observe({phase:'over'}),false);
});
test('returning to lobby retains selected character and safe invalid selection fallback',()=>{
 const f=new GameFlow('invalid');assert.equal(f.characterId,'kitten');f.select('junior-girl');f.enter();f.lobby();assert.equal(f.characterId,'junior-girl');
 assert.equal(f.select('not-a-model'),false);assert.equal(f.characterId,'junior-girl');
});
test('result and rematch retain actual mode after a second player joins during play',()=>{
 const f=new GameFlow('kitten');f.enter();f.observe({phase:'rally',right:{ai:false}});assert.equal(f.mode,'duo');
 f.observe({phase:'over',right:{ai:false}});assert.equal(f.mode,'duo');f.enter();assert.equal(f.mode,'duo');
});
test('a dropped or overwritten character request reconciles to the server after a bounded wait',()=>{
 const f=new GameFlow('kitten');f.requestSelection('dino',100);
 assert.equal(f.reconcileSelection('kitten',500),false);assert.equal(f.characterId,'dino');
 assert.equal(f.reconcileSelection('kitten',1400),true);assert.equal(f.characterId,'kitten');
 f.requestSelection('junior-girl',1500);assert.equal(f.reconcileSelection('junior-girl',1510),false);assert.equal(f.pendingSelection,null);
});
test('phone duo rematch requires both phones and keeps played mode when result loses a phone',()=>{
 const f=new GameFlow('kitten');f.control='phone';f.enter();f.observe({phase:'rally',right:{ai:false}});f.observe({phase:'over',right:{ai:false}});
 f.observe({phase:'over',right:{ai:true}});assert.equal(f.mode,'duo');
 assert.equal(f.canEnter({connected:true,characterId:'kitten',assetReady:true,leftConnected:true,rightConnected:false}),false);
 assert.equal(f.canEnter({connected:false,characterId:'kitten',assetReady:true,leftConnected:true,rightConnected:true}),false);
});
