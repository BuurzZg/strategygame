import { defineTrait, Trait } from '../engine/traits.js';
import { CELL, HALF, distSq } from '../engine/math.js';
import { MoveTo } from '../activities/move.js';
import { Attack } from '../activities/attack.js';
import { FindAndDeliverResources } from '../activities/harvest.js';

// ---------------------------------------------------------------- Building
// Occupies a square footprint of cells. Init: { ci, cj } = top-left cell.
defineTrait('Building', class Building extends Trait {
  created() {
    const self = this.self, s = this.info.Footprint;
    this.size = s;
    this.ci = self.init.ci | 0; this.cj = self.init.cj | 0;
    self.x = this.ci * CELL + s * HALF; self.y = this.cj * CELL + s * HALF;
    self.px = self.x; self.py = self.y;
    this.seenBy = self.owner.index >= 0 ? 1 << self.owner.index : 0;
    self.building = this;
  }
  addedToWorld() {
    const w = this.world, map = w.map, n = map.n, s = this.size;
    for (let j = this.cj; j < this.cj + s; j++) for (let i = this.ci; i < this.ci + s; i++) map.bld[j * n + i] = this.self.id;
    // push units out of the footprint
    for (const a of w.actors) {
      if (!a.mobile || a.dead) continue;
      const ui = map.cellOf(a.x), uj = map.cellOf(a.y);
      if (ui >= this.ci && ui < this.ci + s && uj >= this.cj && uj < this.cj + s) {
        const p = map.nearestPassable(ui, uj, 8);
        if (p) { a.x = p[0] * CELL + HALF; a.y = p[1] * CELL + HALF; }
      }
    }
  }
  removedFromWorld() {
    const map = this.world.map, n = map.n, s = this.size;
    for (let j = this.cj; j < this.cj + s; j++) for (let i = this.ci; i < this.ci + s; i++) if (map.bld[j * n + i] === this.self.id) map.bld[j * n + i] = 0;
  }
}, { Footprint: 1, RequiresField: true });

// ---------------------------------------------------------------- Weavable
// Structures rise on site. While unfinished the actor carries the `weaving` condition,
// which disables production, supply, field etc. via `RequiresCondition: !weaving`.
defineTrait('Weavable', class Weavable extends Trait {
  created() {
    const self = this.self;
    this.duration = self.info.traitInfo('Buildable')?.BuildDuration || 250;
    this.total = this.duration * 2; // progress is counted in half-ticks (half speed without a Core)
    this.done = !!self.init.complete;
    this.progress = this.done ? this.total : 0;
    this.waiting = false;
    this.token = this.done ? 0 : self.grantCondition('weaving');
  }
  addedToWorld() {
    if (this.done) return;
    const h = this.self.health;
    h.hp = Math.max(1, Math.trunc(h.maxHp / 10));
    this.self.owner.weavers.add(this.self);
  }
  advance(rate) {
    if (this.done || this.self.dead) return;
    const h = this.self.health;
    const before = Math.trunc((h.maxHp * 9 * this.progress) / (10 * this.total));
    this.progress = Math.min(this.total, this.progress + rate);
    const after = Math.trunc((h.maxHp * 9 * this.progress) / (10 * this.total));
    h.hp = Math.min(h.maxHp, h.hp + after - before);
    if (this.progress >= this.total) this.complete();
  }
  complete() {
    const self = this.self, w = this.world;
    this.done = true;
    this.token = self.revokeCondition(this.token);
    self.owner.stats.structuresBuilt++;
    w.fx({ t: 'complete', actor: self.id, owner: self.owner.index });
    w.notify(self.owner, `${self.info.traitInfo('Tooltip').Name} woven`, 'good');
    w.emit('built', self);
  }
}, {});

defineTrait('ProvidesWeaver', class extends Trait {}, {});
defineTrait('ProvidesField', class extends Trait {}, { Range: 10240 });
defineTrait('ProvidesSupply', class extends Trait {}, { Amount: 10 });
defineTrait('ProvidesPrerequisite', class extends Trait {
  get name() { return this.info.Prerequisite || this.self.type; }
}, { Prerequisite: '' });

