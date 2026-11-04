/**
 * Centralized Google Sheets Order Sync Orchestrator.
 * Public seam governing Secretariat authorization, template creation,
 * adaptive existing-sheet assignment, and safe non-destructive Pull/Push reconciliation.
 */
import { canManageCentralizedOrderSheet } from '../../utils/permissions.js';
import { ordersMapping } from './sheetMappingConfig.js';

export { canManageCentralizedOrderSheet };

export const COMMERCE_HUB_ORDER_TEMPLATE_COLUMNS = [
  { header: 'Order ID', fieldPath: 'orderId' },
  { header: 'Customer', fieldPath: 'customerInfo.fullName' },
  { header: 'Email', fieldPath: 'customerInfo.email' },
  { header: 'Contact Number', fieldPath: 'customerInfo.phoneNumber' },
  { header: 'School ID', fieldPath: 'customerInfo.schoolID' },
  { header: 'Program', fieldPath: 'customerInfo.bachelorDegree' },
  { header: 'Year & Section', fieldPath: 'customerInfo.section' },
  { header: 'Product', fieldPath: 'productInfo.productName' },
  { header: 'Size', fieldPath: 'productInfo.size' },
  { header: 'Color', fieldPath: 'productInfo.color' },
  { header: 'Quantity', fieldPath: 'productInfo.quantity' },
  { header: 'Unit Price', fieldPath: 'productInfo.pricePerUnit' },
  { header: 'Total', fieldPath: 'productInfo.totalPrice' },
  { header: 'Status', fieldPath: 'orderStatus' },
  { header: 'Payment', fieldPath: 'paymentInfo.paymentMethod' },
  { header: 'Reference Number', fieldPath: 'paymentInfo.referenceNumber' },
  { header: 'IGF Treasury (Read-Only)', fieldPath: 'igfSynced' },
  { header: 'Date', fieldPath: 'dateOrdered' },
];

export const ORDER_TEMPLATE_VALIDATIONS = {
  Status: ['Pending', 'Online Paid', 'Claimed', 'Completed', 'Returned', 'Cancelled'],
  Payment: ['Cash', 'Online'],
};

export const VALID_ORDER_ID_PATTERN = /^(ORD-DB-\d{4,}|SSGDB-\d{3,})$/i;

export function getStandardTemplateColumnMappings() {
  const mappings = {};
  for (const col of COMMERCE_HUB_ORDER_TEMPLATE_COLUMNS) {
    mappings[col.fieldPath] = col.header;
  }
  return mappings;
}

function createTypedSheetError(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

export function extractSpreadsheetId(urlOrId) {
  if (!urlOrId || typeof urlOrId !== 'string' || !urlOrId.trim()) {
    throw createTypedSheetError(
      'INVALID_SHEET_URL',
      'Please paste a valid Google Sheets link (for example, https://docs.google.com/spreadsheets/d/.../edit).'
    );
  }

  const trimmed = urlOrId.trim();

  if (/\/spreadsheets\/d\/e\//i.test(trimmed)) {
    throw createTypedSheetError(
      'PUBLISHED_WEB_URL_NOT_EDITABLE',
      'You pasted a "Publish to web" link (/d/e/2PACX...), which cannot be edited. Please open your Google Sheet normally and copy the link from your browser address bar (.../spreadsheets/d/.../edit).'
    );
  }

  if (/docs\.google\.com\/forms\/|forms\.gle\//i.test(trimmed)) {
    throw createTypedSheetError(
      'WRONG_GOOGLE_LINK_TYPE',
      'You pasted a Google Form link instead of a Google Sheet link. Open your Google Form → click "Responses" → click "View in Sheets" (the green Sheets icon), then copy and paste that Google Sheet link.'
    );
  }

  if (
    /docs\.google\.com\/(document|presentation)\/|drive\.google\.com\/(drive\/folders|file\/d)\//i.test(
      trimmed
    )
  ) {
    throw createTypedSheetError(
      'WRONG_GOOGLE_LINK_TYPE',
      'That link points to a Google Doc, Presentation, or Drive Folder rather than a Google Sheet. Please open the Google Sheet itself and paste its link.'
    );
  }

  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{8,})/);
  if (match) return match[1];

  const isPlausibleRawId =
    !/^https?:/i.test(trimmed) &&
    (/^[a-zA-Z0-9_-]{25,}$/.test(trimmed) ||
      /^(?=.*[a-zA-Z])(?=.*[\d_-])[a-zA-Z0-9_-]{8,}$/.test(trimmed));

  if (isPlausibleRawId) return trimmed;

  throw createTypedSheetError(
    'INVALID_SHEET_URL',
    'Could not recognize that Google Sheets link. Copy the full address bar URL while viewing your Google Sheet (https://docs.google.com/spreadsheets/d/.../edit).'
  );
}

function normalizeHeaderText(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectOrderSheetColumnMappings(sheetHeaders = [], mappingConfig = ordersMapping) {
  const { fieldMappings, fieldAliases = {}, importantFields = [] } = mappingConfig;
  const resolvedMappings = {};
  const matchesInfo = {};

  const normalizedHeaders = sheetHeaders.map((header, index) => ({
    index,
    original: header,
    normalized: normalizeHeaderText(header),
  }));

  const candidates = [];

  for (const firebaseField of Object.keys(fieldMappings)) {
    const defaultSheetCol = fieldMappings[firebaseField];
    const aliases = fieldAliases[firebaseField] || [];
    const allAliases = [defaultSheetCol, ...aliases].map(normalizeHeaderText);
    const isImportant = importantFields.includes(firebaseField);

    for (const { index, original, normalized } of normalizedHeaders) {
      if (!normalized) continue;
      let score = 0;

      if (allAliases.includes(normalized)) {
        score = 100;
      } else {
        for (const alias of allAliases) {
          if (!alias) continue;
          const regexExactWord = new RegExp(`\\b${alias}\\b`, 'i');
          if (regexExactWord.test(normalized)) {
            const lengthDiff = Math.abs(normalized.length - alias.length);
            score = Math.max(score, 85 - Math.min(lengthDiff, 15));
          } else if (normalized.includes(alias)) {
            score = Math.max(score, 70);
          } else if (alias.includes(normalized) && normalized.length >= 3) {
            score = Math.max(score, 65);
          }
        }
      }

      if (firebaseField === 'productInfo.productName') {
        if (
          /\b(price|cost|rate|total|amount|pay|date|time|timestamp|utc|created|updated)\b/i.test(
            normalized
          )
        ) {
          score = 0;
        }
      }

      // Prevent generic "id" alias on orderId or productId from stealing Student/School/Transaction IDs
      if (firebaseField === 'orderId') {
        if (
          /\b(student|school|prod|product|item|txn|transaction|ref|reference)\b/i.test(normalized) &&
          !/\border\b/i.test(normalized)
        ) {
          score = 0;
        }
      }

      if (firebaseField === 'productInfo.productId') {
        if (
          /\b(student|school|order|txn|transaction|ref|reference)\b/i.test(normalized) &&
          !/\b(prod|product|item|sku)\b/i.test(normalized)
        ) {
          score = 0;
        }
      }

      if (score >= 65) {
        candidates.push({
          firebaseField,
          defaultSheetCol,
          isImportant,
          headerIndex: index,
          original,
          score,
        });
      }
    }
  }

  // Sort highest confidence first; tie-break by importantFields so primary fields claim their column first
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.isImportant !== b.isImportant) return a.isImportant ? -1 : 1;
    return a.headerIndex - b.headerIndex;
  });

  const usedFields = new Set();
  const usedColumns = new Set();

  for (const cand of candidates) {
    const colKey = String(cand.original).trim().toLowerCase();
    if (usedFields.has(cand.firebaseField) || usedColumns.has(colKey)) continue;
    usedFields.add(cand.firebaseField);
    usedColumns.add(colKey);
    resolvedMappings[cand.firebaseField] = cand.original;
    matchesInfo[cand.firebaseField] = {
      matchedColumn: cand.original,
      confidence: cand.score,
      isImportant: cand.isImportant,
      fieldPath: cand.firebaseField,
      targetLabel: cand.defaultSheetCol,
    };
  }

  for (const firebaseField of Object.keys(fieldMappings)) {
    if (!matchesInfo[firebaseField]) {
      matchesInfo[firebaseField] = {
        matchedColumn: null,
        confidence: 0,
        isImportant: importantFields.includes(firebaseField),
        fieldPath: firebaseField,
        targetLabel: fieldMappings[firebaseField],
      };
    }
  }

  return { resolvedMappings, matchesInfo };
}

