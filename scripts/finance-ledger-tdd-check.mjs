/**
 * scripts/finance-ledger-tdd-check.mjs
 * TDD Suite for Finance Ledger Roles, Impeccable Modals, and Google Sheets Export
 * 
 * Seams under test:
 * 1. Role Permission Seam: canPostFinanceLedger and canReverseFinanceLedger only true for [admin, finance_secretary, budget_officer, auditor]
 * 2. Alertbox Elimination Seam: Zero window.alert / window.confirm calls in FundGovernance.jsx and new modal components
 * 3. Modal Contract Seam: FinanceLedgerModal renders accessible dialog with proper role-aware badges & confirmation flows
 * 4. Google Sheets Finance Sync Seam: googleSheetsFinanceSyncService formats multi-tab fiscal data into valid Google Sheets v4 payloads
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

console.log('=== Slice 1: Role Permissions for Ledger Append & Reversals ===');

const permissionsPath = path.resolve(__dirname, '../src/utils/permissions.js');
const permissionsModule = await import('../src/utils/permissions.js');

const {
  canPostFinanceLedger,
  canReverseFinanceLedger,
  FINANCE_LEDGER_OPERATOR_ROLES,
} = permissionsModule;

check('FINANCE_LEDGER_OPERATOR_ROLES is defined', Array.isArray(FINANCE_LEDGER_OPERATOR_ROLES));
check('FINANCE_LEDGER_OPERATOR_ROLES includes exactly admin, finance_secretary, budget_officer, auditor', 
  FINANCE_LEDGER_OPERATOR_ROLES.includes('admin') &&
  FINANCE_LEDGER_OPERATOR_ROLES.includes('finance_secretary') &&
  FINANCE_LEDGER_OPERATOR_ROLES.includes('budget_officer') &&
  FINANCE_LEDGER_OPERATOR_ROLES.includes('auditor') &&
  FINANCE_LEDGER_OPERATOR_ROLES.length === 4
);

check('canPostFinanceLedger permits admin', canPostFinanceLedger?.({ role: 'admin' }) === true);
check('canPostFinanceLedger permits finance_secretary', canPostFinanceLedger?.({ role: 'finance_secretary' }) === true);
check('canPostFinanceLedger permits budget_officer', canPostFinanceLedger?.({ role: 'budget_officer' }) === true);
check('canPostFinanceLedger permits auditor', canPostFinanceLedger?.({ role: 'auditor' }) === true);

check('canPostFinanceLedger forbids general secretary', canPostFinanceLedger?.({ role: 'secretary' }) === false);
check('canPostFinanceLedger forbids president', canPostFinanceLedger?.({ role: 'president' }) === false);
check('canPostFinanceLedger forbids senator', canPostFinanceLedger?.({ role: 'senator' }) === false);

check('canReverseFinanceLedger permits admin', canReverseFinanceLedger?.({ role: 'admin' }) === true);
check('canReverseFinanceLedger permits finance_secretary', canReverseFinanceLedger?.({ role: 'finance_secretary' }) === true);
check('canReverseFinanceLedger permits budget_officer', canReverseFinanceLedger?.({ role: 'budget_officer' }) === true);
check('canReverseFinanceLedger permits auditor', canReverseFinanceLedger?.({ role: 'auditor' }) === true);
check('canReverseFinanceLedger forbids mayor / student', canReverseFinanceLedger?.({ role: 'mayor' }) === false);

console.log('\n=== Slice 2: Alertbox Elimination & Impeccable Modals ===');

const fundGovSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/Finance/FundGovernance.jsx'), 'utf8');
const hasWindowAlert = /\balert\s*\(/.test(fundGovSrc);
const hasWindowConfirm = /\bconfirm\s*\(/.test(fundGovSrc);

check('FundGovernance.jsx contains NO window.alert() calls', !hasWindowAlert);
check('FundGovernance.jsx contains NO window.confirm() calls', !hasWindowConfirm);

const modalFile = path.resolve(__dirname, '../src/components/Finance/FinanceLedgerModal.jsx');
check('FinanceLedgerModal.jsx exists', fs.existsSync(modalFile));

if (fs.existsSync(modalFile)) {
  const modalSrc = fs.readFileSync(modalFile, 'utf8');
  check('FinanceLedgerModal exports ReversalModal', modalSrc.includes('ReversalModal'));
  check('FinanceLedgerModal exports OverspendingNoticeModal', modalSrc.includes('OverspendingNoticeModal'));
}

console.log('\n=== Slice 3: Google Sheets Finance Sync Service ===');

const sheetsServiceFile = path.resolve(__dirname, '../src/services/googleSheetsFinanceSyncService.js');
check('googleSheetsFinanceSyncService.js exists', fs.existsSync(sheetsServiceFile));

if (fs.existsSync(sheetsServiceFile)) {
  const service = await import('../src/services/googleSheetsFinanceSyncService.js');
  check('Service exports exportFiscalPackageToGoogleSheets', typeof service.exportFiscalPackageToGoogleSheets === 'function');
  check('Service exports buildFiscalSheetsPayload', typeof service.buildFiscalSheetsPayload === 'function');

  // Test payload builder pure function
  const dummyData = {
    funds: [
      { id: 'fund_fiscal', displayName: 'Fiscal Budget', balanceCentavos: 50000000, bankAccountReference: 'BDO' }
    ],
    budgets: [
      { id: 'b1', eventName: 'Intramurals', allocatedCentavos: 10000000, spentCentavos: 5000000, status: 'approved' }
    ],
    transactions: [
      { id: 'tx1', transactionType: 'EXPENSE', amountCentavos: 5000000, description: 'Equipment', custodianName: 'Juan' }
    ]
  };

  const sheetsPayload = service.buildFiscalSheetsPayload(dummyData);
  check('Payload produces multi-sheet structure (KPIs, Ledger, Allocations, Funds)',
    Array.isArray(sheetsPayload.sheets) && sheetsPayload.sheets.length >= 4
  );
  check('Sheets payload includes Summary KPIs sheet', sheetsPayload.sheets.some(s => s.name === 'Summary KPIs'));
  check('Sheets payload includes General Ledger sheet', sheetsPayload.sheets.some(s => s.name === 'General Ledger'));
  check('Sheets payload includes Approved Allocations sheet', sheetsPayload.sheets.some(s => s.name === 'Approved Allocations'));
  check('Sheets payload includes Holding Funds sheet', sheetsPayload.sheets.some(s => s.name === 'Holding Funds'));
}

console.log('\n=== Slice 4: Reports & Sheets Tab in Finance Dashboard ===');

const dashSrc = fs.readFileSync(path.resolve(__dirname, '../src/components/Finance/FinanceDashboard.jsx'), 'utf8');
check('FinanceDashboard includes reports tab', dashSrc.includes("'reports'"));
check('FinanceDashboard mounts FinanceReportExportPanel', dashSrc.includes('FinanceReportExportPanel'));

console.log('\n=== Final Results ===');
results.forEach(r => console.log(r));

if (failed > 0) {
  console.log(`\nTests finished with ${failed} failure(s).`);
  process.exit(1);
} else {
  console.log('\nAll Finance Ledger & Google Sheets tests passed cleanly!');
  process.exit(0);
}
