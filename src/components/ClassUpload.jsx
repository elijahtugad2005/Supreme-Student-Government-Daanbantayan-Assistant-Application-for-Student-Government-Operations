import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { useAuth } from './AuthContext/AuthContext.jsx';
import { hasPermission } from '../utils/permissions';
import {
  COLLEGE_LIST,
  YEAR_LEVELS,
  deriveYearLevel,
  getCollege,
  getPrograms,
  suggestSection,
} from '../utils/academics';
import {
  buildRoster,
  columnLabel,
  detectColumns,
  findHeaderRow,
} from '../utils/rosterParser';
import {
  ROSTER_STATUS,
  amendRosterForTransfers,
  listPendingSubmissions,
  listRosterVersions,
  listRostersOwnedBy,
  listSections,
  requestCorrection,
  submitRoster,
  verifyRoster,
  withdrawRoster,
} from '../services/rosterService';
import RosterDirectory from './RosterDirectory.jsx';
import { S, T, banner as bannerStyle, statusPill } from '../utils/themeStyles';

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

const TABS = [
  { id: 'submit', label: 'Submit Roster' },
  { id: 'mine', label: 'My Rosters', signedInOnly: true },
  { id: 'directory', label: 'Browse Rosters' },
];

// Tone names, not colours — the pill resolves them through the theme tokens.
const STATUS_META = {
  [ROSTER_STATUS.PENDING]: { label: 'Pending Verification', tone: 'info' },
  [ROSTER_STATUS.VERIFIED]: { label: 'Verified', tone: 'success' },
  [ROSTER_STATUS.CORRECTION_REQUESTED]: { label: 'Correction Requested', tone: 'warning' },
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
};

