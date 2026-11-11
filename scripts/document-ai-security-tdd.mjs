/**
 * TDD & Bug-Diagnosis Regression Suite for Document Archive, GridFS, Drive & AI
 *
 * Tests at public Express & Service seams:
 * - Seam A: backend/middleware/auth.js (authenticate, requireRole + Firestore role fallback)
 * - Seam B: backend/routes/ai.js (auth & role guards, status key-leak prevention, /correctClassification)
 * - Seam C: backend/routes/documents.js (requireRole on DELETE /firestore/:documentId, DELETE /:fileId, POST /upload, GET /list)
 * - Seam D: src/services/documentAiService.js & firestore.rules alignment
 *
 * Run: node scripts/document-ai-security-tdd.mjs
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);

let failed = 0;
const results = [];
const check = (label, ok, detail = '') => {
  if (ok) {
    results.push(`ok   ${label}`);
  } else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// Mockable Firebase Admin boundary
const mockState = {
  tokens: new Map(),
  users: new Map(),
  documents: new Map(),
  documentLabels: new Map(),
  auditLogs: [],
  gridFsMetadata: new Map(),
  deletedGridFsIds: [],
  deletedDriveIds: [],
};

const createMockFirestore = () => ({
  collection(name) {
    if (name === 'users') {
      return {
        doc(uid) {
          return {
            async get() {
              const data = mockState.users.get(uid);
              return { exists: Boolean(data), data: () => data };
            },
          };
        },
      };
    }
    if (name === 'documentLabels') {
      return {
        async get() {
          const docs = Array.from(mockState.documentLabels.entries()).map(([id, d]) => ({
            id,
            data: () => d,
          }));
          return { docs };
        },
      };
    }
    if (name === 'documents') {
      return {
        doc(docId) {
          return {
            async get() {
              const data = mockState.documents.get(docId);
              return { exists: Boolean(data), data: () => data };
            },
            async update(patch) {
              const current = mockState.documents.get(docId) || {};
              mockState.documents.set(docId, { ...current, ...patch });
            },
            async delete() {
              mockState.documents.delete(docId);
            },
            collection(subName) {
              if (subName === 'auditLogs') {
                return {
                  async add(entry) {
                    mockState.auditLogs.push({ documentId: docId, ...entry });
                    return { id: `audit_${mockState.auditLogs.length}` };
                  },
                };
              }
              throw new Error(`Unexpected subcollection: ${subName}`);
            },
          };
        },
      };
    }
    throw new Error(`Unexpected collection: ${name}`);
  },
});

const fbAdminPath = require.resolve('../backend/services/firebase-admin.js');
require.cache[fbAdminPath] = {
  id: fbAdminPath,
  filename: fbAdminPath,
  loaded: true,
  exports: {
    initializeFirebaseAdmin: () => ({}),
    getFirebaseAdmin: () => ({}),
    verifyIdToken: async (token) => {
      const decoded = mockState.tokens.get(token);
      if (!decoded) {
        const err = new Error('Invalid token');
        err.code = 'auth/argument-error';
        throw err;
      }
      return decoded;
    },
    getFirestore: () => createMockFirestore(),
    getStorageBucket: () => ({}),
  },
};

const gridFsPath = require.resolve('../backend/utils/gridfs.js');
require.cache[gridFsPath] = {
  id: gridFsPath,
  filename: gridFsPath,
  loaded: true,
  exports: {
    uploadFileToGridFS: async () => ({ fileId: 'grid-1', filename: 'test.pdf', size: 100 }),
    getDownloadStream: async () => ({ on: () => {}, pipe: () => {} }),
    getFileMetadata: async (fileId) => mockState.gridFsMetadata.get(fileId) || null,
    deleteFileFromGridFS: async (fileId) => {
      mockState.deletedGridFsIds.push(fileId);
      mockState.gridFsMetadata.delete(fileId);
    },
    listFiles: async () => [],
    downloadFileFromGridFS: async () => Buffer.from('test'),
  },
};

const driveSyncPath = require.resolve('../backend/services/driveSync.js');
require.cache[driveSyncPath] = {
  id: driveSyncPath,
  filename: driveSyncPath,
  loaded: true,
  exports: {
    isEnabled: () => false,
    authMode: () => null,
    mirrorUpload: async () => ({ driveFileId: 'drv-1', webViewLink: null }),
    deleteMirror: async (driveFileId) => {
      if (driveFileId) mockState.deletedDriveIds.push(driveFileId);
    },
  },
};

const authMiddleware = require('../backend/middleware/auth.js');

const runMiddlewareChain = async (middlewares, req) => {
  let statusCode = 200;
  let body = null;
  let reachedEnd = false;
  const res = {
    status(c) {
      statusCode = c;
      return this;
    },
    json(b) {
      body = b;
      return this;
    },
  };
  let idx = 0;
  const next = async (err) => {
    if (err) {
      statusCode = 500;
      body = { error: err.message };
      return;
    }
    const fn = middlewares[idx++];
    if (fn) {
      await fn(req, res, next);
    } else {
      reachedEnd = true;
    }
  };
  await next();
  return { statusCode, body, reachedEnd, user: req.user };
};

// ════════════════════════════════════════════════════════════════════════════
// SLICE 1: Seam A — Auth & Firestore Role Fallback Middleware
// ════════════════════════════════════════════════════════════════════════════
console.log('=== Slice 1: Seam A — Auth & Firestore Role Fallback Middleware ===');

mockState.tokens.set('token-sec-noclaim', { uid: 'u-sec', email: 'sec@ctu.edu.ph' });
mockState.users.set('u-sec', { role: 'secretary', name: 'Sec. Maria' });

mockState.tokens.set('token-member', { uid: 'u-mem', email: 'mem@ctu.edu.ph' });
mockState.users.set('u-mem', { role: 'member', name: 'Student Member' });

const s1Unauth = await runMiddlewareChain(
  [authMiddleware.authenticate],
  { headers: {}, query: {} }
);
check('authenticate rejects missing token with 401', s1Unauth.statusCode === 401);

const s1FirestoreRole = await runMiddlewareChain(
  [
    authMiddleware.authenticate,
    authMiddleware.requireRole('admin', 'secretary'),
  ],
  { headers: { authorization: 'Bearer token-sec-noclaim' }, query: {} }
);
check(
  'requireRole resolves users/{uid}.role from Firestore when custom claim is absent',
  s1FirestoreRole.reachedEnd === true && s1FirestoreRole.user?.role === 'secretary',
  `got status=${s1FirestoreRole.statusCode}, role=${s1FirestoreRole.user?.role}`
);

const s1MemberDenied = await runMiddlewareChain(
  [
    authMiddleware.authenticate,
    authMiddleware.requireRole('admin', 'secretary'),
  ],
  { headers: { authorization: 'Bearer token-member' }, query: {} }
);
check(
  'requireRole rejects member role with 403',
  s1MemberDenied.statusCode === 403 && s1MemberDenied.reachedEnd === false,
  `got status=${s1MemberDenied.statusCode}`
);

check(
  'DOCUMENT_ARCHIVE_ROLES and DOCUMENT_DELETE_ROLES are exported by auth middleware',
  Array.isArray(authMiddleware.DOCUMENT_ARCHIVE_ROLES) &&
    Array.isArray(authMiddleware.DOCUMENT_DELETE_ROLES) &&
    !authMiddleware.DOCUMENT_ARCHIVE_ROLES.includes('member') &&
    !authMiddleware.DOCUMENT_DELETE_ROLES.includes('member')
);

// Helper to invoke an Express router route by method + path
const invokeRoute = async (router, method, path, reqOverrides = {}) => {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]
  );
  if (!layer) {
    return { statusCode: 404, body: { error: `Route ${method.toUpperCase()} ${path} not found` }, missingRoute: true };
  }
  const req = {
    headers: {},
    query: {},
    params: {},
    body: {},
    ...reqOverrides,
  };
  const handlers = layer.route.stack.map((s) => s.handle);
  return runMiddlewareChain(handlers, req);
};

// ════════════════════════════════════════════════════════════════════════════
// SLICE 2: Seam B — Express AI Router Security & /correctClassification
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 2: Seam B — Express AI Router Security & /correctClassification ===');

const aiRouter = require('../backend/routes/ai.js');

for (const endpoint of ['/analyzeDocument', '/confirmAnalysis', '/recordSignature', '/correctClassification']) {
  const unauthRes = await invokeRoute(aiRouter, 'post', endpoint, {
    headers: {},
    body: { documentId: 'doc-101', labelSlug: 'memorandum', index: 0, signed: true },
  });
  check(
    `Unauthenticated POST /api/ai${endpoint} returns 401`,
    unauthRes.statusCode === 401,
    `got status=${unauthRes.statusCode}`
  );

  const memberRes = await invokeRoute(aiRouter, 'post', endpoint, {
    headers: { authorization: 'Bearer token-member' },
    body: { documentId: 'doc-101', labelSlug: 'memorandum', index: 0, signed: true },
  });
  check(
    `Low-privilege member POST /api/ai${endpoint} returns 403`,
    memberRes.statusCode === 403,
    `got status=${memberRes.statusCode}`
  );
}

const statusRes = await invokeRoute(aiRouter, 'get', '/status', {});
check(
  'GET /api/ai/status does not leak apiKeyHint or openrouterKeyHint substrings',
  statusRes.statusCode === 200 &&
    !('apiKeyHint' in (statusRes.body || {})) &&
    !('openrouterKeyHint' in (statusRes.body || {})),
  `got keys=${Object.keys(statusRes.body || {}).join(',')}`
);

// Setup fixture document for /correctClassification
mockState.documents.set('doc-101', {
  title: 'Memo on Campus Cleanliness',
  labels: ['resolution'],
  aiState: 'suggested',
  aiSuggestion: { documentType: 'resolution', confidence: 0.72 },
  verifiedFields: ['title'],
});

const missingArgsRes = await invokeRoute(aiRouter, 'post', '/correctClassification', {
  headers: { authorization: 'Bearer token-sec-noclaim' },
  body: { documentId: 'doc-101' },
});
check(
  'POST /api/ai/correctClassification rejects missing labelSlug with 400',
  missingArgsRes.statusCode === 400,
  `got status=${missingArgsRes.statusCode}`
);

const notFoundRes = await invokeRoute(aiRouter, 'post', '/correctClassification', {
  headers: { authorization: 'Bearer token-sec-noclaim' },
  body: { documentId: 'doc-nonexistent', labelSlug: 'memorandum', reason: 'Fix' },
});
check(
  'POST /api/ai/correctClassification returns 404 for unknown document',
  notFoundRes.statusCode === 404 && !notFoundRes.missingRoute,
  `got status=${notFoundRes.statusCode}, missingRoute=${notFoundRes.missingRoute}`
);

const correctRes = await invokeRoute(aiRouter, 'post', '/correctClassification', {
  headers: { authorization: 'Bearer token-sec-noclaim' },
  body: {
    documentId: 'doc-101',
    labelSlug: 'memorandum',
    reason: 'Header states Memorandum No. 12',
  },
});
const updatedDoc101 = mockState.documents.get('doc-101');
const corrAudit = mockState.auditLogs.find(
  (a) => a.documentId === 'doc-101' && a.action === 'classification_corrected'
);
check(
  'POST /api/ai/correctClassification updates document metadata, verifiedFields, and auditLogs',
  correctRes.statusCode === 200 &&
    correctRes.body?.ok === true &&
    correctRes.body?.from === 'resolution' &&
    correctRes.body?.to === 'memorandum' &&
    updatedDoc101?.aiState === 'corrected' &&
    updatedDoc101?.labels?.[0] === 'memorandum' &&
    updatedDoc101?.correctedBy === 'u-sec' &&
    updatedDoc101?.correctedByName === 'Sec. Maria' &&
    updatedDoc101?.verifiedFields?.includes('documentType') &&
     updatedDoc101?.verifiedFields?.includes('title') &&
    Boolean(corrAudit) &&
    corrAudit?.details?.to === 'memorandum',
  `got status=${correctRes.statusCode}, body=${JSON.stringify(correctRes.body)}`
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 3: Seam C — Express Documents Router Role Enforcement & Deletion Guards
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 3: Seam C — Express Documents Router Role Enforcement & Deletion Guards ===');

const docRouter = require('../backend/routes/documents.js');

mockState.documents.set('doc-del-1', {
  title: 'Resolution No. 2026-99',
  mongoFileId: 'grid-del-1',
});
mockState.gridFsMetadata.set('grid-del-1', {
  _id: 'grid-del-1',
  filename: 'Resolution99.pdf',
  length: 4096,
  metadata: { driveFileId: 'drive-del-1' },
});

const unauthDelFs = await invokeRoute(docRouter, 'delete', '/firestore/:documentId', {
  headers: {},
  params: { documentId: 'doc-del-1' },
});
check(
  'Unauthenticated DELETE /api/documents/firestore/:documentId returns 401',
  unauthDelFs.statusCode === 401,
  `got status=${unauthDelFs.statusCode}`
);

const memberDelFs = await invokeRoute(docRouter, 'delete', '/firestore/:documentId', {
  headers: { authorization: 'Bearer token-member' },
  params: { documentId: 'doc-del-1' },
});
check(
  'Low-privilege member DELETE /api/documents/firestore/:documentId returns 403 and preserves document',
  memberDelFs.statusCode === 403 && mockState.documents.has('doc-del-1'),
  `got status=${memberDelFs.statusCode}, docExists=${mockState.documents.has('doc-del-1')}`
);

const memberDelGrid = await invokeRoute(docRouter, 'delete', '/:fileId', {
  headers: { authorization: 'Bearer token-member' },
  params: { fileId: 'grid-del-1' },
});
check(
  'Low-privilege member DELETE /api/documents/:fileId returns 403 and preserves GridFS file',
  memberDelGrid.statusCode === 403 && mockState.gridFsMetadata.has('grid-del-1'),
  `got status=${memberDelGrid.statusCode}`
);

const memberList = await invokeRoute(docRouter, 'get', '/list', {
  headers: { authorization: 'Bearer token-member' },
});
check(
  'Low-privilege member GET /api/documents/list returns 403',
  memberList.statusCode === 403,
  `got status=${memberList.statusCode}`
);

const secDelFs = await invokeRoute(docRouter, 'delete', '/firestore/:documentId', {
  headers: { authorization: 'Bearer token-sec-noclaim' },
  params: { documentId: 'doc-del-1' },
});
check(
  'Authorized secretary DELETE /api/documents/firestore/:documentId deletes Firestore doc, GridFS binary, and Drive mirror',
  secDelFs.statusCode === 200 &&
    !mockState.documents.has('doc-del-1') &&
    mockState.deletedGridFsIds.includes('grid-del-1') &&
    mockState.deletedDriveIds.includes('drive-del-1'),
  `got status=${secDelFs.statusCode}`
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 4: Seam D — Client Fallback in documentAiService.js & Render Firebase Admin Config
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 4: Seam D — Client Fallback in documentAiService.js & Render Firebase Admin Config ===');

const docAiServiceSrc = readFileSync(
  new URL('../src/services/documentAiService.js', import.meta.url),
  'utf8'
);
check(
  'documentAiService.js correctClassification includes direct Firestore fallback when backend/callable fails',
  /export const correctClassification = async[\s\S]*?catch[\s\S]*?aiState:\s*['"]corrected['"]/.test(docAiServiceSrc)
);

const fbAdminSrc = readFileSync(
  new URL('../backend/services/firebase-admin.js', import.meta.url),
  'utf8'
);
check(
  'backend/services/firebase-admin.js supports FIREBASE_SERVICE_ACCOUNT JSON env var in addition to split env vars',
  fbAdminSrc.includes('FIREBASE_SERVICE_ACCOUNT')
);

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\n✅ All checks passed.');
}
