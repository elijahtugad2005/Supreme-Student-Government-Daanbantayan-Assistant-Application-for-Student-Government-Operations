/**
 * TDD Regression Suite:
 *   Officer Google Drive Folder Links, Finance -> Inventory Receipt Linkage,
 *   and Document / Receipt Bug Fixes.
 *
 * Run: npm run test:drive-folders
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const { build: esbuild } = require('esbuild');

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
// SLICE 1: driveSync.getFolderLinks() & formatReceiptDriveFilename()
// ════════════════════════════════════════════════════════════════════════════
console.log('=== Slice 1: driveSync.getFolderLinks() & Origin-Tagged Receipt Naming ===');

const savedEnv = { ...process.env };
const clearDriveEnv = () => {
  delete process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET;
  delete process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN;
  delete process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_DRIVE_KEY_FILE;
  delete process.env.GOOGLE_DRIVE_FOLDER_ID;
};

// 1a. Test driveSync.getFolderLinks() in disabled mode (zero API calls)
clearDriveEnv();
const driveSyncPath = require.resolve(path.join(ROOT, 'backend/services/driveSync.js'));
delete require.cache[driveSyncPath];
const driveSyncDisabled = require(driveSyncPath);

check(
  'driveSync exports getFolderLinks and buildFolderUrl',
  typeof driveSyncDisabled.getFolderLinks === 'function' &&
    typeof driveSyncDisabled.buildFolderUrl === 'function',
  `getFolderLinks=${typeof driveSyncDisabled.getFolderLinks}, buildFolderUrl=${typeof driveSyncDisabled.buildFolderUrl}`
);

if (typeof driveSyncDisabled.getFolderLinks === 'function') {
  const resDisabled = await driveSyncDisabled.getFolderLinks();
  check(
    'getFolderLinks() returns enabled:false with null folders when Drive is disabled',
    resDisabled.enabled === false &&
      resDisabled.documentsFolder === null &&
      resDisabled.receiptsFolder === null,
    JSON.stringify(resDisabled)
  );
}

if (typeof driveSyncDisabled.buildFolderUrl === 'function') {
  check(
    'buildFolderUrl() builds canonical Google Drive folder URL',
    driveSyncDisabled.buildFolderUrl('1AbC_folderId-99') ===
      'https://drive.google.com/drive/folders/1AbC_folderId-99',
    String(driveSyncDisabled.buildFolderUrl('1AbC_folderId-99'))
  );
  check(
    'buildFolderUrl(null) returns null',
    driveSyncDisabled.buildFolderUrl(null) === null
  );
}

// 1b. Test driveSync.getFolderLinks() with mocked googleapis boundary
let listCalls = 0;
let failReceiptsLookup = false;
const googleapisPath = require.resolve('googleapis', { paths: [path.join(ROOT, 'backend')] });
const origGoogleapis = require.cache[googleapisPath];
require.cache[googleapisPath] = {
  id: googleapisPath,
  filename: googleapisPath,
  loaded: true,
  exports: {
    google: {
      auth: {
        OAuth2: class {
          setCredentials() {}
        },
      },
      drive: () => ({
        files: {
          get: async ({ fileId }) => ({ data: { id: fileId, name: 'SSG Document Archive', parents: [] } }),
          list: async ({ q }) => {
            listCalls += 1;
            if (q.includes("name='Documents'")) {
              return { data: { files: [{ id: 'drv-docs-123', name: 'Documents' }] } };
            }
            if (q.includes("name='Receipts'")) {
              if (failReceiptsLookup) throw new Error('Simulated Drive API timeout');
              return { data: { files: [{ id: 'drv-rcpt-456', name: 'Receipts' }] } };
            }
            return { data: { files: [] } };
          },
          create: async () => ({ data: { id: 'created-id' } }),
        },
      }),
    },
  },
};

process.env.GOOGLE_DRIVE_OAUTH_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN = 'test-refresh-token';
process.env.GOOGLE_DRIVE_FOLDER_ID = 'drv-root-000';
delete require.cache[driveSyncPath];
const driveSyncEnabled = require(driveSyncPath);

if (typeof driveSyncEnabled.getFolderLinks === 'function') {
  const allFolders = await driveSyncEnabled.getFolderLinks('all');
  check(
    'getFolderLinks("all") returns Documents and Receipts canonical URLs',
    allFolders.enabled === true &&
      allFolders.documentsFolder?.id === 'drv-docs-123' &&
      allFolders.documentsFolder?.url === 'https://drive.google.com/drive/folders/drv-docs-123' &&
      allFolders.receiptsFolder?.id === 'drv-rcpt-456' &&
      allFolders.receiptsFolder?.url === 'https://drive.google.com/drive/folders/drv-rcpt-456',
    JSON.stringify(allFolders)
  );

  const callsBeforeCache = listCalls;
  await driveSyncEnabled.getFolderLinks('receipts');
  check(
    'getFolderLinks("receipts") reuses cached folder ID with zero extra Drive API calls',
    listCalls === callsBeforeCache,
    `callsBefore=${callsBeforeCache}, callsAfter=${listCalls}`
  );

  // Error resilience: Receipts lookup fails while Documents still succeeds
  failReceiptsLookup = true;
  delete require.cache[driveSyncPath];
  const driveSyncPartial = require(driveSyncPath);
  const partial = await driveSyncPartial.getFolderLinks('all');
  check(
    'getFolderLinks() does not throw when one subfolder lookup fails (returns partial)',
    partial.enabled === true &&
      partial.documentsFolder?.id === 'drv-docs-123' &&
      partial.receiptsFolder === null,
    JSON.stringify(partial)
  );
}

// Restore env & googleapis cache
if (origGoogleapis) require.cache[googleapisPath] = origGoogleapis;
else delete require.cache[googleapisPath];
for (const k of Object.keys(process.env)) {
  if (!(k in savedEnv)) delete process.env[k];
}
Object.assign(process.env, savedEnv);

// 1c. Origin-tagged receipt Drive filename formatting
const docRouterPath = require.resolve(path.join(ROOT, 'backend/routes/documents.js'));
delete require.cache[docRouterPath];
const docRouter = require(docRouterPath);
const fmt = docRouter.__formatReceiptDriveFilename;

check(
  'Finance receipt formats as "[Finance] <Item> - Receipts.<ext>"',
  fmt('Sound System Rental', 'photo.jpg', 'SSG Finance') === '[Finance] Sound System Rental - Receipts.jpg',
  fmt('Sound System Rental', 'photo.jpg', 'SSG Finance')
);
check(
  'Inventory Asset receipt formats as "[Inventory] <Item> - Receipts.<ext>"',
  fmt('Bluetooth Speaker', 'or123.png', 'SSG Inventory') === '[Inventory] Bluetooth Speaker - Receipts.png',
  fmt('Bluetooth Speaker', 'or123.png', 'SSG Inventory')
);
check(
  'Inventory Consumable receipt formats as "[Inventory - Consumables] <Item> - Receipts.<ext>"',
  fmt('Chooks-to-Go Lunch', 'scan.pdf', 'SSG Inventory - Consumables') ===
    '[Inventory - Consumables] Chooks-to-Go Lunch - Receipts.pdf',
  fmt('Chooks-to-Go Lunch', 'scan.pdf', 'SSG Inventory - Consumables')
);
check(
  'Formatter is idempotent when prefix/suffix already present',
  fmt('[Finance] Sound System - Receipts', 'or.jpg', 'SSG Finance') ===
    '[Finance] Sound System - Receipts.jpg',
  fmt('[Finance] Sound System - Receipts', 'or.jpg', 'SSG Finance')
);
check(
  'Formatter works cleanly without origin (backward-compatible)',
  fmt('Generic Expense', 'receipt.pdf') === 'Generic Expense - Receipts.pdf',
  fmt('Generic Expense', 'receipt.pdf')
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 2: GET /api/documents/drive/folders (RBAC) & POST /upload error status
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 2: GET /api/documents/drive/folders & POST /upload Receipt Status ===');

const routeMockState = {
  tokens: new Map([
    ['jwt-admin', { uid: 'u-admin', email: 'admin@ctu.edu.ph' }],
    ['jwt-sec', { uid: 'u-sec', email: 'sec@ctu.edu.ph' }],
    ['jwt-fin', { uid: 'u-fin', email: 'fin@ctu.edu.ph' }],
    ['jwt-sen', { uid: 'u-sen', email: 'sen@ctu.edu.ph' }],
    ['jwt-mem', { uid: 'u-mem', email: 'mem@ctu.edu.ph' }],
    ['jwt-guest', { uid: 'u-guest', email: 'guest@ctu.edu.ph' }],
    ['jwt-deact', { uid: 'u-deact', email: 'deact@ctu.edu.ph' }],
  ]),
  users: new Map([
    ['u-admin', { role: 'admin', name: 'Admin', isActive: true }],
    ['u-sec', { role: 'secretary', name: 'Secretary', isActive: true }],
    ['u-fin', { role: 'finance_secretary', name: 'Finance Sec', isActive: true }],
    ['u-sen', { role: 'senator', name: 'Senator', isActive: true }],
    ['u-mem', { role: 'member', name: 'Member', isActive: true }],
    ['u-guest', { role: 'guest', name: 'Guest', isActive: true }],
    ['u-deact', { role: 'secretary', name: 'Former Sec', isActive: false }],
  ]),
  driveEnabled: true,
  failMirror: false,
  lastUploadedFilename: null,
};

const fbAdminPath = require.resolve(path.join(ROOT, 'backend/services/firebase-admin.js'));
require.cache[fbAdminPath] = {
  id: fbAdminPath,
  filename: fbAdminPath,
  loaded: true,
  exports: {
    verifyIdToken: async (tok) => {
      const d = routeMockState.tokens.get(tok);
      if (!d) {
        const e = new Error('Invalid token');
        e.code = 'auth/argument-error';
        throw e;
      }
      return d;
    },
    getFirestore: () => ({
      collection: (name) => ({
        doc: (uid) => ({
          get: async () => {
            const data = name === 'users' ? routeMockState.users.get(uid) : null;
            return { exists: Boolean(data), data: () => data };
          },
        }),
      }),
    }),
  },
};

const mongodbPath = require.resolve(path.join(ROOT, 'backend/services/mongodb.js'));
require.cache[mongodbPath] = {
  id: mongodbPath,
  filename: mongodbPath,
  loaded: true,
  exports: {
    getDatabase: async () => ({
      collection: () => ({ updateOne: async () => ({ modifiedCount: 1 }) }),
    }),
  },
};

const gridFsPath = require.resolve(path.join(ROOT, 'backend/utils/gridfs.js'));
require.cache[gridFsPath] = {
  id: gridFsPath,
  filename: gridFsPath,
  loaded: true,
  exports: {
    uploadFileToGridFS: async (_buf, filename) => {
      routeMockState.lastUploadedFilename = filename;
      return { fileId: '507f1f77bcf86cd799439088', filename, size: 16 };
    },
    getFileMetadata: async () => null,
    getDownloadStream: async () => null,
    deleteFileFromGridFS: async () => {},
    listFiles: async () => [],
    downloadFileFromGridFS: async () => Buffer.from('x'),
  },
};

require.cache[driveSyncPath] = {
  id: driveSyncPath,
  filename: driveSyncPath,
  loaded: true,
  exports: {
    isEnabled: () => routeMockState.driveEnabled,
    authMode: () => (routeMockState.driveEnabled ? 'oauth' : null),
    getFolderLinks: async (scope = 'all') => {
      if (!routeMockState.driveEnabled) {
        return { enabled: false, documentsFolder: null, receiptsFolder: null };
      }
      return {
        enabled: true,
        documentsFolder:
          scope === 'receipts'
            ? null
            : { id: 'docs-id-1', name: 'Documents', url: 'https://drive.google.com/drive/folders/docs-id-1' },
        receiptsFolder:
          scope === 'documents'
            ? null
            : { id: 'rcpt-id-2', name: 'Receipts', url: 'https://drive.google.com/drive/folders/rcpt-id-2' },
      };
    },
    mirrorUpload: async (_buf, filename) => {
      if (routeMockState.failMirror) throw new Error('Drive API 503');
      return {
        driveFileId: 'drive-file-99',
        webViewLink: 'https://drive.google.com/file/d/drive-file-99/view',
        folderName: 'Receipts',
        filename,
      };
    },
    deleteMirror: async () => {},
  },
};

// Reload auth + documents router with mocked boundaries
delete require.cache[require.resolve(path.join(ROOT, 'backend/middleware/auth.js'))];
delete require.cache[docRouterPath];
const routeDocRouter = require(docRouterPath);

const invokeRoute = (method, url, { headers = {}, query = {}, body = {}, file = null } = {}) =>
  new Promise((resolve) => {
    const req = {
      method: method.toUpperCase(),
      url,
      originalUrl: `/api/documents${url}`,
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      query,
      body,
      file,
      params: {},
    };
    let statusCode = 200;
    const res = {
      headersSent: false,
      setHeader() {},
      status(c) {
        statusCode = c;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        resolve({ statusCode, body: payload });
        return this;
      },
      send(payload) {
        this.headersSent = true;
        resolve({ statusCode, body: payload });
        return this;
      },
    };
    routeDocRouter.handle(req, res, () => resolve({ statusCode: 404, body: { error: 'Not found' } }));
  });

const rUnauth = await invokeRoute('GET', '/drive/folders');
check('Unauthenticated GET /drive/folders returns 401', rUnauth.statusCode === 401, `got ${rUnauth.statusCode}`);

const rQueryTok = await invokeRoute('GET', '/drive/folders?token=jwt-admin', { query: { token: 'jwt-admin' } });
check('Query-string ?token= on GET /drive/folders returns 401', rQueryTok.statusCode === 401, `got ${rQueryTok.statusCode}`);

const rMember = await invokeRoute('GET', '/drive/folders', { headers: { authorization: 'Bearer jwt-mem' } });
check('Member role blocked from GET /drive/folders (403)', rMember.statusCode === 403, `got ${rMember.statusCode}`);

const rGuest = await invokeRoute('GET', '/drive/folders', { headers: { authorization: 'Bearer jwt-guest' } });
check('Guest role blocked from GET /drive/folders (403)', rGuest.statusCode === 403, `got ${rGuest.statusCode}`);

const rDeact = await invokeRoute('GET', '/drive/folders', { headers: { authorization: 'Bearer jwt-deact' } });
check('Deactivated officer blocked from GET /drive/folders (403)', rDeact.statusCode === 403, `got ${rDeact.statusCode}`);

const rFin = await invokeRoute('GET', '/drive/folders', { headers: { authorization: 'Bearer jwt-fin' } });
check(
  'Finance Secretary gets 200 with Documents & Receipts Drive folder URLs',
  rFin.statusCode === 200 &&
    rFin.body?.data?.enabled === true &&
    rFin.body?.data?.documentsFolder?.url === 'https://drive.google.com/drive/folders/docs-id-1' &&
    rFin.body?.data?.receiptsFolder?.url === 'https://drive.google.com/drive/folders/rcpt-id-2',
  `status=${rFin.statusCode} body=${JSON.stringify(rFin.body)}`
);

const rSen = await invokeRoute('GET', '/drive/folders?folder=receipts', {
  headers: { authorization: 'Bearer jwt-sen' },
  query: { folder: 'receipts' },
});
check(
  'Senator gets 200 for scoped ?folder=receipts',
  rSen.statusCode === 200 &&
    rSen.body?.data?.receiptsFolder?.id === 'rcpt-id-2' &&
    rSen.body?.data?.documentsFolder === null,
  `status=${rSen.statusCode} body=${JSON.stringify(rSen.body)}`
);

routeMockState.driveEnabled = false;
const rDisabled = await invokeRoute('GET', '/drive/folders', { headers: { authorization: 'Bearer jwt-sec' } });
check(
  'GET /drive/folders returns enabled:false when Drive disabled',
  rDisabled.statusCode === 200 &&
    rDisabled.body?.data?.enabled === false &&
    rDisabled.body?.data?.receiptsFolder === null,
  `status=${rDisabled.statusCode} body=${JSON.stringify(rDisabled.body)}`
);
routeMockState.driveEnabled = true;

// Receipt upload: Finance origin tagging + accurate message on Drive mirror failure
routeMockState.failMirror = false;
const rUploadOk = await invokeRoute('POST', '/upload', {
  headers: { authorization: 'Bearer jwt-fin' },
  body: { folder: 'Receipts', documentType: 'receipt', title: 'Stage Lights', office: 'SSG Finance' },
  file: { originalname: 'or.jpg', mimetype: 'image/jpeg', size: 16, buffer: Buffer.from('img') },
});
check(
  'POST /upload for Finance receipt stores "[Finance] Stage Lights - Receipts.jpg" and returns driveWebViewLink',
  rUploadOk.statusCode === 200 &&
    routeMockState.lastUploadedFilename === '[Finance] Stage Lights - Receipts.jpg' &&
    rUploadOk.body?.data?.driveWebViewLink === 'https://drive.google.com/file/d/drive-file-99/view',
  `filename=${routeMockState.lastUploadedFilename} body=${JSON.stringify(rUploadOk.body)}`
);

routeMockState.failMirror = true;
const rUploadFail = await invokeRoute('POST', '/upload', {
  headers: { authorization: 'Bearer jwt-fin' },
  body: { folder: 'Receipts', documentType: 'receipt', title: 'Stage Lights', office: 'SSG Finance' },
  file: { originalname: 'or.jpg', mimetype: 'image/jpeg', size: 16, buffer: Buffer.from('img') },
});
check(
  'POST /upload when Drive mirror fails reports failed status without claiming "synced to Google Drive"',
  rUploadFail.statusCode === 200 &&
    rUploadFail.body?.data?.driveSyncStatus === 'failed' &&
    !/synced to Google Drive/i.test(rUploadFail.body?.message || ''),
  `status=${rUploadFail.statusCode} msg="${rUploadFail.body?.message}" driveStatus=${rUploadFail.body?.data?.driveSyncStatus}`
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 3: driveStore.getFolders(), mongoStore auth error, documentService legacy,
//          and documentLabels.canPreviewInline()
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 3: Client Drive Adapter, Auth Errors & Legacy Doc Routing ===');

const tmpDir = path.join(ROOT, 'node_modules/.tmp');
fs.mkdirSync(tmpDir, { recursive: true });

// 3a. driveStore.getFolders() & getFolderUrl()
const outDriveStore = path.join(tmpDir, 'tdd-drive-store.mjs');
await esbuild({
  entryPoints: [path.join(ROOT, 'src/services/fileStore/driveStore.js')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  define: { 'import.meta.env': JSON.stringify({ VITE_MONGODB_BACKEND_URL: 'https://api.example.test' }) },
  outfile: outDriveStore,
  plugins: [
    {
      name: 'mock-fb-drive',
      setup(b) {
        b.onResolve({ filter: /firebaseConfig/ }, () => ({ path: 'fb-drive', namespace: 'm' }));
        b.onLoad({ filter: /.*/, namespace: 'm' }, () => ({
          contents: `
            export const auth = {
              currentUser: { getIdToken: async () => 'fake-bearer-tok' },
            };
          `,
          loader: 'js',
        }));
      },
    },
  ],
});

