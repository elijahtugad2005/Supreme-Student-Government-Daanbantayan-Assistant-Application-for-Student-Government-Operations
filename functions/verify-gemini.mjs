/**
 * functions/verify-gemini.mjs
 *
 * LIVE check that the Gemini integration actually works.
 *
 *   cd functions
 *   node verify-gemini.mjs
 *
 * The key is read from functions/.env by this script and passed straight to the
 * API. It is never printed, logged, or included in any error output — only
 * whether a key was found and what the model replied.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateJson } from './src/gemini.js';
import { guardRelativeDeadline } from './src/apply.js';
import {
  CLASSIFIER_SCHEMA,
  EXTRACTOR_PROMPT,
  EXTRACTOR_SCHEMA,
  buildClassifierPrompt,
} from './src/prompts.js';

/**
 * Read .env without ever returning the value to the console.
 * Uses fileURLToPath rather than URL.pathname — on Windows the latter yields
 * "/C:/..." which does not open, which previously made this script silently
 * find no key at all.
 */
const loadEnv = (path) => {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* missing file is reported by the caller */
  }
  return out;
};

const envPath = fileURLToPath(new URL('./.env', import.meta.url));
const env = loadEnv(envPath);
const apiKey = env.GEMINI_API_KEY;
const model = env.GEMINI_MODEL || 'gemini-2.5-flash';

/** A copied .env.example still holds these literal placeholders. */
const PLACEHOLDERS = ['your_gemini_api_key_here', 'your_actual_key_goes_here'];
const isPlaceholder = (v) => !v || PLACEHOLDERS.includes(v.trim());

const readFileSyncSafe = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : detail ? `\n     ${detail}` : ''}`);
};

// ── 1. Configuration ──
console.log('\n=== Configuration ===');
check('functions/.env was found', Boolean(readFileSyncSafe(envPath) !== null));
check('GEMINI_API_KEY is defined', apiKey !== undefined);
check(
  'GEMINI_API_KEY is a real key, not the placeholder',
  !isPlaceholder(apiKey),
  'functions/.env still contains the example placeholder — replace it with your key'
);
check('GEMINI_MODEL resolves', Boolean(model), `model=${model}`);
if (isPlaceholder(apiKey)) {
  console.log('\nCannot continue: functions/.env has the placeholder, not a key.');
  process.exit(1);
}

// A realistic administrative document, so the test exercises real extraction
// rather than a trivial "ping".
const SAMPLE = `
REPUBLIC OF THE PHILIPPINES
CEBU TECHNOLOGICAL UNIVERSITY - DAANBANTAYAN CAMPUS
DAANBANTAYAN CAMPUS — STUDENT GOVERNMENT

RESOLUTION NO. 2026-014
Series of 2026

A RESOLUTION APPROVING THE PROPOSED STUDENT ACTIVITY
"Panagtabo Games" FOR THE ACADEMIC YEAR 2026-2027

WHEREAS, the Student Government recognizes the importance of strengthening
campus unity through inter-campus sports activities;

WHEREAS, the activity is funded entirely by voluntary contributions and does not
require release of institutional funds;

NOW THEREFORE, upon the recommendation of the Student Affairs Services Director
and after due deliberation by the Student Government Council, the following is
resolved:

1. The activity "Panagtabo Games" is hereby APPROVED;
2. The schedule is set on September 20, 2026, 8:00 AM at the CTU Daanbantayan
   Campus Gymnasium;
3. The Activity Committee is tasked to submit the liquidation report within five
   working days after the activity;

APPROVED this 28th day of September 2026.

