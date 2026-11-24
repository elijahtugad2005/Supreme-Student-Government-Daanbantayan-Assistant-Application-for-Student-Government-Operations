/**
 * Security Hardening TDD & Bug-Diagnosis Regression Suite
 *
 * Verifies three critical findings end-to-end:
 *   1. Deactivated users (`isActive: false`) lose access across Firestore Rules,
 *      Express Backend (`verifyIdToken(..., true)` + Firestore check),
 *      Cloud Functions (`requireRole`, `syncClaims`, `setRoleClaims`, `onUserRoleUpdated`),
 *      and Frontend Auth (`AuthContext`, `ProtectedRoute`, `Login`, `GoogleSignInButton`).
 *   2. CalendarWidget UI RBAC fails closed via `canManageCalendarEvents` (no `!currentUser.role`
 *      or `member` bypass, no `'officer'` fallback stamp, mutation handlers guarded).
 *   3. Destructive top-level IIFE script `src/utils/deleteAllOrders.js` is removed and
 *      no destructive `deleteDoc` + `process.exit()` script exists inside `src/`.
 *
 * Run:
 *   npm run test:security-hardening
 */
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { EMULATOR_PROJECT } from './emulator-project.mjs';
import * as permissionsModule from '../src/utils/permissions.js';

const require = createRequire(import.meta.url);

let failed = 0;
const results = [];

