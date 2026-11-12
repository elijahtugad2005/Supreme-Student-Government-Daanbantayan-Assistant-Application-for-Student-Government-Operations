import React, { useCallback, useEffect, useState } from 'react';
import { S, T, statusPill } from '../utils/themeStyles';
import { compressImage } from './orgUtils';
import {
  AID_TYPES,
  AID_TYPE_LABELS,
  BENEFICIARY_STATUS,
  createBeneficiaryCase,
  listBeneficiaryCases,
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
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.82)',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
  },
};

/** Full-size memo photo viewer (lightbox). */
export function MemoLightbox({ beneficiary, onClose }) {
  if (!beneficiary) return null;
  return (
    <div style={s.backdrop} onClick={onClose} role="dialog" aria-label="Official memorandum photo">
      <div style={{ maxWidth: '720px', width: '100%', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
        <img
          src={beneficiary.memoPhotoDataUrl}
          alt={`Memorandum for ${beneficiary.studentName}`}
          style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '0.5rem' }}
        />
        <div style={{ color: '#fff', marginTop: '0.6rem', fontSize: '0.85rem' }}>
          {beneficiary.memoReference || 'Official SSG Memorandum'}
        </div>
        <button type="button" onClick={onClose} style={{ ...s.btn2, marginTop: '0.7rem' }}>
          Close
        </button>
      </div>
    </div>
  );
}

function CaseSummary({ item, onView, children }) {
  return (
    <div style={s.caseCard}>
      <img
        src={item.memoPhotoDataUrl}
        alt="Memo thumbnail"
        style={s.thumb}
        onClick={() => onView(item)}
      />
      <div style={{ flex: 1, minWidth: '220px' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={statusPill(item.aidType === AID_TYPES.TECHNOCARE ? 'info' : 'warning')}>
            {AID_TYPE_LABELS[item.aidType] || item.aidType}
          </span>
          {item.status === BENEFICIARY_STATUS.CLOSED && <span style={statusPill('error')}>Closed</span>}
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
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button type="button" style={s.btn2} onClick={() => onView(item)}>
            View official memo photo
          </button>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Step 0 of the collection form: choose which beneficiary case is being funded. */
export function BeneficiaryPicker({ value, onChange, say }) {
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

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <label style={s.label}>
        Choose the Death Aid / TechnoCare beneficiary <span style={{ color: T.error }}>*</span>
      </label>
      {cases.map((item) => (
        <CaseSummary key={item.beneficiaryId} item={item} onView={setViewing}>
          <button
            type="button"
            style={value?.beneficiaryId === item.beneficiaryId ? s.btn : s.btn2}
            onClick={() => onChange(item)}
          >
            {value?.beneficiaryId === item.beneficiaryId ? '✓ Selected' : 'Select this beneficiary'}
          </button>
        </CaseSummary>
      ))}
      <MemoLightbox beneficiary={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

/** Officer tab: publish and close beneficiary cases. */
export function BeneficiariesView({ actor, say }) {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCases(await listBeneficiaryCases());
    } catch (e) {
      say('error', `Could not load beneficiary cases: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [say]);

  useEffect(() => {
    load();
  }, [load]);

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
        <h3 style={S.sectionTitle}>Published cases</h3>
        {loading ? (
          <p style={S.helper}>Loading…</p>
        ) : cases.length === 0 ? (
          <p style={S.helper}>No beneficiary cases yet.</p>
        ) : (
          cases.map((item) => (
            <CaseSummary key={item.beneficiaryId} item={item} onView={setViewing}>
              <button type="button" style={s.btn2} onClick={() => toggle(item)}>
                {item.status === BENEFICIARY_STATUS.OPEN ? 'Close case' : 'Reopen case'}
              </button>
            </CaseSummary>
          ))
        )}
      </div>
      <MemoLightbox beneficiary={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

