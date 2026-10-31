import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBPxd8ag3HyPM6qywsDdpM-cgCXCdjWBVo",
  authDomain: "ssg-prototype.firebaseapp.com",
  projectId: "ssg-prototype",
  storageBucket: "ssg-prototype.firebasestorage.app",
  messagingSenderId: "661854012909",
  appId: "1:661854012909:web:1fd13f3d5cc29260e7d3e4",
  measurementId: "G-BD6BHD6F0J"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const issues = [];
const warnings = [];
const stats = {
  fundAccountsCount: 0,
  allocationsCount: 0,
  activeAllocationsCount: 0,
  archivedAllocationsCount: 0,
  transactionsCount: 0,
  ordersCount: 0,
  igfSyncedOrdersCount: 0,
};

function logIssue(category, id, message) {
  issues.push({ category, id, message });
  console.error(`  [ISSUE] [${category}] ${id ? `(${id}) ` : ''}${message}`);
}

function logWarning(category, id, message) {
  warnings.push({ category, id, message });
  console.warn(`  [WARN] [${category}] ${id ? `(${id}) ` : ''}${message}`);
}

async function auditFinanceDatabase() {
  console.log('================================================================');
  console.log('FIRESTORE FINANCE & DATABASE INTEGRITY DEEP AUDIT');
  console.log('================================================================\n');

  // 1. AUDIT FUND ACCOUNTS
  console.log('--- 1. AUDITING FUND ACCOUNTS (`fundAccounts`) ---');
  const fundAccountsSnap = await getDocs(collection(db, 'fundAccounts'));
  stats.fundAccountsCount = fundAccountsSnap.size;
  console.log(`Found ${stats.fundAccountsCount} fund accounts.`);

  const accountIds = new Set();
  const balancesByAccount = {};

  for (const docSnap of fundAccountsSnap.docs) {
    const data = docSnap.data();
    const id = docSnap.id;
    accountIds.add(id);
    balancesByAccount[id] = data.balanceCentavos || 0;

    // Check integer centavos
    if (data.balanceCentavos !== undefined) {
      if (!Number.isInteger(data.balanceCentavos)) {
        logIssue('fundAccounts', id, `balanceCentavos is floating point: ${data.balanceCentavos}`);
      }
      if (data.balanceCentavos < 0) {
        logWarning('fundAccounts', id, `Account has negative balance: ₱${(data.balanceCentavos / 100).toFixed(2)}`);
      }
    }

    if (data.appropriatedCeilingCentavos !== undefined) {
      if (!Number.isInteger(data.appropriatedCeilingCentavos)) {
        logIssue('fundAccounts', id, `appropriatedCeilingCentavos is floating point: ${data.appropriatedCeilingCentavos}`);
      }
    }

    console.log(`  • Account: [${id}] "${data.displayName || data.subcategory || 'Unnamed'}" | Balance: ₱${((data.balanceCentavos || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
  }

  // 2. AUDIT BUDGET ALLOCATIONS
  console.log('\n--- 2. AUDITING BUDGET ALLOCATIONS (`budgetAllocations`) ---');
  const allocSnap = await getDocs(collection(db, 'budgetAllocations'));
  stats.allocationsCount = allocSnap.size;
  console.log(`Found ${stats.allocationsCount} budget allocations.`);

  const allocationMap = new Map();
  let totalAllocatedCentavos = 0;
  let totalSpentCentavos = 0;

  for (const docSnap of allocSnap.docs) {
    const data = docSnap.data();
    const id = docSnap.id;
    allocationMap.set(id, data);

    const isArchived = data.status === 'archived' || data.isActive === false;
    if (isArchived) stats.archivedAllocationsCount++;
    else stats.activeAllocationsCount++;

    // Integer checks
    const approved = data.approvedAmountCentavos !== undefined ? data.approvedAmountCentavos : (data.allocatedAmount !== undefined ? Math.round(data.allocatedAmount * 100) : 0);
    const spent = data.spentAmountCentavos !== undefined ? data.spentAmountCentavos : (data.spentAmount !== undefined ? Math.round(data.spentAmount * 100) : 0);

    if (!Number.isInteger(approved)) {
      logIssue('budgetAllocations', id, `approvedAmountCentavos is not an integer: ${approved}`);
    }
    if (!Number.isInteger(spent)) {
      logIssue('budgetAllocations', id, `spentAmountCentavos is not an integer: ${spent}`);
    }

    if (!isArchived) {
      totalAllocatedCentavos += approved;
      totalSpentCentavos += spent;
    }

    // Check account link
    if (data.fundAccountId && !accountIds.has(data.fundAccountId)) {
      logWarning('budgetAllocations', id, `References non-existent fundAccountId: "${data.fundAccountId}"`);
    }

    // Check line items if present
    if (Array.isArray(data.approvedLineItems) && data.approvedLineItems.length > 0) {
      let lineItemPlannedSum = 0;
      let lineItemSpentSum = 0;

      data.approvedLineItems.forEach((li, idx) => {
        const liPlanned = li.plannedCentavos !== undefined ? li.plannedCentavos : Math.round((li.plannedAmount || li.estimatedCost || 0) * 100);
        const liSpent = li.spentCentavos !== undefined ? li.spentCentavos : Math.round((li.spentAmount || 0) * 100);
        lineItemPlannedSum += liPlanned;
        lineItemSpentSum += liSpent;
      });

      // Verification of cost breakdown integrity
      if (lineItemSpentSum > 0 && Math.abs(lineItemSpentSum - spent) > 100) {
        logWarning('budgetAllocations', id, `Line item expenses sum (₱${(lineItemSpentSum / 100).toFixed(2)}) differs from parent spent (₱${(spent / 100).toFixed(2)})`);
      }
    }
  }

  console.log(`  • Active Allocations: ${stats.activeAllocationsCount}`);
  console.log(`  • Archived Allocations: ${stats.archivedAllocationsCount}`);
  console.log(`  • Total Active Approved Capital: ₱${(totalAllocatedCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
  console.log(`  • Total Active Recorded Spent: ₱${(totalSpentCentavos / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);

  // 3. AUDIT TRANSACTIONS
  console.log('\n--- 3. AUDITING TRANSACTIONS (`transactions`) ---');
  const txSnap = await getDocs(collection(db, 'transactions'));
  stats.transactionsCount = txSnap.size;
  console.log(`Found ${stats.transactionsCount} financial transactions.`);

  const txByAllocation = {};
  const duplicateRefNumbers = new Map();
  const txByRef = new Map();

  for (const docSnap of txSnap.docs) {
    const data = docSnap.data();
    const id = docSnap.id;

    if (!Number.isInteger(data.amountCentavos)) {
      logIssue('transactions', id, `amountCentavos is not an integer: ${data.amountCentavos}`);
    }
    if (!data.amountCentavos || data.amountCentavos <= 0) {
      logWarning('transactions', id, `Zero or negative transaction amount: ${data.amountCentavos}`);
    }

    // Reference number check
    if (data.refNumber) {
      if (txByRef.has(data.refNumber)) {
        logIssue('transactions', id, `Duplicate transaction reference number: "${data.refNumber}" (Already used by ${txByRef.get(data.refNumber)})`);
      } else {
        txByRef.set(data.refNumber, id);
      }
    }

    // Allocation link check
    const allocId = data.budgetAllocationId || data.allocationId;
    if (allocId) {
      if (!allocationMap.has(allocId)) {
        logWarning('transactions', id, `References orphaned/missing budget allocation ID: "${allocId}"`);
      } else {
        txByAllocation[allocId] = (txByAllocation[allocId] || 0) + (data.amountCentavos || 0);
      }
    }
  }

  // 4. AUDIT COMMERCE HUB ORDERS TO IGF LEDGER INTEGRITY
  console.log('\n--- 4. AUDITING COMMERCE HUB ORDERS & IGF LINKAGE ---');
  const ordersSnap = await getDocs(collection(db, 'orders'));
  stats.ordersCount = ordersSnap.size;
  console.log(`Found ${stats.ordersCount} total merchandise orders.`);

  let claimedCount = 0;
  let onlinePaidCount = 0;
  let pendingCount = 0;
  let returnedCount = 0;
  let totalOrderRevenue = 0;
  const duplicateOrderTxRefs = new Map();

  for (const docSnap of ordersSnap.docs) {
    const data = docSnap.data();
    const id = docSnap.id;
    const status = data.orderStatus || 'Pending';
    const isClaimed = data.claimed === true || status === 'Claimed' || status === 'Completed';
    const isOnlinePaid = !isClaimed && (status === 'Online Paid' || status === 'Paid');
    const isReturned = status === 'Returned';
    const isPending = !isClaimed && !isOnlinePaid && !isReturned && status !== 'Cancelled';

    if (isClaimed) claimedCount++;
    else if (isOnlinePaid) onlinePaidCount++;
    else if (isReturned) returnedCount++;
    else if (isPending) pendingCount++;

    const price = Number(data.productInfo?.totalPrice || data.totalPrice || 0);
    if (isClaimed || isOnlinePaid) {
      totalOrderRevenue += price;
    }

    if (data.igfSynced) {
      stats.igfSyncedOrdersCount++;
      if (data.igfTxRef) {
        if (duplicateOrderTxRefs.has(data.igfTxRef)) {
          logIssue('orders', id, `Duplicate IGF transaction reference on order: "${data.igfTxRef}"`);
        } else {
          duplicateOrderTxRefs.set(data.igfTxRef, id);
        }
      }
    }
  }

  console.log(`  • Claimed / Completed: ${claimedCount}`);
  console.log(`  • Online Paid (Unclaimed): ${onlinePaidCount}`);
  console.log(`  • Pending (Cash on Arrival): ${pendingCount}`);
  console.log(`  • Returned (Defective Product): ${returnedCount}`);
  console.log(`  • Orders synced to IGF: ${stats.igfSyncedOrdersCount}`);
  console.log(`  • Total Merchandise Revenue: ₱${totalOrderRevenue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);

  // FINAL RECONCILIATION SUMMARY
  console.log('\n================================================================');
  console.log('AUDIT SUMMARY VERDICT');
  console.log('================================================================');
  console.log(`  • Critical Issues Found: ${issues.length}`);
  console.log(`  • Non-Blocking Warnings: ${warnings.length}`);
  
  if (issues.length === 0) {
    console.log('\n✅ ALL DATABASE INTEGRITY CHECKS PASSED WITH 0 CRITICAL BUGS.');
  } else {
    console.log('\n❌ CRITICAL ISSUES DETECTED:');
    issues.forEach((iss, i) => console.log(`  [${i + 1}] [${iss.category}] ${iss.id ? iss.id + ': ' : ''}${iss.message}`));
  }

  process.exit(issues.length > 0 ? 1 : 0);
}

auditFinanceDatabase().catch(err => {
  console.error('Audit failed with runtime exception:', err);
  process.exit(1);
});
