import { defineTrait, Trait } from '../engine/traits.js';
import { makeOrder } from '../engine/order.js';
import { CELL, HALF, distSq } from '../engine/math.js';
import { FindAndDeliverResources } from '../activities/harvest.js';

const TICKS_PER_SECOND = 25;

// ---------------------------------------------------------------- the API mission scripts see
// Everything a script can do goes through here, and it all runs inside the deterministic
// simulation (scripts must never use Math.random or the clock; use m.rng).
class MissionAPI {
  constructor(world, runner) {
    this.world = world;
    this.runner = runner;
    this.rng = world.rng;
    this.difficulty = world.settings.difficulty || 'normal';
    this.state = {}; // scratch space for scripts
  }
  get frame() { return this.world.frame; }
  seconds(s) { return Math.round(s * TICKS_PER_SECOND); }
  minutes(m) { return Math.round(m * 60 * TICKS_PER_SECOND); }
  pick(easy, normal, hard) { return this.difficulty === 'easy' ? easy : this.difficulty === 'hard' ? hard : normal; }

  // ---- players and actors
  player(id) { const p = this.world.playerById(id); if (!p) throw new Error(`Mission: unknown player "${id}"`); return p; }
  get you() { return this.world.players.find((p) => p.slot.playable); }
  actor(name) { return this.world.named.get(name) || null; }
  alive(a) { return !!a && !a.dead && !a.disposed; }
  actors(owner, type) {
    const p = typeof owner === 'string' ? this.player(owner) : owner;
    return this.world.actors.filter((a) => a.owner === p && !a.dead && a.health && (!type || (Array.isArray(type) ? type.includes(a.type) : a.type === type)));
  }
  pos([x, y]) { return { x: Math.round(x * CELL), y: Math.round(y * CELL) }; }

  // ---- creating actors (cells: buildings use the top-left cell, units the cell centre)
  spawn(type, owner, [x, y], opts = {}) {
    const w = this.world, p = typeof owner === 'string' ? this.player(owner) : owner;
    const info = w.rules.actor(type);
    let a;
    if (info.has('Building')) a = w.createActor(type, p, { ci: Math.floor(x), cj: Math.floor(y), complete: opts.complete !== false });
    else {
      const pc = w.map.nearestPassable(Math.floor(x), Math.floor(y), 8) || [Math.floor(x), Math.floor(y)];
      a = w.createActor(type, p, { x: pc[0] * CELL + HALF, y: pc[1] * CELL + HALF, facing: opts.facing | 0 });
    }
    if (opts.name) w.named.set(opts.name, a);
    if (a.harvester && opts.harvest !== false) a.queueActivity(new FindAndDeliverResources(-1));
    if (opts.stance && a.trait('AutoTarget')) a.trait('AutoTarget').stance = opts.stance;
    return a;
  }
  // Units arrive at `from` and head to `to` (attack-moving by default).
  reinforce(owner, types, from, to, opts = {}) {
    const out = types.map((t, i) => this.spawn(t, owner, [from[0] + (i % 3) - 1, from[1] + Math.floor(i / 3)], { facing: opts.facing }));
    if (to) this.order(out, opts.attack === false ? 'Move' : 'AttackMove', this.pos(to));
    return out;
  }
  transfer(actors, owner) {
    const p = typeof owner === 'string' ? this.player(owner) : owner;
    for (const a of [].concat(actors)) if (this.alive(a)) this.world.changeOwner(a, p);
  }
  give(owner, cash) { (typeof owner === 'string' ? this.player(owner) : owner).resources.give(cash); }

