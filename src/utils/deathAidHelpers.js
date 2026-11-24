// utils/deathAidHelpers.js
// PURPOSE: Pure, Firestore-independent validation & calculation helpers for
// TechnoCares / Death Aid placeholder sections, beneficiary release with
// mandatory photo evidence, and per-beneficiary collection summaries.

import { COLLEGES, deriveYearLevel, sectionKey as toSectionKey } from './academics.js';
import { DEATH_AID_COLLECTION_STATUS } from './permissions.js';

/**
 * Compute balanced Death Aid collection totals from enrolled count, per-student rate,
 * and paying student count.
 */
export const computeCollectionTotals = (enrolledCount, contribution, beneficiaries) => {
  const enrolled = Math.max(0, Number(enrolledCount) || 0);
  const perStudent = Math.max(0, Number(contribution) || 0);
  const paid = Math.max(0, Number(beneficiaries) || 0);
  const counted = Math.min(paid, enrolled);

  return {
    enrolledCount: enrolled,
    contributionPerStudent: perStudent,
    beneficiaryCount: counted,
    collectedAmount: counted * perStudent,
    expectedCollection: enrolled * perStudent,
    debtCount: enrolled - counted,
    debtAmount: (enrolled - counted) * perStudent,
    wasClamped: paid > enrolled,
  };
};

/**
 * Reverse-calculate Death Aid totals directly from the cash amount collected
 * (e.g., typing ₱200.00 at ₱5/student automatically computes 40 paying students,
 * expected total, and remaining debt without manual mental math).
 * Preserves exact cash collected even if the lump-sum does not divide evenly.
 */
export const computeFromCollectedAmount = ({
  enrolledCount = 0,
  contribution = 1,
  collectedAmount = 0,
}) => {
  const collected = Math.max(0, Math.round((Number(collectedAmount) || 0) * 100) / 100);
  const perStudent = Math.max(0, Number(contribution) || 0);
  const rawPaid = perStudent > 0 ? Math.floor((collected + 1e-6) / perStudent) : 0;

  const hasFixedRoster = Number(enrolledCount) > 0;
  const enrolled = hasFixedRoster
    ? Math.floor(Number(enrolledCount))
    : Math.max(1, rawPaid > 0 ? rawPaid : collected > 0 ? 1 : 0);
  const counted = hasFixedRoster
    ? Math.min(rawPaid, enrolled)
    : rawPaid > 0
      ? rawPaid
      : collected > 0
        ? 1
        : 0;

  const exactProduct = Math.round(counted * perStudent * 100) / 100;
  const hasExactAmountOverride = Math.abs(collected - exactProduct) > 0.001;
  const expectedCollection = Math.round(enrolled * perStudent * 100) / 100;
  const debtCount = Math.max(0, enrolled - counted);
  const debtAmount = hasExactAmountOverride
    ? Math.max(0, Math.round((expectedCollection - collected) * 100) / 100)
    : Math.round(debtCount * perStudent * 100) / 100;

  return {
    enrolledCount: enrolled,
    contributionPerStudent: perStudent,
    beneficiaryCount: counted,
    collectedAmount: collected,
    expectedCollection,
    debtCount,
    debtAmount,
    wasClamped: hasFixedRoster && rawPaid > enrolled,
    hasExactAmountOverride,
  };
};

/**
 * Split a single lump-sum section collection (e.g., ₱200.00) evenly and
 * centavo-safely across 1 or more selected active beneficiary cases (e.g., 5 cases -> ₱40.00 each,
 * or 3 cases -> ₱66.67, ₱66.67, ₱66.66 summing to exact ₱200.00).
 */
export const splitCollectionAcrossBeneficiaries = ({
  totalCollectedAmount,
  beneficiariesList = [],
  enrolledCount = 0,
  contributionPerBeneficiary = null,
}) => {
  if (!Array.isArray(beneficiariesList) || beneficiariesList.length === 0) {
    return [];
  }

  const totalCentavos = Math.max(0, Math.round((Number(totalCollectedAmount) || 0) * 100));
  const count = beneficiariesList.length;
  const baseShareCentavos = Math.floor(totalCentavos / count);
  const remainderCentavos = totalCentavos - baseShareCentavos * count;

  return beneficiariesList.map((beneficiary, index) => {
    const shareCentavos = baseShareCentavos + (index < remainderCentavos ? 1 : 0);
    const sharePhp = shareCentavos / 100;
    const rate =
      Number(contributionPerBeneficiary) > 0
        ? Number(contributionPerBeneficiary)
        : Number(beneficiary?.defaultContribution) > 0
          ? Number(beneficiary.defaultContribution)
          : 1;

    const totals = computeFromCollectedAmount({
      enrolledCount,
      contribution: rate,
      collectedAmount: sharePhp,
    });

    return {
      beneficiary,
      shareAmount: sharePhp,
      totals,
    };
  });
};

/**
 * Best-effort inference of College, Program, and Year Level from a free-text
 * section label such as "BSIT - 2C" or "BSED - MATH 3A".
 */