function ClassUpload() {
  const { currentUser, userRole, userPermissions, userPermissionOverrides } = useAuth();
  const canVerify = hasPermission(
    { role: userRole, permissions: userPermissions, permissionOverrides: userPermissionOverrides },
    'canManageRosters'
  );
  // Reading verified rosters is restricted to Governors, the Secretary and Admin
  // unless an Admin grants it to this account individually.
  const canViewRosters = hasPermission(
    { role: userRole, permissions: userPermissions, permissionOverrides: userPermissionOverrides },
    'canViewRosters'
  );
  const displayName = currentUser?.displayName || currentUser?.email || 'SSG Officer';

  // ========================================
  // ACADEMIC DETAILS
  // ========================================
  const [meta, setMeta] = useState({
    collegeId: '',
    program: '',
    section: '',
    mayorName: '',
  });

  // Kept separate from `meta` so typing in the Section field can auto-fill it
  // without overwriting a year the Mayor picked by hand.
  const [yearLevel, setYearLevel] = useState('');

  // ========================================
  // SHEET PARSING
  // ========================================
  const [sheet, setSheet] = useState(null); // { fileName, rows }
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({ nameIndex: -1, sectionIndex: -1 });
  const [draft, setDraft] = useState([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  const [parseError, setParseError] = useState('');
  const [banner, setBanner] = useState(null); // { type: 'success'|'info', message }
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState('submit');

  // ========================================
  // OFFICER PANEL
  // ========================================
  const [sections, setSections] = useState([]);
  const [pending, setPending] = useState([]);
  const [correctionFor, setCorrectionFor] = useState(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [busyId, setBusyId] = useState('');
  const [expandedSection, setExpandedSection] = useState('');
  const [versions, setVersions] = useState({});

  const programs = useMemo(() => getPrograms(meta.collegeId), [meta.collegeId]);
  const college = getCollege(meta.collegeId);

  // ========================================
  // PARSING
  // ========================================

  /**
   * Seeds the editable student list. Only ever called when the file is chosen or
   * the column mapping changes — never in response to editing the Section field,
   * because that would silently discard the Mayor's corrections.
   */
  const applyParse = useCallback((rows, nameIndex, sectionIndex) => {
    const headerRowIndex = findHeaderRow(rows);
    const result = buildRoster(rows, {
      headerRowIndex,
      nameIndex,
      sectionIndex,
      websiteSection: '',
    });

    setHeaders(result.headers);
    setMapping({ nameIndex, sectionIndex });
    setDraft(result.students);

    if (result.issues.missingNameColumn) {
      setParseError(
        'No student name column was recognized. Please choose which column holds the names.'
      );
    } else if (result.students.length === 0) {
      setParseError('No student names were found in that column.');
    } else {
      setParseError('');
    }
  }, []);

  /**
   * The warnings depend on the section chosen above, so they are derived from
   * the sheet rather than stored. Recomputing them cannot disturb `draft`.
   */
  const analysis = useMemo(() => {
    if (!sheet?.rows) return null;
    return buildRoster(sheet.rows, {
      headerRowIndex: findHeaderRow(sheet.rows),
      nameIndex: mapping.nameIndex,
      sectionIndex: mapping.sectionIndex,
      websiteSection: meta.section,
    });
  }, [sheet, mapping, meta.section]);

  // ========================================
  // FILE HANDLING
  // ========================================
  const readFile = async (file) => {
    const lower = file.name.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      setParseError('Please upload a CSV or Excel file (.csv, .xlsx, .xls).');
      return;
    }

    try {
      let rows = [];
      if (lower.endsWith('.csv')) {
        const text = await file.text();
        rows = Papa.parse(text, { skipEmptyLines: false }).data;
      } else {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false, defval: '' });
      }

      if (!rows || rows.length === 0) {
        setParseError('That file is empty. Please add the student list first.');
        return;
      }

      setSheet({ fileName: file.name, rows });
      const headerRowIndex = findHeaderRow(rows);
      const { nameIndex, sectionIndex } = detectColumns(rows[headerRowIndex] || []);
      applyParse(rows, nameIndex, sectionIndex);
    } catch (error) {
      setParseError(`Could not read that file: ${error.message}`);
    }
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  };

  const changeMapping = (key, value) => {
    if (!sheet) return;
    applyParse(sheet.rows, key === 'nameIndex' ? value : mapping.nameIndex, key === 'sectionIndex' ? value : mapping.sectionIndex);
  };

  // ========================================
  // DRAFT EDITS
  // ========================================
  const updateDraftName = (index, value) => {
    setDraft((prev) => prev.map((row, i) => (i === index ? { ...row, name: value } : row)));
  };

  const removeDraftRow = (index) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const addDraftRow = () => {
    setDraft((prev) => [...prev, { rowNumber: 0, name: '', section: '', suspicious: false }]);
  };

  // ========================================
  // FORM
  // ========================================
  const handleMetaChange = (e) => {
    const { name, value } = e.target;
    setMeta((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'collegeId') next.program = '';
      if (name === 'program') next.section = suggestSection(value);
      return next;
    });
    if (name === 'section') {
      const derived = deriveYearLevel(value);
      if (derived) setYearLevel(String(derived));
    }
  };

  const resetForm = (keepBanner = false) => {
    setMeta({ collegeId: '', program: '', section: '', mayorName: '' });
    setYearLevel('');
    setSheet(null);
    setHeaders([]);
    setMapping({ nameIndex: -1, sectionIndex: -1 });
    setDraft([]);
    setParseError('');
    if (!keepBanner) setBanner(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!meta.collegeId) return setParseError('Please choose a College.');
    if (!meta.program) return setParseError('Please choose a Program.');
    if (!meta.section.trim()) return setParseError('Please enter a Section.');
    if (draft.length === 0) return setParseError('Please upload a file with the student list.');

    const blank = draft.findIndex((s) => !s.name.trim());
    if (blank !== -1) {
      return setParseError(`Row ${blank + 1} has no name. Fill it in or remove the row.`);
    }

    setSubmitting(true);
    setParseError('');
    try {
      await submitRoster({
        college: college?.label || meta.collegeId,
        program: meta.program,
        section: meta.section.trim(),
        mayorName: meta.mayorName.trim(),
        yearLevel: yearLevel ? Number(yearLevel) : null,
        mayorUid: currentUser?.uid || null,
        students: draft.map((s) => ({ name: s.name.trim(), section: meta.section.trim(), rowNumber: s.rowNumber })),
        source: {
          fileName: sheet?.fileName || '',
          nameColumn: headers[mapping.nameIndex] || null,
          sectionColumn: mapping.sectionIndex >= 0 ? headers[mapping.sectionIndex] || null : null,
          ignoredColumns: analysis?.ignored || [],
        },
      });

      setBanner({
        type: 'success',
        message:
          `Roster for ${meta.section.trim()} submitted with ${draft.length} student(s). ` +
          'An SSG Officer will verify it before it becomes the official list.',
      });
      resetForm(true);
      await loadOfficerData();
    } catch (error) {
      setParseError(error.message || 'The roster could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  };

  // ========================================
  // OFFICER ACTIONS
  // ========================================
  const loadOfficerData = useCallback(async () => {
    if (!canVerify) return;

    // Settled separately on purpose: a missing composite index on one query
    // must not blank out the other list.
    const [sectionResult, pendingResult] = await Promise.allSettled([
      listSections(),
      listPendingSubmissions(),
    ]);

    if (sectionResult.status === 'fulfilled') setSections(sectionResult.value);
    if (pendingResult.status === 'fulfilled') setPending(pendingResult.value);

    const failures = [sectionResult, pendingResult]
      .filter((r) => r.status === 'rejected')
      .map((r) => r.reason.message);

    if (failures.length > 0) {
      setBanner({ type: 'error', message: failures.join(' ') });
    }
  }, [canVerify]);

  useEffect(() => {
    loadOfficerData();
  }, [loadOfficerData]);

  const handleVerify = async (rosterId) => {
    setBusyId(rosterId);
    try {
      const version = await verifyRoster(rosterId, displayName);
      setBanner({ type: 'success', message: `Roster verified and recorded as version ${version}.` });
      await loadOfficerData();
    } catch (error) {
      setBanner({ type: 'error', message: error.message });
    } finally {
      setBusyId('');
    }
  };

  const handleCorrection = async (rosterId) => {
    setBusyId(rosterId);
    try {
      await requestCorrection(rosterId, correctionReason);
      setBanner({ type: 'info', message: 'Correction requested. The Mayor can now resubmit.' });
      setCorrectionFor(null);
      setCorrectionReason('');
      await loadOfficerData();
    } catch (error) {
      setBanner({ type: 'error', message: error.message });
    } finally {
      setBusyId('');
    }
  };

  const toggleVersions = async (sectionKey) => {
    if (expandedSection === sectionKey) {
      setExpandedSection('');
      return;
    }
    setExpandedSection(sectionKey);
    if (!versions[sectionKey]) {
      try {
        const list = await listRosterVersions(sectionKey);
        setVersions((prev) => ({ ...prev, [sectionKey]: list }));
      } catch (error) {
        setBanner({ type: 'error', message: error.message });
      }
    }
  };

  const issues = analysis?.issues;

  // A role change while the browser tab is open must not leave someone on a
  // view they are no longer allowed to see.
  const activeTab = tab === 'directory' && !canViewRosters ? 'submit' : tab;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.mainTitle}>Class Roster Registry</h2>
        <p style={styles.headerSubtitle}>
          Submit your class list for verification. Once verified, this roster becomes the official
          student count used for Death Aid reporting.
        </p>
      </div>

      {banner && <div style={styles.banner(banner.type)}>{banner.message}</div>}

      <div style={styles.tabBar}>
        {TABS.filter((t) => {
          if (t.id === 'directory') return canViewRosters;
          // Signed-out Mayors have no account, so there is nothing of "theirs"
          // to list or amend.
          if (t.signedInOnly) return !!currentUser;
          return true;
        }).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              ...styles.tabButton,
              ...(t.id === activeTab ? styles.tabButtonActive : {}),
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'directory' ? (
        <RosterDirectory onError={(message) => setBanner({ type: 'error', message })} />
      ) : activeTab === 'mine' ? (
        <MyRostersPanel
          onMessage={(type, message) => setBanner({ type, message })}
        />
      ) : (
        <>
      {/* ========================================
          ACADEMIC DETAILS
          ======================================== */}
      <div style={styles.formWrapper}>
        <h3 style={styles.sectionTitle}>Academic Details</h3>

        <div style={styles.form}>
          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <label style={styles.label}>College *</label>
              <select name="collegeId" value={meta.collegeId} onChange={handleMetaChange} style={styles.select}>
                <option value="">Select a college</option>
                {COLLEGE_LIST.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Program *</label>
              <select
                name="program"
                value={meta.program}
                onChange={handleMetaChange}
                style={styles.select}
                disabled={!meta.collegeId}
              >
                <option value="">{meta.collegeId ? 'Select a program' : 'Choose a college first'}</option>
                {programs.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Section *</label>
              <input
                type="text"
                name="section"
                value={meta.section}
                onChange={handleMetaChange}
                placeholder="e.g., BSIT - 1A"
                style={styles.input}
              />
              <p style={styles.helperText}>Confirm this — it is how students are grouped.</p>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Mayor's Name</label>
              <input
                type="text"
                name="mayorName"
                value={meta.mayorName}
                onChange={handleMetaChange}
                placeholder="Leave blank if no Mayor assigned"
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Year Level</label>
              <select value={yearLevel} onChange={(e) => setYearLevel(e.target.value)} style={styles.select}>
                <option value="">Not set</option>
                {YEAR_LEVELS.map((y) => (
                  <option key={y.value} value={y.value}>
                    {y.label}
                  </option>
                ))}
              </select>
              <p style={styles.helperText}>Filled in from the section name — change it if wrong.</p>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================
          FILE UPLOAD
          ======================================== */}
      <div style={styles.formWrapper}>
        <h3 style={styles.sectionTitle}>Student List</h3>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          style={{ ...styles.dropzone, ...(dragging ? styles.dropzoneActive : {}) }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFile}
            style={styles.fileInput}
          />
          <p style={styles.helperText}>
            Drop your class list here, or choose a file. Any .csv, .xlsx or .xls works — the Name and
            Section columns are detected automatically, every other column is ignored.
          </p>
        </div>

        {parseError && (
          <div style={styles.errorBox}>
            <strong>Error:</strong> {parseError}
          </div>
        )}

        {/* COLUMN MAPPING */}
        {sheet && headers.length > 0 && (
          <div style={styles.mappingRow}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Name column</label>
              <select
                value={mapping.nameIndex}
                onChange={(e) => changeMapping('nameIndex', Number(e.target.value))}
                style={styles.select}
              >
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    {columnLabel(i, h)}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Section column</label>
              <select
                value={mapping.sectionIndex}
                onChange={(e) => changeMapping('sectionIndex', Number(e.target.value))}
                style={styles.select}
              >
                <option value={-1}>None — use the section above</option>
                {headers.map((h, i) => (
                  <option key={i} value={i}>
                    {columnLabel(i, h)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* ISSUES */}
        {issues && draft.length > 0 && (
          <div style={styles.issueBox}>
            <h4 style={styles.issueTitle}>Before you submit</h4>
            <ul style={styles.issueList}>
              <li>
                Read <strong>{draft.length}</strong> name(s) from{' '}
                <strong>{analysis.detected.name || 'the chosen column'}</strong>.
              </li>
              {issues.missingSectionColumn && (
                <li style={styles.issueWarn}>
                  No section column found in the file — every student will be filed under the section
                  you entered above.
                </li>
              )}
              {issues.sectionMismatch && (
                <li style={styles.issueWarn}>
                  The file lists {analysis.sheetSections.length} different section(s):{' '}
                  {analysis.sheetSections.join(', ')}. Everyone will still be filed under{' '}
                  <strong>{meta.section || 'the section above'}</strong>.
                </li>
              )}
              {issues.invalidCount > 0 && (
                <li style={styles.issueWarn}>
                  {issues.invalidCount} entr(ies) do not look like a person's name:{' '}
                  {issues.invalidStudents.slice(0, 5).map((s) => `${s.name} (row ${s.rowNumber})`).join(', ')}
                </li>
              )}
              {issues.duplicates.length > 0 && (
                <li style={styles.issueWarn}>
                  {issues.duplicates.length} duplicate name(s) found:{' '}
                  {issues.duplicates.map((d) => `${d.name} (rows ${d.rows.join(', ')})`).join('; ')}
                </li>
              )}
              {issues.skippedEmpty > 0 && <li>{issues.skippedEmpty} empty row(s) skipped.</li>}
              {analysis.ignored.length > 0 && (
                <li>Ignored columns: {analysis.ignored.join(', ')}</li>
              )}
            </ul>
          </div>
        )}

        {/* EDITABLE PREVIEW */}
        {draft.length > 0 && (
          <div style={styles.previewSection}>
            <h4 style={styles.previewTitle}>{draft.length} student(s) ready</h4>

            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.tableHeaderRow}>
                    <th style={styles.tableHeader}>#</th>
                    <th style={styles.tableHeader}>Name</th>
                    <th style={styles.tableHeader}></th>
                  </tr>
                </thead>
                <tbody>
                  {draft.map((student, index) => (
                    <tr key={index} style={styles.tableRow}>
                      <td style={styles.tableCell}>{index + 1}</td>
                      <td style={styles.tableCell}>
                        <input
                          type="text"
                          value={student.name}
                          onChange={(e) => updateDraftName(index, e.target.value)}
                          style={styles.cellInput}
                          placeholder="Student name"
                        />
                        {student.suspicious && (
                          <span style={styles.cellFlag}>check this entry</span>
                        )}
                      </td>
                      <td style={styles.tableCell}>
                        <button onClick={() => removeDraftRow(index)} style={styles.rowRemove}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={styles.buttonGroup}>
              <button type="button" onClick={addDraftRow} style={styles.secondaryButton}>
                + Add Student
              </button>
            </div>
          </div>
        )}

        <div style={styles.buttonGroup}>
          <button
            onClick={handleSubmit}
            disabled={submitting || draft.length === 0}
            style={{
              ...styles.submitButton,
              ...(submitting || draft.length === 0 ? styles.submitButtonDisabled : {}),
            }}
          >
            {submitting ? 'Submitting...' : 'Submit Roster for Verification'}
          </button>

          <button type="button" onClick={() => resetForm()} style={styles.resetButton}>
            Reset Form
          </button>
        </div>
      </div>

      {/* ========================================
          OFFICER PANEL
          ======================================== */}
      {canVerify && (
        <>
          <div style={styles.formWrapper}>
            <h3 style={styles.sectionTitle}>Awaiting Verification</h3>

            {pending.length === 0 ? (
              <p style={styles.helperText}>No submissions are waiting for review.</p>
            ) : (
              pending.map((item) => (
                <div key={item.id} style={styles.reviewCard}>
                  <div style={styles.reviewHeader}>
                    <div>
                      <strong style={styles.reviewTitle}>{item.section}</strong>
                      <p style={styles.helperText}>
                        {item.college} · {item.program} · {item.studentCount} student(s) ·{' '}
                        {item.source?.fileName || 'no file name'} · {formatDate(item.submittedAt)}
                      </p>
                      <p style={styles.helperText}>
                        Mayor: {item.mayorName}
                        {item.status === ROSTER_STATUS.CORRECTION_REQUESTED && item.correctionReason
                          ? ` · Reason: ${item.correctionReason}`
                          : ''}
                      </p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>

                  <div style={styles.buttonGroup}>
                    <button
                      onClick={() => handleVerify(item.id)}
                      disabled={busyId === item.id}
                      style={styles.verifyButton}
                    >
                      Verify
                    </button>
                    <button
                      onClick={() => {
                        setCorrectionFor(item.id);
                        setCorrectionReason('');
                      }}
                      style={styles.secondaryButton}
                    >
                      Request Correction
                    </button>
                  </div>

                  {correctionFor === item.id && (
                    <div style={styles.correctionBox}>
                      <textarea
                        value={correctionReason}
                        onChange={(e) => setCorrectionReason(e.target.value)}
                        style={styles.textarea}
                        placeholder="What needs to be corrected?"
                        rows={3}
                      />
                      <div style={styles.buttonGroup}>
                        <button
                          onClick={() => handleCorrection(item.id)}
                          disabled={busyId === item.id || !correctionReason.trim()}
                          style={styles.verifyButton}
                        >
                          Send Request
                        </button>
                        <button onClick={() => setCorrectionFor(null)} style={styles.resetButton}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div style={styles.formWrapper}>
            <h3 style={styles.sectionTitle}>Roster Registry</h3>

            {sections.length === 0 ? (
              <p style={styles.helperText}>No sections have been submitted yet.</p>
            ) : (
              <div style={styles.tableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.tableHeaderRow}>
                      <th style={styles.tableHeader}>Section</th>
                      <th style={styles.tableHeader}>Program</th>
                      <th style={styles.tableHeader}>Mayor</th>
                      <th style={styles.tableHeader}>Status</th>
                      <th style={styles.tableHeader}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sections.map((s) => (
                      <React.Fragment key={s.id}>
                        <tr style={styles.tableRow}>
                          <td style={styles.tableCell}>{s.section}</td>
                          <td style={styles.tableCell}>{s.program}</td>
                          <td style={styles.tableCell}>{s.mayorName}</td>
                          <td style={styles.tableCell}>
                            <StatusBadge status={s.status} />
                          </td>
                          <td style={styles.tableCell}>
                            <button onClick={() => toggleVersions(s.sectionKey)} style={styles.rowRemove}>
                              {expandedSection === s.sectionKey ? 'Hide versions' : 'Versions'}
                            </button>
                          </td>
                        </tr>

                        {expandedSection === s.sectionKey && (
                          <tr style={styles.tableRow}>
                            <td style={styles.tableCell} colSpan={5}>
                              {(versions[s.sectionKey] || []).map((v) => (
                                <p key={v.id} style={styles.versionLine}>
                                  Version {v.version ?? '—'} · {v.students?.length ?? 0} student(s) ·{' '}
                                  {formatDate(v.verifiedAt || v.submittedAt)}
                                  {v.isCurrent ? ' · current' : ''}
                                </p>
                              ))}
                              {(versions[s.sectionKey] || []).length === 0 && (
                                <p style={styles.helperText}>No versions recorded yet.</p>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ========================================
          HOW IT WORKS
          ======================================== */}
      <div style={styles.instructionsBox}>
        <h4 style={styles.instructionsTitle}>How this works</h4>
        <ol style={styles.instructionsList}>
          <li>Enter the College, Program and Section, then upload your class list.</li>
          <li>The Name and Section columns are found automatically — other columns are ignored.</li>
          <li>Correct any entry the parser flagged before submitting.</li>
          <li>An SSG Officer verifies the list; Death Aid reporting uses only verified rosters.</li>
          <li>Need to change a verified list? Submit again — the previous version is kept for the record.</li>
        </ol>
      </div>
        </>
      )}
    </div>
  );
}

/**
 * Rosters this account submitted, with the two corrections a submitter is
 * allowed to make: withdraw a submission that is still pending, or amend a
 * verified roster when students transfer. An amendment always goes back for
 * officer verification — it never changes an official list on its own.
 */
function MyRostersPanel({ onMessage }) {
  const { currentUser } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [amendId, setAmendId] = useState(null);
  const [amendRows, setAmendRows] = useState([]);
  const [transferCount, setTransferCount] = useState('1');
  const [transferReason, setTransferReason] = useState('');

  const load = useCallback(async () => {
    if (!currentUser?.uid) return;
    setLoading(true);
    try {
      setRows(await listRostersOwnedBy(currentUser.uid));
    } catch (error) {
      onMessage('error', `Could not load your rosters: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.uid, onMessage]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (rosterId) => {
    setBusyId(rosterId);
    try {
      await withdrawRoster(rosterId, currentUser.uid);
      onMessage('success', 'Submission withdrawn.');
      setConfirmDelete(null);
      await load();
    } catch (error) {
      onMessage('error', error.message);
    } finally {
      setBusyId('');
    }
  };

  const startAmend = (roster) => {
    setAmendId(roster.rosterId);
    setAmendRows((roster.students || []).map((s) => ({ name: s.name })));
    setTransferCount('1');
    setTransferReason('');
  };

  const saveAmend = async () => {
    const roster = rows.find((r) => r.rosterId === amendId);
    const blank = amendRows.findIndex((r) => !r.name.trim());
    if (blank !== -1) {
      return onMessage('error', `Row ${blank + 1} has no name.`);
    }
    setBusyId(amendId);
    try {
      await amendRosterForTransfers({
        rosterId: amendId,
        students: amendRows,
        transferCount: Number(transferCount),
        transferReason,
        mayorUid: currentUser.uid,
      });
      onMessage(
        'success',
        `${roster?.section} amended for transfers and sent back for verification.`
      );
      setAmendId(null);
      await load();
    } catch (error) {
      onMessage('error', error.message);
    } finally {
      setBusyId('');
    }
  };

  return (
    <div style={styles.formWrapper}>
      <h3 style={styles.sectionTitle}>My Rosters</h3>
      <p style={styles.helperText}>
        Rosters you submitted. A submission that has not been verified yet can be withdrawn. An
        already-verified roster can only be amended when students transfer, and it goes back for
        officer verification.
      </p>

      {loading ? (
        <p style={styles.helperText}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={styles.helperText}>You have not submitted a roster yet.</p>
      ) : (
        rows.map((r) => (
          <div key={r.rosterId} style={styles.reviewCard}>
            <div style={styles.reviewHeader}>
              <div>
                <strong style={styles.reviewTitle}>
                  {r.section} — {r.program}
                </strong>
                <p style={styles.helperText}>
                  {r.studentCount} student(s) · submitted{' '}
                  {r.submittedAt?.toDate ? r.submittedAt.toDate().toLocaleString() : '—'}
                </p>
                {r.hasTransfers && (
                  <p style={styles.helperText}>
                    Transfer amendment: {r.transferCount} student(s) — {r.transferReason}
                  </p>
                )}
              </div>
              <StatusBadge status={r.status} />
            </div>

            {amendId === r.rosterId ? (
              <>
                <div style={styles.toolbarRow || {}}>
                  <span style={styles.helperText}>Corrected student list</span>
                </div>
                <div style={styles.tableWrapper}>
                  <table style={styles.table}>
                    <thead>
                      <tr style={styles.tableHeaderRow}>
                        <th style={styles.tableHeader}>#</th>
                        <th style={styles.tableHeader}>Student</th>
                      </tr>
                    </thead>
                    <tbody>
                      {amendRows.map((row, i) => (
                        <tr key={i} style={styles.tableRow}>
                          <td style={styles.tableCell}>{i + 1}</td>
                          <td style={styles.tableCell}>
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) =>
                                setAmendRows((prev) =>
                                  prev.map((r2, idx) =>
                                    idx === i ? { ...r2, name: e.target.value } : r2
                                  )
                                )
                              }
                              style={styles.cellInput}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={styles.formRow}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Students transferred</label>
                    <input
                      type="number"
                      min="1"
                      value={transferCount}
                      onChange={(e) => setTransferCount(e.target.value)}
                      style={styles.input}
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Reason</label>
                    <input
                      type="text"
                      value={transferReason}
                      onChange={(e) => setTransferReason(e.target.value)}
                      placeholder="e.g., 2 shifted to BSIT - 2B"
                      style={styles.input}
                    />
                  </div>
                </div>

                <div style={styles.buttonGroup}>
                  <button type="button" onClick={saveAmend} disabled={busyId === r.rosterId} style={styles.verifyButton}>
                    {busyId === r.rosterId ? 'Saving…' : 'Send amendment for verification'}
                  </button>
                  <button type="button" onClick={() => setAmendId(null)} style={styles.secondaryButton}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <div style={styles.buttonGroup}>
                {r.status !== 'verified' ? (
                  confirmDelete === r.rosterId ? (
                    <>
                      <button type="button" onClick={() => handleDelete(r.rosterId)} disabled={busyId === r.rosterId} style={styles.verifyButton}>
                        {busyId === r.rosterId ? 'Withdrawing…' : 'Yes, withdraw it'}
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(null)} style={styles.secondaryButton}>
                        Keep it
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmDelete(r.rosterId)} style={styles.secondaryButton}>
                      Withdraw submission
                    </button>
                  )
                ) : (
                  <button type="button" onClick={() => startAmend(r)} style={styles.secondaryButton}>
                    Amend for student transfers
                  </button>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status || 'Unknown', tone: 'neutral' };
  return <span style={statusPill(meta.tone)}>{meta.label}</span>;
}

// ========================================
// STYLES
//
// Built from the shared theme tokens rather than fixed hex values, so this page
// re-colours itself the instant the theme changes. Only tokens defined by all
// three themes are referenced — see utils/themeStyles.js.
// ========================================
const styles = {
  container: S.page,
  header: { marginBottom: '2rem' },
  mainTitle: S.heading,
  headerSubtitle: S.subheading,
  banner: (tone) => bannerStyle(tone),

  tabBar: S.tabBar,
  tabButton: S.tab,
  tabButtonActive: S.tabActive,

  formWrapper: S.card,
  sectionTitle: S.sectionTitle,
  form: { display: 'flex', flexDirection: 'column', gap: '1.2rem' },
  formGroup: { display: 'flex', flexDirection: 'column' },
  formRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
  },
  mappingRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '1rem',
    marginTop: '1.2rem',
  },
  label: S.label,
  input: S.input,
  select: S.select,

  dropzone: {
    padding: '1.5rem',
    border: `2px dashed ${T.border}`,
    borderRadius: '0.8rem',
    backgroundColor: T.bgTertiary,
  },
  dropzoneActive: {
    borderColor: T.accent,
    backgroundColor: T.accentLight,
  },
  fileInput: {
    width: '100%',
    marginBottom: '0.8rem',
    color: T.text,
    fontSize: '0.9rem',
    cursor: 'pointer',
  },
  helperText: S.helper,

  errorBox: {
    backgroundColor: T.errorLight,
    color: T.error,
    border: `1px solid ${T.error}`,
    padding: '1rem',
    borderRadius: '0.5rem',
    fontSize: '0.95rem',
    marginTop: '1rem',
  },

  issueBox: {
    backgroundColor: T.bgTertiary,
    padding: '1rem',
    borderRadius: '0.8rem',
    border: `1px solid ${T.borderSoft}`,
    marginTop: '1.2rem',
  },
  issueTitle: { fontSize: '1rem', color: T.accent, marginBottom: '0.6rem', fontWeight: 'bold' },
  issueList: {
    color: T.text,
    fontSize: '0.85rem',
    lineHeight: '1.7',
    paddingLeft: '1.2rem',
    margin: 0,
  },
  issueWarn: { color: T.warning },

  previewSection: {
    backgroundColor: T.bgTertiary,
    padding: '1.5rem',
    borderRadius: '0.8rem',
    border: `1px solid ${T.borderSoft}`,
    marginTop: '1.2rem',
  },
  previewTitle: { fontSize: '1.2rem', color: T.success, marginBottom: '1rem', fontWeight: 'bold' },
  toolbarRow: {
    display: 'flex',
    gap: '0.8rem',
    alignItems: 'center',
    flexWrap: 'wrap',
    margin: '1rem 0',
  },

  tableWrapper: S.tableWrap,
  table: S.table,
  tableHeaderRow: S.tableHeadRow,
  tableHeader: S.tableHead,
  tableRow: { backgroundColor: T.bgCard },
  tableCell: S.tableCell,

  cellInput: {
    ...S.input,
    width: '100%',
    minWidth: '220px',
    padding: '0.5rem',
    borderRadius: '0.4rem',
    fontSize: '0.9rem',
  },
  cellFlag: { display: 'block', color: T.warning, fontSize: '0.75rem', marginTop: '0.2rem' },
  rowRemove: {
    backgroundColor: 'transparent',
    color: T.accent,
    border: `1px solid ${T.border}`,
    borderRadius: '4px',
    padding: '0.35rem 0.7rem',
    fontSize: '0.75rem',
    cursor: 'pointer',
  },
  textarea: {
    ...S.input,
    width: '100%',
    minHeight: '70px',
    resize: 'vertical',
  },

  buttonGroup: {
    display: 'flex',
    gap: '0.8rem',
    flexWrap: 'wrap',
    marginTop: '1rem',
    alignItems: 'center',
  },
  submitButton: S.primaryButton,
  submitButtonDisabled: S.disabled,
  verifyButton: S.successButton,
  secondaryButton: S.secondaryButton,
  resetButton: {
    padding: '1rem',
    backgroundColor: 'transparent',
    color: T.textSoft,
    border: `2px solid ${T.border}`,
    borderRadius: '50px',
    fontSize: '1rem',
    fontWeight: 'bold',
    cursor: 'pointer',
    minWidth: '160px',
  },

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
  correctionBox: {
    marginTop: '1rem',
    paddingTop: '1rem',
    borderTop: `1px solid ${T.borderSoft}`,
  },
  versionLine: { color: T.textSoft, fontSize: '0.8rem', margin: '0.2rem 0' },

  badge: statusPill('info'),

  instructionsBox: {
    backgroundColor: T.bgCard,
    padding: '1.5rem',
    borderRadius: '1rem',
    border: `1px solid ${T.borderSoft}`,
  },
  instructionsTitle: { fontSize: '1.2rem', color: T.accent, marginBottom: '1rem', fontWeight: 'bold' },
  instructionsList: {
    color: T.text,
    fontSize: '0.95rem',
    lineHeight: '1.8',
    paddingLeft: '1.5rem',
  },
};

export default ClassUpload;
