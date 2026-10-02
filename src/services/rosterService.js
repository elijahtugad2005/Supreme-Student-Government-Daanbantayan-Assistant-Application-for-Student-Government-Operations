// services/rosterService.js
// PURPOSE: Read/write access for class rosters.
//
// A roster is a *submission* until an authorized officer verifies it. Verified
// records are never edited in place — each verification creates a new version
// and the previous one is preserved, so historical Death Aid collections can
// still point at the roster that was correct at the time.
//
// Firestore rules enforce the same split; this module only mirrors it.

import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { deriveYearLevel, sectionDocId, sectionKey as toSectionKey } from '../utils/academics';

export const ROSTER_COLLECTION = 'classRosters';
export const SECTION_COLLECTION = 'classSections';

export const ROSTER_STATUS = {
  PENDING: 'pending',
  VERIFIED: 'verified',
  CORRECTION_REQUESTED: 'correction_requested',
};

/**
 * Submit a roster for verification.
 * @param {Object} payload
 * @param {string} payload.college
 * @param {string} payload.program
 * @param {string} payload.section
 * @param {string} payload.mayorName   "No Mayor Assigned" is valid
 * @param {Array<{name: string, section: string, rowNumber: number}>} payload.students
 * @param {Object} payload.source      file name, detected columns, ignored columns
 * @param {string|null} payload.mayorUid null for an unauthenticated Mayor
 */
export async function submitRoster(payload) {
  const key = toSectionKey(payload.section);
  if (!key) throw new Error('A section is required before submitting.');

  // Student names and the resolved section only — no other spreadsheet data
  // is carried into the database.
  const students = payload.students.map((s) => ({
    name: s.name,
    section: payload.section,
  }));

  // Stored so the roster directory can filter 1st-4th year without re-parsing
  // the section label. The submitter's choice wins; otherwise derive it.
  const yearLevel =
    Number(payload.yearLevel) > 0 ? Number(payload.yearLevel) : deriveYearLevel(payload.section);

  const rosterRef = await addDoc(collection(db, ROSTER_COLLECTION), {
    college: payload.college,
    program: payload.program,
    section: payload.section,
    sectionKey: key,
    yearLevel,
    mayorName: payload.mayorName || 'No Mayor Assigned',
    mayorUid: payload.mayorUid || null,
    status: ROSTER_STATUS.PENDING,
    isCurrent: false,
    version: null, // assigned at verification time
    studentCount: students.length,
    students,
    source: {
      fileName: payload.source?.fileName || '',
      nameColumn: payload.source?.nameColumn || null,
      sectionColumn: payload.source?.sectionColumn || null,
      ignoredColumns: payload.source?.ignoredColumns || [],
    },
    correctionReason: '',
    submittedAt: serverTimestamp(),
    verifiedAt: null,
    verifiedBy: null,
  });

  // The section registry is NOT touched here. Only officers may write
  // `classSections`, and a Mayor submitting anonymously must not be blocked by
  // a permission error after their roster was already accepted. The registry is
  // written when an officer verifies, which is also when a section starts
  // counting as official.
  return rosterRef.id;
}

