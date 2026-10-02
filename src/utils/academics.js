// utils/academics.js
// PURPOSE: Single source of truth for the College -> Program structure.
// The Program dropdown is driven by the selected College, so these lists must
// not be duplicated anywhere else in the application.

export const COLLEGES = {
  COED: {
    id: 'COED',
    label: 'College of Education',
    programs: ['BEED', 'BSED - MATH', 'BTLED - HE'],
  },
  COTE: {
    id: 'COTE',
    label: 'College of Technology and Engineering',
    programs: [
      'BIT - AUTOMOTIVE',
      'BIT - ELEC',
      'BIT - CT',
      'BSIE',
      'BSFI',
      'BSHM',
      'BSIT',
    ],
  },
};

export const COLLEGE_LIST = Object.values(COLLEGES);
export const COLLEGE_IDS = Object.keys(COLLEGES);

/** Programs available under a college, or [] for an unknown college. */
export const getPrograms = (collegeId) => COLLEGES[collegeId]?.programs ?? [];

export const getCollege = (collegeId) => COLLEGES[collegeId] ?? null;

/**
 * Suggest a section label (e.g. "BSIT - 1A") from a program, used as a
 * convenience placeholder only — the Mayor always confirms the real value.
 */
export const suggestSection = (program) => (program ? `${program} - 1A` : '');

/** Stable key for a section, so "BSIT - 1a" and "BSIT - 1A" are one roster. */
export const sectionKey = (section) =>
  String(section ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Firestore document IDs cannot contain "/" and cannot be "." or "..", but a
 * section name is free text typed by a Mayor. This maps any section to a safe,
 * stable document ID while `sectionKey` stays the value used in queries.
 */
export const sectionDocId = (key) =>
  String(key ?? '')
    .replace(/\//g, '-')
    .replace(/^\.+$/, '-')
    .slice(0, 150) || '-';

export const YEAR_LEVELS = [
  { value: 1, label: '1st Year' },
  { value: 2, label: '2nd Year' },
  { value: 3, label: '3rd Year' },
  { value: 4, label: '4th Year' },
];

const YEAR_WORDS = {
  first: 1,
  '1st': 1,
  second: 2,
  '2nd': 2,
  third: 3,
  '3rd': 3,
  fourth: 4,
  '4th': 4,
};

/**
 * Read the year level out of a section label so the roster directory can group
 * sections without asking the Mayor to enter it again.
 *
 *   "BSIT - 1A"        -> 1
 *   "BSED - 3B"        -> 3
 *   "First Year BSIT"  -> 1
 *   "BSED - MATH"      -> null (gen ed, no year in the label)
 *
 * Returns null when it cannot tell, so the caller can fall back to "Unassigned"
 * rather than guessing wrong and hiding a section from the right year.
 */
export const deriveYearLevel = (section) => {
  const text = String(section ?? '').toLowerCase().trim();
  if (!text) return null;

  for (const [word, level] of Object.entries(YEAR_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return level;
  }

  // "1a" — a year digit immediately followed by a block letter.
  const block = text.match(/([1-4])\s*([a-z])\b/);
  if (block) return Number(block[1]);

  // A bare year digit on its own, e.g. "- 2" or "year 3".
  const bare = text.match(/(?:^|[^0-9a-z])([1-4])(?![0-9a-z])/);
  return bare ? Number(bare[1]) : null;
};

/** Year level for a stored record, falling back to parsing the section label. */
export const yearLevelOf = (record) =>
  record?.yearLevel ?? deriveYearLevel(record?.section);

