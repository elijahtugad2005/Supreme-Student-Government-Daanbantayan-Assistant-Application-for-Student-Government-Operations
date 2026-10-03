// components/Document/DocumentDashboard.jsx
// PURPOSE: Phase 1 — document repository. Upload, list, preview, download and
// label administrative documents.
//
// No AI here by design. The specification is explicit that the repository comes
// first, and building it on the plain record means Gemini processing in Phase 2
// enriches documents that already exist rather than becoming a prerequisite for
// having any.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import {
  ACCEPT_ATTRIBUTE,
  DOC_STATUS,
  DOC_STATUS_LABELS,
  MAX_FILE_BYTES,
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
  office: '',
  labels: [],
  keywords: '',
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
          keywords: form.keywords
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
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
  const togglePreview = async (document) => {
    if (openId === document.id) {
      setOpenId('');
      setPreviewUrl(null);
      setPreviewError('');
      return;
    }
    setOpenId(document.id);
    setEditing(null);
    setPreviewUrl(null);
    setPreviewError('');
    try {
      setPreviewUrl(await getDocumentUrl(document));
    } catch (error) {
      setPreviewError(error.message);
    }
  };

  const download = async (document) => {
    try {
      const url = await getDocumentUrl(document);
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

          <Field label="Office">
            <input
              style={styles.input}
              value={form.office}
              onChange={(e) => setForm({ ...form, office: e.target.value })}
              placeholder="e.g., Secretariat"
              list="document-offices"
              disabled={busy}
            />
            <datalist id="document-offices">
              {offices.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </Field>

          <Field label="Keywords">
            <input
              style={styles.input}
              value={form.keywords}
              onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              placeholder="comma, separated"
              disabled={busy}
            />
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

        <div style={styles.dropRow}>
          <input
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            onChange={(e) => pickFile(e.target.files?.[0])}
            style={styles.fileInput}
            disabled={busy}
          />
          <span style={styles.fileNote}>
            {file
              ? `${file.name} · ${formatBytes(file.size)}`
              : `Accepted: ${ACCEPT_ATTRIBUTE.replace(/,/g, ', ')} · up to ${formatBytes(MAX_FILE_BYTES)}`}
          </span>
        </div>

        {fileError && <p style={styles.errorText}>{fileError}</p>}

        <div style={styles.actionRow}>
          <button onClick={submitUpload} disabled={busy || !file} style={styles.primary}>
            {busy ? 'Uploading…' : 'Upload document'}
          </button>
          {progress !== null && <span style={styles.progressNote}>{progress}%</span>}
        </div>
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
                    <p style={styles.errorText}>{previewError}</p>
                  ) : previewUrl ? (
                    <iframe title={document.title} src={previewUrl} style={styles.frame} />
                  ) : (
                    <p style={styles.helper}>Loading preview…</p>
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

  dropRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.8rem',
    flexWrap: 'wrap',
    padding: '0.8rem',
    border: `2px dashed ${T.border}`,
    borderRadius: '0.8rem',
    backgroundColor: T.bgTertiary,
    marginBottom: '1rem',
  },
  fileInput: { color: T.text, fontSize: '0.85rem', maxWidth: '100%' },
  fileNote: { color: T.textSoft, fontSize: '0.78rem' },
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

  empty: {
    ...S.card,
    textAlign: 'center',
    color: T.textSoft,
  },
};

export default DocumentDashboard;