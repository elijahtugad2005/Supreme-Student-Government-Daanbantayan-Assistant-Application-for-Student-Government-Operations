// services/deathAidService.js
// PURPOSE: Death Aid collection, remittance and audit workflow.
//
// DESIGN — why this is section-level, not name-level:
//   The officer counts who handed money in; they do not walk a list of forty
//   students. A collection records HOW MANY beneficiaries paid against how many
//   students the official roster says are enrolled. The difference is the debt.
//
// DESIGN — why there is no second student store:
//   Enrolled count is read from the verified classroom roster and cross-checked
//   by firestore.rules, so it can never be typed in to shrink a debt.
//
// DESIGN — why outstanding REPLACES rather than accumulates:
//   The most recent collection for a section is the current truth about that
//   section. Every earlier filing is preserved as a document and an audit entry,
//   so the history is intact while the balance stays unambiguous.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import {
  DEATH_AID_COLLECTION_STATUS,
  DEATH_AID_DEBT_TYPES,
  DEATH_AID_REMITTANCE_STATUS,
} from '../utils/permissions';

export const COLLECTION_COLLECTION = 'deathAidCollections';
export const REMITTANCE_COLLECTION = 'deathAidRemittances';
export const AUDIT_COLLECTION = 'deathAidAuditLog';
export const COUNTER_COLLECTION = 'deathAidCounters';

const rethrowWithSpec = (label, error) => {
  if (error?.code === 'failed-precondition') {
    const tagged = new Error(`${label} could not run — Firestore needs a composite index here.`);
    tagged.code = error.code;
    return tagged;
  }
  return error;
};

const timeValue = (value) => {
  if (value === null || value === undefined) return -Infinity;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isNaN(parsed) ? -Infinity : parsed;
};

const newestFirst = (field) => (a, b) => {
  const diff = timeValue(b[field]) - timeValue(a[field]);
  return diff !== 0 ? diff : String(a.id).localeCompare(String(b.id));
};

// ────────────────────────────────────────────────────────────
// ARITHMETIC — the officer enters one number; everything else follows
// ────────────────────────────────────────────────────────────

/**
 * Worked example from the SSG's own example: 40 enrolled, 39 pesos handed in at
 * ₱1 per beneficiary -> 39 beneficiaries, ₱39 collected, ₱40 expected, and one
 * student on record as owing ₱1.
 *
 * @param {number} enrolledCount  from the verified roster, never typed
 * @param {number} contribution   pesos per beneficiary
 * @param {number} beneficiaries  how many actually paid
 */
export const computeTotals = (enrolledCount, contribution, beneficiaries) => {
  const enrolled = Math.max(0, Number(enrolledCount) || 0);
  const perStudent = Math.max(0, Number(contribution) || 0);
  const paid = Math.max(0, Number(beneficiaries) || 0);

  // More beneficiaries than enrolled students is a data-entry mistake, not a
  // real outcome. Clamped so the totals always balance instead of going
  // negative, which would present an absurd "credit".
  const counted = Math.min(paid, enrolled);

  return {
    enrolledCount: enrolled,
    contributionPerStudent: perStudent,
    beneficiaryCount: counted,
    collectedAmount: counted * perStudent,
    expectedCollection: enrolled * perStudent,
    debtCount: enrolled - counted,
    debtAmount: (enrolled - counted) * perStudent,
    // Surfaced in the UI so the officer is told, rather than silently corrected.
    wasClamped: paid > enrolled,
  };
};

/**
 * Outstanding per section: the latest collection wins.
 *
 * @param {Array} collections every filing for the sections of interest
 */
export const computeOutstanding = (collections) => {
  const latestBySection = new Map();

  collections.forEach((c) => {
    const current = latestBySection.get(c.sectionKey);
    if (!current || timeValue(c.submittedAt) > timeValue(current.submittedAt)) {
      latestBySection.set(c.sectionKey, c);
    }
  });

  return Array.from(latestBySection.values())
    .map((c) => ({
      sectionKey: c.sectionKey,
      section: c.section,
      program: c.program,
      collectionId: c.collectionId,
      recordedAt: c.submittedAt,
      debtCount: c.debtCount ?? 0,
      debtAmount: c.debtAmount ?? 0,
      // Optional detail. May be shorter than debtCount when some debtors were
      // never identified, which is a normal outcome and not an error.
      debtRecords: c.debtRecords || [],
      unidentifiedCount: Math.max(0, (c.debtCount ?? 0) - (c.debtRecords?.length ?? 0)),
    }))
    .sort((a, b) => a.section.localeCompare(b.section));
};

