import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { S, T, statusPill } from '../utils/themeStyles';
import { compressImage } from './orgUtils';
import {
  AID_TYPES,
  AID_TYPE_LABELS,
  BENEFICIARY_STATUS,
  computeBeneficiaryCollectionSummary,
  createBeneficiaryCase,
  listBeneficiaryCases,
  listCollections,
  releaseBeneficiaryAid,
  setBeneficiaryStatus,
} from '../services/deathAidService';

const EMPTY_FORM = {
  aidType: AID_TYPES.TECHNOCARE,
  studentName: '',
  studentProgramSection: '',
  affectedSubjectType: 'student',
  affectedPersonName: '',
  relationshipToStudent: '',
  caseSummary: '',
  memoReference: '',
  memoPhotoDataUrl: '',
  defaultContribution: '1',
};

const peso = (n) =>
  `₱${Number(n || 0).toLocaleString('en-PH', {
    minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

const formatDate = (value) => {
  if (!value) return '—';
  const d = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
};

const s = {
  card: { ...S.card, marginBottom: '1rem' },
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' },
  group: { display: 'flex', flexDirection: 'column', marginBottom: '0.75rem' },
  label: S.label,
  input: { ...S.input, padding: '0.5rem', borderRadius: '0.4rem', fontSize: '0.85rem' },
  select: { ...S.select, padding: '0.5rem', borderRadius: '0.4rem', fontSize: '0.85rem' },
  btn: S.primaryButton,
  btn2: S.secondaryButton,
  muted: { color: T.textMuted, fontSize: '0.78rem' },
  caseCard: {
    display: 'flex',
    gap: '1rem',
    padding: '0.9rem',
    borderRadius: '0.7rem',
    border: `1px solid ${T.borderSoft}`,
    backgroundColor: T.bgTertiary,
    marginBottom: '0.75rem',
    flexWrap: 'wrap',
  },
  thumb: {
    width: '84px',
    height: '110px',
    objectFit: 'cover',
    borderRadius: '0.4rem',
    border: `1px solid ${T.border}`,
    cursor: 'zoom-in',
    backgroundColor: T.bgCard,
  },
  backdrop: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    width: '100vw',
    height: '100dvh',
    backgroundColor: 'rgba(0,0,0,0.82)',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
    boxSizing: 'border-box',
  },
  modalBox: {
    backgroundColor: T.bgCard,
    border: `1px solid ${T.border}`,
    borderRadius: '0.85rem',
    maxWidth: '580px',
    width: '100%',
    maxHeight: '90dvh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
  },
  modalHeader: {
    padding: '1rem 1.25rem',
    borderBottom: `1px solid ${T.borderSoft}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
  },
  modalBody: {
    padding: '1rem 1.25rem',
    overflowY: 'auto',
    flex: '1 1 auto',
  },
  modalFooter: {
    padding: '0.85rem 1.25rem',
    borderTop: `1px solid ${T.borderSoft}`,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.6rem',
  },
  metricsStrip: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
    marginTop: '0.45rem',
    fontSize: '0.78rem',
  },
  releaseBanner: {
    marginTop: '0.55rem',
    padding: '0.6rem 0.75rem',
    borderRadius: '0.5rem',
    border: `1px solid ${T.success}`,
    backgroundColor: T.bgCard,
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  warnBanner: {
    padding: '0.65rem 0.8rem',
    borderRadius: '0.5rem',
    border: `1px solid ${T.warning}`,
    backgroundColor: T.bgTertiary,
    color: T.text,
    fontSize: '0.82rem',
    marginBottom: '0.85rem',
    lineHeight: 1.45,
  },
};

