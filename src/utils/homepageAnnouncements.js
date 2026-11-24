// Pure helpers for Homepage Latest Announcements sorting, 5-per-page pagination,
// and single-open expansion toggling.

export const HOMEPAGE_ANNOUNCEMENTS_PAGE_SIZE = 5;

function toTimestamp(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return value.seconds * 1000;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Filter out announcements explicitly hidden from the homepage (`homepageVisible === false`)
 * while preserving legacy records where `homepageVisible` is undefined, then sort newest first.
 */
export function sortHomepageAnnouncements(announcements = []) {
  if (!Array.isArray(announcements)) return [];
  return announcements
    .filter((item) => item && item.homepageVisible !== false)
    .slice()
    .sort((a, b) => {
      const dateDiff = toTimestamp(b.eventDate) - toTimestamp(a.eventDate);
      if (dateDiff !== 0) return dateDiff;
      return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
    });
}

/**
 * Paginate announcements into pages of at most `pageSize` (default 5):
 * 1 featured card on the left + up to 4 compact list cards on the right.
 */
export function paginateHomepageAnnouncements(
  announcements = [],
  page = 1,
  pageSize = HOMEPAGE_ANNOUNCEMENTS_PAGE_SIZE
) {
  const safeList = Array.isArray(announcements) ? announcements : [];
  const safeSize = Math.max(1, Number(pageSize) || HOMEPAGE_ANNOUNCEMENTS_PAGE_SIZE);
  const totalItems = safeList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safeSize));
  const currentPage = Math.min(Math.max(1, Math.floor(Number(page) || 1)), totalPages);

  const startIndex = (currentPage - 1) * safeSize;
  const items = safeList.slice(startIndex, startIndex + safeSize);

  return {
    items,
    featured: items[0] || null,
    secondary: items.slice(1),
    currentPage,
    totalPages,
    totalItems,
    startItem: totalItems === 0 ? 0 : startIndex + 1,
    endItem: totalItems === 0 ? 0 : startIndex + items.length,
  };
}

/**
 * Toggle expansion state cleanly (one expanded announcement at a time).
 */
export function toggleExpandedAnnouncement(currentExpandedId, targetId) {
  return currentExpandedId === targetId ? null : targetId;
}
