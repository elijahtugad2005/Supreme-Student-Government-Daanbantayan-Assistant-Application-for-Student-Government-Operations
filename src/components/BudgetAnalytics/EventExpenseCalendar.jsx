import React, { useMemo, useState, useEffect } from 'react';
import {
  HiCalendar,
  HiChevronLeft,
  HiChevronRight,
  HiDocumentText,
  HiUserGroup,
  HiCash,
  HiInformationCircle,
} from 'react-icons/hi';
import {
  extractPpmpCalendarEvents,
  buildMonthlyExpenseCalendar,
  findInitialCalendarMonth,
  formatDateToIso,
} from '../../utils/eventExpenseCalendarHelpers.js';
import styles from './EventExpenseCalendar.module.css';

const MONTHS = [
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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatPHP = (val) =>
  `₱${(Number(val) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatCompactPHP = (val) => {
  const num = Number(val) || 0;
  if (num >= 1000) {
    const k = num / 1000;
    return `₱${k >= 10 || Number.isInteger(k) ? Math.round(k) : k.toFixed(1)}k`;
  }
  return `₱${Math.round(num)}`;
};

const formatReadableDate = (isoDate) => {
  if (!isoDate) return '';
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const formatDateRange = (startDate, endDate) => {
  if (!startDate) return 'No date assigned';
  if (!endDate || endDate === startDate) return formatReadableDate(startDate);
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = end.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startStr} – ${endStr}`;
};

function getStatusBadgeClass(status) {
  switch (status) {
    case 'On Track':
      return styles.statusOnTrack;
    case 'Almost Spent':
      return styles.statusAlmost;
    case 'Fully Spent':
      return styles.statusFull;
    case 'Over Budget':
      return styles.statusOver;
    default:
      return styles.statusDraft;
  }
}

