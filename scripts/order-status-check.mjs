/**
 * Verifies Order Status Transition behavior in OrderManagement (B-01 TDD).
 *
 *   node scripts/order-status-check.mjs
 */
import {
  executeOrderStatusUpdate,
  normalizeOrderStatusUpper,
  computeOrderStatistics,
} from '../src/components/Data/orderStatusTransition.js';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
  }
};

function createTestHarness() {
  const toasts = [];
  const stockCalls = [];
  const igfSyncCalls = [];
  const igfReverseCalls = [];
  const auditCalls = [];
  const firestoreUpdates = [];

  const deps = {
    currentUser: { uid: 'officer-1', displayName: 'Commerce Officer' },
    userName: 'Commerce Officer',
    showToast: (message, type) => toasts.push({ message, type }),
    syncOrderStockDeduction: async (payload) => {
      stockCalls.push(payload);
      return { success: true };
    },
    auditService: {
      logInventoryUpdate: async (...args) => auditCalls.push(args),
    },
    financeService: {
      syncOrderRevenueToIGF: async (payload) => {
        igfSyncCalls.push(payload);
        return { refNumber: 'IGF-TX-001' };
      },
      reverseOrderRevenueFromIGF: async (payload) => {
        igfReverseCalls.push(payload);
        return { reversed: true };
      },
    },
    updateOrderDoc: async (docId, fields) => {
      firestoreUpdates.push({ docId, fields });
    },
  };

  return {
    deps,
    toasts,
    stockCalls,
    igfSyncCalls,
    igfReverseCalls,
    auditCalls,
    firestoreUpdates,
  };
}

console.log('=== Slice 1: Claiming a Pending Cash order (not yet in IGF) ===');
{
  const h = createTestHarness();
  const cashOrder = {
    orderId: 'ORD-DB-0001',
    orderStatus: 'Pending',
    claimed: false,
    stockClaimDeducted: false,
    igfSynced: false,
    paymentInfo: { paymentMethod: 'Cash' },
    productInfo: { productName: 'CTU Lanyard', quantity: 1, totalPrice: 150 },
  };

  await executeOrderStatusUpdate({
    docId: 'doc-cash-1',
    newStatus: 'Claimed',
    order: cashOrder,
    deps: h.deps,
  });

  const finalToast = h.toasts[h.toasts.length - 1];
  check(
    'claiming a Pending Cash order succeeds with Paid & Claimed message (no ReferenceError)',
    finalToast?.type === 'success' &&
      finalToast?.message ===
        'Order #ORD-DB-0001 status updated to Claimed (Paid & Claimed: stock deducted & IGF synced).',
    JSON.stringify(finalToast)
  );
  check('deducts stock once on claim', h.stockCalls.length === 1 && h.stockCalls[0].deduct === true);
  check('syncs revenue to IGF once on cash claim', h.igfSyncCalls.length === 1);
  check(
    'persists claimed status and igfSynced=true to Firestore',
    h.firestoreUpdates.length === 1 &&
      h.firestoreUpdates[0].fields.orderStatus === 'Claimed' &&
      h.firestoreUpdates[0].fields.claimed === true &&
      h.firestoreUpdates[0].fields.igfSynced === true
  );
}

console.log('\n=== Slice 2: Claiming an Online Paid order (prevent duplicate IGF sync) ===');
{
  const h = createTestHarness();
  const onlineOrder = {
    orderId: 'ORD-DB-0002',
    orderStatus: 'Online Paid',
    claimed: false,
    stockClaimDeducted: false,
    // Even if igfSynced flag was not yet set on the order object, Online Paid means payment was collected online
    igfSynced: false,
    paymentInfo: { paymentMethod: 'Online' },
    productInfo: { productName: 'SSG Shirt', quantity: 2, totalPrice: 500 },
  };

  await executeOrderStatusUpdate({
    docId: 'doc-online-2',
    newStatus: 'Claimed',
    order: onlineOrder,
    deps: h.deps,
  });

  const finalToast = h.toasts[h.toasts.length - 1];
  check(
    'claiming an Online Paid order emits Completed message noting IGF was already recorded upon online payment',
    finalToast?.type === 'success' &&
      finalToast?.message ===
        'Order #ORD-DB-0002 status updated to Claimed (Completed: stock decreased; IGF already recorded upon online payment).',
    JSON.stringify(finalToast)
  );
  check('deducts stock once when claiming Online Paid order', h.stockCalls.length === 1 && h.stockCalls[0].deduct === true);
  check(
    'does NOT re-credit IGF when claiming an order that was already Online Paid',
    h.igfSyncCalls.length === 0,
    `Expected 0 IGF sync calls, got ${h.igfSyncCalls.length}`
  );
}

