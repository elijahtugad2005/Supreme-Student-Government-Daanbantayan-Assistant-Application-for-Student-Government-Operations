# Dual Storage Backend System

The AI document analysis functions support fetching files from two storage backends:
- **Firebase Storage** (default, legacy)
- **MongoDB GridFS** (new, for documents uploaded via the backend API)

This document explains how the system works and how to configure it.

---

## How It Works

When a document is analyzed, the `fetchFile()` function checks the Firestore document's `storageBackend` field:

```javascript
const fetchFile = async (doc) => {
  const backend = doc?.storageBackend || 'firebase';
  
  if (backend === 'mongodb') {
    // Fetch from MongoDB GridFS using doc.mongoFileId
  }
  
  // Otherwise, fetch from Firebase Storage using doc.storagePath
};
```

The `storageBackend` field is set by the upload service when a document is created. Cloud Functions **only read** this field — they never write it.

---

## Firestore Document Structure

### MongoDB Backend Document

```javascript
{
  id: "abc123",
  title: "Sample Document",
  storageBackend: "mongodb",           // tells Cloud Functions where to fetch
  mongoFileId: "507f1f77bcf86cd799439011",  // ObjectId from GridFS
  mimeType: "application/pdf",
  originalFileName: "sample.pdf",
  // ... other fields
}
```

### Firebase Backend Document (Legacy)

```javascript
{
  id: "xyz789",
  title: "Legacy Document",
  storageBackend: "firebase",          // or omitted (defaults to firebase)
  storagePath: "documents/xyz789.pdf", // path in Firebase Storage bucket
  mimeType: "application/pdf",
  originalFileName: "legacy.pdf",
  // ... other fields
}
```

---

## Configuration

### Local Development

1. **Copy the example environment file:**
   ```bash
   cp functions/.env.example functions/.env
   ```

2. **Add your MongoDB connection string to `functions/.env`:**
   ```env
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority
   ```

3. **Start the emulator:**
   ```bash
   npm run emulators
   ```

### Production Deployment

For security, use Firebase's managed secrets instead of committing the connection string:

```bash
firebase functions:secrets:set MONGODB_URI
# Paste your MongoDB Atlas connection string when prompted

firebase deploy --only functions
```

To update the secret later:
```bash
firebase functions:secrets:access MONGODB_URI  # view current value
firebase functions:secrets:set MONGODB_URI     # overwrite with new value
```

---

## Backend Selection

Documents choose their storage backend at **upload time**:

- **Frontend uploads** (via Firebase Storage rules) → `storageBackend: "firebase"` or omitted
- **Backend API uploads** (via `/api/documents` endpoint) → `storageBackend: "mongodb"`

Cloud Functions respect this choice and fetch from the appropriate backend automatically.

---

## Backward Compatibility

- If `storageBackend` is missing, undefined, or falsy, the system defaults to **Firebase Storage**
- All existing documents without a `storageBackend` field continue to work
- The system can handle a mix of both backends in the same Firestore collection

---

## Connection Handling

Cloud Functions are **stateless** — each invocation may run in a fresh container. The MongoDB client is created and closed for each fetch:

```javascript
export async function fetchFromGridFS(mongoFileId, mongoUri) {
  const client = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 30000,
  });
  
  try {
    await client.connect();
    // ... fetch file
  } finally {
    await client.close();  // always clean up
  }
}
```

This prevents connection leaks but means each fetch opens a new connection. For high-throughput workloads, consider connection pooling via a proxy like MongoDB Atlas or a connection pool service.

---

## Error Handling

The system provides clear error messages for configuration and runtime issues:

| Error | Cause | Fix |
|-------|-------|-----|
| `MONGODB_NOT_CONFIGURED` | `MONGODB_URI` not set in functions environment | Add the connection string to `functions/.env` (local) or set the secret (production) |
| `GRIDFS_NO_FILE_ID` | Document has `storageBackend: "mongodb"` but no `mongoFileId` | Check the upload service — it should set `mongoFileId` when saving to GridFS |
| `GRIDFS_INVALID_ID` | `mongoFileId` is not a valid MongoDB ObjectId | Verify the ID format (24-character hex string) |
| `GRIDFS_FILE_NOT_FOUND` | File with that ObjectId doesn't exist in GridFS | The file may have been deleted, or the ID is wrong |

All errors are mapped to `HttpsError` types that the client can handle gracefully.

---

## Bucket Configuration

MongoDB GridFS organizes files into "buckets" (like namespaces). The bucket name defaults to `documents` but can be overridden:

**In `functions/src/mongodb.js`:**
```javascript
const bucketName = process.env.MONGODB_BUCKET_NAME || 'documents';
const bucket = new GridFSBucket(db, { bucketName });
```

**To use a different bucket**, add to `functions/.env`:
```env
MONGODB_BUCKET_NAME=my_custom_bucket
```

The bucket name must match the one used by the backend upload service (see `backend/utils/gridfs.js`).

---

## File Metadata

GridFS stores file metadata in the `<bucket>.files` collection. The `fetchFromGridFS` function reads:

- **`metadata.mimeType`** or **`contentType`** → returned as `mimeType`
- **`filename`** or **`metadata.originalName`** → returned as `name`

This matches the shape expected by `fetchFile()` and `resolveFile()`.

---

## Troubleshooting

### "Port 3000 is already in use"
The backend server is running. Stop it before starting the functions emulator, or use a different port.

### "Could not reach the AI service"
- Check that `GEMINI_API_KEY` or `OPENROUTER_API_KEY` is set in `functions/.env`
- Verify the emulator is running: `npm run emulators`
- Check the emulator logs for errors

### "MongoDB is not configured for Cloud Functions"
- Local: Ensure `MONGODB_URI` is set in `functions/.env`
- Production: Run `firebase functions:secrets:set MONGODB_URI`

### Files not appearing in analysis
- Check the document's `storageBackend` field in Firestore
- Verify the `mongoFileId` or `storagePath` matches the actual stored file
- Check Cloud Function logs for fetch errors

---

## Testing the Dual-Storage System

1. **Upload a document via the backend API:**
   ```bash
   curl -X POST http://localhost:3000/api/documents \
     -F "file=@sample.pdf" \
     -F "title=Test Document"
   ```
   This creates a document with `storageBackend: "mongodb"`.

2. **Trigger AI analysis:**
   - Open the document in the web app
   - Click "Analyze with AI"
   - Check the function logs for:
     ```
     fetchFile: using mongodb backend { documentId: '...', mongoFileId: '...' }
     ```

3. **Upload via frontend (Firebase Storage):**
   - Use the web app's upload form
   - The document will have `storageBackend: "firebase"` or no backend field
   - Analysis should fetch from Firebase Storage

---

## Related Files

- **`functions/src/mongodb.js`** — GridFS fetch implementation
- **`functions/src/index.js`** — `fetchFile()` and AI analysis functions
- **`backend/utils/gridfs.js`** — Backend GridFS utilities (CommonJS)
- **`backend/services/mongodb.js`** — MongoDB connection management

---

## Security Notes

- Never commit `functions/.env` or `backend/.env` — both are in `.gitignore`
- Never include MongoDB connection strings in code, logs, or responses
- Use Firebase managed secrets in production: `firebase functions:secrets:set MONGODB_URI`
- The Firebase Admin SDK service account JSON is also secret and must never be committed

---

*Last updated: Implementation of MongoDB GridFS dual-storage support*
