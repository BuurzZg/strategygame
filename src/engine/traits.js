// Trait registry and base class.
//
// A trait is one piece of behaviour (Health, Mobile, Armament...). Its static configuration
// (the "info") comes from the YAML rules; its runtime state lives on the instance.
// Traits opt into engine hooks simply by defining the method:
//
//   created()                 all traits on the actor exist
//   addedToWorld() / removedFromWorld()
//   worldLoaded()             (world/player actors) after players and map are set up
//   tick()                    once per simulation tick while enabled
//   idle()                    the actor has no activity this tick
//   damaged({attacker, amount})
//   killed({attacker, recycled})
//   resolveOrder(order)       an order addressed to this actor
//   orderFor(target, mods)    UI asks "what would you do with this target?" -> {order, priority}
//   enable() / disable()      RequiresCondition changed
//
// Every trait accepts `RequiresCondition: <expr>`, e.g. `!weaving`, `bot && !bot-easy`.

export const TraitRegistry = new Map();
export const ProjectileRegistry = new Map();
export const WarheadRegistry = new Map();

export function defineTrait(name, cls, defaults = {}) {
  cls.traitName = name;
  cls.defaults = { RequiresCondition: '', ...defaults };
  TraitRegistry.set(name, cls);
  return cls;
}

export class Trait {
  constructor(self, info) {
    this.self = self;
    this.info = info;
    this.enabled = !info._cond;
  }
  get world() { return this.self.world; }
  get owner() { return this.self.owner; }
}

// ---------------------------------------------------------------- condition expressions
// Grammar: expr := or ; or := and ('||' and)* ; and := unary ('&&' unary)* ;
//          unary := '!' unary | '(' expr ')' | identifier
export function compileCondition(src, where = '') {
  const tokens = src.match(/\s*(\|\||&&|!|\(|\)|[A-Za-z0-9_.-]+)\s*/g);
  if (!tokens || tokens.join('').replace(/\s/g, '') !== src.replace(/\s/g, '')) throw new Error(`${where}: bad condition "${src}"`);
  const toks = tokens.map((t) => t.trim());
  let p = 0;
  const names = new Set();
  const peek = () => toks[p];
  const parseUnary = () => {
    const t = toks[p++];
    if (t === '!') { const f = parseUnary(); return (c) => !f(c); }
    if (t === '(') { const f = parseOr(); if (toks[p++] !== ')') throw new Error(`${where}: missing ) in "${src}"`); return f; }
    if (!t || /[|&()!]/.test(t)) throw new Error(`${where}: unexpected "${t}" in "${src}"`);
    names.add(t);
    return (c) => (c.get(t) || 0) > 0;
  };
  const parseAnd = () => { let f = parseUnary(); while (peek() === '&&') { p++; const a = f, b = parseUnary(); f = (c) => a(c) && b(c); } return f; };
  const parseOr = () => { let f = parseAnd(); while (peek() === '||') { p++; const a = f, b = parseAnd(); f = (c) => a(c) || b(c); } return f; };
  const fn = parseOr();
  if (p !== toks.length) throw new Error(`${where}: trailing tokens in "${src}"`);
  fn.names = names;
  return fn;
}
