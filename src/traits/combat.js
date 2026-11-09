import { defineTrait, Trait } from '../engine/traits.js';
import { angleOf, angleDiff, turnToward, distSq, isqrt } from '../engine/math.js';
import { fireWeapon } from '../engine/weapons.js';
import { Attack, AttackMove } from '../activities/attack.js';
import { MoveWithinRange } from '../activities/move.js';

// ---------------------------------------------------------------- Armament
defineTrait('Armament', class Armament extends Trait {
  created() {
    this.weapon = this.world.rules.weapons.get(this.info.Weapon);
    this.cooldown = 0;
  }
  tick() { if (this.cooldown > 0) this.cooldown--; }
  canFireAt(target) {
    const d = this.world.edgeDist(this.self, target);
    return d <= this.weapon.Range && d >= this.weapon.MinRange;
  }
  fire(target) {
    if (this.cooldown > 0 || !this.canFireAt(target)) return false;
    fireWeapon(this.world, this.self, this, target);
    this.cooldown = this.weapon.ReloadDelay;
    return true;
  }
}, { Weapon: '', MuzzleHeight: 100 });

// ---------------------------------------------------------------- Attack (turreted / frontal)
class AttackBase extends Trait {
  created() { this.self.attack = this; this.opportunity = null; this._arms = null; }
  get arms() { return (this._arms ||= this.self.traitsOf('Armament')).filter((a) => a.enabled); }
  get range() { let r = 0; for (const a of this.arms) r = Math.max(r, a.weapon.Range); return r; }
  get minRange() { let r = Infinity; for (const a of this.arms) r = Math.min(r, a.weapon.MinRange); return r === Infinity ? 0 : r; }

  canTarget(t) {
    return !!t && !t.dead && !t.disposed && !!t.health && this.self.owner.isEnemy(t.owner) && this.world.canSee(this.self.owner, t);
  }

  // Aim at t and fire every ready armament. Returns false if t is out of range.
  engage(t) {
    const self = this.self;
    if (this.world.edgeDist(self, t) > this.range) return false;
    const angle = angleOf(t.x - self.x, t.y - self.y);
    const tol = this.info.FacingTolerance;
    let aligned = true;
    if (self.turret) aligned = self.turret.aim(angle, tol);
    else if (self.mobile) {
      self.facing = turnToward(self.facing, angle, self.mobile.info.TurnSpeed);
      const d = angleDiff(self.facing, angle);
      aligned = d <= tol && d >= -tol;
    }
    if (aligned) for (const a of this.arms) a.fire(t);
    return true;
  }

  // Opportunity fire: idle units and structures shoot targets handed to them by AutoTarget.
  tick() {
    const o = this.opportunity;
    if (!o) return;
    if (!this.canTarget(o) || this.world.edgeDist(this.self, o) > this.range) { this.opportunity = null; return; }
    if (this.self.isIdle) this.engage(o);
  }

  orderFor(target) {
    return target.actor && this.self.owner.isEnemy(target.actor.owner) ? { order: 'Attack', priority: 6 } : null;
  }
  resolveOrder(o) {
    const self = this.self;
    if (o.name === 'Attack' && o.target && o.target.actor) self.queueActivity(new Attack(o.target.actor, { allowMove: !!self.mobile }), o.queued);
    else if (o.name === 'AttackMove' && o.target && self.mobile) self.queueActivity(new AttackMove(o.target.x, o.target.y), o.queued);
    else if (o.name === 'Stop') this.opportunity = null;
  }
}
defineTrait('AttackTurreted', class extends AttackBase {}, { FacingTolerance: 40 });
defineTrait('AttackFrontal', class extends AttackBase {}, { FacingTolerance: 48 });

