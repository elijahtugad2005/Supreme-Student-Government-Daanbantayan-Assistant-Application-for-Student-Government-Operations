/**
 * Validates firestore.rules against the Firestore emulator.
 *
 *   npx firebase emulators:start --only firestore --project <your-project-id>
 *   node scripts/rules-check.mjs
 *
 * Roles are read from the Firestore user document (not from token claims), which
 * is how AuthContext populates them, so each context is seeded with a user doc.
 */
import { EMULATOR_BUCKET, EMULATOR_PROJECT } from './emulator-project.mjs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { EMULATOR_BUCKET, EMULATOR_PROJECT } from './emulator-project.mjs';
import { readFileSync } from 'node:fs';

const HOST = '127.0.0.1';
const PORT = 8080;

let failed = 0;
const results = [];

async function check(label, assertion) {
  try {
    await assertion();
    results.push(`ok   ${label}`);
  } catch (error) {
    failed += 1;
    results.push(`FAIL ${label}\n     ${error.message.split('\n')[0]}`);
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: EMULATOR_PROJECT,
  firestore: {
    host: HOST,
    port: PORT,
    rules: readFileSync('firestore.rules', 'utf8'),
  },
});

const pendingRoster = (over = {}) => ({
  college: 'College of Technology and Engineering',
  program: 'BSIT',
  section: 'BSIT - 1A',
  sectionKey: 'bsit - 1a',
  yearLevel: 1,
  mayorName: 'No Mayor Assigned',
  status: 'pending',
  isCurrent: false,
  version: null,
  studentCount: 2,
  students: [{ name: 'Juan Dela Cruz' }, { name: 'Maria Santos' }],
  submittedAt: new Date('2026-01-01T00:00:00Z'),
  ...over,
});

const verifiedRoster = {
  ...pendingRoster({}),
  status: 'verified',
  isCurrent: true,
  version: 1,
  verifiedAt: new Date('2026-01-02T00:00:00Z'),
};

// The emulator persists between runs; start clean so counts are deterministic.
await testEnv.clearFirestore();

// Seed users and data with rules switched off.
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const users = {
    admin1: { role: 'admin', name: 'Admin' },
    secretary1: { role: 'secretary', name: 'Secretary' },
    governor1: { role: 'governor', name: 'Governor' },
    member1: { role: 'member', name: 'Member' },
    guest1: { role: 'guest', name: 'Guest' },
    granted1: {
      role: 'member',
      name: 'Promoted Member',
      permissionOverrides: { canViewRosters: true },
    },
  };
  for (const [id, data] of Object.entries(users)) {
    await db.collection('users').doc(id).set(data);
  }
  await db.collection('classRosters').doc('pending-1').set(pendingRoster());
  await db.collection('classRosters').doc('verified-1').set(verifiedRoster);
  await db.collection('classSections').doc('bsit - 1a').set({
    sectionKey: 'bsit - 1a',
    section: 'BSIT - 1A',
    program: 'BSIT',
    status: 'verified',
    currentRosterId: 'verified-1',
  });
});

const asUser = (uid) => testEnv.authenticatedContext(uid).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

console.log('=== 1. Anonymous Mayor: submit only ===');
await check('anonymous CAN submit a pending roster', () =>
  assertSucceeds(anon().collection('classRosters').add(pendingRoster({ section: 'BSED - 2A' })))
);
await check('anonymous CANNOT submit a self-verified roster', () =>
  assertFails(anon().collection('classRosters').add(pendingRoster({ status: 'verified', isCurrent: true, version: 1 })))
);
await check('anonymous CANNOT read student names', () =>
  assertFails(anon().collection('classRosters').doc('verified-1').get())
);
await check('anonymous CANNOT write the section registry', () =>
  assertFails(anon().collection('classSections').doc('bsit - 2a').set({ section: 'x' }))
);
await check('roster without a student list is rejected', () => {
  const bad = pendingRoster();
  delete bad.students;
  return assertFails(anon().collection('classRosters').add(bad));
});
await check('studentCount must match the list length', () =>
  assertFails(anon().collection('classRosters').add(pendingRoster({ studentCount: 99 })))
);

