import React, { useState, useMemo, useCallback, memo } from "react";
import styles from "../memberlist.module.css";
import orgStyles from "../WorkinProgress/organization.module.css";
import { db } from "../../firebase/firebaseConfig";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { MemberCard } from "../Memberlist";
import OrgBanner from "./OrgBanner";
import { buildLevels, compressImage, getSections } from "../orgUtils";

const THEMES = [
  ["executiveBranch", "iconExecutive"],
  ["advisoryBranch", "iconAdvisory"],
  ["cabinetBranch", "iconCabinet"],
  ["creativesBranch", "iconCreatives"],
  ["legislativeBranch", "iconLegislative"],
  ["generalBranch", "iconGeneral"],
];

const UNASSIGNED = { key: "__unassigned", label: "Unassigned", icon: "📦", layout: "grid", limit: 0, positions: [] };

// ─── One section (top-level so memo works) ───
const SectionBlock = memo(function SectionBlock({ section, members, total, themeIndex, onAdd, onEdit, onDelete }) {
  const [branch, icon] = THEMES[themeIndex % THEMES.length];
  const limit = Number(section.limit) || 0;
  const full = limit > 0 && total >= limit;
  const isTree = section.layout === "tree";
  const levels = useMemo(() => buildLevels(section, members), [section, members]);

  const card = (m, variant, crown) => (
    <MemberCard
      key={m.docId} member={m} variant={variant} crown={crown}
      onEdit={onEdit} onDelete={onDelete}
    />
  );

  return (
    <div className={`${styles.branchSection} ${styles[branch]}`}>
      <div className={styles.sectionHeader}>
        <div className={styles.headerTitleGroup}>
          <div className={`${styles.branchIconWrapper} ${styles[icon]}`}>{section.icon}</div>
          <div>
            <h2 className={styles.branchTitle}>{section.label.toUpperCase()}</h2>
            <p className={styles.branchSubtitle}>
              {section.positions.length ? section.positions.map((p) => p.title).slice(0, 4).join(" · ") : "Members"}
            </p>
          </div>
        </div>
        {section.key !== UNASSIGNED.key && (
          <div className={styles.headerActions}>
            <span className={styles.memberLimitIndicator}>{total}{limit ? `/${limit}` : ""}</span>
            <button
              type="button"
              className={`${styles.addSectionBtn} ${full ? styles.addBtnDisabled : ""}`}
              onClick={() => onAdd(section.key)}
              disabled={full}
              title={full ? "Member limit reached" : `Add to ${section.label}`}
            >
              <span className={styles.addBtnIcon}>+</span>
              Add Member
            </button>
          </div>
        )}
      </div>

      {isTree && levels.length > 0 ? (
        <div className={styles.executiveTree}>
          {levels.map((lvl, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <div className={styles.treeConnectingLines}>
                  <div className={styles.verticalStem} />
                  <div className={styles.horizontalBar} />
                </div>
              )}
              <div className={i === 0 ? styles.treeTopLevel : styles.treeSecondLevel}>
                {lvl.members.length ? (
                  lvl.members.map((m) => card(m, i === 0 ? "executiveLeader" : "executiveSub", i === 0 && !lvl.isOther))
                ) : (
                  <div className={styles.emptySlotNotice}>No {lvl.titles.join(" / ")} yet</div>
                )}
              </div>
            </React.Fragment>
          ))}
        </div>
      ) : (
        <div className={styles.cardsGridFour}>
          {members.length ? (
            levels.flatMap((l) => l.members).map((m) => card(m, "general", false))
          ) : (
            <p className={styles.emptyBranchNotice}>No members in {section.label} yet.</p>
          )}
        </div>
      )}
    </div>
  );
});