console.log('\n=== Slice 3: Transitioning an Order to Online Paid (records into IGF immediately) ===');
{
  const h = createTestHarness();
  const pendingToOnlineOrder = {
    orderId: 'ORD-DB-0003',
    orderStatus: 'Pending',
    claimed: false,
    stockClaimDeducted: false,
    igfSynced: false,
    paymentInfo: {
      paymentMethod: 'Online',
      onlinePaymentType: 'GCash',
      referenceNumber: '902184729182',
    },
    productInfo: { productName: 'CTU Pin', quantity: 1, totalPrice: 75 },
  };

  await executeOrderStatusUpdate({
    docId: 'doc-online-3',
    newStatus: 'Online Paid',
    order: pendingToOnlineOrder,
    deps: h.deps,
  });

  const finalToast = h.toasts[h.toasts.length - 1];
  check(
    'setting status to Online Paid emits Paid Online awaiting pickup message',
    finalToast?.type === 'success' &&
      finalToast?.message ===
        'Order #ORD-DB-0003 status updated to Online Paid (Paid Online: proceeds in IGF, awaiting pickup).',
    JSON.stringify(finalToast)
  );
  check('records online payment proceeds into IGF immediately', h.igfSyncCalls.length === 1);
  check('does not deduct physical stock until student claims the item', h.stockCalls.length === 0);
}

console.log('\n=== Slice 4: Claiming via Completed status for Cash via SSG Officer ===');
{
  const h = createTestHarness();
  const cashCompletedOrder = {
    orderId: 'ORD-DB-0004',
    orderStatus: 'Pending',
    claimed: false,
    stockClaimDeducted: false,
    igfSynced: false,
    paymentInfo: { paymentMethod: 'Cash' },
    productInfo: { productName: 'PE Uniform', quantity: 1, totalPrice: 450 },
  };

  await executeOrderStatusUpdate({
    docId: 'doc-cash-4',
    newStatus: 'Completed',
    order: cashCompletedOrder,
    deps: h.deps,
  });

  const finalToast = h.toasts[h.toasts.length - 1];
  check(
    'completing a Cash order records revenue into IGF and deducts stock',
    finalToast?.type === 'success' &&
      finalToast?.message ===
        'Order #ORD-DB-0004 status updated to Completed (Paid & Claimed: stock deducted & IGF synced).' &&
      h.igfSyncCalls.length === 1 &&
      h.stockCalls.length === 1,
    JSON.stringify({ finalToast, igfSyncs: h.igfSyncCalls.length, stockCalls: h.stockCalls.length })
  );
  check(
    'Suggestion 1: claiming via status dropdown records claimedBy (SSG officer) and claimedAt on the order',
    h.firestoreUpdates.length === 1 &&
      h.firestoreUpdates[0].fields.claimedBy === 'Commerce Officer' &&
      typeof h.firestoreUpdates[0].fields.claimedAt === 'string',
    JSON.stringify(h.firestoreUpdates[0]?.fields)
  );
}

console.log('\n=== Slice 5: Non-string orderStatus values (boolean/number/object/null) do not crash getStatistics ===');
{
  const malformedOrders = [
    { orderId: 'ORD-1', orderStatus: true, claimed: true, productInfo: { totalPrice: 100 } },
    { orderId: 'ORD-2', orderStatus: 123, claimed: false, productInfo: { totalPrice: 200 } },
    { orderId: 'ORD-3', orderStatus: { status: 'Pending' }, claimed: false, productInfo: { totalPrice: 150 } },
    { orderId: 'ORD-4', orderStatus: 'Online Paid', claimed: false, productInfo: { totalPrice: 300 } },
    { orderId: 'ORD-5', orderStatus: 'claimed', claimed: false, productInfo: { totalPrice: 250 } },
    { orderId: 'ORD-6', orderStatus: null, claimed: false, productInfo: { totalPrice: 50 } },
  ];

  let stats = null;
  let threwError = null;
  try {
    stats = computeOrderStatistics(malformedOrders);
  } catch (err) {
    threwError = err;
  }

  check(
    'computeOrderStatistics does not throw TypeError when orderStatus is boolean, number, object, or null',
    threwError === null && stats !== null,
    threwError ? threwError.stack : ''
  );
  check(
    'counts claimed, onlinePaid, and totalRevenue accurately across mixed/malformed statuses',
    stats?.total === 6 &&
      stats?.claimed === 2 &&
      stats?.onlinePaid === 1 &&
      stats?.totalRevenue === 650,
    JSON.stringify(stats)
  );
  check(
    'normalizeOrderStatusUpper safely coerces non-strings without throwing',
    normalizeOrderStatusUpper(true) === 'TRUE' &&
      normalizeOrderStatusUpper(null) === '' &&
      normalizeOrderStatusUpper({ a: 1 }) === '' &&
      normalizeOrderStatusUpper('claimed') === 'CLAIMED'
  );
}

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nAll order status checks passed.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);
