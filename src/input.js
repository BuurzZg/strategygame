import * as THREE from '../lib/three.module.js';
import { CELL, WORLD, BUILDINGS } from './config.js';
import { buildModel } from './models.js';

export class CameraRig {
  constructor(camera, map) {
    this.cam = camera;
    this.map = map;
    this.tx = WORLD / 2; this.tz = WORLD / 2;
    this.yaw = -Math.PI * 0.75;
    this.pitch = 0.95;
    this.dist = 72; this.distT = 72;
    this.shake = 0;
  }
  jump(x, z) { this.tx = x; this.tz = z; this.clamp(); }
  forward() { return [-Math.sin(this.yaw), -Math.cos(this.yaw)]; }
  pan(dx, dz) {
    const [fx, fz] = this.forward();
    const rx = -fz, rz = fx;
    const s = this.dist / 70;
    this.tx += (rx * dx + fx * dz) * s; this.tz += (rz * dx + fz * dz) * s;
    this.clamp();
  }
  clamp() { this.tx = Math.max(8, Math.min(WORLD - 8, this.tx)); this.tz = Math.max(8, Math.min(WORLD - 8, this.tz)); }
  zoom(f) { this.distT = Math.max(28, Math.min(150, this.distT * f)); }
  update(dt) {
    this.dist += (this.distT - this.dist) * Math.min(1, dt * 10);
    const ty = this.map.heightAt(this.tx, this.tz);
    const p = this.pitch + (this.dist - 72) * 0.0018;
    const c = Math.cos(p) * this.dist;
    let sx = 0, sz = 0;
    if (this.shake > 0) { this.shake -= dt; sx = (Math.random() - 0.5) * this.shake * 2; sz = (Math.random() - 0.5) * this.shake * 2; }
    this.cam.position.set(this.tx + Math.sin(this.yaw) * c + sx, ty + Math.sin(p) * this.dist, this.tz + Math.cos(this.yaw) * c + sz);
    this.cam.lookAt(this.tx + sx, ty, this.tz + sz);
  }
}

const ghostOk = new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.45, depthWrite: false });
const ghostBad = new THREE.MeshBasicMaterial({ color: 0xff5a6a, transparent: true, opacity: 0.45, depthWrite: false });