// ────────────────────────────────────────────────────────────
// COLLECTION ID — DA-2026-0001
// ────────────────────────────────────────────────────────────

/**
 * Allocate the next collection id for a year, in a transaction so two officers
 * recording at the same moment cannot be handed the same number. The id is part
 * of the audit record, so a collision would corrupt it.
 */
const allocateCollectionId = async (year) => {
  const ref = doc(db, COUNTER_COLLECTION, String(year));
  let allocated = 0;

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const next = (snap.exists() ? snap.data().count || 0 : 0) + 1;
    tx.set(ref, { count: next, year, updatedAt: serverTimestamp() });
    allocated = next;
  });

  return `DA-${year}-${String(allocated).padStart(4, '0')}`;
};

// ────────────────────────────────────────────────────────────
// AUDIT — append only
// ────────────────────────────────────────────────────────────

export const appendAudit = async ({ collectionId, action, actor, extra = {} }) => {
  await setDoc(doc(collection(db, AUDIT_COLLECTION)), {
    collectionId,
    action,
    actorUid: actor?.uid || null,
    actorName: actor?.name || 'Unknown',
    actorRole: actor?.role || 'unknown',
    at: serverTimestamp(),
    ...extra,
  });
};

// ────────────────────────────────────────────────────────────
// OFFICER RECORDS A COLLECTION
// ────────────────────────────────────────────────────────────

/**
 * @param {Object} p
 * @param {Object} p.roster          verified classroom roster for the section
 * @param {number} p.contribution     pesos per beneficiary
 * @param {number} p.beneficiaries   how many students actually paid
 * @param {Array}  [p.debtRecords]   optional: who owes, and why
 * @param {string} [p.submittedByName] the student who brought the money in
 * @param {Object} p.recorder        the officer account making the entry
 */
export const recordSectionCollection = async ({
  roster,
  contribution,
  beneficiaries,
  debtRecords = [],
  submittedByName = '',
  recorder,
}) => {
  if (!roster?.rosterId) throw new Error('Choose a section with a verified roster.');
  if (!recorder?.uid) throw new Error('You must be signed in to record a collection.');

  const totals = computeTotals(roster.studentCount, contribution, beneficiaries);
  if (totals.enrolledCount === 0) throw new Error('That roster has no students enrolled.');

  // Detail is optional and may be partial, but it can never exceed the debt it
  // is describing.
  const records = debtRecords
    .filter((r) => r && (r.studentName || r.debtType !== DEATH_AID_DEBT_TYPES.NAMED))
    .slice(0, totals.debtCount)
    .map((r) => ({
      studentName: r.debtType === DEATH_AID_DEBT_TYPES.NAMED ? String(r.studentName || '').trim() : '',
      debtType: r.debtType || DEATH_AID_DEBT_TYPES.ANONYMOUS,
      note: String(r.note || '').trim(),
      amount: totals.contributionPerStudent,
    }));

  const year = new Date().getFullYear();
  const collectionId = await allocateCollectionId(year);

  await setDoc(doc(db, COLLECTION_COLLECTION, collectionId), {
    collectionId,
    rosterId: roster.rosterId,
    rosterVersion: roster.version ?? null,
    sectionKey: roster.sectionKey,
    section: roster.section,
    program: roster.program,
    college: roster.college,
    yearLevel: roster.yearLevel ?? null,
    mayorName: roster.mayorName || 'No Mayor Assigned',

    ...totals,

    debtRecords: records,
    // Automatic, and honest about the gap rather than hiding it.
    unidentifiedDebtCount: Math.max(0, totals.debtCount - records.length),

    // Who physically brought the money in, and who typed this in. Kept apart so
    // the audit can name both.
    submittedByName: String(submittedByName).trim() || 'Not recorded',
    recordedByUid: recorder.uid,
    recordedByName: recorder.name,
    recordedByRole: recorder.role,

    status: DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION,
    submittedAt: serverTimestamp(),
    confirmedAt: null,
    confirmedByUid: null,
    confirmedByName: null,
    amountReceived: null,
  });

  await appendAudit({
    collectionId,
    action: 'collection_recorded',
    actor: recorder,
    extra: {
      section: roster.section,
      sectionKey: roster.sectionKey,
      enrolledCount: totals.enrolledCount,
      beneficiaryCount: totals.beneficiaryCount,
      contributionPerStudent: totals.contributionPerStudent,
      collectedAmount: totals.collectedAmount,
      expectedCollection: totals.expectedCollection,
      debtCount: totals.debtCount,
      submittedByName: String(submittedByName).trim() || 'Not recorded',
      namedDebts: records.length,
      rosterId: roster.rosterId,
    },
  });

  return collectionId;
};

