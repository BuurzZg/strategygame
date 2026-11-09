import { defineTrait, Trait } from '../engine/traits.js';
import { makeOrder } from '../engine/order.js';
import { CELL, HALF, cos, sin, distSq, isqrt } from '../engine/math.js';

// Bot modules live on the player actor and only run for bot players (RequiresCondition: bot).
// They run inside the deterministic simulation on every client, so they must only use
// world state and world.rng, and they act by resolving ordinary Orders.
class BotModule extends Trait {
  get p() { return this.self.owner; }
  get profile() { return this.self.owner.botProfile; }
  due(offset) { const pr = this.profile; return !!pr && !this.p.outcome && this.world.frame % pr.ThinkInterval === offset % pr.ThinkInterval; }
  order(name, subjects, target, extra) { this.world.resolveOrder(makeOrder(name, subjects, target, extra), this.p); }
  mine(pred) { const out = []; for (const a of this.world.actors) if (a.owner === this.p && !a.dead && pred(a)) out.push(a); return out; }
  queues(type) { return this.world.enabledTraits('ProductionQueue', this.p).filter((q) => q.info.Type === type); }
  home() {
    const core = this.mine((a) => a.type === 'core' && !a.conditions.has('weaving'))[0];
    return core || this.mine((a) => !!a.building)[0] || null;
  }
  rallyPoint(home) {
    const c = (this.world.map.n * CELL) >> 1;
    const dx = c - home.x, dy = c - home.y, d = isqrt(dx * dx + dy * dy) || 1;
    return { x: home.x + Math.trunc((dx * 9 * CELL) / d), y: home.y + Math.trunc((dy * 9 * CELL) / d) };
  }
}

// Idle harvesters go back to work.
defineTrait('HarvesterBotModule', class extends BotModule {
  tick() {
    if (!this.due(1)) return;
    const idle = this.mine((a) => a.harvester && a.isIdle);
    if (idle.length) this.order('Harvest', idle);
  }
}, {});

// Keeps Skimmers saturated and Foundries busy with a weighted unit mix.
defineTrait('UnitBuilderBotModule', class extends BotModule {
  tick() {
    if (!this.due(3)) return;
    const w = this.world, p = this.p, pr = this.profile;
    const drops = w.enabledTraits('ResourceDropoff', p).length;
    const coreQs = this.queues('core');
    let skimmers = this.mine((a) => !!a.harvester).length;
    for (const q of coreQs) skimmers += q.queue.filter((t) => t === 'skimmer').length;
    const want = Math.min(pr.MaxSkimmers, drops * pr.SkimmersPerDropoff + 1);
    if (skimmers < want) {
      const q = coreQs.find((x) => x.queue.length === 0);
      if (q && !q.canQueue('skimmer')) this.order('StartProduction', [q.self], null, 'skimmer');
    }
    for (const q of this.queues('foundry')) {
      if (q.queue.length >= (p.resources.cash > 800 ? 4 : 2)) continue;
      const type = this.pick(q);
      if (!type) continue;
      const cost = w.rules.actor(type).traitInfo('Valued').Cost;
      if (p.resources.cash >= cost + (skimmers < want ? 50 : 0) && !q.canQueue(type)) this.order('StartProduction', [q.self], null, type);
    }
  }
  pick(q) {
    const shares = Object.entries(this.info.UnitShares).filter(([t]) => !this.p.tech.missing(this.world.rules.actor(t).traitInfo('Buildable').Prerequisites));
    const total = shares.reduce((s, [, v]) => s + v, 0);
    if (!total) return null;
    let r = this.world.rng.int(total);
    for (const [t, v] of shares) { r -= v; if (r < 0) return t; }
    return shares[0][0];
  }
}, { UnitShares: {} });