export class Input {
  constructor(canvas, world, rig, ui, audio) {
    this.canvas = canvas;
    this.world = world;
    this.rig = rig;
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

  on(target, ev, fn, opts) { target.addEventListener(ev, fn, opts); this.listeners.push([target, ev, fn, opts]); }
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

  // ---------------------------------------------------------- picking
  ndc(sx, sy) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
  }
  ground(sx, sy) {
    this.raycaster.setFromCamera(this.ndc(sx, sy), this.rig.cam);
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
    if (d.y > -0.01) return null;
    let h = 1.5, x = 0, z = 0;
    for (let i = 0; i < 6; i++) {
      const t = (h - o.y) / d.y;
      x = o.x + d.x * t; z = o.z + d.z * t;
      h = this.world.map.heightAt(x, z);
    }
    return { x, z };
  }
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.rig.cam);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, z: v.z };
  }
  pickEntity(sx, sy) {
    const w = this.world;
    let best = null, bs = 1e9;
    const g = this.ground(sx, sy);
    if (g) {
      const i = Math.floor(g.x / CELL), j = Math.floor(g.z / CELL);
      if (w.map.inBounds(i, j)) {
        const b = w.entityAtCell(i, j);
        if (b && b.alive && w.canSee(0, b)) best = b;
      }
    }
    const camDist = this.rig.cam.position.distanceTo(new THREE.Vector3(this.rig.tx, 0, this.rig.tz));
    for (const e of w.entities) {
      if (!e.alive || e.kind !== 'unit' || !w.canSee(0, e)) continue;
      const y = w.map.heightAt(e.x, e.z) + 1;
      const p = this.project(e.x, y, e.z);
      if (p.z > 1) continue;
      const rpx = Math.max(12, e.radius * 1.4 * (window.innerHeight / camDist) * 1.4);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < rpx && d < bs) { bs = d; best = e; }
    }
    return best;
  }

  // ---------------------------------------------------------- selection
  setSelection(list, sound = true) {
    for (const e of this.selection) e.selected = false;
    this.selection = list.filter((e) => e.alive);
    for (const e of this.selection) e.selected = true;
    if (sound && list.length) this.audio.play('select');
    this.ui.selectionChanged();
  }
  own() { return this.selection.filter((e) => e.alive && e.team === 0); }
  pruneSelection() {
    if (this.selection.some((e) => !e.alive || (e.team !== 0 && !this.world.canSee(0, e)))) {
      this.setSelection(this.selection.filter((e) => e.alive && (e.team === 0 || this.world.canSee(0, e))), false);
    }
  }

  boxSelect(x0, y0, x1, y1, additive) {
    const w = this.world;
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    const inBox = (e) => {
      const p = this.project(e.x, (e.kind === 'building' ? e.y : w.map.heightAt(e.x, e.z)) + 1, e.z);
      return p.z < 1 && p.x >= lx && p.x <= hx && p.y >= ly && p.y <= hy;
    };
    let list = w.entities.filter((e) => e.alive && e.team === 0 && e.kind === 'unit' && inBox(e));
    const army = list.filter((u) => u.type !== 'skimmer');
    if (army.length) list = army;
    if (!list.length) list = w.entities.filter((e) => e.alive && e.team === 0 && e.kind === 'building' && inBox(e));
    if (additive) list = [...new Set([...this.own(), ...list])];
    this.setSelection(list);
  }

  clickSelect(sx, sy, additive, double) {
    const e = this.pickEntity(sx, sy);
    if (!e) { if (!additive) this.setSelection([]); return; }
    if (double && e.team === 0) {
      const r = this.canvas.getBoundingClientRect();
      const all = this.world.entities.filter((o) => {
        if (!o.alive || o.team !== 0 || o.type !== e.type) return false;
        const p = this.project(o.x, o.kind === 'building' ? o.y : this.world.map.heightAt(o.x, o.z), o.z);
        return p.z < 1 && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
      });
      this.setSelection(all);
      return;
    }
    if (additive && e.team === 0) {
      const own = this.own();
      if (own.includes(e)) this.setSelection(own.filter((o) => o !== e));
      else this.setSelection([...own, e]);
      return;
    }
    this.setSelection([e]);
  }

  // ---------------------------------------------------------- commands
  command(x, z, hit, attackMove = false) {
    const w = this.world;
    const sel = this.own();
    if (!sel.length) return;
    const units = sel.filter((e) => e.kind === 'unit');
    const blds = sel.filter((e) => e.kind === 'building' && e.def.produces);
    const n = w.map.n;
    let marker = 0x8dffa8;
    if (units.length) {
      if (hit && hit.team !== 0) {
        w.orderAttack(units, hit);
        marker = 0xff5a5a;
      } else if (hit && hit.team === 0 && hit.def.dropoff && units.some((u) => u.type === 'skimmer')) {
        w.orderReturn(units.filter((u) => u.type === 'skimmer'));
        const rest = units.filter((u) => u.type !== 'skimmer');
        if (rest.length) w.orderMove(rest, x, z);
      } else {
        const k = w.map.cellOf(z) * n + w.map.cellOf(x);
        const sk = units.filter((u) => u.type === 'skimmer');
        if (w.map.res[k] > 1 && sk.length) {
          w.orderHarvest(sk, k);
          marker = 0xff7cbc;
          const rest = units.filter((u) => u.type !== 'skimmer');
          if (rest.length) w.orderMove(rest, x, z, attackMove);
        } else {
          w.orderMove(units, x, z, attackMove);
          if (attackMove) marker = 0xffb35a;
        }
      }
    }
    for (const b of blds) b.rally = { x, z, target: hit && hit.team !== 0 ? hit : null };
    w.fx.marker(x, w.map.heightAt(x, z), z, marker);
    this.audio.play('order');
  }

  // ---------------------------------------------------------- placement
  beginPlacement(type) {
    this.cancelMode();
    this.mode = 'place';
    this.placeType = type;
    const def = BUILDINGS[type];
    const model = buildModel(type, this.world.player.faction);
    model.root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.material = ghostOk; } });
    const foot = new THREE.Mesh(new THREE.PlaneGeometry(def.size * CELL, def.size * CELL), ghostOk);
    foot.rotation.x = -Math.PI / 2; foot.position.y = 0.2;
    model.root.add(foot);
    this.ghost = model.root;
    this.ghostMeshes = [];
    model.root.traverse((o) => { if (o.isMesh) this.ghostMeshes.push(o); });
    this.world.scene.add(this.ghost);
    // show lattice fields
    this.fieldRings = [];
    for (const b of this.world.fieldSources(0)) {
      const r = b.def.field * CELL;
      const g = new THREE.RingGeometry(r - 0.25, r, 64); g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: this.world.player.faction.color, transparent: true, opacity: 0.5, depthWrite: false }));
      const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: this.world.player.faction.color, transparent: true, opacity: 0.06, depthWrite: false }));
      m.add(fill);
      m.position.set(b.x, b.y + 0.5, b.z);
      m.renderOrder = 7; fill.renderOrder = 7;
      this.world.scene.add(m);
      this.fieldRings.push(m);
    }
    this.updateGhost();
  }
  placementCell() {
    const def = BUILDINGS[this.placeType];
    const g = this.ground(this.mx, this.my);
    if (!g) return null;
    const ci = Math.round(g.x / CELL - def.size / 2), cj = Math.round(g.z / CELL - def.size / 2);
    return [ci, cj];
  }
  updateGhost() {
    if (this.mode !== 'place' || !this.ghost) return;
    const c = this.placementCell();
    if (!c) return;
    const def = BUILDINGS[this.placeType];
    const [ci, cj] = c;
    const x = (ci + def.size / 2) * CELL, z = (cj + def.size / 2) * CELL;
    this.ghost.position.set(x, this.world.map.heightAt(x, z), z);
    const err = this.world.canPlace(this.placeType, 0, ci, cj) || (this.world.player.res < def.cost ? 'Not enough resonance' : null);
    const mat = err ? ghostBad : ghostOk;
    for (const m of this.ghostMeshes) m.material = mat;
    this.placeErr = err;
  }
  tryPlace(keep) {
    const c = this.placementCell();
    if (!c) return;
    const err = this.world.build(this.placeType, 0, c[0], c[1]);
    if (err) { this.ui.toast(err, 'bad'); this.audio.play('error'); return; }
    if (!keep) this.cancelMode();
  }
  clearGhost() {
    if (this.ghost) { this.world.scene.remove(this.ghost); this.ghost = null; }
    if (this.fieldRings) { for (const r of this.fieldRings) this.world.scene.remove(r); this.fieldRings = null; }
  }
  cancelMode() {
    this.clearGhost();
    this.mode = 'normal';
    this.placeType = null;
    this.canvas.style.cursor = '';
    this.ui.modeChanged();
  }
  beginAttackMove() {
    if (!this.own().some((e) => e.kind === 'unit')) return;
    this.cancelMode();
    this.mode = 'amove';
    this.canvas.style.cursor = 'crosshair';
    this.ui.modeChanged();
  }

  // ---------------------------------------------------------- pointer
  pointerDown(e) {
    if (this.world.over) return;
    this.mx = e.clientX; this.my = e.clientY;
    if (e.pointerType === 'touch') return this.touchDown(e);
    if (e.button === 1) { e.preventDefault(); this.drag = { kind: 'pan', x: e.clientX, y: e.clientY, alt: e.altKey }; return; }
    if (e.button === 0) {
      if (this.mode === 'place') { this.tryPlace(e.shiftKey); return; }
      if (this.mode === 'amove') {
        const g = this.ground(e.clientX, e.clientY);
        if (g) this.command(g.x, g.z, this.pickEntity(e.clientX, e.clientY), true);
        if (!e.shiftKey) this.cancelMode();
        return;
      }
      this.drag = { kind: 'select', x: e.clientX, y: e.clientY, shift: e.shiftKey };
    } else if (e.button === 2) {
      if (this.mode !== 'normal') { this.cancelMode(); return; }
      const g = this.ground(e.clientX, e.clientY);
      if (g) this.command(g.x, g.z, this.pickEntity(e.clientX, e.clientY));
    }
  }
  pointerMove(e) {
    this.mx = e.clientX; this.my = e.clientY;
    if (e.pointerType === 'touch') return this.touchMove(e);
    if (this.drag && this.drag.kind === 'pan') {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (this.drag.alt) this.rig.yaw -= dx * 0.006;
      else this.rig.pan(-dx * 0.12, dy * 0.12);
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
      const hit = this.pickEntity(e.clientX, e.clientY);
      const dbl = hit && now - this.lastClick.t < 350 && this.lastClick.id === hit.id;
      this.lastClick = { t: now, id: hit ? hit.id : 0 };
      this.clickSelect(e.clientX, e.clientY, d.shift, dbl);
    }
  }

  // touch: one finger taps select/command and drags to pan, two fingers pinch-zoom
  touchDown(e) {
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }
  touchMove(e) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY;
    if (this.touches.size === 2 && this.pinch) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.rig.zoom(this.pinch / d);
      this.pinch = d;
    } else if (this.touches.size === 1) {
      this.rig.pan(-dx * 0.15, dy * 0.15);
    }
  }
  touchUp(e) {
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    if (!t || this.touches.size > 0) return;
    const moved = Math.hypot(e.clientX - t.sx, e.clientY - t.sy);
    if (moved > 12 || performance.now() - t.t > 500) return;
    if (this.mode === 'place') { this.mx = e.clientX; this.my = e.clientY; this.tryPlace(false); return; }
    const hit = this.pickEntity(e.clientX, e.clientY);
    const g = this.ground(e.clientX, e.clientY);
    if (this.mode === 'amove') { if (g) this.command(g.x, g.z, hit, true); this.cancelMode(); return; }
    if (hit && hit.team === 0) { this.setSelection([hit]); return; }
    if (this.own().length && g) this.command(g.x, g.z, hit);
    else this.setSelection(hit ? [hit] : []);
  }

  // ---------------------------------------------------------- keyboard
  keyDown(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const k = e.key.toLowerCase();
    this.keys.add(k);
    if (k === 'escape') {
      if (this.mode !== 'normal') this.cancelMode();
      else this.ui.togglePause();
      return;
    }
    if (this.world.over || this.ui.paused) return;
    if (/^[0-9]$/.test(k)) {
      const n = +k;
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.groups[n] = this.own().slice(); this.ui.toast(`Group ${n} set`, 'info'); return; }
      if (e.shiftKey) { this.groups[n] = [...new Set([...this.groups[n], ...this.own()])]; return; }
      const g = this.groups[n].filter((x) => x.alive);
      this.groups[n] = g;
      if (!g.length) return;
      const now = performance.now();
      if (this.lastGroupTap.n === n && now - this.lastGroupTap.t < 400) {
        const cx = g.reduce((s, u) => s + u.x, 0) / g.length, cz = g.reduce((s, u) => s + u.z, 0) / g.length;
        this.rig.jump(cx, cz);
      }
      this.lastGroupTap = { n, t: now };
      this.setSelection(g);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === ' ') {
      e.preventDefault();
      const a = this.world.player.alertPos;
      const core = this.world.entities.find((x) => x.alive && x.team === 0 && x.type === 'core');
      if (a && this.world.time - this.world.player.lastAlert < 20) this.rig.jump(a.x, a.z);
      else if (core) this.rig.jump(core.x, core.z);
      return;
    }
    if (k === 'q') { this.rig.yaw += 0.2; return; }
    if (k === 'e') { this.rig.yaw -= 0.2; return; }
    if (k === 'a') { this.beginAttackMove(); return; }
    if (k === 's') { this.world.orderStop(this.own()); return; }
    if (k === 'h') { this.world.orderStop(this.own(), true); return; }
    if (k === 'x' || k === 'delete') { for (const b of this.own().filter((x) => x.kind === 'building')) this.world.recycle(b); return; }
    if (k === 'tab') { e.preventDefault(); return; }
    this.ui.hotkey(k, e);
  }

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
    this.pruneSelection();
    this.hover = this.mode === 'normal' && !this.drag ? this.pickEntity(this.mx, this.my) : null;
    if (this.mode === 'normal') this.canvas.style.cursor = this.hover && this.hover.team !== 0 && this.own().some((u) => u.kind === 'unit') ? 'crosshair' : '';
  }
}