/** Officers-only. Verifies a roster and versions it. */
export async function verifyRoster(rosterId, verifier) {
  const ref = doc(db, ROSTER_COLLECTION, rosterId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error('That roster no longer exists.');

  const roster = snapshot.data();
  if (roster.status === ROSTER_STATUS.VERIFIED) {
    throw new Error('This roster was already verified.');
  }

  const nextVersion = await nextVersionFor(roster.sectionKey);

  // Demote the outgoing verified roster instead of deleting it. The pointer to
  // it lives on the section record, not on this submission.
  const outgoingId = await getCurrentRosterId(roster.sectionKey);
  if (outgoingId && outgoingId !== rosterId) {
    const previous = await getDoc(doc(db, ROSTER_COLLECTION, outgoingId));
    if (previous.exists()) {
      await updateDoc(doc(db, ROSTER_COLLECTION, outgoingId), {
        isCurrent: false,
        supersededAt: serverTimestamp(),
      });
    }
  }

  await updateDoc(ref, {
    status: ROSTER_STATUS.VERIFIED,
    isCurrent: true,
    version: nextVersion,
    verifiedAt: serverTimestamp(),
    verifiedBy: verifier || 'SSG Officer',
  });

  await writeSection({
    sectionKey: roster.sectionKey,
    section: roster.section,
    college: roster.college,
    program: roster.program,
    yearLevel: roster.yearLevel ?? deriveYearLevel(roster.section),
    mayorName: roster.mayorName,
    status: ROSTER_STATUS.VERIFIED,
    currentRosterId: rosterId,
  });

  return nextVersion;
}

/** Officers-only. Sends a submission back to the Mayor. */
export async function requestCorrection(rosterId, reason) {
  if (!String(reason || '').trim()) {
    throw new Error('Please give a reason for the correction request.');
  }

  const ref = doc(db, ROSTER_COLLECTION, rosterId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error('That roster no longer exists.');

  // Never touch a verified roster. Flipping its status would drop it out of
  // getVerifiedRoster(), silently removing the official student count that
  // Death Aid reporting bills against. A corrected list is a NEW submission.
  if (snapshot.data().status === ROSTER_STATUS.VERIFIED) {
    throw new Error(
      'This roster is already verified and cannot be sent back. Verify the new submission instead.'
    );
  }

  await updateDoc(ref, {
    status: ROSTER_STATUS.CORRECTION_REQUESTED,
    correctionReason: String(reason).trim(),
    requestedAt: serverTimestamp(),
  });
}

/**
 * Highest version already recorded for a section, plus one.
 * No limit on the scan: a truncated read could miss the newest version and
 * hand out a duplicate version number, which is what the history view sorts on.
 */
const nextVersionFor = async (key) => {
  const snapshot = await getDocs(
    query(collection(db, ROSTER_COLLECTION), where('sectionKey', '==', key))
  );
  const versions = snapshot.docs
    .map((d) => d.data().version)
    .filter((v) => typeof v === 'number');
  return versions.length > 0 ? Math.max(...versions) + 1 : 1;
};

/**
 * One section = one document, keyed by its normalised section name, so the
 * registry can never accumulate duplicates for the same section.
 *
 * `currentRosterId` is only replaced when the caller supplies one. A pending
 * submission must not clear the pointer to the roster Death Aid is billing
 * against today.
 */
const writeSection = async ({
  sectionKey: key,
  section,
  college,
  program,
  yearLevel,
  mayorName,
  status,
  currentRosterId,
}) => {
  const ref = doc(db, SECTION_COLLECTION, sectionDocId(key));
  const existing = await getDoc(ref);
  const previous = existing.exists() ? existing.data() : null;

  const record = {
    sectionKey: key,
    section,
    college,
    program,
    yearLevel: yearLevel ?? previous?.yearLevel ?? deriveYearLevel(section),
    mayorName: mayorName || 'No Mayor Assigned',
    status,
    currentRosterId:
      currentRosterId !== undefined && currentRosterId !== null
        ? currentRosterId
        : previous?.currentRosterId ?? null,
    updatedAt: serverTimestamp(),
  };

  if (existing.exists()) {
    await updateDoc(ref, record);
  } else {
    await setDoc(ref, record);
  }
};

const getCurrentRosterId = async (key) => {
  const snapshot = await getDoc(doc(db, SECTION_COLLECTION, sectionDocId(key)));
  return snapshot.exists() ? snapshot.data().currentRosterId ?? null : null;
};

/**
 * Composite indexes this file actually requires. The two list queries below
 * deliberately filter without an `orderBy` and sort in memory instead, so they
 * need no index at all — see the note on `byTime`.
 */
const INDEX_SPECS = {
  verified: 'classRosters [sectionKey ASC, status ASC, isCurrent ASC]',
  sections: 'classSections [updatedAt DESC] (single field — automatic, needs no setup)',
};

const rethrowWithSpec = (label, error) => {
  if (error?.code === 'failed-precondition') {
    const tagged = new Error(
      `${label} could not run — Firestore wants a composite index: ${INDEX_SPECS[label]}`
    );
    tagged.code = error.code;
    return tagged;
  }
  return error;
};

/**
 * Firestore Timestamps, ISO strings and plain numbers all have to be comparable.
 * Returns -Infinity so unverified drafts (version === null) sort last.
 */
const timeValue = (value) => {
  if (value === null || value === undefined) return -Infinity;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isNaN(parsed) ? -Infinity : parsed;
};

/** Newest first, ties broken by id so the order is stable. */
const byTime = (a, b, field) => {
  const diff = timeValue(b[field]) - timeValue(a[field]);
  return diff !== 0 ? diff : String(a.id).localeCompare(String(b.id));
};

/** All sections ever submitted, newest activity first. */
export async function listSections() {
  try {
    const snapshot = await getDocs(query(collection(db, SECTION_COLLECTION), orderBy('updatedAt', 'desc')));
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    throw rethrowWithSpec('sections', error);
  }
}

/**
 * Submissions awaiting an officer decision, newest first.
 *
 * Filtered without an `orderBy` on purpose: combining an equality filter with a
 * sort on a second field forces a composite index, and this queue is small
 * enough that sorting the result set in memory is cheaper than the index.
 */
export async function listPendingSubmissions() {
  try {
    const snapshot = await getDocs(
      query(collection(db, ROSTER_COLLECTION), where('status', '==', ROSTER_STATUS.PENDING))
    );
    return snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => byTime(a, b, 'submittedAt'));
  } catch (error) {
    throw rethrowWithSpec('pending', error);
  }
}

/** Every version ever recorded for a section, newest first. */
export async function listRosterVersions(sectionKey) {
  try {
    const snapshot = await getDocs(
      query(collection(db, ROSTER_COLLECTION), where('sectionKey', '==', sectionKey))
    );
    return snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => byTime(a, b, 'version'));
  } catch (error) {
    throw rethrowWithSpec('versions', error);
  }
}

