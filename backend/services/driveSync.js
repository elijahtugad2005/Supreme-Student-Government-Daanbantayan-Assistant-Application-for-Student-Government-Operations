// services/driveSync.js
// PURPOSE: Mirror GridFS document binaries to Google Drive ("Synced Storage").
//
// MongoDB GridFS stays the primary store: the AI summary pipeline reads and
// writes there. Drive is a best-effort mirror so officers can browse, preview,
// and back up the archive in Google Drive. A Drive failure never fails an upload.
//
// Two auth modes, read at runtime from env vars (names only, never hardcoded):
//
//  A) OAuth refresh token (use when org policy blocks service-account keys)
//       GOOGLE_DRIVE_OAUTH_CLIENT_ID
//       GOOGLE_DRIVE_OAUTH_CLIENT_SECRET
//       GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN   (from scripts/drive-oauth-token.js)
//     Scope is drive.file: the app only sees files/folders it created.
//     If GOOGLE_DRIVE_FOLDER_ID is unset, an "SSG Document Archive" folder is
//     created once in that account's Drive and reused.
//
//  B) Service account (only if your org allows key creation)
//       GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON or GOOGLE_DRIVE_KEY_FILE
//       GOOGLE_DRIVE_FOLDER_ID            (Shared Drive folder, required)

const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');

const DEFAULT_FOLDER_NAME = process.env.GOOGLE_DRIVE_FOLDER_NAME || 'SSG Document Archive';
const SUBFOLDER_NAME = process.env.GOOGLE_DRIVE_SUBFOLDER_NAME || 'Documents';
const RECEIPTS_SUBFOLDER_NAME = process.env.GOOGLE_DRIVE_RECEIPTS_SUBFOLDER_NAME || 'Receipts';

let driveClient = null;
let resolvedFolderId = null;
let resolvedDocumentsSubfolderId = null;
const resolvedSubfoldersByName = new Map();

/**
 * Sanitizes a folder or file name for safe interpolation in Drive v3 query strings.
 * Strips quotes, backslashes, and control characters to prevent query injection.
 */
function sanitizeDriveQueryName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/['"\\]/g, '').replace(/[\r\n\t]/g, ' ').trim();
}

function resolveKeyFilePath(filePath) {
  if (!filePath) return null;
  // If already absolute and exists
  if (path.isAbsolute(filePath) && fs.existsSync(filePath)) {
    return filePath;
  }

  // Windows path starting with a leading slash/backslash like '\importantfiles\...'
  // needs to be stripped so it doesn't resolve to C:\importantfiles
  const cleaned = filePath.replace(/^[/\\]+/, '');

  // 1. Check relative to project root
  const fromProjectRoot = path.resolve(__dirname, '..', '..', cleaned);
  if (fs.existsSync(fromProjectRoot)) return fromProjectRoot;

  // 2. Check relative to backend directory
  const fromBackendDir = path.resolve(__dirname, '..', cleaned);
  if (fs.existsSync(fromBackendDir)) return fromBackendDir;

  // 3. Check relative to process.cwd()
  const fromCwd = path.resolve(process.cwd(), cleaned);
  if (fs.existsSync(fromCwd)) return fromCwd;

  return filePath;
}

function authMode() {
  if (
    process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN
  ) {
    return 'oauth';
  }
  if (
    (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_DRIVE_KEY_FILE) &&
    process.env.GOOGLE_DRIVE_FOLDER_ID
  ) {
    return 'service_account';
  }
  return null;
}

function isEnabled() {
  return authMode() !== null;
}

function getDrive() {
  if (driveClient) return driveClient;
  const mode = authMode();
  if (!mode) throw new Error('Google Drive sync is not configured');

  const { google } = require('googleapis');
  let auth;
  if (mode === 'oauth') {
    auth = new google.auth.OAuth2(
      process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN });
  } else {
    const opts = { scopes: ['https://www.googleapis.com/auth/drive'] };
    if (process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON) {
      opts.credentials = JSON.parse(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON);
    } else {
      opts.keyFile = resolveKeyFilePath(process.env.GOOGLE_DRIVE_KEY_FILE);
    }
    auth = new google.auth.GoogleAuth(opts);
  }

  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