// ---------------------------------------------------------------- AutoTarget
// Stances: AttackAnything (chase within a leash), Defend (fire from position), HoldFire.
defineTrait('AutoTarget', class AutoTarget extends Trait {
  created() { this.stance = this.info.InitialStance; this.timer = (this.self.id * 3) % this.info.ScanInterval; }

  tick() {
    const self = this.self;
    if (!self.attack || this.stance === 'HoldFire') return;
    if (--this.timer > 0) return;
    this.timer = this.info.ScanInterval;
    if (!self.isIdle) return;
    const chase = !!self.mobile && this.stance === 'AttackAnything';
    const t = this.acquire(chase ? Math.max(this.info.ScanRange, self.attack.range) : self.attack.range);
    if (!t) return;
    if (chase) self.queueActivity(new Attack(t, { allowMove: true, leash: this.info.Leash }), false);
    else self.attack.opportunity = t;
  }

  damaged({ attacker }) {
    const self = this.self;
    if (!self.attack || this.stance === 'HoldFire' || !attacker || attacker.dead || !self.owner.isEnemy(attacker.owner)) return;
    if (!self.isIdle) return;
    if (self.mobile && this.stance === 'AttackAnything') self.queueActivity(new Attack(attacker, { allowMove: true, leash: this.info.Leash }), false);
    else if (!self.attack.opportunity) self.attack.opportunity = attacker;
  }

  // Best visible enemy within range: armed units first, then unarmed, then structures.
  acquire(range) {
    const self = this.self, w = this.world;
    let best = null, bs = Infinity;
    for (const a of w.actorsInCircle(self.x, self.y, range + 1536)) {
      if (!self.owner.isEnemy(a.owner) || !a.health || !w.canSee(self.owner, a)) continue;
      const d = w.edgeDist(self, a);
      if (d > range) continue;
      let s = d;
      if (a.building) s += a.attack ? 4096 : 12288;
      else if (!a.attack) s += 3072;
      if (s < bs) { bs = s; best = a; }
    }
    return best;
  }

  resolveOrder(o) { if (o.name === 'SetStance') this.stance = o.extra; }
}, { ScanRange: 5120, ScanInterval: 8, InitialStance: 'AttackAnything', Leash: 7168 });

// ---------------------------------------------------------------- support
// Periodically repairs the most damaged ally nearby; when idle, drifts toward damaged allies.
defineTrait('HealsAllies', class HealsAllies extends Trait {
  created() { this.timer = this.info.Interval; this.seek = 0; }
  findDamaged(range, minDist = -1) {
    const self = this.self, w = this.world;
    let best = null, bs = Infinity;
    for (const a of w.unitsInCircle(self.x, self.y, range)) {
      if (a === self || !self.owner.isAlly(a.owner) || !a.health || a.health.hp >= a.health.maxHp) continue;
      const d = isqrt(distSq(self.x, self.y, a.x, a.y));
      if (d < minDist) continue;
      const s = Math.trunc((a.health.hp * 1000) / a.health.maxHp) + (d >> 6);
      if (s < bs) { bs = s; best = a; }
    }
    return best;
  }
  tick() {
    if (--this.timer > 0) return;
    this.timer = this.info.Interval;
    const t = this.findDamaged(this.info.Range);
    if (!t) return;
    t.health.heal(this.info.Amount);
    this.world.fx({ t: 'heal', from: this.self.id, to: t.id });
    if (this.self.isIdle) this.self.facing = turnToward(this.self.facing, angleOf(t.x - this.self.x, t.y - this.self.y), 64);
  }
  idle() {
    if (--this.seek > 0) return;
    this.seek = 16;
    const t = this.findDamaged(this.info.SeekRange, (this.info.Range * 8) / 10);
    if (t) this.self.queueActivity(new MoveWithinRange(t, (this.info.Range * 7) / 10), false);
  }
}, { Interval: 9, Amount: 400, Range: 2816, SeekRange: 6144 });

// Slow self-repair while standing inside the owner's lattice field and out of combat.
defineTrait('LatticeRegen', class extends Trait {
  tick() {
    const w = this.world, h = this.self.health;
    if (w.frame % this.info.Interval !== this.self.id % this.info.Interval) return;
    if (h.hp >= h.maxHp || w.frame - h.lastDamaged < this.info.Delay) return;
    if (w.inField(this.self.owner, this.self.x, this.self.y)) h.heal(this.info.Amount);
  }
}, { Delay: 125, Interval: 25, Amount: 300 });
