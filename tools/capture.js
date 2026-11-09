// Record gameplay footage automatically with a real browser.
//
//   npm start                                    (in another terminal: serves the game)
//   npm install --no-save playwright && npx playwright install chromium
//   node tools/capture.js --seconds 90 --out clips/ai-match.webm
//   node tools/capture.js --mission m05-wake --autopilot --seconds 120 --out clips/wake.webm
//   node tools/capture.js --replay clips/match.gwreplay.json --speed 2 --out clips/replay.webm
//
// Options: --url http://localhost:8080  --seed N  --a accord:hard  --b combine:normal
//          --mission ID  --difficulty normal  --autopilot  --replay FILE (path under the game folder)
//          --seconds N  --speed N  --width 1920 --height 1080  --no-cinematic  --hud  --letterbox
//          --reveal (no fog of war)  --headed (show the window; recommended with a GPU)  --mute
// MediaRecorder files have no duration header; to fix that or get an MP4:
//   ffmpeg -i clip.webm -c copy fixed.webm      ffmpeg -i clip.webm -c:v libx264 -crf 18 -c:a aac clip.mp4
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def; };
const flag = (name) => args.includes(`--${name}`);

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.error('Playwright is not installed. Run:  npm install --no-save playwright && npx playwright install chromium'); process.exit(1); }

const base = opt('url', 'http://localhost:8080').replace(/\/$/, '');
const seconds = Number(opt('seconds', '60'));
const out = path.resolve(opt('out', `clips/glasswake-${Date.now()}.webm`));
const width = Number(opt('width', '1920')), height = Number(opt('height', '1080'));

const q = new URLSearchParams();
if (opt('mission')) { q.set('mission', opt('mission')); q.set('difficulty', opt('difficulty', 'normal')); }
else if (opt('replay')) q.set('replayurl', opt('replay'));
else if (flag('skirmish')) q.set('skirmish', '');
else { q.set('spectate', ''); if (opt('a')) q.set('a', opt('a')); if (opt('b')) q.set('b', opt('b')); }
if (opt('seed')) q.set('seed', opt('seed'));
if (flag('autopilot')) q.set('autopilot', '');
if (!flag('no-cinematic')) q.set('cinematic', '');
if (!flag('hud')) q.set('clean', '');
if (flag('letterbox')) q.set('letterbox', '');
if (flag('reveal')) q.set('reveal', '');
if (flag('mute')) q.set('mute', '');
if (opt('speed')) q.set('speed', opt('speed'));
q.set('record', String(seconds));
q.set('out', path.basename(out));
const url = `${base}/?${q.toString().replace(/=(&|$)/g, '$1')}`;

await mkdir(path.dirname(out), { recursive: true });
const browser = await chromium.launch({
  headless: !flag('headed'),
  args: ['--autoplay-policy=no-user-gesture-required', ...(flag('headed') ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])],
});
const page = await browser.newPage({ viewport: { width, height }, acceptDownloads: true });
page.on('pageerror', (e) => console.error('page error:', e.message));
console.log(`Recording ${seconds}s from ${url}`);
const download = page.waitForEvent('download', { timeout: (seconds + 180) * 1000 });
await page.goto(url);
const timer = setInterval(async () => {
  const st = await page.evaluate(() => ({ rec: window.glasswakeRecording, frame: window.glasswake && window.glasswake.world && window.glasswake.world.frame })).catch(() => ({}));
  process.stdout.write(`\r  ${st.rec || 'starting'}  game time ${((st.frame || 0) / 25).toFixed(0)}s   `);
}, 2000);
const file = await download;
clearInterval(timer);
await file.saveAs(out);
await browser.close();
console.log(`\nSaved ${out}`);
if (!flag('headed')) console.log('Tip: headless Chrome renders in software here. Use --headed on a machine with a GPU for smooth 60 fps footage.');