/** Configured parent folder id, or find/create the app-owned archive folder. */
async function getRootFolderId() {
  if (process.env.GOOGLE_DRIVE_FOLDER_ID) return process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (resolvedFolderId) return resolvedFolderId;

  const drive = getDrive();
  const safeName = sanitizeDriveQueryName(DEFAULT_FOLDER_NAME);
  const { data } = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${safeName}' and trashed=false`,
    fields: 'files(id)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  if (data.files?.length) {
    resolvedFolderId = data.files[0].id;
  } else {
    const created = await drive.files.create({
      requestBody: { name: DEFAULT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id',
      supportsAllDrives: true,
    });
    resolvedFolderId = created.data.id;
    console.log(`[DriveSync] Created root folder "${DEFAULT_FOLDER_NAME}" (${resolvedFolderId})`);
  }
  return resolvedFolderId;
}

/**
 * Gets or creates a named subfolder (e.g., 'Documents' or 'Receipts') inside the root Drive folder.
 */
async function getNamedSubfolderId(targetName = SUBFOLDER_NAME) {
  const cleanTarget = sanitizeDriveQueryName(targetName) || SUBFOLDER_NAME;
  const cacheKey = cleanTarget.toLowerCase();
  if (cacheKey === SUBFOLDER_NAME.toLowerCase() && resolvedDocumentsSubfolderId) {
    return resolvedDocumentsSubfolderId;
  }
  if (resolvedSubfoldersByName.has(cacheKey)) {
    return resolvedSubfoldersByName.get(cacheKey);
  }

  const drive = getDrive();
  let parentId = await getRootFolderId();

  try {
    const parentMeta = await drive.files.get({
      fileId: parentId,
      fields: 'id, name, mimeType, parents',
      supportsAllDrives: true,
    });
    const parentNameLower = (parentMeta.data?.name || '').toLowerCase();
    if (parentNameLower === cacheKey) {
      resolvedSubfoldersByName.set(cacheKey, parentId);
      if (cacheKey === SUBFOLDER_NAME.toLowerCase()) resolvedDocumentsSubfolderId = parentId;
      return parentId;
    }
    // If GOOGLE_DRIVE_FOLDER_ID points directly to 'Documents' and we want 'Receipts',
    // try placing 'Receipts' inside the same parent directory if accessible, else inside parentId.
    if (
      parentNameLower === SUBFOLDER_NAME.toLowerCase() &&
      cacheKey !== SUBFOLDER_NAME.toLowerCase() &&
      Array.isArray(parentMeta.data?.parents) &&
      parentMeta.data.parents.length > 0
    ) {
      parentId = parentMeta.data.parents[0];
    }
  } catch (_) {}

  const { data } = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${cleanTarget}' and '${parentId}' in parents and trashed=false`,
    fields: 'files(id, name)',
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (data.files && data.files.length > 0) {
    const foundId = data.files[0].id;
    resolvedSubfoldersByName.set(cacheKey, foundId);
    if (cacheKey === SUBFOLDER_NAME.toLowerCase()) resolvedDocumentsSubfolderId = foundId;
    return foundId;
  }

  const created = await drive.files.create({
    requestBody: {
      name: cleanTarget,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id, name',
    supportsAllDrives: true,
  });

  const createdId = created.data.id;
  resolvedSubfoldersByName.set(cacheKey, createdId);
  if (cacheKey === SUBFOLDER_NAME.toLowerCase()) resolvedDocumentsSubfolderId = createdId;
  console.log(`[DriveSync] Created subfolder "${cleanTarget}" (${createdId}) inside folder (${parentId})`);
  return createdId;
}

/**
 * Gets or creates the dedicated 'Documents' subfolder inside the root Drive folder.
 */
async function getDocumentsSubfolderId() {
  return getNamedSubfolderId(SUBFOLDER_NAME);
}

/**
 * Gets or creates the dedicated 'Receipts' subfolder inside the Google Drive archive.
 */
async function getReceiptsSubfolderId() {
  return getNamedSubfolderId(RECEIPTS_SUBFOLDER_NAME);
}

/**
 * Upload a copy of a file to the Documents (or Receipts) subfolder in Google Drive.
 * @returns {Promise<{driveFileId: string, webViewLink: string|null, folderName: string}>}
 */
async function mirrorUpload(buffer, filename, mimeType, appProperties = {}) {
  const drive = getDrive();
  const isReceipt =
    String(appProperties?.folder || '').toLowerCase() === 'receipts' ||
    String(appProperties?.documentType || '').toLowerCase() === 'receipt';
  const folderName = isReceipt ? RECEIPTS_SUBFOLDER_NAME : SUBFOLDER_NAME;
  const targetFolderId = isReceipt
    ? await getReceiptsSubfolderId()
    : await getDocumentsSubfolderId();
  const { data } = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [targetFolderId],
      // appProperties values must be strings; used to trace back to GridFS.
      appProperties: Object.fromEntries(
        Object.entries(appProperties)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)])
      ),
    },
    media: { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buffer) },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });
  return { driveFileId: data.id, webViewLink: data.webViewLink || null, folderName };
}

