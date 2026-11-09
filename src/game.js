import * as THREE from '../lib/three.module.js';
import { CELL, UNITS, BUILDINGS, DMG, SUPPLY_MAX, START_RES, FACTIONS, DIFFICULTY } from './config.js';
import { GameMap, buildTerrain, buildRocks, CrystalField } from './map.js';
import { PathFinder } from './path.js';
import { buildModel, selectionRing, buildingRadius } from './models.js';
import { Effects } from './effects.js';
import { Visibility, FogOverlay } from './fog.js';
import { AI } from './ai.js';

const TAU = Math.PI * 2;
function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
function turnToward(cur, target, maxStep) { const d = angDiff(cur, target); return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep; }

class SpatialHash {
  constructor(size) { this.size = size; this.map = new Map(); }
  clear() { this.map.clear(); }
  key(bx, bz) { return bx * 4096 + bz; }
  insert(e) {
    const k = this.key(Math.floor(e.x / this.size), Math.floor(e.z / this.size));
    let b = this.map.get(k); if (!b) this.map.set(k, (b = [])); b.push(e);
  }
  query(x, z, r, out) {
    out.length = 0;
    const s = this.size;
    const x0 = Math.floor((x - r) / s), x1 = Math.floor((x + r) / s), z0 = Math.floor((z - r) / s), z1 = Math.floor((z + r) / s);
    for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) {
      const b = this.map.get(this.key(bx, bz)); if (b) for (const e of b) out.push(e);
    }
    return out;
  }
}

let NEXT_ID = 1;

export class World {
  constructor(scene, opts) {
    this.scene = scene;
    this.opts = opts;
    this.seed = opts.seed;
    this.time = 0;
    this.map = new GameMap(opts.seed);
    this.pf = new PathFinder(this.map);
    this.fx = new Effects(scene);
    this.entities = [];
    this.byId = new Map();
    this.projectiles = [];
    this.events = [];
    this.hash = new SpatialHash(8);
    this.tmp = [];
    this.pathBudget = 0;
    this.listener = { x: 0, z: 0 };
    this.sfx = () => {};
    this.over = null;

    const pf = FACTIONS[opts.faction];
    const ef = FACTIONS[opts.faction === 'accord' ? 'combine' : 'accord'];
    const mkTeam = (id, faction, isPlayer) => ({
      id, faction, isPlayer, res: START_RES, supplyUsed: 0, supplyCap: 0, defeated: false,
      constructions: [], lastAlert: -99, alertPos: null, harvestMult: 1,
      stats: { unitsBuilt: 0, unitsLost: 0, kills: 0, structuresBuilt: 0, structuresLost: 0, harvested: 0 },
    });
    this.teams = [mkTeam(0, pf, true), mkTeam(1, ef, false)];
    this.player = this.teams[0];
    const diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    this.teams[1].harvestMult = diff.harvest;

    // terrain
    this.terrain = buildTerrain(this.map);
    scene.add(this.terrain);
    this.rocks = buildRocks(this.map);
    scene.add(this.rocks);
    this.crystals = new CrystalField(this.map, scene);
    this.vis = new Visibility(this.map);
    this.fog = new FogOverlay(this.terrain.geometry, this.vis);
    scene.add(this.fog.mesh);
    this.visT = 0;
    this.slowT = 0;

    // starting forces
    this.map.bases.forEach((b, t) => {
      const ci = Math.round(b.x - 1.5), cj = Math.round(b.y - 1.5);
      this.placeBuilding('core', t, ci, cj, true);
      const dir = t === 0 ? 1 : -1;
      for (let k = 0; k < 3; k++) {
        const u = this.spawnUnit('skimmer', t, (b.x + dir * (3 + k)) * CELL, (b.y + dir * 3.2) * CELL);
        this.autoHarvest(u);
      }
      this.spawnUnit('needle', t, (b.x + dir * 4) * CELL, (b.y - dir * 0.5) * CELL);
      this.spawnUnit('warden', t, (b.x - dir * 0.5) * CELL, (b.y + dir * 4.5) * CELL);
    });
    this.ai = new AI(this, 1, opts.difficulty);
    this.ai0 = opts.demo ? new AI(this, 0, 'normal') : null;
    this.updateSupply();
    this.updateVisibility(true);
  }

  // ------------------------------------------------------------ entities
  addEntity(e) { e.id = NEXT_ID++; this.entities.push(e); this.byId.set(e.id, e); return e; }

  spawnUnit(type, team, x, z) {
    const def = UNITS[type];
    const faction = this.teams[team].faction;
    const model = buildModel(type, faction);
    const e = {
      kind: 'unit', type, def, team, x, z, hp: def.hp, maxHp: def.hp, alive: true, radius: def.radius,
      facing: team === 0 ? 0.785 : 3.93, tf: 0, model, order: { type: 'idle' }, path: null, pi: 0, needPath: false,
      goalX: x, goalZ: z, vx: 0, vz: 0, desX: 0, desZ: 0, cd: Math.random() * 0.5, scanT: Math.random() * 0.3,
      engage: null, attacker: null, carry: 0, hv: null, stuckT: 0, stuckN: 0, lastX: x, lastZ: z, chaseT: 0,
      healT: 0, regenT: 0, lastHit: -99, born: this.time, selected: false,
    };
    e.tf = e.facing;
    const p = this.map.nearestPassable(this.map.cellOf(x), this.map.cellOf(z), 10);
    if (p && !this.map.passableAt(x, z)) { e.x = (p[0] + 0.5) * CELL; e.z = (p[1] + 0.5) * CELL; }
    e.ring = selectionRing(def.radius, team === 0);
    model.root.add(e.ring);
    model.baseY = model.body.position.y;
    this.scene.add(model.root);
    this.addEntity(e);
    this.syncModel(e, 0);
    return e;
  }

