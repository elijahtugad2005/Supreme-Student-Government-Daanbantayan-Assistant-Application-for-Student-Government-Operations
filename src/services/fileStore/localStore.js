// services/fileStore/localStore.js
// PURPOSE: Browser-local file storage, used until Cloud Storage is enabled.
//
// WHY INDEXEDDB, NOT localStorage
//   localStorage holds strings only, caps at roughly 5MB, and blocks the main
//   thread. Two scanned PDFs would fill it. IndexedDB stores real Blobs, is
//   asynchronous, and comfortably holds files of the size this app accepts.
//
// WHAT THIS IS NOT
//   This is per-device. It is not shared between browsers, not backed up, and
//   is erased by "clear site data". It is a development and demo store — the
//   authoritative record stays in Firestore, which is unchanged.

const DB_NAME = 'ssg-document-files';
const DB_VERSION = 1;
const STORE = 'files';

let dbPromise = null;

const openDb = () => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so local file storage is unavailable.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      // Keyed by the same storagePath Firestore already holds, so a document
      // record and its file stay addressed by one value.
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'path' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
};

const tx = async (mode, run) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let request;
    try {
      request = run(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      // An IDBRequest carries its value on `.result`. Anything else (put,
      // delete) resolves as-is.
      //
      // `result?.result ?? result` must NOT be used here: a missing key makes
      // `.result` undefined, and `??` would then fall back to the request
      // object itself — making every lookup look present.
      const isRequest = request && typeof request === 'object' && 'result' in request;
      resolve(isRequest ? request.result : request);
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
};

/**
 * Read a File with genuine progress.
 *
 * IndexedDB's write is a single atomic put and reports nothing, so progress is
 * measured while reading the file off disk. That is real work, so the number
 * means something rather than jumping 0 to 100.
 *
 * Uses Blob.stream() rather than FileReader: streams give per-chunk progress,
 * work in web workers, and are available outside a browser, which keeps this
 * module testable.
 */
const readWithProgress = async (file, onProgress) => {
  const total = file.size || 0;

  if (typeof file.stream === 'function') {
    const reader = file.stream().getReader();
    const chunks = [];
    let read = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      read += value.length;
      if (total) onProgress?.(Math.min(Math.round((read / total) * 99), 99));
    }
    return new Blob(chunks).arrayBuffer();
  }

  const buffer = await file.arrayBuffer();
  onProgress?.(99);
  return buffer;
};

export const localStore = {
  name: 'local',

  async put(path, file, onProgress) {
    const buffer = await readWithProgress(file, onProgress);
    await tx('readwrite', (store) =>
      store.put({
        path,
        // Rebuild a Blob so non-Blob inputs (an ArrayBuffer) stay valid.
        blob: file instanceof Blob ? file : new Blob([buffer], { type: file.type }),
        name: file.name,
        type: file.type,
        size: file.size,
        savedAt: Date.now(),
      })
    );
    onProgress?.(100);
    return { path };
  },

  async get(path) {
    const record = await tx('readonly', (store) => store.get(path));
    return record?.blob ?? null;
  },

  /**
   * Object URL for preview and download. The caller owns revoking it; URLs are
   * cached per path and reused so repeated previews do not leak a blob per render.
   */
  async getUrl(path) {
    const blob = await this.get(path);
    if (!blob) return null;
    if (!localStore._urls) localStore._urls = new Map();
    const existing = localStore._urls.get(path);
    if (existing) return existing;
    const url = URL.createObjectURL(blob);
    localStore._urls.set(path, url);
    return url;
  },

  async exists(path) {
    const record = await tx('readonly', (store) => store.get(path));
    return Boolean(record);
  },

  async delete(path) {
    await tx('readwrite', (store) => store.delete(path));
    localStore._urls?.delete(path);
  },

  /** Files currently held, for the "local files" indicator. */
  async list() {
    const records = await tx('readonly', (store) => store.getAll());
    return records.map((r) => ({ path: r.path, name: r.name, size: r.size, savedAt: r.savedAt }));
  },

  /** Approximate bytes used, and the browser's quota if it will tell us. */
  async usage() {
    const records = await this.list();
    const usedBytes = records.reduce((sum, r) => sum + (r.size || 0), 0);
    let quotaBytes = null;
    try {
      if (navigator.storage?.estimate) {
        quotaBytes = (await navigator.storage.estimate()).quota ?? null;
      }
    } catch {
      /* not available in every browser */
    }
    return { usedBytes, quotaBytes, count: records.length };
  },

  /** Release cached object URLs. Call when the document list unmounts. */
  revokeAll() {
    localStore._urls?.forEach((url) => URL.revokeObjectURL(url));
    localStore._urls = new Map();
  },
};