/** Remove a mirrored file. Missing files are treated as already deleted. */
async function deleteMirror(driveFileId) {
  if (!driveFileId) return;
  try {
    await getDrive().files.delete({ fileId: driveFileId, supportsAllDrives: true });
  } catch (err) {
    if (err?.code === 404) return;
    throw err;
  }
}

/**
 * Build canonical Google Drive folder URL from a folder ID.
 */
function buildFolderUrl(folderId) {
  if (!folderId || typeof folderId !== 'string') return null;
  const trimmed = folderId.trim();
  if (!trimmed) return null;
  return `https://drive.google.com/drive/folders/${encodeURIComponent(trimmed)}`;
}

/**
 * Resolve Google Drive folder links for the Documents and/or Receipts subfolders.
 * Never throws; returns enabled:false when Drive mirroring is not configured.
 * @param {'all'|'documents'|'receipts'} [scope='all']
 */
async function getFolderLinks(scope = 'all') {
  if (!isEnabled()) {
    return { enabled: false, documentsFolder: null, receiptsFolder: null };
  }

  const normalized = String(scope || 'all').toLowerCase();
  const wantDocs = normalized === 'all' || normalized === 'documents';
  const wantReceipts = normalized === 'all' || normalized === 'receipts';

  let documentsFolder = null;
  let receiptsFolder = null;

  if (wantDocs) {
    try {
      const id = await getDocumentsSubfolderId();
      if (id) {
        documentsFolder = { id, name: SUBFOLDER_NAME, url: buildFolderUrl(id) };
      }
    } catch (err) {
      console.warn('[DriveSync] getFolderLinks(documents) failed:', err.message);
    }
  }

  if (wantReceipts) {
    try {
      const id = await getReceiptsSubfolderId();
      if (id) {
        receiptsFolder = { id, name: RECEIPTS_SUBFOLDER_NAME, url: buildFolderUrl(id) };
      }
    } catch (err) {
      console.warn('[DriveSync] getFolderLinks(receipts) failed:', err.message);
    }
  }

  return { enabled: true, documentsFolder, receiptsFolder };
}

module.exports = {
  isEnabled,
  authMode,
  mirrorUpload,
  deleteMirror,
  resolveKeyFilePath,
  sanitizeDriveQueryName,
  getDocumentsSubfolderId,
  getReceiptsSubfolderId,
  getNamedSubfolderId,
  buildFolderUrl,
  getFolderLinks,
};
