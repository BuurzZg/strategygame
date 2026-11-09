// AI self-play: the game playing itself, headless.
//
//   node tools/selfplay.js                 skirmish matrix + campaign on autopilot (normal)
//   node tools/selfplay.js skirmish        only bot-vs-bot skirmishes
//   node tools/selfplay.js campaign hard   only the campaign, on the given difficulty
//
// Reports winners, game length and stalemates. Useful for balance passes and for finding
// good seeds to record trailers from (every match here can be re-rendered as a replay).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { readText, makeWorld } from './headless.js';
import { loadRuleTexts, Rules } from '../src/engine/rules.js';
import { GameMap } from '../src/engine/map.js';
import { World } from '../src/engine/world.js';
import { makeWorldOrder } from '../src/engine/order.js';
import { parseCampaign, loadMission, missionSettings } from '../src/engine/mission.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const what = process.argv[2] || 'all';
const difficulty = process.argv[3] || 'normal';
const TPS = 25;
const mins = (f) => (f / TPS / 60).toFixed(1);

async function skirmish() {
  console.log('== Skirmish: bot vs bot');
  const seeds = [7, 1207, 4242, 31337, 555];
  const matchups = [['hard', 'normal'], ['normal', 'normal'], ['easy', 'hard']];
  const tally = {};
  for (const [a, b] of matchups) {
    for (const seed of seeds) {
      const w = await makeWorld(seed, [{ name: `A-${a}`, faction: 'accord', bot: a }, { name: `B-${b}`, faction: 'combine', bot: b }]);
      const cap = TPS * 60 * 35;
      while (!w.gameOver && w.frame < cap) w.tick();
      const winner = w.players.find((p) => p.outcome === 'won');
      const key = `${a} vs ${b}`;
      tally[key] = tally[key] || { A: 0, B: 0, draw: 0 };
      if (!winner) tally[key].draw++; else tally[key][winner.index === 0 ? 'A' : 'B']++;
      console.log(`  seed ${String(seed).padStart(5)}  ${key.padEnd(16)} ${winner ? `${winner.name} won` : 'STALEMATE'} at ${mins(w.frame)} min  (harvested ${w.players.map((p) => p.stats.harvested).join(' / ')})`);
    }
  }
  console.log('  summary:', Object.entries(tally).map(([k, v]) => `${k}: ${v.A}-${v.B}${v.draw ? ` (${v.draw} stalemate)` : ''}`).join(' · '));
  return Object.values(tally).reduce((s, v) => s + v.draw, 0);
}

async function campaign(diff) {
  console.log(`== Campaign on autopilot (${diff})`);
  const texts = await loadRuleTexts(readText);
  const camp = parseCampaign(await readFile(path.join(root, 'campaign/campaign.yaml'), 'utf8'));
  let losses = 0;
  for (const id of camp.missions) {
    const def = await loadMission(id, readText, (f) => import(pathToFileURL(path.join(root, f)).href));
    const settings = { ...missionSettings(def, diff), dev: true };
    const w = new World(new Rules(texts.rules, texts.weapons, def.ruleNodes), new GameMap(def.map), settings, { mission: def });
    w.resolveOrder(makeWorldOrder('Dev', { cmd: 'autopilot', player: 0, bot: 'autopilot' }), null);
    const cap = TPS * 60 * 30;
    while (!w.gameOver && w.frame < cap) w.tick();
    const you = w.players[0];
    const objs = you.objectives.list.map((o) => `${o.state === 'done' ? '✓' : o.state === 'failed' ? '✗' : '·'} ${o.text}`).join('; ');
    if (you.outcome !== 'won') losses++;
    console.log(`  ${def.title.padEnd(15)} ${(you.outcome || 'TIMEOUT').padEnd(7)} at ${mins(w.frame).padStart(5)} min   ${objs}`);
  }
  return losses;
}

let problems = 0;
if (what === 'all' || what === 'skirmish') problems += await skirmish();
if (what === 'all' || what === 'campaign') problems += await campaign(difficulty);
console.log(problems ? `\n${problems} game(s) did not finish with a winner / mission win` : '\nEvery game finished');
