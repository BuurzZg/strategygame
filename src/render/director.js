import { R } from './worldrenderer.js';

// Automatic cinematic camera for trailers and spectating. Render-only: it reads the world
// and simulation events, never changes the game.
//
// It keeps a list of "hotspots" from recent events (deaths, explosions, beams, construction)
// and cuts between shot types around the busiest one: slow orbits, low flyovers, wide
// establishing shots, and close tracking shots that follow a unit.
const WEIGHT = { killed: 6, explosion: 3, beam: 1, muzzle: 0.3, complete: 4, placed: 2, heal: 0.5, siphon: 0.05 };

export class Director {
  constructor(session) {
    this.s = session;
    this.hot = [];
    this.shot = null;
    this.clock = 0;
    this.transition = 'mixed'; // 'cut' | 'glide' | 'mixed'
    this.shotLength = [6, 10];
  }

  onEvents(events) {
    for (const ev of events) {
      const w = WEIGHT[ev.t];
      if (!w) continue;
      let x = ev.x, y = ev.y;
      if (x === undefined && ev.x0 !== undefined) { x = ev.x1; y = ev.y1; }
      if (x === undefined && ev.actor !== undefined) { const a = this.s.world.actorById.get(ev.actor); if (a) { x = a.x; y = a.y; } }
      if (x === undefined) continue;
      this.hot.push({ x: x * R, z: y * R, w: ev.building ? w * 3 : w, t: this.clock });
    }
    if (this.hot.length > 600) this.hot.splice(0, this.hot.length - 600);
  }

  // Busiest area in the last few seconds (weighted, decaying), or null when it is quiet.
  hotspot() {
    const now = this.clock, recent = this.hot.filter((h) => now - h.t < 8);
    let best = null, bs = 0;
    for (const c of recent) {
      let s = 0, sx = 0, sz = 0;
      for (const h of recent) {
        const d2 = (h.x - c.x) ** 2 + (h.z - c.z) ** 2;
        if (d2 > 225) continue;
        const k = h.w * Math.pow(0.5, (now - h.t) / 3);
        s += k; sx += h.x * k; sz += h.z * k;
      }
      if (s > bs) { bs = s; best = { x: sx / s, z: sz / s, score: s }; }
    }
    return bs > 4 ? best : null;
  }

  quietSubject() {
    const w = this.s.world;
    const pool = w.actors.filter((a) => !a.dead && a.health && (a.mobile || a.type === 'core' || a.type === 'deepdrill'));
    if (!pool.length) return { x: w.map.n, z: w.map.n };
    const a = pool[Math.floor(Math.random() * pool.length)];
    return { x: a.x * R, z: a.y * R, actor: a.mobile ? a : null };
  }

  pickShot() {
    const spot = this.hotspot();
    const subject = spot || this.quietSubject();
    const r = Math.random();
    const kinds = spot ? ['orbit', 'orbit', 'flyover', 'track', 'low'] : ['wide', 'orbit', 'track', 'flyover'];
    const kind = kinds[Math.floor(r * kinds.length)];
    const len = this.shotLength[0] + Math.random() * (this.shotLength[1] - this.shotLength[0]);
    const yaw = Math.random() * Math.PI * 2;
    const shot = { kind, x: subject.x, z: subject.z, yaw, t0: this.clock, len, spin: (Math.random() < 0.5 ? -1 : 1) * (0.04 + Math.random() * 0.06) };
    if (kind === 'orbit') Object.assign(shot, { dist: 48 + Math.random() * 25, pitch: 0.55 + Math.random() * 0.25 });
    if (kind === 'low') Object.assign(shot, { dist: 34 + Math.random() * 10, pitch: 0.38 + Math.random() * 0.1 });
    if (kind === 'wide') Object.assign(shot, { dist: 115 + Math.random() * 25, pitch: 0.95 + Math.random() * 0.15 });
    if (kind === 'flyover') Object.assign(shot, { dist: 58 + Math.random() * 15, pitch: 0.6 + Math.random() * 0.15, vx: Math.cos(yaw + Math.PI / 2) * 2.2, vz: Math.sin(yaw + Math.PI / 2) * 2.2, x: subject.x - Math.cos(yaw + Math.PI / 2) * 9, z: subject.z - Math.sin(yaw + Math.PI / 2) * 9 });
    if (kind === 'track') {
      const near = this.s.world.actors.filter((a) => a.mobile && !a.dead && (a.x * R - subject.x) ** 2 + (a.y * R - subject.z) ** 2 < 400);
      shot.actor = subject.actor || near[Math.floor(Math.random() * near.length)] || null;
      Object.assign(shot, { dist: 32 + Math.random() * 10, pitch: 0.48 + Math.random() * 0.12 });
      if (!shot.actor) shot.kind = 'orbit';
    }
    const cut = this.transition === 'cut' || (this.transition === 'mixed' && Math.random() < 0.6);
    shot.blend = cut || !this.shot ? 1 : 0;
    this.shot = shot;
    return shot;
  }

  update(dt) {
    this.clock += dt;
    const rig = this.s.rig;
    let shot = this.shot;
    if (!shot || this.clock - shot.t0 > shot.len || (shot.kind === 'track' && (!shot.actor || shot.actor.dead))) shot = this.pickShot();
    // A big fight elsewhere interrupts a quiet shot.
    if (shot.kind === 'wide' && this.clock - shot.t0 > 2.5) { const h = this.hotspot(); if (h && h.score > 25) shot = this.pickShot(); }
    const age = this.clock - shot.t0;
    let tx = shot.x, tz = shot.z, yaw = shot.yaw + shot.spin * age;
    if (shot.kind === 'flyover') { tx = shot.x + shot.vx * age; tz = shot.z + shot.vz * age; yaw = shot.yaw; }
    if (shot.kind === 'track' && shot.actor) { tx = shot.actor.x * R; tz = shot.actor.y * R; }
    if (shot.kind === 'wide') { tx += Math.cos(shot.yaw) * age * 0.8; tz += Math.sin(shot.yaw) * age * 0.8; }
    shot.blend = Math.min(1, shot.blend + dt * 0.9);
    const k = shot.blend >= 1 ? 1 : Math.min(1, dt * 2.2);
    const W = this.s.world.map.n * 2;
    rig.tx += (Math.max(6, Math.min(W - 6, tx)) - rig.tx) * k;
    rig.tz += (Math.max(6, Math.min(W - 6, tz)) - rig.tz) * k;
    let dy = yaw - rig.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    rig.yaw += dy * k;
    rig.pitch += (shot.pitch - rig.pitch) * k;
    rig.distT = shot.dist;
    if (k === 1) rig.dist = shot.dist;
    rig.glide = null;
  }
}
