const express = require('express');
const router = express.Router();
const {
  authenticate,
  requireAccess,
  DOCUMENT_ARCHIVE_ROLES,
  DOCUMENT_UPLOAD_ROLES,
  DOCUMENT_DELETE_ROLES,
  DOCUMENT_ARCHIVE_OVERRIDES,
  DOCUMENT_DELETE_OVERRIDES,
} = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');
const {
  uploadFileToGridFS,
  getDownloadStream,
  getFileMetadata,
  deleteFileFromGridFS,
  listFiles,
  downloadFileFromGridFS,
} = require('../utils/gridfs');
const driveSync = require('../services/driveSync');

const { sanitizeErrorResponse } = require('../utils/errorSanitizer');

/**
 * Normalize the receipt origin label so officers browsing Google Drive Receipts
 * can immediately identify whether a receipt came from Finance, Inventory, or Consumables.
 */
function normalizeReceiptOrigin(origin = '') {
  const raw = String(origin || '').trim();
  if (!raw) return '';
  if (/finance/i.test(raw)) return 'Finance';
  if (/consumable|food/i.test(raw)) return 'Inventory - Consumables';
  if (/inventory/i.test(raw)) return 'Inventory';
  return raw.replace(/[\\/:*?"<>|\r\n[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 32);
}

/**
 * Format receipt filename as "[<Origin>] <ITEM NAME> - Receipts.<ext>" (or
 * "<ITEM NAME> - Receipts.<ext>" when no origin is supplied) while preserving
 * the original file extension and stripping illegal filename characters.
 */
function formatReceiptDriveFilename(title, originalName = 'receipt.jpg', origin = '') {
  const safeOriginal = String(originalName || 'receipt.jpg').trim();
  const dotIdx = safeOriginal.lastIndexOf('.');
  const ext = dotIdx > 0 ? safeOriginal.slice(dotIdx) : '';
  const origStem = dotIdx > 0 ? safeOriginal.slice(0, dotIdx) : safeOriginal;

  let base = String(title || '').trim();
  // Strip any existing origin prefix like "[Finance] " or "[Inventory - Consumables] "
  base = base.replace(/^\[[^\]]+\]\s*/i, '').trim();
  // Strip legacy "Receipt - " or "Receipt_" prefixes if present
  base = base.replace(/^receipts?\s*[-_:]\s*/i, '').trim();
  // Strip existing trailing "- Receipts" / "- Receipt" to prevent duplication
  base = base.replace(/\s*-\s*receipts?$/i, '').trim();
  // Remove extension if title accidentally included it
  if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) {
    base = base.slice(0, -ext.length).trim();
  }
  // Sanitize path-unsafe characters
  base = base.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) {
    base = origStem.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Item';
  }
  const tag = normalizeReceiptOrigin(origin);
  const prefix = tag ? `[${tag}] ` : '';
  return `${prefix}${base.slice(0, 100)} - Receipts${ext}`;
}

/**
 * Record Drive mirror state on the GridFS file so the UI can show
 * synced / failed / disabled without a separate collection.
 */
async function setDriveState(fileId, state) {
  try {
    const { ObjectId } = require('mongodb');
    const { getDatabase } = require('../services/mongodb');
    const db = await getDatabase();
    const bucketName = process.env.MONGODB_BUCKET_NAME || 'documents';
    const set = {};
    for (const [k, v] of Object.entries(state)) set[`metadata.${k}`] = v;
    await db.collection(`${bucketName}.files`).updateOne({ _id: new ObjectId(fileId) }, { $set: set });
  } catch (err) {
    console.warn(`[DriveSync] setDriveState failed for ${fileId}:`, err.message);
  }
}

/**
 * Mirror one GridFS file to Drive. Never throws: Drive is a secondary copy and
 * must not break the primary (Mongo) path used by AI summaries.
 */
async function syncToDrive(fileId, buffer, filename, mimeType, meta = {}) {
  if (!driveSync.isEnabled()) {
    await setDriveState(fileId, { driveSyncStatus: 'disabled' }).catch(() => { });
    return { status: 'disabled' };
  }
  try {
    const { driveFileId, webViewLink, folderName } = await driveSync.mirrorUpload(buffer, filename, mimeType, {
      mongoFileId: fileId,
      documentId: meta.documentId,
      folder: meta.folder || '',
      documentType: meta.documentType || '',
    });
    await setDriveState(fileId, {
      driveSyncStatus: 'synced',
      driveFileId,
      driveWebViewLink: webViewLink,
      driveFolderName: folderName || 'Documents',
      driveSyncedAt: new Date(),
      driveSyncError: null,
    });
    console.log(`[DriveSync] Mirrored ${fileId} -> ${driveFileId} (${folderName || 'Documents'})`);
    return { status: 'synced', driveFileId, webViewLink, folderName: folderName || 'Documents' };
  } catch (err) {
    console.warn(`[DriveSync] Failed for ${fileId}:`, err.message);
    await setDriveState(fileId, { driveSyncStatus: 'failed', driveSyncError: err.message }).catch(() => { });
    return { status: 'failed', error: err.message };
  }
}

