/**
 * TDD & Bug-Diagnosis Security Regression Suite:
 *   1. Firebase ID JWT Exposed in URL Query String (?token=) Globally Across Express API
 *      (backend/middleware/auth.js + src/services/fileStore/mongoStore.js)
 *   2. Missing Role Guard on POST /api/documents/:fileId/drive-sync (IDOR & Link Disclosure)
 *      (backend/routes/documents.js)
 *
 * Tests real runtime behavior at the public Express middleware, router, and client store seams.
 * Run: node scripts/document-token-drivesync-tdd.mjs
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

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

// ════════════════════════════════════════════════════════════════════════════
// Mocked External Boundaries (Firebase Admin, GridFS, DriveSync, MongoDB)
// ════════════════════════════════════════════════════════════════════════════
const mockState = {
  tokens: new Map(),
  users: new Map(),
  documents: new Map(),
  gridFsMetadata: new Map(),
  verifyCalls: [],
  downloadStreamCalls: [],
  deletedGridFsIds: [],
  mirrorUploadCalls: [],
  telegramCalls: [],
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
    if (name === 'documents') {
      return {
        doc(docId) {
          return {
            async get() {
              const data = mockState.documents.get(docId);
              return { exists: Boolean(data), data: () => data };
            },
            async update(patch) {
              const curr = mockState.documents.get(docId) || {};
              mockState.documents.set(docId, { ...curr, ...patch });
            },
            async delete() {
              mockState.documents.delete(docId);
            },
          };
        },
      };
    }
    return {
      async get() {
        return { empty: true, docs: [] };
      },
    };
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
    verifyIdToken: async (token, checkRevoked) => {
      mockState.verifyCalls.push({ token, checkRevoked });
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

const mongodbPath = require.resolve('../backend/services/mongodb.js');
require.cache[mongodbPath] = {
  id: mongodbPath,
  filename: mongodbPath,
  loaded: true,
  exports: {
    getDatabase: async () => ({
      collection: () => ({
        updateOne: async () => ({ modifiedCount: 1 }),
        countDocuments: async () => mockState.gridFsMetadata.size,
      }),
      admin: () => ({ ping: async () => ({ ok: 1 }) }),
    }),
  },
};

const gridFsPath = require.resolve('../backend/utils/gridfs.js');
require.cache[gridFsPath] = {
  id: gridFsPath,
  filename: gridFsPath,
  loaded: true,
  exports: {
    uploadFileToGridFS: async () => ({ fileId: '507f1f77bcf86cd799439011', filename: 'test.pdf', size: 12 }),
    getDownloadStream: async (fileId) => {
      mockState.downloadStreamCalls.push(fileId);
      const handlers = {};
      return {
        pipe(res) {
          res.streamedBytes = Buffer.from('%PDF-1.7\nhello');
          setImmediate(() => handlers.end && handlers.end());
          return res;
        },
        on(evt, fn) {
          handlers[evt] = fn;
          return this;
        },
      };
    },
    getFileMetadata: async (fileId) => mockState.gridFsMetadata.get(fileId) || null,
    deleteFileFromGridFS: async (fileId) => {
      mockState.deletedGridFsIds.push(fileId);
      mockState.gridFsMetadata.delete(fileId);
    },
    listFiles: async () => [],
    downloadFileFromGridFS: async () => Buffer.from('%PDF-1.7\nconfidential resolution'),
  },
};

const driveSyncPath = require.resolve('../backend/services/driveSync.js');
require.cache[driveSyncPath] = {
  id: driveSyncPath,
  filename: driveSyncPath,
  loaded: true,
  exports: {
    isEnabled: () => true,
    authMode: () => 'service_account',
    mirrorUpload: async (buffer, filename, mimeType, meta) => {
      mockState.mirrorUploadCalls.push({ filename, mimeType, meta, size: buffer?.length || 0 });
      return {
        driveFileId: `drive-mirror-${meta.mongoFileId}`,
        webViewLink: `https://drive.google.com/file/d/drive-mirror-${meta.mongoFileId}/view`,
        folderName: meta.folder || 'Documents',
      };
    },
    deleteMirror: async () => {},
  },
};

// Load actual middleware and routers under test
const authMiddleware = require('../backend/middleware/auth.js');
const docRouter = require('../backend/routes/documents.js');
const aiRouter = require('../backend/routes/ai.js');
const telegramRouter = require('../backend/routes/telegram.js');

telegramRouter.__setTransportForTest(async (reqInfo) => {
  mockState.telegramCalls.push(reqInfo);
  return { data: { ok: true, result: { message_id: 9001 } } };
});

// Seed realistic users & tokens
const ADMIN_JWT = 'eyJhbGciOiJSUzI1NiJ9.admin-jwt-payload.sig';
const SECRETARY_JWT = 'eyJhbGciOiJSUzI1NiJ9.secretary-jwt-payload.sig';
const MEMBER_JWT = 'eyJhbGciOiJSUzI1NiJ9.member-jwt-payload.sig';
const GUEST_JWT = 'eyJhbGciOiJSUzI1NiJ9.guest-jwt-payload.sig';
const DEACTIVATED_SEC_JWT = 'eyJhbGciOiJSUzI1NiJ9.deactivated-sec-payload.sig';

mockState.tokens.set(ADMIN_JWT, { uid: 'u-admin', email: 'admin@ctu.edu.ph' });
mockState.users.set('u-admin', { role: 'admin', name: 'SSG Admin', isActive: true });

mockState.tokens.set(SECRETARY_JWT, { uid: 'u-sec', email: 'sec@ctu.edu.ph' });
mockState.users.set('u-sec', { role: 'secretary', name: 'SSG Secretary', isActive: true });

mockState.tokens.set(MEMBER_JWT, { uid: 'u-mem', email: 'member@ctu.edu.ph' });
mockState.users.set('u-mem', { role: 'member', name: 'Student Member', isActive: true });

mockState.tokens.set(GUEST_JWT, { uid: 'u-guest', email: 'guest@ctu.edu.ph' });
mockState.users.set('u-guest', { role: 'guest', name: 'Campus Guest', isActive: true });

mockState.tokens.set(DEACTIVATED_SEC_JWT, { uid: 'u-deact', email: 'former-sec@ctu.edu.ph' });
mockState.users.set('u-deact', { role: 'secretary', name: 'Former Secretary', isActive: false });

// Seed GridFS & Firestore fixtures
const FILE_SYNCED_ID = '507f1f77bcf86cd799439011';
const FILE_UNSYNCED_ID = '507f1f77bcf86cd799439022';

mockState.gridFsMetadata.set(FILE_SYNCED_ID, {
  _id: FILE_SYNCED_ID,
  filename: 'Confidential_Budget_Resolution.pdf',
  length: 14,
  metadata: {
    mimeType: 'application/pdf',
    documentId: 'doc-secret-1',
    driveFileId: 'drive-existing-secret-999',
    driveWebViewLink: 'https://drive.google.com/file/d/drive-existing-secret-999/view',
  },
});

mockState.gridFsMetadata.set(FILE_UNSYNCED_ID, {
  _id: FILE_UNSYNCED_ID,
  filename: 'Executive_Board_Minutes.pdf',
  length: 31,
  metadata: {
    mimeType: 'application/pdf',
    documentId: 'doc-secret-2',
    folder: 'Documents',
    documentType: 'minutes_of_meeting',
  },
});

mockState.documents.set('doc-secret-1', {
  title: 'Confidential Budget Resolution',
  mongoFileId: FILE_SYNCED_ID,
});

// Express route / middleware harness
const runMiddlewareChain = async (middlewares, req) => {
  let statusCode = 200;
  let body = null;
  let reachedEnd = false;
  const headers = {};
  const res = {
    headersSent: false,
    streamedBytes: null,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
      return this;
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    status(c) {
      statusCode = c;
      return this;
    },
    json(b) {
      body = b;
      this.headersSent = true;
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
  return { statusCode, body, headers, reachedEnd, user: req.user, streamedBytes: res.streamedBytes };
};

const invokeRoute = async (router, method, routePath, reqOverrides = {}) => {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method.toLowerCase()]
  );
  if (!layer) {
    return { statusCode: 404, body: { error: `Route ${method.toUpperCase()} ${routePath} not found` }, missingRoute: true };
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
// SLICE 1: Global ?token= Query-String JWT Rejection in auth.js & Express API
// ════════════════════════════════════════════════════════════════════════════
console.log('=== Slice 1: Reject ?token= Query-String JWTs Globally ===');

const verifyBeforeQueryTest = mockState.verifyCalls.length;
const queryOnlyAuth = await runMiddlewareChain(
  [authMiddleware.authenticate],
  { headers: {}, query: { token: ADMIN_JWT } }
);
check(
  'authenticate rejects ?token=<valid-jwt> query parameter with HTTP 401',
  queryOnlyAuth.statusCode === 401 && !queryOnlyAuth.reachedEnd && !queryOnlyAuth.user,
  `got status=${queryOnlyAuth.statusCode}, reachedEnd=${queryOnlyAuth.reachedEnd}, user=${JSON.stringify(queryOnlyAuth.user)}`
);
check(
  'authenticate does NOT pass ?token= query parameter to verifyIdToken()',
  mockState.verifyCalls.length === verifyBeforeQueryTest,
  `verifyIdToken was called ${mockState.verifyCalls.length - verifyBeforeQueryTest} time(s)`
);
check(
  'authenticate 401 message does not advertise ?token= query parameter',
  typeof queryOnlyAuth.body?.message === 'string' && !queryOnlyAuth.body.message.includes('?token='),
  `got message="${queryOnlyAuth.body?.message}"`
);

const headerAuth = await runMiddlewareChain(
  [authMiddleware.authenticate],
  { headers: { authorization: `Bearer ${ADMIN_JWT}` }, query: {} }
);
check(
  'authenticate accepts valid Authorization: Bearer <jwt> header',
  headerAuth.reachedEnd === true && headerAuth.user?.uid === 'u-admin',
  `got status=${headerAuth.statusCode}, uid=${headerAuth.user?.uid}`
);

const optQueryOnly = await runMiddlewareChain(
  [authMiddleware.optionalAuthenticate],
  { headers: {}, query: { token: ADMIN_JWT } }
);
check(
  'optionalAuthenticate ignores ?token= query parameter and leaves req.user null',
  optQueryOnly.reachedEnd === true && optQueryOnly.user === null,
  `got user=${JSON.stringify(optQueryOnly.user)}`
);

// Cross-router proof that ?token=<admin-jwt> cannot authenticate ANY protected Express endpoint
const queryTokenAttacks = [
  {
    name: 'GET /api/documents/:fileId/download?token=<admin-jwt>',
    router: docRouter,
    method: 'get',
    routePath: '/:fileId/download',
    req: { params: { fileId: FILE_SYNCED_ID }, query: { token: ADMIN_JWT } },
  },
  {
    name: 'DELETE /api/documents/:fileId?token=<admin-jwt>',
    router: docRouter,
    method: 'delete',
    routePath: '/:fileId',
    req: { params: { fileId: FILE_SYNCED_ID }, query: { token: ADMIN_JWT } },
  },
  {
    name: 'DELETE /api/documents/firestore/:documentId?token=<admin-jwt>',
    router: docRouter,
    method: 'delete',
    routePath: '/firestore/:documentId',
    req: { params: { documentId: 'doc-secret-1' }, query: { token: ADMIN_JWT } },
  },
  {
    name: 'POST /api/documents/:fileId/drive-sync?token=<admin-jwt>',
    router: docRouter,
    method: 'post',
    routePath: '/:fileId/drive-sync',
    req: { params: { fileId: FILE_UNSYNCED_ID }, query: { token: ADMIN_JWT } },
  },
  {
    name: 'POST /api/ai/analyzeDocument?token=<admin-jwt>',
    router: aiRouter,
    method: 'post',
    routePath: '/analyzeDocument',
    req: { body: { documentId: 'doc-secret-1' }, query: { token: ADMIN_JWT } },
  },
  {
    name: 'POST /api/telegram/send?token=<admin-jwt>',
    router: telegramRouter,
    method: 'post',
    routePath: '/send',
    req: { body: { channel: 'faculty', message: 'Injected broadcast' }, query: { token: ADMIN_JWT } },
  },
  {
    name: 'POST /api/telegram/delete?token=<admin-jwt>',
    router: telegramRouter,
    method: 'post',
    routePath: '/delete',
    req: { body: { channel: 'faculty', messageId: 9001 }, query: { token: ADMIN_JWT } },
  },
];

for (const attack of queryTokenAttacks) {
  const res = await invokeRoute(attack.router, attack.method, attack.routePath, attack.req);
  check(
    `Query-string token rejected with 401 on ${attack.name}`,
    res.statusCode === 401 && !res.reachedEnd,
    `got status=${res.statusCode}, body=${JSON.stringify(res.body)}`
  );
}
check(
  'No GridFS download, deletion, Drive mirror, or Telegram send executed via ?token= attacks',
  mockState.downloadStreamCalls.length === 0 &&
    mockState.deletedGridFsIds.length === 0 &&
    mockState.mirrorUploadCalls.length === 0 &&
    mockState.telegramCalls.length === 0 &&
    mockState.documents.has('doc-secret-1') &&
    mockState.gridFsMetadata.has(FILE_SYNCED_ID),
  `downloads=${mockState.downloadStreamCalls.length}, deletes=${mockState.deletedGridFsIds.length}, mirrors=${mockState.mirrorUploadCalls.length}, telegram=${mockState.telegramCalls.length}`
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 2: Role Guard on POST /api/documents/:fileId/drive-sync & Download Headers
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 2: Role Guard on POST /:fileId/drive-sync & GET /drive/status ===');

const driveSyncUnauth = await invokeRoute(docRouter, 'post', '/:fileId/drive-sync', {
  params: { fileId: FILE_SYNCED_ID },
});
check(
  'Unauthenticated POST /api/documents/:fileId/drive-sync returns 401',
  driveSyncUnauth.statusCode === 401 && !driveSyncUnauth.body?.data?.driveFileId,
  `got status=${driveSyncUnauth.statusCode}`
);

const memberSyncExisting = await invokeRoute(docRouter, 'post', '/:fileId/drive-sync', {
  headers: { authorization: `Bearer ${MEMBER_JWT}` },
  params: { fileId: FILE_SYNCED_ID },
});
check(
  'Signed-in member CANNOT obtain driveFileId/webViewLink via POST /:fileId/drive-sync (403)',
  memberSyncExisting.statusCode === 403 &&
    !memberSyncExisting.body?.data?.driveFileId &&
    !memberSyncExisting.body?.data?.webViewLink,
  `got status=${memberSyncExisting.statusCode}, body=${JSON.stringify(memberSyncExisting.body)}`
);

const memberSyncTrigger = await invokeRoute(docRouter, 'post', '/:fileId/drive-sync', {
  headers: { authorization: `Bearer ${MEMBER_JWT}` },
  params: { fileId: FILE_UNSYNCED_ID },
});
check(
  'Signed-in member CANNOT trigger Drive mirroring for unsynced file (403, zero mirrorUpload calls)',
  memberSyncTrigger.statusCode === 403 && mockState.mirrorUploadCalls.length === 0,
  `got status=${memberSyncTrigger.statusCode}, mirrorCalls=${mockState.mirrorUploadCalls.length}`
);

const guestSyncExisting = await invokeRoute(docRouter, 'post', '/:fileId/drive-sync', {
  headers: { authorization: `Bearer ${GUEST_JWT}` },
  params: { fileId: FILE_SYNCED_ID },
});
check(
  'Signed-in guest CANNOT call POST /:fileId/drive-sync (403, no link disclosure)',
  guestSyncExisting.statusCode === 403 &&
    !guestSyncExisting.body?.data?.driveFileId &&
    !guestSyncExisting.body?.data?.webViewLink,
  `got status=${guestSyncExisting.statusCode}, body=${JSON.stringify(guestSyncExisting.body)}`
);

const deactivatedSync = await invokeRoute(docRouter, 'post', '/:fileId/drive-sync', {
  headers: { authorization: `Bearer ${DEACTIVATED_SEC_JWT}` },
  params: { fileId: FILE_SYNCED_ID },
});
check(
  'Deactivated secretary (isActive: false) CANNOT call POST /:fileId/drive-sync (403)',
  deactivatedSync.statusCode === 403 && !deactivatedSync.body?.data?.driveFileId,
  `got status=${deactivatedSync.statusCode}`
);

const secSyncExisting = await invokeRoute(docRouter, 'post', '/:fileId/drive-sync', {
  headers: { authorization: `Bearer ${SECRETARY_JWT}` },
  params: { fileId: FILE_SYNCED_ID },
});
check(
  'Authorized secretary CAN inspect already-synced file via POST /:fileId/drive-sync (200)',
  secSyncExisting.statusCode === 200 &&
    secSyncExisting.body?.data?.driveFileId === 'drive-existing-secret-999' &&
    secSyncExisting.body?.data?.webViewLink === 'https://drive.google.com/file/d/drive-existing-secret-999/view',
  `got status=${secSyncExisting.statusCode}, body=${JSON.stringify(secSyncExisting.body)}`
);

const adminSyncUnsynced = await invokeRoute(docRouter, 'post', '/:fileId/drive-sync', {
  headers: { authorization: `Bearer ${ADMIN_JWT}` },
  params: { fileId: FILE_UNSYNCED_ID },
});
check(
  'Authorized admin CAN trigger Drive mirroring for unsynced file via POST /:fileId/drive-sync (200)',
  adminSyncUnsynced.statusCode === 200 &&
    mockState.mirrorUploadCalls.length === 1 &&
    adminSyncUnsynced.body?.data?.driveFileId === `drive-mirror-${FILE_UNSYNCED_ID}`,
  `got status=${adminSyncUnsynced.statusCode}, mirrorCalls=${mockState.mirrorUploadCalls.length}, body=${JSON.stringify(adminSyncUnsynced.body)}`
);

const memberDriveStatus = await invokeRoute(docRouter, 'get', '/drive/status', {
  headers: { authorization: `Bearer ${MEMBER_JWT}` },
});
check(
  'Signed-in member CANNOT probe GET /api/documents/drive/status (403)',
  memberDriveStatus.statusCode === 403,
  `got status=${memberDriveStatus.statusCode}`
);

const guestDriveStatus = await invokeRoute(docRouter, 'get', '/drive/status', {
  headers: { authorization: `Bearer ${GUEST_JWT}` },
});
check(
  'Signed-in guest CANNOT probe GET /api/documents/drive/status (403)',
  guestDriveStatus.statusCode === 403,
  `got status=${guestDriveStatus.statusCode}`
);

const secDriveStatus = await invokeRoute(docRouter, 'get', '/drive/status', {
  headers: { authorization: `Bearer ${SECRETARY_JWT}` },
});
check(
  'Authorized secretary CAN check GET /api/documents/drive/status (200)',
  secDriveStatus.statusCode === 200 && secDriveStatus.body?.data?.enabled === true,
  `got status=${secDriveStatus.statusCode}, body=${JSON.stringify(secDriveStatus.body)}`
);

const secDownload = await invokeRoute(docRouter, 'get', '/:fileId/download', {
  headers: { authorization: `Bearer ${SECRETARY_JWT}` },
  params: { fileId: FILE_SYNCED_ID },
  query: { disposition: 'inline' },
});
check(
  'Authorized GET /:fileId/download via Bearer header streams file with Referrer-Policy & nosniff headers',
  secDownload.statusCode === 200 &&
    secDownload.headers['referrer-policy'] === 'no-referrer' &&
    secDownload.headers['x-content-type-options'] === 'nosniff',
  `status=${secDownload.statusCode}, referrer-policy=${secDownload.headers['referrer-policy']}, nosniff=${secDownload.headers['x-content-type-options']}`
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 3: mongoStore.js Real Runtime Execution — Zero ?token= Exposure + Blob Lifecycle
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 3: mongoStore.js Runtime Behavior (Blob URLs + Bearer Auth + Revocation) ===');

const firebaseStubPlugin = {
  name: 'firebase-config-stub',
  setup(build) {
    build.onResolve({ filter: /firebaseConfig/ }, () => ({
      path: 'virtual:firebaseConfig',
      namespace: 'stub',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export const auth = globalThis.__TEST_FIREBASE_AUTH__;',
      loader: 'js',
    }));
  },
};

const bundledMongoStore = await esbuild({
  entryPoints: [path.join(ROOT, 'src/services/fileStore/mongoStore.js')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  define: {
    'import.meta.env.VITE_MONGODB_BACKEND_URL': JSON.stringify('https://api.shirio.test'),
  },
  plugins: [firebaseStubPlugin],
});

const TEST_JWT = 'eyJhbGciOiJSUzI1NiJ9.client-secret-bearer-token.signature';
const fetchCalls = [];
const createdBlobUrls = [];
const revokedBlobUrls = [];
let blobSeq = 0;

globalThis.__TEST_FIREBASE_AUTH__ = {
  currentUser: {
    async getIdToken() {
      return TEST_JWT;
    },
  },
};

const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

globalThis.fetch = async (url, init = {}) => {
  const urlStr = String(url);
  fetchCalls.push({ url: urlStr, method: init.method || 'GET', headers: init.headers || {} });

  if (init.method === 'DELETE') {
    return {
      ok: true,
      status: 200,
      async json() {
        return { success: true };
      },
    };
  }
  if (urlStr.includes('/missing-file/')) {
    return { ok: false, status: 404, headers: new Headers(), async blob() { return new Blob(); } };
  }
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/pdf' }),
    async blob() {
      return new Blob(['%PDF-1.7\nmock pdf bytes'], { type: 'application/pdf' });
    },
  };
};

URL.createObjectURL = (blob) => {
  blobSeq += 1;
  const u = `blob:https://shirio.test/obj-${blobSeq}`;
  createdBlobUrls.push({ url: u, size: blob?.size, type: blob?.type });
  return u;
};

URL.revokeObjectURL = (u) => {
  revokedBlobUrls.push(u);
};

try {
  const code = bundledMongoStore.outputFiles[0].text;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
  const { mongoStore } = await import(dataUrl);

  const inlineUrl = await mongoStore.getUrl(FILE_SYNCED_ID, { disposition: 'inline' });
  check(
    'mongoStore.getUrl() returns a blob: Object URL instead of an API URL',
    typeof inlineUrl === 'string' && inlineUrl.startsWith('blob:'),
    `got "${String(inlineUrl).slice(0, 80)}"`
  );
  check(
    'mongoStore.getUrl() NEVER exposes ?token= or the Firebase JWT in the returned URL',
    typeof inlineUrl === 'string' &&
      !inlineUrl.includes('?token=') &&
      !inlineUrl.includes('token=') &&
      !inlineUrl.includes(TEST_JWT),
    `got "${String(inlineUrl).slice(0, 80)}"`
  );

  const firstFetch = fetchCalls[0];
  check(
    'mongoStore.getUrl() authenticates download fetch strictly via Authorization: Bearer header without ?token= in URL',
    Boolean(firstFetch) &&
      firstFetch.headers?.Authorization === `Bearer ${TEST_JWT}` &&
      !firstFetch.url.includes('token=') &&
      !firstFetch.url.includes(TEST_JWT),
    `firstFetch=${JSON.stringify(firstFetch)}`
  );

  const cachedUrl = await mongoStore.getUrl(FILE_SYNCED_ID, { disposition: 'attachment' });
  check(
    'mongoStore.getUrl() reuses cached blob: URL for repeated access without re-fetching or leaking JWT',
    cachedUrl === inlineUrl && fetchCalls.length === 1 && !String(cachedUrl).includes(TEST_JWT),
    `cachedUrl=${cachedUrl}, fetchCount=${fetchCalls.length}`
  );

  const freshUrl = await mongoStore.getUrl(FILE_SYNCED_ID, { disposition: 'inline', fresh: true });
  check(
    'mongoStore.getUrl({ fresh: true }) revokes stale blob: URL and fetches a fresh blob: URL',
    typeof freshUrl === 'string' &&
      freshUrl.startsWith('blob:') &&
      freshUrl !== inlineUrl &&
      revokedBlobUrls.includes(inlineUrl) &&
      fetchCalls.length === 2,
    `freshUrl=${freshUrl}, revoked=${JSON.stringify(revokedBlobUrls)}, fetchCount=${fetchCalls.length}`
  );

  const missingUrl = await mongoStore.getUrl('missing-file');
  check(
    'mongoStore.getUrl() returns null when backend responds with 404/error (no broken URL cached)',
    missingUrl === null,
    `got ${JSON.stringify(missingUrl)}`
  );

  await mongoStore.delete(FILE_SYNCED_ID);
  const deleteCall = fetchCalls.find((c) => c.method === 'DELETE');
  check(
    'mongoStore.delete() revokes cached blob: URL and sends Bearer header without ?token=',
    revokedBlobUrls.includes(freshUrl) &&
      Boolean(deleteCall) &&
      deleteCall.headers?.Authorization === `Bearer ${TEST_JWT}` &&
      !deleteCall.url.includes('token='),
    `revoked=${JSON.stringify(revokedBlobUrls)}, deleteCall=${JSON.stringify(deleteCall)}`
  );

  const secondFileUrl = await mongoStore.getUrl(FILE_UNSYNCED_ID, { download: true });
  const downloadFetch = fetchCalls[fetchCalls.length - 1];
  check(
    'mongoStore.getUrl({ download: true }) requests disposition=attachment via Bearer header without ?token=',
    Boolean(downloadFetch) &&
      downloadFetch.url.includes('disposition=attachment') &&
      !downloadFetch.url.includes('token=') &&
      downloadFetch.headers?.Authorization === `Bearer ${TEST_JWT}`,
    `downloadFetch=${JSON.stringify(downloadFetch)}`
  );

  mongoStore.revokeAll();
  check(
    'mongoStore.revokeAll() revokes all cached blob: Object URLs cleanly',
    typeof secondFileUrl === 'string' &&
      secondFileUrl.startsWith('blob:') &&
      revokedBlobUrls.includes(secondFileUrl),
    `secondFileUrl=${secondFileUrl}, revoked=${JSON.stringify(revokedBlobUrls)}`
  );
} finally {
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  delete globalThis.__TEST_FIREBASE_AUTH__;
}

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\n✅ All checks passed.');
}
