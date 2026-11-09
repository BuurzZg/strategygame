import * as THREE from '../../lib/three.module.js';
import { buildModel } from '../render/models.js';
import { R } from '../render/worldrenderer.js';
import { makeOrder } from '../engine/order.js';
import { CELL } from '../engine/math.js';

const W = 512; // world units per render unit

export class CameraRig {
  constructor(camera, map) {
    this.cam = camera;
    this.map = map;
    this.size = map.n * 2;
    this.tx = this.size / 2; this.tz = this.size / 2;
    this.yaw = -Math.PI * 0.75;
    this.pitch = 0.95;
    this.dist = 72; this.distT = 72;
  }
  jump(x, z) { this.tx = x; this.tz = z; this.clamp(); }
  jumpWorld(x, y) { this.jump(x * R, y * R); }
  forward() { return [-Math.sin(this.yaw), -Math.cos(this.yaw)]; }
  pan(dx, dz) {
    const [fx, fz] = this.forward();
    const s = this.dist / 70;
    this.tx += (-fz * dx + fx * dz) * s; this.tz += (fx * dx + fz * dz) * s;
    this.clamp();
  }
  clamp() { this.tx = Math.max(8, Math.min(this.size - 8, this.tx)); this.tz = Math.max(8, Math.min(this.size - 8, this.tz)); }
  zoom(f) { this.distT = Math.max(28, Math.min(150, this.distT * f)); }
  update(dt) {
    this.dist += (this.distT - this.dist) * Math.min(1, dt * 10);
    const ty = this.map.heightAt(this.tx, this.tz);
    const p = this.pitch + (this.dist - 72) * 0.0018;
    const c = Math.cos(p) * this.dist;
    this.cam.position.set(this.tx + Math.sin(this.yaw) * c, ty + Math.sin(p) * this.dist, this.tz + Math.cos(this.yaw) * c);
    this.cam.lookAt(this.tx, ty, this.tz);
  }
}

const ghostOk = new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.45, depthWrite: false });
const ghostBad = new THREE.MeshBasicMaterial({ color: 0xff5a6a, transparent: true, opacity: 0.45, depthWrite: false });

// Turns mouse/keyboard/touch into selections and Orders. Modes ("order generators"):
// normal (select + context orders), place (building ghost), amove (attack-move cursor).
export class Input {
  constructor(canvas, session, ui, audio) {
    this.canvas = canvas;
    this.s = session;
    this.world = session.world;
    this.viewer = session.viewer;
    this.renderer = session.renderer;
    this.rig = session.rig;
    this.ui = ui;
    this.audio = audio;
    this.selection = [];
    this.groups = Array.from({ length: 10 }, () => []);
    this.mode = 'normal';
    this.placeType = null;
    this.mx = 0; this.my = 0; this.mouseIn = false;
    this.drag = null;
    this.keys = new Set();
    this.raycaster = new THREE.Raycaster();
    this.lastClick = { t: 0, id: 0 };
    this.lastGroupTap = { t: 0, n: -1 };
    this.hover = null;
    this.touches = new Map();
    this.pinch = null;
    this.edgeScroll = true;
    this.listeners = [];
    this.bind();
  }

  on(t, ev, fn, opts) { t.addEventListener(ev, fn, opts); this.listeners.push([t, ev, fn, opts]); }
  dispose() { for (const [t, e, f, o] of this.listeners) t.removeEventListener(e, f, o); this.clearGhost(); }

  bind() {
    const c = this.canvas;
    this.on(c, 'contextmenu', (e) => e.preventDefault());
    this.on(c, 'pointerdown', (e) => this.pointerDown(e));
    this.on(window, 'pointermove', (e) => this.pointerMove(e));
    this.on(window, 'pointerup', (e) => this.pointerUp(e));
    this.on(c, 'pointermove', () => { this.mouseIn = true; });
    this.on(c, 'pointerleave', () => { this.mouseIn = false; });
    this.on(document, 'mouseleave', () => { this.mouseIn = false; });
    this.on(c, 'wheel', (e) => { e.preventDefault(); this.rig.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12); }, { passive: false });
    this.on(window, 'keydown', (e) => this.keyDown(e));
    this.on(window, 'keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    this.on(window, 'blur', () => { this.keys.clear(); this.mouseIn = false; });
  }

