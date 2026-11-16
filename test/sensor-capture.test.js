import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null };
globalThis.screen = { orientation: { angle: 90 } };
const sensor = await import('../public/js/ctrl/sens.js');

test('training capture keeps raw device values, nulls and calibration separate from derived pose', (t) => {
  assert.equal(typeof sensor.getTrainingCapture, 'function');
  let now = 10000;
  t.mock.method(performance, 'now', () => now);
  sensor.SENS.calibrated = false;
  sensor.onOrientation({ alpha: 35, beta: -20, gamma: 6, timeStamp: 100 });
  now += 10;
  sensor.onMotion({
    rotationRate: { alpha: 1, beta: null, gamma: Infinity },
    acceleration: { x: 2, y: undefined, z: NaN },
    accelerationIncludingGravity: null,
  });
  sensor.SENS.qRef.set(0, 0.5, 0, Math.sqrt(0.75));
  sensor.SENS.gyroBias = { x: 1, y: 2, z: 3 };
  sensor.SENS.thresholdOmega = 225;
  sensor.setInvert(-1);
  const capture = sensor.getTrainingCapture();
  assert.equal(capture.v, 1);
  assert.equal(capture.timebase, 'performance.now');
  assert.equal(capture.capturedAt, now);
  assert.deepEqual(capture.referenceQuaternion, [0, 0.5, 0, Math.sqrt(0.75)]);
  assert.deepEqual(capture.gyroBias, { x: 1, y: 2, z: 3 });
  assert.equal(capture.thresholdOmega, 225);
  assert.equal(capture.invert, -1);
  assert.deepEqual(capture.samples, [
    { t: 10000, kind: 'orientation', alpha: 35, beta: -20, gamma: 6, screenAngle: 90 },
    { t: 10010, kind: 'motion', rotationRate: { alpha: 1, beta: null, gamma: null },
      acceleration: { x: 2, y: null, z: null }, accelerationIncludingGravity: { x: null, y: null, z: null } },
  ]);
  capture.samples[1].rotationRate.alpha = 999;
  capture.referenceQuaternion[1] = 999;
  capture.gyroBias.x = 999;
  assert.equal(sensor.getTrainingCapture().samples[1].rotationRate.alpha, 1);
  assert.equal(sensor.SENS.qRef.y, 0.5);
  assert.equal(sensor.SENS.gyroBias.x, 1);
  now += 1001;
  assert.deepEqual(sensor.getTrainingCapture().samples, []);
});

test('capture retains at most 256 events and only the last second', (t) => {
  assert.equal(typeof sensor.getTrainingCapture, 'function');
  let now = 20000;
  t.mock.method(performance, 'now', () => now);
  sensor.SENS.calibrated = false;
  for (let i = 0; i < 300; i++) {
    sensor.onMotion({ rotationRate: null });
    now += 1;
  }
  const capture = sensor.getTrainingCapture();
  assert.equal(capture.samples.length, 256);
  assert.equal(capture.samples[0].t, 20044);
  now = 21298;
  assert.deepEqual(sensor.getTrainingCapture().samples.map((sample) => sample.t), [20298, 20299]);
});

test('event that completes a swing is captured before the swing callback', (t) => {
  assert.equal(typeof sensor.getTrainingCapture, 'function');
  let now = 30000;
  t.mock.method(performance, 'now', () => now);
  Object.assign(sensor.SENS, {
    calibrated: true, hasOrient: true, lastOrientT: now, gyroAvailable: true,
    stillDone: true, thresholdOmega: 220, swing: null, waitRelease: false,
    omegaBuf: [], motionEventT: 0, gyroBias: { x: 0, y: 0, z: 0 },
  });
  sensor.SENS.qRaw.set(0, 0, 0, 1);
  let captured;
  sensor.setSwingHandler(() => { captured = sensor.getTrainingCapture(); });
  for (let i = 0; i < 9; i++) {
    now += 16;
    sensor.onMotion({ timeStamp: now, rotationRate: { alpha: 0, beta: 0, gamma: i < 6 ? 500 : 0 } });
  }
  assert.ok(captured);
  assert.equal(captured.samples.at(-1).t, captured.capturedAt);
  assert.equal(captured.samples.at(-1).rotationRate.gamma, 0);
  sensor.setSwingHandler(null);
});