export function assertUniqueColumnMappings(columnMappings = {}) {
  const seenColToField = new Map();
  for (const [fieldPath, colHeader] of Object.entries(columnMappings || {})) {
    if (!colHeader || !String(colHeader).trim()) continue;
    const normCol = String(colHeader).trim().toLowerCase();
    if (seenColToField.has(normCol)) {
      throw createTypedSheetError(
        'DUPLICATE_COLUMN_MAPPING',
        `Google Sheet column "${colHeader}" is assigned to two different fields (${seenColToField.get(
          normCol
        )} and ${fieldPath}). Each sheet column can only map to one field.`
      );
    }
    seenColToField.set(normCol, fieldPath);
  }
}

function isExactStandardTemplateHeaders(headers = []) {
  const expected = COMMERCE_HUB_ORDER_TEMPLATE_COLUMNS.map((c) => normalizeHeaderText(c.header));
  if (headers.length < expected.length) return false;
  return expected.every((exp, idx) => normalizeHeaderText(headers[idx]) === exp);
}

function assertSecretariatAuthority(actorUser) {
  if (!canManageCentralizedOrderSheet(actorUser)) {
    const err = new Error(
      'Secretariat authorization required: only SSG Secretaries (or Admin) may create, assign, or sync the centralized Order Google Sheet.'
    );
    err.code = 'SECRETARIAT_AUTH_REQUIRED';
    throw err;
  }
}

function getNestedValue(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, part) => (acc != null ? acc[part] : undefined), obj);
}

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

export function formatOrderDateForSheet(rawDate) {
  if (!rawDate) return '';
  const dateObj = typeof rawDate?.toDate === 'function' ? rawDate.toDate() : new Date(rawDate);
  if (Number.isNaN(dateObj.getTime())) return String(rawDate);
  return dateObj.toISOString();
}

export function formatOrderFieldValue(order, fieldPath) {
  if (fieldPath === 'igfSynced') {
    const isSynced =
      Boolean(order?.igfSynced) ||
      String(order?.orderStatus || '').trim().toUpperCase() === 'ONLINE PAID';
    return isSynced ? 'IGF Synced' : 'Pending';
  }
  if (fieldPath === 'dateOrdered') {
    return formatOrderDateForSheet(order?.dateOrdered || order?.createdAt);
  }
  const val = getNestedValue(order, fieldPath);
  if (val === undefined || val === null) return '';
  return val;
}

export function serializeOrderToSheetRow(order, headers, columnMappings) {
  return mergeOrderIntoSheetRow(order, headers, columnMappings, []);
}

export function mergeOrderIntoSheetRow(order, headers, columnMappings, existingRowCells = []) {
  const reverseLookup = {};
  for (const [fieldPath, colHeader] of Object.entries(columnMappings || {})) {
    if (colHeader) reverseLookup[String(colHeader).trim().toLowerCase()] = fieldPath;
  }

  return headers.map((headerName, colIdx) => {
    const fieldPath = reverseLookup[String(headerName).trim().toLowerCase()];
    if (!fieldPath) {
      return existingRowCells[colIdx] !== undefined ? existingRowCells[colIdx] : '';
    }
    return formatOrderFieldValue(order, fieldPath);
  });
}

export function getMaxOrdDbSequence(orders = []) {
  let max = 0;
  for (const order of orders) {
    const rawId = String(order?.orderId || '').trim();
    const match = rawId.match(/^ORD-DB-(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > max) max = num;
    }
  }
  return max;
}

export function formatOrdDbId(sequenceNum) {
  return `ORD-DB-${String(sequenceNum).padStart(4, '0')}`;
}

export function isProtectedCommerceOrder(order) {
  if (!order) return false;
  if (Boolean(order.igfSynced) || Boolean(order.claimed) || Boolean(order.stockClaimDeducted)) {
    return true;
  }
  const statusUpper =
    typeof order.orderStatus === 'string' ? order.orderStatus.trim().toUpperCase() : '';
  return ['CLAIMED', 'COMPLETED', 'ONLINE PAID', 'PAID'].includes(statusUpper);
}

function sanitizeRecordingOnlyStatus(rawStatus) {
  const s = typeof rawStatus === 'string' ? rawStatus.trim().toUpperCase() : '';
  if (s === 'CANCELLED') return 'Cancelled';
  // Google Sheets is strictly for Recording; fulfillment & IGF happen only inside Commerce Hub
  return 'Pending';
}

function buildSheetRowSourceKey(spreadsheetId, sheetTitle, rowIdx, docData) {
  const buyer = String(
    docData?.customerInfo?.schoolID ||
      docData?.customerInfo?.email ||
      docData?.customerInfo?.fullName ||
      ''
  )
    .trim()
    .toLowerCase();
  const product = String(docData?.productInfo?.productName || '')
    .trim()
    .toLowerCase();
  return `${spreadsheetId}::${sheetTitle}::row${rowIdx}::${buyer}::${product}`;
}

