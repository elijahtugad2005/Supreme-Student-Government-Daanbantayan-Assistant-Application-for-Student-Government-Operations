/**
 * scripts/finance-igf-reconciliation-check.mjs
 * Regression suite for:
 * 1. Fiscal & FSG Ceiling-minus-Disbursed math (ignores bogus '+' receipts; only depletes when PPMP projects release '-' to ledger)
 * 2. Live Ledger-driven IGF & IGP card balances (+Collections minus -Expenses like event prep lunch or inventory purchases)
 * 3. Validation blocking '+' inflows on Fiscal/FSG and requiring Receipt (Drive Picture or OR # / Details) on IGF/IGP expenses
 * 4. Google Drive 'Receipts' subfolder routing in backend/services/driveSync.js and uploadReceiptToDrive in financeService.js
 * 5. InventoryProvider writing IGF/IGP purchases directly to 'transactions' ledger collection
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeOrderStatusUpdate } from '../src/components/Data/orderStatusTransition.js';
import { validateTransactionRules } from '../src/utils/financeValidation.js';

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

console.log('=== Slice 1: Pure Ledger & Authoritative Card Balance Rules ===');
const reconMod = await import('../src/utils/financeLedgerReconciliation.js');

const sampleTxs = [
  // Two bogus legacy +₱500,000 receipt rows on Fiscal Year Budget (must be filtered out and ignored!)
  { id: 'bogus1', fundAccountId: 'fund_fiscal_year_budget', fundCategory: 'FISCAL_YEAR_BUDGET', transactionType: 'receipt', status: 'posted', amountCentavos: 50000000, refNumber: 'TXN-922141-515' },
  { id: 'bogus2', fundAccountId: 'fund_fiscal_year_budget', fundCategory: 'FISCAL_YEAR_BUDGET', transactionType: 'receipt', status: 'posted', amountCentavos: 50000000, refNumber: 'TXN-920742-750' },
  // One real ₱10,000 (-1,000,000 centavos) PPMP project disbursement released to ledger
  { id: 'ppmp_exp1', fundAccountId: 'fund_fiscal_year_budget', fundCategory: 'FISCAL_YEAR_BUDGET', transactionType: 'expense', status: 'posted', amountCentavos: 1000000, refNumber: 'TXN-PPMP-001' },
  // IGF orders (+₱900.00) minus Cooked Chicken Event Prep Lunch (-₱250.00) = ₱650.00 (65000 centavos)
  { id: 'igf1', fundAccountId: 'fund_igf_main', fundCategory: 'IGF', transactionType: 'collection', status: 'posted', amountCentavos: 90000, refNumber: 'IGF-ORD-1' },
  { id: 'igf_chicken', fundAccountId: 'fund_igf_main', fundCategory: 'IGF', transactionType: 'expense', status: 'posted', amountCentavos: 25000, receiptLabel: 'Food & Meals', receiptOrNumber: 'OR-10492', receiptDetails: 'Cooked chicken for lunch during event preparation' },
];

const filtered = reconMod.filterValidLedgerTransactions(sampleTxs);
check(
  'filterValidLedgerTransactions removes bogus +Receipt rows on Fiscal Year Budget',
  filtered.length === 3 && !filtered.some((t) => t.id === 'bogus1' || t.id === 'bogus2'),
  `Filtered count=${filtered.length}`
);

const fiscalFund = {
  id: 'fund_fiscal_year_budget',
  topLevelCategory: 'FISCAL_YEAR_BUDGET',
  appropriatedCeilingCentavos: 5000000, // ₱50,000.00 ceiling set via Edit Fiscal Budget
  balanceCentavos: 5000000,
};
const fiscalDisplayCentavos = reconMod.computeAuthoritativeFundBalanceCentavos(fiscalFund, sampleTxs);
check(
  'Fiscal Year Budget card starts at ₱50,000 ceiling, ignores bogus +₱500k receipts, and depletes to ₱40,000 when ₱10,000 PPMP project is released to ledger',
  fiscalDisplayCentavos === 4000000,
  `Got ${fiscalDisplayCentavos}`
);

const igfFund = {
  id: 'fund_igf_main',
  topLevelCategory: 'IGF',
  balanceCentavos: 0, // Even if stored balance was 0, card reflects live ledger net
};
const igfDisplayCentavos = reconMod.computeAuthoritativeFundBalanceCentavos(igfFund, sampleTxs);
check(
  'IGF card automatically displays live ledger funds (+₱900 orders minus -₱250 cooked chicken lunch = ₱650.00)',
  igfDisplayCentavos === 65000,
  `Got ${igfDisplayCentavos}`
);

console.log('\n=== Slice 2: Validation Rules (No + on Fiscal/FSG; Receipt Required on IGF/IGP Expense) ===');
{
  const fiscalInflowCheck = validateTransactionRules({
    fundCategory: 'FISCAL_YEAR_BUDGET',
    transactionType: 'receipt',
    amountCentavos: 5000000,
  });
  check(
    'validateTransactionRules blocks +Receipt/+Collection on Fiscal Year Budget',
    fiscalInflowCheck.isValid === false &&
      fiscalInflowCheck.errors.some((e) => e.includes('only expense disbursements (-) are permitted'))
  );

  const igfExpenseNoReceipt = validateTransactionRules({
    fundCategory: 'IGF',
    transactionType: 'expense',
    expensePurpose: 'Event Preparation Consumables',
    amountCentavos: 25000,
    custodianUserId: 'sec-1',
    availableBalanceCentavos: 90000,
  });
  check(
    'validateTransactionRules blocks IGF expense (e.g. cooked chicken lunch) when neither receipt picture nor OR#/details is provided',
    igfExpenseNoReceipt.isValid === false &&
      igfExpenseNoReceipt.errors.some((e) => e.includes('receipt picture') || e.includes('Official Receipt'))
  );

  const igfExpenseWithOrDetails = validateTransactionRules({
    fundCategory: 'IGF',
    transactionType: 'expense',
    expensePurpose: 'Event Preparation Consumables',
    amountCentavos: 25000,
    custodianUserId: 'sec-1',
    receiptOrNumber: 'OR #10492',
    receiptDetails: 'Cooked chicken for lunch during event preparation',
    availableBalanceCentavos: 90000,
  });
  check(
    'validateTransactionRules allows IGF expense when OR # / receipt details are provided',
    igfExpenseWithOrDetails.isValid === true
  );

  const igfExpenseWithDrivePic = validateTransactionRules({
    fundCategory: 'IGF',
    transactionType: 'expense',
    expensePurpose: 'Event Preparation Consumables',
    amountCentavos: 25000,
    custodianUserId: 'sec-1',
    receiptDriveLink: 'https://drive.google.com/file/d/abc123/view',
    availableBalanceCentavos: 90000,
  });
  check(
    'validateTransactionRules allows IGF expense when Google Drive receipt picture is uploaded',
    igfExpenseWithDrivePic.isValid === true
  );
}

console.log('\n=== Slice 3: Google Drive Receipts Subfolder, Inventory Ledger Link & UI Contracts ===');
const driveSyncSrc = fs.readFileSync(path.resolve(__dirname, '../backend/services/driveSync.js'), 'utf8');
const docRouteSrc = fs.readFileSync(path.resolve(__dirname, '../backend/routes/documents.js'), 'utf8');
const invProvSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/InventoryContext/InventoryProvider.jsx'), 'utf8');
const finSvcSrc = fs.readFileSync(path.resolve(__dirname, '../src/services/financeService.js'), 'utf8');
const fundGovSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/Finance/FundGovernance.jsx'), 'utf8');

check(
  'backend/services/driveSync.js supports dedicated Receipts subfolder in Google Drive',
  driveSyncSrc.includes('getReceiptsSubfolderId') && driveSyncSrc.includes("'Receipts'")
);
check(
  'backend/routes/documents.js routes receipt uploads to Google Drive Receipts folder and returns driveWebViewLink',
  docRouteSrc.includes("folder: 'Receipts'") && docRouteSrc.includes('driveWebViewLink')
);
check(
  'financeService.js implements uploadReceiptToDrive targeting Google Drive Receipts folder',
  finSvcSrc.includes('uploadReceiptToDrive') && finSvcSrc.includes("formData.append('folder', 'Receipts')")
);
check(
  "InventoryProvider.jsx writes IGF/IGP inventory purchases directly to 'transactions' ledger collection",
  invProvSrc.includes("collection(db, 'transactions')") && !invProvSrc.includes("collection(db, 'financeTransactions')")
);
check(
  'FundGovernance.jsx removes manual Sync Card to Ledger button and renders Receipt upload + OR # / Details + Labels',
  !fundGovSrc.includes('Sync Card to Ledger') &&
    fundGovSrc.includes('uploadReceiptToDrive') &&
    fundGovSrc.includes('RECEIPT_LABELS') &&
    fundGovSrc.includes('Released to Ledger:')
);

console.log('\n--- Results ---');
results.forEach((r) => console.log(r));
if (failed > 0) {
  console.error(`\nFAILED: ${failed} check(s) failed.`);
  process.exit(1);
}
console.log('\nALL FINANCE WORKFLOW, RECEIPT DRIVE UPLOAD & LEDGER CHECKS PASSED.');
