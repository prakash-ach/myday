// Imports user-selected photos into the private library.
//   • <input type="file" multiple>       – every browser, including Android WebView
//   • File System Access folder picker   – Chromium desktop; folders can be
//     re-checked later and only new files are imported (deduped by fingerprint)
// The app never assumes access to the whole photo gallery: only files or
// folders the user explicitly picks are read, and they are copied into the
// library so the slideshow keeps working without the folder or the network.
import { kv } from './db.js';
import { library } from './library.js';
import { saveBlobs } from './blobstore.js';
import { optimizeImage } from './optimize-core.js';

const IMAGE_RE = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp)$/i;
export const folderPickerSupported = typeof window.showDirectoryPicker === 'function';

const screenEdge = Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1);
const MAX_EDGE = Math.round(Math.min(3840, Math.max(1920, screenEdge)));
const THUMB_EDGE = 320;

export const fingerprintOf = (f) => `${f.name}|${f.size}|${f.lastModified ?? 0}`;
const isImage = (f) => (f.type ? f.type.startsWith('image/') : IMAGE_RE.test(f.name));

// ---- worker pool (falls back to main thread) --------------------------------
class Optimizer {
  #workers = [];
  #queue = [];
  #pending = new Map();
  #seq = 0;
  #useWorkers = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';

  constructor(size = Math.min(3, Math.max(1, (navigator.hardwareConcurrency || 2) - 1))) {
    if (!this.#useWorkers) return;
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL('./optimize-worker.js', import.meta.url), { type: 'module' });
        w.busy = false;
        w.onmessage = ({ data }) => {
          w.busy = false;
          const p = this.#pending.get(data.id);
          this.#pending.delete(data.id);
          data.error ? p.reject(new Error(data.error)) : p.resolve(data);
          this.#pump();
        };
        w.onerror = (e) => { console.warn('[optimizer] worker error', e); };
        this.#workers.push(w);
      }
    } catch (e) {
      console.warn('[optimizer] workers unavailable, using main thread', e);
      this.#useWorkers = false;
    }
  }

  run(file) {
    if (!this.#useWorkers) return optimizeImage(file, { maxEdge: MAX_EDGE, thumbEdge: THUMB_EDGE });
    return new Promise((resolve, reject) => {
      const id = ++this.#seq;
      this.#pending.set(id, { resolve, reject });
      this.#queue.push({ id, file, maxEdge: MAX_EDGE, thumbEdge: THUMB_EDGE });
      this.#pump();
    });
  }

  #pump() {
    for (const w of this.#workers) {
      if (w.busy || !this.#queue.length) continue;
      w.busy = true;
      w.postMessage(this.#queue.shift());
    }
  }
}

let optimizer = null;
const getOptimizer = () => (optimizer ??= new Optimizer());

// ---- import ------------------------------------------------------------------
/**
 * Imports one file or blob. Returns 'added' | 'skipped'. Throws on unreadable images.
 * meta: { scope, source, albumIds, remoteId, fingerprint, name, addedAt }
 */
export async function importOne(fileOrBlob, meta = {}) {
  const fingerprint = meta.fingerprint || fingerprintOf(fileOrBlob);
  if (library.hasFingerprint(fingerprint)) return 'skipped';
  const out = await getOptimizer().run(fileOrBlob);
  const id = crypto.randomUUID();
  const store = await saveBlobs(id, { full: out.full, thumb: out.thumb });
  await library.add({
    id,
    fingerprint,
    name: meta.name || fileOrBlob.name || 'Photo',
    width: out.width,
    height: out.height,
    bytes: out.full.size,
    addedAt: meta.addedAt || Date.now(),
    selected: true,
    broken: false,
    albumIds: meta.albumIds ? [...meta.albumIds] : [],
    scope: meta.scope || 'device',
    deviceId: meta.deviceId || library.deviceId,
    source: meta.source || 'upload',
    remoteId: meta.remoteId || null,
    store,
  });
  return 'added';
}

/** Imports many files with bounded concurrency and progress reporting. */
export async function importFiles(files, { scope, albumIds = [], source = 'upload', onProgress } = {}) {
  const list = [...files].filter(isImage);
  const result = { total: list.length, added: 0, skipped: 0, failed: 0, errors: [] };
  let done = 0;
  let cursor = 0;
  const concurrency = 3;

  async function worker() {
    while (cursor < list.length) {
      const file = list[cursor++];
      try {
        const r = await importOne(file, { scope, albumIds, source });
        result[r]++;
      } catch (err) {
        result.failed++;
        if (result.errors.length < 5) result.errors.push(`${file.name}: ${err.message}`);
      }
      done++;
      onProgress?.(done, list.length, result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return result;
}

// ---- folders (File System Access API) ------------------------------------
export async function getFolders() { return (await kv.get('folders')) || []; }

async function saveFolders(folders) { await kv.set('folders', folders); }

/** Must be called from a user gesture. */
export async function addFolder(opts) {
  const handle = await window.showDirectoryPicker({ id: 'home-display-photos', mode: 'read' });
  const folders = await getFolders();
  for (const f of folders) {
    if (await f.handle.isSameEntry(handle)) return scanFolder(f, opts);
  }
  const album = await library.findOrCreateAlbum(handle.name);
  const folder = { id: crypto.randomUUID(), name: handle.name, handle, albumId: album.id, lastScan: 0 };
  folders.push(folder);
  await saveFolders(folders);
  return scanFolder(folder, opts);
}

async function* walk(dir, depth = 0) {
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && IMAGE_RE.test(entry.name)) yield entry;
    else if (entry.kind === 'directory' && depth < 8 && !entry.name.startsWith('.')) yield* walk(entry, depth + 1);
  }
}

export async function folderPermission(folder) {
  try { return await folder.handle.queryPermission({ mode: 'read' }); } catch { return 'denied'; }
}

/** Imports only files not already in the library. Call from a user gesture if permission is 'prompt'. */
export async function scanFolder(folder, { scope, onProgress } = {}) {
  let perm = await folderPermission(folder);
  if (perm !== 'granted') perm = await folder.handle.requestPermission({ mode: 'read' });
  if (perm !== 'granted') throw new Error(`Access to “${folder.name}” was not allowed`);

  const fresh = [];
  for await (const entry of walk(folder.handle)) {
    const file = await entry.getFile();
    if (!library.hasFingerprint(fingerprintOf(file))) fresh.push(file);
  }
  const albumIds = folder.albumId && library.albums.has(folder.albumId) ? [folder.albumId] : [];
  const result = await importFiles(fresh, { scope, albumIds, source: `folder:${folder.id}`, onProgress });

  const folders = await getFolders();
  const f = folders.find((x) => x.id === folder.id);
  if (f) { f.lastScan = Date.now(); await saveFolders(folders); }
  return result;
}

export async function forgetFolder(id) {
  await saveFolders((await getFolders()).filter((f) => f.id !== id));
}
