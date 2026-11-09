// Fails if simulation code uses anything that can differ between browsers or machines.
// Usage: npm run check
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIM_DIRS = ['src/engine', 'src/traits', 'src/activities'];
const ALLOW = new Set(['src/engine/netclient.js']); // networking, not simulation
const FORBIDDEN = [
  [/Math\.random\s*\(/, 'Math.random (use world.rng)'],
  [/Math\.(sin|cos|tan|atan2?|asin|acos|hypot|pow|exp|log|cbrt|sinh|cosh|tanh)\s*\(/, 'non-exact Math function (use engine/math.js)'],
  [/\b(Date\.now|performance\.now|new Date)\b/, 'wall-clock time'],
  [/\bfor\s*\(\s*(const|let|var)\s+\w+\s+in\b/, 'for...in (iteration order hazards)'],
  [/\*\*/, 'exponent operator (use multiplication)'],
];

let bad = 0;
for (const dir of SIM_DIRS) {
  for (const f of await readdir(path.join(root, dir))) {
    if (!f.endsWith('.js')) continue;
    const rel = `${dir}/${f}`;
    if (ALLOW.has(rel)) continue;
    const lines = (await readFile(path.join(root, rel), 'utf8')).split('\n');
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      for (const [re, why] of FORBIDDEN) if (re.test(code)) { console.log(`${rel}:${i + 1}: ${why}\n    ${line.trim()}`); bad++; }
    });
  }
}
if (bad) { console.log(`\n${bad} determinism problem(s) found.`); process.exit(1); }
console.log('Simulation code looks deterministic.');
