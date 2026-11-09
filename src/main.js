import * as THREE from '../lib/three.module.js';
import './traits/index.js';
import { loadRuleTexts, Rules } from './engine/rules.js';
import { parseCampaign, parseMission, loadMission, missionSettings } from './engine/mission.js';
import { GameMap } from './engine/map.js';
import { World } from './engine/world.js';
import { OrderManager, LocalConnection, ReplayConnection, TICK_MS } from './engine/ordermanager.js';
import { NetClient, defaultRelayUrl } from './engine/netclient.js';
import { WorldRenderer, R } from './render/worldrenderer.js';
import { CameraRig, Input } from './ui/input.js';
import { Hud } from './ui/hud.js';
import { Audio } from './ui/audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const canvas = $('view');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 1, 700);
const audio = new Audio();
const hud = new Hud(audio);

let rules = null;
let ruleTexts = null;
let campaign = null;
const missionInfo = new Map();
let session = null;
let input = null;
let sun = null;
let acc = 0;
let net = null;
const settings = { faction: 'accord', difficulty: 'normal', seed: 1207, name: '', campaignDifficulty: 'normal' };
try { settings.name = localStorage.getItem('gw-name') || ''; settings.campaignDifficulty = localStorage.getItem('gw-campaign-diff') || 'normal'; } catch {}

const readText = async (f) => { const r = await fetch(f); if (!r.ok) throw new Error(`Could not load ${f} (${r.status})`); return r.text(); };
const importScript = (f) => import(new URL(`../${f}`, import.meta.url).href);

// Campaign progress lives in this browser only.
const PROGRESS_KEY = 'gw-campaign-v1';
function progress() { try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || { done: {} }; } catch { return { done: {} }; } }
function markDone(id, difficulty) { const p = progress(); p.done[id] = difficulty; try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch {} }
function unlockedCount() {
  if (params.has('unlock')) return campaign.missions.length;
  const p = progress();
  let n = 1;
  for (const id of campaign.missions) { if (p.done[id]) n++; else break; }
  return Math.min(n, campaign.missions.length);
}

function setupScene() {
  scene.clear();
  const sky = new THREE.Color(0x1d1529);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 150, 360);
  scene.add(new THREE.HemisphereLight(0xb8adff, 0x4a2f3c, 1.6));
  sun = new THREE.DirectionalLight(0xffcfa8, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera; s.left = -75; s.right = 75; s.top = 75; s.bottom = -75; s.near = 10; s.far = 320;
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0x6f5cff, 0.6);
  rim.position.set(192, 60, 0);
  scene.add(rim);
  const under = new THREE.Mesh(new THREE.PlaneGeometry(960, 960), new THREE.MeshStandardMaterial({ color: 0x120e1c, roughness: 0.3, metalness: 0.7 }));
  under.rotation.x = -Math.PI / 2; under.position.set(96, -1.2, 96);
  scene.add(under);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  hud.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
  if (session) {
    const scale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    session.renderer.fx.glow.points.material.uniforms.scale.value = scale;
    session.renderer.fx.smoke.points.material.uniforms.scale.value = scale;
  }
}
window.addEventListener('resize', resize);

function show(screen) {
  for (const id of ['title-screen', 'campaign-screen', 'briefing-screen', 'mp-screen', 'lobby-screen', 'pause-screen', 'end-screen']) $(id).hidden = id !== screen;
  $('hud').hidden = screen !== null;
}

// ---------------------------------------------------------------- sessions
function teardown() {
  if (input) input.dispose();
  input = null;
  session = null;
  acc = 0;
  lastPump = performance.now();
}

