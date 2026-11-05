import React, { useState } from 'react';
import { 
  FileSpreadsheet, 
  ExternalLink, 
  DownloadCloud, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Layers, 
  ShieldCheck,
  RefreshCw
} from 'lucide-react';
import { useFinance } from '../FinanceContext/FinanceProvider.jsx';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import { 
  exportFiscalPackageToGoogleSheets, 
  getGoogleConnectionStatus, 
  isGoogleOAuthConfigured 
} from '../../services/googleSheetsFinanceSyncService.js';
import styles from './FundGovernance.module.css';

export const FinanceReportExportPanel = () => {
  const { funds, budgets, transactions } = useFinance();
  const { currentUser, userProfile } = useAuth();

  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [exportError, setExportError] = useState(null);
  const [customSpreadsheetId, setCustomSpreadsheetId] = useState('');

  const connectionStatus = getGoogleConnectionStatus();
  const isConfigured = isGoogleOAuthConfigured();

  const handleExport = async (e) => {
    e.preventDefault();
    setIsExporting(true);
    setExportError(null);

    try {
      const result = await exportFiscalPackageToGoogleSheets({
        funds,
        budgets,
        transactions,
        spreadsheetId: customSpreadsheetId.trim() || null,
        user: {
          role: userProfile?.role || 'admin',
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
    <div style={{ padding: '1rem 0' }}>
      {/* Top Banner */}
      <div style={{
        background: 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)',
        color: '#ffffff',
        borderRadius: '16px',
        padding: '2rem',
        marginBottom: '2rem',
        boxShadow: '0 4px 20px -2px rgba(6, 78, 59, 0.25)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{ position: 'relative', zIndex: 1, maxWidth: '680px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.25rem 0.75rem',
            borderRadius: '999px',
            background: 'rgba(255, 255, 255, 0.15)',
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.05em',
            marginBottom: '0.75rem',
          }}>
            <FileSpreadsheet size={14} />
            <span>INSTITUTIONAL AUDIT &amp; SHEETS EXPORT</span>
          </div>
          <h2 style={{ fontSize: '1.65rem', fontWeight: 800, margin: '0 0 0.5rem 0', color: '#ffffff' }}>
            Financial Reports &amp; Google Sheets Archive
          </h2>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#a7f3d0', lineHeight: 1.5 }}>
            Synchronize university double-entry ledgers, approved PPMP matrix allocations, and holding fund balances directly to Google Sheets for legislative auditing, BOR reporting, and institutional compliance.
          </p>
        </div>
      </div>

      {/* Grid Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        {/* Left: Export Action Card */}
        <div style={{
          background: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '1.75rem',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
        }}>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 1rem 0', color: '#0f172a' }}>
            Export Fiscal Package
          </h3>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1.25rem', lineHeight: '1.4' }}>
            Exports a 4-tab workbook containing <strong>Summary KPIs</strong>, <strong>General Ledger</strong>, <strong>Approved Allocations</strong>, and <strong>Holding Funds</strong>.
          </p>

          {exportError && (
            <div style={{
              padding: '0.75rem 1rem',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '10px',
              color: '#991b1b',
              fontSize: '0.85rem',
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <AlertCircle size={16} />
              <span>{exportError}</span>
            </div>
          )}

          {exportResult && (
            <div style={{
              padding: '1rem',
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              borderRadius: '10px',
              color: '#065f46',
              fontSize: '0.85rem',
              marginBottom: '1.25rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, marginBottom: '0.25rem' }}>
                <CheckCircle2 size={16} />
                <span>Export Successful!</span>
              </div>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.8rem' }}>
                Spreadsheet updated with {exportResult.sheetsCount} sheets at {new Date(exportResult.timestamp).toLocaleTimeString()}.
              </p>
              <a
                href={exportResult.spreadsheetUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#047857',
                  textDecoration: 'underline'
                }}
              >
                Open Google Spreadsheet <ExternalLink size={12} />
              </a>
            </div>
          )}

          <form onSubmit={handleExport}>
            <div className={styles.formGroup} style={{ marginBottom: '1.25rem' }}>
              <label className={styles.formLabel} style={{ fontSize: '0.85rem' }}>
                Existing Google Spreadsheet ID (Optional)
              </label>
              <input
                type="text"
                className={styles.formInput}
                placeholder="Leave blank to create a new spreadsheet"
                value={customSpreadsheetId}
                onChange={(e) => setCustomSpreadsheetId(e.target.value)}
              />
              <span style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.25rem', display: 'block' }}>
                Paste an existing Google Sheets ID to update it, or leave empty to auto-generate a fresh report sheet.
              </span>
            </div>

            <button
              type="submit"
              className={styles.primaryBtn}
              disabled={isExporting}
              style={{
                width: '100%',
                padding: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                fontSize: '0.9rem',
                fontWeight: 600,
                background: '#059669',
              }}
            >
              {isExporting ? (
                <>
                  <RefreshCw size={18} className={styles.spin} />
                  <span>Authorizing &amp; Exporting...</span>
                </>
              ) : (
                <>
                  <DownloadCloud size={18} />
                  <span>Sync to Google Sheets</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right: Security & Data Scope Overview */}
        <div style={{
          background: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '1.75rem',
          boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
        }}>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 1rem 0', color: '#0f172a' }}>
            Data Scope &amp; OAuth Status
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '10px' }}>
              <Layers size={20} color="#0284c7" />
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>
                  {transactions.length} Ledger Records
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Posted and reversed transactions across Fiscal, FSG, IGF, IGP
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '10px' }}>
              <ShieldCheck size={20} color="#16a34a" />
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>
                  {budgets.length} PPMP Program Allocations
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Institutional ceilings, disbursements, and surplus tracking
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: '#f8fafc', borderRadius: '10px' }}>
              <Clock size={20} color="#8b5cf6" />
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>
                  Google OAuth 2.0 Integration
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Client ID: {isConfigured ? 'Configured ✅' : 'Missing env ❌'}
                </div>
              </div>
            </div>
          </div>

          <div style={{
            fontSize: '0.75rem',
            color: '#64748b',
            background: '#f1f5f9',
            padding: '0.75rem',
            borderRadius: '8px',
            lineHeight: 1.4,
          }}>
            🔒 <strong>Audit Invariant</strong>: Export requests are stamped into the Firestore Institutional Audit Trail with your officer identity and the target Google Spreadsheet reference.
          </div>
        </div>
      </div>
    </div>
  );
};
export default FinanceReportExportPanel;
