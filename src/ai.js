import { CELL, UNITS, BUILDINGS, DIFFICULTY, SUPPLY_MAX } from './config.js';

// A straightforward economy-first bot: keep Skimmers saturated, never get supply
// blocked, expand by chaining pylons toward vents, tech to Bastions, attack in waves.
export class AI {
  constructor(world, team, difficulty) {
    this.w = world;
    this.team = team;
    this.d = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.t = 0;
    this.wave = 0;
    this.attacking = false;
    this.attackTarget = null;
    this.expandVent = null;
    this.mix = { needle: 0.22, warden: 0.48, mender: 0.1, bastion: 0.2 };
  }

  mine(filter) { return this.w.entities.filter((e) => e.alive && e.team === this.team && filter(e)); }
  count(type, inclConstruct = true) { return this.mine((e) => e.type === type && (inclConstruct || !e.constructing)).length; }

  update(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = this.d.think;
    const w = this.w, T = w.teams[this.team];
    if (T.defeated) return;
    const cores = this.mine((e) => e.type === 'core' && !e.constructing);
    const home = cores[0] || this.mine((e) => e.kind === 'building')[0];
    if (!home) return;
    const time = w.time;

    // ---------------- economy ----------------
    const drops = this.mine((e) => e.kind === 'building' && e.def.dropoff && !e.constructing).length;
    const skimmers = this.count('skimmer') + this.mine((e) => e.kind === 'building').reduce((s, b) => s + b.queue.filter((q) => q === 'skimmer').length, 0);
    const wantSkim = Math.min(16, drops * 4 + 1);
    if (skimmers < wantSkim) for (const c of cores) if (c.queue.length === 0) { w.enqueue(c, 'skimmer'); break; }

    // idle skimmers back to work
    for (const u of this.mine((e) => e.type === 'skimmer' && e.order.type === 'idle')) w.autoHarvest(u);

    // ---------------- construction ----------------
    const building = T.constructions.length;
    const foundries = this.count('foundry');
    const supplyRoom = T.supplyCap - T.supplyUsed;
    const pendingSupply = T.constructions.filter((b) => b.def.supply).length;
    if (building < 2) {
      if (supplyRoom < 6 + foundries * 2 && pendingSupply === 0 && T.supplyCap < SUPPLY_MAX) this.tryBuild('resonator', home);
      else if (foundries === 0 && T.res >= 200) this.tryBuild('foundry', home);
      else if (this.count('spire') < 1 && foundries > 0 && time > 150) this.tryBuild('spire', home, true);
      else if (this.count('uplink') === 0 && foundries > 0 && time > 220) this.tryBuild('uplink', home);
      else if (foundries < (this.d === DIFFICULTY.hard ? 4 : this.d === DIFFICULTY.easy ? 2 : 3) && time > 240 && T.res > 350) this.tryBuild('foundry', home);
      else if (time > 170 && this.count('siphon') < 2) this.expand(home);
      else if (this.count('spire') < 3 && time > 360 && T.res > 400) this.tryBuild('spire', home, true);
    }

    // ---------------- production ----------------
    const fs = this.mine((e) => e.type === 'foundry' && !e.constructing);
    for (const f of fs) {
      if (f.queue.length >= (T.res > 800 ? 4 : 2)) continue;
      const type = this.pickUnit();
      if (T.res >= UNITS[type].cost + (skimmers < wantSkim ? 50 : 0)) w.enqueue(f, type);
    }

    // ---------------- army ----------------
    const army = this.mine((e) => e.kind === 'unit' && e.type !== 'skimmer');
    const armySupply = army.reduce((s, u) => s + u.def.supply, 0);

    // defend
    const threatened = this.mine((e) => e.kind === 'building' && time - e.lastHit < 4)[0]
      || this.mine((e) => e.type === 'skimmer' && time - e.lastHit < 3)[0];
    if (threatened && !this.attacking) {
      const idle = army.filter((u) => u.order.type === 'idle' || u.order.type === 'move');
      if (idle.length) w.orderMove(idle, threatened.x, threatened.z, true);
    }

    const threshold = this.d.waveBase + this.wave * this.d.waveGrow;
    if (!this.attacking && time > this.d.firstWave && armySupply >= Math.min(threshold, T.supplyCap - 12)) {
      this.attacking = true;
      this.wave++;
      this.launch(army);
    } else if (this.attacking) {
      if (armySupply < threshold * 0.3) { this.attacking = false; this.regroup(army, home); }
      else {
        if (!this.attackTarget || !this.attackTarget.alive) this.launch(army);
        // stragglers and fresh units join
        const idle = army.filter((u) => u.order.type === 'idle');
        if (idle.length && this.attackTarget) w.orderMove(idle, this.attackTarget.x, this.attackTarget.z, true);
      }
    } else {
      // rally idle units at the front of the base
      const rally = this.rallyPoint(home);
      const loose = army.filter((u) => u.order.type === 'idle' && Math.hypot(u.x - rally.x, u.z - rally.z) > 14);
      if (loose.length) w.orderMove(loose, rally.x, rally.z, true);
      for (const f of fs) f.rally = rally;
    }
  }

  pickUnit() {
    const canBastion = this.w.owned(this.team, 'uplink');
    let r = Math.random() * (canBastion ? 1 : 1 - this.mix.bastion);
    for (const [k, v] of Object.entries(this.mix)) {
      if (k === 'bastion' && !canBastion) continue;
      r -= v;
      if (r <= 0) return k;
    }
    return 'warden';
  }

