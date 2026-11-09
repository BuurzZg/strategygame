import * as THREE from '../../lib/three.module.js';
import { buildTerrain, buildRocks, CrystalField } from './terrain.js';
import { buildModel, selectionRing, buildingRadius } from './models.js';
import { Effects } from './effects.js';
import { FogOverlay } from './fog.js';

// Render units: 2 per cell. World units: 1024 per cell.
export const R = 1 / 512;
const TAU = Math.PI * 2;
const toRad = (a) => (a / 1024) * TAU;
const lerpAngle = (a, b, t) => { let d = (b - a) & 1023; if (d > 512) d -= 1024; return a + d * t; };

// Faction colours from rules, in the shape the model builder expects.
export function factionStyle(info) {
  return { id: info.InternalName, name: info.Name, color: parseInt(info.Color, 16), glow: parseInt(info.Glow, 16), dark: parseInt(info.Dark, 16), css: `#${info.Color}` };
}

// Reads the simulation and draws it. Never writes to it.
export class WorldRenderer {
  constructor(scene, world, viewer, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.viewer = viewer; // local Player, or null for spectators/replays
    this.reveal = !!opts.reveal || !viewer;
    this.sfx = opts.sfx || (() => {});
    this.onNotify = opts.onNotify || (() => {});
    this.onSay = opts.onSay || (() => {});
    this.onObjectives = opts.onObjectives || (() => {});
    this.onFocus = opts.onFocus || (() => {});
    this.storms = [];
    this.clock = 0;
    this.map = world.map;
    this.styles = new Map([...world.factions].map(([k, v]) => [k, factionStyle(v)]));
    this.views = new Map();
    this.projViews = new Map();
    this.selected = new Set();
    this.hover = null;

    this.terrain = buildTerrain(this.map);
    scene.add(this.terrain);
    scene.add(buildRocks(this.map));
    this.crystals = new CrystalField(this.map, scene);
    this.fog = new FogOverlay(this.terrain.geometry, this.map.n, this.map.n * 2);
    scene.add(this.fog.mesh);
    this.fx = new Effects(scene);
    this.allVisible = new Uint8Array(this.map.n * this.map.n).fill(2);
  }

  styleOf(player) { return this.styles.get(player.faction) || this.styles.values().next().value; }

  // ---------------------------------------------------------------- visibility for the local viewer
  isVisible(a) {
    if (this.reveal || !this.viewer || this.viewer.isAlly(a.owner)) return true;
    return this.world.canSee(this.viewer, a);
  }
  pointVisible(x, y) {
    if (this.reveal || !this.viewer) return true;
    return this.viewer.shroud.isVisible(x, y);
  }

  // ---------------------------------------------------------------- per-actor views
  makeView(a) {
    const wm = a.info.traitInfo('WithModel');
    if (!wm || !wm.Model) return null;
    const style = this.styleOf(a.owner);
    const model = buildModel(wm.Model, style);
    const radius = a.building ? buildingRadius(a.building.size) : (a.info.traitInfo('Selectable')?.Radius || 700) * R;
    const ring = selectionRing(radius, !this.viewer || a.owner === this.viewer || this.viewer.isAlly(a.owner));
    model.root.add(ring);
    model.baseY = model.body.position.y;
    this.scene.add(model.root);
    const v = { actor: a, owner: a.owner, model, ring, style, radius, seen: false };
    if (a.building) {
      const b = a.building, s = b.size;
      let hy = -1e9;
      for (const [i, j] of [[b.ci, b.cj], [b.ci + s, b.cj], [b.ci, b.cj + s], [b.ci + s, b.cj + s]]) hy = Math.max(hy, this.map.heightAt(i * 2, j * 2));
      v.y = hy;
    }
    return v;
  }

  syncViews() {
    for (const a of this.world.actors) if (!this.views.has(a.id) && !a.dead) { const v = this.makeView(a); if (v) this.views.set(a.id, v); }
    for (const [id, v] of this.views) {
      if (v.actor.disposed || v.actor.dead) { this.scene.remove(v.model.root); this.views.delete(id); this.selected.delete(v.actor); }
      else if (v.owner !== v.actor.owner) { this.scene.remove(v.model.root); const nv = this.makeView(v.actor); if (nv) this.views.set(id, nv); else this.views.delete(id); }
    }
  }

