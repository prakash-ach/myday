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
      live: 'Live', connecting: 'Connecting…', offline: detail || 'Offline', idle: '', unsupported: detail,
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
    if (!this.active && this.state === 'idle') return;
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
    if (this.cam.protocol !== 'webrtc' && this.cam.protocol !== 'snapshot') {
      this.setStatus('unsupported', this.cam.note || 'This camera can’t stream to a browser.');
      return;
    }
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

// How many tiles each view shows. Tiles outside the view are stopped, so a
// 2×2 view never holds more than four Nest streams open.
export const CAMERA_VIEWS = {
  single: { label: 'Single', cap: 1 },
  grid2: { label: '2×2', cap: 4 },
  grid3: { label: '3×3', cap: 9 },
  focus: { label: 'Big + small', cap: 5 },
};

export class CameraWall extends EventTarget {
  constructor({ getOrder, setOrder }) {
    super();
    this.root = document.createElement('div');
    this.root.className = 'camera-grid';
    this.root.dataset.count = '0';
    this.getOrder = getOrder;
    this.setOrder = setOrder;
    this.tiles = new Map();
    this.view = 'grid2';
    this.active = false;
    this.focusId = null;
    this.listState = 'unknown'; // unknown | ok | unconfigured | notConnected | unauthorized | offline
    this.listTimer = null;
    window.addEventListener('online', () => { if (this.active) this.refreshList(); });
    this.#bindDrag();
  }

  /** Move the grid into a container (full-screen view or the dashboard widget). */
  mount(container) {
    if (this.root.parentNode === container) return;
    container.append(this.root);
    for (const t of this.tiles.values()) if (t.video.srcObject) t.video.play().catch(() => {});
  }

  setView(view) {
    if (!CAMERA_VIEWS[view] || view === this.view) return;
    this.view = view;
    this.#arrange();
  }

  /** Ids in display order: the saved order first, new cameras after. */
  orderedIds() {
    const saved = (this.getOrder() || []).filter((id) => this.tiles.has(id));
    return [...saved, ...[...this.tiles.keys()].filter((id) => !saved.includes(id))];
  }

  swap(a, b) {
    const ids = this.orderedIds();
    const i = ids.indexOf(a), j = ids.indexOf(b);
    if (i < 0 || j < 0 || i === j) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    this.setOrder(ids);
    this.#arrange();
  }

  rotate(step) {
    const ids = this.orderedIds();
    if (ids.length < 2) return;
    const next = step > 0 ? [...ids.slice(1), ids[0]] : [ids[ids.length - 1], ...ids.slice(0, -1)];
    this.setOrder(next);
    this.#arrange();
  }