console.log('=== 2. Reading rosters is limited to Governor/Secretary/Admin ===');
await check('Member CANNOT read rosters', () =>
  assertFails(asUser('member1').collection('classRosters').get())
);
await check('Guest CANNOT read rosters', () =>
  assertFails(asUser('guest1').collection('classRosters').get())
);
await check('Governor CAN read rosters', () =>
  assertSucceeds(asUser('governor1').collection('classRosters').get())
);
await check('Secretary CAN read rosters', () =>
  assertSucceeds(asUser('secretary1').collection('classRosters').get())
);
await check('Admin CAN read rosters', () =>
  assertSucceeds(asUser('admin1').collection('classRosters').get())
);
await check('Governor CAN read the section registry', () =>
  assertSucceeds(asUser('governor1').collection('classSections').get())
);

console.log('=== 3. Per-user access override reaches the database ===');
await check('Member granted canViewRosters CAN read', () =>
  assertSucceeds(asUser('granted1').collection('classRosters').get())
);
await check('That grant does NOT allow verifying', () =>
  assertFails(
    asUser('granted1').collection('classRosters').doc('pending-1').update({
      status: 'verified',
      isCurrent: true,
      version: 2,
    })
  )
);

console.log('=== 4. Verification is officer-only, and verified lists are frozen ===');
await check('Governor CANNOT verify a roster', () =>
  assertFails(asUser('governor1').collection('classRosters').doc('pending-1').update({ status: 'verified', isCurrent: true, version: 2 }))
);
await check('Member CANNOT verify a roster', () =>
  assertFails(asUser('member1').collection('classRosters').doc('pending-1').update({ status: 'verified', isCurrent: true, version: 2 }))
);
await check('Secretary CAN verify a pending roster', () =>
  assertSucceeds(
    asUser('secretary1').collection('classRosters').doc('pending-1').update({
      status: 'verified',
      isCurrent: true,
      version: 2,
    })
  )
);
await check('Secretary CANNOT rewrite a verified roster student list', () =>
  assertFails(
    asUser('secretary1').collection('classRosters').doc('verified-1').update({
      students: [{ name: 'Someone Else' }],
      studentCount: 1,
    })
  )
);
await check('Secretary CAN retire a verified roster (student list unchanged)', () =>
  assertSucceeds(asUser('secretary1').collection('classRosters').doc('verified-1').update({ isCurrent: false }))
);
await check('Secretary CANNOT delete a roster', () =>
  assertFails(asUser('secretary1').collection('classRosters').doc('verified-1').delete())
);

console.log('=== 5. Privilege escalation is blocked ===');
await check('Member CANNOT promote themselves', () =>
  assertFails(asUser('member1').collection('users').doc('member1').update({ role: 'admin' }))
);
await check('Member CANNOT grant themselves permissions', () =>
  assertFails(
    asUser('member1').collection('users').doc('member1').update({
      permissionOverrides: { canManageUsers: true },
    })
  )
);
await check('Member CAN still edit their own profile fields', () =>
  assertSucceeds(asUser('member1').collection('users').doc('member1').update({ name: 'Renamed' }))
);
await check('Admin CAN grant an individual permission', () =>
  assertSucceeds(
    asUser('admin1').collection('users').doc('member1').update({
      permissionOverrides: { canManageRosters: true },
    })
  )
);
await check('Member CANNOT edit another user', () =>
  assertFails(asUser('member1').collection('users').doc('guest1').update({ name: 'Hacked' }))
);

console.log('=== 6. Registry writes stay with officers ===');
await check('Governor CANNOT write the section registry', () =>
  assertFails(asUser('governor1').collection('classSections').doc('bsit - 2a').set({ section: 'BSIT - 2A' }))
);
await check('Secretary CAN write the section registry', () =>
  assertSucceeds(
    asUser('secretary1').collection('classSections').doc('bsit - 2a').set({ section: 'BSIT - 2A', status: 'verified' })
  )
);

await testEnv.cleanup();

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nRules behave as designed.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);