export const inferAcademicContextFromSection = (sectionLabel) => {
  const upper = String(sectionLabel || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const yearLevel = deriveYearLevel(sectionLabel);

  for (const col of Object.values(COLLEGES)) {
    for (const prog of col.programs) {
      const normalizedProg = prog.toUpperCase();
      const compactProg = normalizedProg.replace(/\s*-\s*/g, ' ');
      if (upper.includes(normalizedProg) || upper.includes(compactProg)) {
        return {
          collegeId: col.id,
          college: col.label,
          program: prog,
          yearLevel,
        };
      }
    }
  }

  return {
    collegeId: '',
    college: 'Unassigned',
    program: 'Unassigned',
    yearLevel,
  };
};

/**
 * Validate and normalize an officer's placeholder section collection input when
 * no verified class roster exists yet for that section.
 */
export const buildPlaceholderCollectionInput = ({
  section,
  college = '',
  program = '',
  yearLevel = null,
  contribution,
  beneficiaries,
  estimatedEnrolled = null,
}) => {
  const cleanSection = String(section ?? '').replace(/\s+/g, ' ').trim();
  if (!cleanSection) {
    throw new Error('Enter the section name before recording a placeholder collection.');
  }

  const key = toSectionKey(cleanSection);
  const rate = Number(contribution);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('Contribution per student must be greater than zero.');
  }

  const paid = Math.floor(Number(beneficiaries));
  if (!Number.isFinite(paid) || paid < 0) {
    throw new Error('Enter how many students paid.');
  }

  const est =
    estimatedEnrolled !== null && estimatedEnrolled !== undefined && String(estimatedEnrolled).trim() !== ''
      ? Math.floor(Number(estimatedEnrolled))
      : 0;

  const enrolledCount = Math.max(est, paid);
  if (enrolledCount <= 0) {
    throw new Error('Enter at least 1 paying or estimated enrolled student for this placeholder section.');
  }

  const inferred = inferAcademicContextFromSection(cleanSection);
  const resolvedCollege = String(college || '').trim() || inferred.college;
  const resolvedProgram = String(program || '').trim() || inferred.program;
  const resolvedYearLevel =
    Number(yearLevel) > 0 ? Number(yearLevel) : inferred.yearLevel ?? null;

  const totals = computeCollectionTotals(enrolledCount, rate, paid);

  return {
    section: cleanSection,
    sectionKey: key,
    college: resolvedCollege,
    program: resolvedProgram,
    yearLevel: resolvedYearLevel,
    enrolledCount,
    totals,
  };
};

/**
 * Validate and shape a Death Aid / TechnoCare release record to a specific beneficiary.
 * Enforces mandatory photo evidence of handover.
 */
export const buildBeneficiaryRelease = (beneficiary, input, officer) => {
  const text = (v) => String(v ?? '').trim();
  if (!beneficiary?.beneficiaryId) {
    throw new Error('Choose a valid beneficiary case to release.');
  }
  if (beneficiary.status === 'released') {
    throw new Error('Death Aid / TechnoCare funds have already been released for this beneficiary.');
  }

  const recipientName = text(input?.recipientName);
  if (!recipientName) {
    throw new Error('Enter the full name of the beneficiary or authorized recipient receiving the aid.');
  }

  const releasedAmount = Number(input?.releasedAmount);
  if (!Number.isFinite(releasedAmount) || releasedAmount < 0) {
    throw new Error('Enter a valid released amount (₱0.00 or higher).');
  }

  const photo = text(input?.releasePhotoDataUrl);
  const isValidPhoto = photo.startsWith('data:image/') || /^https?:\/\//i.test(photo);
  if (!isValidPhoto) {
    throw new Error('Attach photo evidence of the Death Aid handover before releasing.');
  }

  return {
    status: 'released',
    recipientName,
    recipientRelationship: text(input?.recipientRelationship) || 'Beneficiary',
    releasedAmount: Math.round(releasedAmount * 100) / 100,
    releasePhotoDataUrl: photo,
    releasePhotoDriveLink: text(input?.releasePhotoDriveLink),
    releaseNotes: text(input?.releaseNotes),
    releasedCollectionCount: Math.max(0, Number(input?.confirmedCount) || 0),
    releasedByUid: officer?.uid || null,
    releasedByName: officer?.name || 'Unknown',
    releasedByRole: officer?.role || 'unknown',
  };
};

/**
 * Aggregate collections for a single beneficiary case so officers see confirmed
 * funds ready for release vs pending/discrepancy filings.
 */
export const computeBeneficiaryCollectionSummary = (collections = [], beneficiaryCaseId) => {
  const result = {
    confirmedAmount: 0,
    confirmedCount: 0,
    pendingAmount: 0,
    pendingCount: 0,
    discrepancyAmount: 0,
    discrepancyCount: 0,
    placeholderSectionCount: 0,
  };

  if (!beneficiaryCaseId || !Array.isArray(collections)) return result;

  for (const c of collections) {
    if (!c || c.beneficiaryCaseId !== beneficiaryCaseId) continue;
    if (c.status === DEATH_AID_COLLECTION_STATUS.DENIED) continue;

    if (c.isPlaceholderSection) {
      result.placeholderSectionCount += 1;
    }

    if (c.status === DEATH_AID_COLLECTION_STATUS.CONFIRMED) {
      result.confirmedCount += 1;
      result.confirmedAmount += Number(c.amountReceived ?? c.collectedAmount ?? 0);
    } else if (c.status === DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION) {
      result.pendingCount += 1;
      result.pendingAmount += Number(c.collectedAmount ?? 0);
    } else if (c.status === DEATH_AID_COLLECTION_STATUS.DISCREPANCY) {
      result.discrepancyCount += 1;
      result.discrepancyAmount += Number(c.amountReceived ?? c.collectedAmount ?? 0);
    }
  }

  result.confirmedAmount = Math.round(result.confirmedAmount * 100) / 100;
  result.pendingAmount = Math.round(result.pendingAmount * 100) / 100;
  result.discrepancyAmount = Math.round(result.discrepancyAmount * 100) / 100;
  return result;
};
