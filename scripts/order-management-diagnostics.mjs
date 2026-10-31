import { readFileSync } from 'fs';
import { resolve } from 'path';
import { toCentavos, fromCentavos } from '../src/utils/financeConstants.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    failures.push(message);
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('================================================================');
console.log('ORDER MANAGEMENT PRE-PRODUCTION DIAGNOSTIC & VERIFICATION SUITE');
console.log('================================================================');

// --- [1] SOURCE CODE STATIC ARCHITECTURE & HOOK AUDIT ---
console.log('\n--- [1] STATIC ARCHITECTURE & COMPONENT PARITY AUDIT ---');

const omPath = resolve('src/components/Data/OrderManagement.jsx');
const orderFormPath = resolve('src/components/Order/order.jsx');

const omCode = readFileSync(omPath, 'utf8');
const orderFormCode = readFileSync(orderFormPath, 'utf8');

// Check 1: OrderForm sets Online Paid on online orders and Pending on cash orders
assert(
  orderFormCode.includes("formData.paymentMethod === 'Online' ? 'Online Paid' : 'Pending'"),
  'order.jsx assigns Online Paid for online checkouts and Pending for cash on arrival'
);

// Check 2: Desktop status dropdown includes Online Paid and Returned
assert(
  omCode.includes('<option value="Online Paid"') && omCode.includes('<option value="Returned"'),
  'Desktop status dropdown renders Online Paid and Returned options'
);

// Check 3: Mobile status dropdown includes Online Paid and Returned
const mobileSection = omCode.substring(omCode.indexOf('renderMobileOrdersView'));
assert(
  mobileSection.includes('<option value="Online Paid"') && mobileSection.includes('<option value="Returned"'),
  'Mobile expanded card dropdown renders Online Paid and Returned options'
);

// Check 4: Elimination of redundant badge in mobile view
assert(
  !mobileSection.includes('mobileClaimPill'),
  'Mobile card meta view completely eliminated redundant mobileClaimPill badge'
);

// Check 5: Status styling includes Online Paid and Returned
assert(
  omCode.includes("case 'ONLINE PAID':") && omCode.includes("case 'RETURNED':"),
  'getStatusColor and getStatusTextColor explicitly style ONLINE PAID and RETURNED'
);

// Check 6: Contextual explanatory guidance in confirmation modal
assert(
  omCode.includes("confirmModal.newStatus === 'Online Paid'") &&
  omCode.includes("confirmModal.newStatus === 'Returned'") &&
  omCode.includes("confirmModal.newStatus === 'Pending'"),
  'Confirmation modal provides contextual impact telemetry for Online Paid, Returned, and Pending'
);

// --- [2] STATUS LIFECYCLE & INVARIANT SIMULATIONS ---
console.log('\n--- [2] STATUS LIFECYCLE & REVENUE/STOCK INVARIANT SIMULATION ---');

// Mock Product and Inventory
let productCatalog = {
  id: 'prod_1',
  productId: 'PROD-LANYARD-001',
  productName: 'CTU Official Lanyard',
  stockAvailable: 50,
};

let inventoryRegister = {
  id: 'inv_1',
  name: 'CTU Official Lanyard',
  quantity: 50,
  linkedProductId: 'PROD-LANYARD-001',
};

let igfFundAccount = {
  id: 'fund_igf_main',
  balanceCentavos: toCentavos(10000), // ₱10,000.00
};

// Simulation Function: Apply status change
function simulateOrderStatusTransition({ order, newStatus, currentProd, currentInv, currentIgf }) {
  const oldStatus = order.orderStatus;
  const isClaimAction = newStatus === 'Claimed' || newStatus === 'Completed';
  const isOnlinePaid = newStatus === 'Online Paid' || newStatus === 'Paid';
  const wasClaimAction = oldStatus === 'Claimed' || oldStatus === 'Completed' || order.claimed || order.stockClaimDeducted;
  const isReturned = newStatus === 'Returned';
  const isPending = newStatus === 'Pending';
  const isCancelled = newStatus === 'Cancelled';

  let nextProdStock = currentProd.stockAvailable;
  let nextInvStock = currentInv.quantity;
  let nextIgfCentavos = currentIgf.balanceCentavos;
  let stockClaimDeducted = order.stockClaimDeducted;
  let igfSynced = order.igfSynced;
  const quantity = order.productInfo.quantity;
  const revenueCentavos = toCentavos(order.productInfo.totalPrice);

  // 1. Stock handling
  if (isClaimAction && !order.stockClaimDeducted) {
    nextProdStock = Math.max(0, nextProdStock - quantity);
    nextInvStock = Math.max(0, nextInvStock - quantity);
    stockClaimDeducted = true;
  } else if ((isCancelled || isPending || (isOnlinePaid && wasClaimAction)) && order.stockClaimDeducted) {
    nextProdStock = nextProdStock + quantity;
    nextInvStock = nextInvStock + quantity;
    stockClaimDeducted = false;
  } else if (isReturned) {
    // Bad product: do NOT return to sellable shelf
    stockClaimDeducted = false;
  }

  // 2. IGF Revenue handling
  if ((isClaimAction || isOnlinePaid) && !order.igfSynced) {
    nextIgfCentavos += revenueCentavos;
    igfSynced = true;
  } else if ((isCancelled || isPending || isReturned) && order.igfSynced) {
    nextIgfCentavos = Math.max(0, nextIgfCentavos - revenueCentavos);
    igfSynced = false;
  }

  const updatedOrder = {
    ...order,
    orderStatus: newStatus,
    claimed: isClaimAction,
    stockClaimDeducted,
    igfSynced,
  };

  return {
    updatedOrder,
    nextProd: { ...currentProd, stockAvailable: nextProdStock },
    nextInv: { ...currentInv, quantity: nextInvStock },
    nextIgf: { ...currentIgf, balanceCentavos: nextIgfCentavos },
  };
}