// ────────────────────────────────────────────────────────────
// LATER: ATTACH NAMES TO EXISTING DEBTS
// ────────────────────────────────────────────────────────────

/**
 * Fill in who actually owes once the officer has tracked them down.
 *
 * The debt COUNT and AMOUNT are never touched — they were already true when
 * the money was counted. Only the explanation improves, and the previous state
 * is kept so the timeline shows what was known on collection day.
 */
export const attachDebtDetails = async ({ collectionId, debtRecords, actor }) => {
  const ref = doc(db, COLLECTION_COLLECTION, collectionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('That collection no longer exists.');

  const record = snap.data();
  const amount = record.contributionPerStudent;

  const records = debtRecords.slice(0, record.debtCount ?? 0).map((r) => ({
    studentName: r.debtType === DEATH_AID_DEBT_TYPES.NAMED ? String(r.studentName || '').trim() : '',
    debtType: r.debtType || DEATH_AID_DEBT_TYPES.ANONYMOUS,
    note: String(r.note || '').trim(),
    amount,
  }));

  await setDoc(
    ref,
    {
      debtRecords: records,
      unidentifiedDebtCount: Math.max(0, (record.debtCount ?? 0) - records.length),
      // Timestamped automatically; nobody types the date.
      debtDetailsCompletedAt: serverTimestamp(),
      debtDetailsCompletedByUid: actor.uid,
      debtDetailsCompletedByName: actor.name,
    },
    { merge: true }
  );

  await appendAudit({
    collectionId,
    action: 'debt_details_completed',
    actor,
    extra: {
      section: record.section,
      debtCount: record.debtCount,
      namedDebts: records.length,
    },
  });
};

// ────────────────────────────────────────────────────────────
// REMITTANCE
// ────────────────────────────────────────────────────────────

/**
 * Record that the money was handed over and who took it.
 *
 * reportedAmount is copied from the collection, never recomputed, so a mismatch
 * can never be hidden by adjusting the original figure.
 */
export const recordRemittance = async ({ collectionId, amountReceived, officer, note = '' }) => {
  const collectionRef = doc(db, COLLECTION_COLLECTION, collectionId);
  const snap = await getDoc(collectionRef);
  if (!snap.exists()) throw new Error('That collection no longer exists.');

  const record = snap.data();
  if (record.status !== DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION) {
    throw new Error(`This collection is already ${String(record.status).replace(/_/g, ' ')}.`);
  }
  // The officer who typed the collection in holds the same cash, so they may
  // not also be the one certifying it.
  if (officer?.uid && officer.uid === record.recordedByUid) {
    throw new Error('You recorded this collection, so you cannot also verify it.');
  }

  const received = Number(amountReceived);
  if (!Number.isFinite(received) || received < 0) {
    throw new Error('Enter the amount actually received.');
  }

  const reported = record.collectedAmount;
  const difference = Math.round((received - reported) * 100) / 100;
  const status =
    difference === 0
      ? DEATH_AID_REMITTANCE_STATUS.CONFIRMED
      : DEATH_AID_REMITTANCE_STATUS.DISCREPANCY;

  const remittance = {
    collectionId,
    sectionKey: record.sectionKey,
    section: record.section,
    reportedAmount: reported,
    amountReceived: received,
    difference,
    status,
    note: String(note).trim(),
    receivedByUid: officer.uid,
    receivedByName: officer.name,
    receivedByRole: officer.role,
    receivedAt: serverTimestamp(),
    discrepancyNotedByUid: status === DEATH_AID_REMITTANCE_STATUS.DISCREPANCY ? officer.uid : null,
    discrepancyNotedAt: status === DEATH_AID_REMITTANCE_STATUS.DISCREPANCY ? serverTimestamp() : null,
  };

  await setDoc(doc(db, REMITTANCE_COLLECTION, collectionId), remittance);

  // Only the verdict and the money received change. The counted figures stay
  // exactly as the officer recorded them.
  await setDoc(
    collectionRef,
    {
      status:
        status === DEATH_AID_REMITTANCE_STATUS.CONFIRMED
          ? DEATH_AID_COLLECTION_STATUS.CONFIRMED
          : DEATH_AID_COLLECTION_STATUS.DISCREPANCY,
      amountReceived: received,
      confirmedAt: serverTimestamp(),
      confirmedByUid: officer.uid,
      confirmedByName: officer.name,
    },
    { merge: true }
  );

  await appendAudit({
    collectionId,
    action:
      status === DEATH_AID_REMITTANCE_STATUS.CONFIRMED
        ? 'remittance_confirmed'
        : 'discrepancy_flagged',
    actor: officer,
    extra: {
      section: record.section,
      sectionKey: record.sectionKey,
      reportedAmount: reported,
      amountReceived: received,
      difference,
      note: remittance.note,
    },
  });

  return remittance;
};

// ────────────────────────────────────────────────────────────
// READS
// ────────────────────────────────────────────────────────────

export const getCollection = async (collectionId) => {
  const snap = await getDoc(doc(db, COLLECTION_COLLECTION, collectionId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

/** Verified rosters available to record a collection against. */
export const listVerifiedRosters = async () => {
  const snap = await getDocs(
    query(collection(db, 'classRosters'), where('status', '==', 'verified'))
  );
  return snap.docs.map((d) => ({ ...d.data(), rosterId: d.id })).sort((a, b) =>
    String(a.section).localeCompare(String(b.section))
  );
};

export const listCollections = async ({ status, sectionKey } = {}) => {
  try {
    const clauses = [];
    if (status) clauses.push(where('status', '==', status));
    if (sectionKey) clauses.push(where('sectionKey', '==', sectionKey));
    // No orderBy: a filter plus a sort on a second field would require a
    // composite index. The set is small, so it is sorted in memory.
    const snap = await getDocs(query(collection(db, COLLECTION_COLLECTION), ...clauses));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst('submittedAt'));
  } catch (error) {
    throw rethrowWithSpec('collections', error);
  }
};

export const listPendingCollections = () =>
  listCollections({ status: DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION });

export const listRemittances = async ({ status } = {}) => {
  try {
    const clauses = status ? [where('status', '==', status)] : [];
    const snap = await getDocs(query(collection(db, REMITTANCE_COLLECTION), ...clauses, limit(200)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst('receivedAt'));
  } catch (error) {
    throw rethrowWithSpec('remittances', error);
  }
};

export const listAuditLog = async (collectionId) => {
  try {
    const clauses = collectionId ? [where('collectionId', '==', collectionId)] : [];
    const snap = await getDocs(query(collection(db, AUDIT_COLLECTION), ...clauses, limit(500)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst('at'));
  } catch (error) {
    throw rethrowWithSpec('audit', error);
  }
};

/** Freeze a collection into a reporting snapshot so later rows cannot alter it. */
export const buildCollectionSnapshot = (record) => ({
  collectionId: record.collectionId,
  section: record.section,
  sectionKey: record.sectionKey,
  enrolledCount: record.enrolledCount,
  beneficiaryCount: record.beneficiaryCount,
  contributionPerStudent: record.contributionPerStudent,
  collectedAmount: record.collectedAmount,
  expectedCollection: record.expectedCollection,
  debtCount: record.debtCount,
  debtAmount: record.debtAmount,
  amountReceived: record.amountReceived ?? null,
  status: record.status,
  capturedAt: new Date().toISOString(),
});