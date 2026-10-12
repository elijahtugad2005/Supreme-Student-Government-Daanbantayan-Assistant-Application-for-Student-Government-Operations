# MongoDB AI Integration - Post-Implementation Checklist

**Project**: SSG Office Assistant  
**Date**: October 8, 2026  
**Purpose**: Verification steps after Cloud Functions MongoDB integration

---

## 🔧 Configuration Steps

### 1. Set MongoDB Connection String in Functions

**Location**: `functions/.env`

```bash
# Navigate to functions directory
cd functions

# Add MongoDB URI to .env file
# IMPORTANT: Use your actual MongoDB Atlas connection string
echo "MONGODB_URI=mongodb+srv://ssg-app-user:ssg2026@cluster0.khnh2od.mongodb.net/?appName=Cluster0" >> .env
```

**Verify**:
```bash
# Check the file contains the URI (without displaying the secret)
grep -q "MONGODB_URI=" .env && echo "✅ MongoDB URI configured" || echo "❌ MongoDB URI missing"
```

---

### 2. Install Dependencies

```bash
cd functions
npm install
```

**Expected Output**:
- `mongodb@6.16.0` should be installed
- No errors or warnings

**Verify**:
```bash
npm list mongodb
# Should show: mongodb@6.16.0
```

---

### 3. Validate Syntax

```bash
cd functions
npm run check
```

**Expected Output**:
- Exit code 0
- No syntax errors
- All files pass validation

---

## 🧪 Testing Procedure

### Test 1: Legacy Firebase Storage Document

**Objective**: Verify existing documents still work

**Steps**:
1. Open your app at `http://localhost:5173`
2. Login with your account
3. Navigate to Document Dashboard
4. Find an **existing** document (uploaded before MongoDB integration)
5. Click "Analyze with AI"
6. Wait for analysis to complete

**Expected Results**:
- ✅ Analysis completes successfully
- ✅ Document classification appears
- ✅ Extracted fields populate
- ✅ Summary generated
- ✅ No errors in browser console
- ✅ Functions logs show: `"fetchFile: using firebase backend"`

**Check Functions Logs**:
```bash
# If using emulator
firebase emulators:start --only functions

# Check logs in terminal
# Should see: "fetchFile: using firebase backend"
```

---

### Test 2: New MongoDB GridFS Document

**Objective**: Verify new documents work with MongoDB storage

**Prerequisites**:
- Backend server running on port 3000
- Frontend configured with `VITE_FILE_STORE=mongodb`

**Steps**:
1. In Document Dashboard, click "Upload Document"
2. Select a test PDF file (keep it small, <5MB for faster testing)
3. Fill in document details
4. Submit upload
5. Wait for upload confirmation
6. Click "Analyze with AI" on the newly uploaded document
7. Wait for analysis to complete

**Expected Results**:
- ✅ Upload succeeds
- ✅ Document appears in dashboard with MongoDB indicator
- ✅ Analysis completes successfully
- ✅ Document classification appears
- ✅ Extracted fields populate
- ✅ Summary generated
- ✅ Functions logs show: `"fetchFile: using mongodb backend"`

**Verify in MongoDB Atlas**:
1. Open MongoDB Atlas dashboard
2. Navigate to Collections → `ssg_documents`
3. Check `documents.files` collection
4. Find your uploaded document
5. Note the `_id` field

**Check Firestore**:
1. Open Firebase Console → Firestore
2. Find your document in `documents` collection
3. Verify fields:
   - `storageBackend: "mongodb"`
   - `mongoFileId: "<matches _id from Atlas>"`

---

### Test 3: Error Handling

**Objective**: Verify graceful error handling

**Test 3a: Missing MongoDB File**

**Steps**:
1. In Firestore, manually edit a document
2. Change `mongoFileId` to a fake ID: `"000000000000000000000000"`
3. Try to analyze that document

**Expected Results**:
- ❌ Analysis fails with clear error
- ✅ Error message mentions file not found in MongoDB
- ✅ No crashes or infinite loading
- ✅ User can dismiss error and try another document

**Test 3b: Invalid MongoDB Connection**

**Steps**:
1. Stop MongoDB connection temporarily (or set invalid MONGODB_URI)
2. Try to analyze a MongoDB document

**Expected Results**:
- ❌ Analysis fails with clear error
- ✅ Error message mentions connection issue
- ✅ Functions logs show connection error
- ✅ Firebase Storage documents still work

---

### Test 4: Performance Comparison

**Objective**: Compare fetch times between storage backends

**Steps**:
1. Analyze a Firebase Storage document
2. Note the time taken (check browser console timestamps)
3. Analyze a MongoDB GridFS document of similar size
4. Note the time taken

**Baseline Expectations**:
- Both should complete in <30 seconds
- MongoDB may be slightly slower due to Express backend hop
- AI processing time should be similar (same model)

