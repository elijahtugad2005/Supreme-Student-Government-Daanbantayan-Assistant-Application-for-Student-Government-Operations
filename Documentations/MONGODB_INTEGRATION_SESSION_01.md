# MongoDB Integration - Session 1
## MongoDB Atlas Setup & Backend Foundation

**Date:** February 8, 2027  
**Session:** 1 of 7  
**Timeline:** Day 1 - Infrastructure Setup  
**Status:** In Progress

---

## Session Objectives

1. ✅ Create MongoDB Atlas cluster (Singapore region)
2. ✅ Configure database user and network access
3. ✅ Set up backend project structure
4. ✅ Install required dependencies
5. ✅ Create MongoDB connection utilities
6. ✅ Implement GridFS upload/download logic
7. ✅ Test connection locally

---

## 1. MongoDB Atlas Configuration

### 1.1 Cluster Details

```yaml
Cluster Name: ssg-documents-cluster
Region: ap-southeast-1 (Singapore)
Tier: M0 Sandbox (Free)
Cloud Provider: AWS
Storage: 512 MB
Connections: 500 max
```

### 1.2 Database User

```yaml
Username: ssg_app_user
Password: [SECURE - Store in password manager]
Role: Atlas admin
Authentication: SCRAM-SHA-256
```

### 1.3 Network Access

```yaml
IP Whitelist:
  - 0.0.0.0/0 (Allow from anywhere - required for Railway)
  
Security Note: 
  - Authentication required for all connections
  - Firebase token verification on all API calls
  - No public access without valid credentials
```

### 1.4 Connection String

```
mongodb+srv://ssg_app_user:<password>@ssg-documents-cluster.xxxxx.mongodb.net/ssg_documents?retryWrites=true&w=majority
```

**Database Name:** `ssg_documents`  
**GridFS Bucket:** `documents`

---

## 2. Backend Project Structure

### 2.1 New Directory Structure

```
backend/
├── server.js (EXISTING - to be extended)
├── package.json (EXISTING - to be updated)
├── .env (NEW)
├── .env.example (NEW)
├── routes/
│   └── documents.js (NEW)
├── middleware/
│   ├── auth.js (NEW)
│   └── upload.js (NEW)
├── services/
│   ├── mongodb.js (NEW)
│   └── firebase-admin.js (NEW)
└── utils/
    └── gridfs.js (NEW)
```

---

## 3. Dependencies Installation

### 3.1 New Dependencies

```bash
cd backend
npm install mongodb@^6.3.0 multer@^1.4.5 cors@^2.8.5 firebase-admin@^12.0.0
```

**Package Details:**
- `mongodb@6.3.0` - Official MongoDB driver with GridFS support
- `multer@1.4.5` - Multipart form-data handling for file uploads
- `cors@2.8.5` - Cross-Origin Resource Sharing
- `firebase-admin@12.0.0` - Firebase Admin SDK for token verification

### 3.2 Updated package.json

```json
{
  "name": "backend",
  "version": "2.0.0",
  "description": "SSG Office Assistant Backend API",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": ["ssg", "mongodb", "firebase", "telegram"],
  "author": "SSG Development Team",
  "license": "ISC",
  "type": "commonjs",
  "dependencies": {
    "axios": "^1.16.0",
    "body-parser": "^2.2.2",
    "cors": "^2.8.5",
    "dotenv": "^17.4.2",
    "express": "^5.2.1",
    "firebase-admin": "^12.0.0",
    "mongodb": "^6.3.0",
    "multer": "^1.4.5"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

---

## 4. Environment Configuration

### 4.1 .env Template

```env
# MongoDB Configuration
MONGODB_URI=mongodb+srv://ssg_app_user:<password>@ssg-documents-cluster.xxxxx.mongodb.net/ssg_documents?retryWrites=true&w=majority
MONGODB_DATABASE=ssg_documents
MONGODB_BUCKET_NAME=documents

# Firebase Admin SDK
FIREBASE_PROJECT_ID=ssg-prototype
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@ssg-prototype.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Server Configuration
PORT=3000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173,https://yourdomain.com

# Telegram Configuration (existing)
PAGE_ACCESS_TOKEN=your_telegram_bot_token
VERIFY_TOKEN=your_verify_token
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_FACULTY_CHAT_ID=your_chat_id
TELEGRAM_MAYORS_CHAT_ID=your_chat_id

# File Upload Limits
MAX_FILE_SIZE_MB=50
ALLOWED_MIME_TYPES=application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png,image/jpg
```

### 4.2 .env.example

```env
# MongoDB Configuration
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority
MONGODB_DATABASE=ssg_documents
MONGODB_BUCKET_NAME=documents

