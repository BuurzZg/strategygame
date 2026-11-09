import { Actor } from './actor.js';
import { Random } from './random.js';
import { PathFinder } from './pathfinder.js';
import { Player } from './player.js';
import { resolveOrder } from './order.js';
import { CELL, HALF, isqrt, distSq, hashMix } from './math.js';

// The simulation. Everything in here must be deterministic: integer state, seeded RNG,
// iteration in actor-id order. Rendering and UI only read from it, and only change it
// by sending Orders through the OrderManager.
export class World {
  // extras.mission: a loaded mission definition (map, actors, script) for campaign games.
  constructor(rules, map, settings, extras = {}) {
    this.rules = rules;
    this.map = map;
    this.settings = settings;
    this.mission = extras.mission || null;
    this.listeners = new Map();
    this.named = new Map();
    this.frame = 0;
    this.rng = new Random(settings.seed * 2654435761);
    this.nextActorId = 1;
    this.actors = [];
    this.actorById = new Map();
    this.traitIndex = new Map();
    this.effects = [];
    this.nextEffectId = 1;
    this.fxEvents = [];
    this.frameEndTasks = [];
    this.pathfinder = new PathFinder(map);
    this.pathBudget = 0;
    this.hashSize = 8 * CELL;
    this.unitHash = new Map();
    this.hashStamp = -1;
    this.gameOver = false;

    this.neutral = new Player(this, -1, { name: 'Neutral', faction: 'neutral', team: -1 });
    this.neutral.isNeutral = true;
    this.worldActor = new Actor(this, rules.actor('World'), this.neutral);
    this.factions = new Map(this.worldActor.traitsOf('Faction').map((f) => [f.info.InternalName, f.info]));

    this.players = settings.players.map((slot, i) => new Player(this, i, slot));
    for (const p of this.players) p.actor = new Actor(this, rules.actor('Player'), p);
    this.neutral.actor = null;

    for (const t of this.worldActor.traits) if (t.enabled && t.worldLoaded) t.worldLoaded();
    for (const p of this.players) for (const t of p.actor.traits) if (t.enabled && t.worldLoaded) t.worldLoaded();
    this.runFrameEndTasks();
  }

  // ------------------------------------------------------------ actors
  createActor(type, owner, init = {}) {
    const a = new Actor(this, this.rules.actor(type), owner, init);
    this.addActor(a);
    return a;
  }
  addActor(a) {
    this.actors.push(a);
    this.actorById.set(a.id, a);
    for (const t of a.traits) {
      const type = t.info.type;
      if (!this.traitIndex.has(type)) this.traitIndex.set(type, []);
      this.traitIndex.get(type).push(t);
    }
    a.inWorld = true;
    for (const t of a.traits) if (t.addedToWorld) t.addedToWorld();
    if (a.mobile) this.hashStamp = -1; // new unit: rebuild the spatial index on next query
  }
  removeActor(a) {
    if (a.disposed) return;
    a.inWorld = false;
    for (const t of a.traits) if (t.removedFromWorld) t.removedFromWorld();
    a.disposed = true;
    const i = this.actors.indexOf(a);
    if (i >= 0) this.actors.splice(i, 1);
    this.actorById.delete(a.id);
    for (const t of a.traits) {
      const list = this.traitIndex.get(t.info.type);
      const j = list.indexOf(t);
      if (j >= 0) list.splice(j, 1);
    }
  }
  // All live trait instances of a type, in actor-id order.
  traitsOfType(type) { return this.traitIndex.get(type) || []; }
  enabledTraits(type, owner) {
    const out = [];
    for (const t of this.traitsOfType(type)) if (t.enabled && !t.self.dead && (!owner || t.self.owner === owner)) out.push(t);
    return out;
  }
  addFrameEndTask(fn) { this.frameEndTasks.push(fn); }
  runFrameEndTasks() { while (this.frameEndTasks.length) { const list = this.frameEndTasks; this.frameEndTasks = []; for (const fn of list) fn(this); } }

  // Simulation events (deterministic; used by mission scripts): 'killed', 'built', 'produced'.
  on(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(fn); }
  emit(name, ...args) { const l = this.listeners.get(name); if (l) for (const fn of l.slice()) fn(...args); }

  playerById(id) { return this.players.find((p) => p.id === id) || (id === 'neutral' ? this.neutral : null); }

  // Hand an actor to another player (e.g. a rescued squad joining you).
  changeOwner(a, p) {
    if (a.dead || a.owner === p) return;
    const old = a.owner;
    a.cancelActivity();
    a.owner = p;
    if (a.building && p.index >= 0) a.building.seenBy |= 1 << p.index;
    for (const t of a.traits) if (t.ownerChanged) t.ownerChanged(old, p);
    this.emit('ownerChanged', a, old, p);
  }

