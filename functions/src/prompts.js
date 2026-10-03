/**
 * functions/src/prompts.js
 *
 * Separate prompts per operation, as the specification requires. One large
 * prompt produces shallow results across every field; three focused prompts
 * produce better answers per field and let a failure in one not block the
 * others.
 *
 * Every prompt demands JSON matching a schema, and every schema is declared
 * here alongside the prompt that fills it — so the prompt and the contract
 * cannot drift apart.
 */

/**
 * The institution these documents belong to.
 *
 * Supplied to the model so it can recognise the campus when a letterhead is
 * abbreviated, mis-scanned or reads only "CTU". Extraction still prefers what
 * the document actually says — this is context, not a hardcoded answer.
 */
export const INSTITUTION = {
  name: 'Cebu Technological University',
  campus: 'Daanbantayan Campus',
  full: 'Cebu Technological University - Daanbantayan Campus',
  // Common letterhead abbreviations that appear on official paperwork.
  aliases: ['CTU', 'CTU Daanbantayan', 'CTU-Daanbantayan Campus', 'Daanbantayan Campus'],
};

/**
 * Roles that mean "this person WROTE it", not "this person must approve it".
 *
 * A document's author does not sign their own paper, so any name found beside
 * one of these labels must be reported as the author and kept out of the
 * signature checklist.
 */
export const AUTHOR_ROLE_MARKERS = [
  'prepared by',
  'drafter',
  'drafted by',
  'compiled by',
  'encoded by',
  'created by',
  'authored by',
  'written by',
  'recorded by',
  'submitted by',
  'noted by',
  'certified correct by',
];

// ────────────────────────────────────────────────────────────
// CLASSIFIER
// ────────────────────────────────────────────────────────────

/**
 * The label vocabulary is supplied per call from Firestore, so an administrator
 * adding a label immediately changes what the AI may suggest — including the
 * description, which is what gives the model the context to use it.
 */
export const buildClassifierPrompt = (labels) => `
You are classifying an official student-government document.

Choose exactly one document type from this permitted list:
${labels.map((l) => `- ${l.name}: ${l.description || 'no description'}`).join('\n')}

Return:
- documentType: the single best label name from the list above.
- confidence: 0 to 1. How certain you are. Be honest — a low number lets a
  human correct you, which is far better than a confident wrong answer that
  becomes an official record.
- reason: one short sentence explaining the choice.

Use "Other" when nothing genuinely fits, rather than forcing a bad match.
`.trim();

export const CLASSIFIER_SCHEMA = {
  type: 'object',
  properties: {
    documentType: { type: 'string', description: 'The chosen label name' },
    confidence: { type: 'number', description: '0 to 1' },
    reason: { type: 'string', description: 'One sentence of justification' },
  },
  required: ['documentType', 'confidence', 'reason'],
};

// ────────────────────────────────────────────────────────────
// EXTRACTOR
// ────────────────────────────────────────────────────────────

/**
 * Dates are typed rather than lumped together, because a deadline and a
 * document date are different things operationally: one drives the dashboard,
 * the other is provenance.
 *
 * `verbatim` keeps the phrase the document actually used, since "within five
 * working days" has no absolute date and must not be invented.
 */
/** Confidence below which the UI asks a human instead of suggesting. */
export const CONFIDENCE_THRESHOLD = 0.75;

/**
 * The extractor system prompt.
 *
 * Built as a function so the institution and the author-marker list stay in one
 * place — a prompt that drifts from these constants is how a wrong campus name
 * or a self-signing author gets into an official record.
 */