  // ---- orders (issued as the actors' owner)
  order(actors, name, target, extra) {
    const list = [].concat(actors).filter((a) => this.alive(a));
    if (!list.length) return;
    const byOwner = new Map();
    for (const a of list) { if (!byOwner.has(a.owner)) byOwner.set(a.owner, []); byOwner.get(a.owner).push(a); }
    const t = target && target.id !== undefined && target.info ? { actor: target } : target;
    for (const [p, as] of byOwner) this.world.resolveOrder(makeOrder(name, as, t, extra), p);
  }
  move(actors, cell) { this.order(actors, 'Move', this.pos(cell)); }
  attackMove(actors, cell) { this.order(actors, 'AttackMove', this.pos(cell)); }
  attack(actors, target) { this.order(actors, 'Attack', target); }
  hold(actors) { this.order(actors, 'SetStance', null, 'Defend'); }

  // ---- triggers
  after(ticks, fn) { return this.runner.addTimer(ticks, fn, 0); }
  every(ticks, fn) { return this.runner.addTimer(ticks, fn, ticks); }
  when(test, fn) { return this.runner.addPoll(test, fn); }
  onKilled(actors, fn) { const list = [].concat(actors); return this.when(() => list.every((a) => !this.alive(a)), fn); }
  onEachKilled(actors, fn) { const set = new Set([].concat(actors)); this.world.on('killed', (a) => { if (set.has(a)) fn(a); }); }
  onEnter(cell, rangeCells, owner, fn) {
    const p = typeof owner === 'string' ? this.player(owner) : owner;
    const c = this.pos(cell), r = rangeCells * CELL;
    return this.when(() => this.world.unitsInCircle(c.x, c.y, r).some((a) => a.owner === p), () => fn());
  }
  // Structure finished weaving or unit produced.
  onBuilt(owner, type, fn) {
    const p = typeof owner === 'string' ? this.player(owner) : owner;
    const h = (a) => { if (a.owner === p && (!type || a.type === type)) fn(a); };
    this.world.on('built', h); this.world.on('produced', h);
  }
  near(cell, rangeCells, owner) {
    const p = typeof owner === 'string' ? this.player(owner) : owner;
    const c = this.pos(cell);
    return this.world.actorsInCircle(c.x, c.y, rangeCells * CELL).filter((a) => !p || a.owner === p);
  }

  // ---- objectives (for the playable player)
  objective(text, opts = {}) { return this.you.actor.trait('MissionObjectives').add(text, opts); }
  updateObjective(id, text) { this.you.actor.trait('MissionObjectives').setText(id, text); }
  complete(id) { this.you.actor.trait('MissionObjectives').set(id, 'done'); }
  fail(id) { this.you.actor.trait('MissionObjectives').set(id, 'failed'); }
  isDone(id) { return this.you.actor.trait('MissionObjectives').get(id)?.state === 'done'; }
  win() { this.you.actor.trait('MissionObjectives').finish('won'); }
  lose() { this.you.actor.trait('MissionObjectives').finish('lost'); }

  // ---- presentation (render-only events; safe in the simulation)
  say(speaker, text) { this.world.fx({ t: 'say', speaker, text, player: this.you.index }); }
  hint(text) { this.world.notify(this.you, text, 'info'); }
  focus(cell) { const c = this.pos(cell); this.world.fx({ t: 'focus', x: c.x, y: c.y, player: this.you.index }); }
  reveal(cell, rangeCells, ticks) {
    const c = this.pos(cell);
    const cam = this.world.createActor('camera', this.you, { x: c.x, y: c.y });
    cam.trait('RevealsShroud').info = { ...cam.trait('RevealsShroud').info, Range: rangeCells * CELL };
    if (ticks) this.after(ticks, () => this.world.removeActor(cam));
    return cam;
  }
  storm(y0, y1, ticks, warning = false) { this.world.fx({ t: 'storm', y0: y0 * CELL, y1: y1 * CELL, ticks, warning }); }
  // Damage every unit (any owner) in a horizontal band of rows. Structures are spared.
  damageBand(y0, y1, amount) {
    for (const a of this.world.actors) {
      if (!a.mobile || a.dead || !a.health) continue;
      const cy = a.y / CELL;
      if (cy >= y0 && cy <= y1) a.health.damage(null, amount, null);
    }
  }
}

