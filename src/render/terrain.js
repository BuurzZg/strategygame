import * as THREE from '../../lib/three.module.js';
import { makeNoise, mulberry32 } from '../engine/map.js';

// Render units: 2 per cell (world units / 512).
const CELL = 2;
export const RES_COLOR = 0xff4fa0;
export const RES_GLOW = 0xffa8d2;

export function buildTerrain(map) {
  const n = map.n, w = n + 1;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(w * w * 3);
  const col = new Float32Array(w * w * 3);
  const fD = makeNoise(map.seed * 17 + 5);
  const low = new THREE.Color(0x5d4f73), high = new THREE.Color(0xc4adb9), ridge = new THREE.Color(0x221b2e);
  const vent = new THREE.Color(0x7a3a6c), salt = new THREE.Color(0xe6d6da);
  const c = new THREE.Color();
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = j * w + i;
    const hgt = map.h[k];
    pos[k * 3] = i * CELL; pos[k * 3 + 1] = hgt; pos[k * 3 + 2] = j * CELL;
    let rc = 0;
    for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) if (!map.inBounds(a, b) || map.rock[map.idx(a, b)]) rc++;
    const t = Math.max(0, Math.min(1, hgt / 3.4));
    c.copy(low).lerp(high, t * 0.85);
    const streak = fD(i * 0.25, j * 0.08, 3);
    c.lerp(salt, Math.max(0, streak - 0.55) * 0.9);
    if (rc > 0) c.lerp(ridge, rc / 4 * 0.9);
    let ventInf = 0;
    for (const v of map.vents) { const d = Math.sqrt((i - v.x) ** 2 + (j - v.y) ** 2); if (d < 6) ventInf = Math.max(ventInf, 1 - d / 6); }
    if (ventInf > 0 && rc < 2) c.lerp(vent, ventInf * 0.7);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  const idx = new Uint32Array(n * n * 6);
  let p = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * w + i, b = a + 1, c2 = a + w, d = c2 + 1;
    idx[p++] = a; idx[p++] = c2; idx[p++] = b;
    idx[p++] = b; idx[p++] = c2; idx[p++] = d;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.08 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// Obsidian glass shards on rock cells.
export function buildRocks(map) {
  const rnd = mulberry32(map.seed * 101 + 7);
  const n = map.n;
  const list = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (!map.rock[map.idx(i, j)]) continue;
    let edge = false;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (map.terrainPassable(i + a, j + b)) edge = true;
    if (rnd() < (edge ? 0.75 : 0.22)) list.push([i, j, edge]);
  }
  const geo = new THREE.ConeGeometry(0.75, 1, 5, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a2236, roughness: 0.25, metalness: 0.6, flatShading: true, emissive: 0x1a0f2a, emissiveIntensity: 0.6 });
  const mesh = new THREE.InstancedMesh(geo, mat, list.length * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3();
  let k = 0;
  for (const [i, j, edge] of list) {
    const count = edge ? 2 : 1;
    for (let c = 0; c < count; c++) {
      const x = (i + 0.2 + rnd() * 0.6) * CELL, z = (j + 0.2 + rnd() * 0.6) * CELL;
      const y = map.heightAt(x, z) - 0.3;
      e.set((rnd() - 0.5) * 0.5, rnd() * 6.28, (rnd() - 0.5) * 0.5);
      q.setFromEuler(e);
      const hgt = (edge ? 2 : 3.5) + rnd() * 4;
      s.set(0.7 + rnd() * 0.9, hgt, 0.7 + rnd() * 0.9);
      v.set(x, y, z);
      m.compose(v, q, s);
      mesh.setMatrixAt(k++, m);
    }
  }
  mesh.count = k;
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

// Resonance crystals: one instance per resource cell, scaled by remaining amount.
export class CrystalField {
  constructor(map, scene) {
    this.map = map;
    this.cells = [];
    for (const v of map.vents) for (const k of v.cells) this.cells.push(k);
    const geo = new THREE.OctahedronGeometry(0.55, 0);
    geo.scale(1, 2.2, 1);
    geo.translate(0, 0.9, 0);
    this.mat = new THREE.MeshStandardMaterial({ color: RES_COLOR, emissive: RES_COLOR, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.3, flatShading: true });
    this.per = 3;
    this.mesh = new THREE.InstancedMesh(geo, this.mat, this.cells.length * this.per);
    this.mesh.castShadow = true;
    const rnd = mulberry32(map.seed * 55 + 3);
    this.jit = this.cells.map(() => Array.from({ length: this.per }, () => [rnd() * 0.8 + 0.1, rnd() * 0.8 + 0.1, rnd() * 6.28, (rnd() - 0.5) * 0.7, (rnd() - 0.5) * 0.7, 0.6 + rnd() * 0.6]));
    scene.add(this.mesh);

    // vent mouths
    const ringGeo = new THREE.TorusGeometry(1.4, 0.18, 6, 18);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: RES_GLOW, transparent: true, opacity: 0.8 });
    this.rings = map.vents.map((v) => {
      const r = new THREE.Mesh(ringGeo, ringMat);
      const x = v.x * CELL, z = v.y * CELL;
      r.position.set(x, map.heightAt(x, z) + 0.15, z);
      scene.add(r);
      return r;
    });
    this.update(true);
  }
  update(force = false) {
    if (!force && this.seenVersion === this.map.resVersion) return;
    this.seenVersion = this.map.resVersion;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const n = this.map.n;
    let p = 0;
    this.cells.forEach((k, ci) => {
      const i = k % n, j = (k / n) | 0;
      const frac = this.map.res[k] / this.map.resMax[k];
      for (let c = 0; c < this.per; c++) {
        const [ox, oz, ry, rx, rz, sc] = this.jit[ci][c];
        const show = frac > c / this.per * 0.9;
        const x = (i + ox) * CELL, z = (j + oz) * CELL;
        v.set(x, this.map.heightAt(x, z) - 0.2, z);
        e.set(rx, ry, rz); q.setFromEuler(e);
        const f = show ? (0.35 + 0.65 * frac) * sc : 0.0001;
        s.set(f, f, f);
        m.compose(v, q, s);
        this.mesh.setMatrixAt(p++, m);
      }
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  animate(t) {
    this.mat.emissiveIntensity = 0.45 + Math.sin(t * 2.1) * 0.15;
    for (let i = 0; i < this.rings.length; i++) this.rings[i].scale.setScalar(1 + Math.sin(t * 1.7 + i) * 0.08);
  }
}

