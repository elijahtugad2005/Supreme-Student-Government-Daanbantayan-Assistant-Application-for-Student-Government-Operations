/**
 * Confirms the roster import still works after moving off the vulnerable
 * npm `xlsx` mirror. Exercises all three accepted formats and the legacy
 * `.xls` path that no other maintained library supports.
 */
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { buildRoster, detectColumns, findHeaderRow } from '../src/utils/rosterParser.js';

let failed = 0;
const results = [];
const check = (label, ok, detail) => {
  if (ok) results.push(`ok   ${label}`);
  else { failed += 1; results.push(`FAIL ${label}${detail ? `\n     ${detail}` : ''}`); }
};

const SHEET = [
  ['DAANBANTAYAN CAMPUS - BSIT 1A'],
  [],
  ['STUDENT NO.', 'STUDENT NAME', 'PROGRAM', 'SECTION', 'YEAR'],
  ['001', 'Juan Dela Cruz', 'BSIT', 'BSIT - 1A', '1'],
  ['002', 'Maria Santos', 'BSIT', 'BSIT - 1A', '1'],
  ['003', 'Pedro Reyes', 'BSIT', 'BSIT - 1A', '1'],
];

const verify = (label, rows) => {
  const hr = findHeaderRow(rows);
  const { nameIndex, sectionIndex } = detectColumns(rows[hr] || []);
  const r = buildRoster(rows, {
    headerRowIndex: hr,
    nameIndex,
    sectionIndex,
    websiteSection: 'BSIT - 1A',
  });
  check(`${label}: header found`, hr === 2, `headerRow=${hr}`);
  check(`${label}: name column detected`, r.detected.name === 'STUDENT NAME', `got ${r.detected.name}`);
  check(`${label}: section column detected`, r.detected.section === 'SECTION', `got ${r.detected.section}`);
  check(`${label}: 3 students parsed`, r.students.length === 3, `got ${r.students.length}`);
  check(
    `${label}: names correct`,
    r.students.map((s) => s.name).join('|') === 'Juan Dela Cruz|Maria Santos|Pedro Reyes',
    r.students.map((s) => s.name).join('|')
  );
  check(`${label}: ignored columns detected`, r.ignored.join(',') === 'STUDENT NO.,PROGRAM,YEAR', r.ignored.join(','));
  check(`${label}: no false mismatch`, r.issues.sectionMismatch === false);
  check(`${label}: no duplicates`, r.issues.duplicates.length === 0);
  check(`${label}: no invalid names`, r.issues.invalidCount === 0);
};

// --- .xlsx (what readFile does for spreadsheets)
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(SHEET), 'Enlistment');
const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const xlsxRows = XLSX.utils.sheet_to_json(
  XLSX.read(xlsxBuf, { type: 'array' }).Sheets.Enlistment,
  { header: 1, raw: false, defval: '' }
);
verify('.xlsx', xlsxRows);

// --- legacy .xls (Excel 97-2003). Only SheetJS reads this format.
const xlsBuf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' });
const xlsRows = XLSX.utils.sheet_to_json(
  XLSX.read(xlsBuf, { type: 'array' }).Sheets.Enlistment,
  { header: 1, raw: false, defval: '' }
);
check('.xls: buffer produced', xlsBuf.length > 0, `${xlsBuf.length} bytes`);
verify('.xls', xlsRows);

// --- .csv (what readFile does for text formats)
const csvRows = Papa.parse(
  SHEET.map((r) => r.map((c) => `"${String(c ?? '')}"`).join(',')).join('\n'),
  { skipEmptyLines: false }
).data;
verify('.csv', csvRows);

console.log(results.join('\n'));
console.log(failed === 0 ? '\nRoster import works on all three formats with SheetJS CE 0.20.3.' : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);