const { driveStore } = await import(`file:///${outDriveStore.replace(/\\/g, '/')}?t=${Date.now()}`);
check(
  'driveStore exports getFolders and getFolderUrl',
  typeof driveStore.getFolders === 'function' && typeof driveStore.getFolderUrl === 'function',
  `getFolders=${typeof driveStore.getFolders}, getFolderUrl=${typeof driveStore.getFolderUrl}`
);

const origFetch = globalThis.fetch;
if (typeof driveStore.getFolders === 'function') {
  let fetchCalls = [];
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, headers: init?.headers || {} });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          enabled: true,
          documentsFolder: { id: 'd1', name: 'Documents', url: 'https://drive.google.com/drive/folders/d1' },
          receiptsFolder: { id: 'r1', name: 'Receipts', url: 'https://drive.google.com/drive/folders/r1' },
        },
      }),
    };
  };

  driveStore.clearFolderCache?.();
  const folders = await driveStore.getFolders();
  check(
    'driveStore.getFolders() sends Authorization: Bearer (no ?token=) and returns Drive URLs',
    fetchCalls.length === 1 &&
      !fetchCalls[0].url.includes('token=') &&
      fetchCalls[0].headers.Authorization === 'Bearer fake-bearer-tok' &&
      folders.enabled === true &&
      folders.documentsFolder?.url === 'https://drive.google.com/drive/folders/d1' &&
      folders.receiptsFolder?.url === 'https://drive.google.com/drive/folders/r1',
    JSON.stringify({ fetchCalls, folders })
  );

  const cachedUrl = await driveStore.getFolderUrl('receipts');
  check(
    'driveStore.getFolderUrl("receipts") reuses cache without duplicate fetch',
    cachedUrl === 'https://drive.google.com/drive/folders/r1' && fetchCalls.length === 1,
    `url=${cachedUrl}, calls=${fetchCalls.length}`
  );

  // Reject unsafe non-Drive URLs
  driveStore.clearFolderCache?.();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        enabled: true,
        documentsFolder: { id: 'x', name: 'Documents', url: 'javascript:alert(1)' },
        receiptsFolder: { id: 'y', name: 'Receipts', url: 'https://evil.example/folders/y' },
      },
    }),
  });
  const sanitized = await driveStore.getFolders({ fresh: true });
  check(
    'driveStore.getFolders() rejects non-Google-Drive URLs',
    sanitized.documentsFolder === null && sanitized.receiptsFolder === null,
    JSON.stringify(sanitized)
  );

  // Graceful fallback on 403 / network error
  driveStore.clearFolderCache?.();
  globalThis.fetch = async () => ({ ok: false, status: 403, json: async () => ({}) });
  const denied = await driveStore.getFolders({ fresh: true });
  check(
    'driveStore.getFolders() returns enabled:false cleanly on 403',
    denied.enabled === false && denied.documentsFolder === null && denied.receiptsFolder === null,
    JSON.stringify(denied)
  );
}
globalThis.fetch = origFetch;

