// components/Document/DocumentPreviewModal.jsx
// PURPOSE: Dedicated modal for full-screen / expanded document inspection.
// Replaces inline iframe/image viewer with a clean, focused, distraction-free modal dialog.

import React from 'react';
import {
  HiX,
  HiDownload,
  HiRefresh,
  HiExclamationCircle,
  HiEye,
  HiDocumentText,
  HiExternalLink,
} from 'react-icons/hi';
import { T } from '../../utils/themeStyles';
import { formatBytes } from '../../utils/documentLabels';
import stylesModule from './DocumentDashboard.module.css';

export default function DocumentPreviewModal({
  isOpen,
  document: doc,
  previewUrl,
  previewLoading,
  previewError,
  previewProgress,
  iframeLoaded,
  onClose,
  onRetry,
  onDownload,
  onOpenInDrive,
  onIframeLoad,
}) {
  if (!isOpen || !doc) return null;

  const isImage =
    /\.(png|jpe?g|webp|gif)$/i.test(doc.originalFileName || '') ||
    (doc.mimeType && doc.mimeType.startsWith('image/'));

  const isWordDoc =
    /\.(docx?)$/i.test(doc.originalFileName || '') ||
    /wordprocessingml|msword/i.test(doc.mimeType || '');

  return (
    <div className={stylesModule.modalOverlay} style={previewModalStyles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={stylesModule.modalBox} style={previewModalStyles.modalBox} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={previewModalStyles.header}>
          <div style={previewModalStyles.headerLeft}>
            <div style={previewModalStyles.titleRow}>
              <HiDocumentText style={{ fontSize: '1.25rem', color: T.accent, flexShrink: 0 }} />
              <h2 style={previewModalStyles.title}>{doc.title || 'Document Preview'}</h2>
            </div>
            <div style={previewModalStyles.metaSub}>
              <span>{doc.originalFileName}</span>
              {doc.fileSize && <span>• {formatBytes(doc.fileSize)}</span>}
              {doc.documentNumber && <span>• ID: {doc.documentNumber}</span>}
            </div>
          </div>

          <div style={previewModalStyles.headerActions}>
            <button
              type="button"
              onClick={() => onDownload(doc)}
              style={previewModalStyles.actionBtn}
              title="Download original document"
            >
              <HiDownload style={{ fontSize: '1rem' }} />
              <span>Download</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              style={previewModalStyles.closeBtn}
              aria-label="Close preview"
            >
              <HiX style={{ fontSize: '1.3rem' }} />
            </button>
          </div>
        </div>

        {/* Viewer Content Area */}
        <div style={previewModalStyles.contentArea}>
          {previewError ? (
            isWordDoc ? (
              <div style={previewModalStyles.wordLimitPanel}>
                <div style={previewModalStyles.wordLimitHeader}>
                  <HiExclamationCircle style={{ fontSize: '2rem', color: '#f59e0b', flexShrink: 0 }} />
                  <div>
                    <h3 style={previewModalStyles.wordLimitTitle}>
                      The software has limitations for viewing Word files or DOCX files
                    </h3>
                    <p style={previewModalStyles.wordLimitLead}>
                      Please use a PDF file for easier upload and instant in-browser viewing.
                    </p>
                    <p style={previewModalStyles.wordLimitTech}>
                      Technical details: {previewError}
                    </p>
                  </div>
                </div>

                <div style={previewModalStyles.guideCard}>
                  <div style={previewModalStyles.guideHeading}>
                    How to convert Word (.docx) to PDF
                  </div>
                  <div style={previewModalStyles.guideGrid}>
                    <div style={previewModalStyles.guideStepBox}>
                      <div style={previewModalStyles.guideAppLabel}>Microsoft Office (Word)</div>
                      <p style={previewModalStyles.guideSteps}>
                        Open document &rarr; <strong>File</strong> &rarr; <strong>Export</strong> &rarr;{' '}
                        <strong>Create PDF/XPS</strong> (or <strong>File</strong> &rarr;{' '}
                        <strong>Save As</strong> &rarr; select <strong>PDF</strong>).
                      </p>
                    </div>
                    <div style={previewModalStyles.guideStepBox}>
                      <div style={previewModalStyles.guideAppLabel}>Google Docs / Google Sheets</div>
                      <p style={previewModalStyles.guideSteps}>
                        Open document &rarr; <strong>File</strong> &rarr; <strong>Download</strong> &rarr;{' '}
                        <strong>PDF Document (.pdf)</strong> (or <strong>File</strong> &rarr;{' '}
                        <strong>Export</strong> &rarr; <strong>PDF</strong>).
                      </p>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => onDownload(doc)}
                    style={previewModalStyles.downloadBtn}
                  >
                    <HiDownload /> Download DOCX File
                  </button>
                  {doc.mongoFileId && typeof onOpenInDrive === 'function' && (
                    <button
                      type="button"
                      onClick={() => onOpenInDrive(doc)}
                      style={previewModalStyles.retryBtn}
                    >
                      <HiExternalLink /> Open in Google Drive
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div style={previewModalStyles.errorBox}>
                <HiExclamationCircle style={{ fontSize: '2rem', color: T.error, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 220 }}>
                  <p style={previewModalStyles.errorTitle}>Unable to preview this document inline</p>
                  <p style={previewModalStyles.errorSub}>
                    Technical details: {previewError}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <button
                    type="button"
                    onClick={() => onRetry(doc)}
                    style={previewModalStyles.retryBtn}
                  >
                    <HiRefresh /> Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => onDownload(doc)}
                    style={previewModalStyles.downloadBtn}
                  >
                    <HiDownload /> Download File
                  </button>
                </div>
              </div>
            )
          ) : (
            <div style={previewModalStyles.viewerFrame}>
              {(previewLoading || (!iframeLoaded && previewUrl)) && (
                <div style={previewModalStyles.loadingOverlay}>
                  <span className={stylesModule.spinningCircleLg} style={previewModalStyles.spinner} />
                  <div style={{ textAlign: 'center' }}>
                    <p style={previewModalStyles.loadingText}>
                      {previewLoading
                        ? `Streaming document preview… ${previewProgress}%`
                        : 'Rendering viewer…'}
                    </p>
                    <span style={previewModalStyles.loadingSub}>Loading file bytes from document store</span>
                  </div>
                </div>
              )}

              {previewUrl ? (
                isImage ? (
                  <div style={previewModalStyles.imageContainer}>
                    <img
                      src={previewUrl}
                      alt={doc.title || 'Document preview'}
                      style={previewModalStyles.image}
                      onLoad={() => onIframeLoad(true)}
                      onError={() => onIframeLoad(false, 'Failed to display image preview')}
                    />
                  </div>
                ) : (
                  <iframe
                    title={doc.title}
                    src={previewUrl}
                    style={{
                      ...previewModalStyles.iframe,
                      opacity: iframeLoaded ? 1 : 0,
                    }}
                    onLoad={() => onIframeLoad(true)}
                  />
                )
              ) : (
                !previewLoading && (
                  <div style={previewModalStyles.emptyPlaceholder}>
                    <HiEye style={{ fontSize: '2.5rem', color: T.textSoft }} />
                    <p style={{ margin: 0, color: T.textMuted }}>No active preview stream available.</p>
                    <button
                      type="button"
                      onClick={() => onRetry(doc)}
                      style={previewModalStyles.retryBtn}
                    >
                      <HiRefresh /> Load Preview
                    </button>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const previewModalStyles = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '1.25rem',
  },
  modalBox: {
    backgroundColor: T.bgSecondary,
    border: `1px solid ${T.borderSoft}`,
    borderRadius: '12px',
    boxShadow: '0 25px 50px rgba(0, 0, 0, 0.55)',
    width: '100%',
    maxWidth: '1050px',
    height: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '1.1rem 1.5rem',
    borderBottom: `1px solid ${T.borderSoft}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: T.bgTertiary,
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem',
    minWidth: 0,
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.55rem',
  },
  title: {
    margin: 0,
    fontSize: '1.15rem',
    fontWeight: 700,
    color: T.text,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '650px',
  },
  metaSub: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.78rem',
    color: T.textMuted,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  actionBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.45rem 0.85rem',
    borderRadius: '6px',
    fontSize: '0.82rem',
    fontWeight: 600,
    backgroundColor: T.bgSecondary,
    border: `1px solid ${T.borderSoft}`,
    color: T.text,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: T.textSoft,
    cursor: 'pointer',
    padding: '0.35rem',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentArea: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#0b0f19',
  },
  viewerFrame: {
    position: 'relative',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
    backgroundColor: '#ffffff',
    transition: 'opacity 0.2s ease-in-out',
  },
  imageContainer: {
    width: '100%',
    height: '100%',
    overflow: 'auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1.5rem',
  },
  image: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    borderRadius: '4px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1rem',
    backgroundColor: 'rgba(11, 15, 25, 0.85)',
    backdropFilter: 'blur(4px)',
    zIndex: 10,
  },
  spinner: {
    width: '42px',
    height: '42px',
    border: '3px solid rgba(255, 255, 255, 0.15)',
    borderTop: `3px solid ${T.accent}`,
    borderRadius: '50%',
    animation: 'docPreviewSpin 0.8s linear infinite',
  },
  loadingText: {
    margin: 0,
    color: T.text,
    fontSize: '0.92rem',
    fontWeight: 600,
  },
  loadingSub: {
    color: T.textMuted,
    fontSize: '0.78rem',
  },
  emptyPlaceholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '0.8rem',
  },
  errorBox: {
    margin: '2rem auto',
    maxWidth: '600px',
    padding: '1.25rem 1.5rem',
    borderRadius: '8px',
    backgroundColor: T.errorLight || 'rgba(239, 68, 68, 0.12)',
    border: `1px solid ${T.error}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    alignItems: 'center',
    textAlign: 'center',
  },
  wordLimitPanel: {
    margin: '2rem auto',
    maxWidth: '720px',
    width: 'calc(100% - 2rem)',
    padding: '1.5rem',
    borderRadius: '12px',
    backgroundColor: 'rgba(245, 158, 11, 0.09)',
    border: '1px solid rgba(245, 158, 11, 0.42)',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.15rem',
    overflowY: 'auto',
  },
  wordLimitHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.85rem',
  },
  wordLimitTitle: {
    margin: '0 0 0.35rem',
    fontSize: '1.06rem',
    fontWeight: 700,
    color: '#fef3c7',
    lineHeight: 1.3,
  },
  wordLimitLead: {
    margin: '0 0 0.4rem',
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#f8fafc',
    lineHeight: 1.45,
  },
  wordLimitTech: {
    margin: 0,
    fontSize: '0.78rem',
    color: '#cbd5e1',
    lineHeight: 1.45,
  },
  guideCard: {
    padding: '1rem 1.1rem',
    borderRadius: '10px',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    border: '1px solid rgba(148, 163, 184, 0.25)',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  guideHeading: {
    fontSize: '0.82rem',
    fontWeight: 700,
    color: '#ffea9f',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  guideGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '0.75rem',
  },
  guideStepBox: {
    padding: '0.75rem 0.9rem',
    borderRadius: '8px',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  guideAppLabel: {
    fontSize: '0.82rem',
    fontWeight: 700,
    color: '#f8fafc',
    marginBottom: '0.3rem',
  },
  guideSteps: {
    margin: 0,
    fontSize: '0.8rem',
    color: '#cbd5e1',
    lineHeight: 1.5,
  },
  errorTitle: {
    margin: 0,
    fontWeight: 700,
    color: T.error,
    fontSize: '0.95rem',
  },
  errorSub: {
    margin: '0.35rem 0 0',
    fontSize: '0.82rem',
    color: T.textMuted,
    lineHeight: 1.5,
  },
  retryBtn: {
    padding: '0.45rem 0.95rem',
    backgroundColor: T.accent,
    color: T.textOnAccent || '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.82rem',
  },
  downloadBtn: {
    padding: '0.45rem 0.95rem',
    backgroundColor: T.bgTertiary,
    color: T.text,
    border: `1px solid ${T.borderSoft}`,
    borderRadius: '6px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.82rem',
  },
};
