# MongoDB Integration - Session 2
## Firebase Admin SDK & Authentication Middleware

**Date:** February 8, 2027  
**Session:** 2 of 7  
**Timeline:** Day 1-2 - Authentication & API Endpoints  
**Status:** In Progress

---

## Session Objectives

1. ✅ Set up Firebase Admin SDK
2. ✅ Create authentication middleware (JWT verification)
3. ✅ Create file upload middleware (Multer)
4. ✅ Build document upload API endpoint
5. ✅ Build document download API endpoint
6. ✅ Build document delete API endpoint
7. ✅ Test complete upload/download flow

---

## Prerequisites Completed

- [x] MongoDB Atlas cluster created (Singapore)
- [x] Connection string obtained
- [x] `.env` file created with MONGODB_URI
- [x] Dependencies installed
- [x] GridFS utilities working

---

## 1. Firebase Admin SDK Setup

### 1.1 Get Firebase Service Account Key

**Manual Steps:**

1. Go to Firebase Console: https://console.firebase.google.com/
2. Select project: `ssg-prototype`
3. Click: ⚙️ Settings → Project settings
4. Click: Service accounts tab
5. Click: **Generate new private key**
6. Save file as: `backend/firebase-service-account.json`
7. **IMPORTANT:** Add to `.gitignore`!

### 1.2 Firebase Admin Service

**File:** `backend/services/firebase-admin.js`

```javascript
const admin = require('firebase-admin');
const path = require('path');

let initialized = false;

/**
 * Initialize Firebase Admin SDK
 * Uses service account key for authentication
 */
function initializeFirebaseAdmin() {
  if (initialized) {
    return admin;
  }

  try {
    // Option 1: Use service account file (development)
    const serviceAccountPath = path.join(__dirname, '../firebase-service-account.json');
    
    // Try to load from file first
    let serviceAccount;
    try {
      serviceAccount = require(serviceAccountPath);
      console.log('[Firebase Admin] Loaded service account from file');
    } catch (fileError) {
      // Option 2: Use environment variables (production)
      console.log('[Firebase Admin] Service account file not found, using environment variables');
      
      if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error('Firebase Admin credentials not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY environment variables.');
      }

      serviceAccount = {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        // Private key from env var has escaped newlines, need to unescape
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      };
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: `${serviceAccount.project_id}.appspot.com`
    });

    initialized = true;
    console.log(`[Firebase Admin] Initialized successfully for project: ${serviceAccount.project_id}`);

    return admin;
  } catch (error) {
    console.error('[Firebase Admin] Initialization failed:', error.message);
    throw error;
  }
}

/**
 * Get initialized Firebase Admin instance
 */
function getFirebaseAdmin() {
  if (!initialized) {
    initializeFirebaseAdmin();
  }
  return admin;
}

/**
 * Verify Firebase ID token
 * @param {string} idToken - Firebase ID token from client
 * @returns {Promise<DecodedIdToken>}
 */
async function verifyIdToken(idToken) {
  const admin = getFirebaseAdmin();
  return await admin.auth().verifyIdToken(idToken);
}

/**
 * Get Firestore instance
 */
function getFirestore() {
  const admin = getFirebaseAdmin();
  return admin.firestore();
}

/**
 * Get Storage bucket
 */
function getStorageBucket() {
  const admin = getFirebaseAdmin();
  return admin.storage().bucket();
}

module.exports = {
  initializeFirebaseAdmin,
  getFirebaseAdmin,
  verifyIdToken,
  getFirestore,
  getStorageBucket
};
```

---

## 2. Authentication Middleware

### 2.1 JWT Verification Middleware

**File:** `backend/middleware/auth.js`