// 3b. mongoStore.get({ throwOnError: true }) preserves signed-out auth error
const outMongoStore = path.join(tmpDir, 'tdd-mongo-auth.mjs');
await esbuild({
  entryPoints: [path.join(ROOT, 'src/services/fileStore/mongoStore.js')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  define: { 'import.meta.env': JSON.stringify({ VITE_MONGODB_BACKEND_URL: 'https://api.example.test' }) },
  outfile: outMongoStore,
  plugins: [
    {
      name: 'mock-fb-null',
      setup(b) {
        b.onResolve({ filter: /firebaseConfig/ }, () => ({ path: 'fb-null', namespace: 'm' }));
        b.onLoad({ filter: /.*/, namespace: 'm' }, () => ({
          contents: 'export const auth = { currentUser: null };',
          loader: 'js',
        }));
      },
    },
  ],
});
const { mongoStore: signedOutMongo } = await import(`file:///${outMongoStore.replace(/\\/g, '/')}?t=${Date.now()}`);
let signedOutMsg = '';
try {
  await signedOutMongo.get('507f1f77bcf86cd799439088', { throwOnError: true });
} catch (err) {
  signedOutMsg = err.message;
}
check(
  'mongoStore.get({ throwOnError: true }) preserves sign-in error instead of ALLOWED_ORIGINS',
  /sign(ed)? in|authenticated/i.test(signedOutMsg) && !/ALLOWED_ORIGINS/i.test(signedOutMsg),
  `threw "${signedOutMsg}"`
);

// 3c. documentLabels.canPreviewInline() rejects double extensions like Minutes.pdf.docx
const docLabels = await import(`file:///${path.join(ROOT, 'src/utils/documentLabels.js').replace(/\\/g, '/')}?t=${Date.now()}`);
check(
  'canPreviewInline("Minutes.pdf.docx") returns false',
  docLabels.canPreviewInline('Minutes.pdf.docx') === false,
  String(docLabels.canPreviewInline('Minutes.pdf.docx'))
);
check(
  'canPreviewInline("scan.png.zip") returns false',
  docLabels.canPreviewInline('scan.png.zip') === false,
  String(docLabels.canPreviewInline('scan.png.zip'))
);

// 3d. documentService.getDocumentUrl() routes legacy !storageType with mongoFileId to mongoStore (not localStore)
const outDocSvc = path.join(tmpDir, 'tdd-doc-svc-legacy.mjs');
await esbuild({
  entryPoints: [path.join(ROOT, 'src/services/documentService.js')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  define: { 'import.meta.env': JSON.stringify({ VITE_FILE_STORE: 'mongodb', VITE_MONGODB_BACKEND_URL: 'https://api.example.test' }) },
  outfile: outDocSvc,
  plugins: [
    {
      name: 'mock-stores-legacy',
      setup(b) {
        b.onResolve({ filter: /firebase\/firestore/ }, () => ({ path: 'fs-stub', namespace: 'm' }));
        b.onLoad({ filter: /fs-stub/, namespace: 'm' }, () => ({
          contents: 'export const addDoc=()=>{};export const collection=()=>{};export const doc=()=>{};export const getDoc=()=>{};export const getDocs=()=>{};export const limit=()=>{};export const onSnapshot=()=>{};export const orderBy=()=>{};export const query=()=>{};export const serverTimestamp=()=>{};export const setDoc=()=>{};export const updateDoc=()=>{};export const deleteDoc=()=>{};export const writeBatch=()=>{};export const where=()=>{};',
          loader: 'js',
        }));
        b.onResolve({ filter: /firebaseConfig/ }, () => ({ path: 'fb-stub', namespace: 'm' }));
        b.onLoad({ filter: /fb-stub/, namespace: 'm' }, () => ({
          contents: 'export const db = {}; export const auth = { currentUser: null };',
          loader: 'js',
        }));
        b.onResolve({ filter: /\.\/fileStore$/ }, () => ({ path: 'idx-stub', namespace: 'm' }));
        b.onLoad({ filter: /idx-stub/, namespace: 'm' }, () => ({
          contents: `
            export const fileStore = { name: 'firebase', getUrl: async (k) => 'active:' + k };
            export const localStore = { getUrl: async (k) => 'local:' + k };
            export const firebaseStore = { getUrl: async (k) => 'firebase:' + k };
            export const mongoStore = { getUrl: async (k) => 'mongo:' + k };
            export const isMongoMode = true;
            export const isLocalMode = false;
            export const isFirebaseMode = false;
          `,
          loader: 'js',
        }));
      },
    },
  ],
});
const { getDocumentUrl: legacyGetDocUrl } = await import(`file:///${outDocSvc.replace(/\\/g, '/')}?t=${Date.now()}`);
const legacyBoth = await legacyGetDocUrl({ mongoFileId: 'm-99', storagePath: 'old/path.pdf' });
check(
  'Legacy doc missing storageType with mongoFileId + storagePath routes to mongoStore (not localStore)',
  legacyBoth === 'mongo:m-99',
  `got "${legacyBoth}"`
);
const legacyPathOnly = await legacyGetDocUrl({ storagePath: 'legacy/doc.pdf' });
check(
  'Legacy doc missing storageType with only storagePath falls back to active fileStore (not hardcoded localStore)',
  legacyPathOnly === 'active:legacy/doc.pdf',
  `got "${legacyPathOnly}"`
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 4: Finance -> Inventory Receipt Linkage & Authenticated Receipt Opener
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 4: Finance -> Inventory Receipt Linkage & Auth-Safe Receipt Opener ===');

const receiptHelperFile = path.join(ROOT, 'src/utils/receiptAccessHelpers.js');
check(
  'src/utils/receiptAccessHelpers.js exists',
  fs.existsSync(receiptHelperFile),
  'Missing src/utils/receiptAccessHelpers.js'
);

if (fs.existsSync(receiptHelperFile)) {
  const rh = await import(`file:///${receiptHelperFile.replace(/\\/g, '/')}?t=${Date.now()}`);

  const sampleTxs = [
    {
      id: 'tx-inv-1',
      source: 'INVENTORY_CONSUMABLE_EXPENSE',
      description: 'Chooks-to-Go Lunch',
      receiptDriveLink: 'https://drive.google.com/file/d/inv1/view',
      createdAt: { toMillis: () => 1000 },
    },
    {
      id: 'tx-fin-1',
      type: 'expense',
      description: 'Sound System Rental',
      receiptDriveLink: 'https://drive.google.com/file/d/fin1/view',
      createdAt: { toMillis: () => 2000 },
    },
    {
      id: 'tx-fin-no-receipt',
      type: 'income',
      description: 'Semester Allotment',
      createdAt: { toMillis: () => 3000 },
    },
    {
      id: 'tx-fin-gridfs',
      type: 'expense',
      description: 'Tarpaulin Printing',
      receiptUrl: 'https://api.example.test/api/documents/507f1f77bcf86cd799439055/download?disposition=inline',
      receiptFileId: '507f1f77bcf86cd799439055',
      createdAt: { toMillis: () => 2500 },
    },
  ];

  const linked = rh.filterInventoryAndFinanceReceipts(sampleTxs);
  check(
    'filterInventoryAndFinanceReceipts includes Finance receipts alongside Inventory Consumables (excludes receipt-less tx)',
    linked.length === 3 &&
      linked[0].id === 'tx-fin-gridfs' &&
      linked[1].id === 'tx-fin-1' &&
      linked[2].id === 'tx-inv-1',
    JSON.stringify(linked.map((x) => ({ id: x.id, origin: x.receiptOrigin })))
  );
  check(
    'Origin badges distinguish Finance vs Inventory - Consumables',
    linked[1].receiptOrigin === 'Finance' && linked[2].receiptOrigin === 'Inventory - Consumables',
    JSON.stringify(linked.map((x) => x.receiptOrigin))
  );

  check(
    'isDirectBrowserReceiptUrl rejects protected /api/documents/:id/download URL',
    rh.isDirectBrowserReceiptUrl('https://api.example.test/api/documents/507f1f77bcf86cd799439055/download?disposition=inline') === false &&
      rh.isDirectBrowserReceiptUrl('https://drive.google.com/file/d/abc/view') === true &&
      rh.isDirectBrowserReceiptUrl('data:image/jpeg;base64,AAA') === true
  );

  // Opening a Drive receipt uses direct URL without hitting mongoStore
  let openedUrl = null;
  let blobRequestedId = null;
  await rh.openReceiptProof(sampleTxs[1], {
    getBlobUrl: async (id) => {
      blobRequestedId = id;
      return `blob:${id}`;
    },
    openWindow: (u) => {
      openedUrl = u;
    },
  });
  check(
    'openReceiptProof opens Drive link directly without calling mongoStore',
    openedUrl === 'https://drive.google.com/file/d/fin1/view' && blobRequestedId === null,
    `opened=${openedUrl}, blobId=${blobRequestedId}`
  );

  // Opening a GridFS fallback receipt fetches authenticated blob URL (fixes HTTP 401 bug!)
  openedUrl = null;
  blobRequestedId = null;
  await rh.openReceiptProof(sampleTxs[3], {
    getBlobUrl: async (id) => {
      blobRequestedId = id;
      return `blob:https://app.test/${id}`;
    },
    openWindow: (u) => {
      openedUrl = u;
    },
  });
  check(
    'openReceiptProof routes GridFS fallback receipt through authenticated getBlobUrl (no 401 raw link)',
    blobRequestedId === '507f1f77bcf86cd799439055' && openedUrl === 'blob:https://app.test/507f1f77bcf86cd799439055',
    `opened=${openedUrl}, blobId=${blobRequestedId}`
  );
}

const invProvSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/InventoryContext/InventoryProvider.jsx'),
  'utf8'
);
check(
  'InventoryProvider uses filterInventoryAndFinanceReceipts to link Finance receipts into Inventory',
  invProvSrc.includes('filterInventoryAndFinanceReceipts'),
  'InventoryProvider does not yet link Finance receipt transactions'
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 5: UI Wiring Contracts (Inventory, Finance & Document Drive Links)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 5: UI Wiring Contracts (Drive Folders, Origin Badges, Auth-Safe Receipts) ===');

const invUiSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/InventoryDashboard/InventoryManagement.jsx'),
  'utf8'
);
const consumableDlgSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/InventoryDashboard/ConsumableExpenseDialog.jsx'),
  'utf8'
);
const financeUiSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/Finance/FundGovernance.jsx'),
  'utf8'
);
const docUiSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/Document/DocumentDashboard.jsx'),
  'utf8'
);

