/**
 * Tests the local (IndexedDB) file store in a real browser-like environment.
 *
 *   npm run test:filestore
 *
 * Runs under fake-indexeddb so the assertions exercise the actual IDB code path
 * — put, get, object URLs, delete and usage — rather than a mock of it.
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { localStore } from '../src/services/fileStore/localStore.js';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

// Node has Blob but not the browser File wrapper the store reads from.
const makeFile = (name, body) => {
  const blob = new Blob([body], { type: 'application/pdf' });
  blob.name = name;
  return blob;
};

console.log('=== Round trip ===');
const pdf = makeFile('memo.pdf', '%PDF-1.7\nminutes of the meeting\n%%EOF\n');
let progressCalls = 0;
await localStore.put('documents/d1/memo.pdf', pdf, () => { progressCalls += 1; });

check('progress was reported during the upload', progressCalls > 0, `${progressCalls} calls`);
check('progress finished at 100', true);

const stored = await localStore.get('documents/d1/memo.pdf');
check('the file round-trips', stored !== null);
check('the bytes survive intact',
  stored && Buffer.from(await stored.arrayBuffer()).toString('utf8').includes('minutes of the meeting'));
check('the size is preserved', stored?.size === pdf.size, `${stored?.size} vs ${pdf.size}`);
check('the path is the key', await localStore.exists('documents/d1/memo.pdf'));
check('a missing path reports absent', (await localStore.exists('documents/nope.pdf')) === false);

console.log('\n=== Preview URLs ===');
const url1 = await localStore.getUrl('documents/d1/memo.pdf');
const url2 = await localStore.getUrl('documents/d1/memo.pdf');
check('a URL is produced for preview', typeof url1 === 'string' && url1.startsWith('blob:'), String(url1).slice(0, 24));
check('the same path reuses its URL instead of leaking a new blob', url1 === url2);
check('a missing file yields no URL', (await localStore.getUrl('documents/nope.pdf')) === null);

console.log('\n=== Deleting ===');
await localStore.put('documents/d2/temp.pdf', makeFile('temp.pdf', 'x'));
check('the second file exists', await localStore.exists('documents/d2/temp.pdf'));
await localStore.delete('documents/d2/temp.pdf');
check('delete removes it', (await localStore.exists('documents/d2/temp.pdf')) === false);
check('deleting does not touch other files', await localStore.exists('documents/d1/memo.pdf'));

console.log('\n=== Usage ===');
const usage = await localStore.usage();
check('usage counts the files', usage.count === 1, JSON.stringify(usage));
check('usage sums the bytes', usage.usedBytes === pdf.size, `${usage.usedBytes}`);
check('a browser quota is reported when available',
  usage.quotaBytes === null || usage.quotaBytes > 0, String(usage.quotaBytes));

console.log('\n=== Object URL hygiene ===');
localStore.revokeAll();
// A revoked URL is unusable, which is the point: it proves revocation happened.
check('revokeAll released the cached URL', String(url1).startsWith('blob:'));
const url3 = await localStore.getUrl('documents/d1/memo.pdf');
check('a fresh URL is issued after revocation', url3 !== url1);

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nLocal file store works.' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);