  // Interpolated render position of an actor. alpha in [0,1] between previous and current tick.
  renderPos(a, alpha) {
    const x = (a.px + (a.x - a.px) * alpha) * R, z = (a.py + (a.y - a.py) * alpha) * R;
    return { x, z, y: this.map.heightAt(x, z) };
  }

  updateViews(t, alpha) {
    for (const v of this.views.values()) {
      const a = v.actor, m = v.model;
      const vis = this.isVisible(a);
      m.root.visible = vis;
      v.ring.visible = vis && this.selected.has(a);
      if (!vis) continue;
      if (a.building) {
        m.root.position.set(a.x * R, v.y, a.y * R);
        const wv = a.trait('Weavable');
        const p = wv && !wv.done ? wv.progress / wv.total : 1;
        m.body.scale.y = 0.08 + 0.92 * p;
        if (wv && !wv.done && !wv.waiting && Math.random() < 0.25) this.fx.weave(a.x * R, v.y + 0.2, a.y * R, v.radius * 0.9, v.style.glow);
        if (m.turret && a.turret) m.turret.rotation.y = -toRad(lerpAngle(a.turret.pfacing, a.turret.facing, alpha));
        if (m.spin && (!wv || wv.done)) m.spin.rotation.y = t * (a.type === 'uplink' ? 0.4 : a.type === 'deepdrill' ? 2.4 : 0.8);
        if (a.type === 'deepdrill' && m.glow) m.glow.material.color.setHSL(0.92, 1, 0.55 + Math.sin(t * 5) * 0.12);
        if (a.type === 'beacon' && m.glow) m.glow.visible = Math.sin(t * 4) > -0.3;
        continue;
      }
      const p = this.renderPos(a, alpha);
      m.root.position.set(p.x, p.y, p.z);
      const facing = lerpAngle(a.pfacing, a.facing, alpha);
      m.body.rotation.y = -toRad(facing);
      if (m.turret && a.turret) m.turret.rotation.y = -(toRad(lerpAngle(a.turret.pfacing, a.turret.facing, alpha)) - toRad(facing));
      if (m.bob) m.body.position.y = m.baseY + Math.sin(t * 3 + a.id) * m.bob;
      if (m.spin) m.spin.rotation.z = t * 2;
      if (m.cargo) m.cargo.visible = !!a.harvester && a.harvester.cargo > 0;
      if (a.type === 'warden' && (a.x !== a.px || a.y !== a.py)) m.body.position.y = Math.abs(Math.sin(t * 9 + a.id)) * 0.12;
    }
  }

  // ---------------------------------------------------------------- projectiles
  updateProjectiles(alpha) {
    const live = new Set();
    for (const e of this.world.effects) {
      live.add(e.id);
      let m = this.projViews.get(e.id);
      const owner = this.world.players[e.owner];
      if (!m) {
        m = this.fx.getProjectileMesh(owner ? this.styleOf(owner).glow : 0xffffff);
        m.scale.setScalar(e.kind === 'shell' ? 1.8 : 1);
        this.projViews.set(e.id, m);
      }
      const x = (e.px + (e.x - e.px) * alpha) * R, z = (e.py + (e.y - e.py) * alpha) * R;
      let y;
      if (e.kind === 'shell') {
        const t = Math.min(1, (e.t - 1 + alpha) / e.dur);
        const sx = e.sx * R, sz = e.sy * R, tx = e.tx * R, tz = e.ty * R;
        const h0 = this.map.heightAt(sx, sz) + e.muzzle / 100, h1 = this.map.heightAt(tx, tz);
        const dist = Math.hypot(tx - sx, tz - sz);
        y = h0 + (h1 - h0) * t + (1.5 + dist * e.arc / 100) * 4 * t * (1 - t);
        if (Math.random() < 0.5) this.fx.smoke.spawn(x, y, z, 0, 0.3, 0, 0.5, 0.5, 1.2, new THREE.Color(0x3a3048), 0.4);
      } else y = this.map.heightAt(x, z) + 1;
      m.position.set(x, y, z);
      m.visible = this.pointVisible(e.x, e.y);
    }
    for (const [id, m] of this.projViews) if (!live.has(id)) { this.fx.releaseProjectileMesh(m); this.projViews.delete(id); }
  }