function startSession({ gameSettings, localClient, connection, mode, missionDef = null, missionRules = null }) {
  teardown();
  setupScene();
  const map = missionDef ? new GameMap(missionDef.map) : new GameMap(gameSettings.seed);
  const world = new World(missionRules || rules, map, gameSettings, { mission: missionDef });
  const viewer = mode === 'demo' || mode === 'replay' ? null : world.players.find((p) => p.clientIndex === localClient) || null;
  const clients = gameSettings.players.filter((p) => p.client !== undefined && p.client >= 0).map((p) => p.client);
  const om = new OrderManager(world, connection, { localClient, clients, latency: gameSettings.latency ?? 1, record: mode !== 'demo' && mode !== 'replay' });
  if (connection instanceof ReplayConnection) connection.attach(om);
  if (connection.flushBacklog) connection.flushBacklog();
  om.onDesync = (d) => console.warn('Desync', d);
  const rig = new CameraRig(camera, world.map);
  const s = { world, om, viewer, rig, mode, over: false, speed: 1, connection, mission: missionDef, speakers: campaign ? campaign.speakers : new Map() };
  const rd = new WorldRenderer(scene, world, viewer, {
    reveal: mode === 'demo' || params.has('reveal'),
    sfx: (name, x, y, flat) => {
      if (mode === 'demo') return;
      const d = Math.hypot(x * R - rig.tx, y * R - rig.tz);
      audio.play(name, flat ? 0.9 : Math.max(0, 1 - d / 110) * (rig.dist < 60 ? 1 : 0.7));
    },
    onNotify: (text, kind) => hud.toast(text, kind),
    onSay: (speaker, text) => hud.say(speaker, text),
    onObjectives: (kind, text) => hud.objectivesEvent(kind, text),
    onFocus: (x, z) => rig.glideTo(x, z),
  });
  s.renderer = rd;
  session = s;
  if (mode !== 'demo') {
    input = new Input(canvas, s, hud, audio);
    input.edgeScroll = $('edge').checked;
    hud.attach(s, input);
  }
  const mine = viewer ? world.actors.filter((a) => a.owner === viewer && a.health) : [];
  const core = mine.find((a) => a.type === 'core');
  const half = world.map.n * 512;
  if (core) rig.jumpWorld(core.x + 5 * 1024 * (core.x < half ? 1 : -1), core.y + 5 * 1024 * (core.y < half ? 1 : -1));
  else if (mine.length) rig.jumpWorld(mine.reduce((t, a) => t + a.x, 0) / mine.length + 4096, mine.reduce((t, a) => t + a.y, 0) / mine.length - 4096);
  const anchor = core || mine[0];
  if (anchor && anchor.x > half && anchor.y < half) rig.yaw = Math.PI * 0.25;
  if (mode === 'demo') { rig.jump(80, 80); rig.distT = rig.dist = 95; }
  resize();
  rd.consumeEvents(world.fxEvents.splice(0));
  return s;
}

// Title-screen battle in the background, without switching screens.
function startDemoQuiet() {
  startSession({
    gameSettings: { seed: 4242, players: [{ name: 'Accord', faction: 'accord', bot: 'normal' }, { name: 'Combine', faction: 'combine', bot: 'normal' }] },
    localClient: -1, connection: new LocalConnection(), mode: 'demo',
  });
}

function startDemo() {
  if (net) { net.close(); net = null; }
  startSession({
    gameSettings: { seed: 4242, players: [{ name: 'Accord', faction: 'accord', bot: 'normal' }, { name: 'Combine', faction: 'combine', bot: 'normal' }] },
    localClient: -1, connection: new LocalConnection(), mode: 'demo',
  });
  show('title-screen');
}

function startSinglePlayer() {
  audio.init();
  const other = settings.faction === 'accord' ? 'combine' : 'accord';
  startSession({
    gameSettings: {
      seed: settings.seed, latency: 1, mode: 'skirmish',
      players: [{ name: settings.name || 'You', faction: settings.faction, client: 0 }, { name: `Bot (${settings.difficulty})`, faction: other, bot: settings.difficulty }],
    },
    localClient: 0, connection: new LocalConnection(), mode: 'skirmish',
  });
  show(null);
  hud.toast('Landfall. Your Core is weaving the lattice.', 'info');
  hud.toast('Tip: weave a Foundry (F), then a Resonator (R) before supply caps.', 'info');
}

