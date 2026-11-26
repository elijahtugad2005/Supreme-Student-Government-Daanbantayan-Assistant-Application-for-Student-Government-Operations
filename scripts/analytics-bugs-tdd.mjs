/**
 * TDD Regression Suite: Analytics & Financial Telemetry Bug Fixes
 *
 * Covers:
 *  Slice 1: FinanceProvider KPIs (draft + IGF/IGP exclusion from Fiscal) & FundClassifier
 *  Slice 2: BudgetAnalytics status filter/badges, real IGP/IGF charts, dynamic committees, null-safe search, CSV
 *  Slice 3: PPMPMatrix fund-scoped statusCounts & archived-KPI isolation + IgpProjectManager legacy amountPHP
 *  Slice 4: orderStatusTransition unclaimedOrders accuracy & Returned stockClaimDeducted preservation
 *
 * Run: npm run test:analytics
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let failed = 0;
const results = [];
const check = (label, ok, detail = '') => {
  if (ok) {
    results.push(`ok   ${label}`);
  } else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

// ════════════════════════════════════════════════════════════════════════════
// SLICE 1: FinanceProvider KPIs & FundClassifier Distributions
// ════════════════════════════════════════════════════════════════════════════
console.log('=== Slice 1: FinanceProvider KPIs & FundClassifier ===');

const helpersPath = path.join(ROOT, 'src/utils/budgetAnalyticsHelpers.js');
check(
  'src/utils/budgetAnalyticsHelpers.js exists',
  fs.existsSync(helpersPath),
  'Missing src/utils/budgetAnalyticsHelpers.js'
);

const fundClassifier = await import(
  `file:///${path.join(ROOT, 'src/utils/fundClassifier.js').replace(/\\/g, '/')}?t=${Date.now()}`
);

const zeroIgp = fundClassifier.DEFAULT_ENTERPRISE_DISTRIBUTIONS.IGP(0);
const zeroIgf = fundClassifier.DEFAULT_ENTERPRISE_DISTRIBUTIONS.IGF(0);
check(
  'DEFAULT_ENTERPRISE_DISTRIBUTIONS.IGP(0) does NOT fabricate fake ₱1 pie slices',
  zeroIgp.every((d) => d.value === 0),
  JSON.stringify(zeroIgp)
);
check(
  'DEFAULT_ENTERPRISE_DISTRIBUTIONS.IGF(0) does NOT fabricate fake ₱1 pie slices',
  zeroIgf.every((d) => d.value === 0),
  JSON.stringify(zeroIgf)
);

if (fs.existsSync(helpersPath)) {
  const h = await import(`file:///${helpersPath.replace(/\\/g, '/')}?t=${Date.now()}`);

  const budgetsFixture = [
    {
      id: 'b-fiscal',
      eventName: 'Intramurals',
      allocated: 10000,
      spent: 4000,
      status: 'approved',
      fundAccountId: 'fund_fiscal_year_budget',
      fundCategory: 'FISCAL_YEAR_BUDGET',
      isFSG: false,
      category: 'Event',
      committee: 'Sports',
    },
    {
      id: 'b-draft',
      eventName: 'Draft Proposal',
      allocated: 50000,
      spent: 0,
      status: 'draft',
      fundAccountId: 'fund_fiscal_year_budget',
      fundCategory: 'FISCAL_YEAR_BUDGET',
      isFSG: false,
      category: 'Event',
      committee: 'General',
    },
    {
      id: 'b-fsg',
      eventName: 'FSG Seminar',
      allocated: 5000,
      spent: 1000,
      status: 'approved',
      fundAccountId: 'fund_fsg_remittance',
      fundCategory: 'FSG_REMITTANCE',
      isFSG: true,
      category: 'Event',
      committee: 'Executive Board',
    },
    {
      id: 'b-igf',
      eventName: 'Merchandise Batch',
      allocated: 8000,
      spent: 2000,
      status: 'approved',
      fundAccountId: 'fund_igf_main',
      fundCategory: 'IGF',
      isFSG: false,
      category: 'Merchandise',
      committee: 'Finance Committee',
    },
    {
      id: 'b-igp',
      eventName: 'Vending Restock',
      allocated: 3000,
      spent: 500,
      status: 'approved',
      fundAccountId: 'fund_igp_main',
      fundCategory: 'IGP',
      isFSG: false,
      category: 'Project',
      committee: 'IGP Team',
    },
  ];

  const stats = h.computeBudgetStatistics(budgetsFixture, {
    fiscalCeiling: 30000,
    fiscalHolding: 26000,
    igfBalance: 12000,
    igpBalance: 7500,
  });

  check(
    'computeBudgetStatistics excludes draft budgets from totalAllocated & fiscalAllocated',
    stats.fiscalAllocated === 10000 && stats.fiscalSpent === 4000,
    JSON.stringify({ fiscalAllocated: stats.fiscalAllocated, fiscalSpent: stats.fiscalSpent })
  );
  check(
    'computeBudgetStatistics excludes IGF & IGP budgets from fiscalAllocated and fiscalUnallocatedReserve',
    stats.fiscalAllocated === 10000 && stats.fiscalUnallocatedReserve === 20000,
    JSON.stringify({ fiscalAllocated: stats.fiscalAllocated, reserve: stats.fiscalUnallocatedReserve })
  );
  check(
    'computeBudgetStatistics tracks FSG separately (5000 alloc, 1000 spent) and totalAllocated across approved budgets (26000)',
    stats.fsgAllocated === 5000 &&
      stats.fsgSpent === 1000 &&
      stats.totalAllocated === 26000 &&
      stats.totalSpent === 7500 &&
      stats.budgetCount === 4,
    JSON.stringify(stats)
  );
}

const fpSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/FinanceContext/FinanceProvider.jsx'),
  'utf8'
);
check(
  'FinanceProvider.jsx delegates KPI computation to computeBudgetStatistics',
  fpSrc.includes('computeBudgetStatistics'),
  'FinanceProvider.jsx still computes fiscalAllocated inline with else-branch leak'
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 2: BudgetAnalytics Status Filter/Badges, Real Enterprise Charts,
//          Dynamic Committees, Null-Safe Search & Safe CSV Export
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 2: BudgetAnalytics Status, Real Enterprise Charts & CSV ===');

const h2 = await import(`file:///${helpersPath.replace(/\\/g, '/')}?t=${Date.now()}`);

check(
  'budgetAnalyticsHelpers exports Slice 2 functions',
  typeof h2.deriveBudgetHealthStatus === 'function' &&
    typeof h2.filterAnalyticsBudgets === 'function' &&
    typeof h2.extractUniqueCommittees === 'function' &&
    typeof h2.buildBudgetCsvContent === 'function' &&
    typeof h2.buildCsvFilename === 'function' &&
    typeof h2.buildIgpEnterpriseChartData === 'function' &&
    typeof h2.buildIgfEnterpriseChartData === 'function',
  'Missing one or more Slice 2 helper exports'
);

if (typeof h2.deriveBudgetHealthStatus === 'function') {
  check(
    'deriveBudgetHealthStatus maps allocated/spent/status to On Track / Almost Spent / Fully Spent / Over Budget / Draft',
    h2.deriveBudgetHealthStatus({ allocated: 1000, spent: 200, status: 'approved' }) === 'On Track' &&
      h2.deriveBudgetHealthStatus({ allocated: 1000, spent: 850, status: 'approved' }) === 'Almost Spent' &&
      h2.deriveBudgetHealthStatus({ allocated: 1000, spent: 1000, status: 'approved' }) === 'Fully Spent' &&
      h2.deriveBudgetHealthStatus({ allocated: 1000, spent: 1200, status: 'approved' }) === 'Over Budget' &&
      h2.deriveBudgetHealthStatus({ allocated: 1000, spent: 0, status: 'draft' }) === 'Draft',
    JSON.stringify({
      onTrack: h2.deriveBudgetHealthStatus({ allocated: 1000, spent: 200, status: 'approved' }),
      almost: h2.deriveBudgetHealthStatus({ allocated: 1000, spent: 850, status: 'approved' }),
      full: h2.deriveBudgetHealthStatus({ allocated: 1000, spent: 1000, status: 'approved' }),
      over: h2.deriveBudgetHealthStatus({ allocated: 1000, spent: 1200, status: 'approved' }),
      draft: h2.deriveBudgetHealthStatus({ allocated: 1000, spent: 0, status: 'draft' }),
    })
  );

  const mixedRows = [
    { id: '1', eventName: 'Gala', allocated: 1000, spent: 300, status: 'approved', committee: 'Creatives' },
    { id: '2', eventName: null, allocated: 1000, spent: 1000, status: 'approved', committee: 'Secretariat' },
    { id: '3', eventName: 'Sports', allocated: 1000, spent: 1250, status: 'approved', committee: 'Sports' },
  ];

  const onTrackFiltered = h2.filterAnalyticsBudgets(mixedRows, {
    searchTerm: '',
    filterFund: 'All',
    filterCommittee: 'All',
    filterStatus: 'On Track',
  });
  check(
    'filterAnalyticsBudgets("On Track") matches approved budgets with <80% utilization (not 0 rows)',
    onTrackFiltered.length === 1 && onTrackFiltered[0].id === '1',
    JSON.stringify(onTrackFiltered)
  );

  let nullSearchThrew = false;
  try {
    h2.filterAnalyticsBudgets(mixedRows, { searchTerm: 'gala', filterFund: 'All', filterCommittee: 'All', filterStatus: 'All' });
  } catch {
    nullSearchThrew = true;
  }
  check('filterAnalyticsBudgets handles null eventName without throwing TypeError', !nullSearchThrew);

  const comms = h2.extractUniqueCommittees(mixedRows);
  check(
    'extractUniqueCommittees includes dynamic committees (Creatives, Secretariat, Sports)',
    comms.includes('Creatives') && comms.includes('Secretariat') && comms.includes('Sports'),
    JSON.stringify(comms)
  );

  const csv = h2.buildBudgetCsvContent([
    {
      eventName: 'Event "Alpha", 2026',
      fundName: 'Fiscal Year Budget',
      category: 'Supplies, Printing',
      committee: 'Secretariat',
      allocated: 1500,
      spent: 500,
      remaining: 1000,
      status: 'approved',
    },
  ]);
  check(
    'buildBudgetCsvContent escapes embedded quotes and commas cleanly (RFC 4180)',
    csv.includes('"Event ""Alpha"", 2026"') && csv.includes('"Supplies, Printing"'),
    csv
  );
  check(
    'buildCsvFilename uses ISO YYYY-MM-DD date with no slashes',
    /^Budget_Report_\d{4}-\d{2}-\d{2}\.csv$/.test(h2.buildCsvFilename(new Date('2026-11-26T00:00:00Z'))),
    h2.buildCsvFilename(new Date('2026-11-26T00:00:00Z'))
  );

  // Real IGP & IGF enterprise charts (no fabricated 45/30/25 splits when empty!)
  const realIgp = h2.buildIgpEnterpriseChartData([
    { projectType: 'vending_machine', amountCentavos: 250000 },
    { projectType: 'locker_rental', amountPHP: 1000 },
  ]);
  check(
    'buildIgpEnterpriseChartData derives real PHP totals from igpCollections (including legacy amountPHP)',
    realIgp.length === 2 &&
      realIgp.find((r) => /Vending/i.test(r.name))?.allocated === 2500 &&
      realIgp.find((r) => /Locker/i.test(r.name))?.allocated === 1000,
    JSON.stringify(realIgp)
  );
  check(
    'buildIgpEnterpriseChartData returns [] when no collections exist (no fabricated splits)',
    h2.buildIgpEnterpriseChartData([]).length === 0
  );

  const realIgf = h2.buildIgfEnterpriseChartData([
    { fundAccountId: 'fund_igf_main', status: 'posted', transactionType: 'collection', description: 'Lanyards', amountCentavos: 50000 },
    { fundAccountId: 'fund_igf_main', status: 'posted', transactionType: 'expense', description: 'Lanyards', amountCentavos: 20000 },
    { fundAccountId: 'fund_igf_main', status: 'reversed', transactionType: 'collection', description: 'Voided', amountCentavos: 99900 },
  ]);

  // Order-ID grouping & Top-N rollup regression check (prevents 60+ hairline bars & overflowing legend)
  const manyOrderTxs = [
    { fundAccountId: 'fund_igf_main', status: 'posted', transactionType: 'collection', description: 'Merchandise Sales Revenue: SSGDB-001 - CTU UNIFORMS (x1)', amountCentavos: 50000 },
    { fundAccountId: 'fund_igf_main', status: 'posted', transactionType: 'collection', description: 'Merchandise Sales Revenue: SSGDB-007 - CTU UNIFORMS (x1)', amountCentavos: 50000 },
    { fundAccountId: 'fund_igf_main', status: 'posted', transactionType: 'collection', description: 'Merchandise Sales Revenue: SSGDB-030 - CTU Uniforms (x2)', amountCentavos: 100000 },
    { fundAccountId: 'fund_igf_main', status: 'posted', transactionType: 'collection', description: 'Merchandise Sales Revenue: ORD-DB-0001 - Unified CTU-DB Lanyard (CoEd, CoTE) (x1)', amountCentavos: 15000 },
    { fundAccountId: 'fund_igf_main', status: 'posted', transactionType: 'expense', receiptLabel: 'Food & Meals', description: 'Snacks', amountCentavos: 120000 },
  ];
  const groupedIgf = h2.buildIgfEnterpriseChartData(manyOrderTxs);
  check(
    'buildIgfEnterpriseChartData merges individual merchandise order IDs into clean product buckets',
    groupedIgf.length === 3 &&
      groupedIgf.find((r) => /CTU Uniforms/i.test(r.name))?.allocated === 2000 &&
      groupedIgf.find((r) => /Unified CTU-DB Lanyard/i.test(r.name))?.allocated === 150 &&
      groupedIgf.find((r) => r.name === 'Food & Meals')?.spent === 1200,
    JSON.stringify(groupedIgf)
  );

  const rolled = h2.rollupTopChartBuckets(
    Array.from({ length: 12 }, (_, i) => ({ name: `Item ${i + 1}`, allocated: (12 - i) * 100, spent: 0, value: (12 - i) * 100 })),
    7
  );
  check(
    'rollupTopChartBuckets caps >7 buckets into Top 7 + Other while conserving total PHP sum',
    rolled.length === 8 &&
      rolled[7].name === 'Other (5)' &&
      rolled.reduce((s, r) => s + r.value, 0) === 7800,
    JSON.stringify(rolled)
  );

  check(
    'buildIgfEnterpriseChartData derives real IGF inflow/outflow and excludes reversed transactions',
    realIgf.length === 1 && realIgf[0].allocated === 500 && realIgf[0].spent === 200,
    JSON.stringify(realIgf)
  );
}

const baSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/BudgetAnalytics/BudgetAnalytics.jsx'),
  'utf8'
);
check(
  'BudgetAnalytics.jsx uses deriveBudgetHealthStatus, filterAnalyticsBudgets, dynamic committees, real enterprise charts & URL.revokeObjectURL',
  baSrc.includes('deriveBudgetHealthStatus') &&
    baSrc.includes('filterAnalyticsBudgets') &&
    baSrc.includes('extractUniqueCommittees') &&
    baSrc.includes('buildBudgetCsvContent') &&
    baSrc.includes('URL.revokeObjectURL') &&
    !baSrc.includes('DEFAULT_ENTERPRISE_DISTRIBUTIONS'),
  'BudgetAnalytics.jsx not yet wired to Slice 2 helpers'
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 3: PPMPMatrix Fund-Scoped Status Counts & Archived KPI Isolation
//          + IgpProjectManager Legacy amountPHP Support
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 3: PPMPMatrix KPI Isolation & IGP Legacy Metrics ===');

const h3 = await import(`file:///${helpersPath.replace(/\\/g, '/')}?t=${Date.now()}`);
check(
  'budgetAnalyticsHelpers exports filterPpmpEligibleBudgets, computePpmpStatusCounts, computeIgpCollectionMetrics',
  typeof h3.filterPpmpEligibleBudgets === 'function' &&
    typeof h3.computePpmpStatusCounts === 'function' &&
    typeof h3.computeIgpCollectionMetrics === 'function',
  'Missing Slice 3 helper exports'
);

if (typeof h3.computePpmpStatusCounts === 'function') {
  const ppmpActiveFixture = [
    { id: 'f1', fundAccountId: 'fund_fiscal_year_budget', isFSG: false, ppmpStatus: 'fresh', status: 'approved' },
    { id: 'f2', fundAccountId: 'fund_fsg_remittance', isFSG: true, ppmpStatus: 'partially_used', status: 'approved' },
    { id: 'igf1', fundAccountId: 'fund_igf_main', fundCategory: 'IGF', ppmpStatus: 'fresh', status: 'approved' },
    { id: 'igp1', fundAccountId: 'fund_igp_main', fundCategory: 'IGP', ppmpStatus: 'depleted', status: 'approved' },
  ];
  const ppmpArchivedFixture = [
    { id: 'a1', fundAccountId: 'fund_fiscal_year_budget', isFSG: false, status: 'archived', isArchived: true },
    { id: 'a2', fundAccountId: 'fund_fsg_remittance', isFSG: true, status: 'archived', isArchived: true },
  ];

  const fiscalCounts = h3.computePpmpStatusCounts(ppmpActiveFixture, ppmpArchivedFixture, 'FISCAL');
  check(
    'computePpmpStatusCounts("FISCAL") excludes IGF, IGP, and FSG allocations',
    fiscalCounts.ALL === 1 &&
      fiscalCounts.fresh === 1 &&
      fiscalCounts.partially_used === 0 &&
      fiscalCounts.depleted === 0 &&
      fiscalCounts.archived === 1,
    JSON.stringify(fiscalCounts)
  );

  const allPpmpCounts = h3.computePpmpStatusCounts(ppmpActiveFixture, ppmpArchivedFixture, 'ALL');
  check(
    'computePpmpStatusCounts("ALL") excludes IGF & IGP enterprise records',
    allPpmpCounts.ALL === 2 && allPpmpCounts.fresh === 1 && allPpmpCounts.partially_used === 1 && allPpmpCounts.archived === 2,
    JSON.stringify(allPpmpCounts)
  );

  const igpMetrics = h3.computeIgpCollectionMetrics(
    [
      { projectType: 'vending_machine', amountCentavos: 150000 },
      { projectType: 'vending_machine', amountPHP: 500 }, // legacy amountPHP-only record
      { projectType: 'locker_rental', amountPHP: 200 },   // legacy amountPHP-only record
      { projectType: 'future_igp', amountCentavos: 75000 },
    ],
    [{ status: 'occupied' }, { status: 'available' }, { status: 'available' }]
  );
  check(
    'computeIgpCollectionMetrics sums both amountCentavos and legacy amountPHP records accurately',
    igpMetrics.vendingPHP === 2000 &&
      igpMetrics.lockersPHP === 200 &&
      igpMetrics.customPHP === 750 &&
      igpMetrics.totalPHP === 2950 &&
      igpMetrics.occupiedLockers === 1 &&
      igpMetrics.availableLockers === 2,
    JSON.stringify(igpMetrics)
  );
}

const ppmpSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/Finance/PPMPMatrix.jsx'),
  'utf8'
);
check(
  'PPMPMatrix.jsx computes top KPIs on activePpmpAllocations (isolated from archived filter) and uses computePpmpStatusCounts',
  ppmpSrc.includes('activePpmpAllocations') && ppmpSrc.includes('computePpmpStatusCounts'),
  'PPMPMatrix.jsx still ties top KPIs to archived-swapped ppmpAllocations or counts raw budgets'
);

const igpSrc = fs.readFileSync(
  path.join(ROOT, 'src/components/Finance/IgpProjectManager.jsx'),
  'utf8'
);
check(
  'IgpProjectManager.jsx uses computeIgpCollectionMetrics so legacy amountPHP records are counted',
  igpSrc.includes('computeIgpCollectionMetrics'),
  'IgpProjectManager.jsx still sums only c.amountCentavos || 0'
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 4: Order Statistics & Claimed -> Returned Stock Deduction Guard
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 4: Order Statistics & Returned Stock Flag Preservation ===');

const orderMod = await import(
  `file:///${path.join(ROOT, 'src/components/Data/orderStatusTransition.js').replace(/\\/g, '/')}?t=${Date.now()}`
);

const orderStats = orderMod.computeOrderStatistics([
  { orderId: 'O1', orderStatus: 'Pending', claimed: false, productInfo: { totalPrice: 100 } },
  { orderId: 'O2', orderStatus: 'Online Paid', claimed: false, productInfo: { totalPrice: 200 } },
  { orderId: 'O3', orderStatus: 'Claimed', claimed: true, productInfo: { totalPrice: 300 } },
  { orderId: 'O4', orderStatus: 'Cancelled', claimed: false, productInfo: { totalPrice: 400 } },
  { orderId: 'O5', orderStatus: 'Returned', claimed: false, productInfo: { totalPrice: 500 } },
]);

check(
  'computeOrderStatistics excludes Cancelled and Returned orders from unclaimed count',
  orderStats.unclaimed === 2 && orderStats.pending === 1 && orderStats.onlinePaid === 1 && orderStats.returned === 1,
  JSON.stringify(orderStats)
);

const stockCalls = [];
const updates = [];
const deps = {
  currentUser: { uid: 'u1', displayName: 'Officer' },
  userName: 'Officer',
  showToast: () => {},
  syncOrderStockDeduction: async (p) => stockCalls.push(p),
  auditService: { logInventoryUpdate: async () => {} },
  financeService: {
    syncOrderRevenueToIGF: async () => ({}),
    reverseOrderRevenueFromIGF: async () => ({}),
  },
  updateOrderDoc: async (_id, fields) => updates.push(fields),
};

const claimedOrder = {
  orderId: 'O-RET-1',
  orderStatus: 'Claimed',
  claimed: true,
  stockClaimDeducted: true,
  igfSynced: true,
  productInfo: { productName: 'Lanyard', quantity: 1, totalPrice: 150 },
};

await orderMod.executeOrderStatusUpdate({
  docId: 'doc-ret-1',
  newStatus: 'Returned',
  order: claimedOrder,
  deps,
});

check(
  'Claimed -> Returned preserves stockClaimDeducted=true (defective stock was NOT restored, preventing double deduction)',
  stockCalls.length === 0 && updates[0]?.stockClaimDeducted === true,
  JSON.stringify({ stockCalls, updatedFields: updates[0] })
);

// Re-claiming that same returned order must NOT double-deduct stock
await orderMod.executeOrderStatusUpdate({
  docId: 'doc-ret-1',
  newStatus: 'Claimed',
  order: { ...claimedOrder, ...updates[0] },
  deps,
});
check(
  'Re-claiming a quarantined Returned order does NOT double-deduct inventory stock',
  stockCalls.length === 0,
  `Expected 0 stock deductions, got ${stockCalls.length}`
);

console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);
if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\n✅ All checks passed.');