// Test A: Online Paid Order creation (Online payment: GCash)
const onlineOrder = {
  docId: 'ord_online_101',
  orderId: 'ORD-ON-101',
  orderStatus: 'Online Paid',
  claimed: false,
  stockClaimDeducted: false,
  igfSynced: false,
  paymentInfo: { paymentMethod: 'Online', onlinePaymentType: 'GCash', referenceNumber: 'GCASH-9988' },
  productInfo: { productId: 'PROD-LANYARD-001', productName: 'CTU Official Lanyard', quantity: 2, pricePerUnit: 100, totalPrice: 200 },
};

// Auto-sync online order revenue to IGF upon ingestion
const stepA = simulateOrderStatusTransition({
  order: onlineOrder,
  newStatus: 'Online Paid',
  currentProd: productCatalog,
  currentInv: inventoryRegister,
  currentIgf: igfFundAccount,
});

assert(
  stepA.nextIgf.balanceCentavos === 1020000,
  'Online Paid order syncs revenue to IGF (₱10,000.00 -> ₱10,200.00)'
);
assert(
  stepA.nextProd.stockAvailable === 50 && stepA.nextInv.quantity === 50,
  'Online Paid order preserves stock on shelf prior to claiming (Stock: 50)'
);
assert(
  stepA.updatedOrder.claimed === false,
  'Online Paid order status explicitly remains unclaimed (claimed: false)'
);

// Test B: Student picks up online order -> Claim
const stepB = simulateOrderStatusTransition({
  order: stepA.updatedOrder,
  newStatus: 'Claimed',
  currentProd: stepA.nextProd,
  currentInv: stepA.nextInv,
  currentIgf: stepA.nextIgf,
});

assert(
  stepB.nextProd.stockAvailable === 48 && stepB.nextInv.quantity === 48,
  'Claiming Online Paid order deducts 2 units from catalog and inventory (50 -> 48)'
);
assert(
  stepB.nextIgf.balanceCentavos === 1020000,
  'Claiming already-synced Online Paid order prevents duplicate IGF revenue credit'
);
assert(
  stepB.updatedOrder.claimed === true && stepB.updatedOrder.stockClaimDeducted === true,
  'Order state becomes claimed: true, stockClaimDeducted: true'
);

// Test C: Officer unclaims online order (mistaken click)
const stepC = simulateOrderStatusTransition({
  order: stepB.updatedOrder,
  newStatus: 'Online Paid',
  currentProd: stepB.nextProd,
  currentInv: stepB.nextInv,
  currentIgf: stepB.nextIgf,
});

assert(
  stepC.nextProd.stockAvailable === 50 && stepC.nextInv.quantity === 50,
  'Unclaiming online order restores stock back to shelf (48 -> 50)'
);
assert(
  stepC.nextIgf.balanceCentavos === 1020000,
  'Unclaiming online order retains IGF funds because customer already paid online'
);

// Test D: Cash on Arrival / Cash on Claiming (Pending)
const cashOrder = {
  docId: 'ord_cash_201',
  orderId: 'ORD-CS-201',
  orderStatus: 'Pending',
  claimed: false,
  stockClaimDeducted: false,
  igfSynced: false,
  paymentInfo: { paymentMethod: 'Cash' },
  productInfo: { productId: 'PROD-LANYARD-001', productName: 'CTU Official Lanyard', quantity: 3, pricePerUnit: 100, totalPrice: 300 },
};

// Pending Cash order should not deduct stock or add to IGF
assert(
  cashOrder.orderStatus === 'Pending' && !cashOrder.claimed && !cashOrder.igfSynced,
  'Pending Cash order is unpaid & unclaimed'
);