async function startReplay(replay) {
  audio.init();
  let missionDef = null, missionRules = null;
  if (replay.settings.mission) {
    missionDef = await loadMission(replay.settings.mission, readText, importScript);
    missionRules = new Rules(ruleTexts.rules, ruleTexts.weapons, missionDef.ruleNodes);
  }
  startSession({ gameSettings: replay.settings, localClient: -1, connection: new ReplayConnection(replay), mode: 'replay', missionDef, missionRules });
  show(null);
  hud.toast('Watching replay. Use the speed control at the top.', 'info');
}

// ---------------------------------------------------------------- campaign
async function missionMeta(id) {
  if (!missionInfo.has(id)) missionInfo.set(id, parseMission(await readText(`campaign/missions/${id}.yaml`), id));
  return missionInfo.get(id);
}

async function openCampaign() {
  show('campaign-screen');
  $('campaign-error').textContent = '';
  $('campaign-title').textContent = campaign.title;
  $('campaign-intro').innerHTML = '';
  for (const t of campaign.intro) { const p = document.createElement('p'); p.textContent = t; $('campaign-intro').appendChild(p); }
  for (const b of $('campaign-diff').querySelectorAll('[data-cd]')) b.setAttribute('aria-pressed', String(b.dataset.cd === settings.campaignDifficulty));
  const done = progress().done, open = unlockedCount();
  const list = $('mission-list');
  list.innerHTML = '';
  try {
    for (let i = 0; i < campaign.missions.length; i++) {
      const id = campaign.missions[i], meta = await missionMeta(id);
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'mission'; b.disabled = i >= open; b.dataset.mission = id;
      b.innerHTML = `<span class="num">${String(i + 1).padStart(2, '0')}</span><span><strong></strong><span class="tag-line"></span></span><span class="state ${done[id] ? 'done' : ''}">${done[id] ? `Complete · ${done[id]}` : i >= open ? 'Locked' : 'Ready'}</span>`;
      b.querySelector('strong').textContent = meta.title;
      b.querySelector('.tag-line').textContent = meta.tagline;
      li.appendChild(b); list.appendChild(li);
    }
  } catch (e) { $('campaign-error').textContent = e.message; }
}

let briefingId = null;
async function openBriefing(id) {
  briefingId = id;
  $('briefing-error').textContent = '';
  const meta = await missionMeta(id);
  const idx = campaign.missions.indexOf(id);
  $('briefing-num').textContent = `Mission ${idx + 1} of ${campaign.missions.length}`;
  $('briefing-title').textContent = meta.title;
  $('briefing-loc').textContent = meta.location;
  const bt = $('briefing-text'); bt.innerHTML = '';
  for (const t of meta.briefing) { const p = document.createElement('p'); p.textContent = t; bt.appendChild(p); }
  const ob = $('briefing-obj'); ob.innerHTML = '';
  for (const t of meta.objectives) { const li = document.createElement('li'); li.textContent = t; ob.appendChild(li); }
  show('briefing-screen');
}

async function startMission(id) {
  audio.init();
  try {
    const def = await loadMission(id, readText, importScript);
    const missionRules = new Rules(ruleTexts.rules, ruleTexts.weapons, def.ruleNodes);
    startSession({ gameSettings: missionSettings(def, settings.campaignDifficulty), localClient: 0, connection: new LocalConnection(), mode: 'mission', missionDef: def, missionRules });
    show(null);
  } catch (e) {
    console.error(e);
    show('briefing-screen');
    $('briefing-error').textContent = `Could not start the mission: ${e.message}`;
  }
}

