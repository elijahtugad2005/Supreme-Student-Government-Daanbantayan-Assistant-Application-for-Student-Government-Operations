/**
 * Live Firestore Rules TDD & Bug-Diagnosis Suite:
 * Blocks isOfficer() Privilege Escalation on users/{userId}
 *
 * Automatically reuses a running Firestore Emulator on 127.0.0.1:8080 or boots
 * the cached cloud-firestore-emulator JAR on an ephemeral local port for a
 * fast, deterministic, zero-network feedback loop.
 *
 * Run:
 *   node scripts/users-privilege-escalation-tdd.mjs
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
import { ROLE_PERMISSIONS, hasPermission } from '../src/utils/permissions.js';

const NON_ADMIN_OFFICER_ROLES = [
  'vice_president',
  'secretary',
  'executive_secretary',
  'press_secretary',
  'linkages_secretary',
  'deputy_secretary',
];

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
    await db.collection('users').doc('admin-1').set({ role: 'admin', name: 'System Admin', isActive: true });
    await db.collection('users').doc('president-1').set({ role: 'president', name: 'SSG President', isActive: true });
    await db.collection('users').doc('member-1').set({ role: 'member', name: 'Student Member', isActive: true });

    for (const role of NON_ADMIN_OFFICER_ROLES) {
      await db.collection('users').doc(`officer-${role}`).set({
        role,
        name: `Officer (${role})`,
        isActive: true,
      });
    }
  });

  const asUser = (uid) => testEnv.authenticatedContext(uid).firestore();

  console.log('=== 1. Pre-condition: permissions.js sets canManageUsers: false for all 6 non-admin isOfficer() roles ===');
  for (const role of NON_ADMIN_OFFICER_ROLES) {
    await check(`${role} has canManageUsers: false in permissions.js`, async () => {
      if (hasPermission({ role, permissions: ROLE_PERMISSIONS[role].permissions }, 'canManageUsers') !== false) {
        throw new Error(`Expected ${role} to have canManageUsers: false`);
      }
    });
  }

  console.log('\n=== 2. Self-promotion & override injection blocked for all 6 non-admin isOfficer() roles ===');
  for (const role of NON_ADMIN_OFFICER_ROLES) {
    const uid = `officer-${role}`;

    await check(`${role} CANNOT self-promote own users/${uid} to role: 'admin'`, () =>
      assertFails(asUser(uid).collection('users').doc(uid).update({ role: 'admin' }))
    );

    await check(`${role} CANNOT self-promote own users/${uid} to role: 'president'`, () =>
      assertFails(asUser(uid).collection('users').doc(uid).update({ role: 'president' }))
    );

    await check(`${role} CANNOT inject permissionOverrides onto own users/${uid}`, () =>
      assertFails(
        asUser(uid).collection('users').doc(uid).update({
          permissionOverrides: { canManageUsers: true, canEditFinance: true },
        })
      )
    );

    await check(`${role} CANNOT inject custom permissions map onto own users/${uid}`, () =>
      assertFails(
        asUser(uid).collection('users').doc(uid).update({
          permissions: { canManageUsers: true },
        })
      )
    );
  }

  console.log('\n=== 3. Cross-user creation & modification blocked for all 6 non-admin isOfficer() roles ===');
  for (const role of NON_ADMIN_OFFICER_ROLES) {
    const uid = `officer-${role}`;

    await check(`${role} CANNOT create a new user account with role: 'admin'`, () =>
      assertFails(
        asUser(uid).collection('users').doc(`sockpuppet-${role}`).set({
          role: 'admin',
          name: 'Sockpuppet Admin',
        })
      )
    );

    await check(`${role} CANNOT update another user's role or profile`, () =>
      assertFails(asUser(uid).collection('users').doc('member-1').update({ role: 'admin' }))
    );
  }

  console.log('\n=== 4. Legitimate own-profile updates and Admin/President user management still succeed ===');
  for (const role of NON_ADMIN_OFFICER_ROLES) {
    const uid = `officer-${role}`;
    await check(`${role} CAN update benign profile fields (name, lastLoginAt) on own users/${uid}`, () =>
      assertSucceeds(
        asUser(uid).collection('users').doc(uid).update({
          name: `Updated ${role}`,
          lastLoginAt: '2026-11-24T03:00:00.000Z',
        })
      )
    );
  }

  await check('admin CAN promote/update another user role and permissionOverrides', () =>
    assertSucceeds(
      asUser('admin-1').collection('users').doc('member-1').update({
        role: 'senator',
        permissionOverrides: { canViewFinance: true },
      })
    )
  );

  await check('president CAN promote/update another user role and permissionOverrides', () =>
    assertSucceeds(
      asUser('president-1').collection('users').doc('member-1').update({
        role: 'member',
        permissionOverrides: {},
      })
    )
  );

  await check('admin CAN create a provisioned user document', () =>
    assertSucceeds(
      asUser('admin-1').collection('users').doc('provisioned-sec').set({
        role: 'secretary',
        name: 'Provisioned Secretary',
        isActive: true,
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
