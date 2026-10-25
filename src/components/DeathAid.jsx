import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/firebaseConfig';
import { useAuth } from './AuthContext/AuthContext.jsx';
import {
  DEATH_AID_COLLECTION_STATUS,
  DEATH_AID_DEBT_TYPES,
  DEATH_AID_DEBT_TYPE_LABELS,
  DEATH_AID_REMITTANCE_STATUS,
  DEATH_AID_STATUS_LABELS,
  canManageDeathAid,
} from '../utils/permissions';
import {
  attachDebtDetails,
  computeOutstanding,
  computeTotals,
  denyRemittance,
  listAuditLog,
  listCollections,
  listPendingCollections,
  listVerifiedRosters,
  recordRemittance,
  recordSectionCollection,
} from '../services/deathAidService';
import { S, T, banner as bannerStyle, statusPill } from '../utils/themeStyles';
import {
  HiClipboardCheck,
  HiExclamation,
  HiCheckCircle,
  HiCheck,
  HiX,
  HiInformationCircle,
  HiClock,
  HiBan,
  HiXCircle,
} from 'react-icons/hi';

const peso = (n) =>
  `₱${Number(n || 0).toLocaleString('en-PH', {
    minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (value) => {
  if (!value) return '—';
  const d = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const TABS = [
  { id: 'record', label: 'Record Collection' },
  { id: 'pending', label: 'Pending Verification' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'discrepancies', label: 'Discrepancies' },
  { id: 'denied', label: 'Denied / Voided' },
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'audit', label: 'Audit Trail' },
];

function DeathAid() {
  const { currentUser, userRole, userName } = useAuth();
  const isManager = canManageDeathAid({ role: userRole });
  const actor = {
    uid: currentUser?.uid,
    name: userName || currentUser?.displayName || 'Unknown',
    role: userRole,
  };

  const [tab, setTab] = useState('record');
  const [banner, setBanner] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  const say = useCallback((type, message) => setBanner({ type, message }), []);

  // Listen to pending death aid collections in real time for live indicators
  useEffect(() => {
    let alive = true;
    const q = query(
      collection(db, 'deathAidCollections'),
      where('status', '==', DEATH_AID_COLLECTION_STATUS.FOR_VERIFICATION)
    );
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        if (alive) setPendingCount(snapshot.size);
      },
      () => {
        if (alive) setPendingCount(0);
      }
    );
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  if (!isManager) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.mainTitle}>Death Aid Collection</h2>
        </div>
        <div style={styles.notice}>
          Recording a Death Aid collection is handled by SSG officers. Ask an officer to enter the
          count for your section.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerTopRow}>
          <h2 style={styles.mainTitle}>Death Aid Collection</h2>
          {pendingCount > 0 ? (
            <div style={styles.headerPendingPill} title={`${pendingCount} pending verification`}>
              <span style={styles.pulseDot} />
              <span>{pendingCount} PENDING VERIFICATION</span>
            </div>
          ) : (
            <div style={styles.headerSettledPill}>
              <HiCheckCircle style={{ fontSize: '1.05rem' }} />
              <span>REMITTANCES SETTLED</span>
            </div>
          )}
        </div>
        <p style={styles.headerSubtitle}>
          Record what a section handed in, verify remittances, and track what is still owed.
        </p>
      </div>

      {banner && (
        <div style={styles.banner(banner.type)}>{banner.message}</div>
      )}

      {/* Global pending indicator banner if user is viewing other tabs */}
      {pendingCount > 0 && tab !== 'pending' && (
        <div style={styles.pendingActionAlert}>
          <div style={styles.pendingAlertContent}>
            <span style={styles.pendingAlertIcon}>⚠️</span>
            <div>
              <strong>Action Required:</strong> There {pendingCount === 1 ? 'is' : 'are'}{' '}
              <strong>{pendingCount}</strong> pending death contribution{pendingCount === 1 ? '' : 's'} awaiting cash remittance verification.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setTab('pending')}
            style={styles.pendingAlertBtn}
          >
            Review Pending ({pendingCount}) →
          </button>
        </div>
      )}

      <div style={styles.tabBar}>
        {TABS.map((t) => {
          const isPendingTab = t.id === 'pending';
          const isActive = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{ ...styles.tabButton, ...(isActive ? styles.tabButtonActive : {}) }}
            >
              <span>{t.label}</span>
              {isPendingTab && pendingCount > 0 && (
                <span
                  style={styles.tabPendingBadge(isActive)}
                  title={`${pendingCount} pending death contributions awaiting remittance`}
                >
                  <span style={styles.tabPulseDot} />
                  {pendingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'record' && <RecordView actor={actor} say={say} />}
      {tab === 'pending' && <PendingView actor={actor} say={say} />}
      {tab === 'confirmed' && <StatusListView status={DEATH_AID_COLLECTION_STATUS.CONFIRMED} title="Confirmed Collections" say={say} />}
      {tab === 'discrepancies' && <DiscrepancyView say={say} />}
      {tab === 'denied' && (
        <StatusListView
          status={DEATH_AID_COLLECTION_STATUS.DENIED}
          title="Denied / Voided Collections"
          empty="No denied collections. Erroneous student submissions disclosed or denied by officers appear here."
          say={say}
        />
      )}
      {tab === 'outstanding' && <OutstandingView say={say} />}
      {tab === 'audit' && <AuditView say={say} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// RECORD — officer picks the section and counts the beneficiaries
// ════════════════════════════════════════════════════════════
function RecordView({ actor, say }) {
  const [rosters, setRosters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rosterId, setRosterId] = useState('');
  const [contribution, setContribution] = useState('1');
  const [beneficiaries, setBeneficiaries] = useState('');
  const [submittedByName, setSubmittedByName] = useState('');
  const [debtRecords, setDebtRecords] = useState([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRosters(await listVerifiedRosters());
    } catch (error) {
      say('error', `Could not load sections: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [say]);

  useEffect(() => {
    load();
  }, [load]);

  const roster = rosters.find((r) => r.rosterId === rosterId) || null;

  const totals = useMemo(
    () => computeTotals(roster?.studentCount ?? 0, contribution, beneficiaries),
    [roster, contribution, beneficiaries]
  );

  const pick = (id) => {
    setRosterId(id);
    const found = rosters.find((r) => r.rosterId === id);
    // Enrolling the section's students as debt rows, pre-typed so the officer
    // only has to correct the ones who actually paid.
    setDebtRecords(
      Array.from({ length: found?.studentCount ?? 0 }, (_, i) => ({
        studentName: found?.students?.[i]?.name || '',
        debtType: DEATH_AID_DEBT_TYPES.NAMED,
        note: '',
      }))
    );
    setBeneficiaries('');
  };

  const addDebt = () =>
    setDebtRecords((prev) => [
      ...prev,
      { studentName: '', debtType: DEATH_AID_DEBT_TYPES.ANONYMOUS, note: '' },
    ]);

  const updateDebt = (i, patch) =>
    setDebtRecords((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const removeDebt = (i) => setDebtRecords((prev) => prev.filter((_, idx) => idx !== i));

  // Debt rows are trimmed to the number actually owed, so extra rows the officer
  // added while counting never contradict the count.
  const effectiveDebts = debtRecords.slice(0, totals.debtCount);

  const handleSave = async () => {
    if (!roster) return say('error', 'Choose a section first.');
    if (beneficiaries === '' || Number.isNaN(Number(beneficiaries))) {
      return say('error', 'Enter how many beneficiaries handed in.');
    }
    setSaving(true);
    try {
      const id = await recordSectionCollection({
        roster,
        contribution: Number(contribution) || 0,
        beneficiaries: Number(beneficiaries),
        debtRecords: effectiveDebts,
        submittedByName,
        recorder: actor,
      });
      say(
        'success',
        `${id} recorded: ${totals.beneficiaryCount} beneficiary(ies), ${peso(totals.collectedAmount)} collected, ${totals.debtCount} student(s) owing ${peso(totals.debtAmount)}.`
      );
      setRosterId('');
      setBeneficiaries('');
      setSubmittedByName('');
      setDebtRecords([]);
    } catch (error) {
      say('error', error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.formWrapper}>
      <h3 style={styles.sectionTitle}>Record Collection</h3>

      {loading ? (
        <p style={styles.helperText}>Loading sections…</p>
      ) : rosters.length === 0 ? (
        <p style={styles.helperText}>No verified rosters yet. A section needs one before its collection can be recorded.</p>
      ) : (
        <>
          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Section</label>
              <select value={rosterId} onChange={(e) => pick(e.target.value)} style={styles.select}>
                <option value="">Select a section</option>
                {rosters.map((r) => (
                  <option key={r.rosterId} value={r.rosterId}>
                    {r.section} · {r.program} · {r.studentCount} enrolled
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Contribution per beneficiary (₱)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={contribution}
                onChange={(e) => setContribution(e.target.value)}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Beneficiaries who paid</label>
              <input
                type="number"
                min="0"
                step="1"
                value={beneficiaries}
                onChange={(e) => setBeneficiaries(e.target.value)}
                placeholder="e.g., 39"
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Brought in by (optional)</label>
              <input
                type="text"
                value={submittedByName}
                onChange={(e) => setSubmittedByName(e.target.value)}
                placeholder="Student's name"
                style={styles.input}
              />
            </div>
          </div>

          {roster && (
            <>
              <div style={styles.summaryGrid}>
                <SummaryTile label="Enrolled" value={String(totals.enrolledCount)} />
                <SummaryTile label="Beneficiaries" value={String(totals.beneficiaryCount)} tone={T.success} />
                <SummaryTile label="Collected" value={peso(totals.collectedAmount)} />
                <SummaryTile label="Expected" value={peso(totals.expectedCollection)} />
                <SummaryTile label="Owing" value={`${totals.debtCount} · ${peso(totals.debtAmount)}`} tone={T.warning} />
              </div>

              {totals.wasClamped && (
                <p style={styles.warning}>
                  That is more beneficiaries than the {roster.studentCount} students enrolled on the
                  roster, so it was counted as {roster.studentCount}.
                </p>
              )}

              <div style={styles.debtHeader}>
                <div>
                  <h4 style={styles.debtTitle}>Who is owing</h4>
                  <p style={styles.helperText}>
                    Optional. Leave a row blank or mark it “not identified” if nobody was around to
                    ask. Names can be filled in later.
                  </p>
                </div>
                <button type="button" onClick={addDebt} style={styles.secondaryButton}>
                  + Add row
                </button>
              </div>

              {totals.debtCount === 0 ? (
                <p style={styles.helperText}>Everyone in this section paid. Nothing is outstanding.</p>
              ) : (
                <div style={styles.tableWrapper}>
                  <table style={styles.table}>
                    <thead>
                      <tr style={styles.tableHeaderRow}>
                        <th style={styles.tableHeader}>Student</th>
                        <th style={styles.tableHeader}>Reason</th>
                        <th style={styles.tableHeader}>Note</th>
                        <th style={styles.tableHeader}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {effectiveDebts.map((row, i) => (
                        // Keyed by position: the row count changes as the
                        // beneficiary count is edited.
                        <tr key={i} style={styles.tableRow}>
                          <td style={styles.tableCell}>
                            <input
                              type="text"
                              value={row.studentName}
                              disabled={row.debtType !== DEATH_AID_DEBT_TYPES.NAMED}
                              onChange={(e) => updateDebt(i, { studentName: e.target.value })}
                              placeholder="Unknown"
                              style={styles.input}
                            />
                          </td>
                          <td style={styles.tableCell}>
                            <select
                              value={row.debtType}
                              onChange={(e) => updateDebt(i, { debtType: e.target.value })}
                              style={styles.select}
                            >
                              {Object.entries(DEATH_AID_DEBT_TYPE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={styles.tableCell}>
                            <input
                              type="text"
                              value={row.note}
                              onChange={(e) => updateDebt(i, { note: e.target.value })}
                              placeholder="optional"
                              style={styles.input}
                            />
                          </td>
                          <td style={styles.tableCell}>
                            <button type="button" onClick={() => removeDebt(i)} style={styles.linkButton}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={styles.buttonGroup}>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !roster}
                  style={{ ...styles.submitButton, ...(saving ? styles.disabled : {}) }}
                >
                  {saving ? 'Saving…' : 'Record Collection'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone }) {
  return (
    <div style={styles.summaryTile}>
      <span style={styles.summaryLabel}>{label}</span>
      <span style={{ ...styles.summaryValue, ...(tone ? { color: tone } : {}) }}>{value}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// PENDING VERIFICATION
// ════════════════════════════════════════════════════════════
const DENIAL_REASONS = [
  'Student input mistake: Incorrect number of paying students / beneficiaries',
  'Student input mistake: Wrong section or academic program selected',
  'Student input mistake: Duplicate entry (already filed earlier)',
  'Student input mistake: Incorrect contribution rate entered',
  'Cash not remitted: Student / mayor cancelled or withdrew handover',
  'Calculation or clerical error by collector',
  'Other student input mistake (please specify below)',
];

function PendingView({ actor, say }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [amounts, setAmounts] = useState({});
  const [notes, setNotes] = useState({});
  const [formErrors, setFormErrors] = useState({});
  const [busyId, setBusyId] = useState('');
  const [doubleCheckTarget, setDoubleCheckTarget] = useState(null);
  const [doubleCheckConfirmed, setDoubleCheckConfirmed] = useState(false);
  const inputRefs = useRef({});

  // Deny / Disclose state for student input mistakes
  const [denyTarget, setDenyTarget] = useState(null);
  const [denyReason, setDenyReason] = useState(DENIAL_REASONS[0]);
  const [denyCustomReason, setDenyCustomReason] = useState('');
  const [denyNote, setDenyNote] = useState('');
  const [denyError, setDenyError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listPendingCollections());
    } catch (error) {
      say('error', `Could not load pending collections: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [say]);

  useEffect(() => {
    load();
  }, [load]);

  // Form Validation & Double-Check initiator
  const handleInitiateRemittance = (record) => {
    const rawVal = amounts[record.collectionId];

    // Concept: Form validation / required-field check
    // If blank or empty, warn or remind the user to fill up the form
    if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
      setFormErrors((prev) => ({
        ...prev,
        [record.collectionId]: 'Please fill up the form: enter the amount received in cash before remitting.',
      }));
      say('error', 'Please fill up the form: Enter the received remittance amount.');
      if (inputRefs.current[record.collectionId]) {
        inputRefs.current[record.collectionId].focus();
      }
      return;
    }

    const rec = Number(rawVal);
    if (!Number.isFinite(rec) || rec < 0) {
      setFormErrors((prev) => ({
        ...prev,
        [record.collectionId]: 'Please enter a valid amount (₱0.00 or higher).',
      }));
      say('error', 'Please fill up the form with a valid number.');
      if (inputRefs.current[record.collectionId]) {
        inputRefs.current[record.collectionId].focus();
      }
      return;
    }

    if (record.recordedByUid === actor.uid) {
      say('error', 'Segregation of duties: You recorded this collection, so another officer must verify and accept it.');
      return;
    }

    // Form is complete and valid: clear errors and open Double-Check Indicator Modal
    setFormErrors((prev) => ({ ...prev, [record.collectionId]: '' }));
    setDoubleCheckConfirmed(false);
    setDoubleCheckTarget(record);
  };

  // Final confirmation inside Double-Check modal
  const handleConfirmDoubleCheck = async () => {
    if (!doubleCheckTarget) return;
    const record = doubleCheckTarget;
    setBusyId(record.collectionId);
    try {
      const result = await recordRemittance({
        collectionId: record.collectionId,
        amountReceived: Number(amounts[record.collectionId]),
        officer: actor,
        note: notes[record.collectionId] || '',
      });
      say(
        result.status === DEATH_AID_REMITTANCE_STATUS.CONFIRMED ? 'success' : 'error',
        result.status === DEATH_AID_REMITTANCE_STATUS.CONFIRMED
          ? `${record.collectionId} confirmed — ${peso(result.reportedAmount)} reported and received.`
          : `${record.collectionId} flagged: reported ${peso(result.reportedAmount)}, received ${peso(result.amountReceived)} (${result.difference > 0 ? '+' : ''}${peso(result.difference)}).`
      );
      setDoubleCheckTarget(null);
      await load();
    } catch (error) {
      say('error', error.message);
    } finally {
      setBusyId('');
    }
  };

  // Deny / Disclose handlers
  const handleInitiateDeny = (record) => {
    setDenyTarget(record);
    setDenyReason(DENIAL_REASONS[0]);
    setDenyCustomReason('');
    setDenyNote('');
    setDenyError('');
  };

  const handleConfirmDeny = async () => {
    if (!denyTarget) return;

    const finalReason = denyReason.startsWith('Other')
      ? denyCustomReason.trim()
      : denyReason.trim();

    if (!finalReason) {
      setDenyError('Please enter a specific reason for denying / disclosing this remittance.');
      return;
    }

    setBusyId(denyTarget.collectionId);
    try {
      await denyRemittance({
        collectionId: denyTarget.collectionId,
        officer: actor,
        reason: finalReason,
        note: denyNote.trim(),
      });
      say(
        'info',
        `Remittance for ${denyTarget.collectionId} (${denyTarget.section}) was denied / disclosed: "${finalReason}". This record is marked as voided.`
      );
      setDenyTarget(null);
      await load();
    } catch (error) {
      say('error', `Could not deny remittance: ${error.message}`);
    } finally {
      setBusyId('');
    }
  };

  if (loading) return <Loading label="Loading pending collections…" />;

  const modalReceived = doubleCheckTarget ? Number(amounts[doubleCheckTarget.collectionId] || 0) : 0;
  const modalDiff = doubleCheckTarget
    ? Math.round((modalReceived - doubleCheckTarget.collectedAmount) * 100) / 100
    : 0;

  return (
    <div style={styles.formWrapper}>
      <div style={styles.sectionHeaderRow}>
        <h3 style={styles.sectionTitle}>Pending Verification</h3>
        {rows.length > 0 && (
          <span style={styles.pendingHeaderBadge} title={`${rows.length} pending collections`}>
            <span style={styles.pulseDot} />
            {rows.length} Awaiting Remittance
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p style={styles.helperText}>No collections are waiting for a remittance.</p>
      ) : (
        rows.map((c) => {
          const rec = Number(amounts[c.collectionId]);
          const diff = Number.isFinite(rec) ? Math.round((rec - c.collectedAmount) * 100) / 100 : null;
          const hasError = !!formErrors[c.collectionId];

          return (
            <div key={c.collectionId} style={styles.reviewCard}>
              <div style={styles.reviewHeader}>
                <div>
                  <strong style={styles.reviewTitle}>
                    {c.collectionId} — {c.section}
                  </strong>
                  <p style={styles.helperText}>
                    {c.program} · recorded by {c.recordedByName} · {formatDate(c.submittedAt)}
                  </p>
                  <p style={styles.helperText}>
                    {c.beneficiaryCount} of {c.enrolledCount} paid · {c.debtCount} owing (
                    {c.unidentifiedDebtCount || 0} unidentified) · brought in by{' '}
                    {c.submittedByName || 'Not specified'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={styles.badgePendingAlert}>
                    <span style={styles.pulseDot} />
                    Pending Remittance
                  </span>
                  <StatusBadge status={c.status} />
                </div>
              </div>

              <div style={styles.moneyRow}>
                <div style={styles.moneyBox}>
                  <span style={styles.summaryLabel}>Reported</span>
                  <span style={styles.moneyValue}>{peso(c.collectedAmount)}</span>
                </div>
                <div style={styles.moneyBox}>
                  <span style={styles.summaryLabel}>
                    Received <span style={{ color: T.error }}>*</span>
                  </span>
                  <input
                    ref={(el) => (inputRefs.current[c.collectionId] = el)}
                    type="number"
                    min="0"
                    step="0.01"
                    value={amounts[c.collectionId] ?? ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAmounts((p) => ({ ...p, [c.collectionId]: val }));
                      if (formErrors[c.collectionId] && val.trim() !== '') {
                        setFormErrors((p) => ({ ...p, [c.collectionId]: '' }));
                      }
                    }}
                    placeholder="0.00 (Required)"
                    style={hasError ? styles.inputError : styles.input}
                  />
                </div>
                <div style={styles.moneyBox}>
                  <span style={styles.summaryLabel}>Difference</span>
                  <span style={{ ...styles.moneyValue, color: diff === 0 ? T.success : T.warning }}>
                    {diff === null ? '—' : `${diff > 0 ? '+' : ''}${peso(diff)}`}
                  </span>
                </div>
              </div>

              {/* Form Validation Warning Notice if Blank / Incomplete */}
              {hasError && (
                <div style={styles.inlineWarningAlert}>
                  <HiExclamation style={{ fontSize: '1.25rem', color: T.error, flexShrink: 0 }} />
                  <div>
                    <strong>Fill up the form:</strong> {formErrors[c.collectionId]}
                  </div>
                </div>
              )}

              <div style={styles.formGroup}>
                <label style={styles.label}>Note (optional)</label>
                <input
                  type="text"
                  value={notes[c.collectionId] ?? ''}
                  onChange={(e) => setNotes((p) => ({ ...p, [c.collectionId]: e.target.value }))}
                  placeholder="Reason or physical receipt reference"
                  style={styles.input}
                />
              </div>

              <div style={styles.buttonGroup}>
                <button
                  type="button"
                  onClick={() => handleInitiateRemittance(c)}
                  disabled={busyId === c.collectionId}
                  style={styles.verifyButton}
                  title="Double-check and accept remittance"
                >
                  <HiClipboardCheck style={{ fontSize: '1.1rem', marginRight: '0.4rem', verticalAlign: 'middle' }} />
                  {busyId === c.collectionId ? 'Recording…' : 'Accept Remittance'}
                </button>

                <button
                  type="button"
                  onClick={() => handleInitiateDeny(c)}
                  disabled={busyId === c.collectionId}
                  style={styles.denyButton}
                  title="Deny or disclose remittance due to student input mistakes"
                >
                  <HiBan style={{ fontSize: '1.05rem', marginRight: '0.35rem', verticalAlign: 'middle' }} />
                  Deny / Disclose
                </button>

                {c.recordedByUid === actor.uid && (
                  <span style={styles.warningInline}>
                    🔒 You recorded this one, so another officer must accept the remittance.
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* ── DOUBLE-CHECK REMITTANCE MODAL ── */}
      {doubleCheckTarget && (
        <div style={styles.modalBackdrop} onClick={() => setDoubleCheckTarget(null)}>
          <div
            style={styles.modalCard}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="double-check-title"
          >
            <div style={styles.modalHeader}>
              <div>
                <div style={styles.modalTitleRow}>
                  <HiClipboardCheck style={{ fontSize: '1.4rem', color: T.accent }} />
                  <h4 id="double-check-title" style={styles.modalTitle}>
                    Double-Check Remittance
                  </h4>
                </div>
                <p style={styles.modalSubtitle}>
                  Carefully double-check the physical cash against the reported amount before finalizing.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDoubleCheckTarget(null)}
                style={styles.modalCloseBtn}
                aria-label="Close"
              >
                <HiX />
              </button>
            </div>

            <div style={styles.modalBody}>
              {/* Section Details */}
              <div style={styles.modalSectionBanner}>
                <h5 style={styles.modalSectionTitle}>
                  {doubleCheckTarget.section} · {doubleCheckTarget.program}
                </h5>
                <p style={styles.modalSectionMeta}>
                  Collection ID: <strong>{doubleCheckTarget.collectionId}</strong> | Brought in by:{' '}
                  <strong>{doubleCheckTarget.submittedByName || 'Not specified'}</strong>
                </p>
              </div>

              {/* Financial Double-Check Breakdown */}
              <div style={styles.modalCompareGrid}>
                <div style={styles.modalCompareBox}>
                  <span style={styles.modalCompareLabel}>Reported Collection</span>
                  <span style={styles.modalCompareValue}>{peso(doubleCheckTarget.collectedAmount)}</span>
                  <span style={styles.modalCompareSub}>
                    {doubleCheckTarget.beneficiaryCount} student(s) paid
                  </span>
                </div>

                <div style={styles.modalCompareBox}>
                  <span style={styles.modalCompareLabel}>Cash Received</span>
                  <span style={{ ...styles.modalCompareValue, color: T.accent }}>
                    {peso(modalReceived)}
                  </span>
                  <span style={styles.modalCompareSub}>Physically counted</span>
                </div>
              </div>

              {/* Double Check Match or Discrepancy Indicator */}
              <div style={styles.modalIndicatorBox(modalDiff === 0 ? 'success' : 'warning')}>
                <div style={styles.modalIndicatorTitle(modalDiff === 0 ? 'success' : 'warning')}>
                  {modalDiff === 0 ? (
                    <>
                      <HiCheckCircle style={{ fontSize: '1.25rem' }} />
                      <span>Balanced — Exact Match (₱0.00 difference)</span>
                    </>
                  ) : (
                    <>
                      <HiExclamation style={{ fontSize: '1.25rem' }} />
                      <span>
                        Discrepancy Detected:{' '}
                        {modalDiff > 0 ? `+${peso(modalDiff)} (Surplus)` : `-${peso(Math.abs(modalDiff))} (Shortage)`}
                      </span>
                    </>
                  )}
                </div>
                <p style={styles.modalIndicatorDesc}>
                  {modalDiff === 0
                    ? 'The cash counted matches the reported amount. This collection will be officially confirmed.'
                    : 'The cash counted does NOT match what was reported. This will be flagged under Discrepancies and permanently recorded in the audit trail.'}
                </p>
              </div>

              {/* Remittance Note */}
              {notes[doubleCheckTarget.collectionId] && (
                <div style={styles.modalNoteBox}>
                  <span style={styles.modalCompareLabel}>Remittance Note</span>
                  <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: T.text }}>
                    "{notes[doubleCheckTarget.collectionId]}"
                  </p>
                </div>
              )}

              {/* Officer Audit Footnote */}
              <p style={{ margin: 0, fontSize: '0.78rem', color: T.textMuted }}>
                Verifying Officer: <strong>{actor.name}</strong> ({actor.role})
              </p>

              {/* Double-Check Confirmation Checkbox Gate */}
              <label style={styles.modalDoubleCheckContainer}>
                <input
                  type="checkbox"
                  id="double-check-confirm-input"
                  checked={doubleCheckConfirmed}
                  onChange={(e) => setDoubleCheckConfirmed(e.target.checked)}
                  style={styles.modalDoubleCheckCheckbox}
                />
                <div style={styles.modalDoubleCheckText}>
                  <strong>Double-Check Confirmation:</strong> I confirm that I have physically counted{' '}
                  <strong>{peso(modalReceived)}</strong> in cash for section{' '}
                  <strong>{doubleCheckTarget.section}</strong> and verified this remittance.
                </div>
              </label>
            </div>

            <div style={styles.modalFooter}>
              <button
                type="button"
                onClick={() => setDoubleCheckTarget(null)}
                style={styles.secondaryButton}
              >
                Cancel / Edit Form
              </button>
              <button
                type="button"
                onClick={handleConfirmDoubleCheck}
                disabled={!doubleCheckConfirmed || busyId === doubleCheckTarget.collectionId}
                style={{
                  ...styles.verifyButton,
                  ...(!doubleCheckConfirmed ? styles.disabled : {}),
                }}
              >
                <HiCheck style={{ fontSize: '1.1rem', marginRight: '0.3rem', verticalAlign: 'middle' }} />
                {busyId === doubleCheckTarget.collectionId ? 'Recording…' : 'Confirm & Record Remittance'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DENY / DISCLOSE REMITTANCE MODAL ── */}
      {denyTarget && (
        <div style={styles.modalBackdrop} onClick={() => setDenyTarget(null)}>
          <div
            style={styles.modalCard}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="deny-modal-title"
          >
            <div style={styles.modalHeader}>
              <div>
                <div style={styles.modalTitleRow}>
                  <HiBan style={{ fontSize: '1.4rem', color: T.error }} />
                  <h4 id="deny-modal-title" style={{ ...styles.modalTitle, color: T.error }}>
                    Deny / Disclose Remittance
                  </h4>
                </div>
                <p style={styles.modalSubtitle}>
                  Disclose student input mistakes or void erroneous filings so they do not corrupt debt balances.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDenyTarget(null)}
                style={styles.modalCloseBtn}
                aria-label="Close"
              >
                <HiX />
              </button>
            </div>

            <div style={styles.modalBody}>
              {/* Record Summary */}
              <div style={styles.modalSectionBanner}>
                <h5 style={styles.modalSectionTitle}>
                  {denyTarget.section} · {denyTarget.program}
                </h5>
                <p style={styles.modalSectionMeta}>
                  Collection ID: <strong>{denyTarget.collectionId}</strong> | Reported Amount:{' '}
                  <strong>{peso(denyTarget.collectedAmount)}</strong> ({denyTarget.beneficiaryCount} of{' '}
                  {denyTarget.enrolledCount} students)
                </p>
                <p style={{ ...styles.modalSectionMeta, marginTop: '0.2rem' }}>
                  Brought in by: <strong>{denyTarget.submittedByName || 'Not specified'}</strong> | Recorded by:{' '}
                  <strong>{denyTarget.recordedByName}</strong>
                </p>
              </div>

              {/* Reason Selector */}
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  Reason for Denial / Disclosure <span style={{ color: T.error }}>*</span>
                </label>
                <select
                  value={denyReason}
                  onChange={(e) => {
                    setDenyReason(e.target.value);
                    if (denyError) setDenyError('');
                  }}
                  style={styles.select}
                >
                  {DENIAL_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {/* Custom reason input if "Other" */}
              {denyReason.startsWith('Other') && (
                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    Specify Student Input Mistake <span style={{ color: T.error }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={denyCustomReason}
                    onChange={(e) => {
                      setDenyCustomReason(e.target.value);
                      if (denyError) setDenyError('');
                    }}
                    placeholder="e.g. Student typed 40 beneficiaries instead of 30"
                    style={denyError ? styles.inputError : styles.input}
                    autoFocus
                  />
                </div>
              )}

              {/* Error Notice */}
              {denyError && (
                <div style={styles.inlineWarningAlert}>
                  <HiExclamation style={{ fontSize: '1.2rem', color: T.error, flexShrink: 0 }} />
                  <div>{denyError}</div>
                </div>
              )}

              {/* Additional Remarks */}
              <div style={styles.formGroup}>
                <label style={styles.label}>Additional Remarks / Note for Audit Trail (Optional)</label>
                <textarea
                  rows={2}
                  value={denyNote}
                  onChange={(e) => setDenyNote(e.target.value)}
                  placeholder="e.g. Confirmed with Mayor; instructed to file new submission with corrected roster count."
                  style={{ ...styles.input, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>

              {/* Explanatory Notice */}
              <div style={styles.denyNoticeCard}>
                <HiInformationCircle style={{ fontSize: '1.3rem', color: T.textSoft, flexShrink: 0 }} />
                <p style={{ margin: 0, fontSize: '0.8rem', color: T.textSoft, lineHeight: 1.45 }}>
                  <strong>How this works:</strong> Denying this remittance marks the collection as <strong>VOIDED</strong>. It will be excluded from the section's outstanding debt balance, correcting the student's input mistake, and permanently logged in the audit trail.
                </p>
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button
                type="button"
                onClick={() => setDenyTarget(null)}
                style={styles.secondaryButton}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeny}
                disabled={busyId === denyTarget.collectionId}
                style={{
                  ...styles.denyConfirmButton,
                  ...(busyId === denyTarget.collectionId ? styles.disabled : {}),
                }}
              >
                <HiBan style={{ fontSize: '1.1rem', marginRight: '0.35rem', verticalAlign: 'middle' }} />
                {busyId === denyTarget.collectionId ? 'Denying…' : 'Confirm Denial / Void'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
function StatusListView({ status, title, empty, say }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await listCollections({ status });
        if (alive) setRows(list);
      } catch (error) {
        if (alive) say('error', `Could not load: ${error.message}`);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [status, say]);

  return (
    <div style={styles.formWrapper}>
      <h3 style={styles.sectionTitle}>{title}</h3>
      <CollectionTable rows={rows} loading={loading} empty={empty || "Nothing here yet."} showDebts />
    </div>
  );
}

function DiscrepancyView({ say }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await listCollections({ status: DEATH_AID_COLLECTION_STATUS.DISCREPANCY });
        if (alive) setRows(list);
      } catch (error) {
        if (alive) say('error', `Could not load discrepancies: ${error.message}`);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [say]);

  if (loading) return <Loading label="Loading…" />;

  return (
    <div style={styles.formWrapper}>
      <h3 style={styles.sectionTitle}>Discrepancies</h3>
      <CollectionTable rows={rows} loading={false} empty="No discrepancies — reported and received always match." />
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// OUTSTANDING — replace semantics: latest filing per section
// ════════════════════════════════════════════════════════════
function OutstandingView({ say }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState('');
  const [draft, setDraft] = useState([]);
  const { currentUser, userRole, userName } = useAuth();

  const actor = {
    uid: currentUser?.uid,
    name: userName || currentUser?.displayName || 'Unknown',
    role: userRole,
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = computeOutstanding(await listCollections());
        if (alive) setRows(list);
      } catch (error) {
        if (alive) say('error', `Could not compute outstanding: ${error.message}`);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [say]);

  const totalStudents = rows.reduce((s, r) => s + r.debtCount, 0);
  const totalAmount = rows.reduce((s, r) => s + r.debtAmount, 0);

  const startEdit = (row) => {
    setEditing(row.collectionId);
    setDraft(
      Array.from({ length: row.debtCount }, (_, i) =>
        row.debtRecords[i] || {
          studentName: '',
          debtType: DEATH_AID_DEBT_TYPES.ANONYMOUS,
          note: '',
        }
      )
    );
  };

  const saveEdit = async (collectionId) => {
    try {
      await attachDebtDetails({ collectionId, debtRecords: draft, actor });
      say('success', 'Debtor names recorded. The timestamp was added automatically.');
      setEditing('');
      setRows(computeOutstanding(await listCollections()));
    } catch (error) {
      say('error', error.message);
    }
  };

  return (
    <div style={styles.formWrapper}>
      <h3 style={styles.sectionTitle}>Outstanding Contributions</h3>

      <div style={styles.summaryGrid}>
        <SummaryTile label="Sections" value={String(rows.length)} />
        <SummaryTile label="Students Owing" value={String(totalStudents)} tone={T.warning} />
        <SummaryTile label="Outstanding" value={peso(totalAmount)} />
      </div>

      <p style={styles.helperText}>
        The most recent collection for each section is the current balance. Earlier collections are
        kept in the audit trail.
      </p>

      {loading ? (
        <p style={styles.helperText}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={styles.helperText}>Nothing outstanding.</p>
      ) : (
        rows.map((r) => (
          <div key={r.sectionKey} style={styles.reviewCard}>
            <div style={styles.reviewHeader}>
              <div>
                <strong style={styles.reviewTitle}>{r.section}</strong>
                <p style={styles.helperText}>
                  {r.program} · {r.collectionId} · {formatDate(r.recordedAt)}
                </p>
              </div>
              <span style={styles.badgeWarning}>
                {r.debtCount} owing · {peso(r.debtAmount)}
              </span>
            </div>

            {r.debtCount === 0 ? (
              <p style={styles.helperText}>This section is fully paid.</p>
            ) : editing === r.collectionId ? (
              <>
                <div style={styles.tableWrapper}>
                  <table style={styles.table}>
                    <thead>
                      <tr style={styles.tableHeaderRow}>
                        <th style={styles.tableHeader}>Student</th>
                        <th style={styles.tableHeader}>Reason</th>
                        <th style={styles.tableHeader}>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.map((row, i) => (
                        <tr key={i} style={styles.tableRow}>
                          <td style={styles.tableCell}>
                            <input
                              type="text"
                              value={row.studentName}
                              disabled={row.debtType !== DEATH_AID_DEBT_TYPES.NAMED}
                              onChange={(e) =>
                                setDraft((p) =>
                                  p.map((r2, idx) => (idx === i ? { ...r2, studentName: e.target.value } : r2))
                                )
                              }
                              placeholder="Unknown"
                              style={styles.input}
                            />
                          </td>
                          <td style={styles.tableCell}>
                            <select
                              value={row.debtType}
                              onChange={(e) =>
                                setDraft((p) =>
                                  p.map((r2, idx) => (idx === i ? { ...r2, debtType: e.target.value } : r2))
                                )
                              }
                              style={styles.select}
                            >
                              {Object.entries(DEATH_AID_DEBT_TYPE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td style={styles.tableCell}>
                            <input
                              type="text"
                              value={row.note}
                              onChange={(e) =>
                                setDraft((p) => p.map((r2, idx) => (idx === i ? { ...r2, note: e.target.value } : r2)))
                              }
                              placeholder="optional"
                              style={styles.input}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={styles.buttonGroup}>
                  <button type="button" onClick={() => saveEdit(r.collectionId)} style={styles.verifyButton}>
                    Save names
                  </button>
                  <button type="button" onClick={() => setEditing('')} style={styles.secondaryButton}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                {r.debtRecords.length === 0 ? (
                  <p style={styles.helperText}>
                    {r.debtCount} student(s) owing, none identified yet.
                  </p>
                ) : (
                  <div style={styles.tableWrapper}>
                    <table style={styles.table}>
                      <thead>
                        <tr style={styles.tableHeaderRow}>
                          <th style={styles.tableHeader}>Student</th>
                          <th style={styles.tableHeader}>Reason</th>
                          <th style={styles.tableHeader}>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.debtRecords.map((d, i) => (
                          <tr key={i} style={styles.tableRow}>
                            <td style={styles.tableCell}>{d.studentName || '—'}</td>
                            <td style={styles.tableCell}>
                              {DEATH_AID_DEBT_TYPE_LABELS[d.debtType] || d.debtType}
                              {d.note ? ` (${d.note})` : ''}
                            </td>
                            <td style={styles.tableCell}>{peso(d.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {r.unidentifiedCount > 0 && (
                  <p style={styles.helperText}>
                    {r.unidentifiedCount} of {r.debtCount} not identified yet.
                  </p>
                )}
                <div style={styles.buttonGroup}>
                  <button type="button" onClick={() => startEdit(r)} style={styles.secondaryButton}>
                    Add or correct names
                  </button>
                </div>
              </>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// AUDIT
// ════════════════════════════════════════════════════════════
function AuditView({ say }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await listAuditLog();
        if (alive) setRows(list);
      } catch (error) {
        if (alive) say('error', `Could not load the audit trail: ${error.message}`);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [say]);

  const ids = Array.from(new Set(rows.map((r) => r.collectionId))).filter(Boolean);
  const visible = filter ? rows.filter((r) => r.collectionId === filter) : rows;

  return (
    <div style={styles.formWrapper}>
      <h3 style={styles.sectionTitle}>Audit Trail</h3>

      <div style={styles.formGroup}>
        <label style={styles.label}>Filter by Collection ID</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={styles.select}>
          <option value="">All collections</option>
          {ids.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p style={styles.helperText}>Loading…</p>
      ) : visible.length === 0 ? (
        <p style={styles.helperText}>No audit entries yet.</p>
      ) : (
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.tableHeaderRow}>
                <th style={styles.tableHeader}>Collection</th>
                <th style={styles.tableHeader}>Action</th>
                <th style={styles.tableHeader}>Who</th>
                <th style={styles.tableHeader}>When</th>
                <th style={styles.tableHeader}>Collected</th>
                <th style={styles.tableHeader}>Received</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id} style={styles.tableRow}>
                  <td style={styles.tableCell}>{a.collectionId}</td>
                  <td style={styles.tableCell}>{String(a.action).replace(/_/g, ' ')}</td>
                  <td style={styles.tableCell}>
                    {a.actorName} <span style={styles.muted}>({a.actorRole})</span>
                  </td>
                  <td style={styles.tableCell}>{formatDate(a.at)}</td>
                  <td style={styles.tableCell}>
                    {a.collectedAmount === undefined ? '—' : peso(a.collectedAmount)}
                  </td>
                  <td style={styles.tableCell}>
                    {a.amountReceived === undefined ? '—' : peso(a.amountReceived)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CollectionTable({ rows, loading, empty, showDebts = false }) {
  if (loading) return <p style={styles.helperText}>Loading…</p>;
  if (rows.length === 0) return <p style={styles.helperText}>{empty}</p>;

  return (
    <div style={styles.tableWrapper}>
      <table style={styles.table}>
        <thead>
          <tr style={styles.tableHeaderRow}>
            <th style={styles.tableHeader}>Collection</th>
            <th style={styles.tableHeader}>Section</th>
            <th style={styles.tableHeader}>Recorded</th>
            <th style={styles.tableHeader}>Beneficiaries</th>
            <th style={styles.tableHeader}>Collected</th>
            {showDebts && <th style={styles.tableHeader}>Owing</th>}
            <th style={styles.tableHeader}>Received</th>
            <th style={styles.tableHeader}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.collectionId} style={styles.tableRow}>
              <td style={styles.tableCell}>
                <strong>{c.collectionId}</strong>
                {c.denialReason && (
                  <div style={styles.denialReasonNote}>
                    <span style={{ fontWeight: 700, color: T.error }}>Denied:</span> {c.denialReason}
                    {c.denialNote && <span style={styles.muted}> ({c.denialNote})</span>}
                    {c.deniedByName && <span style={styles.muted}> · by {c.deniedByName}</span>}
                  </div>
                )}
              </td>
              <td style={styles.tableCell}>{c.section}</td>
              <td style={styles.tableCell}>{formatDate(c.submittedAt)}</td>
              <td style={styles.tableCell}>
                {c.beneficiaryCount}/{c.enrolledCount}
              </td>
              <td style={styles.tableCell}>{peso(c.collectedAmount)}</td>
              {showDebts && (
                <td style={styles.tableCell}>
                  {c.debtCount} · {peso(c.debtAmount)}
                </td>
              )}
              <td style={styles.tableCell}>
                {c.amountReceived === null || c.amountReceived === undefined ? '—' : peso(c.amountReceived)}
              </td>
              <td style={styles.tableCell}>
                <StatusBadge status={c.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }) {
  const label = DEATH_AID_STATUS_LABELS[status] || String(status).replace(/_/g, ' ');
  const tone =
    status === DEATH_AID_COLLECTION_STATUS.CONFIRMED
      ? 'success'
      : status === DEATH_AID_COLLECTION_STATUS.DISCREPANCY
        ? 'warning'
        : status === DEATH_AID_COLLECTION_STATUS.DENIED
          ? 'error'
          : 'info';
  return <span style={statusPill(tone)}>{label}</span>;
}

function Loading({ label }) {
  return (
    <div style={styles.formWrapper}>
      <p style={styles.helperText}>{label}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Styles
//
// Built from the shared theme tokens instead of fixed hex values, so this
// screen re-colours itself the moment the theme changes. Only tokens defined by
// all three themes are referenced — see utils/themeStyles.js.
// ════════════════════════════════════════════════════════════
const styles = {
  container: S.page,
  header: { marginBottom: '1.5rem' },
  headerTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.8rem',
    marginBottom: '0.3rem',
  },
  mainTitle: S.heading,
  headerSubtitle: S.subheading,
  headerPendingPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    padding: '0.35rem 0.85rem',
    borderRadius: '9999px',
    fontSize: '0.74rem',
    fontWeight: '800',
    letterSpacing: '0.04em',
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    color: T.warning,
    border: `1px solid ${T.warning}`,
  },
  headerSettledPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.35rem 0.85rem',
    borderRadius: '9999px',
    fontSize: '0.74rem',
    fontWeight: '700',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    color: T.success,
    border: `1px solid ${T.success}`,
  },
  pulseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: T.warning,
    boxShadow: `0 0 6px ${T.warning}`,
    display: 'inline-block',
  },
  pendingActionAlert: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '1rem',
    padding: '0.9rem 1.2rem',
    borderRadius: '0.75rem',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    border: `1px solid ${T.warning}`,
    color: T.text,
    marginBottom: '1.5rem',
    flexWrap: 'wrap',
  },
  pendingAlertContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    fontSize: '0.9rem',
    flex: '1 1 300px',
  },
  pendingAlertIcon: {
    fontSize: '1.3rem',
  },
  pendingAlertBtn: {
    padding: '0.5rem 1.1rem',
    backgroundColor: T.warning,
    color: '#000000',
    border: 'none',
    borderRadius: '50px',
    fontWeight: 'bold',
    fontSize: '0.85rem',
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
  banner: (tone) => bannerStyle(tone),
  notice: { ...S.card, color: T.text, lineHeight: '1.7' },
  tabBar: S.tabBar,
  tabButton: S.tab,
  tabButtonActive: S.tabActive,
  tabPendingBadge: (isActive) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    padding: '0.15rem 0.5rem',
    borderRadius: '9999px',
    fontSize: '0.72rem',
    fontWeight: '800',
    backgroundColor: isActive ? T.warning : 'rgba(245, 158, 11, 0.2)',
    color: isActive ? '#000000' : T.warning,
    border: `1px solid ${T.warning}`,
    marginLeft: '0.45rem',
  }),
  tabPulseDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'currentColor',
    display: 'inline-block',
  },
  formWrapper: S.card,
  sectionHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.8rem',
    marginBottom: '1rem',
  },
  sectionTitle: S.sectionTitle,
  pendingHeaderBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.3rem 0.75rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: '700',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    color: T.warning,
    border: `1px solid ${T.warning}`,
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '1rem',
  },
  formGroup: { display: 'flex', flexDirection: 'column', marginBottom: '1rem' },
  label: S.label,
  input: { ...S.input, padding: '0.5rem', borderRadius: '0.4rem', fontSize: '0.85rem' },
  inputError: {
    ...S.input,
    padding: '0.5rem',
    borderRadius: '0.4rem',
    fontSize: '0.85rem',
    border: `2px solid ${T.error}`,
    boxShadow: '0 0 0 3px rgba(239, 68, 68, 0.25)',
  },
  inlineWarningAlert: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.65rem',
    padding: '0.75rem 1rem',
    borderRadius: '0.5rem',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: `1px solid ${T.error}`,
    color: T.text,
    fontSize: '0.85rem',
    margin: '0.75rem 0',
  },
  select: { ...S.select, padding: '0.5rem', borderRadius: '0.4rem', fontSize: '0.85rem' },
  helperText: S.helper,
  muted: { color: T.textMuted, fontSize: '0.75rem' },
  warning: { color: T.warning, fontSize: '0.85rem', margin: '0.5rem 0' },
  warningInline: { color: T.warning, fontSize: '0.8rem' },
  debtHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    flexWrap: 'wrap',
    marginTop: '1.5rem',
  },
  debtTitle: { color: T.accent, fontSize: '1.05rem', marginBottom: '0.2rem' },
  tableWrapper: S.tableWrap,
  table: S.table,
  tableHeaderRow: S.tableHeadRow,
  tableHeader: S.tableHead,
  tableRow: { backgroundColor: T.bgCard },
  tableCell: S.tableCell,
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '1rem',
    margin: '1.2rem 0',
  },
  summaryTile: {
    backgroundColor: T.bgTertiary,
    borderRadius: '0.6rem',
    padding: '0.9rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    border: `1px solid ${T.borderSoft}`,
  },
  summaryLabel: {
    color: T.textSoft,
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  summaryValue: { color: T.text, fontSize: '1.25rem', fontWeight: 'bold' },
  moneyRow: { display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '1rem 0' },
  moneyBox: { display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '130px' },
  moneyValue: { color: T.text, fontSize: '1.1rem', fontWeight: 'bold' },
  reviewCard: {
    backgroundColor: T.bgTertiary,
    borderRadius: '0.8rem',
    padding: '1.2rem',
    marginBottom: '1rem',
    border: `1px solid ${T.borderSoft}`,
  },
  reviewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  reviewTitle: { color: T.text, fontSize: '1.05rem' },
  badge: statusPill('info'),
  badgeWarning: statusPill('warning'),
  badgePendingAlert: {
    ...statusPill('warning'),
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
  },
  buttonGroup: {
    display: 'flex',
    gap: '0.8rem',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: '1rem',
  },
  submitButton: S.primaryButton,
  verifyButton: S.successButton,
  denyButton: {
    padding: '0.7rem 1.4rem',
    backgroundColor: 'transparent',
    color: T.error,
    border: `2px solid ${T.error}`,
    borderRadius: '50px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    transition: 'all 0.15s ease',
  },
  denyConfirmButton: {
    padding: '0.7rem 1.4rem',
    backgroundColor: T.error,
    color: T.textOnAccent,
    border: 'none',
    borderRadius: '50px',
    fontWeight: 'bold',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
  },
  denyNoticeCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
    padding: '0.85rem 1rem',
    borderRadius: '0.6rem',
    backgroundColor: T.bgTertiary,
    border: `1px solid ${T.borderSoft}`,
  },
  denialReasonNote: {
    fontSize: '0.74rem',
    color: T.text,
    marginTop: '0.35rem',
    lineHeight: 1.35,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    padding: '0.25rem 0.5rem',
    borderRadius: '4px',
    border: '1px solid rgba(239, 68, 68, 0.25)',
  },
  secondaryButton: S.secondaryButton,
  linkButton: {
    backgroundColor: 'transparent',
    color: T.accent,
    border: `1px solid ${T.border}`,
    borderRadius: '4px',
    padding: '0.3rem 0.6rem',
    fontSize: '0.75rem',
    cursor: 'pointer',
  },
  disabled: S.disabled,

  // Double-Check Modal Styles
  modalBackdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    backdropFilter: 'blur(5px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '1rem',
  },
  modalCard: {
    backgroundColor: T.bgCard,
    borderRadius: '1rem',
    border: `1px solid ${T.borderSoft}`,
    boxShadow: '0 20px 45px rgba(0, 0, 0, 0.5)',
    width: '100%',
    maxWidth: '560px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '1.25rem 1.5rem',
    borderBottom: `1px solid ${T.borderSoft}`,
  },
  modalTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
  },
  modalTitle: {
    margin: 0,
    fontSize: '1.2rem',
    fontWeight: 'bold',
    color: T.text,
  },
  modalSubtitle: {
    margin: '0.35rem 0 0 0',
    fontSize: '0.82rem',
    color: T.textSoft,
  },
  modalCloseBtn: {
    background: 'transparent',
    border: 'none',
    color: T.textSoft,
    fontSize: '1.2rem',
    cursor: 'pointer',
    padding: '0.3rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
  },
  modalBody: {
    padding: '1.5rem',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.1rem',
  },
  modalSectionBanner: {
    padding: '0.8rem 1rem',
    borderRadius: '0.6rem',
    backgroundColor: T.bgTertiary,
    border: `1px solid ${T.borderSoft}`,
  },
  modalSectionTitle: {
    fontSize: '1rem',
    fontWeight: 'bold',
    color: T.text,
    margin: 0,
  },
  modalSectionMeta: {
    fontSize: '0.8rem',
    color: T.textSoft,
    marginTop: '0.25rem',
  },
  modalCompareGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '0.8rem',
  },
  modalCompareBox: {
    padding: '0.85rem',
    borderRadius: '0.6rem',
    backgroundColor: T.bgTertiary,
    border: `1px solid ${T.borderSoft}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  modalCompareLabel: {
    fontSize: '0.72rem',
    fontWeight: '700',
    color: T.textSoft,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  modalCompareValue: {
    fontSize: '1.2rem',
    fontWeight: 'bold',
    color: T.text,
  },
  modalCompareSub: {
    fontSize: '0.75rem',
    color: T.textMuted,
  },
  modalIndicatorBox: (tone) => ({
    padding: '0.9rem 1rem',
    borderRadius: '0.6rem',
    backgroundColor: tone === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
    border: `1px solid ${tone === 'success' ? T.success : T.warning}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
  }),
  modalIndicatorTitle: (tone) => ({
    fontSize: '0.92rem',
    fontWeight: 'bold',
    color: tone === 'success' ? T.success : T.warning,
    display: 'flex',
    alignItems: 'center',
    gap: '0.45rem',
  }),
  modalIndicatorDesc: {
    margin: 0,
    fontSize: '0.82rem',
    color: T.text,
    lineHeight: 1.45,
  },
  modalNoteBox: {
    padding: '0.75rem 0.9rem',
    borderRadius: '0.5rem',
    backgroundColor: T.bgTertiary,
    border: `1px solid ${T.borderSoft}`,
  },
  modalDoubleCheckContainer: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
    padding: '0.9rem 1rem',
    borderRadius: '0.6rem',
    backgroundColor: T.bgTertiary,
    border: `1px solid ${T.accent}`,
    cursor: 'pointer',
  },
  modalDoubleCheckCheckbox: {
    marginTop: '0.2rem',
    width: '18px',
    height: '18px',
    accentColor: T.accent,
    cursor: 'pointer',
  },
  modalDoubleCheckText: {
    fontSize: '0.85rem',
    color: T.text,
    lineHeight: 1.45,
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '0.8rem',
    padding: '1.1rem 1.5rem',
    borderTop: `1px solid ${T.borderSoft}`,
    backgroundColor: T.bgCard,
  },
};

export default DeathAid;
