import { Activity } from '../engine/activity.js';
import { isqrt, distSq } from '../engine/math.js';

// Follow a path to a point. Re-plans when stuck; gives up near the goal if crowded.
export class MoveTo extends Activity {
  static label = 'Moving';
  constructor(x, y, opts = {}) {
    super();
    this.x = x | 0; this.y = y | 0;
    this.range = opts.range || 0;
    this.path = null; this.pi = 0;
    this.stuckT = 0; this.stuckN = 0; this.sx = 0; this.sy = 0;
  }
  tick(self) {
    if (this.canceling) return true;
    const w = self.world;
    if (this.range && distSq(self.x, self.y, this.x, this.y) <= this.range * this.range) return true;
    if (!this.path) {
      if (w.pathBudget <= 0) return false;
      w.pathBudget--;
      this.path = w.pathfinder.find(self.x, self.y, this.x, this.y);
      this.pi = 0; this.sx = self.x; this.sy = self.y; this.stuckT = 0;
      if (!this.path) return true;
    }
    if (this.pi >= this.path.length) return true;
    const [wx, wy] = this.path[this.pi];
    const last = this.pi === this.path.length - 1;
    const d = isqrt(distSq(self.x, self.y, wx, wy));
    if (d <= (last ? 200 : 560)) { this.pi++; return this.pi >= this.path.length; }
    self.mobile.stepToward(wx, wy, last ? 2048 : 0);

    if (++this.stuckT >= 30) {
      const moved = isqrt(distSq(self.x, self.y, this.sx, this.sy));
      this.sx = self.x; this.sy = self.y; this.stuckT = 0;
      if (moved < 300) {
        this.stuckN++;
        const toGoal = isqrt(distSq(self.x, self.y, this.x, this.y));
        if (toGoal < (3 + this.stuckN) * 1024 || this.stuckN > 5) return true;
        if (this.stuckN >= 2) this.path = null;
      } else this.stuckN = 0;
    }
    return false;
  }
}

// Close to within `range` of a (possibly moving) actor.
export class MoveWithinRange extends Activity {
  static label = 'Moving';
  constructor(target, range) {
    super();
    this.target = target; this.range = range;
    this.mover = null; this.gx = 0; this.gy = 0; this.repath = 0; this.fails = 0;
  }
  tick(self) {
    if (this.canceling) return true;
    const t = this.target, w = self.world;
    if (!t || t.dead || t.disposed) return true;
    if (w.edgeDist(self, t) <= this.range) return true;
    if (!this.mover || (--this.repath <= 0 && distSq(t.x, t.y, this.gx, this.gy) > 1024 * 1024)) {
      this.mover = new MoveTo(t.x, t.y);
      this.gx = t.x; this.gy = t.y; this.repath = 20;
    }
    if (this.mover.run(self)) { this.mover = null; if (++this.fails > 8) return true; }
    return false;
  }
  cancel(self, keep) { super.cancel(self, keep); if (this.mover) this.mover.cancel(self); }
}
