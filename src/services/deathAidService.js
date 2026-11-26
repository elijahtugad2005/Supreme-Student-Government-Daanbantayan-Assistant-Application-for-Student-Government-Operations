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
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig.js';
import {
  DEATH_AID_COLLECTION_STATUS,
  DEATH_AID_DEBT_TYPES,
  DEATH_AID_REMITTANCE_STATUS,
  canManageDeathAid,
} from '../utils/permissions.js';
import {
  buildPlaceholderCollectionInput,
  buildBeneficiaryRelease,
  computeBeneficiaryCollectionSummary,
  computeCollectionTotals,
  computeFromCollectedAmount,
  splitCollectionAcrossBeneficiaries,
} from '../utils/deathAidHelpers.js';
import { ensurePlaceholderSection } from './rosterService.js';

export {
  buildPlaceholderCollectionInput,
  buildBeneficiaryRelease,
  computeBeneficiaryCollectionSummary,
  computeFromCollectedAmount,
  splitCollectionAcrossBeneficiaries,
};

export const COLLECTION_COLLECTION = 'deathAidCollections';
export const REMITTANCE_COLLECTION = 'deathAidRemittances';
export const AUDIT_COLLECTION = 'deathAidAuditLog';
export const COUNTER_COLLECTION = 'deathAidCounters';
export const BENEFICIARY_COLLECTION = 'deathAidBeneficiaries';

export const AID_TYPES = { DEATH_AID: 'death_aid', TECHNOCARE: 'technocare' };
export const AID_TYPE_LABELS = { death_aid: 'Death Aid', technocare: 'TechnoCare' };
export const BENEFICIARY_STATUS = { OPEN: 'open', CLOSED: 'closed', RELEASED: 'released' };

/**
 * Validate and shape a Death Aid / TechnoCare beneficiary case. Pure, so the
 * rules the officer form relies on are testable without Firestore.
 */
export const buildBeneficiaryCase = (input, officer) => {
  const text = (v) => String(v ?? '').trim();
  if (!Object.values(AID_TYPES).includes(input?.aidType)) {
    throw new Error('Choose a valid aid type (Death Aid or TechnoCare).');
  }
  if (!text(input.studentName)) throw new Error('Enter the name of the student.');
  if (!text(input.affectedPersonName)) {
    throw new Error('Enter the name of the affected relative or affected student.');
  }
  const photo = text(input.memoPhotoDataUrl);
  if (!photo.startsWith('data:image/')) throw new Error('Attach a photo of the memo.');

  return {
    aidType: input.aidType,
    studentName: text(input.studentName),
    studentProgramSection: text(input.studentProgramSection),
    affectedSubjectType: input.affectedSubjectType === 'relative' ? 'relative' : 'student',
    affectedPersonName: text(input.affectedPersonName),
    relationshipToStudent: text(input.relationshipToStudent),
    caseSummary: text(input.caseSummary),
    memoReference: text(input.memoReference),
    memoPhotoDataUrl: photo,
    defaultContribution: Math.max(0, Number(input.defaultContribution) || 0),
    status: BENEFICIARY_STATUS.OPEN,
    createdByUid: officer?.uid || null,
    createdByName: officer?.name || 'Unknown',
    createdByRole: officer?.role || 'unknown',
  };
};

