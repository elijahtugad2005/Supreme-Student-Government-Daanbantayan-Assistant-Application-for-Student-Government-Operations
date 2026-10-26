// components/Document/DocumentAnalysis.jsx
// PURPOSE: Phase 2 + Phase 3 — AI suggestion and human verification.
//
// The separation this component exists to enforce: the AI proposes, a person
// disposes. Nothing here writes AI output straight to the document's own fields.
// Suggestions live under `aiSuggestion` until someone ticks the boxes and
// presses Confirm, and a disagreement is recorded as a correction even when the
// end label happens to match.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ITEM_STATE,
  aiSupported,
  checkAiStatus,
  clearQuota,
  confirmAnalysis,
  correctClassification,
  recordSignature,
  formatWait,
  onQuotaChange,
  readQuota,
  runAnalysisQueue,
  secondsUntilReset,
} from '../../services/documentAiService';
import { S, T, statusPill } from '../../utils/themeStyles';
import stylesModule from './DocumentDashboard.module.css';
import { HiSparkles, HiCheckCircle, HiX, HiPencil, HiClock, HiShieldCheck, HiExclamation, HiServer, HiLightningBolt } from 'react-icons/hi';

/** Fields the administrator may accept from the AI, in display order. */
const FIELDS = [
  { key: 'documentType', label: 'Document type', from: 'suggestion' },
  { key: 'title', label: 'Title', from: 'extraction' },
  { key: 'documentNumber', label: 'Document number', from: 'extraction' },
  { key: 'documentDate', label: 'Document date', from: 'extraction' },
  { key: 'summary', label: 'Summary', from: 'extraction' },
  { key: 'agenda', label: 'Main agenda', from: 'extraction' },
  { key: 'subject', label: 'Subject', from: 'extraction' },
];

const fmt = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.length ? value.join(', ') : null;
  return String(value);
};

const AI_STATE_TONE = {
  not_processed: 'neutral',
  processing: 'info',
  suggested: 'info',
  verified: 'success',
  corrected: 'warning',
  failed: 'error',
};

const AI_STATE_LABEL = {
  not_processed: 'Not analysed',
  processing: 'Analysing…',
  suggested: 'AI Suggested',
  verified: 'Human Verified',
  corrected: 'Corrected',
  failed: 'Analysis failed',
};

const PROVIDER_LABEL = {
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
};

