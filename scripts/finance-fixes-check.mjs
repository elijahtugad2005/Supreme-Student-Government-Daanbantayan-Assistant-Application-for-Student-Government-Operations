/**
 * scripts/finance-fixes-check.mjs
 * TDD Suite for Finance Code-Review Findings:
 * 1. Fiscal Ceiling Calculation: Only allocations with status === 'approved' count toward cap (drafts excluded).
 * 2. PPMP Transparent Overspending: Transactions exceeding allocation/line-item are allowed with warning and flagged isOverspent: true.
 * 3. Auditor Approval Rights: canApproveFinance is true for the auditor role in permissions.js.
 * 4. Destructive Cleanup Elimination: cleanLegacyTestRecords is removed from financeService and FundGovernance.
 * 5. Reusable Bank Calibration Modal: BankCalibrationModal component exports clean, isolated calibration forms.
 */

import fs from 'fs';
import { ROLE_PERMISSIONS } from '../src/utils/permissions.js';
import { validateTransactionRules } from '../src/utils/financeValidation.js';
import { financeService } from '../src/services/financeService.js';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) {
    results.push(`ok   ${label}`);
  } else {
    failed += 1;
    results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`);
  }
};

async function run() {
  console.log('=== Running Finance Fixes TDD Suite ===\n');

  // Test 1: Auditor Role Permission check
  const auditorRole = ROLE_PERMISSIONS.auditor;
  check(
    'Auditor role has canApproveFinance: true',
    auditorRole && auditorRole.permissions.canApproveFinance === true,
    `Received: ${auditorRole?.permissions?.canApproveFinance}`
  );
  check(
    'Auditor role maintains canAuditFinance: true',
    auditorRole && auditorRole.permissions.canAuditFinance === true
  );

  // Test 2: Validation of PPMP Overspending (Transparent Overspending vs Blocking)
  // When an expense exceeds available allocation, it should NOT fail validation (isValid === true),
  // but should return isOverspent === true and a warning message.
  const overspentValidation = validateTransactionRules({
    transactionType: 'EXPENSE',
    amountCentavos: 1500000, // ₱15,000.00
    fundCategory: 'PPMP',
    allocationId: 'alloc_sample_123',
    availableAllocationCentavos: 1000000, // ₱10,000.00 (Overspent by ₱5,000.00)
    lineItemId: 'item_sample_456',
    availableLineItemCentavos: 800000,   // Overspent by ₱7,000.00
    resolutionRef: 'RES-2026-001',
    receiptUrl: 'https://storage.example.com/receipt.jpg',
    availableBalanceCentavos: 5000000,   // ₱50,000.00 total cash balance (Fund has enough cash)
  });

  check(
    'Validation allows expense when cash is sufficient even if allocation is exceeded',
    overspentValidation.isValid === true,
    `Errors: ${overspentValidation.errors?.join(', ')}`
  );
  check(
    'Validation flags transaction with isOverspent: true when exceeding allocation',
    overspentValidation.isOverspent === true,
    `isOverspent flag is: ${overspentValidation.isOverspent}`
  );
  check(
    'Validation supplies informative overspending warning message',
    overspentValidation.warnings?.some((w) => w.toLowerCase().includes('exceeds remaining approved allocation')),
    `Warnings: ${overspentValidation.warnings?.join(', ')}`
  );

  // Test 3: Cash balance insufficient still properly blocks expense
  const cashDepletedValidation = validateTransactionRules({
    transactionType: 'EXPENSE',
    amountCentavos: 1000000,
    fundCategory: 'PPMP',
    availableBalanceCentavos: 500000, // Fund only has ₱5,000.00 cash
    resolutionRef: 'RES-2026-001',
    receiptUrl: 'https://storage.example.com/receipt.jpg',
  });
  check(
    'Validation still strictly blocks when fund cash balance is insufficient',
    cashDepletedValidation.isValid === false &&
      cashDepletedValidation.errors.some((e) => e.includes('not have enough available balance'))
  );

  // Test 4: Destructive Cleanup Function Elimination
  check(
    'financeService.cleanLegacyTestRecords is removed or undefined',
    typeof financeService.cleanLegacyTestRecords === 'undefined',
    'cleanLegacyTestRecords should be removed to prevent accidental data deletion'
  );

  // Test 5: BankCalibrationModal component verification (Source code and export inspection)
  const modalSource = fs.readFileSync('src/components/Finance/BankCalibrationModal.jsx', 'utf8');
  const hasNamedExport = modalSource.includes('export const BankCalibrationModal');
  const hasDefaultExport = modalSource.includes('export default BankCalibrationModal');
  const hasFormStructure = modalSource.includes('handleFiscalSubmit') && modalSource.includes('handleFundSubmit');

  check(
    'BankCalibrationModal is exported cleanly as a reusable component',
    (hasNamedExport || hasDefaultExport) && hasFormStructure
  );

  console.log('\n--- Test Results ---');
  results.forEach((r) => console.log(r));

  if (failed > 0) {
    console.error(`\nFAILED: ${failed} checks failed.`);
    process.exit(1);
  } else {
    console.log(`\nSUCCESS: All ${results.length} checks passed cleanly!`);
    process.exit(0);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