// ---------------------------------------------------------------- production
defineTrait('ProductionQueue', class ProductionQueue extends Trait {
  created() { this.queue = []; this.progress = 0; }
  get rules() { return this.world.rules; }
  buildables() { return this.rules.buildablesFor(this.info.Type); }
  current() { return this.queue.length ? this.rules.actor(this.queue[0]) : null; }

  // null if `type` can be queued now, otherwise a player-facing reason.
  canQueue(type) {
    const info = this.rules.actors.get(type);
    const b = info && info.traitInfo('Buildable');
    if (!b || !b.Queue.includes(this.info.Type)) return 'Cannot build that here';
    const p = this.self.owner;
    const miss = p.tech.missing(b.Prerequisites);
    if (miss) return `Requires ${miss}`;
    if (this.queue.length >= this.info.MaxQueue) return 'Queue is full';
    const need = info.traitInfo('ConsumesSupply')?.Amount || 0;
    if (p.supply.used() + need > p.supply.cap()) return p.supply.cap() >= p.supply.info.Max ? 'Supply limit reached' : 'Supply capped: weave a Resonator';
    if (p.resources.cash < info.traitInfo('Valued').Cost) return 'Not enough resonance';
    return null;
  }

  resolveOrder(o) {
    const p = this.self.owner;
    if (o.name === 'StartProduction') {
      const err = this.canQueue(o.extra);
      if (err) { this.world.notify(p, err, 'bad'); return; }
      p.resources.take(this.rules.actor(o.extra).traitInfo('Valued').Cost);
      this.queue.push(o.extra);
    } else if (o.name === 'CancelProduction') {
      const i = o.extra | 0;
      if (i < 0 || i >= this.queue.length) return;
      const type = this.queue.splice(i, 1)[0];
      p.resources.give(this.rules.actor(type).traitInfo('Valued').Cost);
      if (i === 0) this.progress = 0;
    }
  }

  killed() {
    // refund what was paid for but never built
    for (const type of this.queue) this.self.owner.resources.give(this.rules.actor(type).traitInfo('Valued').Cost);
    this.queue.length = 0;
  }

  tick() {
    if (!this.queue.length) return;
    const info = this.current();
    const dur = info.traitInfo('Buildable').BuildDuration;
    if (++this.progress < dur) return;
    const exit = this.exitPoint();
    if (!exit) { this.progress = dur; return; }
    const type = this.queue.shift();
    this.progress = 0;
    const self = this.self, w = this.world;
    const unit = w.createActor(type, self.owner, { x: exit[0], y: exit[1], facing: self.owner.index === 0 ? 128 : 640 });
    self.owner.stats.unitsBuilt++;
    w.fx({ t: 'ready', actor: unit.id, owner: self.owner.index });
    this.dispatch(unit);
    w.emit('produced', unit, self);
  }

  dispatch(unit) {
    const rally = this.self.trait('RallyPoint')?.point;
    const map = this.world.map;
    if (unit.harvester) {
      let k = -1;
      if (rally) { const kk = map.cellOf(rally.y) * map.n + map.cellOf(rally.x); if (map.res[kk] > 0) k = kk; }
      unit.queueActivity(new FindAndDeliverResources(k));
      return;
    }
    if (!rally) return;
    const t = rally.target !== undefined ? this.world.actorById.get(rally.target) : null;
    if (t && !t.dead && unit.attack && unit.owner.isEnemy(t.owner)) unit.queueActivity(new Attack(t));
    else unit.queueActivity(new MoveTo(rally.x, rally.y));
  }

  // Free cell next to the footprint, preferring the rally point (or the map centre).
  exitPoint() {
    const b = this.self.building, map = this.world.map, s = b.size;
    const rally = this.self.trait('RallyPoint')?.point;
    const tx = rally ? rally.x : (map.n * CELL) >> 1, ty = rally ? rally.y : (map.n * CELL) >> 1;
    let best = null, bd = Infinity;
    for (let ring = 1; ring <= 3 && !best; ring++) {
      for (let j = b.cj - ring; j < b.cj + s + ring; j++) for (let i = b.ci - ring; i < b.ci + s + ring; i++) {
        if (i >= b.ci && i < b.ci + s && j >= b.cj && j < b.cj + s) continue;
        if (!map.passable(i, j)) continue;
        const x = i * CELL + HALF, y = j * CELL + HALF;
        const d = distSq(x, y, tx, ty);
        if (d < bd) { bd = d; best = [x, y]; }
      }
    }
    return best;
  }
}, { Type: '', MaxQueue: 5 });

defineTrait('RallyPoint', class extends Trait {
  created() { this.point = null; }
  orderFor(target) { return target.actor === this.self ? null : { order: 'SetRallyPoint', priority: 1 }; }
  resolveOrder(o) {
    if (o.name !== 'SetRallyPoint' || !o.target) return;
    this.point = { x: o.target.x, y: o.target.y, target: o.target.actor ? o.target.actor.id : undefined };
  }
}, {});

// Dismantle for a partial refund.
defineTrait('Recyclable', class extends Trait {
  resolveOrder(o) {
    if (o.name !== 'Recycle') return;
    const self = this.self, h = self.health;
    const weaving = self.conditions.has('weaving');
    const cost = self.info.traitInfo('Valued').Cost;
    const pct = weaving ? this.info.WeavingRefundPercent : this.info.RefundPercent;
    self.owner.resources.give(Math.trunc((((cost * pct) / 100) * h.hp) / h.maxHp));
    h.kill(null, null, true);
  }
}, { RefundPercent: 40, WeavingRefundPercent: 75 });

// Spawns an actor once, when the trait first becomes enabled (e.g. when weaving completes).
defineTrait('FreeActor', class extends Trait {
  enable() {
    if (this.spawned || !this.self.inWorld) return;
    this.spawned = true;
    const self = this.self;
    this.world.addFrameEndTask((w) => {
      if (self.dead) return;
      const q = self.trait('ProductionQueue');
      const exit = q ? q.exitPoint() : [self.x, self.y + CELL * 2];
      if (!exit) return;
      const a = w.createActor(this.info.Actor, self.owner, { x: exit[0], y: exit[1], facing: self.facing });
      if (a.harvester) a.queueActivity(new FindAndDeliverResources(-1));
    });
  }
}, { Actor: '' });
