// Glasswake relay server.
//
//   npm install
//   npm start                      -> http://localhost:8080  (PORT=xxxx to change)
//
// Serves the game files over HTTP and relays lockstep order packets over WebSocket (/ws).
// It holds lobby state but never simulates the game: every client runs the identical
// deterministic simulation and the relay just forwards each client's orders to the others.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 8080);
const LATENCY = +(process.env.LATENCY || 6); // order delay in ticks (40 ms each)
const SLOTS = 2;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.yaml': 'text/yaml; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };

// ---------------------------------------------------------------- static files
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/relay.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ relay: true, latency: LATENCY, rooms: rooms.size }));
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.resolve(ROOT, '.' + p);
    if (!file.startsWith(ROOT + path.sep) || /[\\/](\.git|node_modules|server)[\\/]/.test(file)) { res.writeHead(403); res.end('Forbidden'); return; }
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});

// ---------------------------------------------------------------- rooms
const rooms = new Map();
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
const clean = (s, n = 24) => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, n).trim();

function lobbyState(room) {
  return {
    room: room.code, host: room.host, seed: room.seed, started: room.started, latency: LATENCY,
    clients: [...room.clients.values()].map((c) => ({ id: c.id, name: c.name, faction: c.faction })),
    slots: room.slots,
  };
}
function broadcast(room, m, except) { for (const c of room.clients.values()) if (c !== except) send(c.ws, m); }
function pushLobby(room) { broadcast(room, { t: 'lobby', lobby: lobbyState(room) }); }

function joinRoom(room, ws, name) {
  const id = room.nextId++;
  const c = { id, ws, name: clean(name) || `Player ${id + 1}`, faction: id % 2 ? 'combine' : 'accord' };
  room.clients.set(id, c);
  const open = room.slots.findIndex((s) => s.kind === 'open');
  if (open >= 0) room.slots[open] = { kind: 'client', client: id };
  ws.room = room; ws.client = c;
  send(ws, { t: 'joined', room: room.code, client: id });
  pushLobby(room);
}

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    const room = ws.room, me = ws.client;
    switch (m.t) {
      case 'host': {
        if (room) return;
        const r = { code: code(), clients: new Map(), nextId: 0, host: 0, seed: 1 + Math.floor(Math.random() * 99998), started: false, lastFrame: new Map(), slots: Array.from({ length: SLOTS }, () => ({ kind: 'open' })) };
        rooms.set(r.code, r);
        joinRoom(r, ws, m.name);
        break;
      }
      case 'join': {
        if (room) return;
        const r = rooms.get(String(m.room || '').toUpperCase());
        if (!r) return send(ws, { t: 'error', message: 'No game with that code' });
        if (r.started) return send(ws, { t: 'error', message: 'That game has already started' });
        joinRoom(r, ws, m.name);
        break;
      }
      case 'lobby': {
        if (!room || room.started || !m.patch) return;
        const p = m.patch;
        if (p.name !== undefined) me.name = clean(p.name) || me.name;
        if (p.faction === 'accord' || p.faction === 'combine') me.faction = p.faction;
        if (me.id === room.host) {
          if (Number.isInteger(p.seed) && p.seed > 0 && p.seed < 100000) room.seed = p.seed;
          if (Number.isInteger(p.slot) && p.slot >= 0 && p.slot < SLOTS) {
            const cur = room.slots[p.slot];
            if (cur.kind !== 'client') {
              if (p.slotKind === 'open') room.slots[p.slot] = { kind: 'open' };
              else if (['easy', 'normal', 'hard'].includes(p.slotKind)) room.slots[p.slot] = { kind: 'bot', bot: p.slotKind, faction: p.botFaction === 'accord' ? 'accord' : 'combine' };
            }
          }
        }
        pushLobby(room);
        break;
      }
      case 'start': {
        if (!room || room.started || me.id !== room.host) return;
        if (room.slots.some((s) => s.kind === 'open')) return send(ws, { t: 'error', message: 'Fill every slot (with a player or a bot) before starting' });
        room.started = true;
        const players = room.slots.map((s, i) => s.kind === 'client'
          ? { name: room.clients.get(s.client).name, faction: room.clients.get(s.client).faction, client: s.client, spawn: i, team: i }
          : { name: `Bot (${s.bot})`, faction: s.faction, bot: s.bot, spawn: i, team: i });
        const settings = { seed: room.seed, latency: LATENCY, players, mode: 'multiplayer' };
        broadcast(room, { t: 'start', settings });
        break;
      }
      case 'packet': {
        if (!room || !room.started || !room.slots.some((s) => s.kind === 'client' && s.client === me.id)) return;
        if (!Number.isInteger(m.f)) return;
        room.lastFrame.set(me.id, m.f);
        broadcast(room, { t: 'packet', c: me.id, f: m.f, o: Array.isArray(m.o) ? m.o : [], s: m.s, sf: m.sf }, ws.client);
        break;
      }
    }
  });

  ws.on('close', () => {
    const room = ws.room, me = ws.client;
    if (!room) return;
    room.clients.delete(me.id);
    const slot = room.slots.findIndex((s) => s.kind === 'client' && s.client === me.id);
    if (room.started) {
      if (slot >= 0) broadcast(room, { t: 'left', c: me.id, lastFrame: room.lastFrame.get(me.id) ?? LATENCY - 1 });
    } else {
      if (slot >= 0) room.slots[slot] = { kind: 'open' };
      if (me.id === room.host && room.clients.size) {
        room.host = Math.min(...room.clients.keys());
        const hs = room.slots.findIndex((s) => s.kind === 'client' && s.client === room.host);
        if (hs > 0) { [room.slots[0], room.slots[hs]] = [room.slots[hs], room.slots[0]]; }
      }
      pushLobby(room);
    }
    if (!room.clients.size) rooms.delete(room.code);
  });
});

server.listen(PORT, () => {
  console.log(`Glasswake running at http://localhost:${PORT}`);
  console.log(`Friends on your network can join via http://<your-ip>:${PORT}`);
});