---

## 📊 Verification Checklist

### Configuration
- [ ] `MONGODB_URI` added to `functions/.env`
- [ ] `mongodb@6.16.0` installed in `functions/node_modules`
- [ ] Syntax validation passes (`npm run check`)
- [ ] `.gitignore` protects `functions/.env`

### Files Created
- [ ] `functions/src/mongodb.js` exists
- [ ] `functions/src/DUAL_STORAGE.md` exists
- [ ] Both files use ES module syntax (import/export)

### Files Modified
- [ ] `functions/src/index.js` has updated `fetchFile()` function
- [ ] `functions/package.json` includes `mongodb` dependency
- [ ] `functions/.env.example` has `MONGODB_URI` placeholder
- [ ] `functions/.env` has `MONGODB_URI=` line

### Functional Tests
- [ ] **Test 1 Passed**: Legacy Firebase Storage documents work
- [ ] **Test 2 Passed**: New MongoDB GridFS documents work
- [ ] **Test 3a Passed**: Missing file error handled gracefully
- [ ] **Test 3b Passed**: Connection error handled gracefully
- [ ] **Test 4 Completed**: Performance is acceptable

### Logging & Monitoring
- [ ] Functions logs show storage backend being used
- [ ] Errors include helpful context (documentId, storageBackend)
- [ ] MongoDB Atlas shows file downloads in metrics
- [ ] Firebase Storage metrics show continued usage (legacy docs)

---

## 🚨 Troubleshooting

### Issue: "MONGODB_URI is not set"

**Solution**:
```bash
cd functions
echo "MONGODB_URI=mongodb+srv://ssg-app-user:ssg2026@cluster0.khnh2od.mongodb.net/?appName=Cluster0" >> .env
```

### Issue: "Cannot find module 'mongodb'"

**Solution**:
```bash
cd functions
npm install
```

### Issue: "File not found in GridFS"

**Possible Causes**:
1. Document's `mongoFileId` is incorrect
2. File was deleted from MongoDB
3. Wrong database name in connection string

**Check**:
```bash
# Verify MongoDB connection string includes correct database
# Should have: ?appName=Cluster0
```

### Issue: "Firebase Storage documents stopped working"

**Solution**:
This should never happen (backward compatibility guaranteed). If it does:
1. Check `fetchFile()` function in `functions/src/index.js`
2. Verify fallback logic: `const backend = doc.storageBackend || 'firebase';`
3. Check functions logs for errors

### Issue: Functions timeout (>60s)

**Possible Causes**:
1. Large file taking too long to download
2. Network latency to MongoDB Atlas
3. AI processing taking longer than expected

**Solutions**:
1. Increase function timeout in `functions/src/index.js`:
   ```javascript
   export const analyzeDocument = onCall(
     { 
       secrets: [GEMINI_API_KEY, OPENROUTER_API_KEY], 
       timeoutSeconds: 540,  // ← Increase from 300 to 540
       memory: '1GiB' 
     },
     async (request) => { ... }
   );
   ```
2. Test with smaller files first
3. Check MongoDB Atlas performance metrics

---

## 📞 Support

### Documentation References
- [MongoDB Integration Session 3](./MONGODB_INTEGRATION_SESSION_03.md)
- [Dual Storage Technical Guide](../functions/src/DUAL_STORAGE.md)
- [MongoDB Atlas Setup Guide](./MONGODB_ATLAS_SETUP_GUIDE.md)

### Log Files
- **Functions Logs**: Terminal where functions emulator is running
- **Backend Logs**: Terminal where backend server is running (port 3000)
- **Browser Console**: F12 → Console tab
- **MongoDB Atlas Logs**: Atlas Dashboard → Database → Monitoring

### Key Environment Variables
```bash
# Frontend (.env.local)
VITE_FILE_STORE=mongodb
VITE_MONGODB_BACKEND_URL=http://localhost:3000
VITE_USE_EMULATORS=false

# Backend (backend/.env)
MONGODB_URI=mongodb+srv://...
MONGODB_DATABASE=ssg_documents

# Functions (functions/.env)
MONGODB_URI=mongodb+srv://...
GEMINI_API_KEY=your_key_here
OPENROUTER_API_KEY=your_key_here
```

---

## ✅ Success Criteria

The migration is successful when:

1. ✅ All 4 test cases pass
2. ✅ Zero breaking changes to existing features
3. ✅ AI analysis works with both storage backends
4. ✅ Functions logs clearly show which backend is used
5. ✅ Error messages are clear and actionable
6. ✅ Performance is acceptable (<30s for typical documents)
7. ✅ Documentation is complete and accurate

---

**Last Updated**: October 8, 2026  
**Status**: Ready for post-implementation verification  
**Next Step**: Complete workflow implementation, then follow this checklist

