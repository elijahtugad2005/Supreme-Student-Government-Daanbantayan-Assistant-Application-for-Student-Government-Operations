/**
 * ledger-filter-running-balance-tdd.mjs
 * Verifies QoL Append-Only Ledger multi-select pool filtering (PPMP, IGF, IGP, or combinations),
 * direction filtering (All / Expenses Only / Inflows Only), reversed-row hiding,
 * chronological Before -> After decrement trail (e.g., ₱500,000 -> ₱480,000 -> ₱465,000),
 * transfer conservation, and exact centavo parity with computeAuthoritativeFundBalanceCentavos().
 */

import assert from 'node:assert/strict';
import { TOP_LEVEL_FUNDS, TRANSACTION_TYPES, TRANSACTION_STATUSES } from '../src/utils/financeConstants.js';
import {
  computeAuthoritativeFundBalanceCentavos,
  filterValidLedgerTransactions,
} from '../src/utils/financeLedgerReconciliation.js';
import {
  LEDGER_POOL_KEYS,
  LEDGER_DIRECTIONS,
  resolveLedgerPool,
  toggleLedgerPool,
  computeLedgerRunningTrail,
  filterLedgerTrail,
  computeLedgerBridgeSummary,
  computeLedgerPoolCounts,
} from '../src/utils/ledgerRunningBalance.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const fundAccounts = [
  {
    id: 'fund_fiscal_year_budget',
    name: 'Fiscal Year Budget',
    topLevelCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
    appropriatedCeilingCentavos: 500_000_00, // ₱500,000.00
    balanceCentavos: 465_000_00,
  },
  {
    id: 'fund_fsg_remittance',
    name: 'FSG Remittance',
    topLevelCategory: TOP_LEVEL_FUNDS.FSG_REMITTANCE,
    appropriatedCeilingCentavos: 100_000_00, // ₱100,000.00
    balanceCentavos: 95_000_00,
  },
  {
    id: 'fund_igf_main',
    name: 'Internally Generated Fund (IGF)',
    topLevelCategory: TOP_LEVEL_FUNDS.IGF,
    balanceCentavos: 0,
  },
  {
    id: 'fund_igp_main',
    name: 'Income Generating Project (IGP)',
    topLevelCategory: TOP_LEVEL_FUNDS.IGP,
    balanceCentavos: 0,
  },
];

// Legacy unlinked IGP collection of ₱10,000.00
const igpCollections = [
  {
    id: 'col_legacy_1',
    amountCentavos: 10_000_00,
  },
];

