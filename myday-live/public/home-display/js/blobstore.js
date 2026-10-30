// Image data storage. Prefers the Origin Private File System (fast, large,
// outside the IndexedDB quota bookkeeping); falls back to IndexedDB where OPFS
// writable streams are unavailable (e.g. older Safari). Each photo records
// which backend holds its data, so a library can mix both safely.
import { db } from './db.js';

const OPFS_OK = typeof navigator.storage?.getDirectory === 'function';
let dirPromise = null;

function photoDir() {
  if (!dirPromise) {
    dirPromise = navigator.storage.getDirectory()
      .then((root) => root.getDirectoryHandle('photos', { create: true }))
      .catch((e) => { dirPromise = null; throw e; });
  }
  return dirPromise;
}

const fileName = (id, kind) => `${id}.${kind === 'thumb' ? 't' : 'f'}.jpg`;

async function writeFile(dir, name, blob) {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable(); // throws where unsupported
  try { await writable.write(blob); } finally { await writable.close(); }
}

/** Saves both renditions. Returns the backend used: 'opfs' | 'idb'. */
export async function saveBlobs(id, { full, thumb }) {
  if (OPFS_OK) {
    try {
      const dir = await photoDir();
      await writeFile(dir, fileName(id, 'full'), full);
      await writeFile(dir, fileName(id, 'thumb'), thumb);
      return 'opfs';
    } catch (err) {
      console.warn('[blobstore] OPFS write failed, using IndexedDB', err);
      await removeOpfs(id);
    }
  }
  await db.put('blobs', { id, full, thumb });
  return 'idb';
}

export async function loadBlob(photo, kind = 'full') {
  if (photo.store === 'opfs') {
    const dir = await photoDir();
    const handle = await dir.getFileHandle(fileName(photo.id, kind));
    return handle.getFile();
  }
  const rec = await db.get('blobs', photo.id);
  if (!rec?.[kind]) throw new Error(`Image data missing for ${photo.name}`);
  return rec[kind];
}

async function removeOpfs(id) {
  try {
    const dir = await photoDir();
    await dir.removeEntry(fileName(id, 'full')).catch(() => {});
    await dir.removeEntry(fileName(id, 'thumb')).catch(() => {});
  } catch { /* nothing stored */ }
}

export async function deleteBlobs(photo) {
  if (photo.store === 'opfs') await removeOpfs(photo.id);
  else await db.delete('blobs', photo.id);
}
