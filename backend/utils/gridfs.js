const { GridFSBucket, ObjectId } = require('mongodb');
const { getDatabase } = require('../services/mongodb');
const stream = require('stream');

/**
 * Get GridFS bucket
 */
async function getGridFSBucket() {
  const db = await getDatabase();
  const bucketName = process.env.MONGODB_BUCKET_NAME || 'documents';
  return new GridFSBucket(db, { bucketName });
}

/**
 * Upload file to GridFS
 * 
 * @param {Buffer} fileBuffer - File data as Buffer
 * @param {string} filename - Original filename
 * @param {object} metadata - Additional metadata to store
 * @returns {Promise<{fileId: string, filename: string, size: number}>}
 */
async function uploadFileToGridFS(fileBuffer, filename, metadata = {}) {
  const bucket = await getGridFSBucket();
  
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      metadata: {
        ...metadata,
        uploadDate: new Date(),
      }
    });

    const readStream = stream.Readable.from(fileBuffer);
    
    uploadStream.on('error', (error) => {
      console.error('[GridFS] Upload error:', error);
      reject(error);
    });

    uploadStream.on('finish', () => {
      console.log(`[GridFS] File uploaded: ${filename} (ID: ${uploadStream.id})`);
      resolve({
        fileId: uploadStream.id.toString(),
        filename: filename,
        size: fileBuffer.length
      });
    });

    readStream.pipe(uploadStream);
  });
}

/**
 * Download file from GridFS as Buffer
 * 
 * @param {string} fileId - MongoDB ObjectId as string
 * @returns {Promise<Buffer>}
 */
async function downloadFileFromGridFS(fileId) {
  const bucket = await getGridFSBucket();
  
  return new Promise((resolve, reject) => {
    const chunks = [];
    const downloadStream = bucket.openDownloadStream(new ObjectId(fileId));

    downloadStream.on('data', (chunk) => {
      chunks.push(chunk);
    });

    downloadStream.on('error', (error) => {
      console.error(`[GridFS] Download error for file ${fileId}:`, error);
      reject(error);
    });

    downloadStream.on('end', () => {
      const buffer = Buffer.concat(chunks);
      console.log(`[GridFS] File downloaded: ${fileId} (${buffer.length} bytes)`);
      resolve(buffer);
    });
  });
}

/**
 * Get download stream (for piping to response)
 * 
 * @param {string} fileId - MongoDB ObjectId as string
 * @returns {Promise<GridFSBucketReadStream>}
 */
async function getDownloadStream(fileId) {
  const bucket = await getGridFSBucket();
  return bucket.openDownloadStream(new ObjectId(fileId));
}

/**
 * Get file metadata
 * 
 * @param {string} fileId - MongoDB ObjectId as string
 * @returns {Promise<object|null>}
 */
async function getFileMetadata(fileId) {
  try {
    const db = await getDatabase();
    const bucketName = process.env.MONGODB_BUCKET_NAME || 'documents';
    
    const file = await db.collection(`${bucketName}.files`).findOne({
      _id: new ObjectId(fileId)
    });
    
    return file;
  } catch (error) {
    console.error(`[GridFS] Error fetching metadata for ${fileId}:`, error);
    return null;
  }
}

/**
 * Delete file from GridFS
 * 
 * @param {string} fileId - MongoDB ObjectId as string
 * @returns {Promise<boolean>}
 */
async function deleteFileFromGridFS(fileId) {
  try {
    const bucket = await getGridFSBucket();
    await bucket.delete(new ObjectId(fileId));
    console.log(`[GridFS] File deleted: ${fileId}`);
    return true;
  } catch (error) {
    console.error(`[GridFS] Delete error for file ${fileId}:`, error);
    throw error;
  }
}

/**
 * Check if file exists
 * 
 * @param {string} fileId - MongoDB ObjectId as string
 * @returns {Promise<boolean>}
 */
async function fileExists(fileId) {
  try {
    const metadata = await getFileMetadata(fileId);
    return metadata !== null;
  } catch (error) {
    return false;
  }
}

/**
 * List all files (with optional filter)
 * 
 * @param {object} filter - MongoDB query filter
 * @param {number} limit - Max results to return
 * @returns {Promise<Array>}
 */
async function listFiles(filter = {}, limit = 100) {
  const db = await getDatabase();
  const bucketName = process.env.MONGODB_BUCKET_NAME || 'documents';
  
  const files = await db.collection(`${bucketName}.files`)
    .find(filter)
    .limit(limit)
    .toArray();
  
  return files;
}

module.exports = {
  getGridFSBucket,
  uploadFileToGridFS,
  downloadFileFromGridFS,
  getDownloadStream,
  getFileMetadata,
  deleteFileFromGridFS,
  fileExists,
  listFiles
};
