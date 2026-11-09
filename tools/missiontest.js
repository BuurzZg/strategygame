// Campaign mission checks, no browser needed:  npm run missions
// For every mission: load it, validate placements, run it idle, force its victory path,
// and confirm two runs produce identical state.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readText } from './headless.js';
import { loadRuleTexts, Rules } from '../src/engine/rules.js';
import { GameMap } from '../src/engine/map.js';
import { World } from '../src/engine/world.js';
import { parseCampaign, loadMission, missionSettings } from '../src/engine/mission.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const importScript = (f) => import(pathToFileURL(path.join(root, f)).href);
const texts = await loadRuleTexts(readText);
const campaign = parseCampaign(await readFile(path.join(root, 'campaign/campaign.yaml'), 'utf8'));

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

async function makeMissionWorld(id, difficulty) {
  const def = await loadMission(id, readText, importScript);
  const rules = new Rules(texts.rules, texts.weapons, def.ruleNodes);
  const settings = missionSettings(def, difficulty);
  return { def, world: new World(rules, new GameMap(def.map), settings, { mission: def }) };
}

// Kill everything in the way of each mission's victory, in the order the story expects.
const VICTORY = {
  'm01-landfall': (w, m) => [
    () => { for (const a of m.actors('combine')) if (m.near([30.5, 39.5], 12).includes(a)) a.health.kill(null, null); m.spawn('warden', m.you, [30, 41]); },
    () => m.spawn('foundry', m.you, [14, 52], { complete: false }),
    () => { const f = m.actors(m.you, 'foundry')[0]; if (f) f.trait('Weavable').advance(1e6); },
    () => { for (const n of ['camp_siphon', 'camp_pylon', 'camp_spire']) m.actor(n)?.health.kill(null, null); },
  ],
  'm02-choir': (w) => [() => { w.frame = Math.max(w.frame, 25 * 361); }],
  'm03-shadows': (w, m) => [
    () => m.spawn('warden', m.you, [42, 24]),
    ...['relay_a', 'relay_b', 'relay_c'].map((n) => () => m.actor(n)?.health.kill(null, null)),
  ],
  'm04-furnace': (w, m) => [() => { for (const a of m.actors('combine')) if (a.type === 'core' || a.type === 'foundry') a.health.kill(null, null); }],
  'm05-wake': (w, m) => [() => m.actor('drill').health.kill(null, null)],
};

for (const id of campaign.missions) {
  console.log(`\n== ${id}`);
  let world, def;
  try { ({ world, def } = await makeMissionWorld(id, 'normal')); }
  catch (e) { check(false, `loads (${e.message})`); continue; }
  check(true, `loads: "${def.title}", ${def.actors.length} placed actors, ${def.map.size}x${def.map.size} map`);

  // placement sanity: each placed structure owns its whole footprint and stands on open ground
  const map = world.map, n = map.n;
  const badB = [];
  for (const a of world.actors) {
    if (!a.building) continue;
    const b = a.building;
    for (let j = b.cj; j < b.cj + b.size; j++) for (let i = b.ci; i < b.ci + b.size; i++) {
      if (map.rock[j * n + i] || map.bld[j * n + i] !== a.id || map.resMax[j * n + i]) badB.push(`${a.type}@${b.ci},${b.cj}`);
    }
  }
  check(badB.length === 0, `structures placed on open ground without overlap${badB.length ? ': ' + [...new Set(badB)].join(' ') : ''}`);
  const m = world.worldActor.trait('MissionScript').api;
  check(world.you === undefined && !!m.you && m.you.objectives.list.length > 0, `objectives at start: ${m.you.objectives.list.map((o) => o.text).join(' | ')}`);

  // idle run: the player does nothing for three minutes
  let err = null;
  try { for (let f = 0; f < 25 * 180 && !world.gameOver; f++) world.tick(); } catch (e) { err = e; }
  check(!err, err ? `idle run threw: ${err.stack.split('\n').slice(0, 3).join(' | ')}` : `idle run to ${(world.frame / 1500).toFixed(1)} min (${m.you.outcome || 'ongoing'})`);

  // forced victory path on a fresh world
  ({ world } = await makeMissionWorld(id, 'normal'));
  const api = world.worldActor.trait('MissionScript').api;
  err = null;
  try {
    for (const step of VICTORY[id](world, api)) { step(); for (let f = 0; f < 25 * 25 && !world.gameOver; f++) world.tick(); }
    for (let f = 0; f < 25 * 40 && !world.gameOver; f++) world.tick();
  } catch (e) { err = e; }
  check(!err && api.you.outcome === 'won', err ? `victory path threw: ${err.stack.split('\n').slice(0, 3).join(' | ')}` : `victory path ends in "${api.you.outcome}" at ${(world.frame / 1500).toFixed(1)} min`);

  // determinism: two fresh runs, same hash
  const a = (await makeMissionWorld(id, 'hard')).world, b = (await makeMissionWorld(id, 'hard')).world;
  for (let f = 0; f < 25 * 90; f++) { a.tick(); b.tick(); }
  check(a.syncHash() === b.syncHash(), `deterministic over 90 s (hash ${a.syncHash().toString(16)})`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll mission checks passed');
process.exit(failures ? 1 : 0);