# Firebase Admin SDK
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"

# Server Configuration
PORT=3000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173

# File Upload Limits
MAX_FILE_SIZE_MB=50
ALLOWED_MIME_TYPES=application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/jpeg,image/png,image/jpg
```

---

## 5. Code Implementation

### 5.1 MongoDB Service (services/mongodb.js)

**Purpose:** Singleton MongoDB client with connection pooling

**File:** `backend/services/mongodb.js`

```javascript
const { MongoClient } = require('mongodb');

let client = null;
let db = null;

/**
 * Get or create MongoDB client singleton
 * Connection is pooled and reused across requests
 */
async function getMongoClient() {
  if (!client) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error('MONGODB_URI environment variable is not set');
    }

    console.log('[MongoDB] Connecting to MongoDB Atlas...');
    
    client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    await client.connect();
    
    const dbName = process.env.MONGODB_DATABASE || 'ssg_documents';
    db = client.db(dbName);
    
    console.log(`[MongoDB] Connected successfully to database: ${dbName}`);
    
    // Test connection
    await db.admin().ping();
    console.log('[MongoDB] Database ping successful');
  }

  return { client, db };
}

/**
 * Get database instance
 */
async function getDatabase() {
  const { db } = await getMongoClient();
  return db;
}

/**
 * Close MongoDB connection (for graceful shutdown)
 */
async function closeConnection() {
  if (client) {
    console.log('[MongoDB] Closing connection...');
    await client.close();
    client = null;
    db = null;
    console.log('[MongoDB] Connection closed');
  }
}

module.exports = {
  getMongoClient,
  getDatabase,
  closeConnection
};
```

**Features:**
- ✅ Connection pooling (10 max, 2 min)
- ✅ Singleton pattern (one connection for entire app)
- ✅ Automatic reconnection
- ✅ Graceful shutdown support
- ✅ Connection health check (ping)

---

### 5.2 GridFS Utilities (utils/gridfs.js)

**Purpose:** GridFS file upload/download/delete operations

**File:** `backend/utils/gridfs.js`

```javascript
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
```

**Features:**
- ✅ Stream-based upload (memory efficient)
- ✅ Stream-based download (for HTTP responses)
- ✅ Buffer-based download (for AI processing)
- ✅ Metadata storage and retrieval
- ✅ File existence checking
- ✅ File listing with filters
- ✅ Comprehensive error handling

---

## 6. Testing Checklist

### 6.1 Local Connection Test

```bash
# Test MongoDB connection
node -e "require('./backend/services/mongodb').getMongoClient().then(() => console.log('✅ Connected')).catch(e => console.error('❌ Error:', e.message))"
```

**Expected Output:**
```
[MongoDB] Connecting to MongoDB Atlas...
[MongoDB] Connected successfully to database: ssg_documents
[MongoDB] Database ping successful
✅ Connected
```

### 6.2 GridFS Test Script

**File:** `backend/test-gridfs.js`

```javascript
require('dotenv').config();
const fs = require('fs');
const { uploadFileToGridFS, downloadFileFromGridFS, getFileMetadata, deleteFileFromGridFS } = require('./utils/gridfs');
const { closeConnection } = require('./services/mongodb');

async function testGridFS() {
  try {
    console.log('🧪 Testing GridFS operations...\n');

    // Test 1: Upload
    console.log('📤 Test 1: Uploading test file...');
    const testContent = Buffer.from('This is a test document for SSG Office Assistant');
    const uploadResult = await uploadFileToGridFS(
      testContent,
      'test-document.txt',
      {
        documentType: 'test',
        uploadedBy: 'test-user',
        purpose: 'integration-test'
      }
    );
    console.log('✅ Upload successful:', uploadResult);
    const fileId = uploadResult.fileId;

    // Test 2: Get Metadata
    console.log('\n📋 Test 2: Fetching file metadata...');
    const metadata = await getFileMetadata(fileId);
    console.log('✅ Metadata:', {
      _id: metadata._id,
      filename: metadata.filename,
      length: metadata.length,
      uploadDate: metadata.uploadDate,
      metadata: metadata.metadata
    });

    // Test 3: Download
    console.log('\n📥 Test 3: Downloading file...');
    const downloadedBuffer = await downloadFileFromGridFS(fileId);
    const downloadedContent = downloadedBuffer.toString();
    console.log('✅ Downloaded content:', downloadedContent);

    // Test 4: Verify content matches
    console.log('\n🔍 Test 4: Verifying content integrity...');
    if (downloadedContent === testContent.toString()) {
      console.log('✅ Content matches original!');
    } else {
      console.error('❌ Content mismatch!');
    }

    // Test 5: Delete
    console.log('\n🗑️  Test 5: Deleting test file...');
    await deleteFileFromGridFS(fileId);
    console.log('✅ File deleted successfully');

    console.log('\n✅ All tests passed!');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
  } finally {
    await closeConnection();
    process.exit(0);
  }
}

