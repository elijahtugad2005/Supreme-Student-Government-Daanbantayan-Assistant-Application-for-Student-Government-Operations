/**
 * TDD & Post-Deployment Hardening Regression Suite:
 *   PD-1: Express RBAC respects `permissionOverrides` and `governor` (fixes 403 split-brain)
 *   PD-2: Google Sheets Finance OAuth `error_callback` prevents infinite `isExporting` hang
 *   PD-3: Document preview waits gracefully through Render cold starts (>6s) without flashing empty iframe
 *   PD-4: Mobile in-app WebView detection & popup-closed redirect fallback in GoogleSignInButton
 *   PD-5: Death Aid `listRemittances` & `listAuditLog` order newest-first before `limit()`
 *
 * Run: npm run test:post-deploy
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const { build: esbuild } = require('esbuild');

let failed = 0;
const results = [];
const check = (label, ok, detail = '') => {
  if (ok) results.push(`ok   ${label}`);
  else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// PD-1: Express RBAC permissionOverrides & governor on Documents + Telegram
// ════════════════════════════════════════════════════════════════════════════
console.log('=== PD-1: Express RBAC permissionOverrides & governor ===');

const users = new Map([
  ['u-gov', { role: 'governor', name: 'COTE Governor', isActive: true }],
  ['u-mem-override', { role: 'member', name: 'Delegated Officer', isActive: true, permissionOverrides: { canExportData: true, canSendNotifications: true } }],
  ['u-mem-plain', { role: 'member', name: 'Regular Member', isActive: true }],
  ['u-mem-deact', { role: 'member', name: 'Former Delegated', isActive: false, permissionOverrides: { canExportData: true } }],
]);
const tokens = new Map([
  ['tok-gov', { uid: 'u-gov', email: 'gov@ctu.edu.ph' }],
  ['tok-override', { uid: 'u-mem-override', email: 'delegated@ctu.edu.ph' }],
  ['tok-plain', { uid: 'u-mem-plain', email: 'member@ctu.edu.ph' }],
  ['tok-deact', { uid: 'u-mem-deact', email: 'former@ctu.edu.ph' }],
]);

const fbAdminPath = require.resolve(path.join(ROOT, 'backend/services/firebase-admin.js'));
require.cache[fbAdminPath] = {
  id: fbAdminPath,
  filename: fbAdminPath,
  loaded: true,
  exports: {
    verifyIdToken: async (t) => {
      const d = tokens.get(t);
      if (!d) throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
      return d;
    },
    getFirestore: () => ({
      collection: () => ({
        doc: (uid) => ({
          get: async () => {
            const d = users.get(uid);
            return { exists: Boolean(d), data: () => d };
          },
        }),
      }),
    }),
  },
};
const mongoPath = require.resolve(path.join(ROOT, 'backend/services/mongodb.js'));
require.cache[mongoPath] = {
  id: mongoPath, filename: mongoPath, loaded: true,
  exports: { getDatabase: async () => ({ collection: () => ({ updateOne: async () => ({}) }) }) },
};
const gridFsPath = require.resolve(path.join(ROOT, 'backend/utils/gridfs.js'));
require.cache[gridFsPath] = {
  id: gridFsPath, filename: gridFsPath, loaded: true,
  exports: {
    uploadFileToGridFS: async (_b, f) => ({ fileId: '507f1f77bcf86cd799439077', filename: f, size: 12 }),
    getFileMetadata: async () => null,
    getDownloadStream: async () => null,
    deleteFileFromGridFS: async () => {},
    listFiles: async () => [],
    downloadFileFromGridFS: async () => Buffer.from('x'),
  },
};
const drivePath = require.resolve(path.join(ROOT, 'backend/services/driveSync.js'));
require.cache[drivePath] = {
  id: drivePath, filename: drivePath, loaded: true,
  exports: {
    isEnabled: () => false,
    authMode: () => null,
    getFolderLinks: async () => ({ enabled: false, documentsFolder: null, receiptsFolder: null }),
    mirrorUpload: async () => ({}),
    deleteMirror: async () => {},
  },
};

delete require.cache[require.resolve(path.join(ROOT, 'backend/middleware/auth.js'))];
delete require.cache[require.resolve(path.join(ROOT, 'backend/routes/documents.js'))];
delete require.cache[require.resolve(path.join(ROOT, 'backend/routes/telegram.js'))];

const docRouter = require(path.join(ROOT, 'backend/routes/documents.js'));
const tgRouter = require(path.join(ROOT, 'backend/routes/telegram.js'));
tgRouter.__setTransportForTest(async () => ({ data: { ok: true, result: { message_id: 101 } } }));
process.env.TELEGRAM_BOT_TOKEN = 'test-placeholder-token';
process.env.TELEGRAM_FACULTY_CHAT_ID = '-100123456';

const invoke = (router, method, url, { headers = {}, body = {}, file = null } = {}) =>
  new Promise((resolve) => {
    const req = {
      method,
      url,
      originalUrl: url,
      headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      body,
      file,
      query: {},
      params: {},
    };
    let statusCode = 200;
    const res = {
      headersSent: false,
      setHeader() {},
      status(c) { statusCode = c; return this; },
      json(b) { this.headersSent = true; resolve({ statusCode, body: b }); return this; },
      send(b) { this.headersSent = true; resolve({ statusCode, body: b }); return this; },
    };
    router.handle(req, res, () => resolve({ statusCode: 404, body: { error: 'Not found' } }));
  });

const rGovUpload = await invoke(docRouter, 'POST', '/upload', {
  headers: { authorization: 'Bearer tok-gov' },
  body: { folder: 'Receipts', documentType: 'receipt', title: 'Event Snacks', office: 'SSG Inventory' },
  file: { originalname: 'or.jpg', mimetype: 'image/jpeg', size: 12, buffer: Buffer.from('jpg') },
});
check('Governor CAN upload inventory/finance receipt via POST /api/documents/upload (200)', rGovUpload.statusCode === 200, `got ${rGovUpload.statusCode}`);

const rOverrideFolders = await invoke(docRouter, 'GET', '/drive/folders', {
  headers: { authorization: 'Bearer tok-override' },
});
check('Member with permissionOverrides.canExportData=true CAN access GET /api/documents/drive/folders (200)', rOverrideFolders.statusCode === 200, `got ${rOverrideFolders.statusCode}`);

const rPlainFolders = await invoke(docRouter, 'GET', '/drive/folders', {
  headers: { authorization: 'Bearer tok-plain' },
});
check('Plain member WITHOUT override remains blocked from GET /api/documents/drive/folders (403)', rPlainFolders.statusCode === 403, `got ${rPlainFolders.statusCode}`);

const rDeactFolders = await invoke(docRouter, 'GET', '/drive/folders', {
  headers: { authorization: 'Bearer tok-deact' },
});
check('Deactivated user WITH override remains blocked (403)', rDeactFolders.statusCode === 403, `got ${rDeactFolders.statusCode}`);

const rOverrideTg = await invoke(tgRouter, 'POST', '/send', {
  headers: { authorization: 'Bearer tok-override' },
  body: { channel: 'faculty', message: 'Test Notice' },
});
check('Member with permissionOverrides.canSendNotifications=true CAN broadcast via POST /api/telegram/send (200)', rOverrideTg.statusCode === 200, `got ${rOverrideTg.statusCode}`);

// ════════════════════════════════════════════════════════════════════════════
// PD-2: Google Sheets Finance OAuth error_callback (prevents popup hang)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== PD-2: Google Sheets Finance OAuth error_callback ===');

const tmpDir = path.join(ROOT, 'node_modules/.tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const outSheets = path.join(tmpDir, 'tdd-sheets-oauth.mjs');
await esbuild({
  entryPoints: [path.join(ROOT, 'src/services/googleSheetsFinanceSyncService.js')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  define: { 'import.meta.env': JSON.stringify({ VITE_GOOGLE_OAUTH_CLIENT_ID: 'test-client.apps.googleusercontent.com' }) },
  outfile: outSheets,
  plugins: [
    {
      name: 'stub-fb-sheets',
      setup(b) {
        b.onResolve({ filter: /^firebase\// }, (args) => ({ path: args.path, namespace: 'stub' }));
        b.onResolve({ filter: /firebaseConfig|auditService/ }, (args) => ({ path: args.path, namespace: 'stub' }));
        b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const db={};export const auth={};export const auditService={ logAction: async () => {} };export default auditService;export const collection=()=>{};export const addDoc=()=>{};export const doc=()=>{};export const setDoc=()=>{};export const getDoc=()=>{};export const serverTimestamp=()=>{};',
          loader: 'js',
        }));
      },
    },
  ],
});
const sheetsMod = await import(`file:///${outSheets.replace(/\\/g, '/')}?t=${Date.now()}`);

const origWindow = globalThis.window;
let capturedErrorCallback = null;
globalThis.window = {
  google: {
    accounts: {
      oauth2: {
        initTokenClient: (cfg) => {
          capturedErrorCallback = cfg.error_callback;
          return {
            requestAccessToken: () => {
              if (typeof cfg.error_callback === 'function') {
                setTimeout(() => cfg.error_callback({ type: 'popup_closed' }), 10);
              }
            },
          };
        },
      },
    },
  },
};

let popupRejectedMsg = '';
const raceResult = await Promise.race([
  sheetsMod
    .requestGoogleSheetsToken(true)
    .then(() => 'RESOLVED')
    .catch((e) => {
      popupRejectedMsg = e.message;
      return 'REJECTED';
    }),
  new Promise((r) => setTimeout(() => r('HUNG'), 150)),
]);
globalThis.window = origWindow;

check(
  'googleSheetsFinanceSyncService registers error_callback and rejects cleanly on popup_closed (never hangs)',
  typeof capturedErrorCallback === 'function' && raceResult === 'REJECTED' && /closed|cancelled|blocked|popup/i.test(popupRejectedMsg),
  `error_callback=${typeof capturedErrorCallback}, outcome=${raceResult}, msg="${popupRejectedMsg}"`
);

const exportPanelSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/Finance/FinanceReportExportPanel.jsx'),
  'utf8'
);
check(
  'FinanceReportExportPanel tracks connectionStatus in state and refreshes it periodically',
  exportPanelSrc.includes('setConnectionStatus') && exportPanelSrc.includes('setInterval'),
  'FinanceReportExportPanel evaluates getGoogleConnectionStatus() only inline on render'
);

// ════════════════════════════════════════════════════════════════════════════
// PD-3: DocumentDashboard cold-start preview wait (no blank iframe flash at 6s)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== PD-3: Render Cold-Start Preview Handling ===');

const docDashSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/Document/DocumentDashboard.jsx'),
  'utf8'
);
const killsLoaderAt6s = /setTimeout\(\(\) => \{\s*if \(!currentReq\.aborted\) \{\s*setPreviewLoading\(false\);[\s\S]{0,120}\}, 6000\)/.test(docDashSrc);
check(
  'DocumentDashboard does NOT kill previewLoading at 6s while Render backend is cold-starting',
  !killsLoaderAt6s,
  '6s timeout still forces setPreviewLoading(false) before getDocumentUrl resolves'
);

// ════════════════════════════════════════════════════════════════════════════
// PD-4: Mobile WebView Detection & Popup-Closed Redirect Fallback
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== PD-4: GoogleSignInButton WebView & Popup-Closed Fallback ===');

const gBtnSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/Login/GoogleSignInButton.jsx'),
  'utf8'
);
check(
  'GoogleSignInButton offers Redirect Sign-In fallback on auth/popup-closed-by-user and detects in-app WebViews',
  gBtnSrc.includes("'auth/popup-closed-by-user'") &&
    /REDIRECT_FALLBACK_CODES[\s\S]*auth\/popup-closed-by-user/.test(gBtnSrc) &&
    /FBAN|FBAV|Instagram|Messenger/i.test(gBtnSrc),
  'Missing popup-closed redirect fallback or WebView detection in GoogleSignInButton.jsx'
);

// ════════════════════════════════════════════════════════════════════════════
// PD-5: Death Aid listRemittances & listAuditLog ordered newest-first before limit
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== PD-5: Death Aid Ordered Queries Before limit() ===');

const daSvcSrc = fs.readFileSync(
  path.join(ROOT, 'src/services/deathAidService.js'),
  'utf8'
);
const remOrdered = /listRemittances[\s\S]{0,400}orderBy\('receivedAt',\s*'desc'\)/.test(daSvcSrc);
const auditOrdered = /listAuditLog[\s\S]{0,400}orderBy\('at',\s*'desc'\)/.test(daSvcSrc);
check(
  'listRemittances orders by receivedAt desc before limit(200)',
  remOrdered,
  'listRemittances applies limit(200) without orderBy'
);
check(
  'listAuditLog orders by at desc before limit(500)',
  auditOrdered,
  'listAuditLog applies limit(500) without orderBy'
);

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\n✅ All checks passed.');
