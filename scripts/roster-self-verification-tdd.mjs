/**
 * Live Firestore Rules TDD Suite:
 * Blocks Class Roster Self-Verification Bypass & Protects Death Aid Invariants
 *
 * Seam Under Test:
 *   firestore.rules — match /classRosters/{rosterId} & match /deathAidCollections/{collectionId}
 *   evaluated by the real Google Cloud Firestore Rules Engine via @firebase/rules-unit-testing.
 *
 * Run:
 *   node scripts/roster-self-verification-tdd.mjs
 */
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { EMULATOR_PROJECT } from './emulator-project.mjs';

const isPortOpen = (host, port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(400);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });

const ensureFirestoreEmulator = async () => {
  const envHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (envHost) {
    const [h, p] = envHost.split(':');
    return { host: h, port: Number(p), stop: async () => {} };
  }
  if (await isPortOpen('127.0.0.1', 8080)) {
    return { host: '127.0.0.1', port: 8080, stop: async () => {} };
  }

  const cacheDir = join(homedir(), '.cache', 'firebase', 'emulators');
  const jar = existsSync(cacheDir)
    ? readdirSync(cacheDir)
        .filter((f) => /^cloud-firestore-emulator-.*\.jar$/.test(f))
        .sort()
        .pop()
    : null;

  if (!jar) {
    throw new Error(`Firestore emulator JAR not found in ${cacheDir}. Start emulators first.`);
  }

  const port = await getFreePort();
  const proc = spawn('java', ['-jar', join(cacheDir, jar), '--host', '127.0.0.1', '--port', String(port)], {
    stdio: 'ignore',
    windowsHide: true,
  });

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (await isPortOpen('127.0.0.1', port)) {
      return {
        host: '127.0.0.1',
        port,
        stop: async () => {
          proc.kill();
        },
      };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error('Timed out waiting for local Firestore Emulator JAR to listen.');
};

const makeStudents = (n) =>
  Array.from({ length: n }, (_, i) => ({ name: `Student ${i + 1}`, section: 'BSIT - 3A' }));

const makePendingRoster = (mayorUid, count = 5, over = {}) => ({
  college: 'College of Technology and Engineering',
  program: 'BSIT',
  section: 'BSIT - 3A',
  sectionKey: 'bsit - 3a',
  yearLevel: 3,
  mayorName: 'Mayor Dela Cruz',
  mayorUid,
  status: 'pending',
  isCurrent: false,
  version: null,
  studentCount: count,
  students: makeStudents(count),
  submittedAt: new Date('2026-11-24T00:00:00Z'),
  verifiedAt: null,
  verifiedBy: null,
  ...over,
});

const makeCollection = (rosterId, recordedByUid, enrolledCount, paidCount, perStudent = 10) => ({
  rosterId,
  recordedByUid,
  enrolledCount,
  beneficiaryCount: paidCount,
  contributionPerStudent: perStudent,
  collectedAmount: paidCount * perStudent,
  expectedCollection: enrolledCount * perStudent,
  debtCount: enrolledCount - paidCount,
  debtAmount: (enrolledCount - paidCount) * perStudent,
  status: 'for_verification',
  submittedAt: new Date('2026-11-24T01:00:00Z'),
  debtRecords: [],
});

let failed = 0;
const results = [];

async function check(label, fn) {
  try {
    await fn();
    results.push(`ok   ${label}`);
  } catch (err) {
    failed += 1;
    results.push(`FAIL ${label} — ${err.message.split('\n')[0]}`);
  }
}

const emulator = await ensureFirestoreEmulator();

try {
  const testEnv = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT,
    firestore: {
      host: emulator.host,
      port: emulator.port,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('users').doc('member-mayor').set({ role: 'member', name: 'Mayor Member' });
    await db.collection('users').doc('other-member').set({ role: 'member', name: 'Other Member' });
    await db.collection('users').doc('guest-user').set({ role: 'guest', name: 'Guest' });
    await db.collection('users').doc('sec-1').set({ role: 'secretary', name: 'Secretary' });
  });

  const MEMBER_CLAIMS = {
    'member-mayor': { email: 'mayor@ctu.edu.ph', email_verified: true },
    'other-member': { email: 'other@ctu.edu.ph', email_verified: true },
  };
  const as = (uid) => testEnv.authenticatedContext(uid, MEMBER_CLAIMS[uid]).firestore();

  console.log('=== 1. End-to-end exploit: Member cannot self-verify pending roster to forge Death Aid totals ===');
  await check('Member CAN create a valid pending roster proposal', () =>
    assertSucceeds(
      as('member-mayor').collection('classRosters').doc('exploit-roster').set(makePendingRoster('member-mayor', 30))
    )
  );

  await check('Member CANNOT self-verify pending roster with { status: verified, isCurrent: true, version: 1, studentCount: 1 }', () =>
    assertFails(
      as('member-mayor').collection('classRosters').doc('exploit-roster').update({
        status: 'verified',
        isCurrent: true,
        version: 1,
        studentCount: 1,
      })
    )
  );

  await check('Forged Death Aid collection against unverified exploit-roster (enrolledCount: 1) is REJECTED by hasValidCollectionTotals()', () =>
    assertFails(
      as('member-mayor').collection('deathAidCollections').doc('forged-col-1').set(
        makeCollection('exploit-roster', 'member-mayor', 1, 1, 10)
      )
    )
  );

  console.log('\n=== 2. Granular pending-roster update invariants for owner ===');
  await as('member-mayor').collection('classRosters').doc('pending-invariants-roster').set(makePendingRoster('member-mayor', 30));

  await check('Owner CANNOT flip pending roster status to verified alone', () =>
    assertFails(
      as('member-mayor').collection('classRosters').doc('pending-invariants-roster').update({ status: 'verified' })
    )
  );

  await check('Owner CANNOT set isCurrent: true on a pending roster', () =>
    assertFails(
      as('member-mayor').collection('classRosters').doc('pending-invariants-roster').update({ isCurrent: true })
    )
  );

  await check('Owner CANNOT assign a non-null version on a pending roster', () =>
    assertFails(
      as('member-mayor').collection('classRosters').doc('pending-invariants-roster').update({ version: 1 })
    )
  );

  await check('Owner CANNOT mismatch studentCount against students.length on a pending roster', () =>
    assertFails(
      as('member-mayor').collection('classRosters').doc('pending-invariants-roster').update({ studentCount: 1 })
    )
  );

  await check('Owner CANNOT reassign mayorUid on a pending roster', () =>
    assertFails(
      as('member-mayor').collection('classRosters').doc('pending-invariants-roster').update({ mayorUid: 'other-member' })
    )
  );

  await check('Owner CAN legitimately edit their pending roster when students and studentCount match and proposal fields remain unverified', () =>
    assertSucceeds(
      as('member-mayor').collection('classRosters').doc('pending-invariants-roster').update({
        students: makeStudents(28),
        studentCount: 28,
      })
    )
  );

  console.log('\n=== 3. Officer verification + Death Aid collection integrity + verified transfer amendments ===');
  await check('Secretary CAN verify the pending roster (28 students)', () =>
    assertSucceeds(
      as('sec-1').collection('classRosters').doc('pending-invariants-roster').update({
        status: 'verified',
        isCurrent: true,
        version: 1,
        verifiedAt: new Date('2026-11-24T00:30:00Z'),
        verifiedBy: 'Secretary',
      })
    )
  );

  await check('Member CANNOT file Death Aid collection with forged enrolledCount (1 != 28)', () =>
    assertFails(
      as('member-mayor').collection('deathAidCollections').doc('forged-col-2').set(
        makeCollection('pending-invariants-roster', 'member-mayor', 1, 1, 10)
      )
    )
  );

  await check('Member CAN file valid Death Aid collection matching officer-verified studentCount (28)', () =>
    assertSucceeds(
      as('member-mayor').collection('deathAidCollections').doc('valid-col-1').set(
        makeCollection('pending-invariants-roster', 'member-mayor', 28, 25, 10)
      )
    )
  );

  await check('Owner CANNOT amend a verified roster without resetting isCurrent: false and version: null', () =>
    assertFails(
      as('member-mayor').collection('classRosters').doc('pending-invariants-roster').update({
        status: 'pending',
        students: makeStudents(27),
        studentCount: 27,
        hasTransfers: true,
        transferCount: 1,
        transferReason: '1 student transferred out',
      })
    )
  );

  await check('Owner CANNOT amend a verified roster with mismatched studentCount', () =>
    assertFails(
      as('member-mayor').collection('classRosters').doc('pending-invariants-roster').update({
        status: 'pending',
        isCurrent: false,
        version: null,
        students: makeStudents(27),
        studentCount: 1,
        hasTransfers: true,
        transferCount: 1,
        transferReason: '1 student transferred out',
      })
    )
  );

  await check('Owner CAN amend a verified roster with valid transfer payload (status: pending, isCurrent: false, version: null, matching studentCount)', () =>
    assertSucceeds(
      as('member-mayor').collection('classRosters').doc('pending-invariants-roster').update({
        status: 'pending',
        isCurrent: false,
        version: null,
        verifiedAt: null,
        verifiedBy: null,
        students: makeStudents(27),
        studentCount: 27,
        hasTransfers: true,
        transferCount: 1,
        transferReason: '1 student transferred out to BSIT - 3B',
      })
    )
  );

  await testEnv.cleanup();
} finally {
  await emulator.stop();
}

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\n✅ All checks passed.');
  process.exit(0);
}