// Firestore returns newest-first (createdAt desc)
const sampleTransactionsNewestFirst = [
  {
    id: 'tx_8',
    refNumber: 'TX-008',
    fundAccountId: 'fund_igp_main',
    fundCategory: TOP_LEVEL_FUNDS.IGP,
    transactionType: TRANSACTION_TYPES.EXPENSE,
    amountCentavos: 3_000_00, // ₱3,000.00 IGP expense
    status: TRANSACTION_STATUSES.POSTED,
    createdAt: new Date('2026-10-08T10:00:00Z'),
  },
  {
    id: 'tx_7',
    refNumber: 'TX-007',
    fundAccountId: 'fund_igf_main',
    fundCategory: TOP_LEVEL_FUNDS.IGF,
    transferDestinationAccountId: 'fund_igp_main',
    transactionType: TRANSACTION_TYPES.TRANSFER,
    amountCentavos: 5_000_00, // ₱5,000.00 IGF -> IGP
    status: TRANSACTION_STATUSES.POSTED,
    createdAt: new Date('2026-10-07T10:00:00Z'),
  },
  {
    id: 'tx_6',
    refNumber: 'TX-006',
    fundAccountId: 'fund_igf_main',
    fundCategory: TOP_LEVEL_FUNDS.IGF,
    transactionType: TRANSACTION_TYPES.EXPENSE,
    amountCentavos: 7_500_00, // ₱7,500.00 IGF expense
    status: TRANSACTION_STATUSES.POSTED,
    createdAt: new Date('2026-10-06T10:00:00Z'),
  },
  {
    id: 'tx_5',
    refNumber: 'TX-005',
    fundAccountId: 'fund_igf_main',
    fundCategory: TOP_LEVEL_FUNDS.IGF,
    transactionType: TRANSACTION_TYPES.COLLECTION,
    amountCentavos: 40_000_00, // ₱40,000.00 IGF collection
    status: TRANSACTION_STATUSES.POSTED,
    createdAt: new Date('2026-10-05T10:00:00Z'),
  },
  {
    id: 'tx_4',
    refNumber: 'TX-004',
    fundAccountId: 'fund_fsg_remittance',
    fundCategory: TOP_LEVEL_FUNDS.FSG_REMITTANCE,
    transactionType: TRANSACTION_TYPES.EXPENSE,
    amountCentavos: 5_000_00, // ₱5,000.00 FSG expense (100k -> 95k)
    status: TRANSACTION_STATUSES.POSTED,
    createdAt: new Date('2026-10-04T10:00:00Z'),
  },
  {
    id: 'tx_3',
    refNumber: 'TX-003',
    fundAccountId: 'fund_fiscal_year_budget',
    fundCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
    transactionType: TRANSACTION_TYPES.EXPENSE,
    amountCentavos: 15_000_00, // ₱15,000.00 Fiscal expense (480k -> 465k)
    status: TRANSACTION_STATUSES.POSTED,
    createdAt: new Date('2026-10-03T10:00:00Z'),
  },
  {
    id: 'tx_2_rev',
    refNumber: 'TX-002-REV',
    fundAccountId: 'fund_fiscal_year_budget',
    fundCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
    transactionType: TRANSACTION_TYPES.REVERSAL,
    reversalOfTransactionId: 'tx_2',
    reversedTransactionType: TRANSACTION_TYPES.EXPENSE,
    amountCentavos: 10_000_00,
    status: TRANSACTION_STATUSES.POSTED,
    createdAt: new Date('2026-10-02T12:00:00Z'),
  },
  {
    id: 'tx_2',
    refNumber: 'TX-002',
    fundAccountId: 'fund_fiscal_year_budget',
    fundCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
    transactionType: TRANSACTION_TYPES.EXPENSE,
    amountCentavos: 10_000_00, // Reversed entry -> ₱0 net
    status: TRANSACTION_STATUSES.REVERSED,
    createdAt: new Date('2026-10-02T10:00:00Z'),
  },
  {
    id: 'tx_1',
    refNumber: 'TX-001',
    fundAccountId: 'fund_fiscal_year_budget',
    fundCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
    transactionType: TRANSACTION_TYPES.EXPENSE,
    amountCentavos: 20_000_00, // ₱20,000.00 Fiscal expense (500k -> 480k)
    status: TRANSACTION_STATUSES.POSTED,
    createdAt: new Date('2026-10-01T10:00:00Z'),
  },
];

console.log('Running Ledger QoL Filter & Running Decrement Trail TDD Suite...');

test('pool resolver maps Fiscal & FSG to PPMP, plus IGF and IGP', () => {
  assert.equal(resolveLedgerPool(fundAccounts[0]), LEDGER_POOL_KEYS.PPMP);
  assert.equal(resolveLedgerPool(fundAccounts[1]), LEDGER_POOL_KEYS.PPMP);
  assert.equal(resolveLedgerPool(fundAccounts[2]), LEDGER_POOL_KEYS.IGF);
  assert.equal(resolveLedgerPool(fundAccounts[3]), LEDGER_POOL_KEYS.IGP);
});

test('multi-select pool toggle supports single, combined (IGF+IGP), and collapses all-3 back to All', () => {
  let pools = [];
  pools = toggleLedgerPool(pools, LEDGER_POOL_KEYS.IGF);
  assert.deepEqual(pools, ['IGF']);

  pools = toggleLedgerPool(pools, LEDGER_POOL_KEYS.IGP);
  assert.deepEqual(pools, ['IGF', 'IGP']);

  // Adding PPMP means all 3 are selected -> collapse to [] (All Funds)
  pools = toggleLedgerPool(pools, LEDGER_POOL_KEYS.PPMP);
  assert.deepEqual(pools, []);

  // Selecting PPMP + IGF works cleanly
  pools = toggleLedgerPool(['PPMP'], LEDGER_POOL_KEYS.IGF);
  assert.deepEqual(pools, ['PPMP', 'IGF']);

  // Resetting via ALL
  assert.deepEqual(toggleLedgerPool(pools, 'ALL'), []);
});

