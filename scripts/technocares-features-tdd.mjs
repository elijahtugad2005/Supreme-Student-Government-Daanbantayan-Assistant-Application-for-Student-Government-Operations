/**
 * scripts/technocares-features-tdd.mjs
 *
 * Comprehensive TDD Suite for TechnoCares / Death Aid Enhancements:
 *  - Slice 1: Pure helper logic (placeholder section inputs, beneficiary release validation,
 *             per-beneficiary collection aggregation)
 *  - Slice 2: Live Firestore Security Rules via @firebase/rules-unit-testing:
 *      * Officer-only placeholder section creation & placeholder Death Aid recording
 *      * Member cannot forge placeholder sections or bypass verified-roster checks
 *      * Class Mayor can read placeholder sections to claim/update them (without reading other rosters)
 *      * Officer deny / revoke / remove roster verification (preserving verified students immutability)
 *      * Officer remove / deny verification on confirmed Death Aid collections + remittance revocation/re-verify
 *      * Mandatory photo evidence enforced server-side when releasing Death Aid to a beneficiary
 *  - Slice 3: UI Wiring Contracts in DeathAid.jsx, DeathAidBeneficiaries.jsx, and ClassUpload.jsx
 *
 * Run:
 *   node scripts/technocares-features-tdd.mjs
 */
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { EMULATOR_PROJECT } from './emulator-project.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let failed = 0;
const results = [];
const check = (label, ok, detail = '') => {
  if (ok) {
    results.push(`ok   ${label}`);
  } else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
  }
};

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
    return { host: h, port: Number(p), stop: async () => { } };
  }
  if (await isPortOpen('127.0.0.1', 8080)) {
    return { host: '127.0.0.1', port: 8080, stop: async () => { } };
  }

  const cacheDir = join(homedir(), '.cache', 'firebase', 'emulators');
  const jar = existsSync(cacheDir)
    ? readdirSync(cacheDir)
      .filter((f) => /^cloud-firestore-emulator-.*\.jar$/.test(f))
      .sort()
      .pop()
    : null;

  if (!jar) {
    throw new Error(`Firestore emulator JAR not found in ${cacheDir}.`);
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

async function runSlice1PureHelpers() {
  console.log('=== Slice 1: Pure TechnoCares Logic Helpers ===');
  let helpers = null;
  try {
    helpers = await import('../src/utils/deathAidHelpers.js');
  } catch (err) {
    check('src/utils/deathAidHelpers.js module exists', false, err.message);
    return;
  }

  check(
    'exports buildPlaceholderCollectionInput, buildBeneficiaryRelease, computeBeneficiaryCollectionSummary',
    typeof helpers.buildPlaceholderCollectionInput === 'function' &&
    typeof helpers.buildBeneficiaryRelease === 'function' &&
    typeof helpers.computeBeneficiaryCollectionSummary === 'function'
  );

  // 1A: Placeholder section input normalization & enrolledCount default
  const placeholder1 = helpers.buildPlaceholderCollectionInput({
    section: '  BSIT - 2C  ',
    contribution: 5,
    beneficiaries: 30,
  });
  check(
    'placeholder input normalizes sectionKey, infers COTE/BSIT/year 2, defaults enrolledCount=30 (debt=0)',
    placeholder1.section === 'BSIT - 2C' &&
    placeholder1.sectionKey === 'bsit - 2c' &&
    placeholder1.program === 'BSIT' &&
    placeholder1.yearLevel === 2 &&
    placeholder1.enrolledCount === 30 &&
    placeholder1.totals.collectedAmount === 150 &&
    placeholder1.totals.debtCount === 0,
    JSON.stringify(placeholder1)
  );

  // 1B: Placeholder with explicit estimated enrolled count > beneficiaries
  const placeholder2 = helpers.buildPlaceholderCollectionInput({
    section: 'BSED - MATH 3A',
    contribution: 10,
    beneficiaries: 25,
    estimatedEnrolled: 35,
  });
  check(
    'placeholder input respects estimatedEnrolled (35) and computes debt (10 owing, ₱100)',
    placeholder2.enrolledCount === 35 &&
    placeholder2.totals.collectedAmount === 250 &&
    placeholder2.totals.debtCount === 10 &&
    placeholder2.totals.debtAmount === 100,
    JSON.stringify(placeholder2)
  );

  // 1C: Rejects blank section name
  let rejectedBlank = false;
  try {
    helpers.buildPlaceholderCollectionInput({ section: '   ', contribution: 5, beneficiaries: 10 });
  } catch {
    rejectedBlank = true;
  }
  check('placeholder input rejects blank section name', rejectedBlank);

  // 1D: Beneficiary release validation MUST require photo evidence
  const openCase = {
    beneficiaryId: 'BEN-2026-0001',
    studentName: 'Juan Dela Cruz',
    affectedPersonName: 'Maria Dela Cruz',
    status: 'open',
  };
  const officer = { uid: 'off-1', name: 'Finance Sec', role: 'finance_secretary' };

  let rejectedNoPhoto = false;
  try {
    helpers.buildBeneficiaryRelease(
      openCase,
      { recipientName: 'Juan Dela Cruz', releasedAmount: 3500, releasePhotoDataUrl: '' },
      officer
    );
  } catch (err) {
    rejectedNoPhoto = /photo/i.test(err.message);
  }
  check('buildBeneficiaryRelease rejects release without photo evidence', rejectedNoPhoto);

  let rejectedBadPhoto = false;
  try {
    helpers.buildBeneficiaryRelease(
      openCase,
      { recipientName: 'Juan Dela Cruz', releasedAmount: 3500, releasePhotoDataUrl: 'not-a-photo' },
      officer
    );
  } catch {
    rejectedBadPhoto = true;
  }
  check('buildBeneficiaryRelease rejects invalid non-image photo string', rejectedBadPhoto);

  let rejectedNoRecipient = false;
  try {
    helpers.buildBeneficiaryRelease(
      openCase,
      { recipientName: '   ', releasedAmount: 3500, releasePhotoDataUrl: 'data:image/jpeg;base64,AAA' },
      officer
    );
  } catch {
    rejectedNoRecipient = true;
  }
  check('buildBeneficiaryRelease rejects empty recipient name', rejectedNoRecipient);

  const validRelease = helpers.buildBeneficiaryRelease(
    openCase,
    {
      recipientName: 'Juan Dela Cruz',
      recipientRelationship: 'Beneficiary Student',
      releasedAmount: 3500,
      releasePhotoDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      releaseNotes: 'Handed over at SSG Office',
      confirmedCount: 12,
    },
    officer
  );
  check(
    'buildBeneficiaryRelease returns valid released payload with photo evidence and officer metadata',
    validRelease.status === 'released' &&
    validRelease.recipientName === 'Juan Dela Cruz' &&
    validRelease.releasedAmount === 3500 &&
    validRelease.releasePhotoDataUrl.startsWith('data:image/') &&
    validRelease.releasedByUid === 'off-1' &&
    validRelease.releasedCollectionCount === 12,
    JSON.stringify(validRelease)
  );

  // 1E: Already released case cannot be released twice
  let rejectedAlreadyReleased = false;
  try {
    helpers.buildBeneficiaryRelease(
      { ...openCase, status: 'released' },
      {
        recipientName: 'Juan Dela Cruz',
        releasedAmount: 3500,
        releasePhotoDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
      },
      officer
    );
  } catch {
    rejectedAlreadyReleased = true;
  }
  check('buildBeneficiaryRelease rejects already-released beneficiary case', rejectedAlreadyReleased);

  // 1F: Collection summary aggregation per beneficiary case
  const summary = helpers.computeBeneficiaryCollectionSummary(
    [
      { beneficiaryCaseId: 'BEN-1', status: 'confirmed', collectedAmount: 500, amountReceived: 500, isPlaceholderSection: true },
      { beneficiaryCaseId: 'BEN-1', status: 'confirmed', collectedAmount: 300, amountReceived: 300 },
      { beneficiaryCaseId: 'BEN-1', status: 'for_verification', collectedAmount: 200 },
      { beneficiaryCaseId: 'BEN-1', status: 'denied', collectedAmount: 999 },
      { beneficiaryCaseId: 'BEN-2', status: 'confirmed', collectedAmount: 777, amountReceived: 777 },
    ],
    'BEN-1'
  );
  check(
    'computeBeneficiaryCollectionSummary sums confirmed (₱800, 2 sections), pending (₱200, 1), excludes denied & other cases',
    summary.confirmedAmount === 800 &&
    summary.confirmedCount === 2 &&
    summary.pendingAmount === 200 &&
    summary.pendingCount === 1 &&
    summary.placeholderSectionCount === 1,
    JSON.stringify(summary)
  );

  // 1G: Direct Amount Collected reverse-calculation & Multi-Beneficiary Auto-Split
  check(
    'exports computeFromCollectedAmount and splitCollectionAcrossBeneficiaries',
    typeof helpers.computeFromCollectedAmount === 'function' &&
    typeof helpers.splitCollectionAcrossBeneficiaries === 'function'
  );

  if (
    typeof helpers.computeFromCollectedAmount === 'function' &&
    typeof helpers.splitCollectionAcrossBeneficiaries === 'function'
  ) {
    // Exact division: ₱200 collected at ₱5/student on 40-student section -> 40 paid, ₱0 owing
    const exactRev = helpers.computeFromCollectedAmount({
      enrolledCount: 40,
      contribution: 5,
      collectedAmount: 200,
    });
    check(
      'computeFromCollectedAmount calculates 40 paid students from ₱200 at ₱5/student (0 debt)',
      exactRev.beneficiaryCount === 40 &&
      exactRev.collectedAmount === 200 &&
      exactRev.debtCount === 0 &&
      exactRev.debtAmount === 0,
      JSON.stringify(exactRev)
    );

    // Non-exact lump sum: ₱197 collected at ₱5/student on 40-student section -> exact ₱197 preserved, 39 full shares, ₱3 remaining
    const lumpRev = helpers.computeFromCollectedAmount({
      enrolledCount: 40,
      contribution: 5,
      collectedAmount: 197,
    });
    check(
      'computeFromCollectedAmount preserves exact cash (₱197) when not an exact multiple of ₱5/student',
      lumpRev.collectedAmount === 197 &&
      lumpRev.beneficiaryCount === 39 &&
      lumpRev.expectedCollection === 200 &&
      lumpRev.debtAmount === 3 &&
      lumpRev.hasExactAmountOverride === true,
      JSON.stringify(lumpRev)
    );

    // User exact example: 5 beneficiaries + ₱200 collected -> ₱40.00 per beneficiary (sum === ₱200.00)
    const fiveCases = [1, 2, 3, 4, 5].map((n) => ({
      beneficiaryId: `BEN-${n}`,
      studentName: `Student ${n}`,
      defaultContribution: 1,
    }));
    const split5 = helpers.splitCollectionAcrossBeneficiaries({
      totalCollectedAmount: 200,
      beneficiariesList: fiveCases,
      enrolledCount: 40,
      contributionPerBeneficiary: 1,
    });
    const sum5 = Math.round(split5.reduce((s, r) => s + r.totals.collectedAmount, 0) * 100) / 100;
    check(
      'splits ₱200 across 5 beneficiaries into ₱40.00 each (40 paying students per case, exact ₱200 total)',
      split5.length === 5 &&
      split5.every((r) => r.totals.collectedAmount === 40 && r.totals.beneficiaryCount === 40) &&
      sum5 === 200,
      JSON.stringify(split5.map((r) => ({ id: r.beneficiary.beneficiaryId, amt: r.totals.collectedAmount, paid: r.totals.beneficiaryCount })))
    );

    // Centavo-safe uneven split: ₱200 across 3 beneficiaries -> ₱66.67, ₱66.67, ₱66.66 (sum === ₱200.00)
    const threeCases = fiveCases.slice(0, 3);
    const split3 = helpers.splitCollectionAcrossBeneficiaries({
      totalCollectedAmount: 200,
      beneficiariesList: threeCases,
      enrolledCount: 40,
      contributionPerBeneficiary: 2,
    });
    const amts3 = split3.map((r) => r.totals.collectedAmount);
    const sum3 = Math.round(amts3.reduce((s, v) => s + v, 0) * 100) / 100;
    check(
      'splits ₱200 across 3 beneficiaries centavo-safely ([66.67, 66.67, 66.66], exact sum ₱200.00)',
      amts3[0] === 66.67 && amts3[1] === 66.67 && amts3[2] === 66.66 && sum3 === 200,
      JSON.stringify(amts3)
    );
  }
}

async function runSlice2FirestoreRules() {
  console.log('\n=== Slice 2: Live Firestore Security Rules Emulator Tests ===');
  const emu = await ensureFirestoreEmulator();
  const rules = readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8');

  const testEnv = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT,
    firestore: {
      host: emu.host,
      port: emu.port,
      rules,
    },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.collection('users').doc('officer-sec').set({ role: 'secretary', name: 'Secretary Ana' });
      await db.collection('users').doc('officer-fin').set({ role: 'finance_secretary', name: 'Finance Ben' });
      await db.collection('users').doc('mayor-1').set({ role: 'member', name: 'Mayor Carlo' });
      await db.collection('users').doc('member-2').set({ role: 'member', name: 'Student Dan' });

      // Open beneficiary case
      await db.collection('deathAidBeneficiaries').doc('BEN-2026-0001').set({
        beneficiaryId: 'BEN-2026-0001',
        aidType: 'death_aid',
        studentName: 'Juan Dela Cruz',
        affectedPersonName: 'Maria Dela Cruz',
        memoPhotoDataUrl: 'data:image/jpeg;base64,MEMO',
        status: 'open',
      });

      // Existing verified roster & pending roster
      await db.collection('classRosters').doc('roster-verified-1').set({
        college: 'College of Technology and Engineering',
        program: 'BSIT',
        section: 'BSIT - 3A',
        sectionKey: 'bsit - 3a',
        mayorUid: 'mayor-1',
        mayorName: 'Mayor Carlo',
        status: 'verified',
        isCurrent: true,
        version: 1,
        studentCount: 2,
        students: [
          { name: 'Alice', section: 'BSIT - 3A' },
          { name: 'Bob', section: 'BSIT - 3A' },
        ],
        submittedAt: new Date('2026-11-20T00:00:00Z'),
      });
      await db.collection('classRosters').doc('roster-pending-1').set({
        college: 'College of Technology and Engineering',
        program: 'BSIT',
        section: 'BSIT - 3B',
        sectionKey: 'bsit - 3b',
        mayorUid: 'mayor-1',
        mayorName: 'Mayor Carlo',
        status: 'pending',
        isCurrent: false,
        version: null,
        studentCount: 1,
        students: [{ name: 'Charlie', section: 'BSIT - 3B' }],
        submittedAt: new Date('2026-11-21T00:00:00Z'),
      });

      // Already-confirmed collection + remittance for revoke test
      await db.collection('deathAidCollections').doc('DA-2026-0050').set({
        collectionId: 'DA-2026-0050',
        rosterId: 'roster-verified-1',
        section: 'BSIT - 3A',
        sectionKey: 'bsit - 3a',
        beneficiaryCaseId: 'BEN-2026-0001',
        enrolledCount: 2,
        beneficiaryCount: 2,
        contributionPerStudent: 10,
        collectedAmount: 20,
        expectedCollection: 20,
        debtCount: 0,
        debtAmount: 0,
        debtRecords: [],
        recordedByUid: 'mayor-1',
        submittedAt: new Date('2026-11-22T00:00:00Z'),
        status: 'confirmed',
        amountReceived: 20,
        confirmedByUid: 'officer-sec',
      });
      await db.collection('deathAidRemittances').doc('DA-2026-0050').set({
        collectionId: 'DA-2026-0050',
        reportedAmount: 20,
        amountReceived: 20,
        difference: 0,
        status: 'confirmed',
        receivedByUid: 'officer-sec',
      });
    });

    const secDb = testEnv.authenticatedContext('officer-sec').firestore();
    const finDb = testEnv.authenticatedContext('officer-fin').firestore();
    const mayorDb = testEnv
      .authenticatedContext('mayor-1', { email: 'mayor1@ctu.edu.ph', email_verified: true })
      .firestore();
    const member2Db = testEnv
      .authenticatedContext('member-2', { email: 'member2@ctu.edu.ph', email_verified: true })
      .firestore();

    // 2A: Finance Secretary (canManageDeathAid) CAN create a placeholder classSection
    let finCreatedPlaceholder = false;
    try {
      await assertSucceeds(
        finDb.collection('classSections').doc('bsit - 2c').set({
          section: 'BSIT - 2C',
          sectionKey: 'bsit - 2c',
          college: 'College of Technology and Engineering',
          program: 'BSIT',
          yearLevel: 2,
          mayorName: 'Unclaimed — Needs Mayor Roster',
          status: 'placeholder',
          isPlaceholder: true,
          currentRosterId: null,
          createdFromDeathAid: true,
        })
      );
      finCreatedPlaceholder = true;
    } catch (err) {
      finCreatedPlaceholder = false;
      check('Finance officer CAN create placeholder section in classSections', false, err.message);
    }
    if (finCreatedPlaceholder) {
      check('Finance officer CAN create placeholder section in classSections', true);
    }

    // 2B: Regular member CANNOT create placeholder section in classSections
    let memberBlockedPlaceholderSection = false;
    try {
      await assertFails(
        mayorDb.collection('classSections').doc('bsit - 9z').set({
          section: 'BSIT - 9Z',
          sectionKey: 'bsit - 9z',
          status: 'placeholder',
          isPlaceholder: true,
          currentRosterId: null,
        })
      );
      memberBlockedPlaceholderSection = true;
    } catch (err) {
      check('Member is BLOCKED from creating placeholder classSections doc', false, err.message);
    }
    if (memberBlockedPlaceholderSection) {
      check('Member is BLOCKED from creating placeholder classSections doc', true);
    }

    // 2C: Class Mayor CAN read placeholder classSections so they can update/claim it
    let mayorCanReadPlaceholder = false;
    try {
      await assertSucceeds(mayorDb.collection('classSections').doc('bsit - 2c').get());
      mayorCanReadPlaceholder = true;
    } catch (err) {
      check('Class Mayor CAN read placeholder section in classSections', false, err.message);
    }
    if (mayorCanReadPlaceholder) {
      check('Class Mayor CAN read placeholder section in classSections', true);
    }

    // 2D: Non-owner member STILL cannot read another section's classRoster student list
    let member2BlockedRoster = false;
    try {
      await assertFails(member2Db.collection('classRosters').doc('roster-verified-1').get());
      member2BlockedRoster = true;
    } catch (err) {
      check('Non-owner member remains BLOCKED from reading another section roster', false, err.message);
    }
    if (member2BlockedRoster) {
      check('Non-owner member remains BLOCKED from reading another section roster', true);
    }

    // 2E: Officer CAN record Death Aid collection for placeholder section without existing roster
    const placeholderCol = {
      collectionId: 'DA-2026-0099',
      rosterId: null,
      isPlaceholderSection: true,
      section: 'BSIT - 2C',
      sectionKey: 'bsit - 2c',
      program: 'BSIT',
      college: 'College of Technology and Engineering',
      beneficiaryCaseId: 'BEN-2026-0001',
      enrolledCount: 30,
      beneficiaryCount: 30,
      contributionPerStudent: 5,
      collectedAmount: 150,
      expectedCollection: 150,
      debtCount: 0,
      debtAmount: 0,
      debtRecords: [],
      status: 'for_verification',
      recordedByUid: 'officer-fin',
      submittedAt: new Date('2026-11-24T00:00:00Z'),
    };
    let finRecordedPlaceholderCol = false;
    try {
      await assertSucceeds(finDb.collection('deathAidCollections').doc('DA-2026-0099').set(placeholderCol));
      finRecordedPlaceholderCol = true;
    } catch (err) {
      check('Officer CAN record placeholder Death Aid collection without roster', false, err.message);
    }
    if (finRecordedPlaceholderCol) {
      check('Officer CAN record placeholder Death Aid collection without roster', true);
    }

    // 2F: Regular member CANNOT forge a placeholder Death Aid collection
    let memberBlockedPlaceholderCol = false;
    try {
      await assertFails(
        mayorDb.collection('deathAidCollections').doc('DA-2026-0100').set({
          ...placeholderCol,
          collectionId: 'DA-2026-0100',
          recordedByUid: 'mayor-1',
        })
      );
      memberBlockedPlaceholderCol = true;
    } catch (err) {
      check('Member is BLOCKED from forging placeholder Death Aid collection', false, err.message);
    }
    if (memberBlockedPlaceholderCol) {
      check('Member is BLOCKED from forging placeholder Death Aid collection', true);
    }

    // 2G: Officer CAN revoke verification on a verified roster (without altering students) and delete pending roster
    let secRevokedRoster = false;
    try {
      await assertSucceeds(
        secDb.collection('classRosters').doc('roster-verified-1').update({
          status: 'revoked',
          isCurrent: false,
          revokedReason: 'Uploaded wrong term sheet',
        })
      );
      secRevokedRoster = true;
    } catch (err) {
      check('Officer CAN revoke verification on verified roster without altering students', false, err.message);
    }
    if (secRevokedRoster) {
      check('Officer CAN revoke verification on verified roster without altering students', true);
    }

    let secDeletedPending = false;
    try {
      await assertSucceeds(secDb.collection('classRosters').doc('roster-pending-1').delete());
      secDeletedPending = true;
    } catch (err) {
      check('Officer CAN remove unverified pending roster submission', false, err.message);
    }
    if (secDeletedPending) {
      check('Officer CAN remove unverified pending roster submission', true);
    }

    // 2H: Officer CAN revoke verification on confirmed Death Aid collection + mark remittance revoked
    let finRevokedRemittance = false;
    try {
      await assertSucceeds(
        finDb.collection('deathAidRemittances').doc('DA-2026-0050').update({
          status: 'revoked',
          revokedReason: 'Recount required',
          revokedByUid: 'officer-fin',
        })
      );
      await assertSucceeds(
        finDb.collection('deathAidCollections').doc('DA-2026-0050').update({
          status: 'for_verification',
          confirmedAt: null,
          confirmedByUid: null,
          confirmedByName: null,
          amountReceived: null,
          verificationRevokedReason: 'Recount required',
        })
      );
      finRevokedRemittance = true;
    } catch (err) {
      check('Officer CAN remove verification on confirmed collection & revoke remittance', false, err.message);
    }
    if (finRevokedRemittance) {
      check('Officer CAN remove verification on confirmed collection & revoke remittance', true);
    }

    // 2I: Releasing Death Aid WITHOUT photo evidence MUST BE REJECTED by firestore.rules
    let blockedReleaseNoPhoto = false;
    try {
      await assertFails(
        finDb.collection('deathAidBeneficiaries').doc('BEN-2026-0001').update({
          status: 'released',
          recipientName: 'Juan Dela Cruz',
          releasedAmount: 500,
          releasedByUid: 'officer-fin',
          releasePhotoDataUrl: '',
        })
      );
      blockedReleaseNoPhoto = true;
    } catch (err) {
      check('Firestore Rules BLOCK releasing Death Aid without photo evidence', false, err.message);
    }
    if (blockedReleaseNoPhoto) {
      check('Firestore Rules BLOCK releasing Death Aid without photo evidence', true);
    }

    // 2J: Releasing Death Aid WITH valid photo evidence SUCCEEDS
    let allowedReleaseWithPhoto = false;
    try {
      await assertSucceeds(
        finDb.collection('deathAidBeneficiaries').doc('BEN-2026-0001').update({
          status: 'released',
          recipientName: 'Juan Dela Cruz',
          recipientRelationship: 'Beneficiary Student',
          releasedAmount: 500,
          releasedByUid: 'officer-fin',
          releasePhotoDataUrl: 'data:image/jpeg;base64,HANDOVER_PHOTO_OK',
          releaseNotes: 'Handed over at SSG Office',
        })
      );
      allowedReleaseWithPhoto = true;
    } catch (err) {
      check('Firestore Rules ALLOW releasing Death Aid with valid photo evidence', false, err.message);
    }
    if (allowedReleaseWithPhoto) {
      check('Firestore Rules ALLOW releasing Death Aid with valid photo evidence', true);
    }

    // 2K: Officer CAN record direct-amount lump-sum collection (e.g. ₱66.67 split share) with entryMode='amount'
    //     while a regular Member CANNOT bypass exact beneficiaryCount * contributionPerStudent math
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection('deathAidBeneficiaries').doc('BEN-2026-0002').set({
        beneficiaryId: 'BEN-2026-0002',
        aidType: 'death_aid',
        studentName: 'Maria Santos',
        affectedPersonName: 'Pedro Santos',
        memoPhotoDataUrl: 'data:image/jpeg;base64,MEMO2',
        status: 'open',
      });
    });

    const directAmountDoc = {
      collectionId: 'DA-2026-0120',
      rosterId: null,
      isPlaceholderSection: true,
      entryMode: 'amount',
      section: 'BSIT - 2C',
      sectionKey: 'bsit - 2c',
      program: 'BSIT',
      college: 'College of Technology and Engineering',
      beneficiaryCaseId: 'BEN-2026-0002',
      enrolledCount: 40,
      beneficiaryCount: 33,
      contributionPerStudent: 2,
      collectedAmount: 66.67,
      expectedCollection: 80,
      debtCount: 7,
      debtAmount: 13.33,
      debtRecords: [],
      status: 'for_verification',
      recordedByUid: 'officer-fin',
      submittedAt: new Date('2026-11-24T00:00:00Z'),
    };
    let finRecordedDirectAmount = false;
    try {
      await assertSucceeds(
        finDb.collection('deathAidCollections').doc('DA-2026-0120').set(directAmountDoc)
      );
      finRecordedDirectAmount = true;
    } catch (err) {
      check('Officer CAN record direct-amount split collection (₱66.67) with entryMode="amount"', false, err.message);
    }
    if (finRecordedDirectAmount) {
      check('Officer CAN record direct-amount split collection (₱66.67) with entryMode="amount"', true);
    }

    let memberBlockedDirectAmount = false;
    try {
      await assertFails(
        mayorDb.collection('deathAidCollections').doc('DA-2026-0121').set({
          ...directAmountDoc,
          collectionId: 'DA-2026-0121',
          rosterId: 'roster-verified-1',
          isPlaceholderSection: false,
          enrolledCount: 2,
          beneficiaryCount: 1,
          collectedAmount: 1.5,
          expectedCollection: 4,
          debtCount: 1,
          debtAmount: 2.5,
          recordedByUid: 'mayor-1',
        })
      );
      memberBlockedDirectAmount = true;
    } catch (err) {
      check('Member is BLOCKED from using officer-only entryMode="amount" bypass', false, err.message);
    }
    if (memberBlockedDirectAmount) {
      check('Member is BLOCKED from using officer-only entryMode="amount" bypass', true);
    }
  } finally {
    await testEnv.cleanup();
    await emu.stop();
  }
}

