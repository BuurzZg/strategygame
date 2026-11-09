import { Activity, Wait } from '../engine/activity.js';
import { CELL, HALF, isqrt, distSq, angleOf, turnToward } from '../engine/math.js';
import { MoveTo, MoveWithinRange } from './move.js';

const cx = (map, k) => (k % map.n) * CELL + HALF;
const cy = (map, k) => Math.floor(k / map.n) * CELL + HALF;

// The harvester's main loop: find a crystal cell, fill up, deliver, repeat.
export class FindAndDeliverResources extends Activity {
  static label = 'Harvesting';
  constructor(preferCell = -1) { super(); this.prefer = preferCell; }
  tick(self) {
    if (this.canceling) return true;
    const h = self.harvester, map = self.world.map;
    if (h.cargo >= h.info.Capacity) { this.queueChild(new DeliverResources(null)); return false; }
    const k = h.findCell(this.prefer >= 0 ? this.prefer : h.lastCell);
    this.prefer = -1;
    if (k < 0) {
      if (h.cargo > 0) this.queueChild(new DeliverResources(null)); else this.queueChild(new Wait(50));
      return false;
    }
    h.targetCell = k;
    this.queueChild(new MoveTo(cx(map, k), cy(map, k), { range: 600 }));
    this.queueChild(new HarvestCell(k));
    return false;
  }
  onLastRun(self) { self.harvester.targetCell = -1; }
}

export class HarvestCell extends Activity {
  static label = 'Harvesting';
  constructor(cell) { super(); this.cell = cell; this.t = 0; }
  tick(self) {
    if (this.canceling) return true;
    const h = self.harvester, w = self.world, map = w.map, k = this.cell;
    const x = cx(map, k), y = cy(map, k);
    if (distSq(self.x, self.y, x, y) > 1500 * 1500) return true;
    if (map.res[k] <= 0) { h.lastCell = k; return true; }
    self.facing = turnToward(self.facing, angleOf(x - self.x, y - self.y), 24);
    if (++this.t >= h.info.HarvestInterval) {
      this.t = 0;
      const take = Math.min(h.info.HarvestAmount, map.res[k], h.info.Capacity - h.cargo);
      map.res[k] -= take; h.cargo += take; map.resVersion++;
    }
    if (w.frame % 4 === 0) w.fx({ t: 'siphon', actor: self.id, cell: k });
    if (h.cargo >= h.info.Capacity) { h.lastCell = k; return true; }
    return false;
  }
}

export class DeliverResources extends Activity {
  static label = 'Delivering';
  constructor(dock) { super(); this.dock = dock; this.unload = -1; this.tries = 0; }
  tick(self) {
    if (this.canceling) return true;
    const h = self.harvester, w = self.world;
    if (h.cargo <= 0) return true;
    if (!this.dock || this.dock.dead || this.dock.disposed || !this.dock.enabledTrait('ResourceDropoff')) {
      this.dock = h.nearestDropoff();
      if (!this.dock) { this.queueChild(new Wait(50)); return false; }
    }
    if (w.edgeDist(self, this.dock) > 1100) {
      if (++this.tries > 5) { this.dock = null; this.tries = 0; return false; }
      this.queueChild(new MoveWithinRange(this.dock, 900));
      return false;
    }
    if (this.unload < 0) this.unload = h.info.UnloadDelay;
    if (--this.unload > 0) return false;
    const owner = self.owner;
    const amount = Math.trunc((h.cargo * owner.harvestBonus) / 100);
    owner.resources.give(amount);
    owner.stats.harvested += amount;
    h.cargo = 0;
    w.fx({ t: 'deposit', actor: self.id, owner: owner.index });
    return true;
  }
}
