/**
 * Death Aid / TechnoCare beneficiary cases — service + rules seam.
 *
 *   npm run test:death-aid-beneficiary
 */
import { readFileSync } from 'node:fs';
import {
  AID_TYPES,
  buildBeneficiaryCase,
  computeOutstanding,
  hasPendingForCase,
} from '../src/services/deathAidService.js';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};
const throwsWith = (fn, re) => {
  try { fn(); return false; } catch (e) { return re.test(e.message); }
};

const officer = { uid: 'off1', name: 'Megan', role: 'press_secretary' };
const valid = {
  aidType: AID_TYPES.TECHNOCARE,
  studentName: 'Genesa A. Mercader',
  studentProgramSection: 'BSED-MATHEMATICS 1A',
  affectedSubjectType: 'student',
  affectedPersonName: 'Genesa A. Mercader',
  relationshipToStudent: 'Self (Student)',
  caseSummary: 'Confined at Vicente Sotto Memorial Medical Center.',
  memoReference: 'Memorandum No. 003, Series of 2026-2027',
  memoPhotoDataUrl: 'data:image/jpeg;base64,AAAA',
  defaultContribution: 1,
};

console.log('=== Slice 1: officer builds a beneficiary case ===');
const built = buildBeneficiaryCase(valid, officer);
check('TechnoCare case keeps aid type', built.aidType === 'technocare');
check('student name is stored', built.studentName === 'Genesa A. Mercader');
check('affected person is stored', built.affectedPersonName === 'Genesa A. Mercader');
check('memo photo is stored', built.memoPhotoDataUrl.startsWith('data:image/'));
check('new case starts open', built.status === 'open');
check('creator is recorded', built.createdByUid === 'off1' && built.createdByRole === 'press_secretary');
check('Death Aid type is supported', buildBeneficiaryCase({ ...valid, aidType: AID_TYPES.DEATH_AID }, officer).aidType === 'death_aid');
check('missing student name is rejected', throwsWith(() => buildBeneficiaryCase({ ...valid, studentName: '  ' }, officer), /student/i));
check('missing affected person is rejected', throwsWith(() => buildBeneficiaryCase({ ...valid, affectedPersonName: '' }, officer), /affected/i));
check('missing memo photo is rejected', throwsWith(() => buildBeneficiaryCase({ ...valid, memoPhotoDataUrl: '' }, officer), /memo/i));
check('unknown aid type is rejected', throwsWith(() => buildBeneficiaryCase({ ...valid, aidType: 'lottery' }, officer), /aid type/i));
check('non-image memo is rejected', throwsWith(() => buildBeneficiaryCase({ ...valid, memoPhotoDataUrl: 'http://evil' }, officer), /memo/i));

console.log('\n=== Slice 2: pending guard is scoped per beneficiary case ===');
const pending = [
  { rosterId: 'r1', beneficiaryCaseId: 'BEN-A', status: 'for_verification' },
  { rosterId: 'r1', beneficiaryCaseId: 'BEN-B', status: 'confirmed' },
];
check('same section + same case is blocked', hasPendingForCase(pending, 'r1', 'BEN-A') === true);
check('same section + different case is allowed', hasPendingForCase(pending, 'r1', 'BEN-C') === false);
check('confirmed filing does not block', hasPendingForCase(pending, 'r1', 'BEN-B') === false);
check('different section is allowed', hasPendingForCase(pending, 'r2', 'BEN-A') === false);

console.log('\n=== Slice 3: outstanding is isolated per beneficiary case ===');
const filings = [
  { sectionKey: 's1', section: 'S1', beneficiaryCaseId: 'BEN-A', submittedAt: new Date('2026-10-01'), debtCount: 5, debtAmount: 5 },
  { sectionKey: 's1', section: 'S1', beneficiaryCaseId: 'BEN-B', submittedAt: new Date('2026-10-05'), debtCount: 1, debtAmount: 1 },
];
const all = computeOutstanding(filings);
check('two cases keep two rows for one section', all.length === 2, String(all.length));
check('case A debt is not erased by case B', all.find((r) => r.beneficiaryCaseId === 'BEN-A')?.debtAmount === 5);
const onlyA = computeOutstanding(filings, { beneficiaryCaseId: 'BEN-A' });
check('filtering by case returns that case only', onlyA.length === 1 && onlyA[0].debtAmount === 5);
const legacy = computeOutstanding([
  { sectionKey: 's9', section: 'S9', submittedAt: new Date('2026-09-01'), debtCount: 2, debtAmount: 2 },
  { sectionKey: 's9', section: 'S9', submittedAt: new Date('2026-10-01'), debtCount: 1, debtAmount: 1 },
]);
check('legacy filings still replace each other', legacy.length === 1 && legacy[0].debtAmount === 1);

console.log('\n=== Slice 4: Firestore rules ===');
const rules = readFileSync('firestore.rules', 'utf8');
const block = rules.match(/match \/deathAidBeneficiaries\/\{beneficiaryId\}\s*\{([\s\S]*?)\n    \}/)?.[1] || '';
check('beneficiaries rule block exists', block.length > 0);
check('beneficiaries are publicly readable', /allow read: if true;/.test(block));
check('only Death Aid managers write', /allow create, update: if canManageDeathAid\(\)/.test(block));
check('write requires student, affected person and memo', ['studentName', 'affectedPersonName', 'memoPhotoDataUrl'].every((f) => block.includes(f)));
check('status limited to open/closed', /status in \['open', 'closed'\]/.test(block));
check('only admin deletes', /allow delete: if isAdmin\(\);/.test(block));

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nBeneficiary case behaviour is correct.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);

