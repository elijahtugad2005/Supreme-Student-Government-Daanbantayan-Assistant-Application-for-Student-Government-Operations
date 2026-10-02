import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  listAuditLog,
  listCollections,
  listPendingCollections,
  listVerifiedRosters,
  recordRemittance,
  recordSectionCollection,
} from '../services/deathAidService';

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

  const say = useCallback((type, message) => setBanner({ type, message }), []);

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
        <h2 style={styles.mainTitle}>Death Aid Collection</h2>
        <p style={styles.headerSubtitle}>
          Record what a section handed in, verify remittances, and track what is still owed.
        </p>
      </div>

      {banner && (
        <div
          style={{
            ...styles.banner,
            backgroundColor:
              banner.type === 'success' ? '#2e7d32' : banner.type === 'error' ? '#b3261e' : '#0b5394',
          }}
        >
          {banner.message}
        </div>
      )}

      <div style={styles.tabBar}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{ ...styles.tabButton, ...(t.id === tab ? styles.tabButtonActive : {}) }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'record' && <RecordView actor={actor} say={say} />}
      {tab === 'pending' && <PendingView actor={actor} say={say} />}
      {tab === 'confirmed' && <StatusListView status={DEATH_AID_COLLECTION_STATUS.CONFIRMED} title="Confirmed Collections" say={say} />}
      {tab === 'discrepancies' && <DiscrepancyView say={say} />}
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
                <SummaryTile label="Beneficiaries" value={String(totals.beneficiaryCount)} tone="#a5d6a7" />
                <SummaryTile label="Collected" value={peso(totals.collectedAmount)} />
                <SummaryTile label="Expected" value={peso(totals.expectedCollection)} />
                <SummaryTile label="Owing" value={`${totals.debtCount} · ${peso(totals.debtAmount)}`} tone="#ffcc80" />
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
function PendingView({ actor, say }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [amounts, setAmounts] = useState({});
  const [notes, setNotes] = useState({});
  const [busyId, setBusyId] = useState('');

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

  const accept = async (record) => {
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
      await load();
    } catch (error) {
      say('error', error.message);
    } finally {
      setBusyId('');
    }
  };

  if (loading) return <Loading label="Loading pending collections…" />;

  return (
    <div style={styles.formWrapper}>
      <h3 style={styles.sectionTitle}>Pending Verification</h3>
      {rows.length === 0 ? (
        <p style={styles.helperText}>No collections are waiting for a remittance.</p>
      ) : (
        rows.map((c) => {
          const rec = Number(amounts[c.collectionId]);
          const diff = Number.isFinite(rec) ? Math.round((rec - c.collectedAmount) * 100) / 100 : null;
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
                    {c.submittedByName}
                  </p>
                </div>
                <StatusBadge status={c.status} />
              </div>

              <div style={styles.moneyRow}>
                <div style={styles.moneyBox}>
                  <span style={styles.summaryLabel}>Reported</span>
                  <span style={styles.moneyValue}>{peso(c.collectedAmount)}</span>
                </div>
                <div style={styles.moneyBox}>
                  <span style={styles.summaryLabel}>Received</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={amounts[c.collectionId] ?? ''}
                    onChange={(e) => setAmounts((p) => ({ ...p, [c.collectionId]: e.target.value }))}
                    placeholder="0.00"
                    style={styles.input}
                  />
                </div>
                <div style={styles.moneyBox}>
                  <span style={styles.summaryLabel}>Difference</span>
                  <span style={{ ...styles.moneyValue, color: diff === 0 ? '#a5d6a7' : '#ffcc80' }}>
                    {diff === null ? '—' : `${diff > 0 ? '+' : ''}${peso(diff)}`}
                  </span>
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Note (optional)</label>
                <input
                  type="text"
                  value={notes[c.collectionId] ?? ''}
                  onChange={(e) => setNotes((p) => ({ ...p, [c.collectionId]: e.target.value }))}
                  placeholder="Reason or reference"
                  style={styles.input}
                />
              </div>

              <div style={styles.buttonGroup}>
                <button
                  type="button"
                  onClick={() => accept(c)}
                  disabled={busyId === c.collectionId || !Number.isFinite(rec)}
                  style={styles.verifyButton}
                >
                  {busyId === c.collectionId ? 'Recording…' : 'Accept Remittance'}
                </button>
                {c.recordedByUid === actor.uid && (
                  <span style={styles.warningInline}>
                    You recorded this one, so another officer must accept it.
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
function StatusListView({ status, title, say }) {
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
      <CollectionTable rows={rows} loading={loading} empty="Nothing here yet." showDebts />
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
        <SummaryTile label="Students Owing" value={String(totalStudents)} tone="#ffcc80" />
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
              <td style={styles.tableCell}>{c.collectionId}</td>
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
  const bg =
    status === DEATH_AID_COLLECTION_STATUS.CONFIRMED
      ? '#4caf50'
      : status === DEATH_AID_COLLECTION_STATUS.DISCREPANCY
        ? '#ff7043'
        : '#f0a500';
  return <span style={{ ...styles.badge, backgroundColor: bg }}>{label}</span>;
}

function Loading({ label }) {
  return (
    <div style={styles.formWrapper}>
      <p style={styles.helperText}>{label}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
const styles = {
  container: {
    width: '100%',
    padding: '1.5rem',
    backgroundColor: '#4c1515',
    borderRadius: '1rem',
    fontFamily: 'Arial, sans-serif',
    boxSizing: 'border-box',
  },
  header: { marginBottom: '1.5rem' },
  mainTitle: { fontSize: '2rem', color: '#fe5c03', marginBottom: '0.5rem', fontWeight: 'bold' },
  headerSubtitle: { fontSize: '1rem', color: '#c0c0c0' },
  banner: {
    color: '#fff',
    padding: '1rem',
    borderRadius: '0.5rem',
    marginBottom: '1.5rem',
    fontWeight: 'bold',
  },
  notice: {
    backgroundColor: '#5a1a1a',
    padding: '1.2rem',
    borderRadius: '0.8rem',
    color: '#f1f1f1',
    lineHeight: '1.7',
  },
  tabBar: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1.5rem',
    borderBottom: '2px solid rgba(254, 92, 3, 0.3)',
    flexWrap: 'wrap',
  },
  tabButton: {
    padding: '0.7rem 1.1rem',
    backgroundColor: 'transparent',
    color: '#c0c0c0',
    border: 'none',
    borderBottom: '3px solid transparent',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  tabButtonActive: { color: '#fe5c03', borderBottomColor: '#fe5c03' },
  formWrapper: {
    backgroundColor: '#5a1a1a',
    borderRadius: '1rem',
    padding: '2rem',
    marginBottom: '2rem',
    border: '1px solid rgba(254, 92, 3, 0.2)',
  },
  sectionTitle: {
    fontSize: '1.4rem',
    color: '#fe5c03',
    marginBottom: '1.2rem',
    fontWeight: 'bold',
    borderBottom: '2px solid rgba(254, 92, 3, 0.3)',
    paddingBottom: '0.5rem',
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '1rem',
  },
  formGroup: { display: 'flex', flexDirection: 'column', marginBottom: '1rem' },
  label: { fontSize: '0.85rem', color: '#f1f1f1', marginBottom: '0.35rem', fontWeight: '600' },
  input: {
    padding: '0.5rem',
    border: '1px solid #7a2a2a',
    borderRadius: '0.4rem',
    backgroundColor: '#732020',
    color: '#f1f1f1',
    fontSize: '0.85rem',
    outline: 'none',
    boxSizing: 'border-box',
    minWidth: '120px',
  },
  select: {
    padding: '0.5rem',
    border: '1px solid #7a2a2a',
    borderRadius: '0.4rem',
    backgroundColor: '#732020',
    color: '#f1f1f1',
    fontSize: '0.85rem',
    outline: 'none',
    cursor: 'pointer',
  },
  helperText: { fontSize: '0.8rem', color: '#c0c0c0', marginTop: '0.35rem' },
  muted: { color: '#888', fontSize: '0.75rem' },
  warning: { color: '#ffcc80', fontSize: '0.85rem', margin: '0.5rem 0' },
  warningInline: { color: '#ffcc80', fontSize: '0.8rem' },
  debtHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    flexWrap: 'wrap',
    marginTop: '1.5rem',
  },
  debtTitle: { color: '#fe5c03', fontSize: '1.05rem', marginBottom: '0.2rem' },
  tableWrapper: { overflowX: 'auto', marginBottom: '1rem' },
  table: { width: '100%', borderCollapse: 'collapse', backgroundColor: '#8a2a2a' },
  tableHeaderRow: { backgroundColor: '#9a3a3a' },
  tableHeader: {
    padding: '0.6rem',
    textAlign: 'left',
    color: '#fe5c03',
    fontWeight: 'bold',
    fontSize: '0.8rem',
    borderBottom: '2px solid #fe5c03',
  },
  tableRow: { borderBottom: '1px solid rgba(254, 92, 3, 0.1)' },
  tableCell: { padding: '0.5rem', color: '#f1f1f1', fontSize: '0.85rem', verticalAlign: 'middle' },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '1rem',
    margin: '1.2rem 0',
  },
  summaryTile: {
    backgroundColor: '#732020',
    borderRadius: '0.6rem',
    padding: '0.9rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
  },
  summaryLabel: { color: '#c0c0c0', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em' },
  summaryValue: { color: '#f1f1f1', fontSize: '1.25rem', fontWeight: 'bold' },
  moneyRow: { display: 'flex', gap: '1rem', flexWrap: 'wrap', margin: '1rem 0' },
  moneyBox: { display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: '130px' },
  moneyValue: { color: '#f1f1f1', fontSize: '1.1rem', fontWeight: 'bold' },
  reviewCard: {
    backgroundColor: '#732020',
    borderRadius: '0.8rem',
    padding: '1.2rem',
    marginBottom: '1rem',
    border: '1px solid rgba(254, 92, 3, 0.2)',
  },
  reviewHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  reviewTitle: { color: '#f1f1f1', fontSize: '1.05rem' },
  badge: {
    display: 'inline-block',
    color: '#000',
    padding: '0.25rem 0.7rem',
    borderRadius: '50px',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
  badgeWarning: {
    display: 'inline-block',
    color: '#000',
    backgroundColor: '#ff7043',
    padding: '0.25rem 0.7rem',
    borderRadius: '50px',
    fontSize: '0.75rem',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
  buttonGroup: { display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap', marginTop: '1rem' },
  submitButton: {
    flex: 1,
    padding: '1rem',
    backgroundColor: '#fe5c03',
    color: '#000',
    border: 'none',
    borderRadius: '50px',
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    minWidth: '220px',
  },
  verifyButton: {
    padding: '0.7rem 1.4rem',
    backgroundColor: '#4caf50',
    color: '#fff',
    border: 'none',
    borderRadius: '50px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  secondaryButton: {
    padding: '0.5rem 1rem',
    backgroundColor: 'transparent',
    color: '#f1f1f1',
    border: '2px solid #7a2a2a',
    borderRadius: '50px',
    fontSize: '0.85rem',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  linkButton: {
    backgroundColor: 'transparent',
    color: '#fe5c03',
    border: '1px solid #7a2a2a',
    borderRadius: '4px',
    padding: '0.3rem 0.6rem',
    fontSize: '0.75rem',
    cursor: 'pointer',
  },
  disabled: { backgroundColor: '#7a2a2a', cursor: 'not-allowed', opacity: '0.6' },
};

export default DeathAid;