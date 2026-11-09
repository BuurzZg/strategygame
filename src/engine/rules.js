import { parseYaml, mergeFiles, resolveInheritance } from './miniyaml.js';
import { TraitRegistry, ProjectileRegistry, WarheadRegistry, compileCondition } from './traits.js';
import { parseWDist } from './math.js';

export const RULE_FILES = ['rules/world.yaml', 'rules/player.yaml', 'rules/defaults.yaml', 'rules/units.yaml', 'rules/structures.yaml'];
export const WEAPON_FILES = ['rules/weapons.yaml'];

// Parse a field value according to the type of its default.
function parseField(def, node, where) {
  const v = node.value;
  if (typeof def === 'number') return parseWDist(v);
  if (typeof def === 'boolean') {
    if (v === 'true' || v === 'True') return true;
    if (v === 'false' || v === 'False') return false;
    throw new Error(`${where}: expected true/false, got "${v}"`);
  }
  if (Array.isArray(def)) return v === '' ? [] : v.split(',').map((s) => s.trim()).filter(Boolean);
  if (def && typeof def === 'object') {
    const out = {};
    for (const c of node.nodes) out[c.key] = /^-?\d+(c\d+)?$/.test(c.value) ? parseWDist(c.value) : c.value;
    return out;
  }
  return v;
}

function loadInfo(defaults, node, where) {
  const info = {};
  for (const [k, d] of Object.entries(defaults)) info[k] = Array.isArray(d) ? d.slice() : d && typeof d === 'object' ? { ...d } : d;
  for (const c of node.nodes) {
    if (!(c.key in defaults)) throw new Error(`${c.loc}: unknown field "${c.key}" on ${where}`);
    info[c.key] = parseField(defaults[c.key], c, c.loc);
  }
  return info;
}

export class ActorInfo {
  constructor(name, nodes) {
    this.name = name;
    this.traitInfos = [];
    this.byType = new Map();
    for (const node of nodes) {
      const [type, instance = ''] = node.key.split('@');
      const T = TraitRegistry.get(type);
      if (!T) throw new Error(`${node.loc}: unknown trait "${type}" on actor "${name}"`);
      const info = loadInfo(T.defaults, node, `${name}.${node.key}`);
      info.type = type; info.instance = instance; info.T = T; info.actor = name;
      if (info.RequiresCondition) info._cond = compileCondition(info.RequiresCondition, node.loc);
      this.traitInfos.push(info);
      if (!this.byType.has(type)) this.byType.set(type, []);
      this.byType.get(type).push(info);
    }
  }
  has(type) { return this.byType.has(type); }
  traitInfo(type) { const l = this.byType.get(type); return l ? l[0] : null; }
  traitInfosOf(type) { return this.byType.get(type) || []; }
}

export class WeaponInfo {
  constructor(name, nodes) {
    this.name = name;
    this.ReloadDelay = 25; this.Range = 4096; this.MinRange = 0; this.Report = ''; this.Burst = 1;
    this.projectile = null; this.warheads = [];
    for (const n of nodes) {
      const [key] = n.key.split('@');
      if (key === 'Projectile') {
        const P = ProjectileRegistry.get(n.value);
        if (!P) throw new Error(`${n.loc}: unknown projectile "${n.value}"`);
        this.projectile = { ...loadInfo(P.defaults, n, `${name}.Projectile`), type: n.value, P };
      } else if (key === 'Warhead') {
        const W = WarheadRegistry.get(n.value);
        if (!W) throw new Error(`${n.loc}: unknown warhead "${n.value}"`);
        this.warheads.push({ ...loadInfo(W.defaults, n, `${name}.Warhead`), type: n.value, W });
      } else if (key in this && key !== 'projectile' && key !== 'warheads' && key !== 'name') {
        this[key] = typeof this[key] === 'number' ? parseWDist(n.value) : n.value;
      } else throw new Error(`${n.loc}: unknown weapon field "${n.key}"`);
    }
    if (!this.projectile) throw new Error(`Weapon ${name} has no Projectile`);
  }
}

export class Rules {
  constructor(ruleTexts, weaponTexts) {
    const defs = resolveInheritance(mergeFiles(ruleTexts.map(([f, t]) => parseYaml(t, f))));
    this.actors = new Map();
    for (const [name, nodes] of defs) this.actors.set(name, new ActorInfo(name, nodes));
    const wdefs = mergeFiles(weaponTexts.map(([f, t]) => parseYaml(t, f)));
    this.weapons = new Map();
    for (const [name, node] of wdefs) this.weapons.set(name, new WeaponInfo(name, node.nodes));
    this.lint();
  }
  actor(name) {
    const a = this.actors.get(name);
    if (!a) throw new Error(`Unknown actor type "${name}"`);
    return a;
  }
  // Cross-reference checks so typos fail at load time, not mid-game.
  lint() {
    for (const a of this.actors.values()) {
      for (const arm of a.traitInfosOf('Armament')) if (!this.weapons.has(arm.Weapon)) throw new Error(`${a.name}: unknown weapon "${arm.Weapon}"`);
      const b = a.traitInfo('Buildable');
      if (b) for (const p of b.Prerequisites) if (!p.startsWith('~') && !this.actors.has(p)) throw new Error(`${a.name}: unknown prerequisite "${p}"`);
    }
  }
  // Actors that can be built from a given production queue type, in palette order.
  buildablesFor(queueType) {
    const out = [];
    for (const a of this.actors.values()) { const b = a.traitInfo('Buildable'); if (b && b.Queue.includes(queueType)) out.push(a); }
    return out.sort((x, y) => x.traitInfo('Buildable').BuildPaletteOrder - y.traitInfo('Buildable').BuildPaletteOrder);
  }
}

// Load rules with any text reader (fetch in the browser, fs in Node).
export async function loadRules(readText) {
  const read = async (files) => Promise.all(files.map(async (f) => [f, await readText(f)]));
  return new Rules(await read(RULE_FILES), await read(WEAPON_FILES));
}
