/**
 * Live TDD Suite: Death Aid & Class Rosters Runtime + RBAC Hardening
 *
 * Seams Under Test:
 *   1. src/services/deathAidService.js — recordSectionCollection(), listVerifiedRosters({ mayorUid }),
 *      getActivePendingForRoster(rosterId, caseId, { recordedByUid }) executed against a real local
 *      Firestore Emulator (no mocked service internals).
 *   2. firestore.rules — evaluated by the real Google Cloud Firestore Rules Engine via
 *      @firebase/rules-unit-testing:
 *        - Guarded `'email' in request.auth.token` & `email_verified` (no CEL undefined-property crash)
 *        - Aligned `canReadRostersData()` for all roster-view & Death Aid manager roles
 *        - Verified @ctu.edu.ph member scoped queries on classRosters & deathAidCollections
 *   3. src/components/DeathAid.jsx & src/components/SectionsAndContributions/SectionsAndContributions.jsx —
 *      component query scoping for non-manager / non-roster-reader roles.
 *
 * Run:
 *   node scripts/death-aid-rosters-rbac-tdd.mjs
 */
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { build } from 'esbuild';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { EMULATOR_PROJECT } from './emulator-project.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

let failed = 0;
const results = [];

async function check(label, fn) {
  try {
    const res = await fn();
    if (res === false) {
      failed += 1;
      results.push(`FAIL ${label}`);
      return;
    }
    results.push(`ok   ${label}`);
  } catch (err) {
    failed += 1;
    results.push(`FAIL ${label} — ${String(err?.message || err).split('\n')[0]}`);
  }
}

const isPortOpen = (host, port) =>
  new Promise((resolvePort) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(400);
    socket.on('connect', () => {
      socket.destroy();
      resolvePort(true);
    });
    socket.on('error', () => resolvePort(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolvePort(false);
    });
  });

