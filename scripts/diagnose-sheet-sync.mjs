// scripts/diagnose-sheet-sync.mjs
// Diagnosis & regression test for Smart Sheet & Excel Sync under Commerce Hub.

import { detectDynamicColumnMappings, transformAllRows } from '../src/components/Data/sheetSyncService.js';
import { ordersMapping } from '../src/components/Data/sheetMappingConfig.js';
import { readFileSync } from 'node:fs';

let failed = 0;
const results = [];

function check(label, condition, detail = '') {
  if (condition) {
    results.push(`ok   ${label}`);
  } else {
    failed++;
    results.push(`FAIL ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

console.log('=== Diagnosis 1: Un-previewed Direct Sync Empty Mappings Guard ===');
const sampleRows = [
  {
    'Full Name': 'Juan Dela Cruz',
    'Email Address': 'juan@ctu.edu.ph',
    'Student ID': '2024-00123',
    'Product Name': 'CTU Uniform',
    'Quantity': '1',
    'Total Price': '350.00',
  },
];

// When customMappings is an empty object {} (user did not click Preview Extraction first)
const resultWithEmptyObject = transformAllRows(sampleRows, ordersMapping, {});
check(
  'transformAllRows({}): falls back to dynamic detection instead of dropping all rows',
  resultWithEmptyObject.docs.length > 0 && resultWithEmptyObject.skippedCount === 0,
  `docs=${resultWithEmptyObject.docs.length}, skipped=${resultWithEmptyObject.skippedCount}`
);

console.log('\n=== Diagnosis 2: Column Collision & False Positive Matching ===');
const typicalGoogleFormHeaders = [
  'Timestamp',
  'Email Address',
  'Full Name',
  'Student ID',
  'Bachelor Degree',
  'Year & Section',
  'Contact Number',
  'Item Name',
  'Size',
  'Quantity',
];

const detection = detectDynamicColumnMappings(typicalGoogleFormHeaders, ordersMapping);
const mappings = detection.resolvedMappings;

check(
  'orderId does NOT steal "Student ID" (should remain unmapped or require Order ID column)',
  mappings.orderId !== 'Student ID',
  `orderId was mapped to "${mappings.orderId}"`
);

check(
  'customerInfo.address does NOT match "Email Address"',
  mappings['customerInfo.address'] !== 'Email Address',
  `customerInfo.address was mapped to "${mappings['customerInfo.address']}"`
);

check(
  'customerInfo.fullName does NOT match "Item Name"',
  mappings['customerInfo.fullName'] !== 'Item Name',
  `customerInfo.fullName was mapped to "${mappings['customerInfo.fullName']}"`
);

// Check for duplicate column claims
const usedColCounts = {};
for (const col of Object.values(mappings)) {
  if (!col) continue;
  usedColCounts[col] = (usedColCounts[col] || 0) + 1;
}
const duplicateCols = Object.entries(usedColCounts).filter(([_, count]) => count > 1);

check(
  'No two target fields map to the same source column',
  duplicateCols.length === 0,
  `duplicate columns detected: ${JSON.stringify(duplicateCols)}`
);

console.log('\n=== Diagnosis 3: Dead Code & Stale Advice in Sync Panel & Service ===');
const panelContent = readFileSync('src/components/Data/SheetSyncPanel.jsx', 'utf8');
const serviceContent = readFileSync('src/components/Data/sheetSyncService.js', 'utf8');

check(
  'SheetSyncPanel triggers setSuccessModal on successful sync',
  /setSuccessModal\(\s*\{\s*isOpen:\s*true/m.test(panelContent),
  'setSuccessModal is never called with isOpen: true'
);

check(
  'sheetSyncService log does not claim only SSGDB-### is accepted',
  !serviceContent.includes('Only SSGDB-### format is accepted'),
  'found stale message "Only SSGDB-### format is accepted"'
);

console.log('\n=== Results Summary ===');
console.log(results.join('\n'));
if (failed > 0) {
  console.log(`\n❌ ${failed} DIAGNOSTIC CHECKS FAILED (Bugs confirmed).`);
  process.exit(1);
} else {
  console.log('\n✅ All checks passed.');
  process.exit(0);
}
