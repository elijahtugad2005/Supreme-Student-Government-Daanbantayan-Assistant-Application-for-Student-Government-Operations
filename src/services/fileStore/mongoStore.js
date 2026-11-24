// services/fileStore/mongoStore.js
// PURPOSE: MongoDB GridFS storage implementation via backend API.
//
// Communicates with the Express backend API for document storage in MongoDB GridFS.
// Follows the same interface as localStore and firebaseStore for seamless switching.
//
// Authentication: Uses Firebase Auth ID tokens for all API requests
// Storage: MongoDB GridFS via backend (cost-optimized alternative to Firebase Storage)

import { auth } from '../../firebase/firebaseConfig';

const BACKEND_URL = import.meta.env.VITE_MONGODB_BACKEND_URL || 'http://localhost:3000';

/**
 * Get current user's Firebase ID token for Authorization header
 */
const getAuthToken = async () => {
  const user = auth.currentUser;
  if (!user) throw new Error('User must be signed in to upload documents');
  return await user.getIdToken();
};

/**
 * MongoDB GridFS file store - communicates with Express backend
 */
export const mongoStore = {
  name: 'mongodb',
  _urls: new Map(),

  /**
   * Upload file to MongoDB GridFS via backend API
   * @param {string} path - Legacy param (ignored, kept for interface compatibility)
   * @param {File} file - The file to upload
   * @param {Function} onProgress - Progress callback (0-100)
   * @returns {Promise<{fileId: string}>} MongoDB ObjectId
   */
  async put(path, file, onProgress) {
    const token = await getAuthToken();
    
    const formData = new FormData();
    formData.append('file', file);
    if (path) {
      formData.append('documentId', path);
    }
    if (file?.name) {
      formData.append('title', file.name);
    }
    
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      // Track upload progress
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          onProgress?.(Math.min(percentComplete, 99));
        }
      });
      
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100);
          try {
            const response = JSON.parse(xhr.responseText);
            const fileId = response.data?.fileId || response.fileId;
            if (!fileId) throw new Error('No fileId in server response');
            resolve({ fileId });
          } catch (error) {
            reject(new Error(error.message || 'Invalid response from server'));
          }
        } else {
          try {
            const error = JSON.parse(xhr.responseText);
            reject(new Error(error.error || 'Upload failed'));
          } catch {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      });
      
      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload. Check if backend is running.'));
      });
      
      xhr.addEventListener('abort', () => {
        reject(new Error('Upload cancelled'));
      });
      
      xhr.open('POST', `${BACKEND_URL}/api/documents/upload`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  },

  /**
   * Fetch an authenticated document binary via Authorization: Bearer header and
   * return a same-origin blob: Object URL for safe inline preview or download.
   * Never embeds Firebase ID tokens in URL query strings.
   *
   * @param {string} fileId - MongoDB ObjectId
   * @param {object} [options]
   * @param {'inline'|'attachment'} [options.disposition]
   * @param {boolean} [options.fresh] - Revoke any cached Object URL and re-fetch
   * @returns {Promise<string|null>} Same-origin blob: Object URL
   */
  async getUrl(fileId, options = {}) {
    if (!fileId) return null;

    if (options.fresh && this._urls.has(fileId)) {
      URL.revokeObjectURL(this._urls.get(fileId));
      this._urls.delete(fileId);
    }

    if (!options.fresh && this._urls.has(fileId)) {
      return this._urls.get(fileId);
    }

    try {
      const blob = await this.get(fileId, options);
      if (!blob) return null;
      const objectUrl = URL.createObjectURL(blob);
      this._urls.set(fileId, objectUrl);
      return objectUrl;
    } catch (error) {
      console.error('MongoDB getUrl error:', error);
      return null;
    }
  },

  /**
   * Download file as Blob using Authorization: Bearer header (no token in URL).
   * @param {string} fileId - MongoDB ObjectId
   * @param {object} [options]
   * @returns {Promise<Blob|null>}
   */
  async get(fileId, options = {}) {
    if (!fileId) return null;

    try {
      const token = await getAuthToken();
      const disposition =
        options.disposition === 'attachment' || options.download ? 'attachment' : 'inline';
      const url = `${BACKEND_URL}/api/documents/${encodeURIComponent(fileId)}/download?disposition=${disposition}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) return null;
      const blob = await response.blob();
      const contentType = response.headers?.get?.('content-type');
      if (contentType && !blob.type) {
        return new Blob([blob], { type: contentType.split(';')[0].trim() });
      }
      return blob;
    } catch (error) {
      console.error('MongoDB get error:', error);
      return null;
    }
  },

  /**
   * Check if file exists in MongoDB
   * @param {string} fileId - MongoDB ObjectId
   * @returns {Promise<boolean>}
   */
  async exists(fileId) {
    if (!fileId) return false;

    try {
      const token = await getAuthToken();
      const response = await fetch(
        `${BACKEND_URL}/api/documents/${encodeURIComponent(fileId)}/metadata`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      return response.ok;
    } catch {
      return false;
    }
  },

  /**
   * Delete file from MongoDB GridFS and revoke any cached Object URL.
   * @param {string} fileId - MongoDB ObjectId
   */
  async delete(fileId) {
    if (!fileId) return;

    const token = await getAuthToken();
    const response = await fetch(`${BACKEND_URL}/api/documents/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Delete failed' }));
      throw new Error(error.error || 'Delete failed');
    }

    if (this._urls.has(fileId)) {
      URL.revokeObjectURL(this._urls.get(fileId));
      this._urls.delete(fileId);
    }
  },

  /**
   * List files - not implemented for MongoDB
   * Firestore holds the document index
   */
  async list() {
    return [];
  },

  /**
   * Storage usage - not tracked client-side for MongoDB
   */
  async usage() {
    return { usedBytes: null, quotaBytes: null, count: null };
  },

  /**
   * Revoke all cached blob: Object URLs created by getUrl().
   */
  revokeAll() {
    for (const url of this._urls.values()) {
      URL.revokeObjectURL(url);
    }
    this._urls.clear();
  }
};
