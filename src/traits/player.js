import { defineTrait, Trait } from '../engine/traits.js';
import { CELL, HALF } from '../engine/math.js';
import { FindAndDeliverResources } from '../activities/harvest.js';

defineTrait('PlayerResources', class extends Trait {
  created() { this.cash = this.info.Cash; this.self.owner.resources = this; this.self.owner.harvestBonus = 100; }
  take(n) { if (this.cash < n) return false; this.cash -= n; return true; }
  give(n) { this.cash += n; }
}, { Cash: 500 });

defineTrait('SupplyManager', class extends Trait {
  created() { this.self.owner.supply = this; }
  cap() {
    let c = 0;
    for (const t of this.world.enabledTraits('ProvidesSupply', this.self.owner)) c += t.info.Amount;
    return Math.min(this.info.Max, c);
  }
  used() {
    const p = this.self.owner, w = this.world;
    let u = 0;
    for (const t of w.traitsOfType('ConsumesSupply')) if (t.self.owner === p && !t.self.dead) u += t.info.Amount;
    for (const q of w.traitsOfType('ProductionQueue')) {
      if (q.self.owner !== p || q.self.dead) continue;
      for (const type of q.queue) u += w.rules.actor(type).traitInfo('ConsumesSupply')?.Amount || 0;
    }
    return u;
  }
}, { Max: 120 });

defineTrait('TechTree', class extends Trait {
  created() { this.self.owner.tech = this; }
  has(prereq) {
    for (const t of this.world.enabledTraits('ProvidesPrerequisite', this.self.owner)) if (t.name === prereq) return true;
    return false;
  }
  // Display name of the first unmet prerequisite, or null.
  missing(prereqs) {
    for (const p of prereqs) {
      if (p.startsWith('~')) continue;
      if (!this.has(p)) return this.world.rules.actor(p).traitInfo('Tooltip')?.Name || p;
    }
    return null;
  }
}, {});

// Structures are woven one per Core at a time (at half speed if you have no Core).
defineTrait('WeaverManager', class extends Trait {
  created() { this.self.owner.weavers = this; this.list = []; }
  add(actor) { this.list.push(actor); }
  tick() {
    this.list = this.list.filter((a) => !a.dead && !a.disposed && !a.trait('Weavable').done);
    const cores = this.world.enabledTraits('ProvidesWeaver', this.self.owner).length;
    const slots = Math.max(1, cores), rate = cores ? 2 : 1;
    for (let i = 0; i < this.list.length; i++) {
      const wv = this.list[i].trait('Weavable');
      wv.waiting = i >= slots;
      if (!wv.waiting) wv.advance(rate);
    }
  }
}, {});

// Player order: PlaceBuilding { extra: actor type, target: top-left cell corner }.
defineTrait('PlaceBuilding', class extends Trait {
  resolveOrder(o) {
    if (o.name !== 'PlaceBuilding' || !o.target) return;
    const p = this.self.owner, w = this.world;
    const info = w.rules.actors.get(o.extra);
    if (!info || !info.traitInfo('Buildable')?.Queue.includes('Structure')) return;
    const ci = Math.floor(o.target.x / CELL), cj = Math.floor(o.target.y / CELL);
    const err = w.canPlace(p, o.extra, ci, cj);
    if (err) { w.notify(p, err, 'bad'); return; }
    if (!p.resources.take(info.traitInfo('Valued').Cost)) { w.notify(p, 'Not enough resonance', 'bad'); return; }
    const a = w.createActor(o.extra, p, { ci, cj });
    w.fx({ t: 'placed', actor: a.id, owner: p.index });
  }
}, {});

// Per-player visibility. 0 = never seen, 1 = explored, 2 = visible now. Allies share vision.
defineTrait('Shroud', class Shroud extends Trait {
  created() {
    const n = this.world.map.n;
    this.n = n;
    this.vis = new Uint8Array(n * n);
    this.circles = new Map();
    this.version = 0;
    this.self.owner.shroud = this;
  }
  circle(range) {
    let c = this.circles.get(range);
    if (c) return c;
    const out = [], R = Math.ceil(range / CELL), r2 = range * range;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) if (di * di * CELL * CELL + dj * dj * CELL * CELL <= r2) out.push(di, dj);
    c = new Int16Array(out);
    this.circles.set(range, c);
    return c;
  }
  worldLoaded() { this.recompute(); }
  tick() { if (this.world.frame % this.info.Interval === 0) this.recompute(); }
  recompute() {
    const v = this.vis, n = this.n, p = this.self.owner, w = this.world;
    for (let k = 0; k < v.length; k++) if (v[k] === 2) v[k] = 1;
    for (const t of w.traitsOfType('RevealsShroud')) {
      const a = t.self;
      if (a.dead || !p.isAlly(a.owner)) continue;
      const ci = Math.floor(a.x / CELL), cj = Math.floor(a.y / CELL);
      const range = a.conditions.has('weaving') ? (t.info.Range * 6) / 10 : t.info.Range;
      const c = this.circle(range - (range % 128));
      for (let i = 0; i < c.length; i += 2) {
        const x = ci + c[i], y = cj + c[i + 1];
        if (x >= 0 && y >= 0 && x < n && y < n) v[y * n + x] = 2;
      }
    }
    const bit = 1 << p.index;
    for (const b of w.traitsOfType('Building')) {
      if (b.seenBy & bit) continue;
      const a = b.self;
      if (!a.dead && v[Math.floor(a.y / CELL) * n + Math.floor(a.x / CELL)] === 2) b.seenBy |= bit;
    }
    this.version++;
  }
  isVisible(x, y) {
    const i = Math.floor(x / CELL), j = Math.floor(y / CELL);
    return i >= 0 && j >= 0 && i < this.n && j < this.n && this.vis[j * this.n + i] === 2;
  }
  isExplored(x, y) {
    const i = Math.floor(x / CELL), j = Math.floor(y / CELL);
    return i >= 0 && j >= 0 && i < this.n && j < this.n && this.vis[j * this.n + i] >= 1;
  }
}, { Interval: 5 });