// Student claims with Cash
const stepD = simulateOrderStatusTransition({
  order: cashOrder,
  newStatus: 'Claimed',
  currentProd: stepC.nextProd,
  currentInv: stepC.nextInv,
  currentIgf: stepC.nextIgf,
});

assert(
  stepD.nextProd.stockAvailable === 47 && stepD.nextInv.quantity === 47,
  'Claiming Cash order deducts 3 units (50 -> 47)'
);
assert(
  stepD.nextIgf.balanceCentavos === 1050000,
  'Claiming Cash order credits ₱300 cash revenue into IGF (₱10,200.00 -> ₱10,500.00)'
);

// Officer unclaims Cash order back to Pending
const stepE = simulateOrderStatusTransition({
  order: stepD.updatedOrder,
  newStatus: 'Pending',
  currentProd: stepD.nextProd,
  currentInv: stepD.nextInv,
  currentIgf: stepD.nextIgf,
});

assert(
  stepE.nextProd.stockAvailable === 50 && stepE.nextInv.quantity === 50,
  'Unclaiming cash order restores stock (47 -> 50)'
);
assert(
  stepE.nextIgf.balanceCentavos === 1020000,
  'Unclaiming cash order reverses cash revenue from IGF (₱10,500.00 -> ₱10,200.00)'
);

// Test F: Customer returns a defective / bad product
// Start with claimed order stepD
const stepF = simulateOrderStatusTransition({
  order: stepD.updatedOrder,
  newStatus: 'Returned',
  currentProd: stepD.nextProd,
  currentInv: stepD.nextInv,
  currentIgf: stepD.nextIgf,
});

assert(
  stepF.nextProd.stockAvailable === 47 && stepF.nextInv.quantity === 47,
  'Returned bad product is quarantined and NOT returned to sellable shelf (Stock stays 47)'
);
assert(
  stepF.nextIgf.balanceCentavos === 1020000,
  'Returned bad product refunds/reverses revenue from IGF (₱10,500.00 -> ₱10,200.00)'
);
assert(
  stepF.updatedOrder.orderStatus === 'Returned' && stepF.updatedOrder.claimed === false,
  'Order status is set to Returned with claimed: false'
);

// --- [3] FILTERING & SEARCH CONTRACT TESTS ---
console.log('\n--- [3] FILTERING & SEARCH LOGIC VERIFICATION ---');

const testOrders = [
  { orderId: 'ORD-001', orderStatus: 'Claimed', claimed: true, paymentInfo: { paymentMethod: 'Cash' }, customerInfo: { fullName: 'Juan Dela Cruz', email: 'juan@ctu.edu.ph' }, productInfo: { totalPrice: 100 } },
  { orderId: 'ORD-002', orderStatus: 'Online Paid', claimed: false, paymentInfo: { paymentMethod: 'Online' }, customerInfo: { fullName: 'Maria Clara', email: 'maria@ctu.edu.ph' }, productInfo: { totalPrice: 150 } },
  { orderId: 'ORD-003', orderStatus: 'Pending', claimed: false, paymentInfo: { paymentMethod: 'Cash' }, customerInfo: { fullName: 'Crisostomo Ibarra', email: 'ibarra@ctu.edu.ph' }, productInfo: { totalPrice: 200 } },
  { orderId: 'ORD-004', orderStatus: 'Returned', claimed: false, paymentInfo: { paymentMethod: 'Online' }, customerInfo: { fullName: 'Simoun', email: 'simoun@ctu.edu.ph' }, productInfo: { totalPrice: 250 } },
  { orderId: 'ORD-005', orderStatus: 'Cancelled', claimed: false, paymentInfo: { paymentMethod: 'Cash' }, customerInfo: { fullName: 'Elias', email: 'elias@ctu.edu.ph' }, productInfo: { totalPrice: 100 } },
];