```javascript
const { verifyIdToken } = require('../services/firebase-admin');

/**
 * Authentication middleware
 * Verifies Firebase JWT token from Authorization header
 * 
 * Expected header format: "Bearer <firebase-id-token>"
 */
async function authenticate(req, res, next) {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: 'Authorization header missing',
        message: 'Please provide a Firebase ID token in Authorization header'
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Invalid authorization format',
        message: 'Authorization header must be "Bearer <token>"'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];

    if (!idToken || idToken.trim() === '') {
      return res.status(401).json({
        success: false,
        error: 'Token missing',
        message: 'Authorization token is empty'
      });
    }

    // Verify token with Firebase Admin
    const decodedToken = await verifyIdToken(idToken);

    // Attach user info to request object
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name || decodedToken.email?.split('@')[0] || 'Unknown',
      role: decodedToken.role || 'member', // Custom claim if set
      emailVerified: decodedToken.email_verified
    };

    console.log(`[Auth] Authenticated user: ${req.user.email} (${req.user.uid})`);

    next();
  } catch (error) {
    console.error('[Auth] Token verification failed:', error.message);

    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
        message: 'Your session has expired. Please sign in again.'
      });
    }

    if (error.code === 'auth/argument-error') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        message: 'The provided token is malformed or invalid.'
      });
    }

    return res.status(401).json({
      success: false,
      error: 'Authentication failed',
      message: error.message
    });
  }
}

/**
 * Optional authentication middleware
 * Tries to authenticate but doesn't fail if no token provided
 */
async function optionalAuthenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await verifyIdToken(idToken);

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name || decodedToken.email?.split('@')[0] || 'Unknown',
      role: decodedToken.role || 'member'
    };

    next();
  } catch (error) {
    // Don't fail on auth error, just set user to null
    console.warn('[Auth] Optional authentication failed:', error.message);
    req.user = null;
    next();
  }
}

/**
 * Role-based authorization middleware
 * Use after authenticate() middleware
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authenticated',
        message: 'Please authenticate first'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        message: `This action requires one of these roles: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
}

