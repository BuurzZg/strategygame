// Seeded, deterministic RNG (mulberry32). The simulation must use this instead of Math.random.
export class Random {
  constructor(seed) { this.state = (seed >>> 0) || 0x6d2b79f5; this.draws = 0; }
  next() {
    this.draws++;
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  // integer in [0, n)
  int(n) { return n <= 0 ? 0 : this.next() % n; }
  // integer in [a, b)
  range(a, b) { return a + this.int(b - a); }
  pick(arr) { return arr[this.int(arr.length)]; }
}
