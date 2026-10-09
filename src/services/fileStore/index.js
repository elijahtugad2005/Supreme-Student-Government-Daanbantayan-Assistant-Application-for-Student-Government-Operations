// services/fileStore/index.js
// PURPOSE: Choose where document binaries live.
//
// Firestore always holds the metadata. Only the bytes move between the three
// implementations here, so switching is one env var and no other file changes.
//
//   VITE_FILE_STORE=local     IndexedDB on this device (default)
//   VITE_FILE_STORE=firebase  Cloud Storage
//   VITE_FILE_STORE=mongodb   MongoDB GridFS via Express backend (Session 3)
//
// ALL implementations implement: put, get, getUrl, exists, delete, list, usage,
// revokeAll.

import { firebaseStore } from './firebaseStore.js';
import { localStore } from './localStore.js';
import { mongoStore } from './mongoStore.js';

export const STORES = {
  local: localStore,
  firebase: firebaseStore,
  mongodb: mongoStore,
};

const requested = (import.meta.env?.VITE_FILE_STORE || 'local').toLowerCase();

/** The active store. Falls back to local if an unknown name is configured. */
export const fileStore = STORES[requested] || localStore;

export const isLocalMode = fileStore === localStore;
export const isMongoMode = fileStore === mongoStore;

/**
 * A warning shown in the UI.
 *
 * Local files are invisible to other users and are erased by clearing site
 * data, so nobody should mistake them for the archive.
 */
export const storageWarning =
  isLocalMode
    ? 'Files are saved on this device only, until Cloud Storage is enabled. Clearing this ' +
      "browser's site data will delete them, and other devices cannot see them."
    : fileStore.name === 'mongodb'
    ? 'Files are stored in MongoDB GridFS via backend server. Ensure backend is running for uploads/downloads.'
    : null;

export { localStore, firebaseStore, mongoStore };
