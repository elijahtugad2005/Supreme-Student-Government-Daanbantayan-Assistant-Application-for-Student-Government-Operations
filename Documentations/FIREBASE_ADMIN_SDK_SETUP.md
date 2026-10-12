# Firebase Admin SDK Setup Guide

**Purpose:** Configure Firebase Admin SDK for backend authentication  
**Time Required:** 5 minutes  
**Project:** SSG Office Assistant

---

## 📋 What This Does

Firebase Admin SDK allows your backend to:
- ✅ Verify Firebase ID tokens from frontend
- ✅ Authenticate API requests
- ✅ Access Firestore from backend (if needed)

---

## 🚀 Quick Setup (3 Steps)

### Step 1: Download Service Account Key (2 min)

1. **Go to Firebase Console:**
   - Open: https://console.firebase.google.com/
   - Select project: **ssg-prototype**

2. **Navigate to Settings:**
   - Click ⚙️ (gear icon) in top-left
   - Click **"Project settings"**

3. **Go to Service Accounts:**
   - Click **"Service accounts"** tab
   - You'll see: "Firebase Admin SDK"

4. **Generate New Private Key:**
   - Scroll down to "Firebase Admin SDK" section
   - Click **"Generate new private key"** button
   - Click **"Generate key"** in confirmation modal
   - A JSON file will download: `ssg-prototype-firebase-adminsdk-xxxxx.json`

5. **Save the File:**
   - Move it to: `backend/firebase-service-account.json`
   - ⚠️ **NEVER commit this file to Git!**

### Step 2: Update Backend .env (1 min)

Open `backend/.env` and add:

```bash
# Firebase Admin SDK (Backend Authentication)
FIREBASE_PROJECT_ID=ssg-prototype
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@ssg-prototype.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n"
```

**How to get these values:**

1. Open `backend/firebase-service-account.json`
2. Copy the values:
   ```json
   {
     "project_id": "ssg-prototype",  ← FIREBASE_PROJECT_ID
     "client_email": "firebase-adminsdk-...@ssg-prototype.iam.gserviceaccount.com",  ← FIREBASE_CLIENT_EMAIL
     "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"  ← FIREBASE_PRIVATE_KEY
   }
   ```

**⚠️ Important:** Keep the `\n` newline characters in the private key!

### Step 3: Test Backend (2 min)

```bash
cd backend
node server.js
```

**Expected Output:**
```
🔥 Firebase Admin initialized
✅ Connected to MongoDB: ssg-documents-cluster
🚀 Server listening on port 3000
```

If you see "🔥 Firebase Admin initialized", you're done! ✅

---

## 🔒 Security Notes

### DO NOT Commit Service Account Key

Update `backend/.gitignore`:

```gitignore
# Firebase Admin SDK
firebase-service-account.json
.env
```

### Environment Variables (Railway)

For production deployment on Railway, add these as environment variables:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

Railway reads from `.env` file automatically.

---

## 🐛 Troubleshooting

### Problem 1: "Private key failed to parse"

**Cause:** Newline characters `\n` in private key were removed

**Solution:**
1. Re-copy private key from JSON file
2. Keep the `\n` characters (they're important)
3. Wrap entire key in quotes in `.env`

---

### Problem 2: "Permission denied"

**Cause:** Service account doesn't have permissions

**Solution:**
1. Go to Firebase Console → IAM & Admin
2. Find service account: `firebase-adminsdk-xxxxx@ssg-prototype.iam.gserviceaccount.com`
3. Should have role: "Firebase Admin SDK Administrator Service Agent"
4. If missing, add it

---

### Problem 3: "Service account file not found"

**Cause:** File path incorrect

**Solution:**
1. Verify file exists: `backend/firebase-service-account.json`
2. Check `backend/services/firebase-admin.js` line 9:
   ```javascript
   const serviceAccount = require('../firebase-service-account.json');
   ```

---

## ✅ Verification Checklist

- [ ] Service account JSON downloaded
- [ ] File saved as `backend/firebase-service-account.json`
- [ ] `.gitignore` includes `firebase-service-account.json`
- [ ] Backend `.env` has Firebase variables
- [ ] Backend starts without errors
- [ ] See "🔥 Firebase Admin initialized" in console

---

## 🔗 Next Steps

After Firebase Admin SDK is configured:
1. ✅ Complete MongoDB Atlas setup
2. ✅ Test document upload with authentication
3. ✅ Proceed to Session 4 (Migration Script)

---

**Need help?** See [MongoDB Atlas Setup Guide](./MONGODB_ATLAS_SETUP_GUIDE.md)
