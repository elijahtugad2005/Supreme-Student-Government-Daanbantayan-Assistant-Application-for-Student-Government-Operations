// components/Document/DocumentDetailModal.jsx
// PURPOSE: Dedicated modal for document inspection, editing, and verification.
// Replaces the awkward inline dropdown with an un-cluttered, accessible dialog.
//
// SECTIONS:
// 1. Header: Auto-generated document ID + Title + Metadata Badges
// 2. Read-only Institutional Summary: Presented cleanly as typography / document brief,
//    NOT disguised as disabled input forms, so users clearly know it is read-only.
// 3. AI Summary: Structured intelligence extraction & executive summary from AI.
// 4. Suggested Signatories: Interactive checklist to mark & track institutional sign-offs.
// 5. Editing Section: Fields to edit Title, Labels (chip picker), and Description/Subject/Agenda.

import React, { useState, useEffect, useMemo } from 'react';
import { HiX, HiCheck, HiSparkles, HiTag, HiShieldCheck, HiPencilAlt, HiDocumentText, HiIdentification, HiClock, HiEye } from 'react-icons/hi';
import { T, statusPill } from '../../utils/themeStyles';
import { recordSignature } from '../../services/documentAiService';
import stylesModule from './DocumentDashboard.module.css';

export const getAutoDocId = (doc) => {
  if (!doc) return 'DOC-PENDING';
  if (doc.documentNumber && doc.documentNumber.trim()) {
    return doc.documentNumber.trim();
  }
  const dateStr = doc.documentDate ? doc.documentDate.replace(/-/g, '') : new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = (doc.id || '000000').slice(0, 6).toUpperCase();
  return `DOC-${dateStr}-${suffix}`;
};

export default function DocumentDetailModal({
  isOpen,
  document: doc,
  labels = [],
  onClose,
  onSave,
  saving = false,
  onSay,
  onOpenPreview,
}) {
  if (!isOpen || !doc) return null;

  return (
    <DocumentDetailModalContent
      doc={doc}
      labels={labels}
      onClose={onClose}
      onSave={onSave}
      saving={saving}
      onSay={onSay}
      onOpenPreview={onOpenPreview}
    />
  );
}

