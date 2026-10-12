# MongoDB Integration - Session 3: Frontend Integration

**Status:** Ready to Start  
**Prerequisites:** Session 1 & 2 Complete (Backend infrastructure ready)  
**Target Completion:** Before Feb 10-15, 2027  
**Assigned To:** Next Agent

---

## 📋 Session Overview

Integrate MongoDB storage into the frontend React application by creating `mongoStore.js` and updating the document upload/download flows. This session focuses on **Document Dashboard only** - all other Firebase functionality remains unchanged.

---

## 🎯 Session Goals

1. Create `mongoStore.js` following existing fileStore pattern
2. Register MongoDB store in fileStore index
3. Update document service to support MongoDB uploads
4. Implement MongoDB download flow
5. Update Firestore document schema (add `mongoFileId`, `storageType`)
6. Test complete upload → download → delete flow
7. Document all changes in Session 3 markdown

---

## 📁 Files to Create

### 1. `src/services/fileStore/mongoStore.js`

**Purpose:** HTTP client for MongoDB backend API (follows `localStore.js` and `firebaseStore.js` pattern)

**Required Methods:**
```javascript
export const mongoStore = {
  name: 'mongodb',
  
  async put(path, file, onProgress) {
    // POST /api/documents/upload
    // Use FormData with multipart/form-data
    // Track upload progress with XMLHttpRequest or axios onUploadProgress
    // Return { fileId: <MongoDB ObjectId> }
  },
  
  async getUrl(fileId) {
    // Return download URL: `${BACKEND_URL}/api/documents/${fileId}/download`
    // Add Firebase ID token in Authorization header
  },
  
  async get(fileId) {
    // GET /api/documents/${fileId}/download
    // Return blob for download
  },
  
  async exists(fileId) {
    // GET /api/documents/${fileId}/metadata
    // Return true if status 200, false if 404
  },
  
  async delete(fileId) {
    // DELETE /api/documents/${fileId}
  },
  
  async list() {
    // Not implemented for MongoDB (Firestore holds the index)
    return [];
  },
  
  async usage() {
    // Not tracked client-side for MongoDB
    return { usedBytes: null, quotaBytes: null, count: null };
  },
  
  revokeAll() {
    // No object URLs to revoke
  }
};
```

**Implementation Details:**

```javascript
// src/services/fileStore/mongoStore.js

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
          const response = JSON.parse(xhr.responseText);
          resolve({ fileId: response.fileId });
        } else {
          const error = JSON.parse(xhr.responseText);
          reject(new Error(error.error || 'Upload failed'));
        }
      });
      
      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'));
      });
      
      xhr.open('POST', `${BACKEND_URL}/api/documents/upload`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
  },

  /**
   * Get download URL for a MongoDB file
   * @param {string} fileId - MongoDB ObjectId
   * @returns {Promise<string>} Download URL with auth token
   */
  async getUrl(fileId) {
    if (!fileId) return null;
    const token = await getAuthToken();
    // Include token in URL for simple anchor download links
    return `${BACKEND_URL}/api/documents/${fileId}/download?token=${token}`;
  },

  /**
   * Download file as Blob
   * @param {string} fileId - MongoDB ObjectId
   * @returns {Promise<Blob|null>}
   */
  async get(fileId) {
    if (!fileId) return null;
    
    try {
      const token = await getAuthToken();
      const response = await fetch(`${BACKEND_URL}/api/documents/${fileId}/download`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) return null;
      return await response.blob();
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
      const response = await fetch(`${BACKEND_URL}/api/documents/${fileId}/metadata`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  /**
   * Delete file from MongoDB GridFS
   * @param {string} fileId - MongoDB ObjectId
   */
  async delete(fileId) {
    if (!fileId) return;
    
    const token = await getAuthToken();
    const response = await fetch(`${BACKEND_URL}/api/documents/${fileId}/delete`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Delete failed');
    }
  },

  async list() {
    // MongoDB doesn't maintain a client-accessible file list
    // Firestore holds the document index
    return [];
  },

  async usage() {
    // Storage metrics tracked server-side
    return { usedBytes: null, quotaBytes: null, count: null };
  },

  revokeAll() {
    // No object URLs created, nothing to revoke
  }
};
```

---

### 2. Update `src/services/fileStore/index.js`

**Change:** Register MongoDB store

```javascript
// BEFORE:
import { firebaseStore } from './firebaseStore.js';
import { localStore } from './localStore.js';

export const STORES = { local: localStore, firebase: firebaseStore };

// AFTER:
import { firebaseStore } from './firebaseStore.js';
import { localStore } from './localStore.js';
import { mongoStore } from './mongoStore.js';

export const STORES = { 
  local: localStore, 
  firebase: firebaseStore,
  mongodb: mongoStore 
};

// ... rest of file unchanged
```

