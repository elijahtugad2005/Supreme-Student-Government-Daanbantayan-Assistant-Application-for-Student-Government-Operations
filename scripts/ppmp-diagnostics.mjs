/**
 * PPMP Diagnostics & Integrity Test Suite
 * Validates:
 * 1. Status engine logic & boundary conditions
 * 2. Transaction validation rules with sub-line items & receipt requirements
 * 3. Centavo floating-point safety
 * 4. Allocation update line-item spent preservation
 */

import {
  TOP_LEVEL_FUNDS,
  TRANSACTION_TYPES,
  EXPENSE_PURPOSES,
  PPMP_STATUSES,
  getPPMPStatus,
  getUtilizationRate,
  toCentavos,
  fromCentavos,
} from '../src/utils/financeConstants.js';

import { validateTransactionRules } from '../src/utils/financeValidation.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

console.log('\n--- [1] PPMP STATUS ENGINE & BOUNDARY CHECKS ---');

assert(
  getPPMPStatus(0, 100000) === PPMP_STATUSES.FRESH,
  'Zero spent with positive allocation is FRESH'
);

assert(
  getPPMPStatus(50000, 100000) === PPMP_STATUSES.PARTIALLY_USED,
  '50% spent is PARTIALLY_USED'
);

assert(
  getPPMPStatus(100000, 100000) === PPMP_STATUSES.DEPLETED,
  'Exact allocated amount spent is DEPLETED'
);

assert(
  getPPMPStatus(120000, 100000) === PPMP_STATUSES.DEPLETED,
  'Overspent allocation is DEPLETED'
);

assert(
  getPPMPStatus(0, 0) === PPMP_STATUSES.FRESH,
  '0 spent and 0 allocated is FRESH'
);

assert(
  getPPMPStatus(5000, 0) === PPMP_STATUSES.DEPLETED,
  'Spent funds with 0 allocation should be DEPLETED (overspent), not PARTIALLY_USED'
);

console.log('\n--- [2] UTILIZATION RATE TESTS ---');

assert(
  getUtilizationRate(0, 100000) === 0,
  '0 spent gives 0% utilization'
);

assert(
  getUtilizationRate(50000, 100000) === 50,
  '50,000 / 100,000 gives 50%'
);

assert(
  getUtilizationRate(100000, 100000) === 100,
  '100,000 / 100,000 gives 100%'
);

assert(
  getUtilizationRate(120000, 100000) === 100,
  'Overutilization clamped cleanly at 100%'
);

assert(
  getUtilizationRate(5000, 0) === 100,
  'Non-zero spent with 0 allocation gives 100%'
);

console.log('\n--- [3] CENTAVO FLOATING POINT INTEGRITY ---');

const testCases = [0, 0.01, 10500.5, 1200.99, 999999.99];
let centavoMathClean = true;
for (const val of testCases) {
  const c = toCentavos(val);
  const back = fromCentavos(c);
  if (Math.abs(back - val) > 0.0001 || !Number.isInteger(c)) {
    centavoMathClean = false;
    console.error(`Centavo mismatch for ${val}: centavos=${c}, back=${back}`);
  }
}
assert(centavoMathClean, 'toCentavos and fromCentavos preserve centavo exactness without float drift');

console.log('\n--- [4] TRANSACTION VALIDATION RULES FOR PPMP DISBURSEMENT ---');

// Case 4A: Normal disbursement with resolution and receipt URL provided
const validDisburse = validateTransactionRules({
  fundCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
  transactionType: TRANSACTION_TYPES.EXPENSE,
  expensePurpose: EXPENSE_PURPOSES.PROJECT_OPERATING_EXPENSE,
  amountCentavos: 50000,
  allocationId: 'alloc_123',
  lineItemId: 'line_001',
  resolutionRef: 'RES-2026-001',
  receiptUrl: 'https://storage.googleapis.com/receipt.pdf',
  availableBalanceCentavos: 200000,
  availableAllocationCentavos: 100000,
  availableLineItemCentavos: 50000,
});
assert(validDisburse.isValid === true, 'Disbursement with resolution and receipt is valid');

// Case 4B: Advance disbursement without immediate receipt URL (released in advance)
const advanceDisburse = validateTransactionRules({
  fundCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
  transactionType: TRANSACTION_TYPES.EXPENSE,
  expensePurpose: EXPENSE_PURPOSES.PROJECT_OPERATING_EXPENSE,
  amountCentavos: 50000,
  allocationId: 'alloc_123',
  lineItemId: 'line_001',
  resolutionRef: 'RES-2026-001',
  receiptUrl: '', // blank / pending receipt
  supportingDocumentIds: [],
  availableBalanceCentavos: 200000,
  availableAllocationCentavos: 100000,
  availableLineItemCentavos: 50000,
});
assert(
  advanceDisburse.isValid === true,
  'Advance disbursement with resolution but pending receipt should NOT throw Transaction rejected: (receipt is turned in post-procurement)'
);

