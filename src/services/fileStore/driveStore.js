// services/fileStore/driveStore.js
// PURPOSE: Client side of "Synced Storage" (Google Drive mirror).
//
// NOT a primary store. MongoDB GridFS (mongoStore) still owns the bytes and
// feeds the AI summary pipeline. The backend mirrors every GridFS upload to a
// Google Drive folder; this module only reads mirror state and asks the backend
// to retry. No Google credentials ever reach the browser.

import { auth } from '../../firebase/firebaseConfig';

const BACKEND_URL = import.meta.env.VITE_MONGODB_BACKEND_URL || 'http://localhost:3000';

export const DRIVE_SYNC_STATUS = {
  SYNCED: 'synced',
  PENDING: 'pending',
  FAILED: 'failed',
  DISABLED: 'disabled',
  UNKNOWN: 'unknown',
};

const authHeaders = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error('User must be signed in');
  return { Authorization: `Bearer ${await user.getIdToken()}` };
};

export const driveStore = {
  name: 'drive',

  /** Is Drive mirroring configured on the backend? */
  async isEnabled() {
    try {
      const res = await fetch(`${BACKEND_URL}/api/documents/drive/status`, { headers: await authHeaders() });
      if (!res.ok) return false;
      const body = await res.json();
      return Boolean(body.data?.enabled);
    } catch {
      return false;
    }
  },

  /**
   * Mirror state for one GridFS file.
   * @param {string} mongoFileId
   * @returns {Promise<{status: string, driveFileId: string|null, webViewLink: string|null, error: string|null}>}
   */
  async getSyncState(mongoFileId) {
    const empty = { status: DRIVE_SYNC_STATUS.UNKNOWN, driveFileId: null, webViewLink: null, error: null };
    if (!mongoFileId) return empty;
    try {
      const res = await fetch(`${BACKEND_URL}/api/documents/${mongoFileId}/metadata`, { headers: await authHeaders() });
      if (!res.ok) return empty;
      const { data = {} } = await res.json();
      return {
        status: data.driveSyncStatus || (data.driveFileId ? DRIVE_SYNC_STATUS.SYNCED : DRIVE_SYNC_STATUS.UNKNOWN),
        driveFileId: data.driveFileId || null,
        webViewLink: data.driveWebViewLink || null,
        error: data.driveSyncError || null,
      };
    } catch {
      return empty;
    }
  },

  /** Open-in-Drive link, or null if not mirrored yet. */
  async getUrl(mongoFileId) {
    return (await this.getSyncState(mongoFileId)).webViewLink;
  },

  /** Ask the backend to (re)mirror a GridFS file to Drive. */
  async resync(mongoFileId) {
    const res = await fetch(`${BACKEND_URL}/api/documents/${mongoFileId}/drive-sync`, {
      method: 'POST',
      headers: await authHeaders(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.data?.error || body.message || 'Drive sync failed');
    return body.data;
  },
};

