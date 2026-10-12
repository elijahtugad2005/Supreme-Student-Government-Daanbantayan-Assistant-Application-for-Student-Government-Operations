// components/Document/DocumentDashboard.jsx
// PURPOSE: Phase 1 — document repository. Upload, list, preview, download and
// label administrative documents.
//
// No AI here by design. The specification is explicit that the repository comes
// first, and building it on the plain record means Gemini processing in Phase 2
// enriches documents that already exist rather than becoming a prerequisite for
// having any.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import {
  ACCEPT_ATTRIBUTE,
  DOC_STATUS,
  DOC_STATUS_LABELS,
  MAX_FILE_BYTES,
  canPreviewInline,
  formatBytes,
  formatDate,
} from '../../utils/documentLabels';
import {
  deleteDocument,
  ensureSeedLabels,
  getDocumentUrl,
  searchDocuments,
  subscribeToDocuments,
  subscribeToLabels,
  updateDocument,
  uploadDocument,
  validateFile,
} from '../../services/documentService';
import { S, T, statusBanner, statusPill } from '../../utils/themeStyles';
import { storageWarning } from '../../services/fileStore';
import { analyzeDocumentContent } from '../../services/documentAiService';
import AiStatusBadge from './AiStatusBadge.jsx';
import DocumentAnalysis from './DocumentAnalysis.jsx';
import {
  HiDocumentText,
  HiUpload,
  HiEye,
  HiDownload,
  HiTrash,
  HiX,
  HiCheckCircle,
  HiTag,
  HiFolderOpen,
  HiSearch,
  HiPencil,
  HiChevronDown,
  HiSparkles,
  HiRefresh,
  HiExclamationCircle,
} from 'react-icons/hi';

const STATUS_TONE = {
  [DOC_STATUS.APPROVED]: 'success',
  [DOC_STATUS.UNDER_REVIEW]: 'warning',
  [DOC_STATUS.PENDING]: 'info',
};

const emptyForm = () => ({
  title: '',
  documentNumber: '',
  status: DOC_STATUS.PENDING,
  documentDate: new Date().toISOString().slice(0, 10),
  labels: [],
});

