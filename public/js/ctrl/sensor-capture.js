// Device event values are retained before pose conversion, filtering or bias removal.
// Times are receipt times from performance.now(), independent of event.timeStamp.
const WINDOW_MS = 1000;
const MAX_SAMPLES = 256;
const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const xyz = (value) => ({ x: finite(value?.x), y: finite(value?.y), z: finite(value?.z) });
const angles = (value) => ({ alpha: finite(value?.alpha), beta: finite(value?.beta), gamma: finite(value?.gamma) });

export class SensorCapture {
  constructor() { this.samples = []; }

  prune(now) {
    while (this.samples.length && this.samples[0].t < now - WINDOW_MS) this.samples.shift();
    if (this.samples.length > MAX_SAMPLES) this.samples.splice(0, this.samples.length - MAX_SAMPLES);
  }

  orientation(event, now, screenAngle) {
    this.samples.push({ t: now, kind: 'orientation', ...angles(event), screenAngle: finite(screenAngle) });
    this.prune(now);
  }

  motion(event, now) {
    this.samples.push({
      t: now, kind: 'motion', rotationRate: angles(event.rotationRate),
      acceleration: xyz(event.acceleration), accelerationIncludingGravity: xyz(event.accelerationIncludingGravity),
    });
    this.prune(now);
  }

  snapshot(now, { referenceQuaternion, gyroBias, thresholdOmega, invert }) {
    this.prune(now);
    return {
      v: 1, timebase: 'performance.now', capturedAt: now,
      referenceQuaternion: referenceQuaternion.map(finite),
      gyroBias: xyz(gyroBias), thresholdOmega: finite(thresholdOmega), invert: finite(invert),
      samples: this.samples.map((sample) => sample.kind === 'motion'
        ? { ...sample, rotationRate: { ...sample.rotationRate }, acceleration: { ...sample.acceleration },
          accelerationIncludingGravity: { ...sample.accelerationIncludingGravity } }
        : { ...sample }),
    };
  }
}
