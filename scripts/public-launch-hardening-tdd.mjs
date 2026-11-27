/**
 * Step-by-Step Public-Launch Hardening TDD Suite
 *
 * Covers the 7 remaining public-launch blockers in vertical slices:
 *   Slice 1: inventory/{docId} Firestore rules lock-down + InventoryProvider / FinanceProvider auth gates
 *
 * Run:
 *   node scripts/public-launch-hardening-tdd.mjs
 */
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { EMULATOR_PROJECT } from './emulator-project.mjs';

const require = createRequire(import.meta.url);

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
  throw new Error('Timed out waiting for local Firestore Emulator JAR.');
};

const emulator = await ensureFirestoreEmulator();

try {
  const testEnv = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT,
    firestore: {
      host: emulator.host,
      port: emulator.port,
      rules: readFileSync(join(ROOT, 'firestore.rules'), 'utf8'),
    },
  });
  await testEnv.clearFirestore();

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('users').doc('u-admin').set({ role: 'admin', name: 'Admin', isActive: true });
    await db.collection('users').doc('u-sec').set({ role: 'secretary', name: 'Secretary', isActive: true });
    await db.collection('users').doc('u-fin').set({ role: 'finance_secretary', name: 'Finance', isActive: true });
    await db.collection('users').doc('u-sen').set({ role: 'senator', name: 'Senator', isActive: true });
    await db.collection('users').doc('u-rep').set({ role: 'representative', name: 'Rep', isActive: true });
    await db.collection('users').doc('u-creatives').set({ role: 'creatives', name: 'Creatives', isActive: true });
    await db.collection('users').doc('u-guest').set({ role: 'guest', name: 'Guest', isActive: true });
    await db.collection('users').doc('u-member').set({ role: 'member', name: 'Student', isActive: true });
    await db.collection('users').doc('u-member-other').set({ role: 'member', name: 'Other Student', isActive: true });
    await db.collection('users').doc('u-inv-override').set({
      role: 'member',
      name: 'Delegated Inventory Staff',
      isActive: true,
      permissionOverrides: { canManageInventory: true },
    });
    await db.collection('users').doc('u-deactivated').set({ role: 'secretary', name: 'Inactive', isActive: false });

    await db.collection('classRosters').doc('r-member-own').set({
      rosterId: 'r-member-own',
      college: 'College of Technology and Engineering',
      program: 'BSIT',
      section: 'BSIT - 3A',
      sectionKey: 'bsit - 3a',
      mayorName: 'Student Mayor',
      mayorUid: 'u-member',
      status: 'verified',
      isCurrent: true,
      version: 1,
      studentCount: 10,
      students: Array.from({ length: 10 }, (_, i) => ({ name: `S${i + 1}`, section: 'BSIT - 3A' })),
      submittedAt: new Date('2026-11-24T00:00:00Z'),
    });

    await db.collection('inventory').doc('inv-1').set({
      name: 'Sound System Mixer',
      unitPrice: 12500,
      amount: 12500,
      storageLocation: 'SSG Office Vault',
      supplier: 'AudioPro Cebu',
      receiptDriveLink: 'https://drive.google.com/file/d/secret-receipt/view',
      receiptFileId: 'secret-receipt',
    });
  });

  // =========================================================================
  // SLICE 1: inventory/{docId} Firestore rules + Provider Access Gates
  // =========================================================================
  console.log('=== Slice 1: inventory/{docId} lock-down + InventoryProvider & FinanceProvider gates ===');

  await check('Unauthenticated visitor CANNOT read internal inventory (receipts/costs/locations)', () =>
    assertFails(testEnv.unauthenticatedContext().firestore().collection('inventory').doc('inv-1').get())
  );

  await check('Guest, verified @ctu.edu.ph Member, Creatives, and deactivated Officer CANNOT read inventory', async () => {
    await assertFails(testEnv.authenticatedContext('u-guest').firestore().collection('inventory').doc('inv-1').get());
    await assertFails(
      testEnv
        .authenticatedContext('u-member', { email: 'student@ctu.edu.ph', email_verified: true })
        .firestore()
        .collection('inventory')
        .doc('inv-1')
        .get()
    );
    await assertFails(testEnv.authenticatedContext('u-creatives').firestore().collection('inventory').doc('inv-1').get());
    await assertFails(testEnv.authenticatedContext('u-deactivated').firestore().collection('inventory').doc('inv-1').get());
  });

  await check('Authorized inventory/commerce/officer roles + canManageInventory override CAN read inventory', async () => {
    for (const uid of ['u-admin', 'u-sec', 'u-fin', 'u-sen', 'u-rep', 'u-inv-override']) {
      await assertSucceeds(testEnv.authenticatedContext(uid).firestore().collection('inventory').doc('inv-1').get());
    }
  });

  await check('providerAccessGates enforces Inventory & Finance provider read boundaries', async () => {
    const gatePath = join(ROOT, 'src', 'utils', 'providerAccessGates.js');
    if (!existsSync(gatePath)) {
      throw new Error('src/utils/providerAccessGates.js does not exist yet');
    }
    const { canFetchInventoryProvider, canFetchFinanceProvider } = await import(
      `${pathToFileURL(gatePath).href}?t=${Date.now()}`
    );

    if (canFetchInventoryProvider(null) !== false) throw new Error('Public visitor must not fetch inventory');
    if (canFetchInventoryProvider({ uid: '1', role: 'member', isActive: true }) !== false)
      throw new Error('Member must not fetch inventory');
    if (canFetchInventoryProvider({ uid: '2', role: 'guest', isActive: true }) !== false)
      throw new Error('Guest must not fetch inventory');
    if (canFetchInventoryProvider({ uid: '3', role: 'creatives', isActive: true }) !== false)
      throw new Error('Creatives must not fetch inventory');
    if (canFetchInventoryProvider({ uid: '4', role: 'secretary', isActive: false }) !== false)
      throw new Error('Deactivated officer must not fetch inventory');
    if (canFetchInventoryProvider({ uid: '5', role: 'secretary', isActive: true }) !== true)
      throw new Error('Secretary should fetch inventory');
    if (canFetchInventoryProvider({ uid: '6', role: 'representative', isActive: true }) !== true)
      throw new Error('Representative should fetch inventory');
    if (
      canFetchInventoryProvider({
        uid: '7',
        role: 'member',
        isActive: true,
        permissionOverrides: { canManageInventory: true },
      }) !== true
    ) {
      throw new Error('canManageInventory override should fetch inventory');
    }

    if (canFetchFinanceProvider(null) !== false) throw new Error('Public visitor must not fetch finance');
    if (canFetchFinanceProvider({ uid: '1', role: 'member', isActive: true }) !== false)
      throw new Error('Member must not fetch finance');
    if (canFetchFinanceProvider({ uid: '2', role: 'creatives', isActive: true }) !== false)
      throw new Error('Creatives must not fetch finance');
    if (canFetchFinanceProvider({ uid: '3', role: 'governor', isActive: true }) !== false)
      throw new Error('Governor must not fetch finance');
    if (canFetchFinanceProvider({ uid: '4', role: 'representative', isActive: true }) !== false)
      throw new Error('Representative must not fetch finance');
    if (canFetchFinanceProvider({ uid: '5', role: 'finance_secretary', isActive: false }) !== false)
      throw new Error('Deactivated finance officer must not fetch finance');
    if (canFetchFinanceProvider({ uid: '6', role: 'finance_secretary', isActive: true }) !== true)
      throw new Error('Finance Secretary should fetch finance');
    if (canFetchFinanceProvider({ uid: '7', role: 'secretary', isActive: true }) !== true)
      throw new Error('Secretary should fetch finance');
    if (
      canFetchFinanceProvider({
        uid: '8',
        role: 'governor',
        isActive: true,
        permissionOverrides: { canViewFinance: true },
      }) !== true
    ) {
      throw new Error('canViewFinance override should fetch finance');
    }
  });

  await check('InventoryProvider.jsx & FinanceProvider.jsx gate initial fetches via providerAccessGates', async () => {
    const invSrc = readFileSync(join(ROOT, 'src', 'components', 'InventoryContext', 'InventoryProvider.jsx'), 'utf8');
    const finSrc = readFileSync(join(ROOT, 'src', 'components', 'FinanceContext', 'FinanceProvider.jsx'), 'utf8');
    if (!/canFetchInventoryProvider/.test(invSrc) || !/useAuth/.test(invSrc)) {
      throw new Error('InventoryProvider.jsx must use useAuth + canFetchInventoryProvider');
    }
    if (!/canFetchFinanceProvider/.test(finSrc)) {
      throw new Error('FinanceProvider.jsx must use canFetchFinanceProvider');
    }
  });

  // =========================================================================
  // SLICE 2: audit_logs/{logId} — block unverified/guest/member/orphan injection
  // =========================================================================
  console.log('\n=== Slice 2: audit_logs/{logId} write protection ===');
  const validAuditEntry = {
    action: 'IAD',
    module: 'Inventory',
    performedBy: 'Test Officer',
    itemName: 'Projector',
    itemType: 'Equipment/Asset',
    summary: '+ Registered new asset "Projector"',
    timestamp: new Date('2026-11-26T00:00:00Z'),
  };

  await check('Orphan Auth user (no users/{uid} doc), Guest, and Member CANNOT inject audit_logs', async () => {
    await assertFails(
      testEnv
        .authenticatedContext('u-orphan-google', { email: 'random@gmail.com', email_verified: true })
        .firestore()
        .collection('audit_logs')
        .doc('fake-orphan')
        .set(validAuditEntry)
    );
    await assertFails(
      testEnv.authenticatedContext('u-guest').firestore().collection('audit_logs').doc('fake-guest').set(validAuditEntry)
    );
    await assertFails(
      testEnv
        .authenticatedContext('u-member', { email: 'student@ctu.edu.ph', email_verified: true })
        .firestore()
        .collection('audit_logs')
        .doc('fake-member')
        .set(validAuditEntry)
    );
    await assertFails(
      testEnv.authenticatedContext('u-deactivated').firestore().collection('audit_logs').doc('fake-deact').set(validAuditEntry)
    );
  });

  await check('Authorized staff (Admin, Secretary, Finance, Creatives, Senator) CAN append valid audit_logs', async () => {
    for (const uid of ['u-admin', 'u-sec', 'u-fin', 'u-creatives', 'u-sen']) {
      await assertSucceeds(
        testEnv.authenticatedContext(uid).firestore().collection('audit_logs').doc(`ok-${uid}`).set(validAuditEntry)
      );
    }
  });

  await check('Malformed audit_logs entry (missing action/module) is REJECTED even for officers', async () => {
    await assertFails(
      testEnv.authenticatedContext('u-sec').firestore().collection('audit_logs').doc('bad-shape').set({ foo: 'bar' })
    );
  });

  // =========================================================================
  // SLICE 7A: Death Aid cross-section ownership & debtRecords invariant in firestore.rules
  // =========================================================================
  console.log('\n=== Slice 7A: Death Aid cross-section ownership in firestore.rules ===');
  const makeDeathAidCol = (recordedByUid, extra = {}) => ({
    rosterId: 'r-member-own',
    section: 'BSIT - 3A',
    sectionKey: 'bsit - 3a',
    recordedByUid,
    enrolledCount: 10,
    beneficiaryCount: 8,
    contributionPerStudent: 10,
    collectedAmount: 80,
    expectedCollection: 100,
    debtCount: 2,
    debtAmount: 20,
    status: 'for_verification',
    submittedAt: new Date('2026-11-26T00:00:00Z'),
    debtRecords: [],
    ...extra,
  });

  await check('Verified @ctu.edu.ph Member CANNOT file Death Aid against ANOTHER mayor verified roster', () =>
    assertFails(
      testEnv
        .authenticatedContext('u-member-other', { email: 'other@ctu.edu.ph', email_verified: true })
        .firestore()
        .collection('deathAidCollections')
        .doc('forged-cross-section')
        .set(makeDeathAidCol('u-member-other'))
    )
  );

  await check('Verified @ctu.edu.ph Member CANNOT file mismatched sectionKey or excess debtRecords', async () => {
    const memberDb = testEnv
      .authenticatedContext('u-member', { email: 'student@ctu.edu.ph', email_verified: true })
      .firestore();
    await assertFails(
      memberDb
        .collection('deathAidCollections')
        .doc('bad-sec-key')
        .set(makeDeathAidCol('u-member', { sectionKey: 'bsit - 9z' }))
    );
    await assertFails(
      memberDb
        .collection('deathAidCollections')
        .doc('excess-debt')
        .set(
          makeDeathAidCol('u-member', {
            debtRecords: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
          })
        )
    );
  });

  await check('Verified @ctu.edu.ph Member CAN file Death Aid against OWN verified roster, and Officer CAN file against any', async () => {
    await assertSucceeds(
      testEnv
        .authenticatedContext('u-member', { email: 'student@ctu.edu.ph', email_verified: true })
        .firestore()
        .collection('deathAidCollections')
        .doc('own-valid-col')
        .set(makeDeathAidCol('u-member'))
    );
    await assertSucceeds(
      testEnv
        .authenticatedContext('u-fin')
        .firestore()
        .collection('deathAidCollections')
        .doc('officer-valid-col')
        .set(makeDeathAidCol('u-fin'))
    );
  });

  await testEnv.cleanup();

  // =========================================================================
  // SLICE 3: Rate Limiter X-Forwarded-For spoofing, bounded LRU cap, per-orderId throttle
  // =========================================================================
  console.log('\n=== Slice 3: Rate Limiter anti-spoofing & OOM cap ===');
  const { createRateLimiter } = require(join(ROOT, 'backend', 'services', 'orderService.js'));

  const makeMockRes = () => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (payload) => {
      res.body = payload;
      return res;
    };
    return res;
  };

  await check('createRateLimiter ignores spoofed X-Forwarded-For header and keys on Express req.ip', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      const req = {
        ip: '203.0.113.55',
        headers: { 'x-forwarded-for': `198.51.100.${i + 1}` },
        socket: { remoteAddress: '203.0.113.55' },
      };
      const res = makeMockRes();
      let calledNext = false;
      limiter(req, res, () => {
        calledNext = true;
      });
      statuses.push(calledNext ? 200 : res.statusCode);
    }
    if (statuses.join(',') !== '200,200,429') {
      throw new Error(`Spoofed X-Forwarded-For bypassed limiter! Got statuses: ${statuses.join(',')}`);
    }
  });

  await check('createRateLimiter enforces hard maxKeys LRU cap to prevent OOM under IP spray', async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 5, maxKeys: 20 });
    for (let i = 0; i < 60; i += 1) {
      const req = { ip: `10.0.0.${i}`, headers: {}, socket: { remoteAddress: `10.0.0.${i}` } };
      limiter(req, makeMockRes(), () => {});
    }
    if (typeof limiter._size !== 'function' || limiter._size() > 20) {
      throw new Error(
        `Limiter map is unbounded or missing _size() inspection (size=${typeof limiter._size === 'function' ? limiter._size() : 'N/A'})`
      );
    }
  });

  await check('orders.js mounts per-orderId brute-force rate limiter on GET /api/orders/track', async () => {
    const ordersRouteSrc = readFileSync(join(ROOT, 'backend', 'routes', 'orders.js'), 'utf8');
    if (!/keyGenerator/.test(ordersRouteSrc) || !/trackOrderIdLimiter/.test(ordersRouteSrc)) {
      throw new Error('backend/routes/orders.js must mount a per-orderId trackOrderIdLimiter using keyGenerator');
    }
  });

  // =========================================================================
  // SLICE 4: AuthContext & ProtectedRoute — unverified member session & Google redirect race
  // =========================================================================
  console.log('\n=== Slice 4: AuthContext & ProtectedRoute member verification + redirect race ===');
  const policyMod = await import(`${pathToFileURL(join(ROOT, 'src', 'utils', 'authDomainPolicy.js')).href}?t=${Date.now()}`);

  await check('authDomainPolicy exports evaluateMemberSessionPolicy handling verified/unverified/gmail/officers', async () => {
    if (typeof policyMod.evaluateMemberSessionPolicy !== 'function') {
      throw new Error('evaluateMemberSessionPolicy is not exported from authDomainPolicy.js');
    }
    const okMember = policyMod.evaluateMemberSessionPolicy({
      role: 'member',
      email: 'juan@ctu.edu.ph',
      emailVerified: true,
    });
    const unverifiedMember = policyMod.evaluateMemberSessionPolicy({
      role: 'member',
      email: 'juan@gmail.com',
      emailVerified: false,
    });
    const gmailMember = policyMod.evaluateMemberSessionPolicy({
      role: 'member',
      email: 'student.demo@gmail.com',
      emailVerified: true,
    });
    const invalidEmailMember = policyMod.evaluateMemberSessionPolicy({
      role: 'member',
      email: 'not-an-email',
      emailVerified: true,
    });
    const officerGmail = policyMod.evaluateMemberSessionPolicy({
      role: 'finance_secretary',
      email: 'officer@gmail.com',
      emailVerified: false,
    });
    if (!okMember.allowed) throw new Error('Verified @ctu.edu.ph member should be allowed');
    if (!gmailMember.allowed) throw new Error('Verified @gmail.com member should be allowed during demonstration mode');
    if (unverifiedMember.allowed || unverifiedMember.code !== 'auth/email-not-verified') {
      throw new Error(`Expected auth/email-not-verified for unverified member, got ${JSON.stringify(unverifiedMember)}`);
    }
    if (invalidEmailMember.allowed || invalidEmailMember.code !== 'auth/invalid-institutional-domain') {
      throw new Error(`Expected auth/invalid-institutional-domain for malformed email, got ${JSON.stringify(invalidEmailMember)}`);
    }
    if (!officerGmail.allowed) throw new Error('Pre-provisioned officer must remain allowed regardless of email domain');
  });

  await check('AuthContext.jsx enforces isVerifiedMemberSession / evaluateMemberSessionPolicy in onAuthStateChanged & prevents signup/redirect races', async () => {
    const authSrc = readFileSync(join(ROOT, 'src', 'components', 'AuthContext', 'AuthContext.jsx'), 'utf8');
    const usesPolicy = /evaluateMemberSessionPolicy|isVerifiedMemberSession/.test(authSrc);
    const guardsSignupRace = /signupInProgressRef/.test(authSrc);
    const guardsRedirectRace = /redirectPendingRef/.test(authSrc);
    const noOrphanSetCurrentUser = !/No user document found for UID:[\s\S]{0,160}setCurrentUser\(user\)/.test(authSrc);
    if (!usesPolicy || !guardsSignupRace || !guardsRedirectRace || !noOrphanSetCurrentUser) {
      throw new Error(
        `Missing AuthContext guards: usesPolicy=${usesPolicy}, signupRace=${guardsSignupRace}, redirectRace=${guardsRedirectRace}, noOrphanSetCurrentUser=${noOrphanSetCurrentUser}`
      );
    }
  });

  await check('ProtectedRoute.jsx enforces isVerifiedMemberSession as defense-in-depth', async () => {
    const prSrc = readFileSync(join(ROOT, 'src', 'components', 'ProtectedRoute', 'ProtectedRoute.jsx'), 'utf8');
    if (!/isVerifiedMemberSession/.test(prSrc)) {
      throw new Error('ProtectedRoute.jsx must enforce isVerifiedMemberSession');
    }
  });

  // =========================================================================
  // SLICE 5: TrackOrder status timeline ('Online Paid'/'Claimed'/'Returned'), one-shot auto-search, case-insensitive lookup
  // =========================================================================
  console.log('\n=== Slice 5: TrackOrder status timeline, auto-search ref, and case-insensitive orderId ===');

  await check('trackOrderHelpers maps Online Paid, Claimed, Returned, and timeline active states accurately', async () => {
    const helperPath = join(ROOT, 'src', 'utils', 'trackOrderHelpers.js');
    if (!existsSync(helperPath)) {
      throw new Error('src/utils/trackOrderHelpers.js does not exist yet');
    }
    const { resolveTrackOrderStatusMeta, getTrackOrderTimelineState } = await import(
      `${pathToFileURL(helperPath).href}?t=${Date.now()}`
    );

    const onlinePaid = resolveTrackOrderStatusMeta('Online Paid');
    const claimed = resolveTrackOrderStatusMeta('Claimed');
    const returned = resolveTrackOrderStatusMeta('Returned');
    if (onlinePaid.iconKey !== 'creditCard' || onlinePaid.progress !== 50) {
      throw new Error(`Unexpected Online Paid meta: ${JSON.stringify(onlinePaid)}`);
    }
    if (claimed.iconKey !== 'checkCircle' || claimed.progress !== 100) {
      throw new Error(`Unexpected Claimed meta: ${JSON.stringify(claimed)}`);
    }
    if (returned.iconKey !== 'xCircle' || returned.progress !== 0) {
      throw new Error(`Unexpected Returned meta: ${JSON.stringify(returned)}`);
    }

    const tlOnline = getTrackOrderTimelineState('Online Paid');
    if (!tlOnline.placed || !tlOnline.paid || tlOnline.processing || tlOnline.ready) {
      throw new Error(`Online Paid timeline wrong: ${JSON.stringify(tlOnline)}`);
    }
    const tlClaimed = getTrackOrderTimelineState('Claimed');
    if (!tlClaimed.placed || !tlClaimed.paid || !tlClaimed.processing || !tlClaimed.ready) {
      throw new Error(`Claimed timeline wrong: ${JSON.stringify(tlClaimed)}`);
    }
  });

  await check('TrackOrder.jsx uses trackOrderHelpers and guards location.state auto-search with a one-shot useRef', async () => {
    const src = readFileSync(join(ROOT, 'src', 'components', 'TrackOrder', 'TrackOrder.jsx'), 'utf8');
    const usesHelper = /resolveTrackOrderStatusMeta/.test(src) && /getTrackOrderTimelineState/.test(src);
    const hasOneShotRef = /autoSearchedKeyRef/.test(src);
    if (!usesHelper || !hasOneShotRef) {
      throw new Error(`TrackOrder missing fixes: usesHelper=${usesHelper}, hasOneShotRef=${hasOneShotRef}`);
    }
  });

  await check('lookupPublicOrder normalizes lowercase orderId (ord-db-0001 -> ORD-DB-0001)', async () => {
    const { lookupPublicOrder } = require(join(ROOT, 'backend', 'services', 'orderService.js'));
    let queriedOrderId = null;
    const mockDb = {
      collection: () => ({
        where: (_field, _op, val) => {
          queriedOrderId = val;
          return {
            limit: () => ({
              get: async () => ({
                empty: val !== 'ORD-DB-0001',
                docs:
                  val === 'ORD-DB-0001'
                    ? [
                        {
                          id: 'doc-1',
                          data: () => ({
                            orderId: 'ORD-DB-0001',
                            orderStatus: 'Online Paid',
                            customerInfo: { fullName: 'Juan Dela Cruz', schoolID: '1234567', email: 'juan@ctu.edu.ph' },
                            productInfo: { productName: 'CTU Uniform', quantity: 1, totalPrice: 200 },
                          }),
                        },
                      ]
                    : [],
              }),
            }),
          };
        },
      }),
    };
    const found = await lookupPublicOrder(mockDb, { orderId: 'ord-db-0001', verifier: '1234567' });
    if (!found || queriedOrderId !== 'ORD-DB-0001') {
      throw new Error(`Lowercase orderId failed lookup (queried=${queriedOrderId}, found=${Boolean(found)})`);
    }
  });

  // =========================================================================
  // SLICE 6: Admin SDK documentId path-injection guard & Webhook fail-closed when NODE_ENV unset
  // =========================================================================
  console.log('\n=== Slice 6: documentId path validation & webhook fail-closed default ===');

  await check('Meta & Telegram webhook guards fail CLOSED (403) when NODE_ENV is unset and secret is missing', async () => {
    const { createMetaWebhookGuard, createTelegramWebhookGuard } = require(
      join(ROOT, 'backend', 'middleware', 'webhookSecurity.js')
    );
    const prevNodeEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      const metaGuard = createMetaWebhookGuard({ getSecret: () => '' });
      const tgGuard = createTelegramWebhookGuard({ getSecret: () => '' });

      const metaRes = makeMockRes();
      let metaNext = false;
      metaGuard({ headers: {}, rawBody: Buffer.from('{}') }, metaRes, () => {
        metaNext = true;
      });

      const tgRes = makeMockRes();
      let tgNext = false;
      tgGuard({ headers: {} }, tgRes, () => {
        tgNext = true;
      });

      if (metaNext || metaRes.statusCode !== 403 || tgNext || tgRes.statusCode !== 403) {
        throw new Error(
          `Webhooks failed OPEN when NODE_ENV unset! meta=(next:${metaNext},status:${metaRes.statusCode}), tg=(next:${tgNext},status:${tgRes.statusCode})`
        );
      }
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }
  });

  await check('firestoreIdValidator blocks subcollection traversal (doc1/auditLogs/log1, .., %2F) and accepts valid IDs', async () => {
    const validatorPath = join(ROOT, 'backend', 'utils', 'firestoreIdValidator.js');
    if (!existsSync(validatorPath)) {
      throw new Error('backend/utils/firestoreIdValidator.js does not exist yet');
    }
    const { isValidFirestoreDocId } = require(validatorPath);
    if (isValidFirestoreDocId('doc1/auditLogs/log1') !== false) throw new Error('Must reject slash traversal');
    if (isValidFirestoreDocId('doc1%2FauditLogs%2Flog1') !== false) throw new Error('Must reject encoded slash');
    if (isValidFirestoreDocId('..') !== false) throw new Error('Must reject dot-dot');
    if (isValidFirestoreDocId('') !== false) throw new Error('Must reject empty');
    if (isValidFirestoreDocId('doc_ABC-123') !== true) throw new Error('Must accept valid Firestore doc ID');
  });

  await check('documents.js & ai.js validate documentId via isValidFirestoreDocId before Admin SDK .doc(documentId)', async () => {
    const docsSrc = readFileSync(join(ROOT, 'backend', 'routes', 'documents.js'), 'utf8');
    const aiSrc = readFileSync(join(ROOT, 'backend', 'routes', 'ai.js'), 'utf8');
    const docsChecks = /isValidFirestoreDocId\(documentId\)/.test(docsSrc);
    const aiMatches = (aiSrc.match(/isValidFirestoreDocId\(documentId\)/g) || []).length;
    if (!docsChecks || aiMatches < 4) {
      throw new Error(`Missing documentId validation: documents.js=${docsChecks}, ai.js count=${aiMatches}/4`);
    }
  });

  // =========================================================================
  // SLICE 7B: Atomic stock reservation on POST /api/orders & reservation-safe status transitions
  // =========================================================================
  console.log('\n=== Slice 7B: Atomic stock reservation & OrderManagement transition safety ===');

  await check('createAuthoritativeOrder atomically decrements stockAvailable inside runTransaction and blocks overselling', async () => {
    const { createAuthoritativeOrder } = require(join(ROOT, 'backend', 'services', 'orderService.js'));
    let stock = 2;
    let txCalls = 0;
    const savedOrders = [];

    const productRef = { id: 'prod-1', __kind: 'product' };
    const counterRef = { id: 'orderCounters', __kind: 'counter' };
    let counterVal = 0;

    const mockDb = {
      collection: (name) => {
        if (name === 'products') {
          const prodSnap = () => ({
            exists: true,
            id: 'prod-1',
            data: () => ({
              productId: 'prod-1',
              productName: 'CTU Shirt',
              price: 200,
              stockAvailable: stock,
            }),
          });
          return {
            where: () => ({
              limit: () => ({
                get: async () => ({ empty: false, docs: [prodSnap()] }),
              }),
            }),
            doc: () => ({
              ...productRef,
              get: async () => prodSnap(),
            }),
          };
        }
        if (name === 'settings') {
          return {
            doc: () => counterRef,
          };
        }
        if (name === 'orders') {
          return {
            orderBy: () => ({
              limit: () => ({
                get: async () => ({ empty: true, docs: [] }),
              }),
            }),
            doc: () => ({ id: `ord-doc-${savedOrders.length + 1}`, __kind: 'order' }),
            add: async (rec) => {
              savedOrders.push(rec);
              return { id: `ord-doc-${savedOrders.length}` };
            },
          };
        }
        return {};
      },
      runTransaction: async (fn) => {
        txCalls += 1;
        const tx = {
          get: async (ref) => {
            if (ref.__kind === 'counter') {
              return { exists: counterVal > 0, data: () => ({ lastOrderNumber: counterVal }) };
            }
            if (ref.__kind === 'product') {
              return {
                exists: true,
                id: 'prod-1',
                data: () => ({
                  productId: 'prod-1',
                  productName: 'CTU Shirt',
                  price: 200,
                  stockAvailable: stock,
                }),
              };
            }
            return { exists: false };
          },
          set: (ref, data) => {
            if (ref.__kind === 'counter') counterVal = data.lastOrderNumber;
            if (ref.__kind === 'order') savedOrders.push(data);
          },
          update: (ref, data) => {
            if (ref.__kind === 'product' && typeof data.stockAvailable === 'number') {
              stock = data.stockAvailable;
            }
          },
        };
        return fn(tx);
      },
    };

    const basePayload = {
      fullName: 'Juan Dela Cruz',
      bachelorDegree: 'BSIT',
      section: '3A',
      address: 'CTU-DB',
      email: 'juan@ctu.edu.ph',
      schoolID: '2026-0001',
      phoneNumber: '09171234567',
      productId: 'prod-1',
      quantity: 2,
      paymentMethod: 'Cash',
    };

    await createAuthoritativeOrder(mockDb, basePayload);
    if (stock !== 0 || savedOrders.length !== 1 || savedOrders[0].stockReserved !== true || savedOrders[0].stockClaimDeducted !== true) {
      throw new Error(
        `Stock was NOT atomically reserved! stock=${stock}, txCalls=${txCalls}, order=${JSON.stringify(savedOrders[0] || null)}`
      );
    }

    let oversellRejected = false;
    try {
      await createAuthoritativeOrder(mockDb, { ...basePayload, quantity: 1 });
    } catch (err) {
      if (err.statusCode === 409) oversellRejected = true;
    }
    if (!oversellRejected) {
      throw new Error('Second order against depleted stock was NOT rejected with 409');
    }
  });

  await check('executeOrderStatusUpdate preserves reservation across Pending->Online Paid->Claimed and restores only on Cancelled', async () => {
    const { executeOrderStatusUpdate } = await import(
      `${pathToFileURL(join(ROOT, 'src', 'components', 'Data', 'orderStatusTransition.js')).href}?t=${Date.now()}`
    );
    const stockOps = [];
    const updates = [];
    const makeDeps = () => ({
      currentUser: { uid: 'off-1', email: 'off@ctu.edu.ph' },
      userName: 'Officer',
      showToast: () => {},
      syncOrderStockDeduction: async (arg) => stockOps.push(arg.deduct ? 'deduct' : 'restore'),
      auditService: { logInventoryUpdate: async () => {} },
      financeService: {
        syncOrderRevenueToIGF: async () => {},
        reverseOrderRevenueFromIGF: async () => {},
      },
      updateOrderDoc: async (_id, patch) => updates.push(patch),
    });

    const reservedOrder = {
      orderId: 'ORD-DB-0001',
      orderStatus: 'Pending',
      claimed: false,
      stockReserved: true,
      stockClaimDeducted: true,
      igfSynced: false,
      productInfo: { productId: 'prod-1', productName: 'CTU Shirt', quantity: 2, totalPrice: 400 },
    };

    // Pending -> Online Paid must NOT restore stock
    await executeOrderStatusUpdate({ docId: 'd1', newStatus: 'Online Paid', order: reservedOrder, deps: makeDeps() });
    if (stockOps.length !== 0 || updates[0].stockClaimDeducted !== true) {
      throw new Error(`Pending->Online Paid broke stock reservation: ops=${JSON.stringify(stockOps)}, patch=${JSON.stringify(updates[0])}`);
    }

    // Online Paid -> Claimed must NOT double-deduct stock
    await executeOrderStatusUpdate({
      docId: 'd1',
      newStatus: 'Claimed',
      order: { ...reservedOrder, orderStatus: 'Online Paid', igfSynced: true },
      deps: makeDeps(),
    });
    if (stockOps.length !== 0 || updates[1].stockClaimDeducted !== true) {
      throw new Error(`Online Paid->Claimed double-deducted stock: ops=${JSON.stringify(stockOps)}`);
    }

    // Pending -> Cancelled MUST restore stock once
    await executeOrderStatusUpdate({ docId: 'd1', newStatus: 'Cancelled', order: reservedOrder, deps: makeDeps() });
    if (stockOps.join(',') !== 'restore' || updates[2].stockClaimDeducted !== false) {
      throw new Error(`Pending->Cancelled failed to restore stock: ops=${JSON.stringify(stockOps)}, patch=${JSON.stringify(updates[2])}`);
    }
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
  console.log('\n✅ All Public-Launch Hardening TDD checks passed.');
  process.exit(0);
}