export const buildExtractorPrompt = () => `
Extract structured metadata from this official document of ${INSTITUTION.full}.

ORGANISATION
- These documents belong to ${INSTITUTION.full}.
- Its letterhead may appear abbreviated as: ${INSTITUTION.aliases.join(', ')}.
- Read the organisation from the document. Prefer the name the document actually
  prints; normalise an abbreviation of this campus to "${INSTITUTION.name}".
- Do NOT substitute any other institution's name.

AUTHOR VERSUS SIGNATORY — this distinction matters
- The AUTHOR is the person who prepared the document. Look for a name beside a
  label such as: ${AUTHOR_ROLE_MARKERS.join(', ')}.
- Report that person in authorName and repeat the exact label in authorRole
  (for example "Prepared by").
- A signatory is somebody who must APPROVE the document — a President, a
  Director, a Campus Director, an adviser.
- An author never signs their own document, so the author must NOT be listed in
  signatories. If the same name appears in both places, keep them as the author
  and drop them from signatories.

GENERAL RULES
- Copy values exactly as written. Never invent, infer, reformat or CALCULATE a
  value. If the document does not state it, use null.
- Relative deadlines ("within five working days", "two weeks after approval") are
  the most common mistake. Put the phrase in verbatimDeadline and set deadline
  to null. Do NOT work out the calendar date yourself — even if the arithmetic
  looks obvious.
- Dates must be ISO format YYYY-MM-DD where the document gives an absolute date.
- If any date is genuinely absent, return null for it. A null is useful; a
  wrong date is harmful.

MINUTES OF A MEETING
- Put the date the meeting was held in meetingDate. Do NOT use documentDate for
  it, and do NOT use the date the minutes were typed up.
- Put the single overarching purpose or subject of the meeting in agenda. If
  there is no single overarching topic, put the meeting title there rather than
  inventing one.
- Put each individual item discussed in agendaItems, in the order they appear.
- The Recorder or Secretary who wrote the minutes is the AUTHOR, not a signatory.

Return the fields defined in the schema.
`.trim();

/** Kept as a plain string for callers that do not need the builder. */
export const EXTRACTOR_PROMPT = buildExtractorPrompt();

export const EXTRACTOR_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Official document title' },
    documentNumber: { type: 'string', description: 'Reference or control number, or null' },
    documentDate: { type: 'string', description: 'ISO date the document was issued, or null' },
    effectiveDate: { type: 'string', description: 'ISO date it takes effect, or null' },
    eventDate: { type: 'string', description: 'ISO date of an event it announces, or null' },
    deadline: { type: 'string', description: 'ISO submission/approval deadline, or null' },
    verbatimDeadline: { type: 'string', description: 'Relative deadline wording, e.g. "within five working days", or null' },
    meetingDate: { type: 'string', description: 'ISO date of a referenced meeting, or null' },
    academicYear: { type: 'string', description: 'e.g. "2026-2027", or null' },
subject: { type: 'string', description: 'Subject or purpose' },
    authorName: {
      type: 'string',
      description: 'The person who PREPARED the document (e.g. beside "Prepared by"). Null if none.',
    },
    authorRole: {
      type: 'string',
      description: 'The exact label beside the author name, e.g. "Prepared by". Null if none.',
    },
    agenda: { type: 'string', description: 'Main agenda or purpose of the meeting, for minutes. Null otherwise.' },
    agendaItems: {
      type: 'array',
      description: 'Individual items discussed, in document order. Minutes only; empty array otherwise.',
      items: { type: 'string' },
    },
    sender: { type: 'string', description: 'Issuing office or person' },
    recipient: { type: 'string', description: 'Addressee' },
    organization: { type: 'string', description: 'Issuing organization' },
    signatories: {
      type: 'array',
      description: 'Officials who must approve',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          position: { type: 'string' },
          required: { type: 'boolean' },
        },
        required: ['name', 'position', 'required'],
      },
    },
    referencedOffices: { type: 'array', items: { type: 'string' } },
    references: { type: 'array', items: { type: 'string' }, description: 'Document numbers this cites' },
    attachments: { type: 'array', items: { type: 'string' } },
    keywords: { type: 'array', items: { type: 'string' }, description: '3 to 8 short topical keywords' },
    unreadable: { type: 'boolean', description: 'True if the document appears scanned with no usable text' },
    unreadableReason: { type: 'string', description: 'Why, when unreadable is true' },
  },
  required: ['title', 'signatories', 'referencedOffices', 'references', 'attachments', 'keywords', 'unreadable', 'agendaItems'],
};

// ────────────────────────────────────────────────────────────
// SUMMARIZER
// ────────────────────────────────────────────────────────────

/**
 * The summary supplements the document; it never replaces it. Framed as a
 * factual brief so the model does not editorialize about an official record.
 */
export const SUMMARIZER_PROMPT = `
Write a concise administrative brief for this official document.

- Two to four sentences.
- State what the document does, who it affects and what it requires.
- No speculation, no recommendations, no opinion.
- If the document is unreadable, say so plainly.
`.trim();

export const SUMMARIZER_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two to four factual sentences' },
    actionRequired: { type: 'string', description: 'What must happen next, or null' },
  },
  required: ['summary'],
};

/** Guard against an over-long response consuming the context of the next step. */
export const MAX_INPUT_CHARS = 24000;// keep module init light: discovery has a 10s budget
