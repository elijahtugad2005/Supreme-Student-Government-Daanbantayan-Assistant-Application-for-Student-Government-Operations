/**
 * Phase 3 — human verification — behaviour tests.
 *
 *   node scripts/phase3-check.mjs
 *
 * No emulator or API key needed: the decision rules are pure and live in
 * functions/src/apply.js. These are the rules that decide what an AI
 * suggestion is allowed to change about an official record, so they are tested
 * hard.
 */
import {
  APPLIABLE_FIELDS,
  buildApplyPatch,
  diffAgainstDocument,
  isVerifiedField,
  mergeVerifiedFields,
  resolveLabelSlug,
  suggestionIsTrustworthy,
} from '../functions/src/apply.js';
import { CONFIDENCE_THRESHOLD } from '../functions/src/prompts.js';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

const LABELS = [
  { id: 'resolution', name: 'Resolution' },
  { id: 'memorandum', name: 'Memorandum' },
  { id: 'letter', name: 'Letter' },
  { id: 'other', name: 'Other' },
];

const EXTRACTION = {
  title: 'Resolution No. 2026-014',
  documentNumber: '2026-014',
  documentDate: '2026-09-28',
  subject: 'Student Activity Approval',
  organization: 'Student Government',
  deadline: '2026-10-05',
  keywords: ['activity', 'approval'],
};

const SUGGESTION = {
  documentType: 'resolution',
  documentTypeLabel: 'Resolution',
  confidence: 0.96,
  requiresReview: false,
};

// ────────────────────────────────────────────────────────────
// Only what a human ticked is applied
// ────────────────────────────────────────────────────────────
console.log('=== The administrator decides ===');

let r = buildApplyPatch({ apply: [], suggestion: SUGGESTION, extraction: EXTRACTION, labels: LABELS });
check('ticking nothing changes nothing', Object.keys(r.patch).length === 0 && r.accepted.length === 0);

r = buildApplyPatch({ apply: ['title'], suggestion: SUGGESTION, extraction: EXTRACTION, labels: LABELS });
check('ticking one field applies only that field',
  Object.keys(r.patch).join(',') === 'title' && r.accepted.join(',') === 'title',
  JSON.stringify(r.patch));

r = buildApplyPatch({
  apply: ['title', 'documentNumber', 'subject'],
  suggestion: SUGGESTION,
  extraction: EXTRACTION,
  labels: LABELS,
});
check('unticked fields are never written', !('documentDate' in r.patch) && !('deadline' in r.patch),
  JSON.stringify(Object.keys(r.patch)));
check('the values come from the extraction', r.patch.documentNumber === '2026-014');

// ────────────────────────────────────────────────────────────
// Empty values are skipped, not written as blanks
// ────────────────────────────────────────────────────────────
console.log('\n=== Nothing is written as an empty value ===');

const sparse = { title: 'Memorandum', documentNumber: null, deadline: '', keywords: [] };
r = buildApplyPatch({
  apply: ['title', 'documentNumber', 'deadline', 'keywords'],
  extraction: sparse,
  suggestion: SUGGESTION,
  labels: LABELS,
});
check('null is not written', !('documentNumber' in r.patch));
check('empty string is not written', !('deadline' in r.patch));
check('empty array is not written', !('keywords' in r.patch));
check('the real value still is', r.patch.title === 'Memorandum');
check('skipped fields are reported so the UI can explain', r.skipped.length === 3, JSON.stringify(r.skipped));

r = buildApplyPatch({ apply: ['title'], extraction: {}, suggestion: {}, labels: LABELS });
check('a field the model could not read is skipped, not blanked',
  Object.keys(r.patch).length === 0 && r.skipped.includes('title'));

// ────────────────────────────────────────────────────────────
// Human corrections beat the model
// ────────────────────────────────────────────────────────────
console.log('\n=== A human correction always wins ===');

r = buildApplyPatch({
  apply: ['title'],
  extraction: EXTRACTION,
  suggestion: SUGGESTION,
  labels: LABELS,
  overrides: { title: 'Resolution No. 2026-014 (corrected)' },
});
check('the override replaces the model value',
  r.patch.title === 'Resolution No. 2026-014 (corrected)', r.patch.title);

r = buildApplyPatch({
  apply: ['documentNumber'],
  extraction: EXTRACTION,
  suggestion: SUGGESTION,
  labels: LABELS,
  overrides: { documentNumber: '' },
});
check('clearing a field via an override writes nothing', !('documentNumber' in r.patch));