  placeBuilding(type, team, ci, cj, complete = false) {
    const def = BUILDINGS[type];
    const faction = this.teams[team].faction;
    const model = buildModel(type, faction);
    const s = def.size;
    const x = (ci + s / 2) * CELL, z = (cj + s / 2) * CELL;
    const e = {
      kind: 'building', type, def, team, x, z, ci, cj, size: s, alive: true, radius: buildingRadius(def),
      hp: complete ? def.hp : def.hp * 0.1, maxHp: def.hp, model, constructing: !complete, progress: complete ? 1 : 0,
      queue: [], prog: 0, rally: null, facing: 0, tf: team === 0 ? 0.785 : 3.93, cd: 0, scanT: 0, engage: null,
      seen: team === 0, lastHit: -99, selected: false,
    };
    let hy = -1e9;
    for (const [a, b] of [[ci, cj], [ci + s, cj], [ci, cj + s], [ci + s, cj + s]]) hy = Math.max(hy, this.map.heightAt(a * CELL, b * CELL));
    e.y = hy;
    model.root.position.set(x, hy, z);
    e.ring = selectionRing(e.radius, team === 0);
    model.root.add(e.ring);
    model.baseY = model.body.position.y;
    this.scene.add(model.root);
    this.addEntity(e);
    const n = this.map.n;
    for (let j = cj; j < cj + s; j++) for (let i = ci; i < ci + s; i++) this.map.bld[j * n + i] = e.id;
    // shove units out of the footprint
    for (const u of this.entities) {
      if (u.kind !== 'unit' || !u.alive) continue;
      const ui = this.map.cellOf(u.x), uj = this.map.cellOf(u.z);
      if (ui >= ci && ui < ci + s && uj >= cj && uj < cj + s) {
        const p = this.map.nearestPassable(ui, uj, 8);
        if (p) { u.x = (p[0] + 0.5) * CELL; u.z = (p[1] + 0.5) * CELL; if (u.path) u.needPath = true; }
      }
    }
    if (!complete) this.teams[team].constructions.push(e);
    this.syncModel(e, 0);
    return e;
  }

