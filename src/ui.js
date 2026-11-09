import { CELL, WORLD, UNITS, BUILDINGS, BUILD_ORDER, SUPPLY_MAX, RES_COLOR } from './config.js';

const ICON = {
  skimmer: '<path d="M3 15h18l-2.5 3h-13z"/><path d="M5 15l1.5-3h11l1.5 3"/><path d="M11 8l1.5-2 1.5 2-1.5 3z"/>',
  needle: '<path d="M3 12l17-4-4 4 4 4z"/><path d="M8 12h5"/>',
  warden: '<path d="M8 7h8v5H8z"/><path d="M16 9h5"/><path d="M9 12l-1 7M15 12l1 7M6 19h4M14 19h4"/>',
  mender: '<circle cx="12" cy="12" r="3.5"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/><path d="M12 4v2M12 18v2"/>',
  bastion: '<path d="M4 17l2-5h12l2 5z"/><path d="M9 12l1-3h4l1 3"/><path d="M13 10l7-5"/>',
  core: '<path d="M12 2l4 6-4 6-4-6z"/><path d="M4 22l2-6h12l2 6z"/><path d="M7 16l1-3M17 16l-1-3"/>',
  pylon: '<path d="M10 21h4l-1-14h-2z"/><ellipse cx="12" cy="6" rx="4" ry="1.5"/><path d="M12 2v2"/>',
  resonator: '<path d="M3 20h18v-3H3z"/><path d="M6 17V8M8 17V8M11 17V6M13 17V6M16 17V8M18 17V8"/>',
  siphon: '<path d="M4 20h16"/><path d="M6 20a6 6 0 0112 0"/><path d="M9 10l1.5-5h3L15 10"/>',
  foundry: '<path d="M3 20V10l6 3V10l6 3V6h4v14z"/><path d="M8 17h3M13 17h3"/>',
  spire: '<path d="M9 21h6l-1-11h-4z"/><path d="M8 7l4-5 4 5-4 3z"/>',
  uplink: '<path d="M5 9a7 7 0 0014 0z"/><path d="M12 9V4M12 16v5M8 21h8"/>',
  stop: '<rect x="6" y="6" width="12" height="12"/>',
  hold: '<path d="M7 4v16M17 4v16M7 12h10"/>',
  amove: '<path d="M4 20L20 4"/><path d="M13 4h7v7"/><path d="M4 13l7 7"/>',
  recycle: '<path d="M7 7h10l-1 13H8z"/><path d="M5 7h14M10 4h4"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ''}</svg>`;
const fmtTime = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const $ = (id) => document.getElementById(id);

export class UI {
  constructor(audio) {
    this.audio = audio;
    this.hud = $('hud');
    this.overlay = $('overlay');
    this.octx = this.overlay.getContext('2d');
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.tooltip = $('tooltip');
    this.toasts = $('toasts');
    this.paused = false;
    this.refreshT = 0;
    this.miniT = 0;
    this.dirty = true;
    this.buildButtons();
    this.bindMinimap();
    this.bindPanels();
  }

  attach(world, input, rig) {
    this.world = world; this.input = input; this.rig = rig;
    this.paused = false;
    this.miniBase = null;
    this.toasts.innerHTML = '';
    document.documentElement.style.setProperty('--team', world.player.faction.css);
    this.dirty = true;
  }

  // ---------------------------------------------------------------- buttons
  buildButtons() {
    const bg = $('build-grid');
    this.buildBtns = {};
    for (const id of BUILD_ORDER) {
      const d = BUILDINGS[id];
      const b = document.createElement('button');
      b.className = 'cmd';
      b.id = `build-${id}`;
      b.innerHTML = `${svg(id)}<kbd>${d.key}</kbd><span class="cost">${d.cost}</span>`;
      b.setAttribute('aria-label', `Weave ${d.name}`);
      b.addEventListener('click', () => this.startBuild(id));
      this.tip(b, () => this.tipFor(d));
      bg.appendChild(b);
      this.buildBtns[id] = b;
    }
    const pg = $('prod-grid');
    this.prodBtns = {};
    for (const id of Object.keys(UNITS)) {
      const d = UNITS[id];
      const b = document.createElement('button');
      b.className = 'cmd';
      b.id = `train-${id}`;
      b.innerHTML = `${svg(id)}<kbd>${d.key}</kbd><span class="cost">${d.cost}</span>`;
      b.setAttribute('aria-label', `Train ${d.name}`);
      b.addEventListener('click', () => this.train(id));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); this.untrain(id); });
      this.tip(b, () => this.tipFor(d));
      pg.appendChild(b);
      this.prodBtns[id] = b;
    }
    const ag = $('act-grid');
    this.actBtns = {};
    const acts = [
      ['amove', 'Attack-move', 'A', 'Move and engage anything hostile on the way.', () => this.input.beginAttackMove()],
      ['stop', 'Stop', 'S', 'Halt and clear orders.', () => this.world.orderStop(this.input.own())],
      ['hold', 'Hold ground', 'H', 'Stay put and only fire at targets in range.', () => this.world.orderStop(this.input.own(), true)],
      ['recycle', 'Recycle', 'X', 'Dismantle the structure. Refunds 40% (75% while still weaving).', () => { for (const b of this.input.own().filter((e) => e.kind === 'building')) this.world.recycle(b); }],
    ];
    for (const [id, name, key, desc, fn] of acts) {
      const b = document.createElement('button');
      b.className = 'cmd act';
      b.id = `act-${id}`;
      b.innerHTML = `${svg(id)}<kbd>${key}</kbd>`;
      b.setAttribute('aria-label', name);
      b.addEventListener('click', fn);
      this.tip(b, () => `<strong>${name}</strong><p>${desc}</p>`);
      ag.appendChild(b);
      this.actBtns[id] = b;
    }
  }

  tip(el, fn) {
    el.addEventListener('pointerenter', () => {
      this.tooltip.innerHTML = fn();
      this.tooltip.hidden = false;
      const r = el.getBoundingClientRect();
      const tr = this.tooltip.getBoundingClientRect();
      this.tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tr.width - 8, r.left + r.width / 2 - tr.width / 2))}px`;
      this.tooltip.style.top = `${Math.max(8, r.top - tr.height - 10)}px`;
    });
    el.addEventListener('pointerleave', () => { this.tooltip.hidden = true; });
  }

  tipFor(d) {
    const w = this.world;
    const miss = w ? w.missingRequirement(0, d) : null;
    const stats = [];
    stats.push(`<span>${d.cost} resonance</span>`);
    stats.push(`<span>${d.time}s</span>`);
    if (d.supply && d.kind === 'unit') stats.push(`<span>${d.supply} supply</span>`);
    if (d.supply && d.kind === 'building') stats.push(`<span>+${d.supply} supply</span>`);
    if (d.weapon) stats.push(`<span>${d.weapon.dmg} ${d.weapon.type} · range ${d.weapon.range}</span>`);
    stats.push(`<span>${d.hp} hp · ${d.armor}</span>`);
    return `<strong>${d.name}</strong> <kbd>${d.key}</kbd>${d.role ? `<em>${d.role}</em>` : ''}
      <div class="tip-stats">${stats.join('')}</div><p>${d.desc}</p>${miss ? `<p class="req">Requires ${miss}</p>` : ''}`;
  }

  startBuild(id) {
    const w = this.world;
    const d = BUILDINGS[id];
    const miss = w.missingRequirement(0, d);
    if (miss) return this.fail(`Requires ${miss}`);
    if (!w.fieldSources(0).length) return this.fail('No lattice field: you need a Core or Pylon');
    if (w.player.res < d.cost) return this.fail('Not enough resonance');
    this.input.beginPlacement(id);
  }
  producers(type) {
    return this.input.own().filter((e) => e.kind === 'building' && !e.constructing && e.def.produces && e.def.produces.includes(type));
  }
  train(id) {
    const ps = this.producers(id);
    if (!ps.length) return;
    ps.sort((a, b) => a.queue.length - b.queue.length);
    const err = this.world.enqueue(ps[0], id);
    if (err) this.fail(err); else { this.audio.play('select'); this.dirty = true; }
  }
  untrain(id) {
    const ps = this.producers(id).filter((b) => b.queue.includes(id));
    if (!ps.length) return;
    ps.sort((a, b) => b.queue.length - a.queue.length);
    this.world.dequeue(ps[0], ps[0].queue.lastIndexOf(id));
    this.dirty = true;
  }
  fail(msg) { this.toast(msg, 'bad'); this.audio.play('error'); }

  hotkey(k) {
    const up = k.toUpperCase();
    // production first when a producer is selected
    const sel = this.input.own();
    const prodTypes = new Set();
    for (const e of sel) if (e.kind === 'building' && e.def.produces && !e.constructing) e.def.produces.forEach((p) => prodTypes.add(p));
    for (const id of prodTypes) if (UNITS[id].key === up) return this.train(id);
    for (const id of BUILD_ORDER) if (BUILDINGS[id].key === up) return this.startBuild(id);
  }

  // ---------------------------------------------------------------- panels
  bindPanels() {
    $('selpanel').addEventListener('click', (e) => {
      const q = e.target.closest('[data-q]');
      if (q) { const b = this.world.byId.get(+q.dataset.b); if (b) { this.world.dequeue(b, +q.dataset.q); this.dirty = true; } return; }
      const s = e.target.closest('[data-sel]');
      if (s) {
        const ent = this.world.byId.get(+s.dataset.sel);
        if (!ent) return;
        if (e.shiftKey) this.input.setSelection(this.input.own().filter((x) => x !== ent));
        else this.input.setSelection([ent]);
      }
    });
  }
  selectionChanged() { this.dirty = true; }
  modeChanged() { this.dirty = true; }

  toast(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.prepend(el);
    while (this.toasts.children.length > 4) this.toasts.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3200);
  }

  togglePause(force) {
    if (!this.world || this.world.over) return;
    this.paused = force !== undefined ? force : !this.paused;
    $('pause-screen').hidden = !this.paused;
  }

  refreshPanels() {
    const w = this.world, T = w.player;
    $('res-val').textContent = Math.floor(T.res);
    const sup = $('sup-val');
    sup.textContent = `${T.supplyUsed} / ${T.supplyCap}`;
    sup.parentElement.classList.toggle('capped', T.supplyUsed >= T.supplyCap && T.supplyCap < SUPPLY_MAX);
    $('time-val').textContent = fmtTime(w.time);

    const hasField = w.fieldSources(0).length > 0;
    for (const id of BUILD_ORDER) {
      const d = BUILDINGS[id], b = this.buildBtns[id];
      const locked = !!w.missingRequirement(0, d) || !hasField;
      b.classList.toggle('locked', locked);
      b.classList.toggle('poor', !locked && T.res < d.cost);
      b.classList.toggle('active', this.input.mode === 'place' && this.input.placeType === id);
    }

    const sel = this.input.own();
    const prodTypes = new Set();
    for (const e of sel) if (e.kind === 'building' && e.def.produces && !e.constructing) e.def.produces.forEach((p) => prodTypes.add(p));
    $('prod-wrap').hidden = prodTypes.size === 0;
    for (const id of Object.keys(UNITS)) {
      const b = this.prodBtns[id], d = UNITS[id];
      b.hidden = !prodTypes.has(id);
      if (b.hidden) continue;
      const locked = !!w.missingRequirement(0, d);
      b.classList.toggle('locked', locked);
      b.classList.toggle('poor', !locked && (T.res < d.cost || T.supplyUsed + d.supply > T.supplyCap));
      const queued = sel.reduce((s, e) => s + (e.queue ? e.queue.filter((q) => q === id).length : 0), 0);
      let badge = b.querySelector('.qn');
      if (queued) { if (!badge) { badge = document.createElement('span'); badge.className = 'qn'; b.appendChild(badge); } badge.textContent = queued; }
      else if (badge) badge.remove();
    }
    const hasUnits = sel.some((e) => e.kind === 'unit');
    const hasArmed = sel.some((e) => e.kind === 'unit' && e.def.weapon);
    this.actBtns.amove.hidden = !hasArmed;
    this.actBtns.stop.hidden = !hasUnits;
    this.actBtns.hold.hidden = !hasUnits;
    this.actBtns.recycle.hidden = !sel.some((e) => e.kind === 'building');
    this.actBtns.amove.classList.toggle('active', this.input.mode === 'amove');
    $('act-wrap').hidden = !hasUnits && !sel.some((e) => e.kind === 'building');

    this.refreshSelection();
  }

  refreshSelection() {
    const p = $('selpanel');
    const sel = this.input.selection.filter((e) => e.alive);
    if (!sel.length) {
      const T = this.world.player;
      p.innerHTML = `<div class="sel-empty"><h2>${T.faction.name}</h2>
        <p>Drag to select. Right-click to move, attack or harvest. Weave structures from the panel on the right, inside your lattice field.</p>
        <dl class="mini-stats"><div><dt>Harvested</dt><dd>${T.stats.harvested}</dd></div><div><dt>Units trained</dt><dd>${T.stats.unitsBuilt}</dd></div><div><dt>Kills</dt><dd>${T.stats.kills}</dd></div></dl></div>`;
      return;
    }
    if (sel.length === 1) {
      const e = sel[0], d = e.def;
      const own = e.team === 0;
      const frac = e.hp / e.maxHp;
      const fac = this.world.teams[e.team].faction;
      let extra = '';
      if (e.kind === 'building' && e.constructing) {
        extra = `<div class="prog"><span>${e.waiting ? 'Waiting for a free weaver' : 'Weaving'}</span><div class="bar"><i style="width:${(e.progress * 100).toFixed(1)}%"></i></div></div>`;
      } else if (e.kind === 'building' && e.def.produces && own) {
        const slots = [];
        for (let i = 0; i < 5; i++) {
          const q = e.queue[i];
          if (q) {
            const pr = i === 0 ? Math.min(1, e.prog / UNITS[q].time) : 0;
            slots.push(`<button class="qslot" data-b="${e.id}" data-q="${i}" title="Cancel ${UNITS[q].name}">${svg(q)}${i === 0 ? `<i style="height:${(pr * 100).toFixed(0)}%"></i>` : ''}</button>`);
          } else slots.push('<span class="qslot empty"></span>');
        }
        extra = `<div class="queue">${slots.join('')}</div>`;
      } else if (e.type === 'skimmer') {
        extra = `<div class="prog"><span>Cargo ${Math.floor(e.carry)} / ${d.carry}</span><div class="bar res"><i style="width:${(e.carry / d.carry * 100).toFixed(0)}%"></i></div></div>`;
      }
      const facts = [];
      if (d.weapon) facts.push(`<div><dt>Weapon</dt><dd>${d.weapon.dmg} ${d.weapon.type}</dd></div><div><dt>Range</dt><dd>${d.weapon.range}</dd></div>`);
      if (d.heal) facts.push(`<div><dt>Repair</dt><dd>${d.heal.rate}/s</dd></div>`);
      facts.push(`<div><dt>Armour</dt><dd>${d.armor}</dd></div>`);
      if (e.kind === 'unit') facts.push(`<div><dt>Speed</dt><dd>${d.speed}</dd></div>`);
      if (d.supply && e.kind === 'building') facts.push(`<div><dt>Supply</dt><dd>+${d.supply}</dd></div>`);
      if (d.field) facts.push(`<div><dt>Field</dt><dd>${d.field}</dd></div>`);
      const status = e.kind === 'unit' ? ({ idle: 'Idle', move: 'Moving', attack: 'Attacking', amove: 'Advancing', hold: 'Holding', harvest: 'Harvesting' }[e.order.type] || '') : (e.constructing ? 'Under construction' : 'Online');
      p.innerHTML = `<div class="sel-one">
        <div class="portrait" style="color:${fac.css}">${svg(e.type)}</div>
        <div class="sel-body">
          <div class="sel-head"><h2>${d.name}</h2><span class="tag" style="--c:${fac.css}">${own ? status : fac.name}</span></div>
          <div class="hp"><div class="bar ${frac < 0.35 ? 'low' : frac < 0.7 ? 'mid' : ''}"><i style="width:${(frac * 100).toFixed(1)}%"></i></div><span>${Math.ceil(e.hp)} / ${e.maxHp}</span></div>
          ${extra}
          <dl class="facts">${facts.join('')}</dl>
        </div></div>`;
      return;
    }
    const items = sel.slice(0, 36).map((e) => {
      const f = e.hp / e.maxHp;
      return `<button class="unit-chip" data-sel="${e.id}" title="${e.def.name}">${svg(e.type)}<i style="width:${(f * 100).toFixed(0)}%;background:${f < 0.35 ? 'var(--bad)' : f < 0.7 ? 'var(--warn)' : 'var(--good)'}"></i></button>`;
    });
    const counts = {};
    for (const e of sel) counts[e.def.name] = (counts[e.def.name] || 0) + 1;
    p.innerHTML = `<div class="sel-many"><div class="sel-summary">${Object.entries(counts).map(([k, v]) => `<span>${v} × ${k}</span>`).join('')}</div><div class="chips">${items.join('')}</div></div>`;
  }

  // ---------------------------------------------------------------- minimap
  miniXform() {
    const size = this.mini.width;
    const [fx, fz] = this.rig.forward();
    const phi = -Math.PI / 2 - Math.atan2(fz, fx);
    const c = Math.cos(phi), s = Math.sin(phi);
    const scale = size / (WORLD * (Math.abs(c) + Math.abs(s))) * 0.98;
    return { c, s, scale, half: size / 2 };
  }
  toMini(x, z, X) {
    const u = x - WORLD / 2, v = z - WORLD / 2;
    return [X.half + (u * X.c - v * X.s) * X.scale, X.half + (u * X.s + v * X.c) * X.scale];
  }
  fromMini(px, py) {
    const X = this.miniXform();
    const a = (px - X.half) / X.scale, b = (py - X.half) / X.scale;
    return [a * X.c + b * X.s + WORLD / 2, -a * X.s + b * X.c + WORLD / 2];
  }
  bindMinimap() {
    const m = this.mini;
    const pos = (e) => {
      const r = m.getBoundingClientRect();
      return this.fromMini((e.clientX - r.left) / r.width * m.width, (e.clientY - r.top) / r.height * m.height);
    };
    let dragging = false;
    m.addEventListener('contextmenu', (e) => e.preventDefault());
    m.addEventListener('pointerdown', (e) => {
      if (!this.world) return;
      const [x, z] = pos(e);
      if (e.button === 2) { this.input.command(x, z, null, this.input.mode === 'amove'); if (this.input.mode === 'amove') this.input.cancelMode(); return; }
      if (this.input.mode === 'amove' && e.button === 0) { this.input.command(x, z, null, true); this.input.cancelMode(); return; }
      dragging = true; m.setPointerCapture(e.pointerId);
      this.rig.jump(x, z);
    });
    m.addEventListener('pointermove', (e) => { if (dragging) { const [x, z] = pos(e); this.rig.jump(x, z); } });
    m.addEventListener('pointerup', () => { dragging = false; });
  }
  buildMiniBase() {
    const map = this.world.map, n = map.n;
    const c = document.createElement('canvas'); c.width = n; c.height = n;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(n, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const h = map.heightAt((i + 0.5) * CELL, (j + 0.5) * CELL);
      let r, g, b;
      if (map.rock[k]) { r = 22; g = 18; b = 32; }
      else { const t = Math.min(1, h / 3.4); r = 58 + t * 70; g = 48 + t * 60; b = 80 + t * 60; }
      img.data[k * 4] = r; img.data[k * 4 + 1] = g; img.data[k * 4 + 2] = b; img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.miniBase = c;
    this.fogCanvas = document.createElement('canvas'); this.fogCanvas.width = n; this.fogCanvas.height = n;
    this.fogImg = this.fogCanvas.getContext('2d').createImageData(n, n);
  }
  drawMinimap() {
    const w = this.world, ctx = this.mctx, size = this.mini.width, n = w.map.n;
    if (!this.miniBase) this.buildMiniBase();
    const X = this.miniXform();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const sc = X.scale * CELL;
    // world-space transform: cell (i,j) -> mini
    const tx = X.half + (-WORLD / 2 * X.c + WORLD / 2 * X.s) * X.scale;
    const ty = X.half + (-WORLD / 2 * X.s - WORLD / 2 * X.c) * X.scale;
    ctx.setTransform(X.c * sc, X.s * sc, -X.s * sc, X.c * sc, tx, ty);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.miniBase, 0, 0);
    // resources
    ctx.fillStyle = hex(RES_COLOR);
    for (const v of w.map.vents) for (const k of v.cells) if (w.map.res[k] > 20 && w.vis.vis[k]) ctx.fillRect(k % n, (k / n) | 0, 1, 1);
    // fog
    const d = this.fogImg.data, vis = w.vis.vis;
    for (let k = 0; k < n * n; k++) { d[k * 4] = 7; d[k * 4 + 1] = 5; d[k * 4 + 2] = 15; d[k * 4 + 3] = vis[k] === 2 ? 0 : vis[k] === 1 ? 120 : 235; }
    this.fogCanvas.getContext('2d').putImageData(this.fogImg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogCanvas, 0, 0);
    // entities
    for (const e of w.entities) {
      if (!e.alive || !w.canSee(0, e)) continue;
      ctx.fillStyle = e.selected ? '#ffffff' : w.teams[e.team].faction.css;
      if (e.kind === 'building') ctx.fillRect(e.ci, e.cj, e.size, e.size);
      else { const s = e.radius > 1.2 ? 1.6 : 1.1; ctx.fillRect(e.x / CELL - s / 2, e.z / CELL - s / 2, s, s); }
    }
    // camera view
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const r = this.overlay.getBoundingClientRect();
    const corners = [[0, 0], [r.width, 0], [r.width, r.height], [0, r.height]].map(([x, y]) => this.input.ground(r.left + x, r.top + Math.max(y, r.height * 0.02)));
    if (corners.every(Boolean)) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      corners.forEach((p, i) => { const [x, y] = this.toMini(p.x, p.z, X); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath(); ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- overlay (hp bars, drag box)
  resize(wd, ht, dpr) {
    this.overlay.width = wd * dpr; this.overlay.height = ht * dpr;
    this.overlay.style.width = `${wd}px`; this.overlay.style.height = `${ht}px`;
    this.dpr = dpr;
  }
  drawOverlay() {
    const ctx = this.octx, w = this.world, inp = this.input;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const now = w.time;
    for (const e of w.entities) {
      if (!e.alive || !e.model.root.visible) continue;
      const show = e.selected || now - e.lastHit < 3 || e === inp.hover || (e.kind === 'building' && e.constructing && e.team === 0);
      if (!show) continue;
      const top = e.kind === 'building' ? e.y + 3 + e.size : w.map.heightAt(e.x, e.z) + 2.6 + e.radius;
      const p = inp.project(e.x, top, e.z);
      if (p.z > 1) continue;
      const bw = e.kind === 'building' ? 22 + e.size * 12 : 18 + e.radius * 14, bh = 4;
      const x = p.x - bw / 2, y = p.y;
      const f = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = 'rgba(8,6,16,0.75)'; ctx.fillRect(x - 1, y - 1, bw + 2, bh + 2);
      ctx.fillStyle = e.team !== 0 ? '#ff6a6a' : f < 0.35 ? '#ff6a6a' : f < 0.7 ? '#ffc861' : '#8dffa8';
      ctx.fillRect(x, y, bw * f, bh);
      if (e.kind === 'building' && e.constructing) {
        ctx.fillStyle = 'rgba(8,6,16,0.75)'; ctx.fillRect(x - 1, y + bh + 1, bw + 2, 4);
        ctx.fillStyle = w.teams[e.team].faction.css; ctx.fillRect(x, y + bh + 2, bw * e.progress, 2);
      }
      if (e.type === 'skimmer' && e.carry > 1 && e.team === 0) {
        ctx.fillStyle = 'rgba(8,6,16,0.75)'; ctx.fillRect(x - 1, y + bh + 1, bw + 2, 4);
        ctx.fillStyle = hex(RES_COLOR); ctx.fillRect(x, y + bh + 2, bw * e.carry / e.def.carry, 2);
      }
    }
    // rally lines
    for (const b of inp.own()) {
      if (b.kind !== 'building' || !b.rally) continue;
      const a = inp.project(b.x, b.y + 1, b.z), c = inp.project(b.rally.x, w.map.heightAt(b.rally.x, b.rally.z) + 0.3, b.rally.z);
      if (a.z > 1 || c.z > 1) continue;
      ctx.strokeStyle = 'rgba(141,255,168,0.7)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.stroke();
    }
    // drag box
    const d = inp.drag;
    if (d && d.kind === 'select' && Math.hypot(inp.mx - d.x, inp.my - d.y) > 6) {
      ctx.strokeStyle = 'rgba(141,255,168,0.9)'; ctx.fillStyle = 'rgba(141,255,168,0.08)'; ctx.lineWidth = 1;
      ctx.fillRect(d.x, d.y, inp.mx - d.x, inp.my - d.y);
      ctx.strokeRect(d.x + 0.5, d.y + 0.5, inp.mx - d.x, inp.my - d.y);
    }
    // placement hint
    if (inp.mode === 'place' && inp.placeErr) {
      ctx.font = '600 13px "IBM Plex Sans Condensed", system-ui, sans-serif';
      const t = inp.placeErr;
      const tw = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(8,6,16,0.8)'; ctx.fillRect(inp.mx + 16, inp.my + 14, tw + 14, 22);
      ctx.fillStyle = '#ff8a8a'; ctx.fillText(t, inp.mx + 23, inp.my + 29);
    }
  }

  update(dt) {
    if (!this.world) return;
    for (const ev of this.world.events.splice(0)) {
      if (ev.type === 'msg') this.toast(ev.text, ev.kind);
      else if (ev.type === 'alert') this.toast(`${ev.text}: press Space to look`, 'bad');
    }
    this.refreshT -= dt;
    if (this.dirty || this.refreshT <= 0) { this.refreshPanels(); this.refreshT = 0.2; this.dirty = false; }
    this.miniT -= dt;
    if (this.miniT <= 0) { this.drawMinimap(); this.miniT = 0.12; }
    this.drawOverlay();
  }
}