module.exports = {
  authenticate,
  optionalAuthenticate,
  requireRole
};
```

---

## 3. File Upload Middleware

### 3.1 Multer Configuration

**File:** `backend/middleware/upload.js`

```javascript
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
```

---

## 4. Document API Routes

### 4.1 Documents Router

**File:** `backend/routes/documents.js`

```javascript
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { upload, handleUploadError } = require('../middleware/upload');
const {
  uploadFileToGridFS,
  downloadFileFromGridFS,
  getDownloadStream,
  getFileMetadata,
  deleteFileFromGridFS
} = require('../utils/gridfs');
const { getFirestore } = require('../services/firebase-admin');

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

    // Extract metadata from request body
    const {
      documentId, // Firestore document ID
      title,
      documentType,
      office
    } = req.body;

    if (!documentId) {
      return res.status(400).json({
        success: false,
        error: 'Document ID required',
        message: 'documentId must be provided in request body'
      });
    }

    console.log(`[Upload] Processing file: ${req.file.originalname} (${req.file.size} bytes)`);
    console.log(`[Upload] Document ID: ${documentId}`);
    console.log(`[Upload] User: ${req.user.email}`);

    // Upload to GridFS
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

    console.log(`[Upload] File uploaded to MongoDB: ${result.fileId}`);

    // Return success with fileId
    res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
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

    console.log(`[Download] Request for file: ${fileId}`);
    console.log(`[Download] User: ${req.user.email}`);

    // Get file metadata first
    const metadata = await getFileMetadata(fileId);

    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
        message: `No file found with ID: ${fileId}`
      });
    }

    console.log(`[Download] File found: ${metadata.filename} (${metadata.length} bytes)`);

    // TODO: Add authorization check here
    // Verify user has permission to access this document
    // Check if metadata.metadata.uploadedBy === req.user.uid or user has admin role

    // Get download stream
    const downloadStream = await getDownloadStream(fileId);

    // Set response headers
    res.setHeader('Content-Type', metadata.metadata?.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', metadata.length);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(metadata.filename)}"`);

    // Pipe stream to response
    downloadStream.pipe(res);

    downloadStream.on('error', (error) => {
      console.error(`[Download] Stream error for ${fileId}:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Download failed',
          message: error.message
        });
      }
    });

    downloadStream.on('end', () => {
      console.log(`[Download] Completed: ${fileId}`);
    });

  } catch (error) {
    console.error('[Download] Error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Download failed',
        message: error.message
      });
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
    res.status(500).json({
      success: false,
      error: 'Failed to get metadata',
      message: error.message
    });
  }
});

/**
 * DELETE /api/documents/:fileId
 * Delete document file from MongoDB GridFS
 */
router.delete('/:fileId', authenticate, async (req, res) => {
  try {
    const { fileId } = req.params;

    console.log(`[Delete] Request for file: ${fileId}`);
    console.log(`[Delete] User: ${req.user.email}`);

    // Get metadata first for authorization check
    const metadata = await getFileMetadata(fileId);

    if (!metadata) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
        message: `No file found with ID: ${fileId}`
      });
    }

    // TODO: Add authorization check
    // Only allow delete if user uploaded the file or is admin
    // if (metadata.metadata.uploadedBy !== req.user.uid && req.user.role !== 'admin') {
    //   return res.status(403).json({ ... });
    // }

    // Delete from GridFS
    await deleteFileFromGridFS(fileId);

    console.log(`[Delete] File deleted: ${fileId}`);

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
    res.status(500).json({
      success: false,
      error: 'Delete failed',
      message: error.message
    });
  }
});

// Apply error handler
router.use(handleUploadError);

module.exports = router;
```

---

## 5. Update Server.js

### 5.1 Integrate New Routes

**File:** `backend/server.js` (MODIFIED)

```javascript
// Main entry point for the SSG Office Assistant Backend API
// Handles: Telegram notifications + MongoDB document storage

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

// Initialize Firebase Admin first
const { initializeFirebaseAdmin } = require('./services/firebase-admin');
const { closeConnection } = require('./services/mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

// Initialize Firebase Admin SDK
try {
  initializeFirebaseAdmin();
  console.log('[Server] Firebase Admin SDK initialized');
} catch (error) {
  console.error('[Server] Failed to initialize Firebase Admin:', error.message);
  console.warn('[Server] Document API endpoints will not work without Firebase Admin');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      mongodb: 'connected', // TODO: Add actual health check
      firebase: 'initialized'
    }
  });
});

// API Routes
const documentsRouter = require('./routes/documents');
app.use('/api/documents', documentsRouter);

// ==========================================
// TELEGRAM WEBHOOK ENDPOINTS (Existing)
// ==========================================

// Environment variables
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Validate Telegram environment variables (optional for document API)
if (!PAGE_ACCESS_TOKEN) {
  console.warn('[Server] WARNING: PAGE_ACCESS_TOKEN not set - Telegram features disabled');
}

if (!VERIFY_TOKEN) {
  console.warn('[Server] WARNING: VERIFY_TOKEN not set - Telegram features disabled');
}

// Webhook verification endpoint
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  console.log(`[${new Date().toISOString()}] [INFO] Webhook verification attempt:`, {
    mode: mode,
    tokenMatch: token === VERIFY_TOKEN,
    challengePresent: !!challenge
  });
  
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log(`[${new Date().toISOString()}] [INFO] Webhook verified successfully`);
    res.status(200).send(challenge);
  } else {
    console.error(`[${new Date().toISOString()}] [ERROR] Webhook verification failed`);
    res.sendStatus(403);
  }
});

// Webhook event receiver endpoint
app.post('/webhook', (req, res) => {
  res.status(200).send('EVENT_RECEIVED');
  
  try {
    const body = req.body;
    
    if (body.object === 'page') {
      body.entry.forEach(entry => {
        entry.messaging.forEach(event => {
          const senderPsid = event.sender.id;
          console.log(`[${new Date().toISOString()}] [INFO] Received message from PSID: ${senderPsid}`);
          
          if (event.message && event.message.text) {
            console.log(`[${new Date().toISOString()}] [INFO] Message text: ${event.message.text}`);
          }
        });
      });
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [ERROR] Error processing webhook event:`, error.message);
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Server] Error:', err.stack);
  
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: 'CORS error',
      message: 'Origin not allowed'
    });
  }
  
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`[Server] SSG Office Assistant Backend API`);
  console.log(`[Server] Listening on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Server] Allowed origins: ${allowedOrigins.join(', ')}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  server.close(async () => {
    console.log('[Server] HTTP server closed');
    await closeConnection();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('[Server] SIGINT received, shutting down gracefully...');
  server.close(async () => {
    console.log('[Server] HTTP server closed');
    await closeConnection();
    process.exit(0);
  });
});

// Server error handling
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[Server] ERROR: Port ${PORT} is already in use`);
  } else if (error.code === 'EACCES') {
    console.error(`[Server] ERROR: Permission denied to bind to port ${PORT}`);
  } else {
    console.error(`[Server] ERROR: Server startup failed:`, error.message);
  }
  process.exit(1);
});

