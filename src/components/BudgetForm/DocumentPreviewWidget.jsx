// components/BudgetForm/DocumentPreviewWidget.jsx
// PURPOSE: Dockable, resizable side-by-side PDF/Document Preview Widget for the
// PPMP Budget Allocation Modal. Lets officers inspect attached resolutions,
// proposals, and line-item tables directly beside BudgetForm without navigating
// away from Finance -> PPMP.
//
// Desktop (>= 960px): Resizable split pane with pointer drag handle, keyboard
// resizing, quick width presets (36% / 48% / 62%), fullscreen expand, and collapse.
// Mobile (< 960px): Collapsible top/overlay drawer with height presets so the
// allocation form remains clean and usable on narrow viewports.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  subscribeToDocuments,
  getDocumentUrl,
} from '../../services/documentService.js';
import { driveStore } from '../../services/fileStore/driveStore.js';
import { canPreviewInline, formatBytes } from '../../utils/documentLabels.js';
import { useTheme } from '../../contexts/ThemeContext.jsx';
import styles from './DocumentPreviewWidget.module.css';
import {
  HiDocumentText,
  HiEye,
  HiEyeOff,
  HiDownload,
  HiRefresh,
  HiExternalLink,
  HiX,
  HiSearch,
  HiLink,
  HiCheckCircle,
  HiExclamationCircle,
  HiArrowsExpand,
  HiChevronDown,
  HiChevronUp,
} from 'react-icons/hi';

const WIDTH_PRESETS = [
  { id: 'compact', label: 'S', pct: 36, title: 'Compact preview (36% width)' },
  { id: 'balanced', label: 'M', pct: 48, title: 'Balanced split (48% width)' },
  { id: 'wide', label: 'L', pct: 62, title: 'Wide reading view (62% width)' },
];

const MOBILE_HEIGHT_PRESETS = [
  { id: 'compact', label: 'Compact', vh: 38 },
  { id: 'tall', label: 'Tall', vh: 64 },
];

const clamp = (val, min, max) => Math.min(max, Math.max(min, val));