/** True when this section already has a filing awaiting verification for this case. */
export const hasPendingForCase = (collections, rosterId, beneficiaryCaseId) =>
  collections.some(
    (c) =>
      c.rosterId === rosterId &&
      (c.beneficiaryCaseId || null) === (beneficiaryCaseId || null) &&
      c.status === DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION
  );

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
export const computeOutstanding = (collections, { beneficiaryCaseId } = {}) => {
  const latestBySection = new Map();

  collections
    .filter((c) => c.status !== DEATH_AID_COLLECTION_STATUS.DENIED)
    .filter((c) => !beneficiaryCaseId || c.beneficiaryCaseId === beneficiaryCaseId)
    .forEach((c) => {
      // Latest filing wins per section AND per beneficiary case, so a new aid
      // drive never erases debt still owed on an earlier one.
      const key = `${c.beneficiaryCaseId || ''}::${c.sectionKey}`;
      const current = latestBySection.get(key);
      if (!current || timeValue(c.submittedAt) > timeValue(current.submittedAt)) {
        latestBySection.set(key, c);
      }
    });

  return Array.from(latestBySection.values())
    .map((c) => ({
      beneficiaryCaseId: c.beneficiaryCaseId || null,
      beneficiaryStudentName: c.beneficiaryStudentName || '',
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
// BENEFICIARY CASES — officer publishes, everyone selects
// ────────────────────────────────────────────────────────────

export const createBeneficiaryCase = async (input, officer) => {
  const payload = buildBeneficiaryCase(input, officer);
  const year = new Date().getFullYear();
  const snap = await getDocs(query(collection(db, BENEFICIARY_COLLECTION), limit(500)));
  const beneficiaryId = `BEN-${year}-${String(snap.size + 1).padStart(4, '0')}-${Date.now().toString(36).slice(-3).toUpperCase()}`;

  await setDoc(doc(db, BENEFICIARY_COLLECTION, beneficiaryId), {
    ...payload,
    beneficiaryId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await appendAudit({
    collectionId: beneficiaryId,
    action: 'beneficiary_created',
    actor: officer,
    extra: { aidType: payload.aidType, studentName: payload.studentName, affectedPersonName: payload.affectedPersonName },
  });
  return beneficiaryId;
};

export const setBeneficiaryStatus = async (beneficiary, status, officer) => {
  if (!Object.values(BENEFICIARY_STATUS).includes(status)) throw new Error('Invalid case status.');
  if (beneficiary.status === BENEFICIARY_STATUS.RELEASED && status !== BENEFICIARY_STATUS.RELEASED) {
    throw new Error('This beneficiary case has already been released and cannot be reopened.');
  }
  await setDoc(
    doc(db, BENEFICIARY_COLLECTION, beneficiary.beneficiaryId),
    { ...beneficiary, status, updatedAt: serverTimestamp() },
    { merge: true }
  );
  await appendAudit({
    collectionId: beneficiary.beneficiaryId,
    action: status === BENEFICIARY_STATUS.CLOSED ? 'beneficiary_closed' : 'beneficiary_reopened',
    actor: officer,
    extra: { studentName: beneficiary.studentName },
  });
};

/**
 * Release collected Death Aid / TechnoCare funds to a specific beneficiary.
 * Strictly requires handover photo evidence (enforced both here and in firestore.rules).
 */
export const releaseBeneficiaryAid = async ({
  beneficiary,
  recipientName,
  recipientRelationship = '',
  releasedAmount,
  releasePhotoDataUrl,
  releasePhotoDriveLink = '',
  releaseNotes = '',
  confirmedCount = 0,
  officer,
}) => {
  if (!canManageDeathAid(officer)) {
    throw new Error('Only authorized TechnoCares / Death Aid officers can release aid to a beneficiary.');
  }

  const releasePayload = buildBeneficiaryRelease(
    beneficiary,
    {
      recipientName,
      recipientRelationship,
      releasedAmount,
      releasePhotoDataUrl,
      releasePhotoDriveLink,
      releaseNotes,
      confirmedCount,
    },
    officer
  );

  await setDoc(
    doc(db, BENEFICIARY_COLLECTION, beneficiary.beneficiaryId),
    {
      ...releasePayload,
      releasedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await appendAudit({
    collectionId: beneficiary.beneficiaryId,
    action: 'beneficiary_aid_released',
    actor: officer,
    extra: {
      aidType: beneficiary.aidType,
      studentName: beneficiary.studentName,
      affectedPersonName: beneficiary.affectedPersonName,
      recipientName: releasePayload.recipientName,
      recipientRelationship: releasePayload.recipientRelationship,
      releasedAmount: releasePayload.releasedAmount,
      releasedCollectionCount: releasePayload.releasedCollectionCount,
      hasPhotoEvidence: true,
      releaseNotes: releasePayload.releaseNotes,
    },
  });

  return { beneficiaryId: beneficiary.beneficiaryId, ...releasePayload };
};

export const listBeneficiaryCases = async ({ onlyOpen = false } = {}) => {
  const clauses = onlyOpen ? [where('status', '==', BENEFICIARY_STATUS.OPEN)] : [];
  const snap = await getDocs(query(collection(db, BENEFICIARY_COLLECTION), ...clauses, limit(200)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst('createdAt'));
};

// ────────────────────────────────────────────────────────────
// OFFICER RECORDS A COLLECTION
// ────────────────────────────────────────────────────────────

/**
 * @param {Object} p
 * @param {Object} p.roster          verified classroom roster for the section
 * @param {Object} [p.beneficiary]   the Death Aid / TechnoCare case being funded
 * @param {number} p.contribution     pesos per beneficiary
 * @param {number} p.beneficiaries   how many students actually paid
 * @param {Array}  [p.debtRecords]   optional: who owes, and why
 * @param {string} [p.submittedByName] the student who brought the money in
 * @param {Object} p.recorder        the officer account making the entry
 */
export const recordSectionCollection = async ({
  roster = null,
  placeholderSection = null,
  beneficiary = null,
  contribution,
  beneficiaries,
  directAmount = null,
  debtRecords = [],
  submittedByName = '',
  recorder,
}) => {
  if (!recorder?.uid || !recorder?.role || recorder.role === 'guest' || recorder.role === 'public') {
    throw new Error('Authentication with a verified non-guest account is required to record Death Aid collections.');
  }

  const isPlaceholder = Boolean(!roster?.rosterId && placeholderSection);
  const useDirectAmount =
    directAmount !== null && directAmount !== undefined && String(directAmount).trim() !== '';

  if (!isPlaceholder && !roster?.rosterId) {
    throw new Error('Choose a section with a verified roster.');
  }
  if (isPlaceholder && !canManageDeathAid(recorder)) {
    throw new Error('Only authorized TechnoCares officers can record collections for unlisted placeholder sections.');
  }
  if (useDirectAmount && !canManageDeathAid(recorder)) {
    throw new Error('Only authorized TechnoCares officers can record direct lump-sum cash amounts.');
  }
  if (beneficiary && beneficiary.status !== BENEFICIARY_STATUS.OPEN) {
    throw new Error('That Death Aid / TechnoCare case is closed or already released.');
  }
  const trimmedName = String(submittedByName || '').trim();
  if (!trimmedName) {
    throw new Error('Please enter your full name as the submitter.');
  }

  let sectionInfo;
  let totals;
  let entryMode = 'count';

  if (isPlaceholder) {
    const derivedFromAmount = useDirectAmount
      ? computeFromCollectedAmount({
        enrolledCount: Number(placeholderSection.estimatedEnrolled) || 0,
        contribution,
        collectedAmount: directAmount,
      })
      : null;

    const normalized = buildPlaceholderCollectionInput({
      section: placeholderSection.section,
      college: placeholderSection.college,
      program: placeholderSection.program,
      yearLevel: placeholderSection.yearLevel,
      contribution,
      beneficiaries: derivedFromAmount ? derivedFromAmount.beneficiaryCount : beneficiaries,
      estimatedEnrolled: derivedFromAmount
        ? derivedFromAmount.enrolledCount
        : placeholderSection.estimatedEnrolled,
    });

    await ensurePlaceholderSection({
      section: normalized.section,
      college: normalized.college,
      program: normalized.program,
      yearLevel: normalized.yearLevel,
      actor: recorder,
    });

    sectionInfo = {
      rosterId: null,
      rosterVersion: null,
      isPlaceholderSection: true,
      sectionKey: normalized.sectionKey,
      section: normalized.section,
      program: normalized.program,
      college: normalized.college,
      yearLevel: normalized.yearLevel,
      mayorName: 'Unclaimed — Needs Mayor Roster',
      mayorUid: null,
    };
    totals = derivedFromAmount || normalized.totals;
    if (derivedFromAmount?.hasExactAmountOverride) entryMode = 'amount';
  } else {
    totals = useDirectAmount
      ? computeFromCollectedAmount({
        enrolledCount: roster.studentCount,
        contribution,
        collectedAmount: directAmount,
      })
      : computeCollectionTotals(roster.studentCount, contribution, beneficiaries);
    if (totals.enrolledCount === 0) throw new Error('That roster has no students enrolled.');
    if (totals.hasExactAmountOverride) entryMode = 'amount';
    sectionInfo = {
      rosterId: roster.rosterId,
      rosterVersion: roster.version ?? null,
      isPlaceholderSection: false,
      sectionKey: roster.sectionKey,
      section: roster.section,
      program: roster.program,
      college: roster.college,
      yearLevel: roster.yearLevel ?? null,
      mayorName: roster.mayorName || 'No Mayor Assigned',
      mayorUid: roster.mayorUid || null,
    };
  }

  const { hasExactAmountOverride: _omitOverride, ...storedTotals } = totals;

  // Anti-Spam Failsafe: one active filing per section PER beneficiary case
  const pendingClauses = isPlaceholder
    ? [
      where('sectionKey', '==', sectionInfo.sectionKey),
      where('status', '==', DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION),
    ]
    : [
      where('rosterId', '==', sectionInfo.rosterId),
      where('status', '==', DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION),
    ];
  if (beneficiary) pendingClauses.push(where('beneficiaryCaseId', '==', beneficiary.beneficiaryId));
  const existingPendingSnap = await getDocs(
    query(collection(db, COLLECTION_COLLECTION), ...pendingClauses, limit(5))
  );
  const conflict = existingPendingSnap.docs
    .map((d) => d.data())
    .find((d) => (beneficiary ? true : !d.beneficiaryCaseId));
  if (conflict) {
    throw new Error(
      `Section ${sectionInfo.section} already has an active submission (${conflict.collectionId}) awaiting officer verification. Duplicate filings are locked until verified or settled.`
    );
  }

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

  const recordedUid = recorder.uid;
  const recordedName = recorder?.name || trimmedName;
  const recordedRole = recorder.role;

  await setDoc(doc(db, COLLECTION_COLLECTION, collectionId), {
    collectionId,
    entryMode,
    ...sectionInfo,

    ...(beneficiary
      ? {
        beneficiaryCaseId: beneficiary.beneficiaryId,
        beneficiaryStudentName: beneficiary.studentName,
        affectedPersonName: beneficiary.affectedPersonName,
        aidType: beneficiary.aidType,
      }
      : {}),

    ...storedTotals,

    debtRecords: records,
    // Automatic, and honest about the gap rather than hiding it.
    unidentifiedDebtCount: Math.max(0, totals.debtCount - records.length),

    // Who physically brought the money in, and who typed this in. Kept apart so
    // the audit can name both.
    submittedByName: trimmedName,
    recordedByUid: recordedUid,
    recordedByName: recordedName,
    recordedByRole: recordedRole,

    status: DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION,
    submittedAt: serverTimestamp(),
    confirmedAt: null,
    confirmedByUid: null,
    confirmedByName: null,
    amountReceived: null,
  });

  await appendAudit({
    collectionId,
    action: isPlaceholder ? 'placeholder_collection_recorded' : 'collection_recorded',
    actor: {
      uid: recordedUid,
      name: recordedName,
      role: recordedRole,
    },
    extra: {
      section: sectionInfo.section,
      sectionKey: sectionInfo.sectionKey,
      isPlaceholderSection: isPlaceholder,
      enrolledCount: totals.enrolledCount,
      beneficiaryCount: totals.beneficiaryCount,
      contributionPerStudent: totals.contributionPerStudent,
      collectedAmount: totals.collectedAmount,
      expectedCollection: totals.expectedCollection,
      debtCount: totals.debtCount,
      submittedByName: String(submittedByName).trim() || 'Not recorded',
      namedDebts: records.length,
      rosterId: sectionInfo.rosterId,
    },
  });

  return collectionId;
};

/**
 * Record a single lump-sum section collection automatically split across 1 or more
 * selected active beneficiary cases (e.g. ₱200 across 5 beneficiaries -> ₱40.00 each).
 */
export const recordMultiBeneficiaryCollection = async ({
  roster = null,
  placeholderSection = null,
  beneficiariesList = [],
  totalCollectedAmount,
  contributionPerBeneficiary = null,
  debtRecords = [],
  submittedByName = '',
  recorder,
}) => {
  if (!Array.isArray(beneficiariesList) || beneficiariesList.length === 0) {
    throw new Error('Select at least one Death Aid / TechnoCare beneficiary first.');
  }
  const amountNum = Number(totalCollectedAmount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw new Error('Enter the total amount collected from the section (greater than ₱0.00).');
  }

  const enrolledCount = roster?.studentCount ?? (Number(placeholderSection?.estimatedEnrolled) || 0);
  const splits = splitCollectionAcrossBeneficiaries({
    totalCollectedAmount: amountNum,
    beneficiariesList,
    enrolledCount,
    contributionPerBeneficiary,
  });

  const recorded = [];
  for (const item of splits) {
    const collectionId = await recordSectionCollection({
      roster,
      placeholderSection,
      beneficiary: item.beneficiary,
      contribution: item.totals.contributionPerStudent,
      beneficiaries: item.totals.beneficiaryCount,
      directAmount: item.shareAmount,
      debtRecords: splits.length === 1 ? debtRecords : [],
      submittedByName,
      recorder,
    });
    recorded.push({
      collectionId,
      beneficiary: item.beneficiary,
      shareAmount: item.shareAmount,
      totals: item.totals,
    });
  }

  return {
    items: recorded,
    totalCollectedAmount: Math.round(amountNum * 100) / 100,
  };
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

/**
 * Deny / Disclose an erroneous remittance submission.
 * Used when a student / mayor made an input mistake (e.g. wrong section,
 * incorrect student count, duplicate filing, or withdrawn physical cash).
 * Marks the collection as DENIED / VOIDED and logs the reason to the audit trail.
 */
export const denyRemittance = async ({ collectionId, officer, reason, note = '' }) => {
  const collectionRef = doc(db, COLLECTION_COLLECTION, collectionId);
  const snap = await getDoc(collectionRef);
  if (!snap.exists()) throw new Error('That collection no longer exists.');

  const record = snap.data();
  if (record.status !== DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION) {
    throw new Error(`Only pending collections can be denied. This collection is already ${String(record.status).replace(/_/g, ' ')}.`);
  }

  const denialReason = String(reason || '').trim();
  if (!denialReason) {
    throw new Error('Please select or specify a reason for denying this remittance.');
  }

  await setDoc(
    collectionRef,
    {
      status: DEATH_AID_COLLECTION_STATUS.DENIED,
      deniedAt: serverTimestamp(),
      deniedByUid: officer.uid,
      deniedByName: officer.name,
      deniedByRole: officer.role,
      denialReason,
      denialNote: String(note || '').trim(),
    },
    { merge: true }
  );

  await appendAudit({
    collectionId,
    action: 'remittance_denied',
    actor: officer,
    extra: {
      section: record.section,
      sectionKey: record.sectionKey,
      reportedAmount: record.collectedAmount,
      denialReason,
      note: String(note || '').trim(),
    },
  });

  return { collectionId, status: DEATH_AID_COLLECTION_STATUS.DENIED, denialReason };
};

/**
 * Remove / revoke verification on an already-confirmed or discrepancy collection,
 * OR void/deny it completely with an audit trail reason.
 *  - nextStatus === 'for_verification': returns the collection to Pending Verification
 *    and marks the existing remittance record `revoked` so it can be re-counted.
 *  - nextStatus === 'denied': voids the collection and marks the remittance `revoked`.
 */
export const revokeCollectionVerification = async ({
  collectionId,
  officer,
  reason,
  nextStatus = DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION,
}) => {
  if (!canManageDeathAid(officer)) {
    throw new Error('Only authorized TechnoCares / Death Aid officers can remove or deny verification.');
  }

  const allowedNext = [
    DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION,
    DEATH_AID_COLLECTION_STATUS.DENIED,
  ];
  if (!allowedNext.includes(nextStatus)) {
    throw new Error('Invalid target status for verification removal.');
  }

  const cleanReason = String(reason || '').trim();
  if (!cleanReason) {
    throw new Error('Please provide a reason for removing or denying verification.');
  }

  const collectionRef = doc(db, COLLECTION_COLLECTION, collectionId);
  const snap = await getDoc(collectionRef);
  if (!snap.exists()) throw new Error('That collection no longer exists.');

  const record = snap.data();
  if (
    record.status !== DEATH_AID_COLLECTION_STATUS.CONFIRMED &&
    record.status !== DEATH_AID_COLLECTION_STATUS.DISCREPANCY
  ) {
    throw new Error('Only confirmed or discrepancy collections can have verification removed.');
  }

  const remittanceRef = doc(db, REMITTANCE_COLLECTION, collectionId);
  const remSnap = await getDoc(remittanceRef);
  if (remSnap.exists()) {
    const remData = remSnap.data();
    await setDoc(
      remittanceRef,
      {
        ...remData,
        status: DEATH_AID_REMITTANCE_STATUS.REVOKED,
        revokedReason: cleanReason,
        revokedByUid: officer.uid,
        revokedByName: officer.name,
        revokedByRole: officer.role,
        revokedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  const patch =
    nextStatus === DEATH_AID_COLLECTION_STATUS.DENIED
      ? {
        status: DEATH_AID_COLLECTION_STATUS.DENIED,
        confirmedAt: null,
        confirmedByUid: null,
        confirmedByName: null,
        amountReceived: null,
        deniedAt: serverTimestamp(),
        deniedByUid: officer.uid,
        deniedByName: officer.name,
        deniedByRole: officer.role,
        denialReason: cleanReason,
        verificationRevokedAt: serverTimestamp(),
        verificationRevokedByUid: officer.uid,
        verificationRevokedByName: officer.name,
        verificationRevokedReason: cleanReason,
      }
      : {
        status: DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION,
        confirmedAt: null,
        confirmedByUid: null,
        confirmedByName: null,
        amountReceived: null,
        verificationRevokedAt: serverTimestamp(),
        verificationRevokedByUid: officer.uid,
        verificationRevokedByName: officer.name,
        verificationRevokedReason: cleanReason,
      };

  await setDoc(collectionRef, patch, { merge: true });

  await appendAudit({
    collectionId,
    action:
      nextStatus === DEATH_AID_COLLECTION_STATUS.DENIED
        ? 'confirmed_collection_denied'
        : 'verification_removed',
    actor: officer,
    extra: {
      section: record.section,
      sectionKey: record.sectionKey,
      previousStatus: record.status,
      nextStatus,
      previousAmountReceived: record.amountReceived ?? null,
      reason: cleanReason,
    },
  });

  return { collectionId, status: nextStatus, reason: cleanReason };
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

export const listCollections = async ({ status, sectionKey, recordedByUid } = {}) => {
  try {
    const clauses = [];
    if (status) clauses.push(where('status', '==', status));
    if (sectionKey) clauses.push(where('sectionKey', '==', sectionKey));
    if (recordedByUid) clauses.push(where('recordedByUid', '==', recordedByUid));
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

/**
 * Check if a section roster already has an active pending collection awaiting verification.
 * Anti-spam and duplicate-prevention failsafe.
 */
export const getActivePendingForRoster = async (rosterId, beneficiaryCaseId = null) => {
  if (!rosterId) return null;
  try {
    const clauses = [
      where('rosterId', '==', rosterId),
      where('status', '==', DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION),
    ];
    if (beneficiaryCaseId) clauses.push(where('beneficiaryCaseId', '==', beneficiaryCaseId));
    const snap = await getDocs(query(collection(db, COLLECTION_COLLECTION), ...clauses, limit(5)));
    const docs = snap.docs.filter((d) => (beneficiaryCaseId ? true : !d.data().beneficiaryCaseId));
    if (docs.length === 0) return null;
    return { id: docs[0].id, ...docs[0].data() };
  } catch (error) {
    console.error('Failed to check active pending collection for roster:', error);
    return null;
  }
};

export const getActivePendingForSectionKey = async (sectionKey, beneficiaryCaseId = null) => {
  const cleanKey = String(sectionKey || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!cleanKey) return null;
  try {
    const clauses = [
      where('sectionKey', '==', cleanKey),
      where('status', '==', DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION),
    ];
    if (beneficiaryCaseId) clauses.push(where('beneficiaryCaseId', '==', beneficiaryCaseId));
    const snap = await getDocs(query(collection(db, COLLECTION_COLLECTION), ...clauses, limit(5)));
    const docs = snap.docs.filter((d) => (beneficiaryCaseId ? true : !d.data().beneficiaryCaseId));
    if (docs.length === 0) return null;
    return { id: docs[0].id, ...docs[0].data() };
  } catch (error) {
    console.error('Failed to check active pending collection for section:', error);
    return null;
  }
};

export const listRemittances = async ({ status } = {}) => {
  try {
    const clauses = status ? [where('status', '==', status)] : [];
    try {
      const snap = await getDocs(
        query(collection(db, REMITTANCE_COLLECTION), ...clauses, orderBy('receivedAt', 'desc'), limit(200))
      );
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst('receivedAt'));
    } catch (indexErr) {
      // Fallback if composite index for (status, receivedAt) is not yet deployed
      if (status && indexErr?.code === 'failed-precondition') {
        const snap = await getDocs(query(collection(db, REMITTANCE_COLLECTION), ...clauses, limit(200)));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst('receivedAt'));
      }
      throw indexErr;
    }
  } catch (error) {
    throw rethrowWithSpec('remittances', error);
  }
};

export const listAuditLog = async (collectionId) => {
  try {
    const clauses = collectionId ? [where('collectionId', '==', collectionId)] : [];
    try {
      const snap = await getDocs(
        query(collection(db, AUDIT_COLLECTION), ...clauses, orderBy('at', 'desc'), limit(500))
      );
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst('at'));
    } catch (indexErr) {
      if (collectionId && indexErr?.code === 'failed-precondition') {
        const snap = await getDocs(query(collection(db, AUDIT_COLLECTION), ...clauses, limit(500)));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst('at'));
      }
      throw indexErr;
    }
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