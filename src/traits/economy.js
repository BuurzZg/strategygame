import { defineTrait, Trait } from '../engine/traits.js';
import { CELL, HALF, isqrt, distSq } from '../engine/math.js';
import { FindAndDeliverResources, DeliverResources } from '../activities/harvest.js';

defineTrait('ResourceDropoff', class extends Trait {}, {});

// Crystal regrowth (world actor).
defineTrait('ResourceLayer', class extends Trait {
  tick() {
    const w = this.world, map = w.map;
    if (w.frame % this.info.RegrowInterval !== 0) return;
    let changed = false;
    for (const v of map.vents) for (const k of v.cells) {
      if (map.res[k] < map.resMax[k]) { map.res[k] = Math.min(map.resMax[k], map.res[k] + this.info.RegrowAmount); changed = true; }
    }
    if (changed) map.resVersion++;
  }
}, { RegrowInterval: 200, RegrowAmount: 1 });

defineTrait('Harvester', class Harvester extends Trait {
  created() { this.self.harvester = this; this.cargo = 0; this.lastCell = -1; this.targetCell = -1; }

  dropoffs() { return this.world.enabledTraits('ResourceDropoff', this.self.owner).map((t) => t.self); }
  nearestDropoff() {
    let best = null, bd = Infinity;
    for (const d of this.dropoffs()) { const dd = distSq(d.x, d.y, this.self.x, this.self.y); if (dd < bd) { bd = dd; best = d; } }
    return best;
  }

  // Pick a crystal cell: close to us, close to a drop-off, not already claimed by our other harvesters.
  findCell(near) {
    const self = this.self, w = this.world, map = w.map, n = map.n;
    const drops = this.dropoffs();
    const claims = new Map();
    for (const h of w.traitsOfType('Harvester')) {
      if (h !== this && h.self.owner === self.owner && !h.self.dead && h.targetCell >= 0) claims.set(h.targetCell, (claims.get(h.targetCell) || 0) + 1);
    }
    let best = -1, bs = Infinity;
    const consider = (k) => {
      if (map.res[k] < 12) return;
      const x = (k % n) * CELL + HALF, y = Math.floor(k / n) * CELL + HALF;
      let dd = Infinity;
      for (const d of drops) dd = Math.min(dd, isqrt(distSq(d.x, d.y, x, y)));
      if (dd === Infinity) dd = 0;
      const s = isqrt(distSq(x, y, self.x, self.y)) + Math.trunc((dd * 6) / 10) + (claims.get(k) || 0) * 9216 - map.res[k] * 4;
      if (s < bs) { bs = s; best = k; }
    };
    if (near >= 0 && map.ventOf[near] >= 0) {
      for (const k of map.vents[map.ventOf[near]].cells) consider(k);
      if (best >= 0 && bs < 30 * CELL) return best;
    }
    for (const v of map.vents) for (const k of v.cells) consider(k);
    return best;
  }

  orderFor(target) {
    const a = target.actor, map = this.world.map;
    if (a) return a.owner === this.self.owner && a.enabledTrait('ResourceDropoff') ? { order: 'Deliver', priority: 10 } : null;
    const k = map.cellOf(target.y) * map.n + map.cellOf(target.x);
    return map.res[k] > 0 ? { order: 'Harvest', priority: 10 } : null;
  }
  resolveOrder(o) {
    const self = this.self, map = this.world.map;
    if (o.name === 'Harvest') {
      const k = o.target ? map.cellOf(o.target.y) * map.n + map.cellOf(o.target.x) : -1;
      self.queueActivity(new FindAndDeliverResources(k >= 0 && map.res[k] > 0 ? k : -1), o.queued);
    } else if (o.name === 'Deliver' && o.target && o.target.actor) {
      self.queueActivity(new DeliverResources(o.target.actor), o.queued);
      self.queueActivity(new FindAndDeliverResources(this.lastCell), true);
    }
  }
}, { Capacity: 60, HarvestInterval: 2, HarvestAmount: 1, UnloadDelay: 15 });
