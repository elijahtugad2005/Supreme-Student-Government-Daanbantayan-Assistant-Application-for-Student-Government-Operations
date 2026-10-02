import React, { useState, useCallback } from "react";
import dash from "./memberdashboard.module.css";
import styles from "./WorkinProgress/organization.module.css";
import {
  SSG_ID, SSG_DEFAULT_NAME, ICON_CHOICES, SECTION_PRESETS,
  compressImage, getSections, makeSection,
} from "./orgUtils";

const move = (arr, i, dir) => {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = arr.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

/**
 * Create / edit an organization.
 *  - name, description, logo  → shared by every term
 *  - sections + positions     → the hierarchy chart for the selected `term`
 *  - SSG only edits name/logo (its chart layout is fixed)
 */
export default function OrganizationModal({ mode, org, term, onClose, onSave, onDelete, saving }) {
  const isSSG = org?.id === SSG_ID;
  const isEdit = mode === "edit";

  const [form, setForm] = useState(() => ({
    name: org?.name ?? (isSSG ? SSG_DEFAULT_NAME : ""),
    description: org?.description ?? "",
    logo64: org?.logo64 ?? "",
  }));
  const [sections, setSections] = useState(() =>
    isEdit && !isSSG ? JSON.parse(JSON.stringify(getSections(org, term))) : [makeSection("officers")]
  );
  const [applyAsDefault, setApplyAsDefault] = useState(false);
  const [error, setError] = useState("");

  const setField = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const handleLogo = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Please choose an image file for the logo.");
    try {
      const logo64 = await compressImage(file, { maxSize: 320, keepTransparency: true });
      setForm((p) => ({ ...p, logo64 }));
      setError("");
    } catch {
      setError("Couldn't process that image. Try another file.");
    }
  }, []);

  // ── section helpers ──
  const patchSection = (i, patch) =>
    setSections((s) => s.map((sec, idx) => (idx === i ? { ...sec, ...patch } : sec)));
  const patchPosition = (si, pi, patch) =>
    setSections((s) => s.map((sec, idx) => idx !== si ? sec : {
      ...sec, positions: sec.positions.map((p, k) => (k === pi ? { ...p, ...patch } : p)),
    }));
  const movePosition = (si, pi, dir) =>
    setSections((s) => s.map((sec, idx) => idx !== si ? sec : { ...sec, positions: move(sec.positions, pi, dir) }));
  const removePosition = (si, pi) =>
    setSections((s) => s.map((sec, idx) => idx !== si ? sec : { ...sec, positions: sec.positions.filter((_, k) => k !== pi) }));
  const addPosition = (si) =>
    setSections((s) => s.map((sec, idx) => idx !== si ? sec : { ...sec, positions: [...sec.positions, { title: "", sameLevel: false }] }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError("Organization name is required.");

    let cleaned = [];
    if (!isSSG) {
      cleaned = sections.map((sec) => ({
        key: sec.key,
        label: sec.label.trim(),
        icon: sec.icon,
        layout: sec.layout,
        limit: Math.max(0, parseInt(sec.limit, 10) || 0),
        positions: sec.positions
          .map((p) => ({ title: p.title.trim(), sameLevel: !!p.sameLevel }))
          .filter((p) => p.title),
      }));
      if (!cleaned.length) return setError("Add at least one section.");
      if (cleaned.some((s) => !s.label)) return setError("Every section needs a name.");
    }
    setError("");
    onSave({ ...form, name: form.name.trim(), description: form.description.trim(), sections: cleaned, applyAsDefault });
  };

  return (
    <div className={dash.modalOverlay} onClick={onClose}>
      <div className={`${dash.modalContainer} ${styles.orgModalWide}`} onClick={(e) => e.stopPropagation()}>
        <div className={dash.modalHeader}>
          <div className={dash.modalHeaderTitle}>
            <span className={dash.modalHeaderBadge}>{isEdit ? "✎" : "+"}</span>
            <h3>{isEdit ? `Edit ${form.name || "Organization"}` : "Add Organization"}</h3>
          </div>
          <button type="button" className={dash.modalCloseBtn} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className={dash.modalForm}>
          {/* Identity */}
          <div className={styles.logoRow}>
            <div className={styles.logoPreview}>
              {form.logo64 ? <img src={form.logo64} alt="Logo preview" /> : <span>{(form.name || "O").charAt(0).toUpperCase()}</span>}
            </div>
            <div className={styles.logoActions}>
              <input type="file" accept="image/*" id="orgLogoInput" className={dash.fileInputHidden} onChange={handleLogo} />
              <label htmlFor="orgLogoInput" className={dash.customUploadBtn}>🖼️ {form.logo64 ? "Change Logo" : "Upload Logo"}</label>
              {form.logo64 && (
                <button type="button" className={styles.linkBtn} onClick={() => setForm((p) => ({ ...p, logo64: "" }))}>
                  Remove
                </button>
              )}
              <small className={styles.helperText}>Square PNG works best. Resized automatically.</small>
            </div>
          </div>

          <div className={dash.formGroupFull}>
            <label>Organization Name *</label>
            <input
              className={styles.wideInput}
              name="name"
              value={form.name}
              onChange={setField}
              placeholder="e.g. Junior Philippine Computer Society"
              required
            />
          </div>

          {!isSSG && (
            <div className={dash.formGroupFull}>
              <label>Description</label>
              <textarea name="description" rows="2" value={form.description} onChange={setField} placeholder="What does this organization do?" />
            </div>
          )}

          {/* Hierarchy builder */}
          {!isSSG ? (
            <div className={styles.sectionsEditor}>
              <div className={styles.editorHead}>
                <div>
                  <h4>Sections &amp; hierarchy</h4>
                  <small className={styles.helperText}>
                    Chart for term <b>{term}</b>. Sections and positions are listed top-to-bottom, highest first.
                  </small>
                </div>
              </div>

              {sections.map((sec, si) => (
                <div key={sec.key} className={styles.sectionCard}>
                  <div className={styles.sectionCardHead}>
                    <select className={styles.miniSelect} value={sec.icon} onChange={(e) => patchSection(si, { icon: e.target.value })} aria-label="Icon">
                      {ICON_CHOICES.map((ic) => <option key={ic} value={ic}>{ic}</option>)}
                    </select>
                    <input
                      className={styles.miniInput}
                      value={sec.label}
                      onChange={(e) => patchSection(si, { label: e.target.value })}
                      placeholder="Section name (e.g. Secretaries)"
                    />
                    <label className={styles.inlineField}>
                      Limit
                      <input
                        type="number" min="0" className={`${styles.miniInput} ${styles.limitInput}`}
                        value={sec.limit} onChange={(e) => patchSection(si, { limit: e.target.value })}
                        title="0 = unlimited"
                      />
                    </label>
                    <select className={styles.miniSelect} value={sec.layout} onChange={(e) => patchSection(si, { layout: e.target.value })}>
                      <option value="tree">Hierarchy tree</option>
                      <option value="grid">Simple grid</option>
                    </select>
                    <div className={styles.rowBtns}>
                      <button type="button" className={styles.iconBtn} onClick={() => setSections((s) => move(s, si, -1))} disabled={si === 0} title="Move section up">↑</button>
                      <button type="button" className={styles.iconBtn} onClick={() => setSections((s) => move(s, si, 1))} disabled={si === sections.length - 1} title="Move section down">↓</button>
                      <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => setSections((s) => s.filter((_, i) => i !== si))} title="Remove section">✕</button>
                    </div>
                  </div>

                  <div className={styles.positionList}>
                    {sec.positions.length === 0 && (
                      <small className={styles.helperText}>No positions yet — members can still be added with any title.</small>
                    )}
                    {sec.positions.map((p, pi) => (
                      <div key={pi} className={styles.positionRow}>
                        <span className={styles.rankTag}>{pi + 1}</span>
                        <input
                          className={styles.miniInput}
                          value={p.title}
                          onChange={(e) => patchPosition(si, pi, { title: e.target.value })}
                          placeholder="Position title"
                        />
                        <label className={styles.sameLevel} title="Place this position beside the one above it">
                          <input
                            type="checkbox" checked={!!p.sameLevel} disabled={pi === 0}
                            onChange={(e) => patchPosition(si, pi, { sameLevel: e.target.checked })}
                          />
                          same level
                        </label>
                        <div className={styles.rowBtns}>
                          <button type="button" className={styles.iconBtn} onClick={() => movePosition(si, pi, -1)} disabled={pi === 0}>↑</button>
                          <button type="button" className={styles.iconBtn} onClick={() => movePosition(si, pi, 1)} disabled={pi === sec.positions.length - 1}>↓</button>
                          <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => removePosition(si, pi)}>✕</button>
                        </div>
                      </div>
                    ))}
                    <button type="button" className={styles.linkBtn} onClick={() => addPosition(si)}>+ Add position</button>
                  </div>
                </div>
              ))}

              <div className={styles.presetRow}>
                <span>Add section:</span>
                {Object.entries(SECTION_PRESETS).map(([key, p]) => (
                  <button key={key} type="button" className={styles.presetBtn} onClick={() => setSections((s) => [...s, makeSection(key)])}>
                    {p.icon} {key === "blank" ? "Blank" : p.label}
                  </button>
                ))}
              </div>

              {isEdit && (
                <label className={styles.checkRow}>
                  <input type="checkbox" checked={applyAsDefault} onChange={(e) => setApplyAsDefault(e.target.checked)} />
                  Also use this chart as the default for new terms
                </label>
              )}
            </div>
          ) : (
            <small className={styles.helperText}>
              The SSG chart layout is fixed. Its hierarchy changes per term through the officers you add.
            </small>
          )}

          {error && <p className={styles.formError}>{error}</p>}

          <div className={`${dash.modalFooter} ${styles.footerSplit}`}>
            {isEdit && !isSSG ? (
              <button type="button" className={styles.dangerBtn} onClick={onDelete} disabled={saving}>🗑️ Delete Organization</button>
            ) : <span />}
            <div className={styles.footerRight}>
              <button type="button" className={dash.cancelBtn} onClick={onClose}>Cancel</button>
              <button type="submit" className={dash.submitBtn} disabled={saving}>
                {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Organization"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