  // ---------------------------------------------------------------- simulation events
  consumeEvents(events) {
    const w = this.world;
    for (const ev of events) {
      const actor = ev.actor !== undefined ? w.actorById.get(ev.actor) : null;
      switch (ev.t) {
        case 'notify': if (this.viewer && ev.player === this.viewer.index) this.onNotify(ev.text, ev.kind); break;
        case 'alert':
          if (this.viewer && ev.player === this.viewer.index) { this.onNotify(`${ev.text}: press Space to look`, 'bad'); this.sfx('alert', ev.x, ev.y, true); }
          break;
        case 'outcome': break;
        case 'say': if (!this.viewer || ev.player === this.viewer.index) this.onSay(ev.speaker, ev.text); break;
        case 'objectives': if (!this.viewer || ev.player === this.viewer.index) this.onObjectives(ev.kind, ev.text); break;
        case 'focus': if (!this.viewer || ev.player === this.viewer.index) this.onFocus(ev.x * R, ev.y * R); break;
        case 'storm':
          this.storms.push({ z0: ev.y0 * R, z1: ev.y1 * R, until: this.clock + ev.ticks / 25, warning: ev.warning });
          if (!ev.warning) this.sfx('storm', (this.map.n * 512), (ev.y0 + ev.y1) / 2, true);
          break;
        case 'sound': if (this.pointVisible(ev.x, ev.y)) this.sfx(ev.name, ev.x, ev.y); break;
        case 'muzzle': {
          if (!actor || !this.isVisible(actor)) break;
          const v = this.views.get(actor.id);
          const p = actor.building ? { x: actor.x * R, z: actor.y * R, y: v ? v.y : 0 } : this.renderPos(actor, 1);
          const ang = toRad(actor.turret ? actor.turret.facing : actor.facing);
          this.fx.muzzle(p.x + Math.cos(ang) * 0.9, p.y + ev.height / 100, p.z + Math.sin(ang) * 0.9, this.styleOf(actor.owner).glow);
          break;
        }
        case 'beam': {
          if (!this.pointVisible(ev.x0, ev.y0) && !this.pointVisible(ev.x1, ev.y1)) break;
          const src = w.actorById.get(ev.from), dst = w.actorById.get(ev.to);
          const owner = w.players[ev.owner];
          const col = owner ? this.styleOf(owner).glow : 0xffffff;
          const sv = src && this.views.get(src.id);
          const a = new THREE.Vector3(ev.x0 * R, (sv && sv.y !== undefined ? sv.y : this.map.heightAt(ev.x0 * R, ev.y0 * R)) + ev.muzzle / 100, ev.y0 * R);
          const dv = dst && this.views.get(dst.id);
          const b = new THREE.Vector3(ev.x1 * R, (dv && dv.y !== undefined ? dv.y + 1.5 : this.map.heightAt(ev.x1 * R, ev.y1 * R) + 1), ev.y1 * R);
          this.fx.beam(a, b, col, ev.width / 100);
          this.fx.sparks(b.x, b.y, b.z, col, 5, 5);
          break;
        }
        case 'explosion': {
          if (!this.pointVisible(ev.x, ev.y)) break;
          const x = ev.x * R, z = ev.y * R, y = this.map.heightAt(x, z);
          const owner = w.players[ev.owner];
          const col = owner ? this.styleOf(owner).glow : 0xffb060;
          if (ev.kind === 'blast') this.fx.explosion(x, y, z, ev.size / 100, col);
          else this.fx.sparks(x, y + 1, z, col, Math.round(4 * ev.size / 100), 4);
          if (ev.sound) this.sfx(ev.sound, ev.x, ev.y);
          break;
        }
        case 'killed': {
          if (!this.pointVisible(ev.x, ev.y)) break;
          const x = ev.x * R, z = ev.y * R, y = this.map.heightAt(x, z);
          const owner = w.players[ev.owner];
          const glow = owner ? this.styleOf(owner).glow : 0xffffff;
          if (ev.recycled) {
            for (let i = 0; i < 30; i++) this.fx.weave(x, y, z, ev.size * Math.random(), glow);
            this.fx.ring(x, y, z, ev.size * 2.5, glow, 0.6);
          } else {
            this.fx.explosion(x, y, z, ev.building ? 1.4 + ev.size * 0.4 : 0.9, ev.building ? 0xffa060 : glow);
            this.sfx(ev.building ? 'collapse' : 'explode', ev.x, ev.y);
          }
          break;
        }
        case 'siphon': {
          if (!actor || !this.isVisible(actor) || Math.random() < 0.5) break;
          const n = this.map.n, cx = (ev.cell % n) * 2 + 1, cz = Math.floor(ev.cell / n) * 2 + 1;
          const p = this.renderPos(actor, 1);
          this.fx.siphon(cx, this.map.heightAt(cx, cz) + 0.5, cz, p.x, p.y + 1.2, p.z, 0xff7cbc);
          break;
        }
        case 'heal': {
          const s = w.actorById.get(ev.from), d = w.actorById.get(ev.to);
          if (!s || !d || !this.isVisible(d)) break;
          const ps = this.renderPos(s, 1), pd = this.renderPos(d, 1);
          this.fx.beam(new THREE.Vector3(ps.x, ps.y + 1.5, ps.z), new THREE.Vector3(pd.x, pd.y + 1, pd.z), 0x7dffa6, 0.07, 0.3);
          this.fx.heal(pd.x, pd.y + 1, pd.z);
          break;
        }
        case 'complete': {
          if (!actor) break;
          const v = this.views.get(actor.id);
          if (v && this.isVisible(actor)) this.fx.ring(actor.x * R, v.y, actor.y * R, v.radius * 2.5, v.style.glow, 0.7);
          if (this.viewer && ev.owner === this.viewer.index) this.sfx('complete', actor.x, actor.y, true);
          break;
        }
        case 'placed': if (this.viewer && ev.owner === this.viewer.index && actor) this.sfx('place', actor.x, actor.y, true); break;
        case 'ready': if (this.viewer && ev.owner === this.viewer.index && actor) this.sfx('ready', actor.x, actor.y, true); break;
        case 'deposit': if (this.viewer && ev.owner === this.viewer.index && actor) this.sfx('deposit', actor.x, actor.y); break;
      }
    }
  }

