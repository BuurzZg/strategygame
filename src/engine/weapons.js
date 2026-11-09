import { ProjectileRegistry, WarheadRegistry } from './traits.js';
import { isqrt, distSq } from './math.js';

// Weapons are data: a Projectile that carries the shot, and Warheads applied on impact.
//
//   Lens:
//   	ReloadDelay: 27
//   	Range: 3c768
//   	Projectile: InstantHit
//   	Warhead@damage: SpreadDamage
//   		Damage: 2100
//   		Versus:
//   			medium: 125

export function fireWeapon(world, firer, armament, target) {
  const weapon = armament.weapon;
  const args = { world, weapon, firer, owner: firer.owner, sx: firer.x, sy: firer.y, target, tx: target.x, ty: target.y, muzzle: armament.info.MuzzleHeight };
  world.fx({ t: 'muzzle', actor: firer.id, weapon: weapon.name, height: armament.info.MuzzleHeight });
  if (weapon.Report) world.fx({ t: 'sound', name: weapon.Report, x: firer.x, y: firer.y });
  weapon.projectile.P.launch(args, weapon.projectile);
}

export function applyWarheads(args, x, y, directTarget) {
  for (const wh of args.weapon.warheads) wh.W.apply(args, wh, x, y, directTarget);
}

// ---------------------------------------------------------------- projectiles
function defineProjectile(name, P, defaults) { P.defaults = { ...defaults }; ProjectileRegistry.set(name, P); }

// Hits immediately. Beam: true draws a beam from muzzle to target.
defineProjectile('InstantHit', {
  launch(args, info) {
    const { world, target } = args;
    if (info.Beam) world.fx({ t: 'beam', from: args.firer.id, to: target.id, x0: args.sx, y0: args.sy, x1: target.x, y1: target.y, width: info.Width, owner: args.owner.index, muzzle: args.muzzle });
    applyWarheads(args, target.x, target.y, target);
  },
}, { Beam: true, Width: 14 });

// Homing bolt that follows its target.
defineProjectile('Bolt', {
  launch(args, info) {
    const { world } = args;
    world.effects.push({
      id: world.nextEffectId++, kind: 'bolt', owner: args.owner.index, x: args.sx, y: args.sy, px: args.sx, py: args.sy,
      muzzle: args.muzzle, tx: args.tx, ty: args.ty, target: args.target,
      tick(w) {
        this.px = this.x; this.py = this.y;
        if (this.target && !this.target.dead) { this.tx = this.target.x; this.ty = this.target.y; }
        const dx = this.tx - this.x, dy = this.ty - this.y, d = isqrt(dx * dx + dy * dy);
        if (d <= info.Speed) {
          this.x = this.tx; this.y = this.ty;
          applyWarheads(args, this.tx, this.ty, this.target && !this.target.dead ? this.target : null);
          return true;
        }
        this.x += Math.trunc((dx * info.Speed) / d); this.y += Math.trunc((dy * info.Speed) / d);
        return false;
      },
    });
  },
}, { Speed: 900 });

// Ballistic shell aimed at the ground where the target stood. Inaccuracy grows with range.
defineProjectile('Shell', {
  launch(args, info) {
    const { world } = args;
    const d0 = isqrt(distSq(args.sx, args.sy, args.tx, args.ty));
    const inacc = Math.trunc((info.Inaccuracy * d0) / Math.max(1, args.weapon.Range));
    const tx = args.tx + (inacc ? world.rng.range(-inacc, inacc + 1) : 0), ty = args.ty + (inacc ? world.rng.range(-inacc, inacc + 1) : 0);
    const dist = isqrt(distSq(args.sx, args.sy, tx, ty));
    const dur = Math.max(8, Math.trunc(dist / info.Speed));
    world.effects.push({
      id: world.nextEffectId++, kind: 'shell', owner: args.owner.index, sx: args.sx, sy: args.sy, tx, ty, t: 0, dur, muzzle: args.muzzle, arc: info.ArcHeight,
      x: args.sx, y: args.sy, px: args.sx, py: args.sy,
      tick(w) {
        this.px = this.x; this.py = this.y;
        this.t++;
        this.x = this.sx + Math.trunc(((this.tx - this.sx) * this.t) / this.dur);
        this.y = this.sy + Math.trunc(((this.ty - this.sy) * this.t) / this.dur);
        if (this.t >= this.dur) { applyWarheads(args, this.tx, this.ty, null); return true; }
        return false;
      },
    });
  },
}, { Speed: 410, Inaccuracy: 384, ArcHeight: 35 });

// ---------------------------------------------------------------- warheads
function defineWarhead(name, W, defaults) { W.defaults = { ...defaults }; WarheadRegistry.set(name, W); }

// Damage to the direct target (Spread 0) or to everything in a radius, scaled by Versus %.
defineWarhead('SpreadDamage', {
  apply(args, wh, x, y, direct) {
    const { world, owner } = args;
    const firer = args.firer.dead ? null : args.firer;
    const hit = (a, pct) => {
      if (!a.health || a.dead) return;
      if (!wh.AffectsAllies && owner.isAlly(a.owner)) return;
      const versus = wh.Versus[a.trait('Armor')?.info.Type] ?? 100;
      const dmg = Math.trunc((((wh.Damage * versus) / 100) * pct) / 100);
      if (dmg > 0) a.health.damage(firer, dmg, owner);
    };
    if (wh.Spread <= 0) { if (direct) hit(direct, 100); return; }
    for (const a of world.actorsInCircle(x, y, wh.Spread)) {
      const d = world.edgeDistPoint(x, y, a);
      hit(a, 100 - Math.trunc(((100 - wh.Falloff) * d) / wh.Spread));
    }
  },
}, { Damage: 0, Spread: 0, Falloff: 40, Versus: {}, AffectsAllies: false });

// Purely visual: an explosion of a given kind and size at the impact point.
defineWarhead('CreateEffect', {
  apply(args, wh, x, y) { args.world.fx({ t: 'explosion', kind: wh.Explosion, size: wh.Size, x, y, owner: args.owner.index, sound: wh.ImpactSound }); },
}, { Explosion: 'spark', Size: 100, ImpactSound: '' });
