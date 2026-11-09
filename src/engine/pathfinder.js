import { CELL, HALF } from './math.js';

// Grid A* over map cells. Integer costs (10 straight / 14 diagonal), octile heuristic,
// no corner cutting, lazy-deletion binary heap. Unreachable goals return a path to the
// closest reachable cell. Output is a list of world-space waypoints, string-pulled.
const DIRS = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, -1, 1, 1, -1, -1, -1];

export class PathFinder {
  constructor(map) {
    this.map = map;
    const N = map.n * map.n;
    this.g = new Int32Array(N);
    this.parent = new Int32Array(N);
    this.stamp = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.gen = 0;
    this.heap = new Int32Array(N * 8);
    this.heapF = new Int32Array(N * 8);
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

  find(sx, sy, tx, ty, maxIter = 9000) {
    const map = this.map, n = map.n;
    let si = map.cellOf(sx), sj = map.cellOf(sy);
    let ti = map.cellOf(tx), tj = map.cellOf(ty);
    if (!map.passable(si, sj)) { const p = map.nearestPassable(si, sj, 6); if (!p) return null; [si, sj] = p; }
    let exact = true;
    if (!map.passable(ti, tj)) { const p = map.nearestPassable(ti, tj, 14); if (!p) return null; [ti, tj] = p; exact = false; }
    const start = sj * n + si, goal = tj * n + ti;
    if (start === goal) return [exact ? [tx, ty] : [ti * CELL + HALF, tj * CELL + HALF]];

    const gen = ++this.gen;
    this.size = 0;
    const g = this.g, par = this.parent, st = this.stamp, cl = this.closed;
    const H = (i, j) => { const dx = i > ti ? i - ti : ti - i, dy = j > tj ? j - tj : tj - j; return dx > dy ? 10 * dx + 4 * dy : 10 * dy + 4 * dx; };
    g[start] = 0; par[start] = -1; st[start] = gen;
    this.push(start, H(si, sj));
    let best = start, bestH = H(si, sj), iter = 0, found = false;
    while (this.size > 0 && iter++ < maxIter) {
      const cur = this.pop();
      if (cl[cur] === gen) continue;
      cl[cur] = gen;
      if (cur === goal) { found = true; break; }
      const ci = cur % n, cj = (cur - ci) / n;
      const hc = H(ci, cj);
      if (hc < bestH) { bestH = hc; best = cur; }
      for (let d = 0; d < 8; d++) {
        const di = DIRS[d * 2], dj = DIRS[d * 2 + 1];
        const ni = ci + di, nj = cj + dj;
        if (!map.passable(ni, nj)) continue;
        if (di !== 0 && dj !== 0 && (!map.passable(ci + di, cj) || !map.passable(ci, cj + dj))) continue;
        const nk = nj * n + ni;
        if (cl[nk] === gen) continue;
        const ng = g[cur] + (di !== 0 && dj !== 0 ? 14 : 10);
        if (st[nk] !== gen || ng < g[nk]) {
          st[nk] = gen; g[nk] = ng; par[nk] = cur;
          this.push(nk, ng + H(ni, nj));
        }
      }
    }
    const end = found ? goal : best;
    const cells = [];
    for (let k = end; k !== -1; k = par[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => { const i = k % n; return [i * CELL + HALF, ((k - i) / n) * CELL + HALF]; });
    if (found && exact) pts[pts.length - 1] = [tx, ty];
    return this.smooth(pts);
  }

  smooth(pts) {
    if (pts.length <= 2) return pts.length === 2 ? [pts[1]] : pts;
    const out = [];
    let anchor = pts[0], i = 1;
    while (i < pts.length) {
      let j = i;
      while (j + 1 < pts.length && this.los(anchor[0], anchor[1], pts[j + 1][0], pts[j + 1][1])) j++;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }

  // Line of sight for a unit about 0.8 cells wide (samples the centre line and both edges).
  los(x0, y0, x1, y1) {
    const map = this.map;
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.floor(Math.sqrt(dx * dx + dy * dy));
    if (len < 16) return true;
    const steps = Math.ceil(len / 256);
    const px = Math.trunc(-dy * 430 / len), py = Math.trunc(dx * 430 / len);
    for (let s = 1; s <= steps; s++) {
      const x = x0 + Math.trunc(dx * s / steps), y = y0 + Math.trunc(dy * s / steps);
      if (!map.passableAt(x, y) || !map.passableAt(x + px, y + py) || !map.passableAt(x - px, y - py)) return false;
    }
    return true;
  }
}
