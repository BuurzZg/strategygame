// Run the simulation without a browser. Usage: node tools/headless.js [seed] [minutes]
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import '../src/traits/index.js';
import { loadRules } from '../src/engine/rules.js';
import { GameMap } from '../src/engine/map.js';
import { World } from '../src/engine/world.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readText = (f) => readFile(path.join(root, f), 'utf8');

export async function makeWorld(seed, players) {
  const rules = await loadRules(readText);
  return new World(rules, new GameMap(seed), { seed, players });
}

export function summary(w) {
  return w.players.map((p) => {
    const cnt = {};
    for (const a of w.actors) if (a.owner === p && !a.dead) cnt[a.type] = (cnt[a.type] || 0) + 1;
    return `P${p.index} ${p.outcome || ''} cash ${p.resources.cash} sup ${p.supply.used()}/${p.supply.cap()} harv ${p.stats.harvested} ${JSON.stringify(cnt)}`;
  }).join('  ||  ');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const seed = +(process.argv[2] || 1207), minutes = +(process.argv[3] || 15);
  const w = await makeWorld(seed, [{ name: 'A', faction: 'accord', bot: 'normal' }, { name: 'B', faction: 'combine', bot: 'normal' }]);
  const t0 = performance.now();
  for (let f = 0; f < minutes * 60 * 25; f++) {
    w.tick();
    if (f % (60 * 25) === 0) console.log(`[${(f / 1500).toFixed(0)}m] ${summary(w)}`);
    if (w.gameOver) { console.log(`OVER at ${(w.frame / 1500).toFixed(1)}m: ${summary(w)}`); break; }
  }
  console.log(`hash ${w.syncHash().toString(16)}  frames ${w.frame}  wall ${(performance.now() - t0).toFixed(0)}ms`);
}
