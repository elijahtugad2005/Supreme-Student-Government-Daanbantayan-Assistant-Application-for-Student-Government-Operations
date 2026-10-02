import styles from './memberdashboard.module.css';
import orgStyles from '../WorkinProgress/organization.module.css';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Memberslist from './Memberlist';
import OrganizationView from './OrganizationView';
import OrganizationModal from './OrganizationModal';
import { db } from "../firebase/firebaseConfig";
import {
    collection, addDoc, setDoc, updateDoc, deleteDoc, getDocs, writeBatch,
    onSnapshot, query, where, doc,
} from "firebase/firestore";
import {
    SSG_ID, SSG_DEFAULT_NAME, DEFAULT_TERMS, FALLBACK_TERM, isValidTerm, compressImage, getSections, timeOf,
} from './orgUtils';

// SSG position lists (unchanged from the original, grouped by section key)
const SSG_POSITIONS = {
    advisory: ["SSG Adviser", "Assistant SSG Adviser"],
    executive: ["President", "Vice President", "COTE Governor", "COED Governor"],
    legislativeOfficers: ["Speaker", "Treasurer", "Auditor"],
    representatives: ["Representative", "BSHM Representative", "BSIT Representative", "BSFI Representative", "BEED MATH Representative", "BSED Representative", "BIT Representative", "BSIE Representative"],
    senators: ["Senator"],
    cabinet: ["Secretary", "Executive Secretary", "Press Secretary", "Secretary on Network and Linkages", "Secretary on Finance", "Budget And Management Secretary", "Secretary on Audit", "Administrative"],
    creatives: ["Multimedia Director", "Event Director", "Social Media Manager", "Activity Officer", "Graphic Artist", "Multimedia Staff"],
};
const SSG_GROUP_LABELS = {
    advisory: "Advisory", executive: "Executive Branch", legislativeOfficers: "Legislative Officers",
    representatives: "Representatives", senators: "Senate", cabinet: "Executive Cabinet", creatives: "Department of Creatives",
};

const EMPTY_MEMBER = {
    name: "", id: "", address: "", position: "", image64: "", description: "",
    facebookLink: "", instagramLink: "", twitterLink: "", term: "",
};

const SSG_FALLBACK = { id: SSG_ID, name: SSG_DEFAULT_NAME, type: 'ssg' };

