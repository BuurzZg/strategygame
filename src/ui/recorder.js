// Records the 3D view (and game audio) to a .webm video with MediaRecorder.
// Only the WebGL canvas is captured, so HUD and debug panels never appear in the footage.
export class Recorder {
  constructor(canvas, audio) {
    this.canvas = canvas;
    this.audio = audio;
    this.rec = null;
    this.chunks = [];
    this.started = 0;
  }
  get recording() { return !!this.rec; }
  get seconds() { return this.rec ? (performance.now() - this.started) / 1000 : 0; }

  static supported() { return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream; }

  start({ fps = 60, withAudio = true, bitrate = 16_000_000 } = {}) {
    if (this.rec || !Recorder.supported()) return false;
    const stream = this.canvas.captureStream(fps);
    if (withAudio && this.audio.ctx) {
      this.dest = this.audio.ctx.createMediaStreamDestination();
      this.audio.output.connect(this.dest);
      for (const t of this.dest.stream.getAudioTracks()) stream.addTrack(t);
    }
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    this.rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
    this.started = performance.now();
    return true;
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.rec) { resolve(null); return; }
      const rec = this.rec;
      rec.onstop = () => {
        if (this.dest) { try { this.audio.output.disconnect(this.dest); } catch {} this.dest = null; }
        resolve(new Blob(this.chunks, { type: rec.mimeType || 'video/webm' }));
      };
      this.rec = null;
      rec.stop();
    });
  }

  static download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
