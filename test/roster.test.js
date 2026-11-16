import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHARACTERS,getCharacter } from '../public/js/characters.js';
import { PlayerView } from '../public/js/player.js';
import { Game } from '../game/game.js';
import { startBackhandFeed } from '../game/shot-lab.js';
const ids=['dino','kitten','junior-boy','junior-girl','young-man','young-woman'];
test('roster covers three audience groups with two distinct avatars in each',()=>{
  const actual=CHARACTERS.filter(c=>ids.includes(c.id));assert.equal(actual.length,6);
  for(const group of ['kids','teens','young-adults'])assert.equal(actual.filter(c=>c.group===group).length,2);
  assert.equal(new Set(actual.map(c=>c.avatar)).size,6);
});
globalThis.document={createElement:()=>({getContext:()=>new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)})})};
async function loadCharacterAsset(character) {
  const bytes = fs.readFileSync(new URL('..' + character.modelUrl, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
const assets = new Map(await Promise.all(CHARACTERS.map(async character => [character.id, await loadCharacterAsset(character)])));
const lingchuan = getCharacter('young-man');
const lingchuanAsset = assets.get(lingchuan.id);

test('the entire published roster uses distinct Blender skins on both racket hands', async () => {
  assert.equal(CHARACTERS.length, 9);
  assert.equal(new Set(CHARACTERS.map(character => character.modelUrl)).size, 9);
  for (const character of CHARACTERS) {
    assert.equal(character.appearance, 'imported', character.id);
    const asset = assets.get(character.id);
    const view = new PlayerView(asset, { character, shadowTex: new THREE.Texture() });
    const shirt = view.model.getObjectByName('roster-' + character.id);
    assert.ok(shirt, character.id + ' has its own authored body');
    const contact = { x: .2, y: 2, z: -4.05 };
    for (const hand of ['left', 'right']) {
      view.update(1 / 60, { x: 0, y: 2, z: -4.6, hand, stroke: { id: hand, age: .14, hit: true, shot: 'clear', contact } }, contact);
      assert.ok(view.racket.localToWorld(new THREE.Vector3(0, .535, 0)).distanceTo(new THREE.Vector3(contact.x, contact.y, contact.z)) < .06, character.id + ' ' + hand);
    }
    view.dispose();
  }
});

test('waiting for the next ball keeps the player facing the net in a compact ready pose', () => {
  for (const [side, asset, character] of [['left', lingchuanAsset, lingchuan], ['right', assets.get('dino'), getCharacter('dino')]]) {
    const view = new PlayerView(asset, { character, shadowTex: new THREE.Texture() });
    const forward = side === 'left' ? 1 : -1;
    const player = { x: 0, y: 1.8, z: -4 * forward, vx: 0, vz: 0, hand: 'right' };
    const deadBall = { x: 1.9, y: .04, z: player.z - forward };
    for (let i = 0; i < 90; i++) view.update(1 / 60, player, deadBall, { phase: 'point' });
    const local = bone => view.root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    const wrist = local(view.bone.lHand);
    const elbow = local(view.bone.lForeArm);
    const jaw = new THREE.Vector3(0, 0, 1).applyQuaternion(view.bone.head.getWorldQuaternion(new THREE.Quaternion()));
    assert.ok(wrist.z > elbow.z + .14, side + ' free hand should face forward from the elbow');
    assert.ok(wrist.x < .28, side + ' free hand should stay inside the stance');
    assert.ok(jaw.z * forward > .85, side + ' head should face the net');
    assert.ok(view.crouch >= .12, side + ' hips should lower into flexed knees');
    view.dispose();
  }
});

test('凌川 has blended skin at both elbows and knees', () => {
  const view = new PlayerView(lingchuanAsset, { character: lingchuan, shadowTex: new THREE.Texture() });
  for (const side of ['l', 'r']) {
    for (const [meshName, proximal, distal] of [
      ['Arms', view.bone[side + 'Arm'], view.bone[side + 'ForeArm']],
      ['Legs', view.bone[side + 'UpLeg'], view.bone[side + 'Leg']],
    ]) {
      const group = view.model.getObjectByName(meshName);
      const mesh = group?.isSkinnedMesh ? group : group?.children.find(child => child.material?.name === 'Skin');
      assert.ok(mesh?.isSkinnedMesh, meshName + ' must deform with the skeleton');
      const indices = mesh.geometry.attributes.skinIndex;
      const weights = mesh.geometry.attributes.skinWeight;
      const a = mesh.skeleton.bones.indexOf(proximal);
      const b = mesh.skeleton.bones.indexOf(distal);
      let blended = 0;
      for (let i = 0; i < weights.count; i++) {
        const jointWeights = new Map();
        for (let k = 0; k < 4; k++) {
          const weight = weights.getComponent(i, k);
          if (weight > 0) jointWeights.set(indices.getComponent(i, k), weight);
        }
        if (jointWeights.get(a) > .15 && jointWeights.get(b) > .15) blended++;
      }
      assert.ok(blended >= 24, meshName + ' requires several blended rings at the joint');
    }
  }
  view.dispose();
});

for (const hand of ['right', 'left']) test(`凌川 returns both arms to their own side after a ${hand}-handed slice`, () => {
  const game = new Game();
  game.left.hand = hand;
  startBackhandFeed(game, true);
  const view = new PlayerView(lingchuanAsset, { character: lingchuan, shadowTex: new THREE.Texture() });
  for (let i = 0; i < 270; i++) {
    game.step(1 / 60);
    const { left, ball } = game.snapshot();
    view.update(1 / 60, left, ball, { phase: game.phase });
  }
  assert.equal(game.impact.shot, 'slice');
  assert.equal(game.left.rearPlan, null);
  for (const [side, arm] of Object.entries(view.arms)) {
    const wrist = arm.hand.getWorldPosition(new THREE.Vector3());
    const shoulder = arm.arm.getWorldPosition(new THREE.Vector3());
    const hip = view.bone.hips.getWorldPosition(new THREE.Vector3());
    assert.ok((wrist.x - hip.x) * (side === 'left' ? 1 : -1) > .08, `${side} wrist crossed the torso`);
    assert.ok(wrist.y < shoulder.y - .09, `${side} wrist stopped at shoulder height`);
  }
  view.dispose();
});

for (const hand of ['right', 'left']) test(`回中换步时 ${hand} 持拍侧已回到准备位，最后一步球拍不会突然翻转`, () => {
  const game = new Game();
  game.left.hand = hand;
  startBackhandFeed(game, true);
  const view = new PlayerView(lingchuanAsset, { character: lingchuan, shadowTex: new THREE.Texture() });
  const other = hand === 'right' ? 'left' : 'right';
  let checked = 0, lastRacket;
  for (let i = 0; i < 240; i++) {
    game.step(1 / 60);
    const { phase, left, ball } = game.snapshot();
    view.update(1 / 60, left, ball, { phase });
    if ((left.rearMove?.progress ?? 1) < .79 || i < 75) continue;
    const local = bone => view.root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    const wrist = local(view.arms[other].hand);
    const elbow = local(view.arms[other].fore);
    assert.ok(Math.abs(wrist.x) < .28 && wrist.z - elbow.z > .13,
      `free hand outside ready pose at ${left.rearMove?.progress.toFixed(3)}: ${wrist.toArray()}`);
    const racket = view.racket.getWorldQuaternion(new THREE.Quaternion());
    if (lastRacket) assert.ok(lastRacket.angleTo(racket) < .32, 'racket flipped as recovery ended');
    lastRacket = racket;
    if (left.rearMove && !left.rearMove.done) checked++;
  }
  assert.ok(checked > 20);
  view.dispose();
});

test('the racket follows through after contact without snapping between the two motions', () => {
  const game = new Game();
  startBackhandFeed(game, true);
  const view = new PlayerView(lingchuanAsset, { character: lingchuan, shadowTex: new THREE.Texture() });
  let previous, worstAngle = 0, worstWristStep = 0;
  for (let i = 0; i < 115; i++) {
    game.step(1 / 60);
    const { phase, left, ball } = game.snapshot();
    view.update(1 / 60, left, ball, { phase });
    if (!left.stroke?.hit || left.stroke.age < .19) continue;
    const angle = view.racket.getWorldQuaternion(new THREE.Quaternion());
    const wrist = view.arms.right.hand.getWorldPosition(new THREE.Vector3());
    if (previous) {
      worstAngle = Math.max(worstAngle, angle.angleTo(previous.angle));
      worstWristStep = Math.max(worstWristStep, wrist.distanceTo(previous.wrist));
    }
    previous = { angle, wrist };
  }
  assert.ok(previous && worstAngle < .7 && worstWristStep < .18,
    `follow-through jumped ${(worstAngle*180/Math.PI).toFixed(1)}° and ${worstWristStep.toFixed(3)}m in one frame`);
  view.dispose();
});

test('凌川 bends each supporting knee in the direction of the planted shoe during the backhand turn', () => {
  const game = new Game();
  startBackhandFeed(game, true);
  const view = new PlayerView(lingchuanAsset, { character: lingchuan, shadowTex: new THREE.Texture() });
  let checked = 0;
  for (let i = 0; i < 85; i++) {
    game.step(1 / 60);
    const { left, ball } = game.snapshot();
    view.update(1 / 60, left, ball);
    if (left.rearMove?.phase !== 'plant') continue;
    for (const [side, leg] of Object.entries(view.legs)) {
      const foot = view.motionState.feet[side];
      if (!foot.stance) continue;
      const hip = leg.up.getWorldPosition(new THREE.Vector3());
      const axis = leg.foot.getWorldPosition(new THREE.Vector3()).sub(hip).normalize();
      const toe = new THREE.Vector3(Math.sin(foot.yaw), 0, Math.cos(foot.yaw));
      const bend = leg.knee.getWorldPosition(new THREE.Vector3()).sub(hip);
      bend.addScaledVector(axis, -bend.dot(axis));
      assert.ok(bend.dot(toe) > 0, `${side} knee bent away from its shoe`);
      checked++;
    }
  }
  assert.ok(checked >= 4);
  view.dispose();
});

test('凌川 keeps the arms low during the initial split step before turning for the slice', () => {
  const game = new Game();
  startBackhandFeed(game, true);
  const view = new PlayerView(lingchuanAsset, { character: lingchuan, shadowTex: new THREE.Texture() });
  let checked = 0;
  for (let i = 0; i < 30; i++) {
    game.step(1 / 60);
    const { left, ball } = game.snapshot();
    view.update(1 / 60, left, ball);
    if (left.rearMove?.phase !== 'split' || left.rearMove.progress < .06) continue;
    for (const arm of Object.values(view.arms)) {
      const shoulderY = arm.arm.getWorldPosition(new THREE.Vector3()).y;
      const wristY = arm.hand.getWorldPosition(new THREE.Vector3()).y;
      assert.ok(wristY <= shoulderY - .07, 'split step lifted a wrist to shoulder height');
    }
    checked++;
  }
  assert.ok(checked >= 4);
  view.dispose();
});