  promote(id) {
    const ids = this.orderedIds();
    if (!ids.includes(id) || ids[0] === id) return;
    this.swap(ids[0], id);
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
      }
      for (const [id, tile] of this.tiles) {
        if (!seen.has(id)) { tile.stop(); tile.el.remove(); this.tiles.delete(id); }
      }
      this.listTimer = setTimeout(() => this.refreshList(), 15 * 60_000);
    } catch (err) {
      this.listState = err.unconfigured ? 'unconfigured'
        : err.status === 409 ? 'notConnected'
          : err.status === 401 || err.status === 403 ? 'unauthorized'
            : err.status === 404 ? 'unconfigured' : 'offline';
      if (this.active && this.listState === 'offline') this.listTimer = setTimeout(() => this.refreshList(), 30_000);
    }
    this.#arrange();
    this.#emit();
  }

  setActive(on, { focusCameraId = null } = {}) {
    this.focusId = focusCameraId;
    const changed = on !== this.active;
    this.active = on;
    if (on && changed && this.listState !== 'ok') this.refreshList();
    if (!on) clearTimeout(this.listTimer);
    this.#arrange();
    if (changed) this.#emit();
  }

  /** Lay tiles out in order, start the visible ones, stop the rest. */
  #arrange() {
    const ids = this.orderedIds();
    const focus = this.focusId && this.tiles.has(this.focusId) ? this.focusId : null;
    const view = focus ? 'single' : this.view;
    const shown = focus ? [focus] : ids.slice(0, CAMERA_VIEWS[view].cap);
    this.root.dataset.view = view;
    this.root.dataset.count = String(shown.length);
    ids.forEach((id, i) => {
      const t = this.tiles.get(id);
      const on = shown.includes(id);
      t.el.hidden = !on;
      t.el.style.order = String(focus ? 0 : i);
      t.el.classList.toggle('is-lead', on && shown[0] === id);
      if (on && this.active) t.start(); else t.stop();
    });
    this.root.classList.toggle('has-more', !focus && view === 'single' && ids.length > 1);
  }

  // Long-press a tile, then drag it onto another to swap places.
  #bindDrag() {
    let press = null;
    const clear = () => {
      if (!press) return;
      clearTimeout(press.timer);
      press.ghost?.remove();
      press.tile?.classList.remove('is-lifted');
      this.root.querySelector('.is-target')?.classList.remove('is-target');
      press = null;
    };
    const targetAt = (x, y) => document.elementsFromPoint(x, y).map((el) => el.closest?.('.cam'))
      .find((el) => el && el !== press.tile && this.root.contains(el));
    this.root.addEventListener('pointerdown', (e) => {
      const tile = e.target.closest('.cam');
      if (!tile || document.body.classList.contains('is-editing') || e.button > 0) return;
      press = { tile, x: e.clientX, y: e.clientY, id: e.pointerId, lifted: false };
      press.timer = setTimeout(() => {
        if (!press) return;
        press.lifted = true;
        tile.classList.add('is-lifted');
        tile.setPointerCapture?.(press.id);
        const r = tile.getBoundingClientRect();
        const g = document.createElement('div');
        g.className = 'cam-ghost';
        g.textContent = tile.querySelector('.cam-name')?.textContent || 'Camera';
        Object.assign(g.style, { width: `${Math.min(r.width, 260)}px`, left: `${press.x}px`, top: `${press.y}px` });
        document.body.append(g);
        press.ghost = g;
        navigator.vibrate?.(15);
      }, 320);
    });
    this.root.addEventListener('pointermove', (e) => {
      if (!press || e.pointerId !== press.id) return;
      if (!press.lifted) {
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) clear();
        return;
      }
      e.preventDefault();
      press.ghost.style.left = `${e.clientX}px`;
      press.ghost.style.top = `${e.clientY}px`;
      const t = targetAt(e.clientX, e.clientY);
      const prev = this.root.querySelector('.is-target');
      if (prev !== t) { prev?.classList.remove('is-target'); t?.classList.add('is-target'); }
    });
    const end = (e) => {
      if (!press || e.pointerId !== press.id) return;
      if (press.lifted) {
        const t = targetAt(e.clientX, e.clientY);
        if (t) this.swap(press.tile.dataset.id, t.dataset.id);
      } else if (e.type === 'pointerup' && this.view === 'focus' && !this.focusId) {
        this.promote(press.tile.dataset.id); // tap a small tile to make it the big one
      }
      clear();
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
    this.root.addEventListener('contextmenu', (e) => { if (e.target.closest('.cam')) e.preventDefault(); });
  }

  cameraName(id) { return this.tiles.get(id)?.cam.name || 'Door camera'; }

  get allOffline() {
    if (!this.active) return false;
    if (this.listState !== 'ok') return this.listState !== 'unknown';
    if (!this.tiles.size) return true;
    return [...this.tiles.values()].every((t) => t.state === 'offline' || t.state === 'unsupported');
  }

  statusText() {
    switch (this.listState) {
      case 'unconfigured': return 'Nest isn’t set up on the server yet.';
      case 'notConnected': return 'Nest isn’t connected. Sign in to MYDAY as the owner, then choose Connect Nest in Controls.';
      case 'unauthorized': return 'This display isn’t allowed to open the cameras. Sign in again.';
      case 'offline': return 'Cameras are unreachable right now. Retrying automatically.';
      default:
        if (this.listState === 'ok' && !this.tiles.size) return 'No cameras were shared with MYDAY. Connect Nest again and tick the cameras to show.';
        if (this.allOffline) return 'All cameras are offline. Retrying automatically.';
        return '';
    }
  }

  #emit() { this.dispatchEvent(new Event('status')); }
}