---

### 3. Update `src/services/documentService.js`

**Changes Required:**

#### A. Update `uploadDocument()` function

**Current flow:** `file → fileStore.put(path, file) → returns { path }`

**New MongoDB flow:** `file → mongoStore.put(null, file) → returns { fileId }`

**Implementation:**

```javascript
// Around line 155 in uploadDocument()

export const uploadDocument = async ({ file, metadata, actor, onProgress }) => {
  const check = validateFile(file);
  if (!check.ok) throw new Error(check.message);
  if (!metadata?.title?.trim()) throw new Error('A title is required.');

  const documentRef = doc(collection(db, DOCUMENTS));
  const documentId = documentRef.id;
  
  // NEW: Check which store is active
  const storageType = fileStore.name; // 'local', 'firebase', or 'mongodb'
  
  let storagePath = null;
  let mongoFileId = null;
  
  try {
    if (storageType === 'mongodb') {
      // MongoDB upload returns { fileId }
      const result = await fileStore.put(null, file, onProgress);
      mongoFileId = result.fileId;
    } else {
      // Local/Firebase upload uses path-based storage
      const path = buildPath(documentId, file.name);
      await fileStore.put(path, file, onProgress);
      storagePath = path;
    }
  } catch (error) {
    throw describeUploadFailure(error, file.name);
  }

  onProgress?.(100);

  // Write Firestore metadata
  try {
    await setDoc(documentRef, {
      title: metadata.title.trim(),
      documentNumber: metadata.documentNumber?.trim() || '',
      status: metadata.status || DOC_STATUS.DRAFT,
      documentDate: metadata.documentDate || '',
      office: metadata.office?.trim() || '',
      labels: Array.isArray(metadata.labels) ? metadata.labels : [],
      keywords: Array.isArray(metadata.keywords) ? metadata.keywords : [],

      // NEW: Storage type and identifier
      storageType,                    // 'local' | 'firebase' | 'mongodb'
      storagePath,                    // For local/firebase (legacy)
      mongoFileId,                    // For mongodb (new)
      
      originalFileName: file.name,
      mimeType: mimeFor(file.name),
      fileSize: file.size,

      createdBy: actor?.uid || null,
      createdByName: actor?.name || 'Unknown',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actor?.uid || null,

      extractedText: null,
      summary: null,
      aiConfidence: null,
      aiProcessedAt: null,
      aiState: 'not_processed',
    });
  } catch (error) {
    // Rollback: delete uploaded file
    if (storageType === 'mongodb' && mongoFileId) {
      await fileStore.delete(mongoFileId).catch(() => {});
    } else if (storagePath) {
      await fileStore.delete(storagePath).catch(() => {});
    }
    throw new Error(`Could not save the document record: ${error.message}`);
  }

  return documentId;
};
```

#### B. Update `getDocumentUrl()` function

```javascript
// Around line 240
export const getDocumentUrl = async (document) => {
  if (!document) return null;
  
  // NEW: Handle MongoDB storage
  if (document.storageType === 'mongodb' && document.mongoFileId) {
    return fileStore.getUrl(document.mongoFileId);
  }
  
  // Legacy: path-based storage (local/firebase)
  if (document.storagePath) {
    return fileStore.getUrl(document.storagePath);
  }
  
  return null;
};
```

#### C. Update `deleteDocument()` function

```javascript
// Around line 260
export const deleteDocument = async (documentId) => {
  const ref = doc(db, DOCUMENTS, documentId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) return;
  
  const document = snapshot.data();

  // NEW: Handle MongoDB storage
  if (document.storageType === 'mongodb' && document.mongoFileId) {
    await fileStore.delete(document.mongoFileId);
  }
  // Legacy: path-based storage
  else if (document.storagePath) {
    await fileStore.delete(document.storagePath);
  }
  
  await deleteDoc(ref);
};
```

---

## 📝 Files to Modify

| File | Changes | Lines Affected |
|------|---------|----------------|
| `src/services/fileStore/index.js` | Add mongoStore import and registration | ~5 lines |
| `src/services/documentService.js` | Update upload/download/delete logic | ~50 lines |
| `.env.example` | Add `VITE_MONGODB_BACKEND_URL` | 1 line |
| `.env.local` | Add `VITE_MONGODB_BACKEND_URL=http://localhost:3000` | 1 line |

---

## ⚙️ Environment Variables

Add to **`.env.example`** and **`.env.local`**:

```bash
# MongoDB Backend API (Session 3)
VITE_MONGODB_BACKEND_URL=http://localhost:3000
```