  // Glass storms: a band of wind-driven glass across the whole map width.
  updateStorms(dt) {
    this.storms = this.storms.filter((st) => st.until > this.clock);
    const W = this.map.n * 2;
    const glass = new THREE.Color(0xffc4e0), dust = new THREE.Color(0x4a3a58);
    for (const st of this.storms) {
      const count = st.warning ? 4 : 70;
      for (let i = 0; i < count; i++) {
        const x = Math.random() * W, z = st.z0 + Math.random() * (st.z1 - st.z0);
        const y = this.map.heightAt(x, z) + Math.random() * (st.warning ? 1.5 : 6);
        this.fx.glow.spawn(x, y, z, 14 + Math.random() * 10, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 0.5 + Math.random() * 0.5, st.warning ? 0.5 : 0.7, 0.2, glass, st.warning ? 0.5 : 0.9);
        if (!st.warning && i % 6 === 0) this.fx.smoke.spawn(x, y, z, 10, 0.5, 0, 1.4, 3, 7, dust, 0.35);
      }
    }
  }

  update(t, dt, alpha) {
    this.clock += dt;
    this.updateStorms(dt);
    this.syncViews();
    this.updateViews(t, alpha);
    this.updateProjectiles(alpha);
    this.crystals.update();
    this.crystals.animate(t);
    this.fog.update(this.reveal ? this.allVisible : this.viewer.shroud.vis, dt);
    this.fx.update(dt);
  }
}