const getFreePort = () =>
  new Promise((resolvePort, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
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

/**
 * Bundle src/services/deathAidService.js with a virtual firebaseConfig pointing at the
 * local Firestore Emulator so we exercise the real service code end-to-end.
 */
async function loadDeathAidServiceAgainstEmulator(host, port) {
  const outDir = join(ROOT, 'node_modules', '.tmp');
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, 'deathAidService-tdd.mjs');

  const virtualFirebaseConfig = {
    name: 'virtual-firebase-config',
    setup(b) {
      b.onResolve({ filter: /firebaseConfig(\.js)?$/ }, () => ({
        path: 'virtual:firebase-config',
        namespace: 'virtual-fb',
      }));
      b.onLoad({ filter: /.*/, namespace: 'virtual-fb' }, () => ({
        contents: `
          import { initializeApp, getApps } from 'firebase/app';
          import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
          const app = getApps().find((a) => a.name === 'tdd-death-aid')
            || initializeApp({ projectId: ${JSON.stringify(EMULATOR_PROJECT)}, apiKey: 'demo-key' }, 'tdd-death-aid');
          const db = getFirestore(app);
          connectFirestoreEmulator(db, ${JSON.stringify(host)}, ${Number(port)});
          export { db };
        `,
        loader: 'js',
        resolveDir: ROOT,
      }));
    },
  };

  await build({
    entryPoints: [join(ROOT, 'src', 'services', 'deathAidService.js')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    external: ['firebase/app', 'firebase/firestore', 'firebase/auth', 'firebase/storage'],
    plugins: [virtualFirebaseConfig],
    logLevel: 'warning',
  });

  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

const makeVerifiedRoster = (id, mayorUid, section = 'BSIT - 3A', count = 10) => ({
  rosterId: id,
  college: 'College of Technology and Engineering',
  program: 'BSIT',
  section,
  sectionKey: section.toLowerCase(),
  yearLevel: 3,
  mayorName: `Mayor ${mayorUid}`,
  mayorUid,
  status: 'verified',
  isCurrent: true,
  version: 1,
  studentCount: count,
  students: Array.from({ length: count }, (_, i) => ({ name: `Student ${i + 1}`, section })),
  submittedAt: new Date('2026-11-24T00:00:00Z'),
  verifiedAt: new Date('2026-11-24T00:10:00Z'),
  verifiedBy: 'sec-1',
});

const makeCollection = (id, rosterId, recordedByUid, status = 'for_verification', extra = {}) => ({
  collectionId: id,
  rosterId,
  recordedByUid,
  section: 'BSIT - 3A',
  sectionKey: 'bsit - 3a',
  enrolledCount: 10,
  beneficiaryCount: 8,
  contributionPerStudent: 10,
  collectedAmount: 80,
  expectedCollection: 100,
  debtCount: 2,
  debtAmount: 20,
  status,
  submittedAt: new Date('2026-11-24T01:00:00Z'),
  debtRecords: [],
  ...extra,
});

const emulator = await ensureFirestoreEmulator();

try {
  // ---------------------------------------------------------------------------
  // SLICE 1: Real deathAidService runtime behavior against local Firestore
  // (Uses permissive rules on the same emulator instance ONLY for Slice 1 so
  // we can execute the modular service directly without needing Auth emulator.)
  // ---------------------------------------------------------------------------
  console.log('=== Slice 1: deathAidService runtime (recordSectionCollection + scoped reads) ===');
  const openEnv = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT,
    firestore: {
      host: emulator.host,
      port: emulator.port,
      rules: `rules_version = '2'; service cloud.firestore { match /databases/{d}/documents { match /{document=**} { allow read, write: if true; } } }`,
    },
  });
  await openEnv.clearFirestore();

  await openEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('classRosters').doc('roster-a').set(makeVerifiedRoster('roster-a', 'mayor-a', 'BSIT - 3A', 10));
    await db.collection('classRosters').doc('roster-b').set(makeVerifiedRoster('roster-b', 'mayor-b', 'BSIT - 3B', 12));
    await db.collection('deathAidCollections').doc('DA-2026-0099').set(
      makeCollection('DA-2026-0099', 'roster-b', 'mayor-b', 'for_verification')
    );
  });

  const svc = await loadDeathAidServiceAgainstEmulator(emulator.host, emulator.port);

  await check('recordSectionCollection does NOT throw ReferenceError: isOfficer is not defined for verified member', async () => {
    const collectionId = await svc.recordSectionCollection({
      roster: makeVerifiedRoster('roster-a', 'mayor-a', 'BSIT - 3A', 10),
      contribution: 10,
      beneficiaries: 9,
      submittedByName: 'Mayor A',
      recorder: { uid: 'mayor-a', name: 'Mayor A', role: 'member' },
    });
    const saved = await svc.getCollection(collectionId);
    if (!collectionId || !saved || saved.collectedAmount !== 90) {
      throw new Error(`Unexpected recordSectionCollection result: id=${collectionId}, saved=${JSON.stringify(saved)}`);
    }
  });

  await check('recordSectionCollection succeeds for Death Aid officer without ReferenceError', async () => {
    const collectionId = await svc.recordSectionCollection({
      roster: makeVerifiedRoster('roster-b', 'mayor-b', 'BSIT - 3B', 12),
      contribution: 5,
      beneficiaries: 10,
      submittedByName: 'Officer One',
      recorder: { uid: 'off-1', name: 'Officer One', role: 'finance_secretary' },
      beneficiary: {
        beneficiaryId: 'case-1',
        studentName: 'Juan Dela Cruz',
        affectedPersonName: 'Pedro Dela Cruz',
        aidType: 'death_aid',
        status: 'open',
      },
    });
    const saved = await svc.getCollection(collectionId);
    if (!collectionId || !saved || saved.collectedAmount !== 50) {
      throw new Error(`Unexpected officer result: id=${collectionId}, saved=${JSON.stringify(saved)}`);
    }
  });

  await check('listVerifiedRosters({ mayorUid }) returns ONLY verified rosters owned by that mayor', async () => {
    const own = await svc.listVerifiedRosters({ mayorUid: 'mayor-a' });
    if (own.length !== 1 || own[0].rosterId !== 'roster-a') {
      throw new Error(`Expected only [roster-a], got [${own.map((r) => r.rosterId).join(', ')}]`);
    }
  });

  await check('listVerifiedRosters() without mayorUid returns all verified rosters for officers', async () => {
    const all = await svc.listVerifiedRosters();
    if (all.length !== 2) {
      throw new Error(`Expected 2 verified rosters, got ${all.length}`);
    }
  });

  await check('getActivePendingForRoster scopes by recordedByUid when provided', async () => {
    const notMine = await svc.getActivePendingForRoster('roster-b', null, { recordedByUid: 'mayor-a' });
    const mine = await svc.getActivePendingForRoster('roster-b', null, { recordedByUid: 'mayor-b' });
    if (notMine !== null || !mine || mine.id !== 'DA-2026-0099') {
      throw new Error(`Unexpected scoped pending check: notMine=${JSON.stringify(notMine)}, mine=${JSON.stringify(mine)}`);
    }
  });

  await openEnv.cleanup();

  // ---------------------------------------------------------------------------
  // SLICE 2: Live Firestore Security Rules (real firestore.rules)
  // ---------------------------------------------------------------------------
  console.log('\n=== Slice 2: Live firestore.rules — token email guard, roster readers, scoped member queries ===');
  const testEnv = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT,
    firestore: {
      host: emulator.host,
      port: emulator.port,
      rules: readFileSync(join(ROOT, 'firestore.rules'), 'utf8'),
    },
  });
  await testEnv.clearFirestore();

  const OFFICER_ROLES_EXPECTED_TO_READ_ROSTERS = [
    'admin',
    'president',
    'vice_president',
    'secretary',
    'executive_secretary',
    'press_secretary',
    'linkages_secretary',
    'deputy_secretary',
    'finance_secretary',
    'auditor',
    'budget_officer',
    'governor',
    'senator',
    'representative',
  ];

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const role of OFFICER_ROLES_EXPECTED_TO_READ_ROSTERS) {
      await db.collection('users').doc(`u-${role}`).set({ role, name: role, isActive: true });
    }
    await db.collection('users').doc('u-creatives').set({ role: 'creatives', name: 'Creatives', isActive: true });
    await db.collection('users').doc('u-guest').set({ role: 'guest', name: 'Guest', isActive: true });
    await db.collection('users').doc('u-member-verified').set({ role: 'member', name: 'Verified Mayor', isActive: true });
    await db.collection('users').doc('u-member-other').set({ role: 'member', name: 'Other Student', isActive: true });
    await db.collection('users').doc('u-member-unverified').set({ role: 'member', name: 'Unverified', isActive: true });
    await db.collection('users').doc('u-member-noemail').set({ role: 'member', name: 'NoEmailToken', isActive: true });

    await db.collection('classRosters').doc('r-mine').set(makeVerifiedRoster('r-mine', 'u-member-verified', 'BSIT - 3A', 10));
    await db.collection('classRosters').doc('r-other').set(makeVerifiedRoster('r-other', 'u-member-other', 'BSIT - 3B', 12));
    await db.collection('classSections').doc('bsit - 3a').set({
      sectionKey: 'bsit - 3a',
      section: 'BSIT - 3A',
      program: 'BSIT',
      status: 'verified',
      currentRosterId: 'r-mine',
    });
    await db.collection('deathAidCollections').doc('col-mine-confirmed').set(
      makeCollection('col-mine-confirmed', 'r-mine', 'u-member-verified', 'confirmed')
    );
    await db.collection('deathAidCollections').doc('col-mine-pending').set(
      makeCollection('col-mine-pending', 'r-mine', 'u-member-verified', 'for_verification')
    );
    await db.collection('deathAidCollections').doc('col-other-confirmed').set(
      makeCollection('col-other-confirmed', 'r-other', 'u-member-other', 'confirmed')
    );
  });

  const asOfficer = (role) => testEnv.authenticatedContext(`u-${role}`).firestore();
  const asVerifiedMember = () =>
    testEnv.authenticatedContext('u-member-verified', { email: 'mayor@ctu.edu.ph', email_verified: true }).firestore();
  const asUnverifiedMember = () =>
    testEnv.authenticatedContext('u-member-unverified', { email: 'unverified@ctu.edu.ph', email_verified: false }).firestore();
  const asNoEmailMember = () =>
    testEnv.authenticatedContext('u-member-noemail').firestore();

  await check('firestore.rules guards missing email claim without throwing Property email is undefined', async () => {
    let caught = null;
    try {
      await asNoEmailMember()
        .collection('deathAidCollections')
        .where('recordedByUid', '==', 'u-member-noemail')
        .get();
      throw new Error('Expected permission-denied');
    } catch (err) {
      caught = err;
    }
    const errText = `${caught?.code || ''} ${caught?.message || ''}`;
    if (errText.includes('Property email is undefined')) {
      throw new Error(`CEL runtime error leaked: ${errText}`);
    }
    if (caught?.code !== 'permission-denied' && !/PERMISSION_DENIED/i.test(errText)) {
      throw new Error(`Expected clean PERMISSION_DENIED, got: ${errText}`);
    }
  });

  for (const role of OFFICER_ROLES_EXPECTED_TO_READ_ROSTERS) {
    await check(`Officer role '${role}' CAN query verified classRosters and classSections`, async () => {
      await assertSucceeds(asOfficer(role).collection('classRosters').where('status', '==', 'verified').get());
      await assertSucceeds(asOfficer(role).collection('classSections').get());
    });
  }

  await check('Creatives & Guest CANNOT read classRosters or verified classSections', async () => {
    await assertFails(testEnv.authenticatedContext('u-creatives').firestore().collection('classRosters').where('status', '==', 'verified').get());
    await assertFails(testEnv.authenticatedContext('u-creatives').firestore().collection('classSections').get());
    await assertFails(testEnv.authenticatedContext('u-guest').firestore().collection('classRosters').where('status', '==', 'verified').get());
  });

  await check('Unverified @ctu.edu.ph member CANNOT read own classRosters or own deathAidCollections', async () => {
    await assertFails(
      asUnverifiedMember().collection('classRosters').where('status', '==', 'verified').where('mayorUid', '==', 'u-member-unverified').get()
    );
    await assertFails(
      asUnverifiedMember().collection('deathAidCollections').where('status', '==', 'confirmed').where('recordedByUid', '==', 'u-member-unverified').get()
    );
  });

  await check('Verified @ctu.edu.ph member CANNOT run unfiltered classRosters or confirmed deathAidCollections queries', async () => {
    await assertFails(asVerifiedMember().collection('classRosters').where('status', '==', 'verified').get());
    await assertFails(asVerifiedMember().collection('deathAidCollections').where('status', '==', 'confirmed').get());
  });

  await check('Verified @ctu.edu.ph member CAN query own verified classRosters (mayorUid == uid)', async () => {
    const snap = await assertSucceeds(
      asVerifiedMember()
        .collection('classRosters')
        .where('status', '==', 'verified')
        .where('mayorUid', '==', 'u-member-verified')
        .get()
    );
    if (snap.size !== 1 || snap.docs[0].id !== 'r-mine') {
      throw new Error(`Expected 1 own roster, got ${snap.size}`);
    }
  });

  await check('Verified @ctu.edu.ph member CAN query own confirmed & pending deathAidCollections (recordedByUid == uid)', async () => {
    const confirmed = await assertSucceeds(
      asVerifiedMember()
        .collection('deathAidCollections')
        .where('status', '==', 'confirmed')
        .where('recordedByUid', '==', 'u-member-verified')
        .get()
    );
    if (confirmed.size !== 1 || confirmed.docs[0].id !== 'col-mine-confirmed') {
      throw new Error(`Expected 1 own confirmed collection, got ${confirmed.size}`);
    }
    const pending = await assertSucceeds(
      asVerifiedMember()
        .collection('deathAidCollections')
        .where('rosterId', '==', 'r-mine')
        .where('status', '==', 'for_verification')
        .where('recordedByUid', '==', 'u-member-verified')
        .get()
    );
    if (pending.size !== 1 || pending.docs[0].id !== 'col-mine-pending') {
      throw new Error(`Expected 1 own pending collection, got ${pending.size}`);
    }
  });

  await testEnv.cleanup();

  // ---------------------------------------------------------------------------
  // SLICE 3: UI Component Query Scoping Contracts
  // ---------------------------------------------------------------------------
  console.log('\n=== Slice 3: Component query-scoping contracts (DeathAid.jsx & SectionsAndContributions.jsx) ===');
  const deathAidSrc = readFileSync(join(ROOT, 'src', 'components', 'DeathAid.jsx'), 'utf8');
  const sectionsSrc = readFileSync(join(ROOT, 'src', 'components', 'SectionsAndContributions', 'SectionsAndContributions.jsx'), 'utf8');

  await check('DeathAid.jsx RecordView scopes listVerifiedRosters by mayorUid for non-managers', async () => {
    return /listVerifiedRosters\(\s*isManager\s*\?\s*undefined\s*:\s*\{\s*mayorUid:\s*actor\.uid\s*\}\s*\)/.test(deathAidSrc)
      || (/listVerifiedRosters\(\{\s*mayorUid:\s*actor\.uid\s*\}\)/.test(deathAidSrc) && /isManager/.test(deathAidSrc));
  });

  await check('DeathAid.jsx RecordView scopes getActivePendingForRoster by recordedByUid for non-managers', async () => {
    const definesScope = /const\s+scopeOpts\s*=\s*isManager\s*\?\s*undefined\s*:\s*\{\s*recordedByUid:\s*actor\?\.uid\s*\}/.test(deathAidSrc);
    const passesScope = /getActivePendingForRoster\(\s*rosterId\s*,\s*checkBeneficiaryId\s*,\s*scopeOpts\s*\)/.test(deathAidSrc);
    return definesScope && passesScope;
  });

  await check('DeathAid.jsx StatusListView scopes listCollections by recordedByUid for non-managers', async () => {
    return /listCollections\(\{\s*status,\s*recordedByUid:\s*isManager\s*\?\s*undefined\s*:\s*actor\.uid,?\s*\}\)/s.test(deathAidSrc);
  });

  await check('SectionsAndContributions.jsx scopes classSections & deathAidCollections listeners by role/uid', async () => {
    const usesAuth = /useAuth/.test(sectionsSrc);
    const checksManager = /canManageDeathAid/.test(sectionsSrc);
    const scopesCollections = /where\(\s*['"]recordedByUid['"]\s*,\s*['"]==['"]\s*,\s*(?:uid|currentUser\.uid)\s*\)/.test(sectionsSrc);
    const scopesRosters = /where\(\s*['"]mayorUid['"]\s*,\s*['"]==['"]\s*,\s*(?:uid|currentUser\.uid)\s*\)/.test(sectionsSrc);
    return usesAuth && checksManager && scopesCollections && scopesRosters;
  });
} finally {
  await emulator.stop();
}

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\n✅ All Death Aid & Rosters RBAC TDD checks passed.');
  process.exit(0);
}
