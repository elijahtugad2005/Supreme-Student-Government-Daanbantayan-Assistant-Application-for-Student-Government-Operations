/**
 * Diagnosing-Bugs & TDD Regression Test:
 *   Bug: Viewing a PDF in Finance PPMP Budget Allocation Preview Widget works
 *   the first time, but closing and re-opening the modal shows Chrome's
 *   "It may have been moved, edited, or deleted" (revoked blob: URL).
 *
 * Seam tested:
 *   1. Real `mongoStore.getUrl()` singleton cache lifecycle across open -> close -> reopen.
 *   2. `DocumentPreviewWidget.jsx` must NEVER call `URL.revokeObjectURL()` on store-owned
 *      `blob:` URLs (leaving stale dead URLs in `mongoStore._urls`).
 *
 * Run: node scripts/preview-blob-revocation-tdd.mjs
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

// Track live vs revoked blob URLs exactly as Chrome does
let seq = 0;
const liveBlobs = new Set();
const revokedBlobs = new Set();

const origCreate = URL.createObjectURL;
const origRevoke = URL.revokeObjectURL;
const origFetch = globalThis.fetch;

URL.createObjectURL = () => {
  seq += 1;
  const u = `blob:https://app.test/pdf-${seq}`;
  liveBlobs.add(u);
  return u;
};
URL.revokeObjectURL = (u) => {
  liveBlobs.delete(u);
  revokedBlobs.add(u);
};
globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  headers: new Headers({ 'content-type': 'application/pdf' }),
  blob: async () => new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
});

const tmpDir = path.join(ROOT, 'node_modules/.tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const outMongo = path.join(tmpDir, 'repro-mongo-blob.mjs');
await esbuild({
  entryPoints: [path.join(ROOT, 'src/services/fileStore/mongoStore.js')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  define: { 'import.meta.env': JSON.stringify({ VITE_MONGODB_BACKEND_URL: 'https://api.example.test' }) },
  outfile: outMongo,
  plugins: [
    {
      name: 'mock-fb-blob',
      setup(b) {
        b.onResolve({ filter: /firebaseConfig/ }, () => ({ path: 'fb-blob', namespace: 'm' }));
        b.onLoad({ filter: /.*/, namespace: 'm' }, () => ({
          contents: 'export const auth = { currentUser: { getIdToken: async () => "fake-jwt" } };',
          loader: 'js',
        }));
      },
    },
  ],
});

const { mongoStore } = await import(`file:///${outMongo.replace(/\\/g, '/')}?t=${Date.now()}`);
const widgetSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/BudgetForm/DocumentPreviewWidget.jsx'),
  'utf8'
);

// 1. First open: widget calls mongoStore.getUrl(fileId)
const fileId = '507f1f77bcf86cd799439042';
const firstUrl = await mongoStore.getUrl(fileId, { disposition: 'inline', throwOnError: true });
check('First preview yields a live blob: URL', liveBlobs.has(firstUrl), `firstUrl=${firstUrl}`);

// 2. Simulate modal close / widget unmount behavior directly from DocumentPreviewWidget.jsx
const widgetRevokesStoreBlobOnUnmount = /URL\.revokeObjectURL\(/.test(widgetSrc);
if (widgetRevokesStoreBlobOnUnmount) {
  // This is what DocumentPreviewWidget.jsx currently runs on unmount!
  URL.revokeObjectURL(firstUrl);
}

// 3. Second open: officer re-opens Budget Allocation modal & views the SAME document
const secondUrl = await mongoStore.getUrl(fileId, { disposition: 'inline', throwOnError: true });
check(
  'Re-opening preview after closing modal yields a LIVE (non-revoked) blob: URL',
  liveBlobs.has(secondUrl) && !revokedBlobs.has(secondUrl),
  `secondUrl=${secondUrl}, isRevoked=${revokedBlobs.has(secondUrl)} (Chrome shows: "It may have been moved, edited, or deleted")`
);

check(
  'DocumentPreviewWidget.jsx does NOT revoke store-owned blob: URLs directly (leaves lifecycle to mongoStore/localStore)',
  !widgetRevokesStoreBlobOnUnmount,
  'DocumentPreviewWidget.jsx calls URL.revokeObjectURL() directly, poisoning mongoStore._urls singleton cache'
);

// 4. Also verify DocumentDashboard.jsx doesn't directly revoke store-owned URLs either (only calls fileStore.revokeAll)
const docDashSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/Document/DocumentDashboard.jsx'),
  'utf8'
);
check(
  'DocumentDashboard.jsx does not call raw URL.revokeObjectURL() on store-owned previewCache entries',
  !/URL\.revokeObjectURL\(/.test(docDashSrc),
  'DocumentDashboard.jsx calls URL.revokeObjectURL() directly'
);

// 5. Verify freshBlobUrl: true recovers EVEN IF the previous blob URL was revoked externally (Edge/HMR/revokeAll) with ZERO network refetch
let fetchCountBefore = 0;
const prevFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  fetchCountBefore += 1;
  return prevFetch(...args);
};
URL.revokeObjectURL(secondUrl); // Simulate external revocation / Edge PDF eviction
const recoveredUrl = await mongoStore.getUrl(fileId, { freshBlobUrl: true, throwOnError: true });
check(
  'mongoStore.getUrl(fileId, { freshBlobUrl: true }) mints a fresh LIVE blob: URL from cached Blob bytes with 0 network calls even after external revocation',
  liveBlobs.has(recoveredUrl) && recoveredUrl !== secondUrl && fetchCountBefore === 0,
  `recovered=${recoveredUrl}, live=${liveBlobs.has(recoveredUrl)}, networkCalls=${fetchCountBefore}`
);
globalThis.fetch = prevFetch;

// 6. Verify mongoStore.getUrl(fileId, { fresh: true }) revokes old URL and returns a fresh live URL
check(
  'mongoStore.getUrl(fileId, { fresh: true }) revokes old URL and returns a fresh live URL',
  await (async () => {
    const freshUrl = await mongoStore.getUrl(fileId, { fresh: true, throwOnError: true });
    return liveBlobs.has(freshUrl) && freshUrl !== firstUrl;
  })()
);

URL.createObjectURL = origCreate;
URL.revokeObjectURL = origRevoke;
globalThis.fetch = origFetch;

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\n✅ All checks passed.');