test('PPMP running decrement trail shows exact ₱500,000 -> ₱480,000 -> ₱465,000 progression', () => {
  const validTxs = filterValidLedgerTransactions(sampleTransactionsNewestFirst, fundAccounts);
  const trail = computeLedgerRunningTrail(validTxs, fundAccounts, igpCollections);
  const byId = new Map(trail.rows.map((r) => [r.tx.id, r]));

  const tx1 = byId.get('tx_1');
  assert.equal(tx1.beforeCentavos, 500_000_00);
  assert.equal(tx1.afterCentavos, 480_000_00);
  assert.equal(tx1.effectiveDeltaCentavos, -20_000_00);

  // Reversed original and paired reversal do not distort the ₱480,000 balance
  const tx2 = byId.get('tx_2');
  const tx2Rev = byId.get('tx_2_rev');
  assert.equal(tx2.isVoidedPair, true);
  assert.equal(tx2.beforeCentavos, 480_000_00);
  assert.equal(tx2.afterCentavos, 480_000_00);
  assert.equal(tx2Rev.isPairedReversal, true);
  assert.equal(tx2Rev.beforeCentavos, 480_000_00);
  assert.equal(tx2Rev.afterCentavos, 480_000_00);

  // Next Fiscal expense decrements cleanly from ₱480,000 -> ₱465,000
  const tx3 = byId.get('tx_3');
  assert.equal(tx3.beforeCentavos, 480_000_00);
  assert.equal(tx3.afterCentavos, 465_000_00);

  // FSG decrements independently from ₱100,000 -> ₱95,000
  const tx4 = byId.get('tx_4');
  assert.equal(tx4.beforeCentavos, 100_000_00);
  assert.equal(tx4.afterCentavos, 95_000_00);
});

test('IGF and IGP trails conserve double-entry transfers and unlinked IGP opening balance', () => {
  const validTxs = filterValidLedgerTransactions(sampleTransactionsNewestFirst, fundAccounts);
  const trail = computeLedgerRunningTrail(validTxs, fundAccounts, igpCollections);
  const byId = new Map(trail.rows.map((r) => [r.tx.id, r]));

  // IGF: 0 -> 40,000 -> 32,500 -> 27,500 (after ₱5,000 transfer to IGP)
  assert.equal(byId.get('tx_5').beforeCentavos, 0);
  assert.equal(byId.get('tx_5').afterCentavos, 40_000_00);
  assert.equal(byId.get('tx_6').beforeCentavos, 40_000_00);
  assert.equal(byId.get('tx_6').afterCentavos, 32_500_00);
  assert.equal(byId.get('tx_7').beforeCentavos, 32_500_00);
  assert.equal(byId.get('tx_7').afterCentavos, 27_500_00);

  // Transfer destination trail on IGP: 10,000 (legacy unlinked) -> 15,000
  assert.equal(byId.get('tx_7').destinationTrail.pool, LEDGER_POOL_KEYS.IGP);
  assert.equal(byId.get('tx_7').destinationTrail.beforeCentavos, 10_000_00);
  assert.equal(byId.get('tx_7').destinationTrail.afterCentavos, 15_000_00);

  // IGP expense: 15,000 -> 12,000
  assert.equal(byId.get('tx_8').beforeCentavos, 15_000_00);
  assert.equal(byId.get('tx_8').afterCentavos, 12_000_00);
});

test('ending running balances match computeAuthoritativeFundBalanceCentavos() for ALL 4 accounts', () => {
  const validTxs = filterValidLedgerTransactions(sampleTransactionsNewestFirst, fundAccounts);
  const trail = computeLedgerRunningTrail(validTxs, fundAccounts, igpCollections);

  for (const acc of fundAccounts) {
    const authoritative = computeAuthoritativeFundBalanceCentavos(acc, validTxs, igpCollections);
    const trailEnding = Math.max(0, trail.endingBalances.get(acc.id) || 0);
    assert.equal(
      trailEnding,
      authoritative,
      `Mismatch for ${acc.id}: trail=${trailEnding}, authoritative=${authoritative}`
    );
  }
});

test('filterLedgerTrail isolates PPMP Expenses Only, IGF+IGP combined Expenses Only, and inbound IGP transfers', () => {
  const validTxs = filterValidLedgerTransactions(sampleTransactionsNewestFirst, fundAccounts);
  const trail = computeLedgerRunningTrail(validTxs, fundAccounts, igpCollections);

  // PPMP + Expenses Only + Hide Reversed + Oldest First
  const ppmpExpenses = filterLedgerTrail(trail.rows, {
    selectedPools: ['PPMP'],
    direction: LEDGER_DIRECTIONS.EXPENSES,
    hideReversed: true,
    sortOrder: 'oldest',
  });
  assert.deepEqual(
    ppmpExpenses.map((r) => r.tx.id),
    ['tx_1', 'tx_3', 'tx_4']
  );

  // Combined IGF + IGP + Expenses Only
  const igfIgpExpenses = filterLedgerTrail(trail.rows, {
    selectedPools: ['IGF', 'IGP'],
    direction: LEDGER_DIRECTIONS.EXPENSES,
    hideReversed: false,
    sortOrder: 'newest',
  });
  assert.deepEqual(
    igfIgpExpenses.map((r) => r.tx.id),
    ['tx_8', 'tx_7', 'tx_6']
  );

  // IGP + Inflows Only includes inbound transfer from IGF -> IGP
  const igpInflows = filterLedgerTrail(trail.rows, {
    selectedPools: ['IGP'],
    direction: LEDGER_DIRECTIONS.INFLOWS,
  });
  assert.deepEqual(
    igpInflows.map((r) => r.tx.id),
    ['tx_7']
  );
});

