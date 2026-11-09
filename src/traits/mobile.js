import { defineTrait, Trait } from '../engine/traits.js';
import { angleOf, angleDiff, turnToward, cos, sin, isqrt } from '../engine/math.js';
import { MoveTo } from '../activities/move.js';

// Ground or hover movement. Strafe: true moves straight at the waypoint (hover craft);
// otherwise the unit drives along its facing and slows while turning (walkers, tracks).
defineTrait('Mobile', class Mobile extends Trait {
  created() { this.self.mobile = this; this.movedFrame = -1; this.speeds = null; }
  addedToWorld() {
    const loco = this.world.worldActor.traitsOf('Locomotor').find((l) => l.info.Name === this.info.Locomotor);
    if (!loco) throw new Error(`${this.self.type}: unknown locomotor "${this.info.Locomotor}"`);
    this.speeds = loco.info.TerrainSpeeds;
  }
  terrainPercent() {
    const map = this.world.map;
    return this.speeds[map.terrainType(map.cellOf(this.self.y) * map.n + map.cellOf(this.self.x))] ?? 100;
  }

  // Advance one tick toward (tx, ty).
  stepToward(tx, ty, slowRadius = 0) {
    const self = this.self, map = this.world.map, info = this.info;
    const dx = tx - self.x, dy = ty - self.y;
    const d = isqrt(dx * dx + dy * dy);
    if (d === 0) return 0;
    const desired = angleOf(dx, dy);
    self.facing = turnToward(self.facing, desired, info.TurnSpeed);
    let speed = Math.trunc((info.Speed * this.terrainPercent()) / 100);
    if (!info.Strafe) speed = Math.trunc((speed * Math.max(256, cos(angleDiff(self.facing, desired)))) / 1024);
    if (slowRadius && d < slowRadius) speed = Math.max(Math.trunc((speed * 35) / 100), Math.trunc((speed * d) / slowRadius));
    if (speed < 1) speed = 1;
    let nx, ny;
    if (speed >= d) { nx = tx; ny = ty; }
    else if (info.Strafe) { nx = self.x + Math.trunc((dx * speed) / d); ny = self.y + Math.trunc((dy * speed) / d); }
    else { nx = self.x + Math.trunc((cos(self.facing) * speed) / 1024); ny = self.y + Math.trunc((sin(self.facing) * speed) / 1024); }
    if (map.passableAt(nx, ny)) { self.x = nx; self.y = ny; }
    else if (map.passableAt(nx, self.y)) self.x = nx;
    else if (map.passableAt(self.x, ny)) self.y = ny;
    else return d;
    this.movedFrame = this.world.frame;
    return d;
  }

  orderFor(target) { return target.actor ? null : { order: 'Move', priority: 1 }; }
  resolveOrder(o) {
    const self = this.self;
    if ((o.name === 'Move' || (o.name === 'AttackMove' && !self.attack)) && o.target) self.queueActivity(new MoveTo(o.target.x, o.target.y), o.queued);
    else if (o.name === 'Stop') self.cancelActivity();
  }
}, { Speed: 100, TurnSpeed: 40, Locomotor: 'hover', Strafe: false });

// A rotating turret. Realigns with the body after a while without targets.
defineTrait('Turreted', class Turreted extends Trait {
  created() {
    this.self.turret = this;
    this.facing = (this.self.facing + this.info.InitialFacing) & 1023;
    this.pfacing = this.facing;
    this.lastAim = -1000;
  }
  aim(angle, tolerance) {
    this.facing = turnToward(this.facing, angle, this.info.TurnSpeed);
    this.lastAim = this.world.frame;
    const d = angleDiff(this.facing, angle);
    return d <= tolerance && d >= -tolerance;
  }
  tick() {
    if (this.world.frame - this.lastAim > this.info.RealignDelay) {
      const rest = this.self.building ? (this.facing + this.info.IdleSpin) & 1023 : this.self.facing;
      this.facing = turnToward(this.facing, rest, this.info.TurnSpeed >> 1);
    }
  }
}, { TurnSpeed: 32, InitialFacing: 0, RealignDelay: 50, IdleSpin: 0 });
