// Lockstep correctness test, no browser needed:  npm test
//
// 1. Two clients, each with its own World, connected by a fake network that delivers
//    packets with random delays. Both players spam random orders. Every frame's sync hash
//    must match between the clients.
// 2. Replaying client 0's recording must reproduce the exact same final state.
// 3. A bot-vs-bot match must reach a result.
import { makeWorld, summary } from './headless.js';
import { OrderManager, ReplayConnection } from '../src/engine/ordermanager.js';
import { makeOrder } from '../src/engine/order.js';
import { CELL } from '../src/engine/math.js';

const SEED = +(process.env.SEED || 3141);
const FRAMES = +(process.env.FRAMES || 25 * 60 * 6);
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++; };

// ---------------------------------------------------------------- fake network
class FakeNet {
  constructor() { this.links = []; this.queue = []; this.now = 0; }
  connect(client) {
    const conn = { client, onPacket: null, onLeft: null, send: (p) => { for (const other of this.links) if (other !== conn) this.queue.push({ at: this.now + 1 + Math.floor(Math.random() * 8), to: other, msg: { c: client, ...p } }); } };
    this.links.push(conn);
    return conn;
  }
  step() {
    this.now++;
    const due = this.queue.filter((q) => q.at <= this.now);
    this.queue = this.queue.filter((q) => q.at > this.now);
    for (const q of due) q.to.onPacket(q.msg);
  }
}

// Random but plausible orders for a player, decided outside the simulation.
function randomOrders(w, p) {
  const out = [];
  const mine = w.actors.filter((a) => a.owner === p && !a.dead);
  const units = mine.filter((a) => a.mobile && !a.harvester);
  const enemy = w.actors.filter((a) => !a.dead && p.isEnemy(a.owner));
  const r = Math.random();
  if (r < 0.05 && units.length) {
    const sub = units.filter(() => Math.random() < 0.6);
    const x = (8 + Math.floor(Math.random() * 80)) * CELL, y = (8 + Math.floor(Math.random() * 80)) * CELL;
    if (sub.length) out.push(makeOrder(Math.random() < 0.5 ? 'Move' : 'AttackMove', sub, { x, y }, undefined, Math.random() < 0.2));
  } else if (r < 0.08 && units.length && enemy.length) {
    out.push(makeOrder('Attack', units, { actor: enemy[Math.floor(Math.random() * enemy.length)] }));
  } else if (r < 0.12) {
    const q = mine.map((a) => a.enabledTrait('ProductionQueue')).filter(Boolean);
    if (q.length) {
      const pq = q[Math.floor(Math.random() * q.length)];
      const opts = pq.buildables();
      out.push(makeOrder('StartProduction', [pq.self], null, opts[Math.floor(Math.random() * opts.length)].name));
    }
  } else if (r < 0.14) {
    const core = mine.find((a) => a.type === 'core');
    const types = ['pylon', 'resonator', 'foundry', 'spire', 'siphon', 'uplink'];
    if (core) out.push(makeOrder('PlaceBuilding', [], { x: core.x + (Math.floor(Math.random() * 17) - 8) * CELL, y: core.y + (Math.floor(Math.random() * 17) - 8) * CELL }, types[Math.floor(Math.random() * types.length)]));
  } else if (r < 0.145 && units.length) {
    out.push(makeOrder('SetStance', units, null, Math.random() < 0.5 ? 'Defend' : 'AttackAnything'));
  } else if (r < 0.15 && units.length) {
    out.push(makeOrder('Stop', units));
  }
  return out;
}

// ---------------------------------------------------------------- 1. two-client lockstep
const players = [{ name: 'A', faction: 'accord', client: 0 }, { name: 'B', faction: 'combine', client: 1 }];
const net = new FakeNet();
const clients = [];
for (const c of [0, 1]) {
  const w = await makeWorld(SEED, players);
  const om = new OrderManager(w, net.connect(c), { localClient: c, clients: [0, 1], latency: 6 });
  clients.push({ w, om, hashes: [] });
}
let steps = 0, stalls = 0;
while (Math.min(clients[0].w.frame, clients[1].w.frame) < FRAMES && steps < FRAMES * 20) {
  steps++;
  net.step();
  for (const c of clients) {
    const p = c.w.players[clients.indexOf(c)];
    if (c.om.ready(c.w.frame)) for (const o of randomOrders(c.w, p)) c.om.issue(o);
    if (c.w.frame < FRAMES) { const f = c.w.frame; if (c.om.tryTick()) c.hashes[f] = c.w.syncHash(); else stalls++; }
  }
}
let mismatch = -1;
for (let f = 0; f < FRAMES; f++) if (clients[0].hashes[f] !== clients[1].hashes[f]) { mismatch = f; break; }
check(clients[0].w.frame === FRAMES && clients[1].w.frame === FRAMES, `both clients simulated ${FRAMES} frames (${stalls} stalls waiting on the network)`);
check(mismatch < 0, mismatch < 0 ? 'sync hashes identical on every frame' : `desync at frame ${mismatch}`);
check(!clients[0].om.desync && !clients[1].om.desync, 'no desync reported by the in-game sync check');
const orderCount = clients[0].om.replay.frames.reduce((s, f) => s + f[2].length, 0);
check(orderCount > 50, `${orderCount} orders exchanged`);
console.log(`      ${summary(clients[0].w)}`);

// ---------------------------------------------------------------- 2. replay
const replay = JSON.parse(JSON.stringify(clients[0].om.replay));
const rw = await makeWorld(replay.settings.seed, replay.settings.players);
const rconn = new ReplayConnection(replay);
const rom = new OrderManager(rw, rconn, { localClient: -1, clients: [0, 1], latency: 0, record: false });
rconn.attach(rom);
while (rw.frame < replay.endFrame && rom.tryTick());
check(rw.frame === clients[0].w.frame && rw.syncHash() === clients[0].w.syncHash(), `replay reproduces the final state (frame ${rw.frame}, hash ${rw.syncHash().toString(16)})`);

// ---------------------------------------------------------------- 3. bots finish a game
const bw = await makeWorld(SEED, [{ name: 'X', faction: 'accord', bot: 'hard' }, { name: 'Y', faction: 'combine', bot: 'normal' }]);
while (!bw.gameOver && bw.frame < 25 * 60 * 25) bw.tick();
check(bw.gameOver, `bot match ended at ${(bw.frame / 1500).toFixed(1)} min (${bw.players.map((p) => `${p.name} ${p.outcome}`).join(', ')})`);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
