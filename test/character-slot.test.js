import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterSlot, cachedLoader } from '../public/js/character-slot.js';
import { getCharacter } from '../public/js/characters.js';
const rabbitAsset = getCharacter('rabbit-glb').modelUrl;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(load) {
  const attached=new Set(),disposed=[];
  const slot=new CharacterSlot({load,create:(asset,character)=>({id:character.id,asset,dispose(){disposed.push(this.id);}}),attach:v=>attached.add(v),detach:v=>attached.delete(v)});
  return {slot,attached,disposed};
}
test('late asset completion never replaces a newer selection',async()=>{
  const a=deferred(),b=deferred();const f=fixture(url=>url===rabbitAsset?a.promise:b.promise);
  const older=f.slot.select('rabbit-glb'); const newer=f.slot.select('rabbit-geo');
  b.resolve({name:'source'});await newer;a.resolve({name:'late'});await older;
  assert.equal(f.slot.view.id,'rabbit-geo');assert.equal(f.attached.size,1);
});
test('failed imported asset falls back to default and replacement releases old view',async()=>{
  const f=fixture(async url=>{if(url===rabbitAsset)throw Error('not found');return {};});
  await f.slot.select('rabbit-geo');await f.slot.select('rabbit-glb');
  assert.equal(f.slot.view.id,'athlete');assert.equal(f.attached.size,1);assert.deepEqual(f.disposed,['rabbit-geo']);
});
test('disposing a slot prevents pending loads from attaching a player',async()=>{
  const a=deferred();const f=fixture(()=>a.promise);const pending=f.slot.select('athlete');f.slot.dispose();a.resolve({});await pending;
  assert.equal(f.slot.view,null);assert.equal(f.attached.size,0);
});
test('source cache coalesces concurrent requests and allows failed assets to retry',async()=>{
  let n=0;const load=cachedLoader(async()=>{n++;if(n===1)throw Error('offline');return {};});
  await assert.rejects(load('a'));const [a,b]=await Promise.all([load('a'),load('a')]);assert.equal(n,2);assert.equal(a,b);
});
test('two total load failures preserve the existing player and finish with an error status',async()=>{
  let fail=false;const states=[];const f=fixture(async()=>{if(fail)throw Error('offline');return {};});f.slot.onStatus=s=>states.push(s);
  await f.slot.select('rabbit-geo');fail=true;await f.slot.select('rabbit-glb');
  assert.equal(f.slot.view.id,'rabbit-geo');assert.equal(f.attached.size,1);assert.equal(states.at(-1).state,'error');
});