  rallyPoint(home) {
    const cx = this.w.map.n * CELL / 2;
    const dx = cx - home.x, dz = cx - home.z, d = Math.hypot(dx, dz) || 1;
    return { x: home.x + dx / d * 18, z: home.z + dz / d * 18 };
  }

  launch(army) {
    const w = this.w;
    const enemy = w.entities.filter((e) => e.alive && e.team !== this.team && e.kind === 'building');
    if (!enemy.length) return;
    const c = army.length ? army.reduce((a, u) => ({ x: a.x + u.x / army.length, z: a.z + u.z / army.length }), { x: 0, z: 0 }) : { x: 0, z: 0 };
    enemy.sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
    this.attackTarget = enemy[0];
    w.orderMove(army, this.attackTarget.x, this.attackTarget.z, true);
  }

  regroup(army, home) {
    const r = this.rallyPoint(home);
    this.w.orderMove(army, r.x, r.z, false);
    this.attackTarget = null;
  }

  // Find a valid footprint near an anchor, spiralling outwards, leaving a gap to keep lanes open.
  findSpot(type, ax, ay, minR = 3, maxR = 14, spread = true) {
    const w = this.w, def = BUILDINGS[type], s = def.size, map = w.map, n = map.n;
    const cands = [];
    for (let r = minR; r <= maxR; r++) {
      for (let k = 0; k < 16 + r * 4; k++) {
        const a = k / (16 + r * 4) * Math.PI * 2 + r * 0.7;
        const ci = Math.round(ax + Math.cos(a) * r - s / 2), cj = Math.round(ay + Math.sin(a) * r - s / 2);
        cands.push([ci, cj, r]);
      }
      if (cands.length > 400) break;
    }
    for (const [ci, cj] of cands) {
      if (w.canPlace(type, this.team, ci, cj)) continue;
      if (spread) {
        let ok = true;
        for (let j = cj - 1; j <= cj + s && ok; j++) for (let i = ci - 1; i <= ci + s && ok; i++) {
          if (!map.inBounds(i, j)) { ok = false; break; }
          if (map.bld[j * n + i] || map.rock[j * n + i]) ok = false;
        }
        if (!ok) continue;
      }
      return [ci, cj];
    }
    return null;
  }

  tryBuild(type, home, forward = false) {
    const w = this.w, T = w.teams[this.team];
    const def = BUILDINGS[type];
    if (T.res < def.cost) return false;
    let ax = home.ci + home.size / 2, ay = home.cj + home.size / 2;
    if (forward) { const r = this.rallyPoint(home); ax = (ax + r.x / CELL) / 2; ay = (ay + r.z / CELL) / 2; }
    const spot = this.findSpot(type, ax, ay, forward ? 1 : 4, 14);
    if (!spot) return false;
    return !w.build(type, this.team, spot[0], spot[1]);
  }

  // Chain pylons toward the nearest unclaimed vent, then drop a Siphon on it.
  expand(home) {
    const w = this.w, map = w.map;
    const T = w.teams[this.team];
    const drops = this.mine((e) => e.kind === 'building' && e.def.dropoff);
    if (!this.expandVent || drops.some((d) => Math.hypot(d.x / CELL - this.expandVent.x, d.z / CELL - this.expandVent.y) < 7)) {
      const cands = map.vents.filter((v) => {
        if (drops.some((d) => Math.hypot(d.x / CELL - v.x, d.z / CELL - v.y) < 8)) return false;
        if (w.entities.some((e) => e.alive && e.team !== this.team && e.kind === 'building' && Math.hypot(e.x / CELL - v.x, e.z / CELL - v.y) < 12)) return false;
        return v.cells.some((k) => map.res[k] > 50);
      });
      const hx = home.x / CELL, hy = home.z / CELL;
      cands.sort((a, b) => Math.hypot(a.x - hx, a.y - hy) - Math.hypot(b.x - hx, b.y - hy));
      this.expandVent = cands[0] || null;
    }
    const v = this.expandVent;
    if (!v) return;
    // siphon spot near the vent, inside the field?
    const spot = this.findSpot('siphon', v.x, v.y, 3, 6, false);
    if (spot) { if (T.res >= BUILDINGS.siphon.cost) w.build('siphon', this.team, spot[0], spot[1]); return; }
    if (T.res < BUILDINGS.pylon.cost) return;
    // place a pylon at the field edge closest to the vent
    const src = w.fieldSources(this.team);
    let best = null, bd = 1e9;
    for (const b of src) {
      const bx = b.ci + b.size / 2, by = b.cj + b.size / 2;
      const dx = v.x - bx, dy = v.y - by, d = Math.hypot(dx, dy) || 1;
      for (let r = b.def.field - 1; r >= 2; r--) {
        const ci = Math.round(bx + dx / d * r - 0.5), cj = Math.round(by + dy / d * r - 0.5);
        if (w.canPlace('pylon', this.team, ci, cj)) continue;
        const dd = Math.hypot(ci - v.x, cj - v.y);
        if (dd < bd) { bd = dd; best = [ci, cj]; }
        break;
      }
    }
    if (best && !T.constructions.some((c) => c.type === 'pylon')) w.build('pylon', this.team, best[0], best[1]);
  }
}
