/**
 * scripts/fiscal-budget-reconciliation-tdd.mjs
 *
 * TDD & Bug-Diagnosis Regression Suite for SSG Fiscal Year Budget & FSG Remittance:
 * Reproduces and prevents:
 *  1. Double-subtraction ₱0 collapse when `appropriatedCeilingCentavos` is 0/unset and `balanceCentavos` was decremented by PPMP disbursements
 *  2. `computeDisbursedByAccount` double-counting reversed expenses whose original row stayed 'posted'
 *  3. `ensureDefaultFundAccounts` blindly overwriting existing fundAccounts to balanceCentavos: 0 without tx.get() existence guard
 *  4. `updateFiscalBudget` / `updateFundBalance` writing raw ceiling to Firestore `balanceCentavos` without subtracting released PPMP disbursements
 *  5. `FinanceProvider` failing to load balances when `ensureDefaultFundAccounts` errors for read-only viewers or before auth resolves
 *  6. `BankCalibrationModal` warning/preview showing how a new Fiscal Ceiling recalculates against already-released PPMP ledger expenses
 *
 * Run: node scripts/fiscal-budget-reconciliation-tdd.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeAuthoritativeFundBalanceCentavos,
  computeDisbursedByAccount,
  computeEffectiveFiscalCeilingCentavos,
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

// ════════════════════════════════════════════════════════════════════════════
// SLICE 1 (H1): No Double-Subtraction ₱0 Collapse When Ceiling Is 0/Unset
// ════════════════════════════════════════════════════════════════════════════
console.log('=== Slice 1 (H1): Fiscal Budget Double-Subtraction ₱0 Collapse Prevention ===');
{
  // Realistic scenario: fund started at ₱50,000 with appropriatedCeilingCentavos=0 (unset/legacy),
  // then a ₱25,000 PPMP disbursement ran recordTransaction(), decrementing Firestore balanceCentavos to ₱25,000.
  const fiscalDocAfterSpend = {
    id: 'fund_fiscal_year_budget',
    topLevelCategory: 'FISCAL_YEAR_BUDGET',
    appropriatedCeilingCentavos: 0,
    balanceCentavos: 2500000, // ₱25,000 remaining after ₱25,000 PPMP spend
  };
  const txs = [
    {
      id: 'tx-ppmp-1',
      refNumber: 'TXN-PPMP-001',
      fundAccountId: 'fund_fiscal_year_budget',
      fundCategory: 'FISCAL_YEAR_BUDGET',
      transactionType: 'expense',
      amountCentavos: 2500000, // ₱25,000 released to ledger
      status: 'posted',
    },
  ];

  const effectiveCeiling = computeEffectiveFiscalCeilingCentavos(fiscalDocAfterSpend, txs);
  const authoritativeBalance = computeAuthoritativeFundBalanceCentavos(fiscalDocAfterSpend, txs);

  check(
    'When appropriatedCeilingCentavos is 0 and balanceCentavos was already decremented to ₱25,000 after ₱25,000 PPMP spend, effective ceiling reconstructs ₱50,000 (5000000)',
    effectiveCeiling === 5000000,
    `Expected 5000000, got ${effectiveCeiling}`
  );

  check(
    'Authoritative balance remains ₱25,000 (2500000) instead of double-subtracting down to ₱0.00',
    authoritativeBalance === 2500000,
    `Expected 2500000, got ${authoritativeBalance}`
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 2 (H3): Explicit Fiscal Ceiling Recalculates Cleanly Against Released PPMP Ledger Expenses
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 2 (H3): Explicit Fiscal Ceiling Recalculation Against Released PPMP Expenses ===');
{
  const fiscalDocWithExplicitCeiling = {
    id: 'fund_fiscal_year_budget',
    topLevelCategory: 'FISCAL_YEAR_BUDGET',
    appropriatedCeilingCentavos: 10000000, // ₱100,000 explicit ceiling
    balanceCentavos: 7000000,              // ₱70,000 remaining in Firestore after ₱30,000 PPMP spend
  };
  const txs = [
    {
      id: 'tx-ppmp-a',
      refNumber: 'TXN-PPMP-A',
      fundAccountId: 'fund_fiscal_year_budget',
      fundCategory: 'FISCAL_YEAR_BUDGET',
      transactionType: 'expense',
      amountCentavos: 1000000, // ₱10,000
      status: 'posted',
    },
    {
      id: 'tx-ppmp-b',
      refNumber: 'TXN-PPMP-B',
      fundAccountId: 'fund_fiscal_year_budget',
      fundCategory: 'FISCAL_YEAR_BUDGET',
      transactionType: 'expense',
      amountCentavos: 2000000, // ₱20,000
      status: 'posted',
    },
  ];

  const effectiveCeiling = computeEffectiveFiscalCeilingCentavos(fiscalDocWithExplicitCeiling, txs);
  const authoritativeBalance = computeAuthoritativeFundBalanceCentavos(fiscalDocWithExplicitCeiling, txs);

  check(
    'Explicit ₱100,000 ceiling stays ₱100,000 (10000000)',
    effectiveCeiling === 10000000,
    `Expected 10000000, got ${effectiveCeiling}`
  );
  check(
    'Adding ₱100,000 ceiling automatically recalculates against ₱30,000 released PPMP expenses -> ₱70,000 (7000000)',
    authoritativeBalance === 7000000,
    `Expected 7000000, got ${authoritativeBalance}`
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 3 (H4): Reversed PPMP Expenses Never Inflate Disbursed Total
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 3 (H4): Reversed PPMP Expenses Excluded From Disbursed Calculation ===');
{
  const fiscalFund = {
    id: 'fund_fiscal_year_budget',
    topLevelCategory: 'FISCAL_YEAR_BUDGET',
    appropriatedCeilingCentavos: 5000000, // ₱50,000
    balanceCentavos: 4000000,
  };
  const txsWithReversals = [
    // Normal expense: ₱10,000 (stays disbursed)
    { id: 'exp-1', refNumber: 'TXN-1', fundAccountId: 'fund_fiscal_year_budget', transactionType: 'expense', amountCentavos: 1000000, status: 'posted' },
    // Standard reversed expense: original status='reversed' + reversal row
    { id: 'exp-2', refNumber: 'TXN-2', fundAccountId: 'fund_fiscal_year_budget', transactionType: 'expense', amountCentavos: 1500000, status: 'reversed' },
    { id: 'rev-2', refNumber: 'REV-TXN-2', fundAccountId: 'fund_fiscal_year_budget', transactionType: 'reversal', reversalOfTransactionId: 'exp-2', amountCentavos: 1500000, status: 'posted' },
    // Legacy/partial reversal: original stayed status='posted', reversal row references it by ID/ref
    { id: 'exp-3', refNumber: 'TXN-3', fundAccountId: 'fund_fiscal_year_budget', transactionType: 'expense', amountCentavos: 2000000, status: 'posted' },
    { id: 'rev-3', refNumber: 'REV-TXN-3', fundAccountId: 'fund_fiscal_year_budget', transactionType: 'reversal', reversalOfTransactionId: 'exp-3', amountCentavos: 2000000, status: 'posted' },
  ];

  const disbursed = computeDisbursedByAccount(txsWithReversals).get('fund_fiscal_year_budget') || 0;
  const remaining = computeAuthoritativeFundBalanceCentavos(fiscalFund, txsWithReversals);

  check(
    'computeDisbursedByAccount nets out both standard and unlinked expense reversals (disbursed = ₱10,000 / 1000000)',
    disbursed === 1000000,
    `Expected 1000000, got ${disbursed}`
  );
  check(
    'Fiscal Budget remaining equals ₱40,000 (4000000) instead of being drained to ₱20,000 by already-reversed exp-3',
    remaining === 4000000,
    `Expected 4000000, got ${remaining}`
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SLICE 4 (H2, H3, H5): Service & Provider Contracts (No ₱0 Overwrite + Ceiling Sync)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Slice 4 (H2/H3/H5): financeService, FinanceProvider & BankCalibrationModal Guards ===');
{
  const finSvcSrc = fs.readFileSync(path.resolve(__dirname, '../src/services/financeService.js'), 'utf8');
  const finProvSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/FinanceContext/FinanceProvider.jsx'), 'utf8');
  const modalSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/Finance/BankCalibrationModal.jsx'), 'utf8');
  const fundGovSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/Finance/FundGovernance.jsx'), 'utf8');

  // H2a: ensureDefaultFundAccounts must check snap.exists() inside runTransaction before tx.set()
  const ensureBlock = finSvcSrc.match(/async ensureDefaultFundAccounts[\s\S]*?^\s{2}\},/m)?.[0] || '';
  check(
    'ensureDefaultFundAccounts checks tx.get(accRef) and skips if doc already exists (cannot blindly overwrite to ₱0)',
    /await tx\.get\(accRef\)[\s\S]*?if\s*\(\s*!?\w+\.exists\(\)\s*\)/.test(ensureBlock),
    'Missing tx.get(accRef) existence guard inside ensureDefaultFundAccounts runTransaction'
  );

  check(
    'ensureDefaultFundAccounts does NOT reset appropriatedCeilingCentavos to 0 when balanceCentavos already exists',
    !ensureBlock.includes('updates.appropriatedCeilingCentavos = 0;') ||
      ensureBlock.includes('current.balanceCentavos || 0'),
    'Found unconditional updates.appropriatedCeilingCentavos = 0 in ensureDefaultFundAccounts'
  );

  // H3: updateFiscalBudget recalculates Firestore balanceCentavos = Math.max(0, ceiling - disbursed)
  const updateFiscalBlock = finSvcSrc.match(/async updateFiscalBudget[\s\S]*?^\s{2}\},/m)?.[0] || '';
  check(
    'updateFiscalBudget queries released PPMP disbursements and stores balanceCentavos = Math.max(0, amountCentavos - disbursedCentavos)',
    updateFiscalBlock.includes('computeDisbursedByAccount') &&
      updateFiscalBlock.includes('Math.max(0, amountCentavos - disbursedCentavos)'),
    'updateFiscalBudget writes raw ceiling into balanceCentavos without subtracting released PPMP disbursements'
  );

  // H5: recordTransaction anchors appropriatedCeilingCentavos on Fiscal/FSG if it was 0/unset before decrementing
  const recordTxBlock = finSvcSrc.match(/async recordTransaction[\s\S]*?^\s{2}\},/m)?.[0] || '';
  check(
    'recordTransaction anchors appropriatedCeilingCentavos on Fiscal/FSG if unset before decrementing balanceCentavos',
    recordTxBlock.includes('appropriatedCeilingCentavos') &&
      recordTxBlock.includes('fund_fiscal_year_budget'),
    'recordTransaction decrements balanceCentavos without anchoring missing appropriatedCeilingCentavos'
  );

  // H2b: FinanceProvider waits for currentUser and treats ensureDefaultFundAccounts errors as non-fatal
  check(
    'FinanceProvider skips unauthenticated mount fetch and catches ensureDefaultFundAccounts errors so read-only viewers still see balances',
    /if\s*\(\s*!currentUser\s*\)/.test(finProvSrc) &&
      /ensureDefaultFundAccounts[\s\S]*?\.catch\(/.test(finProvSrc),
    'FinanceProvider runs ensureDefaultFundAccounts unguarded before auth or lets it abort balance loading'
  );

  // H3 UX: BankCalibrationModal previews Ceiling - Released PPMP Expenses = Remaining Available Balance
  check(
    'BankCalibrationModal & FundGovernance surface released PPMP ledger disbursements preview when calibrating Fiscal Budget ceiling',
    modalSrc.includes('disbursedCentavos') &&
      fundGovSrc.includes('disbursedCentavos='),
    'BankCalibrationModal does not preview how the ceiling recalculates against released PPMP ledger expenses'
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