export function DocumentPreviewWidget({
  documents = [],
  selectedDocId = null,
  linkedDocId = null,
  onSelectDoc,
  onLinkDocToForm,
  isExpanded = false,
  onToggleExpand,
  onClose,
  widthPct = 48,
  onChangeWidthPct,
  isMobile = false,
  mobileHeightVh = 38,
  onChangeMobileHeightVh,
  isResizing = false,
}) {
  const { theme } = useTheme();
  const isClassic = theme === 'dark';

  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyResolutions, setOnlyResolutions] = useState(false);

  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [iframeReady, setIframeReady] = useState(false);
  const [openingDrive, setOpeningDrive] = useState(false);

  const urlCacheRef = useRef(new Map());
  const activeReqRef = useRef(null);
  const pickerRef = useRef(null);

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) || null,
    [documents, selectedDocId]
  );

  // Close document dropdown on outside click or Escape
  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onOutside = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setPickerOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  // Clear local reference map on unmount WITHOUT revoking store-owned blob: URLs
  // (mongoStore / localStore own the singleton _urls cache lifecycle; revoking
  // externally poisons their cache and causes Chrome "file moved/edited/deleted").
  useEffect(() => {
    const cache = urlCacheRef.current;
    return () => {
      cache.clear();
    };
  }, []);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (documents || [])
      .filter((d) => {
        if (!d) return false;
        if (onlyResolutions) {
          const isRes = (d.labels || []).some((l) =>
            String(l).toLowerCase().includes('resolution')
          );
          if (!isRes) return false;
        }
        if (!q) return true;
        return (
          String(d.title || '').toLowerCase().includes(q) ||
          String(d.documentNumber || '').toLowerCase().includes(q) ||
          String(d.originalFileName || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        // Approved resolutions float to the top for fast PPMP matching
        const score = (d) =>
          (d.id === linkedDocId ? 4 : 0) +
          (d.status === 'approved' ? 2 : 0) +
          ((d.labels || []).some((l) => String(l).toLowerCase().includes('resolution')) ? 1 : 0);
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return String(a.title || '').localeCompare(String(b.title || ''));
      });
  }, [documents, searchQuery, onlyResolutions, linkedDocId]);

  const isWordDoc = useMemo(() => {
    if (!selectedDoc) return false;
    return (
      /\.(docx?)$/i.test(selectedDoc.originalFileName || '') ||
      /wordprocessingml|msword/i.test(selectedDoc.mimeType || '')
    );
  }, [selectedDoc]);

  const isImage = useMemo(() => {
    if (!selectedDoc) return false;
    return (
      /\.(png|jpe?g|webp|gif)$/i.test(selectedDoc.originalFileName || '') ||
      String(selectedDoc.mimeType || '').startsWith('image/')
    );
  }, [selectedDoc]);

  const loadDocumentPreview = useCallback(async (doc, force = false) => {
    if (!doc) {
      setPreviewUrl(null);
      setError('');
      setLoading(false);
      setIframeReady(false);
      return;
    }

    const fileName = doc.originalFileName || doc.title || '';
    const mime = doc.mimeType || '';
    if (!canPreviewInline(fileName) && !canPreviewInline(mime)) {
      setPreviewUrl(null);
      setLoading(false);
      setIframeReady(false);
      setError(
        `This file (${fileName.split('.').pop()?.toUpperCase() || 'document'}) cannot be rendered inline in a browser iframe.`
      );
      return;
    }

    if (!force && urlCacheRef.current.has(doc.id)) {
      setError('');
      setLoading(false);
      setPreviewUrl(urlCacheRef.current.get(doc.id));
      setIframeReady(true);
      return;
    }

    if (force && urlCacheRef.current.has(doc.id)) {
      urlCacheRef.current.delete(doc.id);
    }

    if (activeReqRef.current) activeReqRef.current.aborted = true;
    const req = { aborted: false };
    activeReqRef.current = req;

    setLoading(true);
    setError('');
    setIframeReady(false);

    try {
      const url = await getDocumentUrl(doc, {
        disposition: 'inline',
        fresh: Boolean(force),
        freshBlobUrl: true,
        throwOnError: true,
      });
      if (req.aborted) return;
      if (!url) throw new Error('No preview file binary found for this document.');

      urlCacheRef.current.set(doc.id, url);
      setPreviewUrl(url);
      // Reveal PDF cleanly after a short paint tick (PDF plugins often skip onLoad)
      setTimeout(() => {
        if (!req.aborted) {
          setIframeReady(true);
          setLoading(false);
        }
      }, 220);
    } catch (err) {
      if (req.aborted) return;
      setLoading(false);
      setPreviewUrl(null);
      setError(err?.message || 'Could not load document preview.');
    }
  }, []);

  useEffect(() => {
    loadDocumentPreview(selectedDoc, false);
    return () => {
      if (activeReqRef.current) activeReqRef.current.aborted = true;
    };
  }, [selectedDoc, loadDocumentPreview]);

  const handleDownload = async () => {
    if (!selectedDoc) return;
    try {
      const url = await getDocumentUrl(selectedDoc, {
        disposition: 'attachment',
        throwOnError: true,
      });
      if (!url) throw new Error('No downloadable file available.');
      const a = document.createElement('a');
      a.href = url;
      a.download = selectedDoc.originalFileName || `${selectedDoc.title || 'document'}.pdf`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
    } catch (err) {
      setError(err?.message || 'Download failed.');
    }
  };

  const handleOpenInDrive = async () => {
    if (!selectedDoc?.mongoFileId) return;
    setOpeningDrive(true);
    try {
      let link = await driveStore.getUrl(selectedDoc.mongoFileId);
      if (!link) {
        const res = await driveStore.resync(selectedDoc.mongoFileId);
        link = res?.webViewLink || null;
      }
      if (link && /^https:\/\/drive\.google\.com\//i.test(link)) {
        window.open(link, '_blank', 'noopener,noreferrer');
      } else {
        setError('Google Drive mirror is unavailable for this file. Use Download instead.');
      }
    } catch (err) {
      setError(err?.message || 'Could not open document in Google Drive.');
    } finally {
      setOpeningDrive(false);
    }
  };

  const isLinkedToForm = Boolean(selectedDoc && selectedDoc.id === linkedDocId);

  return (
    <aside
      className={`${styles.widget} ${isClassic ? styles.widgetClassic : ''} ${
        isResizing ? styles.widgetResizing : ''
      }`}
      aria-label="Attached Document Preview Widget"
    >
      {/* Top Control Bar */}
      <div className={styles.widgetHeader}>
        <div className={styles.widgetTitleGroup}>
          <HiDocumentText className={styles.widgetIcon} aria-hidden="true" />
          <div className={styles.widgetTitleBlock}>
            <span className={styles.widgetTitle}>Document Preview Widget</span>
            <span className={styles.widgetSubtitle}>
              {selectedDoc
                ? `${selectedDoc.originalFileName || selectedDoc.title}${
                    selectedDoc.fileSize ? ` · ${formatBytes(selectedDoc.fileSize)}` : ''
                  }`
                : 'Select a PDF resolution or proposal to read beside the form'}
            </span>
          </div>
        </div>

        <div className={styles.widgetControls}>
          {/* Desktop width presets */}
          {!isMobile && !isExpanded && typeof onChangeWidthPct === 'function' && (
            <div className={styles.sizeGroup} role="group" aria-label="Preview panel width">
              {WIDTH_PRESETS.map((p) => {
                const active = Math.abs(widthPct - p.pct) <= 3;
                return (
                  <button
                    key={p.id}
                    type="button"
                    title={p.title}
                    onClick={() => onChangeWidthPct(p.pct)}
                    className={`${styles.sizeBtn} ${active ? styles.sizeBtnActive : ''}`}
                    aria-pressed={active}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Mobile height presets */}
          {isMobile && !isExpanded && typeof onChangeMobileHeightVh === 'function' && (
            <div className={styles.sizeGroup} role="group" aria-label="Preview height">
              {MOBILE_HEIGHT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onChangeMobileHeightVh(p.vh)}
                  className={`${styles.sizeBtn} ${
                    mobileHeightVh === p.vh ? styles.sizeBtnActive : ''
                  }`}
                  aria-pressed={mobileHeightVh === p.vh}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          {typeof onToggleExpand === 'function' && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onToggleExpand}
              title={isExpanded ? 'Restore split view' : 'Expand preview fullscreen'}
              aria-label={isExpanded ? 'Restore split view' : 'Expand preview fullscreen'}
            >
              <HiArrowsExpand />
            </button>
          )}

          {typeof onClose === 'function' && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onClose}
              title="Hide preview widget"
              aria-label="Hide preview widget"
            >
              <HiEyeOff />
            </button>
          )}
        </div>
      </div>

      {/* Document Picker & Quick Actions Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.pickerWrap} ref={pickerRef}>
          <button
            type="button"
            className={styles.pickerTrigger}
            onClick={() => setPickerOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
          >
            <span className={styles.pickerTriggerText}>
              {selectedDoc
                ? `${selectedDoc.documentNumber ? `${selectedDoc.documentNumber} — ` : ''}${
                    selectedDoc.title
                  }`
                : `Choose document to preview (${documents.length})`}
            </span>
            {pickerOpen ? <HiChevronUp aria-hidden="true" /> : <HiChevronDown aria-hidden="true" />}
          </button>

          {pickerOpen && (
            <div className={styles.pickerPopover}>
              <div className={styles.pickerSearchRow}>
                <HiSearch className={styles.pickerSearchIcon} aria-hidden="true" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search title, doc #, filename…"
                  className={styles.pickerSearchInput}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setOnlyResolutions((v) => !v)}
                  className={`${styles.filterPill} ${onlyResolutions ? styles.filterPillActive : ''}`}
                >
                  Resolutions
                </button>
              </div>
              <ul className={styles.pickerList} role="listbox">
                {filteredDocs.length === 0 ? (
                  <li className={styles.pickerEmpty}>No matching documents found.</li>
                ) : (
                  filteredDocs.map((d) => {
                    const active = d.id === selectedDocId;
                    const linked = d.id === linkedDocId;
                    return (
                      <li key={d.id} role="option" aria-selected={active}>
                        <button
                          type="button"
                          className={`${styles.pickerItem} ${active ? styles.pickerItemActive : ''}`}
                          onClick={() => {
                            onSelectDoc?.(d);
                            setPickerOpen(false);
                          }}
                        >
                          <div className={styles.pickerItemTop}>
                            <span className={styles.pickerItemTitle}>{d.title}</span>
                            {linked && <span className={styles.linkedChip}>Linked</span>}
                          </div>
                          <div className={styles.pickerItemMeta}>
                            {d.documentNumber && <span>{d.documentNumber} · </span>}
                            <span>{d.originalFileName || 'No file'}</span>
                          </div>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          )}
        </div>

        {selectedDoc && (
          <div className={styles.toolbarActions}>
            {typeof onLinkDocToForm === 'function' && (
              <button
                type="button"
                onClick={() => onLinkDocToForm(selectedDoc)}
                className={`${styles.toolBtn} ${isLinkedToForm ? styles.toolBtnLinked : ''}`}
                title={
                  isLinkedToForm
                    ? 'Already linked as the resolution on this allocation'
                    : 'Link this document as the Approved Resolution in the form'
                }
              >
                {isLinkedToForm ? <HiCheckCircle /> : <HiLink />}
                <span>{isLinkedToForm ? 'Linked' : 'Link to Form'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleDownload}
              className={styles.toolBtn}
              title="Download document"
            >
              <HiDownload />
              <span>Download</span>
            </button>
            {selectedDoc.mongoFileId && (
              <button
                type="button"
                onClick={handleOpenInDrive}
                disabled={openingDrive}
                className={styles.toolBtn}
                title="Open mirrored copy in Google Drive"
              >
                <HiExternalLink />
                <span>{openingDrive ? 'Opening…' : 'Drive'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Viewer Surface */}
      <div className={styles.viewerBody}>
        {!selectedDoc ? (
          <div className={styles.emptyState}>
            <HiEye className={styles.emptyIcon} aria-hidden="true" />
            <p className={styles.emptyTitle}>No document selected yet</p>
            <p className={styles.emptySub}>
              Pick an attached PDF resolution or proposal above — or choose one in Approved Resolution — to inspect budgets side by side while filling the form.
            </p>
          </div>
        ) : error ? (
          isWordDoc ? (
            <div className={styles.wordNotice}>
              <div className={styles.wordNoticeHead}>
                <HiExclamationCircle className={styles.warnIcon} aria-hidden="true" />
                <div>
                  <h4 className={styles.wordNoticeTitle}>
                    The software has limitations for viewing Word files or DOCX files
                  </h4>
                  <p className={styles.wordNoticeLead}>
                    Please use a PDF file for easier upload and instant side-by-side viewing.
                  </p>
                  <p className={styles.wordNoticeTech}>Technical details: {error}</p>
                </div>
              </div>
              <div className={styles.guideBox}>
                <div className={styles.guideTitle}>Convert DOCX to PDF</div>
                <ul className={styles.guideList}>
                  <li>
                    <strong>Microsoft Office (Word):</strong> File &rarr; Export &rarr; Create PDF/XPS (or Save As &rarr; PDF)
                  </li>
                  <li>
                    <strong>Google Docs / Google Sheets:</strong> File &rarr; Download &rarr; PDF Document (.pdf)
                  </li>
                </ul>
              </div>
              <div className={styles.errorActions}>
                <button type="button" onClick={handleDownload} className={styles.primaryAction}>
                  <HiDownload /> Download DOCX
                </button>
                {selectedDoc.mongoFileId && (
                  <button
                    type="button"
                    onClick={handleOpenInDrive}
                    disabled={openingDrive}
                    className={styles.secondaryAction}
                  >
                    <HiExternalLink /> {openingDrive ? 'Syncing…' : 'Open in Google Drive'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className={styles.errorState}>
              <HiExclamationCircle className={styles.errIcon} aria-hidden="true" />
              <p className={styles.errorTitle}>Unable to load preview</p>
              <p className={styles.errorSub}>{error}</p>
              <div className={styles.errorActions}>
                <button
                  type="button"
                  onClick={() => loadDocumentPreview(selectedDoc, true)}
                  className={styles.primaryAction}
                >
                  <HiRefresh /> Retry
                </button>
                <button type="button" onClick={handleDownload} className={styles.secondaryAction}>
                  <HiDownload /> Download
                </button>
              </div>
            </div>
          )
        ) : (
          <div className={styles.frameWrap}>
            {(loading || (!iframeReady && previewUrl)) && (
              <div className={styles.loadingOverlay}>
                <span className={styles.spinner} aria-hidden="true" />
                <span className={styles.loadingLabel}>Loading document preview…</span>
              </div>
            )}
            {previewUrl &&
              (isImage ? (
                <div className={styles.imageScroll}>
                  <img
                    src={previewUrl}
                    alt={selectedDoc.title || 'Attached document preview'}
                    className={styles.previewImg}
                    onLoad={() => {
                      setIframeReady(true);
                      setLoading(false);
                    }}
                    onError={() => {
                      setLoading(false);
                      setError('Failed to render attached image.');
                    }}
                  />
                </div>
              ) : (
                <iframe
                  key={previewUrl}
                  title={`Preview: ${selectedDoc.title || 'Attached PDF'}`}
                  src={previewUrl}
                  loading="lazy"
                  className={`${styles.previewIframe} ${iframeReady ? styles.previewIframeReady : ''}`}
                  onLoad={() => {
                    setIframeReady(true);
                    setLoading(false);
                  }}
                />
              ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * Full PPMP Budget Allocation Split-Workspace Modal:
 * Renders BudgetForm on the left and the resizable DocumentPreviewWidget on the right
 * (desktop >= 960px) or as a collapsible top preview sheet (mobile < 960px).
 */
export function BudgetAllocationSplitModal({
  isOpen,
  onClose,
  initialDocumentId = null,
  renderForm,
}) {
  const { theme } = useTheme();
  const isClassic = theme === 'dark';

  const [documents, setDocuments] = useState([]);
  const [previewOpen, setPreviewOpen] = useState(Boolean(initialDocumentId));
  const [selectedDocId, setSelectedDocId] = useState(initialDocumentId || null);
  const [linkedDocId, setLinkedDocId] = useState(initialDocumentId || null);
  const [externalLinkedDoc, setExternalLinkedDoc] = useState(null);

  const [widthPct, setWidthPct] = useState(46);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [mobileHeightVh, setMobileHeightVh] = useState(40);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 960 : false
  );

  const shellRef = useRef(null);

  // Sync viewport breakpoint for desktop split vs mobile drawer
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setIsMobile(window.innerWidth < 960);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Lock page scroll while modal is open
  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // Reset initial doc when modal opens for a different budget allocation
  useEffect(() => {
    if (isOpen) {
      setSelectedDocId(initialDocumentId || null);
      setLinkedDocId(initialDocumentId || null);
      setPreviewOpen(Boolean(initialDocumentId));
      setIsExpanded(false);
    }
  }, [isOpen, initialDocumentId]);

  // Subscribe to Documents only while the allocation modal is open
  useEffect(() => {
    if (!isOpen) return undefined;
    let unsub = () => {};
    try {
      unsub = subscribeToDocuments(
        (rows) => setDocuments(rows || []),
        () => setDocuments([])
      );
    } catch {
      setDocuments([]);
    }
    return () => unsub();
  }, [isOpen]);

  // Interactive drag-to-resize splitter (desktop)
  const handleStartResize = useCallback(
    (e) => {
      if (isMobile || isExpanded) return;
      e.preventDefault();
      setIsResizing(true);

      const handleMove = (moveEvent) => {
        const rect = shellRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const clientX =
          moveEvent.touches && moveEvent.touches[0]
            ? moveEvent.touches[0].clientX
            : moveEvent.clientX;
        const rightWidth = rect.right - clientX;
        const nextPct = clamp(Math.round((rightWidth / rect.width) * 100), 30, 68);
        setWidthPct(nextPct);
      };

      const handleUp = () => {
        setIsResizing(false);
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', handleUp);
      };

      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
      window.addEventListener('touchmove', handleMove, { passive: true });
      window.addEventListener('touchend', handleUp);
    },
    [isMobile, isExpanded]
  );

  const handleSplitterKeyDown = (e) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setWidthPct((p) => clamp(p + 4, 30, 68));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setWidthPct((p) => clamp(p - 4, 30, 68));
    }
  };

  const handlePreviewDocFromForm = useCallback((docOrId) => {
    const id = typeof docOrId === 'string' ? docOrId : docOrId?.id || null;
    if (id) {
      setSelectedDocId(id);
      setLinkedDocId(id);
    }
    setPreviewOpen(true);
  }, []);

  const handleTogglePreviewWidget = useCallback(() => {
    setPreviewOpen((prev) => {
      const next = !prev;
      if (!next) setIsExpanded(false);
      return next;
    });
  }, []);

  const handleLinkDocFromWidget = useCallback((doc) => {
    if (!doc?.id) return;
    setLinkedDocId(doc.id);
    setExternalLinkedDoc({
      id: doc.id,
      resolution: doc.documentNumber || doc.title || '',
      ts: Date.now(),
    });
  }, []);

  if (!isOpen || typeof document === 'undefined') return null;

  const showSplit = previewOpen && !isMobile && !isExpanded;

  return createPortal(
    <div
      className={`${styles.backdrop} ${isClassic ? styles.backdropClassic : ''}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="PPMP Budget Allocation Workspace"
    >
      <div
        ref={shellRef}
        className={`${styles.workspaceShell} ${
          previewOpen ? styles.workspaceShellSplit : styles.workspaceShellSingle
        } ${isExpanded ? styles.workspaceShellExpanded : ''} ${
          isMobile ? styles.workspaceShellMobile : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close modal button */}
        <button
          type="button"
          className={styles.modalCloseBtn}
          onClick={onClose}
          aria-label="Close Allocation Modal"
        >
          <HiX size={20} />
        </button>

        {/* Mobile docked top preview drawer when open */}
        {isMobile && previewOpen && (
          <div
            className={styles.mobilePreviewPane}
            style={{
              height: isExpanded ? '100%' : `${mobileHeightVh}vh`,
            }}
          >
            <DocumentPreviewWidget
              documents={documents}
              selectedDocId={selectedDocId}
              linkedDocId={linkedDocId}
              onSelectDoc={(d) => setSelectedDocId(d?.id || null)}
              onLinkDocToForm={handleLinkDocFromWidget}
              isExpanded={isExpanded}
              onToggleExpand={() => setIsExpanded((v) => !v)}
              onClose={() => {
                setPreviewOpen(false);
                setIsExpanded(false);
              }}
              isMobile
              mobileHeightVh={mobileHeightVh}
              onChangeMobileHeightVh={setMobileHeightVh}
            />
          </div>
        )}

        {/* Left Pane: Budget Allocation Form (hidden only when preview is fullscreen expanded) */}
        {!isExpanded && (
          <div className={styles.formPane}>
            {renderForm({
              onPreviewDocument: handlePreviewDocFromForm,
              onTogglePreviewWidget: handleTogglePreviewWidget,
              isPreviewWidgetOpen: previewOpen,
              externalLinkedDoc,
              onResolutionLinked: (docId) => {
                setLinkedDocId(docId || null);
                if (docId) setSelectedDocId(docId);
              },
            })}
          </div>
        )}

        {/* Desktop Interactive Resize Handle */}
        {showSplit && (
          <div
            role="separator"
            tabIndex={0}
            aria-orientation="vertical"
            aria-label="Resize document preview panel"
            aria-valuemin={30}
            aria-valuemax={68}
            aria-valuenow={widthPct}
            className={`${styles.splitter} ${isResizing ? styles.splitterActive : ''}`}
            onMouseDown={handleStartResize}
            onTouchStart={handleStartResize}
            onDoubleClick={() => setWidthPct(48)}
            onKeyDown={handleSplitterKeyDown}
            title="Drag to resize preview (double-click to reset)"
          >
            <span className={styles.splitterGrip} aria-hidden="true" />
          </div>
        )}

        {/* Right Pane (Desktop Split or Desktop Fullscreen Expand) */}
        {!isMobile && previewOpen && (
          <div
            className={styles.desktopPreviewPane}
            style={isExpanded ? { flex: '1 1 100%', width: '100%' } : { width: `${widthPct}%` }}
          >
            <DocumentPreviewWidget
              documents={documents}
              selectedDocId={selectedDocId}
              linkedDocId={linkedDocId}
              onSelectDoc={(d) => setSelectedDocId(d?.id || null)}
              onLinkDocToForm={handleLinkDocFromWidget}
              isExpanded={isExpanded}
              onToggleExpand={() => setIsExpanded((v) => !v)}
              onClose={() => {
                setPreviewOpen(false);
                setIsExpanded(false);
              }}
              widthPct={widthPct}
              onChangeWidthPct={setWidthPct}
              isResizing={isResizing}
            />
          </div>
        )}

        {/* Floating Quick-Open Dock Pill when Preview Widget is hidden */}
        {!previewOpen && (
          <button
            type="button"
            className={styles.floatingDockPill}
            onClick={() => setPreviewOpen(true)}
            title="Open side-by-side PDF preview widget"
          >
            <HiEye aria-hidden="true" />
            <span>{selectedDocId ? 'Preview Attached PDF' : 'PDF Preview Widget'}</span>
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

export default DocumentPreviewWidget;
