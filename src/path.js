import { CELL } from './config.js';

// Grid A* with octile heuristic, no corner cutting, lazy-deletion binary heap.
// Returns a smoothed list of world-space waypoints [[x,z], ...] or null.
export class PathFinder {
  constructor(map) {
    this.map = map;
    const N = map.n * map.n;
    this.g = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.stamp = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.gen = 0;
    this.heap = new Int32Array(N * 8);
    this.heapF = new Float32Array(N * 8);
    this.size = 0;
  }

  push(node, f) {
    let i = this.size++;
    const h = this.heap, hf = this.heapF;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= f) break;
      h[i] = h[p]; hf[i] = hf[p]; i = p;
    }
    h[i] = node; hf[i] = f;
  }
  pop() {
    const h = this.heap, hf = this.heapF;
    const top = h[0];
    const last = h[--this.size], lf = hf[this.size];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && hf[c + 1] < hf[c]) c++;
      if (hf[c] >= lf) break;
      h[i] = h[c]; hf[i] = hf[c]; i = c;
    }
    h[i] = last; hf[i] = lf;
    return top;
  }

  find(sx, sz, tx, tz, maxIter = 9000) {
    const map = this.map, n = map.n;
    let si = map.cellOf(sx), sj = map.cellOf(sz);
    let ti = map.cellOf(tx), tj = map.cellOf(tz);
    if (!map.passable(si, sj)) { const p = map.nearestPassable(si, sj, 6); if (!p) return null; [si, sj] = p; }
    let exactGoal = true;
    if (!map.passable(ti, tj)) { const p = map.nearestPassable(ti, tj, 14); if (!p) return null; [ti, tj] = p; exactGoal = false; }
    const start = sj * n + si, goal = tj * n + ti;
    if (start === goal) return [[exactGoal ? tx : (ti + 0.5) * CELL, exactGoal ? tz : (tj + 0.5) * CELL]];

    const gen = ++this.gen;
    this.size = 0;
    const g = this.g, par = this.parent, st = this.stamp, cl = this.closed;
    const H = (i, j) => { const dx = Math.abs(i - ti), dy = Math.abs(j - tj); return (dx + dy) + (1.4142 - 2) * Math.min(dx, dy); };
    g[start] = 0; par[start] = -1; st[start] = gen;
    this.push(start, H(si, sj));
    let best = start, bestH = H(si, sj);
    let iter = 0, found = false;
    while (this.size > 0 && iter++ < maxIter) {
      const cur = this.pop();
      if (cl[cur] === gen) continue;
      cl[cur] = gen;
      if (cur === goal) { found = true; break; }
      const ci = cur % n, cj = (cur / n) | 0;
      const hc = H(ci, cj);
      if (hc < bestH) { bestH = hc; best = cur; }
      for (let d = 0; d < 8; d++) {
        const di = DIRS[d * 2], dj = DIRS[d * 2 + 1];
        const ni = ci + di, nj = cj + dj;
        if (!map.passable(ni, nj)) continue;
        if (di !== 0 && dj !== 0 && (!map.passable(ci + di, cj) || !map.passable(ci, cj + dj))) continue;
        const nk = nj * n + ni;
        if (cl[nk] === gen) continue;
        const ng = g[cur] + (di !== 0 && dj !== 0 ? 1.4142 : 1);
        if (st[nk] !== gen || ng < g[nk]) {
          st[nk] = gen; g[nk] = ng; par[nk] = cur;
          this.push(nk, ng + H(ni, nj) * 1.001);
        }
      }
    }
    const end = found ? goal : best;
    const cells = [];
    for (let k = end; k !== -1; k = par[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => [((k % n) + 0.5) * CELL, (((k / n) | 0) + 0.5) * CELL]);
    if (found && exactGoal) pts[pts.length - 1] = [tx, tz];
    return this.smooth(pts);
  }

  // String-pulling: drop waypoints that have clear line of sight.
  smooth(pts) {
    if (pts.length <= 2) return pts.slice(1).length ? pts.slice(1) : pts;
    const out = [];
    let anchor = pts[0];
    let i = 1;
    while (i < pts.length) {
      let j = i;
      while (j + 1 < pts.length && this.los(anchor[0], anchor[1], pts[j + 1][0], pts[j + 1][1])) j++;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }

  los(x0, z0, x1, z1) {
    const map = this.map;
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return true;
    const steps = Math.ceil(len / (CELL * 0.25));
    const px = -dz / len * CELL * 0.42, pz = dx / len * CELL * 0.42;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = x0 + dx * t, z = z0 + dz * t;
      if (!map.passableAt(x, z) || !map.passableAt(x + px, z + pz) || !map.passableAt(x - px, z - pz)) return false;
    }
    return true;
  }
}

const DIRS = new Int8Array([1, 0, -1, 0, 0, 1, 0, -1, 1, 1, -1, 1, 1, -1, -1, -1]);
