/**
 * functions/src/mongodb.js
 *
 * GridFS file fetch for Cloud Functions.
 * Each call opens a fresh MongoClient and closes it after the download,
 * because Cloud Function instances are short-lived and connection pooling
 * across invocations is unreliable.
 */
import { MongoClient, GridFSBucket, ObjectId } from 'mongodb';

/**
 * Fetch a file from MongoDB GridFS by its ObjectId string.
 * Returns { buffer, mimeType, name } matching fetchFile()'s shape.
 * 
 * @param {string} mongoFileId - The MongoDB ObjectId as a string
 * @param {string} mongoUri - The MongoDB connection URI
 * @returns {Promise<{buffer: Buffer, mimeType: string, name: string}>}
 */
export async function fetchFromGridFS(mongoFileId, mongoUri) {
  if (!mongoUri) {
    throw Object.assign(
      new Error('MONGODB_URI is not configured in the functions environment.'),
      { code: 'MONGODB_NOT_CONFIGURED' }
    );
  }
  if (!mongoFileId) {
    throw Object.assign(
      new Error('Document has no mongoFileId — cannot fetch from GridFS.'),
      { code: 'GRIDFS_NO_FILE_ID' }
    );
  }

  const client = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 30000,
  });

  try {
    await client.connect();
    const db = client.db(); // database name comes from the URI
    const bucketName = process.env.MONGODB_BUCKET_NAME || 'documents';
    const bucket = new GridFSBucket(db, { bucketName });

    let fileId;
    try {
      fileId = new ObjectId(mongoFileId);
    } catch {
      throw Object.assign(
        new Error(`Invalid mongoFileId: ${mongoFileId}`),
        { code: 'GRIDFS_INVALID_ID' }
      );
    }

    // Resolve file metadata for mimeType and filename
    const filesCollection = db.collection(`${bucketName}.files`);
    const meta = await filesCollection.findOne({ _id: fileId });
    if (!meta) {
      throw Object.assign(
        new Error(`File not found in GridFS: ${mongoFileId}`),
        { code: 'GRIDFS_FILE_NOT_FOUND' }
      );
    }

    // Stream the file into a Buffer
    const chunks = [];
    await new Promise((resolve, reject) => {
      const stream = bucket.openDownloadStream(fileId);
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    const buffer = Buffer.concat(chunks);
    const mimeType = meta.metadata?.mimeType || meta.contentType || 'application/pdf';
    const name = meta.filename || meta.metadata?.originalName || 'document';

    return { buffer, mimeType, name };
  } finally {
    await client.close();
  }
}
