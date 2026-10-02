// utils/rosterParser.js
// PURPOSE: Flexible roster extraction from an arbitrary school spreadsheet.
// The importer adapts to the school's sheet rather than the other way round.
//
// It never depends on a fixed column position. It scans the header row for a
// recognizable Name column and, when present, a Section column, and ignores
// every other column. Only student name and section are ever extracted.
//
// These are pure functions with no Firebase/React dependency so the matching
// rules can be unit tested directly.

/** Header variants accepted for the student name column (exact matches). */
const NAME_HEADERS = new Set([
  'name',
  'names',
  'student name',
  'student names',
  'full name',
  'full names',
  'student full name',
  'pangalan',
  'listahan ng pangalan',
]);

/** Header variants accepted for the section column (exact matches). */
const SECTION_HEADERS = new Set([
  'section',
  'sections',
  'class',
  'classes',
  'class section',
  'class sections',
  'block',
  'blocks',
  'block section',
  'block sections',
  'class block',
  'section name',
  'section block',
]);

/** Columns that contain "name" but are definitely not a student name list. */
const NAME_LOOKALIKE = ['username', 'file name', 'filename', 'column name', 'header name', 'company name', 'course name', 'program name', 'subject name', 'item name'];

/** Columns that contain "section" but never hold the section label. */
const SECTION_LOOKALIKE = ['section date', 'section time', 'section number of'];

/**
 * Normalize a header for comparison: lowercase, collapse runs of whitespace,
 * drop surrounding punctuation. "  STUDENT  Name " -> "student name".
 */
export const normalizeHeader = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[_\-./\\]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isBlank = (value) => String(value ?? '').trim() === '';

/** True when a header cell plausibly holds student names. */
export function isNameHeader(header) {
  const h = normalizeHeader(header);
  if (!h) return false;
  if (NAME_LOOKALIKE.some((bad) => h.includes(bad))) return false;
  if (NAME_HEADERS.has(h)) return true;
  // "student name (last, first)" and similar
  return /\bname\b/.test(h) && h.split(' ').length <= 4;
}

/** True when a header cell plausibly holds the section label. */
export function isSectionHeader(header) {
  const h = normalizeHeader(header);
  if (!h) return false;
  if (SECTION_LOOKALIKE.some((bad) => h.includes(bad))) return false;
  if (SECTION_HEADERS.has(h)) return true;
  return /\bsection\b/.test(h) || /\bblock\b/.test(h);
}

/**
 * Locate the header row. School sheets often carry a title or logo row above
 * the real headings, so score the first rows and keep the best.
 */
export function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 12);
  let best = { index: 0, score: 0 };

  for (let i = 0; i < limit; i += 1) {
    const row = rows[i] || [];
    const cells = row.filter((c) => !isBlank(c));
    if (cells.length === 0) continue;

    const score = row.reduce((total, cell) => {
      if (isBlank(cell)) return total;
      if (isNameHeader(cell)) return total + 3;
      if (isSectionHeader(cell)) return total + 2;
      return total + 0.5; // a real header, just not one we need
    }, 0);

    if (score > best.score) best = { index: i, score };
  }

  return best.index;
}

/**
 * Pick the Name and Section column indexes from a header row.
 * Exact matches win over fuzzy ones; ties resolve to the leftmost column.
 */
export function detectColumns(headers) {
  const nameScores = headers.map((h) => {
    const n = normalizeHeader(h);
    if (!n) return -1;
    if (NAME_HEADERS.has(n)) return 3;
    if (isNameHeader(h)) return 2;
    return NAME_LOOKALIKE.some((bad) => n.includes(bad)) ? -1 : 0;
  });
  const sectionScores = headers.map((h) => {
    const n = normalizeHeader(h);
    if (!n) return -1;
    if (SECTION_HEADERS.has(n)) return 3;
    if (isSectionHeader(h)) return 2;
    return SECTION_LOOKALIKE.some((bad) => n.includes(bad)) ? -1 : 0;
  });

  const pick = (scores) => {
    const best = scores.reduce((acc, s, i) => (s > acc.score ? { score: s, index: i } : acc), { score: 0, index: -1 });
    return best.score > 0 ? best.index : -1;
  };

  return { nameIndex: pick(nameScores), sectionIndex: pick(sectionScores) };
}

