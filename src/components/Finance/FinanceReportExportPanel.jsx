import React, { useState } from 'react';
import { 
  FileSpreadsheet, 
  ExternalLink, 
  DownloadCloud, 
  CheckCircle2, 
  AlertCircle, 
  Layers, 
  ShieldCheck,
  RefreshCw,
  FolderPlus,
  FileEdit,
  Building2,
  TableProperties
} from 'lucide-react';
import { useFinance } from '../FinanceContext/FinanceProvider.jsx';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import usePermissions from '../../hooks/usePermissions.js';
import { 
  exportFiscalPackageToGoogleSheets, 
  getGoogleConnectionStatus, 
  isGoogleOAuthConfigured 
} from '../../services/googleSheetsFinanceSyncService.js';
import styles from './FinanceReportExportPanel.module.css';

export const FinanceReportExportPanel = () => {
  const { fundAccounts, budgetAllocations, transactions, funds, budgets } = useFinance();
  const { currentUser, userProfile } = useAuth();
  const { canPostFinanceLedger, role } = usePermissions();

  // Use redesigned arrays with backward-compatible fallbacks
  const activeFunds = Array.isArray(fundAccounts) && fundAccounts.length > 0 ? fundAccounts : (Array.isArray(funds) ? funds : []);
  const activeBudgets = Array.isArray(budgetAllocations) && budgetAllocations.length > 0 ? budgetAllocations : (Array.isArray(budgets) ? budgets : []);
  const activeTransactions = Array.isArray(transactions) ? transactions : [];

  const [exportMode, setExportMode] = useState('new'); // 'new' | 'existing'
  const [customSpreadsheetId, setCustomSpreadsheetId] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [exportError, setExportError] = useState(null);

  const connectionStatus = getGoogleConnectionStatus();
  const isConfigured = isGoogleOAuthConfigured();

  const handleExport = async (e) => {
    e.preventDefault();
    setIsExporting(true);
    setExportError(null);

    const targetSpreadsheetId = exportMode === 'existing' ? customSpreadsheetId.trim() : null;

    try {
      const result = await exportFiscalPackageToGoogleSheets({
        funds: activeFunds.length > 0 ? activeFunds : funds,
        budgets: activeBudgets,
        transactions: activeTransactions,
        spreadsheetId: targetSpreadsheetId || null,
        user: {
          role: userProfile?.role || role || 'admin',
          displayName: userProfile?.displayName || currentUser?.displayName,
          email: currentUser?.email,
        },
      });
      setExportResult(result);
    } catch (err) {
      setExportError(err.message || 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={styles.wrapper}>
      {/* Top Governance Bar */}
      <div className={styles.governanceBar}>
        <div className={styles.governanceLeft}>
          <div className={canPostFinanceLedger ? styles.operatorBadge : styles.roleBadgeReadOnly}>
            <ShieldCheck size={14} />
            <span>{canPostFinanceLedger ? 'Authorized Operator' : 'Auditor / Viewer'}</span>
          </div>
          <span style={{ fontSize: '0.825rem', color: '#64748b' }}>
            Officer: <strong>{userProfile?.displayName || currentUser?.email || 'Authenticated User'}</strong> ({role || 'operator'})
          </span>
        </div>

        <div className={styles.governanceRight}>
          <div className={`${styles.oauthPill} ${connectionStatus.connected ? styles.oauthConnected : styles.oauthDisconnected}`}>
            <span>Google GIS OAuth:</span>
            <strong>{connectionStatus.connected ? 'Connected' : isConfigured ? 'Ready to Authorize' : 'Config Required'}</strong>
          </div>
        </div>
      </div>

      {/* Hero Banner */}
      <div className={styles.heroBanner}>
        <div className={styles.heroContent}>
          <div className={styles.heroTag}>
            <FileSpreadsheet size={13} />
            <span>Institutional Audit &amp; Sheets Sync</span>
          </div>
          <h2 className={styles.heroTitle}>
            Financial Reports &amp; Google Sheets Archive
          </h2>
          <p className={styles.heroDescription}>
            Synchronize university double-entry general ledgers, approved PPMP matrix allocations, and auxiliary holding fund balances directly to Google Sheets for legislative auditing, BOR reporting, and institutional compliance.
          </p>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className={styles.layoutGrid}>
        {/* Left Column: Export Action & Destination Configuration */}
        <div className={styles.card}>
          <div>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>
                <DownloadCloud size={18} color="#059669" />
                <span>Export Fiscal Package</span>
              </h3>
            </div>

            <p className={styles.cardSubtitle}>
              Export a live, multi-tab audit workbook directly to Google Drive and Google Sheets.
            </p>

            {/* Mode Selector */}
            <div className={styles.modeSelector}>
              <button
                type="button"
                className={`${styles.modeOption} ${exportMode === 'new' ? styles.modeOptionActive : ''}`}
                onClick={() => setExportMode('new')}
              >
                <div className={styles.modeOptionTitle}>
                  <FolderPlus size={15} color={exportMode === 'new' ? '#059669' : '#64748b'} />
                  <span>Create New Sheet</span>
                </div>
                <span className={styles.modeOptionDesc}>
                  Auto-generates a timestamped SSG Fiscal Workbook in Google Drive.
                </span>
              </button>

              <button
                type="button"
                className={`${styles.modeOption} ${exportMode === 'existing' ? styles.modeOptionActive : ''}`}
                onClick={() => setExportMode('existing')}
              >
                <div className={styles.modeOptionTitle}>
                  <FileEdit size={15} color={exportMode === 'existing' ? '#059669' : '#64748b'} />
                  <span>Update Existing</span>
                </div>
                <span className={styles.modeOptionDesc}>
                  Overwrites or appends into an existing Google Spreadsheet ID.
                </span>
              </button>
            </div>

            {/* Error Feedback */}
            {exportError && (
              <div className={styles.alertError} role="alert">
                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Export Failed</strong>
                  <div>{exportError}</div>
                </div>
              </div>
            )}

            {/* Success Feedback */}
            {exportResult && (
              <div className={styles.alertSuccess}>
                <div className={styles.successHeader}>
                  <CheckCircle2 size={18} color="#059669" />
                  <span>Workbook Synchronized Successfully!</span>
                </div>
                <div>
                  Updated {exportResult.sheetsCount} sheets at {new Date(exportResult.timestamp).toLocaleTimeString()}.
                </div>
                <a
                  href={exportResult.spreadsheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.sheetLinkBtn}
                >
                  <span>Open Google Spreadsheet</span>
                  <ExternalLink size={13} />
                </a>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleExport}>
              {exportMode === 'existing' && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel} htmlFor="spreadsheetIdInput">
                    Target Google Spreadsheet ID or URL
                  </label>
                  <input
                    id="spreadsheetIdInput"
                    type="text"
                    className={styles.formInput}
                    placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
                    value={customSpreadsheetId}
                    onChange={(e) => setCustomSpreadsheetId(e.target.value)}
                    required
                  />
                  <span className={styles.formHint}>
                    Paste the Spreadsheet ID from the URL: docs.google.com/spreadsheets/d/<strong>[SPREADSHEET_ID]</strong>/edit
                  </span>
                </div>
              )}

              <button
                type="submit"
                className={styles.exportBtn}
                disabled={isExporting}
              >
                {isExporting ? (
                  <>
                    <RefreshCw size={18} className={styles.spin} />
                    <span>Synchronizing with Google Sheets...</span>
                  </>
                ) : (
                  <>
                    <DownloadCloud size={18} />
                    <span>{exportMode === 'new' ? 'Generate & Sync New Fiscal Sheet' : 'Update Target Spreadsheet'}</span>
                  </>
                )}
              </button>
            </form>
          </div>

          <div className={styles.auditNotice}>
            <ShieldCheck size={16} color="#059669" style={{ flexShrink: 0 }} />
            <span>
              <strong>Audit Trail Guaranteed:</strong> Every export event is stamped into the Firestore Institutional Audit Trail with officer ID and spreadsheet link.
            </span>
          </div>
        </div>

        {/* Right Column: Workbook Structure & Scope Overview */}
        <div className={styles.card}>
          <div>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>
                <TableProperties size={18} color="#0284c7" />
                <span>Workbook Architecture</span>
              </h3>
            </div>

            <p className={styles.cardSubtitle}>
              The fiscal export builds a standardized 4-tab institutional audit workbook with strict data lineage:
            </p>

            <div className={styles.sheetsStructureList}>
              <div className={styles.sheetTabItem}>
                <div className={styles.sheetTabNumber}>1</div>
                <div className={styles.sheetTabDetails}>
                  <div className={styles.sheetTabName}>
                    <span>Summary KPIs</span>
                    <span className={styles.sheetTabCount}>Overview</span>
                  </div>
                  <div className={styles.sheetTabSummary}>
                    Campus headline reserves, active fiscal year, net liquid balance, and total budget allocations.
                  </div>
                </div>
              </div>

              <div className={styles.sheetTabItem}>
                <div className={styles.sheetTabNumber}>2</div>
                <div className={styles.sheetTabDetails}>
                  <div className={styles.sheetTabName}>
                    <span>General Ledger</span>
                    <span className={styles.sheetTabCount}>{activeTransactions.length} records</span>
                  </div>
                  <div className={styles.sheetTabSummary}>
                    Immutable chronological transaction ledger with double-entry reference IDs, payees, allocations, and reversal logs.
                  </div>
                </div>
              </div>

              <div className={styles.sheetTabItem}>
                <div className={styles.sheetTabNumber}>3</div>
                <div className={styles.sheetTabDetails}>
                  <div className={styles.sheetTabName}>
                    <span>Approved Allocations</span>
                    <span className={styles.sheetTabCount}>{activeBudgets.length} lines</span>
                  </div>
                  <div className={styles.sheetTabSummary}>
                    PPMP departmental budget ceilings, disbursed totals, remaining balance, and approval timestamps.
                  </div>
                </div>
              </div>

              <div className={styles.sheetTabItem}>
                <div className={styles.sheetTabNumber}>4</div>
                <div className={styles.sheetTabDetails}>
                  <div className={styles.sheetTabName}>
                    <span>Holding Funds</span>
                    <span className={styles.sheetTabCount}>{activeFunds.length} accounts</span>
                  </div>
                  <div className={styles.sheetTabSummary}>
                    Current balances across Fiscal Operating, FSG Trust, IGF Student Supply, and IGP Campus Projects.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.complianceNotice}>
            <Building2 size={16} style={{ flexShrink: 0 }} />
            <span>
              Format conforms to CTU Supreme Student Government Financial By-Laws &amp; Commission on Audit (COA) standards.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FinanceReportExportPanel;