function DocumentDetailModalContent({
  doc,
  labels = [],
  onClose,
  onSave,
  saving = false,
  onSay,
  onOpenPreview,
}) {
  // Local editable form state
  const [formData, setFormData] = useState(() => ({
    title: doc?.title || '',
    description: doc?.description || doc?.subject || doc?.agenda || '',
    labels: Array.isArray(doc?.labels) ? [...doc.labels] : [],
  }));

  // Local signatories checklist state
  const [localSignatures, setLocalSignatures] = useState(() => {
    const rawSignatures =
      (Array.isArray(doc?.signatureChecklist) && doc.signatureChecklist.length > 0 ? doc.signatureChecklist : null) ||
      (Array.isArray(doc?.signatures) && doc.signatures.length > 0 ? doc.signatures : null) ||
      doc?.aiExtraction?.signatories ||
      doc?.aiSuggestion?.signatories ||
      [];

    return rawSignatures.map((s, idx) => ({
      id: s.id || idx,
      name: s.name || 'Unnamed Official',
      position: s.position || s.role || 'Signatory',
      status: s.status === 'signed' || s.signed ? 'signed' : 'pending',
      signedAt: s.signedAt || null,
    }));
  });
  const [signingIdx, setSigningIdx] = useState(-1);

  // Initialize or reset when doc changes
  useEffect(() => {
    if (doc) {
      setFormData({
        title: doc.title || '',
        description: doc.description || doc.subject || doc.agenda || '',
        labels: Array.isArray(doc.labels) ? [...doc.labels] : [],
      });

      // Extract signatories list from doc signatureChecklist, signatures, aiExtraction, or aiSuggestion
      const rawSignatures =
        (Array.isArray(doc.signatureChecklist) && doc.signatureChecklist.length > 0 ? doc.signatureChecklist : null) ||
        (Array.isArray(doc.signatures) && doc.signatures.length > 0 ? doc.signatures : null) ||
        doc.aiExtraction?.signatories ||
        doc.aiSuggestion?.signatories ||
        [];

      setLocalSignatures(
        rawSignatures.map((s, idx) => ({
          id: s.id || idx,
          name: s.name || 'Unnamed Official',
          position: s.position || s.role || 'Signatory',
          status: s.status === 'signed' || s.signed ? 'signed' : 'pending',
          signedAt: s.signedAt || null,
        }))
      );
    }
  }, [doc]);

  const autoDocId = useMemo(() => getAutoDocId(doc), [doc]);

  // Read-only institutional summary (clean display, not input-like)
  const institutionalSummary = doc.summary || doc.aiExtraction?.summary || doc.extractedText?.slice(0, 320) || 'No institutional summary recorded for this document yet.';

  // AI Summary specifically
  const aiSummaryText = doc.aiExtraction?.summary || doc.aiSuggestion?.summary || (doc.summary && (doc.aiState === 'approved' || doc.aiState === 'ready_for_review') ? doc.summary : null);
  const aiKeywords = doc.aiExtraction?.keywords || doc.aiSuggestion?.keywords || doc.keywords || [];

  // Handle signatory checkbox toggle
  const handleToggleSignatory = async (index) => {
    const target = localSignatures[index];
    if (!target) return;
    const nextSigned = target.status !== 'signed';

    // Optimistic local update
    const updated = [...localSignatures];
    updated[index] = {
      ...target,
      status: nextSigned ? 'signed' : 'pending',
      signedAt: nextSigned ? new Date().toISOString() : null,
    };
    setLocalSignatures(updated);

    setSigningIdx(index);
    try {
      await recordSignature(doc.id, index, nextSigned, {
        signedByName: target.name,
      });
      if (onSay) {
        onSay('info', `${target.position || target.name} marked as ${nextSigned ? 'signed' : 'pending'}.`);
      }
    } catch (err) {
      // Revert if failed
      setLocalSignatures(localSignatures);
      if (onSay) {
        onSay('error', `Failed to update signatory: ${err.message}`);
      }
    } finally {
      setSigningIdx(-1);
    }
  };

  const handleToggleLabel = (slug) => {
    setFormData((prev) => ({
      ...prev,
      labels: prev.labels.includes(slug)
        ? prev.labels.filter((l) => l !== slug)
        : [...prev.labels, slug],
    }));
  };

  const handleSave = () => {
    onSave({
      title: formData.title.trim(),
      description: formData.description.trim(),
      labels: formData.labels,
      documentNumber: doc.documentNumber || autoDocId,
    });
  };

  return (
    <div className={stylesModule.modalOverlay} style={modalStyles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={stylesModule.modalBox} style={modalStyles.modalBox} onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div style={modalStyles.header}>
          <div style={modalStyles.headerLeft}>
            <div style={modalStyles.idBadgeRow}>
              <span style={modalStyles.autoIdBadge}>
                <HiIdentification style={{ fontSize: '1rem', color: T.accent }} />
                <span>{autoDocId}</span>
              </span>
              <span style={statusPill(doc.status === 'approved' ? 'success' : doc.status === 'under_review' ? 'warning' : 'info')}>
                {doc.status ? doc.status.toUpperCase() : 'PENDING'}
              </span>
              {doc.aiState && (
                <span style={modalStyles.aiPill}>
                  <HiSparkles style={{ fontSize: '0.85rem' }} />
                  {doc.aiState.replace('_', ' ')}
                </span>
              )}
            </div>
            <h2 style={modalStyles.modalTitle}>{formData.title || 'Document Details'}</h2>
            <div style={modalStyles.metaSub}>
              <span>{doc.originalFileName || 'File'}</span>
              <span>•</span>
              <span>{doc.documentDate || 'No date recorded'}</span>
              <span>•</span>
              <span>By {doc.createdByName || 'Administrator'}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            {onOpenPreview && (
              <button
                type="button"
                onClick={() => onOpenPreview(doc)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.45rem 0.8rem',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  backgroundColor: T.bgSecondary,
                  border: `1px solid ${T.borderSoft}`,
                  color: T.text,
                  cursor: 'pointer',
                }}
                title="Open Document in Preview Modal"
              >
                <HiEye style={{ fontSize: '0.95rem', color: T.accent }} />
                <span>Preview Doc</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={modalStyles.closeButton}
              aria-label="Close modal"
            >
              <HiX style={{ fontSize: '1.25rem' }} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div style={modalStyles.body}>
          {/* Section 1: Non-editable Summary (Clean Typography, avoids looking like an input) */}
          <div style={modalStyles.section}>
            <div style={modalStyles.sectionHeading}>
              <HiDocumentText style={{ fontSize: '1.1rem', color: T.textMuted }} />
              <h3 style={modalStyles.sectionTitle}>Document Overview</h3>
              <span style={modalStyles.readOnlyBadge}>Official Record</span>
            </div>
            <div style={modalStyles.summaryDisplayCard}>
              <p style={modalStyles.summaryParagraph}>
                {institutionalSummary}
              </p>
              {doc.office && (
                <div style={modalStyles.subMetaRow}>
                  <span style={modalStyles.subMetaLabel}>Originating Office:</span>
                  <span style={modalStyles.subMetaVal}>{doc.office}</span>
                </div>
              )}
            </div>
          </div>

          {/* Section 2: AI Summary & Keywords */}
          {aiSummaryText && (
            <div style={modalStyles.section}>
              <div style={modalStyles.sectionHeading}>
                <HiSparkles style={{ fontSize: '1.1rem', color: '#6366f1' }} />
                <h3 style={modalStyles.sectionTitle}>AI Summary & Intelligence</h3>
                <span style={modalStyles.aiVerifiedBadge}>Analyzed</span>
              </div>
              <div style={modalStyles.aiSummaryCard}>
                <p style={modalStyles.aiSummaryText}>{aiSummaryText}</p>
                {aiKeywords.length > 0 && (
                  <div style={modalStyles.keywordRow}>
                    <span style={modalStyles.keywordLabel}>Keywords:</span>
                    <div style={modalStyles.keywordChips}>
                      {aiKeywords.map((kw, idx) => (
                        <span key={idx} style={modalStyles.keywordChip}>
                          #{kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 3: Suggested Signatories (Editable Checklist) */}
          <div style={modalStyles.section}>
            <div style={modalStyles.sectionHeading}>
              <HiShieldCheck style={{ fontSize: '1.15rem', color: '#10b981' }} />
              <h3 style={modalStyles.sectionTitle}>Suggested Signatories</h3>
              <span style={modalStyles.signatoryCountBadge}>
                {localSignatures.filter((s) => s.status === 'signed').length} / {localSignatures.length} Signed
              </span>
            </div>

            {localSignatures.length === 0 ? (
              <div style={modalStyles.emptySignatories}>
                <HiClock style={{ fontSize: '1.2rem', color: T.textSoft }} />
                <span>No required signatories detected or assigned to this document.</span>
              </div>
            ) : (
              <div style={modalStyles.checklistGrid}>
                {localSignatures.map((signatory, idx) => {
                  const isSigned = signatory.status === 'signed';
                  const isBusy = signingIdx === idx;
                  return (
                    <label
                      key={signatory.id || idx}
                      style={{
                        ...modalStyles.signatoryItem,
                        ...(isSigned ? modalStyles.signatoryItemChecked : {}),
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSigned}
                        disabled={isBusy}
                        onChange={() => handleToggleSignatory(idx)}
                        style={modalStyles.checkbox}
                      />
                      <div style={modalStyles.signatoryInfo}>
                        <div style={modalStyles.signatoryNameRow}>
                          <span style={isSigned ? modalStyles.signatoryNameSigned : modalStyles.signatoryName}>
                            {signatory.name}
                          </span>
                          {isSigned && (
                            <span style={modalStyles.signedPill}>
                              <HiCheck style={{ fontSize: '0.75rem' }} /> Signed
                            </span>
                          )}
                        </div>
                        <span style={modalStyles.signatoryPosition}>
                          {signatory.position}
                        </span>
                        {isSigned && signatory.signedAt && (
                          <span style={modalStyles.signedDate}>
                            {new Date(signatory.signedAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 4: Editing Section (Title, Labels, Description) */}
          <div style={modalStyles.section}>
            <div style={modalStyles.sectionHeading}>
              <HiPencilAlt style={{ fontSize: '1.15rem', color: T.accent }} />
              <h3 style={modalStyles.sectionTitle}>Edit Metadata</h3>
            </div>

            <div style={modalStyles.formGroup}>
              <label style={modalStyles.fieldLabel}>
                Document Title <span style={{ color: T.accent }}>*</span>
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Enter official document title"
                style={modalStyles.textInput}
              />
            </div>

            <div style={modalStyles.formGroup}>
              <label style={modalStyles.fieldLabel}>Document Labels</label>
              <div style={modalStyles.labelsContainer}>
                {labels.filter((l) => l.active !== false).map((label) => {
                  const isSelected = formData.labels.includes(label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() => handleToggleLabel(label.id)}
                      style={{
                        ...modalStyles.labelButton,
                        ...(isSelected ? modalStyles.labelButtonSelected : {}),
                      }}
                    >
                      <HiTag style={{ fontSize: '0.85rem' }} />
                      <span>{label.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={modalStyles.formGroup}>
              <label style={modalStyles.fieldLabel}>Description / Agenda</label>
              <textarea
                rows={4}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Provide details regarding the agenda, background, or rationale for this document..."
                style={modalStyles.textArea}
              />
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div style={modalStyles.footer}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={modalStyles.btnCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !formData.title.trim()}
            style={modalStyles.btnPrimary}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

const modalStyles = {
  backdrop: {
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
  modalBox: {
    backgroundColor: T.bgSecondary,
    border: `1px solid ${T.borderSoft}`,
    borderRadius: '12px',
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.45)',
    width: '100%',
    maxWidth: '720px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '1.25rem 1.5rem',
    borderBottom: `1px solid ${T.borderSoft}`,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: T.bgTertiary,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    paddingRight: '1rem',
  },
  idBadgeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    marginBottom: '0.45rem',
    flexWrap: 'wrap',
  },
  autoIdBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.2rem 0.55rem',
    borderRadius: '6px',
    fontSize: '0.78rem',
    fontFamily: 'monospace',
    fontWeight: 700,
    backgroundColor: 'rgba(99, 102, 241, 0.14)',
    color: T.accent,
    border: '1px solid rgba(99, 102, 241, 0.3)',
    letterSpacing: '0.04em',
  },
  aiPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.2rem 0.5rem',
    borderRadius: '6px',
    fontSize: '0.74rem',
    fontWeight: 600,
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    color: '#c084fc',
    border: '1px solid rgba(168, 85, 247, 0.3)',
    textTransform: 'capitalize',
  },
  modalTitle: {
    margin: '0.2rem 0',
    fontSize: '1.25rem',
    fontWeight: 700,
    color: T.text,
    lineHeight: 1.3,
  },
  metaSub: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.45rem',
    fontSize: '0.8rem',
    color: T.textMuted,
    marginTop: '0.2rem',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: T.textSoft,
    cursor: 'pointer',
    padding: '0.3rem',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: '1.5rem',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.65rem',
  },
  sectionHeading: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.45rem',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '0.92rem',
    fontWeight: 600,
    color: T.text,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  readOnlyBadge: {
    marginLeft: 'auto',
    fontSize: '0.7rem',
    padding: '0.15rem 0.45rem',
    borderRadius: '4px',
    backgroundColor: T.bgTertiary,
    color: T.textSoft,
    fontWeight: 600,
    border: `1px solid ${T.borderSoft}`,
  },
  aiVerifiedBadge: {
    marginLeft: 'auto',
    fontSize: '0.7rem',
    padding: '0.15rem 0.45rem',
    borderRadius: '4px',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    color: '#818cf8',
    fontWeight: 600,
    border: '1px solid rgba(99, 102, 241, 0.25)',
  },
  summaryDisplayCard: {
    backgroundColor: T.bgTertiary,
    borderLeft: `3px solid ${T.accent}`,
    borderRadius: '0 8px 8px 0',
    padding: '0.9rem 1.1rem',
  },
  summaryParagraph: {
    margin: 0,
    fontSize: '0.88rem',
    lineHeight: 1.6,
    color: T.text,
    whiteSpace: 'pre-line',
  },
  subMetaRow: {
    display: 'flex',
    gap: '0.4rem',
    marginTop: '0.6rem',
    fontSize: '0.78rem',
    color: T.textMuted,
  },
  subMetaLabel: {
    fontWeight: 600,
  },
  subMetaVal: {
    color: T.text,
  },
  aiSummaryCard: {
    backgroundColor: 'rgba(99, 102, 241, 0.05)',
    border: '1px solid rgba(99, 102, 241, 0.2)',
    borderRadius: '8px',
    padding: '0.9rem 1.1rem',
  },
  aiSummaryText: {
    margin: 0,
    fontSize: '0.86rem',
    lineHeight: 1.55,
    color: T.text,
  },
  keywordRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginTop: '0.75rem',
    flexWrap: 'wrap',
  },
  keywordLabel: {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: T.textMuted,
  },
  keywordChips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.35rem',
  },
  keywordChip: {
    fontSize: '0.74rem',
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    color: '#818cf8',
    padding: '0.15rem 0.5rem',
    borderRadius: '4px',
  },
  signatoryCountBadge: {
    marginLeft: 'auto',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: T.textSoft,
  },
  emptySignatories: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.82rem',
    color: T.textSoft,
    padding: '0.8rem',
    backgroundColor: T.bgTertiary,
    borderRadius: '6px',
  },
  checklistGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '0.6rem',
  },
  signatoryItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
    padding: '0.75rem 0.9rem',
    borderRadius: '8px',
    backgroundColor: T.bgTertiary,
    border: `1px solid ${T.borderSoft}`,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  signatoryItemChecked: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  checkbox: {
    marginTop: '0.2rem',
    cursor: 'pointer',
    accentColor: '#10b981',
    width: '16px',
    height: '16px',
  },
  signatoryInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
    flex: 1,
  },
  signatoryNameRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  signatoryName: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: T.text,
  },
  signatoryNameSigned: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: '#10b981',
  },
  signedPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.2rem',
    fontSize: '0.68rem',
    fontWeight: 700,
    color: '#10b981',
    textTransform: 'uppercase',
  },
  signatoryPosition: {
    fontSize: '0.75rem',
    color: T.textMuted,
  },
  signedDate: {
    fontSize: '0.7rem',
    color: T.textSoft,
    marginTop: '0.15rem',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem',
  },
  fieldLabel: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: T.textMuted,
  },
  textInput: {
    padding: '0.65rem 0.85rem',
    backgroundColor: T.bgTertiary,
    border: `1px solid ${T.borderSoft}`,
    borderRadius: '6px',
    color: T.text,
    fontSize: '0.88rem',
    outline: 'none',
  },
  textArea: {
    padding: '0.65rem 0.85rem',
    backgroundColor: T.bgTertiary,
    border: `1px solid ${T.borderSoft}`,
    borderRadius: '6px',
    color: T.text,
    fontSize: '0.88rem',
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
    lineHeight: 1.5,
  },
  labelsContainer: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.4rem',
  },
  labelButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.35rem 0.7rem',
    borderRadius: '6px',
    fontSize: '0.78rem',
    backgroundColor: T.bgTertiary,
    color: T.textMuted,
    border: `1px solid ${T.borderSoft}`,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  labelButtonSelected: {
    backgroundColor: T.accent,
    color: T.textOnAccent || '#ffffff',
    borderColor: T.accent,
    fontWeight: 600,
  },
  footer: {
    padding: '1rem 1.5rem',
    borderTop: `1px solid ${T.borderSoft}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '0.75rem',
    backgroundColor: T.bgTertiary,
  },
  btnCancel: {
    padding: '0.55rem 1.1rem',
    borderRadius: '6px',
    fontSize: '0.85rem',
    fontWeight: 600,
    backgroundColor: 'transparent',
    color: T.textMuted,
    border: `1px solid ${T.borderSoft}`,
    cursor: 'pointer',
  },
  btnPrimary: {
    padding: '0.55rem 1.3rem',
    borderRadius: '6px',
    fontSize: '0.85rem',
    fontWeight: 600,
    backgroundColor: T.accent,
    color: T.textOnAccent || '#ffffff',
    border: 'none',
    cursor: 'pointer',
  },
};
