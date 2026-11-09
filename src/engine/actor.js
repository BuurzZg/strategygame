// An Actor is an id, an owner, a position and a bag of traits built from its ActorInfo.
const EMPTY = Object.freeze([]);

export class Actor {
  constructor(world, info, owner, init = {}) {
    this.world = world;
    this.info = info;
    this.owner = owner;
    this.id = world.nextActorId++;
    this.x = init.x | 0; this.y = init.y | 0;
    this.px = this.x; this.py = this.y;
    this.facing = (init.facing | 0) & 1023;
    this.pfacing = this.facing;
    this.init = init;
    this.dead = false;
    this.disposed = false;
    this.inWorld = false;
    this.activity = null;
    this.conditions = new Map();
    this.condTokens = new Map();
    this.nextToken = 1;
    // fast-path references filled in by traits
    this.health = null; this.mobile = null; this.building = null; this.turret = null; this.attack = null;

    this.traits = [];
    this.traitMap = new Map();
    for (const ti of info.traitInfos) {
      const t = new ti.T(this, ti);
      this.traits.push(t);
      if (!this.traitMap.has(ti.type)) this.traitMap.set(ti.type, []);
      this.traitMap.get(ti.type).push(t);
    }
    this.tickers = this.traits.filter((t) => t.tick);
    this.idlers = this.traits.filter((t) => t.idle);
    this.condTraits = this.traits.filter((t) => t.info._cond);
    for (const t of this.traits) if (t.created) t.created();
    this.updateConditions();
  }

  get type() { return this.info.name; }
  trait(type) { const l = this.traitMap.get(type); return l ? l[0] : null; }
  traitsOf(type) { return this.traitMap.get(type) || EMPTY; }
  enabledTrait(type) { const l = this.traitMap.get(type); if (l) for (const t of l) if (t.enabled) return t; return null; }
  has(type) { return this.traitMap.has(type); }
  notify(hook, arg) { for (const t of this.traits) if (t.enabled && t[hook]) t[hook](arg); }

  // ------------------------------------------------------------ conditions
  grantCondition(name) {
    const tok = this.nextToken++;
    this.condTokens.set(tok, name);
    this.conditions.set(name, (this.conditions.get(name) || 0) + 1);
    this.updateConditions();
    return tok;
  }
  revokeCondition(tok) {
    const name = this.condTokens.get(tok);
    if (name === undefined) return 0;
    this.condTokens.delete(tok);
    const n = (this.conditions.get(name) || 0) - 1;
    if (n <= 0) this.conditions.delete(name); else this.conditions.set(name, n);
    this.updateConditions();
    return 0;
  }
  updateConditions() {
    for (const t of this.condTraits) {
      const en = t.info._cond(this.conditions);
      if (en === t.enabled) continue;
      t.enabled = en;
      if (en) { if (t.enable) t.enable(); } else if (t.disable) t.disable();
    }
  }

  // ------------------------------------------------------------ activities
  queueActivity(act, queued = true) {
    if (!queued) this.cancelActivity();
    if (!this.activity) { this.activity = act; return; }
    let a = this.activity;
    while (a.next) a = a.next;
    a.next = act;
  }
  cancelActivity() { if (this.activity) this.activity.cancel(this); }
  get isIdle() { return !this.activity; }

  tick() {
    for (const t of this.tickers) if (t.enabled) t.tick();
    if (this.dead) return;
    if (this.activity) {
      if (this.activity.run(this)) this.activity = this.activity.next;
    } else for (const t of this.idlers) if (t.enabled) t.idle();
  }

  // Order targeting helpers
  isValidTarget() { return !this.dead && !this.disposed && this.inWorld && !!this.health; }
}
