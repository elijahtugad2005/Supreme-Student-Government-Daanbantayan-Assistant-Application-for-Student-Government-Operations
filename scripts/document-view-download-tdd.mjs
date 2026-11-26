/**
 * TDD Regression Suite for Document View & Download Diagnostics
 *
 * Covers:
 *  1. documentService.getDocumentUrl() dispatches by document.storageType (not active fileStore)
 *  2. documentLabels.canPreviewInline() recognizes MIME types (application/pdf, image/png, etc.)
 *  3. mongoStore.getUrl(..., { throwOnError: true }) surfaces actionable HTTP/network errors
 *     while keeping default getUrl() backward-compatible (returns null on error)
 *  4. DocumentDashboard.jsx uses dynamic storage mode label, throwOnError, and clears previewCache on delete
 *
 * Run: node scripts/document-view-download-tdd.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { canPreviewInline } from '../src/utils/documentLabels.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

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
// SLICE 1: documentService.getDocumentUrl() dispatches by document.storageType
// ════════════════════════════════════════════════════════════════════════════
async function loadDocumentServiceWithActiveStore(activeStoreName) {
  const res = await esbuild({
    entryPoints: [path.join(ROOT, 'src/services/documentService.js')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    plugins: [
      {
        name: 'doc-service-stubs',
        setup(b) {
          b.onResolve({ filter: /^firebase\// }, (a) => ({ path: a.path, namespace: 'fb' }));
          b.onLoad({ filter: /.*/, namespace: 'fb' }, () => ({
            contents:
              'export const addDoc=()=>{},collection=()=>{},deleteDoc=()=>{},doc=()=>{},getDoc=()=>{},getDocs=()=>{},limit=()=>{},onSnapshot=()=>{},orderBy=()=>{},query=()=>{},serverTimestamp=()=>{},setDoc=()=>{},updateDoc=()=>{};',
            loader: 'js',
          }));
          b.onResolve({ filter: /firebaseConfig/ }, () => ({ path: 'fc', namespace: 'fc' }));
          b.onLoad({ filter: /.*/, namespace: 'fc' }, () => ({
            contents: 'export const db={}; export const auth={};',
            loader: 'js',
          }));
          b.onResolve({ filter: /fileStore$/ }, () => ({ path: 'fs', namespace: 'fs' }));
          b.onLoad({ filter: /.*/, namespace: 'fs' }, () => ({
            contents: `
              const mk = (name) => ({ name, async getUrl(id, opts) { return name + '://' + id + (opts?.throwOnError ? '?throw=1' : ''); } });
              export const localStore = mk('local');
              export const firebaseStore = mk('firebase');
              export const mongoStore = mk('mongodb');
              const map = { local: localStore, firebase: firebaseStore, mongodb: mongoStore };
              export const fileStore = map[${JSON.stringify(activeStoreName)}];
            `,
            loader: 'js',
          }));
        },
      },
    ],
  });
  return import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64'));
}

const svcLocalActive = await loadDocumentServiceWithActiveStore('local');
const localModeMongoUrl = await svcLocalActive.getDocumentUrl({
  storageType: 'mongodb',
  mongoFileId: '507f1f77bcf86cd799439011',
});
check(
  'Active=local: mongodb document routes to mongoStore (not localStore)',
  localModeMongoUrl === 'mongodb://507f1f77bcf86cd799439011',
  `got ${localModeMongoUrl}`
);

const localModeFirebaseUrl = await svcLocalActive.getDocumentUrl({
  storageType: 'firebase',
  storagePath: 'documents/d1/reso.pdf',
});
check(
  'Active=local: firebase document routes to firebaseStore (not localStore)',
  localModeFirebaseUrl === 'firebase://documents/d1/reso.pdf',
  `got ${localModeFirebaseUrl}`
);

const svcMongoActive = await loadDocumentServiceWithActiveStore('mongodb');
const mongoModeFirebaseUrl = await svcMongoActive.getDocumentUrl({
  storageType: 'firebase',
  storagePath: 'documents/d2/legacy.pdf',
});
check(
  'Active=mongodb: legacy firebase document routes to firebaseStore (not mongoStore)',
  mongoModeFirebaseUrl === 'firebase://documents/d2/legacy.pdf',
  `got ${mongoModeFirebaseUrl}`
);

const mongoModeLocalUrl = await svcMongoActive.getDocumentUrl({
  storageType: 'local',
  storagePath: 'documents/d3/offline.pdf',
});
check(
  'Active=mongodb: legacy local document routes to localStore (not mongoStore)',
  mongoModeLocalUrl === 'local://documents/d3/offline.pdf',
  `got ${mongoModeLocalUrl}`
);

