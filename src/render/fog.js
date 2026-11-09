import * as THREE from '../../lib/three.module.js';

// Draws the local player's shroud as a dusk-indigo veil over the terrain.
// `source` exposes `vis` (Uint8Array: 0 unseen, 1 explored, 2 visible) and `n`.
export class FogOverlay {
  constructor(terrainGeo, n, worldSize) {
    this.n = n;
    this.disp = new Float32Array(n * n);
    this.data = new Uint8Array(n * n * 4);
    this.tex = new THREE.DataTexture(this.data, n, n, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    const mat = new THREE.ShaderMaterial({
      uniforms: { fogTex: { value: this.tex }, world: { value: worldSize }, tint: { value: new THREE.Color(0x07050f) } },
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
    this.first = true;
  }
  update(vis, dt) {
    const d = this.disp, data = this.data;
    const k = this.first ? 1 : Math.min(1, dt * 5);
    this.first = false;
    for (let i = 0; i < d.length; i++) {
      const v = vis ? vis[i] : 2;
      const target = v === 2 ? 1 : v === 1 ? 0.45 : 0;
      d[i] += (target - d[i]) * k;
      const b = (d[i] * 255) | 0;
      data[i * 4] = b; data[i * 4 + 1] = b; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
    }
    this.tex.needsUpdate = true;
  }
}
