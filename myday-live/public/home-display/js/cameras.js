// Live camera wall. Streams come from the household backend, which wraps the
// Google Nest Smart Device Management API (see docs/API_CONTRACT.md):
//   GET  /api/cameras                          → [{ id, name, protocol: 'webrtc'|'snapshot', iceServers? }]
//   POST /api/cameras/:id/webrtc               { offerSdp } → { answerSdp, mediaSessionId, expiresAt }
//   POST /api/cameras/:id/webrtc/extend        { mediaSessionId } → { mediaSessionId, expiresAt }
//   POST /api/cameras/:id/webrtc/stop          { mediaSessionId }
//   GET  /api/cameras/:id/snapshot             → image (legacy/RTSP cameras transcoded server-side)
// Nest WebRTC sessions expire after ~5 minutes; they are extended before
// expiry and fully re-negotiated if extension fails or the connection drops.
import { apiFetch } from './config.js';

function iceGathered(pc, timeoutMs) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); clearTimeout(t); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

class CameraTile extends EventTarget {
  constructor(cam) {
    super();
    this.cam = cam;
    this.state = 'idle';
    this.detail = '';
    this.attempt = 0;
    this.gen = 0;
    this.timers = new Set();
    this.active = false;
    this.pc = null;
    this.session = null;
    this.snapshotUrl = null;

    this.el = document.createElement('figure');
    this.el.className = 'cam';
    this.el.dataset.id = cam.id;
    this.video = document.createElement('video');
    Object.assign(this.video, { autoplay: true, muted: true, playsInline: true });
    this.video.setAttribute('playsinline', '');
    this.img = document.createElement('img');
    this.img.alt = '';
    this.img.hidden = true;
    const cap = document.createElement('figcaption');
    this.nameEl = document.createElement('span');
    this.nameEl.className = 'cam-name';
    this.nameEl.textContent = cam.name;
    this.badge = document.createElement('span');
    this.badge.className = 'cam-badge';
    cap.append(this.nameEl, this.badge);
    this.el.append(this.video, this.img, cap);
  }

  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  setStatus(state, detail = '') {
    this.state = state;
    this.detail = detail;
    this.el.dataset.state = state;
    this.badge.textContent = {
      live: 'Live', connecting: 'Connecting…', offline: detail || 'Offline', idle: '',
    }[state] ?? '';
    this.dispatchEvent(new Event('status'));
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.attempt = 0;
    this.connect();
  }

  stop() {
    this.active = false;
    this.teardown();
    this.setStatus('idle');
  }

  teardown() {
    this.gen++;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.pc) {
      this.pc.ontrack = this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
    if (this.session) {
      const mediaSessionId = this.session;
      this.session = null;
      apiFetch(`/cameras/${encodeURIComponent(this.cam.id)}/webrtc/stop`,
        { method: 'POST', json: { mediaSessionId } }).catch(() => {});
    }
    this.video.srcObject = null;
    if (this.snapshotUrl) { URL.revokeObjectURL(this.snapshotUrl); this.snapshotUrl = null; }
    this.img.removeAttribute('src');
  }

  async connect() {
    this.teardown();
    if (!this.active) return;
    const gen = this.gen;
    this.setStatus('connecting');
    try {
      if (this.cam.protocol === 'snapshot') await this.#startSnapshots(gen);
      else await this.#startWebRtc(gen);
    } catch (err) {
      if (gen === this.gen) this.fail(err);
    }
  }

  fail(err) {
    console.warn(`[camera ${this.cam.name}]`, err?.message || err);
    this.teardown();
    if (!this.active) return;
    const base = Math.min(60, 2 ** this.attempt * 2);
    const delay = Math.round(base * (0.75 + Math.random() * 0.5));
    this.attempt++;
    const until = Date.now() + delay * 1000;
    const tick = () => {
      const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      this.setStatus('offline', s ? `Offline — retrying in ${s}s` : 'Offline — retrying');
      if (s > 0) this.later(tick, 1000);
    };
    tick();
    this.later(() => this.connect(), delay * 1000);
  }

  async #startWebRtc(gen) {
    this.video.hidden = false;
    this.img.hidden = true;
    const pc = new RTCPeerConnection({ iceServers: this.cam.iceServers || [] });
    this.pc = pc;
    // Nest requires audio, video and a data channel in the offer, in this order.
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.createDataChannel('dataSendChannel');

    pc.ontrack = (e) => {
      if (gen !== this.gen) return;
      const stream = e.streams[0] || new MediaStream([e.track]);
      if (this.video.srcObject !== stream) this.video.srcObject = stream;
      this.video.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (gen !== this.gen) return;
      const s = pc.connectionState;
      if (s === 'connected') { this.attempt = 0; this.setStatus('live'); }
      else if (s === 'failed') this.fail(new Error('connection failed'));
      else if (s === 'disconnected') {
        this.later(() => { if (gen === this.gen && pc.connectionState !== 'connected') this.fail(new Error('connection lost')); }, 8000);
      }
    };

