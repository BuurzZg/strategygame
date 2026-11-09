import { R } from '../render/worldrenderer.js';
import { makeWorldOrder } from '../engine/order.js';
import { CELL } from '../engine/math.js';

// Developer tools: a panel (toggle with ` or F9), world overlays drawn on the HUD canvas,
// an actor inspector, cheats (sent as world orders, so they are replay- and lockstep-safe),
// camera/recording controls and an event log.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class DebugTools {
  constructor(app) {
    this.app = app; // { session(), hud, input(), recorder, setCinematic(on), setClean(on), setLetterbox(on), setSpeed(v), togglePause(), step() }
    this.open = false;
    this.ov = { paths: false, ranges: false, labels: false, grid: false, fields: false };
    this.tickTimes = [];
    this.ticksThisSecond = 0; this.tps = 0; this.tpsClock = 0;
    this.fps = 0; this.frames = 0; this.fpsClock = 0;
    this.log = [];
    this.spawnMode = null;
    this.build();
  }

  // ---------------------------------------------------------------- panel
  build() {
    const el = document.createElement('aside');
    el.id = 'debug-panel';
    el.hidden = true;
    el.setAttribute('aria-label', 'Developer tools');
    el.innerHTML = `
      <header><strong>Debug</strong><span class="dbg-hint">\` or F9</span><button type="button" data-a="close" aria-label="Close">×</button></header>
      <section><h4>Performance</h4><pre id="dbg-stats"></pre></section>
      <section><h4>View</h4>
        <div class="dbg-grid">
          <label><input type="checkbox" data-ov="paths"> Paths</label>
          <label><input type="checkbox" data-ov="ranges"> Ranges</label>
          <label><input type="checkbox" data-ov="labels"> Labels</label>
          <label><input type="checkbox" data-ov="grid"> Passability</label>
          <label><input type="checkbox" data-ov="fields"> Lattice fields</label>
          <label><input type="checkbox" id="dbg-reveal"> Reveal map</label>
        </div>
        <label class="dbg-row">View as <select id="dbg-viewas"></select></label>
      </section>
      <section><h4>Time</h4>
        <div class="dbg-row">
          <select id="dbg-speed" aria-label="Game speed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select>
          <button type="button" data-a="pause">Pause</button><button type="button" data-a="step">Step</button>
        </div>
      </section>
      <section id="dbg-cheats"><h4>Cheats</h4>
        <div class="dbg-row"><select id="dbg-player" aria-label="Player"></select><button type="button" data-a="cash">+5000</button><button type="button" data-a="fast">Fast build</button></div>
        <div class="dbg-row"><button type="button" data-a="autopilot">Autopilot</button><button type="button" data-a="win">Win</button><button type="button" data-a="lose">Lose</button></div>
        <div class="dbg-row"><select id="dbg-type" aria-label="Actor type"></select><input id="dbg-count" type="number" min="1" max="20" value="1" aria-label="Count"><button type="button" data-a="spawn">Spawn at click</button></div>
        <div class="dbg-row"><span class="dbg-muted">Selected:</span><button type="button" data-a="kill">Kill</button><button type="button" data-a="damage">−25%</button><button type="button" data-a="heal">Heal</button><button type="button" data-a="take">Give to player</button></div>
      </section>
      <section><h4>Camera &amp; capture</h4>
        <div class="dbg-grid">
          <label><input type="checkbox" id="dbg-cine"> Cinematic camera</label>
          <label><input type="checkbox" id="dbg-clean"> Hide HUD</label>
          <label><input type="checkbox" id="dbg-letterbox"> Letterbox</label>
          <label><input type="checkbox" id="dbg-audio" checked> Record audio</label>
        </div>
        <div class="dbg-row"><button type="button" data-a="record" id="dbg-rec">Record video</button><span id="dbg-rec-time" class="dbg-muted"></span></div>
      </section>
      <section><h4>Inspector</h4><pre id="dbg-inspect">Select something.</pre></section>
      <section><h4>Event log</h4><pre id="dbg-log"></pre></section>`;
    document.getElementById('app').appendChild(el);
    this.el = el;
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b) this.action(b.dataset.a); });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.ov) this.ov[t.dataset.ov] = t.checked;
      else if (t.id === 'dbg-reveal' || t.id === 'dbg-viewas') this.applyView();
      else if (t.id === 'dbg-speed') this.app.setSpeed(parseFloat(t.value));
      else if (t.id === 'dbg-cine') this.app.setCinematic(t.checked);
      else if (t.id === 'dbg-clean') this.app.setClean(t.checked);
      else if (t.id === 'dbg-letterbox') this.app.setLetterbox(t.checked);
    });
  }

  toggle(force) {
    this.open = force !== undefined ? force : !this.open;
    this.el.hidden = !this.open;
    if (this.open) this.attach();
  }

  // Refresh lists when a session starts or the panel opens.
  attach() {
    const s = this.app.session();
    if (!s) return;
    const w = s.world;
    const players = w.players.map((p) => `<option value="${p.index}">${esc(p.name)}</option>`).join('');
    $('dbg-player').innerHTML = players;
    if (s.viewer) $('dbg-player').value = String(s.viewer.index);
    $('dbg-viewas').innerHTML = `<option value="">${s.viewer ? 'Me' : 'Everyone'}</option>` + w.players.map((p) => `<option value="${p.index}">${esc(p.name)}</option>`).join('') + '<option value="all">Everything</option>';
    const types = [...w.rules.actors.values()].filter((a) => a.has('WithModel')).map((a) => a.name).sort();
    $('dbg-type').innerHTML = types.map((t) => `<option>${t}</option>`).join('');
    $('dbg-cheats').hidden = !w.dev;
    $('dbg-cine').checked = !!s.director;
  }

  applyView() {
    const s = this.app.session();
    if (!s) return;
    const v = $('dbg-viewas').value;
    const rd = s.renderer;
    if (v === 'all') rd.setViewer(s.viewer, true);
    else if (v === '') rd.setViewer(s.viewer, $('dbg-reveal').checked);
    else rd.setViewer(s.world.players[+v], $('dbg-reveal').checked);
  }

  cheat(extra) {
    const s = this.app.session();
    if (!s || !s.world.dev) return;
    s.om.issue(makeWorldOrder('Dev', extra));
    this.push(`dev ${extra.cmd}`);
  }
  selectedIds() { const inp = this.app.input(); return inp ? inp.selection.filter((a) => !a.dead).map((a) => a.id) : []; }

  action(a) {
    const s = this.app.session();
    const player = +$('dbg-player').value;
    switch (a) {
      case 'close': this.toggle(false); break;
      case 'pause': this.app.togglePause(); break;
      case 'step': this.app.step(); break;
      case 'cash': this.cheat({ cmd: 'cash', player, amount: 5000 }); break;
      case 'fast': { const on = !(s && s.world.dev && s.world.dev.isFast(s.world.players[player])); this.cheat({ cmd: 'fastbuild', player, on }); break; }
      case 'autopilot': { const p = s && s.world.players[player]; this.cheat({ cmd: 'autopilot', player, bot: p && p.autopilot ? null : 'autopilot' }); break; }
      case 'win': this.cheat({ cmd: 'win', player }); break;
      case 'lose': this.cheat({ cmd: 'lose', player }); break;
      case 'kill': this.cheat({ cmd: 'kill', ids: this.selectedIds() }); break;
      case 'damage': this.cheat({ cmd: 'damage', ids: this.selectedIds() }); break;
      case 'heal': this.cheat({ cmd: 'heal', ids: this.selectedIds() }); break;
      case 'take': this.cheat({ cmd: 'transfer', ids: this.selectedIds(), player }); break;
      case 'spawn': this.spawnMode = { type: $('dbg-type').value, player, count: Math.max(1, Math.min(20, +$('dbg-count').value || 1)) }; this.app.hud.toast(`Click the map to spawn ${this.spawnMode.type}`, 'info'); break;
      case 'record': this.app.toggleRecording($('dbg-audio').checked); break;
    }
  }

  // Called by Input on left click; returns true if the click was consumed.
  handleClick(target) {
    if (!this.spawnMode || !target) return false;
    this.cheat({ cmd: 'spawn', type: this.spawnMode.type, player: this.spawnMode.player, x: target.x, y: target.y, count: this.spawnMode.count });
    this.spawnMode = null;
    return true;
  }

  // ---------------------------------------------------------------- hooks from the game loop
  recordTick(ms) { this.tickTimes.push(ms); if (this.tickTimes.length > 120) this.tickTimes.shift(); this.ticksThisSecond++; }
  onOrders(frame, client, orders) {
    for (const o of orders) this.push(`f${frame} c${client} ${o.n}${o.s && o.s.length ? ` ×${o.s.length}` : ''}${o.x !== undefined ? ` ${typeof o.x === 'object' ? JSON.stringify(o.x) : o.x}` : ''}`);
  }
  onEvents(events) {
    for (const e of events) {
      if (e.t === 'killed') this.push(`f${e.frame} killed ${e.type} (p${e.owner})`);
      else if (e.t === 'notify' || e.t === 'say' || e.t === 'outcome' || e.t === 'objectives') this.push(`f${e.frame} ${e.t} ${e.speaker || e.kind || e.outcome || ''} ${e.text || ''}`.slice(0, 120));
    }
  }
  push(line) { this.log.push(line); if (this.log.length > 60) this.log.shift(); this.logDirty = true; }

  update(dt) {
    this.frames++; this.fpsClock += dt; this.tpsClock += dt;
    if (this.fpsClock >= 0.5) { this.fps = this.frames / this.fpsClock; this.frames = 0; this.fpsClock = 0; }
    if (this.tpsClock >= 1) { this.tps = this.ticksThisSecond / this.tpsClock; this.ticksThisSecond = 0; this.tpsClock = 0; }
    const rec = this.app.recorder;
    const recEl = $('dbg-rec');
    if (recEl) { recEl.textContent = rec.recording ? 'Stop & save' : 'Record video'; recEl.classList.toggle('rec', rec.recording); $('dbg-rec-time').textContent = rec.recording ? `● ${rec.seconds.toFixed(0)} s` : ''; }
    if (!this.open) return;
    this.refreshT = (this.refreshT || 0) - dt;
    if (this.refreshT > 0) return;
    this.refreshT = 0.25;
    const s = this.app.session();
    if (!s) return;
    const w = s.world, info = this.app.renderer.info.render;
    const avg = this.tickTimes.length ? this.tickTimes.reduce((a, b) => a + b, 0) / this.tickTimes.length : 0;
    const max = this.tickTimes.length ? Math.max(...this.tickTimes) : 0;
    const units = w.actors.filter((a) => a.mobile).length;
    const fx = s.renderer.fx;
    $('dbg-stats').textContent = [
      `fps ${this.fps.toFixed(0).padStart(3)}   ticks/s ${this.tps.toFixed(1)}   speed ${s.speed}×`,
      `sim ${avg.toFixed(2)} ms avg · ${max.toFixed(2)} ms max per tick`,
      `draw calls ${info.calls}   triangles ${(info.triangles / 1000).toFixed(0)}k`,
      `frame ${w.frame}   sync ${w.syncHash().toString(16).padStart(8, '0')}`,
      `actors ${w.actors.length} (units ${units})   projectiles ${w.effects.length}   particles ${fx.glow.n + fx.smoke.n}`,
      `mode ${s.mode}${s.om.stalled ? '   WAITING FOR NETWORK' : ''}${s.om.desync ? `   DESYNC @${s.om.desync.frame}` : ''}`,
      ...w.players.map((p) => `${p.name}: ${p.resources.cash} res · supply ${p.supply.used()}/${p.supply.cap()}${p.autopilot ? ' · autopilot' : ''}${p.botType ? ` · bot ${p.botType}` : ''}${w.dev && w.dev.isFast(p) ? ' · fast' : ''}`),
    ].join('\n');
    const inp = this.app.input();
    const a = inp && inp.selection.find((x) => !x.dead);
    $('dbg-inspect').textContent = a ? this.inspect(a) : 'Select something.';
    if (this.logDirty) { $('dbg-log').textContent = this.log.slice(-18).join('\n'); this.logDirty = false; }
  }

  inspect(a) {
    const chain = [];
    for (let act = a.activity; act; act = act.next) {
      let label = act.constructor.label || act.constructor.name;
      for (let c = act.child; c; c = c.child) label += ` > ${c.constructor.label || c.constructor.name}`;
      chain.push(label);
    }
    const lines = [
      `#${a.id} ${a.type}  owner ${a.owner.name}`,
      `cell ${(a.x / CELL).toFixed(2)}, ${(a.y / CELL).toFixed(2)}   facing ${a.facing}${a.turret ? ` turret ${a.turret.facing}` : ''}`,
      a.health ? `hp ${a.health.hp}/${a.health.maxHp}   last hit f${a.health.lastDamaged}` : 'no health',
      `conditions: ${[...a.conditions.entries()].map(([k, v]) => `${k}${v > 1 ? `×${v}` : ''}`).join(', ') || 'none'}`,
      `activity: ${chain.join(' → ') || 'idle'}`,
    ];
    if (a.harvester) lines.push(`cargo ${a.harvester.cargo}  target cell ${a.harvester.targetCell}`);
    const q = a.trait('ProductionQueue'); if (q) lines.push(`queue [${q.queue.join(', ')}] progress ${q.progress}`);
    const at = a.trait('AutoTarget'); if (at) lines.push(`stance ${at.stance}${a.attack && a.attack.opportunity ? `  opportunity #${a.attack.opportunity.id}` : ''}`);
    lines.push('traits:');
    lines.push(a.traits.map((t) => `${t.enabled ? '' : '-'}${t.info.type}${t.info.instance ? '@' + t.info.instance : ''}`).join(' '));
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- overlays (drawn on the HUD canvas)
  drawOverlay(ctx) {
    const s = this.app.session(), inp = this.app.input();
    if (!s || !inp) return;
    const w = s.world, map = w.map, rd = s.renderer;
    const proj = (wx, wy, lift = 0.3) => { const x = wx * R, z = wy * R; return inp.project(x, map.heightAt(x, z) + lift, z); };
    const circle = (cx, cy, r, color, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.setLineDash(dash ? [4, 4] : []);
      ctx.beginPath();
      for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; const p = proj(cx + Math.cos(a) * r, cy + Math.sin(a) * r); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
      ctx.stroke(); ctx.setLineDash([]);
    };
    const sel = inp.selection.filter((a) => !a.dead);

    if (this.ov.grid) {
      const ci = Math.floor(s.rig.tx / 2), cj = Math.floor(s.rig.tz / 2), r = Math.round(s.rig.dist / 3);
      for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
        if (!map.inBounds(i, j)) continue;
        const k = j * map.n + i;
        const color = map.rock[k] ? 'rgba(255,70,90,0.28)' : map.bld[k] ? 'rgba(255,170,60,0.35)' : map.resMax[k] ? 'rgba(255,90,170,0.18)' : null;
        if (!color) continue;
        const pts = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => proj(a * CELL, b * CELL, 0.1));
        if (pts.some((p) => p.z > 1)) continue;
        ctx.fillStyle = color; ctx.beginPath(); pts.forEach((p, n) => (n ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill();
      }
    }
    if (this.ov.fields) {
      for (const f of w.traitsOfType('ProvidesField')) if (f.enabled && !f.self.dead && rd.isVisible(f.self)) circle(f.self.x, f.self.y, f.info.Range, rd.styleOf(f.self.owner).css, true);
    }
    if (this.ov.ranges) {
      for (const a of sel) {
        for (const arm of a.traitsOf('Armament')) { circle(a.x, a.y, arm.weapon.Range, 'rgba(255,90,90,0.9)'); if (arm.weapon.MinRange) circle(a.x, a.y, arm.weapon.MinRange, 'rgba(255,90,90,0.6)', true); }
        const at = a.trait('AutoTarget'); if (at) circle(a.x, a.y, at.info.ScanRange, 'rgba(255,210,90,0.7)', true);
        const h = a.trait('HealsAllies'); if (h) circle(a.x, a.y, h.info.Range, 'rgba(120,255,160,0.8)');
        const rv = a.trait('RevealsShroud'); if (rv) circle(a.x, a.y, rv.info.Range, 'rgba(140,170,255,0.45)', true);
      }
    }
    if (this.ov.paths) {
      ctx.lineWidth = 1.6;
      for (const a of sel) {
        const movers = [];
        const walk = (act) => { if (!act || movers.length > 8) return; if (act.path) movers.push(act); walk(act.child); walk(act.mover); walk(act.fight); walk(act.next); };
        walk(a.activity);
        for (const m of movers) {
          if (!m.path) continue;
          ctx.strokeStyle = 'rgba(141,255,168,0.9)'; ctx.setLineDash([6, 4]);
          ctx.beginPath();
          let p = proj(a.x, a.y); ctx.moveTo(p.x, p.y);
          for (let i = m.pi; i < m.path.length; i++) { p = proj(m.path[i][0], m.path[i][1]); ctx.lineTo(p.x, p.y); }
          ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(141,255,168,0.9)';
          for (let i = m.pi; i < m.path.length; i++) { const q = proj(m.path[i][0], m.path[i][1]); ctx.fillRect(q.x - 2, q.y - 2, 4, 4); }
        }
        if (a.attack && a.attack.opportunity && !a.attack.opportunity.dead) {
          const t = a.attack.opportunity, p0 = proj(a.x, a.y, 1), p1 = proj(t.x, t.y, 1);
          ctx.strokeStyle = 'rgba(255,90,90,0.9)'; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        }
      }
    }
    if (this.ov.labels) {
      ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
      for (const v of rd.views.values()) {
        const a = v.actor;
        if (a.dead || !v.model.root.visible) continue;
        const p = inp.project(v.model.root.position.x, v.model.root.position.y + 0.2, v.model.root.position.z);
        if (p.z > 1 || p.x < 0 || p.y < 0 || p.x > innerWidth || p.y > innerHeight) continue;
        const act = a.activity ? (a.activity.label || '') : '';
        const st = a.trait('AutoTarget');
        const text = `#${a.id} ${a.type}${act ? ' · ' + act : ''}${st && a.mobile && st.stance !== 'AttackAnything' ? ' · ' + st.stance : ''}`;
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(8,6,16,0.7)'; ctx.fillRect(p.x - tw / 2 - 3, p.y + 6, tw + 6, 14);
        ctx.fillStyle = '#e9e3f0'; ctx.fillText(text, p.x - tw / 2, p.y + 17);
      }
    }
  }
}
