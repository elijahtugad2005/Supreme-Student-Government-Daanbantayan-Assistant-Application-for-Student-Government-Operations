// components/Document/AiStatusBadge.jsx
// PURPOSE: Shows whether the Gemini assistant can be used right now, and how
// much of the day's document capacity is gone.
//
// The capacity figure is an ESTIMATE built from Google's published free-tier
// limits and a count kept in this browser. It is labelled as an estimate on
// screen so it is never mistaken for a live quota readout.
import React, { useCallback, useEffect, useState } from 'react';
import { T } from '../../utils/themeStyles';
import {
  capacityLabel,
  getUsage,
  resolveAvailability,
  usagePercent,
} from '../../utils/aiCapacity';
import {
  checkAiStatus,
  onQuotaChange,
  readQuota,
  secondsUntilReset,
} from '../../services/documentAiService';
import { HiSparkles, HiChevronDown, HiChevronUp, HiX } from 'react-icons/hi';

export default function AiStatusBadge() {
  const [status, setStatus] = useState(null); // null = still checking
  const [quota, setQuota] = useState(readQuota);
  const [usage, setUsage] = useState(getUsage);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const refreshUsage = useCallback(() => setUsage(getUsage()), []);

  useEffect(() => {
    let alive = true;
    checkAiStatus().then((result) => alive && setStatus(result));
    return () => {
      alive = false;
    };
  }, []);

  // Re-check periodically so the indicator recovers by itself once the daily
  // window resets, without the user reloading the page.
  useEffect(() => {
    const timer = setInterval(() => {
      refreshUsage();
      checkAiStatus().then((result) => setStatus(result));
    }, 60_000);
    return () => clearInterval(timer);
  }, [refreshUsage]);

  useEffect(() => {
    return onQuotaChange((state) => {
      setQuota(state);
      refreshUsage();
    });
  }, [refreshUsage]);

  const waiting = secondsUntilReset(quota);

  const availability = resolveAvailability({
    // The whole probe result, not a pair of booleans: "the service could not be
    // reached" and "the service has no key" are different faults with different
    // fixes, and flattening them to booleans makes the second one get reported
    // when the first is true.
    probe: status,
    quota,
    waitSeconds: waiting || 0,
  });

  const tone =
    availability.state === 'available'
      ? { bg: T.successLight, fg: T.success, dot: T.success }
      : availability.state === 'checking'
        ? { bg: T.bgTertiary, fg: T.textSoft, dot: T.textMuted }
        : availability.state === 'limited'
          ? { bg: T.warningLight, fg: T.warning, dot: T.warning }
          : availability.state === 'unavailable'
            ? { bg: T.infoLight, fg: T.info, dot: T.info }
            : { bg: T.errorLight, fg: T.error, dot: T.error };

  const percent = usagePercent(usage);

  if (dismissed) return null;

  return (
    <div style={styles.wrap} role="status" aria-live="polite">
      <div style={styles.headerRow}>
        <span style={{ ...styles.pill, backgroundColor: tone.bg, borderColor: tone.dot }}>
          <span style={{ ...styles.dot, backgroundColor: tone.dot }} />
          {availability.label}
        </span>
        
        <div style={styles.controls}>
          <button
            onClick={() => setCollapsed(!collapsed)}
            style={styles.iconBtn}
            title={collapsed ? 'Show details' : 'Hide details'}
            aria-label={collapsed ? 'Show details' : 'Hide details'}
          >
            {collapsed ? <HiChevronDown /> : <HiChevronUp />}
          </button>
          <button
            onClick={() => setDismissed(true)}
            style={styles.iconBtn}
            title="Dismiss"
            aria-label="Dismiss status badge"
          >
            <HiX />
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          <div style={styles.capacity}>
            <div style={styles.capacityHead}>
              <span style={styles.capacityLabel}>Today: {capacityLabel(usage)}</span>
              <span style={styles.capacityPct}>{percent}%</span>
            </div>
            <div style={styles.bar}>
              <div
                style={{
                  ...styles.fill,
                  width: `${percent}%`,
                  backgroundColor: percent >= 100 ? T.error : percent >= 75 ? T.warning : T.success,
                }}
              />
            </div>
            <span style={styles.estimateNote}>
              Estimate from the free-tier limits ({'~'}15 requests/minute, 1,500/day, ~3 per
              document) and this browser's own count.
            </span>
          </div>

          {availability.reason && (
            <div style={{ ...styles.reason, color: tone.fg }}>
              <HiSparkles />{' '}
              {availability.state === 'unavailable'
                ? 'AI document analysis requires the cloud service to be deployed. Uploading, searching, and managing documents works normally.'
                : availability.reason}
              {availability.resetAt && (
                <span style={styles.resetAt}>
                  {' '}
                  Available again{' '}
                  {new Date(availability.resetAt).toLocaleString('en-PH', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'Asia/Manila',
                  })}
                  .
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles = {
  wrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.6rem',
    padding: '1rem',
    borderRadius: '0.8rem',
    backgroundColor: T.bgCard,
    border: `1px solid ${T.borderSoft}`,
    marginBottom: '1.5rem',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.8rem',
  },
  controls: {
    display: 'flex',
    gap: '0.4rem',
  },
  iconBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    color: T.textSoft,
    cursor: 'pointer',
    padding: '0.3rem',
    display: 'flex',
    alignItems: 'center',
    fontSize: '1.1rem',
    transition: 'color 0.2s ease',
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    alignSelf: 'flex-start',
    padding: '0.3rem 0.8rem',
    borderRadius: '50px',
    border: '1px solid',
    fontSize: '0.82rem',
    fontWeight: 'bold',
  },
  dot: { width: '8px', height: '8px', borderRadius: '50%' },
  capacity: { display: 'flex', flexDirection: 'column', gap: '0.3rem' },
  capacityHead: { display: 'flex', justifyContent: 'space-between', gap: '1rem' },
  capacityLabel: { color: T.text, fontSize: '0.82rem' },
  capacityPct: { color: T.textSoft, fontSize: '0.8rem' },
  bar: {
    height: '7px',
    borderRadius: '4px',
    backgroundColor: T.bgTertiary,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: '4px', transition: 'width 0.4s ease' },
  estimateNote: { color: T.textMuted, fontSize: '0.72rem' },
  reason: { fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' },
  resetAt: { color: T.textSoft },
};