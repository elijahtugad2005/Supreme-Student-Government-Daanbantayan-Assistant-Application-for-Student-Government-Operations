// components/AuditTrail/AuditTrail.jsx
// PURPOSE: Executive Security Audit Trail & Operational Governance Hub
// FEATURES:
//   - Strict clearance: President, Vice President, and Administrator only
//   - Standardized 3-letter security codes (AAD, ADL, IAD, IUP, IDL, DAD, DDL, CDL, etc.)
//   - Zero UID leakage (sanitized human-readable actor identities and timestamps only)
//   - Compact differential payload summaries (concise, scannable, no raw JSON clutter)
//   - Interactive Security Code Legend modal & quick-index reference strip
//   - Real-time Firestore synchronization

import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase/firebaseConfig.js';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot 
} from 'firebase/firestore';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import { 
  AUDIT_CODE_DEFINITIONS, 
  normalizeAuditCode, 
  getAuditCodeMeta 
} from '../../services/auditService.js';
import { 
  ShieldAlert, 
  History, 
  Search, 
  Download, 
  RefreshCw, 
  Clock, 
  Filter, 
  CheckCircle, 
  FolderOpen,
  HelpCircle,
  X,
  Layers,
  Sparkles,
  ChevronRight,
  ShieldCheck,
  Tag
} from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import styles from './AuditTrail.module.css';

// Authorized roles allowed to view institutional audit logs
const AUDIT_AUTHORIZED_ROLES = ['admin', 'president', 'vice_president'];

// Modules for quick filter pills
const MODULE_FILTERS = [
  { id: 'ALL', label: 'All Modules' },
  { id: 'Announcements', label: 'Announcements' },
  { id: 'Inventory', label: 'Inventory' },
  { id: 'Documents', label: 'Documents' },
  { id: 'Commerce Hub', label: 'Commerce' },
  { id: 'Finance', label: 'Finance' },
  { id: 'User Management', label: 'User Mgt' }
];

