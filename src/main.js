import * as THREE from '../lib/three.module.js';
import { World } from './game.js';
import { CameraRig, Input } from './input.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { FACTIONS, WORLD, UNITS, BUILDINGS, DIFFICULTY } from './config.js';

const $ = (id) => document.getElementById(id);
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
const ui = new UI(audio);

let world = null, input = null, rig = null, sun = null;
let state = 'title';
let speed = 1;
let settings = { faction: 'accord', difficulty: 'normal', seed: 1207 };
let demoT = 0;

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
  rim.position.set(WORLD, 60, 0);
  scene.add(rim);
  // dark glass sea beyond the map edge
  const under = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 5, WORLD * 5), new THREE.MeshStandardMaterial({ color: 0x120e1c, roughness: 0.3, metalness: 0.7 }));
  under.rotation.x = -Math.PI / 2; under.position.set(WORLD / 2, -1.2, WORLD / 2);
  scene.add(under);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  ui.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
  if (world) {
    const scale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    world.fx.glow.points.material.uniforms.scale.value = scale;
    world.fx.smoke.points.material.uniforms.scale.value = scale;
  }
}
window.addEventListener('resize', resize);

function teardown() {
  if (input) input.dispose();
  input = null;
  world = null;
}

function startDemo() {
  teardown();
  setupScene();
  state = 'title';
  world = new World(scene, { faction: 'accord', difficulty: 'normal', seed: 4242, demo: true, reveal: true });
  rig = new CameraRig(camera, world.map);
  rig.jump(WORLD * 0.42, WORLD * 0.42);
  rig.distT = rig.dist = 95;
  demoT = 0;
  resize();
  $('hud').hidden = true;
  $('title-screen').hidden = false;
  $('end-screen').hidden = true;
  $('pause-screen').hidden = true;
}

function startGame() {
  audio.init();
  teardown();
  setupScene();
  state = 'play';
  world = new World(scene, { ...settings, reveal: new URLSearchParams(location.search).has('reveal') });
  rig = new CameraRig(camera, world.map);
  const core = world.entities.find((e) => e.team === 0 && e.type === 'core');
  rig.jump(core.x + 10, core.z + 10);
  input = new Input(canvas, world, rig, ui, audio);
  input.edgeScroll = $('edge').checked;
  ui.attach(world, input, rig);
  world.sfx = (name, x, z, flat) => {
    const d = Math.hypot(x - rig.tx, z - rig.tz);
    audio.play(name, flat ? 0.9 : Math.max(0, 1 - d / 110) * (rig.dist < 60 ? 1 : 0.7));
  };
  resize();
  $('hud').hidden = false;
  $('title-screen').hidden = true;
  $('end-screen').hidden = true;
  $('pause-screen').hidden = true;
  ui.toast('Landfall. Your Core is weaving the lattice.', 'info');
  ui.toast('Tip: weave a Foundry (F), then a Resonator (R) before supply caps.', 'info');
}

function showEnd() {
  state = 'end';
  const v = world.over === 'victory';
  const t = $('end-title');
  t.textContent = v ? 'Victory' : 'Defeat';
  t.className = `end-title ${v ? 'victory' : 'defeat'}`;
  const mins = Math.floor(world.time / 60), secs = Math.floor(world.time % 60);
  $('end-lede').textContent = v
    ? `The ${world.teams[1].faction.name} lattice is broken after ${mins}m ${secs}s. The vents sing for you now.`
    : `Your last structure fell after ${mins}m ${secs}s. The ${world.teams[1].faction.name} holds the dunes.`;
  const rows = [['Resonance harvested', 'harvested'], ['Units trained', 'unitsBuilt'], ['Units lost', 'unitsLost'], ['Structures woven', 'structuresBuilt'], ['Structures lost', 'structuresLost'], ['Kills', 'kills']];
  const [a, b] = world.teams;
  $('end-stats').innerHTML = `<thead><tr><th></th><th style="color:${a.faction.css}">${a.faction.name}</th><th style="color:${b.faction.css}">${b.faction.name}</th></tr></thead><tbody>${rows.map(([l, k]) => `<tr><td>${l}</td><td>${a.stats[k]}</td><td>${b.stats[k]}</td></tr>`).join('')}</tbody>`;
  $('end-screen').hidden = false;
  $('hud').hidden = true;
  if (input) input.cancelMode();
}