export default function EventExpenseCalendar({ budgets = [], transactions = [] }) {
  const { scheduledEvents, unscheduledEvents } = useMemo(
    () => extractPpmpCalendarEvents(budgets, transactions),
    [budgets, transactions]
  );

  const [view, setView] = useState(() => findInitialCalendarMonth(scheduledEvents));
  const [selectedDate, setSelectedDate] = useState(null);
  const [hasUserNavigated, setHasUserNavigated] = useState(false);

  // When budgets finish loading asynchronously, snap once to a month with scheduled events
  useEffect(() => {
    if (hasUserNavigated || scheduledEvents.length === 0) return;
    setView(findInitialCalendarMonth(scheduledEvents));
  }, [scheduledEvents, hasUserNavigated]);

  const { daysMap, monthEvents, summary } = useMemo(
    () => buildMonthlyExpenseCalendar(scheduledEvents, view.year, view.month),
    [scheduledEvents, view.year, view.month]
  );

  const todayIso = formatDateToIso(new Date());
  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();

  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, idx) => idx + 1),
  ];

  const shiftMonth = (delta) => {
    setHasUserNavigated(true);
    setSelectedDate(null);
    setView((prev) => {
      const next = new Date(prev.year, prev.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  const jumpToToday = () => {
    const now = new Date();
    setHasUserNavigated(true);
    setView({ year: now.getFullYear(), month: now.getMonth() });
    setSelectedDate(todayIso);
  };

  const jumpToEvent = (event) => {
    if (!event?.startDate) return;
    const [y, m] = event.startDate.split('-').map(Number);
    setHasUserNavigated(true);
    setView({ year: y, month: m - 1 });
    setSelectedDate(event.startDate);
  };

  const selectedDayData = selectedDate ? daysMap.get(selectedDate) || null : null;
  const displayedEvents = selectedDate
    ? selectedDayData?.events || []
    : monthEvents;

  // Quick-jump chips for scheduled months so officers/teachers never hunt blindly
  const scheduledMonths = useMemo(() => {
    const map = new Map();
    for (const ev of scheduledEvents) {
      const monthKeysForEvent = new Set(
        (ev.spanDates || (ev.startDate ? [ev.startDate] : [])).map((d) => String(d).slice(0, 7))
      );
      for (const key of monthKeysForEvent) {
        const [y, m] = key.split('-').map(Number);
        if (!y || !m) continue;
        if (!map.has(key)) {
          map.set(key, {
            key,
            year: y,
            month: m - 1,
            label: `${MONTHS[m - 1].slice(0, 3)} ${y}`,
            count: 0,
          });
        }
        map.get(key).count += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, [scheduledEvents]);

  return (
    <section
      className={styles.calendarCard}
      aria-labelledby="event-expense-calendar-title"
    >
      {/* Header & Monthly Expense KPIs */}
      <div className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <HiCalendar className={styles.titleIcon} aria-hidden="true" />
            <h3 id="event-expense-calendar-title" className={styles.title}>
              PPMP Event Expense Calendar
            </h3>
          </div>
          <p className={styles.subtitle}>
            Select any highlighted date to inspect event allocations, actual posted expenses, and remaining balance.
          </p>
        </div>

        <div className={styles.monthKpiStrip}>
          <div className={styles.monthKpi}>
            <span className={styles.monthKpiLabel}>Events ({MONTHS[view.month].slice(0, 3)})</span>
            <span className={styles.monthKpiVal}>{summary.eventCount}</span>
          </div>
          <div className={styles.monthKpi}>
            <span className={styles.monthKpiLabel}>Allocated</span>
            <span className={styles.monthKpiVal}>{formatPHP(summary.allocated)}</span>
          </div>
          <div className={styles.monthKpi}>
            <span className={styles.monthKpiLabel}>Total Expense</span>
            <span className={`${styles.monthKpiVal} ${styles.monthKpiSpent}`}>
              {formatPHP(summary.spent)}
            </span>
          </div>
          <div className={styles.monthKpi}>
            <span className={styles.monthKpiLabel}>Remaining</span>
            <span className={`${styles.monthKpiVal} ${styles.monthKpiRemaining}`}>
              {formatPHP(summary.remaining)}
            </span>
          </div>
        </div>
      </div>

      {/* Main 2-Column Workspace: Calendar Grid + Selected Date Event Cost Inspector */}
      <div className={styles.workspaceGrid}>
        {/* Left: Monthly Calendar Grid */}
        <div className={styles.calendarPane}>
          <div className={styles.calendarNav}>
            <div className={styles.navControls}>
              <button
                type="button"
                className={styles.navBtn}
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
              >
                <HiChevronLeft size={18} aria-hidden="true" />
              </button>
              <span className={styles.monthHeading} aria-live="polite">
                {MONTHS[view.month]} {view.year}
              </span>
              <button
                type="button"
                className={styles.navBtn}
                onClick={() => shiftMonth(1)}
                aria-label="Next month"
              >
                <HiChevronRight size={18} aria-hidden="true" />
              </button>
            </div>

            <button type="button" className={styles.todayBtn} onClick={jumpToToday}>
              Today
            </button>
          </div>

          {/* Quick-jump month pills when events exist across months */}
          {scheduledMonths.length > 0 && (
            <div className={styles.quickMonthRow} aria-label="Months with scheduled PPMP events">
              <span className={styles.quickMonthLabel}>Scheduled:</span>
              {scheduledMonths.map((item) => {
                const isCurrent = item.year === view.year && item.month === view.month;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`${styles.quickMonthPill} ${
                      isCurrent ? styles.quickMonthPillActive : ''
                    }`}
                    onClick={() => {
                      setHasUserNavigated(true);
                      setSelectedDate(null);
                      setView({ year: item.year, month: item.month });
                    }}
                  >
                    <span>{item.label}</span>
                    <span className={styles.quickMonthCount}>{item.count}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className={styles.weekdayRow} role="row">
            {WEEKDAYS.map((day) => (
              <span key={day} className={styles.weekdayLabel} role="columnheader">
                {day}
              </span>
            ))}
          </div>

          <div className={styles.daysGrid} role="grid" aria-label="PPMP event expense calendar">
            {cells.map((dayNum, idx) => {
              if (dayNum === null) {
                return <div key={`empty-${idx}`} className={styles.dayCellEmpty} aria-hidden="true" />;
              }
              const dayIso = `${view.year}-${String(view.month + 1).padStart(2, '0')}-${String(
                dayNum
              ).padStart(2, '0')}`;
              const bucket = daysMap.get(dayIso);
              const hasEvents = Boolean(bucket && bucket.events.length > 0);
              const isSelected = selectedDate === dayIso;
              const isToday = dayIso === todayIso;
              const hasSpent = hasEvents && bucket.totalSpent > 0;
              const isOverBudget =
                hasEvents && bucket.events.some((ev) => ev.status === 'Over Budget');

              return (
                <button
                  key={dayIso}
                  type="button"
                  onClick={() =>
                    setSelectedDate((prev) => (prev === dayIso ? null : dayIso))
                  }
                  aria-pressed={isSelected}
                  aria-label={`${MONTHS[view.month]} ${dayNum}, ${view.year}${
                    hasEvents
                      ? `, ${bucket.events.length} event${bucket.events.length > 1 ? 's' : ''}, spent ${formatPHP(bucket.totalSpent)}`
                      : ''
                  }`}
                  className={[
                    styles.dayCell,
                    hasEvents ? styles.dayCellHasEvent : '',
                    isSelected ? styles.dayCellSelected : '',
                    isToday ? styles.dayCellToday : '',
                    isOverBudget ? styles.dayCellOver : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className={styles.dayTopRow}>
                    <span className={styles.dayNumber}>{dayNum}</span>
                    {hasEvents && (
                      <span className={styles.dayEventCount}>
                        {bucket.events.length}
                      </span>
                    )}
                  </div>

                  {hasEvents && (
                    <div className={styles.dayCostWrap}>
                      <span
                        className={hasSpent ? styles.daySpentTag : styles.dayPlannedTag}
                        title={
                          hasSpent
                            ? `Spent: ${formatPHP(bucket.totalSpent)} of ${formatPHP(bucket.totalAllocated)}`
                            : `Allocated: ${formatPHP(bucket.totalAllocated)} (₱0.00 spent yet)`
                        }
                      >
                        {hasSpent
                          ? formatCompactPHP(bucket.totalSpent)
                          : formatCompactPHP(bucket.totalAllocated)}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className={styles.calendarLegend}>
            <span className={styles.legendItem}>
              <span className={`${styles.legendSwatch} ${styles.legendSwatchSpent}`} />
              <span>Actual Expense Recorded</span>
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.legendSwatch} ${styles.legendSwatchPlanned}`} />
              <span>Planned Budget (₱0 Spent)</span>
            </span>
          </div>
        </div>

        {/* Right: Selected Date / Month Event Expense Breakdown */}
        <div className={styles.inspectorPane}>
          <div className={styles.inspectorHeader}>
            <div>
              <h4 className={styles.inspectorTitle}>
                {selectedDate
                  ? formatReadableDate(selectedDate)
                  : `${MONTHS[view.month]} ${view.year} Scheduled Events`}
              </h4>
              <p className={styles.inspectorSub}>
                {selectedDate
                  ? `${displayedEvents.length} PPMP ${
                      displayedEvents.length === 1 ? 'event' : 'events'
                    } on this date`
                  : `Showing all ${displayedEvents.length} scheduled PPMP ${
                      displayedEvents.length === 1 ? 'event' : 'events'
                    } in this month`}
              </p>
            </div>
            {selectedDate && (
              <button
                type="button"
                className={styles.clearDateBtn}
                onClick={() => setSelectedDate(null)}
              >
                Show Full Month
              </button>
            )}
          </div>

          <div className={styles.eventList}>
            {displayedEvents.length === 0 ? (
              <div className={styles.emptyInspector}>
                <HiCalendar size={26} aria-hidden="true" />
                <p>
                  {selectedDate
                    ? 'No PPMP events scheduled on this date.'
                    : `No PPMP events scheduled in ${MONTHS[view.month]} ${view.year}.`}
                </p>
                {scheduledEvents.length > 0 && !selectedDate && (
                  <button
                    type="button"
                    className={styles.jumpLatestBtn}
                    onClick={() => jumpToEvent(scheduledEvents[scheduledEvents.length - 1])}
                  >
                    Jump to {scheduledEvents[scheduledEvents.length - 1].eventName}
                  </button>
                )}
              </div>
            ) : (
              displayedEvents.map((ev) => (
                <article key={ev.id} className={styles.eventCard}>
                  <div className={styles.eventCardTop}>
                    <div className={styles.eventCardTitleWrap}>
                      <h5 className={styles.eventCardName}>{ev.eventName}</h5>
                      <div className={styles.eventCardMeta}>
                        <span className={styles.categoryTag}>{ev.category}</span>
                        <span>{formatDateRange(ev.startDate, ev.endDate)}</span>
                      </div>
                    </div>
                    <span className={`${styles.statusBadge} ${getStatusBadgeClass(ev.status)}`}>
                      {ev.status}
                    </span>
                  </div>

                  <div className={styles.eventContextRow}>
                    <span className={styles.contextItem}>
                      <HiUserGroup size={13} aria-hidden="true" />
                      <span>{ev.committee}</span>
                    </span>
                    {ev.resolution && (
                      <span className={styles.contextItem}>
                        <HiDocumentText size={13} aria-hidden="true" />
                        <span>{ev.resolution}</span>
                      </span>
                    )}
                    <span className={styles.contextItem}>
                      <HiCash size={13} aria-hidden="true" />
                      <span>{ev.fundName}</span>
                    </span>
                  </div>

                  {/* Cost Breakdown Strip */}
                  <div className={styles.costGrid}>
                    <div className={styles.costCell}>
                      <span className={styles.costLabel}>Allocated</span>
                      <span className={styles.costValue}>{formatPHP(ev.allocated)}</span>
                    </div>
                    <div className={styles.costCell}>
                      <span className={styles.costLabel}>Actual Expense</span>
                      <span className={`${styles.costValue} ${styles.costValueSpent}`}>
                        {formatPHP(ev.spent)}
                      </span>
                    </div>
                    <div className={styles.costCell}>
                      <span className={styles.costLabel}>Remaining</span>
                      <span className={`${styles.costValue} ${styles.costValueRem}`}>
                        {formatPHP(ev.remaining)}
                      </span>
                    </div>
                  </div>

                  <div className={styles.meterTrack} aria-hidden="true">
                    <div
                      className={`${styles.meterFill} ${
                        ev.status === 'Over Budget' ? styles.meterFillOver : ''
                      }`}
                      style={{ width: `${Math.min(100, ev.utilizationPct)}%` }}
                    />
                  </div>

                  {/* Linked Posted Ledger Disbursements */}
                  {ev.linkedExpenses.length > 0 && (
                    <div className={styles.ledgerDisbursements}>
                      <span className={styles.disbursementsTitle}>
                        Posted Ledger Expenses ({ev.linkedExpenses.length})
                      </span>
                      <ul className={styles.disbursementsList}>
                        {ev.linkedExpenses.map((tx) => (
                          <li key={tx.id} className={styles.disbursementRow}>
                            <span className={styles.disbursementDesc} title={tx.description}>
                              {tx.description}
                            </span>
                            <span className={styles.disbursementAmt}>
                              -{formatPHP(tx.amountPHP)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>

          {unscheduledEvents.length > 0 && (
            <div className={styles.unscheduledNotice}>
              <HiInformationCircle size={15} aria-hidden="true" />
              <span>
                {unscheduledEvents.length} legacy PPMP{' '}
                {unscheduledEvents.length === 1 ? 'allocation has' : 'allocations have'} no
                calendar date assigned yet.
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
