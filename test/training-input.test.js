import test from 'node:test';import assert from 'node:assert/strict';
import {sanitizeTrainingCapture} from '../net/training-input.js';
test('raw capture preserves unavailable values and drops unknown fields',()=>{
 const v={v:1,timebase:'performance.now',capturedAt:1000,referenceQuaternion:[0,0,0,1],samples:[{t:999,kind:'motion',rotationRate:{alpha:2,beta:null,gamma:Infinity},arbitrary:'bad'}]};
 const r=sanitizeTrainingCapture(v);assert.deepEqual(r.samples[0].rotationRate,{alpha:2,beta:null,gamma:null});assert.equal(r.samples[0].arbitrary,undefined);
});
test('raw capture is bounded and rejects an empty or invalid time window',()=>{
 const v={v:1,timebase:'performance.now',capturedAt:1000,referenceQuaternion:[0,0,0,1],samples:Array.from({length:400},(_,i)=>({t:600+i,kind:'orientation',alpha:i}))};
 assert.equal(sanitizeTrainingCapture(v).samples.length,256);assert.equal(sanitizeTrainingCapture({...v,samples:[]}),null);
 assert.equal(sanitizeTrainingCapture({...v,capturedAt:9000}),null);
});
