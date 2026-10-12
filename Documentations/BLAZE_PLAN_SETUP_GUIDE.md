# Firebase Blaze Plan & Cloud Functions Setup Guide

## 🔥 SSG Office Assistant App - Cloud Deployment

This guide explains how to enable **AI Document Processing** and **Cloud Functions** for the SSG Office Assistant App by upgrading to the Firebase **Blaze Plan**.

---

## ⚠️ Why Blaze Plan is Required

### Current Limitations (Spark Plan - Free)

❌ **Cannot deploy Cloud Functions**  
❌ **Cannot use AI document analysis**  
❌ **Cannot use external API calls from backend**  
❌ **Limited to client-side Firebase only**

### With Blaze Plan (Pay-as-you-go)

✅ **Cloud Functions enabled** - AI document processing  
✅ **External API calls** - Gemini AI, OpenRouter  
✅ **Automatic document tagging**  
✅ **Background processing**  
✅ **Scalable architecture**

---

## 💰 Cost Estimation

### Free Tier Included with Blaze

```yaml
Cloud Functions:
  Invocations: 2,000,000/month FREE
  GB-seconds: 400,000/month FREE
  CPU-seconds: 200,000/month FREE

Firestore:
  Reads: 50,000/day FREE
  Writes: 20,000/day FREE
  Deletes: 20,000/day FREE
  Storage: 1 GB FREE

Cloud Storage:
  Storage: 5 GB FREE
  Downloads: 1 GB/day FREE

Hosting:
  Storage: 10 GB FREE
  Transfer: 360 MB/day FREE
```

### Estimated Monthly Cost for SSG App

**With typical usage (50-100 users, daily activity):**

| Service | Estimated Cost |
|---------|---------------|
| Cloud Functions | **$0 - $2** (within free tier) |
| Firestore | **$0 - $1** (mostly free tier) |
| Cloud Storage | **$0** (within free tier) |
| **Total** | **$0 - $3/month** |

🎯 **Realistic estimate: $0-5/month** for your school project

---

## 🚀 Step-by-Step Upgrade Process

### Step 1: Upgrade to Blaze Plan

1. **Go to Firebase Console**
   ```
   https://console.firebase.google.com/project/[your-project-id]/overview
   ```

2. **Click on "Upgrade" button** (bottom left sidebar)

3. **Select "Blaze Plan"**
   - It's **pay-as-you-go**
   - You get **generous free tier**
   - Only pay for usage beyond free limits

4. **Add Billing Information**
   - Requires credit/debit card
   - You can set **budget alerts**
   - Recommended: Set alert at $5/month

5. **Confirm Upgrade**
   - No immediate charges
   - Free tier applies first

---

### Step 2: Enable Required APIs

After upgrading, enable these Google Cloud APIs:

```bash
# Enable Cloud Functions API
gcloud services enable cloudfunctions.googleapis.com

# Enable Cloud Build API
gcloud services enable cloudbuild.googleapis.com

# Enable Artifact Registry API  
gcloud services enable artifactregistry.googleapis.com
```

Or enable manually in:
```
https://console.cloud.google.com/apis/library
```

Required APIs:
- ✅ Cloud Functions API
- ✅ Cloud Build API
- ✅ Artifact Registry API
- ✅ Cloud Storage API

---

### Step 3: Set Up Gemini API Key

1. **Get Gemini API Key**
   ```
   https://makersuite.google.com/app/apikey
   ```

2. **Add to Functions Environment**

   **Option A: Using Firebase Console**
   - Go to: `Functions` → `Environment Variables`
   - Add:
     ```
     GEMINI_API_KEY=your_api_key_here
     GEMINI_MODEL=gemini-2.0-flash-exp
     ```

   **Option B: Using Firebase CLI**
   ```bash
   firebase functions:secrets:set GEMINI_API_KEY
   # Paste your API key when prompted
   ```

3. **Update `functions/.env`** (for local testing)
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-2.0-flash-exp
   OPENROUTER_API_KEY=your_openrouter_key_optional
   OPENROUTER_AI_MODEL=nvidia/nemotron-4-340b-instruct:free
   ```

---

### Step 4: Deploy Cloud Functions

```bash
# Navigate to project root
cd "C:\Users\User\Desktop\REACT PROJECTS\React js BootCamp\Shirio"

# Install Firebase CLI (if not installed)
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase (if not done)
firebase init functions

