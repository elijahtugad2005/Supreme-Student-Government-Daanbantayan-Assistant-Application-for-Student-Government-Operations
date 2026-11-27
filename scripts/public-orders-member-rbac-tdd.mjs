/**
 * public-orders-member-rbac-tdd.mjs
 * Red -> Green -> Refactor TDD Suite for:
 *   Slice 1: Server-side authoritative order creation (POST /api/orders) — variation pricing, stock checks, anti-tampering
 *   Slice 2: Masked public order tracking (GET /api/orders/track) — verifier check, PII masking, rate limit
 *   Slice 3: Live Firestore Emulator Rules — lock down `orders` + restrict `member` read access + block `permissions` signup spoof
 *   Slice 4: Frontend & Backend production wiring contracts
 *
 * Run: npm run test:public-orders-rbac
 */

import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { EMULATOR_PROJECT } from './emulator-project.mjs';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let failed = 0;
const results = [];
const check = async (label, fn) => {
  try {
    await fn();
    results.push(`ok   ${label}`);
  } catch (err) {
    failed += 1;
    results.push(`FAIL ${label} — ${err.message.split('\n')[0]}`);
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Emulator helpers
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
    return { host: h, port: Number(p), stop: async () => { } };
  }
  if (await isPortOpen('127.0.0.1', 8080)) {
    return { host: '127.0.0.1', port: 8080, stop: async () => { } };
  }
  const cacheDir = path.join(homedir(), '.cache', 'firebase', 'emulators');
  const jar = existsSync(cacheDir)
    ? readdirSync(cacheDir)
      .filter((f) => /^cloud-firestore-emulator-.*\.jar$/.test(f))
      .sort()
      .pop()
    : null;
  if (!jar) {
    throw new Error(`Firestore emulator JAR not found in ${cacheDir}`);
  }
  const port = await getFreePort();
  const proc = spawn('java', ['-jar', path.join(cacheDir, jar), '--host', '127.0.0.1', '--port', String(port)], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (await isPortOpen('127.0.0.1', port)) {
      return { host: '127.0.0.1', port, stop: async () => proc.kill() };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error('Timed out starting Firestore emulator');
};

// In-memory fake Firestore adapter for unit-testing backend/services/orderService.js
function createMockAdminDb(seedProducts = [], seedOrders = []) {
  const products = new Map(seedProducts.map((p, i) => [p.docId || `prod_${i}`, { ...p }]));
  const orders = new Map(seedOrders.map((o, i) => [o.docId || `ord_${i}`, { ...o }]));
  const settings = new Map();
  let seq = seedOrders.length;

  const makeSnap = (map, filterFn = () => true) => {
    const docs = [];
    for (const [id, data] of map.entries()) {
      if (filterFn(data)) {
        docs.push({ id, data: () => ({ ...data }) });
      }
    }
    return { empty: docs.length === 0, docs };
  };

  return {
    _orders: orders,
    collection(name) {
      if (name === 'products') {
        return {
          where(field, _op, val) {
            return {
              limit() {
                return {
                  async get() {
                    return makeSnap(products, (d) => d[field] === val);
                  },
                };
              },
            };
          },
          doc(id) {
            return {
              async get() {
                const d = products.get(id);
                return { exists: Boolean(d), id, data: () => (d ? { ...d } : undefined) };
              },
            };
          },
        };
      }
      if (name === 'orders') {
        return {
          async add(data) {
            seq += 1;
            const id = `order_doc_${seq}`;
            orders.set(id, { ...data });
            return { id };
          },
          where(field, _op, val) {
            return {
              limit() {
                return {
                  async get() {
                    return makeSnap(orders, (d) => {
                      const parts = field.split('.');
                      let cur = d;
                      for (const p of parts) cur = cur?.[p];
                      return cur === val;
                    });
                  },
                };
              },
            };
          },
          orderBy() {
            return {
              limit() {
                return {
                  async get() {
                    const all = Array.from(orders.entries()).map(([id, data]) => ({
                      id,
                      data: () => ({ ...data }),
                    }));
                    return { empty: all.length === 0, docs: all.slice(-1) };
                  },
                };
              },
            };
          },
        };
      }
      if (name === 'settings') {
        return {
          doc(id) {
            return {
              _id: id,
              async get() {
                const d = settings.get(id);
                return { exists: Boolean(d), data: () => (d ? { ...d } : undefined) };
              },
              async set(data) {
                settings.set(id, { ...data });
              },
            };
          },
        };
      }
      throw new Error(`Unexpected collection: ${name}`);
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return await ref.get();
        },
        set(ref, data) {
          settings.set(ref._id, { ...data });
        },
      };
      return await fn(tx);
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 1 & 2: Backend Authoritative Orders & Masked Tracking Service
// ════════════════════════════════════════════════════════════════════════════
console.log('=== Slice 1 & 2: Server-Side POST /api/orders & Masked Tracking ===');

const orderServicePath = path.join(ROOT, 'backend/services/orderService.js');
await check('backend/services/orderService.js exists', async () => {
  assert.equal(existsSync(orderServicePath), true, 'Missing backend/services/orderService.js');
});

if (existsSync(orderServicePath)) {
  const orderService = require(orderServicePath);
  const catalogProduct = {
    docId: 'doc_uniform',
    productId: 'PROD-UNIFORM-1',
    productName: 'CTU School Uniform',
    price: 150,
    stockAvailable: 10,
    hasVariations: true,
    sizeOptions: ['Small', 'Medium', 'Extra Large'],
    sizePrices: { 'Extra Large': 200 },
    colorVariations: ['White'],
    customVariations: [],
  };

  await check('createAuthoritativeOrder ignores client-tampered price & Online Paid status, computes ₱200 x 3 = ₱600', async () => {
    const db = createMockAdminDb([catalogProduct]);
    const res = await orderService.createAuthoritativeOrder(db, {
      fullName: 'Juan Dela Cruz',
      bachelorDegree: 'BSIT',
      section: '3rd Year',
      address: 'Poblacion, Daanbantayan',
      email: 'Juan.DelaCruz@ctu.edu.ph',
      phoneNumber: '09171234567',
      schoolID: '2024-10842',
      productId: 'PROD-UNIFORM-1',
      size: 'Extra Large',
      color: 'White',
      quantity: 3,
      paymentMethod: 'Online',
      onlinePaymentType: 'GCash',
      referenceNumber: '902184729182',
      // Malicious client tampering attempts:
      pricePerUnit: 1,
      totalPrice: 1,
      orderStatus: 'Online Paid',
    });

    assert.equal(res.orderStatus, 'Pending');
    assert.equal(res.productInfo.pricePerUnit, 200);
    assert.equal(res.productInfo.totalPrice, 600);
    assert.equal(res.paymentInfo.verificationStatus, 'pending_verification');
    assert.match(res.orderId, /^ORD-DB-\d{4,}$/);
    assert.ok(res.trackingCode && res.trackingCode.length >= 6);
  });

  await check('createAuthoritativeOrder rejects insufficient stock and invalid sizes', async () => {
    const db = createMockAdminDb([catalogProduct]);
    await assert.rejects(
      () =>
        orderService.createAuthoritativeOrder(db, {
          fullName: 'Maria Santos',
          bachelorDegree: 'BSIT',
          section: '2nd Year',
          address: 'Campus Dorm',
          email: 'maria@ctu.edu.ph',
          phoneNumber: '09171234567',
          schoolID: '2024-22222',
          productId: 'PROD-UNIFORM-1',
          size: 'Medium',
          color: 'White',
          quantity: 11,
          paymentMethod: 'Cash',
        }),
      /stock/i
    );

    await assert.rejects(
      () =>
        orderService.createAuthoritativeOrder(db, {
          fullName: 'Maria Santos',
          bachelorDegree: 'BSIT',
          section: '2nd Year',
          address: 'Campus Dorm',
          email: 'maria@ctu.edu.ph',
          phoneNumber: '09171234567',
          schoolID: '2024-22222',
          productId: 'PROD-UNIFORM-1',
          size: '5XL-FAKE',
          color: 'White',
          quantity: 1,
          paymentMethod: 'Cash',
        }),
      /size/i
    );
  });

  await check('lookupPublicOrder masks PII and rejects mismatched verifier (prevents scraping)', async () => {
    const db = createMockAdminDb([catalogProduct]);
    const created = await orderService.createAuthoritativeOrder(db, {
      fullName: 'Juan Dela Cruz',
      bachelorDegree: 'BSIT',
      section: '3rd Year',
      address: 'Poblacion, Daanbantayan',
      email: 'juan@ctu.edu.ph',
      phoneNumber: '09171234567',
      schoolID: '2024-10842',
      productId: 'PROD-UNIFORM-1',
      size: 'Medium',
      color: 'White',
      quantity: 2,
      paymentMethod: 'Online',
      onlinePaymentType: 'GCash',
      referenceNumber: '902184729182',
    });

    // Wrong verifier MUST fail
    const badLookup = await orderService.lookupPublicOrder(db, {
      orderId: created.orderId,
      verifier: 'wrong-id-9999',
    });
    assert.equal(badLookup, null);

    // Matching schoolID succeeds with strictly masked PII
    const okLookup = await orderService.lookupPublicOrder(db, {
      orderId: created.orderId,
      verifier: '2024-10842',
    });
    assert.ok(okLookup);
    assert.equal(okLookup.orderId, created.orderId);
    assert.equal(okLookup.productInfo.pricePerUnit, 150);
    assert.equal(okLookup.productInfo.totalPrice, 300);
    assert.notEqual(okLookup.customerInfo.fullName, 'Juan Dela Cruz');
    assert.equal(okLookup.customerInfo.phoneNumber, undefined);
    assert.equal(okLookup.customerInfo.address, undefined);
    assert.equal(okLookup.customerInfo.email, undefined);
    assert.match(okLookup.customerInfo.schoolID, /\*+0842$/);
    assert.match(okLookup.paymentInfo.referenceNumber, /\*+9182$/);
  });

  await check('in-memory rate limiter blocks excessive requests with 429', async () => {
    const limiter = orderService.createRateLimiter({ windowMs: 60_000, max: 2 });
    const req = { ip: '127.0.0.99', headers: {} };
    let status = 200;
    let calledNext = 0;
    const res = {
      status(code) {
        status = code;
        return { json: () => { } };
      },
    };
    const next = () => {
      calledNext += 1;
    };
    limiter(req, res, next);
    limiter(req, res, next);
    limiter(req, res, next);
    assert.equal(calledNext, 2);
    assert.equal(status, 429);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 3: Live Firestore Emulator Rules (Orders Privacy + Member Read Restriction)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 3: Live Firestore Emulator Rules Verification ===');

const emu = await ensureFirestoreEmulator();
const rules = readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const testEnv = await initializeTestEnvironment({
  projectId: EMULATOR_PROJECT,
  firestore: { host: emu.host, port: emu.port, rules },
});

try {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.collection('users').doc('member-1').set({ role: 'member', isActive: true });
    await db.collection('users').doc('finance-1').set({ role: 'finance_secretary', isActive: true });
    await db.collection('users').doc('gov-1').set({ role: 'governor', isActive: true });
    await db.collection('users').doc('rep-1').set({ role: 'representative', isActive: true });
    await db.collection('users').doc('admin-1').set({ role: 'admin', isActive: true });

    await db.collection('orders').doc('ord-1').set({
      orderId: 'ORD-DB-0001',
      orderStatus: 'Pending',
      customerInfo: { fullName: 'Juan', email: 'juan@ctu.edu.ph', phoneNumber: '09171234567' },
    });
    await db.collection('budgets').doc('b-1').set({ eventName: 'Intramurals', allocated: 50000 });
    await db.collection('funds').doc('f-1').set({ balance: 500000 });
    await db.collection('borrowingLogs').doc('bl-1').set({ item: 'Mic' });
    await db.collection('preOrderBatches').doc('pb-1').set({ title: 'Batch 1' });
    await db.collection('preOrderEntries').doc('pe-1').set({ student: 'Juan' });
    await db.collection('lockers').doc('l-1').set({ code: 'A1' });
    await db.collection('igpCollections').doc('ic-1').set({ amountCentavos: 50000 });
    await db.collection('settings').doc('app').set({ maintenance: false });
    await db.collection('settings').doc('commerceOrderSheet').set({ spreadsheetId: 'secret-sheet' });
    await db.collection('products').doc('p-1').set({ productName: 'Uniform', price: 150 });
    await db.collection('deathAidBeneficiaries').doc('da-open').set({ studentName: 'Open Case', status: 'open' });
    await db.collection('deathAidBeneficiaries').doc('da-closed').set({ studentName: 'Closed Case', status: 'released', releasePhotoDataUrl: 'data:image/png;base64,xxx' });
    await db.collection('deathAidCollections').doc('dac-own').set({ recordedByUid: 'member-verified', status: 'for_verification', collectedAmount: 100 });
    await db.collection('deathAidCollections').doc('dac-other').set({ recordedByUid: 'mayor-other', status: 'for_verification', collectedAmount: 500 });
    await db.collection('users').doc('member-verified').set({ role: 'member', isActive: true, email: 'student@ctu.edu.ph' });
    await db.collection('users').doc('member-unverified').set({ role: 'member', isActive: true, email: 'unverified@ctu.edu.ph' });
  });

  const unauth = () => testEnv.unauthenticatedContext().firestore();
  const asUser = (uid, tokenOptions) => testEnv.authenticatedContext(uid, tokenOptions).firestore();
  const verifiedMember = () => asUser('member-verified', { email: 'student@ctu.edu.ph', email_verified: true });
  const unverifiedMember = () => asUser('member-unverified', { email: 'unverified@ctu.edu.ph', email_verified: false });

  await check('Unauthenticated visitor CANNOT read or create orders directly in Firestore', async () => {
    await assertFails(unauth().collection('orders').doc('ord-1').get());
    await assertFails(unauth().collection('orders').doc('ord-spoof').set({ orderStatus: 'Online Paid' }));
    await assertSucceeds(unauth().collection('products').doc('p-1').get());
  });

  await check('Self-registered member CANNOT read or directly create orders in Firestore', async () => {
    await assertFails(verifiedMember().collection('orders').doc('ord-1').get());
    await assertFails(verifiedMember().collection('orders').doc('ord-spoof').set({ orderStatus: 'Pending' }));
  });

  await check('Self-registered member CANNOT read internal SSG finance/IGP/inventory collections', async () => {
    await assertFails(verifiedMember().collection('budgets').doc('b-1').get());
    await assertFails(verifiedMember().collection('funds').doc('f-1').get());
    await assertFails(verifiedMember().collection('borrowingLogs').doc('bl-1').get());
    await assertFails(verifiedMember().collection('preOrderBatches').doc('pb-1').get());
    await assertFails(verifiedMember().collection('preOrderEntries').doc('pe-1').get());
    await assertFails(verifiedMember().collection('lockers').doc('l-1').get());
    await assertFails(verifiedMember().collection('igpCollections').doc('ic-1').get());
    await assertFails(verifiedMember().collection('settings').doc('commerceOrderSheet').get());
  });

  await check('Unverified @ctu.edu.ph member CANNOT read Death Aid beneficiaries or collections', async () => {
    await assertFails(unverifiedMember().collection('deathAidBeneficiaries').doc('da-open').get());
    await assertFails(unverifiedMember().collection('deathAidCollections').doc('dac-own').get());
  });

  await check('Verified @ctu.edu.ph member can ONLY read OPEN Death Aid drives and THEIR OWN collections (not closed/other sections)', async () => {
    await assertSucceeds(verifiedMember().collection('settings').doc('app').get());
    await assertSucceeds(verifiedMember().collection('products').doc('p-1').get());
    await assertSucceeds(verifiedMember().collection('deathAidBeneficiaries').doc('da-open').get());
    await assertFails(verifiedMember().collection('deathAidBeneficiaries').doc('da-closed').get());
    await assertSucceeds(verifiedMember().collection('deathAidCollections').doc('dac-own').get());
    await assertFails(verifiedMember().collection('deathAidCollections').doc('dac-other').get());
  });

  await check('Gmail & CTU students CAN self-register as member; neither can escalate role or smuggle permissions map', async () => {
    await assertSucceeds(
      asUser('demo-gmail-1', { email: 'student.demo@gmail.com', email_verified: true })
        .collection('users')
        .doc('demo-gmail-1')
        .set({ role: 'member', email: 'student.demo@gmail.com' })
    );
    await assertFails(
      asUser('demo-gmail-admin', { email: 'hacker@gmail.com', email_verified: true })
        .collection('users')
        .doc('demo-gmail-admin')
        .set({ role: 'admin', email: 'hacker@gmail.com' })
    );
    await assertFails(
      asUser('new-student', { email: 'new@ctu.edu.ph', email_verified: false })
        .collection('users')
        .doc('new-student')
        .set({ role: 'member', permissions: { canManageUsers: true } })
    );
    await assertSucceeds(
      asUser('new-student', { email: 'new@ctu.edu.ph', email_verified: false })
        .collection('users')
        .doc('new-student')
        .set({ role: 'member', email: 'new@ctu.edu.ph' })
    );
  });

  await check('Authorized officers (finance_secretary, governor, representative, admin) retain full operational reads including closed Death Aid cases', async () => {
    await assertSucceeds(asUser('finance-1').collection('budgets').doc('b-1').get());
    await assertSucceeds(asUser('finance-1').collection('funds').doc('f-1').get());
    await assertSucceeds(asUser('finance-1').collection('orders').doc('ord-1').get());
    await assertSucceeds(asUser('finance-1').collection('preOrderBatches').doc('pb-1').get());
    await assertSucceeds(asUser('finance-1').collection('preOrderEntries').doc('pe-1').get());
    await assertSucceeds(asUser('finance-1').collection('deathAidBeneficiaries').doc('da-closed').get());
    await assertSucceeds(asUser('finance-1').collection('deathAidCollections').doc('dac-other').get());
    await assertSucceeds(asUser('gov-1').collection('lockers').doc('l-1').get());
    await assertSucceeds(asUser('gov-1').collection('igpCollections').doc('ic-1').get());
    await assertSucceeds(asUser('rep-1').collection('orders').doc('ord-1').get());
    await assertSucceeds(asUser('rep-1').collection('igpCollections').doc('ic-1').get());
    await assertSucceeds(asUser('admin-1').collection('orders').doc('ord-1').get());
    await assertSucceeds(asUser('admin-1').collection('borrowingLogs').doc('bl-1').get());
  });
} finally {
  await testEnv.cleanup();
  await emu.stop();
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 4: Production Wiring Contracts
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 4: Production Wiring Contracts ===');

await check('backend/server.js mounts /api/orders, helmet headers, and webhook signature/secret guards', async () => {
  const srv = readFileSync(path.join(ROOT, 'backend/server.js'), 'utf8');
  assert.match(srv, /\/api\/orders/);
  assert.match(srv, /helmet\s*\(/);
  assert.match(srv, /verifyMetaWebhook/);
  assert.match(srv, /verifyTelegramWebhook/);
  assert.match(srv, /verifyHandshakeToken/);

  const wh = require(path.join(ROOT, 'backend/middleware/webhookSecurity.js'));
  const crypto = require('node:crypto');

  // Handshake must never accept undefined === undefined
  assert.equal(wh.verifyHandshakeToken('subscribe', undefined, undefined), false);
  assert.equal(wh.verifyHandshakeToken('subscribe', 'wrong', 'expected-token'), false);
  assert.equal(wh.verifyHandshakeToken('subscribe', 'expected-token', 'expected-token'), true);

  // Telegram webhook guard rejects wrong/missing secret & accepts valid secret
  const tgGuard = wh.createTelegramWebhookGuard({
    getSecret: () => 'tg-secret-123',
    isProduction: () => true,
  });
  let tgStatus = 200;
  let tgPassed = false;
  tgGuard(
    { headers: { 'x-telegram-bot-api-secret-token': 'wrong' } },
    { status: (c) => { tgStatus = c; return { json: () => { } }; } },
    () => { tgPassed = true; }
  );
  assert.equal(tgStatus, 401);
  assert.equal(tgPassed, false);

  tgGuard(
    { headers: { 'x-telegram-bot-api-secret-token': 'tg-secret-123' } },
    { status: (c) => { tgStatus = c; return { json: () => { } }; } },
    () => { tgPassed = true; }
  );
  assert.equal(tgPassed, true);

  // Meta webhook HMAC guard verifies sha256 signature and fails closed in production when unset
  const rawBody = Buffer.from(JSON.stringify({ object: 'page' }));
  const validSig = `sha256=${crypto.createHmac('sha256', 'meta-secret').update(rawBody).digest('hex')}`;
  const metaGuard = wh.createMetaWebhookGuard({
    getSecret: () => 'meta-secret',
    isProduction: () => true,
  });
  let metaPassed = false;
  metaGuard(
    { rawBody, headers: { 'x-hub-signature-256': validSig } },
    { status: () => ({ json: () => { } }) },
    () => { metaPassed = true; }
  );
  assert.equal(metaPassed, true);

  let prodUnsetStatus = 200;
  wh.createMetaWebhookGuard({ getSecret: () => '', isProduction: () => true })(
    { rawBody, headers: {} },
    { status: (c) => { prodUnsetStatus = c; return { json: () => { } }; } },
    () => { }
  );
  assert.equal(prodUnsetStatus, 403);
});

await check('Order.jsx routes new public checkout through createPublicOrder (no direct Firestore orders addDoc or client IGF sync)', async () => {
  const orderSrc = readFileSync(path.join(ROOT, 'src/components/Order/order.jsx'), 'utf8');
  assert.match(orderSrc, /createPublicOrder/);
  assert.equal(/addDoc\s*\(\s*collection\s*\(\s*db\s*,\s*['"]orders['"]/.test(orderSrc), false);
  assert.equal(/syncOrderRevenueToIGF/.test(orderSrc), false);
});

await check('TrackOrder.jsx routes public tracking through trackPublicOrder (no raw Firestore orders query)', async () => {
  const trackSrc = readFileSync(path.join(ROOT, 'src/components/TrackOrder/TrackOrder.jsx'), 'utf8');
  assert.match(trackSrc, /trackPublicOrder/);
  assert.equal(/collection\s*\(\s*db\s*,\s*['"]orders['"]/.test(trackSrc), false);
});

await check('authDomainPolicy, Login.jsx, and AuthContext.jsx allow Gmail/CTU & enforce email verification on signup', async () => {
  const policy = await import(`file:///${path.join(ROOT, 'src/utils/authDomainPolicy.js').replace(/\\/g, '/')}?t=${Date.now()}`);
  assert.equal(policy.isInstitutionalCtuEmail('juan.delacruz@ctu.edu.ph'), true);
  assert.equal(policy.isInstitutionalCtuEmail('STUDENT@CTU.EDU.PH'), true);
  assert.equal(policy.isInstitutionalCtuEmail('outsider@gmail.com'), false);
  assert.equal(policy.isInstitutionalCtuEmail('evil@ctu.edu.ph.attacker.com'), false);
  assert.equal(policy.validateStudentRegistrationEmail('student.demo@gmail.com').valid, true);
  assert.equal(policy.validateStudentRegistrationEmail('not-an-email').valid, false);

  const loginSrc = readFileSync(path.join(ROOT, 'src/components/Login/Login.jsx'), 'utf8');
  const authSrc = readFileSync(path.join(ROOT, 'src/components/AuthContext/AuthContext.jsx'), 'utf8');
  assert.match(loginSrc, /validateStudentRegistrationEmail/);
  assert.match(authSrc, /sendEmailVerification/);
  assert.match(authSrc, /isAllowedRegistrationEmail/);
  assert.equal(/permissions:\s*defaultPermissions/.test(authSrc), false);
});

console.log('\n=== Results Summary ===');
for (const r of results) console.log(r);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log(`\n✅ All ${results.length} Public Orders & Member RBAC checks passed!`);
}
