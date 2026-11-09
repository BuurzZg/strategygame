import { R } from '../render/worldrenderer.js';
import { RES_COLOR } from '../render/terrain.js';

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
  beacon: '<path d="M12 3v3M8 21l4-12 4 12"/><circle cx="12" cy="7" r="2"/><path d="M5 5a9 9 0 000 6M19 5a9 9 0 010 6"/>',
  deepdrill: '<path d="M4 21h16M6 21V9h12v12"/><path d="M12 3v14M9 14l3 4 3-4"/><path d="M8 9l1-4h6l1 4"/>',
  stop: '<rect x="6" y="6" width="12" height="12"/>',
  hold: '<path d="M7 4v16M17 4v16M7 12h10"/>',
  engage: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><circle cx="12" cy="12" r="3"/>',
  amove: '<path d="M4 20L20 4"/><path d="M13 4h7v7"/><path d="M4 13l7 7"/>',
  recycle: '<path d="M7 7h10l-1 13H8z"/><path d="M5 7h14M10 4h4"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ''}</svg>`;
const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const $ = (id) => document.getElementById(id);
const nameOf = (info) => info.traitInfo('Tooltip')?.Name || info.name;
const STATUS = { Moving: 'Moving', Attacking: 'Attacking', Advancing: 'Advancing', Harvesting: 'Harvesting', Delivering: 'Delivering' };

export class Hud {
  constructor(audio) {
    this.audio = audio;
    this.overlay = $('overlay');
    this.octx = this.overlay.getContext('2d');
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.tooltip = $('tooltip');
    this.toasts = $('toasts');
    this.paused = false;
    this.refreshT = 0; this.miniT = 0; this.dirty = true;
    this.stallT = 0;
    this.bindMinimap();
    this.bindPanels();
  }

  attach(session, input) {
    this.s = session; this.world = session.world; this.viewer = session.viewer; this.input = input; this.rig = session.rig; this.renderer = session.renderer;
    this.paused = false; this.miniBase = null; this.toasts.innerHTML = '';
    this.speakers = session.speakers || new Map();
    $('comms').innerHTML = '';
    const mission = !!(this.viewer && this.viewer.objectives && this.viewer.objectives.enabled);
    $('btn-objectives').hidden = !mission;
    $('objectives').hidden = true;
    $('mission-timer').hidden = true;
    this.objOpenUntil = mission ? performance.now() + 9000 : 0;
    this.desyncShown = false;
    document.documentElement.style.setProperty('--team', this.viewer ? this.renderer.styleOf(this.viewer).css : '#c9c3d3');
    document.body.classList.toggle('spectating', !this.viewer);
    this.buildButtons();
    this.dirty = true;
  }