function AuditTrail() {
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedActionCode, setSelectedActionCode] = useState('ALL');
  const [selectedModule, setSelectedModule] = useState('ALL');
  const [showLegendModal, setShowLegendModal] = useState(false);

  const { currentUser, userRole } = useAuth();
  const { theme } = useTheme();
  const isClassic = theme === 'dark';

  // Strict institutional clearance verification
  const canViewAuditTrail = AUDIT_AUTHORIZED_ROLES.includes(userRole);

  // Real-time synchronization with Firestore audit collection
  useEffect(() => {
    if (!canViewAuditTrail) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const auditQuery = query(
        collection(db, 'audit_logs'),
        orderBy('timestamp', 'desc'),
        limit(150)
      );

      const unsubscribe = onSnapshot(
        auditQuery,
        (snapshot) => {
          const logs = snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data()
          }));
          setAuditLogs(logs);
          setLoading(false);
        },
        (err) => {
          console.error('[AuditTrail] Subscription error:', err);
          setError('Could not establish real-time connection to security audit logs.');
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (err) {
      console.error('[AuditTrail] Initialization error:', err);
      setError('Failed to initialize audit log stream.');
      setLoading(false);
    }
  }, [canViewAuditTrail]);

  // Clean, consistent timestamp formatting
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Recorded';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      }).format(date);
    } catch {
      return 'Recent';
    }
  };

  // Concise differential payload generator (no JSON blobs, human-friendly)
  const formatPayloadSummary = (log) => {
    if (log.summary) return log.summary;
    if (log.notes) return log.notes;

    const changes = log.changes;
    if (!changes) return `Action performed on ${log.itemName || 'resource'}`;

    if (changes.before === null && changes.after) {
      return `+ Added new record for "${log.itemName || 'resource'}"`;
    }
    if (changes.after === null && changes.before) {
      return `- Removed record for "${log.itemName || 'resource'}"`;
    }
    if (changes.before && changes.after) {
      const keys = Object.keys(changes.after).filter(
        k => JSON.stringify(changes.before[k]) !== JSON.stringify(changes.after[k])
      );
      if (keys.length > 0) {
        return `Updated attributes: ${keys.slice(0, 3).join(', ')}`;
      }
    }
    return `Operational mutation on ${log.itemName || 'resource'}`;
  };

  // Search and filter logic
  const filteredLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      const code = normalizeAuditCode(log.action);
      const meta = getAuditCodeMeta(code);

      // Filter by 3-letter action code
      if (selectedActionCode !== 'ALL' && code !== selectedActionCode) {
        return false;
      }

      // Filter by module
      if (selectedModule !== 'ALL') {
        const logModule = (log.module || meta.module || '').toLowerCase();
        if (!logModule.includes(selectedModule.toLowerCase())) {
          return false;
        }
      }

      // Free text search (matches performer, resource, 3-letter code, summary, module)
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchesCode = code.toLowerCase().includes(q);
        const matchesPerformer = (log.performedBy || '').toLowerCase().includes(q);
        const matchesItem = (log.itemName || '').toLowerCase().includes(q);
        const matchesModule = (log.module || meta.module || '').toLowerCase().includes(q);
        const matchesSummary = (log.summary || log.notes || '').toLowerCase().includes(q);
        const matchesLabel = meta.label.toLowerCase().includes(q);

        if (!matchesCode && !matchesPerformer && !matchesItem && !matchesModule && !matchesSummary && !matchesLabel) {
          return false;
        }
      }

      return true;
    });
  }, [auditLogs, selectedActionCode, selectedModule, searchTerm]);

  // Export filtered logs to CSV
  const handleExportCSV = () => {
    if (filteredLogs.length === 0) return;

    const headers = ['Timestamp', 'Code', 'Action', 'Module', 'Performer Name', 'Resource', 'Differential Summary'];
    const rows = filteredLogs.map((log) => {
      const code = normalizeAuditCode(log.action);
      const meta = getAuditCodeMeta(code);
      return [
        `"${formatTimestamp(log.timestamp)}"`,
        `"${code}"`,
        `"${meta.label}"`,
        `"${log.module || meta.module}"`,
        `"${log.performedBy || 'System'}"`,
        `"${log.itemName || 'N/A'}"`,
        `"${(formatPayloadSummary(log)).replace(/"/g, '""')}"`
      ];
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ssg-audit-trail-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // If user does not possess executive clearance
  if (!canViewAuditTrail) {
    return (
      <div className={`${styles.accessDenied} ${isClassic ? styles.accessClassic : ''}`}>
        <div className={styles.accessDeniedCard}>
          {isClassic && <div className={styles.tribalBorderTop} aria-hidden="true" />}
          <div className={styles.accessDeniedIcon}>
            <ShieldAlert size={52} />
          </div>
          <span className={styles.accessDeniedBadge}>RESTRICTED CLEARANCE</span>
          <h3>Executive Security Clearance Required</h3>
          <p>
            The Institutional Audit Trail is restricted exclusively to the <strong>President</strong>, 
            <strong> Vice President</strong>, and verified <strong>System Administrators</strong>.
          </p>
          <div className={styles.clearanceNote}>
            Your current assigned role: <span className={styles.currentRoleBadge}>{userRole || 'Unauthorized'}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.container} ${isClassic ? styles.auditClassic : ''}`}>
      {isClassic && <div className={styles.tribalBorderTop} aria-hidden="true" />}
      {/* Editorial Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.eyebrowBadge}>
            <History size={13} />
            <span>{isClassic ? 'SSG IMMUTABLE INSTITUTIONAL LEDGER' : 'Immutable Institutional Ledger'}</span>
          </div>
          <h1 className={styles.title}>System Audit Trail</h1>
          <p className={styles.subtitle}>
            Real-time chronological telemetry tracking executive dispatches, inventory mutations, 
            official archives, and commerce integrity.
          </p>
        </div>

        <div className={styles.headerMetrics}>
          <div className={styles.metricCard}>
            <span className={styles.metricNum}>{auditLogs.length}</span>
            <span className={styles.metricText}>Total Logs</span>
          </div>
          <div className={styles.metricCard}>
            <span className={styles.metricNum}>{filteredLogs.length}</span>
            <span className={styles.metricText}>Matched</span>
          </div>
        </div>
      </header>

      {/* Module Quick-Filter Bar */}
      <div className={styles.moduleBar}>
        <div className={styles.modulePills}>
          {MODULE_FILTERS.map((mod) => (
            <button
              key={mod.id}
              type="button"
              className={`${styles.modulePill} ${selectedModule === mod.id ? styles.modulePillActive : ''}`}
              onClick={() => setSelectedModule(mod.id)}
            >
              {mod.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setShowLegendModal(true)}
          className={styles.legendTriggerBtn}
          title="Open 3-letter action code index"
        >
          <Tag size={15} />
          <span>Security Code Legend</span>
        </button>
      </div>

      {/* Controls & Search Bar */}
      <div className={styles.controls}>
        <div className={styles.searchContainer}>
          <Search size={18} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search by code (e.g. AAD, CDL), performer name, resource, or action..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={styles.searchInput}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className={styles.clearSearchBtn}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className={styles.filterWrapper}>
          <Filter size={15} className={styles.filterIcon} />
          <select
            value={selectedActionCode}
            onChange={(e) => setSelectedActionCode(e.target.value)}
            className={styles.filterSelect}
            aria-label="Filter by 3-letter security code"
          >
            <option value="ALL">All Security Codes</option>
            <optgroup label="Announcements">
              <option value="AAD">AAD • Announcement Added</option>
              <option value="ADL">ADL • Announcement Deleted</option>
            </optgroup>
            <optgroup label="Inventory">
              <option value="IAD">IAD • Inventory Item Added</option>
              <option value="IUP">IUP • Inventory Item Updated</option>
              <option value="IDL">IDL • Inventory Item Deleted</option>
            </optgroup>
            <optgroup label="Documents">
              <option value="DAD">DAD • Document Added</option>
              <option value="DDL">DDL • Document Deleted</option>
            </optgroup>
            <optgroup label="Commerce Hub">
              <option value="CDL">CDL • Commerce Deletion</option>
            </optgroup>
            <optgroup label="Budget & Finance">
              <option value="BAD">BAD • Budget Added</option>
              <option value="BUP">BUP • Budget Updated</option>
              <option value="BDL">BDL • Budget Deleted</option>
              <option value="EAD">EAD • Expense Added</option>
              <option value="EDL">EDL • Expense Deleted</option>
            </optgroup>
            <optgroup label="User & Role Management">
              <option value="UAD">UAD • User Provisioned</option>
              <option value="UUP">UUP • User Modified</option>
              <option value="UDL">UDL • User Deactivated</option>
              <option value="ROL">ROL • Role Elevation</option>
            </optgroup>
          </select>
        </div>

        <button
          type="button"
          onClick={handleExportCSV}
          className={styles.exportButton}
          disabled={filteredLogs.length === 0}
          title="Export matched logs to CSV"
        >
          <Download size={16} />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className={styles.errorBanner}>
          <ShieldAlert size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className={styles.loadingState}>
          <div className={styles.spinner} />
          <p>Retrieving cryptographic audit logs from server...</p>
        </div>
      )}

      {/* Audit Log Table */}
      {!loading && filteredLogs.length > 0 && (
        <div className={styles.tableCard}>
          <div className={styles.auditTable}>
            <div className={styles.tableHeader}>
              <div className={styles.headerCell} style={{ width: '85px', flexShrink: 0 }}>Code</div>
              <div className={styles.headerCell} style={{ width: '165px', flexShrink: 0 }}>Module</div>
              <div className={styles.headerCell} style={{ width: '155px', flexShrink: 0 }}>Initiator</div>
              <div className={styles.headerCell} style={{ width: '185px', flexShrink: 0 }}>Resource</div>
              <div className={styles.headerCell} style={{ width: '165px', flexShrink: 0 }}>Timestamp</div>
              <div className={styles.headerCell} style={{ flex: 1, minWidth: '220px' }}>Differential Summary</div>
            </div>

            <div className={styles.tableBody}>
              {filteredLogs.map((log) => {
                const code = normalizeAuditCode(log.action);
                const meta = getAuditCodeMeta(code);

                return (
                  <div key={log.id} className={styles.tableRow}>
                    {/* 3-Letter Code Badge */}
                    <div className={styles.tableCell} style={{ width: '85px', flexShrink: 0 }}>
                      <span
                        className={styles.codePill}
                        style={{
                          backgroundColor: meta.bg,
                          color: meta.color,
                          borderColor: meta.border
                        }}
                        title={`${meta.code}: ${meta.label} — ${meta.description}`}
                      >
                        {meta.code}
                      </span>
                    </div>

                    {/* Module */}
                    <div className={styles.tableCell} style={{ width: '165px', flexShrink: 0 }}>
                      <span className={styles.moduleBadge}>
                        <FolderOpen size={12} />
                        <span>{log.module || meta.module}</span>
                      </span>
                    </div>

                    {/* Initiator (Human Name ONLY — No UID) */}
                    <div className={styles.tableCell} style={{ width: '155px', flexShrink: 0 }}>
                      <div className={styles.initiatorBlock}>
                        <strong className={styles.initiatorName}>
                          {log.performedBy || 'Authorized Officer'}
                        </strong>
                      </div>
                    </div>

                    {/* Target / Resource (No UID) */}
                    <div className={styles.tableCell} style={{ width: '185px', flexShrink: 0 }}>
                      <div className={styles.resourceBlock}>
                        <strong className={styles.resourceName} title={log.itemName}>
                          {log.itemName || 'System Resource'}
                        </strong>
                        <span className={styles.resourceType}>
                          {log.itemType || meta.module}
                        </span>
                      </div>
                    </div>

                    {/* Timestamp */}
                    <div className={styles.tableCell} style={{ width: '165px', flexShrink: 0 }}>
                      <div className={styles.timestampContainer}>
                        <Clock size={12} className={styles.timeIcon} />
                        <span className={styles.timestamp}>
                          {formatTimestamp(log.timestamp)}
                        </span>
                      </div>
                    </div>

                    {/* Differential Payload (Single-Line Compact Summary) */}
                    <div className={styles.tableCell} style={{ flex: 1, minWidth: '220px' }}>
                      <div className={styles.payloadSummaryChip}>
                        {formatPayloadSummary(log)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredLogs.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <History size={40} />
          </div>
          <h3>No Matching Audit Dispatches</h3>
          <p>
            {auditLogs.length === 0
              ? 'No institutional transactions have been recorded in this stream yet.'
              : 'Try broadening your search term or clearing the active 3-letter code filter.'}
          </p>
          {(searchTerm || selectedActionCode !== 'ALL' || selectedModule !== 'ALL') && (
            <button
              type="button"
              className={styles.resetFiltersBtn}
              onClick={() => {
                setSearchTerm('');
                setSelectedActionCode('ALL');
                setSelectedModule('ALL');
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      )}

      {/* Quick Visual Code Strip */}
      <div className={styles.quickStrip}>
        <div className={styles.quickStripTitle}>
          <Tag size={13} />
          <span>Active Code Catalog:</span>
        </div>
        <div className={styles.quickStripPills}>
          {Object.values(AUDIT_CODE_DEFINITIONS).map((def) => (
            <button
              key={def.code}
              type="button"
              className={`${styles.stripPill} ${selectedActionCode === def.code ? styles.stripPillActive : ''}`}
              style={{
                borderColor: def.color,
                color: selectedActionCode === def.code ? '#FFFFFF' : def.color,
                backgroundColor: selectedActionCode === def.code ? def.color : def.bg
              }}
              onClick={() => setSelectedActionCode(selectedActionCode === def.code ? 'ALL' : def.code)}
              title={`${def.code} — ${def.label}`}
            >
              <strong className={styles.stripCode}>{def.code}</strong>
              <span className={styles.stripLabel}>{def.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* =====================================================
          INTERACTIVE SECURITY CODE LEGEND MODAL
          ===================================================== */}
      {showLegendModal && (
        <div className={styles.modalOverlay} onClick={() => setShowLegendModal(false)}>
          <div className={`${styles.modalContent} ${isClassic ? styles.modalClassic : ''}`} onClick={(e) => e.stopPropagation()}>
            {isClassic && <div className={styles.tribalBorderTop} aria-hidden="true" />}
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderLeft}>
                <div className={styles.modalBadge}>SECURITY SPECIFICATION</div>
                <h2 className={styles.modalTitle}>Security Action Code Legend</h2>
                <p className={styles.modalSubtitle}>
                  Institutional telemetry uses standardized 3-letter codes for instantaneous threat detection and operational auditing.
                </p>
              </div>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setShowLegendModal(false)}
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            </div>

            <div className={styles.legendGrid}>
              {/* Announcements Section */}
              <div className={styles.legendGroup}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupIcon}>📢</span>
                  <h4>Announcements</h4>
                  <span className={styles.groupScope}>Add & Delete Only (No Edits)</span>
                </div>
                <div className={styles.groupCards}>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.AAD.bg, color: AUDIT_CODE_DEFINITIONS.AAD.color, borderColor: AUDIT_CODE_DEFINITIONS.AAD.border }}>
                      AAD
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Announcement Added</h5>
                      <p>Triggered whenever a campus bulletin or broadcast is published.</p>
                    </div>
                  </div>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.ADL.bg, color: AUDIT_CODE_DEFINITIONS.ADL.color, borderColor: AUDIT_CODE_DEFINITIONS.ADL.border }}>
                      ADL
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Announcement Deleted</h5>
                      <p>Triggered when a bulletin is permanently purged from the registry.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Inventory Section */}
              <div className={styles.legendGroup}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupIcon}>📦</span>
                  <h4>Inventory</h4>
                  <span className={styles.groupScope}>Full CRUD (Add, Update, Delete)</span>
                </div>
                <div className={styles.groupCards}>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.IAD.bg, color: AUDIT_CODE_DEFINITIONS.IAD.color, borderColor: AUDIT_CODE_DEFINITIONS.IAD.border }}>
                      IAD
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Inventory Item Added</h5>
                      <p>Triggered when new assets, tools, or physical equipment are enrolled.</p>
                    </div>
                  </div>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.IUP.bg, color: AUDIT_CODE_DEFINITIONS.IUP.color, borderColor: AUDIT_CODE_DEFINITIONS.IUP.border }}>
                      IUP
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Inventory Updated</h5>
                      <p>Triggered on stock adjustments, location relocations, or details changes.</p>
                    </div>
                  </div>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.IDL.bg, color: AUDIT_CODE_DEFINITIONS.IDL.color, borderColor: AUDIT_CODE_DEFINITIONS.IDL.border }}>
                      IDL
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Inventory Deleted</h5>
                      <p>Triggered when an equipment or item record is decommissioned.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Documents Section */}
              <div className={styles.legendGroup}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupIcon}>📄</span>
                  <h4>Documents</h4>
                  <span className={styles.groupScope}>Add & Delete Only (No Edits/Views)</span>
                </div>
                <div className={styles.groupCards}>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.DAD.bg, color: AUDIT_CODE_DEFINITIONS.DAD.color, borderColor: AUDIT_CODE_DEFINITIONS.DAD.border }}>
                      DAD
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Document Added</h5>
                      <p>Triggered when resolutions, memorandum files, or PDFs are uploaded.</p>
                    </div>
                  </div>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.DDL.bg, color: AUDIT_CODE_DEFINITIONS.DDL.color, borderColor: AUDIT_CODE_DEFINITIONS.DDL.border }}>
                      DDL
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Document Deleted</h5>
                      <p>Triggered when an official document is purged from the archives.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Commerce Hub Section */}
              <div className={styles.legendGroup}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupIcon}>🛍️</span>
                  <h4>Commerce Hub</h4>
                  <span className={styles.groupScope}>Deletions Only (Gated Permission)</span>
                </div>
                <div className={styles.groupCards}>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.CDL.bg, color: AUDIT_CODE_DEFINITIONS.CDL.color, borderColor: AUDIT_CODE_DEFINITIONS.CDL.border }}>
                      CDL
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Commerce Deletion</h5>
                      <p>
                        Triggered when store merchandise or catalog items are purged. 
                        <strong> Restricted to: Finance Secretary, Executive Secretary, President, VP, Admin.</strong>
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Finance Section */}
              <div className={styles.legendGroup}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupIcon}>💰</span>
                  <h4>Finance & Treasury</h4>
                  <span className={styles.groupScope}>Fiscal Mutations</span>
                </div>
                <div className={styles.groupCards}>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.BAD.bg, color: AUDIT_CODE_DEFINITIONS.BAD.color, borderColor: AUDIT_CODE_DEFINITIONS.BAD.border }}>
                      BAD
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Budget Added</h5>
                      <p>New department or project budget allocations created.</p>
                    </div>
                  </div>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.BUP.bg, color: AUDIT_CODE_DEFINITIONS.BUP.color, borderColor: AUDIT_CODE_DEFINITIONS.BUP.border }}>
                      BUP
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Budget Updated</h5>
                      <p>Budget amounts, categorizations, or allocation adjustments.</p>
                    </div>
                  </div>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.BDL.bg, color: AUDIT_CODE_DEFINITIONS.BDL.color, borderColor: AUDIT_CODE_DEFINITIONS.BDL.border }}>
                      BDL
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Budget Deleted</h5>
                      <p>Allocation line items removed from the ledger.</p>
                    </div>
                  </div>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.EAD.bg, color: AUDIT_CODE_DEFINITIONS.EAD.color, borderColor: AUDIT_CODE_DEFINITIONS.EAD.border }}>
                      EAD
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Expense Added</h5>
                      <p>Disbursements and operational expenses filed.</p>
                    </div>
                  </div>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.EDL.bg, color: AUDIT_CODE_DEFINITIONS.EDL.color, borderColor: AUDIT_CODE_DEFINITIONS.EDL.border }}>
                      EDL
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Expense Deleted</h5>
                      <p>Disbursement transaction cancelled or removed.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* User Management Section */}
              <div className={styles.legendGroup}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupIcon}>👤</span>
                  <h4>Security & Access</h4>
                  <span className={styles.groupScope}>Identity Administration</span>
                </div>
                <div className={styles.groupCards}>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.UAD.bg, color: AUDIT_CODE_DEFINITIONS.UAD.color, borderColor: AUDIT_CODE_DEFINITIONS.UAD.border }}>
                      UAD
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>User Provisioned</h5>
                      <p>New student leader or officer credentials generated.</p>
                    </div>
                  </div>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.UUP.bg, color: AUDIT_CODE_DEFINITIONS.UUP.color, borderColor: AUDIT_CODE_DEFINITIONS.UUP.border }}>
                      UUP
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>User Modified</h5>
                      <p>Officer profile, status, or organization details altered.</p>
                    </div>
                  </div>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.UDL.bg, color: AUDIT_CODE_DEFINITIONS.UDL.color, borderColor: AUDIT_CODE_DEFINITIONS.UDL.border }}>
                      UDL
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>User Deactivated</h5>
                      <p>Account suspended or permanently deleted from directory.</p>
                    </div>
                  </div>
                  <div className={styles.legendCard}>
                    <span className={styles.legendCodeBadge} style={{ backgroundColor: AUDIT_CODE_DEFINITIONS.ROL.bg, color: AUDIT_CODE_DEFINITIONS.ROL.color, borderColor: AUDIT_CODE_DEFINITIONS.ROL.border }}>
                      ROL
                    </span>
                    <div className={styles.legendCardInfo}>
                      <h5>Role Elevation</h5>
                      <p>Tier advancement or specific route permission override granted.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.modalDoneBtn}
                onClick={() => setShowLegendModal(false)}
              >
                Close Legend
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AuditTrail;