// Weaves supply, production, defences and tech; expands by chaining pylons toward vents.
defineTrait('BaseBuilderBotModule', class extends BotModule {
  created() { this.expandVent = null; }
  tick() {
    if (!this.due(5)) return;
    const w = this.world, p = this.p, pr = this.profile, f = w.frame;
    const home = this.home();
    if (!home || p.weavers.list.length >= 2) return;
    const count = (t) => this.mine((a) => a.type === t).length;
    const foundries = count('foundry');
    const room = p.supply.cap() - p.supply.used();
    const pendingSupply = p.weavers.list.some((a) => a.has('ProvidesSupply'));
    if (room < 6 + foundries * 2 && !pendingSupply && p.supply.cap() < p.supply.info.Max) this.build('resonator', home);
    else if (foundries === 0) this.build('foundry', home);
    else if (count('spire') < 1 && f > 3750) this.build('spire', home, true);
    else if (count('uplink') === 0 && f > 5500) this.build('uplink', home);
    else if (foundries < pr.MaxFoundries && f > 6000 && p.resources.cash > 350) this.build('foundry', home);
    else if (f > 4250 && count('siphon') < 2) this.expand(home);
    else if (count('spire') < 3 && f > 9000 && p.resources.cash > 400) this.build('spire', home, true);
  }

  cost(type) { return this.world.rules.actor(type).traitInfo('Valued').Cost; }

  build(type, home, forward = false) {
    if (this.p.resources.cash < this.cost(type)) return false;
    const hb = home.building;
    let ax = hb.ci + hb.size / 2, ay = hb.cj + hb.size / 2;
    if (forward) { const r = this.rallyPoint(home); ax = (ax + r.x / CELL) / 2; ay = (ay + r.y / CELL) / 2; }
    const spot = this.findSpot(type, ax, ay, forward ? 1 : 4, 14, true);
    if (!spot) return false;
    this.order('PlaceBuilding', [], { x: spot[0] * CELL, y: spot[1] * CELL }, type);
    return true;
  }

  // Spiral outward from (ax, ay) (cell units) for a legal footprint with a free margin.
  findSpot(type, ax, ay, minR, maxR, margin) {
    const w = this.world, map = w.map, n = map.n;
    const s = w.rules.actor(type).traitInfo('Building').Footprint;
    let tried = 0;
    for (let r = minR; r <= maxR && tried < 400; r++) {
      const steps = 16 + r * 4;
      for (let k = 0; k < steps; k++, tried++) {
        const a = (Math.trunc((k * 1024) / steps) + r * 115) & 1023;
        const ci = Math.round(ax + (cos(a) * r) / 1024 - s / 2), cj = Math.round(ay + (sin(a) * r) / 1024 - s / 2);
        if (w.canPlace(this.p, type, ci, cj)) continue;
        if (margin) {
          let ok = true;
          for (let j = cj - 1; j <= cj + s && ok; j++) for (let i = ci - 1; i <= ci + s; i++) {
            if (!map.inBounds(i, j) || map.bld[j * n + i] || map.rock[j * n + i]) { ok = false; break; }
          }
          if (!ok) continue;
        }
        return [ci, cj];
      }
    }
    return null;
  }

  expand(home) {
    const w = this.world, map = w.map, p = this.p;
    const drops = this.mine((a) => a.has('ResourceDropoff'));
    const near = (v, list, r) => list.some((a) => distSq(a.x, a.y, v.wx, v.wy) < r * CELL * r * CELL);
    if (!this.expandVent || near(this.expandVent, drops, 7)) {
      const enemy = w.actors.filter((a) => a.building && !a.dead && p.isEnemy(a.owner));
      const cands = map.vents.filter((v) => !near(v, drops, 8) && !near(v, enemy, 12) && v.cells.some((k) => map.res[k] > 50));
      cands.sort((a, b) => distSq(a.wx, a.wy, home.x, home.y) - distSq(b.wx, b.wy, home.x, home.y) || a.id - b.id);
      this.expandVent = cands[0] || null;
    }
    const v = this.expandVent;
    if (!v) return;
    const spot = this.findSpot('siphon', v.x, v.y, 3, 6, false);
    if (spot) { if (p.resources.cash >= this.cost('siphon')) this.order('PlaceBuilding', [], { x: spot[0] * CELL, y: spot[1] * CELL }, 'siphon'); return; }
    if (p.resources.cash < this.cost('pylon') || p.weavers.list.some((a) => a.type === 'pylon')) return;
    // pylon at the field edge closest to the vent
    let best = null, bd = Infinity;
    for (const f of w.fieldSources(p)) {
      const b = f.self.building;
      const bx = b.ci + b.size / 2, by = b.cj + b.size / 2;
      const dx = v.x - bx, dy = v.y - by, d = Math.sqrt(dx * dx + dy * dy) || 1;
      for (let r = Math.floor(f.info.Range / CELL) - 1; r >= 2; r--) {
        const ci = Math.round(bx + (dx / d) * r - 0.5), cj = Math.round(by + (dy / d) * r - 0.5);
        if (w.canPlace(p, 'pylon', ci, cj)) continue;
        const dd = (ci - v.x) * (ci - v.x) + (cj - v.y) * (cj - v.y);
        if (dd < bd) { bd = dd; best = [ci, cj]; }
        break;
      }
    }
    if (best) this.order('PlaceBuilding', [], { x: best[0] * CELL, y: best[1] * CELL }, 'pylon');
  }
}, {});