**For Railway deployment (Session 5):**
```bash
VITE_MONGODB_BACKEND_URL=https://your-railway-backend.railway.app
```

---

## 🧪 Testing Checklist

### 1. Backend Health Check
```bash
# Ensure backend is running
cd backend
node server.js

# Should see:
# "🔥 Firebase Admin initialized"
# "✅ Connected to MongoDB"
# "🚀 Server listening on port 3000"
```

### 2. Switch to MongoDB Store

**Update `.env.local`:**
```bash
VITE_FILE_STORE=mongodb
VITE_MONGODB_BACKEND_URL=http://localhost:3000
```

**Restart Vite dev server:**
```bash
npm run dev
```

### 3. Upload Flow Test

1. Open Document Dashboard
2. Click "Upload Document"
3. Fill form (title, document number, status, etc.)
4. Choose file (PDF/DOCX/XLSX)
5. Click "Upload"

**Expected:**
- Progress bar shows 0% → 100%
- Console: `POST http://localhost:3000/api/documents/upload` → 200
- Document appears in dashboard
- Firestore document has:
  - `storageType: "mongodb"`
  - `mongoFileId: "507f1f77bcf86cd799439011"` (ObjectId)
  - `storagePath: null`

### 4. Download Flow Test

1. Click document from list
2. Click "Download" button

**Expected:**
- Console: `GET http://localhost:3000/api/documents/{fileId}/download` → 200
- File downloads with correct name
- Content matches original upload

### 5. Delete Flow Test

1. Click "Delete" on a document
2. Confirm deletion

**Expected:**
- Console: `DELETE http://localhost:3000/api/documents/{fileId}` → 200
- Document removed from dashboard
- File removed from MongoDB GridFS
- Firestore document deleted

### 6. Authentication Test

1. Sign out
2. Try to access Document Dashboard

**Expected:**
- API calls fail with 401 Unauthorized
- User redirected to login

### 7. Error Handling Tests

**Test A: Upload without auth token**
- Remove Firebase token
- Attempt upload
- Should show: "User must be signed in to upload documents"

**Test B: Upload oversized file**
- Upload file > 50MB
- Should show: "File is X MB. The limit is 50 MB."

**Test C: Backend unreachable**
- Stop backend server
- Attempt upload
- Should show: "Network error during upload"

---

## 🐛 Known Issues & Solutions

### Issue 1: CORS Errors

**Symptom:** `Access to XMLHttpRequest at 'http://localhost:3000' from origin 'http://localhost:5173' has been blocked by CORS`

**Solution:** Backend already has CORS configured in `backend/server.js`:
```javascript
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || 'http://localhost:5173',
  credentials: true
}));
```

Verify `backend/.env` has:
```bash
ALLOWED_ORIGINS=http://localhost:5173
```

### Issue 2: Firebase Auth Token Expired

**Symptom:** API returns 401 after long idle period

**Solution:** `mongoStore.js` already calls `getIdToken()` which auto-refreshes

### Issue 3: Progress Bar Stuck at 99%

**Symptom:** Upload completes but progress stays at 99%

**Solution:** Ensure `onProgress?.(100)` is called in both success and error handlers

---

## 📊 Firestore Schema Changes

### Document Collection Schema

**Before (Session 1-2):**
```javascript
{
  id: "abc123",
  title: "Resolution 2024-001",
  storagePath: "documents/abc123/resolution.pdf",
  originalFileName: "resolution.pdf",
  mimeType: "application/pdf",
  fileSize: 1048576,
  // ... other fields
}
```

**After (Session 3):**
```javascript
{
  id: "abc123",
  title: "Resolution 2024-001",
  
  // NEW FIELDS
  storageType: "mongodb",                      // 'local' | 'firebase' | 'mongodb'
  mongoFileId: "507f1f77bcf86cd799439011",     // MongoDB ObjectId (when storageType='mongodb')
  storagePath: null,                            // null for MongoDB, path for local/firebase
  
  originalFileName: "resolution.pdf",
  mimeType: "application/pdf",
  fileSize: 1048576,
  // ... other fields unchanged
}
```

---

## 📚 Code References

### Existing Patterns to Follow

**1. LocalStore Pattern** (`src/services/fileStore/localStore.js`)
- Implements full interface (put, get, getUrl, exists, delete, list, usage, revokeAll)
- Uses promises consistently
- Handles errors gracefully

