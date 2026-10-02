import React, { useState, useMemo, memo, useCallback } from "react";
import styles from "./memberlist.module.css";
import { db } from "../firebase/firebaseConfig";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";

// ─── TOP-LEVEL: defined OUTSIDE Memberlist so React.memo works correctly ───
// If this is defined inside the component body, React sees a new component
// type every render, unmounting + remounting every card (memo has no effect).
const MemberCard = memo(({ member, variant = "default", crown = false, onEdit, onDelete }) => (
  <div className={`${styles.memberCard} ${styles[`card_${variant}`] || ''}`}>
    <div className={styles.avatarWrapper}>
      {member.image64 ? (
        <img
          src={member.image64}
          alt={member.name}
          className={styles.memberAvatar}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className={styles.avatarPlaceholder}>
          {member.name ? member.name.charAt(0).toUpperCase() : "M"}
        </div>
      )}
      {crown && (
        <span className={styles.crownBadge} title="Head">👑</span>
      )}
    </div>

    <div className={styles.cardInfo}>
      <div className={styles.positionBadge}>
        {member.position || "Member"}
      </div>
      <h4 className={styles.memberName}>{member.name}</h4>
      <div className={styles.memberIdRow}>
        <span>ID: {member.id || "N/A"}</span>
      </div>
    </div>

    <div className={styles.cardActions}>
      <button
        type="button"
        className={styles.editBtn}
        onClick={() => onEdit(member)}
        title="Edit Member"
      >
        ✏️ Edit
      </button>
      <button
        type="button"
        className={styles.deleteBtn}
        onClick={() => onDelete(member.docId)}
        title="Delete Member"
      >
        🗑️ Delete
      </button>
    </div>
  </div>
));

MemberCard.displayName = 'MemberCard';