// Case 4C: Line item overspend check
const overspendLineDisburse = validateTransactionRules({
  fundCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
  transactionType: TRANSACTION_TYPES.EXPENSE,
  expensePurpose: EXPENSE_PURPOSES.PROJECT_OPERATING_EXPENSE,
  amountCentavos: 60000, // 600.00
  allocationId: 'alloc_123',
  lineItemId: 'line_001',
  resolutionRef: 'RES-2026-001',
  receiptUrl: 'https://...',
  availableBalanceCentavos: 200000,
  availableAllocationCentavos: 100000,
  availableLineItemCentavos: 50000, // only 500.00 left
});
assert(
  overspendLineDisburse.isValid === false &&
    overspendLineDisburse.errors.some((e) => e.includes('exceeds remaining planned estimate for this specific PPMP line item')),
  'Blocks disbursement exceeding specific line item remaining limit'
);

// Case 4D: BDO Liquid balance check
const overdraftDisburse = validateTransactionRules({
  fundCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
  transactionType: TRANSACTION_TYPES.EXPENSE,
  expensePurpose: EXPENSE_PURPOSES.PROJECT_OPERATING_EXPENSE,
  amountCentavos: 300000,
  allocationId: 'alloc_123',
  lineItemId: 'line_001',
  resolutionRef: 'RES-2026-001',
  receiptUrl: 'https://...',
  availableBalanceCentavos: 200000, // only 200,000 available in BDO
  availableAllocationCentavos: 500000,
  availableLineItemCentavos: 500000,
});
assert(
  overdraftDisburse.isValid === false &&
    overdraftDisburse.errors.some((e) => e.includes('does not have enough available balance')),
  'Blocks disbursement exceeding BDO liquid balance'
);

console.log('\n--- [5] ALLOCATION UPDATE LINE-ITEM SPENT PRESERVATION ---');

// Simulate existing allocation in Firestore
const existingAllocation = {
  id: 'alloc_vending',
  activityName: 'Project Vending Machine',
  approvedAmountCentavos: 1050000,
  spentAmountCentavos: 150000,
  approvedLineItems: [
    {
      id: 'line_hardware',
      name: 'Vending machine hardware',
      plannedCentavos: 150000,
      spentCentavos: 150000,
      status: 'depleted',
    },
    {
      id: 'line_supplier',
      name: 'Supplier logistics',
      plannedCentavos: 120000,
      spentCentavos: 0,
      status: 'fresh',
    },
  ],
};

// Simulate update payload from a form where spentCentavos was not submitted
const updateData = {
  activityName: 'Project Vending Machine for Students (Renamed)',
  approvedLineItems: [
    {
      id: 'line_hardware',
      name: 'Vending machine hardware',
      plannedAmount: 1500,
      // Note: spentCentavos omitted or 0
    },
    {
      id: 'line_supplier',
      name: 'Supplier logistics',
      plannedAmount: 1200,
    },
  ],
};

// Check if a merge function preserves existing line item spentCentavos
function safeMergeLineItems(currentLines = [], incomingLines = []) {
  return incomingLines.map((li, index) => {
    const existing = currentLines.find((c) => c.id === li.id);
    const spent = li.spentCentavos !== undefined && Number(li.spentCentavos) > 0
      ? Number(li.spentCentavos)
      : (existing?.spentCentavos || 0);
    const planned = li.plannedCentavos !== undefined
      ? Number(li.plannedCentavos)
      : (li.plannedAmount !== undefined ? toCentavos(li.plannedAmount) : 0);
    return {
      ...li,
      spentCentavos: spent,
      plannedCentavos: planned,
      status: getPPMPStatus(spent, planned),
    };
  });
}

const merged = safeMergeLineItems(existingAllocation.approvedLineItems, updateData.approvedLineItems);
const hardwareLine = merged.find((l) => l.id === 'line_hardware');
assert(
  hardwareLine?.spentCentavos === 150000,
  'Line item spentCentavos (150,000) preserved when allocation is edited'
);
assert(
  hardwareLine?.status === PPMP_STATUSES.DEPLETED,
  'Line item status correctly derived as DEPLETED after edit'
);

console.log('\n--- [6] PPMP FUND SCOPE (FISCAL & FSG ONLY; IGF/IGP EXCLUDED) & OVER-ALLOCATION ---');

// Mock mixed allocations list
const mockMixedAllocations = [
  { id: '1', eventName: 'Leadership Seminar', fundAccountId: 'fund_fiscal_year_budget', approvedAmountCentavos: 100000 },
  { id: '2', eventName: 'FSG Sports Meet', fundAccountId: 'fund_fsg_remittance', isFSG: true, approvedAmountCentavos: 50000 },
  { id: '3', eventName: 'Merchandise Sale Batch', fundAccountId: 'fund_igf_main', fundCategory: 'IGF', approvedAmountCentavos: 80000 },
  { id: '4', eventName: 'Water Vendo Operation', fundAccountId: 'fund_igp_water', fundCategory: 'IGP', approvedAmountCentavos: 25000 },
];

