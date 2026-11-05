/**
 * scripts/code-review-fixes-check.mjs
 * TDD Suite for Code Review Findings:
 * 
 * Slice 1: Budget Fund Classification & PPMP Precedence Guard
 * Slice 2: Drive Sync Safe Query String Sanitization (SQL/Drive-injection guard)
 * Slice 3: API Information Leakage Sanitization & Async Catch Guard
 */

import assert from 'node:assert/strict';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

console.log('=== Slice 1: Fund Classifier & Precedence Guards ===');

// We import the classified fund predicates
import { classifyBudgetFund, isBudgetPPMP, isBudgetIGF, isBudgetIGP, isBudgetFSG } from '../src/utils/fundClassifier.js';

const igfRecordWithFSG = {
  id: 'b1',
  fundCategory: 'IGF',
  fundAccountId: 'fund_igf_main',
  isFSG: true // dirty record or legacy flag
};

const igpRecord = {
  id: 'b2',
  fundCategory: 'IGP',
  fundAccountId: 'fund_igp_main'
};

const fiscalRecord = {
  id: 'b3',
  fundCategory: 'FISCAL_YEAR_BUDGET',
  fundAccountId: 'fund_fiscal_year_budget'
};

const fsgRecord = {
  id: 'b4',
  fundCategory: 'FSG_REMITTANCE',
  fundAccountId: 'fund_fsg_remittance'
};

check('IGF record identifies as IGF', isBudgetIGF(igfRecordWithFSG) === true);
check('IGF record never leaks into PPMP even if isFSG is set', isBudgetPPMP(igfRecordWithFSG) === false);
check('IGP record never leaks into PPMP', isBudgetPPMP(igpRecord) === false);
check('Fiscal budget correctly classifies as PPMP', isBudgetPPMP(fiscalRecord) === true);
check('Pure FSG record correctly classifies as PPMP and FSG', isBudgetPPMP(fsgRecord) === true && isBudgetFSG(fsgRecord) === true);
check('classifyBudgetFund returns exact domain enum', classifyBudgetFund(igfRecordWithFSG) === 'IGF');
check('classifyBudgetFund returns IGP for IGP', classifyBudgetFund(igpRecord) === 'IGP');
check('classifyBudgetFund returns PPMP for Fiscal', classifyBudgetFund(fiscalRecord) === 'PPMP');

console.log('\n=== Slice 2: Drive Sync Query Sanitization ===');
const { sanitizeDriveQueryName } = await import('../backend/services/driveSync.js');

const malformedName1 = "Documents' or '1'='1";
const cleanName1 = sanitizeDriveQueryName(malformedName1);
check('Strips single quotes and SQL/Drive injection operators', !cleanName1.includes("'") && !cleanName1.includes('"'));

const safeName = "SSG Document Archive 2026";
check('Preserves safe alphanumeric names and spaces', sanitizeDriveQueryName(safeName) === safeName);

console.log('\n=== Slice 3: API Information Leakage Guard ===');
const { sanitizeErrorResponse } = await import('../backend/utils/errorSanitizer.js');

const rawDbError = new Error('MongoServerSelectionError: connect ECONNREFUSED 10.0.0.1:27017 at topology.js:42');
const sanitized = sanitizeErrorResponse(rawDbError, 'Database operation failed');

check('Removes internal stack traces and server IP from client response', !sanitized.message.includes('10.0.0.1') && !sanitized.message.includes('ECONNREFUSED'));
check('Returns safe consumer-facing message', sanitized.message === 'Database operation failed');
check('Preserves success: false format', sanitized.success === false);

console.log('\n=== Summary ===');
results.forEach(r => console.log(r));
if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} checks passed.`);
  process.exit(0);
}

