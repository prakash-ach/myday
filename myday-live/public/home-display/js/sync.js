// Optional synchronisation of household-scoped photos through private server
// storage. Device-only photos are never uploaded.
//   push: household photos imported on this device → POST /api/photos
//   pull: household photos from other devices        → GET  /api/photos?since=
//   deletes of household photos are propagated       → DELETE /api/photos/:id
// Every synced photo is still stored locally, so the slideshow never needs the
// network to keep playing.
import { kv } from './db.js';
import { apiFetch } from './config.js';
import { library } from './library.js';
import { loadBlob } from './blobstore.js';
import { importOne } from './importer.js';

export class HouseholdSync extends EventTarget {
  constructor(settings) {
    super();
    this.settings = settings;
    this.busy = false;
    this.status = 'idle';
    this.lastRun = 0;
  }

  start() {
    setInterval(() => this.run(), 10 * 60_000);
    window.addEventListener('online', () => this.run());
    this.settings.addEventListener('change', (e) => { if (e.detail.syncEnabled) this.run(); });
    this.run();
  }

  #set(status) { this.status = status; this.dispatchEvent(new Event('status')); }

  async run() {
    if (!this.settings.values.syncEnabled || this.busy) return;
    if (!navigator.onLine) { this.#set('waiting for network'); return; }
    this.busy = true;
    this.#set('syncing');
    try {
      await this.#pushDeletes();
      const up = await this.#push();
      const down = await this.#pull();
      this.lastRun = Date.now();
      this.#set(`up to date${up || down ? ` (sent ${up}, received ${down})` : ''}`);
    } catch (err) {
      this.#set(err.unconfigured ? 'no server configured' : `couldn’t sync: ${err.message}`);
    } finally {
      this.busy = false;
    }
  }

  async #pushDeletes() {
    const pending = (await kv.get('pendingRemoteDeletes')) || [];
    const left = [];
    for (const remoteId of pending) {
      try { await apiFetch(`/photos/${encodeURIComponent(remoteId)}`, { method: 'DELETE' }); }
      catch (err) { if (err.status !== 404) left.push(remoteId); }
    }
    await kv.set('pendingRemoteDeletes', left);
  }

  async #push() {
    let sent = 0;
    const mine = [...library.photos.values()].filter(
      (p) => p.scope === 'household' && !p.remoteId && p.deviceId === library.deviceId);
    for (const p of mine) {
      const fd = new FormData();
      fd.append('file', await loadBlob(p, 'full'), p.name);
      fd.append('meta', JSON.stringify({
        fingerprint: p.fingerprint, name: p.name, width: p.width, height: p.height, addedAt: p.addedAt,
      }));
      const r = await apiFetch('/photos', { method: 'POST', body: fd });
      await library.update([p.id], (x) => { x.remoteId = r.remoteId; });
      sent++;
    }
    return sent;
  }

  async #pull() {
    let received = 0;
    let cursor = (await kv.get('syncCursor')) || '';
    for (let page = 0; page < 50; page++) {
      const r = await apiFetch(`/photos?since=${encodeURIComponent(cursor)}`);
      for (const m of r.photos || []) {
        if (library.findByRemoteId(m.remoteId)) continue;
        const localId = library.byFingerprint.get(m.fingerprint);
        if (localId) { await library.update([localId], (x) => { x.remoteId = m.remoteId; }); continue; }
        const res = await apiFetch(`/photos/${encodeURIComponent(m.remoteId)}/content`, { raw: true });
        const blob = await res.blob();
        await importOne(blob, {
          name: m.name, fingerprint: m.fingerprint, remoteId: m.remoteId,
          scope: 'household', source: 'sync', deviceId: m.deviceId, addedAt: m.addedAt,
        });
        received++;
      }
      const deletedIds = (r.deleted || [])
        .map((rid) => library.findByRemoteId(rid)?.id).filter(Boolean);
      if (deletedIds.length) await library.remove(deletedIds);
      cursor = r.cursor || cursor;
      await kv.set('syncCursor', cursor);
      if (!r.hasMore) break;
    }
    return received;
  }
}