/** A value is "suspicious" when it cannot really be a person's name. */
export function isSuspiciousName(value) {
  const v = String(value ?? '').trim();
  if (!v) return true;
  if (/^\d+$/.test(v)) return true;                 // 123456
  if (v.length < 2) return true;
  if (!/[a-z]/i.test(v)) return true;               // no letters at all
  return false;
}

const canonicalName = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Build the roster from the sheet.
 *
 * @param {Array<Array<any>>} rows        Sheet as array-of-arrays
 * @param {Object} options
 * @param {number} options.headerRowIndex Row holding the headings
 * @param {number} options.nameIndex      Column holding student names
 * @param {number} options.sectionIndex   Column holding section, or -1
 * @param {string} options.websiteSection Section chosen in the website form
 * @returns {Object} students + issues + detected/ignored columns
 */
export function buildRoster(rows, options) {
  const { headerRowIndex = 0, nameIndex = -1, sectionIndex = -1, websiteSection = '' } = options || {};
  const headerRow = rows[headerRowIndex] || [];
  const headers = headerRow.map((h) => String(h ?? '').trim());

  const dataRows = rows.slice(headerRowIndex + 1);
  const students = [];
  const invalid = [];
  const sectionValues = new Set();
  let skippedEmpty = 0;

  dataRows.forEach((row, i) => {
    const rowNumber = headerRowIndex + i + 2; // 1-based, +1 for the header

    // A row is "empty" only when the whole row is blank
    if (!row || row.every(isBlank)) {
      skippedEmpty += 1;
      return;
    }

    if (nameIndex < 0) return;

    const name = String(row[nameIndex] ?? '').trim();
    const section = sectionIndex >= 0 ? String(row[sectionIndex] ?? '').trim() : '';

    if (section) sectionValues.add(section);
    if (!name) {
      skippedEmpty += 1;
      return;
    }

    students.push({
      rowNumber,
      name,
      section,
      suspicious: isSuspiciousName(name),
    });
  });

  const invalidStudents = students.filter((s) => s.suspicious);

  // Duplicates are flagged, never removed — the reviewer decides.
  const seen = new Map();
  const duplicateNames = [];
  students.forEach((s) => {
    const key = canonicalName(s.name);
    if (seen.has(key)) {
      if (!duplicateNames.some((d) => canonicalName(d.name) === key)) {
        duplicateNames.push({ name: s.name, rows: [seen.get(key), s.rowNumber] });
      } else {
        duplicateNames.find((d) => canonicalName(d.name) === key).rows.push(s.rowNumber);
      }
    } else {
      seen.set(key, s.rowNumber);
    }
  });

  const sheetSections = Array.from(sectionValues);
  const webKey = canonicalName(websiteSection);
  const sheetKeys = sheetSections.map(canonicalName);
  const mismatch =
    !!websiteSection &&
    sheetSections.length > 0 &&
    sheetKeys.some((k) => k !== webKey);

  // Which section wins
  const effectiveSection = websiteSection || sheetSections[0] || '';

  const detected = {
    name: nameIndex >= 0 ? headers[nameIndex] : null,
    section: sectionIndex >= 0 ? headers[sectionIndex] : null,
  };
  const ignored = headers.filter(
    (_, i) => i !== nameIndex && i !== sectionIndex && !isBlank(_)
  );

  return {
    headers,
    students,
    detected,
    ignored,
    sheetSections,
    effectiveSection,
    issues: {
      missingNameColumn: nameIndex < 0,
      missingSectionColumn: sectionIndex < 0,
      invalidCount: invalidStudents.length,
      invalidStudents: invalidStudents.map((s) => ({ name: s.name, rowNumber: s.rowNumber })),
      duplicates: duplicateNames,
      skippedEmpty,
      sectionMismatch: mismatch,
    },
  };
}

/** Column label for the manual mapping dropdown, e.g. "Column A — NAMES". */
export function columnLabel(index, header) {
  let name = '';
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  const clean = String(header ?? '').trim();
  return clean ? `${name} — ${clean}` : `${name} — (blank)`;
}
