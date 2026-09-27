import styles from './memberdashboard.module.css';
import React, { useState, useEffect } from 'react';
import Memberslist from './Memberlist';
import { db } from "../firebase/firebaseConfig";
import { collection, addDoc, onSnapshot } from "firebase/firestore";

function MemberDashboard() {
    const [member, setMember] = useState({
        name: "",
        id: "",
        address: "",
        position: "",
        image64: "", // Base64 string
        description: "",
        facebookLink: "",
        instagramLink: "",
        twitterLink: "",
    });

    const [selectedPlatform, setSelectedPlatform] = useState('facebookLink');
    const [preview, setPreview] = useState(null);
    const [members, setMembers] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);

    // Load Firestore members dynamically
    useEffect(() => {
        const unsubscribe = onSnapshot(collection(db, "members"), (snapshot) => {
            const membersData = snapshot.docs.map((doc) => ({
                docId: doc.id,
                ...doc.data(),
            }));
            setMembers(membersData);
        });
        return () => unsubscribe();
    }, []);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setMember((prev) => ({ ...prev, [name]: value }));
    };

    const CompressImage = (file) => {
        const maxWidth = 1000;
        const quality = 0.8;

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                    resolve(compressedBase64);
                };
                img.onerror = reject;
                img.src = event.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    const handlePhotoChange = async (e) => {
        const file = e.target.files[0];
        if (!file) {
            setMember(prev => ({ ...prev, image64: "" }));
            setPreview(null);
            return;
        }

        if (!file.type.startsWith('image/')) {
            alert('Please select an image file.');
            return;
        }

        try {
            const compressedBase64 = await CompressImage(file);
            setMember((prev) => ({
                ...prev,
                image64: compressedBase64
            }));
            setPreview(compressedBase64);
        } catch (error) {
            console.error("Error processing image:", error);
            alert("Failed to process image. Please try another file.");
            setMember(prev => ({ ...prev, image64: "" }));
            setPreview(null);
        }
    };

    const getCurrentLinkValue = () => {
        return member[selectedPlatform] ?? "";
    };

    const handleLinkChange = (e) => {
        const newLink = e.target.value;
        setMember(prevMember => ({
            ...prevMember,
            [selectedPlatform]: newLink,
        }));
    };

    const handlePlatformChange = (e) => {
        setSelectedPlatform(e.target.value);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

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
            status: "Active",
            createdAt: new Date(),
        };

        try {
            await addDoc(collection(db, "members"), dataToSave);
            setMember({
                name: "",
                id: "",
                address: "",
                position: "",
                image64: "",
                description: "",
                facebookLink: "",
                instagramLink: "",
                twitterLink: "",
            });
            setPreview(null);
            setIsAddModalOpen(false);
        } catch (error) {
            console.error("Error adding member:", error);
            alert("Error adding member. Check console for details.");
        }
    };

    return (
        <div className={styles.container}>
            {/* Top Header Bar matching reference */}
            <div className={styles.topHeader}>
                <div className={styles.headerLeft}>
                    <h1 className={styles.mainTitle}>Members</h1>
                    <p className={styles.subTitle}>
                        Manage, add, edit, and organize the members of each organization.
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
                            <button
                                type="button"
                                className={styles.clearSearchBtn}
                                onClick={() => setSearchQuery('')}
                            >
                                ✕
                            </button>
                        )}
                    </div>

                    <button
                        type="button"
                        className={styles.addMemberBtn}
                        onClick={() => setIsAddModalOpen(true)}
                    >
                        <span className={styles.addPlusIcon}>+</span> Add Member
                    </button>
                </div>
            </div>

            {/* ADD MEMBER MODAL */}
            {isAddModalOpen && (
                <div className={styles.modalOverlay} onClick={() => setIsAddModalOpen(false)}>
                    <div className={styles.modalContainer} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                            <div className={styles.modalHeaderTitle}>
                                <span className={styles.modalHeaderBadge}>+</span>
                                <h3>Add New Member</h3>
                            </div>
                            <button
                                type="button"
                                className={styles.modalCloseBtn}
                                onClick={() => setIsAddModalOpen(false)}
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className={styles.modalForm}>
                            <div className={styles.formGrid}>
                                <div className={styles.formGroup}>
                                    <label>Full Name *</label>
                                    <input
                                        type="text"
                                        name="name"
                                        placeholder="e.g. MEGA REYNES A. PEREZ"
                                        value={member.name ?? ""}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Student / Official ID *</label>
                                    <input
                                        type="text"
                                        name="id"
                                        placeholder="e.g. S001"
                                        value={member.id ?? ""}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label>Position *</label>
                                    <select
                                        name="position"
                                        value={member.position ?? ""}
                                        onChange={handleChange}
                                        required
                                    >
                                        <option value="" disabled>Select Position</option>
                                        { /* Advisory */}
                                        <optgroup label="Advisory">
                                            <option value="SSG Adviser">SSG Adviser</option>
                                            <option value=" Assistant SSG Adviser">Assistant SSG Adviser</option>
                                        </optgroup>
                                        {/* ── Executive Branch ── */}
                                        <optgroup label="Executive Branch">
                                            <option value="President">President</option>
                                            <option value="Vice President">Vice President</option>
                                            <option value="COTE Governor">COTE Governor</option>
                                            <option value="COED Governor">COED Governor</option>
                                        </optgroup>
                                        {/* ── Legislative Branch ── */}
                                        <optgroup label="Legislative Branch">
                                            <option value="Speaker">Speaker</option>
                                            <option value="Treasurer">Treasurer</option>
                                            <option value="Auditor">Auditor</option>
                                        </optgroup>
                                        {/* ── Representatives ── */}
                                        <optgroup label="Representatives">
                                            <option value="Representative">Representative</option>
                                            <option value="BSHM Representative">BSHM Representative</option>
                                            <option value="BSIT Representative">BSIT Representative</option>
                                            <option value="BSFI Representative">BSFI Representative</option>
                                            <option value="BEED MATH Representative">BEED MATH Representative</option>
                                            <option value="BSED Representative">BSED Representative</option>
                                            <option value="BIT Representative">BIT Representative</option>
                                            <option value="BSIE Representative">BSIE Representative</option>
                                        </optgroup>
                                        {/* ── Executive Cabinet ── */}
                                        <optgroup label="Executive Cabinet">
                                            <option value="Senator">Senator</option>
                                            <option value="Secretary">Secretary</option>
                                            <option value="Executive Secretary">Executive Secretary</option>
                                            <option value="Press Secretary">Press Secretary</option>
                                            <option value="Secretary on Network and Linkages">Secretary on Network and Linkages</option>
                                            <option value="Secretary on Finance">Secretary on Finance</option>
                                            <option value="Budget And Management Secretary">Budget And Management Secretary</option>
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
                                    <label>Department / Address</label>
                                    <input
                                        type="text"
                                        name="address"
                                        placeholder="e.g. College of Technology"
                                        value={member.address ?? ""}
                                        onChange={handleChange}
                                    />
                                </div>
                            </div>

                            {/* DESCRIPTION */}
                            <div className={styles.formGroupFull}>
                                <label>Biography / Description</label>
                                <textarea
                                    name="description"
                                    placeholder="Describe achievements, role notes, or biography..."
                                    rows="3"
                                    value={member.description ?? ""}
                                    onChange={handleChange}
                                />
                            </div>

                            {/* SOCIAL MEDIA LINK */}
                            <div className={styles.socialLinkSection}>
                                <label>Social Media Channel</label>
                                <div className={styles.socialInputRow}>
                                    <select
                                        value={selectedPlatform}
                                        onChange={handlePlatformChange}
                                        className={styles.platformSelect}
                                    >
                                        <option value="facebookLink">Facebook</option>
                                        <option value="instagramLink">Instagram</option>
                                        <option value="twitterLink">Twitter / X</option>
                                    </select>
                                    <input
                                        type="url"
                                        placeholder={`Paste ${selectedPlatform.replace('Link', '')} profile URL...`}
                                        value={getCurrentLinkValue()}
                                        onChange={handleLinkChange}
                                        className={styles.platformInput}
                                    />
                                </div>
                            </div>

                            {/* PHOTO UPLOAD */}
                            <div className={styles.photoUploadSection}>
                                <label>Profile Picture</label>
                                <div className={styles.photoUploadRow}>
                                    <input
                                        type="file"
                                        accept="image/*"
                                        onChange={handlePhotoChange}
                                        id="memberPhotoInput"
                                        className={styles.fileInputHidden}
                                    />
                                    <label htmlFor="memberPhotoInput" className={styles.customUploadBtn}>
                                        📷 Upload Photo
                                    </label>
                                    {preview && (
                                        <div className={styles.previewContainer}>
                                            <img src={preview} alt="Preview" className={styles.previewImg} />
                                            <span className={styles.previewText}>Photo Loaded</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className={styles.modalFooter}>
                                <button
                                    type="button"
                                    className={styles.cancelBtn}
                                    onClick={() => setIsAddModalOpen(false)}
                                >
                                    Cancel
                                </button>
                                <button type="submit" className={styles.submitBtn}>
                                    Save Member
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MEMBER LIST TREE / HIERARCHY ACCORDING TO REFERENCE */}
            <div className={styles.memberListWrapper}>
                <Memberslist
                    members={members}
                    setMembers={setMembers}
                    searchQuery={searchQuery}
                    onOpenAddModal={() => setIsAddModalOpen(true)}
                />
            </div>
        </div>
    );
}

export default MemberDashboard;