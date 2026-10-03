// services/fileStore/firebaseStore.js
// PURPOSE: Cloud Storage implementation, used once a bucket exists.
//
// Kept behind the same interface as localStore so switching is a config change
// and nothing above this layer has to know where the bytes live.

import {
  deleteObject,
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from 'firebase/storage';
import { storage } from '../../firebase/firebaseConfig';

export const firebaseStore = {
  name: 'firebase',

  async put(path, file, onProgress) {
    const task = uploadBytesResumable(storageRef(storage, path), file, {
      contentType: file.type || 'application/octet-stream',
      customMetadata: { uploadedAt: String(Date.now()) },
    });

    await new Promise((resolve, reject) => {
      task.on(
        'state_changed',
        (snapshot) => {
          if (snapshot.totalBytes) {
            const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            onProgress?.(Math.min(pct, 99));
          }
        },
        reject,
        resolve
      );
    });

    onProgress?.(100);
    return { path };
  },

  /**
   * Download URLs are fetched on demand, never cached: the token behind them is
   * short-lived, so a stored URL would silently expire.
   */
  async getUrl(path) {
    try {
      return await getDownloadURL(storageRef(storage, path));
    } catch {
      return null;
    }
  },

  async get() {
    // Not needed by callers; bytes are only ever served as a URL.
    return null;
  },

  async exists(path) {
    try {
      await getDownloadURL(storageRef(storage, path));
      return true;
    } catch {
      return false;
    }
  },

  async delete(path) {
    await deleteObject(storageRef(storage, path));
  },

  async list() {
    return [];
  },

  async usage() {
    return { usedBytes: null, quotaBytes: null, count: null };
  },

  revokeAll() {
    // Object URLs are never created here, so nothing to release.
  },
};