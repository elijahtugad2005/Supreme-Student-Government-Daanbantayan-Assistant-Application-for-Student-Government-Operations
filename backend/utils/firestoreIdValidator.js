/**
 * backend/utils/firestoreIdValidator.js
 * Validates single-segment Firestore document IDs before passing them to Admin SDK
 * `.collection(...).doc(id)`, preventing subcollection path traversal via `/` or `%2F`
 * (e.g. `<docId>/auditLogs/<logId>`).
 */

const SAFE_FIRESTORE_DOC_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function isValidFirestoreDocId(id) {
  if (typeof id !== 'string') return false;
  return SAFE_FIRESTORE_DOC_ID_RE.test(id);
}

module.exports = {
  SAFE_FIRESTORE_DOC_ID_RE,
  isValidFirestoreDocId,
};