const mongoModeMongoUrl = await svcMongoActive.getDocumentUrl(
  { storageType: 'mongodb', mongoFileId: '507f1f77bcf86cd799439022' },
  { throwOnError: true }
);
check(
  'Active=mongodb: mongodb document routes to mongoStore and forwards options',
  mongoModeMongoUrl === 'mongodb://507f1f77bcf86cd799439022?throw=1',
  `got ${mongoModeMongoUrl}`
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 2: documentLabels.canPreviewInline() MIME type & extension support
// ════════════════════════════════════════════════════════════════════════════
for (const mime of ['application/pdf', 'image/png', 'image/jpeg', 'text/plain']) {
  check(`canPreviewInline('${mime}') returns true`, canPreviewInline(mime) === true);
}
for (const mime of [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]) {
  check(`canPreviewInline('${mime}') returns false`, canPreviewInline(mime) === false);
}
check(`canPreviewInline('Memo.PDF') returns true`, canPreviewInline('Memo.PDF') === true);
check(`canPreviewInline('Report.docx') returns false`, canPreviewInline('Report.docx') === false);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 3: mongoStore.getUrl({ throwOnError: true }) actionable errors
// ════════════════════════════════════════════════════════════════════════════
const bundledMongo = await esbuild({
  entryPoints: [path.join(ROOT, 'src/services/fileStore/mongoStore.js')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  define: {
    'import.meta.env.VITE_MONGODB_BACKEND_URL': JSON.stringify('https://api.shirio.test'),
  },
  plugins: [
    {
      name: 'fb-stub',
      setup(b) {
        b.onResolve({ filter: /firebaseConfig/ }, () => ({ path: 'fc', namespace: 'fc' }));
        b.onLoad({ filter: /.*/, namespace: 'fc' }, () => ({
          contents: 'export const auth = globalThis.__DOC_VIEW_TEST_AUTH__;',
          loader: 'js',
        }));
      },
    },
  ],
});

globalThis.__DOC_VIEW_TEST_AUTH__ = {
  currentUser: { async getIdToken() { return 'test-jwt-token'; } },
};

const origFetch = globalThis.fetch;
let mockFetchMode = '403';
globalThis.fetch = async () => {
  if (mockFetchMode === 'network') throw new TypeError('Failed to fetch');
  if (mockFetchMode === '401') return { ok: false, status: 401, headers: new Headers() };
  if (mockFetchMode === '403') return { ok: false, status: 403, headers: new Headers() };
  if (mockFetchMode === '404') return { ok: false, status: 404, headers: new Headers() };
  return { ok: false, status: 502, headers: new Headers() };
};

try {
  const { mongoStore } = await import(
    'data:text/javascript;base64,' + Buffer.from(bundledMongo.outputFiles[0].text).toString('base64')
  );

  mockFetchMode = '404';
  const defaultNull = await mongoStore.getUrl('missing-default');
  check('mongoStore.getUrl() default still returns null on 404 (backward-compatible)', defaultNull === null);

  for (const [mode, expectedSubstr] of [
    ['401', '401'],
    ['403', '403'],
    ['404', '404'],
    ['502', '502'],
    ['network', 'backend'],
  ]) {
    mockFetchMode = mode;
    let errMsg = '';
    try {
      await mongoStore.getUrl(`file-${mode}`, { throwOnError: true });
    } catch (e) {
      errMsg = e.message || '';
    }
    check(
      `mongoStore.getUrl({ throwOnError: true }) throws descriptive error for ${mode}`,
      errMsg.toLowerCase().includes(expectedSubstr),
      `got "${errMsg}"`
    );
  }
} finally {
  globalThis.fetch = origFetch;
  delete globalThis.__DOC_VIEW_TEST_AUTH__;
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 4: DocumentDashboard.jsx banner label, previewCache cleanup & throwOnError
// ════════════════════════════════════════════════════════════════════════════
const dashSrc = readFileSync(path.join(ROOT, 'src/components/Document/DocumentDashboard.jsx'), 'utf8');
check(
  'DocumentDashboard.jsx does not hardcode "Local storage mode." for MongoDB GridFS mode',
  !dashSrc.includes('<strong>Local storage mode.</strong> {storageWarning}')
);
check(
  'DocumentDashboard.jsx clears previewCache.current on document delete',
  /previewCache\.current\.delete\(document\.id\)/.test(dashSrc)
);
check(
  'DocumentDashboard.jsx passes throwOnError: true to getDocumentUrl for preview & download',
  (dashSrc.match(/throwOnError:\s*true/g) || []).length >= 2
);

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\n✅ All checks passed.');
}
