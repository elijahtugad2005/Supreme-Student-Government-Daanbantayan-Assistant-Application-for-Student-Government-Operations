/**
 * src/utils/ledgerTxFormHelpers.js
 *
 * Pure helpers for the Record Financial Transaction modal & ledger posting:
 * 1. computeAllocationLedgerPostingState() — compares recorded PPMP spent vs actual
 *    posted ledger transactions so unposted disbursed amounts are posted cleanly
 *    instead of posting only the leftover remaining balance.
 * 2. computeNextAllocationSpentCentavos() — updates spentAmountCentavos without
 *    double-counting recorded PPMP actual spent when posting it to the ledger.
 * 3. deriveAllocationTxDefaults() — eliminates redundant re-typing by auto-filling
 *    Amount (unposted disbursed amount first, otherwise remaining balance),
 *    Resolution Reference, and Description whenever an officer selects a Budget Allocation Target.
 * 4. resolveReceiptUploadOutcome() — handles Google Drive sync, Document Storage
 *    fallback, and inline compressed image fallback when Google Drive is unavailable.
 */

function resolveLedgerPostedCentavos(allocation, ledgerPostedByAllocation) {
  if (!allocation) return 0;
  if (ledgerPostedByAllocation) {
    if (typeof ledgerPostedByAllocation.get === 'function' && allocation.id) {
      const fromMap = ledgerPostedByAllocation.get(allocation.id);
      if (fromMap !== undefined) return Math.max(0, Number(fromMap || 0));
    } else if (
      typeof ledgerPostedByAllocation === 'object' &&
      allocation.id &&
      ledgerPostedByAllocation[allocation.id] !== undefined
    ) {
      return Math.max(0, Number(ledgerPostedByAllocation[allocation.id] || 0));
    }
  }
  if (allocation.ledgerPostedCentavos !== undefined) {
    return Math.max(0, Number(allocation.ledgerPostedCentavos || 0));
  }
  if (allocation.raw?.ledgerPostedCentavos !== undefined) {
    return Math.max(0, Number(allocation.raw.ledgerPostedCentavos || 0));
  }
  return 0;
}

/**
 * Computes exact ledger-posting eligibility and amounts for an allocation.
 * Supports both raw Firestore allocation docs and mapped budget rows.
 */
export function computeAllocationLedgerPostingState(allocation, ledgerPostedInput = 0) {
  if (!allocation) {
    return {
      approvedCentavos: 0,
      recordedSpentCentavos: 0,
      ledgerPostedCentavos: 0,
      unpostedDisbursedCentavos: 0,
      remainingAllocCentavos: 0,
      availableForLedgerPostingCentavos: 0,
      canPostToLedger: false,
    };
  }

  let approvedCentavos = 0;
  if (allocation.approvedAmountCentavos !== undefined) {
    approvedCentavos = Math.max(0, Math.round(Number(allocation.approvedAmountCentavos || 0)));
  } else if (allocation.allocated !== undefined) {
    approvedCentavos = Math.max(0, Math.round(Number(allocation.allocated || 0) * 100));
  } else if (allocation.remaining !== undefined) {
    approvedCentavos = Math.max(0, Math.round(Number(allocation.remaining || 0) * 100));
  }

  let recordedSpentCentavos = 0;
  if (allocation.spentAmountCentavos !== undefined) {
    recordedSpentCentavos = Math.max(0, Math.round(Number(allocation.spentAmountCentavos || 0)));
  } else if (allocation.spent !== undefined) {
    recordedSpentCentavos = Math.max(0, Math.round(Number(allocation.spent || 0) * 100));
  }

  const ledgerPostedCentavos =
    typeof ledgerPostedInput === 'number'
      ? Math.max(0, Math.round(ledgerPostedInput))
      : resolveLedgerPostedCentavos(allocation, ledgerPostedInput);

  const unpostedDisbursedCentavos = Math.max(0, recordedSpentCentavos - ledgerPostedCentavos);
  const effectiveSpentCentavos = Math.max(recordedSpentCentavos, ledgerPostedCentavos);
  const remainingAllocCentavos = Math.max(0, approvedCentavos - effectiveSpentCentavos);
  const availableForLedgerPostingCentavos = Math.max(0, approvedCentavos - ledgerPostedCentavos);
  const statusLower = String(allocation.status || '').toLowerCase();
  const isDraft = statusLower === 'draft';
  const isArchived = statusLower === 'archived' || allocation.isActive === false;
  const canPostToLedger =
    !isDraft && !isArchived && (unpostedDisbursedCentavos > 0 || remainingAllocCentavos > 0);

  return {
    approvedCentavos,
    recordedSpentCentavos,
    ledgerPostedCentavos,
    unpostedDisbursedCentavos,
    remainingAllocCentavos,
    availableForLedgerPostingCentavos,
    canPostToLedger,
  };
}

/**
 * Computes the updated spentAmountCentavos for a budget allocation after posting
 * a ledger disbursement without double-counting previously recorded PPMP spent.
 */
export function computeNextAllocationSpentCentavos({
  existingSpentCentavos = 0,
  ledgerPostedBeforeCentavos = 0,
  postedAmountCentavos = 0,
}) {
  const existing = Math.max(0, Math.round(Number(existingSpentCentavos || 0)));
  const before = Math.max(0, Math.round(Number(ledgerPostedBeforeCentavos || 0)));
  const posted = Math.max(0, Math.round(Number(postedAmountCentavos || 0)));
  const ledgerPostedAfter = before + posted;
  return Math.max(existing, ledgerPostedAfter);
}

