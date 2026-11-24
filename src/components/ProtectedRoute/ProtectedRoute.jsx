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
import AccessDenied from '../AccessDenied/AccessDenied.jsx';
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
  const {
    currentUser,
    userRole,
    userName,
    userPermissions,
    userPermissionOverrides,
    isAccountActive
  } = useAuth();
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

  // Defense-in-depth: block deactivated accounts even during sign-out transition
  if (isAccountActive === false) {
    return renderAccessDenied(
      'Your account has been deactivated. Please contact an SSG administrator.',
      customAccessDenied
    );
  }

  // Create user object for permission checking (guests already returned above)
  // permissionOverrides are included so a per-user grant from an Admin is
  // honoured here, not just inside components.
  const user = {
    uid: currentUser.uid,
    email: currentUser.email,
    role: userRole,
    name: userName,
    permissions: userPermissions || currentUser.permissions || {},
    permissionOverrides: userPermissionOverrides || {}
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

  return <AccessDenied message={message} />;
}

export default ProtectedRoute;