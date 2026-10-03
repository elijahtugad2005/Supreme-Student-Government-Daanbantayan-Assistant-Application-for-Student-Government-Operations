/**
 * Exercises the legacy-PDF migration end to end.
 *
 *   npx firebase emulators:start --only firestore,storage --project <your-project-id>
 *   node scripts/migrate-check.mjs
 *
 * Seeds a legacy `pdfs` collection in the exact shape the old dashboard wrote,
 * runs the migration script as a child process, then asserts what landed.
 *
 * Uses the Admin SDK rather than rules-unit-testing because a Firestore handle
 * obtained from `withSecurityRulesDisabled` is torn down when the callback
 * exits, which makes it unusable for assertions after the fact. Storage rule
 * enforcement is covered separately by documents-check.mjs.
 */
import { EMULATOR_BUCKET, EMULATOR_PROJECT } from './emulator-project.mjs';
import { spawnSync } from 'node:child_process';
import { EMULATOR_BUCKET, EMULATOR_PROJECT } from './emulator-project.mjs';
import { getApps, initializeApp } from 'firebase-admin/app';
import { EMULATOR_BUCKET, EMULATOR_PROJECT } from './emulator-project.mjs';
import { getFirestore } from 'firebase-admin/firestore';
import { EMULATOR_BUCKET, EMULATOR_PROJECT } from './emulator-project.mjs';
import { getStorage } from 'firebase-admin/storage';

// Must be host:port with NO protocol — the admin SDK rejects "http://".
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';

const app = getApps()[0] || initializeApp({
  projectId: EMULATOR_PROJECT,
  // The admin SDK needs an explicit bucket; the client SDK infers it.
  storageBucket: EMULATOR_BUCKET,
});
const db = getFirestore(app);
const bucket = getStorage(app).bucket();

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

const pdfDataUrl = `data:application/pdf;base64,${Buffer.from('%PDF-1.7\n%legacy\n%%EOF\n').toString('base64')}`;

const legacy = (over = {}) => ({
  pdfName: 'Memorandum No. 2026-014',
  pdfCreator: 'Secretariat',
  pdfDate: '2026-09-28',
  pdfCategory: 'Memorandum',
  pdfStatus: 'approved',
  pdfBase64: pdfDataUrl,
  fileSize: 24,
  fileName: 'memo-014.pdf',
  uploadedAt: '2026-09-28T02:00:00.000Z',
  lastModified: '2026-09-29T03:00:00.000Z',
  ...over,
});

// Reset first so the run is repeatable against a persistent emulator.
// A QuerySnapshot is not iterable in the Admin SDK — use `.docs`.
for (const snap of (await db.collection('documents').get()).docs) await snap.ref.delete();
for (const snap of (await db.collection('pdfs').get()).docs) {
  if (snap.data()?.migrated) await snap.ref.delete();
}
for (const path of ['documents/migrated-p1/memo-014.pdf', 'documents/migrated-p2/letter.pdf', 'documents/migrated-p3/report.pdf']) {
  await bucket.file(path).delete({ ignoreNotFound: true });
}

await db.collection('pdfs').doc('p1').set(legacy());
await db.collection('pdfs').doc('p2').set(legacy({
  pdfName: 'Letter to Campus Director',
  pdfCategory: 'Letter',
  pdfStatus: 'pending',
  fileName: 'letter.pdf',
}));
await db.collection('pdfs').doc('p3').set(legacy({
  pdfName: 'Narrative Report',
  pdfCategory: 'Report',
  pdfStatus: 'archived',
  fileName: 'report.pdf',
}));
await db.collection('pdfs').doc('p4').set(legacy({ pdfName: 'No File Data', fileName: 'nodata.pdf' }));
await db.collection('pdfs').doc('p4').update({ pdfBase64: null });

const run = (args) => {
  const res = spawnSync('node', ['scripts/migrate-legacy-pdfs.mjs', ...args, '--project=' + EMULATOR_PROJECT, '--emulators'], {
    encoding: 'utf8',
  });
  return { ...res, out: `${res.stdout}${res.stderr}` };
};