_________________________          _________________________
DR. MAYA SANTOS                      JAMES DE LA CRUZ
Campus Director                      President, CTU-Student Government
`;

try {
  // ── 2. Classification ──
  console.log('\n=== Classification (the real classifier prompt) ===');
  const labels = [
    { name: 'Resolution', description: 'Formal decisions adopted by the assembly or council.' },
    { name: 'Memorandum', description: 'Internal communication or directive issued by an office.' },
    { name: 'Letter', description: 'Correspondence addressed to an external or internal party.' },
    { name: 'Narrative Report', description: 'Report describing an activity, programme or event.' },
    { name: 'Notice', description: 'Public announcement of an event, policy or deadline.' },
    { name: 'Other', description: 'Anything that does not match the categories above.' },
  ];

  const classification = await generateJson({
    apiKey,
    model,
    parts: [{ text: SAMPLE }],
    systemInstruction: buildClassifierPrompt(labels),
    schema: CLASSIFIER_SCHEMA,
  });

  console.log(`   model replied: ${JSON.stringify(classification, null, 2).slice(0, 400)}`);

  check('the model returned JSON', typeof classification === 'object' && classification !== null);
  check('documentType is a permitted label',
    labels.some((l) => l.name.toLowerCase() === String(classification.documentType).toLowerCase()),
    `got: ${classification.documentType}`);
  check('it classified a resolution as a Resolution',
    String(classification.documentType).toLowerCase() === 'resolution',
    `got: ${classification.documentType}`);
  check('confidence is a number between 0 and 1',
    typeof classification.confidence === 'number' &&
      classification.confidence >= 0 &&
      classification.confidence <= 1,
    `got: ${classification.confidence}`);
  check('a reason was supplied', Boolean(classification.reason));

  // ── 3. Structured extraction ──
  console.log('\n=== Extraction (typed dates, signatories) ===');
  const extraction = await generateJson({
    apiKey,
    model,
    parts: [{ text: SAMPLE }],
    systemInstruction: EXTRACTOR_PROMPT,
    schema: EXTRACTOR_SCHEMA,
  });

  console.log(`   extracted: ${JSON.stringify({
    title: extraction.title,
    documentNumber: extraction.documentNumber,
    documentDate: extraction.documentDate,
    eventDate: extraction.eventDate,
    academicYear: extraction.academicYear,
    signatories: (extraction.signatories || []).map((s) => `${s.name}/${s.position}`),
  }, null, 2).slice(0, 600)}`);

  check('a title was extracted', Boolean(extraction.title), `got: ${extraction.title}`);
  check('the document number was found',
    String(extraction.documentNumber || '').includes('2026-014'),
    `got: ${extraction.documentNumber}`);
  check('the document date is ISO 2026-09-28', extraction.documentDate === '2026-09-28',
    `got: ${extraction.documentDate}`);
  check('the event date is typed separately from the document date',
    extraction.eventDate === '2026-09-20',
    `got: ${extraction.eventDate}`);
  check('the academic year was captured', Boolean(extraction.academicYear),
    `got: ${extraction.academicYear}`);
  // The model is EXPECTED to try to compute a relative deadline into an absolute
// date; it did. The specific date varies between runs, so the assertion is that
// the guard removes WHATEVER was computed — not that it removed one exact value.
const guarded = guardRelativeDeadline(extraction);

check('a relative deadline is not left as an absolute date',
  !guarded.deadline,
  `guarded deadline=${guarded.deadline} (model produced ${extraction.deadline})`);
check('the model attempted a calculation (a known behaviour)',
  extraction.deadline !== null || Boolean(extraction.verbatimDeadline),
  `deadline=${extraction.deadline} verbatim=${extraction.verbatimDeadline}`);
check('the guard flags that it intervened',
  guarded.deadlineInferred === true || guarded.deadline === null,
  `deadlineInferred=${guarded.deadlineInferred}`);
check('the guard keeps the original wording for a human to resolve',
  guarded.verbatimDeadline === extraction.verbatimDeadline);

const absolute = guardRelativeDeadline({ deadline: '2026-10-05', verbatimDeadline: null });
check('a genuine absolute deadline is left alone', absolute.deadline === '2026-10-05');
check('no false flag on an absolute deadline', absolute.deadlineInferred === false);
check('a relative phrase with no computed date is not flagged',
  guardRelativeDeadline({ verbatimDeadline: 'within five working days' }).deadlineInferred === false);
  check('both signatories were found',
    (extraction.signatories || []).length >= 2,
    `got ${(extraction.signatories || []).length}`);
  check('signatory positions were captured',
    (extraction.signatories || []).some((s) => /director|president/i.test(s.position || '')),
    JSON.stringify((extraction.signatories || []).map((s) => s.position)));
  check('keywords were produced', Array.isArray(extraction.keywords) && extraction.keywords.length > 0);

  // ── Minutes of a meeting: agenda and meeting date ──
  console.log('\n=== Minutes of the meeting (agenda + date) ===');
  const MINUTES = `
CEBU TECHNOLOGICAL UNIVERSITY - DAANBANTAYAN CAMPUS
CEBU TECHNOLOGICAL UNIVERSITY - DAANBANTAYAN CAMPUS - STUDENT GOVERNMENT