function showEnd() {
  const s = session;
  s.over = true;
  if (input) input.cancelMode();
  const w = s.world;
  let title, cls, lede;
  const mins = Math.floor(w.frame / 1500), secs = Math.floor((w.frame / 25) % 60);
  const deb = $('end-debrief');
  deb.innerHTML = '';
  const para = (t) => { const p = document.createElement('p'); p.textContent = t; deb.appendChild(p); };
  $('btn-next').hidden = $('btn-retry').hidden = $('btn-to-campaign').hidden = true;
  if (s.mode === 'mission' && s.viewer) {
    const won = s.viewer.outcome === 'won';
    const idx = campaign.missions.indexOf(s.mission.id);
    title = won ? 'Mission complete' : 'Mission failed'; cls = won ? 'victory' : 'defeat';
    lede = `${s.mission.title} · ${mins}m ${secs}s · ${s.world.settings.difficulty}`;
    if (won) {
      markDone(s.mission.id, s.world.settings.difficulty);
      s.mission.debrief.forEach(para);
      if (idx === campaign.missions.length - 1) campaign.epilogue.forEach(para);
      $('btn-next').hidden = idx >= campaign.missions.length - 1;
      $('btn-next').dataset.mission = campaign.missions[idx + 1] || '';
    } else { para(s.mission.failText); $('btn-retry').hidden = false; }
    $('btn-to-campaign').hidden = false;
  } else if (s.viewer) {
    const won = s.viewer.outcome === 'won';
    title = won ? 'Victory' : 'Defeat'; cls = won ? 'victory' : 'defeat';
    const foes = w.players.filter((p) => s.viewer.isEnemy(p)).map((p) => p.name).join(', ');
    lede = won ? `${foes}: lattice broken after ${mins}m ${secs}s. The vents sing for you now.` : `Your last structure fell after ${mins}m ${secs}s.`;
  } else {
    const winner = w.players.find((p) => p.outcome === 'won');
    title = 'Replay finished'; cls = '';
    lede = winner ? `${winner.name} won after ${mins}m ${secs}s.` : `Replay ended at ${mins}m ${secs}s.`;
  }
  const t = $('end-title');
  t.textContent = title; t.className = `end-title ${cls}`;
  $('end-lede').textContent = lede;
  const rows = [['Resonance harvested', 'harvested'], ['Units trained', 'unitsBuilt'], ['Units lost', 'unitsLost'], ['Structures woven', 'structuresBuilt'], ['Structures lost', 'structuresLost'], ['Kills', 'kills']];
  $('end-stats').innerHTML = `<thead><tr><th></th>${w.players.map((p) => `<th style="color:${s.renderer.styleOf(p).css}">${p.name}</th>`).join('')}</tr></thead><tbody>${rows.map(([l, k]) => `<tr><td>${l}</td>${w.players.map((p) => `<td>${p.stats[k]}</td>`).join('')}</tr>`).join('')}</tbody>`;
  $('btn-save-replay').hidden = !s.om.replay;
  $('btn-again').hidden = s.mode !== 'skirmish';
  show('end-screen');
}

