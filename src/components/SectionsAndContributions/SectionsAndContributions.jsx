// components/SectionsAndContributions/SectionsAndContributions.jsx
// PURPOSE: Unified portal combining Class Roster and Death Aid as requested.
// Provides fast clickable section navigation tabs, progress indicators,
// URL state synchronization, keyboard accessibility, and live tab badges.

import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, onSnapshot, query, limit } from 'firebase/firestore';
import { db } from '../../firebase/firebaseConfig';
import ClassUpload from '../ClassUpload.jsx';
import DeathAid from '../DeathAid.jsx';
import styles from './SectionsAndContributions.module.css';
import { HiDocumentText, HiCurrencyDollar, HiUpload, HiPlusCircle } from 'react-icons/hi';

export default function SectionsAndContributions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTabFromUrl = searchParams.get('tab') === 'death-aid' ? 'death-aid' : 'roster';
  const [activeTab, setActiveTab] = useState(currentTabFromUrl);

  // Live lightweight count badges
  const [sectionCount, setSectionCount] = useState(null);
  const [collectionCount, setCollectionCount] = useState(null);

  // 1. Sync local tab state with URL (handles browser Back/Forward navigation)
  useEffect(() => {
    if (currentTabFromUrl !== activeTab) {
      setActiveTab(currentTabFromUrl);
    }
  }, [currentTabFromUrl]);

  // 2. Fetch lightweight live counters for Tab Badges
  useEffect(() => {
    let alive = true;

    // Listen to registered class sections
    const unsubSections = onSnapshot(
      query(collection(db, 'classSections'), limit(200)),
      (snapshot) => {
        if (alive) setSectionCount(snapshot.size);
      },
      () => {
        if (alive) setSectionCount(null);
      }
    );

    // Listen to death aid collections
    const unsubCollections = onSnapshot(
      query(collection(db, 'deathAidCollections'), limit(200)),
      (snapshot) => {
        if (alive) setCollectionCount(snapshot.size);
      },
      () => {
        if (alive) setCollectionCount(null);
      }
    );

    return () => {
      alive = false;
      unsubSections();
      unsubCollections();
    };
  }, []);

  const handleTabSwitch = useCallback((tabKey) => {
    setActiveTab(tabKey);
    setSearchParams({ tab: tabKey });
  }, [setSearchParams]);

  // 3. Accessible arrow-key navigation between tabs
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const nextTab = activeTab === 'roster' ? 'death-aid' : 'roster';
      handleTabSwitch(nextTab);
    }
  };

  return (
    <div className={styles.container}>
      {/* ── Macro Industrial Header ── */}
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <div className={styles.badge}>SSG OPERATIONAL ARCHIVE // 2026</div>
          <h1 className={styles.title}>Sections &amp; Contributions</h1>
          <p className={styles.subtitle}>
            Integrated administrative console for institutional student section rosters, mayor filings, and physical death aid collection tracking.
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            onClick={() => handleTabSwitch('roster')}
            className={styles.headerActionBtn}
            title="Switch to roster registry to upload or review class rosters"
          >
            <HiUpload style={{ fontSize: '1.05rem' }} />
            <span>Upload Roster</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabSwitch('death-aid')}
            className={styles.headerActionBtn}
            title="Switch to death aid contributions to record or view collections"
          >
            <HiPlusCircle style={{ fontSize: '1.05rem' }} />
            <span>Record Contribution</span>
          </button>
        </div>
      </header>

      {/* ── Mechanical Navigation Bar with ARIA Tab Semantics & Live Badges ── */}
      <nav
        className={styles.navBar}
        role="tablist"
        aria-label="Sections and Contributions Navigation"
        onKeyDown={handleKeyDown}
      >
        <button
          type="button"
          role="tab"
          id="tab-roster"
          aria-selected={activeTab === 'roster'}
          aria-controls="panel-roster"
          tabIndex={activeTab === 'roster' ? 0 : -1}
          onClick={() => handleTabSwitch('roster')}
          className={`${styles.navButton} ${activeTab === 'roster' ? styles.navButtonActive : ''}`}
        >
          <HiDocumentText className={styles.navIcon} />
          <span className={styles.navLabel}>Class Roster Registry</span>
          {sectionCount !== null && (
            <span className={styles.tabBadge} title={`${sectionCount} Sections Recorded`}>
              {sectionCount} {sectionCount === 1 ? 'Section' : 'Sections'}
            </span>
          )}
          {activeTab === 'roster' && <span className={styles.activeDot} />}
        </button>

        <button
          type="button"
          role="tab"
          id="tab-death-aid"
          aria-selected={activeTab === 'death-aid'}
          aria-controls="panel-death-aid"
          tabIndex={activeTab === 'death-aid' ? 0 : -1}
          onClick={() => handleTabSwitch('death-aid')}
          className={`${styles.navButton} ${activeTab === 'death-aid' ? styles.navButtonActive : ''}`}
        >
          <HiCurrencyDollar className={styles.navIcon} />
          <span className={styles.navLabel}>Death Aid Contributions</span>
          {collectionCount !== null && (
            <span className={styles.tabBadge} title={`${collectionCount} Records Tracked`}>
              {collectionCount} {collectionCount === 1 ? 'Record' : 'Records'}
            </span>
          )}
          {activeTab === 'death-aid' && <span className={styles.activeDot} />}
        </button>
      </nav>

      {/* ── Active Section Panel with ARIA Panel Attributes ── */}
      <main className={styles.viewPanel}>
        {activeTab === 'roster' ? (
          <div
            id="panel-roster"
            role="tabpanel"
            aria-labelledby="tab-roster"
            key="roster"
            className={styles.fadeSlideIn}
          >
            <ClassUpload />
          </div>
        ) : (
          <div
            id="panel-death-aid"
            role="tabpanel"
            aria-labelledby="tab-death-aid"
            key="death-aid"
            className={styles.fadeSlideIn}
          >
            <DeathAid />
          </div>
        )}
      </main>
    </div>
  );
}