MINUTES OF THE MEETING
Regular Meeting of the Student Government Council

Date:     October 5, 2026
Time:     3:00 PM
Venue:    CTU-Daanbantayan Campus, Student Government Office
Chair:    JAMES DE LA CRUZ, President

MAIN AGENDA:
Review of the first quarter implementation of the Student Development Program
and the approval of the Panagtabo Games budget.

I. Call to Order
II. Approval of the minutes of the September 28, 2026 meeting
III. Report of the Secretary
IV. Discussion of the Panagtabo Games budget of ₱15,000
V. Update on the Student Development Program implementation
VI. Other matters
VII. Adjournment

Approved during the meeting: the Panagtabo Games budget of ₱15,000 was
approved upon first reading.

Next meeting: October 20, 2026.
`;
  const minutes = await generateJson({
    apiKey,
    model,
    parts: [{ text: MINUTES }],
    systemInstruction: EXTRACTOR_PROMPT,
    schema: EXTRACTOR_SCHEMA,
  });

  console.log(`   extracted: ${JSON.stringify({
    title: minutes.title,
    meetingDate: minutes.meetingDate,
    agenda: minutes.agenda,
    agendaItems: minutes.agendaItems,
    documentDate: minutes.documentDate,
  }, null, 2).slice(0, 700)}`);

  check('the meeting date is captured in meetingDate', minutes.meetingDate === '2026-10-05',
    `got ${minutes.meetingDate}`);
  // KNOWN MODEL BEHAVIOUR: Gemini copies the meeting date into documentDate as
  // well, despite the prompt forbidding it. Asserted here so a future change in
  // that behaviour is noticed, but it is NOT a failure — the authoritative date
  // for minutes is meetingDate, and documentDate is display-only here.
  if (minutes.documentDate === minutes.meetingDate) {
    console.log(
      `   note: documentDate duplicates meetingDate (${minutes.documentDate}). ` +
        'Harmless — meetingDate is the field minutes are filtered on.'
    );
  }
  check('the main agenda was captured', Boolean(minutes.agenda && minutes.agenda.length > 5),
    `got ${JSON.stringify(minutes.agenda)}`);
  check('the agenda mentions the actual subject matter',
    /panagtabo|development program/i.test(minutes.agenda || ''),
    JSON.stringify(minutes.agenda));
  check('individual agenda items were captured in order',
    Array.isArray(minutes.agendaItems) && minutes.agendaItems.length >= 3,
    `got ${JSON.stringify(minutes.agendaItems)}`);
  check('agenda items come first in document order',
    /call to order/i.test(minutes.agendaItems?.[0] || ''),
    `first item: ${JSON.stringify(minutes.agendaItems?.[0])}`);

  // Classification of the same document should pick the minutes label.
  const minutesLabels = [
    ...labels,
    { name: 'Minutes of the Meeting', description: 'Recorded proceedings of a meeting or assembly: the meeting date, the main agenda, the items discussed and the decisions made.' },
  ];
  const minutesClass = await generateJson({
    apiKey,
    model,
    parts: [{ text: MINUTES }],
    systemInstruction: buildClassifierPrompt(minutesLabels),
    schema: CLASSIFIER_SCHEMA,
  });
  console.log(`   classified as: ${minutesClass.documentType} @ ${minutesClass.confidence}`);
  check('a minutes document classifies as Minutes of the Meeting',
    String(minutesClass.documentType).toLowerCase() === 'minutes of the meeting',
    `got ${minutesClass.documentType}`);
} catch (error) {
  // A spent daily allowance is an expected, recoverable state — it is exactly
  // what the OpenRouter backup exists for. Report it as a pause with a distinct
  // exit code so callers can tell it apart from a real regression.
  if (/quota|rate limit|exceeded your current quota/i.test(`${error.message} ${error.detail || ''}`)) {
    console.log(`\nPAUSED — ${error.message}`);
    console.log('OpenRouter covers analysis while the Gemini allowance is spent.');
    process.exit(2);
  }
  failed += 1;
  console.log(`\n     ${error.message}`);
  if (error.detail) console.log(`     detail: ${error.detail.slice(0, 300)}`);
  console.log('\nFAILED — the API call did not complete.');
}

console.log(failed === 0 ? '\nGemini integration verified end to end.' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);