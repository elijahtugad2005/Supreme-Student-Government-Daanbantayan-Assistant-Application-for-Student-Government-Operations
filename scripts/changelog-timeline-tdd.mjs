/**
 * changelog-timeline-tdd.mjs
 * Verifies compiled GitHub changelog dataset, pure timeline filter/grouping helpers,
 * and Settings-only integration contract (no extra sidebar/app routes).
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatMonthHeading,
  filterChangelogCommits,
  groupCommitsByMonth,
  computeChangelogCategoryCounts,
} from '../src/utils/changelogHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const changelogData = JSON.parse(
  readFileSync(path.join(ROOT_DIR, 'src/data/changelogData.json'), 'utf8')
);
const headCount = Number(
  execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim()
);

console.log('Running Settings Changelogs & Repository Timeline TDD Suite...');

test('compiled changelogData.json contains every git commit and valid GitHub repo metadata', () => {
  assert.equal(changelogData.commits.length, headCount);
  assert.equal(changelogData.stats.totalCommits, headCount);
  assert.match(changelogData.repository.url, /^https:\/\/github\.com\/[^/]+\/[^/]+$/);
  assert.ok(changelogData.repository.branch);

  const sumCategories =
    changelogData.stats.features +
    changelogData.stats.fixes +
    changelogData.stats.styles +
    changelogData.stats.securityAndTests +
    changelogData.stats.docsAndChores;
  assert.equal(sumCategories, headCount);

  for (const c of changelogData.commits) {
    assert.match(c.hash, /^[0-9a-f]{40}$/);
    assert.ok(c.shortHash.length >= 7);
    assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(c.commitUrl, `${changelogData.repository.url}/commit/${c.hash}`);
  }
});

test('filterChangelogCommits filters by category, SHA, keyword, scope, and sort order', () => {
  const features = filterChangelogCommits(changelogData.commits, { category: 'feature' });
  assert.equal(features.length, changelogData.stats.features);
  assert.ok(features.every((c) => c.category === 'feature'));

  const latest = changelogData.commits[0];
  const bySha = filterChangelogCommits(changelogData.commits, { query: latest.shortHash });
  assert.equal(bySha.length, 1);
  assert.equal(bySha[0].hash, latest.hash);

  const oldestFirst = filterChangelogCommits(changelogData.commits, { sortOrder: 'oldest' });
  assert.equal(oldestFirst[0].subject, 'Initial commit');
  assert.equal(oldestFirst[oldestFirst.length - 1].hash, latest.hash);
});

test('groupCommitsByMonth produces readable monthly milestones covering all commits', () => {
  assert.equal(formatMonthHeading('2026-11'), 'November 2026');
  assert.equal(formatMonthHeading('2025-10'), 'October 2025');

  const groups = groupCommitsByMonth(changelogData.commits);
  assert.ok(groups.length >= 3);
  const groupedTotal = groups.reduce((acc, g) => acc + g.commits.length, 0);
  assert.equal(groupedTotal, headCount);
  assert.equal(groups[0].label, formatMonthHeading(changelogData.commits[0].monthKey));
});

test('computeChangelogCategoryCounts sums cleanly for filtered queries', () => {
  const counts = computeChangelogCategoryCounts(changelogData.commits, 'finance');
  const breakdown =
    counts.feature + counts.fix + counts.style + counts.security_test + counts.docs_chore;
  assert.equal(counts.all, breakdown);
  assert.ok(counts.all > 0);
});

test('changelogs timeline lives exclusively inside SettingsModal (no standalone App.jsx route)', () => {
  const appSrc = readFileSync(path.join(ROOT_DIR, 'src/App.jsx'), 'utf8');
  const sidebarSrc = readFileSync(path.join(ROOT_DIR, 'src/components/Sidebar/Sidebar.jsx'), 'utf8');
  const settingsSrc = readFileSync(
    path.join(ROOT_DIR, 'src/components/Settings/SettingsModal.jsx'),
    'utf8'
  );

  assert.equal(/path="\/changelogs?"/i.test(appSrc), false);
  assert.match(sidebarSrc, /<SettingsModal/);
  assert.match(settingsSrc, /Expand Changelogs/);
  assert.match(settingsSrc, /repository\.url/);
  assert.equal(/<input/.test(settingsSrc), false, 'Changelogs view should have no search input');
  assert.equal(/CHANGELOG_CATEGORIES/.test(settingsSrc), false, 'Changelogs view should have no filter pills');
});

if (!process.exitCode) {
  console.log(`\nAll ${passed} Settings Changelogs & Repository Timeline tests passed!`);
}
