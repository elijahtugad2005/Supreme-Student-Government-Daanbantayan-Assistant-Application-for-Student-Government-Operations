// components/ProtectedRoute/ProtectedRoute.jsx
// PURPOSE: Comprehensive wrapper component that protects routes based on authentication, role, and permissions
// USAGE: Wrap any component that requires authentication and/or specific permissions
// FEATURES:
//   - Blocks unauthenticated users (redirects to login)
//   - Optionally lets unauthenticated visitors browse as guests (allowGuest)
//   - Blocks users without required role (shows access denied)
//   - Blocks users without required permissions
//   - Supports both role-based and permission-based access control
//   - Remembers intended destination for post-login redirect
//   - Customizable access denied messages

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext/AuthContext.jsx';
import { hasPermission, getRoleName, canAccessRoute } from '../../utils/permissions.js';

function ProtectedRoute({ 
  children, 
  allowedRoles = [], 
  requiredPermissions = [],
  anyPermission = false,
  customAccessDenied = null,
  redirectTo = '/login',
  allowGuest = false
}) {
  const { currentUser, userRole, userName, userPermissions } = useAuth();
  const location = useLocation();

  // Unauthenticated visitors browsing with guest rights
  const isGuest = !currentUser;

  // ========================================
  // CHECK 1: Is user logged in?
  // If not, redirect to login page — unless the route is guest-friendly
  // ========================================
  if (isGuest && !allowGuest) {
    // Save the page they tried to access
    return <Navigate to={redirectTo} state={{ from: location }} replace />;
  }

  // A guest on a guest-friendly route skips the role/permission checks —
  // the route itself opted in, and guests hold no permissions anyway.
  if (isGuest) {
    return children;
  }

  // Create user object for permission checking (guests already returned above)
  // permissionOverrides are included so a per-user grant from an Admin is
  // honoured here, not just inside components.
  const user = {
    uid: currentUser.uid,
    email: currentUser.email,
    role: userRole,
    name: userName,
    permissions: currentUser.permissions || {},
    permissionOverrides: userPermissions || {}
  };

  // ========================================
  // CHECK 2: Route-level access control
  // Check if user can access this route based on their role
  // ========================================
  const canAccessThisRoute = canAccessRoute(user, location.pathname);
  if (!canAccessThisRoute) {
    return renderAccessDenied(
      `Route "${location.pathname}" is not accessible with your role (${getRoleName(userRole)}).`,
      customAccessDenied
    );
  }

  // ========================================
  // CHECK 3 + 4: role and permission checks
  //
  // A per-user permission override is a deliberate grant from an Admin, so it
  // can stand in for a role the static list would reject. Routes that declare
  // no permissions still fall back to their role list, which keeps the change
  // from quietly widening access to role-only routes.
  // ========================================
  const hasRequiredPermissions =
    requiredPermissions.length === 0
      ? null
      : anyPermission
        ? requiredPermissions.some((permission) => hasPermission(user, permission))
        : requiredPermissions.every((permission) => hasPermission(user, permission));

  const roleAllowed = allowedRoles.length === 0 || allowedRoles.includes(userRole);

  if (!roleAllowed && hasRequiredPermissions !== true) {
    return renderAccessDenied(
      `This page requires one of these roles: ${allowedRoles.map(role => getRoleName(role)).join(', ')}. Your role: ${getRoleName(userRole)}.`,
      customAccessDenied
    );
  }

  if (hasRequiredPermissions === false) {
    const permissionText = anyPermission
      ? 'at least one of these permissions'
      : 'all of these permissions';

    return renderAccessDenied(
      `This page requires ${permissionText}: ${requiredPermissions.join(', ')}. Your role (${getRoleName(userRole)}) doesn't have sufficient permissions.`,
      customAccessDenied
    );
  }

  // User is authenticated (or a guest on a guest-friendly route) with correct role/permissions
  return children;
}

// Helper function to render access denied page
function renderAccessDenied(message, customComponent) {
  if (customComponent) {
    return React.cloneElement(customComponent, { message });
  }
  
  return (
    <div style={styles.accessDenied}>
      <h1 style={styles.deniedTitle}>🚫 Access Denied</h1>
      <p style={styles.deniedText}>{message}</p>
      
      <div style={styles.actions}>
        <button 
          onClick={() => window.history.back()}
          style={styles.backButton}
        >
          ← Go Back
        </button>
        
        <button 
          onClick={() => window.location.href = '/'}
          style={styles.homeButton}
        >
          🏠 Go to Home
        </button>
      </div>
      
      <div style={styles.helpText}>
        <p>Need elevated access? Contact your system administrator.</p>
        <p style={styles.timestamp}>Access denied at: {new Date().toLocaleString()}</p>
      </div>
    </div>
  );
}

// Inline styles for access denied page
const styles = {
  accessDenied: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a1a',
    padding: '2rem',
    textAlign: 'center',
    color: '#f0f0f0',
    fontFamily: "'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  deniedTitle: {
    fontSize: '3rem',
    color: '#f44336',
    marginBottom: '1.5rem',
    fontWeight: '700',
  },
  deniedText: {
    fontSize: '1.2rem',
    color: '#ccc',
    marginBottom: '2rem',
    maxWidth: '600px',
    lineHeight: '1.6',
  },
  actions: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '2rem',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  backButton: {
    padding: '1rem 2rem',
    backgroundColor: '#2196F3',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    minWidth: '140px',
  },
  homeButton: {
    padding: '1rem 2rem',
    backgroundColor: '#4CAF50',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    minWidth: '140px',
  },
  helpText: {
    marginTop: '2rem',
    paddingTop: '1.5rem',
    borderTop: '1px solid #333',
    maxWidth: '500px',
  },
  timestamp: {
    fontSize: '0.85rem',
    color: '#777',
    marginTop: '0.5rem',
    fontFamily: "'Monaco', 'Courier New', monospace",
  },
};

// Hover effects
styles.backButton[':hover'] = {
  backgroundColor: '#1976D2',
  transform: 'translateY(-2px)',
  boxShadow: '0 4px 8px rgba(33, 150, 243, 0.3)',
};

styles.homeButton[':hover'] = {
  backgroundColor: '#45a049',
  transform: 'translateY(-2px)',
  boxShadow: '0 4px 8px rgba(76, 175, 80, 0.3)',
};

export default ProtectedRoute;