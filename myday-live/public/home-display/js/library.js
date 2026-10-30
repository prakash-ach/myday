// In-memory index of the local photo library (metadata only), persisted to
// IndexedDB. Image bytes live in blobstore.js.
//
// Slideshow eligibility rule (shown to the user in the Photos tab):
//   • a photo must be marked "show" (photo.selected) and not broken, and
//   • if any album is switched on for the slideshow, the photo must belong to
//     at least one of those albums; if none are, every shown photo is used.
import { db, kv } from './db.js';
import { deleteBlobs } from './blobstore.js';

class Library extends EventTarget {
  photos = new Map();
  albums = new Map();
  byFingerprint = new Map();
  deviceId = null;
  #eligible = null;
  #emitTimer = null;

  async load(deviceId) {
    this.deviceId = deviceId;
    for (const p of await db.all('photos')) this.#index(p);
    for (const a of await db.all('albums')) this.albums.set(a.id, a);
    this.#emit();
  }

  #index(p) {
    this.photos.set(p.id, p);
    if (p.fingerprint) this.byFingerprint.set(p.fingerprint, p.id);
  }

  #emit() {
    clearTimeout(this.#emitTimer);
    this.#emitTimer = null;
    this.#eligible = null;
    this.dispatchEvent(new Event('change'));
  }

  // Coalesces bursts of changes (bulk import of thousands of files).
  #emitSoon() {
    this.#eligible = null;
    if (!this.#emitTimer) this.#emitTimer = setTimeout(() => this.#emit(), 600);
  }

  hasFingerprint(fp) { return this.byFingerprint.has(fp); }
  findByRemoteId(remoteId) {
    for (const p of this.photos.values()) if (p.remoteId === remoteId) return p;
    return null;
  }

  list(filter = '') {
    let arr = [...this.photos.values()];
    if (filter === '__none') arr = arr.filter((p) => !p.albumIds.length);
    else if (filter === '__hidden') arr = arr.filter((p) => !p.selected);
    else if (filter) arr = arr.filter((p) => p.albumIds.includes(filter));
    return arr.sort((a, b) => b.addedAt - a.addedAt);
  }

  eligibleIds() {
    if (this.#eligible) return this.#eligible;
    const active = new Set([...this.albums.values()].filter((a) => a.inSlideshow).map((a) => a.id));
    this.#eligible = [...this.photos.values()]
      .filter((p) => p.selected && !p.broken && (!active.size || p.albumIds.some((id) => active.has(id))))
      .sort((a, b) => a.addedAt - b.addedAt || a.name.localeCompare(b.name))
      .map((p) => p.id);
    return this.#eligible;
  }

  isEligible(id) { return this.eligibleIds().includes(id); }

  async add(photo) {
    this.#index(photo);
    await db.put('photos', photo);
    this.#emitSoon();
  }

  async update(ids, mutate) {
    const changed = [];
    for (const id of ids) {
      const p = this.photos.get(id);
      if (!p) continue;
      mutate(p);
      changed.push(p);
    }
    if (changed.length) await db.putMany('photos', changed);
    this.#emit();
  }

  setShown(ids, shown) { return this.update(ids, (p) => { p.selected = shown; }); }

  addToAlbum(ids, albumId) {
    return this.update(ids, (p) => { if (!p.albumIds.includes(albumId)) p.albumIds.push(albumId); });
  }

  removeFromAlbum(ids, albumId) {
    return this.update(ids, (p) => { p.albumIds = p.albumIds.filter((a) => a !== albumId); });
  }

  async markBroken(id) {
    await this.update([id], (p) => { p.broken = true; });
  }

  async remove(ids) {
    const pendingDeletes = (await kv.get('pendingRemoteDeletes')) || [];
    for (const id of ids) {
      const p = this.photos.get(id);
      if (!p) continue;
      try { await deleteBlobs(p); } catch (e) { console.warn('[library] blob delete failed', e); }
      await db.delete('photos', id);
      this.photos.delete(id);
      if (p.fingerprint && this.byFingerprint.get(p.fingerprint) === id) this.byFingerprint.delete(p.fingerprint);
      if (p.remoteId && p.scope === 'household') pendingDeletes.push(p.remoteId);
    }
    await kv.set('pendingRemoteDeletes', pendingDeletes);
    this.#emit();
  }

  async createAlbum(name) {
    const album = { id: crypto.randomUUID(), name: name.trim(), inSlideshow: false, createdAt: Date.now() };
    this.albums.set(album.id, album);
    await db.put('albums', album);
    this.#emit();
    return album;
  }

  async findOrCreateAlbum(name) {
    for (const a of this.albums.values()) if (a.name === name) return a;
    return this.createAlbum(name);
  }

  async setAlbumInSlideshow(id, on) {
    const a = this.albums.get(id);
    if (!a) return;
    a.inSlideshow = on;
    await db.put('albums', a);
    this.#emit();
  }

  async deleteAlbum(id) {
    this.albums.delete(id);
    await db.delete('albums', id);
    await this.update([...this.photos.values()].filter((p) => p.albumIds.includes(id)).map((p) => p.id),
      (p) => { p.albumIds = p.albumIds.filter((a) => a !== id); });
  }
}

export const library = new Library();