/** Full-size photo viewer (lightbox) for official memo OR aid release handover evidence. */
export function MemoLightbox({ beneficiary, mode = 'memo', onClose }) {
  if (!beneficiary) return null;
  const isRelease = mode === 'release' && beneficiary.releasePhotoDataUrl;
  const photoSrc = isRelease ? beneficiary.releasePhotoDataUrl : beneficiary.memoPhotoDataUrl;
  const caption = isRelease
    ? `Release Photo Evidence — ${beneficiary.studentName} · Released ${peso(beneficiary.releasedAmount)} to ${beneficiary.recipientName}`
    : beneficiary.memoReference || 'Official SSG Memorandum';

  return createPortal(
    <div
      style={s.backdrop}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={isRelease ? 'Death Aid release photo evidence' : 'Official memorandum photo'}
    >
      <div style={{ maxWidth: '720px', width: '100%', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
        <img
          src={photoSrc}
          alt={caption}
          style={{ maxWidth: '100%', maxHeight: '78dvh', borderRadius: '0.5rem' }}
        />
        <div style={{ color: '#fff', marginTop: '0.6rem', fontSize: '0.85rem' }}>{caption}</div>
        <button type="button" onClick={onClose} style={{ ...s.btn2, marginTop: '0.7rem' }}>
          Close
        </button>
      </div>
    </div>,
    document.body
  );
}

function CaseSummary({ item, summary = null, onView, children }) {
  const isReleased = item.status === BENEFICIARY_STATUS.RELEASED;

  return (
    <div style={s.caseCard}>
      <img
        src={item.memoPhotoDataUrl}
        alt="Memo thumbnail"
        style={s.thumb}
        onClick={() => onView(item, 'memo')}
      />
      <div style={{ flex: 1, minWidth: '220px' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={statusPill(item.aidType === AID_TYPES.TECHNOCARE ? 'info' : 'warning')}>
            {AID_TYPE_LABELS[item.aidType] || item.aidType}
          </span>
          {item.status === BENEFICIARY_STATUS.OPEN && <span style={statusPill('info')}>Open</span>}
          {item.status === BENEFICIARY_STATUS.CLOSED && <span style={statusPill('error')}>Closed</span>}
          {isReleased && <span style={statusPill('success')}>Aid Released</span>}
        </div>
        <div style={{ color: T.text, fontWeight: 700, marginTop: '0.35rem' }}>{item.studentName}</div>
        {item.studentProgramSection && <div style={s.muted}>{item.studentProgramSection}</div>}
        <div style={{ color: T.text, fontSize: '0.85rem', marginTop: '0.25rem' }}>
          Affected {item.affectedSubjectType === 'relative' ? 'relative' : 'student'}:{' '}
          <strong>{item.affectedPersonName}</strong>
          {item.relationshipToStudent ? ` (${item.relationshipToStudent})` : ''}
        </div>
        {item.caseSummary && (
          <div style={{ ...s.muted, marginTop: '0.3rem', lineHeight: 1.4 }}>{item.caseSummary}</div>
        )}
        {item.memoReference && <div style={{ ...s.muted, marginTop: '0.3rem' }}>{item.memoReference}</div>}

        {summary && (
          <div style={s.metricsStrip}>
            <span style={statusPill('success')}>
              Confirmed: {peso(summary.confirmedAmount)} ({summary.confirmedCount} section
              {summary.confirmedCount === 1 ? '' : 's'})
            </span>
            {summary.pendingCount > 0 && (
              <span style={statusPill('warning')}>
                Pending: {peso(summary.pendingAmount)} ({summary.pendingCount})
              </span>
            )}
            {summary.placeholderSectionCount > 0 && (
              <span style={statusPill('info')}>
                {summary.placeholderSectionCount} Placeholder section
                {summary.placeholderSectionCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}

        {isReleased && (
          <div style={s.releaseBanner}>
            {item.releasePhotoDataUrl && (
              <img
                src={item.releasePhotoDataUrl}
                alt={`Release evidence for ${item.studentName}`}
                style={{ ...s.thumb, width: '64px', height: '64px' }}
                onClick={() => onView(item, 'release')}
              />
            )}
            <div style={{ flex: 1, minWidth: '180px', fontSize: '0.8rem', color: T.text }}>
              <div>
                <strong>Released {peso(item.releasedAmount)}</strong> to{' '}
                <strong>{item.recipientName}</strong>
                {item.recipientRelationship ? ` (${item.recipientRelationship})` : ''}
              </div>
              <div style={s.muted}>
                Released by {item.releasedByName || 'Officer'} · {formatDate(item.releasedAt)}
              </div>
              {item.releaseNotes && (
                <div style={{ ...s.muted, marginTop: '0.15rem' }}>Note: {item.releaseNotes}</div>
              )}
            </div>
          </div>
        )}

        <div style={{ marginTop: '0.55rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" style={s.btn2} onClick={() => onView(item, 'memo')}>
            View official memo photo
          </button>
          {isReleased && item.releasePhotoDataUrl && (
            <button type="button" style={s.btn2} onClick={() => onView(item, 'release')}>
              View release photo evidence
            </button>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/** Step 0 of the collection form: choose 1 or (for officers) multiple open beneficiary cases to fund. */
export function BeneficiaryPicker({
  value = null,
  onChange,
  multiple = false,
  selectedList = [],
  onChangeMultiple,
  say,
}) {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    let alive = true;
    listBeneficiaryCases({ onlyOpen: true })
      .then((rows) => alive && setCases(rows))
      .catch((e) => say?.('error', `Could not load beneficiary cases: ${e.message}`))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [say]);

  if (loading) return <p style={S.helper}>Loading active cases…</p>;
  if (cases.length === 0) {
    return (
      <p style={S.helper}>
        No active Death Aid / TechnoCare case has been published by the SSG yet.
      </p>
    );
  }

  const isSelected = (item) =>
    multiple
      ? selectedList.some((b) => b.beneficiaryId === item.beneficiaryId)
      : value?.beneficiaryId === item.beneficiaryId;

  const handleSelectClick = (item) => {
    if (multiple && typeof onChangeMultiple === 'function') {
      const exists = selectedList.some((b) => b.beneficiaryId === item.beneficiaryId);
      const next = exists
        ? selectedList.filter((b) => b.beneficiaryId !== item.beneficiaryId)
        : [...selectedList, item];
      onChangeMultiple(next);
    } else {
      onChange?.(item);
    }
  };

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
          marginBottom: '0.5rem',
        }}
      >
        <label style={{ ...s.label, marginBottom: 0 }}>
          {multiple
            ? 'Choose Death Aid / TechnoCare beneficiary case(s)'
            : 'Choose the Death Aid / TechnoCare beneficiary'}{' '}
          <span style={{ color: T.error }}>*</span>
        </label>
        {multiple && typeof onChangeMultiple === 'function' && (
          <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {selectedList.length > 0 && (
              <span style={statusPill('success')}>
                {selectedList.length} selected{selectedList.length > 1 ? ' (auto-split)' : ''}
              </span>
            )}
            {cases.length > 1 && (
              <button
                type="button"
                style={s.btn2}
                onClick={() => onChangeMultiple(cases)}
              >
                Select All Open ({cases.length})
              </button>
            )}
            {selectedList.length > 0 && (
              <button
                type="button"
                style={s.btn2}
                onClick={() => onChangeMultiple([])}
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>
      {cases.map((item) => {
        const selected = isSelected(item);
        return (
          <CaseSummary
            key={item.beneficiaryId}
            item={item}
            onView={(target, mode) => setViewing({ item: target, mode })}
          >
            <button
              type="button"
              style={selected ? s.btn : s.btn2}
              onClick={() => handleSelectClick(item)}
            >
              {selected ? '✓ Selected' : multiple ? '+ Include beneficiary' : 'Select this beneficiary'}
            </button>
          </CaseSummary>
        );
      })}
      <MemoLightbox
        beneficiary={viewing?.item}
        mode={viewing?.mode}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}

/** Officer tab: publish, close, and release beneficiary cases with mandatory photo evidence. */
export function BeneficiariesView({ actor, say }) {
  const [cases, setCases] = useState([]);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);

  // Release Aid Modal state
  const [releaseTarget, setReleaseTarget] = useState(null);
  const [releaseForm, setReleaseForm] = useState({
    recipientName: '',
    recipientRelationship: '',
    releasedAmount: '',
    releasePhotoDataUrl: '',
    releaseNotes: '',
  });
  const [releasing, setReleasing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [caseRows, colRows] = await Promise.all([
        listBeneficiaryCases(),
        listCollections().catch(() => []),
      ]);
      setCases(caseRows);
      setCollections(colRows);
    } catch (e) {
      say('error', `Could not load beneficiary cases: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [say]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!releaseTarget && !viewing) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setReleaseTarget(null);
        setViewing(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [releaseTarget, viewing]);

  const summariesByCase = useMemo(() => {
    const map = {};
    for (const item of cases) {
      map[item.beneficiaryId] = computeBeneficiaryCollectionSummary(
        collections,
        item.beneficiaryId
      );
    }
    return map;
  }, [cases, collections]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return say('error', 'Please choose an image file.');
    try {
      set({ memoPhotoDataUrl: await compressImage(file, { maxSize: 1200, quality: 0.8 }) });
    } catch {
      say('error', 'Could not process that image. Try another file.');
    }
  };

  const onReleasePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      return say('error', 'Please choose a photo image file as handover evidence.');
    }
    try {
      const dataUrl = await compressImage(file, { maxSize: 1200, quality: 0.8 });
      setReleaseForm((prev) => ({ ...prev, releasePhotoDataUrl: dataUrl }));
    } catch {
      say('error', 'Could not process that photo. Try another image file.');
    }
  };

  const submit = async () => {
    setSaving(true);
    try {
      const id = await createBeneficiaryCase(form, actor);
      say('success', `${id} published. Students can now select this beneficiary.`);
      setForm(EMPTY_FORM);
      await load();
    } catch (e) {
      say('error', e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (item) => {
    try {
      const next = item.status === BENEFICIARY_STATUS.OPEN ? BENEFICIARY_STATUS.CLOSED : BENEFICIARY_STATUS.OPEN;
      await setBeneficiaryStatus(item, next, actor);
      await load();
    } catch (e) {
      say('error', e.message);
    }
  };

  const openReleaseModal = (item) => {
    const summary = summariesByCase[item.beneficiaryId] || { confirmedAmount: 0, confirmedCount: 0 };
    setReleaseTarget(item);
    setReleaseForm({
      recipientName: item.studentName || item.affectedPersonName || '',
      recipientRelationship:
        item.affectedSubjectType === 'relative'
          ? item.relationshipToStudent || 'Relative / Beneficiary Representative'
          : 'Beneficiary Student',
      releasedAmount: String(summary.confirmedAmount || 0),
      releasePhotoDataUrl: '',
      releaseNotes: '',
    });
  };

  const handleConfirmRelease = async () => {
    if (!releaseTarget) return;
    const summary = summariesByCase[releaseTarget.beneficiaryId] || { confirmedCount: 0 };
    setReleasing(true);
    try {
      const res = await releaseBeneficiaryAid({
        beneficiary: releaseTarget,
        recipientName: releaseForm.recipientName,
        recipientRelationship: releaseForm.recipientRelationship,
        releasedAmount: Number(releaseForm.releasedAmount),
        releasePhotoDataUrl: releaseForm.releasePhotoDataUrl,
        releaseNotes: releaseForm.releaseNotes,
        confirmedCount: summary.confirmedCount,
        officer: actor,
      });
      say(
        'success',
        `Aid released (${peso(res.releasedAmount)}) to ${res.recipientName} with photo evidence recorded in the audit trail.`
      );
      setReleaseTarget(null);
      await load();
    } catch (e) {
      say('error', e.message);
    } finally {
      setReleasing(false);
    }
  };

  const releaseSummary = releaseTarget
    ? summariesByCase[releaseTarget.beneficiaryId] || {
      confirmedAmount: 0,
      confirmedCount: 0,
      pendingCount: 0,
      pendingAmount: 0,
    }
    : null;

  return (
    <div>
      <div style={s.card}>
        <h3 style={S.sectionTitle}>Publish a Death Aid / TechnoCare beneficiary</h3>
        <div style={s.row}>
          <div style={s.group}>
            <label style={s.label}>Aid type *</label>
            <select style={s.select} value={form.aidType} onChange={(e) => set({ aidType: e.target.value })}>
              <option value={AID_TYPES.TECHNOCARE}>TechnoCare (hospitalization)</option>
              <option value={AID_TYPES.DEATH_AID}>Death Aid (bereavement)</option>
            </select>
          </div>
          <div style={s.group}>
            <label style={s.label}>Name of the student *</label>
            <input style={s.input} value={form.studentName} onChange={(e) => set({ studentName: e.target.value })} />
          </div>
          <div style={s.group}>
            <label style={s.label}>Program &amp; section</label>
            <input
              style={s.input}
              value={form.studentProgramSection}
              onChange={(e) => set({ studentProgramSection: e.target.value })}
              placeholder="e.g. BSED-MATHEMATICS 1A"
            />
          </div>
          <div style={s.group}>
            <label style={s.label}>Who is affected? *</label>
            <select
              style={s.select}
              value={form.affectedSubjectType}
              onChange={(e) =>
                set({
                  affectedSubjectType: e.target.value,
                  affectedPersonName: e.target.value === 'student' ? form.studentName : form.affectedPersonName,
                })
              }
            >
              <option value="student">The student</option>
              <option value="relative">A relative / guardian</option>
            </select>
          </div>
          <div style={s.group}>
            <label style={s.label}>Name of affected relative or student *</label>
            <input
              style={s.input}
              value={form.affectedPersonName}
              onChange={(e) => set({ affectedPersonName: e.target.value })}
            />
          </div>
          <div style={s.group}>
            <label style={s.label}>Relationship to student</label>
            <input
              style={s.input}
              value={form.relationshipToStudent}
              onChange={(e) => set({ relationshipToStudent: e.target.value })}
              placeholder="e.g. Self, Mother, Father"
            />
          </div>
          <div style={s.group}>
            <label style={s.label}>Memorandum reference</label>
            <input
              style={s.input}
              value={form.memoReference}
              onChange={(e) => set({ memoReference: e.target.value })}
              placeholder="Memorandum No. 003, Series of 2026-2027"
            />
          </div>
          <div style={s.group}>
            <label style={s.label}>Suggested contribution per student (₱)</label>
            <input
              style={s.input}
              type="number"
              min="0"
              value={form.defaultContribution}
              onChange={(e) => set({ defaultContribution: e.target.value })}
            />
          </div>
        </div>
        <div style={s.group}>
          <label style={s.label}>Call for donation / case summary</label>
          <textarea
            style={{ ...s.input, minHeight: '70px' }}
            value={form.caseSummary}
            onChange={(e) => set({ caseSummary: e.target.value })}
          />
        </div>
        <div style={s.group}>
          <label style={s.label}>Photo of the memo *</label>
          <input type="file" accept="image/*" onChange={onPhoto} />
          {form.memoPhotoDataUrl && (
            <img src={form.memoPhotoDataUrl} alt="Memo preview" style={{ ...s.thumb, marginTop: '0.5rem' }} />
          )}
        </div>
        <button type="button" style={saving ? { ...s.btn, ...S.disabled } : s.btn} disabled={saving} onClick={submit}>
          {saving ? 'Publishing…' : 'Publish beneficiary case'}
        </button>
      </div>

      <div style={s.card}>
        <h3 style={S.sectionTitle}>Published cases &amp; aid release</h3>
        {loading ? (
          <p style={S.helper}>Loading…</p>
        ) : cases.length === 0 ? (
          <p style={S.helper}>No beneficiary cases yet.</p>
        ) : (
          cases.map((item) => {
            const isReleased = item.status === BENEFICIARY_STATUS.RELEASED;
            return (
              <CaseSummary
                key={item.beneficiaryId}
                item={item}
                summary={summariesByCase[item.beneficiaryId]}
                onView={(target, mode) => setViewing({ item: target, mode })}
              >
                {!isReleased && (
                  <>
                    <button
                      type="button"
                      style={s.btn}
                      onClick={() => openReleaseModal(item)}
                    >
                      Release Aid to Beneficiary
                    </button>
                    <button type="button" style={s.btn2} onClick={() => toggle(item)}>
                      {item.status === BENEFICIARY_STATUS.OPEN ? 'Close case' : 'Reopen case'}
                    </button>
                  </>
                )}
              </CaseSummary>
            );
          })
        )}
      </div>

      {releaseTarget &&
        createPortal(
          <div
            style={s.backdrop}
            onClick={() => !releasing && setReleaseTarget(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-aid-modal-title"
          >
            <div style={s.modalBox} onClick={(e) => e.stopPropagation()}>
              <div style={s.modalHeader}>
                <div>
                  <h4 id="release-aid-modal-title" style={{ margin: 0, color: T.text }}>
                    Release {AID_TYPE_LABELS[releaseTarget.aidType] || 'Death Aid'} to Beneficiary
                  </h4>
                  <div style={s.muted}>
                    {releaseTarget.studentName} · Affected: {releaseTarget.affectedPersonName}
                  </div>
                </div>
                <button
                  type="button"
                  style={s.btn2}
                  disabled={releasing}
                  onClick={() => setReleaseTarget(null)}
                >
                  Close
                </button>
              </div>

              <div style={s.modalBody}>
                {releaseSummary?.pendingCount > 0 && (
                  <div style={s.warnBanner}>
                    <strong>Heads up:</strong> {releaseSummary.pendingCount} section filing
                    {releaseSummary.pendingCount === 1 ? ' is' : 's are'} still awaiting verification
                    ({peso(releaseSummary.pendingAmount)}). You may still release the confirmed amount
                    now; releasing will close this case to further filings.
                  </div>
                )}

                <div style={s.row}>
                  <div style={s.group}>
                    <label style={s.label}>Amount to release (₱) *</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      style={s.input}
                      value={releaseForm.releasedAmount}
                      onChange={(e) =>
                        setReleaseForm((p) => ({ ...p, releasedAmount: e.target.value }))
                      }
                    />
                    <span style={s.muted}>
                      Confirmed collected across {releaseSummary?.confirmedCount || 0} section(s):{' '}
                      {peso(releaseSummary?.confirmedAmount || 0)}
                    </span>
                  </div>

                  <div style={s.group}>
                    <label style={s.label}>Received by (Recipient Full Name) *</label>
                    <input
                      type="text"
                      style={s.input}
                      value={releaseForm.recipientName}
                      onChange={(e) =>
                        setReleaseForm((p) => ({ ...p, recipientName: e.target.value }))
                      }
                      placeholder="Full name of student or authorized relative"
                    />
                  </div>
                </div>

                <div style={s.row}>
                  <div style={s.group}>
                    <label style={s.label}>Recipient relationship</label>
                    <input
                      type="text"
                      style={s.input}
                      value={releaseForm.recipientRelationship}
                      onChange={(e) =>
                        setReleaseForm((p) => ({ ...p, recipientRelationship: e.target.value }))
                      }
                      placeholder="e.g. Beneficiary Student, Mother, Guardian"
                    />
                  </div>

                  <div style={s.group}>
                    <label style={s.label}>Handover notes (optional)</label>
                    <input
                      type="text"
                      style={s.input}
                      value={releaseForm.releaseNotes}
                      onChange={(e) =>
                        setReleaseForm((p) => ({ ...p, releaseNotes: e.target.value }))
                      }
                      placeholder="e.g. Released at SSG Office with signed receipt"
                    />
                  </div>
                </div>

                <div style={s.group}>
                  <label style={s.label}>
                    Handover Photo Evidence <span style={{ color: T.error }}>* (Required)</span>
                  </label>
                  <input type="file" accept="image/*" onChange={onReleasePhoto} />
                  {!releaseForm.releasePhotoDataUrl ? (
                    <span style={{ ...s.muted, color: T.warning, marginTop: '0.35rem' }}>
                      Attach a photo proving the aid was handed over to the beneficiary before confirming release.
                    </span>
                  ) : (
                    <div style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <img
                        src={releaseForm.releasePhotoDataUrl}
                        alt="Handover photo preview"
                        style={{ ...s.thumb, width: '96px', height: '96px', cursor: 'default' }}
                      />
                      <span style={{ fontSize: '0.8rem', color: T.success, fontWeight: 600 }}>
                        Photo evidence attached and ready for audit record.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div style={s.modalFooter}>
                <button
                  type="button"
                  style={s.btn2}
                  disabled={releasing}
                  onClick={() => setReleaseTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={
                    releasing || !releaseForm.releasePhotoDataUrl || !releaseForm.recipientName.trim()
                      ? { ...s.btn, ...S.disabled }
                      : s.btn
                  }
                  disabled={
                    releasing || !releaseForm.releasePhotoDataUrl || !releaseForm.recipientName.trim()
                  }
                  onClick={handleConfirmRelease}
                >
                  {releasing ? 'Releasing…' : 'Confirm Release with Photo Evidence'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      <MemoLightbox
        beneficiary={viewing?.item}
        mode={viewing?.mode}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}