  // ---------------------------------------------------------------- buttons from rules
  buildButtons() {
    const rules = this.world.rules;
    const bg = $('build-grid'), pg = $('prod-grid'), ag = $('act-grid');
    bg.innerHTML = ''; pg.innerHTML = ''; ag.innerHTML = '';
    this.buildBtns = {};
    for (const info of rules.buildablesFor('Structure')) {
      const b = this.cmdButton(info.name, info.traitInfo('Buildable').Hotkey, info.traitInfo('Valued').Cost, `Weave ${nameOf(info)}`);
      b.addEventListener('click', () => this.startBuild(info.name));
      this.tip(b, () => this.tipFor(info));
      bg.appendChild(b); this.buildBtns[info.name] = b;
    }
    this.prodBtns = {};
    const unitTypes = new Set();
    for (const a of rules.actors.values()) { const q = a.traitInfo('ProductionQueue'); if (q) for (const u of rules.buildablesFor(q.Type)) unitTypes.add(u); }
    for (const info of [...unitTypes].sort((x, y) => x.traitInfo('Buildable').BuildPaletteOrder - y.traitInfo('Buildable').BuildPaletteOrder)) {
      const b = this.cmdButton(info.name, info.traitInfo('Buildable').Hotkey, info.traitInfo('Valued').Cost, `Train ${nameOf(info)}`);
      b.addEventListener('click', () => this.train(info.name));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); this.untrain(info.name); });
      this.tip(b, () => this.tipFor(info));
      pg.appendChild(b); this.prodBtns[info.name] = b;
    }
    this.actBtns = {};
    const acts = [
      ['amove', 'Attack-move', 'A', 'Move and engage anything hostile on the way.', () => this.input.beginAttackMove()],
      ['stop', 'Stop', 'S', 'Halt and clear queued orders.', () => this.input.stop()],
      ['hold', 'Hold ground', 'H', 'Stance: fire only at targets in range, never chase.', () => this.input.stance('Defend')],
      ['engage', 'Engage', 'G', 'Stance: chase and attack anything that comes near (default).', () => this.input.stance('AttackAnything')],
      ['recycle', 'Recycle', 'X', 'Dismantle the structure. Refunds 40% (75% while still weaving).', () => this.input.recycle()],
    ];
    for (const [id, name, key, desc, fn] of acts) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'cmd act'; b.id = `act-${id}`;
      b.innerHTML = `${svg(id)}<kbd>${key}</kbd>`;
      b.setAttribute('aria-label', name);
      b.addEventListener('click', fn);
      this.tip(b, () => `<strong>${name}</strong><p>${desc}</p>`);
      ag.appendChild(b); this.actBtns[id] = b;
    }
  }
  cmdButton(type, key, cost, label) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cmd'; b.id = `cmd-${type}`;
    b.innerHTML = `${svg(type)}<kbd>${key}</kbd><span class="cost">${cost}</span>`;
    b.setAttribute('aria-label', label);
    return b;
  }

  tip(el, fn) {
    el.addEventListener('pointerenter', () => {
      this.tooltip.innerHTML = fn();
      this.tooltip.hidden = false;
      const r = el.getBoundingClientRect(), tr = this.tooltip.getBoundingClientRect();
      this.tooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - tr.width - 8, r.left + r.width / 2 - tr.width / 2))}px`;
      this.tooltip.style.top = `${Math.max(8, r.top - tr.height - 10)}px`;
    });
    el.addEventListener('pointerleave', () => { this.tooltip.hidden = true; });
  }

  tipFor(info) {
    const tt = info.traitInfo('Tooltip'), b = info.traitInfo('Buildable');
    const miss = this.viewer ? this.viewer.tech.missing(b.Prerequisites) : null;
    const stats = [`<span>${info.traitInfo('Valued').Cost} resonance</span>`, `<span>${(b.BuildDuration / 25).toFixed(0)}s</span>`];
    const sup = info.traitInfo('ConsumesSupply'); if (sup) stats.push(`<span>${sup.Amount} supply</span>`);
    const ps = info.traitInfo('ProvidesSupply'); if (ps) stats.push(`<span>+${ps.Amount} supply</span>`);
    const arm = info.traitInfo('Armament');
    if (arm) {
      const wpn = this.world.rules.weapons.get(arm.Weapon);
      const dmg = wpn.warheads.find((w) => w.type === 'SpreadDamage');
      stats.push(`<span>${dmg ? dmg.Damage / 100 : 0} dmg · range ${(wpn.Range / 1024).toFixed(1)}</span>`);
    }
    stats.push(`<span>${info.traitInfo('Health').HP / 100} hp · ${info.traitInfo('Armor')?.Type || '-'}</span>`);
    return `<strong>${tt.Name}</strong> <kbd>${b.Hotkey}</kbd>${tt.Role ? `<em>${tt.Role}</em>` : ''}
      <div class="tip-stats">${stats.join('')}</div><p>${tt.Description}</p>${miss ? `<p class="req">Requires ${miss}</p>` : ''}`;
  }

  // ---------------------------------------------------------------- actions
  startBuild(type) {
    const v = this.viewer;
    if (!v || v.outcome) return;
    const info = this.world.rules.actor(type);
    const miss = v.tech.missing(info.traitInfo('Buildable').Prerequisites);
    if (miss) return this.fail(`Requires ${miss}`);
    if (!this.world.fieldSources(v).length) return this.fail('No lattice field: you need a Core or Pylon');
    if (v.resources.cash < info.traitInfo('Valued').Cost) return this.fail('Not enough resonance');
    this.input.beginPlacement(type);
  }
  producers(type) {
    return this.input.own().map((a) => a.enabledTrait('ProductionQueue')).filter((q) => q && q.buildables().some((i) => i.name === type));
  }
  train(type) {
    const qs = this.producers(type);
    if (!qs.length) return;
    qs.sort((a, b) => a.queue.length - b.queue.length || a.self.id - b.self.id);
    const err = qs[0].canQueue(type);
    if (err) return this.fail(err);
    this.input.issue('StartProduction', [qs[0].self], null, type);
    this.audio.play('select');
  }
  untrain(type) {
    const qs = this.producers(type).filter((q) => q.queue.includes(type));
    if (!qs.length) return;
    qs.sort((a, b) => b.queue.length - a.queue.length);
    this.input.issue('CancelProduction', [qs[0].self], null, qs[0].queue.lastIndexOf(type));
  }
  fail(msg) { this.toast(msg, 'bad'); this.audio.play('error'); }

  hotkey(k) {
    const up = k.toUpperCase();
    const prod = new Set();
    for (const a of this.input.own()) { const q = a.enabledTrait('ProductionQueue'); if (q) for (const i of q.buildables()) prod.add(i); }
    for (const info of prod) if (info.traitInfo('Buildable').Hotkey === up) return this.train(info.name);
    for (const info of this.world.rules.buildablesFor('Structure')) if (info.traitInfo('Buildable').Hotkey === up) return this.startBuild(info.name);
  }

  // ---------------------------------------------------------------- panels
  bindPanels() {
    $('selpanel').addEventListener('click', (e) => {
      const q = e.target.closest('[data-q]');
      if (q) { const b = this.world.actorById.get(+q.dataset.b); if (b) this.input.issue('CancelProduction', [b], null, +q.dataset.q); return; }
      const s = e.target.closest('[data-sel]');
      if (s) {
        const a = this.world.actorById.get(+s.dataset.sel);
        if (!a) return;
        this.input.setSelection(e.shiftKey ? this.input.selection.filter((x) => x !== a) : [a]);
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

  // ---------------------------------------------------------------- campaign: comms + objectives
  say(speakerId, text) {
    const sp = this.speakers.get(speakerId) || { name: speakerId, role: '', color: '#c9c3d3' };
    const box = $('comms');
    const el = document.createElement('div');
    el.className = 'comm';
    el.style.setProperty('--c', sp.color);
    const head = document.createElement('div');
    head.className = 'comm-head';
    head.innerHTML = `<span class="comm-dot"></span><strong></strong><em></em>`;
    head.querySelector('strong').textContent = sp.name;
    head.querySelector('em').textContent = sp.role;
    const body = document.createElement('p');
    body.textContent = text;
    el.append(head, body);
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    const life = 5000 + text.length * 45;
    setTimeout(() => el.classList.add('out'), life);
    setTimeout(() => el.remove(), life + 600);
    this.audio.play('comm');
  }
  objectivesEvent(kind, text) {
    this.objOpenUntil = performance.now() + 7000;
    if (kind === 'new') { this.toast(`New objective: ${text}`, 'info'); this.audio.play('objective'); }
    else if (kind === 'done') { this.toast(`Objective complete: ${text}`, 'good'); this.audio.play('objective'); }
    else if (kind === 'failed') this.fail(`Objective failed: ${text}`);
  }
  toggleObjectives() {
    if ($('btn-objectives').hidden) return;
    this.objPinned = !this.objPinned;
    this.objOpenUntil = 0;
  }
  renderObjectives() {
    const v = this.viewer;
    if (!v || !v.objectives || !v.objectives.enabled) return;
    const list = v.objectives.list;
    const now = this.world.frame;
    const fmt = (o) => o.deadline && o.state === 'active' ? ` <span class="obj-time">${fmtTime(Math.max(0, o.deadline - now) / 25)}</span>` : '';
    const html = list.map((o) => `<li class="obj ${o.state} ${o.primary ? '' : 'optional'}"><span class="obj-box" aria-hidden="true"></span><span>${o.text.replace(/</g, '&lt;')}${o.primary ? '' : ' <em>optional</em>'}${fmt(o)}</span></li>`).join('');
    const el = $('objectives-list');
    if (el.innerHTML !== html) el.innerHTML = html;
    $('objectives').hidden = !(this.objPinned || performance.now() < this.objOpenUntil);
    const timed = list.filter((o) => o.deadline && o.state === 'active').sort((a, b) => a.deadline - b.deadline)[0];
    $('mission-timer').hidden = !timed;
    if (timed) {
      const left = Math.max(0, timed.deadline - now) / 25;
      $('timer-val').textContent = fmtTime(left);
      $('mission-timer').classList.toggle('urgent', left < 60);
    }
  }

  togglePause(force) {
    if (!this.s || this.s.over) return;
    this.paused = force !== undefined ? force : !this.paused;
    $('pause-screen').hidden = !this.paused;
  }

  refreshPanels() {
    const w = this.world, v = this.viewer;
    const secs = w.frame / 25;
    $('time-val').textContent = fmtTime(secs);
    if (v) {
      $('res-val').textContent = v.resources.cash;
      const used = v.supply.used(), cap = v.supply.cap();
      const sup = $('sup-val');
      sup.textContent = `${used} / ${cap}`;
      sup.parentElement.classList.toggle('capped', cap > 0 && used >= cap && cap < v.supply.info.Max);
    } else {
      $('res-val').textContent = w.players.map((p) => p.resources.cash).join(' · ');
      $('sup-val').textContent = w.players.map((p) => `${p.supply.used()}/${p.supply.cap()}`).join(' · ');
    }
    if (!v) { $('cmdpanel').hidden = true; this.refreshSelection(); return; }
    $('cmdpanel').hidden = false;

    const hasField = w.fieldSources(v).length > 0;
    for (const [type, b] of Object.entries(this.buildBtns)) {
      const info = w.rules.actor(type);
      const locked = !!v.tech.missing(info.traitInfo('Buildable').Prerequisites) || !hasField;
      b.classList.toggle('locked', locked);
      b.classList.toggle('poor', !locked && v.resources.cash < info.traitInfo('Valued').Cost);
      b.classList.toggle('active', this.input.mode === 'place' && this.input.placeType === type);
    }
    const sel = this.input.own();
    const queues = sel.map((a) => a.enabledTrait('ProductionQueue')).filter(Boolean);
    const prodTypes = new Set();
    for (const q of queues) for (const i of q.buildables()) prodTypes.add(i.name);
    $('prod-wrap').hidden = prodTypes.size === 0;
    for (const [type, b] of Object.entries(this.prodBtns)) {
      b.hidden = !prodTypes.has(type);
      if (b.hidden) continue;
      const info = w.rules.actor(type);
      const locked = !!v.tech.missing(info.traitInfo('Buildable').Prerequisites);
      const need = info.traitInfo('ConsumesSupply')?.Amount || 0;
      b.classList.toggle('locked', locked);
      b.classList.toggle('poor', !locked && (v.resources.cash < info.traitInfo('Valued').Cost || v.supply.used() + need > v.supply.cap()));
      const queued = queues.reduce((s, q) => s + q.queue.filter((t) => t === type).length, 0);
      let badge = b.querySelector('.qn');
      if (queued) { if (!badge) { badge = document.createElement('span'); badge.className = 'qn'; b.appendChild(badge); } badge.textContent = queued; }
      else if (badge) badge.remove();
    }
    const mobile = sel.some((a) => a.mobile), armed = sel.some((a) => a.mobile && a.attack);
    this.actBtns.amove.hidden = !armed;
    this.actBtns.stop.hidden = !mobile;
    this.actBtns.hold.hidden = !armed;
    this.actBtns.engage.hidden = !armed;
    this.actBtns.recycle.hidden = !sel.some((a) => a.building);
    this.actBtns.amove.classList.toggle('active', this.input.mode === 'amove');
    $('act-wrap').hidden = !mobile && !sel.some((a) => a.building);
    this.refreshSelection();
  }

  refreshSelection() {
    const p = $('selpanel'), w = this.world;
    const sel = this.input.selection.filter((a) => !a.dead);
    if (!sel.length) {
      if (!this.viewer) {
        p.innerHTML = `<div class="sel-empty"><h2>Spectating</h2><dl class="mini-stats">${w.players.map((pl) => `<div><dt style="color:${this.renderer.styleOf(pl).css}">${pl.name}</dt><dd>${pl.stats.harvested} harvested · ${pl.stats.kills} kills</dd></div>`).join('')}</dl></div>`;
        return;
      }
      const v = this.viewer;
      p.innerHTML = `<div class="sel-empty"><h2>${this.renderer.styleOf(v).name}</h2>
        <p>Drag to select. Right-click to move, attack or harvest; Shift queues orders. Weave structures from the panel on the right, inside your lattice field.</p>
        <dl class="mini-stats"><div><dt>Harvested</dt><dd>${v.stats.harvested}</dd></div><div><dt>Units trained</dt><dd>${v.stats.unitsBuilt}</dd></div><div><dt>Kills</dt><dd>${v.stats.kills}</dd></div></dl></div>`;
      return;
    }
    if (sel.length === 1) {
      const a = sel[0], info = a.info, h = a.health;
      const mine = this.input.isMine(a);
      const style = this.renderer.styleOf(a.owner);
      const frac = h.hp / h.maxHp;
      const wv = a.trait('Weavable');
      let extra = '';
      const q = a.enabledTrait('ProductionQueue');
      if (wv && !wv.done) {
        extra = `<div class="prog"><span>${wv.waiting ? 'Waiting for a free weaver' : 'Weaving'}</span><div class="bar"><i style="width:${((wv.progress / wv.total) * 100).toFixed(1)}%"></i></div></div>`;
      } else if (q && mine) {
        const slots = [];
        for (let i = 0; i < q.info.MaxQueue; i++) {
          const t = q.queue[i];
          if (t) {
            const dur = w.rules.actor(t).traitInfo('Buildable').BuildDuration;
            const pr = i === 0 ? Math.min(1, q.progress / dur) : 0;
            slots.push(`<button type="button" class="qslot" data-b="${a.id}" data-q="${i}" title="Cancel ${nameOf(w.rules.actor(t))}">${svg(t)}${i === 0 ? `<i style="height:${(pr * 100).toFixed(0)}%"></i>` : ''}</button>`);
          } else slots.push('<span class="qslot empty"></span>');
        }
        extra = `<div class="queue">${slots.join('')}</div>`;
      } else if (a.harvester) {
        const cap = a.harvester.info.Capacity;
        extra = `<div class="prog"><span>Cargo ${a.harvester.cargo} / ${cap}</span><div class="bar res"><i style="width:${((a.harvester.cargo / cap) * 100).toFixed(0)}%"></i></div></div>`;
      }
      const facts = [];
      const arm = info.traitInfo('Armament');
      if (arm) {
        const wpn = w.rules.weapons.get(arm.Weapon);
        const dmg = wpn.warheads.find((x) => x.type === 'SpreadDamage');
        facts.push(`<div><dt>Weapon</dt><dd>${wpn.name} ${dmg ? dmg.Damage / 100 : ''}</dd></div><div><dt>Range</dt><dd>${(wpn.Range / 1024).toFixed(1)}</dd></div>`);
      }
      const heal = info.traitInfo('HealsAllies'); if (heal) facts.push(`<div><dt>Repair</dt><dd>${((heal.Amount / 100) * (25 / heal.Interval)).toFixed(0)}/s</dd></div>`);
      facts.push(`<div><dt>Armour</dt><dd>${info.traitInfo('Armor')?.Type || '-'}</dd></div>`);
      const auto = a.trait('AutoTarget'); if (auto && a.mobile) facts.push(`<div><dt>Stance</dt><dd>${auto.stance === 'Defend' ? 'Hold' : auto.stance === 'HoldFire' ? 'Hold fire' : 'Engage'}</dd></div>`);
      const ps = info.traitInfo('ProvidesSupply'); if (ps) facts.push(`<div><dt>Supply</dt><dd>+${ps.Amount}</dd></div>`);
      const pf = info.traitInfo('ProvidesField'); if (pf) facts.push(`<div><dt>Field</dt><dd>${pf.Range / 1024}</dd></div>`);
      const status = a.building ? (wv && !wv.done ? 'Under construction' : 'Online') : (a.activity ? STATUS[a.activity.label] || 'Busy' : 'Idle');
      p.innerHTML = `<div class="sel-one">
        <div class="portrait" style="color:${style.css}">${svg(a.type)}</div>
        <div class="sel-body">
          <div class="sel-head"><h2>${nameOf(info)}</h2><span class="tag" style="--c:${style.css}">${mine ? status : a.owner.name}</span></div>
          <div class="hp"><div class="bar ${frac < 0.35 ? 'low' : frac < 0.7 ? 'mid' : ''}"><i style="width:${(frac * 100).toFixed(1)}%"></i></div><span>${Math.ceil(h.hp / 100)} / ${h.maxHp / 100}</span></div>
          ${extra}
          <dl class="facts">${facts.join('')}</dl>
        </div></div>`;
      return;
    }
    const items = sel.slice(0, 36).map((a) => {
      const f = a.health.hp / a.health.maxHp;
      return `<button type="button" class="unit-chip" data-sel="${a.id}" title="${nameOf(a.info)}">${svg(a.type)}<i style="width:${(f * 100).toFixed(0)}%;background:${f < 0.35 ? 'var(--bad)' : f < 0.7 ? 'var(--warn)' : 'var(--good)'}"></i></button>`;
    });
    const counts = {};
    for (const a of sel) counts[nameOf(a.info)] = (counts[nameOf(a.info)] || 0) + 1;
    p.innerHTML = `<div class="sel-many"><div class="sel-summary">${Object.entries(counts).map(([k, n]) => `<span>${n} × ${k}</span>`).join('')}</div><div class="chips">${items.join('')}</div></div>`;
  }

  // ---------------------------------------------------------------- minimap (rotates with the camera)
  miniXform() {
    const size = this.mini.width, W = this.world.map.n * 2;
    const [fx, fz] = this.rig.forward();
    const phi = -Math.PI / 2 - Math.atan2(fz, fx);
    const c = Math.cos(phi), s = Math.sin(phi);
    return { c, s, scale: (size / (W * (Math.abs(c) + Math.abs(s)))) * 0.98, half: size / 2, W };
  }
  toMini(x, z, X) { const u = x - X.W / 2, v = z - X.W / 2; return [X.half + (u * X.c - v * X.s) * X.scale, X.half + (u * X.s + v * X.c) * X.scale]; }
  fromMini(px, py) {
    const X = this.miniXform();
    const a = (px - X.half) / X.scale, b = (py - X.half) / X.scale;
    return [a * X.c + b * X.s + X.W / 2, -a * X.s + b * X.c + X.W / 2];
  }
  bindMinimap() {
    const m = this.mini;
    const pos = (e) => { const r = m.getBoundingClientRect(); return this.fromMini(((e.clientX - r.left) / r.width) * m.width, ((e.clientY - r.top) / r.height) * m.height); };
    let dragging = false;
    m.addEventListener('contextmenu', (e) => e.preventDefault());
    m.addEventListener('pointerdown', (e) => {
      if (!this.world) return;
      const [x, z] = pos(e);
      const target = { x: Math.round(x * 512), y: Math.round(z * 512) };
      if (e.button === 2 || (this.input.mode === 'amove' && e.button === 0)) {
        this.input.command(target, e.shiftKey, this.input.mode === 'amove');
        if (this.input.mode === 'amove') this.input.cancelMode();
        return;
      }
      dragging = true; m.setPointerCapture(e.pointerId);
      this.rig.jump(x, z);
    });
    m.addEventListener('pointermove', (e) => { if (dragging) { const [x, z] = pos(e); this.rig.jump(x, z); } });
    m.addEventListener('pointerup', () => { dragging = false; });
  }
  buildMiniBase() {
    const map = this.world.map, n = map.n;
    const c = document.createElement('canvas'); c.width = n; c.height = n;
    const ctx = c.getContext('2d'), img = ctx.createImageData(n, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, h = map.heightAt(i * 2 + 1, j * 2 + 1);
      let r, g, b;
      if (map.rock[k]) { r = 22; g = 18; b = 32; } else { const t = Math.min(1, h / 3.4); r = 58 + t * 70; g = 48 + t * 60; b = 80 + t * 60; }
      img.data[k * 4] = r; img.data[k * 4 + 1] = g; img.data[k * 4 + 2] = b; img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.miniBase = c;
    this.fogCanvas = document.createElement('canvas'); this.fogCanvas.width = n; this.fogCanvas.height = n;
    this.fogImg = this.fogCanvas.getContext('2d').createImageData(n, n);
  }
  drawMinimap() {
    const w = this.world, rd = this.renderer, ctx = this.mctx, size = this.mini.width, n = w.map.n;
    if (!this.miniBase) this.buildMiniBase();
    const X = this.miniXform();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const sc = X.scale * 2;
    const tx = X.half + (-X.W / 2 * X.c + X.W / 2 * X.s) * X.scale, ty = X.half + (-X.W / 2 * X.s - X.W / 2 * X.c) * X.scale;
    ctx.setTransform(X.c * sc, X.s * sc, -X.s * sc, X.c * sc, tx, ty);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.miniBase, 0, 0);
    const vis = rd.reveal ? rd.allVisible : this.viewer.shroud.vis;
    ctx.fillStyle = hex(RES_COLOR);
    for (const v of w.map.vents) for (const k of v.cells) if (w.map.res[k] > 20 && vis[k]) ctx.fillRect(k % n, (k / n) | 0, 1, 1);
    const d = this.fogImg.data;
    for (let k = 0; k < n * n; k++) { d[k * 4] = 7; d[k * 4 + 1] = 5; d[k * 4 + 2] = 15; d[k * 4 + 3] = vis[k] === 2 ? 0 : vis[k] === 1 ? 120 : 235; }
    this.fogCanvas.getContext('2d').putImageData(this.fogImg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogCanvas, 0, 0);
    for (const v of rd.views.values()) {
      const a = v.actor;
      if (a.dead || !v.model.root.visible) continue;
      ctx.fillStyle = rd.selected.has(a) ? '#ffffff' : v.style.css;
      if (a.building) ctx.fillRect(a.building.ci, a.building.cj, a.building.size, a.building.size);
      else { const s = v.radius > 1.2 ? 1.6 : 1.1; ctx.fillRect(a.x / 1024 - s / 2, a.y / 1024 - s / 2, s, s); }
    }
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

  // ---------------------------------------------------------------- overlay: health bars, drag box, hints
  resize(wd, ht, dpr) {
    this.overlay.width = wd * dpr; this.overlay.height = ht * dpr;
    this.overlay.style.width = `${wd}px`; this.overlay.style.height = `${ht}px`;
    this.dpr = dpr;
  }
  drawOverlay() {
    const ctx = this.octx, w = this.world, inp = this.input, rd = this.renderer;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    for (const v of rd.views.values()) {
      const a = v.actor;
      if (a.dead || !v.model.root.visible) continue;
      const wv = a.trait('Weavable');
      const weaving = wv && !wv.done;
      const show = rd.selected.has(a) || w.frame - a.health.lastDamaged < 75 || a === inp.hover || (weaving && this.viewer && a.owner === this.viewer);
      if (!show) continue;
      const pos = v.model.root.position;
      const top = a.building ? pos.y + 3 + a.building.size : pos.y + 2.6 + v.radius;
      const p = inp.project(pos.x, top, pos.z);
      if (p.z > 1) continue;
      const bw = a.building ? 22 + a.building.size * 12 : 18 + v.radius * 14, bh = 4;
      const x = p.x - bw / 2, y = p.y, f = Math.max(0, a.health.hp / a.health.maxHp);
      const enemy = this.viewer ? this.viewer.isEnemy(a.owner) : false;
      ctx.fillStyle = 'rgba(8,6,16,0.75)'; ctx.fillRect(x - 1, y - 1, bw + 2, bh + 2);
      ctx.fillStyle = enemy ? '#ff6a6a' : f < 0.35 ? '#ff6a6a' : f < 0.7 ? '#ffc861' : '#8dffa8';
      ctx.fillRect(x, y, bw * f, bh);
      if (weaving) { ctx.fillStyle = 'rgba(8,6,16,0.75)'; ctx.fillRect(x - 1, y + bh + 1, bw + 2, 4); ctx.fillStyle = v.style.css; ctx.fillRect(x, y + bh + 2, (bw * wv.progress) / wv.total, 2); }
      if (a.harvester && a.harvester.cargo > 0 && !enemy) { ctx.fillStyle = 'rgba(8,6,16,0.75)'; ctx.fillRect(x - 1, y + bh + 1, bw + 2, 4); ctx.fillStyle = hex(RES_COLOR); ctx.fillRect(x, y + bh + 2, (bw * a.harvester.cargo) / a.harvester.info.Capacity, 2); }
    }
    for (const a of inp.own()) {
      const rp = a.trait('RallyPoint');
      if (!rp || !rp.point) continue;
      const v = rd.views.get(a.id);
      const s = inp.project(a.x * R, (v && v.y) + 1, a.y * R);
      const ex = rp.point.x * R, ez = rp.point.y * R;
      const e = inp.project(ex, w.map.heightAt(ex, ez) + 0.3, ez);
      if (s.z > 1 || e.z > 1) continue;
      ctx.strokeStyle = 'rgba(141,255,168,0.7)'; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(e.x, e.y, 4, 0, Math.PI * 2); ctx.stroke();
    }
    const d = inp.drag;
    if (d && d.kind === 'select' && Math.hypot(inp.mx - d.x, inp.my - d.y) > 6) {
      ctx.strokeStyle = 'rgba(141,255,168,0.9)'; ctx.fillStyle = 'rgba(141,255,168,0.08)'; ctx.lineWidth = 1;
      ctx.fillRect(d.x, d.y, inp.mx - d.x, inp.my - d.y);
      ctx.strokeRect(d.x + 0.5, d.y + 0.5, inp.mx - d.x, inp.my - d.y);
    }
    if (inp.mode === 'place' && inp.placeErr) {
      ctx.font = '600 13px "IBM Plex Sans Condensed", system-ui, sans-serif';
      const tw = ctx.measureText(inp.placeErr).width;
      ctx.fillStyle = 'rgba(8,6,16,0.8)'; ctx.fillRect(inp.mx + 16, inp.my + 14, tw + 14, 22);
      ctx.fillStyle = '#ff8a8a'; ctx.fillText(inp.placeErr, inp.mx + 23, inp.my + 29);
    }
  }

  update(dt) {
    if (!this.world) return;
    const om = this.s.om;
    this.stallT = om.stalled ? this.stallT + dt : 0;
    $('net-status').hidden = this.stallT < 0.6;
    if (om.desync && !this.desyncShown) { this.desyncShown = true; this.toast(`Desync detected at frame ${om.desync.frame}. The game may diverge.`, 'bad'); }
    this.refreshT -= dt;
    if (this.dirty || this.refreshT <= 0) { this.refreshPanels(); this.renderObjectives(); this.refreshT = 0.2; this.dirty = false; }
    this.miniT -= dt;
    if (this.miniT <= 0) { this.drawMinimap(); this.miniT = 0.12; }
    this.drawOverlay();
  }
}