function DocumentDashboard() {
  const { currentUser, userName } = useAuth();
  const actor = { uid: currentUser?.uid, name: userName || currentUser?.displayName || 'Unknown' };

  const [documents, setDocuments] = useState([]);
  const [labels, setLabels] = useState([]);
  const [banner, setBanner] = useState(null);
  const [booting, setBooting] = useState(true);

  // ── Filters ──
  const [term, setTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [labelFilter, setLabelFilter] = useState([]);

  // ── Upload ──
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [autoAnalyseId, setAutoAnalyseId] = useState('');

  // ── Detail / preview ──
  const [openId, setOpenId] = useState('');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const previewCache = useRef(new Map());
  const previewAbortRef = useRef(null);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const say = useCallback((type, message) => setBanner({ type, message }), []);

  // ── Load ──
  useEffect(() => {
    let alive = true;

    const unsubDocs = subscribeToDocuments(
      (rows) => alive && setDocuments(rows),
      (error) => alive && say('error', `Could not load documents: ${error.message}`)
    );

    // The taxonomy is seeded on first run so the label UI is never empty.
    ensureSeedLabels()
      .catch((error) => alive && say('error', `Could not prepare labels: ${error.message}`))
      .finally(() => alive && setBooting(false));

    const unsubLabels = subscribeToLabels(
      (rows) => alive && setLabels(rows),
      (error) => alive && say('error', `Could not load labels: ${error.message}`)
    );

    return () => {
      alive = false;
      unsubDocs();
      unsubLabels();
    };
  }, [say]);

  const activeLabels = useMemo(() => labels.filter((l) => l.active), [labels]);

  const visible = useMemo(
    () => searchDocuments(documents, { term, status: statusFilter, labels: labelFilter }),
    [documents, term, statusFilter, labelFilter]
  );

  const counts = useMemo(() => {
    const out = { total: documents.length };
    Object.values(DOC_STATUS).forEach((s) => {
      out[s] = documents.filter((d) => d.status === s).length;
    });
    return out;
  }, [documents]);

  const offices = useMemo(
    () => Array.from(new Set(documents.map((d) => d.office).filter(Boolean))).sort(),
    [documents]
  );

  // ── Upload handlers ──
  const pickFile = (selected) => {
    setFileError('');
    setFile(null);
    if (!selected) return;
    const check = validateFile(selected);
    if (!check.ok) return setFileError(check.message);
    setFile(selected);
    // Pre-fill the title from the filename; the officer can correct it.
    setForm((prev) => ({
      ...prev,
      title: prev.title || selected.name.replace(/\.[^.]+$/, ''),
    }));
  };

  const toggleFormLabel = (slug) =>
    setForm((prev) => ({
      ...prev,
      labels: prev.labels.includes(slug)
        ? prev.labels.filter((l) => l !== slug)
        : [...prev.labels, slug],
    }));

  const submitUpload = async () => {
    setFileError('');
    if (!file) return setFileError('Choose a file to upload.');
    if (!form.title.trim()) return setFileError('Enter a title.');

    setBusy(true);
    setProgress(0);
    try {
      const id = await uploadDocument({
        file,
        metadata: {
          ...form,
        },
        actor,
        onProgress: setProgress,
      });
      say('success', `“${form.title}” uploaded. Reading the document…`);
      setFile(null);
      setForm(emptyForm());
      setProgress(null);
      setOpenId(id);
      setAutoAnalyseId(id);

      // Analysis runs automatically — no button to press. The document is
      // already filed at this point, so a failure degrades to "not analysed"
      // rather than losing the upload.
      //
      // The file travels with the request. In local storage mode the bytes are
      // in IndexedDB, so the function cannot fetch them from Storage.
      const uploadedFile = file;
      analyzeDocumentContent(id, uploadedFile)
        .then((result) => {
          const filled = Object.keys(result?.autoFilled || {});
          say(
            'success',
            filled.length
              ? `Document read. Filled in automatically: ${filled.join(', ')}.`
              : 'Document read and analysed.'
          );
        })
        .catch((error) => {
          say('error', `Uploaded, but reading failed: ${error.message}`);
        })
        .finally(() => setAutoAnalyseId(''));
    } catch (error) {
      say('error', error.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Preview ──
  const loadPreview = useCallback(async (doc, force = false) => {
    if (!doc) return;

    // Fast session cache hit (<500ms requirement)
    if (!force && previewCache.current.has(doc.id)) {
      const cached = previewCache.current.get(doc.id);
      setPreviewUrl(cached);
      setPreviewError('');
      setPreviewLoading(false);
      setIframeLoaded(true);
      return;
    }

    if (force) {
      previewCache.current.delete(doc.id);
      setPreviewUrl(null);
    }

    const fileName = doc.originalFileName || doc.title || '';
    const mime = doc.mimeType || '';
    if (!canPreviewInline(fileName) && !canPreviewInline(mime)) {
      setPreviewLoading(false);
      setIframeLoaded(false);
      setPreviewUrl(null);
      setPreviewError(
        `This file (${fileName.split('.').pop()?.toUpperCase() || 'document'}) cannot be viewed in browser iframe. Use the Download button to view in desktop apps.`
      );
      return;
    }

    setPreviewLoading(true);
    setIframeLoaded(false);
    setPreviewError('');
    setPreviewProgress(45);

    if (previewAbortRef.current) {
      previewAbortRef.current.aborted = true;
    }
    const currentReq = { aborted: false };
    previewAbortRef.current = currentReq;

    // Safety timeout guard (6s max)
    const timeoutTimer = setTimeout(() => {
      if (!currentReq.aborted) {
        setPreviewLoading(false);
        // Automatically make iframe visible if URL exists
        setIframeLoaded(true);
      }
    }, 6000);

    try {
      const url = await getDocumentUrl(doc, { disposition: 'inline' });
      if (currentReq.aborted) return;

      clearTimeout(timeoutTimer);
      setPreviewProgress(100);

      if (!url) {
        throw new Error('No preview file available for this document.');
      }

      previewCache.current.set(doc.id, url);
      setPreviewUrl(url);

      // Fast auto-reveal: browser PDF plugins often don't trigger iframe.onLoad reliably,
      // so unblock the viewer immediately after a short 250ms render tick.
      setTimeout(() => {
        if (!currentReq.aborted) {
          setIframeLoaded(true);
          setPreviewLoading(false);
        }
      }, 250);
    } catch (error) {
      if (currentReq.aborted) return;
      clearTimeout(timeoutTimer);
      setPreviewLoading(false);
      setPreviewError(error.message || 'Failed to load preview.');
    }
  }, []);

  const togglePreview = (document) => {
    if (openId === document.id) {
      setOpenId('');
      setPreviewUrl(null);
      setPreviewError('');
      setPreviewLoading(false);
      setIframeLoaded(false);
      return;
    }
    setOpenId(document.id);
    setEditing(null);
    loadPreview(document);
  };

  const download = async (document) => {
    try {
      const url = await getDocumentUrl(document, { disposition: 'attachment' });
      if (!url) throw new Error('No file is attached to this document.');
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.originalFileName || 'document';
      link.rel = 'noopener';
      link.click();
    } catch (error) {
      say('error', `Download failed: ${error.message}`);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await updateDocument(
        editing.id,
        {
          title: editing.title.trim(),
          documentNumber: editing.documentNumber?.trim() || '',
          status: editing.status,
          documentDate: editing.documentDate || '',
          office: editing.office || '',
          labels: editing.labels || [],
        },
        actor
      );
      say('success', 'Document updated.');
      setEditing(null);
    } catch (error) {
      say('error', error.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (document) => {
    setBusy(true);
    try {
      await deleteDocument(document.id);
      say('success', `“${document.title}” deleted.`);
      setConfirmDelete(null);
      setOpenId('');
      setPreviewUrl(null);
    } catch (error) {
      say('error', error.message);
    } finally {
      setBusy(false);
    }
  };

  const hasFilters = term || statusFilter || labelFilter.length > 0;

  return (
    <div style={styles.page}>
      <style>{`
        @keyframes docPreviewSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      <header style={styles.header}>
        <HiDocumentText style={styles.headerIcon} />
        <div>
          <h1 style={styles.title}>Document Repository</h1>
          <p style={styles.subtitle}>
            Upload, organise and retrieve administrative documents. AI analysis is added in the
            next phase — everything filed now becomes AI-processable.
          </p>
        </div>
      </header>

      <AiStatusBadge />

      {storageWarning && (
        <div style={styles.storageNotice}>
          <strong>Local storage mode.</strong> {storageWarning}
        </div>
      )}

      {banner && (
        <div style={styles.banner(banner.type)}>
          {banner.message}
          <button onClick={() => setBanner(null)} style={styles.bannerClose}>
            <HiX />
          </button>
        </div>
      )}

      <div style={styles.stats}>
        <Stat label="Documents" value={counts.total} />
        <Stat label="Pending" value={counts[DOC_STATUS.PENDING] || 0} />
        <Stat label="Under Review" value={counts[DOC_STATUS.UNDER_REVIEW] || 0} />
        <Stat label="Approved" value={counts[DOC_STATUS.APPROVED] || 0} />
      </div>

      {/* ── Upload ── */}
      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>
          <HiUpload /> Upload a document
        </h2>

        <div style={styles.formGrid}>
          <Field label="Title *">
            <input
              style={styles.input}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g., Resolution No. 2026-014"
              maxLength={140}
              disabled={busy}
            />
          </Field>

          <Field label="Document number">
            <input
              style={styles.input}
              value={form.documentNumber}
              onChange={(e) => setForm({ ...form, documentNumber: e.target.value })}
              placeholder="e.g., 2026-014"
              disabled={busy}
            />
          </Field>

          <Field label="Document date">
            <input
              type="date"
              style={styles.input}
              value={form.documentDate}
              onChange={(e) => setForm({ ...form, documentDate: e.target.value })}
              disabled={busy}
            />
          </Field>

          <Field label="Status">
            <select
              style={styles.input}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              disabled={busy}
            >
              {Object.entries(DOC_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div style={styles.labelRow}>
          <span style={styles.label}>Labels</span>
          <div style={styles.chipRow}>
            {activeLabels.map((l) => (
              <button
                key={l.id}
                type="button"
                title={l.description}
                onClick={() => toggleFormLabel(l.id)}
                style={{
                  ...styles.chip,
                  ...(form.labels.includes(l.id) ? styles.chipActive : {}),
                }}
                disabled={busy}
              >
                {l.name}
              </button>
            ))}
          </div>
        </div>

        {/* Step 1: Choose file (always visible) */}
        <div style={styles.uploadStep}>
          <div style={styles.stepHeader}>
            <span style={styles.stepNumber}>1</span>
            <span style={styles.stepTitle}>Choose a file</span>
          </div>
          <div style={styles.dropRow}>
            <input
              type="file"
              accept={ACCEPT_ATTRIBUTE}
              onChange={(e) => pickFile(e.target.files?.[0])}
              style={styles.fileInput}
              disabled={busy}
            />
            <span style={styles.fileNote}>
              Accepted: {ACCEPT_ATTRIBUTE.replace(/,/g, ', ')} · up to {formatBytes(MAX_FILE_BYTES)}
            </span>
          </div>
          {fileError && <p style={styles.errorText}>{fileError}</p>}
        </div>

        {/* Step 2: Upload (only when file selected) */}
        {file && (
          <div style={styles.uploadStep}>
            <div style={styles.stepHeader}>
              <span style={styles.stepNumber}>2</span>
              <span style={styles.stepTitle}>Confirm and upload</span>
            </div>
            <div style={styles.selectedFile}>
              <div style={styles.fileInfo}>
                <strong>{file.name}</strong>
                <span style={styles.fileSize}>{formatBytes(file.size)}</span>
              </div>
              <button onClick={submitUpload} disabled={busy} style={styles.primary}>
                {busy ? 'Uploading…' : 'Upload document'}
              </button>
              {progress !== null && <span style={styles.progressNote}>{progress}%</span>}
            </div>
          </div>
        )}
      </section>

      {/* ── Filters ── */}
      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>
          <HiFolderOpen /> Archive ({visible.length} of {documents.length})
        </h2>

        <div style={styles.filterRow}>
          <div style={styles.searchWrap}>
            <HiSearch style={styles.searchIcon} />
            <input
              style={{ ...styles.input, paddingLeft: '2.2rem' }}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search title, number, filename or office…"
            />
          </div>

          <select
            style={{ ...styles.input, width: 'auto' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {Object.entries(DOC_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label} ({counts[value] || 0})
              </option>
            ))}
          </select>

          {hasFilters && (
            <button
              onClick={() => {
                setTerm('');
                setStatusFilter('');
                setLabelFilter([]);
              }}
              style={styles.secondary}
            >
              <HiX /> Clear
            </button>
          )}
        </div>

        <div style={styles.chipRow}>
          {activeLabels.map((l) => (
            <button
              key={l.id}
              type="button"
              title={l.description}
              onClick={() =>
                setLabelFilter((prev) =>
                  prev.includes(l.id) ? prev.filter((x) => x !== l.id) : [...prev, l.id]
                )
              }
              style={{
                ...styles.chip,
                ...(labelFilter.includes(l.id) ? styles.chipActive : {}),
              }}
            >
              <HiTag /> {l.name}
            </button>
          ))}
        </div>
      </section>

      {/* ── List ── */}
      {booting ? (
        <p style={styles.helper}>Preparing the archive…</p>
      ) : visible.length === 0 ? (
        <div style={styles.empty}>
          <p>{documents.length === 0 ? 'No documents yet. Upload the first one above.' : 'No documents match these filters.'}</p>
        </div>
      ) : (
        visible.map((document) => {
          const isOpen = openId === document.id;
          const isEditing = editing?.id === document.id;
          const isLocked = false;

          return (
            <div key={document.id} style={styles.row}>
              <div style={styles.rowHeader}>
                <div style={styles.rowMain}>
                  <strong style={styles.rowTitle}>{document.title}</strong>
                  <span style={styles.rowMeta}>
                    {document.documentNumber && <span>{document.documentNumber} · </span>}
                    {document.originalFileName} · {formatBytes(document.fileSize)} ·{' '}
                    {formatDate(document.documentDate)} · {document.createdByName}
                  </span>
                  {(document.subject || document.agenda || document.summary) && (
                    <p style={{ margin: '0.35rem 0 0.15rem', fontSize: '0.8rem', color: T.textMuted, lineHeight: 1.4 }}>
                      {document.subject && <span><strong>Subject:</strong> {document.subject} · </span>}
                      {document.agenda && <span><strong>Agenda:</strong> {document.agenda} · </span>}
                      {document.summary && <span><strong>Summary:</strong> {document.summary.length > 180 ? `${document.summary.slice(0, 180)}…` : document.summary}</span>}
                    </p>
                  )}
                  <div style={styles.chipRow}>
                    <span style={statusPill(STATUS_TONE[document.status] || 'neutral')}>
                      {DOC_STATUS_LABELS[document.status] || document.status}
                    </span>
                    {(document.labels || []).map((slug) => (
                      <span key={slug} style={styles.miniChip}>
                        <HiTag />{' '}
                        {activeLabels.find((l) => l.id === slug)?.name || slug}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={styles.rowActions}>
                  <button
                    type="button"
                    title={
                      document.aiState === 'processing'
                        ? 'Analysing document with AI…'
                        : document.aiState === 'ready_for_review'
                        ? 'View AI analysis and suggestions'
                        : document.aiState === 'approved'
                        ? 'AI suggestions verified'
                        : 'Analyse this document with AI'
                    }
                    onClick={() => {
                      const nextOpen = openId === document.id ? '' : document.id;
                      setOpenId(nextOpen);
                      if (nextOpen) {
                        loadPreview(document);
                        if (
                          document.aiState !== 'processing' &&
                          (!document.aiSuggestion && !document.aiExtraction) &&
                          document.aiState !== 'approved'
                        ) {
                          setAutoAnalyseId(document.id);
                        }
                      } else {
                        setPreviewUrl(null);
                        setPreviewError('');
                        setPreviewLoading(false);
                        setIframeLoaded(false);
                      }
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.35rem 0.65rem',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: `1px solid ${
                        document.aiState === 'approved'
                          ? '#22c55e'
                          : document.aiState === 'ready_for_review'
                          ? '#3b82f6'
                          : 'rgba(99, 102, 241, 0.6)'
                      }`,
                      backgroundColor:
                        document.aiState === 'approved'
                          ? 'rgba(34, 197, 94, 0.15)'
                          : document.aiState === 'ready_for_review'
                          ? 'rgba(59, 130, 246, 0.18)'
                          : 'rgba(99, 102, 241, 0.15)',
                      color:
                        document.aiState === 'approved'
                          ? '#4ade80'
                          : document.aiState === 'ready_for_review'
                          ? '#93c5fd'
                          : '#a5b4fc',
                      transition: 'all 0.15s ease-in-out',
                    }}
                  >
                    <HiSparkles style={{ fontSize: '0.95rem' }} />
                    <span>
                      {document.aiState === 'processing'
                        ? 'Analysing…'
                        : document.aiState === 'ready_for_review'
                        ? 'Review AI'
                        : document.aiState === 'approved'
                        ? 'AI Verified'
                        : 'Analyze'}
                    </span>
                  </button>

                  <IconBtn title="Preview" onClick={() => togglePreview(document)}>
                    <HiEye />
                  </IconBtn>
                  <IconBtn title="Download" onClick={() => download(document)}>
                    <HiDownload />
                  </IconBtn>
                  <IconBtn
                    title="Edit metadata"
                    onClick={() => {
                      setEditing(isEditing ? null : { ...document });
                      setOpenId(document.id);
                      if (!isEditing) {
                        loadPreview(document);
                      }
                    }}
                  >
                    <HiPencil />
                  </IconBtn>
                  <IconBtn
                    title="Delete"
                    danger
                    onClick={() => setConfirmDelete(confirmDelete === document.id ? null : document.id)}
                  >
                    <HiTrash />
                  </IconBtn>
                </div>
              </div>

              {confirmDelete === document.id && (
                <div style={styles.confirmBox}>
                  <p style={styles.confirmText}>
                    Delete “{document.title}” and its original file? This cannot be undone.
                  </p>
                  <button onClick={() => remove(document)} disabled={busy} style={styles.danger}>
                    Yes, delete
                  </button>
                  <button onClick={() => setConfirmDelete(null)} style={styles.secondary}>
                    Keep it
                  </button>
                </div>
              )}

              {isOpen && (
                <div style={styles.rowBody}>
                  {/* No onChanged: the Firestore listener keeps `document`
                      current, so the panel re-renders on its own. */}
                  <DocumentAnalysis
                    document={document}
                    labels={labels}
                    onMessage={say}
                    autoAnalysing={autoAnalyseId === document.id}
                  />
                  {isEditing ? (
                    <>
                      <div style={styles.formGrid}>
                        <Field label="Title">
                          <input
                            style={styles.input}
                            value={editing.title}
                            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                          />
                        </Field>
                        <Field label="Document number">
                          <input
                            style={styles.input}
                            value={editing.documentNumber || ''}
                            onChange={(e) => setEditing({ ...editing, documentNumber: e.target.value })}
                          />
                        </Field>
                        <Field label="Date">
                          <input
                            type="date"
                            style={styles.input}
                            value={editing.documentDate || ''}
                            onChange={(e) => setEditing({ ...editing, documentDate: e.target.value })}
                          />
                        </Field>
                        <Field label="Status" hint={isLocked ? 'Approval is determined by the signature checklist.' : undefined}>
                          <select
                            style={styles.input}
                            value={editing.status}
                            onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                          >
                            {Object.entries(DOC_STATUS_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>

                      <div style={styles.labelRow}>
                        <span style={styles.label}>Labels</span>
                        <div style={styles.chipRow}>
                          {activeLabels.map((l) => (
                            <button
                              key={l.id}
                              type="button"
                              onClick={() =>
                                setEditing((prev) => ({
                                  ...prev,
                                  labels: prev.labels.includes(l.id)
                                    ? prev.labels.filter((x) => x !== l.id)
                                    : [...prev.labels, l.id],
                                }))
                              }
                              style={{
                                ...styles.chip,
                                ...((editing.labels || []).includes(l.id) ? styles.chipActive : {}),
                              }}
                            >
                              {l.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div style={styles.actionRow}>
                        <button onClick={saveEdit} disabled={busy} style={styles.primary}>
                          <HiCheckCircle /> Save changes
                        </button>
                        <button onClick={() => setEditing(null)} style={styles.secondary}>
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : previewError ? (
                    <div style={styles.previewErrorBox}>
                      <HiExclamationCircle style={{ fontSize: '1.4rem', color: T.error, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <p style={{ margin: 0, fontWeight: 600, color: T.error, fontSize: '0.88rem' }}>{previewError}</p>
                        <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: T.textSoft }}>
                          You can retry loading the preview or download the original file directly.
                        </p>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={() => loadPreview(document, true)}
                          style={styles.retryBtn}
                        >
                          <HiRefresh /> Retry
                        </button>
                        <button
                          type="button"
                          onClick={() => download(document)}
                          style={styles.secondary}
                        >
                          <HiDownload /> Download
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={styles.previewContainer}>
                      {(previewLoading || (!iframeLoaded && previewUrl)) && (
                        <div style={styles.previewLoadingOverlay}>
                          <div style={styles.spinner} />
                          <div style={{ textAlign: 'center' }}>
                            <p style={styles.previewLoadingText}>
                              {previewLoading
                                ? `Loading document preview… ${previewProgress}%`
                                : 'Rendering document viewer…'}
                            </p>
                            <span style={styles.previewLoadingSubtext}>
                              Streaming from document storage
                            </span>
                          </div>
                        </div>
                      )}
                      {previewUrl ? (
                        (/\.(png|jpe?g|webp|gif)$/i.test(document.originalFileName || '') || (document.mimeType && document.mimeType.startsWith('image/'))) ? (
                          <div style={{ width: '100%', maxHeight: '70vh', overflow: 'auto', display: 'flex', justifyContent: 'center', backgroundColor: T.bgTertiary, borderRadius: '0.6rem', border: `1px solid ${T.borderSoft}`, padding: '1rem' }}>
                            <img
                              src={previewUrl}
                              alt={document.title || 'Document preview'}
                              style={{ maxWidth: '100%', height: 'auto', objectFit: 'contain', borderRadius: '4px' }}
                              onLoad={() => {
                                setIframeLoaded(true);
                                setPreviewLoading(false);
                              }}
                              onError={() => {
                                setPreviewError('Failed to display preview image. Try downloading.');
                                setPreviewLoading(false);
                              }}
                            />
                          </div>
                        ) : (
                          <iframe
                            title={document.title}
                            src={previewUrl}
                            style={{
                              ...styles.frame,
                              opacity: iframeLoaded ? 1 : 0,
                              transition: 'opacity 0.15s ease-in-out',
                            }}
                            onLoad={() => {
                              setIframeLoaded(true);
                              setPreviewLoading(false);
                            }}
                          />
                        )
                      ) : (
                        !previewLoading && (
                          <div style={styles.previewPlaceholder}>
                            <p style={styles.helper}>No preview available.</p>
                            <button
                              type="button"
                              onClick={() => loadPreview(document, true)}
                              style={styles.retryBtn}
                            >
                              <HiEye /> Load Preview
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      {children}
      {hint && <span style={styles.hint}>{hint}</span>}
    </label>
  );
}

function Stat({ label, value }) {
  return (
    <div style={styles.stat}>
      <span style={styles.statLabel}>{label}</span>
      <span style={styles.statValue}>{value}</span>
    </div>
  );
}

function IconBtn({ title, onClick, danger, children }) {
  return (
    <button title={title} onClick={onClick} style={{ ...styles.iconBtn, ...(danger ? styles.iconBtnDanger : {}) }}>
      {children}
    </button>
  );
}

// ════════════════════════════════════════════════════════════
// Styles — theme tokens, so the archive follows the active theme.
// ════════════════════════════════════════════════════════════
const styles = {
  page: { ...S.page, backgroundColor: 'transparent' },
  header: { display: 'flex', gap: '1rem', alignItems: 'flex-start', marginBottom: '1.5rem' },
  headerIcon: { fontSize: '2.4rem', color: T.accent, flexShrink: 0 },
  title: { fontSize: '1.8rem', color: T.text, margin: 0, fontWeight: 'bold' },
  subtitle: { fontSize: '0.9rem', color: T.textSoft, marginTop: '0.3rem' },

  banner: (tone) => ({
    ...statusBanner(tone),
    position: 'relative',
  }),
  storageNotice: {
    backgroundColor: T.infoLight,
    color: T.info,
    border: `1px solid ${T.info}`,
    padding: '0.8rem 1rem',
    borderRadius: '0.5rem',
    fontSize: '0.85rem',
    marginBottom: '1rem',
    lineHeight: '1.6',
  },
  bannerClose: {
    marginLeft: 'auto',
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: '1rem',
  },

  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '1rem',
    marginBottom: '1.5rem',
  },
  stat: {
    backgroundColor: T.bgCard,
    border: `1px solid ${T.borderSoft}`,
    borderRadius: '0.8rem',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  statLabel: {
    color: T.textSoft,
    fontSize: '0.72rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  statValue: { color: T.text, fontSize: '1.5rem', fontWeight: 'bold' },

  card: { ...S.card, padding: '1.5rem' },
  sectionTitle: {
    ...S.sectionTitle,
    fontSize: '1.1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },

  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '1rem',
    marginBottom: '1rem',
  },
  field: { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  label: { ...S.label, marginBottom: 0 },
  hint: { color: T.warning, fontSize: '0.72rem' },
  input: { ...S.input, width: '100%' },

  labelRow: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' },
  chip: {
    padding: '0.3rem 0.7rem',
    borderRadius: '50px',
    border: `1px solid ${T.border}`,
    backgroundColor: T.bgTertiary,
    color: T.textSoft,
    fontSize: '0.75rem',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  chipActive: {
    backgroundColor: T.accentLight,
    borderColor: T.accent,
    color: T.accent,
    fontWeight: 'bold',
  },
  miniChip: {
    padding: '0.15rem 0.5rem',
    borderRadius: '50px',
    backgroundColor: T.bgTertiary,
    color: T.textSoft,
    fontSize: '0.68rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.2rem',
  },

  uploadStep: {
    marginBottom: '1.2rem',
    padding: '1rem',
    borderRadius: '0.7rem',
    border: `1px solid ${T.borderSoft}`,
    backgroundColor: T.bgTertiary,
  },
  stepHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    marginBottom: '0.8rem',
  },
  stepNumber: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.8rem',
    height: '1.8rem',
    borderRadius: '50%',
    backgroundColor: T.accent,
    color: T.textOnAccent,
    fontSize: '0.85rem',
    fontWeight: 'bold',
  },
  stepTitle: {
    color: T.text,
    fontSize: '0.95rem',
    fontWeight: 'bold',
  },
  dropRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.8rem',
    flexWrap: 'wrap',
  },
  fileInput: { color: T.text, fontSize: '0.85rem', maxWidth: '100%' },
  fileNote: { color: T.textSoft, fontSize: '0.78rem' },
  selectedFile: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.8rem',
    padding: '0.8rem',
    borderRadius: '0.6rem',
    border: `2px solid ${T.success}`,
    backgroundColor: T.successLight,
  },
  fileInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem',
  },
  fileSize: {
    color: T.textSoft,
    fontSize: '0.78rem',
  },
  errorText: { color: T.error, fontSize: '0.85rem', margin: '0.4rem 0' },
  helper: { color: T.textSoft, fontSize: '0.85rem', padding: '1rem 0' },
  progressNote: { color: T.textSoft, fontSize: '0.85rem' },

  actionRow: { display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' },
  primary: { ...S.primaryButton, minWidth: 0, padding: '0.8rem 1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' },
  secondary: {
    ...S.secondaryButton,
    padding: '0.5rem 1rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.3rem',
    fontSize: '0.85rem',
  },
  danger: {
    padding: '0.5rem 1rem',
    backgroundColor: T.error,
    color: T.textOnAccent,
    border: 'none',
    borderRadius: '50px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },

  filterRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: '0.8rem',
    alignItems: 'center',
    marginBottom: '1rem',
  },
  searchWrap: { position: 'relative' },
  searchIcon: {
    position: 'absolute',
    left: '0.7rem',
    top: '50%',
    transform: 'translateY(-50%)',
    color: T.textMuted,
    pointerEvents: 'none',
  },

  row: {
    backgroundColor: T.bgCard,
    border: `1px solid ${T.borderSoft}`,
    borderRadius: '0.9rem',
    padding: '1.1rem',
    marginBottom: '0.8rem',
  },
  rowHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '1rem',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
  },
  rowMain: { display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: '1 1 320px' },
  rowTitle: { color: T.text, fontSize: '1.02rem' },
  rowMeta: { color: T.textSoft, fontSize: '0.78rem' },
  rowActions: { display: 'flex', gap: '0.4rem' },
  iconBtn: {
    backgroundColor: 'transparent',
    border: `1px solid ${T.border}`,
    borderRadius: '6px',
    padding: '0.35rem 0.5rem',
    color: T.textSoft,
    cursor: 'pointer',
  },
  iconBtnDanger: { color: T.error, borderColor: T.error },

  confirmBox: {
    marginTop: '0.8rem',
    padding: '0.8rem',
    borderRadius: '0.6rem',
    backgroundColor: T.errorLight,
    display: 'flex',
    gap: '0.8rem',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  confirmText: { color: T.error, fontSize: '0.85rem', margin: 0, flex: '1 1 240px' },

  rowBody: { marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${T.borderSoft}` },
  frame: {
    width: '100%',
    height: '70vh',
    border: `1px solid ${T.borderSoft}`,
    borderRadius: '0.6rem',
    backgroundColor: T.bgTertiary,
  },
  previewContainer: {
    position: 'relative',
    width: '100%',
    minHeight: '260px',
    marginTop: '0.8rem',
  },
  previewLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: '260px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.85rem',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    backdropFilter: 'blur(4px)',
    borderRadius: '0.6rem',
    border: `1px solid ${T.borderSoft}`,
    zIndex: 2,
  },
  spinner: {
    width: '36px',
    height: '36px',
    border: '3px solid rgba(255, 255, 255, 0.15)',
    borderTop: `3px solid ${T.accent}`,
    borderRadius: '50%',
    animation: 'docPreviewSpin 0.8s linear infinite',
  },
  previewLoadingText: {
    margin: 0,
    color: T.text,
    fontSize: '0.88rem',
    fontWeight: 600,
  },
  previewLoadingSubtext: {
    color: T.textMuted,
    fontSize: '0.74rem',
  },
  previewPlaceholder: {
    minHeight: '160px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.6rem',
    backgroundColor: T.bgTertiary,
    borderRadius: '0.6rem',
    border: `1px solid ${T.borderSoft}`,
  },
  previewErrorBox: {
    marginTop: '0.8rem',
    padding: '0.9rem 1.1rem',
    borderRadius: '0.6rem',
    backgroundColor: T.errorLight,
    border: `1px solid ${T.error}`,
    display: 'flex',
    alignItems: 'center',
    gap: '0.9rem',
    flexWrap: 'wrap',
  },
  retryBtn: {
    padding: '0.42rem 0.8rem',
    backgroundColor: T.accent,
    color: T.textOnAccent,
    border: 'none',
    borderRadius: '6px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.8rem',
  },

  empty: {
    ...S.card,
    textAlign: 'center',
    color: T.textSoft,
  },
};

export default DocumentDashboard;