// ─── Edit modal (own component so typing doesn't re-render the whole chart) ───
function MemberEditModal({ member, sections, terms, onClose, onSaved }) {
  const [form, setForm] = useState({ ...member });
  const [saving, setSaving] = useState(false);
  const change = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

  const positions = sections.find((s) => s.key === form.sectionKey)?.positions ?? [];
  const termOptions = Array.from(new Set([...terms, form.term].filter(Boolean)));

  const handlePhoto = async (e) => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      setForm((p) => ({ ...p, image64: "" }));
      const image64 = await compressImage(file, { maxSize: 1000, quality: 0.8 });
      setForm((p) => ({ ...p, image64 }));
    } catch {
      alert("Failed to process image.");
    }
  };

  const save = async () => {
    setSaving(true);
    const data = {
      name: form.name || "", id: form.id || "", address: form.address || "",
      position: form.position || "", sectionKey: form.sectionKey || "",
      description: form.description || "", image64: form.image64 || "",
      facebookLink: form.facebookLink || "", instagramLink: form.instagramLink || "",
      twitterLink: form.twitterLink || "", term: form.term,
    };
    try {
      await updateDoc(doc(db, "members", member.docId), data);
      onSaved(member.docId, data);
      onClose();
    } catch (err) {
      console.error(err);
      alert("Error updating member. Please check the console.");
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>Edit Member: {form.name}</h3>
          <button className={styles.closeButton} onClick={onClose}>×</button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.editForm}>
            <div className={styles.formGroup}><label>Name:</label><input name="name" value={form.name || ""} onChange={change} /></div>
            <div className={styles.formGroup}><label>ID:</label><input name="id" value={form.id || ""} onChange={change} /></div>
            <div className={styles.formGroup}><label>Address / Dept:</label><input name="address" value={form.address || ""} onChange={change} /></div>
            <div className={styles.formGroup}>
              <label>Section:</label>
              <select name="sectionKey" value={form.sectionKey || ""} onChange={change}>
                {!sections.some((s) => s.key === form.sectionKey) && <option value="">Unassigned</option>}
                {sections.map((s) => <option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Position:</label>
              <input name="position" list={`pos-${member.docId}`} value={form.position || ""} onChange={change} />
              <datalist id={`pos-${member.docId}`}>{positions.map((p) => <option key={p.title} value={p.title} />)}</datalist>
            </div>
            <div className={styles.formGroup}>
              <label>Term:</label>
              <select name="term" value={form.term} onChange={change}>
                {termOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className={styles.formGroup}>
              <label>Description:</label>
              <textarea name="description" rows="3" value={form.description || ""} onChange={change} />
            </div>
            <div className={styles.formGroup}><label>Facebook Profile:</label><input type="url" name="facebookLink" placeholder="https://facebook.com/username" value={form.facebookLink || ""} onChange={change} /></div>
            <div className={styles.formGroup}><label>Instagram:</label><input name="instagramLink" value={form.instagramLink || ""} onChange={change} /></div>
            <div className={styles.formGroup}><label>Twitter / X:</label><input name="twitterLink" value={form.twitterLink || ""} onChange={change} /></div>
            <div className={styles.formGroup}>
              <label>Photo:</label>
              <div className={orgStyles.photoEditRow}>
                {form.image64 && <img src={form.image64} alt="" className={orgStyles.photoThumb} />}
                <input type="file" accept="image/*" onChange={handlePhoto} />
              </div>
            </div>
          </div>
        </div>
        <div className={styles.modalFooter}>
          <button className={styles.cancelButton} onClick={onClose}>Cancel</button>
          <button className={styles.saveButton} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
        </div>
      </div>
    </div>
  );
}

export default function OrganizationView({
  org, members = [], setMembers, searchQuery = "", term, terms = [], isArchived, onOpenAddModal, onEditOrg,
}) {
  const [editing, setEditing] = useState(null);
  const sections = useMemo(() => getSections(org, term), [org, term]);

  // Full counts (limits ignore the search box) and search-filtered lists
  const { grouped, totals, allSections } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const known = new Set(sections.map((s) => s.key));
    const grouped = {};
    const totals = {};
    members.forEach((m) => {
      const key = known.has(m.sectionKey) ? m.sectionKey : UNASSIGNED.key;
      totals[key] = (totals[key] || 0) + 1;
      const hit = !q || [m.name, m.id, m.position].some((v) => v && v.toLowerCase().includes(q));
      if (hit) (grouped[key] = grouped[key] || []).push(m);
    });
    return {
      grouped, totals,
      allSections: totals[UNASSIGNED.key] ? [...sections, UNASSIGNED] : sections,
    };
  }, [members, sections, searchQuery]);

  const handleEdit = useCallback((m) => setEditing(m), []);
  const handleDelete = useCallback(async (docId) => {
    if (!docId || !window.confirm("Are you sure you want to delete this member?")) return;
    try {
      await deleteDoc(doc(db, "members", docId));
      setMembers((prev) => prev.filter((m) => m.docId !== docId));
    } catch (err) {
      console.error(err);
      alert("Error deleting member. Please check the console.");
    }
  }, [setMembers]);
  const handleSaved = useCallback((docId, data) => {
    setMembers((prev) => prev.map((m) => (m.docId === docId ? { ...m, ...data } : m)));
  }, [setMembers]);

  return (
    <div className={styles.container}>
      <OrgBanner
        name={org.name} logo={org.logo64} term={term} isArchived={isArchived}
        description={org.description} onEdit={onEditOrg}
      />

      {allSections.length === 0 && (
        <p className={styles.emptyBranchNotice}>This term has no sections yet. Use “Edit Organization” to build its chart.</p>
      )}

      {allSections.map((sec, i) => (
        <SectionBlock
          key={sec.key}
          section={sec}
          members={grouped[sec.key] || []}
          total={totals[sec.key] || 0}
          themeIndex={i}
          onAdd={onOpenAddModal}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      ))}

      {editing && (
        <MemberEditModal
          member={editing} sections={sections} terms={terms}
          onClose={() => setEditing(null)} onSaved={handleSaved}
        />
      )}
    </div>
  );
}