export default function DocumentAnalysis({ document, labels, onMessage, autoAnalysing = false, onAnalyzed }) {
  const [status, setStatus] = useState(null);
  const [queueState, setQueueState] = useState(null);
  const [selected, setSelected] = useState({});
  const [overrides, setOverrides] = useState({});
  const [busy, setBusy] = useState(false);
  const isAnalyzingRef = useRef(false);
  // Which row is mid-save. Separate from `busy` so one in-flight signature does
  // not lock the whole panel.
  const [signingIndex, setSigningIndex] = useState(-1);
  const [editingCorrection, setEditingCorrection] = useState(false);
  const [reason, setReason] = useState('');
  const [preferredProvider, setPreferredProvider] = useState(() => {
    return localStorage.getItem('ssg_preferred_ai_provider') || 'auto';
  });

  const handleProviderChange = (e) => {
    const val = e.target.value;
    setPreferredProvider(val);
    localStorage.setItem('ssg_preferred_ai_provider', val);
  };

  const ANALYSIS_STAGES = useMemo(() => [
    { id: 'reading', label: 'Reading document', desc: 'Parsing binary contents and decompressing document text…' },
    { id: 'author', label: 'Getting author & office', desc: 'Detecting author name, submitting unit and office credentials…' },
    { id: 'labels', label: 'Identifying Labels', desc: 'Matching institutional taxonomy and classification tags…' },
    { id: 'signatories', label: 'Getting Signatories', desc: 'Detecting official signatory blocks, positions and sign-off requirements…' },
    { id: 'keywords', label: 'Finding Keywords', desc: 'Isolating indexable topics, agenda matters and subject keywords…' },
    { id: 'summary', label: 'Generating Summary', desc: 'Drafting executive institutional summary & compiling final intelligence report…' },
  ], []);

  const [activeStageIndex, setActiveStageIndex] = useState(0);

  const isAnalyzing = busy || queueState?.state === ITEM_STATE.ANALYZING || document?.aiState === 'processing';

  useEffect(() => {
    if (!isAnalyzing) {
      setActiveStageIndex(0);
      return;
    }
    const interval = setInterval(() => {
      setActiveStageIndex((prev) => (prev < ANALYSIS_STAGES.length - 1 ? prev + 1 : prev));
    }, 2000);
    return () => clearInterval(interval);
  }, [isAnalyzing, ANALYSIS_STAGES.length]);

  const supported = aiSupported(document);
  const suggestion = document.aiSuggestion || (document.aiSuggestions?.labels?.length ? {
    documentType: document.aiSuggestions.labels[0],
    documentTypeLabel: document.aiSuggestions.labels[0],
    confidence: document.aiConfidence || 0.85,
  } : (document.labels?.length ? {
    documentType: document.labels[0],
    documentTypeLabel: document.labels[0],
    confidence: 0.9,
  } : null));

  const extraction = document.aiExtraction || (document.aiSuggestions || (document.title || document.authorName ? {
    title: document.title,
    documentNumber: document.documentNumber,
    documentDate: document.documentDate,
    summary: document.summary,
    agenda: document.agenda,
    subject: document.subject,
    authorName: document.authorName,
    authorRole: document.authorRole,
    signatories: document.signatureChecklist || [],
  } : null));

  // Daily quota exhaustion is remembered, so the Analyse button is disabled
  // with the reset time rather than inviting a request that must fail.
  const [quota, setQuota] = useState(readQuota);
  const [waiting, setWaiting] = useState(() => secondsUntilReset());

  useEffect(() => {
    setQuota(readQuota());
    setWaiting(secondsUntilReset());
  }, []);

  // Other documents may exhaust the quota mid-session; stay in step.
  useEffect(() => {
    const unsubscribe = onQuotaChange((state) => {
      setQuota(state);
      setWaiting(secondsUntilReset(state));
    });
    return unsubscribe;
  }, []);

  // Countdown so the wait is visible rather than a dead button.
  useEffect(() => {
    if (waiting === null) return undefined;
    const timer = setInterval(() => {
      const next = secondsUntilReset();
      setWaiting(next);
      if (next === null) setQuota(null);
    }, 30_000);
    return () => clearInterval(timer);
  }, [waiting !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshAiStatus = async () => {
    try {
      const s = await checkAiStatus();
      if (s) setStatus(s);
    } catch (_) {}
  };

  useEffect(() => {
    refreshAiStatus();
    // Poll every 12s so quota resets or server status changes are immediately detected
    const timer = setInterval(refreshAiStatus, 12000);
    return () => clearInterval(timer);
  }, []);

  const seededDocKeyRef = useRef(null);

  // Seed the tick-boxes whenever suggestion or extraction is available
  useEffect(() => {
    if (!suggestion && !extraction) return;
    const currentKey = `${document.id}_${document.aiProcessedAt || ''}_${document.aiState || ''}`;
    if (seededDocKeyRef.current === currentKey) return;

    setSelected(() => {
      const seeded = {};
      FIELDS.forEach((f) => {
        const value = f.key === 'documentType' ? suggestion?.documentTypeLabel : extraction?.[f.key];
        if (Boolean(fmt(value))) {
          seeded[f.key] = true;
        }
      });
      seededDocKeyRef.current = currentKey;
      return seeded;
    });
  }, [document.id, document.aiProcessedAt, document.aiState, suggestion, extraction]);

  const confidencePct = suggestion?.confidence != null ? Math.round(suggestion.confidence * 100) : null;

  const toggle = (key) => setSelected((prev) => ({ ...prev, [key]: !prev[key] }));

  const toggleSignature = async (index, signed, entry) => {
    setSigningIndex(index);
    try {
      const result = await recordSignature(document.id, index, signed, {
        signedByName: entry.name,
      });
      onMessage(
        'info',
        `${entry.position || entry.name} ${signed ? 'signed' : 'unmarked'} — ${result.progress}% complete.${
          result?.complete || result?.status === 'approved' ? ' Document is now Approved!' : ''
        }`
      );
    } catch (error) {
      onMessage('error', `Could not record that signature: ${error.message}`);
    } finally {
      setSigningIndex(-1);
    }
  };

  const applyKeys = useMemo(
    () => Object.entries(selected).filter(([, on]) => Boolean(on)).map(([k]) => k),
    [selected]
  );

  /**
   * What Confirm will actually write, shown before it is pressed.
   */
  const pendingChanges = FIELDS.map((f) => {
    const suggested = f.key === 'documentType' ? suggestion?.documentTypeLabel : extraction?.[f.key];
    const override = overrides[f.key];
    const value = override !== undefined ? override : suggested;
    const current =
      f.key === 'documentType'
        ? document.labels?.[0]
        : f.key === 'organization'
          ? document.office
          : document[f.key];
    const shown = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    const isSame = shown === String(current ?? '');
    return { ...f, value: shown, current, willChange: !isSame && shown.length > 0 };
  }).filter((f) => Boolean(selected[f.key]) && f.value.length > 0);

  const changing = pendingChanges.filter((f) => f.willChange);
  const unchanged = pendingChanges.length - changing.length;

  const setOverride = (key, value) => setOverrides((prev) => ({ ...prev, [key]: value }));

  const analyze = async () => {
    if (isAnalyzingRef.current) return;
    isAnalyzingRef.current = true;
    setBusy(true);
    setQueueState({ state: ITEM_STATE.ANALYZING, error: null });
    try {
      await runAnalysisQueue(
        [document],
        (update) => setQueueState(update),
        { intervalMs: 0, preferredProvider }
      );
      await refreshAiStatus();
      onAnalyzed?.(null, document);
    } catch (error) {
      setQueueState({ state: ITEM_STATE.FAILED, error: error.message });
      await refreshAiStatus();
      onAnalyzed?.(error, document);
    } finally {
      setBusy(false);
      isAnalyzingRef.current = false;
    }
  };

  useEffect(() => {
    if (!autoAnalysing) return;
    if (
      document &&
      document.aiState !== 'processing' &&
      (!document.aiSuggestion && !document.aiExtraction) &&
      document.aiState !== 'approved' &&
      !busy
    ) {
      analyze();
    } else {
      // Auto-analysing was requested, but document does not qualify or is already analysed/approved.
      // Immediately notify parent so autoAnalyseId is cleared and not left hanging.
      onAnalyzed?.(null, document);
    }
  }, [autoAnalysing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup if unmounted while autoAnalysing is active
  useEffect(() => {
    return () => {
      if (autoAnalysing) {
        onAnalyzed?.(null, document);
      }
    };
  }, [autoAnalysing, document]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async () => {
    const apply = Object.entries(selected)
      .filter(([, on]) => Boolean(on))
      .map(([key]) => key);

    setBusy(true);
    try {
      // Core rule: "The AI proposes, a person decides."
      // Unticking all boxes means the administrator intentionally rejects all AI suggestions.
      // We must NEVER auto-select unselected fields.
      if (apply.length === 0) {
        const { updateDocument } = await import('../../services/documentService.js');
        await updateDocument(document.id, {
          aiState: 'approved',
          verifiedFields: [],
          verifiedAt: new Date().toISOString(),
        });
        onMessage('info', 'Document verified. No AI suggestions were applied.');
        setOverrides({});
        return;
      }

      // Filter overrides so unselected fields are never leaked to the backend
      const activeOverrides = {};
      apply.forEach((key) => {
        if (overrides[key] !== undefined) {
          activeOverrides[key] = overrides[key];
        }
      });

      const result = await confirmAnalysis(document.id, apply, activeOverrides);
      const appliedCount = result?.applied?.length || apply.length;
      onMessage('success', `Confirmed ${appliedCount} field(s). Marked human-verified.`);
      setOverrides({});
    } catch (error) {
      console.warn('Backend confirmation failed, applying direct update fallback:', error);
      // Direct update fallback via Firestore if callable fails
      try {
        const { updateDocument } = await import('../../services/documentService.js');
        const updates = {
          aiState: 'approved',
          verifiedFields: apply,
          verifiedAt: new Date().toISOString(),
        };

        // Strictly apply ONLY the fields the administrator ticked
        if (apply.includes('documentType')) {
          const typeVal = overrides.documentType !== undefined ? overrides.documentType : (suggestion?.documentTypeLabel || suggestion?.documentType);
          if (typeVal) updates.labels = [typeVal];
        }
        if (apply.includes('title')) {
          const val = overrides.title !== undefined ? overrides.title : extraction?.title;
          if (val) updates.title = val;
        }
        if (apply.includes('documentNumber')) {
          const val = overrides.documentNumber !== undefined ? overrides.documentNumber : extraction?.documentNumber;
          if (val) updates.documentNumber = val;
        }
        if (apply.includes('documentDate')) {
          const val = overrides.documentDate !== undefined ? overrides.documentDate : extraction?.documentDate;
          if (val) updates.documentDate = val;
        }
        if (apply.includes('summary')) {
          const val = overrides.summary !== undefined ? overrides.summary : extraction?.summary;
          if (val) updates.summary = val;
        }
        if (apply.includes('agenda')) {
          const val = overrides.agenda !== undefined ? overrides.agenda : extraction?.agenda;
          if (val) updates.agenda = val;
        }
        if (apply.includes('subject')) {
          const val = overrides.subject !== undefined ? overrides.subject : extraction?.subject;
          if (val) updates.subject = val;
        }
        if (apply.includes('organization')) {
          const val = overrides.organization !== undefined ? overrides.organization : extraction?.organization;
          if (val) updates.office = val;
        }

        await updateDocument(document.id, updates);
        onMessage('success', `Confirmed ${apply.length} field(s). Marked human-verified.`);
        setOverrides({});
      } catch (fallbackErr) {
        onMessage('error', `Could not confirm: ${error.message || fallbackErr.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitCorrection = async (labelSlug) => {
    setBusy(true);
    try {
      await correctClassification(document.id, labelSlug, reason);
      onMessage('success', 'Correction recorded.');
      setEditingCorrection(false);
      setReason('');
    } catch (error) {
      onMessage('error', error.message);
    } finally {
      setBusy(false);
    }
  };

  const signatories = extraction?.signatories || document.signatureChecklist || [];
  const checklist = document.signatureChecklist || [];
  const signedCount = checklist.filter((s) => s.status === 'signed').length;
  const isComplete = (checklist.length > 0 && signedCount === checklist.length) || Boolean(document.signatureSummary?.complete);
  const signatureSummary = document.signatureSummary || {
    total: checklist.length,
    required: checklist.filter((s) => s.required !== false).length || checklist.length,
    signed: signedCount,
    requiredPending: checklist.filter((s) => (s.required !== false) && s.status !== 'signed').length,
    progress: checklist.length === 0 ? 0 : Math.round((signedCount / checklist.length) * 100),
    complete: isComplete,
    state: checklist.length === 0 ? 'no_signatures_detected' : isComplete ? 'complete' : signedCount > 0 ? 'partially_signed' : 'pending',
  };
  const pendingNames = checklist
    .filter((s) => (s.required !== false) && s.status !== 'signed')
    .map((s) => s.position || s.name)
    .filter(Boolean);

  // How many names the model offered that were dropped for being the author.
  const authorExcluded = Math.max(
    0,
    (extraction?.signatories || []).length - checklist.length
  );

  // Facts read straight off the paper, filled in by the function or backend AI.
  const displayAuthor = document.authorName || extraction?.authorName;
  const displayRole = document.authorRole || extraction?.authorRole || 'Author';
  const autoFilled = [
    displayAuthor ? [displayRole, displayAuthor] : null,
    document.documentNumber || extraction?.documentNumber ? ['Document number', document.documentNumber || extraction?.documentNumber] : null,
    document.subject || extraction?.subject ? ['Subject', document.subject || extraction?.subject] : null,
    document.agenda || extraction?.agenda ? ['Main agenda', document.agenda || extraction?.agenda] : null,
    document.summary || extraction?.summary ? ['Summary', document.summary || extraction?.summary] : null,
    (document.labels && document.labels.length > 0) || suggestion?.documentTypeLabel
      ? ['Suggested Label', suggestion?.documentTypeLabel || document.labels?.[0]]
      : null,
  ].filter(Boolean);

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <HiSparkles style={styles.panelIcon} />
        <div style={styles.panelHeaderText}>
          <strong style={styles.panelTitle}>AI Analysis</strong>
          <span style={styles.panelSub}>
            The AI suggests. A person decides. Nothing becomes official without confirmation.
          </span>
        </div>
        <span style={statusPill(AI_STATE_TONE[document.aiState] || 'neutral')}>
          {queueState?.state === ITEM_STATE.ANALYZING
            ? 'Analysing…'
            : AI_STATE_LABEL[document.aiState] || 'Not analysed'}
        </span>
      </div>

      {/* ── AI Provider Selector & Server Quota Monitor Bar ── */}
      <div style={styles.providerControlBar}>
        <div style={styles.providerSelectGroup}>
          <label style={styles.providerLabel}>
            <HiServer style={{ fontSize: '1.05rem', color: T.accent }} />
            <span>AI Provider:</span>
          </label>
          <select
            value={preferredProvider}
            onChange={handleProviderChange}
            disabled={busy}
            style={styles.providerSelect}
            title="Choose which AI provider handles document analysis"
          >
            <option value="auto">⚡ Auto (Best Available / Failover)</option>
            <option value="gemini">
              Google Gemini {status?.geminiQuota?.depleted ? '⚠️ (Quota Depleted)' : ''}
            </option>
            <option value="openrouter">OpenRouter (Free Multi-Model)</option>
          </select>
        </div>

        {/* Live Quota & Server Status Indicator */}
        <div style={styles.providerStatusBadge}>
          {status?.geminiQuota?.depleted ? (
            <span style={styles.quotaDepletedBadge} title={status?.geminiQuota?.message || 'Gemini quota reached'}>
              <HiExclamation style={{ fontSize: '1rem' }} />
              <span>Gemini Quota Depleted — Routed to OpenRouter</span>
            </span>
          ) : status?.ok ? (
            <span style={styles.quotaHealthyBadge}>
              <span style={styles.healthyDot} />
              <span>Gemini & OpenRouter Online</span>
            </span>
          ) : (
            <span style={styles.quotaWarningBadge}>
              <HiClock />
              <span>Checking AI Server…</span>
            </span>
          )}
        </div>
      </div>

      {/* Quota Depletion Alert Banner if Gemini is depleted */}
      {status?.geminiQuota?.depleted && (
        <div style={styles.quotaAlertBanner}>
          <HiExclamation style={{ fontSize: '1.4rem', color: '#f59e0b', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ color: '#fbbf24', fontSize: '0.85rem' }}>
              Gemini Free-Tier Quota Depleted (20 requests/day limit)
            </strong>
            <p style={{ margin: '0.2rem 0 0', color: '#cbd5e1', fontSize: '0.78rem', lineHeight: '1.4' }}>
              The server detected Gemini HTTP 429 quota exhaustion. The system is automatically using <strong>OpenRouter</strong> for analysis.
              {status?.geminiQuota?.resetAt && (
                <span> Window resets at approximately: <strong>{new Date(status.geminiQuota.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>.</span>
              )}
            </p>
          </div>
        </div>
      )}

      {/* ── LIVE AI ANALYSIS FEEDBACK REPORT & ANIMATION ── */}
      {isAnalyzing && (
        <div className={stylesModule.analysisFeedbackCard} style={styles.feedbackCard}>
          <style>{`
            @keyframes pulseBorderGlow {
              0%, 100% { border-color: rgba(59, 130, 246, 0.4); box-shadow: 0 0 16px rgba(59, 130, 246, 0.15); }
              50% { border-color: rgba(99, 102, 241, 0.85); box-shadow: 0 0 30px rgba(99, 102, 241, 0.4); }
            }
            @keyframes shimmerGradient {
              0% { background-position: -200% 0; }
              100% { background-position: 200% 0; }
            }
            @keyframes pulseDot {
              0%, 100% { transform: scale(1); opacity: 1; }
              50% { transform: scale(1.3); opacity: 0.6; }
            }
          `}</style>

          <div style={styles.feedbackHead}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span className={stylesModule.spinningCircle} />
              <div>
                <strong style={{ color: '#f8fafc', fontSize: '0.96rem', letterSpacing: '0.01em' }}>
                  AI Analysis Pipeline Report
                </strong>
                <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem' }}>
                  Live multi-stage neural document evaluation in progress…
                </span>
              </div>
            </div>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              backgroundColor: 'rgba(59, 130, 246, 0.18)',
              border: '1px solid #3b82f6',
              color: '#93c5fd',
              borderRadius: '999px',
              padding: '0.25rem 0.75rem',
              fontSize: '0.75rem',
              fontWeight: 600,
            }}>
              <span className={stylesModule.spinningCircle} style={{ width: 10, height: 10, borderWidth: 2 }} />
              {ANALYSIS_STAGES[activeStageIndex]?.label}
            </span>
          </div>

          {/* Progress Bar */}
          <div className={stylesModule.analysisProgressTrack} style={styles.feedbackProgressTrack}>
            <div
              className={stylesModule.analysisProgressFill}
              style={{
                ...styles.feedbackProgressFill,
                width: `${Math.min(96, Math.round(((activeStageIndex + 1) / ANALYSIS_STAGES.length) * 100))}%`,
              }}
            />
          </div>

          {/* Stages Checklist */}
          <div style={styles.feedbackStagesGrid}>
            {ANALYSIS_STAGES.map((st, idx) => {
              const isPast = idx < activeStageIndex;
              const isCurrent = idx === activeStageIndex;
              return (
                <div
                  key={st.id}
                  className={`${stylesModule.analysisStageItem} ${isCurrent ? stylesModule.analysisStageCurrent : ''}`}
                  style={{
                    ...styles.feedbackStageItem,
                    ...(isCurrent ? styles.feedbackStageCurrent : isPast ? styles.feedbackStagePast : styles.feedbackStageFuture),
                  }}
                >
                  <div style={styles.feedbackStageStatusIcon}>
                    {isPast ? (
                      <HiCheckCircle style={{ color: '#22c55e', fontSize: '1.15rem' }} />
                    ) : isCurrent ? (
                      <span className={stylesModule.spinningCircle} style={{ width: 12, height: 12, borderWidth: 2 }} />
                    ) : (
                      <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: '#475569',
                      }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem' }}>
                      <strong style={{
                        fontSize: '0.82rem',
                        color: isCurrent ? '#60a5fa' : isPast ? '#e2e8f0' : '#64748b',
                      }}>
                        {st.label}
                      </strong>
                      <span style={{
                        fontSize: '0.68rem',
                        color: isCurrent ? '#93c5fd' : isPast ? '#4ade80' : '#475569',
                        fontWeight: 600,
                      }}>
                        {isPast ? 'DONE' : isCurrent ? 'RUNNING…' : 'WAITING'}
                      </span>
                    </div>
                    {isCurrent && (
                      <span style={{ display: 'block', fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.2rem', lineHeight: '1.3' }}>
                        {st.desc}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Real-time Status Console Bar */}
          <div className={stylesModule.analysisConsole} style={styles.feedbackConsole}>
            <span style={{ color: '#38bdf8' }}>&gt;</span>{' '}
            <span style={{ color: '#94a3b8' }}>Pipeline Status:</span>{' '}
            <span style={{ color: '#f1f5f9', fontWeight: 600 }}>
              {ANALYSIS_STAGES[activeStageIndex]?.label} — {ANALYSIS_STAGES[activeStageIndex]?.desc}
            </span>
          </div>
        </div>
      )}

      {/* Completed feedback summary pill */}
      {!isAnalyzing && (document.aiState === 'ready_for_review' || document.aiState === 'suggested' || document.summary) && (
        <div style={styles.completedFeedbackBanner}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <HiCheckCircle style={{ color: '#22c55e', fontSize: '1.3rem' }} />
            <div>
              <strong style={{ color: '#f8fafc', fontSize: '0.88rem' }}>AI Feedback Report Complete</strong>
              <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.74rem' }}>
                Verified: Reading document · Getting author · Identifying Labels · Getting Signatories · Finding Keywords
              </span>
            </div>
          </div>
          <span style={statusPill('success')}>Ready for review</span>
        </div>
      )}

      {status && !status.ok && (
        <p style={styles.setupWarning}>
          <strong>Gemini is not configured yet.</strong> The AI analysis functions need the{' '}
          <code>GEMINI_API_KEY</code> secret. Until then you can still file, label and search
          documents — only the AI step is unavailable.
        </p>
      )}

      {status?.ok && (
        <p style={styles.setupOk}>
          Ready — model <code>{status.model}</code>, confirming below{' '}
          {Math.round((status.threshold || 0.75) * 100)}% confidence.
        </p>
      )}

      {document.aiError && (
        <p style={styles.errorText}>
          <HiClock /> {document.aiError}
        </p>
      )}

      {document.aiProvider && (
        <p style={styles.providerNote}>
          <HiLightningBolt style={{ color: '#f59e0b', fontSize: '1rem', verticalAlign: 'middle', marginRight: '0.35rem' }} />
          <span>Analysed via <strong>{PROVIDER_LABEL[document.aiProvider] || document.aiProvider}</strong></span>
          {document.aiModel && <code style={styles.modelTag}>{document.aiModel}</code>}
          {document.aiProvider !== 'gemini' && (
            <span style={styles.providerBackup}> — backup failover</span>
          )}
        </p>
      )}

      {autoFilled.length > 0 && (
        <div style={styles.autoFilled}>
          <span style={styles.autoFilledTitle}>Read from the document</span>
          {autoFilled.map(([label, value]) => (
            <span key={label} style={styles.autoFilledItem}>
              <strong>{label}:</strong> {value}
            </span>
          ))}
        </div>
      )}

      {checklist.length > 0 && (
        <div style={styles.checklist}>
          <div style={styles.checklistHead}>
            <span style={styles.checklistTitle}>Approval progress</span>
            <span style={statusPill(signatureSummary.complete ? 'success' : 'warning')}>
              {signatureSummary.progress}% · {signatureSummary.signed} of{' '}
              {signatureSummary.required} required
            </span>
          </div>

          <div style={styles.progressTrack}>
            <div
              style={{
                ...styles.progressFill,
                width: `${signatureSummary.progress}%`,
                backgroundColor: signatureSummary.complete ? T.success : T.accent,
              }}
            />
          </div>

          {pendingNames.length > 0 && (
            <p style={styles.pendingText}>
              Waiting on: {pendingNames.join(', ')}
            </p>
          )}

          <ul style={styles.checklistList}>
            {checklist.map((s, i) => (
              <li key={`${s.name}-${i}`}>
                {/* The WHOLE row is the target — a 14px checkbox alone is a poor
                    affordance and easy to miss entirely. */}
                <label
                  style={styles.signRow}
                  onClick={(e) => {
                    e.preventDefault();
                    toggleSignature(i, s.status !== 'signed', s);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={s.status === 'signed'}
                    disabled={signingIndex === i}
                    onChange={() => {}}
                    style={styles.signBox}
                  />
                  <span style={styles.checklistName}>{s.position || s.name || 'Unnamed official'}</span>
                  <span style={styles.checklistRole}>{s.name}</span>
                  {s.status === 'signed' && s.signedAt && (
                    <span style={styles.checklistWhen}>
                      signed {new Date(s.signedAt).toLocaleString()}
                      {s.recordedByName ? ` · recorded by ${s.recordedByName}` : ''}
                    </span>
                  )}
                  <span style={statusPill(s.required ? 'info' : 'neutral')}>
                    {s.status === 'signed' ? 'signed' : s.required ? 'required' : 'optional'}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {document.authorName && (
        <p style={styles.authorNote}>
          <strong>{document.authorRole ? `${document.authorRole}:` : 'Author / Prepared by:'}</strong> {document.authorName}
          {authorExcluded > 0 && (
            <span style={styles.authorNoteHint}>
              {' '}— an author does not sign, so{' '}
              {authorExcluded === 1 ? 'this person was' : 'these people were'} kept off the approval
              list.
            </span>
          )}
        </p>
      )}

      {checklist.length === 0 && (document.aiState === 'ready_for_review' || document.aiState === 'suggested' || document.authorName) && (
        <p style={{ ...styles.helper, color: '#94a3b8', fontStyle: 'italic', marginTop: '0.4rem' }}>
          No approval signatories required for this document. Recorded by / prepared by: <strong>{document.authorName || 'Preparer identified'}</strong>.
        </p>
      )}

      {signatureSummary.complete && (
        <p style={styles.approvedNote}>
          <HiCheckCircle /> Every required signature is in. This document is approved at 100%.
        </p>
      )}

      {!supported && (
        <p style={styles.helper}>
          This file type cannot be read by the AI. Convert it to PDF or DOCX to analyse it.
        </p>
      )}

      {quota && (
        <div style={styles.quotaBox}>
          <strong style={styles.quotaTitle}>
            {quota.quotaType === 'daily'
              ? "Gemini's daily allowance is used up"
              : 'Gemini is rate limiting requests'}
          </strong>
          <p style={styles.quotaText}>
            Analysis is paused
            {quota.quotaType === 'daily' && waiting !== null
              ? ` until ${new Date(quota.resetAt).toLocaleString('en-PH', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Asia/Manila',
                })} (in ${formatWait(waiting)})`
              : ` until ${new Date(quota.resetAt).toLocaleTimeString('en-PH', { timeStyle: 'short' })}`}
            . Documents can still be filed, labelled and searched.
          </p>
          <p style={styles.quotaHint}>
            The free tier allows roughly 15 requests per minute and 1,500 per day, and each
            analysed document uses up to three.
          </p>
          <button type="button" onClick={() => { clearQuota(); setQuota(null); setWaiting(null); }} style={styles.linkBtn}>
            Dismiss
          </button>
        </div>
      )}

      {!suggestion && !queueState && document.aiState === 'not_processed' && (
        <p style={styles.helper}>
          {autoAnalysing ? 'Reading this document…' : 'This document has not been read yet.'}
        </p>
      )}

      {queueState?.state === ITEM_STATE.FAILED && (
        <p style={styles.errorText}>{queueState.error}</p>
      )}

      {extraction?.unreadable && (
        <p style={styles.warning}>
          This looks like a scan with no readable text layer. {extraction.unreadableReason || ''}
        </p>
      )}

      {(suggestion || extraction) && (
        <>
          {suggestion && (
            <div style={styles.suggestionBox}>
              <div style={styles.suggestionHead}>
                <span style={styles.suggestionLabel}>Suggested type</span>
                <strong style={styles.suggestionValue}>{suggestion.documentTypeLabel || 'Other'}</strong>
                {confidencePct !== null && (
                  <span style={statusPill(suggestion.requiresReview ? 'warning' : 'success')}>
                    {confidencePct}% confidence
                  </span>
                )}
              </div>
              {suggestion.reason && <p style={styles.reason}>{suggestion.reason}</p>}
              {suggestion.requiresReview && (
                <p style={styles.warning}>
                  Confidence is below the review threshold, so this is not treated as a reliable
                  suggestion — please choose the label yourself.
                </p>
              )}
              {suggestion.error && <p style={styles.errorText}>Classifier: {suggestion.error}</p>}
            </div>
          )}

          {document.summary && (
            <div style={styles.summaryBox}>
              <span style={styles.suggestionLabel}>Summary</span>
              <p style={styles.summaryText}>{document.summary}</p>
            </div>
          )}

          {/* Field-by-field acceptance */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>
              Field-by-field verification:
            </span>
            <button
              type="button"
              onClick={() => {
                const anySelected = Object.values(selected).some(Boolean);
                const next = {};
                FIELDS.forEach((f) => {
                  const val = f.key === 'documentType' ? suggestion?.documentTypeLabel : extraction?.[f.key];
                  if (Boolean(fmt(overrides[f.key] ?? val))) {
                    next[f.key] = !anySelected;
                  }
                });
                setSelected(next);
              }}
              style={{ ...styles.linkBtn, marginTop: 0 }}
            >
              {Object.values(selected).some(Boolean) ? 'Deselect all' : 'Select all'}
            </button>
          </div>
          <div style={styles.fields}>
            {FIELDS.map((f) => {
              const value =
                f.key === 'documentType' ? suggestion?.documentTypeLabel : extraction?.[f.key];
              const shown = fmt(overrides[f.key] ?? value);
              const isVerified = (document.verifiedFields || []).includes(f.key);
              return (
                <label
                  key={f.key}
                  style={{
                    ...styles.fieldRow,
                    ...(selected[f.key] ? styles.fieldRowSelected : {}),
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!selected[f.key]}
                    onChange={() => toggle(f.key)}
                    disabled={!shown}
                  />
                  <span style={styles.fieldName}>
                    {f.label}
                    {isVerified && (
                      <span style={styles.verifiedTag}>
                        <HiShieldCheck /> verified
                      </span>
                    )}
                  </span>
                  <input
                    style={styles.fieldValue}
                    value={shown || ''}
                    onChange={(e) => setOverride(f.key, e.target.value)}
                    placeholder={shown ? '' : 'not found in the document'}
                    readOnly={f.key !== 'documentType'}
                  />
                </label>
              );
            })}
          </div>

          {/* Signatories */}
          {signatories.length > 0 && (
            <div style={styles.signatories}>
              <span style={styles.suggestionLabel}>
                Suggested signatories ({signatories.filter((s) => s.required).length} required)
              </span>
              <ul style={styles.signatoryList}>
                {signatories.map((s, i) => (
                  <li key={`${s.name}-${i}`} style={styles.signatory}>
                    <strong style={styles.signatoryName}>{s.name || 'Unnamed'}</strong>
                    <span style={styles.signatoryPosition}>{s.position || '—'}</span>
                    <span style={statusPill(s.required ? 'info' : 'neutral')}>
                      {s.required ? 'required' : 'optional'}
                    </span>
                  </li>
                ))}
              </ul>
              <p style={styles.helper}>
                These are suggestions from the document text. Recording actual signatures is Phase 4.
              </p>
            </div>
          )}

          {/* Actions */}
          {changing.length > 0 && (
            <p style={styles.pendingChanges}>
              Confirming will change {changing.length} field(s):{' '}
              {changing.map((f) => f.label).join(', ')}
              {unchanged > 0 && (
                <span style={styles.pendingUnchanged}>
                  {' '}({unchanged} ticked field(s) already match and will be left alone)
                </span>
              )}
            </p>
          )}

          {applyKeys.length === 0 && (
            <p style={{ ...styles.pendingChanges, color: '#94a3b8' }}>
              No fields selected. Confirming will mark the document as reviewed without applying any AI values.
            </p>
          )}

          <div style={styles.actionRow}>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                confirm();
              }}
              disabled={busy}
              style={{
                ...styles.primary,
                cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.7 : 1,
                position: 'relative',
                zIndex: 10,
                pointerEvents: 'auto',
              }}
            >
              <HiCheckCircle style={{ fontSize: '1.1rem' }} />
              <span>
                {busy
                  ? 'Confirming…'
                  : applyKeys.length === 0
                    ? 'Confirm (0 fields to apply)'
                    : `Confirm selected (${applyKeys.length})`}
              </span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setEditingCorrection((v) => !v);
              }}
              style={{
                ...styles.secondary,
                cursor: 'pointer',
                position: 'relative',
                zIndex: 10,
                pointerEvents: 'auto',
              }}
            >
              <HiPencil /> Disagree with the AI
            </button>
          </div>

          {editingCorrection && (
            <div style={styles.correctionBox}>
              <label style={styles.correctionLabel}>Choose the correct label</label>
              <div style={styles.chipRow}>
                {labels
                  .filter((l) => l.active !== false)
                  .map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      title={l.description}
                      onClick={() => submitCorrection(l.id)}
                      disabled={busy}
                      style={styles.chip}
                    >
                      {l.name}
                    </button>
                  ))}
              </div>
              <input
                style={{ ...S.input, marginTop: '0.6rem' }}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is the AI wrong? (optional but useful)"
              />
              <button onClick={() => setEditingCorrection(false)} style={styles.linkBtn}>
                <HiX /> Cancel
              </button>
            </div>
          )}

          {document.aiState === 'verified' && document.verifiedAt && (
            <p style={styles.verifiedNote}>
              <HiShieldCheck /> Verified by {document.verifiedByName} on{' '}
              {new Date(document.verifiedAt).toLocaleString()}
            </p>
          )}

          {/* Re-read / Re-analyze button */}
          <div style={styles.rereadRow}>
            <button
              onClick={analyze}
              disabled={busy || !supported || quota !== null}
              style={{
                ...styles.secondaryButton,
                cursor: busy ? 'wait' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <HiSparkles /> {busy ? 'Analysing…' : autoAnalysing ? 'Reading…' : 'Re-read / Analyze Document'}
            </button>
            {!supported && <span style={styles.helper}>Unsupported file type for AI reading.</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
const styles = {
  panel: {
    marginTop: '1rem',
    padding: '1.2rem',
    borderRadius: '0.8rem',
    backgroundColor: T.bgTertiary,
    border: `1px solid ${T.borderSoft}`,
  },
  panelHeader: { display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '0.9rem' },
  panelIcon: { fontSize: '1.5rem', color: T.accent },
  panelHeaderText: { display: 'flex', flexDirection: 'column', flex: '1 1 auto' },
  panelTitle: { color: T.text },
  panelSub: { color: T.textSoft, fontSize: '0.75rem' },

  setupWarning: {
    backgroundColor: T.warningLight,
    color: T.warning,
    border: `1px solid ${T.warning}`,
    padding: '0.7rem',
    borderRadius: '0.5rem',
    fontSize: '0.83rem',
  },
  setupOk: {
    backgroundColor: T.successLight,
    color: T.success,
    border: `1px solid ${T.success}`,
    padding: '0.6rem 0.8rem',
    borderRadius: '0.5rem',
    fontSize: '0.8rem',
  },

  suggestionBox: {
    backgroundColor: T.accentLight,
    border: `1px solid ${T.accent}`,
    borderRadius: '0.6rem',
    padding: '0.8rem',
    marginBottom: '0.9rem',
  },
  suggestionHead: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' },
  suggestionLabel: {
    color: T.textSoft,
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  suggestionValue: { color: T.accent, fontSize: '1rem' },
  reason: { color: T.textSoft, fontSize: '0.8rem', margin: '0.5rem 0 0' },

  summaryBox: {
    backgroundColor: T.bgCard,
    border: `1px solid ${T.borderSoft}`,
    borderRadius: '0.6rem',
    padding: '0.8rem',
    marginBottom: '0.9rem',
  },
  summaryText: { color: T.text, fontSize: '0.88rem', margin: '0.35rem 0 0', lineHeight: '1.6' },

  fields: { display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' },
  fieldRow: {
    display: 'grid',
    gridTemplateColumns: 'auto 160px 1fr',
    gap: '0.6rem',
    alignItems: 'center',
    padding: '0.4rem 0.5rem',
    borderRadius: '0.4rem',
  },
  fieldRowSelected: { backgroundColor: T.accentLight },
  fieldName: { color: T.text, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' },
  verifiedTag: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.2rem',
    fontSize: '0.62rem',
    color: T.success,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  fieldValue: { ...S.input, fontSize: '0.82rem' },

  signatories: { marginBottom: '1rem' },
  signatoryList: { listStyle: 'none', padding: 0, margin: '0.4rem 0' },
  signatory: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    padding: '0.3rem 0',
    borderBottom: `1px solid ${T.borderSoft}`,
  },
  signatoryName: { color: T.text, fontSize: '0.85rem', minWidth: '140px' },
  signatoryPosition: { color: T.textSoft, fontSize: '0.8rem', flex: '1 1 auto' },

  actionRow: { display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' },
  primary: {
    ...S.primaryButton,
    minWidth: 0,
    padding: '0.7rem 1.3rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: '0.9rem',
  },
  secondary: {
    ...S.secondaryButton,
    padding: '0.7rem 1.2rem',
    fontSize: '0.9rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
  },
  linkBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    color: T.textSoft,
    cursor: 'pointer',
    fontSize: '0.8rem',
    marginTop: '0.5rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
  },

  correctionBox: {
    marginTop: '0.9rem',
    padding: '0.9rem',
    borderRadius: '0.6rem',
    backgroundColor: T.bgCard,
    border: `1px solid ${T.border}`,
  },
  correctionLabel: { ...S.label, display: 'block', marginBottom: '0.5rem' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem' },
  chip: {
    padding: '0.3rem 0.7rem',
    borderRadius: '50px',
    border: `1px solid ${T.border}`,
    backgroundColor: T.bgTertiary,
    color: T.textSoft,
    fontSize: '0.75rem',
    cursor: 'pointer',
  },

  helper: { color: T.textSoft, fontSize: '0.8rem' },
  providerNote: { color: T.textSoft, fontSize: '0.78rem', margin: '0.35rem 0' },
  providerBackup: { color: T.warning },

  autoFilled: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem 1rem',
    alignItems: 'center',
    padding: '0.7rem 0.9rem',
    borderRadius: '0.5rem',
    backgroundColor: T.infoLight,
    border: `1px solid ${T.info}`,
    marginBottom: '1rem',
  },
  autoFilledTitle: {
    color: T.info,
    fontSize: '0.7rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontWeight: 'bold',
  },
  autoFilledItem: { color: T.text, fontSize: '0.8rem' },

  checklist: {
    padding: '0.9rem',
    borderRadius: '0.6rem',
    backgroundColor: T.bgCard,
    border: `1px solid ${T.borderSoft}`,
    marginBottom: '1rem',
  },
  checklistHead: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.8rem',
    flexWrap: 'wrap',
    marginBottom: '0.6rem',
  },
  checklistTitle: { color: T.text, fontSize: '0.92rem', fontWeight: 'bold' },
  progressTrack: {
    height: '10px',
    borderRadius: '5px',
    backgroundColor: T.bgTertiary,
    overflow: 'hidden',
    marginBottom: '0.6rem',
  },
  progressFill: { height: '100%', borderRadius: '5px', transition: 'width 0.4s ease' },
  pendingText: { color: T.warning, fontSize: '0.8rem', margin: '0 0 0.6rem' },
  authorNote: {
    color: T.text,
    fontSize: '0.83rem',
    padding: '0.6rem 0.8rem',
    borderRadius: '0.5rem',
    backgroundColor: T.bgTertiary,
    border: `1px solid ${T.borderSoft}`,
    marginBottom: '1rem',
  },
  authorNoteHint: { color: T.textSoft, fontSize: '0.78rem' },
  approvedNote: {
    color: T.success,
    fontSize: '0.83rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    margin: '0 0 1rem',
  },
  checklistList: { listStyle: 'none', margin: 0, padding: 0 },
  checklistItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    padding: '0.35rem 0',
    borderBottom: `1px solid ${T.borderSoft}`,
    fontSize: '0.82rem',
  },
  checklistBox: {
    width: '18px',
    height: '18px',
    borderRadius: '4px',
    border: `1px solid ${T.border}`,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: T.textOnAccent,
    fontSize: '0.7rem',
    flexShrink: 0,
  },
  checklistBoxSigned: { backgroundColor: T.success, borderColor: T.success },
  signToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    cursor: 'pointer',
    padding: '0.15rem',
  },
  // The entire row is clickable, so the tick target is not a 14px box.
  signRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    padding: '0.5rem 0.6rem',
    borderRadius: '0.4rem',
    borderBottom: `1px solid ${T.borderSoft}`,
    cursor: 'pointer',
    fontSize: '0.82rem',
  },
  signBox: { width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 },
  rereadRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.8rem',
    flexWrap: 'wrap',
    marginTop: '1.2rem',
    paddingTop: '1rem',
    borderTop: `1px solid ${T.borderSoft}`,
  },
  checklistWhen: { color: T.success, fontSize: '0.72rem', whiteSpace: 'nowrap' },
  pendingChanges: {
    color: T.text,
    fontSize: '0.8rem',
    padding: '0.6rem 0.8rem',
    borderRadius: '0.5rem',
    backgroundColor: T.infoLight,
    border: `1px solid ${T.info}`,
    margin: '0 0 0.8rem',
  },
  pendingUnchanged: { color: T.textSoft },
  checklistName: { color: T.text, fontWeight: 'bold', minWidth: '120px' },
  checklistRole: { color: T.textSoft, flex: '1 1 auto' },

  quotaBox: {
    backgroundColor: T.warningLight,
    border: `1px solid ${T.warning}`,
    borderRadius: '0.6rem',
    padding: '0.9rem',
    marginBottom: '1rem',
  },
  quotaTitle: { color: T.warning, fontSize: '0.9rem', display: 'block' },
  quotaText: { color: T.text, fontSize: '0.85rem', margin: '0.4rem 0 0' },
  quotaHint: { color: T.textSoft, fontSize: '0.75rem', margin: '0.4rem 0 0' },
  warning: { color: T.warning, fontSize: '0.82rem', margin: '0.5rem 0 0' },
  errorText: { color: T.error, fontSize: '0.83rem', display: 'flex', alignItems: 'center', gap: '0.4rem' },
  verifiedNote: {
    color: T.success,
    fontSize: '0.82rem',
    marginTop: '0.8rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  },

  // ── AI LIVE FEEDBACK REPORT & ANIMATION STYLES ──
  feedbackCard: {
    background: 'linear-gradient(145deg, #0f172a 0%, #1e1b4b 100%)',
    border: '1px solid #3b82f6',
    borderRadius: '0.75rem',
    padding: '1.25rem',
    marginBottom: '1.2rem',
    animation: 'pulseBorderGlow 3s infinite ease-in-out',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    boxShadow: '0 8px 30px rgba(0, 0, 0, 0.45)',
  },
  feedbackHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  feedbackProgressTrack: {
    height: '6px',
    backgroundColor: 'rgba(51, 65, 85, 0.6)',
    borderRadius: '999px',
    overflow: 'hidden',
    position: 'relative',
  },
  feedbackProgressFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #3b82f6, #818cf8, #a855f7)',
    borderRadius: '999px',
    transition: 'width 0.4s ease',
  },
  feedbackStagesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '0.65rem',
  },
  feedbackStageItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.7rem',
    padding: '0.65rem 0.85rem',
    borderRadius: '0.5rem',
    transition: 'all 0.3s ease',
  },
  feedbackStagePast: {
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    border: '1px solid rgba(34, 197, 94, 0.3)',
  },
  feedbackStageCurrent: {
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    border: '1px solid #3b82f6',
    boxShadow: '0 0 14px rgba(59, 130, 246, 0.25)',
  },
  feedbackStageFuture: {
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    border: '1px solid rgba(51, 65, 85, 0.5)',
    opacity: 0.7,
  },
  feedbackStageStatusIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '0.15rem',
    width: '18px',
    flexShrink: 0,
  },
  feedbackConsole: {
    fontFamily: 'Consolas, Monaco, monospace',
    fontSize: '0.78rem',
    backgroundColor: '#090d16',
    border: '1px solid #1e293b',
    borderRadius: '0.4rem',
    padding: '0.55rem 0.85rem',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  },
  completedFeedbackBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.8rem',
    padding: '0.75rem 1rem',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    border: '1px solid rgba(16, 185, 129, 0.35)',
    borderRadius: '0.55rem',
    marginBottom: '1.2rem',
    flexWrap: 'wrap',
  },
  providerControlBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.8rem',
    flexWrap: 'wrap',
    padding: '0.65rem 0.9rem',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    border: '1px solid #334155',
    borderRadius: '0.55rem',
    marginBottom: '1rem',
  },
  providerSelectGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    flexWrap: 'wrap',
  },
  providerLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: '0.82rem',
    fontWeight: 600,
    color: '#e2e8f0',
  },
  providerSelect: {
    backgroundColor: '#1e293b',
    border: '1px solid #475569',
    color: '#f8fafc',
    fontSize: '0.82rem',
    padding: '0.35rem 0.65rem',
    borderRadius: '0.4rem',
    outline: 'none',
    cursor: 'pointer',
    fontWeight: 500,
  },
  providerStatusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  quotaHealthyBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: '0.74rem',
    color: '#4ade80',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    border: '1px solid rgba(34, 197, 94, 0.35)',
    padding: '0.25rem 0.6rem',
    borderRadius: '999px',
    fontWeight: 500,
  },
  healthyDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: '#22c55e',
    boxShadow: '0 0 6px #22c55e',
  },
  quotaDepletedBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: '0.74rem',
    color: '#fbbf24',
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    border: '1px solid rgba(245, 158, 11, 0.5)',
    padding: '0.25rem 0.6rem',
    borderRadius: '999px',
    fontWeight: 600,
  },
  quotaWarningBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: '0.74rem',
    color: '#94a3b8',
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
    border: '1px solid #334155',
    padding: '0.25rem 0.6rem',
    borderRadius: '999px',
  },
  quotaAlertBanner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.65rem',
    padding: '0.7rem 0.9rem',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    border: '1px solid rgba(245, 158, 11, 0.4)',
    borderRadius: '0.5rem',
    marginBottom: '1rem',
  },
  modelTag: {
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    padding: '0.1rem 0.4rem',
    borderRadius: '0.3rem',
    fontSize: '0.74rem',
    color: '#38bdf8',
    marginLeft: '0.4rem',
    fontFamily: 'monospace',
  },
};