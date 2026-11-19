/**
 * scripts/fiscal-budget-ledger-tdd.mjs
 * TDD Regression Suite for SSG Fiscal Year Budget falling to ₱0.00 despite ledger records
 *
 * Pre-agreed Seams under test:
 * 1. Authoritative Balance & Ceiling Seam (src/utils/financeLedgerReconciliation.js):
 *    - When fund_fiscal_year_budget has appropriatedCeilingCentavos=0 and balanceCentavos=0
 *      while transactions has valid ledger inflow(s) (receipt / adjustment / transfer),
 *      SSG Fiscal Year Budget & effective ceiling must reflect the ledger record instead of 0.
 *    - Preserves legacy bogus receipt filtering when an explicit Edit Fiscal Budget ceiling (> 0) is set.
 * 2. Service Reconcile & Provider/UI Wiring Seam (financeService.js, FinanceProvider.jsx, FundGovernance.jsx):
 *    - reconcileFundBalanceFromLedger must never clobber Fiscal/FSG balanceCentavos to 0 below its ceiling-minus-disbursed.
 *    - FinanceProvider & FundGovernance derive Initial Fiscal Ceiling from shared reconciliation logic.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeAuthoritativeFundBalanceCentavos,
  filterValidLedgerTransactions,
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

console.log('=== Slice 1 (RED): Ledger-recorded SSG Fiscal Year Budget when stored balance/ceiling is 0 ===');

const zeroedFiscalFund = {
  id: 'fund_fiscal_year_budget',
  topLevelCategory: 'FISCAL_YEAR_BUDGET',
  appropriatedCeilingCentavos: 0,
  balanceCentavos: 0,
};

const ledgerWithFiscalReceipt = [
  {
    id: 'tx_fiscal_init',
    fundAccountId: 'fund_fiscal_year_budget',
    fundCategory: 'FISCAL_YEAR_BUDGET',
    transactionType: 'receipt',
    status: 'posted',
    amountCentavos: 50000000, // ₱500,000.00 recorded in ledger
    description: 'Initial SSG Fiscal Year Budget Allocation',
    refNumber: 'TXN-FISCAL-500K',
  },
  {
    id: 'tx_exp_orig',
    fundAccountId: 'fund_fiscal_year_budget',
    fundCategory: 'FISCAL_YEAR_BUDGET',
    transactionType: 'expense',
    status: 'reversed',
    amountCentavos: 1740000, // ₱17,400.00 reversed expense
    refNumber: 'TXN-920589-445',
  },
  {
    id: 'tx_exp_rev',
    fundAccountId: 'fund_fiscal_year_budget',
    fundCategory: 'FISCAL_YEAR_BUDGET',
    transactionType: 'reversal',
    status: 'posted',
    amountCentavos: 1740000,
    reversalOfTransactionId: 'tx_exp_orig',
    refNumber: 'REV-TXN-920589-445',
  },
];

// Simulate FinanceProvider passing fundAccounts + raw transactions
const filteredWithFundAccounts = filterValidLedgerTransactions(ledgerWithFiscalReceipt, [zeroedFiscalFund]);
check(
  'Ledger receipt on Fiscal Year Budget stays visible when no explicit Edit Fiscal Budget ceiling (>0) is stored',
  filteredWithFundAccounts.some((tx) => tx.id === 'tx_fiscal_init'),
  `Remaining ids: ${filteredWithFundAccounts.map((t) => t.id).join(', ')}`
);

const balFromReceipt = computeAuthoritativeFundBalanceCentavos(
  zeroedFiscalFund,
  filteredWithFundAccounts
);
check(
  'SSG Fiscal Year Budget card recovers ₱500,000.00 from ledger receipt when stored balance/ceiling are 0',
  balFromReceipt === 50000000,
  `Expected 50000000, got ${balFromReceipt}`
);

const ledgerWithAdjustmentAndExpense = [
  {
    id: 'tx_adj_fiscal',
    fundAccountId: 'fund_fiscal_year_budget',
    fundCategory: 'FISCAL_YEAR_BUDGET',
    transactionType: 'adjustment',
    status: 'posted',
    amountCentavos: 50000000,
    refNumber: 'ADJ-FISCAL-500K',
  },
  {
    id: 'tx_exp_posted',
    fundAccountId: 'fund_fiscal_year_budget',
    fundCategory: 'FISCAL_YEAR_BUDGET',
    transactionType: 'expense',
    status: 'posted',
    amountCentavos: 1740000, // -₱17,400.00
    refNumber: 'TXN-EXP-17400',
  },
];

const balFromAdjMinusExp = computeAuthoritativeFundBalanceCentavos(
  zeroedFiscalFund,
  ledgerWithAdjustmentAndExpense
);
check(
  'SSG Fiscal Year Budget with ₱500k ledger adjustment minus ₱17.4k posted expense equals ₱482,600.00 (even if stored fields are 0)',
  balFromAdjMinusExp === 48260000,
  `Expected 48260000, got ${balFromAdjMinusExp}`
);

console.log('\n=== Slice 2 (RED -> GREEN): Provider, FundGovernance Ceiling & Service Reconcile ===');

const reconModule = await import('../src/utils/financeLedgerReconciliation.js');
check(
  'financeLedgerReconciliation exports computeEffectiveFiscalCeilingCentavos',
  typeof reconModule.computeEffectiveFiscalCeilingCentavos === 'function'
);

if (typeof reconModule.computeEffectiveFiscalCeilingCentavos === 'function') {
  const effectiveCeiling = reconModule.computeEffectiveFiscalCeilingCentavos(
    zeroedFiscalFund,
    filteredWithFundAccounts
  );
  check(
    'computeEffectiveFiscalCeilingCentavos recovers ₱500,000.00 Initial Fiscal Ceiling from ledger receipt when stored fields are 0',
    effectiveCeiling === 50000000,
    `Expected 50000000, got ${effectiveCeiling}`
  );
}

const providerSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/components/FinanceContext/FinanceProvider.jsx'),
  'utf8'
);
check(
  'FinanceProvider passes rawAccounts into filterValidLedgerTransactions(rawTxList, rawAccounts)',
  /filterValidLedgerTransactions\s*\(\s*rawTxList\s*,\s*rawAccounts\s*\)/.test(providerSrc)
);
check(
  'FinanceProvider uses computeEffectiveFiscalCeilingCentavos for appropriatedCeilingCentavos',
  providerSrc.includes('computeEffectiveFiscalCeilingCentavos(')
);

const fundGovSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/components/Finance/FundGovernance.jsx'),
  'utf8'
);
check(
  'FundGovernance passes fundAccounts into filterValidLedgerTransactions(transactions, fundAccounts)',
  /filterValidLedgerTransactions\s*\(\s*transactions\s*,\s*fundAccounts\s*\)/.test(fundGovSrc)
);
check(
  'FundGovernance uses computeEffectiveFiscalCeilingCentavos for ceilingCentavos',
  fundGovSrc.includes('computeEffectiveFiscalCeilingCentavos(')
);

const financeSvcSrc = fs.readFileSync(
  path.resolve(__dirname, '../src/services/financeService.js'),
  'utf8'
);
check(
  'financeService.reconcileFundBalanceFromLedger uses computeAuthoritativeFundBalanceCentavos so Fiscal/FSG balances cannot be wiped to 0',
  financeSvcSrc.includes('computeAuthoritativeFundBalanceCentavos(')
);

console.log('\n--- Results ---');
results.forEach((line) => console.log(line));
if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nALL FISCAL BUDGET LEDGER TDD CHECKS PASSED.');