console.log('=== Dry run changes nothing ===');
const dry = run([]);
check('dry run says it is a dry run', /DRY RUN/.test(dry.out), dry.out.slice(-400));
check('dry run found 4 legacy documents', /Found 4 legacy document/.test(dry.out), dry.out.slice(-400));
check('dry run would migrate 3', /WOULD MIGRATE/.test(dry.out) && !/\[1\/4\] WOULD MIGRATE  No File Data/.test(dry.out));

const afterDry = await db.collection('documents').get();
check('dry run created no documents', afterDry.empty, `${afterDry.size}`);
check('dry run did not stamp the source', !(await db.collection('pdfs').doc('p1').get()).data()?.migrated);

console.log('\n=== A real run migrates ===');
const real = run(['--write']);
check('write run exited cleanly', real.status === 0, real.out.slice(-700));
check('three records migrated', /Migrated: 3/.test(real.out), real.out.slice(-700));
check('one record skipped for missing file data', /No data: 1/.test(real.out), real.out.slice(-700));

const docs = await db.collection('documents').get();
check('three documents created', docs.size === 3, `${docs.size}`);

const memo = (await db.collection('documents').doc('migrated-p1').get()).data();
check('title carried over', memo?.title === 'Memorandum No. 2026-014', memo?.title);
check('creator carried over', memo?.createdByName === 'Secretariat');
check('authoritative status preserved', memo?.status === 'approved', memo?.status);
check('Memorandum became the memorandum label', memo?.labels?.includes('memorandum'), JSON.stringify(memo?.labels));
check('AI fields declared as unprocessed',
  memo?.aiState === 'not_processed' && memo?.extractedText === null && memo?.aiConfidence === null);
check('migration is traceable',
  memo?.migratedFrom?.collection === 'pdfs' && memo?.migratedFrom?.id === 'p1',
  JSON.stringify(memo?.migratedFrom));
check('storage path is under documents/',
  memo?.storagePath === 'documents/migrated-p1/memo-014.pdf', memo?.storagePath);

const pending = (await db.collection('documents').doc('migrated-p2').get()).data();
check('"pending" remapped to pending_signature', pending?.status === 'pending_signature', pending?.status);
const report = (await db.collection('documents').doc('migrated-p3').get()).data();
check('"Report" category became narrative_report label', report?.labels?.includes('narrative_report'));
check('"archived" preserved as a legacy status', report?.status === 'archived', report?.status);

console.log('\n=== Sources are stamped, never deleted ===');
const sources = await db.collection('pdfs').get();
check('all four legacy documents remain', sources.size === 4, String(sources.size));
const stamped = (await db.collection('pdfs').doc('p1').get()).data();
check('migrated source is stamped', stamped?.migrated?.documentId === 'migrated-p1', JSON.stringify(stamped?.migrated));
check('original Base64 retained for audit', !!stamped?.pdfBase64);
check('record with no file data is also stamped', !!(await db.collection('pdfs').doc('p4').get()).data()?.migrated);

console.log('\n=== Re-running is safe ===');
const second = run(['--write']);
check('second run skips what is already migrated', /Skipping 3 already migrated/.test(second.out), second.out.slice(-500));
check('no duplicates created', (await db.collection('documents').get()).size === 3, String((await db.collection('documents').get()).size));

console.log('\n=== Storage really holds the file ===');
try {
  const downloaded = await bucket.file('documents/migrated-p1/memo-014.pdf').download();
  // The Storage emulator returns an ARRAY OF BUFFERS (one per chunk), not a
  // single Buffer. Flatten it before inspecting the bytes.
  const raw = Array.isArray(downloaded) ? Buffer.concat(downloaded) : Buffer.from(downloaded);
  check('migrated PDF is in Storage', raw.length > 0, `${raw.length} bytes`);
  check('content is real PDF', raw.toString('utf8').startsWith('%PDF'), JSON.stringify(raw.toString('utf8').slice(0, 16)));
  check('size is sane', raw.length < 100, `${raw.length}`);
} catch (error) {
  check('migrated PDF is in Storage', false, error.message);
}

await app.delete();
console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nMigration behaves correctly.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);