test('computeLedgerBridgeSummary balances exact equation for PPMP, IGF, IGP, and combined IGF+IGP', () => {
  const validTxs = filterValidLedgerTransactions(sampleTransactionsNewestFirst, fundAccounts);
  const trail = computeLedgerRunningTrail(validTxs, fundAccounts, igpCollections);

  // PPMP: 600,000 ceiling (500k Fiscal + 100k FSG) - 40,000 expenses = 560,000 remaining
  const ppmpBridge = computeLedgerBridgeSummary(trail, ['PPMP'], fundAccounts);
  assert.equal(ppmpBridge.startingCentavos, 600_000_00);
  assert.equal(ppmpBridge.inflowsCentavos, 0);
  assert.equal(ppmpBridge.expensesCentavos, 40_000_00);
  assert.equal(ppmpBridge.remainingCentavos, 560_000_00);
  assert.equal(
    ppmpBridge.startingCentavos + ppmpBridge.inflowsCentavos - ppmpBridge.expensesCentavos,
    ppmpBridge.remainingCentavos
  );

  // Combined IGF + IGP: remaining = 27,500 + 12,000 = 39,500
  const igfIgpBridge = computeLedgerBridgeSummary(trail, ['IGF', 'IGP'], fundAccounts);
  assert.equal(igfIgpBridge.remainingCentavos, 39_500_00);
  assert.equal(
    igfIgpBridge.startingCentavos + igfIgpBridge.inflowsCentavos - igfIgpBridge.expensesCentavos,
    igfIgpBridge.remainingCentavos
  );
  assert.equal(igfIgpBridge.scopeLabel, 'IGF + IGP');

  // Pool counts respect Expenses Only + hideReversed
  const counts = computeLedgerPoolCounts(trail.rows, {
    direction: LEDGER_DIRECTIONS.EXPENSES,
    hideReversed: true,
  });
  assert.equal(counts.PPMP, 3);
  assert.equal(counts.IGF, 2);
  assert.equal(counts.IGP, 1);
  assert.equal(counts.ALL, 6);
});

test('unlinked MERCHANDISE_ORDER_REVERSAL credits then debits IGF running trail accurately', () => {
  const igfOnly = [fundAccounts[2]];
  const orderTxs = [
    {
      id: 'rev_ord_1',
      fundAccountId: 'fund_igf_main',
      fundCategory: TOP_LEVEL_FUNDS.IGF,
      transactionType: TRANSACTION_TYPES.REVERSAL,
      source: 'MERCHANDISE_ORDER_REVERSAL',
      amountCentavos: 2_500_00,
      status: TRANSACTION_STATUSES.POSTED,
      createdAt: new Date('2026-10-02T10:00:00Z'),
    },
    {
      id: 'col_ord_1',
      fundAccountId: 'fund_igf_main',
      fundCategory: TOP_LEVEL_FUNDS.IGF,
      transactionType: TRANSACTION_TYPES.COLLECTION,
      source: 'MERCHANDISE_ORDER',
      amountCentavos: 2_500_00,
      status: TRANSACTION_STATUSES.POSTED,
      createdAt: new Date('2026-10-01T10:00:00Z'),
    },
  ];
  const trail = computeLedgerRunningTrail(orderTxs, igfOnly, []);
  const byId = new Map(trail.rows.map((r) => [r.tx.id, r]));
  assert.equal(byId.get('col_ord_1').beforeCentavos, 0);
  assert.equal(byId.get('col_ord_1').afterCentavos, 2_500_00);
  assert.equal(byId.get('rev_ord_1').beforeCentavos, 2_500_00);
  assert.equal(byId.get('rev_ord_1').afterCentavos, 0);
  assert.equal(
    trail.endingBalances.get('fund_igf_main'),
    computeAuthoritativeFundBalanceCentavos(igfOnly[0], orderTxs, [])
  );
});

if (!process.exitCode) {
  console.log(`\nAll ${passed} Ledger QoL Filter & Running Decrement tests passed!`);
}
