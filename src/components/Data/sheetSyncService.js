// sheetSyncService.js
// Handles Google Sheets (CSV) and Excel (.xlsx, .xls) parsing,
// dynamic keyword-based column detection ("FULL NAME", "NAME", "EMAIL", etc.),
// data transformation, and batch upsert to Firestore.

import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  collection,
  getDocs,
  writeBatch,
  doc,
} from 'firebase/firestore';
import { db } from '../../firebase/firebaseConfig.js';

// ────────────────────────────────────────────────────────────
// 1. DYNAMIC COLUMN DETECTION ALGORITHM
// ────────────────────────────────────────────────────────────

/**
 * Normalize string for comparison: lowercase, remove special characters & multiple spaces.
 */
function normalizeText(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Dynamic algorithm that inspects uploaded/fetched sheet column headers
 * and determines the best-matching target Firebase fields based on keyword rules.
 *
 * It scores candidates:
 * - Exact normalized match: highest score (100)
 * - Exact alias match: (95)
 * - Substring / word token match: (70 - 85)
 *
 * @param {Array<string>} sheetHeaders - List of column headers from sheet/excel
 * @param {Object} mappingConfig - from sheetMappingConfig.js
 * @returns {Object} {
 *   resolvedMappings: { [firebaseField]: sheetHeader },
 *   matchesInfo: { [firebaseField]: { matchedColumn, confidence, isImportant, label } },
 *   unmappedSheetColumns: Array<string>
 * }
 */
export function detectDynamicColumnMappings(sheetHeaders = [], mappingConfig) {
  const { fieldMappings, fieldAliases = {}, importantFields = [] } = mappingConfig;
  const resolvedMappings = {};
  const matchesInfo = {};
  const usedColumns = new Set();

  // Pre-normalize all sheet headers
  const normalizedHeaders = sheetHeaders.map((header) => ({
    original: header,
    normalized: normalizeText(header),
  }));

  // Iterate over each target Firebase field defined in mapping
  Object.keys(fieldMappings).forEach((firebaseField) => {
    const defaultSheetCol = fieldMappings[firebaseField];
    const aliases = fieldAliases[firebaseField] || [];
    const allAliases = [defaultSheetCol, ...aliases].map(normalizeText);

    let bestMatch = null;
    let highestScore = 0;

    for (const { original, normalized } of normalizedHeaders) {
      if (!normalized) continue;

      let score = 0;

      // 1. Exact alias or default column match
      if (allAliases.includes(normalized)) {
        score = 100;
      } else {
        // 2. Word boundary or subphrase match
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

      // Special rule: productInfo.productName should NOT match price or date/timestamp related columns
      if (firebaseField === 'productInfo.productName' || firebaseField === 'productName') {
        if (/\b(price|cost|rate|total|amount|pay|date|time|timestamp|utc|created|updated)\b/i.test(normalized)) {
          score = 0;
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = original;
      }
    }

    if (bestMatch && highestScore >= 65) {
      resolvedMappings[firebaseField] = bestMatch;
      usedColumns.add(bestMatch);
      matchesInfo[firebaseField] = {
        matchedColumn: bestMatch,
        confidence: highestScore,
        isImportant: importantFields.includes(firebaseField),
        fieldPath: firebaseField,
        targetLabel: defaultSheetCol,
      };
    } else {
      matchesInfo[firebaseField] = {
        matchedColumn: null,
        confidence: 0,
        isImportant: importantFields.includes(firebaseField),
        fieldPath: firebaseField,
        targetLabel: defaultSheetCol,
      };
    }
  });

  const unmappedSheetColumns = sheetHeaders.filter((h) => !usedColumns.has(h));

  return { resolvedMappings, matchesInfo, unmappedSheetColumns };
}

// ────────────────────────────────────────────────────────────
// 2. PARSERS (Google Sheets CSV & Local Excel files)
// ────────────────────────────────────────────────────────────

/**
 * Convert a Google Sheets URL to its published CSV export URL.
 */
export function buildCsvUrl(sheetUrl) {
  if (sheetUrl.includes('/export?') || sheetUrl.includes('/gviz/tq')) {
    return sheetUrl;
  }
  const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error('Could not extract Spreadsheet ID from URL. Expected format: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/...');
  }
  const spreadsheetId = match[1];
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=0`;
}

/**
 * Fetch and parse a published Google Sheet CSV.
 */
export async function fetchSheetData(sheetUrl) {
  const csvUrl = buildCsvUrl(sheetUrl);
  const response = await fetch(csvUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch sheet (HTTP ${response.status}). Make sure the sheet is published to the web (File → Share → Publish to web → CSV).`);
  }
  const csvText = await response.text();
  const result = Papa.parse(csvText, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => (h ? h.trim() : '') });
  if (result.errors.length > 0) {
    console.warn('CSV parse warnings:', result.errors);
  }
  return (result.data || []).filter((row) => Object.values(row).some((val) => val !== undefined && val !== null && String(val).trim() !== ''));
}

