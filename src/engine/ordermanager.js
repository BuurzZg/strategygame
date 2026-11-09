// Lockstep order scheduling.
//
// Every client runs the same simulation. Orders issued while simulating frame F are sent
// (to everyone, through the connection) tagged for frame F + latency. A client may only
// simulate frame F once it holds every client's packet for F, so all clients execute the
// same orders on the same frame. Frames below `latency` are implicitly empty.
//
// Each packet also carries the sender's sync hash for the frame it was sent on; mismatches
// mean the simulations diverged (a desync) and are reported via onDesync.

export const TICK_MS = 40; // 25 ticks per second

export class OrderManager {
  constructor(world, connection, { localClient, clients, latency = 1, record = true }) {
    this.world = world;
    this.conn = connection;
    this.local = localClient;
    this.clients = clients.slice().sort((a, b) => a - b);
    this.latency = latency;
    this.frames = new Map();     // frame -> Map(client -> orders[])
    this.pending = [];           // local orders waiting for the next packet
    this.sentUpTo = latency - 1;
    this.gone = new Map();       // client -> last frame they sent
    this.localHashes = new Map();
    this.remoteHashes = new Map();
    this.desync = null;
    this.onDesync = null;
    this.stalled = false;
    this.replay = record ? { version: 2, settings: world.settings, frames: [] } : null;
    this.playerForClient = new Map(world.players.filter((p) => p.clientIndex >= 0).map((p) => [p.clientIndex, p]));
    connection.onPacket = (p) => this.receive(p);
    connection.onLeft = (c, last) => this.left(c, last);
  }

  get isPlayer() { return this.clients.includes(this.local); }

  issue(order) { if (this.isPlayer) this.pending.push(order); }

  receive({ c, f, o, s, sf }) {
    this.store(f, c, o || []);
    if (s === undefined) return;
    const mine = this.localHashes.get(sf);
    if (mine !== undefined) this.compare(sf, c, mine, s);
    else { if (!this.remoteHashes.has(sf)) this.remoteHashes.set(sf, []); this.remoteHashes.get(sf).push([c, s]); }
  }
  store(f, c, orders) {
    if (!this.frames.has(f)) this.frames.set(f, new Map());
    this.frames.get(f).set(c, orders);
  }
  compare(frame, client, mine, theirs) {
    if (mine === theirs || this.desync) return;
    this.desync = { frame, client, mine, theirs };
    if (this.onDesync) this.onDesync(this.desync);
  }
  left(c, lastFrame) { this.gone.set(c, lastFrame); }

  ready(frame) {
    if (frame < this.latency) return true;
    const got = this.frames.get(frame);
    for (const c of this.clients) {
      if (this.gone.has(c) && frame > this.gone.get(c)) continue;
      if (!got || !got.has(c)) return false;
    }
    return true;
  }

  // Simulate one frame if every client's orders for it have arrived. Returns false when stalled.
  tryTick() {
    const w = this.world, f = w.frame;
    if (!this.ready(f)) { this.stalled = true; return false; }
    this.stalled = false;

    const hash = w.syncHash();
    this.localHashes.set(f, hash);
    const rem = this.remoteHashes.get(f);
    if (rem) { for (const [c, s] of rem) this.compare(f, c, hash, s); this.remoteHashes.delete(f); }
    this.localHashes.delete(f - 250);

    if (this.isPlayer && !this.gone.has(this.local)) {
      const target = f + this.latency;
      if (target > this.sentUpTo) {
        const packet = { f: target, o: this.pending, s: hash, sf: f };
        this.pending = [];
        this.store(target, this.local, packet.o);
        this.conn.send(packet);
        this.sentUpTo = target;
      }
    }

    const bucket = this.frames.get(f);
    for (const c of this.clients) {
      const orders = bucket && bucket.get(c);
      const player = this.playerForClient.get(c);
      if (orders && orders.length) {
        if (this.replay) this.replay.frames.push([f, c, orders]);
        if (player) for (const o of orders) w.resolveOrder(o, player);
      }
      if (this.gone.has(c) && f === this.gone.get(c) + 1 && player && !player.outcome) {
        const surrender = { n: 'Surrender', s: [] };
        if (this.replay) this.replay.frames.push([f, c, [surrender]]);
        w.resolveOrder(surrender, player);
      }
    }
    this.frames.delete(f);
    w.tick();
    if (this.replay) this.replay.endFrame = w.frame;
    return true;
  }
}

// ---------------------------------------------------------------- connections
// Single player: our own packets are stored locally by the OrderManager; nothing to send.
export class LocalConnection {
  constructor() { this.onPacket = null; this.onLeft = null; }
  send() {}
}

// Plays back a recorded replay: every frame is ready, orders come from the file.
export class ReplayConnection {
  constructor(replay) { this.replay = replay; this.onPacket = null; this.onLeft = null; }
  attach(om) {
    om.latency = 0;
    om.ready = (frame) => frame <= (this.replay.endFrame ?? Infinity);
    const byFrame = new Map();
    for (const [f, c, o] of this.replay.frames) { if (!byFrame.has(f)) byFrame.set(f, new Map()); byFrame.get(f).set(c, o); }
    om.frames = byFrame;
    // surrenders are recorded explicitly in replays, so the `gone` path must not re-inject them
    om.gone = new Map();
  }
  send() {}
}