check(
  'InventoryManagement.jsx fetches officer Receipts Drive folder via driveStore.getFolders',
  /driveStore\s*\.\s*getFolders/.test(invUiSrc) && invUiSrc.includes('Receipts Folder (Drive)'),
  'Missing Drive Receipts folder button in InventoryManagement.jsx'
);
check(
  'InventoryManagement.jsx opens receipts via auth-safe openReceiptProof (no raw 401 href fallback)',
  invUiSrc.includes('openReceiptProof') && !/href=\{exp\.receiptDriveLink \|\| exp\.receiptUrl\}/.test(invUiSrc),
  'InventoryManagement still renders raw <a href={exp.receiptDriveLink || exp.receiptUrl}>'
);
check(
  'InventoryManagement.jsx renders receiptOrigin badge for Finance vs Inventory receipts',
  invUiSrc.includes('receiptOrigin'),
  'Missing receiptOrigin badge in InventoryManagement.jsx'
);
check(
  'InventoryManagement.jsx AssetDialog locks submit during uploadingReceipt and restricts accept types',
  /disabled=\{submitting \|\| uploadingReceipt\}/.test(invUiSrc) &&
    !invUiSrc.includes('accept="image/*,.pdf"'),
  'AssetDialog missing uploadingReceipt submit lock or still uses loose accept="image/*,.pdf"'
);
check(
  'ConsumableExpenseDialog.jsx tags receipt uploads with SSG Inventory - Consumables origin',
  consumableDlgSrc.includes('SSG Inventory - Consumables'),
  'ConsumableExpenseDialog does not tag origin as SSG Inventory - Consumables'
);
check(
  'FundGovernance.jsx opens receipts via auth-safe openReceiptProof and exposes Receipts Folder (Drive) link',
  financeUiSrc.includes('openReceiptProof') && /driveStore\s*\.\s*getFolders/.test(financeUiSrc),
  'FundGovernance missing openReceiptProof or Drive Receipts folder link'
);
check(
  'DocumentDashboard.jsx fetches officer Documents Drive folder via driveStore.getFolders and exposes per-doc Drive button',
  /driveStore\s*\.\s*getFolders/.test(docUiSrc) &&
    docUiSrc.includes('Documents Folder (Drive)') &&
    docUiSrc.includes('handleOpenInDrive'),
  'DocumentDashboard missing Drive Documents folder link or per-doc Drive button'
);

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\n✅ All checks passed.');
