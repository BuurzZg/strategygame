import { Activity } from '../engine/activity.js';
import { distSq } from '../engine/math.js';
import { MoveTo, MoveWithinRange } from './move.js';

// Attack a specific actor: close to weapon range (if allowed), aim, fire.
// With a leash, give up and walk back if dragged too far from where the fight started.
export class Attack extends Activity {
  static label = 'Attacking';
  constructor(target, opts = {}) {
    super();
    this.target = target;
    this.allowMove = opts.allowMove !== false;
    this.leash = opts.leash || 0;
    this.mover = null;
  }
  onFirstRun(self) { this.lx = self.x; this.ly = self.y; }
  tick(self) {
    if (this.canceling) return true;
    const t = this.target, at = self.attack;
    if (!at || !at.enabled || !at.canTarget(t)) return true;
    if (this.leash && distSq(self.x, self.y, this.lx, this.ly) > this.leash * this.leash) {
      const back = new MoveTo(this.lx, this.ly);
      back.next = this.next;
      this.next = back;
      return true;
    }
    const d = self.world.edgeDist(self, t);
    if (d <= at.range) {
      this.mover = null;
      if (d < at.minRange && self.mobile) { self.mobile.stepToward(self.x * 2 - t.x, self.y * 2 - t.y); return false; }
      at.engage(t);
      return false;
    }
    if (!this.allowMove || !self.mobile) return true;
    if (!this.mover) this.mover = new MoveWithinRange(t, Math.max(512, at.range - 256));
    if (this.mover.run(self)) this.mover = null;
    return false;
  }
  cancel(self, keep) { super.cancel(self, keep); if (this.mover) this.mover.cancel(self); }
}

// Move toward a point, engaging anything hostile met on the way, then carry on.
export class AttackMove extends Activity {
  static label = 'Advancing';
  constructor(x, y) {
    super();
    this.x = x; this.y = y;
    this.mover = null; this.fight = null; this.scan = 0;
  }
  tick(self) {
    if (this.canceling) return true;
    if (this.fight) {
      if (!this.fight.run(self)) return false;
      this.fight = null; this.mover = null;
    }
    if (--this.scan <= 0) {
      this.scan = 8;
      const auto = self.trait('AutoTarget');
      const range = Math.max(auto ? auto.info.ScanRange : 0, self.attack ? self.attack.range : 0);
      const t = auto ? auto.acquire(range) : null;
      if (t) { this.fight = new Attack(t, { allowMove: true }); return false; }
    }
    if (!this.mover) this.mover = new MoveTo(this.x, this.y);
    return this.mover.run(self);
  }
  cancel(self, keep) {
    super.cancel(self, keep);
    if (this.mover) this.mover.cancel(self);
    if (this.fight) this.fight.cancel(self);
  }
}
