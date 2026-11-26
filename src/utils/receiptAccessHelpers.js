// utils/receiptAccessHelpers.js
// PURPOSE: Shared helpers for linking Finance + Inventory receipts and opening
// receipt proofs safely (Google Drive links directly; GridFS fallbacks via
// authenticated Bearer blob URLs so officers never hit HTTP 401 in new tabs).

const DIRECT_URL_RE = /^(https:\/\/drive\.google\.com\/|data:image\/|blob:)/i;
const GRIDFS_DOWNLOAD_RE = /\/api\/documents\/([a-f0-9]{24})\/download/i;

/**
 * Identify where a receipt transaction originated so Inventory & Finance officers
 * can trace every receipt back to its source module.
 */
export function classifyReceiptOrigin(record = {}) {
  const src = String(record?.source || '').toUpperCase();
  const office = String(record?.office || '').toLowerCase();

  if (src === 'INVENTORY_CONSUMABLE_EXPENSE' || /consumable|food/.test(office)) {
    return 'Inventory - Consumables';
  }
  if (src === 'INVENTORY_PROCUREMENT' || src.startsWith('INVENTORY_') || /inventory/.test(office)) {
    return 'Inventory';
  }
  return 'Finance';
}

/**
 * True if a transaction carries an attached receipt proof (Drive link, GridFS file,
 * inline photo, or Official Receipt #).
 */
export function hasReceiptAttachment(record = {}) {
  return Boolean(
    record?.receiptDriveLink ||
      record?.receiptUrl ||
      record?.receiptFileId ||
      record?.receiptOrNumber
  );
}

/**
 * Filter Firestore `transactions` to include both Inventory consumable expenses
 * and Finance transactions that have an uploaded/attached receipt proof.
 * Annotates each row with `receiptOrigin` and sorts newest-first.
 */
export function filterInventoryAndFinanceReceipts(transactions = []) {
  if (!Array.isArray(transactions)) return [];
  return transactions
    .filter((tx) => {
      if (!tx) return false;
      if (tx.source === 'INVENTORY_CONSUMABLE_EXPENSE') return true;
      // Include Finance expenses/transactions that have a receipt link/file attached
      // (avoid duplicating Inventory asset procurements that already live in Stock Inventory)
      if (tx.source === 'INVENTORY_PROCUREMENT') return false;
      return Boolean(tx.receiptDriveLink || tx.receiptUrl || tx.receiptFileId);
    })
    .map((tx) => ({
      ...tx,
      receiptOrigin: tx.receiptOrigin || classifyReceiptOrigin(tx),
    }))
    .sort((a, b) => {
      const tA = a.createdAt?.toMillis?.() || (a.createdAt ? new Date(a.createdAt).getTime() : 0) || 0;
      const tB = b.createdAt?.toMillis?.() || (b.createdAt ? new Date(b.createdAt).getTime() : 0) || 0;
      return tB - tA;
    });
}

/**
 * True only for URLs that can be opened directly in a browser tab without an
 * Authorization: Bearer header (Google Drive links, data:image URLs, blob: URLs).
 */
export function isDirectBrowserReceiptUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return DIRECT_URL_RE.test(url.trim());
}

/**
 * Extract the MongoDB GridFS fileId from a receipt record (either from `receiptFileId`
 * or from a legacy `/api/documents/<id>/download` URL).
 */
export function extractMongoReceiptFileId(record = {}) {
  const candidate = String(record?.receiptFileId || '').trim();
  if (/^[a-f0-9]{24}$/i.test(candidate)) return candidate;

  const url = String(record?.receiptUrl || record?.receipt || '').trim();
  const match = url.match(GRIDFS_DOWNLOAD_RE);
  return match ? match[1] : '';
}

/**
 * True when a record has any viewable receipt URL or GridFS fileId.
 */
export function hasViewableReceipt(record = {}) {
  return Boolean(
    isDirectBrowserReceiptUrl(record?.receiptDriveLink) ||
      isDirectBrowserReceiptUrl(record?.receiptUrl) ||
      isDirectBrowserReceiptUrl(record?.receipt) ||
      extractMongoReceiptFileId(record)
  );
}

/**
 * Open a receipt proof safely:
 *  - Google Drive / data:image / blob: URL -> open directly in a new tab.
 *  - MongoDB GridFS fallback -> fetch authenticated blob: URL via `getBlobUrl(fileId)`
 *    so officers never hit HTTP 401 on `/api/documents/:id/download`.
 */
export async function openReceiptProof(
  record,
  { getBlobUrl, openWindow = (url) => window.open(url, '_blank', 'noopener,noreferrer') } = {}
) {
  if (!record) throw new Error('Receipt record is missing.');

  const directUrl = [record.receiptDriveLink, record.receiptUrl, record.receipt].find(
    isDirectBrowserReceiptUrl
  );
  if (directUrl) {
    openWindow(directUrl.trim());
    return { mode: 'direct', url: directUrl.trim() };
  }

  const fileId = extractMongoReceiptFileId(record);
  if (fileId && typeof getBlobUrl === 'function') {
    const blobUrl = await getBlobUrl(fileId, { throwOnError: true });
    if (!blobUrl) {
      throw new Error('Could not load archived receipt file.');
    }
    openWindow(blobUrl);
    return { mode: 'blob', url: blobUrl, fileId };
  }

  throw new Error('No accessible receipt link or file is attached to this entry.');
}
