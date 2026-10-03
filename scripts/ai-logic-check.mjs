/**
 * Tests the Gemini integration's logic without touching the network.
 *
 * Covers the parts most likely to break quietly: response parsing (the model
 * does wrap JSON in prose despite a schema), the review threshold, file-part
 * construction, and label-prompt construction.
 *
 *   node scripts/ai-logic-check.mjs
 */
import { readFileSync } from 'node:fs';
import {
  parseModelJson,
  truncateForModel,
  needsHumanReview,
  GeminiError,
} from '../functions/src/gemini.js';
import {
  CLASSIFIER_SCHEMA,
  CONFIDENCE_THRESHOLD,
  EXTRACTOR_PROMPT,
  EXTRACTOR_SCHEMA,
  buildClassifierPrompt,
} from '../functions/src/prompts.js';
import { APPLIABLE_FIELDS, buildApplyPatch } from '../functions/src/apply.js';
import { SEED_LABELS } from '../src/utils/documentLabels.js';
import { buildFileParts, isNativeGeminiType, isDocx, isTextLike } from '../functions/src/extract.js';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

const partsOf = (payload) =>
  payload.candidates[0].content.parts.map((p) => p.text).join('');

// ────────────────────────────────────────────────────────────
// Response parsing
// ────────────────────────────────────────────────────────────
console.log('=== Parsing what Gemini actually returns ===');

check('clean JSON parses', (() => {
  try {
    const r = parseModelJson({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] });
    return r.a === 1;
  } catch {
    return false;
  }
})());

check('JSON in a ```json fence parses', (() => {
  try {
    const r = parseModelJson({
      candidates: [{ content: { parts: [{ text: '```json\n{"a":2}\n```' }] } }],
    });
    return r.a === 2;
  } catch {
    return false;
  }
})());

check('JSON in a bare fence parses', (() => {
  try {
    const r = parseModelJson({ candidates: [{ content: { parts: [{ text: '```\n{"a":3}\n```' }] } }] });
    return r.a === 3;
  } catch {
    return false;
  }
})());

check('prose around the JSON still parses', (() => {
  try {
    const r = parseModelJson({
      candidates: [{ content: { parts: [{ text: 'Here is the result:\n{"a":4}\nHope that helps.' }] } }],
    });
    return r.a === 4;
  } catch {
    return false;
  }
})());

check('non-JSON raises a clear error', (() => {
  try {
    parseModelJson({ candidates: [{ content: { parts: [{ text: 'I cannot help with that.' }] } }] });
    return false;
  } catch (e) {
    return e instanceof GeminiError && /not valid JSON/i.test(e.message);
  }
})());

check('an empty response is reported, not silently accepted', (() => {
  try {
    parseModelJson({ candidates: [] });
    return false;
  } catch (e) {
    return /empty response/i.test(e.message);
  }
})());

check('a blocked prompt names the reason', (() => {
  try {
    parseModelJson({ candidates: [], promptFeedback: { blockReason: 'SAFETY' } });
    return false;
  } catch (e) {
    return /SAFETY/.test(e.message);
  }
})());

check('parts are joined when split across candidates', (() => {
  const r = parseModelJson({
    candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '5}' }] } }],
  });
  return r.a === 5;
})());

// ────────────────────────────────────────────────────────────
// Review threshold
// ────────────────────────────────────────────────────────────
console.log('\n=== The human-in-the-loop threshold ===');
check('0.96 is confident enough', needsHumanReview(0.96, CONFIDENCE_THRESHOLD) === false);
check('0.50 always needs a person', needsHumanReview(0.5, CONFIDENCE_THRESHOLD) === true);
check('exactly at the threshold is trusted', needsHumanReview(CONFIDENCE_THRESHOLD, CONFIDENCE_THRESHOLD) === false);
check('just below the threshold is not', needsHumanReview(CONFIDENCE_THRESHOLD - 0.01, CONFIDENCE_THRESHOLD) === true);
check('a missing confidence needs a person', needsHumanReview(undefined, CONFIDENCE_THRESHOLD) === true);
check('a nonsense confidence needs a person', needsHumanReview('high', CONFIDENCE_THRESHOLD) === true);
check('a numeric string is coerced', needsHumanReview('0.9', CONFIDENCE_THRESHOLD) === false);