/**
 * Derive smart defaults when a Budget Allocation Target is selected or cleared.
 * Priority:
 *  1. If the allocation has recorded PPMP disbursed/spent not yet posted to the ledger
 *     (`unpostedDisbursedCentavos > 0`), auto-fill that unposted disbursed amount so the
 *     officer posts the actual disbursed amount (e.g. ₱17,400.00) instead of leftover remaining (₱100.00).
 *  2. Otherwise, auto-fill the remaining allocation balance.
 */
export function deriveAllocationTxDefaults(
  allocation,
  currentForm = {},
  ledgerPostedByAllocation = null
) {
  if (!allocation) {
    return {
      ...currentForm,
      budgetAllocationId: '',
      ...(currentForm.amountAutoFilled
        ? { amount: '', amountAutoFilled: false, amountAutoFillSource: '' }
        : {}),
      ...(currentForm.descriptionAutoFilled
        ? { description: '', descriptionAutoFilled: false }
        : {}),
    };
  }

  const postingState = computeAllocationLedgerPostingState(allocation, ledgerPostedByAllocation);
  let targetCentavos = 0;
  let amountAutoFillSource = '';

  if (postingState.unpostedDisbursedCentavos > 0) {
    targetCentavos = postingState.unpostedDisbursedCentavos;
    amountAutoFillSource = 'disbursed';
  } else if (postingState.remainingAllocCentavos > 0) {
    targetCentavos = postingState.remainingAllocCentavos;
    amountAutoFillSource = 'remaining';
  }

  const amountStr = targetCentavos > 0 ? (targetCentavos / 100).toFixed(2) : '';
  const activityName = String(allocation.activityName || allocation.eventName || '').trim();
  const resolutionRef =
    allocation.resolutionRef ||
    allocation.resolution ||
    allocation.raw?.resolutionRef ||
    currentForm.resolutionRef ||
    '';

  const shouldAutoFillDesc =
    !currentForm.description ||
    !String(currentForm.description).trim() ||
    currentForm.descriptionAutoFilled === true;

  return {
    ...currentForm,
    budgetAllocationId: allocation.id || '',
    amount: amountStr,
    amountAutoFilled: Boolean(amountStr),
    amountAutoFillSource: amountStr ? amountAutoFillSource : '',
    resolutionRef,
    description:
      shouldAutoFillDesc && activityName
        ? `Disbursement for ${activityName}`
        : currentForm.description || '',
    descriptionAutoFilled: shouldAutoFillDesc && Boolean(activityName),
  };
}

/**
 * Browser Canvas image downscaler for receipt photos when Google Drive / upload backend
 * is unavailable. Keeps inline receipt proof compact (<180 KB JPEG Data URL).
 */
export function compressReceiptImageToDataUrl(file, { maxDimension = 1024, quality = 0.72 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined' || typeof Image === 'undefined') {
      reject(new Error('Image compression is only available in browser environments.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected receipt image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Selected file is not a valid image.'));
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width >= height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, width);
          canvas.height = Math.max(1, height);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Resilient receipt upload coordinator:
 *  1. Attempts upload via backend (`uploadFn` -> MongoDB GridFS + Google Drive Receipts mirror).
 *  2. If Drive mirror is unavailable/disabled, preserves the GridFS download URL cleanly.
 *  3. If both Drive and upload backend are unreachable:
 *     - For image files, attaches a compressed receipt photo inline so ledger posting is never blocked.
 *     - For PDFs, returns an actionable recovery message prompting OR # or receipt details.
 */
export async function resolveReceiptUploadOutcome({
  file,
  meta = {},
  uploadFn,
  compressImageFn = compressReceiptImageToDataUrl,
  onProgress = null,
}) {
  if (!file) {
    return {
      ok: false,
      mode: 'invalid',
      receiptUrl: '',
      receiptDriveLink: '',
      receiptFileId: '',
      notice: '',
      error: 'No receipt file selected.',
    };
  }

  try {
    const res = await uploadFn(file, meta, onProgress);
    const filename = res?.filename || file.name || 'receipt';
    if (res?.driveWebViewLink) {
      return {
        ok: true,
        mode: 'drive',
        receiptUrl: res.driveWebViewLink,
        receiptDriveLink: res.driveWebViewLink,
        receiptFileId: res.fileId || '',
        notice: `Saved "${filename}" to Google Drive (Receipts).`,
        error: '',
      };
    }

    if (res?.downloadUrl) {
      return {
        ok: true,
        mode: 'gridfs',
        receiptUrl: res.downloadUrl,
        receiptDriveLink: '',
        receiptFileId: res.fileId || '',
        notice: `Google Drive is unavailable — archived "${filename}" in Document Storage.`,
        error: '',
      };
    }
  } catch {
    // Fall through to resilient inline image fallback when Drive/backend is unreachable
  }

  const isImage = String(file.type || '').toLowerCase().startsWith('image/');
  if (isImage && typeof compressImageFn === 'function') {
    try {
      const dataUrl = await compressImageFn(file);
      return {
        ok: true,
        mode: 'inline_fallback',
        receiptUrl: dataUrl,
        receiptDriveLink: '',
        receiptFileId: '',
        notice: `Google Drive is unavailable — attached receipt photo "${file.name}" directly to this ledger entry.`,
        error: '',
      };
    } catch {
      // Fall through to clear manual recovery guidance
    }
  }

  return {
    ok: false,
    mode: 'unavailable',
    receiptUrl: '',
    receiptDriveLink: '',
    receiptFileId: '',
    notice: '',
    error:
      'Google Drive & upload server are unavailable for this file. Enter an Official Receipt (OR #) or receipt details below to post immediately.',
  };
}