  // Render-only event (explosions, beams, sounds, notifications). Never read by the simulation.
  fx(ev) { ev.frame = this.frame; this.fxEvents.push(ev); }
  notify(player, text, kind = 'info') { this.fx({ t: 'notify', player: player.index, text, kind }); }

  // ------------------------------------------------------------ spatial queries
  rebuildUnitHash() {
    this.hashStamp = this.frame;
    this.unitHash.clear();
    const s = this.hashSize;
    for (const a of this.actors) {
      if (!a.mobile || a.dead) continue;
      const k = Math.floor(a.x / s) * 4096 + Math.floor(a.y / s);
      let b = this.unitHash.get(k);
      if (!b) this.unitHash.set(k, (b = []));
      b.push(a);
    }
  }
  unitsInCircle(x, y, r, out = []) {
    if (this.hashStamp !== this.frame) this.rebuildUnitHash();
    out.length = 0;
    const s = this.hashSize, r2 = r * r;
    const x0 = Math.floor((x - r) / s), x1 = Math.floor((x + r) / s), y0 = Math.floor((y - r) / s), y1 = Math.floor((y + r) / s);
    for (let bx = x0; bx <= x1; bx++) for (let by = y0; by <= y1; by++) {
      const b = this.unitHash.get(bx * 4096 + by);
      if (b) for (const a of b) if (!a.dead && distSq(x, y, a.x, a.y) <= r2) out.push(a);
    }
    out.sort((a, b) => a.id - b.id);
    return out;
  }
  buildingsInCircle(x, y, r, out = []) {
    out.length = 0;
    const map = this.map, n = map.n;
    const i0 = Math.max(0, Math.floor((x - r) / CELL)), i1 = Math.min(n - 1, Math.floor((x + r) / CELL));
    const j0 = Math.max(0, Math.floor((y - r) / CELL)), j1 = Math.min(n - 1, Math.floor((y + r) / CELL));
    const seen = new Set();
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const id = map.bld[j * n + i];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const a = this.actorById.get(id);
      if (a && !a.dead && this.edgeDistPoint(x, y, a) <= r) out.push(a);
    }
    out.sort((a, b) => a.id - b.id);
    return out;
  }
  actorsInCircle(x, y, r) { return [...this.unitsInCircle(x, y, r), ...this.buildingsInCircle(x, y, r)]; }

  // Distance from a point to the edge of an actor (footprint for buildings, radius for units).
  edgeDistPoint(x, y, t) {
    if (t.building) {
      const b = t.building;
      const x0 = b.ci * CELL, y0 = b.cj * CELL, x1 = x0 + b.size * CELL, y1 = y0 + b.size * CELL;
      const cx = x < x0 ? x0 : x > x1 ? x1 : x, cy = y < y0 ? y0 : y > y1 ? y1 : y;
      return isqrt(distSq(x, y, cx, cy));
    }
    const d = isqrt(distSq(x, y, t.x, t.y)) - (t.health ? t.health.info.Radius : 0);
    return d < 0 ? 0 : d;
  }
  edgeDist(a, t) { return this.edgeDistPoint(a.x, a.y, t); }

  // Fog rules: units are visible while their cell is visible; structures once ever seen.
  canSee(player, t) {
    if (!player || player.isNeutral || t.owner === player || !player.shroud) return true;
    if (t.building) return (t.building.seenBy & (1 << player.index)) !== 0;
    return player.shroud.isVisible(t.x, t.y);
  }

  // ------------------------------------------------------------ construction rules
  fieldSources(player) { return this.enabledTraits('ProvidesField', player); }
  inField(player, x, y, sources) {
    for (const f of sources || this.fieldSources(player)) {
      const r = f.info.Range;
      if (distSq(x, y, f.self.x, f.self.y) <= r * r) return true;
    }
    return false;
  }
  canPlace(player, type, ci, cj) {
    const info = this.rules.actors.get(type);
    if (!info || !info.has('Building')) return 'Cannot place that';
    const s = info.traitInfo('Building').Footprint, map = this.map, n = map.n;
    for (let j = cj; j < cj + s; j++) for (let i = ci; i < ci + s; i++) {
      if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) return 'Out of bounds';
      const k = j * n + i;
      if (map.rock[k]) return 'Blocked by obsidian';
      if (map.bld[k]) return 'Blocked by a structure';
      if (map.resMax[k] > 0) return 'Cannot weave on a resonance vent';
    }
    const cx = ci * CELL + s * HALF, cy = cj * CELL + s * HALF;
    for (const v of map.vents) if (distSq(cx, cy, v.wx, v.wy) < (s * HALF + 1229) * (s * HALF + 1229)) return 'Cannot weave on a resonance vent';
    const missing = player.tech.missing(info.traitInfo('Buildable')?.Prerequisites || []);
    if (missing) return `Requires ${missing}`;
    if (info.traitInfo('Building').RequiresField && !this.inField(player, cx, cy)) return 'Outside the lattice field';
    return null;
  }

  // Spread a group across nearby free cells (BFS from the target cell).
  formation(units, x, y) {
    const map = this.map, n = map.n;
    const start = map.nearestPassable(map.cellOf(x), map.cellOf(y), 14);
    if (!start || units.length === 1) return units.map(() => [x, y]);
    const want = units.reduce((s, u) => s + (u.health.info.Radius > 1200 ? 2 : 1), 0);
    const goals = [], seen = new Set([start[1] * n + start[0]]), q = [start];
    for (let h = 0; h < q.length && goals.length < want; h++) {
      const [i, j] = q[h];
      goals.push([i * CELL + HALF, j * CELL + HALF]);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const a = i + di, b = j + dj, k = b * n + a;
        if (!seen.has(k) && map.passable(a, b)) { seen.add(k); q.push([a, b]); }
      }
    }
    const order = units.map((u, i) => i).sort((a, b) => (distSq(units[b].x, units[b].y, x, y) - distSq(units[a].x, units[a].y, x, y)) || (units[a].id - units[b].id));
    const used = new Array(goals.length).fill(false), out = new Array(units.length);
    for (const ui of order) {
      const u = units[ui];
      let best = -1, bd = Infinity;
      for (let g = 0; g < goals.length; g++) {
        if (used[g]) continue;
        const d = isqrt(distSq(goals[g][0], goals[g][1], u.x, u.y)) * 3 + isqrt(distSq(goals[g][0], goals[g][1], x, y)) * 10;
        if (d < bd) { bd = d; best = g; }
      }
      if (best < 0) out[ui] = [x, y]; else { used[best] = true; out[ui] = goals[best]; }
    }
    return out;
  }

  // ------------------------------------------------------------ tick
  resolveOrder(order, player) { resolveOrder(this, player, order); }

  tick() {
    if (this.gameOver) { this.frame++; return; }
    for (const a of this.actors) {
      a.px = a.x; a.py = a.y; a.pfacing = a.facing;
      if (a.turret) a.turret.pfacing = a.turret.facing;
    }
    this.pathBudget = 16;
    this.rebuildUnitHash();
    for (const t of this.worldActor.tickers) if (t.enabled) t.tick();
    for (const p of this.players) p.actor.tick();
    const list = this.actors.slice();
    for (const a of list) if (a.inWorld && !a.dead) a.tick();
    this.resolveCrowding();
    for (let i = 0; i < this.effects.length; i++) {
      const e = this.effects[i];
      if (e.tick(this)) { this.effects.splice(i, 1); i--; }
    }
    this.runFrameEndTasks();
    this.frame++;
  }

  // Push overlapping units apart. Idle units yield to moving allies.
  resolveCrowding() {
    const tmp = [];
    const map = this.map;
    for (const a of this.actors) {
      if (!a.mobile || a.dead) continue;
      const ra = a.health.info.Radius;
      this.unitsInCircle(a.x, a.y, ra + 1600, tmp);
      for (const b of tmp) {
        if (b.id <= a.id || !b.mobile || b.dead) continue;
        const rb = b.health.info.Radius;
        const min = ((ra + rb) * 85) / 100;
        const d2 = distSq(a.x, a.y, b.x, b.y);
        if (d2 >= min * min) continue;
        let d = isqrt(d2), ux, uy;
        if (d === 0) { ux = ((a.id * 37) % 7) - 3 || 1; uy = ((b.id * 53) % 7) - 3; d = isqrt(ux * ux + uy * uy); }
        else { ux = b.x - a.x; uy = b.y - a.y; }
        const push = (min - (d2 === 0 ? 0 : d)) >> 1;
        let wa = 50, wb = 50;
        if (a.owner === b.owner) {
          const am = a.mobile.movedFrame === this.frame, bm = b.mobile.movedFrame === this.frame;
          if (am && !bm) { wa = 15; wb = 85; } else if (bm && !am) { wa = 85; wb = 15; }
        }
        const ax = a.x - Math.trunc((ux * push * wa) / (d * 50)), ay = a.y - Math.trunc((uy * push * wa) / (d * 50));
        const bx = b.x + Math.trunc((ux * push * wb) / (d * 50)), by = b.y + Math.trunc((uy * push * wb) / (d * 50));
        if (map.passableAt(ax, ay)) { a.x = ax; a.y = ay; }
        if (map.passableAt(bx, by)) { b.x = bx; b.y = by; }
      }
    }
  }

  // A hash of the simulation state; compared between clients to detect desyncs.
  syncHash() {
    let h = hashMix(2166136261, this.frame);
    h = hashMix(h, this.rng.state);
    for (const a of this.actors) {
      h = hashMix(h, a.id); h = hashMix(h, a.x); h = hashMix(h, a.y); h = hashMix(h, a.facing);
      if (a.health) h = hashMix(h, a.health.hp);
    }
    for (const p of this.players) h = hashMix(h, p.resources ? p.resources.cash : 0);
    h = hashMix(h, this.effects.length);
    return h >>> 0;
  }
}