    await pc.setLocalDescription(await pc.createOffer());
    await iceGathered(pc, 2000);
    const res = await apiFetch(`/cameras/${encodeURIComponent(this.cam.id)}/webrtc`,
      { method: 'POST', json: { offerSdp: pc.localDescription.sdp } });
    if (gen !== this.gen) return;
    this.session = res.mediaSessionId;
    await pc.setRemoteDescription({ type: 'answer', sdp: res.answerSdp });
    this.#scheduleExtend(gen, res.expiresAt);
    this.later(() => { if (gen === this.gen && this.state !== 'live') this.fail(new Error('no video received')); }, 20_000);
  }

  #scheduleExtend(gen, expiresAt) {
    if (!expiresAt) return;
    const ms = Math.max(5000, new Date(expiresAt).getTime() - Date.now() - 60_000);
    this.later(async () => {
      if (gen !== this.gen) return;
      try {
        const r = await apiFetch(`/cameras/${encodeURIComponent(this.cam.id)}/webrtc/extend`,
          { method: 'POST', json: { mediaSessionId: this.session } });
        if (gen !== this.gen) return;
        if (r.mediaSessionId) this.session = r.mediaSessionId;
        this.#scheduleExtend(gen, r.expiresAt);
      } catch (err) {
        if (gen === this.gen) { this.attempt = 0; this.fail(new Error(`stream expired (${err.message})`)); }
      }
    }, ms);
  }

  async #startSnapshots(gen) {
    this.video.hidden = true;
    this.img.hidden = false;
    const every = Math.max(2, Number(this.cam.refreshSeconds) || 5) * 1000;
    const load = async () => {
      if (gen !== this.gen) return;
      try {
        const res = await apiFetch(`/cameras/${encodeURIComponent(this.cam.id)}/snapshot`, { raw: true });
        const url = URL.createObjectURL(await res.blob());
        if (gen !== this.gen) { URL.revokeObjectURL(url); return; }
        this.img.src = url;
        await this.img.decode().catch(() => {});
        if (this.snapshotUrl) URL.revokeObjectURL(this.snapshotUrl);
        this.snapshotUrl = url;
        this.attempt = 0;
        this.setStatus('live');
        this.later(load, every);
      } catch (err) {
        if (gen === this.gen) this.fail(err);
      }
    };
    await load();
  }
}

export class CameraWall extends EventTarget {
  constructor(root) {
    super();
    this.root = root;
    this.tiles = new Map();
    this.active = false;
    this.focusId = null;
    this.listState = 'unknown'; // unknown | ok | unconfigured | unauthorized | offline
    this.listTimer = null;
    window.addEventListener('online', () => { if (this.active) this.refreshList(); });
  }

  async refreshList() {
    clearTimeout(this.listTimer);
    try {
      const cams = await apiFetch('/cameras');
      this.listState = 'ok';
      const seen = new Set();
      for (const cam of cams) {
        seen.add(cam.id);
        let tile = this.tiles.get(cam.id);
        if (!tile) {
          tile = new CameraTile(cam);
          tile.addEventListener('status', () => this.#emit());
          this.tiles.set(cam.id, tile);
          this.root.append(tile.el);
        } else {
          tile.cam = cam;
          tile.nameEl.textContent = cam.name;
        }
        if (this.active) tile.start();
      }
      for (const [id, tile] of this.tiles) {
        if (!seen.has(id)) { tile.stop(); tile.el.remove(); this.tiles.delete(id); }
      }
      this.root.dataset.count = String(this.tiles.size);
      this.#applyFocus();
      this.listTimer = setTimeout(() => this.refreshList(), 15 * 60_000);
    } catch (err) {
      this.listState = err.unconfigured ? 'unconfigured'
        : err.status === 401 || err.status === 403 ? 'unauthorized'
          : err.status === 404 ? 'unconfigured' : 'offline';
      if (this.active) this.listTimer = setTimeout(() => this.refreshList(), 30_000);
    }
    this.#emit();
  }

  setActive(on, { focusCameraId = null } = {}) {
    this.focusId = focusCameraId;
    this.#applyFocus();
    if (on === this.active) {
      if (on && focusCameraId) this.tiles.get(focusCameraId)?.start();
      return;
    }
    this.active = on;
    if (on) {
      if (this.listState !== 'ok') this.refreshList();
      for (const t of this.tiles.values()) t.start();
    } else {
      clearTimeout(this.listTimer);
      for (const t of this.tiles.values()) t.stop();
    }
    this.#emit();
  }

  #applyFocus() {
    this.root.classList.toggle('has-focus', !!this.focusId && this.tiles.has(this.focusId));
    for (const [id, t] of this.tiles) t.el.classList.toggle('is-focused', id === this.focusId);
  }

  cameraName(id) { return this.tiles.get(id)?.cam.name || 'Door camera'; }

  get allOffline() {
    if (!this.active) return false;
    if (this.listState !== 'ok') return this.listState !== 'unknown';
    if (!this.tiles.size) return true;
    return [...this.tiles.values()].every((t) => t.state === 'offline');
  }

  statusText() {
    switch (this.listState) {
      case 'unconfigured': return 'No camera service is connected. Add the household server address in Controls → Device.';
      case 'unauthorized': return 'This display isn’t signed in to the camera service. Pair it again from the household app.';
      case 'offline': return 'Cameras are unreachable right now. Retrying automatically.';
      default:
        if (this.listState === 'ok' && !this.tiles.size) return 'No cameras are shared with this display.';
        if (this.allOffline) return 'All cameras are offline. Retrying automatically.';
        return '';
    }
  }

  #emit() { this.dispatchEvent(new Event('status')); }
}