// ------------------------------------------------------------ title screen wiring
function pressGroup(container, attr, value) {
  for (const b of container.querySelectorAll(`[${attr}]`)) b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value));
}
$('faction-pick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]'); if (!b) return;
  settings.faction = b.dataset.f; pressGroup($('faction-pick'), 'data-f', b.dataset.f);
});
$('diff-pick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-d]'); if (!b) return;
  settings.difficulty = b.dataset.d; pressGroup($('diff-pick'), 'data-d', b.dataset.d);
});
$('seed-roll').addEventListener('click', () => { $('seed-input').value = 1 + Math.floor(Math.random() * 99998); });
$('btn-start').addEventListener('click', () => {
  settings.seed = Math.max(1, Math.min(99999, parseInt($('seed-input').value, 10) || 1207));
  startGame();
});
$('btn-menu').addEventListener('click', () => ui.togglePause(true));
$('btn-resume').addEventListener('click', () => ui.togglePause(false));
$('btn-restart').addEventListener('click', () => startGame());
$('btn-quit').addEventListener('click', () => startDemo());
$('btn-again').addEventListener('click', () => { settings.seed = 1 + Math.floor(Math.random() * 99998); $('seed-input').value = settings.seed; startGame(); });
$('btn-title').addEventListener('click', () => startDemo());
$('vol').addEventListener('input', (e) => audio.setVolume(e.target.value / 100));
$('edge').addEventListener('change', (e) => { if (input) input.edgeScroll = e.target.checked; });
$('speed').addEventListener('change', (e) => { speed = parseFloat(e.target.value) || 1; });

const KEYS = [
  ['Select / box select', 'Left drag'], ['Move · attack · harvest', 'Right click'], ['Add to selection', 'Shift + click'],
  ['Select all of a type on screen', 'Double click'], ['Attack-move', 'A'], ['Stop · Hold', 'S · H'],
  ['Control group set · recall', 'Ctrl+1–9 · 1–9'], ['Jump to alert / Core', 'Space'], ['Pan', 'Arrows · edges · middle drag'],
  ['Rotate camera', 'Q · E · Alt+middle drag'], ['Zoom', 'Wheel'], ['Recycle structure', 'X'],
  ['Keep placing', 'Shift + click'], ['Cancel · menu', 'Esc'],
  ...Object.values(BUILDINGS).map((d) => [`Weave ${d.name}`, d.key]),
  ...Object.values(UNITS).map((d) => [`Train ${d.name}`, d.key]),
];
const keysHtml = KEYS.map(([a, b]) => `<div><dt>${a}</dt><dd><kbd>${b}</kbd></dd></div>`).join('');
$('keys-list').innerHTML = keysHtml;
$('keys-list-2').innerHTML = keysHtml;

// ------------------------------------------------------------ loop
let last = performance.now();
let elapsed = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  elapsed += dt;
  if (!world) return;
  if (state === 'title') {
    demoT += dt;
    rig.yaw = -Math.PI * 0.75 + Math.sin(demoT * 0.05) * 0.6;
    rig.tx = WORLD * 0.5 + Math.sin(demoT * 0.03) * WORLD * 0.18;
    rig.tz = WORLD * 0.5 + Math.cos(demoT * 0.04) * WORLD * 0.18;
    step(dt * 1.5);
    world.events.length = 0;
    if (world.over) startDemo();
  } else if (state === 'play') {
    if (!ui.paused) step(dt * speed);
    input.update(dt);
    ui.update(dt);
    if (world.over) showEnd();
  }
  rig.update(dt);
  const ty = world.map.heightAt(rig.tx, rig.tz);
  sun.position.set(rig.tx - 70, ty + 110, rig.tz - 40);
  sun.target.position.set(rig.tx, ty, rig.tz);
  world.render(elapsed, dt);
  renderer.render(scene, camera);
}
function step(dt) {
  const n = dt > 1 / 30 ? Math.ceil(dt / (1 / 30)) : 1;
  for (let i = 0; i < n; i++) world.update(dt / n);
}

startDemo();
requestAnimationFrame(frame);

// handy for debugging from the console
window.glasswake = { get world() { return world; }, get input() { return input; }, get rig() { return rig; }, startGame, settings };
