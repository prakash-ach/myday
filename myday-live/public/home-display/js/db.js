// IndexedDB wrapper. Stores:
//   photos  – metadata only (fast to list thousands)
//   blobs   – image data when OPFS is unavailable
//   albums  – user albums
//   kv      – settings, runtime state, folder handles, sync cursor
const DB_NAME = 'home-display';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const photos = db.createObjectStore('photos', { keyPath: 'id' });
      photos.createIndex('fingerprint', 'fingerprint', { unique: false });
      photos.createIndex('remoteId', 'remoteId', { unique: false });
      db.createObjectStore('blobs', { keyPath: 'id' });
      db.createObjectStore('albums', { keyPath: 'id' });
      db.createObjectStore('kv');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; }; // browser may close it under storage pressure
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  }));
}

export const db = {
  get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
  all: (store) => run(store, 'readonly', (s) => s.getAll()),
  put: (store, value, key) =>
    run(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key))),
  putMany: (store, values) =>
    run(store, 'readwrite', (s) => { for (const v of values) s.put(v); }),
  delete: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
  deleteMany: (store, keys) =>
    run(store, 'readwrite', (s) => { for (const k of keys) s.delete(k); }),
};

export const kv = {
  get: (key) => db.get('kv', key),
  set: (key, value) => db.put('kv', value, key),
};