export default function Memberlist({ members = [], setMembers, searchQuery = "", onOpenAddModal }) {
  const [editingMember, setEditingMember] = useState(null);
  const [editedMember, setEditedMember] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState({});

  // Memoized — stable object reference, no allocation on every render
  const memberLimits = useMemo(() => ({
    advisory: 3,
    executive: 4,
    representatives: 12,
    cabinet: 8,
    creatives: 10,
    senators: 6,
    legislativeOfficers: 3
  }), []);

  const toggleSection = (sectionKey) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  // Open Modal for Editing
  const handleEditClick = useCallback((member) => {
    setEditingMember(member.docId);
    setEditedMember({ ...member });
    setShowModal(true);
  }, []);

  // Handle edit changes
  const handleEditChange = useCallback((e) => {
    const { name, value } = e.target;
    setEditedMember((prev) => ({ ...prev, [name]: value }));
  }, []);

  // Save to Firestore — uses functional updater so `members` is NOT a dep,
  // preventing this callback from being recreated on every Firestore push.
  const handleSave = useCallback(async () => {
    if (!editingMember) return;

    try {
      const memberRef = doc(db, "members", editingMember);

      const updateData = {
        name: editedMember.name || "",
        id: editedMember.id || "",
        address: editedMember.address || "",
        position: editedMember.position || "",
        description: editedMember.description || "",
        facebookLink: editedMember.facebookLink || "",
        instagramLink: editedMember.instagramLink || "",
        twitterLink: editedMember.twitterLink || "",
        term: editedMember.term || "2024-2025",
        status: editedMember.status || "Active",
      };

      await updateDoc(memberRef, updateData);

      // Functional updater: reads latest state from React, no stale closure
      setMembers((prev) => prev.map((m) =>
        m.docId === editingMember ? { ...m, ...updateData } : m
      ));
      setShowModal(false);
      setEditingMember(null);
      setEditedMember({});
    } catch (error) {
      console.error("Error updating member:", error);
      alert("Error updating member. Please check the console.");
    }
  }, [editingMember, editedMember, setMembers]);

  const closeModal = useCallback(() => {
    setShowModal(false);
    setEditingMember(null);
    setEditedMember({});
  }, []);

  const handleDelete = useCallback(async (docIdToDelete) => {
    if (!docIdToDelete) return;

    if (window.confirm("Are you sure you want to delete this member?")) {
      try {
        await deleteDoc(doc(db, "members", docIdToDelete));
        // Functional updater: no dependency on `members` array
        setMembers((prev) => prev.filter((m) => m.docId !== docIdToDelete));
      } catch (error) {
        console.error("Error deleting member:", error);
        alert("Error deleting member. Please check the console.");
      }
    }
  }, [setMembers]);

  // Filter members based on search query - Memoized for performance
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const q = searchQuery.toLowerCase();
    return members.filter((m) => (
      (m.name && m.name.toLowerCase().includes(q)) ||
      (m.id && m.id.toLowerCase().includes(q)) ||
      (m.position && m.position.toLowerCase().includes(q))
    ));
  }, [members, searchQuery]);

  // Categorize members - Memoized to prevent recalculation
  const categorizedMembers = useMemo(() => {
    const executivePresident = filteredMembers.filter(
      (m) => m.position && m.position.toLowerCase() === "president"
    );

    const executiveVicePresidents = filteredMembers.filter(
      (m) => m.position && m.position.toLowerCase().includes("vice president")
    );

    const executiveGovernors = filteredMembers.filter(
      (m) =>
        m.position &&
        m.position.toLowerCase().includes("governor")
    );

    const legislativeSenators = filteredMembers.filter(
      (m) => m.position && m.position.toLowerCase().includes("senator")
    );

    const legislativeOfficers = filteredMembers.filter(
      (m) =>
        m.position &&
        (m.position.toLowerCase() === "treasurer" ||
          m.position.toLowerCase() === "auditor")
    );

    const representatives = filteredMembers.filter(
      (m) =>
        m.position &&
        m.position.toLowerCase().includes("representative")
    );

    const creativesMultimediaDirector = filteredMembers.filter(
      (m) => m.position && m.position.toLowerCase().includes("multimedia director")
    );

    const creativesEventDirector = filteredMembers.filter(
      (m) => m.position && m.position.toLowerCase().includes("event director")
    );

    const creativesUnderMultimedia = filteredMembers.filter(
      (m) =>
        m.position &&
        (m.position.toLowerCase().includes("multimedia staff") ||
          m.position.toLowerCase().includes("graphic") ||
          m.position.toLowerCase().includes("social media"))
    );

    const creativesActivityOfficers = filteredMembers.filter(
      (m) => m.position && m.position.toLowerCase().includes("activity officer")
    );

    const cabinet = filteredMembers.filter(
      (m) =>
        m.position &&
        (m.position.toLowerCase().includes("administrative") ||
          m.position.toLowerCase().includes("finance") ||
          m.position.toLowerCase().includes("planning") ||
          m.position.toLowerCase().includes("public relations") ||
          m.position.toLowerCase().includes("information") ||
          m.position.toLowerCase().includes("communications") ||
          m.position.toLowerCase() === "secretary" ||
          m.position.toLowerCase().includes("executive secretary") ||
          m.position.toLowerCase().includes("press secretary") ||
          m.position.toLowerCase().includes("secretary on"))
    );

    const creatives = filteredMembers.filter(
      (m) =>
        m.position &&
        (m.position.toLowerCase().includes("graphic") ||
          m.position.toLowerCase().includes("multimedia") ||
          m.position.toLowerCase().includes("content") ||
          m.position.toLowerCase().includes("creative") ||
          m.position.toLowerCase().includes("design") ||
          m.position.toLowerCase().includes("event director") ||
          m.position.toLowerCase().includes("activity officer"))
    );

    const advisory = filteredMembers.filter(
      (m) =>
        m.position &&
        (m.position.toLowerCase().includes("ssg adviser") ||
          m.position.toLowerCase().includes("assistant ssg adviser"))
    );

    const categorizedIds = new Set([
      ...advisory,
      ...executivePresident,
      ...executiveVicePresidents,
      ...executiveGovernors,
      ...legislativeSenators,
      ...legislativeOfficers,
      ...representatives,
      ...cabinet,
      ...creatives,
      ...creativesMultimediaDirector,
      ...creativesEventDirector,
      ...creativesUnderMultimedia,
      ...creativesActivityOfficers,
    ].map((m) => m.docId));

    const generalMembers = filteredMembers.filter((m) => !categorizedIds.has(m.docId));

    return {
      executivePresident,
      executiveVicePresidents,
      executiveGovernors,
      legislativeSenators,
      legislativeOfficers,
      representatives,
      creativesMultimediaDirector,
      creativesEventDirector,
      creativesUnderMultimedia,
      creativesActivityOfficers,
      cabinet,
      creatives,
      advisory,
      generalMembers
    };
  }, [filteredMembers]);

  // renderCard — thin helper that passes stable callbacks as props so
  // MemberCard (defined at module scope above) can memo-compare them correctly.
  const renderCard = useCallback((member, variant = "default", crown = false) => (
    <MemberCard
      key={member.docId}
      member={member}
      variant={variant}
      crown={crown}
      onEdit={handleEditClick}
      onDelete={handleDelete}
    />
  ), [handleEditClick, handleDelete]);

  return (
    <div className={styles.container}>
      {/* ── SUPREME STUDENT GOVERNMENT TITLE ── */}
      <div className={styles.ssgTitleWrapper}>
        <h1 className={styles.ssgMainTitle}>Supreme Student Government</h1>
        <p className={styles.ssgTerm}>Term: 2024-2025</p>
      </div>

      {/* ── SECTION 1: ADVISORY ── */}
      <div className={`${styles.branchSection} ${styles.advisoryBranch}`}>
        <div className={styles.sectionHeader}>
          <div className={styles.headerTitleGroup}>
            <div className={`${styles.branchIconWrapper} ${styles.iconAdvisory}`}>
              🎓
            </div>

            <div>
              <h2 className={styles.branchTitle}>ADVISORY</h2>
              <p className={styles.branchSubtitle}>
                Guides. Advises. Supports.
              </p>
            </div>
          </div>

          <div className={styles.headerActions}>
            <span className={styles.memberLimitIndicator}>
              {categorizedMembers.advisory.length}/{memberLimits.advisory}
            </span>
            <button 
              className={`${styles.addSectionBtn} ${categorizedMembers.advisory.length >= memberLimits.advisory ? styles.addBtnDisabled : ''}`}
              onClick={() => onOpenAddModal && onOpenAddModal('advisory')}
              disabled={categorizedMembers.advisory.length >= memberLimits.advisory}
              title={categorizedMembers.advisory.length >= memberLimits.advisory ? 'Member limit reached' : 'Add Advisory Member'}
            >
              <span className={styles.addBtnIcon}>+</span>
              Add Advisor
            </button>
          </div>
        </div>

        <div className={styles.cardsGridThree}>
          {categorizedMembers.advisory.length > 0 ? (
            categorizedMembers.advisory.map((m) => renderCard(m, "advisory"))
          ) : (
            <p className={styles.emptyBranchNotice}>
              No Advisory members added yet.
            </p>
          )}
        </div>
      </div>

      {/* ── SECTION 2: EXECUTIVE BRANCH ── */}
      <div className={`${styles.branchSection} ${styles.executiveBranch}`}>
        <div className={styles.sectionHeader}>
          <div className={styles.headerTitleGroup}>
            <div className={`${styles.branchIconWrapper} ${styles.iconExecutive}`}>
              👤
            </div>
            <div>
              <h2 className={styles.branchTitle}>EXECUTIVE</h2>
              <p className={styles.branchSubtitle}>Leads. Plans. Executes.</p>
            </div>
          </div>
          
          <div className={styles.headerActions}>
            <span className={styles.memberLimitIndicator}>
              {[...categorizedMembers.executivePresident, ...categorizedMembers.executiveVicePresidents, ...categorizedMembers.executiveGovernors].length}/{memberLimits.executive}
            </span>
            <button 
              className={`${styles.addSectionBtn} ${[...categorizedMembers.executivePresident, ...categorizedMembers.executiveVicePresidents, ...categorizedMembers.executiveGovernors].length >= memberLimits.executive ? styles.addBtnDisabled : ''}`}
              onClick={() => onOpenAddModal && onOpenAddModal('executive')}
              disabled={[...categorizedMembers.executivePresident, ...categorizedMembers.executiveVicePresidents, ...categorizedMembers.executiveGovernors].length >= memberLimits.executive}
              title={[...categorizedMembers.executivePresident, ...categorizedMembers.executiveVicePresidents, ...categorizedMembers.executiveGovernors].length >= memberLimits.executive ? 'Member limit reached' : 'Add Executive Member'}
            >
              <span className={styles.addBtnIcon}>+</span>
              Add Executive
            </button>
          </div>
        </div>

        <div className={styles.executiveTree}>
          {/* President level */}
          <div className={styles.treeTopLevel}>
            {categorizedMembers.executivePresident.length > 0 ? (
              categorizedMembers.executivePresident.map((m) => renderCard(m, "executiveLeader", true))
            ) : (
              <div className={styles.emptySlotNotice}>No President assigned yet</div>
            )}
          </div>

          {/* Tree branching connector line */}
          <div className={styles.treeConnectingLines}>
            <div className={styles.verticalStem}></div>
            <div className={styles.horizontalBar}></div>
          </div>

          {/* Vice Presidents & Governors level — always shown side by side */}
          <div className={styles.treeSecondLevel}>
            {(categorizedMembers.executiveVicePresidents.length > 0 || categorizedMembers.executiveGovernors.length > 0) ? (
              [
                ...categorizedMembers.executiveVicePresidents.map((m) => renderCard(m, "executiveSub")),
                ...categorizedMembers.executiveGovernors.map((m) => renderCard(m, "executiveSub")),
              ]
            ) : (
              <div className={styles.emptySlotNotice}>No Vice President or Governor assigned yet</div>
            )}
          </div>
        </div>
      </div>

      {/* ── SECTION 2: LEGISLATIVE BRANCH ── */}
      <div className={`${styles.branchSection} ${styles.legislativeBranch}`}>
        <div className={styles.sectionHeader}>
          <div className={styles.headerTitleGroup}>
            <div className={`${styles.branchIconWrapper} ${styles.iconLegislative}`}>
              🏛️
            </div>
            <div>
              <h2 className={styles.branchTitle}>LEGISLATIVE</h2>
              <p className={styles.branchSubtitle}>Promotes. Proposes. Serves.</p>
            </div>
          </div>
          <span className={styles.branchTag}>Legislative Branch</span>
        </div>


        {/* Key Officers row (Secretary, Treasurer, Auditor) */}
        {categorizedMembers.legislativeOfficers.length > 0 && (
          <div className={styles.cardsRowThree}>
            {categorizedMembers.legislativeOfficers.map((m) => renderCard(m, "legislativeOfficer"))}
          </div>
        )}

        {/* Representatives Subsection */}
        <div className={styles.subSectionBox}>
          <div
            className={styles.subSectionHeader}
            onClick={() => toggleSection('representatives')}
          >
            <div className={styles.subHeaderTitle}>
              <span className={styles.subHeaderIcon}>👥</span>
              <h3>HOUSE OF REPRESENTATIVES</h3>
            </div>
            <div className={styles.subHeaderRight}>
              <span className={styles.memberLimitIndicator}>
                {categorizedMembers.representatives.length}/{memberLimits.representatives}
              </span>
              <button 
                className={`${styles.addSectionBtn} ${styles.addSubSectionBtn} ${categorizedMembers.representatives.length >= memberLimits.representatives ? styles.addBtnDisabled : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAddModal && onOpenAddModal('representatives');
                }}
                disabled={categorizedMembers.representatives.length >= memberLimits.representatives}
                title={categorizedMembers.representatives.length >= memberLimits.representatives ? 'Member limit reached' : 'Add Representative'}
              >
                <span className={styles.addBtnIcon}>+</span>
                Add Rep
              </button>
              <span className={styles.collapseToggle}>
                {collapsedSections['representatives'] ? '⌄' : '⌃'}
              </span>
            </div>
          </div>

          {!collapsedSections['representatives'] && (
            <div className={styles.cardsGridFour}>
              {categorizedMembers.representatives.length > 0 ? (
                categorizedMembers.representatives.map((m) => renderCard(m, "representative"))
              ) : (
                <p className={styles.emptyBranchNotice}>No Representatives added yet.</p>
              )}
            </div>
          )}
        </div>
        {/* Senators row */}
        <div className={`${styles.subSectionBox} ${styles.senateSubSection}`}>
          <div
            className={styles.subSectionHeader}
            onClick={() => toggleSection('senators')}
          >
            <div className={styles.subHeaderTitle}>
              <span className={styles.subHeaderIcon}>⚖️</span>
              <h3>THE SENATE</h3>
            </div>
            <div className={styles.subHeaderRight}>
              <span className={styles.memberLimitIndicator}>
                {categorizedMembers.legislativeSenators.length}/{memberLimits.senators}
              </span>
              <button 
                className={`${styles.addSectionBtn} ${styles.addSubSectionBtn} ${categorizedMembers.legislativeSenators.length >= memberLimits.senators ? styles.addBtnDisabled : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenAddModal && onOpenAddModal('senators');
                }}
                disabled={categorizedMembers.legislativeSenators.length >= memberLimits.senators}
                title={categorizedMembers.legislativeSenators.length >= memberLimits.senators ? 'Member limit reached' : 'Add Senator'}
              >
                <span className={styles.addBtnIcon}>+</span>
                Add Senator
              </button>
              <span className={styles.collapseToggle}>
                {collapsedSections['senators'] ? '⌄' : '⌃'}
              </span>
            </div>
          </div>

          {!collapsedSections['senators'] && (
            <div className={styles.cardsGridFour}>
              {categorizedMembers.legislativeSenators.length > 0 ? (
                categorizedMembers.legislativeSenators.map((m) => renderCard(m, "senator"))
              ) : (
                <p className={styles.emptyBranchNotice}>No Senators added yet.</p>
              )}
            </div>
          )}
        </div>


      </div>

      {/* ── SECTION 3: EXECUTIVE CABINET ── */}
      <div className={`${styles.branchSection} ${styles.cabinetBranch}`}>
        <div className={styles.sectionHeader}>
          <div className={styles.headerTitleGroup}>
            <div className={`${styles.branchIconWrapper} ${styles.iconCabinet}`}>
              💼
            </div>
            <div>
              <h2 className={styles.branchTitle}>EXECUTIVE CABINET</h2>
              <p className={styles.branchSubtitle}>Manages operations. Builds programs. Creates impact.</p>
            </div>
          </div>
          
          <div className={styles.headerActions}>
            <span className={styles.memberLimitIndicator}>
              {categorizedMembers.cabinet.length}/{memberLimits.cabinet}
            </span>
            <button 
              className={`${styles.addSectionBtn} ${categorizedMembers.cabinet.length >= memberLimits.cabinet ? styles.addBtnDisabled : ''}`}
              onClick={() => onOpenAddModal && onOpenAddModal('cabinet')}
              disabled={categorizedMembers.cabinet.length >= memberLimits.cabinet}
              title={categorizedMembers.cabinet.length >= memberLimits.cabinet ? 'Member limit reached' : 'Add Cabinet Member'}
            >
              <span className={styles.addBtnIcon}>+</span>
              Add Cabinet
            </button>
          </div>
        </div>

        <div className={styles.cardsGridFive}>
          {categorizedMembers.cabinet.length > 0 ? (
            categorizedMembers.cabinet.map((m) => renderCard(m, "cabinet"))
          ) : (
            <p className={styles.emptyBranchNotice}>No Executive Cabinet members added yet.</p>
          )}
        </div>
      </div>

      {/* ── SECTION 4: DEPARTMENT OF CREATIVES ── */}
      <div className={`${styles.branchSection} ${styles.creativesBranch}`}>
        <div className={styles.sectionHeader}>
          <div className={styles.headerTitleGroup}>
            <div className={`${styles.branchIconWrapper} ${styles.iconCreatives}`}>
              🎨
            </div>
            <div>
              <h2 className={styles.branchTitle}>DEPARTMENT OF CREATIVES</h2>
              <p className={styles.branchSubtitle}>Designs. Creates. Inspires.</p>
            </div>
          </div>
          
          <div className={styles.headerActions}>
            <span className={styles.memberLimitIndicator}>
              {categorizedMembers.creatives.length}/{memberLimits.creatives}
            </span>
            <button 
              className={`${styles.addSectionBtn} ${categorizedMembers.creatives.length >= memberLimits.creatives ? styles.addBtnDisabled : ''}`}
              onClick={() => onOpenAddModal && onOpenAddModal('creatives')}
              disabled={categorizedMembers.creatives.length >= memberLimits.creatives}
              title={categorizedMembers.creatives.length >= memberLimits.creatives ? 'Member limit reached' : 'Add Creative Member'}
            >
              <span className={styles.addBtnIcon}>+</span>
              Add Creative
            </button>
          </div>
        </div>


        {/* ── CREATIVES TREE: two parallel hierarchies ── */}
        <div className={styles.creativesTree}>

          {/* ── LEFT: Multimedia Director ── */}
          <div className={styles.creativesSubtree}>
            <div className={styles.treeTopLevel}>
              {categorizedMembers.creativesMultimediaDirector.length > 0 ? (
                categorizedMembers.creativesMultimediaDirector.map((m) =>
                  renderCard(m, "creativesDirector", true)
                )
              ) : (
                <div className={styles.emptySlotNotice}>No Multimedia Director yet</div>
              )}
            </div>

            <div className={styles.treeConnectingLines}>
              <div className={styles.verticalStem}></div>
              <div className={styles.horizontalBar}></div>
            </div>

            <div className={styles.treeSecondLevel}>
              {categorizedMembers.creativesUnderMultimedia.length > 0 ? (
                categorizedMembers.creativesUnderMultimedia.map((m) => renderCard(m, "creatives"))
              ) : (
                <div className={styles.emptySlotNotice}>No staff assigned yet</div>
              )}
            </div>
          </div>

          {/* ── RIGHT: Event Director ── */}
          <div className={styles.creativesSubtree}>
            <div className={styles.treeTopLevel}>
              {categorizedMembers.creativesEventDirector.length > 0 ? (
                categorizedMembers.creativesEventDirector.map((m) =>
                  renderCard(m, "creativesDirector", true)
                )
              ) : (
                <div className={styles.emptySlotNotice}>No Event Director yet</div>
              )}
            </div>

            <div className={styles.treeConnectingLines}>
              <div className={styles.verticalStem}></div>
              <div className={styles.horizontalBar}></div>
            </div>

            <div className={styles.treeSecondLevel}>
              {categorizedMembers.creativesActivityOfficers.length > 0 ? (
                categorizedMembers.creativesActivityOfficers.map((m) => renderCard(m, "creatives"))
              ) : (
                <div className={styles.emptySlotNotice}>No Activity Officers yet</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── SECTION 5: GENERAL / OTHER MEMBERS (If any) ── */}
      {categorizedMembers.generalMembers.length > 0 && (
        <div className={`${styles.branchSection} ${styles.generalBranch}`}>
          <div className={styles.sectionHeader}>
            <div className={styles.headerTitleGroup}>
              <div className={`${styles.branchIconWrapper} ${styles.iconGeneral}`}>
                ⭐
              </div>
              <div>
                <h2 className={styles.branchTitle}>GENERAL MEMBERS</h2>
                <p className={styles.branchSubtitle}>Active organization team members and officers.</p>
              </div>
            </div>
            <span className={styles.branchTag}>{categorizedMembers.generalMembers.length} Members</span>
          </div>

          <div className={styles.cardsGridFour}>
            {categorizedMembers.generalMembers.map((m) => renderCard(m, "general"))}
          </div>
        </div>
      )}

      {/* Edit Member Modal */}
      {showModal && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Edit Member: {editedMember.name}</h3>
              <button className={styles.closeButton} onClick={closeModal}>×</button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.editForm}>
                <div className={styles.formGroup}>
                  <label>Name:</label>
                  <input
                    type="text"
                    name="name"
                    value={editedMember.name || ""}
                    onChange={handleEditChange}
                    placeholder="Enter member name"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>ID:</label>
                  <input
                    type="text"
                    name="id"
                    value={editedMember.id || ""}
                    onChange={handleEditChange}
                    placeholder="Enter member ID"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Address / Dept:</label>
                  <input
                    type="text"
                    name="address"
                    value={editedMember.address || ""}
                    onChange={handleEditChange}
                    placeholder="Enter address"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Position:</label>
                  <select
                    name="position"
                    value={editedMember.position || ""}
                    onChange={handleEditChange}
                  >
                    <option value="">Select Position</option>
                    {/* ── Executive Branch ── */}
                    <optgroup label="Advisory">
                      <option value="SSG Adviser">SSG Adviser</option>
                      <option value="SSG Assistant Adviser">SSG Assistant Adviser</option>
                    </optgroup>
                    <optgroup label="Executive Branch">
                      <option value="President">President</option>
                      <option value="Vice President">Vice President</option>
                      <option value="COTE Governor">COTE Governor</option>
                      <option value="COED Governor">COED Governor</option>
                    </optgroup>
                    {/* ── Legislative Branch ── */}
                    <optgroup label="Legislative Branch">
                      <option value="Senator">Senator</option>
                    </optgroup>
                    {/* ── Representatives ── */}
                    <optgroup label="House of Representatives Representatives">
                      <option value="Representative">Representative</option>
                      <option value="BSHM Representative">BSHM Representative</option>
                      <option value="BSIT Representative">BSIT Representative</option>
                      <option value="BSFI Representative">BSFI Representative</option>
                      <option value="BEED MATH Representative">BEED MATH Representative</option>
                      <option value="BSED Representative">BSED Representative</option>
                      <option value="BIT Representative">BIT Representative</option>
                      <option value="BSIE Representative">BSIE Representative</option>
                      <option value="BTLED Representative">BTLED Representative</option>
                    </optgroup>
                    {/* ── Executive Cabinet ── */}
                    <optgroup label="Executive Cabinet">
                      <option value="Secretary">Secretary</option>
                      <option value="Executive Secretary">Executive Secretary</option>
                      <option value="Press Secretary">Press Secretary</option>
                      <option value="Secretary on Linkages">Secretary on Linkages</option>
                      <option value="Secretary on Finance">Secretary on Finance</option>
                      <option value="Secretary on Audit">Secretary on Audit</option>
                      <option value="Administrative">Administrative</option>
                    </optgroup>
                    {/* ── Creatives Department ── */}
                    <optgroup label="Department of Creatives">
                      <option value="Multimedia Director">Multimedia Director</option>
                      <option value="Event Director">Event Director</option>
                      <option value="Social Media Manager">Social Media Manager</option>
                      <option value="Activity Officer">Activity Officer</option>
                      <option value="Graphic Artist">Graphic Design</option>
                      <option value="Multimedia Staff">Multimedia</option>
                    </optgroup>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label>Term:</label>
                  <select
                    name="term"
                    value={editedMember.term || "2024-2025"}
                    onChange={handleEditChange}
                  >
                    <option value="2024-2025">2024-2025</option>
                    <option value="2025-2026">2025-2026</option>
                    <option value="2026-2027">2026-2027</option>
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label>Description:</label>
                  <textarea
                    name="description"
                    value={editedMember.description || ""}
                    onChange={handleEditChange}
                    rows="3"
                    placeholder="Enter member description"
                  />
                </div>
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.cancelButton} onClick={closeModal}>
                Cancel
              </button>
              <button className={styles.saveButton} onClick={handleSave}>
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}