function saveReplay() {
  const r = session && session.om.replay;
  if (!r) return;
  const blob = new Blob([JSON.stringify(r)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `glasswake-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.gwreplay.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  hud.toast('Replay saved', 'good');
}

function leaveGame() {
  if (session && session.mode === 'multiplayer' && session.viewer && !session.viewer.outcome && input) input.issue('Surrender', []);
  setTimeout(startDemo, session && session.mode === 'multiplayer' ? 300 : 0);
}

// ---------------------------------------------------------------- multiplayer lobby
async function relayAvailable() {
  try { const r = await fetch('relay.json', { cache: 'no-store' }); return r.ok && (await r.json()).relay; } catch { return false; }
}

async function connectRelay() {
  const name = $('mp-name').value.trim() || 'Player';
  settings.name = name;
  try { localStorage.setItem('gw-name', name); } catch {}
  if (net) net.close();
  net = new NetClient($('mp-url').value.trim() || defaultRelayUrl());
  net.onLobby = renderLobby;
  net.onError = (m) => { $('mp-error').textContent = m; $('lobby-error').textContent = m; };
  net.onClose = () => { if (!session || session.mode !== 'multiplayer') { $('mp-error').textContent = 'Disconnected from the relay.'; show('mp-screen'); } else hud.toast('Connection to the relay was lost', 'bad'); };
  net.onStart = (gs) => {
    audio.init();
    startSession({ gameSettings: gs, localClient: net.client, connection: net, mode: 'multiplayer' });
    show(null);
    hud.toast('Match started. Orders reach everyone after a short delay.', 'info');
  };
  await net.connect();
  return name;
}

function renderLobby(l) {
  show('lobby-screen');
  const me = net.client, host = l.host === me;
  $('lobby-code').textContent = l.room;
  $('lobby-seed').value = l.seed; $('lobby-seed').disabled = !host;
  const nameOf = (id) => l.clients.find((c) => c.id === id);
  $('lobby-slots').innerHTML = l.slots.map((s, i) => {
    if (s.kind === 'client') {
      const c = nameOf(s.client) || { name: '?', faction: 'accord' };
      const mine = s.client === me;
      const fac = mine
        ? `<select data-own-faction aria-label="Your consortium"><option value="accord"${c.faction === 'accord' ? ' selected' : ''}>Halcyon Accord</option><option value="combine"${c.faction === 'combine' ? ' selected' : ''}>Ochre Combine</option></select>`
        : `<span class="fac ${c.faction}">${c.faction === 'accord' ? 'Halcyon Accord' : 'Ochre Combine'}</span>`;
      return `<div class="slot"><span class="slot-n">${i + 1}</span><strong>${c.name}${s.client === l.host ? ' <em>host</em>' : ''}${mine ? ' <em>you</em>' : ''}</strong>${fac}</div>`;
    }
    const kind = s.kind === 'bot' ? s.bot : 'open';
    const ctl = host
      ? `<select data-slot="${i}" aria-label="Slot ${i + 1}"><option value="open"${kind === 'open' ? ' selected' : ''}>Open</option><option value="easy"${kind === 'easy' ? ' selected' : ''}>Bot: easy</option><option value="normal"${kind === 'normal' ? ' selected' : ''}>Bot: normal</option><option value="hard"${kind === 'hard' ? ' selected' : ''}>Bot: hard</option></select>
         ${s.kind === 'bot' ? `<select data-bot-faction="${i}" data-bot="${s.bot}" aria-label="Bot consortium"><option value="accord"${s.faction === 'accord' ? ' selected' : ''}>Halcyon Accord</option><option value="combine"${s.faction === 'combine' ? ' selected' : ''}>Ochre Combine</option></select>` : ''}`
      : `<span class="muted">${s.kind === 'bot' ? `Bot (${s.bot})` : 'Waiting for a player…'}</span>`;
    return `<div class="slot"><span class="slot-n">${i + 1}</span><strong>${s.kind === 'bot' ? 'Bot' : 'Open'}</strong>${ctl}</div>`;
  }).join('');
  const spect = l.clients.filter((c) => !l.slots.some((s) => s.kind === 'client' && s.client === c.id));
  $('lobby-spect').textContent = spect.length ? `Spectators: ${spect.map((c) => c.name).join(', ')}` : '';
  $('btn-lobby-start').hidden = !host;
  $('btn-lobby-start').disabled = l.slots.some((s) => s.kind === 'open');
  $('lobby-wait').hidden = host;
  $('lobby-error').textContent = '';
}

$('lobby-slots').addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.ownFaction !== undefined) net.update({ faction: t.value });
  else if (t.dataset.slot !== undefined) net.update({ slot: +t.dataset.slot, slotKind: t.value, botFaction: 'combine' });
  else if (t.dataset.botFaction !== undefined) net.update({ slot: +t.dataset.botFaction, slotKind: t.dataset.bot, botFaction: t.value });
});
$('lobby-seed').addEventListener('change', (e) => net && net.update({ seed: parseInt(e.target.value, 10) || 1 }));
$('btn-lobby-start').addEventListener('click', () => net && net.start());
$('btn-lobby-leave').addEventListener('click', () => { if (net) net.close(); net = null; show('mp-screen'); });

$('btn-mp').addEventListener('click', async () => {
  show('mp-screen');
  $('mp-name').value = settings.name;
  if (!$('mp-url').value) $('mp-url').value = defaultRelayUrl();
  $('mp-error').textContent = '';
  $('mp-note').hidden = await relayAvailable();
});
$('btn-mp-back').addEventListener('click', () => { if (net) net.close(); net = null; show('title-screen'); });
$('btn-host').addEventListener('click', async () => {
  $('mp-error').textContent = '';
  try { const name = await connectRelay(); net.host(name); } catch (e) { $('mp-error').textContent = e.message; }
});
$('btn-join').addEventListener('click', async () => {
  const code = $('mp-code').value.trim();
  if (!code) { $('mp-error').textContent = 'Enter the 4-letter game code from the host.'; return; }
  $('mp-error').textContent = '';
  try { const name = await connectRelay(); net.join(code, name); } catch (e) { $('mp-error').textContent = e.message; }
});

// ---------------------------------------------------------------- title + menus
function pressGroup(container, attr, value) {
  for (const b of container.querySelectorAll(`[${attr}]`)) b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value));
}
$('faction-pick').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; settings.faction = b.dataset.f; pressGroup($('faction-pick'), 'data-f', b.dataset.f); });
$('diff-pick').addEventListener('click', (e) => { const b = e.target.closest('[data-d]'); if (!b) return; settings.difficulty = b.dataset.d; pressGroup($('diff-pick'), 'data-d', b.dataset.d); });
$('seed-roll').addEventListener('click', () => { $('seed-input').value = 1 + Math.floor(Math.random() * 99998); });
$('btn-start').addEventListener('click', () => { settings.seed = Math.max(1, Math.min(99999, parseInt($('seed-input').value, 10) || 1207)); startSinglePlayer(); });
$('replay-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const r = JSON.parse(await f.text());
    if (r.version !== 2 || !r.settings || !Array.isArray(r.frames)) throw new Error('Not a Glasswake replay');
    startReplay(r);
  } catch (err) { alertTitle(err.message); }
});
function alertTitle(msg) { $('title-error').textContent = msg; }
$('btn-menu').addEventListener('click', () => hud.togglePause(true));
$('btn-resume').addEventListener('click', () => hud.togglePause(false));
$('btn-restart').addEventListener('click', () => { if (session && session.mode === 'mission') startMission(session.mission.id); else startSinglePlayer(); });
$('btn-campaign').addEventListener('click', () => openCampaign());
$('btn-campaign-back').addEventListener('click', () => show('title-screen'));
$('campaign-diff').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cd]'); if (!b) return;
  settings.campaignDifficulty = b.dataset.cd;
  try { localStorage.setItem('gw-campaign-diff', b.dataset.cd); } catch {}
  for (const x of $('campaign-diff').querySelectorAll('[data-cd]')) x.setAttribute('aria-pressed', String(x === b));
});
$('mission-list').addEventListener('click', (e) => { const b = e.target.closest('[data-mission]'); if (b && !b.disabled) openBriefing(b.dataset.mission); });
$('btn-begin').addEventListener('click', () => startMission(briefingId));
$('btn-briefing-back').addEventListener('click', () => openCampaign());
$('btn-next').addEventListener('click', (e) => { const id = e.currentTarget.dataset.mission; startDemoQuiet(); if (id) openBriefing(id); });
$('btn-retry').addEventListener('click', () => startMission(session.mission.id));
$('btn-to-campaign').addEventListener('click', () => { startDemoQuiet(); openCampaign(); });
$('btn-objectives').addEventListener('click', () => hud.toggleObjectives());
$('btn-quit').addEventListener('click', () => leaveGame());
$('btn-again').addEventListener('click', () => { settings.seed = 1 + Math.floor(Math.random() * 99998); $('seed-input').value = settings.seed; startSinglePlayer(); });
$('btn-title').addEventListener('click', () => startDemo());
$('btn-save-replay').addEventListener('click', saveReplay);
$('vol').addEventListener('input', (e) => audio.setVolume(e.target.value / 100));
$('edge').addEventListener('change', (e) => { if (input) input.edgeScroll = e.target.checked; });
$('speed').addEventListener('change', (e) => { if (session && session.mode !== 'multiplayer') session.speed = parseFloat(e.target.value) || 1; });
$('replay-speed').addEventListener('change', (e) => { if (session && session.mode === 'replay') session.speed = parseFloat(e.target.value) || 1; });

const KEYS = [
  ['Select / box select', 'Left drag'], ['Move · attack · harvest', 'Right click'], ['Queue an order', 'Shift + right click'],
  ['Add to selection', 'Shift + click'], ['Select all of a type on screen', 'Double click'], ['Attack-move', 'A'], ['Stop', 'S'],
  ['Stance: hold ground · engage', 'H · G'], ['Control group set · recall', 'Ctrl+1–9 · 1–9'], ['Jump to alert / Core', 'Space'],
  ['Pan', 'Arrows · edges · middle drag'], ['Rotate camera', 'Q · E · Alt+middle drag'], ['Zoom', 'Wheel'], ['Recycle structure', 'X'],
  ['Keep placing', 'Shift + click'], ['Cancel · menu', 'Esc'],
];

// ---------------------------------------------------------------- loop
// The simulation is pumped from a timer as well as from animation frames, so a slow
// renderer (or a background tab, where animation frames stop) doesn't hold up the other
// players in a lockstep match.
let lastPump = performance.now();
const isRunning = (s) => !s.over && (s.mode === 'multiplayer' || !hud.paused);
function pump() {
  const now = performance.now();
  const dt = Math.min(1000, now - lastPump);
  lastPump = now;
  const s = session;
  if (!s || !isRunning(s)) return;
  acc += dt * s.speed;
  const maxSteps = s.mode === 'replay' ? 64 : 25;
  let n = 0;
  while (acc >= TICK_MS && n < maxSteps) {
    if (!s.om.tryTick()) { acc = Math.min(acc, TICK_MS); break; }
    acc -= TICK_MS; n++;
  }
  if (n >= maxSteps) acc = Math.min(acc, TICK_MS);
}
setInterval(pump, 10);

let last = performance.now(), elapsed = 0, demoT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now; elapsed += dt;
  const s = session;
  if (!s) return;
  pump();
  const running = isRunning(s);
  const alpha = s.om.stalled || !running ? 1 : Math.min(1, acc / TICK_MS);
  s.renderer.consumeEvents(s.world.fxEvents.splice(0));
  if (s.mode === 'demo') {
    demoT += dt;
    s.rig.yaw = -Math.PI * 0.75 + Math.sin(demoT * 0.05) * 0.6;
    s.rig.tx = 96 + Math.sin(demoT * 0.03) * 34;
    s.rig.tz = 96 + Math.cos(demoT * 0.04) * 34;
    if (s.world.gameOver) { startDemo(); return; }
  } else {
    input.update(dt);
    hud.update(dt);
    const ended = s.viewer ? !!s.viewer.outcome : s.world.gameOver || (s.mode === 'replay' && s.world.frame >= (s.connection.replay.endFrame ?? Infinity));
    if (ended && !s.over) setTimeout(() => { if (session === s && !s.over) showEnd(); }, 1500);
  }
  s.rig.update(dt);
  const ty = s.world.map.heightAt(s.rig.tx, s.rig.tz);
  sun.position.set(s.rig.tx - 70, ty + 110, s.rig.tz - 40);
  sun.target.position.set(s.rig.tx, ty, s.rig.tz);
  s.renderer.update(elapsed, dt, alpha);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- boot
(async () => {
  const keysHtml = KEYS.map(([a, b]) => `<div><dt>${a}</dt><dd><kbd>${b}</kbd></dd></div>`).join('');
  $('keys-list').innerHTML = keysHtml;
  $('keys-list-2').innerHTML = keysHtml;
  try {
    ruleTexts = await loadRuleTexts(readText);
    rules = new Rules(ruleTexts.rules, ruleTexts.weapons);
    campaign = parseCampaign(await readText('campaign/campaign.yaml'));
  } catch (e) {
    $('title-error').textContent = `Failed to load rules: ${e.message}`;
    console.error(e);
    return;
  }
  startDemo();
  requestAnimationFrame(frame);
})();

// Console helpers
window.glasswake = { get session() { return session; }, get world() { return session && session.world; }, get input() { return input; }, get rules() { return rules; }, startSinglePlayer, startReplay, startMission, openCampaign, settings };
