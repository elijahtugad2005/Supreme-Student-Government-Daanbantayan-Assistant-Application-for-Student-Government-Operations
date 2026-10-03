// functions/src/docStatus.js
// PURPOSE: Document status values, defined INSIDE the functions bundle.
//
// WHY NOT IMPORTED FROM THE APP
//   `firebase deploy --only functions` uploads ONLY the functions/ directory.
//   Reaching across into ../../src would resolve locally and then fail on
//   deploy with ERR_MODULE_NOT_FOUND, long after the emulator said it was fine.
//
// WHY IT IS DUPLICATED
//   The same three values live in src/utils/documentLabels.js. They cannot be
//   shared across the deployment boundary, so instead the duplication is made
//   SAFE: scripts/ai-logic-check.mjs asserts the two definitions are identical,
//   so a change to one without the other fails a test rather than shipping a
//   function that disagrees with the UI.

export const DOC_STATUS = {
  PENDING: 'pending',
  UNDER_REVIEW: 'under_review',
  APPROVED: 'approved',
};

/** Older values mapped onto the current three, for documents filed before the change. */
export const LEGACY_STATUS_MAP = {
  draft: DOC_STATUS.PENDING,
  pending_signature: DOC_STATUS.PENDING,
  partially_signed: DOC_STATUS.PENDING,
  returned_for_revision: DOC_STATUS.UNDER_REVIEW,
  rejected: DOC_STATUS.UNDER_REVIEW,
  expired: DOC_STATUS.UNDER_REVIEW,
};