function MemberDashboard() {
    const [member, setMember] = useState(EMPTY_MEMBER);
    const [selectedPlatform, setSelectedPlatform] = useState('facebookLink');
    const [preview, setPreview] = useState(null);
    const [members, setMembers] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');

    // Add-member modal: which org + section is it for?
    const [addContext, setAddContext] = useState(null); // { orgId, sectionKey } | null

    // Organizations, terms
    const [orgs, setOrgs] = useState([]);
    const [savedTerms, setSavedTerms] = useState([]);
    const [activeOrgId, setActiveOrgId] = useState(SSG_ID);
    const [termChoice, setTermChoice] = useState(null);
    const [orgModal, setOrgModal] = useState(null); // { mode, orgId } | null
    const [savingOrg, setSavingOrg] = useState(false);
    const [newTermOpen, setNewTermOpen] = useState(false);
    const [newTerm, setNewTerm] = useState('');
    const [termError, setTermError] = useState('');

    // ── Organizations (small collection → one live listener) ──
    useEffect(() => {
        return onSnapshot(collection(db, "organizations"), (snap) => {
            setOrgs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        }, (err) => console.error("organizations listener:", err));
    }, []);

    // ── Terms ──
    useEffect(() => {
        return onSnapshot(collection(db, "terms"), (snap) => {
            setSavedTerms(snap.docs.map((d) => d.id));
        }, (err) => console.error("terms listener:", err));
    }, []);

    const allTerms = useMemo(
        () => Array.from(new Set([...DEFAULT_TERMS, ...savedTerms])).sort().reverse(),
        [savedTerms]
    );
    const currentTerm = allTerms[0];
    const selectedTerm = termChoice && allTerms.includes(termChoice) ? termChoice : currentTerm;
    const isArchived = selectedTerm !== currentTerm;

    // ── Members ──
    useEffect(() => {
        const unsub = onSnapshot(collection(db, "members"), (snap) => {
            const data = snap.docs.map((d) => ({ docId: d.id, ...d.data() }));
            data.sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
            setMembers(data);
        }, (err) => console.error("members listener:", err));
        return () => unsub();
    }, []);

    const ssgOrg = useMemo(() => ({ ...SSG_FALLBACK, ...(orgs.find((o) => o.id === SSG_ID) || {}) }), [orgs]);
    const customOrgs = useMemo(
        () => orgs.filter((o) => o.id !== SSG_ID).sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt)),
        [orgs]
    );
    const activeOrg = activeOrgId === SSG_ID ? ssgOrg : (customOrgs.find((o) => o.id === activeOrgId) || ssgOrg);
    const activeIsSSG = activeOrg.id === SSG_ID;

    // Members with no orgId are legacy SSG records; members with no term belong to FALLBACK_TERM (2025-2026)
    const orgMembers = useMemo(
        () => members.filter((m) => {
            const memberOrgId = m.orgId || SSG_ID;
            const memberTerm = m.term || FALLBACK_TERM;
            return memberOrgId === activeOrg.id && memberTerm === selectedTerm;
        }),
        [members, activeOrg.id, selectedTerm]
    );

    // ── Add-member form ──
    const handleChange = (e) => {
        const { name, value } = e.target;
        setMember((prev) => ({ ...prev, [name]: value }));
    };

    const handlePhotoChange = async (e) => {
        const file = e.target.files[0];
        if (!file) {
            setMember((prev) => ({ ...prev, image64: "" }));
            setPreview(null);
            return;
        }
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file.');
            return;
        }
        try {
            const compressed = await compressImage(file, { maxSize: 1000, quality: 0.8 });
            setMember((prev) => ({ ...prev, image64: compressed }));
            setPreview(compressed);
        } catch (error) {
            console.error("Error processing image:", error);
            alert("Failed to process image. Please try another file.");
            setMember((prev) => ({ ...prev, image64: "" }));
            setPreview(null);
        }
    };

    const handleLinkChange = useCallback((e) => {
        const value = e.target.value;
        setMember((prev) => ({ ...prev, [selectedPlatform]: value }));
    }, [selectedPlatform]);

    const openAdd = useCallback((orgId, sectionKey) => {
        setMember({ ...EMPTY_MEMBER, term: selectedTerm });
        setPreview(null);
        setAddContext({ orgId, sectionKey });
    }, [selectedTerm]);

    const handleOpenSsgAdd = useCallback((sectionKey) => openAdd(SSG_ID, sectionKey), [openAdd]);
    const handleOpenOrgAdd = useCallback((sectionKey) => openAdd(activeOrg.id, sectionKey), [openAdd, activeOrg.id]);
    const closeAdd = useCallback(() => setAddContext(null), []);

    const addOrg = addContext ? (addContext.orgId === SSG_ID ? ssgOrg : customOrgs.find((o) => o.id === addContext.orgId)) : null;
    const addSection = useMemo(() => {
        if (!addContext || addContext.orgId === SSG_ID || !addOrg) return null;
        return getSections(addOrg, selectedTerm).find((s) => s.key === addContext.sectionKey) || null;
    }, [addContext, addOrg, selectedTerm]);

    const handleSubmit = useCallback(async (e) => {
        e.preventDefault();
        if (!addContext) return;
        const isSSG = addContext.orgId === SSG_ID;

        const dataToSave = {
            name: member.name || "",
            id: member.id || "",
            address: member.address || "",
            position: member.position || "",
            image64: member.image64 || "",
            description: member.description || "",
            facebookLink: member.facebookLink || "",
            instagramLink: member.instagramLink || "",
            twitterLink: member.twitterLink || "",
            term: member.term || selectedTerm,
            orgId: addContext.orgId,
            sectionKey: isSSG ? "" : addContext.sectionKey,
            status: "Active",
            createdAt: new Date(),
        };

        try {
            await addDoc(collection(db, "members"), dataToSave);
            setMember(EMPTY_MEMBER);
            setPreview(null);
            setAddContext(null);
        } catch (error) {
            console.error("Error adding member:", error);
            alert("Error adding member. Check console for details.");
        }
    }, [member, addContext, selectedTerm]);

    // ── Organization create / edit / delete ──
    const handleSaveOrg = useCallback(async (payload) => {
        setSavingOrg(true);
        try {
            const base = { name: payload.name, description: payload.description, logo64: payload.logo64 };
            if (orgModal.mode === 'create') {
                const ref = await addDoc(collection(db, "organizations"), {
                    ...base, type: 'custom', sections: payload.sections, createdAt: new Date(),
                });
                setActiveOrgId(ref.id);
            } else if (orgModal.orgId === SSG_ID) {
                await setDoc(doc(db, "organizations", SSG_ID), { ...base, type: 'ssg' }, { merge: true });
            } else {
                // Each term keeps its own chart under termConfigs.<term>
                const update = { ...base, [`termConfigs.${selectedTerm}`]: { sections: payload.sections } };
                if (payload.applyAsDefault) update.sections = payload.sections;
                await updateDoc(doc(db, "organizations", orgModal.orgId), update);
            }
            setOrgModal(null);
        } catch (error) {
            console.error("Error saving organization:", error);
            alert("Error saving organization. Check console for details.");
        } finally {
            setSavingOrg(false);
        }
    }, [orgModal, selectedTerm]);

    const handleDeleteOrg = useCallback(async () => {
        const id = orgModal?.orgId;
        if (!id || id === SSG_ID) return;
        if (!window.confirm("Delete this organization AND all of its members from every term? This cannot be undone.")) return;
        setSavingOrg(true);
        try {
            const snap = await getDocs(query(collection(db, "members"), where("orgId", "==", id)));
            for (let i = 0; i < snap.docs.length; i += 400) {
                const batch = writeBatch(db);
                snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
                await batch.commit();
            }
            await deleteDoc(doc(db, "organizations", id));
            setActiveOrgId(SSG_ID);
            setOrgModal(null);
        } catch (error) {
            console.error("Error deleting organization:", error);
            alert("Error deleting organization. Check console for details.");
        } finally {
            setSavingOrg(false);
        }
    }, [orgModal]);

    const handleAddTerm = useCallback(async () => {
        const label = newTerm.trim();
        if (!isValidTerm(label)) return setTermError('Use consecutive years, e.g. 2027-2028');
        if (allTerms.includes(label)) return setTermError('That term already exists.');
        try {
            await setDoc(doc(db, "terms", label), { label, createdAt: new Date() });
            setTermChoice(label);
            setNewTerm('');
            setTermError('');
            setNewTermOpen(false);
        } catch (error) {
            console.error("Error adding term:", error);
            setTermError('Could not save the term.');
        }
    }, [newTerm, allTerms]);

    const openEditActiveOrg = useCallback(() => setOrgModal({ mode: 'edit', orgId: activeOrg.id }), [activeOrg.id]);
    const modalOrg = orgModal?.mode === 'edit'
        ? (orgModal.orgId === SSG_ID ? ssgOrg : customOrgs.find((o) => o.id === orgModal.orgId))
        : null;

    // ── Position options for the add modal ──
    const ssgSection = addContext?.orgId === SSG_ID ? addContext.sectionKey : null;
    const addTitle = addContext
        ? (addContext.orgId === SSG_ID
            ? (SSG_GROUP_LABELS[ssgSection] || 'General')
            : (addSection?.label || 'Section'))
        : '';

    return (
        <div className={styles.container}>
            <div className={styles.topHeader}>
                <div className={styles.headerLeft}>
                    <h1 className={styles.mainTitle}>Members</h1>
                    <p className={styles.subTitle}>
                        Manage, add, edit, and organize the members of each organization and term.
                    </p>
                </div>

                <div className={styles.headerActions}>
                    <div className={styles.searchWrapper}>
                        <span className={styles.searchIcon}>🔍</span>
                        <input
                            type="text"
                            className={styles.searchInput}
                            placeholder="Search member by name, ID or position..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <button type="button" className={styles.clearSearchBtn} onClick={() => setSearchQuery('')}>✕</button>
                        )}
                    </div>
                </div>
            </div>

            {/* ORGANIZATION TABS */}
            <div className={orgStyles.orgTabs} role="tablist">
                {[ssgOrg, ...customOrgs].map((o) => (
                    <button
                        key={o.id}
                        type="button"
                        role="tab"
                        aria-selected={o.id === activeOrg.id}
                        className={`${orgStyles.orgTab} ${o.id === activeOrg.id ? orgStyles.orgTabActive : ''}`}
                        onClick={() => setActiveOrgId(o.id)}
                    >
                        {o.logo64
                            ? <img src={o.logo64} alt="" className={orgStyles.orgTabLogo} />
                            : <span className={orgStyles.orgTabFallback}>{(o.name || 'O').charAt(0).toUpperCase()}</span>}
                        <span className={orgStyles.orgTabName}>{o.id === SSG_ID ? 'SSG' : o.name}</span>
                    </button>
                ))}
                <button type="button" className={orgStyles.addOrgTab} onClick={() => setOrgModal({ mode: 'create' })}>
                    + Add Organization
                </button>
            </div>

            {/* TERM BAR */}
            <div className={orgStyles.termBar}>
                <label className={orgStyles.termLabel} htmlFor="termSelect">Term</label>
                <select
                    id="termSelect"
                    className={orgStyles.termSelect}
                    value={selectedTerm}
                    onChange={(e) => setTermChoice(e.target.value)}
                >
                    {allTerms.map((t) => (
                        <option key={t} value={t}>{t}{t === currentTerm ? ' (current)' : ''}</option>
                    ))}
                </select>
                <span className={`${orgStyles.termBadge} ${isArchived ? orgStyles.termBadgeArchived : orgStyles.termBadgeCurrent}`}>
                    {isArchived ? 'Archived' : 'Current'}
                </span>

                {newTermOpen ? (
                    <div className={orgStyles.newTermRow}>
                        <input
                            className={orgStyles.newTermInput}
                            placeholder="2027-2028"
                            value={newTerm}
                            onChange={(e) => { setNewTerm(e.target.value); setTermError(''); }}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddTerm()}
                            autoFocus
                        />
                        <button type="button" className={styles.submitBtn} onClick={handleAddTerm}>Add</button>
                        <button type="button" className={styles.cancelBtn} onClick={() => { setNewTermOpen(false); setTermError(''); }}>Cancel</button>
                        {termError && <span className={orgStyles.termError}>{termError}</span>}
                    </div>
                ) : (
                    <button type="button" className={orgStyles.newTermBtn} onClick={() => setNewTermOpen(true)}>+ New Term</button>
                )}
            </div>

            {isArchived && (
                <div className={orgStyles.archivedNotice}>
                    You're viewing the {selectedTerm} term. Members here can still be added, edited, and deleted, and each term keeps its own hierarchy chart.
                </div>
            )}

            {/* ADD MEMBER MODAL */}
            {addContext && (
                <div className={styles.modalOverlay} onClick={closeAdd}>
                    <div className={styles.modalContainer} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <div className={styles.modalHeaderTitle}>
                                <span className={styles.modalHeaderBadge}>+</span>
                                <h3>Add Member — {addTitle}{addContext.orgId !== SSG_ID && addOrg ? ` · ${addOrg.name}` : ''}</h3>
                            </div>
                            <button type="button" className={styles.modalCloseBtn} onClick={closeAdd}>✕</button>
                        </div>

                        <form onSubmit={handleSubmit} className={styles.modalForm}>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label>Full Name *</label>
                                    <input type="text" name="name" placeholder="e.g. MEGA REYNES A. PEREZ"
                                        value={member.name} onChange={handleChange} required />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Student / Official ID *</label>
                                    <input type="text" name="id" placeholder="e.g. S001"
                                        value={member.id} onChange={handleChange} required />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Position *</label>
                                    {addContext.orgId === SSG_ID ? (
                                        <select name="position" value={member.position} onChange={handleChange} required>
                                            <option value="" disabled>Select Position</option>
                                            {/* section-specific group first, then everything else */}
                                            {[ssgSection, ...Object.keys(SSG_POSITIONS).filter((k) => k !== ssgSection)]
                                                .filter((k) => SSG_POSITIONS[k])
                                                .map((k, i) => (
                                                    <optgroup key={k} label={i === 0 && ssgSection ? `Recommended: ${SSG_GROUP_LABELS[k]}` : SSG_GROUP_LABELS[k]}>
                                                        {SSG_POSITIONS[k].map((p) => <option key={p} value={p}>{p}</option>)}
                                                    </optgroup>
                                                ))}
                                        </select>
                                    ) : (
                                        <>
                                            <input
                                                type="text" name="position" list="orgPositionList"
                                                placeholder="Pick or type a position"
                                                value={member.position} onChange={handleChange} required
                                            />
                                            <datalist id="orgPositionList">
                                                {(addSection?.positions || []).map((p) => <option key={p.title} value={p.title} />)}
                                            </datalist>
                                        </>
                                    )}
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Term</label>
                                    <select name="term" value={member.term || selectedTerm} onChange={handleChange}>
                                        {allTerms.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Department / Address</label>
                                    <input type="text" name="address" placeholder="e.g. College of Technology"
                                        value={member.address} onChange={handleChange} />
                                </div>
                            </div>

                            <div className={styles.formGroupFull}>
                                <label>Biography / Description</label>
                                <textarea name="description" rows="3"
                                    placeholder="Describe achievements, role notes, or biography..."
                                    value={member.description} onChange={handleChange} />
                            </div>

                            <div className={styles.socialLinkSection}>
                                <label>Social Media Channel</label>
                                <div className={styles.socialInputRow}>
                                    <select value={selectedPlatform} onChange={(e) => setSelectedPlatform(e.target.value)} className={styles.platformSelect}>
                                        <option value="facebookLink">Facebook</option>
                                        <option value="instagramLink">Instagram</option>
                                        <option value="twitterLink">Twitter / X</option>
                                    </select>
                                    <input
                                        type="url"
                                        placeholder={`Paste ${selectedPlatform.replace('Link', '')} profile URL...`}
                                        value={member[selectedPlatform] ?? ""}
                                        onChange={handleLinkChange}
                                        className={styles.platformInput}
                                    />
                                </div>
                            </div>

                            <div className={styles.photoUploadSection}>
                                <label>Profile Picture</label>
                                <div className={styles.photoUploadRow}>
                                    <input type="file" accept="image/*" onChange={handlePhotoChange}
                                        id="memberPhotoInput" className={styles.fileInputHidden} />
                                    <label htmlFor="memberPhotoInput" className={styles.customUploadBtn}>📷 Upload Photo</label>
                                    {preview && (
                                        <div className={styles.previewContainer}>
                                            <img src={preview} alt="Preview" className={styles.previewImg} />
                                            <span className={styles.previewText}>Photo Loaded</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className={styles.modalFooter}>
                                <button type="button" className={styles.cancelBtn} onClick={closeAdd}>Cancel</button>
                                <button type="submit" className={styles.submitBtn}>Save Member</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ORGANIZATION MODAL (create / edit) */}
            {orgModal && (
                <OrganizationModal
                    key={`${orgModal.mode}-${orgModal.orgId || 'new'}-${selectedTerm}`}
                    mode={orgModal.mode}
                    org={modalOrg}
                    term={selectedTerm}
                    saving={savingOrg}
                    onClose={() => setOrgModal(null)}
                    onSave={handleSaveOrg}
                    onDelete={handleDeleteOrg}
                />
            )}

            {/* CHART */}
            <div className={styles.memberListWrapper}>
                {activeIsSSG ? (
                    <Memberslist
                        members={orgMembers}
                        setMembers={setMembers}
                        searchQuery={searchQuery}
                        onOpenAddModal={handleOpenSsgAdd}
                        org={ssgOrg}
                        term={selectedTerm}
                        terms={allTerms}
                        isArchived={isArchived}
                        onEditOrg={openEditActiveOrg}
                    />
                ) : (
                    <OrganizationView
                        key={`${activeOrg.id}-${selectedTerm}`}
                        org={activeOrg}
                        members={orgMembers}
                        setMembers={setMembers}
                        searchQuery={searchQuery}
                        term={selectedTerm}
                        terms={allTerms}
                        isArchived={isArchived}
                        onOpenAddModal={handleOpenOrgAdd}
                        onEditOrg={openEditActiveOrg}
                    />
                )}
            </div>
        </div>
    );
}

export default MemberDashboard;
