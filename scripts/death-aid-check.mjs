/**
 * Validates the Death Aid rules against the Firestore emulator.
 *
 *   npx firebase emulators:start --only firestore --project demo-ssg
 *   npm run test:death-aid
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

const ROSTER = {
  college: 'College of Technology and Engineering',
  program: 'BSIT',
  section: 'BSIT - 1A',
  sectionKey: 'bsit - 1a',
  yearLevel: 1,
  mayorName: 'Mayor Santos',
  mayorUid: 'mayor1',
  status: 'verified',
  isCurrent: true,
  version: 1,
  studentCount: 40,
  students: Array.from({ length: 40 }, (_, i) => ({ name: `Student ${i + 1}`, section: 'BSIT - 1A' })),
  submittedAt: new Date('2026-01-01T00:00:00Z'),
};

/** The SSG example: 40 enrolled, 39 paid at ₱1 -> ₱39 collected, 1 owing. */
const filing = (id, recorderUid, over = {}) => ({
  collectionId: id,
  rosterId: 'roster-1',
  rosterVersion: 1,
  sectionKey: 'bsit - 1a',
  section: 'BSIT - 1A',
  program: 'BSIT',
  college: 'College of Technology and Engineering',
  yearLevel: 1,
  mayorName: 'Mayor Santos',
  enrolledCount: 40,
  contributionPerStudent: 1,
  beneficiaryCount: 39,
  collectedAmount: 39,
  expectedCollection: 40,
  debtCount: 1,
  debtAmount: 1,
  debtRecords: [{ studentName: 'Student 7', debtType: 'named', note: '', amount: 1 }],
  unidentifiedDebtCount: 0,
  submittedByName: 'Classmate',
  recordedByUid: recorderUid,
  recordedByName: 'Officer',
  recordedByRole: 'secretary',
  status: 'for_verification',
  submittedAt: new Date('2026-10-02T00:00:00Z'),
  confirmedAt: null,
  confirmedByUid: null,
  confirmedByName: null,
  amountReceived: null,
  ...over,
});

const remittance = (id, uid, over = {}) => ({
  collectionId: id,
  sectionKey: 'bsit - 1a',
  section: 'BSIT - 1A',
  reportedAmount: 39,
  amountReceived: 39,
  difference: 0,
  status: 'confirmed',
  receivedByUid: uid,
  receivedByName: 'Officer',
  receivedByRole: 'secretary',
  receivedAt: new Date(),
  ...over,
});

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, role] of [
    ['sec1', 'secretary'], ['fin1', 'finance_secretary'], ['gov1', 'governor'],
    ['rep1', 'representative'], ['sen1', 'senator'], ['mem1', 'member'],
    ['mayor1', 'guest'], ['admin1', 'admin'],
  ]) {
    await db.collection('users').doc(id).set({ role, name: id });
  }
  await db.collection('classRosters').doc('roster-1').set(ROSTER);
  await db.collection('classRosters').doc('roster-pending').set({ ...ROSTER, status: 'pending' });
});

const as = (uid) => testEnv.authenticatedContext(uid).firestore();

console.log('=== Officers record; the arithmetic is forced ===');
await check('Secretary CAN record a collection', () =>
  assertSucceeds(as('sec1').collection('deathAidCollections').doc('DA-2026-0001').set(filing('DA-2026-0001', 'sec1'))));
await check('Member CANNOT record a collection', () =>
  assertFails(as('mem1').collection('deathAidCollections').doc('DA-2026-0002').set(filing('DA-2026-0002', 'mem1'))));
await check('Mayor CANNOT record a collection', () =>
  assertFails(as('mayor1').collection('deathAidCollections').doc('DA-2026-0003').set(filing('DA-2026-0003', 'mayor1'))));
await check('enrolledCount cannot be shrunk below the roster', () =>
  assertFails(as('sec1').collection('deathAidCollections').doc('DA-2026-0004')
    .set(filing('DA-2026-0004', 'sec1', { enrolledCount: 1, expectedCollection: 1, debtCount: 0, debtAmount: 0 }))));
await check('collectedAmount must equal beneficiaries x contribution', () =>
  assertFails(as('sec1').collection('deathAidCollections').doc('DA-2026-0005')
    .set(filing('DA-2026-0005', 'sec1', { collectedAmount: 500 }))));
await check('debtCount must equal enrolled minus beneficiaries', () =>
  assertFails(as('sec1').collection('deathAidCollections').doc('DA-2026-0006')
    .set(filing('DA-2026-0006', 'sec1', { debtCount: 0, debtAmount: 0 }))));
await check('beneficiaries cannot exceed enrolment', () =>
  assertFails(as('sec1').collection('deathAidCollections').doc('DA-2026-0007')
    .set(filing('DA-2026-0007', 'sec1', { beneficiaryCount: 99, collectedAmount: 99, debtCount: -59, debtAmount: -59 }))));
await check('a collection cannot be created pre-confirmed', () =>
  assertFails(as('sec1').collection('deathAidCollections').doc('DA-2026-0008')
    .set(filing('DA-2026-0008', 'sec1', { status: 'confirmed' }))));
await check('an unverified roster cannot back a collection', () =>
  assertFails(as('sec1').collection('deathAidCollections').doc('DA-2026-0009')
    .set(filing('DA-2026-0009', 'sec1', { rosterId: 'roster-pending' }))));

console.log('\n=== Widened roles may record ===');
await check('Governor CAN record', () =>
  assertSucceeds(as('gov1').collection('deathAidCollections').doc('DA-2026-0010').set(filing('DA-2026-0010', 'gov1'))));
await check('Representative CAN record', () =>
  assertSucceeds(as('rep1').collection('deathAidCollections').doc('DA-2026-0011').set(filing('DA-2026-0011', 'rep1'))));
