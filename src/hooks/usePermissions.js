// hooks/usePermissions.js
// PURPOSE: Custom hook for checking user permissions in components
// FEATURES:
//   - Easy permission checking in any component
//   - Role-based and permission-based checks
//   - Conditional rendering helpers
//   - Access denied fallbacks

import { useAuth } from '../components/AuthContext/AuthContext.jsx';
import { 
  hasPermission, 
  hasAnyPermission, 
  hasAllPermissions, 
  canAccessRoute,
  canPerformAction,
  getRoleName,
  filterNavigationByRole
} from '../utils/permissions.js';

/**
 * Custom hook for permission checking
 * @returns {Object} Permission checking utilities
 */
export const usePermissions = () => {
  const { currentUser, userRole, userName, userPermissions, userPermissionOverrides } = useAuth();
  
  // Create user object for permission checking.
  // Unauthenticated visitors get the synthetic 'public' role so nav items
  // flagged for guests still resolve. 'public' has no entry in
  // ROLE_PERMISSIONS, so every permission check stays false for guests.
  const user = currentUser ? {
    uid: currentUser.uid,
    email: currentUser.email,
    role: userRole,
    name: userName,
    permissions: userPermissions || currentUser.permissions || {},
    permissionOverrides: userPermissionOverrides || {}
  } : {
    uid: null,
    email: null,
    role: 'public',
    name: 'Guest',
    permissions: {},
    permissionOverrides: {}
  };
  
  /**
   * Check if user has a specific permission
   * @param {string} permission - Permission to check
   * @returns {boolean} True if user has permission
   */
  const checkPermission = (permission) => {
    if (!user) return false;
    return hasPermission(user, permission);
  };
  
  /**
   * Check if user has any of the specified permissions
   * @param {string[]} permissions - Array of permissions to check
   * @returns {boolean} True if user has at least one permission
   */
  const checkAnyPermission = (permissions) => {
    if (!user) return false;
    return hasAnyPermission(user, permissions);
  };
  
  /**
   * Check if user has all specified permissions
   * @param {string[]} permissions - Array of permissions to check
   * @returns {boolean} True if user has all permissions
   */
  const checkAllPermissions = (permissions) => {
    if (!user) return false;
    return hasAllPermissions(user, permissions);
  };
  
  /**
   * Check if user has a specific role
   * @param {string} role - Role to check
   * @returns {boolean} True if user has the role
   */
  const checkRole = (role) => {
    return userRole === role;
  };
  
  /**
   * Check if user has any of the specified roles
   * @param {string[]} roles - Array of roles to check
   * @returns {boolean} True if user has at least one role
   */
  const checkAnyRole = (roles) => {
    return roles.includes(userRole);
  };
  
  /**
   * Check if user can access a specific route
   * @param {string} route - Route path to check
   * @returns {boolean} True if user can access the route
   */
  const checkRouteAccess = (route) => {
    if (!user) return false;
    return canAccessRoute(user, route);
  };
  
  /**
   * Check if user can perform an action on a resource
   * @param {string} action - Action to perform (create, read, update, delete)
   * @param {string} resourceType - Type of resource
   * @param {Object} resource - Resource object (optional)
   * @returns {boolean} True if user can perform the action
   */
  const checkAction = (action, resourceType, resource = null) => {
    if (!user) return false;
    return canPerformAction(user, action, resourceType, resource);
  };
  
  /**
   * Filter navigation items based on user role
   * @param {Array} navItems - Array of navigation items
   * @returns {Array} Filtered navigation items
   */
  const filterNavigation = (navItems) => {
    return filterNavigationByRole(user, navItems);
  };
  
  /**
   * Get user's role name
   * @returns {string} Human-readable role name
   */
  const getUserRoleName = () => {
    return getRoleName(userRole);
  };
  
  /**
   * Conditionally render content based on permission
   * @param {string|string[]} permission - Permission(s) to check
   * @param {ReactNode} children - Content to render if permission granted
   * @param {ReactNode} fallback - Content to render if permission denied (optional)
   * @param {boolean} requireAll - Require all permissions (default: false for single, true for array)
   * @returns {ReactNode} Rendered content
   */
  const renderIf = (permission, children, fallback = null, requireAll = undefined) => {
    let hasAccess = false;
    
    if (Array.isArray(permission)) {
      const checkAll = requireAll !== undefined ? requireAll : true;
      hasAccess = checkAll 
        ? checkAllPermissions(permission)
        : checkAnyPermission(permission);
    } else {
      hasAccess = checkPermission(permission);
    }
    
    return hasAccess ? children : fallback;
  };
  
  /**
   * Conditionally render content based on role
   * @param {string|string[]} role - Role(s) to check
   * @param {ReactNode} children - Content to render if role matches
   * @param {ReactNode} fallback - Content to render if role doesn't match (optional)
   * @returns {ReactNode} Rendered content
   */
  const renderIfRole = (role, children, fallback = null) => {
    const hasRole = Array.isArray(role) 
      ? checkAnyRole(role)
      : checkRole(role);
    
    return hasRole ? children : fallback;
  };
  
  /**
   * Get user information
   * @returns {Object} User information object
   */
  const getUserInfo = () => ({
    ...user,
    roleName: getUserRoleName(),
    isAuthenticated: !!currentUser,
    isAdmin: userRole === 'admin',
    isSecretary: userRole === 'secretary',
    isFinanceSecretary: userRole === 'finance_secretary',
    isSenator: userRole === 'senator',
    isRepresentative: userRole === 'representative',
    isMember: userRole === 'member',
    isGuest: userRole === 'guest'
  });
  
  return {
    // User information
    user,
    userRole,
    getUserInfo,
    getUserRoleName,
    
    // Permission checking
    checkPermission,
    checkAnyPermission,
    checkAllPermissions,
    checkRole,
    checkAnyRole,
    checkRouteAccess,
    checkAction,
    
    // Navigation
    filterNavigation,
    
    // Conditional rendering
    renderIf,
    renderIfRole,
    
    // Quick boolean checks
    isAdmin: userRole === 'admin',
    isSecretary: userRole === 'secretary',
    isFinanceSecretary: userRole === 'finance_secretary',
    isSenator: userRole === 'senator',
    isRepresentative: userRole === 'representative',
    isMember: userRole === 'member',
    isGuest: userRole === 'guest',
    isAuthenticated: !!currentUser,
    
    // Permission-specific boolean checks
    canManageProducts: checkPermission('canManageProducts'),
    canManageOrders: checkPermission('canManageOrders'),
    canManageUsers: checkPermission('canManageUsers'),
    canViewAnalytics: checkPermission('canViewAnalytics'),
    canViewFinance: checkPermission('canViewFinance'),
    canEditFinance: checkPermission('canEditFinance'),
    canManageCreatives: checkPermission('canManageCreatives'),
    canExportData: checkPermission('canExportData'),
    canSendNotifications: checkPermission('canSendNotifications'),
    canConfigureSystem: checkPermission('canConfigureSystem'),
    canDeleteData: checkPermission('canDeleteData')
  };
};

export default usePermissions;