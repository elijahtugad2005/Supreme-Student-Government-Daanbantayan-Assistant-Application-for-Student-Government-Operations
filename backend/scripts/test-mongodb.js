/**
 * ─────────────────────────────────────────────────────────────
 * MongoDB Diagnostic & Document Tracker
 * ─────────────────────────────────────────────────────────────
 * Run from the /backend directory:
 *   node scripts/test-mongodb.js
 *
 * What it does (no AI quota is spent):
 *  1. Tests raw MongoDB connectivity (ping)
 *  2. Lists ALL files in GridFS and reports their sizes
 *  3. Searches for RESO and MOM documents by filename / title
 *  4. Uploads a tiny test file and then deletes it (round-trip)
 *  5. Optionally checks if the backend HTTP server is alive
 *
 * Purpose: verify where RESO-002 26-27 and MOM-6th Session(1) are stored.
 * ─────────────────────────────────────────────────────────────
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
// Also try the root .env.local (Vite convention, where VITE_MONGODB_BACKEND_URL lives)
require('dotenv').config({ path: require('path').join(__dirname, '../../.env.local'), override: false });

const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const http = require('http');

// ── Config ────────────────────────────────────────────────────
const MONGO_URI   = process.env.MONGODB_URI;
const DB_NAME     = process.env.MONGODB_DATABASE    || 'ssg_documents';
const BUCKET_NAME = process.env.MONGODB_BUCKET_NAME || 'documents';
const BACKEND_URL = process.env.VITE_MONGODB_BACKEND_URL || 'http://localhost:3000';

const C = {
  reset:  '\x1b[0m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  bold:   '\x1b[1m',
};

const ok   = (msg) => console.log(`${C.green}OK${C.reset}   ${msg}`);
const fail = (msg) => console.log(`${C.red}FAIL${C.reset} ${msg}`);
const info = (msg) => console.log(`${C.cyan}INFO${C.reset} ${msg}`);
const warn = (msg) => console.log(`${C.yellow}WARN${C.reset} ${msg}`);
const sep  = ()    => console.log(C.bold + '-'.repeat(60) + C.reset);
const hr   = (t)   => { sep(); console.log(C.bold + '  ' + t + C.reset); sep(); };

// ─────────────────────────────────────────────────────────────
// 1. ENV CHECK
// ─────────────────────────────────────────────────────────────
function checkEnv() {
  hr('STEP 1 — Environment Check');
  if (!MONGO_URI) {
    fail('MONGODB_URI is not set in .env or .env.local');
    process.exit(1);
  }
  const display = MONGO_URI.replace(/:([^@]+)@/, ':***@');
  ok(`MONGODB_URI    : ${display}`);
  ok(`DB_NAME        : ${DB_NAME}`);
  ok(`BUCKET_NAME    : ${BUCKET_NAME}`);
  info(`BACKEND_URL    : ${BACKEND_URL}`);
}

// ─────────────────────────────────────────────────────────────
// 2. MONGODB PING
// ─────────────────────────────────────────────────────────────
async function testPing(client) {
  hr('STEP 2 — MongoDB Connectivity (ping)');
  const t0 = Date.now();
  await client.db('admin').command({ ping: 1 });
  const ms = Date.now() - t0;
  ok('Ping successful in ' + ms + ' ms');
}

// ─────────────────────────────────────────────────────────────
// 3. LIST ALL GRIDFS FILES
// ─────────────────────────────────────────────────────────────
async function listAllFiles(db) {
  hr('STEP 3 — GridFS File Inventory');
  const col = db.collection(BUCKET_NAME + '.files');
  const files = await col.find({}).sort({ uploadDate: -1 }).limit(200).toArray();

  if (files.length === 0) {
    warn('No files found in GridFS. Bucket "' + BUCKET_NAME + '" is empty.');
    warn('RESO-002 and MOM-6th are stored LOCALLY (IndexedDB) on the browser.');
    return files;
  }

  ok('Found ' + files.length + ' file(s) in GridFS:');
  console.log('');
  files.forEach((f, i) => {
    const sizeKB = (f.length / 1024).toFixed(1);
    const date   = f.uploadDate ? new Date(f.uploadDate).toLocaleString() : 'n/a';
    const docId  = f.metadata && f.metadata.documentId ? f.metadata.documentId : '—';
    console.log(
      '  [' + (i + 1) + '] ' + f._id.toString() +
      '\n       Filename   : ' + (f.filename || '') +
      '\n       Size       : ' + sizeKB + ' KB' +
      '\n       Uploaded   : ' + date +
      '\n       DocumentId : ' + docId +
      '\n       Title      : ' + (f.metadata && f.metadata.title ? f.metadata.title : '—')
    );
    console.log('');
  });

  return files;
}

// ─────────────────────────────────────────────────────────────
// 4. SEARCH FOR RESO & MOM DOCUMENTS
// ─────────────────────────────────────────────────────────────
function searchDocuments(files) {
  hr('STEP 4 — Searching for RESO-002 and MOM-6th Session');

  const keywords = ['reso', 'reso-002', 'mom', '6th session', 'adviser', 'appointment'];
  const targets  = [];

  for (const f of files) {
    const name  = (f.filename || '').toLowerCase();
    const title = (f.metadata && f.metadata.title ? f.metadata.title : '').toLowerCase();
    const hit = keywords.some(k => name.includes(k) || title.includes(k));
    if (hit) targets.push(f);
  }

  if (targets.length === 0) {
    warn('RESO-002 / MOM-6th were NOT found in MongoDB GridFS.');
    warn('Conclusion: these files are stored in the browser IndexedDB (local mode).');
    info('With the deleteDocument() fix they should now delete correctly via localStore.');
  } else {
    ok('Found ' + targets.length + ' matching document(s) in GridFS:');
    targets.forEach((f) => {
      console.log('  FileId     : ' + f._id);
      console.log('  Filename   : ' + f.filename);
      console.log('  DocumentId : ' + (f.metadata && f.metadata.documentId ? f.metadata.documentId : 'none'));
      console.log('  Title      : ' + (f.metadata && f.metadata.title ? f.metadata.title : 'none'));
      console.log('');
    });
  }

  return targets;
}

// ─────────────────────────────────────────────────────────────
// 5. ROUND-TRIP TEST
// ─────────────────────────────────────────────────────────────
async function roundTripTest(db) {
  hr('STEP 5 — GridFS Round-Trip (upload -> verify -> delete)');

  const bucket  = new GridFSBucket(db, { bucketName: BUCKET_NAME });
  const content = Buffer.from('SSG-Test-' + Date.now() + '\nGenerated by test-mongodb.js');
  const fname   = '_test_roundtrip_' + Date.now() + '.txt';

  info('Uploading test file: ' + fname);
  const uploadedId = await new Promise((res, rej) => {
    const stream = bucket.openUploadStream(fname, {
      metadata: { purpose: 'diagnostics', generatedBy: 'test-mongodb.js' }
    });
    stream.on('finish', () => res(stream.id));
    stream.on('error', rej);
    stream.end(content);
  });
  ok('Uploaded -> ID: ' + uploadedId);

  const col  = db.collection(BUCKET_NAME + '.files');
  const meta = await col.findOne({ _id: uploadedId });
  if (!meta) { fail('Verification failed: metadata not found after upload'); return; }
  ok('Verified -> filename=' + meta.filename + ', size=' + meta.length + ' bytes');

  const downloaded = await new Promise((res, rej) => {
    const chunks = [];
    const dl = bucket.openDownloadStream(uploadedId);
    dl.on('data', c => chunks.push(c));
    dl.on('end', () => res(Buffer.concat(chunks)));
    dl.on('error', rej);
  });

  if (Buffer.compare(content, downloaded) === 0) {
    ok('Download verified — bytes match original');
  } else {
    fail('Downloaded bytes do NOT match original!');
  }

  await bucket.delete(uploadedId);
  const afterDel = await col.findOne({ _id: uploadedId });
  if (!afterDel) {
    ok('Deleted -> ID ' + uploadedId + ' is gone from GridFS');
  } else {
    fail('Delete may have failed — file still appears in .files collection');
  }
}

// ─────────────────────────────────────────────────────────────
// 6. BACKEND HTTP HEALTH CHECK (no auth required)
// ─────────────────────────────────────────────────────────────
async function backendHealthCheck() {
  hr('STEP 6 — Backend HTTP Health Check');
  return new Promise((resolve) => {
    const url = BACKEND_URL + '/api/documents/health';
    info('GET ' + url);
    const req = http.get(url, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.success) {
            ok('Backend is UP: ' + json.message);
            ok('  DB: ' + json.database + ' | Bucket: ' + json.bucket + ' | Files: ' + json.totalFiles);
          } else {
            fail('Backend health check failed: ' + json.message);
          }
        } catch (e) {
          fail('Non-JSON response: ' + body.slice(0, 200));
        }
        resolve();
      });
    });
    req.on('error', (e) => {
      warn('Backend not reachable at ' + BACKEND_URL + ': ' + e.message);
      warn('Start the backend with: cd backend && npm run dev');
      resolve();
    });
    req.on('timeout', () => {
      warn('Backend request timed out');
      req.destroy();
      resolve();
    });
  });
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────
(async () => {
  console.log('');
  console.log(C.bold + C.cyan + 'SSG Document Repository — MongoDB Diagnostics' + C.reset);
  console.log(C.cyan + 'Run at: ' + new Date().toLocaleString() + C.reset);
  sep();

  checkEnv();
  await backendHealthCheck();

  let client;
  try {
    hr('Connecting to MongoDB Atlas...');
    client = new MongoClient(MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    await client.connect();
    ok('Connected to MongoDB Atlas');

    const db = client.db(DB_NAME);
    await testPing(client);
    const files = await listAllFiles(db);
    searchDocuments(files);
    await roundTripTest(db);

  } catch (err) {
    fail('Fatal error: ' + err.message);
    console.error(err);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      info('MongoDB connection closed.');
    }
  }

  sep();
  console.log(C.green + C.bold + 'All tests complete.' + C.reset);
  sep();
})();