/**
 * Parse a local Excel file (.xlsx, .xls) or CSV file from input["file"].
 * Uses SheetJS (xlsx).
 * @param {File} file - File object from browser
 * @returns {Promise<Array<Object>>}
 */
export function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error('The uploaded workbook contains no sheets.');
        const worksheet = workbook.Sheets[sheetName];
        const rawJson = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false, defval: '' });
        if (!rawJson || rawJson.length === 0) { resolve([]); return; }
        const headerRowIndex = rawJson.findIndex((row) => Array.isArray(row) && row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== ''));
        if (headerRowIndex === -1) { resolve([]); return; }
        const headers = rawJson[headerRowIndex].map((h, i) => (h ? String(h).trim() : `Column_${i + 1}`));
        const dataRows = rawJson.slice(headerRowIndex + 1);
        const rows = dataRows.map((row) => {
          const rowObj = {};
          headers.forEach((header, index) => {
            let val = row[index];
            if (val instanceof Date) val = val.toISOString();
            rowObj[header] = val !== undefined && val !== null ? val : '';
          });
          return rowObj;
        }).filter((row) => Object.values(row).some((v) => v !== '' && v !== null && v !== undefined));
        resolve(rows);
      } catch (err) { reject(new Error(`Failed to parse Excel file: ${err.message}`)); }
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });
}

// ────────────────────────────────────────────────────────────
// 3. TRANSFORM ROWS TO FIREBASE SCHEMA
// ────────────────────────────────────────────────────────────

function generateOrderId(sequenceNumber) {
  return `SSGDB-${String(sequenceNumber).padStart(3, '0')}`;
}