# Select:
# - Use existing project
# - JavaScript/TypeScript: JavaScript
# - ESLint: No (optional)
# - Install dependencies: Yes

# Deploy functions
firebase deploy --only functions

# Or deploy specific function
firebase deploy --only functions:analyzeDocument
```

---

### Step 5: Update Firestore Security Rules

```javascript
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Allow Cloud Functions to write
    match /documents/{docId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null 
                    || request.resource.data.keys().hasOnly([
                      'aiAnalysis', 
                      'extractedMetadata', 
                      'status'
                    ]);
      allow delete: if request.auth != null && hasRole('admin');
    }
    
    // Helper function
    function hasRole(role) {
      return request.auth.token.role == role;
    }
  }
}
```

Deploy rules:
```bash
firebase deploy --only firestore:rules
```

---

## 🤖 AI Document Processing Features

### What Gets Enabled

#### 1. **Automatic Document Analysis**
When a user uploads a document:
1. File stored in Cloud Storage
2. Cloud Function triggered automatically
3. Gemini AI analyzes document
4. Extracts metadata:
   - Title
   - Document number
   - Issuing office
   - Subject
   - Author(s)
   - Signature checklist
5. Results stored in Firestore
6. User sees analysis in dashboard

#### 2. **Document Classification**
```javascript
Document Types:
- Resolution
- Memorandum
- Letter
- Minutes
- Report
- Contract
- Policy
- Other
```

#### 3. **Smart Metadata Extraction**
```javascript
Extracted Fields:
- documentNumber: "RES-2026-001"
- issuingOffice: "SSG Office"
- subject: "Budget Allocation"
- author: "John Doe"
- preparedBy: "Jane Smith"
- date: "2026-10-07"
- signatures: ["President", "Treasurer"]
```

---

## 📁 Cloud Functions Architecture

### Function: `analyzeDocument`

**Trigger:** Firestore onCreate (`/documents/{docId}`)

**Process:**
```javascript
1. Document created in Firestore
2. Function triggered automatically
3. Download file from Storage
4. Extract text (PDF/DOCX)
5. Send to Gemini AI
6. Parse AI response
7. Update document with analysis
8. Set status: "analyzed"
```

**Code Location:** `functions/src/index.js`

---

## 🔧 Local Testing (Before Deployment)

### Test with Emulators

```bash
# Install dependencies
cd functions
npm install

# Start emulators
npm run emulators

# Or from root
npm run emulators
```

Emulator URLs:
- Firestore: http://localhost:8080
- Functions: http://localhost:5001
- Auth: http://localhost:9099
- Storage: http://localhost:9199

---

## 📊 Monitoring & Logs

### View Function Logs

**Firebase Console:**
```
https://console.firebase.google.com/project/[your-project]/functions/logs
```

**CLI:**
```bash
# Stream logs in real-time
firebase functions:log

# View specific function
firebase functions:log --only analyzeDocument

# Last 100 lines
firebase functions:log --limit 100
```

### Monitor Usage

**Check costs:**
```
https://console.firebase.google.com/project/[your-project]/usage
```

Set up **Budget Alerts:**
1. Go to Google Cloud Console
2. Billing → Budgets & Alerts
3. Create budget: $5/month
4. Set alert at 50%, 75%, 100%
5. Get email notifications

---

## 🐛 Troubleshooting

### Issue 1: "Billing account not configured"

**Error:**
```
Error: HTTP Error: 403, Billing account not configured
```

**Solution:**
1. Upgrade to Blaze plan
2. Link billing account
3. Wait 5-10 minutes for propagation
4. Redeploy

### Issue 2: "Permission denied"

**Error:**
```
Permission denied: Missing required permission cloudfunctions.functions.create
```

**Solution:**
```bash
# Grant yourself Cloud Functions Admin role
gcloud projects add-iam-policy-binding [PROJECT_ID] \
  --member="user:[YOUR_EMAIL]" \
  --role="roles/cloudfunctions.admin"
