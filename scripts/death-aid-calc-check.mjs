/**
 * Verifies the count-based Death Aid arithmetic and replace-semantics balance.
 *
 *   node scripts/death-aid-calc-check.mjs   (or: npm run test:death-aid-calc)
 */
import { readFileSync } from 'node:fs';
import { computeTotals, computeOutstanding } from '../src/services/deathAidService.js';
import {
  DEATH_AID_DEBT_TYPES,
  DEATH_AID_MANAGER_ROLES,
  canManageDeathAid,
} from '../src/utils/permissions.js';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

console.log('=== The SSG worked example: 40 enrolled, 39 pesos at ₱1 ===');
const ex = computeTotals(40, 1, 39);
check('enrolled read from roster', ex.enrolledCount === 40, String(ex.enrolledCount));
check('39 pesos means 39 beneficiaries', ex.beneficiaryCount === 39, String(ex.beneficiaryCount));
check('collected is ₱39', ex.collectedAmount === 39, String(ex.collectedAmount));
check('expected is ₱40', ex.expectedCollection === 40, String(ex.expectedCollection));
check('one student owes', ex.debtCount === 1, String(ex.debtCount));
check('debt is ₱1', ex.debtAmount === 1, String(ex.debtAmount));
check('not flagged as clamped', ex.wasClamped === false);

console.log('\n=== The arithmetic can never be faked ===');
const none = computeTotals(40, 1, 0);
check('zero collected means everyone owes', none.debtCount === 40 && none.debtAmount === 40);
const all = computeTotals(40, 1, 40);
check('full collection leaves no debt', all.debtCount === 0 && all.debtAmount === 0);
const over = computeTotals(40, 1, 45);
check('more beneficiaries than students is clamped, not credited',
  over.beneficiaryCount === 40 && over.debtCount === 0 && over.wasClamped === true,
  JSON.stringify({ b: over.beneficiaryCount, d: over.debtCount, clamped: over.wasClamped }));
check('a clamped over-count produces no negative money', over.collectedAmount === 40);

const p25 = computeTotals(20, 25, 15);
check('multiplies at any contribution rate',
  p25.collectedAmount === 375 && p25.expectedCollection === 500 && p25.debtAmount === 125,
  JSON.stringify({ c: p25.collectedAmount, e: p25.expectedCollection, d: p25.debtAmount }));

const junk = computeTotals(40, 1, 'abc');
check('a non-numeric count becomes zero rather than NaN',
  Number.isFinite(junk.collectedAmount) && junk.beneficiaryCount === 0,
  String(junk.collectedAmount));
const blank = computeTotals(40, '', 39);
check('a blank contribution becomes zero',
  blank.contributionPerStudent === 0 && blank.collectedAmount === 0);
check('an empty roster does not explode', computeTotals(0, 1, 5).debtCount === 0);

console.log('\n=== Outstanding REPLACES per section ===');
const collections = [
  { sectionKey: 'bsit - 1a', section: 'BSIT - 1A', program: 'BSIT',
    submittedAt: new Date('2026-09-01'), debtCount: 5, debtAmount: 5, debtRecords: [] },
  // Later filing: the section paid up except one.
  { sectionKey: 'bsit - 1a', section: 'BSIT - 1A', program: 'BSIT',
    submittedAt: new Date('2026-10-01'), debtCount: 1, debtAmount: 1,
    debtRecords: [{ studentName: 'Pedro Reyes', debtType: DEATH_AID_DEBT_TYPES.NAMED, amount: 1 }] },
  { sectionKey: 'btled - he - 2a', section: 'BTLED - HE - 2A', program: 'BTLED',
    submittedAt: new Date('2026-10-02'), debtCount: 2, debtAmount: 2,
    debtRecords: [{ studentName: '', debtType: DEATH_AID_DEBT_TYPES.ABSENT, amount: 1 }] },
];

const out = computeOutstanding(collections);
check('one row per section, not per filing', out.length === 2, String(out.length));

const bsit = out.find((o) => o.sectionKey === 'bsit - 1a');
check('newest filing wins, so the balance drops to 1', bsit.debtCount === 1, String(bsit.debtCount));
check('the earlier 5 is not added on', bsit.debtAmount === 1, String(bsit.debtAmount));
check('the newest filing is the one referenced',
  bsit.recordedAt.getTime() === new Date('2026-10-01').getTime());

const btled = out.find((o) => o.sectionKey === 'btled - he - 2a');
check('a section with only one identified debtor reports the gap',
  btled.debtCount === 2 && btled.unidentifiedCount === 1,
  JSON.stringify({ count: btled.debtCount, missing: btled.unidentifiedCount }));

const anon = computeOutstanding([
  { sectionKey: 's', section: 'S', submittedAt: new Date(), debtCount: 3, debtAmount: 3, debtRecords: [] },
]);
check('a fully unidentified debt is counted, not hidden',
  anon[0].unidentifiedCount === 3 && anon[0].debtRecords.length === 0);

check('no collections yields nothing outstanding', computeOutstanding([]).length === 0);
check('collections without debtRecords do not throw',
  computeOutstanding([{ sectionKey: 'x', section: 'X', submittedAt: new Date(), debtCount: 2 }])[0]
    .debtCount === 2);

const totals = out.reduce((s, r) => s + r.debtAmount, 0);
check('outstanding aggregates across sections', totals === 3, String(totals));

console.log('\n=== Who may record and verify ===');
const rules = readFileSync('firestore.rules', 'utf8');
const fn = rules.match(/function canManageDeathAid\(\)\s*\{([\s\S]*?)\n\s*\}/);
const ruleRoles = fn
  ? Array.from(fn[1].matchAll(/myRole\(\)\s*==\s*'(\w+)'/g)).map((m) => m[1])
  : [];
check('rules helper found', ruleRoles.length > 0);
check('rules and JS agree on Death Aid managers',
  ruleRoles.slice().sort().join(',') === DEATH_AID_MANAGER_ROLES.slice().sort().join(','),
  `rules=[${ruleRoles}] js=[${DEATH_AID_MANAGER_ROLES}]`);
check('governors and representatives may manage Death Aid',
  ['governor', 'representative'].every((r) => canManageDeathAid({ role: r })));
check('members, guests and senators may not',
  ['member', 'guest', 'senator', 'public'].every((r) => !canManageDeathAid({ role: r })));
check('a Member with the Creatives flag may not',
  !canManageDeathAid({ role: 'member', canManageCreatives: true }));

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nDeath Aid calculations are correct.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);