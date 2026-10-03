/**
 * Runs the exact query shapes used by src/services/rosterService.js against the
 * emulator, and asserts the in-memory sort ordering that replaced the server-side
 * orderBy (which needed a composite index).
 *
 * NOTE: the Firestore emulator does not enforce composite indexes the way the
 * production service does, so a pass here proves the queries and ordering are
 * correct but does NOT prove the production indexes exist. That still has to be
 * confirmed in the Firebase console.
 *
 *   npx firebase emulators:start --only firestore --project <your-project-id>
 *   node scripts/query-check.mjs
 */
import { EMULATOR_BUCKET, EMULATOR_PROJECT } from './emulator-project.mjs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { EMULATOR_BUCKET, EMULATOR_PROJECT } from './emulator-project.mjs';
import { readFileSync } from 'node:fs';

const testEnv = await initializeTestEnvironment({
  projectId: EMULATOR_PROJECT,
  firestore: {
    host: '127.0.0.1',
    port: 8080,
    rules: readFileSync('firestore.rules', 'utf8'),
  },
});

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
  }
};

const timeValue = (v) => {
  if (v === null || v === undefined) return -Infinity;
  if (typeof v.toMillis === 'function') return v.toMillis();
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isNaN(n) ? -Infinity : n;
};
const byTime = (a, b, field) => {
  const diff = timeValue(b[field]) - timeValue(a[field]);
  return diff !== 0 ? diff : String(a.id).localeCompare(String(b.id));
};

const base = (over) => ({
  college: 'College of Technology and Engineering',
  program: 'BSIT',
  section: 'BSIT - 1A',
  sectionKey: 'bsit - 1a',
  yearLevel: 1,
  mayorName: 'No Mayor Assigned',
  status: 'pending',
  isCurrent: false,
  version: null,
  studentCount: 1,
  students: [{ name: 'Juan Dela Cruz' }],
  submittedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

// The emulator keeps data between runs, so start from a clean slate or counts
// include rows written by the rules suite.
await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const r = db.collection('classRosters');
  // Three submissions for one section, submitted out of order, plus a v1 and v2
  // of a verified roster for a second section.
  await r.doc('p-old').set(base({ submittedAt: new Date('2026-01-01T00:00:00Z') }));
  await r.doc('p-new').set(base({ submittedAt: new Date('2026-03-01T00:00:00Z') }));
  await r.doc('p-mid').set(base({ submittedAt: new Date('2026-02-01T00:00:00Z') }));
  await r.doc('done').set(base({ submittedAt: new Date('2026-01-05T00:00:00Z'), status: 'verified', isCurrent: true, version: 2 }));
  await r.doc('old').set(base({ submittedAt: new Date('2026-01-04T00:00:00Z'), status: 'verified', isCurrent: false, version: 1 }));
  await r.doc('fixed').set(base({ submittedAt: new Date('2026-01-06T00:00:00Z'), status: 'correction_requested' }));
  await db.collection('classSections').doc('bsit - 1a').set({
    sectionKey: 'bsit - 1a', section: 'BSIT - 1A', program: 'BSIT', yearLevel: 1,
    mayorName: 'No Mayor Assigned', status: 'verified', currentRosterId: 'done',
    updatedAt: new Date('2026-01-05T00:00:00Z'),
  });
  await db.collection('users').doc('governor1').set({ role: 'governor' });
});

const db = testEnv.authenticatedContext('governor1').firestore();
const rosters = db.collection('classRosters');

// listPendingSubmissions(): where status == pending, no orderBy, sorted in JS.
try {
  const snap = await rosters.where('status', '==', 'pending').get();
  const sorted = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => byTime(a, b, 'submittedAt'));
  check('pending query excludes verified and correction_requested', sorted.length === 3, `got ${sorted.length}`);
  check('pending sorts newest first', sorted.map((s) => s.id).join(',') === 'p-new,p-mid,p-old', sorted.map((s) => s.id).join(','));
} catch (e) {
  check('pending query runs', false, e.message);
}

// listRosterVersions(): where sectionKey ==, sorted by version desc in JS.
try {
  const snap = await rosters.where('sectionKey', '==', 'bsit - 1a').get();
  const sorted = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => byTime(a, b, 'version'));
  check('version sort puts highest version first', sorted[0].version === 2, `got ${sorted[0].version}`);
  check('unversioned drafts sort last', sorted[sorted.length - 1].version === null, `got ${sorted[sorted.length - 1].version}`);
} catch (e) {
  check('version query runs', false, e.message);
}

// getVerifiedRoster(): three equality filters + limit(1).
try {
  const snap = await rosters
    .where('sectionKey', '==', 'bsit - 1a')
    .where('status', '==', 'verified')
    .where('isCurrent', '==', true)
    .limit(1)
    .get();
  const doc = snap.docs[0];
  const data = doc.data();
  check('verified lookup returns exactly one roster', snap.size === 1, `got ${snap.size}`);
  check('verified lookup returns the CURRENT roster', doc.id === 'done', `got ${doc.id}`);
  check('activeStudents derives from the stored list', data.students.length === 1, `got ${data.students.length}`);
} catch (e) {
  check('verified lookup runs', false, e.message);
}

// listSections(): orderBy updatedAt desc — single field.
try {
  const snap = await db.collection('classSections').orderBy('updatedAt', 'desc').get();
  check('section registry query runs', snap.size === 1, `got ${snap.size}`);
  check('section exposes yearLevel for grouping', snap.docs[0].data().yearLevel === 1);
} catch (e) {
  check('section registry query runs', false, e.message);
}

await testEnv.cleanup();
console.log(results.join('\n'));
console.log(failed === 0 ? '\nAll roster queries return correct data and ordering.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);