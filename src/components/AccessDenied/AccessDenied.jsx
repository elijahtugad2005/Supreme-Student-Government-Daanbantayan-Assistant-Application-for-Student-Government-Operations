// components/AccessDenied/AccessDenied.jsx
// PURPOSE: Reusable access denied view in the Classic Royal Maroon & Imperial Gold theme
// FEATURES:
//   - Customizable denial messages and required role/permission metadata
//   - Displays signed-in officer/member account summary
//   - Client-side router recovery actions (Go Back, Return Home, Request Access)
//   - Used both standalone and as the ProtectedRoute fallback

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HiShieldExclamation,
  HiArrowLeft,
  HiHome,
  HiMail,
  HiLockClosed,
  HiUserCircle,
} from 'react-icons/hi';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import { getRoleName } from '../../utils/permissions.js';
import styles from './AccessDenied.module.css';

const CornerOrnament = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 28 28"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      d="M2 26V6C2 3.79086 3.79086 2 6 2H26"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <path
      d="M7 14V7H14"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      opacity="0.7"
    />
    <circle cx="7" cy="7" r="1.6" fill="currentColor" />
  </svg>
);

function AccessDenied({
  message = "You don't have permission to access this page.",
  requiredRole = null,
  requiredPermissions = [],
  showUserInfo = true,
  showActions = true,
  customActions = null,
}) {
  const { currentUser, userRole, userName } = useAuth();
  const navigate = useNavigate();

  const timestamp = useMemo(() => new Date().toLocaleString(), []);

  const user = currentUser
    ? {
        uid: currentUser.uid,
        email: currentUser.email,
        role: userRole,
        name: userName,
      }
    : null;

  const hasRequirements = Boolean(requiredRole) || requiredPermissions.length > 0;

  return (
    <main className={styles.container} role="main" aria-labelledby="access-denied-title">
      <div className={styles.panel}>
        <CornerOrnament className={`${styles.corner} ${styles.cornerTL}`} />
        <CornerOrnament className={`${styles.corner} ${styles.cornerTR}`} />
        <CornerOrnament className={`${styles.corner} ${styles.cornerBL}`} />
        <CornerOrnament className={`${styles.corner} ${styles.cornerBR}`} />

        {/* Header */}
        <header className={styles.header}>
          <div className={styles.crestWrap} aria-hidden="true">
            <HiShieldExclamation className={styles.crestIcon} />
          </div>
          <h1 id="access-denied-title" className={styles.title}>
            Access Denied
          </h1>
          <p className={styles.subtitle}>{message}</p>
        </header>

        {/* Account & Required Access Details */}
        {(showUserInfo && user) || hasRequirements ? (
          <div className={styles.detailsBand}>
            {showUserInfo && user && (
              <section className={styles.detailSection} aria-labelledby="account-info-heading">
                <h2 id="account-info-heading" className={styles.sectionTitle}>
                  <HiUserCircle className={styles.sectionIcon} aria-hidden="true" />
                  <span>Your Account</span>
                </h2>
                <dl className={styles.infoGrid}>
                  <div className={styles.infoItem}>
                    <dt className={styles.infoLabel}>Name</dt>
                    <dd className={styles.infoValue}>{user.name || 'Not set'}</dd>
                  </div>
                  <div className={styles.infoItem}>
                    <dt className={styles.infoLabel}>Email</dt>
                    <dd className={styles.infoValue}>{user.email}</dd>
                  </div>
                  <div className={styles.infoItem}>
                    <dt className={styles.infoLabel}>Current Role</dt>
                    <dd className={styles.infoValue}>
                      <span className={styles.roleBadge}>{getRoleName(user.role)}</span>
                    </dd>
                  </div>
                  <div className={styles.infoItem}>
                    <dt className={styles.infoLabel}>Account ID</dt>
                    <dd className={`${styles.infoValue} ${styles.monoValue}`}>
                      {user.uid.substring(0, 12)}...
                    </dd>
                  </div>
                </dl>
              </section>
            )}

            {hasRequirements && (
              <section className={styles.detailSection} aria-labelledby="required-access-heading">
                <h2 id="required-access-heading" className={styles.sectionTitle}>
                  <HiLockClosed className={styles.sectionIcon} aria-hidden="true" />
                  <span>Required Clearance</span>
                </h2>

                <div className={styles.requirementsStack}>
                  {requiredRole && (
                    <div className={styles.requirementItem}>
                      <span className={styles.infoLabel}>Required Role</span>
                      <span className={styles.requiredRoleBadge}>
                        {getRoleName(requiredRole)}
                      </span>
                    </div>
                  )}

                  {requiredPermissions.length > 0 && (
                    <div className={styles.requirementItem}>
                      <span className={styles.infoLabel}>Required Permissions</span>
                      <div className={styles.permissionsList}>
                        {requiredPermissions.map((permission, index) => (
                          <span key={`${permission}-${index}`} className={styles.permissionBadge}>
                            {permission}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        ) : null}

        {/* Actions */}
        {showActions && (
          <section className={styles.actions} aria-label="Recovery actions">
            {customActions ? (
              customActions
            ) : (
              <div className={styles.actionButtons}>
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className={styles.homeButton}
                >
                  <HiHome aria-hidden="true" />
                  <span>Return Home</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className={styles.backButton}
                >
                  <HiArrowLeft aria-hidden="true" />
                  <span>Go Back</span>
                </button>

                {userRole !== 'admin' && (
                  <button
                    type="button"
                    onClick={() => navigate('/contact')}
                    className={styles.contactButton}
                  >
                    <HiMail aria-hidden="true" />
                    <span>Request Access</span>
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* Footer Guidance */}
        <footer className={styles.helpText}>
          <p className={styles.helpParagraph}>
            If you believe you should have access to this page, contact your SSG system administrator.
            {userRole !== 'admin' && userRole
              ? ` Your current role (${getRoleName(userRole)}) may require elevated permissions.`
              : ''}
          </p>
          <p className={styles.timestamp}>Recorded {timestamp}</p>
        </footer>
      </div>
    </main>
  );
}

export default AccessDenied;