function extractRowIndexFromSourceKey(sheetSourceKey, spreadsheetId, sheetTitle, maxRows) {
  if (!sheetSourceKey || typeof sheetSourceKey !== 'string') return -1;
  const prefix = `${spreadsheetId}::${sheetTitle}::row`;
  if (!sheetSourceKey.startsWith(prefix)) return -1;
  const rest = sheetSourceKey.slice(prefix.length);
  const match = rest.match(/^(\d+)::/);
  if (!match) return -1;
  const idx = parseInt(match[1], 10);
  return idx >= 0 && idx < maxRows ? idx : -1;
}

const SUMMARY_ROW_LABEL_REGEX =
  /^(grand\s+|sub\s*[- ]?)?(total|sum)(\s+(orders|sales|amount|revenue|qty|quantity|items|collected))?:?$/i;

function normalizeSheetPaymentInfo(rawPayment) {
  const trimmed = String(rawPayment ?? '').trim();
  if (!trimmed) {
    return { paymentMethod: 'Cash', onlinePaymentType: '' };
  }
  const lower = trimmed.toLowerCase();
  if (/^(cash|cash\s+on\s+claim|cod|walk[- ]?in(\s+cash)?|on[- ]?site)$/i.test(lower)) {
    return { paymentMethod: 'Cash', onlinePaymentType: '' };
  }
  if (/g[- ]?cash/i.test(lower)) {
    return { paymentMethod: 'Online', onlinePaymentType: 'GCash' };
  }
  if (/paymaya|\bmaya\b/i.test(lower)) {
    return { paymentMethod: 'Online', onlinePaymentType: 'Maya' };
  }
  if (/(bank|transfer|instapay|pesonet|bpi|bdo|landbank|unionbank)/i.test(lower)) {
    return { paymentMethod: 'Online', onlinePaymentType: trimmed };
  }
  if (/(online|e[- ]?wallet|digital)/i.test(lower)) {
    return { paymentMethod: 'Online', onlinePaymentType: '' };
  }
  return { paymentMethod: 'Cash', onlinePaymentType: '' };
}

function parseArrayRowToOrderDoc(rowCells, headers, columnMappings, nextSequenceRef) {
  const rowObj = {};
  let nonEmptyCount = 0;
  let headerMatchCount = 0;
  let firstNonEmptyCell = '';

  headers.forEach((h, idx) => {
    const cellVal =
      rowCells[idx] !== undefined && rowCells[idx] !== null ? String(rowCells[idx]).trim() : '';
    const normHeader = h ? String(h).trim().toLowerCase() : '';
    if (cellVal !== '') {
      nonEmptyCount += 1;
      if (!firstNonEmptyCell) firstNonEmptyCell = cellVal;
      if (normHeader && cellVal.toLowerCase() === normHeader) {
        headerMatchCount += 1;
      }
    }
    if (normHeader) rowObj[normHeader] = cellVal;
  });

  if (nonEmptyCount === 0) {
    return { skippedReason: 'Empty row' };
  }

  // Detect accidentally pasted duplicate header rows mid-sheet
  if (headerMatchCount >= 2 && headerMatchCount >= Math.ceil(nonEmptyCount * 0.5)) {
    return { skippedReason: 'Duplicate header row skipped' };
  }

  const docData = {};
  const transformers = ordersMapping.transformers || {};

  for (const [fieldPath, colHeader] of Object.entries(columnMappings || {})) {
    if (!colHeader || fieldPath === 'igfSynced') continue; // igfSynced is strictly read-only on sheet
    const rawVal = rowObj[String(colHeader).trim().toLowerCase()];
    if (rawVal === undefined || rawVal === '') continue;
    const transformed = transformers[fieldPath] ? transformers[fieldPath](rawVal) : rawVal;
    setNestedValue(docData, fieldPath, transformed);
  }

  const rawId = docData.orderId ? String(docData.orderId).trim() : '';
  const hasValidExistingOrderId = Boolean(rawId && VALID_ORDER_ID_PATTERN.test(rawId));

  const buyerName = String(docData.customerInfo?.fullName || '').trim();
  const hasRealBuyerName = Boolean(buyerName && buyerName.toLowerCase() !== 'anonymous customer');
  const buyerEmail = String(docData.customerInfo?.email || '').trim();
  const buyerSchoolId = String(docData.customerInfo?.schoolID || '').trim();
  const buyerPhone = String(docData.customerInfo?.phoneNumber || '').trim();
  const productName = String(docData.productInfo?.productName || '').trim();
  const hasRealProduct = Boolean(productName && productName.toUpperCase() !== 'N/A');

  if (!hasValidExistingOrderId) {
    // Detect spreadsheet bottom summary / TOTAL rows
    if (
      SUMMARY_ROW_LABEL_REGEX.test(rawId) ||
      SUMMARY_ROW_LABEL_REGEX.test(buyerName) ||
      SUMMARY_ROW_LABEL_REGEX.test(productName) ||
      (!buyerEmail && !buyerSchoolId && SUMMARY_ROW_LABEL_REGEX.test(firstNonEmptyCell))
    ) {
      return { skippedReason: 'Summary / TOTAL row skipped' };
    }

    const hasAnyBuyerIdentity = Boolean(
      hasRealBuyerName || buyerEmail || buyerSchoolId || buyerPhone
    );
    if (!hasAnyBuyerIdentity) {
      return {
        skippedReason: hasRealProduct
          ? 'Incomplete row (missing customer name, email, or student ID)'
          : 'Incomplete row (missing customer and product details)',
      };
    }
  }

  const rawSheetStatus = docData.orderStatus || 'Pending';
  docData.orderStatus = sanitizeRecordingOnlyStatus(rawSheetStatus);

  let autoGeneratedId = false;
  if (hasValidExistingOrderId) {
    docData.orderId = rawId.toUpperCase();
  } else {
    docData.orderId = formatOrdDbId(nextSequenceRef.value);
    nextSequenceRef.value += 1;
    autoGeneratedId = true;
  }

  // Apply defaults & non-negative numeric guards
  const qty = Math.max(1, Number(docData.productInfo?.quantity) || 1);
  const unitPrice = Math.max(0, Number(docData.productInfo?.pricePerUnit) || 0);
  let totalPrice = Math.max(0, Number(docData.productInfo?.totalPrice) || 0);
  if (totalPrice === 0 && unitPrice > 0) {
    totalPrice = qty * unitPrice;
  }

  const normalizedPayment = normalizeSheetPaymentInfo(docData.paymentInfo?.paymentMethod);

  setNestedValue(docData, 'productInfo.quantity', qty);
  setNestedValue(docData, 'productInfo.pricePerUnit', unitPrice);
  setNestedValue(docData, 'productInfo.totalPrice', totalPrice);
  if (!docData.productInfo?.size) setNestedValue(docData, 'productInfo.size', 'N/A');
  if (!docData.productInfo?.color) setNestedValue(docData, 'productInfo.color', 'N/A');
  setNestedValue(docData, 'paymentInfo.paymentMethod', normalizedPayment.paymentMethod);
  if (normalizedPayment.onlinePaymentType && !docData.paymentInfo?.onlinePaymentType) {
    setNestedValue(docData, 'paymentInfo.onlinePaymentType', normalizedPayment.onlinePaymentType);
  }
  if (!docData.dateOrdered) docData.dateOrdered = new Date().toISOString();

  // Enforce strict recording-only invariants for new/unfulfilled sheet imports
  docData.claimed = false;
  docData.stockClaimDeducted = false;
  docData.igfSynced = false;

  return {
    docData,
    rawSheetStatus,
    autoGeneratedId,
  };
}

