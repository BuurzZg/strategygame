// WebSocket client for the relay server: lobby messages plus in-game order packets.
// The relay never simulates anything; it only forwards packets between clients.
export class NetClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.client = -1;
    this.room = null;
    this.lobby = null;
    this.onPacket = null;   // OrderManager hooks
    this.onLeft = null;
    this.onLobby = null;    // UI hooks
    this.onStart = null;
    this.onError = null;
    this.onClose = null;
    this.backlog = [];      // packets that arrive before the OrderManager is attached
  }

  connect() {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { reject(e); return; }
      this.ws = ws;
      ws.onopen = () => resolve(this);
      ws.onerror = () => reject(new Error(`Could not reach the relay at ${this.url}`));
      ws.onclose = () => { if (this.onClose) this.onClose(); };
      ws.onmessage = (ev) => this.handle(JSON.parse(ev.data));
    });
  }

  handle(m) {
    switch (m.t) {
      case 'joined': this.client = m.client; this.room = m.room; break;
      case 'lobby': this.lobby = m.lobby; if (this.onLobby) this.onLobby(m.lobby); break;
      case 'start': if (this.onStart) this.onStart(m.settings); break;
      case 'packet':
        if (this.onPacket) this.onPacket(m); else this.backlog.push(m);
        break;
      case 'left': if (this.onLeft) this.onLeft(m.c, m.lastFrame); else this.backlog.push(m); break;
      case 'error': if (this.onError) this.onError(m.message); break;
    }
  }

  // Called by OrderManager after it installs onPacket/onLeft.
  flushBacklog() {
    const b = this.backlog; this.backlog = [];
    for (const m of b) this.handle(m);
  }

  sendRaw(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  host(name) { this.sendRaw({ t: 'host', name }); }
  join(room, name) { this.sendRaw({ t: 'join', room: room.toUpperCase().trim(), name }); }
  update(patch) { this.sendRaw({ t: 'lobby', patch }); }
  start() { this.sendRaw({ t: 'start' }); }
  send(packet) { this.sendRaw({ t: 'packet', ...packet }); }
  close() { if (this.ws) this.ws.close(); }
}

export function defaultRelayUrl() {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return 'ws://localhost:8080/ws';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}
