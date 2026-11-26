/**
 * changelogHelpers.js
 * Pure filtering, search, category counts, and monthly timeline grouping
 * for the Settings -> Changelogs & Repository Timeline panel.
 */

export const CHANGELOG_CATEGORIES = Object.freeze([
  { id: 'all', label: 'All Changes' },
  { id: 'feature', label: 'Features' },
  { id: 'fix', label: 'Fixes' },
  { id: 'style', label: 'UI & Refactors' },
  { id: 'security_test', label: 'Security & Tests' },
  { id: 'docs_chore', label: 'Docs & Chores' },
]);

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Formats a `YYYY-MM` key into a readable milestone heading (e.g. "November 2026").
 */
export function formatMonthHeading(monthKey) {
  const parts = String(monthKey || '').split('-');
  if (parts.length !== 2) return monthKey || 'Unknown Date';
  const year = parts[0];
  const monthIdx = Number(parts[1]) - 1;
  if (!Number.isInteger(monthIdx) || monthIdx < 0 || monthIdx > 11) {
    return monthKey;
  }
  return `${MONTH_NAMES[monthIdx]} ${year}`;
}

/**
 * Filters compiled commits by category, free-text search query (title, subject, hash,
 * scope, author, date, or body details), and chronological direction.
 */
export function filterChangelogCommits(
  commits = [],
  { category = 'all', query = '', sortOrder = 'newest' } = {}
) {
  const list = Array.isArray(commits) ? commits : [];
  const normalizedQuery = String(query || '').trim().toLowerCase();

  const filtered = list.filter((commit) => {
    if (!commit) return false;
    if (category && category !== 'all' && commit.category !== category) {
      return false;
    }
    if (!normalizedQuery) return true;

    const haystack = [
      commit.shortHash,
      commit.hash,
      commit.title,
      commit.subject,
      commit.type,
      commit.author,
      commit.date,
      ...(Array.isArray(commit.scopes) ? commit.scopes : []),
      ...(Array.isArray(commit.bodyLines) ? commit.bodyLines : []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });

  if (sortOrder === 'oldest') {
    return [...filtered].reverse();
  }
  return filtered;
}

/**
 * Groups an ordered commit list into monthly timeline milestones while preserving order.
 */
export function groupCommitsByMonth(commits = []) {
  const groups = [];
  const indexByKey = new Map();

  for (const commit of Array.isArray(commits) ? commits : []) {
    if (!commit) continue;
    const key = commit.monthKey || String(commit.date || '').slice(0, 7) || 'unknown';
    if (!indexByKey.has(key)) {
      indexByKey.set(key, groups.length);
      groups.push({
        monthKey: key,
        label: formatMonthHeading(key),
        commits: [],
      });
    }
    groups[indexByKey.get(key)].commits.push(commit);
  }

  return groups;
}

/**
 * Computes per-category counts for the active search query so filter pills stay accurate.
 */
export function computeChangelogCategoryCounts(commits = [], query = '') {
  const searched = filterChangelogCommits(commits, { category: 'all', query });
  const counts = {
    all: searched.length,
    feature: 0,
    fix: 0,
    style: 0,
    security_test: 0,
    docs_chore: 0,
  };
  for (const commit of searched) {
    if (counts[commit.category] !== undefined) {
      counts[commit.category] += 1;
    }
  }
  return counts;
}