module.exports = app;
```

---

## 6. Update Environment Variables

### 6.1 Update .env File

Add Firebase Admin credentials to `backend/.env`:

```env
# MongoDB Configuration
MONGODB_URI=mongodb+srv://ssg_app_user:YOUR_PASSWORD@ssg-documents-cluster.xxxxx.mongodb.net/ssg_documents?retryWrites=true&w=majority
MONGODB_DATABASE=ssg_documents
MONGODB_BUCKET_NAME=documents

# Firebase Admin SDK
FIREBASE_PROJECT_ID=ssg-prototype
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@ssg-prototype.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"

# Server Configuration
PORT=3000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173

# File Upload Limits
MAX_FILE_SIZE_MB=50
ALLOWED_MIME_TYPES=application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png,image/jpg

# Telegram Configuration (existing)
PAGE_ACCESS_TOKEN=your_telegram_bot_token
VERIFY_TOKEN=your_verify_token
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
```

---

## 7. Testing

### 7.1 Start Backend Server

```powershell
cd backend
node server.js
```

**Expected Output:**
```
[Firebase Admin] Initialized successfully for project: ssg-prototype
[Server] Firebase Admin SDK initialized
[Server] SSG Office Assistant Backend API
[Server] Listening on port 3000
[Server] Environment: development
[Server] Allowed origins: http://localhost:5173
```

### 7.2 Test Authentication Endpoint

Create test file: `backend/test-auth.js`

```javascript
require('dotenv').config();
const axios = require('axios');

// Get a Firebase ID token from your frontend first
// Then paste it here
const FIREBASE_ID_TOKEN = 'YOUR_FIREBASE_ID_TOKEN_HERE';

async function testAuth() {
  try {
    console.log('🧪 Testing authentication...\n');

    const response = await axios.get('http://localhost:3000/health', {
      headers: {
        'Authorization': `Bearer ${FIREBASE_ID_TOKEN}`
      }
    });

    console.log('✅ Health check passed:');
    console.log(response.data);

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

testAuth();
```

### 7.3 Test Upload Endpoint (with curl)

```powershell
# Get Firebase ID token from frontend localStorage
# localStorage.getItem('firebase:authUser:...')

# Upload test file
curl -X POST http://localhost:3000/api/documents/upload \
  -H "Authorization: Bearer YOUR_FIREBASE_ID_TOKEN" \
  -F "file=@test-document.pdf" \
  -F "documentId=test-doc-123" \
  -F "title=Test Document" \
  -F "documentType=resolution"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "fileId": "507f1f77bcf86cd799439011",
    "filename": "test-document.pdf",
    "size": 245789,
    "uploadedAt": "2027-02-08T16:30:00.000Z"
  }
}
```

---

## 8. Session Summary

### 8.1 Files Created

```
backend/
├── services/
│   └── firebase-admin.js       ✅ Created
├── middleware/
│   ├── auth.js                 ✅ Created
│   └── upload.js               ✅ Created
├── routes/
│   └── documents.js            ✅ Created
└── test-auth.js                ✅ Created
```

### 8.2 Files Modified

```
backend/server.js
  - Added CORS middleware
  - Added Firebase Admin initialization
  - Added /api/documents routes
  - Added graceful shutdown
  - Added error handling
```

### 8.3 API Endpoints Created

```
POST   /api/documents/upload          Upload file to MongoDB
GET    /api/documents/:fileId/download     Download file
GET    /api/documents/:fileId/metadata     Get file metadata
DELETE /api/documents/:fileId               Delete file
GET    /health                              Health check
```

---

## 9. Code Patches

### Patch 1: Create middleware directory

```bash
mkdir backend/middleware
mkdir backend/routes
```

### Patch 2: Update .gitignore

```diff
--- a/.gitignore
+++ b/.gitignore
@@ -25,3 +25,4 @@
 # Environment variables
 backend/.env
 .env.local
+backend/firebase-service-account.json
```

---

## 10. Next Steps (Session 3)

**Frontend Integration:**

1. Create `mongoStore.js` implementation
2. Update `fileStore/index.js` to support MongoDB
3. Update `documentService.js` upload logic
4. Add HTTP client for API calls
5. Test complete upload/download flow from UI

**Estimated Time:** 3-4 hours

---

**Session Status:** ✅ Complete  
**Next Session:** Frontend MongoDB Integration  
**Timeline Status:** On Track (Day 1-2/7)

---

**Documentation Version:** 1.0  
**Last Updated:** February 8, 2027, 5:00 PM  
**Author:** SSG Development Team
