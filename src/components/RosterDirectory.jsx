import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext/AuthContext.jsx';
import { hasPermission } from '../utils/permissions';
import { COLLEGE_LIST, YEAR_LEVELS, getPrograms, yearLevelOf } from '../utils/academics';
import { getRosterById, listSections, ROSTER_STATUS } from '../services/rosterService';

const ALL_YEARS = 0;

const formatDate = (value) => {
  if (!value) return '—';
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
};

/**
 * Browse verified rosters by department and year level.
 *
 * Reads only the small `classSections` registry up front and pulls a section's
 * student list on demand, so opening the page never downloads every roster.
 * Sections are filtered in memory: the set is small, and filtering there keeps
 * the page working without composite indexes.
 */
function RosterDirectory({ onError }) {
  const { userRole, userPermissions, userPermissionOverrides } = useAuth();

  // Guarded here as well as in the tab bar: this component must never render
  // student lists for a role that is only allowed to submit. An Admin can grant
  // canViewRosters to a single account, so overrides are consulted too.
  const canViewRosters = hasPermission(
    { role: userRole, permissions: userPermissions, permissionOverrides: userPermissionOverrides },
    'canViewRosters'
  );

  const [collegeId, setCollegeId] = useState('');
  const [year, setYear] = useState(ALL_YEARS);
  const [program, setProgram] = useState('');
  const [search, setSearch] = useState('');
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState('');
  const [roster, setRoster] = useState(null);
  const [rosterLoading, setRosterLoading] = useState(false);

  const programs = useMemo(() => getPrograms(collegeId), [collegeId]);

  useEffect(() => {
    if (!canViewRosters) return undefined;
    let cancelled = false;
    setLoading(true);
    listSections()
      .then((list) => {
        if (!cancelled) setSections(list);
      })
      .catch((error) => !cancelled && onError?.(error.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [canViewRosters, onError]);

  // A different department means the chosen program may not exist there.
  useEffect(() => setProgram(''), [collegeId]);

  const visible = useMemo(() => {
    const college = COLLEGE_LIST.find((c) => c.id === collegeId);
    const label = college?.label;
    const term = search.trim().toLowerCase();

    return sections.filter((s) => {
      if (!label || s.college !== label) return false;
      if (program && s.program !== program) return false;
      if (year !== ALL_YEARS && yearLevelOf(s) !== year) return false;
      if (term && !`${s.section} ${s.program} ${s.mayorName}`.toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [sections, collegeId, program, year, search]);

  /** Sections grouped by year, so 1st-4th year reads as an outline. */
  const grouped = useMemo(() => {
    const buckets = YEAR_LEVELS.map((y) => ({ ...y, rows: [] }));
    const unassigned = { value: null, label: 'Unassigned', rows: [] };

    visible.forEach((s) => {
      const level = yearLevelOf(s);
      const bucket = buckets.find((b) => b.value === level);
      (bucket || unassigned).rows.push(s);
    });

    return [...buckets, unassigned].filter((b) => b.rows.length > 0);
  }, [visible]);

  const openSection = useCallback(async (section) => {
    if (!canViewRosters) return;
    if (openId === section.id) {
      setOpenId('');
      setRoster(null);
      return;
    }

    setOpenId(section.id);
    setRoster(null);

    if (!section.currentRosterId) return;

    setRosterLoading(true);
    try {
      const loaded = await getRosterById(section.currentRosterId);
      setRoster(loaded);
    } catch (error) {
      onError?.(error.message);
    } finally {
      setRosterLoading(false);
    }
  }, [openId, onError, canViewRosters]);

  if (!canViewRosters) {
    return null;
  }

  if (!collegeId) {
    return (
      <div style={styles.formWrapper}>
        <h3 style={styles.sectionTitle}>Roster Directory</h3>
        <div style={styles.promptCard}>
          <p style={styles.promptText}>Choose a department to browse its sections.</p>
          <div style={styles.promptButtons}>
            {COLLEGE_LIST.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCollegeId(c.id)}
                style={styles.departmentButton}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.formWrapper}>
      <h3 style={styles.sectionTitle}>Roster Directory</h3>

      <div style={styles.filterRow}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Department</label>
          <select value={collegeId} onChange={(e) => setCollegeId(e.target.value)} style={styles.select}>
            {COLLEGE_LIST.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Year Level</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={styles.select}>
            <option value={ALL_YEARS}>All years</option>
            {YEAR_LEVELS.map((y) => (
              <option key={y.value} value={y.value}>
                {y.label}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Program</label>
          <select value={program} onChange={(e) => setProgram(e.target.value)} style={styles.select}>
            <option value="">All programs</option>
            {programs.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Search</label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Section or Mayor"
            style={styles.input}
          />
        </div>
      </div>

      {loading ? (
        <p style={styles.helperText}>Loading sections…</p>
      ) : visible.length === 0 ? (
        <p style={styles.helperText}>
          No sections match this filter yet. A section appears here once an officer has verified
          its roster.
        </p>
      ) : (
        grouped.map((bucket) => (
          <div key={bucket.label} style={styles.yearGroup}>
            <h4 style={styles.yearHeading}>
              {bucket.label}
              <span style={styles.yearCount}>{bucket.rows.length} section(s)</span>
            </h4>

            {bucket.rows.map((s) => {
              const isOpen = openId === s.id;
              return (
                <div key={s.id} style={styles.sectionCard}>
                  <button type="button" onClick={() => openSection(s)} style={styles.sectionButton}>
                    <span style={styles.sectionName}>{s.section}</span>
                    <span style={styles.sectionMeta}>
                      {s.program} · {s.mayorName} · updated {formatDate(s.updatedAt)}
                    </span>
                    <span style={styles.sectionToggle}>{isOpen ? 'Hide roster' : 'View roster'}</span>
                  </button>

                  {isOpen && (
                    <div style={styles.rosterBody}>
                      {s.status === ROSTER_STATUS.VERIFIED ? (
                        <p style={styles.verifiedNote}>
                          Official roster{roster?.version ? ` · version ${roster.version}` : ''}
                          {roster?.verifiedAt ? ` · verified ${formatDate(roster.verifiedAt)}` : ''}
                        </p>
                      ) : (
                        <p style={styles.helperText}>
                          This section has no verified roster yet, so there is nothing to display.
                        </p>
                      )}

                      {rosterLoading && <p style={styles.helperText}>Loading students…</p>}

                      {!rosterLoading && roster && (
                        <>
                          <p style={styles.countNote}>
                            {roster.students?.length ?? 0} student(s)
                          </p>

                          <div style={styles.tableWrapper}>
                            <table style={styles.table}>
                              <thead>
                                <tr style={styles.tableHeaderRow}>
                                  <th style={styles.tableHeader}>#</th>
                                  <th style={styles.tableHeader}>Student Name</th>
                                  <th style={styles.tableHeader}>Section</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(roster.students ?? []).map((student, i) => (
                                  <tr key={`${student.name}-${i}`} style={styles.tableRow}>
                                    <td style={styles.tableCell}>{i + 1}</td>
                                    <td style={styles.tableCell}>{student.name}</td>
                                    <td style={styles.tableCell}>{student.section || s.section}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}

const styles = {
  formWrapper: {
    backgroundColor: '#5a1a1a',
    borderRadius: '1rem',
    padding: '2rem',
    marginBottom: '2rem',
    border: '1px solid rgba(254, 92, 3, 0.2)',
  },
  sectionTitle: {
    fontSize: '1.5rem',
    color: '#fe5c03',
    marginBottom: '1.5rem',
    fontWeight: 'bold',
    borderBottom: '2px solid rgba(254, 92, 3, 0.3)',
    paddingBottom: '0.5rem',
  },
  promptCard: {
    backgroundColor: '#732020',
    borderRadius: '0.8rem',
    padding: '1.5rem',
  },
  promptText: {
    color: '#f1f1f1',
    marginBottom: '1rem',
  },
  promptButtons: {
    display: 'flex',
    gap: '0.8rem',
    flexWrap: 'wrap',
  },
  departmentButton: {
    padding: '0.8rem 1.5rem',
    backgroundColor: '#fe5c03',
    color: '#000',
    border: 'none',
    borderRadius: '50px',
    fontSize: '0.95rem',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  filterRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: '1rem',
    marginBottom: '1.5rem',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    fontSize: '0.85rem',
    color: '#f1f1f1',
    marginBottom: '0.4rem',
    fontWeight: '600',
  },
  input: {
    padding: '0.7rem',
    border: '1px solid #7a2a2a',
    borderRadius: '0.5rem',
    backgroundColor: '#732020',
    color: '#f1f1f1',
    fontSize: '0.9rem',
    outline: 'none',
  },
  select: {
    padding: '0.7rem',
    border: '1px solid #7a2a2a',
    borderRadius: '0.5rem',
    backgroundColor: '#732020',
    color: '#f1f1f1',
    fontSize: '0.9rem',
    outline: 'none',
    cursor: 'pointer',
  },
  helperText: {
    fontSize: '0.85rem',
    color: '#c0c0c0',
    marginTop: '0.4rem',
  },
  yearGroup: {
    marginBottom: '1.5rem',
  },
  yearHeading: {
    fontSize: '1.05rem',
    color: '#fe5c03',
    marginBottom: '0.8rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
  },
  yearCount: {
    fontSize: '0.75rem',
    color: '#c0c0c0',
    fontWeight: 'normal',
    backgroundColor: '#732020',
    padding: '0.15rem 0.6rem',
    borderRadius: '50px',
  },
  sectionCard: {
    backgroundColor: '#732020',
    borderRadius: '0.8rem',
    marginBottom: '0.7rem',
    border: '1px solid rgba(254, 92, 3, 0.15)',
    overflow: 'hidden',
  },
  sectionButton: {
    width: '100%',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.8rem',
    justifyContent: 'space-between',
    padding: '1rem',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
  },
  sectionName: {
    color: '#f1f1f1',
    fontSize: '1rem',
    fontWeight: 'bold',
  },
  sectionMeta: {
    color: '#c0c0c0',
    fontSize: '0.8rem',
    flex: '1 1 200px',
  },
  sectionToggle: {
    color: '#fe5c03',
    fontSize: '0.8rem',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
  rosterBody: {
    padding: '0 1rem 1rem',
    borderTop: '1px solid rgba(254, 92, 3, 0.15)',
    paddingTop: '1rem',
  },
  verifiedNote: {
    color: '#a5d6a7',
    fontSize: '0.85rem',
    marginBottom: '0.5rem',
  },
  countNote: {
    color: '#f1f1f1',
    fontSize: '0.85rem',
    fontWeight: 'bold',
    marginBottom: '0.5rem',
  },
  tableWrapper: {
    overflowX: 'auto',
    maxHeight: '340px',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    backgroundColor: '#8a2a2a',
  },
  tableHeaderRow: {
    backgroundColor: '#9a3a3a',
  },
  tableHeader: {
    padding: '0.6rem 0.8rem',
    textAlign: 'left',
    color: '#fe5c03',
    fontWeight: 'bold',
    fontSize: '0.85rem',
    borderBottom: '2px solid #fe5c03',
  },
  tableRow: {
    borderBottom: '1px solid rgba(254, 92, 3, 0.1)',
  },
  tableCell: {
    padding: '0.5rem 0.8rem',
    color: '#f1f1f1',
    fontSize: '0.85rem',
  },
};

export default RosterDirectory;