function buildArchivedHistory(existingSettings, newSpreadsheetId, newSheetTitle, actorUser, nowIso) {
  const prevHistory = Array.isArray(existingSettings?.previousSheets)
    ? [...existingSettings.previousSheets]
    : [];
  const isDifferentTarget =
    existingSettings?.spreadsheetId &&
    (existingSettings.spreadsheetId !== newSpreadsheetId ||
      (existingSettings.sheetTitle || '') !== (newSheetTitle || ''));

  if (isDifferentTarget) {
    prevHistory.unshift({
      spreadsheetId: existingSettings.spreadsheetId,
      spreadsheetUrl: existingSettings.spreadsheetUrl || '',
      spreadsheetTitle: existingSettings.spreadsheetTitle || 'Previous Order Sheet',
      sheetTitle: existingSettings.sheetTitle || 'Sheet1',
      sheetId: existingSettings.sheetId ?? 0,
      assignedByName: existingSettings.assignedByName || 'Unknown Officer',
      assignedByEmail: existingSettings.assignedByEmail || '',
      assignedAt: existingSettings.assignedAt || null,
      archivedAt: nowIso,
      archivedByName: actorUser?.name || actorUser?.displayName || 'SSG Secretary',
    });
  }
  return prevHistory.slice(0, 15);
}

