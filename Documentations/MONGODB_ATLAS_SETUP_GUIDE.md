# MongoDB Atlas Setup Guide - Complete Walkthrough

**Target:** Set up MongoDB Atlas for SSG Office Assistant Document Storage  
**Region:** Singapore (ap-southeast-1)  
**Tier:** M0 Free Cluster  
**Estimated Time:** 15-20 minutes

---

## 📋 Prerequisites

- [ ] Email account for MongoDB Atlas registration
- [ ] Internet connection
- [ ] Browser (Chrome, Firefox, Edge recommended)

---

## 🎯 What You'll Get

By the end of this guide:
- ✅ MongoDB Atlas account created
- ✅ Free M0 cluster running in Singapore
- ✅ Database user created
- ✅ Network access configured
- ✅ Connection string obtained
- ✅ Ready to integrate with your backend

---

## 📖 Table of Contents

1. [Create MongoDB Atlas Account](#step-1-create-mongodb-atlas-account)
2. [Create a Free Cluster](#step-2-create-a-free-cluster)
3. [Create Database User](#step-3-create-database-user)
4. [Configure Network Access](#step-4-configure-network-access)
5. [Get Connection String](#step-5-get-connection-string)
6. [Test Connection](#step-6-test-connection)
7. [Configure Backend](#step-7-configure-backend)
8. [Verify Setup](#step-8-verify-setup)
9. [Troubleshooting](#troubleshooting)

---

## Step 1: Create MongoDB Atlas Account

### 1.1 Navigate to MongoDB Atlas

1. Open your browser
2. Go to: **https://www.mongodb.com/cloud/atlas/register**
3. You'll see the registration page

### 1.2 Sign Up

**Option A: Email Registration**
1. Enter your email address
2. Enter first name and last name
3. Create a strong password (min 8 characters)
4. Check "I agree to the Terms of Service and Privacy Policy"
5. Click **"Sign Up"**

**Option B: Google Sign-In** (Recommended - Faster)
1. Click **"Sign up with Google"**
2. Select your Google account
3. Authorize MongoDB Atlas

### 1.3 Verify Email (Email Registration Only)

1. Check your email inbox
2. Open email from MongoDB Atlas
3. Click **"Verify Email"** button
4. You'll be redirected back to Atlas

### 1.4 Complete Profile (If Required)

Atlas may ask you to complete your profile:
- **Organization Name:** CTU-Danao SSG (or leave as personal)
- **Project Name:** SSG Office Assistant
- **Primary Goal:** "Build a new application"
- **Preferred Language:** JavaScript
- Click **"Finish"**

---

## Step 2: Create a Free Cluster

### 2.1 Start Cluster Creation

After login, you'll see the welcome screen:
1. Click **"Build a Database"** (big green button)
   - OR click **"Create"** if you see that instead
   - OR navigate to **Databases** in left sidebar → **"Create Database"**

### 2.2 Choose Deployment Type

You'll see three options:
- **Serverless** (Pay as you go)
- **Dedicated** (Paid high-performance)
- **Shared** (Free tier) ← **CHOOSE THIS**

1. Find the **"Shared"** option
2. Click **"Create"** under it
3. You'll see "M0 Sandbox - Free Forever"

### 2.3 Select Cloud Provider

**Provider Options:**
- AWS
- Google Cloud
- Azure

**Recommendation:** Choose **AWS** (most common, well-supported)

1. Click **"AWS"** if not already selected

### 2.4 Select Region

**IMPORTANT:** Must be Singapore for your project

1. Scroll through the region list
2. Find **"Singapore (ap-southeast-1)"**
3. Click on it to select
4. Verify the FREE TIER badge is visible

**Region Code:** `ap-southeast-1`

### 2.5 Configure Cluster

**Cluster Name:**
- Default: "Cluster0"
- **Recommended:** Change to `ssg-documents-cluster`

How to change:
1. Scroll down to "Cluster Name"
2. Click on the input field
3. Type: `ssg-documents-cluster`

**Other Settings:**
- Cluster Tier: M0 Sandbox (FREE) - Leave as is
- MongoDB Version: 7.0 or latest - Leave as is
- Backup: Not available on M0 - That's fine

### 2.6 Create Cluster

1. Review your selections:
   - Provider: AWS
   - Region: Singapore (ap-southeast-1)
   - Cluster Name: ssg-documents-cluster
   - Tier: M0 (FREE)

2. Click **"Create"** button at the bottom

3. **Wait 3-5 minutes** for cluster provisioning
   - You'll see a progress indicator
   - "Creating your cluster..."
   - Don't close the browser

---

## Step 3: Create Database User

While the cluster is creating, Atlas will guide you through security setup.

### 3.1 Security Quickstart (Appears Automatically)

You'll see a modal: **"Security Quickstart"**

### 3.2 Authentication Method

Choose **"Username and Password"** (default)

### 3.3 Create User Credentials

**Username:**
- Enter: `ssg_app_user`
- This will be used by your backend to connect

**Password:**
1. Click **"Autogenerate Secure Password"** (recommended)
   - OR create your own strong password
   - Must be at least 8 characters
   - Avoid special characters that need URL encoding (`, ?, @, /, :, #, [, ], &, =, +, $, ,, ;, <, >, ", `, {, }, |, ^, \, ~`)

2. **CRITICAL:** Copy the password immediately!
   ```
   Example: KzP9mN3xQwR2tY8v
   ```

3. **SAVE THIS PASSWORD** - You'll need it for the connection string
   - Paste it in a text file
   - OR write it down securely
   - You CANNOT retrieve it later

### 3.4 User Privileges

Leave as **"Atlas admin"** (default)
- This gives read/write access to all databases

### 3.5 Create User

1. Click **"Create User"** button
2. User will be created: `ssg_app_user`

---

## Step 4: Configure Network Access

Still in the Security Quickstart modal.

### 4.1 Connection Method

After creating the user, you'll see:
**"Where would you like to connect from?"**

### 4.2 Add IP Address

**Option 1: Allow Access from Anywhere** (Recommended for Railway)

1. Click **"Add My Current IP Address"** first (optional, for testing)
2. Then click **"Add a Different IP Address"**
3. In the popup:
   - **IP Address:** `0.0.0.0/0`
   - **Description:** `Allow from anywhere (Railway deployment)`
4. Click **"Add Entry"**

**Why 0.0.0.0/0?**
- Railway (your deployment platform) uses dynamic IPs
- This allows access from any IP
- Security is handled by authentication (username + password)

**Option 2: Just Your IP (Testing Only)**

1. Click **"Add My Current IP Address"**
2. Your IP will be auto-detected and added
3. Click **"Add Entry"**

**⚠️ Note:** If using Option 2, you'll need to add `0.0.0.0/0` later for Railway deployment

### 4.3 Finish Security Setup

1. Click **"Finish and Close"** button
2. Modal will close
3. You'll see your cluster dashboard

---

## Step 5: Get Connection String

### 5.1 Navigate to Connect

1. Wait for cluster status to show **"Active"** (green dot)
2. Click **"Connect"** button next to your cluster name
3. You'll see "Connect to ssg-documents-cluster" modal

### 5.2 Choose Connection Method

You'll see three options:
- Shell
- **Drivers** ← **CHOOSE THIS**
- MongoDB Compass

1. Click **"Drivers"**

### 5.3 Select Driver and Version

1. **Driver:** Select **"Node.js"**
2. **Version:** Select **"5.5 or later"** (or latest shown)

### 5.4 Copy Connection String

You'll see a connection string like this:

```
mongodb+srv://ssg_app_user:<password>@ssg-documents-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=ssg-documents-cluster
```

**DO THIS:**

1. Click the **"Copy"** icon next to the connection string
2. Paste it into a text editor
3. **REPLACE** `<password>` with your actual password from Step 3.3

**Example:**
```
Before:
mongodb+srv://ssg_app_user:<password>@ssg-documents-cluster.xxxxx.mongodb.net/...

After:
mongodb+srv://ssg_app_user:KzP9mN3xQwR2tY8v@ssg-documents-cluster.xxxxx.mongodb.net/...
```

### 5.5 Add Database Name

Add the database name to the connection string:

**Change from:**
```
mongodb+srv://ssg_app_user:KzP9mN3xQwR2tY8v@ssg-documents-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

**Change to:**
```
mongodb+srv://ssg_app_user:KzP9mN3xQwR2tY8v@ssg-documents-cluster.xxxxx.mongodb.net/ssg_documents?retryWrites=true&w=majority
```

**What changed:** Added `/ssg_documents` after `.mongodb.net`

### 5.6 Save Your Connection String

Save this final connection string - you'll use it in your backend `.env` file.

---

## Step 6: Test Connection

Let's verify MongoDB is working before integrating.

### 6.1 Using MongoDB Compass (Recommended)

**Download Compass:**
1. Go to: https://www.mongodb.com/try/download/compass
2. Download for Windows
3. Install and open

**Connect:**
1. Open MongoDB Compass
2. Paste your connection string in "New Connection"
3. Click **"Connect"**
4. You should see:
   - Left sidebar: `ssg-documents-cluster`
   - Databases: `admin`, `local`, `ssg_documents` (will be created on first write)

### 6.2 Using Backend Test Script

**Option A: Quick Node.js Test**

Create `backend/test-mongodb-connection.js`:

```javascript
const { MongoClient } = require('mongodb');

const uri = "YOUR_CONNECTION_STRING_HERE"; // Paste your connection string
const client = new MongoClient(uri);

async function testConnection() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas!");
    
    const db = client.db('ssg_documents');
    const collections = await db.listCollections().toArray();
    console.log("📁 Collections:", collections);
    
    await client.close();
  } catch (error) {
    console.error("❌ Connection failed:", error.message);
  }
}

testConnection();
```

**Run:**
```bash
cd backend
node test-mongodb-connection.js
```

**Expected Output:**
```
✅ Connected to MongoDB Atlas!
📁 Collections: []
```

---

## Step 7: Configure Backend

Now integrate MongoDB with your backend.

### 7.1 Update `backend/.env`

Open `backend/.env` (create if doesn't exist):

```bash
# MongoDB Configuration (Add these)
MONGODB_URI=mongodb+srv://ssg_app_user:YOUR_PASSWORD@ssg-documents-cluster.xxxxx.mongodb.net/ssg_documents?retryWrites=true&w=majority
MONGODB_DATABASE=ssg_documents
MONGODB_BUCKET_NAME=documents

# Existing variables...
PORT=3000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173
MAX_FILE_SIZE_MB=50
```

**Replace:**
- `YOUR_PASSWORD` with your actual password
- `.xxxxx.` with your actual cluster ID

### 7.2 Update `backend/.env.example`

Update the example file for reference:

```bash
# MongoDB Configuration
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>?retryWrites=true&w=majority
MONGODB_DATABASE=ssg_documents
MONGODB_BUCKET_NAME=documents
```

### 7.3 Verify Backend Files Exist

Check these files from Session 1 & 2:
- ✅ `backend/services/mongodb.js`
- ✅ `backend/utils/gridfs.js`
- ✅ `backend/routes/documents.js`
- ✅ `backend/middleware/auth.js`
- ✅ `backend/server.js`

If missing, they were created in Session 1 & 2.

---

## Step 8: Verify Setup

### 8.1 Install Backend Dependencies

```bash
cd backend
npm install mongodb multer cors firebase-admin
```

**Expected Output:**
```
added 4 packages, and audited 150 packages in 5s
```

### 8.2 Start Backend Server

```bash
node server.js
```

**Expected Output:**
```
🔥 Firebase Admin initialized
✅ Connected to MongoDB: ssg-documents-cluster
🚀 Server listening on port 3000
```

**If you see this, MongoDB is working!** 🎉

### 8.3 Test GridFS Upload

Run the GridFS test script:

```bash
node test-gridfs.js
```

**Expected Output:**
```
Testing GridFS operations...

1. Uploading test file...
✅ Upload complete: {fileId}

2. Downloading file...
✅ Download complete: 1234 bytes

3. Fetching metadata...
✅ Metadata: {filename, length, uploadDate}

4. Deleting file...
✅ File deleted

All GridFS operations successful!
```

### 8.4 Verify in MongoDB Atlas Dashboard

1. Go back to MongoDB Atlas
2. Click **"Browse Collections"** on your cluster
3. You should see:
   - Database: `ssg_documents`
   - Collections: `documents.files`, `documents.chunks`
   - These are GridFS system collections

---

## 🎉 Setup Complete!

Your MongoDB Atlas is now ready for use!

### What You Have

✅ MongoDB Atlas account  
✅ Free M0 cluster in Singapore  
✅ Database: `ssg_documents`  
✅ User: `ssg_app_user` with password  
✅ Network access configured (0.0.0.0/0)  
✅ Connection string saved  
✅ Backend connected successfully  
✅ GridFS tested and working

---

## 🚀 Next Steps

### 1. Update Frontend Environment

Update `frontend/.env.local`:

```bash
VITE_FILE_STORE=mongodb
VITE_MONGODB_BACKEND_URL=http://localhost:3000
```

### 2. Start Frontend

```bash
npm run dev
```

### 3. Test Document Upload

1. Navigate to Document Dashboard
2. Click "Upload Document"
3. Fill form and upload a file
4. Check MongoDB Atlas → Browse Collections
5. You should see the file in `documents.files`!

---

## 📊 MongoDB Atlas Dashboard Overview

### Key Sections

**1. Overview Tab**
- Cluster status (should be green/active)
- Connection count
- Storage used

**2. Browse Collections**
- View your databases and collections
- See uploaded documents
- Query data directly

**3. Metrics**
- Operations per second
- Network traffic
- Storage growth

**4. Network Access**
- Manage IP whitelist
- Add/remove IPs

**5. Database Access**
- Manage users
- View user permissions

---

## 🔒 Security Best Practices

### 1. Password Management

❌ **DON'T:**
- Share your MongoDB password publicly
- Commit `.env` files to Git
- Use simple passwords

✅ **DO:**
- Use strong, auto-generated passwords
- Store passwords in `.env` files (gitignored)
- Rotate passwords periodically

### 2. Network Access

❌ **DON'T:**
- Allow `0.0.0.0/0` in production without authentication
- Share connection strings publicly

✅ **DO:**
- Use `0.0.0.0/0` only for dynamic IP platforms (Railway)
- Rely on username/password authentication
- Monitor connection attempts in Atlas dashboard

### 3. User Permissions

❌ **DON'T:**
- Use root/admin user in production
- Give users more permissions than needed

✅ **DO:**
- Create separate users for different environments
- Use read-only users for analytics
- Audit user activity regularly

---

## 📈 Monitoring Your Cluster

### Metrics to Watch

**1. Operations**
- Target: < 100 ops/second (M0 limit)
- Your usage: Likely < 10 ops/second

**2. Storage**
- M0 Limit: 512 MB
- Monitor in Atlas Dashboard → Metrics

**3. Connections**
- M0 Limit: 500 concurrent connections
- Your backend uses 1-5 typically

### Alerts Setup (Optional)

1. Atlas → Alerts
2. Create alert for:
   - Storage > 80% (409 MB)
   - Operations approaching limit
   - Connection spikes

---

## 🆙 Upgrading to Paid Tier (Future)

When you outgrow M0 Free:

### M2 Shared ($9/month)
- 2 GB storage
- Shared CPU
- Good for small apps

### M10 Dedicated ($57/month)
- 10 GB storage
- Dedicated CPU
- Backups included
- Auto-scaling

**When to upgrade:**
- Storage exceeds 512 MB
- Need backups
- Performance becomes slow
- Need advanced features

---

## Troubleshooting

### Problem 1: "Network Error" when connecting

**Symptoms:**
```
MongoNetworkError: connection timed out
```

**Solutions:**
1. Check IP whitelist: Atlas → Network Access
2. Verify `0.0.0.0/0` is added
3. Check firewall/antivirus blocking port 27017
4. Try different network (mobile hotspot)

---

### Problem 2: "Authentication failed"

**Symptoms:**
```
MongoServerError: Authentication failed
```

**Solutions:**
1. Verify username is exactly: `ssg_app_user`
2. Double-check password (no typos)
3. Re-copy connection string from Atlas
4. Ensure password is URL-encoded if contains special chars
5. Recreate user if needed: Atlas → Database Access

---

### Problem 3: "Database/Collection not found"

**Symptoms:**
```
Database 'ssg_documents' not found
```

**Solution:**
- This is normal! MongoDB creates databases on first write
- Upload a document first, then check Atlas

---

### Problem 4: Connection string errors

**Common Issues:**

❌ **Wrong:**
```
mongodb+srv://ssg_app_user:<password>@cluster.mongodb.net/
```

✅ **Correct:**
```
mongodb+srv://ssg_app_user:YOUR_ACTUAL_PASSWORD@cluster.mongodb.net/ssg_documents
```

**Check:**
1. Replace `<password>` with actual password
2. Add database name `/ssg_documents`
3. Keep `?retryWrites=true&w=majority`

---

### Problem 5: "Cluster is paused" (M0 Free Tier)

**Symptoms:**
- Can't connect after 60 days of inactivity
- Cluster status shows "Paused"

**Solution:**
1. Go to Atlas Dashboard
2. Click cluster
3. Click **"Resume"**
4. Wait 2-3 minutes
5. Reconnect

**Prevention:** Access database at least once every 60 days

---

### Problem 6: SSL/TLS Errors

**Symptoms:**
```
SSL routines:ssl3_get_record:wrong version number
```

**Solutions:**
1. Ensure connection string starts with `mongodb+srv://` (not `mongodb://`)
2. Update MongoDB driver: `npm install mongodb@latest`
3. Check Node.js version (should be 14+)

---

### Problem 7: "MongoParseError: Invalid connection string"

**Solutions:**
1. Check for typos in connection string
2. Ensure no spaces in connection string
3. Verify special characters in password are URL-encoded:
   ```javascript
   const encodedPassword = encodeURIComponent('your_password');
   ```

---

## 📞 Getting Help

### MongoDB Atlas Support

**Free Tier (M0):**
- Community support only
- MongoDB Community Forums
- Stack Overflow (tag: mongodb)

**Paid Tiers:**
- Email support
- Chat support
- Phone support (M30+)

### Resources

**Official Documentation:**
- MongoDB Atlas Docs: https://docs.atlas.mongodb.com/
- MongoDB Driver Docs: https://mongodb.github.io/node-mongodb-native/
- GridFS Guide: https://docs.mongodb.com/manual/core/gridfs/

**Community:**
- MongoDB Community Forums: https://community.mongodb.com/
- Stack Overflow: https://stackoverflow.com/questions/tagged/mongodb
- MongoDB University (Free courses): https://university.mongodb.com/

---

## 🎓 Quick Reference

### Important Links

| Resource | URL |
|----------|-----|
| **Atlas Dashboard** | https://cloud.mongodb.com/ |
| **MongoDB Compass** | https://www.mongodb.com/products/compass |
| **Connection String Format** | `mongodb+srv://user:pass@cluster.mongodb.net/db` |
| **Support** | https://support.mongodb.com/ |

### Your Cluster Details

```
Cluster Name:    ssg-documents-cluster
Region:          Singapore (ap-southeast-1)
Provider:        AWS
Tier:            M0 (FREE)
Database:        ssg_documents
Collection:      documents.files, documents.chunks
Username:        ssg_app_user
Password:        [Your saved password]
```

### Connection String Template

```bash
# Backend .env
MONGODB_URI=mongodb+srv://ssg_app_user:YOUR_PASSWORD@ssg-documents-cluster.XXXXX.mongodb.net/ssg_documents?retryWrites=true&w=majority
MONGODB_DATABASE=ssg_documents
MONGODB_BUCKET_NAME=documents
```

---

## ✅ Setup Verification Checklist

Before moving to Session 4, verify:

- [ ] MongoDB Atlas account created
- [ ] Cluster active in Singapore region
- [ ] Database user `ssg_app_user` created
- [ ] Password saved securely
- [ ] Network access configured (0.0.0.0/0)
- [ ] Connection string obtained and saved
- [ ] Backend `.env` updated with connection string
- [ ] Backend dependencies installed (`npm install`)
- [ ] Backend starts without errors (`node server.js`)
- [ ] GridFS test passes (`node test-gridfs.js`)
- [ ] Can see collections in Atlas dashboard
- [ ] Frontend `.env.local` updated
- [ ] Test document upload works

If all checked, you're ready for **Session 4: Migration Script**! 🚀

---

**Document Version:** 1.0  
**Last Updated:** January 8, 2027  
**Created for:** SSG Office Assistant MongoDB Integration

---

*This guide is part of the MongoDB Integration series. See related docs:*
- [Session 1: Infrastructure](./MONGODB_INTEGRATION_SESSION_01.md)
- [Session 2: Backend API](./MONGODB_INTEGRATION_SESSION_02.md)
- [Session 3: Frontend Integration](./MONGODB_INTEGRATION_SESSION_03.md)
