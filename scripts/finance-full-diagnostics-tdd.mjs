/**
 * scripts/finance-full-diagnostics-tdd.mjs
 *
 * Comprehensive Finance Section Bug-Diagnosis & Edge-Case TDD Suite (`/diagnosing-bugs` + `/code-review`).
 *
 * Exercises EVERY Finance seam under real & adversarial situations:
 *  Slice 1: Ledger Reconciliation order-independence, unlinked reversals & 200-permutation fuzz invariants
 *  Slice 2: Validation, Fiscal/FSG allocation caps, archived blocks, Pre-Order & Reversal edge cases
 *  Slice 3: Google Sheets Fiscal Export schema parity (raw budgetAllocations + real refNumber/reversed status)
 *  Slice 4: IGP Project Service (MAINTENANCE locker guard, double-reversal prevention, RBAC overrides)
 *  Slice 5: Finance UI, Hook & Provider invariants (usePermissions, PPMPMatrix Archived tab, BudgetManagement,
 *           FundGovernance double-submit/outflow sign/column alignment, ReversalModal reset, FinanceProvider loop, ₱ audit notes)
 *  Slice 6: Live Firestore Rules Emulator (append-only posted transaction immutability, no admin hard-delete of posted rows,
 *           auditor approval rights, read-only secretary, member/deactivated denials)
 *
 * Run:
 *   npm run test:finance-diagnostics
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
import {
  TOP_LEVEL_FUNDS,
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
} from '../src/utils/financeConstants.js';
import {
  validateTransactionRules,
  validateSupplierPaymentApproval,
} from '../src/utils/financeValidation.js';
import {
  computeLedgerNetByAccount,
  computeDisbursedByAccount,
  computeDisbursedByAllocation,
} from '../src/utils/financeLedgerReconciliation.js';
import { computeAllocationLedgerPostingState } from '../src/utils/ledgerTxFormHelpers.js';
import { buildFiscalSheetsPayload } from '../src/services/googleSheetsFinanceSyncService.js';
import {
  createIgpProjectService,
  LOCKER_STATUSES,
  IGP_PROJECT_TYPES,
} from '../src/services/igpProjectService.js';
import { ROLE_PERMISSIONS } from '../src/utils/permissions.js';

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

// Deterministic seeded PRNG for reproducible fuzz testing
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithRng(arr, rng) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 1: Ledger Reconciliation Order-Independence, Unlinked Reversals & Fuzz
// ════════════════════════════════════════════════════════════════════════════
console.log('=== Slice 1: Ledger Reconciliation Order-Independence & Fuzz Invariants ===');

// Default Firestore order is `createdAt desc` -> newer REVERSAL appears BEFORE older EXPENSE!
const descAccountTxs = [
  {
    id: 'rev-1',
    fundAccountId: 'fund_fiscal_year_budget',
    transactionType: TRANSACTION_TYPES.REVERSAL,
    reversedTransactionType: TRANSACTION_TYPES.EXPENSE,
    reversalOfTransactionId: 'exp-1',
    amountCentavos: 2000000, // ₱20,000 reversed
    status: TRANSACTION_STATUSES.POSTED,
  },
  {
    id: 'exp-1',
    fundAccountId: 'fund_fiscal_year_budget',
    transactionType: TRANSACTION_TYPES.EXPENSE,
    amountCentavos: 5000000, // ₱50,000 original expense (stayed posted)
    status: TRANSACTION_STATUSES.POSTED,
  },
];

const disbursedDesc = computeDisbursedByAccount(descAccountTxs).get('fund_fiscal_year_budget');
await check(
  'computeDisbursedByAccount is order-independent when unlinked REVERSAL precedes older EXPENSE (createdAt desc -> ₱30,000)',
  disbursedDesc === 3000000,
  `expected 3000000, got ${disbursedDesc}`
);

const descAllocTxs = [
  {
    id: 'rev-a1',
    fundAccountId: 'fund_fiscal_year_budget',
    budgetAllocationId: 'alloc-1',
    transactionType: TRANSACTION_TYPES.REVERSAL,
    reversedTransactionType: TRANSACTION_TYPES.EXPENSE,
    reversalOfTransactionId: 'exp-a1',
    amountCentavos: 1500000, // ₱15,000 reversed
    status: TRANSACTION_STATUSES.POSTED,
  },
  {
    id: 'exp-a1',
    fundAccountId: 'fund_fiscal_year_budget',
    budgetAllocationId: 'alloc-1',
    transactionType: TRANSACTION_TYPES.EXPENSE,
    amountCentavos: 4000000, // ₱40,000 original expense
    status: TRANSACTION_STATUSES.POSTED,
  },
];

const allocDisbursedDesc = computeDisbursedByAllocation(descAllocTxs).get('alloc-1');
await check(
  'computeDisbursedByAllocation is order-independent when unlinked REVERSAL precedes older EXPENSE (createdAt desc -> ₱25,000)',
  allocDisbursedDesc === 2500000,
  `expected 2500000, got ${allocDisbursedDesc}`
);

// Unlinked REVERSAL of an EXPENSE must credit fund back (+amount), NOT double-deduct (-amount)!
const unlinkedExpenseReversalTxs = [
  {
    id: 'col-igf',
    fundAccountId: 'fund_igf_main',
    transactionType: TRANSACTION_TYPES.COLLECTION,
    amountCentavos: 1000000, // +₱10,000
    status: TRANSACTION_STATUSES.POSTED,
  },
  {
    id: 'exp-igf',
    fundAccountId: 'fund_igf_main',
    transactionType: TRANSACTION_TYPES.EXPENSE,
    amountCentavos: 300000, // -₱3,000 (stayed posted)
    status: TRANSACTION_STATUSES.POSTED,
  },
  {
    id: 'rev-exp-igf',
    fundAccountId: 'fund_igf_main',
    transactionType: TRANSACTION_TYPES.REVERSAL,
    reversedTransactionType: TRANSACTION_TYPES.EXPENSE,
    reversalOfTransactionId: 'exp-igf',
    amountCentavos: 300000, // reverses the -₱3,000 expense -> +₱3,000
    status: TRANSACTION_STATUSES.POSTED,
  },
];

const igfNetAfterUnlinkedExpRev = computeLedgerNetByAccount(unlinkedExpenseReversalTxs).get('fund_igf_main');
await check(
  'computeLedgerNetByAccount credits back (+amount) for unlinked EXPENSE reversal (₱10k - ₱3k + ₱3k = ₱10k)',
  igfNetAfterUnlinkedExpRev === 1000000,
  `expected 1000000, got ${igfNetAfterUnlinkedExpRev}`
);

// Unlinked REVERSAL of a COLLECTION (legacy MERCHANDISE_ORDER_REVERSAL without reversedTransactionType) still debits (-amount)
const unlinkedCollectionRevTxs = [
  {
    id: 'col-ord',
    refNumber: 'IGF-ORD-1',
    fundAccountId: 'fund_igf_main',
    transactionType: TRANSACTION_TYPES.COLLECTION,
    amountCentavos: 500000,
    status: TRANSACTION_STATUSES.POSTED,
  },
  {
    id: 'rev-ord',
    reversalOfTransactionId: 'IGF-ORD-1',
    fundAccountId: 'fund_igf_main',
    transactionType: TRANSACTION_TYPES.REVERSAL,
    source: 'MERCHANDISE_ORDER_REVERSAL',
    amountCentavos: 500000,
    status: TRANSACTION_STATUSES.POSTED,
  },
];
const igfNetAfterOrderRev = computeLedgerNetByAccount(unlinkedCollectionRevTxs).get('fund_igf_main');
await check(
  'computeLedgerNetByAccount still debits (-amount) for legacy unlinked MERCHANDISE_ORDER_REVERSAL (₱5k - ₱5k = ₱0)',
  igfNetAfterOrderRev === 0,
  `expected 0, got ${igfNetAfterOrderRev}`
);

// Property / Fuzz test: 200 random orderings must produce identical balances & disbursements
const fuzzDataset = [
  ...descAccountTxs,
  ...descAllocTxs,
  ...unlinkedExpenseReversalTxs,
  {
    id: 'xfer-1',
    fundAccountId: 'fund_igf_main',
    transferDestinationAccountId: 'fund_igp_main',
    transactionType: TRANSACTION_TYPES.TRANSFER,
    amountCentavos: 250000,
    status: TRANSACTION_STATUSES.POSTED,
  },
  {
    id: 'exp-std-rev',
    fundAccountId: 'fund_igp_main',
    transactionType: TRANSACTION_TYPES.EXPENSE,
    amountCentavos: 100000,
    status: TRANSACTION_STATUSES.REVERSED,
  },
  {
    id: 'rev-std',
    fundAccountId: 'fund_igp_main',
    transactionType: TRANSACTION_TYPES.REVERSAL,
    reversedTransactionType: TRANSACTION_TYPES.EXPENSE,
    reversalOfTransactionId: 'exp-std-rev',
    amountCentavos: 100000,
    status: TRANSACTION_STATUSES.POSTED,
  },
];
const baselineNet = JSON.stringify([...computeLedgerNetByAccount(fuzzDataset).entries()].sort());
const baselineDisb = JSON.stringify([...computeDisbursedByAccount(fuzzDataset).entries()].sort());
const baselineAlloc = JSON.stringify([...computeDisbursedByAllocation(fuzzDataset).entries()].sort());
const rng = mulberry32(20261124);
let fuzzAllMatch = true;
for (let i = 0; i < 200; i++) {
  const perm = shuffleWithRng(fuzzDataset, rng);
  const n = JSON.stringify([...computeLedgerNetByAccount(perm).entries()].sort());
  const d = JSON.stringify([...computeDisbursedByAccount(perm).entries()].sort());
  const a = JSON.stringify([...computeDisbursedByAllocation(perm).entries()].sort());
  if (n !== baselineNet || d !== baselineDisb || a !== baselineAlloc) {
    fuzzAllMatch = false;
    break;
  }
}
await check(
  '200-permutation fuzz invariant: ledger net, account disbursed, and allocation disbursed are strictly order-invariant',
  fuzzAllMatch
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 2: Validation, Allocation Caps, Archived Blocks & Service Edge Cases
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 2: Validation, Allocation Caps, Archived Blocks & Service Edge Cases ===');

const archivedTxValidation = validateTransactionRules({
  fundAccountId: 'fund_fiscal_year_budget',
  fundCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
  transactionType: TRANSACTION_TYPES.EXPENSE,
  expensePurpose: 'Event Itemized Expense',
  amountCentavos: 100000,
  allocationId: 'alloc-arch',
  allocationStatus: 'archived',
  resolutionRef: 'RES-2026-99',
  availableBalanceCentavos: 5000000,
  availableAllocationCentavos: 500000,
});
await check(
  'validateTransactionRules rejects posting expense against an archived budget allocation',
  archivedTxValidation.isValid === false &&
    archivedTxValidation.errors.some((e) => /archived/i.test(e)),
  JSON.stringify(archivedTxValidation)
);

const archivedPostingState = computeAllocationLedgerPostingState(
  { id: 'alloc-arch', status: 'archived', approvedAmountCentavos: 500000, spentAmountCentavos: 0 },
  0
);
await check(
  'computeAllocationLedgerPostingState marks archived allocations as canPostToLedger: false',
  archivedPostingState.canPostToLedger === false,
  JSON.stringify(archivedPostingState)
);

const transferIntoFiscal = validateTransactionRules({
  fundAccountId: 'fund_igf_main',
  fundCategory: TOP_LEVEL_FUNDS.IGF,
  transactionType: TRANSACTION_TYPES.TRANSFER,
  amountCentavos: 100000,
  transferDestinationAccountId: 'fund_fiscal_year_budget',
  availableBalanceCentavos: 500000,
});
await check(
  'validateTransactionRules blocks TRANSFER into fixed Fiscal/FSG appropriation pools so transferred money cannot silently vanish',
  transferIntoFiscal.isValid === false &&
    transferIntoFiscal.errors.some((e) => /fiscal|fsg|appropriation/i.test(e)),
  JSON.stringify(transferIntoFiscal)
);

const auditorApproval = validateSupplierPaymentApproval({
  createdById: 'u-fin',
  approverId: 'u-aud',
  approverRole: 'auditor',
  existingApprovals: [],
});
const vpApproval = validateSupplierPaymentApproval({
  createdById: 'u-fin',
  approverId: 'u-vp',
  approverRole: 'vice_president',
  existingApprovals: [],
});
await check(
  'validateSupplierPaymentApproval allows auditor and vice_president (matching ROLE_PERMISSIONS.canApproveFinance)',
  auditorApproval.isValid === true && vpApproval.isValid === true,
  `auditor=${JSON.stringify(auditorApproval)}, vp=${JSON.stringify(vpApproval)}`
);

const financeServiceSrc = readFileSync(new URL('../src/services/financeService.js', import.meta.url), 'utf8');
const createAllocBody = financeServiceSrc.slice(
  financeServiceSrc.indexOf('async createBudgetAllocation('),
  financeServiceSrc.indexOf('async updateBudgetAllocation(')
);
const updateAllocBody = financeServiceSrc.slice(
  financeServiceSrc.indexOf('async updateBudgetAllocation('),
  financeServiceSrc.indexOf('async deleteBudgetAllocation(')
);
const restoreAllocBody = financeServiceSrc.slice(
  financeServiceSrc.indexOf('async restoreBudgetAllocation('),
  financeServiceSrc.indexOf('async recordTransaction(')
);
const preOrderCreateBody = financeServiceSrc.slice(
  financeServiceSrc.indexOf('async createPreOrderBatch('),
  financeServiceSrc.indexOf('async recordStudentPreOrderPayment(')
);
const preOrderPayBody = financeServiceSrc.slice(
  financeServiceSrc.indexOf('async recordStudentPreOrderPayment('),
  financeServiceSrc.indexOf('async getPreOrderBatches(')
);

await check(
  'createBudgetAllocation skips fiscal/FSG cap for drafts and uses appropriatedCeilingCentavos for both Fiscal and FSG',
  /allocationData\.status\s*!==\s*['"]draft['"]/.test(createAllocBody) &&
    /fund_fsg_remittance/.test(createAllocBody) &&
    /appropriatedCeilingCentavos/.test(createAllocBody),
  'createBudgetAllocation either caps drafts or ignores FSG appropriatedCeilingCentavos'
);

await check(
  'updateBudgetAllocation enforces fiscal/FSG ceiling cap even when promoting a draft to approved without allocatedAmount in updateData',
  /const effectiveStatus = patch\.status \|\| current\.status \|\| 'approved'/.test(updateAllocBody) &&
    /const effectiveAmountCentavos =[\s\S]*?patch\.approvedAmountCentavos/.test(updateAllocBody) &&
    /fund_fsg_remittance/.test(updateAllocBody),
  'updateBudgetAllocation only ran cap check inside allocatedAmount branch'
);

await check(
  'restoreBudgetAllocation checks fiscal/FSG ceiling cap before restoring archived allocation',
  /appropriatedCeilingCentavos/.test(restoreAllocBody) &&
    /exceed/i.test(restoreAllocBody),
  'restoreBudgetAllocation restores archived allocations without ceiling validation'
);

await check(
  'createPreOrderBatch & recordStudentPreOrderPayment validate positive amounts, positive integer quantity, studentName, and OPEN_FOR_PREORDERS status',
  /unitPriceCentavos\s*<=\s*0/.test(preOrderCreateBody) &&
    /paidCentavos\s*<=\s*0/.test(preOrderPayBody) &&
    /OPEN_FOR_PREORDERS/.test(preOrderPayBody) &&
    /Number\.isInteger/.test(preOrderPayBody),
  'Pre-order batch creation or student payment accepts invalid amounts, quantities, or closed batches'
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 3: Google Sheets Fiscal Export Accuracy
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 3: Google Sheets Fiscal Export Accuracy ===');

const sheetsPayload = buildFiscalSheetsPayload({
  funds: [
    {
      id: 'fund_fiscal_year_budget',
      displayName: 'SSG Fiscal Year Budget',
      balanceCentavos: 32600000,
      bankAccountReference: 'BDO ****2005',
      fiscalYear: 2026,
    },
  ],
  budgets: [
    {
      id: 'alloc-1',
      activityName: 'Campus Intramurals 2026',
      resolutionRef: 'BOR-RES-2026-01',
      fundAccountId: 'fund_fiscal_year_budget',
      approvedAmountCentavos: 5000000, // ₱50,000
      spentAmountCentavos: 1740000, // ₱17,400
      status: 'approved',
    },
    {
      id: 'alloc-arch',
      activityName: 'Archived Old Event',
      resolutionRef: 'BOR-RES-2025-99',
      fundAccountId: 'fund_fiscal_year_budget',
      approvedAmountCentavos: 9000000,
      spentAmountCentavos: 9000000,
      status: 'archived',
    },
  ],
  transactions: [
    {
      id: 'doc-tx-1',
      refNumber: 'TXN-123456-789',
      fundAccountId: 'fund_fiscal_year_budget',
      transactionType: 'expense',
      amountCentavos: 1740000,
      description: 'Intramurals supplies',
      createdBy: 'Sec. Maria',
      resolutionRef: 'BOR-RES-2026-01',
      status: 'reversed',
      reversalReason: 'Misinput',
      createdAt: '2026-11-24T00:00:00.000Z',
    },
  ],
});

const summaryRows = sheetsPayload.sheets[0].rows;
const ledgerRows = sheetsPayload.sheets[1].rows;
const allocRows = sheetsPayload.sheets[2].rows;

await check(
  'buildFiscalSheetsPayload reads raw Firestore budgetAllocations (approvedAmountCentavos/spentAmountCentavos/activityName) and excludes archived from KPIs',
  summaryRows[1][1] === '50000.00' &&
    summaryRows[2][1] === '17400.00' &&
    summaryRows[3][1] === '32600.00' &&
    allocRows.length === 1 &&
    allocRows[0][0] === 'Campus Intramurals 2026' &&
    allocRows[0][3] === '50000.00' &&
    allocRows[0][4] === '17400.00' &&
    allocRows[0][5] === '32600.00',
  `summary=${JSON.stringify(summaryRows)}, allocRows=${JSON.stringify(allocRows)}`
);

await check(
  'buildFiscalSheetsPayload exports tx.refNumber, tx.createdBy fallback, and detects status==="reversed" as REVERSED',
  ledgerRows[0][1] === 'TXN-123456-789' &&
    ledgerRows[0][7] === 'Sec. Maria' &&
    ledgerRows[0][9] === 'REVERSED: Misinput',
  `ledgerRow=${JSON.stringify(ledgerRows[0])}`
);

const exportPanelSrc = readFileSync(
  new URL('../src/components/Finance/FinanceReportExportPanel.jsx', import.meta.url),
  'utf8'
);
await check(
  'FinanceReportExportPanel.jsx uses userName/userRole from useAuth() and never defaults unknown role to "admin"',
  exportPanelSrc.includes('userName') &&
    exportPanelSrc.includes('userRole') &&
    !exportPanelSrc.includes('userProfile') &&
    !exportPanelSrc.includes("role || 'admin'"),
  'FinanceReportExportPanel still references nonexistent userProfile or falls back to admin'
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 4: IGP Project Service Edge Cases (Maintenance Lockers & Double-Reversal)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 4: IGP Project Service Edge Cases ===');

{
  const lockers = new Map([
    [
      'HM-L01',
      {
        lockerId: 'HM-L01',
        buildingName: 'HM Building',
        status: LOCKER_STATUSES.MAINTENANCE,
        monthlyRatePHP: 100,
        currentLease: null,
      },
    ],
  ]);
  const cols = new Map();
  let igpBal = 0;
  const postedTxs = [];

  const mockDb = {
    async getLocker(id) {
      return lockers.get(id) || null;
    },
    async listLockers() {
      return Array.from(lockers.values());
    },
    async saveLocker(id, data) {
      lockers.set(id, data);
      return data;
    },
    async addCollection(data) {
      const id = `col-${cols.size + 1}`;
      const rec = { id, ...data };
      cols.set(id, rec);
      return rec;
    },
    async getCollection(id) {
      return cols.get(id) || null;
    },
    async listCollections() {
      return Array.from(cols.values());
    },
    async deleteCollection(id) {
      cols.delete(id);
      return true;
    },
    async updateIgpFundBalance(delta, meta) {
      igpBal = Math.max(0, igpBal + delta);
      if (meta?.postToLedger !== false && meta?.transaction) {
        const txId = `tx-${postedTxs.length + 1}`;
        postedTxs.push({ id: txId, ...meta.transaction });
        return { balanceCentavos: igpBal, ledgerTxId: txId, ledgerRefNumber: meta.transaction.refNumber };
      }
      return { balanceCentavos: igpBal, ledgerTxId: null, ledgerRefNumber: null };
    },
  };

  const igpSvc = createIgpProjectService({ db: mockDb });

  let maintBlocked = false;
  try {
    await igpSvc.rentLockerUnit('HM-L01', { renterName: 'Student A', months: 1 }, { uid: 'u1', name: 'Gov' });
  } catch (err) {
    maintBlocked = err.code === 'LOCKER_IN_MAINTENANCE' || /maintenance/i.test(err.message);
  }
  await check(
    'igpProjectService.rentLockerUnit rejects renting a locker in MAINTENANCE status',
    maintBlocked && lockers.get('HM-L01').status === LOCKER_STATUSES.MAINTENANCE,
    `maintBlocked=${maintBlocked}, status=${lockers.get('HM-L01').status}`
  );
}

const igpServiceSrc = readFileSync(new URL('../src/services/igpProjectService.js', import.meta.url), 'utf8');
const igpManagerSrc = readFileSync(new URL('../src/components/Finance/IgpProjectManager.jsx', import.meta.url), 'utf8');
await check(
  'igpProjectService browser adapter marks original IGP collection transaction status="reversed" when reversing to prevent double-reversal in FundGovernance',
  /isReversal[\s\S]*?status:\s*TRANSACTION_STATUSES\.REVERSED/.test(igpServiceSrc),
  'Original IGP collection transaction stays posted after deleteVendingCollection, allowing double-reversal in FundGovernance'
);

await check(
  'IgpProjectManager.jsx uses usePermissions() instead of hardcoded role bypass and guards vending/custom/vacate actions',
  igpManagerSrc.includes('usePermissions') &&
    !/\[\s*'admin',\s*'president',\s*'auditor'/.test(igpManagerSrc),
  'IgpProjectManager still hardcodes role bypasses ignoring permissionOverrides'
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 5: RBAC Hook, UI Modals, Filters, Double-Submit & Provider Contracts
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 5: RBAC Hook, UI Filters, Modals, Double-Submit & Provider Contracts ===');

const usePermSrc = readFileSync(new URL('../src/hooks/usePermissions.js', import.meta.url), 'utf8');
const fundGovSrc = readFileSync(new URL('../src/components/Finance/FundGovernance.jsx', import.meta.url), 'utf8');
const ppmpMatrixSrc = readFileSync(new URL('../src/components/Finance/PPMPMatrix.jsx', import.meta.url), 'utf8');
const ppmpDrawerSrc = readFileSync(new URL('../src/components/Finance/PPMPInspectorDrawer.jsx', import.meta.url), 'utf8');
const ledgerModalSrc = readFileSync(new URL('../src/components/Finance/FinanceLedgerModal.jsx', import.meta.url), 'utf8');
const budgetMgmtSrc = readFileSync(new URL('../src/components/BudgetManager/BudgetManagement.jsx', import.meta.url), 'utf8');
const providerSrc = readFileSync(new URL('../src/components/FinanceContext/FinanceProvider.jsx', import.meta.url), 'utf8');
const auditSvcSrc = readFileSync(new URL('../src/services/financeAuditService.js', import.meta.url), 'utf8');

await check(
  'ROLE_PERMISSIONS.admin.permissions includes canApproveFinance: true and canAuditFinance: true',
  ROLE_PERMISSIONS.admin.permissions.canApproveFinance === true &&
    ROLE_PERMISSIONS.admin.permissions.canAuditFinance === true
);

await check(
  'usePermissions.js fixes canPostFinanceLedger/canReverseFinanceLedger (no broken checkAction call) and exports canApproveFinance, canAuditFinance, and role',
  !usePermSrc.includes("checkAction('canPostFinanceLedger')") &&
    !usePermSrc.includes("checkAction('canReverseFinanceLedger')") &&
    usePermSrc.includes('canApproveFinance:') &&
    usePermSrc.includes('canAuditFinance:') &&
    usePermSrc.includes('role: userRole'),
  'usePermissions.js still calls checkAction with wrong signature or misses canApproveFinance/canAuditFinance/role'
);

await check(
  'PPMPMatrix.jsx fixes Archived tab filter, excludes fund_igp_main (not stale fund_igp_water), and uses FSG ceiling',
  ppmpMatrixSrc.includes("statusFilter !== 'archived'") &&
    ppmpMatrixSrc.includes("'fund_igp_main'") &&
    !ppmpMatrixSrc.includes("'fund_igp_water'") &&
    /fsgAccount\?\.appropriatedCeilingCentavos/.test(ppmpMatrixSrc),
  'PPMPMatrix still hides all archived items, checks stale fund_igp_water, or uses post-disbursement FSG balance'
);

await check(
  'FundGovernance.jsx guards handleSubmitTx against double-submit, displays TRANSFER/collection REVERSAL as outflow (-), and aligns Actions column header/cell',
  fundGovSrc.includes('isSubmittingTx') &&
    /disabled=\{isUploadingReceipt \|\| isSubmittingTx\}/.test(fundGovSrc) &&
    /tx\.transactionType === TRANSACTION_TYPES\.TRANSFER/.test(fundGovSrc) &&
    fundGovSrc.includes('{canReverseFinanceLedger && <th>Actions</th>}'),
  'FundGovernance missing double-submit lock, TRANSFER outflow display, or table column alignment'
);

await check(
  'FinanceLedgerModal.jsx ReversalModal resets reason & error state when closed or switched to a new transaction',
  /useEffect\([\s\S]*?setReason\(''\)[\s\S]*?setError\(null\)/.test(ledgerModalSrc),
  'ReversalModal retains stale reason/error across openings'
);

await check(
  'PPMPInspectorDrawer.jsx gates Disburse buttons with canPostFinanceLedger (matching FundGovernance ledger operator authority)',
  ppmpDrawerSrc.includes('canPostFinanceLedger'),
  'PPMPInspectorDrawer lets non-ledger-operator roles disburse'
);

await check(
  'BudgetManagement.jsx derives canonical lifecycle status for filters, computes overBudgetCount from spent > allocated, and guards Edit/Delete with canEditFinance',
  budgetMgmtSrc.includes('usePermissions') &&
    budgetMgmtSrc.includes('canEditFinance') &&
    /sp\s*>\s*alloc/.test(budgetMgmtSrc),
  'BudgetManagement status filters, overBudgetCount, or RBAC guards are broken'
);

await check(
  'FinanceProvider.jsx avoids blind read-path reconciliation refresh loops (silent/guarded auto-heal)',
  !providerSrc.includes('getTransactions(100)') &&
    /silent:\s*true/.test(providerSrc),
  'FinanceProvider still passes dead arg getTransactions(100) or triggers non-silent reconciliation loops on read'
);

await check(
  'financeAuditService.js formats currency with ₱ (PHP) instead of $',
  !/\$\$\{/.test(auditSvcSrc) && auditSvcSrc.includes('₱${'),
  'financeAuditService.js still logs $ instead of ₱'
);

// ════════════════════════════════════════════════════════════════════════════
// SLICE 6: Live Firestore Rules Emulator — Finance Immutability & RBAC Parity
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 6: Live Firestore Rules Emulator — Finance Immutability & RBAC ===');

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
  if (!jar) throw new Error(`Firestore emulator JAR not found in ${cacheDir}.`);

  const port = await getFreePort();
  const proc = spawn('java', ['-jar', join(cacheDir, jar), '--host', '127.0.0.1', '--port', String(port)], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await isPortOpen('127.0.0.1', port)) {
      return { host: '127.0.0.1', port, stop: async () => proc.kill() };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  proc.kill();
  throw new Error('Timed out waiting for local Firestore Emulator JAR to listen.');
};

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
    await db.collection('users').doc('admin-1').set({ role: 'admin', isActive: true });
    await db.collection('users').doc('fin-sec-1').set({ role: 'finance_secretary', isActive: true });
    await db.collection('users').doc('auditor-1').set({ role: 'auditor', isActive: true });
    await db.collection('users').doc('sec-1').set({ role: 'secretary', isActive: true });
    await db.collection('users').doc('member-1').set({ role: 'member', isActive: true });
    await db.collection('users').doc('dead-fin').set({ role: 'finance_secretary', isActive: false });

    await db.collection('fundAccounts').doc('fund_fiscal_year_budget').set({
      balanceCentavos: 40000000,
      appropriatedCeilingCentavos: 40000000,
    });
    await db.collection('budgetAllocations').doc('alloc-1').set({
      fundAccountId: 'fund_fiscal_year_budget',
      approvedAmountCentavos: 5000000,
      status: 'approved',
    });
    await db.collection('transactions').doc('tx-posted').set({
      refNumber: 'TXN-001',
      fundAccountId: 'fund_fiscal_year_budget',
      transactionType: 'expense',
      amountCentavos: 1000000,
      budgetAllocationId: 'alloc-1',
      status: 'posted',
    });
    await db.collection('transactions').doc('tx-draft').set({
      refNumber: 'TXN-DRAFT',
      fundAccountId: 'fund_fiscal_year_budget',
      transactionType: 'expense',
      amountCentavos: 500000,
      status: 'draft',
    });
  });

  const asUser = (uid) => testEnv.authenticatedContext(uid).firestore();

  await check('Posted ledger transaction CANNOT be physically deleted even by admin (append-only immutability)', () =>
    assertFails(asUser('admin-1').collection('transactions').doc('tx-posted').delete())
  );

  await check('Posted ledger transaction CANNOT have amountCentavos tampered with during reversal update', () =>
    assertFails(
      asUser('fin-sec-1').collection('transactions').doc('tx-posted').update({
        status: 'reversed',
        amountCentavos: 1, // tampering attempt!
        reversalReason: 'Tamper',
      })
    )
  );

  await check('Legitimate reversal status flip on posted transaction SUCCEEDS when immutable fields are preserved', () =>
    assertSucceeds(
      asUser('fin-sec-1').collection('transactions').doc('tx-posted').update({
        status: 'reversed',
        reversalReason: 'Authorized correction',
      })
    )
  );

  await check('Draft transaction CAN still be deleted by finance_secretary', () =>
    assertSucceeds(asUser('fin-sec-1').collection('transactions').doc('tx-draft').delete())
  );

  await check('View-only secretary CAN read fundAccounts/allocations/transactions but CANNOT mutate budgetAllocations', async () => {
    await assertSucceeds(asUser('sec-1').collection('fundAccounts').doc('fund_fiscal_year_budget').get());
    await assertSucceeds(asUser('sec-1').collection('budgetAllocations').doc('alloc-1').get());
    await assertFails(
      asUser('sec-1').collection('budgetAllocations').doc('alloc-1').update({ approvedAmountCentavos: 999 })
    );
  });

  await check('Low-privilege member and deactivated finance_secretary CANNOT read or write finance collections', async () => {
    await assertFails(asUser('member-1').collection('fundAccounts').doc('fund_fiscal_year_budget').get());
    await assertFails(asUser('member-1').collection('transactions').doc('tx-posted').get());
    await assertFails(asUser('dead-fin').collection('fundAccounts').doc('fund_fiscal_year_budget').get());
    await assertFails(asUser('dead-fin').collection('transactions').doc('tx-posted').get());
  });

  await testEnv.cleanup();
} finally {
  await emulator.stop();
}

// ════════════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Results Summary ===');
for (const line of results) console.log(line);

if (failed > 0) {
  console.error(`\n❌ ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log(`\n✅ All ${results.length} Finance diagnostic checks passed.`);
  process.exit(0);
}
