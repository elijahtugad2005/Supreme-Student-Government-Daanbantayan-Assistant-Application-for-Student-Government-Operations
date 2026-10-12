const multer = require('multer');

/**
 * File size limit from environment (default 50MB)
 */
const MAX_FILE_SIZE = (process.env.MAX_FILE_SIZE_MB || 50) * 1024 * 1024;

/**
 * Allowed MIME types from environment
 */
const ALLOWED_MIME_TYPES = process.env.ALLOWED_MIME_TYPES
  ? process.env.ALLOWED_MIME_TYPES.split(',')
  : [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'image/jpeg',
      'image/jpg',
      'image/png'
    ];

/**
 * Multer storage configuration (memory storage for streaming to MongoDB)
 */
const storage = multer.memoryStorage();

/**
 * File filter function
 */
function fileFilter(req, file, cb) {
  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    const error = new Error(
      `File type not allowed. Accepted types: ${ALLOWED_MIME_TYPES.join(', ')}`
    );
    error.code = 'INVALID_FILE_TYPE';
    return cb(error, false);
  }

  cb(null, true);
}

/**
 * Multer upload middleware
 */
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1 // Only one file per request
  },
  fileFilter: fileFilter
});

/**
 * Error handler for multer errors
 */
function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large',
        message: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
        maxSize: MAX_FILE_SIZE
      });
    }

    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Too many files',
        message: 'Only one file can be uploaded at a time'
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Upload error',
      message: err.message
    });
  }

  if (err && err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      success: false,
      error: 'Invalid file type',
      message: err.message,
      allowedTypes: ALLOWED_MIME_TYPES
    });
  }

  // Pass other errors to default error handler
  next(err);
}

module.exports = {
  upload,
  handleUploadError,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES
};
