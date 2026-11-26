/**
 * eventExpenseCalendarHelpers.js
 * Pure utilities for:
 *  1. Enforcing required calendar dates on PPMP allocations categorized as "Event"
 *  2. Mapping PPMP allocations + linked posted ledger expenses onto a monthly calendar
 *  3. Computing deduplicated monthly expense totals across single- and multi-day events
 */

import { filterPpmpEligibleBudgets, deriveBudgetHealthStatus } from './budgetAnalyticsHelpers.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 60;

/**
 * Returns true when a PPMP category requires a calendar date ("Event").
 */
export function isEventCategoryRequiringDate(category) {
  return String(category || '').trim().toLowerCase() === 'event';
}

/**
 * Validates PPMP event/project dates for BudgetForm.
 * - Required when category is "Event".
 * - Always rejects endDate < startDate.
 */
export function validatePpmpEventDates({ category, startDate, endDate } = {}) {
  const start = normalizeIsoDate(startDate);
  const end = normalizeIsoDate(endDate);

  if (isEventCategoryRequiringDate(category) && !start) {
    return 'Event date is required on the calendar when PPMP category is Event.';
  }
  if (start && end && end < start) {
    return 'End date cannot be before start date';
  }
  return '';
}

/**
 * Normalizes a string, Date, or Firestore Timestamp into `YYYY-MM-DD` (or null).
 */
export function normalizeIsoDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (ISO_DATE_RE.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return formatDateToIso(parsed);
    }
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : formatDateToIso(value);
  }
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? formatDateToIso(d) : null;
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    const d = new Date(value.seconds * 1000);
    return Number.isNaN(d.getTime()) ? null : formatDateToIso(d);
  }
  return null;
}

export function formatDateToIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Expands a [startIso, endIso] range into an array of inclusive `YYYY-MM-DD` strings.
 */
