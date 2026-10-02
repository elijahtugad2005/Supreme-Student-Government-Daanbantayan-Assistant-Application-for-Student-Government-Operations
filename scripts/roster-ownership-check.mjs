/**
 * Validates the roster submitter's limited edit rights against the emulator.
 *
 *   npx firebase emulators:start --only firestore --project demo-ssg
 *   node scripts/roster-ownership-check.mjs
 */
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-ssg',
  firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
});

await testEnv.clearFirestore();

let failed = 0;
const results = [];
const check = (label, ok) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}`); }
};

const students = (n) => Array.from({ length: n }, (_, i) => ({ name: `Student ${i + 1}`, section: 'BSIT - 1A' }));

const pending = (over = {}) => ({
  college: 'College of Technology and Engineering', program: 'BSIT',
  section: 'BSIT - 1A', sectionKey: 'bsit - 1a', yearLevel: 1,
  mayorName: 'Mayor Santos', mayorUid: 'mayor1',
  status: 'pending', isCurrent: false, version: null,
  studentCount: 3, students: students(3),
  source: { fileName: 'a.xlsx', nameColumn: 'NAME', sectionColumn: null, ignoredColumns: [] },
  correctionReason: '', submittedAt: new Date('2026-10-01T00:00:00Z'),
  verifiedAt: null, verifiedBy: null,
  ...over,
});

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, role] of [['mayor1', 'guest'], ['mayor2', 'guest'], ['sec1', 'secretary'], ['admin1', 'admin']]) {
    await db.collection('users').doc(id).set({ role, name: id });
  }
  await db.collection('classRosters').doc('pending-1').set(pending());
  await db.collection('classRosters').doc('verified-1').set(pending({
    status: 'verified', isCurrent: true, version: 1,
    verifiedAt: new Date('2026-10-02T00:00:00Z'), verifiedBy: 'sec1',
  }));
});

const as = (uid) => testEnv.authenticatedContext(uid).firestore();

console.log('=== A submitter can fix their own pending submission ===');
await check('Mayor CAN update their pending roster', () =>
  assertSucceeds(as('mayor1').collection('classRosters').doc('pending-1').update({ studentCount: 2 })));
await check('Mayor CAN withdraw their pending roster', () =>
  assertSucceeds(as('mayor1').collection('classRosters').doc('pending-2').set(pending())));
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await ctx.firestore().collection('classRosters').doc('pending-2').set(pending());
});
await check('Mayor CAN delete their pending roster', () =>
  assertSucceeds(as('mayor1').collection('classRosters').doc('pending-2').delete()));

console.log('\n=== But not someone else\'s ===');
await check('another Mayor CANNOT update it', () =>
  assertFails(as('mayor2').collection('classRosters').doc('pending-1').update({ studentCount: 99 })));
await check('another Mayor CANNOT delete it', () =>
  assertFails(as('mayor2').collection('classRosters').doc('pending-1').delete()));

console.log('\n=== A verified roster needs a declared transfer ===');
await check('Mayor CANNOT silently edit a verified roster', () =>
  assertFails(as('mayor1').collection('classRosters').doc('verified-1').update({ studentCount: 1 })));
await check('Mayor CANNOT silently replace its student list', () =>
  assertFails(as('mayor1').collection('classRosters').doc('verified-1').update({ students: students(1) })));

await check('Mayor CAN amend it when transfers are declared', () =>
  assertSucceeds(as('mayor1').collection('classRosters').doc('verified-1').update({
    status: 'pending',
    students: students(2),
    studentCount: 2,
    hasTransfers: true,
    transferCount: 1,
    transferReason: '1 student shifted to BSIT - 1B',
  })));

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await ctx.firestore().collection('classRosters').doc('verified-1').set(pending({
    status: 'verified', isCurrent: true, version: 1,
    verifiedAt: new Date('2026-10-02T00:00:00Z'), verifiedBy: 'sec1',
  }));
});

await check('an amendment without a reason is rejected', () =>
  assertFails(as('mayor1').collection('classRosters').doc('verified-1').update({
    status: 'pending', hasTransfers: true, transferCount: 1,
  })));
await check('an amendment with a zero transfer count is rejected', () =>
  assertFails(as('mayor1').collection('classRosters').doc('verified-1').update({
    status: 'pending', hasTransfers: true, transferCount: 0, transferReason: 'typo',
  })));
await check('an amendment that stays verified is rejected', () =>
  assertFails(as('mayor1').collection('classRosters').doc('verified-1').update({
    students: students(2), hasTransfers: true, transferCount: 1, transferReason: 'shifted',
  })));

console.log('\n=== A verified roster cannot be deleted by its submitter ===');
await check('Mayor CANNOT delete their verified roster', () =>
  assertFails(as('mayor1').collection('classRosters').doc('verified-1').delete()));
await check('officer CAN delete a verified roster', () =>
  assertSucceeds(as('sec1').collection('classRosters').doc('verified-1').delete()));

console.log('\n=== Officers are unaffected ===');
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await ctx.firestore().collection('classRosters').doc('pending-1').set(pending());
});
await check('Secretary CAN still verify a pending roster', () =>
  assertSucceeds(as('sec1').collection('classRosters').doc('pending-1').update({
    status: 'verified', isCurrent: true, version: 1,
  })));

await testEnv.cleanup();
console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nRoster submitter rights behave as designed.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);