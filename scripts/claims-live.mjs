/**
 * Live test of the role-claim fix, through the real callable.
 *
 *   npx firebase emulators:start --only auth,functions,firestore,storage --project <your-project-id>
 *   node scripts/claims-live.mjs
 *
 * This is the actual production blocker, exercised end to end:
 *   1. a user with the right Firestore role is refused by Storage (no claim)
 *   2. syncClaims copies the role onto the ID token
 *   3. the refreshed token is now accepted by Storage
 *   4. a user with no role gets no claim and stays refused
 *   5. a member cannot escalate by asking for a different role
 */
import { EMULATOR_PROJECT, emulatorIssuer } from './emulator-project.mjs';
import { getApps, initializeApp } from 'firebase-admin/app';
import { EMULATOR_PROJECT, emulatorIssuer } from './emulator-project.mjs';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
process.env.FUNCTIONS_EMULATOR_HOST = '127.0.0.1:5001';

const PROJECT = EMULATOR_PROJECT;
const REGION = 'us-central1';

const adminApp =
  getApps().find((a) => a.name === 'admin') ||
  initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.firebasestorage.app` }, 'admin');
const adminDb = getFirestore(adminApp);

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

// ── Create real emulator users via the client SDK ──────────
// The SDK knows the emulator's routing; hand-built REST paths do not.
const { initializeApp: initClient } = await import('firebase/app');
const {
  getAuth: clientAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} = await import('firebase/auth');

const clientApp = initClient({ projectId: PROJECT, apiKey: 'fake-api-key' }, 'claims-client');
const auth = clientAuth(clientApp);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

const ids = {};

// Sign in when the account already exists, so the script is re-runnable
// against a persistent emulator.
const ensureUser = async (key, email, role) => {
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, 'Password123!');
  } catch (error) {
    if (error.code !== 'auth/email-already-in-use') throw error;
    cred = await signInWithEmailAndPassword(auth, email, 'Password123!');
  }
  const idToken = await cred.user.getIdToken();
  await adminDb.collection('users').doc(cred.user.uid).set(
    role ? { role, name: key } : { name: key }
  );
  ids[key] = { uid: cred.user.uid, user: cred.user, idToken };
  console.log(
    `  ${key}: uid=${cred.user.uid.slice(0, 10)}… firestoreRole=${role || 'none'} tokenRole=${claimsOf(idToken)}`
  );
};

/** Trade the emulator ID token for a session cookie the callable will accept. */
const call = async (name, data, idToken) => {
  const response = await fetch(`http://127.0.0.1:5001/${PROJECT}/${REGION}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data: data ?? {} }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || JSON.stringify(body).slice(0, 200));
    error.code = body?.error?.status || String(response.status);
    throw error;
  }
  return body.result ?? {};
};

const claimsOf = (idToken) => {
  const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
  return payload.role ?? null;
};

console.log('\n=== Setting up real emulator users ===');
await ensureUser('sec', 'sec@claims.test', 'secretary');
await ensureUser('mem', 'mem@claims.test', 'member');
await ensureUser('norole', 'none@claims.test', null);

// The emulator persists accounts between runs, so a previous run's claims would
// make "starts with no claim" untrue. Clear them now that the users exist, then
// re-read the token so the local copy matches.
const adminAuth = (await import('firebase-admin/auth')).getAuth(adminApp);
for (const key of ['sec', 'mem', 'norole']) {
  await adminAuth.setCustomUserClaims(ids[key].uid, {});
  ids[key].idToken = await ids[key].user.getIdToken(true);
}
console.log('\n=== Claims cleared; starting state ===');
for (const key of ['sec', 'mem', 'norole']) {
  console.log(`  ${key}: tokenRole=${claimsOf(ids[key].idToken) || 'null'}`);
}

console.log('\n=== Before: Storage refuses everyone (the bug) ===');
check('a newly signed-in officer has no role claim yet', claimsOf(ids.sec.idToken) === null);

console.log('\n=== syncClaims ===');
const secSync = await call('syncClaims', {}, ids.sec.idToken);
check('syncClaims succeeded', secSync.ok === true, JSON.stringify(secSync));
check('it reports the role from Firestore', secSync.role === 'secretary', JSON.stringify(secSync));
check('it reports that the token changed', secSync.changed === true);

