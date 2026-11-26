import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  HiChevronDown,
  HiChevronLeft,
  HiChevronRight,
  HiDocumentText,
  HiDownload,
  HiEye,
  HiPlus,
  HiTrash,
  HiX,
  HiExclamationCircle,
} from 'react-icons/hi';
import { getDocumentUrl, subscribeToDocuments } from '../../services/documentService.js';
import styles from './BudgetFormParts.module.css';
import { SPONSOR_COMMITTEES, lineTotal } from './budgetFormHelpers.js';

/* ──────────────────────────────────────────────────────────────
   Shared helpers
   ────────────────────────────────────────────────────────────── */

const peso = (n) =>
  `₱${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ──────────────────────────────────────────────────────────────
   Cost Breakdown Planner: quantity x unit cost = line total
   ────────────────────────────────────────────────────────────── */

export const CostBreakdownPlanner = ({
  items,
  onChange,
  onAdd,
  onRemove,
  allocatedCapital,
  error,
}) => {
  const plannedTotal = items.reduce((acc, it) => acc + lineTotal(it), 0);
  const spentTotal = items.reduce((acc, it) => acc + (parseFloat(it.spent) || 0), 0);
  const isOverPlanned = allocatedCapital > 0 && plannedTotal > allocatedCapital;
  const unassigned = Math.max(0, allocatedCapital - plannedTotal);
  const plannedPct = allocatedCapital > 0 ? Math.min(100, (plannedTotal / allocatedCapital) * 100) : 0;
  const overrun = allocatedCapital > 0 && spentTotal > allocatedCapital ? spentTotal - allocatedCapital : 0;

  return (
    <section className={styles.planner} aria-labelledby="planner-title">
      <header className={styles.plannerHead}>
        <h4 id="planner-title" className={styles.plannerTitle}>Cost Breakdown Planner</h4>
        <p className={styles.plannerHint}>
          Enter the price of <strong>one</strong> unit and how many are needed. The line total is
          computed for you, for example 10 umbrellas at ₱150.00 each is ₱1,500.00.
        </p>
      </header>

      <div className={styles.plannerCols} aria-hidden="true">
        <span>Item</span>
        <span>Qty</span>
        <span>Cost per unit</span>
        <span>Line total</span>
        <span>Actual spent</span>
        <span />
      </div>

      <ul className={styles.rows}>
        {items.map((item, idx) => {
          const total = lineTotal(item);
          const spent = parseFloat(item.spent) || 0;
          const inflated = total > 0 && spent > total;
          return (
            <li key={item.id || idx} className={styles.row}>
              <input
                type="text"
                className={`${styles.cell} ${styles.cellName}`}
                placeholder="e.g. Umbrella, sound system, food packs"
                value={item.description}
                aria-label={`Item ${idx + 1} name`}
                onChange={(e) => onChange(idx, 'description', e.target.value)}
              />
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                className={`${styles.cell} ${styles.cellQty}`}
                value={item.quantity}
                aria-label={`Item ${idx + 1} quantity`}
                onChange={(e) => onChange(idx, 'quantity', e.target.value)}
              />
              <label className={styles.money}>
                <span aria-hidden="true">₱</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className={styles.cell}
                  placeholder="0.00"
                  value={item.unitCost}
                  aria-label={`Item ${idx + 1} cost per unit`}
                  onChange={(e) => onChange(idx, 'unitCost', e.target.value)}
                />
              </label>
              <output className={styles.lineTotal} aria-label={`Item ${idx + 1} line total`}>
                {peso(total)}
                {(parseFloat(item.quantity) || 0) > 1 && (parseFloat(item.unitCost) || 0) > 0 && (
                  <small>
                    {parseFloat(item.quantity)} × {peso(item.unitCost)}
                  </small>
                )}
              </output>
              <label className={`${styles.money} ${inflated ? styles.moneyWarn : ''}`}>
                <span aria-hidden="true">₱</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className={styles.cell}
                  placeholder="0.00"
                  value={item.spent || ''}
                  aria-label={`Item ${idx + 1} actual spent`}
                  onChange={(e) => onChange(idx, 'spent', e.target.value)}
                />
              </label>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => onRemove(idx)}
                disabled={items.length === 1}
                aria-label={`Remove item ${idx + 1}`}
              >
                <HiTrash />
              </button>
              {inflated && (
                <p className={styles.rowNote}>
                  Actual price is {peso(spent - total)} above the planned estimate for this item.
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <button type="button" className={styles.addBtn} onClick={onAdd}>
        <HiPlus /> Add item
      </button>

      <footer className={styles.totals}>
        <div className={styles.totalsLine}>
          <span>Planned total</span>
          <strong className={isOverPlanned ? styles.bad : styles.good}>{peso(plannedTotal)}</strong>
          <span className={styles.totalsOf}>of {peso(allocatedCapital)} allocated</span>
        </div>
        <div
          className={styles.meter}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(plannedPct)}
          aria-label="Planned total against allocated amount"
        >
          <span
            className={isOverPlanned ? styles.meterBad : styles.meterFill}
            style={{ width: `${plannedPct}%` }}
          />
        </div>
        <div className={styles.totalsLine}>
          {isOverPlanned ? (
            <span className={styles.bad}>
              Over the allocation by {peso(plannedTotal - allocatedCapital)}. Reduce quantities or unit costs.
            </span>
          ) : (
            <span>{peso(unassigned)} of the allocation is not yet itemized</span>
          )}
        </div>
        <div className={styles.totalsLine}>
          <span>Actual spent (recorded automatically)</span>
          <strong className={styles.gold}>{peso(spentTotal)}</strong>
        </div>
        {overrun > 0 && (
          <p className={styles.rowNote}>
            Actual spending is {peso(overrun)} over the allocation, which is allowed for price increases.
          </p>
        )}
      </footer>

      {error && (
        <div className={styles.errorBar} role="alert">
          <HiExclamationCircle /> <span>{error}</span>
        </div>
      )}
    </section>
  );
};

/* ──────────────────────────────────────────────────────────────
   Committee Responsible (multi-select chips)
   ────────────────────────────────────────────────────────────── */

export const CommitteePicker = ({ value, onChange }) => {
  const toggle = (name) => {
    const next = value.includes(name) ? value.filter((v) => v !== name) : [...value, name];
    onChange(next);
  };
  return (
    <div className={styles.chipGroup} role="group" aria-label="Committee responsible">
      {SPONSOR_COMMITTEES.map((name) => {
        const on = value.includes(name);
        return (
          <button
            key={name}
            type="button"
            className={`${styles.chip} ${on ? styles.chipOn : ''}`}
            aria-pressed={on}
            onClick={() => toggle(name)}
          >
            {name}
          </button>
        );
      })}
    </div>
  );
};

/* ──────────────────────────────────────────────────────────────
   Resolution link: approved Resolution documents, downloadable
   ────────────────────────────────────────────────────────────── */

const MANUAL = '__manual__';

export const ResolutionPicker = ({ resolution, documentId, onChange, onPreviewDocument = null }) => {
  const [docs, setDocs] = useState([]);
  const [dlError, setDlError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    let unsub = () => {};
    try {
      unsub = subscribeToDocuments(
        (all) => setDocs(all),
        () => setDocs([])
      );
    } catch {
      setDocs([]);
    }
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const handleOutsideClick = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const approvedResolutions = useMemo(
    () =>
      docs
        .filter(
          (d) =>
            d.status === 'approved' &&
            (d.labels || []).some((l) => String(l).toLowerCase().includes('resolution'))
        )
        .sort((a, b) => String(a.title).localeCompare(String(b.title))),
    [docs]
  );

  const selected = approvedResolutions.find((d) => d.id === documentId) || null;
  const selectValue = documentId && selected ? documentId : MANUAL;

  const triggerLabel = selected
    ? selected.documentNumber
      ? `${selected.documentNumber} — ${selected.title}`
      : selected.title
    : 'Type a reference manually';

  const handleSelectOption = (value) => {
    setDlError('');
    setOpen(false);
    if (value === MANUAL) {
      onChange({ resolution: documentId ? '' : resolution, resolutionDocumentId: null });
      return;
    }
    const d = approvedResolutions.find((x) => x.id === value);
    onChange({
      resolution: d ? d.documentNumber || d.title : '',
      resolutionDocumentId: value,
    });
  };

  const handleDownload = async () => {
    if (!selected) return;
    setBusy(true);
    setDlError('');
    try {
      const url = await getDocumentUrl(selected, { download: true });
      if (!url) throw new Error('This document has no downloadable file.');
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setDlError(err.message || 'Could not open the resolution file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.resolution}>
      <div className={styles.resolutionRow}>
        <div className={styles.resDropdownWrap} ref={wrapRef}>
          <button
            type="button"
            className={styles.resTrigger}
            onClick={() => setOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label="Linked approved resolution"
            title={triggerLabel}
          >
            <HiDocumentText className={styles.resTriggerIcon} aria-hidden="true" />
            <span className={styles.resTriggerText}>{triggerLabel}</span>
            <HiChevronDown
              className={`${styles.resCaret} ${open ? styles.resCaretOpen : ''}`}
              aria-hidden="true"
            />
          </button>

          {open && (
            <ul className={styles.resMenu} role="listbox" aria-label="Approved resolutions">
              <li role="option" aria-selected={selectValue === MANUAL}>
                <button
                  type="button"
                  className={`${styles.resOption} ${selectValue === MANUAL ? styles.resOptionActive : ''}`}
                  onClick={() => handleSelectOption(MANUAL)}
                >
                  <span className={styles.resOptTitle}>Type a reference manually</span>
                </button>
              </li>
              {approvedResolutions.map((d) => {
                const isActive = selectValue === d.id;
                return (
                  <li key={d.id} role="option" aria-selected={isActive}>
                    <button
                      type="button"
                      className={`${styles.resOption} ${isActive ? styles.resOptionActive : ''}`}
                      onClick={() => handleSelectOption(d.id)}
                    >
                      {d.documentNumber && (
                        <span className={styles.resOptCode}>{d.documentNumber}</span>
                      )}
                      <span className={styles.resOptTitle}>{d.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {selected && typeof onPreviewDocument === 'function' && (
          <button
            type="button"
            className={styles.downloadBtn}
            onClick={() => onPreviewDocument(selected)}
            title="Preview this resolution side-by-side beside the allocation form"
          >
            <HiEye /> Preview PDF
          </button>
        )}
        {selected && (
          <button type="button" className={styles.downloadBtn} onClick={handleDownload} disabled={busy}>
            <HiDownload /> {busy ? 'Opening…' : 'Download'}
          </button>
        )}
      </div>

      {selectValue === MANUAL && (
        <input
          type="text"
          className={styles.select}
          value={resolution}
          placeholder="e.g. SSG Res. No. 2026-042"
          aria-label="Resolution reference"
          onChange={(e) => onChange({ resolution: e.target.value, resolutionDocumentId: null })}
        />
      )}

      {approvedResolutions.length === 0 && (
        <p className={styles.helper}>
          No approved resolutions found in Documents yet. Approve a document labelled Resolution to link it here.
        </p>
      )}
      {dlError && <p className={styles.rowNote}>{dlError}</p>}
    </div>
  );
};

/* ──────────────────────────────────────────────────────────────
   Mini calendar: pick start then end date
   ────────────────────────────────────────────────────────────── */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const prettyDate = (s) => {
  if (!s) return 'Not set';
  const [y, m, d] = s.split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
};

export const MiniRangeCalendar = ({ startDate, endDate, onChange }) => {
  const anchor = startDate ? new Date(`${startDate}T00:00:00`) : new Date();
  const [view, setView] = useState({ y: anchor.getFullYear(), m: anchor.getMonth() });

  const first = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const today = new Date();
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());

  const shift = (delta) =>
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  const pick = (day) => {
    const value = iso(view.y, view.m, day);
    if (!startDate || (startDate && endDate)) {
      onChange({ startDate: value, endDate: '' });
    } else if (value < startDate) {
      onChange({ startDate: value, endDate: '' });
    } else {
      onChange({ startDate, endDate: value });
    }
  };

  const days =
    startDate && endDate
      ? Math.round((new Date(`${endDate}T00:00:00`) - new Date(`${startDate}T00:00:00`)) / 86400000) + 1
      : startDate
      ? 1
      : 0;

  return (
    <div className={styles.cal}>
      <div className={styles.calNav}>
        <button type="button" className={styles.iconBtn} onClick={() => shift(-1)} aria-label="Previous month">
          <HiChevronLeft />
        </button>
        <span className={styles.calMonth} aria-live="polite">
          {MONTHS[view.m]} {view.y}
        </span>
        <button type="button" className={styles.iconBtn} onClick={() => shift(1)} aria-label="Next month">
          <HiChevronRight />
        </button>
      </div>

      <div className={styles.calGrid} role="grid" aria-label="Project dates">
        {WEEKDAYS.map((w) => (
          <span key={w} className={styles.calDow} role="columnheader">{w}</span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`e${i}`} />;
          const value = iso(view.y, view.m, day);
          const isStart = value === startDate;
          const isEnd = value === endDate;
          const inRange = startDate && endDate && value > startDate && value < endDate;
          const cls = [
            styles.calDay,
            isStart || isEnd ? styles.calEdge : '',
            inRange ? styles.calRange : '',
            value === todayIso ? styles.calToday : '',
          ].join(' ');
          return (
            <button
              key={value}
              type="button"
              className={cls}
              onClick={() => pick(day)}
              aria-pressed={isStart || isEnd}
              aria-label={`${MONTHS[view.m]} ${day}, ${view.y}${isStart ? ', start date' : ''}${isEnd ? ', end date' : ''}`}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className={styles.calSummary}>
        <div>
          <span>Starts</span>
          <strong>{prettyDate(startDate)}</strong>
        </div>
        <div>
          <span>Ends</span>
          <strong>{prettyDate(endDate)}</strong>
        </div>
        <div>
          <span>Duration</span>
          <strong>{days ? `${days} day${days > 1 ? 's' : ''}` : '—'}</strong>
        </div>
        {(startDate || endDate) && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => onChange({ startDate: '', endDate: '' })}
            aria-label="Clear dates"
          >
            <HiX />
          </button>
        )}
      </div>
      <p className={styles.helper}>Click a start date, then an end date. Both are optional.</p>
    </div>
  );
};