export function createCentralizedOrderSheetOrchestrator({
  actorUser,
  settingsRepo,
  ordersRepo,
  sheetsGateway,
  auditLogger,
}) {
  async function requireActiveSettings() {
    const active = settingsRepo ? await settingsRepo.get() : null;
    if (!active?.spreadsheetId) {
      throw new Error('No centralized Google Sheet is currently assigned.');
    }
    return active;
  }

  async function withSheetAccessErrorEnrichment(activeSettings, fn) {
    try {
      return await fn();
    } catch (err) {
      // Preserve already-classified domain errors
      if (
        typeof err?.code === 'string' &&
        [
          'SECRETARIAT_AUTH_REQUIRED',
          'INVALID_SHEET_URL',
          'PUBLISHED_WEB_URL_NOT_EDITABLE',
          'WRONG_GOOGLE_LINK_TYPE',
          'DUPLICATE_COLUMN_MAPPING',
          'SHEET_ACCESS_DENIED',
          'SHEET_TAB_NOT_FOUND',
          'SHEET_RANGE_PROTECTED',
          'SHEET_NOT_FOUND',
          'GOOGLE_SESSION_EXPIRED',
          'SHEET_RATE_LIMITED',
          'NETWORK_OFFLINE',
        ].includes(err.code)
      ) {
        throw err;
      }

      const status = Number(err?.status || err?.code || 0);
      const rawMsg = String(err?.message || '');

      // Network / Campus Wi-Fi offline
      if (
        err instanceof TypeError ||
        /failed to fetch|networkerror|network request failed|load failed/i.test(rawMsg)
      ) {
        throw createTypedSheetError(
          'NETWORK_OFFLINE',
          'Cannot reach Google Sheets right now. Please check your Wi-Fi or mobile data connection and try again.'
        );
      }

      // HTTP 401 — Expired 1-hour Google OAuth token
      if (status === 401 || /invalid authentication credentials|unauthenticated/i.test(rawMsg)) {
        throw createTypedSheetError(
          'GOOGLE_SESSION_EXPIRED',
          'Your 1-hour Google Sheets connection has expired. Click "Reconnect Google" to sign in again and continue syncing.',
          { status: 401 }
        );
      }

      // HTTP 403 — Permission denied / Unshared sheet / Viewer-only trying to write
      if (status === 403) {
        const hasOwnerInfo = Boolean(activeSettings?.assignedByName || activeSettings?.assignedByEmail);
        const message = hasOwnerInfo
          ? `Google Sheets permission denied (403). Request Editor access from ${
              activeSettings?.assignedByName || 'the sheet owner'
            }${activeSettings?.assignedByEmail ? ` (${activeSettings.assignedByEmail})` : ''}.`
          : 'Google Sheets permission denied (403). Make sure the Google Sheet owner clicked "Share" in Google Sheets and added your Google email as an Editor.';
        throw createTypedSheetError('SHEET_ACCESS_DENIED', message, {
          status: 403,
          ownerName: activeSettings?.assignedByName || 'Sheet Owner',
          ownerEmail: activeSettings?.assignedByEmail || '',
          spreadsheetUrl: activeSettings?.spreadsheetUrl || '',
        });
      }

      // HTTP 404 — Deleted / Trashed / Non-existent spreadsheet
      if (status === 404 || /requested entity was not found/i.test(rawMsg)) {
        throw createTypedSheetError(
          'SHEET_NOT_FOUND',
          'This Google Sheet could not be found (404). Check that the link is complete and that the file has not been moved to Google Drive Trash or deleted.',
          { status: 404 }
        );
      }

      // HTTP 429 — Google Sheets API quota / rapid-click rate limit
      if (status === 429 || /quota exceeded|rate limit|too many requests/i.test(rawMsg)) {
        throw createTypedSheetError(
          'SHEET_RATE_LIMITED',
          'Google Sheets is temporarily busy because too many sync requests were sent at once. Please wait 15–30 seconds and try again.',
          { status: 429 }
        );
      }

      // HTTP 400 — Renamed/deleted worksheet tab or locked/protected cell range
      if (status === 400) {
        if (/unable to parse range|tab .* not found|sheet .* not found/i.test(rawMsg)) {
          const tabLabel = activeSettings?.sheetTitle ? `"${activeSettings.sheetTitle}"` : 'selected';
          throw createTypedSheetError(
            'SHEET_TAB_NOT_FOUND',
            `The ${tabLabel} worksheet tab could not be found in Google Sheets—it may have been renamed or deleted. Click "Reassign / Change Sheet" to pick the updated tab.`,
            { status: 400, sheetTitle: activeSettings?.sheetTitle || '' }
          );
        }
        if (/protected cell|protected range|trying to edit a protected/i.test(rawMsg)) {
          throw createTypedSheetError(
            'SHEET_RANGE_PROTECTED',
            'Some cells or columns in this Google Sheet are locked/protected. Open Google Sheets → Data → Protected sheets and ranges to unlock them, or ask the sheet owner for Editor permission.',
            { status: 400 }
          );
        }
      }

      throw err;
    }
  }

  function resolveActiveMappings(activeSettings, headers) {
    return activeSettings?.columnMappings && Object.keys(activeSettings.columnMappings).length > 0
      ? activeSettings.columnMappings
      : detectOrderSheetColumnMappings(headers).resolvedMappings;
  }

  function findOrderIdColumnIndex(headers, activeMappings) {
    const targetHeader = String(activeMappings?.orderId || 'Order ID')
      .trim()
      .toLowerCase();
    return headers.findIndex((h) => String(h || '').trim().toLowerCase() === targetHeader);
  }

  return {
    async getCentralizedSheetView() {
      const sheet = settingsRepo ? await settingsRepo.get() : null;
      return {
        canManage: canManageCentralizedOrderSheet(actorUser),
        sheet: sheet || null,
      };
    },

    async inspectExistingSpreadsheet(urlOrId) {
      assertSecretariatAuthority(actorUser);
      const spreadsheetId = extractSpreadsheetId(urlOrId);
      const existingSettings = settingsRepo ? await settingsRepo.get() : null;
      const contextSettings =
        existingSettings?.spreadsheetId === spreadsheetId ? existingSettings : null;
      return withSheetAccessErrorEnrichment(contextSettings, () =>
        sheetsGateway.getSpreadsheetMetadata(spreadsheetId)
      );
    },

    async inspectWorksheetTab(urlOrId, sheetTitle) {
      assertSecretariatAuthority(actorUser);
      const spreadsheetId = extractSpreadsheetId(urlOrId);
      const { headers = [], rows = [] } = await withSheetAccessErrorEnrichment(
        { spreadsheetId, sheetTitle },
        () => sheetsGateway.readTabValues(spreadsheetId, sheetTitle)
      );
      const nonEmptyHeaders = headers.filter((h) => String(h ?? '').trim() !== '');
      if (nonEmptyHeaders.length === 0 && rows.length === 0) {
        return {
          spreadsheetId,
          sheetTitle,
          isEmpty: true,
          isStandardTemplate: false,
          headers: [],
          rowCount: 0,
          detectedMappings: getStandardTemplateColumnMappings(),
          matchesInfo: {},
        };
      }

      const { resolvedMappings, matchesInfo } = detectOrderSheetColumnMappings(headers);
      return {
        spreadsheetId,
        sheetTitle,
        isEmpty: false,
        isStandardTemplate: isExactStandardTemplateHeaders(headers),
        headers,
        rowCount: rows.length,
        detectedMappings: resolvedMappings,
        matchesInfo,
      };
    },

    async createTemplateSheet({
      title = 'SSG Commerce Hub Orders',
      mode = 'blank',
      sheetTitle = 'Commerce Hub Orders',
    } = {}) {
      assertSecretariatAuthority(actorUser);

      const headers = COMMERCE_HUB_ORDER_TEMPLATE_COLUMNS.map((c) => c.header);
      const standardMappings = getStandardTemplateColumnMappings();

      let rows = [];
      if (mode === 'prefilled' && ordersRepo) {
        const currentOrders = await ordersRepo.listAll();
        rows = currentOrders.map((order) =>
          serializeOrderToSheetRow(order, headers, standardMappings)
        );
      }

      const created = await withSheetAccessErrorEnrichment(null, () =>
        sheetsGateway.createSpreadsheet({
          title,
          sheetTitle,
          headers,
          rows,
          validations: ORDER_TEMPLATE_VALIDATIONS,
        })
      );

      const nowIso = new Date().toISOString();
      const existingSettings = settingsRepo ? await settingsRepo.get() : null;
      const createdTab = created.tabs?.[0] || { sheetId: 0, sheetTitle };
      const previousSheets = buildArchivedHistory(
        existingSettings,
        created.spreadsheetId,
        createdTab.sheetTitle || sheetTitle,
        actorUser,
        nowIso
      );

      const nextSettings = {
        spreadsheetId: created.spreadsheetId,
        spreadsheetUrl: created.spreadsheetUrl,
        spreadsheetTitle: created.spreadsheetTitle || title,
        sheetId: createdTab.sheetId ?? 0,
        sheetTitle: createdTab.sheetTitle || sheetTitle,
        isStandardTemplate: true,
        columnMappings: standardMappings,
        assignedByUid: actorUser?.uid || '',
        assignedByName: actorUser?.name || actorUser?.displayName || 'SSG Secretary',
        assignedByRole: actorUser?.role || 'secretary',
        assignedByEmail: actorUser?.email || '',
        assignedAt: nowIso,
        lastSyncedAt: mode === 'prefilled' ? nowIso : null,
        lastSyncedByName:
          mode === 'prefilled'
            ? actorUser?.name || actorUser?.displayName || 'SSG Secretary'
            : null,
        lastSyncDirection: mode === 'prefilled' ? 'push' : 'template_init',
        previousSheets,
      };

      if (settingsRepo) {
        await settingsRepo.save(nextSettings);
      }

      if (auditLogger) {
        await auditLogger.log({
          actionCode: 'CSY',
          module: 'Commerce Hub',
          performedBy: nextSettings.assignedByName,
          itemName: nextSettings.spreadsheetTitle,
          itemType: 'Centralized Order Sheet',
          summary: `+ Created centralized Google Sheet (${mode === 'prefilled' ? `${rows.length} orders exported` : 'blank template'}): "${nextSettings.spreadsheetTitle}"`,
        });
      }

      return nextSettings;
    },

    async assignExistingSheet({
      urlOrId,
      sheetId = 0,
      sheetTitle,
      initializeIfBlank = true,
      customMappings = null,
    }) {
      assertSecretariatAuthority(actorUser);
      const spreadsheetId = extractSpreadsheetId(urlOrId);
      const existingSettings = settingsRepo ? await settingsRepo.get() : null;
      const contextSettings =
        existingSettings?.spreadsheetId === spreadsheetId ? existingSettings : null;
      const meta = await withSheetAccessErrorEnrichment(contextSettings, () =>
        sheetsGateway.getSpreadsheetMetadata(spreadsheetId)
      );
      const selectedTab =
        meta.tabs.find((t) => (sheetTitle ? t.sheetTitle === sheetTitle : t.sheetId === sheetId)) ||
        meta.tabs[0];

      if (!selectedTab) {
        throw createTypedSheetError(
          'SHEET_TAB_NOT_FOUND',
          'The selected worksheet tab could not be found in this Google Sheet. Please refresh the tab list and pick an existing tab.'
        );
      }

      const tabInspection = await this.inspectWorksheetTab(spreadsheetId, selectedTab.sheetTitle);
      let isStandardTemplate = tabInspection.isStandardTemplate;
      let columnMappings = customMappings || tabInspection.detectedMappings;

      assertUniqueColumnMappings(columnMappings);

      if (tabInspection.isEmpty && initializeIfBlank) {
        const headers = COMMERCE_HUB_ORDER_TEMPLATE_COLUMNS.map((c) => c.header);
        await withSheetAccessErrorEnrichment(contextSettings, () =>
          sheetsGateway.initializeTemplateOnTab({
            spreadsheetId,
            sheetId: selectedTab.sheetId,
            sheetTitle: selectedTab.sheetTitle,
            headers,
            validations: ORDER_TEMPLATE_VALIDATIONS,
          })
        );
        isStandardTemplate = true;
        columnMappings = getStandardTemplateColumnMappings();
      }

      const nowIso = new Date().toISOString();
      const previousSheets = buildArchivedHistory(
        existingSettings,
        spreadsheetId,
        selectedTab.sheetTitle,
        actorUser,
        nowIso
      );

      const nextSettings = {
        spreadsheetId,
        spreadsheetUrl:
          meta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        spreadsheetTitle: meta.spreadsheetTitle || 'Assigned Order Sheet',
        sheetId: selectedTab.sheetId,
        sheetTitle: selectedTab.sheetTitle,
        isStandardTemplate,
        columnMappings,
        assignedByUid: actorUser?.uid || '',
        assignedByName: actorUser?.name || actorUser?.displayName || 'SSG Secretary',
        assignedByRole: actorUser?.role || 'secretary',
        assignedByEmail: actorUser?.email || '',
        assignedAt: nowIso,
        lastSyncedAt:
          existingSettings?.spreadsheetId === spreadsheetId
            ? existingSettings.lastSyncedAt || null
            : null,
        lastSyncedByName:
          existingSettings?.spreadsheetId === spreadsheetId
            ? existingSettings.lastSyncedByName || null
            : null,
        lastSyncDirection: 'assigned',
        previousSheets,
      };

      if (settingsRepo) {
        await settingsRepo.save(nextSettings);
      }

      if (auditLogger) {
        await auditLogger.log({
          actionCode: 'CSY',
          module: 'Commerce Hub',
          performedBy: nextSettings.assignedByName,
          itemName: `${nextSettings.spreadsheetTitle} (${nextSettings.sheetTitle})`,
          itemType: 'Centralized Order Sheet',
          summary: `~ Assigned existing Google Sheet "${nextSettings.spreadsheetTitle}" [Tab: ${nextSettings.sheetTitle}] as centralized Order record`,
        });
      }

      return nextSettings;
    },

    async previewPullFromSheet() {
      assertSecretariatAuthority(actorUser);
      const activeSettings = await requireActiveSettings();
      const { headers = [], rows = [] } = await withSheetAccessErrorEnrichment(
        activeSettings,
        () =>
          sheetsGateway.readTabValues(
            activeSettings.spreadsheetId,
            activeSettings.sheetTitle
          )
      );

      const activeMappings = resolveActiveMappings(activeSettings, headers);

      const existingOrders = ordersRepo ? await ordersRepo.listAll() : [];
      const existingById = new Map();
      const existingBySourceKey = new Map();
      for (const order of existingOrders) {
        if (order?.orderId) {
          existingById.set(String(order.orderId).trim().toUpperCase(), order);
        }
        if (order?.sheetSourceKey) {
          existingBySourceKey.set(order.sheetSourceKey, order);
        }
      }

      const nextSequenceRef = { value: getMaxOrdDbSequence(existingOrders) + 1 };
      const seenSheetIds = new Set();

      const toCreate = [];
      const toUpdate = [];
      const protectedConflicts = [];
      const skippedRows = [];

      rows.forEach((rowCells, rowIdx) => {
        const parsed = parseArrayRowToOrderDoc(
          rowCells,
          headers,
          activeMappings,
          nextSequenceRef
        );
        if (!parsed || parsed.skippedReason) {
          skippedRows.push({
            sheetRowNumber: rowIdx + 2,
            reason: parsed?.skippedReason || 'Empty row',
          });
          return;
        }

        const { docData, rawSheetStatus, autoGeneratedId } = parsed;
        const rowSourceKey = buildSheetRowSourceKey(
          activeSettings.spreadsheetId,
          activeSettings.sheetTitle,
          rowIdx,
          docData
        );

        let effectiveAutoGenerated = autoGeneratedId;
        if (autoGeneratedId) {
          const priorImported = existingBySourceKey.get(rowSourceKey);
          const priorKey = priorImported?.orderId
            ? String(priorImported.orderId).trim().toUpperCase()
            : '';
          if (priorImported && priorKey && !seenSheetIds.has(priorKey)) {
            docData.orderId = priorImported.orderId;
            nextSequenceRef.value -= 1;
            effectiveAutoGenerated = false;
          }
        }

        docData.sheetSourceKey = rowSourceKey;
        let normalizedKey = docData.orderId.toUpperCase();

        // Guard duplicate IDs inside the same sheet
        if (seenSheetIds.has(normalizedKey)) {
          docData.orderId = formatOrdDbId(nextSequenceRef.value);
          nextSequenceRef.value += 1;
          normalizedKey = docData.orderId.toUpperCase();
          effectiveAutoGenerated = true;
        }
        seenSheetIds.add(normalizedKey);

        const existing = existingById.get(normalizedKey);
        if (!existing) {
          toCreate.push({
            ...docData,
            _sheetRowIndex: rowIdx,
            _autoGeneratedId: effectiveAutoGenerated,
          });
          return;
        }

        if (isProtectedCommerceOrder(existing)) {
          protectedConflicts.push({
            orderId: existing.orderId,
            sheetRowNumber: rowIdx + 2,
            _sheetRowIndex: rowIdx,
            appStatus: existing.orderStatus,
            sheetStatus: rawSheetStatus,
            igfSynced: Boolean(existing.igfSynced),
            claimed: Boolean(existing.claimed),
            reason:
              'Order is already Claimed or IGF Synced in Commerce Hub; financial & fulfillment state is protected.',
          });
          return;
        }

        // Existing unfulfilled order -> merge recording fields while keeping IGF & claim state untouched
        const mergedUpdate = {
          ...existing,
          customerInfo: { ...(existing.customerInfo || {}), ...(docData.customerInfo || {}) },
          productInfo: { ...(existing.productInfo || {}), ...(docData.productInfo || {}) },
          paymentInfo: { ...(existing.paymentInfo || {}), ...(docData.paymentInfo || {}) },
          orderStatus: docData.orderStatus,
          sheetSourceKey: rowSourceKey,
          claimed: false,
          stockClaimDeducted: false,
          igfSynced: false,
          _sheetRowIndex: rowIdx,
        };
        toUpdate.push(mergedUpdate);
      });

      return {
        spreadsheetId: activeSettings.spreadsheetId,
        sheetTitle: activeSettings.sheetTitle,
        headers,
        columnMappings: activeMappings,
        totalSheetRows: rows.length,
        toCreate,
        toUpdate,
        protectedConflicts,
        skippedRows,
      };
    },

    async commitPullFromSheet(previewResult = null) {
      assertSecretariatAuthority(actorUser);
      const activeSettings = await requireActiveSettings();
      const preview = previewResult || (await this.previewPullFromSheet());

      const itemsToPersist = [...preview.toCreate, ...preview.toUpdate].map((item) => {
        const clean = { ...item };
        delete clean._sheetRowIndex;
        delete clean._autoGeneratedId;
        return clean;
      });

      let upsertStats = { created: 0, updated: 0 };
      if (itemsToPersist.length > 0 && ordersRepo) {
        upsertStats = await ordersRepo.upsertBatch(itemsToPersist);
      }

      const nowIso = new Date().toISOString();
      const performerName = actorUser?.name || actorUser?.displayName || 'SSG Secretary';
      const updatedSettings = {
        ...activeSettings,
        lastSyncedAt: nowIso,
        lastSyncedByName: performerName,
        lastSyncDirection: 'pull',
      };

      if (settingsRepo) {
        await settingsRepo.save(updatedSettings);
      }

      if (auditLogger) {
        await auditLogger.log({
          actionCode: 'CSY',
          module: 'Commerce Hub',
          performedBy: performerName,
          itemName: activeSettings.spreadsheetTitle,
          itemType: 'Centralized Order Sheet',
          summary: `↓ Pulled orders from Google Sheet: ${upsertStats.created} created, ${upsertStats.updated} updated, ${preview.protectedConflicts.length} protected (IGF/Claimed)`,
        });
      }

      return {
        ...upsertStats,
        protectedCount: preview.protectedConflicts.length,
        lastSyncedAt: nowIso,
      };
    },

    async pushOrdersToSheet() {
      assertSecretariatAuthority(actorUser);
      const activeSettings = await requireActiveSettings();

      return withSheetAccessErrorEnrichment(activeSettings, async () => {
        const { headers = [], rows = [] } = await sheetsGateway.readTabValues(
          activeSettings.spreadsheetId,
          activeSettings.sheetTitle
        );

        const effectiveHeaders =
          headers.length > 0
            ? headers
            : COMMERCE_HUB_ORDER_TEMPLATE_COLUMNS.map((c) => c.header);
        const activeMappings = resolveActiveMappings(activeSettings, effectiveHeaders);
        const orderIdColIdx = findOrderIdColumnIndex(effectiveHeaders, activeMappings);

        const sheetRowIndexByOrderId = new Map();
        if (orderIdColIdx >= 0) {
          rows.forEach((rowCells, rIdx) => {
            const rawId = String(rowCells?.[orderIdColIdx] || '')
              .trim()
              .toUpperCase();
            if (rawId && !sheetRowIndexByOrderId.has(rawId)) {
              sheetRowIndexByOrderId.set(rawId, rIdx);
            }
          });
        }

        const allOrders = ordersRepo ? await ordersRepo.listAll() : [];
        const rowUpdates = [];
        const appendRows = [];
        const sourceKeyBackfills = [];
        const claimedSheetRows = new Set(sheetRowIndexByOrderId.values());

        for (const order of allOrders) {
          const key = String(order?.orderId || '')
            .trim()
            .toUpperCase();
          if (!key) continue;

          let rIdx = sheetRowIndexByOrderId.has(key) ? sheetRowIndexByOrderId.get(key) : -1;
          if (rIdx < 0) {
            const sourceIdx = extractRowIndexFromSourceKey(
              order.sheetSourceKey,
              activeSettings.spreadsheetId,
              activeSettings.sheetTitle,
              rows.length
            );
            if (sourceIdx >= 0 && !claimedSheetRows.has(sourceIdx)) {
              rIdx = sourceIdx;
              claimedSheetRows.add(sourceIdx);
            }
          }

          if (rIdx >= 0) {
            rowUpdates.push({
              rowIndex: rIdx,
              values: mergeOrderIntoSheetRow(
                order,
                effectiveHeaders,
                activeMappings,
                rows[rIdx] || []
              ),
            });
          } else {
            const newRowIdx = rows.length + appendRows.length;
            appendRows.push(
              mergeOrderIntoSheetRow(order, effectiveHeaders, activeMappings, [])
            );
            if (orderIdColIdx < 0) {
              sourceKeyBackfills.push({
                ...order,
                sheetSourceKey: buildSheetRowSourceKey(
                  activeSettings.spreadsheetId,
                  activeSettings.sheetTitle,
                  newRowIdx,
                  order
                ),
              });
            }
          }
        }

        if (rowUpdates.length > 0 || appendRows.length > 0) {
          await sheetsGateway.writeTabUpdates({
            spreadsheetId: activeSettings.spreadsheetId,
            sheetTitle: activeSettings.sheetTitle,
            rowUpdates,
            appendRows,
          });
        }

        if (sourceKeyBackfills.length > 0 && ordersRepo) {
          await ordersRepo.upsertBatch(sourceKeyBackfills);
        }

        const nowIso = new Date().toISOString();
        const performerName = actorUser?.name || actorUser?.displayName || 'SSG Secretary';
        const updatedSettings = {
          ...activeSettings,
          lastSyncedAt: nowIso,
          lastSyncedByName: performerName,
          lastSyncDirection: 'push',
        };

        if (settingsRepo) {
          await settingsRepo.save(updatedSettings);
        }

        if (auditLogger) {
          await auditLogger.log({
            actionCode: 'CSY',
            module: 'Commerce Hub',
            performedBy: performerName,
            itemName: activeSettings.spreadsheetTitle,
            itemType: 'Centralized Order Sheet',
            summary: `↑ Pushed Commerce Hub orders to Google Sheet: ${rowUpdates.length} updated, ${appendRows.length} appended`,
          });
        }

        return {
          updatedInSheet: rowUpdates.length,
          appendedToSheet: appendRows.length,
          lastSyncedAt: nowIso,
        };
      });
    },

    async pushSingleOrderUpdate(order) {
      assertSecretariatAuthority(actorUser);
      const activeSettings = await requireActiveSettings();
      const key = String(order?.orderId || '')
        .trim()
        .toUpperCase();
      if (!key) {
        return { updatedInSheet: 0, appendedToSheet: 0, lastSyncedAt: activeSettings.lastSyncedAt };
      }

      return withSheetAccessErrorEnrichment(activeSettings, async () => {
        const { headers = [], rows = [] } = await sheetsGateway.readTabValues(
          activeSettings.spreadsheetId,
          activeSettings.sheetTitle
        );
        const effectiveHeaders =
          headers.length > 0
            ? headers
            : COMMERCE_HUB_ORDER_TEMPLATE_COLUMNS.map((c) => c.header);
        const activeMappings = resolveActiveMappings(activeSettings, effectiveHeaders);
        const orderIdColIdx = findOrderIdColumnIndex(effectiveHeaders, activeMappings);

        let matchedRowIdx = -1;
        if (orderIdColIdx >= 0) {
          matchedRowIdx = rows.findIndex(
            (rowCells) =>
              String(rowCells?.[orderIdColIdx] || '')
                .trim()
                .toUpperCase() === key
          );
        }
        if (matchedRowIdx < 0) {
          matchedRowIdx = extractRowIndexFromSourceKey(
            order.sheetSourceKey,
            activeSettings.spreadsheetId,
            activeSettings.sheetTitle,
            rows.length
          );
        }

        const rowUpdates = [];
        const appendRows = [];
        if (matchedRowIdx >= 0) {
          rowUpdates.push({
            rowIndex: matchedRowIdx,
            values: mergeOrderIntoSheetRow(
              order,
              effectiveHeaders,
              activeMappings,
              rows[matchedRowIdx] || []
            ),
          });
        } else {
          appendRows.push(mergeOrderIntoSheetRow(order, effectiveHeaders, activeMappings, []));
        }

        await sheetsGateway.writeTabUpdates({
          spreadsheetId: activeSettings.spreadsheetId,
          sheetTitle: activeSettings.sheetTitle,
          rowUpdates,
          appendRows,
        });

        const nowIso = new Date().toISOString();
        const performerName = actorUser?.name || actorUser?.displayName || 'SSG Secretary';
        if (settingsRepo) {
          await settingsRepo.save({
            ...activeSettings,
            lastSyncedAt: nowIso,
            lastSyncedByName: performerName,
            lastSyncDirection: 'auto_push',
          });
        }

        return {
          updatedInSheet: rowUpdates.length,
          appendedToSheet: appendRows.length,
          lastSyncedAt: nowIso,
        };
      });
    },

    async reconcileTwoWay(existingPreview = null) {
      assertSecretariatAuthority(actorUser);
      const activeSettings = await requireActiveSettings();
      const preview = existingPreview || (await this.previewPullFromSheet());

      const itemsToPersist = [...preview.toCreate, ...preview.toUpdate].map((item) => {
        const clean = { ...item };
        delete clean._sheetRowIndex;
        delete clean._autoGeneratedId;
        return clean;
      });

      let upsertStats = { created: 0, updated: 0 };
      if (itemsToPersist.length > 0 && ordersRepo) {
        upsertStats = await ordersRepo.upsertBatch(itemsToPersist);
      }

      return withSheetAccessErrorEnrichment(activeSettings, async () => {
        const { headers = [], rows = [] } = await sheetsGateway.readTabValues(
          activeSettings.spreadsheetId,
          activeSettings.sheetTitle
        );

        const effectiveHeaders =
          headers.length > 0
            ? headers
            : COMMERCE_HUB_ORDER_TEMPLATE_COLUMNS.map((c) => c.header);
        const activeMappings = resolveActiveMappings(activeSettings, effectiveHeaders);
        const orderIdColIdx = findOrderIdColumnIndex(effectiveHeaders, activeMappings);

        const sheetRowIndexByOrderId = new Map();
        for (const importedItem of [
          ...preview.toCreate,
          ...preview.toUpdate,
          ...preview.protectedConflicts,
        ]) {
          if (typeof importedItem._sheetRowIndex === 'number' && importedItem.orderId) {
            sheetRowIndexByOrderId.set(
              String(importedItem.orderId).trim().toUpperCase(),
              importedItem._sheetRowIndex
            );
          }
        }

        if (orderIdColIdx >= 0) {
          rows.forEach((rowCells, rIdx) => {
            const rawId = String(rowCells?.[orderIdColIdx] || '')
              .trim()
              .toUpperCase();
            if (rawId && !sheetRowIndexByOrderId.has(rawId)) {
              sheetRowIndexByOrderId.set(rawId, rIdx);
            }
          });
        }

        const allOrdersAfter = ordersRepo ? await ordersRepo.listAll() : [];
        const rowUpdates = [];
        const appendRows = [];
        const sourceKeyBackfills = [];
        const claimedSheetRows = new Set(sheetRowIndexByOrderId.values());

        for (const order of allOrdersAfter) {
          const key = String(order?.orderId || '')
            .trim()
            .toUpperCase();
          if (!key) continue;

          let rIdx = sheetRowIndexByOrderId.has(key) ? sheetRowIndexByOrderId.get(key) : -1;
          if (rIdx < 0) {
            const sourceIdx = extractRowIndexFromSourceKey(
              order.sheetSourceKey,
              activeSettings.spreadsheetId,
              activeSettings.sheetTitle,
              rows.length
            );
            if (sourceIdx >= 0 && !claimedSheetRows.has(sourceIdx)) {
              rIdx = sourceIdx;
              claimedSheetRows.add(sourceIdx);
            }
          }

          if (rIdx >= 0) {
            rowUpdates.push({
              rowIndex: rIdx,
              values: mergeOrderIntoSheetRow(
                order,
                effectiveHeaders,
                activeMappings,
                rows[rIdx] || []
              ),
            });
          } else {
            const newRowIdx = rows.length + appendRows.length;
            appendRows.push(
              mergeOrderIntoSheetRow(order, effectiveHeaders, activeMappings, [])
            );
            if (orderIdColIdx < 0) {
              sourceKeyBackfills.push({
                ...order,
                sheetSourceKey: buildSheetRowSourceKey(
                  activeSettings.spreadsheetId,
                  activeSettings.sheetTitle,
                  newRowIdx,
                  order
                ),
              });
            }
          }
        }

        if (rowUpdates.length > 0 || appendRows.length > 0) {
          await sheetsGateway.writeTabUpdates({
            spreadsheetId: activeSettings.spreadsheetId,
            sheetTitle: activeSettings.sheetTitle,
            rowUpdates,
            appendRows,
          });
        }

        if (sourceKeyBackfills.length > 0 && ordersRepo) {
          await ordersRepo.upsertBatch(sourceKeyBackfills);
        }

        const nowIso = new Date().toISOString();
        const performerName = actorUser?.name || actorUser?.displayName || 'SSG Secretary';
        if (settingsRepo) {
          await settingsRepo.save({
            ...activeSettings,
            lastSyncedAt: nowIso,
            lastSyncedByName: performerName,
            lastSyncDirection: 'reconcile',
          });
        }

        if (auditLogger) {
          await auditLogger.log({
            actionCode: 'CSY',
            module: 'Commerce Hub',
            performedBy: performerName,
            itemName: activeSettings.spreadsheetTitle,
            itemType: 'Centralized Order Sheet',
            summary: `⇄ Reconciled Commerce Hub & Google Sheet: +${upsertStats.created}/~${upsertStats.updated} in App (${preview.protectedConflicts.length} protected), ~${rowUpdates.length}/+${appendRows.length} in Sheet`,
          });
        }

        return {
          createdInApp: upsertStats.created,
          updatedInApp: upsertStats.updated,
          protectedCount: preview.protectedConflicts.length,
          updatedInSheet: rowUpdates.length,
          appendedToSheet: appendRows.length,
          lastSyncedAt: nowIso,
        };
      });
    },
  };
}