function runSlice3UiContracts() {
  console.log('\n=== Slice 3: UI Wiring Contracts ===');
  const deathAidSrc = readFileSync(resolve(__dirname, '../src/components/DeathAid.jsx'), 'utf8');
  const beneficiariesSrc = readFileSync(
    resolve(__dirname, '../src/components/DeathAidBeneficiaries.jsx'),
    'utf8'
  );
  const classUploadSrc = readFileSync(resolve(__dirname, '../src/components/ClassUpload.jsx'), 'utf8');

  check(
    'DeathAid.jsx supports officer placeholder section mode, direct amount collected, multi-beneficiary auto-split, remove/deny verification, and createPortal modals',
    deathAidSrc.includes('usePlaceholderSection') &&
    deathAidSrc.includes('amountCollected') &&
    deathAidSrc.includes('selectedBeneficiaries') &&
    deathAidSrc.includes('splitCollectionAcrossBeneficiaries') &&
    deathAidSrc.includes('revokeCollectionVerification') &&
    deathAidSrc.includes('createPortal(')
  );

  check(
    'DeathAidBeneficiaries.jsx wires releaseBeneficiaryAid with mandatory photo evidence and createPortal lightbox/modal',
    beneficiariesSrc.includes('releaseBeneficiaryAid') &&
    beneficiariesSrc.includes('releasePhotoDataUrl') &&
    beneficiariesSrc.includes('createPortal(')
  );

  check(
    'ClassUpload.jsx displays placeholder sections for Mayors and wires denyRosterVerification, revokeRosterVerification, removeRosterOrPlaceholder',
    classUploadSrc.includes('listPlaceholderSections') &&
    classUploadSrc.includes('denyRosterVerification') &&
    classUploadSrc.includes('revokeRosterVerification') &&
    classUploadSrc.includes('removeRosterOrPlaceholder')
  );
}

await runSlice1PureHelpers();
await runSlice2FirestoreRules();
runSlice3UiContracts();

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\n✅ All checks passed.');
  process.exit(0);
}