// Holds the army at a rally point, defends, and attacks in growing waves.
defineTrait('SquadManagerBotModule', class extends BotModule {
  created() { this.wave = 0; this.attacking = false; this.target = null; }
  tick() {
    if (!this.due(7)) return;
    const w = this.world, p = this.p, pr = this.profile, f = w.frame;
    const home = this.home();
    if (!home) return;
    const army = this.mine((a) => !!a.mobile && !a.harvester);
    const armySupply = army.reduce((s, a) => s + (a.trait('ConsumesSupply')?.info.Amount || 0), 0);
    const idle = army.filter((a) => a.isIdle);

    const threatened = this.mine((a) => a.building && f - a.health.lastDamaged < 100)[0] || this.mine((a) => a.harvester && f - a.health.lastDamaged < 75)[0];
    if (threatened && !this.attacking) {
      const free = army.filter((a) => a.isIdle || (a.activity && a.activity.constructor.label === 'Moving'));
      if (free.length) this.order('AttackMove', free, { x: threatened.x, y: threatened.y });
    }

    const threshold = pr.WaveBase + this.wave * pr.WaveGrow;
    if (!this.attacking && f > pr.FirstWave && armySupply >= Math.min(threshold, p.supply.cap() - 12)) {
      this.attacking = true; this.wave++;
      this.launch(army);
    } else if (this.attacking) {
      if (armySupply < (threshold * 3) / 10) {
        this.attacking = false; this.target = null;
        const r = this.rallyPoint(home);
        if (army.length) this.order('Move', army, r);
      } else {
        if (!this.target || this.target.dead) this.launch(army);
        else if (idle.length) this.order('AttackMove', idle, { x: this.target.x, y: this.target.y });
      }
    } else {
      const r = this.rallyPoint(home);
      const loose = idle.filter((a) => distSq(a.x, a.y, r.x, r.y) > 49 * CELL * CELL);
      if (loose.length) this.order('AttackMove', loose, r);
      for (const q of this.queues('foundry')) { const rp = q.self.trait('RallyPoint'); if (rp) rp.point = { x: r.x, y: r.y }; }
    }
  }
  launch(army) {
    const enemy = this.world.actors.filter((a) => a.building && !a.dead && this.p.isEnemy(a.owner));
    if (!enemy.length || !army.length) return;
    let cx = 0, cy = 0;
    for (const a of army) { cx += a.x; cy += a.y; }
    cx = Math.trunc(cx / army.length); cy = Math.trunc(cy / army.length);
    enemy.sort((a, b) => distSq(a.x, a.y, cx, cy) - distSq(b.x, b.y, cx, cy) || a.id - b.id);
    this.target = enemy[0];
    this.order('AttackMove', army, { x: this.target.x, y: this.target.y });
  }
}, {});
