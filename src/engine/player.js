// A participant in the match. Its behaviour lives in traits on its player actor
// (PlayerResources, SupplyManager, TechTree, Shroud, bot modules...), which register
// themselves here as fast references.
export class Player {
  constructor(world, index, slot) {
    this.world = world;
    this.index = index;
    this.name = slot.name || `Player ${index + 1}`;
    this.faction = slot.faction;
    this.team = slot.team ?? index;
    this.clientIndex = slot.client ?? -1;
    this.botType = slot.bot || null;
    this.spawn = slot.spawn ?? index;
    this.outcome = null; // 'won' | 'lost'
    this.isNeutral = false;
    this.actor = null;
    this.resources = null; this.supply = null; this.tech = null; this.shroud = null;
    this.stats = null; this.weavers = null;
  }
  get factionInfo() { return this.world.factions.get(this.faction); }
  get isBot() { return !!this.botType; }
  isEnemy(p) { return !!p && p !== this && !p.isNeutral && !this.isNeutral && p.team !== this.team; }
  isAlly(p) { return !!p && (p === this || (!p.isNeutral && p.team === this.team)); }
}
