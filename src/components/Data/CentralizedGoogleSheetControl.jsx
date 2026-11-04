import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BookOpen,
  CheckCircle,
  ExternalLink,
  FilePlus2,
  FileSpreadsheet,
  History,
  Link2,
  Lock,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  COMMERCE_HUB_ORDER_TEMPLATE_COLUMNS,
  canManageCentralizedOrderSheet,
} from './centralizedOrderSheetOrchestrator.js';
import { ordersMapping } from './sheetMappingConfig.js';
import {
  connectGoogleSheetsAccount,
  createBrowserCentralizedOrderSheetOrchestrator,
  disconnectGoogleSheetsAccount,
  getGoogleConnectionStatus,
  isGoogleOAuthConfigured,
  subscribeToCentralizedOrderSheet,
} from '../../services/googleSheetsOrderSyncService.js';
import GoogleSheetsSyncGuideModal from './GoogleSheetsSyncGuideModal.jsx';
import styles from './CentralizedGoogleSheetControl.module.css';

function formatSyncTimestamp(iso) {
  if (!iso) return 'Never synced';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function CentralizedGoogleSheetControl({
  actorUser,
  centralSheetProp = undefined,
  autoPushEnabled = false,
  onToggleAutoPush = null,
  onSyncCompleted = null,
}) {
  const canManage = useMemo(() => canManageCentralizedOrderSheet(actorUser), [actorUser]);
  const orchestrator = useMemo(
    () => createBrowserCentralizedOrderSheetOrchestrator(actorUser),
    [actorUser]
  );

  // Live sheet settings (uses parent subscription if passed, otherwise subscribes directly)
  const [internalSheet, setInternalSheet] = useState(null);
  useEffect(() => {
    if (centralSheetProp !== undefined) return undefined;
    const unsub = subscribeToCentralizedOrderSheet((docData) => {
      setInternalSheet(docData);
    });
    return () => unsub();
  }, [centralSheetProp]);

  const centralSheet = centralSheetProp !== undefined ? centralSheetProp : internalSheet;

  // OAuth & UI state
  const oauthConfigured = isGoogleOAuthConfigured();
  const [googleConnected, setGoogleConnected] = useState(
    () => getGoogleConnectionStatus().connected
  );
  const [busyAction, setBusyAction] = useState(''); // '', 'oauth', 'create', 'inspect', 'assign', 'preview_pull', 'commit_pull', 'push', 'reconcile'
  const [statusNotice, setStatusNotice] = useState(null); // { type: 'info' | 'warning' | 'danger', title, message }
  const [handoffError, setHandoffError] = useState(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Create / Assign Builder state
  const [showBuilder, setShowBuilder] = useState(false);
  const [builderTab, setBuilderTab] = useState('create'); // 'create' | 'assign'
  const [newSheetTitle, setNewSheetTitle] = useState('SSG Commerce Hub Orders — Master Record');
  const [templateMode, setTemplateMode] = useState('prefilled'); // 'blank' | 'prefilled'

  // Existing Sheet Assignment state
  const [existingUrlInput, setExistingUrlInput] = useState('');
  const [inspectedMeta, setInspectedMeta] = useState(null);
  const [selectedTabTitle, setSelectedTabTitle] = useState('');
  const [tabInspection, setTabInspection] = useState(null);
  const [customMappings, setCustomMappings] = useState({});
  const [showCustomMapper, setShowCustomMapper] = useState(false);

  // Pull Diff Preview state
  const [pullPreview, setPullPreview] = useState(null);

  const uniqueSheetHeaders = useMemo(() => {
    const raw = Array.isArray(tabInspection?.headers) ? tabInspection.headers : [];
    const seen = new Set();
    const out = [];
    for (const h of raw) {
      const clean = String(h ?? '').trim();
      if (!clean) continue;
      const lower = clean.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push(clean);
    }
    return out;
  }, [tabInspection]);

  const duplicateMappedColumns = useMemo(() => {
    const counts = new Map();
    for (const col of Object.values(customMappings || {})) {
      const clean = String(col ?? '').trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      counts.set(key, { label: clean, count: (counts.get(key)?.count || 0) + 1 });
    }
    return [...counts.values()].filter((entry) => entry.count > 1).map((entry) => entry.label);
  }, [customMappings]);

  const refreshConnectionFlag = () => {
    setGoogleConnected(getGoogleConnectionStatus().connected);
  };

  const handleError = (err, fallbackTitle = 'Google Sheets Operation Failed') => {
    refreshConnectionFlag();
    const code = err?.code || '';

    if (code === 'SHEET_ACCESS_DENIED') {
      setHandoffError({
        ownerName: err.ownerName || centralSheet?.assignedByName || 'Sheet Owner',
        ownerEmail: err.ownerEmail || centralSheet?.assignedByEmail || '',
        spreadsheetUrl: err.spreadsheetUrl || centralSheet?.spreadsheetUrl || '',
        message: err.message,
      });
      return;
    }

    const friendlyMap = {
      GOOGLE_SESSION_EXPIRED: {
        type: 'warning',
        title: 'Google Sign-In Needed',
        actionKind: 'connect',
        actionLabel: 'Connect Google Account',
      },
      OAUTH_POPUP_CLOSED: {
        type: 'warning',
        title: 'Google Sign-In Window Was Closed',
        actionKind: 'connect',
        actionLabel: 'Connect Google Account',
      },
      OAUTH_POPUP_BLOCKED: {
        type: 'warning',
        title: 'Browser Blocked the Google Sign-In Popup',
        actionKind: 'connect',
        actionLabel: 'Retry Google Sign-In',
      },
      OAUTH_ACCESS_DENIED: {
        type: 'danger',
        title: 'Google Sign-In Declined (Error 403: access_denied)',
        actionKind: 'guide',
        actionLabel: 'Open Syncing Guide',
      },
      SHEET_TAB_NOT_FOUND: {
        type: 'warning',
        title: 'Worksheet Tab Was Renamed or Deleted in Google Sheets',
        actionKind: 'repick_tab',
        actionLabel: 'Re-pick Worksheet Tab',
      },
      SHEET_RANGE_PROTECTED: {
        type: 'warning',
        title: 'Locked / Protected Cells in Google Sheet',
      },
      SHEET_NOT_FOUND: {
        type: 'danger',
        title: 'Google Sheet Could Not Be Found (404)',
      },
      SHEET_RATE_LIMITED: {
        type: 'warning',
        title: 'Please Wait a Moment — Google Sheets Is Busy',
      },
      NETWORK_OFFLINE: {
        type: 'warning',
        title: 'Internet Connection Interrupted',
      },
      PUBLISHED_WEB_URL_NOT_EDITABLE: {
        type: 'warning',
        title: '"Publish to Web" Link Cannot Be Edited',
      },
      WRONG_GOOGLE_LINK_TYPE: {
        type: 'warning',
        title: 'Wrong Google Link Type Pasted',
      },
      INVALID_SHEET_URL: {
        type: 'warning',
        title: 'Incomplete Google Sheet Link',
      },
      DUPLICATE_COLUMN_MAPPING: {
        type: 'warning',
        title: 'Same Column Selected Twice',
      },
    };

    const mapped = friendlyMap[code];
    setStatusNotice({
      type: mapped?.type || 'danger',
      title: mapped?.title || fallbackTitle,
      message:
        err?.message || 'An unexpected error occurred while communicating with Google Sheets.',
      actionKind: mapped?.actionKind || '',
      actionLabel: mapped?.actionLabel || '',
    });
  };

  const handleConnectGoogle = async () => {
    setBusyAction('oauth');
    setStatusNotice(null);
    setHandoffError(null);
    try {
      await connectGoogleSheetsAccount({
        prompt: 'consent',
        loginHint: actorUser?.email || '',
      });
      refreshConnectionFlag();
      setStatusNotice({
        type: 'info',
        title: 'Google Account Connected',
        message: 'Authorized Google Sheets Read/Write session active for Commerce Hub Orders.',
      });
    } catch (err) {
      handleError(err, 'Google Authorization Failed');
    } finally {
      setBusyAction('');
    }
  };

  const handleDisconnectGoogle = () => {
    disconnectGoogleSheetsAccount();
    refreshConnectionFlag();
    if (onToggleAutoPush && autoPushEnabled) {
      onToggleAutoPush(false);
    }
    setStatusNotice({
      type: 'info',
      title: 'Google Session Disconnected',
      message: 'Your temporary Google Sheets access token has been cleared from this browser tab.',
    });
  };

  const handleCreateTemplate = async () => {
    setBusyAction('create');
    setStatusNotice(null);
    setHandoffError(null);
    try {
      const saved = await orchestrator.createTemplateSheet({
        title: newSheetTitle.trim() || 'SSG Commerce Hub Orders — Master Record',
        mode: templateMode,
      });
      refreshConnectionFlag();
      setShowBuilder(false);
      setPullPreview(null);
      setStatusNotice({
        type: 'info',
        title: 'Centralized Order Sheet Created',
        message: `"${saved.spreadsheetTitle}" is now the official centralized Order sheet (${
          templateMode === 'prefilled' ? 'pre-filled with current orders' : 'blank 18-column template'
        }). Use Google Sheets' Share button to add fellow Secretaries or Viewers.`,
      });
    } catch (err) {
      handleError(err, 'Unable to Create Order Template');
    } finally {
      setBusyAction('');
    }
  };

  const inspectTabByTitle = async (urlOrId, tabTitle) => {
    const inspection = await orchestrator.inspectWorksheetTab(urlOrId, tabTitle);
    setTabInspection(inspection);
    setCustomMappings(inspection.detectedMappings || {});
    setShowCustomMapper(!inspection.isEmpty && !inspection.isStandardTemplate);
  };

  const handleInspectExistingUrl = async () => {
    if (!existingUrlInput.trim()) return;
    setBusyAction('inspect');
    setStatusNotice(null);
    setHandoffError(null);
    try {
      const meta = await orchestrator.inspectExistingSpreadsheet(existingUrlInput.trim());
      refreshConnectionFlag();
      setInspectedMeta(meta);
      const firstTab = meta.tabs?.[0]?.sheetTitle || 'Sheet1';
      setSelectedTabTitle(firstTab);
      await inspectTabByTitle(meta.spreadsheetId, firstTab);
    } catch (err) {
      handleError(err, 'Unable to Inspect Google Sheet');
    } finally {
      setBusyAction('');
    }
  };

  const handleSelectWorksheetTab = async (nextTabTitle) => {
    setSelectedTabTitle(nextTabTitle);
    if (!inspectedMeta?.spreadsheetId) return;
    setBusyAction('inspect');
    try {
      await inspectTabByTitle(inspectedMeta.spreadsheetId, nextTabTitle);
    } catch (err) {
      handleError(err, 'Unable to Read Worksheet Tab');
    } finally {
      setBusyAction('');
    }
  };

  const handleAssignExistingSheet = async () => {
    if (!inspectedMeta?.spreadsheetId || !selectedTabTitle) return;
    setBusyAction('assign');
    setStatusNotice(null);
    setHandoffError(null);
    try {
      const targetTab = inspectedMeta.tabs.find((t) => t.sheetTitle === selectedTabTitle);
      const saved = await orchestrator.assignExistingSheet({
        urlOrId: inspectedMeta.spreadsheetId,
        sheetId: targetTab?.sheetId ?? 0,
        sheetTitle: selectedTabTitle,
        initializeIfBlank: true,
        customMappings:
          tabInspection && !tabInspection.isEmpty && !tabInspection.isStandardTemplate
            ? customMappings
            : null,
      });
      refreshConnectionFlag();
      setShowBuilder(false);
      setInspectedMeta(null);
      setTabInspection(null);
      setExistingUrlInput('');
      setPullPreview(null);
      setStatusNotice({
        type: 'info',
        title: 'Centralized Google Sheet Assigned',
        message: `"${saved.spreadsheetTitle}" [Tab: ${saved.sheetTitle}] is now linked as the centralized Commerce Hub Order record.`,
      });
    } catch (err) {
      handleError(err, 'Unable to Assign Google Sheet');
    } finally {
      setBusyAction('');
    }
  };

  const handlePreviewPull = async () => {
    setBusyAction('preview_pull');
    setStatusNotice(null);
    setHandoffError(null);
    try {
      const preview = await orchestrator.previewPullFromSheet();
      refreshConnectionFlag();
      setPullPreview(preview);
    } catch (err) {
      handleError(err, 'Pull Preview Failed');
    } finally {
      setBusyAction('');
    }
  };

  const handleCommitPull = async () => {
    if (!pullPreview) return;
    setBusyAction('commit_pull');
    setStatusNotice(null);
    setHandoffError(null);
    try {
      const res = await orchestrator.commitPullFromSheet(pullPreview);
      refreshConnectionFlag();
      setPullPreview(null);
      setStatusNotice({
        type: 'info',
        title: 'Pull Completed (Sheet → Commerce Hub)',
        message: `Created ${res.created} new order(s), updated ${res.updated} pending order(s), and protected ${res.protectedCount} Claimed/IGF-Synced order(s).`,
      });
      if (onSyncCompleted) onSyncCompleted(res);
    } catch (err) {
      handleError(err, 'Commit Pull Failed');
    } finally {
      setBusyAction('');
    }
  };

  const handlePushToSheet = async () => {
    setBusyAction('push');
    setStatusNotice(null);
    setHandoffError(null);
    try {
      const res = await orchestrator.pushOrdersToSheet();
      refreshConnectionFlag();
      setPullPreview(null);
      setStatusNotice({
        type: 'info',
        title: 'Push Completed (Commerce Hub → Sheet)',
        message: `Updated ${res.updatedInSheet} existing sheet row(s) and appended ${res.appendedToSheet} order(s) to Google Sheets.`,
      });
    } catch (err) {
      handleError(err, 'Push to Google Sheet Failed');
    } finally {
      setBusyAction('');
    }
  };

  const handleTwoWayReconcile = async () => {
    setBusyAction('reconcile');
    setStatusNotice(null);
    setHandoffError(null);
    try {
      const res = await orchestrator.reconcileTwoWay();
      refreshConnectionFlag();
      setPullPreview(null);
      setStatusNotice({
        type: 'info',
        title: 'Two-Way Reconciliation Complete',
        message: `Commerce Hub (+${res.createdInApp} new, ~${res.updatedInApp} updated, ${res.protectedCount} IGF/Claimed protected) ⇄ Google Sheet (~${res.updatedInSheet} updated, +${res.appendedToSheet} appended).`,
      });
      if (onSyncCompleted && (res.createdInApp > 0 || res.updatedInApp > 0)) {
        onSyncCompleted(res);
      }
    } catch (err) {
      handleError(err, 'Two-Way Reconcile Failed');
    } finally {
      setBusyAction('');
    }
  };

  const isAssigningOrEmpty = !centralSheet?.spreadsheetId || showBuilder;

  return (
    <div className={styles.wrapper}>
      {/* Governance & OAuth Bar */}
      <div className={styles.governanceBar}>
        <div className={styles.governanceLeft}>
          {canManage ? (
            <span className={`${styles.roleBadge} ${styles.roleBadgeAuthorized}`}>
              <ShieldCheck size={14} />
              Secretariat Sync Authority
            </span>
          ) : (
            <span className={`${styles.roleBadge} ${styles.roleBadgeReadOnly}`}>
              <Lock size={14} />
              View-Only • Secretariat Managed
            </span>
          )}

          {canManage && (
            <span
              className={`${styles.oauthPill} ${
                googleConnected ? styles.oauthConnected : styles.oauthDisconnected
              }`}
            >
              <span className={styles.statusDot} />
              {googleConnected ? 'Google Account Connected' : 'Google Account Not Connected'}
            </span>
          )}

          <span className={styles.recordingNotice}>
            Shared Order Logbook • Claiming &amp; IGF funds stay protected in Commerce Hub
          </span>
        </div>

        <div className={styles.governanceRight}>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setGuideOpen(true)}
          >
            <BookOpen size={15} />
            Guide in Syncing &amp; How Google Sheets Works
          </button>

          {canManage && oauthConfigured && (
            <>
              <button
                type="button"
                className={googleConnected ? styles.btnSecondary : styles.btnPrimary}
                onClick={handleConnectGoogle}
                disabled={Boolean(busyAction)}
              >
                {busyAction === 'oauth' ? (
                  <RefreshCw size={15} className={styles.spin} />
                ) : (
                  <Link2 size={15} />
                )}
                {googleConnected ? 'Reconnect Google' : 'Connect Google Account'}
              </button>
              {googleConnected && (
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={handleDisconnectGoogle}
                  disabled={Boolean(busyAction)}
                >
                  Disconnect
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Missing Client ID Warning for Secretaries */}
      {canManage && !oauthConfigured && (
        <div className={styles.calloutWarning}>
          <div className={styles.calloutBody}>
            <AlertTriangle size={18} />
            <div className={styles.calloutText}>
              <strong>VITE_GOOGLE_OAUTH_CLIENT_ID Not Detected</strong>
              Add <code className={styles.codeInline}>VITE_GOOGLE_OAUTH_CLIENT_ID</code> to your local environment file and restart Vite so Secretaries can authenticate with Google Sheets API v4.
            </div>
          </div>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={() => setGuideOpen(true)}
          >
            Open Syncing Guide
          </button>
        </div>
      )}

      {/* HTTP 403 Multi-Secretary Handoff Banner */}
      {handoffError && (
        <div className={styles.calloutDanger}>
          <div className={styles.calloutBody}>
            <AlertTriangle size={18} />
            <div className={styles.calloutText}>
              <strong>Google Sheet Editor Access Required (HTTP 403)</strong>
              Your Google account does not have Editor permission on this centralized sheet yet. Ask{' '}
              <strong>{handoffError.ownerName}</strong>
              {handoffError.ownerEmail ? ` (${handoffError.ownerEmail})` : ''} to share the Google Sheet with your email as an <strong>Editor</strong>, or open the link to request access directly in Google Sheets.
            </div>
          </div>
          {handoffError.spreadsheetUrl && (
            <a
              href={handoffError.spreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.btnSecondary}
            >
              Request Access in Sheet <ExternalLink size={14} />
            </a>
          )}
        </div>
      )}

      {/* General Operation Feedback Banner */}
      {statusNotice && (
        <div
          className={
            statusNotice.type === 'danger'
              ? styles.calloutDanger
              : statusNotice.type === 'warning'
                ? styles.calloutWarning
                : styles.calloutInfo
          }
        >
          <div className={styles.calloutBody}>
            {statusNotice.type === 'danger' || statusNotice.type === 'warning' ? (
              <AlertTriangle size={18} />
            ) : (
              <CheckCircle size={18} />
            )}
            <div className={styles.calloutText}>
              <strong>{statusNotice.title}</strong>
              {statusNotice.message}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            {statusNotice.actionKind === 'connect' && oauthConfigured && (
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={handleConnectGoogle}
                disabled={Boolean(busyAction)}
              >
                <Link2 size={14} />
                {statusNotice.actionLabel || 'Connect Google'}
              </button>
            )}
            {statusNotice.actionKind === 'guide' && (
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setGuideOpen(true)}
              >
                <BookOpen size={14} />
                {statusNotice.actionLabel || 'Open Guide'}
              </button>
            )}
            {statusNotice.actionKind === 'repick_tab' && canManage && (
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => {
                  setShowBuilder(true);
                  setBuilderTab('assign');
                  setPullPreview(null);
                  setInspectedMeta(null);
                  setTabInspection(null);
                  setExistingUrlInput(
                    centralSheet?.spreadsheetUrl || centralSheet?.spreadsheetId || ''
                  );
                  setStatusNotice(null);
                }}
              >
                <FileSpreadsheet size={14} />
                {statusNotice.actionLabel || 'Re-pick Worksheet Tab'}
              </button>
            )}
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setStatusNotice(null)}
              aria-label="Dismiss notification"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================
          VIEW-ONLY MODE FOR NON-SECRETARIAT COMMERCE HUB OFFICERS
         =================================================================== */}
      {!canManage && (
        <div className={styles.activeSheetPanel}>
          {centralSheet?.spreadsheetId ? (
            <div className={styles.sheetHeaderRow}>
              <div className={styles.sheetIdentity}>
                <div className={styles.sheetTitleLine}>
                  <FileSpreadsheet size={19} />
                  <h4 className={styles.sheetTitle}>{centralSheet.spreadsheetTitle}</h4>
                  <span className={styles.tabBadge}>Tab: {centralSheet.sheetTitle}</span>
                </div>
                <div className={styles.metaLine}>
                  <span>
                    Assigned by: <strong>{centralSheet.assignedByName || 'SSG Secretariat'}</strong>
                    {centralSheet.assignedByEmail ? ` (${centralSheet.assignedByEmail})` : ''}
                  </span>
                  <span>Last synced: {formatSyncTimestamp(centralSheet.lastSyncedAt)}</span>
                </div>
                <p className={styles.sharingHint}>
                  Only SSG Secretaries (Secretary, Executive, Deputy, Press, Linkages, or Finance Secretary) can create, reassign, or trigger read/write sync on the centralized Order record.
                </p>
              </div>
              <div className={styles.sheetHeaderActions}>
                <a
                  href={centralSheet.spreadsheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.btnPrimary}
                >
                  Open Centralized Google Sheet <ExternalLink size={14} />
                </a>
              </div>
            </div>
          ) : (
            <div className={styles.metaLine}>
              No centralized Order Google Sheet has been assigned by the SSG Secretariat yet. Once a Secretary creates or links the master Order sheet, its read-only link will appear here automatically.
            </div>
          )}
        </div>
      )}

      {/* ===================================================================
          SECRETARIAT ACTIVE CENTRALIZED SHEET CONTROL PANEL
         =================================================================== */}
      {canManage && centralSheet?.spreadsheetId && !showBuilder && (
        <div className={styles.activeSheetPanel}>
          <div className={styles.sheetHeaderRow}>
            <div className={styles.sheetIdentity}>
              <div className={styles.sheetTitleLine}>
                <FileSpreadsheet size={19} />
                <h4 className={styles.sheetTitle}>{centralSheet.spreadsheetTitle}</h4>
                <span className={styles.tabBadge}>Tab: {centralSheet.sheetTitle}</span>
                <span className={styles.templateBadge}>
                  {centralSheet.isStandardTemplate ? '18-Col Commerce Hub Template' : 'Custom Mapped Sheet'}
                </span>
              </div>
              <div className={styles.metaLine}>
                <span>
                  Assigned by: <strong>{centralSheet.assignedByName}</strong>
                  {centralSheet.assignedByEmail ? ` (${centralSheet.assignedByEmail})` : ''}
                </span>
                <span>
                  Last synced: <strong>{formatSyncTimestamp(centralSheet.lastSyncedAt)}</strong>
                </span>
              </div>
              <p className={styles.sharingHint}>
                Collaborator access: open the Google Sheet and click <strong>Share</strong> in Google Sheets to add fellow Secretaries (Editor) or officers (Viewer).
              </p>
            </div>

            <div className={styles.sheetHeaderActions}>
              <a
                href={centralSheet.spreadsheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.btnSecondary}
              >
                Open in Google Sheets <ExternalLink size={14} />
              </a>

              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => {
                  setShowBuilder(true);
                  setPullPreview(null);
                }}
                disabled={Boolean(busyAction)}
              >
                Reassign / Change Sheet
              </button>

              {Array.isArray(centralSheet.previousSheets) && centralSheet.previousSheets.length > 0 && (
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() => setShowHistory((v) => !v)}
                >
                  <History size={15} />
                  History ({centralSheet.previousSheets.length})
                </button>
              )}
            </div>
          </div>

          {/* Sync Actions Row */}
          <div className={styles.syncActionsRow}>
            <div className={styles.syncBtnGroup}>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={handlePreviewPull}
                disabled={Boolean(busyAction) || !oauthConfigured}
              >
                {busyAction === 'preview_pull' ? (
                  <RefreshCw size={15} className={styles.spin} />
                ) : (
                  <ArrowDownToLine size={15} />
                )}
                Pull Sheet → App (Preview)
              </button>

              <button
                type="button"
                className={styles.btnSecondary}
                onClick={handlePushToSheet}
                disabled={Boolean(busyAction) || !oauthConfigured}
              >
                {busyAction === 'push' ? (
                  <RefreshCw size={15} className={styles.spin} />
                ) : (
                  <ArrowUpFromLine size={15} />
                )}
                Push App → Sheet
              </button>

              <button
                type="button"
                className={styles.btnPrimary}
                onClick={handleTwoWayReconcile}
                disabled={Boolean(busyAction) || !oauthConfigured}
              >
                {busyAction === 'reconcile' ? (
                  <RefreshCw size={15} className={styles.spin} />
                ) : (
                  <ArrowLeftRight size={15} />
                )}
                Two-Way Reconcile
              </button>
            </div>

            {onToggleAutoPush && (
              <label className={styles.autoPushLabel}>
                <input
                  type="checkbox"
                  className={styles.autoPushCheckbox}
                  checked={Boolean(autoPushEnabled)}
                  onChange={(e) => onToggleAutoPush(e.target.checked)}
                  disabled={!googleConnected}
                />
                Auto-Push row when claiming order (while connected)
              </label>
            )}
          </div>

          {/* Pull Diff Preview Card */}
          {pullPreview && (
            <div className={styles.diffPanel}>
              <div className={styles.sheetHeaderRow}>
                <strong>Pull Diff Preview — Review Before Saving to Commerce Hub</strong>
                <span className={styles.metaLine}>
                  Scanned {pullPreview.totalSheetRows} row(s) from "{pullPreview.sheetTitle}"
                </span>
              </div>

              <div className={styles.diffMetricsRow}>
                <div className={styles.diffMetricBox}>
                  <span className={`${styles.diffMetricNum} ${styles.diffMetricCreate}`}>
                    {pullPreview.toCreate.length}
                  </span>
                  <span className={styles.diffMetricLabel}>New Orders to Create (ORD-DB-####)</span>
                </div>
                <div className={styles.diffMetricBox}>
                  <span className={styles.diffMetricNum}>{pullPreview.toUpdate.length}</span>
                  <span className={styles.diffMetricLabel}>Pending Orders to Update</span>
                </div>
                <div className={styles.diffMetricBox}>
                  <span className={`${styles.diffMetricNum} ${styles.diffMetricProtected}`}>
                    {pullPreview.protectedConflicts.length}
                  </span>
                  <span className={styles.diffMetricLabel}>Protected (Claimed / IGF Synced)</span>
                </div>
                <div className={styles.diffMetricBox}>
                  <span className={styles.diffMetricNum}>{pullPreview.skippedRows.length}</span>
                  <span className={styles.diffMetricLabel}>
                    Rows Skipped (Blank / Totals / Incomplete)
                  </span>
                </div>
              </div>

              {pullPreview.protectedConflicts.length > 0 && (
                <ul className={styles.protectedList}>
                  {pullPreview.protectedConflicts.slice(0, 5).map((conflict) => (
                    <li key={`${conflict.orderId}-${conflict.sheetRowNumber}`}>
                      <strong>{conflict.orderId}</strong> (Row {conflict.sheetRowNumber}): kept Commerce Hub status{' '}
                      <strong>{conflict.appStatus}</strong> — protected from sheet status "{conflict.sheetStatus}" because order is already fulfilled or IGF-synced.
                    </li>
                  ))}
                </ul>
              )}

              {pullPreview.skippedRows.some((r) => r.reason && r.reason !== 'Empty row') && (
                <ul className={styles.protectedList}>
                  {pullPreview.skippedRows
                    .filter((r) => r.reason && r.reason !== 'Empty row')
                    .slice(0, 4)
                    .map((skipped) => (
                      <li key={`skip-${skipped.sheetRowNumber}`}>
                        <strong>Row {skipped.sheetRowNumber} skipped:</strong> {skipped.reason}
                      </li>
                    ))}
                </ul>
              )}

              {pullPreview.toCreate.length === 0 && pullPreview.toUpdate.length === 0 && (
                <div className={styles.calloutInfo}>
                  <div className={styles.calloutBody}>
                    <CheckCircle size={17} />
                    <div className={styles.calloutText}>
                      <strong>Everything Is Already Up to Date</strong>
                      No new or changed pending orders were found in "{pullPreview.sheetTitle}". Any fulfilled or IGF-synced orders remain safely protected in Commerce Hub.
                    </div>
                  </div>
                </div>
              )}

              {(pullPreview.toCreate.length > 0 || pullPreview.toUpdate.length > 0) && (
                <div className={styles.diffTableWrap}>
                  <table className={styles.diffTable}>
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Order ID</th>
                        <th>Customer</th>
                        <th>Product</th>
                        <th>Qty</th>
                        <th>Total</th>
                        <th>Recording Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...pullPreview.toCreate.map((item) => ({ ...item, _op: 'Create' })),
                        ...pullPreview.toUpdate.map((item) => ({ ...item, _op: 'Update' })),
                      ]
                        .slice(0, 8)
                        .map((row) => (
                          <tr key={`${row.orderId}-${row._sheetRowIndex}`}>
                            <td>
                              <strong>{row._op}</strong>
                            </td>
                            <td>
                              {row.orderId}
                              {row._autoGeneratedId ? ' (auto)' : ''}
                            </td>
                            <td>{row.customerInfo?.fullName || '—'}</td>
                            <td>{row.productInfo?.productName || '—'}</td>
                            <td>{row.productInfo?.quantity || 1}</td>
                            <td>₱{Number(row.productInfo?.totalPrice || 0).toFixed(2)}</td>
                            <td>{row.orderStatus}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className={styles.diffFooter}>
                <button
                  type="button"
                  className={styles.btnGhost}
                  onClick={() => setPullPreview(null)}
                  disabled={busyAction === 'commit_pull'}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.btnSuccess}
                  onClick={handleCommitPull}
                  disabled={
                    busyAction === 'commit_pull' ||
                    (pullPreview.toCreate.length === 0 && pullPreview.toUpdate.length === 0)
                  }
                >
                  {busyAction === 'commit_pull' ? (
                    <RefreshCw size={15} className={styles.spin} />
                  ) : (
                    <CheckCircle size={15} />
                  )}
                  Commit Pull ({pullPreview.toCreate.length + pullPreview.toUpdate.length} Order
                  {pullPreview.toCreate.length + pullPreview.toUpdate.length === 1 ? '' : 's'})
                </button>
              </div>
            </div>
          )}

          {/* Archived Sheet History */}
          {showHistory &&
            Array.isArray(centralSheet.previousSheets) &&
            centralSheet.previousSheets.length > 0 && (
              <div className={styles.historyList}>
                <span className={styles.fieldLabel}>Previously Linked Order Sheets</span>
                {centralSheet.previousSheets.map((prev, idx) => (
                  <div key={`${prev.spreadsheetId}-${idx}`} className={styles.historyRow}>
                    <span>
                      <strong>{prev.spreadsheetTitle}</strong> ({prev.sheetTitle}) — assigned by{' '}
                      {prev.assignedByName}, archived {formatSyncTimestamp(prev.archivedAt)}
                    </span>
                    {prev.spreadsheetUrl && (
                      <a
                        href={prev.spreadsheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.btnGhost}
                      >
                        Open Archive <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      {/* ===================================================================
          SECRETARIAT CREATE / ASSIGN CENTRALIZED SHEET BUILDER
         =================================================================== */}
      {canManage && isAssigningOrEmpty && (
        <div className={styles.setupPanel}>
          <div className={styles.sheetHeaderRow}>
            <div>
              <h4 className={styles.sheetTitle}>
                {centralSheet?.spreadsheetId
                  ? 'Reassign Centralized Commerce Hub Order Sheet'
                  : 'Configure Centralized Commerce Hub Order Sheet'}
              </h4>
              <p className={styles.sharingHint}>
                {centralSheet?.spreadsheetId
                  ? `Replacing "${centralSheet.spreadsheetTitle}" will archive it in Linked Sheet History without deleting any Google Drive file.`
                  : 'Create a formatted 18-column Order Template in your Google Drive or link an existing Google Sheet (such as Google Form Responses).'}
              </p>
            </div>
            {centralSheet?.spreadsheetId && (
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => setShowBuilder(false)}
              >
                Cancel Reassignment
              </button>
            )}
          </div>

          <div className={styles.setupModeSwitch}>
            <button
              type="button"
              className={`${styles.setupSwitchBtn} ${
                builderTab === 'create' ? styles.setupSwitchBtnActive : ''
              }`}
              onClick={() => setBuilderTab('create')}
            >
              <FilePlus2 size={15} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
              Create New Commerce Hub Template
            </button>
            <button
              type="button"
              className={`${styles.setupSwitchBtn} ${
                builderTab === 'assign' ? styles.setupSwitchBtnActive : ''
              }`}
              onClick={() => setBuilderTab('assign')}
            >
              <Link2 size={15} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
              Assign Existing Google Sheet
            </button>
          </div>

          {builderTab === 'create' ? (
            <>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Google Spreadsheet Title</label>
                <input
                  type="text"
                  className={styles.textInput}
                  value={newSheetTitle}
                  onChange={(e) => setNewSheetTitle(e.target.value)}
                  placeholder="SSG Commerce Hub Orders — Master Record"
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>Initial Rows Mode</label>
                <div className={styles.radioRow}>
                  <label
                    className={`${styles.radioOption} ${
                      templateMode === 'prefilled' ? styles.radioOptionActive : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="templateMode"
                      checked={templateMode === 'prefilled'}
                      onChange={() => setTemplateMode('prefilled')}
                    />
                    <span>
                      <span className={styles.radioOptionTitle}>
                        Pre-filled with Current Commerce Hub Orders
                      </span>
                      <span className={styles.radioOptionDesc}>
                        Generates the 18-column template and exports all existing orders immediately.
                      </span>
                    </span>
                  </label>

                  <label
                    className={`${styles.radioOption} ${
                      templateMode === 'blank' ? styles.radioOptionActive : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="templateMode"
                      checked={templateMode === 'blank'}
                      onChange={() => setTemplateMode('blank')}
                    />
                    <span>
                      <span className={styles.radioOptionTitle}>Blank 18-Column Order Template</span>
                      <span className={styles.radioOptionDesc}>
                        Creates frozen headers and Status/Payment dropdowns ready for booth walk-ins.
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>
                  18 Commerce Hub Column Keys (Generated Automatically)
                </label>
                <div className={styles.schemaColumnsWrap}>
                  {COMMERCE_HUB_ORDER_TEMPLATE_COLUMNS.map((col) => (
                    <span key={col.fieldPath} className={styles.schemaColPill}>
                      {col.header}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={handleCreateTemplate}
                  disabled={Boolean(busyAction) || !oauthConfigured}
                >
                  {busyAction === 'create' ? (
                    <RefreshCw size={15} className={styles.spin} />
                  ) : (
                    <FilePlus2 size={15} />
                  )}
                  Create & Set as Centralized Order Sheet
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.fieldGroup}>
                <label className={styles.fieldLabel}>
                  Google Sheets URL or Spreadsheet ID
                </label>
                <div className={styles.inlineInputRow}>
                  <input
                    type="text"
                    className={styles.textInput}
                    value={existingUrlInput}
                    onChange={(e) => {
                      setExistingUrlInput(e.target.value);
                      if (inspectedMeta) {
                        setInspectedMeta(null);
                        setTabInspection(null);
                        setSelectedTabTitle('');
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && existingUrlInput.trim() && oauthConfigured && !busyAction) {
                        e.preventDefault();
                        handleInspectExistingUrl();
                      }
                    }}
                    placeholder="https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit"
                  />
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={handleInspectExistingUrl}
                    disabled={
                      Boolean(busyAction) || !existingUrlInput.trim() || !oauthConfigured
                    }
                  >
                    {busyAction === 'inspect' ? (
                      <RefreshCw size={15} className={styles.spin} />
                    ) : (
                      <FileSpreadsheet size={15} />
                    )}
                    Load Worksheet Tabs
                  </button>
                </div>
              </div>

              {inspectedMeta && (
                <>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>
                      Select Worksheet Tab in "{inspectedMeta.spreadsheetTitle}"
                    </label>
                    <select
                      className={styles.selectInput}
                      value={selectedTabTitle}
                      onChange={(e) => handleSelectWorksheetTab(e.target.value)}
                    >
                      {inspectedMeta.tabs.map((tab) => (
                        <option key={tab.sheetId} value={tab.sheetTitle}>
                          {tab.sheetTitle}
                        </option>
                      ))}
                    </select>
                  </div>

                  {tabInspection && (
                    <div className={styles.calloutInfo}>
                      <div className={styles.calloutBody}>
                        <CheckCircle size={18} />
                        <div className={styles.calloutText}>
                          {tabInspection.isEmpty ? (
                            <>
                              <strong>Blank Worksheet Tab Detected</strong>
                              Commerce Hub will automatically initialize the 18 standard Order Template headers and Status/Payment dropdowns on "{tabInspection.sheetTitle}".
                            </>
                          ) : tabInspection.isStandardTemplate ? (
                            <>
                              <strong>Standard 18-Column Commerce Hub Template Detected</strong>
                              Found {tabInspection.rowCount} existing data row(s) matching the official Commerce Hub column keys.
                            </>
                          ) : (
                            <>
                              <strong>
                                Custom Sheet Headers Detected ({tabInspection.rowCount} row
                                {tabInspection.rowCount === 1 ? '' : 's'})
                              </strong>
                              Matched {Object.keys(customMappings).length} Commerce Hub order fields without overwriting your existing Row 1 headers (ideal for Google Form Responses).
                            </>
                          )}
                        </div>
                      </div>
                      {!tabInspection.isEmpty && !tabInspection.isStandardTemplate && (
                        <button
                          type="button"
                          className={styles.btnSecondary}
                          onClick={() => setShowCustomMapper((v) => !v)}
                        >
                          <SlidersHorizontal size={14} />
                          {showCustomMapper ? 'Hide Column Map' : 'Adjust Column Map'}
                        </button>
                      )}
                    </div>
                  )}

                  {tabInspection &&
                    !tabInspection.isEmpty &&
                    !tabInspection.isStandardTemplate &&
                    showCustomMapper && (
                      <div className={styles.mappingGrid}>
                        {Object.entries(ordersMapping.fieldMappings).map(
                          ([fieldPath, targetLabel]) => {
                            const selectedForThisField = customMappings[fieldPath] || '';
                            const usedElsewhere = new Set(
                              Object.entries(customMappings || {})
                                .filter(([k, v]) => k !== fieldPath && Boolean(v))
                                .map(([, v]) => String(v).trim().toLowerCase())
                            );
                            return (
                              <div key={fieldPath} className={styles.mappingItem}>
                                <span className={styles.mappingItemLabel}>{targetLabel}</span>
                                <select
                                  className={styles.selectInput}
                                  value={selectedForThisField}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCustomMappings((prev) => {
                                      const next = { ...prev };
                                      if (val) next[fieldPath] = val;
                                      else delete next[fieldPath];
                                      return next;
                                    });
                                  }}
                                >
                                  <option value="">-- Unmapped / Default --</option>
                                  {uniqueSheetHeaders.map((h) => {
                                    const alreadyUsed = usedElsewhere.has(h.toLowerCase());
                                    return (
                                      <option key={h} value={h}>
                                        {alreadyUsed ? `${h} (already mapped)` : h}
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>
                            );
                          }
                        )}
                      </div>
                    )}

                  {duplicateMappedColumns.length > 0 && (
                    <div className={styles.calloutWarning}>
                      <div className={styles.calloutBody}>
                        <AlertTriangle size={18} />
                        <div className={styles.calloutText}>
                          <strong>Duplicate Column Selected</strong>
                          Column "{duplicateMappedColumns[0]}" is selected for more than one Commerce Hub field. Please pick a unique column (or "-- Unmapped / Default --") before assigning.
                        </div>
                      </div>
                    </div>
                  )}

                  <div>
                    <button
                      type="button"
                      className={styles.btnPrimary}
                      onClick={handleAssignExistingSheet}
                      disabled={Boolean(busyAction) || duplicateMappedColumns.length > 0}
                    >
                      {busyAction === 'assign' ? (
                        <RefreshCw size={15} className={styles.spin} />
                      ) : (
                        <CheckCircle size={15} />
                      )}
                      Assign "{selectedTabTitle}" as Centralized Order Sheet
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ===================================================================
          MULTI-PAGE INTERACTIVE OFFICER HANDBOOK MODAL
         =================================================================== */}
      <GoogleSheetsSyncGuideModal
        isOpen={guideOpen}
        onClose={() => setGuideOpen(false)}
      />
    </div>
  );
}

export default CentralizedGoogleSheetControl;

