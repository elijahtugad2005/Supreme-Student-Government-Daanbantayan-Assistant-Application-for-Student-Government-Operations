// components/Document/DocumentAnalysis.jsx
// PURPOSE: Phase 2 + Phase 3 — AI suggestion and human verification.
//
// The separation this component exists to enforce: the AI proposes, a person
// disposes. Nothing here writes AI output straight to the document's own fields.
// Suggestions live under `aiSuggestion` until someone ticks the boxes and
// presses Confirm, and a disagreement is recorded as a correction even when the
// end label happens to match.
import React, { useEffect, useState } from 'react';
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
import { HiSparkles, HiCheckCircle, HiX, HiPencil, HiClock, HiShieldCheck } from 'react-icons/hi';

/** Fields the administrator may accept from the AI, in display order. */
const FIELDS = [
  { key: 'documentType', label: 'Document type', from: 'suggestion' },
  { key: 'title', label: 'Title', from: 'extraction' },
  { key: 'documentNumber', label: 'Document number', from: 'extraction' },
  { key: 'documentDate', label: 'Document date', from: 'extraction' },
  { key: 'subject', label: 'Subject', from: 'extraction' },
  { key: 'agenda', label: 'Main agenda', from: 'extraction' },
  { key: 'agendaItems', label: 'Agenda items', from: 'extraction', list: true },
  { key: 'organization', label: 'Organization', from: 'extraction' },
  { key: 'deadline', label: 'Deadline', from: 'extraction' },
  { key: 'keywords', label: 'Keywords', from: 'extraction', list: true },
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

export default function DocumentAnalysis({ document, labels, onMessage, autoAnalysing = false }) {
  const [status, setStatus] = useState(null);
  const [queueState, setQueueState] = useState(null);
  const [selected, setSelected] = useState({});
  const [overrides, setOverrides] = useState({});
  const [busy, setBusy] = useState(false);
  // Which row is mid-save. Separate from `busy` so one in-flight signature does
  // not lock the whole panel.
  const [signingIndex, setSigningIndex] = useState(-1);
  const [editingCorrection, setEditingCorrection] = useState(false);
  const [reason, setReason] = useState('');

  const supported = aiSupported(document);
  const suggestion = document.aiSuggestion || null;
  const extraction = document.aiExtraction || null;

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

  useEffect(() => {
    checkAiStatus().then(setStatus);
  }, []);

  // Seed the tick-boxes when a fresh analysis arrives.
  //
  // Keyed on aiProcessedAt rather than `document`, because the dashboard uses a
  // live Firestore listener: depending on the whole object would re-seed on
  // every snapshot and wipe the boxes the administrator is mid-way through
  // ticking.
  const analysisKey = `${document.aiProcessedAt?.seconds || document.aiProcessedAt || 'none'}:${
    document.aiState
  }`;

  useEffect(() => {
    if (!suggestion && !extraction) return;
    const seeded = {};
    FIELDS.forEach((f) => {
      const value = f.key === 'documentType' ? suggestion?.documentTypeLabel : extraction?.[f.key];
      const existing =
        f.key === 'documentType'
          ? document.labels?.[0]
          : f.key === 'organization'
            ? document.office
            : document[f.key];
      seeded[f.key] = Boolean(fmt(value)) && fmt(value) !== fmt(existing);
    });
    setSelected(seeded);
    setOverrides({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisKey]);

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
        `${entry.position || entry.name} ${signed ? 'signed' : 'unmarked'} — ${result.progress}% complete.`
      );
    } catch (error) {
      onMessage('error', `Could not record that signature: ${error.message}`);
    } finally {
      setSigningIndex(-1);
    }
  };

  /**
   * What Confirm will actually write, shown before it is pressed.
   *
   * Without this the button looks broken: auto-fill has usually already put the
   * AI's values on the document, so confirming the same suggestions writes the
   * same text and nothing visibly changes.
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
  }).filter((f) => selected[f.key] && f.value.length > 0);

  const changing = pendingChanges.filter((f) => f.willChange);
  const unchanged = pendingChanges.length - changing.length;

  const setOverride = (key, value) => setOverrides((prev) => ({ ...prev, [key]: value }));

  const analyze = async () => {
    setBusy(true);
    setQueueState({ state: ITEM_STATE.ANALYZING, error: null });
    try {
      // A single document, so the interval is irrelevant; the queue still runs
      // through the same path so one document and a batch behave identically.
      await runAnalysisQueue(
        [document],
        (update) => setQueueState(update),
        { intervalMs: 0 }
      );
      // The Firestore listener is the source of truth, so this component
      // re-renders once the function has written.
    } catch (error) {
      setQueueState({ state: ITEM_STATE.FAILED, error: error.message });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const apply = Object.entries(selected)
      .filter(([, on]) => on)
      .map(([key]) => key);
    if (apply.length === 0) {
      return onMessage('error', 'Tick at least one field to accept.');
    }
    // Auto-fill has usually already written the AI's values, so confirming the
    // same suggestions writes the same text. Saying so is better than a success
    // banner over zero visible change.
    if (changing.length === 0) {
      return onMessage(
        'info',
        'Everything ticked already matches the document, so nothing would change. Edit a value ' +
          'above first, or untick the ones you do not accept.'
      );
    }
    setBusy(true);
    try {
      const result = await confirmAnalysis(document.id, apply, overrides);
      onMessage('success', `Applied ${result.applied.join(', ')}. Marked human-verified.`);
      setOverrides({});
    } catch (error) {
      onMessage('error', `Could not confirm: ${error.message}`);
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
  const signatureSummary = document.signatureSummary || {
    total: checklist.length,
    required: checklist.filter((s) => s.required).length,
    signed: checklist.filter((s) => s.status === 'signed').length,
    requiredPending: checklist.filter((s) => s.required && s.status !== 'signed').length,
    progress: 0,
    complete: false,
    state: checklist.length === 0 ? 'no_signatures_detected' : 'pending',
  };
  const pendingNames = checklist
    .filter((s) => s.required && s.status !== 'signed')
    .map((s) => s.position || s.name)
    .filter(Boolean);

  // How many names the model offered that were dropped for being the author.
  const authorExcluded = Math.max(
    0,
    (extraction?.signatories || []).length - checklist.length
  );

  // Facts read straight off the paper, filled in by the function.
  const autoFilled = document.authorName
    ? [['Author', document.authorName], ['Document number', document.documentNumber], ['Office', document.office]]
        .filter(([, v]) => v)
    : [];

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
          Analysed by {PROVIDER_LABEL[document.aiProvider] || document.aiProvider}
          {document.aiProvider !== 'gemini' && (
            <span style={styles.providerBackup}> — the backup provider, because the primary was unavailable</span>
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
          <strong>Author:</strong> {document.authorName}
          {document.authorRole ? ` (${document.authorRole})` : ''}
          {authorExcluded > 0 && (
            <span style={styles.authorNoteHint}>
              {' '}— an author does not sign, so{' '}
              {authorExcluded === 1 ? 'this person was' : 'these people were'} kept off the approval
              list.
            </span>
          )}
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

          <div style={styles.actionRow}>
            <button onClick={confirm} disabled={busy} style={styles.primary}>
              <HiCheckCircle /> Confirm selected
            </button>
            <button onClick={() => setEditingCorrection((v) => !v)} style={styles.secondary}>
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

          {/* Re-read sits on its own at the bottom, and only when a re-read is
              actually warranted — a successful read must not invite the user to
              spend quota repeating it. */}
          {(document.aiState === 'not_processed' || document.aiState === 'failed') && (
            <div style={styles.rereadRow}>
              <button
                onClick={analyze}
                disabled={busy || !supported || !status?.ok || quota !== null}
                style={styles.secondaryButton}
              >
                <HiSparkles /> {busy ? 'Analysing…' : autoAnalysing ? 'Reading…' : 'Read this document'}
              </button>
              {!supported && <span style={styles.helper}>Unsupported file type for AI reading.</span>}
              {!status?.ok && status !== null && (
                <span style={styles.helper}>The AI service is unreachable.</span>
              )}
            </div>
          )}
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
};