const check = async (label, fnOrBool, detail = '') => {
  try {
    const res = typeof fnOrBool === 'function' ? await fnOrBool() : fnOrBool;
    if (res === false) {
      failed += 1;
      results.push(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    } else {
      results.push(`ok   ${label}`);
    }
  } catch (err) {
    failed += 1;
    results.push(`FAIL ${label} — ${err.message.split('\n')[0]}`);
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Firestore Emulator Helper (local cached JAR on ephemeral port)
// ────────────────────────────────────────────────────────────────────────────
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

// ════════════════════════════════════════════════════════════════════════════
// SLICE 1: Live Firestore Rules Emulator — Deactivated Users (`isActive: false`)
// ════════════════════════════════════════════════════════════════════════════
console.log('=== Slice 1: Live Firestore Rules Emulator — Deactivated Users ===');

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
    await db.collection('users').doc('deactivated-admin').set({
      role: 'admin',
      name: 'Former Admin',
      isActive: false,
      permissionOverrides: {
        canManageAnnouncements: true,
        canEditFinance: true,
        canViewRosters: true,
        canExportData: true,
        canManageOrders: true,
      },
    });
    await db.collection('users').doc('deactivated-mayor').set({
      role: 'member',
      name: 'Former Mayor',
      isActive: false,
    });
    await db.collection('users').doc('active-admin').set({
      role: 'admin',
      name: 'Active Admin',
      isActive: true,
    });
    // Legacy document with NO isActive field — must stay active!
    await db.collection('users').doc('legacy-secretary').set({
      role: 'secretary',
      name: 'Legacy Secretary',
    });
    await db.collection('users').doc('active-member').set({
      role: 'member',
      name: 'Active Student',
      isActive: true,
    });
    // Worst-case evaluation paths: role at the end of allowlists + override-only member
    await db.collection('users').doc('active-rep').set({
      role: 'representative',
      name: 'Active Representative',
      isActive: true,
    });
    await db.collection('users').doc('override-member').set({
      role: 'member',
      name: 'Override Student',
      isActive: true,
      permissionOverrides: {
        canCreateAnnouncements: true,
        canManageOrders: true,
      },
    });

    await db.collection('calendarEvents').doc('ev-1').set({ eventName: 'Assembly', eventDate: '2026-12-01' });
    await db.collection('announcements').doc('ann-1').set({ title: 'Notice' });
    await db.collection('documents').doc('doc-1').set({ title: 'Resolution 1' });
    await db.collection('fundAccounts').doc('IGF').set({ balanceCentavos: 100000 });
    await db.collection('transactions').doc('tx-1').set({ status: 'draft', amountCentavos: 5000 });
    await db.collection('budgets').doc('b-1').set({ total: 400000 });
    await db.collection('funds').doc('f-1').set({ balance: 50000 });
    await db.collection('borrowingLogs').doc('log-1').set({ item: 'Projector' });
    await db.collection('settings').doc('commerceOrderSheet').set({ sheetId: 'abc' });
    await db.collection('preOrderBatches').doc('batch-1').set({ title: 'Uniform' });
    await db.collection('lockers').doc('l-1').set({ code: 'A1' });
    await db.collection('igpCollections').doc('igp-1').set({ amount: 250 });
    await db.collection('classRosters').doc('roster-mayor').set({
      college: 'COT',
      program: 'BSIT',
      section: 'BSIT-3A',
      sectionKey: 'cot::bsit::bsit-3a',
      students: [{ name: 'Student 1' }],
      studentCount: 1,
      status: 'pending',
      isCurrent: false,
      version: null,
      mayorUid: 'deactivated-mayor',
      submittedAt: '2026-11-24T00:00:00.000Z',
    });
    await db.collection('deathAidCollections').doc('col-1').set({
      section: 'BSIT-3A',
      collectedAmount: 1000,
    });
  });

  const asUser = (uid) => testEnv.authenticatedContext(uid).firestore();

  // Deactivated user CAN read their own user doc so AuthContext detects isActive: false
  await check('Deactivated admin CAN read own users/{uid} doc for forced sign-out detection', () =>
    assertSucceeds(asUser('deactivated-admin').collection('users').doc('deactivated-admin').get())
  );

  // Deactivated admin CANNOT perform any privileged or self-mutation actions
  await check('Deactivated admin CANNOT read other users/{uid} documents', () =>
    assertFails(asUser('deactivated-admin').collection('users').doc('active-member').get())
  );
  await check('Deactivated admin CANNOT update own users/{uid} profile (even benign fields)', () =>
    assertFails(asUser('deactivated-admin').collection('users').doc('deactivated-admin').update({ name: 'Sneaky' }))
  );
  await check('Deactivated admin CANNOT write to calendarEvents', () =>
    assertFails(asUser('deactivated-admin').collection('calendarEvents').doc('ev-evil').set({ eventName: 'Hacked' }))
  );
  await check('Deactivated admin CANNOT write to announcements', () =>
    assertFails(asUser('deactivated-admin').collection('announcements').doc('ann-evil').set({ title: 'Fake' }))
  );
  await check('Deactivated admin CANNOT read or write documents', async () => {
    await assertFails(asUser('deactivated-admin').collection('documents').doc('doc-1').get());
    await assertFails(asUser('deactivated-admin').collection('documents').doc('doc-evil').set({ title: 'Fake' }));
  });
  await check('Deactivated admin CANNOT read or write fundAccounts / transactions', async () => {
    await assertFails(asUser('deactivated-admin').collection('fundAccounts').doc('IGF').get());
    await assertFails(asUser('deactivated-admin').collection('fundAccounts').doc('IGF').update({ balanceCentavos: 0 }));
    await assertFails(asUser('deactivated-admin').collection('transactions').doc('tx-1').get());
  });
  await check('Deactivated admin CANNOT read budgets, funds, borrowingLogs, settings, preOrderBatches, lockers, igpCollections', async () => {
    await assertFails(asUser('deactivated-admin').collection('budgets').doc('b-1').get());
    await assertFails(asUser('deactivated-admin').collection('funds').doc('f-1').get());
    await assertFails(asUser('deactivated-admin').collection('borrowingLogs').doc('log-1').get());
    await assertFails(asUser('deactivated-admin').collection('settings').doc('commerceOrderSheet').get());
    await assertFails(asUser('deactivated-admin').collection('preOrderBatches').doc('batch-1').get());
    await assertFails(asUser('deactivated-admin').collection('lockers').doc('l-1').get());
    await assertFails(asUser('deactivated-admin').collection('igpCollections').doc('igp-1').get());
  });
  await check('Deactivated admin CANNOT read deathAidCollections or append audit_logs', async () => {
    await assertFails(asUser('deactivated-admin').collection('deathAidCollections').doc('col-1').get());
    await assertFails(asUser('deactivated-admin').collection('audit_logs').doc('a-evil').set({ action: 'spoof' }));
  });
  await check('Deactivated admin CANNOT update or delete orders or create authenticated orders', async () => {
    await assertFails(asUser('deactivated-admin').collection('orders').doc('ord-evil').set({ orderStatus: 'Pending' }));
    await assertFails(asUser('deactivated-admin').collection('orders').doc('ord-evil').delete());
  });

  // Deactivated mayor CANNOT read or delete their own roster or create a new roster
  await check('Deactivated mayor CANNOT read or delete own classRosters doc', async () => {
    await assertFails(asUser('deactivated-mayor').collection('classRosters').doc('roster-mayor').get());
    await assertFails(asUser('deactivated-mayor').collection('classRosters').doc('roster-mayor').delete());
  });
  await check('Deactivated mayor CANNOT submit a new classRosters proposal', () =>
    assertFails(
      asUser('deactivated-mayor').collection('classRosters').doc('roster-new').set({
        college: 'COT',
        program: 'BSIT',
        section: 'BSIT-3B',
        sectionKey: 'cot::bsit::bsit-3b',
        students: [{ name: 'Student A' }],
        studentCount: 1,
        status: 'pending',
        isCurrent: false,
        version: null,
        mayorUid: 'deactivated-mayor',
        submittedAt: '2026-11-24T00:00:00.000Z',
      })
    )
  );

  // Regression: Active admin & legacy secretary (no `isActive` field) retain full access
  await check('Active admin (isActive: true) retains full Firestore access', async () => {
    await assertSucceeds(asUser('active-admin').collection('users').doc('active-member').get());
    await assertSucceeds(asUser('active-admin').collection('calendarEvents').doc('ev-ok').set({ eventName: 'OK' }));
    await assertSucceeds(asUser('active-admin').collection('fundAccounts').doc('IGF').get());
  });
  await check('Legacy secretary (omitting isActive field) retains full officer access', async () => {
    await assertSucceeds(asUser('legacy-secretary').collection('documents').doc('doc-1').get());
    await assertSucceeds(asUser('legacy-secretary').collection('calendarEvents').doc('ev-sec').set({ eventName: 'Sec Event' }));
    await assertSucceeds(asUser('legacy-secretary').collection('classRosters').doc('roster-mayor').get());
    await assertSucceeds(asUser('legacy-secretary').collection('budgets').doc('b-1').get());
  });
  await check('Active representative & override-granted member pass complex rules well under Firestore 1000-expression cap', async () => {
    await assertSucceeds(asUser('active-rep').collection('calendarEvents').doc('ev-rep').set({ eventName: 'Rep Event' }));
    await assertSucceeds(asUser('active-rep').collection('announcements').doc('ann-rep').set({ title: 'Rep Notice' }));
    await assertSucceeds(asUser('active-rep').collection('orders').doc('ord-rep').set({ orderStatus: 'Approved' }));
    await assertSucceeds(asUser('override-member').collection('calendarEvents').doc('ev-ov').set({ eventName: 'Override Event' }));
    await assertSucceeds(asUser('override-member').collection('fundAccounts').doc('IGF').update({ balanceCentavos: 100500 }));
  });

  await testEnv.cleanup();
} finally {
  await emulator.stop();
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 2: Express Backend Auth Middleware (`firebase-admin.js` & `auth.js`)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 2: Express Backend Auth Middleware (checkRevoked + Firestore isActive) ===');

const fbAdminSource = readFileSync(new URL('../backend/services/firebase-admin.js', import.meta.url), 'utf8');
await check(
  'backend/services/firebase-admin.js defaults verifyIdToken(idToken, checkRevoked = true) and passes checkRevoked',
  /async function verifyIdToken\(\s*idToken\s*,\s*checkRevoked\s*=\s*true\s*\)/.test(fbAdminSource) &&
    /admin\.auth\(\)\.verifyIdToken\(\s*idToken\s*,\s*checkRevoked\s*\)/.test(fbAdminSource),
  'verifyIdToken does not pass checkRevoked = true to admin.auth().verifyIdToken'
);

// Stub backend/services/firebase-admin.js in require.cache to test real backend/middleware/auth.js
const backendMock = {
  verifyCalls: [],
  tokens: new Map(),
  tokenErrors: new Map(),
  users: new Map(),
};

const fbAdminResolved = require.resolve('../backend/services/firebase-admin.js');
delete require.cache[fbAdminResolved];
const authMwResolved = require.resolve('../backend/middleware/auth.js');
delete require.cache[authMwResolved];

require.cache[fbAdminResolved] = {
  id: fbAdminResolved,
  filename: fbAdminResolved,
  loaded: true,
  exports: {
    initializeFirebaseAdmin: () => ({}),
    getFirebaseAdmin: () => ({}),
    verifyIdToken: async (token, checkRevoked) => {
      backendMock.verifyCalls.push({ token, checkRevoked });
      if (backendMock.tokenErrors.has(token)) {
        const errInfo = backendMock.tokenErrors.get(token);
        const err = new Error(errInfo.message);
        err.code = errInfo.code;
        throw err;
      }
      const decoded = backendMock.tokens.get(token);
      if (!decoded) {
        const err = new Error('Invalid token');
        err.code = 'auth/argument-error';
        throw err;
      }
      return decoded;
    },
    getFirestore: () => ({
      collection(name) {
        if (name !== 'users') throw new Error(`Unexpected collection ${name}`);
        return {
          doc(uid) {
            return {
              async get() {
                const data = backendMock.users.get(uid);
                return { exists: Boolean(data), data: () => data };
              },
            };
          },
        };
      },
    }),
    getStorageBucket: () => ({}),
  },
};

const authMw = require('../backend/middleware/auth.js');

const runChain = async (middlewares, req) => {
  let statusCode = 200;
  let body = null;
  let reachedEnd = false;
  const res = {
    status(c) {
      statusCode = c;
      return this;
    },
    json(b) {
      body = b;
      return this;
    },
  };
  let idx = 0;
  const next = async (err) => {
    if (err) {
      statusCode = 500;
      body = { error: err.message };
      return;
    }
    const fn = middlewares[idx++];
    if (fn) await fn(req, res, next);
    else reachedEnd = true;
  };
  await next();
  return { statusCode, body, reachedEnd, user: req.user };
};

backendMock.tokens.set('tok-deactivated-admin', { uid: 'u-deact', email: 'former@ctu.edu.ph', role: 'admin' });
backendMock.users.set('u-deact', { role: 'admin', name: 'Former Admin', isActive: false });

backendMock.tokens.set('tok-active-admin', { uid: 'u-act', email: 'active@ctu.edu.ph', role: 'admin' });
backendMock.users.set('u-act', { role: 'admin', name: 'Active Admin', isActive: true });

backendMock.tokens.set('tok-legacy-sec', { uid: 'u-leg', email: 'legacy@ctu.edu.ph', role: 'secretary' });
backendMock.users.set('u-leg', { role: 'secretary', name: 'Legacy Sec' });

backendMock.tokenErrors.set('tok-revoked', { code: 'auth/id-token-revoked', message: 'ID token has been revoked.' });
backendMock.tokenErrors.set('tok-disabled', { code: 'auth/user-disabled', message: 'The user record is disabled.' });

backendMock.verifyCalls = [];
const activeRes = await runChain(
  [authMw.authenticate, authMw.requireRole('admin')],
  { headers: { authorization: 'Bearer tok-active-admin' }, query: {} }
);
await check(
  'authenticate calls verifyIdToken with checkRevoked === true and allows active admin',
  activeRes.reachedEnd === true &&
    backendMock.verifyCalls.length === 1 &&
    backendMock.verifyCalls[0].checkRevoked === true,
  `reachedEnd=${activeRes.reachedEnd}, verifyCalls=${JSON.stringify(backendMock.verifyCalls)}`
);

const revokedRes = await runChain(
  [authMw.authenticate],
  { headers: { authorization: 'Bearer tok-revoked' }, query: {} }
);
await check(
  'authenticate returns 401 on auth/id-token-revoked with revoked message',
  revokedRes.statusCode === 401 &&
    revokedRes.reachedEnd === false &&
    /revoked|deactivated/i.test(JSON.stringify(revokedRes.body)),
  `status=${revokedRes.statusCode}, body=${JSON.stringify(revokedRes.body)}`
);

const disabledRes = await runChain(
  [authMw.authenticate],
  { headers: { authorization: 'Bearer tok-disabled' }, query: {} }
);
await check(
  'authenticate returns 401 on auth/user-disabled with disabled/deactivated message',
  disabledRes.statusCode === 401 &&
    disabledRes.reachedEnd === false &&
    /disabled|deactivated/i.test(JSON.stringify(disabledRes.body)),
  `status=${disabledRes.statusCode}, body=${JSON.stringify(disabledRes.body)}`
);

const deactivatedRes = await runChain(
  [authMw.authenticate, authMw.requireRole('admin')],
  { headers: { authorization: 'Bearer tok-deactivated-admin' }, query: {} }
);
await check(
  'authenticate rejects user whose Firestore users/{uid}.isActive === false with 403 (even with admin JWT claim)',
  deactivatedRes.statusCode === 403 &&
    deactivatedRes.reachedEnd === false &&
    /deactivated/i.test(JSON.stringify(deactivatedRes.body)),
  `status=${deactivatedRes.statusCode}, reachedEnd=${deactivatedRes.reachedEnd}`
);

backendMock.verifyCalls = [];
const optDeactRes = await runChain(
  [authMw.optionalAuthenticate],
  { headers: { authorization: 'Bearer tok-deactivated-admin' }, query: {} }
);
await check(
  'optionalAuthenticate passes checkRevoked === true and drops req.user to null when isActive === false',
  optDeactRes.reachedEnd === true &&
    optDeactRes.user === null &&
    backendMock.verifyCalls[0]?.checkRevoked === true,
  `user=${JSON.stringify(optDeactRes.user)}, verifyCalls=${JSON.stringify(backendMock.verifyCalls)}`
);

const directRoleGuardRes = await runChain(
  [authMw.requireRole('admin')],
  { user: { uid: 'u-deact', role: 'admin' }, headers: {}, query: {} }
);
await check(
  'requireRole rejects deactivated user with 403 even if req.user already has role=admin',
  directRoleGuardRes.statusCode === 403 && directRoleGuardRes.reachedEnd === false,
  `status=${directRoleGuardRes.statusCode}, reachedEnd=${directRoleGuardRes.reachedEnd}`
);

const legacyRes = await runChain(
  [authMw.authenticate, authMw.requireRole('secretary')],
  { headers: { authorization: 'Bearer tok-legacy-sec' }, query: {} }
);
await check(
  'authenticate & requireRole allow legacy user doc omitting isActive field',
  legacyRes.reachedEnd === true && legacyRes.user?.role === 'secretary',
  `status=${legacyRes.statusCode}, role=${legacyRes.user?.role}`
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 3: Cloud Functions & Frontend Auth Deactivation Contracts
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 3: Cloud Functions & Frontend Auth Deactivation Contracts ===');

const fnIndexSrc = readFileSync(new URL('../functions/src/index.js', import.meta.url), 'utf8');
const authCtxSrc = readFileSync(new URL('../src/components/AuthContext/AuthContext.jsx', import.meta.url), 'utf8');
const protectedRouteSrc = readFileSync(new URL('../src/components/ProtectedRoute/ProtectedRoute.jsx', import.meta.url), 'utf8');
const loginSrc = readFileSync(new URL('../src/components/Login/Login.jsx', import.meta.url), 'utf8');
const googleBtnSrc = readFileSync(new URL('../src/components/Login/GoogleSignInButton.jsx', import.meta.url), 'utf8');

await check(
  'permissions.js exports isProfileActive(userData) treating explicit false as inactive and missing/true as active',
  typeof permissionsModule.isProfileActive === 'function' &&
    permissionsModule.isProfileActive({ isActive: false }) === false &&
    permissionsModule.isProfileActive({ isActive: true }) === true &&
    permissionsModule.isProfileActive({}) === true &&
    permissionsModule.isProfileActive(null) === true,
  `typeof=${typeof permissionsModule.isProfileActive}`
);

await check(
  'functions/src/index.js requireRole verifies Firestore isActive !== false before accepting cached token claims',
  /const requireRole = async[\s\S]*?isActive\s*===\s*false|isUserDocActive/.test(fnIndexSrc) &&
    /const requireRole = async[\s\S]*?collection\('users'\)\.doc\(uid\)\.get\(\)[\s\S]*?!isUserDocActive/.test(fnIndexSrc),
  'requireRole does not check Firestore active status before honoring token claims'
);

await check(
  'functions/src/index.js syncClaims & setRoleClaims strip claims and revoke tokens for deactivated users',
  /export const syncClaims[\s\S]*?!isUserDocActive[\s\S]*?setRoleClaim\(uid,\s*null\)[\s\S]*?revokeRefreshTokens\(uid\)/.test(fnIndexSrc) &&
    /export const setRoleClaims[\s\S]*?!isUserDocActive[\s\S]*?setRoleClaim\(targetUid,\s*null\)[\s\S]*?revokeRefreshTokens\(targetUid\)/.test(fnIndexSrc),
  'syncClaims or setRoleClaims does not revoke deactivated users'
);

await check(
  'functions/src/index.js onUserRoleUpdated handles isActive transitions (strips claim, revokes refresh tokens, toggles Auth disabled)',
  /export const onUserRoleUpdated[\s\S]*?wasActive[\s\S]*?isNowActive[\s\S]*?revokeRefreshTokens[\s\S]*?updateUser\(userId,\s*\{\s*disabled:\s*true\s*\}\)[\s\S]*?updateUser\(userId,\s*\{\s*disabled:\s*false\s*\}\)/.test(fnIndexSrc),
  'onUserRoleUpdated does not handle isActive transitions with revokeRefreshTokens & updateUser({ disabled })'
);

await check(
  'AuthContext.jsx enforces isProfileActive in login, syncGoogleUserProfile, and live onSnapshot listener with forced signOut',
  authCtxSrc.includes('onSnapshot') &&
    authCtxSrc.includes('isProfileActive') &&
    authCtxSrc.includes('isAccountActive') &&
    authCtxSrc.includes('authError') &&
    /const login = async[\s\S]*?!isProfileActive\([\s\S]*?signOut\(auth\)/.test(authCtxSrc) &&
    /const syncGoogleUserProfile = async[\s\S]*?!isProfileActive\([\s\S]*?signOut\(auth\)/.test(authCtxSrc) &&
    /onSnapshot\([\s\S]*?!isProfileActive\([\s\S]*?signOut\(auth\)/.test(authCtxSrc),
  'AuthContext.jsx missing live onSnapshot or deactivation enforcement in login/Google/listener'
);

await check(
  'ProtectedRoute.jsx destructures isAccountActive and blocks access when isAccountActive === false',
  protectedRouteSrc.includes('isAccountActive') &&
    /isAccountActive\s*===\s*false/.test(protectedRouteSrc),
  'ProtectedRoute.jsx does not enforce isAccountActive === false'
);

await check(
  'Login.jsx & GoogleSignInButton.jsx surface authError and deactivated-account messages cleanly',
  loginSrc.includes('authError') &&
    googleBtnSrc.includes('auth/user-disabled') &&
    googleBtnSrc.includes('auth/account-deactivated'),
  'Login.jsx or GoogleSignInButton.jsx missing authError / deactivated error mapping'
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 4: CalendarWidget UI RBAC Bypass (`permissions.js` & `CalendarWidget.jsx`)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 4: CalendarWidget UI RBAC Bypass ===');

const { canManageCalendarEvents, CALENDAR_MANAGER_ROLES } = permissionsModule;

await check(
  'permissions.js exports CALENDAR_MANAGER_ROLES and canManageCalendarEvents',
  Array.isArray(CALENDAR_MANAGER_ROLES) && typeof canManageCalendarEvents === 'function',
  `CALENDAR_MANAGER_ROLES=${typeof CALENDAR_MANAGER_ROLES}, canManageCalendarEvents=${typeof canManageCalendarEvents}`
);

if (typeof canManageCalendarEvents === 'function') {
  await check(
    'canManageCalendarEvents fails closed for unauthenticated / null user',
    canManageCalendarEvents(null, { readOnly: false }) === false &&
      canManageCalendarEvents(undefined, { readOnly: false }) === false
  );
  await check(
    'canManageCalendarEvents fails closed for Firebase User object with NO .role (fixes !currentUser.role bypass)',
    canManageCalendarEvents({ uid: 'fb-1', email: 'student@ctu.edu.ph' }, { readOnly: false }) === false
  );
  await check(
    'canManageCalendarEvents denies member and guest roles even when readOnly is false',
    canManageCalendarEvents({ uid: 'm-1', role: 'member', isActive: true }, { readOnly: false }) === false &&
      canManageCalendarEvents({ uid: 'g-1', role: 'guest', isActive: true }, { readOnly: false }) === false
  );
  await check(
    'canManageCalendarEvents denies deactivated admin (isActive: false)',
    canManageCalendarEvents({ uid: 'a-dead', role: 'admin', isActive: false }, { readOnly: false }) === false
  );
  await check(
    'canManageCalendarEvents denies active admin when readOnly is true',
    canManageCalendarEvents({ uid: 'a-1', role: 'admin', isActive: true }, { readOnly: true }) === false
  );
  await check(
    'canManageCalendarEvents allows authorized calendar/announcement roles (admin, secretary, creatives, press_secretary, governor, senator, representative)',
    ['admin', 'president', 'vice_president', 'secretary', 'press_secretary', 'creatives', 'governor', 'senator', 'representative'].every(
      (role) => canManageCalendarEvents({ uid: `u-${role}`, role, isActive: true }, { readOnly: false }) === true
    )
  );
  await check(
    'canManageCalendarEvents excludes finance_secretary without override (aligned with firestore.rules canManageAnnouncements)',
    canManageCalendarEvents({ uid: 'fin-1', role: 'finance_secretary', isActive: true }, { readOnly: false }) === false
  );
  await check(
    'canManageCalendarEvents honors explicit per-user override (e.g. canManageAnnouncements / canSendNotifications)',
    canManageCalendarEvents(
      { uid: 'm-2', role: 'member', isActive: true, permissionOverrides: { canManageAnnouncements: true } },
      { readOnly: false }
    ) === true &&
      canManageCalendarEvents(
        { uid: 'fin-2', role: 'finance_secretary', isActive: true, permissionOverrides: { canSendNotifications: true } },
        { readOnly: false }
      ) === true
  );
} else {
  await check('canManageCalendarEvents behavioral tests skipped until exported', false, 'function not exported yet');
}

const calSrc = readFileSync(new URL('../src/components/CalendarWidget/CalendarWidget.jsx', import.meta.url), 'utf8');
await check(
  'CalendarWidget.jsx destructures userRole/userName/userPermissionOverrides/isAccountActive from useAuth() and uses canManageCalendarEvents',
  /const\s*\{[^}]*currentUser[^}]*userRole[^}]*userName[^}]*userPermissionOverrides[^}]*isAccountActive[^}]*\}\s*=\s*useAuth\(\)/.test(calSrc) &&
    calSrc.includes('canManageCalendarEvents('),
  'CalendarWidget.jsx does not destructure auth role/profile fields or call canManageCalendarEvents'
);
await check(
  'CalendarWidget.jsx removes !currentUser.role bypass, member allowance, and hardcoded "officer" fallback',
  !calSrc.includes('!currentUser.role') &&
    !calSrc.includes("userRole === 'member'") &&
    !calSrc.includes("role: userRole || 'officer'"),
  'Vulnerable RBAC bypass or officer fallback still present in CalendarWidget.jsx'
);
await check(
  'CalendarWidget.jsx guards all 6 mutation handlers with !canManageEvents checks',
  [
    'handleSaveQuickEvent',
    'handleDeleteQuickEvent',
    'handleBatchEdit',
    'handleBatchDelete',
    'handleSaveEdit',
    'handleDeleteEvent',
  ].every((fnName) => {
    const rx = new RegExp(`const\\s+${fnName}\\s*=[\\s\\S]{0,180}!canManageEvents`);
    return rx.test(calSrc);
  }),
  'One or more mutation handlers in CalendarWidget.jsx lack a !canManageEvents guard'
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 5: Destructive Top-Level Script Guardrail (`src/utils/deleteAllOrders.js`)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 5: Destructive Top-Level IIFE Script Guardrail ===');

await check(
  'src/utils/deleteAllOrders.js does NOT exist in repository',
  !existsSync('src/utils/deleteAllOrders.js'),
  'src/utils/deleteAllOrders.js is still present!'
);

const walkFiles = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkFiles(full));
    else if (/\.(js|jsx|mjs|cjs|ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
};

const dangerousSrcFiles = walkFiles('src').filter((filePath) => {
  const content = readFileSync(filePath, 'utf8');
  return content.includes('deleteDoc(') && content.includes('process.exit(');
});

await check(
  'No file inside src/ combines Firestore deleteDoc() with process.exit() (blocks destructive CLI scripts in browser bundle)',
  dangerousSrcFiles.length === 0,
  `Found dangerous file(s): ${dangerousSrcFiles.join(', ')}`
);

// ════════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);

if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log(`\n✅ All ${results.length} security hardening checks passed.`);
  process.exit(0);
}