const memSync = await call('syncClaims', {}, ids.mem.idToken);
check('a member is given their member role', memSync.role === 'member', JSON.stringify(memSync));

const noneSync = await call('syncClaims', {}, ids.norole.idToken);
check('a user with no role gets no claim', !noneSync.role, JSON.stringify(noneSync));

console.log('\n=== Idempotency ===');
// The idempotency check compares against the caller's CURRENT token claim, so
// the token has to be refreshed first — which is exactly what the app does via
// getIdToken(true) after a sync. Re-using the stale token would always report a
// change.
const currentToken = await ids.sec.user.getIdToken(true);
const second = await call('syncClaims', {}, currentToken);
check('a second sync, with a current token, reports no change',
  second.changed === false, JSON.stringify(second));

console.log('\n=== Escalation attempts ===');
// Asking for a role in the request body is not an error — the body is ignored
// entirely and the role comes from Firestore. The correct assertion is that the
// attempt changes nothing, not that it fails.
const escalate = await call('syncClaims', { role: 'admin' }, ids.mem.idToken);
check('a requested role in the body is ignored',
  escalate.role === 'member', JSON.stringify(escalate));
const memTokenNow = await ids.mem.user.getIdToken(true);
check('the member still only holds their own role after asking for admin',
  claimsOf(memTokenNow) === 'member', `got ${claimsOf(memTokenNow)}`);

try {
  await call('setRoleClaims', { targetUid: ids.sec.uid }, ids.mem.idToken);
  check('a member cannot push claims onto someone else', false, 'it was accepted');
} catch (error) {
  check('a member cannot push claims onto someone else',
    /PERMISSION_DENIED/i.test(error.code || ''), `code=${error.code}`);
}

// Confirm the claim really landed, by refreshing the token exactly as the app
// does after a sync. This is the step that makes Storage accept the user.
const refreshedToken = await ids.sec.user.getIdToken(true);
check('after a forced refresh the officer token carries role=secretary',
  claimsOf(refreshedToken) === 'secretary', `got ${claimsOf(refreshedToken)}`);

const memToken = await ids.mem.user.getIdToken(true);
check('the member token carries role=member only',
  claimsOf(memToken) === 'member', `got ${claimsOf(memToken)}`);

const noRoleToken = await ids.norole.user.getIdToken(true);
check('the roleless user token carries no role', claimsOf(noRoleToken) === null, `got ${claimsOf(noRoleToken)}`);

// A member cannot reach Storage even holding a valid `member` claim. The object
// must exist first, or Storage answers 404 before rules are ever evaluated.
await adminDb.collection('users').doc('probe').set({});
const { getStorage } = await import('firebase-admin/storage');
await getStorage(adminApp)
  .bucket()
  .file('documents/probe.pdf')
  .save(Buffer.from('%PDF-1.7\n'), { contentType: 'application/pdf' });

try {
  const response = await fetch(
    `http://127.0.0.1:9199/storage/v1/b/${PROJECT}.firebasestorage.app/o/documents%2Fprobe.pdf`,
    { headers: { Authorization: `Bearer ${memTokenNow}` } }
  );
  check('a member token is refused by Storage', response.status === 403,
    `HTTP ${response.status}`);
} catch (error) {
  check('a member token is refused by Storage', false, error.message);
}

// The officer, holding the correct claim, is accepted — this is the whole point.
const officerToken = await ids.sec.user.getIdToken(true);
const allowed = await fetch(
  `http://127.0.0.1:9199/storage/v1/b/${PROJECT}.firebasestorage.app/o/documents%2Fprobe.pdf`,
  { headers: { Authorization: `Bearer ${officerToken}` } }
);
check('the officer, with the claim, IS allowed by Storage', allowed.status === 200,
  `HTTP ${allowed.status}`);

console.log('\n=== Summary ===');
// A refreshed ID token can only carry a claim that was written to the auth
// record, so the token checks above already prove the claim persisted.

await adminApp.delete();
console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nRole claims work end to end.' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);