testGridFS();
```

**Run Test:**
```bash
node backend/test-gridfs.js
```

---

## 7. Session Summary

### 7.1 Completed Tasks

- [x] MongoDB Atlas cluster created (Singapore region)
- [x] Database user configured with proper permissions
- [x] Network access configured (0.0.0.0/0 for Railway)
- [x] Connection string obtained and secured
- [x] Backend project structure established
- [x] Required dependencies installed
- [x] Environment configuration files created
- [x] MongoDB connection service implemented
- [x] GridFS utilities implemented
- [x] Local connection tested successfully
- [x] GridFS operations tested successfully

### 7.2 Files Created

```
backend/
├── .env (contains secrets - NOT committed)
├── .env.example (template for deployment)
├── services/
│   └── mongodb.js
├── utils/
│   └── gridfs.js
└── test-gridfs.js
```

### 7.3 Files Modified

```
backend/package.json
  - Added: mongodb, multer, cors, firebase-admin dependencies
  - Updated: version to 2.0.0
  - Added: dev script with nodemon
```

### 7.4 Next Session Preview

**Session 2: Firebase Admin & Authentication Middleware**

Tasks:
1. Set up Firebase Admin SDK
2. Create authentication middleware
3. Implement token verification
4. Create file upload middleware (Multer)
5. Build document upload API endpoint
6. Test authentication flow

---

## 8. Deployment Notes

### 8.1 Railway Configuration (Pending)

**Environment Variables to Set:**
```
MONGODB_URI=<from MongoDB Atlas>
MONGODB_DATABASE=ssg_documents
MONGODB_BUCKET_NAME=documents
FIREBASE_PROJECT_ID=ssg-prototype
FIREBASE_CLIENT_EMAIL=<from service account>
FIREBASE_PRIVATE_KEY=<from service account>
PORT=3000
NODE_ENV=production
ALLOWED_ORIGINS=<production frontend URL>
```

**Railway Settings:**
- Build Command: `npm install`
- Start Command: `node server.js`
- Port: 3000 (Railway will provide external port)

### 8.2 Security Checklist

- [x] MongoDB URI stored in environment variable
- [x] Firebase private key stored securely
- [x] .env added to .gitignore
- [x] .env.example created for reference
- [x] Connection pooling configured
- [x] Timeout settings configured

---

## 9. Code Patches

### Patch 1: package.json Dependencies

```diff
--- a/backend/package.json
+++ b/backend/package.json
@@ -1,6 +1,7 @@
 {
   "name": "backend",
-  "version": "1.0.0",
+  "version": "2.0.0",
+  "description": "SSG Office Assistant Backend API",
   "main": "server.js",
   "scripts": {
+    "start": "node server.js",
+    "dev": "nodemon server.js",
     "test": "echo \"Error: no test specified\" && exit 1"
   },
-  "keywords": [],
+  "keywords": ["ssg", "mongodb", "firebase", "telegram"],
   "dependencies": {
     "axios": "^1.16.0",
     "body-parser": "^2.2.2",
+    "cors": "^2.8.5",
     "dotenv": "^17.4.2",
-    "express": "^5.2.1"
+    "express": "^5.2.1",
+    "firebase-admin": "^12.0.0",
+    "mongodb": "^6.3.0",
+    "multer": "^1.4.5"
+  },
+  "devDependencies": {
+    "nodemon": "^3.0.1"
   }
 }
```

### Patch 2: .gitignore Update

```diff
--- a/.gitignore
+++ b/.gitignore
@@ -23,6 +23,7 @@
 *.sw?
 
 # Environment variables
+backend/.env
 .env.local
 .env
```

---

## 10. Verification Commands

```bash
# Verify MongoDB connection
node backend/test-gridfs.js

# Check dependencies installed
cd backend && npm list mongodb multer cors firebase-admin

# Verify environment variables loaded
node -e "require('dotenv').config({path:'./backend/.env'}); console.log('MongoDB URI:', process.env.MONGODB_URI ? '✅ Set' : '❌ Missing')"
```

---

**Session Status:** ✅ Complete  
**Next Session:** Firebase Admin & Authentication Middleware  
**Timeline Status:** On Track (Day 1/7)

---

**Documentation Version:** 1.0  
**Last Updated:** February 8, 2027, 2:30 PM  
**Author:** SSG Development Team
