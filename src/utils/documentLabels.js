// utils/documentLabels.js
// PURPOSE: Document labels and the controlled vocabulary used by the repository.
//
// Labels are DATA, not code. The list below is only a seed; administrators can
// add, rename, re-describe and disable entries, and those edits persist in
// Firestore. Phase 2 additionally lets a label be offered to (or withheld from)
// the Gemini classifier — the description is what gets sent as context, so a
// well-written description is what makes classification accurate.

/**
 * Workflow states. Deliberately small: three outcomes an officer actually acts on.
 *
 * Earlier versions carried draft, pending_signature, partially_signed, rejected
 * and expired. Those were either redundant or unsafe — an officer could hand-set
 * "approved" on an unsigned document. Progress now comes from the signature
 * checklist, and status reflects only where the document actually is.
 *
 *   pending      filed, approvals outstanding
 *   under_review a person is checking it
 *   approved     every required signature is in
 *
 * All three are human-assignable, because a secretary can legitimately file a
 * paper as "under review" that the system would otherwise call "pending".
 */
export const DOC_STATUS = {
  PENDING: 'pending',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
};

export const DOC_STATUS_LABELS = {
  [DOC_STATUS.PENDING]: 'Pending',
  [DOC_STATUS.UNDER_REVIEW]: 'Under Review',
  [DOC_STATUS.APPROVED]: 'Approved',
};

/** Legacy values, mapped so older documents keep rendering sensibly. */
export const LEGACY_STATUS_MAP = {
  draft: DOC_STATUS.PENDING,
  pending_signature: DOC_STATUS.PENDING,
  partially_signed: DOC_STATUS.PENDING,
  returned_for_revision: DOC_STATUS.UNDER_REVIEW,
  rejected: DOC_STATUS.UNDER_REVIEW,
  expired: DOC_STATUS.UNDER_REVIEW,
};

export const normaliseStatus = (value) => {
  const key = String(value || '').toLowerCase();
  if (DOC_STATUS_LABELS[key]) return key;
  return LEGACY_STATUS_MAP[key] || DOC_STATUS.PENDING;
};

/** Statuses that a person may still choose by hand. */
export const ASSIGNABLE_STATUSES = Object.values(DOC_STATUS);

/**
 * Accepted uploads. PDF, DOCX, TXT and images per the specification.
 * `previewable` controls whether the browser can render it inline; everything
 * else falls back to a download, because an iframe pointed at a .docx shows
 * nothing useful.
 */
export const ACCEPTED_FORMATS = [
  { ext: '.pdf', mime: 'application/pdf', label: 'PDF', previewable: true },
  { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'DOCX', previewable: false },
  { ext: '.doc', mime: 'application/msword', label: 'DOC', previewable: false },
  { ext: '.txt', mime: 'text/plain', label: 'Text', previewable: true },
  { ext: '.jpg', mime: 'image/jpeg', label: 'JPEG', previewable: true },
  { ext: '.jpeg', mime: 'image/jpeg', label: 'JPEG', previewable: true },
  { ext: '.png', mime: 'image/png', label: 'PNG', previewable: true },
];

/** Generous enough for a scanned report, low enough to keep Storage tidy. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export const ACCEPT_ATTRIBUTE = ACCEPTED_FORMATS.map((f) => f.ext).join(',');

export const isAcceptedFile = (file) => {
  if (!file?.name) return false;
  const name = file.name.toLowerCase();
  return ACCEPTED_FORMATS.some((f) => name.endsWith(f.ext));
};

export const formatAcceptedTypes = () =>
  ACCEPTED_FORMATS.map((f) => f.ext.replace('.', '').toUpperCase()).join(', ');

export const canPreviewInline = (fileNameOrType) => {
  const value = String(fileNameOrType || '').toLowerCase();
  if (!value) return false;
  const name = value.includes('/') ? '' : value;
  const ext = name ? `.${name.split('.').pop()}` : '';
  return ACCEPTED_FORMATS.filter((f) => f.previewable).some((f) => f.ext === ext || value.includes(f.ext));
};

/**
 * The initial taxonomy. `slug` is the stable identity used across renames, so
 * renaming a label in the UI never orphans documents already tagged with it.
 */
export const SEED_LABELS = [
  { slug: 'resolution', name: 'Resolution', description: 'Formal decisions adopted by the assembly or council.', aiEnabled: true },
  { slug: 'memorandum', name: 'Memorandum', description: 'Internal communication or directive issued by an office.', aiEnabled: true },
  { slug: 'letter', name: 'Letter', description: 'Correspondence addressed to an external or internal party.', aiEnabled: true },
  { slug: 'narrative_report', name: 'Narrative Report', description: 'Report describing an activity, programme or event.', aiEnabled: true },
  { slug: 'minutes_of_meeting', name: 'Minutes of the Meeting', description: 'Recorded proceedings of a meeting or assembly: the meeting date, the main agenda, the items discussed and the decisions made.', aiEnabled: true },
  { slug: 'notice', name: 'Notice', description: 'Public announcement of an event, policy or deadline.', aiEnabled: true },
  { slug: 'request', name: 'Request', description: 'A formal request for an action, budget or approval.', aiEnabled: true },
  { slug: 'certification', name: 'Certification', description: 'Document attesting to the truth of a statement or record.', aiEnabled: true },
  { slug: 'financial', name: 'Financial Document', description: 'Liquidation, budget, receipts and other financial records.', aiEnabled: true },
  { slug: 'activity', name: 'Activity Document', description: 'Proposals, programmes and materials for student activities.', aiEnabled: true },
  { slug: 'administrative', name: 'Administrative Document', description: 'General office paperwork that fits no narrower category.', aiEnabled: true },
  { slug: 'other', name: 'Other', description: 'Anything that does not match the categories above.', aiEnabled: true },
];

/** Make a user-entered name safe to use as a document ID. */
export const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'label';

export const formatBytes = (bytes) => {
  const n = Number(bytes) || 0;
  if (!n) return '0 Bytes';
  const units = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${parseFloat((n / 1024 ** i).toFixed(1))} ${units[i]}`;
};

/** "2026-09-28" -> "28 Sep 2026". Invalid input is returned untouched. */
export const formatDate = (value) => {
  if (!value) return '—';
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};