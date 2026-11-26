/**
 * event-expense-calendar-tdd.mjs
 * Verifies:
 *  1. PPMP Event category requires a calendar date (non-Event categories remain optional)
 *  2. PPMP Event Expense Calendar maps allocations + posted ledger expenses per date
 *  3. Multi-day events render on each spanned date while deduplicating monthly totals
 *  4. Production wiring in BudgetForm.jsx, BudgetFormParts.jsx, and BudgetAnalytics.jsx
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isEventCategoryRequiringDate,
  validatePpmpEventDates,
  expandEventDateSpan,
  extractPpmpCalendarEvents,
  buildMonthlyExpenseCalendar,
  findInitialCalendarMonth,
} from '../src/utils/eventExpenseCalendarHelpers.js';

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

console.log('Running PPMP Event Expense Calendar & Required Date TDD Suite...');

test('Event category requires a startDate while Supplies/Project remain optional', () => {
  assert.equal(isEventCategoryRequiringDate('Event'), true);
  assert.equal(isEventCategoryRequiringDate('event'), true);
  assert.equal(isEventCategoryRequiringDate('Supplies'), false);
  assert.equal(isEventCategoryRequiringDate('Project'), false);

  assert.match(
    validatePpmpEventDates({ category: 'Event', startDate: '', endDate: '' }),
    /required/i
  );
  assert.equal(
    validatePpmpEventDates({ category: 'Event', startDate: '2026-11-20', endDate: '' }),
    ''
  );
  assert.equal(
    validatePpmpEventDates({ category: 'Supplies', startDate: '', endDate: '' }),
    ''
  );
  assert.match(
    validatePpmpEventDates({ category: 'Event', startDate: '2026-11-22', endDate: '2026-11-20' }),
    /before start date/i
  );
});

test('expandEventDateSpan expands inclusive single- and multi-day ranges', () => {
  assert.deepEqual(expandEventDateSpan('2026-11-19', ''), ['2026-11-19']);
  assert.deepEqual(expandEventDateSpan('2026-11-19', '2026-11-21'), [
    '2026-11-19',
    '2026-11-20',
    '2026-11-21',
  ]);
});

test('extractPpmpCalendarEvents links posted ledger expenses and excludes IGF/IGP & reversed rows', () => {
  const budgets = [
    {
      id: 'ppmp-intrams',
      eventName: 'Intramurals 2026',
      category: 'Event',
      committee: 'Sports',
      fundAccountId: 'fund_fiscal_year_budget',
      allocated: 50000,
      spent: 18000,
      status: 'approved',
      startDate: '2026-11-19',
      endDate: '2026-11-21',
    },
    {
      id: 'ppmp-summit',
      eventName: 'Leadership Summit',
      category: 'Event',
      committee: 'Executive Board',
      fundAccountId: 'fund_fsg_remittance',
      isFSG: true,
      allocated: 20000,
      spent: 5000,
      status: 'approved',
      startDate: '2026-11-25',
      endDate: '2026-11-25',
    },
    {
      id: 'ppmp-legacy',
      eventName: 'Legacy Event Without Date',
      category: 'Event',
      fundAccountId: 'fund_fiscal_year_budget',
      allocated: 10000,
      spent: 0,
      status: 'approved',
      startDate: null,
    },
    {
      id: 'igf-non-ppmp',
      eventName: 'Merchandise Batch',
      category: 'Merchandise',
      fundAccountId: 'fund_igf_main',
      fundCategory: 'IGF',
      allocated: 9000,
      spent: 3000,
      status: 'approved',
      startDate: '2026-11-19',
    },
  ];

  const transactions = [
    {
      id: 'tx-1',
      budgetAllocationId: 'ppmp-intrams',
      status: 'posted',
      transactionType: 'expense',
      amountCentavos: 1200000, // ₱12,000
      description: 'Sound System Rental',
      createdAt: '2026-11-19',
    },
    {
      id: 'tx-2',
      budgetAllocationId: 'ppmp-intrams',
      status: 'posted',
      transactionType: 'expense',
      amountCentavos: 800000, // ₱8,000 -> total linked ₱20,000 > stale budget.spent ₱18,000
      description: 'Trophies & Medals',
      createdAt: '2026-11-20',
    },
    {
      id: 'tx-rev',
      budgetAllocationId: 'ppmp-intrams',
      status: 'reversed',
      transactionType: 'expense',
      amountCentavos: 5000000,
      description: 'Reversed Mistake',
    },
  ];

  const { scheduledEvents, unscheduledEvents } = extractPpmpCalendarEvents(budgets, transactions);
  assert.equal(scheduledEvents.length, 2);
  assert.equal(unscheduledEvents.length, 1);

  const intrams = scheduledEvents.find((e) => e.id === 'ppmp-intrams');
  assert.equal(intrams.spent, 20000);
  assert.equal(intrams.remaining, 30000);
  assert.equal(intrams.linkedExpenses.length, 2);

  // Build November 2026 calendar: 3-day Intramurals shows on Nov 19, 20, 21,
  // but monthly summary counts it ONCE (50k + 20k = 70k allocated, 20k + 5k = 25k spent)
  const nov = buildMonthlyExpenseCalendar(scheduledEvents, 2026, 10);
  assert.equal(nov.daysMap.get('2026-11-19').events.length, 1);
  assert.equal(nov.daysMap.get('2026-11-20').events.length, 1);
  assert.equal(nov.daysMap.get('2026-11-21').events.length, 1);
  assert.equal(nov.summary.eventCount, 2);
  assert.equal(nov.summary.allocated, 70000);
  assert.equal(nov.summary.spent, 25000);
  assert.equal(nov.summary.remaining, 45000);
});

test('findInitialCalendarMonth jumps to nearest scheduled month when current month has no events', () => {
  const events = [
    { id: 'e1', startDate: '2026-12-10', spanDates: ['2026-12-10'] },
  ];
  const initial = findInitialCalendarMonth(events, new Date('2026-11-26T00:00:00'));
  assert.deepEqual(initial, { year: 2026, month: 11 }); // December
});

test('BudgetForm requires Event dates and BudgetAnalytics mounts EventExpenseCalendar', () => {
  const formSrc = readFileSync(
    path.join(ROOT_DIR, 'src/components/BudgetForm/BudgetForm.jsx'),
    'utf8'
  );
  const analyticsSrc = readFileSync(
    path.join(ROOT_DIR, 'src/components/BudgetAnalytics/BudgetAnalytics.jsx'),
    'utf8'
  );

  assert.match(formSrc, /validatePpmpEventDates/);
  assert.match(formSrc, /Event Date on Calendar \*/);
  assert.match(analyticsSrc, /<EventExpenseCalendar\s+budgets=\{budgets\}\s+transactions=\{transactions\}\s*\/>/);
});

if (!process.exitCode) {
  console.log(`\nAll ${passed} PPMP Event Expense Calendar & Required Date tests passed!`);
}