// ────────────────────────────────────────────────────────────
// Truncation
// ────────────────────────────────────────────────────────────
console.log('\n=== Long documents ===');
const short = 'a'.repeat(1000);
check('short text is untouched', truncateForModel(short) === short);
const long = 'b'.repeat(50000);
const clipped = truncateForModel(long);
check('long text is truncated', clipped.length < long.length, `${clipped.length}`);
check('truncation is marked', clipped.includes('[content truncated]'));
check('truncated output still starts with the document', clipped.startsWith('bbbb'));

// ────────────────────────────────────────────────────────────
// Type routing
// ────────────────────────────────────────────────────────────
console.log('\n=== Which files go to Gemini natively ===');
check('PDF is native', isNativeGeminiType('application/pdf'));
check('JPEG is native', isNativeGeminiType('image/jpeg'));
check('PNG is native', isNativeGeminiType('image/png'));
check('DOCX is not native', !isNativeGeminiType(
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
check('DOCX is detected as docx', isDocx(
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
check('plain text detected', isTextLike('text/plain'));
check('unknown type is not native', !isNativeGeminiType('application/msword'));

const pdfBytes = Buffer.from('%PDF-1.7\n');
// buildFileParts is async (DOCX needs a dynamic import), so every call must be
// awaited. Forgetting that returns a Promise, not a parts object.
const pdfParts = await buildFileParts({
  buffer: pdfBytes,
  mimeType: 'application/pdf',
  name: 'a.pdf',
});
check('a PDF becomes inline binary', Array.isArray(pdfParts.parts) && pdfParts.parts.some((p) => p.inlineData));
check('inline binary is base64 of the original', (() => {
  const inline = pdfParts.parts.find((p) => p.inlineData);
  return Buffer.from(inline.inlineData.data, 'base64').toString() === pdfBytes.toString();
})());
const namedParts = await buildFileParts({
  buffer: pdfBytes,
  mimeType: 'application/pdf',
  name: 'resolution-014.pdf',
});
check('the filename is passed alongside',
  namedParts.parts.some((p) => p.text && p.text.includes('resolution-014.pdf')));

await check('an oversized PDF is refused with advice', async () => {
  try {
    await buildFileParts({
      buffer: Buffer.alloc(20 * 1024 * 1024),
      mimeType: 'application/pdf',
      name: 'huge.pdf',
    });
    return false;
  } catch (e) {
    return e.code === 'FILE_TOO_LARGE_FOR_AI' && /still safely archived/i.test(e.message);
  }
});

await check('an unsupported type is refused with advice', async () => {
  try {
    await buildFileParts({ buffer: Buffer.alloc(8), mimeType: 'application/msword', name: 'legacy.doc' });
    return false;
  } catch (e) {
    return e.code === 'UNSUPPORTED_FOR_AI' && /PDF or DOCX/i.test(e.message);
  }
});

// ────────────────────────────────────────────────────────────
// Classifier prompt
// ────────────────────────────────────────────────────────────
console.log('\n=== The classifier prompt uses live labels ===');
const prompt = buildClassifierPrompt([
  { name: 'Resolution', description: 'Formal decisions adopted by the assembly.' },
  { name: 'Activity Proposal', description: 'Proposals for student activities.' },
]);
check('every label name appears', prompt.includes('Resolution') && prompt.includes('Activity Proposal'));
check('descriptions are included, since they carry the meaning',
  prompt.includes('Formal decisions adopted by the assembly.'));
check('the model is told to prefer Other over a bad match', prompt.includes('Other'));
check('honesty about confidence is requested', /Be honest/i.test(prompt));
check('only one type is requested', /exactly one/i.test(prompt));

check('schema requires all classifier fields',
  CLASSIFIER_SCHEMA.required.includes('documentType') &&
  CLASSIFIER_SCHEMA.required.includes('confidence'));

console.log('\n=== Minutes of the meeting ===');
const MINUTES_LABEL = SEED_LABELS.find((l) => l.slug === 'minutes_of_meeting');
check('the label is seeded', Boolean(MINUTES_LABEL));
check('its slug is stable and kebab-case',
  MINUTES_LABEL?.slug === 'minutes_of_meeting', MINUTES_LABEL?.slug);
check('its display name matches what the model must return',
  MINUTES_LABEL?.name === 'Minutes of the Meeting', MINUTES_LABEL?.name);
check('its description tells the model when to use it',
  /proceedings|meeting date|main agenda/i.test(MINUTES_LABEL?.description || ''),
  MINUTES_LABEL?.description);
check('it is AI-enabled', MINUTES_LABEL?.aiEnabled === true);
check('every seeded label has a unique slug',
  new Set(SEED_LABELS.map((l) => l.slug)).size === SEED_LABELS.length);

check('the extractor schema has an agenda field',
  EXTRACTOR_SCHEMA.properties.agenda?.type === 'string');
check('the extractor schema has an agendaItems array',
  EXTRACTOR_SCHEMA.properties.agendaItems?.type === 'array');
check('agendaItems is a list of strings',
  EXTRACTOR_SCHEMA.properties.agendaItems?.items?.type === 'string');
check('meetingDate is still in the schema', Boolean(EXTRACTOR_SCHEMA.properties.meetingDate));
check('agendaItems is required so it is always present',
  EXTRACTOR_SCHEMA.required.includes('agendaItems'));

// An empty result is a null in JSON, so `agenda` must stay optional: only
// agendaItems is guaranteed, and forcing it required avoids a model failure.
check('agenda stays optional so non-minutes documents do not fail',
  !EXTRACTOR_SCHEMA.required.includes('agenda'));

check('the prompt tells the model to use meetingDate, not documentDate, for minutes',
  /meetingDate/.test(EXTRACTOR_PROMPT) && /NOT use documentDate/i.test(EXTRACTOR_PROMPT));
check('the prompt explains what counts as the main agenda',
  /main agenda|agenda/i.test(EXTRACTOR_PROMPT));
check('the prompt asks for agenda items in document order',
  /agendaItems/.test(EXTRACTOR_PROMPT) && /order/i.test(EXTRACTOR_PROMPT));

const minutesPrompt = buildClassifierPrompt([
  { name: MINUTES_LABEL.name, description: MINUTES_LABEL.description },
]);
check('the classifier sees the minutes label and its description',
  minutesPrompt.includes('Minutes of the Meeting') &&
    minutesPrompt.includes(MINUTES_LABEL.description));

check('agenda is confirmable in Phase 3',
  APPLIABLE_FIELDS.some((f) => f.key === 'agenda' && f.target === 'agenda'));
check('agendaItems is confirmable in Phase 3',
  APPLIABLE_FIELDS.some((f) => f.key === 'agendaItems' && f.target === 'agendaItems'));

// Applying a minutes extraction must be able to carry the agenda through.
const appliedMinutes = buildApplyPatch({
  apply: ['agenda', 'agendaItems', 'documentDate'],
  extraction: {
    agenda: 'Review of the Student Development Program and Panagtabo Games budget.',
    agendaItems: ['Call to Order', 'Approval of previous minutes', 'Panagtabo Games budget'],
    documentDate: '2026-10-06',
  },
  suggestion: {},
  labels: [],
});
check('the agenda is applied to the document', typeof appliedMinutes.patch.agenda === 'string' &&
  appliedMinutes.patch.agenda.includes('Panagtabo'));
check('agenda items are applied as a list',
  Array.isArray(appliedMinutes.patch.agendaItems) && appliedMinutes.patch.agendaItems.length === 3);
check('a minutes agenda cannot overwrite an unticked field',
  !('subject' in appliedMinutes.patch));

console.log('\n=== Institution, authors and the three statuses ===');
const { INSTITUTION, AUTHOR_ROLE_MARKERS, buildExtractorPrompt } = await import(
  '../functions/src/prompts.js'
);
const { DOC_STATUS, DOC_STATUS_LABELS, ASSIGNABLE_STATUSES, normaliseStatus, LEGACY_STATUS_MAP } =
  await import('../src/utils/documentLabels.js');

check('the institution is CTU Daanbantayan',
  INSTITUTION.full === 'Cebu Technological University - Daanbantayan Campus', INSTITUTION.full);
check('the letterhead abbreviations are supplied', INSTITUTION.aliases.includes('CTU'));
check('the extractor prompt names the campus',
  buildExtractorPrompt().includes(INSTITUTION.full));
check('the extractor prompt forbids substituting another institution',
  /Do NOT substitute any other institution/i.test(buildExtractorPrompt()));

for (const marker of ['prepared by', 'drafted by', 'recorded by', 'compiled by']) {
  check(`"${marker}" is an author marker`, AUTHOR_ROLE_MARKERS.includes(marker));
}
check('the prompt states an author must not sign',
  /must NOT be listed in\s+signatories/i.test(buildExtractorPrompt().replace(/\s+/g, ' ')));
check('the prompt explains the author/signatory distinction',
  /AUTHOR VERSUS SIGNATORY/i.test(buildExtractorPrompt()));
check('the prompt flags the minutes recorder as author, not signatory',
  /Recorder or Secretary who wrote the minutes is the AUTHOR/i.test(buildExtractorPrompt()));
check('the schema captures authorName', Boolean(EXTRACTOR_SCHEMA.properties.authorName));
check('the schema captures authorRole', Boolean(EXTRACTOR_SCHEMA.properties.authorRole));

check('there are exactly three statuses',
  ASSIGNABLE_STATUSES.length === 3, ASSIGNABLE_STATUSES.join(','));
check('draft is gone', DOC_STATUS.DRAFT === undefined);
check('the statuses are pending, under review, approved',
  ASSIGNABLE_STATUSES.includes('pending') &&
    ASSIGNABLE_STATUSES.includes('under_review') &&
    ASSIGNABLE_STATUSES.includes('approved'));
check('every status has a label',
  ASSIGNABLE_STATUSES.every((s) => DOC_STATUS_LABELS[s]));
check('legacy values still render', normaliseStatus('draft') === 'pending');
check('a legacy rejected maps to under review',
  normaliseStatus('rejected') === 'under_review', normaliseStatus('rejected'));
check('legacy signatures map to pending',
  LEGACY_STATUS_MAP.pending_signature === 'pending');
check('a current value passes through', normaliseStatus('approved') === 'approved');
check('an unknown value falls back to pending', normaliseStatus('mystery') === 'pending');

console.log('\n=== Statuses stay identical across the deploy boundary ===');
// The values are DUPLICATED: the function cannot import from src/ because
// `firebase deploy --only functions` uploads only functions/. Without this
// check the app and the function would drift apart silently.
const { DOC_STATUS: FN_STATUS, LEGACY_STATUS_MAP: FN_LEGACY } = await import(
  '../functions/src/docStatus.js'
);
check(
  'the function and the app define the same statuses',
  JSON.stringify(Object.values(DOC_STATUS)) === JSON.stringify(Object.values(FN_STATUS)),
  `app=${Object.values(DOC_STATUS)} fn=${Object.values(FN_STATUS)}`
);
check(
  'both map legacy statuses identically',
  JSON.stringify(LEGACY_STATUS_MAP) === JSON.stringify(FN_LEGACY),
  `app=${JSON.stringify(LEGACY_STATUS_MAP)} fn=${JSON.stringify(FN_LEGACY)}`
);

// Nothing in functions/ may reach outside its own directory, or it works on the
// emulator and breaks on deploy.
const fnIndex = readFileSync('functions/src/index.js', 'utf8');
check('the function imports nothing from outside functions/',
  !/from '\.\.\/\.\.\/src\//.test(fnIndex),
  'found an import reaching into src/ — that fails on deploy');

console.log('\n' + results.join('\n'));
console.log(failed === 0 ? '\nAI logic is correct.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);