defineTrait('PlayerStatistics', class extends Trait {
  created() {
    Object.assign(this, { unitsBuilt: 0, unitsLost: 0, kills: 0, structuresBuilt: 0, structuresLost: 0, harvested: 0 });
    this.self.owner.stats = this;
  }
  actorLost(a, recycled) { if (a.building) { if (!recycled) this.structuresLost++; } else this.unitsLost++; }
}, {});

// Warns the owner when their structures or harvesters are hit (throttled).
defineTrait('BaseAttackNotifier', class extends Trait {
  created() { this.last = -100000; this.self.owner.lastAlert = null; }
  actorDamaged(actor, ev) {
    const w = this.world;
    if (!ev.by || ev.by === this.self.owner) return;
    if (!actor.building && !actor.harvester) return;
    if (w.frame - this.last < this.info.Interval) return;
    this.last = w.frame;
    this.self.owner.lastAlert = { x: actor.x, y: actor.y, frame: w.frame };
    w.fx({ t: 'alert', player: this.self.owner.index, x: actor.x, y: actor.y, text: actor.building ? 'Our structures are under attack' : 'Skimmers under attack' });
  }
}, { Interval: 300 });

// You lose when you have no structures left. Last team standing wins.
defineTrait('ConquestVictoryConditions', class extends Trait {
  tick() {
    const p = this.self.owner, w = this.world;
    if (p.outcome || w.frame % 25 !== 0) return;
    if (!w.traitsOfType('Building').some((b) => b.self.owner === p && !b.self.dead)) this.lose();
  }
  resolveOrder(o) { if (o.name === 'Surrender' && !this.self.owner.outcome) this.lose(); }
  lose() {
    const p = this.self.owner, w = this.world;
    p.outcome = 'lost';
    for (const a of w.actors) if (a.owner === p && !a.dead && a.health) a.health.kill(null, null);
    w.fx({ t: 'outcome', player: p.index, outcome: 'lost' });
    const teams = new Set(w.players.filter((x) => !x.outcome).map((x) => x.team));
    if (teams.size <= 1) {
      for (const x of w.players) if (!x.outcome) { x.outcome = 'won'; w.fx({ t: 'outcome', player: x.index, outcome: 'won' }); }
      w.gameOver = true;
    }
  }
}, {});

// ---------------------------------------------------------------- bots
defineTrait('GrantBotConditions', class extends Trait {
  created() {
    const p = this.self.owner;
    if (!p.botType) return;
    this.self.grantCondition('bot');
    this.self.grantCondition(`bot-${p.botType}`);
  }
}, {});

// Difficulty profile, enabled by a `bot-<type>` condition.
defineTrait('BotProfile', class extends Trait {
  enable() { this.self.owner.botProfile = this.info; this.self.owner.harvestBonus = this.info.HarvestBonus; }
}, { ThinkInterval: 25, HarvestBonus: 100, FirstWave: 6500, WaveBase: 20, WaveGrow: 8, MaxFoundries: 3, SkimmersPerDropoff: 4, MaxSkimmers: 16 });

// ---------------------------------------------------------------- world: starting units
defineTrait('StartingUnits', class extends Trait {
  worldLoaded() {
    const w = this.world, map = w.map;
    for (const p of w.players) {
      const b = map.bases[p.spawn];
      const ci = Math.round(b.x - 1.5), cj = Math.round(b.y - 1.5);
      w.createActor(this.info.BaseActor, p, { ci, cj, complete: true });
      const toCentre = b.x < map.n / 2 ? 1 : -1;
      const cx = Math.round((b.x + toCentre * 4.5) * CELL), cy = Math.round((b.y + toCentre * 4.5) * CELL);
      const facing = toCentre > 0 ? 128 : 640;
      this.info.Units.forEach((type, i) => {
        const ring = (i % 4) - 1.5, row = Math.floor(i / 4);
        const x = cx + Math.round((ring * 1.6 - row) * toCentre * CELL), y = cy + Math.round((row * 1.6 - ring * 0.6) * toCentre * CELL);
        const pc = map.nearestPassable(map.cellOf(x), map.cellOf(y), 8);
        const a = w.createActor(type, p, { x: pc ? pc[0] * CELL + HALF : x, y: pc ? pc[1] * CELL + HALF : y, facing });
        if (a.harvester) a.queueActivity(new FindAndDeliverResources(-1));
      });
    }
  }
}, { BaseActor: 'core', Units: [] });
