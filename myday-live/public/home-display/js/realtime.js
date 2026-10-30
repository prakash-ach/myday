// Live event channel to the household backend (doorbell presses, remote
// display commands from the phone, settings pushes).
// Reconnects forever with jittered exponential backoff; detects silently dead
// sockets with an application-level heartbeat; reconnects immediately when
// the network returns or the page becomes visible.
import { CONFIG } from './config.js';

export class Realtime extends EventTarget {
  constructor(deviceId, deviceName) {
    super();
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.ws = null;
    this.attempt = 0;
    this.state = 'idle';
    this.retryTimer = null;
    this.heartbeat = null;
    this.lastMessageAt = 0;
    window.addEventListener('online', () => this.reconnectNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.ws) this.reconnectNow();
    });
  }

  #setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.dispatchEvent(new Event('state'));
  }

  start() { this.connect(); }

  reconnectNow() {
    this.attempt = 0;
    if (!this.ws || this.ws.readyState > WebSocket.OPEN) this.connect();
  }

  connect() {
    clearTimeout(this.retryTimer);
    const url = CONFIG.wsUrl;
    if (!url) { this.#setState('unconfigured'); return; }
    let ws;
    try { ws = new WebSocket(url); } catch { this.#scheduleRetry(); return; }
    this.ws = ws;
    this.#setState('connecting');

    ws.onopen = async () => {
      this.attempt = 0;
      const token = await CONFIG.getAuthToken();
      if (ws.readyState !== WebSocket.OPEN) return;
      // Auth in the first message, never in the URL.
      ws.send(JSON.stringify({ type: 'hello', role: 'display', deviceId: this.deviceId, deviceName: this.deviceName, token }));
      this.lastMessageAt = Date.now();
      this.#setState('online');
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastMessageAt > 65_000) { ws.close(4000, 'heartbeat timeout'); return; }
        this.send({ type: 'ping', t: Date.now() });
      }, 25_000);
    };

    ws.onmessage = (e) => {
      this.lastMessageAt = Date.now();
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (!msg?.type || msg.type === 'pong') return;
      this.dispatchEvent(new CustomEvent(`msg:${msg.type}`, { detail: msg }));
    };

    ws.onclose = () => {
      clearInterval(this.heartbeat);
      if (this.ws !== ws) return;
      this.ws = null;
      this.#setState('offline');
      this.#scheduleRetry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  #scheduleRetry() {
    const cap = Math.min(30_000, 1000 * 2 ** this.attempt++);
    this.retryTimer = setTimeout(() => this.connect(), cap / 2 + Math.random() * cap / 2);
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)); return true; } catch { /* closing */ }
    }
    return false;
  }

  on(type, fn) { this.addEventListener(`msg:${type}`, (e) => fn(e.detail)); }
}