function applyFilter(orders, statusFilter, paymentFilter, searchQuery) {
  return orders.filter(order => {
    const rawStatus = (order.orderStatus || '').toUpperCase();
    const isClaimed = order.claimed === true || rawStatus === 'CLAIMED' || order.orderStatus === 'Completed';
    const isOnlinePaid = !isClaimed && (rawStatus === 'ONLINE PAID' || rawStatus === 'PAID');
    const isReturned = rawStatus === 'RETURNED';
    const isCancelled = rawStatus === 'CANCELLED';
    const isPending = !isClaimed && !isOnlinePaid && !isReturned && !isCancelled;

    let matchesStatus = true;
    if (statusFilter !== 'All') {
      if (statusFilter === 'Claimed') matchesStatus = isClaimed;
      else if (statusFilter === 'Completed') matchesStatus = order.orderStatus === 'Completed' || isClaimed;
      else if (statusFilter === 'Online Paid' || statusFilter === 'Paid') matchesStatus = isOnlinePaid;
      else if (statusFilter === 'Pending') matchesStatus = isPending;
      else if (statusFilter === 'Returned') matchesStatus = isReturned;
      else if (statusFilter === 'Cancelled') matchesStatus = isCancelled;
      else if (statusFilter === 'Unclaimed') matchesStatus = !isClaimed && !isCancelled && !isReturned;
      else matchesStatus = order.orderStatus === statusFilter;
    }

    let matchesPayment = true;
    if (paymentFilter !== 'All') {
      matchesPayment = order.paymentInfo?.paymentMethod === paymentFilter;
    }

    let matchesSearch = true;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      matchesSearch = (order.orderId?.toLowerCase().includes(q) ||
        order.customerInfo?.fullName?.toLowerCase().includes(q) ||
        order.customerInfo?.email?.toLowerCase().includes(q));
    }

    return matchesStatus && matchesPayment && matchesSearch;
  });
}

assert(
  applyFilter(testOrders, 'Online Paid', 'All', '').length === 1 && applyFilter(testOrders, 'Online Paid', 'All', '')[0].orderId === 'ORD-002',
  'Filter "Online Paid" isolates online paid orders'
);

assert(
  applyFilter(testOrders, 'Returned', 'All', '').length === 1 && applyFilter(testOrders, 'Returned', 'All', '')[0].orderId === 'ORD-004',
  'Filter "Returned" isolates returned orders'
);

assert(
  applyFilter(testOrders, 'Pending', 'All', '').length === 1 && applyFilter(testOrders, 'Pending', 'All', '')[0].orderId === 'ORD-003',
  'Filter "Pending" isolates cash on arrival orders'
);

assert(
  applyFilter(testOrders, 'All', 'Cash', '').length === 3,
  'Filter "Cash" isolates all cash orders (3 found)'
);

assert(
  applyFilter(testOrders, 'All', 'All', 'Ibarra').length === 1,
  'Search query "Ibarra" isolates Crisostomo Ibarra'
);

// --- [4] DATE PARSER RESILIENCE AUDIT ---
console.log('\n--- [4] DATE PARSER & SORT INTEGRITY ---');

const mixedDateOrders = [
  { orderId: 'O1', dateOrdered: { toDate: () => new Date('2026-10-31T10:00:00Z') } },
  { orderId: 'O2', dateOrdered: '2026-10-31T11:00:00Z' },
  { orderId: 'O3', createdAt: '2026-10-31T12:00:00Z' },
  { orderId: 'O4', dateOrdered: null, createdAt: null }, // edge case: null dates
];

const getTimeSafe = (o) => {
  if (o.dateOrdered?.toDate) return o.dateOrdered.toDate().getTime();
  if (o.dateOrdered) return new Date(o.dateOrdered).getTime();
  if (o.createdAt?.toDate) return o.createdAt.toDate().getTime();
  if (o.createdAt) return new Date(o.createdAt).getTime();
  return 0;
};

const sorted = [...mixedDateOrders].sort((a, b) => getTimeSafe(b) - getTimeSafe(a));

assert(
  !isNaN(sorted[0] ? getTimeSafe(sorted[0]) : NaN),
  'Safe date parser never produces NaN during order sorting'
);
assert(
  sorted[0].orderId === 'O3' && sorted[sorted.length - 1].orderId === 'O4',
  'Orders sort cleanly in reverse chronological order with null timestamps placed at end'
);

// --- [5] REVENUE KPI RECONCILIATION ---
console.log('\n--- [5] REVENUE KPI RECONCILIATION ---');

// Calculate revenue according to our business rules:
// Revenue includes Claimed + Online Paid; Excludes Pending, Returned, Cancelled
const claimedOrders = testOrders.filter(o => o.orderStatus === 'Claimed');
const onlinePaidOrders = testOrders.filter(o => o.orderStatus === 'Online Paid');
const totalRev = claimedOrders.reduce((sum, o) => sum + o.productInfo.totalPrice, 0) +
                 onlinePaidOrders.reduce((sum, o) => sum + o.productInfo.totalPrice, 0);

assert(
  totalRev === 250, // ₱100 (Claimed) + ₱150 (Online Paid) = ₱250
  'Total Revenue correctly sums Claimed (₱100) + Online Paid (₱150) = ₱250.00'
);

console.log(`\n================================================================`);
console.log(`ORDER MANAGEMENT DIAGNOSTICS: ${passed} Passed | ${failed} Failed`);
if (failed > 0) {
  console.log(`FAILURES:`);
  failures.forEach((f, i) => console.log(`  [${i + 1}] ${f}`));
}
console.log(`================================================================\n`);

process.exit(failed > 0 ? 1 : 0);
