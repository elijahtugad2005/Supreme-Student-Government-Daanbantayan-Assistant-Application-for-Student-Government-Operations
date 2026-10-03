// services/fileStore/index.js
// PURPOSE: Choose where document binaries live.
//
// Firestore always holds the metadata. Only the bytes move between the two
// implementations here, so switching is one env var and no other file changes.
//
//   VITE_FILE_STORE=local     IndexedDB on this device (default)
//   VITE_FILE_STORE=firebase Cloud Storage
//
// BOTH implementations implement: put, get, getUrl, exists, delete, list, usage,
// revokeAll.

import { firebaseStore } from './firebaseStore.js';
import { localStore } from './localStore.js';

export const STORES = { local: localStore, firebase: firebaseStore };

const requested = (import.meta.env?.VITE_FILE_STORE || 'local').toLowerCase();

/** The active store. Falls back to local if an unknown name is configured. */
export const fileStore = STORES[requested] || localStore;

export const isLocalMode = fileStore === localStore;

/**
 * A warning shown in the UI. Local files are invisible to other users and are
 * erased by clearing site data, so nobody should mistake them for the archive.
 */
export const storageWarning =
  isLocalMode
    ? 'Files are saved on this device only, until Cloud Storage is enabled. Clearing this ' +
      "browser's site data will delete them, and other devices cannot see them."
    : null;

export { localStore, firebaseStore };
