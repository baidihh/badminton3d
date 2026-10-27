// 音效：挥拍风声（WebAudio 合成，无外部资源）
// ============================================================
// 音效
// ============================================================
let ac = null;
function ensureAudio() {
  if (!ac) {
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { }
  }
  if (ac && ac.state === 'suspended') ac.resume();
}
function whoosh(power, shot = 'clear') {
  if (!ac) return;
  const dur = shot === 'smash' ? 0.10 : shot === 'drop' ? 0.18 : 0.16;
  const n = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  const amp = shot === 'drop' ? 0.12 + power * 0.18 : shot === 'smash' ? 0.34 + power * 0.42 : 0.2 + power * 0.32;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 2.6) * amp;
  }
  const src = ac.createBufferSource(); src.buffer = buf;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.value = shot === 'drop' ? 420 + power * 550 : shot === 'smash' ? 1500 + power * 1900 : 650 + power * 1500;
  bp.Q.value = shot === 'smash' ? 1.7 : shot === 'drop' ? 0.9 : 1.3;
  const g = ac.createGain(); g.gain.value = shot === 'drop' ? 0.36 : 0.5;
  src.connect(bp).connect(g).connect(ac.destination);
  src.start();
}

export { ensureAudio, whoosh };