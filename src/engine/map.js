// Map data + seeded generator. Simulation-only (no three.js) and deterministic:
// only arithmetic, floor/round and sqrt are used, so every client generates the same grid.
// Heights (`h`) are visual only; the simulation is flat.
import { CELL, fsin, fhypot } from './math.js';

export const MAP_N = 96;

// ---------- deterministic RNG + noise ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise(seed) {
  const perm = new Uint16Array(512);
  const rnd = mulberry32(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = new Float32Array(256);
  for (let i = 0; i < 256; i++) val[i] = rnd();
  const lattice = (x, y) => val[perm[(perm[x & 255] + y) & 511]];
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = lattice(xi, yi), b = lattice(xi + 1, yi), c = lattice(xi, yi + 1), d = lattice(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  return function fbm(x, y, oct = 4) {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += noise(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2.03; }
    return s / norm;
  };
}

// ---------- the map ----------
export class GameMap {
  constructor(seed = 1) {
    const n = (this.n = MAP_N);
    this.seed = seed;
    this.rock = new Uint8Array(n * n);
    this.bld = new Int32Array(n * n);
    this.res = new Int32Array(n * n);
    this.resMax = new Int32Array(n * n);
    this.ventOf = new Int16Array(n * n).fill(-1);
    this.h = new Float32Array((n + 1) * (n + 1));
    this.vents = [];
    // base core centres, in continuous cell coordinates (point-symmetric about the map centre)
    this.bases = [{ x: 13.5, y: 13.5 }, { x: n - 13.5, y: n - 13.5 }];
    this.resVersion = 0;
    this.generate();
  }

  idx(i, j) { return j * this.n + i; }
  inBounds(i, j) { return i >= 0 && j >= 0 && i < this.n && j < this.n; }
  passable(i, j) { if (!this.inBounds(i, j)) return false; const k = j * this.n + i; return !this.rock[k] && !this.bld[k]; }
  terrainPassable(i, j) { return this.inBounds(i, j) && !this.rock[j * this.n + i]; }
  // world units (1024 per cell)
  cellOf(x) { return Math.max(0, Math.min(this.n - 1, Math.floor(x / CELL))); }
  passableAt(x, y) { return this.passable(Math.floor(x / CELL), Math.floor(y / CELL)); }
  terrainType(k) { return this.resMax[k] > 0 ? 'Crystal' : 'Sand'; }

  // Render-space height lookup (render units: 2 per cell). Visual only.
  heightAt(x, z) {
    const n = this.n;
    let gx = x / 2, gz = z / 2;
    gx = Math.max(0, Math.min(n - 0.001, gx)); gz = Math.max(0, Math.min(n - 0.001, gz));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const w = n + 1;
    const a = this.h[j * w + i], b = this.h[j * w + i + 1], c = this.h[(j + 1) * w + i], d = this.h[(j + 1) * w + i + 1];
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
  }

  generate() {
    const n = this.n;
    const rnd = mulberry32(this.seed * 7919 + 13);
    const fA = makeNoise(this.seed * 31 + 1);
    const fB = makeNoise(this.seed * 31 + 2);
    const fC = makeNoise(this.seed * 31 + 3);
    // symmetric sampling: g(p) + g(mirror(p)) is invariant under 180° rotation
    const sym = (f, x, y, s, o) => (f(x * s, y * s, o) + f((n - x) * s, (n - y) * s, o)) * 0.5;

    // --- vents (continuous cell coords, listed for one half then mirrored) ---
    const half = [[25, 10], [10, 25], [35, 33], [22, 60], [60, 22]];
    const ventPos = [];
    for (const [x, y] of half) { ventPos.push([x, y]); ventPos.push([n - x, n - y]); }
    ventPos.push([n / 2, n / 2]);
    this.vents = ventPos.map(([x, y], id) => ({ id, x, y, wx: Math.round(x * CELL), wy: Math.round(y * CELL), cells: [] }));

    // --- rock mask ---
    const ridgeAt = (x, y) => {
      const r = 1 - Math.abs(2 * sym(fA, x, y, 0.045, 4) - 1);
      const pillars = sym(fC, x, y, 0.21, 2);
      return r * 0.85 + pillars * 0.3;
    };
    // pick the threshold from the distribution so roughly 30% of the map is obsidian
    const ridge = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) ridge[j * n + i] = ridgeAt(i + 0.5, j + 0.5);
    const sorted = Float32Array.from(ridge).sort();
    const thresh = sorted[Math.floor(sorted.length * 0.72)];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i + 0.5, y = j + 0.5;
      let rock = ridge[j * n + i] > thresh;
      if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) rock = true;
      for (const b of this.bases) if (fhypot(x - b.x, y - b.y) < 13) rock = false;
      for (const v of this.vents) if (fhypot(x - v.x, y - v.y) < 5) rock = false;
      this.rock[this.idx(i, j)] = rock ? 1 : 0;
    }

    // --- carve corridors so everything stays connected (done symmetrically) ---
    const carve = (x0, y0, x1, y1, w) => {
      const len = fhypot(x1 - x0, y1 - y0);
      if (len < 1) return;
      const steps = Math.ceil(len * 2);
      const wob = rnd() * 10;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
        const off = fsin(t * 6.283185307179586 + wob) * 3 * fsin(t * 3.141592653589793);
        const cx = x0 + (x1 - x0) * t + nx * off, cy = y0 + (y1 - y0) * t + ny * off;
        for (let dy = -w; dy <= w; dy++) for (let dx = -w; dx <= w; dx++) {
          if (dx * dx + dy * dy > w * w + 0.5) continue;
          for (const [px, py] of [[cx + dx, cy + dy], [n - (cx + dx), n - (cy + dy)]]) {
            const i = Math.floor(px), j = Math.floor(py);
            if (i >= 1 && j >= 1 && i < n - 1 && j < n - 1) this.rock[this.idx(i, j)] = 0;
          }
        }
      }
    };
    const b0 = this.bases[0];
    carve(b0.x, b0.y, n / 2, n / 2, 2);
    for (const v of this.vents) {
      if (v.x + v.y > n) continue; // mirrored half handled by carve()
      const tgt = fhypot(v.x - b0.x, v.y - b0.y) < 40 ? b0 : { x: n / 2, y: n / 2 };
      carve(v.x, v.y, tgt.x, tgt.y, 1.5);
    }
    carve(b0.x + 8, b0.y + 30, n / 2, n / 2, 1.5);

    // --- flood fill from base 0, fill pockets ---
    const seen = new Uint8Array(n * n);
    const q = [this.idx(Math.floor(b0.x), Math.floor(b0.y))];
    seen[q[0]] = 1;
    while (q.length) {
      const k = q.pop(); const i = k % n, j = (k / n) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (!this.inBounds(a, b)) continue;
        const kk = this.idx(a, b);
        if (seen[kk] || this.rock[kk]) continue;
        seen[kk] = 1; q.push(kk);
      }
    }
    for (let k = 0; k < n * n; k++) if (!seen[k]) this.rock[k] = 1;

    // --- vertex heights ---
    const w = n + 1;
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const base = sym(fB, i, j, 0.035, 4) * 3.2 + fsin((i + j) * 0.35 + sym(fC, i, j, 0.05, 2) * 6) * 0.18;
      let rc = 0;
      for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) {
        if (!this.inBounds(a, b) || this.rock[this.idx(a, b)]) rc++;
      }
      let hgt = base;
      if (rc === 4) hgt += 3.2 + sym(fA, i, j, 0.3, 2) * 3.5;
      else if (rc > 0) hgt += rc * 0.55;
      // flatten base pads
      for (const b of this.bases) {
        const d = fhypot(i - b.x, j - b.y);
        if (d < 10) hgt = hgt * (d / 10) + 1.2 * (1 - d / 10);
      }
      this.h[j * w + i] = hgt;
    }

    // --- resources around vents ---
    for (const v of this.vents) {
      const R = v.id === this.vents.length - 1 ? 4.2 : 3.6; // centre vent is richer
      for (let j = Math.floor(v.y - R); j <= Math.ceil(v.y + R); j++) for (let i = Math.floor(v.x - R); i <= Math.ceil(v.x + R); i++) {
        if (!this.terrainPassable(i, j)) continue;
        const d = fhypot(i + 0.5 - v.x, j + 0.5 - v.y);
        if (d > R || d < 0.9) continue;
        const k = this.idx(i, j);
        const amt = Math.round(140 + 220 * (1 - d / (R + 0.5)));
        this.resMax[k] = amt; this.res[k] = amt; this.ventOf[k] = v.id;
        v.cells.push(k);
      }
    }
  }

  // Nearest passable cell to (i,j) by expanding rings.
  nearestPassable(i, j, maxR = 12, ignoreBuildings = false) {
    const ok = ignoreBuildings ? (a, b) => this.terrainPassable(a, b) : (a, b) => this.passable(a, b);
    if (ok(i, j)) return [i, j];
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = 1e9;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (ok(i + di, j + dj)) { const d = di * di + dj * dj; if (d < bd) { bd = d; best = [i + di, j + dj]; } }
      }
      if (best) return best;
    }
    return null;
  }

}