/**
 * GET /api/documents
 * Index endpoint describing available sub-routes.
 */
router.get('/', (req, res) => {
  res.status(200).json({
    message: 'Document Repository & Storage API',
    endpoints: {
      health: 'GET /api/documents/health',
      driveStatus: 'GET /api/documents/drive/status (requires auth + role)',
      driveFolders: 'GET /api/documents/drive/folders (requires auth + role)',
      driveSync: 'POST /api/documents/:fileId/drive-sync (requires auth + role)',
      list: 'GET /api/documents/list (requires auth + role)',
      upload: 'POST /api/documents/upload (requires auth + role)',
      download: 'GET /api/documents/:fileId/download (requires auth + role)',
      metadata: 'GET /api/documents/:fileId/metadata (requires auth + role)',
      delete: 'DELETE /api/documents/:fileId (requires auth + delete role)'
    }
  });
});

/**
 * GET /api/documents/drive/status
 * Whether Synced Storage (Google Drive) is configured on this server.
 */
  router.get('/drive/status', authenticate, requireAccess(DOCUMENT_UPLOAD_ROLES, DOCUMENT_ARCHIVE_OVERRIDES), (req, res) => {
    res.status(200).json({ success: true, data: { enabled: driveSync.isEnabled() } });
  });

  /**
   * GET /api/documents/drive/folders
   * Return officer-accessible Google Drive folder URLs for Documents and/or Receipts.
   * Accepts optional ?folder=documents|receipts|all.
   */
    router.get('/drive/folders', authenticate, requireAccess(DOCUMENT_UPLOAD_ROLES, DOCUMENT_ARCHIVE_OVERRIDES), async (req, res) => {
      try {
        const rawScope = String(req.query?.folder || 'all').toLowerCase();
        const scope = ['all', 'documents', 'receipts'].includes(rawScope) ? rawScope : 'all';
        const data = await driveSync.getFolderLinks(scope);
        res.status(200).json({ success: true, data });
      } catch (error) {
        console.error('[DriveSync] Folder link lookup failed:', error.message);
        res.status(500).json(sanitizeErrorResponse(error, 'Failed to resolve Google Drive folder links.'));
      }
    });

    /**
     * POST /api/documents/:fileId/drive-sync
     * Retry (or first-time) mirror of an existing GridFS file to Drive.
     */
      router.post('/:fileId/drive-sync', authenticate, requireAccess(DOCUMENT_UPLOAD_ROLES, DOCUMENT_ARCHIVE_OVERRIDES), async (req, res) => {
        try {
          const { fileId } = req.params;
          const metadata = await getFileMetadata(fileId);
          if (!metadata) return res.status(404).json({ success: false, error: 'File not found' });

          if (metadata.metadata?.driveFileId) {
            return res.status(200).json({
              success: true,
              data: {
                status: 'synced',
                driveFileId: metadata.metadata.driveFileId,
                webViewLink: metadata.metadata.driveWebViewLink || null,
              },
            });
          }

          const buffer = await downloadFileFromGridFS(fileId);
          const result = await syncToDrive(fileId, buffer, metadata.filename, metadata.metadata?.mimeType, {
            documentId: metadata.metadata?.documentId,
            folder: metadata.metadata?.folder || '',
            documentType: metadata.metadata?.documentType || '',
          });
          res.status(result.status === 'failed' ? 502 : 200).json({ success: result.status !== 'failed', data: result });
        } catch (error) {
          console.error('[DriveSync] Retry error:', error.message);
          res.status(500).json(sanitizeErrorResponse(error, 'Drive synchronization request failed.'));
        }
      });

      /**
       * GET /api/documents/health
       * No-auth health check so tests can verify MongoDB connectivity cheaply.
       */
      router.get('/health', async (req, res) => {
        try {
          const { getDatabase } = require('../services/mongodb');
          let totalFiles = null;
          let dbStatus = 'unknown';
          try {
            const db = await getDatabase();
            await db.admin().ping();
            dbStatus = 'connected';
            const bucketName = process.env.MONGODB_BUCKET_NAME || 'documents';
            totalFiles = await db.collection(`${bucketName}.files`).countDocuments();
          } catch (dbErr) {
            dbStatus = 'error: ' + dbErr.message;
          }
          const bucketName = process.env.MONGODB_BUCKET_NAME || 'documents';
          res.status(200).json({
            success: dbStatus === 'connected',
            message: dbStatus === 'connected' ? 'MongoDB GridFS is reachable' : 'MongoDB service temporarily degraded',
            database: process.env.MONGODB_DATABASE || 'ssg_documents',
            bucket: bucketName,
            totalFiles,
            timestamp: new Date().toISOString(),
            mongoStatus: dbStatus === 'connected' ? 'connected' : 'error',
          });
        } catch (error) {
          res.status(500).json(sanitizeErrorResponse(error, 'Health check service unavailable'));
        }
      });

      /**
       * GET /api/documents/list
       * List all files stored in GridFS with their metadata.
       * Used by admin/diagnostic tools to track which Firestore documents have
       * matching GridFS binaries.
       */
        router.get('/list', authenticate, requireAccess(DOCUMENT_UPLOAD_ROLES, DOCUMENT_ARCHIVE_OVERRIDES), async (req, res) => {
          try {
            const limitParam = parseInt(req.query.limit, 10) || 100;
            const search = req.query.search ? String(req.query.search).toLowerCase() : '';

            let files = await listFiles({}, Math.min(limitParam, 500));

            if (search) {
              files = files.filter((f) => {
                const name = (f.filename || '').toLowerCase();
                const docId = (f.metadata?.documentId || '').toLowerCase();
                const title = (f.metadata?.title || '').toLowerCase();
                return name.includes(search) || docId.includes(search) || title.includes(search);
              });
            }

            res.status(200).json({
              success: true,
              data: {
                total: files.length,
                files: files.map((f) => ({
                  fileId: f._id.toString(),
                  filename: f.filename,
                  size: f.length,
                  uploadDate: f.uploadDate,
                  documentId: f.metadata?.documentId || null,
                  title: f.metadata?.title || null,
                  uploadedBy: f.metadata?.uploadedByName || null,
                  mimeType: f.metadata?.mimeType || null,
                })),
              },
            });
          } catch (error) {
            console.error('[List] Error:', error);
            res.status(500).json({ success: false, error: 'List failed', message: error.message });
          }
        });

        /**
         * POST /api/documents/upload
         * Upload document file to MongoDB GridFS
         */
          router.post('/upload', authenticate, requireAccess(DOCUMENT_UPLOAD_ROLES, DOCUMENT_ARCHIVE_OVERRIDES), upload.single('file'), async (req, res) => {
            try {
              if (!req.file) {
                return res.status(400).json({
                  success: false,
                  error: 'No file provided',
                  message: 'Please select a file to upload'
                });
              }

              const { title, documentType, office, folder, receiptSource } = req.body;
              const documentId = req.body.documentId || ('doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
              const isReceiptUpload =
                String(folder || '').toLowerCase() === 'receipts' ||
                String(documentType || '').toLowerCase() === 'receipt';

              const storedFilename = isReceiptUpload
                ? formatReceiptDriveFilename(title, req.file.originalname, receiptSource || office)
                : req.file.originalname;

              console.log(`[Upload] Processing: ${storedFilename} (${req.file.size} bytes)`);
              console.log(`[Upload] Document ID: ${documentId}, User: ${req.user.email}, Folder: ${isReceiptUpload ? 'Receipts' : 'Documents'}`);

              const result = await uploadFileToGridFS(
                req.file.buffer,
                storedFilename,
                {
                  originalName: req.file.originalname,
                  mimeType: req.file.mimetype,
                  uploadedBy: req.user.uid,
                  uploadedByName: req.user.name,
                  documentId: documentId,
                  title: title || storedFilename,
                  documentType: documentType || (isReceiptUpload ? 'receipt' : 'other'),
                  folder: isReceiptUpload ? 'Receipts' : (folder || 'Documents'),
                  office: office || ''
                }
              );

              console.log(`[Upload] Success: ${result.fileId}`);

              // For receipt uploads, wait briefly for Drive sync so the caller immediately gets the Drive webViewLink if Drive is enabled.
              if (isReceiptUpload && driveSync.isEnabled()) {
                const driveRes = await syncToDrive(result.fileId, req.file.buffer, storedFilename, req.file.mimetype, {
                  documentId,
                  folder: 'Receipts',
                  documentType: 'receipt',
                }).catch((err) => ({ status: 'failed', error: err.message }));

                const syncedOk = driveRes.status === 'synced' && Boolean(driveRes.webViewLink);
                return res.status(200).json({
                  success: true,
                  message: syncedOk
                    ? 'Receipt uploaded and synced to Google Drive (Receipts)'
                    : 'Receipt archived in GridFS (Google Drive mirror unavailable)',
                  fileId: result.fileId,
                  data: {
                    fileId: result.fileId,
                    filename: result.filename,
                    size: result.size,
                    uploadedAt: new Date().toISOString(),
                    driveSyncStatus: driveRes.status || 'pending',
                    driveFileId: driveRes.driveFileId || null,
                    driveWebViewLink: driveRes.webViewLink || null,
                    driveFolderName: 'Receipts',
                    driveSyncError: driveRes.error || null,
                  },
                });
              }

              const driveSyncStatus = driveSync.isEnabled() ? 'pending' : 'disabled';

              res.status(200).json({
                success: true,
                message: 'File uploaded successfully',
                fileId: result.fileId,
                data: {
                  fileId: result.fileId,
                  filename: result.filename,
                  size: result.size,
                  uploadedAt: new Date().toISOString(),
                  driveSyncStatus,
                }
              });

              // Mirror to Drive after responding so upload latency is unchanged.
              syncToDrive(result.fileId, req.file.buffer, storedFilename, req.file.mimetype, {
                documentId,
                folder: isReceiptUpload ? 'Receipts' : 'Documents',
                documentType: documentType || 'other',
              }).catch((err) => {
                console.warn(`[DriveSync] Async background mirror failed for ${result.fileId}:`, err.message);
              });

            } catch (error) {
              console.error('[Upload] Error:', error);
              res.status(500).json({
                success: false,
                error: 'Upload failed',
                message: error.message
              });
            }
          });

          /**
           * GET /api/documents/:fileId/download
           * Download document file from MongoDB GridFS
           */
            router.get('/:fileId/download', authenticate, requireAccess(DOCUMENT_UPLOAD_ROLES, DOCUMENT_ARCHIVE_OVERRIDES), async (req, res) => {
              try {
                const { fileId } = req.params;
                console.log(`[Download] Request: ${fileId} by ${req.user.email}`);

                const metadata = await getFileMetadata(fileId);

                if (!metadata) {
                  return res.status(404).json({
                    success: false,
                    error: 'File not found',
                    message: `No file found with ID: ${fileId}`
                  });
                }

                console.log(`[Download] Found: ${metadata.filename} (${metadata.length} bytes)`);

                const filename = metadata.filename || 'document';
                let mimeType = metadata.metadata?.mimeType;
                if (!mimeType || mimeType === 'application/octet-stream') {
                  const lower = filename.toLowerCase();
                  if (lower.endsWith('.pdf')) mimeType = 'application/pdf';
                  else if (lower.endsWith('.png')) mimeType = 'image/png';
                  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mimeType = 'image/jpeg';
                  else if (lower.endsWith('.docx')) mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                  else if (lower.endsWith('.doc')) mimeType = 'application/msword';
                  else mimeType = 'application/octet-stream';
                }

                res.setHeader('Content-Type', mimeType);
                res.setHeader('Cache-Control', 'private, max-age=3600');
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Referrer-Policy', 'no-referrer');
                res.setHeader('X-Content-Type-Options', 'nosniff');
                const dispositionType = req.query.disposition === 'attachment' ? 'attachment' : 'inline';
                res.setHeader('Content-Disposition', `${dispositionType}; filename="${encodeURIComponent(filename)}"`);

                const range = req.headers.range;
                const totalLength = metadata.length;

                if (range && totalLength) {
                  const parts = range.replace(/bytes=/, '').split('-');
                  const start = parseInt(parts[0], 10);
                  const end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1;
                  const chunkSize = (end - start) + 1;

                  res.status(206);
                  res.setHeader('Content-Range', `bytes ${start}-${end}/${totalLength}`);
                  res.setHeader('Content-Length', chunkSize);

                  const { getGridFSBucket } = require('../utils/gridfs');
                  const { ObjectId } = require('mongodb');
                  const bucket = await getGridFSBucket();
                  const partialStream = bucket.openDownloadStream(new ObjectId(fileId), { start, end: end + 1 });
                  return partialStream.pipe(res);
                }

                res.setHeader('Content-Length', totalLength);
                const downloadStream = await getDownloadStream(fileId);
                downloadStream.pipe(res);

                downloadStream.on('error', (error) => {
                  console.error(`[Download] Stream error:`, error);
                  if (!res.headersSent) {
                    res.status(500).json({ success: false, error: 'Download failed', message: error.message });
                  }
                });

                downloadStream.on('end', () => {
                  console.log(`[Download] Completed: ${fileId}`);
                });

              } catch (error) {
                console.error('[Download] Error:', error);
                if (!res.headersSent) {
                  res.status(500).json({ success: false, error: 'Download failed', message: error.message });
                }
              }
            });

            /**
             * GET /api/documents/:fileId/metadata
             * Get file metadata
             */
              router.get('/:fileId/metadata', authenticate, requireAccess(DOCUMENT_UPLOAD_ROLES, DOCUMENT_ARCHIVE_OVERRIDES), async (req, res) => {
                try {
                  const { fileId } = req.params;
                  const metadata = await getFileMetadata(fileId);

                  if (!metadata) {
                    return res.status(404).json({
                      success: false,
                      error: 'File not found',
                      message: `No file found with ID: ${fileId}`
                    });
                  }

                  res.status(200).json({
                    success: true,
                    data: {
                      fileId: metadata._id.toString(),
                      filename: metadata.filename,
                      size: metadata.length,
                      uploadDate: metadata.uploadDate,
                      mimeType: metadata.metadata?.mimeType,
                      ...metadata.metadata
                    }
                  });

                } catch (error) {
                  console.error('[Metadata] Error:', error);
                  res.status(500).json({ success: false, error: 'Failed to get metadata', message: error.message });
                }
              });

              /**
               * DELETE /api/documents/:fileId
               * Delete document file from MongoDB GridFS
               */
                router.delete('/:fileId', authenticate, requireAccess(DOCUMENT_DELETE_ROLES, DOCUMENT_DELETE_OVERRIDES), async (req, res) => {
                  try {
                    const { fileId } = req.params;
                    console.log(`[Delete] Request: ${fileId} by ${req.user.email}`);

                    const metadata = await getFileMetadata(fileId);

                    if (!metadata) {
                      return res.status(404).json({
                        success: false,
                        error: 'File not found',
                        message: `No file found with ID: ${fileId}`
                      });
                    }

                    await deleteFileFromGridFS(fileId);
                    console.log(`[Delete] Success: ${fileId}`);
                    await driveSync.deleteMirror(metadata.metadata?.driveFileId).catch((err) =>
                      console.warn(`[DriveSync] Mirror delete failed for ${fileId}:`, err.message)
                    );

                    res.status(200).json({
                      success: true,
                      message: 'File deleted successfully',
                      data: {
                        fileId: fileId,
                        filename: metadata.filename
                      }
                    });

                  } catch (error) {
                    console.error('[Delete] Error:', error);
                    res.status(500).json({ success: false, error: 'Delete failed', message: error.message });
                  }
                });

                /**
                 * DELETE /api/documents/firestore/:documentId
                 * Delete document metadata from Firestore using Firebase Admin SDK (bypasses client security rules)
                 * and cleans up any linked GridFS file if mongoFileId is present.
                 */
                  router.delete('/firestore/:documentId', authenticate, requireAccess(DOCUMENT_DELETE_ROLES, DOCUMENT_DELETE_OVERRIDES), async (req, res) => {
                    try {
                      const { documentId } = req.params;
                      const { getFirestore } = require('../services/firebase-admin');
                      const db = getFirestore();
                      const docRef = db.collection('documents').doc(documentId);
                      const snap = await docRef.get();

                      if (!snap.exists) {
                        return res.status(404).json({ success: false, error: 'Document not found in Firestore' });
                      }

                      const data = snap.data();
                      if (data.mongoFileId) {
                        try {
                          const gridMeta = await getFileMetadata(data.mongoFileId);
                          await deleteFileFromGridFS(data.mongoFileId);
                          await driveSync.deleteMirror(gridMeta?.metadata?.driveFileId).catch((e) =>
                            console.warn(`[DriveSync] Mirror delete failed for ${data.mongoFileId}:`, e.message)
                          );
                        } catch (err) {
                          console.warn(`[Delete Firestore] GridFS cleanup failed for ${data.mongoFileId}:`, err.message);
                        }
                      }

                      await docRef.delete();
                      console.log(`[Delete Firestore] Document ${documentId} ("${data.title}") deleted by ${req.user.email || req.user.uid}`);

                      res.status(200).json({
                        success: true,
                        message: `Document "${data.title}" deleted successfully`,
                        data: { documentId, title: data.title }
                      });
                    } catch (error) {
                      console.error('[Delete Firestore] Error:', error);
                      res.status(500).json({ success: false, error: 'Failed to delete document from Firestore', message: error.message });
                    }
                  });

                  router.use(handleUploadError);
                  router.__formatReceiptDriveFilename = formatReceiptDriveFilename;

                  module.exports = router;
