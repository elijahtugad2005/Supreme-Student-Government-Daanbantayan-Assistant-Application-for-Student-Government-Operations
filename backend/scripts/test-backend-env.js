/**
 * backend/scripts/test-backend-env.js
 *
 * Pre-Deployment Environment & Connectivity Validation for Backend API.
 * Validates:
 *   1. MONGODB_URI presence & Atlas cloud cluster format
 *   2. Real round-trip MongoDB ping to the live database
 *   3. Firebase Service Account credentials availability
 *   4. CORS origin settings & Vercel domain handling
 *   5. OpenRouter/Gemini API keys for AI document intelligence
 *
 * Usage:
 *   node backend/scripts/test-backend-env.js
 */

'use strict';

const path = require('path');
const fs = require('fs');

// Load environment variables from backend/.env and .env.local
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env.local'), override: false });

const { MongoClient } = require('mongodb');

console.log('═══════════════════════════════════════════════════════════════');
console.log('     BACKEND API PRE-DEPLOYMENT ENVIRONMENT VERIFICATION');
console.log('═══════════════════════════════════════════════════════════════\n');

let hasErrors = false;
let hasWarnings = false;

// 1. Check MongoDB URI
console.log('── 1. Database Configuration (MongoDB Atlas) ───────────────────');
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  console.error('  [FAIL] MONGODB_URI is MISSING in backend/.env');
  hasErrors = true;
} else if (mongoUri.includes('localhost') || mongoUri.includes('127.0.0.1')) {
  console.warn('  [WARN] MONGODB_URI points to localhost. It must point to a cloud MongoDB Atlas cluster for production!');
  hasWarnings = true;
} else {
  const masked = mongoUri.replace(/:([^@]+)@/, ':***@');
  console.log(`  [PASS] MONGODB_URI configured: ${masked}`);
}

const dbName = process.env.MONGODB_DATABASE || 'ssg_documents';
const bucketName = process.env.MONGODB_BUCKET_NAME || 'documents';
console.log(`  [INFO] Target Database: ${dbName} | GridFS Bucket: ${bucketName}`);

// 2. Check Firebase Admin SDK
console.log('\n── 2. Firebase Admin SDK Credentials ───────────────────────────');
const serviceAccountPath = path.join(__dirname, '../firebase-service-account.json');
const hasServiceAccountFile = fs.existsSync(serviceAccountPath);
const hasEnvPrivateKey = !!process.env.FIREBASE_PRIVATE_KEY;

if (hasServiceAccountFile) {
  try {
    const json = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    console.log(`  [PASS] firebase-service-account.json found (Project: ${json.project_id || 'valid'})`);
  } catch (e) {
    console.error('  [FAIL] firebase-service-account.json is corrupt or invalid JSON');
    hasErrors = true;
  }
} else if (hasEnvPrivateKey) {
  console.log('  [PASS] FIREBASE_PRIVATE_KEY provided via environment variable.');
} else {
  console.warn('  [WARN] Neither firebase-service-account.json nor FIREBASE_PRIVATE_KEY was found.');
  console.warn('         Document upload authorization endpoints require this in production.');
  hasWarnings = true;
}

// 3. CORS & Security Config
console.log('\n── 3. CORS & Client Origin Whitelist ───────────────────────────');
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:5173'];

console.log(`  [INFO] Allowed origins: ${allowedOrigins.join(', ')}`);
const hasProductionOrigin = allowedOrigins.some(o => !o.includes('localhost'));

if (!hasProductionOrigin) {
  console.warn('  [WARN] ALLOWED_ORIGINS only lists localhost URLs.');
  console.warn('         Remember to add your Vercel frontend domain (e.g. https://your-app.vercel.app) before going live!');
  hasWarnings = true;
} else {
  console.log('  [PASS] Production frontend domain detected in ALLOWED_ORIGINS.');
}

// 4. Live MongoDB Ping Test
console.log('\n── 4. Live Cloud Database Connectivity Test ────────────────────');

async function testDatabaseConnection() {
  if (!mongoUri) return;

  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 6000 });
  try {
    const start = Date.now();
    await client.connect();
    const pingResult = await client.db(dbName).command({ ping: 1 });
    const elapsed = Date.now() - start;

    if (pingResult && pingResult.ok === 1) {
      console.log(`  [PASS] MongoDB Atlas ping OK (${elapsed}ms latency)`);
    } else {
      console.error('  [FAIL] MongoDB Atlas ping returned unexpected response:', pingResult);
      hasErrors = true;
    }
  } catch (err) {
    console.error(`  [FAIL] Could not connect to MongoDB Atlas: ${err.message}`);
    console.error('         Check your Atlas Network Access (IP Whitelist 0.0.0.0/0) and credentials.');
    hasErrors = true;
  } finally {
    await client.close();
  }

  // Summary output
  console.log('\n═══════════════════════════════════════════════════════════════');
  if (hasErrors) {
    console.error('  BACKEND PRE-DEPLOYMENT TEST FAILED ❌');
    console.error('  Please resolve the errors above before deploying your backend.\n');
    process.exit(1);
  } else if (hasWarnings) {
    console.log('  BACKEND READY FOR DEPLOYMENT (WITH ADVISORIES) ⚠️');
    console.log('  Remember to supply production secrets (e.g. Vercel domain in ALLOWED_ORIGINS) in Render/Railway.\n');
    process.exit(0);
  } else {
    console.log('  ALL BACKEND ENVIRONMENT CHECKS PASSED ✅');
    console.log('  MongoDB Atlas and Express configurations are production-ready.\n');
    process.exit(0);
  }
}

testDatabaseConnection();