  // ---------------------------------------------------------- orders
  issue(name, subjects, target, extra, queued = false) {
    this.s.om.issue(makeOrder(name, subjects, target, extra, queued));
  }
  get canCommand() { return !!this.viewer && !this.viewer.outcome; }

  // ---------------------------------------------------------- picking (render space)
  ndc(sx, sy) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
  }
  ground(sx, sy) {
    this.raycaster.setFromCamera(this.ndc(sx, sy), this.rig.cam);
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
    if (d.y > -0.01) return null;
    let h = 1.5, x = 0, z = 0;
    for (let i = 0; i < 6; i++) { const t = (h - o.y) / d.y; x = o.x + d.x * t; z = o.z + d.z * t; h = this.world.map.heightAt(x, z); }
    return { x, z, wx: Math.round(x * W), wy: Math.round(z * W) };
  }
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.rig.cam);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, z: v.z };
  }
  actorScreen(a, lift = 1) {
    const v = this.renderer.views.get(a.id);
    if (!v) return null;
    const p = v.model.root.position;
    return this.project(p.x, p.y + lift, p.z);
  }
  pickActor(sx, sy) {
    const w = this.world, rd = this.renderer;
    let best = null, bs = Infinity;
    const g = this.ground(sx, sy);
    if (g) {
      const i = Math.floor(g.x / 2), j = Math.floor(g.z / 2);
      if (w.map.inBounds(i, j)) {
        const id = w.map.bld[j * w.map.n + i];
        const b = id && w.actorById.get(id);
        if (b && !b.dead && rd.isVisible(b)) best = b;
      }
    }
    const camDist = this.rig.dist;
    for (const v of rd.views.values()) {
      const a = v.actor;
      if (a.building || a.dead || !v.model.root.visible) continue;
      const p = this.actorScreen(a);
      if (!p || p.z > 1) continue;
      const rpx = Math.max(12, v.radius * 2 * (window.innerHeight / camDist));
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < rpx && d < bs) { bs = d; best = a; }
    }
    return best;
  }

  // ---------------------------------------------------------- selection
  setSelection(list, sound = true) {
    this.selection = list.filter((a) => !a.dead);
    this.renderer.selected = new Set(this.selection);
    if (sound && list.length) this.audio.play('select');
    this.ui.selectionChanged();
  }
  isMine(a) { return !!this.viewer && a.owner === this.viewer; }
  own() { return this.selection.filter((a) => !a.dead && this.isMine(a)); }
  prune() {
    if (this.selection.some((a) => a.dead || a.disposed || !this.renderer.isVisible(a))) this.setSelection(this.selection.filter((a) => !a.dead && !a.disposed && this.renderer.isVisible(a)), false);
  }
  boxSelect(x0, y0, x1, y1, additive) {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    const inBox = (a) => { const p = this.actorScreen(a); return p && p.z < 1 && p.x >= lx && p.x <= hx && p.y >= ly && p.y <= hy; };
    const mine = this.world.actors.filter((a) => !a.dead && this.isMine(a));
    let list = mine.filter((a) => a.mobile && inBox(a));
    const army = list.filter((a) => !a.harvester);
    if (army.length) list = army;
    if (!list.length) list = mine.filter((a) => a.building && inBox(a));
    if (additive) list = [...new Set([...this.own(), ...list])];
    this.setSelection(list);
  }
  clickSelect(sx, sy, additive, double) {
    const a = this.pickActor(sx, sy);
    if (!a) { if (!additive) this.setSelection([]); return; }
    if (double && this.isMine(a)) {
      const r = this.canvas.getBoundingClientRect();
      this.setSelection(this.world.actors.filter((o) => {
        if (o.dead || !this.isMine(o) || o.type !== a.type) return false;
        const p = this.actorScreen(o);
        return p && p.z < 1 && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
      }));
      return;
    }
    if (additive && this.isMine(a)) {
      const own = this.own();
      this.setSelection(own.includes(a) ? own.filter((o) => o !== a) : [...own, a]);
      return;
    }
    this.setSelection([a]);
  }

  // ---------------------------------------------------------- context orders
  // Ask every selected actor's traits what they would do with the target; issue the
  // highest-priority order for each actor, grouped so a group moves in formation.
  command(target, queued = false, forceAttackMove = false) {
    if (!this.canCommand) return;
    const sel = this.own();
    if (!sel.length) return;
    const groups = new Map();
    for (const a of sel) {
      let best = null;
      if (forceAttackMove) best = a.mobile ? { order: a.attack ? 'AttackMove' : 'Move', priority: 1 } : null;
      else for (const t of a.traits) {
        if (!t.enabled || !t.orderFor) continue;
        const o = t.orderFor(target);
        if (o && (!best || o.priority > best.priority)) best = o;
      }
      if (!best) continue;
      if (!groups.has(best.order)) groups.set(best.order, []);
      groups.get(best.order).push(a);
    }
    let marker = 0x8dffa8;
    for (const [name, actors] of groups) {
      const t = target.actor ? { actor: target.actor } : { x: target.x, y: target.y };
      this.issue(name, actors, t, undefined, queued);
      if (name === 'Attack') marker = 0xff5a5a;
      else if (name === 'Harvest') marker = 0xff7cbc;
      else if (name === 'AttackMove') marker = 0xffb35a;
    }
    if (groups.size) {
      const x = target.x * R, z = target.y * R;
      this.renderer.fx.marker(x, this.world.map.heightAt(x, z), z, marker);
      this.audio.play('order');
    }
  }
  targetAt(sx, sy) {
    const g = this.ground(sx, sy);
    if (!g) return null;
    const a = this.pickActor(sx, sy);
    return a ? { actor: a, x: a.x, y: a.y } : { x: g.wx, y: g.wy };
  }

  // ---------------------------------------------------------- placement mode
  beginPlacement(type) {
    if (!this.canCommand) return;
    this.cancelMode();
    this.mode = 'place';
    this.placeType = type;
    const info = this.world.rules.actor(type);
    const size = info.traitInfo('Building').Footprint;
    const model = buildModel(info.traitInfo('WithModel').Model, this.renderer.styleOf(this.viewer));
    model.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.material = ghostOk; } });
    const foot = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size * 2), ghostOk);
    foot.rotation.x = -Math.PI / 2; foot.position.y = 0.2;
    model.root.add(foot);
    this.ghost = model.root;
    this.ghostMeshes = [];
    model.root.traverse((o) => { if (o.isMesh) this.ghostMeshes.push(o); });
    this.renderer.scene.add(this.ghost);
    const col = this.renderer.styleOf(this.viewer).color;
    this.fieldRings = this.world.fieldSources(this.viewer).map((f) => {
      const r = f.info.Range * R;
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, depthWrite: false }));
      const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.06, depthWrite: false }));
      ring.add(fill);
      const v = this.renderer.views.get(f.self.id);
      ring.position.set(f.self.x * R, (v && v.y) || 0.5, f.self.y * R);
      ring.renderOrder = 7; fill.renderOrder = 7;
      this.renderer.scene.add(ring);
      return ring;
    });
    this.updateGhost();
  }
  placementCell() {
    const size = this.world.rules.actor(this.placeType).traitInfo('Building').Footprint;
    const g = this.ground(this.mx, this.my);
    if (!g) return null;
    return [Math.round(g.x / 2 - size / 2), Math.round(g.z / 2 - size / 2), size];
  }
  updateGhost() {
    if (this.mode !== 'place' || !this.ghost) return;
    const c = this.placementCell();
    if (!c) return;
    const [ci, cj, size] = c;
    const x = (ci + size / 2) * 2, z = (cj + size / 2) * 2;
    this.ghost.position.set(x, this.world.map.heightAt(x, z), z);
    const cost = this.world.rules.actor(this.placeType).traitInfo('Valued').Cost;
    const err = this.world.canPlace(this.viewer, this.placeType, ci, cj) || (this.viewer.resources.cash < cost ? 'Not enough resonance' : null);
    for (const m of this.ghostMeshes) m.material = err ? ghostBad : ghostOk;
    this.placeErr = err;
  }
  tryPlace(keep) {
    const c = this.placementCell();
    if (!c) return;
    this.updateGhost();
    if (this.placeErr) { this.ui.toast(this.placeErr, 'bad'); this.audio.play('error'); return; }
    this.issue('PlaceBuilding', [], { x: c[0] * CELL, y: c[1] * CELL }, this.placeType);
    if (!keep) this.cancelMode();
  }
  clearGhost() {
    if (this.ghost) { this.renderer.scene.remove(this.ghost); this.ghost = null; }
    if (this.fieldRings) { for (const r of this.fieldRings) this.renderer.scene.remove(r); this.fieldRings = null; }
  }
  cancelMode() {
    this.clearGhost();
    this.mode = 'normal';
    this.placeType = null;
    this.canvas.style.cursor = '';
    this.ui.modeChanged();
  }
  beginAttackMove() {
    if (!this.own().some((a) => a.mobile)) return;
    this.cancelMode();
    this.mode = 'amove';
    this.canvas.style.cursor = 'crosshair';
    this.ui.modeChanged();
  }

  // ---------------------------------------------------------- pointer
  pointerDown(e) {
    if (this.s.over) return;
    this.mx = e.clientX; this.my = e.clientY;
    if (e.pointerType === 'touch') return this.touchDown(e);
    if (e.button === 1) { e.preventDefault(); this.drag = { kind: 'pan', x: e.clientX, y: e.clientY, alt: e.altKey }; return; }
    if (e.button === 0) {
      if (this.mode === 'place') { this.tryPlace(e.shiftKey); return; }
      if (this.mode === 'amove') {
        const t = this.targetAt(e.clientX, e.clientY);
        if (t) this.command(t, e.shiftKey, true);
        if (!e.shiftKey) this.cancelMode();
        return;
      }
      this.drag = { kind: 'select', x: e.clientX, y: e.clientY, shift: e.shiftKey };
    } else if (e.button === 2) {
      if (this.mode !== 'normal') { this.cancelMode(); return; }
      const t = this.targetAt(e.clientX, e.clientY);
      if (t) this.command(t, e.shiftKey);
    }
  }
  pointerMove(e) {
    this.mx = e.clientX; this.my = e.clientY;
    if (e.pointerType === 'touch') return this.touchMove(e);
    if (this.drag && this.drag.kind === 'pan') {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (this.drag.alt) this.rig.yaw -= dx * 0.006; else this.rig.pan(-dx * 0.12, dy * 0.12);
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    }
    this.updateGhost();
  }
  pointerUp(e) {
    if (e.pointerType === 'touch') return this.touchUp(e);
    const d = this.drag;
    this.drag = null;
    if (!d || d.kind !== 'select') return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) this.boxSelect(d.x, d.y, e.clientX, e.clientY, d.shift);
    else {
      const now = performance.now();
      const hit = this.pickActor(e.clientX, e.clientY);
      const dbl = hit && now - this.lastClick.t < 350 && this.lastClick.id === hit.id;
      this.lastClick = { t: now, id: hit ? hit.id : 0 };
      this.clickSelect(e.clientX, e.clientY, d.shift, dbl);
    }
  }

  touchDown(e) {
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (this.touches.size === 2) { const [a, b] = [...this.touches.values()]; this.pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  }
  touchMove(e) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY;
    if (this.touches.size === 2 && this.pinch) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.rig.zoom(this.pinch / d); this.pinch = d;
    } else if (this.touches.size === 1) this.rig.pan(-dx * 0.15, dy * 0.15);
  }
  touchUp(e) {
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    if (!t || this.touches.size > 0) return;
    if (Math.hypot(e.clientX - t.sx, e.clientY - t.sy) > 12 || performance.now() - t.t > 500) return;
    this.mx = e.clientX; this.my = e.clientY;
    if (this.mode === 'place') { this.tryPlace(false); return; }
    const target = this.targetAt(e.clientX, e.clientY);
    if (this.mode === 'amove') { if (target) this.command(target, false, true); this.cancelMode(); return; }
    if (target && target.actor && this.isMine(target.actor)) { this.setSelection([target.actor]); return; }
    if (this.own().length && target) this.command(target);
    else this.setSelection(target && target.actor ? [target.actor] : []);
  }

  // ---------------------------------------------------------- keyboard
  keyDown(e) {
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (k === 'escape') { if (this.mode !== 'normal') this.cancelMode(); else this.ui.togglePause(); return; }
    if (this.s.over || this.ui.paused) return;
    if (/^[0-9]$/.test(k)) {
      const n = +k;
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.groups[n] = this.own().slice(); this.ui.toast(`Group ${n} set`, 'info'); return; }
      if (e.shiftKey) { this.groups[n] = [...new Set([...this.groups[n], ...this.own()])]; return; }
      const g = (this.groups[n] = this.groups[n].filter((a) => !a.dead));
      if (!g.length) return;
      const now = performance.now();
      if (this.lastGroupTap.n === n && now - this.lastGroupTap.t < 400) {
        this.rig.jumpWorld(g.reduce((s, a) => s + a.x, 0) / g.length, g.reduce((s, a) => s + a.y, 0) / g.length);
      }
      this.lastGroupTap = { n, t: now };
      this.setSelection(g);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === ' ') {
      e.preventDefault();
      const v = this.viewer;
      const alert = v && v.lastAlert;
      const core = this.world.actors.find((a) => !a.dead && v && a.owner === v && a.type === 'core');
      if (alert && this.world.frame - alert.frame < 500) this.rig.jumpWorld(alert.x, alert.y);
      else if (core) this.rig.jumpWorld(core.x, core.y);
      return;
    }
    if (k === 'q') { this.rig.yaw += 0.2; return; }
    if (k === 'e') { this.rig.yaw -= 0.2; return; }
    if (!this.canCommand) return;
    if (k === 'a') { this.beginAttackMove(); return; }
    if (k === 's') { this.stop(); return; }
    if (k === 'h') { this.stance('Defend'); return; }
    if (k === 'g') { this.stance('AttackAnything'); return; }
    if (k === 'x' || k === 'delete') { this.recycle(); return; }
    if (k === 'tab') { e.preventDefault(); return; }
    this.ui.hotkey(k);
  }
  stop() { const u = this.own().filter((a) => a.mobile); if (u.length) this.issue('Stop', u); }
  stance(st) {
    const u = this.own().filter((a) => a.has('AutoTarget'));
    if (!u.length) return;
    this.issue('SetStance', u, null, st);
    if (st === 'Defend') this.issue('Stop', u.filter((a) => a.mobile));
    this.ui.toast(st === 'Defend' ? 'Holding ground' : 'Engaging freely', 'info');
  }
  recycle() { const b = this.own().filter((a) => a.building); if (b.length) this.issue('Recycle', b); }

  update(dt) {
    const pan = 60 * dt;
    let dx = 0, dz = 0;
    if (this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('arrowright')) dx += 1;
    if (this.keys.has('arrowup')) dz += 1;
    if (this.keys.has('arrowdown')) dz -= 1;
    if (this.edgeScroll && this.mouseIn && !this.drag && document.hasFocus()) {
      const m = 14;
      if (this.mx < m) dx -= 1; else if (this.mx > window.innerWidth - m) dx += 1;
      if (this.my < m) dz += 1; else if (this.my > window.innerHeight - m) dz -= 1;
    }
    if (dx || dz) { this.rig.pan(dx * pan, dz * pan); this.updateGhost(); }
    this.prune();
    this.hover = this.mode === 'normal' && !this.drag ? this.pickActor(this.mx, this.my) : null;
    if (this.mode === 'normal') this.canvas.style.cursor = this.hover && this.viewer && this.viewer.isEnemy(this.hover.owner) && this.own().some((a) => a.attack) ? 'crosshair' : '';
  }
}