// ---------------------------------------------------------------- world trait: runs the script
defineTrait('MissionScript', class MissionScript extends Trait {
  created() { this.timers = []; this.polls = []; this.api = null; this.script = null; }
  addTimer(ticks, fn, repeat) { const t = { at: this.world.frame + Math.max(1, ticks), fn, repeat, cancelled: false, cancel() { this.cancelled = true; } }; this.timers.push(t); return t; }
  addPoll(test, fn) { const p = { test, fn, done: false, cancel() { this.done = true; } }; this.polls.push(p); return p; }

  worldLoaded() {
    const w = this.world, def = w.mission;
    if (!def) throw new Error('MissionScript is enabled but no mission was loaded');
    this.script = def.script;
    this.api = new MissionAPI(w, this);
    for (const a of def.actors) {
      const owner = w.playerById(a.owner);
      if (!owner) throw new Error(`${def.id}: actor ${a.name || a.type} has unknown owner "${a.owner}"`);
      this.api.spawn(a.type, owner, [a.x, a.y], { name: a.name, facing: a.facing, complete: a.complete, stance: a.stance });
    }
    if (this.script.worldLoaded) this.script.worldLoaded(this.api);
  }

  tick() {
    const f = this.world.frame;
    for (let i = 0; i < this.timers.length; i++) {
      const t = this.timers[i];
      if (t.cancelled) { this.timers.splice(i--, 1); continue; }
      if (f < t.at) continue;
      if (t.repeat) t.at = f + t.repeat; else this.timers.splice(i--, 1);
      t.fn();
    }
    if (f % 5 === 0) {
      for (const p of this.polls.slice()) if (!p.done && p.test()) { p.done = true; p.fn(); }
      this.polls = this.polls.filter((p) => !p.done);
    }
    if (this.script.tick) this.script.tick(this.api);
  }
}, {});

// ---------------------------------------------------------------- player trait: objectives
defineTrait('MissionObjectives', class MissionObjectives extends Trait {
  created() { this.list = []; this.nextId = 1; this.self.owner.objectives = this; }
  add(text, opts = {}) {
    const o = { id: this.nextId++, text, primary: opts.primary !== false, state: 'active', deadline: opts.deadline ? this.world.frame + opts.deadline : 0, expire: opts.expire || 'fail' };
    this.list.push(o);
    this.world.fx({ t: 'objectives', player: this.self.owner.index, kind: 'new', text });
    return o.id;
  }
  get(id) { return this.list.find((o) => o.id === id); }
  setText(id, text) { const o = this.get(id); if (o) o.text = text; }
  set(id, state) {
    const o = this.get(id);
    if (!o || o.state !== 'active') return;
    o.state = state;
    this.world.fx({ t: 'objectives', player: this.self.owner.index, kind: state, text: o.text });
  }
  finish(outcome) {
    const me = this.self.owner, w = this.world;
    if (me.outcome) return;
    me.outcome = outcome;
    for (const p of w.players) if (p !== me && !p.outcome) p.outcome = me.isAlly(p) ? outcome : outcome === 'won' ? 'lost' : 'won';
    w.fx({ t: 'outcome', player: me.index, outcome });
    w.gameOver = true;
  }
  tick() {
    const w = this.world, me = this.self.owner;
    if (me.outcome || !me.slot.playable) return;
    for (const o of this.list) if (o.state === 'active' && o.deadline && w.frame >= o.deadline) this.set(o.id, o.expire === 'complete' ? 'done' : 'failed');
    // Missions add objectives in stages, so victory is declared by the script (m.win()).
    // Failing any primary objective, or losing everything, ends the mission automatically.
    if (this.list.some((o) => o.primary && o.state === 'failed')) { this.finish('lost'); return; }
    if (w.frame > 25 && w.frame % 25 === 0 && !w.actors.some((a) => a.owner === me && !a.dead && a.health)) this.finish('lost');
  }
}, {});