/**
 * The roster a future Death Aid / Techno Cares run must bill against.
 * Returns the current verified roster only — never a pending submission.
 */
export async function getVerifiedRoster(section) {
  const snapshot = await getDocs(
    query(
      collection(db, ROSTER_COLLECTION),
      where('sectionKey', '==', toSectionKey(section)),
      where('status', '==', ROSTER_STATUS.VERIFIED),
      where('isCurrent', '==', true),
      limit(1)
    )
  );
  if (snapshot.empty) return null;
  const doc0 = snapshot.docs[0];
  const data = doc0.data();
  return {
    rosterId: doc0.id,
    ...data,
    // The count comes from the verified roster — never typed by a Mayor.
    activeStudents: data.students?.length ?? 0,
  };
}

/**
 * One verified roster by document id, used by the roster directory when a
 * section is opened. Fetching per section keeps the directory cheap: the
 * section list is small, while every student list together are not.
 */
export async function getRosterById(rosterId) {
  if (!rosterId) return null;
  const snapshot = await getDoc(doc(db, ROSTER_COLLECTION, rosterId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return { rosterId: snapshot.id, ...data };
}

/**
 * Roster submissions made by one account, newest first.
 *
 * The submitter is the only student-list holder a Guest gets, so this is what a
 * Mayor uses to review what they sent. Officers still read the full registry.
 */
export async function listRostersOwnedBy(mayorUid) {
  if (!mayorUid) return [];
  try {
    const snapshot = await getDocs(
      query(collection(db, ROSTER_COLLECTION), where('mayorUid', '==', mayorUid))
    );
    return snapshot.docs
      .map((d) => ({ rosterId: d.id, ...d.data() }))
      .sort(byTime('submittedAt'));
  } catch (error) {
    throw rethrowWithSpec('versions', error);
  }
}

/**
 * Withdraw one of your own submissions.
 *
 * Only allowed while it is still pending. A verified roster is the source of the
 * enrolled count behind every Death Aid collection, so withdrawing one is an
 * officer decision, not the submitter's.
 */
export async function withdrawRoster(rosterId, mayorUid) {
  const ref = doc(db, ROSTER_COLLECTION, rosterId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error('That submission no longer exists.');
  if (snapshot.data().mayorUid !== mayorUid) {
    throw new Error('You can only withdraw a roster you submitted.');
  }
  if (snapshot.data().status === ROSTER_STATUS.VERIFIED) {
    throw new Error('This roster is already verified. Ask an officer to correct it.');
  }
  await deleteDoc(ref);
}

/**
 * Amend a roster because students transferred in or out.
 *
 * The amendment is deliberately pushed back to `pending`, even when the roster
 * was already verified: an official list must never change on a submitter's word
 * alone. An officer re-verifies it, which supersedes the old version and keeps it
 * in the history. The rules enforce the same shape, including the required
 * transfer reason.
 *
 * @param {Object} p
 * @param {string} p.rosterId
 * @param {Array<{name: string}>} p.students  the corrected list
 * @param {number} p.transferCount  how many students moved
 * @param {string} p.transferReason
 * @param {string} p.mayorUid
 */
export async function amendRosterForTransfers({
  rosterId,
  students,
  transferCount,
  transferReason,
  mayorUid,
}) {
  if (!Array.isArray(students) || students.length === 0) {
    throw new Error('The amended roster needs at least one student.');
  }
  const count = Number(transferCount);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error('Enter how many students transferred.');
  }
  const reason = String(transferReason || '').trim();
  if (!reason) {
    throw new Error('Give a reason for the transfer amendment.');
  }

  const ref = doc(db, ROSTER_COLLECTION, rosterId);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw new Error('That roster no longer exists.');

  const existing = snapshot.data();
  if (existing.mayorUid !== mayorUid) {
    throw new Error('You can only amend a roster you submitted.');
  }

  await updateDoc(ref, {
    students: students.map((s) => ({ name: s.name, section: existing.section })),
    studentCount: students.length,
    source: {
      ...(existing.source || {}),
      amendedFromTransfer: true,
    },
    hasTransfers: true,
    transferCount: count,
    transferReason: reason,
    // Must be re-verified by an officer.
    status: ROSTER_STATUS.PENDING,
    verifiedAt: null,
    verifiedBy: null,
    isCurrent: false,
    amendedAt: serverTimestamp(),
  });
}

/**
 * Freeze a verified roster into a Death Aid event so later roster versions
 * cannot alter an old financial record.
 */
export function buildRosterSnapshot(verifiedRoster) {
  return {
    rosterId: verifiedRoster.rosterId,
    version: verifiedRoster.version,
    section: verifiedRoster.section,
    sectionKey: verifiedRoster.sectionKey,
    studentCount: verifiedRoster.students?.length ?? 0,
    capturedAt: new Date().toISOString(),
  };
}
