import { defineTrait, Trait } from '../engine/traits.js';

// ---------------------------------------------------------------- info-only traits
// These carry data the UI, renderer or other traits read; they have no behaviour.
defineTrait('Tooltip', class extends Trait {}, { Name: '', Role: '', Description: '' });
defineTrait('Valued', class extends Trait {}, { Cost: 0 });
defineTrait('Buildable', class extends Trait {}, { Queue: [], BuildDuration: 250, Prerequisites: [], Hotkey: '', BuildPaletteOrder: 0 });
defineTrait('ConsumesSupply', class extends Trait {}, { Amount: 1 });
defineTrait('Selectable', class extends Trait {}, { Radius: 700, Priority: 10 });
defineTrait('WithModel', class extends Trait {}, { Model: '', Bob: 0 });
defineTrait('HiddenUnderFog', class extends Trait {}, {});
defineTrait('FrozenUnderFog', class extends Trait {}, {});
defineTrait('Armor', class extends Trait {}, { Type: 'none' });
defineTrait('RevealsShroud', class extends Trait {}, { Range: 5120 });

// World traits
defineTrait('Faction', class extends Trait {}, { InternalName: '', Name: '', Color: 'ffffff', Glow: 'ffffff', Dark: '000000', Description: '' });
defineTrait('Locomotor', class extends Trait {}, { Name: '', TerrainSpeeds: {} });

// ---------------------------------------------------------------- Health
defineTrait('Health', class Health extends Trait {
  created() {
    this.hp = this.info.HP;
    this.maxHp = this.info.HP;
    this.lastDamaged = -100000;
    this.self.health = this;
  }
  get fraction() { return this.hp / this.maxHp; }

  damage(attacker, amount, byPlayer) {
    const self = this.self;
    if (self.dead || amount <= 0) return;
    this.hp -= amount;
    this.lastDamaged = self.world.frame;
    const ev = { attacker, amount, by: byPlayer };
    self.notify('damaged', ev);
    const pa = self.owner.actor;
    if (pa) for (const t of pa.traits) if (t.enabled && t.actorDamaged) t.actorDamaged(self, ev);
    if (this.hp <= 0) { this.hp = 0; this.kill(attacker, byPlayer); }
  }

  heal(amount) { if (!this.self.dead) this.hp = Math.min(this.maxHp, this.hp + amount); }

  kill(attacker, byPlayer, recycled = false) {
    const self = this.self, world = self.world;
    if (self.dead) return;
    self.dead = true;
    self.cancelActivity();
    self.activity = null;
    self.notify('killed', { attacker, by: byPlayer, recycled });
    if (self.owner.stats) self.owner.stats.actorLost(self, recycled);
    if (byPlayer && byPlayer !== self.owner && byPlayer.stats) byPlayer.stats.kills++;
    world.fx({ t: 'killed', actor: self.id, type: self.type, x: self.x, y: self.y, owner: self.owner.index, building: !!self.building, size: self.building ? self.building.size : 0, recycled });
    world.emit('killed', self, attacker, byPlayer);
    world.addFrameEndTask((w) => w.removeActor(self));
  }
}, { HP: 10000, Radius: 512 });
