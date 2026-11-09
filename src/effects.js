import * as THREE from '../lib/three.module.js';

// Pooled particle system with per-particle colour, alpha and size.
class Particles {
  constructor(scene, cap, blending) {
    this.cap = cap;
    this.n = 0;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.rgb = new Float32Array(cap * 3);
    this.a0 = new Float32Array(cap);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('pcolor', this.colAttr);
    geo.setAttribute('psize', this.sizeAttr);
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: `
        attribute vec4 pcolor; attribute float psize; varying vec4 vC; uniform float scale;
        void main(){ vC = pcolor; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = psize * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `
        varying vec4 vC;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d) * vC.a;
          if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, a); }`,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, color, alpha = 1, grav = 0, drag = 0) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.rgb[i * 3] = color.r; this.rgb[i * 3 + 1] = color.g; this.rgb[i * 3 + 2] = color.b;
    this.a0[i] = alpha; this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.copy(--this.n, i); continue; }
      const t = 1 - this.life[i] / this.max[i];
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 2] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      this.col[i * 4] = this.rgb[i * 3]; this.col[i * 4 + 1] = this.rgb[i * 3 + 1]; this.col[i * 4 + 2] = this.rgb[i * 3 + 2];
      this.col[i * 4 + 3] = this.a0[i] * (1 - t * t);
      i++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    this.posAttr.needsUpdate = true; this.colAttr.needsUpdate = true; this.sizeAttr.needsUpdate = true;
  }
  copy(from, to) {
    if (from === to) return;
    for (let k = 0; k < 3; k++) { this.pos[to * 3 + k] = this.pos[from * 3 + k]; this.vel[to * 3 + k] = this.vel[from * 3 + k]; this.rgb[to * 3 + k] = this.rgb[from * 3 + k]; }
    for (let k = 0; k < 4; k++) this.col[to * 4 + k] = this.col[from * 4 + k];
    this.life[to] = this.life[from]; this.max[to] = this.max[from]; this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from];
    this.size[to] = this.size[from]; this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from]; this.a0[to] = this.a0[from];
  }
}

const tmpC = new THREE.Color();
const up = new THREE.Vector3(0, 1, 0);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.glow = new Particles(scene, 4000, THREE.AdditiveBlending);
    this.smoke = new Particles(scene, 1500, THREE.NormalBlending);
    // beams: pooled thin cylinders
    this.beams = [];
    const bg = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
    bg.translate(0, 0.5, 0);
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false; m.frustumCulled = false; m.renderOrder = 6;
      scene.add(m);
      this.beams.push({ mesh: m, life: 0, max: 0, w: 0 });
    }
    // projectiles
    this.projGeo = new THREE.IcosahedronGeometry(0.22, 0);
    this.projPool = [];
    // shockwave rings
    this.rings = [];
    const rg = new THREE.RingGeometry(0.8, 1, 32); rg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.visible = false; m.renderOrder = 4; scene.add(m);
      this.rings.push({ mesh: m, life: 0, max: 0, r: 0 });
    }
    // order markers
    this.markers = [];
    const mg = new THREE.RingGeometry(0.6, 0.85, 24); mg.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      m.visible = false; m.renderOrder = 4; scene.add(m);
      this.markers.push({ mesh: m, life: 0 });
    }
  }

  getProjectileMesh(color) {
    let m = this.projPool.pop();
    if (!m) { m = new THREE.Mesh(this.projGeo, new THREE.MeshBasicMaterial()); this.scene.add(m); }
    m.material.color.set(color);
    m.visible = true;
    return m;
  }
  releaseProjectileMesh(m) { m.visible = false; this.projPool.push(m); }

  beam(a, b, color, width = 0.12, life = 0.16) {
    const slot = this.beams.find((s) => s.life <= 0) || this.beams[0];
    const m = slot.mesh;
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    if (len < 0.01) return;
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(up, dir.normalize());
    m.scale.set(width, len, width);
    m.material.color.set(color);
    m.material.opacity = 1;
    m.visible = true;
    slot.life = life; slot.max = life; slot.w = width;
  }

  ring(x, y, z, radius, color, life = 0.5) {
    const slot = this.rings.find((s) => s.life <= 0) || this.rings[0];
    slot.mesh.position.set(x, y + 0.2, z);
    slot.mesh.material.color.set(color);
    slot.mesh.visible = true;
    slot.life = life; slot.max = life; slot.r = radius;
  }

  marker(x, y, z, color) {
    const slot = this.markers.find((s) => s.life <= 0) || this.markers[0];
    slot.mesh.position.set(x, y + 0.15, z);
    slot.mesh.material.color.set(color);
    slot.mesh.visible = true;
    slot.life = 0.45;
  }

  sparks(x, y, z, color, count = 6, speed = 6) {
    tmpC.set(color);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.28, e = Math.random() * 1.2;
      const s = speed * (0.4 + Math.random() * 0.6);
      this.glow.spawn(x, y, z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s, Math.sin(a) * Math.cos(e) * s, 0.25 + Math.random() * 0.25, 0.5, 0.1, tmpC, 1, 9, 2);
    }
  }

  muzzle(x, y, z, color) {
    tmpC.set(color);
    this.glow.spawn(x, y, z, 0, 0, 0, 0.09, 1.1, 0.4, tmpC, 1);
  }

  explosion(x, y, z, scale = 1, color = 0xffb060) {
    tmpC.set(color);
    this.glow.spawn(x, y + 0.5 * scale, z, 0, 0, 0, 0.25, 3 * scale, 6 * scale, tmpC, 1);
    for (let i = 0; i < 14 * scale; i++) {
      const a = Math.random() * 6.28, s = (3 + Math.random() * 7) * Math.sqrt(scale);
      tmpC.set(color).lerp(new THREE.Color(0xffffff), Math.random() * 0.4);
      this.glow.spawn(x, y + 0.5, z, Math.cos(a) * s, 2 + Math.random() * 6 * scale, Math.sin(a) * s, 0.4 + Math.random() * 0.5, 1.0 * scale, 0.2, tmpC, 1, 12, 1.5);
    }
    tmpC.set(0x1a1424);
    for (let i = 0; i < 6 * scale; i++) {
      const a = Math.random() * 6.28;
      this.smoke.spawn(x + Math.cos(a) * scale, y + 0.5, z + Math.sin(a) * scale, Math.cos(a) * 1.2, 1.5 + Math.random() * 1.5, Math.sin(a) * 1.2, 1.4 + Math.random() * 1.0, 1.5 * scale, 4.5 * scale, tmpC, 0.55, -0.3, 0.8);
    }
    this.ring(x, y, z, 4 * scale, color, 0.45);
  }

  // Resonance stream from crystals to a harvester.
  siphon(x0, y0, z0, x1, y1, z1, color) {
    tmpC.set(color);
    const t = 0.35;
    this.glow.spawn(x0 + (Math.random() - 0.5), y0 + 0.5, z0 + (Math.random() - 0.5), (x1 - x0) / t, (y1 - y0) / t, (z1 - z0) / t, t, 0.45, 0.2, tmpC, 0.9);
  }

  heal(x, y, z) {
    tmpC.set(0x9cffb8);
    for (let i = 0; i < 2; i++) this.glow.spawn(x + (Math.random() - 0.5) * 1.5, y + Math.random(), z + (Math.random() - 0.5) * 1.5, 0, 2.2, 0, 0.6, 0.5, 0.1, tmpC, 0.9);
  }

  weave(x, y, z, r, color) {
    tmpC.set(color);
    const a = Math.random() * 6.28;
    this.glow.spawn(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, 3 + Math.random() * 2, 0, 0.7, 0.45, 0.1, tmpC, 0.9);
  }

  update(dt) {
    this.glow.update(dt);
    this.smoke.update(dt);
    for (const b of this.beams) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const t = Math.max(0, b.life / b.max);
      b.mesh.material.opacity = t;
      b.mesh.scale.x = b.mesh.scale.z = b.w * (0.4 + t * 0.6);
      if (b.life <= 0) b.mesh.visible = false;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - Math.max(0, r.life / r.max);
      r.mesh.scale.setScalar(0.3 + r.r * t);
      r.mesh.material.opacity = (1 - t) * 0.8;
      if (r.life <= 0) r.mesh.visible = false;
    }
    for (const m of this.markers) {
      if (m.life <= 0) continue;
      m.life -= dt;
      const t = Math.max(0, m.life / 0.45);
      m.mesh.scale.setScalar(0.4 + t * 1.2);
      m.mesh.material.opacity = t;
      if (m.life <= 0) m.mesh.visible = false;
    }
  }
}
