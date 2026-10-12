const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');
const {
  uploadFileToGridFS,
  getDownloadStream,
  getFileMetadata,
  deleteFileFromGridFS,
  listFiles,
} = require('../utils/gridfs');

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
      message: dbStatus === 'connected' ? 'MongoDB GridFS is reachable' : 'MongoDB error — ' + dbStatus,
      database: process.env.MONGODB_DATABASE || 'ssg_documents',
      bucket: bucketName,
      totalFiles,
      timestamp: new Date().toISOString(),
      mongoStatus: dbStatus,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Health check failed',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/documents/list
 * List all files stored in GridFS with their metadata.
 * Used by admin/diagnostic tools to track which Firestore documents have
 * matching GridFS binaries.
 */
router.get('/list', authenticate, async (req, res) => {
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
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file provided',
        message: 'Please select a file to upload'
      });
    }

    const { title, documentType, office } = req.body;
    const documentId = req.body.documentId || ('doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));

    console.log(`[Upload] Processing: ${req.file.originalname} (${req.file.size} bytes)`);
    console.log(`[Upload] Document ID: ${documentId}, User: ${req.user.email}`);

    const result = await uploadFileToGridFS(
      req.file.buffer,
      req.file.originalname,
      {
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        uploadedBy: req.user.uid,
        uploadedByName: req.user.name,
        documentId: documentId,
        title: title || req.file.originalname,
        documentType: documentType || 'other',
        office: office || ''
      }
    );

    console.log(`[Upload] Success: ${result.fileId}`);

    res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      fileId: result.fileId,
      data: {
        fileId: result.fileId,
        filename: result.filename,
        size: result.size,
        uploadedAt: new Date().toISOString()
      }
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
router.get('/:fileId/download', authenticate, async (req, res) => {
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
router.get('/:fileId/metadata', authenticate, async (req, res) => {
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
router.delete('/:fileId', authenticate, async (req, res) => {
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
router.delete('/firestore/:documentId', authenticate, async (req, res) => {
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
        await deleteFileFromGridFS(data.mongoFileId);
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

module.exports = router;