  // ------------------------------------------------------------ rules helpers
  owned(team, type, completeOnly = true) {
    return this.entities.some((e) => e.alive && e.team === team && e.type === type && (!completeOnly || !e.constructing));
  }
  requirementsMet(team, def) {
    return !def.requires || def.requires.every((r) => this.owned(team, r));
  }
  missingRequirement(team, def) {
    if (!def.requires) return null;
    const m = def.requires.find((r) => !this.owned(team, r));
    return m ? BUILDINGS[m].name : null;
  }
  fieldSources(team) {
    return this.entities.filter((e) => e.alive && e.team === team && e.kind === 'building' && e.def.field && !e.constructing);
  }
  inField(team, cx, cy, sources) {
    sources = sources || this.fieldSources(team);
    for (const b of sources) {
      const bx = b.ci + b.size / 2, by = b.cj + b.size / 2;
      if (Math.hypot(cx - bx, cy - by) <= b.def.field) return true;
    }
    return false;
  }
  canPlace(type, team, ci, cj) {
    const def = BUILDINGS[type];
    const s = def.size, map = this.map, n = map.n;
    for (let j = cj; j < cj + s; j++) for (let i = ci; i < ci + s; i++) {
      if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) return 'Out of bounds';
      const k = j * n + i;
      if (map.rock[k]) return 'Blocked by obsidian';
      if (map.bld[k]) return 'Blocked by a structure';
      if (map.resMax[k] > 0) return 'Cannot weave on a resonance vent';
    }
    const cx = ci + s / 2, cy = cj + s / 2;
    for (const v of map.vents) if (Math.hypot(cx - v.x, cy - v.y) < s / 2 + 1.2) return 'Cannot weave on a resonance vent';
    const miss = this.missingRequirement(team, def);
    if (miss) return `Requires ${miss}`;
    if (!this.inField(team, cx, cy)) return 'Outside the lattice field';
    return null;
  }

  updateSupply() {
    for (const t of this.teams) { t.supplyCap = 0; t.supplyUsed = 0; }
    for (const e of this.entities) {
      if (!e.alive) continue;
      const t = this.teams[e.team];
      if (e.kind === 'unit') t.supplyUsed += e.def.supply;
      else {
        if (!e.constructing && e.def.supply) t.supplyCap += e.def.supply;
        for (const q of e.queue) t.supplyUsed += UNITS[q].supply;
      }
    }
    for (const t of this.teams) t.supplyCap = Math.min(SUPPLY_MAX, t.supplyCap);
  }

  // ------------------------------------------------------------ commands
  build(type, team, ci, cj) {
    const def = BUILDINGS[type];
    const T = this.teams[team];
    const err = this.canPlace(type, team, ci, cj);
    if (err) return err;
    if (T.res < def.cost) return 'Not enough resonance';
    T.res -= def.cost;
    this.placeBuilding(type, team, ci, cj, false);
    if (team === 0) this.sfx('place', (ci + def.size / 2) * CELL, (cj + def.size / 2) * CELL);
    return null;
  }

  enqueue(b, type) {
    const def = UNITS[type];
    const T = this.teams[b.team];
    if (!b.alive || b.constructing) return 'Structure is still being woven';
    if (!b.def.produces || !b.def.produces.includes(type)) return 'Cannot build that here';
    const miss = this.missingRequirement(b.team, def);
    if (miss) return `Requires ${miss}`;
    if (b.queue.length >= 5) return 'Queue is full';
    this.updateSupply();
    if (T.supplyUsed + def.supply > T.supplyCap) return T.supplyCap >= SUPPLY_MAX ? 'Supply limit reached' : 'Supply capped: weave a Resonator';
    if (T.res < def.cost) return 'Not enough resonance';
    T.res -= def.cost;
    b.queue.push(type);
    this.updateSupply();
    return null;
  }
  dequeue(b, index = b.queue.length - 1) {
    if (index < 0 || index >= b.queue.length) return;
    const type = b.queue.splice(index, 1)[0];
    this.teams[b.team].res += UNITS[type].cost;
    if (index === 0) b.prog = 0;
    this.updateSupply();
  }

  recycle(e) {
    if (!e.alive || e.kind !== 'building') return;
    const T = this.teams[e.team];
    const refund = Math.round(e.def.cost * (e.constructing ? 0.75 : 0.4) * (e.hp / e.maxHp));
    for (const q of e.queue) T.res += UNITS[q].cost;
    e.queue.length = 0;
    T.res += refund;
    this.kill(e, null, true);
  }

  setGoal(u, x, z) { u.goalX = x; u.goalZ = z; u.needPath = true; u.path = null; u.stuckN = 0; u.stuckT = 0; }

  // Spread a group across nearby free cells.
  formation(units, x, z) {
    const map = this.map, n = map.n;
    let start = map.nearestPassable(map.cellOf(x), map.cellOf(z), 14);
    if (!start) return units.map(() => [x, z]);
    const goals = [];
    const seen = new Set([start[1] * n + start[0]]);
    const q = [start];
    let h = 0;
    const want = units.reduce((s, u) => s + (u.def.radius > 1.2 ? 2 : 1), 0);
    while (h < q.length && goals.length < want) {
      const [i, j] = q[h++];
      goals.push([(i + 0.5) * CELL, (j + 0.5) * CELL]);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const a = i + di, b = j + dj, k = b * n + a;
        if (!seen.has(k) && map.passable(a, b)) { seen.add(k); q.push([a, b]); }
      }
    }
    if (units.length === 1) return [[x, z]];
    const out = new Array(units.length);
    const used = new Array(goals.length).fill(false);
    const order = units.map((u, i) => i).sort((a, b) => Math.hypot(units[b].x - x, units[b].z - z) - Math.hypot(units[a].x - x, units[a].z - z));
    for (const ui of order) {
      const u = units[ui];
      let best = -1, bd = 1e9;
      for (let g = 0; g < goals.length; g++) {
        if (used[g]) continue;
        const d = Math.hypot(goals[g][0] - u.x, goals[g][1] - u.z) * 0.3 + Math.hypot(goals[g][0] - x, goals[g][1] - z);
        if (d < bd) { bd = d; best = g; }
      }
      if (best < 0) { out[ui] = [x, z]; continue; }
      used[best] = true; out[ui] = goals[best];
    }
    return out;
  }

  orderMove(units, x, z, attackMove = false) {
    units = units.filter((u) => u.alive && u.kind === 'unit');
    const goals = this.formation(units, x, z);
    units.forEach((u, i) => {
      u.order = attackMove && u.def.weapon ? { type: 'amove', x: goals[i][0], z: goals[i][1] } : { type: 'move' };
      u.engage = null; u.attacker = null;
      this.setGoal(u, goals[i][0], goals[i][1]);
    });
  }
  orderAttack(units, target) {
    for (const u of units) {
      if (!u.alive || u.kind !== 'unit') continue;
      if (!u.def.weapon) { this.orderMove([u], target.x, target.z); continue; }
      u.order = { type: 'attack', target };
      u.engage = null; u.path = null; u.needPath = false; u.chaseT = 0;
    }
  }
  orderStop(units, hold = false) {
    for (const u of units) {
      if (!u.alive || u.kind !== 'unit') continue;
      u.order = { type: hold ? 'hold' : 'idle' };
      u.path = null; u.needPath = false; u.engage = null; u.attacker = null;
    }
  }
  orderHarvest(units, cell) {
    for (const u of units) {
      if (!u.alive || u.type !== 'skimmer') continue;
      u.order = { type: 'harvest' };
      u.hv = { state: 'go', cell, drop: null, t: 0, tries: 0 };
      const n = this.map.n;
      this.setGoal(u, ((cell % n) + 0.5) * CELL, (((cell / n) | 0) + 0.5) * CELL);
    }
  }
  orderReturn(units) {
    for (const u of units) {
      if (!u.alive || u.type !== 'skimmer') continue;
      const cell = u.hv ? u.hv.cell : -1;
      u.order = { type: 'harvest' };
      u.hv = { state: u.carry > 0 ? 'return' : 'seek', cell, drop: null, t: 0, tries: 0 };
    }
  }
  autoHarvest(u) { u.order = { type: 'harvest' }; u.hv = { state: 'seek', cell: -1, drop: null, t: 0, tries: 0 }; }

  // ------------------------------------------------------------ queries
  edgeDist(a, t) {
    const d = Math.hypot(t.x - a.x, t.z - a.z);
    return t.kind === 'building' ? Math.max(0, d - t.size * CELL * 0.5) : Math.max(0, d - t.radius * 0.6);
  }
  canSee(team, t) {
    if (team !== 0) return true;
    if (t.team === 0) return true;
    return t.kind === 'building' ? t.seen : this.vis.visible(t.x, t.z);
  }
  acquire(u, radius) {
    let best = null, bs = 1e9;
    for (const e of this.entities) {
      if (!e.alive || e.team === u.team) continue;
      const d = this.edgeDist(u, e);
      if (d > radius) continue;
      if (!this.canSee(u.team, e)) continue;
      let s = d;
      if (e.kind === 'building') s += e.def.weapon ? 4 : 12;
      else if (!e.def.weapon) s += 3;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }
  dropoffs(team) {
    return this.entities.filter((e) => e.alive && e.team === team && e.kind === 'building' && e.def.dropoff && !e.constructing);
  }
  entityAtCell(i, j) {
    const id = this.map.bld[j * this.map.n + i];
    return id ? this.byId.get(id) : null;
  }

  // ------------------------------------------------------------ combat
  fire(src, t, w) {
    const ang = Math.atan2(t.z - src.z, t.x - src.x);
    const baseY = src.kind === 'building' ? src.y : this.map.heightAt(src.x, src.z);
    const fwd = src.kind === 'building' ? 0.6 : 0.9;
    const mx = src.x + Math.cos(ang) * fwd, mz = src.z + Math.sin(ang) * fwd, my = baseY + (w.muzzleY || 1);
    const ty = (t.kind === 'building' ? t.y + 1.5 : this.map.heightAt(t.x, t.z) + 1.0);
    const col = this.teams[src.team].faction.glow;
    this.fx.muzzle(mx, my, mz, col);
    if (w.proj === 'beam') {
      this.fx.beam(new THREE.Vector3(mx, my, mz), new THREE.Vector3(t.x, ty, t.z), col, src.kind === 'building' ? 0.22 : 0.14);
      this.fx.sparks(t.x, ty, t.z, col, 5, 5);
      this.damage(t, w.dmg, w.type, src);
    } else if (w.proj === 'bolt') {
      const m = this.fx.getProjectileMesh(col);
      m.scale.set(1, 1, 1);
      this.projectiles.push({ kind: 'bolt', mesh: m, x: mx, y: my, z: mz, target: t, tx: t.x, ty, tz: t.z, speed: w.speed, w, src, team: src.team });
    } else if (w.proj === 'shell') {
      const m = this.fx.getProjectileMesh(col);
      m.scale.set(1.8, 1.8, 1.8);
      const spread = Math.min(1.5, this.edgeDist(src, t) * 0.06);
      const tx = t.x + (Math.random() - 0.5) * spread, tz = t.z + (Math.random() - 0.5) * spread;
      const dist = Math.hypot(tx - mx, tz - mz);
      this.projectiles.push({ kind: 'shell', mesh: m, x0: mx, y0: my, z0: mz, tx, tz, ty: this.map.heightAt(tx, tz), t: 0, dur: Math.max(0.4, dist / w.speed), arc: 2 + dist * 0.35, w, src, team: src.team });
    }
    this.sfx(w.type, mx, mz);
  }

  damage(t, amount, wtype, src) {
    if (!t.alive) return;
    const mult = DMG[wtype] ? DMG[wtype][t.def.armor] : 1;
    t.hp -= amount * mult;
    t.lastHit = this.time;
    if (src && src.alive && src.team !== t.team && t.kind === 'unit') t.attacker = src;
    const T = this.teams[t.team];
    if (src && src.team !== t.team && (t.kind === 'building' || t.type === 'skimmer') && this.time - T.lastAlert > 12) {
      T.lastAlert = this.time; T.alertPos = { x: t.x, z: t.z };
      if (T.isPlayer) { this.events.push({ type: 'alert', text: t.kind === 'building' ? 'Our structures are under attack' : 'Skimmers under attack', x: t.x, z: t.z }); this.sfx('alert', t.x, t.z, true); }
    }
    if (t.hp <= 0) this.kill(t, src);
  }

  kill(e, src, recycled = false) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    const T = this.teams[e.team];
    const big = e.kind === 'building';
    const y = big ? e.y : this.map.heightAt(e.x, e.z);
    if (recycled) {
      for (let i = 0; i < 30; i++) this.fx.weave(e.x, y, e.z, e.radius * Math.random(), T.faction.glow);
      this.fx.ring(e.x, y, e.z, e.radius * 2, T.faction.glow, 0.6);
    } else {
      this.fx.explosion(e.x, y, e.z, big ? 1.4 + e.size * 0.4 : 0.5 + e.radius * 0.5, big ? 0xffa060 : this.teams[e.team].faction.glow);
      this.sfx(big ? 'collapse' : 'explode', e.x, e.z);
    }
    if (e.kind === 'unit') T.stats.unitsLost++; else if (!recycled) T.stats.structuresLost++;
    if (src && !recycled) this.teams[src.team].stats.kills++;
    if (big) {
      const n = this.map.n;
      for (let j = e.cj; j < e.cj + e.size; j++) for (let i = e.ci; i < e.ci + e.size; i++) if (this.map.bld[j * n + i] === e.id) this.map.bld[j * n + i] = 0;
      const ix = T.constructions.indexOf(e); if (ix >= 0) T.constructions.splice(ix, 1);
      if (T.isPlayer && !recycled) this.events.push({ type: 'msg', text: `${e.def.name} destroyed`, kind: 'bad' });
    }
    this.scene.remove(e.model.root);
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      let done = false;
      if (p.kind === 'bolt') {
        if (p.target.alive) { p.tx = p.target.x; p.tz = p.target.z; p.ty = p.target.kind === 'building' ? p.target.y + 1.5 : this.map.heightAt(p.tx, p.tz) + 1; }
        const dx = p.tx - p.x, dy = p.ty - p.y, dz = p.tz - p.z, d = Math.hypot(dx, dy, dz);
        const step = p.speed * dt;
        if (d <= step) {
          done = true;
          if (p.target.alive) this.damage(p.target, p.w.dmg, p.w.type, p.src.alive ? p.src : null);
          this.fx.sparks(p.tx, p.ty, p.tz, this.teams[p.team].faction.glow, 4, 4);
        } else { p.x += dx / d * step; p.y += dy / d * step; p.z += dz / d * step; }
        p.mesh.position.set(p.x, p.y, p.z);
      } else {
        p.t += dt / p.dur;
        const t = Math.min(1, p.t);
        const x = p.x0 + (p.tx - p.x0) * t, z = p.z0 + (p.tz - p.z0) * t;
        const y = p.y0 + (p.ty - p.y0) * t + p.arc * 4 * t * (1 - t);
        p.mesh.position.set(x, y, z);
        if (Math.random() < 0.6) this.fx.smoke.spawn(x, y, z, 0, 0.3, 0, 0.5, 0.5, 1.2, new THREE.Color(0x3a3048), 0.4);
        if (t >= 1) {
          done = true;
          this.fx.explosion(p.tx, p.ty, p.tz, 0.8, this.teams[p.team].faction.glow);
          this.sfx('impact', p.tx, p.tz);
          const r = p.w.splash || 2;
          for (const e of this.entities) {
            if (!e.alive || e.team === p.team) continue;
            const d = e.kind === 'building' ? Math.max(0, Math.hypot(e.x - p.tx, e.z - p.tz) - e.size * CELL * 0.5) : Math.hypot(e.x - p.tx, e.z - p.tz);
            if (d < r) this.damage(e, p.w.dmg * (1 - 0.6 * d / r), p.w.type, p.src.alive ? p.src : null);
          }
        }
      }
      if (done) { this.fx.releaseProjectileMesh(p.mesh); this.projectiles.splice(i, 1); }
    }
  }

  // ------------------------------------------------------------ unit behaviour
  // Advance along the current path; sets desired velocity. Returns 'arrived' | 'moving' | 'waiting'.
  moveAlong(u) {
    if (u.needPath) {
      if (this.pathBudget <= 0) return 'waiting';
      this.pathBudget--;
      u.path = this.pf.find(u.x, u.z, u.goalX, u.goalZ);
      u.pi = 0; u.needPath = false;
      if (!u.path) return 'arrived';
    }
    if (!u.path) return 'arrived';
    const last = u.pi >= u.path.length - 1;
    const [wx, wz] = u.path[u.pi];
    const dx = wx - u.x, dz = wz - u.z, d = Math.hypot(dx, dz);
    if (d < (last ? 0.4 : 1.1)) {
      u.pi++;
      if (u.pi >= u.path.length) { u.path = null; return 'arrived'; }
      return 'moving';
    }
    let sp = u.def.speed;
    if (last && d < 2) sp *= Math.max(0.35, d / 2);
    u.desX = dx / d * sp; u.desZ = dz / d * sp;
    // stuck detection
    u.stuckT += this.dt;
    if (u.stuckT > 1.2) {
      const moved = Math.hypot(u.x - u.lastX, u.z - u.lastZ);
      u.lastX = u.x; u.lastZ = u.z; u.stuckT = 0;
      if (moved < 0.6) {
        u.stuckN++;
        const toGoal = Math.hypot(u.goalX - u.x, u.goalZ - u.z);
        if (toGoal < 3 + u.stuckN || u.stuckN > 5) { u.path = null; return 'arrived'; }
        if (u.stuckN >= 2) u.needPath = true;
      } else u.stuckN = 0;
    }
    return 'moving';
  }

  engage(u, t, chase) {
    const w = u.def.weapon;
    if (!w) return;
    const d = this.edgeDist(u, t);
    const ang = Math.atan2(t.z - u.z, t.x - u.x);
    if (d <= w.range) {
      u.path = null; u.needPath = false;
      let aimed;
      if (u.def.turret) { u.tf = turnToward(u.tf, ang, 5 * this.dt); aimed = Math.abs(angDiff(u.tf, ang)) < 0.2; }
      else { u.facing = turnToward(u.facing, ang, 8 * this.dt); aimed = Math.abs(angDiff(u.facing, ang)) < 0.3; }
      if (w.minRange && d < w.minRange) return;
      if (u.cd <= 0 && aimed) { this.fire(u, t, w); u.cd = w.cd * (0.95 + Math.random() * 0.1); }
    } else if (chase) {
      u.chaseT -= this.dt;
      if ((!u.path && !u.needPath) || (u.chaseT <= 0 && Math.hypot(t.x - u.goalX, t.z - u.goalZ) > 1.5)) {
        u.goalX = t.x; u.goalZ = t.z; u.needPath = true; u.chaseT = 0.9;
      }
      this.moveAlong(u);
    }
  }

  updateUnit(u, dt) {
    u.desX = 0; u.desZ = 0;
    u.cd -= dt;
    u.scanT -= dt;
    const scan = u.scanT <= 0;
    if (scan) u.scanT = 0.3 + Math.random() * 0.1;
    if (u.def.heal) this.menderTick(u, dt);
    if (u.attacker && (!u.attacker.alive || this.time - u.lastHit > 4)) u.attacker = null;
    const o = u.order;
    const w = u.def.weapon;

    switch (o.type) {
      case 'move': {
        if (this.moveAlong(u) === 'arrived') u.order = { type: 'idle' };
        break;
      }
      case 'attack': {
        const t = o.target;
        if (!t.alive || !this.canSee(u.team, t)) { u.order = { type: 'idle' }; u.path = null; break; }
        this.engage(u, t, true);
        break;
      }
      case 'amove': {
        if (u.engage && (!u.engage.alive || !this.canSee(u.team, u.engage) || this.edgeDist(u, u.engage) > u.def.sight + 3)) { u.engage = null; this.setGoal(u, o.x, o.z); }
        if (!u.engage && scan) {
          const t = this.acquire(u, u.def.sight) || (u.attacker && u.attacker.alive ? u.attacker : null);
          if (t) { u.engage = t; u.path = null; u.needPath = false; u.chaseT = 0; }
        }
        if (u.engage) this.engage(u, u.engage, true);
        else if (this.moveAlong(u) === 'arrived') u.order = { type: 'idle' };
        break;
      }
      case 'idle':
      case 'hold': {
        const hold = o.type === 'hold';
        if (w) {
          if (u.engage && (!u.engage.alive || !this.canSee(u.team, u.engage))) u.engage = null;
          if (u.engage && hold && this.edgeDist(u, u.engage) > w.range) u.engage = null;
          if (!u.engage && scan) {
            const t = this.acquire(u, hold ? w.range : u.def.sight) || (!hold && u.attacker && u.attacker.alive ? u.attacker : null);
            if (t) { u.engage = t; if (!hold) { u.leashX = u.x; u.leashZ = u.z; } u.path = null; u.needPath = false; u.chaseT = 0; }
          }
          if (u.engage) {
            if (!hold && u.leashX !== undefined && Math.hypot(u.x - u.leashX, u.z - u.leashZ) > 14) {
              u.engage = null; u.attacker = null;
              u.order = { type: 'move' }; this.setGoal(u, u.leashX, u.leashZ);
            } else this.engage(u, u.engage, !hold);
          } else if (u.path || u.needPath) this.moveAlong(u);
        } else if (u.def.heal && !hold) {
          if (scan && !u.path && !u.needPath) {
            const t = this.damagedAlly(u, u.def.sight, u.def.heal.range * 0.8);
            if (t) this.setGoal(u, t.x, t.z);
          }
          if (u.path || u.needPath) {
            const t = this.damagedAlly(u, u.def.heal.range * 0.7, -1);
            if (t) { u.path = null; u.needPath = false; } else this.moveAlong(u);
          }
        } else if (u.path || u.needPath) this.moveAlong(u);
        break;
      }
      case 'harvest': this.harvestTick(u, dt); break;
    }

    // lattice field regen
    u.regenT -= dt;
    if (u.regenT <= 0) {
      u.regenT = 1;
      if (u.hp < u.maxHp && this.time - u.lastHit > 5 && this.inField(u.team, u.x / CELL, u.z / CELL, this.fieldCache[u.team])) u.hp = Math.min(u.maxHp, u.hp + 3);
    }
  }

  damagedAlly(u, radius, minDist) {
    let best = null, bs = 1e9;
    for (const e of this.hash.query(u.x, u.z, radius, this.tmp)) {
      if (e === u || !e.alive || e.team !== u.team || e.hp >= e.maxHp) continue;
      const d = Math.hypot(e.x - u.x, e.z - u.z);
      if (d > radius || d < minDist) continue;
      const s = e.hp / e.maxHp + d * 0.02;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  menderTick(u, dt) {
    u.healT -= dt;
    if (u.healT > 0) return;
    u.healT = 0.35;
    const t = this.damagedAlly(u, u.def.heal.range, -1);
    if (!t) return;
    t.hp = Math.min(t.maxHp, t.hp + u.def.heal.rate * 0.35);
    const y0 = this.map.heightAt(u.x, u.z) + 1.5, y1 = this.map.heightAt(t.x, t.z) + 1;
    this.fx.beam(new THREE.Vector3(u.x, y0, u.z), new THREE.Vector3(t.x, y1, t.z), 0x7dffa6, 0.07, 0.3);
    this.fx.heal(t.x, y1, t.z);
    u.facing = turnToward(u.facing, Math.atan2(t.z - u.z, t.x - u.x), 1);
  }

  findResCell(u, near) {
    const map = this.map, n = map.n;
    const drops = this.dropoffs(u.team);
    const claims = this.claims;
    let best = -1, bs = 1e9;
    const consider = (k) => {
      if (map.res[k] < 12) return;
      const x = ((k % n) + 0.5) * CELL, z = (((k / n) | 0) + 0.5) * CELL;
      let dd = 1e9;
      for (const d of drops) dd = Math.min(dd, Math.hypot(d.x - x, d.z - z));
      const s = Math.hypot(x - u.x, z - u.z) + dd * 0.6 + (claims.get(k) || 0) * 9 - map.res[k] * 0.004;
      if (s < bs) { bs = s; best = k; }
    };
    if (near >= 0 && map.ventOf[near] >= 0) {
      for (const k of map.vents[map.ventOf[near]].cells) consider(k);
      if (best >= 0 && bs < 60) return best;
    }
    for (const v of map.vents) for (const k of v.cells) consider(k);
    return best;
  }

  harvestTick(u, dt) {
    const hv = u.hv, map = this.map, n = map.n;
    const T = this.teams[u.team];
    switch (hv.state) {
      case 'seek': {
        if (u.carry >= u.def.carry * 0.6) { hv.state = 'return'; break; }
        hv.t -= dt;
        if (hv.t > 0) break;
        const k = this.findResCell(u, hv.cell);
        if (k < 0) { hv.t = 2; if (u.carry > 0) hv.state = 'return'; break; }
        hv.cell = k; hv.state = 'go'; hv.tries = 0;
        this.setGoal(u, ((k % n) + 0.5) * CELL, (((k / n) | 0) + 0.5) * CELL);
        break;
      }
      case 'go': {
        if (map.res[hv.cell] < 1) { hv.state = 'seek'; hv.t = 0; break; }
        const r = this.moveAlong(u);
        const cx = ((hv.cell % n) + 0.5) * CELL, cz = (((hv.cell / n) | 0) + 0.5) * CELL;
        const d = Math.hypot(cx - u.x, cz - u.z);
        if (d < 1.4) { hv.state = 'gather'; u.path = null; u.needPath = false; }
        else if (r === 'arrived') {
          if (d < 3) { hv.state = 'gather'; }
          else if (++hv.tries > 2) { hv.state = 'seek'; hv.t = 1; this.claims.set(hv.cell, 99); }
          else this.setGoal(u, cx, cz);
        }
        break;
      }
      case 'gather': {
        const k = hv.cell;
        const cx = ((k % n) + 0.5) * CELL, cz = (((k / n) | 0) + 0.5) * CELL;
        u.facing = turnToward(u.facing, Math.atan2(cz - u.z, cx - u.x), 3 * dt);
        const amt = Math.min(u.def.harvestRate * T.harvestMult * dt, map.res[k], u.def.carry - u.carry);
        map.res[k] -= amt; u.carry += amt; map.resDirty = true;
        if (Math.random() < 0.5) this.fx.siphon(cx, map.heightAt(cx, cz) + 0.5, cz, u.x, map.heightAt(u.x, u.z) + 1.2, u.z, 0xff7cbc);
        if (u.carry >= u.def.carry - 0.01) { hv.state = 'return'; break; }
        if (map.res[k] < 1) {
          let best = -1, bd = 1e9;
          const ci = k % n, cj = (k / n) | 0;
          for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
            const kk = (cj + dj) * n + ci + di;
            if (kk < 0 || kk >= n * n || map.res[kk] < 12) continue;
            const s = di * di + dj * dj + (this.claims.get(kk) || 0) * 6;
            if (s < bd) { bd = s; best = kk; }
          }
          if (best >= 0) { hv.cell = best; hv.state = 'go'; hv.tries = 0; this.setGoal(u, ((best % n) + 0.5) * CELL, (((best / n) | 0) + 0.5) * CELL); }
          else { hv.state = 'seek'; hv.t = 0; }
        }
        break;
      }
      case 'return': {
        const drops = this.dropoffs(u.team);
        if (!drops.length) { hv.t = 2; hv.state = 'seek'; break; }
        let best = null, bd = 1e9;
        for (const d of drops) { const dd = Math.hypot(d.x - u.x, d.z - u.z); if (dd < bd) { bd = dd; best = d; } }
        hv.drop = best; hv.state = 'toDrop'; hv.tries = 0;
        this.setGoal(u, best.x, best.z);
        break;
      }
      case 'toDrop': {
        const d = hv.drop;
        if (!d.alive) { hv.state = 'return'; break; }
        const r = this.moveAlong(u);
        if (this.edgeDist(u, d) < 1.8) { hv.state = 'unload'; hv.t = 0.6; u.path = null; u.needPath = false; }
        else if (r === 'arrived') { if (++hv.tries > 3) { hv.state = 'return'; } else this.setGoal(u, d.x, d.z); }
        break;
      }
      case 'unload': {
        hv.t -= dt;
        if (hv.t <= 0) {
          const amt = Math.round(u.carry);
          T.res += amt; T.stats.harvested += amt; u.carry = 0;
          hv.state = 'seek'; hv.t = 0;
          if (T.isPlayer) this.sfx('deposit', u.x, u.z);
        }
        break;
      }
    }
  }

  integrate(u, dt) {
    const def = u.def;
    const accel = def.hover ? 6 : 10;
    const k = Math.min(1, dt * accel);
    let dx = u.desX, dz = u.desZ;
    const want = Math.hypot(dx, dz);
    if (want > 0.01) {
      const ang = Math.atan2(dz, dx);
      const turn = def.id === 'bastion' ? 2.6 : def.hover ? 7 : 5;
      u.facing = turnToward(u.facing, ang, turn * dt);
      if (!def.hover) {
        const f = Math.max(0, Math.cos(angDiff(u.facing, ang)));
        dx *= 0.25 + 0.75 * f; dz *= 0.25 + 0.75 * f;
      }
      if (!def.turret) u.tf = u.facing;
    }
    u.vx += (dx - u.vx) * k; u.vz += (dz - u.vz) * k;
    if (Math.abs(u.vx) + Math.abs(u.vz) < 0.001) return;
    const nx = u.x + u.vx * dt, nz = u.z + u.vz * dt;
    const map = this.map;
    if (map.passableAt(nx, nz)) { u.x = nx; u.z = nz; }
    else if (map.passableAt(nx, u.z)) { u.x = nx; u.vz *= 0.5; }
    else if (map.passableAt(u.x, nz)) { u.z = nz; u.vx *= 0.5; }
    else { u.vx *= -0.2; u.vz *= -0.2; }
  }

  separate() {
    const tmp = this.tmp;
    const map = this.map;
    for (const a of this.units) {
      this.hash.query(a.x, a.z, a.radius + 1.5, tmp);
      for (const b of tmp) {
        if (b.id <= a.id || !b.alive) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const min = (a.radius + b.radius) * 0.85;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) * 0.5;
        const ux = d2 > 0 ? dx / d : Math.random() - 0.5, uz = d2 > 0 ? dz / d : Math.random() - 0.5;
        const aMoving = Math.abs(a.desX) + Math.abs(a.desZ) > 0.1, bMoving = Math.abs(b.desX) + Math.abs(b.desZ) > 0.1;
        let wa = 0.5, wb = 0.5;
        if (a.team === b.team) {
          if (aMoving && !bMoving) { wa = 0.15; wb = 0.85; } else if (bMoving && !aMoving) { wa = 0.85; wb = 0.15; }
        }
        const ax = a.x - ux * push * wa * 2, az = a.z - uz * push * wa * 2;
        const bx = b.x + ux * push * wb * 2, bz = b.z + uz * push * wb * 2;
        if (map.passableAt(ax, az)) { a.x = ax; a.z = az; }
        if (map.passableAt(bx, bz)) { b.x = bx; b.z = bz; }
      }
    }
  }

  // ------------------------------------------------------------ buildings
  updateBuildings(dt) {
    for (const T of this.teams) {
      const cores = this.entities.filter((e) => e.alive && e.team === T.id && e.type === 'core' && !e.constructing).length;
      const slots = Math.max(1, cores);
      let active = 0;
      for (const b of T.constructions.slice()) {
        if (!b.alive) continue;
        if (active >= slots) { b.waiting = true; continue; }
        active++;
        b.waiting = false;
        const rate = cores ? 1 : 0.5;
        b.progress += dt / b.def.time * rate;
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * dt / b.def.time * rate);
        if (Math.random() < dt * 14) this.fx.weave(b.x, b.y + 0.2, b.z, b.radius * 0.9, T.faction.glow);
        if (b.progress >= 1) {
          b.progress = 1; b.constructing = false;
          T.constructions.splice(T.constructions.indexOf(b), 1);
          T.stats.structuresBuilt++;
          this.fx.ring(b.x, b.y, b.z, b.radius * 2.5, T.faction.glow, 0.7);
          if (T.isPlayer) { this.events.push({ type: 'msg', text: `${b.def.name} woven`, kind: 'good' }); this.sfx('complete', b.x, b.z, true); }
          if (b.def.freeUnit) {
            const p = this.exitPoint(b);
            const u = this.spawnUnit(b.def.freeUnit, T.id, p[0], p[1]);
            this.autoHarvest(u);
          }
        }
      }
    }
    for (const b of this.entities) {
      if (!b.alive || b.kind !== 'building' || b.constructing) continue;
      // production
      if (b.queue.length) {
        const type = b.queue[0];
        b.prog += dt;
        if (b.prog >= UNITS[type].time) {
          const p = this.exitPoint(b);
          if (p) {
            b.queue.shift(); b.prog = 0;
            const u = this.spawnUnit(type, b.team, p[0], p[1]);
            this.teams[b.team].stats.unitsBuilt++;
            if (b.team === 0) this.sfx('ready', b.x, b.z, true);
            this.updateSupply();
            this.dispatchNew(u, b);
          } else b.prog = UNITS[type].time;
        }
      }
      // defensive weapon
      const w = b.def.weapon;
      if (w) {
        b.cd -= dt; b.scanT -= dt;
        if (b.engage && (!b.engage.alive || this.edgeDist(b, b.engage) > w.range)) b.engage = null;
        if (!b.engage && b.scanT <= 0) { b.scanT = 0.3; b.engage = this.acquire(b, w.range); }
        if (b.engage) {
          const ang = Math.atan2(b.engage.z - b.z, b.engage.x - b.x);
          b.tf = turnToward(b.tf, ang, 4 * dt);
          if (b.cd <= 0 && Math.abs(angDiff(b.tf, ang)) < 0.2) { this.fire(b, b.engage, w); b.cd = w.cd; }
        } else b.tf += dt * 0.3;
      }
    }
  }

  dispatchNew(u, b) {
    const r = b.rally;
    const n = this.map.n;
    if (u.type === 'skimmer') {
      if (r) {
        const k = this.map.cellOf(r.z) * n + this.map.cellOf(r.x);
        if (this.map.res[k] > 1) { this.orderHarvest([u], k); return; }
      }
      this.autoHarvest(u);
      return;
    }
    if (r) {
      if (r.target && r.target.alive && r.target.team !== u.team) this.orderAttack([u], r.target);
      else this.orderMove([u], r.x, r.z, false);
    }
  }

  exitPoint(b) {
    const map = this.map, s = b.size;
    const tx = b.rally ? b.rally.x : map.n * CELL / 2, tz = b.rally ? b.rally.z : map.n * CELL / 2;
    let best = null, bd = 1e9;
    for (let ring = 1; ring <= 3 && !best; ring++) {
      for (let j = b.cj - ring; j < b.cj + s + ring; j++) for (let i = b.ci - ring; i < b.ci + s + ring; i++) {
        if (i >= b.ci && i < b.ci + s && j >= b.cj && j < b.cj + s) continue;
        if (!map.passable(i, j)) continue;
        const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL;
        const d = Math.hypot(x - tx, z - tz);
        if (d < bd) { bd = d; best = [x, z]; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------ visibility
  updateVisibility(force = false) {
    const sources = [];
    for (const e of this.entities) if (e.alive && e.team === 0) sources.push({ x: e.x, z: e.z, sight: e.def.sight * (e.constructing ? 0.6 : 1) });
    if (this.opts.reveal) this.vis.revealAll(); else this.vis.recompute(sources);
    for (const e of this.entities) {
      if (!e.alive || e.team === 0) continue;
      if (e.kind === 'unit') e.model.root.visible = this.vis.visible(e.x, e.z);
      else {
        if (!e.seen && this.vis.visible(e.x, e.z)) e.seen = true;
        e.model.root.visible = e.seen;
      }
    }
    if (force) this.fog.update(1, true);
  }

  // ------------------------------------------------------------ main loop
  update(dt) {
    if (this.over) return;
    this.dt = dt;
    this.time += dt;
    this.pathBudget = 14;

    this.units = this.entities.filter((e) => e.alive && e.kind === 'unit');
    this.hash.clear();
    for (const u of this.units) this.hash.insert(u);
    this.fieldCache = [this.fieldSources(0), this.fieldSources(1)];
    this.claims = new Map();
    for (const u of this.units) if (u.hv && (u.hv.state === 'go' || u.hv.state === 'gather')) this.claims.set(u.hv.cell, (this.claims.get(u.hv.cell) || 0) + 1);

    this.updateBuildings(dt);
    for (const u of this.units) if (u.alive) this.updateUnit(u, dt);
    for (const u of this.units) if (u.alive) this.integrate(u, dt);
    this.separate();
    this.updateProjectiles(dt);

    this.slowT -= dt;
    if (this.slowT <= 0) {
      this.slowT = 1;
      this.map.regrow(1);
      this.updateSupply();
      this.checkVictory();
    }
    this.visT -= dt;
    if (this.visT <= 0) { this.visT = 0.2; this.updateVisibility(); }

    this.ai.update(dt);
    if (this.ai0) this.ai0.update(dt);

    if (this.entities.length > 400 || this.time % 5 < dt) {
      this.entities = this.entities.filter((e) => e.alive || (this.byId.delete(e.id), false));
    }
  }

  checkVictory() {
    for (const T of this.teams) {
      if (T.defeated) continue;
      const alive = this.entities.some((e) => e.alive && e.team === T.id && e.kind === 'building');
      if (!alive) {
        T.defeated = true;
        for (const e of this.entities) if (e.alive && e.team === T.id) this.kill(e, null);
      }
    }
    if (this.player.defeated) this.over = 'defeat';
    else if (this.teams[1].defeated) this.over = 'victory';
  }

  // ------------------------------------------------------------ rendering sync
  syncModel(e, t) {
    const m = e.model;
    if (e.kind === 'unit') {
      m.root.position.set(e.x, this.map.heightAt(e.x, e.z), e.z);
      m.body.rotation.y = -e.facing;
      if (m.turret) m.turret.rotation.y = -(e.tf - e.facing);
      if (m.bob) m.body.position.y = m.baseY + Math.sin(t * 3 + e.id) * m.bob;
      if (m.spin) m.spin.rotation.z = t * 2;
      if (m.cargo) m.cargo.visible = e.carry > 1;
      if (e.def.id === 'warden' && (Math.abs(e.vx) + Math.abs(e.vz) > 0.3)) m.body.position.y = Math.abs(Math.sin(t * 9 + e.id)) * 0.12;
    } else {
      const p = e.constructing ? e.progress : 1;
      m.body.scale.y = 0.08 + 0.92 * p;
      if (m.turret) m.turret.rotation.y = -e.tf;
      if (m.spin && !e.constructing) {
        if (e.type === 'uplink') m.spin.rotation.y = t * 0.4;
        else m.spin.rotation.y = t * 0.8;
      }
    }
    e.ring.visible = e.selected;
  }

  render(t, dt) {
    for (const e of this.entities) if (e.alive) this.syncModel(e, t);
    this.crystals.update();
    this.crystals.animate(t);
    this.fog.update(dt);
    this.fx.update(dt);
  }

  dispose() {
    this.scene.clear();
  }
}