export function expandEventDateSpan(startIso, endIso) {
  const start = normalizeIsoDate(startIso);
  if (!start) return [];
  const end = normalizeIsoDate(endIso) || start;
  if (end < start) return [start];

  const dates = [];
  const cursor = new Date(`${start}T00:00:00`);
  const limit = new Date(`${end}T00:00:00`);

  while (cursor <= limit && dates.length < MAX_SPAN_DAYS) {
    dates.push(formatDateToIso(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/**
 * Extracts PPMP allocations enriched with their linked posted ledger expenses,
 * separated into `scheduledEvents` (have a calendar date) and `unscheduledEvents`.
 */
export function extractPpmpCalendarEvents(budgets = [], transactions = []) {
  const ppmpBudgets = filterPpmpEligibleBudgets(budgets, {
    activeFundSource: 'ALL',
    includeArchived: false,
  });

  // Group posted outflow ledger transactions by budgetAllocationId
  const ledgerExpensesByAlloc = new Map();
  for (const tx of transactions || []) {
    if (!tx || !tx.budgetAllocationId) continue;
    const status = String(tx.status || '').toLowerCase();
    const txType = String(tx.transactionType || '').toLowerCase();
    if (status !== 'posted') continue;
    if (txType !== 'expense' && txType !== 'payment' && txType !== 'refund') continue;

    const amountPHP = Math.round(Math.abs(Number(tx.amountCentavos) || 0)) / 100;
    if (amountPHP <= 0) continue;

    if (!ledgerExpensesByAlloc.has(tx.budgetAllocationId)) {
      ledgerExpensesByAlloc.set(tx.budgetAllocationId, []);
    }
    ledgerExpensesByAlloc.get(tx.budgetAllocationId).push({
      id: tx.id,
      refNumber: tx.refNumber || '',
      date: normalizeIsoDate(tx.createdAt) || '',
      description: tx.description || tx.expensePurpose || 'Ledger Disbursement',
      expensePurpose: tx.expensePurpose || '',
      amountPHP,
    });
  }

  const scheduledEvents = [];
  const unscheduledEvents = [];

  for (const budget of ppmpBudgets) {
    const startIso = normalizeIsoDate(budget.startDate || budget.raw?.startDate);
    const endIso = normalizeIsoDate(budget.endDate || budget.raw?.endDate) || startIso;
    const linkedExpenses = ledgerExpensesByAlloc.get(budget.id) || [];
    const ledgerSpentSum =
      linkedExpenses.reduce((acc, item) => acc + Math.round(item.amountPHP * 100), 0) / 100;

    const allocated = Number(budget.allocated) || 0;
    const spent = Math.max(Number(budget.spent) || 0, ledgerSpentSum);
    const remaining = Math.max(0, Math.round((allocated - spent) * 100) / 100);

    const enriched = {
      id: budget.id,
      eventName: budget.eventName || 'Untitled PPMP Event',
      category: budget.category || 'Event',
      committee: budget.committee || 'General',
      resolution: budget.resolution || '',
      fundName: budget.fundName || (budget.isFSG ? 'FSG Remittance' : 'Fiscal Year Budget'),
      isFSG: Boolean(budget.isFSG),
      status: deriveBudgetHealthStatus({ ...budget, allocated, spent }),
      allocated,
      spent,
      remaining,
      utilizationPct: allocated > 0 ? Math.min(100, (spent / allocated) * 100) : 0,
      startDate: startIso,
      endDate: endIso,
      spanDates: startIso ? expandEventDateSpan(startIso, endIso) : [],
      linkedExpenses,
    };

    if (startIso) {
      scheduledEvents.push(enriched);
    } else {
      unscheduledEvents.push(enriched);
    }
  }

  scheduledEvents.sort((a, b) => a.startDate.localeCompare(b.startDate));
  return { scheduledEvents, unscheduledEvents };
}

/**
 * Builds per-day map and deduplicated monthly expense totals for a given (year, monthIndex 0-11).
 * Multi-day events appear on each day they cover, while monthly totals count each event ONCE.
 */
export function buildMonthlyExpenseCalendar(scheduledEvents = [], year, monthIndex) {
  const monthPrefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}-`;
  const daysMap = new Map();
  const uniqueMonthEvents = new Map();

  for (const event of scheduledEvents || []) {
    if (!event || !Array.isArray(event.spanDates)) continue;
    let touchesMonth = false;

    for (const dayIso of event.spanDates) {
      if (!dayIso.startsWith(monthPrefix)) continue;
      touchesMonth = true;
      if (!daysMap.has(dayIso)) {
        daysMap.set(dayIso, {
          date: dayIso,
          events: [],
          totalAllocated: 0,
          totalSpent: 0,
          totalRemaining: 0,
        });
      }
      const bucket = daysMap.get(dayIso);
      bucket.events.push(event);
      bucket.totalAllocated =
        (Math.round(bucket.totalAllocated * 100) + Math.round(event.allocated * 100)) / 100;
      bucket.totalSpent =
        (Math.round(bucket.totalSpent * 100) + Math.round(event.spent * 100)) / 100;
      bucket.totalRemaining =
        (Math.round(bucket.totalRemaining * 100) + Math.round(event.remaining * 100)) / 100;
    }

    if (touchesMonth && !uniqueMonthEvents.has(event.id)) {
      uniqueMonthEvents.set(event.id, event);
    }
  }

  const monthEvents = Array.from(uniqueMonthEvents.values()).sort((a, b) =>
    a.startDate.localeCompare(b.startDate)
  );

  let monthAllocatedCentavos = 0;
  let monthSpentCentavos = 0;
  for (const ev of monthEvents) {
    monthAllocatedCentavos += Math.round(ev.allocated * 100);
    monthSpentCentavos += Math.round(ev.spent * 100);
  }

  return {
    daysMap,
    monthEvents,
    summary: {
      eventCount: monthEvents.length,
      allocated: monthAllocatedCentavos / 100,
      spent: monthSpentCentavos / 100,
      remaining: Math.max(0, monthAllocatedCentavos - monthSpentCentavos) / 100,
    },
  };
}

/**
 * Picks the best initial calendar month:
 *  - Current month if it already contains scheduled events (or if no events are scheduled anywhere)
 *  - Otherwise the nearest scheduled event month so users immediately see real data
 */
export function findInitialCalendarMonth(scheduledEvents = [], referenceDate = new Date()) {
  const refYear = referenceDate.getFullYear();
  const refMonth = referenceDate.getMonth();
  const refPrefix = `${refYear}-${String(refMonth + 1).padStart(2, '0')}-`;

  if (!Array.isArray(scheduledEvents) || scheduledEvents.length === 0) {
    return { year: refYear, month: refMonth };
  }

  const hasCurrentMonthEvent = scheduledEvents.some((ev) =>
    (ev.spanDates || []).some((d) => d.startsWith(refPrefix))
  );
  if (hasCurrentMonthEvent) {
    return { year: refYear, month: refMonth };
  }

  // Pick nearest upcoming event, or fallback to latest past event
  const todayIso = formatDateToIso(referenceDate);
  const upcoming = scheduledEvents.find((ev) => ev.startDate >= todayIso);
  const target = upcoming || scheduledEvents[scheduledEvents.length - 1];
  const [y, m] = target.startDate.split('-').map(Number);
  return { year: y, month: m - 1 };
}
