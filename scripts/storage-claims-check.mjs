/**
 * Proves the role-claim fix: storage.rules authorise on request.auth.token.role,
 * so a correctly stamped token must grant access and a stale or absent one must
 * not.
 *
 *   npx firebase emulators:start --only functions,firestore,storage --project <your-project-id>
 *   node scripts/storage-claims-check.mjs
 *
 * These are the scenarios the blocker caused in production: a user with the
 * correct Firestore role still being refused Storage access because their token
 * carried no claim.
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

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, role] of [
    ['admin1', 'admin'], ['sec1', 'secretary'], ['rep1', 'representative'],
    ['gov1', 'governor'], ['sen1', 'senator'], ['mem1', 'member'], ['guest1', 'guest'],
  ]) {
    await db.collection('users').doc(id).set({ role, name: id });
  }
  // ctx.storage() is a Storage instance, not the admin SDK: seed with a ref.
  await ctx.storage()
    .ref('documents/d1/seed.pdf')
    .put(Buffer.from('%PDF-1.7\n'), { contentType: 'application/pdf' });
});

// Second argument is the custom claim set, which is what storage.rules reads.
const as = (uid, claims = {}) => testEnv.authenticatedContext(uid, claims).storage();
const anon = () => testEnv.unauthenticatedContext().storage();
const path = 'documents/d1/seed.pdf';
const bytes = Buffer.from('%PDF-1.7\n');

console.log('=== The blocker: correct Firestore role, no claim ===');
await check('an officer with NO claim is refused (the original bug)', () =>
  assertFails(as('sec1').ref(path).getBytes()));
await check('an officer with no claim cannot upload either', () =>
  assertFails(as('sec1').ref('documents/d2/new.pdf').put(bytes, { contentType: 'application/pdf' })));

console.log('\n=== After the claim is synced ===');
await check('a secretary WITH the matching claim can read', () =>
  assertSucceeds(as('sec1', { role: 'secretary' }).ref(path).getBytes()));
await check('a secretary WITH the matching claim can upload', () =>
  assertSucceeds(as('sec1', { role: 'secretary' }).ref('documents/d2/new.pdf')
    .put(bytes, { contentType: 'application/pdf' })));
await check('an admin claim works too', () =>
  assertSucceeds(as('admin1', { role: 'admin' }).ref(path).getBytes()));
await check('a representative claim works', () =>
  assertSucceeds(as('rep1', { role: 'representative' }).ref(path).getBytes()));
await check('a governor claim works', () =>
  assertSucceeds(as('gov1', { role: 'governor' }).ref(path).getBytes()));

console.log('\n=== A claim is not a licence to exceed your role ===');
await check('a member with a member claim is refused', () =>
  assertFails(as('mem1', { role: 'member' }).ref(path).getBytes()));
await check('a guest with a guest claim is refused', () =>
  assertFails(as('guest1', { role: 'guest' }).ref(path).getBytes()));
await check('a senator with a senator claim is refused', () =>
  assertFails(as('sen1', { role: 'senator' }).ref(path).getBytes()));
await check('a member cannot escalate by claiming admin in the token', () =>
  assertFails(as('mem1', { role: 'admin' }).ref('documents/d3/escalated.pdf')
    .put(bytes, { contentType: 'application/pdf' })));
await check('an anonymous visitor is still refused', () =>
  assertFails(anon().ref(path).getBytes()));

console.log('\n=== Storage rules still enforce type and size ===');
await check('a valid officer upload is accepted', () =>
  assertSucceeds(as('sec1', { role: 'secretary' }).ref('documents/d4/report.docx')
    .put(bytes, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })));
await check('an executable content type is refused', () =>
  assertFails(as('sec1', { role: 'secretary' }).ref('documents/d4/evil.exe')
    .put(bytes, { contentType: 'application/x-msdownload' })));
await check('a file over 25MB is refused', () =>
  assertFails(as('sec1', { role: 'secretary' }).ref('documents/d4/huge.pdf')
    .put(Buffer.alloc(26 * 1024 * 1024), { contentType: 'application/pdf' })));
await check('nothing is reachable outside /documents even with an admin claim', () =>
  assertFails(as('admin1', { role: 'admin' }).ref('somewhere-else/x.pdf').getBytes()));

console.log('\n=== Firestore and Storage agree on who manages documents ===');
await check('a member claim still cannot read document metadata', () =>
  assertFails(
    testEnv.authenticatedContext('mem1', { role: 'member' })
      .firestore().collection('documents').get()
  ));
await check('a secretary claim matches their Firestore access', () =>
  assertSucceeds(
    testEnv.authenticatedContext('sec1', { role: 'secretary' })
      .firestore().collection('documents').get()
  ));

await testEnv.cleanup();
console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nRole claims unblock Storage correctly.' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);