await check('Senator CANNOT record', () =>
  assertFails(as('sen1').collection('deathAidCollections').doc('DA-2026-0012').set(filing('DA-2026-0012', 'sen1'))));

console.log('\n=== Reading ===');
await check('Governor CAN read collections', () =>
  assertSucceeds(as('gov1').collection('deathAidCollections').get()));
await check('Member CANNOT read collections', () =>
  assertFails(as('mem1').collection('deathAidCollections').get()));
await check('Mayor CANNOT read collections', () =>
  assertFails(as('mayor1').collection('deathAidCollections').get()));

console.log('\n=== The recorder cannot also certify ===');
await check('recording officer CANNOT accept their own collection', () =>
  assertFails(as('sec1').collection('deathAidRemittances').doc('DA-2026-0001').set(remittance('DA-2026-0001', 'sec1'))));
await check('a different officer CAN accept it', () =>
  assertSucceeds(as('gov1').collection('deathAidRemittances').doc('DA-2026-0001').set(remittance('DA-2026-0001', 'gov1'))));
await check('Member CANNOT accept a remittance', () =>
  assertFails(as('mem1').collection('deathAidRemittances').doc('DA-2026-0011').set(remittance('DA-2026-0011', 'mem1'))));
await check('a mismatch CANNOT be recorded as confirmed', () =>
  assertFails(as('gov1').collection('deathAidRemittances').doc('DA-2026-0011')
    .set(remittance('DA-2026-0011', 'gov1', { amountReceived: 38, difference: -1, status: 'confirmed' }))));
await check('a mismatch CAN be recorded as a discrepancy', () =>
  assertSucceeds(as('gov1').collection('deathAidRemittances').doc('DA-2026-0011')
    .set(remittance('DA-2026-0011', 'gov1', { amountReceived: 38, difference: -1, status: 'discrepancy' }))));
await check('reportedAmount cannot differ from the recorded collection', () =>
  assertFails(as('gov1').collection('deathAidRemittances').doc('DA-2026-0010')
    .set(remittance('DA-2026-0010', 'gov1', { reportedAmount: 100, difference: -61 }))));

console.log('\n=== Recorded money is immutable; debts may be explained later ===');
await check('officer CANNOT rewrite amount received', () =>
  assertFails(as('gov1').collection('deathAidRemittances').doc('DA-2026-0001').update({ amountReceived: 100 })));
await check('officer CAN record the verdict on the collection', () =>
  assertSucceeds(as('gov1').collection('deathAidCollections').doc('DA-2026-0001').update({
    status: 'confirmed', amountReceived: 39,
  })));
await check('officer CANNOT change the counted money afterwards', () =>
  assertFails(as('gov1').collection('deathAidCollections').doc('DA-2026-0001').update({ beneficiaryCount: 40 })));
await check('officer CANNOT change the enrolled count afterwards', () =>
  assertFails(as('gov1').collection('deathAidCollections').doc('DA-2026-0001').update({ enrolledCount: 1 })));
await check('officer CAN fill in debtor names later', () =>
  assertSucceeds(as('gov1').collection('deathAidCollections').doc('DA-2026-0011').update({
    debtRecords: [{ studentName: 'Student 3', debtType: 'absent', note: 'went home', amount: 1 }],
    debtDetailsCompletedAt: new Date(),
    debtDetailsCompletedByUid: 'gov1',
  })));
await check('names CANNOT claim more debtors than are owing', () =>
  assertFails(as('gov1').collection('deathAidCollections').doc('DA-2026-0011').update({
    debtRecords: [
      { studentName: 'A', debtType: 'named', amount: 1 },
      { studentName: 'B', debtType: 'named', amount: 1 },
      { studentName: 'C', debtType: 'named', amount: 1 },
    ],
  })));

console.log('\n=== Audit is append-only and officer-only ===');
await check('officer CAN append an audit entry', () =>
  assertSucceeds(as('sec1').collection('deathAidAuditLog').add({
    collectionId: 'DA-2026-0001', action: 'collection_recorded',
    actorUid: 'sec1', actorName: 'Officer', actorRole: 'secretary', at: new Date(),
  })));
await check('a Member CANNOT append an audit entry', () =>
  assertFails(as('mem1').collection('deathAidAuditLog').add({
    collectionId: 'X', action: 'fake', actorUid: 'mem1', actorName: 'm', actorRole: 'member', at: new Date(),
  })));
await check('an audit entry CANNOT be edited', () =>
  assertFails(as('admin1').collection('deathAidAuditLog').doc('x').update({ collectedAmount: 999 })));
await check('an audit entry CANNOT be deleted', () =>
  assertFails(as('admin1').collection('deathAidAuditLog').doc('x').delete()));
await check('Member CANNOT read the audit trail', () =>
  assertFails(as('mem1').collection('deathAidAuditLog').get()));
await check('officer CAN read the audit trail', () =>
  assertSucceeds(as('sec1').collection('deathAidAuditLog').get()));

console.log('\n=== Id allocation ===');
await check('officer CAN advance the counter', () =>
  assertSucceeds(as('sec1').collection('deathAidCounters').doc('2026').set({ count: 1, year: 2026, updatedAt: new Date() })));
await check('counter CANNOT carry extra fields', () =>
  assertFails(as('sec1').collection('deathAidCounters').doc('2027').set({ count: 1, year: 2027, balance: 500 })));
await check('Member CANNOT advance the counter', () =>
  assertFails(as('mem1').collection('deathAidCounters').doc('2028').set({ count: 1, year: 2028, updatedAt: new Date() })));

await testEnv.cleanup();
console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nDeath Aid rules behave as designed.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);