// ────────────────────────────────────────────────────────────
// Label resolution
// ────────────────────────────────────────────────────────────
console.log('\n=== Labels resolve by name or slug ===');

check('a label name resolves to its slug', resolveLabelSlug('Resolution', LABELS) === 'resolution');
check('case is ignored', resolveLabelSlug('  rEsOlUtIoN ', LABELS) === 'resolution');
check('a slug is accepted as-is', resolveLabelSlug('memorandum', LABELS) === 'memorandum');
check('an unknown label falls back to Other', resolveLabelSlug('Blue Moon', LABELS) === 'other');
check('an empty label falls back to Other', resolveLabelSlug('', LABELS) === 'other');
check('a missing vocabulary falls back to Other', resolveLabelSlug('Resolution', []) === 'other');

r = buildApplyPatch({ apply: ['documentType'], extraction: EXTRACTION, suggestion: SUGGESTION, labels: LABELS });
check('the document type is stored as a slug array',
  Array.isArray(r.patch.labels) && r.patch.labels[0] === 'resolution', JSON.stringify(r.patch.labels));

// ────────────────────────────────────────────────────────────
// Verification provenance
// ────────────────────────────────────────────────────────────
console.log('\n=== Verification is recorded, cumulatively ===');

check('verified fields merge without duplicates',
  mergeVerifiedFields(['title'], ['title', 'subject']).join(',') === 'title,subject');
check('merging into nothing works', mergeVerifiedFields([], ['title']).join(',') === 'title');
check('merging preserves earlier verifications',
  mergeVerifiedFields(['documentType', 'title'], ['deadline']).join(',') === 'documentType,title,deadline');

const doc = { verifiedFields: ['title'] };
check('a verified field is reported as verified', isVerifiedField(doc, 'title'));
check('an unverified field is not', !isVerifiedField(doc, 'subject'));
check('a document with no provenance is not verified', !isVerifiedField({}, 'title'));

// ────────────────────────────────────────────────────────────
// Confidence gating
// ────────────────────────────────────────────────────────────
console.log('\n=== Low confidence is not presented as authoritative ===');

check('a confident suggestion is trustworthy',
  suggestionIsTrustworthy({ confidence: 0.96, requiresReview: false }, CONFIDENCE_THRESHOLD));
check('a low-confidence suggestion is not',
  !suggestionIsTrustworthy({ confidence: 0.52, requiresReview: true }, CONFIDENCE_THRESHOLD));
check('requiresReview alone disqualifies it',
  !suggestionIsTrustworthy({ confidence: 0.99, requiresReview: true }, CONFIDENCE_THRESHOLD));
check('no suggestion is not trustworthy',
  !suggestionIsTrustworthy(null, CONFIDENCE_THRESHOLD));

// ────────────────────────────────────────────────────────────
// Suggested vs current
// ────────────────────────────────────────────────────────────
console.log('\n=== Suggested against current ===');

const current = {
  title: 'Untitled',
  labels: ['memorandum'],
  // Already matches the suggestion, so `organization` must NOT be flagged.
  office: 'Student Government',
  documentDate: '',
  verifiedFields: ['title'],
};

const rows = diffAgainstDocument(current, SUGGESTION, EXTRACTION);
const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

check('a differing field is flagged', byKey.title.differs === true);
check('an identical field is not flagged', byKey.organization.differs === false);
check('the current value is always shown alongside', byKey.title.current === 'Untitled');
check('the suggestion is shown too', byKey.title.suggested === 'Resolution No. 2026-014');
check('a verified field carries its marker', byKey.title.verified === true);
check('an unverified field carries no marker', byKey.subject.verified === false);
check('documentType compares label slug to current slug',
  byKey.documentType.current === 'memorandum' && byKey.documentType.differs === true);

// ────────────────────────────────────────────────────────────
// Field inventory
// ────────────────────────────────────────────────────────────
console.log('\n=== The contract is complete ===');

const keys = APPLIABLE_FIELDS.map((f) => f.key);
check('every field declares a target', APPLIABLE_FIELDS.every((f) => f.target && f.label));
check('every field has a unique key', new Set(keys).size === keys.length);
check('organization maps to office', APPLIABLE_FIELDS.find((f) => f.key === 'organization').target === 'office');
check('documentType maps to labels', APPLIABLE_FIELDS.find((f) => f.key === 'documentType').target === 'labels');

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nPhase 3 verification behaves correctly.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);