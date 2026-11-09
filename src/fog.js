import * as THREE from '../lib/three.module.js';
import { CELL, WORLD } from './config.js';

// Per-team visibility: 0 = never seen, 1 = explored, 2 = currently visible.
export class Visibility {
  constructor(map) {
    this.map = map;
    this.n = map.n;
    this.vis = new Uint8Array(this.n * this.n);
    this.circles = new Map();
  }
  circle(r) {
    const key = Math.round(r * 2);
    if (this.circles.has(key)) return this.circles.get(key);
    const rr = key / 2, out = [];
    const R = Math.ceil(rr);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) if (di * di + dj * dj <= rr * rr) out.push(di, dj);
    const arr = new Int16Array(out);
    this.circles.set(key, arr);
    return arr;
  }
  recompute(sources) {
    const v = this.vis, n = this.n;
    for (let k = 0; k < v.length; k++) if (v[k] === 2) v[k] = 1;
    for (const s of sources) {
      const ci = Math.floor(s.x / CELL), cj = Math.floor(s.z / CELL);
      const c = this.circle(s.sight);
      for (let p = 0; p < c.length; p += 2) {
        const i = ci + c[p], j = cj + c[p + 1];
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        v[j * n + i] = 2;
      }
    }
  }
  at(x, z) {
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return 0;
    return this.vis[j * this.n + i];
  }
  visible(x, z) { return this.at(x, z) === 2; }
  explored(x, z) { return this.at(x, z) >= 1; }
  revealAll() { this.vis.fill(2); }
}

// Fog overlay: a second copy of the terrain surface drawn in dusk-indigo with alpha from a texture.
export class FogOverlay {
  constructor(terrainGeo, vis) {
    this.vis = vis;
    const n = vis.n;
    this.disp = new Float32Array(n * n);
    this.data = new Uint8Array(n * n * 4);
    this.tex = new THREE.DataTexture(this.data, n, n, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    const mat = new THREE.ShaderMaterial({
      uniforms: { fogTex: { value: this.tex }, world: { value: WORLD }, tint: { value: new THREE.Color(0x07050f) } },
      vertexShader: `
        varying vec2 vUv; uniform float world;
        void main(){ vUv = position.xz / world; gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(0.0, 0.25, 0.0), 1.0); }`,
      fragmentShader: `
        varying vec2 vUv; uniform sampler2D fogTex; uniform vec3 tint;
        void main(){ float v = texture2D(fogTex, vUv).r; float a = (1.0 - v) * 0.86; if (a < 0.01) discard; gl_FragColor = vec4(tint, a); }`,
      transparent: true, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(terrainGeo, mat);
    this.mesh.renderOrder = 3;
    this.update(1, true);
  }
  update(dt, snap = false) {
    const v = this.vis.vis, d = this.disp, data = this.data;
    const k = snap ? 1 : Math.min(1, dt * 5);
    for (let i = 0; i < v.length; i++) {
      const target = v[i] === 2 ? 1 : v[i] === 1 ? 0.45 : 0;
      d[i] += (target - d[i]) * k;
      const b = (d[i] * 255) | 0;
      data[i * 4] = b; data[i * 4 + 1] = b; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
    }
    this.tex.needsUpdate = true;
  }
}
