/**
 * functions/src/apply.js
 *
 * The Phase 3 decision: which AI-suggested fields an administrator actually
 * accepted, and what the document should become.
 *
 * Extracted from the callable so it can be tested without deploying, and so the
 * rule "only ticked fields, only non-empty values, overrides win" lives in one
 * readable place rather than inside a handler.
 */

/**
 * Field definitions, shared with the UI so the checkbox list and the applied
 * values cannot drift apart.
 */
export const APPLIABLE_FIELDS = [
  { key: 'documentType', label: 'Document type', target: 'labels', from: 'suggestion' },
  { key: 'title', label: 'Title', target: 'title', from: 'extraction' },
  { key: 'documentNumber', label: 'Document number', target: 'documentNumber', from: 'extraction' },
  { key: 'documentDate', label: 'Document date', target: 'documentDate', from: 'extraction' },
  { key: 'subject', label: 'Subject', target: 'subject', from: 'extraction' },
  { key: 'agenda', label: 'Main agenda', target: 'agenda', from: 'extraction' },
  { key: 'agendaItems', label: 'Agenda items', target: 'agendaItems', from: 'extraction', list: true },
  { key: 'organization', label: 'Office', target: 'office', from: 'extraction' },
  { key: 'deadline', label: 'Deadline', target: 'deadline', from: 'extraction' },
  { key: 'keywords', label: 'Keywords', target: 'keywords', from: 'extraction' },
];

const isEmpty = (value) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

/**
 * Resolve a label name (as returned by the model) to its stored slug.
 * Falls back to treating the value as a slug already, then to 'other'.
 */
export const resolveLabelSlug = (nameOrSlug, labels) => {
  const list = labels || [];
  const value = String(nameOrSlug || '').trim();
  if (!value) return 'other';
  const byName = list.find((l) => String(l.name).toLowerCase() === value.toLowerCase());
  if (byName) return byName.id;
  const bySlug = list.find((l) => l.id === value);
  return bySlug ? bySlug.id : 'other';
};

/**
 * Build the patch for a confirmation.
 *
 * @param {Object} p
 * @param {Array<string>} p.apply   field keys the administrator ticked
 * @param {Object} [p.overrides]   human-corrected values, keyed by field
 * @param {Object} p.suggestion     document.aiSuggestion
 * @param {Object} p.extraction     document.aiExtraction
 * @param {Array} p.labels          the label vocabulary
 * @returns {{patch: Object, accepted: Array<string>, skipped: Array<string>}}
 */
export const buildApplyPatch = ({ apply = [], overrides = {}, suggestion = {}, extraction = {}, labels = [] }) => {
  const ticked = new Set(apply);
  const patch = {};
  const accepted = [];
  const skipped = [];

  APPLIABLE_FIELDS.forEach((field) => {
    if (!ticked.has(field.key)) return;

    // A human correction always beats the model's value.
    const override = Object.prototype.hasOwnProperty.call(overrides, field.key)
      ? overrides[field.key]
      : undefined;
    const suggested =
      field.from === 'suggestion' ? suggestion.documentTypeLabel : extraction[field.key];

    const value = override !== undefined ? override : suggested;

    if (isEmpty(value)) {
      // The model found nothing here, so there is nothing to verify.
      skipped.push(field.key);
      return;
    }

    patch[field.target] =
      field.key === 'documentType' ? [resolveLabelSlug(value, labels)] : value;
    accepted.push(field.key);
  });

  return { patch, accepted, skipped };
};

/**
 * Merge newly verified field keys into the existing list.
 * Verified provenance is cumulative, so a field verified once stays marked.
 */
export const mergeVerifiedFields = (existing = [], accepted = []) =>
  Array.from(new Set([...existing, ...accepted]));

/** Does this field already carry human confirmation? */
export const isVerifiedField = (document, key) =>
  (document?.verifiedFields || []).includes(key);

/**
 * Relative-deadline guard.
 *
 * The model is told to leave `deadline` null when a document uses relative
 * wording ("within five working days"), but it tends to helpfully compute an
 * absolute date anyway. An invented deadline is not a cosmetic error: it feeds
 * the overdue dashboard and can show an officer that a deadline was missed when
 * no such date was ever stated.
 *
 * So when a relative phrase is present, the computed date is discarded and the
 * wording is kept. A human can resolve it later. Compliance is not relied upon
 * for a correctness invariant.
 *
 * @returns {Object} a new extraction; the input is not mutated
 */
export const guardRelativeDeadline = (extraction) => {
  const value = extraction || {};
  const hasRelative = typeof value.verbatimDeadline === 'string' && value.verbatimDeadline.trim();

  if (!hasRelative) return { ...value, deadlineInferred: false };
  if (!value.deadline) return { ...value, deadlineInferred: false };

  return {
    ...value,
    deadline: null,
    deadlineInferred: true,
  };
};

/**
 * The suggestion should not be presented as authoritative below the threshold.
 */
export const suggestionIsTrustworthy = (suggestion, threshold) =>
  Boolean(suggestion) &&
  !suggestion.requiresReview &&
  Number(suggestion.confidence) >= threshold;

/**
 * Merge a suggestion onto the document for display without mutating the
 * original values. Used to show "suggested vs current" side by side.
 */
export const diffAgainstDocument = (document, suggestion, extraction) => {
  const rows = [];
  APPLIABLE_FIELDS.forEach((field) => {
    const suggested =
      field.from === 'suggestion' ? suggestion?.documentTypeLabel : extraction?.[field.key];
    if (isEmpty(suggested)) return;
    const current =
      field.key === 'documentType'
        ? document.labels?.[0]
        : field.key === 'organization'
          ? document.office
          : document[field.key];
    rows.push({
      key: field.key,
      label: field.label,
      suggested,
      current,
      differs: String(suggested) !== String(current ?? ''),
      verified: isVerifiedField(document, field.key),
    });
  });
  return rows;
};