**2. FirebaseStore Pattern** (`src/services/fileStore/firebaseStore.js`)
- Uses async/await
- Returns null on errors (doesn't throw for missing files)
- Short, focused methods

**3. DocumentService Pattern** (`src/services/documentService.js`)
- Validates before uploading
- Atomic operations (file + metadata together)
- Rollback on failure
- Progress reporting 0-100

---

## 🎨 UI Considerations

### Storage Indicator

**Optional Enhancement:** Show storage type in Document Dashboard

```javascript
// In DocumentDashboard.jsx or DocumentCard component
const storageIcon = {
  local: '💾 Local',
  firebase: '☁️ Firebase',
  mongodb: '🍃 MongoDB'
};

<span className="storage-badge">
  {storageIcon[document.storageType] || '❓ Unknown'}
</span>
```

---

## 📖 Documentation Requirements

After completing implementation, create:

### `Documentations/MONGODB_INTEGRATION_SESSION_03.md`

**Required Sections:**
1. **Session Overview** - What was implemented
2. **Files Created** - List with purposes
3. **Files Modified** - Diffs/patches for each change
4. **API Integration** - How frontend calls backend
5. **Testing Results** - Evidence of successful upload/download/delete
6. **Known Issues** - Any bugs or limitations discovered
7. **Next Steps** - Handoff to Session 4 (migration script)

**Template:**
```markdown
# MongoDB Integration - Session 3: Frontend Integration

## Session Summary
Completed: [Date]
Duration: [Time]
Status: ✅ Complete

## Implementation Details

### 1. Files Created
- `src/services/fileStore/mongoStore.js` (120 lines)

### 2. Files Modified
- `src/services/fileStore/index.js` (+3 lines)
- `src/services/documentService.js` (+45 lines, modified 3 functions)

### 3. Code Patches

[Include full diffs here]

### 4. Testing Evidence

[Screenshots or console logs showing:]
- Successful upload with progress
- Document in Firestore with mongoFileId
- Successful download
- Successful delete

### 5. Known Issues
[List any problems]

### 6. Handoff to Session 4
[What the next agent needs to know]
```

---

## 🚀 Session 4 Preview

**Next Tasks (Migration Script):**
1. Create `scripts/migrate-to-mongodb.mjs`
2. Query all documents with `storageType: 'firebase'` or `storageType: 'local'`
3. Download from Firebase Storage
4. Upload to MongoDB via backend API
5. Update Firestore metadata (set `mongoFileId`, change `storageType`)
6. Optionally delete old Firebase files
7. Generate migration report

**Key Decision for Session 4:** Should we keep Firebase files as backup during migration?

---

## 📞 Support & References

**Backend API Reference:** `Documentations/MONGODB_INTEGRATION_SESSION_02.md`

**API Endpoints:**
- Upload: `POST /api/documents/upload`
- Download: `GET /api/documents/:fileId/download`
- Metadata: `GET /api/documents/:fileId/metadata`
- Delete: `DELETE /api/documents/:fileId`
- Health: `GET /health`

**Architecture Diagram:** `Documentations/MONGODB_ARCHITECTURE_DIAGRAM.drawio`

---

## ✅ Session Completion Criteria

- [ ] `mongoStore.js` created with all methods implemented
- [ ] MongoDB store registered in fileStore index
- [ ] `uploadDocument()` updated to handle MongoDB
- [ ] `getDocumentUrl()` updated to handle MongoDB
- [ ] `deleteDocument()` updated to handle MongoDB
- [ ] Environment variables added to `.env.example` and `.env.local`
- [ ] Upload test passes (file appears in MongoDB + Firestore)
- [ ] Download test passes (file downloads correctly)
- [ ] Delete test passes (file removed from MongoDB + Firestore)
- [ ] Authentication works (401 when not signed in)
- [ ] Error handling works (oversized files rejected, network errors caught)
- [ ] Full session documentation created (`MONGODB_INTEGRATION_SESSION_03.md`)
- [ ] Code changes documented as patches

---

## 🎯 Success Metrics

**Functional:**
- ✅ Users can upload documents to MongoDB from Document Dashboard
- ✅ Users can download documents from MongoDB
- ✅ Users can delete documents from MongoDB
- ✅ Upload progress shows real-time percentage
- ✅ All operations require Firebase authentication

**Technical:**
- ✅ No code duplication (follows existing fileStore pattern)
- ✅ Backward compatible (local/firebase stores still work)
- ✅ Proper error handling (network failures, auth errors)
- ✅ Clean rollback on failure (no orphaned files)

**Documentation:**
- ✅ Complete Session 3 markdown created
- ✅ All code changes documented as patches
- ✅ Testing results included with evidence

---

**Ready to Start:** Yes ✅  
**Blocked By:** None (Sessions 1 & 2 complete, backend ready)  
**Estimated Time:** 2-3 hours  
**Complexity:** Medium

---

*End of Session 3 Task Document*
