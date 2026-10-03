/**
 * Validates the document repository rules against the emulators.
 *
 *   npx firebase emulators:start --only firestore,storage --project <your-project-id>
 *   npm run test:documents
 */
import { EMULATOR_BUCKET, EMULATOR_PROJECT } from './emulator-project.mjs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { EMULATOR_BUCKET, EMULATOR_PROJECT } from './emulator-project.mjs';
import { readFileSync } from 'node:fs';

const testEnv = await initializeTestEnvironment({
  projectId: EMULATOR_PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync('firestore.rules', 'utf8') },
  storage: { host: '127.0.0.1', port: 9199, rules: readFileSync('storage.rules', 'utf8') },
});

await testEnv.clearFirestore();

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

const ROLES = {
  admin: 'admin',
  secretary: 'secretary',
  rep: 'representative',
  senator: 'senator',
  finance: 'finance_secretary',
  member: 'member',
  guest: 'guest',
};

const MANAGERS = ['admin', 'secretary', 'rep', 'senator'];

const doc = (over = {}) => ({
  title: 'Resolution No. 2026-014',
  documentNumber: '2026-014',
  status: 'draft',
  documentDate: '2026-09-28',
  office: 'Secretariat',
  labels: ['resolution'],
  storagePath: 'documents/doc-1/Resolution.pdf',
  originalFileName: 'Resolution.pdf',
  mimeType: 'application/pdf',
  fileSize: 2048,
  createdBy: 'sec1',
  createdByName: 'Secretary',
  createdAt: new Date(),
  updatedAt: new Date(),
  extractedText: null,
  summary: null,
  aiConfidence: null,
  aiProcessedAt: null,
  aiState: 'not_processed',
  ...over,
});

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, role] of Object.entries(ROLES)) {
    await db.collection('users').doc(id).set({ role, name: id });
  }
  await db.collection('documents').doc('doc-1').set(doc());
  await db.collection('documentLabels').doc('resolution').set({
    slug: 'resolution', name: 'Resolution', description: 'Formal decisions.', active: true, aiEnabled: true,
  });
});

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

console.log('=== Reading the archive ===');
for (const role of MANAGERS) {
  await check(`${role} CAN read documents`, () =>
    assertSucceeds(as(role).collection('documents').get()));
}
await check('finance_secretary CANNOT read documents', () =>
  assertFails(as('finance').collection('documents').get()));
await check('member CANNOT read documents', () =>
  assertFails(as('member').collection('documents').get()));
await check('guest CANNOT read documents', () =>
  assertFails(as('guest').collection('documents').get()));
await check('signed-out visitor CANNOT read documents', () =>
  assertFails(anon().collection('documents').get()));

console.log('\n=== Writing to the archive ===');
await check('secretary CAN upload a document', () =>
  assertSucceeds(as('secretary').collection('documents').doc('doc-2').set(doc({ storagePath: 'documents/doc-2/a.pdf' }))));
await check('representative CAN upload a document', () =>
  assertSucceeds(as('rep').collection('documents').doc('doc-3').set(doc({ storagePath: 'documents/doc-3/a.pdf' }))));
await check('member CANNOT upload a document', () =>
  assertFails(as('member').collection('documents').doc('doc-4').set(doc())));
await check('signed-out visitor CANNOT upload a document', () =>
  assertFails(anon().collection('documents').doc('doc-5').set(doc())));
await check('a manager CAN edit metadata', () =>
  assertSucceeds(as('secretary').collection('documents').doc('doc-1').update({ title: 'Updated title' })));

console.log('\n=== Deleting ===');
await check('admin CAN delete a document', () =>
  assertSucceeds(as('admin').collection('documents').doc('doc-2').delete()));
await check('representative CANNOT delete a document', () =>
  assertFails(as('rep').collection('documents').doc('doc-3').delete()));
await check('member CANNOT delete a document', () =>
  assertFails(as('member').collection('documents').doc('doc-1').delete()));

console.log('\n=== Labels are shared vocabulary ===');
await check('manager CAN read labels', () =>
  assertSucceeds(as('secretary').collection('documentLabels').get()));
await check('manager CAN create a custom label', () =>
  assertSucceeds(as('secretary').collection('documentLabels').doc('activity-proposal').set({
    slug: 'activity-proposal', name: 'Activity Proposal', description: 'Activity proposals.', active: true, aiEnabled: true,
  })));
await check('member CANNOT create a label', () =>
  assertFails(as('member').collection('documentLabels').doc('x').set({ slug: 'x', name: 'X' })));
await check('guest CANNOT read labels', () =>
  assertFails(as('guest').collection('documentLabels').get()));

console.log('\n=== Subcollections ===');
await check('manager CAN append an audit entry', () =>
  assertSucceeds(as('secretary').collection('documents').doc('doc-1').collection('auditLogs').add({
    action: 'uploaded', performedBy: 'sec1', timestamp: new Date(),
  })));
await check('an audit entry CANNOT be edited', () =>
  assertFails(as('admin').collection('documents').doc('doc-1').collection('auditLogs').doc('x').update({ action: 'tampered' })));
await check('member CANNOT read the audit trail', () =>
  assertFails(as('member').collection('documents').doc('doc-1').collection('auditLogs').get()));

console.log('\n=== Phase 4/6 surfaces stay locked down ===');
await check('secretary CAN write a report template', () =>
  assertSucceeds(as('secretary').collection('documentTemplates').doc('t1').set({ name: 'Narrative Report', active: true })));
await check('representative CANNOT write a report template', () =>
  assertFails(as('rep').collection('documentTemplates').doc('t2').set({ name: 'X' })));
await check('secretary CAN register an approving official', () =>
  assertSucceeds(as('secretary').collection('officials').doc('o1').set({ name: 'Campus Director', position: 'Campus Director', active: true })));
await check('member CANNOT read the officials list', () =>
  assertFails(as('member').collection('officials').get()));

console.log('\n=== Storage: the original file ===');
const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
const storageFor = (uid, extra = {}) =>
  testEnv.authenticatedContext(uid, extra).storage();
const anonStorage = () => testEnv.unauthenticatedContext().storage();

await check('secretary CAN upload an original file', () =>
  assertSucceeds(storageFor('secretary').ref('documents/doc-1/Resolution.pdf')
    .put(bytes, { contentType: 'application/pdf' })));
await check('manager CAN read an original file', () =>
  assertSucceeds(storageFor('rep').ref('documents/doc-1/Resolution.pdf').getBytes()));
await check('member CANNOT read an original file', () =>
  assertFails(storageFor('member').ref('documents/doc-1/Resolution.pdf').getBytes()));
await check('signed-out visitor CANNOT read an original file', () =>
  assertFails(anonStorage().ref('documents/doc-1/Resolution.pdf').getBytes()));
await check('member CANNOT upload an original file', () =>
  assertFails(storageFor('member').ref('documents/doc-9/x.pdf').put(bytes, { contentType: 'application/pdf' })));
await check('a member with a role claim CAN upload', () =>
  assertFails(storageFor('member', { role: 'admin' }).ref('documents/doc-10/x.pdf').put(bytes, { contentType: 'application/pdf' })));
await check('admin CAN delete an original file', () =>
  assertSucceeds(storageFor('admin', { role: 'admin' }).ref('documents/doc-1/Resolution.pdf').delete()));
await check('nothing is readable outside /documents', () =>
  assertFails(storageFor('secretary').ref('somewhere-else/x.pdf').getBytes()));

await testEnv.cleanup();
console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nDocument repository rules behave as designed.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);