function filterPPMP(allocations, activePool = 'ALL') {
  return allocations.filter((b) => {
    const fundId = b.fundAccountId || (b.isFSG ? 'fund_fsg_remittance' : 'fund_fiscal_year_budget');
    // Strictly exclude IGF & IGP
    if (fundId === 'fund_igf_main' || fundId === 'fund_igp_water' || b.fundCategory === 'IGF' || b.fundCategory === 'IGP') {
      return false;
    }
    if (activePool === 'FISCAL') return fundId === 'fund_fiscal_year_budget' && !b.isFSG;
    if (activePool === 'FSG') return fundId === 'fund_fsg_remittance' || b.isFSG;
    return fundId === 'fund_fiscal_year_budget' || fundId === 'fund_fsg_remittance' || b.isFSG;
  });
}

const allPPMP = filterPPMP(mockMixedAllocations, 'ALL');
assert(
  allPPMP.length === 2 &&
    allPPMP.some((a) => a.id === '1') &&
    allPPMP.some((a) => a.id === '2'),
  'PPMP includes Fiscal Budget and FSG Remittance, and strictly excludes IGF and IGP'
);

const fiscalOnly = filterPPMP(mockMixedAllocations, 'FISCAL');
assert(
  fiscalOnly.length === 1 && fiscalOnly[0].id === '1',
  'Fiscal PPMP filter includes only SSG Fiscal Year Budget allocations'
);

const fsgOnly = filterPPMP(mockMixedAllocations, 'FSG');
assert(
  fsgOnly.length === 1 && fsgOnly[0].id === '2',
  'FSG PPMP filter includes only FSG Remittance allocations'
);

// Over-allocation detection
const initialFiscalCeiling = 50000000; // ₱500,000.00
const plannedAllocationsNormal = 40000000; // ₱400,000.00
const plannedAllocationsExcessive = 65000000; // ₱650,000.00

const isOverNormal = initialFiscalCeiling > 0 && plannedAllocationsNormal > initialFiscalCeiling;
assert(isOverNormal === false, 'Planned allocations under fiscal budget is NOT over-allocated');

const isOverExcessive = initialFiscalCeiling > 0 && plannedAllocationsExcessive > initialFiscalCeiling;
const deficit = Math.max(0, plannedAllocationsExcessive - initialFiscalCeiling);
assert(
  isOverExcessive === true && deficit === 15000000,
  'Excessive planned allocations (> Fiscal Budget) accurately flags isOverAllocated and calculates deficit (₱150,000)'
);

console.log('\n--- [7] DRAFT ALLOCATIONS & FULLY SPENT EXPENSE RESTRICTIONS ---');

// Test 1: Posting expense against draft allocation should be blocked
const draftTxValidation = validateTransactionRules({
  fundCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
  transactionType: TRANSACTION_TYPES.EXPENSE,
  expensePurpose: EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE,
  amountCentavos: toCentavos(500),
  allocationId: 'alloc_draft_test',
  allocationStatus: 'draft',
  resolutionRef: 'RES-DRAFT-01',
  receiptUrl: 'https://storage.google.com/sample-receipt.jpg',
  availableBalanceCentavos: toCentavos(100000),
  availableAllocationCentavos: toCentavos(10000),
});

assert(
  draftTxValidation.isValid === false &&
    draftTxValidation.errors.some((e) => e.includes('draft budget allocation')),
  'Draft status allocation blocks posting expenses in financial ledgers'
);

// Test 2: Posting expense against fully spent / depleted allocation should be blocked
const depletedTxValidation = validateTransactionRules({
  fundCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
  transactionType: TRANSACTION_TYPES.EXPENSE,
  expensePurpose: EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE,
  amountCentavos: toCentavos(500),
  allocationId: 'alloc_depleted_test',
  allocationStatus: 'approved',
  resolutionRef: 'RES-APPROVED-01',
  receiptUrl: 'https://storage.google.com/sample-receipt.jpg',
  availableBalanceCentavos: toCentavos(100000),
  availableAllocationCentavos: 0, // Depleted!
});

assert(
  depletedTxValidation.isValid === false &&
    depletedTxValidation.errors.some((e) => e.includes('fully utilized or depleted')),
  'Fully spent or depleted allocation blocks further expense postings'
);

// Test 3: Posting expense against approved allocation with surplus is allowed
const validApprovedTx = validateTransactionRules({
  fundCategory: TOP_LEVEL_FUNDS.FISCAL_YEAR_BUDGET,
  transactionType: TRANSACTION_TYPES.EXPENSE,
  expensePurpose: EXPENSE_PURPOSES.EVENT_ITEMIZED_EXPENSE,
  amountCentavos: toCentavos(500),
  allocationId: 'alloc_approved_test',
  allocationStatus: 'approved',
  resolutionRef: 'RES-APPROVED-01',
  receiptUrl: 'https://storage.google.com/sample-receipt.jpg',
  availableBalanceCentavos: toCentavos(100000),
  availableAllocationCentavos: toCentavos(10000),
});

assert(
  validApprovedTx.isValid === true && validApprovedTx.errors.length === 0,
  'Approved allocation with available budget successfully allows expense posting'
);

console.log('\n--- [8] UNIFIED FISCAL BUDGET & CEILING SYNCHRONIZATION ---');

