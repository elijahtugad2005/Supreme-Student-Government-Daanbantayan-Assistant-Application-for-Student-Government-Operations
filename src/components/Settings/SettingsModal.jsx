import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  HiCog,
  HiMoon,
  HiSun,
  HiX,
  HiChevronLeft,
  HiCheck,
} from 'react-icons/hi';
import {
  GitBranch,
  ExternalLink,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import changelogData from '../../data/changelogData.json';
import { groupCommitsByMonth } from '../../utils/changelogHelpers.js';
import styles from './SettingsModal.module.css';

const THEMES = [
  {
    id: 'dark',
    name: 'Classic Mode',
    description: 'Original maroon editorial theme',
    icon: HiMoon,
    preview: 'linear-gradient(135deg, #2D0A0A 0%, #D94F1F 100%)',
  },
  {
    id: 'light',
    name: 'Light Mode',
    description: 'Clean white theme',
    icon: HiSun,
    preview: 'linear-gradient(135deg, #FFFFFF 0%, #3B82F6 100%)',
  },
  {
    id: 'corporate',
    name: 'Formal Corporate Theme',
    description: 'Blue modern minimalist',
    icon: HiCog,
    preview: 'linear-gradient(135deg, #060b18 0%, #2563eb 100%)',
  },
];

const COMPILED_COMMITS = changelogData.commits || [];
const REPOSITORY_META = changelogData.repository || {};
const CHANGELOG_STATS = changelogData.stats || {};

export default function SettingsModal({ isOpen, onClose, theme, onChangeTheme }) {
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);

  const commits = COMPILED_COMMITS;
  const repository = REPOSITORY_META;
  const stats = CHANGELOG_STATS;

  const monthGroups = useMemo(() => groupCommitsByMonth(COMPILED_COMMITS), []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (isChangelogOpen) {
          setIsChangelogOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isChangelogOpen, onClose]);

  const handleClose = () => {
    setIsChangelogOpen(false);
    onClose();
  };

  if (!isOpen) return null;

  const latestCommit = commits[0] || null;
  const repoDisplayName =
    repository.owner && repository.name
      ? `${repository.owner}/${repository.name}`
      : 'GitHub Repository';

  return createPortal(
    <div
      className={styles.overlay}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div
        className={`${styles.modal} ${isChangelogOpen ? styles.modalExpanded : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            {isChangelogOpen ? (
              <button
                type="button"
                className={styles.backBtn}
                onClick={() => setIsChangelogOpen(false)}
                title="Back to Settings"
              >
                <HiChevronLeft size={18} aria-hidden="true" />
                <span>Settings</span>
              </button>
            ) : (
              <span className={styles.headerIconBadge} aria-hidden="true">
                <HiCog size={18} />
              </span>
            )}
            <div className={styles.headerTitles}>
              <h2 id="settings-modal-title" className={styles.title}>
                {isChangelogOpen ? 'Changelogs' : 'Settings'}
              </h2>
              <p className={styles.subtitle}>
                {isChangelogOpen
                  ? `${commits.length} compiled commits (${stats.firstCommitDate || ''} – ${stats.latestCommitDate || ''})`
                  : 'Appearance and repository changelogs'}
              </p>
            </div>
          </div>

          <div className={styles.headerActions}>
            {isChangelogOpen && repository.url && (
              <a
                href={repository.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.repoHeaderLink}
                title={`Open ${repoDisplayName} on GitHub`}
              >
                <GitBranch size={14} aria-hidden="true" />
                <span>GitHub Repo</span>
                <ExternalLink size={13} aria-hidden="true" />
              </a>
            )}
            {isChangelogOpen && (
              <button
                type="button"
                className={styles.iconBtn}
                onClick={() => setIsChangelogOpen(false)}
                aria-label="Collapse changelogs"
                title="Back to compact Settings"
              >
                <Minimize2 size={15} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className={styles.iconBtn}
              onClick={handleClose}
              aria-label="Close Settings"
              title="Close Settings"
            >
              <HiX size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        {!isChangelogOpen ? (
          /* Compact Settings View */
          <div className={styles.body}>
            <section className={styles.section} aria-labelledby="settings-theme-heading">
              <div className={styles.sectionHeader}>
                <h3 id="settings-theme-heading" className={styles.sectionTitle}>
                  Appearance &amp; Theme
                </h3>
                <span className={styles.sectionHint}>Applied immediately</span>
              </div>

              <div className={styles.themeList}>
                {THEMES.map((themeOption) => {
                  const IconComponent = themeOption.icon;
                  const isActive = theme === themeOption.id;
                  return (
                    <button
                      key={themeOption.id}
                      type="button"
                      className={`${styles.themeOption} ${
                        isActive ? styles.themeOptionActive : ''
                      }`}
                      onClick={() => onChangeTheme(themeOption.id)}
                      aria-pressed={isActive}
                    >
                      <div
                        className={styles.themePreview}
                        style={{ background: themeOption.preview }}
                      >
                        <IconComponent className={styles.themePreviewIcon} />
                      </div>
                      <div className={styles.themeOptionContent}>
                        <span className={styles.themeOptionName}>{themeOption.name}</span>
                        <span className={styles.themeOptionDesc}>{themeOption.description}</span>
                      </div>
                      {isActive && (
                        <span className={styles.themeOptionCheck} aria-label="Active theme">
                          <HiCheck size={16} aria-hidden="true" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={styles.section} aria-labelledby="settings-changelog-heading">
              <div className={styles.sectionHeader}>
                <h3 id="settings-changelog-heading" className={styles.sectionTitle}>
                  Changelogs &amp; GitHub Repository
                </h3>
                <span className={styles.commitCountPill}>{commits.length} commits</span>
              </div>

              <div className={styles.changelogCard}>
                <div className={styles.repoRow}>
                  <div className={styles.repoMeta}>
                    <div className={styles.repoNameRow}>
                      <GitBranch size={14} className={styles.repoIcon} aria-hidden="true" />
                      <span className={styles.repoOwner}>
                        {repository.owner || 'GitHub'}
                      </span>
                      <span className={styles.branchPill}>
                        {repository.branch || 'main'}
                      </span>
                    </div>
                    <p className={styles.repoFullName}>{repository.name || repoDisplayName}</p>
                    {latestCommit && (
                      <p className={styles.latestMeta}>
                        Latest: <code>{latestCommit.shortHash}</code> · {latestCommit.date}
                      </p>
                    )}
                  </div>
                </div>

                <div className={styles.changelogCardActions}>
                  {repository.url && (
                    <a
                      href={repository.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.secondaryActionBtn}
                    >
                      <GitBranch size={14} aria-hidden="true" />
                      <span>Open GitHub Repo</span>
                      <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  )}

                  <button
                    type="button"
                    className={styles.primaryActionBtn}
                    onClick={() => setIsChangelogOpen(true)}
                  >
                    <Maximize2 size={14} aria-hidden="true" />
                    <span>Expand Changelogs</span>
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : (
          /* Simple Scrollable Changelogs List (No dropdowns, no search, no filters) */
          <div className={styles.changelogScroll}>
            {repository.url && (
              <div className={styles.repoInlineBar}>
                <GitBranch size={14} className={styles.repoIcon} aria-hidden="true" />
                <a
                  href={repository.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.repoInlineLink}
                >
                  {repoDisplayName}
                </a>
                <span className={styles.branchPill}>{repository.branch || 'main'}</span>
              </div>
            )}

            {monthGroups.map((group) => (
              <section key={group.monthKey} className={styles.monthSection}>
                <div className={styles.monthHeadingRow}>
                  <h3 className={styles.monthHeading}>{group.label}</h3>
                  <span className={styles.monthCount}>
                    {group.commits.length} {group.commits.length === 1 ? 'commit' : 'commits'}
                  </span>
                </div>

                <ul className={styles.commitList}>
                  {group.commits.map((commit) => (
                    <li key={commit.hash} className={styles.commitRow}>
                      <span className={styles.commitDate}>{commit.date}</span>
                      <span className={styles.commitMessage}>{commit.subject}</span>
                      <a
                        href={commit.commitUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.shaLink}
                        title={`View commit ${commit.shortHash} on GitHub`}
                      >
                        {commit.shortHash}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