function setNested(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

export function transformRow(row, mappingConfig, resolvedMappings, rowIndex = 0, orderIdCounter = null) {
  const { defaultValues = {}, transformers = {}, keyField } = mappingConfig;
  const headerLookup = {};
  Object.keys(row).forEach((h) => { headerLookup[h.toLowerCase()] = h; });
  const docData = {};
  let hasVitalData = false;

  Object.entries(resolvedMappings).forEach(([firebaseField, sheetColName]) => {
    if (!sheetColName) return;
    const actualHeader = headerLookup[sheetColName.toLowerCase()];
    let value = actualHeader ? row[actualHeader] : undefined;
    if (value === undefined || value === null) return;
    if (typeof value === 'string') value = value.trim();
    if (transformers[firebaseField]) value = transformers[firebaseField](value);
    if (value !== '' && value !== null && value !== undefined) hasVitalData = true;
    setNested(docData, firebaseField, value);
  });

  if (!hasVitalData) return null;

  // Handle Order ID validation and generation
  const existingKey = docData[keyField];
  if (keyField === 'orderId') {
    const validOrderIdPattern = /^SSGDB-\d{3}$/;
    const existingOrderId = existingKey ? String(existingKey).trim() : '';

    // Check if existing Order ID is valid SSGDB format
    if (!existingOrderId || !validOrderIdPattern.test(existingOrderId)) {
      // Generate new SSGDB ID
      if (orderIdCounter) {
        docData.orderId = generateOrderId(orderIdCounter.value);
        docData._autoGeneratedId = true; // Flag for UI display
        orderIdCounter.value++; // Increment shared counter
      }
    } else {
      // Keep the valid existing SSGDB Order ID
      docData.orderId = existingOrderId;
    }
  } else if (keyField === 'productId') {
    // Handle product IDs
    if (!existingKey || !String(existingKey).trim()) {
      docData.productId = `PROD-${Date.now().toString(36).toUpperCase()}-${rowIndex + 1}`;
      docData._autoGeneratedId = true;
    }
  } else {
    // For other key fields, generate if missing
    if (!existingKey || !String(existingKey).trim()) {
      docData[keyField] = `AUTO-${Date.now().toString(36).toUpperCase()}-${rowIndex + 1}`;
      docData._autoGeneratedId = true;
    }
  }

  Object.entries(defaultValues).forEach(([field, defaultValue]) => {
    const existing = field.split('.').reduce((o, k) => o?.[k], docData);
    if (existing === undefined || existing === null || existing === '') setNested(docData, field, defaultValue);
  });

  // Fallback / Smart Cell Extraction for Product Name, Size, & Color in Orders
  if (mappingConfig.collection === 'orders') {
    const currentProductName = docData.productInfo?.productName;
    // 1. If product name is missing, numeric, ISO date string, or accidental price string, look across row text cells
    const isInvalidProdName = (val) => {
      if (!val || val === 'N/A') return true;
      const str = String(val).trim();
      if (!isNaN(Number(str)) || /^\d+(\.\d+)?$/.test(str)) return true;
      // Check if value is an ISO date / timestamp string (e.g. 2026-07-14T09:49:12.663Z)
      if (!isNaN(Date.parse(str)) && /\d{4}-\d{2}-\d{2}/.test(str)) return true;
      return false;
    };

    if (isInvalidProdName(currentProductName)) {
      setNested(docData, 'productInfo.productName', 'N/A'); // Reset default
      for (const [colHeader, cellValue] of Object.entries(row)) {
        if (!cellValue) continue;
        const strVal = String(cellValue).trim();
        // Check if header is not price/date/contact/id related and value contains non-date text
        if (!/(price|cost|amount|total|pay|qty|quantity|id|status|date|time|timestamp|utc|created|updated|email|phone|contact|address)/i.test(colHeader)) {
          if (strVal.length > 1 && !isInvalidProdName(strVal)) {
            const finalName = (/\bset\s+[a-z0-9]+/i.test(strVal) || /\buniform(s)?\b/i.test(strVal)) ? 'CTU UNIFORMS' : strVal;
            setNested(docData, 'productInfo.productName', finalName);
            break;
          }
        }
      }
    } else if (docData.productInfo?.productName) {
      // Ensure mapped column value also undergoes SET rewriting
      const val = docData.productInfo.productName;
      if (/\bset\s+[a-z0-9]+/i.test(val) || /\buniform(s)?\b/i.test(val)) {
        setNested(docData, 'productInfo.productName', 'CTU UNIFORMS');
      }
    }

    // Known size words pattern: e.g. XS, S, M, L, XL, XXL, 2XL, 3XL, Small, Medium, Large, Extra Large, Regular, Oversized, Freesize, Free Size
    const sizePattern = /\b(xs|s|m|l|xl|xxl|2xl|3xl|4xl|small|medium|large|extra large|regular|oversized|freesize|free size)\b/i;
    // Known colors pattern: e.g. Red, Blue, Black, White, Green, Yellow, Navy, Grey, Gray, Pink, Purple, Maroon, Beige, Orange, Brown
    const colorPattern = /\b(red|blue|black|white|green|yellow|navy|grey|gray|pink|purple|maroon|beige|orange|brown)\b/i;

    let currentSize = docData.productInfo?.size;
    let currentColor = docData.productInfo?.color;

    // 2. Scan row cells for Size or Color if currently 'N/A' or undefined
    if (!currentSize || currentSize === 'N/A') {
      for (const [colHeader, cellValue] of Object.entries(row)) {
        if (!cellValue) continue;
        const strVal = String(cellValue).trim();
        const match = strVal.match(sizePattern);
        if (match) {
          currentSize = match[0].toUpperCase();
          setNested(docData, 'productInfo.size', currentSize);
          break;
        }
      }
    }

    if (!currentColor || currentColor === 'N/A') {
      for (const [colHeader, cellValue] of Object.entries(row)) {
        if (!cellValue) continue;
        const strVal = String(cellValue).trim();
        const match = strVal.match(colorPattern);
        if (match) {
          currentColor = match[0].charAt(0).toUpperCase() + match[0].slice(1).toLowerCase();
          setNested(docData, 'productInfo.color', currentColor);
          break;
        }
      }
    }

    // 3. Fallback Size estimation based on price if Size is still N/A / undefined
    if (!currentSize || currentSize === 'N/A') {
      const price = Number(docData.productInfo?.pricePerUnit || docData.productInfo?.totalPrice || 0);
      if (price > 0) {
        // Uniform sizes estimation based on price tier
        if (price >= 700) {
          setNested(docData, 'productInfo.size', 'XL');
        } else if (price >= 500) {
          setNested(docData, 'productInfo.size', 'Large');
        } else if (price >= 350) {
          setNested(docData, 'productInfo.size', 'Medium');
        } else {
          setNested(docData, 'productInfo.size', 'Regular');
        }
      }
    }
  }

  if (!docData.dateOrdered) docData.dateOrdered = new Date().toISOString();
  return docData;
}

export function transformAllRows(rows, mappingConfig, customMappings = null, progressCallback = null, maxOrderNumber = 0) {
  const detected = customMappings ? { resolvedMappings: customMappings } : detectDynamicColumnMappings(Object.keys(rows[0] || {}), mappingConfig);
  const mappingsToUse = detected.resolvedMappings;
  const docs = [];
  let skippedCount = 0;
  let autoGeneratedIds = 0;
  const errors = [];

  // Shared counter for consistent ID generation
  const orderIdCounter = { value: maxOrderNumber + 1 };

  // Track used Order IDs to prevent duplicates
  const usedOrderIds = new Set();

  const totalRows = rows.length;
  const updateInterval = Math.max(1, Math.floor(totalRows / 20)); // Update progress every 5% or at least every row

  rows.forEach((row, index) => {
    try {
      const docObj = transformRow(row, mappingConfig, mappingsToUse, index, orderIdCounter);
      if (docObj) {
        // Check for duplicate Order IDs
        if (mappingConfig.keyField === 'orderId' && docObj.orderId) {
          if (usedOrderIds.has(docObj.orderId)) {
            // Duplicate found - generate a new unique ID
            docObj.orderId = generateOrderId(orderIdCounter.value);
            docObj._autoGeneratedId = true;
            orderIdCounter.value++;

            errors.push({
              row: index + 1,
              error: `Duplicate Order ID detected, assigned new ID: ${docObj.orderId}`,
              data: row
            });
          }
          usedOrderIds.add(docObj.orderId);
        }

        // Count auto-generated IDs
        if (docObj._autoGeneratedId) {
          autoGeneratedIds++;
        }
        docs.push(docObj);
      } else {
        skippedCount++;
      }
    } catch (err) {
      errors.push({ row: index + 1, error: err.message, data: row });
    }

    // Report progress periodically
    if (progressCallback && (index % updateInterval === 0 || index === totalRows - 1)) {
      const percentage = Math.round(((index + 1) / totalRows) * 100);
      progressCallback({
        stage: 'transforming',
        currentRow: index + 1,
        totalRows: totalRows,
        percentage: Math.min(percentage, 100),
        substage: `Processing row ${index + 1}... (${docs.length} valid, ${skippedCount} skipped, ${errors.length} errors)`
      });
    }
  });

  return { docs, skippedCount, errors, detected, autoGeneratedIds };
}

// ────────────────────────────────────────────────────────────
// 4. BATCH UPSERT TO FIRESTORE
// ────────────────────────────────────────────────────────────

export async function batchUpsert(collectionName, docs, keyField, progressCallback = null) {
  const BATCH_SIZE = 400;
  let created = 0;
  let updated = 0;
  const errors = [];

  if (progressCallback) {
    progressCallback({
      stage: 'fetching',
      currentBatch: 0,
      totalBatches: 0,
      percentage: 0,
      details: 'Fetching existing records from Firestore...'
    });
  }

  const existingSnapshot = await getDocs(collection(db, collectionName));
  const existingMap = new Map();
  existingSnapshot.docs.forEach((d) => {
    const data = d.data();
    const keyValue = data[keyField];
    if (keyValue) existingMap.set(String(keyValue).trim(), { docId: d.id, data });
  });

  const totalBatches = Math.ceil(docs.length / BATCH_SIZE);

  if (progressCallback) {
    progressCallback({
      stage: 'uploading',
      currentBatch: 0,
      totalBatches: totalBatches,
      percentage: 20,
      details: `Found ${existingSnapshot.docs.length} existing records. Starting batch upload...`
    });
  }

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const batchDocs = docs.slice(i, i + BATCH_SIZE);
    const currentBatch = Math.floor(i / BATCH_SIZE) + 1;

    if (progressCallback) {
      progressCallback({
        stage: 'uploading',
        currentBatch: currentBatch,
        totalBatches: totalBatches,
        percentage: Math.round(20 + ((currentBatch - 1) / totalBatches) * 70),
        details: `Processing batch ${currentBatch}/${totalBatches} (${batchDocs.length} records)...`
      });
    }

    for (const docData of batchDocs) {
      try {
        // Remove UI-only flags before saving to Firestore
        const cleanDocData = { ...docData };
        delete cleanDocData._autoGeneratedId;

        const keyValue = String(docData[keyField] || '').trim();
        const existing = keyValue ? existingMap.get(keyValue) : null;
        if (existing) {
          const docRef = doc(db, collectionName, existing.docId);
          batch.set(docRef, { ...cleanDocData, updatedAt: new Date().toISOString() }, { merge: true });
          updated++;
        } else {
          const docRef = doc(collection(db, collectionName));
          batch.set(docRef, { ...cleanDocData, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
          created++;
        }
      } catch (err) {
        errors.push({ key: docData[keyField], error: err.message });
      }
    }

    await batch.commit();

    if (progressCallback) {
      progressCallback({
        stage: 'uploading',
        currentBatch: currentBatch,
        totalBatches: totalBatches,
        percentage: Math.round(20 + (currentBatch / totalBatches) * 70),
        details: `Batch ${currentBatch}/${totalBatches} uploaded successfully. ${created} created, ${updated} updated so far.`
      });
    }
  }

  if (progressCallback) {
    progressCallback({
      stage: 'completed',
      currentBatch: totalBatches,
      totalBatches: totalBatches,
      percentage: 100,
      details: `Upload completed! ${created} created, ${updated} updated, ${errors.length} errors.`
    });
  }

  return { created, updated, errors, total: docs.length };
}

// ────────────────────────────────────────────────────────────
// 5. MASTER SYNC FUNCTION (Accepts URL or File)
// ────────────────────────────────────────────────────────────

export async function getMaxOrderNumber(collectionName) {
  const snapshot = await getDocs(collection(db, collectionName));
  let max = 0;
  snapshot.docs.forEach((docSnap) => {
    const id = docSnap.data()?.orderId || '';
    const match = id.match(/^SSGDB-(\d{3})$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  });
  return max;
}

export async function syncSourceToFirestore({ source, mappingConfig, customMappings = null, callbacks = {} }) {
  const getMaxOrderNumber = async () => {
    if (callbacks.onProgress) {
      callbacks.onProgress('Checking existing order numbers...', {
        stage: 'fetching',
        currentBatch: 0,
        totalBatches: 0,
        percentage: 5,
        details: 'Checking existing order numbers...'
      });
    }

    const snapshot = await getDocs(collection(db, mappingConfig.collection));
    let max = 0;
    snapshot.docs.forEach((docSnap) => {
      const id = docSnap.data()?.orderId || '';
      const match = id.match(/^SSGDB-(\d{3})$/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > max) max = num;
      }
    });

    if (callbacks.onProgress) {
      callbacks.onProgress(`Found ${snapshot.docs.length} existing records. Next order number: ${max + 1}`, {
        stage: 'processing',
        currentBatch: 0,
        totalBatches: 0,
        percentage: 10,
        details: `Found ${snapshot.docs.length} existing records. Next order number: ${max + 1}`
      });
    }

    return max;
  };
  const startMax = await getMaxOrderNumber(mappingConfig.collection);
  const { onProgress = () => { }, onComplete = () => { }, onError = () => { } } = callbacks;
  let rawRows = [];
  if (typeof source === 'string') {
    onProgress('Connecting to Google Sheet...', {
      stage: 'fetching',
      percentage: 15,
      details: 'Connecting to Google Sheet...'
    });
    rawRows = await fetchSheetData(source);
  } else if (source instanceof File) {
    onProgress(`Parsing Excel/CSV file "${source.name}"...`, {
      stage: 'fetching',
      percentage: 15,
      details: `Parsing ${source.name}...`
    });
    rawRows = await parseExcelFile(source);
  } else {
    throw new Error('Invalid data source provided. Please provide a URL or Excel file.');
  }
  onProgress(`Successfully loaded ${rawRows.length} rows.`);
  if (rawRows.length === 0) {
    const emptyResult = { created: 0, updated: 0, errors: [], total: 0, skipped: 0, rawCount: 0 };
    onComplete(emptyResult);
    return emptyResult;
  }
  onProgress('Running dynamic keyword detection algorithm on sheet columns...');
  const { docs, skippedCount, errors: transformErrors, detected, autoGeneratedIds } = transformAllRows(rawRows, mappingConfig, customMappings, null, startMax);
  const mappedColsCount = Object.keys(detected.resolvedMappings).length;
  onProgress(`Algorithm matched ${mappedColsCount} fields. Extracted ${docs.length} valid records (${skippedCount} skipped, ${autoGeneratedIds} with auto-generated IDs).`);

  // Log details about Order ID processing
  if (autoGeneratedIds > 0) {
    onProgress(`⚠️  ${autoGeneratedIds} Order IDs were auto-generated due to missing, invalid format, or duplicate IDs. Only SSGDB-### format is accepted.`);
  }
  if (docs.length === 0) {
    const noDocsResult = { created: 0, updated: 0, errors: transformErrors, total: 0, skipped: skippedCount, rawCount: rawRows.length, detected, autoGeneratedIds };
    onComplete(noDocsResult);
    return noDocsResult;
  }
  onProgress(`Syncing ${docs.length} records into Firestore collection "${mappingConfig.collection}"...`);
  // No more ID manipulation here - IDs are already generated consistently in transformRow
  const { created, updated, errors: upsertErrors, total } = await batchUpsert(mappingConfig.collection, docs, mappingConfig.keyField, (progress) => {
    if (callbacks.onProgress) {
      callbacks.onProgress(progress.details, progress);
    }
  });
  const allErrors = [...transformErrors, ...upsertErrors];
  const finalResult = { created, updated, errors: allErrors, total, skipped: skippedCount, rawCount: rawRows.length, detected, autoGeneratedIds };
  onProgress(`Sync completed! ${created} created, ${updated} updated, ${allErrors.length} errors.`);
  onComplete(finalResult);
  return finalResult;
}

export async function syncSheetToFirestore(sheetUrl, mapping, callbacks = {}) {
  return syncSourceToFirestore({ source: sheetUrl, mappingConfig: mapping, callbacks });
}
