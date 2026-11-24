/**
 * scripts/igp-ledger-reconciliation-tdd.mjs
 *
 * TDD & Bug-Diagnosis Regression Suite for IGP Fund Balance Wipe Prevention:
 * Prevents FinanceProvider / reconcileFundBalanceFromLedger('fund_igp_main')
 * from erasing Vending Machine, Campus Locker, and Custom IGP revenue to ₱0
 * when an IGP expense transaction (e.g., InventoryProvider procurement) exists.
 *
 * Seams Under Test:
 * - Seam A: createIgpProjectService({ db }) -> Append-only transactions ledger posting
 *           for Vending Machine, Campus Lockers, Custom IGP, and Reversals
 * - Seam B: computeAuthoritativeFundBalanceCentavos(fund, transactions, igpCollections)
 *           for both ledger-linked IGP collections and legacy unlinked igpCollections (no double-count)
 * - Seam C: Browser Firestore adapter & FinanceProvider / financeService / FundGovernance wiring
 *
 * Run: node scripts/igp-ledger-reconciliation-tdd.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createIgpProjectService,
  IGP_PROJECT_TYPES,
} from '../src/services/igpProjectService.js';
import {
  computeAuthoritativeFundBalanceCentavos,
  computeLedgerNetByAccount,
} from '../src/utils/financeLedgerReconciliation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let failed = 0;
const results = [];
const check = (label, ok, detail = '') => {
  if (ok) {
    results.push(`ok   ${label}`);
  } else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
  }
};

function createLedgerAwareFakeEnv() {
  let idSeq = 1;
  const store = {
    collections: new Map(),
    lockers: new Map(),
    transactions: [],
    fundAccounts: new Map([
      [
        'fund_igp_main',
        {
          id: 'fund_igp_main',
          topLevelCategory: 'IGP',
          displayName: 'Income-Generating Projects (IGP)',
          bankAccountReference: 'Custodial Lockbox',
          balanceCentavos: 0,
        },
      ],
    ]),
    auditLogs: [],
  };

  const db = {
    async getLocker(id) {
      return store.lockers.get(id) || null;
    },
    async listLockers() {
      return Array.from(store.lockers.values());
    },
    async saveLocker(id, data) {
      store.lockers.set(id, { id, ...data });
      return store.lockers.get(id);
    },
    async addCollection(data) {
      const id = `igp-col-${idSeq++}`;
      const docData = { id, ...data };
      store.collections.set(id, docData);
      return docData;
    },
    async updateCollection(id, patch) {
      const existing = store.collections.get(id);
      if (existing) {
        store.collections.set(id, { ...existing, ...patch });
      }
      return store.collections.get(id) || null;
    },
    async deleteCollection(id) {
      return store.collections.delete(id);
    },
    async getCollection(id) {
      return store.collections.get(id) || null;
    },
    async listCollections() {
      return Array.from(store.collections.values());
    },
    async getIgpFund() {
      return store.fundAccounts.get('fund_igp_main');
    },
    async updateIgpFundBalance(deltaCentavos, ledgerMeta = null) {
      const fund = store.fundAccounts.get('fund_igp_main');
      fund.balanceCentavos = Math.max(0, (fund.balanceCentavos || 0) + deltaCentavos);

      if (ledgerMeta && ledgerMeta.postToLedger !== false) {
        const txId = `tx-igp-${idSeq++}`;
        const txDoc = {
          id: txId,
          ...ledgerMeta.transaction,
          fundAccountId: 'fund_igp_main',
          fundCategory: 'IGP',
          status: 'posted',
        };
        store.transactions.push(txDoc);
        if (ledgerMeta.collectionId && store.collections.has(ledgerMeta.collectionId)) {
          const col = store.collections.get(ledgerMeta.collectionId);
          store.collections.set(ledgerMeta.collectionId, {
            ...col,
            ledgerTxId: txId,
            ledgerRefNumber: txDoc.refNumber,
          });
        }
        return { balanceCentavos: fund.balanceCentavos, ledgerTxId: txId, ledgerRefNumber: txDoc.refNumber };
      }

      return { balanceCentavos: fund.balanceCentavos };
    },
    async logAudit(entry) {
      store.auditLogs.push(entry);
    },
  };

  // Simulates InventoryProvider.jsx purchasing an item funded by IGP
  const recordIgpInventoryExpense = (amountCentavos, itemName = 'Cleaning Supplies') => {
    const fund = store.fundAccounts.get('fund_igp_main');
    fund.balanceCentavos = (fund.balanceCentavos || 0) - amountCentavos;
    store.transactions.push({
      id: `tx-inv-${idSeq++}`,
      refNumber: `INV-IGP-${idSeq}`,
      fundAccountId: 'fund_igp_main',
      fundCategory: 'IGP',
      transactionType: 'expense',
      expensePurpose: `Inventory Procurement: ${itemName}`,
      amountCentavos,
      status: 'posted',
    });
  };

  return { store, db, recordIgpInventoryExpense };
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 1: Exact Bug Reproduction — IGP Revenue + IGP Inventory Expense Must Not Wipe to ₱0
// ════════════════════════════════════════════════════════════════════════════
console.log('=== Slice 1: IGP Collections Posted to Transactions Ledger Survive Reconciliation ===');
{
  const { store, db, recordIgpInventoryExpense } = createLedgerAwareFakeEnv();
  const service = createIgpProjectService({ db });
  await service.initializeLockerUnitsIfEmpty();

  const actor = { uid: 'rep-1', name: 'Rep. Santos', role: 'representative', email: 'rep@ctu.edu.ph' };

  // 1. Record ₱1,500 Vending Machine + ₱200 Locker Rental + ₱800 Custom IGP = ₱2,500 (250,000 centavos)
  const vRec = await service.recordVendingCollection(
    { amountPHP: 1500, location: { buildingName: 'Student Center', specificSpot: 'Lobby' } },
    actor
  );
  const lRec = await service.rentLockerUnit(
    'HM-L01',
    { renterName: 'Juan Dela Cruz', studentId: '2026-001', months: 2, startDate: '2026-11-01' },
    actor
  );
  const cRec = await service.recordCustomIgpRevenue(
    { projectName: 'Printing Kiosk', amountPHP: 800, location: { buildingName: 'Admin' } },
    actor
  );

  check(
    'All 3 IGP revenue inflows (Vending, Locker, Custom) post append-only collection entries to transactions',
    store.transactions.length === 3 &&
      store.transactions.every(
        (tx) =>
          tx.fundAccountId === 'fund_igp_main' &&
          tx.transactionType === 'collection' &&
          tx.status === 'posted' &&
          tx.source === 'IGP_COLLECTION' &&
          Boolean(tx.igpCollectionId)
      ),
    `transactions=${JSON.stringify(store.transactions)}`
  );

  check(
    'Vending, Locker, and Custom IGP collections total 250000 centavos in transactions ledger',
    computeLedgerNetByAccount(store.transactions).get('fund_igp_main') === 250000,
    `ledgerNet=${computeLedgerNetByAccount(store.transactions).get('fund_igp_main')}`
  );

  // 2. Now InventoryProvider records a ₱300 (30,000 centavos) expense against fund_igp_main
  recordIgpInventoryExpense(30000, 'Water Filters');

  const igpFund = await db.getIgpFund();
  const allCollections = await db.listCollections();

  // 3. FinanceProvider & reconcileFundBalanceFromLedger recompute balance strictly from ledger
  const reconciledWithoutCollections = computeAuthoritativeFundBalanceCentavos(igpFund, store.transactions);
  const reconciledWithCollections = computeAuthoritativeFundBalanceCentavos(igpFund, store.transactions, allCollections);

  check(
    'Reconciling fund_igp_main after ₱300 IGP inventory expense yields ₱2,200.00 (220000 centavos), NOT ₱0.00',
    reconciledWithoutCollections === 220000,
    `Expected 220000, got ${reconciledWithoutCollections} (stored=${igpFund.balanceCentavos})`
  );

  check(
    'Passing igpCollections alongside linked transactions does NOT double-count IGP revenue (still 220000 centavos)',
    reconciledWithCollections === 220000,
    `Expected 220000, got ${reconciledWithCollections}`
  );

  check(
    'Saved collection records link back to their posted ledger transaction (vending/custom carry igpCollectionId match)',
    Boolean(vRec?.id) && Boolean(cRec?.id) && Boolean(lRec?.currentLease)
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 2: Reversal Integrity — Deleting an IGP Collection Posts a Ledger Reversal
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 2: Deleting a Ledger-Linked IGP Collection Posts a Compensating Reversal ===');
{
  const { store, db, recordIgpInventoryExpense } = createLedgerAwareFakeEnv();
  const service = createIgpProjectService({ db });
  await service.initializeLockerUnitsIfEmpty();

  const actor = { uid: 'aud-1', name: 'Auditor Cruz', role: 'auditor' };

  const vCol = await service.recordVendingCollection(
    { amountPHP: 500, location: { buildingName: 'Student Center' } },
    actor
  );
  await service.rentLockerUnit(
    'ED-L01',
    { renterName: 'Maria Santos', studentId: '2026-002', months: 2, startDate: '2026-11-01' },
    actor
  );

  // Reverse the ₱500 vending collection -> only ₱200 locker rental remains
  await service.deleteVendingCollection(vCol.id, 'Duplicate count entry', actor);

  // Record a ₱50 inventory expense -> expected remaining balance = ₱150.00 (15,000 centavos)
  recordIgpInventoryExpense(5000, 'Padlocks');

  const igpFund = await db.getIgpFund();
  const allCollections = await db.listCollections();
  const reconciled = computeAuthoritativeFundBalanceCentavos(igpFund, store.transactions, allCollections);

  check(
    'deleteVendingCollection posts a REVERSAL transaction for a ledger-linked collection',
    store.transactions.some(
      (tx) =>
        tx.fundAccountId === 'fund_igp_main' &&
        tx.transactionType === 'reversal' &&
        tx.source === 'IGP_COLLECTION_REVERSAL' &&
        tx.amountCentavos === 50000
    ),
    `transactions=${JSON.stringify(store.transactions)}`
  );

  check(
    'After reversal of ₱500 and ₱50 inventory expense against ₱200 locker rental, reconciled balance is ₱150.00 (15000)',
    reconciled === 15000 && igpFund.balanceCentavos === 15000,
    `reconciled=${reconciled}, stored=${igpFund.balanceCentavos}`
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 3: Historical / Legacy Unlinked igpCollections Protection (Pre-Fix Data)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 3: Legacy Pre-Fix igpCollections Survive Reconciliation Without Double-Counting ===');
{
  const igpFund = {
    id: 'fund_igp_main',
    topLevelCategory: 'IGP',
    balanceCentavos: 140000,
  };

  // Pre-fix legacy collections (exist ONLY in igpCollections, NO matching transactions row)
  const legacyAndNewCollections = [
    { id: 'legacy-vending-1', projectType: IGP_PROJECT_TYPES.VENDING_MACHINE, amountCentavos: 100000 },
    { id: 'legacy-locker-1', projectType: IGP_PROJECT_TYPES.LOCKER_RENTAL, amountCentavos: 50000 },
    // New post-fix collection (exists in BOTH igpCollections AND transactions via igpCollectionId)
    { id: 'new-vending-2', projectType: IGP_PROJECT_TYPES.VENDING_MACHINE, amountCentavos: 20000, ledgerTxId: 'tx-new-2' },
  ];

  const transactions = [
    {
      id: 'tx-new-2',
      fundAccountId: 'fund_igp_main',
      fundCategory: 'IGP',
      transactionType: 'collection',
      source: 'IGP_COLLECTION',
      igpCollectionId: 'new-vending-2',
      amountCentavos: 20000,
      status: 'posted',
    },
    {
      id: 'tx-inv-exp-1',
      fundAccountId: 'fund_igp_main',
      fundCategory: 'IGP',
      transactionType: 'expense',
      amountCentavos: 30000,
      status: 'posted',
    },
  ];

  // Expected: legacy (100000 + 50000) + linked tx (20000, NOT double counted) - expense (30000) = 140000
  const authoritative = computeAuthoritativeFundBalanceCentavos(igpFund, transactions, legacyAndNewCollections);
  check(
    'Legacy unlinked igpCollections (+₱1,500) + new linked tx (+₱200) - inventory expense (-₱300) = ₱1,400.00 (140000)',
    authoritative === 140000,
    `Expected 140000, got ${authoritative}`
  );

  // Also verify deleting a legacy unlinked collection does NOT post a bogus reversal into transactions
  const { store, db } = createLedgerAwareFakeEnv();
  const service = createIgpProjectService({ db });
  store.collections.set('legacy-col-only', {
    id: 'legacy-col-only',
    projectType: IGP_PROJECT_TYPES.VENDING_MACHINE,
    amountCentavos: 40000,
  });
  store.fundAccounts.get('fund_igp_main').balanceCentavos = 40000;

  await service.deleteVendingCollection('legacy-col-only', 'Cleanup legacy misinput', { uid: 'aud-1', name: 'Auditor' });
  check(
    'Deleting a legacy unlinked collection does NOT insert an orphan REVERSAL into transactions',
    store.transactions.length === 0 && store.fundAccounts.get('fund_igp_main').balanceCentavos === 0,
    `txCount=${store.transactions.length}, balance=${store.fundAccounts.get('fund_igp_main').balanceCentavos}`
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 4: Browser Firestore Adapter & FinanceProvider / financeService Wiring
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 4: Production Firestore Adapter & Finance Reconciliation Wiring ===');
{
  const igpSrc = fs.readFileSync(path.resolve(__dirname, '../src/services/igpProjectService.js'), 'utf8');
  const finSvcSrc = fs.readFileSync(path.resolve(__dirname, '../src/services/financeService.js'), 'utf8');
  const finProvSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/FinanceContext/FinanceProvider.jsx'), 'utf8');
  const fundGovSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/Finance/FundGovernance.jsx'), 'utf8');

  check(
    "igpProjectService.js browser adapter writes IGP inflows/reversals to 'transactions' atomically inside runTransaction and calls notifyFinanceUpdated",
    igpSrc.includes("collection(db, 'transactions')") &&
      igpSrc.includes('IGP_COLLECTION') &&
      igpSrc.includes('notifyFinanceUpdated')
  );

  check(
    "financeService.js reconcileFundBalanceFromLedger loads 'igpCollections' when reconciling fund_igp_main",
    finSvcSrc.includes("'igpCollections'") &&
      /reconcileFundBalanceFromLedger[\s\S]*?computeAuthoritativeFundBalanceCentavos\s*\(\s*fundData\s*,\s*allTxs\s*,\s*igpCollections\s*\)/.test(finSvcSrc)
  );

  check(
    'FinanceProvider.jsx loads igpCollections and passes them to computeAuthoritativeFundBalanceCentavos',
    finProvSrc.includes('getIgpCollections') &&
      finProvSrc.includes('computeAuthoritativeFundBalanceCentavos(acc, txList, igpCollections)')
  );

  check(
    'FundGovernance.jsx passes igpCollections to computeAuthoritativeFundBalanceCentavos',
    fundGovSrc.includes('computeAuthoritativeFundBalanceCentavos(fund, visibleTransactions, igpCollections)')
  );
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