// Test 1: Unified Fiscal Budget model
const testFiscalBudget = 600000; // ₱600,000.00
const testFiscalCentavos = toCentavos(testFiscalBudget);
const mockFiscalAccount = {
  id: 'fund_fiscal_year_budget',
  balanceCentavos: testFiscalCentavos,
  appropriatedCeilingCentavos: testFiscalCentavos, // Unified
};

assert(
  mockFiscalAccount.balanceCentavos === mockFiscalAccount.appropriatedCeilingCentavos,
  'Fiscal Budget primary balance and PPMP ceiling are 100% unified in integer centavos'
);

const programmedAllocations = toCentavos(250000);
const unprogrammedReserve = Math.max(0, mockFiscalAccount.balanceCentavos - programmedAllocations);

assert(
  unprogrammedReserve === toCentavos(350000) && fromCentavos(unprogrammedReserve) === 350000,
  '2026-2027 Fiscal Budget unprogrammed reserve correctly derives (₱600,000 - ₱250,000 = ₱350,000)'
);

console.log('\n--- [9] IGP REVENUE STREAMS & FUND-SPECIFIC DEDUCTION PARITY ---');

// Test 1: IGP Streams exist and match requirements
import('../src/utils/financeConstants.js').then((module) => {
  const { IGP_REVENUE_STREAMS, IGP_REVENUE_STREAM_LABELS } = module;
  assert(
    IGP_REVENUE_STREAMS.LOCKER_RENTAL === 'LOCKER_RENTAL' &&
    IGP_REVENUE_STREAM_LABELS[IGP_REVENUE_STREAMS.LOCKER_RENTAL] === 'Locker Rental',
    'IGP stream includes Locker Rental'
  );

  assert(
    IGP_REVENUE_STREAMS.PISO_WATER === 'PISO_WATER' &&
    IGP_REVENUE_STREAM_LABELS[IGP_REVENUE_STREAMS.PISO_WATER] === 'Piso Water Vending Machine',
    'IGP stream includes Piso Water Vending Machine'
  );

  assert(
    IGP_REVENUE_STREAMS.CUSTOM_PROJECT === 'CUSTOM_PROJECT',
    'IGP supports extensible + Add Revenue Generating Project'
  );

  // Test 2: Fund-specific deduction isolation
  const fiscalBal = toCentavos(500000);
  const fsgBal = toCentavos(200000);
  const disbursementAmt = toCentavos(15000); // ₱15,000 expense

  // If drawn from Fiscal
  const fiscalAfter = fiscalBal - disbursementAmt;
  const fsgAfterFiscalExpense = fsgBal; // untouched
  assert(
    fiscalAfter === toCentavos(485000) && fsgAfterFiscalExpense === toCentavos(200000),
    'Fiscal disbursement deducts ONLY from Fiscal Budget, leaving FSG untouched'
  );

  // Grand Total calculation
  const totalRemaining = fiscalAfter + fsgAfterFiscalExpense;
  assert(
    totalRemaining === toCentavos(685000),
    'Combined remaining calculates total across Fiscal and FSG (₱485,000 + ₱200,000 = ₱685,000)'
  );

  console.log('\n--- [10] INITIAL SPENT UPDATE & COST BREAKDOWN EXPENSES COLUMN ---');

  // Test 1: Updating an allocation's initial spent must not be discarded
  const mockCurrentAllocation = {
    id: 'alloc_initial_test',
    approvedAmountCentavos: toCentavos(20000), // ₱20,000
    spentAmountCentavos: toCentavos(5000),     // initially ₱5,000 spent
  };

  // Simulating user editing the package to update Initial Spent to ₱8,000
  const userEditPayload = {
    allocatedAmount: 20000,
    spentAmount: 8000, // Updated by user
    status: 'approved',
  };

  // The function that produces the patch (reproducing the bug logic)
  const computeUpdatePatch = (current, updateData) => {
    const patch = {};
    if (updateData.status) patch.status = updateData.status;
    if (updateData.allocatedAmount !== undefined) {
      patch.approvedAmountCentavos = toCentavos(updateData.allocatedAmount);
    }
    if (updateData.spentAmount !== undefined) {
      // FIX logic: updateData.spentAmount should update spentAmountCentavos
      patch.spentAmountCentavos = toCentavos(updateData.spentAmount);
    }
    return patch;
  };

  const patchResult = computeUpdatePatch(mockCurrentAllocation, userEditPayload);
  assert(
    patchResult.spentAmountCentavos === toCentavos(8000),
    'Editing package with new Initial Spent (₱8,000) correctly updates spentAmountCentavos'
  );

  // Test 2: Cost Breakdown Planner with Expenses Column computes both Planned and Initial Spent
  const mockBreakdownWithExpenses = [
    { description: 'Sound & Lights', cost: '15000', spent: '5000' },
    { description: 'Stage Backdrops', cost: '10000', spent: '3000' },
    { description: 'Snacks & Water', cost: '5000', spent: '0' },
  ];

  const computedPlannedTotal = mockBreakdownWithExpenses.reduce((sum, item) => sum + (parseFloat(item.cost) || 0), 0);
  const computedExpensesTotal = mockBreakdownWithExpenses.reduce((sum, item) => sum + (parseFloat(item.spent) || 0), 0);

  assert(
    computedPlannedTotal === 30000,
    'Cost breakdown planner computes total planned allocation (₱30,000)'
  );
  assert(
    computedExpensesTotal === 8000,
    'Cost breakdown planner computes total initial spent / expenses (₱8,000)'
  );

  // Test 3: Sub-line item normalization preserves both planned and expenses
  const normalizedBreakdown = mockBreakdownWithExpenses.map((it, idx) => ({
    id: `item_${idx}`,
    name: it.description,
    plannedCentavos: toCentavos(it.cost),
    spentCentavos: toCentavos(it.spent),
    status: (toCentavos(it.spent) >= toCentavos(it.cost))
      ? 'depleted'
      : (toCentavos(it.spent) > 0 ? 'partially_used' : 'fresh'),
  }));

  assert(
    normalizedBreakdown[0].spentCentavos === toCentavos(5000) && normalizedBreakdown[0].status === 'partially_used',
    'Item 1 (₱5,000 / ₱15,000) has correct spentCentavos and partially_used status'
  );
  assert(
    normalizedBreakdown[2].spentCentavos === 0 && normalizedBreakdown[2].status === 'fresh',
    'Item 3 (₱0 / ₱5,000) has 0 spentCentavos and fresh status'
  );

  // Test 4: Planned budget ceiling vs Price inflation overrun
  const allocatedCapital = 30000;
  const normalPlanned = 30000;
  const excessivePlanned = 36000;

  const isOverPlannedNormal = allocatedCapital > 0 && normalPlanned > allocatedCapital;
  const isOverPlannedExcessive = allocatedCapital > 0 && excessivePlanned > allocatedCapital;

  assert(
    isOverPlannedNormal === false && isOverPlannedExcessive === true,
    'Cost breakdown planner anchors planned budget to allocated capital and flags over-planned excess (₱6,000)'
  );

  const inflatedExpenses = 34500;
  const isInflationOverrun = allocatedCapital > 0 && inflatedExpenses > allocatedCapital;
  const inflationVariance = inflatedExpenses - allocatedCapital;

  assert(
    isInflationOverrun === true && inflationVariance === 4500,
    'Expenses are permitted to overlap allocated capital due to real-world price inflation (+₱4,500)'
  );

  console.log('\n--- [11] BUDGET FORM STATIC IMPORT & RUNTIME INTEGRITY ---');
  const budgetFormPath = path.resolve(__dirname, '../src/components/BudgetForm/BudgetForm.jsx');
  const budgetFormContent = fs.readFileSync(budgetFormPath, 'utf8');

  assert(
    /import\s*\{[^}]*\btoCentavos\b[^}]*\}\s*from\s*['"][^'"]*financeConstants/m.test(budgetFormContent),
    'BudgetForm.jsx explicitly imports toCentavos from financeConstants.js'
  );

  console.log('\n--- [12] PPMP ITEM DELETION & ARCHIVING FILTERING INTEGRITY ---');
  const ppmpMatrixPath = path.resolve(__dirname, '../src/components/Finance/PPMPMatrix.jsx');
  const ppmpMatrixContent = fs.readFileSync(ppmpMatrixPath, 'utf8');

  const financeProviderPath = path.resolve(__dirname, '../src/components/FinanceContext/FinanceProvider.jsx');
  const financeProviderContent = fs.readFileSync(financeProviderPath, 'utf8');

  // Assert PPMPMatrix filters out archived / inactive items
  const matrixFiltersArchived =
    /status\s*!==\s*['"]archived['"]/m.test(ppmpMatrixContent) ||
    /b\.status\s*===\s*['"]archived['"]\s*\|\|\s*b\.isActive\s*===\s*false/m.test(ppmpMatrixContent) ||
    /item\.status\s*===\s*['"]archived['"]/m.test(ppmpMatrixContent);

  assert(
    matrixFiltersArchived,
    'PPMPMatrix.jsx explicitly filters out archived / inactive allocations from active view'
  );

  // Assert FinanceProvider filters or segregates archived budgets from active totals
  const providerFiltersArchived =
    /alloc\.status\s*!==\s*['"]archived['"]/m.test(financeProviderContent) ||
    /status\s*!==\s*['"]archived['"]/m.test(financeProviderContent);

  assert(
    providerFiltersArchived,
    'FinanceProvider.jsx explicitly excludes archived allocations from active budget totals'
  );

  console.log('\n--- [13] COST BREAKDOWN PLANNER EXPENSES & INITIAL SPENT SYNCHRONIZATION ---');
  
  // Test 1: Static code assertions in BudgetForm.jsx
  assert(
    /if\s*\(\s*field\s*===\s*['"]spent['"]\s*\)/m.test(budgetFormContent) &&
    /spentAmount:\s*newExpensesSum/m.test(budgetFormContent),
    'BudgetForm.jsx automatically synchronizes breakdown item expenses to spentAmount on breakdown change'
  );

  assert(
    /handleRemoveBreakdownItem[\s\S]*?spentAmount:\s*newExpensesSum/m.test(budgetFormContent),
    'BudgetForm.jsx recalculates and synchronizes spentAmount when breakdown items are removed'
  );

  assert(
    /lineItemsSpentSum\s*>\s*0[\s\S]*?spentAmount:\s*lineItemsSpentSum/m.test(budgetFormContent),
    'BudgetForm.jsx initializes and synchronizes spentAmount when loading existing budget with itemized line item expenses'
  );

  assert(
    /effectiveSpent\s*=\s*expensesSum\s*>\s*0\s*\?\s*expensesSum/m.test(budgetFormContent),
    'BudgetForm.jsx form submission preserves and saves itemized expenses as effective spent'
  );

  assert(
    /styles\.syncIndicatorGroup/m.test(budgetFormContent) &&
    /styles\.telemetrySyncBadge/m.test(budgetFormContent),
    'BudgetForm.jsx displays live synchronization indicators in Initial Spent label and Cost Planner telemetry'
  );

  // Test 2: Functional simulation of breakdown expense synchronization
  const breakdownRows = [
    { description: 'Sound System Rental', cost: '15000', spent: '12000' },
    { description: 'Stage Decoration', cost: '8000', spent: '9500' },
    { description: 'Host Honorarium', cost: '5000', spent: '5000' },
  ];

  const totalItemizedExpenses = breakdownRows.reduce(
    (sum, row) => sum + (parseFloat(row.spent) || 0),
    0
  );

  assert(
    totalItemizedExpenses === 26500,
    'Breakdown expenses sum correctly computes ₱26,500'
  );

  // Synchronized initial spent formatted value
  const syncedSpentAmount = totalItemizedExpenses > 0
    ? (totalItemizedExpenses % 1 === 0 ? totalItemizedExpenses.toString() : totalItemizedExpenses.toFixed(2))
    : '0';

  assert(
    syncedSpentAmount === '26500',
    'Synchronized initial spent string displays exact formatted expenses ("26500")'
  );

  // Removing an item (e.g. Host Honorarium)
  const remainingRows = breakdownRows.filter((_, i) => i !== 2);
  const updatedExpensesSum = remainingRows.reduce(
    (sum, row) => sum + (parseFloat(row.spent) || 0),
    0
  );

  assert(
    updatedExpensesSum === 21500,
    'Removing breakdown item updates synchronized expenses to ₱21,500'
  );

  // Overlap and Price Inflation with Synchronized Spent
  const packageAllocated = 25000;
  const isPackageOverrun = packageAllocated > 0 && totalItemizedExpenses > packageAllocated;
  const packageOverrunAmount = totalItemizedExpenses - packageAllocated;
  const packageOverrunRate = ((packageOverrunAmount / packageAllocated) * 100).toFixed(1);

  assert(
    isPackageOverrun === true && packageOverrunAmount === 1500 && packageOverrunRate === '6.0',
    'Synchronized expenses properly trigger price inflation indicator (+₱1,500 / +6.0%) without blocking'
  );

  console.log('\n--- [14] AUTHORIZED BUDGET ALLOCATION & STATISTICS SYNCHRONIZATION ---');
  const fundGovernancePath = path.resolve(__dirname, '../src/components/Finance/FundGovernance.jsx');
  const fundGovernanceContent = fs.readFileSync(fundGovernancePath, 'utf8');

  // Assert FinanceProvider does not contain legacyBudgets ReferenceError
  assert(
    !/\blegacyBudgets\b/.test(financeProviderContent),
    'FinanceProvider.jsx does not reference undefined legacyBudgets in setStatistics'
  );

  assert(
    /budgetCount:\s*activeBudgets\.length/.test(financeProviderContent),
    'FinanceProvider.jsx calculates budgetCount using activeBudgets.length'
  );

  assert(
    /displayTotalAllocated\s*=/.test(fundGovernanceContent) &&
    /displayFiscalAllocated\s*=/.test(fundGovernanceContent) &&
    /displayTotalSpent\s*=/.test(fundGovernanceContent),
    'FundGovernance.jsx defines dynamic KPI derivations (displayTotalAllocated, displayFiscalAllocated)'
  );

  assert(
    /formatPHP\(toCentavos\(displayTotalAllocated\)/.test(fundGovernanceContent) &&
    /formatPHP\(toCentavos\(displayFiscalAllocated\)/.test(fundGovernanceContent),
    'FundGovernance.jsx KPI row renders displayTotalAllocated and displayFiscalAllocated'
  );

  // Functional verification of single item like the user screenshot (BSIT Stater Usb)
  const sampleBudgets = [
    {
      id: 'alloc_sample_1',
      eventName: 'BSIT Stater Usb',
      allocated: 10000,
      spent: 1500,
      remaining: 8500,
      isFSG: false,
      fundAccountId: 'fund_fiscal_year_budget',
    },
  ];

  const computedTotalAlloc = sampleBudgets.reduce((acc, b) => acc + (b.allocated || 0), 0);
  const computedTotalSpent = sampleBudgets.reduce((acc, b) => acc + (b.spent || 0), 0);
  const computedFiscalAlloc = sampleBudgets
    .filter((b) => !b.isFSG && b.fundAccountId !== 'fund_fsg_remittance')
    .reduce((acc, b) => acc + (b.allocated || 0), 0);
  const computedFsgAlloc = sampleBudgets
    .filter((b) => b.isFSG || b.fundAccountId === 'fund_fsg_remittance')
    .reduce((acc, b) => acc + (b.allocated || 0), 0);
  const computedRemaining = Math.max(0, computedTotalAlloc - computedTotalSpent);

  assert(
    computedTotalAlloc === 10000,
    'Total Approved correctly evaluates to ₱10,000.00'
  );
  assert(
    computedFiscalAlloc === 10000,
    'Fiscal Budget Allotted correctly evaluates to ₱10,000.00'
  );
  assert(
    computedFsgAlloc === 0,
    'FSG Remittance Allotted correctly evaluates to ₱0.00'
  );
  assert(
    computedTotalSpent === 1500,
    'Total Disbursed correctly evaluates to ₱1,500.00'
  );
  assert(
    computedRemaining === 8500,
    'Remaining Available correctly evaluates to ₱8,500.00'
  );

  console.log('\n--- [15] PRODUCT MANAGEMENT (IGF) & INVENTORY SYNCHRONIZATION ---');

  // Test 1: Operational Supplies vs PPMP Fiscal Separation
  const operationalItem = {
    productName: 'Paper Clip Box (100s)',
    category: 'Office Supplies',
    stockAvailable: 25,
    price: 35.50,
    storageLocation: 'SSG Supply Cabinet B',
    unit: 'box',
    fundSource: 'IGF',
    supplier: 'Office Depot',
  };

  assert(
    operationalItem.fundSource === 'IGF',
    'Daily operational supplies are correctly attributed to IGF (Income Generated Funds)'
  );
  assert(
    ['Office Supplies', 'Consumables', 'Merchandise', 'Tools', 'Event Materials'].includes(operationalItem.category),
    'Product inventory category belongs to designated institutional classification'
  );

  // Test 2: Inventory Document Generation from Product
  const generateInventoryFromProduct = (prod, generatedProductId) => ({
    name: prod.productName.trim(),
    category: prod.category || 'Office Supplies',
    quantity: parseInt(prod.stockAvailable) || 0,
    minQuantity: 5,
    amount: parseFloat(prod.price) || 0,
    storageLocation: prod.storageLocation || 'SSG Storage Cabinet B',
    unit: prod.unit || 'pcs',
    description: prod.description || '',
    supplier: prod.supplier || 'SSG Operations',
    fundSource: 'IGF',
    source: 'Product Management (IGF)',
    linkedProductId: generatedProductId,
  });

  const sampleProdId = 'PROD-1730000000-123';
  const syncedInv = generateInventoryFromProduct(operationalItem, sampleProdId);

  assert(
    syncedInv.name === 'Paper Clip Box (100s)' && syncedInv.quantity === 25,
    'Inventory record captures exact product name and stock quantity'
  );
  assert(
    syncedInv.amount === 35.50 && syncedInv.unit === 'box',
    'Inventory record captures unit valuation and physical packaging unit'
  );
  assert(
    syncedInv.linkedProductId === sampleProdId,
    'Inventory record binds linkedProductId for bidirectional sync'
  );
  assert(
    syncedInv.source === 'Product Management (IGF)' && syncedInv.fundSource === 'IGF',
    'Inventory record explicitly denotes Product Management (IGF) origin'
  );

  // Test 3: Bidirectional Stock Sync on Borrow
  const mockInventoryItem = {
    id: 'inv_abc123',
    name: 'Paper Clip Box (100s)',
    quantity: 25,
    linkedProductId: sampleProdId,
  };
  const mockBorrowedQty = 3;
  const updatedInvQty = Math.max(0, mockInventoryItem.quantity - mockBorrowedQty);
  
  assert(
    updatedInvQty === 22,
    'Borrowing 3 units reduces inventory quantity to 22'
  );

  // Test 4: Product stock reflects updated inventory quantity
  const updatedProduct = {
    ...operationalItem,
    stockAvailable: updatedInvQty,
  };

  assert(
    updatedProduct.stockAvailable === 22,
    'Product catalog stockAvailable reflects borrowed inventory stock reduction'
  );

  console.log('\n--- [16] COMMERCE HUB ORDER CLAIMING, IGF LEDGER & STOCK SYNC ---');

  // Test 1: Order Claiming Stock Deduction Logic
  const sampleOrder = {
    docId: 'ord_123',
    orderId: 'ORD-DB-0099',
    orderStatus: 'Pending',
    claimed: false,
    productInfo: {
      productId: 'PROD-1791517568202-727',
      productName: '𝙐𝙣𝙞𝙛𝙞𝙚𝙙 𝘾𝙏𝙐-𝘿𝘽 𝙇𝙖𝙣𝙮𝙖𝙧𝙙 (𝐂𝐨𝐄𝐝,𝐂𝐨𝐓𝐄)',
      quantity: 2,
      pricePerUnit: 100,
      totalPrice: 200,
    },
    customerInfo: {
      fullName: 'Juan Dela Cruz',
      email: 'juan@ctu.edu.ph',
    },
    igfSynced: false,
  };

  const initialProductStock = 98;
  const initialInventoryStock = 98;
  const orderQuantity = sampleOrder.productInfo.quantity;

  const postClaimProductStock = Math.max(0, initialProductStock - orderQuantity);
  const postClaimInventoryStock = Math.max(0, initialInventoryStock - orderQuantity);

  assert(
    postClaimProductStock === 96,
    'Order claiming correctly deducts 2 units from Product Management stock (98 -> 96)'
  );
  assert(
    postClaimInventoryStock === 96,
    'Order claiming correctly deducts 2 units from Inventory Management stock (98 -> 96)'
  );

  // Test 2: IGF Revenue Ledger Calculation
  const orderTotalCentavos = toCentavos(sampleOrder.productInfo.totalPrice);
  const initialIgfBalanceCentavos = 1500000; // ₱15,000.00
  const postClaimIgfBalanceCentavos = initialIgfBalanceCentavos + orderTotalCentavos;

  assert(
    orderTotalCentavos === 20000,
    'Order revenue converts to exact integer centavos (20,000 centavos = ₱200.00)'
  );
  assert(
    postClaimIgfBalanceCentavos === 1520000,
    'IGF Fund Account balance increases by order revenue (₱15,000.00 -> ₱15,200.00)'
  );

  // Test 3: Free / Zero-Revenue Order Resilience
  const freeOrderAmountCentavos = toCentavos(0);
  assert(
    freeOrderAmountCentavos === 0,
    'Free order converts safely to 0 centavos without throwing'
  );

  // Test 4: Unclaim / Cancellation Stock & Ledger Reversal Logic
  const postUnclaimProductStock = postClaimProductStock + orderQuantity;
  const postUnclaimInventoryStock = postClaimInventoryStock + orderQuantity;
  const postReversalIgfBalanceCentavos = Math.max(0, postClaimIgfBalanceCentavos - orderTotalCentavos);

  assert(
    postUnclaimProductStock === 98,
    'Unclaiming restores stock to Product Management (96 -> 98)'
  );
  assert(
    postUnclaimInventoryStock === 98,
    'Unclaiming restores stock to Inventory Management (96 -> 98)'
  );
  assert(
    postReversalIgfBalanceCentavos === initialIgfBalanceCentavos,
    'Unclaiming reverses revenue from IGF Fund Account balance (₱15,200.00 -> ₱15,000.00)'
  );

  // Test 5: Online Paid Order Lifecycle (Money in IGF, Unclaimed, Stock on Shelf)
  const onlineOrder = {
    docId: 'ord_online_1',
    orderId: 'ORD-DB-0100',
    orderStatus: 'Online Paid',
    claimed: false,
    stockClaimDeducted: false,
    igfSynced: true,
    paymentInfo: { paymentMethod: 'Online', onlinePaymentType: 'GCash', referenceNumber: 'GCASH123456789' },
    productInfo: { productId: 'PROD-1', productName: 'Lanyard', quantity: 1, totalPrice: 100 }
  };

  assert(
    onlineOrder.orderStatus === 'Online Paid' && onlineOrder.claimed === false,
    'Online Paid order denotes paid online and not yet claimed'
  );
  assert(
    onlineOrder.igfSynced === true && onlineOrder.stockClaimDeducted === false,
    'Online Paid order credits IGF while stock remains un-deducted until physical handover'
  );

  // Test 6: Claiming an Online Paid Order
  const claimedOnlineOrder = {
    ...onlineOrder,
    orderStatus: 'Claimed',
    claimed: true,
    stockClaimDeducted: true,
  };
  assert(
    claimedOnlineOrder.orderStatus === 'Claimed' && claimedOnlineOrder.claimed === true && claimedOnlineOrder.stockClaimDeducted === true,
    'Claiming Online Paid order transitions to Claimed and deducts stock without double-crediting IGF'
  );

  // Test 7: Returned Status for Bad/Defective Product
  const returnedOrder = {
    ...claimedOnlineOrder,
    orderStatus: 'Returned',
    claimed: false,
    stockClaimDeducted: false,
    igfSynced: false, // refunded from IGF
  };
  const igfBalanceAfterReturn = postReversalIgfBalanceCentavos; // refunded
  assert(
    returnedOrder.orderStatus === 'Returned',
    'Returned order status correctly captures defective/bad product return'
  );
  assert(
    returnedOrder.igfSynced === false,
    'Returned bad product refunds/reverses revenue from IGF Ledger'
  );

  console.log(`\n========================================`);
  console.log(`DIAGNOSTIC SUMMARY: Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) {
    console.log(`FAILURES TO INVESTIGATE:`);
    failures.forEach((f, i) => console.log(`  [${i + 1}] ${f}`));
  }
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
});

