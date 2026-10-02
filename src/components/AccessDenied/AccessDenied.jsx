// components/AccessDenied/AccessDenied.jsx
// PURPOSE: Reusable access denied component with detailed information
// FEATURES:
//   - Customizable denial messages
//   - Shows user role and permissions
//   - Provides helpful actions
//   - Can be used standalone or with ProtectedRoute

import React from 'react';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import { getRoleName } from '../../utils/permissions.js';
import styles from './AccessDenied.module.css';

function AccessDenied({ 
  message = "You don't have permission to access this page.",
  requiredRole = null,
  requiredPermissions = [],
  showUserInfo = true,
  showActions = true,
  customActions = null
}) {
  const { currentUser, userRole, userName } = useAuth();
  
  const user = currentUser ? {
    uid: currentUser.uid,
    email: currentUser.email,
    role: userRole,
    name: userName
  } : null;

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.icon}>🚫</div>
          <h1 className={styles.title}>Access Denied</h1>
          <p className={styles.subtitle}>{message}</p>
        </div>

        {/* User Information */}
        {showUserInfo && user && (
          <div className={styles.userInfo}>
            <h3 className={styles.sectionTitle}>Your Account Information</h3>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Name:</span>
                <span className={styles.infoValue}>{user.name || 'Not set'}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Email:</span>
                <span className={styles.infoValue}>{user.email}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Role:</span>
                <span className={styles.infoValue}>
                  <span className={styles.roleBadge}>{getRoleName(user.role)}</span>
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>User ID:</span>
                <span className={styles.infoValue}>{user.uid.substring(0, 12)}...</span>
              </div>
            </div>
          </div>
        )}

        {/* Requirements */}
        {(requiredRole || requiredPermissions.length > 0) && (
          <div className={styles.requirements}>
            <h3 className={styles.sectionTitle}>Required Access</h3>
            
            {requiredRole && (
              <div className={styles.requirementItem}>
                <span className={styles.requirementLabel}>Required Role:</span>
                <span className={styles.requirementValue}>
                  <span className={styles.requiredRoleBadge}>{getRoleName(requiredRole)}</span>
                </span>
              </div>
            )}
            
            {requiredPermissions.length > 0 && (
              <div className={styles.requirementItem}>
                <span className={styles.requirementLabel}>Required Permissions:</span>
                <div className={styles.permissionsList}>
                  {requiredPermissions.map((permission, index) => (
                    <span key={index} className={styles.permissionBadge}>
                      {permission}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        {showActions && (
          <div className={styles.actions}>
            <h3 className={styles.sectionTitle}>What can you do?</h3>
            
            {customActions ? (
              customActions
            ) : (
              <div className={styles.actionButtons}>
                <button
                  onClick={() => window.history.back()}
                  className={styles.backButton}
                >
                  ← Go Back
                </button>
                
                <button
                  onClick={() => window.location.href = '/'}
                  className={styles.homeButton}
                >
                  🏠 Go to Home
                </button>
                
                {userRole !== 'admin' && (
                  <button
                    onClick={() => window.location.href = '/contact'}
                    className={styles.contactButton}
                  >
                    📧 Request Access
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Help Text */}
        <div className={styles.helpText}>
          <p className={styles.helpParagraph}>
            If you believe you should have access to this page, please contact your system administrator.
          </p>
          {userRole !== 'admin' && (
            <p className={styles.helpParagraph}>
              Your current role ({getRoleName(userRole)}) may require an upgrade for this feature.
            </p>
          )}
          <p className={styles.timestamp}>
            Access denied at: {new Date().toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}

export default AccessDenied;