```

### Issue 3: Function timeout

**Error:**
```
Function execution timeout
```

**Solution:**
Update timeout in `functions/src/index.js`:
```javascript
export const analyzeDocument = onDocumentCreated({
  document: 'documents/{docId}',
  timeoutSeconds: 300, // 5 minutes
  memory: '512MiB'
}, async (event) => {
  // ... function code
});
```

### Issue 4: Gemini API rate limit

**Error:**
```
Error: 429 Too Many Requests
```

**Solution:**
- Free tier: 15 requests/minute
- Implement retry logic (already in code)
- Use OpenRouter fallback
- Consider paid Gemini tier for production

---

## 🎓 For Your Capstone Defense

### Demonstrate Cloud Architecture

**Show the judges:**

1. **Firebase Console**
   - Show Blaze plan status
   - Show function deployment
   - Show usage metrics

2. **Live Demo**
   - Upload a document
   - Show real-time AI analysis
   - Display extracted metadata
   - Show function logs

3. **Architecture Diagram**
   ```
   [User Upload] 
        ↓
   [Cloud Storage]
        ↓
   [Cloud Function Trigger]
        ↓
   [Gemini AI Analysis]
        ↓
   [Firestore Update]
        ↓
   [Dashboard Display]
   ```

4. **Cost Analysis**
   - Show actual monthly costs
   - Explain free tier benefits
   - Justify infrastructure choice

---

## 📋 Deployment Checklist

### Before Deploying to Production

- [ ] Blaze plan activated
- [ ] Billing account configured
- [ ] Budget alerts set ($5/month)
- [ ] Gemini API key added
- [ ] Required APIs enabled
- [ ] Functions code tested locally
- [ ] Firestore rules updated
- [ ] Storage rules updated
- [ ] Functions deployed successfully
- [ ] Test document upload works
- [ ] AI analysis working
- [ ] Logs reviewed (no errors)
- [ ] Performance acceptable
- [ ] Cost monitoring active

---

## 🔐 Security Best Practices

### API Keys

❌ **Never commit API keys to Git**
```bash
# Add to .gitignore
functions/.env
functions/.secret.local
.env.local
```

✅ **Use Firebase Secrets**
```bash
firebase functions:secrets:set GEMINI_API_KEY
```

### Function Security

```javascript
// functions/src/index.js
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getAuth } from 'firebase-admin/auth';

export const analyzeDocument = onDocumentCreated(
  {
    document: 'documents/{docId}',
    secrets: ['GEMINI_API_KEY'], // Secure secret injection
  },
  async (event) => {
    // Function code
  }
);
```

---

## 📞 Support Resources

### Official Documentation

- **Firebase Blaze Plan:** https://firebase.google.com/pricing
- **Cloud Functions:** https://firebase.google.com/docs/functions
- **Gemini AI:** https://ai.google.dev/docs
- **Firebase CLI:** https://firebase.google.com/docs/cli

### Community Support

- **Stack Overflow:** firebase + cloud-functions tag
- **Firebase Discord:** https://discord.gg/firebase
- **GitHub Issues:** For specific libraries

---

## 🎯 Expected Results After Setup

### What Should Work

✅ Upload PDF/DOCX documents  
✅ Automatic AI analysis  
✅ Extracted metadata displayed  
✅ Document classification  
✅ Signature checklist generation  
✅ Real-time updates in dashboard  
✅ Audit trail logging  
✅ All within budget constraints  

### Performance Targets

- **Analysis time:** < 10 seconds per document
- **Function cold start:** 3-5 seconds
- **Warm function:** < 2 seconds
- **Monthly cost:** $0-5 for school usage

---

## 📝 Quick Command Reference

```bash
# Deploy everything
firebase deploy

# Deploy only functions
firebase deploy --only functions

# Deploy only firestore rules
firebase deploy --only firestore:rules

# Deploy only storage rules
firebase deploy --only storage:rules

# View logs
firebase functions:log

# Set secret
firebase functions:secrets:set API_KEY

# List secrets
firebase functions:secrets:access API_KEY

# Delete old function
firebase functions:delete oldFunctionName

# Check deployment
firebase functions:list
```

---

**Last Updated:** October 7, 2026  
**Deployment Status:** Ready for Blaze Plan Upgrade  
**Estimated Cost:** $0-5/month for school usage  
**Setup Time:** 30-60 minutes

---

## ✅ Next Steps

1. **Upgrade to Blaze Plan** (5 minutes)
2. **Enable APIs** (5 minutes)
3. **Set up Gemini API** (10 minutes)
4. **Deploy Functions** (15 minutes)
5. **Test AI document analysis** (10 minutes)
6. **Monitor first week** (ongoing)

**Total setup time: ~45 minutes**

Need help? Contact your capstone adviser or refer to this guide!
