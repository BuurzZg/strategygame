// Tiny WebAudio synth. Every sound is generated: no asset files.
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.last = new Map();
    this.enabled = true;
    this.volume = 0.5;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp); comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  tone(type, f0, f1, dur, gain, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  burst(dur, gain, freq, q = 1, type = 'lowpass') {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.5 + Math.random() * 0.5;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.25), t + dur); f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  play(name, vol = 1) {
    if (!this.ctx || !this.enabled || vol < 0.03) return;
    const now = performance.now();
    const gap = { shard: 60, beam: 70, blast: 120, impact: 90, explode: 80, collapse: 300, deposit: 250, alert: 4000 }[name] || 40;
    if (now - (this.last.get(name) || 0) < gap) return;
    this.last.set(name, now);
    const v = vol;
    switch (name) {
      case 'select': this.tone('sine', 880, 1320, 0.07, 0.12 * v); break;
      case 'order': this.tone('triangle', 660, 520, 0.08, 0.14 * v); this.tone('triangle', 990, 780, 0.08, 0.1 * v, 0.06); break;
      case 'error': this.tone('square', 200, 150, 0.18, 0.08 * v); break;
      case 'place': this.tone('sine', 440, 880, 0.2, 0.15 * v); this.burst(0.2, 0.08 * v, 3000, 2, 'bandpass'); break;
      case 'complete': [523, 659, 784].forEach((f, i) => this.tone('sine', f, f, 0.22, 0.12 * v, i * 0.09)); break;
      case 'ready': this.tone('sine', 740, 990, 0.12, 0.1 * v); break;
      case 'deposit': this.tone('sine', 1200, 1800, 0.05, 0.04 * v); break;
      case 'alert': this.tone('sawtooth', 330, 330, 0.18, 0.08 * v); this.tone('sawtooth', 247, 247, 0.25, 0.08 * v, 0.2); break;
      case 'shard': this.burst(0.06, 0.12 * v, 6000, 3, 'bandpass'); break;
      case 'beam': this.tone('sawtooth', 1400, 300, 0.14, 0.06 * v); break;
      case 'blast': this.burst(0.25, 0.25 * v, 900); this.tone('sine', 120, 50, 0.25, 0.2 * v); break;
      case 'impact': this.burst(0.4, 0.3 * v, 1400); break;
      case 'explode': this.burst(0.5, 0.35 * v, 1800); this.tone('sine', 90, 40, 0.4, 0.25 * v); break;
      case 'collapse': this.burst(1.2, 0.5 * v, 1200); this.tone('sine', 70, 30, 1.0, 0.35 * v); break;
    }
  }
}
