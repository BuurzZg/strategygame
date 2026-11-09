import { defineTrait, Trait } from '../engine/traits.js';
import { CELL } from '../engine/math.js';
import { FindAndDeliverResources } from '../activities/harvest.js';

// Developer commands, enabled by the `dev` game setting (single player and spectating).
// They arrive as world orders, so they are deterministic, replayable and multiplayer-safe:
//   { n: 'Dev', w: 1, x: { cmd: 'cash', player: 0, amount: 5000 } }
defineTrait('DeveloperMode', class DeveloperMode extends Trait {
  created() { this.fast = new Set(); }
  enable() { this.world.dev = this; }
  disable() { if (this.world.dev === this) this.world.dev = null; }
  isFast(player) { return !!player && this.fast.has(player.index); }

  resolveOrder(o) {
    if (o.name !== 'Dev' || !o.extra) return;
    const w = this.world, x = o.extra;
    const P = (i) => w.players[i];
    const actors = (ids) => (ids || []).map((id) => w.actorById.get(id)).filter((a) => a && !a.dead);
    switch (x.cmd) {
      case 'cash': if (P(x.player)) P(x.player).resources.give(x.amount | 0); break;
      case 'fastbuild': if (x.on) this.fast.add(x.player); else this.fast.delete(x.player); break;
      case 'spawn': {
        const p = x.player === -1 ? w.neutral : P(x.player);
        const info = w.rules.actors.get(x.type);
        if (!p || !info) break;
        for (let i = 0; i < Math.min(20, x.count || 1); i++) {
          const cx = Math.floor(x.x / CELL) + (i % 4), cy = Math.floor(x.y / CELL) + Math.floor(i / 4);
          let a;
          if (info.has('Building')) a = w.createActor(x.type, p, { ci: cx, cj: cy, complete: true });
          else {
            const pc = w.map.nearestPassable(cx, cy, 8);
            if (!pc) continue;
            a = w.createActor(x.type, p, { x: pc[0] * CELL + 512, y: pc[1] * CELL + 512 });
          }
          if (a.harvester) a.queueActivity(new FindAndDeliverResources(-1));
        }
        break;
      }
      case 'kill': for (const a of actors(x.ids)) if (a.health) a.health.kill(null, null); break;
      case 'damage': for (const a of actors(x.ids)) if (a.health) a.health.damage(null, Math.trunc(a.health.maxHp / 4), null); break;
      case 'heal': for (const a of actors(x.ids)) if (a.health) a.health.heal(a.health.maxHp); break;
      case 'transfer': { const p = x.player === -1 ? w.neutral : P(x.player); if (p) for (const a of actors(x.ids)) w.changeOwner(a, p); break; }
      case 'autopilot': { const p = P(x.player); const g = p && p.actor.trait('GrantBotConditions'); if (g) g.setAutopilot(x.bot || null); break; }
      case 'win': case 'lose': {
        const p = P(x.player);
        if (!p || p.outcome) break;
        if (p.objectives && p.objectives.enabled) { p.objectives.finish(x.cmd === 'win' ? 'won' : 'lost'); break; }
        const losers = x.cmd === 'win' ? w.players.filter((q) => p.isEnemy(q)) : [p];
        for (const q of losers) q.actor.trait('ConquestVictoryConditions')?.lose();
        break;
      }
    }
    w.fx({ t: 'dev', cmd: x.cmd });
  }
}, {});
