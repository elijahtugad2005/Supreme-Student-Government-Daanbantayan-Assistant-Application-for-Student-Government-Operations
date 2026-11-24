/**
 * TDD Regression Suite for Homepage Announcements Pagination & Expansion Helpers
 *
 * Seam Under Test:
 * - src/utils/homepageAnnouncements.js (pure filtering, sorting, 5-per-page pagination, expansion toggle)
 *
 * Run: node scripts/homepage-announcements-tdd.mjs
 */

import assert from 'node:assert/strict';
import {
  HOMEPAGE_ANNOUNCEMENTS_PAGE_SIZE,
  sortHomepageAnnouncements,
  paginateHomepageAnnouncements,
  toggleExpandedAnnouncement,
} from '../src/utils/homepageAnnouncements.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n     ${err.message}`);
  }
}

const sampleAnnouncements = Array.from({ length: 12 }, (_, idx) => {
  const day = String(idx + 1).padStart(2, '0');
  return {
    id: `ann-${idx + 1}`,
    title: `Announcement ${idx + 1}`,
    eventDate: `2026-10-${day}`,
    createdAt: `2026-10-${day}T08:00:00.000Z`,
    homepageVisible: true,
  };
});

test('page size constant is strictly 5 announcements at a time', () => {
  assert.equal(HOMEPAGE_ANNOUNCEMENTS_PAGE_SIZE, 5);
});

test('sortHomepageAnnouncements excludes homepageVisible=false and keeps legacy undefined visible', () => {
  const input = [
    { id: 'hidden', title: 'Hidden', eventDate: '2026-11-20', homepageVisible: false },
    { id: 'legacy', title: 'Legacy', eventDate: '2026-11-10' },
    { id: 'visible', title: 'Visible', eventDate: '2026-11-15', homepageVisible: true },
  ];
  const result = sortHomepageAnnouncements(input);
  assert.deepEqual(
    result.map((a) => a.id),
    ['visible', 'legacy']
  );
});

test('sortHomepageAnnouncements orders newest first by eventDate / createdAt', () => {
  const input = [
    { id: 'old', eventDate: '2026-09-18', createdAt: '2026-09-18T08:00:00Z' },
    { id: 'newest', eventDate: '2026-11-19', createdAt: '2026-11-19T13:35:00Z' },
    { id: 'mid', eventDate: '2026-10-29', createdAt: '2026-10-29T08:00:00Z' },
  ];
  const sorted = sortHomepageAnnouncements(input);
  assert.deepEqual(
    sorted.map((a) => a.id),
    ['newest', 'mid', 'old']
  );
});

test('paginateHomepageAnnouncements returns 1 featured + 4 secondary (5 total) on page 1', () => {
  const sorted = sortHomepageAnnouncements(sampleAnnouncements);
  const page1 = paginateHomepageAnnouncements(sorted, 1);

  assert.equal(page1.items.length, 5);
  assert.equal(page1.featured.id, 'ann-12');
  assert.deepEqual(
    page1.secondary.map((a) => a.id),
    ['ann-11', 'ann-10', 'ann-9', 'ann-8']
  );
  assert.equal(page1.currentPage, 1);
  assert.equal(page1.totalPages, 3);
  assert.equal(page1.totalItems, 12);
  assert.equal(page1.startItem, 1);
  assert.equal(page1.endItem, 5);
});

test('paginateHomepageAnnouncements slices page 2 and partial final page 3 accurately', () => {
  const sorted = sortHomepageAnnouncements(sampleAnnouncements);
  const page2 = paginateHomepageAnnouncements(sorted, 2);
  assert.equal(page2.items.length, 5);
  assert.equal(page2.featured.id, 'ann-7');
  assert.equal(page2.secondary.length, 4);
  assert.equal(page2.startItem, 6);
  assert.equal(page2.endItem, 10);

  const page3 = paginateHomepageAnnouncements(sorted, 3);
  assert.equal(page3.items.length, 2);
  assert.equal(page3.featured.id, 'ann-2');
  assert.deepEqual(
    page3.secondary.map((a) => a.id),
    ['ann-1']
  );
  assert.equal(page3.startItem, 11);
  assert.equal(page3.endItem, 12);
});

test('paginateHomepageAnnouncements clamps out-of-range pages and handles empty list', () => {
  const sorted = sortHomepageAnnouncements(sampleAnnouncements);
  assert.equal(paginateHomepageAnnouncements(sorted, 0).currentPage, 1);
  assert.equal(paginateHomepageAnnouncements(sorted, 99).currentPage, 3);

  const empty = paginateHomepageAnnouncements([], 2);
  assert.equal(empty.items.length, 0);
  assert.equal(empty.featured, null);
  assert.deepEqual(empty.secondary, []);
  assert.equal(empty.currentPage, 1);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.startItem, 0);
  assert.equal(empty.endItem, 0);
});

test('toggleExpandedAnnouncement opens, switches, and collapses cleanly', () => {
  assert.equal(toggleExpandedAnnouncement(null, 'a1'), 'a1');
  assert.equal(toggleExpandedAnnouncement('a1', 'a2'), 'a2');
  assert.equal(toggleExpandedAnnouncement('a2', 'a2'), null);
});

console.log(`\nSummary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
