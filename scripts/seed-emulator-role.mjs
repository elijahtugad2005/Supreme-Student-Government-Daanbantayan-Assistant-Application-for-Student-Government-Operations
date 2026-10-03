/**
 * scripts/seed-emulator-role.mjs
 *
 * Writes a user role into the Firestore the FUNCTIONS EMULATOR reads.
 *
 * WHY THIS IS NEEDED
 *   During local development the browser talks to the REAL Firebase project
 *   (auth is deliberately not emulated, so Google sign-in still works), but the
 *   function runs inside the emulator and therefore reads the EMULATOR's
 *   Firestore. That emulator Firestore is empty, so the function finds no role
 *   for a user who is plainly an admin in production, and refuses the call with
 *   "This action requires one of: admin, secretary, ...".
 *
 *   Seeding the emulator Firestore bridges that gap. Production is unaffected —
 *   this script talks only to the emulator, and refuses to run against a
 *   non-emulator host.
 *
 * USAGE
 *   npm run seed:role -- --uid <uid> --role admin
 *   npm run seed:role -- --list
 *
 *   Find your uid in the browser console: firebase.auth().currentUser.uid
 *   or Firebase console -> Authentication -> your account -> UID.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { EMULATOR_PROJECT } from './emulator-project.mjs';

/**
 * Default to the local emulator, then PROVE the emulator is actually there
 * before writing anything.
 *
 * The admin SDK talks to production unless FIRESTORE_EMULATOR_HOST is set, so
 * this guard is the only thing standing between a mistyped command and a fake
 * `admin` document in the live database. It therefore refuses on anything that
 * is not 127.0.0.1/localhost, rather than trusting the caller's environment.
 */
const LOCAL = '127.0.0.1:8080';
process.env.FIRESTORE_EMULATOR_HOST = LOCAL;
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const reachable = async () => {
  try {
    const response = await fetch(`http://${LOCAL}/`, { method: 'GET' });
    // Any HTTP answer means something is listening.
    return response.status > 0;
  } catch {
    return false;
  }
};

if (!(await reachable())) {
  console.error('Refusing to run: no Firestore emulator is listening on 127.0.0.1:8080.');
  console.error('Start it first:  npm run emulators');
  process.exit(1);
}

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const uid = value('uid');
const role = value('role', 'admin');

const VALID = ['admin', 'secretary', 'finance_secretary', 'governor', 'senator', 'representative', 'member', 'guest'];

if (!VALID.includes(role)) {
  console.error(`Unknown role "${role}". Valid: ${VALID.join(', ')}`);
  process.exit(1);
}

const app =
  getApps().find((a) => a.name === 'seed') ||
  initializeApp(
    { projectId: EMULATOR_PROJECT },
    'seed'
  );

const db = getFirestore(app);
const authHost = '127.0.0.1:9099';

const list = async () => {
  const snap = await db.collection('users').get();
  console.log(`\nUsers in the EMULATOR Firestore (${EMULATOR_PROJECT}):\n`);
  if (snap.empty) {
    console.log('  (none — seed yourself to use the AI locally)\n');
    return;
  }
  snap.docs.forEach((d) => {
    const r = d.data();
    console.log(`  ${d.id}  role=${r.role || '(none)'}  name=${r.name || '(none)'}`);
  });
  console.log('');
};

if (args.includes('--list') || !uid) {
  await list();
  if (!uid) {
    console.log('Seed yourself with:\n  npm run seed:role -- --uid <your-uid> --role admin\n');
  }
  process.exit(0);
}

await db.collection('users').doc(uid).set(
  { role, name: role, seededForEmulator: true, seededAt: new Date().toISOString() },
  { merge: true }
);

console.log(`\nSeeded ${EMULATOR_PROJECT} emulator Firestore:`);
console.log(`  users/${uid}  role=${role}\n`);

// Also set the claim on the emulator Auth user when that emulator is running,
// so the claim-first path in requireRole is exercised too.
try {
  await getAuth(app).setCustomUserClaims(uid, { role });
  console.log(`  auth emulator (${authHost}): custom claim role=${role} set`);
} catch {
  console.log(
    `  auth emulator not running (${authHost}) — skipped the custom claim.\n` +
      '  Not required: the function falls back to the Firestore role above.'
  );
}
console.log('\nReload the app. The document AI should now accept your role.\n');

await app.delete();